/**
 * CombatTests.js — dev-only duel suite for the combat pass
 * (loaded on demand by `H.combatTests()`).
 *
 * Every number the design brief asks for is measured here against the real
 * systems rather than asserted against the table it came from: the duels call
 * `Combat.resolveSwing`, the durability run wears a real inventory slot, and
 * the molotov test times real frames with real fire on screen.
 *
 * TTK is sampled rather than computed. Melee damage carries a ±12% roll, so a
 * single duel proves nothing; each pairing is fought `TRIALS` times from a
 * fresh body and the median is what gets compared.
 */

import CFG from '../core/Config.js';
import { WEAPONS } from '../systems/Items.js';
import { ARCHETYPES } from '../entities/Zombie.js';

const TRIALS = 9;
const MELEE = ['fists', 'knife', 'crowbar', 'bat', 'machete', 'axe', 'sledge'];
const KINDS = ['shambler', 'stalker', 'bloated'];

/** Somewhere flat, empty and reachable — the same lane the stealth suite uses. */
const ARENA = { x: -46, z: -2 };

export async function runAll(H, opts = {}) {
  const t = new Harness(H, opts);
  try {
    await t.ttkTable();
    await t.headAndLegs();
    await t.crippleToCrawler();
    await t.knockdownFinisher();
    await t.durabilityLifecycle();
    await t.molotov();
    await t.dodgeSpacing();
    await t.shoveInterrupt();
    await t.revolverZones();
  } finally {
    t.restore();
  }

  const failed = t.results.filter((r) => !r.pass);
  return {
    total: t.results.length,
    passed: t.results.length - failed.length,
    failed: failed.map((f) => f.name),
    results: t.results,
    ttk: t.ttk,
    shots: t.shots,
    errs: H.errs.slice(0, 8),
    errCount: H.errs.length,
  };
}

/** Just the TTK grid, for retuning without running the whole suite. */
export async function ttkOnly(H) {
  const t = new Harness(H, {});
  try {
    await t.ttkTable();
  } finally {
    t.restore();
  }
  return t.ttk;
}

class Harness {
  constructor(H, opts) {
    this.H = H;
    this.g = H.game;
    this.opts = opts;
    this.results = [];
    this.shots = [];
    this.ttk = {};
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
    this.g._render = this._origRender || this.g._render;
  }

  /**
   * Time the work the game actually does, in milliseconds of `_update` plus
   * `_render`, for `seconds` of simulated time.
   *
   * Deliberately *not* wall-clock frame deltas: the harness runs on setTimeout
   * so the sim keeps going in a hidden tab, and a hidden tab is exactly where
   * the browser clamps timers to once a second. Frame deltas measured there
   * say nothing about the game and everything about Chrome's throttling
   * policy. The time spent inside the two functions is immune to it.
   */
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
    const t0 = this.sim;
    while (this.sim - t0 < seconds) await this.H.wait(16);
    g._update = ou;
    g._render = orr;

    const stat = (a) => {
      const s = a.slice().sort((x, y) => x - y);
      return {
        median: +(s[Math.floor(s.length / 2)] || 0).toFixed(2),
        p95: +(s[Math.floor(s.length * 0.95)] || 0).toFixed(2),
      };
    };
    const total = u.map((v, i) => v + (r[i] || 0));
    return { update: stat(u), render: stat(r), total: stat(total), frames: u.length };
  }

  get sim() {
    return this._simT;
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

  // ─────────────────────────────────────────────────────────── staging ──

  /**
   * Clean slate: nothing alive, nothing burning, player parked in the lane
   * with full stamina and the game actually running.
   */
  async stage() {
    const g = this.g;
    if (g.state !== 'playing') {
      g.hud.hideWin();
      g.hud.hideDeath();
      g.state = 'playing';
    }
    this.H.begin();
    this.H.clearZombies();
    g.fire.clear();
    g.throwables.clear();
    g.horde._attackers.clear();
    this.H.tp(ARENA.x, ARENA.z);
    g.player.state = 'normal';
    g.player.dodging = null;
    g.player.finisher = null;
    g.player.reloading = null;
    g.player.attackLock = 0;
    g.player.dodgeCooldown = 0;
    g.player.shoveCooldown = 0;
    g.survival.health = 100;
    g.survival.stamina = 100;
    g.survival.exhausted = false;
    // Bleeding survives a health reset and ticks away in the background, which
    // is enough to make a later test think it took a hit it never took.
    g.survival.bleeding = 0;
    g.survival.dead = false;
    g.cameraRig.pitch = 0;
    await this.H.wait(60);
  }

  /**
   * One target, in front of the player, at exactly the archetype's base HP.
   *
   * The HP roll is removed on purpose: the brief quotes TTK against a *fresh*
   * shambler, and a ±15% roll on the body would smear every number in the
   * table by a hit either way.
   */
  spawnDummy(kind, dist = 1.2, solo = false) {
    const g = this.g;
    const p = g.player;
    /**
     * A duel is one body. Without this the director quietly refills the street
     * between trials, the horde hits `maxActive`, and every spawn after that
     * silently returns null — which reads as "the weapon does no damage".
     */
    if (solo) this.H.clearZombies();
    const z = g.horde.spawn(p.pos.x + Math.sin(p.yaw) * dist, p.pos.z + Math.cos(p.yaw) * dist, kind, 'test');
    if (!z) return null;
    // Put it exactly where we asked; `spawn` snaps to the nav grid.
    z.pos.x = p.pos.x + Math.sin(p.yaw) * dist;
    z.pos.z = p.pos.z + Math.cos(p.yaw) * dist;
    z.maxHp = ARCHETYPES[kind].hp;
    z.hp = z.maxHp;
    z.yaw = p.yaw + Math.PI;
    z.awareness = 1.2;            // no free backstab multiplier
    z.state = 'chase';
    z.rig.place(z.pos.x, z.pos.y, z.pos.z, z.yaw);
    return z;
  }

  /**
   * Swing until it dies, counting swings. Damage is resolved directly rather
   * than through the input queue so the count is exactly the number of
   * connecting hits and never a buffered miss.
   */
  duel(weaponId, kind, { pitch = 0, condMul = 1 } = {}) {
    const g = this.g;
    const w = WEAPONS[weaponId];
    const z = this.spawnDummy(kind, 1.2, true);
    if (!z) return -1;
    g.cameraRig.pitch = pitch;

    let hits = 0;
    for (let i = 0; i < 60 && !z.isDead; i++) {
      // Hold it still and awake: this measures damage, not pathing.
      z.pos.x = g.player.pos.x + Math.sin(g.player.yaw) * 1.2;
      z.pos.z = g.player.pos.z + Math.cos(g.player.yaw) * 1.2;
      z.state = z.downed ? 'down' : 'chase';
      z.awareness = 1.2;
      const r = g.combat.resolveSwing(g.player, w, { pitch, damageMul: condMul });
      if (r.hits > 0) hits++;
    }
    const dead = z.isDead;
    if (!dead) z.die(0, 1);
    return dead ? hits : -1;
  }

  median(list) {
    const s = list.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  // ────────────────────────────────────────────────────────────── tests ──

  /** Every melee weapon against every archetype, plus the revolver. */
  async ttkTable() {
    await this.stage();
    const targets = CFG.combat.ttk;

    for (const id of MELEE) {
      this.ttk[id] = {};
      for (const kind of KINDS) {
        const runs = [];
        for (let i = 0; i < TRIALS; i++) runs.push(this.duel(id, kind));
        this.ttk[id][kind] = this.median(runs);
      }
      const got = this.ttk[id].shambler;
      const want = targets[id];
      this.record(`ttk · ${id} vs shambler ≈ ${want}`, Math.abs(got - want) <= 1, {
        want,
        got,
        spread: this.ttk[id],
      });
    }

    // The revolver does not roll, so one shot of each kind is the whole story.
    await this.stage();
    this.ttk.revolver = {};
    for (const kind of KINDS) {
      this.ttk.revolver[kind] = {
        body: this.shootUntilDead(kind, 'body'),
        head: this.shootUntilDead(kind, 'head'),
      };
    }
    const rb = this.ttk.revolver.shambler.body;
    const rh = this.ttk.revolver.shambler.head;
    this.record(
      `ttk · revolver vs shambler ≈ ${targets.revolverBody} body / ${targets.revolverHead} head`,
      Math.abs(rb - targets.revolverBody) <= 1 && Math.abs(rh - targets.revolverHead) <= 1,
      { body: rb, head: rh, spread: this.ttk.revolver }
    );

    await this.stage();
    await this.shot('a_ttk');
  }

  /**
   * Aim a bullet at a band by picking the pitch that puts it there at the
   * target's distance, rather than by asking for a zone directly — that way
   * the height-band trace is what is under test, not a parameter.
   */
  shootUntilDead(kind, zone) {
    const g = this.g;
    const w = WEAPONS.revolver;
    const dist = 6;
    const z = this.spawnDummy(kind, dist, true);
    if (!z) return -1;
    const muzzleY = g.player.pos.y + 1.42;
    const wantY = z.pos.y + (zone === 'head' ? z.standHeight - 0.14 : z.standHeight * 0.62);
    const pitch = Math.atan2(wantY - muzzleY, dist);

    let shots = 0;
    for (let i = 0; i < 20 && !z.isDead; i++) {
      z.pos.x = g.player.pos.x + Math.sin(g.player.yaw) * dist;
      z.pos.z = g.player.pos.z + Math.cos(g.player.yaw) * dist;
      z.state = 'chase';
      g.player.chamber = 6;
      const r = g.combat.resolveShot(g.player, w, { pitch });
      if (r.hits > 0 && r.zone === zone) shots++;
      else if (r.hits > 0) return -2;        // landed in the wrong band
    }
    const dead = z.isDead;
    if (!dead) z.die(0, 1);
    return dead ? shots : -1;
  }

  /** The zone multipliers themselves, measured off real HP. */
  async headAndLegs() {
    await this.stage();
    const g = this.g;
    const w = WEAPONS.crowbar;
    const sample = (pitch) => {
      let total = 0;
      for (let i = 0; i < 12; i++) {
        const z = this.spawnDummy('shambler', 1.2, true);
        const before = z.hp;
        g.combat.resolveSwing(g.player, w, { pitch, damageMul: 1 });
        total += before - z.hp;
        z.die(0, 1);
      }
      return total / 12;
    };
    const body = sample(0);
    const head = sample(CFG.combat.zonePitchHigh + 0.1);
    const legs = sample(CFG.combat.zonePitchLow - 0.1);

    const headRatio = head / body;
    const legRatio = legs / body;
    this.record(
      'zones · head ×2 and legs ×0.7 off the same weapon',
      Math.abs(headRatio - CFG.combat.zoneMul.head) < 0.16 &&
        Math.abs(legRatio - CFG.combat.zoneMul.legs) < 0.1,
      {
        body: +body.toFixed(1),
        head: +head.toFixed(1),
        legs: +legs.toFixed(1),
        headRatio: +headRatio.toFixed(2),
        legRatio: +legRatio.toFixed(2),
      }
    );
  }

  /** Two legs and it is on the floor for good — and still trying. */
  async crippleToCrawler() {
    await this.stage();
    const g = this.g;
    const z = this.spawnDummy('shambler', 1.2, true);
    z.maxHp = z.hp = 4000;               // survive long enough to lose both legs
    const low = CFG.combat.zonePitchLow - 0.1;

    g.combat.resolveSwing(g.player, WEAPONS.knife, { pitch: low });
    const afterOne = { cripples: z.cripples, crawling: z.crawling, speed: z._spd(z.archetype.chase) };
    g.combat.resolveSwing(g.player, WEAPONS.knife, { pitch: low });
    const afterTwo = { cripples: z.cripples, crawling: z.crawling, speed: z._spd(z.archetype.chase) };

    const base = z.archetype.chase;
    const slowed = Math.abs(afterOne.speed / base - CFG.combat.crippleSpeedMul) < 0.02;

    // It has to still be a threat down there, not a decoration.
    z.hp = z.maxHp;
    g.player.pos.x = z.pos.x - 1.0;
    g.player.pos.z = z.pos.z;
    z.attackCooldown = 0;
    z.awareness = 1.4;
    // Not "reaches the attack state" — actually takes a piece out of you. A
    // crawler that could posture but never connect would be scenery.
    let reachedAttack = false;
    const hp0 = g.survival.health;
    for (let i = 0; i < 600 && g.survival.health >= hp0; i++) {
      g.horde.update(1 / 60, { player: g.player, night: false });
      if (z.state === 'attack') reachedAttack = true;
    }
    const bit = g.survival.health < hp0;

    await this.shot('b_crawler');
    this.record(
      'cripple · one leg −40% speed, two legs a crawler that still bites',
      afterOne.cripples === 1 && slowed && afterTwo.crawling && reachedAttack && bit,
      {
        afterOne,
        afterTwo,
        crawlSpeed: +afterTwo.speed.toFixed(2),
        reachedAttack,
        bitYou: bit,
        healthLost: +(hp0 - g.survival.health).toFixed(1),
        atRange: CFG.combat.crawlAttackRange,
      }
    );
    g.survival.health = 100;
  }

  /** Bat → floor → boot. */
  async knockdownFinisher() {
    await this.stage();
    const g = this.g;
    const z = this.spawnDummy('shambler', 1.2, true);
    z.hp = z.maxHp * (CFG.combat.knockdownHpFrac - 0.05);

    g.combat.resolveSwing(g.player, WEAPONS.bat, { pitch: 0, damageMul: 0.02 });
    const wentDown = z.downed;
    await this.shot('c_knockdown');

    // The prompt has to actually be reachable, not just the state.
    g.player.pos.x = z.pos.x - 1.1;
    g.player.pos.z = z.pos.z;
    const prompt = !!g._downedNear();

    const began = g.player.beginFinisher(z);
    const t0 = this.sim;
    while (this.sim - t0 < 1.6 && g.player.finisher) await this.H.wait(50);
    const took = this.sim - t0;

    this.record(
      'knockdown · bat floors a hurt target, E finishes it',
      wentDown && prompt && began && z.isDead,
      {
        wentDown,
        promptOffered: prompt,
        killed: z.isDead,
        commitment: +took.toFixed(2),
        target: CFG.combat.finisherTime,
      }
    );
  }

  /** Pristine → worn → failing → scrap → repaired. */
  async durabilityLifecycle() {
    await this.stage();
    const g = this.g;
    const D = CFG.durability;
    const w = WEAPONS.machete;

    g.inventory.slots.length = 0;
    g.inventory.add('machete', 1);
    g.inventory.equipWeapon('machete');

    const tiersSeen = [];
    let swings = 0;
    let broke = false;
    for (let i = 0; i < w.durability + 12 && !broke; i++) {
      const z = this.spawnDummy('shambler', 1.2, true);
      z.maxHp = z.hp = 5000;
      const mul = g.inventory.equippedDamageMul;
      if (!tiersSeen.length || tiersSeen[tiersSeen.length - 1].mul !== mul) {
        tiersSeen.push({ atSwing: swings, mul, cond: g.inventory.equippedCondition });
      }
      g._swing(w);
      swings++;
      z.die(0, 1);
      if (g.inventory.equipped === 'fists') broke = true;
    }

    const gone = !g.inventory.slots.some((s) => s.id === 'machete');
    const disarmed = g.player.attackLock > 0;

    // And back again: a failing weapon plus a tool roll is a worn one.
    g.inventory.slots.length = 0;
    g.inventory.add('machete', 1, 0.2);
    g.inventory.equipWeapon('machete');
    g.inventory.add('tools', 1);
    const toolsAt = g.inventory.slots.findIndex((s) => s.id === 'tools');
    const before = g.inventory.equippedCondition;
    g._repairEquipped(toolsAt);
    const after = g.inventory.equippedCondition;
    const toolsSpent = !g.inventory.has('tools');

    this.record(
      'durability · machete wears through three tiers, breaks, and a tool roll lifts it back one',
      broke &&
        gone &&
        disarmed &&
        tiersSeen.length === D.tiers.length &&
        after > before &&
        toolsSpent,
      {
        swingsToBreak: swings,
        rated: w.durability,
        tiers: tiersSeen.map((t) => `${t.atSwing}:×${t.mul}`),
        disarmedFor: +g.player.attackLock.toFixed(2),
        repaired: `${before.toFixed(2)} → ${after.toFixed(2)}`,
        toolsSpent,
      }
    );
  }

  /**
   * A molotov into a group: it has to hurt, it has to scare, it has to hurt
   * *you*, and it must not cost the frame rate.
   */
  async molotov() {
    await this.stage();
    const g = this.g;
    const p = g.player;

    const mob = [];
    for (let i = 0; i < 6; i++) {
      const z = g.horde.spawn(p.pos.x + 5 + (i % 3) * 0.9, p.pos.z + (i < 3 ? -0.9 : 0.9), 'shambler', 'test');
      if (z) {
        z.awareness = 1.2;
        z.state = 'chase';
        mob.push(z);
      }
    }
    const bloat = g.horde.spawn(p.pos.x + 5, p.pos.z + 2.4, 'bloated', 'test');
    await this.H.wait(80);

    const hpBefore = mob.map((z) => z.hp);

    // Baseline first: the same scene, the same seven bodies, no fire.
    const cold = await this.profile(1.2);

    g.fire.ignite(p.pos.x + 5, p.pos.z, CFG.fire.poolRadius, 40);

    let fled = 0;
    let bloatFled = false;
    const watch = () => {
      fled = Math.max(fled, mob.filter((z) => z.state === 'flee').length);
      if (bloat && bloat.state === 'flee') bloatFled = true;
    };
    const poll = setInterval(watch, 30);
    // Four pools, because the budget that matters is the worst case, not one.
    g.fire.ignite(p.pos.x + 6.4, p.pos.z + 1.6, CFG.fire.poolRadius, 40);
    g.fire.ignite(p.pos.x + 3.6, p.pos.z - 1.6, CFG.fire.poolRadius, 40);
    g.fire.ignite(p.pos.x + 6.4, p.pos.z - 2.4, CFG.fire.poolRadius, 40);
    const hot = await this.profile(2.6);
    clearInterval(poll);
    watch();
    const burned = mob.filter((z, i) => z.isDead || z.hp < hpBefore[i]).length;

    await this.shot('d_molotov');

    // And it does not care whose legs are in it. On its own, though: six
    // shamblers still swinging would be credited to the fire.
    g.fire.clear();
    this.H.clearZombies();
    g.survival.health = 100;
    g.survival.bleeding = 0;
    await this.H.wait(80);
    const hp0 = g.survival.health;
    g.fire.ignite(p.pos.x, p.pos.z, CFG.fire.poolRadius, 40);
    const t1 = this.sim;
    while (this.sim - t1 < 1.0) await this.H.wait(16);
    const selfHarm = hp0 - g.survival.health;
    const expectSelf = CFG.fire.dpsPlayer * 1.0;

    const cost = +(hot.total.median - cold.total.median).toFixed(2);
    this.record(
      'molotov · burns a group, routs the ones that can run, burns you too, and costs almost nothing',
      burned >= 3 && fled >= 2 && !bloatFled && selfHarm > 1 && cost < 2.5,
      {
        burned,
        ofGroup: mob.length,
        routed: fled,
        bloatedStoodItsGround: !bloatFled,
        selfHarm: +selfHarm.toFixed(1),
        selfHarmExpected: +expectSelf.toFixed(1),
        simMs: {
          quiet: cold.total,
          fourPoolsBurning: hot.total,
          cost,
          updateQuiet: cold.update.median,
          updateBurning: hot.update.median,
          renderQuiet: cold.render.median,
          renderBurning: hot.render.median,
        },
        poolCap: CFG.fire.maxPools,
        lightCap: CFG.fire.maxLights,
      }
    );
    g.fire.clear();
    g.survival.health = 100;
  }

  /**
   * Dodging out of a windup. No invulnerability exists, so the only thing that
   * can save you is the two metres — which means the test is a distance test.
   */
  async dodgeSpacing() {
    const away = await this._dodgeTrial(-1);
    const into = await this._dodgeTrial(+1);

    await this.shot('e_dodge');
    this.record(
      'dodge · spacing beats a committed windup, and dodging into one does not',
      away.committed && away.dodged && away.gained > 1.4 && !away.tookHit &&
        into.committed && into.dodged && into.tookHit,
      {
        awayFromIt: away,
        straightIntoIt: into,
        note: 'no i-frames: the same dodge into the swing still eats it',
        staminaSpent: CFG.combat.dodgeStamina,
      }
    );
  }

  /**
   * One committed swing, dodged in one direction, judged on that swing alone.
   *
   * The window closes the moment the zombie's attack resolves — measuring
   * "did anything hit me in the next second" would only prove that a shambler
   * can walk two metres in a second, which it can.
   *
   * @param sign  -1 to dodge away from it, +1 to dodge into it
   */
  async _dodgeTrial(sign) {
    await this.stage();
    const g = this.g;
    const p = g.player;
    const z = this.spawnDummy('shambler', 1.4, true);
    z.attackCooldown = 0;

    // Let the real loop bring it to a windup. Nothing is stepped by hand here:
    // pumping the horde manually while the game loop also runs double-steps
    // the AI and quietly makes every zombie twice as fast.
    const t0 = this.sim;
    while (this.sim - t0 < 4 && z.state !== 'attack') await this.H.wait(16);
    const committed = z.state === 'attack';
    const d0 = Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z);

    /**
     * Watch for the hit itself rather than for the health bar moving. Bleed
     * ticks, hunger and a stray second attacker all move health; only this
     * says "that swing connected".
     */
    let struck = 0;
    const orig = p.takeHit.bind(p);
    p.takeHit = (...args) => {
      struck++;
      return orig(...args);
    };

    const dodged = p.tryDodge(sign * (z.pos.x - p.pos.x), sign * (z.pos.z - p.pos.z));

    // Run until that specific swing has resolved.
    const t1 = this.sim;
    while (this.sim - t1 < 2 && !z.hasSwung) await this.H.wait(16);
    await this.H.wait(60);
    const d1 = Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z);
    p.takeHit = orig;
    const tookHit = struck > 0;
    g.survival.health = 100;
    g.survival.bleeding = 0;

    return {
      committed,
      dodged,
      before: +d0.toFixed(2),
      atContact: +d1.toFixed(2),
      gained: +(d1 - d0).toFixed(2),
      tookHit,
      reach: +(z.attackReach + 0.42).toFixed(2),
    };
  }

  /** Shove: no damage, an interrupted windup, and a metre and a half. */
  async shoveInterrupt() {
    await this.stage();
    const g = this.g;
    const p = g.player;
    const z = this.spawnDummy('shambler', 1.5, true);
    z.attackCooldown = 0;

    const t0 = this.sim;
    while (this.sim - t0 < 4 && z.state !== 'attack') await this.H.wait(16);
    const committed = z.state === 'attack';
    const hpBefore = z.hp;
    // Measured as the body's own displacement, not the gap to the player —
    // the player is free to drift and would smear the number.
    const from = { x: z.pos.x, z: z.pos.z };
    const swungBefore = z.hasSwung;

    const res = g.combat.resolveShove(p);
    const t1 = this.sim;
    while (this.sim - t1 < CFG.combat.shovePushTime + 0.05 && z.push) await this.H.wait(16);
    const moved = Math.hypot(z.pos.x - from.x, z.pos.z - from.z);

    await this.shot('f_shove');
    this.record(
      'shove · interrupts the windup, deals nothing, buys ~1.5 m',
      committed &&
        res.hit &&
        res.interrupted &&
        !swungBefore &&
        z.hp === hpBefore &&
        Math.abs(moved - CFG.combat.shoveDistance) < 0.25,
      {
        committed,
        interrupted: res.interrupted,
        landedItsSwing: z.hasSwung && z.state === 'attack',
        damageDealt: +(hpBefore - z.hp).toFixed(2),
        pushed: +moved.toFixed(2),
        target: CFG.combat.shoveDistance,
        stamina: CFG.combat.shoveStamina,
      }
    );
  }

  /** Aim high and you miss entirely; aim at nothing and nothing happens. */
  async revolverZones() {
    await this.stage();
    const g = this.g;
    const w = WEAPONS.revolver;
    const dist = 7;
    const z = this.spawnDummy('shambler', dist, true);
    z.maxHp = z.hp = 5000;
    const muzzleY = g.player.pos.y + 1.42;

    const at = (y) => {
      z.hp = 5000;
      g.player.chamber = 6;
      const pitch = Math.atan2(z.pos.y + y - muzzleY, dist);
      return g.combat.resolveShot(g.player, w, { pitch });
    };

    const head = at(z.standHeight - 0.12);
    const body = at(z.standHeight * 0.6);
    const legs = at(0.3);
    const over = at(z.standHeight + 0.7);

    z.die(0, 1);
    this.record(
      'revolver · the bullet has a height, and over its head is a miss',
      head.zone === 'head' && body.zone === 'body' && legs.zone === 'legs' && over.hits === 0,
      {
        head: head.zone,
        body: body.zone,
        legs: legs.zone,
        overhead: over.zone,
        standHeight: +z.standHeight.toFixed(2),
      }
    );
  }
}
