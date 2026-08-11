/**
 * HUD.js — all DOM UI. Kept out of the 3D layer entirely so neither can break
 * the other, and so the HUD costs nothing per frame beyond a few style writes.
 */

import { ITEMS, ItemType, WEAPONS } from '../systems/Items.js';
import { conditionTier } from '../systems/Inventory.js';
import { clamp01 } from '../core/Utils.js';
import CFG from '../core/Config.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'),
      objText: $('obj-text'),
      objSub: $('obj-sub'),
      clockTime: $('clock-time'),
      clockPhase: $('clock-phase'),
      clockPanel: $('clock-panel'),
      barHealth: $('bar-health'),
      barStamina: $('bar-stamina'),
      barThirst: $('bar-thirst'),
      barHunger: $('bar-hunger'),
      vitals: $('vitals'),
      weaponName: $('weapon-name'),
      weaponSub: $('weapon-sub'),
      ammoLine: $('ammo-line'),
      ammoCount: $('ammo-count'),
      weaponCond: $('weapon-cond'),
      condPips: Array.from(document.querySelectorAll('#weapon-cond .pip')),
      condWord: $('cond-word'),
      adsReticle: $('ads-reticle'),
      reticle: $('reticle'),
      interact: $('interact-prompt'),
      interactText: $('interact-text'),
      searchWrap: $('search-progress'),
      searchFill: $('search-fill'),
      toasts: $('toasts'),
      subtitle: $('subtitle'),
      damage: $('damage-flash'),
      nightTint: $('night-tint'),
      status: $('status-strip'),
      noiseFill: $('noise-fill'),
      stealthEye: $('stealth-eye'),
      eyeFill: $('eye-fill'),
      threatLayer: $('threat-layer'),
      inventory: $('inventory'),
      invGrid: $('inv-grid'),
      invName: $('inv-detail-name'),
      invDesc: $('inv-detail-desc'),
      invStats: $('inv-detail-stats'),
      invActions: $('inv-detail-actions'),
      invHp: $('inv-hp'),
      invTh: $('inv-th'),
      invHu: $('inv-hu'),
      invWt: $('inv-wt'),
      screenTitle: $('screen-title'),
      screenDeath: $('screen-death'),
      screenWin: $('screen-win'),
      screenLoading: $('screen-loading'),
      loadFill: $('load-fill'),
      loadText: $('load-text'),
      deathCause: $('death-cause'),
      deathStats: $('death-stats'),
      winText: $('win-text'),
      winStats: $('win-stats'),
      pauseHint: $('pause-hint'),
    };

    this.selectedSlot = 0;
    this.toastList = [];
    this.subtitleTimer = 0;
    this.threatArrows = [];
    this.noteOpen = false;
    this._lastInvSig = '';
  }

  // ─────────────────────────────────────────────────────────── screens ──

  setLoading(p, text) {
    this.el.loadFill.style.width = `${Math.round(p * 100)}%`;
    if (text) this.el.loadText.textContent = text;
  }

  hideLoading() {
    this.el.screenLoading.classList.add('hidden');
  }

  showTitle() {
    this.el.screenTitle.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
  }

  hideTitle() {
    this.el.screenTitle.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
  }

  showDeath(cause, stats) {
    this.el.deathCause.textContent = cause;
    this.el.deathStats.innerHTML = stats;
    this.el.screenDeath.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
  }

  hideDeath() {
    this.el.screenDeath.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
  }

  showWin(text, stats) {
    this.el.winText.innerHTML = text;
    this.el.winStats.innerHTML = stats;
    this.el.screenWin.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
  }

  hideWin() {
    this.el.screenWin.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
  }

  setPaused(on) {
    this.el.pauseHint.classList.toggle('hidden', !on);
  }

  // ────────────────────────────────────────────────────────────── notes ──

  showNote(title, text) {
    if (this.noteOpen) return;
    this.noteOpen = true;
    const ov = document.createElement('div');
    ov.id = 'note-overlay';
    ov.innerHTML = `
      <div class="note-paper">
        <div class="note-title">${title}</div>
        <div class="note-body">${text}</div>
        <div class="note-close">[E] or [ESC] to put it back</div>
      </div>`;
    document.getElementById('app').appendChild(ov);
    this.noteEl = ov;
  }

  closeNote() {
    if (!this.noteOpen) return;
    this.noteOpen = false;
    this.noteEl?.remove();
    this.noteEl = null;
  }

  // ─────────────────────────────────────────────────────────── messages ──

  toast(kind, text) {
    const d = document.createElement('div');
    d.className = `toast ${kind}`;
    d.textContent = text;
    this.el.toasts.appendChild(d);
    this.toastList.push({ el: d, t: 0 });
    while (this.toastList.length > 6) {
      const old = this.toastList.shift();
      old.el.remove();
    }
  }

  subtitle(text, time = 5) {
    this.el.subtitle.textContent = text;
    this.el.subtitle.classList.add('show');
    this.subtitleTimer = time;
  }

  // ──────────────────────────────────────────────────────── interaction ──

  setPrompt(text, key = 'E') {
    if (!text) {
      this.el.interact.classList.add('hidden');
      return;
    }
    this.el.interact.classList.remove('hidden');
    this.el.interact.querySelector('.key').textContent = key;
    this.el.interactText.textContent = text;
  }

  setSearchProgress(p) {
    if (p === null || p === undefined) {
      this.el.searchWrap.classList.add('hidden');
      return;
    }
    this.el.searchWrap.classList.remove('hidden');
    this.el.searchFill.style.width = `${Math.round(clamp01(p) * 100)}%`;
  }

  // ────────────────────────────────────────────────────────── inventory ──

  get inventoryOpen() {
    return !this.el.inventory.classList.contains('hidden');
  }

  openInventory() {
    this.el.inventory.classList.remove('hidden');
    this._lastInvSig = '';
    this.renderInventory();
  }

  closeInventory() {
    this.el.inventory.classList.add('hidden');
  }

  toggleInventory() {
    if (this.inventoryOpen) this.closeInventory();
    else this.openInventory();
    return this.inventoryOpen;
  }

  renderInventory() {
    const inv = this.game.inventory;
    const sv = this.game.survival;
    const sig =
      inv.slots.map((s) => s.id + s.count + (s.cond === undefined ? '' : s.cond.toFixed(2))).join('|') +
      '#' + inv.equipped + '#' + this.selectedSlot;
    if (sig === this._lastInvSig) return;
    this._lastInvSig = sig;

    const grid = this.el.invGrid;
    grid.innerHTML = '';

    const total = Math.max(inv.maxSlots, inv.slots.length);
    for (let i = 0; i < total; i++) {
      const slot = inv.slots[i];
      const d = document.createElement('div');
      if (!slot) {
        d.className = 'inv-slot empty';
        grid.appendChild(d);
        continue;
      }
      const def = ITEMS[slot.id];
      const equipped = def.type === ItemType.WEAPON && inv.equipped === def.weapon;
      d.className = `inv-slot${this.selectedSlot === i ? ' sel' : ''}${equipped ? ' equipped' : ''}`;
      d.innerHTML = `
        <span class="num">${i < 9 ? i + 1 : ''}</span>
        <span class="qty">${slot.count > 1 ? '×' + slot.count : ''}</span>
        <div class="ico">${def.icon}</div>
        <div class="nm">${def.short}</div>`;
      d.onclick = () => {
        this.selectedSlot = i;
        this._lastInvSig = '';
        this.renderInventory();
      };
      d.ondblclick = () => this.game.useSlot(i);
      grid.appendChild(d);
    }

    // Detail panel
    const sel = inv.slots[this.selectedSlot];
    if (!sel) {
      this.el.invName.textContent = '—';
      this.el.invDesc.textContent = 'Nothing selected.';
      this.el.invStats.textContent = '';
      this.el.invActions.innerHTML = '';
    } else {
      const def = ITEMS[sel.id];
      this.el.invName.textContent = def.name;
      this.el.invDesc.textContent = def.desc;
      const bits = [];
      if (def.effects) {
        if (def.effects.health) bits.push(`+${def.effects.health} health`);
        if (def.effects.thirst) bits.push(`+${def.effects.thirst} thirst`);
        if (def.effects.hunger) bits.push(`+${def.effects.hunger} hunger`);
        if (def.effects.stamina) bits.push(`+${def.effects.stamina} stamina`);
        if (def.effects.stopBleed) bits.push('stops bleeding');
        if (def.effects.battery) bits.push('recharges torch');
      }
      if (def.type === ItemType.WEAPON) {
        const w = WEAPONS[def.weapon];
        if (w) {
          const cond = sel.cond ?? null;
          const tier = cond === null ? null : conditionTier(cond);
          bits.push(`${Math.round(w.damage * (tier ? tier.mul : 1))} damage`);
          bits.push(`${w.range.toFixed(1)}m reach`);
          if (!w.ranged) bits.push(`${w.stamina} stamina/swing`);
          if (w.knockdown) bits.push('knocks down');
          if (w.bleed) bits.push('causes bleeding');
          if (tier) bits.push(`condition: ${tier.name}`);
        }
      }
      if (def.repairs) bits.push('repairs one condition tier');
      bits.push(`${def.weight.toFixed(1)} kg each`);
      this.el.invStats.innerHTML = bits.join('<br>');

      const acts = [];
      if (def.type === ItemType.WEAPON) {
        acts.push({ label: 'EQUIP', fn: () => this.game.equipSlot(this.selectedSlot) });
      } else if (def.repairs) {
        acts.push({ label: 'REPAIR', fn: () => this.game.useSlot(this.selectedSlot) });
      } else if (def.type === ItemType.CONSUMABLE || def.effects) {
        acts.push({ label: (def.useVerb || 'USE').toUpperCase(), fn: () => this.game.useSlot(this.selectedSlot) });
      }
      acts.push({ label: 'DROP', fn: () => this.game.dropSlot(this.selectedSlot) });
      this.el.invActions.innerHTML = '';
      for (const a of acts) {
        const b = document.createElement('button');
        b.className = 'inv-btn';
        b.textContent = a.label;
        b.onclick = a.fn;
        this.el.invActions.appendChild(b);
      }
    }

    this.el.invHp.textContent = Math.round(sv.health);
    this.el.invTh.textContent = Math.round(sv.thirst);
    this.el.invHu.textContent = Math.round(sv.hunger);
    this.el.invWt.textContent = `${inv.weight.toFixed(1)}/${inv.maxWeight}`;
  }

  // ───────────────────────────────────────────────────────────── update ──

  update(dt, s) {
    const el = this.el;

    // objective
    el.objText.textContent = s.objectiveTitle;
    el.objSub.textContent = s.objectiveSub;

    // clock
    el.clockTime.textContent = s.clock;
    el.clockPhase.textContent = s.phase;
    el.clockPanel.classList.toggle('night', s.night);

    // vitals
    const sv = s.survival;
    this._setBar(el.barHealth, sv.health / sv.maxHealth, 0.3);
    this._setBar(el.barStamina, sv.stamina / sv.maxStamina, 0.2);
    this._setBar(el.barThirst, sv.thirst / 100, 0.25);
    this._setBar(el.barHunger, sv.hunger / 100, 0.25);
    el.vitals.classList.toggle('exhausted', sv.exhausted);

    // weapon
    const w = s.weapon;
    el.weaponName.textContent = w.name.toUpperCase();
    el.weaponSub.textContent = w.sub;
    if (w.ranged) {
      el.ammoLine.classList.remove('hidden');
      el.ammoLine.classList.toggle('loading', !!s.reloading);
      el.ammoCount.textContent = s.reloading
        ? `${s.chamber} / ${s.reserveAmmo} · loading`
        : `${s.chamber} / ${s.reserveAmmo}`;
    } else {
      el.ammoLine.classList.add('hidden');
    }

    this._renderCondition(s);
    this._renderReticle(s);

    // damage flash + night tint
    el.damage.style.opacity = String(Math.min(0.9, sv.damageFlash));
    el.nightTint.style.opacity = String(s.nightTint);

    // noise
    el.noiseFill.style.width = `${Math.round(s.noise * 100)}%`;

    /**
     * The eye. It carries the highest awareness any single zombie currently
     * has of you, which is the only number that matters when you are sneaking:
     * you are not caught by the average of the street, you are caught by one
     * of them. Below the floor it hides completely so it never nags.
     */
    const eye = clamp01(s.awareness || 0);
    const showEye = eye > CFG.stealth.eyeFloor || !!s.hiddenIn;
    el.stealthEye.classList.toggle('on', showEye);
    el.stealthEye.classList.toggle('alarm', eye >= 0.98);
    el.stealthEye.classList.toggle('hidden-in', !!s.hiddenIn);
    if (showEye) {
      // The fill rises from the bottom of the eye as attention gathers.
      el.eyeFill.setAttribute('y', String(24 - 24 * eye));
    }

    // status chips
    this._renderStatus(sv, s);

    // toasts
    for (let i = this.toastList.length - 1; i >= 0; i--) {
      const t = this.toastList[i];
      t.t += dt;
      if (t.t > 4.0) t.el.classList.add('fade');
      if (t.t > 4.6) {
        t.el.remove();
        this.toastList.splice(i, 1);
      }
    }

    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) el.subtitle.classList.remove('show');
    }

    this._renderThreat(s);

    if (this.inventoryOpen) this.renderInventory();
  }

  /**
   * Three pips for three condition bands, plus the word.
   *
   * Deliberately not a continuous bar: the damage multiplier is banded, so a
   * bar would imply a precision the rules do not have and would hide the only
   * thing worth knowing, which is whether you are about to drop a tier.
   */
  _renderCondition(s) {
    const el = this.el;
    if (s.condition === null || s.condition === undefined) {
      el.weaponCond.classList.add('hidden');
      this._condSig = null;
      return;
    }
    const tier = conditionTier(s.condition);
    const lit = CFG.durability.tiers.length - CFG.durability.tiers.indexOf(tier);
    const sig = `${tier.name}|${lit}`;
    if (sig === this._condSig) return;
    this._condSig = sig;

    el.weaponCond.classList.remove('hidden');
    el.weaponCond.className = tier.name;
    for (let i = 0; i < el.condPips.length; i++) {
      el.condPips[i].classList.toggle('on', i < lit);
    }
    el.condWord.textContent = tier.name;
  }

  /**
   * The aiming reticle opens up with the sway, so how badly your hands are
   * shaking is something you can see before you pull the trigger rather than
   * something you learn from the miss.
   */
  _renderReticle(s) {
    const el = this.el;
    const on = !!s.aiming;
    el.adsReticle.classList.toggle('hidden', !on);
    el.reticle.style.opacity = on ? '0' : '0.5';
    if (!on) return;

    const sway = s.aimSway || { yaw: 0, pitch: 0 };
    // Radians of wobble → pixels of gap, at roughly the screen's own scale.
    const px = window.innerHeight / (2 * Math.tan((CFG.camera.fov * Math.PI) / 360));
    const gap = 5 + Math.min(46, Math.abs(sway.yaw) * px * 2.6);
    const ox = -sway.yaw * px;
    const oy = sway.pitch * px;
    el.adsReticle.style.transform = `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px)`;
    el.adsReticle.querySelector('.t').style.top = `${-gap - 7}px`;
    el.adsReticle.querySelector('.b').style.top = `${gap}px`;
    el.adsReticle.querySelector('.l').style.left = `${-gap - 7}px`;
    el.adsReticle.querySelector('.r').style.left = `${gap}px`;
  }

  _setBar(node, frac, lowAt) {
    const f = clamp01(frac);
    node.style.transform = `scaleX(${f})`;
    node.classList.toggle('low', f < lowAt);
  }

  _renderStatus(sv, s) {
    const chips = [];
    if (sv.bleeding > 0) chips.push(['', 'BLEEDING']);
    if (sv.exhausted) chips.push(['warn', 'EXHAUSTED']);
    if (sv.thirst < 25) chips.push(['warn', sv.thirst <= 0 ? 'DEHYDRATED' : 'THIRSTY']);
    if (sv.hunger < 25) chips.push(['warn', sv.hunger <= 0 ? 'STARVING' : 'HUNGRY']);
    if (sv.painkiller > 0) chips.push(['good', 'PAINKILLERS']);
    if (s.flashlightOn) chips.push(['good', `TORCH ${Math.ceil(s.battery)}s`]);
    if (s.indoors) chips.push(['good', 'INDOORS']);
    if (s.barricaded) chips.push(['good', 'DOOR BOARDED']);
    if (s.crouching) chips.push(['', s.concealed ? 'HIDDEN · CROUCHED' : 'CROUCHED']);
    if (s.hiddenIn) chips.push(['good', s.hiddenIn.toUpperCase()]);

    const sig = chips.map((c) => c[1]).join('|');
    if (sig === this._statusSig) return;
    this._statusSig = sig;
    this.el.status.innerHTML = '';
    for (const [cls, text] of chips) {
      const d = document.createElement('div');
      d.className = `status-chip ${cls}`;
      d.textContent = text;
      this.el.status.appendChild(d);
    }
  }

  /** Directional wedges for zombies actively hunting you but off-screen. */
  _renderThreat(s) {
    const list = s.threats || [];
    const layer = this.el.threatLayer;
    while (this.threatArrows.length < list.length) {
      const d = document.createElement('div');
      d.className = 'threat-arrow';
      d.innerHTML = '<i></i>';
      layer.appendChild(d);
      this.threatArrows.push(d);
    }
    for (let i = 0; i < this.threatArrows.length; i++) {
      const a = this.threatArrows[i];
      const t = list[i];
      if (!t) {
        a.style.display = 'none';
        continue;
      }
      a.style.display = 'block';
      const r = Math.min(window.innerWidth, window.innerHeight) * 0.31;
      a.style.transform = `rotate(${t.angle}rad) translate(0px, ${-r}px)`;
      a.style.opacity = String(t.strength);
    }
  }
}
