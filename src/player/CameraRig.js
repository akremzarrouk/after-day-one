/**
 * CameraRig.js — over-the-shoulder third-person camera.
 *
 * Orbits the player, pulls in when geometry gets between you and the world
 * (so interiors work), widens when you sprint, and shakes when things hit you.
 */

import * as THREE from 'three';
import CFG from '../core/Config.js';
import { clamp, damp, lerp } from '../core/Utils.js';

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.yaw = Math.PI;
    this.pitch = -0.12;
    this.distance = CFG.camera.distance;
    this.currentDistance = CFG.camera.distance;
    this.shoulder = CFG.camera.shoulder;
    this.height = CFG.camera.height;

    this.shake = 0;
    this.shakeTime = 0;
    this.fov = CFG.camera.fov;
    this.aiming = false;

    // Directional punch: which way the last hit came from, and how hard.
    this.kickX = 0;
    this.kickZ = 0;

    this._target = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._smoothTarget = new THREE.Vector3();
    this._scratch = [];
    this._initialised = false;
  }

  addShake(amount) {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  /**
   * Shove the camera away from whatever just landed on you.
   *
   * Undirected shake tells you that something happened; a kick tells you where
   * it came from, which is information you can act on — and in a game with two
   * attackers at a time, knowing which shoulder to turn to is the difference
   * between blocking and not.
   *
   * @param dirX,dirZ  unit vector pointing away from the source
   */
  addKick(dirX, dirZ, amount = 1) {
    const k = Math.min(1.6, amount) * CFG.combat.damageKick;
    this.kickX += dirX * k;
    this.kickZ += dirZ * k;
  }

  handleMouse(input) {
    const d = input.consumeMouseDelta();
    const s = CFG.camera.sensitivity * (this.aiming ? 0.6 : 1);
    this.yaw -= d.dx * s;
    this.pitch -= d.dy * s;
    this.pitch = clamp(this.pitch, CFG.camera.pitchMin, CFG.camera.pitchMax);
    if (input.mouse.wheel) {
      this.distance = clamp(this.distance + input.mouse.wheel * 0.4, 1.8, 6.0);
    }
  }

  update(dt, player, opts = {}) {
    const C = CFG.camera;
    this.aiming = !!opts.aiming;

    /**
     * Hidden: the camera climbs into the wardrobe with you and looks out
     * through the gap. You can pan across the opening but not turn round, so
     * the fear of hiding — that you can only watch one direction — is real.
     */
    if (player.hidden) {
      const s = player.hidden;
      const outYaw = s.faceYaw ?? Math.atan2((s.exitX ?? s.x) - s.x, (s.exitZ ?? s.z) - s.z);
      const limit = 0.85;
      let rel = this.yaw - outYaw;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      this.yaw = outYaw + clamp(rel, -limit, limit);
      this.pitch = clamp(this.pitch, -0.5, 0.35);

      const cp = Math.cos(this.pitch);
      const hy = player.pos.y + 1.16;
      // Sit in the gap of the door, not against the back panel — far enough
      // out to see the room, close enough that the frame still crowds you.
      this._desired.set(
        s.x + Math.sin(outYaw) * CFG.stealth.peekOffset,
        hy,
        s.z + Math.cos(outYaw) * CFG.stealth.peekOffset
      );
      this.camera.position.copy(this._desired);
      this._smoothTarget.set(
        this._desired.x + Math.sin(this.yaw) * cp * 4,
        hy + Math.sin(this.pitch) * 4,
        this._desired.z + Math.cos(this.yaw) * cp * 4
      );
      this.camera.lookAt(this._smoothTarget);
      this.currentDistance = 0;
      this._initialised = false;         // re-anchor cleanly when we climb out
      const hideFov = C.fov - 8;
      this.fov = damp(this.fov, hideFov, 6, dt);
      if (Math.abs(this.camera.fov - this.fov) > 0.01) {
        this.camera.fov = this.fov;
        this.camera.updateProjectionMatrix();
      }
      return;
    }

    // Where the camera is actually looking at: chest height, offset to the side
    const rightX = -Math.cos(this.yaw);
    const rightZ = Math.sin(this.yaw);
    const shoulder = this.aiming ? C.aimShoulder : this.shoulder;

    // Crouching drops the whole framing, so cover actually covers you.
    const wantHeight = C.height - (player.crouching ? CFG.stealth.crouchCameraDrop : 0);
    this.height = damp(this.height, wantHeight, 8, dt);

    this._target.set(
      player.pos.x + rightX * shoulder,
      player.pos.y + this.height + (player.state === 'dead' ? -0.5 : 0),
      player.pos.z + rightZ * shoulder
    );

    if (!this._initialised) {
      this._smoothTarget.copy(this._target);
      this._initialised = true;
    } else {
      const lam = C.smoothing * (player.sprinting ? 0.75 : 1);
      this._smoothTarget.x = damp(this._smoothTarget.x, this._target.x, lam, dt);
      this._smoothTarget.y = damp(this._smoothTarget.y, this._target.y, lam * 0.8, dt);
      this._smoothTarget.z = damp(this._smoothTarget.z, this._target.z, lam, dt);
    }

    // Look direction from yaw/pitch
    const cp = Math.cos(this.pitch);
    const dirX = Math.sin(this.yaw) * cp;
    const dirY = Math.sin(this.pitch);
    const dirZ = Math.cos(this.yaw) * cp;

    let want = this.aiming ? C.aimDistance : this.distance;

    // Pull the camera in if something opaque is in the way.
    const camY = this._smoothTarget.y + Math.max(0, -dirY) * 0.4;
    const hit = this.world.collision.raycast(
      this._smoothTarget.x,
      this._smoothTarget.z,
      this._smoothTarget.x - dirX * want,
      this._smoothTarget.z - dirZ * want,
      clamp(camY - dirY * want, 0.2, 6),
      this._scratch
    );
    if (hit) {
      want = Math.max(C.minDistance, hit.t * want - 0.34);
    }

    // Snap in fast, ease out slow — avoids the camera lurching in doorways.
    if (want < this.currentDistance) this.currentDistance = want;
    else this.currentDistance = damp(this.currentDistance, want, 5.5, dt);

    this._desired.set(
      this._smoothTarget.x - dirX * this.currentDistance,
      this._smoothTarget.y - dirY * this.currentDistance,
      this._smoothTarget.z - dirZ * this.currentDistance
    );

    // Never let the camera go under the street.
    const floor = this.world.collision.groundHeightAt(this._desired.x, this._desired.z, 8, this._scratch);
    if (this._desired.y < floor + 0.35) this._desired.y = floor + 0.35;

    // Damage kick — a directional lurch that springs back over ~0.3 s.
    if (Math.abs(this.kickX) + Math.abs(this.kickZ) > 0.001) {
      this._desired.x += this.kickX;
      this._desired.z += this.kickZ;
      this._smoothTarget.x += this.kickX * 0.45;
      this._smoothTarget.z += this.kickZ * 0.45;
      const decay = Math.exp(-9 * dt);
      this.kickX *= decay;
      this.kickZ *= decay;
    }

    // Shake
    if (this.shake > 0.001) {
      this.shakeTime += dt * 42;
      const s = this.shake * this.shake * 0.28;
      this._desired.x += Math.sin(this.shakeTime * 1.7) * s;
      this._desired.y += Math.sin(this.shakeTime * 2.3 + 1.1) * s;
      this._desired.z += Math.cos(this.shakeTime * 1.9) * s;
      this.shake = Math.max(0, this.shake - dt * 2.6);
    }

    this.camera.position.copy(this._desired);
    this.camera.lookAt(this._smoothTarget);

    if (this.shake > 0.001) this.camera.rotation.z += Math.sin(this.shakeTime * 3.1) * this.shake * 0.02;

    // FOV: subtle speed cue
    const targetFov = this.aiming ? C.fov - 12 : lerp(C.fov, C.sprintFov, clamp(player.speed / CFG.player.sprintSpeed, 0, 1) ** 2);
    this.fov = damp(this.fov, targetFov, 6, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
