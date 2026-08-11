# RELEASE & PACKAGING — ship it

You are the **Release Engineer & Producer** on AFTER. Your job this session:
take the finished game out of the dev server and into players' hands — a real
Windows desktop app, a web build ready for itch.io, store-page assets, and a
repeatable build pipeline. This is the "not in a browser anymore" milestone.

# PROJECT CONTEXT — read this, then verify against the repo

You are working on **AFTER — Day One**, an existing, working 3D third-person
zombie-survival vertical slice (by now, likely a full multi-night survival
game) in this directory.

- Stack: three.js + Vite, plain ES modules. `npm run dev` to play;
  `npm run build` → `dist/` (self-contained, relative-base, offline-capable).
- Platform facts: Windows 11 host; Node ≥ 20 available. The game requires
  pointer lock, WebGL2, WebAudio (initialized on a user gesture), and
  localStorage (a storage adapter with a swappable backend exists if prompt 10
  ran — check `src/` for it).
- Dev-only tooling (`?headless`, TestHarness, `/__shot` endpoint) must NOT
  ship in release builds — verify the existing gating.
- Invariants: zero-network at runtime; no telemetry, no update pings — this
  ships as a fully offline game.

Before writing code: read `README.md`, `vite.config.js`, `package.json`, and
whatever settings/save/menu systems exist (their behavior gates the desktop
polish items below).

# MISSION

1. **Desktop app via Tauri v2** (preferred for size; if the environment can't
   support the Rust toolchain after a genuine attempt, fall back to Electron
   and say so):
   - `npm run desktop:dev` (live) and `npm run desktop:build` → a Windows
     installer (NSIS/MSI) and a portable .exe.
   - Window: 1600×900 default, resizable, min 1280×720, dark titlebar, F11
     true fullscreen (and default-fullscreen setting if a settings UI exists).
   - App identity: name "AFTER", proper version from package.json, and an
     **icon you generate yourself** — render a stark motif in the game's
     visual language (e.g. the boarded-door glyph / blood-red A on near-black)
     at 16→512 px, via a small Node script into `.ico`/`.png` sets. Commit the
     script, not just the output.
   - Desktop-only polish: quit confirm if unsaved progress (hook the save
     system if present), file-based storage backend for the storage adapter
     (saves in the OS app-data dir) if the adapter seam exists — otherwise
     localStorage persists fine under Tauri; document the choice.
2. **Web release for itch.io:** `npm run build:itch` → a zip of `dist/` that
   runs in itch's iframe (verify relative paths, pointer-lock and audio-
   gesture behavior inside an iframe, and a "click to focus" shield if
   needed). Include a `RELEASE_NOTES.md` template.
3. **Photo mode** (release feature, small but store-page-critical): P key →
   sim pauses, HUD hides, free camera (WASD+mouse fly, Q/E height, shift
   fast), grade presets cycle, screenshot key saves a PNG (browser download in
   web; native save dialog in desktop). Gate: not available on death screen.
4. **Store-page asset kit:** using photo mode + the harness, produce
   `marketing/` — 8 hero screenshots (1920×1080: dusk street, night torch
   fight, safehouse interior lamplight, horde approach, checkpoint, storm/fog
   if present, base fortified, dawn), a 630×500 itch cover image composited
   from a hero shot + title treatment (script it — no manual editing), and a
   `STORE_COPY.md` with short/long descriptions, feature bullets, and system
   requirements written in the game's terse voice.
5. **Pipeline & docs:** one `npm run release` that cleans, builds web + zip +
   desktop, stamps versions, and writes checksums; a `RELEASING.md` runbook
   (bump version → run → artifacts appear in `release/<version>/`); update the
   main README with player-facing install/run instructions for all three
   artifacts (dev, web zip, installer).

# CONSTRAINTS

- Runtime stays 100% offline: the desktop wrapper makes no network requests,
  requires no signing/accounts (unsigned build is fine — note the SmartScreen
  implication in RELEASING.md).
- Installer size target ≤ 30 MB (Tauri) — report the real number.
- Nothing dev-only in any release artifact: prove it (grep the bundles for
  `TestHarness`, `__shot`, `headless`).
- Do not publish anywhere. Build artifacts locally; distribution is the
  owner's decision.

# QUALITY BAR

Double-click the installer on a clean Windows machine → play the full game
offline with saves persisting, at the correct resolution, with a proper icon
in the taskbar. The itch zip uploads and runs as-is. The marketing folder
could open a store page today.

# SELF-TEST (do not skip)

Install and launch the built desktop app (actually run the .exe): verify
fullscreen toggle, save persistence across app restarts, quit-confirm, photo
mode file output, and zero console/network activity. Serve the itch zip
locally in an iframe harness and verify boot + pointer lock + audio. Run the
regression suite (prompt 11) against the release build if it exists. Include
the artifact size table and screenshots of the installed app + generated icon
in your report.

# FINAL REPORT

What you built · artifact table (name, size, how produced) · Tauri-vs-Electron
decision record · storage backend decision · marketing kit inventory · exact
release runbook · known issues.
