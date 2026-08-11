# AUDIO PRODUCTION — full soundscape pass

You are the **Audio Director** on AFTER. Your job this session: replace the
synthesized placeholder audio with a produced, mixed, adaptive soundscape.
Sound is half the horror; treat this like shipping a real audio department's
work.

# PROJECT CONTEXT — read this, then verify against the repo

You are working on **AFTER — Day One**, an existing, working 3D third-person
zombie-survival vertical slice in this directory.

- Stack: three.js + Vite, plain ES modules. Run: `npm run dev`, click BEGIN
  (audio requires the gesture).
- Audio today (`src/systems/AudioSys.js`): everything synthesized in WebAudio —
  noise-burst footsteps by surface, detuned-saw zombie groans, impact layers, a
  gunshot with slapback, wind/drone ambience with LFOs, a convolver reverb from
  a generated impulse, distant one-shots (dogs, screams, clatter), heartbeat at
  low health. Manual spatialization: gain by distance + StereoPanner by angle.
  ~Every system calls its facade methods: `footstep, swing, impact, groanAt,
  shriek, gunshot, glassBreak, door, hammer, rustle, pickup, uiClick, drink,
  playerHurt, playerDeath, zombieDeath, levelStinger, dawnStinger, update(dt,
  state)` (state = isNight, threat 0–1, healthFrac, indoors, moving).
- Architecture (src/): `core/` · `world/` (Collision has `lineBlocked` — usable
  for occlusion) · `player/` · `entities/` (Horde exposes `threat(pos)`) ·
  `combat/` · `systems/` · `ui/` · `dev/` (TestHarness via `?headless`).
- Invariants: **zero-network operation** — downloaded samples must be committed
  to the repo, and a full synthesis fallback must remain if files are missing;
  tunables in Config.js; keep the AudioSys facade API so no call sites change.

Before writing code: read `README.md` and all of `AudioSys.js`; grep for
`audio.` call sites to map the full surface area.

# MISSION

1. **Source real samples** (CC0 only: freesound CC0 filter, Kenney audio packs,
   OpenGameArt CC0) as OGG into `public/assets/audio/`, organized by category,
   every file logged in `ATTRIBUTION.md`. Targets: 4+ variations per footstep
   surface (concrete/grass/wood/tile/gravel), 6+ groans and 3+ screams per
   zombie archetype, per-weapon impacts and whooshes, door creaks/slams, glass,
   searching/rummage loops, cloth, gunshot + tail, UI ticks, and long ambience
   beds (wind, night insects, distant city rumble, interior room tone).
   **If downloads fail:** upgrade the synthesis instead — pre-render layered
   variations into AudioBuffers at load so the variation/round-robin
   architecture below still ships.
2. **Sample engine behind the existing facade:** lazy loading, variation pools
   with round-robin + no-immediate-repeat, ±4% pitch and ±2 dB gain jitter,
   voice cap per category with priority stealing (32 total, gunshot always
   wins).
3. **Mix architecture:** buses — master / ambience / sfx / zombies / ui /
   music — with a compressor on master, per-bus volumes in Config +
   localStorage. Sidechain ducking: zombie vocals duck ambience −4 dB; the
   low-health heartbeat ducks music −8 dB.
4. **Occlusion & spaces:** sounds whose source fails `collision.lineBlocked`
   to the listener get a lowpass (~800 Hz) + −6 dB; three reverb spaces
   (outdoor / interior / alley) with distinct IRs, chosen by the existing
   indoors detection.
5. **Adaptive music:** three stem layers — a near-silent calm pad, a tension
   layer, a danger layer — crossfaded continuously from `Horde.threat`.
   Stingers: first-spot scream hit, dusk fall, dawn relief, death. Stems may be
   sourced CC0 or offline-rendered from your own synthesis into buffers; either
   way they must loop seamlessly. Restraint is the aesthetic: silence is the
   default state, and the calm layer should be felt more than heard.
6. **Detail passes:** player breathing that scales with stamina drain and low
   health; gear rustle when sprinting; positional container-search rummage at
   the container (not on the player); barricade impacts from the wood's
   position; distant one-shots preserved but sample-based.

# CONSTRAINTS

- No call-site changes outside AudioSys (footstep timing hooks may touch the
  animation controller only if prompt 01 already installed one).
- Total committed audio ≤ 25 MB. Mono for spatialized SFX, stereo for beds.
- No clipping ever: verify the master compressor holds a worst case (gunshot +
  scream + music peak simultaneously).

# QUALITY BAR

Two minutes of normal play — walk, search, one fight, dusk transition — should
sound like a produced survival-horror game: mixed, spatial, dynamic, restrained.

# SELF-TEST (do not skip)

`?headless`: script a run across every surface, a melee fight, a gunshot, a
door slam, indoor/outdoor transitions, and a threat ramp; assert no exceptions,
voice counts within cap, bus gain values sane, and buffers loaded (log a
manifest). Add a dev audio-debug overlay (voice count, bus meters) toggled by a
key. Then listen yourself in a headed session before calling it done.

# FINAL REPORT

What you built · sample manifest + licenses · bus/ducking diagram · music
system behavior · fallback behavior verified · known issues.
