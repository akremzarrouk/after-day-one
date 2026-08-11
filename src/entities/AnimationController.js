/**
 * AnimationController.js — one animation brain for every character.
 *
 * The player and all 45 zombies drive the same controller. It owns:
 *
 *   · a named state machine (idle / walk / run / attack / block / stagger /
 *     death and the zombie gaits), with per-transition crossfades from Config,
 *   · gait selection and playback rate derived from *actual* velocity, so feet
 *     do not slide,
 *   · one-shot overlays for attacks and hit reactions, time-warped so the
 *     contact frame lands exactly on the windup end that Items.js declares —
 *     the animation bends to the combat numbers, never the reverse,
 *   · footstep events fired at real foot-plants measured from the clips,
 *   · distance LOD, so a street full of the dead costs what it should.
 *
 * Two backends implement the same small interface: `SkinnedBackend` drives a
 * glTF AnimationMixer, `ProceduralBackend` drives the hand-built humanoid in
 * CharacterMesh.js. Nothing above this file knows or cares which is in use.
 */

import * as THREE from 'three';
import CFG from '../core/Config.js';
import { clamp } from '../core/Utils.js';
import { POSES, applyPose, blendPose, makePoseBuffer } from './CharacterMesh.js';

// ───────────────────────────────────────────────────────── state tables ──

/**
 * Each state names the clips it would like, best first — a model that is
 * missing one (the one-armed zombie has no `Idle_Attack`) falls through to the
 * next. `gait` marks the states whose rate tracks velocity.
 */
const PROFILES = {
  player: {
    states: {
      idle: { clips: ['Idle'], armed: ['Idle_Gun'], loop: true },
      walk: { clips: ['Walk'], armed: ['Walk_Gun'], loop: true, gait: 'walk' },
      run: { clips: ['Run'], armed: ['Run_Gun'], loop: true, gait: 'run' },
      jump: { clips: ['Jump'], loop: false },
      fall: { clips: ['Jump_Idle'], loop: true },
      land: { clips: ['Jump_Land'], loop: false },
      // The pack's `Duck` turns out to be a dive-roll, so the guard is the
      // idle base plus a bone overlay — which also lets you block while moving.
      block: { clips: ['Idle'], loop: true, overlay: 'block' },
      stagger: { clips: ['HitReact'], loop: false },
      death: { clips: ['Death'], loop: false },
    },
    attacks: {
      light: ['Slash'],
      // The procedural rig has a dedicated overhead chop; the pack does not,
      // so it falls back to the sweep played over a longer windup.
      heavy: ['Slash_Heavy', 'Slash'],
      stab: ['Stab'],
      punch: ['Punch'],
      shoot: [],            // no clip: the gun pose plus a recoil overlay
    },
  },

  zombie: {
    states: {
      idle: { clips: ['Idle'], loop: true },
      wander: { clips: ['Walk'], loop: true, gait: 'walk' },
      shamble: { clips: ['Walk'], loop: true, gait: 'walk' },
      lurch: { clips: ['Run_Arms', 'Run'], loop: true, gait: 'run' },
      chase: { clips: ['Run_Attack', 'Run_Arms', 'Run'], loop: true, gait: 'run' },
      stagger: { clips: ['HitReact'], loop: false },
      death: { clips: ['Death'], loop: false },
    },
    attacks: {
      light: ['Idle_Attack', 'Punch'],
      heavy: ['Idle_Attack', 'Punch'],
    },
  },
};

/** Gait candidates in preference order, per intent. */
const GAITS = {
  walk: ['Walk', 'Walk_Gun', 'Run', 'Run_Arms'],
  run: ['Run', 'Run_Gun', 'Run_Arms', 'Run_Attack', 'Walk'],
};

/** `from_to` → seconds, with `*` wildcards. See CFG.anim.fade. */
function fadeFor(from, to) {
  const F = CFG.anim.fade;
  return (
    F[`${from}_${to}`] ??
    F[`${from}_*`] ??
    F[`*_${to}`] ??
    F.default
  );
}

// ──────────────────────────────────────────────────────── skinned backend ──

/**
 * Bones the additive attack layer is allowed to keep. Names are the sanitised
 * ones three.js produces on glTF import (`UpperArm.L` → `UpperArmL`), which is
 * also how the animation tracks are named.
 */
const UPPER_BODY = new Set([
  'Abdomen', 'Torso', 'Neck', 'Head',
  'ShoulderL', 'UpperArmL', 'LowerArmL',
  'ShoulderR', 'UpperArmR', 'LowerArmR',
  'Index1L', 'Index2L', 'Index3L', 'Middle1L', 'Middle2L', 'Middle3L',
  'Pinky1L', 'Pinky2L', 'Pinky3L', 'Thumb1L', 'Thumb2L',
  'Index1R', 'Index2R', 'Index3R', 'Middle1R', 'Middle2R', 'Middle3R',
  'Pinky1R', 'Pinky2R', 'Pinky3R', 'Thumb1R', 'Thumb2R',
]);

/**
 * Local-space rotation deltas layered on top of whatever the mixer produced.
 * Applied after the mixer writes and before the matrices update, so they never
 * accumulate. Euler XYZ radians, in each bone's own space.
 */
const OVERLAYS = {
  block: {
    UpperArmL: [-0.55, 0.0, -0.75],
    LowerArmL: [-0.95, 0.0, 0.0],
    UpperArmR: [-0.4, 0.0, 0.5],
    LowerArmR: [-0.8, 0.0, 0.0],
    Torso: [0.14, 0.0, 0.0],
    Head: [0.12, 0.0, 0.0],
    UpperLegL: [0.18, 0.0, 0.0],
    UpperLegR: [-0.1, 0.0, 0.0],
  },
  /**
   * A short kick layered on top of `HitReact`, which is only two keyframes in
   * this pack and lands soft on its own.
   */
  hit: {
    Torso: [-0.34, 0.0, 0.0],
    Neck: [-0.3, 0.0, 0.0],
    Head: [-0.28, 0.0, 0.0],
    UpperArmL: [-0.3, 0.0, -0.4],
    UpperArmR: [-0.28, 0.0, 0.4],
    Abdomen: [-0.14, 0.0, 0.12],
  },
  /**
   * The scream. Head thrown back, chest open, arms dropped and pulled behind —
   * the one pose in the game that has to be legible as a *shape* at thirty
   * metres in bad light, because recognising it is the whole counterplay.
   */
  scream: {
    Head: [-0.95, 0.0, 0.0],
    Neck: [-0.42, 0.0, 0.0],
    Torso: [-0.3, 0.0, 0.0],
    Abdomen: [-0.16, 0.0, 0.0],
    UpperArmL: [0.85, 0.0, -0.55],
    UpperArmR: [0.85, 0.0, 0.55],
    LowerArmL: [-0.35, 0.0, 0.0],
    LowerArmR: [-0.35, 0.0, 0.0],
  },
  aim: {
    UpperArmL: [-1.0, 0.0, -0.18],
    LowerArmL: [0.22, 0.0, 0.0],
    Torso: [-0.06, 0.16, 0.0],
  },
  recoil: {
    UpperArmL: [0.55, 0.0, 0.0],
    LowerArmL: [0.3, 0.0, 0.0],
    Torso: [-0.14, 0.0, 0.0],
  },
  /**
   * Crouching, upper body only.
   *
   * The legs are deliberately left alone. This rig has no IK, so folding the
   * thighs from the hip swings the feet up and forward and the whole character
   * sinks through the road — bending the knees is exactly the thing you cannot
   * do without something to pin the feet with. The height change comes from
   * CharacterRig.setCrouch shortening the body instead, and this overlay sells
   * it with the posture: hunched, head down, arms in.
   */
  crouch: {
    Torso: [0.3, 0.0, 0.0],
    Abdomen: [0.18, 0.0, 0.0],
    Neck: [-0.22, 0.0, 0.0],
    Head: [-0.1, 0.0, 0.0],
    UpperArmL: [-0.28, 0.0, -0.14],
    LowerArmL: [-0.3, 0.0, 0.0],
    UpperArmR: [-0.28, 0.0, 0.14],
    LowerArmR: [-0.3, 0.0, 0.0],
  },
  // No `carry` here on purpose. These characters are authored holding a prop,
  // so `Idle` already carries the weapon properly and an overlay on top just
  // shoves it out sideways. The procedural rig, whose arms start empty, does
  // define one — see POSES.carry.
};

const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _e = new THREE.Euler();

class SkinnedBackend {
  constructor(rig) {
    this.rig = rig;
    this.mixer = rig.mixer;
    this.clips = rig.clips;
    this.locomotion = rig.locomotion;

    this.current = null;        // { action, name, loop }
    this.oneShot = null;        // { action, clip, additive }
    this._additive = new Map(); // clip name → additive, upper-body-only copy
    this._overlays = new Map(); // name → weight
    this._bones = rig.bones;
    this._boneByName = new Map();
    rig.armature.traverse((o) => {
      if (o.isBone) this._boneByName.set(o.name, o);
    });
  }

  has(name) {
    return this.clips.has(name);
  }

  /**
   * Strides are measured on the prototype, which is in model units — a short
   * zombie and a tall one running the same clip cover different ground. Scale
   * brings it back to metres per second.
   */
  refSpeed(name) {
    return (this.locomotion.get(name)?.refSpeed ?? 1.4) * this.rig.scale;
  }

  footPlants(name) {
    return this.locomotion.get(name)?.plants ?? null;
  }

  /** 0..1 through the current looping clip — the footstep clock. */
  phase() {
    const c = this.current;
    if (!c || !c.action) return 0;
    const d = c.action.getClip().duration || 1;
    return ((c.action.time % d) + d) % d / d;
  }

  play(name, { fade = 0.2, loop = true, hold = null } = {}) {
    if (this.current?.name === name && hold === null) return;
    const clip = this.clips.get(name);
    if (!clip) return;

    const next = this.mixer.clipAction(clip);
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !loop;
    next.timeScale = 1;

    if (hold !== null) {
      next.paused = true;
      next.time = hold * clip.duration;
    }

    const prev = this.current?.action;
    if (fade <= 0.001) {
      // A zero-length crossfade leaves three.js with a degenerate interpolant,
      // so a hard cut is done by hand.
      if (prev && prev !== next) prev.stop();
      next.setEffectiveWeight(1);
    } else if (prev && prev !== next) {
      next.crossFadeFrom(prev, fade, false);
    } else if (!prev) {
      next.fadeIn(fade);
    }
    next.play();
    this.current = { action: next, name, loop };
  }

  setRate(rate) {
    if (this.current?.action && !this.current.action.paused) {
      this.current.action.timeScale = rate;
    }
  }

  /**
   * Attacks and hit reactions. When the character is moving we play an
   * additive, upper-body-only copy so the legs keep running underneath;
   * standing still we play the clip whole, which is how it was authored.
   */
  startOneShot(name, additive) {
    const base = this.clips.get(name);
    if (!base) return false;
    this.stopOneShot(0);

    let clip = base;
    if (additive) {
      clip = this._additive.get(name);
      if (!clip) {
        const c = base.clone();
        c.tracks = c.tracks.filter((t) => UPPER_BODY.has(t.name.split('.').slice(0, -1).join('.')));
        if (!c.tracks.length) {
          additive = false;
          clip = base;
        } else {
          THREE.AnimationUtils.makeClipAdditive(c);
          c.name = name + '_additive';
          this._additive.set(name, c);
          clip = c;
        }
      }
    }

    const a = this.mixer.clipAction(clip);
    a.reset();
    a.enabled = true;
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.blendMode = additive ? THREE.AdditiveAnimationBlendMode : THREE.NormalAnimationBlendMode;
    a.paused = true;                 // the controller drives time, not the mixer
    a.time = 0;
    a.setEffectiveWeight(0);
    a.play();
    this.oneShot = { action: a, additive, weight: 0 };
    return true;
  }

  /** u01: warped progress through the clip. w: blend weight. */
  setOneShot(u01, w) {
    const os = this.oneShot;
    if (!os) return;
    const d = os.action.getClip().duration || 1;
    os.action.time = clamp(u01, 0, 0.999) * d;
    os.weight = w;
    os.action.setEffectiveWeight(w);
    // A full-body one-shot has to take the base clip's place, not average with it.
    if (!os.additive && this.current?.action) {
      this.current.action.setEffectiveWeight(1 - w);
    }
  }

  stopOneShot() {
    if (!this.oneShot) return;
    this.oneShot.action.stop();
    this.oneShot.action.setEffectiveWeight(0);
    this.oneShot = null;
    if (this.current?.action) this.current.action.setEffectiveWeight(1);
  }

  setOverlay(name, weight) {
    if (weight <= 0.001) this._overlays.delete(name);
    else this._overlays.set(name, Math.min(1, weight));
  }

  tick(dt) {
    this.mixer.update(dt);
    if (this._overlays.size) this._applyOverlays();
  }

  _applyOverlays() {
    for (const [name, w] of this._overlays) {
      const pose = OVERLAYS[name];
      if (!pose) continue;
      for (const boneName in pose) {
        const bone = this._boneByName.get(boneName);
        if (!bone) continue;
        const r = pose[boneName];
        _e.set(r[0], r[1], r[2]);
        _q.setFromEuler(_e);
        _qi.identity().slerp(_q, w);
        bone.quaternion.multiply(_qi);
      }
    }
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.rig.armature);
    this._additive.clear();
    this._overlays.clear();
  }
}

// ─────────────────────────────────────────────────────── procedural backend ──

/**
 * The fallback. Same interface, but instead of clips it evaluates the pose
 * functions in CharacterMesh.js into a flat channel buffer, which lets it
 * crossfade between states exactly the way the mixer does.
 */
class ProceduralBackend {
  constructor(rig) {
    this.rig = rig;
    this.parts = rig.parts;
    // A shambler and a survivor share the pose library but not the delivery,
    // so cycle timing, stride and foot-plants are all keyed by style.
    this.style = rig.style === 'zombie' ? 'zombie' : 'human';

    this.a = makePoseBuffer();      // outgoing state
    this.b = makePoseBuffer();      // incoming state
    this.out = makePoseBuffer();
    this.osBuf = makePoseBuffer();

    this.current = { name: null, pose: null, phase: 0 };
    this.prev = { name: null, pose: null, phase: 0 };
    this.blend = 1;                 // 0 = fully prev, 1 = fully current
    this.blendRate = 0;
    this.rate = 1;
    this.t = 0;
    this.oneShot = null;
    this._overlays = new Map();
  }

  has(name) {
    return !!POSES[name];
  }

  /** Pose fields may be a plain value or `{ human, zombie }`. */
  _styled(v, fallback) {
    if (v === undefined || v === null) return fallback;
    return typeof v === 'object' && !Array.isArray(v) ? v[this.style] ?? fallback : v;
  }

  /**
   * Reference speeds for the hand-built cycles: the speed each cycle was tuned
   * to look right at. The same rate maths as the skinned path applies.
   */
  refSpeed(name) {
    // Cycles are authored in metres for a full-size humanoid, so a shorter or
    // taller build covers proportionally less or more ground — same correction
    // the skinned path makes.
    return this._styled(POSES[name]?.refSpeed, 1.4) * (this.rig.scale || 1);
  }

  footPlants(name) {
    return this._styled(POSES[name]?.plants, null);
  }

  phase() {
    return this.current.phase % 1;
  }

  play(name, { fade = 0.2, loop = true, hold = null } = {}) {
    if (this.current.name === name && hold === null) return;
    this.prev = { ...this.current };
    this.current = { name, pose: POSES[name], phase: hold ?? 0, loop };
    this.blend = this.prev.name ? 0 : 1;
    this.blendRate = fade > 0.001 ? 1 / fade : 1000;
    this.hold = hold;
  }

  setRate(rate) {
    this.rate = rate;
  }

  startOneShot(name) {
    if (!POSES[name]) return false;
    this.oneShot = { pose: POSES[name], u: 0, w: 0 };
    return true;
  }

  setOneShot(u01, w) {
    if (!this.oneShot) return;
    this.oneShot.u = clamp(u01, 0, 1);
    this.oneShot.w = w;
  }

  stopOneShot() {
    this.oneShot = null;
  }

  setOverlay(name, weight) {
    if (weight <= 0.001) this._overlays.delete(name);
    else this._overlays.set(name, Math.min(1, weight));
  }

  tick(dt) {
    this.t += dt;
    const cur = this.current;
    if (!cur.pose) return;
    const style = this.style;

    const advance = dt * this.rate * this._styled(cur.pose.cycle, 1);
    if (this.hold === null || this.hold === undefined) {
      cur.phase += advance;
      if (!cur.loop) cur.phase = Math.min(cur.phase, 0.999);
    }
    if (this.prev.pose) this.prev.phase += advance;

    cur.pose.eval(this.b, cur.phase, this.t, style);
    if (this.blend < 1 && this.prev.pose) {
      this.prev.pose.eval(this.a, this.prev.phase, this.t, style);
      this.blend = Math.min(1, this.blend + dt * this.blendRate);
      blendPose(this.out, this.a, this.b, this.blend);
    } else {
      this.blend = 1;
      this.out.set(this.b);
    }

    if (this.oneShot && this.oneShot.w > 0.001) {
      this.oneShot.pose.eval(this.osBuf, this.oneShot.u, this.t, style);
      blendPose(this.out, this.out, this.osBuf, this.oneShot.w);
    }

    for (const [name, w] of this._overlays) {
      const p = POSES[name];
      if (!p) continue;
      p.eval(this.osBuf, 0, this.t, style);
      blendPose(this.out, this.out, this.osBuf, w);
    }

    applyPose(this.parts, this.out);
  }

  dispose() {
    this._overlays.clear();
  }
}

// ────────────────────────────────────────────────────────── the controller ──

export class AnimationController {
  /**
   * @param rig      output of CharacterAssets.instance() or buildProceduralRig()
   * @param profile  'player' | 'zombie'
   */
  constructor(rig, profile = 'zombie') {
    this.rig = rig;
    this.profile = PROFILES[profile] || PROFILES.zombie;
    this.skinned = !!rig.mixer;
    this.backend = this.skinned ? new SkinnedBackend(rig) : new ProceduralBackend(rig);

    this.state = null;
    this.armed = false;
    this.speed = 0;
    this._gaitClip = null;
    this._phasePrev = 0;
    this._lodAccum = 0;
    this._blockWeight = 0;
    this._recoil = 0;
    this._carry = 0;
    this._hit = 0;
    this._crouch = 0;
    this._crouchWant = 0;
    this._scream = 0;
    this._screamWant = 0;

    this._oneShot = null;   // { name, t, windup, total, hitFrac, fadeOut }

    /** Fired at every foot-plant of a locomotion clip. */
    this.onFootstep = null;
    /** Fired once when a one-shot reaches its contact frame. */
    this.onContact = null;

    this.request('idle');
  }

  // ───────────────────────────────────────────────────────────── states ──

  /**
   * Ask for a state. Repeated calls with the same state are free, so callers
   * can just describe what the character is doing every frame.
   */
  request(state, opts = {}) {
    if (state === this.state && opts.armed === undefined) return;
    if (opts.armed !== undefined) {
      if (state === this.state && opts.armed === this.armed) return;
      this.armed = opts.armed;
    }
    const def = this.profile.states[state];
    if (!def) return;

    const fade = opts.fade ?? fadeFor(this.state || 'idle', state);
    // Entering a stagger snaps the hit overlay on; it decays from there.
    if (state === 'stagger' && this.state !== 'stagger') this._hit = 1;
    this.state = state;
    this._gaitClip = null;

    const clip = this._resolve(def);
    if (clip) {
      this.backend.play(clip, { fade, loop: !!def.loop, hold: def.hold ?? null });
      this._phasePrev = this.backend.phase();
    }
    this._blockTarget = def.overlay === 'block' ? 1 : 0;
  }

  /** First clip in the list this model actually has. */
  _resolve(def) {
    const list = (this.armed && def.armed) || def.clips;
    for (const n of list) if (this.backend.has(n)) return n;
    for (const n of def.clips) if (this.backend.has(n)) return n;
    return null;
  }

  /**
   * Pick the gait clip whose authored speed is closest to how fast we are
   * really going, then rate-match it. This is what removes foot sliding: at
   * 3 m/s the survivor jogs rather than over-cranking a walk cycle.
   */
  _selectGait(intent, speed) {
    const A = CFG.anim;
    let best = null;
    let bestErr = Infinity;
    const armedSuffix = this.armed ? '_Gun' : null;

    for (const name of GAITS[intent] || GAITS.walk) {
      const pick = armedSuffix && this.backend.has(name + armedSuffix) ? name + armedSuffix : name;
      if (!this.backend.has(pick)) continue;
      const ref = this.backend.refSpeed(pick);
      const need = speed / Math.max(0.1, ref);
      // How far outside the usable rate window this clip would have to run.
      const over = need > A.rateMax ? need - A.rateMax : need < A.rateMin ? A.rateMin - need : 0;
      const err = over * 10 + Math.abs(Math.log(Math.max(0.05, need)));
      if (err < bestErr) {
        bestErr = err;
        best = pick;
      }
    }
    return best;
  }

  // ──────────────────────────────────────────────────────────── one-shots ──

  /**
   * Play an attack or reaction over the top of whatever is running.
   *
   * `windup` and `total` come straight from Items.js / Config.js. The clip is
   * time-warped so its contact frame lands exactly at `windup`, which means
   * retiming a weapon never desyncs its animation from its hitbox.
   */
  attack(kind, windup, total) {
    const list = this.profile.attacks?.[kind];
    if (!list || !list.length) return false;
    let name = null;
    for (const n of list) if (this.backend.has(n)) { name = n; break; }
    if (!name) return false;

    const additive = this.speed > CFG.anim.overlayAboveSpeed;
    if (!this.backend.startOneShot(name, additive)) return false;

    this._oneShot = {
      name,
      t: 0,
      windup: Math.max(0.001, windup),
      total: Math.max(windup + 0.02, total),
      hitFrac: CFG.anim.hitFrac[name] ?? CFG.anim.hitFrac.default,
      fired: false,
    };
    return true;
  }

  cancelOneShot() {
    if (!this._oneShot) return;
    this._oneShot = null;
    this.backend.stopOneShot();
  }

  get busy() {
    return !!this._oneShot;
  }

  // ─────────────────────────────────────────────────────────────── update ──

  /**
   * @param ctx { speed, distance, blocking, aiming, carrying }
   */
  update(dt, ctx = {}) {
    const A = CFG.anim;
    this.speed = ctx.speed || 0;

    // Rate-match the gait before ticking so the phase we read is the right one.
    const def = this.profile.states[this.state];
    if (def?.gait) {
      const clip = this._selectGait(def.gait, this.speed);
      if (clip && clip !== this._gaitClip) {
        // Switching cycle mid-stride: a short fade hides the seam.
        this.backend.play(clip, { fade: this._gaitClip ? 0.12 : fadeFor('idle', this.state), loop: true });
        this._gaitClip = clip;
        this._phasePrev = this.backend.phase();
      }
      if (clip) {
        const ref = this.backend.refSpeed(clip);
        this.backend.setRate(clamp(this.speed / Math.max(0.1, ref), A.rateMin, A.rateMax));
      }
    }

    this._updateOverlays(dt, ctx);
    this._updateOneShot(dt);

    // ── distance LOD ──
    const d = ctx.distance ?? 0;
    let step = dt;
    if (d > A.cullDistance) {
      this._lodAccum += dt;
      return;                                     // hold the last pose
    }
    if (d > A.lodDistance) {
      this._lodAccum += dt;
      const budget = 1 / A.lodHz;
      if (this._lodAccum < budget) return;
      step = this._lodAccum;
      this._lodAccum = 0;
    } else if (this._lodAccum > 0) {
      step = dt + this._lodAccum;
      this._lodAccum = 0;
    }

    this.backend.tick(step);

    if (def?.gait && this.onFootstep) this._emitFootsteps();
  }

  _updateOverlays(dt, ctx) {
    const rate = dt * 9;
    const want = ctx.blocking ? 1 : this._blockTarget || 0;
    this._blockWeight += clamp(want - this._blockWeight, -rate, rate);
    this.backend.setOverlay('block', this._blockWeight);

    const carryWant = ctx.carrying && this.speed < 0.4 && !this._oneShot ? 1 : 0;
    this._carry += clamp(carryWant - this._carry, -rate, rate);
    this.backend.setOverlay('carry', this._carry * (1 - this._blockWeight));

    this.backend.setOverlay('aim', ctx.aiming ? 1 - this._recoil : 0);

    if (this._recoil > 0) {
      this._recoil = Math.max(0, this._recoil - dt * 6.5);
      this.backend.setOverlay('recoil', this._recoil);
    }
    this._crouch += clamp(this._crouchWant - this._crouch, -dt * 5.5, dt * 5.5);
    this.backend.setOverlay('crouch', this._crouch);

    // The scream ramps in over its own telegraph rather than snapping, so the
    // pose *is* the countdown.
    if (this._scream !== this._screamWant || this._scream > 0) {
      this._scream += clamp(this._screamWant - this._scream, -dt * 6, dt * 3.5);
      this.backend.setOverlay('scream', this._scream);
    }

    if (this._hit > 0) {
      this._hit = Math.max(0, this._hit - dt * 3.4);
      // Snap in, ease out: the shape of a body absorbing something.
      this.backend.setOverlay('hit', Math.sin(this._hit * Math.PI * 0.5));
    }
  }

  /** Kick the gun arm. Called by the shoot path, which has no clip of its own. */
  recoil() {
    this._recoil = 1;
  }

  /** Fold up. Ramped rather than snapped so standing up reads as a movement. */
  setCrouch(on) {
    this._crouchWant = on ? 1 : 0;
  }

  /** Throw the head back. 0..1, driven by the screamer's telegraph. */
  setScream(v) {
    this._screamWant = clamp(v, 0, 1);
  }

  /** 0..1, for whoever needs to drop the rig to match. */
  get crouchAmount() {
    return this._crouch;
  }

  _updateOneShot(dt) {
    const os = this._oneShot;
    if (!os) return;
    os.t += dt;

    // Piecewise warp: the clip's contact frame is pinned to `windup`.
    let u;
    if (os.t < os.windup) {
      u = (os.t / os.windup) * os.hitFrac;
    } else {
      const tail = Math.max(0.001, os.total - os.windup);
      u = os.hitFrac + ((os.t - os.windup) / tail) * (1 - os.hitFrac);
    }

    if (!os.fired && os.t >= os.windup) {
      os.fired = true;
      this.onContact?.(os.name);
    }

    // Ease the overlay in and out so it never pops.
    const f = CFG.anim.overlayFade;
    const inW = clamp(os.t / f, 0, 1);
    const outW = clamp((os.total - os.t) / f, 0, 1);
    this.backend.setOneShot(Math.min(1, u), Math.min(inW, outW));

    if (os.t >= os.total) {
      this._oneShot = null;
      this.backend.stopOneShot();
    }
  }

  _emitFootsteps() {
    const plants = this.backend.footPlants(this._gaitClip);
    if (!plants) return;
    const now = this.backend.phase();
    const prev = this._phasePrev;
    this._phasePrev = now;
    if (now === prev) return;
    const wrapped = now < prev;
    for (let i = 0; i < plants.length; i++) {
      const p = plants[i];
      const crossed = wrapped ? p > prev || p <= now : p > prev && p <= now;
      if (crossed) this.onFootstep(i);
    }
  }

  dispose() {
    this.backend.dispose();
    this.onFootstep = null;
    this.onContact = null;
  }
}

export default AnimationController;
