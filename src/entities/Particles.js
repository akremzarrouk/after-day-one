/**
 * Particles.js — one pooled point-cloud for every spark of blood, dust and
 * debris in the game. Cheap, and it means impacts always have some physical
 * consequence on screen.
 */

import * as THREE from 'three';
import { softDotTexture } from '../world/Textures.js';

const MAX = 900;

export class Particles {
  constructor(scene) {
    this.count = MAX;
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.head = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: softDotTexture() },
      },
      vertexShader: /* glsl */ `
        attribute float size;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * 320.0 / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          if (t.a < 0.02) discard;
          gl_FragColor = vec4(vColor, t.a);
        }
      `,
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.geo = geo;
    scene.add(this.points);

    // Park everything off-screen initially.
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -999;
  }

  _spawn(x, y, z, vx, vy, vz, r, g, b, size, life, gravity) {
    const i = this.head;
    this.head = (this.head + 1) % MAX;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r;
    this.col[i * 3 + 1] = g;
    this.col[i * 3 + 2] = b;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = gravity;
  }

  blood(x, y, z, dirX, dirZ, amount = 12, strength = 1) {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (1.4 + Math.random() * 3.2) * strength;
      const spread = 0.75;
      const vx = dirX * sp + Math.cos(a) * sp * spread;
      const vz = dirZ * sp + Math.sin(a) * sp * spread;
      const vy = 1.2 + Math.random() * 3.0 * strength;
      const dark = 0.22 + Math.random() * 0.28;
      this._spawn(
        x + (Math.random() - 0.5) * 0.2,
        y + (Math.random() - 0.5) * 0.3,
        z + (Math.random() - 0.5) * 0.2,
        vx,
        vy,
        vz,
        dark,
        dark * 0.13,
        dark * 0.11,
        0.035 + Math.random() * 0.05,
        0.55 + Math.random() * 0.7,
        -13
      );
    }
  }

  dust(x, y, z, amount = 8, tint = 0.55) {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.4 + Math.random() * 1.4;
      this._spawn(
        x + (Math.random() - 0.5) * 0.4,
        y + Math.random() * 0.3,
        z + (Math.random() - 0.5) * 0.4,
        Math.cos(a) * sp,
        0.5 + Math.random() * 1.1,
        Math.sin(a) * sp,
        tint,
        tint * 0.96,
        tint * 0.88,
        0.09 + Math.random() * 0.11,
        0.7 + Math.random() * 0.8,
        -1.1
      );
    }
  }

  sparks(x, y, z, amount = 6) {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      this._spawn(
        x,
        y,
        z,
        Math.cos(a) * sp,
        1 + Math.random() * 3,
        Math.sin(a) * sp,
        1.0,
        0.75,
        0.35,
        0.02 + Math.random() * 0.03,
        0.25 + Math.random() * 0.3,
        -16
      );
    }
  }

  muzzle(x, y, z, dx, dz) {
    for (let i = 0; i < 14; i++) {
      const sp = 3 + Math.random() * 9;
      this._spawn(
        x,
        y,
        z,
        dx * sp + (Math.random() - 0.5) * 2.2,
        (Math.random() - 0.3) * 2.2,
        dz * sp + (Math.random() - 0.5) * 2.2,
        1.0,
        0.8 + Math.random() * 0.2,
        0.5,
        0.05 + Math.random() * 0.09,
        0.09 + Math.random() * 0.12,
        -2
      );
    }
  }

  update(dt) {
    const { pos, vel, life, maxLife, size, grav } = this;
    for (let i = 0; i < MAX; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        pos[i * 3 + 1] = -999;
        continue;
      }
      const i3 = i * 3;
      vel[i3 + 1] += grav[i] * dt;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      if (pos[i3 + 1] < 0.02) {
        pos[i3 + 1] = 0.02;
        vel[i3] *= 0.3;
        vel[i3 + 2] *= 0.3;
        vel[i3 + 1] = 0;
        grav[i] = 0;
        life[i] = Math.min(life[i], 0.35);
      }
      const f = life[i] / maxLife[i];
      size[i] = size[i] * 0.995 + 0.0001;
      if (f < 0.35) size[i] *= 0.965;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
