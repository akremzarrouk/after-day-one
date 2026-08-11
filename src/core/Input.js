/**
 * Input.js — keyboard + pointer-lock mouse.
 * Exposes edge-triggered helpers (pressed/released) that the game loop
 * clears once per frame via endFrame().
 */

export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.pressedKeys = new Set();
    this.releasedKeys = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, wheel: 0 };
    this.mousePressed = { left: false, right: false };
    this.mouseReleased = { left: false, right: false };
    this.locked = false;
    this._listeners = [];
    this._onLockChange = [];

    this._bind();
  }

  _add(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push([target, type, fn]);
  }

  _bind() {
    this._add(window, 'keydown', (e) => {
      if (e.repeat) return;
      const c = e.code;
      // Stop the browser eating gameplay keys.
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c)) {
        e.preventDefault();
      }
      this.keys.add(c);
      this.pressedKeys.add(c);
    });

    this._add(window, 'keyup', (e) => {
      this.keys.delete(e.code);
      this.releasedKeys.add(e.code);
    });

    this._add(window, 'blur', () => {
      // Never leave a key stuck down when the window loses focus.
      this.keys.clear();
      this.mouse.left = this.mouse.right = false;
    });

    this._add(this.dom, 'mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.mouse.left = true;
        this.mousePressed.left = true;
      }
      if (e.button === 2) {
        this.mouse.right = true;
        this.mousePressed.right = true;
      }
    });

    this._add(window, 'mouseup', (e) => {
      if (e.button === 0) {
        this.mouse.left = false;
        this.mouseReleased.left = true;
      }
      if (e.button === 2) {
        this.mouse.right = false;
        this.mouseReleased.right = true;
      }
    });

    this._add(this.dom, 'contextmenu', (e) => e.preventDefault());

    this._add(window, 'mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    });

    this._add(window, 'wheel', (e) => {
      if (!this.locked) return;
      this.mouse.wheel += Math.sign(e.deltaY);
    }, { passive: true });

    this._add(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      for (const fn of this._onLockChange) fn(this.locked);
    });
  }

  onLockChange(fn) {
    this._onLockChange.push(fn);
  }

  requestLock() {
    if (document.pointerLockElement !== this.dom) {
      const p = this.dom.requestPointerLock?.();
      // Chrome returns a promise that rejects if the user just exited lock.
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }

  exitLock() {
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  down(code) {
    return this.keys.has(code);
  }
  pressed(code) {
    return this.pressedKeys.has(code);
  }
  released(code) {
    return this.releasedKeys.has(code);
  }

  /** Any of a list of codes held. */
  anyDown(...codes) {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  /** Movement vector in local space: x = strafe (+right), z = forward (+fwd). */
  moveAxis() {
    let x = 0,
      z = 0;
    if (this.anyDown('KeyW', 'ArrowUp')) z += 1;
    if (this.anyDown('KeyS', 'ArrowDown')) z -= 1;
    if (this.anyDown('KeyD', 'ArrowRight')) x += 1;
    if (this.anyDown('KeyA', 'ArrowLeft')) x -= 1;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    return { x, z };
  }

  consumeMouseDelta() {
    const d = { dx: this.mouse.dx, dy: this.mouse.dy };
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    return d;
  }

  endFrame() {
    this.pressedKeys.clear();
    this.releasedKeys.clear();
    this.mousePressed.left = this.mousePressed.right = false;
    this.mouseReleased.left = this.mouseReleased.right = false;
    this.mouse.wheel = 0;
  }

  dispose() {
    for (const [t, type, fn] of this._listeners) t.removeEventListener(type, fn);
    this._listeners.length = 0;
  }
}
