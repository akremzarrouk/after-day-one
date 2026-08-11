/**
 * AudioSys.js — every sound in the game is synthesised at runtime.
 *
 * No audio files, no loading, no licensing. Noise bursts through filters get
 * you footsteps, impacts and wind; detuned saws with pitch wobble get you
 * something unpleasantly close to a human voice that isn't one any more.
 *
 * Positional audio is done by hand (gain by distance, pan by angle relative to
 * the camera) because it's cheaper and easier to reason about than the
 * PannerNode graph for ~40 emitters.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.listener = { x: 0, z: 0, yaw: 0 };
    this.masterVolume = 0.85;
    this._ambientTimers = {};
    this._lastStep = 0;
    this._heartbeatPhase = 0;
    this._muted = false;
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ready) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      const ctx = this.ctx;

      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.knee.value = 22;
      this.comp.ratio.value = 7;
      this.comp.attack.value = 0.004;
      this.comp.release.value = 0.22;

      this.master = ctx.createGain();
      this.master.gain.value = this.masterVolume;

      this.master.connect(this.comp);
      this.comp.connect(ctx.destination);

      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = 1.0;
      this.sfxBus.connect(this.master);

      this.ambBus = ctx.createGain();
      this.ambBus.gain.value = 0.85;
      this.ambBus.connect(this.master);

      this.uiBus = ctx.createGain();
      this.uiBus.gain.value = 0.7;
      this.uiBus.connect(this.master);

      // Cheap procedural reverb — a decaying noise impulse response.
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this._makeImpulse(1.9, 2.6);
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 0.28;
      this.reverbSend.connect(this.reverb);
      this.reverb.connect(this.master);

      this.noiseBuf = this._makeNoise(2.0);
      this.brownBuf = this._makeBrownNoise(4.0);

      this._startAmbience();
      this.ready = true;
      return true;
    } catch (e) {
      console.warn('[audio] init failed, continuing silently', e);
      this.enabled = false;
      return false;
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setMuted(m) {
    this._muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.masterVolume;
  }

  _makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _makeBrownNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
    return buf;
  }

  _makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  setListener(x, z, yaw) {
    this.listener.x = x;
    this.listener.z = z;
    this.listener.yaw = yaw;
  }

  /** Gain + pan for a world position. rolloff in metres. */
  spatial(x, z, rolloff = 22) {
    const dx = x - this.listener.x;
    const dz = z - this.listener.z;
    const d = Math.hypot(dx, dz);
    const gain = clamp(1 - d / rolloff, 0, 1);
    // Angle relative to where the camera is facing.
    const ang = Math.atan2(dx, dz) - this.listener.yaw;
    const pan = clamp(Math.sin(ang), -1, 1) * 0.85;
    return { gain: gain * gain, pan, dist: d };
  }

  _chain(nodes, bus, pan, reverbAmount = 0) {
    const ctx = this.ctx;
    let last = nodes[nodes.length - 1];
    if (pan !== undefined && pan !== null && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      last.connect(p);
      last = p;
    }
    last.connect(bus || this.sfxBus);
    if (reverbAmount > 0 && this.reverbSend) {
      const rg = ctx.createGain();
      rg.gain.value = reverbAmount;
      last.connect(rg);
      rg.connect(this.reverbSend);
    }
    return last;
  }

  /** Filtered noise burst — the workhorse for impacts and footsteps. */
  noiseBurst(opts = {}) {
    if (!this.ready || !this.enabled) return;
    try {
      const ctx = this.ctx;
      const {
        dur = 0.12,
        type = 'lowpass',
        freq = 900,
        q = 1.2,
        gain = 0.4,
        attack = 0.002,
        pan = 0,
        rate = 1,
        reverb = 0.08,
        bus = null,
        sweepTo = null,
      } = opts;

      const src = ctx.createBufferSource();
      src.buffer = opts.brown ? this.brownBuf : this.noiseBuf;
      src.playbackRate.value = rate;
      src.loop = true;

      const flt = ctx.createBiquadFilter();
      flt.type = type;
      flt.frequency.value = freq;
      flt.Q.value = q;
      if (sweepTo) {
        flt.frequency.setValueAtTime(freq, ctx.currentTime);
        flt.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), ctx.currentTime + dur);
      }

      const g = ctx.createGain();
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      src.connect(flt);
      flt.connect(g);
      this._chain([g], bus, pan, reverb);

      src.start(t + (opts.delay || 0));
      src.stop(t + dur + 0.05 + (opts.delay || 0));
    } catch (e) {
      /* audio must never break the game */
    }
  }

  tone(opts = {}) {
    if (!this.ready || !this.enabled) return;
    try {
      const ctx = this.ctx;
      const {
        freq = 220,
        type = 'sine',
        dur = 0.2,
        gain = 0.2,
        attack = 0.005,
        pan = 0,
        slideTo = null,
        detune = 0,
        reverb = 0.06,
        bus = null,
        delay = 0,
        vibrato = 0,
        vibratoRate = 6,
      } = opts;

      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const t = ctx.currentTime + delay;
      if (slideTo) {
        osc.frequency.setValueAtTime(freq, t);
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
      }

      let vibOsc = null;
      if (vibrato > 0) {
        vibOsc = ctx.createOscillator();
        vibOsc.frequency.value = vibratoRate;
        const vg = ctx.createGain();
        vg.gain.value = vibrato;
        vibOsc.connect(vg);
        vg.connect(osc.frequency);
        vibOsc.start(t);
        vibOsc.stop(t + dur + 0.1);
      }

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      osc.connect(g);
      this._chain([g], bus, pan, reverb);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    } catch (e) {
      /* ignore */
    }
  }

  // ───────────────────────────────────────────────────────── ambience ──

  _startAmbience() {
    const ctx = this.ctx;

    // Wind: brown noise through a slowly-moving lowpass.
    const src = ctx.createBufferSource();
    src.buffer = this.brownBuf;
    src.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 420;
    flt.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.11;
    src.connect(flt);
    flt.connect(g);
    g.connect(this.ambBus);
    src.start();
    this.windGain = g;
    this.windFilter = flt;

    // Slow LFO on the wind so it breathes.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.055;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 190;
    lfo.connect(lfoG);
    lfoG.connect(flt.frequency);
    lfo.start();

    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.021;
    const lfo2G = ctx.createGain();
    lfo2G.gain.value = 0.045;
    lfo2.connect(lfo2G);
    lfo2G.connect(g.gain);
    lfo2.start();

    // A low, almost-subsonic drone that gets louder at night.
    const drone = ctx.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = 44;
    const dg = ctx.createGain();
    dg.gain.value = 0.0;
    drone.connect(dg);
    dg.connect(this.ambBus);
    drone.start();
    this.droneGain = dg;

    const drone2 = ctx.createOscillator();
    drone2.type = 'sine';
    drone2.frequency.value = 58.7;
    const dg2 = ctx.createGain();
    dg2.gain.value = 0.0;
    drone2.connect(dg2);
    dg2.connect(this.ambBus);
    drone2.start();
    this.droneGain2 = dg2;
  }

  /** Called every frame with world state. */
  update(dt, state) {
    if (!this.ready || !this.enabled) return;
    const { isNight = false, threat = 0, healthFrac = 1, indoors = false, moving = false } = state || {};

    try {
      if (this.windGain) {
        const target = (isNight ? 0.155 : 0.10) * (indoors ? 0.4 : 1);
        this.windGain.gain.value += (target - this.windGain.gain.value) * Math.min(1, dt * 1.2);
      }
      if (this.windFilter) {
        const target = indoors ? 240 : isNight ? 380 : 520;
        this.windFilter.frequency.value += (target - this.windFilter.frequency.value) * Math.min(1, dt * 0.8);
      }
      if (this.droneGain) {
        const target = (isNight ? 0.05 : 0.012) + threat * 0.075;
        this.droneGain.gain.value += (target - this.droneGain.gain.value) * Math.min(1, dt * 1.4);
      }
      if (this.droneGain2) {
        const target = threat * 0.06;
        this.droneGain2.gain.value += (target - this.droneGain2.gain.value) * Math.min(1, dt * 1.1);
      }

      // Distant one-shots: the world keeps existing off-screen.
      this._tick('distant', dt, isNight ? 11 : 17, () => this.distantSound(isNight));
      if (isNight) this._tick('crickets', dt, 6.5, () => this.crickets());
      if (!isNight) this._tick('birds', dt, 22, () => this.crow());

      // Heartbeat when badly hurt.
      if (healthFrac < 0.36) {
        this._heartbeatPhase += dt * (0.95 + (0.36 - healthFrac) * 3.4);
        if (this._heartbeatPhase >= 1) {
          this._heartbeatPhase = 0;
          const g = 0.16 * (1 - healthFrac);
          this.tone({ freq: 58, type: 'sine', dur: 0.16, gain: g, reverb: 0 });
          this.tone({ freq: 46, type: 'sine', dur: 0.2, gain: g * 0.8, delay: 0.19, reverb: 0 });
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  _tick(key, dt, period, fn) {
    const t = (this._ambientTimers[key] || period * Math.random()) - dt;
    if (t <= 0) {
      this._ambientTimers[key] = period * (0.55 + Math.random() * 0.9);
      fn();
    } else {
      this._ambientTimers[key] = t;
    }
  }

  distantSound(isNight) {
    const pan = (Math.random() * 2 - 1) * 0.9;
    const r = Math.random();
    if (r < 0.45) {
      // far-off groan
      this.groanAt(null, { pan, gain: 0.07 + Math.random() * 0.05, far: true });
    } else if (r < 0.62) {
      // dog barking somewhere
      for (let i = 0; i < 3; i++) {
        this.tone({
          freq: 220 + Math.random() * 90,
          type: 'sawtooth',
          dur: 0.1,
          gain: 0.035,
          pan,
          delay: i * 0.22,
          slideTo: 130,
          reverb: 0.5,
        });
      }
    } else if (r < 0.76) {
      // metal clatter — something fell over three streets away
      this.noiseBurst({ dur: 0.3, type: 'bandpass', freq: 1900, q: 3, gain: 0.05, pan, reverb: 0.6, rate: 1.4 });
      this.noiseBurst({ dur: 0.5, type: 'bandpass', freq: 900, q: 2, gain: 0.03, pan, delay: 0.09, reverb: 0.6 });
    } else if (r < 0.88 && isNight) {
      // a scream, cut off
      this.tone({ freq: 640, type: 'sawtooth', dur: 0.55, gain: 0.045, pan, slideTo: 300, vibrato: 22, reverb: 0.7 });
    } else {
      // wind gust through a broken window
      this.noiseBurst({ dur: 1.7, type: 'bandpass', freq: 700, q: 2.5, gain: 0.05, pan, brown: true, reverb: 0.4 });
    }
  }

  crickets() {
    const pan = (Math.random() * 2 - 1) * 0.8;
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      this.noiseBurst({
        dur: 0.03,
        type: 'bandpass',
        freq: 4200 + Math.random() * 1400,
        q: 22,
        gain: 0.02,
        pan,
        delay: i * 0.075,
        reverb: 0.1,
      });
    }
  }

  crow() {
    const pan = (Math.random() * 2 - 1) * 0.8;
    for (let i = 0; i < 2; i++) {
      this.tone({
        freq: 420 - i * 40,
        type: 'sawtooth',
        dur: 0.22,
        gain: 0.035,
        pan,
        delay: i * 0.3,
        slideTo: 240,
        vibrato: 30,
        vibratoRate: 24,
        reverb: 0.5,
      });
    }
  }

  // ────────────────────────────────────────────────────────── one-shots ──

  footstep(x, z, surface = 'concrete', running = false, indoors = false) {
    const sp = x === undefined ? { gain: 1, pan: 0 } : this.spatial(x, z, 18);
    const g = (running ? 0.16 : 0.085) * (0.6 + sp.gain * 0.7);
    const cfgs = {
      concrete: { freq: 1500, q: 1.1, dur: 0.075, rate: 1.5 },
      grass: { freq: 2600, q: 0.8, dur: 0.11, rate: 1.1 },
      wood: { freq: 700, q: 2.4, dur: 0.1, rate: 1.2 },
      gravel: { freq: 3200, q: 1.0, dur: 0.09, rate: 1.3 },
      tile: { freq: 2200, q: 3.2, dur: 0.07, rate: 1.7 },
    };
    const c = cfgs[surface] || cfgs.concrete;
    this.noiseBurst({
      dur: c.dur,
      type: 'bandpass',
      freq: c.freq * (0.85 + Math.random() * 0.3),
      q: c.q,
      gain: g,
      pan: sp.pan,
      rate: c.rate,
      reverb: indoors ? 0.3 : 0.05,
    });
    this.noiseBurst({
      dur: 0.05,
      type: 'lowpass',
      freq: 190,
      gain: g * 0.9,
      pan: sp.pan,
      reverb: 0.02,
    });
  }

  swing(kind = 'whoosh') {
    const cfg = {
      whoosh_light: { freq: 1800, dur: 0.16, gain: 0.11, sweep: 480 },
      whoosh: { freq: 1200, dur: 0.22, gain: 0.15, sweep: 260 },
      whoosh_heavy: { freq: 800, dur: 0.3, gain: 0.19, sweep: 150 },
    }[kind] || { freq: 1200, dur: 0.22, gain: 0.15, sweep: 260 };
    this.noiseBurst({
      dur: cfg.dur,
      type: 'bandpass',
      freq: cfg.freq,
      q: 1.6,
      gain: cfg.gain,
      sweepTo: cfg.sweep,
      brown: true,
      reverb: 0.12,
    });
  }

  impact(kind, x, z) {
    const sp = x === undefined ? { gain: 1, pan: 0 } : this.spatial(x, z, 26);
    const vol = 0.35 + sp.gain * 0.65;
    switch (kind) {
      case 'hit_stab':
        this.noiseBurst({ dur: 0.11, type: 'bandpass', freq: 900, q: 2.4, gain: 0.3 * vol, pan: sp.pan, reverb: 0.15 });
        this.noiseBurst({ dur: 0.2, type: 'lowpass', freq: 320, gain: 0.24 * vol, pan: sp.pan, rate: 0.7 });
        break;
      case 'hit_blunt':
        this.tone({ freq: 118, type: 'triangle', dur: 0.16, gain: 0.32 * vol, pan: sp.pan, slideTo: 52 });
        this.noiseBurst({ dur: 0.14, type: 'lowpass', freq: 620, gain: 0.34 * vol, pan: sp.pan, reverb: 0.2 });
        break;
      case 'hit_metal':
        this.tone({ freq: 430, type: 'square', dur: 0.13, gain: 0.16 * vol, pan: sp.pan, slideTo: 160 });
        this.noiseBurst({ dur: 0.18, type: 'bandpass', freq: 1600, q: 3, gain: 0.28 * vol, pan: sp.pan, reverb: 0.25 });
        break;
      case 'hit_chop':
        this.noiseBurst({ dur: 0.2, type: 'lowpass', freq: 460, gain: 0.42 * vol, pan: sp.pan, reverb: 0.24 });
        this.tone({ freq: 92, type: 'triangle', dur: 0.22, gain: 0.3 * vol, pan: sp.pan, slideTo: 40 });
        break;
      case 'hit_soft':
      default:
        this.noiseBurst({ dur: 0.1, type: 'lowpass', freq: 420, gain: 0.26 * vol, pan: sp.pan, reverb: 0.1 });
        this.tone({ freq: 96, type: 'sine', dur: 0.12, gain: 0.2 * vol, pan: sp.pan, slideTo: 55 });
        break;
    }
    // Wet layer — you never quite get used to it.
    this.noiseBurst({
      dur: 0.16,
      type: 'bandpass',
      freq: 380,
      q: 1.4,
      gain: 0.16 * vol,
      pan: sp.pan,
      rate: 0.6,
      delay: 0.015,
    });
  }

  miss() {
    this.noiseBurst({ dur: 0.1, type: 'highpass', freq: 2600, gain: 0.05 });
  }

  /** Zombie vocalisation. state 0=idle,1=alert,2=chase */
  groanAt(pos, opts = {}) {
    const far = opts.far;
    const sp = pos ? this.spatial(pos.x, pos.z, far ? 90 : 30) : { gain: 1, pan: opts.pan ?? 0 };
    if (sp.gain <= 0.001 && !far) return;
    const base = (opts.pitch || 1) * (0.72 + Math.random() * 0.5);
    const gain = (opts.gain ?? 0.16) * (far ? 1 : 0.35 + sp.gain * 0.9);
    const dur = opts.dur || 0.5 + Math.random() * 0.6;

    this.tone({
      freq: 88 * base,
      type: 'sawtooth',
      dur,
      gain: gain * 0.6,
      pan: sp.pan,
      slideTo: 62 * base,
      vibrato: 7 + Math.random() * 9,
      vibratoRate: 4 + Math.random() * 6,
      reverb: far ? 0.75 : 0.3,
    });
    this.tone({
      freq: 131 * base,
      type: 'sawtooth',
      dur: dur * 0.9,
      gain: gain * 0.28,
      pan: sp.pan,
      detune: 18,
      slideTo: 96 * base,
      vibrato: 10,
      reverb: far ? 0.7 : 0.28,
    });
    this.noiseBurst({
      dur: dur * 0.8,
      type: 'bandpass',
      freq: 620 * base,
      q: 2.2,
      gain: gain * 0.5,
      pan: sp.pan,
      reverb: far ? 0.7 : 0.25,
      rate: 0.55,
    });
  }

  shriek(pos) {
    const sp = pos ? this.spatial(pos.x, pos.z, 44) : { gain: 1, pan: 0 };
    const g = 0.2 * (0.4 + sp.gain);
    this.tone({
      freq: 460,
      type: 'sawtooth',
      dur: 0.7,
      gain: g,
      pan: sp.pan,
      slideTo: 820,
      vibrato: 45,
      vibratoRate: 17,
      reverb: 0.45,
    });
    this.noiseBurst({ dur: 0.6, type: 'bandpass', freq: 1500, q: 2.4, gain: g * 0.8, pan: sp.pan, reverb: 0.5 });
  }

  // ────────────────────────────────────────────────────── special infected ──

  /**
   * The screamer drawing breath.
   *
   * A rising, wet intake with nothing else like it in the mix — this is the
   * two-second warning, and the whole design of the archetype depends on the
   * player learning it in one exposure. Deliberately audible well past where
   * you can see the thing.
   */
  screamerInhale(pos) {
    const sp = pos ? this.spatial(pos.x, pos.z, 55) : { gain: 1, pan: 0 };
    const v = 0.45 + sp.gain;
    this.noiseBurst({
      dur: 1.9,
      type: 'bandpass',
      freq: 320,
      q: 1.6,
      gain: 0.2 * v,
      pan: sp.pan,
      sweepTo: 2600,        // the rise is the countdown
      rate: 0.55,
      reverb: 0.4,
    });
    this.tone({
      freq: 150,
      type: 'sawtooth',
      dur: 1.9,
      gain: 0.075 * v,
      pan: sp.pan,
      slideTo: 430,
      vibrato: 9,
      vibratoRate: 5,
      reverb: 0.45,
    });
  }

  /** And letting it out. Loud, ragged, and heard by everything. */
  screamerCall(pos) {
    const sp = pos ? this.spatial(pos.x, pos.z, 80) : { gain: 1, pan: 0 };
    const v = 0.55 + sp.gain;
    this.tone({ freq: 900, type: 'sawtooth', dur: 1.5, gain: 0.26 * v, pan: sp.pan, slideTo: 380, vibrato: 70, vibratoRate: 21, reverb: 0.7 });
    this.tone({ freq: 1340, type: 'square', dur: 1.2, gain: 0.1 * v, pan: sp.pan, slideTo: 520, vibrato: 48, vibratoRate: 15, reverb: 0.7 });
    this.noiseBurst({ dur: 1.4, type: 'bandpass', freq: 2200, q: 1.8, gain: 0.2 * v, pan: sp.pan, sweepTo: 700, reverb: 0.75 });
    this.noiseBurst({ dur: 1.9, type: 'bandpass', freq: 900, q: 1.1, gain: 0.09 * v, pan: sp.pan, delay: 0.14, reverb: 0.9 });
  }

  /**
   * A runner's footfalls. Fast, light and dry — you get about a second and a
   * half of this before it arrives, which is the only warning there is.
   */
  runnerStep(pos) {
    const sp = pos ? this.spatial(pos.x, pos.z, 34) : { gain: 1, pan: 0 };
    const v = 0.4 + sp.gain;
    this.noiseBurst({ dur: 0.05, type: 'bandpass', freq: 2700, q: 1.5, gain: 0.14 * v, pan: sp.pan, rate: 1.8, reverb: 0.1 });
    this.noiseBurst({ dur: 0.04, type: 'lowpass', freq: 240, gain: 0.12 * v, pan: sp.pan });
  }

  /** The breath that goes with it: quick, shallow, wrong. */
  runnerBreath(pos) {
    const sp = pos ? this.spatial(pos.x, pos.z, 26) : { gain: 1, pan: 0 };
    for (let i = 0; i < 3; i++) {
      this.noiseBurst({
        dur: 0.07,
        type: 'bandpass',
        freq: 1100 + Math.random() * 400,
        q: 2.2,
        gain: 0.07 * (0.4 + sp.gain),
        pan: sp.pan,
        delay: i * 0.15,
        rate: 0.8,
      });
    }
  }

  /**
   * A brute's footfall. Almost entirely sub-bass, so it carries through walls
   * and across the map: you feel one coming long before the street tells you
   * which direction.
   */
  bruteStep(pos) {
    const sp = pos ? this.spatial(pos.x, pos.z, 62) : { gain: 1, pan: 0 };
    const v = 0.5 + sp.gain;
    this.tone({ freq: 48, type: 'sine', dur: 0.34, gain: 0.3 * v, pan: sp.pan, slideTo: 26, reverb: 0.35 });
    this.noiseBurst({ dur: 0.16, type: 'lowpass', freq: 170, gain: 0.24 * v, pan: sp.pan, reverb: 0.4 });
    this.noiseBurst({ dur: 0.3, type: 'bandpass', freq: 620, q: 2.4, gain: 0.05 * v, pan: sp.pan, delay: 0.03, reverb: 0.5 });
  }

  /** A brute noticing you. Not a groan — a bellow. */
  bruteRoar(pos) {
    const sp = pos ? this.spatial(pos.x, pos.z, 60) : { gain: 1, pan: 0 };
    const v = 0.5 + sp.gain;
    this.tone({ freq: 62, type: 'sawtooth', dur: 1.5, gain: 0.3 * v, pan: sp.pan, slideTo: 38, vibrato: 6, vibratoRate: 3.5, reverb: 0.6 });
    this.tone({ freq: 93, type: 'sawtooth', dur: 1.3, gain: 0.15 * v, pan: sp.pan, detune: 22, slideTo: 54, reverb: 0.6 });
    this.noiseBurst({ dur: 1.2, type: 'lowpass', freq: 420, gain: 0.2 * v, pan: sp.pan, sweepTo: 120, reverb: 0.65 });
  }

  /**
   * A crowd, somewhere else. The migration's twenty-second warning: many
   * voices, no direction you can act on except "not that way".
   */
  distantHorde(pan = 0, strength = 1) {
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      this.groanAt(null, {
        pan: pan + (Math.random() - 0.5) * 0.35,
        gain: (0.05 + Math.random() * 0.05) * strength,
        far: true,
        pitch: 0.8 + Math.random() * 0.5,
        dur: 0.9 + Math.random() * 0.8,
      });
    }
    this.noiseBurst({
      dur: 2.4,
      type: 'lowpass',
      freq: 260,
      gain: 0.05 * strength,
      pan,
      brown: true,
      reverb: 0.85,
    });
  }

  zombieDeath(pos) {
    const sp = pos ? this.spatial(pos.x, pos.z, 30) : { gain: 1, pan: 0 };
    const g = 0.22 * (0.4 + sp.gain);
    this.tone({ freq: 130, type: 'sawtooth', dur: 0.9, gain: g, pan: sp.pan, slideTo: 42, vibrato: 14, reverb: 0.4 });
    this.noiseBurst({ dur: 0.6, type: 'lowpass', freq: 700, gain: g * 0.9, pan: sp.pan, sweepTo: 120, reverb: 0.35 });
  }

  playerHurt(heavy = false) {
    this.tone({ freq: heavy ? 150 : 200, type: 'sawtooth', dur: 0.28, gain: 0.17, slideTo: 90, vibrato: 12, reverb: 0.1 });
    this.noiseBurst({ dur: 0.24, type: 'bandpass', freq: 520, q: 1.4, gain: 0.2, sweepTo: 180 });
    this.noiseBurst({ dur: 0.09, type: 'lowpass', freq: 200, gain: 0.3 });
  }

  playerDeath() {
    this.tone({ freq: 130, type: 'sawtooth', dur: 2.4, gain: 0.24, slideTo: 34, vibrato: 6, reverb: 0.7 });
    this.tone({ freq: 61, type: 'sine', dur: 3.0, gain: 0.2, slideTo: 28, reverb: 0.8 });
    this.noiseBurst({ dur: 1.6, type: 'lowpass', freq: 900, gain: 0.2, sweepTo: 60, reverb: 0.6 });
  }

  gunshot() {
    this.noiseBurst({ dur: 0.16, type: 'bandpass', freq: 2400, q: 0.8, gain: 0.75, reverb: 0.5 });
    this.noiseBurst({ dur: 0.42, type: 'lowpass', freq: 420, gain: 0.65, sweepTo: 70, reverb: 0.75 });
    this.tone({ freq: 92, type: 'square', dur: 0.14, gain: 0.42, slideTo: 32 });
    // tail slapback off the buildings
    this.noiseBurst({ dur: 0.9, type: 'bandpass', freq: 900, q: 1.2, gain: 0.14, delay: 0.09, reverb: 0.9 });
  }

  dryFire() {
    this.noiseBurst({ dur: 0.05, type: 'bandpass', freq: 2600, q: 6, gain: 0.14 });
  }

  reload() {
    for (let i = 0; i < 3; i++)
      this.noiseBurst({
        dur: 0.05,
        type: 'bandpass',
        freq: 1800 + i * 500,
        q: 5,
        gain: 0.1,
        delay: i * 0.13,
      });
  }

  rustle(x, z) {
    const sp = x === undefined ? { gain: 1, pan: 0 } : this.spatial(x, z, 16);
    this.noiseBurst({
      dur: 0.22 + Math.random() * 0.2,
      type: 'bandpass',
      freq: 2400 + Math.random() * 1600,
      q: 1.1,
      gain: 0.09 * (0.5 + sp.gain),
      pan: sp.pan,
      rate: 1.3,
      reverb: 0.14,
    });
  }

  pickup() {
    this.tone({ freq: 640, type: 'triangle', dur: 0.09, gain: 0.11, bus: this.uiBus });
    this.tone({ freq: 980, type: 'triangle', dur: 0.1, gain: 0.09, delay: 0.06, bus: this.uiBus });
  }

  uiClick() {
    this.tone({ freq: 520, type: 'square', dur: 0.04, gain: 0.06, bus: this.uiBus, reverb: 0 });
  }

  uiBad() {
    this.tone({ freq: 190, type: 'square', dur: 0.12, gain: 0.08, bus: this.uiBus, slideTo: 110, reverb: 0 });
  }

  useItem() {
    this.noiseBurst({ dur: 0.3, type: 'bandpass', freq: 1300, q: 1.4, gain: 0.1, bus: this.uiBus });
  }

  drink() {
    for (let i = 0; i < 3; i++)
      this.tone({
        freq: 300 + i * 60,
        type: 'sine',
        dur: 0.11,
        gain: 0.08,
        delay: i * 0.19,
        slideTo: 180,
        bus: this.uiBus,
      });
  }

  hammer(x, z) {
    const sp = x === undefined ? { gain: 1, pan: 0 } : this.spatial(x, z, 30);
    this.noiseBurst({ dur: 0.11, type: 'bandpass', freq: 1100, q: 2.4, gain: 0.3 * (0.4 + sp.gain), pan: sp.pan, reverb: 0.4 });
    this.tone({ freq: 260, type: 'square', dur: 0.09, gain: 0.14, pan: sp.pan, slideTo: 120 });
  }

  glassBreak(x, z) {
    const sp = x === undefined ? { gain: 1, pan: 0 } : this.spatial(x, z, 34);
    const v = 0.4 + sp.gain;
    for (let i = 0; i < 7; i++) {
      this.noiseBurst({
        dur: 0.09,
        type: 'bandpass',
        freq: 3200 + Math.random() * 3600,
        q: 8,
        gain: 0.12 * v,
        pan: sp.pan + (Math.random() - 0.5) * 0.3,
        delay: Math.random() * 0.22,
        reverb: 0.5,
      });
    }
  }

  door(open = true, x, z) {
    const sp = x === undefined ? { gain: 1, pan: 0 } : this.spatial(x, z, 20);
    this.noiseBurst({
      dur: 0.45,
      type: 'bandpass',
      freq: open ? 380 : 240,
      q: 3,
      gain: 0.14 * (0.5 + sp.gain),
      pan: sp.pan,
      sweepTo: open ? 700 : 120,
      reverb: 0.35,
    });
    if (!open) this.noiseBurst({ dur: 0.12, type: 'lowpass', freq: 200, gain: 0.24, pan: sp.pan, delay: 0.4 });
  }

  /** A door shut hard: the swing, the bang, and the frame ringing after it. */
  doorSlam(x, z) {
    const sp = x === undefined ? { gain: 1, pan: 0 } : this.spatial(x, z, 30);
    const v = 0.5 + sp.gain;
    this.noiseBurst({ dur: 0.1, type: 'bandpass', freq: 520, q: 2, gain: 0.16 * v, pan: sp.pan, sweepTo: 180 });
    this.noiseBurst({ dur: 0.22, type: 'lowpass', freq: 260, gain: 0.4 * v, pan: sp.pan, delay: 0.08, reverb: 0.5 });
    this.tone({ freq: 96, type: 'sine', dur: 0.3, gain: 0.16 * v, pan: sp.pan, delay: 0.08, slideTo: 62 });
  }

  /** Something on the other side wants in. */
  doorBang(x, z, heavy = false) {
    const sp = x === undefined ? { gain: 1, pan: 0 } : this.spatial(x, z, 34);
    const v = 0.45 + sp.gain;
    this.noiseBurst({
      dur: heavy ? 0.2 : 0.13,
      type: 'lowpass',
      freq: heavy ? 200 : 320,
      gain: (heavy ? 0.4 : 0.28) * v,
      pan: sp.pan,
      reverb: 0.55,
    });
    this.tone({ freq: heavy ? 72 : 110, type: 'sine', dur: 0.26, gain: 0.13 * v, pan: sp.pan, slideTo: 48 });
  }

  /** Timber giving way. */
  woodBreak(x, z) {
    const sp = x === undefined ? { gain: 1, pan: 0 } : this.spatial(x, z, 38);
    const v = 0.5 + sp.gain;
    for (let i = 0; i < 5; i++) {
      this.noiseBurst({
        dur: 0.12,
        type: 'bandpass',
        freq: 700 + Math.random() * 1500,
        q: 4,
        gain: 0.17 * v,
        pan: sp.pan + (Math.random() - 0.5) * 0.25,
        delay: Math.random() * 0.26,
        reverb: 0.5,
      });
    }
    this.noiseBurst({ dur: 0.3, type: 'lowpass', freq: 180, gain: 0.34 * v, pan: sp.pan, delay: 0.05, reverb: 0.6 });
  }

  /** Scrambling over a sill. */
  vault(x, z) {
    const sp = x === undefined ? { gain: 1, pan: 0 } : this.spatial(x, z, 22);
    this.noiseBurst({ dur: 0.3, type: 'bandpass', freq: 640, q: 1.4, gain: 0.16 * (0.5 + sp.gain), pan: sp.pan, sweepTo: 300 });
    this.noiseBurst({ dur: 0.1, type: 'lowpass', freq: 240, gain: 0.2 * (0.5 + sp.gain), pan: sp.pan, delay: 0.34 });
  }

  levelStinger() {
    this.tone({ freq: 55, type: 'sine', dur: 3.2, gain: 0.2, reverb: 0.8 });
    this.tone({ freq: 82.5, type: 'sine', dur: 2.6, gain: 0.11, delay: 0.4, reverb: 0.8 });
  }

  dawnStinger() {
    this.tone({ freq: 196, type: 'sine', dur: 3.4, gain: 0.13, reverb: 0.85 });
    this.tone({ freq: 294, type: 'sine', dur: 3.0, gain: 0.1, delay: 0.5, reverb: 0.85 });
    this.tone({ freq: 392, type: 'sine', dur: 3.4, gain: 0.08, delay: 1.0, reverb: 0.85 });
  }
}
