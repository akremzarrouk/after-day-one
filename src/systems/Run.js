/**
 * Run.js — the campaign clock.
 *
 * One night was a slice. Five days is a game, and the difference is entirely
 * in what happens between the nights: a dawn that is safe, a day that is
 * finite, a dusk that is a warning, and a night whose numbers are a function
 * of which night it is.
 *
 * ── the shape of a run ────────────────────────────────────────────────────
 *
 *   Day 1   16:24 → 18:30   half a day. Everything is still on the shelves.
 *           18:30 → 20:12   DUSK. The light is going.
 *           20:12 → 06:00   NIGHT 1 — baseline. No specials. Winnable bare.
 *   Day 2   06:00 → 08:00   DAWN. Grace: nothing spawns, the night walks off,
 *                           a quarter of the empty containers come back, and
 *                           the radio catches something.
 *           08:00 → 18:30   DAY. Scavenge, fortify, decide.
 *           20:12 → 06:00   NIGHT 2 — the specials come back.
 *   Day 3                   NIGHT 3 — a column forms up and walks at *you*.
 *   Day 4                   NIGHT 4 — the grid dies. Fog, and no streetlights.
 *   Day 5   06:00 → 09:00   THE CONVOY. Ridge checkpoint, north of the
 *                           crossroads. Reach it and the run is over.
 *
 * Miss the window and the convoy leaves without you: day five plays out, night
 * five runs at the "everything" curve, and the best you can do is still be
 * standing at dawn on the sixth. That is a worse ending, not a failure screen
 * — the run only ends badly when you do.
 *
 * Nothing in here draws anything. It owns the state, emits the beats as toast
 * and subtitle events, and answers questions the rest of the game asks it:
 * which night is it, how hard is it, can I sleep here, am I on the road out.
 */

import CFG from '../core/Config.js';
import { rollLoot } from './Items.js';
import { OpeningState } from '../world/Openings.js';

export const Phase = {
  DAWN: 'dawn',
  DAY: 'day',
  DUSK: 'dusk',
  NIGHT: 'night',
};

export const RunState = {
  ALIVE: 'alive',
  EXTRACTED: 'extracted',   // made the convoy
  STRANDED: 'stranded',     // survived five nights, missed the road
  DEAD: 'dead',
};

export class Run {
  constructor(world) {
    this.world = world;
    this.reset();
  }

  reset() {
    this.day = 1;
    this.phase = Phase.DAY;
    this.state = RunState.ALIVE;
    this.events = [];

    /** Which shelter you have made yours. The siege comes here. */
    this.shelter = null;
    this.slept = 0;
    this.dawnsSeen = 0;
    this.nightsSurvived = 0;

    this.convoyGone = false;
    this.convoyAnnounced = false;
    this.extractedAt = null;

    this._duskWarned = -1;
    this._nightWarned = -1;
    this._blackoutFired = -1;
    this._hour = CFG.time.startHour;
    this.blackout = 0;          // 0..1 ramp, read by TimeOfDay and World

    this.stats = {
      kills: 0,
      searched: 0,
      itemsFound: 0,
      distance: 0,
      built: 0,
      trapKills: 0,
      trapTriggers: 0,
      alarmTriggers: 0,
      generatorSeconds: 0,
      fragments: 0,
      nights: 0,
      damageTaken: 0,
    };
  }

  emit(kind, text, big = false) {
    this.events.push({ kind, text, big });
  }

  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ────────────────────────────────────────────────────────────── phases ──

  phaseFor(hour) {
    const R = CFG.run;
    if (hour >= R.dawnStart && hour < R.dawnEnd) return Phase.DAWN;
    if (hour >= R.dawnEnd && hour < R.duskWarn) return Phase.DAY;
    if (hour >= R.duskWarn && hour < R.nightStart) return Phase.DUSK;
    return Phase.NIGHT;
  }

  /**
   * Which night is coming, or running. Night N ends day N, so it stays N all
   * the way through to the dawn that starts day N+1 — the run day deliberately
   * does *not* tick over at midnight the way the wall clock does, because a
   * night that changes its own difficulty number halfway through is a night
   * nobody can learn.
   */
  get night() {
    return Math.min(this.day, CFG.nights.length);
  }

  get curve() {
    return CFG.nights[this.night - 1] || CFG.nights[CFG.nights.length - 1];
  }

  get isNightPhase() {
    return this.phase === Phase.NIGHT;
  }

  /** True inside the dawn grace window: nothing new spawns, the night leaves. */
  get inGrace() {
    return this.phase === Phase.DAWN;
  }

  /** Day five, first light, and the convoy has not left yet. */
  get extractionOpen() {
    const R = CFG.run;
    return (
      this.state === RunState.ALIVE &&
      !this.convoyGone &&
      this.day >= R.extractDay &&
      this._hour >= R.extractFrom &&
      this._hour < R.extractTo
    );
  }

  distanceToRoad(x, z) {
    const p = CFG.run.extractPoint;
    return Math.hypot(x - p.x, z - p.z);
  }

  // ────────────────────────────────────────────────────────────── update ──

  update(dt, ctx) {
    const { time, player } = ctx;
    this._hour = time.hour;
    if (this.state !== RunState.ALIVE) return;

    const next = this.phaseFor(time.hour);
    if (next !== this.phase) this._enterPhase(next, ctx);

    // The ramp is measured against the clock, not the wall, so the street goes
    // out over the same stretch of night whether you are watching it happen or
    // fast-forwarding through it in your sleep.
    this._updateBlackout(dt * (time.timeScale || 1), ctx);

    // ── dusk and night warnings, once per day ──
    if (this.phase === Phase.DUSK && this._duskWarned !== this.day) {
      this._duskWarned = this.day;
      this.emit('warn', 'The light is going. You do not want to be out here in the dark.', true);
    }
    if (this.phase === Phase.NIGHT && this._nightWarned !== this.day) {
      this._nightWarned = this.day;
      this.emit('bad', this._nightLine(), true);
    }

    // ── the convoy ──
    const R = CFG.run;
    if (this.day >= R.extractDay && !this.convoyGone) {
      if (!this.convoyAnnounced && time.hour >= R.extractFrom && this.phase === Phase.DAWN) {
        this.convoyAnnounced = true;
        this.emit('good', 'Engines, somewhere north. They are not going to wait.', true);
      }
      /**
       * The convoy leaves at nine whether or not you were there to hear it
       * announced. Gating this on the announcement meant a player who loaded
       * a save into the middle of day five — or who was simply asleep through
       * the dawn — got a road that never closed and an objective line that
       * pointed at an empty checkpoint for the rest of the run.
       */
      if (time.hour >= R.extractTo && time.hour < R.nightStart) {
        this.convoyGone = true;
        this.emit(
          'bad',
          this.convoyAnnounced
            ? 'The engines stop. Whatever that was, it has gone without you.'
            : 'Tyre marks on the tarmac, still warm. You were not here.',
          true
        );
      }
      if (this.extractionOpen && this.distanceToRoad(player.pos.x, player.pos.z) <= R.extractRadius) {
        this.state = RunState.EXTRACTED;
        this.extractedAt = time.hour;
        return;
      }
    }

    // Five nights and the road gone: the only ending left is still being here.
    if (this.convoyGone && this.day > R.extractDay && this.phase === Phase.DAWN) {
      this.state = RunState.STRANDED;
    }
  }

  _nightLine() {
    switch (this.curve.event) {
      case 'specials':
        return 'Night two. Something out there is running.';
      case 'siege':
        return 'Night three. The road sounds crowded in a way roads do not.';
      case 'blackout':
        return 'Night four. The streetlights are humming wrong.';
      case 'everything':
        return 'Night five. There is nothing left to come tomorrow.';
      default:
        return 'Night. Something in the road is moving that was not moving before.';
    }
  }

  _enterPhase(next, ctx) {
    const prev = this.phase;
    this.phase = next;

    if (next === Phase.DAWN && prev === Phase.NIGHT) this._dawn(ctx);
    if (next === Phase.NIGHT) {
      this.stats.nights++;
      ctx.onNightBegin?.(this.night, this.curve);
    }
  }

  /**
   * Dawn.
   *
   * The only two minutes in the game where nothing is trying to reach you, and
   * therefore where every between-nights thing happens at once: the day
   * counter turns over, the night's survivors are told to go home, a quarter
   * of the emptied containers quietly come back, and the radio finds
   * something. It is also the only autosave point, which is what makes it read
   * as a chapter break rather than a lull.
   */
  _dawn(ctx) {
    this.day++;
    this.dawnsSeen++;
    this.nightsSurvived++;
    this.emit('good', `Dawn. Day ${this.day}.`, true);

    const restocked = this.restock(ctx.rng);
    if (restocked > 0) {
      this.emit('', 'Somebody has been through here in the night. Not everything they left is nothing.');
    }

    if (ctx.radio?.onDawn(this.day)) {
      this.emit('warn', 'The radio in the house is saying something.', true);
    }

    ctx.onDawn?.(this.day);
  }

  /**
   * The restock.
   *
   * Emptied containers stay empty — that is the whole shape of the economy —
   * except for a quarter of them, which get exactly one thin roll put back.
   * Diegetically it is scavengers moving through, rats in a cupboard, and the
   * corner of a shelf you did not check because it was dark. Mechanically it
   * is the difference between a map that runs dry on day three and one that
   * makes you work for day five.
   */
  restock(rng) {
    const E = CFG.economy;
    let n = 0;
    for (const it of this.world.interactables) {
      if (it.type !== 'container') continue;
      if (it.richness > 0) continue;
      if (!rng.chance(E.restockChance)) continue;
      it.richness = 1;
      it.thin = true;
      it.used = false;
      n++;
    }
    this.restockedLast = n;
    return n;
  }

  /**
   * What a container gives up now.
   *
   * The luck curve does the day-to-day thinning: the same shelf that gave you
   * beans on day one is being searched for the fifth time by day five, and a
   * restocked container rolls at a luck below one, which biases it hard toward
   * the table's "nothing" entry.
   */
  rollContainer(it, rng) {
    const luck = CFG.loot.luckPerDay[Math.min(this.day, CFG.loot.luckPerDay.length) - 1];
    const effective = it.thin ? luck * CFG.economy.restockLuck : luck;
    const rolled = rollLoot(it.table, rng, effective);
    if (it.thin && rolled.length) {
      // A thin roll is one item, never a stack of three.
      rolled.length = Math.min(rolled.length, CFG.economy.restockMax);
      for (const r of rolled) r.count = Math.min(r.count, CFG.economy.restockMax);
    }
    it.richness = Math.max(0, (it.richness ?? 1) - 1);
    it.looted = true;
    it.used = it.richness <= 0;
    if (it.used) it.thin = false;
    return rolled;
  }

  // ──────────────────────────────────────────────────────────── blackout ──

  /**
   * Night four kills the grid. The ramp is slow enough that you notice the
   * street going out around you rather than a light switch being thrown, and
   * it is a 0..1 number so `TimeOfDay` and `World` can each do whatever it
   * means to them without either of them owning it.
   */
  _updateBlackout(dt, ctx) {
    const want =
      this.isNightPhase &&
      (this.curve.event === 'blackout' || this.curve.event === 'everything') &&
      (this._hour >= CFG.blackout.warnAt || this._hour < CFG.run.dawnStart);

    if (want && this._blackoutFired !== this.day) {
      this._blackoutFired = this.day;
      this.emit('bad', 'The streetlights go out, one block at a time, all the way north.', true);
    }
    const target = want ? 1 : 0;
    const rate = dt / CFG.blackout.fogRamp;
    this.blackout += Math.sign(target - this.blackout) * Math.min(rate, Math.abs(target - this.blackout));
  }

  // ─────────────────────────────────────────────────────────────── sleep ──

  /**
   * Can you actually put your head down here?
   *
   * Three conditions, and each one is a thing you can go and fix: you are in a
   * shelter, every hole in it is shut or boarded, and nothing that knows about
   * you is standing within twenty metres. It refuses with the specific reason
   * rather than a generic no, because "the kitchen window is out" is an
   * instruction and "you cannot sleep" is a wall.
   */
  canSleep(ctx) {
    const { world, horde, player } = ctx;
    const shelter = world.shelterAt(player.pos.x, player.pos.z);
    if (!shelter) return { ok: false, reason: 'Not somewhere you could sleep.' };

    /**
     * Name the wall it is in. The store has six openings and "a window is
     * still out" would send you round the building twice — the refusal has to
     * be an instruction, and the compass point is what makes it one.
     */
    const R = CFG.run;
    const where = { n: 'north', s: 'south', e: 'east', w: 'west' };
    for (const op of shelter.openings) {
      const side = where[op.side] || '';
      if (op.state === OpeningState.BROKEN) {
        return {
          ok: false,
          reason: `The ${side} ${op.isDoor ? 'door' : 'window'} is still out.`.replace('  ', ' '),
          opening: op,
        };
      }
      if (op.isDoor && op.state === OpeningState.OPEN) {
        return { ok: false, reason: `The ${side} door is standing open.`.replace('  ', ' '), opening: op };
      }
    }

    for (const z of horde.zombies) {
      if (z.isDead) continue;
      if (z.awareness < R.sleepAwareness) continue;
      const d = Math.hypot(z.pos.x - player.pos.x, z.pos.z - player.pos.z);
      if (d <= R.sleepClearRadius) {
        return { ok: false, reason: 'Something out there knows you are in here.' };
      }
    }

    return { ok: true, shelter };
  }

  /**
   * Sleeping somewhere, or putting something in its box, is how you claim it.
   * You do not get a menu for it.
   *
   * Claiming also says out loud what it costs. The store is on top of the best
   * loot on the map and has two more holes in it; the blue house has the radio
   * and the generator. That is a good trade and a legible one — but only if
   * the game mentions that the radio does not come with you, which is
   * otherwise a penalty a player discovers three dawns later by wondering why
   * nothing is on the air.
   */
  claim(shelter) {
    if (!shelter || this.shelter === shelter) return false;
    const first = !this.shelter;
    this.shelter = shelter;
    this.emit('good', first ? `${shelter.name} is yours now.` : `You move into ${shelter.name.toLowerCase()}.`);
    if (!shelter.hasRadio) {
      this.emit('warn', 'The radio is back at the blue house. Anything it says, it says without you.', true);
    }
    return true;
  }


  // ──────────────────────────────────────────────────────── presentation ──

  get phaseLabel() {
    switch (this.phase) {
      case Phase.DAWN:
        return 'DAWN';
      case Phase.DAY:
        return 'DAY';
      case Phase.DUSK:
        return 'DUSK';
      default:
        return 'NIGHT';
    }
  }

  summary(time) {
    const s = this.stats;
    return {
      day: this.day,
      nights: this.nightsSurvived,
      hours: time ? time.elapsedHours : 0,
      ...s,
    };
  }

  // ───────────────────────────────────────────────────────── persistence ──

  serialize() {
    return {
      day: this.day,
      phase: this.phase,
      state: this.state,
      shelter: this.shelter?.id ?? null,
      slept: this.slept,
      dawnsSeen: this.dawnsSeen,
      nightsSurvived: this.nightsSurvived,
      convoyGone: this.convoyGone,
      convoyAnnounced: this.convoyAnnounced,
      duskWarned: this._duskWarned,
      nightWarned: this._nightWarned,
      stats: { ...this.stats },
    };
  }

  restore(s, world) {
    if (!s) return;
    this.day = s.day ?? 1;
    this.phase = s.phase || Phase.DAY;
    this.state = s.state || RunState.ALIVE;
    this.shelter = world.shelters.find((x) => x.id === s.shelter) || null;
    this.slept = s.slept || 0;
    this.dawnsSeen = s.dawnsSeen || 0;
    this.nightsSurvived = s.nightsSurvived || 0;
    this.convoyGone = !!s.convoyGone;
    this.convoyAnnounced = !!s.convoyAnnounced;
    this._duskWarned = s.duskWarned ?? -1;
    this._nightWarned = s.nightWarned ?? -1;
    Object.assign(this.stats, s.stats || {});
  }
}
