/**
 * NavGrid.js — coarse 1m grid + A* so zombies path around houses and funnel
 * through doorways instead of grinding their faces into walls.
 *
 * Searches are budgeted and queued: at most a couple per frame across the
 * whole horde, each capped at a node budget. A zombie that fails to get a path
 * falls back to direct steering, which is fine over short distances.
 */

class MinHeap {
  constructor(cap = 4096) {
    this.ids = new Int32Array(cap);
    this.cost = new Float32Array(cap);
    this.size = 0;
  }
  clear() {
    this.size = 0;
  }
  _grow() {
    const ids = new Int32Array(this.ids.length * 2);
    const cost = new Float32Array(this.cost.length * 2);
    ids.set(this.ids);
    cost.set(this.cost);
    this.ids = ids;
    this.cost = cost;
  }
  push(id, c) {
    if (this.size >= this.ids.length) this._grow();
    let i = this.size++;
    this.ids[i] = id;
    this.cost[i] = c;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cost[p] <= this.cost[i]) break;
      this._swap(p, i);
      i = p;
    }
  }
  pop() {
    const top = this.ids[0];
    this.size--;
    if (this.size > 0) {
      this.ids[0] = this.ids[this.size];
      this.cost[0] = this.cost[this.size];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1,
          r = l + 1;
        let s = i;
        if (l < this.size && this.cost[l] < this.cost[s]) s = l;
        if (r < this.size && this.cost[r] < this.cost[s]) s = r;
        if (s === i) break;
        this._swap(s, i);
        i = s;
      }
    }
    return top;
  }
  _swap(a, b) {
    const i = this.ids[a];
    this.ids[a] = this.ids[b];
    this.ids[b] = i;
    const c = this.cost[a];
    this.cost[a] = this.cost[b];
    this.cost[b] = c;
  }
}

const SQRT2 = Math.SQRT2;

export class NavGrid {
  constructor(size, cell = 1.0) {
    this.cell = cell;
    this.half = size / 2;
    this.w = Math.ceil(size / cell);
    this.h = this.w;
    this.blocked = new Uint8Array(this.w * this.h);
    this.cost = new Float32Array(this.w * this.h).fill(1); // soft avoidance

    this.g = new Float32Array(this.w * this.h);
    this.from = new Int32Array(this.w * this.h);
    this.stamp = new Uint32Array(this.w * this.h);
    this.gen = 0;
    this.heap = new MinHeap();

    this.queue = [];
    this.searchesPerFrame = 3;
    this.maxQueue = 64;
    this.nodeBudget = 4200;

    // Fairness bookkeeping + counters the debug overlay reads.
    this.served = 0;
    this.searches = 0;
    this.dropped = 0;
    this.lastServed = 0;
  }

  idx(ix, iz) {
    return iz * this.w + ix;
  }
  toGridX(x) {
    return Math.floor((x + this.half) / this.cell);
  }
  toGridZ(z) {
    return Math.floor((z + this.half) / this.cell);
  }
  toWorldX(ix) {
    return ix * this.cell - this.half + this.cell * 0.5;
  }
  toWorldZ(iz) {
    return iz * this.cell - this.half + this.cell * 0.5;
  }
  inBounds(ix, iz) {
    return ix >= 0 && iz >= 0 && ix < this.w && iz < this.h;
  }
  isBlockedCell(ix, iz) {
    if (!this.inBounds(ix, iz)) return true;
    return this.blocked[this.idx(ix, iz)] === 1;
  }
  isBlockedWorld(x, z) {
    return this.isBlockedCell(this.toGridX(x), this.toGridZ(z));
  }

  /**
   * Rebuild the blocked mask from the collision world. Boxes are inflated by
   * the agent radius so paths keep clear of walls; the band 0.5..1.5m is what
   * a walking body actually occupies (so kerbs and low debris stay walkable).
   */
  build(collision, agentRadius = 0.36) {
    this.blocked.fill(0);
    const bandLo = 0.55,
      bandHi = 1.5;
    for (const b of collision.boxes) {
      if (!b.solid) continue;
      if (b.y1 <= bandLo || b.y0 >= bandHi) continue;
      const minX = b.minX - agentRadius;
      const maxX = b.maxX + agentRadius;
      const minZ = b.minZ - agentRadius;
      const maxZ = b.maxZ + agentRadius;
      const x0 = Math.max(0, this.toGridX(minX));
      const x1 = Math.min(this.w - 1, this.toGridX(maxX));
      const z0 = Math.max(0, this.toGridZ(minZ));
      const z1 = Math.min(this.h - 1, this.toGridZ(maxZ));
      for (let iz = z0; iz <= z1; iz++) {
        for (let ix = x0; ix <= x1; ix++) {
          // Cell centre inside the inflated rect → blocked.
          const wx = this.toWorldX(ix);
          const wz = this.toWorldZ(iz);
          if (wx >= minX && wx <= maxX && wz >= minZ && wz <= maxZ) {
            this.blocked[this.idx(ix, iz)] = 1;
          }
        }
      }
    }
  }

  /**
   * Re-rasterise one rectangle of the grid instead of all 22 500 cells.
   *
   * A door opening or closing changes about a dozen cells; rebuilding the
   * whole map for that costs milliseconds we do not have when three of them
   * give way at once. Only boxes that overlap the padded rect are considered,
   * and only cells inside it are written.
   *
   * The pad matters: a box just outside the rect still inflates into it by the
   * agent radius, so it has to be part of the query or we punch phantom holes
   * in walls at the seams.
   */
  rebuildRegion(collision, minX, minZ, maxX, maxZ, agentRadius = 0.36, scratch = []) {
    const pad = agentRadius + this.cell;
    const bandLo = 0.55;
    const bandHi = 1.5;

    const x0 = Math.max(0, this.toGridX(minX));
    const x1 = Math.min(this.w - 1, this.toGridX(maxX));
    const z0 = Math.max(0, this.toGridZ(minZ));
    const z1 = Math.min(this.h - 1, this.toGridZ(maxZ));
    if (x1 < x0 || z1 < z0) return 0;

    for (let iz = z0; iz <= z1; iz++) {
      const row = iz * this.w;
      for (let ix = x0; ix <= x1; ix++) this.blocked[row + ix] = 0;
    }

    collision.query(minX - pad, minZ - pad, maxX + pad, maxZ + pad, scratch);
    for (let n = 0; n < scratch.length; n++) {
      const b = scratch[n];
      if (!b.solid || !b.enabled) continue;
      if (b.y1 <= bandLo || b.y0 >= bandHi) continue;
      const bminX = b.minX - agentRadius;
      const bmaxX = b.maxX + agentRadius;
      const bminZ = b.minZ - agentRadius;
      const bmaxZ = b.maxZ + agentRadius;
      const bx0 = Math.max(x0, this.toGridX(bminX));
      const bx1 = Math.min(x1, this.toGridX(bmaxX));
      const bz0 = Math.max(z0, this.toGridZ(bminZ));
      const bz1 = Math.min(z1, this.toGridZ(bmaxZ));
      for (let iz = bz0; iz <= bz1; iz++) {
        const wz = this.toWorldZ(iz);
        if (wz < bminZ || wz > bmaxZ) continue;
        const row = iz * this.w;
        for (let ix = bx0; ix <= bx1; ix++) {
          const wx = this.toWorldX(ix);
          if (wx >= bminX && wx <= bmaxX) this.blocked[row + ix] = 1;
        }
      }
    }
    return (x1 - x0 + 1) * (z1 - z0 + 1);
  }

  /** Nearest walkable cell to a world point, spiralling outward. */
  nearestFree(x, z, maxRings = 8) {
    let ix = this.toGridX(x),
      iz = this.toGridZ(z);
    if (!this.isBlockedCell(ix, iz)) return { ix, iz };
    for (let r = 1; r <= maxRings; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = ix + dx,
            nz = iz + dz;
          if (!this.isBlockedCell(nx, nz)) return { ix: nx, iz: nz };
        }
      }
    }
    return null;
  }

  /** Bresenham walkability test, used for string-pulling. */
  losClear(ix0, iz0, ix1, iz1) {
    let dx = Math.abs(ix1 - ix0),
      dz = Math.abs(iz1 - iz0);
    let x = ix0,
      z = iz0;
    const sx = ix0 < ix1 ? 1 : -1;
    const sz = iz0 < iz1 ? 1 : -1;
    let err = dx - dz;
    let guard = dx + dz + 2;
    while (guard-- > 0) {
      if (this.isBlockedCell(x, z)) return false;
      if (x === ix1 && z === iz1) return true;
      const e2 = 2 * err;
      if (e2 > -dz) {
        err -= dz;
        x += sx;
        // Diagonal steps must not clip a corner.
        if (e2 < dx && this.isBlockedCell(x, z)) return false;
      }
      if (e2 < dx) {
        err += dx;
        z += sz;
      }
    }
    return false;
  }

  /**
   * A* between world points. Returns an array of {x,z} waypoints (smoothed),
   * or null if unreachable within budget.
   */
  findPath(sx, sz, tx, tz) {
    const s = this.nearestFree(sx, sz);
    const t = this.nearestFree(tx, tz);
    if (!s || !t) return null;

    const startI = this.idx(s.ix, s.iz);
    const goalI = this.idx(t.ix, t.iz);
    if (startI === goalI) return [{ x: tx, z: tz }];

    const gen = ++this.gen;
    const { g, from, stamp, heap, w, h } = this;
    heap.clear();

    g[startI] = 0;
    from[startI] = -1;
    stamp[startI] = gen;
    heap.push(startI, 0);

    const gx = t.ix,
      gz = t.iz;
    let expanded = 0;
    let found = false;

    const closed = new Set();

    while (heap.size > 0) {
      const cur = heap.pop();
      if (closed.has(cur)) continue;
      closed.add(cur);
      if (cur === goalI) {
        found = true;
        break;
      }
      if (++expanded > this.nodeBudget) break;

      const cx = cur % w;
      const cz = (cur / w) | 0;
      const cg = g[cur];

      for (let d = 0; d < 8; d++) {
        const dx = DIRS[d][0],
          dz = DIRS[d][1];
        const nx = cx + dx,
          nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
        const ni = nz * w + nx;
        if (this.blocked[ni]) continue;
        if (dx !== 0 && dz !== 0) {
          // no corner cutting
          if (this.blocked[cz * w + nx] || this.blocked[nz * w + cx]) continue;
        }
        const step = dx !== 0 && dz !== 0 ? SQRT2 : 1;
        const ng = cg + step * this.cost[ni];
        if (stamp[ni] === gen && ng >= g[ni]) continue;
        stamp[ni] = gen;
        g[ni] = ng;
        from[ni] = cur;
        const hx = Math.abs(gx - nx),
          hz = Math.abs(gz - nz);
        const hcost = (hx + hz) + (SQRT2 - 2) * Math.min(hx, hz);
        heap.push(ni, ng + hcost * 1.05);
      }
    }

    if (!found) return null;

    // Walk back, then string-pull.
    const raw = [];
    let cur = goalI;
    let guard = 0;
    while (cur !== -1 && guard++ < 8000) {
      raw.push(cur);
      if (cur === startI) break;
      cur = from[cur];
    }
    raw.reverse();

    const pts = [];
    let anchor = 0;
    for (let i = 1; i < raw.length; i++) {
      const ax = raw[anchor] % w,
        az = (raw[anchor] / w) | 0;
      const nxi = raw[i + 1] !== undefined ? raw[i + 1] : -1;
      if (nxi === -1) break;
      const bx = nxi % w,
        bz = (nxi / w) | 0;
      if (!this.losClear(ax, az, bx, bz)) {
        anchor = i;
        pts.push({ x: this.toWorldX(raw[i] % w), z: this.toWorldZ((raw[i] / w) | 0) });
      }
    }
    pts.push({ x: tx, z: tz });
    return pts;
  }

  /**
   * Queue a path request; resolved over the following frames.
   *
   * The queue is capped, and *what gets dropped when it is full matters*.
   * Dropping the head — the original behaviour — evicts whoever has waited
   * longest, so under load the same unlucky zombies are starved every frame
   * and stand grinding into a wall forever while the noisy ones get served
   * repeatedly. Instead the request from the most recently served owner is
   * dropped: everyone gets a turn, and nobody is permanently locked out.
   */
  request(owner, sx, sz, tx, tz, cb) {
    // Replace any pending request from the same owner.
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].owner === owner) {
        this.queue.splice(i, 1);
        break;
      }
    }
    this.queue.push({ owner, sx, sz, tx, tz, cb });

    if (this.queue.length > this.maxQueue) {
      let worst = 0;
      let worstServed = -Infinity;
      for (let i = 0; i < this.queue.length; i++) {
        const served = this.queue[i].owner?._navServed ?? -1;
        if (served > worstServed) {
          worstServed = served;
          worst = i;
        }
      }
      this.queue.splice(worst, 1);
      this.dropped++;
    }
  }

  update() {
    let n = 0;
    while (this.queue.length && n < this.searchesPerFrame) {
      // Serve whoever has gone longest without a path, not whoever asked
      // first — a zombie that re-requests every 0.65 s must not be able to
      // keep jumping ahead of one that has been waiting since it got stuck.
      let pick = 0;
      let oldest = Infinity;
      for (let i = 0; i < this.queue.length; i++) {
        const served = this.queue[i].owner?._navServed ?? -1;
        if (served < oldest) {
          oldest = served;
          pick = i;
        }
      }
      const req = this.queue.splice(pick, 1)[0];
      n++;
      if (req.owner) req.owner._navServed = ++this.served;

      let path = null;
      try {
        path = this.findPath(req.sx, req.sz, req.tx, req.tz);
      } catch (e) {
        path = null;
      }
      this.searches++;
      req.cb(path);
    }
    this.lastServed = n;
  }
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
