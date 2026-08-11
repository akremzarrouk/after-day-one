/**
 * Builders.js — procedural mesh factories.
 *
 * Every prop in the game is assembled here from boxes and cylinders. The
 * Builder owns both the scene graph and the collision world so a single call
 * puts a thing in the world *and* makes it solid.
 */

import * as THREE from 'three';
import {
  asphaltTexture,
  brickTexture,
  concreteTexture,
  metalTexture,
  plasterTexture,
  roofTexture,
  signTexture,
  tileTexture,
  woodTexture,
  carpetTexture,
  bloodDecalTexture,
} from './Textures.js';

const _box = new THREE.BoxGeometry(1, 1, 1);
const _cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const _cylLow = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
const _sphere = new THREE.SphereGeometry(0.5, 10, 8);
const _plane = new THREE.PlaneGeometry(1, 1);
const _cone = new THREE.ConeGeometry(0.5, 1, 8);

export const GEO = { box: _box, cyl: _cyl, cylLow: _cylLow, sphere: _sphere, plane: _plane, cone: _cone };

/** Shared material bank — created lazily so textures build once. */
export function makeMaterials() {
  const std = (opts) => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.02, ...opts });
  const M = {
    asphalt: std({ map: asphaltTexture(), roughness: 0.98 }),
    concrete: std({ map: concreteTexture(), roughness: 0.95 }),
    sidewalk: std({ map: concreteTexture(), color: 0xbdb9ae, roughness: 0.95 }),
    grass: std({ map: null, color: 0x5b6440, roughness: 1 }),
    dirt: std({ color: 0x6a5c4a, roughness: 1 }),
    roof: std({ map: roofTexture(), roughness: 0.95 }),
    tile: std({ map: tileTexture(), roughness: 0.7 }),
    carpet: std({ map: carpetTexture(), roughness: 1 }),
    wood: std({ map: woodTexture(), roughness: 0.9 }),
    woodDark: std({ map: woodTexture('#63492f', 67), roughness: 0.92 }),
    plank: std({ map: woodTexture('#a3854f', 73), roughness: 0.88 }),
    metal: std({ map: metalTexture(), roughness: 0.55, metalness: 0.5 }),
    metalDark: std({ map: metalTexture('#565b60', 79), roughness: 0.6, metalness: 0.45 }),
    rust: std({ map: metalTexture('#8a5f42', 89), roughness: 0.9, metalness: 0.2 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x22303a,
      roughness: 0.12,
      metalness: 0.1,
      transparent: true,
      opacity: 0.45,
    }),
    glassBroken: new THREE.MeshStandardMaterial({
      color: 0x1b2429,
      roughness: 0.5,
      transparent: true,
      opacity: 0.22,
    }),
    plasterA: std({ map: plasterTexture('#c9bfa8', 41) }),
    plasterB: std({ map: plasterTexture('#aeb6b8', 43) }),
    plasterC: std({ map: plasterTexture('#d3c7ae', 47) }),
    brickA: std({ map: brickTexture('#9c5a49', 53) }),
    brickB: std({ map: brickTexture('#a48475', 59) }),
    fabricRed: std({ color: 0x8a3a33, roughness: 1 }),
    fabricBlue: std({ color: 0x3d536f, roughness: 1 }),
    fabricGreen: std({ color: 0x516346, roughness: 1 }),
    plasticWhite: std({ color: 0xcecac1, roughness: 0.6 }),
    plasticRed: std({ color: 0x8c2f28, roughness: 0.6 }),
    plasticBlue: std({ color: 0x27506e, roughness: 0.6 }),
    plasticYellow: std({ color: 0xb08a24, roughness: 0.6 }),
    police: std({ color: 0x2b384a, roughness: 0.5, metalness: 0.35 }),
    policeWhite: std({ color: 0xc8c8c4, roughness: 0.5, metalness: 0.3 }),
    ambulance: std({ color: 0xd6d3c8, roughness: 0.5, metalness: 0.3 }),
    foliage: std({ color: 0x4a5c2c, roughness: 1 }),
    foliageDry: std({ color: 0x7a6a35, roughness: 1 }),
    bark: std({ color: 0x52412f, roughness: 1 }),
    black: std({ color: 0x1a1c1f, roughness: 0.9 }),
    tarp: std({ color: 0x4c5c4d, roughness: 1, side: THREE.DoubleSide }),
    tarpBlue: std({ color: 0x3a5673, roughness: 1, side: THREE.DoubleSide }),
    emissiveRed: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
    emissiveBlue: new THREE.MeshBasicMaterial({ color: 0x2a6cff }),
    emissiveWarm: new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
  };

  // Tile the big ground materials.
  M.asphalt.map.repeat.set(28, 28);
  M.concrete.map.repeat.set(10, 10);
  M.sidewalk.map.repeat.set(8, 8);
  return M;
}

export class Builder {
  /**
   * @param {THREE.Object3D} root  scene root to attach to
   * @param {CollisionWorld} col   collision world
   * @param {object} mats          material bank
   */
  constructor(root, col, mats) {
    this.root = root;
    this.col = col;
    this.M = mats;
  }

  /** Core primitive: a box mesh, optionally solid. */
  box(x, y, z, sx, sy, sz, mat, opts = {}) {
    const m = new THREE.Mesh(_box, mat);
    m.position.set(x, y + sy / 2, z);
    m.scale.set(sx, sy, sz);
    if (opts.rotY) m.rotation.y = opts.rotY;
    m.castShadow = opts.cast !== false && sy > 0.25;
    m.receiveShadow = opts.receive !== false;
    (opts.parent || this.root).add(m);

    if (opts.solid !== false) {
      if (opts.rotY) {
        // Approximate a rotated box with its AABB — fine for props.
        const c = Math.abs(Math.cos(opts.rotY)),
          s = Math.abs(Math.sin(opts.rotY));
        const w = sx * c + sz * s;
        const d = sx * s + sz * c;
        this.col.addCentered(x, z, w, d, y, y + sy, {
          opaque: opts.opaque !== false,
          platform: opts.platform === true,
          tag: opts.tag,
          ref: opts.ref,
        });
      } else {
        m.userData.box = this.col.addCentered(x, z, sx, sz, y, y + sy, {
          opaque: opts.opaque !== false,
          platform: opts.platform === true,
          tag: opts.tag,
          ref: opts.ref,
        });
      }
    }
    return m;
  }

  /** Non-solid decorative box. */
  deco(x, y, z, sx, sy, sz, mat, opts = {}) {
    return this.box(x, y, z, sx, sy, sz, mat, { ...opts, solid: false });
  }

  cyl(x, y, z, r, h, mat, opts = {}) {
    const m = new THREE.Mesh(opts.low ? _cylLow : _cyl, mat);
    m.position.set(x, y + h / 2, z);
    m.scale.set(r * 2, h, r * 2);
    if (opts.rotX) m.rotation.x = opts.rotX;
    if (opts.rotZ) m.rotation.z = opts.rotZ;
    if (opts.rotY) m.rotation.y = opts.rotY;
    m.castShadow = opts.cast !== false;
    m.receiveShadow = true;
    (opts.parent || this.root).add(m);
    if (opts.solid) {
      this.col.addCentered(x, z, r * 2, r * 2, y, y + h, { opaque: opts.opaque !== false, tag: opts.tag, ref: opts.ref });
    }
    return m;
  }

  sphere(x, y, z, r, mat, opts = {}) {
    const m = new THREE.Mesh(_sphere, mat);
    m.position.set(x, y, z);
    m.scale.setScalar(r * 2);
    m.castShadow = opts.cast !== false;
    m.receiveShadow = true;
    (opts.parent || this.root).add(m);
    return m;
  }

  /** Flat quad lying on the ground (decals, road markings). */
  ground(x, z, w, d, mat, y = 0.012, rotY = 0, parent = null) {
    const m = new THREE.Mesh(_plane, mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rotY;
    m.position.set(x, y, z);
    m.scale.set(w, d, 1);
    m.receiveShadow = true;
    (parent || this.root).add(m);
    return m;
  }

  bloodSplat(x, z, size = 1.6, seed = 1, rot = 0) {
    const mat = new THREE.MeshBasicMaterial({
      map: bloodDecalTexture(seed),
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
    });
    const m = this.ground(x, z, size, size, mat, 0.015 + (seed % 5) * 0.001, rot);
    m.renderOrder = 2;
    return m;
  }

  sign(x, y, z, text, w, h, rotY, opts = {}) {
    const mat = new THREE.MeshStandardMaterial({
      map: signTexture(text, opts),
      roughness: 0.8,
      emissive: new THREE.Color(opts.emissive || 0x000000),
      emissiveIntensity: opts.emissiveIntensity || 0,
    });
    const m = new THREE.Mesh(_plane, mat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    m.scale.set(w, h, 1);
    this.root.add(m);
    // Back face so it isn't invisible from behind.
    const back = new THREE.Mesh(_plane, this.M.metalDark);
    back.position.set(x, y, z);
    back.rotation.y = rotY + Math.PI;
    back.scale.set(w, h, 1);
    this.root.add(back);
    return m;
  }

  // ───────────────────────────────────────────────────────── structures ──

  /**
   * A wall run with an optional door/window gap.
   * axis: 'x' (runs along X) or 'z'.
   */
  wallWithGap(axis, fixed, from, to, y0, height, thickness, mat, gap, parent) {
    const segs = [];
    if (!gap) {
      segs.push([from, to]);
    } else {
      const { at, width, kind } = gap; // kind: 'door' | 'window'
      const a = at - width / 2;
      const b = at + width / 2;
      segs.push([from, a], [b, to]);
      if (kind === 'window') {
        // sill below, header above
        this._wallSeg(axis, fixed, a, b, y0, 0.95, thickness, mat, parent);
        this._wallSeg(axis, fixed, a, b, y0 + 2.05, height - 2.05, thickness, mat, parent);
      } else {
        this._wallSeg(axis, fixed, a, b, y0 + 2.15, height - 2.15, thickness, mat, parent);
      }
    }
    for (const [a, b] of segs) {
      if (b - a > 0.02) this._wallSeg(axis, fixed, a, b, y0, height, thickness, mat, parent);
    }
  }

  _wallSeg(axis, fixed, a, b, y0, h, t, mat, parent) {
    if (h <= 0.02) return;
    const len = b - a;
    const mid = (a + b) / 2;
    if (axis === 'x') {
      this.box(mid, y0, fixed, len, h, t, mat, { parent, tag: 'wall' });
    } else {
      this.box(fixed, y0, mid, t, h, len, mat, { parent, tag: 'wall' });
    }
  }

  /**
   * Build a rectangular single-storey building with a walk-in interior.
   *
   * spec: {
   *   x, z, w, d, height, wallMat, floorMat, roofMat,
   *   doors: [{ side:'n'|'s'|'e'|'w', offset:0, width:2.2 }],
   *   windows: [{ side, offset, width }],
   *   roof: true, roofStyle:'flat'|'gable', name
   * }
   * Returns { group, roofGroup, bounds, interiorCheck }
   */
  building(spec) {
    const {
      x,
      z,
      w,
      d,
      height = 3.1,
      wallMat = this.M.plasterA,
      floorMat = this.M.wood,
      roofMat = this.M.roof,
      doors = [],
      windows = [],
      roofStyle = 'gable',
      wallThickness = 0.24,
    } = spec;

    const g = new THREE.Group();
    this.root.add(g);
    const roofGroup = new THREE.Group();
    this.root.add(roofGroup);

    const hw = w / 2,
      hd = d / 2;
    const t = wallThickness;

    // Floor slab (raised slightly = porch step)
    const slab = 0.16;
    this.box(x, 0, z, w + 0.5, slab, d + 0.5, this.M.concrete, {
      parent: g,
      platform: true,
      opaque: false,
      tag: 'floor',
    });
    this.ground(x, z, w - 0.1, d - 0.1, floorMat, slab + 0.011, 0, g);

    // Gather openings per side
    const bySide = { n: [], s: [], e: [], w: [] };
    for (const dr of doors) bySide[dr.side].push({ ...dr, kind: 'door', width: dr.width || 2.3 });
    for (const wd of windows) bySide[wd.side].push({ ...wd, kind: 'window', width: wd.width || 1.7 });

    /**
     * Gaps are no longer decorated here. The wall gets built around them and
     * each one is reported back as a descriptor; World turns those into
     * `Opening` objects that own their own glass, boards, leaf and collision.
     */
    const gaps = [];

    const buildSide = (side) => {
      const openings = bySide[side];
      const isNS = side === 'n' || side === 's';
      const axis = isNS ? 'x' : 'z';
      const fixed = side === 'n' ? z - hd : side === 's' ? z + hd : side === 'e' ? x + hw : x - hw;
      const from = isNS ? x - hw : z - hd;
      const to = isNS ? x + hw : z + hd;

      if (openings.length === 0) {
        this._wallSeg(axis, fixed, from, to, slab, height, t, wallMat, g);
        return;
      }
      // Sort openings and lay solid segments between them.
      const ops = openings
        .map((o) => ({ ...o, at: (isNS ? x : z) + (o.offset || 0) }))
        .sort((a, b) => a.at - b.at);
      let cursor = from;
      for (const o of ops) {
        const a = o.at - o.width / 2;
        const b = o.at + o.width / 2;
        if (a > cursor) this._wallSeg(axis, fixed, cursor, a, slab, height, t, wallMat, g);

        const gap = { kind: o.kind, side, axis, fixed, a, b, thickness: t, parent: g, spec: o };
        if (o.kind === 'window') {
          this._wallSeg(axis, fixed, a, b, slab, 0.92, t, wallMat, g);            // sill
          this._wallSeg(axis, fixed, a, b, slab + 2.02, height - 2.02, t, wallMat, g);
          gap.y0 = slab + 0.92;
          gap.y1 = slab + 2.02;
          gap.state = o.boarded ? 'boarded' : o.broken ? 'broken' : 'closed';
        } else {
          this._wallSeg(axis, fixed, a, b, slab + 2.12, height - 2.12, t, wallMat, g);
          gap.y0 = slab;
          gap.y1 = slab + 2.12;
          gap.state = o.boarded ? 'boarded' : o.broken ? 'broken' : o.open ? 'open' : 'closed';
        }
        gaps.push(gap);
        cursor = b;
      }
      if (to > cursor) this._wallSeg(axis, fixed, cursor, to, slab, height, t, wallMat, g);
    };

    buildSide('n');
    buildSide('s');
    buildSide('e');
    buildSide('w');

    // Roof — kept in its own group so we can hide it when the player is inside.
    if (spec.roof !== false) {
      if (roofStyle === 'gable') {
        const rh = Math.min(1.5, w * 0.16);
        const slopeLen = Math.sqrt(hd * hd + rh * rh);
        for (const s of [-1, 1]) {
          const p = new THREE.Mesh(_box, roofMat);
          p.scale.set(w + 0.8, 0.14, slopeLen + 0.4);
          p.position.set(x, height + slab + rh / 2, z + (s * hd) / 2);
          p.rotation.x = -s * Math.atan2(rh, hd);
          p.castShadow = true;
          p.receiveShadow = true;
          roofGroup.add(p);
        }
        // gable end walls, filling the triangle under the ridge
        for (const s of [-1, 1]) {
          const tri = new THREE.Mesh(_box, wallMat);
          tri.scale.set(0.22, rh, d * 0.5);
          tri.position.set(x + s * hw, height + slab + rh / 2, z);
          roofGroup.add(tri);
        }
      } else {
        this.box(x, height + slab, z, w + 0.6, 0.22, d + 0.6, roofMat, {
          parent: roofGroup,
          solid: false,
        });
        // parapet
        for (const [ox, oz, sx, sz] of [
          [0, -hd - 0.2, w + 0.6, 0.18],
          [0, hd + 0.2, w + 0.6, 0.18],
          [-hw - 0.2, 0, 0.18, d + 0.6],
          [hw + 0.2, 0, 0.18, d + 0.6],
        ]) {
          this.box(x + ox, height + slab + 0.22, z + oz, sx, 0.42, sz, wallMat, {
            parent: roofGroup,
            solid: false,
          });
        }
      }
    }

    const bounds = { minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, floorY: slab };
    return { group: g, roofGroup, bounds, spec, gaps };
  }

  // ─────────────────────────────────────────────────────────── vehicles ──

  /**
   * Abandoned car. variant: 'sedan' | 'suv' | 'van' | 'police' | 'ambulance' | 'truck'
   */
  car(x, z, rotY, variant = 'sedan', opts = {}) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.root.add(g);

    const palette = [0x6b7076, 0x2f3b45, 0x7a3830, 0x51584a, 0x8b8578, 0x33383d, 0x8a7a55];
    let bodyMat;
    if (variant === 'police') bodyMat = this.M.police;
    else if (variant === 'ambulance') bodyMat = this.M.ambulance;
    else
      bodyMat = new THREE.MeshStandardMaterial({
        color: opts.color ?? palette[Math.abs(Math.floor(x * 7 + z * 13)) % palette.length],
        roughness: 0.62,
        metalness: 0.42,
      });

    let L = 4.3,
      W = 1.86,
      H = 0.72,
      cabH = 0.66,
      cabL = 2.1,
      cabOff = -0.1;
    if (variant === 'suv') {
      L = 4.6;
      W = 2.0;
      H = 0.86;
      cabH = 0.86;
      cabL = 2.5;
    } else if (variant === 'van' || variant === 'ambulance') {
      L = 5.2;
      W = 2.1;
      H = 1.0;
      cabH = 1.05;
      cabL = 3.4;
      cabOff = -0.4;
    } else if (variant === 'truck') {
      L = 6.2;
      W = 2.3;
      H = 1.15;
      cabH = 1.15;
      cabL = 2.0;
      cabOff = 1.6;
    }

    const wheelR = variant === 'suv' || variant === 'truck' ? 0.38 : 0.33;
    const bodyY = wheelR * 0.75;

    // chassis
    const body = new THREE.Mesh(_box, bodyMat);
    body.position.set(0, bodyY + H / 2, 0);
    body.scale.set(W, H, L);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // cabin
    const cab = new THREE.Mesh(_box, bodyMat);
    cab.position.set(0, bodyY + H + cabH / 2, cabOff);
    cab.scale.set(W * 0.92, cabH, cabL);
    cab.castShadow = true;
    g.add(cab);

    // glass band
    const glassMat = opts.smashed ? this.M.glassBroken : this.M.glass;
    const glass = new THREE.Mesh(_box, glassMat);
    glass.position.set(0, bodyY + H + cabH * 0.55, cabOff);
    glass.scale.set(W * 0.95, cabH * 0.62, cabL * 0.97);
    g.add(glass);

    if (variant === 'truck') {
      const bed = new THREE.Mesh(_box, this.M.metalDark);
      bed.position.set(0, bodyY + H + 0.3, -1.3);
      bed.scale.set(W * 0.98, 0.6, 3.0);
      bed.castShadow = true;
      g.add(bed);
    }

    // wheels
    const wheelMat = this.M.black;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const wmesh = new THREE.Mesh(_cylLow, wheelMat);
        wmesh.rotation.z = Math.PI / 2;
        wmesh.scale.set(wheelR * 2, 0.24, wheelR * 2);
        wmesh.position.set((sx * W) / 2, wheelR, (sz * L) / 2.9);
        if (opts.flat && sx < 0 && sz < 0) wmesh.scale.y = 0.24, wmesh.position.y = wheelR * 0.72;
        wmesh.castShadow = true;
        g.add(wmesh);
      }
    }

    // lights
    const hl = new THREE.Mesh(_box, this.M.plasticWhite);
    hl.position.set(0, bodyY + H * 0.6, L / 2 + 0.02);
    hl.scale.set(W * 0.8, 0.16, 0.06);
    g.add(hl);
    const tl = new THREE.Mesh(_box, this.M.plasticRed);
    tl.position.set(0, bodyY + H * 0.6, -L / 2 - 0.02);
    tl.scale.set(W * 0.8, 0.14, 0.06);
    g.add(tl);

    if (variant === 'police') {
      const bar = new THREE.Group();
      bar.position.set(0, bodyY + H + cabH + 0.09, cabOff + 0.2);
      const red = new THREE.Mesh(_box, this.M.emissiveRed);
      red.scale.set(0.5, 0.16, 0.28);
      red.position.x = -0.3;
      const blue = new THREE.Mesh(_box, this.M.emissiveBlue);
      blue.scale.set(0.5, 0.16, 0.28);
      blue.position.x = 0.3;
      bar.add(red, blue);
      g.add(bar);
      const stripe = new THREE.Mesh(_box, this.M.policeWhite);
      stripe.position.set(0, bodyY + H * 0.5, 0);
      stripe.scale.set(W + 0.02, 0.34, L * 0.55);
      g.add(stripe);
      g.userData.lightbar = { red, blue };
    }
    if (variant === 'ambulance') {
      const stripe = new THREE.Mesh(_box, this.M.plasticRed);
      stripe.position.set(0, bodyY + H * 0.55, 0);
      stripe.scale.set(W + 0.02, 0.22, L * 0.9);
      g.add(stripe);
      const bar = new THREE.Mesh(_box, this.M.emissiveRed);
      bar.scale.set(0.9, 0.15, 0.25);
      bar.position.set(0, bodyY + H + cabH + 0.09, cabOff + 1.2);
      g.add(bar);
      g.userData.lightbar = { red: bar, blue: null };
    }

    if (opts.tilt) {
      g.rotation.z = opts.tilt;
      g.position.y = 0.1;
    }

    // Collision: two boxes so cars aren't perfectly square to walk around.
    const c = Math.abs(Math.cos(rotY)),
      s = Math.abs(Math.sin(rotY));
    const bw = W * c + L * s;
    const bd = W * s + L * c;
    this.col.addCentered(x, z, bw * 0.92, bd * 0.94, 0, bodyY + H + cabH * 0.4, {
      tag: 'car',
      platform: true,
    });
    // Roof is standable
    this.col.addCentered(x, z, bw * 0.6, bd * 0.5, 0, bodyY + H + cabH, {
      tag: 'car',
      platform: true,
      opaque: false,
    });
    return g;
  }

  // ─────────────────────────────────────────────────────────────── props ──

  fence(x1, z1, x2, z2, height = 1.9, style = 'chain') {
    const dx = x2 - x1,
      dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const rotY = Math.atan2(dx, dz);
    const cx = (x1 + x2) / 2,
      cz = (z1 + z2) / 2;

    if (style === 'chain') {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x6d7276,
        roughness: 0.7,
        metalness: 0.5,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(_plane, mat);
      m.position.set(cx, height / 2, cz);
      m.rotation.y = rotY + Math.PI / 2;
      m.scale.set(len, height, 1);
      this.root.add(m);
      // posts
      const n = Math.max(2, Math.round(len / 2.4));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        this.cyl(x1 + dx * t, 0, z1 + dz * t, 0.05, height + 0.1, this.M.metal, { low: true });
      }
      this.col.addCentered(cx, cz, Math.abs(dx) + 0.16, Math.abs(dz) + 0.16, 0, height, {
        tag: 'fence',
        opaque: false,
      });
    } else {
      // wooden
      const n = Math.max(2, Math.round(len / 0.24));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const px = x1 + dx * t,
          pz = z1 + dz * t;
        const m = new THREE.Mesh(_box, this.M.woodDark);
        const h = height * (0.9 + ((i * 37) % 11) / 60);
        m.position.set(px, h / 2, pz);
        m.scale.set(0.2, h, 0.05);
        m.rotation.y = rotY;
        m.castShadow = true;
        this.root.add(m);
      }
      this.col.addCentered(cx, cz, Math.abs(dx) + 0.2, Math.abs(dz) + 0.2, 0, height, { tag: 'fence' });
    }
  }

  dumpster(x, z, rotY, color = 0x3f5545) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.root.add(g);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.25 });
    const body = new THREE.Mesh(_box, mat);
    body.position.set(0, 0.62, 0);
    body.scale.set(1.9, 1.24, 1.15);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    const lid = new THREE.Mesh(_box, mat);
    lid.position.set(0, 1.32, -0.45);
    lid.scale.set(1.95, 0.1, 1.2);
    lid.rotation.x = -0.85;
    lid.castShadow = true;
    g.add(lid);
    for (const sx of [-1, 1]) {
      const wm = new THREE.Mesh(_cylLow, this.M.black);
      wm.rotation.z = Math.PI / 2;
      wm.scale.set(0.24, 0.14, 0.24);
      wm.position.set(sx * 0.8, 0.12, 0.42);
      g.add(wm);
    }
    const c = Math.abs(Math.cos(rotY)),
      s = Math.abs(Math.sin(rotY));
    this.col.addCentered(x, z, 1.9 * c + 1.15 * s, 1.9 * s + 1.15 * c, 0, 1.3, {
      tag: 'dumpster',
      platform: true,
    });
    return g;
  }

  tree(x, z, scale = 1, dead = false) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    this.root.add(g);
    const h = (4.2 + ((x * 13 + z * 7) % 10) / 5) * scale;
    const trunk = new THREE.Mesh(_cylLow, this.M.bark);
    trunk.position.set(0, h * 0.34, 0);
    trunk.scale.set(0.34 * scale, h * 0.68, 0.34 * scale);
    trunk.castShadow = true;
    g.add(trunk);

    const seedA = Math.abs(Math.sin(x * 12.9898 + z * 78.233)) % 1;
    if (!dead) {
      const mat = seedA > 0.65 ? this.M.foliageDry : this.M.foliage;
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(_sphere, mat);
        const a = (i / 4) * Math.PI * 2 + seedA * 6;
        const rr = (1.05 + (i % 2) * 0.4) * scale;
        b.position.set(Math.cos(a) * 0.7 * scale, h * (0.72 + (i % 2) * 0.13), Math.sin(a) * 0.7 * scale);
        b.scale.setScalar(rr * 2.05);
        b.castShadow = true;
        g.add(b);
      }
    } else {
      for (let i = 0; i < 5; i++) {
        const br = new THREE.Mesh(_cylLow, this.M.bark);
        const a = (i / 5) * Math.PI * 2 + seedA * 4;
        br.position.set(Math.cos(a) * 0.5 * scale, h * (0.6 + i * 0.06), Math.sin(a) * 0.5 * scale);
        br.scale.set(0.1 * scale, 1.5 * scale, 0.1 * scale);
        br.rotation.z = Math.cos(a) * 0.7;
        br.rotation.x = Math.sin(a) * 0.7;
        br.castShadow = true;
        g.add(br);
      }
    }
    this.col.addCentered(x, z, 0.6 * scale, 0.6 * scale, 0, h * 0.7, { tag: 'tree', opaque: true });
    return g;
  }

  /**
   * A wardrobe you can get inside. Left slightly ajar so it reads as a place
   * to go rather than as furniture — the door is the affordance.
   */
  wardrobe(x, z, rotY = 0) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.root.add(g);
    const W = 1.15,
      D = 0.62,
      H = 2.05;
    const shell = (sx, sy, sz, px, py, pz) => {
      const m = new THREE.Mesh(_box, this.M.woodDark);
      m.scale.set(sx, sy, sz);
      m.position.set(px, py, pz);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    };
    shell(W, H, 0.06, 0, H / 2, -D / 2);            // back
    shell(0.06, H, D, -W / 2, H / 2, 0);            // sides
    shell(0.06, H, D, W / 2, H / 2, 0);
    shell(W, 0.07, D, 0, H - 0.035, 0);             // top
    shell(W, 0.07, D, 0, 0.035, 0);                 // base
    // Two doors, the left one hanging open.
    const leaf = (sign, ang) => {
      const pivot = new THREE.Group();
      pivot.position.set((sign * W) / 2, H / 2, D / 2);
      pivot.rotation.y = ang;
      g.add(pivot);
      const m = new THREE.Mesh(_box, this.M.woodDark);
      m.scale.set(W / 2 - 0.03, H - 0.16, 0.05);
      m.position.set((-sign * (W / 2 - 0.03)) / 2, 0, 0);
      m.castShadow = true;
      pivot.add(m);
    };
    leaf(-1, 0.85);
    leaf(1, -0.06);
    this.col.addCentered(x, z, rotY ? D : W, rotY ? W : D, 0, H, { tag: 'wardrobe' });
    return g;
  }

  bush(x, z, s = 1) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    this.root.add(g);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(_sphere, i % 2 ? this.M.foliage : this.M.foliageDry);
      b.position.set((i - 1) * 0.4 * s, 0.42 * s + (i % 2) * 0.12, ((i % 2) - 0.5) * 0.35 * s);
      b.scale.setScalar((0.85 + (i % 2) * 0.2) * s);
      b.castShadow = true;
      g.add(b);
    }
    /**
     * Foliage you can push into. A solid bush would be a waist-high wall, and
     * the whole point of a bush in this game is that you can crouch inside it,
     * so it costs nothing to walk through and hides you when you are low.
     */
    (this.conceal || (this.conceal = [])).push({ x, z, r: 0.95 * s });
    return g;
  }

  streetlight(x, z, rotY = 0) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.root.add(g);
    const pole = new THREE.Mesh(_cylLow, this.M.metalDark);
    pole.position.set(0, 2.6, 0);
    pole.scale.set(0.14, 5.2, 0.14);
    pole.castShadow = true;
    g.add(pole);
    const arm = new THREE.Mesh(_box, this.M.metalDark);
    arm.position.set(0.75, 5.15, 0);
    arm.scale.set(1.6, 0.12, 0.12);
    g.add(arm);
    const head = new THREE.Mesh(_box, this.M.metalDark);
    head.position.set(1.5, 5.0, 0);
    head.scale.set(0.6, 0.2, 0.3);
    g.add(head);
    const bulb = new THREE.Mesh(_box, this.M.emissiveWarm);
    bulb.position.set(1.5, 4.88, 0);
    bulb.scale.set(0.5, 0.06, 0.24);
    g.add(bulb);
    this.col.addCentered(x, z, 0.3, 0.3, 0, 5, { tag: 'pole', opaque: false });
    g.userData.bulb = bulb;
    g.userData.lampPos = new THREE.Vector3(x + Math.cos(rotY) * 1.5, 4.88, z - Math.sin(rotY) * 1.5);
    return g;
  }

  barrier(x, z, rotY, len = 2.0) {
    // Concrete jersey barrier
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.root.add(g);
    const b1 = new THREE.Mesh(_box, this.M.concrete);
    b1.position.set(0, 0.2, 0);
    b1.scale.set(len, 0.4, 0.7);
    b1.castShadow = true;
    b1.receiveShadow = true;
    g.add(b1);
    const b2 = new THREE.Mesh(_box, this.M.concrete);
    b2.position.set(0, 0.62, 0);
    b2.scale.set(len, 0.5, 0.4);
    b2.castShadow = true;
    g.add(b2);
    const c = Math.abs(Math.cos(rotY)),
      s = Math.abs(Math.sin(rotY));
    this.col.addCentered(x, z, len * c + 0.7 * s, len * s + 0.7 * c, 0, 0.92, {
      tag: 'barrier',
      platform: true,
      opaque: false,
    });
    return g;
  }

  sandbags(x, z, rotY, len = 3, rows = 3) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.root.add(g);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6f6647, roughness: 1 });
    const per = Math.max(2, Math.round(len / 0.55));
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < per - r; i++) {
        const b = new THREE.Mesh(_box, mat);
        const off = (r * 0.27) + i * 0.55 - (len / 2) + 0.28;
        b.position.set(off, 0.14 + r * 0.26, ((i + r) % 2) * 0.06 - 0.03);
        b.scale.set(0.52, 0.26, 0.34);
        b.rotation.y = ((i * 37 + r * 13) % 10) / 60;
        b.castShadow = true;
        b.receiveShadow = true;
        g.add(b);
      }
    }
    const h = 0.14 + rows * 0.26;
    const c = Math.abs(Math.cos(rotY)),
      s = Math.abs(Math.sin(rotY));
    this.col.addCentered(x, z, len * c + 0.5 * s, len * s + 0.5 * c, 0, h, {
      tag: 'sandbag',
      platform: true,
      opaque: false,
    });
    return g;
  }

  bench(x, z, rotY) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.root.add(g);
    const seat = new THREE.Mesh(_box, this.M.woodDark);
    seat.position.set(0, 0.46, 0);
    seat.scale.set(1.9, 0.09, 0.52);
    seat.castShadow = true;
    g.add(seat);
    const back = new THREE.Mesh(_box, this.M.woodDark);
    back.position.set(0, 0.78, -0.22);
    back.scale.set(1.9, 0.5, 0.07);
    back.castShadow = true;
    g.add(back);
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(_box, this.M.metalDark);
      leg.position.set(sx * 0.8, 0.22, 0);
      leg.scale.set(0.08, 0.45, 0.5);
      g.add(leg);
    }
    const c = Math.abs(Math.cos(rotY)),
      s = Math.abs(Math.sin(rotY));
    this.col.addCentered(x, z, 1.9 * c + 0.55 * s, 1.9 * s + 0.55 * c, 0, 0.85, {
      tag: 'bench',
      platform: true,
      opaque: false,
    });
    return g;
  }

  shelf(x, z, rotY, w = 2.4, h = 1.8, empty = false) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.root.add(g);
    const frameMat = this.M.metalDark;
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(_box, frameMat);
      s.position.set(0, 0.28 + i * ((h - 0.3) / 3), 0);
      s.scale.set(w, 0.05, 0.62);
      s.castShadow = true;
      s.receiveShadow = true;
      g.add(s);
      if (!empty) {
        const n = Math.floor(w / 0.32);
        for (let k = 0; k < n; k++) {
          if ((k * 7 + i * 3) % 5 < 2) continue; // mostly cleared out
          const item = new THREE.Mesh(_box, k % 2 ? this.M.plasticRed : this.M.plasticYellow);
          item.position.set(-w / 2 + 0.18 + k * 0.32, 0.28 + i * ((h - 0.3) / 3) + 0.14, ((k % 3) - 1) * 0.12);
          item.scale.set(0.2, 0.24, 0.18);
          item.castShadow = true;
          g.add(item);
        }
      }
    }
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(_box, frameMat);
      p.position.set((sx * w) / 2, h / 2, 0);
      p.scale.set(0.07, h, 0.62);
      g.add(p);
    }
    const c = Math.abs(Math.cos(rotY)),
      s = Math.abs(Math.sin(rotY));
    this.col.addCentered(x, z, w * c + 0.62 * s, w * s + 0.62 * c, 0, h, { tag: 'shelf' });
    return g;
  }

  counter(x, z, rotY, w = 2.6) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.root.add(g);
    const body = new THREE.Mesh(_box, this.M.woodDark);
    body.position.set(0, 0.48, 0);
    body.scale.set(w, 0.96, 0.7);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    const top = new THREE.Mesh(_box, this.M.tile);
    top.position.set(0, 0.99, 0);
    top.scale.set(w + 0.1, 0.07, 0.8);
    top.castShadow = true;
    g.add(top);
    const c = Math.abs(Math.cos(rotY)),
      s = Math.abs(Math.sin(rotY));
    this.col.addCentered(x, z, w * c + 0.8 * s, w * s + 0.8 * c, 0, 1.03, {
      tag: 'counter',
      platform: true,
      opaque: false,
    });
    return g;
  }

  cabinet(x, z, rotY, w = 1.0, h = 0.9, mat = null) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.root.add(g);
    const body = new THREE.Mesh(_box, mat || this.M.wood);
    body.position.set(0, h / 2, 0);
    body.scale.set(w, h, 0.5);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    // handles
    for (const sx of [-1, 1]) {
      const hd = new THREE.Mesh(_box, this.M.metal);
      hd.position.set(sx * w * 0.22, h * 0.62, 0.27);
      hd.scale.set(0.05, 0.14, 0.04);
      g.add(hd);
    }
    const c = Math.abs(Math.cos(rotY)),
      s = Math.abs(Math.sin(rotY));
    this.col.addCentered(x, z, w * c + 0.5 * s, w * s + 0.5 * c, 0, h, {
      tag: 'cabinet',
      platform: true,
      opaque: false,
    });
    return g;
  }

  table(x, z, rotY, w = 1.5, d = 0.9, knocked = false) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    if (knocked) g.rotation.z = Math.PI / 2.1;
    this.root.add(g);
    const top = new THREE.Mesh(_box, this.M.wood);
    top.position.set(0, 0.74, 0);
    top.scale.set(w, 0.07, d);
    top.castShadow = true;
    top.receiveShadow = true;
    g.add(top);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(_box, this.M.woodDark);
        leg.position.set(sx * (w / 2 - 0.1), 0.37, sz * (d / 2 - 0.1));
        leg.scale.set(0.08, 0.74, 0.08);
        g.add(leg);
      }
    if (!knocked) {
      const c = Math.abs(Math.cos(rotY)),
        s = Math.abs(Math.sin(rotY));
      this.col.addCentered(x, z, w * c + d * s, w * s + d * c, 0, 0.78, {
        tag: 'table',
        platform: true,
        opaque: false,
      });
    } else {
      this.col.addCentered(x, z, 0.9, 0.9, 0, 0.8, { tag: 'table', opaque: false });
    }
    return g;
  }

  chair(x, z, rotY, knocked = false) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    if (knocked) {
      g.rotation.x = Math.PI / 2;
      g.position.y = 0.22;
    }
    this.root.add(g);
    const seat = new THREE.Mesh(_box, this.M.woodDark);
    seat.position.set(0, 0.45, 0);
    seat.scale.set(0.44, 0.06, 0.44);
    seat.castShadow = true;
    g.add(seat);
    const back = new THREE.Mesh(_box, this.M.woodDark);
    back.position.set(0, 0.72, -0.2);
    back.scale.set(0.44, 0.5, 0.05);
    g.add(back);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(_box, this.M.woodDark);
        leg.position.set(sx * 0.18, 0.22, sz * 0.18);
        leg.scale.set(0.05, 0.45, 0.05);
        g.add(leg);
      }
    this.col.addCentered(x, z, 0.5, 0.5, 0, knocked ? 0.45 : 0.5, { tag: 'chair', opaque: false });
    return g;
  }

  sofa(x, z, rotY, mat = null) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.root.add(g);
    const m = mat || this.M.fabricGreen;
    const base = new THREE.Mesh(_box, m);
    base.position.set(0, 0.28, 0);
    base.scale.set(2.0, 0.55, 0.9);
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);
    const back = new THREE.Mesh(_box, m);
    back.position.set(0, 0.62, -0.34);
    back.scale.set(2.0, 0.72, 0.24);
    back.castShadow = true;
    g.add(back);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(_box, m);
      arm.position.set(sx * 0.92, 0.5, 0);
      arm.scale.set(0.2, 0.5, 0.9);
      g.add(arm);
    }
    const c = Math.abs(Math.cos(rotY)),
      s = Math.abs(Math.sin(rotY));
    this.col.addCentered(x, z, 2.0 * c + 0.95 * s, 2.0 * s + 0.95 * c, 0, 0.95, {
      tag: 'sofa',
      platform: true,
      opaque: false,
    });
    return g;
  }

  bed(x, z, rotY) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.root.add(g);
    const frame = new THREE.Mesh(_box, this.M.woodDark);
    frame.position.set(0, 0.22, 0);
    frame.scale.set(1.4, 0.44, 2.0);
    frame.castShadow = true;
    g.add(frame);
    const mattress = new THREE.Mesh(_box, this.M.plasticWhite);
    mattress.position.set(0, 0.55, 0);
    mattress.scale.set(1.34, 0.24, 1.94);
    mattress.castShadow = true;
    g.add(mattress);
    const sheet = new THREE.Mesh(_box, this.M.fabricBlue);
    sheet.position.set(0, 0.63, 0.3);
    sheet.scale.set(1.36, 0.12, 1.3);
    sheet.rotation.x = 0.03;
    g.add(sheet);
    const pillow = new THREE.Mesh(_box, this.M.plasticWhite);
    pillow.position.set(0, 0.72, -0.75);
    pillow.scale.set(0.9, 0.16, 0.4);
    g.add(pillow);
    const c = Math.abs(Math.cos(rotY)),
      s = Math.abs(Math.sin(rotY));
    this.col.addCentered(x, z, 1.4 * c + 2.0 * s, 1.4 * s + 2.0 * c, 0, 0.7, {
      tag: 'bed',
      platform: true,
      opaque: false,
    });
    return g;
  }

  fridge(x, z, rotY) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.root.add(g);
    const body = new THREE.Mesh(_box, this.M.plasticWhite);
    body.position.set(0, 0.88, 0);
    body.scale.set(0.75, 1.76, 0.7);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    const seam = new THREE.Mesh(_box, this.M.metalDark);
    seam.position.set(0, 1.16, 0.36);
    seam.scale.set(0.76, 0.02, 0.02);
    g.add(seam);
    const handle = new THREE.Mesh(_box, this.M.metal);
    handle.position.set(0.28, 1.0, 0.37);
    handle.scale.set(0.04, 0.5, 0.04);
    g.add(handle);
    const c = Math.abs(Math.cos(rotY)),
      s = Math.abs(Math.sin(rotY));
    this.col.addCentered(x, z, 0.75 * c + 0.7 * s, 0.75 * s + 0.7 * c, 0, 1.76, { tag: 'fridge' });
    return g;
  }

  cooler(x, z, rotY, w = 1.8) {
    // Store refrigerated cabinet with glass doors
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.root.add(g);
    const body = new THREE.Mesh(_box, this.M.metalDark);
    body.position.set(0, 1.0, 0);
    body.scale.set(w, 2.0, 0.8);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    const glass = new THREE.Mesh(_box, this.M.glass);
    glass.position.set(0, 1.1, 0.41);
    glass.scale.set(w - 0.14, 1.6, 0.04);
    g.add(glass);
    const c = Math.abs(Math.cos(rotY)),
      s = Math.abs(Math.sin(rotY));
    this.col.addCentered(x, z, w * c + 0.8 * s, w * s + 0.8 * c, 0, 2.0, { tag: 'cooler' });
    return g;
  }

  barrel(x, z, burning = false) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    this.root.add(g);
    const b = new THREE.Mesh(_cyl, this.M.rust);
    b.position.set(0, 0.44, 0);
    b.scale.set(0.58, 0.88, 0.58);
    b.castShadow = true;
    b.receiveShadow = true;
    g.add(b);
    this.col.addCentered(x, z, 0.6, 0.6, 0, 0.9, { tag: 'barrel', platform: true, opaque: false });
    if (burning) {
      const fire = new THREE.Mesh(_cone, new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85 }));
      fire.position.set(0, 1.1, 0);
      fire.scale.set(0.5, 0.7, 0.5);
      g.add(fire);
      g.userData.fire = fire;
    }
    return g;
  }

  cone(x, z) {
    const m = new THREE.Mesh(_cone, new THREE.MeshStandardMaterial({ color: 0xc4601f, roughness: 0.8 }));
    m.position.set(x, 0.32, z);
    m.scale.set(0.44, 0.66, 0.44);
    m.castShadow = true;
    this.root.add(m);
    const base = new THREE.Mesh(_box, this.M.black);
    base.position.set(x, 0.03, z);
    base.scale.set(0.5, 0.06, 0.5);
    this.root.add(base);
    return m;
  }

  crate(x, z, rotY, s = 0.8, mat = null) {
    const m = this.box(x, 0, z, s, s * 0.85, s, mat || this.M.wood, { rotY, platform: true, opaque: false, tag: 'crate' });
    return m;
  }

  tent(x, z, rotY, mat = null) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.root.add(g);
    const m = mat || this.M.tarpBlue;
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(_box, m);
      p.scale.set(2.4, 0.06, 1.75);
      p.position.set(0, 0.72, s * 0.62);
      p.rotation.x = s * -0.72;
      p.castShadow = true;
      p.receiveShadow = true;
      g.add(p);
    }
    const backW = new THREE.Mesh(_box, m);
    backW.scale.set(0.06, 1.3, 2.3);
    backW.position.set(-1.2, 0.62, 0);
    g.add(backW);
    this.col.addCentered(x, z, 2.6, 2.6, 0, 1.4, { tag: 'tent', opaque: true });
    return g;
  }

  bodyBag(x, z, rotY) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.root.add(g);
    const mat = new THREE.MeshStandardMaterial({ color: 0x16181a, roughness: 0.65 });
    const b = new THREE.Mesh(_box, mat);
    b.position.set(0, 0.16, 0);
    b.scale.set(0.62, 0.32, 1.94);
    b.castShadow = true;
    b.receiveShadow = true;
    g.add(b);
    const head = new THREE.Mesh(_sphere, mat);
    head.position.set(0, 0.22, -0.85);
    head.scale.setScalar(0.42);
    g.add(head);
    this.col.addCentered(x, z, 0.8, 2.0, 0, 0.34, { tag: 'body', opaque: false, platform: true });
    return g;
  }

  backpack(x, z, rotY, color = 0x4a5540) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    this.root.add(g);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
    const b = new THREE.Mesh(_box, mat);
    b.position.set(0, 0.2, 0);
    b.scale.set(0.42, 0.4, 0.28);
    b.castShadow = true;
    b.receiveShadow = true;
    g.add(b);
    const top = new THREE.Mesh(_box, mat);
    top.position.set(0, 0.44, -0.02);
    top.scale.set(0.36, 0.12, 0.24);
    g.add(top);
    return g;
  }

  debris(x, z, rng, count = 6, radius = 2.4) {
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0.2, radius);
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const kind = rng.int(0, 3);
      const mat =
        kind === 0 ? this.M.concrete : kind === 1 ? this.M.woodDark : kind === 2 ? this.M.metalDark : this.M.brickA;
      const m = new THREE.Mesh(_box, mat);
      m.position.set(px, rng.range(0.03, 0.12), pz);
      m.scale.set(rng.range(0.15, 0.6), rng.range(0.05, 0.22), rng.range(0.15, 0.6));
      m.rotation.y = rng.range(0, Math.PI);
      m.rotation.z = rng.range(-0.2, 0.2);
      m.castShadow = true;
      m.receiveShadow = true;
      this.root.add(m);
    }
  }

  paper(x, z, rng, count = 10, radius = 3) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xb8b3a4, roughness: 1, side: THREE.DoubleSide });
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0.2, radius);
      const m = new THREE.Mesh(_plane, mat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = rng.range(0, Math.PI);
      m.position.set(x + Math.cos(a) * r, 0.02 + i * 0.0006, z + Math.sin(a) * r);
      m.scale.set(rng.range(0.18, 0.3), rng.range(0.22, 0.36), 1);
      this.root.add(m);
    }
  }
}
