/**
 * Decals.js — the marks a fight leaves on the street.
 *
 * Blood particles land and vanish inside a second, which means a road you have
 * killed six things on looks exactly like one you have walked down. Decals are
 * the memory: they are how you recognise the junction you already fought at,
 * and how a safehouse doorway starts to look like somewhere bad happened.
 *
 * The whole pool is one draw call. A single merged geometry holds `cap` quads;
 * placing a decal rewrites four vertices of it and nothing else. Alpha is a
 * per-vertex attribute rather than a material property, which is what makes
 * fading an individual splat possible without a material per splat.
 */

import * as THREE from 'three';
import CFG from '../core/Config.js';
import { bloodDecalTexture } from '../world/Textures.js';

/** How many of the oldest decals are already on their way out. */
const FADING = 8;

/** 2×2 atlas of four splat variants, so repeats are not obvious. */
function splatAtlas() {
  const tile = 128;
  const c = document.createElement('canvas');
  c.width = c.height = tile * 2;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 4; i++) {
    const src = bloodDecalTexture(i * 17 + 3).image;
    ctx.drawImage(src, (i % 2) * tile, Math.floor(i / 2) * tile, tile, tile);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export class Decals {
  constructor(scene, world, cap = CFG.combat.maxBloodDecals) {
    this.world = world;
    this.cap = cap;
    this.head = 0;
    this.count = 0;
    this._scratch = [];

    const verts = cap * 4;
    this.pos = new Float32Array(verts * 3);
    this.uv = new Float32Array(verts * 2);
    this.fade = new Float32Array(verts);

    const idx = new Uint16Array(cap * 6);
    for (let q = 0; q < cap; q++) {
      const v = q * 4;
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    geo.setAttribute('aFade', new THREE.BufferAttribute(this.fade, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: splatAtlas() } },
      vertexShader: /* glsl */ `
        attribute float aFade;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          vUv = uv;
          vFade = aFade;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          vec4 t = texture2D(uMap, vUv);
          float a = t.a * vFade;
          if (a < 0.01) discard;
          gl_FragColor = vec4(t.rgb, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      // Flat quads with no lighting: cheaper to draw both sides than to reason
      // about winding for a shape that is only ever seen from above.
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.geo = geo;
    scene.add(this.mesh);
    this.clear();
  }

  /**
   * Put a splat on the ground under (x, z).
   *
   * @param size  roughly the diameter in metres
   */
  splat(x, z, size = 1.5) {
    const q = this.head;
    this.head = (this.head + 1) % this.cap;
    this.count = Math.min(this.cap, this.count + 1);

    const y = this.world.collision.groundHeightAt(x, z, 2.4, this._scratch) + 0.02;
    const r = (size * (0.75 + Math.random() * 0.6)) / 2;
    const a = Math.random() * Math.PI * 2;
    const ca = Math.cos(a) * r;
    const sa = Math.sin(a) * r;

    // Corners of a rotated square lying flat on the ground.
    const v = q * 4 * 3;
    const set = (i, dx, dz) => {
      this.pos[v + i * 3] = x + dx;
      this.pos[v + i * 3 + 1] = y;
      this.pos[v + i * 3 + 2] = z + dz;
    };
    set(0, -ca - -sa, -sa + -ca);
    set(1, ca - -sa, sa + -ca);
    set(2, ca - sa, sa + ca);
    set(3, -ca - sa, -sa + ca);

    // Pick one of the four atlas tiles.
    const tile = Math.floor(Math.random() * 4);
    const u0 = (tile % 2) * 0.5;
    const w0 = Math.floor(tile / 2) * 0.5;
    const u = q * 4 * 2;
    this.uv[u] = u0;
    this.uv[u + 1] = w0;
    this.uv[u + 2] = u0 + 0.5;
    this.uv[u + 3] = w0;
    this.uv[u + 4] = u0 + 0.5;
    this.uv[u + 5] = w0 + 0.5;
    this.uv[u + 6] = u0;
    this.uv[u + 7] = w0 + 0.5;

    this._refresh();
    return q;
  }

  /**
   * Alpha by age. Only the oldest handful are fading at any time, so a splat
   * you made two minutes ago is still exactly as dark as when you made it —
   * right up until the street has seen enough killing to start forgetting.
   */
  _refresh() {
    for (let q = 0; q < this.cap; q++) {
      // How many splats ago this one was laid down.
      const age = (this.head - 1 - q + this.cap * 2) % this.cap;
      let a;
      if (age >= this.count) a = 0;
      else if (this.count < this.cap || age < this.cap - FADING) a = 1;
      else a = 1 - (age - (this.cap - FADING)) / FADING;
      const v = q * 4;
      this.fade[v] = this.fade[v + 1] = this.fade[v + 2] = this.fade[v + 3] = a;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    this.geo.attributes.aFade.needsUpdate = true;
  }

  clear() {
    this.head = 0;
    this.count = 0;
    this.pos.fill(0);
    this.fade.fill(0);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aFade.needsUpdate = true;
  }
}

export default Decals;
