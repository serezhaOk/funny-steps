// The note matrix: COLS notes across, ROWS steps down. Each cell holds an
// intensity 0..1 (0 = empty dot, 0.5 = soft/side hit, 1 = bright accent).
//
// Rendering is a live dot field: round white dots on black, bent by a gentle
// barrel lens, with playing notes blooming — they swell, glow, push their
// neighbours outward like a lens, and throw a radial streak.

import { COLS } from './scales';

export const ROWS = 16;

// Dome strength: the field bulges toward the viewer, so dots spread out and
// grow near the centre and pack tighter toward the rim. Edges stay put.
const LENS_K = 0.19;

// How hard a firing note pushes its neighbours out, and how far that reaches.
const PUSH = 0.62; // in cell units
const PUSH_RADIUS = 2.4; // in cell units
const DECAY = 3.1; // energy falloff per second

// Colour wave: a played note strobes yellow, green, violet in hard steps and
// snaps back to white, and the same flicker spreads outward ring by ring.
const WAVE_RADIUS = 4; // cells
const WAVE_RING_DELAY = 0.05; // seconds per ring
const WAVE_STEP = 0.09; // seconds each colour is held
const MAX_WAVES = 48;

type RGB = [number, number, number];
const WAVE_STOPS: RGB[] = [
  [255, 214, 0], // yellow
  [80, 255, 130], // green
  [176, 107, 255], // violet
];

const WAVE_DURATION = WAVE_STOPS.length * WAVE_STEP;
const WAVE_LIFE = WAVE_DURATION + WAVE_RADIUS * WAVE_RING_DELAY;

/** Hard-stepped colour at 0..1 through the cycle — no blending. */
function waveColor(phase: number): RGB {
  const i = Math.min(
    WAVE_STOPS.length - 1,
    Math.max(0, Math.floor(phase * WAVE_STOPS.length))
  );
  return WAVE_STOPS[i];
}

interface Wave {
  r: number;
  c: number;
  t: number;
  amp: number;
}

interface Layout {
  cell: number;
  ox: number;
  oy: number;
  cx: number;
  cy: number;
  R: number;
}

interface Source {
  x: number;
  y: number;
  e: number;
}

export class Grid {
  cells = new Float32Array(ROWS * COLS);
  /** Per-cell flash energy, 0..1, decaying after each hit. */
  energy = new Float32Array(ROWS * COLS);
  private layout: Layout = { cell: 0, ox: 0, oy: 0, cx: 0, cy: 0, R: 1 };
  private time = 0;
  private glow = new Map<string, HTMLCanvasElement>();
  private waves: Wave[] = [];

  at(r: number, c: number): number {
    return this.cells[r * COLS + c];
  }
  private set(r: number, c: number, v: number): void {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
    this.cells[r * COLS + c] = v;
  }
  private bleed(r: number, c: number, v: number): void {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
    const i = r * COLS + c;
    if (this.cells[i] < v) this.cells[i] = v;
  }

  /** A note just sounded — bloom it and send a colour ripple outward. */
  flash(r: number, c: number, vel: number): void {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
    const i = r * COLS + c;
    this.energy[i] = Math.max(this.energy[i], 0.55 + 0.45 * vel);
    if (this.waves.length >= MAX_WAVES) this.waves.shift();
    this.waves.push({ r, c, t: 0, amp: 0.55 + 0.45 * vel });
  }

  /**
   * Colour tint for a cell: the strongest ripple currently passing through
   * it. Returns null when the cell is plain white.
   */
  private tintAt(r: number, c: number): { rgb: RGB; amp: number } | null {
    let best: { rgb: RGB; amp: number } | null = null;
    for (const w of this.waves) {
      const d = Math.hypot(r - w.r, c - w.c);
      if (d > WAVE_RADIUS) continue;
      const local = w.t - d * WAVE_RING_DELAY;
      if (local <= 0 || local >= WAVE_DURATION) continue;
      const phase = local / WAVE_DURATION;
      // Full-strength while it passes — the flicker cuts, it does not fade.
      // Each colour also strobes within its own slot for a harder blink.
      const sub = (local % WAVE_STEP) / WAVE_STEP;
      const strobe = sub < 0.62 ? 1 : 0.4;
      const amp = w.amp * (1 - (d / (WAVE_RADIUS + 1)) * 0.55) * strobe;
      if (!best || amp > best.amp) best = { rgb: waveColor(phase), amp };
    }
    return best;
  }

  // Organic brush driven by the finger's fractional position. The cell under
  // the finger goes full; neighbours bleed in proportion to how close the
  // finger is to that edge, so a drag leaves a soft directional trail.
  brush(gx: number, gy: number): void {
    const c = Math.floor(gx);
    const r = Math.floor(gy);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
    const fx = gx - c - 0.5; // -0.5..0.5 from cell centre
    const fy = gy - r - 0.5;
    const sx = fx >= 0 ? 1 : -1;
    const sy = fy >= 0 ? 1 : -1;
    const wx = Math.min(1, Math.abs(fx) * 2);
    const wy = Math.min(1, Math.abs(fy) * 2);
    const B = 0.9;
    this.bleed(r, c, 1);
    this.bleed(r, c + sx, wx * B);
    this.bleed(r + sy, c, wy * B);
    this.bleed(r + sy, c + sx, wx * wy * B);
  }

  // Softer symmetric stamp used by the randomizer.
  private stamp(r: number, c: number): void {
    this.bleed(r, c, 1);
    this.bleed(r - 1, c, 0.45);
    this.bleed(r + 1, c, 0.45);
    this.bleed(r, c - 1, 0.45);
    this.bleed(r, c + 1, 0.45);
  }

  // Eraser clears a 2x2 block anchored so it always stays on the grid.
  erase(r: number, c: number): void {
    const r0 = Math.min(r, ROWS - 2);
    const c0 = Math.min(c, COLS - 2);
    this.set(r0, c0, 0);
    this.set(r0 + 1, c0, 0);
    this.set(r0, c0 + 1, 0);
    this.set(r0 + 1, c0 + 1, 0);
  }

  clear(): void {
    this.cells.fill(0);
  }

  // Scatter accents within the scale (columns are already in-key) and tempo.
  random(): void {
    this.clear();
    for (let r = 0; r < ROWS; r++) {
      if (Math.random() < 0.42) {
        this.stamp(r, Math.floor(Math.random() * COLS));
        if (Math.random() < 0.25) {
          this.stamp(r, Math.floor(Math.random() * COLS));
        }
      }
    }
  }

  // ------------------------------------------------------------- geometry --
  /** Grid-space point -> screen point, over the dome. */
  private warp(x: number, y: number): [number, number] {
    const { cx, cy, R } = this.layout;
    const ux = (x - cx) / R;
    const uy = (y - cy) / R;
    const f = 1 + LENS_K * (1 - (ux * ux + uy * uy));
    return [cx + ux * R * f, cy + uy * R * f];
  }

  /** Local scale of the dome at that point — dots swell toward the centre. */
  private warpScale(x: number, y: number): number {
    const { cx, cy, R } = this.layout;
    const ux = (x - cx) / R;
    const uy = (y - cy) / R;
    return 0.72 + 0.62 * Math.max(0, 1 - (ux * ux + uy * uy));
  }

  /** Screen point -> grid-space point (inverse dome, Newton on the radius). */
  private unwarp(x: number, y: number): [number, number] {
    const { cx, cy, R } = this.layout;
    const vx = (x - cx) / R;
    const vy = (y - cy) / R;
    const v = Math.hypot(vx, vy);
    if (v < 1e-6) return [cx, cy];
    // v = t*(1 + K*(1 - t^2))  ->  solve for t
    let t = v;
    for (let i = 0; i < 6; i++) {
      const f = t * (1 + LENS_K) - LENS_K * t * t * t - v;
      const d = 1 + LENS_K - 3 * LENS_K * t * t;
      t -= f / (Math.abs(d) < 1e-4 ? 1e-4 : d);
    }
    const k = t / v;
    return [cx + vx * R * k, cy + vy * R * k];
  }

  // Integer cell under a canvas point (for the eraser).
  hit(x: number, y: number): { r: number; c: number } | null {
    const p = this.pos(x, y);
    return p ? { r: Math.floor(p.gy), c: Math.floor(p.gx) } : null;
  }

  // Fractional grid coordinates (cell units) under a canvas point.
  pos(x: number, y: number): { gx: number; gy: number } | null {
    const { cell, ox, oy } = this.layout;
    if (cell <= 0) return null;
    const [wx, wy] = this.unwarp(x, y);
    const gx = (wx - ox) / cell;
    const gy = (wy - oy) / cell;
    if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) return null;
    return { gx, gy };
  }

  // --------------------------------------------------------------- render --
  /**
   * The dome pushes dots outward, so the flat cell size would overflow the
   * canvas. Shrink it until the warped perimeter fits, cached per viewport.
   */
  private fitCache = { w: 0, h: 0, cell: 0 };

  private fitCell(cssW: number, cssH: number): number {
    const f = this.fitCache;
    if (f.w === cssW && f.h === cssH && f.cell > 0) return f.cell;

    let cell = Math.min(cssW / COLS, cssH / ROWS);
    for (let pass = 0; pass < 3; pass++) {
      const gw = cell * COLS;
      const gh = cell * ROWS;
      const ox = (cssW - gw) / 2;
      const oy = (cssH - gh) / 2;
      this.layout = {
        cell,
        ox,
        oy,
        cx: cssW / 2,
        cy: cssH / 2,
        R: Math.hypot(gw, gh) / 2,
      };
      // Widest warped extent over the perimeter cells.
      let maxX = 0;
      let maxY = 0;
      const probe = (r: number, c: number) => {
        const [sx, sy] = this.warp(ox + (c + 0.5) * cell, oy + (r + 0.5) * cell);
        maxX = Math.max(maxX, Math.abs(sx - cssW / 2));
        maxY = Math.max(maxY, Math.abs(sy - cssH / 2));
      };
      for (let r = 0; r < ROWS; r++) {
        probe(r, 0);
        probe(r, COLS - 1);
      }
      for (let c = 0; c < COLS; c++) {
        probe(0, c);
        probe(ROWS - 1, c);
      }
      const pad = cell * 0.3; // room for the dot + its halo
      const s = Math.min(
        (cssW / 2 - pad) / Math.max(maxX, 1e-3),
        (cssH / 2 - pad) / Math.max(maxY, 1e-3),
        1
      );
      if (s > 0.995) break;
      cell *= s;
    }
    this.fitCache = { w: cssW, h: cssH, cell };
    return cell;
  }

  /** Halo sprite, cached per (quantised) colour so tinted glows stay cheap. */
  private glowSprite(rgb: RGB): HTMLCanvasElement {
    const q = (n: number) => Math.round(n / 32) * 32;
    const [r, g, b] = [q(rgb[0]), q(rgb[1]), q(rgb[2])];
    const key = `${r},${g},${b}`;
    const hit = this.glow.get(key);
    if (hit) return hit;

    const s = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const cx = cv.getContext('2d')!;
    const grad = cx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
    grad.addColorStop(0.25, `rgba(${r},${g},${b},0.32)`);
    grad.addColorStop(0.6, `rgba(${r},${g},${b},0.07)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    cx.fillStyle = grad;
    cx.fillRect(0, 0, s, s);
    this.glow.set(key, cv);
    return cv;
  }

  render(
    ctx: CanvasRenderingContext2D,
    cssW: number,
    cssH: number,
    playhead: number,
    dt: number
  ): void {
    this.time += dt;

    const cell = this.fitCell(cssW, cssH);
    const gw = cell * COLS;
    const gh = cell * ROWS;
    const ox = (cssW - gw) / 2;
    const oy = (cssH - gh) / 2;
    this.layout = {
      cell,
      ox,
      oy,
      cx: cssW / 2,
      cy: cssH / 2,
      R: Math.hypot(gw, gh) / 2,
    };

    // Age the colour ripples and drop the spent ones.
    for (const w of this.waves) w.t += dt;
    if (this.waves.length) {
      this.waves = this.waves.filter((w) => w.t < WAVE_LIFE);
    }

    // Decay flash energy and collect the live sources that bend the field.
    const fade = Math.exp(-DECAY * dt);
    const sources: Source[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const e = this.energy[i];
        if (e <= 0.002) {
          this.energy[i] = 0;
          continue;
        }
        this.energy[i] = e * fade;
        sources.push({
          x: ox + (c + 0.5) * cell,
          y: oy + (r + 0.5) * cell,
          e: this.energy[i],
        });
      }
    }

    ctx.clearRect(0, 0, cssW, cssH);

    const pushR = PUSH_RADIUS * cell;
    const baseDot = Math.max(1.6, cell * 0.075);

    ctx.globalCompositeOperation = 'lighter';

    for (let r = 0; r < ROWS; r++) {
      const onHead = r === playhead;
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const v = this.cells[i];
        const e = this.energy[i];

        let px = ox + (c + 0.5) * cell;
        let py = oy + (r + 0.5) * cell;

        // Nearby blooms shove this dot outward — the lens/jelly feel.
        let swell = 0;
        for (const s of sources) {
          const dx = px - s.x;
          const dy = py - s.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > pushR * pushR) continue;
          const d = Math.sqrt(d2);
          const fall = Math.exp(-(d2 / (pushR * pushR)) * 2.2);
          swell += s.e * fall;
          if (d > 1e-3) {
            const amp = s.e * fall * PUSH * cell;
            px += (dx / d) * amp;
            py += (dy / d) * amp;
          }
        }

        const [sx, sy] = this.warp(px, py);
        const lens = this.warpScale(px, py);

        // Ambient breathing so the field is never quite still.
        const breathe =
          0.86 + 0.14 * Math.sin(this.time * 1.5 + (r * 0.9 + c * 0.6));

        // Colour ripple passing through this cell, blended toward white.
        const tint = this.tintAt(r, c);
        const col: RGB = tint
          ? [
              255 + (tint.rgb[0] - 255) * tint.amp,
              255 + (tint.rgb[1] - 255) * tint.amp,
              255 + (tint.rgb[2] - 255) * tint.amp,
            ]
          : [255, 255, 255];
        const cs = `${col[0] | 0},${col[1] | 0},${col[2] | 0}`;

        if (v <= 0 && e <= 0) {
          const lift = tint ? tint.amp * 0.85 : 0;
          const rad = baseDot * lens * breathe * (1 + lift * 0.6);
          const a = ((onHead ? 0.5 : 0.2) + lift * 0.62) * breathe;
          ctx.fillStyle = `rgba(${cs},${Math.min(1, a)})`;
          ctx.beginPath();
          ctx.arc(sx, sy, rad, 0, Math.PI * 2);
          ctx.fill();
          if (tint && tint.amp > 0.12) {
            const gsz = rad * 5;
            ctx.globalAlpha = Math.min(0.45, tint.amp * 0.5);
            const sprite = this.glowSprite(tint.rgb);
            ctx.drawImage(sprite, sx - gsz / 2, sy - gsz / 2, gsz, gsz);
            ctx.globalAlpha = 1;
          }
          continue;
        }

        // Active dot: size and brightness from intensity + flash energy.
        const pulse = 1 + 0.75 * e;
        const rad =
          (baseDot + v * cell * 0.2) * lens * pulse * (0.97 + 0.03 * breathe);
        const alpha = Math.min(1, 0.4 + 0.45 * v + 0.3 * e);

        // Halo stays tight so a cluster of hits never washes the screen out.
        const gsz = rad * (3 + 2.6 * e);
        ctx.globalAlpha = Math.min(
          0.6,
          0.12 * v + 0.34 * e + 0.05 * swell + (tint ? tint.amp * 0.2 : 0)
        );
        const sprite = this.glowSprite(tint ? tint.rgb : [255, 255, 255]);
        ctx.drawImage(sprite, sx - gsz / 2, sy - gsz / 2, gsz, gsz);
        ctx.globalAlpha = 1;

        // Radial streak away from the centre while the note is hot.
        if (e > 0.05) {
          const { cx, cy } = this.layout;
          const dx = sx - cx;
          const dy = sy - cy;
          const d = Math.hypot(dx, dy) || 1;
          const len = e * cell * (0.4 + 1.2 * (d / this.layout.R));
          const tx = sx + (dx / d) * len;
          const ty = sy + (dy / d) * len;
          const g = ctx.createLinearGradient(sx, sy, tx, ty);
          g.addColorStop(0, `rgba(${cs},${0.34 * e})`);
          g.addColorStop(1, `rgba(${cs},0)`);
          ctx.strokeStyle = g;
          ctx.lineWidth = rad * 1.1;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(tx, ty);
          ctx.stroke();
        }

        ctx.fillStyle = `rgba(${cs},${alpha})`;
        ctx.beginPath();
        ctx.arc(sx, sy, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalCompositeOperation = 'source-over';
  }
}
