/**
 * Textures.js — every surface in the game is drawn at runtime onto a canvas.
 * No external assets, no loading, and it keeps the whole thing one `npm run dev`
 * away from playable. Value noise + a few passes of grime goes a long way.
 */

import * as THREE from 'three';
import { makeRng } from '../core/Utils.js';

const cache = new Map();

function canvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** Seamless-ish value noise via random splats + blur. */
function noiseInto(ctx, size, rng, count, minR, maxR, alpha, hueFn) {
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(minR, maxR);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = hueFn(rng);
    g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${alpha})`);
    g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    ctx.fillStyle = g;
    // Wrap splats across edges so tiling doesn't show a seam.
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      ctx.save();
      ctx.translate(ox, oy);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function speckle(ctx, size, rng, count, alpha, dark = true) {
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const s = rng.range(0.5, 2.1);
    const v = dark ? rng.int(0, 40) : rng.int(190, 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * rng.range(0.4, 1)})`;
    ctx.fillRect(x, y, s, s);
  }
}

function finish(c, repeat = 1, aniso = 4) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

// ─────────────────────────────────────────────────────────────── surfaces ──

export function asphaltTexture() {
  return cached('asphalt', () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = makeRng(11);
    ctx.fillStyle = '#46474b';
    ctx.fillRect(0, 0, size, size);
    noiseInto(ctx, size, rng, 60, 12, 55, 0.10, (r) => {
      const v = r.int(48, 92);
      return [v, v, v + 2];
    });
    speckle(ctx, size, rng, 2600, 0.5, true);
    speckle(ctx, size, rng, 700, 0.28, false);
    // tar seams / cracks
    ctx.strokeStyle = 'rgba(26,26,28,0.55)';
    for (let i = 0; i < 7; i++) {
      ctx.lineWidth = rng.range(0.6, 2.0);
      ctx.beginPath();
      let x = rng.range(0, size),
        y = rng.range(0, size);
      ctx.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += rng.range(-40, 40);
        y += rng.range(-40, 40);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    return finish(c, 1, 8);
  });
}

export function concreteTexture() {
  return cached('concrete', () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = makeRng(23);
    ctx.fillStyle = '#8b8b85';
    ctx.fillRect(0, 0, size, size);
    noiseInto(ctx, size, rng, 70, 18, 70, 0.13, (r) => {
      const v = r.int(110, 165);
      return [v, v, v - 3];
    });
    noiseInto(ctx, size, rng, 40, 20, 60, 0.10, (r) => {
      const v = r.int(62, 100);
      return [v, v, v];
    });
    speckle(ctx, size, rng, 1600, 0.35, true);
    // panel joints
    ctx.strokeStyle = 'rgba(40,40,40,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
    return finish(c, 1, 8);
  });
}

export function grassTexture() {
  return cached('grass', () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = makeRng(31);
    ctx.fillStyle = '#5b6440';
    ctx.fillRect(0, 0, size, size);
    noiseInto(ctx, size, rng, 90, 14, 55, 0.16, (r) =>
      r.chance(0.45) ? [r.int(96, 130), r.int(110, 145), r.int(58, 82)] : [r.int(64, 88), r.int(72, 96), r.int(40, 56)]
    );
    // dry patches — the lawns stopped being watered a while ago
    noiseInto(ctx, size, rng, 22, 20, 60, 0.22, (r) => [r.int(140, 172), r.int(128, 152), r.int(80, 104)]);
    for (let i = 0; i < 1800; i++) {
      const x = rng.range(0, size),
        y = rng.range(0, size);
      ctx.strokeStyle = `rgba(${rng.int(60, 110)},${rng.int(70, 120)},${rng.int(35, 60)},0.5)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rng.range(-1.5, 1.5), y - rng.range(1.5, 4));
      ctx.stroke();
    }
    return finish(c, 1, 8);
  });
}

export function sidewalkTexture() {
  return cached('sidewalk', () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = makeRng(37);
    ctx.fillStyle = '#96968d';
    ctx.fillRect(0, 0, size, size);
    noiseInto(ctx, size, rng, 50, 20, 70, 0.12, (r) => {
      const v = r.int(120, 175);
      return [v, v, v - 4];
    });
    speckle(ctx, size, rng, 2000, 0.3, true);
    ctx.strokeStyle = 'rgba(45,45,45,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.stroke();
    return finish(c, 1, 8);
  });
}

export function plasterTexture(hex = '#c6bfae', seed = 41) {
  return cached('plaster' + hex + seed, () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = makeRng(seed);
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, size, size);
    noiseInto(ctx, size, rng, 60, 20, 80, 0.09, (r) => {
      const v = r.int(60, 150);
      return [v, v - 4, v - 12];
    });
    speckle(ctx, size, rng, 900, 0.18, true);
    // grime running down from the top
    for (let i = 0; i < 14; i++) {
      const x = rng.range(0, size);
      const g = ctx.createLinearGradient(x, 0, x, size);
      g.addColorStop(0, 'rgba(50,45,38,0.30)');
      g.addColorStop(0.7, 'rgba(50,45,38,0.04)');
      g.addColorStop(1, 'rgba(50,45,38,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, rng.range(3, 14), size);
    }
    return finish(c, 1, 4);
  });
}

export function brickTexture(hex = '#9a5a49', seed = 53) {
  return cached('brick' + hex + seed, () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = makeRng(seed);
    ctx.fillStyle = '#6a6560';
    ctx.fillRect(0, 0, size, size);
    const bh = 16,
      bw = 32;
    for (let row = 0; row < size / bh; row++) {
      const off = row % 2 === 0 ? 0 : bw / 2;
      for (let col = -1; col < size / bw + 1; col++) {
        const x = col * bw + off + 1;
        const y = row * bh + 1;
        const base = new THREE.Color(hex);
        const jitter = rng.range(-0.09, 0.09);
        const r = Math.floor(Math.min(1, Math.max(0, base.r + jitter)) * 255);
        const g = Math.floor(Math.min(1, Math.max(0, base.g + jitter * 0.8)) * 255);
        const b = Math.floor(Math.min(1, Math.max(0, base.b + jitter * 0.8)) * 255);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, bw - 2, bh - 2);
      }
    }
    speckle(ctx, size, rng, 1400, 0.28, true);
    noiseInto(ctx, size, rng, 30, 20, 70, 0.10, () => [30, 28, 26]);
    return finish(c, 1, 4);
  });
}

export function woodTexture(hex = '#8a6c48', seed = 61) {
  return cached('wood' + hex + seed, () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = makeRng(seed);
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 150; i++) {
      const y = rng.range(0, size);
      ctx.strokeStyle = `rgba(${rng.int(20, 70)},${rng.int(15, 55)},${rng.int(10, 40)},${rng.range(0.05, 0.22)})`;
      ctx.lineWidth = rng.range(0.5, 3);
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += 16) {
        ctx.lineTo(x, y + Math.sin((x / size) * Math.PI * 4 + i) * 2.2);
      }
      ctx.stroke();
    }
    // plank separations
    ctx.strokeStyle = 'rgba(20,15,10,0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      const y = (i * size) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
    speckle(ctx, size, rng, 500, 0.2, true);
    return finish(c, 1, 4);
  });
}

export function metalTexture(hex = '#767b80', seed = 71) {
  return cached('metal' + hex + seed, () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = makeRng(seed);
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, size, size);
    noiseInto(ctx, size, rng, 45, 15, 60, 0.10, (r) => {
      const v = r.int(100, 180);
      return [v, v, v + 4];
    });
    // rust blooms
    noiseInto(ctx, size, rng, 26, 8, 34, 0.30, (r) => [r.int(110, 150), r.int(55, 80), r.int(25, 40)]);
    speckle(ctx, size, rng, 1200, 0.25, true);
    return finish(c, 1, 4);
  });
}

export function roofTexture() {
  return cached('roof', () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = makeRng(83);
    ctx.fillStyle = '#55514b';
    ctx.fillRect(0, 0, size, size);
    for (let row = 0; row < 16; row++) {
      for (let col = 0; col < 8; col++) {
        const x = col * 32 + (row % 2 ? 16 : 0);
        const y = row * 16;
        const v = rng.int(60, 96);
        ctx.fillStyle = `rgb(${v},${v - 2},${v - 4})`;
        ctx.fillRect(x, y, 30, 14);
      }
    }
    speckle(ctx, size, rng, 1500, 0.3, true);
    return finish(c, 1, 4);
  });
}

export function tileTexture() {
  return cached('tile', () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = makeRng(97);
    ctx.fillStyle = '#a5a39b';
    ctx.fillRect(0, 0, size, size);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const v = rng.int(150, 190);
        ctx.fillStyle = `rgb(${v},${v - 2},${v - 8})`;
        ctx.fillRect(col * 32 + 1, row * 32 + 1, 30, 30);
      }
    }
    noiseInto(ctx, size, rng, 40, 20, 70, 0.16, () => [40, 38, 34]);
    speckle(ctx, size, rng, 900, 0.25, true);
    return finish(c, 1, 6);
  });
}

export function carpetTexture(hex = '#75604e') {
  return cached('carpet' + hex, () => {
    const size = 128;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = makeRng(103);
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, rng, 4000, 0.3, true);
    speckle(ctx, size, rng, 2000, 0.18, false);
    noiseInto(ctx, size, rng, 20, 15, 50, 0.2, () => [30, 22, 18]);
    return finish(c, 1, 4);
  });
}

export function zombieSkinTexture(tint = [96, 112, 92], seed = 5) {
  return cached('zskin' + tint.join('_') + seed, () => {
    const size = 128;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = makeRng(seed * 17 + 3);
    ctx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
    ctx.fillRect(0, 0, size, size);
    noiseInto(ctx, size, rng, 40, 8, 30, 0.30, (r) => [
      tint[0] + r.int(-30, 20),
      tint[1] + r.int(-30, 20),
      tint[2] + r.int(-25, 20),
    ]);
    // bruising / dried blood
    noiseInto(ctx, size, rng, 14, 4, 16, 0.42, (r) => [r.int(70, 110), r.int(20, 35), r.int(20, 35)]);
    speckle(ctx, size, rng, 500, 0.2, true);
    return finish(c, 1, 2);
  });
}

export function bloodDecalTexture(seed = 1) {
  return cached('blood' + seed, () => {
    const size = 128;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = makeRng(seed * 31 + 7);
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2,
      cy = size / 2;
    const blobs = rng.int(4, 8);
    for (let i = 0; i < blobs; i++) {
      const x = cx + rng.range(-22, 22);
      const y = cy + rng.range(-22, 22);
      const r = rng.range(10, 30);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = rng.int(48, 92);
      g.addColorStop(0, `rgba(${dark},${Math.floor(dark * 0.16)},${Math.floor(dark * 0.14)},0.92)`);
      g.addColorStop(0.7, `rgba(${dark},${Math.floor(dark * 0.16)},${Math.floor(dark * 0.14)},0.55)`);
      g.addColorStop(1, 'rgba(40,8,8,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // spatter
    for (let i = 0; i < 40; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(18, 58);
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      ctx.fillStyle = `rgba(${rng.int(45, 85)},8,8,${rng.range(0.25, 0.8)})`;
      ctx.beginPath();
      ctx.arc(x, y, rng.range(0.8, 3.4), 0, Math.PI * 2);
      ctx.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  });
}

/** Sign / poster canvas — text baked into a texture. */
export function signTexture(text, opts = {}) {
  const key = 'sign' + text + JSON.stringify(opts);
  return cached(key, () => {
    const w = opts.w || 512;
    const h = opts.h || 128;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = opts.bg || '#161a1d';
    ctx.fillRect(0, 0, w, h);
    if (opts.border !== false) {
      ctx.strokeStyle = opts.borderColor || 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, w - 6, h - 6);
    }
    ctx.fillStyle = opts.fg || '#d8cfae';
    ctx.font = `${opts.weight || 'bold'} ${opts.size || 64}px ${opts.font || 'Impact, Haettenschweiler, sans-serif'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = text.split('\n');
    const lh = (opts.size || 64) * 1.08;
    lines.forEach((ln, i) => {
      ctx.fillText(ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * lh);
    });
    // weathering
    const rng = makeRng(text.length * 13 + 5);
    speckle(ctx, Math.max(w, h), rng, 900, 0.16, true);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  });
}

/** Radial soft dot used for particles and light pools. */
export function softDotTexture() {
  return cached('softdot', () => {
    const size = 64;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.42)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  });
}

export function disposeTextureCache() {
  for (const t of cache.values()) t.dispose?.();
  cache.clear();
}
