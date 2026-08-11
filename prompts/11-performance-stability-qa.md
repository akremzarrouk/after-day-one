# PERFORMANCE, STABILITY & QA — hardening pass

You are the **Lead Engine Programmer & QA Lead** on AFTER. Your job this
session: profile the game as it now exists (after however many content prompts
have run), hit explicit frame/memory budgets, and build the automated
regression suite that keeps future work honest. This is the milestone where
the team stops adding and starts hardening.

# PROJECT CONTEXT — read this, then verify against the repo

You are working on **AFTER — Day One**, an existing, working 3D third-person
zombie-survival vertical slice in this directory.

- Stack: three.js + Vite, plain ES modules. Run: `npm run dev`, click BEGIN.
- Perf-relevant facts as originally shipped (verify current state — content
  prompts may have changed everything): shared primitive geometries; per-look
  character materials (bounded variant cache); one 2048 shadow map following
  the player; EffectComposer post chain; a pooled particle system; spatial-
  hash collision; budgeted A* queue; AI possibly LOD'd (prompt 07); known
  history: a JS-heap growth across restarts was fixed by disposing zombie
  materials + bounding the skin-texture cache — re-audit whatever exists now.
- Dev tooling: `?headless` swaps rAF for a timer (window can be hidden) and
  installs `window.__H` (`tp`, `setHour`, `state()`, `zstates()`,
  `shot(name)`); `src/dev/TestHarness.js` is dev-only; there may be a soak bot
  from earlier sessions — check `dev/`. `renderer.info` gives draw
  calls/geometries/textures.
- Invariants: zero-network; tunables in Config.js; dev-only code must never
  ship in the production bundle (`?headless` gating pattern).

Before writing code: read `README.md`, `dev/TestHarness.js`, `Game.js`'s loop,
and skim every system added since (git log if a repo exists). Measure BEFORE
optimizing — write the profiler first.

# MISSION

1. **In-game profiler overlay** (dev builds, key-toggled): frame time graph
   with script/render split, draw calls, triangles, geometries/textures
   counts, JS heap, zombie count + AI tick cost, particle count, audio voices.
   Plus `window.__H.perf()` returning the same numbers for scripts.
2. **Budgets** (put them in a `PERF_BUDGETS` doc/constant and enforce in
   tests): at 1080p medium preset — script ≤ 6 ms, render ≤ 8 ms, draw calls
   ≤ 450, JS heap stable (< 5% growth over a 10-min soak), texture/geometry
   counts flat across 20 restarts, load-to-title ≤ 5 s.
3. **Optimization pass to meet them** — likely levers (measure first):
   - InstancedMesh for every repeated prop family not yet instanced.
   - Static-geometry merging for building shells (BufferGeometryUtils).
   - Frustum-cull correctness audit (no `frustumCulled = false` except sky/
     particles); distance-based despawn of far corpses.
   - AI/animation LOD tiers verified (far zombies at reduced tick).
   - Texture audit: sizes, mipmaps, no per-instance material clones where a
     shared one serves.
   - Nav rebuild cost (if doors rebuild the grid — make it regional/throttled
     if not already).
   - GC pressure: eliminate per-frame allocations in hot paths (grep for
     `new THREE.Vector3` etc. inside update loops; use scratch objects).
4. **Stability engineering:**
   - Global error boundary: uncaught exceptions in the loop show a styled
     in-game error card (dev: with stack; prod: apologetic + reload button)
     instead of a frozen canvas; errors ring-buffered to localStorage for
     inspection.
   - WebGL context-loss handling: listen, pause, restore, rebuild.
   - Tab-visibility handling: auto-pause on hidden (audio suspends), clean
     resume, no dt spike (the clamp exists — verify).
   - Asset-load failures (if asset prompts ran): every loader falls back to
     procedural and logs a single warning — prove it by renaming a file.
5. **Automated regression suite** — `npm run test:game` (a Node script that
   launches vite + drives a headless browser via Playwright if installable;
   if not, document the manual `?headless` console recipe and ship the same
   checks as an in-page script):
   - Boot test: loads, world builds, zero console errors.
   - Gameplay smoke: spawn → move → loot a guaranteed container → fight →
     kill → take damage → use item → die → restart. Assert each transition.
   - The soak bot (extend what exists): 10 minutes autonomous play with
     stuck-detection, error counting, heap/draw-call sampling; fails on
     budget breach.
   - Determinism check: same seed → identical world layout hash (positions of
     N sampled objects).
   - Save round-trip (if prompt 10 ran).
6. **Bundle hygiene:** code-split the three.js examples/post modules if it
   meaningfully cuts initial load; verify dev-only modules are absent from
   `dist/`; `npm run build` warning-clean; document final bundle sizes.

# CONSTRAINTS

- Zero gameplay/visual regressions: capture a reference screenshot set before
  optimizing and diff after (allow only intended changes).
- Every optimization measured: report before/after numbers per change, and
  revert anything that wins < 0.3 ms at the cost of clarity.
- Playwright (if used) goes in devDependencies only; the game itself stays
  dependency-light.

# QUALITY BAR

A 10-minute autonomous soak at 60-zombie stress, on medium preset, holds every
budget with zero errors — and the regression suite fails loudly if a future
session breaks boot, combat, saving, or the frame budget.

# SELF-TEST (do not skip)

Run the full suite you built, twice (fresh boot each). Include the profiler
overlay screenshot at peak load, the before/after optimization table, the
20-restart resource-count table, and the soak log summary in your report.

# FINAL REPORT

What you built · budget table with measured results · optimization ledger
(change → ms saved) · stability features · how to run the test suite · known
issues and remaining hotspots.
