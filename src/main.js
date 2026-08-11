/**
 * AFTER — a 3D zombie-survival vertical slice.
 * Entry point: build the game, hand it the canvas, get out of the way.
 */

import './ui/style.css';
import CFG from './core/Config.js';
import { Game } from './core/Game.js';

// Automated-test hook: browsers freeze requestAnimationFrame in hidden tabs,
// which stops the loop dead. `?headless` swaps in a timer so the sim can be
// driven and captured without a visible window.
const HEADLESS = location.search.includes('headless');
if (HEADLESS) {
  const step = 1000 / 60;
  window.requestAnimationFrame = (fn) => window.setTimeout(() => fn(performance.now()), step);
}

// `?procedural` ignores the character models and runs the hand-built humanoids
// instead. The fallback has to keep working, so it has to stay easy to test.
if (location.search.includes('procedural')) CFG.anim.useModels = false;

const canvas = document.getElementById('scene');
const game = new Game(canvas);

// Expose for debugging from the console (CFG.debug.godMode, etc).
window.__AFTER__ = game;

if (HEADLESS) {
  import('./dev/TestHarness.js').then((m) => m.installHarness(game));
}

/**
 * The AI debug overlay. Dev-only by construction: nothing in the shipping
 * bundle imports it, so `?debug` is the only way it is ever downloaded.
 */
if (HEADLESS || location.search.includes('debug')) {
  import('./dev/DebugOverlay.js').then((m) => {
    game.debugOverlay = new m.DebugOverlay(game);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        game.debugOverlay.toggle();
      }
    });
  });
}

game.load().catch((err) => {
  console.error('[boot] failed to start', err);
  const t = document.getElementById('load-text');
  if (t) {
    t.textContent = 'failed to start — see console';
    t.style.color = '#a8302a';
  }
});
