# METAGAME: MULTI-NIGHT SURVIVAL & BASE BUILDING — direction pass

You are the **Game Director** on AFTER. Your job this session: turn a
one-night vertical slice into a complete run-based survival campaign — days to
scavenge, nights to survive, a base to harden, and an ending to reach. This is
the prompt that makes it *a game*.

# PROJECT CONTEXT — read this, then verify against the repo

You are working on **AFTER — Day One**, an existing, working 3D third-person
zombie-survival vertical slice in this directory.

- Stack: three.js + Vite, plain ES modules. Run: `npm run dev`, click BEGIN.
- Structure today: one afternoon-to-dawn arc. `src/systems/Objectives.js` —
  gather 6 supplies → return to safehouse → survive to dawn; dawn = win screen.
  `src/systems/TimeOfDay.js` — full 24 h cycle, `timeScale` support (rest
  fast-forwards at 9×). The safehouse (`src/world/World.js`) has a boardable
  door (or a generalized Openings system if prompt 05 ran — check), a rest
  interaction, and hand-placed containers whose `used` flags never reset.
  `src/entities/Horde.js` has a director with day/night population targets
  (and possibly tension phases, if prompt 07 ran — check). `src/systems/
  Inventory.js` has `serialize()`. Loot tables in `src/systems/Items.js`.
- Invariants: tunables in Config.js; systems decoupled; zero-network; the
  minimal-HUD, low-exposition tone is a pillar — the metagame must be conveyed
  through the world (radio, notes, light) far more than through menus.
- Dev tooling: `?headless` → `window.__H` (`tp`, `setHour`, `state()`,
  `shot`); `window.__AFTER__.time.timeScale` for accelerated simulation.

Before writing code: read `README.md`, `Objectives.js`, `TimeOfDay.js`,
`Horde.js` director, the safehouse/Openings code, and `Items.js`.

# MISSION

1. **Run structure.** A run = up to 5 days. Dawn (06:00–08:00) is a grace
   phase: director sleeps, surviving night zombies disperse/despawn away from
   the player. Day = scavenge. Dusk warning at 18:30. Night = escalation:
   night N uses Config-driven curves for population, speed multiplier, and
   specials mix (if specials exist). Sleeping requires the shelter to be
   *secure* (all openings intact/boarded, no aware zombie within 20 m) and
   skips to dawn with survival-stat costs.
2. **Loot economy over days.** Containers get a `richness` pool instead of a
   one-shot flag where appropriate: emptied containers stay empty, but 25% of
   containers "restock" a thinner roll each dawn (scavengers moved through,
   rats, your own missed corners — keep it diegetic and rare). Total map
   economy must be Config-visible: a table of expected supplies per day so
   starvation pressure is tunable.
3. **Base building at the safehouse** (and make ONE alternate building
   claimable — the store, with more openings = harder but closer to loot):
   - Fortification tiers per opening: planks → reinforced (planks + tools) →
     metal sheet (rare find), HP scaling in Config.
   - **Nailboard trap** (crafted: planks+nails) damages+cripples walkers at a
     doorway; degrades with use.
   - **Alarm cans** (crafted: cans+string) — a tripwire noise alert that pings
     the HUD from the direction of the trigger. Early warning is the fantasy.
   - **Storage stash** (a chest in each claimable shelter): shared per-run
     inventory; carrying capacity finally has a base to relieve it.
   - **Generator + floodlights** for the safehouse yard: fuel-fed, huge
     visibility and comfort, and a constant noise bleed that raises ambient
     pressure while running — the classic tradeoff, make it real.
4. **Campaign spine — the radio.** A battery radio in the safehouse. Each dawn
   it catches a fragment (text + audio hiss): a group is sending a convoy along
   the highway on Day 5, morning. Final beat: reach the checkpoint at Day 5
   dawn → extraction → campaign win screen with full run stats. Dying =
   permadeath, run summary, restart. The existing single-night win becomes
   "you survived Night 1" flow into Day 2.
5. **Escalation content:** each night adds one pressure novelty via Config
   flags (N1 baseline; N2 more + first specials; N3 a migration/siege event
   targets your shelter; N4 fog + power dies (streetlights off); N5 everything,
   dawn extraction under pressure).
6. **Persistence:** integrate with the save system if present (prompt 10);
   otherwise implement a minimal localStorage snapshot (run day, time, player,
   inventory, stash, opening states, container states) sufficient to reload
   mid-run, structured so prompt 10 can formalize it.

# CONSTRAINTS

- Session shape: a full 5-day run ≈ 60–90 real minutes; each night 6–9 min.
  All pacing in Config.
- A skilled player must be able to win Night 1 with zero fortification (skill
  floor), and must NOT be able to AFK-win any night after 2 (siege events
  find passive players).
- Tone: no quest log, no map markers. The objective line + world cues only.

# QUALITY BAR

The run must generate the genre's signature arc: rich early days → thinning
supplies → a Night 4 you barely survive → a desperate Day 5 dash. Players
should lose runs to *decisions* (spent planks on the wrong door, ran the
generator too long), not to dice.

# SELF-TEST (do not skip)

`?headless` with accelerated time: simulate a full 5-day run via the bot/
scripts — assert escalation numbers per night, secure-sleep gating (refuses
when an opening is broken), trap trigger + degradation, stash persistence
across a reload, generator noise raising pressure, radio fragment sequence,
Day-5 extraction win, and permadeath summary on a deliberate death. Screenshot
each dawn and the extraction. Zero errors.

# FINAL REPORT

What you built · run-structure diagram · economy table (supplies per day vs
need) · fortification/trap numbers · what the campaign beats are · known
issues.
