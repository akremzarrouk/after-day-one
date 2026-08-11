/**
 * Throwables.js — bottles and cans in flight.
 *
 * The whole point of this system is one sentence: you can make a noise
 * somewhere you are not. Everything else about it — the arc, the tumble, the
 * shatter — is there to make that decision legible while it happens, so you
 * can watch the bottle land and watch them turn toward it.
 *
 * Ballistics are deliberately dumb: gravity, a swept segment against the
 * collision world, and a ground test. A thrown bottle lives for under two
 * seconds and nobody is going to measure its drag coefficient.
 */

import * as THREE from 'three';
import CFG from '../core/Config.js';

const MAX_LIVE = 12;

export class Throwables {
  constructor(scene, world, audio, noise, particles) {
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.noise = noise;
    this.particles = particles;

    this.live = [];
    this._scratch = [];

    // One geometry and one material per kind for everything ever thrown.
    this._geo = {
      bottle: new THREE.CylinderGeometry(0.035, 0.045, 0.24, 7),
      can: new THREE.CylinderGeometry(0.037, 0.037, 0.12, 8),
      molotov: new THREE.CylinderGeometry(0.04, 0.05, 0.26, 7),
    };
    this._mat = {
      bottle: new THREE.MeshStandardMaterial({ color: 0x3f5a48, roughness: 0.25, metalness: 0.1 }),
      can: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.45, metalness: 0.55 }),
      molotov: new THREE.MeshStandardMaterial({
        color: 0x6a4a1e,
        roughness: 0.3,
        metalness: 0.05,
        emissive: 0xd05a12,
        emissiveIntensity: 1.4,
      }),
    };
    this._pool = [];

    /** Set by Game: a lit bottle turns into a fire wherever it lands. */
    this.onIncendiary = null;
  }

  /**
   * @param kind    'bottle' | 'can'
   * @param from    THREE.Vector3 release point
   * @param yaw     facing
   * @param pitch   camera pitch, so looking up throws further
   */
  throwItem(kind, from, yaw, pitch = 0) {
    if (this.live.length >= MAX_LIVE) this._retire(this.live[0], false);

    const T = CFG.throwing;
    const mesh = this._pool.pop() || new THREE.Mesh(this._geo.bottle, this._mat.bottle);
    mesh.geometry = this._geo[kind] || this._geo.bottle;
    mesh.material = this._mat[kind] || this._mat.bottle;
    mesh.castShadow = true;
    mesh.visible = true;
    mesh.position.copy(from);
    this.scene.add(mesh);

    const cp = Math.cos(pitch);
    const p = {
      kind,
      mesh,
      x: from.x,
      y: from.y,
      z: from.z,
      vx: Math.sin(yaw) * cp * T.speed,
      vy: (Math.sin(pitch) + T.arc) * T.speed,
      vz: Math.cos(yaw) * cp * T.speed,
      spin: 8 + Math.random() * 6,
      life: 0,
    };
    this.live.push(p);
    return p;
  }

  update(dt) {
    const T = CFG.throwing;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life += dt;
      p.vy += T.gravity * dt;

      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;
      const nz = p.z + p.vz * dt;

      // Ground first — most throws end on the road.
      const gy = this.world.collision.groundHeightAt(nx, nz, Math.max(p.y, ny) + 0.4, this._scratch);
      let landed = ny <= gy + 0.04 && p.vy < 0;
      let lx = nx,
        ly = gy,
        lz = nz;

      // Then anything solid it flew into.
      if (!landed) {
        const hit = this.world.collision.raycast(p.x, p.z, nx, nz, Math.max(0.1, ny), this._scratch);
        if (hit && hit.t <= 1) {
          landed = true;
          lx = p.x + (nx - p.x) * hit.t;
          ly = ny;
          lz = p.z + (nz - p.z) * hit.t;
        }
      }

      if (landed) {
        this._land(p, lx, ly, lz);
        this._retire(p, true);
        this.live.splice(i, 1);
        continue;
      }

      p.x = nx;
      p.y = ny;
      p.z = nz;
      p.mesh.position.set(nx, ny, nz);
      p.mesh.rotation.x += p.spin * dt;
      p.mesh.rotation.z += p.spin * 0.6 * dt;

      if (p.life > 6) {
        this._retire(p, false);
        this.live.splice(i, 1);
      }
    }
  }

  /**
   * The payload. A bottle shatters and is gone; a can clatters, is quieter,
   * and you can go back for it — which is the trade the two of them exist to
   * offer.
   */
  _land(p, x, y, z) {
    /**
     * A lit one owns its landing completely: the fire makes its own noise, its
     * own glass sound and its own light, so nothing below runs for it.
     */
    if (p.kind === 'molotov') {
      this.lastLanding = { x, z, kind: p.kind, radius: CFG.fire?.igniteNoise ?? 22 };
      this.onIncendiary?.(x, y, z);
      return;
    }

    const shatters = p.kind === 'bottle';
    if (shatters) {
      this.audio.glassBreak(x, z);
      this.particles?.sparks?.(x, y + 0.12, z, 7);
      this.particles?.dust?.(x, y + 0.05, z, 6, 0.7);
    } else {
      this.audio.impact('hit_metal', x, z);
      setTimeout(() => this.audio.impact('hit_metal', x, z), 130);
      setTimeout(() => this.audio.impact('hit_metal', x, z), 240);
    }
    const radius = shatters ? CFG.throwing.landNoise : CFG.throwing.landNoise * 0.72;
    // Attributed to the player so zombies treat it as worth investigating,
    // but emitted where it landed — that is the whole trick.
    this.noise.emit(x, z, radius, 'player', 'throw');
    this.lastLanding = { x, z, kind: p.kind, radius };
  }

  _retire(p, quiet) {
    this.scene.remove(p.mesh);
    if (this._pool.length < MAX_LIVE) this._pool.push(p.mesh);
    if (!quiet) {
      const i = this.live.indexOf(p);
      if (i >= 0) this.live.splice(i, 1);
    }
  }

  clear() {
    for (const p of this.live) this.scene.remove(p.mesh);
    this.live.length = 0;
    this.lastLanding = null;
  }
}
