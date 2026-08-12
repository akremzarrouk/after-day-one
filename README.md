# AFTER — Five Days

A 3D zombie-apocalypse survival game. Third-person, browser-based, built on
three.js. The world — geometry, textures, sound — is generated procedurally at
runtime. The only files on disk are four CC0 character models in
`public/assets/models/` (see [ATTRIBUTION.md](ATTRIBUTION.md)), and the game
falls back to hand-built procedural humanoids if they are missing, so a
checkout without them still runs.

A **run** is five days. You wake on the road on the first afternoon with a
bandage and half a bottle of water, and if it goes well you are on the back of
a truck on the fifth morning. If it does not, it ends where it ends: there is
one run and it does not come back.

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
| `E` | Interact · open/close doors · climb through windows · stomp something downed — **hold** to search, fortify, rebuild a frame, or slam |
| `G` | Lay a nailboard in the doorway you are standing in (planks + nails) |
| `B` | String a line of alarm cans where you stand (2 cans + string) |
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

Then do it four more times, and each one is worse.

## The run

```
 DAY 1   16:24 ──── 18:30 ──── 20:12 ─────────────────────── 06:00
         scavenge   DUSK       NIGHT 1  baseline. no specials.
                                        winnable with nothing.
 DAY 2   06:00 ─ 08:00 ────────────────────────────────────── 06:00
         DAWN      day                 NIGHT 2  specials return.
         grace                                  hunting parties start.
 DAY 3   ▲ director asleep             NIGHT 3  a column forms up and
         ▲ the night walks away                 walks at your shelter.
         ▲ ¼ of empty containers
         ▲ come back, thin             NIGHT 4  the grid dies. no
         ▲ the radio catches                    streetlights, and fog.
         ▲ something
 DAY 5   06:00 ──── 09:00                       NIGHT 5  everything, and
         THE CONVOY, Ridge checkpoint                     nothing to reach
         reach it and the run is over                     at the end of it.
```

**Dawn** (06:00–08:00) is the only safe part of a day. The director stops
dead — no ambient spawns, no crescendo — and everything still standing loses
the thread and walks off the map, the far ones removed first so nothing ever
vanishes in front of you. It is also when a quarter of the emptied containers
quietly come back with one thin roll in them, when the radio finds a fragment,
and when the run is written to `localStorage`.

**Sleeping** skips a night, and it is gated: you must be inside a shelter with
every door and window intact or boarded and nothing aware of you within twenty
metres. It refuses with the specific reason, and names the wall — "the north
window is still out" — because that is an instruction and "you cannot sleep
here" is a wall. A `SEALED` chip appears when nothing can walk into the
building you are standing in, so you are not counting six openings in the dark
to work out whether tonight is survivable.
And it is a fast-forward, not a skip: the director, the hunting parties and
anything chewing on your boards all keep running, so a shelter that is not
actually secure wakes you up.

**Nothing after night one can be waited out.** From night two, hunting parties
form at the edge of the map every ninety seconds already knowing which
building is yours. They are not summoned by noise and there is no way to be
quiet enough to avoid them. The numbers are `CFG.nights`, `CFG.hunt` and
`CFG.siege`, one row per night:

| night | population | speed | specials | waves | hunts | new that night |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 30 | ×1.16 | **0%** | 9 | — | — |
| 2 | 35 | ×1.20 | 35% | 10 | 1 | screamer, runner, brute |
| 3 | 41 | ×1.24 | 37% | 11 | 2 | an aimed siege at your shelter |
| 4 | 47 | ×1.29 | 44% | 12 | 2 | blackout: no streetlights, ×2.15 fog |
| 5 | 56 | ×1.35 | 49% | 13 | 3 | all of it |

(`CFG.zombie.maxActive` is 58 rather than the old 46 so the last two rows can
actually arrive — at 46 the top of the curve was silently clipped and nights
4 and 5 were the same crowd as night 3.)

Night one rolling **zero** specials is deliberate and it is the skill floor: a
player who found nothing, boarded nothing and has never seen a screamer has to
be able to win it.

## The base

Two buildings can be made yours. The blue house has five openings, the radio
and a generator in the yard; the corner store has six, two of them already
smashed out and a four-metre storefront window, and it is standing on the best
loot on the map. Sleeping somewhere, or opening its stash, claims it — and
whatever you have claimed is what the night-three siege walks toward. Claiming
the store says out loud what it costs you, because "the radio does not come
with you" is a trade and not a trap.

**Fortification** is three tiers per opening, and a broken one is not a door:
you have to rebuild the frame (2× planks) before you can board anything to it.
Holding `E` on an opening does exactly one thing, decided by what state it is
in — board it at the best tier you can afford, nail a damaged barricade back
together, or **pull the boards off**. Upgrading planks to steel is therefore
two deliberate actions rather than wood turning into metal, and there is
always a way back out of a building you sealed yourself into. Boards come off
faster than they go on, give the materials back, and are very loud.

| tier | cost | total HP on a door | one gets in | three get in |
| --- | --- | --- | --- | --- |
| bare | — | 300 | 25 s | 9 s |
| planks | 1× planks | 900 | 75 s | 28 s |
| reinforced | 1× planks + 1× tool roll | 1620 | 135 s | 50 s |
| metal sheet | 1× metal sheet | 2940 | 245 s | 91 s |

(Three attackers do `3^0.9` times what one does, not three times — they get in
each other's way. That sub-linear stack is what lets both columns hold at once,
and it is `CFG.openings.siegeCrowdExp`. A brute is 5× a shambler on the same
door, so halve those numbers again if one shows up.)

**Nailboard** (planks + nails, `G`, in a doorway): 24 damage to the legs, which
means it cripples through the ordinary rules — one leg is 40% of its speed and
the second puts it on its belly. Six uses, then it is a flat plank. It does not
kill anything and it is not supposed to: it turns a shambler in your doorway
into a crawler in your doorway.

**Alarm cans** (2× cans + string, `B`): a 6.5 m tripwire that puts a bearing on
the HUD ring for six seconds and does nothing else. Eight uses, 11 s cooldown.
The cost is that it is also a 12 m noise, so it draws them as well as
announcing them.

**The stash** is a box in each shelter — 120 kg against the 22 you can carry,
and weapons keep their condition inside it. It is why day one's glut is worth
anything at all.

**The generator** feeds two floodlights over the safehouse yard. Four minutes
per jerry can, and while it runs there is a 26 m noise event every half second
plus a steady push straight into the director's pressure meter. It also lights
the ground you would otherwise be crouching in the dark on. Measured trade:
twelve seconds of running took the pressure meter from 0 to 0.24 — a quarter of
the way to cresting the street — against zero with it off.

## The economy

Containers hold a pool of searches (`richness`) rather than a one-shot flag.
Emptied ones stay empty; at each dawn 25% of them come back with a single thin
roll, at 0.55× luck. Luck also decays across the run: 1.15, 1.0, 0.92, 0.84,
0.78.

Expected supplies available versus a day's thirst and hunger, computed from the
real loot tables by `__H.economy()` and asserted against `CFG.economy` by the
self-test:

| day | available | needed | net |
| --- | --- | --- | --- |
| 1 | 34.2 | 3 | **+31** everything is still on the shelves |
| 2 | 11.6 | 5 | +7 the restock, plus everywhere you did not reach |
| 3 | 3.7 | 5 | **−1.3** the stash starts going down |
| 4 | 3.3 | 5 | −1.7 the map is empty; you are eating yesterday |
| 5 | 3.0 | 5 | −2.0 three hours of road, or a night you cannot afford |

Day one is a week of food lying on the floor and a 22 kg pack. That gap is the
entire argument for the stash, and the reason a run is lost on day four by
somebody who spent day one fighting.

## The radio

A battery set on the shelf in the safehouse. Each dawn from day two it catches
one fragment of a group staging a convoy on the highway, and it hisses to
itself until you walk over and listen. Four fragments across days 2–5: a
signal, a place (the Ridge junction, the old police checkpoint), a time (first
light on the fifth day), and a last transmission. Never listening to it is a
legitimate and much harder run — you can still find the checkpoint, because you
have walked past the sandbags every morning.

On the fifth morning two sets of headlights come on beyond the sandbags and
idle for three hours. That is the entire extraction marker: no waypoint, no
arrow, a light on the horizon you can see from the crossroads if you are
looking north. Reach it and the run ends. Miss it and night five runs at the
"everything" curve with nothing to reach at the end of it — still survivable,
and a worse ending.

Dying deletes the save. There is one run.

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
              AudioSys, Objectives, Run (the five-day clock), Base (traps,
              stash, generator), Radio (the campaign), Save (localStorage)
  ui/         HUD (all DOM), style.css
  dev/        TestHarness, AnimShots, StealthTests, CombatTests, AITests,
              MetaTests (loaded only with ?headless)
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

`__H.metaTests()` runs the campaign suite: the per-night escalation curves
(including "night one rolls no specials", measured over 400 rolls a night),
secure-sleep gating against a broken window, an open door and an audience, the
nailboard's six triggers and its cripples, an alarm bearing pointing at the
body rather than the wire, the generator's noise-for-light trade measured on
the director's own pressure meter, the radio's four fragments in order, the
economy table checked against the real loot tables, a save/reload round trip,
a full five-day run, the extraction, and a deliberate death.

Unlike the other suites it drives `_update` at a fixed step rather than waiting
on the wall clock — a hidden tab clamps its timers to once a second, which
would put a five-day run at twelve real minutes and would make every
measurement a measurement of the browser. Fixed-step also means the numbers do
not move between machines.

`__H.run()`, `__H.economy()` and `__H.base()` dump the campaign state: where
the run is and what the night curve says, what is left in the containers and
what it is worth against a day's thirst and hunger, and what you have built
and how much of it is left.

Saves live in `localStorage` under `after.run.v1` and are written at each dawn.
`__H.game.run.day = 4` and friends are the fastest way to look at a late night
without playing three of them first.

Append `?debug` for the **AI overlay**, toggled with `F3`: state colour per
body, awareness and health bars, special tags and siege queue slots, a line to
where each one thinks you are, the director's phase and a rolling pressure
graph with the crescendo threshold marked. Bodies past the LOD distance draw
hollow, so the boundary is visible. It is dev-only by construction — nothing in
the shipping bundle imports it.

Append `?procedural` to ignore the character models and exercise the
procedural-humanoid fallback. Both paths must keep working.

`window.__AFTER__` is the live `Game` instance in any build.
