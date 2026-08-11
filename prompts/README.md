# AFTER — Production Plan

Twelve self-contained prompts, one per discipline of a full game production
team. Each one is a complete brief: paste the entire contents of a single file
into a **fresh Claude Code session opened in this project's root folder** and
let it run. Every prompt instructs the agent to inspect the repo first, so they
survive being run out of order — but the order below is the one that compounds
best.

## Recommended order

| # | File | Department | Why this order |
|---|------|-----------|----------------|
| 1 | `01-characters-animation.md` | Character Art & Animation | Biggest visual jump; everything else looks better on top of it |
| 2 | `02-environment-art.md` | Environment Art | Second biggest jump; independent of 1 |
| 3 | `03-lighting-vfx-post.md` | Tech Art / Lighting | Makes 1+2 read cinematic |
| 4 | `04-audio-production.md` | Audio | Transforms atmosphere; fully independent |
| 5 | `05-doors-windows-stealth.md` | Systems Design | Biggest *gameplay* gain |
| 6 | `06-combat-depth-feel.md` | Combat Design | Builds on 5's spacing tools |
| 7 | `07-ai-horde-director.md` | AI | Builds on 5 (doors) and 6 (telegraphs) |
| 8 | `08-metagame-base-building.md` | Game Direction | Turns the slice into a game; wants 5 + 7 |
| 9 | `09-ui-ux-menus.md` | UI/UX | Any time after 8 (menus expose its settings) |
| 10 | `10-save-persistence.md` | Engineering | After 8 so there's something to save |
| 11 | `11-performance-stability-qa.md` | Engineering / QA | Second-to-last: profile the real content |
| 12 | `12-release-packaging.md` | Release | Last: desktop app + shippable builds |

## How to run one

1. `git init && git add -A && git commit -m "checkpoint"` if you haven't —
   commit between every prompt so a bad session is disposable.
2. Open a fresh session in `C:\Users\Akrem\Desktop\AFTER`.
3. Paste the whole prompt file as your message. Nothing else needed.
4. When it finishes, play it yourself before moving on. The prompts demand
   self-testing, but your hands on the keyboard are the real QA.

## Ground rules baked into every prompt

- The game must always stay playable via `npm install && npm run dev`, offline,
  with zero manual steps. Asset downloads are attempted but never required —
  every prompt specifies a procedural fallback.
- All tuning stays in `src/core/Config.js` and `src/systems/Items.js`.
- Systems stay decoupled; `Game.js` remains the only meeting point.
- Only license-safe assets (CC0 / public domain: Kenney, Quaternius, PolyHaven,
  ambientCG, freesound CC0; Mixamo under its standard license), committed into
  the repo with an `ATTRIBUTION.md`.

## About leaving the browser

Prompt 12 ships a real desktop app (Tauri wrapper → .exe with an icon and an
installer) plus an itch.io-ready web build. That is the pragmatic "not in a
browser" step that keeps all twelve prompts on one codebase. A full engine port
(Godot/Unity) is a separate strategic fork — do it *after* this plan if the
polished game proves out, using the finished product as the design spec.
