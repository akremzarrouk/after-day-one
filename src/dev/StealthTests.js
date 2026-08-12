/**
 * StealthTests.js — dev-only scenario suite for the hide-or-fight layer
 * (loaded on demand by `H.stealthTests()`).
 *
 * Each scenario stages a clean situation, runs the real simulation, and
 * asserts on the real state — no mocks. Timings are measured in *simulated*
 * seconds accumulated from the game loop, not wall clock, so a slow frame
 * cannot make a door look tougher than it is.
 */

/**
 * A clear north-south corridor with room to walk 30 m and 10 m of side
 * clearance — verified against the nav grid, not eyeballed, so the pass-by
 * tests are actually measuring detection and not the player's nose against a
 * boundary wall.
 */
const LANE = { x: -46, z0: 12, z1: -18 };
const OPEN_GROUND = { x: LANE.x, z: (LANE.z0 + LANE.z1) / 2 };

export async function runAll(H, opts = {}) {
  const g = H.game;
  const results = [];
  const shots = [];

  const t = new Harness(H, opts, results, shots);
  await t.crouchPast();
  await t.sprintPast();
  await t.doorSiege();
  await t.boardedDoor();
  await t.windowVault();
  await t.hideUnseen();
  await t.hideSeen();
  await t.bottleThrow();
  await t.objectiveLoop();

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

/**
 * Sweep the pass-by staging across distances and conditions. Used to check the
 * "undetected at N metres" balance targets rather than to pass or fail.
 */
export async function passSweep(H, cases) {
  const t = new Harness(H, {}, [], []);
  const rows = [];
  for (const c of cases) {
    rows.push({ ...c, ...(await t.passBy(c)) });
  }
  t.restore();
  return rows;
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
  }

  get sim() {
    return this._simT;
  }

  record(name, pass, detail) {
    this.results.push({ name, pass, ...detail });
    return pass;
  }

  async shot(name) {
    this.shots.push(await this.H.shot('st_' + name));
  }

  /** Fresh slate: no zombies, full health, standing, nothing equipped. */
  async reset(hour = 13, at = OPEN_GROUND) {
    const { H, g } = this;
    H.freeze(false);
    H.clearZombies();
    g.throwables.clear();
    if (g.player.hidden) g._exitHide();
    g.survival.reset();
    g.player.state = 'normal';
    g.player.crouching = false;
    g.player.vaulting = null;
    g.player.rig.reset();
    g.world.resetOpenings();
    g.inventory.slots.length = 0;
    g.inventory.equipped = 'fists';
    H.setHour(hour);
    H.tp(at.x, at.z);
    g.cameraRig._initialised = false;
    await H.wait(500);
  }

  /**
   * Three wanderers looking across a path, and the player walking down it at a
   * fixed lateral distance. Returns the peak awareness reached and whether
   * anything committed to a chase.
   */
  async passBy({ hour, gap, crouch, sprint }) {
    const { H, g } = this;
    await this.reset(hour);
    const p = g.player;
    const px = LANE.x;

    // Three watchers spread down the lane, all staring across it.
    const zs = [];
    for (let i = 0; i < 3; i++) {
      const zz = LANE.z0 - 7 - i * 7;
      const z = g.horde.spawn(px - gap, zz, 'shambler', 'test');
      if (!z) continue;
      z.pos.set(px - gap, 0, zz);
      z.yaw = Math.PI / 2;               // looking toward +x, across the lane
      z.state = 'idle';
      z.stateTimer = 999;                // hold still: this is a sight test
      z.awareness = 0;
      zs.push(z);
    }
    await H.wait(200);

    p.pos.set(px, 0, LANE.z0);
    p.crouching = !!crouch;
    g.cameraRig.yaw = Math.PI;           // walking toward -z
    let peak = 0;
    let chased = false;
    let minD = Infinity;
    H.hold('KeyW');
    if (sprint) H.hold('ShiftLeft');
    for (let i = 0; i < 400; i++) {
      await H.wait(60);
      for (const z of zs) {
        z.stateTimer = 999;
        if (z.state === 'idle' || z.state === 'wander') z.yaw = Math.PI / 2;
        minD = Math.min(minD, Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z));
      }
      peak = Math.max(peak, g.horde.peakAwareness());
      if (g.horde.countChasing() > 0) {
        chased = true;
        break;
      }
      if (p.pos.z < LANE.z1 + 2) break;  // clear of the last watcher
    }
    H.release('KeyW');
    H.release('ShiftLeft');
    return {
      peak: +peak.toFixed(2),
      chased,
      closestApproach: +minD.toFixed(1),
      travelled: +(LANE.z0 - p.pos.z).toFixed(1),
      crouching: p.crouching,
    };
  }

  // ── (a) crouched, in the dark, at 5 m ──
  async crouchPast() {
    const r = await this.passBy({ hour: 22, gap: 5, crouch: true, sprint: false });
    await this.shot('a_crouch_past');
    this.record('a · crouched past 3 wanderers at 5 m in the dark', !r.chased, r);
  }

  // ── (b) same path, sprinting ──
  async sprintPast() {
    const r = await this.passBy({ hour: 22, gap: 5, crouch: false, sprint: true });
    await this.shot('b_sprint_past');
    this.record('b · sprinting the same path is noticed', r.chased, r);
  }

  /** Put the player behind a shut door with `n` zombies outside it. */
  async _siege(n, board) {
    const { H, g } = this;
    await this.reset(13);
    const op = g.world.safehouse.doorOpening;
    op.reset('closed');

    // Player inside, at the far wall.
    const inside = op.standPoint(false, 2.4);
    H.tp(inside.x, inside.z);
    if (board) {
      g.inventory.add('planks', 1);
      g._boardOpening(op);
    }
    await H.wait(250);

    const zs = [];
    for (let i = 0; i < n; i++) {
      const s = op.standPoint(true, 1.1 + i * 0.05);
      const z = g.horde.spawn(s.x + (i - 1) * 0.7, s.z + (i - 1) * 0.5, 'shambler', 'test');
      if (!z) continue;
      z.pos.set(s.x + (i - 1) * 0.55, 0, s.z + (i - 1) * 0.75);
      z.awareness = 1.5;
      z.lastKnown = { x: g.player.pos.x, z: g.player.pos.z };
      z.state = 'chase';
      zs.push(z);
    }

    const t0 = this.sim;
    let sawSiege = false;
    let hpTrace = [];
    let broke = false;
    while (this.sim - t0 < (board ? 120 : 60)) {
      await H.wait(120);
      if (zs.some((z) => z.state === 'siege')) sawSiege = true;
      hpTrace.push(+op.totalHp.toFixed(0));
      // Keep them interested: the player is behind a door, so sight is gone.
      for (const z of zs) {
        if (z.isDead) continue;
        z.awareness = Math.max(z.awareness, 1.4);
        z.lastKnown = { x: g.player.pos.x, z: g.player.pos.z };
      }
      g.survival.health = 100;
      if (op.state === 'broken') {
        broke = true;
        break;
      }
    }
    return { seconds: +(this.sim - t0).toFixed(1), sawSiege, broke, op, hpTrace, attackers: op.attackers };
  }

  // ── (c) one door, three zombies, no boards ──
  async doorSiege() {
    const one = await this._siege(1, false);
    this.record(
      'c1 · a shut door holds ~25 s against one',
      one.broke && one.seconds > 19 && one.seconds < 32,
      { seconds: one.seconds, sawSiege: one.sawSiege, hpFell: one.hpTrace[0] > one.hpTrace[one.hpTrace.length - 1] }
    );
    const three = await this._siege(3, false);
    await this.shot('c_door_siege');
    this.record(
      'c2 · and ~9 s against three',
      three.broke && three.seconds > 6.5 && three.seconds < 13,
      { seconds: three.seconds, sawSiege: three.sawSiege, attackers: three.attackers }
    );
    this._unboardedOne = one.seconds;
    this._unboardedThree = three.seconds;
  }

  // ── (d) boarded: three times as long ──
  async boardedDoor() {
    const r = await this._siege(1, true);
    await this.shot('d_boarded_door');
    const ratio = r.seconds / Math.max(0.1, this._unboardedOne || 25);
    this.record('d · boarding triples it', r.broke && ratio > 2.4 && ratio < 3.7, {
      seconds: r.seconds,
      unboarded: this._unboardedOne,
      ratio: +ratio.toFixed(2),
    });
  }

  // ── (e) vault a window to break a chase ──
  async windowVault() {
    const { H, g } = this;
    await this.reset(13);
    const house = g.world.buildings.find((b) => b.name === 'house-a');
    const win = house.openings.find((o) => !o.isDoor && o.state !== 'boarded');
    const outside = win.standPoint(true, 1.0);
    H.tp(outside.x, outside.z);
    await H.wait(350);

    const before = { x: g.player.pos.x, z: g.player.pos.z, state: win.state };
    const wasOutside = win.isOutside(g.player.pos.x, g.player.pos.z);
    g._vault(win);
    const vaultingNow = !!g.player.vaulting;
    const t0 = this.sim;
    while (this.sim - t0 < 1.6 && g.player.vaulting) await H.wait(60);
    const nowOutside = win.isOutside(g.player.pos.x, g.player.pos.z);
    await this.shot('e_window_vault');
    this.record('e · vaulting a window puts you through it', vaultingNow && wasOutside !== nowOutside, {
      committed: vaultingNow,
      crossed: wasOutside !== nowOutside,
      glassWas: before.state,
      glassNow: win.state,
      moved: +Math.hypot(g.player.pos.x - before.x, g.player.pos.z - before.z).toFixed(2),
    });
  }

  /** Stage a hide with the watcher either able to see the player or not. */
  async _hide(seen) {
    const { H, g } = this;
    await this.reset(13);
    const spot = g.world.interactables.find((i) => i.type === 'hide' && i.label === 'Wardrobe');
    H.tp(spot.approachX, spot.approachZ);
    await H.wait(350);

    const z = g.horde.spawn(spot.approachX + 3.0, spot.approachZ + 1.0, 'shambler', 'test');
    z.awareness = seen ? 1.4 : 0.15;
    z.lastKnown = { x: g.player.pos.x, z: g.player.pos.z };
    z.state = seen ? 'chase' : 'wander';
    await H.wait(120);

    g._enterHide(spot);
    const watchers = z.knownHide ? 1 : 0;
    const t0 = this.sim;
    let dragged = false;
    let stillHidden = true;
    while (this.sim - t0 < 12) {
      await H.wait(120);
      if (!g.player.hidden) {
        dragged = true;
        stillHidden = false;
        break;
      }
      if (!seen) {
        // Nothing should be converging on the wardrobe.
        z.awareness = Math.max(0, z.awareness - 0.001);
      }
    }
    return { watchers, dragged, stillHidden, hp: +g.survival.health.toFixed(0), zState: z.state };
  }

  // ── (f) hidden, unseen: they lose you ──
  async hideUnseen() {
    const r = await this._hide(false);
    await this.shot('f_hide_unseen');
    this.record('f1 · hiding unseen holds', r.watchers === 0 && !r.dragged, r);
    if (this.g.player.hidden) this.g._exitHide();
  }

  // ── (f) hidden, but watched: dragged out ──
  async hideSeen() {
    const r = await this._hide(true);
    await this.shot('g_hide_seen');
    this.record('f2 · hiding seen gets you dragged out', r.watchers === 1 && r.dragged && r.hp < 100, r);
    if (this.g.player.hidden) this.g._exitHide();
  }

  // ── (g) a bottle pulls a group ──
  async bottleThrow() {
    const { H, g } = this;
    await this.reset(13);
    const p = g.player;
    const px = OPEN_GROUND.x,
      pz = OPEN_GROUND.z;
    H.tp(px, pz);

    /**
     * A knot of idle zombies to the north, all facing away. The bottle goes
     * east: far enough from them to be a distraction rather than a hit, close
     * enough to be inside its 18 m earshot.
     */
    const zs = [];
    for (let i = 0; i < 4; i++) {
      const z = g.horde.spawn(px - 1.5 + i * 1.2, pz + 9, 'shambler', 'test');
      if (!z) continue;
      z.pos.set(px - 1.5 + i * 1.2, 0, pz + 9);
      z.yaw = 0;                       // looking north, away from the player
      z.state = 'idle';
      z.stateTimer = 999;
      z.awareness = 0;
      zs.push(z);
    }
    g.inventory.add('glass_bottle', 3);
    g.inventory.equipWeapon('bottle');
    p.syncWeaponMesh();
    await H.wait(300);

    // Throw east, across the field and away from the player.
    g.cameraRig.yaw = Math.PI / 2;
    p.yaw = Math.PI / 2;
    p.tryAttack();
    const t0 = this.sim;
    while (this.sim - t0 < 1.6 && !g.throwables.lastLanding) await H.wait(60);
    const land = g.throwables.lastLanding;

    let investigating = 0;
    const t1 = this.sim;
    while (this.sim - t1 < 4) {
      await H.wait(120);
      investigating = zs.filter((z) => z.state === 'investigate' || z.state === 'chase').length;
      if (investigating >= 2) break;
    }
    const drawn = land
      ? zs.filter((z) => z.lastKnown && Math.hypot(z.lastKnown.x - land.x, z.lastKnown.z - land.z) < 4).length
      : 0;
    await this.shot('h_bottle');
    this.record('g · a thrown bottle pulls the group to where it landed', !!land && drawn >= 2, {
      landed: land ? { x: +land.x.toFixed(1), z: +land.z.toFixed(1), radius: land.radius } : null,
      investigating,
      drawnToLanding: drawn,
      distFromPlayer: land ? +Math.hypot(land.x - px, land.z - pz).toFixed(1) : 0,
    });
  }

  // ── (h) the objective chain still completes ──
  async objectiveLoop() {
    const { H, g } = this;
    await this.reset(13);
    H.clearZombies();
    const obj = g.objectives;
    const need = obj.suppliesNeeded ?? 6;
    for (let i = 0; i < need + 2; i++) g.giveItem('canned_food', 1, true);
    await H.wait(400);
    const gathered = obj.goal;

    // Walk the last beat: into the safehouse, board the door, hold to dawn.
    const sh = g.world.safehouse;
    H.tp(sh.building.bounds.minX + 3, sh.bounds.minZ + 4);
    await H.wait(500);
    const returned = obj.goal;

    g.inventory.add('planks', 1);
    const boarded = g.world.buildBarricade();
    g.objectives.onBarricade();
    await H.wait(300);

    /**
     * Hold to dawn. Since the metagame pass this is no longer a win screen —
     * surviving night one rolls the run over into day two — so what is
     * asserted is the handover: the day counter turns, the run is still
     * alive, and the objective line has stopped talking about supplies and
     * started talking about the second day.
     */
    const dayBefore = g.run.day;
    H.setHour(5.6);
    await H.wait(300);
    g.time.paused = false;
    g.time.timeScale = 60;
    const t0 = this.sim;
    while (this.sim - t0 < 25 && g.run.day === dayBefore && g.state === 'playing') {
      await H.wait(120);
      g.survival.health = 100;
      g.survival.thirst = 80;
      g.survival.hunger = 80;
    }
    g.time.timeScale = 1;
    await this.shot('i_objective');
    this.record(
      'h · the gather → return → survive chain hands night one over to day two',
      g.run.day === dayBefore + 1 && g.run.state === 'alive' && g.state === 'playing',
      {
        afterGather: gathered,
        afterReturn: returned,
        boarded,
        finalGoal: obj.goal,
        objective: obj.title,
        gameState: g.state,
        day: g.run.day,
        nightsSurvived: g.run.nightsSurvived,
        hour: +g.time.hour.toFixed(2),
      }
    );
  }
}
