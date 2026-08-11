# LIGHTING, VFX & POST-PROCESSING — cinematic pass

You are the **Lighting & Tech Art Director** on AFTER. Your job this session:
make the game read cinematic — the difference between "renders correctly" and
"looks graded by a DP." Atmosphere is this game's core pillar; this is the
session that pays it off.

# PROJECT CONTEXT — read this, then verify against the repo

You are working on **AFTER — Day One**, an existing, working 3D third-person
zombie-survival vertical slice in this directory.

- Stack: three.js + Vite, plain ES modules. Run: `npm run dev`, click BEGIN.
- Rendering today: one directional sun/moon with a tight shadow frustum
  following the player, hemisphere + ambient fill, FogExp2, a keyframed
  time-of-day palette (`src/systems/TimeOfDay.js`, physical units — authored
  0–1.5 values × Math.PI), a handful of point/spot lights (safehouse lantern,
  store fluorescent with stutter, fire barrels, checkpoint floodlight,
  4 streetlamps), and an EffectComposer with a single custom grade pass in
  `src/core/Game.js` (`GradeShader`: chromatic aberration, desaturation,
  time-of-day tint, damage push, vignette, film grain).
- Architecture (src/): `core/` (Config, Game, Input, Utils) · `world/` (World,
  Builders, Textures, Collision, NavGrid) · `player/` (Player — owns the
  flashlight spotlight, CameraRig) · `entities/` (Zombie, Horde, CharacterMesh,
  Particles — one pooled point cloud) · `combat/` · `systems/` · `ui/` (DOM
  HUD) · `dev/` (TestHarness via `?headless`).
- Invariants: zero-network operation; tunables in Config.js; decoupled systems;
  the existing GradeShader look is liked — extend it, don't discard it.
- Dev tooling: `?headless` → `window.__H` with `tp`, `setHour`, `shot(name)`.

Before writing code: read `README.md`, `TimeOfDay.js`, the GradeShader in
`Game.js`, `Particles.js`, and `World.update` (flicker/emergency lights).

# MISSION

1. **Post stack upgrade** (order matters; keep it one coherent chain):
   selective bloom (threshold tuned so only emissives, fire, and the sun bloom)
   → the existing grade pass extended with per-time-of-day filmic curves (day
   neutral-cool, dusk amber crush, night blue-steel with lifted blacks) → a
   subtle sharpen. SSAO only if you can gate it behind a quality setting and
   hold frame budget — measure before committing.
2. **Volumetric feel, faked well:** sun shafts at dawn/dusk (billboarded shaft
   sprites or a radial post blur from the sun position), soft additive cone for
   the flashlight beam with dust motes drifting inside it, light spill planes
   in windows of the lit interiors at night.
3. **Shadow quality:** tune the frustum/bias for contact-feeling shadows;
   consider a second, tighter shadow cascade near the player if budget allows;
   the safehouse lantern should cast interior shadows if affordable.
4. **Weather system** (Config-driven, default subtle): drifting fog banks
   (animate fog density with low-frequency noise, ±30% around the palette
   value), wind gusts that sway tree canopies and roll a piece of paper down
   the street, and an optional **rain mode**: streak particles, ground splash
   rings, wet-look (drop roughness on road/sidewalk materials), distant thunder
   hook into AudioSys.
5. **Particles upgrade** in the pooled system: falling leaves near trees, ash
   motes in torchlight, chimney/barrel smoke columns, breath vapor at night,
   lingering muzzle smoke.
6. **Emergency lighting:** the checkpoint cruisers' lightbars should actually
   throw alternating red/blue light pulses onto nearby surfaces (two low-range
   point lights, animated).
7. **Quality presets:** `Config.quality` = low/medium/high controlling shadow
   map size, SSAO, bloom resolution, particle density, pixel ratio cap. Add an
   automatic probe: measure average frame time over the first 5 seconds of
   play and step down if over budget. (A settings UI comes in a later prompt —
   expose this via Config + localStorage for now.)

# CONSTRAINTS

- Night must stay *playable*: after your pass, a player with no flashlight must
  still navigate by silhouette and lamplight. Verify against the current
  night screenshots — darker mood is fine, unreadable is not.
- Frame budget on medium preset: the full post chain ≤ 3 ms at 1080p on mid
  hardware. Every effect individually toggleable in Config.
- No new libraries beyond three.js examples/jsm modules already available.

# QUALITY BAR

Four harness screenshots — noon, golden hour, dusk, deep night with torch —
should look like they came from a store-page carousel: intentional palette,
readable subject, atmosphere you can feel.

# SELF-TEST (do not skip)

`?headless` capture matrix: 4 times of day × 4 locations (road, store interior,
park camp, checkpoint), plus rain-mode and torch-beam shots. Assert no black
frames, no NaN uniforms, stable frame time across a 60 s soak on each preset,
and that turning every Config toggle off returns cleanly to the base look.

# FINAL REPORT

What you built · the final post-chain order and why · preset table with
measured frame costs per effect · known issues.
