/**
 * World.js — the map.
 *
 * A compact suburban block: one crossroads, houses on the west side, a corner
 * store and an alley on the east, a park to the north-west, and an abandoned
 * police checkpoint at the top of the road that explains why nobody is coming
 * to help. Density over size — you should never walk more than fifteen seconds
 * without finding something that tells you what happened here.
 *
 * Everything is authored by hand in code (positions are deliberate, not
 * random) with a seeded RNG for the scatter details so the layout is identical
 * every run.
 */

import * as THREE from 'three';
import CFG from '../core/Config.js';
import { makeRng } from '../core/Utils.js';
import { CollisionWorld, segmentHitsRect } from './Collision.js';
import { NavGrid } from './NavGrid.js';
import { Builder, makeMaterials } from './Builders.js';
import { Opening, OpeningState, OpeningType } from './Openings.js';
import { asphaltTexture, grassTexture, sidewalkTexture, signTexture } from './Textures.js';

export class World {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);

    this.collision = new CollisionWorld();
    this.nav = new NavGrid(CFG.world.size, CFG.world.cell);
    this.M = makeMaterials();
    this.B = new Builder(this.root, this.collision, this.M);
    this.rng = makeRng(20240419);

    this.buildings = [];      // { bounds, roofGroup, name, interiorLight }
    this.interactables = [];  // containers, notes, beds, hiding spots
    this.openings = [];       // every door and window, see Openings.js
    this.concealment = [];    // { x, z, r } bushes and other places to crouch in
    this.zombieSpawns = [];
    this.streetlights = [];
    this.flickerLights = [];
    this.emergencyLights = [];
    this.safehouse = null;
    this.playerSpawn = new THREE.Vector3(2.5, 0, 54);
    this.notesRead = new Set();

    /**
     * Rooms have roofs, so no sunlight gets in and every interior reads as a
     * black hole. Rather than lighting every room individually, one soft fill
     * follows the player indoors — it stands in for daylight through the
     * windows, and it dims at night so interiors still feel unlit after dark.
     */
    this.interiorFill = new THREE.PointLight(0xcfd6dc, 0, 16, 1.3);
    this.interiorFill.position.set(0, 2.4, 0);
    this.root.add(this.interiorFill);

    // The point light alone leaves every surface facing away from it in pure
    // black. A matching ambient term lifts those faces so furniture reads as
    // furniture rather than as holes in the room.
    this.interiorAmbient = new THREE.AmbientLight(0xbcc6cf, 0);
    this.root.add(this.interiorAmbient);

    this._t = 0;
    this._navDirty = [];      // rects awaiting a local nav rebuild
    this._navScratch = [];
    this.navRebuildMs = 0;    // last flush cost, for the perf harness
  }

  /**
   * Every building goes through here rather than straight to the Builder, so
   * the gaps it leaves in its walls become tracked `Opening`s.
   */
  _building(spec) {
    const b = this.B.building(spec);
    b.openings = [];
    for (const gap of b.gaps || []) {
      const op = new Opening({ ...gap, building: b }, this);
      this.openings.push(op);
      b.openings.push(op);
    }
    return b;
  }

  build(onProgress = () => {}) {
    onProgress(0.05, 'laying tarmac…');
    this._ground();
    onProgress(0.18, 'raising houses…');
    this._safehouse();
    this._housesWest();
    onProgress(0.36, 'opening the store…');
    this._store();
    this._alleyAndApartments();
    onProgress(0.55, 'the park…');
    this._park();
    onProgress(0.7, 'the checkpoint…');
    this._checkpoint();
    onProgress(0.8, 'scattering the evidence…');
    this._streetProps();
    this._boundary();
    onProgress(0.9, 'waking the neighbours…');
    this._spawnPoints();
    this.concealment = this.B.conceal || [];
    this.nav.build(this.collision, 0.34);
    this._resolveHideSpots();
    onProgress(1.0, 'ready');
    return this;
  }

  /**
   * Hiding places are furniture, and furniture is solid, so the square a
   * wardrobe stands on is never walkable. Every spot therefore needs a real
   * patch of floor beside it: somewhere the player reappears when they climb
   * out, and somewhere a searcher can actually stand to haul them out.
   *
   * Derived from the nav grid rather than hand-placed, so a spot can never be
   * authored into a corner nothing can reach — which would make hiding free.
   */
  _resolveHideSpots() {
    for (const it of this.interactables) {
      if (it.type !== 'hide') continue;
      const free = this.nav.nearestFree(it.exitX ?? it.x, it.exitZ ?? it.z, 6);
      if (free) {
        it.approachX = this.nav.toWorldX(free.ix);
        it.approachZ = this.nav.toWorldZ(free.iz);
      } else {
        it.approachX = it.exitX ?? it.x;
        it.approachZ = it.exitZ ?? it.z;
      }
      it.exitX = it.approachX;
      it.exitZ = it.approachZ;
      if (it.faceYaw === null || it.faceYaw === undefined) {
        it.faceYaw = Math.atan2(it.approachX - it.x, it.approachZ - it.z);
      }
      it.reach = Math.hypot(it.approachX - it.x, it.approachZ - it.z);
    }
  }

  /**
   * Can a crouched player at this point avoid being picked out? Either they
   * are down inside foliage, or it is dark and there is nothing burning
   * nearby to silhouette them. A lit torch gives the game away either way.
   */
  isConcealed(x, z, lightLevel, flashlightOn) {
    if (flashlightOn) return false;
    for (const c of this.concealment) {
      const dx = c.x - x,
        dz = c.z - z;
      if (dx * dx + dz * dz <= c.r * c.r) return true;
    }
    if (lightLevel > CFG.stealth.darknessLevel) return false;
    const R = CFG.stealth.lightProximity;
    for (const f of this.flickerLights) {
      if (f.light.intensity < 1) continue;
      const dx = f.light.position.x - x,
        dz = f.light.position.z - z;
      if (dx * dx + dz * dz < R * R) return false;
    }
    for (const pl of this.lampLights || []) {
      if (pl.intensity < 1) continue;
      const dx = pl.position.x - x,
        dz = pl.position.z - z;
      if (dx * dx + dz * dz < R * R) return false;
    }
    return true;
  }

  // ───────────────────────────────────────────────────────────── ground ──

  _ground() {
    const S = CFG.world.size;
    const B = this.B;

    // Grass base
    const grassMat = new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 });
    grassMat.map.repeat.set(34, 34);
    const g = new THREE.Mesh(new THREE.PlaneGeometry(S + 40, S + 40), grassMat);
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    this.root.add(g);

    // Roads
    const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.98 });
    roadMat.map.repeat.set(4, 30);
    const roadNS = new THREE.Mesh(new THREE.PlaneGeometry(12, 150), roadMat);
    roadNS.rotation.x = -Math.PI / 2;
    roadNS.position.set(0, 0.02, 0);
    roadNS.receiveShadow = true;
    this.root.add(roadNS);

    const roadMat2 = roadMat.clone();
    roadMat2.map = asphaltTexture().clone();
    roadMat2.map.repeat.set(30, 4);
    roadMat2.map.needsUpdate = true;
    const roadEW = new THREE.Mesh(new THREE.PlaneGeometry(150, 11), roadMat2);
    roadEW.rotation.x = -Math.PI / 2;
    roadEW.position.set(0, 0.021, 0);
    roadEW.receiveShadow = true;
    this.root.add(roadEW);

    // Sidewalks + kerbs (kerbs are below step height so they don't snag you)
    const swMat = new THREE.MeshStandardMaterial({ map: sidewalkTexture(), color: 0xa9a49a, roughness: 0.95 });
    swMat.map.repeat.set(3, 40);
    for (const sx of [-1, 1]) {
      const sw = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 150), swMat);
      sw.rotation.x = -Math.PI / 2;
      sw.position.set(sx * 7.7, 0.03, 0);
      sw.receiveShadow = true;
      this.root.add(sw);
      B.box(sx * 6.05, 0, 0, 0.35, 0.15, 150, this.M.sidewalk, { solid: false, cast: false });
    }
    const swMat2 = swMat.clone();
    swMat2.map = sidewalkTexture().clone();
    swMat2.map.repeat.set(40, 3);
    swMat2.map.needsUpdate = true;
    for (const sz of [-1, 1]) {
      const sw = new THREE.Mesh(new THREE.PlaneGeometry(150, 3.4), swMat2);
      sw.rotation.x = -Math.PI / 2;
      sw.position.set(0, 0.031, sz * 7.2);
      sw.receiveShadow = true;
      this.root.add(sw);
    }

    // Centre line
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xa89b58, transparent: true, opacity: 0.55 });
    for (let z = -72; z < 72; z += 6) {
      if (Math.abs(z) < 8) continue;
      B.ground(0, z, 0.3, 3.2, lineMat, 0.035);
    }
    for (let x = -72; x < 72; x += 6) {
      if (Math.abs(x) < 8) continue;
      B.ground(x, 0, 3.2, 0.3, lineMat, 0.035);
    }

    // Driveways
    const dwMat = new THREE.MeshStandardMaterial({ map: sidewalkTexture(), color: 0x8d8880, roughness: 0.95 });
    for (const z of [42, 14, -14]) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 14), dwMat);
      d.rotation.x = -Math.PI / 2;
      d.position.set(-15, 0.028, z);
      d.receiveShadow = true;
      this.root.add(d);
    }
  }

  // ────────────────────────────────────────────────────────── safehouse ──

  _safehouse() {
    const B = this.B;
    const X = -30,
      Z = 42;

    const b = this._building({
      x: X,
      z: Z,
      w: 10,
      d: 8.5,
      height: 3.0,
      wallMat: this.M.plasterB,
      floorMat: this.M.wood,
      roofStyle: 'gable',
      doors: [{ side: 'e', offset: 0, width: 2.3 }],
      windows: [
        { side: 'n', offset: -2.4, width: 1.7, boarded: true, broken: true },
        { side: 'n', offset: 2.4, width: 1.7, boarded: true },
        { side: 's', offset: 0, width: 2.0, boarded: true },
        { side: 'w', offset: -1.8, width: 1.6, boarded: true },
      ],
    });
    b.name = 'safehouse';
    this.buildings.push(b);

    // Interior: it has clearly been used as a refuge before.
    B.bed(X - 3.0, Z - 2.4, 0.16);
    B.sofa(X + 2.4, Z + 2.6, Math.PI, this.M.fabricRed);
    B.table(X - 0.4, Z + 1.2, 0.2, 1.4, 0.9);
    B.chair(X - 1.6, Z + 1.6, 1.2);
    B.cabinet(X + 3.6, Z - 2.8, -Math.PI / 2, 1.2, 1.0);
    B.shelf(X - 4.2, Z + 2.0, Math.PI / 2, 2.0, 1.6, true);
    B.crate(X + 3.2, Z + 0.2, 0.4, 0.8);

    // Camping lantern — the only warm light for a hundred metres.
    const lantern = new THREE.PointLight(0xffb264, 0, 13, 1.6);
    lantern.position.set(X - 0.4, 1.35, Z + 1.2);
    this.root.add(lantern);
    const lampMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.24, 0.18),
      new THREE.MeshBasicMaterial({ color: 0xffcf94 })
    );
    lampMesh.position.copy(lantern.position);
    this.root.add(lampMesh);
    b.interiorLight = lantern;
    b.interiorMesh = lampMesh;
    this.flickerLights.push({ light: lantern, mesh: lampMesh, base: 16, speed: 2.1, amount: 0.1 });

    // Spray-painted marking outside — someone cleared this house already.
    B.sign(X + 5.06, 1.9, Z + 2.6, 'CLEARED\n4 IN', 2.2, 1.3, Math.PI / 2, {
      bg: '#8e8375',
      fg: '#7c2020',
      size: 46,
      border: false,
      font: 'Impact, sans-serif',
    });

    // Porch
    B.box(X + 5.4, 0, Z, 1.4, 0.16, 4.0, this.M.wood, { platform: true, opaque: false });

    // The front door is an ordinary Opening; the objective's "board the door"
    // beat just boards it, exactly as it would any other doorway in the map.
    const doorOpening = b.openings.find((o) => o.type === OpeningType.DOOR);

    this.safehouse = {
      building: b,
      bounds: { minX: X - 5, maxX: X + 5, minZ: Z - 4.25, maxZ: Z + 4.25 },
      door: { x: doorOpening ? doorOpening.x : X + 5.0, z: doorOpening ? doorOpening.z : Z },
      doorOpening,
      get barricaded() {
        return !!doorOpening && doorOpening.state === OpeningState.BOARDED;
      },
      get barricadeHp() {
        return doorOpening ? doorOpening.totalHp : 0;
      },
      get barricadeMax() {
        return doorOpening ? doorOpening.maxHp + doorOpening.boardMax : 1;
      },
    };

    // Containers
    this.addContainer(X + 3.6, Z - 2.8, 'Cabinet', 'kitchen', 1.0);
    this.addContainer(X - 3.0, Z - 2.4, 'Bedside', 'bedroom', 0.9);
    B.wardrobe(X - 4.3, Z - 3.2, Math.PI / 2);
    this.addHideSpot(X - 4.3, Z - 3.2, 'Wardrobe', X - 3.2, Z - 3.0, Math.PI / 2);
    this.addHideSpot(X - 3.0, Z - 2.4, 'Under the bed', X - 1.9, Z - 1.7);

    this.addNote(
      X - 0.4, Z + 1.2,
      'Note on the table',
      'We waited three days for the buses. They stopped coming.\nDad says the checkpoint on Ridge is still holding.\nIf you find this, the boards are in the garage. Use them.\n— K.'
    );

    // Rest point — on the sofa, deliberately away from the bedside drawer so
    // the two prompts never fight over the same patch of floor.
    this.interactables.push({
      type: 'rest',
      x: X + 2.4,
      z: Z + 2.6,
      y: 0.8,
      radius: 1.9,
      label: 'Rest until dawn',
      verb: 'Rest',
      used: false,
    });
  }

  // ───────────────────────────────────────────────────────── west houses ──

  _housesWest() {
    const B = this.B;
    const rng = this.rng;

    // ── House A: front door standing wide open, blood on the porch ──
    {
      const X = -28,
        Z = 14;
      const b = this._building({
        x: X,
        z: Z,
        w: 11,
        d: 9,
        height: 3.0,
        wallMat: this.M.plasterA,
        floorMat: this.M.carpet,
        // Standing wide open — this is the house someone ran out of.
        doors: [{ side: 'e', offset: 1.2, width: 2.3, open: true }],
        windows: [
          { side: 'e', offset: -3.2, width: 1.8, broken: true },
          { side: 'n', offset: 0, width: 2.2 },
          { side: 's', offset: -1.5, width: 1.8, broken: true },
          { side: 'w', offset: 1.0, width: 1.8 },
        ],
      });
      b.name = 'house-a';
      this.buildings.push(b);

      // interior
      B.sofa(X - 2.6, Z + 2.4, 0);
      B.table(X - 2.6, Z + 0.4, 0, 1.4, 0.9, true); // knocked over
      B.chair(X - 1.0, Z - 0.5, 0.7, true);
      B.fridge(X + 3.6, Z - 3.2, Math.PI);
      B.counter(X + 1.2, Z - 3.4, 0, 2.4);
      B.cabinet(X - 1.8, Z - 3.4, 0, 1.1, 0.9);
      B.bed(X - 3.4, Z - 2.6, Math.PI / 2);

      // storytelling: struggle in the doorway
      B.bloodSplat(X + 5.2, Z + 1.4, 2.2, 3, 0.4);
      B.bloodSplat(X + 3.4, Z + 1.0, 1.6, 5, 1.1);
      B.bloodSplat(X + 7.0, Z + 1.8, 1.4, 7, 2.0);
      B.paper(X - 1, Z + 1, rng, 12, 3);
      B.debris(X + 6.2, Z + 1.5, rng, 5, 1.6);

      this.addContainer(X + 1.2, Z - 3.4, 'Kitchen counter', 'kitchen', 1.0);
      this.addContainer(X + 3.6, Z - 3.2, 'Fridge', 'kitchen', 1.2);
      this.addContainer(X - 1.8, Z - 3.4, 'Cupboard', 'kitchen', 0.9);
      this.addContainer(X - 3.4, Z - 2.6, 'Under the bed', 'bedroom', 1.1);
      B.wardrobe(X - 4.6, Z + 3.0, Math.PI / 2);
      this.addHideSpot(X - 4.6, Z + 3.0, 'Wardrobe', X - 3.5, Z + 3.0, Math.PI / 2);
      this.addHideSpot(X - 3.4, Z - 2.6, 'Under the bed', X - 2.1, Z - 1.9);
      this.addNote(
        X - 2.6, Z + 2.4,
        'Photograph',
        'A birthday photo, glass cracked. Four people around a table,\nparty hats, someone mid-laugh.\nThe frame has been picked up and put back more than once.'
      );

      // garage — planks live here
      const garage = this._building({
        x: X - 1,
        z: Z + 8.5,
        w: 6.5,
        d: 6,
        height: 2.6,
        wallMat: this.M.plasterA,
        floorMat: this.M.concrete,
        roofStyle: 'flat',
        doors: [{ side: 's', offset: 0, width: 3.0 }],
      });
      garage.name = 'garage';
      this.buildings.push(garage);
      B.crate(X - 2.4, Z + 9.4, 0.3, 0.9);
      B.crate(X + 0.6, Z + 9.8, -0.2, 0.8);
      this.addContainer(X - 2.4, Z + 9.4, 'Toolbox', 'garage', 1.1);
      this.addContainer(X + 0.6, Z + 9.8, 'Shelving', 'garage', 1.1);

      // driveway car
      B.car(-15.5, Z, 0, 'sedan', { smashed: true });
      this.addContainer(-15.5, Z - 2.6, 'Car boot', 'car_trunk', 1.4);

      B.fence(-22.5, Z - 8, -22.5, Z + 5, 1.5, 'wood');
      B.bush(X + 5.4, Z - 3.5);
      B.bush(X + 5.4, Z + 4.2);
      B.tree(-20, Z - 9, 1.05);
    }

    // ── House B: boarded up, someone barricaded themselves in ──
    {
      const X = -28,
        Z = -14;
      const b = this._building({
        x: X,
        z: Z,
        w: 10,
        d: 9.5,
        height: 3.0,
        wallMat: this.M.plasterC,
        floorMat: this.M.wood,
        doors: [{ side: 'w', offset: 0, width: 2.3 }],
        windows: [
          { side: 'e', offset: -2.6, width: 1.8, boarded: true },
          { side: 'e', offset: 2.6, width: 1.8, boarded: true, broken: true },
          { side: 'n', offset: 0, width: 2.0, boarded: true },
          { side: 's', offset: 0, width: 2.0, boarded: true, broken: true },
        ],
      });
      b.name = 'house-b';
      this.buildings.push(b);

      // Front door is boarded from outside — you have to go round the back.
      B.box(X + 5.0, 0.16, Z - 1.0, 0.12, 2.2, 2.4, this.M.plank, { solid: true, tag: 'boards' });
      B.sign(X + 5.14, 1.9, Z + 2.4, 'DO NOT\nOPEN', 1.9, 1.2, Math.PI / 2, {
        bg: '#7b6f61',
        fg: '#701d1d',
        size: 44,
        border: false,
      });

      B.bed(X - 2.6, Z + 2.8, 0);
      B.sofa(X + 2.0, Z + 2.8, Math.PI);
      B.table(X + 0.2, Z - 1.0, 0.4, 1.5, 0.9);
      B.chair(X + 1.6, Z - 1.6, 2.4, true);
      B.counter(X - 3.2, Z - 3.4, 0, 2.2);
      B.cabinet(X + 3.2, Z - 3.6, 0, 1.0, 0.9);
      B.fridge(X + 4.0, Z + 0.4, -Math.PI / 2);
      B.debris(X, Z, rng, 10, 4);
      B.bloodSplat(X - 1.0, Z + 1.2, 2.6, 11, 0.9);
      B.bodyBag(X - 3.6, Z - 1.4, 0.3);

      this.addContainer(X - 3.2, Z - 3.4, 'Kitchen counter', 'kitchen', 1.0);
      this.addContainer(X + 3.2, Z - 3.6, 'Medicine cabinet', 'bathroom', 1.3);
      this.addContainer(X + 4.0, Z + 0.4, 'Fridge', 'kitchen', 1.1);
      this.addContainer(X - 2.6, Z + 2.8, 'Bedside drawer', 'bedroom', 1.0);
      this.addNote(
        X + 0.2, Z - 1.0,
        'Torn diary page',
        'Day 4. Mrs. Alvez stopped knocking on the wall this morning.\nI keep telling myself that is a good sign.\nWater is out. If the tank in the store is still full I have to try.'
      );

      B.fence(-22.5, Z - 10, -22.5, Z + 6, 1.5, 'wood');
      B.tree(-20, Z + 8, 0.95, true);
      B.car(-15.5, Z + 1, 0.12, 'suv', { flat: true });
      this.addContainer(-15.5, Z - 1.8, 'Car boot', 'car_trunk', 1.4);
    }

    // ── House C (north-west, half collapsed) ──
    {
      const X = -30,
        Z = -38;
      const b = this._building({
        x: X,
        z: Z,
        w: 9,
        d: 8,
        height: 2.9,
        wallMat: this.M.brickB,
        floorMat: this.M.wood,
        roofStyle: 'flat',
        doors: [
          { side: 'e', offset: 0, width: 2.4 },
          { side: 'n', offset: 2.0, width: 3.4 }, // wall collapsed
        ],
        windows: [{ side: 's', offset: 0, width: 2.0, broken: true }],
      });
      b.name = 'house-c';
      this.buildings.push(b);
      B.debris(X + 2.5, Z - 4.5, rng, 16, 3.4);
      B.debris(X, Z, rng, 8, 3);
      B.table(X - 2.0, Z + 1.0, 0.9, 1.4, 0.9, true);
      B.cabinet(X - 3.0, Z - 2.4, 0, 1.1, 0.9);
      B.counter(X + 1.6, Z + 2.6, Math.PI, 2.0);
      this.addContainer(X - 3.0, Z - 2.4, 'Cupboard', 'kitchen', 1.0);
      this.addContainer(X + 1.6, Z + 2.6, 'Counter', 'bathroom', 1.0);
      B.bloodSplat(X + 3.0, Z + 1.0, 2.0, 13, 0.2);
    }
  }

  // ──────────────────────────────────────────────────────────────── store ──

  _store() {
    const B = this.B;
    const rng = this.rng;
    const X = 26,
      Z = 12;

    const b = this._building({
      x: X,
      z: Z,
      w: 16,
      d: 12,
      height: 4.0,
      wallMat: this.M.brickA,
      floorMat: this.M.tile,
      roofStyle: 'flat',
      doors: [{ side: 'w', offset: 2.0, width: 2.6 }],
      windows: [
        { side: 'w', offset: -3.0, width: 4.2, broken: true },
        { side: 's', offset: -3.0, width: 3.0, broken: true },
        { side: 's', offset: 3.0, width: 3.0 },
      ],
    });
    b.name = 'store';
    this.buildings.push(b);

    // Storefront sign — the flickering neon is the only thing still working
    B.sign(X - 8.2, 4.6, Z, "MARV'S\nCORNER MARKET", 7.0, 2.4, -Math.PI / 2, {
      bg: '#141b22',
      fg: '#d8b25a',
      size: 62,
      w: 640,
      h: 220,
      emissive: 0x6a4f18,
      emissiveIntensity: 1.0,
    });

    // Interior: shelves knocked over, food long gone from the front
    B.shelf(X - 2.5, Z - 3.5, 0, 6.0, 1.9);
    B.shelf(X - 2.5, Z + 0.5, 0, 6.0, 1.9);
    B.shelf(X - 2.5, Z + 4.0, 0, 5.0, 1.9, true);
    B.cooler(X + 7.0, Z - 2.0, -Math.PI / 2, 5.0);
    B.cooler(X + 7.0, Z + 3.5, -Math.PI / 2, 3.4);
    B.counter(X - 6.0, Z + 4.2, 0, 3.2);
    B.crate(X + 2.0, Z + 4.8, 0.5, 0.9);
    B.crate(X + 3.2, Z + 4.4, -0.3, 0.8);
    B.debris(X - 3, Z + 2, rng, 14, 5);
    B.paper(X - 4, Z + 3, rng, 18, 4);
    B.bloodSplat(X - 6.4, Z + 2.4, 2.6, 17, 0.6);
    B.bloodSplat(X + 1.0, Z - 4.0, 2.0, 19, 1.7);

    // Back store room, behind a doorway — better loot, tighter space
    B.box(X + 3.0, 0.16, Z - 6.0, 0.24, 3.84, 0.1, this.M.plasterA, { solid: false });
    B.wallWithGap('x', Z - 1.2, X + 2.0, X + 8.2, 0.16, 3.84, 0.24, this.M.plasterA, {
      at: X + 5.6,
      width: 2.2,
      kind: 'door',
    });
    B.shelf(X + 6.6, Z - 5.0, Math.PI, 3.0, 1.8);
    B.crate(X + 4.2, Z - 4.6, 0.2, 0.9);

    this.addContainer(X - 2.5, Z - 3.5, 'Shelving', 'store_shelf', 1.2);
    this.addContainer(X - 2.5, Z + 0.5, 'Shelving', 'store_shelf', 1.2);
    this.addContainer(X + 7.0, Z - 2.0, 'Drinks cooler', 'store_cooler', 1.6);
    this.addContainer(X + 7.0, Z + 3.5, 'Drinks cooler', 'store_cooler', 1.4);
    this.addContainer(X - 6.0, Z + 4.2, 'Till', 'register', 1.2);
    this.addContainer(X + 6.6, Z - 5.0, 'Stockroom shelf', 'store_shelf', 1.8);
    this.addContainer(X + 4.2, Z - 4.6, 'Crate', 'garage', 1.4);

    this.addNote(
      X - 6.0, Z + 4.2,
      'Sign taped to the till',
      'ONE PER CUSTOMER. NO EXCEPTIONS.\n\nUnderneath, in different handwriting:\n"took what we needed. sorry marv. we\'ll pay you back."'
    );

    // Flickering fluorescent inside
    const fl = new THREE.PointLight(0xbfd6e8, 0, 17, 1.55);
    fl.position.set(X - 1, 3.4, Z + 1);
    this.root.add(fl);
    const flMesh = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.1, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xcfe4f2 })
    );
    flMesh.position.copy(fl.position);
    this.root.add(flMesh);
    b.interiorLight = fl;
    b.interiorMesh = flMesh;
    this.flickerLights.push({ light: fl, mesh: flMesh, base: 15, speed: 9, amount: 0.85, stutter: true });

    // Outside: shopping trolley, spilled crate, a car halfway onto the kerb
    B.car(14.5, Z - 7.5, 1.9, 'van', { smashed: true });
    this.addContainer(14.5, Z - 7.5, 'Van cargo', 'car_trunk', 1.6);
    B.cone(12.5, Z - 4.5);
    B.cone(13.4, Z - 3.0);
    B.debris(16, Z - 6, rng, 8, 2.6);
  }

  // ──────────────────────────────────────────────────────── alley + flats ──

  _alleyAndApartments() {
    const B = this.B;
    const rng = this.rng;

    // Brick apartment block (east, south of the store) — creates the alley
    const X = 30,
      Z = -18;
    const b = this._building({
      x: X,
      z: Z,
      w: 18,
      d: 14,
      height: 5.6,
      wallMat: this.M.brickB,
      floorMat: this.M.concrete,
      roofStyle: 'flat',
      doors: [{ side: 'w', offset: -3.0, width: 2.4 }],
      windows: [
        { side: 'w', offset: 3.5, width: 2.0, broken: true },
        { side: 'n', offset: -4, width: 2.0 },
        { side: 'n', offset: 4, width: 2.0, broken: true },
        { side: 's', offset: 0, width: 2.4, boarded: true },
      ],
    });
    b.name = 'apartments';
    this.buildings.push(b);

    // Lobby-ish interior
    B.sofa(X - 5.0, Z + 4.0, 0, this.M.fabricBlue);
    B.table(X - 5.0, Z + 2.0, 0, 1.2, 0.8);
    B.counter(X + 5.0, Z + 4.6, Math.PI, 3.0);
    B.shelf(X + 6.5, Z - 4.0, Math.PI, 3.0, 1.8, true);
    B.cabinet(X - 2.0, Z - 5.0, 0, 1.2, 1.0);
    B.debris(X, Z, rng, 18, 6);
    B.bloodSplat(X - 6.0, Z + 0.5, 3.0, 23, 0.5);
    B.bodyBag(X + 2.0, Z - 2.0, 1.2);
    B.bodyBag(X + 3.0, Z - 2.4, 1.3);

    this.addContainer(X + 5.0, Z + 4.6, 'Reception desk', 'register', 1.3);
    this.addContainer(X - 2.0, Z - 5.0, 'Storage cupboard', 'garage', 1.4);
    this.addNote(
      X + 5.0, Z + 4.6,
      'Building notice',
      'RESIDENTS: The evacuation coach leaves from the checkpoint at 07:00.\nONE BAG EACH. NO PETS.\n\nSomeone has written under it: "there was no coach."'
    );

    // ── Alley between store and apartments ──
    B.dumpster(18.5, -2.0, 0.2);
    B.dumpster(18.2, 2.5, -0.15, 0x4a4a3c);
    B.dumpster(19.0, -7.0, 0.4, 0x3a4a52);
    this.addContainer(18.5, -2.0, 'Dumpster', 'backpack', 1.6);
    this.addContainer(19.0, -7.0, 'Dumpster', 'camp', 1.6);
    B.barrel(20.5, 5.0, true);
    B.debris(19, 0, rng, 20, 5);
    B.paper(18, -4, rng, 14, 4);
    B.bloodSplat(19.0, 4.0, 2.4, 29, 1.4);

    // Fire escape ladder + crates you can climb
    B.crate(21.5, -9.5, 0.1, 1.0, this.M.metalDark);
    B.crate(21.5, -8.4, 0.1, 1.0, this.M.metalDark);

    // Chain fence closing the far end of the alley — dead end, deliberately
    B.fence(14.0, -12.0, 22.0, -12.0, 2.2, 'chain');

    const barrelLight = new THREE.PointLight(0xff8a3a, 0, 13, 1.7);
    barrelLight.position.set(20.5, 1.4, 5.0);
    this.root.add(barrelLight);
    this.flickerLights.push({ light: barrelLight, mesh: null, base: 17, speed: 7, amount: 0.42, always: true });
  }

  // ─────────────────────────────────────────────────────────────── park ──

  _park() {
    const B = this.B;
    const rng = this.rng;
    const X = -34,
      Z = -34;

    // A patch of open grass with a low fence, trees, and a survivor camp
    for (const [tx, tz, s, dead] of [
      [-46, -22, 1.15, false],
      [-40, -30, 1.0, false],
      [-28, -28, 0.9, true],
      [-44, -42, 1.2, false],
      [-30, -46, 1.0, false],
      [-38, -52, 1.1, true],
      [-22, -40, 0.95, false],
      [-50, -34, 1.05, false],
      [-24, -52, 0.9, false],
    ])
      B.tree(tx, tz, s, dead);

    for (const [bx, bz, r] of [
      [-30, -32, 0.4],
      [-38, -38, 2.1],
      [-44, -30, 1.2],
      [-26, -44, 3.3],
    ])
      B.bench(bx, bz, r);

    B.bush(-42, -26);
    B.bush(-33, -25, 1.2);
    B.bush(-48, -44, 0.9);

    // Playground — swing frame + slide, empty
    {
      const px = -46,
        pz = -52;
      B.box(px - 2.2, 0, pz, 0.16, 2.4, 0.16, this.M.metal);
      B.box(px + 2.2, 0, pz, 0.16, 2.4, 0.16, this.M.metal);
      B.box(px, 2.4, pz, 4.6, 0.16, 0.16, this.M.metal, { solid: false });
      for (const off of [-1.1, 1.1]) {
        B.deco(px + off, 0.9, pz, 0.06, 1.5, 0.06, this.M.metalDark, { cast: true });
        B.deco(px + off, 0.85, pz, 0.5, 0.08, 0.28, this.M.plasticRed);
      }
      // sandpit
      B.ground(px + 5, pz + 2, 5, 5, new THREE.MeshStandardMaterial({ color: 0x8a7a55, roughness: 1 }), 0.04);
      B.debris(px + 5, pz + 2, rng, 5, 2);
    }

    // ── Survivor camp: tents, a fire barrel, and what's left of them ──
    const cx = -36,
      cz = -40;
    B.tent(cx - 2.5, cz, 0.3);
    B.tent(cx + 2.0, cz - 1.5, -0.6, this.M.tarp);
    B.tent(cx + 0.5, cz + 3.0, 1.9, this.M.tarp);
    B.barrel(cx, cz + 0.8, true);
    B.crate(cx - 4.0, cz + 1.5, 0.2, 0.9);
    B.backpack(cx + 3.4, cz + 1.6, 0.7);
    B.backpack(cx - 1.2, cz + 2.6, 2.1, 0x5a4a3a);
    B.bodyBag(cx + 4.5, cz - 2.5, 0.8);
    B.debris(cx, cz, rng, 22, 6);
    B.paper(cx, cz, rng, 20, 6);
    B.bloodSplat(cx + 1.4, cz - 2.2, 3.2, 31, 0.7);
    B.bloodSplat(cx - 2.0, cz + 1.4, 2.4, 37, 2.2);

    this.addContainer(cx - 2.5, cz, 'Tent', 'camp', 1.5);
    this.addContainer(cx + 2.0, cz - 1.5, 'Tent', 'camp', 1.5);
    this.addContainer(cx + 0.5, cz + 3.0, 'Tent', 'camp', 1.5);
    this.addContainer(cx + 3.4, cz + 1.6, 'Backpack', 'backpack', 1.4);
    this.addContainer(cx - 1.2, cz + 2.6, 'Backpack', 'backpack', 1.4);
    this.addContainer(cx - 4.0, cz + 1.5, 'Supply crate', 'camp', 1.6);

    this.addNote(
      cx, cz + 0.8,
      'Message scratched into the barrel',
      'IF YOU ARE READING THIS THE PARK IS NOT SAFE AT NIGHT\nTHEY COME UP FROM THE ROAD\nGO INSIDE. LOCK IT. DO NOT USE LIGHTS.'
    );

    const fireLight = new THREE.PointLight(0xff7a28, 0, 15, 1.7);
    fireLight.position.set(cx, 1.5, cz + 0.8);
    this.root.add(fireLight);
    this.flickerLights.push({ light: fireLight, mesh: null, base: 21, speed: 8.5, amount: 0.5, always: true });

    // Low park fence along the road side
    B.fence(-20, -20, -20, -58, 1.2, 'chain');
    B.fence(-20, -20, -52, -20, 1.2, 'chain');
  }

  // ──────────────────────────────────────────────────────── checkpoint ──

  _checkpoint() {
    const B = this.B;
    const rng = this.rng;
    const Z = -54;

    // Sandbag wall across the road with a gap you can squeeze through
    B.sandbags(-6.5, Z, 0, 6.0, 4);
    B.sandbags(6.5, Z, 0, 6.0, 4);
    B.barrier(-2.6, Z + 2.2, 0.25, 2.4);
    B.barrier(2.6, Z + 2.4, -0.3, 2.4);

    // Cruisers, one across the road, lights still turning over
    const cruiser1 = B.car(-4.5, Z - 5.0, 1.35, 'police', { smashed: true });
    const cruiser2 = B.car(5.0, Z - 7.5, -0.4, 'police');
    const ambulance = B.car(-9.0, Z - 12.0, 0.15, 'ambulance', { smashed: true });
    this.emergencyLights.push(cruiser1, cruiser2, ambulance);

    this.addContainer(-4.5, Z - 5.0, 'Cruiser boot', 'police', 1.8);
    this.addContainer(5.0, Z - 7.5, 'Cruiser boot', 'police', 1.6);
    this.addContainer(-9.0, Z - 12.0, 'Ambulance', 'medical', 2.0);

    // Triage tent
    B.tent(9.0, Z - 3.0, -0.5, this.M.tarp);
    B.tent(12.0, Z - 5.5, -0.5, this.M.tarp);
    this.addContainer(9.0, Z - 3.0, 'Medical tent', 'medical', 1.8);
    this.addContainer(12.0, Z - 5.5, 'Medical tent', 'medical', 1.6);

    for (const [bx, bz, r] of [
      [8.0, Z + 1.5, 0.2],
      [10.0, Z + 2.4, 0.5],
      [12.2, Z + 1.0, -0.3],
      [7.2, Z + 4.0, 1.1],
      [10.6, Z + 5.0, 0.9],
    ])
      B.bodyBag(bx, bz, r);

    // Floodlight mast — still running off a generator that will die eventually
    B.box(-12, 0, Z + 2, 0.4, 4.6, 0.4, this.M.metalDark);
    const flood = new THREE.SpotLight(0xffe8c0, 0, 52, 0.72, 0.45, 1.15);
    flood.position.set(-12, 5.0, Z + 2);
    flood.target.position.set(0, 0, Z - 2);
    this.root.add(flood);
    this.root.add(flood.target);
    this.checkpointFlood = flood;
    const floodMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.3, 0.4),
      new THREE.MeshBasicMaterial({ color: 0xffeccc })
    );
    floodMesh.position.set(-12, 4.9, Z + 2.15);
    this.root.add(floodMesh);
    this.flickerLights.push({ light: flood, mesh: floodMesh, base: 130, speed: 0.7, amount: 0.22, always: true });

    // Signage
    B.sign(0, 2.6, Z + 3.4, 'ROAD CLOSED\nBY ORDER', 5.0, 1.9, 0, {
      bg: '#7a2418',
      fg: '#efe6cf',
      size: 58,
      w: 512,
      h: 200,
    });
    B.sign(14.0, 2.2, Z - 1.0, 'TRIAGE\n→', 2.4, 1.6, -Math.PI / 2, {
      bg: '#1c2a1c',
      fg: '#cfe0c2',
      size: 54,
      w: 300,
      h: 200,
    });

    B.cone(-1.5, Z + 4.0);
    B.cone(1.5, Z + 4.6);
    B.cone(3.5, Z + 3.2);
    B.debris(0, Z - 2, rng, 24, 8);
    B.paper(2, Z - 1, rng, 26, 7);
    for (const [x, z, s, sd] of [
      [-2.0, Z - 1.5, 3.4, 41],
      [3.0, Z - 3.5, 2.8, 43],
      [-6.0, Z + 1.0, 2.6, 47],
      [6.5, Z - 1.0, 3.0, 53],
      [0.5, Z - 8.0, 2.2, 59],
    ])
      B.bloodSplat(x, z, s, sd, sd % 3);

    this.addNote(
      0, Z + 1.5,
      'Clipboard on the sandbags',
      'INTAKE LOG — 14:20 last entry.\nBed 1: bite, L forearm. Fever at 40 min.\nBed 2: bite, calf. Fever at 35 min.\nBed 3: no wound. Fever anyway.\n\nBottom of the page, pressed hard enough to tear:\n"IT IS NOT THE BITES"'
    );

    // Crashed car into the barrier further south — the story of the road
    B.car(-3.0, 26.0, 0.55, 'sedan', { smashed: true, tilt: 0.12 });
    B.barrier(-4.2, 28.6, 0.5, 2.4);
    B.debris(-3.5, 27.5, rng, 14, 3.2);
    B.bloodSplat(-1.6, 25.0, 2.4, 61, 0.9);
    this.addContainer(-3.0, 26.0, 'Wrecked car', 'car_trunk', 1.6);
    B.backpack(-1.0, 24.0, 0.4);
    this.addContainer(-1.0, 24.0, 'Backpack', 'backpack', 1.2);
  }

  // ────────────────────────────────────────────────────────── street kit ──

  _streetProps() {
    const B = this.B;
    const rng = this.rng;

    // Streetlights down both sides of the main road
    for (const z of [46, 30, 14, -2, -18, -34, -48]) {
      this.streetlights.push(B.streetlight(-7.4, z, 0));
      this.streetlights.push(B.streetlight(7.4, z, Math.PI));
    }
    for (const x of [-40, -22, 22, 40]) {
      this.streetlights.push(B.streetlight(x, -7.0, -Math.PI / 2));
    }

    // Point lights for the streetlamps would be too many; use a handful on the
    // main road only and let the rest be geometry.
    this.lampLights = [];
    for (const [lx, lz] of [
      [-5.9, 30],
      [5.9, -2],
      [-5.9, -34],
      [5.9, 46],
    ]) {
      const pl = new THREE.PointLight(0xffcf94, 0, 24, 1.6);
      pl.position.set(lx, 4.9, lz);
      this.root.add(pl);
      this.lampLights.push(pl);
    }

    // Abandoned traffic — a slow-motion evacuation that stopped
    const cars = [
      [3.2, 40, 0.02, 'sedan'],
      [-3.2, 34, -0.05, 'suv'],
      [3.4, 20, 0.1, 'sedan'],
      [-3.0, 8, 0.0, 'van'],
      [3.1, -10, -0.03, 'sedan'],
      [-3.3, -24, 0.06, 'suv'],
      [3.0, -36, 0.0, 'truck'],
      [16, 3.0, 1.55, 'sedan'],
      [-18, 3.2, 1.6, 'sedan'],
      [-36, -3.0, 1.52, 'van'],
      [38, 3.1, 1.58, 'suv'],
    ];
    for (const [x, z, r, v] of cars) {
      B.car(x, z, r, v, { smashed: rng.chance(0.45), flat: rng.chance(0.3) });
      if (rng.chance(0.45)) this.addContainer(x, z, 'Car boot', 'car_trunk', 1.4);
    }

    // Bus stop
    B.box(11.0, 0, 30, 0.16, 2.6, 3.6, this.M.metalDark, { opaque: false });
    B.box(11.0, 2.6, 30, 1.6, 0.14, 3.8, this.M.metalDark, { solid: false });
    B.bench(10.2, 30, Math.PI / 2);
    B.sign(9.9, 1.8, 30, 'ROUTE 12\nSUSPENDED', 1.6, 1.1, -Math.PI / 2, {
      bg: '#1b2733',
      fg: '#b8c4cc',
      size: 48,
      w: 300,
      h: 200,
    });
    this.addNote(
      10.2, 30,
      'Timetable, annotated',
      'Every departure after 11:40 has been crossed out in biro.\nAt the bottom someone has written the same word\nfourteen times, getting larger each time: WALK.'
    );

    // Scattered street storytelling
    B.backpack(6.0, 36, 0.9);
    this.addContainer(6.0, 36, 'Dropped backpack', 'backpack', 1.2);
    B.debris(0, 12, rng, 10, 4);
    B.paper(-4, 44, rng, 22, 6);
    B.paper(5, -20, rng, 18, 5);
    B.bloodSplat(4.5, 12.0, 2.2, 67, 0.3);
    B.bloodSplat(-5.5, -20.0, 2.8, 71, 1.9);
    B.bloodSplat(0.0, 48.0, 2.0, 73, 2.6);

    // A suitcase burst open — the spawn point story. Guaranteed knife: the
    // first fight should never be with bare hands.
    B.crate(4.0, 52.0, 0.6, 0.7, this.M.fabricBlue);
    B.paper(4.0, 52.0, rng, 16, 3);
    this.addContainer(4.0, 52.0, 'Burst suitcase', 'backpack', 1.2, 'kitchen_knife');
    B.bloodSplat(1.0, 56.0, 1.8, 79, 1.2);

    // Toolbox by the wrecked sedan — the reliable first real weapon, sitting
    // in plain sight on the way north.
    B.crate(-5.4, 24.2, 0.3, 0.65, this.M.metalDark);
    this.addContainer(-5.4, 24.2, 'Roadside toolbox', 'garage', 1.2, 'crowbar');

    B.tree(-12, 50, 1.1);
    B.tree(12, 44, 1.0, true);
    B.tree(-12, -12, 1.05);
    B.tree(13, -30, 1.15);
    B.tree(-12, 24, 0.95);
    B.bush(9, 18);
    B.bush(-9, -6);
  }

  _boundary() {
    const B = this.B;
    const rng = this.rng;
    const L = 66;

    // A visible ring of wrecks and rubble, plus an invisible wall behind it.
    const col = this.collision;
    col.addBox(-L - 8, -L - 8, -L, L + 8, 0, 12, { opaque: false, tag: 'bounds' });
    col.addBox(L, -L - 8, L + 8, L + 8, 0, 12, { opaque: false, tag: 'bounds' });
    col.addBox(-L - 8, -L - 8, L + 8, -L, 0, 12, { opaque: false, tag: 'bounds' });
    col.addBox(-L - 8, L, L + 8, L + 8, 0, 12, { opaque: false, tag: 'bounds' });

    const edge = [];
    for (let i = -L + 4; i < L; i += 9) {
      edge.push([i, -L + 1.5], [i, L - 1.5], [-L + 1.5, i], [L - 1.5, i]);
    }
    for (const [x, z] of edge) {
      if (Math.abs(x) < 9 && Math.abs(z) > L - 4) {
        // Keep the road ends blocked by wrecks specifically — reads better.
        B.car(x, z, rng.range(0, 3), rng.pick(['sedan', 'suv', 'van', 'truck']), { smashed: true, tilt: 0.1 });
        continue;
      }
      const r = rng.next();
      if (r < 0.34) {
        B.box(x, 0, z, rng.range(5, 9), rng.range(3.2, 6), rng.range(4, 7), this.M.brickB, {
          rotY: rng.range(0, 3.14),
        });
      } else if (r < 0.6) {
        B.car(x, z, rng.range(0, 3.14), rng.pick(['sedan', 'suv', 'van']), { smashed: true, flat: true });
      } else if (r < 0.8) {
        B.box(x, 0, z, rng.range(4, 8), rng.range(2.4, 4), rng.range(3, 6), this.M.concrete, {
          rotY: rng.range(0, 3.14),
        });
      } else {
        B.tree(x, z, rng.range(0.9, 1.4), rng.chance(0.5));
      }
      B.debris(x, z, rng, 6, 4);
    }
  }

  // ───────────────────────────────────────────────────────────── spawns ──

  _spawnPoints() {
    // Hand-placed so the pacing works: a couple near the start to teach you,
    // a real group around the store, and the park is a genuine no-go zone.
    this.zombieSpawns = [
      { x: -2, z: 34, count: 1, group: 'road-s', type: 'shambler' },
      { x: 8, z: 22, count: 1, group: 'road-s', type: 'shambler' },
      { x: -16, z: 16, count: 1, group: 'house-a', type: 'shambler' },
      { x: -26, z: 18, count: 1, group: 'house-a', type: 'stalker' },

      { x: 20, z: 14, count: 2, group: 'store', type: 'shambler' },
      { x: 27, z: 6, count: 1, group: 'store', type: 'bloated' },
      { x: 30, z: 16, count: 1, group: 'store', type: 'stalker' },

      { x: 18, z: -4, count: 2, group: 'alley', type: 'shambler' },
      { x: 28, z: -14, count: 1, group: 'alley', type: 'stalker' },

      { x: -34, z: -36, count: 3, group: 'park', type: 'shambler' },
      { x: -38, z: -42, count: 2, group: 'park', type: 'stalker' },
      { x: -30, z: -30, count: 1, group: 'park', type: 'bloated' },

      { x: 2, z: -50, count: 2, group: 'checkpoint', type: 'shambler' },
      { x: -6, z: -58, count: 2, group: 'checkpoint', type: 'shambler' },
      { x: 8, z: -60, count: 1, group: 'checkpoint', type: 'bloated' },

      { x: -28, z: -12, count: 1, group: 'house-b', type: 'shambler' },
      { x: -30, z: -40, count: 1, group: 'house-c', type: 'shambler' },
      { x: 0, z: -20, count: 1, group: 'road-n', type: 'shambler' },
      { x: -10, z: 0, count: 1, group: 'road-n', type: 'stalker' },
    ];
  }

  // ────────────────────────────────────────────────────── interactables ──

  /**
   * @param guaranteed  item id (or [id, count]) this container always yields
   *                    on top of its table roll. Used sparingly, to make sure
   *                    the opening ten minutes can't be ruined by dice.
   */
  addContainer(x, z, label, table, radius = 1.2, guaranteed = null) {
    const it = {
      type: 'container',
      x,
      z,
      y: 1.0,
      radius: Math.max(1.5, radius + 0.7),
      label,
      table,
      guaranteed,
      verb: 'Search',
      searchTime: CFG.loot.searchTimeBase * (0.85 + Math.random() * 0.5),
      used: false,
      id: this.interactables.length,
    };
    this.interactables.push(it);
    return it;
  }

  /**
   * A place to get inside and stop existing for a minute.
   *
   * `exit` is where you step back out to — never the spot itself, or you end
   * up standing in the wardrobe you were just hiding in.
   */
  addHideSpot(x, z, label, exitX, exitZ, faceYaw = null) {
    const it = {
      type: 'hide',
      x,
      z,
      y: 1.0,
      radius: 1.6,
      label,
      verb: 'Hide',
      exitX,
      exitZ,
      // Which way you are looking from in there. A wardrobe looks the way its
      // doors open; anything else looks back at the floor you came from.
      faceYaw,
      used: false,
      id: this.interactables.length,
    };
    this.interactables.push(it);
    return it;
  }

  addNote(x, z, label, text) {
    const it = {
      type: 'note',
      x,
      z,
      y: 1.0,
      radius: 2.0,
      label,
      text,
      verb: 'Read',
      used: false,
      id: this.interactables.length,
    };
    this.interactables.push(it);
    return it;
  }

  /**
   * Best interactable near a position. Prefers unused containers, then notes.
   */
  findInteractable(x, z, y = 0) {
    let best = null;
    let bestD = Infinity;
    for (const it of this.interactables) {
      const dx = it.x - x,
        dz = it.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > it.radius * it.radius) continue;
      // Don't offer things through a wall.
      if (this.collision.lineBlocked(x, z, it.x, it.z, 1.1, this._scratch || (this._scratch = []))) continue;
      let score = d2;
      if (it.used && it.type === 'container') score += 60;
      if (it.type === 'note' && this.notesRead.has(it.id)) score += 40;
      if (score < bestD) {
        bestD = score;
        best = it;
      }
    }
    return best;
  }

  // ────────────────────────────────────────────────────────── openings ──

  /**
   * An opening changed state, so the cells behind it are wrong. Queue the
   * rectangle rather than rebuilding now: several doors can give way in the
   * same frame and they should cost one flush between them.
   */
  markOpeningDirty(op) {
    const pad = 1.6;
    this._navDirty.push({
      minX: Math.min(op.box.minX, op.x) - pad,
      minZ: Math.min(op.box.minZ, op.z) - pad,
      maxX: Math.max(op.box.maxX, op.x) + pad,
      maxZ: Math.max(op.box.maxZ, op.z) + pad,
    });
  }

  /** Rebuild every queued region. Called once a frame from update(). */
  flushNavDirty() {
    if (!this._navDirty.length) return 0;
    const t0 = performance.now();
    let cells = 0;
    // Merge overlapping rects so two leaves of the same doorway cost one pass.
    const rects = this._navDirty;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (!r) continue;
      for (let j = i + 1; j < rects.length; j++) {
        const o = rects[j];
        if (!o) continue;
        if (o.minX > r.maxX || o.maxX < r.minX || o.minZ > r.maxZ || o.maxZ < r.minZ) continue;
        r.minX = Math.min(r.minX, o.minX);
        r.minZ = Math.min(r.minZ, o.minZ);
        r.maxX = Math.max(r.maxX, o.maxX);
        r.maxZ = Math.max(r.maxZ, o.maxZ);
        rects[j] = null;
      }
      cells += this.nav.rebuildRegion(
        this.collision, r.minX, r.minZ, r.maxX, r.maxZ, 0.34, this._navScratch
      );
    }
    this._navDirty.length = 0;
    this.navRebuildMs = performance.now() - t0;
    this.navRebuildCells = cells;
    return cells;
  }

  /** Nearest opening the player could plausibly reach from where they stand. */
  openingNear(x, z, radius = 2.2, filter = null) {
    let best = null;
    let bestD = radius * radius;
    for (const op of this.openings) {
      const dx = op.x - x,
        dz = op.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > bestD) continue;
      if (filter && !filter(op)) continue;
      bestD = d2;
      best = op;
    }
    return best;
  }

  openingsWithin(x, z, radius, out = []) {
    out.length = 0;
    const r2 = radius * radius;
    for (const op of this.openings) {
      const dx = op.x - x,
        dz = op.z - z;
      if (dx * dx + dz * dz <= r2) out.push(op);
    }
    return out;
  }

  /**
   * How much a sound is muffled travelling from A to B. Every closed solid on
   * the way — wall, shut door, boarded window — multiplies the effective
   * radius down. This is why closing a door behind you actually helps.
   */
  soundOcclusion(ax, az, bx, bz) {
    const O = CFG.openings;
    let blockers = 0;
    const scratch = this._occScratch || (this._occScratch = []);
    const minX = Math.min(ax, bx),
      maxX = Math.max(ax, bx);
    const minZ = Math.min(az, bz),
      maxZ = Math.max(az, bz);
    this.collision.query(minX, minZ, maxX, maxZ, scratch);
    const dx = bx - ax,
      dz = bz - az;
    for (let i = 0; i < scratch.length && blockers < O.maxOcclusion; i++) {
      const b = scratch[i];
      if (!b.enabled || !b.solid) continue;
      if (b.tag !== 'wall' && b.tag !== 'opening') continue;
      if (b.y1 < 1.0 || b.y0 > 1.6) continue;
      if (b.ref && b.ref.blocksSound === false) continue;
      if (segmentHitsRect(ax, az, dx, dz, b)) blockers++;
    }
    return blockers === 0 ? 1 : Math.pow(O.occlusionMul, blockers);
  }

  // ───────────────────────────────────────────── safehouse compatibility ──

  /** The safehouse "board the door" beat is now an ordinary boarded opening. */
  buildBarricade() {
    const op = this.safehouse?.doorOpening;
    if (!op) return false;
    return op.board();
  }

  damageBarricade(n) {
    const op = this.safehouse?.doorOpening;
    if (!op) return false;
    return op.damage(n) !== null && op.state !== OpeningState.BOARDED;
  }

  breakBarricade() {
    const op = this.safehouse?.doorOpening;
    if (!op) return;
    if (op.state === OpeningState.BOARDED) {
      op.boardHp = 0;
      op.setState(OpeningState.CLOSED);
    }
  }

  /** Put every door and window back the way it was authored. */
  resetOpenings() {
    for (const op of this.openings) op.reset(op.initialState);
    this.nav.build(this.collision, 0.34);
    this._navDirty.length = 0;
  }

  // ────────────────────────────────────────────────────────────── query ──

  isInside(x, z) {
    for (const b of this.buildings) {
      const bb = b.bounds;
      if (x > bb.minX && x < bb.maxX && z > bb.minZ && z < bb.maxZ) return b;
    }
    return null;
  }

  isInSafehouse(x, z) {
    const s = this.safehouse?.bounds;
    if (!s) return false;
    return x > s.minX && x < s.maxX && z > s.minZ && z < s.maxZ;
  }

  /** Surface under a point, for footstep sounds. */
  surfaceAt(x, z) {
    const b = this.isInside(x, z);
    if (b) return b.name === 'store' || b.name === 'apartments' ? 'tile' : 'wood';
    if (Math.abs(x) < 6 || Math.abs(z) < 5.5) return 'concrete';
    if (Math.abs(x) < 9.4 || Math.abs(z) < 8.9) return 'concrete';
    return 'grass';
  }

  // ─────────────────────────────────────────────────────────────── tick ──

  update(dt, timeOfDay, playerPos) {
    this._t += dt;
    const night = timeOfDay.lightLevel < 0.42;

    for (let i = 0; i < this.openings.length; i++) this.openings[i].update(dt);
    this.flushNavDirty();

    // Roof cut-away when the player walks into a building.
    const inside = this.isInside(playerPos.x, playerPos.z);
    for (const b of this.buildings) {
      const want = b !== inside;
      if (b.roofGroup && b.roofGroup.visible !== want) b.roofGroup.visible = want;
    }

    // Interior fill: bright by day, barely there at night.
    const daylight = 0.12 + timeOfDay.lightLevel * 0.88;
    const fillTarget = inside ? 24 * daylight : 0;
    const ambTarget = inside ? 2.1 * daylight : 0;
    this.interiorFill.position.set(playerPos.x, playerPos.y + 2.3, playerPos.z);
    this.interiorFill.intensity += (fillTarget - this.interiorFill.intensity) * Math.min(1, dt * 4);
    this.interiorAmbient.intensity += (ambTarget - this.interiorAmbient.intensity) * Math.min(1, dt * 4);

    // Streetlamp glow
    const lampOn = night ? 1 : 0;
    for (const sl of this.streetlights) {
      const bulb = sl.userData.bulb;
      if (bulb) bulb.material = lampOn ? this.M.emissiveWarm : this.M.plasticWhite;
    }
    if (this.lampLights) {
      for (const pl of this.lampLights) {
        const t = lampOn * 62.0;
        pl.intensity += (t - pl.intensity) * Math.min(1, dt * 2);
      }
    }

    // Interior + flickering lights
    for (const f of this.flickerLights) {
      const on = f.always ? 1 : night ? 1 : 0;
      let v = f.base;
      if (f.stutter) {
        const n = Math.sin(this._t * f.speed) * Math.sin(this._t * f.speed * 2.7 + 1.3);
        v = f.base * (1 - f.amount * (n > 0.1 ? 0 : 1)) * (Math.random() < 0.02 ? 0.1 : 1);
      } else {
        v = f.base * (1 + Math.sin(this._t * f.speed) * f.amount * 0.5 + (Math.random() - 0.5) * f.amount * 0.5);
      }
      const target = on * Math.max(0, v);
      f.light.intensity += (target - f.light.intensity) * Math.min(1, dt * 12);
      if (f.mesh) {
        f.mesh.visible = on > 0.5;
        if (f.mesh.material.color) {
          const k = Math.min(1, f.light.intensity / Math.max(0.001, f.base));
          f.mesh.material.color.setScalar(0.25 + 0.75 * k);
        }
      }
    }

    // Emergency lightbars keep turning over — nobody switched them off.
    const phase = this._t * 3.4;
    for (const car of this.emergencyLights) {
      const lb = car.userData.lightbar;
      if (!lb) continue;
      const a = (Math.sin(phase) + 1) * 0.5;
      if (lb.red) lb.red.material.color.setRGB(0.35 + a * 0.9, 0.05, 0.03);
      if (lb.blue) lb.blue.material.color.setRGB(0.03, 0.08, 0.35 + (1 - a) * 0.9);
    }
  }
}
