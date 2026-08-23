/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
// Short, gentle haptic taps for the three Play Together moments that deserve
// one: the countdown ending, winning a round, and being crowned champion.
//
// Android only, and deliberately so. `navigator.vibrate` exists in the WebView
// but was measured returning false there - Android needs the VIBRATE
// permission, which the plugin's manifest merge supplies, and it will not fire
// outside a user gesture anyway (a round result is not one). On the web the
// API is inconsistently supported and widely ignored, so this is simply a
// no-op: nothing about the game depends on a buzz.
//
// Every call is fire-and-forget and can never reject into a caller. A missing
// vibration motor, a silent-mode policy or an OS that refuses is not an error
// worth surfacing - or worth interrupting a round for.
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";

function isSupported(): boolean {
  return Capacitor.isNativePlatform();
}

function impact(style: ImpactStyle): void {
  if (!isSupported()) return;
  try {
    void Haptics.impact({ style }).catch(() => {});
  } catch {
    // Plugin missing or bridge unavailable - never break a round over a buzz.
  }
}

/** The moment the countdown hits zero and drawing opens. A light tick, not a jolt - it fires every single round. */
export function hapticRoundStart(): void {
  impact(ImpactStyle.Light);
}

/** Won the round. One clear tap. */
export function hapticRoundWin(): void {
  impact(ImpactStyle.Medium);
}

/**
 * Crowned champion at the end of the game. A short double tap, so it reads as
 * bigger than a round win without turning into a rumble.
 */
export function hapticChampion(): void {
  if (!isSupported()) return;
  impact(ImpactStyle.Heavy);
  window.setTimeout(() => impact(ImpactStyle.Heavy), 140);
}
