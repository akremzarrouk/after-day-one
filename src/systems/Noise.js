/**
 * Noise.js — the world's ears.
 *
 * Anything the player (or a zombie) does that makes a sound pushes an event
 * here. Zombies poll it each frame. Events live for a fraction of a second;
 * they are a broadcast, not a persistent marker.
 *
 * This is the system that makes "if I fight this one, the others will hear"
 * actually true.
 */

export class NoiseField {
  constructor() {
    this.events = [];
    this.playerNoise = 0;      // 0..1, drives the HUD noise meter
    this._decay = 0;
  }

  /**
   * @param x,z      world position
   * @param radius   metres this sound carries
   * @param source   'player' | 'zombie' | 'world'
   * @param kind     descriptive tag
   */
  emit(x, z, radius, source = 'player', kind = 'generic') {
    this.events.push({ x, z, radius, source, kind, life: 0.22 });
    if (this.events.length > 96) this.events.shift();
    if (source === 'player') {
      this.playerNoise = Math.max(this.playerNoise, Math.min(1, radius / 40));
    }
  }

  update(dt) {
    for (let i = this.events.length - 1; i >= 0; i--) {
      this.events[i].life -= dt;
      if (this.events[i].life <= 0) this.events.splice(i, 1);
    }
    this.playerNoise = Math.max(0, this.playerNoise - dt * 0.85);
  }

  /**
   * Loudest event audible at (x,z), or null.
   *
   * @param occlude  optional (ex, ez) → 0..1 multiplier applied to the event's
   *                 radius. This is how walls and shut doors get a say: the
   *                 listener supplies the test, so the noise field itself
   *                 stays ignorant of geometry.
   */
  strongestAt(x, z, sensitivity = 1, occlude = null) {
    let best = null;
    let bestScore = 0;
    for (const e of this.events) {
      const dx = e.x - x,
        dz = e.z - z;
      const d = Math.sqrt(dx * dx + dz * dz);
      let r = e.radius * sensitivity;
      if (d > r) continue;                       // cheap reject before the raycast
      if (occlude) {
        r *= occlude(e.x, e.z);
        if (d > r) continue;
      }
      const score = 1 - d / r;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best ? { ...best, strength: bestScore } : null;
  }

  clear() {
    this.events.length = 0;
    this.playerNoise = 0;
  }
}
