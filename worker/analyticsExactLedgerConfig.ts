/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// The Phase 2 gate's config shape, deliberately DEPENDENCY-FREE.
//
// analyticsBreaker.ts imports it, and the Ops Panel (cydi-ops) imports analyticsBreaker.ts
// for its own validation - so anything imported here ends up in the panel bundle. Keeping
// it free of the schema and Durable Object modules means a panel rebuilt against this
// branch learns the `exactLedger` key without dragging AnalyticsDO along.

export type ExactLedgerConfig = {
  /** Phase 2 on/off. Only an explicit `true` enables it. */
  enabled: boolean;
  /** Transition aid: also send the shed-policy sample of telemetry to the DO (same request). Default false. */
  telemetryToDo?: boolean;
};

export const EXACT_LEDGER_OFF: ExactLedgerConfig = { enabled: false };

export function isValidExactLedgerConfig(value: unknown): value is ExactLedgerConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (typeof c.enabled !== "boolean") return false;
  if (c.telemetryToDo !== undefined && typeof c.telemetryToDo !== "boolean") return false;
  return Object.keys(c).every((k) => k === "enabled" || k === "telemetryToDo");
}
