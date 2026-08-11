/**
 * Game.js — the orchestrator.
 *
 * Owns the renderer, the loop, the game state machine and the wiring between
 * systems. Systems themselves know as little about each other as possible:
 * the player doesn't know what a zombie is, zombies don't know what an item
 * is, and the HUD doesn't know about either.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

import CFG from './Config.js';
import { Input } from './Input.js';
import { clamp, clamp01, angleDelta, makeRng } from './Utils.js';

import { World } from '../world/World.js';
import { Player, PlayerState } from '../player/Player.js';
import { CameraRig } from '../player/CameraRig.js';
import { Horde, ZState } from '../entities/Horde.js';
import { Particles } from '../entities/Particles.js';
import { Decals } from '../entities/Decals.js';
import CharacterAssets from '../entities/CharacterAssets.js';
import { Combat } from '../combat/Combat.js';

import { Survival } from '../systems/Survival.js';
import { Inventory, conditionTier } from '../systems/Inventory.js';
import { NoiseField } from '../systems/Noise.js';
import { Throwables } from '../systems/Throwables.js';
import { Fire } from '../systems/Fire.js';
import { TimeOfDay } from '../systems/TimeOfDay.js';
import { AudioSys } from '../systems/AudioSys.js';
import { Objectives, Goal } from '../systems/Objectives.js';
import { ITEMS, ItemType, WEAPONS, rollLoot } from '../systems/Items.js';

import { HUD } from '../ui/HUD.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.85 },
    uGrain: { value: 0.055 },
    uDesat: { value: 0.12 },
    uTintColor: { value: new THREE.Color(0.06, 0.07, 0.1) },
    uTintAmount: { value: 0.0 },
    uDamage: { value: 0.0 },
    uAberration: { value: 0.0012 },
    uExposure: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uDesat, uTintAmount, uDamage, uAberration, uExposure;
    uniform vec3 uTintColor;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // chromatic aberration, stronger toward the edges and when hurt
      float ab = uAberration * (1.0 + uDamage * 9.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ab).b;

      col *= uExposure;

      // desaturate + tint toward the time-of-day colour
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l), uDesat);
      col = mix(col, uTintColor * (0.4 + l), uTintAmount);

      // low-health red pull
      col = mix(col, vec3(l * 0.9, l * 0.13, l * 0.1), uDamage * 0.55);

      // vignette
      float v = 1.0 - smoothstep(0.14, 0.88, r2 * (1.0 + uDamage * 0.7));
      col *= mix(1.0, v, uVignette);

      // film grain
      float g = hash(uv * vec2(1024.0, 768.0) + fract(uTime) * 91.7) - 0.5;
      col += g * uGrain * (1.0 - l * 0.55);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export const GameState = {
  LOADING: 'loading',
  TITLE: 'title',
  PLAYING: 'playing',
  NOTE: 'note',
  DEAD: 'dead',
  WIN: 'win',
};

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = GameState.LOADING;
    this.rng = makeRng(1337);
    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.started = false;

    this._initRenderer();
    this.input = new Input(canvas);
    this.audio = new AudioSys();
    this.hud = new HUD(this);

    this.searchTarget = null;
    this.searchTime = 0;
    this.searchNoiseTimer = 0;
    this._interactLock = 0;
    this.resting = false;
    this.restStart = 0;
    this.stats = { searched: 0, itemsFound: 0, kills: 0, distance: 0 };
    this._lastPos = new THREE.Vector2();
    this.pickupMeshes = [];

    this._bindUI();
  }

  // ────────────────────────────────────────────────────────────── setup ──

  _initRenderer() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.55;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CFG.camera.fov,
      window.innerWidth / window.innerHeight,
      0.08,
      520
    );

    try {
      this.composer = new EffectComposer(renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.gradePass = new ShaderPass(GradeShader);
      this.gradePass.renderToScreen = true;
      this.composer.addPass(this.gradePass);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    } catch (e) {
      console.warn('[render] post-processing unavailable, falling back', e);
      this.composer = null;
    }

    window.addEventListener('resize', () => this._onResize());
  }

  _onResize() {
    const w = window.innerWidth,
      h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
  }

  async load() {
    const step = (p, t) =>
      new Promise((res) => {
        this.hud.setLoading(p, t);
        requestAnimationFrame(() => setTimeout(res, 0));
      });

    await step(0.02, 'waking up…');

    this.world = new World(this.scene);
    this.world.build((p, t) => this.hud.setLoading(0.05 + p * 0.6, t));
    await step(0.68, 'the dead…');

    // Characters are the one thing that comes off disk. If any of it is
    // missing the procedural humanoids take over and the game plays exactly
    // the same — so this never throws and never blocks the run.
    await CharacterAssets.load((p) => this.hud.setLoading(0.68 + p * 0.1, 'the dead…'));
    await step(0.78, 'lighting the sky…');

    this.time = new TimeOfDay(this.scene, this.renderer);
    this.particles = new Particles(this.scene);
    this.noise = new NoiseField();
    this.throwables = null;   // needs the world, built just below
    this.survival = new Survival();
    this.inventory = new Inventory(22);
    this.objectives = new Objectives(this.world);

    this.player = new Player(
      this.scene,
      this.world,
      this.survival,
      this.inventory,
      this.audio,
      this.noise
    );
    this.cameraRig = new CameraRig(this.camera, this.world);
    this.decals = new Decals(this.scene, this.world);
    this.throwables = new Throwables(this.scene, this.world, this.audio, this.noise, this.particles);
    this.fire = new Fire(this.scene, this.world, this.audio, this.noise, this.particles);
    this.throwables.onIncendiary = (x, y, z) => this.fire.ignite(x, z);
    this.horde = new Horde(this.scene, this.world, this.audio, this.particles, this.noise);
    this.combat = new Combat(
      this.world,
      this.horde,
      this.audio,
      this.particles,
      this.noise,
      this.cameraRig,
      this.decals
    );

    /**
     * A kill briefly slows the world down. Sixty milliseconds is short enough
     * that you never wait for it and long enough that the moment a body stops
     * being a threat is the moment you can see.
     */
    this.combat.onKill = () => {
      this._slowmo = CFG.combat.killSlowTime;
    };
    this._slowmo = 0;

    // The camera lurches away from whatever hit you, so you know which
    // shoulder it came over without reading the threat arrows.
    this.player.onDamage = (dx, dz, amount) => {
      this.cameraRig.addKick(dx, dz, 0.4 + clamp01(amount / 30));
    };

    await step(0.9, 'the neighbours…');
    this.resetRun();

    await step(1.0, 'ready');
    this.hud.hideLoading();
    this.state = GameState.TITLE;
    this.hud.showTitle();
    this._loop();
  }

  resetRun() {
    this.survival.reset();
    this.inventory.slots.length = 0;
    this.inventory.equipped = 'fists';
    this.objectives.reset();
    this.horde.reset();
    this.time.reset();
    this.time.timeScale = 1;
    this.time.paused = false;
    this.noise.clear();
    this.throwables?.clear();
    this.fire?.clear();
    this.decals?.clear();
    this._slowmo = 0;

    for (const m of this.pickupMeshes) {
      this.scene.remove(m);
      m.geometry?.dispose();
      m.material?.dispose();
    }
    this.pickupMeshes.length = 0;
    this.world.interactables = this.world.interactables.filter((i) => i.type !== 'pickup');
    for (const it of this.world.interactables) it.used = false;
    this.world.notesRead.clear();
    this.world.resetOpenings();

    this.player.spawn(this.world.playerSpawn);
    this.cameraRig.yaw = Math.PI;
    this.cameraRig.pitch = -0.1;
    this.cameraRig._initialised = false;

    this.horde.spawnFromWorld();

    this.stats = { searched: 0, itemsFound: 0, kills: 0, distance: 0 };
    this._lastPos.set(this.player.pos.x, this.player.pos.z);
    this.searchTarget = null;
    this.resting = false;
    this.elapsed = 0;

    // You start with almost nothing. That's the point.
    this.inventory.add('bandage', 1);
    this.inventory.add('water_bottle', 1);
  }

  _bindUI() {
    document.getElementById('btn-start').onclick = () => this.startGame();
    document.getElementById('btn-retry').onclick = () => this.restart();
    document.getElementById('btn-again').onclick = () => this.restart();
    document.getElementById('pause-hint').onclick = () => this.input.requestLock();

    this.input.onLockChange((locked) => {
      if (this.state === GameState.PLAYING) {
        this.hud.setPaused(!locked && !this.hud.inventoryOpen);
      } else {
        this.hud.setPaused(false);
      }
    });
  }

  startGame() {
    this.audio.init();
    this.audio.resume();
    this.hud.hideTitle();
    this.state = GameState.PLAYING;
    this.started = true;
    this.input.requestLock();
    this.clock.getDelta();
    this.audio.levelStinger();
    this.hud.subtitle(
      'Two days since the radio stopped. You have until dark to find something worth having.',
      7
    );
    this.hud.toast('warn', 'Objective: find supplies before nightfall.');
  }

  restart() {
    this.hud.hideDeath();
    this.hud.hideWin();
    this.hud.closeNote();
    this.hud.closeInventory();
    this.resetRun();
    this.state = GameState.PLAYING;
    this.input.requestLock();
    this.clock.getDelta();
    this.audio.levelStinger();
  }

  // ─────────────────────────────────────────────────────── item actions ──

  giveItem(id, count = 1, silent = false) {
    const added = this.inventory.add(id, count);
    if (added > 0) {
      const def = ITEMS[id];
      if (!silent) {
        this.hud.toast('good', `${def.name}${added > 1 ? ' ×' + added : ''}`);
        this.audio.pickup();
      }
      this.objectives.onItemCollected(id, added);
      this.stats.itemsFound += added;

      if (id === 'battery' && this.inventory.has('flashlight') && this.player.battery < 30) {
        // Loading a battery is automatic if your torch is nearly dead.
        this.inventory.remove('battery', 1);
        this.player.addBattery(ITEMS.battery.effects.battery);
        this.hud.toast('good', 'Loaded batteries into the torch.');
      }
      if (id === 'flashlight' && this.player.battery <= 0) {
        this.player.addBattery(70);
      }
      // Auto-equip your first real weapon so combat is never a mystery.
      const def2 = ITEMS[id];
      if (def2.type === ItemType.WEAPON && !WEAPONS[def2.weapon].ranged) {
        const best = this.inventory.bestWeaponId();
        if (best !== this.inventory.equipped && this.inventory.equipped === 'fists') {
          this.inventory.equipWeapon(best);
          this.hud.toast('good', `Equipped ${WEAPONS[best].name}.`);
        }
      }
    }
    if (added < count) {
      this.hud.toast('warn', 'No room in your pack.');
    }
    return added;
  }

  useSlot(i) {
    const slot = this.inventory.slots[i];
    if (!slot) return;
    const def = ITEMS[slot.id];

    // Anything with a `weapon` goes in your hand — that includes bottles and
    // molotovs, which are resources everywhere else in the game.
    if (def.weapon) {
      this.equipSlot(i);
      return;
    }
    if (def.id === 'planks') {
      this.hud.toast('warn', 'Use these on the safehouse door.');
      this.audio.uiBad();
      return;
    }
    if (def.id === 'ammo_38') {
      this.hud.toast('warn', '[R] to load, one chamber at a time.');
      return;
    }
    if (def.repairs) {
      this._repairEquipped(i);
      return;
    }
    if (def.id === 'battery') {
      if (!this.inventory.has('flashlight')) {
        this.hud.toast('warn', 'Nothing to put them in.');
        this.audio.uiBad();
        return;
      }
      this.inventory.removeAtIndex(i, 1);
      this.player.addBattery(def.effects.battery);
      this.hud.toast('good', 'Torch recharged.');
      this.audio.useItem();
      return;
    }
    if (!def.effects) return;

    // Don't waste a medkit at full health.
    if (def.effects.health && !def.effects.thirst && !def.effects.hunger) {
      if (this.survival.health >= this.survival.maxHealth - 0.5 && this.survival.bleeding <= 0) {
        this.hud.toast('warn', 'You are not hurt.');
        this.audio.uiBad();
        return;
      }
    }

    this.inventory.removeAtIndex(i, 1);
    this.survival.applyItemEffects(def.effects);
    if (def.effects.thirst) this.audio.drink();
    else this.audio.useItem();
    this.hud.toast('good', `${def.useVerb || 'Used'} ${def.name.toLowerCase()}.`);
    this.noise.emit(this.player.pos.x, this.player.pos.z, 3.5, 'player', 'use');
  }

  /**
   * Spend a tool roll on whatever is in your hand.
   *
   * One tier, not one repair — using it on an almost-pristine weapon throws
   * most of it away, which is what stops "keep everything topped up" from
   * being the obvious play.
   */
  _repairEquipped(slotIndex) {
    const w = this.player.weapon;
    if (!w.durability) {
      this.hud.toast('warn', 'Nothing in your hands to fix.');
      this.audio.uiBad();
      return;
    }
    const cond = this.inventory.equippedCondition;
    if (cond !== null && cond >= 0.999) {
      this.hud.toast('warn', `The ${w.name.toLowerCase()} is fine.`);
      this.audio.uiBad();
      return;
    }
    const res = this.inventory.repairEquipped();
    if (!res) {
      this.audio.uiBad();
      return;
    }
    this.inventory.removeAtIndex(slotIndex, 1);
    this.audio.hammer(this.player.pos.x, this.player.pos.z);
    setTimeout(() => this.audio.hammer(this.player.pos.x, this.player.pos.z), 210);
    this.noise.emit(this.player.pos.x, this.player.pos.z, CFG.noise.search, 'player', 'repair');
    this.hud.toast('good', `${w.name} back to ${res.tier}.`);
  }

  equipSlot(i) {
    const slot = this.inventory.slots[i];
    if (!slot) return;
    const def = ITEMS[slot.id];
    if (!def.weapon) return;
    if (this.inventory.equipped === def.weapon) {
      this.inventory.equipWeapon('fists');
      this.hud.toast('', 'Hands free.');
    } else {
      this.inventory.equipWeapon(def.weapon);
      this.hud.toast('good', `${def.name} in hand.`);
    }
    this.audio.uiClick();
  }

  dropSlot(i) {
    const slot = this.inventory.slots[i];
    if (!slot) return;
    const id = slot.id;
    const n = this.inventory.removeAtIndex(i, slot.count);
    if (n > 0) {
      const def = ITEMS[id];
      if (def.weapon && this.inventory.equipped === def.weapon) {
        this.inventory.equipWeapon(this.inventory.bestWeaponId());
      }
      const fx = Math.sin(this.player.yaw),
        fz = Math.cos(this.player.yaw);
      this.spawnPickup(this.player.pos.x + fx * 1.1, this.player.pos.z + fz * 1.1, id, n);
      this.hud.toast('', `Dropped ${def.name}.`);
      this.audio.uiClick();
    }
  }

  spawnPickup(x, z, id, count) {
    const def = ITEMS[id];
    const mat = new THREE.MeshStandardMaterial({
      color: def.type === ItemType.WEAPON ? 0x8a8f94 : 0x9a8f6a,
      roughness: 0.8,
      emissive: 0x1a1a12,
    });
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.3), mat);
    const gy = this.world.collision.groundHeightAt(x, z, 3, []);
    m.position.set(x, gy + 0.12, z);
    m.castShadow = true;
    this.scene.add(m);
    this.pickupMeshes.push(m);
    this.world.interactables.push({
      type: 'pickup',
      x,
      z,
      y: gy + 0.2,
      radius: 1.7,
      label: `${def.name}${count > 1 ? ' ×' + count : ''}`,
      verb: 'Take',
      itemId: id,
      count,
      mesh: m,
      used: false,
    });
  }

  // ───────────────────────────────────────────────────────── interaction ──

  _updateInteraction(dt) {
    const p = this.player;

    // Closing a note (or any modal) with E leaves the press flag set for the
    // rest of the frame, which would immediately re-open it. A short lock
    // makes the interaction feel like a single deliberate action.
    if (this.player.hidden) {
      this._updateHiding(dt);
      return;
    }

    if (this._interactLock > 0) {
      this._interactLock -= dt;
      this.hud.setPrompt(null);
      this.hud.setSearchProgress(null);
      return;
    }

    const target = this.world.findInteractable(p.pos.x, p.pos.z);

    if (this.searchTarget) {
      const t = this.searchTarget;
      const moved = p.speed > 0.9;
      const stillNear = Math.hypot(p.pos.x - t.x, p.pos.z - t.z) < t.radius + 0.5;
      if (!this.input.down('KeyE') || moved || !stillNear || p.isBusy) {
        this.searchTarget = null;
        this.hud.setSearchProgress(null);
      } else {
        this.searchTime += dt;
        this.searchNoiseTimer -= dt;
        if (this.searchNoiseTimer <= 0) {
          this.searchNoiseTimer = 0.42;
          this.audio.rustle(t.x, t.z);
          this.noise.emit(t.x, t.z, CFG.noise.search, 'player', 'search');
        }
        const total = t.kind === 'barricade' ? 2.6 : t.searchTime;
        this.hud.setSearchProgress(this.searchTime / total);
        if (this.searchTime >= total) {
          this._completeSearch(t);
          this.searchTarget = null;
          this.hud.setSearchProgress(null);
        }
      }
      this.hud.setPrompt(null);
      return;
    }

    this.hud.setSearchProgress(null);

    // Something on the floor at your feet outranks every other use of E. If
    // you are standing over a downed body, that is unambiguously what you
    // meant, door or no door.
    const downed = this._downedNear();
    if (downed) {
      this.hud.setPrompt('Finish it');
      if (this.input.pressed('KeyE')) this.player.beginFinisher(downed);
      return;
    }

    // Doors and windows take priority over anything else within reach — when
    // you are standing in a doorway, the doorway is what you meant.
    if (this._updateOpeningInteraction(dt)) return;

    if (!target) {
      this.hud.setPrompt(null);
      return;
    }

    if (target.type === 'container') {
      if (target.used) {
        this.hud.setPrompt(`${target.label} — empty`);
        return;
      }
      this.hud.setPrompt(`${target.verb} ${target.label} (hold)`);
      if (this.input.down('KeyE') && !this.player.isBusy) {
        this.searchTarget = target;
        this.searchTime = 0;
        this.searchNoiseTimer = 0;
      }
    } else if (target.type === 'note') {
      this.hud.setPrompt(`${target.verb}: ${target.label}`);
      if (this.input.pressed('KeyE')) {
        this.world.notesRead.add(target.id);
        this.hud.showNote(target.label, target.text);
        this.state = GameState.NOTE;
        this.audio.uiClick();
      }
    } else if (target.type === 'pickup') {
      this.hud.setPrompt(`Take ${target.label}`);
      if (this.input.pressed('KeyE')) {
        const got = this.giveItem(target.itemId, target.count);
        if (got > 0) {
          if (got >= target.count) {
            this.scene.remove(target.mesh);
            target.mesh.geometry?.dispose();
            target.mesh.material?.dispose();
            const mi = this.pickupMeshes.indexOf(target.mesh);
            if (mi >= 0) this.pickupMeshes.splice(mi, 1);
            const ii = this.world.interactables.indexOf(target);
            if (ii >= 0) this.world.interactables.splice(ii, 1);
          } else {
            target.count -= got;
          }
        }
      }
    } else if (target.type === 'hide') {
      this.hud.setPrompt(`Hide — ${target.label.toLowerCase()}`);
      if (this.input.pressed('KeyE')) this._enterHide(target);
    } else if (target.type === 'rest') {
      const canRest = this.time.hour >= 20 || this.time.hour < 5.5;
      if (!canRest) {
        this.hud.setPrompt('Too early to sleep');
        return;
      }
      this.hud.setPrompt('Rest until dawn');
      if (this.input.pressed('KeyE')) this._startRest();
    }
  }

  /** The nearest thing lying at your feet that a boot would settle. */
  _downedNear() {
    const p = this.player;
    if (!p.canAct) return null;
    const R = CFG.combat.finisherRange;
    let best = null;
    let bd = Infinity;
    for (const z of this.horde.zombies) {
      if (!z.downed) continue;
      const d = Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z);
      if (d > R + z.radius) continue;
      if (d < bd) {
        bd = d;
        best = z;
      }
    }
    return best;
  }

  // ──────────────────────────────────────────── doors, windows, boarding ──

  /**
   * What this opening offers right now. A tap is the quick thing; a hold is
   * the committed one. Tap resolves on key-up whenever a hold is also
   * available, which is what keeps "close" and "slam" from fighting.
   *
   * @returns null when the opening offers nothing.
   */
  _openingActions(op) {
    const O = CFG.openings;
    const planks = this.inventory.has('planks');
    const acts = { tap: null, hold: null, note: null };

    if (op.isDoor) {
      if (op.state === 'closed') {
        acts.tap = { label: 'Open the door', run: () => this._useDoor(op) };
        if (planks) acts.hold = { label: 'Board it up', time: O.boardTime, bar: true, run: () => this._boardOpening(op) };
      } else if (op.state === 'open') {
        acts.tap = { label: 'Close the door', run: () => this._useDoor(op) };
        acts.hold = { label: 'Slam it', time: O.slamHoldTime, bar: false, run: () => this._slamDoor(op) };
      } else if (op.state === 'boarded') {
        acts.note = 'Boarded shut';
      } else {
        acts.note = 'The door is off its hinges';
      }
    } else {
      if (op.state === 'boarded') {
        acts.note = 'Boarded over';
      } else {
        const glass = op.state === 'closed';
        acts.tap = {
          label: glass ? 'Climb through (breaks the glass)' : 'Climb through',
          run: () => this._vault(op),
        };
        if (planks) acts.hold = { label: 'Board it up', time: O.boardTime, bar: true, run: () => this._boardOpening(op) };
      }
    }
    if (!acts.tap && !acts.hold) return acts.note ? acts : null;
    return acts;
  }

  /** @returns true when an opening owned the interaction this frame. */
  _updateOpeningInteraction(dt) {
    const p = this.player;
    if (p.isBusy || p.vaulting || p.hidden) return false;

    const op = this.world.openingNear(p.pos.x, p.pos.z, CFG.openings.siegeRange);
    if (!op) {
      this._opHold = 0;
      this._opHoldFired = false;
      this._opTarget = null;
      return false;
    }
    if (op !== this._opTarget) {
      this._opHold = 0;
      this._opHoldFired = false;
      this._opTarget = op;
    }

    const acts = this._openingActions(op);
    if (!acts) return false;
    if (!acts.tap && !acts.hold) {
      this.hud.setPrompt(`${op.label()} — ${acts.note}`);
      return true;
    }

    const down = this.input.down('KeyE');
    if (down) {
      this._opHold += dt;
      if (acts.hold && !this._opHoldFired && this._opHold >= acts.hold.time) {
        this._opHoldFired = true;
        acts.hold.run();
      }
      if (acts.hold?.bar && !this._opHoldFired) {
        this.hud.setSearchProgress(this._opHold / acts.hold.time);
      }
    } else {
      // Nothing to hold for: fire on press so a door never costs you a beat.
      if (!acts.hold && this.input.pressed('KeyE')) acts.tap?.run();
      else if (this._opHold > 0 && !this._opHoldFired) acts.tap?.run();
      this._opHold = 0;
      this._opHoldFired = false;
    }

    const hint = acts.hold ? `${acts.tap ? acts.tap.label : ''} · hold: ${acts.hold.label}` : acts.tap.label;
    this.hud.setPrompt(hint);
    return true;
  }

  _useDoor(op) {
    const what = op.toggle('player');
    if (!what) return;
    this.audio.door(what === 'open', op.x, op.z);
    this.noise.emit(op.x, op.z, CFG.openings.creakNoise, 'player', 'door');
    this.horde.onOpeningUsed(op, this.player);
  }

  _slamDoor(op) {
    if (!op.slam()) return;
    this.audio.doorSlam(op.x, op.z);
    this.noise.emit(op.x, op.z, CFG.openings.slamNoise, 'player', 'slam');
    this.cameraRig.addShake(0.16);
    this.hud.toast('warn', 'That was loud.');
  }

  _boardOpening(op) {
    if (!this.inventory.has('planks')) return;
    if (!op.board()) return;
    this.inventory.remove('planks', CFG.openings.boardPlankCost);
    this.audio.hammer(op.x, op.z);
    setTimeout(() => this.audio.hammer(op.x, op.z), 180);
    this.noise.emit(op.x, op.z, CFG.noise.barricade, 'player', 'barricade');
    this.hud.toast('good', `${op.isDoor ? 'Door' : 'Window'} boarded.`);
    this.hud.setSearchProgress(null);
    if (op === this.world.safehouse?.doorOpening) this.objectives.onBarricade();
  }

  _vault(op) {
    if (!op.vaultable) return;
    this.player.beginVault(op);
    if (op.state === 'closed' && CFG.openings.breakGlassOnVault) {
      op.setState('broken');
      this.audio.glassBreak(op.x, op.z);
      this.noise.emit(op.x, op.z, CFG.openings.glassNoise, 'player', 'glass');
    } else {
      this.noise.emit(op.x, op.z, CFG.openings.vaultNoise, 'player', 'vault');
    }
    this.audio.vault(op.x, op.z);
    this.horde.onOpeningUsed(op, this.player);
  }

  // ───────────────────────────────────────────────────────── swing + wear ──

  /**
   * A swing, and everything it costs.
   *
   * `Combat` resolves what the arc found; the bill for it lands here, because
   * this is the only place that holds both the weapon that swung and the pack
   * it came out of. Steel into brick wears worse than steel into a skull,
   * which is the quiet argument against swinging at everything.
   */
  _swing(w) {
    const r = this.combat.resolveSwing(this.player, w, {
      pitch: this.cameraRig.pitch,
      damageMul: this.inventory.equippedDamageMul,
    });
    if (r.hits === 0 && !r.clang) this.audio.miss();

    const D = CFG.durability;
    const wear = r.hits * D.wearPerHit + (r.clang ? D.wearPerClang : 0);
    if (wear <= 0) return r;

    const before = this.inventory.equippedCondition;
    const res = this.inventory.wearEquipped(wear);
    if (res === 'broke') this._weaponBroke(w);
    else if (res === 'tier') {
      const tier = conditionTier(this.inventory.equippedCondition ?? 1);
      this.hud.toast('warn', `${w.name} is ${tier.name}.`);
      if (tier.name === 'failing') {
        this.hud.subtitle(`The ${w.name.toLowerCase()} is about to go.`, 3);
      }
    } else if (before !== null) {
      /* ordinary wear — the pips on the weapon panel are the only telling */
    }
    return r;
  }

  _weaponBroke(w) {
    this.audio.impact('hit_metal', this.player.pos.x, this.player.pos.z);
    this.audio.noiseBurst({ dur: 0.28, type: 'bandpass', freq: 1700, q: 5, gain: 0.34, sweepTo: 400 });
    this.audio.woodBreak(this.player.pos.x, this.player.pos.z);
    this.cameraRig.addShake(0.34);
    // Hands empty and useless for a moment: the cost is the beat, not the item.
    this.player.attackLock = CFG.durability.disarmTime;
    this.player.state = PlayerState.NORMAL;
    this.player.attackQueued = false;
    this.player.anim.cancelOneShot();
    this.hud.toast('bad', `Your ${w.name.toLowerCase()} breaks.`);
    this.hud.subtitle('It comes apart in your hands.', 3);
  }

  /** The stomp landed. */
  _finish(z) {
    this.combat.resolveFinisher(this.player, z);
    this.hud.toast('', 'Finished it.');
  }

  /**
   * Let one go. The arc starts at the shoulder and follows where the camera is
   * looking, so aiming a distraction is the same gesture as aiming anything.
   */
  _throw(w) {
    if (!this.inventory.has(w.item)) return;
    this.inventory.remove(w.item, 1);
    const p = this.player;
    const from = new THREE.Vector3(
      p.pos.x + Math.sin(p.yaw) * 0.35,
      p.pos.y + (p.crouching ? 1.05 : 1.45),
      p.pos.z + Math.cos(p.yaw) * 0.35
    );
    this.throwables.throwItem(
      w.incendiary ? 'molotov' : w.id === 'bottle' ? 'bottle' : 'can',
      from,
      this.cameraRig.yaw,
      clamp(this.cameraRig.pitch, -0.2, 0.7)
    );
    this.audio.swing('whoosh_light');
    // Nothing is emitted here: the noise happens where it lands.
    if (!this.inventory.has(w.item)) {
      this.inventory.equipWeapon(this.inventory.bestWeaponId());
      this.hud.toast('', 'That was the last one.');
    }
  }

  // ───────────────────────────────────────────────────────────── hiding ──

  _enterHide(spot) {
    const fromX = this.player.pos.x;
    const fromZ = this.player.pos.z;
    if (!this.player.enterHide(spot)) return;
    const watchers = this.horde.onPlayerHide(spot, this.player, fromX, fromZ);
    this._hideDrag = 0;
    this.audio.rustle(spot.x, spot.z);
    this.noise.emit(spot.x, spot.z, 3.0, 'player', 'hide');
    this.hud.setPrompt(null);
    this.hud.subtitle(
      watchers > 0 ? 'You pull the door shut. Something saw you.' : 'You pull the door shut and hold your breath.',
      3.5
    );
  }

  _exitHide() {
    const spot = this.player.hidden;
    if (!spot) return;
    this.player.exitHide();
    this.horde.clearHideWatchers();
    this._hideDrag = 0;
    this._interactLock = 0.3;
    this.audio.rustle(spot.x, spot.z);
    this.noise.emit(spot.x, spot.z, 4.0, 'player', 'hide');
  }

  /**
   * Hiding is strong but it is not a shield. Anything that watched you climb
   * in comes to the spot, and once it is there it hauls you out.
   */
  _updateHiding(dt) {
    const spot = this.player.hidden;
    if (!spot) return;

    const searchers = this.horde.hideSearchersAt(spot);
    if (searchers > 0) {
      this._hideDrag = (this._hideDrag || 0) + dt;
      const k = clamp01(this._hideDrag / CFG.stealth.dragOutTime);
      this.hud.setSearchProgress(k);
      this.hud.setPrompt('Something is right outside');
      this.cameraRig.addShake(dt * 1.6);
      if (this._hideDrag >= CFG.stealth.dragOutTime) {
        this._exitHide();
        this.hud.setSearchProgress(null);
        this.player.takeHit(CFG.stealth.dragOutDamage, spot.x + 0.6, spot.z, {
          cause: 'the dead',
          unblockable: true,
          bleedChance: 0.7,
          knockMul: 1.6,
        });
        this.hud.subtitle('It drags you out.', 3);
        this.cameraRig.addShake(0.9);
      }
      return;
    }

    this._hideDrag = 0;
    this.hud.setSearchProgress(null);
    this.hud.setPrompt('Leave the hiding place');
    if (this.input.pressed('KeyE')) this._exitHide();
  }

  _completeSearch(t) {
    if (t.kind === 'barricade') {
      this.inventory.remove('planks', 1);
      this.world.buildBarricade();
      this.objectives.onBarricade();
      this.audio.hammer(t.x, t.z);
      this.noise.emit(t.x, t.z, CFG.noise.barricade, 'player', 'barricade');
      this.hud.toast('good', 'Door boarded.');
      return;
    }

    t.used = true;
    this.stats.searched++;
    // Luck rises slightly as the day goes on so late runs aren't hopeless.
    const luck = 1 + clamp01((this.time.elapsedHours - 2) / 14) * 0.35;
    const rolled = rollLoot(t.table, this.rng, luck);
    if (t.guaranteed) {
      const [id, n] = Array.isArray(t.guaranteed) ? t.guaranteed : [t.guaranteed, 1];
      rolled.unshift({ id, count: n });
    }
    if (rolled.length === 0) {
      this.hud.toast('', 'Nothing useful.');
      this.audio.uiBad();
      return;
    }
    for (const r of rolled) this.giveItem(r.id, r.count);
  }

  _startRest() {
    this.resting = true;
    this.restStart = this.time.hour;
    this.time.timeScale = 9;
    this.hud.subtitle('You close your eyes. Every sound outside is very clear.', 4);
    this.hud.toast('', 'Resting…');
  }

  _stopRest(reason) {
    if (!this.resting) return;
    this.resting = false;
    this.time.timeScale = 1;
    if (reason) this.hud.toast('bad', reason);
  }

  // ───────────────────────────────────────────────────────────── input ──

  _handleKeys() {
    const inp = this.input;

    if (this.state === GameState.NOTE) {
      if (inp.pressed('KeyE') || inp.pressed('Escape') || inp.pressed('Tab')) {
        this.hud.closeNote();
        this.state = GameState.PLAYING;
        this._interactLock = 0.3;
      }
      return;
    }

    if (this.state !== GameState.PLAYING) return;

    if (inp.pressed('Tab') || inp.pressed('KeyI')) {
      const open = this.hud.toggleInventory();
      this.audio.uiClick();
      if (open) this.input.exitLock();
      else this.input.requestLock();
    }

    if (inp.pressed('Escape')) {
      if (this.hud.inventoryOpen) {
        this.hud.closeInventory();
        this.input.requestLock();
      }
    }

    if (this.hud.inventoryOpen) {
      if (inp.pressed('KeyQ')) this.dropSlot(this.hud.selectedSlot);
      for (let i = 0; i < 9; i++) {
        if (inp.pressed(`Digit${i + 1}`)) {
          this.hud.selectedSlot = i;
          this.hud._lastInvSig = '';
          this.useSlot(i);
        }
      }
      return;
    }

    for (let i = 0; i < 9; i++) {
      if (inp.pressed(`Digit${i + 1}`)) this.useSlot(i);
    }

    if (inp.pressed('KeyF')) this.player.toggleFlashlight();
    if (inp.pressed('KeyX')) {
      const w = this.inventory.cycleWeapon(1);
      this.hud.toast('', `${WEAPONS[w].name}`);
      this.audio.uiClick();
    }

    if (this.resting) {
      // Any meaningful input wakes you up.
      if (
        inp.moveAxis().x ||
        inp.moveAxis().z ||
        inp.pressed('Space') ||
        inp.mousePressed.left ||
        inp.pressed('KeyE')
      ) {
        this._stopRest('You get up.');
      }
      return;
    }

    if (inp.mousePressed.left && this.input.locked) this.player.tryAttack();
  }

  // ────────────────────────────────────────────────────────────── loop ──

  _loop = () => {
    requestAnimationFrame(this._loop);
    let dt = this.clock.getDelta();
    if (dt > 0.06) dt = 0.06; // never let a hitch teleport anything
    this.elapsed += dt;

    /**
     * Micro-slow on a kill. Sixty milliseconds of quarter-speed — below the
     * threshold where it registers as slow motion, above the one where the
     * body dropping reads as a state change rather than an event.
     */
    if (this._slowmo > 0) {
      this._slowmo -= dt;
      dt *= CFG.combat.killSlowScale;
    }

    try {
      this._update(dt);
    } catch (e) {
      console.error('[update]', e);
    }

    try {
      this._render(dt);
    } catch (e) {
      console.error('[render]', e);
    }

    this.input.endFrame();
  };

  _update(dt) {
    this._handleKeys();

    const playing = this.state === GameState.PLAYING;
    const frozen = !playing || this.hud.inventoryOpen;

    if (this.state === GameState.NOTE) {
      // World holds its breath while you read. Short notes; it's a fair trade.
      this.hud.update(dt, this._hudState());
      return;
    }

    if (!playing) {
      // Keep the sky drifting on the menus so the world feels alive.
      this.time.update(dt * 0.25, this.player?.pos);
      this.world?.update(dt, this.time, this.player?.pos || new THREE.Vector3());
      this.particles?.update(dt);
      return;
    }

    const controlsEnabled = !this.hud.inventoryOpen && this.input.locked && !this.resting;

    if (controlsEnabled) this.cameraRig.handleMouse(this.input);
    else this.input.consumeMouseDelta();

    // ── time ──
    const hoursDt = this.time.update(dt, this.player.pos);
    const night = this.time.lightLevel < 0.34;

    /**
     * Concealment is one world query, so it is answered once here and handed
     * to everything that needs it rather than recomputed per zombie.
     */
    this._concealed =
      this.player.crouching &&
      this.world.isConcealed(
        this.player.pos.x, this.player.pos.z, this.time.lightLevel, this.player.flashlightOn
      );

    // ── player ──
    const ctx = {
      controlsEnabled,
      concealed: this._concealed,
      cameraPitch: this.cameraRig.pitch,
      night,
      aiming: this.player.weapon.ranged && this.input.mouse.right,
      onSwing: (w) => this._swing(w),
      onShoot: (w) =>
        this.combat.resolveShot(this.player, w, {
          pitch: this.cameraRig.pitch,
          swayYaw: this.player.swayYaw,
          swayPitch: this.player.swayPitch,
        }),
      onThrow: (w) => this._throw(w),
      onShove: () => this.combat.resolveShove(this.player),
      onFinish: (z) => this._finish(z),
    };
    this.player.update(dt, this.input, this.cameraRig.yaw, ctx);

    // distance stat
    const dx = this.player.pos.x - this._lastPos.x;
    const dz = this.player.pos.z - this._lastPos.y;
    this.stats.distance += Math.hypot(dx, dz);
    this._lastPos.set(this.player.pos.x, this.player.pos.z);

    // ── survival ──
    const activity = {
      sprinting: this.player.sprinting,
      moving: this.player.speed > 0.5,
      resting: this.resting,
    };
    this.survival.update(dt, hoursDt, activity);

    for (const ev of this.survival.drainEvents()) this.hud.toast(ev.kind, ev.text);

    if (this.survival.dead && this.player.state !== PlayerState.DEAD) {
      this.player.die(this.survival.deathCause);
    }

    // ── world / AI ──
    this.noise.update(dt);
    this.world.nav.update();
    this.world.update(dt, this.time, this.player.pos);

    const hordeCtx = {
      player: this.player,
      night,
      playerConcealed: this._concealed,
      /**
       * The director gates every special on the clock, so it needs the clock.
       * `pastFirstDusk` is the brute's gate: it does not exist until the light
       * has actually gone once, which is what keeps day one exactly as it was.
       */
      hour: this.time.hour,
      elapsedHours: this.time.elapsedHours,
      pastFirstDusk: this.time.hour >= CFG.time.duskStart || this.time.elapsedHours >= 2.0,
      onPlayerHit: () => {
        this.cameraRig.addShake(0.55);
        this._stopRest('Something is in the room.');
      },
      onBoardsBroken: (op) => {
        this.hud.toast('bad', 'The boards give way.');
        if (op === this.world.safehouse?.doorOpening) this.hud.subtitle('The boards give way.', 3);
        this.cameraRig.addShake(0.5);
        this._stopRest('The boards give way.');
      },
      onOpeningBroken: (op) => {
        this.hud.toast('bad', op.isDoor ? 'The door comes off its hinges.' : 'They are through the window.');
        this.cameraRig.addShake(0.6);
        this._stopRest('Something is in the room.');
      },
    };
    this.horde.update(dt, hordeCtx);
    this.stats.kills = this.horde.killCount;

    this.particles.update(dt);
    this.throwables.update(dt);
    this.fire.update(dt, {
      horde: this.horde,
      player: this.player,
      onPlayerBurn: (amount) => {
        this.survival.damage(amount, 'fire');
        this.survival.damageFlash = Math.min(1, this.survival.damageFlash + amount * 0.05);
        if (!this._burnWarned || this.elapsed - this._burnWarned > 2.5) {
          this._burnWarned = this.elapsed;
          this.hud.toast('bad', 'You are standing in it.');
        }
      },
    });

    // ── camera ──
    this.cameraRig.update(dt, this.player, { aiming: ctx.aiming });

    // ── interaction ──
    if (controlsEnabled) this._updateInteraction(dt);
    else this.hud.setPrompt(null);

    // ── rest ──
    if (this.resting) {
      const threat = this.horde.threat(this.player.pos);
      if (threat.closest < 9 && this.horde.countChasing() > 0) {
        this._stopRest('Something is close.');
      }
      if (this.time.hour >= 6.1 && this.time.hour < 12) this._stopRest(null);
      if (this.survival.thirst <= 3 || this.survival.hunger <= 3) this._stopRest('You cannot sleep like this.');
    }

    // ── objectives ──
    this.objectives.update(dt, { time: this.time, player: this.player, world: this.world });
    for (const ev of this.objectives.drain()) {
      this.hud.toast(ev.kind, ev.text);
      if (ev.big) this.hud.subtitle(ev.text, 6);
    }

    // ── audio listener ──
    this.audio.setListener(this.camera.position.x, this.camera.position.z, this.cameraRig.yaw);
    const threat = this.horde.threat(this.player.pos);
    this.audio.update(dt, {
      isNight: night,
      threat: threat.level,
      healthFrac: this.survival.health / this.survival.maxHealth,
      indoors: !!this.world.isInside(this.player.pos.x, this.player.pos.z),
      moving: this.player.speed > 0.5,
    });
    this._threat = threat;

    // ── end states ──
    if (this.player.state === PlayerState.DEAD && this.player.deathTimer > 2.6) {
      this._enterDeath();
    }
    if (this.objectives.goal === Goal.DONE) {
      this._enterWin();
    }

    this.hud.update(dt, this._hudState());
  }

  _hudState() {
    const p = this.player;
    const night = this.time.lightLevel < 0.34;
    const threats = [];
    if (this.horde) {
      for (const z of this.horde.zombies) {
        if (z.isDead) continue;
        if (z.state !== ZState.CHASE && z.state !== ZState.ATTACK) continue;
        const dx = z.pos.x - p.pos.x;
        const dz = z.pos.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 26) continue;
        const world = Math.atan2(dx, dz);
        const rel = angleDelta(this.cameraRig.yaw, world);
        threats.push({ angle: -rel, strength: clamp01(1 - d / 26) * 0.85 });
        if (threats.length >= 8) break;
      }
    }

    return {
      survival: this.survival,
      objectiveTitle: this.objectives.title,
      objectiveSub: this.objectives.subtitle,
      clock: this.time.clockString,
      phase: this.time.phaseName,
      night,
      nightTint: clamp01((0.42 - this.time.lightLevel) / 0.42) * 0.16,
      weapon: p.weapon,
      condition: this.inventory.equippedCondition,
      chamber: p.chamber,
      reserveAmmo: this.inventory.count('ammo_38'),
      reloading: !!p.reloading,
      aiming: !!p.aimT && p.weapon.ranged,
      aimSway: { yaw: p.swayYaw, pitch: p.swayPitch },
      noise: this.noise.playerNoise,
      awareness: this.horde ? this.horde.peakAwareness() : 0,
      crouching: p.crouching,
      concealed: !!this._concealed,
      hiddenIn: p.hidden ? p.hidden.label : null,
      flashlightOn: p.flashlightOn,
      battery: p.battery,
      indoors: !!this.world.isInside(p.pos.x, p.pos.z),
      barricaded: !!this.world.safehouse?.barricaded,
      threats,
    };
  }

  _enterDeath() {
    if (this.state === GameState.DEAD) return;
    this.state = GameState.DEAD;
    this._stopRest(null);
    this.input.exitLock();
    this.hud.setPrompt(null);
    this.hud.setSearchProgress(null);
    const s = this.stats;
    const survived = this.time.elapsedHours;
    this.hud.showDeath(
      this._deathLine(this.survival.deathCause),
      `SURVIVED <b>${survived.toFixed(1)} hours</b> · died at <b>${this.time.clockString}</b><br>
       PUT DOWN <b>${s.kills}</b> · SEARCHED <b>${s.searched}</b> places · FOUND <b>${s.itemsFound}</b> items<br>
       WALKED <b>${Math.round(s.distance)}</b> metres`
    );
  }

  _deathLine(cause) {
    const lines = {
      'the dead': 'They got hold of you on the street. It was quick, at least.',
      dehydration: 'You stopped sweating hours ago. Then you stopped walking.',
      starvation: 'There was food somewhere in this neighbourhood. You did not find it.',
      'blood loss': 'You did not stop to bandage it. It only takes one.',
      'something far too heavy': 'It came down on top of you and did not get up.',
      'a bad landing': 'A stupid way to go, in the end.',
    };
    return lines[cause] || 'The first night got you.';
  }

  _enterWin() {
    if (this.state === GameState.WIN) return;
    this.state = GameState.WIN;
    this._stopRest(null);
    this.input.exitLock();
    this.audio.dawnStinger();
    const s = this.stats;
    const inside = this.world.isInSafehouse(this.player.pos.x, this.player.pos.z);
    this.hud.showWin(
      inside
        ? 'Grey light through the boards. The street is quiet in the way streets are quiet<br>when nothing is left alive on them.'
        : 'The sun comes up and finds you still outside, still standing.<br>You are not sure that counts as luck.',
      `SURVIVED THE FIRST NIGHT · <b>${this.time.elapsedHours.toFixed(1)} hours</b><br>
       PUT DOWN <b>${s.kills}</b> · SEARCHED <b>${s.searched}</b> places · FOUND <b>${s.itemsFound}</b> items<br>
       HEALTH REMAINING <b>${Math.round(this.survival.health)}</b> · WALKED <b>${Math.round(s.distance)}</b> m`
    );
  }

  // ───────────────────────────────────────────────────────────── render ──

  _render(dt) {
    if (this.gradePass) {
      const u = this.gradePass.uniforms;
      u.uTime.value = this.elapsed;
      const light = this.time ? this.time.lightLevel : 1;
      const hurt = this.survival ? 1 - clamp01(this.survival.health / this.survival.maxHealth) : 0;
      const threatLevel = this._threat ? this._threat.level : 0;

      u.uDesat.value = 0.1 + (1 - light) * 0.22;
      u.uTintAmount.value = (1 - light) * 0.3;
      u.uTintColor.value.setRGB(0.09, 0.12, 0.2);
      u.uDamage.value = clamp01(hurt * hurt * 0.78 + (this.survival?.damageFlash || 0) * 0.3);
      u.uVignette.value = 0.6 + threatLevel * 0.26 + hurt * 0.2;
      u.uGrain.value = 0.045 + (1 - light) * 0.055;
      u.uExposure.value = 1.0;
      u.uAberration.value = 0.0009 + threatLevel * 0.0016;
    }

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);

    // Dev-only, and only ever attached by main.js under ?debug / ?headless.
    this.debugOverlay?.update(dt);
  }
}
