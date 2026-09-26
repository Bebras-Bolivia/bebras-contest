export const difficultyStyles: Record<
  string,
  { label: string; className: string; rank: number }
> = {
  easy: {
    label: "Fácil",
    className: "bg-difficulty-easy text-difficulty-easy-foreground",
    rank: 0,
  },
  medium: {
    label: "Medio",
    className: "bg-difficulty-medium text-difficulty-medium-foreground",
    rank: 1,
  },
  hard: {
    label: "Difícil",
    className: "bg-difficulty-hard text-difficulty-hard-foreground",
    rank: 2,
  },
};
