# SAVE SYSTEM & PERSISTENCE — engineering pass

You are the **Senior Gameplay Engineer** on AFTER, owning persistence. Your job
this session: a robust, versioned save system — slots, autosave, settings
separation, and run-history stats — engineered so future content prompts can
extend the schema without breaking old saves.

# PROJECT CONTEXT — read this, then verify against the repo

You are working on **AFTER — Day One**, an existing, working 3D third-person
zombie-survival vertical slice in this directory.

- Stack: three.js + Vite, plain ES modules. Run: `npm run dev`, click BEGIN.
- State that exists today (verify — later prompts may have added more):
  player (position, vitals, flashlight battery, revolver chamber), inventory
  (`Inventory.serialize()` exists), world interactables (`used` flags, notes
  read), safehouse barricade or a generalized Openings system (states + HP),
  time (`hour`, `day`, `elapsedHours`), objectives (goal, supplies found),
  horde (population — see policy below), run stats (kills/searched/found/
  distance), and possibly: stash contents, fortification tiers, traps,
  generator fuel, radio progress (prompt 08), key rebinds + settings
  (prompts 03/04/09).
- `resetRun()` in `src/core/Game.js` is the current "new game" path — your
  load path must reach the same completeness from a snapshot instead.
- Invariants: zero-network; localStorage is the store (design the adapter so a
  desktop wrapper can swap in file I/O later — prompt 12); tunables in
  Config.js; systems stay decoupled — serialization lives beside each system
  (each exposes `serialize()`/`deserialize(data)`), composed centrally, never
  a god-object that reaches into internals.
- Dev tooling: `?headless` → `window.__H`; `window.__AFTER__` is the Game.

Before writing code: read `README.md`, `Game.js` (resetRun, state machine),
every system you'll serialize, and whatever persistence fragments earlier
prompts left (grep `localStorage`). Consolidate — don't add a second scheme.

# MISSION

1. **Schema, versioned.** A single save document: `{ version, timestamp,
   meta: {day, clock, health, playtime — for slot cards}, world, player,
   inventory, systems... }`. A `SCHEMA_VERSION` constant and a migration table
   (`migrations[fromVersion] = fn`) so old saves upgrade forward. Unknown
   future keys must round-trip untouched.
2. **Zombie persistence policy** (document it in code): individual zombies are
   NOT serialized. Persist the director's state (phase, pressure, night
   number, population targets) and respawn the world's authored spawns +
   ambient population on load, excluding a radius around the player. Corpses
   are not persisted. This is a deliberate design decision — write it down.
3. **Storage adapter:** a thin async interface (`get/set/delete/list`) with a
   localStorage implementation now (with quota-exceeded handling → oldest
   autosave eviction + a user-facing toast) and a clean seam for file-based
   storage later.
4. **Slots + autosave:** three manual slots + one rolling autosave. Autosave
   triggers: each dawn, on entering a secure shelter, and every 3 real
   minutes of play (debounced, never during combat — defer until threat = 0
   or 30 s cap). Save/load UI integrated wherever the menu system is (pause
   menu if prompt 09 ran; a minimal overlay of the same visual language if
   not). CONTINUE on the title loads the newest save.
5. **Settings separation:** settings/rebinds/hints-seen live in their own
   document, never inside run saves; loading a run never touches them.
6. **Run history:** on death or campaign win, append a compact record (days
   survived, kills, cause, distance…) to a history document; death/win screens
   show "best run" context if history exists.
7. **Integrity:** saving is atomic (write-then-swap keys); a corrupted or
   failed-migration save is quarantined (renamed, not deleted) and the UI
   offers the previous autosave; loading NEVER half-applies — validate the
   full document before mutating any live system.

# CONSTRAINTS

- Save size ≤ 200 KB typical. Save operation ≤ 16 ms (measure; serialize
  incrementally if needed).
- A loaded game must be *indistinguishable* from a continued session: same
  container states, same door/board HP, same time of day and lighting, same
  objective line, same equipped weapon and chamber count.
- No system may gain a hard dependency on the save layer (saving is observed,
  not injected).

# QUALITY BAR

Kill the tab mid-fight; reopen; CONTINUE. Within two clicks the player is back
at the last autosave with the world exactly as the schema promises — and a
save written by this version must still load after two future prompts add
fields (prove the pattern with a synthetic v-1 → v migration test).

# SELF-TEST (do not skip)

`?headless`: (a) full round-trip diff test — snapshot `state()` + a deep dump
of serializable systems, save, hard-reload the page, load, re-dump, assert
deep-equal on everything that should persist and documented-absent for
everything that shouldn't (zombies); (b) migration test with a handcrafted
older-version save; (c) corruption test (truncate the JSON) → quarantine path,
no crash; (d) quota test (mock a throwing setItem) → eviction + toast; (e)
autosave-timing test (no save during forced combat); (f) three-slot
independence. Zero errors throughout.

# FINAL REPORT

What you built · the schema (annotated) · zombie-persistence policy rationale ·
migration pattern demo · measured save/load timings · known issues.
