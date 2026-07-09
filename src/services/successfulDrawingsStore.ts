import { getSaveData, updateSaveData } from "./saveStore";

export function getSuccessfulDrawingsCount(): number {
  return getSaveData().progress.successfulDrawings ?? 0;
}

/** Call once per Shape Challenge attempt that passed (score >= passScore) - gates the daily chest and Special Challenge header icons for new players. */
export function recordSuccessfulDrawing(): void {
  updateSaveData((data) => {
    data.progress.successfulDrawings = (data.progress.successfulDrawings ?? 0) + 1;
  });
}
