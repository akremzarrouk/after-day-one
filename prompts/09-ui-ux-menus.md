# UI/UX, MENUS & ACCESSIBILITY — interface production pass

You are the **UI/UX Director** on AFTER. Your job this session: a full
interface production pass — title, menus, settings, HUD refinement, inventory
2.0, gamepad, accessibility. The design language is already established
(sparse, monospace, blood-red accents, "the world stays visually dominant");
extend it to a complete, shippable interface. Restraint is the brand.

# PROJECT CONTEXT — read this, then verify against the repo

You are working on **AFTER — Day One**, an existing, working 3D third-person
zombie-survival vertical slice in this directory.

- Stack: three.js + Vite, plain ES modules. **All UI is DOM** — `index.html`
  holds the layers, `src/ui/style.css` the look, `src/ui/HUD.js` all logic.
  The 3D layer never renders UI; keep it that way.
- UI today: title screen (static), loading bar, death/win screens, pause hint,
  HUD (objective, clock, vitals bars, weapon panel, interact prompt +
  hold-progress, noise meter, status chips, toasts, subtitle line, off-screen
  threat wedges), a functional inventory grid with detail panel, note-reading
  overlay. Keyboard/mouse only; no settings UI (quality/audio values live in
  Config and possibly localStorage — check what prompts 03/04 left).
- Input: `src/core/Input.js` (keyboard + pointer-lock mouse, edge-triggered
  helpers). Key bindings are currently hard-coded at call sites — grep
  `input.down(`, `input.pressed(` to map them.
- Invariants: tunables in Config.js; zero-network; the world stays visually
  dominant — every addition must justify its pixels; systems decoupled (HUD
  reads a state object from Game, never reaches into systems).
- Dev tooling: `?headless` → `window.__H`; DOM is fully assertable in tests.

Before writing code: read `README.md`, `index.html`, `style.css`, `HUD.js`,
`Input.js`, and grep the key-binding call sites. Check which settings already
exist from earlier prompts and expose them rather than duplicating.

# MISSION

1. **Title screen production pass:** the menu sits over a live slow camera
   drift through the world at dusk (the game already builds the world before
   the title — use it), with the existing typography. Menu: CONTINUE (if a
   save exists), NEW RUN, SETTINGS, CREDITS. Subtle audio sting on hover.
2. **Settings screens** (from title AND a real pause menu in-game):
   - Video: quality preset (wire to Config.quality if prompt 03 ran, else
     create the plumbing), FOV slider, pixel-ratio cap, camera shake toggle,
     hide-HUD toggle.
   - Audio: per-bus sliders (master/ambience/sfx/zombies/ui/music — match
     whatever buses exist), persisted.
   - Controls: mouse sensitivity, invert Y, hold-vs-toggle for sprint/crouch/
     block, and **full key rebinding** — introduce an action-map layer in
     Input.js (actions → codes, persisted to localStorage) and migrate every
     hard-coded call site to it.
   - Accessibility (see 5).
   All persisted, all with RESET TO DEFAULTS.
3. **Pause menu:** Esc while playing → real pause (sim freeze), resume /
   settings / quit-to-title (with confirm). Pointer-lock handoff must be
   clean — no stuck-cursor states anywhere in the flow.
4. **HUD & inventory refinement:**
   - Contextual first-time hints (one line, bottom-center, shown once each,
     dismiss on action: crouch exists, hold-E to search, board the door…),
     stored in localStorage.
   - Threat/stealth indicators unified into one coherent language (wedges +
     stealth eye if prompt 05 ran).
   - Inventory 2.0: drag-and-drop between slots, hover tooltips, an equipped-
     hands slot rendered distinctly, stash-transfer view (two-panel) if a
     stash exists (prompt 08), durability pips if durability exists (06).
   - Death/win screens get a run-stats layout worthy of screenshotting.
5. **Accessibility:**
   - Subtitles for key audio events ("[groan — left]", "[glass breaking —
     behind]") with a toggle; wire to AudioSys events.
   - UI scale slider (0.8–1.4×).
   - Colorblind-safe review: vitals bars gain small icons + distinct
     luminance; verify with a deuteranopia simulation of your screenshots.
   - Reduced-flash mode: caps damage flash, lightbar strobe, fire flicker.
6. **Gamepad support** via the Gamepad API: full action-map binding (left
   stick move, right stick camera, triggers attack/block, etc.), menu
   navigation with focus states, automatic prompt-glyph switching (E ↔ Ⓧ) the
   moment a pad input is seen, back to KB/M on key press.
7. **Localization scaffold:** every user-facing string moved to one
   `strings.js` module (en baseline). Notes/world text may stay authored in
   place — flag them for later extraction instead.

# CONSTRAINTS

- Visual language: existing palette/typography only; no new fonts, no icon
  packs — glyphs are text/emoji/CSS like the current HUD.
- The HUD in normal play must not gain net visual weight: anything added must
  earn it, and hide-HUD mode must produce a clean cinematic frame.
- Zero regressions in the interaction flows (search-hold, note reading,
  inventory quick-use 1–9, X weapon cycle).

# QUALITY BAR

A stranger given the game cold should reach gameplay, rebind a key, adjust
volume, die, and start a new run without ever being confused — and a
screenshot of any menu should look like it shipped with the game, not like a
debug panel.

# SELF-TEST (do not skip)

`?headless` DOM assertions: every menu opens/closes by keyboard; a rebind
round-trip (rebind interact to F, verify it works, reset); settings persist
across reload; pause truly freezes the sim (zombie positions identical before/
after); subtitles fire on scripted sounds; UI-scale and reduced-flash apply;
hide-HUD screenshot is clean; gamepad mapping table validates (simulate via a
mock Gamepad object if no hardware). Screenshot every screen and state.

# FINAL REPORT

What you built · action-map design · settings schema · accessibility checklist
status · gamepad mapping table · known issues.
