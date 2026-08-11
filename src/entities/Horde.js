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
    this._director(dt, ctx);
    this._updateMigration(dt, ctx);
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
      this.waveLeft = ctx.night ? D.waveCountNight : D.waveCount;
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
          this.audio.distantSound(ctx.night);
        }
        const dur = ctx.night ? D.relaxTimeNight : D.relaxTime;
        if (this.phaseTime >= dur) this._setPhase(Phase.BUILD, ctx);
        break;
      }
    }
  }

  /** Ordinary population upkeep. Spawns happen far away and walk in. */
  _ambient(dt, ctx) {
    const D = CFG.director;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;

    const night = ctx.night;
    this.spawnTimer = night ? 9 + Math.random() * 8 : 16 + Math.random() * 14;

    const target = night ? D.targetNight : D.targetDay;
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

    if (D.specialsInPhases.includes(this.phase)) {
      const hour = ctx.hour ?? 12;
      const night = !!ctx.night;
      const afterDusk = !!ctx.pastFirstDusk;

      if (!S.runner.nightOnly || night) opts.push({ w: S.runner.weight, id: 'runner' });
      if (this._afterHour(hour, S.screamer.earliestHour)) {
        opts.push({ w: S.screamer.weight, id: 'screamer' });
      }
      if (afterDusk && this.countType('brute') < S.brute.maxAlive) {
        opts.push({ w: S.brute.weight, id: 'brute' });
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
        const sp = this.audio.spatial(m.from.x, m.from.z, 200);
        // Louder as they get closer to arriving.
        this.audio.distantHorde(sp.pan, 0.55 + (m.t / M.telegraph) * 0.9);
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
