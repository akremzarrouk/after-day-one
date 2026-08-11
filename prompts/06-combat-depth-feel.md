# COMBAT DEPTH & FEEL — combat design pass

You are the **Combat Designer** on AFTER. Your job this session: keep combat
scary and stamina-bound, but give it depth, readability, and impact — the
"game feel" pass a production team would spend a milestone on. The design
pillar stands: the player is a survivor, not a superhero; every fight should
feel like a mistake that has to be survived.

# PROJECT CONTEXT — read this, then verify against the repo

You are working on **AFTER — Day One**, an existing, working 3D third-person
zombie-survival vertical slice in this directory.

- Stack: three.js + Vite, plain ES modules. Run: `npm run dev`, click BEGIN.
- Combat today: `src/combat/Combat.js` resolves arc-based melee (windup/active/
  recover from `src/systems/Items.js` WEAPONS table; multi-hit for wide arcs,
  backstab multiplier on unaware targets, scenery-clang feedback) and a hitscan
  revolver (very loud — `Horde.onGunshot` converges the map). Player
  (`src/player/Player.js`) has RMB block (stamina per hit, guard break),
  attack buffering, hit-stop, knockback. Zombies (`src/entities/Zombie.js`)
  have windup-telegraphed attacks, stagger with per-archetype resistance;
  `Horde.js` caps simultaneous attackers via attack tokens (2). Camera shake in
  `CameraRig.addShake`. Blood particles in `Particles.js`; blood *decals* exist
  only as world-authoring splats in `Builders.js`.
- Invariants: tunables in Config.js/Items.js; systems decoupled; zero-network;
  stamina economy is sacred — nothing you add may make sustained aggression
  free.
- Dev tooling: `?headless` → `window.__H` (`tp`, `attack()`, `zstates`,
  `shot`).

Before writing code: read `README.md`, `Combat.js`, the WEAPONS table,
`Player.js` attack/block code, `Zombie.js` attack state, `Horde.js` tokens.

# MISSION

1. **Mobility verbs.** Dodge-step: direction + tap (double-tap or dedicated
   key — document the choice) → a fast 2 m step, ~20 stamina, brief attack
   cancel, no i-frames (spacing is the defense, not invincibility). Shove:
   V (or RMB-tap) → no damage, knocks one zombie back 1.5 m and interrupts its
   windup, ~24 stamina — the panic button that buys space, not kills.
2. **Locational damage.** Raycast/height-band on melee + bullets: head (×2,
   big stagger), body (×1), legs (×0.7, cripple — a crippled zombie's speed
   drops 40%, permanent crawl at second cripple). Crawlers keep attacking at
   ankle height and are genuinely creepy.
3. **Knockdown + finisher.** Heavy knockback weapons (bat, sledge) at low
   target HP cause knockdown; E over a downed zombie = stomp finisher (~1 s
   commitment, instant kill, big noise). Committing to a finisher mid-group is
   a deliberate risk.
4. **Weapon durability.** Condition per weapon instance (pristine → worn →
   failing, damage ×1 / ×0.85 / ×0.65), loses condition per hit, breaks at
   zero (snap sound, item gone, brief disarm). A `tools` item repairs one
   tier. Durability numbers per weapon in Items.js — the axe breaking
   mid-horde is a feature. HUD shows condition pips on the weapon panel.
5. **Two new weapons + one throwable** in Items.js + loot tables: machete
   (fast, causes zombie bleed DoT), sledgehammer (very slow, AoE knockdown),
   molotov (equipped throwable: fire pool ~6 s, DoT + terror flee for
   non-bloated, big light + noise, hurts the player too; keep the particle/
   light budget sane).
6. **Readability & impact.** Zombie windups get a readable tell at night
   (subtle emissive eye flash on attack windup); directional damage kick on
   the camera; 60 ms micro-slow on kills; persistent blood decals projected at
   kill sites (pooled, capped ~40, oldest fades); weapon trails on heavy
   swings.
7. **Revolver pass.** RMB = proper ADS (existing camera aim path), sway that
   worsens with low stamina, chamber-by-chamber reload you can interrupt,
   loud-but-precious tuning preserved.

# CONSTRAINTS

- TTK targets on a fresh shambler (put in Config as design notes): fists ~7
  hits, knife ~6, crowbar ~4, bat ~3–4, machete ~4, axe ~2, sledge ~2,
  revolver body 2 / head 1. A player who never dodges or blocks should lose to
  3 zombies; one who uses space well should beat 3 and flee 5.
- Attack-token system stays; specials from later prompts must slot in.
- No input latency regressions: buffered inputs still feel responsive.

# QUALITY BAR

Thirty seconds of a 1v3 fight, captured on video, should look deliberate:
readable telegraphs, weighty hits, visible consequences (cripples, blood,
breakage), and a player resource story (stamina, durability, ammo) legible in
the HUD.

# SELF-TEST (do not skip)

`?headless` scripted duels: each weapon vs each archetype, assert TTK within
±1 hit of targets; cripple → crawler conversion; knockdown → finisher path;
durability lifecycle to breakage and repair; molotov burn (damage ticks, flee,
no perf collapse — measure frame time with fire up); dodge cancels an incoming
hit via spacing; shove interrupts a windup. Screenshot the new tells and
decals. Zero errors.

# FINAL REPORT

What you built · final TTK table as measured · durability numbers · new-weapon
loot placement · feel changes list · known issues.
