/**
 * Combat.js — turns a swing into consequences.
 *
 * Melee is an arc test rather than a hitbox sweep: cheap, forgiving in the
 * right way, and easy to tune. The important part is what happens *around* the
 * hit — where on the body it landed, knockback, stagger, blood, a very loud
 * noise event that the rest of the street can hear.
 *
 * Nothing here books anything to the inventory. A swing reports how many
 * bodies and how much scenery it found; `Game` decides what that did to the
 * weapon, because `Game` is the only thing that owns both.
 */

import CFG from '../core/Config.js';
import { angleDelta, clamp } from '../core/Utils.js';

/**
 * Which band a melee swing is aimed at.
 *
 * The camera pitch is the input, because it is the one thing already in your
 * hand every frame: level is the body, look up and you go for the head, look
 * down and you go for the knees. No mode, no extra key, and it reads on screen
 * before the swing lands.
 */
export function meleeZone(pitch = 0, target = null) {
  const C = CFG.combat;
  // Anything already on the floor inverts the question — its head is down
  // there with its legs, so the deliberate act is looking *down* at it.
  if (target && (target.crawling || target.downed)) {
    return pitch < -0.06 ? 'head' : 'body';
  }
  if (pitch > C.zonePitchHigh) return 'head';
  if (pitch < C.zonePitchLow) return 'legs';
  return 'body';
}

export class Combat {
  constructor(world, horde, audio, particles, noise, cameraRig, decals) {
    this.world = world;
    this.horde = horde;
    this.audio = audio;
    this.particles = particles;
    this.noise = noise;
    this.cam = cameraRig;
    this.decals = decals || null;
    this._buf = [];
    this._buf2 = [];
    this.hits = 0;
    this.misses = 0;

    /** Set by Game: fired once per kill, for the micro-slow and the stats. */
    this.onKill = null;
  }

  // ────────────────────────────────────────────────────────────── melee ──

  /**
   * Player melee swing.
   *
   * @param opts.pitch      camera pitch, which decides the hit zone
   * @param opts.damageMul  weapon condition multiplier
   * @returns { hits, kills, clang }
   */
  resolveSwing(player, weapon, opts = {}) {
    const pitch = opts.pitch || 0;
    const condMul = opts.damageMul ?? 1;
    const reach = weapon.range + 0.4;
    const list = this.horde.query(player.pos.x, player.pos.z, reach + 0.8, this._buf);
    const halfArc = (weapon.arc * Math.PI) / 360;

    const fx = Math.sin(player.yaw);
    const fz = Math.cos(player.yaw);

    const candidates = [];
    for (const z of list) {
      if (z.isDead) continue;
      const dx = z.pos.x - player.pos.x;
      const dz = z.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > reach + z.radius) continue;
      const dot = (fx * dx + fz * dz) / (d || 1);
      const ang = Math.acos(clamp(dot, -1, 1));
      // Very close targets count regardless of arc — you can't miss a face.
      if (ang > halfArc && d > 1.0) continue;
      if (this.world.collision.lineBlocked(player.pos.x, player.pos.z, z.pos.x, z.pos.z, 1.2, this._buf2)) continue;
      candidates.push({ z, d, ang });
    }

    if (candidates.length === 0) {
      this.misses++;
      // Did we at least hit the scenery? Little puff of dust sells the swing —
      // and steel into brick is harder on the weapon than steel into a skull.
      const px = player.pos.x + fx * weapon.range * 0.8;
      const pz = player.pos.z + fz * weapon.range * 0.8;
      if (this.world.collision.circleBlocked(px, pz, 0.3, player.pos.y, 1.6, 0.45, this._buf)) {
        this.particles.dust(px, player.pos.y + 1.1, pz, 7, 0.5);
        this.audio.impact('hit_metal', px, pz);
        this.cam.addShake(0.16);
        this.noise.emit(px, pz, CFG.noise.meleeHit * 0.6, 'player', 'clang');
        return { hits: 0, kills: 0, clang: true };
      }
      return { hits: 0, kills: 0, clang: false };
    }

    candidates.sort((a, b) => a.ang - b.ang || a.d - b.d);
    const maxTargets = weapon.arc >= 90 ? 3 : weapon.arc >= 70 ? 2 : 1;
    let hitCount = 0;
    let kills = 0;

    for (let i = 0; i < candidates.length && hitCount < maxTargets; i++) {
      const { z } = candidates[i];
      let dmg = weapon.damage * condMul;

      // Hitting one behind the first costs you power.
      if (hitCount > 0) dmg *= 0.62;

      // Attacking a zombie that hasn't noticed you is a genuinely good idea.
      const facingAway = Math.cos(angleDelta(z.yaw, Math.atan2(player.pos.x - z.pos.x, player.pos.z - z.pos.z))) < -0.1;
      const unaware = z.awareness < 0.5;
      if (facingAway && unaware) dmg *= CFG.combat.backstabMul;

      dmg *= 0.9 + Math.random() * 0.25;

      const zone = meleeZone(pitch, z);
      const killed = z.takeDamage(dmg, player.pos.x, player.pos.z, {
        knockback: weapon.knockback,
        stagger: weapon.stagger,
        heavy: weapon.damage > 30,
        knockdown: !!weapon.knockdown,
        bleed: weapon.bleed || 0,
        zone,
      });

      this.audio.impact(zone === 'head' ? 'hit_chop' : weapon.hitSound, z.pos.x, z.pos.z);
      if (zone === 'head') this.cam.addShake(0.14);
      hitCount++;
      if (killed) {
        kills++;
        this.onKillFeedback(z);
      }
    }

    this.hits += hitCount;
    this.cam.addShake(0.12 + weapon.damage * 0.004);
    player.hitStop = CFG.combat.playerHitStop;
    this.noise.emit(player.pos.x, player.pos.z, CFG.noise.meleeHit, 'player', 'hit');
    return { hits: hitCount, kills, clang: false };
  }

  onKillFeedback(z) {
    this.cam.addShake(0.2);
    this.particles.blood(z.pos.x, z.pos.y + 1.0, z.pos.z, 0, 0, 18, 1.3);
    this.decals?.splat(z.pos.x, z.pos.z, 1.5 + Math.random() * 0.7);
    this.onKill?.(z);
  }

  // ──────────────────────────────────────────────────── mobility verbs ──

  /**
   * Shove. Costs stamina, deals nothing, and buys a metre and a half — which
   * mid-windup is worth considerably more than a metre and a half of damage.
   *
   * Only ever one target: it is a panic button for the thing in your face, not
   * a crowd-clear with a different name.
   *
   * @returns { hit, interrupted }
   */
  resolveShove(player) {
    const C = CFG.combat;
    const fx = Math.sin(player.yaw);
    const fz = Math.cos(player.yaw);
    const list = this.horde.query(player.pos.x, player.pos.z, C.shoveRange + 0.9, this._buf);
    const halfArc = (C.shoveArcDeg * Math.PI) / 360;

    let best = null;
    let bestAng = Infinity;
    for (const z of list) {
      if (z.isDead || z.downed) continue;
      const dx = z.pos.x - player.pos.x;
      const dz = z.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > C.shoveRange + z.radius) continue;
      const ang = Math.acos(clamp((fx * dx + fz * dz) / (d || 1), -1, 1));
      if (ang > halfArc) continue;
      if (ang < bestAng) {
        bestAng = ang;
        best = { z, dx, dz, d };
      }
    }

    this.audio.swing('whoosh_light');
    this.noise.emit(player.pos.x, player.pos.z, C.shoveNoise, 'player', 'shove');

    if (!best) return { hit: false, interrupted: false };

    const d = best.d || 1;
    const interrupted = best.z.shove(best.dx / d, best.dz / d);
    this.audio.impact('hit_soft', best.z.pos.x, best.z.pos.z);
    this.cam.addShake(0.18);
    player.hitStop = 0.035;
    return { hit: true, interrupted, target: best.z };
  }

  /**
   * The stomp. No arc, no roll, no zone — it is already on the floor. What it
   * costs is the second you spent not looking at anything else.
   */
  resolveFinisher(player, z) {
    if (!z || z.isDead) return false;
    z.die(Math.sin(player.yaw), Math.cos(player.yaw));
    this.particles.blood(z.pos.x, z.pos.y + 0.3, z.pos.z, 0, 0, 30, 1.7);
    this.decals?.splat(z.pos.x, z.pos.z, 2.1 + Math.random() * 0.6);
    this.audio.impact('hit_chop', z.pos.x, z.pos.z);
    this.audio.impact('hit_blunt', z.pos.x, z.pos.z);
    this.cam.addShake(0.62);
    player.hitStop = 0.1;
    this.noise.emit(player.pos.x, player.pos.z, CFG.combat.finisherNoise, 'player', 'stomp');
    this.onKill?.(z);
    return true;
  }

  // ───────────────────────────────────────────────────────────── ranged ──

  /**
   * Revolver. Hitscan, extremely loud, and it will be heard.
   *
   * Unlike melee the zone is not a guess from the pitch — the bullet has a
   * real height, traced from the muzzle along the aim, and whichever band of
   * the target it arrives at is the band it hits. Aim high and miss entirely.
   */
  resolveShot(player, weapon, opts = {}) {
    if (player.chamber <= 0) return 0;
    player.chamber--;

    const pitch = opts.pitch || 0;
    const yaw = player.yaw + (opts.swayYaw || 0);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const ox = player.pos.x + fx * 0.5;
    const oz = player.pos.z + fz * 0.5;
    const oy = player.pos.y + (player.crouching ? 1.12 : 1.42);
    const slope = Math.tan(clamp(pitch + (opts.swayPitch || 0), -1.2, 1.2));

    this.audio.gunshot();
    this.particles.muzzle(ox + fx * 0.4, oy, oz + fz * 0.4, fx, fz);
    this.cam.addShake(0.65);
    player.hitStop = 0.06;

    this.noise.emit(player.pos.x, player.pos.z, CFG.noise.gunshot, 'player', 'gunshot');
    this.horde.onGunshot(player.pos.x, player.pos.z);

    // Wall the bullet would hit
    const wall = this.world.collision.raycast(
      ox,
      oz,
      ox + fx * weapon.range,
      oz + fz * weapon.range,
      1.35,
      this._buf
    );
    const maxT = wall ? wall.t : 1;

    // Nearest zombie along the ray
    const list = this.horde.query(player.pos.x, player.pos.z, weapon.range, this._buf);
    let best = null;
    let bestT = Infinity;
    let bestZone = 'body';
    for (const z of list) {
      const dx = z.pos.x - ox;
      const dz = z.pos.z - oz;
      const along = dx * fx + dz * fz;
      if (along < 0.3) continue;
      const t = along / weapon.range;
      if (t > maxT) continue;
      const lateral = Math.abs(dx * fz - dz * fx);
      if (lateral > z.radius + 0.28) continue;

      // Where the bullet actually is, vertically, when it gets there.
      const bulletY = oy + slope * along;
      const footY = z.pos.y;
      const top = footY + z.standHeight;
      const zone = shotZone(bulletY, footY, top, z);
      if (!zone) continue;                 // over its head or into the road

      if (t < bestT) {
        bestT = t;
        best = z;
        bestZone = zone;
      }
    }

    if (best) {
      const killed = best.takeDamage(weapon.damage, player.pos.x, player.pos.z, {
        knockback: 3.2,
        stagger: bestZone === 'head' ? 1.1 : 0.85,
        heavy: true,
        zone: bestZone,
      });
      this.audio.impact(bestZone === 'head' ? 'hit_chop' : 'hit_soft', best.pos.x, best.pos.z);
      if (killed) this.onKillFeedback(best);
      return { hits: 1, zone: bestZone, killed };
    }

    if (wall) {
      const hx = ox + fx * weapon.range * wall.t;
      const hz = oz + fz * weapon.range * wall.t;
      this.particles.sparks(hx, 1.35, hz, 8);
      this.particles.dust(hx, 1.3, hz, 6, 0.6);
    }
    return { hits: 0, zone: null, killed: false };
  }
}

/**
 * Which band of a body a bullet at height `y` arrives at, or null for a miss.
 * A shot that clears the head by a hand's width still counts — a hitscan with
 * no forgiveness at all reads as the game cheating rather than as you missing.
 */
function shotZone(y, footY, topY, z) {
  const h = Math.max(0.4, topY - footY);
  const rel = (y - footY) / h;
  if (rel > 1.14) return null;
  if (rel < -0.06) return null;
  // A crawler is all head and shoulders; there are no legs left to aim at.
  if (z.crawling || z.downed) return rel > 0.55 ? 'head' : 'body';
  if (rel > 0.82) return 'head';
  if (rel > 0.46) return 'body';
  return 'legs';
}
