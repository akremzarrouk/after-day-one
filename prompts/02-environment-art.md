# ENVIRONMENT ART & SET DRESSING — production pass

You are the **Environment Art Lead** on AFTER. Your job this session: take the
hand-authored suburban block and make it read like a set-dressed production
level — while preserving the exact layout, collision behavior, and every
interactable's position. The level design is signed off; you are art-passing it.

# PROJECT CONTEXT — read this, then verify against the repo

You are working on **AFTER — Day One**, an existing, working 3D third-person
zombie-survival vertical slice in this directory.

- Stack: three.js + Vite, plain ES modules, no framework, no TypeScript.
- Run: `npm run dev` → the printed URL (click BEGIN; audio needs the click).
- Everything is currently procedural: geometry from primitives (`src/world/Builders.js`),
  canvas-painted textures (`src/world/Textures.js`), synthesized audio,
  box-skeleton characters.
- The map lives in `src/world/World.js`: hand-authored positions for a
  crossroads, three houses, a corner store + stockroom, an alley, a park with a
  survivor camp, a police checkpoint with triage tent, and a boarded safehouse.
  ~58 containers/notes are placed by hand. `Builders.js` is the prop factory;
  every builder registers both a mesh and a collision box.
- Architecture (src/): `core/` (Config, Game, Input, Utils) · `world/` (World,
  Builders, Textures, Collision = AABB + spatial hash + LOS, NavGrid = A*) ·
  `player/` · `entities/` · `combat/` · `systems/` · `ui/` (HUD — all DOM) ·
  `dev/` (TestHarness via `?headless`).
- Invariants: systems decoupled; tunables in Config.js; the game must keep
  working with **zero network access** and zero manual steps; physical light
  units (authored values × Math.PI); zombies path on a 1 m A* grid rebuilt from
  collision boxes — anything you add as solid must keep streets and doorways
  walkable.
- Dev tooling: `?headless` → `window.__H` harness with `tp`, `setHour`,
  `shot(name)` framebuffer capture. `window.__AFTER__` is the live Game.

Before writing code: read `README.md`, skim `World.js`, `Builders.js`,
`Textures.js`, `Collision.js` end to end. Trust the repo over this summary.

# MISSION

1. **Building shells get an architecture pass** in `Builders.js`: roof trims and
   fascia, gutters and downpipes, chimneys, porch posts and steps, window
   frames and sills, door frames, foundation skirts, and **interior ceilings**
   (currently hiding the roof leaves rooms open to the sky — add a ceiling
   plane per building that stays when the roof cutaway triggers).
2. **Interior décor pass:** kitchen counters get sinks and cabinet doors,
   bathrooms get fixtures, walls get picture frames / posters / clocks
   (canvas-textured), floors get rugs, ceilings get light fixtures. Every house
   should feel like people left it, not like a showroom.
3. **Streets get civil engineering:** curbs with driveway cuts, storm drains,
   manhole covers, cracked-slab variation, potholes with water, faded crosswalk
   paint at the intersection, tire marks near crashed cars.
4. **Texture upgrade:** raise key canvas textures to 512 where tiling is
   visible; add grime/edge-wear passes. You MAY attempt CC0 PBR downloads
   (PolyHaven, ambientCG) into `public/assets/textures/` with `ATTRIBUTION.md`
   — but canvas textures remain the required fallback and must stay good.
5. **Clutter systems:** a scatter factory for trash, bottles, tires, pallets,
   AC units, mailboxes, hydrants, bent street signs; power poles with catenary
   sagging wires along the main road; leaf drifts against curbs.
6. **Eight new storytelling vignettes**, each ≥3 props + a decal, several with a
   readable note (match the existing terse, no-exposition voice). Ideas: an
   overturned stroller by a stopped car; a ladder against a roof with a dropped
   duffel; a "MISSING" poster wall near the checkpoint; a half-packed car with
   its trunk open; a garden grave with a hand-painted marker.
7. **Skyline:** a distant low-poly silhouette ring outside the boundary — city
   towers, a water tower, smoke columns (slow particle plumes) — so the world
   doesn't end at the fog.

# CONSTRAINTS

- Do NOT move any container, note, spawn point, or building footprint.
- Use `InstancedMesh` for anything repeated >8 times. Draw-call budget: ≤ 400.
- After all edits, the nav grid must still route zombies through every doorway
  — verify by rebuilding and pathing test agents across the map.
- New solids must register collision through the existing Builder pattern.

# QUALITY BAR

Harness screenshots of each location at 16:30 golden hour should pass as
environment-art portfolio shots for a stylized indie title. Nothing should
read as an untextured primitive at gameplay camera distance.

# SELF-TEST (do not skip)

`?headless` tour: screenshot every named location (spawn road, store interior,
alley, park camp, checkpoint, each house interior, safehouse) at day, dusk, and
night. Verify: player walks the full loop without snagging; all 58+
interactables still reachable (iterate them, `tp` to each, confirm the prompt
appears); zombies path from park to safehouse door; draw calls and frame time
within budget via `renderer.info`.

# FINAL REPORT

What you built · before/after shot list · draw-call and frame-time numbers ·
any layout-adjacent thing you had to touch and why · known issues.
