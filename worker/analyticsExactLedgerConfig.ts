/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// The Phase 2 gate's config shape, deliberately DEPENDENCY-FREE.
//
// analyticsBreaker.ts imports it, and the Ops Panel (cydi-ops) imports analyticsBreaker.ts
// for its own validation - so anything imported here ends up in the panel bundle. Keeping
// it free of the schema and Durable Object modules means a panel rebuilt against this
// branch learns the `exactLedger` key without dragging AnalyticsDO along. (The one import
// below is type-only and erased at build time.)

import type { ShedPolicy } from "./analyticsShedding";

export type ExactLedgerConfig = {
  /** Phase 2 on/off. Only an explicit `true` enables it. */
  enabled: boolean;
  /** Transition aid / rollback: also send a sample of telemetry to the DO (same request). Default false. */
  telemetryToDo?: boolean;
  /**
   * The ROLLBACK sample rate for telemetryToDo, whole percent 0-100 of sheddable telemetry.
   *
   * Only read when `enabled` AND `telemetryToDo` are both true; with telemetryToDo off it
   * has no effect at all (telemetry does not reach the DO). It is live on its own - no
   * monitorOnly, no expiry - so a rollback to telemetryToDo:true stays sampled even when
   * the legacy shed policy has expired or is NORMAL. A live shed policy that keeps LESS
   * (EMERGENCY, a stricter country) still wins: the rate is the stricter of the two.
   * Exact-ledger events are never sampled, and Analytics Engine never reads this.
   * Absent = today's behaviour (the telemetry sample follows the shed policy alone).
   */
  telemetrySamplePercent?: number;
};

export const EXACT_LEDGER_OFF: ExactLedgerConfig = { enabled: false };

const LEDGER_KEYS = new Set(["enabled", "telemetryToDo", "telemetrySamplePercent"]);

/** Whole percent only: AnalyticsDO records the rate as an integer scaling key (normalizeKeepPercent). */
export function isTelemetrySamplePercent(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

export function isValidExactLedgerConfig(value: unknown): value is ExactLedgerConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (typeof c.enabled !== "boolean") return false;
  if (c.telemetryToDo !== undefined && typeof c.telemetryToDo !== "boolean") return false;
  if (c.telemetrySamplePercent !== undefined && !isTelemetrySamplePercent(c.telemetrySamplePercent)) return false;
  return Object.keys(c).every((k) => LEDGER_KEYS.has(k));
}

/**
 * The policy that samples TELEMETRY on its way to the DO when `telemetryToDo` is on, or
 * null for "send all of it" (and record a full keep rate).
 *
 *  - No telemetrySamplePercent: exactly the behaviour before this field existed - the
 *    shed policy's sample when it is enforced, everything when it is NORMAL/monitor-only.
 *  - telemetrySamplePercent set: that rate applies on its own, whatever the shed policy's
 *    mode, expiry or monitorOnly - the point is that a rollback is sampled even after the
 *    legacy shedding lapsed. An ENFORCED shed policy that keeps less still wins, so the
 *    field can only ever reduce what reaches the DO, never re-open what shedding closed.
 *
 * Exact-ledger envelopes never pass through this (they are split off first), and the
 * ALWAYS_PRESERVE / preserveExtra lists stay unsampled exactly as under any shed mode.
 */
export function telemetryToDoPolicy(ledger: ExactLedgerConfig, shed: ShedPolicy): ShedPolicy | null {
  const shedEnforced = shed.mode !== "NORMAL" && !shed.monitorOnly;
  const rate = ledger.telemetrySamplePercent;
  if (rate === undefined) return shedEnforced ? shed : null;
  if (shedEnforced && shed.keepPercent <= rate) return shed;
  if (rate >= 100) return null;
  return { country: shed.country, mode: "ELEVATED", source: "ledger", keepPercent: rate, monitorOnly: false };
}
