/**
 * Zombie.js — a single infected, with a small honest state machine.
 *
 *   IDLE ⇄ WANDER → INVESTIGATE → CHASE → ATTACK
 *                        ↑           ↓
 *                      SEARCH ←──────┘
 *
 * Perception is two-channel. Sight is a cone with a line-of-sight check and a
 * *gradual* awareness meter, so being spotted is something you can feel coming
 * and back away from. Hearing is instant but only gives a position, not a
 * lock — which is what makes noise discipline matter.
 */

import * as THREE from 'three';
import CFG from '../core/Config.js';
import { clamp, clamp01, angleDelta, moveAngleTowards } from '../core/Utils.js';
import { createRig } from './CharacterRig.js';

export const ZState = {
  IDLE: 'idle',
  WANDER: 'wander',
  INVESTIGATE: 'investigate',
  CHASE: 'chase',
  ATTACK: 'attack',
  SEARCH: 'search',
  STAGGER: 'stagger',
  SIEGE: 'siege',       // taking a door or a boarded window apart
  CLIMB: 'climb',       // hauling itself through a smashed window
  DOWN: 'down',         // flat on its back after a heavy hit — finishable
  FLEE: 'flee',         // on fire, and briefly remembering what fear was
  SCREAM: 'scream',     // screamer: two seconds of inhale you can interrupt
  LUNGE: 'lunge',       // runner: committed, and helpless afterwards
  LINGER: 'linger',     // standing over something dead, losing interest slowly
  DEAD: 'dead',
};

export const ARCHETYPES = {
  shambler: {
    name: 'shambler',
    hp: 94,
    walk: 0.95,
    chase: 2.78,
    damage: 14,
    sight: 21,
    hearing: 1.0,
    attackRange: 1.62,
    windup: 0.54,
    recover: 0.88,
    staggerResist: 0.0,
    turn: 2.6,
    gait: 'shamble',
    groanChance: 0.5,
  },
  stalker: {
    name: 'stalker',
    hp: 66,
    walk: 1.35,
    chase: 4.15,
    damage: 11,
    sight: 25,
    hearing: 1.35,
    attackRange: 1.6,
    windup: 0.38,
    recover: 0.62,
    staggerResist: 0.15,
    turn: 4.6,
    gait: 'lurch',
    groanChance: 0.32,
  },
  bloated: {
    name: 'bloated',
    hp: 215,
    walk: 0.7,
    chase: 1.92,
    damage: 25,
    sight: 17,
    hearing: 0.85,
    attackRange: 1.85,
    windup: 0.78,
    recover: 1.15,
    staggerResist: 0.62,
    turn: 1.5,
    gait: 'shamble',
    groanChance: 0.72,
    radius: 0.5,
    bulk: 1.1,
  },

  // ─────────────────────────────────────────────────────────── specials ──

  /**
   * Screamer. Forty hit points and no interest in touching you: everything it
   * is worth is in the two seconds between noticing you and telling the
   * street. It is a priority target by construction — the correct response to
   * hearing one inhale is to drop whatever you were doing.
   */
  screamer: {
    name: 'screamer',
    special: 'screamer',
    /**
     * There is no bespoke model for a screamer, so it borrows the thin one and
     * earns its silhouette from proportion instead: tallest thing on the
     * street and half the width of a shambler, with its head thrown back the
     * moment it starts. `variantPin` fixes its palette so every screamer is
     * the same colour and you learn it once.
     */
    model: 'stalker',
    variantPin: 3,
    lean: -0.12,              // stands unnaturally upright
    hp: 40,
    walk: 1.15,
    chase: 3.1,
    damage: 6,
    sight: 24,
    hearing: 1.2,
    attackRange: 1.5,
    windup: 0.6,
    recover: 1.0,
    staggerResist: 0.0,
    turn: 3.8,
    gait: 'lurch',
    groanChance: 0.22,
    radius: 0.34,
    bulk: 0.72,               // thin — reads as a different species at 30 m
  },

  /**
   * Runner. The one that arrives before you have decided anything. Low health
   * and a lunge that commits it completely: if you are still there when it
   * lands you are hurt, and if you are not, it spends a full second on the
   * floor in front of you.
   */
  runner: {
    name: 'runner',
    special: 'runner',
    // Small, low and pitched forward — the opposite read to the screamer, so
    // the two are never confused at distance even though they share a mesh.
    model: 'stalker',
    variantPin: 6,
    lean: 0.42,
    hp: 52,
    walk: 1.5,
    chase: 6.6,               // ≈1.6× a stalker, in bursts
    damage: 12,
    sight: 26,
    hearing: 1.4,
    attackRange: 1.6,
    windup: 0.3,
    recover: 0.55,
    staggerResist: 0.05,
    turn: 5.4,
    gait: 'lurch',
    groanChance: 0.18,
    radius: 0.36,
    bulk: 0.86,
  },

  /**
   * Brute. Rare, and the only thing in the game a shut door does not really
   * solve. It goes through a block, so backing off is the answer rather than
   * guarding, and it takes a boarded door apart in the time a shambler needs
   * to scratch it.
   */
  brute: {
    name: 'brute',
    special: 'brute',
    // Simply much bigger than anything else in the game.
    model: 'bloated',
    variantPin: 1,
    lean: 0.16,
    hp: 520,
    walk: 0.62,
    chase: 2.15,
    damage: 34,
    sight: 18,
    hearing: 0.8,
    attackRange: 2.1,
    windup: 0.95,
    recover: 1.3,
    staggerResist: 0.88,
    turn: 1.15,
    gait: 'shamble',
    groanChance: 0.8,
    radius: 0.66,
    bulk: 1.32,
  },
};

/** Archetype ids that are specials, in the order the director prefers them. */
export const SPECIALS = ['runner', 'screamer', 'brute'];

let _nextId = 1;

export class Zombie {
  constructor(scene, world, audio, particles, opts = {}) {
    this.id = _nextId++;
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.particles = particles;

    this.archetype = ARCHETYPES[opts.type] || ARCHETYPES.shambler;
    this.type = this.archetype.name;
    this.group = opts.group || 'loner';

    this.pos = new THREE.Vector3(opts.x || 0, 0, opts.z || 0);
    this.vel = new THREE.Vector3();
    this.home = new THREE.Vector2(opts.x || 0, opts.z || 0);
    this.yaw = Math.random() * Math.PI * 2;

    this.maxHp = this.archetype.hp * (0.85 + Math.random() * 0.35);
    this.hp = this.maxHp;
    this.radius = this.archetype.radius ?? 0.4;
    this.special = this.archetype.special || null;

    this.state = ZState.IDLE;
    this.stateTimer = Math.random() * 3;
    this.awareness = 0;
    this.lastKnown = null;      // {x,z}
    this.searchTimer = 0;
    this.attackTimer = 0;
    this.attackCooldown = Math.random() * 0.8;
    this.staggerTimer = 0;
    this.deathTimer = 0;
    this.hasSwung = false;

    this.path = null;
    this.pathIndex = 0;
    this.repathTimer = Math.random() * 0.5;

    this.wanderTarget = null;
    this.wanderTimer = 0;
    this.groanTimer = Math.random() * 8;
    this.alerted = false;
    this.distToPlayer = 999;

    // Wounds. Legs come off before the rest of it stops working.
    this.cripples = 0;
    this.crawling = false;
    this.bleedStacks = 0;
    this.bleedTimer = 0;
    this.burnTimer = 0;         // purely cosmetic: how long since fire touched it
    this.downTimer = 0;
    this.push = null;           // an in-progress shove, resolved in _applyMotion
    this.fleeTimer = 0;
    this.fleeFrom = null;
    this.eyeGlow = 0;

    // Specials.
    this.screamTimer = 0;
    this.screamCooldown = Math.random() * 6;
    this.lungeTimer = 0;
    this.lungeCooldown = Math.random() * 2;
    this.lungeDir = { x: 0, z: 1 };
    this.lungeHit = false;
    this.burstTimer = Math.random() * 2;
    this.bursting = false;
    this.stepTimer = 0;

    // Perception 2.0
    this.lastSeenDir = null;    // which way they were going when we lost them
    this.lingerTimer = 0;
    this.lingerAt = null;
    this.leader = null;         // group-mate this one ambles after
    this.siegeSlot = 0;         // queue position at a doorway, set by the horde
    this.migrateTo = null;      // a column crossing the map has somewhere to be

    // AI LOD
    this._lodAccum = 0;
    this._lodSkip = false;

    // Siege / memory
    this.siegeTarget = null;
    this.siegeBangTimer = 0;
    this.climbTimer = 0;
    this.climbTarget = null;
    this.memoryOpening = null;    // the way in they last saw you take
    this.memoryTimer = 0;
    this.knownHide = null;        // the wardrobe they watched you climb into

    this.scratch = [];
    this.scratchOps = [];

    // Individual look: one of the palette variants, plus a height jitter, so
    // two shamblers side by side are never the same person. Derived from the
    // id rather than Math.random so a seeded run looks the same twice.
    const hash = ((this.id * 2654435761) >>> 0) / 4294967296;
    this.rig = createRig(this.type, {
      // Specials borrow another archetype's mesh and pin its palette, so every
      // screamer is the same colour and you only have to learn it once.
      asset: this.archetype.model || this.type,
      variant: this.archetype.variantPin ?? this.id,
      jitter: 1 + (hash * 2 - 1) * (this.special ? CFG.anim.scaleJitter * 0.4 : CFG.anim.scaleJitter),
      bulk: this.archetype.bulk ?? (this.type === 'stalker' ? 0.94 : 1.0),
      lean: this.archetype.lean || 0,
    });
    this.mesh = this.rig.root;
    this.anim = this.rig.controller;
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);

    this.active = true;
  }

  /**
   * Geometry, atlases and palette materials are shared by the whole cast, so
   * an individual only gives back its own Object3Ds and its mixer bindings —
   * see CharacterRig.dispose().
   */
  dispose() {
    this.scene.remove(this.mesh);
    this.rig.dispose();
  }

  get isDead() {
    return this.state === ZState.DEAD;
  }

  /** Flat on the floor and finishable. */
  get downed() {
    return this.state === ZState.DOWN;
  }

  get eyeY() {
    return this.pos.y + (this.crawling ? CFG.combat.crawlEyeHeight : 1.45);
  }

  /** Where a swing at its body lands, in metres above its feet. */
  get chestY() {
    if (this.crawling) return 0.4;
    if (this.downed) return 0.35;
    return 1.15;
  }

  /** How far off the ground the top of its head is. */
  get standHeight() {
    if (this.crawling || this.downed) return 0.7;
    return this.rig?.height ?? 1.78;
  }

  /** Reach. A thing dragging itself along the road cannot reach as far. */
  get attackReach() {
    return this.crawling ? CFG.combat.crawlAttackRange : this.archetype.attackRange;
  }

  // ────────────────────────────────────────────────────────── damage ──

  /**
   * Take a hit.
   *
   * `opts.zone` is where it landed — head, body or legs. The multiplier lives
   * here rather than at the call site so no future weapon can forget to apply
   * it, and because the *other* consequences of a zone (a rattled head, a leg
   * that stops working) belong to the body that owns them.
   */
  takeDamage(amount, fromX, fromZ, opts = {}) {
    if (this.isDead) return false;
    const C = CFG.combat;
    const zone = opts.zone || 'body';
    const dealt = amount * (C.zoneMul[zone] ?? 1);
    this.hp -= dealt;

    const dx = this.pos.x - fromX;
    const dz = this.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;

    const y =
      zone === 'head' ? this.pos.y + this.standHeight - 0.12
      : zone === 'legs' ? this.pos.y + 0.45
      : this.pos.y + this.chestY;
    this.particles.blood(
      this.pos.x,
      y,
      this.pos.z,
      dx / d,
      dz / d,
      opts.heavy || zone === 'head' ? 22 : 13,
      opts.heavy || zone === 'head' ? 1.5 : 1
    );

    if (this.hp <= 0) {
      this.die(dx / d, dz / d);
      return true;
    }

    if (opts.bleed) this.addBleed(opts.bleed);

    // A leg is a thing you can take away without killing it.
    if (zone === 'legs' && dealt >= 8 && opts.canCripple !== false) this._cripple();

    // Knockback + stagger, resisted by the heavier types. A hit to the head
    // rattles far out of proportion to the damage — that is the tell that
    // aiming up was worth doing.
    const resist = this.archetype.staggerResist;
    const kb = (opts.knockback || 1.5) * (1 - resist);
    this.vel.x += (dx / d) * kb;
    this.vel.z += (dz / d) * kb;

    const zoneStagger =
      zone === 'head' ? C.headStaggerMul : zone === 'legs' ? C.legStaggerMul : 1;
    const st = (opts.stagger || 0.3) * zoneStagger * (1 - resist);

    /**
     * Knocked flat. Only a weapon with the weight for it, and only into a
     * target already nearly finished, so it reads as the blow that put it down
     * rather than a stun you can hold someone in.
     */
    if (
      opts.knockdown &&
      !this.crawling &&
      this.hp <= this.maxHp * C.knockdownHpFrac &&
      this.state !== ZState.DOWN
    ) {
      this.knockDown();
    } else if (st > 0.05 && this.state !== ZState.DOWN) {
      this.state = ZState.STAGGER;
      this.staggerTimer = st;
      this.attackTimer = 0;
      this.hasSwung = false;
    }

    // Being hit always reveals you.
    this.lastKnown = { x: fromX, z: fromZ };
    this.awareness = 1.2;
    if (!this.alerted) this.alert();
    return false;
  }

  /**
   * Damage with no author. Fire and blood loss do not tell it where you are,
   * which is the whole reason a molotov is worth throwing from cover.
   */
  attrition(amount, dirX = 0, dirZ = 1) {
    if (this.isDead) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.die(dirX, dirZ);
      return true;
    }
    return false;
  }

  addBleed(n = 1) {
    this.bleedStacks = Math.min(CFG.combat.bleedMaxStacks, this.bleedStacks + n);
    this.bleedTimer = CFG.combat.bleedTime;
  }

  /**
   * One leg gone slows it down; the second puts it on its belly for good. A
   * crawler is not a defeated zombie — it is a quiet one at ankle height that
   * you will walk over in the dark.
   */
  _cripple() {
    this.cripples++;
    this.audio.impact('hit_soft', this.pos.x, this.pos.z);
    if (this.cripples >= 2 && !this.crawling) {
      this.crawling = true;
      this.rig.setCrawl(true);
      this.groanTimer = 0;
      if (this.state === ZState.CLIMB) {
        this.state = ZState.CHASE;
        this.climbTarget = null;
      }
    }
  }

  knockDown() {
    this.state = ZState.DOWN;
    this.downTimer = CFG.combat.knockdownTime;
    this.attackTimer = 0;
    this.hasSwung = false;
    this.path = null;
    this.rig.setDown(true);
    this.audio.impact('hit_blunt', this.pos.x, this.pos.z);
  }

  /** Fire, and no idea who threw it. */
  scorch(amount) {
    this.burnTimer = 0.4;
    return this.attrition(amount);
  }

  /**
   * Terror. The bloated ones do not have enough left to be afraid with, which
   * is exactly why a molotov does not solve every problem.
   */
  terrify(fromX, fromZ) {
    if (this.type === 'bloated' || this.isDead || this.state === ZState.DOWN) return false;
    this.fleeFrom = { x: fromX, z: fromZ };
    this.fleeTimer = CFG.fire.fleeTime;
    if (this.state !== ZState.FLEE) {
      this.state = ZState.FLEE;
      this.path = null;
      this.audio.shriek(this.pos);
    }
    return true;
  }

  /**
   * Shoved. Not damage — distance, bought with stamina. The displacement is
   * resolved against the world in `_applyMotion`, so you cannot push anything
   * through a wall.
   */
  shove(dirX, dirZ, dist = CFG.combat.shoveDistance, stagger = CFG.combat.shoveStagger) {
    if (this.isDead) return false;
    const resist = this.archetype.staggerResist;
    const d = dist * (1 - resist * 0.6);
    this.push = { dx: dirX, dz: dirZ, left: d, speed: d / CFG.combat.shovePushTime };
    /**
     * Drop whatever it was already doing. A shove has to buy a *dependable*
     * amount of space — leaving the walk-into-you velocity in place quietly
     * eats a fifth of it, and a panic button you cannot predict is not one.
     */
    this.vel.x = 0;
    this.vel.z = 0;
    const interrupted = this.state === ZState.ATTACK && !this.hasSwung;
    if (this.state !== ZState.DOWN) {
      this.state = ZState.STAGGER;
      this.staggerTimer = Math.max(this.staggerTimer, stagger * (1 - resist));
      this.attackTimer = 0;
      this.hasSwung = false;
    }
    return interrupted;
  }

  die(dirX = 0, dirZ = 1) {
    // The horde prunes stale attack tokens on request, so dying is enough.
    this.state = ZState.DEAD;
    this.deathTimer = 0;
    this.vel.set(0, 0, 0);
    this.audio.zombieDeath(this.pos);
    this.particles.blood(this.pos.x, this.pos.y + 1.0, this.pos.z, dirX, dirZ, 26, 1.4);
    // The rig picks the fall's direction and pace from this roll.
    this.rig.beginDeath(Math.random());
  }

  /** Called when this zombie first spots the player — it screams. */
  alert() {
    this.alerted = true;
    this.audio.shriek(this.pos);
  }

  // ──────────────────────────────────────────────────────── perception ──

  _perceive(dt, ctx) {
    const p = ctx.player;
    const A = this.archetype;
    const dx = p.pos.x - this.pos.x;
    const dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    this.distToPlayer = dist;

    if (p.state === 'dead') {
      this.awareness = Math.max(0, this.awareness - dt * 0.4);
      return;
    }

    // Night cuts their sight too — but they hear far better, and the whole
    // horde is more aggressive.
    let range = A.sight * (ctx.night ? CFG.zombie.sightRangeNight / CFG.zombie.sightRange : 1);
    if (p.flashlightOn) range *= 1.45;
    if (ctx.night && p.flashlightOn) range *= 1.2;
    // A crouched body is a much smaller thing to pick out of a street.
    if (p.crouching) range *= CFG.stealth.crouchSightMul;
    // Down in a bush, or down in the dark with nothing lit nearby.
    if (ctx.playerConcealed) range *= CFG.stealth.concealSightMul;

    // Inside a wardrobe you are simply not there to be seen. Anything that
    // watched you climb in keeps hunting — see Horde.onPlayerHide.
    let sees = false;
    if (p.hidden) {
      if (this.knownHide) {
        // We watched them get in. Keep going to the floor beside it.
        this.lastKnown = {
          x: this.knownHide.approachX ?? this.knownHide.x,
          z: this.knownHide.approachZ ?? this.knownHide.z,
        };
        this.awareness = Math.max(this.awareness, 1.05);
      } else {
        this.awareness = Math.max(0, this.awareness - dt * 0.5);
      }
      this.lastSeenTime = (this.lastSeenTime || 0) + dt;
      this._hear(dt, ctx, A);
      return false;
    }

    if (dist < range) {
      const facing = Math.cos(this.yaw) * (dz / (dist || 1)) + Math.sin(this.yaw) * (dx / (dist || 1));
      const inCone = facing > Math.cos((CFG.zombie.fovDeg * Math.PI) / 360);
      const veryClose = dist < CFG.zombie.peripheralRange;
      if (inCone || veryClose) {
        sees = !this.world.collision.lineBlocked(
          this.pos.x,
          this.pos.z,
          p.pos.x,
          p.pos.z,
          this.crawling ? 0.6 : 1.3,
          this.scratch
        );
      }
    }

    if (sees) {
      const prox = 1 - dist / Math.max(1, range);
      let rate = 0.65 + prox * 1.9;
      if (p.sprinting) rate *= 2.3;
      else if (p.speed > 0.6) rate *= 1.35;
      else rate *= 0.6;               // standing still genuinely helps
      if (p.crouching) rate *= CFG.stealth.crouchAwarenessMul;
      if (p.flashlightOn) rate *= 1.6;
      if (ctx.night) rate *= 0.85;
      this.awareness = Math.min(1.6, this.awareness + rate * dt);
      this.lastKnown = { x: p.pos.x, z: p.pos.z };
      // Remember which way they were going, not just where they were. This is
      // what turns a search from casting about into following.
      if (p.speed > 0.8) {
        const l = Math.hypot(p.vel.x, p.vel.z) || 1;
        this.lastSeenDir = { x: p.vel.x / l, z: p.vel.z / l };
      }
      this.lastSeenTime = 0;
    } else {
      this.awareness = Math.max(0, this.awareness - dt * (this.state === ZState.CHASE ? 0.22 : 0.45));
      this.lastSeenTime = (this.lastSeenTime || 0) + dt;
      this._seeTorch(dt, ctx, range);
    }

    this._hear(dt, ctx, A);
    return sees;
  }

  /**
   * The torch, not the person holding it.
   *
   * A beam sweeping a wall is the brightest thing in a dead street, and what
   * it draws attention to is *the lit patch* — which is somewhere you are
   * pointing, not somewhere you are. That gap is a tool: you can throw light
   * down an alley and walk the other way, and it is also a trap, because a
   * torch aimed at your own feet is a torch aimed at you.
   */
  _seeTorch(dt, ctx, range) {
    const p = ctx.player;
    if (!p.flashlightOn || !p.torchPoint || p.hidden) return;
    const tx = p.torchPoint.x;
    const tz = p.torchPoint.z;
    const dx = tx - this.pos.x;
    const dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    // A lit patch reads from further than a body does.
    if (d > range * 1.5) return;

    const facing = Math.cos(this.yaw) * (dz / (d || 1)) + Math.sin(this.yaw) * (dx / (d || 1));
    if (facing < Math.cos((CFG.zombie.fovDeg * Math.PI) / 360) && d > CFG.zombie.peripheralRange) return;
    if (this.world.collision.lineBlocked(this.pos.x, this.pos.z, tx, tz, 1.2, this.scratch)) return;

    this.awareness = Math.min(0.9, this.awareness + dt * 0.9);
    this.lastKnown = { x: tx, z: tz };
    if (this.state === ZState.IDLE || this.state === ZState.WANDER || this.state === ZState.LINGER) {
      this._enterInvestigate();
    }
  }

  /**
   * Something died here recently. They stop and stand over it.
   *
   * It costs them nothing and it gives you a lot: a knot of bodies around a
   * corpse is a legible marker for "this is where the fighting was", visible
   * from the far end of a street, and it means killing something quietly still
   * leaves a mark on the map's behaviour.
   */
  _checkCorpses(ctx) {
    if (this.special || this.crawling) return false;
    if (this.awareness > 0.4 || this.lingerTimer > 0) return false;
    const c = ctx.freshCorpse?.(this.pos.x, this.pos.z, CFG.zombie.corpseInterest);
    if (!c) return false;
    this.state = ZState.LINGER;
    this.lingerTimer = CFG.zombie.lingerTime * (0.7 + Math.random() * 0.7);
    this.lingerAt = { x: c.pos.x, z: c.pos.z };
    this.path = null;
    if (Math.random() < 0.5) {
      this.audio.groanAt(this.pos, { gain: 0.14, pitch: 0.85, dur: 0.9 });
    }
    return true;
  }

  /**
   * Hearing — instant, gives a position but not a lock.
   *
   * Sound is muffled by everything it has to pass through, so the same
   * footstep that gives you away in the street is nothing through a shut door.
   */
  _hear(dt, ctx, A) {
    const sens = A.hearing * (ctx.night ? 1.25 : 1);
    const heard = ctx.noise.strongestAt(this.pos.x, this.pos.z, sens, (ex, ez) =>
      this.world.soundOcclusion(ex, ez, this.pos.x, this.pos.z)
    );
    if (!heard) return;
    if (heard.source === 'zombie' && heard.id === this.id) return;
    const interesting =
      heard.source === 'player' || (heard.source === 'zombie' && heard.kind === 'alert');
    if (!interesting) return;

    this.lastKnown = { x: heard.x, z: heard.z };
    this.awareness = Math.min(1.6, this.awareness + heard.strength * dt * 2.6);
    if (
      this.state === ZState.IDLE ||
      this.state === ZState.WANDER ||
      (this.state === ZState.SEARCH && heard.strength > 0.35)
    ) {
      this._enterInvestigate();
    }
  }

  _enterInvestigate() {
    if (this.state === ZState.CHASE || this.state === ZState.ATTACK) return;
    if (this.state === ZState.SIEGE || this.state === ZState.CLIMB) return;
    this.state = ZState.INVESTIGATE;
    this.stateTimer = CFG.zombie.investigateTime;
    this.path = null;
    this.repathTimer = 0;
  }

  // ──────────────────────────────────────────────────── doors and windows ──

  /** They saw you go through this. They will try it themselves. */
  rememberOpening(op) {
    this.memoryOpening = op;
    this.memoryTimer = CFG.openings.siegeMemory;
  }

  /**
   * Is this opening actually between us? Answered with the owning building's
   * bounds rather than the opening's own normal — a north-facing window says
   * "inside" about the entire southern half of the map otherwise.
   */
  _separates(op, tx, tz) {
    const b = op.building?.bounds;
    if (!b) return false;
    const tIn = tx > b.minX && tx < b.maxX && tz > b.minZ && tz < b.maxZ;
    const mIn = this.pos.x > b.minX && this.pos.x < b.maxX && this.pos.z > b.minZ && this.pos.z < b.maxZ;
    return tIn !== mIn;
  }

  /**
   * Something shut between here and where we are going. Returns the opening
   * worth taking apart, or null if the way is clear enough to keep walking.
   */
  _findSiegeTarget(tx, tz) {
    const ops = this.world.openingsWithin(
      this.pos.x, this.pos.z, CFG.openings.siegeRange + this.radius, this.scratchOps
    );
    let best = null;
    let bestD = Infinity;
    for (const op of ops) {
      if (op.passable || op.state === 'broken') continue;
      if (!this._separates(op, tx, tz)) continue;
      const d = Math.hypot(op.x - this.pos.x, op.z - this.pos.z);
      if (d < bestD) {
        bestD = d;
        best = op;
      }
    }
    return best;
  }

  /** A smashed window with the player on the other side is a way in. */
  _findClimbTarget(tx, tz) {
    const ops = this.world.openingsWithin(
      this.pos.x, this.pos.z, CFG.openings.siegeRange + this.radius, this.scratchOps
    );
    if (this.crawling) return null;
    for (const op of ops) {
      if (!op.climbable) continue;
      if (!this._separates(op, tx, tz)) continue;
      return op;
    }
    return null;
  }

  /**
   * The nearest hole in the building they are shut out of, so they walk to a
   * door rather than grinding on the brickwork beside it. Open ones first —
   * why break in when someone left it ajar.
   */
  _findWayIn(tx, tz, maxDist = 20) {
    const ops = this.world.openingsWithin(this.pos.x, this.pos.z, maxDist, this.scratchOps);
    let best = null;
    let bestScore = Infinity;
    for (const op of ops) {
      if (op.state === 'boarded' && op.boardHp > 0) {
        // still worth walking to, just the least attractive
      }
      if (!this._separates(op, tx, tz)) continue;
      const d = Math.hypot(op.x - this.pos.x, op.z - this.pos.z);
      const penalty = op.passable ? 0 : op.state === 'boarded' ? 14 : op.isDoor ? 4 : 9;
      const score = d + penalty;
      if (score < bestScore) {
        bestScore = score;
        best = op;
      }
    }
    return best;
  }

  /**
   * Where *this* body should stand at an opening.
   *
   * `siegeSlot` is handed out by the horde each frame, nearest first. Slot 0
   * gets the doorway itself and the rest fan out alternately along the wall,
   * which is the difference between a queue and a scrum.
   */
  _queuePoint(op, dist) {
    const outside = op.isOutside(this.pos.x, this.pos.z);
    const s = this.siegeSlot | 0;
    if (s <= 0) return op.standPoint(outside, dist);

    const rank = Math.ceil(s / 2);
    /**
     * Fan outward, not just sideways.
     *
     * A doorway's tangent runs *along the wall*, so a purely lateral offset
     * puts every queue slot inside the brickwork: the path request fails, the
     * body never moves, and six of them end up standing in the same square
     * metre — which is the exact failure this was meant to fix. Backing each
     * rank off along the normal as well puts the queue in open ground behind
     * the front-runner, where it can actually stand.
     */
    const stand = op.standPoint(outside, dist + rank * 0.85);
    /**
     * The fan stops widening after two ranks. Past that the offsets start
     * landing in whatever is beside the door — a hedge, a car, the next wall —
     * the path request fails, and two of them end up sharing a slot anyway.
     * Deep ranks queue straight back instead, which is what a queue is.
     */
    const off = (s % 2 === 1 ? 1 : -1) * Math.min(rank, 2) * 1.0;
    if (op.axis === 'x') return { x: stand.x + off, z: stand.z };
    return { x: stand.x, z: stand.z + off };
  }

  _enterSiege(op, ctx) {
    if (this.state === ZState.SIEGE && this.siegeTarget === op) return;
    this.state = ZState.SIEGE;
    this.siegeTarget = op;
    this.siegeBangTimer = 0;
    this.path = null;
    this.vel.set(0, 0, 0);
    ctx.noise?.emit(op.x, op.z, CFG.openings.bangNoise, 'zombie', 'alert');
  }

  _enterClimb(op) {
    this.state = ZState.CLIMB;
    this.climbTarget = op;
    this.climbTimer = 0;
    const to = op.standPoint(!op.isOutside(this.pos.x, this.pos.z), 1.2);
    this.climbFrom = { x: this.pos.x, z: this.pos.z };
    this.climbTo = to;
    this.vel.set(0, 0, 0);
  }

  // ─────────────────────────────────────────────────────────── specials ──

  /**
   * Start the scream.
   *
   * Nothing happens for two seconds. That gap is the entire archetype: it is
   * long enough to cross seven metres, draw and fire, or throw something, and
   * short enough that you have to decide immediately. If the screamer dies in
   * that window the call never happens at all — see `die`, which simply drops
   * the state.
   */
  _enterScream(ctx) {
    const S = CFG.specials.screamer;
    this.state = ZState.SCREAM;
    this.screamTimer = 0;
    this.path = null;
    this.vel.set(0, 0, 0);
    this.audio.screamerInhale(this.pos);
    // The inhale itself is a noise event — other zombies find it interesting,
    // and so does anything listening for where you are about to be.
    ctx.noise?.emit(this.pos.x, this.pos.z, 14, 'zombie', 'alert');
  }

  /** The call itself. Resolved by the horde, which owns who hears what. */
  _releaseScream(ctx) {
    const S = CFG.specials.screamer;
    this.audio.screamerCall(this.pos);
    ctx.noise?.emit(this.pos.x, this.pos.z, S.alertRadius, 'zombie', 'alert');
    ctx.onScream?.(this);
    this.screamCooldown = S.cooldown;
    this.state = ZState.CHASE;
  }

  /**
   * Commit. For the next third of a second the runner is a projectile with a
   * fixed heading, and for a full second after that it is a target — no
   * turning, no attacking, nothing. That recovery is not a penalty, it is the
   * reason the archetype is fair.
   */
  _enterLunge(ctx, tx, tz) {
    const R = CFG.specials.runner;
    const dx = tx - this.pos.x;
    const dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    this.state = ZState.LUNGE;
    this.lungeTimer = 0;
    this.lungeHit = false;
    this.lungeDir = { x: dx / d, z: dz / d };
    this.yaw = Math.atan2(dx, dz);
    this.path = null;
    this.audio.swing('whoosh');
    ctx.noise?.emit(this.pos.x, this.pos.z, 10, 'zombie', 'alert');
  }

  /**
   * Footfalls. A runner you can hear coming and a brute you can feel are the
   * two halves of "know which special is near with your eyes shut", so the
   * step cadence is driven off real speed rather than an animation event.
   */
  _specialFootsteps(dt, speed) {
    if (!this.special || this.isDead) return;
    if (this.special === 'runner') {
      if (speed < 2.2) return;
      this.stepTimer -= dt * (speed / 5);
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.5;
        this.audio.runnerStep(this.pos);
        if (Math.random() < 0.25) this.audio.runnerBreath(this.pos);
      }
    } else if (this.special === 'brute') {
      if (speed < 0.3) return;
      this.stepTimer -= dt * (speed / 1.2);
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.62;
        this.audio.bruteStep(this.pos);
      }
    }
  }

  _enterChase(ctx) {
    // An in-progress attack owns the state machine until it resolves —
    // otherwise a zombie standing next to you re-enters CHASE every frame and
    // its windup never completes.
    if (this.state === ZState.CHASE || this.state === ZState.ATTACK) return;
    const wasCalm = this.state === ZState.IDLE || this.state === ZState.WANDER || this.state === ZState.INVESTIGATE;
    this.state = ZState.CHASE;
    this.path = null;
    this.repathTimer = 0;
    if (wasCalm) {
      if (this.special === 'brute') this.audio.bruteRoar(this.pos);
      this.alert();
      // The scream is what pulls the rest of the street in.
      ctx.noise.emit(this.pos.x, this.pos.z, CFG.zombie.alertRadius, 'zombie', 'alert');
      ctx.onAlert?.(this);
    }
  }

  // ────────────────────────────────────────────────────────── movement ──

  /**
   * How fast it can actually go. A crawler has no gait left to scale — it
   * moves at one speed, always — while one bad leg is a straight 40% tax on
   * whatever it was going to do.
   */
  _spd(base, nightMul = 1) {
    if (this.crawling) return CFG.combat.crawlSpeed * nightMul;
    let s = base * nightMul * (this.cripples > 0 ? CFG.combat.crippleSpeedMul : 1);
    /**
     * Runners do not run flat out. They surge, close a few metres, and hitch —
     * which is both more unpleasant to watch and more readable to play
     * against, because the hitch is when you get to move.
     */
    if (this.special === 'runner') {
      const R = CFG.specials.runner;
      s *= this.bursting ? R.burstMul : R.cruiseMul;
    }
    return s;
  }

  /** Toggle the runner's surge. Runs on real time, not on state. */
  _updateBurst(dt) {
    if (this.special !== 'runner') return;
    const R = CFG.specials.runner;
    this.burstTimer -= dt;
    if (this.burstTimer > 0) return;
    this.bursting = !this.bursting;
    this.burstTimer = this.bursting ? R.burstOn : R.burstOff;
  }

  _requestPath(tx, tz, ctx) {
    ctx.nav.request(this, this.pos.x, this.pos.z, tx, tz, (path) => {
      if (path && path.length) {
        this.path = path;
        this.pathIndex = 0;
      } else {
        this.path = null;
      }
    });
  }

  _steer(dt, tx, tz, speed, ctx) {
    /**
     * Straight line if we can walk it; pathing is for going round things.
     *
     * Two probes, and both matter. Chest height answers "is there a wall in
     * the way". Shin height answers "is there a bed in the way" — a body can
     * see straight over a sofa and still not be able to walk through it, and
     * testing only the high line is what used to leave them grinding into
     * furniture instead of asking for a path around it.
     */
    const directClear =
      !this.world.collision.lineBlocked(this.pos.x, this.pos.z, tx, tz, 1.1, this.scratch) &&
      !this.world.collision.lineBlocked(this.pos.x, this.pos.z, tx, tz, 0.55, this.scratch);

    let gx = tx,
      gz = tz;

    if (!directClear) {
      this.repathTimer -= dt;
      if (!this.path || this.repathTimer <= 0) {
        this.repathTimer = CFG.zombie.repathInterval * (0.8 + Math.random() * 0.5);
        this._requestPath(tx, tz, ctx);
      }
      if (this.path && this.pathIndex < this.path.length) {
        let wp = this.path[this.pathIndex];
        while (
          this.pathIndex < this.path.length - 1 &&
          Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < 0.9
        ) {
          this.pathIndex++;
          wp = this.path[this.pathIndex];
        }
        gx = wp.x;
        gz = wp.z;
      }
    } else {
      this.path = null;
    }

    let dx = gx - this.pos.x;
    let dz = gz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) {
      dx /= d;
      dz /= d;
    }

    // Separation so a group doesn't collapse into one body.
    let sx = 0,
      sz = 0;
    /**
     * Skipped past the LOD distance — see `update` — with one exception.
     *
     * A siege is the one situation where bodies are guaranteed to be crowded
     * into a couple of square metres, and it usually happens at a door on the
     * far side of the map from wherever the player is standing. Dropping
     * separation there is exactly where it is needed most: the queue slots
     * space them out, and separation is what stops them walking through each
     * other on the way to those slots. There are never many besiegers, so the
     * exception costs nothing.
     */
    const neighbours =
      this._lodSkip && this.state !== ZState.SIEGE ? null : ctx.neighbours;
    if (neighbours) {
      for (let i = 0; i < neighbours.length; i++) {
        const o = neighbours[i];
        if (o === this || o.isDead) continue;
        const ox = this.pos.x - o.pos.x;
        const oz = this.pos.z - o.pos.z;
        const od2 = ox * ox + oz * oz;
        const minD = this.radius + o.radius + CFG.zombie.separation;
        if (od2 < minD * minD && od2 > 1e-5) {
          const od = Math.sqrt(od2);
          const w = (1 - od / minD) / od;
          sx += ox * w;
          sz += oz * w;
        }
      }
    }

    const steerX = dx + sx * 1.35;
    const steerZ = dz + sz * 1.35;
    const sl = Math.hypot(steerX, steerZ) || 1;

    const targetYaw = Math.atan2(dx, dz);
    this.yaw = moveAngleTowards(this.yaw, targetYaw, this.archetype.turn * dt);

    // They only accelerate in the direction they're facing — that's what makes
    // circle-strafing a genuine tactic.
    const facing = Math.cos(angleDelta(this.yaw, targetYaw));
    const throttle = clamp(0.35 + facing * 0.75, 0.2, 1);

    const accel = 11;
    const wantX = (steerX / sl) * speed * throttle;
    const wantZ = (steerZ / sl) * speed * throttle;
    this.vel.x += (wantX - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wantZ - this.vel.z) * Math.min(1, accel * dt);
  }

  _applyMotion(dt) {
    const col = this.world.collision;

    // A shove is a displacement, not a force: it covers an exact distance over
    // an exact time, then stops. Resolved through the same collision pass as
    // everything else, so you can shove something into a wall but never
    // through one.
    let px = 0,
      pz = 0;
    if (this.push) {
      const step = Math.min(this.push.left, this.push.speed * dt);
      this.push.left -= step;
      px = this.push.dx * step;
      pz = this.push.dz * step;
      if (this.push.left <= 1e-4) this.push = null;
    }

    const nx = this.pos.x + this.vel.x * dt + px;
    const nz = this.pos.z + this.vel.z * dt + pz;
    const res = col.resolveCircle(nx, nz, this.radius, this.pos.y, 1.75, 0.45, this.scratch);
    if (res.hit) {
      const into = this.vel.x * res.nx + this.vel.z * res.nz;
      if (into < 0) {
        this.vel.x -= res.nx * into;
        this.vel.z -= res.nz * into;
      }
    }
    this.pos.x = res.x;
    this.pos.z = res.z;

    // Gravity, so they fall off kerbs and car roofs rather than floating.
    const gy = col.groundHeightAt(this.pos.x, this.pos.z, this.pos.y + 0.45, this.scratch);
    if (this.pos.y > gy + 0.02) {
      this.vel.y = (this.vel.y || 0) - 19 * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y < gy) {
        this.pos.y = gy;
        this.vel.y = 0;
      }
    } else {
      this.pos.y = gy;
      this.vel.y = 0;
    }

    // Friction
    const f = Math.exp(-5.5 * dt);
    this.vel.x *= f;
    this.vel.z *= f;
  }

  // ──────────────────────────────────────────────────────────── update ──

  update(dt, ctx) {
    if (this.state === ZState.DEAD) {
      this.deathTimer += dt;
      this.rig.place(this.pos.x, this.pos.y, this.pos.z, this.yaw);
      this._animate(dt, ctx);
      return;
    }

    const A = this.archetype;
    /**
     * Night is faster, and the *fifth* night is faster than the first. The
     * per-night multiplier arrives in the context rather than being looked up
     * here, because a zombie has no business knowing what a campaign is.
     */
    const nightMul = ctx.night ? CFG.zombie.nightSpeedMul * (ctx.speedMul || 1) : 1;

    /**
     * AI level of detail.
     *
     * Past thirty metres you cannot see whether something noticed you a fifth
     * of a second late, so perception runs at 5 Hz on accumulated time and
     * neighbour separation is skipped outright — those two are the whole cost
     * of a distant zombie. Everything else keeps running every frame: a horde
     * that stops walking when you look away is a much worse bug than a horde
     * that costs a little.
     */
    const far = this.distToPlayer > CFG.zombie.lodDistance;
    this._lodSkip = far;
    let sees = this._lastSees || false;
    if (!far) {
      sees = this._perceive(dt, ctx);
      this._lodAccum = 0;
    } else {
      this._lodAccum += dt;
      const budget = 1 / CFG.zombie.lodHz;
      if (this._lodAccum >= budget) {
        sees = this._perceive(this._lodAccum, ctx);
        this._lodAccum = 0;
      }
    }
    this._lastSees = sees;

    // Awareness thresholds. Being flat on your back or on fire outranks
    // noticing anything.
    /**
     * States that own themselves.
     *
     * SIEGE and CLIMB are here for a reason worth spelling out: both have
     * their own complete exit conditions, and without them in this list the
     * awareness gate re-enters CHASE *every frame* for any besieger that can
     * still see the player — through a window, across a garden, over a low
     * wall. The door siege only ever worked because the player was usually
     * hidden behind the door it was attacking; the moment they were visible,
     * the zombie thrashed between states and stopped doing damage.
     */
    const overridden =
      this.state === ZState.STAGGER ||
      this.state === ZState.ATTACK ||
      this.state === ZState.DOWN ||
      this.state === ZState.FLEE ||
      this.state === ZState.SCREAM ||
      this.state === ZState.LUNGE ||
      this.state === ZState.SIEGE ||
      this.state === ZState.CLIMB;
    if (this.awareness >= 1.0 && !overridden) {
      this._enterChase(ctx);
    } else if (
      this.awareness >= 0.45 &&
      (this.state === ZState.IDLE || this.state === ZState.WANDER)
    ) {
      this._enterInvestigate();
    }

    // Something died near here recently and they have noticed.
    if (
      (this.state === ZState.WANDER || this.state === ZState.IDLE) &&
      Math.random() < dt * 1.6
    ) {
      this._checkCorpses(ctx);
    }

    switch (this.state) {
      case ZState.IDLE: {
        this.stateTimer -= dt;
        this.vel.x *= 0.9;
        this.vel.z *= 0.9;
        if (this.stateTimer <= 0) {
          this.state = ZState.WANDER;
          this.wanderTimer = 4 + Math.random() * 7;
          this._pickWander();
        }
        break;
      }

      case ZState.WANDER: {
        this.wanderTimer -= dt;
        if (!this.wanderTarget || this.wanderTimer <= 0) {
          if (Math.random() < 0.4) {
            this.state = ZState.IDLE;
            this.stateTimer = 2 + Math.random() * 6;
            this.wanderTarget = null;
            break;
          }
          this._pickWander();
          this.wanderTimer = 5 + Math.random() * 8;
        }
        const wt = this.wanderTarget;
        if (wt) {
          const d = Math.hypot(wt.x - this.pos.x, wt.z - this.pos.z);
          if (d < 1.0) {
            this.state = ZState.IDLE;
            this.stateTimer = 2 + Math.random() * 5;
            this.wanderTarget = null;
          } else {
            this._steer(dt, wt.x, wt.z, this._spd(A.walk, nightMul), ctx);
          }
        }
        break;
      }

      case ZState.INVESTIGATE: {
        this.stateTimer -= dt;
        const lk = this.lastKnown;
        if (!lk || this.stateTimer <= 0) {
          this.state = ZState.SEARCH;
          this.searchTimer = CFG.zombie.searchTime;
          break;
        }
        const d = Math.hypot(lk.x - this.pos.x, lk.z - this.pos.z);
        if (d < 1.4) {
          this.state = ZState.SEARCH;
          this.searchTimer = CFG.zombie.searchTime;
          this.path = null;
        } else {
          this._steer(dt, lk.x, lk.z, this._spd(A.walk * 1.55, nightMul), ctx);
        }
        break;
      }

      case ZState.CHASE: {
        const p = ctx.player;
        const target =
          p.hidden || !(sees || this.awareness > 0.9)
            ? this.lastKnown
            : { x: p.pos.x, z: p.pos.z };
        if (!target) {
          this.state = ZState.SEARCH;
          this.searchTimer = CFG.zombie.searchTime;
          break;
        }
        const d = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);

        /**
         * Screamer: the moment it is sure, it stops caring about you and
         * starts telling everyone else. It never closes to melee — backing off
         * while it winds up is what makes it a shot you have to take rather
         * than a thing you can simply walk into.
         */
        if (this.special === 'screamer') {
          const S = CFG.specials.screamer;
          if (this.screamCooldown <= 0 && this.awareness >= S.minAwareness && sees) {
            this._enterScream(ctx);
            break;
          }
          if (d < S.keepDistance) {
            const bx = this.pos.x - (target.x - this.pos.x);
            const bz = this.pos.z - (target.z - this.pos.z);
            this._steer(dt, bx, bz, this._spd(A.chase, nightMul), ctx);
            // Keep facing what it is backing away from.
            this.yaw = moveAngleTowards(
              this.yaw, Math.atan2(target.x - this.pos.x, target.z - this.pos.z), A.turn * dt
            );
            break;
          }
        }

        /**
         * Runner: the lunge opens at three metres, which is outside its own
         * reach — it is closing the gap with its whole body, and if you are
         * not there when it lands it has nothing left for a second.
         */
        if (this.special === 'runner' && this.lungeCooldown <= 0 && !p.hidden && p.state !== 'dead') {
          const R = CFG.specials.runner;
          if (d <= R.lungeRange && d > this.attackReach * 0.75 && sees) {
            this._enterLunge(ctx, target.x, target.z);
            break;
          }
        }

        // A hidden player is not a target: getting them out is a drag, not a
        // swing — see Game._updateHiding.
        if (d <= this.attackReach && this.attackCooldown <= 0 && p.state !== 'dead' && !p.hidden) {
          const clear = !this.world.collision.lineBlocked(
            this.pos.x,
            this.pos.z,
            p.pos.x,
            p.pos.z,
            this.crawling ? 0.5 : 1.1,
            this.scratch
          );
          // Only a couple of them can commit at once; the rest crowd and wait.
          if (clear && (!ctx.requestAttack || ctx.requestAttack(this))) {
            this.state = ZState.ATTACK;
            this.attackTimer = 0;
            this.hasSwung = false;
            // The lunge is warped so its contact frame lands on A.windup.
            this.anim.attack('light', A.windup, A.windup + A.recover);
            this.audio.groanAt(this.pos, { gain: 0.2, dur: 0.35, pitch: 1.25 });
            break;
          }
        }

        // Lost them for long enough → start hunting instead of tracking.
        if (!sees && (this.lastSeenTime || 0) > CFG.zombie.loseSightGrace && this.awareness < 1.0) {
          this.state = ZState.SEARCH;
          this.searchTimer = CFG.zombie.searchTime;
          this.path = null;
          break;
        }

        /**
         * Something is in the way. Take the nearest hole in it: climb a
         * smashed window if one is to hand, otherwise start on whatever is
         * shut. If the way in is further off, walk to it first — this is what
         * turns "the player sealed themselves in" into a siege rather than a
         * crowd of bodies grinding on a wall.
         */
        const climb = this._findClimbTarget(target.x, target.z);
        if (climb) {
          this._enterClimb(climb);
          break;
        }
        const siege = this._findSiegeTarget(target.x, target.z);
        if (siege) {
          this._enterSiege(siege, ctx);
          break;
        }
        const way = this._findWayIn(target.x, target.z);
        if (way) {
          const stand = this._queuePoint(way, 0.9);
          this._steer(dt, stand.x, stand.z, this._spd(A.chase, nightMul), ctx);
          break;
        }

        this._steer(dt, target.x, target.z, this._spd(A.chase, nightMul), ctx);
        break;
      }

      case ZState.SIEGE: {
        const op = this.siegeTarget;
        const p = ctx.player;
        if (!op || op.passable || op.state === 'broken') {
          this.siegeTarget = null;
          this.state = ZState.CHASE;
          this.path = null;
          break;
        }
        /**
         * Hold the queue slot the horde gave us. Without this every besieger
         * converges on the exact centre of the doorway and you get a single
         * writhing mass in a 1 m gap; with it they fan out along the wall and
         * the two at the front are visibly the ones doing the work.
         */
        const slot = this._queuePoint(op, 0.75);
        if (Math.hypot(slot.x - this.pos.x, slot.z - this.pos.z) > 0.55) {
          this._steer(dt, slot.x, slot.z, this._spd(A.walk * 1.2, 1), ctx);
        } else {
          this.vel.x *= 0.8;
          this.vel.z *= 0.8;
        }
        const tYaw = Math.atan2(op.x - this.pos.x, op.z - this.pos.z);
        this.yaw = moveAngleTowards(this.yaw, tYaw, A.turn * dt);

        // Damage is applied by the horde so crowding can be counted once.
        this.siegeBangTimer -= dt;
        if (this.siegeBangTimer <= 0) {
          this.siegeBangTimer = 0.5 + Math.random() * 0.45;
          this.audio.doorBang(op.x, op.z, this.type === 'bloated');
          ctx.noise.emit(op.x, op.z, CFG.openings.bangNoise, 'zombie', 'alert');
          this.anim.attack('light', A.windup, A.windup + A.recover * 0.6);
        }

        // Give up if we forget why we are here.
        if (this.awareness < 0.35 && !this.memoryOpening) {
          this.siegeTarget = null;
          this.state = ZState.SEARCH;
          this.searchTimer = CFG.zombie.searchTime;
        } else if (this.distToPlayer < this.attackReach && !this.world.collision.lineBlocked(
          this.pos.x, this.pos.z, p.pos.x, p.pos.z, this.crawling ? 0.5 : 1.1, this.scratch
        )) {
          this.siegeTarget = null;
          this.state = ZState.CHASE;
        }
        break;
      }

      case ZState.CLIMB: {
        this.climbTimer += dt;
        const k = clamp01(this.climbTimer / CFG.openings.climbTime);
        const e = k * k * (3 - 2 * k);
        this.pos.x = this.climbFrom.x + (this.climbTo.x - this.climbFrom.x) * e;
        this.pos.z = this.climbFrom.z + (this.climbTo.z - this.climbFrom.z) * e;
        this.vel.set(0, 0, 0);
        const op = this.climbTarget;
        if (op) this.yaw = moveAngleTowards(this.yaw, Math.atan2(op.nx, op.nz) + (op.isOutside(this.climbTo.x, this.climbTo.z) ? 0 : Math.PI), A.turn * dt);
        if (this.climbTimer >= CFG.openings.climbTime) {
          this.state = ZState.CHASE;
          this.climbTarget = null;
          this.path = null;
        }
        break;
      }

      case ZState.ATTACK: {
        this.attackTimer += dt;
        this.vel.x *= 0.82;
        this.vel.z *= 0.82;
        const p = ctx.player;
        // keep facing the player through the windup — you can still dodge out
        const tYaw = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
        this.yaw = moveAngleTowards(this.yaw, tYaw, A.turn * 0.7 * dt);

        if (!this.hasSwung && this.attackTimer >= A.windup) {
          this.hasSwung = true;
          const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
          const facing = Math.cos(angleDelta(this.yaw, tYaw));
          if (d <= this.attackReach + 0.42 && facing > 0.4 && p.state !== 'dead') {
            const dmgMul =
              (ctx.night ? CFG.zombie.nightAggroMul : 1) *
              (this.crawling ? CFG.combat.crawlDamageMul : 1);
            p.takeHit(A.damage * dmgMul, this.pos.x, this.pos.z, {
              cause: this.crawling
                ? 'something on the floor'
                : this.special === 'brute'
                  ? 'something that walked through the door'
                  : this.type === 'bloated'
                    ? 'something far too heavy'
                    : 'the dead',
              bleedChance: this.type === 'bloated' ? 0.5 : this.crawling ? 0.42 : 0.28,
              lowBlow: this.crawling,
              /**
               * A brute's swipe goes straight through a raised guard. Blocking
               * is the wrong answer to it and the game has to say so in the
               * only language combat has, which is damage.
               */
              unblockable: !!(this.special === 'brute' && CFG.specials.brute.blockBreak),
            });
            ctx.onPlayerHit?.(this);
            this.audio.impact('hit_soft', this.pos.x, this.pos.z);
          } else {
            this.audio.swing('whoosh_light');
            ctx.onMiss?.(this);
          }
          ctx.noise.emit(this.pos.x, this.pos.z, 8, 'zombie', 'attack');
        }

        if (this.attackTimer >= A.windup + A.recover) {
          this.state = ZState.CHASE;
          this.attackCooldown = 0.55 + Math.random() * 0.7;
          ctx.releaseAttack?.(this);
        }
        break;
      }

      case ZState.SEARCH: {
        this.searchTimer -= dt;
        this.vel.x *= 0.95;
        this.vel.z *= 0.95;
        /**
         * Sweep along the way they were going, not in a circle around where
         * they were.
         *
         * Random casting means losing them is final and the search is theatre.
         * Biasing the cone hard down the last-seen heading means running in a
         * straight line gets you followed and *cutting sideways* is what
         * breaks the trail — which turns a lost contact into a decision.
         */
        if (!this.wanderTarget || Math.random() < dt * 0.5) {
          const lk = this.lastKnown || { x: this.pos.x, z: this.pos.z };
          const dir = this.lastSeenDir;
          const r = 2 + Math.random() * 7;
          let a;
          if (dir) {
            // ±50° around the heading, widening as the search wears on.
            const base = Math.atan2(dir.x, dir.z);
            const spread = 0.9 + (1 - clamp01(this.searchTimer / CFG.zombie.searchTime)) * 1.4;
            a = base + (Math.random() * 2 - 1) * spread;
            this.wanderTarget = {
              x: lk.x + Math.sin(a) * r,
              z: lk.z + Math.cos(a) * r,
            };
          } else {
            a = Math.random() * Math.PI * 2;
            this.wanderTarget = { x: lk.x + Math.cos(a) * r, z: lk.z + Math.sin(a) * r };
          }
        }
        this._steer(dt, this.wanderTarget.x, this.wanderTarget.z, this._spd(A.walk * 1.15, nightMul), ctx);
        if (this.searchTimer <= 0) {
          this.state = ZState.WANDER;
          this.alerted = false;
          this.lastKnown = null;
          this.wanderTarget = null;
          this.wanderTimer = 3 + Math.random() * 5;
        }
        break;
      }

      case ZState.STAGGER: {
        this.staggerTimer -= dt;
        this.vel.x *= 0.9;
        this.vel.z *= 0.9;
        if (this.staggerTimer <= 0) {
          this.state = this.lastKnown ? ZState.CHASE : ZState.WANDER;
        }
        break;
      }

      /**
       * On the floor. It cannot do anything from here, which is exactly why
       * standing over it for a full second is a real decision when there are
       * two more of them behind you.
       */
      case ZState.DOWN: {
        this.downTimer -= dt;
        this.vel.x *= 0.86;
        this.vel.z *= 0.86;
        if (this.downTimer <= 0) {
          this.rig.setDown(false);
          this.state = this.lastKnown ? ZState.CHASE : ZState.WANDER;
          this.attackCooldown = Math.max(this.attackCooldown, 0.5);
        }
        break;
      }

      /**
       * Two seconds of nothing, and then the street knows where you are.
       * Everything about this state is the countdown: it does not move, it
       * does not defend itself, and the pose and the sound both ramp.
       */
      case ZState.SCREAM: {
        const S = CFG.specials.screamer;
        this.screamTimer += dt;
        this.vel.x *= 0.82;
        this.vel.z *= 0.82;
        const p2 = ctx.player;
        this.yaw = moveAngleTowards(
          this.yaw, Math.atan2(p2.pos.x - this.pos.x, p2.pos.z - this.pos.z), A.turn * 0.5 * dt
        );
        if (this.screamTimer >= S.telegraph) this._releaseScream(ctx);
        break;
      }

      /**
       * In the air. A fixed heading, no steering, and one chance to connect
       * on the way through — then a full second on the floor.
       */
      case ZState.LUNGE: {
        const R = CFG.specials.runner;
        this.lungeTimer += dt;
        const p3 = ctx.player;

        if (this.lungeTimer < R.lungeTime) {
          this.vel.x = this.lungeDir.x * R.lungeSpeed;
          this.vel.z = this.lungeDir.z * R.lungeSpeed;
          if (!this.lungeHit && p3.state !== 'dead' && !p3.hidden) {
            const d = Math.hypot(p3.pos.x - this.pos.x, p3.pos.z - this.pos.z);
            if (d <= this.attackReach + 0.35) {
              this.lungeHit = true;
              p3.takeHit(A.damage * (ctx.night ? CFG.zombie.nightAggroMul : 1), this.pos.x, this.pos.z, {
                cause: 'something much faster than you',
                bleedChance: 0.4,
                knockMul: 1.45,
              });
              ctx.onPlayerHit?.(this);
              this.audio.impact('hit_soft', this.pos.x, this.pos.z);
            }
          }
        } else {
          // Spent. This window is the whole reason the runner is survivable.
          this.vel.x *= 0.72;
          this.vel.z *= 0.72;
        }

        if (this.lungeTimer >= R.lungeTime + R.lungeRecover) {
          this.lungeCooldown = R.lungeCooldown;
          this.state = ZState.CHASE;
        }
        break;
      }

      /**
       * Standing over something dead. Not useful to them and not dangerous to
       * you — it is a tell. A group clustered around a body is a group that
       * has found where you were fighting, and it is readable from a street
       * away.
       */
      case ZState.LINGER: {
        this.lingerTimer -= dt;
        this.vel.x *= 0.88;
        this.vel.z *= 0.88;
        if (this.lingerAt) {
          this.yaw = moveAngleTowards(
            this.yaw,
            Math.atan2(this.lingerAt.x - this.pos.x, this.lingerAt.z - this.pos.z),
            A.turn * 0.7 * dt
          );
        }
        if (this.lingerTimer <= 0 || this.awareness > 0.45) {
          this.lingerAt = null;
          this.state = ZState.WANDER;
          this.wanderTimer = 2 + Math.random() * 4;
        }
        break;
      }

      /**
       * Burning. It runs from the flames rather than at you — briefly, badly,
       * and straight through anything else that was coming your way.
       */
      case ZState.FLEE: {
        this.fleeTimer -= dt;
        const from = this.fleeFrom || { x: this.pos.x, z: this.pos.z + 1 };
        let ax = this.pos.x - from.x;
        let az = this.pos.z - from.z;
        const al = Math.hypot(ax, az) || 1;
        ax /= al;
        az /= al;
        this._steer(
          dt,
          this.pos.x + ax * 6,
          this.pos.z + az * 6,
          this._spd(A.chase * CFG.fire.fleeSpeedMul, nightMul),
          ctx
        );
        if (this.fleeTimer <= 0) {
          this.fleeFrom = null;
          this.state = ZState.SEARCH;
          this.searchTimer = CFG.zombie.searchTime;
        }
        break;
      }
    }

    this._updateWounds(dt);

    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.screamCooldown > 0) this.screamCooldown -= dt;
    if (this.lungeCooldown > 0) this.lungeCooldown -= dt;
    this._updateBurst(dt);
    this._specialFootsteps(dt, Math.hypot(this.vel.x, this.vel.z));
    if (this.memoryTimer > 0) {
      this.memoryTimer -= dt;
      if (this.memoryTimer <= 0) this.memoryOpening = null;
    }

    // The climb lerp owns the body outright; resolving collisions mid-sill
    // would shove it straight back out of the window.
    if (this.state !== ZState.CLIMB) this._applyMotion(dt);

    // Idle vocalisations — this is most of the game's dread budget.
    this.groanTimer -= dt;
    if (this.groanTimer <= 0) {
      const chasing = this.state === ZState.CHASE || this.state === ZState.ATTACK;
      this.groanTimer = chasing ? 1.2 + Math.random() * 1.6 : 5 + Math.random() * 11;
      if (Math.random() < (chasing ? 0.9 : this.archetype.groanChance)) {
        this.audio.groanAt(this.pos, {
          gain: chasing ? 0.2 : 0.13,
          pitch: chasing ? 1.15 : 0.95,
          dur: chasing ? 0.45 : 0.8,
        });
      }
    }

    // Zombies make noise too — a chasing horde is audible to other zombies.
    if (this.state === ZState.CHASE && Math.random() < dt * 1.6) {
      ctx.noise.emit(this.pos.x, this.pos.z, 11, 'zombie', 'alert');
    }

    this.rig.place(this.pos.x, this.pos.y, this.pos.z, this.yaw);
    this._animate(dt, ctx);
  }

  /**
   * Bleeding out and burning down. Both are damage with no author — neither
   * tells it where you went, which is what makes hit-and-back-off a real plan
   * with a machete and a molotov.
   */
  _updateWounds(dt) {
    if (this.bleedStacks > 0) {
      this.bleedTimer -= dt;
      if (this.bleedTimer <= 0) {
        this.bleedStacks = 0;
      } else {
        this.attrition(CFG.combat.bleedDps * this.bleedStacks * dt);
        if (Math.random() < dt * 3.2) {
          this.particles.blood(this.pos.x, this.pos.y + this.chestY * 0.7, this.pos.z, 0, 0, 2, 0.35);
        }
      }
    }
    if (this.burnTimer > 0) this.burnTimer -= dt;

    // The eyes come up through an attack windup and drop back afterwards —
    // fast enough to be a warning, slow enough not to strobe.
    const winding = this.state === ZState.ATTACK && !this.hasSwung;
    const want = winding ? clamp01(this.attackTimer / Math.max(0.05, this.archetype.windup)) : 0;
    this.eyeGlow += clamp(want - this.eyeGlow, -dt * 4.5, dt * 9);
  }

  /**
   * Where to amble next.
   *
   * A zombie with a leader drifts around *the leader* rather than around its
   * own spawn point, which is the whole of the group-movement change: a pack
   * stays a pack as it moves, so from a distance you can see a clump of four
   * heading up the road and decide to be somewhere else. Loners are unchanged.
   */
  _pickWander() {
    const lead = this.leader && !this.leader.isDead && this.leader !== this ? this.leader : null;
    const ax = lead ? lead.pos.x : this.home.x;
    const az = lead ? lead.pos.z : this.home.y;
    const radius = lead ? 4.5 : CFG.zombie.wanderRadius;

    // The migration overrides everything: they are going somewhere.
    if (this.migrateTo) {
      this.wanderTarget = { x: this.migrateTo.x, z: this.migrateTo.z };
      return;
    }

    const a = Math.random() * Math.PI * 2;
    const r = (lead ? 1.5 : 3) + Math.random() * radius;
    const tx = ax + Math.cos(a) * r;
    const tz = az + Math.sin(a) * r;
    if (this.world.nav.isBlockedWorld(tx, tz)) {
      this.wanderTarget = { x: ax, z: az };
    } else {
      this.wanderTarget = { x: tx, z: tz };
    }
  }

  /**
   * Map the AI state onto an animation state and let the controller do the
   * rest. Nothing in here decides timing — the FSM above owns that, and the
   * clips are warped to fit it.
   */
  _animate(dt, ctx) {
    const anim = this.anim;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const distance = this.distToPlayer;

    if (this.state === ZState.DEAD) {
      this.rig.updateDeath(this.deathTimer);
      anim.update(dt, { speed: 0, distance });
      return;
    }

    // The eyes are the only thing on a zombie you can read at twenty metres in
    // the dark, so the attack windup is spent lighting them.
    this.rig.setEyeGlow(this.eyeGlow, ctx.night);

    /**
     * The scream pose ramps with its own telegraph, so the silhouette *is* the
     * timer: head coming back means you have about a second left, head all the
     * way back means you are too late.
     */
    if (this.special === 'screamer') {
      anim.setScream(
        this.state === ZState.SCREAM
          ? clamp01(this.screamTimer / Math.max(0.05, CFG.specials.screamer.telegraph * 0.7))
          : 0
      );
    }

    if (this.state === ZState.SCREAM) {
      anim.request('idle');
    } else if (this.state === ZState.LUNGE) {
      // Airborne on the way out, folded up on the way down.
      anim.request(this.lungeTimer < CFG.specials.runner.lungeTime ? 'chase' : 'stagger');
    } else if (this.state === ZState.LINGER) {
      anim.request('idle');
    } else if (this.state === ZState.DOWN) {
      // Nothing plays here: the rig is holding a prone pose set by setDown.
      anim.request('idle');
      this.rig.updateDown(dt, this.downTimer);
    } else if (this.state === ZState.STAGGER) {
      anim.request('stagger');
    } else if (this.state === ZState.ATTACK) {
      // The lunge is a one-shot laid over a still base.
      anim.request('idle');
    } else if (speed > CFG.anim.moveThreshold) {
      const gait = this.archetype.gait === 'lurch' ? 'lurch' : 'shamble';
      // A crawler has one gait: the fastest one, played slowly, with the whole
      // body flat. Limbs paddling at the road is exactly what it should read as.
      if (this.crawling) anim.request('chase');
      else if (this.state === ZState.CHASE || this.state === ZState.FLEE) anim.request('chase');
      else anim.request(speed > this.archetype.walk * 1.45 ? 'lurch' : gait);
    } else {
      anim.request('idle');
    }

    anim.update(dt, { speed: this.crawling ? speed * 1.6 : speed, distance });
  }
}
