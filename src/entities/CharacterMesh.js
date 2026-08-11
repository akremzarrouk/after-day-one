/**
 * CharacterMesh.js — the procedural humanoid, and the pose library that drives it.
 *
 * This is the fallback path: it runs whenever the GLB characters in
 * `public/assets/models/` are missing, and it has to stand on its own, so it
 * is built like a real character rather than a placeholder. Rounded limbs, a
 * neck, hands with thumbs, feet that break at the ball, a jacket-and-hood
 * silhouette, a face with sockets and a jaw, and a palette set wide enough
 * that a crowd reads as a crowd.
 *
 * Poses are evaluated into a flat channel buffer instead of written straight
 * onto Object3Ds. That is what lets AnimationController crossfade between
 * them, layer a one-shot over a walk cycle, and warp a swing's timing — the
 * same things the skinned path gets from an AnimationMixer.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { zombieSkinTexture } from '../world/Textures.js';
import { clamp01 } from '../core/Utils.js';

// ─────────────────────────────────────────────────────────── pose buffer ──

/**
 * One float per animatable channel. Every pose writes a full buffer, so two
 * of them can be blended by a plain lerp — no missing-channel bookkeeping.
 */
export const CH = {
  rootY: 0, rootRX: 1, rootRZ: 2,
  hipsY: 3, hipsRX: 4, hipsRY: 5, hipsRZ: 6,
  torsoRX: 7, torsoRY: 8, torsoRZ: 9,
  neckRX: 10, neckRY: 11, neckRZ: 12,
  headRX: 13, headRY: 14, headRZ: 15,
  shLRX: 16, shLRY: 17, shLRZ: 18,
  shRRX: 19, shRRY: 20, shRRZ: 21,
  elLRX: 22, elLRY: 23,
  elRRX: 24, elRRY: 25,
  wrLRX: 26, wrRRX: 27,
  hpLRX: 28, hpLRY: 29, hpLRZ: 30,
  hpRRX: 31, hpRRY: 32, hpRRZ: 33,
  knLRX: 34, knRRX: 35,
  ftLRX: 36, ftRRX: 37,
  toLRX: 38, toRRX: 39,
  COUNT: 40,
};

export const makePoseBuffer = () => new Float32Array(CH.COUNT);

export function blendPose(out, a, b, t) {
  for (let i = 0; i < CH.COUNT; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

/** Write a pose buffer onto a humanoid's pivots. */
export function applyPose(p, b) {
  p.root.position.y = b[CH.rootY];
  // Y is deliberately left alone: CharacterRig owns it for the death twist.
  p.root.rotation.x = b[CH.rootRX];
  p.root.rotation.z = b[CH.rootRZ];

  p.hips.position.y = HIP_HEIGHT + b[CH.hipsY];
  p.hips.rotation.set(b[CH.hipsRX], b[CH.hipsRY], b[CH.hipsRZ]);
  p.torso.rotation.set(b[CH.torsoRX], b[CH.torsoRY], b[CH.torsoRZ]);
  p.neck.rotation.set(b[CH.neckRX], b[CH.neckRY], b[CH.neckRZ]);
  p.head.rotation.set(b[CH.headRX], b[CH.headRY], b[CH.headRZ]);

  p.armL.shoulder.rotation.set(b[CH.shLRX], b[CH.shLRY], b[CH.shLRZ]);
  p.armR.shoulder.rotation.set(b[CH.shRRX], b[CH.shRRY], b[CH.shRRZ]);
  p.armL.elbow.rotation.set(b[CH.elLRX], b[CH.elLRY], 0);
  p.armR.elbow.rotation.set(b[CH.elRRX], b[CH.elRRY], 0);
  p.armL.wrist.rotation.x = b[CH.wrLRX];
  p.armR.wrist.rotation.x = b[CH.wrRRX];

  p.legL.hip.rotation.set(b[CH.hpLRX], b[CH.hpLRY], b[CH.hpLRZ]);
  p.legR.hip.rotation.set(b[CH.hpRRX], b[CH.hpRRY], b[CH.hpRRZ]);
  p.legL.knee.rotation.x = b[CH.knLRX];
  p.legR.knee.rotation.x = b[CH.knRRX];
  p.legL.ankle.rotation.x = b[CH.ftLRX];
  p.legR.ankle.rotation.x = b[CH.ftRRX];
  p.legL.toe.rotation.x = b[CH.toLRX];
  p.legR.toe.rotation.x = b[CH.toRRX];
}

// ───────────────────────────────────────────────────────────── geometry ──

const HIP_HEIGHT = 0.96;

/** Standing height of the humanoid at scale 1, crown to sole. */
export const PROC_HEIGHT = 1.87;

/** Shared geometry, built once and reused by every character in the scene. */
const GEO = {};

function geo(key, make) {
  return GEO[key] || (GEO[key] = make());
}

/** A capsule that runs downward from the joint, like a limb hanging off a pivot. */
function limb(radius, length, top = 0) {
  const g = new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 3, 8);
  g.translate(0, top - length / 2, 0);
  return g;
}

/**
 * Boxes carry the hard-edged parts — soles, jaw, collar, finger groups. The
 * organic volumes are capsules and spheres, which is what stops the whole
 * thing reading as a stack of crates.
 */
function box(w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function sphere(r, sx = 1, sy = 1, sz = 1, x = 0, y = 0, z = 0) {
  const g = new THREE.SphereGeometry(r, 10, 8);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}

function buildGeometry() {
  // torso: ribcage tapering into shoulders, with a collar
  geo('chest', () =>
    mergeGeometries([
      sphere(0.188, 1.13, 1.34, 0.74, 0, 0.26, 0),
      box(0.34, 0.2, 0.19, 0, 0.02, 0),
      box(0.4, 0.1, 0.2, 0, 0.5, -0.01),
    ])
  );
  // A shell sitting just proud of the chest — any wider and the torso reads as
  // a slab rather than a person in a coat.
  geo('jacket', () =>
    mergeGeometries([
      sphere(0.198, 1.14, 1.3, 0.79, 0, 0.265, -0.012),
      box(0.4, 0.075, 0.215, 0, 0.525, -0.02),        // collar
      box(0.072, 0.33, 0.05, -0.132, 0.28, 0.118),    // lapels
      box(0.072, 0.33, 0.05, 0.132, 0.28, 0.118),
    ])
  );
  geo('hood', () =>
    mergeGeometries([
      sphere(0.2, 1.15, 1.0, 1.1, 0, 0.06, -0.06),
      box(0.3, 0.16, 0.2, 0, -0.09, -0.05),
    ])
  );
  geo('pelvis', () => mergeGeometries([sphere(0.16, 1.2, 0.86, 0.95, 0, -0.03, 0)]));
  geo('belt', () => box(0.36, 0.06, 0.24, 0, 0.06, 0));
  geo('pack', () =>
    mergeGeometries([
      box(0.27, 0.34, 0.15, 0, 0.29, -0.19),
      box(0.075, 0.38, 0.045, -0.12, 0.3, -0.095),   // straps over the shoulders
      box(0.075, 0.38, 0.045, 0.12, 0.3, -0.095),
      box(0.2, 0.09, 0.12, 0, 0.11, -0.2),           // bedroll lashed underneath
    ])
  );

  geo('neck', () => limb(0.062, 0.18, 0.075));

  // head: skull, brow, jaw, nose. Sockets and mouth are a second material.
  geo('skull', () =>
    mergeGeometries([
      sphere(0.118, 1.0, 1.05, 1.04, 0, 0.125, 0),
      box(0.156, 0.08, 0.138, 0, 0.05, 0.028),   // jaw
      box(0.168, 0.034, 0.032, 0, 0.142, 0.1),   // brow ridge
      box(0.034, 0.052, 0.048, 0, 0.104, 0.108), // nose
    ])
  );
  geo('sockets', () =>
    mergeGeometries([
      sphere(0.031, 1, 0.82, 0.7, -0.046, 0.122, 0.09),
      sphere(0.031, 1, 0.82, 0.7, 0.046, 0.122, 0.09),
      box(0.066, 0.021, 0.02, 0, 0.056, 0.094),  // mouth line
    ])
  );
  geo('hair', () =>
    mergeGeometries([
      sphere(0.123, 1.0, 0.9, 1.02, 0, 0.148, -0.008),
      box(0.2, 0.05, 0.125, 0, 0.094, -0.08),
    ])
  );

  geo('upperArm', () => limb(0.049, 0.29));
  geo('foreArm', () => limb(0.042, 0.27));
  geo('shoulderPad', () => sphere(0.062, 1.1, 0.9, 1.1, 0, -0.01, 0));
  geo('hand', () =>
    mergeGeometries([
      box(0.062, 0.085, 0.038, 0, -0.045, 0),                 // palm
      box(0.058, 0.062, 0.032, 0.002, -0.108, 0.004),         // fingers
      box(0.026, 0.052, 0.03, -0.04, -0.058, 0.014),          // thumb
    ])
  );

  geo('thigh', () => limb(0.068, 0.44));
  geo('shin', () => limb(0.055, 0.42));
  geo('heel', () =>
    mergeGeometries([
      box(0.086, 0.062, 0.115, 0, -0.032, -0.012),
      box(0.092, 0.03, 0.12, 0, -0.058, -0.01),               // sole
    ])
  );
  geo('toe', () => box(0.084, 0.05, 0.098, 0, -0.036, 0.05));
  geo('knee', () => sphere(0.058, 1, 0.85, 1, 0, 0, 0.008));
}

// ───────────────────────────────────────────────────────────── palettes ──

/**
 * Ten survivor-neighbourhood looks. Everything here is drab on purpose: this
 * is a street of people who dressed for work two days ago.
 */
export const PALETTES = [
  { shirt: 0x9aa48c, jacket: 0x7d6a4c, pants: 0x565b63, shoe: 0x3a3532, hair: 0x4b3a2b, hood: false },
  { shirt: 0xb0857a, jacket: 0x8a6a5c, pants: 0x5d6167, shoe: 0x413834, hair: 0x322722, hood: true },
  { shirt: 0x7d92a6, jacket: 0x566878, pants: 0x4e5359, shoe: 0x33353a, hair: 0x7a6040, hood: false },
  { shirt: 0xc0b795, jacket: 0x958a68, pants: 0x66655a, shoe: 0x474038, hair: 0x453a34, hood: true },
  { shirt: 0x8c7891, jacket: 0x685a72, pants: 0x54545c, shoe: 0x393540, hair: 0x8f7154, hood: false },
  { shirt: 0xd2ccbe, jacket: 0xa9a294, pants: 0x736d63, shoe: 0x4a443f, hair: 0x2e2724, hood: false },
  { shirt: 0x9aad8a, jacket: 0x6d7c5e, pants: 0x585449, shoe: 0x3b3833, hair: 0x63503a, hood: true },
  { shirt: 0xc08a58, jacket: 0x8b6d47, pants: 0x4d525b, shoe: 0x35302c, hair: 0x413636, hood: false },
  { shirt: 0x7e9ba0, jacket: 0x566d74, pants: 0x605c52, shoe: 0x3c3937, hair: 0x81674a, hood: true },
  { shirt: 0xb4a68f, jacket: 0x83765f, pants: 0x4c5057, shoe: 0x34302e, hair: 0x3a302a, hood: false },
];

/** Zombie skin tints, paired with the palettes above by index. */
const ZOMBIE_SKINS = [
  [104, 118, 96], [118, 122, 104], [92, 106, 92], [128, 124, 106], [98, 112, 108],
  [112, 108, 94], [86, 100, 88], [124, 116, 100], [96, 104, 112], [110, 102, 92],
];

const SKIN_VARIANTS = 10;

/**
 * Materials are shared across every character wearing the same look — a crowd
 * of 45 costs ten palettes, not forty-five sets. They and the geometry above
 * live for the lifetime of the page: a run restarting disposes its characters,
 * never the things they borrowed.
 */
const _matCache = new Map();

function sharedMat(key, make) {
  let m = _matCache.get(key);
  if (!m) {
    m = make();
    _matCache.set(key, m);
  }
  return m;
}

function paletteMaterials(index, opts = {}) {
  const pal = PALETTES[index % PALETTES.length];
  const zombie = !!opts.zombie;
  const tag = `${zombie ? 'z' : 'h'}${index % PALETTES.length}`;

  const std = (color, rough = 0.94) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });

  const skin = sharedMat(`${tag}-skin`, () => {
    if (zombie) {
      return new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: zombieSkinTexture(ZOMBIE_SKINS[index % ZOMBIE_SKINS.length], index % SKIN_VARIANTS),
        roughness: 0.96,
        metalness: 0,
      });
    }
    return std(0xbb8f6b, 0.9);
  });

  // The dead have been outside for two days; everything they wear is filthier.
  const dirty = (c) => {
    if (!zombie) return c;
    const col = new THREE.Color(c);
    col.multiplyScalar(0.72);
    col.offsetHSL(0, -0.14, 0);
    return col.getHex();
  };

  return {
    pal,
    skin,
    shirt: sharedMat(`${tag}-shirt`, () => std(dirty(pal.shirt))),
    jacket: sharedMat(`${tag}-jacket`, () => std(dirty(pal.jacket), 0.97)),
    pants: sharedMat(`${tag}-pants`, () => std(dirty(pal.pants))),
    shoe: sharedMat(`${tag}-shoe`, () => std(dirty(pal.shoe), 0.8)),
    hair: sharedMat(`${tag}-hair`, () => std(pal.hair, 0.98)),
    dark: sharedMat('dark', () => std(0x14100e, 0.99)),
  };
}

// ──────────────────────────────────────────────────────────── the build ──

function mesh(parent, g, mat, scale = null) {
  const m = new THREE.Mesh(g, mat);
  if (scale) m.scale.set(scale[0], scale[1], scale[2]);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function pivot(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/**
 * @param opts { palette, zombie, scale, bulk, hunch, hood, pack }
 */
export function buildHumanoid(opts = {}) {
  if (!GEO.chest) buildGeometry();

  const {
    palette = 0,
    zombie = false,
    scale = 1,
    bulk = 1,
    hood = null,
    pack = false,
  } = opts;

  const M = paletteMaterials(palette, { zombie });
  const wearHood = hood === null ? M.pal.hood : hood;

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(scale);
  root.add(body);

  const hips = pivot(body, 0, HIP_HEIGHT, 0);
  mesh(hips, GEO.pelvis, M.pants, [bulk, 1, bulk]);
  mesh(hips, GEO.belt, M.shoe, [bulk, 1, bulk]);

  const torso = pivot(hips, 0, 0.05, 0);
  mesh(torso, GEO.chest, M.shirt, [bulk, 1, bulk]);
  mesh(torso, GEO.jacket, M.jacket, [bulk, 1, bulk]);
  if (pack) mesh(torso, GEO.pack, M.shoe);   // canvas and webbing, darker than the coat

  const neck = pivot(torso, 0, 0.52, -0.005);
  mesh(neck, GEO.neck, M.skin);

  const head = pivot(neck, 0, 0.072, 0);
  const headMesh = mesh(head, GEO.skull, M.skin);
  mesh(head, GEO.sockets, M.dark);
  if (wearHood) mesh(head, GEO.hood, M.jacket);
  else mesh(head, GEO.hair, M.hair);

  const arm = (side) => {
    const shoulder = pivot(torso, side * 0.218 * bulk, 0.425, 0);
    mesh(shoulder, GEO.shoulderPad, M.jacket);
    mesh(shoulder, GEO.upperArm, M.jacket);
    const elbow = pivot(shoulder, 0, -0.29, 0);
    mesh(elbow, GEO.foreArm, zombie ? M.skin : M.shirt);
    const wrist = pivot(elbow, 0, -0.27, 0);
    const hand = pivot(wrist, 0, 0, 0);
    mesh(hand, GEO.hand, M.skin);
    return { shoulder, elbow, wrist, hand };
  };

  const leg = (side) => {
    const hip = pivot(hips, side * 0.098 * bulk, -0.08, 0);
    mesh(hip, GEO.thigh, M.pants, [bulk, 1, bulk]);
    const knee = pivot(hip, 0, -0.44, 0);
    mesh(knee, GEO.knee, M.pants);
    mesh(knee, GEO.shin, M.pants);
    const ankle = pivot(knee, 0, -0.42, 0);
    mesh(ankle, GEO.heel, M.shoe);
    const toe = pivot(ankle, 0, -0.036, 0.055);
    mesh(toe, GEO.toe, M.shoe);
    return { hip, knee, ankle, toe };
  };

  const armL = arm(-1);
  const armR = arm(1);
  const legL = leg(-1);
  const legR = leg(1);

  // Props hang off the right hand, matching the skinned rig's grip pose.
  const weaponAnchor = new THREE.Group();
  weaponAnchor.position.set(0.01, -0.075, 0.02);
  weaponAnchor.rotation.set(0.15, 0, 0);
  armR.hand.add(weaponAnchor);

  return {
    root,
    body,
    style: zombie ? 'zombie' : 'human',
    parts: { root: body, hips, torso, neck, head, headMesh, armL, armR, legL, legR, weaponAnchor },
    materials: M,
    scale,
  };
}

export function buildSurvivor(palette = 0) {
  return buildHumanoid({ palette, zombie: false, scale: 1.0, pack: true, hood: false });
}

export function buildZombie(seed = 0, archetype = 'shambler') {
  const bulk = archetype === 'bloated' ? 1.4 : archetype === 'stalker' ? 0.86 : 1.0;
  const scale = archetype === 'bloated' ? 1.05 : archetype === 'stalker' ? 1.02 : 0.97;
  return buildHumanoid({
    palette: seed % PALETTES.length,
    zombie: true,
    scale,
    bulk,
    hood: archetype === 'stalker' ? true : null,
  });
}

// ──────────────────────────────────────────────────────────────── poses ──

const TAU = Math.PI * 2;

/** Zero everything, then let the pose write what it cares about. */
function base(b) {
  b.fill(0);
  return b;
}

/** Shared arm carriage so states agree on where a relaxed arm hangs. */
function relaxedArms(b, style, k = 1) {
  if (style === 'zombie') {
    b[CH.shLRX] = -0.5 * k;
    b[CH.shRRX] = -0.42 * k;
    b[CH.shLRZ] = 0.16;
    b[CH.shRRZ] = -0.13;
    b[CH.elLRX] = -0.6 * k;
    b[CH.elRRX] = -0.48 * k;
  } else {
    b[CH.shLRZ] = 0.09;
    b[CH.shRRZ] = -0.09;
    b[CH.elLRX] = -0.22;
    b[CH.elRRX] = -0.22;
  }
}

/** Permanent damage: zombies never stand straight again. */
function zombieStoop(b, amount = 1) {
  b[CH.torsoRX] = 0.26 * amount;
  b[CH.neckRX] = -0.18 * amount;
  b[CH.headRX] = -0.06 * amount;
  b[CH.hipsRX] = 0.05 * amount;
}

/**
 * The pose library. Keys match the glTF clip names on purpose: the controller
 * asks for "Walk" and neither it nor the caller has to know whether that
 * resolves to an animation curve or to the maths below.
 *
 *  eval(buffer, phase, time, style) — `phase` is cycles for looping states and
 *  0..1 progress for one-shots. `cycle` is cycles per second at the reference
 *  speed; `refSpeed` is the speed the cycle was tuned for, in m/s.
 */
export const POSES = {
  Idle: {
    cycle: 0.22,
    refSpeed: 1,
    eval(b, phase, t, style) {
      base(b);
      const s = Math.sin(t * 1.05);
      if (style === 'zombie') {
        // Never at rest: weight shifting, a head that keeps twitching.
        const tw = Math.sin(t * 0.7) * Math.sin(t * 2.3);
        zombieStoop(b, 1);
        relaxedArms(b, style);
        b[CH.hipsY] = -0.055 + s * 0.008;
        b[CH.hipsRZ] = s * 0.05;
        b[CH.torsoRZ] = -s * 0.06;
        b[CH.torsoRX] += s * 0.03;
        b[CH.neckRX] += tw * 0.07;
        b[CH.headRY] = tw * 0.22;
        b[CH.shLRX] += tw * 0.1;
        b[CH.shRRX] -= tw * 0.08;
        b[CH.hpLRX] = 0.06;
        b[CH.hpRRX] = -0.05;
        b[CH.knLRX] = 0.13;
        b[CH.knRRX] = 0.17;
        b[CH.ftLRX] = -0.08;
        b[CH.ftRRX] = -0.12;
      } else {
        relaxedArms(b, style);
        b[CH.hipsY] = s * 0.011;
        b[CH.hipsRY] = s * 0.03;
        b[CH.torsoRX] = 0.045 + s * 0.02;
        b[CH.torsoRY] = -s * 0.04;
        b[CH.neckRX] = -0.03;
        b[CH.headRY] = Math.sin(t * 0.37) * 0.16;
        b[CH.shLRX] = s * 0.05;
        b[CH.shRRX] = -s * 0.05;
        b[CH.knLRX] = 0.05;
        b[CH.knRRX] = 0.05;
      }
    },
  },

  Walk: {
    cycle: { human: 1.0, zombie: 0.62 },
    refSpeed: { human: 1.45, zombie: 0.95 },
    plants: { human: [0.03, 0.53], zombie: [0.06, 0.58] },
    eval(b, phase, t, style) {
      base(b);
      const a = phase * TAU;
      const s = Math.sin(a);
      const c = Math.cos(a);

      if (style === 'zombie') {
        // Uneven: the right leg drags, the whole body rocks.
        zombieStoop(b, 1);
        relaxedArms(b, style, 0.95);
        b[CH.hpLRX] = s * 0.52;
        b[CH.hpRRX] = -s * 0.3 - 0.12;
        b[CH.knLRX] = Math.max(0, -s * 0.42) + 0.12;
        b[CH.knRRX] = 0.22;
        b[CH.ftLRX] = -0.1 - Math.max(0, -s) * 0.2;
        b[CH.ftRRX] = -0.24;
        b[CH.toLRX] = Math.max(0, s) * 0.3;
        b[CH.toRRX] = 0.1;
        b[CH.hipsY] = -0.06 + Math.abs(c) * 0.028;
        b[CH.hipsRZ] = s * 0.11;
        b[CH.torsoRZ] = -s * 0.15;
        b[CH.torsoRX] += Math.abs(s) * 0.05;
        b[CH.headRZ] = s * 0.07;
        b[CH.shLRX] += -s * 0.15;
        b[CH.shRRX] += s * 0.1;
      } else {
        b[CH.hpLRX] = s * 0.66;
        b[CH.hpRRX] = -s * 0.66;
        b[CH.knLRX] = Math.max(0, -s * 0.62) + 0.07;
        b[CH.knRRX] = Math.max(0, s * 0.62) + 0.07;
        b[CH.ftLRX] = -b[CH.knLRX] * 0.45 - Math.max(0, s) * 0.12;
        b[CH.ftRRX] = -b[CH.knRRX] * 0.45 - Math.max(0, -s) * 0.12;
        b[CH.toLRX] = Math.max(0, s) * 0.34;
        b[CH.toRRX] = Math.max(0, -s) * 0.34;
        b[CH.shLRX] = -s * 0.5;
        b[CH.shRRX] = s * 0.5;
        b[CH.shLRZ] = 0.08;
        b[CH.shRRZ] = -0.08;
        b[CH.elLRX] = -0.26 - Math.max(0, s) * 0.34;
        b[CH.elRRX] = -0.26 - Math.max(0, -s) * 0.34;
        b[CH.hipsY] = Math.abs(c) * 0.036;
        b[CH.hipsRY] = s * 0.1;
        b[CH.torsoRY] = -s * 0.13;
        b[CH.torsoRX] = 0.055;
        b[CH.headRY] = s * 0.05;
      }
    },
  },

  Run: {
    cycle: { human: 1.55, zombie: 1.15 },
    refSpeed: { human: 4.4, zombie: 2.75 },
    plants: { human: [0.02, 0.52], zombie: [0.04, 0.54] },
    eval(b, phase, t, style) {
      base(b);
      const a = phase * TAU;
      const s = Math.sin(a);
      const c = Math.cos(a);

      if (style === 'zombie') {
        // The lurch. Long, badly controlled strides, arms thrown forward.
        zombieStoop(b, 1.5);
        b[CH.hpLRX] = s * 0.98;
        b[CH.hpRRX] = -s * 0.98;
        b[CH.knLRX] = Math.max(0, -s * 0.86) + 0.12;
        b[CH.knRRX] = Math.max(0, s * 0.86) + 0.12;
        b[CH.ftLRX] = -0.14;
        b[CH.ftRRX] = -0.14;
        b[CH.toLRX] = Math.max(0, s) * 0.36;
        b[CH.toRRX] = Math.max(0, -s) * 0.36;
        b[CH.shLRX] = -1.24 + s * 0.3;
        b[CH.shRRX] = -1.24 - s * 0.3;
        b[CH.shLRZ] = 0.3;
        b[CH.shRRZ] = -0.3;
        b[CH.elLRX] = -0.62;
        b[CH.elRRX] = -0.62;
        b[CH.hipsY] = -0.05 + Math.abs(c) * 0.07;
        b[CH.torsoRZ] = -s * 0.09;
        b[CH.neckRX] = -0.34;
      } else {
        b[CH.hpLRX] = s * 0.94;
        b[CH.hpRRX] = -s * 0.94;
        b[CH.knLRX] = Math.max(0, -s * 1.05) + 0.16;
        b[CH.knRRX] = Math.max(0, s * 1.05) + 0.16;
        b[CH.ftLRX] = -b[CH.knLRX] * 0.4 - 0.06;
        b[CH.ftRRX] = -b[CH.knRRX] * 0.4 - 0.06;
        b[CH.toLRX] = Math.max(0, s) * 0.42;
        b[CH.toRRX] = Math.max(0, -s) * 0.42;
        b[CH.shLRX] = -s * 0.86;
        b[CH.shRRX] = s * 0.86;
        b[CH.shLRZ] = 0.13;
        b[CH.shRRZ] = -0.13;
        b[CH.elLRX] = -1.05 - Math.max(0, s) * 0.35;
        b[CH.elRRX] = -1.05 - Math.max(0, -s) * 0.35;
        b[CH.hipsY] = Math.abs(c) * 0.07 - 0.03;
        b[CH.hipsRY] = s * 0.14;
        b[CH.torsoRY] = -s * 0.2;
        b[CH.torsoRX] = 0.2;
        b[CH.neckRX] = -0.14;
      }
    },
  },

  Jump: {
    cycle: 2.6,
    eval(b, phase) {
      base(b);
      const k = clamp01(phase);
      b[CH.hipsY] = -0.1 + k * 0.1;
      b[CH.hpLRX] = 0.5 - k * 0.45;
      b[CH.hpRRX] = 0.5 - k * 0.45;
      b[CH.knLRX] = 0.9 - k * 0.6;
      b[CH.knRRX] = 0.9 - k * 0.6;
      b[CH.shLRX] = -0.4 - k * 0.9;
      b[CH.shRRX] = -0.4 - k * 0.9;
      b[CH.elLRX] = -0.5;
      b[CH.elRRX] = -0.5;
      b[CH.torsoRX] = 0.28 - k * 0.24;
    },
  },

  Jump_Idle: {
    cycle: 0.7,
    eval(b, phase, t) {
      base(b);
      b[CH.hpLRX] = 0.24 + Math.sin(t * 3) * 0.06;
      b[CH.hpRRX] = -0.16;
      b[CH.knLRX] = 0.42;
      b[CH.knRRX] = 0.28;
      b[CH.shLRX] = -1.15;
      b[CH.shRRX] = -1.05;
      b[CH.shLRZ] = 0.32;
      b[CH.shRRZ] = -0.32;
      b[CH.elLRX] = -0.7;
      b[CH.elRRX] = -0.7;
      b[CH.torsoRX] = 0.12;
    },
  },

  Jump_Land: {
    cycle: 3.4,
    eval(b, phase) {
      base(b);
      const k = Math.sin(clamp01(phase) * Math.PI);
      b[CH.hipsY] = -k * 0.17;
      b[CH.hpLRX] = k * 0.5;
      b[CH.hpRRX] = k * 0.42;
      b[CH.knLRX] = k * 0.95;
      b[CH.knRRX] = k * 0.85;
      b[CH.ftLRX] = -k * 0.4;
      b[CH.ftRRX] = -k * 0.35;
      b[CH.torsoRX] = k * 0.34;
      b[CH.shLRX] = -k * 0.5;
      b[CH.shRRX] = -k * 0.45;
      b[CH.elLRX] = -0.5 - k * 0.4;
      b[CH.elRRX] = -0.5 - k * 0.4;
    },
  },

  /** A braced crouch — the base under the block overlay. */
  Duck: {
    cycle: 0.6,
    eval(b, phase, t) {
      base(b);
      const s = Math.sin(t * 2.2) * 0.012;
      b[CH.hipsY] = -0.16 + s;
      b[CH.hpLRX] = 0.44;
      b[CH.hpRRX] = 0.3;
      b[CH.knLRX] = 0.78;
      b[CH.knRRX] = 0.6;
      b[CH.ftLRX] = -0.34;
      b[CH.ftRRX] = -0.28;
      b[CH.torsoRX] = 0.26;
      b[CH.neckRX] = -0.14;
    },
  },

  HitReact: {
    cycle: 2.4,
    eval(b, phase, t, style) {
      base(b);
      const k = Math.sin(clamp01(phase) * Math.PI);
      if (style === 'zombie') zombieStoop(b, 1);
      b[CH.torsoRX] += -k * 0.5;
      b[CH.neckRX] += -k * 0.42;
      b[CH.headRX] = -k * 0.3;
      b[CH.hipsRZ] = k * 0.22;
      b[CH.hipsY] = -k * 0.05;
      b[CH.shLRX] = -0.5 + k * 0.85;
      b[CH.shRRX] = -0.4 + k * 0.8;
      b[CH.shLRZ] = 0.3 + k * 0.45;
      b[CH.shRRZ] = -0.3 - k * 0.45;
      b[CH.elLRX] = -0.4 - k * 0.4;
      b[CH.elRRX] = -0.4 - k * 0.4;
      b[CH.hpLRX] = -k * 0.2;
      b[CH.knLRX] = k * 0.3;
      b[CH.knRRX] = k * 0.16;
    },
  },

  Death: {
    cycle: 1.0,
    eval(b, phase, t, style) {
      base(b);
      const k = clamp01(phase);
      const e = 1 - Math.pow(1 - k, 3);
      // The body tips about the feet, so the hips only need to crumple a
      // little on top of that or it sinks through the road.
      b[CH.rootRX] = e * 1.42;
      b[CH.rootY] = -e * 0.02;
      b[CH.hipsY] = -e * 0.12;
      b[CH.hipsRX] = e * 0.2;
      b[CH.hipsRZ] = e * 0.3;
      b[CH.torsoRX] = 0.22 + e * 0.4;
      b[CH.neckRX] = -0.14 + e * 0.55;
      b[CH.headRZ] = e * 0.4;
      b[CH.shLRX] = -0.4 + e * 1.5;
      b[CH.shRRX] = -0.4 + e * 1.25;
      b[CH.shLRZ] = 0.3 + e * 0.5;
      b[CH.shRRZ] = -0.3 - e * 0.3;
      b[CH.elLRX] = -0.3 - e * 0.4;
      b[CH.elRRX] = -0.3 - e * 0.2;
      b[CH.hpLRX] = e * -0.55;
      b[CH.hpRRX] = e * -0.28;
      b[CH.knLRX] = e * 0.8;
      b[CH.knRRX] = e * 0.45;
      b[CH.ftLRX] = e * -0.3;
    },
  },

  // ── attacks ──

  /** Horizontal sweep. Contact at CFG.anim.hitFrac.Slash. */
  Slash: {
    cycle: 1.4,
    eval(b, phase) {
      base(b);
      const u = clamp01(phase);
      const k = u < 0.44 ? -Math.pow(u / 0.44, 0.6) : 1 - Math.pow(1 - Math.min(1, (u - 0.44) / 0.56 * 1.5), 2);
      b[CH.shRRX] = -1.05 - k * 0.3;
      b[CH.shRRZ] = -1.2 + (k + 1) * 1.3;
      b[CH.elRRX] = -0.75 + k * 0.6;
      b[CH.shLRX] = -0.55 - k * 0.15;
      b[CH.shLRZ] = 0.4;
      b[CH.elLRX] = -0.95;
      b[CH.torsoRY] = -k * 0.66;
      b[CH.torsoRX] = 0.1 + Math.abs(k) * 0.06;
      b[CH.hipsRY] = -k * 0.3;
      b[CH.headRY] = -k * 0.2;
      b[CH.hpLRX] = k * 0.18;
      b[CH.hpRRX] = -k * 0.12;
      b[CH.knLRX] = 0.1 + Math.max(0, -k) * 0.2;
      b[CH.knRRX] = 0.1;
    },
  },

  /** Overhead chop — the heavy variant and the axe. */
  Slash_Heavy: {
    cycle: 1.1,
    eval(b, phase) {
      base(b);
      const u = clamp01(phase);
      const k = u < 0.46 ? -Math.pow(u / 0.46, 0.55) : 1 - Math.pow(1 - Math.min(1, (u - 0.46) / 0.54 * 1.4), 2);
      b[CH.shRRX] = -2.5 + (k + 1) * 1.75;
      b[CH.shRRZ] = -0.12;
      b[CH.elRRX] = -0.55 + k * 0.45;
      b[CH.shLRX] = -1.95 + (k + 1) * 1.35;
      b[CH.shLRZ] = 0.18;
      b[CH.elLRX] = -0.62;
      b[CH.torsoRX] = 0.08 + k * 0.4;
      b[CH.neckRX] = -0.1 - k * 0.16;
      b[CH.hipsY] = -Math.max(0, k) * 0.06;
      b[CH.hpLRX] = 0.14 + k * 0.16;
      b[CH.knLRX] = 0.16 + Math.max(0, k) * 0.24;
      b[CH.knRRX] = 0.14;
    },
  },

  /** Short forward thrust — knives. */
  Stab: {
    cycle: 2.1,
    eval(b, phase) {
      base(b);
      const u = clamp01(phase);
      const k = u < 0.4 ? -Math.pow(u / 0.4, 0.7) : 1 - Math.pow(1 - Math.min(1, (u - 0.4) / 0.6 * 1.8), 2);
      b[CH.shRRX] = -1.0 - k * 0.35;
      b[CH.shRRZ] = -0.28 + k * 0.14;
      b[CH.elRRX] = -1.45 + (k + 1) * 0.72;
      b[CH.shLRX] = -0.7;
      b[CH.elLRX] = -1.0;
      b[CH.torsoRY] = -k * 0.34;
      b[CH.torsoRX] = 0.1 + k * 0.12;
      b[CH.hipsRY] = -k * 0.14;
      b[CH.knLRX] = 0.12;
      b[CH.knRRX] = 0.12;
    },
  },

  /** Bare hands. */
  Punch: {
    cycle: 2.0,
    eval(b, phase, t, style) {
      base(b);
      const u = clamp01(phase);
      const k = u < 0.46 ? -Math.pow(u / 0.46, 0.7) : 1 - Math.pow(1 - Math.min(1, (u - 0.46) / 0.54 * 1.9), 2);
      if (style === 'zombie') {
        // Both arms, driven forward from the shoulders.
        zombieStoop(b, 1);
        const lift = -1.5 - k * 0.6;
        b[CH.shLRX] = lift;
        b[CH.shRRX] = lift;
        b[CH.shLRZ] = 0.34 - k * 0.28;
        b[CH.shRRZ] = -0.34 + k * 0.28;
        b[CH.elLRX] = -0.6 + k * 0.55;
        b[CH.elRRX] = -0.6 + k * 0.55;
        b[CH.torsoRX] += k * 0.3;
        b[CH.neckRX] += -k * 0.2;
        b[CH.headRX] = -k * 0.12;
        b[CH.hipsY] = k * 0.05;
        b[CH.hpLRX] = k * 0.16;
      } else {
        b[CH.shRRX] = -1.35 - k * 0.25;
        b[CH.shRRZ] = -0.2;
        b[CH.elRRX] = -1.6 + (k + 1) * 0.8;
        b[CH.shLRX] = -1.15;
        b[CH.shLRZ] = 0.3;
        b[CH.elLRX] = -1.5;
        b[CH.torsoRY] = -k * 0.42;
        b[CH.hipsRY] = -k * 0.2;
        b[CH.knLRX] = 0.12;
        b[CH.knRRX] = 0.12;
      }
    },
  },

  // ── overlays (blended on top, not played as states) ──

  block: {
    cycle: 0,
    eval(b) {
      base(b);
      b[CH.shLRX] = -1.5;
      b[CH.shLRZ] = 0.6;
      b[CH.elLRX] = -1.55;
      b[CH.shRRX] = -1.02;
      b[CH.shRRZ] = -0.32;
      b[CH.elRRX] = -1.25;
      b[CH.torsoRX] = 0.17;
      b[CH.neckRX] = -0.1;
      b[CH.hipsY] = -0.04;
      b[CH.knLRX] = 0.2;
      b[CH.knRRX] = 0.2;
    },
  },

  aim: {
    cycle: 0,
    eval(b) {
      base(b);
      b[CH.shRRX] = -1.6;
      b[CH.shRRZ] = -0.12;
      b[CH.elRRX] = -0.08;
      b[CH.shLRX] = -1.3;
      b[CH.shLRZ] = 0.3;
      b[CH.elLRX] = -0.62;
      b[CH.torsoRY] = -0.2;
      b[CH.torsoRX] = 0.04;
    },
  },

  recoil: {
    cycle: 0,
    eval(b) {
      base(b);
      b[CH.shRRX] = -1.14;
      b[CH.shRRZ] = -0.16;
      b[CH.elRRX] = -0.34;
      b[CH.shLRX] = -1.25;
      b[CH.elLRX] = -0.7;
      b[CH.torsoRX] = -0.12;
      b[CH.torsoRY] = -0.18;
    },
  },

  /** The kick layered on top of a hit reaction. */
  hit: {
    cycle: 0,
    eval(b) {
      base(b);
      b[CH.torsoRX] = -0.36;
      b[CH.neckRX] = -0.32;
      b[CH.headRX] = -0.26;
      b[CH.hipsRZ] = 0.16;
      b[CH.shLRX] = -0.34;
      b[CH.shRRX] = -0.3;
      b[CH.shLRZ] = 0.42;
      b[CH.shRRZ] = -0.42;
    },
  },

  /** Folded up. The rig drops to match — see CharacterRig.setCrouch. */
  crouch: {
    cycle: 0,
    eval(b) {
      base(b);
      b[CH.hipsY] = -0.1;
      b[CH.hpLRX] = 0.66;
      b[CH.hpRRX] = 0.66;
      b[CH.knLRX] = 1.0;
      b[CH.knRRX] = 1.0;
      b[CH.ftLRX] = -0.42;
      b[CH.ftRRX] = -0.42;
      b[CH.torsoRX] = 0.24;
      b[CH.neckRX] = -0.18;
      b[CH.shLRX] = -0.2;
      b[CH.shRRX] = -0.2;
      b[CH.elLRX] = -0.55;
      b[CH.elRRX] = -0.55;
    },
  },

  /** Standing still with something heavy in hand. */
  carry: {
    cycle: 0,
    eval(b) {
      base(b);
      b[CH.shRRX] = -0.42;
      b[CH.shRRZ] = -0.14;
      b[CH.elRRX] = -0.95;
      b[CH.shLRZ] = 0.1;
      b[CH.elLRX] = -0.3;
    },
  },
};

// Aliases so the zombie profile's clip lists resolve on this backend too.
POSES.Idle_Attack = POSES.Punch;
POSES.Run_Arms = POSES.Run;
POSES.Run_Attack = POSES.Run;
POSES.Idle_Gun = POSES.Idle;
POSES.Walk_Gun = POSES.Walk;
POSES.Run_Gun = POSES.Run;

// ─────────────────────────────────────────────────────────────── weapons ──

const WGEO = {};
const wgeo = (k, make) => WGEO[k] || (WGEO[k] = make());

function weaponMaterials() {
  return {
    steel: sharedMat('w-steel', () =>
      new THREE.MeshStandardMaterial({ color: 0x9298a0, roughness: 0.38, metalness: 0.8 })
    ),
    dark: sharedMat('w-dark', () =>
      new THREE.MeshStandardMaterial({ color: 0x3a3e43, roughness: 0.52, metalness: 0.72 })
    ),
    grip: sharedMat('w-grip', () =>
      new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.96, metalness: 0.02 })
    ),
    wood: sharedMat('w-wood', () =>
      new THREE.MeshStandardMaterial({ color: 0x7b5b38, roughness: 0.88, metalness: 0.0 })
    ),
    alu: sharedMat('w-alu', () =>
      new THREE.MeshStandardMaterial({ color: 0xa9aeb4, roughness: 0.3, metalness: 0.85 })
    ),
    glass: sharedMat('w-glass', () =>
      new THREE.MeshStandardMaterial({
        color: 0x4a6b52,
        roughness: 0.18,
        metalness: 0.05,
        transparent: true,
        opacity: 0.82,
      })
    ),
    rag: sharedMat('w-rag', () =>
      new THREE.MeshStandardMaterial({ color: 0xb8ab8e, roughness: 1.0, metalness: 0.0 })
    ),
  };
}

/**
 * Hand props. These are modelled rather than blocked out: a bat has a taper
 * and a knob, the crowbar has a real hook and a chisel end, the revolver has a
 * cylinder. They are small on screen, so the job is silhouette, not detail.
 */
export function buildWeaponMesh(kind) {
  const M = weaponMaterials();
  const g = new THREE.Group();
  const add = (geometry, mat) => {
    const m = new THREE.Mesh(geometry, mat);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const cyl = (rt, rb, h, y, z = 0, rx = 0, seg = 8) => {
    const c = new THREE.CylinderGeometry(rt, rb, h, seg);
    if (rx) c.rotateX(rx);
    c.translate(0, y, z);
    return c;
  };

  switch (kind) {
    case 'knife':
      add(wgeo('knife-grip', () =>
        mergeGeometries([cyl(0.017, 0.02, 0.115, -0.055), box(0.05, 0.014, 0.02, 0, 0.008, 0)])
      ), M.grip);
      add(wgeo('knife-blade', () =>
        mergeGeometries([
          box(0.022, 0.2, 0.042, 0, 0.115, 0.004),
          box(0.014, 0.06, 0.03, 0, 0.238, 0.012),
        ])
      ), M.steel);
      break;

    case 'crowbar':
      // Chunky enough to read as a bar of steel from behind the shoulder —
      // a scale-accurate crowbar is a thin dark line at this distance.
      add(wgeo('crowbar', () =>
        mergeGeometries([
          cyl(0.024, 0.024, 0.78, 0.04, 0, 0, 6),
          // hooked claw
          cyl(0.023, 0.023, 0.14, 0.44, 0.03, 0.75, 6),
          box(0.05, 0.034, 0.05, 0.0, 0.488, 0.086),
          box(0.05, 0.022, 0.07, 0.0, 0.494, 0.13),
          // chisel end
          box(0.046, 0.07, 0.03, 0, -0.37, 0.014),
        ])
      ), M.dark);
      break;

    case 'bat':
      add(wgeo('bat-grip', () =>
        mergeGeometries([cyl(0.021, 0.026, 0.2, -0.14), cyl(0.031, 0.031, 0.022, -0.248)])
      ), M.grip);
      add(wgeo('bat-body', () =>
        mergeGeometries([
          cyl(0.031, 0.022, 0.16, -0.02),
          cyl(0.038, 0.031, 0.24, 0.18),
          cyl(0.036, 0.038, 0.14, 0.37),
          sphere(0.036, 1, 0.7, 1, 0, 0.442, 0),
        ])
      ), M.alu);
      break;

    case 'axe':
      add(wgeo('axe-haft', () =>
        mergeGeometries([cyl(0.02, 0.024, 0.8, 0.04, 0, 0, 6), cyl(0.03, 0.026, 0.05, -0.375)])
      ), M.wood);
      add(wgeo('axe-head', () =>
        mergeGeometries([
          box(0.03, 0.115, 0.075, 0, 0.44, 0.012),
          box(0.026, 0.175, 0.07, 0, 0.452, 0.078),
          box(0.02, 0.2, 0.028, 0, 0.452, 0.126),
          box(0.026, 0.05, 0.06, 0, 0.428, -0.05),
        ])
      ), M.steel);
      break;

    case 'machete':
      add(wgeo('machete-grip', () =>
        mergeGeometries([
          box(0.026, 0.13, 0.036, 0, -0.06, 0),
          box(0.052, 0.016, 0.05, 0, 0.008, 0.004),        // knuckle guard
        ])
      ), M.grip);
      add(wgeo('machete-blade', () =>
        mergeGeometries([
          box(0.008, 0.34, 0.058, 0, 0.19, 0.012),
          // The belly near the tip is what makes a machete read as a machete
          // rather than a long knife from behind the shoulder.
          box(0.008, 0.11, 0.082, 0, 0.325, 0.026),
          box(0.008, 0.05, 0.05, 0, 0.4, 0.014),
        ])
      ), M.steel);
      break;

    case 'sledge':
      add(wgeo('sledge-haft', () =>
        mergeGeometries([cyl(0.023, 0.028, 0.9, 0.02, 0, 0, 6), cyl(0.033, 0.028, 0.06, -0.44)])
      ), M.wood);
      add(wgeo('sledge-head', () =>
        mergeGeometries([
          // One solid block of steel across the haft — the whole silhouette.
          box(0.075, 0.1, 0.24, 0, 0.5, 0.0),
          box(0.086, 0.09, 0.05, 0, 0.5, 0.116),
          box(0.086, 0.09, 0.05, 0, 0.5, -0.116),
        ])
      ), M.dark);
      break;

    case 'molotov':
      add(wgeo('molotov-bottle', () =>
        mergeGeometries([
          cyl(0.042, 0.05, 0.2, -0.01, 0, 0, 7),
          cyl(0.02, 0.038, 0.06, 0.118, 0, 0, 7),
        ])
      ), M.glass);
      add(wgeo('molotov-rag', () => cyl(0.014, 0.017, 0.11, 0.19, 0, 0, 5)), M.rag);
      break;

    case 'revolver':
      add(wgeo('rev-grip', () => box(0.026, 0.115, 0.058, 0, -0.05, -0.024)), M.grip);
      add(wgeo('rev-frame', () =>
        mergeGeometries([
          box(0.024, 0.062, 0.088, 0, 0.022, 0.014),
          box(0.02, 0.03, 0.16, 0, 0.036, 0.106),          // barrel
          box(0.012, 0.016, 0.028, 0, 0.052, 0.176),       // front sight
          box(0.016, 0.03, 0.02, 0, -0.004, 0.026),        // trigger guard
        ])
      ), M.dark);
      add(wgeo('rev-cyl', () => cyl(0.026, 0.026, 0.044, 0.026, 0.03, Math.PI / 2, 6)), M.steel);
      break;

    default:
      return null;
  }
  return g;
}

export { HIP_HEIGHT };
