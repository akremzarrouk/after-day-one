/**
 * Collision.js — the whole physics story of this prototype.
 *
 * Everything solid in the world is registered as an axis-aligned box with a
 * vertical span. Agents are vertical capsules approximated as circles on the
 * XZ plane, which is plenty for a game about walking around a neighbourhood.
 *
 *   - resolveCircle()  : push an agent out of geometry (with wall sliding)
 *   - groundHeightAt() : lets you stand on car roofs, kerbs, porches
 *   - lineBlocked()    : line-of-sight for zombie perception
 *
 * A uniform spatial hash keeps queries cheap enough that 40+ zombies plus the
 * player can all query every frame without thinking about it.
 */

const HASH_CELL = 4;

export class Box {
  constructor(minX, minZ, maxX, maxZ, y0, y1, opts = {}) {
    this.minX = minX;
    this.minZ = minZ;
    this.maxX = maxX;
    this.maxZ = maxZ;
    this.y0 = y0;
    this.y1 = y1;
    this.solid = opts.solid !== false;      // blocks movement
    this.opaque = opts.opaque !== false;    // blocks line of sight
    this.platform = opts.platform === true; // can be stood on
    this.tag = opts.tag || 'world';
    this.ref = opts.ref || null;            // back-pointer (e.g. a door object)
    this.enabled = true;
  }

  get cx() {
    return (this.minX + this.maxX) * 0.5;
  }
  get cz() {
    return (this.minZ + this.maxZ) * 0.5;
  }
}

export class CollisionWorld {
  constructor() {
    this.boxes = [];
    this.hash = new Map();
    this._queryToken = 0;
    this._tokens = [];
  }

  _key(cx, cz) {
    return cx * 73856093 ^ cz * 19349663;
  }

  add(box) {
    const i = this.boxes.length;
    this.boxes.push(box);
    this._tokens.push(-1);
    const x0 = Math.floor(box.minX / HASH_CELL);
    const x1 = Math.floor(box.maxX / HASH_CELL);
    const z0 = Math.floor(box.minZ / HASH_CELL);
    const z1 = Math.floor(box.maxZ / HASH_CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this._key(cx, cz);
        let arr = this.hash.get(k);
        if (!arr) this.hash.set(k, (arr = []));
        arr.push(i);
      }
    }
    return box;
  }

  addBox(minX, minZ, maxX, maxZ, y0, y1, opts) {
    return this.add(new Box(minX, minZ, maxX, maxZ, y0, y1, opts));
  }

  /** Convenience: a box from centre + size. */
  addCentered(cx, cz, sx, sz, y0, y1, opts) {
    return this.addBox(cx - sx / 2, cz - sz / 2, cx + sx / 2, cz + sz / 2, y0, y1, opts);
  }

  /** Gather indices of boxes overlapping an XZ rect, de-duplicated. */
  query(minX, minZ, maxX, maxZ, out) {
    out.length = 0;
    const token = ++this._queryToken;
    const x0 = Math.floor(minX / HASH_CELL);
    const x1 = Math.floor(maxX / HASH_CELL);
    const z0 = Math.floor(minZ / HASH_CELL);
    const z1 = Math.floor(maxZ / HASH_CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.hash.get(this._key(cx, cz));
        if (!arr) continue;
        for (let n = 0; n < arr.length; n++) {
          const i = arr[n];
          if (this._tokens[i] === token) continue;
          this._tokens[i] = token;
          out.push(this.boxes[i]);
        }
      }
    }
    return out;
  }

  /**
   * Push a circle at (x,z) with radius r out of all solid geometry whose
   * vertical span overlaps [feetY + stepUp, feetY + height].
   * Returns { x, z, hit, nx, nz }.
   */
  resolveCircle(x, z, r, feetY, height, stepUp = 0.42, scratch = []) {
    let hit = false;
    let nx = 0,
      nz = 0;
    const lo = feetY + stepUp;
    const hi = feetY + height;

    // Two relaxation passes handle inner corners without jitter.
    for (let pass = 0; pass < 2; pass++) {
      this.query(x - r - 0.6, z - r - 0.6, x + r + 0.6, z + r + 0.6, scratch);
      for (let i = 0; i < scratch.length; i++) {
        const b = scratch[i];
        if (!b.solid || !b.enabled) continue;
        if (b.y1 <= lo || b.y0 >= hi) continue;

        const cx = Math.max(b.minX, Math.min(x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
        let dx = x - cx;
        let dz = z - cz;
        let d2 = dx * dx + dz * dz;

        if (d2 > r * r) continue;

        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          const push = r - d;
          dx /= d;
          dz /= d;
          x += dx * push;
          z += dz * push;
          nx += dx;
          nz += dz;
        } else {
          // Centre is inside the box — eject along the shallowest axis.
          const dl = x - b.minX,
            dr = b.maxX - x;
          const db = z - b.minZ,
            dt = b.maxZ - z;
          const m = Math.min(dl, dr, db, dt);
          if (m === dl) {
            x = b.minX - r;
            nx -= 1;
          } else if (m === dr) {
            x = b.maxX + r;
            nx += 1;
          } else if (m === db) {
            z = b.minZ - r;
            nz -= 1;
          } else {
            z = b.maxZ + r;
            nz += 1;
          }
        }
        hit = true;
      }
      if (!hit) break;
    }

    const nl = Math.hypot(nx, nz);
    if (nl > 1e-6) {
      nx /= nl;
      nz /= nl;
    }
    return { x, z, hit, nx, nz };
  }

  /** Is a circle at this position overlapping solid geometry? */
  circleBlocked(x, z, r, feetY, height, stepUp = 0.42, scratch = []) {
    const lo = feetY + stepUp;
    const hi = feetY + height;
    this.query(x - r, z - r, x + r, z + r, scratch);
    for (let i = 0; i < scratch.length; i++) {
      const b = scratch[i];
      if (!b.solid || !b.enabled) continue;
      if (b.y1 <= lo || b.y0 >= hi) continue;
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const dx = x - cx,
        dz = z - cz;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  /**
   * Highest platform top under (x,z) that is at or below maxY.
   * Returns 0 (street level) when nothing else applies.
   */
  groundHeightAt(x, z, maxY, scratch = []) {
    let best = 0;
    this.query(x - 0.05, z - 0.05, x + 0.05, z + 0.05, scratch);
    for (let i = 0; i < scratch.length; i++) {
      const b = scratch[i];
      if (!b.enabled || !b.platform) continue;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (b.y1 <= maxY + 1e-3 && b.y1 > best) best = b.y1;
    }
    return best;
  }

  /**
   * Line-of-sight test on the XZ plane at a given height band.
   * Returns true if something opaque blocks the segment.
   */
  lineBlocked(ax, az, bx, bz, y = 1.2, scratch = [], ignoreRef = null) {
    const minX = Math.min(ax, bx),
      maxX = Math.max(ax, bx);
    const minZ = Math.min(az, bz),
      maxZ = Math.max(az, bz);
    this.query(minX, minZ, maxX, maxZ, scratch);

    const dx = bx - ax;
    const dz = bz - az;

    for (let i = 0; i < scratch.length; i++) {
      const b = scratch[i];
      if (!b.opaque || !b.enabled) continue;
      if (ignoreRef && b.ref === ignoreRef) continue;
      if (y < b.y0 || y > b.y1) continue;
      if (segmentHitsRect(ax, az, dx, dz, b)) return true;
    }
    return false;
  }

  /**
   * Closest opaque hit along a ray (used by the revolver).
   * Returns { t, box } or null. t is in [0,1] of the segment.
   */
  raycast(ax, az, bx, bz, y, scratch = []) {
    const minX = Math.min(ax, bx),
      maxX = Math.max(ax, bx);
    const minZ = Math.min(az, bz),
      maxZ = Math.max(az, bz);
    this.query(minX, minZ, maxX, maxZ, scratch);
    const dx = bx - ax,
      dz = bz - az;
    let bestT = Infinity,
      bestBox = null;
    for (let i = 0; i < scratch.length; i++) {
      const b = scratch[i];
      if (!b.opaque || !b.enabled) continue;
      if (y < b.y0 || y > b.y1) continue;
      const t = segmentRectEnterT(ax, az, dx, dz, b);
      if (t !== null && t < bestT) {
        bestT = t;
        bestBox = b;
      }
    }
    return bestBox ? { t: bestT, box: bestBox } : null;
  }

  /** Remove nothing, just disable — used when a barricade is destroyed. */
  setEnabled(box, on) {
    box.enabled = on;
  }
}

/** 2D slab test: does the segment origin+d intersect the box footprint? */
export function segmentHitsRect(ox, oz, dx, dz, b) {
  return segmentRectEnterT(ox, oz, dx, dz, b) !== null;
}

/** Entry parameter t in [0,1], or null. */
export function segmentRectEnterT(ox, oz, dx, dz, b) {
  let tmin = 0,
    tmax = 1;

  if (Math.abs(dx) < 1e-9) {
    if (ox < b.minX || ox > b.maxX) return null;
  } else {
    let t1 = (b.minX - ox) / dx;
    let t2 = (b.maxX - ox) / dx;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  if (Math.abs(dz) < 1e-9) {
    if (oz < b.minZ || oz > b.maxZ) return null;
  } else {
    let t1 = (b.minZ - oz) / dz;
    let t2 = (b.maxZ - oz) / dz;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  return tmin;
}
