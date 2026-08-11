# CHARACTER ART & ANIMATION — production pass

You are the **Lead Character Artist & Animation Programmer** on AFTER. Your job
this session: replace the box-skeleton characters with production-quality
characters and a real animation system, without breaking a single gameplay
system. When you are done, nobody should look at a screenshot and say
"programmer art."

# PROJECT CONTEXT — read this, then verify against the repo

You are working on **AFTER — Day One**, an existing, working 3D third-person
zombie-survival vertical slice in this directory.

- Stack: three.js + Vite, plain ES modules, no framework, no TypeScript.
- Run: `npm run dev` → the printed URL (click BEGIN; audio needs the click).
- Everything is currently procedural: geometry from primitives (`src/world/Builders.js`),
  canvas-painted textures (`src/world/Textures.js`), synthesized audio
  (`src/systems/AudioSys.js`), and box-skeleton characters with sine-driven
  poses (`src/entities/CharacterMesh.js`).
- Architecture (src/): `core/` (Config = every tunable, Game = loop + state
  machine, Input, Utils) · `world/` (World = hand-authored map, Builders,
  Textures, Collision = AABB + spatial hash + LOS, NavGrid = A*) · `player/`
  (Player controller, CameraRig) · `entities/` (Zombie FSM, Horde = groups +
  director, CharacterMesh, Particles) · `combat/` · `systems/` (Survival,
  Inventory, Items, Noise, TimeOfDay, AudioSys, Objectives) · `ui/` (HUD — all
  DOM) · `dev/` (TestHarness, loads only with `?headless`).
- Invariants: systems stay decoupled (Game.js is the only meeting point); all
  balance numbers live in Config.js/Items.js; the game must keep working with
  **zero network access** and zero manual steps; lights are physical units
  (authored 0–1.5 values × Math.PI).
- Dev tooling: append `?headless` to the URL → `window.__H` harness (synthetic
  input, `tp`, `setHour`, `state()`, `zstates()`) and `H.shot(name)` which
  saves a framebuffer PNG through the dev server. `window.__AFTER__` is the
  live Game in any build.

Before writing code: read `README.md`, skim every file you will touch, and
trust the repo over this summary wherever they disagree.

# MISSION

1. **Acquire real character assets if possible.** Try CC0/free sources in this
   order: Quaternius character + animation packs, Kenney character assets,
   Mixamo (standard license). Download into `public/assets/models/`, commit
   them, and record every source in `ATTRIBUTION.md`. Use GLTF/GLB only.
2. **If downloads fail or nothing fits, execute Plan B at full effort:** a
   dramatically better procedural humanoid — capsule/rounded limbs instead of
   raw boxes, necks, hands with thumbs, feet with heel/toe split, jacket/hood
   silhouettes, 8+ clothing palettes, a face hint (eye sockets, jaw) — built so
   a GLTF can later drop in with zero call-site changes.
3. **Build an AnimationController abstraction** that both the player and every
   zombie use, whichever asset path you took:
   - States: idle, walk, run, attack (per weapon class: light/heavy/shoot),
     block, stagger, death for the player; idle, wander, shamble, lurch, chase,
     attack, stagger, death for zombies.
   - Crossfade blending (0.12–0.3 s, tuned per transition, defined in Config).
   - Locomotion playback rate synced to actual velocity — no visible foot
     sliding at walk speed.
   - One-shot overlays (attack, stagger) that layer over locomotion.
   - **Combat timing stays authoritative in Config/Items** (windup + active +
     recover). Animations scale to fit those numbers, never the reverse.
   - Footstep events emitted by the controller at foot-plant, wired into the
     existing `audio.footstep` and `noise.emit` calls (replacing the timer).
4. **Zombie visual variety:** ≥6 distinct looks per archetype family (clothing,
   skin, scale jitter ±6%), and the three archetypes (shambler / stalker /
   bloated) must be identifiable by silhouette alone at 30 m at dusk.
5. **Weapons attach to the hand** (bone or anchor) and get a modeling pass:
   the bat, crowbar, knife, axe, revolver should read clearly in third person.
6. **Death gets weight:** varied fall directions, a small settle bounce, and
   corpses that persist per the existing corpse cap.

# CONSTRAINTS

- `Player.js`, `Zombie.js`, `Combat.js` gameplay logic must not change except
  where they touch posing/animation calls.
- Skinned characters must be instanced sensibly (SkeletonUtils.clone, shared
  materials where possible). Budget: 45 animated zombies + player at 60 fps on
  mid hardware. Beyond 25 m from the camera, animation may tick at reduced rate.
- The procedural fallback must remain in the tree and auto-activate if a model
  file is missing — test both paths.

# QUALITY BAR

- No T-poses, no foot-sliding at walk speed, no popping between states.
- A screenshot of three zombies chasing the player at dusk should look like a
  Steam-page screenshot from a small indie studio, not a tech demo.

# SELF-TEST (do not skip)

Use the `?headless` harness: capture screenshots of idle / walk / sprint /
attack / block / stagger / death for the player, and each zombie archetype in
each state, day and night. Run a 60-second soak with 45 zombies and confirm
frame time, zero console errors, and correct combat timings (a bat swing still
lands exactly at windup end). Play the loop yourself via the harness bot if one
exists in `dev/`.

# FINAL REPORT

What you built · asset sources + licenses · how the AnimationController works ·
what changed in existing files · measured perf numbers · known issues.
