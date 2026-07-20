// The note matrix: COLS notes across, ROWS steps down. Each cell holds an
// intensity 0..1 (0 = empty dot, 0.5 = soft/side hit, 1 = bright accent).

import { COLS } from './scales';

export const ROWS = 16;

const EMPTY = 'rgba(212,204,204,'; // #d4cccc
const FILL = 'rgba(217,123,255,'; // #d97bff

interface Layout {
  cell: number;
  ox: number;
  oy: number;
}

export class Grid {
  cells = new Float32Array(ROWS * COLS);
  private layout: Layout = { cell: 0, ox: 0, oy: 0 };

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

  // Integer cell under a canvas point (for the eraser).
  hit(x: number, y: number): { r: number; c: number } | null {
    const p = this.pos(x, y);
    return p ? { r: Math.floor(p.gy), c: Math.floor(p.gx) } : null;
  }

  // Fractional grid coordinates (cell units) under a canvas point.
  pos(x: number, y: number): { gx: number; gy: number } | null {
    const { cell, ox, oy } = this.layout;
    if (cell <= 0) return null;
    const gx = (x - ox) / cell;
    const gy = (y - oy) / cell;
    if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) return null;
    return { gx, gy };
  }

  render(
    ctx: CanvasRenderingContext2D,
    cssW: number,
    cssH: number,
    playhead: number
  ): void {
    const cell = Math.min(cssW / COLS, cssH / ROWS);
    const gw = cell * COLS;
    const gh = cell * ROWS;
    const ox = (cssW - gw) / 2;
    const oy = (cssH - gh) / 2;
    this.layout = { cell, ox, oy };

    ctx.clearRect(0, 0, cssW, cssH);

    // Faint backlight on the current step row.
    if (playhead >= 0) {
      ctx.fillStyle = FILL + '0.06)';
      ctx.fillRect(ox, oy + playhead * cell, gw, cell);
    }

    const dot = Math.max(3, cell * 0.11);
    for (let r = 0; r < ROWS; r++) {
      const onHead = r === playhead;
      for (let c = 0; c < COLS; c++) {
        const v = this.cells[r * COLS + c];
        const cx = ox + c * cell + cell / 2;
        const cy = oy + r * cell + cell / 2;
        if (v <= 0) {
          ctx.fillStyle = EMPTY + (onHead ? '0.85)' : '0.26)');
          ctx.fillRect(cx - dot / 2, cy - dot / 2, dot, dot);
        } else {
          const s = v * 0.64 * cell;
          ctx.fillStyle = FILL + v.toFixed(3) + ')';
          ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
        }
      }
    }
  }
}
