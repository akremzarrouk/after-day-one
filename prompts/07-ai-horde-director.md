# ADVANCED AI & HORDE DIRECTOR — AI pass

You are the **AI Lead** on AFTER. Your job this session: special infected,
smarter perception, and a pacing director worthy of the genre — the systems
that make players tell stories about what the horde *did*, not just what it
was. The existing FSM is solid; you are extending it, not rewriting it.

# PROJECT CONTEXT — read this, then verify against the repo

You are working on **AFTER — Day One**, an existing, working 3D third-person
zombie-survival vertical slice in this directory.

- Stack: three.js + Vite, plain ES modules. Run: `npm run dev`, click BEGIN.
- AI today: `src/entities/Zombie.js` — FSM (idle/wander/investigate/chase/
  attack/search/stagger/dead), two-channel perception (sight cone + LOS with a
  gradual awareness meter; hearing gives position, not lock), three archetypes
  (shambler/stalker/bloated) in an ARCHETYPES table, direct steering with
  separation + A* fallback (`src/world/NavGrid.js`, budgeted + queued).
  `src/entities/Horde.js` — spatial grid, group alert cascades (a spotter
  screams; group-mates commit harder), gunshot convergence, attack tokens (max
  2 simultaneous attackers), corpse cap, a simple director (ambient spawns
  off-screen by day/night population targets + a noise "pressure" meter).
  `src/systems/Noise.js` — radius events. Night multiplies speed/aggression.
- Invariants: tunables in Config.js; archetypes stay data-driven; zero-network;
  perf budget — the game already runs 45+ zombies, and your additions must too.
- Dev tooling: `?headless` → `window.__H` (`tp`, `setHour`, `zstates()`
  histogram, `nearestZombie()`, `shot`).

Before writing code: read `README.md`, then `Zombie.js`, `Horde.js`,
`NavGrid.js`, `Noise.js` in full. If doors/openings exist (prompt 05 ran),
read that system too and integrate with it; if not, note it and proceed.

# MISSION

1. **Three specials** as new ARCHETYPES entries + minimal special-case logic:
   - **Screamer** — frail (40 HP), avoids melee, and on spotting the player
     does a 2 s telegraphed scream that alerts everything within 45 m and
     raises director pressure hard. Priority-target design: killing it during
     the telegraph cancels the scream. Distinct silhouette (thin, head thrown
     back) and a pre-scream inhale sound cue.
   - **Runner** — night-biased spawns, ~1.6× stalker speed in bursts, a 3 m
     lunge attack with a long recovery you can punish; low HP. The jump-scare
     archetype; give it sprinting footsteps you hear before you see it.
   - **Brute** — rare, 500+ HP, high stagger resist, smashes doors/barricades
     at 5× rate, slow wide swipe that hits through blocks (block-break). Heavy
     footfall audio at range; never spawns before the first dusk.
2. **Perception upgrades for everyone:** investigate visible light (a torch
   beam crossing a zombie's cone draws investigation to the lit spot, not to
   the player); linger near fresh corpses; leader–follower drift in wander for
   grouped zombies (groups amble together, which makes them readable and
   avoidable); search behavior sweeps *toward* last-seen heading rather than
   pure random casting.
3. **Director 2.0** in Horde: an explicit tension-phase machine —
   BUILD (ambient spawns, specials allowed per rules) → PEAK (a triggered
   crescendo: converging spawn wave when pressure crosses threshold) →
   RELAX (guaranteed quiet window, no new spawns, distant-audio only). Phase
   timings/counts in Config. Night shifts the curve, never deletes RELAX —
   quiet is what makes loud work.
4. **A wandering migration event:** once per night, a loose horde of 10–14
   crosses the map on a path that avoids the safehouse; pure spectacle and
   threat-avoidance gameplay — hide or reroute. Telegraphed by building audio
   (mass groans from a direction) 20 s before arrival.
5. **Crowd quality:** local avoidance so zombies don't stack in doorways
   (offset queueing at openings); AI LOD — beyond 30 m from the player,
   zombies tick perception at 5 Hz and skip separation; cap simultaneous A*
   consumers (queue exists — enforce fairness).
6. **Debug tooling:** a dev overlay (key-toggled, dev builds only) drawing
   zombie state colors, awareness bars, director phase + pressure graph, and
   spawn events — you and later sessions will need it.

# CONSTRAINTS

- Specials appear in the spawn tables data-driven, gated by time/night/phase in
  Config. Base-game pacing without specials must remain intact at DAY one.
- 60-zombie stress test must hold frame budget with AI LOD active.
- Screamer/Runner/Brute must each be identifiable by silhouette AND by sound
  alone (reuse/extend AudioSys archetype hooks).

# QUALITY BAR

A blind player should know which special is near. A watching player should see
the horde behave like a system with moods — pressure building, cresting,
releasing — not a faucet of enemies.

# SELF-TEST (do not skip)

`?headless` scenarios with assertions: screamer telegraph → kill-cancel works
and un-killed scream converges N zombies; runner lunge is punishable
(post-lunge recovery window measured); brute breaks a boarded door ≥4× faster
than a shambler; torch-beam investigation goes to the lit point; migration
event path avoids the safehouse and can be evaded unseen; director phases
cycle with RELAX windows present at night; 60-zombie soak frame time. Capture
the debug overlay in screenshots. Zero errors.

# FINAL REPORT

What you built · special stat blocks · director phase parameters · perception
changes · stress-test numbers · known issues.
