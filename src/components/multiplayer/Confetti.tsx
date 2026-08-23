import { useEffect, useRef } from "react";

type ConfettiProps = {
  /** "round" is a quick burst; "champion" is bigger and lasts a little longer. */
  variant: "round" | "champion";
};

type Piece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  spin: number;
  angle: number;
  color: string;
  /** Squash factor, animated so a piece reads as a tumbling flake rather than a sliding square. */
  flip: number;
  flipSpeed: number;
};

// CYDI's accent palette. Kept literal rather than read from CSS variables: this
// draws to a canvas, the values must resolve identically in both themes, and
// confetti has no contrast requirement to meet.
const COLORS = ["#e79ac0", "#7fa8d9", "#f5b400", "#7cc9a0", "#a794e8", "#eab088"];

const SETTINGS = {
  round: { count: 70, durationMs: 1500, spread: 0.5, gravity: 0.00055 },
  champion: { count: 150, durationMs: 2600, spread: 0.75, gravity: 0.00045 },
} as const;

/**
 * A short confetti burst, drawn on a single throwaway canvas.
 *
 * Canvas rather than DOM nodes: 150 animated elements is a lot of layout and
 * compositing work on a mid-range phone mid-round, and this has to stay out of
 * the way of the game. One canvas, one rAF loop, and it removes itself the
 * moment the burst is over.
 *
 * Honours prefers-reduced-motion by rendering nothing at all - the winner is
 * always also announced in text, so no information is lost.
 */
export default function Confetti({ variant }: ConfettiProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const config = SETTINGS[variant];
    // Cap the backing store on high-DPI phones: at DPR 3 a full-screen canvas
    // is a lot of pixels to clear 60 times a second for a decorative effect.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Launched from just above the middle, where the winner's name sits.
    const originX = width / 2;
    const originY = height * 0.38;

    const pieces: Piece[] = Array.from({ length: config.count }, () => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * config.spread * 2;
      const speed = 0.28 + Math.random() * 0.42;
      return {
        x: originX + (Math.random() - 0.5) * 40,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 5 + Math.random() * 6,
        spin: (Math.random() - 0.5) * 0.012,
        angle: Math.random() * Math.PI,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        flip: Math.random(),
        flipSpeed: 0.004 + Math.random() * 0.006,
      };
    });

    let raf = 0;
    let start: number | null = null;
    let previous: number | null = null;

    function frame(now: number) {
      if (start === null) start = now;
      // Delta-timed rather than per-frame, so the burst lasts the same wall
      // time on a 60Hz and a 120Hz screen.
      const delta = previous === null ? 16 : Math.min(now - previous, 50);
      previous = now;

      const elapsed = now - start;
      const life = elapsed / config.durationMs;
      if (life >= 1) {
        ctx!.clearRect(0, 0, width, height);
        return;
      }

      ctx!.clearRect(0, 0, width, height);
      // Fade the whole burst out over its last third instead of letting pieces
      // vanish mid-flight.
      ctx!.globalAlpha = life < 0.66 ? 1 : 1 - (life - 0.66) / 0.34;

      for (const p of pieces) {
        p.vy += config.gravity * delta;
        p.x += p.vx * delta;
        p.y += p.vy * delta;
        p.angle += p.spin * delta;
        p.flip += p.flipSpeed * delta;

        const squash = Math.abs(Math.cos(p.flip));
        ctx!.save();
        ctx!.translate(p.x, p.y);
        ctx!.rotate(p.angle);
        ctx!.fillStyle = p.color;
        ctx!.fillRect(-p.size / 2, (-p.size * squash) / 2, p.size, Math.max(1, p.size * squash));
        ctx!.restore();
      }

      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [variant]);

  return <canvas ref={canvasRef} className="mp-confetti" aria-hidden="true" />;
}
