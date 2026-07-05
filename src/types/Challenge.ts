import type { Point } from "./Point";

export type DrawingPath = {
  points: Point[];
  canvasWidth: number;
  canvasHeight: number;
};

export type Challenge = {
  id: string;
  name: string;
  target: DrawingPath;
  createdAt: number;
  updatedAt: number;
  personalBest?: number;
  attempts: number;
};
