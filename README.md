# AFTER — Day One

A 3D zombie-apocalypse survival vertical slice. Third-person, browser-based,
built on three.js. The world — geometry, textures, sound — is generated
procedurally at runtime. The only files on disk are four CC0 character models
in `public/assets/models/` (see [ATTRIBUTION.md](ATTRIBUTION.md)), and the game
falls back to hand-built procedural humanoids if they are missing, so a
checkout without them still runs.

```bash
npm install
npm run dev
```

Then open the URL it prints (default <http://127.0.0.1:5173>) and click **BEGIN**.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` | Move |
| `Shift` | Sprint (drains stamina, very loud) |
| `Space` | Jump |
| Mouse | Look · `Wheel` zoom |
| `LMB` | Attack · throw (with a bottle or a molotov in hand) |
| `RMB` | Block · aim down the sights with the revolver |
| `Double-tap` a move key, or `C` | Dodge-step — 2 m, ~20 stamina, no invulnerability |
| `V` | Shove — no damage, knocks one back 1.5 m and eats its windup |
| `R` | Reload, one chamber at a time — interruptible |
| `Ctrl` | Crouch — slow, quiet, hard to see |
| `E` | Interact · open/close doors · climb through windows · stomp something downed — **hold** to search, board, or slam |
| `F` | Torch on/off |
| `Tab` / `I` | Inventory |
| `1`–`9` | Quick-use / equip slot |
| `X` | Cycle weapon |
| `Q` | Drop selected item (inventory open) |
| `Esc` | Release cursor / close UI |

## The loop

Wake on the road at 16:24 with a bandage and half a bottle of water. Find six
supplies before the light goes, get back to the blue house in the south-west,
board the door if you found planks, and last until dawn. You can ignore all of
that and go north to the checkpoint instead — the objective line is a
suggestion, not a rail.

## Architecture

```
src/
  core/       Config (every tunable), Game (loop + state machine), Input, Utils
  world/      World (the map), Builders (prop factories), Textures (canvas art),
              Openings (doors + windows as objects), Collision (AABB + LOS),
              NavGrid (A* with dirty-region rebuilds)
  player/     Player (controller), CameraRig (third-person orbit)
  entities/   Zombie (FSM), Horde (director + groups), Particles,
              Decals (blood that stays), CharacterRig (what a character is),
              AnimationController (how it moves), CharacterAssets (skinned
              glTF path), CharacterMesh (procedural fallback + pose library)
  combat/     Combat (swing/shot/shove/finisher resolution, hit zones)
  systems/    Survival, Inventory, Items, Noise, Throwables, Fire, TimeOfDay,
              AudioSys, Objectives
  ui/         HUD (all DOM), style.css
  dev/        TestHarness, AnimShots, StealthTests, CombatTests
              (loaded only with ?headless)
tools/        gltf2glb.py — offline asset pruner/packer, not shipped
```

Systems are deliberately ignorant of each other: the player knows nothing about
zombies, zombies know nothing about items, and the HUD knows about neither. The
`Game` class is the only place they meet.

All balance numbers live in `src/core/Config.js`; loot tables and weapon stats
live in `src/systems/Items.js`. You can re-tune the whole game from those two
files without touching logic.

### Characters and animation

`Player` and `Zombie` both talk to a **`CharacterRig`**: a root `Object3D` to
position, an **`AnimationController`** to drive, a hand to hang a weapon off,
and a death with some weight to it. The rig decides once, at construction,
whether it is a skinned glTF character or the procedural humanoid — and the two
are interchangeable, so a missing model file costs fidelity and nothing else.

The controller owns the state machine (`idle · walk · run · jump · block ·
stagger · death` for the player, `idle · wander · shamble · lurch · chase ·
stagger · death` for the dead), crossfades from `CFG.anim.fade`, gait selection
and playback rate derived from real velocity, additive one-shot overlays for
attacks, footstep events fired at measured foot-plants, and distance LOD.

Combat timing stays where it was. `Items.js` declares a weapon's windup, and
the controller time-warps the attack clip so its contact frame lands exactly
there — the animation bends to the numbers, never the reverse.

### Doors, windows and stealth

Every gap in every exterior wall is an **`Opening`** (`src/world/Openings.js`):
a door or a window, in one of four states — open, closed, boarded, broken —
that owns its collision box, its meshes, the nav cells behind it, and how much
sound gets past it. The safehouse's "board the door" objective is not a special
case any more; it boards an ordinary Opening like any other.

A shut door is solid, opaque and muffling. Zombies that know you are behind one
walk to it and take it apart: `~25 s` for one of them, `~9 s` for three,
tripled if you spent planks on it. Those two numbers hold at once because
attackers stack sub-linearly (`CFG.openings.siegeCrowdExp`) — three of them get
in each other's way.

Crouch (`Ctrl`) is the other half. It costs you speed and buys a much smaller
detection radius: undetected past a watcher at **4 m in the dark**, **7 m in
daylight**, versus being spotted well beyond ten standing. Foliage and unlit
darkness halve it again. The HUD eye fills with the attention of whatever is
closest to noticing you — not the average of the street, the one that matters.

Wardrobes and beds can be climbed into. Anything that watched you get in comes
and hauls you out; anything that did not loses you entirely. Bottles and cans
make a noise somewhere you are not.

### Fighting

You are not a superhero, and combat is still a mistake you have to survive.
What the fight gives you is *choices*.

**Where you hit it.** The camera pitch picks a band: level is the body, look up
for the head (×2 and a real stagger), look down for the legs (×0.7, and it
cripples). One leg costs it 40% of its speed. The second puts it on its belly
for good — and a crawler is not a defeated zombie, it is a quiet one at ankle
height that you will walk over in the dark. The revolver does not guess: the
bullet has a height, traced from the muzzle, and over its head is a miss.

**Space, not invulnerability.** A dodge-step is two metres and about a fifth of
your stamina, with no invincibility whatsoever — dodge into a swing and you
will eat it. A shove costs more, deals nothing, and buys a metre and a half plus
whatever windup it interrupted.

**Weapons wear out.** Every melee weapon is something somebody already used and
it keeps a count: pristine, then worn, then failing, then scrap in your hands
and a beat where you have nothing. A tool roll brings one back a step. A failing
axe still beats a pristine knife, which is the whole argument.

**Consequences stay on the ground.** Kills leave blood where they happened,
heavy weapons put nearly-dead things on the floor for a stomp you have to commit
a full second to, and a molotov burns whatever is standing in it — including
you, if you are careless about where you throw it.

Balance numbers live in `CFG.combat`, `CFG.durability` and `CFG.fire`; the TTK
table they are tuned against is `CFG.combat.ttk`, and `__H.combatTests()`
measures the game against it.

### The dead, and what they want

Three ordinary archetypes and three specials, all of them rows in the
`ARCHETYPES` table in `Zombie.js`. The specials are gated on the clock so that
**day one before dusk plays exactly as it always did** — the original three and
nothing else.

| | | |
| --- | --- | --- |
| **Screamer** | tall, thin, pinned to one colour | Spots you and spends two seconds drawing breath. Let it finish and everything within 45 m knows where you are and the director takes a hard shove toward a crescendo. Kill it during the telegraph — 40 HP, and it backs away rather than closing — and nothing happens at all. |
| **Runner** | small, low, pitched forward | A night animal that moves in surges and opens a lunge at three metres. The lunge is a commitment: if you are not where it aimed, it spends more than a second on the floor in front of you. |
| **Brute** | simply much bigger | Not before the first dusk, never more than two. Goes through a raised guard, so backing off is the answer rather than blocking, and takes a boarded door apart about five times faster than a shambler. |

Each is meant to be identifiable with your eyes shut: the screamer's rising
inhale, the runner's fast dry footfalls, the brute's sub-bass footsteps that
carry through walls.

**Perception** got four upgrades that apply to everything, not just specials. A
torch beam is investigated *at the lit patch*, which means light is a tool you
can throw down an alley and a mistake you can point at your own feet. Fresh
corpses make them stop and stand, so a fight leaves a readable knot of bodies
behind it. Grouped zombies drift after a leader instead of around their own
spawn, so a pack stays a pack and can be seen coming. And a search sweeps along
the heading you were last seen taking — running in a straight line gets you
followed, and cutting sideways is what breaks the trail.

### The director

`Horde` runs an explicit three-phase machine, and pressure — which rises with
the noise you make — is its only input.

- **BUILD** — ambient spawns toward a population target, specials permitted.
- **PEAK** — crossing the pressure threshold crests the street: a converging
  wave arriving one body at a time so it reads as closing in rather than as a
  wall appearing.
- **RELAX** — a hard guarantee that **nothing new spawns**, distant audio only.

Night makes every part of that harsher except RELAX, which shortens and never
disappears. Quiet is what makes loud work.

Once a night a **migration** crosses the map: ten to fourteen bodies walking a
line chosen to stay well clear of the safehouse, going somewhere else entirely
and telegraphed twenty seconds ahead by massed groaning from that direction.
They are not looking for you. Whether they find you is about where you are
standing.

Numbers: `CFG.specials`, `CFG.director`, `CFG.migration`.

## Dev notes

Append `?headless` to the URL to load `src/dev/TestHarness.js`, which swaps
`requestAnimationFrame` for a timer (so the sim runs in a hidden tab) and
exposes `window.__H` with synthetic input, teleporting, a state dump and a
`shot()` helper that POSTs a framebuffer capture to the dev server.

For animation work the harness also has `freeze()`, `clearZombies()`,
`place(type, dx, dz)`, `stepAnim(target, state, seconds, speed)` and
`stepAttack(...)`, plus `captureAll()` — which photographs the entire
animation-state matrix into `.shots/`:

```js
await __H.captureAll({ tag: '_day', hour: 13 })
```

`__H.stealthTests()` runs the doors-and-stealth scenario suite — crouch past,
sprint past, door siege, boarded door, window vault, hiding seen and unseen, a
thrown bottle, and the full objective chain — screenshotting each into
`.shots/`.

`__H.combatTests()` runs the duel suite: every weapon against every archetype
with the TTK asserted to ±1 hit, the hit-zone multipliers, cripple → crawler,
knockdown → finisher, a machete worn from pristine to scrap and repaired, a
molotov into a crowd with the simulation cost measured, and dodge/shove.
`__H.ttk()` is just the TTK grid, for retuning one weapon quickly.

Note that both suites time themselves in *simulated* seconds and measure cost
inside `_update`/`_render` rather than as wall-clock frame deltas — a hidden
tab has its timers clamped to once a second, and frame deltas measured there
describe the browser rather than the game.

`__H.aiTests()` runs the AI suite: screamer telegraph and kill-cancel,
convergence inside 45 m, the runner's lunge recovery window, the brute's door
rate against a shambler's on the same door, block-break, torch investigation,
corpse lingering, doorway queueing, director phase cycling, migration
clearance, day-one gating, and a 60-zombie soak. `__H.director()` and
`__H.census()` dump the pacing state from the console.

Append `?debug` for the **AI overlay**, toggled with `F3`: state colour per
body, awareness and health bars, special tags and siege queue slots, a line to
where each one thinks you are, the director's phase and a rolling pressure
graph with the crescendo threshold marked. Bodies past the LOD distance draw
hollow, so the boundary is visible. It is dev-only by construction — nothing in
the shipping bundle imports it.

Append `?procedural` to ignore the character models and exercise the
procedural-humanoid fallback. Both paths must keep working.

`window.__AFTER__` is the live `Game` instance in any build.
