/**
 * Base.js — everything you can build, and everything it costs you.
 *
 * The fortification tiers live on the `Opening` itself, because a boarded door
 * is a door. What lives here is the kit that is *not* part of the building:
 * the two traps, the stash, and the generator that lights the yard and tells
 * the whole street where you are while it does it.
 *
 * The rule the whole file is written to: nothing here is free, and nothing
 * here is a menu. A nailboard is a plank in a doorway you chose, an alarm is a
 * bearing on the HUD and nothing else, and the generator is a decision you
 * un-make by walking outside and pulling the cord.
 */

import * as THREE from 'three';
import CFG from '../core/Config.js';
import { ITEMS } from './Items.js';

// ────────────────────────────────────────────────────────────────── stash ──

/**
 * A box in a corner of a room you have decided is yours.
 *
 * Deliberately the same shape as `Inventory` — slots of `{id, count, cond}`
 * with a weight cap — so moving something between the two is a remove and an
 * add and never a conversion. The cap is enormous compared to your pockets,
 * which is the entire point: carrying capacity finally has somewhere to put
 * the overflow, and that somewhere is a place you have to defend.
 */
export class Stash {
  constructor(shelterId, maxWeight = CFG.base.stash.maxWeight) {
    this.shelterId = shelterId;
    this.slots = [];
    this.maxWeight = maxWeight;
    this.maxSlots = CFG.base.stash.maxSlots;
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

  /** @returns number actually stored. */
  add(id, n = 1, cond = null) {
    const def = ITEMS[id];
    if (!def) return 0;
    let added = 0;
    while (n > 0) {
      if (this.weight + def.weight > this.maxWeight + 0.001) break;
      let slot = this.slots.find((s) => s.id === id && s.count < def.stack && s.cond === undefined);
      // Weapons carry condition, so they never merge with each other.
      if (cond !== null && cond !== undefined) slot = null;
      if (!slot) {
        if (this.slots.length >= this.maxSlots) break;
        slot = { id, count: 0 };
        if (cond !== null && cond !== undefined) slot.cond = cond;
        this.slots.push(slot);
      }
      slot.count++;
      n--;
      added++;
    }
    return added;
  }

  removeAtIndex(i, n = 1) {
    const s = this.slots[i];
    if (!s) return null;
    const take = Math.min(s.count, n);
    s.count -= take;
    const out = { id: s.id, count: take, cond: s.cond };
    if (s.count <= 0) this.slots.splice(i, 1);
    return out;
  }

  clear() {
    this.slots.length = 0;
  }

  serialize() {
    return { id: this.shelterId, slots: this.slots.map((s) => ({ ...s })) };
  }

  restore(data) {
    this.slots = (data?.slots || []).map((s) => ({ ...s }));
  }
}

// ────────────────────────────────────────────────────────────────── traps ──

/**
 * The nailboard.
 *
 * It does not kill anything and it is not supposed to. It takes a leg — which
 * turns a shambler in a doorway into a crawler in a doorway, and a crawler is
 * a thing you can step over and deal with when you have a free second. It
 * bends flat after six of them, and then it is a plank again.
 */
class Nailboard {
  constructor(x, z, yaw, group) {
    this.kind = 'nailboard';
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.uses = CFG.base.nailboard.uses;
    this.rearm = 0;
    this.group = group;
    this.hitThisFrame = null;
  }

  get spent() {
    return this.uses <= 0;
  }

  label() {
    return `Nailboard · ${this.uses}/${CFG.base.nailboard.uses}`;
  }

  update(dt, ctx) {
    const N = CFG.base.nailboard;
    if (this.rearm > 0) this.rearm -= dt;
    if (this.spent || this.rearm > 0) return null;

    for (const z of ctx.horde.zombies) {
      if (z.isDead) continue;
      const d = Math.hypot(z.pos.x - this.x, z.pos.z - this.z);
      if (d > N.radius + z.radius * 0.5) continue;

      /**
       * Aimed at the legs specifically, which is what makes the cripple happen
       * through the ordinary damage path rather than as a special case — the
       * same rule that says a hit to the knees takes 40% of its speed.
       */
      const killed = z.takeDamage(N.damage, this.x, this.z, {
        zone: 'legs',
        knockback: 0.6,
        canCripple: N.cripple,
      });
      this.uses--;
      this.rearm = N.rearmTime;
      ctx.noise.emit(this.x, this.z, N.noise, 'world', 'trap');
      ctx.audio.impact('hit_metal', this.x, this.z);
      this._wear();
      return { kind: 'nailboard', x: this.x, z: this.z, spent: this.spent, killed: !!killed };
    }
    return null;
  }

  /** Boards bend, then they lie flat, then they are not a trap any more. */
  _wear() {
    const f = Math.max(0, this.uses / CFG.base.nailboard.uses);
    for (const c of this.group.children) {
      if (!c.userData.nail) continue;
      c.rotation.x = (1 - f) * 1.1 * (c.userData.nail % 2 ? 1 : -1);
      c.position.y = 0.06 + f * 0.06;
    }
    this.group.visible = this.uses > 0;
  }
}

/**
 * Alarm cans.
 *
 * String across a gap with three cans hanging off it. It is not a weapon and
 * it is not a wall — it is a bearing, printed on the HUD, six seconds before
 * you would otherwise have known. The cost is that it is also a noise, so
 * anything that was ambling past now has a reason to come and look.
 */
class AlarmCans {
  constructor(x, z, yaw, group) {
    this.kind = 'alarm';
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.uses = CFG.base.alarm.uses;
    this.cooldown = 0;
    this.group = group;
  }

  get spent() {
    return this.uses <= 0;
  }

  label() {
    return `Alarm cans · ${this.uses}/${CFG.base.alarm.uses}`;
  }

  update(dt, ctx) {
    const A = CFG.base.alarm;
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.spent || this.cooldown > 0) return null;

    let trigger = null;
    let best = Infinity;
    for (const z of ctx.horde.zombies) {
      if (z.isDead) continue;
      const d = Math.hypot(z.pos.x - this.x, z.pos.z - this.z);
      if (d > A.radius) continue;
      if (d < best) {
        best = d;
        trigger = z;
      }
    }
    if (!trigger) return null;

    this.uses--;
    this.cooldown = A.cooldown;
    // The clatter itself is played by whoever handles the event, so the
    // bearing on the HUD and the sound in the room arrive together.
    ctx.noise.emit(this.x, this.z, A.noise, 'world', 'alarm');
    this.group.visible = this.uses > 0;
    return {
      kind: 'alarm',
      x: this.x,
      z: this.z,
      // The bearing is from the *player*, not from the wire: what the HUD is
      // answering is "which way do I look", not "where is my string".
      fromX: trigger.pos.x,
      fromZ: trigger.pos.z,
      spent: this.spent,
    };
  }
}

// ────────────────────────────────────────────────────────────── generator ──

/**
 * The generator, and the two floodlights on the yard.
 *
 * The classic trade, made literal: while it runs you can see the whole
 * approach and nothing can sneak up the drive, and while it runs there is a
 * 26 m noise event every half second telling everything in the neighbourhood
 * which house is the interesting one. Fuel is the timer on the decision.
 */
class Generator {
  constructor(spec) {
    this.x = spec.x;
    this.z = spec.z;
    this.lights = spec.lights || [];
    this.parent = spec.parent || null;
    this.mesh = spec.mesh || null;
    this.fuel = 0;
    this.running = false;
    this._noiseT = 0;
    this._shake = 0;
  }

  get fuelFrac() {
    return Math.min(1, this.fuel / CFG.base.generator.maxFuel);
  }

  refuel(seconds) {
    const before = this.fuel;
    this.fuel = Math.min(CFG.base.generator.maxFuel, this.fuel + seconds);
    return this.fuel - before;
  }

  start(ctx) {
    if (this.running || this.fuel <= 0) return false;
    this.running = true;
    ctx?.noise?.emit(this.x, this.z, CFG.base.generator.startNoise, 'world', 'generator');
    ctx?.audio?.impact('hit_metal', this.x, this.z);
    return true;
  }

  stop() {
    if (!this.running) return false;
    this.running = false;
    return true;
  }

  update(dt, ctx) {
    const G = CFG.base.generator;
    if (this.running) {
      this.fuel -= dt;
      if (this.fuel <= 0) {
        this.fuel = 0;
        this.running = false;
        return { kind: 'generator-dry', x: this.x, z: this.z };
      }

      /**
       * The noise floor. Emitted on a timer rather than every frame so it
       * costs the same at 30 fps as at 144, and fed straight into the
       * director's pressure meter as well — a running generator does not just
       * attract the ones nearby, it makes the whole night worse.
       */
      this._noiseT -= dt;
      if (this._noiseT <= 0) {
        this._noiseT = G.noiseInterval;
        ctx.noise.emit(this.x, this.z, G.noise, 'world', 'generator');
      }
      ctx.horde.pressure = Math.min(1.8, ctx.horde.pressure + G.pressure * dt);
    }

    /**
     * Lights ease rather than snap — a generator spinning up is a thing you
     * watch happen — and they only exist in the scene while there is a reason
     * for them to. A dark light still costs every material a shader slot, so
     * four of them idling for five days would be a tax on the whole run.
     */
    const target = this.running ? G.lightIntensity : 0;
    for (const l of this.lights) {
      if (this.running && !l.parent && this.parent) this.parent.add(l);
      l.intensity += (target - l.intensity) * Math.min(1, dt * 2.4);
      // A little wobble, because it is a petrol engine and not the grid.
      if (this.running) l.intensity *= 0.985 + Math.random() * 0.03;
      else if (l.parent && l.intensity < 0.5) {
        l.intensity = 0;
        l.parent.remove(l);
      }
    }
    if (this.mesh) this.mesh.visible = true;
    return null;
  }

  serialize() {
    return { fuel: +this.fuel.toFixed(1), running: this.running };
  }

  restore(s) {
    if (!s) return;
    this.fuel = s.fuel || 0;
    this.running = !!s.running && this.fuel > 0;
  }
}

// ─────────────────────────────────────────────────────────────────── base ──

export class Base {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.root = new THREE.Group();
    scene.add(this.root);

    this.devices = [];                 // traps + alarms, in build order
    this.stashes = new Map();          // shelter id → Stash
    this.generator = world.generator ? new Generator(world.generator) : null;
    this.events = [];
  }

  reset() {
    for (const d of this.devices) {
      this.root.remove(d.group);
      d.group.traverse?.((c) => {
        c.geometry?.dispose?.();
      });
    }
    this.devices.length = 0;
    for (const s of this.stashes.values()) s.clear();
    if (this.generator) {
      this.generator.fuel = 0;
      this.generator.running = false;
      for (const l of this.generator.lights) {
        l.intensity = 0;
        l.parent?.remove(l);
      }
    }
    this.events.length = 0;
  }

  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }

  stashFor(shelterId) {
    let s = this.stashes.get(shelterId);
    if (!s) this.stashes.set(shelterId, (s = new Stash(shelterId)));
    return s;
  }

  // ──────────────────────────────────────────────────────────── building ──

  /**
   * Can you afford it, and have you got a hand free?
   * @returns null when you can, or the name of the first thing you are short of.
   */
  missingFor(recipe, inventory) {
    for (const [id, n] of Object.entries(recipe)) {
      if (inventory.count(id) < n) return ITEMS[id]?.name || id;
    }
    return null;
  }

  spend(recipe, inventory) {
    for (const [id, n] of Object.entries(recipe)) inventory.remove(id, n);
  }

  /** Anything already built within `r` metres, so two do not stack. */
  deviceNear(x, z, r = 1.6, kind = null) {
    for (const d of this.devices) {
      if (kind && d.kind !== kind) continue;
      if (Math.hypot(d.x - x, d.z - z) <= r) return d;
    }
    return null;
  }

  build(kind, x, z, yaw = 0) {
    const group = kind === 'nailboard' ? this._nailboardMesh(x, z, yaw) : this._alarmMesh(x, z, yaw);
    this.root.add(group);
    const d = kind === 'nailboard' ? new Nailboard(x, z, yaw, group) : new AlarmCans(x, z, yaw, group);
    this.devices.push(d);
    return d;
  }

  _nailboardMesh(x, z, yaw) {
    const M = this.world.M;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.28), M.plank);
    plank.position.y = 0.035;
    plank.castShadow = true;
    plank.receiveShadow = true;
    g.add(plank);
    for (let i = 0; i < 7; i++) {
      const n = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.13, 5), M.metal);
      n.position.set(-0.6 + i * 0.2, 0.11, (i % 2 ? 0.06 : -0.06));
      n.userData.nail = i + 1;
      g.add(n);
    }
    return g;
  }

  _alarmMesh(x, z, yaw) {
    const M = this.world.M;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    const line = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.012, 0.012), M.rust);
    line.position.y = 0.42;
    g.add(line);
    for (let i = 0; i < 3; i++) {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.12, 8), M.metal);
      can.position.set(-0.7 + i * 0.7, 0.34, 0);
      can.castShadow = true;
      g.add(can);
    }
    return g;
  }

  // ────────────────────────────────────────────────────────────── update ──

  update(dt, ctx) {
    for (let i = this.devices.length - 1; i >= 0; i--) {
      const d = this.devices[i];
      const ev = d.update(dt, ctx);
      if (ev) this.events.push(ev);
      // A spent nailboard is scenery; a spent wire of cans is gone.
      if (d.spent && d.kind === 'alarm') {
        this.root.remove(d.group);
        this.devices.splice(i, 1);
      }
    }
    if (this.generator) {
      const ev = this.generator.update(dt, ctx);
      if (ev) this.events.push(ev);
    }
  }

  /**
   * Is anything the player built lighting the place up? Read by the
   * concealment test — you cannot crouch in the dark in your own floodlights.
   */
  get lightsOn() {
    return !!this.generator?.running;
  }

  // ─────────────────────────────────────────────────────── persistence ──

  serialize() {
    return {
      devices: this.devices.map((d) => ({
        kind: d.kind,
        x: +d.x.toFixed(2),
        z: +d.z.toFixed(2),
        yaw: +d.yaw.toFixed(3),
        uses: d.uses,
      })),
      stashes: [...this.stashes.values()].map((s) => s.serialize()),
      generator: this.generator?.serialize() || null,
    };
  }

  restore(data) {
    if (!data) return;
    this.reset();
    for (const d of data.devices || []) {
      const dev = this.build(d.kind, d.x, d.z, d.yaw);
      dev.uses = d.uses;
      if (dev.kind === 'nailboard') dev._wear();
      else dev.group.visible = dev.uses > 0;
    }
    for (const s of data.stashes || []) this.stashFor(s.id).restore(s);
    this.generator?.restore(data.generator);
  }
}
