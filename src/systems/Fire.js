/**
 * Fire.js — burning ground.
 *
 * A molotov is the only thing in the game that hurts a crowd, so it has to be
 * expensive in a way that is felt rather than read off a number. It is:
 * the light gives your position to the whole street, the pool sits where it
 * landed and not where the fight moves to, and it does not care whose legs are
 * in it.
 *
 * The budget is deliberate and hard-capped. Four pools, two lights between
 * them, and a particle rate that scales down as more pools burn — a molotov
 * thrown into a group must never be the moment the frame rate dies.
 */

import * as THREE from 'three';
import CFG from '../core/Config.js';
import { clamp01 } from '../core/Utils.js';

export class Fire {
  constructor(scene, world, audio, noise, particles) {
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.noise = noise;
    this.particles = particles;

    this.pools = [];
    this._scratch = [];
    this._buf = [];

    /**
     * The lights are a fixed pool, handed to whichever fires are burning
     * brightest right now. Two point lights is the entire budget: three would
     * mean re-compiling every material in the scene the first time a third
     * molotov goes off.
     */
    this._lights = [];
    for (let i = 0; i < CFG.fire.maxLights; i++) {
      const l = new THREE.PointLight(0xff8a2e, 0, CFG.fire.lightRange, 1.7);
      l.castShadow = false;
      l.visible = false;
      scene.add(l);
      this._lights.push(l);
    }
  }

  get burning() {
    return this.pools.length;
  }

  /**
   * Show the light pool without lighting anything, so the renderer can be
   * asked to compile the shaders for "fire is burning" before any fire is.
   *
   * three.js bakes the light count into every material's program, and a light
   * with `visible = false` is not counted — so the frame a molotov lands is
   * the frame every material in the scene recompiles. Measured at 150–220 ms
   * on this map, which is a visible lurch at exactly the worst moment. Warming
   * it at load costs nothing anybody sees.
   */
  warmLights(on) {
    for (const l of this._lights) {
      l.visible = on;
      l.intensity = 0;
    }
  }

  /**
   * Light a patch of road.
   *
   * @returns the pool, or the recycled one if we were already at the cap.
   */
  ignite(x, z, radius = CFG.fire.poolRadius, life = CFG.fire.poolTime) {
    const y = this.world.collision.groundHeightAt(x, z, 2.4, this._scratch);

    // At the cap the oldest fire goes out to make room. Better than refusing
    // the throw: the player pressed the button and something must happen.
    if (this.pools.length >= CFG.fire.maxPools) this.pools.shift();

    const pool = { x, y, z, radius, life, maxLife: life, seeded: 0 };
    this.pools.push(pool);

    this.audio.glassBreak(x, z);
    this.audio.noiseBurst({ dur: 0.7, type: 'lowpass', freq: 620, gain: 0.4, sweepTo: 180, reverb: 0.4 });
    this.noise.emit(x, z, CFG.fire.igniteNoise, 'player', 'fire');
    this.particles.sparks(x, y + 0.2, z, 22);
    return pool;
  }

  /**
   * @param ctx { horde, player, onPlayerBurn }
   */
  update(dt, ctx) {
    if (!this.pools.length) {
      for (const l of this._lights) if (l.visible) l.visible = false;
      return;
    }

    for (let i = this.pools.length - 1; i >= 0; i--) {
      const p = this.pools[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.pools.splice(i, 1);
        continue;
      }
      this._flames(p, dt);
      this._burn(p, dt, ctx);
    }

    this._lightPass();
  }

  /**
   * Flame particles. The rate is divided between the live pools so the total
   * cost of "everything is on fire" is the same as the cost of one fire.
   */
  _flames(p, dt) {
    const F = CFG.fire;
    const strength = clamp01(p.life / Math.min(1.2, p.maxLife)) * clamp01(p.life / p.maxLife + 0.35);
    p.seeded += (dt * F.particlesPerSecond * strength) / Math.max(1, this.pools.length);
    let n = Math.floor(p.seeded);
    p.seeded -= n;
    while (n-- > 0) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * p.radius * 0.85;
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      const hot = Math.random();
      this.particles._spawn(
        x,
        p.y + 0.05,
        z,
        (Math.random() - 0.5) * 0.5,
        1.4 + Math.random() * 2.3,
        (Math.random() - 0.5) * 0.5,
        1.0,
        0.34 + hot * 0.5,
        0.06 + hot * 0.14,
        0.1 + Math.random() * 0.14,
        0.3 + Math.random() * 0.45,
        1.4                                   // flame rises
      );
    }
  }

  /**
   * Everything standing in it. Fire is damage with no author — it does not
   * tell them where you are, which is the entire reason it is worth throwing
   * from behind something.
   */
  _burn(p, dt, ctx) {
    const F = CFG.fire;
    const horde = ctx.horde;
    if (horde) {
      const list = horde.query(p.x, p.z, p.radius + F.fleeRadius, this._buf);
      for (const z of list) {
        const d = Math.hypot(z.pos.x - p.x, z.pos.z - p.z);
        if (d <= p.radius + z.radius) {
          const killed = z.scorch(F.dpsZombie * dt);
          if (killed) ctx.onBurnKill?.(z);
        }
        // Terror reaches further than the flames do. That is what makes a
        // molotov a crowd-control tool rather than a damage one.
        if (d <= p.radius + F.fleeRadius) z.terrify(p.x, p.z);
      }
    }

    const pl = ctx.player;
    if (pl && pl.state !== 'dead' && !pl.hidden) {
      const d = Math.hypot(pl.pos.x - p.x, pl.pos.z - p.z);
      if (d <= p.radius + 0.4) ctx.onPlayerBurn?.(F.dpsPlayer * dt);
    }
  }

  /** Hand the two lights to the two strongest fires, and flicker them. */
  _lightPass() {
    const F = CFG.fire;
    const sorted = this.pools.slice().sort((a, b) => b.life - a.life);
    for (let i = 0; i < this._lights.length; i++) {
      const l = this._lights[i];
      const p = sorted[i];
      if (!p) {
        l.visible = false;
        continue;
      }
      const fade = clamp01(p.life / 1.4);
      l.visible = true;
      l.position.set(p.x, p.y + 0.7, p.z);
      l.intensity = F.lightIntensity * fade * (0.75 + Math.random() * 0.45);
    }
  }

  clear() {
    this.pools.length = 0;
    for (const l of this._lights) l.visible = false;
  }
}

export default Fire;
