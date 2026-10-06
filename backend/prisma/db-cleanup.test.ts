import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { loadCatalogTaskData } from "./task-catalog";
import {
  normalizeDragDropConfig,
  parseTaskAnswerConfig,
} from "../src/lib/task-answers/config";
import { answerIsCorrect } from "../src/lib/task-answers/grading";
import { parseMcCorrectness } from "../src/lib/task-answers/multiple-choice";
import { renderSafeTask } from "../src/lib/task-answers/public-task";
import type { PlayTask } from "../src/lib/task-answers/types";

test("cleanup migrations preserve populated relationships, constraints and rollback", () => {
  const result = spawnSync(
    "python",
    [resolve(__dirname, "db-cleanup.test.py")],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

function deserialize(row: Record<string, unknown>): PlayTask {
  const json = (key: string) => JSON.parse(String(row[key]));
  const dragDrop = normalizeDragDropConfig(json("dragDropItems"));
  return {
    ...row,
    bodyBlocks: json("bodyBlocks"),
    challengeBlocks: json("challengeBlocks"),
    explanationBlocks: json("explanationBlocks"),
    answers: json("answers"),
    answerConfig: json("answerConfig"),
    answerKey: json("answerKey"),
    dragDropBackground: json("dragDropBackground"),
    dragDropItems: dragDrop.items,
    dragDropTargets: dragDrop.targets,
    dragDropSolutions: dragDrop.solutions,
    dragDropVersion: dragDrop.version,
  } as PlayTask;
}

function responses(task: PlayTask): unknown[] {
  switch (task.answerType) {
    case "multiple_choice": {
      const { mode, ids } = parseMcCorrectness(task.correctAnswerId);
      return [
        mode === "all" ? { selected: ids } : { selected: [ids[0]] },
        ...task.answers.map((answer) => ({ selected: [answer.id] })),
      ];
    }
    case "short_text":
      return [
        { text: task.shortAnswer },
        { text: ` ${String(task.shortAnswer).toUpperCase()} ` },
        { text: "respuesta incorrecta" },
      ];
    case "image_hotspot":
      return (task.answerConfig!.regions as Array<{ id: string }>).map(
        (region) => ({ version: 1, regionId: region.id }),
      );
    case "state_grid":
    case "text_cloze":
      return (task.answerKey!.acceptedAssignments as unknown[]).map(
        (assignment) => ({
          version: 1,
          [task.answerType === "state_grid" ? "cells" : "blanks"]: assignment,
        }),
      );
    case "drag_drop":
      return [
        {
          version: 2,
          placements: Object.fromEntries(
            task.dragDropItems.map((item) => [item.id, item.correctTargetId]),
          ),
        },
        ...task.dragDropSolutions.map((solution) => ({
          placements: solution.placements,
        })),
        {
          placements: Object.fromEntries(
            task.dragDropItems.map((item) => [
              item.id,
              task.dragDropTargets.find(
                (target) => target.id !== item.correctTargetId,
              )?.id ?? "missing",
            ]),
          ),
        },
      ];
    default:
      throw new Error(task.answerType);
  }
}

test("all 43 catalog tasks retain authoring, rendering and grading after database cleanup", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "bebras-db-cleanup-"));
  try {
    const before = loadCatalogTaskData().sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    assert.equal(before.length, 43);
    const input = resolve(directory, "before.json");
    const output = resolve(directory, "after.json");
    writeFileSync(input, JSON.stringify(before));
    const migration = spawnSync(
      "python",
      [resolve(__dirname, "db-cleanup.test.py"), input, output],
      { encoding: "utf8" },
    );
    assert.equal(migration.status, 0, migration.stderr);
    const after = JSON.parse(readFileSync(output, "utf8")) as Array<
      Record<string, unknown>
    >;
    assert.equal(after.length, 43);
    before.forEach((row, i) => {
      const original = deserialize(row);
      const migrated = deserialize(after[i]);
      assert.equal(original.id, migrated.id);
      assert.deepEqual(
        renderSafeTask({ position: i }, migrated),
        renderSafeTask({ position: i }, original),
        original.id,
      );
      const saved = parseTaskAnswerConfig(
        migrated as unknown as Record<string, unknown>,
      );
      const reopened = deserialize({ ...after[i], ...saved });
      assert.deepEqual(
        renderSafeTask({ position: i }, reopened),
        renderSafeTask({ position: i }, original),
        original.id,
      );
      const payloads = responses(original);
      assert.ok(
        payloads.some((payload) => answerIsCorrect(original, payload)),
        `${original.id}: missing correct fixture`,
      );
      for (const payload of [...payloads, {}, { invalid: true }]) {
        const expected = answerIsCorrect(original, payload);
        assert.equal(answerIsCorrect(migrated, payload), expected, original.id);
        assert.equal(
          answerIsCorrect(reopened, payload),
          expected,
          `${original.id}: save`,
        );
      }
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
