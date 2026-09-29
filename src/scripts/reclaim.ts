// reclaim — procedural brutalist overgrowth on a pixel canvas.
// low-res offscreen scene (320x176) drawn once per seed, cheap dynamic
// layer (mist, birds, window flicker) composited per frame. nagomi rules:
// seeded rng, click to place, R regenerate, H hide UI.

export type BlockType = 'slab' | 'tower' | 'stairs' | 'arch' | 'grove' | 'planter';
export type PaletteName = 'control' | 'blood';
export interface Anchor { bx: number; by: number; t: BlockType }
export interface ReclaimParams { seed: number; growth: number; density: number; mist: number; palette: PaletteName }

export const W = 320;
export const H = 176;
export const CELL = 8;
export const GW = W / CELL; // 40
export const GH = H / CELL; // 22
export const GROUND = 150;

interface Pal {
  sky: string[]; sun: string; glow: string; far: string; ground: string; paver: string;
  concrete: string; concreteD: string; concreteL: string; groove: string; stain: string;
  winD: string; winL: string; trunk: string; leaf: string[]; bloom: string;
  mist: string; bird: string; puddle: string;
}

const PALS: Record<PaletteName, Pal> = {
  control: {
    sky: ['#1c2226', '#39454a', '#5d6f6b', '#8a978c'], sun: '#d4d8cc', glow: '#c9d2c4',
    far: '#2c3438', ground: '#22262a', paver: '#2e3438', concrete: '#8b9090',
    concreteD: '#565c5e', concreteL: '#b4bab4', groove: '#6e7474', stain: '#2c3032',
    winD: '#1c2124', winL: '#e0b96a', trunk: '#4a3d33',
    leaf: ['#4f7038', '#6a8f4a', '#33502c'], bloom: '#c8102e',
    mist: '#aeb8ac', bird: '#22262a', puddle: '#5d6f6b',
  },
  blood: {
    sky: ['#0b0608', '#241016', '#5c0f1e', '#8a4a52'], sun: '#c8102e', glow: '#ff2b4a',
    far: '#1c0d12', ground: '#171114', paver: '#20161a', concrete: '#a89f90',
    concreteD: '#5c5148', concreteL: '#d8d0bd', groove: '#7d7264', stain: '#2c1c20',
    winD: '#241a1e', winL: '#ffd9a0', trunk: '#3a2c28',
    leaf: ['#cfc6b4', '#a89f90', '#6e6558'], bloom: '#c8102e',
    mist: '#c9a0a6', bird: '#1c0d12', puddle: '#5c0f1e',
  },
};

const FOOT: Record<BlockType, { w: number; h: number }> = {
  slab: { w: 10, h: 4 }, tower: { w: 5, h: 12 }, stairs: { w: 8, h: 5 },
  arch: { w: 8, h: 7 }, grove: { w: 6, h: 4 }, planter: { w: 4, h: 2 },
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function h2(x: number, y: number, s: number) {
  let h = (x * 374761393 + y * 668265263 + s * 974634211) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function vnoise(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

function hexLerp(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
}

interface Mass { x: number; y: number; w: number; h: number; t: BlockType }
interface LitWin { x: number; y: number; until: number }

export class Reclaim {
  private view: HTMLCanvasElement;
  private vctx: CanvasRenderingContext2D;
  private still: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private anchors: Anchor[] = [];
  private params: ReclaimParams;
  private lit: LitWin[] = [];
  private birds: { x: number; y: number; s: number; o: number }[] = [];
  private flickAt = 0;
  private flickIdx = -1;

  constructor(view: HTMLCanvasElement, params: ReclaimParams) {
    this.view = view;
    const vc = view.getContext('2d');
    if (!vc) throw new Error('no 2d context');
    this.vctx = vc;
    this.still = document.createElement('canvas');
    this.still.width = W; this.still.height = H;
    const sc = this.still.getContext('2d');
    if (!sc) throw new Error('no 2d context');
    this.sctx = sc;
    this.params = { ...params };
    this.birds = [
      { x: 40, y: 42, s: 9, o: 0 }, { x: 190, y: 30, s: 13, o: 2 }, { x: 260, y: 58, s: 7, o: 4 },
    ];
    this.render();
  }

  setParams(p: Partial<ReclaimParams>) {
    Object.assign(this.params, p);
    this.render();
  }

  setAnchors(a: Anchor[]) {
    this.anchors = a.map((v) => ({ ...v }));
    this.render();
  }

  getSeed() { return this.params.seed; }

  private render() {
    const { seed, growth, density, palette } = this.params;
    const P = PALS[palette];
    const rng = mulberry32(seed);
    const R = (a = 1, b?: number) => (b === undefined ? rng() * a : a + rng() * (b - a));
    const RI = (a: number, b: number) => Math.floor(R(a, b + 1));
    const CH = (p: number) => rng() < p;
    const c = this.sctx;
    this.lit = [];

    // — sky: banded dither gradient —
    for (let y = 0; y < H; y++) {
      const t = y / H;
      const seg = Math.min(2, Math.floor(t * 3));
      const ft = t * 3 - seg;
      const [r, g, b] = hexLerp(P.sky[seg], P.sky[seg + 1], ft);
      for (let x = 0; x < W; x++) {
        const d = (BAYER[y & 3][x & 3] / 16 - 0.5) * 14;
        c.fillStyle = `rgb(${r + d | 0},${g + d | 0},${b + d | 0})`;
        c.fillRect(x, y, 1, 1);
      }
    }

    // — sun + glow —
    const sx = W * (0.3 + h2(seed, 7, 3) * 0.4), sy = H * 0.3, sr = 13;
    for (let y = Math.floor(sy - sr * 2.4); y < sy + sr * 2.4; y++) {
      for (let x = Math.floor(sx - sr * 2.4); x < sx + sr * 2.4; x++) {
        const d = Math.hypot(x - sx, y - sy) / sr;
        if (d > 2.4 || x < 0 || y < 0 || x >= W || y >= H) continue;
        if (d <= 1) { c.fillStyle = P.sun; c.fillRect(x, y, 1, 1); }
        else if (CH(0.5 - d * 0.18)) { c.fillStyle = P.glow; c.fillRect(x, y, 1, 1); }
      }
    }

    // — far slabs —
    for (let i = 0; i < 3; i++) {
      const fw = R(50, 110), fh = R(30, 70);
      const fx = R(0, W - fw), fy = GROUND - fh - R(0, 14);
      c.fillStyle = P.far;
      c.fillRect(fx, fy, fw, fh);
      c.fillStyle = P.winD;
      for (let wy = fy + 4; wy < fy + fh - 3; wy += 6)
        for (let wx = fx + 4; wx < fx + fw - 3; wx += 6)
          if (CH(0.25)) c.fillRect(wx, wy, 2, 3);
    }

    // — ground —
    c.fillStyle = P.ground;
    c.fillRect(0, GROUND, W, H - GROUND);
    c.fillStyle = P.paver;
    for (let x = 0; x < W; x += 8) c.fillRect(x, GROUND, 1, H - GROUND);
    c.fillRect(0, GROUND, W, 1);
    // puddle
    const px = R(30, W - 90), pw = R(40, 80);
    c.fillStyle = P.puddle;
    c.fillRect(px, GROUND + 8, pw, 5);
    c.fillStyle = P.sun;
    for (let x = px + 2; x < px + pw - 2; x += 3) if (CH(0.6)) c.fillRect(x, GROUND + 9 + RI(0, 2), 2, 1);

    // — masses: anchors + generated —
    const occ = new Uint8Array(GW * GH);
    const mark = (bx: number, by: number, w: number, h: number) => {
      for (let y = by; y < by + h; y++) for (let x = bx; x < bx + w; x++)
        if (x >= 0 && y >= 0 && x < GW && y < GH) occ[y * GW + x] = 1;
    };
    const free = (bx: number, by: number, w: number, h: number) => {
      if (bx < 0 || by < 2 || bx + w > GW || by + h > GH) return false;
      for (let y = by; y < by + h; y++) for (let x = bx; x < bx + w; x++)
        if (occ[y * GW + x]) return false;
      return true;
    };
    const masses: Mass[] = [];
    const groundRow = Math.floor(GROUND / CELL);

    for (const a of this.anchors) {
      const f = FOOT[a.t];
      const bx = Math.max(0, Math.min(GW - f.w, a.bx));
      const by = Math.max(1, Math.min(groundRow - f.h, a.by));
      if (a.t !== 'grove' && free(bx, by, f.w, f.h)) {
        mark(bx, by, f.w, f.h);
        masses.push({ x: bx * CELL, y: by * CELL, w: f.w * CELL, h: f.h * CELL, t: a.t });
      } else if (a.t === 'grove') {
        masses.push({ x: bx * CELL, y: by * CELL, w: f.w * CELL, h: f.h * CELL, t: a.t });
      }
    }

    // generated masses grow around the anchors
    const extra = Math.round(2 + density * 6);
    for (let i = 0; i < extra * 4 && masses.filter((m) => m.t !== 'grove').length < extra + 2; i++) {
      const types: BlockType[] = ['slab', 'slab', 'tower', 'stairs', 'arch', 'planter'];
      const t = types[RI(0, types.length - 1)];
      const f = FOOT[t];
      let placed = false;
      // 45%: stack a terrace on an existing mass
      if (masses.length && CH(0.45)) {
        const m = masses[RI(0, masses.length - 1)];
        if (m.t !== 'grove') {
          const bw = Math.min(f.w, Math.max(3, Math.floor(m.w / CELL) - RI(0, 2)));
          const bx = Math.floor(m.x / CELL) + RI(0, Math.max(0, Math.floor(m.w / CELL) - bw));
          const by = Math.floor(m.y / CELL) - f.h;
          if (free(bx, by, bw, f.h)) {
            mark(bx, by, bw, f.h);
            masses.push({ x: bx * CELL, y: by * CELL, w: bw * CELL, h: f.h * CELL, t });
            placed = true;
          }
        }
      }
      if (!placed) {
        const bx = RI(0, GW - f.w);
        const by = groundRow - f.h - (CH(0.25) ? RI(0, 3) : 0);
        if (free(bx, by, f.w, f.h)) {
          mark(bx, by, f.w, f.h);
          masses.push({ x: bx * CELL, y: by * CELL, w: f.w * CELL, h: f.h * CELL, t });
        }
      }
    }

    // walkways stitch close tops
    const tops = masses.filter((m) => m.t !== 'grove');
    for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) {
      const a = tops[i], b = tops[j];
      if (Math.abs(a.y - b.y) < 26) {
        const l = Math.min(a.x + a.w, b.x + b.w), r = Math.max(a.x, b.x);
        const gap = r - l;
        if (gap > 4 && gap < 64) {
          const wy = Math.min(a.y, b.y) + 6;
          c.fillStyle = P.concreteD;
          c.fillRect(l, wy, gap, 3);
          c.fillStyle = P.concreteL;
          c.fillRect(l, wy, gap, 1);
        }
      }
    }

    for (const m of masses) {
      if (m.t === 'grove') { this.grove(c, P, rng, m.x + m.w / 2, GROUND, 1 + growth * 2); continue; }
      this.concrete(c, P, rng, m);
      this.stains(c, P, rng, m, seed);
      if (m.t === 'slab' || m.t === 'tower' || m.t === 'arch') this.windows(c, P, rng, m);
      if (m.t === 'stairs') this.stairRails(c, P, m);
      if (m.t === 'arch') this.archCut(c, P, m);
      if (CH(0.3 + growth * 0.5)) this.planterTop(c, P, rng, m);
    }

    // flag on the tallest mass
    const solids = masses.filter((m) => m.t !== 'grove').sort((a, b) => a.y - b.y);
    if (solids.length) {
      const m = solids[0];
      const fx = m.x + Math.floor(m.w / 2);
      c.fillStyle = P.concreteD;
      c.fillRect(fx, m.y - 12, 1, 12);
      c.fillStyle = P.bloom;
      c.fillRect(fx + 1, m.y - 12, 4, 3);
    }

    // — vegetation pass —
    this.vegetation(c, P, rng, masses, seed, growth);

    // — grain —
    for (let i = 0; i < 900; i++) {
      const x = RI(0, W - 1), y = RI(0, H - 1);
      c.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.16)' : 'rgba(232,224,208,0.06)';
      c.fillRect(x, y, 1, 1);
    }
  }

  private concrete(c: CanvasRenderingContext2D, P: Pal, rng: () => number, m: Mass) {
    if (m.t === 'stairs') {
      const steps = 5, sw = Math.floor(m.w / steps);
      for (let i = 0; i < steps; i++) {
        const sh = Math.floor(m.h * ((i + 1) / steps));
        const sx = m.x + i * sw;
        c.fillStyle = P.concrete;
        c.fillRect(sx, m.y + m.h - sh, sw, sh);
        c.fillStyle = P.concreteL;
        c.fillRect(sx, m.y + m.h - sh, sw, 1);
      }
      c.fillStyle = P.concreteD;
      c.fillRect(m.x, m.y + m.h - 1, m.w, 1);
      return;
    }
    c.fillStyle = P.concrete;
    c.fillRect(m.x, m.y, m.w, m.h);
    // board-form lines
    c.fillStyle = P.groove;
    for (let y = m.y + 3; y < m.y + m.h; y += 4) c.fillRect(m.x, y, m.w, 1);
    // speckle
    for (let i = 0; i < (m.w * m.h) / 14; i++) {
      c.fillStyle = rng() < 0.5 ? P.concreteD : P.concreteL;
      c.fillRect(m.x + Math.floor(rng() * m.w), m.y + Math.floor(rng() * m.h), 1, 1);
    }
    // tower grooves
    if (m.t === 'tower') {
      c.fillStyle = P.concreteD;
      for (let x = m.x + 7; x < m.x + m.w - 3; x += 9) c.fillRect(x, m.y, 1, m.h);
    }
    // light top / shadow bottom-right
    c.fillStyle = P.concreteL;
    c.fillRect(m.x, m.y, m.w, 1);
    c.fillStyle = P.concreteD;
    c.fillRect(m.x, m.y + m.h - 1, m.w, 1);
    c.fillRect(m.x + m.w - 1, m.y, 1, m.h);
  }

  private windows(c: CanvasRenderingContext2D, P: Pal, rng: () => number, m: Mass) {
    for (let wy = m.y + 5; wy < m.y + m.h - 4; wy += 7) {
      for (let wx = m.x + 4; wx < m.x + m.w - 4; wx += 6) {
        if (rng() < 0.22) continue; // blank bay
        const lit = rng() < 0.2;
        c.fillStyle = lit ? P.winL : P.winD;
        c.fillRect(wx, wy, 3, 4);
        if (lit) this.lit.push({ x: wx, y: wy, until: 0 });
      }
    }
  }

  private stairRails(c: CanvasRenderingContext2D, P: Pal, m: Mass) {
    c.fillStyle = P.concreteD;
    for (let i = 0; i < m.w; i += 2) {
      const t = i / m.w;
      const y = m.y + m.h - Math.floor(t * m.h) - 4;
      c.fillRect(m.x + i, y, 1, 1);
    }
  }

  private archCut(c: CanvasRenderingContext2D, P: Pal, m: Mass) {
    const aw = Math.floor(m.w * 0.4), ax = m.x + Math.floor((m.w - aw) / 2);
    const ay = m.y + m.h - Math.floor(m.h * 0.62);
    c.fillStyle = '#101314';
    c.fillRect(ax, ay, aw, m.y + m.h - ay);
    c.fillStyle = P.winL;
    c.fillRect(ax + Math.floor(aw / 2) - 1, ay + 3, 2, 8); // lit slit
    c.fillStyle = P.stain;
    c.fillRect(ax, ay, aw, 1);
  }

  private stains(c: CanvasRenderingContext2D, P: Pal, rng: () => number, m: Mass, seed: number) {
    const n = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const sx = m.x + 2 + Math.floor(rng() * (m.w - 4));
      const len = Math.floor(m.h * (0.3 + rng() * 0.6));
      for (let y = 0; y < len && m.y + y < m.y + m.h; y++) {
        if (vnoise(sx * 0.4, y * 0.2, seed + i) > 0.42) {
          c.fillStyle = P.stain;
          c.fillRect(sx, m.y + y, 2, 1);
        }
      }
    }
  }

  private planterTop(c: CanvasRenderingContext2D, P: Pal, rng: () => number, m: Mass) {
    const n = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const px = m.x + 3 + Math.floor(rng() * (m.w - 8));
      c.fillStyle = P.concreteD;
      c.fillRect(px, m.y - 4, 5, 4);
      this.shrub(c, P, rng, px + 2, m.y - 5, 3);
    }
  }

  private shrub(c: CanvasRenderingContext2D, P: Pal, rng: () => number, x: number, y: number, r: number) {
    for (let i = 0; i < r * 5; i++) {
      const a = rng() * Math.PI * 2, d = rng() * r;
      c.fillStyle = P.leaf[Math.floor(rng() * P.leaf.length)];
      c.fillRect(Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d * 0.7), 2, 2);
    }
    if (rng() < 0.5) { c.fillStyle = P.bloom; c.fillRect(x, y - 1, 1, 1); }
  }

  private tree(c: CanvasRenderingContext2D, P: Pal, rng: () => number, x: number, gy: number, s: number) {
    const h = Math.floor((15 + rng() * 16) * s);
    c.fillStyle = P.trunk;
    const tx = Math.round(x);
    c.fillRect(tx, gy - h, 2, h);
    // branches
    const nb = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < nb; i++) {
      const by = gy - h + Math.floor(rng() * h * 0.6);
      const dir = rng() < 0.5 ? -1 : 1, len = 4 + Math.floor(rng() * 6 * s);
      for (let k = 0; k < len; k++) c.fillRect(tx + dir * k, by - Math.floor(k * 0.5), 1, 1);
      this.shrub(c, P, rng, tx + dir * len, by - Math.floor(len * 0.5), Math.floor(3 * s) + 2);
    }
    this.shrub(c, P, rng, tx + 1, gy - h - 2, Math.floor(4 * s) + 3);
  }

  private grove(c: CanvasRenderingContext2D, P: Pal, rng: () => number, cx: number, gy: number, s: number) {
    const n = 2 + Math.floor(rng() * 2 * s);
    for (let i = 0; i < n; i++) this.tree(c, P, rng, cx - 10 + rng() * 20, gy, 0.7 + rng() * 0.6 * s);
    for (let i = 0; i < 4; i++) this.shrub(c, P, rng, cx - 12 + rng() * 24, gy - 2, 2);
  }

  private vegetation(c: CanvasRenderingContext2D, P: Pal, rng: () => number, masses: Mass[], seed: number, g: number) {
    // ivy strands off slab edges
    for (const m of masses) {
      if (m.t === 'grove') continue;
      const strands = Math.floor(g * 14 * (m.w / 60));
      for (let i = 0; i < strands; i++) {
        let x = m.x + Math.floor(rng() * m.w);
        let y = m.y;
        const len = 5 + Math.floor(rng() * (10 + g * 26));
        for (let k = 0; k < len; k++) {
          x += Math.floor(rng() * 3) - 1;
          y += rng() < 0.75 ? 1 : 0;
          if (x < m.x || x >= m.x + m.w || y >= GROUND + 8) break;
          c.fillStyle = P.leaf[Math.floor(rng() * P.leaf.length)];
          c.fillRect(x, y, rng() < 0.3 ? 2 : 1, 1);
          if (k % 5 === 0 && rng() < 0.5) { c.fillStyle = P.bloom; c.fillRect(x, y, 1, 1); }
        }
      }
      // moss speckle on faces
      const dens = g * 0.05;
      for (let y = m.y; y < m.y + m.h; y += 2) for (let x = m.x; x < m.x + m.w; x += 2) {
        if (vnoise(x * 0.15, y * 0.15, seed) > 1 - dens && rng() < 0.6) {
          c.fillStyle = P.leaf[Math.floor(rng() * P.leaf.length)];
          c.fillRect(x, y, 1, 1);
        }
      }
    }
    // free trees + ground shrubs
    const trees = 1 + Math.round(g * 3);
    for (let i = 0; i < trees; i++) this.tree(c, P, rng, 12 + rng() * (W - 24), GROUND + 2, 0.8 + rng() * 0.9);
    for (let i = 0; i < g * 26; i++) this.shrub(c, P, rng, rng() * W, GROUND + 1 + rng() * 6, 2);
  }

  frame(t: number) {
    const c = this.vctx;
    const P = PALS[this.params.palette];
    c.imageSmoothingEnabled = false;
    c.drawImage(this.still, 0, 0);

    // window flicker
    if (this.lit.length && t > this.flickAt) {
      this.flickAt = t + 1800 + Math.random() * 3200;
      this.flickIdx = Math.floor(Math.random() * this.lit.length);
      const w = this.lit[this.flickIdx];
      w.until = t + 160;
    }
    if (this.flickIdx >= 0 && this.lit[this.flickIdx]) {
      const w = this.lit[this.flickIdx];
      if (t < w.until) { c.fillStyle = P.winD; c.fillRect(w.x, w.y, 3, 4); }
      else this.flickIdx = -1;
    }

    // drifting mist bands
    const bands = 2 + Math.round(this.params.mist * 2);
    c.fillStyle = P.mist;
    for (let b = 0; b < bands; b++) {
      const yb = 52 + b * 30 + Math.sin(t / 2400 + b * 2) * 4;
      const off = Math.floor(t / 90 + b * 37) % 12;
      for (let y = 0; y < 7; y++) {
        for (let x = -12; x < W + 12; x += 3) {
          if (((x + off + y * 2) % 12) < 5) {
            c.globalAlpha = 0.1 + this.params.mist * 0.08;
            c.fillRect(x, Math.round(yb + y), 2, 1);
          }
        }
      }
      c.globalAlpha = 1;
    }

    // birds
    c.fillStyle = P.bird;
    for (const bd of this.birds) {
      const x = ((bd.x + (t / 1000) * bd.s + W + 12) % (W + 24)) - 12;
      const y = bd.y + Math.sin(t / 700 + bd.o) * 3;
      const f = Math.sin(t / 130 + bd.o) > 0 ? 1 : 0;
      c.fillRect(Math.round(x) - 1, Math.round(y), 1, 1);
      c.fillRect(Math.round(x) + 1, Math.round(y), 1, 1);
      c.fillRect(Math.round(x), Math.round(y) - f, 1, 1);
    }
  }

  snapshot(scale = 4): string {
    const out = document.createElement('canvas');
    out.width = W * scale; out.height = H * scale;
    const o = out.getContext('2d');
    if (!o) return '';
    o.imageSmoothingEnabled = false;
    o.drawImage(this.view, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }
}
