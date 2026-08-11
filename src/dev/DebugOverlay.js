/**
 * DebugOverlay.js — what the AI is actually thinking, drawn on top of it.
 *
 * Dev-only, loaded with `?debug` (and always available under `?headless`), and
 * toggled with F3. A 2D canvas over the scene rather than in-world gizmos: it
 * costs one projection per zombie, it never touches the render path, and it
 * cannot leak into a production build because nothing imports it.
 *
 * The point of it is the two things you cannot see from the game itself — what
 * state each body is in, and what mood the director is in — because both of
 * those are the actual subject of this pass.
 */

import * as THREE from 'three';
import CFG from '../core/Config.js';
import { Phase } from '../entities/Horde.js';

/** One colour per state. Chosen so the busy ones are hot and idle is grey. */
const STATE_COLOR = {
  idle: '#6b7280',
  wander: '#8b9467',
  linger: '#7c6f9b',
  investigate: '#d7a13b',
  search: '#c98b2e',
  chase: '#d4552e',
  attack: '#ff3b1f',
  lunge: '#ff7a3d',
  scream: '#e94fd0',
  siege: '#b8763a',
  climb: '#9a6bd6',
  stagger: '#7fb2d9',
  down: '#4a5568',
  flee: '#39c2a0',
  dead: '#2b2b2b',
};

/** Specials get a letter so you can read a crowd at a glance. */
const SPECIAL_TAG = { screamer: 'S', runner: 'R', brute: 'B' };

const PHASE_COLOR = {
  [Phase.BUILD]: '#8b9467',
  [Phase.PEAK]: '#d4552e',
  [Phase.RELAX]: '#4f8fb5',
};

export class DebugOverlay {
  constructor(game) {
    this.game = game;
    this.on = false;
    this.detail = true;

    const c = document.createElement('canvas');
    c.id = 'debug-overlay';
    Object.assign(c.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '40',
      display: 'none',
    });
    document.getElementById('app').appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext('2d');

    this._v = new THREE.Vector3();
    this._pressureHistory = new Float32Array(180);
    this._historyHead = 0;
    this._sampleAcc = 0;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  toggle(on = !this.on) {
    this.on = on;
    this.canvas.style.display = on ? 'block' : 'none';
    return this.on;
  }

  /**
   * Called every frame from the game loop. Cheap when off — one boolean — and
   * when on it is one `project` per zombie plus a couple of hundred fills.
   */
  update(dt) {
    // The pressure graph keeps sampling while hidden, so opening the overlay
    // shows you the last thirty seconds instead of a blank strip.
    this._sampleAcc += dt;
    if (this._sampleAcc >= 1 / 6) {
      this._sampleAcc = 0;
      const h = this.game.horde;
      this._pressureHistory[this._historyHead] = h ? h.pressure : 0;
      this._historyHead = (this._historyHead + 1) % this._pressureHistory.length;
    }
    if (!this.on) return;

    const g = this.ctx;
    g.clearRect(0, 0, window.innerWidth, window.innerHeight);
    this._drawZombies();
    this._drawDirector();
    this._drawLegend();
  }

  // ───────────────────────────────────────────────────────────── bodies ──

  _drawZombies() {
    const game = this.game;
    const g = this.ctx;
    const cam = game.camera;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const px = game.player.pos;

    g.textAlign = 'center';
    g.font = '600 10px ui-monospace, monospace';

    for (const z of game.horde.zombies) {
      const d = Math.hypot(z.pos.x - px.x, z.pos.z - px.z);
      if (d > 70) continue;

      this._v.set(z.pos.x, z.pos.y + z.standHeight + 0.34, z.pos.z);
      this._v.project(cam);
      if (this._v.z > 1) continue;                    // behind the camera
      const sx = (this._v.x * 0.5 + 0.5) * W;
      const sy = (-this._v.y * 0.5 + 0.5) * H;
      if (sx < -40 || sx > W + 40 || sy < -20 || sy > H + 20) continue;

      const col = STATE_COLOR[z.state] || '#fff';
      const near = d < CFG.zombie.lodDistance;

      // State dot. Hollow when the body is running on reduced-rate perception,
      // so the LOD boundary is something you can literally see.
      g.beginPath();
      g.arc(sx, sy, 4.5, 0, Math.PI * 2);
      if (near) {
        g.fillStyle = col;
        g.fill();
      } else {
        g.strokeStyle = col;
        g.lineWidth = 1.6;
        g.stroke();
      }

      if (!this.detail || d > 45) continue;

      // Awareness bar.
      const w = 26;
      const a = Math.min(1, z.awareness);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(sx - w / 2, sy + 7, w, 3);
      g.fillStyle = a >= 1 ? '#ff3b1f' : a > 0.45 ? '#d7a13b' : '#6b7280';
      g.fillRect(sx - w / 2, sy + 7, w * a, 3);

      // Health, only once it matters.
      const hpf = z.hp / z.maxHp;
      if (hpf < 0.999) {
        g.fillStyle = 'rgba(0,0,0,0.55)';
        g.fillRect(sx - w / 2, sy + 11, w, 2);
        g.fillStyle = '#8b3a2e';
        g.fillRect(sx - w / 2, sy + 11, w * Math.max(0, hpf), 2);
      }

      // Special tag + anything worth shouting about.
      const tags = [];
      if (SPECIAL_TAG[z.type]) tags.push(SPECIAL_TAG[z.type]);
      if (z.crawling) tags.push('crawl');
      if (z.migrateTo) tags.push('mig');
      if (z.siegeTarget) tags.push('q' + z.siegeSlot);
      if (z.state === 'scream') {
        tags.push((CFG.specials.screamer.telegraph - z.screamTimer).toFixed(1));
      }
      if (tags.length) {
        g.fillStyle = col;
        g.fillText(tags.join(' '), sx, sy - 8);
      }

      // Where it thinks you are.
      if (z.lastKnown && (z.state === 'investigate' || z.state === 'search')) {
        this._v.set(z.lastKnown.x, 0.2, z.lastKnown.z);
        this._v.project(cam);
        if (this._v.z < 1) {
          const lx = (this._v.x * 0.5 + 0.5) * W;
          const ly = (-this._v.y * 0.5 + 0.5) * H;
          g.strokeStyle = 'rgba(215,161,59,0.28)';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(sx, sy);
          g.lineTo(lx, ly);
          g.stroke();
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────── director ──

  _drawDirector() {
    const g = this.ctx;
    const h = this.game.horde;
    const D = CFG.director;
    const x = 16;
    const y = 16;
    const w = 260;

    g.fillStyle = 'rgba(8,9,11,0.78)';
    g.fillRect(x, y, w, 128);
    g.strokeStyle = 'rgba(230,224,205,0.14)';
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, 127);

    g.textAlign = 'left';
    g.font = '700 12px ui-monospace, monospace';
    g.fillStyle = PHASE_COLOR[h.phase] || '#fff';
    g.fillText(h.phase.toUpperCase(), x + 10, y + 20);

    const limit =
      h.phase === Phase.BUILD ? D.buildMax
      : h.phase === Phase.PEAK ? D.peakTime
      : this.game.time.isNight ? D.relaxTimeNight : D.relaxTime;
    g.font = '400 11px ui-monospace, monospace';
    g.fillStyle = 'rgba(230,224,205,0.65)';
    g.fillText(`${h.phaseTime.toFixed(1)} / ${limit}s`, x + 78, y + 20);

    // Phase progress.
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.fillRect(x + 10, y + 26, w - 20, 3);
    g.fillStyle = PHASE_COLOR[h.phase] || '#fff';
    g.fillRect(x + 10, y + 26, (w - 20) * Math.min(1, h.phaseTime / limit), 3);

    // Pressure graph. The threshold line is what the whole machine watches.
    const gx = x + 10;
    const gy = y + 38;
    const gw = w - 20;
    const gh = 34;
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(gx, gy, gw, gh);

    const hist = this._pressureHistory;
    const n = hist.length;
    g.strokeStyle = '#d4552e';
    g.lineWidth = 1.2;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const v = hist[(this._historyHead + i) % n] / 1.8;
      const px2 = gx + (i / (n - 1)) * gw;
      const py = gy + gh - v * gh;
      if (i === 0) g.moveTo(px2, py);
      else g.lineTo(px2, py);
    }
    g.stroke();

    const ty = gy + gh - (D.peakPressure / 1.8) * gh;
    g.strokeStyle = 'rgba(230,224,205,0.35)';
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(gx, ty);
    g.lineTo(gx + gw, ty);
    g.stroke();
    g.setLineDash([]);

    g.fillStyle = 'rgba(230,224,205,0.75)';
    g.font = '400 10px ui-monospace, monospace';
    g.fillText(`pressure ${h.pressure.toFixed(2)}`, gx, gy + gh + 12);

    // Population and nav load.
    const lod = this.game.horde.zombies.filter((z) => z._lodSkip).length;
    const nav = this.game.world.nav;
    g.fillStyle = 'rgba(230,224,205,0.55)';
    g.fillText(
      `${h.zombies.length} alive · ${lod} lod · q${nav.queue.length} · mig:${h.migration.state}`,
      gx,
      gy + gh + 26
    );

    // Recent director events.
    const recent = h.events.slice(-3).reverse();
    let ey = gy + gh + 40;
    for (const e of recent) {
      g.fillStyle = 'rgba(230,224,205,0.4)';
      g.fillText(`${e.t}s ${e.kind}${e.detail !== null ? ' ' + JSON.stringify(e.detail) : ''}`.slice(0, 42), gx, ey);
      ey += 11;
    }
  }

  _drawLegend() {
    const g = this.ctx;
    const keys = Object.keys(STATE_COLOR).filter((k) => k !== 'dead');
    const x = 16;
    let y = window.innerHeight - 16 - keys.length * 12;
    g.font = '400 10px ui-monospace, monospace';
    g.textAlign = 'left';
    for (const k of keys) {
      g.fillStyle = STATE_COLOR[k];
      g.fillRect(x, y - 6, 7, 7);
      g.fillStyle = 'rgba(230,224,205,0.55)';
      g.fillText(k, x + 12, y);
      y += 12;
    }
  }
}

export default DebugOverlay;
