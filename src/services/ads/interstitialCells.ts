// The generic remote multi-cell interstitial experiment (0.57+): which cell an installation is
// in, and the per-session snapshot of the effective cadence / session cap.
//
// Pure decision logic plus one small persisted record. No SDK, no network, no React, and
// deliberately NO import of anything Rewarded: the lane logic in interstitialController.ts stays
// the only place the two ad types meet. interstitialController.ts is the only runtime caller.
//
// What this decides, in order:
//   1. Who takes part: TREATMENT-arm installations only (the control arm keeps baseline
//      accounting - assignArm is untouched), when the remote spec is enabled and valid, and the
//      installation's gate bucket is below rolloutPercentInTreatment. The gate hash is monotonic:
//      raising the percentage only ADDS participants; lowering it or disabling the experiment sends
//      everyone back to baseline at their next session start.
//   2. Which cell: a second, independent hash mapped through the cumulative weights in cell order.
//      The choice is PERSISTED as { version, cellId }: the same experiment version keeps the cell
//      (editing weights within a version never reshuffles existing participants); a new version
//      deliberately re-assigns; a persisted cell that no longer exists in the config means baseline
//      for that version (not a re-draw).
//   3. The session snapshot: computed once per analytics session and persisted, so a remote config
//      change - or a cold start inside the same session - never alters cadence / cap midway.
//
// Neither the installation id nor any bucket value leaves this module toward analytics: the only
// things exported for the next stream are the version, the cell id, the cadence and the cap.

import type { InterstitialStorage } from "./interstitialExperiment";
import { isSecondOpportunityEligible, stableBucket } from "./interstitialExperiment";
import {
  IFX_MAX_CAP,
  IFX_MAX_VERSION,
  INTERSTITIAL_CELL_IDS,
  isEffectiveInterstitialCadence,
  type InterstitialArm,
  type InterstitialCellId,
  type InterstitialExperimentCell,
  type InterstitialExperimentSpec,
} from "./interstitialConfigSchema";

export const IFX_STATE_KEY = "cydi.interstitial.ifx.v1";

/** One salt per experiment version: a new version re-randomizes the gate AND the cell, on purpose. */
const GATE_SALT_PREFIX = "cydi-interstitial-ifx-gate-v";
const CELL_SALT_PREFIX = "cydi-interstitial-ifx-cell-v";

const BUCKETS_PER_PERCENT = 100; // 10,000 buckets / 100

export type CellAssignment = { version: number; cellId: InterstitialCellId };

/** The effective rules of one analytics session. Nothing here identifies an installation. */
export type SessionSnapshot = {
  sessionId: string;
  experimentVersion: number | null;
  cellId: InterstitialCellId | null;
  /** Any integer 5..20 (a cell's cadence need not be in the legacy INTERSTITIAL_CADENCES set). */
  cadence: number;
  cap: number;
};

export type IfxPersistedState = { assignment: CellAssignment | null; snapshot: SessionSnapshot | null };

// --- Assignment ---------------------------------------------------------------------

/** Monotonic in `rolloutPercentInTreatment`: a bigger percentage is a superset of a smaller one. */
export function isInExperimentGate(installationId: string, version: number, rolloutPercentInTreatment: number): boolean {
  return stableBucket(`${GATE_SALT_PREFIX}${version}`, installationId) < Math.floor(rolloutPercentInTreatment) * BUCKETS_PER_PERCENT;
}

/** The cell for this installation under `spec`'s weights, in cell order (a 0-weight cell is never drawn). */
export function pickCell(installationId: string, spec: InterstitialExperimentSpec): InterstitialExperimentCell {
  const position = Math.floor(stableBucket(`${CELL_SALT_PREFIX}${spec.version}`, installationId) / BUCKETS_PER_PERCENT); // 0..99
  let cumulative = 0;
  for (const cell of spec.cells) {
    cumulative += cell.weight;
    if (position < cumulative) return cell;
  }
  // Unreachable for a validated spec (weights sum to 100); the last cell keeps this total anyway.
  return spec.cells[spec.cells.length - 1];
}

/**
 * The cell of an installation that is INSIDE the gate. `persisted` is what was stored before:
 * the same version keeps its cell (or, if that cell was removed, yields no cell - baseline - without
 * a re-draw); any other version draws again. `assignment` is what to store afterwards.
 */
export function resolveExperimentCell(
  installationId: string,
  spec: InterstitialExperimentSpec,
  persisted: CellAssignment | null,
): { cell: InterstitialExperimentCell | null; assignment: CellAssignment } {
  if (persisted !== null && persisted.version === spec.version) {
    return { cell: spec.cells.find((c) => c.id === persisted.cellId) ?? null, assignment: persisted };
  }
  const cell = pickCell(installationId, spec);
  return { cell, assignment: { version: spec.version, cellId: cell.id } };
}

// --- Second opportunity ---------------------------------------------------------------

/**
 * Whether this installation may have a 2nd+ opportunity in the session. For an experiment
 * PARTICIPANT the legacy secondOpportunityRolloutPercent gate is BYPASSED: the cell's own cap is the
 * effective cap, so a cap-2 cell always has both opportunities available (subject to cadence) - the
 * legacy gate (absent = 100) must never silently turn a cap of 2 into 1 for part of a cell.
 * Everyone else keeps the 0.56 rule exactly.
 */
export function isSecondOpportunityAllowed(snapshot: SessionSnapshot, installationId: string | null, secondOpportunityRolloutPercent: number): boolean {
  if (snapshot.cellId !== null) return true;
  return isSecondOpportunityEligible(installationId, secondOpportunityRolloutPercent);
}

// --- Persisted state --------------------------------------------------------------------

const EMPTY: IfxPersistedState = { assignment: null, snapshot: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCellId(value: unknown): value is InterstitialCellId {
  return typeof value === "string" && (INTERSTITIAL_CELL_IDS as readonly string[]).includes(value);
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= IFX_MAX_VERSION;
}

function parseAssignment(value: unknown): CellAssignment | null {
  if (!isRecord(value) || !isVersion(value.version) || !isCellId(value.cellId)) return null;
  return { version: value.version, cellId: value.cellId };
}

function parseSnapshot(value: unknown): SessionSnapshot | null {
  if (!isRecord(value)) return null;
  const { sessionId, experimentVersion, cellId, cadence, cap } = value;
  if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 32) return null;
  if (!isEffectiveInterstitialCadence(cadence) || typeof cap !== "number" || !Number.isInteger(cap) || cap < 1 || cap > IFX_MAX_CAP) return null;
  if (experimentVersion === null && cellId === null) return { sessionId, experimentVersion: null, cellId: null, cadence, cap };
  if (isVersion(experimentVersion) && isCellId(cellId)) return { sessionId, experimentVersion, cellId, cadence, cap };
  return null;
}

/** Tolerant: every field falls back on its own, and a corrupt value can only mean "no assignment / no snapshot". */
export function parseIfxState(raw: string | null): IfxPersistedState {
  if (raw === null) return { ...EMPTY };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY };
  }
  if (!isRecord(parsed)) return { ...EMPTY };
  return { assignment: parseAssignment(parsed.assignment), snapshot: parseSnapshot(parsed.snapshot) };
}

/** Its own storage key - cydi.interstitial.v1 and its tolerant parse are not touched. */
export const localIfxStorage: InterstitialStorage = {
  read() {
    try {
      return localStorage.getItem(IFX_STATE_KEY);
    } catch {
      return null;
    }
  },
  write(value) {
    try {
      localStorage.setItem(IFX_STATE_KEY, value);
      return true;
    } catch {
      return false;
    }
  },
};

// --- Session snapshot -------------------------------------------------------------------

export type SnapshotInput = {
  sessionId: string;
  installationId: string | null;
  arm: InterstitialArm;
  /** The run's frozen base values: exactly what a non-participant gets. */
  base: { cadence: number; cap: number };
  /** The latest valid remote experiment spec, or null (absent, invalid or unanswered = OFF). */
  spec: InterstitialExperimentSpec | null;
};

/**
 * The snapshot of this analytics session: the persisted one if it belongs to `sessionId`, otherwise
 * computed now (and persisted). Non-participants - experiment off or absent, outside the rollout,
 * control arm, no stable installation id - get the base cadence and cap with a null cell.
 */
export function resolveSessionSnapshot(storage: InterstitialStorage, input: SnapshotInput): SessionSnapshot {
  const state = parseIfxState(storage.read());
  const existing = state.snapshot;
  if (existing !== null && existing.sessionId === input.sessionId) {
    // A participant's snapshot is pinned for the whole session. A non-participant's pins only the DECISION
    // ("not in the experiment this session"), not the numbers: its cadence and cap are the run's frozen base
    // values, which the pre-0.57 rule already freezes per app run - so, experiments off, a cold start inside
    // a session under a changed base config behaves exactly as 0.56 did.
    return existing.cellId !== null ? existing : { ...existing, cadence: input.base.cadence, cap: input.base.cap };
  }

  let assignment = state.assignment;
  let cell: InterstitialExperimentCell | null = null;
  const { spec, installationId } = input;
  if (spec !== null && spec.enabled && input.arm === "treatment" && installationId !== null && isInExperimentGate(installationId, spec.version, spec.rolloutPercentInTreatment)) {
    const resolved = resolveExperimentCell(installationId, spec, assignment);
    cell = resolved.cell;
    assignment = resolved.assignment;
  }
  const snapshot: SessionSnapshot =
    cell !== null && spec !== null
      ? { sessionId: input.sessionId, experimentVersion: spec.version, cellId: cell.id, cadence: cell.cadence, cap: cell.cap }
      : { sessionId: input.sessionId, experimentVersion: null, cellId: null, cadence: input.base.cadence, cap: input.base.cap };
  storage.write(JSON.stringify({ assignment, snapshot }));
  return snapshot;
}
