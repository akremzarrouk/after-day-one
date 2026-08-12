/**
 * Radio.js — the campaign, delivered by a set on a kitchen table.
 *
 * This is the only exposition in the game and it is deliberately the worst
 * possible channel for it: a battery radio catching one broken fragment a day
 * from somebody who is not talking to you. There is no quest log and no map
 * marker anywhere in AFTER, so the five-day spine has to be carried by four
 * transmissions and the fact that you have walked past the checkpoint on Ridge
 * every single morning.
 *
 * Each dawn the set starts hissing on its own. That hiss is the notification;
 * the objective line saying "the radio is saying something" is the only UI it
 * ever gets.
 */

/**
 * One fragment per dawn from day two. Written so that a player who only ever
 * catches *one* of them still learns the two facts that matter — a road, and
 * a morning — and a player who catches all four knows what it will cost.
 */
export const FRAGMENTS = [
  {
    day: 2,
    title: 'A voice, most of a sentence',
    lines: [
      '…anyone still receiving on this band…',
      '…we are staging on the highway. Vehicles, fuel, room for—',
      '…not indefinitely. Say again, not indefinitely…',
    ],
  },
  {
    day: 3,
    title: 'The same voice, steadier',
    lines: [
      '…convoy is forming at the Ridge junction…',
      '…the old police checkpoint north of the crossroads. The sandbags.',
      '…if you can walk, walk. Nobody is coming down to get you…',
    ],
  },
  {
    day: 4,
    title: 'A woman, reading from a page',
    lines: [
      '…departure is first light on the fifth day. Repeat, first light…',
      '…we hold the road through the early hours and then we are gone…',
      '…do not travel at night. We will not open the vehicles at night…',
    ],
  },
  {
    day: 5,
    title: 'Barely a signal at all',
    lines: [
      '…engines are turning over…',
      '…this is the last time we transmit. We are at the checkpoint…',
      '…come now. Please. Come now…',
    ],
  },
];

export class Radio {
  constructor(spec = {}) {
    this.x = spec.x ?? 0;
    this.z = spec.z ?? 0;
    this.heard = new Set();
    this.pending = null;        // the day whose fragment is waiting
    this.playing = null;        // { frag, t, lineIndex }
    this.events = [];
    this._hissT = 0;
    this._voiceT = 0;
  }

  reset() {
    this.heard.clear();
    this.pending = null;
    this.playing = null;
    this.events.length = 0;
  }

  emit(kind, text, big = false) {
    this.events.push({ kind, text, big });
  }

  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }

  fragmentFor(day) {
    return FRAGMENTS.find((f) => f.day === day) || null;
  }

  /** How many there are to catch in a whole run. */
  get total() {
    return FRAGMENTS.length;
  }

  /** Dawn broke: is there anything on the air today? */
  onDawn(day) {
    const frag = this.fragmentFor(day);
    if (!frag || this.heard.has(day)) return false;
    this.pending = day;
    return true;
  }

  get hasSignal() {
    return this.pending !== null && !this.playing;
  }

  get lastHeardDay() {
    let m = 0;
    for (const d of this.heard) if (d > m) m = d;
    return m;
  }

  /**
   * What the objective line should say about the road out, given everything
   * the player has actually heard. Somebody who never touched the radio gets
   * nothing but the dusk warnings — which is a legitimate, harder run.
   */
  hint() {
    const d = this.lastHeardDay;
    if (d >= 4) return 'Ridge checkpoint · first light on the fifth day';
    if (d === 3) return 'The convoy is at the Ridge junction';
    if (d === 2) return 'Somebody is staging on the highway';
    return null;
  }

  listen() {
    if (this.pending === null || this.playing) return false;
    const frag = this.fragmentFor(this.pending);
    if (!frag) return false;
    this.playing = { frag, t: 0, line: -1 };
    return true;
  }

  /**
   * Playback. Lines land on their own beat rather than all at once so the
   * transmission has to be *waited* through — which is the small cost of
   * knowing anything, and the reason a fragment is a decision on a morning
   * where the light is already going.
   */
  update(dt, ctx) {
    const CFG = ctx.cfg;
    if (this.playing) {
      const p = this.playing;
      p.t += dt;
      const per = CFG.playTime / p.frag.lines.length;
      const idx = Math.min(p.frag.lines.length - 1, Math.floor(p.t / per));
      if (idx > p.line) {
        p.line = idx;
        this.emit('', p.frag.lines[idx], true);
        this._voiceT = 0;
      }
      // Static under the words, and a syllable every few hundred ms.
      this._voiceT -= dt;
      if (this._voiceT <= 0) {
        this._voiceT = 0.16 + Math.random() * 0.2;
        ctx.audio.radioVoice(this.x, this.z, 0.8 + Math.random() * 0.5);
      }
      this._hissT -= dt;
      if (this._hissT <= 0) {
        this._hissT = 1.1;
        ctx.audio.radioHiss(this.x, this.z, 1.4);
      }
      if (p.t >= CFG.playTime) {
        this.heard.add(p.frag.day);
        this.pending = null;
        this.playing = null;
        this.emit('warn', 'The signal goes.', false);
      }
      return;
    }

    // Idle carrier wave, only while there is something unheard on it.
    if (this.pending === null) return;
    this._hissT -= dt;
    if (this._hissT <= 0) {
      this._hissT = 2.4 + Math.random() * 2.0;
      ctx.audio.radioHiss(this.x, this.z, 1);
    }
  }

  serialize() {
    return { heard: [...this.heard], pending: this.pending };
  }

  restore(s) {
    if (!s) return;
    this.heard = new Set(s.heard || []);
    this.pending = s.pending ?? null;
    this.playing = null;
  }
}
