/**
 * Horde.js — owns every zombie, plus the light-touch director that decides
 * when the street should get more crowded.
 *
 * Group behaviour lives here rather than on the individual: a zombie that
 * spots you screams, and the horde manager is what turns that scream into
 * three more silhouettes coming round the corner.
 */

import * as THREE from 'three';
import CFG from '../core/Config.js';
import { Zombie, ZState, ARCHETYPES, SPECIALS } from './Zombie.js';
import { makeRng } from '../core/Utils.js';

const CELL = 6;

/**
 * The director's three moods.
 *
 * BUILD is the game as it always was: ambient spawns toward a population
 * target, specials permitted. PEAK is a crescendo you earned by being loud.
 * RELAX is the one that matters — a hard guarantee that nothing new arrives
 * for a while, because a horde that never lets up stops being a horde and
 * becomes weather.
 */
export const Phase = { BUILD: 'build', PEAK: 'peak', RELAX: 'relax' };

export class Horde {
  constructor(scene, world, audio, particles, noise) {
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.particles = particles;
    this.noise = noise;

    this.zombies = [];
    this.corpses = [];
    this.maxCorpses = 16;
    this.rng = makeRng(90210);

    this.grid = new Map();
    this._neighbourBuf = [];

    this.killCount = 0;
    this.directorTimer = 8;
    this.pressure = 0;        // rises with noise, drives extra spawns
    this.lastGunshot = -99;
    this._t = 0;

    // ── director ──
    this.phase = Phase.BUILD;
    this.phaseTime = 0;
    this.spawnTimer = 8;
    this.waveLeft = 0;
    this.waveTimer = 0;
    this.relaxAudioTimer = 0;
    /** Ring buffer of recent director events, for the debug overlay. */
    this.events = [];

    // ── migration ──
    this.migration = { state: 'idle', t: 0, from: null, to: null, night: -1, members: [] };
    this._leaderTimer = 0;
    this._siegeQueues = new Map();

    /**
     * The metagame's two directed events.
     *
     * `hunt` is the anti-AFK guarantee: from night two, parties form at the
     * edge of the map already knowing where your shelter is, so a player who
     * boards the door and does nothing gets found anyway. `siegeEvent` is the
     * night-three novelty — the migration, but aimed, and it does not turn
     * aside.
     */
    this.hunt = { night: -1, left: 0, timer: 0, tele: 0, groan: 0 };
    this.siegeEvent = { state: 'idle', t: 0, night: -1, from: null, to: null, members: [], groan: 0 };
    this._disperseAcc = 0;
    this._dispersing = false;

    /**
     * Attack tokens. Without this, six zombies around you all wind up at once
     * and there is no play — just a damage number. Two at a time keeps a group
     * genuinely lethal while leaving room to block, back off or swing.
     */
    this.maxSimultaneousAttackers = 2;
    this._attackers = new Set();
  }

  requestAttackToken(z) {
    if (this._attackers.has(z)) return true;
    // Prune anything that stopped attacking.
    for (const a of this._attackers) {
      if (a.isDead || a.state !== 'attack') this._attackers.delete(a);
    }
    if (this._attackers.size >= this.maxSimultaneousAttackers) return false;
    this._attackers.add(z);
    return true;
  }

  releaseAttackToken(z) {
    this._attackers.delete(z);
  }

  reset() {
    for (const z of this.zombies) z.dispose();
    for (const z of this.corpses) z.dispose();
    this.zombies.length = 0;
    this.corpses.length = 0;
    this._attackers.clear();
    this.killCount = 0;
    this.pressure = 0;
    this._t = 0;
    this.phase = Phase.BUILD;
    this.phaseTime = 0;
    this.spawnTimer = 8;
    this.waveLeft = 0;
    this.events.length = 0;
    this.migration = { state: 'idle', t: 0, from: null, to: null, night: -1, members: [] };
    this.hunt = { night: -1, left: 0, timer: 0, tele: 0, groan: 0 };
    this.siegeEvent = { state: 'idle', t: 0, night: -1, from: null, to: null, members: [], groan: 0 };
    this._disperseAcc = 0;
    this._dispersing = false;
    this._siegeQueues.clear();
  }

  spawnFromWorld() {
    for (const s of this.world.zombieSpawns) {
      for (let i = 0; i < s.count; i++) {
        const a = this.rng.range(0, Math.PI * 2);
        const r = this.rng.range(0, 2.6);
        this.spawn(s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, s.type, s.group);
      }
    }
  }

  spawn(x, z, type = 'shambler', group = 'loner') {
    if (this.zombies.length >= CFG.zombie.maxActive) return null;
    // Don't spawn inside geometry.
    const free = this.world.nav.nearestFree(x, z, 6);
    if (free) {
      x = this.world.nav.toWorldX(free.ix);
      z = this.world.nav.toWorldZ(free.iz);
    }
    const zom = new Zombie(this.scene, this.world, this.audio, this.particles, { x, z, type, group });
    this.zombies.push(zom);
    return zom;
  }

  /**
   * Spawn a few out of sight, at the edge of the player's world.
   *
   * `ctx` carries the time of day and the director's phase into `_pickType`,
   * which is where every special's gating lives. Called without it — as the
   * tests and the old call sites do — nothing special can appear.
   */
  spawnAmbient(playerPos, count = 1, minDist = 34, maxDist = 56, ctx = null) {
    let spawned = 0;
    for (let attempt = 0; attempt < count * 8 && spawned < count; attempt++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(minDist, maxDist);
      const x = playerPos.x + Math.cos(a) * d;
      const z = playerPos.z + Math.sin(a) * d;
      if (Math.abs(x) > 60 || Math.abs(z) > 60) continue;
      if (this.world.nav.isBlockedWorld(x, z)) continue;
      if (this.world.isInSafehouse(x, z)) continue;
      const type = ctx
        ? this._pickType(ctx)
        : this.rng.weighted([
            { w: 62, id: 'shambler' },
            { w: 26, id: 'stalker' },
            { w: 12, id: 'bloated' },
          ]).id;
      const zom = this.spawn(x, z, type, 'drifter');
      if (zom) spawned++;
    }
    return spawned;
  }

  // ────────────────────────────────────────────────────── spatial query ──

  _rebuildGrid() {
    this.grid.clear();
    for (const z of this.zombies) {
      if (z.isDead) continue;
      const cx = Math.floor(z.pos.x / CELL);
      const cz = Math.floor(z.pos.z / CELL);
      const k = cx * 73856093 ^ cz * 19349663;
      let arr = this.grid.get(k);
      if (!arr) this.grid.set(k, (arr = []));
      arr.push(z);
    }
  }

  _neighbours(z, out) {
    out.length = 0;
    const cx = Math.floor(z.pos.x / CELL);
    const cz = Math.floor(z.pos.z / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const arr = this.grid.get((cx + dx) * 73856093 ^ (cz + dz) * 19349663);
        if (!arr) continue;
        for (const o of arr) out.push(o);
      }
    }
    return out;
  }

  /** Zombies within radius of a point (alive only). */
  query(x, z, radius, out = []) {
    out.length = 0;
    const r2 = radius * radius;
    for (const zo of this.zombies) {
      if (zo.isDead) continue;
      const dx = zo.pos.x - x,
        dz = zo.pos.z - z;
      if (dx * dx + dz * dz <= r2) out.push(zo);
    }
    return out;
  }

  // ───────────────────────────────────────────────────────── reactions ──

  /** One of them screamed: pull in its group and anything close. */
  onAlert(source) {
    const R = CFG.zombie.alertRadius;
    let woke = 0;
    for (const z of this.zombies) {
      if (z === source || z.isDead) continue;
      const d = Math.hypot(z.pos.x - source.pos.x, z.pos.z - source.pos.z);
      const sameGroup = z.group === source.group && z.group !== 'loner';
      const reach = sameGroup ? R * 1.6 : R;
      if (d > reach) continue;
      // Group-mates commit harder than strangers.
      z.lastKnown = source.lastKnown ? { ...source.lastKnown } : { x: source.pos.x, z: source.pos.z };
      z.awareness = Math.max(z.awareness, sameGroup ? 0.85 : 0.55);
      if (z.state === ZState.IDLE || z.state === ZState.WANDER || z.state === ZState.SEARCH) {
        z._enterInvestigate();
        woke++;
      }
    }
    this.pressure = Math.min(1, this.pressure + 0.12);
    return woke;
  }

  /** A gunshot: everything within earshot converges, and the map gets busier. */
  onGunshot(x, z) {
    this.lastGunshot = this._t;
    for (const zo of this.zombies) {
      if (zo.isDead) continue;
      const d = Math.hypot(zo.pos.x - x, zo.pos.z - z);
      if (d > CFG.noise.gunshot) continue;
      zo.lastKnown = { x, z };
      zo.awareness = Math.max(zo.awareness, d < 25 ? 1.05 : 0.8);
      if (zo.state !== ZState.CHASE && zo.state !== ZState.ATTACK) zo._enterInvestigate();
    }
    this.pressure = Math.min(1.4, this.pressure + 0.55);
  }

  onKill(z) {
    this.killCount++;
    this.corpses.push(z);
    const i = this.zombies.indexOf(z);
    if (i >= 0) this.zombies.splice(i, 1);
    while (this.corpses.length > this.maxCorpses) {
      const old = this.corpses.shift();
      old.dispose();
    }
  }

  // ──────────────────────────────────────────────────────────── metrics ──

  /** 0..1 — how much trouble the player is currently in. Drives audio + UI. */
  threat(playerPos) {
    let t = 0;
    let closest = Infinity;
    for (const z of this.zombies) {
      if (z.isDead) continue;
      const d = Math.hypot(z.pos.x - playerPos.x, z.pos.z - playerPos.z);
      if (d < closest) closest = d;
      const chasing = z.state === ZState.CHASE || z.state === ZState.ATTACK;
      if (chasing && d < 30) t += (1 - d / 30) * 0.42;
      else if (z.state === ZState.INVESTIGATE && d < 20) t += (1 - d / 20) * 0.12;
    }
    return { level: Math.min(1, t), closest };
  }

  /**
   * The highest awareness any one zombie has of the player. Not the sum and
   * not the average: what decides whether you get away is the single most
   * attentive thing on the street.
   */
  peakAwareness() {
    let m = 0;
    for (const z of this.zombies) {
      if (z.isDead) continue;
      if (z.awareness > m) m = z.awareness;
    }
    return Math.min(1, m);
  }

  countChasing() {
    let n = 0;
    for (const z of this.zombies) {
      if (!z.isDead && (z.state === ZState.CHASE || z.state === ZState.ATTACK)) n++;
    }
    return n;
  }

  // ───────────────────────────────────────────────────────────── update ──

  update(dt, ctx) {
    this._t += dt;
    this._rebuildGrid();

    this._assignLeaders(dt);
    this._assignSiegeSlots();

    const ctx2 = {
      ...ctx,
      nav: this.world.nav,
      noise: this.noise,
      neighbours: null,
      onAlert: (z) => this.onAlert(z),
      onScream: (z) => this.onScream(z),
      freshCorpse: (x, z, r) => this.freshCorpseNear(x, z, r),
      requestAttack: (z) => this.requestAttackToken(z),
      releaseAttack: (z) => this.releaseAttackToken(z),
    };

    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      ctx2.neighbours = this._neighbours(z, this._neighbourBuf);
      z.update(dt, ctx2);
      if (z.isDead) this.onKill(z);
    }

    for (const c of this.corpses) {
      if (c.deathTimer < 2) c.update(dt, ctx2);
    }

    this._separateFromPlayer(dt, ctx.player);
    this._updateSieges(dt, ctx);

    /**
     * The director runs on *game* time, not on wall time.
     *
     * Bodies move at the speed bodies move at, whatever the clock is doing —
     * but how many of them there are, when the street crests, and when a
     * hunting party sets off are all functions of how much of the night has
     * gone. Without this, sleeping through a night at nine times speed would
     * get you a ninth of the horde and none of the hunts, and "board the door
     * and go to bed" would be the answer to the entire game.
     */
    const scale = ctx.simScale || 1;
    const ddt = dt * scale;
    this._quiet = scale > 2;              // no ambient audio while fast-forwarding

    this._director(ddt, ctx);

    /**
     * Dawn stops the directed events too, and it has to be said here rather
     * than left to the `night` flag.
     *
     * `night` is a light level, and the light level does not cross its
     * threshold until about 06:45 — so for the first three quarters of an
     * hour of a grace window that promises "nothing new arrives", a hunting
     * party or a siege column could still form up and set off. The grace
     * phase is the promise; the sun coming up is just weather.
     */
    if (ctx.grace) return;

    this._updateMigration(ddt, ctx);
    this._updateHunt(ddt, ctx);
    this._updateSiegeEvent(ddt, ctx);
  }

  /** The night's escalation row, or a flat one when nobody supplied it. */
  _curve(ctx) {
    return ctx.curve || { pop: 1, speed: 1, specials: 1, waveBonus: 0, hunt: 0, event: null };
  }

  /**
   * Keep zombies out of the player's body. Without this they walk into you and
   * the fight loses all sense of distance — you can't read whether you're in
   * their reach or not.
   *
   * The player is the heavier body: they get pushed 25%, the zombie 75%, so
   * you can shoulder through one but not through three.
   */
  _separateFromPlayer(dt, player) {
    if (!player || player.state === 'dead') return;
    const pr = 0.38;
    for (const z of this.zombies) {
      if (z.isDead) continue;
      // You can stand over something that is already on the floor. Without
      // this the finisher is unreachable: the body pushes you out of range of
      // the prompt that is telling you to stomp it.
      if (z.downed) continue;
      let dx = z.pos.x - player.pos.x;
      let dz = z.pos.z - player.pos.z;
      let d2 = dx * dx + dz * dz;
      const minD = pr + z.radius;
      if (d2 >= minD * minD) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-4) {
        // Exactly co-located: shove along the zombie's facing.
        dx = Math.sin(z.yaw);
        dz = Math.cos(z.yaw);
        d = 1;
      } else {
        dx /= d;
        dz /= d;
      }
      const overlap = minD - d;
      z.pos.x += dx * overlap * 0.75;
      z.pos.z += dz * overlap * 0.75;

      const px = player.pos.x - dx * overlap * 0.25;
      const pz = player.pos.z - dz * overlap * 0.25;
      const res = this.world.collision.resolveCircle(px, pz, pr, player.pos.y, 1.7, 0.45, this._neighbourBuf2 || (this._neighbourBuf2 = []));
      player.pos.x = res.x;
      player.pos.z = res.z;
    }
  }

  /**
   * Everything currently taking a door apart.
   *
   * Damage is pooled here rather than applied per zombie so crowding can be
   * counted once: `n` of them do `n^siegeCrowdExp` times what one does, not
   * `n` times. That sub-linear stack is what lets a single door hold for ~25 s
   * against one and ~9 s against three — the two numbers the design wants —
   * instead of the 25/8.3 that a straight sum forces on you.
   */
  _updateSieges(dt, ctx) {
    const byOpening = this._siegeBuckets || (this._siegeBuckets = new Map());
    byOpening.clear();

    for (const z of this.zombies) {
      if (z.isDead || z.state !== ZState.SIEGE || !z.siegeTarget) continue;
      let arr = byOpening.get(z.siegeTarget);
      if (!arr) byOpening.set(z.siegeTarget, (arr = []));
      arr.push(z);
    }

    let total = 0;
    for (const [op, list] of byOpening) {
      const n = list.length;
      total += n;
      let sum = 0;
      for (const z of list) {
        // Siege damage already scales with archetype damage; `siegeMul` is the
        // extra factor that makes a brute a demolition problem rather than a
        // strong shambler.
        const mul = z.special === 'brute' ? CFG.specials.brute.siegeMul : 1;
        sum += CFG.openings.doorDps * (z.archetype.damage / 14) * mul;
      }
      const perAttacker = sum / n;
      const effective = perAttacker * Math.pow(n, CFG.openings.siegeCrowdExp);
      op.attackers = n;

      const res = op.damage(effective * dt);
      if (res === 'boards') {
        this.audio.woodBreak(op.x, op.z);
        this.noise.emit(op.x, op.z, CFG.openings.breakNoise, 'zombie', 'alert');
        ctx.onBoardsBroken?.(op);
      } else if (res === 'broke') {
        this.audio.woodBreak(op.x, op.z);
        this.noise.emit(op.x, op.z, CFG.openings.breakNoise, 'zombie', 'alert');
        ctx.onOpeningBroken?.(op);
      }
    }
    this.barricadeAttackers = total;
  }

  /**
   * The player just went through a door or a window. Anything that already had
   * an inkling of where they were files it away and will head for that
   * opening — this is what stops "shut the door" from being a hard reset.
   */
  onOpeningUsed(op, player) {
    for (const z of this.zombies) {
      if (z.isDead) continue;
      if (z.awareness < 0.35) continue;
      const d = Math.hypot(z.pos.x - op.x, z.pos.z - op.z);
      if (d > CFG.zombie.alertRadius) continue;
      z.rememberOpening(op);
      z.lastKnown = { x: op.x, z: op.z };
    }
  }

  /**
   * The player climbed into a hiding place. Anything that had eyes on them
   * knows roughly where they went and will come and look; everything else
   * loses the thread entirely.
   *
   * @returns the number of zombies that saw it happen.
   */
  onPlayerHide(spot, player, fromX, fromZ) {
    /**
     * Sight is tested against where the player was *standing*, not where they
     * are now — they are now inside a wardrobe, and the wardrobe is solid, so
     * a line to them is blocked by definition and nobody would ever see
     * anything.
     */
    const sx = fromX ?? spot.exitX ?? spot.x;
    const sz = fromZ ?? spot.exitZ ?? spot.z;
    let watchers = 0;
    for (const z of this.zombies) {
      if (z.isDead) continue;
      const saw =
        z.awareness >= CFG.stealth.hideSeenAwareness &&
        !this.world.collision.lineBlocked(z.pos.x, z.pos.z, sx, sz, 1.3, z.scratch);
      if (saw) {
        z.knownHide = spot;
        z.lastKnown = { x: spot.approachX ?? spot.x, z: spot.approachZ ?? spot.z };
        z.awareness = 1.2;
        watchers++;
      } else {
        z.knownHide = null;
        // They heard something over there, but the trail stops.
        z.awareness = Math.min(z.awareness, 0.5);
      }
    }
    return watchers;
  }

  /** Nobody is looking for you in there any more. */
  clearHideWatchers() {
    for (const z of this.zombies) z.knownHide = null;
  }

  /**
   * Zombies that watched you hide and have got to the spot. Measured against
   * the approach square rather than the furniture itself — nothing can stand
   * inside a wardrobe, so measuring to its centre would never trigger.
   */
  hideSearchersAt(spot, radius = 1.9) {
    const ax = spot.approachX ?? spot.x;
    const az = spot.approachZ ?? spot.z;
    let n = 0;
    for (const z of this.zombies) {
      if (z.isDead || z.knownHide !== spot) continue;
      if (Math.hypot(z.pos.x - ax, z.pos.z - az) <= radius + z.radius) n++;
    }
    return n;
  }

  // ──────────────────────────────────────────────────────── director 2.0 ──

  /** Note something for the debug overlay and for the tests to assert on. */
  log(kind, detail = null) {
    this.events.push({ t: +this._t.toFixed(2), kind, detail, phase: this.phase });
    if (this.events.length > 60) this.events.shift();
  }

  _setPhase(next, ctx) {
    if (this.phase === next) return;
    this.phase = next;
    this.phaseTime = 0;
    if (next === Phase.PEAK) {
      const D = CFG.director;
      const base = ctx.night ? D.waveCountNight : D.waveCount;
      this.waveLeft = base + (ctx.night ? this._curve(ctx).waveBonus : 0);
      this.waveTimer = 0;
    }
    if (next === Phase.RELAX) {
      this.waveLeft = 0;
      this.relaxAudioTimer = 3;
    }
    this.log('phase', next);
  }

  /**
   * The pacing curve.
   *
   * Pressure is the only input: it rises with the noise you make and falls on
   * its own. Cross the threshold after the minimum build and the street
   * crests; either way it crests eventually, and either way it is followed by
   * a window where nothing new arrives at all. Night makes every part of this
   * harsher except that window, which only shortens — quiet is what makes loud
   * work, and deleting it would delete the loud along with it.
   */
  _director(dt, ctx) {
    const D = CFG.director;
    this.phaseTime += dt;

    const gain = (this.noise?.playerNoise || 0) * D.pressureFromNoise;
    const decay = this.phase === Phase.RELAX ? D.pressureDecayRelax : D.pressureDecay;
    this.pressure = Math.max(0, Math.min(1.8, this.pressure + (gain - decay) * dt));

    /**
     * Dawn.
     *
     * The director stops. Not "spawns fewer" — stops: no ambient, no
     * crescendo, no waves, and the pressure meter bleeds out at the RELAX
     * rate. Everything still standing is told to go home, and goes. Two
     * in-game hours of that is what turns five nights into five *days*, each
     * one of which starts from a street you can walk down.
     */
    if (ctx.grace) {
      this.pressure = Math.max(0, this.pressure - D.pressureDecayRelax * 2 * dt);
      if (this.phase !== Phase.RELAX) this._setPhase(Phase.RELAX, ctx);
      this.phaseTime = 0;                       // RELAX never expires in grace
      this._dawnDisperse(dt, ctx);
      return;
    }
    if (this._dispersing) this._endDisperse();

    switch (this.phase) {
      case Phase.BUILD: {
        this._ambient(dt, ctx);
        const ready = this.phaseTime >= D.buildMin;
        if ((ready && this.pressure >= D.peakPressure) || this.phaseTime >= D.buildMax) {
          this._setPhase(Phase.PEAK, ctx);
        }
        break;
      }
      case Phase.PEAK: {
        this._crescendo(dt, ctx);
        if (this.phaseTime >= D.peakTime) this._setPhase(Phase.RELAX, ctx);
        break;
      }
      case Phase.RELAX: {
        // Nothing spawns. The only thing that happens is distant sound, which
        // is what makes the quiet feel like held breath rather than an empty
        // level.
        this.relaxAudioTimer -= dt;
        if (this.relaxAudioTimer <= 0) {
          this.relaxAudioTimer = 5 + Math.random() * 7;
          if (!this._quiet) this.audio.distantSound(ctx.night);
        }
        const dur = ctx.night ? D.relaxTimeNight : D.relaxTime;
        if (this.phaseTime >= dur) this._setPhase(Phase.BUILD, ctx);
        break;
      }
    }
  }

  /**
   * Dawn dispersal.
   *
   * Two things at once, and the split is the whole reason it reads: everything
   * loses the thread and starts walking toward the edge of the map — which is
   * the bit you *see*, bodies drifting away up the road — while the ones
   * already too far off to be worth simulating are quietly removed, farthest
   * first, at a fixed rate. Nothing ever vanishes in front of you.
   */
  _dawnDisperse(dt, ctx) {
    const R = CFG.run;
    const E = CFG.world.size / 2 - 6;
    const hold = ctx.holdNear || null;

    if (!this._dispersing) {
      this._dispersing = true;
      this._disperseAcc = 0;
      this.log('dawn:disperse', this.zombies.length);
    }

    for (const z of this.zombies) {
      if (z.isDead || z.dispersing) continue;
      /**
       * Day five: whatever is standing between you and the convoy stays
       * exactly where it is. The dash for the road is the one dawn in the run
       * that is not a grace period.
       */
      if (hold && Math.hypot(z.pos.x - hold.x, z.pos.z - hold.z) <= hold.r) continue;

      z.dispersing = true;
      z.awareness = 0;
      z.lastKnown = null;
      z.knownHide = null;
      z.siegeTarget = null;
      z.climbTarget = null;
      const dx = z.pos.x - ctx.player.pos.x;
      const dz = z.pos.z - ctx.player.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      z.migrateTo = {
        x: Math.max(-E, Math.min(E, z.pos.x + (dx / d) * 120)),
        z: Math.max(-E, Math.min(E, z.pos.z + (dz / d) * 120)),
      };
      z.state = ZState.WANDER;
      z.wanderTimer = 999;
      z._pickWander();
    }

    this._disperseAcc += R.disperseRate * dt;
    while (this._disperseAcc >= 1 && this.zombies.length) {
      let idx = -1;
      let bd = -1;
      for (let i = 0; i < this.zombies.length; i++) {
        const z = this.zombies[i];
        if (!z.dispersing) continue;
        const d = Math.hypot(z.pos.x - ctx.player.pos.x, z.pos.z - ctx.player.pos.z);
        if (d > bd) {
          bd = d;
          idx = i;
        }
      }
      // Nothing left that is far enough away to remove unseen: let them walk.
      if (idx < 0 || bd < R.disperseKeepRadius) break;
      this._disperseAcc -= 1;
      const z = this.zombies.splice(idx, 1)[0];
      z.dispose();
    }
  }

  _endDisperse() {
    this._dispersing = false;
    for (const z of this.zombies) {
      if (!z.dispersing) continue;
      z.dispersing = false;
      /**
       * Give them their heads back. `migrateTo` overrides wandering entirely,
       * so anything that survived the grace window would otherwise spend the
       * rest of the run walking at the same point on the map edge and
       * standing on it — the group is `drifter`, not `migration`, so nothing
       * else was ever going to clear it.
       */
      if (z.group !== 'migration') z.migrateTo = null;
    }
  }

  /** Ordinary population upkeep. Spawns happen far away and walk in. */
  _ambient(dt, ctx) {
    const D = CFG.director;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;

    const night = ctx.night;
    this.spawnTimer = night ? 9 + Math.random() * 8 : 16 + Math.random() * 14;

    /**
     * The night curve's population multiplier. Night one is the target the
     * game shipped with; night five is 85% more of it, arriving faster and
     * moving quicker, and none of that is written anywhere but `CFG.nights`.
     */
    const target = Math.round((night ? D.targetNight : D.targetDay) * (night ? this._curve(ctx).pop : 1));
    const alive = this.zombies.length;
    if (alive >= target) return;
    const n = Math.min(night ? 3 : 2, target - alive);
    const made = this.spawnAmbient(ctx.player.pos, n, night ? 30 : 40, 58, ctx);
    if (made) this.log('ambient', made);
  }

  /**
   * The crescendo. Bodies arrive one at a time rather than all at once, each
   * already knowing roughly where you are — so it reads as a street closing in
   * over twenty seconds instead of a wall appearing.
   */
  _crescendo(dt, ctx) {
    const D = CFG.director;
    if (this.waveLeft <= 0) return;
    this.waveTimer -= dt;
    if (this.waveTimer > 0) return;
    this.waveTimer = D.waveInterval;
    if (this.zombies.length >= CFG.zombie.maxActive) return;

    const before = this.zombies.length;
    this.spawnAmbient(ctx.player.pos, 1, D.waveMinDist, D.waveMaxDist, ctx);
    if (this.zombies.length > before) {
      const z = this.zombies[this.zombies.length - 1];
      // They converge rather than lock on: they know the area, not the spot.
      z.lastKnown = { x: ctx.player.pos.x, z: ctx.player.pos.z };
      z.awareness = 0.62;
      z._enterInvestigate();
      this.waveLeft--;
      this.log('wave', z.type);
    }
  }

  /**
   * Which archetype the next ambient body should be.
   *
   * All gating lives here and all of it is data: the runner is a night animal,
   * the screamer needs the light to be going, the brute does not exist until
   * the first dusk has happened and never more than a couple at a time. Day
   * one before 17:36 therefore rolls exactly the three original archetypes,
   * which is the promise that base-game pacing is untouched.
   */
  _pickType(ctx) {
    const S = CFG.specials;
    const D = CFG.director;
    const opts = [
      { w: 62, id: 'shambler' },
      { w: 26, id: 'stalker' },
      { w: 12, id: 'bloated' },
    ];

    /**
     * The night curve scales every special's weight, and it governs the day
     * that leads into that night as well — so day one and night one both sit
     * at zero and roll exactly the three original archetypes.
     *
     * That is not a special case in the code and it is a very deliberate one
     * in the design: the first night must be beatable by a player who found
     * nothing, boarded nothing and knows none of this yet.
     */
    const specialMul = this._curve(ctx).specials;

    if (specialMul > 0 && D.specialsInPhases.includes(this.phase)) {
      const hour = ctx.hour ?? 12;
      const night = !!ctx.night;
      const afterDusk = !!ctx.pastFirstDusk;

      if (!S.runner.nightOnly || night) opts.push({ w: S.runner.weight * specialMul, id: 'runner' });
      if (this._afterHour(hour, S.screamer.earliestHour)) {
        opts.push({ w: S.screamer.weight * specialMul, id: 'screamer' });
      }
      if (afterDusk && this.countType('brute') < S.brute.maxAlive) {
        opts.push({ w: S.brute.weight * specialMul, id: 'brute' });
      }
    }
    return this.rng.weighted(opts).id;
  }

  /** True from `h` onward through the night, i.e. until dawn. */
  _afterHour(hour, h) {
    return hour >= h || hour < CFG.time.dawnHour;
  }

  countType(type) {
    let n = 0;
    for (const z of this.zombies) if (!z.isDead && z.type === type) n++;
    return n;
  }

  // ─────────────────────────────────────────────────────────── migration ──

  /**
   * Once a night, a column of ten to fourteen crosses the map.
   *
   * It is not aimed at you and it will not look for you — it is going
   * somewhere else, on a line chosen to keep well clear of the safehouse. All
   * the gameplay is in the twenty seconds of massed groaning that precede it,
   * which tell you a direction and nothing else. Get out of the way, get
   * inside, or find out.
   */
  _updateMigration(dt, ctx) {
    const M = CFG.migration;
    const m = this.migration;
    const nightIndex = Math.floor((ctx.elapsedHours || 0) / 24);

    if (m.state === 'idle') {
      // Scenarios that are not about the migration switch it off, so a column
      // of fourteen does not wander through the middle of a measurement.
      if (m.enabled === false) return;
      if (!ctx.night) return;
      if (m.night === nightIndex) return;                 // already had one
      if (!this._afterHour(ctx.hour ?? 0, M.earliestHour)) return;
      const route = this._planMigration(ctx);
      if (!route) return;
      m.night = nightIndex;
      m.from = route.from;
      m.to = route.to;
      m.t = 0;
      m.state = 'telegraph';
      this.log('migration:telegraph', route);
      return;
    }

    if (m.state === 'telegraph') {
      m.t += dt;
      this.groanTimer = (this.groanTimer || 0) - dt;
      if (this.groanTimer <= 0) {
        this.groanTimer = M.groanInterval;
        if (!this._quiet) {
          const sp = this.audio.spatial(m.from.x, m.from.z, 200);
          // Louder as they get closer to arriving.
          this.audio.distantHorde(sp.pan, 0.55 + (m.t / M.telegraph) * 0.9);
        }
      }
      if (m.t >= M.telegraph) {
        this._spawnMigration(ctx);
        m.state = 'walking';
        m.t = 0;
      }
      return;
    }

    if (m.state === 'walking') {
      m.t += dt;
      for (let i = m.members.length - 1; i >= 0; i--) {
        const z = m.members[i];
        if (z.isDead || !this.zombies.includes(z)) {
          m.members.splice(i, 1);
          continue;
        }
        // Off the far edge — they were never here for you.
        if (Math.hypot(z.pos.x - m.to.x, z.pos.z - m.to.z) < M.arriveRadius) {
          m.members.splice(i, 1);
          const j = this.zombies.indexOf(z);
          if (j >= 0) this.zombies.splice(j, 1);
          z.dispose();
        }
      }
      if (!m.members.length || m.t > 240) {
        m.state = 'idle';
        this.log('migration:done');
      }
    }
  }

  /**
   * A line across the map that keeps its distance from home.
   *
   * Tries random diameters until one passes far enough from the safehouse —
   * the check is point-to-segment, not point-to-endpoint, because a route that
   * starts and ends far away can still go straight through the front door.
   */
  _planMigration(ctx) {
    const M = CFG.migration;
    const R = CFG.world.size / 2 - M.spawnMargin;
    const sh = this.world.safehouse;
    const cx = sh ? (sh.bounds.minX + sh.bounds.maxX) / 2 : 0;
    const cz = sh ? (sh.bounds.minZ + sh.bounds.maxZ) / 2 : 0;

    for (let attempt = 0; attempt < 24; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const skew = (Math.random() - 0.5) * 0.9;
      const from = { x: Math.cos(a) * R, z: Math.sin(a) * R };
      const to = { x: Math.cos(a + Math.PI + skew) * R, z: Math.sin(a + Math.PI + skew) * R };
      if (segmentDistance(cx, cz, from, to) < M.safehouseClearance) continue;
      if (this.world.nav.isBlockedWorld(from.x, from.z)) continue;
      if (this.world.nav.isBlockedWorld(to.x, to.z)) continue;
      return { from, to };
    }
    return null;
  }

  _spawnMigration(ctx) {
    const M = CFG.migration;
    const m = this.migration;
    const n = M.minCount + Math.floor(Math.random() * (M.maxCount - M.minCount + 1));

    // Lateral axis of the column, so they arrive as a loose front rather than
    // a single file.
    const dx = m.to.x - m.from.x;
    const dz = m.to.z - m.from.z;
    const l = Math.hypot(dx, dz) || 1;
    const px = -dz / l;
    const pz = dx / l;

    let made = 0;
    for (let i = 0; i < n; i++) {
      const lat = (Math.random() * 2 - 1) * M.spread;
      const back = Math.random() * 7;
      const x = m.from.x + px * lat - (dx / l) * back;
      const z = m.from.z + pz * lat - (dz / l) * back;
      if (Math.abs(x) > CFG.world.size / 2 - 2 || Math.abs(z) > CFG.world.size / 2 - 2) continue;
      const type = this.rng.weighted([
        { w: 70, id: 'shambler' },
        { w: 22, id: 'stalker' },
        { w: 8, id: 'bloated' },
      ]).id;
      const zo = this.spawn(x, z, type, 'migration');
      if (!zo) continue;
      zo.migrateTo = { x: m.to.x, z: m.to.z };
      zo.state = ZState.WANDER;
      zo.wanderTimer = 999;
      zo._pickWander();
      m.members.push(zo);
      made++;
    }
    this.log('migration:arrive', made);
    return made;
  }

  // ──────────────────────────────────────────── hunts and aimed sieges ──

  /**
   * Hunting parties. The promise that passivity is not a strategy.
   *
   * From night two, a handful of bodies form up at the edge of the map every
   * ninety-odd seconds already knowing which building is yours, and walk to
   * it. They are not summoned by noise and they cannot be waited out — the
   * only answers are to not be there, to have spent your planks on the right
   * door, or to fight. A player asleep behind an unboarded window on night
   * four will be woken by them; that is the entire point.
   */
  _updateHunt(dt, ctx) {
    const H = CFG.hunt;
    const h = this.hunt;
    if (!ctx.night || !ctx.shelter) return;
    const want = this._curve(ctx).hunt;
    if (!want) return;

    if (h.night !== ctx.runDay) {
      h.night = ctx.runDay;
      h.left = want;
      h.timer = H.firstDelay;
      h.tele = 0;
    }
    if (h.left <= 0) return;

    if (h.tele > 0) {
      h.tele -= dt;
      h.groan -= dt;
      if (h.groan <= 0) {
        h.groan = 3.0;
        if (!this._quiet) {
          const sp = this.audio.spatial(ctx.shelter.centre.x, ctx.shelter.centre.z, 200);
          this.audio.distantHorde(sp.pan, 0.5);
        }
      }
      if (h.tele <= 0) {
        const made = this._spawnHunt(ctx);
        h.left--;
        h.timer = H.interval;
        this.log('hunt', made);
      }
      return;
    }

    h.timer -= dt;
    if (h.timer <= 0) h.tele = H.telegraph;
  }

  _spawnHunt(ctx) {
    const H = CFG.hunt;
    const n = H.minCount + Math.floor(Math.random() * (H.maxCount - H.minCount + 1));
    const c = ctx.shelter.centre;
    const R = CFG.world.size / 2 - 8;
    const a = Math.random() * Math.PI * 2;
    let made = 0;
    for (let i = 0; i < n; i++) {
      const aa = a + (Math.random() - 0.5) * 0.5;
      const d = R * (0.85 + Math.random() * 0.15);
      const x = Math.cos(aa) * d;
      const z = Math.sin(aa) * d;
      if (this.world.nav.isBlockedWorld(x, z)) continue;
      const zo = this.spawn(x, z, this._pickType(ctx), 'hunt');
      if (!zo) continue;
      // They know the house, not the room. What they do when they get there
      // is whatever the ordinary siege logic decides.
      zo.lastKnown = { x: c.x + (Math.random() - 0.5) * 4, z: c.z + (Math.random() - 0.5) * 4 };
      zo.awareness = 0.72;
      zo._enterInvestigate();
      made++;
    }
    return made;
  }

  /**
   * The night-three novelty: the migration, aimed.
   *
   * Everything about it is the migration — a column, a long telegraph, a line
   * across the map — except the two facts that matter. The line ends at your
   * front door, and they are not going anywhere afterwards. Twenty-six seconds
   * of massed groaning from a bearing that does not drift is the game asking
   * whether the boards you spent this afternoon on were on the right side of
   * the house.
   */
  _updateSiegeEvent(dt, ctx) {
    const S = CFG.siege;
    const s = this.siegeEvent;
    if (s.enabled === false) return;
    const night = ctx.runDay || 0;

    if (s.state === 'idle') {
      if (!ctx.night || !ctx.shelter) return;
      if (night < S.fromNight) return;
      if (s.night === night) return;
      if (!this._afterHour(ctx.hour ?? 0, S.earliestHour)) return;
      s.night = night;
      s.to = { x: ctx.shelter.centre.x, z: ctx.shelter.centre.z };
      s.from = this._siegeApproach(s.to);
      s.t = 0;
      s.groan = 0;
      s.state = 'telegraph';
      this.log('siege:telegraph', s.from);
      ctx.onSiegeWarning?.(s.from);
      return;
    }

    if (s.state === 'telegraph') {
      s.t += dt;
      s.groan -= dt;
      if (s.groan <= 0) {
        s.groan = CFG.migration.groanInterval;
        if (!this._quiet) {
          const sp = this.audio.spatial(s.from.x, s.from.z, 200);
          this.audio.distantHorde(sp.pan, 0.7 + (s.t / S.telegraph) * 0.9);
        }
      }
      if (s.t >= S.telegraph) {
        s.state = 'walking';
        s.t = 0;
        this.log('siege:arrive', this._spawnSiege(ctx));
      }
      return;
    }

    if (s.state === 'walking') {
      s.t += dt;
      for (let i = s.members.length - 1; i >= 0; i--) {
        const z = s.members[i];
        if (z.isDead || !this.zombies.includes(z)) s.members.splice(i, 1);
      }
      // They do not leave. They are done when they are dead or it is morning.
      if (!s.members.length || !ctx.night) {
        s.state = 'idle';
        s.members.length = 0;
        this.log('siege:done');
      }
    }
  }

  /** A point on the map edge to come at the shelter from. */
  _siegeApproach(to) {
    const R = CFG.world.size / 2 - CFG.migration.spawnMargin;
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2;
      const p = { x: Math.cos(a) * R, z: Math.sin(a) * R };
      if (Math.hypot(p.x - to.x, p.z - to.z) < 40) continue;
      if (this.world.nav.isBlockedWorld(p.x, p.z)) continue;
      return p;
    }
    return { x: 0, z: -R };
  }

  _spawnSiege(ctx) {
    const S = CFG.siege;
    const s = this.siegeEvent;
    const n = S.minCount + Math.floor(Math.random() * (S.maxCount - S.minCount + 1));
    const dx = s.to.x - s.from.x;
    const dz = s.to.z - s.from.z;
    const l = Math.hypot(dx, dz) || 1;
    const px = -dz / l;
    const pz = dx / l;

    let made = 0;
    for (let i = 0; i < n; i++) {
      const lat = (Math.random() * 2 - 1) * S.spread;
      const back = Math.random() * 8;
      const x = s.from.x + px * lat - (dx / l) * back;
      const z = s.from.z + pz * lat - (dz / l) * back;
      if (Math.abs(x) > CFG.world.size / 2 - 2 || Math.abs(z) > CFG.world.size / 2 - 2) continue;
      const zo = this.spawn(x, z, this._pickType(ctx), 'siege');
      if (!zo) continue;
      zo.lastKnown = { x: s.to.x + (Math.random() - 0.5) * 5, z: s.to.z + (Math.random() - 0.5) * 5 };
      zo.awareness = 0.9;
      zo._enterInvestigate();
      s.members.push(zo);
      made++;
    }
    return made;
  }

  // ────────────────────────────────────────────── groups and queueing ──

  /**
   * Give each group a leader to amble after.
   *
   * Cheap and infrequent: the lowest-id living member of a group leads it, and
   * the rest pick wander targets around *them* instead of around their own
   * spawn point. The effect is that a pack stays a pack while it drifts, which
   * is what makes a group readable — and therefore avoidable — from a street
   * away.
   */
  _assignLeaders(dt) {
    this._leaderTimer -= dt;
    if (this._leaderTimer > 0) return;
    this._leaderTimer = 3.5;

    const leaders = new Map();
    for (const z of this.zombies) {
      if (z.isDead || z.group === 'loner' || z.group === 'migration') continue;
      const cur = leaders.get(z.group);
      if (!cur || z.id < cur.id) leaders.set(z.group, z);
    }
    for (const z of this.zombies) {
      if (z.isDead) continue;
      z.leader = z.group === 'loner' || z.group === 'migration' ? null : leaders.get(z.group) || null;
    }
  }

  /**
   * Hand out standing room at every besieged opening, nearest first.
   *
   * Without this every zombie steers at the same square metre of doorway and
   * you get a knot of bodies occupying one cell. With it they form a line: the
   * front two work on the door and the rest wait along the wall, visibly.
   */
  _assignSiegeSlots() {
    const q = this._siegeQueues;
    q.clear();
    for (const z of this.zombies) {
      if (z.isDead) continue;
      const op = z.siegeTarget || (z.state === ZState.CHASE ? null : null);
      if (!op) continue;
      let arr = q.get(op);
      if (!arr) q.set(op, (arr = []));
      arr.push(z);
    }
    for (const [op, arr] of q) {
      arr.sort((a, b) => {
        const da = (a.pos.x - op.x) ** 2 + (a.pos.z - op.z) ** 2;
        const db = (b.pos.x - op.x) ** 2 + (b.pos.z - op.z) ** 2;
        return da - db;
      });
      for (let i = 0; i < arr.length; i++) arr[i].siegeSlot = i;
    }
  }

  // ────────────────────────────────────────────────────────── reactions ──

  /**
   * A screamer got its call out.
   *
   * Everything inside the radius learns roughly where you are and commits, and
   * the director takes a hard shove toward the crescendo. This is the single
   * loudest thing in the game that you did not do yourself.
   */
  onScream(source) {
    const S = CFG.specials.screamer;
    const at = source.lastKnown || { x: source.pos.x, z: source.pos.z };
    let woke = 0;
    for (const z of this.zombies) {
      if (z === source || z.isDead) continue;
      const d = Math.hypot(z.pos.x - source.pos.x, z.pos.z - source.pos.z);
      if (d > S.alertRadius) continue;
      z.lastKnown = { x: at.x, z: at.z };
      z.awareness = Math.max(z.awareness, 1.05);
      if (
        z.state !== ZState.CHASE &&
        z.state !== ZState.ATTACK &&
        z.state !== ZState.SIEGE &&
        z.state !== ZState.CLIMB
      ) {
        z._enterInvestigate();
      }
      woke++;
    }
    this.pressure = Math.min(1.8, this.pressure + S.pressure);
    this.log('scream', woke);
    return woke;
  }

  /**
   * The nearest body that died recently enough to still be interesting.
   * Corpses are already capped and already carry a `deathTimer`, so this is
   * free.
   */
  freshCorpseNear(x, z, radius) {
    const maxAge = CFG.zombie.corpseFreshFor;
    let best = null;
    let bd = radius * radius;
    for (const c of this.corpses) {
      if (c.deathTimer > maxAge) continue;
      const d2 = (c.pos.x - x) ** 2 + (c.pos.z - z) ** 2;
      if (d2 < bd) {
        bd = d2;
        best = c;
      }
    }
    return best;
  }
}

/** Shortest distance from a point to a line segment. */
function segmentDistance(px, pz, a, b) {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const wx = px - a.x;
  const wz = pz - a.z;
  const len2 = vx * vx + vz * vz;
  const t = len2 > 1e-6 ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / len2)) : 0;
  return Math.hypot(px - (a.x + vx * t), pz - (a.z + vz * t));
}

export { ZState, ARCHETYPES };
