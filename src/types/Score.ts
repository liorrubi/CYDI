export type ScoreBreakdown = {
  total: number;
  shapeMatch: number;
  coverage: number;
  smoothness: number;
  scale: number;
  closure?: number;
  message: string;
};
