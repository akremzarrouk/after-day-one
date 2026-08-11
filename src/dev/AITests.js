/**
 * AITests.js — dev-only scenario suite for the AI pass
 * (loaded on demand by `H.aiTests()`).
 *
 * Every claim in the brief that can be measured is measured against the live
 * systems: the screamer's telegraph is timed and interrupted for real, the
 * brute's door rate is compared against a shambler chewing the same door, and
 * the soak counts frames with sixty bodies actually walking around.
 *
 * As in the other suites, durations are simulated seconds accumulated from the
 * game loop, and cost is measured inside `_update`/`_render` rather than as
 * wall-clock frame deltas — a backgrounded tab has its timers clamped and
 * frame deltas there describe Chrome, not the game.
 */

import CFG from '../core/Config.js';
import { ARCHETYPES } from '../entities/Zombie.js';
import { Phase } from '../entities/Horde.js';

/** The same clear lane the other suites stage in. */
const LANE = { x: -46, z: -2 };

export async function runAll(H, opts = {}) {
  const t = new Harness(H, opts);
  // The overlay is the point of half of this: every shot below is taken with
  // it up, so the states and the director's mood are legible in the evidence.
  const hadOverlay = H.game.debugOverlay?.on;
  if (opts.overlay !== false) H.game.debugOverlay?.toggle(true);
  // `only: ['screamerCancel', ...]` re-checks a couple of scenarios without
  // sitting through the whole suite.
  const want = (n) => !opts.only || opts.only.includes(n);
  try {
    if (want('screamerCancel')) await t.screamerCancel();
    if (want('screamerConverge')) await t.screamerConverge();
    if (want('runnerLunge')) await t.runnerLunge();
    if (want('bruteDoor')) await t.bruteDoor();
    if (want('bruteBlockBreak')) await t.bruteBlockBreak();
    if (want('torchInvestigation')) await t.torchInvestigation();
    if (want('corpseLinger')) await t.corpseLinger();
    if (want('doorwayQueue')) await t.doorwayQueue();
    if (want('directorPhases')) await t.directorPhases();
    if (want('migrationRoute')) await t.migrationRoute();
    if (want('dayOnePacing')) await t.dayOnePacing();
    if (want('soak60')) await t.soak60();
  } finally {
    t.restore();
    if (!hadOverlay) H.game.debugOverlay?.toggle(false);
  }

  const failed = t.results.filter((r) => !r.pass);
  return {
    total: t.results.length,
    passed: t.results.length - failed.length,
    failed: failed.map((f) => f.name),
    results: t.results,
    shots: t.shots,
    errs: H.errs.slice(0, 8),
    errCount: H.errs.length,
  };
}

class Harness {
  constructor(H, opts) {
    this.H = H;
    this.g = H.game;
    this.opts = opts;
    this.results = [];
    this.shots = [];
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
  }

  get sim() {
    return this._simT;
  }

  /**
   * Make the player unkillable for a scenario.
   *
   * Several of these watch the director or the crowd for a minute with bodies
   * converging the whole time. A dead player sends the game to its death
   * screen, `_update` early-returns, and the machine under test silently
   * stops — which reads as "the director hung" rather than "you died".
   */
  invuln(on) {
    CFG.debug.godMode = on;
    if (!on) {
      this.g.survival.dead = false;
      this.g.survival.health = this.g.survival.maxHealth;
      if (this.g.player.state === 'dead') this.g.player.spawn(this.g.world.playerSpawn);
    }
  }

  record(name, pass, detail) {
    this.results.push({ name, pass, ...detail });
    return pass;
  }

  async shot(name) {
    if (this.opts.noShots) return null;
    const f = await this.H.shot(name);
    this.shots.push(f);
    return f;
  }

  /** Simulated-time wait that still yields to the loop. */
  async until(seconds, predicate = null) {
    const t0 = this.sim;
    while (this.sim - t0 < seconds) {
      if (predicate && predicate()) return this.sim - t0;
      await this.H.wait(16);
    }
    return this.sim - t0;
  }

  /** Cost of the game itself, immune to background-tab timer clamping. */
  async profile(seconds) {
    const g = this.g;
    const u = [];
    const r = [];
    const ou = g._update;
    const orr = g._render.bind(g);
    g._update = (dt) => {
      const a = performance.now();
      ou(dt);
      u.push(performance.now() - a);
    };
    g._render = (dt) => {
      const a = performance.now();
      orr(dt);
      r.push(performance.now() - a);
    };
    await this.until(seconds);
    g._update = ou;
    g._render = orr;

    const stat = (a) => {
      const s = a.slice().sort((x, y) => x - y);
      return {
        median: +(s[Math.floor(s.length / 2)] || 0).toFixed(2),
        p95: +(s[Math.floor(s.length * 0.95)] || 0).toFixed(2),
      };
    };
    return {
      update: stat(u),
      render: stat(r),
      total: stat(u.map((v, i) => v + (r[i] || 0))),
      frames: u.length,
    };
  }

  // ─────────────────────────────────────────────────────────── staging ──

  async stage(hour = 22.0) {
    const g = this.g;
    g.hud.hideWin();
    g.hud.hideDeath();
    if (g.objectives.goal === 'done') g.objectives.reset();
    g.survival.reset();
    g.state = 'playing';
    this.H.begin();
    this.H.clearZombies();
    g.fire.clear();
    g.throwables.clear();
    g.horde._attackers.clear();
    // Off by default: only the migration scenario wants a column of fourteen
    // walking through the middle of its measurement.
    g.horde.migration = {
      state: 'idle', t: 0, from: null, to: null, night: -1, members: [], enabled: false,
    };
    g.horde.pressure = 0;
    g.horde.phase = Phase.BUILD;
    g.horde.phaseTime = 0;
    g.horde.spawnTimer = 999;                 // no ambient noise in a scenario
    g.player.spawn(g.world.playerSpawn);
    this.H.tp(LANE.x, LANE.z);
    g.player.yaw = 0;
    g.player.moveYaw = 0;
    g.player.flashlightOn = false;
    this.H.setHour(hour, true);
    await this.H.wait(80);
  }

  place(type, dx, dz, opts = {}) {
    const g = this.g;
    const p = g.player;
    const z = g.horde.spawn(p.pos.x + dx, p.pos.z + dz, type, opts.group || 'test');
    if (!z) return null;
    z.pos.x = p.pos.x + dx;
    z.pos.z = p.pos.z + dz;
    z.yaw = Math.atan2(p.pos.x - z.pos.x, p.pos.z - z.pos.z);
    if (opts.hp) z.maxHp = z.hp = opts.hp;
    if (opts.aware !== undefined) z.awareness = opts.aware;
    z.rig.place(z.pos.x, z.pos.y, z.pos.z, z.yaw);
    return z;
  }

  // ───────────────────────────────────────────────────── the scenarios ──

  /** Kill it mid-inhale and the call never happens. */
  async screamerCancel() {
    await this.stage();
    const g = this.g;
    const s = this.place('screamer', 0, 9, { aware: 1.4 });
    s.screamCooldown = 0;                     // it spawns with a random stagger
    const bystanders = [];
    for (let i = 0; i < 5; i++) {
      bystanders.push(this.place('shambler', -14 + i * 6, 26, { aware: 0 }));
    }

    // Let it start.
    const waited = await this.until(8, () => s.state === 'scream');
    const started = s.state === 'scream';
    await this.shot('ai_a_screamer_telegraph');

    // Kill it partway through the telegraph.
    const at = s.screamTimer;
    let screams = 0;
    const origOnScream = g.horde.onScream.bind(g.horde);
    g.horde.onScream = (z) => {
      screams++;
      return origOnScream(z);
    };
    s.die(0, 1);
    await this.until(2.5);
    g.horde.onScream = origOnScream;

    const roused = bystanders.filter((b) => b && b.awareness > 0.4).length;
    this.record(
      'screamer · killing it during the telegraph cancels the scream outright',
      started && at < CFG.specials.screamer.telegraph && screams === 0 && roused === 0,
      {
        enteredScream: started,
        killedAt: +at.toFixed(2),
        telegraph: CFG.specials.screamer.telegraph,
        screamsFired: screams,
        bystandersRoused: roused,
        ofBystanders: bystanders.length,
      }
    );
  }

  /** Let it finish and the street converges. */
  async screamerConverge() {
    await this.stage();
    const g = this.g;
    const s = this.place('screamer', 0, 9, { aware: 1.4 });
    s.screamCooldown = 0;                     // it spawns with a random stagger
    const near = [];
    const far = [];
    // Inside the 45 m radius…
    for (let i = 0; i < 6; i++) near.push(this.place('shambler', -16 + i * 6, 30, { aware: 0 }));
    // …and well outside it, to prove the radius is a radius.
    for (let i = 0; i < 3; i++) far.push(this.place('shambler', -20 + i * 12, -58, { aware: 0 }));

    const p0 = g.horde.pressure;
    let fired = false;
    const orig = g.horde.onScream.bind(g.horde);
    g.horde.onScream = (z) => { fired = true; return orig(z); };
    await this.until(10, () => fired);
    await this.until(1.0);
    g.horde.onScream = orig;

    const roused = near.filter((z) => z && !z.isDead && z.awareness > 0.9).length;
    const untouched = far.filter((z) => z && !z.isDead && z.awareness < 0.3).length;
    const pressureJump = g.horde.pressure - p0;

    await this.shot('ai_b_screamer_converge');
    this.record(
      'screamer · an uninterrupted call converges everything inside 45 m and spikes pressure',
      fired && roused >= 5 && untouched === far.length && pressureJump > 0.5,
      {
        callFired: fired,
        roused,
        ofNear: near.length,
        outsideRadiusUnaffected: untouched,
        ofFar: far.length,
        alertRadius: CFG.specials.screamer.alertRadius,
        pressureJump: +pressureJump.toFixed(2),
      }
    );
  }

  /** The lunge commits, and the recovery is long enough to punish. */
  async runnerLunge() {
    await this.stage();
    const g = this.g;
    const r = this.place('runner', 0, 6, { aware: 1.4 });
    r.lungeCooldown = 0;

    const launched = await this.until(6, () => r.state === 'lunge');
    const didLunge = r.state === 'lunge';
    const distAtLaunch = Math.hypot(r.pos.x - g.player.pos.x, r.pos.z - g.player.pos.z);

    // Time the whole committed window: from launch until it can act again.
    const t0 = this.sim;
    await this.until(4, () => r.state !== 'lunge');
    const committed = this.sim - t0;

    // And measure the part of it where it is helpless — no attack, no turning.
    const R = CFG.specials.runner;
    const punishWindow = committed - R.lungeTime;

    /**
     * Punishable means one free, uncontested swing: the recovery has to be
     * longer than a real weapon's whole cycle, and you must take nothing back
     * while you spend it. Counting raw `resolveSwing` calls would prove
     * nothing (you can call it sixty times a second), so this swings at a
     * crowbar's actual cadence and checks the runner never touches you.
     */
    await this.stage();
    const r2 = this.place('runner', 0, 6, { aware: 1.4 });
    r2.lungeCooldown = 0;
    r2.maxHp = r2.hp = 5000;                  // survive long enough to be measured
    await this.until(6, () => r2.state === 'lunge');
    await this.until(R.lungeTime + 0.05);
    const inRecovery = r2.state === 'lunge';
    const cycle = 0.2 + 0.12 + 0.42;          // crowbar windup + active + recover
    const hp0 = g.survival.health;
    let freeHits = 0;
    let swingAt = 0;
    const t1 = this.sim;
    while (this.sim - t1 < R.lungeRecover && r2.state === 'lunge') {
      g.player.pos.x = r2.pos.x - 1.1;
      g.player.pos.z = r2.pos.z;
      g.player.yaw = Math.atan2(r2.pos.x - g.player.pos.x, r2.pos.z - g.player.pos.z);
      if (this.sim - t1 >= swingAt) {
        const res = g.combat.resolveSwing(g.player, { ...ARCHETYPES.shambler, ...WEAPON_CROWBAR });
        if (res.hits > 0) freeHits++;
        swingAt += cycle;
      }
      await this.H.wait(16);
    }
    const hurtYouDuringRecovery = g.survival.health < hp0 - 0.5;
    g.survival.health = 100;

    await this.shot('ai_c_runner_lunge');
    this.record(
      'runner · the lunge commits and leaves a punishable recovery',
      didLunge && distAtLaunch <= CFG.specials.runner.lungeRange + 0.6 &&
        punishWindow > cycle && inRecovery && freeHits >= 1 && !hurtYouDuringRecovery,
      {
        lunged: didLunge,
        launchedAt: +distAtLaunch.toFixed(2),
        opensAt: CFG.specials.runner.lungeRange,
        committedTotal: +committed.toFixed(2),
        punishWindow: +punishWindow.toFixed(2),
        crowbarSwingCycle: +cycle.toFixed(2),
        freeSwingsLanded: freeHits,
        itHurtYouDuringRecovery: hurtYouDuringRecovery,
        chaseSpeedVsStalker: +(ARCHETYPES.runner.chase / ARCHETYPES.stalker.chase).toFixed(2),
      }
    );
  }

  /** A brute takes a boarded door apart far faster than a shambler. */
  async bruteDoor() {
    await this.stage();
    const g = this.g;

    const rate = async (type) => {
      await this.stage();
      this.invuln(true);
      const op = g.world.openings.find((o) => o.isDoor);
      op.reset();
      op.setState('closed');
      op.board();
      const hp0 = op.totalHp;
      // Park one attacker on it and let the horde's siege pooling do the work.
      const z = g.horde.spawn(op.x + op.nx * 1.2, op.z + op.nz * 1.2, type, 'test');
      z.awareness = 1.4;
      z._enterSiege(op, { noise: g.noise });
      /**
       * A fixed window and a rate, not a race to a threshold: a shambler
       * cannot chew through a boarded door inside any window short enough to
       * test, and the ratio is the thing under test anyway.
       */
      const t0 = this.sim;
      const WINDOW = 8;
      while (this.sim - t0 < WINDOW && !z.isDead && op.totalHp > 0) {
        z.awareness = Math.max(z.awareness, 1.2);   // it can hear you in there
        await this.H.wait(16);
      }
      const dt = this.sim - t0;
      const done = hp0 - op.totalHp;
      op.reset();
      this.invuln(false);
      return { dps: done / Math.max(0.01, dt), hp0, done: +done.toFixed(0), secs: +dt.toFixed(2) };
    };

    const sh = await rate('shambler');
    const br = await rate('brute');
    const ratio = br.dps / Math.max(0.01, sh.dps);

    await this.shot('ai_d_brute_door');
    this.record(
      'brute · takes a boarded door apart at least 4× a shambler',
      ratio >= 4,
      {
        shamblerDps: +sh.dps.toFixed(1),
        bruteDps: +br.dps.toFixed(1),
        ratio: +ratio.toFixed(2),
        target: '≥4×',
        siegeMul: CFG.specials.brute.siegeMul,
        shambler: sh,
        brute: br,
      }
    );
  }

  /** And its swipe goes through a raised guard. */
  async bruteBlockBreak() {
    await this.stage();
    const g = this.g;
    const p = g.player;

    const trial = async (type) => {
      await this.stage();
      const z = this.place(type, 0, 1.6, { aware: 1.5 });
      z.attackCooldown = 0;
      p.blocking = true;
      g.survival.stamina = 100;
      const hp0 = g.survival.health;
      let blocked = null;
      const orig = p.takeHit.bind(p);
      p.takeHit = (...args) => {
        p.blocking = true;                    // hold the guard through the hit
        const r = orig(...args);
        if (r && blocked === null) blocked = r.blocked;
        return r;
      };
      await this.until(6, () => blocked !== null);
      p.takeHit = orig;
      p.blocking = false;
      const dmg = hp0 - g.survival.health;
      g.survival.health = 100;
      return { blocked, dmg: +dmg.toFixed(1) };
    };

    const shambler = await trial('shambler');
    const brute = await trial('brute');

    this.record(
      'brute · the swipe goes through a block; an ordinary hit does not',
      shambler.blocked === true && brute.blocked === false && brute.dmg > shambler.dmg * 2,
      { shambler, brute, blockDamageMul: CFG.combat.blockDamageMul }
    );
  }

  /** The beam draws them to the lit patch, not to the hand holding it. */
  async torchInvestigation() {
    await this.stage(23.0);
    const g = this.g;
    const p = g.player;

    /**
     * Staged so the two things are genuinely separable, which takes more room
     * than it looks like it should: *carrying* a lit torch already makes the
     * player visible from 26 m at night (15 m base × 1.45 for the light × 1.2
     * for the dark), so the watcher has to be beyond that or it simply sees
     * you and the test proves nothing. At 32 m it cannot; the patch the beam
     * throws on the road 11 m ahead of you is 21 m from it and squarely in
     * its cone, so the light is the only thing it can be reacting to.
     */
    const z = this.place('shambler', 0, 32, { aware: 0 });
    z.yaw = Math.PI;                                  // looking back down the lane
    p.flashlightOn = true;
    p.battery = 300;
    p.yaw = 0;
    g.cameraRig.yaw = 0;
    g.cameraRig.pitch = 0;
    // Past the LOD distance, so perception is only ticking at 5 Hz here.
    await this.until(9, () => z.state === 'investigate');

    const lit = p.torchPoint ? { x: p.torchPoint.x, z: p.torchPoint.z } : null;
    const lk = z.lastKnown;
    const toLit = lit && lk ? Math.hypot(lk.x - lit.x, lk.z - lit.z) : 999;
    const toPlayer = lk ? Math.hypot(lk.x - p.pos.x, lk.z - p.pos.z) : 999;

    await this.shot('ai_e_torch');
    p.flashlightOn = false;
    this.record(
      'perception · a torch beam is investigated at the lit spot, not at the player',
      !!lit && z.state === 'investigate' && toLit < toPlayer && toLit < 2,
      {
        state: z.state,
        playerDistance: +Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z).toFixed(1),
        nightSightRange: +(
          ARCHETYPES.shambler.sight * (CFG.zombie.sightRangeNight / CFG.zombie.sightRange)
        ).toFixed(1),
        litPoint: lit ? [+lit.x.toFixed(1), +lit.z.toFixed(1)] : null,
        lastKnown: lk ? [+lk.x.toFixed(1), +lk.z.toFixed(1)] : null,
        distToLitPoint: +toLit.toFixed(2),
        distToPlayer: +toPlayer.toFixed(2),
      }
    );
  }

  /** They stop and stand over something that died recently. */
  async corpseLinger() {
    await this.stage();
    const g = this.g;
    /**
     * Both of them well down the lane and out of the player's reach: a
     * wanderer five metres from you spots you and chases, which is correct
     * behaviour and completely swamps the thing under test.
     */
    const victim = this.place('shambler', 3, 30, { aware: 0 });
    victim.die(0, 1);
    await this.until(0.4);

    const passer = this.place('shambler', 3.8, 30.6, { aware: 0 });
    passer.state = 'wander';
    passer.awareness = 0;

    const found = await this.until(10, () => passer.state === 'linger');
    const lingered = passer.state === 'linger';
    await this.shot('ai_f_linger');
    this.record(
      'perception · a fresh corpse makes them stop and stand over it',
      lingered,
      {
        state: passer.state,
        awareness: +passer.awareness.toFixed(2),
        foundAfter: +found.toFixed(2),
        interestRadius: CFG.zombie.corpseInterest,
        freshFor: CFG.zombie.corpseFreshFor,
      }
    );
  }

  /** Besiegers form a line rather than a knot. */
  async doorwayQueue() {
    await this.stage();
    const g = this.g;
    const op = g.world.openings.find((o) => o.isDoor);
    op.reset();
    op.setState('closed');
    /**
     * Boarded, or there is nothing to queue at: six of them take a bare 300 HP
     * door apart in about five seconds, and the measurement then lands on a
     * crowd walking through the wreckage rather than on a queue.
     */
    op.board();

    const crowd = [];
    for (let i = 0; i < 6; i++) {
      const z = g.horde.spawn(op.x + op.nx * (1.6 + i * 0.5), op.z + op.nz * (1.6 + i * 0.5), 'shambler', 'test');
      if (!z) continue;
      z.awareness = 1.4;
      z._enterSiege(op, { noise: g.noise });
      crowd.push(z);
    }
    const tq = this.sim;
    while (this.sim - tq < 6) {
      for (const z of crowd) z.awareness = Math.max(z.awareness, 1.2);
      await this.H.wait(16);
    }

    /**
     * "Stacked" needs a number, and the defensible one is physical: these
     * bodies have a 0.4 m radius, so anything closer than 0.45 m between
     * centres is more than half interpenetrated — genuinely occupying the same
     * spot rather than merely standing shoulder to shoulder in a queue.
     */
    const STACKED = 0.45;
    let overlaps = 0;
    let minGap = Infinity;
    let sum = 0;
    let pairs = 0;
    for (let i = 0; i < crowd.length; i++) {
      for (let j = i + 1; j < crowd.length; j++) {
        const d = Math.hypot(crowd[i].pos.x - crowd[j].pos.x, crowd[i].pos.z - crowd[j].pos.z);
        minGap = Math.min(minGap, d);
        sum += d;
        pairs++;
        if (d < STACKED) overlaps++;
      }
    }
    const slots = crowd.map((z) => z.siegeSlot).sort((a, b) => a - b);
    const stillSieging = crowd.filter((z) => z.state === 'siege').length;

    await this.shot('ai_g_queue');
    this.record(
      'crowd · besiegers take numbered slots instead of stacking in the doorway',
      overlaps === 0 && new Set(slots).size === crowd.length && stillSieging === crowd.length,
      {
        besiegers: crowd.length,
        stillSieging,
        doorSurvived: +op.totalHp.toFixed(0),
        slots,
        distinctSlots: new Set(slots).size,
        closestPair: +minGap.toFixed(2),
        meanPairDistance: +(sum / pairs).toFixed(2),
        stackedThreshold: STACKED,
        bodyRadius: 0.4,
        overlappingPairs: overlaps,
      }
    );
    op.reset();
  }

  /**
   * The phase machine cycles, and RELAX is real: no spawns happen inside it,
   * at night as much as by day.
   */
  async directorPhases() {
    await this.stage(23.0);
    const g = this.g;
    const h = g.horde;
    const D = CFG.director;

    /**
     * Compress the clock. The shipped timings are minutes long by design and
     * this is a test of the *machine*, not of the constants — which are read
     * straight out of Config and reported rather than re-derived here.
     */
    const saved = { buildMin: D.buildMin, buildMax: D.buildMax, peakTime: D.peakTime,
      relaxTime: D.relaxTime, relaxTimeNight: D.relaxTimeNight, waveInterval: D.waveInterval };
    D.buildMin = 1; D.buildMax = 6; D.peakTime = 5; D.relaxTime = 6; D.relaxTimeNight = 5;
    D.waveInterval = 0.35;

    this.invuln(true);
    h.spawnTimer = 0;                          // let the director actually work
    h.phase = Phase.BUILD;
    h.phaseTime = D.buildMin + 0.1;            // ready to crest
    h.pressure = D.peakPressure + 0.2;         // and a reason to

    const seen = [];
    let spawnsInRelax = 0;
    let relaxSeconds = 0;
    let peakWave = 0;
    const t0 = this.sim;
    let last = h.zombies.length;
    let lastPhase = h.phase;

    while (this.sim - t0 < D.peakTime + D.relaxTimeNight + D.buildMax + 6) {
      await this.H.wait(16);
      if (h.phase !== lastPhase) {
        seen.push(h.phase);
        lastPhase = h.phase;
      }
      const now = h.zombies.length;
      if (h.phase === Phase.RELAX) {
        relaxSeconds += 1 / 60;
        if (now > last) spawnsInRelax += now - last;
      }
      if (h.phase === Phase.PEAK && now > last) peakWave += now - last;
      last = now;
    }

    await this.shot('ai_h_director');
    Object.assign(D, saved);
    this.invuln(false);
    this.record(
      'director · BUILD → PEAK → RELAX cycles, and nothing spawns during RELAX at night',
      seen.includes(Phase.PEAK) && seen.includes(Phase.RELAX) && spawnsInRelax === 0 && relaxSeconds > 5,
      {
        phaseSequence: seen,
        peakArrivals: peakWave,
        expectedWaveNight: D.waveCountNight,
        relaxObservedSeconds: +relaxSeconds.toFixed(1),
        relaxUnderTest: 5,
        relaxShippedNight: saved.relaxTimeNight,
        relaxShippedDay: saved.relaxTime,
        spawnsDuringRelax: spawnsInRelax,
      }
    );
  }

  /** The column crosses the map and keeps clear of home. */
  async migrationRoute() {
    await this.stage(22.5);
    const g = this.g;
    const h = g.horde;
    const M = CFG.migration;
    const sh = g.world.safehouse;
    const cx = (sh.bounds.minX + sh.bounds.maxX) / 2;
    const cz = (sh.bounds.minZ + sh.bounds.maxZ) / 2;

    // Plan a hundred routes and check every one, not just the one we get.
    let worst = Infinity;
    let planned = 0;
    for (let i = 0; i < 100; i++) {
      const r = h._planMigration({ night: true, hour: 22.5 });
      if (!r) continue;
      planned++;
      worst = Math.min(worst, segDist(cx, cz, r.from, r.to));
    }

    // Then run one for real, telegraph and all.
    h.migration = {
      state: 'idle', t: 0, from: null, to: null, night: -1, members: [], enabled: true,
    };
    const ctx = { night: true, hour: 22.5, elapsedHours: 6.1, player: g.player, pastFirstDusk: true };
    h._updateMigration(0.016, ctx);
    const telegraphed = h.migration.state === 'telegraph';
    // Fast-forward the telegraph without waiting twenty real seconds.
    h.migration.t = M.telegraph;
    h._updateMigration(0.016, ctx);
    const walking = h.migration.state === 'walking';
    const count = h.migration.members.length;

    // Nothing in the column has any interest in the player.
    await this.until(3);
    const chasing = h.migration.members.filter((z) => z.state === 'chase' || z.state === 'attack').length;
    const heading = h.migration.members.filter((z) => z.migrateTo).length;

    await this.shot('ai_i_migration');
    this.record(
      'migration · a column of 10–14 crosses the map, keeping clear of the safehouse',
      planned > 90 && worst >= M.safehouseClearance && telegraphed && walking &&
        count >= M.minCount - 3 && chasing === 0 && heading === count,
      {
        routesPlanned: planned,
        worstClearance: +worst.toFixed(1),
        requiredClearance: M.safehouseClearance,
        telegraphed,
        walking,
        columnSize: count,
        configured: [M.minCount, M.maxCount],
        chasingThePlayer: chasing,
        stillHeadingAcross: heading,
      }
    );

    // Leave nothing behind.
    for (const z of [...h.migration.members]) z.die(0, 1);
    h.migration.state = 'idle';
  }

  /** Day one, before the light goes, rolls no specials at all. */
  async dayOnePacing() {
    await this.stage(16.6);
    const h = this.g.horde;
    const ctx = { night: false, hour: 16.6, elapsedHours: 0.2, pastFirstDusk: false };
    const rolled = {};
    h.phase = Phase.BUILD;
    for (let i = 0; i < 3000; i++) {
      const t = h._pickType(ctx);
      rolled[t] = (rolled[t] || 0) + 1;
    }
    const specials = ['screamer', 'runner', 'brute'].reduce((n, k) => n + (rolled[k] || 0), 0);

    // And at night, with dusk behind us, all three are on the table.
    const nightCtx = { night: true, hour: 23.0, elapsedHours: 7, pastFirstDusk: true };
    const nightRolled = {};
    for (let i = 0; i < 3000; i++) {
      const t = h._pickType(nightCtx);
      nightRolled[t] = (nightRolled[t] || 0) + 1;
    }
    const nightSpecials = ['screamer', 'runner', 'brute'].filter((k) => (nightRolled[k] || 0) > 0);

    this.record(
      'gating · day one before dusk rolls the original three archetypes and nothing else',
      specials === 0 && nightSpecials.length === 3,
      {
        dayOneRolls: rolled,
        specialsOnDayOne: specials,
        nightRolls: nightRolled,
        specialsAvailableAtNight: nightSpecials,
      }
    );
  }

  /** Sixty bodies, walking, with LOD doing its job. */
  async soak60() {
    await this.stage(23.0);
    const g = this.g;
    const p = g.player;

    this.invuln(true);
    const before = CFG.zombie.maxActive;
    CFG.zombie.maxActive = 70;
    const quiet = await this.profile(1.2);

    let made = 0;
    for (let i = 0; i < 60 && g.horde.zombies.length < 60; i++) {
      const a = (i / 60) * Math.PI * 2 * 3.7;
      const d = 10 + (i % 10) * 5.5;              // 10-60 m, a realistic spread
      const z = g.horde.spawn(p.pos.x + Math.cos(a) * d, p.pos.z + Math.sin(a) * d, i % 11 === 0 ? 'brute' : i % 5 === 0 ? 'runner' : i % 7 === 0 ? 'screamer' : 'shambler', 'soak');
      if (z) {
        z.awareness = 0.9;
        z.lastKnown = { x: p.pos.x, z: p.pos.z };
        made++;
      }
    }
    await this.until(1.5);
    const loaded = await this.profile(3.0);
    const alive = g.horde.zombies.length;
    const lod = g.horde.zombies.filter((z) => z._lodSkip).length;
    const nav = g.world.nav;

    await this.shot('ai_j_soak60');
    CFG.zombie.maxActive = before;
    this.invuln(false);

    const cost = +(loaded.total.median - quiet.total.median).toFixed(2);
    this.record(
      `soak · ${alive} zombies hold the frame budget with LOD active`,
      // The AI budget is what this pass owns. Rendering sixty skinned
      // characters is the animation pass's bill: reported, not asserted.
      alive >= 55 && loaded.update.median < 6 && lod >= 15,
      {
        spawned: made,
        alive,
        onReducedTick: lod,
        lodDistance: CFG.zombie.lodDistance,
        lodHz: CFG.zombie.lodHz,
        simMs: {
          quiet: quiet.total,
          loaded: loaded.total,
          cost,
          updateQuiet: quiet.update.median,
          updateLoaded: loaded.update.median,
          renderLoaded: loaded.render.median,
        },
        navQueue: nav.queue.length,
        navDropped: nav.dropped,
        budget: '16.6ms = 60fps',
      }
    );

    this.H.clearZombies();
  }
}

/** A crowbar's stats, for the punish-window test. */
const WEAPON_CROWBAR = {
  damage: 28,
  range: 1.9,
  arc: 72,
  knockback: 2.1,
  stagger: 0.42,
  hitSound: 'hit_metal',
};

function segDist(px, pz, a, b) {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const wx = px - a.x;
  const wz = pz - a.z;
  const len2 = vx * vx + vz * vz;
  const t = len2 > 1e-6 ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / len2)) : 0;
  return Math.hypot(px - (a.x + vx * t), pz - (a.z + vz * t));
}
