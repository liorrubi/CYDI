// Rewarded Ink Trial (0.57.1) - the pure rules. No storage, no React, no SDK, no config fetch: the store
// (services/inkTrialStore.ts) and the Classic Result lane (services/ads/resultAdLane.ts) feed these functions
// their state, so every rule below is unit-testable on its own.
//
// What a Trial is: a completed rewarded ad grants TRIAL_PLAYS plays with one premium Shop ink, as a temporary
// overlay - never permanent ownership, never written into the Shop's unlocked list or the selected colour. The
// Shop price and permanent ownership stay the only source of truth for owning an ink.

import type { InkRotationSlot } from "../services/ads/inkTrialConfigSchema";
import { INK_TRIAL_INKS, type InkTrialInk } from "../services/analyticsSchema";

/** A Trial is worth this many plays (Classic: one completed scored play; Play Together / 2 Players: one completed session). */
export const TRIAL_PLAYS = 5;

/**
 * active    - granted, plays left.
 * exhausted - every play used (the Try -> Buy CTA follows once).
 * closed    - bought permanently while the Trial was still active (ownership wins, nothing left to consume).
 * Any record at all = this ink's Trial was granted once, so it is never offered or granted again.
 */
export type InkTrialStatus = "active" | "exhausted" | "closed";
export type InkCtaOutcome = "purchased" | "declined" | "dismissed";
export type InkTrialRecord = {
  status: InkTrialStatus;
  usesLeft: number;
  started: boolean;
  ctaShown: boolean;
  ctaOutcome: InkCtaOutcome | null;
};
export type InkTrials = Partial<Record<InkTrialInk, InkTrialRecord>>;

export type IsOwned = (ink: InkTrialInk) => boolean;

/** The Trial that is running now (permanent ownership ends it on the spot), or null. At most one exists. */
export function activeTrial(trials: InkTrials, isOwned: IsOwned): { ink: InkTrialInk; usesLeft: number } | null {
  for (const ink of INK_TRIAL_INKS) {
    const record = trials[ink];
    if (record && record.status === "active" && record.usesLeft > 0 && !isOwned(ink)) return { ink, usesLeft: record.usesLeft };
  }
  return null;
}

/**
 * The ink the next offer is for, or null (= no Ink offer). Rainbow first, then Diamond Blue:
 *  - none while another Trial is still active (no conflicting Trials);
 *  - an ink the player owns is skipped;
 *  - an ink whose Trial was EVER granted is skipped (active, exhausted or closed) - one Trial per ink, ever.
 * Declining an offer records nothing, so a declined ink stays eligible for the next opportunity.
 */
export function nextEligibleInk(trials: InkTrials, isOwned: IsOwned): InkTrialInk | null {
  if (activeTrial(trials, isOwned) !== null) return null;
  for (const ink of INK_TRIAL_INKS) {
    if (isOwned(ink)) continue;
    if (trials[ink] !== undefined) continue;
    return ink;
  }
  return null;
}

/** The ink whose Try -> Buy CTA is still owed: Trial used up, CTA never shown, not owned (buying it already answered the question). */
export function pendingCtaInk(trials: InkTrials, isOwned: IsOwned): InkTrialInk | null {
  for (const ink of INK_TRIAL_INKS) {
    const record = trials[ink];
    if (record && record.status === "exhausted" && !record.ctaShown && !isOwned(ink)) return ink;
  }
  return null;
}

// --- Classic coin/ink rotation -------------------------------------------------------------------

/** A pattern's identity: a changed pattern restarts the rotation at its first slot. */
export function rotationKey(pattern: readonly InkRotationSlot[]): string {
  return pattern.join(",");
}

/** What the rotation schedules for the next RENDERED Classic Rewarded offer. */
export function scheduledSlot(pattern: readonly InkRotationSlot[], pointer: number, storedKey: string): InkRotationSlot {
  if (pattern.length === 0) return "coin";
  const index = storedKey === rotationKey(pattern) ? pointer : 0;
  return pattern[((index % pattern.length) + pattern.length) % pattern.length];
}

/**
 * The pointer after one RENDERED offer (coin, ink, or an ink slot that fell back to coin - all advance). A pending
 * opportunity (interstitial claimed the lane, no coins, no ad capability, not due) never reaches this.
 */
export function advancedPointer(pattern: readonly InkRotationSlot[], pointer: number, storedKey: string): { pointer: number; key: string } {
  const key = rotationKey(pattern);
  const from = storedKey === key ? pointer : 0;
  // Bounded: the pointer only ever matters modulo the pattern length.
  return { pointer: (from + 1) % Math.max(1, pattern.length), key };
}

export type ClassicRewardedContent =
  | { kind: "coin"; rotationSlot?: InkRotationSlot }
  | { kind: "ink"; ink: InkTrialInk; rotationSlot: InkRotationSlot };

/**
 * One legal Classic Rewarded opportunity's content. With Ink off on Classic the rotation is not consulted at all
 * (exactly the 0.57 coin offer, no rotationSlot). With Ink on: a scheduled coin is coin even when an ink is
 * eligible; a scheduled ink is the eligible ink, or - when none is eligible - the coin offer (the fallback).
 */
export function chooseClassicContent(input: { inkOn: boolean; scheduled: InkRotationSlot; eligibleInk: InkTrialInk | null }): ClassicRewardedContent {
  if (!input.inkOn) return { kind: "coin" };
  if (input.scheduled === "ink" && input.eligibleInk !== null) return { kind: "ink", ink: input.eligibleInk, rotationSlot: "ink" };
  return { kind: "coin", rotationSlot: input.scheduled };
}
