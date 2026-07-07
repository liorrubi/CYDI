import { isSoundEnabled } from "../services/soundSettings";

// All sounds here are synthesized in-browser via the Web Audio API - no
// external audio files, samples, or recordings are used, so there is no
// third-party copyright to worry about.

let audioContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) audioContext = new Ctor();
  return audioContext;
}

/** Creates/resumes the AudioContext as part of a direct user gesture, so later playback isn't blocked by autoplay policies. */
export function primeAudioContext(): void {
  const ctx = getContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}

function playTone(
  ctx: AudioContext,
  frequency: number,
  startTime: number,
  duration: number,
  peakGain: number,
  waveform: OscillatorType = "sine",
) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = waveform;
  oscillator.frequency.value = frequency;

  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.05);
}

/** A short, pleasant two-note "tap" for selecting a game mode on the Home screen. */
export function playSelectSound(): void {
  if (!isSoundEnabled()) return;

  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  playTone(ctx, 659.25, now, 0.12, 0.14); // E5
  playTone(ctx, 880, now + 0.06, 0.16, 0.12); // A5
}

/** A short, cheerful ascending chime for passing a level. */
export function playSuccessSound(): void {
  if (!isSoundEnabled()) return;

  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6 - a simple major arpeggio
  notes.forEach((frequency, i) => playTone(ctx, frequency, now + i * 0.09, 0.3, 0.18));
}

/** A short, gentle (not harsh) two-note dip for a missed attempt - encouraging, not punishing. */
export function playEncourageSound(): void {
  if (!isSoundEnabled()) return;

  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(392, now); // G4
  oscillator.frequency.exponentialRampToValueAtTime(311.13, now + 0.22); // glide down to Eb4

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.16, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.4);
}

/** A crisp, confident two-note rise for committing to a primary action (Done, Save, Confirm). */
export function playPrimarySound(): void {
  if (!isSoundEnabled()) return;

  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  playTone(ctx, 587.33, now, 0.1, 0.13, "triangle"); // D5
  playTone(ctx, 880, now + 0.05, 0.16, 0.13, "triangle"); // A5
}

/** A soft, neutral single click for secondary actions (Cancel, Try Again, Clear). */
export function playSecondarySound(): void {
  if (!isSoundEnabled()) return;

  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  playTone(ctx, 440, ctx.currentTime, 0.08, 0.09, "sine"); // A4
}

/** A firmer, lower-pitched tone for destructive actions (Reset, Delete). */
export function playDangerSound(): void {
  if (!isSoundEnabled()) return;

  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  playTone(ctx, 196, ctx.currentTime, 0.18, 0.13, "square"); // G3
}

/** A quick descending glide for back/navigate-up actions. */
export function playBackSound(): void {
  if (!isSoundEnabled()) return;

  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  playTone(ctx, 659.25, now, 0.08, 0.1, "sine"); // E5
  playTone(ctx, 493.88, now + 0.045, 0.1, 0.1, "sine"); // B4
}

/** A tiny mechanical tick for flipping a switch (sound toggle). */
export function playToggleSound(): void {
  if (!isSoundEnabled()) return;

  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  playTone(ctx, 1046.5, ctx.currentTime, 0.04, 0.07, "square"); // C6
}

/** A light single blip for picking a difficulty chip. */
export function playChipSound(): void {
  if (!isSoundEnabled()) return;

  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  playTone(ctx, 784, ctx.currentTime, 0.07, 0.1, "triangle"); // G5
}

/** A tiny sparkle for peeking at the achievements shortcut. */
export function playAchievementsPeekSound(): void {
  if (!isSoundEnabled()) return;

  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  playTone(ctx, 1318.51, now, 0.06, 0.08, "triangle"); // E6
  playTone(ctx, 1760, now + 0.04, 0.08, 0.08, "triangle"); // A6
}

/** A single bright coin clink for peeking at the coin balance shortcut into the shop. */
export function playCoinsPeekSound(): void {
  if (!isSoundEnabled()) return;

  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  playTone(ctx, 1800, ctx.currentTime, 0.1, 0.1, "triangle");
}

/** A short upward two-note chime for tapping the logo to head back home. */
export function playLogoPeekSound(): void {
  if (!isSoundEnabled()) return;

  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  playTone(ctx, 659.25, now, 0.07, 0.09, "sine"); // E5
  playTone(ctx, 987.77, now + 0.05, 0.09, 0.09, "sine"); // B5
}

/** A plain, gentle two-note blip for opening the instructions/help page. */
export function playInfoPeekSound(): void {
  if (!isSoundEnabled()) return;

  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  playTone(ctx, 587.33, now, 0.08, 0.09, "sine"); // D5
  playTone(ctx, 783.99, now + 0.05, 0.1, 0.08, "sine"); // G5
}

/** A bright, triumphant fanfare for unlocking an achievement - bigger and more special than a plain level-pass chime. */
export function playAchievementUnlockedSound(): void {
  if (!isSoundEnabled()) return;

  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51]; // C5 E5 G5 C6 E6 - full triumphant run
  notes.forEach((frequency, i) => playTone(ctx, frequency, now + i * 0.08, 0.35, 0.2, "triangle"));
  playTone(ctx, 1567.98, now + 0.42, 0.4, 0.14, "sine"); // G6 sparkle on top
}

/** A quick cascade of bright metallic clinks, like coins dropping onto a pile. */
export function playCoinsSound(): void {
  if (!isSoundEnabled()) return;

  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  const clinks = 5;
  for (let i = 0; i < clinks; i++) {
    const startTime = now + i * 0.06 + Math.random() * 0.02;
    const frequency = 1800 - i * 120 + Math.random() * 100;
    playTone(ctx, frequency, startTime, 0.12, 0.1, "triangle");
  }
}

/** A classic "cha-ching" for spending coins in the shop. */
export function playCashRegisterSound(): void {
  if (!isSoundEnabled()) return;

  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  playTone(ctx, 1500, now, 0.15, 0.14, "triangle");
  playTone(ctx, 1900, now + 0.05, 0.15, 0.12, "triangle");
  playTone(ctx, 300, now + 0.18, 0.1, 0.08);
}
