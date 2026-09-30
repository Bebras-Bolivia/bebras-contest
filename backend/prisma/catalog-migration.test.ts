import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  AGE_RANGES,
  CATEGORY_ALIASES,
  MASTER_TASK_IDS,
  INTERACTIVE_TASK_TYPES,
  SOLUTION_IMAGE_TASK_IDS,
  TASK_METADATA,
  createSolutionImageBlock,
  migrateCatalog,
  migrateCatalogFiles,
  serializeCatalog,
  validateCatalog,
} from "./catalog-migration";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
const currentPath = path.resolve(__dirname, "seed/bebras-tasks.json");
const finalCatalog = JSON.parse(fs.readFileSync(currentPath, "utf8")) as Array<
  Record<string, unknown>
>;

function textBlock(id: string, content = "Content") {
  return { id, type: "text", content, image: null, widthPercent: 100 };
}

function syntheticCatalog(): Array<Record<string, unknown>> {
  return TASK_METADATA.map((metadata) => {
    if (Object.hasOwn(INTERACTIVE_TASK_TYPES, metadata.id)) {
      return structuredClone(finalCatalog[metadata.number - 1]);
    }
    const explanationBlocks: unknown[] = [
      textBlock(
        metadata.master
          ? `${metadata.id}-master-explanation`
          : `${metadata.id}-explanation-text`,
        "Explanation",
      ),
    ];
    if (metadata.hasSolutionImage) {
      explanationBlocks.push(createSolutionImageBlock(metadata.id, PNG));
    }

    const common = {
      id: metadata.id,
      title: metadata.title,
      country: metadata.country,
      year: metadata.year,
      sourceTaskCode: metadata.sourceTaskCode,
      categories: ["Algoritmos y programación"],
      difficulties: metadata.difficulties,
      bodyBlocks: [textBlock(`${metadata.id}-body`)],
      challengeBlocks: [
        {
          id: `${metadata.id}-challenge`,
          type: "challenge",
          content: "Question",
          image: null,
          widthPercent: 100,
        },
      ],
      explanationBlocks,
      isPractice: true,
    };

    if (metadata.number === 14 || metadata.number === 34) {
      return {
        ...common,
        answerType: "drag_drop",
        answers: [],
        correctAnswerId: "",
        shortAnswer: "",
        dragDropBackground: {
          id: `${metadata.id}-background-image`,
          name: "background.png",
          url: PNG,
        },
        dragDropTargets: [
          { id: `${metadata.id}-target`, x: 50, y: 50, snapRadius: 10 },
        ],
        dragDropItems: [
          {
            id: `${metadata.id}-item`,
            label: "Item",
            image: {
              id: `${metadata.id}-item-image`,
              name: "item.png",
              url: PNG,
            },
            widthPercent: 10,
            correctTargetId: `${metadata.id}-target`,
          },
        ],
        dragDropSolutions: [],
      };
    }

    const correct = metadata.number === 43 ? "D" : "A";
    return {
      ...common,
      answerType: "multiple_choice",
      multipleChoiceOrderMode: "fixed",
      answers: [
        {
          id: "A",
          blocks: [textBlock(`${metadata.id}-answer-a`, "A")],
          isCorrect: correct === "A",
        },
        {
          id: "D",
          blocks: [textBlock(`${metadata.id}-answer-d`, "D")],
          isCorrect: correct === "D",
        },
      ],
      correctAnswerId: `single:${correct}`,
    };
  });
}

function taskByNumber(catalog: Array<Record<string, unknown>>, number: number) {
  return catalog[number - 1];
}

test("verified metadata covers all 43 booklet tasks", () => {
  assert.deepEqual(
    TASK_METADATA.map((task) => task.number),
    Array.from({ length: 43 }, (_, index) => index + 1),
  );
  assert.equal(new Set(TASK_METADATA.map((task) => task.id)).size, 43);
  assert.equal(
    new Set(TASK_METADATA.map((task) => task.sourceTaskCode)).size,
    43,
  );
  assert.equal(MASTER_TASK_IDS.size, 21);
  assert.equal(SOLUTION_IMAGE_TASK_IDS.size, 25);
  for (const task of TASK_METADATA) {
    assert.deepEqual(Object.keys(task.difficulties), AGE_RANGES);
  }

  const task14 = TASK_METADATA[13];
  assert.equal(task14.sourceTaskCode, "2024-PL-04");
  assert.deepEqual(Object.values(task14.difficulties), [
    "",
    "hard",
    "hard",
    "medium",
    "",
    "",
  ]);
  assert.equal(TASK_METADATA[41].sourceTaskCode, "2019-VN-04");
  assert.equal(TASK_METADATA[42].country, "Hungría");
  assert.deepEqual(Object.values(TASK_METADATA[10].difficulties), [
    "",
    "easy",
    "easy",
    "",
    "",
    "",
  ]);
  for (const legacyCategory of [
    "Algoritmos y programación",
    "Estructuras de datos y representaciones",
    "Estructuras de datos y lógica",
    "Procesos computacionales y hardware",
    "Comunicación y redes",
    "Pensamiento computacional",
    "Estructuras de datos",
    "Optimización",
    "Tipos de datos",
    "Autómatas y lenguajes",
    "Sistemas y estados",
    "Codificación binaria",
    "Criptografía",
    "Ordenamiento",
    "Teoría de grafos",
    "Teoría de juegos",
    "Estrategia algorítmica",
  ]) {
    assert.ok(Object.hasOwn(CATEGORY_ALIASES, legacyCategory));
  }
});

test("validator accepts a complete deterministic catalog", () => {
  const catalog = syntheticCatalog();
  assert.doesNotThrow(() => validateCatalog(catalog));
  assert.ok(serializeCatalog(catalog).endsWith("\n"));
});

test("validator rejects unknown categories and unsupported fields", () => {
  const unknownCategory = structuredClone(syntheticCatalog()) as Array<
    Record<string, unknown>
  >;
  unknownCategory[0].categories = ["Unknown"];
  assert.throws(
    () => validateCatalog(unknownCategory),
    /non-canonical category/,
  );

  const unsupported = structuredClone(syntheticCatalog()) as Array<
    Record<string, unknown>
  >;
  unsupported[0].status = "Borrador";
  assert.throws(
    () => validateCatalog(unsupported),
    /unsupported fields: status/,
  );
});

test("validator rejects duplicate numbering and quarantine", () => {
  const duplicate = structuredClone(syntheticCatalog()) as Array<
    Record<string, unknown>
  >;
  duplicate[1].id = duplicate[0].id;
  assert.throws(
    () => validateCatalog(duplicate),
    /duplicate task id|booklet task/,
  );

  const quarantine = structuredClone(syntheticCatalog()) as Array<
    Record<string, unknown>
  >;
  taskByNumber(quarantine, 4).isPractice = false;
  assert.throws(() => validateCatalog(quarantine), /cannot contain quarantine/);
});

test("final migration preserves all canonical fields and is idempotent without legacy data", () => {
  const original = structuredClone(finalCatalog);
  // A later reviewed non-master edit must win over both legacy and seed data.
  const explanation = original[15].explanationBlocks as Array<
    Record<string, unknown>
  >;
  explanation[0].content = "Explicación final revisada por el usuario.";
  const snapshot = structuredClone(original);
  const migrated = migrateCatalog(null, original);
  assert.deepEqual(migrated, original);
  assert.deepEqual(migrateCatalog([], migrated), original);
  assert.notEqual(migrated, original);
  for (let index = 0; index < original.length; index += 1) {
    assert.notEqual(
      migrated[index].explanationBlocks,
      original[index].explanationBlocks,
    );
  }
  assert.deepEqual(original, snapshot);
  assert.deepEqual(
    migrated
      .filter((task) => Object.hasOwn(INTERACTIVE_TASK_TYPES, String(task.id)))
      .map((task) => [String(task.id).split("-")[2], task.answerType]),
    [
      ["04", "image_hotspot"],
      ["09", "state_grid"],
      ["11", "image_hotspot"],
      ["19", "text_cloze"],
      ["31", "state_grid"],
      ["37", "text_cloze"],
      ["40", "text_cloze"],
    ],
  );
});

test("validator and migration reject every interactive downgrade, wrong family and quarantine", () => {
  for (const [id, answerType] of Object.entries(INTERACTIVE_TASK_TYPES)) {
    for (const replacement of [
      "multiple_choice",
      "short_text",
      "drag_drop",
      "image_hotspot",
      "state_grid",
      "text_cloze",
    ]) {
      if (replacement === answerType) continue;
      const catalog = structuredClone(finalCatalog);
      catalog.find((task) => task.id === id)!.answerType = replacement;
      assert.throws(() => validateCatalog(catalog), /must remain/);
      assert.throws(() => migrateCatalog(null, catalog), /must remain/);
    }
  }
  for (const task of finalCatalog) {
    const catalog = structuredClone(finalCatalog);
    catalog.find((candidate) => candidate.id === task.id)!.isPractice = false;
    assert.throws(() => validateCatalog(catalog), /cannot contain quarantine/);
  }
});

test("validator rejects generator variants and extra placeholder tasks", () => {
  for (const [number, slug] of [
    [4, "caminando-por-el-bosque"],
    [9, "tubo-de-canicas"],
    [31, "secuencia-de-pelotas"],
  ] as const) {
    const catalog = structuredClone(finalCatalog);
    catalog[number - 1].id =
      `bebras-2024-${String(number).padStart(2, "0")}-${slug}`;
    assert.throws(() => migrateCatalog(null, catalog), /unknown task id/);
  }
  assert.throws(
    () => validateCatalog([...finalCatalog, finalCatalog[18]]),
    /exactly 43/,
  );
});

test("file migration preserves final JSON and never writes an invalid catalog", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "bebras-catalog-final-"),
  );
  const legacyPath = path.join(directory, "legacy.json");
  const inputPath = path.join(directory, "current.json");
  const outputPath = path.join(directory, "output.json");
  try {
    fs.writeFileSync(legacyPath, "[]");
    const checked = migrateCatalogFiles(legacyPath, currentPath, outputPath, {
      write: false,
    });
    assert.equal(fs.existsSync(outputPath), false);
    const written = migrateCatalogFiles(legacyPath, currentPath, outputPath);
    assert.equal(written.json, checked.json);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(outputPath, "utf8")),
      finalCatalog,
    );
    const invalid = structuredClone(finalCatalog);
    invalid[3].answerType = "multiple_choice";
    invalid[3].isPractice = false;
    fs.writeFileSync(inputPath, JSON.stringify(invalid));
    assert.throws(
      () => migrateCatalogFiles(legacyPath, inputPath, outputPath),
      /must remain/,
    );
    assert.equal(fs.readFileSync(outputPath, "utf8"), written.json);

    for (const [args, status] of [
      [[], 0],
      [[currentPath], 0],
      [[inputPath], 1],
    ] as const) {
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          path.resolve(__dirname, "migrate-catalog.ts"),
          "--check",
          ...args,
        ],
        { cwd: path.resolve(__dirname, ".."), encoding: "utf8" },
      );
      assert.equal(result.status, status, result.stderr);
      if (status === 0)
        assert.match(result.stdout, /Validated 43 tasks; no file was written/);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("validator rejects invalid PNG data and solution image identifiers", () => {
  const badPng = structuredClone(syntheticCatalog()) as Array<
    Record<string, unknown>
  >;
  const explanationBlocks = taskByNumber(badPng, 1).explanationBlocks as Array<
    Record<string, unknown>
  >;
  const solution = explanationBlocks.find(
    (block) =>
      block.id === "bebras-2024-01-caja-de-pulseras-solution-image-block",
  )!;
  (solution.image as Record<string, unknown>).url =
    "data:image/png;base64,invalid";
  assert.throws(() => validateCatalog(badPng), /not a PNG data URL/);

  const badId = structuredClone(syntheticCatalog()) as Array<
    Record<string, unknown>
  >;
  const badIdBlocks = taskByNumber(badId, 2).explanationBlocks as Array<
    Record<string, unknown>
  >;
  const badIdSolution = badIdBlocks.find(
    (block) => block.id === "bebras-2024-02-la-pelota-solution-image-block",
  )!;
  (badIdSolution.image as Record<string, unknown>).id = "random-id";
  assert.throws(
    () => validateCatalog(badId),
    /solution image identifiers are not deterministic/,
  );
});

test("validator protects task 14, task 34, and Palago answer contracts", () => {
  for (const number of [14, 34]) {
    const catalog = structuredClone(syntheticCatalog()) as Array<
      Record<string, unknown>
    >;
    const task = taskByNumber(catalog, number);
    task.answerType = "multiple_choice";
    task.multipleChoiceOrderMode = "fixed";
    task.answers = [
      {
        id: "A",
        blocks: [textBlock(`${String(task.id)}-replacement-a`, "A")],
        isCorrect: true,
      },
      {
        id: "B",
        blocks: [textBlock(`${String(task.id)}-replacement-b`, "B")],
        isCorrect: false,
      },
    ];
    task.correctAnswerId = "single:A";
    assert.throws(() => validateCatalog(catalog), /must remain drag_drop/);
  }

  const palagoCatalog = structuredClone(syntheticCatalog()) as Array<
    Record<string, unknown>
  >;
  const palago = taskByNumber(palagoCatalog, 43);
  palago.correctAnswerId = "single:A";
  const answers = palago.answers as Array<Record<string, unknown>>;
  for (const answer of answers) answer.isCorrect = answer.id === "A";
  assert.throws(
    () => validateCatalog(palagoCatalog),
    /Palago must use multiple_choice with single:D/,
  );
});
