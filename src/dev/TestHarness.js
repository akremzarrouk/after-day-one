/**
 * TestHarness.js — dev-only automation hooks (loaded only with `?headless`).
 *
 * Lets the game be driven and inspected without a human at the keyboard:
 * synthetic input, teleporting, framebuffer capture and a compact state dump.
 * Nothing here is imported by the normal build.
 */

export function installHarness(game) {
  const errs = [];
  const origError = console.error.bind(console);
  console.error = (...a) => {
    errs.push(a.map(String).join(' '));
    origError(...a);
  };
  window.addEventListener('error', (e) => errs.push('uncaught: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => errs.push('rejection: ' + e.reason));

  const H = {
    game,
    errs,

    /**
     * Render one frame and POST it to the dev server's /__shot endpoint.
     *
     * The debug overlay lives on its own 2D canvas above the WebGL one, so a
     * plain `toDataURL` on the renderer misses it entirely. When the overlay
     * is up the two are composited into a scratch canvas first — otherwise
     * every screenshot of the AI tooling would be a screenshot of the game
     * with the tooling invisible.
     */
    async shot(name) {
      game._render(0.016);
      const gl = game.renderer.domElement;
      let data;
      const ov = game.debugOverlay;
      if (ov && ov.on) {
        const c = H._shotCanvas || (H._shotCanvas = document.createElement('canvas'));
        c.width = gl.width;
        c.height = gl.height;
        const cx = c.getContext('2d');
        cx.drawImage(gl, 0, 0);
        cx.drawImage(ov.canvas, 0, 0, c.width, c.height);
        data = c.toDataURL('image/png');
      } else {
        data = gl.toDataURL('image/png');
      }
      const r = await fetch('/__shot', {
        method: 'POST',
        body: JSON.stringify({ name, data }),
      });
      return (await r.json()).file;
    },

    hold(code) {
      game.input.keys.add(code);
    },
    release(code) {
      game.input.keys.delete(code);
    },
    tap(code) {
      game.input.keys.add(code);
      game.input.pressedKeys.add(code);
      setTimeout(() => game.input.keys.delete(code), 90);
    },
    attack() {
      game.input.mouse.left = true;
      game.input.mousePressed.left = true;
      setTimeout(() => (game.input.mouse.left = false), 60);
    },
    block(on = true) {
      game.input.mouse.right = on;
    },
    look(dx, dy = 0) {
      game.input.mouse.dx += dx;
      game.input.mouse.dy += dy;
    },
    wait(ms) {
      return new Promise((r) => setTimeout(r, ms));
    },
    tp(x, z) {
      game.player.pos.set(x, 0, z);
      game.player.vel.set(0, 0, 0);
      game.cameraRig._initialised = false;
    },
    setHour(h, paused = true) {
      game.time.hour = h;
      game.time.paused = paused;
    },
    give(id, n = 1) {
      return game.giveItem(id, n);
    },

    /** Pretend the pointer is locked and begin play. */
    begin() {
      Object.defineProperty(game.input, 'locked', {
        value: true,
        writable: true,
        configurable: true,
      });
      if (game.state === 'title') game.startGame();
      return H.state();
    },

    state() {
      const p = game.player;
      const s = game.survival;
      return {
        st: game.state,
        pos: [+p.pos.x.toFixed(1), +p.pos.y.toFixed(2), +p.pos.z.toFixed(1)],
        yaw: +p.yaw.toFixed(2),
        spd: +p.speed.toFixed(2),
        pstate: p.state,
        grounded: p.grounded,
        hp: +s.health.toFixed(1),
        stam: +s.stamina.toFixed(0),
        thirst: +s.thirst.toFixed(0),
        hunger: +s.hunger.toFixed(0),
        bleed: +s.bleeding.toFixed(2),
        hour: +game.time.hour.toFixed(2),
        light: +game.time.lightLevel.toFixed(2),
        zombies: game.horde.zombies.length,
        chasing: game.horde.countChasing(),
        kills: game.horde.killCount,
        inv: game.inventory.slots.map((x) => x.id + ':' + x.count),
        weapon: game.inventory.equipped,
        goal: game.objectives.goal,
        supplies: game.objectives.suppliesFound,
        day: game.run.day,
        rphase: game.run.phase,
        rstate: game.run.state,
        errs: errs.length,
        lastErr: errs[errs.length - 1] || null,
      };
    },

    // ──────────────────────────────────────────── animation staging ──
    // Enough control to photograph a specific pose without a human at the
    // keyboard: stop the simulation, put a character in a known state, step
    // only the animation, shoot.

    /** Suspend the whole simulation. Rendering keeps working. */
    freeze(on = true) {
      if (on && !H._frozenUpdate) {
        H._frozenUpdate = game._update.bind(game);
        game._update = () => {};
      } else if (!on && H._frozenUpdate) {
        game._update = H._frozenUpdate;
        H._frozenUpdate = null;
        game.clock.getDelta();
      }
      return !!H._frozenUpdate;
    },

    clearZombies() {
      for (const z of [...game.horde.zombies]) z.dispose();
      for (const c of [...game.horde.corpses]) c.dispose();
      game.horde.zombies.length = 0;
      game.horde.corpses.length = 0;
      game.horde._attackers.clear();
    },

    /** Spawn one zombie at an offset from the player, facing them. */
    place(type, dx, dz) {
      const p = game.player.pos;
      const z = game.horde.spawn(p.x + dx, p.z + dz, type, 'staged');
      if (z) {
        z.yaw = Math.atan2(p.x - z.pos.x, p.z - z.pos.z);
        z.rig.place(z.pos.x, z.pos.y, z.pos.z, z.yaw);
      }
      return z;
    },

    /**
     * Drive one animation controller directly for `seconds`, at a fixed step.
     * Only meaningful while frozen.
     */
    stepAnim(target, state, seconds = 0.6, speed = 0) {
      const anim = target.anim;
      anim.request(state);
      const dt = 1 / 60;
      for (let i = 0; i < Math.round(seconds / dt); i++) anim.update(dt, { speed, distance: 0 });
      return anim.state;
    },

    /** Fire a one-shot and step to a chosen point inside it. */
    stepAttack(target, kind, windup, total, at = 1.0) {
      target.anim.attack(kind, windup, total);
      const dt = 1 / 60;
      for (let i = 0; i < Math.round((total * at) / dt); i++) {
        target.anim.update(dt, { speed: 0, distance: 0 });
      }
      return target.anim.busy;
    },

    /**
     * Photograph the whole animation-state matrix — every player state, every
     * zombie archetype in every state, the palette variants, a silhouette test
     * at 30 m and a crowd shot. Writes into `.shots/`.
     */
    async captureAll(opts = {}) {
      const m = await import('./AnimShots.js');
      return m.captureAll(H, opts);
    },

    /**
     * Run the doors/stealth scenario suite: crouch past, sprint past, door
     * siege, boarded door, window vault, hiding seen and unseen, a thrown
     * bottle, and the full objective chain. Screenshots land in `.shots/`.
     */
    async stealthTests(opts = {}) {
      const m = await import('./StealthTests.js');
      return m.runAll(H, opts);
    },

    /**
     * Run the combat duel suite: TTK for every weapon against every archetype,
     * hit zones, cripple → crawler, knockdown → finisher, the durability
     * lifecycle, a molotov with frame timing, dodge spacing and shove
     * interrupts. Screenshots land in `.shots/`.
     */
    async combatTests(opts = {}) {
      const m = await import('./CombatTests.js');
      return m.runAll(H, opts);
    },

    /**
     * Run the AI suite: screamer telegraph and kill-cancel, convergence,
     * runner lunge recovery, brute door rate and block-break, torch
     * investigation, corpse lingering, doorway queueing, director phases,
     * the migration route, day-one gating, and a 60-zombie soak.
     */
    async aiTests(opts = {}) {
      const m = await import('./AITests.js');
      return m.runAll(H, opts);
    },

    /**
     * Run the metagame suite: the per-night escalation curves, secure-sleep
     * gating, the nailboard's life and death, an alarm bearing, the
     * generator's noise-for-light trade, the radio's four fragments, the
     * economy table against the real loot tables, a save/reload round trip,
     * a full five-day run at ninety times speed with a shot at every dawn,
     * the extraction, and a deliberate death. Screenshots land in `.shots/`.
     */
    async metaTests(opts = {}) {
      const m = await import('./MetaTests.js');
      return m.runAll(H, opts);
    },

    /** Where the run is, in one line. */
    run() {
      const r = game.run;
      return {
        day: r.day,
        phase: r.phase,
        night: r.night,
        state: r.state,
        curve: r.curve,
        shelter: r.shelter?.id || null,
        blackout: +r.blackout.toFixed(2),
        convoy: r.extractionOpen ? 'open' : r.convoyGone ? 'gone' : 'not yet',
        radio: { pending: game.radio.pending, heard: [...game.radio.heard] },
        slept: r.slept,
        stats: r.stats,
      };
    },

    /**
     * What is left on the map, and what it is worth. `richness` is searches
     * remaining; `supply` is the expected supply value of rolling everything
     * that is left at today's luck.
     */
    async economy() {
      const { expectedSupply } = await import('../systems/Items.js');
      const CFG = (await import('../core/Config.js')).default;
      const day = game.run.day;
      const luck = CFG.loot.luckPerDay[Math.min(day, CFG.loot.luckPerDay.length) - 1];
      const cont = game.world.interactables.filter((i) => i.type === 'container');
      let left = 0;
      let supply = 0;
      for (const it of cont) {
        left += it.richness;
        supply += expectedSupply(it.table, it.thin ? luck * CFG.economy.restockLuck : luck) * it.richness;
      }
      return {
        day,
        luck,
        containers: cont.length,
        emptied: cont.filter((i) => i.richness <= 0).length,
        searchesLeft: left,
        expectedSupplies: +supply.toFixed(1),
        dayCost: +(
          (CFG.survival.thirstPerHour * 24) / 42 + (CFG.survival.hungerPerHour * 24) / 46
        ).toFixed(2),
        claimed: CFG.economy.expectedPerDay.find((r) => r.day === day) || null,
      };
    },

    /** What you have built, and how much of it is left. */
    base() {
      const b = game.base;
      return {
        devices: b.devices.map((d) => ({ kind: d.kind, uses: d.uses, at: [+d.x.toFixed(1), +d.z.toFixed(1)] })),
        generator: b.generator ? { running: b.generator.running, fuel: Math.round(b.generator.fuel) } : null,
        stashes: [...b.stashes.values()].map((s) => ({
          id: s.shelterId,
          weight: +s.weight.toFixed(1),
          slots: s.slots.map((x) => `${x.id}:${x.count}`),
        })),
        openings: game.world.shelters.map((sh) => ({
          id: sh.id,
          state: sh.openings.map((o) => `${o.isDoor ? 'D' : 'W'}:${o.state}${o.tier >= 0 ? '/' + o.tier : ''}`),
        })),
      };
    },

    /** Director state, for watching the pacing curve from the console. */
    director() {
      const h = game.horde;
      return {
        phase: h.phase,
        phaseTime: +h.phaseTime.toFixed(1),
        pressure: +h.pressure.toFixed(2),
        alive: h.zombies.length,
        waveLeft: h.waveLeft,
        migration: h.migration.state,
        siege: h.siegeEvent.state,
        huntsLeft: h.hunt.left,
        grace: game.run.inGrace,
        lod: h.zombies.filter((z) => z._lodSkip).length,
        navQueue: game.world.nav.queue.length,
        navDropped: game.world.nav.dropped,
        events: h.events.slice(-6),
      };
    },

    /** Population by archetype. */
    census() {
      const c = {};
      for (const z of game.horde.zombies) {
        if (z.isDead) continue;
        c[z.type] = (c[z.type] || 0) + 1;
      }
      return c;
    },

    /** Show or hide the AI debug overlay. */
    overlay(on = true) {
      return game.debugOverlay ? game.debugOverlay.toggle(on) : false;
    },

    /** Just the TTK grid, for retuning a weapon without the full suite. */
    async ttk() {
      const m = await import('./CombatTests.js');
      return m.ttkOnly(H);
    },

    /** What is in your hand and how worn it is. */
    weapon() {
      const inv = game.inventory;
      return {
        id: inv.equipped,
        cond: inv.equippedCondition,
        mul: inv.equippedDamageMul,
        chamber: game.player.chamber,
        reloading: !!game.player.reloading,
      };
    },

    /** Wounds across the whole street — cripples, crawlers, downed, burning. */
    wounds() {
      const w = { crippled: 0, crawling: 0, down: 0, fleeing: 0, bleeding: 0 };
      for (const z of game.horde.zombies) {
        if (z.isDead) continue;
        if (z.cripples > 0) w.crippled++;
        if (z.crawling) w.crawling++;
        if (z.state === 'down') w.down++;
        if (z.state === 'flee') w.fleeing++;
        if (z.bleedStacks > 0) w.bleeding++;
      }
      w.fires = game.fire.burning;
      w.decals = game.decals.count;
      return w;
    },

    /** Zombie state histogram — used to verify the AI actually transitions. */
    zstates() {
      const h = {};
      for (const z of game.horde.zombies) h[z.state] = (h[z.state] || 0) + 1;
      return h;
    },

    nearestZombie() {
      let best = null,
        bd = Infinity;
      for (const z of game.horde.zombies) {
        if (z.isDead) continue;
        const d = Math.hypot(z.pos.x - game.player.pos.x, z.pos.z - game.player.pos.z);
        if (d < bd) {
          bd = d;
          best = z;
        }
      }
      return best
        ? {
            d: +bd.toFixed(2),
            type: best.type,
            state: best.state,
            hp: +best.hp.toFixed(0),
            aware: +best.awareness.toFixed(2),
            pos: [+best.pos.x.toFixed(1), +best.pos.z.toFixed(1)],
          }
        : null;
    },
  };

  window.__H = H;
  return H;
}
