/**
 * TimeOfDay.js — sun, moon, sky gradient, fog and the general feeling that
 * the light is running out faster than you'd like.
 *
 * Everything is driven off a keyframed palette sampled by hour, so the
 * transition through sunset reads as continuous rather than switching states.
 */

import * as THREE from 'three';
import CFG from '../core/Config.js';
import { clamp01, lerp, formatClock } from '../core/Utils.js';

const SKY_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uBottom;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunGlow;
  uniform float uStars;
  varying vec3 vWorld;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 dir = normalize(vWorld);
    float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

    vec3 col;
    if (h < 0.5) col = mix(uBottom, uMid, smoothstep(0.0, 0.5, h));
    else col = mix(uMid, uTop, smoothstep(0.5, 1.0, h));

    // Sun / moon halo bleeding into the sky near the horizon.
    float sd = max(dot(dir, normalize(uSunDir)), 0.0);
    col += uSunColor * pow(sd, 8.0) * uSunGlow;
    col += uSunColor * pow(sd, 2.0) * uSunGlow * 0.16;

    // Stars fade in at night, only above the horizon.
    if (uStars > 0.001 && dir.y > 0.0) {
      vec3 sp = floor(dir * 260.0);
      float n = hash(sp);
      float star = smoothstep(0.9975, 1.0, n) * uStars * smoothstep(0.0, 0.25, dir.y);
      col += vec3(star) * (0.8 + 0.4 * hash(sp + 3.0));
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

const c = (hex) => new THREE.Color(hex);

/**
 * three.js r155+ uses physically-correct light units, where a Lambert surface
 * reflects intensity/π. The palette below is authored in intuitive 0..1.5
 * "brightness" numbers, so everything gets scaled by π on the way out.
 */
const LIGHT_SCALE = Math.PI;

/** Keyframes: hour → look. Interpolated circularly. */
const KEYS = [
  {
    h: 0,
    top: c(0x05070f),
    mid: c(0x0a0e18),
    bot: c(0x11151d),
    sun: c(0xb4c6e4),
    sunI: 0.46,
    amb: c(0x3d4c66),
    ambI: 0.56,
    hemiGround: c(0x0a0c10),
    fog: c(0x11161f),
    fogD: 0.038,
    stars: 1,
  },
  {
    h: 5.0,
    top: c(0x0a1020),
    mid: c(0x131b2c),
    bot: c(0x1d2330),
    sun: c(0xb8c4dc),
    sunI: 0.48,
    amb: c(0x44536e),
    ambI: 0.58,
    hemiGround: c(0x0d1014),
    fog: c(0x171d29),
    fogD: 0.037,
    stars: 0.75,
  },
  {
    h: 6.6,
    top: c(0x35507e),
    mid: c(0x8e7f83),
    bot: c(0xd39a63),
    sun: c(0xffb066),
    sunI: 0.55,
    amb: c(0x5a5f6e),
    ambI: 0.38,
    hemiGround: c(0x211d18),
    fog: c(0x9a8375),
    fogD: 0.030,
    stars: 0.12,
  },
  {
    h: 9,
    top: c(0x4c7bb5),
    mid: c(0x9db4c8),
    bot: c(0xc4c8c2),
    sun: c(0xffeccf),
    sunI: 1.15,
    amb: c(0x93a2b4),
    ambI: 0.55,
    hemiGround: c(0x3a352c),
    fog: c(0xa8b0b4),
    fogD: 0.0125,
    stars: 0,
  },
  {
    h: 13,
    top: c(0x4a76ad),
    mid: c(0x9cb2c6),
    bot: c(0xc8cbc4),
    sun: c(0xfff4e0),
    sunI: 1.32,
    amb: c(0x9aa8b8),
    ambI: 0.6,
    hemiGround: c(0x413c31),
    fog: c(0xacb3b6),
    fogD: 0.0115,
    stars: 0,
  },
  {
    h: 17.2,
    top: c(0x4a6ea0),
    mid: c(0xb59a86),
    bot: c(0xd8a86d),
    sun: c(0xffcf94),
    sunI: 1.02,
    amb: c(0x8d8a8a),
    ambI: 0.5,
    hemiGround: c(0x3a3128),
    fog: c(0xb0977e),
    fogD: 0.0165,
    stars: 0,
  },
  {
    h: 19.1,
    top: c(0x2a3a63),
    mid: c(0x8a5f56),
    bot: c(0xd06b34),
    sun: c(0xff7a3c),
    sunI: 0.62,
    amb: c(0x6a5a5e),
    ambI: 0.34,
    hemiGround: c(0x2a211c),
    fog: c(0x8a5f4e),
    fogD: 0.024,
    stars: 0.05,
  },
  {
    h: 20.4,
    top: c(0x131c33),
    mid: c(0x39364a),
    bot: c(0x6a4a45),
    sun: c(0xc4552c),
    sunI: 0.46,
    amb: c(0x515870),
    ambI: 0.56,
    hemiGround: c(0x14161c),
    fog: c(0x3c3440),
    fogD: 0.038,
    stars: 0.4,
  },
  {
    h: 21.6,
    top: c(0x070b16),
    mid: c(0x0d1220),
    bot: c(0x161b25),
    sun: c(0xaebfdc),
    sunI: 0.46,
    amb: c(0x3f4e68),
    ambI: 0.57,
    hemiGround: c(0x0b0d11),
    fog: c(0x141a24),
    fogD: 0.037,
    stars: 0.9,
  },
];

function sampleKeys(hour) {
  const n = KEYS.length;
  let a = KEYS[n - 1],
    b = KEYS[0],
    t = 0;
  for (let i = 0; i < n; i++) {
    const cur = KEYS[i];
    const nxt = KEYS[(i + 1) % n];
    const h0 = cur.h;
    let h1 = nxt.h;
    if (h1 <= h0) h1 += 24;
    let hh = hour;
    if (hh < h0) hh += 24;
    if (hh >= h0 && hh <= h1) {
      a = cur;
      b = nxt;
      t = (hh - h0) / (h1 - h0);
      break;
    }
  }
  return { a, b, t };
}

export class TimeOfDay {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.hour = CFG.time.startHour;
    this.day = 1;
    this.elapsedHours = 0;
    this.paused = false;
    this.timeScale = 1;

    // ── sky dome ──
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(0x4a76ad) },
        uMid: { value: new THREE.Color(0x9cb2c6) },
        uBottom: { value: new THREE.Color(0xc8cbc4) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xffffff) },
        uSunGlow: { value: 0.5 },
        uStars: { value: 0 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    scene.add(this.sky);

    // ── lights ──
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 140;
    const S = 42;
    this.sun.shadow.camera.left = -S;
    this.sun.shadow.camera.right = S;
    this.sun.shadow.camera.top = S;
    this.sun.shadow.camera.bottom = -S;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.035;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x9aa8b8, 0x3a3428, 0.6);
    scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0x404858, 0.25);
    scene.add(this.ambient);

    scene.fog = new THREE.FogExp2(0xa8b0b4, 0.013);

    this._sunDir = new THREE.Vector3();
    this.lightLevel = 1;
    this.streetlightsOn = false;
  }

  get isNight() {
    return this.lightLevel < 0.34;
  }

  get phaseName() {
    const h = this.hour;
    if (h >= 5.0 && h < 7.2) return 'DAWN';
    if (h >= 7.2 && h < 16.5) return 'DAY';
    if (h >= 16.5 && h < 18.7) return 'AFTERNOON';
    if (h >= 18.7 && h < 20.4) return 'DUSK';
    return 'NIGHT';
  }

  get clockString() {
    return formatClock(this.hour);
  }

  /** 0 at midnight → 1 at noon-ish; used for gameplay difficulty scaling. */
  computeLightLevel() {
    const el = Math.sin(((this.hour - 6) / 24) * Math.PI * 2);
    return clamp01((el + 0.22) / 1.05);
  }

  advance(dt) {
    if (this.paused) return 0;
    const hoursDt = (dt / CFG.time.secondsPerHour) * this.timeScale;
    this.hour += hoursDt;
    this.elapsedHours += hoursDt;
    while (this.hour >= 24) {
      this.hour -= 24;
      this.day++;
    }
    return hoursDt;
  }

  update(dt, focusPos) {
    const hoursDt = this.advance(dt);
    const { a, b, t } = sampleKeys(this.hour);

    const top = a.top.clone().lerp(b.top, t);
    const mid = a.mid.clone().lerp(b.mid, t);
    const bot = a.bot.clone().lerp(b.bot, t);
    const sunCol = a.sun.clone().lerp(b.sun, t);
    const sunI = lerp(a.sunI, b.sunI, t);
    const ambCol = a.amb.clone().lerp(b.amb, t);
    const ambI = lerp(a.ambI, b.ambI, t);
    const hemiG = a.hemiGround.clone().lerp(b.hemiGround, t);
    const fogCol = a.fog.clone().lerp(b.fog, t);
    const fogD = lerp(a.fogD, b.fogD, t);
    const stars = lerp(a.stars, b.stars, t);

    this.lightLevel = this.computeLightLevel();

    // Sun/moon direction: one body tracks the whole cycle, the shader just
    // recolours it. Cheap, and nobody notices.
    const ang = ((this.hour - 6) / 24) * Math.PI * 2;
    const el = Math.sin(ang);
    const az = Math.cos(ang);
    this._sunDir.set(az * 0.75, Math.max(el, -0.35), 0.42).normalize();

    this.skyMat.uniforms.uTop.value.copy(top);
    this.skyMat.uniforms.uMid.value.copy(mid);
    this.skyMat.uniforms.uBottom.value.copy(bot);
    this.skyMat.uniforms.uSunDir.value.copy(this._sunDir);
    this.skyMat.uniforms.uSunColor.value.copy(sunCol);
    this.skyMat.uniforms.uSunGlow.value = lerp(0.25, 0.9, clamp01(sunI));
    this.skyMat.uniforms.uStars.value = stars;

    const fx = focusPos ? focusPos.x : 0;
    const fz = focusPos ? focusPos.z : 0;
    this.sky.position.set(fx, 0, fz);

    // Keep the shadow frustum around the player.
    this.sun.position.set(fx + this._sunDir.x * 60, this._sunDir.y * 60 + 12, fz + this._sunDir.z * 60);
    this.sun.target.position.set(fx, 0, fz);
    this.sun.target.updateMatrixWorld();
    this.sun.color.copy(sunCol);
    this.sun.intensity = sunI * LIGHT_SCALE;
    this.sun.castShadow = sunI > 0.16;

    this.hemi.color.copy(top).lerp(mid, 0.5);
    this.hemi.groundColor.copy(hemiG);
    this.hemi.intensity = lerp(0.48, 0.70, clamp01(this.lightLevel)) * LIGHT_SCALE;

    this.ambient.color.copy(ambCol);
    this.ambient.intensity = ambI * LIGHT_SCALE;

    this.scene.fog.color.copy(fogCol);
    this.scene.fog.density = fogD;
    this.renderer.setClearColor(fogCol);

    const wantLights = this.lightLevel < 0.42;
    this.streetlightsOn = wantLights;

    return hoursDt;
  }

  reset() {
    this.hour = CFG.time.startHour;
    this.day = 1;
    this.elapsedHours = 0;
  }
}
