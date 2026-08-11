/**
 * CharacterRig.js — the seam between "a character" and "how it is built".
 *
 * Player.js and Zombie.js talk to a rig: a root Object3D they position, an
 * AnimationController they drive, a hand they hang a weapon off, and a death
 * that has some weight to it. Whether that is a skinned glTF character or the
 * procedural humanoid is decided here, once, at construction — and the two
 * paths are interchangeable, so a missing model file costs fidelity and
 * nothing else.
 */

import * as THREE from 'three';
import CFG from '../core/Config.js';
import { clamp01 } from '../core/Utils.js';
import CharacterAssets from './CharacterAssets.js';
import { AnimationController } from './AnimationController.js';
import { buildHumanoid, buildWeaponMesh, PROC_HEIGHT } from './CharacterMesh.js';

/**
 * The eyes. Two dots on an additive material with depth-testing off, so they
 * read at distance and through the dark without needing a light. One geometry
 * and one material for the entire cast — brightness is carried by the mesh's
 * own scale, which is per-instance and free.
 */
let _eyeGeo = null;
let _eyeMat = null;
function eyeMesh() {
  if (!_eyeGeo) {
    const g = new THREE.SphereGeometry(0.032, 6, 5);
    const l = g.clone().translate(-0.052, 0, 0);
    const r = g.clone().translate(0.052, 0, 0);
    g.dispose();
    const merged = new THREE.BufferGeometry();
    const pos = new Float32Array(l.attributes.position.count * 3 + r.attributes.position.count * 3);
    pos.set(l.attributes.position.array, 0);
    pos.set(r.attributes.position.array, l.attributes.position.count * 3);
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const li = Array.from(l.index.array);
    const ri = Array.from(r.index.array).map((i) => i + l.attributes.position.count);
    merged.setIndex(li.concat(ri));
    l.dispose();
    r.dispose();
    _eyeGeo = merged;
    _eyeMat = new THREE.MeshBasicMaterial({
      color: 0xffb46a,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
  }
  const m = new THREE.Mesh(_eyeGeo, _eyeMat);
  m.renderOrder = 6;
  m.frustumCulled = false;
  m.visible = false;
  return m;
}

/** Weapon id → the mesh node the pack ships in the character's hand. */
const PACK_WEAPON = {
  knife: 'Knife',
  axe: 'Axe',
  bat: 'WoodenBat_Barbed',
  revolver: 'Pistol',
  // The pack has no crowbar, machete, sledgehammer or bottle of petrol, so
  // those are modelled here and hung off the same grip anchor.
  crowbar: null,
  machete: null,
  sledge: null,
  molotov: null,
};

export class CharacterRig {
  constructor(kind, opts = {}) {
    this.kind = kind;
    this.skinned = false;
    this._weaponKind = undefined;
    this._propMesh = null;
    this._deathTwist = 0;
    this._deathRate = 1;
    this._dead = false;
    this._groundY = 0;
    this._crawl = 0;
    this._down = 0;
    this._lean = opts.lean || 0;
    this._eyes = null;

    /**
     * Specials have no mesh of their own; they name one to borrow through
     * `opts.asset` and earn their silhouette from height, bulk and posture.
     * `kind` still decides the *height*, which is where most of the read is.
     */
    const assetKey = kind === 'player' ? 'player' : opts.asset || kind;
    if (CFG.anim.useModels && CharacterAssets.has(assetKey)) {
      this._initSkinned(assetKey, opts);
    } else {
      this._initProcedural(kind, opts);
    }

    this.controller = new AnimationController(this._rig, opts.profile || (kind === 'player' ? 'player' : 'zombie'));
    if (this._lean) this._applyProne();
  }

  // ───────────────────────────────────────────────────────────── backends ──

  _initSkinned(assetKey, opts) {
    const A = CFG.anim;
    const height =
      assetKey === 'player' ? A.playerHeight : A.zombieHeight[assetKey] ?? A.zombieHeight.shambler;

    const rig = CharacterAssets.instance(assetKey, opts.variant || 0, {
      height,
      jitter: opts.jitter || 1,
      bulk: opts.bulk || 1,
    });
    this.skinned = true;
    this._rig = rig;
    this._baseScale = rig.scale;
    this.root = rig.root;
    this.body = rig.armature;
    this.bones = rig.bones;
    this.height = height * (opts.jitter || 1);

    // Props we model ourselves are authored in metres; the armature is scaled
    // from model units, so undo that or the crowbar arrives comically large.
    if (rig.anchor) rig.anchor.scale.setScalar(1 / Math.max(0.001, rig.scale));
  }

  _initProcedural(kind, opts) {
    const zombie = kind !== 'player';
    const A = CFG.anim;
    const height = zombie
      ? A.zombieHeight[kind] ?? A.zombieHeight.shambler
      : A.playerHeight;

    const h = buildHumanoid({
      palette: opts.variant ?? 0,
      zombie,
      scale: (height / PROC_HEIGHT) * (opts.jitter || 1),
      bulk: opts.bulk || 1,
      hood: opts.hood,
      pack: kind === 'player',
    });

    this.skinned = false;
    this._rig = h;
    this._baseScale = h.scale;
    this.root = h.root;
    this.body = h.body;
    this.bones = null;
    this.height = height * (opts.jitter || 1);
    this._humanoid = h;
  }

  // ─────────────────────────────────────────────────────────────── weapon ──

  /** @param kind one of the WEAPONS[].mesh ids, or null for empty hands. */
  setWeapon(kind) {
    if (kind === this._weaponKind) return;
    this._weaponKind = kind;

    if (this.skinned) {
      for (const [, mesh] of this._rig.weapons) mesh.visible = false;
      this._clearProp();
      if (!kind) return;
      const node = PACK_WEAPON[kind];
      if (node && this._rig.weapons.has(node)) {
        this._rig.weapons.get(node).visible = true;
        return;
      }
      this._attachProp(kind, this._rig.anchor);
    } else {
      this._clearProp();
      if (kind) this._attachProp(kind, this._humanoid.parts.weaponAnchor);
    }
  }

  _attachProp(kind, parent) {
    if (!parent) return;
    const m = buildWeaponMesh(kind);
    if (!m) return;
    parent.add(m);
    this._propMesh = m;
  }

  _clearProp() {
    if (!this._propMesh) return;
    this._propMesh.parent?.remove(this._propMesh);
    // Weapon geometry and materials are shared singletons — never disposed here.
    this._propMesh = null;
  }

  // ─────────────────────────────────────────────────────────────── trail ──

  /**
   * The arc a heavy swing leaves behind it.
   *
   * A ribbon between the grip and the tip, sampled once a frame while the
   * weapon is in its active window and then dissolved. It exists so that a
   * sledgehammer *looks* like it covered 112 degrees of ground — the hit has
   * already happened by the time you see the trail, which is exactly the
   * feedback a slow weapon needs.
   *
   * Points are kept in root-local space. The root only ever translates and
   * rotates about Y, so that conversion is exact and the ribbon can live as a
   * child of the rig rather than as a loose object in the scene.
   */
  updateTrail(dt, active, width = 1) {
    if (!active && !this._trail) return;
    if (!this._trail) this._makeTrail();
    const T = this._trail;

    if (active) {
      const host = this.skinned
        ? this._propMesh || this._visiblePackWeapon() || this._rig.anchor
        : this._propMesh || this._humanoid.parts.weaponAnchor;
      if (host) {
        if (T.tip.parent !== host) host.add(T.tip);
        if (T.inner.parent !== host) host.add(T.inner);
        /**
         * The ribbon runs along the *striking edge*, not from the grip. A
         * trail anchored at the hand is as wide as the weapon is long and
         * reads as a sheet of glass swept through the frame; a narrow band off
         * the last third of the head reads as an arc.
         */
        const len = 0.42 * width + 0.12;
        T.tip.position.set(0, len, 0);
        T.inner.position.set(0, len * 0.62, 0);
        host.updateWorldMatrix(true, false);
        T.tip.updateWorldMatrix(true, false);
        T.inner.updateWorldMatrix(true, false);
        T.a.setFromMatrixPosition(T.tip.matrixWorld);
        T.b.setFromMatrixPosition(T.inner.matrixWorld);
        this.root.worldToLocal(T.a);
        this.root.worldToLocal(T.b);
        T.push(T.a, T.b);
      }
      T.age = 0;
    } else {
      T.age += dt;
      T.push(null, null);
    }

    T.commit(active ? 1 : Math.max(0, 1 - T.age / 0.16));
    if (!active && T.n <= 0) this._killTrail();
  }

  _visiblePackWeapon() {
    if (!this._rig.weapons) return null;
    for (const [, m] of this._rig.weapons) if (m.visible) return m;
    return null;
  }

  _killTrail() {
    const T = this._trail;
    if (!T) return;
    this.root.remove(T.mesh);
    T.mesh.geometry.dispose();
    T.mesh.material.dispose();
    T.tip.parent?.remove(T.tip);
    T.inner.parent?.remove(T.inner);
    this._trail = null;
  }

  _makeTrail() {
    const SEG = 8;
    const pos = new Float32Array(SEG * 2 * 3);
    const fade = new Float32Array(SEG * 2);
    const idx = [];
    for (let i = 0; i < SEG - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aFade', new THREE.BufferAttribute(fade, 1));
    geo.setIndex(idx);

    const mat = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aFade;
        varying float vFade;
        void main() {
          vFade = aFade;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uAlpha;
        varying float vFade;
        void main() {
          // Quiet. It is a readability aid, not a special effect — at night
          // an additive white sheet is the brightest thing on the street.
          float a = vFade * vFade * uAlpha * 0.16;
          if (a < 0.004) discard;
          gl_FragColor = vec4(0.72, 0.76, 0.84, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    this.root.add(mesh);

    this._trail = {
      mesh,
      tip: new THREE.Object3D(),
      inner: new THREE.Object3D(),
      n: 0,
      age: 0,
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),

      /** Shift the ribbon along one place and write the newest pair at the head. */
      push(pa, pb) {
        pos.copyWithin(6, 0, (SEG - 1) * 6);
        if (pa && pb) {
          pos[0] = pa.x; pos[1] = pa.y; pos[2] = pa.z;
          pos[3] = pb.x; pos[4] = pb.y; pos[5] = pb.z;
          this.n = Math.min(SEG, this.n + 1);
        } else {
          // Collapse the head onto its neighbour so the tail eats forward.
          for (let i = 0; i < 6; i++) pos[i] = pos[i + 6];
          this.n = Math.max(0, this.n - 1);
        }
      },

      commit(alpha) {
        for (let i = 0; i < SEG; i++) {
          const f = i < this.n ? 1 - i / SEG : 0;
          fade[i * 2] = f;
          fade[i * 2 + 1] = f;
        }
        mat.uniforms.uAlpha.value = alpha;
        geo.attributes.position.needsUpdate = true;
        geo.attributes.aFade.needsUpdate = true;
      },
    };
  }

  // ──────────────────────────────────────────────────────────────── death ──

  /**
   * Give this death its own character: which way the body twists as it goes
   * down, and how fast. `r` is a 0..1 roll from the caller so a seeded run
   * still dies the same way twice.
   */
  beginDeath(r = Math.random()) {
    if (this._dead) return;
    this._dead = true;
    this._deathTwist = (r * 2 - 1) * CFG.anim.deathFallSpread;
    this._deathRate = 0.86 + r * 0.34;
    this.controller.cancelOneShot();
    this.controller.request('death');
  }

  /**
   * Called every frame while dead. The twist eases in over the fall so the
   * body turns as it drops instead of snapping, and the landing gets a small
   * bounce — the difference between a corpse and a deleted enemy.
   */
  updateDeath(deathTimer) {
    if (!this._dead) return;
    const t = deathTimer * this._deathRate;
    const fall = clamp01(t / 0.8);
    const ease = 1 - Math.pow(1 - fall, 2);
    this.body.rotation.y = this._deathTwist * ease;

    const A = CFG.anim;
    const u = (t - 0.72) / A.deathSettleTime;
    if (u > 0 && u < 1.6) {
      this.root.position.y =
        this._groundY + Math.abs(Math.sin(u * Math.PI * 1.4)) * A.deathSettleHeight * Math.exp(-u * 3.1);
    } else if (u >= 1.6) {
      this.root.position.y = this._groundY;
    }
  }

  /** Bring a corpse back to its feet. Used when a run restarts. */
  reset() {
    this._dead = false;
    this._deathTwist = 0;
    this._crawl = 0;
    this._down = 0;
    this.body.rotation.set(this._lean, 0, 0);
    this.body.position.y = 0;
    if (this._eyes) this._eyes.visible = false;
    this.controller.cancelOneShot();
    this.controller.state = null;
    this.controller.request('idle', { fade: 0 });
  }

  /**
   * Where the character stands. While dead, `updateDeath` owns the Y axis so
   * the settle bounce is not fought over.
   */
  place(x, y, z, yaw) {
    this._groundY = y;
    this.root.position.x = x;
    this.root.position.z = z;
    if (!this._dead) this.root.position.y = y;
    this.root.rotation.y = yaw;
  }

  /**
   * Get low.
   *
   * With no IK there is no honest way to fold the legs — rotating the thighs
   * puts the feet through the floor. Shortening the whole body instead keeps
   * the soles planted, drops the head by about 30 cm, and combined with the
   * hunch in the `crouch` overlay reads as a crouch from behind, which is the
   * only angle this game is ever seen from.
   */
  setCrouch(t01) {
    const k = 1 - t01 * CFG.stealth.crouchRigSquash;
    this.body.scale.setScalar(this._baseScale * k);
  }

  // ─────────────────────────────────────────────────── wounds and the floor ──

  /**
   * On its belly.
   *
   * Same absence of IK as the crouch, and the same answer: rather than fold
   * anything, tip the whole body forward until the chest is at road height and
   * let the locomotion clip keep running. The arms and legs go on cycling,
   * which from behind is precisely what dragging yourself along looks like.
   */
  setCrawl(on) {
    this._crawl = on ? 1 : 0;
    this._applyProne();
  }

  /**
   * Flat on its back, and getting up in the last second of it. `remaining`
   * counts down, so the rise is driven by the same timer the AI is using and
   * the two can never disagree about whether it is still down.
   */
  setDown(on) {
    this._down = on ? 1 : 0;
    this._applyProne();
  }

  updateDown(dt, remaining) {
    if (!this._down) return;
    const up = CFG.combat.knockdownGetUp;
    // The last stretch is spent hauling itself upright — a telegraph that your
    // window is closing.
    const rise = remaining < up ? 1 - clamp01(remaining / up) : 0;
    this._applyProne(rise);
  }

  _applyProne(rise = 0) {
    const flat = this._crawl ? 1 : this._down ? 1 - rise : 0;
    if (flat <= 0.001) {
      // A special's resting posture — the runner's forward pitch, the
      // screamer's unnatural uprightness — composes with everything else.
      this.body.rotation.x = this._lean;
      if (!this._dead) this.body.position.y = 0;
      return;
    }
    // Crawlers go face-down; a knocked-down body falls the other way.
    const dir = this._crawl ? 1 : -1;
    this.body.rotation.x = this._lean * (1 - flat) + dir * flat * 1.42;
    // Tipping about the hips leaves the torso in the air, so drop with it.
    this.body.position.y = -flat * this.height * 0.3;
  }

  /**
   * Light behind the eyes. Driven by the attack windup, so the tell and the
   * timing it is telling you about cannot drift apart. Brightness is the mesh
   * scale — the material is shared by every zombie on the street.
   */
  setEyeGlow(v, night = false) {
    if (v <= 0.01) {
      if (this._eyes) this._eyes.visible = false;
      return;
    }
    if (!this._eyes) {
      const m = eyeMesh();
      const host = this.skinned ? this.bones?.head : this._humanoid?.parts.head;
      if (!host) return;
      // Bones are in model units; the prop anchor trick does not apply here, so
      // undo the armature scale by hand.
      const s = this.skinned ? 1 / Math.max(0.001, this._rig.scale) : 1;
      m.scale.setScalar(s);
      m.position.set(0, this.skinned ? 0.12 : 0.06, this.skinned ? 0.17 : 0.14);
      m.userData.baseScale = s;
      host.add(m);
      this._eyes = m;
    }
    const e = this._eyes;
    e.visible = true;
    // In daylight it is barely there; at night it is the only thing you see.
    const k = v * (night ? 1 : 0.45);
    e.scale.setScalar(e.userData.baseScale * (0.55 + k * 0.9));
  }

  // ────────────────────────────────────────────────────────────── lifetime ──

  /**
   * Geometry, atlases and palette materials are shared by every character in
   * the scene, so an individual only ever gives back its own Object3Ds and its
   * mixer bindings. The rest lives for the lifetime of the page.
   */
  dispose() {
    this.controller.dispose();
    this._clearProp();
    this._killTrail();
    this.root.parent?.remove(this.root);
  }
}

/**
 * @param kind 'player' | 'shambler' | 'stalker' | 'bloated'
 * @param opts { variant, jitter, bulk, hood }
 */
export function createRig(kind, opts = {}) {
  return new CharacterRig(kind, opts);
}

export default createRig;
