# DOORS, WINDOWS & STEALTH — systems design pass

You are the **Senior Systems Designer** on AFTER. Your job this session: give
the game its hide-or-fight decision layer — physical doors, boardable openings,
crouch stealth, hiding, and distractions. This is the highest-value gameplay
work in the whole plan; the fantasy of the game is "something is outside and
the door is all I have."

# PROJECT CONTEXT — read this, then verify against the repo

You are working on **AFTER — Day One**, an existing, working 3D third-person
zombie-survival vertical slice in this directory.

- Stack: three.js + Vite, plain ES modules. Run: `npm run dev`, click BEGIN.
- Relevant systems today: `src/world/Collision.js` (AABB boxes with `solid`,
  `opaque`, `enabled` flags in a spatial hash — boxes can be toggled at
  runtime); `src/world/NavGrid.js` (1 m A*, rebuilt via `nav.build(collision)`
  — currently a full-grid rebuild, called when the safehouse barricade
  changes); `src/world/World.js` (buildings have door/window gaps authored in
  specs; the safehouse has a one-off barricade system with HP that zombies
  attack — generalize it, don't duplicate it); `src/systems/Noise.js` (noise
  events with radius; zombies hear via `strongestAt`); `src/entities/Zombie.js`
  (FSM: idle/wander/investigate/chase/attack/search/stagger/dead, two-channel
  perception: sight cone + LOS with a gradual awareness meter — sprinting and
  light raise it, stillness lowers it); `src/entities/Horde.js` (groups, alert
  cascades, attack tokens, director).
- Invariants: tunables in Config.js; systems decoupled; zero-network operation;
  zombies must always have *some* route to a player they know about — a fully
  sealed player should mean "they besiege the openings," never "AI breaks."
- Dev tooling: `?headless` → `window.__H` (`tp`, `setHour`, `zstates`,
  `shot`). `window.__AFTER__` is the live Game.

Before writing code: read `README.md`, then `World.js` (building specs + the
safehouse barricade), `Collision.js`, `NavGrid.js`, `Zombie.js`, `Noise.js` in
full.

# MISSION

1. **Openings registry.** Refactor building door/window gaps into first-class
   `Opening` objects the world tracks: position, type (door/window), state
   (open/closed/boarded/broken), owning building. The safehouse barricade
   becomes the first consumer of this system, not a special case.
2. **Physical doors** on every exterior doorway: hinged mesh, E to open/close
   (with a swing animation over ~0.4 s), closed doors are solid + opaque +
   sound-attenuating. Optional slam (hold E) — faster, loud noise event.
   Zombies that know you're behind a door bang on it (HP per door, splinter
   visuals at thresholds, break-through burst). Creak/slam/bang wired to
   AudioSys.
3. **Boarding anywhere:** planks + hold-E boards any door or window (uses the
   existing barricade interaction pattern). Boards add HP on top of the door.
   Nav grid updates on every state change — make rebuilds affordable
   (dirty-region rebuild around the opening, or throttle; measure it).
4. **Window vaulting:** E at a window sill vaults through (~0.7 s commitment,
   noise event). Zombies cannot vault; broken/boarded states gate it.
5. **Crouch stealth:** Ctrl toggles crouch — speed ~1.5 m/s, footstep noise
   radius 2 m, awareness gain ×0.5, camera lowers. Concealment: crouched in
   bushes or deep night shadow (no nearby active light) halves sight range
   against you. HUD shows a stealth eye that fills with the *highest* current
   awareness of any zombie — the player must be able to feel "I'm about to be
   seen."
6. **Hiding spots:** wardrobes/under-bed markers in houses. Enter to hide
   (camera goes interior-peek), zombies that didn't see you enter lose you;
   ones that did will search adjacent and can drag you out (heavy damage) —
   hiding is strong, not free.
7. **Distractions:** bottles/cans as inventory items; equipping one turns LMB
   into an arc throw (simple ballistic, landing spawns a loud noise event +
   glass sound). Loot tables updated so bottles are common.
8. **Zombie behavior integration:** investigate doors left open; besiege and
   break boarded openings when aware; enter through broken windows; remember
   the opening they last saw you use. Wall/door occlusion factored into
   hearing (attenuate noise radius through closed solids).

# CONSTRAINTS

- Balance targets (put in Config): unboarded door survives one zombie ~25 s,
  three zombies ~9 s; boarded ×3; crouched undetected pass distance ≥ 4 m in
  darkness, ≥ 7 m in daylight; a thrown bottle pulls zombies within 18 m.
- The Objectives flow (gather → return → survive) must still complete; the
  safehouse "board the door" beat now uses the general system.
- Frame budget: opening-state nav updates must never hitch (> 4 ms).

# QUALITY BAR

A player should be able to tell this story: "I heard them coming, killed the
lantern, crouched behind the counter, and watched one walk past the window.
Then I slipped out the back door and closed it behind me." Every beat of that
sentence must be real mechanics.

# SELF-TEST (do not skip)

Script with `?headless`: (a) sneak crouched past 3 wanderers at 5 m — no chase;
(b) sprint the same path — chase; (c) close a door mid-chase, verify banging,
HP decay, break-through; (d) board it, verify ×3 time; (e) vault a window to
escape; (f) hide in a wardrobe unseen — searchers give up; seen — dragged out;
(g) throw a bottle, verify group investigates it; (h) full objective loop still
completable. Screenshot each scenario; zero errors across all runs.

# FINAL REPORT

What you built · the Opening model · balance numbers as shipped · nav rebuild
cost measured · AI behavior changes · known issues.
