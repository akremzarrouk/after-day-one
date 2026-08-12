/**
 * Save.js — a run, written down.
 *
 * Deliberately the smallest thing that can put you back where you were:
 * where the clock is, where you are, what you are carrying, what is in the
 * stash, which doors are boarded and to what tier, which containers are empty,
 * what you have built, and what the radio has told you. Everything else — the
 * horde, the corpses, the decals, the fires — is weather, and weather is
 * regenerated rather than restored.
 *
 * Nothing here talks to the network and nothing here is asynchronous. One JSON
 * blob in `localStorage`, versioned, and a `capture`/`apply` pair with no
 * knowledge of any system beyond the handful of `serialize()` methods it calls.
 * That shape is on purpose: a proper save/load pass can formalise slots,
 * migrations and a menu around these two functions without touching them.
 */

const KEY = 'after.run.v1';
const VERSION = 1;

/** Is there a run to go back to? */
export function hasSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    return d && d.v === VERSION && d.run && d.run.state === 'alive';
  } catch (e) {
    return false;
  }
}

export function peek() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!d || d.v !== VERSION) return null;
    return { day: d.run?.day ?? 1, hour: d.time?.hour ?? 0, night: d.run?.nightsSurvived ?? 0 };
  } catch (e) {
    return null;
  }
}

export function clear() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    /* a browser that will not store is a browser that plays without saves */
  }
}

/**
 * Snapshot the live game.
 *
 * Openings and containers are keyed by their own stable ids rather than by
 * array index, so adding a window to a house next week does not silently move
 * somebody's boarded door onto a different wall.
 */
export function capture(game) {
  const g = game;
  return {
    v: VERSION,
    at: Date.now(),
    time: {
      hour: +g.time.hour.toFixed(3),
      day: g.time.day,
      elapsedHours: +g.time.elapsedHours.toFixed(3),
    },
    run: g.run.serialize(),
    radio: g.radio.serialize(),
    player: {
      x: +g.player.pos.x.toFixed(2),
      z: +g.player.pos.z.toFixed(2),
      yaw: +g.player.yaw.toFixed(3),
      health: +g.survival.health.toFixed(1),
      stamina: +g.survival.stamina.toFixed(1),
      thirst: +g.survival.thirst.toFixed(1),
      hunger: +g.survival.hunger.toFixed(1),
      bleeding: +g.survival.bleeding.toFixed(2),
      battery: +(g.player.battery || 0).toFixed(1),
      flashlight: !!g.player.flashlightOn,
    },
    inventory: g.inventory.serialize(),
    base: g.base.serialize(),
    openings: g.world.openings.map((op) => op.serialize()),
    containers: g.world.interactables
      .filter((it) => it.type === 'container')
      .map((it) => ({ id: it.id, r: it.richness, thin: !!it.thin, l: !!it.looted })),
    notes: [...g.world.notesRead],
  };
}

export function save(game) {
  try {
    localStorage.setItem(KEY, JSON.stringify(capture(game)));
    return true;
  } catch (e) {
    console.warn('[save] could not write', e);
    return false;
  }
}

export function read() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    return d && d.v === VERSION ? d : null;
  } catch (e) {
    return null;
  }
}

/**
 * Put a snapshot back into a freshly reset game.
 *
 * Order matters exactly once: the world's openings have to be restored before
 * the nav grid is rebuilt, and the horde has to be repopulated afterwards, so
 * that nothing paths through a door that is about to be boarded.
 */
export function apply(game, data) {
  const d = data || read();
  if (!d) return false;
  const g = game;

  g.time.hour = d.time.hour;
  g.time.day = d.time.day;
  g.time.elapsedHours = d.time.elapsedHours;

  g.run.restore(d.run, g.world);
  g.radio.restore(d.radio);

  const p = d.player;
  g.player.spawn({ x: p.x, y: 0, z: p.z });
  g.player.yaw = p.yaw;
  g.player.battery = p.battery || 0;
  g.player.flashlightOn = false;
  g.survival.health = p.health;
  g.survival.stamina = p.stamina;
  g.survival.thirst = p.thirst;
  g.survival.hunger = p.hunger;
  g.survival.bleeding = p.bleeding || 0;
  g.survival.dead = false;

  g.inventory.slots.length = 0;
  for (const s of d.inventory.slots || []) g.inventory.slots.push({ ...s });
  g.inventory.equipped = d.inventory.equipped || 'fists';

  const byId = new Map(g.world.openings.map((op) => [op.id, op]));
  for (const s of d.openings || []) byId.get(s.id)?.restore(s);

  const cont = new Map(
    g.world.interactables.filter((it) => it.type === 'container').map((it) => [it.id, it])
  );
  for (const s of d.containers || []) {
    const it = cont.get(s.id);
    if (!it) continue;
    it.richness = s.r;
    it.thin = !!s.thin;
    it.looted = !!s.l;
    it.used = it.richness <= 0;
  }

  g.world.notesRead = new Set(d.notes || []);
  g.base.restore(d.base);

  g.world.nav.build(g.world.collision, 0.34);
  g.horde.reset();
  g.horde.spawnFromWorld();

  return true;
}
