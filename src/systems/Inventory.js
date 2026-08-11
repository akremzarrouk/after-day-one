/**
 * Inventory.js — a flat list of stacks with a weight cap.
 *
 * Deliberately small: a survivor's pockets, not an RPG bag. The weight cap is
 * what makes "do I take the axe or the medkit" an actual question.
 */

import CFG from '../core/Config.js';
import { ITEMS, ItemType, WEAPONS } from './Items.js';

/** Which condition band a 0..1 wear value sits in. */
export function conditionTier(cond) {
  const tiers = CFG.durability.tiers;
  for (const t of tiers) if (cond > t.at) return t;
  return tiers[tiers.length - 1];
}

export class Inventory {
  constructor(maxWeight = 22) {
    this.slots = []; // { id, count }
    this.maxSlots = 16;
    this.maxWeight = maxWeight;
    this.equipped = 'fists'; // weapon id from WEAPONS
    this.listeners = [];
  }

  onChange(fn) {
    this.listeners.push(fn);
  }
  _emit() {
    for (const fn of this.listeners) fn(this);
  }

  get weight() {
    let w = 0;
    for (const s of this.slots) w += (ITEMS[s.id]?.weight || 0) * s.count;
    return w;
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s.id === id) n += s.count;
    return n;
  }

  has(id, n = 1) {
    return this.count(id) >= n;
  }

  canFit(id, n = 1) {
    const def = ITEMS[id];
    if (!def) return false;
    if (this.weight + def.weight * n > this.maxWeight + 0.001) return false;
    // Existing stack with room?
    for (const s of this.slots) {
      if (s.id === id && s.count < def.stack) return true;
    }
    return this.slots.length < this.maxSlots;
  }

  /**
   * Returns number actually added.
   *
   * @param cond  starting condition for a weapon, 0..1. Found weapons come off
   *              the world already used — nothing in this town is new.
   */
  add(id, n = 1, cond = null) {
    const def = ITEMS[id];
    if (!def) return 0;
    let added = 0;
    while (n > 0) {
      if (this.weight + def.weight > this.maxWeight + 0.001) break;
      let slot = this.slots.find((s) => s.id === id && s.count < def.stack);
      if (!slot) {
        if (this.slots.length >= this.maxSlots) break;
        slot = { id, count: 0 };
        if (WEAPONS[def.weapon]?.durability) slot.cond = cond ?? 1;
        this.slots.push(slot);
      }
      slot.count++;
      n--;
      added++;
    }
    if (added) this._emit();
    return added;
  }

  // ─────────────────────────────────────────────────────────── condition ──

  /**
   * The slot holding whatever is in your hand. Weapons never stack, so this is
   * a single object with a single condition rather than a count of identical
   * ones — which is the whole reason durability can live on the slot at all.
   */
  get equippedSlot() {
    if (this.equipped === 'fists') return null;
    return this.slots.find((s) => ITEMS[s.id]?.weapon === this.equipped) || null;
  }

  /** 0..1, or null for anything that cannot wear out. */
  get equippedCondition() {
    const w = WEAPONS[this.equipped];
    if (!w?.durability) return null;
    const s = this.equippedSlot;
    return s ? (s.cond ?? 1) : null;
  }

  /** Damage multiplier from the equipped weapon's condition. */
  get equippedDamageMul() {
    const c = this.equippedCondition;
    return c === null ? 1 : conditionTier(c).mul;
  }

  /**
   * Use it a bit harder.
   *
   * @param hits  wear in "hits at full condition"
   * @returns 'broke' when the thing came apart, 'tier' when it dropped a band,
   *          'ok' for ordinary wear, or null if it cannot wear out at all.
   */
  wearEquipped(hits) {
    const w = WEAPONS[this.equipped];
    if (!w?.durability || hits <= 0) return null;
    const slot = this.equippedSlot;
    if (!slot) return null;

    const before = slot.cond ?? 1;
    const after = Math.max(0, before - hits / w.durability);
    slot.cond = after;

    // Epsilon, not zero: `durability` hits of `1/durability` each accumulate to
    // a hair under 1, and a weapon rated for 46 swings must break on the 46th.
    if (after <= 1e-6) {
      const i = this.slots.indexOf(slot);
      if (i >= 0) this.slots.splice(i, 1);
      this.equipped = 'fists';
      this._emit();
      return 'broke';
    }
    this._emit();
    return conditionTier(after) !== conditionTier(before) ? 'tier' : 'ok';
  }

  /**
   * Bring one weapon back a step. Repairing to the *top* of the next band up
   * rather than by a fixed amount is what makes the tool roll feel like a
   * decision: spending it on a nearly-pristine axe wastes most of it.
   */
  repairEquipped() {
    const w = WEAPONS[this.equipped];
    if (!w?.durability) return null;
    const slot = this.equippedSlot;
    if (!slot) return null;
    const cond = slot.cond ?? 1;
    if (cond >= 0.999) return null;

    const tiers = CFG.durability.tiers;
    const idx = tiers.indexOf(conditionTier(cond));
    slot.cond = Math.min(1, CFG.durability.repairTo[Math.max(0, idx - 1)] ?? 1);
    this._emit();
    return { from: cond, to: slot.cond, tier: conditionTier(slot.cond).name };
  }

  remove(id, n = 1) {
    let removed = 0;
    for (let i = this.slots.length - 1; i >= 0 && n > 0; i--) {
      const s = this.slots[i];
      if (s.id !== id) continue;
      const take = Math.min(s.count, n);
      s.count -= take;
      n -= take;
      removed += take;
      if (s.count <= 0) this.slots.splice(i, 1);
    }
    if (removed) this._emit();
    return removed;
  }

  removeAtIndex(i, n = 1) {
    const s = this.slots[i];
    if (!s) return 0;
    const take = Math.min(s.count, n);
    s.count -= take;
    if (s.count <= 0) this.slots.splice(i, 1);
    this._emit();
    return take;
  }

  /** Best weapon currently carried, used for auto-equip on pickup. */
  bestWeaponId() {
    let best = 'fists';
    let bestScore = WEAPONS.fists.damage / (WEAPONS.fists.windup + WEAPONS.fists.recover);
    for (const s of this.slots) {
      const def = ITEMS[s.id];
      if (def?.type !== ItemType.WEAPON) continue;
      const w = WEAPONS[def.weapon];
      if (!w || w.ranged) continue;
      const score = w.damage / (w.windup + w.recover);
      if (score > bestScore) {
        bestScore = score;
        best = def.weapon;
      }
    }
    return best;
  }

  /**
   * Everything you can put in your hand.
   *
   * Keyed off `def.weapon` rather than the item *type*, because a bottle and a
   * molotov are resources by every other measure and still need to be
   * equippable — a throwable you cannot select is not a weapon, it is inventory
   * decoration.
   */
  weaponItems() {
    return this.slots
      .map((s, i) => ({ ...s, i, def: ITEMS[s.id] }))
      .filter((s) => !!s.def?.weapon);
  }

  equipWeapon(weaponId) {
    if (weaponId !== 'fists') {
      const owns = this.slots.some((s) => ITEMS[s.id]?.weapon === weaponId);
      if (!owns) return false;
    }
    this.equipped = weaponId;
    this._emit();
    return true;
  }

  /** Cycle through fists + carried weapons. */
  cycleWeapon(dir = 1) {
    const list = ['fists', ...this.weaponItems().map((s) => s.def.weapon)];
    const uniq = [...new Set(list)];
    let i = uniq.indexOf(this.equipped);
    if (i < 0) i = 0;
    i = (i + dir + uniq.length) % uniq.length;
    this.equipWeapon(uniq[i]);
    return uniq[i];
  }

  serialize() {
    return { slots: this.slots.map((s) => ({ ...s })), equipped: this.equipped };
  }
}
