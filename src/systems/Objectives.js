/**
 * Objectives.js — enough direction to give the slice a shape, not a mission.
 *
 *   1. Find supplies before dark  (six useful items)
 *   2. Get back to the safehouse and board the door
 *   3. Survive until dawn
 *
 * All three are soft. You can ignore them, stay out all night, and die of
 * something else entirely — the objective line just tells you what a sensible
 * person would be doing.
 */

import { ITEMS } from './Items.js';

export const Goal = {
  GATHER: 'gather',
  RETURN: 'return',
  SURVIVE: 'survive',
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
    this.reachedSafehouseAtNight = false;
    this.completedAt = null;
    this.events = [];
    this.nightWarned = false;
    this.duskWarned = false;
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

  update(dt, ctx) {
    const { time, player, world } = ctx;

    if (this.goal === Goal.DONE) return;

    // Dusk / night warnings — these are the pacing beats of the slice.
    if (!this.duskWarned && time.hour >= 18.4 && time.hour < 21) {
      this.duskWarned = true;
      this.emit('warn', 'The light is going. You do not want to be out here in the dark.', true);
    }
    if (!this.nightWarned && (time.hour >= 20.4 || time.hour < 5)) {
      this.nightWarned = true;
      this.emit('bad', 'Night. Something in the road is moving that was not moving before.', true);
    }

    const inside = world.isInSafehouse(player.pos.x, player.pos.z);

    if (this.goal === Goal.RETURN && inside) {
      this.goal = Goal.SURVIVE;
      this.emit('good', 'Inside. Board the door if you found planks.', true);
    }

    // Win: reach dawn alive.
    if (time.hour >= 6.0 && time.hour < 12 && time.day >= 1 && time.elapsedHours > 8) {
      this.goal = Goal.DONE;
      this.completedAt = time.hour;
      this.emit('good', 'Dawn.', true);
    }
  }

  get title() {
    switch (this.goal) {
      case Goal.GATHER:
        return 'Find supplies before dark';
      case Goal.RETURN:
        return 'Get back to the safehouse';
      case Goal.SURVIVE:
        return 'Survive until dawn';
      default:
        return 'Survive';
    }
  }

  get subtitle() {
    switch (this.goal) {
      case Goal.GATHER:
        return `Supplies ${Math.min(this.suppliesFound, this.suppliesNeeded)}/${this.suppliesNeeded} · house to the south-west`;
      case Goal.RETURN:
        return 'The blue house, south-west corner';
      case Goal.SURVIVE:
        return this.barricadeDone ? 'Door boarded · hold out' : 'Board the door with planks if you have them';
      default:
        return '';
    }
  }
}
