/**
 * Player.js — third-person survivor controller.
 *
 * Movement is deliberately grounded: acceleration and friction rather than
 * instant velocity, a real jump arc, and sprinting that costs you something.
 * You are a person who has been awake for two days, not an action hero.
 */

import * as THREE from 'three';
import CFG from '../core/Config.js';
import { clamp, clamp01, damp, moveAngleTowards } from '../core/Utils.js';
import { createRig } from '../entities/CharacterRig.js';
import { WEAPONS } from '../systems/Items.js';

export const PlayerState = {
  NORMAL: 'normal',
  ATTACK: 'attack',
  STAGGER: 'stagger',
  DEAD: 'dead',
};

/**
 * Dodge is bound to a double-tapped movement key rather than a key of its own.
 *
 * Three reasons, in order of weight. A dodge needs a direction, and the keys
 * that mean direction are already under your fingers — a dedicated key would
 * have to invent one, and "backwards" is the wrong default in a game where
 * spacing is the defence. It costs no input latency, because the first tap is
 * an ordinary step and the dodge fires on the second key-*down*, not on a
 * timeout. And the layout is full: crouch, block, torch, interact, cycle and
 * nine quick-slots are already spoken for.
 *
 * `KeyC` is wired to the same verb for anyone who cannot reliably double-tap;
 * it dodges the way you are moving, or backwards from standing.
 */
const DODGE_KEYS = [
  ['KeyW', 0, 1],
  ['KeyS', 0, -1],
  ['KeyA', -1, 0],
  ['KeyD', 1, 0],
];

export class Player {
  constructor(scene, world, survival, inventory, audio, noise) {
    this.scene = scene;
    this.world = world;
    this.survival = survival;
    this.inventory = inventory;
    this.audio = audio;
    this.noise = noise;

    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3(0, 0, 0);
    this.yaw = Math.PI;             // facing +Z at 0; start looking down the road
    this.moveYaw = Math.PI;
    this.grounded = true;
    this.state = PlayerState.NORMAL;

    this.sprinting = false;
    this.crouching = false;
    this.blocking = false;
    this.speed = 0;

    // Committed movements that take the controls away for a moment.
    this.vaulting = null;     // { op, t, dur, fromX, fromZ, toX, toZ }
    this.hidden = null;       // the hiding spot we are inside
    this.hideT = 0;
    this.dodging = null;      // { t, dur, dirX, dirZ, dist, done }
    this.finisher = null;     // { z, t, dur } — standing over something downed

    // Mobility economy
    this.dodgeCooldown = 0;
    this.shoveCooldown = 0;
    this.attackLock = 0;      // brief no-swing window after a dodge or shove
    this.clock = 0;           // unscaled seconds, for double-tap timing
    this._tapKey = null;
    this._tapAt = -10;

    // Revolver
    this.reloading = null;    // { t, per } — one chamber at a time
    this.aimT = 0;            // how long you have been sighted in, 0..1-ish
    this.swayYaw = 0;
    this.swayPitch = 0;

    /** Set by Game: (dirX, dirZ, amount, opts) whenever something lands. */
    this.onDamage = null;

    // attack
    this.attackTimer = 0;
    this.attackDuration = 0;
    this.attackWindup = 0;
    this.attackHasHit = false;
    this.attackWeapon = null;
    this.attackQueued = false;
    this.comboStep = 0;
    this.lastAttackEnd = -10;

    this.staggerTimer = 0;
    this.deathTimer = 0;
    this.hitStop = 0;


    // flashlight
    this.flashlightOn = false;
    this.battery = 0;   // seconds of charge
    this.maxBattery = 240;

    // revolver
    this.chamber = 0;

    this.scratch = [];
    this._tmp = new THREE.Vector3();

    this._buildMesh();
  }

  _buildMesh() {
    this.rig = createRig('player', { variant: 0 });
    this.mesh = this.rig.root;
    this.anim = this.rig.controller;
    this.scene.add(this.mesh);

    // Footsteps are driven by the animation rather than a wall-clock timer, so
    // the sound and the noise event land on the frame the foot actually does.
    this.anim.onFootstep = () => this._footstep();

    this.weaponKind = null;

    // Flashlight cone
    this.flashlight = new THREE.SpotLight(0xfff0d0, 0, 38, 0.42, 0.5, 1.05);
    this.flashlight.castShadow = false;
    this.scene.add(this.flashlight);
    this.scene.add(this.flashlight.target);

    // Faint fill so the player silhouette never disappears completely at night
    this.selfLight = new THREE.PointLight(0x9db4d0, 0, 6.5, 1.6);
    this.scene.add(this.selfLight);
  }

  spawn(pos) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.state = PlayerState.NORMAL;
    this.yaw = Math.PI;
    this.moveYaw = Math.PI;
    this.grounded = true;
    this.deathTimer = 0;
    this.staggerTimer = 0;
    this.attackTimer = 0;
    this.attackQueued = false;
    this.dodging = null;
    this.finisher = null;
    this.reloading = null;
    this.vaulting = null;
    this.hidden = null;
    this.dodgeCooldown = 0;
    this.shoveCooldown = 0;
    this.attackLock = 0;
    this.crouching = false;
    this.blocking = false;
    this.chamber = 0;
    this.mesh.visible = true;
    this.mesh.position.copy(pos);
    this.rig.reset();
  }

  get weapon() {
    return WEAPONS[this.inventory.equipped] || WEAPONS.fists;
  }

  get eyePos() {
    return this._tmp.set(this.pos.x, this.pos.y + CFG.player.eyeHeight, this.pos.z);
  }

  get isBusy() {
    return this.state === PlayerState.ATTACK || this.state === PlayerState.STAGGER;
  }

  /** Controls are surrendered while climbing through something or hidden. */
  get committed() {
    return !!this.vaulting || !!this.hidden || !!this.dodging || !!this.finisher;
  }

  /** True while a swing would be refused for reasons other than stamina. */
  get canAct() {
    return (
      this.state !== PlayerState.DEAD &&
      this.state !== PlayerState.STAGGER &&
      !this.committed &&
      this.attackLock <= 0
    );
  }

  // ─────────────────────────────────────────────────────── vault / hide ──

  /**
   * Climb through a window. A fixed commitment: for the next 0.7 s you are
   * going wherever the sill points, which is exactly the cost that makes a
   * window an interesting escape rather than a free one.
   */
  beginVault(op) {
    if (this.vaulting || this.hidden) return false;
    const outside = op.isOutside(this.pos.x, this.pos.z);
    const to = op.standPoint(!outside, 1.15);
    this.vaulting = {
      op,
      t: 0,
      dur: CFG.openings.vaultTime,
      fromX: this.pos.x,
      fromZ: this.pos.z,
      toX: to.x,
      toZ: to.z,
    };
    this.vel.set(0, 0, 0);
    this.blocking = false;
    this.crouching = false;
    // Face the way we are going.
    this.yaw = Math.atan2(to.x - this.pos.x, to.z - this.pos.z);
    this.moveYaw = this.yaw;
    return true;
  }

  _updateVault(dt) {
    const v = this.vaulting;
    v.t += dt;
    const k = clamp01(v.t / v.dur);
    const e = k * k * (3 - 2 * k);
    this.pos.x = v.fromX + (v.toX - v.fromX) * e;
    this.pos.z = v.fromZ + (v.toZ - v.fromZ) * e;
    // Rise over the sill and drop down the far side.
    const lift = Math.sin(k * Math.PI) * 0.55;
    const gy = this.world.collision.groundHeightAt(this.pos.x, this.pos.z, this.pos.y + 1.2, this.scratch);
    this.pos.y = gy + lift;
    this.speed = Math.hypot(v.toX - v.fromX, v.toZ - v.fromZ) / v.dur;
    if (v.t >= v.dur) {
      this.pos.y = gy;
      this.vaulting = null;
      this.vel.set(0, 0, 0);
      this.speed = 0;
      this.grounded = true;
    }
  }

  // ──────────────────────────────────────────────── dodge, shove, finish ──

  /**
   * A hard step, two metres, in the direction you asked for.
   *
   * There are deliberately no invulnerability frames. A dodge that made you
   * briefly untouchable would turn every fight into a timing minigame you win
   * by pressing a button at the right moment; a dodge that only moves you means
   * the answer to a windup is to *not be there*, which is a spatial problem and
   * a much better one. It cancels whatever you were swinging, and leaves you
   * unable to swing again for a beat as you plant.
   */
  tryDodge(dirX, dirZ) {
    const C = CFG.combat;
    if (this.state === PlayerState.DEAD || this.committed) return false;
    if (this.dodgeCooldown > 0) return false;
    if (this.survival.exhausted || !this.survival.canSpend(C.dodgeStamina)) {
      this.survival.emit('warn', 'No legs left for that.');
      this.audio.uiBad();
      return false;
    }
    const l = Math.hypot(dirX, dirZ);
    if (l < 1e-4) return false;

    this.survival.spendStamina(C.dodgeStamina);
    this.dodgeCooldown = C.dodgeCooldown;
    this.crouching = false;
    this.blocking = false;
    this.cancelReload();

    // Cancelling out of your own swing is most of the value of the verb.
    if (this.state === PlayerState.ATTACK) {
      this.state = PlayerState.NORMAL;
      this.attackQueued = false;
      this.anim.cancelOneShot();
    }

    this.dodging = {
      t: 0,
      dur: C.dodgeTime,
      dirX: dirX / l,
      dirZ: dirZ / l,
      dist: C.dodgeDistance,
      done: 0,
    };
    this.audio.footstep(this.pos.x, this.pos.z, this.world.surfaceAt(this.pos.x, this.pos.z), true);
    this.noise.emit(this.pos.x, this.pos.z, C.dodgeNoise, 'player', 'dodge');
    return true;
  }

  _updateDodge(dt) {
    const d = this.dodging;
    d.t += dt;
    const k = clamp01(d.t / d.dur);
    // Off the mark hard, decelerating into the plant.
    const e = 1 - Math.pow(1 - k, 2.4);
    const want = d.dist * e;
    const step = want - d.done;
    d.done = want;

    const P = CFG.player;
    const col = this.world.collision;
    const res = col.resolveCircle(
      this.pos.x + d.dirX * step,
      this.pos.z + d.dirZ * step,
      P.radius,
      this.pos.y,
      P.height,
      0.45,
      this.scratch
    );
    this.pos.x = res.x;
    this.pos.z = res.z;
    this.pos.y = col.groundHeightAt(this.pos.x, this.pos.z, this.pos.y + 0.5, this.scratch);
    this.speed = (d.dist / d.dur) * (1 - k * 0.6);
    this.grounded = true;

    if (d.t >= d.dur) {
      this.dodging = null;
      this.attackLock = CFG.combat.dodgeLockout;
      // A little carry, so the step reads as momentum rather than a teleport.
      this.vel.set(d.dirX * 1.6, 0, d.dirZ * 1.6);
    }
  }

  /**
   * Both hands, no weapon, straight into whatever is closest. It does not
   * kill anything and it never will — what it buys is a metre and a half and
   * an interrupted windup, which at the moment you need it is worth more.
   *
   * The resolution lives in Combat; this only decides whether you may.
   */
  tryShove(ctx) {
    const C = CFG.combat;
    if (!this.canAct) return false;
    if (this.shoveCooldown > 0) return false;
    if (this.survival.exhausted || !this.survival.canSpend(C.shoveStamina)) {
      this.survival.emit('warn', 'Not enough left to push.');
      this.audio.uiBad();
      return false;
    }
    this.survival.spendStamina(C.shoveStamina);
    this.shoveCooldown = C.shoveCooldown;
    this.attackLock = 0.22;
    this.cancelReload();
    if (this.state === PlayerState.ATTACK) {
      this.state = PlayerState.NORMAL;
      this.anim.cancelOneShot();
    }
    this.anim.attack('punch', 0.06, 0.34);
    ctx.onShove?.();
    return true;
  }

  /**
   * Stand over it and finish it. A full second in which you are not moving,
   * not blocking and not looking at the other two — that is the entire cost,
   * and it is meant to be paid reluctantly.
   */
  beginFinisher(z) {
    if (!this.canAct || !z || z.isDead) return false;
    this.finisher = { z, t: 0, dur: CFG.combat.finisherTime, done: false };
    this.blocking = false;
    this.cancelReload();
    this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(z.pos.x - this.pos.x, z.pos.z - this.pos.z);
    this.moveYaw = this.yaw;
    this.anim.attack('heavy', CFG.combat.finisherTime * 0.62, CFG.combat.finisherTime);
    this.audio.swing('whoosh_heavy');
    return true;
  }

  _updateFinisher(dt, ctx) {
    const f = this.finisher;
    f.t += dt;
    this.speed = 0;
    this.vel.set(0, 0, 0);
    // The stomp lands before the recovery does, so the body is on the floor
    // while you are still pulling your foot back.
    if (!f.done && f.t >= f.dur * 0.62) {
      f.done = true;
      ctx.onFinish?.(f.z);
    }
    if (f.t >= f.dur) {
      this.finisher = null;
      this.attackLock = 0.12;
    }
  }

  enterHide(spot) {
    if (this.hidden || this.vaulting) return false;
    this.hidden = spot;
    this.hideT = 0;
    this.crouching = true;
    this.blocking = false;
    this.vel.set(0, 0, 0);
    this.pos.x = spot.x;
    this.pos.z = spot.z;
    this.mesh.visible = false;
    return true;
  }

  exitHide() {
    if (!this.hidden) return false;
    const s = this.hidden;
    this.hidden = null;
    this.mesh.visible = true;
    // Step out to the side the spot faces so we never land inside furniture.
    this.pos.x = s.exitX ?? s.x;
    this.pos.z = s.exitZ ?? s.z;
    return true;
  }

  syncWeaponMesh() {
    const kind = this.weapon.mesh;
    if (kind === this.weaponKind) return;
    this.weaponKind = kind;
    this.rig.setWeapon(kind);
  }

  // ───────────────────────────────────────────────────────────── damage ──

  takeHit(amount, fromX, fromZ, opts = {}) {
    if (this.state === PlayerState.DEAD) return;
    let dmg = amount;
    let blocked = false;

    if (this.blocking && !opts.unblockable) {
      const facing = this._facingDot(fromX, fromZ);
      if (facing > 0.15) {
        blocked = true;
        dmg *= CFG.combat.blockDamageMul;
        this.survival.spendStamina(CFG.player.blockCostPerHit);
        if (this.survival.stamina <= 0.5) {
          // Guard broken — the hit lands anyway and you're wide open.
          blocked = false;
          dmg = amount * 0.75;
          this.staggerTimer = 0.65;
          this.state = PlayerState.STAGGER;
          this.survival.emit('bad', 'Your guard breaks!');
        }
      }
    }

    const applied = this.survival.damage(dmg, opts.cause || 'the dead', {
      bleed: !blocked && Math.random() < (opts.bleedChance ?? 0.28) ? 1 : 0,
    });

    // knockback
    const dx = this.pos.x - fromX;
    const dz = this.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    const kb = (blocked ? CFG.combat.blockStaggerPush : CFG.combat.knockbackPlayer) * (opts.knockMul || 1);
    this.vel.x += (dx / d) * kb;
    this.vel.z += (dz / d) * kb;

    if (!blocked) {
      this.state = PlayerState.STAGGER;
      this.staggerTimer = Math.max(this.staggerTimer, 0.42);
      this.attackTimer = 0;
      this.cancelReload();
      this.audio.playerHurt(applied > 16);
    } else {
      this.audio.impact('hit_metal', this.pos.x, this.pos.z);
    }

    // The camera gets shoved away from whatever hit you, so you know which
    // shoulder it came over without having to read the threat arrows.
    this.onDamage?.(-dx / d, -dz / d, applied, { blocked, ...opts });

    this.hitStop = 0.05;

    if (this.survival.dead && this.state !== PlayerState.DEAD) {
      this.die(opts.cause || 'the dead');
    }
    return { blocked, applied };
  }

  die(cause) {
    this.state = PlayerState.DEAD;
    this.deathTimer = 0;
    this.survival.dead = true;
    this.survival.deathCause = cause;
    this.blocking = false;
    this.rig.beginDeath(Math.random());
    this.audio.playerDeath();
  }

  _facingDot(x, z) {
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    return (fx * dx + fz * dz) / d;
  }

  // ───────────────────────────────────────────────────────── attacking ──

  tryAttack() {
    if (this.state === PlayerState.DEAD || this.state === PlayerState.STAGGER) return false;
    if (this.committed) return false;
    // Planting after a dodge or a shove costs you a beat. Buffering still
    // works through it — the queued swing fires the moment the lock lifts.
    if (this.attackLock > 0) {
      this.attackQueued = true;
      return false;
    }
    const w = this.weapon;

    if (w.throwable) return this._tryThrow();
    if (w.ranged) return this._tryShoot();

    if (this.state === PlayerState.ATTACK) {
      // Allow buffering the next swing during recovery.
      if (this.attackTimer > this.attackWindup + w.active) this.attackQueued = true;
      return false;
    }
    if (this.survival.exhausted || !this.survival.canSpend(w.stamina)) {
      this.audio.miss();
      this.survival.emit('warn', 'Too tired to swing.');
      return false;
    }

    this.survival.spendStamina(w.stamina);
    this.state = PlayerState.ATTACK;
    this.attackTimer = 0;
    this.attackWindup = w.windup;
    this.attackDuration = w.windup + w.active + w.recover;
    this.attackHasHit = false;
    this.attackWeapon = w;
    this.attackQueued = false;
    this.comboStep = (performance.now() / 1000 - this.lastAttackEnd < 0.85) ? (this.comboStep + 1) % 2 : 0;
    // The clip is warped to land its contact frame on `w.windup` — the numbers
    // in Items.js stay in charge of when the hit actually registers.
    this.anim.attack(this.comboStep === 1 && w.anim === 'light' ? 'heavy' : w.anim, w.windup, this.attackDuration);
    this.audio.swing(w.swingSound);
    this.noise.emit(this.pos.x, this.pos.z, CFG.noise.meleeSwing, 'player', 'swing');
    return true;
  }

  /**
   * Wind up and let it go. The throw itself happens at the windup end, the
   * same frame a swing would land, so `ctx.onThrow` slots into the existing
   * attack state machine without a second timer.
   */
  _tryThrow() {
    const w = this.weapon;
    if (this.state === PlayerState.ATTACK) return false;
    if (!this.inventory.has(w.item)) {
      this.audio.dryFire();
      this.survival.emit('warn', 'Nothing left to throw.');
      return false;
    }
    this.state = PlayerState.ATTACK;
    this.attackTimer = 0;
    this.attackWindup = w.windup;
    this.attackDuration = w.windup + w.active + w.recover;
    this.attackHasHit = false;
    this.attackWeapon = w;
    this.attackQueued = false;
    this.survival.spendStamina(w.stamina);
    this.anim.attack(w.anim, w.windup, this.attackDuration);
    return true;
  }

  _tryShoot() {
    const w = this.weapon;
    if (this.state === PlayerState.ATTACK) return false;
    if (this.chamber <= 0) {
      // Empty: start feeding it, one round at a time.
      if (!this.startReload()) {
        this.audio.dryFire();
        this.survival.emit('warn', 'Empty.');
      }
      return false;
    }
    // Pulling the trigger always beats loading it.
    this.cancelReload();
    this.state = PlayerState.ATTACK;
    this.attackTimer = 0;
    this.attackWindup = w.windup;
    this.attackDuration = w.windup + w.active + w.recover;
    this.attackHasHit = false;
    this.attackWeapon = w;
    this.survival.spendStamina(w.stamina);
    return true;
  }

  // ───────────────────────────────────────────────────────────── reload ──

  /**
   * A revolver is loaded a chamber at a time, and you can stop at any point.
   *
   * That is the entire mechanic: three rounds in and something comes round the
   * corner, you fire the three. Loading the whole cylinder is the greedy play
   * and the game will punish it about as often as it rewards it.
   */
  startReload() {
    const w = this.weapon;
    if (!w.ranged || this.reloading) return false;
    if (this.chamber >= w.magazine) return false;
    if (!this.inventory.has('ammo_38')) return false;
    if (this.state === PlayerState.ATTACK || this.committed) return false;
    this.reloading = { t: 0, per: 0.42, loaded: 0 };
    this.audio.noiseBurst({ dur: 0.16, type: 'bandpass', freq: 900, q: 4, gain: 0.1 });
    return true;
  }

  cancelReload() {
    if (!this.reloading) return false;
    const n = this.reloading.loaded;
    this.reloading = null;
    if (n > 0) this.audio.uiClick();
    return true;
  }

  _updateReload(dt) {
    const r = this.reloading;
    const w = this.weapon;
    if (!w.ranged) {
      this.reloading = null;
      return;
    }
    r.t += dt;
    while (r.t >= r.per) {
      r.t -= r.per;
      if (this.chamber >= w.magazine || !this.inventory.has('ammo_38')) {
        this.reloading = null;
        this.survival.emit('info', `${this.chamber} in the cylinder.`);
        return;
      }
      this.inventory.remove('ammo_38', 1);
      this.chamber++;
      r.loaded++;
      // One click per chamber — the sound *is* the progress bar.
      this.audio.noiseBurst({ dur: 0.05, type: 'bandpass', freq: 2100, q: 6, gain: 0.11 });
    }
  }

  /**
   * Iron-sight wobble. Two out-of-phase sines so it never traces the same
   * shape twice, scaled hard by how out of breath you are — a sprint across
   * the street is paid for at the moment you try to aim.
   */
  _updateSway(dt, aiming) {
    const C = CFG.combat;
    this.aimT = clamp01(this.aimT + (aiming ? dt * 3.2 : -dt * 6));
    if (!aiming) {
      this.swayYaw = 0;
      this.swayPitch = 0;
      return;
    }
    const st = clamp01(this.survival.stamina / Math.max(1, this.survival.maxStamina));
    const tired = 1 - st;
    const amp =
      (C.aimSwayBase + tired * tired * (C.aimSwayTired - C.aimSwayBase)) *
      (1 + this.speed * 0.3) *
      // Settling: the first moment on target is the worst of it.
      (1.6 - this.aimT * 0.6);
    const t = this.clock * C.aimSwayRate;
    this.swayYaw = (Math.sin(t) * 0.7 + Math.sin(t * 2.31 + 1.1) * 0.3) * amp;
    this.swayPitch = (Math.sin(t * 1.37 + 0.6) * 0.6 + Math.sin(t * 3.1) * 0.25) * amp * 0.7;
  }

  // ────────────────────────────────────────────────────────── flashlight ──

  toggleFlashlight() {
    if (!this.inventory.has('flashlight')) {
      this.survival.emit('warn', 'You have no light.');
      this.audio.uiBad();
      return;
    }
    if (this.battery <= 0 && !this.flashlightOn) {
      this.survival.emit('warn', 'The batteries are dead.');
      this.audio.uiBad();
      return;
    }
    this.flashlightOn = !this.flashlightOn;
    this.audio.uiClick();
    this.survival.emit('info', this.flashlightOn ? 'Torch on. They can see it too.' : 'Torch off.');
  }

  addBattery(sec) {
    this.battery = Math.min(this.maxBattery, this.battery + sec);
  }

  // ───────────────────────────────────────────────────────────── update ──

  update(dt, input, cameraYaw, ctx) {
    // Timers that decide whether an *input* is legal have to run on unscaled
    // time, or hit-stop would silently make every cooldown longer.
    this.clock += dt;
    this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
    this.shoveCooldown = Math.max(0, this.shoveCooldown - dt);
    this.attackLock = Math.max(0, this.attackLock - dt);

    if (this.hitStop > 0) {
      this.hitStop -= dt;
      dt *= 0.25;
    }

    const P = CFG.player;
    const dead = this.state === PlayerState.DEAD;

    if (!dead && ctx.controlsEnabled) this._readMobilityInput(input, cameraYaw, ctx);
    if (this.reloading) this._updateReload(dt);
    this._updateSway(dt, !!ctx.aiming && !this.committed);

    // A swing buffered during a dodge fires the instant you have planted.
    if (
      this.attackQueued &&
      this.attackLock <= 0 &&
      this.state === PlayerState.NORMAL &&
      !this.committed
    ) {
      this.attackQueued = false;
      this.tryAttack();
    }

    // ── committed actions own the body ──
    if (this.finisher) {
      this._updateFinisher(dt, ctx);
      this._updateLights(dt, cameraYaw, ctx);
      this.rig.place(this.pos.x, this.pos.y, this.pos.z, this.yaw);
      this._animate(dt, ctx);
      return;
    }
    if (this.dodging) {
      this._updateDodge(dt);
      this._updateLights(dt, cameraYaw, ctx);
      this.rig.place(this.pos.x, this.pos.y, this.pos.z, this.yaw);
      this._animate(dt, ctx);
      return;
    }
    if (this.vaulting) {
      this._updateVault(dt);
      this._updateLights(dt, cameraYaw, ctx);
      this.rig.place(this.pos.x, this.pos.y, this.pos.z, this.yaw);
      this._animate(dt, ctx);
      return;
    }
    if (this.hidden) {
      this.hideT += dt;
      this.speed = 0;
      this.vel.set(0, 0, 0);
      this._updateLights(dt, cameraYaw, ctx);
      this._animate(dt, ctx);
      return;
    }

    // ── crouch ──
    if (!dead && ctx.controlsEnabled && input.pressed('ControlLeft')) {
      this.crouching = !this.crouching;
      this.audio.uiClick();
    }
    if (dead || this.state === PlayerState.ATTACK) this.crouching = this.crouching && !dead;

    // ── input → desired direction ──
    let ax = 0,
      az = 0;
    let wantSprint = false;
    if (!dead && ctx.controlsEnabled) {
      const m = input.moveAxis();
      const fwdX = Math.sin(cameraYaw);
      const fwdZ = Math.cos(cameraYaw);
      const rightX = -Math.cos(cameraYaw);
      const rightZ = Math.sin(cameraYaw);
      ax = fwdX * m.z + rightX * m.x;
      az = fwdZ * m.z + rightZ * m.x;
      const l = Math.hypot(ax, az);
      if (l > 1e-4) {
        ax /= l;
        az /= l;
        this.moveYaw = Math.atan2(ax, az);
      }
      wantSprint =
        input.anyDown('ShiftLeft', 'ShiftRight') &&
        m.z > 0.25 &&
        !this.survival.exhausted &&
        !this.blocking &&
        this.state !== PlayerState.ATTACK;
      // Breaking into a run is a decision to stop sneaking.
      if (wantSprint) this.crouching = false;
    }

    const moving = Math.hypot(ax, az) > 0.01;
    this.sprinting = wantSprint && moving && this.grounded;

    // ── speed ──
    let target = 0;
    if (moving) {
      target = this.sprinting ? P.sprintSpeed : this.crouching ? CFG.stealth.crouchSpeed : P.walkSpeed;
      if (this.blocking) target *= 0.5;
      if (this.state === PlayerState.ATTACK) target *= this.attackTimer < this.attackWindup + 0.1 ? 0.35 : 0.6;
      if (this.state === PlayerState.STAGGER) target *= 0.15;
      // moving backwards / sideways is slower
      const dot = Math.sin(this.yaw) * ax + Math.cos(this.yaw) * az;
      if (dot < -0.2) target *= P.backMul;
      else if (dot < 0.6) target *= P.strafeMul;
      if (this.survival.stamina < 12) target *= 0.82;
      if (this.survival.health < 30) target *= 0.9;
    }

    const accel = this.grounded ? P.accel : P.airAccel;
    const desiredVX = ax * target;
    const desiredVZ = az * target;
    this.vel.x = damp(this.vel.x, desiredVX, this.grounded ? (moving ? accel : P.friction) : accel, dt);
    this.vel.z = damp(this.vel.z, desiredVZ, this.grounded ? (moving ? accel : P.friction) : accel, dt);

    // ── jump ──
    if (
      !dead &&
      ctx.controlsEnabled &&
      input.pressed('Space') &&
      this.grounded &&
      !this.survival.exhausted &&
      this.survival.stamina > P.jumpCost * 0.8 &&
      this.state !== PlayerState.ATTACK
    ) {
      this.vel.y = P.jumpVel;
      this.grounded = false;
      this.survival.spendStamina(P.jumpCost);
      this.noise.emit(this.pos.x, this.pos.z, CFG.noise.footstepWalk, 'player', 'jump');
      this.audio.noiseBurst({ dur: 0.09, type: 'bandpass', freq: 900, q: 1.4, gain: 0.07 });
    }

    // ── vertical ──
    const col = this.world.collision;
    this.vel.y += P.gravity * dt;
    let nextY = this.pos.y + this.vel.y * dt;
    const probeMax = this.pos.y + (this.grounded ? 0.45 : 0.08);
    const groundY = col.groundHeightAt(this.pos.x, this.pos.z, probeMax, this.scratch);

    if (this.vel.y <= 0 && nextY <= groundY + 0.001) {
      if (!this.grounded && this.vel.y < -6) {
        this.audio.footstep(this.pos.x, this.pos.z, this.world.surfaceAt(this.pos.x, this.pos.z), true);
        this.noise.emit(this.pos.x, this.pos.z, CFG.noise.jumpLand, 'player', 'land');
        if (this.vel.y < -13) this.survival.damage((-this.vel.y - 13) * 3.2, 'a bad landing');
      }
      nextY = groundY;
      this.vel.y = 0;
      this.grounded = true;
    } else if (nextY > groundY + 0.02) {
      this.grounded = false;
    }
    this.pos.y = nextY;

    // ── horizontal + collision ──
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    const res = col.resolveCircle(nx, nz, P.radius, this.pos.y, P.height, 0.45, this.scratch);
    // Kill velocity into the wall so we slide instead of vibrating.
    if (res.hit) {
      const into = this.vel.x * res.nx + this.vel.z * res.nz;
      if (into < 0) {
        this.vel.x -= res.nx * into;
        this.vel.z -= res.nz * into;
      }
    }
    this.pos.x = res.x;
    this.pos.z = res.z;

    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // ── facing ──
    if (!dead) {
      let targetYaw = this.yaw;
      if (this.state === PlayerState.ATTACK || this.blocking) targetYaw = cameraYaw;
      else if (moving) targetYaw = this.moveYaw;
      else if (ctx.aiming) targetYaw = cameraYaw;
      const turnSpeed = this.state === PlayerState.ATTACK ? 6.5 : this.sprinting ? 9 : 13;
      this.yaw = moveAngleTowards(this.yaw, targetYaw, turnSpeed * dt);
    }

    // ── attack state machine ──
    if (this.state === PlayerState.ATTACK) {
      this.attackTimer += dt;
      const w = this.attackWeapon;
      if (!this.attackHasHit && this.attackTimer >= this.attackWindup) {
        this.attackHasHit = true;
        if (w.throwable) {
          ctx.onThrow?.(w);
        } else if (w.ranged) {
          this.anim.recoil();
          ctx.onShoot?.(w);
        } else {
          ctx.onSwing?.(w);
        }
      }
      if (this.attackTimer >= this.attackDuration) {
        this.state = PlayerState.NORMAL;
        this.lastAttackEnd = performance.now() / 1000;
        if (this.attackQueued) {
          this.attackQueued = false;
          this.tryAttack();
        }
      }
    } else if (this.state === PlayerState.STAGGER) {
      this.staggerTimer -= dt;
      if (this.staggerTimer <= 0) this.state = PlayerState.NORMAL;
    } else if (dead) {
      this.deathTimer += dt;
    }

    // ── blocking ──
    if (!dead && ctx.controlsEnabled) {
      const wantBlock = input.mouse.right && this.state !== PlayerState.ATTACK && !this.weapon.ranged;
      this.blocking = wantBlock && this.survival.stamina > 3;
    } else {
      this.blocking = false;
    }

    // Footsteps come from the animation controller (see `_footstep`), which
    // fires them at the frame a foot actually plants.

    this._updateLights(dt, cameraYaw, ctx);

    // ── mesh + animation ──
    this.rig.place(this.pos.x, this.pos.y, this.pos.z, this.yaw);
    this._animate(dt, ctx);
    this.syncWeaponMesh();
  }

  /**
   * Dodge and shove, read before anything else moves.
   *
   * A double-tap is detected on the second key-*down*: the first press is an
   * ordinary step that has already happened, so nothing waits on a timer and
   * the responsiveness of plain movement is untouched.
   */
  _readMobilityInput(input, cameraYaw, ctx) {
    const C = CFG.combat;
    const fwdX = Math.sin(cameraYaw);
    const fwdZ = Math.cos(cameraYaw);
    const rightX = -Math.cos(cameraYaw);
    const rightZ = Math.sin(cameraYaw);

    for (const [code, sx, sz] of DODGE_KEYS) {
      if (!input.pressed(code)) continue;
      if (this._tapKey === code && this.clock - this._tapAt <= C.dodgeTapWindow) {
        this._tapKey = null;
        this.tryDodge(fwdX * sz + rightX * sx, fwdZ * sz + rightZ * sx);
      } else {
        this._tapKey = code;
        this._tapAt = this.clock;
      }
    }

    // Same verb on a key of its own: where you are going, or straight back.
    if (input.pressed('KeyC')) {
      const m = input.moveAxis();
      const ax = fwdX * m.z + rightX * m.x;
      const az = fwdZ * m.z + rightZ * m.x;
      if (Math.hypot(ax, az) > 0.01) this.tryDodge(ax, az);
      else this.tryDodge(-Math.sin(this.yaw), -Math.cos(this.yaw));
    }

    if (input.pressed('KeyV')) this.tryShove(ctx);
    if (input.pressed('KeyR')) this.startReload();
  }

  /**
   * Torch and self-fill. Split out because a vault or a spell inside a
   * wardrobe skips the rest of the update but still has to carry its light.
   */
  _updateLights(dt, cameraYaw, ctx) {
    if (this.flashlightOn) {
      this.battery -= dt;
      if (this.battery <= 0) {
        this.battery = 0;
        this.flashlightOn = false;
        this.survival.emit('bad', 'Your torch dies.');
      }
    }
    const fl = this.flashlight;
    const hiddenAway = !!this.hidden;
    const targetInt = this.flashlightOn && !hiddenAway
      ? (this.battery < 20 ? 34 + Math.sin(performance.now() * 0.02) * 20 : 68)
      : 0;
    fl.intensity += (targetInt - fl.intensity) * Math.min(1, dt * 10);
    const hx = this.pos.x,
      hy = this.pos.y + (this.crouching ? 1.12 : 1.5),
      hz = this.pos.z;
    fl.position.set(hx, hy, hz);
    const pitch = ctx.cameraPitch || 0;
    fl.target.position.set(
      hx + Math.sin(cameraYaw) * 12 * Math.cos(pitch),
      hy + Math.sin(pitch) * 12,
      hz + Math.cos(cameraYaw) * 12 * Math.cos(pitch)
    );
    fl.target.updateMatrixWorld();

    /**
     * Where the beam actually lands, for anything that might notice it.
     *
     * Zombies investigate the *lit patch*, not the person holding the torch —
     * so this has to be the point on the ground the cone is pointing at, not
     * an offset from the player. Stopped at the first wall, because a beam
     * does not go through brick.
     */
    if (this.flashlightOn) {
      const dx = Math.sin(cameraYaw);
      const dz = Math.cos(cameraYaw);
      const reach = 11;
      const hit = this.world.collision.raycast(hx, hz, hx + dx * reach, hz + dz * reach, 1.2, this.scratch);
      const t = hit ? Math.max(0.15, hit.t) : 1;
      this.torchPoint = this.torchPoint || new THREE.Vector3();
      this.torchPoint.set(hx + dx * reach * t, 0, hz + dz * reach * t);
    } else {
      this.torchPoint = null;
    }
    this.selfLight.position.set(hx, this.pos.y + 1.1, hz);
    this.selfLight.intensity = ctx.night && !hiddenAway ? 5.5 : 0.0;
  }

  /**
   * Fired by the animation controller at a foot-plant. Same sound and same
   * noise event as before — it just happens on the right frame now.
   */
  _footstep() {
    if (this.state === PlayerState.DEAD || !this.grounded) return;
    const surf = this.world.surfaceAt(this.pos.x, this.pos.z);
    const indoors = !!this.world.isInside(this.pos.x, this.pos.z);
    this.audio.footstep(undefined, undefined, surf, this.sprinting, indoors);
    const r = this.crouching
      ? CFG.stealth.crouchFootstepNoise
      : this.sprinting
        ? CFG.noise.footstepSprint
        : CFG.noise.footstepWalk * (surf === 'grass' ? 0.6 : 1);
    this.noise.emit(this.pos.x, this.pos.z, r, 'player', 'step');
  }

  /**
   * Describe what the player is doing and let the controller work out how to
   * show it. Attacks are not a state here — they are a one-shot laid over
   * whatever the legs are already doing, started back in `tryAttack`.
   */
  _animate(dt, ctx) {
    const anim = this.anim;
    const w = this.weapon;
    const armed = !!w.ranged;

    if (this.state === PlayerState.DEAD) {
      this.rig.updateDeath(this.deathTimer);
      anim.update(dt, { speed: 0 });
      return;
    }

    anim.setCrouch(this.crouching && !this.vaulting && !this.dodging);
    this.rig.setCrouch(anim.crouchAmount);

    /**
     * The trail is on only while a heavy weapon is actually in its active
     * frames — it is a readability aid for "that arc has already happened",
     * not a decoration, so it must not linger through the recovery.
     */
    const arc =
      w.trail &&
      this.state === PlayerState.ATTACK &&
      this.attackTimer > this.attackWindup * 0.45 &&
      this.attackTimer < this.attackWindup + w.active + 0.06;
    this.rig.updateTrail(dt, !!arc, w.trail || 0);

    if (this.finisher) {
      anim.request('idle');
    } else if (this.dodging) {
      anim.request(this.speed > 3 ? 'run' : 'walk', { armed });
    } else if (this.vaulting) {
      anim.request('jump');
    } else if (this.hidden) {
      anim.request('idle');
    } else if (this.state === PlayerState.STAGGER) {
      anim.request('stagger');
    } else if (!this.grounded) {
      anim.request(this.vel.y > 0.4 ? 'jump' : 'fall');
    } else if (this.blocking && this.speed < 0.7) {
      anim.request('block');
    } else if (this.speed > CFG.anim.moveThreshold) {
      anim.request(this.sprinting ? 'run' : 'walk', { armed });
    } else {
      anim.request('idle', { armed });
    }

    anim.update(dt, {
      speed: this.speed,
      distance: 0,                   // the player is never far from the camera
      blocking: this.blocking,
      aiming: ctx?.aiming && armed,
      carrying: w.id !== 'fists' && !armed,
    });
  }
}
