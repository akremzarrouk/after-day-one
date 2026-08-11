/**
 * CharacterAssets.js — the skinned-character asset layer.
 *
 * Loads the GLB characters once, measures their locomotion clips so the
 * animation system can sync playback to real velocity, re-grades their palette
 * atlas into a set of drab survival-horror variants, and hands out cheap
 * instances (SkeletonUtils.clone + shared materials).
 *
 * Everything here is fail-soft. If the model files are absent — a fresh
 * checkout without the asset folder, a build that stripped them, a 404 — the
 * loader records that and `available` stays false, and CharacterRig quietly
 * falls back to the procedural humanoid in CharacterMesh.js. The game must
 * never depend on a download having happened.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import CFG from '../core/Config.js';

/**
 * Bones the rest of the system asks for by name.
 *
 * These are the *sanitised* names. glTF property paths use `.` as a separator,
 * so three.js strips it out of node names on import: the rig's `Foot.L` is
 * `FootL` by the time it reaches the scene graph, and its animation tracks are
 * named to match.
 */
export const BONES = {
  root: 'Root',
  hips: 'Hips',
  torso: 'Torso',
  neck: 'Neck',
  head: 'Head',
  tongue: 'Tongue1',
  hand: 'Middle1L',        // this pack rigs held props to the left middle finger
  footL: 'FootL',
  footR: 'FootR',
  upperLegL: 'UpperLegL',
  upperLegR: 'UpperLegR',
};

/**
 * Weapon meshes that ship parented to the hand bone, and the correction each
 * needs. The pack authors props oversized for a chunky cartoon silhouette;
 * against a 1.8 m survivor they want bringing back toward real proportions.
 */
const WEAPON_NODES = {
  Axe: 0.62,                // ≈0.96 m haft
  Knife: 0.45,              // ≈0.45 m — a shade over-scale so it reads
  Pistol: 0.32,             // ≈0.33 m
  WoodenBat_Barbed: 0.62,   // ≈0.92 m
};

/** Grip transforms measured from the pack, reused for procedural props. */
const GRIP = {
  melee: { pos: [0.012, 0.105, -0.046], quat: [0.433, 0.557, 0.44, 0.556] },
  gun: { pos: [0.036, 0.045, -0.045], quat: [0.433, 0.557, 0.44, 0.556] },
};

const MODELS = {
  player: { file: 'survivor.glb', weapons: true },
  shambler: { file: 'zombie_basic.glb' },
  stalker: { file: 'zombie_arm.glb' },
  bloated: { file: 'zombie_chubby.glb' },
};

// ───────────────────────────────────────────────────────── palette grade ──

/**
 * The source atlases are flat 16px colour cells in bright cartoon primaries.
 * Re-grading them is what makes these characters belong in this game: hues are
 * pulled toward earth, saturation is capped hard, and values are dropped.
 * Per-variant offsets on top of that give us the individuals.
 */
const EARTH_HUE = 35 / 360;

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(ch(h + 1 / 3) * 255),
    Math.round(ch(h) * 255),
    Math.round(ch(h - 1 / 3) * 255),
  ];
}

/**
 * Survivor stays a little warmer and a little brighter than the dead — the
 * player has to stay readable against a dark street.
 */
const SURVIVOR_GRADE = { pull: 0.42, hue: 0.0, sat: 0.46, satCap: 0.36, lum: 0.86, lift: 0.0 };

/**
 * Held props get a lighter touch than the body: steel keeps its cold cast and
 * wood keeps its warmth, so a bat does not vanish into a brown jacket. They
 * still lose most of the pack's cartoon brightness.
 */
const WEAPON_GRADE = { pull: 0.18, hue: 0.0, sat: 0.6, satCap: 0.44, lum: 1.05, lift: 0.04 };

/**
 * Eight looks per zombie family: skin tone, clothing hue and overall value all
 * move together, which is what makes two of them read as different people
 * rather than the same person under a different light.
 */
const ZOMBIE_GRADES = [
  { pull: 0.62, hue: -0.02, sat: 0.30, satCap: 0.24, lum: 0.72, lift: 0.02 },  // ash olive
  { pull: 0.40, hue: 0.035, sat: 0.42, satCap: 0.32, lum: 0.52, lift: 0.03 },  // dried blood
  { pull: 0.80, hue: -0.05, sat: 0.16, satCap: 0.12, lum: 1.02, lift: 0.02 },  // bleached, bloodless
  { pull: 0.34, hue: 0.075, sat: 0.40, satCap: 0.34, lum: 0.86, lift: 0.02 },  // jaundice
  { pull: 0.70, hue: -0.115, sat: 0.26, satCap: 0.22, lum: 0.60, lift: 0.06 }, // cold slate
  { pull: 0.50, hue: 0.005, sat: 0.44, satCap: 0.33, lum: 0.94, lift: 0.0 },   // dust and rust
  { pull: 0.66, hue: 0.105, sat: 0.28, satCap: 0.24, lum: 0.78, lift: 0.01 },  // mould green
  { pull: 0.44, hue: -0.045, sat: 0.34, satCap: 0.28, lum: 0.44, lift: 0.05 }, // soot
];

/** Atlas size after the re-grade. Cells are 16px, so a nearest halving is lossless. */
const GRADE_SIZE = 256;

/** Keyed by source-image UUID so models sharing an atlas share their variants. */
const _gradeCache = new Map();

function gradeAtlas(sourceTex, grade, cacheKey) {
  const hit = _gradeCache.get(cacheKey);
  if (hit) return hit;

  const img = sourceTex.image;
  const c = document.createElement('canvas');
  c.width = c.height = GRADE_SIZE;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, GRADE_SIZE, GRADE_SIZE);

  const data = ctx.getImageData(0, 0, GRADE_SIZE, GRADE_SIZE);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] === 0) continue;
    let [h, s, l] = rgbToHsl(p[i], p[i + 1], p[i + 2]);
    // shortest way round the wheel toward the earth-tone anchor
    const dh = ((EARTH_HUE - h + 1.5) % 1) - 0.5;
    h = (h + dh * grade.pull + grade.hue + 1) % 1;
    s = Math.min(grade.satCap, s * grade.sat);
    l = Math.max(0.02, Math.min(0.95, l * grade.lum + grade.lift));
    const rgb = hslToRgb(h, s, l);
    p[i] = rgb[0];
    p[i + 1] = rgb[1];
    p[i + 2] = rgb[2];
  }
  ctx.putImageData(data, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;                 // glTF UV convention
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 2;
  tex.needsUpdate = true;
  _gradeCache.set(cacheKey, tex);
  return tex;
}

// ────────────────────────────────────────────────────────── clip analysis ──

/**
 * Strip horizontal root translation so a locomotion clip plays in place —
 * the controller owns where the character actually is.
 */
function stripRootMotion(clip) {
  for (const track of clip.tracks) {
    if (track.name !== `${BONES.root}.position`) continue;
    const v = track.values;
    const x = v[0];
    const z = v[2];
    for (let i = 0; i < v.length; i += 3) {
      v[i] = x;
      v[i + 2] = z;
    }
  }
}

/**
 * Sample a locomotion clip to find (a) how fast the character would actually
 * be travelling if the animation were driving it, and (b) the moments both
 * feet touch down. (a) removes foot sliding, (b) gives us real footstep timing
 * instead of a wall-clock timer.
 */
function analyseLocomotion(proto, clip) {
  const SAMPLES = 64;
  const rig = skeletonClone(proto);
  const mixer = new THREE.AnimationMixer(rig);
  mixer.clipAction(clip).play();

  const hips = rig.getObjectByName(BONES.hips);
  const feet = [rig.getObjectByName(BONES.footL), rig.getObjectByName(BONES.footR)].filter(Boolean);
  if (!feet.length || !hips) return { refSpeed: 1.4, plants: [0.05, 0.55] };

  const tmp = new THREE.Vector3();
  const hipTmp = new THREE.Vector3();
  const y = feet.map(() => new Float32Array(SAMPLES));
  const z = feet.map(() => new Float32Array(SAMPLES));

  for (let i = 0; i < SAMPLES; i++) {
    mixer.setTime((i / SAMPLES) * clip.duration);
    rig.updateMatrixWorld(true);
    hips.getWorldPosition(hipTmp);
    for (let f = 0; f < feet.length; f++) {
      feet[f].getWorldPosition(tmp);
      y[f][i] = tmp.y;
      z[f][i] = tmp.z - hipTmp.z;
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(rig);

  // Stride: how far a foot travels front-to-back relative to the hips. The
  // body covers one of those per step and there are two steps in a cycle.
  let stride = 0;
  for (let f = 0; f < feet.length; f++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < SAMPLES; i++) {
      if (z[f][i] < lo) lo = z[f][i];
      if (z[f][i] > hi) hi = z[f][i];
    }
    stride = Math.max(stride, hi - lo);
  }
  const refSpeed = Math.max(0.35, (2 * stride) / Math.max(0.05, clip.duration));

  // Foot plants: local minima of foot height, in the lower third of its range.
  const plants = [];
  for (let f = 0; f < feet.length; f++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < SAMPLES; i++) {
      if (y[f][i] < lo) lo = y[f][i];
      if (y[f][i] > hi) hi = y[f][i];
    }
    const gate = lo + (hi - lo) * 0.32;
    for (let i = 0; i < SAMPLES; i++) {
      const prev = y[f][(i - 1 + SAMPLES) % SAMPLES];
      const next = y[f][(i + 1) % SAMPLES];
      if (y[f][i] <= prev && y[f][i] < next && y[f][i] <= gate) plants.push(i / SAMPLES);
    }
  }
  plants.sort((a, b) => a - b);

  // A flat-footed clip can produce a run of near-equal minima; keep one each.
  const merged = [];
  for (const t of plants) {
    if (!merged.length || t - merged[merged.length - 1] > 0.12) merged.push(t);
  }
  if (merged.length < 2) merged.splice(0, merged.length, 0.05, 0.55);

  return { refSpeed: refSpeed * CFG.anim.strideTrim, plants: merged };
}

// ───────────────────────────────────────────────────────────── the store ──

class CharacterAssetStore {
  constructor() {
    this.ready = false;
    this.available = false;
    this.models = new Map();
    this.failures = [];
  }

  /**
   * Load every character. Resolves either way — a rejection here would take
   * the whole game down, and a missing model is only ever a downgrade.
   */
  async load(onProgress) {
    if (this.ready) return this.available;
    this.ready = true;
    if (!CFG.anim.useModels) return false;

    const loader = new GLTFLoader();
    const base = CFG.anim.modelPath;
    const keys = Object.keys(MODELS);

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const spec = MODELS[key];
      try {
        const gltf = await loader.loadAsync(base + spec.file);
        this.models.set(key, this._prepare(key, gltf, spec));
      } catch (e) {
        this.failures.push(`${spec.file}: ${e?.message || e}`);
      }
      onProgress?.((i + 1) / keys.length, spec.file);
    }

    // All or nothing: a half-loaded cast would mix art styles mid-scene.
    this.available = this.models.size === keys.length;
    if (!this.available) {
      console.warn(
        '[characters] falling back to procedural humanoids —',
        this.failures.join('; ') || 'no models found'
      );
      this.models.clear();
    }
    return this.available;
  }

  _prepare(key, gltf, spec) {
    const A = CFG.anim;
    const proto = gltf.scene;

    /**
     * Proportion pass, applied to the prototype so every clone inherits it and
     * — more importantly — so the stride measurement below sees the legs we
     * actually render. None of the clips animate bone scale, so this sticks.
     */
    proto.traverse((o) => {
      if (!o.isBone) return;
      if (o.name === BONES.head) o.scale.setScalar(A.headScale);
      else if (o.name === BONES.neck) o.scale.set(1, A.neckStretch, 1);
      else if (o.name === BONES.upperLegL || o.name === BONES.upperLegR) {
        o.scale.set(1, A.legStretch, 1);
      } else if (o.name === BONES.tongue) {
        // The lolling cartoon tongue is the most out-of-place thing in the
        // pack; collapsing its root bone removes the whole chain.
        o.scale.setScalar(0.001);
      }
    });
    proto.traverse((o) => {
      if (o.isMesh && o.name === 'Tongue') o.visible = false;
    });
    proto.updateMatrixWorld(true);

    // Height of the bind pose, so we can scale to a real-world metre target.
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    proto.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      o.geometry.computeBoundingBox();
      tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      box.union(tmp);
      // Skinned bounds are computed from the bind pose; a mid-swing arm can
      // leave it, so inflate rather than let characters pop out of frame.
      o.geometry.computeBoundingSphere();
      o.geometry.boundingSphere.radius *= 1.9;
    });
    const height = Math.max(0.5, box.max.y - box.min.y);

    const clips = new Map();
    for (const c of gltf.animations) clips.set(c.name, c);
    for (const name of ['Walk', 'Run', 'Run_Arms', 'Run_Attack']) {
      const c = clips.get(name);
      if (c) stripRootMotion(c);
    }

    // Only the gaits need measuring; everything else is a one-shot or a pose.
    const locomotion = new Map();
    for (const name of ['Walk', 'Walk_Gun', 'Run', 'Run_Gun', 'Run_Arms', 'Run_Attack']) {
      const c = clips.get(name);
      if (c) locomotion.set(name, analyseLocomotion(proto, c));
    }

    // One material per variant, shared by every instance wearing that look.
    let source = null;
    proto.traverse((o) => {
      if (o.isMesh && o.material && !source) source = o.material;
    });
    const grades = key === 'player' ? [SURVIVOR_GRADE] : ZOMBIE_GRADES;
    const variants = grades.map((g, i) => {
      const m = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.95,
        metalness: 0.0,
      });
      if (source?.map) m.map = gradeAtlas(source.map, g, `${key}:${i}`);
      return m;
    });

    let weaponMat = null;
    if (spec.weapons) {
      weaponMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.72,
        metalness: 0.15,
      });
      if (source?.map) weaponMat.map = gradeAtlas(source.map, WEAPON_GRADE, `${key}:weapon`);
    }

    return { key, proto, clips, locomotion, variants, weaponMat, height, weapons: !!spec.weapons };
  }

  has(key) {
    return this.models.has(key);
  }

  /**
   * A ready-to-use character. Materials and geometry are shared; only the
   * skeleton, the mixer and a handful of Object3Ds are per-instance.
   */
  instance(key, variant = 0, opts = {}) {
    const rec = this.models.get(key);
    if (!rec) return null;

    const armature = skeletonClone(rec.proto);

    const bones = {};
    const weapons = new Map();
    armature.traverse((o) => {
      if (o.isBone) {
        for (const k in BONES) if (o.name === BONES[k]) bones[k] = o;
      } else if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (rec.weapons && WEAPON_NODES[o.name]) {
          weapons.set(o.name, o);
          o.material = rec.weaponMat;
          o.visible = false;
          o.scale.multiplyScalar(WEAPON_NODES[o.name]);
        } else {
          o.material = rec.variants[variant % rec.variants.length];
        }
      }
    });

    // Per-individual silhouette: bulk on the torso, height on the whole body.
    // (The shared proportion pass already happened on the prototype.)
    if (opts.bulk && opts.bulk !== 1 && bones.torso) {
      bones.torso.scale.set(opts.bulk, 1, opts.bulk);
    }

    const scale = ((opts.height || rec.height) / rec.height) * (opts.jitter || 1);
    armature.scale.setScalar(scale);

    // A holder so callers can set position/rotation.y exactly as before while
    // the armature keeps its own scale.
    const root = new THREE.Group();
    root.add(armature);

    // Anchor for props we model ourselves (the crowbar), matching the pack's grip.
    let anchor = null;
    if (bones.hand) {
      anchor = new THREE.Group();
      anchor.position.fromArray(GRIP.melee.pos);
      anchor.quaternion.fromArray(GRIP.melee.quat);
      bones.hand.add(anchor);
    }

    const mixer = new THREE.AnimationMixer(armature);

    return {
      root,
      armature,
      mixer,
      bones,
      weapons,
      anchor,
      scale,
      clips: rec.clips,
      locomotion: rec.locomotion,
      modelHeight: rec.height,
    };
  }
}

export const CharacterAssets = new CharacterAssetStore();
export default CharacterAssets;
