/**
 * Objectives.js — two lines of text in the top-left corner, and nothing else.
 *
 * There is no quest log in AFTER and there are no markers on anything. The
 * whole five-day campaign is conveyed by the world — a radio that hisses at
 * dawn, headlights on the horizon on the fifth morning, the sound of a column
 * forming up somewhere north-east — and this file's entire job is to put a
 * sentence under the word OBJECTIVE that a sensible person would agree with.
 *
 * It therefore owns almost no state. It reads the run, the shelter and the
 * radio and says what it sees. The one thing it does own is the day-one
 * supply count, because "find six useful things before it gets dark" is the
 * tutorial and the tutorial is allowed to be explicit.
 */

import { ITEMS } from './Items.js';
import { Phase, RunState } from './Run.js';
import CFG from '../core/Config.js';

export const Goal = {
  GATHER: 'gather',
  RETURN: 'return',
  SURVIVE: 'survive',
  SCAVENGE: 'scavenge',
  ROAD: 'road',
  DONE: 'done',
};

export class Objectives {
  constructor(world) {
    this.world = world;
    this.reset();
  }

  reset() {
    this.goal = Goal.GATHER;
    this.suppliesNeeded = 6;
    this.suppliesFound = 0;
    this.barricadeDone = false;
    this.completedAt = null;
    this.events = [];
  }

  emit(kind, text, big = false) {
    this.events.push({ kind, text, big });
  }

  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }

  onItemCollected(id, count = 1) {
    const def = ITEMS[id];
    if (!def?.supply) return;
    const before = this.suppliesFound;
    this.suppliesFound += def.supply * count;
    if (before < this.suppliesNeeded && this.suppliesFound >= this.suppliesNeeded && this.goal === Goal.GATHER) {
      this.goal = Goal.RETURN;
      this.emit('good', 'You have enough to last the night. Get back to the house.', true);
    }
  }

  onBarricade() {
    this.barricadeDone = true;
    if (this.goal === Goal.RETURN || this.goal === Goal.GATHER) {
      this.goal = Goal.SURVIVE;
      this.emit('good', 'The door is boarded. Now you just have to last until morning.', true);
    }
  }

  /**
   * Follow the run.
   *
   * Day one keeps the original three-beat chain — gather, get back, hold —
   * because it is the only teaching the game does. From dawn on day two the
   * objective is simply whatever the clock is about to do to you, and on the
   * fifth morning it is a road.
   */
  update(dt, ctx) {
    const { run, player, world } = ctx;
    this._run = run;
    this._radio = ctx.radio;
    this._shelter = world.shelterAt(player.pos.x, player.pos.z);

    if (run.state === RunState.EXTRACTED || run.state === RunState.STRANDED) {
      this.goal = Goal.DONE;
      return;
    }

    /**
     * Day five, first light: everything else stops mattering.
     *
     * This stays on through the daylight even after the convoy has gone, so
     * that missing it is something the objective line actually says to you —
     * gating it on `!convoyGone` meant the "the road is empty" copy could
     * never appear and a player who was late just saw the ordinary day line,
     * with no acknowledgement that the run's whole point had left without
     * them. It hands back to SURVIVE at dusk, because by then the only
     * question left is the night.
     */
    if (run.day >= CFG.run.extractDay && run.phase !== Phase.NIGHT && run.phase !== Phase.DUSK) {
      this.goal = Goal.ROAD;
      return;
    }

    if (run.day === 1) {
      // The original chain, untouched.
      if (this.goal === Goal.RETURN && world.isInSafehouse(player.pos.x, player.pos.z)) {
        this.goal = Goal.SURVIVE;
        this.emit('good', 'Inside. Board the door if you found planks.', true);
      }
      if (run.phase === Phase.NIGHT && this.goal !== Goal.SURVIVE) this.goal = Goal.SURVIVE;
      return;
    }

    this.goal = run.phase === Phase.NIGHT || run.phase === Phase.DUSK ? Goal.SURVIVE : Goal.SCAVENGE;
  }

  // ─────────────────────────────────────────────────────────── the line ──

  get title() {
    const run = this._run;
    if (!run) return 'Survive';
    switch (this.goal) {
      case Goal.GATHER:
        return 'Find supplies before dark';
      case Goal.RETURN:
        return 'Get back to the safehouse';
      case Goal.ROAD:
        return run.convoyGone ? 'The road is empty' : 'The road north';
      case Goal.SURVIVE:
        return run.phase === Phase.DUSK ? 'Get somewhere with a door' : `Survive night ${run.night}`;
      case Goal.SCAVENGE:
        return run.phase === Phase.DAWN ? `Dawn · day ${run.day}` : `Day ${run.day}`;
      default:
        return 'Survive';
    }
  }

  get subtitle() {
    const run = this._run;
    if (!run) return '';

    if (this.goal === Goal.GATHER) {
      const n = Math.min(this.suppliesFound, this.suppliesNeeded);
      return `Supplies ${n}/${this.suppliesNeeded} · house to the south-west`;
    }
    if (this.goal === Goal.RETURN) return 'The blue house, south-west corner';
    if (this.goal === Goal.ROAD) {
      if (run.convoyGone) return 'You were not there. There is only tonight now.';
      return this._radio?.hint() || 'Engines, somewhere north of the crossroads';
    }
    if (this.goal === Goal.SURVIVE) {
      const held = this._shelterState();
      if (run.phase === Phase.DUSK) return held || 'Anywhere with four walls will do';
      return held || 'Out in it';
    }
    // Daylight.
    if (this._radio?.hasSignal) return 'The radio is saying something';
    const hint = this._radio?.hint();
    if (run.phase === Phase.DAWN) return hint || 'The street is as quiet as it gets';
    return hint || 'Find what you can while the light holds';
  }

  /**
   * What the shelter you are standing in is worth right now, in the shortest
   * true sentence available. Counting holes rather than naming them keeps it
   * a status line and not a checklist.
   */
  _shelterState() {
    const s = this._shelter;
    if (!s) return null;
    let open = 0;
    let boarded = 0;
    for (const op of s.openings) {
      if (op.state === 'broken' || (op.isDoor && op.state === 'open')) open++;
      else if (op.state === 'boarded') boarded++;
    }
    if (open > 0) return `${s.name} · ${open} way${open > 1 ? 's' : ''} in still open`;
    if (boarded === 0) return `${s.name} · shut, not boarded`;
    return `${s.name} · ${boarded}/${s.openings.length} boarded`;
  }
}
