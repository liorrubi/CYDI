import { useEffect, useState } from "react";
import { subscribeInkTrial } from "../services/inkTrialStore";

/** Re-renders the caller after every Ink Trial store write (a consumed play, a grant, a purchase, an ink switch). */
export function useInkTrialRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => subscribeInkTrial(() => setRevision((r) => r + 1)), []);
  return revision;
}
