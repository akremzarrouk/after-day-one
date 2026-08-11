/**
 * Openings.js — every hole in a wall, as a first-class object.
 *
 * Doors and windows used to be gaps that `Builders.building()` left in a wall
 * run and then decorated. They are now things with state: a door can be open,
 * closed, boarded or broken, it has hit points, it swings, it attenuates
 * sound, it blocks line of sight, and a zombie can take it apart. The
 * safehouse barricade — which used to be a one-off with its own HP and its own
 * nav rebuild — is just a boarded door like any other.
 *
 * An Opening owns four things and keeps them in agreement:
 *
 *   · the collision box that makes it solid and/or opaque,
 *   · the meshes (leaf, glass, boards) that show which of those is true,
 *   * the nav grid cells behind it, rebuilt locally whenever state changes,
 *   · the noise attenuation the rest of the game reads through `blocksSound`.
 */

import * as THREE from 'three';
import CFG from '../core/Config.js';
import { clamp01 } from '../core/Utils.js';

export const OpeningType = { DOOR: 'door', WINDOW: 'window' };

export const OpeningState = {
  OPEN: 'open',       // door standing open, or window frame with nothing in it
  CLOSED: 'closed',   // door shut, or window with glass still in
  BOARDED: 'boarded', // planks across it
  BROKEN: 'broken',   // door off its hinges, or glass smashed out
};

let _nextId = 1;

export class Opening {
  /**
   * @param spec  descriptor from Builders.building(): the gap's axis, its
   *              position along the wall, its vertical span, and the wall
   *              segments that frame it.
   */
  constructor(spec, world) {
    this.id = _nextId++;
    this.world = world;
    this.building = spec.building || null;
    this.type = spec.kind === 'window' ? OpeningType.WINDOW : OpeningType.DOOR;
    this.side = spec.side;
    this.axis = spec.axis;            // 'x' → the gap runs along X
    this.a = spec.a;
    this.b = spec.b;
    this.width = spec.b - spec.a;
    this.fixed = spec.fixed;          // the wall's centre line on the other axis
    this.y0 = spec.y0;
    this.y1 = spec.y1;
    this.thickness = spec.thickness || 0.24;

    const at = (spec.a + spec.b) * 0.5;
    this.x = this.axis === 'x' ? at : this.fixed;
    this.z = this.axis === 'x' ? this.fixed : at;

    // Outward normal, pointing away from the building interior.
    this.nx = this.side === 'e' ? 1 : this.side === 'w' ? -1 : 0;
    this.nz = this.side === 's' ? 1 : this.side === 'n' ? -1 : 0;

    this.maxHp = this.type === OpeningType.DOOR ? CFG.openings.doorHp : CFG.openings.windowHp;
    this.hp = this.maxHp;
    this.boardHp = 0;
    this.boardMax = this.maxHp * CFG.openings.boardHpMul;

    this.swing = 0;                   // 0 closed → 1 fully open
    this.swingTarget = 0;
    this.swingRate = 1 / CFG.openings.swingTime;
    this.lastUsedBy = null;
    this.attackers = 0;               // recomputed each frame by the horde

    this.group = new THREE.Group();
    (spec.parent || world.root).add(this.group);

    this.box = null;
    this.leafPivot = null;
    this.leafMesh = null;
    this.glassMesh = null;
    this.boardGroup = null;

    this.state = spec.state || OpeningState.CLOSED;
    this.initialState = this.state;
    this._buildMeshes(spec);
    this._applyState(true);
    if (this.state === OpeningState.BOARDED) this.boardHp = this.boardMax;
  }

  // ─────────────────────────────────────────────────────────────── build ──

  _buildMeshes(spec) {
    const M = this.world.M;
    const along = this.axis === 'x' ? 'x' : 'z';
    const h = this.y1 - this.y0;

    if (this.type === OpeningType.DOOR) {
      /**
       * The leaf hangs off one jamb. Which way it swings is worked out rather
       * than hard-coded per side: rotate the leaf's own axis by +90° and keep
       * the sign that sends it outward, so a door always opens away from the
       * room it belongs to.
       */
      const ux = along === 'x' ? 1 : 0;
      const uz = along === 'x' ? 0 : 1;
      const rotated = (s) => ({ x: ux * 0 + uz * s, z: -ux * s + uz * 0 });
      const plus = rotated(1);
      this.swingSign = plus.x * this.nx + plus.z * this.nz > 0 ? 1 : -1;

      // Hinge at the `a` jamb.
      const hingeX = along === 'x' ? this.a : this.fixed;
      const hingeZ = along === 'x' ? this.fixed : this.a;

      this.leafPivot = new THREE.Group();
      this.leafPivot.position.set(hingeX, this.y0, hingeZ);
      this.group.add(this.leafPivot);

      const leafW = this.width - 0.05;
      this.leafMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), M.woodDark);
      this.leafMesh.castShadow = true;
      this.leafMesh.receiveShadow = true;
      if (along === 'x') {
        this.leafMesh.scale.set(leafW, h - 0.04, 0.07);
        this.leafMesh.position.set(leafW / 2 + 0.025, (h - 0.04) / 2, 0);
      } else {
        this.leafMesh.scale.set(0.07, h - 0.04, leafW);
        this.leafMesh.position.set(0, (h - 0.04) / 2, leafW / 2 + 0.025);
      }
      this.leafPivot.add(this.leafMesh);

      // Handle, so a closed door reads as openable rather than as wall.
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), M.metal || M.metalDark);
      const kOff = leafW - 0.16;
      if (along === 'x') knob.position.set(kOff, h * 0.5, 0.07);
      else knob.position.set(0.07, h * 0.5, kOff);
      this.leafPivot.add(knob);
      this.knobMesh = knob;
    } else {
      this.glassMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), M.glass);
      const mid = (this.a + this.b) * 0.5;
      if (along === 'x') {
        this.glassMesh.position.set(mid, (this.y0 + this.y1) / 2, this.fixed);
        this.glassMesh.scale.set(this.width * 0.96, h, 0.05);
      } else {
        this.glassMesh.position.set(this.fixed, (this.y0 + this.y1) / 2, mid);
        this.glassMesh.scale.set(0.05, h, this.width * 0.96);
      }
      this.group.add(this.glassMesh);
    }

    // One collision box, toggled and re-flagged as the state changes.
    const pad = this.thickness * 0.9;
    const minX = along === 'x' ? this.a : this.fixed - pad / 2;
    const maxX = along === 'x' ? this.b : this.fixed + pad / 2;
    const minZ = along === 'x' ? this.fixed - pad / 2 : this.a;
    const maxZ = along === 'x' ? this.fixed + pad / 2 : this.b;
    this.box = this.world.collision.addBox(minX, minZ, maxX, maxZ, this.y0, this.y1, {
      tag: 'opening',
      ref: this,
      solid: true,
      opaque: true,
    });

    /**
     * Windows sit on a sill that is solid whatever the glass is doing. Broken
     * windows drop it to a step so a body can get over — that is what turns a
     * smashed window into a way in rather than just a hole to look through.
     */
    this.sillBox = spec.sillBox || null;
    this.sillMesh = spec.sillMesh || null;
  }

  _boards() {
    if (this.boardGroup) return;
    const M = this.world.M;
    const g = new THREE.Group();
    const along = this.axis === 'x' ? 'x' : 'z';
    const mid = (this.a + this.b) * 0.5;
    const h = this.y1 - this.y0;
    const n = this.type === OpeningType.DOOR ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), M.plank);
      const yy = this.y0 + 0.18 + (i * (h - 0.3)) / Math.max(1, n - 1);
      const tilt = (i % 2 ? 1 : -1) * (0.045 + (i % 3) * 0.012);
      if (along === 'x') {
        m.scale.set(this.width * 1.03, 0.19, 0.06);
        m.position.set(mid, yy, this.fixed + this.nz * 0.1);
        m.rotation.z = tilt;
      } else {
        m.scale.set(0.06, 0.19, this.width * 1.03);
        m.position.set(this.fixed + this.nx * 0.1, yy, mid);
        m.rotation.x = tilt;
      }
      m.castShadow = true;
      g.add(m);
    }
    this.group.add(g);
    this.boardGroup = g;
  }

  // ─────────────────────────────────────────────────────────────── state ──

  get isDoor() {
    return this.type === OpeningType.DOOR;
  }

  /** Can a body walk straight through? */
  get passable() {
    if (this.state === OpeningState.BOARDED) return false;
    if (this.isDoor) return this.state !== OpeningState.CLOSED;
    // Windows are never simply walkable: there is always a sill.
    return false;
  }

  /** Can the player vault it? */
  get vaultable() {
    return !this.isDoor && (this.state === OpeningState.CLOSED || this.state === OpeningState.BROKEN);
  }

  /** Can a zombie climb it, slowly and obviously? */
  get climbable() {
    return !this.isDoor && this.state === OpeningState.BROKEN;
  }

  get blocksSight() {
    if (this.state === OpeningState.BOARDED) return true;
    if (this.isDoor) return this.state === OpeningState.CLOSED;
    return false;               // you can always see through a window
  }

  /** Does sound have to fight its way past this? */
  get blocksSound() {
    return this.state === OpeningState.CLOSED || this.state === OpeningState.BOARDED;
  }

  get totalHp() {
    return this.hp + this.boardHp;
  }

  get intact() {
    return this.state !== OpeningState.BROKEN;
  }

  /**
   * Push the collision box, the meshes and the nav grid into agreement with
   * `this.state`. Everything that changes state ends up here.
   */
  _applyState(initial = false) {
    const S = OpeningState;
    const st = this.state;

    if (this.isDoor) {
      this.box.solid = st === S.CLOSED || st === S.BOARDED;
      this.box.opaque = this.box.solid;
      this.box.enabled = this.box.solid;
      if (this.leafPivot) this.leafPivot.visible = st !== S.BROKEN;
      this.swingTarget = st === S.OPEN ? 1 : 0;
      if (initial) this.swing = this.swingTarget;
    } else {
      // A window's own box only exists to carry boards.
      this.box.solid = st === S.BOARDED;
      this.box.opaque = st === S.BOARDED;
      this.box.enabled = this.box.solid;
      if (this.glassMesh) this.glassMesh.visible = st === S.CLOSED;
      if (this.sillBox) {
        // Smashed out: the sill drops below step height so a body can cross.
        this.sillBox.enabled = st !== S.BROKEN;
      }
    }

    if (st === S.BOARDED) this._boards();
    else if (this.boardGroup) {
      this.group.remove(this.boardGroup);
      this.boardGroup = null;
    }

    if (!initial) this.world.markOpeningDirty(this);
  }

  // ───────────────────────────────────────────────────────────── actions ──

  /** @returns true if the state actually changed. */
  setState(next) {
    if (this.state === next) return false;
    this.state = next;
    this._applyState();
    return true;
  }

  open(by = 'player') {
    if (!this.isDoor || this.state !== OpeningState.CLOSED) return false;
    this.lastUsedBy = by;
    this.setState(OpeningState.OPEN);
    return true;
  }

  close(by = 'player') {
    if (!this.isDoor || this.state !== OpeningState.OPEN) return false;
    this.lastUsedBy = by;
    this.setState(OpeningState.CLOSED);
    return true;
  }

  toggle(by = 'player') {
    if (this.state === OpeningState.OPEN) return this.close(by) ? 'close' : null;
    if (this.state === OpeningState.CLOSED) return this.open(by) ? 'open' : null;
    return null;
  }

  /** Shut it hard: quicker than a normal swing, and much louder. */
  slam() {
    if (!this.isDoor) return false;
    if (this.state !== OpeningState.OPEN) return false;
    this.setState(OpeningState.CLOSED);
    this.swing = 0;                        // no easing, it is already shut
    this.swingRate = 1 / CFG.openings.slamTime;
    return true;
  }

  board() {
    if (this.state === OpeningState.BOARDED) return false;
    if (this.state === OpeningState.BROKEN) return false;
    // Boarding a door shuts it first.
    this.setState(OpeningState.BOARDED);
    this.swing = 0;
    this.boardHp = this.boardMax;
    if (this.hp <= 0) this.hp = this.maxHp * 0.35;   // patched back together
    return true;
  }

  /**
   * Take a hit. Boards go first, then the door itself.
   * @returns 'broke' | 'boards' | null
   */
  damage(n) {
    if (this.state === OpeningState.BROKEN) return null;
    if (this.state === OpeningState.OPEN) return null;

    if (this.boardHp > 0) {
      this.boardHp -= n;
      if (this.boardHp <= 0) {
        this.boardHp = 0;
        this.setState(this.isDoor ? OpeningState.CLOSED : OpeningState.BROKEN);
        return 'boards';
      }
      this._splinter();
      return null;
    }

    this.hp -= n;
    this._splinter();
    if (this.hp <= 0) {
      this.hp = 0;
      this.breakOpen();
      return 'broke';
    }
    return null;
  }

  breakOpen() {
    this.hp = 0;
    this.boardHp = 0;
    this.setState(OpeningState.BROKEN);
  }

  /** Repair to closed. Used when a run restarts. */
  reset(state) {
    this.hp = this.maxHp;
    this.boardHp = 0;
    this.swing = state === OpeningState.OPEN ? 1 : 0;
    this.swingRate = 1 / CFG.openings.swingTime;
    this.state = state;
    this._applyState(true);
    this.world.markOpeningDirty(this);
  }

  /**
   * Visible wear. The leaf tilts and drops in its frame as it loses hit
   * points, and boards fall off one at a time — you can read how long you
   * have left without a health bar.
   */
  _splinter() {
    const f = clamp01(this.totalHp / (this.maxHp + this.boardMax * (this.boardMax ? 1 : 0) || this.maxHp));
    if (this.boardGroup) {
      const kids = this.boardGroup.children;
      const bf = clamp01(this.boardHp / Math.max(1, this.boardMax));
      kids.forEach((c, i) => {
        c.visible = bf > i / kids.length;
        c.rotation[this.axis === 'x' ? 'z' : 'x'] += (Math.random() - 0.5) * 0.02;
      });
    }
    if (this.leafMesh && this.boardHp <= 0) {
      const hf = clamp01(this.hp / this.maxHp);
      this.leafMesh.rotation[this.axis === 'x' ? 'z' : 'x'] = (1 - hf) * 0.08 * this.swingSign;
      this.leafMesh.position.y = (this.y1 - this.y0 - 0.04) / 2 - (1 - hf) * 0.05;
    }
    this._shakeT = 0.14;
  }

  // ────────────────────────────────────────────────────────────── update ──

  update(dt) {
    // Swing easing.
    if (this.swing !== this.swingTarget) {
      const d = this.swingTarget - this.swing;
      const step = this.swingRate * dt;
      this.swing = Math.abs(d) <= step ? this.swingTarget : this.swing + Math.sign(d) * step;
      if (this.swing === this.swingTarget) this.swingRate = 1 / CFG.openings.swingTime;
    }
    if (this.leafPivot) {
      const ease = this.swing * this.swing * (3 - 2 * this.swing);
      this.leafPivot.rotation.y = ease * 1.75 * this.swingSign;
      if (this._shakeT > 0) {
        this._shakeT -= dt;
        this.leafPivot.rotation.y += Math.sin(this._shakeT * 90) * 0.035;
      }
    }
  }

  /** Where a body should stand to use this, on a given side. */
  standPoint(outside, dist = 1.15) {
    const s = outside ? 1 : -1;
    return { x: this.x + this.nx * dist * s, z: this.z + this.nz * dist * s };
  }

  /** Is a point on the outward side of this opening? */
  isOutside(x, z) {
    return (x - this.x) * this.nx + (z - this.z) * this.nz > 0;
  }

  label() {
    if (this.isDoor) {
      if (this.state === OpeningState.BOARDED) return 'Boarded door';
      if (this.state === OpeningState.BROKEN) return 'Broken door';
      return this.state === OpeningState.OPEN ? 'Open door' : 'Door';
    }
    if (this.state === OpeningState.BOARDED) return 'Boarded window';
    if (this.state === OpeningState.BROKEN) return 'Broken window';
    return 'Window';
  }
}
