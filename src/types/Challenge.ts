import type { Point } from "./Point";

export type DrawingPath = {
  points: Point[];
  canvasWidth: number;
  canvasHeight: number;
  /** Indices in `points` where a new visually-disconnected segment begins (the pointer was lifted and pressed down again elsewhere). */
  breaks?: number[];
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
