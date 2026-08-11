/**
 * Survival.js — health, stamina, thirst, hunger, bleeding.
 *
 * The pressure curve is intentionally gentle for the first few hours and then
 * becomes a real problem around nightfall, which is exactly when you least
 * want to be outside looking for a bottle of water.
 */

import CFG from '../core/Config.js';
import { clamp } from '../core/Utils.js';

export class Survival {
  constructor() {
    this.maxHealth = CFG.player.maxHealth;
    this.health = this.maxHealth;
    this.maxStamina = CFG.player.maxStamina;
    this.stamina = this.maxStamina;
    this.thirst = 88;
    this.hunger = 92;

    this.bleeding = 0;          // stacks; each does damage over time
    this.painkiller = 0;        // seconds remaining
    this.exhausted = false;     // must recover before sprinting again
    this.staminaIdle = 0;       // time since last stamina spend
    this.dead = false;
    this.deathCause = '';
    this.lastDamageTime = -99;
    this.damageFlash = 0;
    this.totalDamageTaken = 0;

    this.events = [];           // consumed by HUD for toasts
  }

  emit(kind, text) {
    this.events.push({ kind, text });
    if (this.events.length > 20) this.events.shift();
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Max stamina shrinks when you're starving or parched. */
  get effectiveMaxStamina() {
    const t = CFG.survival.staminaPenaltyAt;
    let mul = 1;
    if (this.thirst < t) mul -= 0.4 * (1 - this.thirst / t);
    if (this.hunger < t) mul -= 0.25 * (1 - this.hunger / t);
    return this.maxStamina * clamp(mul, 0.35, 1);
  }

  spendStamina(n) {
    this.stamina = clamp(this.stamina - n, 0, this.maxStamina);
    this.staminaIdle = 0;
    if (this.stamina <= 0.5) {
      this.exhausted = true;
      this.emit('warn', 'You are out of breath.');
    }
    return this.stamina;
  }

  canSpend(n) {
    return this.stamina >= n * 0.55; // allow a slightly desperate last swing
  }

  damage(amount, cause = 'the dead', opts = {}) {
    if (this.dead) return 0;
    if (CFG.debug.godMode) return 0;
    let dmg = amount;
    if (this.painkiller > 0) dmg *= 0.85;
    this.health = clamp(this.health - dmg, 0, this.maxHealth);
    this.totalDamageTaken += dmg;
    this.lastDamageTime = 0;
    this.damageFlash = Math.min(1, this.damageFlash + dmg / 45);
    if (opts.bleed) this.addBleed(opts.bleed);
    if (this.health <= 0) {
      this.dead = true;
      this.deathCause = cause;
    }
    return dmg;
  }

  addBleed(n = 1) {
    this.bleeding = Math.min(4, this.bleeding + n);
    this.emit('bad', 'You are bleeding.');
  }

  heal(n) {
    this.health = clamp(this.health + n, 0, this.maxHealth);
  }

  applyItemEffects(eff) {
    if (!eff) return;
    if (eff.health) this.heal(eff.health);
    if (eff.thirst) this.thirst = clamp(this.thirst + eff.thirst, 0, 100);
    if (eff.hunger) this.hunger = clamp(this.hunger + eff.hunger, 0, 100);
    if (eff.stamina) {
      this.stamina = clamp(this.stamina + eff.stamina, 0, this.maxStamina);
      if (this.stamina > CFG.player.staminaExhaustLock) this.exhausted = false;
    }
    if (eff.stopBleed) this.bleeding = 0;
    if (eff.painkiller) this.painkiller = Math.max(this.painkiller, eff.painkiller);
  }

  /**
   * @param dt        real seconds
   * @param hoursDt   in-game hours elapsed
   * @param activity  { sprinting, moving, resting }
   */
  update(dt, hoursDt, activity) {
    if (this.dead) return;

    this.lastDamageTime += dt;
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6);
    if (this.painkiller > 0) this.painkiller -= dt;

    // ── stamina ──
    this.staminaIdle += dt;
    const maxSt = this.effectiveMaxStamina;
    if (this.stamina > maxSt) this.stamina = maxSt;

    if (activity.sprinting) {
      this.spendStamina(CFG.player.sprintDrain * dt);
    } else if (this.staminaIdle > CFG.player.staminaRegenDelay) {
      const rate =
        CFG.player.staminaRegen *
        (activity.resting ? 1.55 : activity.moving ? 0.78 : 1) *
        (this.painkiller > 0 ? 1.3 : 1);
      this.stamina = clamp(this.stamina + rate * dt, 0, maxSt);
    }
    if (this.exhausted && this.stamina >= CFG.player.staminaExhaustLock) this.exhausted = false;

    // ── thirst / hunger ──
    const prevThirst = this.thirst;
    const prevHunger = this.hunger;
    this.thirst = clamp(
      this.thirst - CFG.survival.thirstPerHour * hoursDt - (activity.sprinting ? CFG.survival.thirstSprintExtra * dt : 0),
      0,
      100
    );
    this.hunger = clamp(
      this.hunger - CFG.survival.hungerPerHour * hoursDt - (activity.sprinting ? CFG.survival.hungerSprintExtra * dt : 0),
      0,
      100
    );

    const low = CFG.survival.lowThreshold;
    if (prevThirst >= low && this.thirst < low) this.emit('warn', 'Your throat is dry. Find water.');
    if (prevHunger >= low && this.hunger < low) this.emit('warn', 'Your stomach is cramping.');
    if (prevThirst > 0 && this.thirst <= 0) this.emit('bad', 'Dehydrated. You are losing strength.');
    if (prevHunger > 0 && this.hunger <= 0) this.emit('bad', 'Starving.');

    // ── attrition ──
    if (this.thirst <= 0) this.damage((CFG.survival.dehydratedDamage / 60) * dt, 'dehydration');
    if (this.hunger <= 0) this.damage((CFG.survival.starvingDamage / 60) * dt, 'starvation');
    if (this.bleeding > 0) {
      this.damage(this.bleeding * 0.55 * dt, 'blood loss');
      // Bleeding slowly clots on its own, but not fast enough to rely on.
      this.bleeding = Math.max(0, this.bleeding - dt * 0.012);
    }
  }

  reset() {
    this.health = this.maxHealth;
    this.stamina = this.maxStamina;
    this.thirst = 88;
    this.hunger = 92;
    this.bleeding = 0;
    this.painkiller = 0;
    this.exhausted = false;
    this.dead = false;
    this.deathCause = '';
    this.totalDamageTaken = 0;
    this.events = [];
  }
}
