/**
 * AnimShots.js — dev-only capture rig (loaded on demand by `H.captureAll()`).
 *
 * Freezes the simulation, stages one character at a time and photographs it
 * with a camera we control, so the whole animation-state matrix can be
 * re-shot identically after any change. Nothing here runs in a normal session.
 */

export function captureAll(H, opts = {}) {
  return run(H, opts);
}

async function run(H, opts) {
  const g = H.game;
  const tag = opts.tag || '';
  const hour = opts.hour ?? 13;
  const out = [];

  H.begin();
  H.setHour(hour);
  H.tp(2.5, 50);
  g.survival.health = 100;
  g.survival.dead = false;
  g.player.state = 'normal';
  g.player.rig.reset();
  await H.wait(350);
  H.clearZombies();
  H.freeze(true);

  const P = g.player;
  for (const it of ['kitchen_knife', 'crowbar', 'baseball_bat', 'fire_axe', 'revolver', 'ammo_38'])
    g.inventory.add(it, 1);
  const setWeapon = (id) => {
    if (!g.inventory.equipWeapon(id)) throw new Error('cannot equip ' + id);
    P.syncWeaponMesh();
  };

  /** Point the camera at a subject: 3/4 front, eye height, close. */
  const frame = (obj, { dist = 3.1, yaw = 0.62, h = 1.05 } = {}) => {
    const p = obj.pos;
    const c = g.camera;
    c.position.set(p.x + Math.sin(yaw) * dist, p.y + h + dist * 0.16, p.z + Math.cos(yaw) * dist);
    c.lookAt(p.x, p.y + 0.92, p.z);
    c.updateMatrixWorld(true);
  };
  const shoot = async (name, obj, fopts) => {
    frame(obj, fopts);
    out.push(await H.shot(name));
  };

  // ── player: face the camera ──
  P.yaw = 0.62;              // face the staging camera
  setWeapon('bat');

  const pshot = async (name) => {
    P.rig.place(P.pos.x, P.pos.y, P.pos.z, P.yaw);
    await shoot(name, P);
  };

  H.stepAnim(P, 'idle', 1.2, 0);
  await pshot(`p_idle${tag}`);

  H.stepAnim(P, 'walk', 1.05, 3.05);
  await pshot(`p_walk${tag}`);

  H.stepAnim(P, 'run', 0.8, 6.0);
  await pshot(`p_run${tag}`);

  H.stepAnim(P, 'idle', 0.4, 0);
  H.stepAttack(P, 'light', 0.26, 0.9, 0.52);
  await pshot(`p_attack${tag}`);

  // the swing, frame by frame, to confirm the contact pose lands on windup end
  for (const at of [0.15, 0.29, 0.42, 0.62, 0.85]) {
    P.anim.cancelOneShot();
    H.stepAnim(P, 'idle', 0.25, 0);
    H.stepAttack(P, 'light', 0.26, 0.9, at);
    await pshot(`p_swing_${String(Math.round(at * 100)).padStart(2, '0')}${tag}`);
  }

  P.anim.cancelOneShot();
  H.stepAnim(P, 'block', 0.2, 0);
  for (let i = 0; i < 40; i++) P.anim.update(1 / 60, { speed: 0, blocking: true });
  await pshot(`p_block${tag}`);

  P.anim.request('idle');
  for (let i = 0; i < 12; i++) P.anim.update(1 / 60, { speed: 0 });
  H.stepAnim(P, 'stagger', 0.22, 0);
  await pshot(`p_stagger${tag}`);

  P.rig.beginDeath(0.28);
  for (let i = 0; i < 80; i++) {
    P.anim.update(1 / 60, { speed: 0 });
    P.rig.updateDeath(i / 60);
  }
  await pshot(`p_death${tag}`);

  P.rig.reset();
  setWeapon('revolver');
  H.stepAnim(P, 'idle', 0.5, 0);
  for (let i = 0; i < 20; i++) P.anim.update(1 / 60, { speed: 0, aiming: true });
  P.anim.recoil();
  for (let i = 0; i < 3; i++) P.anim.update(1 / 60, { speed: 0, aiming: true });
  await pshot(`p_shoot${tag}`);

  for (const w of ['knife', 'crowbar', 'bat', 'axe', 'revolver']) {
    setWeapon(w);
    P.anim.request('idle');
    for (let i = 0; i < 40; i++) P.anim.update(1 / 60, { speed: 0, carrying: true });
    await pshot(`w_${w}${tag}`);
  }
  setWeapon('bat');
  H.stepAnim(P, 'idle', 0.5, 0);
  P.rig.place(P.pos.x, P.pos.y, P.pos.z, P.yaw);

  // ── zombies ──
  const states = [['idle', 0], ['shamble', 0.95], ['lurch', 2.0], ['chase', 2.9], ['stagger', 0]];
  for (const type of ['shambler', 'stalker', 'bloated']) {
    H.clearZombies();
    const z = H.place(type, 0, -4.0);
    if (!z) continue;
    z.yaw = 0.62;
    for (const [st, sp] of states) {
      H.stepAnim(z, st, 1.15, sp);
      z.rig.place(z.pos.x, z.pos.y, z.pos.z, z.yaw);
      await shoot(`z_${type}_${st}${tag}`, z);
    }
    H.stepAnim(z, 'idle', 0.2, 0);
    H.stepAttack(z, 'light', 0.54, 1.42, 0.56);
    z.rig.place(z.pos.x, z.pos.y, z.pos.z, z.yaw);
    await shoot(`z_${type}_attack${tag}`, z);

    z.anim.cancelOneShot();
    z.rig.beginDeath(0.72);
    for (let i = 0; i < 90; i++) {
      z.anim.update(1 / 60, { speed: 0 });
      z.rig.updateDeath(i / 60);
    }
    z.rig.place(z.pos.x, z.pos.y, z.pos.z, z.yaw);
    await shoot(`z_${type}_death${tag}`, z, { dist: 3.6, h: 0.5 });
  }

  // ── eight variants of one archetype, side by side ──
  H.clearZombies();
  const line = [];
  for (let i = 0; i < 8; i++) {
    const z = H.place('shambler', (i - 3.5) * 1.25, -7.5);
    if (!z) continue;
    z.yaw = Math.PI;
    H.stepAnim(z, 'shamble', 0.4 + i * 0.13, 0.95);
    z.rig.place(z.pos.x, z.pos.y, z.pos.z, z.yaw);
    line.push(z);
  }
  {
    const c = g.camera;
    c.position.set(P.pos.x, P.pos.y + 2.0, P.pos.z - 1.5);
    c.lookAt(P.pos.x, P.pos.y + 1.0, P.pos.z - 7.5);
    c.updateMatrixWorld(true);
    out.push(await H.shot(`variants${tag}`));
  }

  // ── silhouette check: one of each at 30 m, on open ground ──
  H.clearZombies();
  const home = { x: P.pos.x, z: P.pos.z };
  P.pos.set(26, 0, 62);                 // the open field east of the road
  const far = [];
  for (const [i, t] of ['shambler', 'stalker', 'bloated'].entries()) {
    const z = H.place(t, (i - 1) * 3.2, -30);
    if (!z) continue;
    z.pos.set(P.pos.x + (i - 1) * 3.2, 0, P.pos.z - 30);
    z.yaw = Math.PI;
    H.stepAnim(z, 'chase', 0.5 + i * 0.3, 2.8);
    z.rig.place(z.pos.x, z.pos.y, z.pos.z, z.yaw);
    far.push({ t, d: +Math.hypot(z.pos.x - P.pos.x, z.pos.z - P.pos.z).toFixed(1) });
  }
  {
    const c = g.camera;
    c.position.set(P.pos.x, P.pos.y + 1.7, P.pos.z + 0.6);
    c.lookAt(P.pos.x, P.pos.y + 1.45, P.pos.z - 30);
    c.updateMatrixWorld(true);
    out.push(await H.shot(`silhouette30${tag}`));
  }
  P.pos.set(home.x, 0, home.z);

  // ── the money shot ──
  H.clearZombies();
  const layout = [
    ['shambler', -1.6, -6.2], ['stalker', 0.9, -7.6], ['bloated', -3.0, -9.2],
    ['shambler', 2.9, -11.0], ['shambler', 0.2, -13.5], ['stalker', -4.4, -12.5],
  ];
  const crowd = [];
  for (const [t, dx, dz] of layout) {
    const z = H.place(t, dx, dz);
    if (z) {
      z.yaw = Math.atan2(P.pos.x - z.pos.x, P.pos.z - z.pos.z);
      H.stepAnim(z, 'chase', 0.4 + Math.random() * 1.1, 2.8);
      z.rig.place(z.pos.x, z.pos.y, z.pos.z, z.yaw);
      crowd.push(z);
    }
  }
  P.yaw = Math.PI;
  H.stepAnim(P, 'idle', 0.5, 0);
  P.rig.place(P.pos.x, P.pos.y, P.pos.z, P.yaw);
  {
    const c = g.camera;
    c.position.set(P.pos.x + 0.55, P.pos.y + 1.62, P.pos.z + 3.3);
    c.lookAt(P.pos.x + 0.2, P.pos.y + 1.15, P.pos.z - 8);
    c.updateMatrixWorld(true);
    out.push(await H.shot(`crowd${tag}`));
  }

  H.clearZombies();
  H.freeze(false);
  return { shots: out.length, silhouetteDistances: far, errs: H.errs };
}
