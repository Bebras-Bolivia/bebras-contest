import type { DragDropSolution } from "../drag-drop-grading";

export type DragDropItem = {
  id: string;
  label: unknown;
  image: unknown;
  equivalenceKey?: string;
  widthPercent: number;
  correctTargetId: string;
};

export type DragDropTarget = {
  id: string;
  x: number;
  y: number;
  snapRadius: number;
};

export type DragDropConfig = {
  version: 1 | 2;
  items: DragDropItem[];
  targets: DragDropTarget[];
  /** Acomodos correctos además del que describen los `correctTargetId`. */
  solutions: DragDropSolution[];
};

export type PlayTask = {
  id: string;
  title: string;
  country?: string | null;
  bodyBlocks: unknown;
  challengeBlocks: unknown;
  answerType: string;
  answerConfig?: Record<string, unknown>;
  answerKey?: Record<string, unknown>;
  multipleChoiceOrderMode: string;
  answers: Array<{ id: unknown; blocks: unknown }>;
  correctAnswerId: string;
  shortAnswer: unknown;
  dragDropBackground: unknown;
  dragDropItems: DragDropItem[];
  dragDropTargets: DragDropTarget[];
  dragDropSolutions: DragDropSolution[];
  dragDropVersion: 1 | 2;
  explanationBlocks?: unknown;
};
