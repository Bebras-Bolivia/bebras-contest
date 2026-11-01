import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dragDropPieceKey,
  dragDropSignature,
  isDragDropAnswerCorrect,
  type GradableDragDropItem,
} from "./drag-drop-grading";

const items: GradableDragDropItem[] = [
  {
    id: "b1",
    label: "B",
    image: { url: "/b-one.png" },
    equivalenceKey: "letter-b",
    correctTargetId: "position-2",
  },
  {
    id: "b2",
    label: "B",
    image: { url: "/b-two.png" },
    equivalenceKey: "letter-b",
    correctTargetId: "position-5",
  },
  {
    id: "a",
    label: "A",
    image: { url: "/a.png" },
    correctTargetId: "position-9",
  },
];
const primary = { b1: "position-2", b2: "position-5", a: "position-9" };
const alternatives = [
  {
    id: "other-path",
    placements: { b1: "position-1", b2: "position-8", a: "position-12" },
  },
];

test("accepts complete configurations on different subsets of destinations", () => {
  assert.equal(isDragDropAnswerCorrect(items, alternatives, primary), true);
  assert.equal(
    isDragDropAnswerCorrect(items, alternatives, alternatives[0].placements),
    true,
  );
  assert.equal(
    isDragDropAnswerCorrect(items, alternatives, {
      b1: "position-1",
      b2: "position-5",
      a: "position-12",
    }),
    false,
  );
});

test("explicit equivalence accepts swaps even when image files differ", () => {
  assert.equal(
    isDragDropAnswerCorrect(items, alternatives, {
      b1: "position-5",
      b2: "position-2",
      a: "position-9",
    }),
    true,
  );
  assert.equal(
    isDragDropAnswerCorrect(items, alternatives, {
      b1: "position-8",
      b2: "position-1",
      a: "position-12",
    }),
    true,
  );
  assert.equal(
    isDragDropAnswerCorrect(items, alternatives, {
      b1: "position-9",
      b2: "position-5",
      a: "position-2",
    }),
    false,
  );
});

test("empty, partial, colliding and unknown-item configurations are invalid", () => {
  assert.equal(
    isDragDropAnswerCorrect(items, alternatives, { b1: "position-2" }),
    false,
  );
  const invalidPlacements: Record<string, string>[] = [
    {},
    { ...primary, b2: "position-2" },
    { ...primary, extra: "position-4" },
  ];
  for (const placements of invalidPlacements) {
    assert.equal(dragDropSignature(items, placements), null);
    assert.equal(
      isDragDropAnswerCorrect(items, alternatives, placements),
      false,
    );
  }
  assert.equal(isDragDropAnswerCorrect([], [], {}), false);
});

test("legacy image, label and ID equivalence stays unchanged without a key", () => {
  const item = { id: "one", label: " B ", correctTargetId: "target" };
  assert.equal(dragDropPieceKey(item), "label:B");
  assert.equal(dragDropPieceKey({ ...item, label: "" }), "id:one");
  assert.equal(
    dragDropPieceKey({ ...item, image: { url: " /piece.png " } }),
    "img:/piece.png",
  );
  assert.equal(
    dragDropPieceKey({ ...item, equivalenceKey: " class-b " }),
    "equivalent:class-b",
  );
  assert.equal(dragDropPieceKey({ ...item, equivalenceKey: "  " }), "label:B");
  const legacy = items.map((item) => ({ ...item, equivalenceKey: undefined }));
  assert.equal(
    isDragDropAnswerCorrect(legacy, [], {
      b1: "position-5",
      b2: "position-2",
      a: "position-9",
    }),
    false,
  );
});

test("signatures cannot collide through control characters in keys", () => {
  const item = { id: "one", correctTargetId: "target" };
  assert.notEqual(
    dragDropSignature([{ ...item, label: "x" }], { one: "a\u0000label:b" }),
    dragDropSignature([{ ...item, label: "b\u0000label:x" }], { one: "a" }),
  );
});
