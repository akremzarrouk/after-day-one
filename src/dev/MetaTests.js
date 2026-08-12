/**
 * MetaTests.js — dev-only scenario suite for the campaign layer
 * (loaded on demand by `H.metaTests()`).
 *
 * Same rules as the other suites: stage a real situation, run the real
 * simulation, assert on real state. Nothing is mocked, and every timing is
 * measured in *simulated* seconds accumulated inside the game loop, because a
 * hidden tab's timers are clamped and a wall-clock measurement taken there
 * describes the browser rather than the game.
 *
 * The last scenario is a full five-day run at ninety times speed, which is the
 * only test that can catch the things the metagame actually gets wrong:
 * a dawn that does not fire, a restock that empties the map, a radio that
 * runs out of fragments, a convoy that never arrives.
 */

import CFG from '../core/Config.js';
import * as Save from '../systems/Save.js';
import { expectedSupply, LOOT_TABLES } from '../systems/Items.js';

export async function runAll(H, opts = {}) {
  const results = [];
  const shots = [];
  const t = new Harness(H, opts, results, shots);

  await t.escalationCurves();
  await t.neverSealedIn();
  await t.guaranteedOnce();
  await t.dawnGrace();
  await t.secureSleep();
  await t.nailboard();
  await t.alarmCans();
  await t.generatorPressure();
  await t.radioSequence();
  await t.economyTable();
  await t.stashReload();
  await t.fullRun();
  await t.extraction();
  await t.permadeath();

  t.restore();
  const failed = results.filter((r) => !r.pass);
  return {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.map((f) => f.name),
    results,
    shots,
    errs: H.errs.slice(0, 8),
    errCount: H.errs.length,
  };
}

class Harness {
  constructor(H, opts, results, shots) {
    this.H = H;
    this.g = H.game;
    this.opts = opts;
    this.results = results;
    this.shots = shots;
    this._simT = 0;
    const g = this.g;
    this._origUpdate = g._update.bind(g);
    g._update = (dt) => {
      this._simT += dt;
      this._origUpdate(dt);
    };
  }

  restore() {
    this.g._update = this._origUpdate;
    this.g.time.timeScale = 1;
    this.g.time.paused = false;
    this.g.horde.siegeEvent.enabled = undefined;
    this.g.horde.migration.enabled = undefined;
  }

  get sim() {
    return this._simT;
  }

  /**
   * Drive the simulation directly, at a fixed step.
   *
   * The other suites lean on the game's own loop and `H.wait`, which is fine
   * for scenarios measured in seconds. This one has to run five in-game days,
   * and a hidden tab clamps its timers to once a second — so waiting on the
   * wall clock would put a full run at twelve real minutes. Stepping `_update`
   * ourselves is both faster and *more* honest: the step is fixed, so the
   * result does not depend on how busy the machine was.
   *
   * @param seconds   simulated seconds to advance
   * @param onStep    called after every step; return true to stop early
   */
  async step(seconds, { dt = 1 / 30, keepAlive = false, onStep = null } = {}) {
    const g = this.g;
    const n = Math.ceil(seconds / dt);
    for (let i = 0; i < n; i++) {
      g._update(dt);
      if (keepAlive) {
        g.survival.health = 100;
        g.survival.thirst = 90;
        g.survival.hunger = 90;
        g.survival.bleeding = 0;
        g.survival.dead = false;
      }
      if (onStep && onStep(i)) return;
      // Microtasks are not throttled the way timers are; a real yield every
      // thousand steps is enough to keep the page from being declared dead.
      if ((i & 63) === 0) await Promise.resolve();
      if ((i & 1023) === 0 && i > 0) await this.H.wait(0);
    }
  }

  record(name, pass, detail) {
    this.results.push({ name, pass, ...detail });
    return pass;
  }

  async shot(name) {
    if (this.opts.shots === false) return;
    this.shots.push(await this.H.shot('mt_' + name));
  }

  /**
   * A clean slate that is *not* a fresh run: the run state is reset but the
   * scenario is free to put the clock and the day wherever it needs them.
   */
  async reset({ day = 1, hour = 13, at = null, clear = true } = {}) {
    const { H, g } = this;
    H.freeze(false);
    if (clear) H.clearZombies();
    g.throwables.clear();
    if (g.player.hidden) g._exitHide();
    g._stopRest(null);
    g.survival.reset();
    g.player.state = 'normal';
    g.player.crouching = false;
    g.player.rig.reset();
    g.world.resetOpenings();
    g.world.resetContainers();
    g.base.reset();
    g.radio.reset();
    g.run.reset();
    g.run.day = day;
    g.run.phase = g.run.phaseFor(hour);
    g.time.hour = hour;
    g.time.timeScale = 1;
    g.time.paused = false;
    g.state = 'playing';
    const p = at || { x: -30, z: 42 };
    H.tp(p.x, p.z);
    g.cameraRig._initialised = false;
    await this.step(0.5);
  }

  /** The safehouse, or whichever shelter is asked for. */
  shelter(id = 'safehouse') {
    return this.g.world.shelterById(id);
  }

  // ─────────────────────────────────────────────────── 1 · escalation ──

  /**
   * The per-night curves are the whole promise of "each night is worse". They
   * are asserted two ways: the derived numbers the director will use, and the
   * archetype roll itself, run four hundred times a night so that "night one
   * has no specials" is a measurement rather than a reading of the table.
   */
  async escalationCurves() {
    const { g } = this;
    const rows = [];

    for (let n = 1; n <= CFG.nights.length; n++) {
      const curve = CFG.nights[n - 1];
      const ctx = {
        night: true,
        hour: 23,
        pastFirstDusk: true,
        curve,
        runDay: n,
        player: g.player,
      };
      g.horde.phase = 'build';

      const census = {};
      for (let i = 0; i < 400; i++) {
        const id = g.horde._pickType(ctx);
        census[id] = (census[id] || 0) + 1;
      }
      const specials = (census.runner || 0) + (census.screamer || 0) + (census.brute || 0);

      rows.push({
        night: n,
        target: Math.round(CFG.director.targetNight * curve.pop),
        waves: CFG.director.waveCountNight + curve.waveBonus,
        speed: +(CFG.zombie.nightSpeedMul * curve.speed).toFixed(3),
        specialPct: +((specials / 400) * 100).toFixed(1),
        hunts: curve.hunt,
        event: curve.event,
      });
    }

    const monotonic = rows.every(
      (r, i) => i === 0 || (r.target >= rows[i - 1].target && r.speed >= rows[i - 1].speed && r.waves >= rows[i - 1].waves)
    );
    const nightOneClean = rows[0].specialPct === 0;
    const laterHaveSpecials = rows.slice(1).every((r) => r.specialPct > 0);
    const growingSpecials = rows[4].specialPct > rows[1].specialPct;
    const antiAfk = rows.slice(1).every((r) => r.hunts >= 1);

    this.record(
      'a · night curves escalate, and night one rolls no specials at all',
      monotonic && nightOneClean && laterHaveSpecials && growingSpecials && antiAfk,
      { rows, monotonic, nightOneClean, laterHaveSpecials, growingSpecials, antiAfk }
    );
  }

  // ─────────────────────────────────────────── 1b · the locked room ──

  /**
   * You can always get back out of a building you sealed yourself into.
   *
   * This is a regression test for a real softlock: the safehouse ships with
   * four boarded windows, the day-one objective says to board the front door,
   * and doing exactly what you were told used to leave the building with no
   * passable, vaultable or climbable opening at all. It did not show in a
   * one-night slice because dawn was a win screen. It ends a five-day run in a
   * locked room.
   *
   * So the assertion is the invariant, not the fix: seal every shelter every
   * way it can be sealed, and check there is still a way out — and that taking
   * the boards off hands the materials back.
   */
  async neverSealedIn() {
    const { H, g } = this;
    await this.reset({ day: 2, hour: 14 });
    const rows = [];

    for (const shelter of g.world.shelters) {
      H.tp(shelter.centre.x, shelter.centre.z);
      await this.step(0.4);

      // Board absolutely everything, rebuilding smashed frames on the way.
      g.inventory.slots.length = 0;
      g.giveItem('planks', 20, true);
      for (const op of shelter.openings) {
        if (op.state === 'broken') op.repair();
        op.fortify(0);
      }
      const sealed = shelter.openings.every((o) => o.state === 'boarded');
      const wayOut = shelter.openings.filter((o) => o.playerPassable).length;

      /**
       * Prise each one off in turn, the way a trapped player would, and check
       * every single opening is on its own a sufficient exit — doors and
       * windows alike. Testing only the first would have passed on a window
       * while the door case stayed broken.
       */
      const each = [];
      for (const op of shelter.openings) {
        g.inventory.slots.length = 0;
        g._unboardOpening(op);
        each.push({
          kind: op.isDoor ? 'door' : 'window',
          side: op.side,
          refunded: g.inventory.count('planks') + g.inventory.count('metal_sheet'),
          opensAWayOut: op.playerPassable,
        });
        op.fortify(0);                       // seal it again for the next one
      }

      rows.push({
        shelter: shelter.id,
        openings: shelter.openings.length,
        sealedEverything: sealed,
        waysOutWhileSealed: wayOut,
        each,
      });
    }

    // Every shelter must be fully sealable (that is the point of boarding),
    // must have no way in while sealed, and every opening must be re-openable
    // from the inside without materials.
    const pass = rows.every(
      (r) =>
        r.sealedEverything &&
        r.waysOutWhileSealed === 0 &&
        r.each.every((e) => e.opensAWayOut && e.refunded === 1)
    );

    await this.shot('sealed_in');
    this.record('a2 · a shelter you sealed yourself into can always be opened again', pass, { rows });
  }

  // ────────────────────────────────────────── 1c · the guaranteed item ──

  /**
   * The suitcase by the spawn always holds a knife and the roadside toolbox
   * always holds a crowbar, so that the first ten minutes cannot be ruined by
   * dice. They must hold one *once* — the dawn restock makes an emptied
   * container un-`used` again, and keying the guarantee off that turned two
   * cupboards into a weapon dispenser, one free crowbar every morning for five
   * mornings.
   */
  async guaranteedOnce() {
    const { g } = this;
    await this.reset({ day: 1, hour: 13 });

    const box = g.world.interactables.find((it) => it.type === 'container' && it.guaranteed === 'crowbar');

    /**
     * What is asserted is the *guarantee firing*, not "a crowbar appeared" —
     * the roadside toolbox rolls the garage table, which has a crowbar in it
     * at weight 11, so a later search turning one up is the game working
     * rather than the bug. The bug was the guaranteed slot being handed out
     * again, and that is exactly what `first` reports.
     */
    const take = () => {
      const first = !box.looted;
      g.run.rollContainer(box, g.rng);
      return first;
    };

    const day1 = take();
    const emptied = box.richness <= 0;

    // Four dawns, forcing the restock to pick this box every time.
    const fired = [];
    for (let d = 2; d <= 5; d++) {
      g.run.day = d;
      box.richness = 1;
      box.thin = true;
      box.used = false;
      fired.push(take());
    }

    this.record(
      'a3 · a guaranteed item comes out of a container exactly once in a run',
      day1 && emptied && fired.every((x) => x === false),
      { guaranteeFiredOnFirstSearch: day1, emptiedAfter: emptied, firedAfterEachRestock: fired, looted: box.looted }
    );
  }

  // ────────────────────────────────────────────── 1d · the dawn grace ──

  /**
   * Dawn means dawn: nothing new arrives, and what is left goes home.
   *
   * The subtle failure this guards against is that "night" in this game is a
   * *light level*, and the light does not cross its threshold until about
   * 06:45 — so for the first forty-five minutes of a two-hour grace window,
   * every system that gates on `night` rather than on the phase was still
   * live. A hunting party forming up at 06:10 is not a bug you would ever
   * reproduce on purpose; it is one you would just occasionally lose a run to.
   *
   * So: park the run at the very start of the grace, on the worst night in the
   * game, and assert that nothing spawns and everything leaves.
   */
  async dawnGrace() {
    const { H, g } = this;
    await this.reset({ day: 5, hour: 6.02, at: { x: -30, z: 42 } });
    g.run.phase = 'dawn';

    // A street full of the night before, including something mid-approach.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const d = 12 + (i % 5) * 9;
      const z = g.horde.spawn(g.player.pos.x + Math.cos(a) * d, g.player.pos.z + Math.sin(a) * d, 'shambler', 'drifter');
      if (z) z.awareness = 1.0;
    }
    const started = g.horde.zombies.length;
    g.horde.hunt.left = 3;
    g.horde.hunt.timer = 0.1;
    g.horde.siegeEvent.state = 'idle';
    g.horde.siegeEvent.night = -1;

    let peak = started;
    let sawHunt = false;
    let sawSiege = false;
    let stillNight = false;

    // Run most of the grace window at speed.
    g.time.timeScale = 40;
    await this.step(28, {
      keepAlive: true,
      onStep: () => {
        peak = Math.max(peak, g.horde.zombies.length);
        if (g.horde.hunt.tele > 0) sawHunt = true;
        if (g.horde.siegeEvent.state !== 'idle') sawSiege = true;
        if (g.time.lightLevel < 0.34) stillNight = true;
        return g.run.phase !== 'dawn';
      },
    });
    g.time.timeScale = 1;

    const left = g.horde.zombies.length;
    const aware = g.horde.zombies.filter((z) => z.awareness > 0.3).length;
    const stuckOnEdge = g.horde.zombies.filter((z) => z.migrateTo && z.group !== 'migration').length;

    await this.shot('dawn_grace');
    this.record(
      'a4 · the dawn grace spawns nothing and sends the night home, light level notwithstanding',
      !sawHunt && !sawSiege && peak <= started && left < started && aware === 0 && stillNight,
      {
        started,
        peakDuringGrace: peak,
        leftAtEnd: left,
        stillAware: aware,
        huntFired: sawHunt,
        siegeFired: sawSiege,
        // Proof the window really did overlap the "it is still night" flag —
        // otherwise this test would pass for the wrong reason.
        overlappedNightFlag: stillNight,
        strandedOnMapEdge: stuckOnEdge,
      }
    );
  }

  // ──────────────────────────────────────────────── 2 · secure sleep ──

  /**
   * Sleeping is gated on three things and each of them is tested by breaking
   * it: a hole in the shelter, a door left open, and something awake nearby.
   */
  async secureSleep() {
    const { H, g } = this;
    await this.reset({ day: 2, hour: 21, at: { x: -30, z: 42 } });
    const sh = this.shelter('safehouse');
    const ctx = () => ({ world: g.world, horde: g.horde, player: g.player });

    // Everything shut: this is the baseline the rest is measured against.
    const clean = g.run.canSleep(ctx());

    // A window comes out.
    const win = sh.openings.find((o) => !o.isDoor);
    win.breakOpen();
    await this.step(0.3);
    const broken = g.run.canSleep(ctx());

    // Put it back, and open the front door instead.
    win.repair();
    win.fortify(0);
    const door = sh.openings.find((o) => o.isDoor);
    door.setState('open');
    await this.step(0.3);
    const ajar = g.run.canSleep(ctx());

    // Shut it, and stand something awake in the garden.
    door.setState('closed');
    const z = g.horde.spawn(g.player.pos.x + 12, g.player.pos.z, 'shambler', 'staged');
    z.awareness = 0.9;
    await this.step(0.3);
    const watched = g.run.canSleep(ctx());

    z.awareness = 0;
    H.clearZombies();
    await this.step(0.3);
    const finally_ = g.run.canSleep(ctx());

    await this.shot('secure_sleep');
    this.record(
      'b · sleep refuses a broken window, an open door and an audience',
      clean.ok && !broken.ok && !ajar.ok && !watched.ok && finally_.ok,
      {
        clean: clean.ok,
        broken: broken.reason,
        ajar: ajar.reason,
        watched: watched.reason,
        recovered: finally_.ok,
      }
    );
  }

  // ────────────────────────────────────────────────── 3 · the traps ──

  /**
   * The nailboard: it has to hurt, it has to take a leg, and it has to run
   * out. Six triggers is the whole life of one, and the seventh body walks
   * over a flat plank.
   */
  async nailboard() {
    const { H, g } = this;
    await this.reset({ day: 3, hour: 22, at: { x: -30, z: 42 } });
    const N = CFG.base.nailboard;

    g.inventory.slots.length = 0;
    g.giveItem('planks', 1, true);
    g.giveItem('nails', 1, true);

    // Stand in the safehouse doorway and lay one down.
    const door = this.shelter('safehouse').openings.find((o) => o.isDoor);
    H.tp(door.x - 1.0, door.z);
    await this.step(0.4);
    g._tryBuildTrap();
    const trap = g.base.devices.find((d) => d.kind === 'nailboard');
    const built = !!trap && !g.inventory.has('planks') && !g.inventory.has('nails');

    /**
     * And it has to be on *your* side of the doorway. A nailboard laid on the
     * far side of the wall is a nailboard the siege walks up to and stops in
     * front of — it never gets stepped on, and the player has no way to see
     * that the plank they spent is doing nothing.
     */
    const playerOutside = door.isOutside(g.player.pos.x, g.player.pos.z);
    const trapOutside = trap ? door.isOutside(trap.x, trap.z) : null;
    const rightSide = !!trap && trapOutside === playerOutside;

    // Feed it bodies, one at a time, and watch what comes off them.
    const hits = [];
    for (let i = 0; i < N.uses + 2 && trap; i++) {
      H.clearZombies();
      const z = g.horde.spawn(trap.x, trap.z, 'shambler', 'staged');
      if (!z) break;
      z.pos.x = trap.x;
      z.pos.z = trap.z;
      const before = z.hp;
      const usesBefore = trap.uses;
      trap.rearm = 0;
      await this.step(1.0, { onStep: () => trap.uses !== usesBefore });
      hits.push({
        used: trap.uses < usesBefore,
        dmg: +(before - z.hp).toFixed(1),
        cripples: z.cripples,
        left: trap.uses,
      });
      z.hp = 500;             // keep it upright so the next roll is clean
    }

    const landed = hits.filter((h) => h.used);
    const crippled = landed.filter((h) => h.cripples > 0).length;
    const ranOut = trap && trap.uses === 0 && hits.slice(-1)[0] && !hits.slice(-1)[0].used;

    await this.shot('nailboard');
    this.record(
      'c · the nailboard lands on your side of the doorway, cripples six, then stops',
      built && rightSide && landed.length === N.uses && crippled === landed.length && !!ranOut,
      {
        built,
        rightSide,
        playerOutside,
        trapOutside,
        triggers: landed.length,
        expected: N.uses,
        crippled,
        avgDamage: +(landed.reduce((a, h) => a + h.dmg, 0) / Math.max(1, landed.length)).toFixed(1),
        exhausted: !!ranOut,
      }
    );
  }

  /**
   * The alarm sells exactly one thing: a bearing, before you would otherwise
   * have known. So the assertion is about the bearing — that it points at the
   * body and not at the wire — plus the cooldown that stops it screaming.
   */
  async alarmCans() {
    const { H, g } = this;
    await this.reset({ day: 3, hour: 22, at: { x: -22, z: 42 } });
    const A = CFG.base.alarm;

    g.inventory.slots.length = 0;
    g.giveItem('tin_can', 2, true);
    g.giveItem('string', 1, true);
    g._tryBuildAlarm();
    const wire = g.base.devices.find((d) => d.kind === 'alarm');
    const built = !!wire && !g.inventory.has('string');

    g.hud.alarmPings.length = 0;
    // Something crosses it from due east of the player.
    const z = g.horde.spawn(wire.x + A.radius * 0.5, wire.z, 'shambler', 'staged');
    z.pos.x = wire.x + A.radius * 0.5;
    z.pos.z = wire.z;
    await this.step(1.2, { onStep: () => g.hud.alarmPings.length > 0 });
    const fired = g.hud.alarmPings.length > 0;
    // Stored as a *compass* bearing, resolved against the camera every frame —
    // a marker that stops pointing at the thing the moment you turn to look at
    // it is worse than no marker. atan2(dx, dz) due +x of the player is π/2.
    const bearing = fired ? g.hud.alarmPings[0].world : null;
    const bearingRight = fired && Math.abs(Math.abs(bearing) - Math.PI / 2) < 0.5;
    const usedOne = wire.uses === A.uses - 1;

    // A second body inside the cooldown must not produce a second ping.
    const pings = g.hud.alarmPings.length;
    await this.step(1.5);
    const quiet = g.hud.alarmPings.length === pings;

    await this.shot('alarm');
    this.record(
      'd · alarm cans give a bearing to the body, once, then hold their breath',
      built && fired && bearingRight && usedOne && quiet,
      { built, fired, bearing: bearing === null ? null : +bearing.toFixed(2), bearingRight, usesLeft: wire?.uses, quiet }
    );
  }

  // ─────────────────────────────────────────────── 4 · the generator ──

  /**
   * The trade has to be real or the generator is just a light switch. Two
   * fifteen-second windows, identical apart from the engine, measuring what
   * the director's pressure meter does — which is the number that decides how
   * soon the street crests.
   */
  async generatorPressure() {
    const { H, g } = this;
    await this.reset({ day: 2, hour: 22, at: { x: -30, z: 42 } });
    const gen = g.base.generator;
    g.horde.phase = 'build';

    const measure = async (seconds) => {
      g.horde.pressure = 0;
      let noiseEvents = 0;
      await this.step(seconds, {
        onStep: () => {
          if (g.noise.events.some((e) => e.kind === 'generator')) noiseEvents++;
          return false;
        },
      });
      return { pressure: +g.horde.pressure.toFixed(3), noiseEvents };
    };

    gen.stop();
    const off = await measure(12);

    gen.refuel(CFG.base.generator.fuelPerCan);
    gen.start({ noise: g.noise, audio: g.audio });
    const on = await measure(12);
    const litUp = g.world.floodLights.some((l) => l.intensity > 20);
    const notConcealed = !g.world.isConcealed(gen.x + 4, gen.z, 0.05, false);

    gen.stop();

    await this.shot('generator');
    this.record(
      'e · a running generator raises pressure, makes noise and kills your cover',
      on.pressure > off.pressure && on.noiseEvents > 0 && off.noiseEvents === 0 && litUp && notConcealed,
      { off, on, litUp, notConcealed, fuelLeft: Math.round(gen.fuel) }
    );
  }

  // ───────────────────────────────────────────────────── 5 · the radio ──

  /**
   * Four fragments, one a dawn, days two to five, in order, and each one only
   * once. The campaign has no other spine, so this is the test that decides
   * whether there is a campaign.
   */
  async radioSequence() {
    const { H, g } = this;
    await this.reset({ day: 1, hour: 7 });
    const seen = [];

    /**
     * The game drains the radio's events every frame on its way to the
     * subtitle, so counting them afterwards would always find nothing. Tap
     * `emit` instead: that is the thing being asserted — that four fragments
     * each put three lines of somebody's voice on the screen.
     */
    const spoken = [];
    const origEmit = g.radio.emit.bind(g.radio);
    g.radio.emit = (kind, text, big) => {
      if (big) spoken.push(text);
      origEmit(kind, text, big);
    };

    for (let day = 1; day <= 6; day++) {
      g.run.day = day;
      spoken.length = 0;
      const offered = g.radio.onDawn(day);
      if (!offered) {
        seen.push({ day, fragment: null });
        continue;
      }
      const started = g.radio.listen();
      await this.step(CFG.radio.playTime * 1.4, { onStep: () => !g.radio.playing });
      seen.push({
        day,
        fragment: g.radio.fragmentFor(day)?.title || null,
        started,
        lines: spoken.length,
        first: spoken[0] || null,
        hint: g.radio.hint(),
      });
    }
    g.radio.emit = origEmit;

    const heardDays = seen.filter((s) => s.fragment).map((s) => s.day);
    const correctDays = JSON.stringify(heardDays) === JSON.stringify([2, 3, 4, 5]);
    const allPlayed = seen.filter((s) => s.fragment).every((s) => s.started && s.lines >= 3);
    const noRepeats = g.radio.onDawn(5) === false;
    const knowsTheRoad = (g.radio.hint() || '').toLowerCase().includes('ridge');

    this.record(
      'f · the radio catches one fragment a dawn on days two to five, in order',
      correctDays && allPlayed && noRepeats && knowsTheRoad,
      { heardDays, correctDays, allPlayed, noRepeats, hint: g.radio.hint(), seen }
    );
  }

  // ─────────────────────────────────────────────────── 6 · the economy ──

  /**
   * The economy table in Config claims a number of supplies per day against a
   * cost per day. Both halves are computed here from the things that actually
   * produce them — the loot tables, the container list, and the survival
   * drain rates — so the table cannot quietly drift away from the game.
   */
  async economyTable() {
    const { g } = this;
    const E = CFG.economy;
    const containers = g.world.interactables.filter((it) => it.type === 'container');

    // What one day costs: a full day of thirst and hunger, in item-equivalents.
    const perDay = CFG.survival.thirstPerHour * 24 / 42 + CFG.survival.hungerPerHour * 24 / 46;

    // Day one: everything on the map, at day-one luck.
    const dayOne = containers.reduce(
      (a, it) => a + expectedSupply(it.table, CFG.loot.luckPerDay[0]) * it.baseRichness,
      0
    );

    // Every dawn after that: a quarter of the empty ones, rolling thin.
    const restockPerDawn = (day) =>
      containers.length * E.restockChance * expectedSupply('kitchen', CFG.loot.luckPerDay[day - 1] * E.restockLuck);

    const rows = [];
    for (const row of E.expectedPerDay) {
      const modelled = row.day === 1 ? dayOne : restockPerDawn(row.day) + (row.day === 2 ? dayOne * 0.22 : 0);
      rows.push({
        day: row.day,
        claimed: row.available,
        modelled: +modelled.toFixed(1),
        need: row.need,
        modelledNeed: +perDay.toFixed(1),
        net: +(modelled - row.need).toFixed(1),
      });
    }

    // The shape that matters: a glut on day one, and negative from day three.
    const glut = rows[0].modelled > rows[0].need * 4;
    const thins = rows[1].modelled > rows[2].modelled && rows[2].modelled >= rows[3].modelled;
    const negativeLate = rows.slice(2).every((r) => r.modelled < r.need);
    const tablesHaveSupplies = Object.keys(LOOT_TABLES).every((k) => expectedSupply(k) >= 0);

    /**
     * And the table in Config has to still be describing this game. A written
     * balance target that nobody checks is a comment; checked, it is a
     * contract, and retuning a loot weight breaks it loudly.
     */
    const tableHonest = rows.every((r) => Math.abs(r.modelled - r.claimed) <= Math.max(1.5, r.claimed * 0.2));
    const needHonest = rows.every((r) => r.need <= perDay + 0.5);

    this.record(
      'g · the map is a glut on day one, thinning, and net negative from day three',
      glut && thins && negativeLate && tablesHaveSupplies && tableHonest && needHonest,
      { rows, containers: containers.length, dayCost: +perDay.toFixed(2), glut, thins, negativeLate, tableHonest }
    );
  }

  // ──────────────────────────────────────────────── 7 · save / reload ──

  /**
   * A reload has to bring back the things you spent a night earning: what is
   * in the box, what tier is on which door, and which cupboards are already
   * empty. Everything else is weather and is allowed to come back different.
   */
  async stashReload() {
    const { H, g } = this;
    await this.reset({ day: 3, hour: 14, at: { x: -30, z: 42 } });

    const stash = g.base.stashFor('safehouse');
    stash.add('canned_food', 4);
    stash.add('planks', 3);
    stash.add('fire_axe', 1, 0.5);

    // Metal-sheet the front door, and empty a cupboard.
    const door = this.shelter('safehouse').openings.find((o) => o.isDoor);
    door.fortify(2);
    const cupboard = g.world.interactables.find((it) => it.type === 'container');
    cupboard.richness = 0;
    cupboard.used = true;

    g.run.claim(this.shelter('safehouse'));
    g.radio.onDawn(3);
    g.radio.heard.add(2);
    g.inventory.slots.length = 0;
    g.giveItem('machete', 1, true);

    const snapshot = Save.capture(g);
    const wrote = Save.save(g);

    // Wipe everything, then come back.
    g.resetRun();
    const wiped = g.base.stashFor('safehouse').slots.length === 0 && door.tier === -1;
    const applied = Save.apply(g, snapshot);
    await this.step(0.5);

    const back = g.base.stashFor('safehouse');
    const doorBack = this.shelter('safehouse').openings.find((o) => o.isDoor);
    const cupBack = g.world.interactables.find((it) => it.id === cupboard.id);

    const pass =
      wrote &&
      wiped &&
      applied &&
      back.count('canned_food') === 4 &&
      back.count('planks') === 3 &&
      back.slots.some((s) => s.id === 'fire_axe' && Math.abs(s.cond - 0.5) < 1e-6) &&
      doorBack.tier === 2 &&
      Math.abs(doorBack.boardMax - doorBack.maxHp * CFG.base.fortify[2].hpMul) < 1 &&
      cupBack.richness === 0 &&
      g.run.day === 3 &&
      g.run.shelter?.id === 'safehouse' &&
      g.radio.heard.has(2) &&
      g.inventory.has('machete');

    await this.shot('reload');
    this.record('h · a reload brings back the stash, the tiers and the empty cupboards', pass, {
      wrote,
      wiped,
      applied,
      stash: back.slots.map((s) => `${s.id}:${s.count}`),
      doorTier: doorBack.tier,
      doorBoardMax: Math.round(doorBack.boardMax),
      cupboardRichness: cupBack.richness,
      day: g.run.day,
      shelter: g.run.shelter?.id,
      radioHeard: [...g.radio.heard],
    });
    Save.clear();
  }

  // ──────────────────────────────────────────────── 8 · the whole run ──

  /**
   * Five days at ninety times speed, parked in a boarded house.
   *
   * This is the only scenario that exercises the run as a *run*: phases in
   * order, the day counter turning over at dawn and not at midnight, the
   * restock actually restocking, the escalation numbers arriving on the right
   * nights, the grid dying on night four, and the radio still having something
   * to say on day five. It photographs every dawn on the way past.
   */
  async fullRun() {
    const { H, g } = this;
    await this.reset({ day: 1, hour: 16.4, at: { x: -30, z: 42 } });

    // Board the house up so the run is about the clock, not about a fight.
    for (const op of this.shelter('safehouse').openings) {
      if (op.state === 'broken') op.repair();
      op.fortify(1);
    }
    g.run.claim(this.shelter('safehouse'));

    // Empty half the map, so the dawn restock has something to put back.
    // A run where nothing was ever searched has nothing to restock, and that
    // is correct behaviour rather than a number worth asserting.
    const cont = g.world.interactables.filter((it) => it.type === 'container');
    const emptied = cont.filter((_, i) => i % 2 === 0);
    for (const it of emptied) {
      it.richness = 0;
      it.used = true;
    }

    const timeline = [];
    let lastDay = g.run.day;
    let lastPhase = g.run.phase;
    let restocks = 0;
    const dawnStops = [];
    const blackoutSeen = [];

    /**
     * Ninety times speed, stepped by hand. A whole run is 87.6 in-game hours,
     * which at this scale is a shade under a simulated minute — and the fixed
     * step means the sample is the same on any machine.
     */
    g.time.timeScale = 90;

    await this.step(75, {
      keepAlive: true,
      onStep: () => {
        if (g.run.phase !== lastPhase) {
          lastPhase = g.run.phase;
          timeline.push({
            day: g.run.day,
            phase: g.run.phase,
            hour: +g.time.hour.toFixed(2),
            alive: g.horde.zombies.length,
            night: g.run.night,
          });
        }
        if (g.run.blackout > 0.5) blackoutSeen.push(g.run.day);
        if (g.run.day !== lastDay) {
          lastDay = g.run.day;
          restocks += g.run.restockedLast || 0;
          dawnStops.push({ day: g.run.day, hour: +g.time.hour.toFixed(2), alive: g.horde.zombies.length });
        }
        return g.run.day > CFG.run.extractDay || g.state !== 'playing';
      },
    });
    g.time.timeScale = 1;

    // A photograph of each morning, taken after the fact from the record of
    // where the run actually was.
    for (const d of dawnStops.slice(0, 5)) {
      g.run.day = d.day;
      g.time.hour = CFG.run.dawnStart + 0.6;
      await this.step(0.3);
      await this.shot(`dawn_day${d.day}`);
    }
    g.run.day = lastDay;

    const phases = timeline.map((t) => t.phase);
    const dawns = timeline.filter((t) => t.phase === 'dawn').length;
    const nights = timeline.filter((t) => t.phase === 'night').length;
    const orderOk = timeline.every((t, i) => i === 0 || !(t.phase === 'day' && phases[i - 1] === 'dusk'));
    const reachedDayFive = lastDay >= CFG.run.extractDay;
    const radioReady = g.radio.pending !== null || g.radio.heard.size > 0;
    const restocked = restocks > 0;
    const gridDied = blackoutSeen.length > 0 && Math.min(...blackoutSeen) >= 4;

    this.record(
      'i · a full five-day run keeps its phases, its day count, its restock and its blackout',
      reachedDayFive && dawns >= 3 && nights >= 4 && orderOk && radioReady && restocked && gridDied,
      {
        day: lastDay,
        dawns,
        nights,
        dawnStops,
        emptiedBefore: emptied.length,
        restockedContainers: restocks,
        nightsSurvived: g.run.nightsSurvived,
        blackoutOnDays: [...new Set(blackoutSeen)],
        radioPending: g.radio.pending,
        radioHeard: [...g.radio.heard],
        timeline: timeline.slice(0, 26),
      }
    );
  }

  // ───────────────────────────────────────────────── 9 · the road out ──

  /**
   * Day five, first light, the sandbags on Ridge. Walking into the window is
   * the campaign win; walking into the same spot an hour after the convoy has
   * gone is not.
   */
  async extraction() {
    const { H, g } = this;
    await this.reset({ day: 5, hour: 6.5, at: { x: 0, z: -40 } });
    g.run.nightsSurvived = 4;
    g.run.stats.kills = 41;
    g.run.slept = 3;

    const open = g.run.extractionOpen;
    const far = g.run.distanceToRoad(g.player.pos.x, g.player.pos.z);

    // Standing short of the sandbags is not extraction.
    H.tp(CFG.run.extractPoint.x, CFG.run.extractPoint.z + CFG.run.extractRadius * 2.4);
    await this.step(0.6);
    const notYet = g.state === 'playing';
    const lightsOn = g.world.convoyLights.some((l) => l.intensity > 10);

    H.tp(CFG.run.extractPoint.x, CFG.run.extractPoint.z);
    await this.step(3, { onStep: () => g.state !== 'playing' });

    const won = g.state === 'win' && g.run.state === 'extracted';
    await this.shot('extraction');

    this.record('j · reaching the road at first light on day five ends the run', open && notYet && won, {
      windowOpen: open,
      startedAt: +far.toFixed(1),
      convoyLights: lightsOn,
      notYet,
      gameState: g.state,
      runState: g.run.state,
    });

    g.hud.hideWin();
    g.state = 'playing';
    g.run.state = 'alive';
  }

  // ──────────────────────────────────────────────── 10 · permadeath ──

  /**
   * A run ends once. The summary has to carry the whole run and the save has
   * to be gone — a reload after death must not put you back on the fifth
   * morning with your stash intact.
   */
  async permadeath() {
    const { H, g } = this;
    await this.reset({ day: 4, hour: 2, at: { x: -30, z: 42 } });
    g.run.nightsSurvived = 3;
    g.run.stats.built = 7;
    g.run.stats.fragments = 2;
    g.run.slept = 2;
    Save.save(g);
    const savedBefore = Save.hasSave();

    g.survival.damage(999, 'the dead');
    g.player.die('the dead');
    await this.step(6, { onStep: () => g.state === 'dead' });

    const html = g.hud.el.deathStats.innerHTML;
    const carries =
      html.includes('NIGHTS SURVIVED') &&
      html.includes('>3<') &&
      html.includes('BOARDED') &&
      html.includes('transmissions');
    const cleared = !Save.hasSave();

    await this.shot('permadeath');
    this.record('k · death ends the run, prints it, and deletes the save', g.state === 'dead' && carries && cleared && savedBefore, {
      gameState: g.state,
      runState: g.run.state,
      savedBefore,
      cleared,
      summary: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200),
    });

    g.hud.hideDeath();
    g.resetRun();
    g.state = 'playing';
  }
}
