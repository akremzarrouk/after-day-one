/**
 * Config.js — every tunable number in the prototype lives here.
 * Keeping this in one place makes the slice easy to re-balance without
 * hunting through systems.
 */

export const CFG = {
  world: {
    size: 150,          // playable square, metres
    cell: 1.0,          // nav grid cell size
    boundaryFade: 12,   // fog wall thickness at the edge
  },

  player: {
    radius: 0.38,
    height: 1.78,
    eyeHeight: 1.62,
    walkSpeed: 3.05,
    sprintSpeed: 6.0,
    crouchSpeed: 1.55,
    backMul: 0.62,
    strafeMul: 0.85,
    accel: 34,
    airAccel: 6,
    friction: 11,
    jumpVel: 5.0,
    gravity: -19.6,
    maxHealth: 100,
    maxStamina: 100,
    sprintDrain: 17,      // per second
    jumpCost: 12,
    attackCost: 14,
    blockCostPerHit: 22,
    staminaRegen: 15,     // per second when idle-ish
    staminaRegenDelay: 0.9,
    staminaExhaustLock: 28, // must reach this before sprinting again
    healthRegenThreshold: 0.0, // no passive regen — bandages only
    stepInterval: 0.52,   // seconds between footsteps at walk speed
  },

  survival: {
    // Percent lost per in-game hour. The full night is ~14 in-game hours.
    thirstPerHour: 5.6,
    hungerPerHour: 3.6,
    thirstSprintExtra: 0.9,   // extra per real second of sprinting
    hungerSprintExtra: 0.4,
    dehydratedDamage: 3.2,    // hp/min at 0 thirst
    starvingDamage: 2.1,
    lowThreshold: 25,
    staminaPenaltyAt: 30,     // below this, max stamina is scaled
  },

  time: {
    startHour: 16.4,          // late afternoon — sunset comes soon
    /**
     * Real seconds per in-game hour, and therefore the length of the whole
     * campaign. A run is 16:24 on day one to 08:00 on day five — 87.6 in-game
     * hours — so 46 s/hour puts a full five-day run at about 67 real minutes,
     * of which each night is 9.8 hours ≈ 7.5 minutes. Both numbers are the
     * session shape the metagame is designed around; move this and you move
     * the whole campaign together.
     */
    secondsPerHour: 46,
    dawnHour: 6.2,
    duskStart: 18.4,
    duskEnd: 20.2,
    dawnStart: 5.0,
    dawnEnd: 7.0,
  },

  /**
   * The run.
   *
   * Five days, each one a scavenge-and-fortify loop bracketed by a night you
   * have to live through, ending in a convoy on the highway at first light on
   * day five. The whole arc is here: what the clock does, what a night costs,
   * what sleeping requires, and where the road out is.
   */
  run: {
    days: 5,

    // ── the day's shape ──
    // DAWN is a grace phase: the director sleeps and the night's survivors
    // wander off. It is the only part of the day that is not trying to kill
    // you, and it is where every dawn beat (restock, radio, save) happens.
    dawnStart: 6.0,
    dawnEnd: 8.0,
    duskWarn: 18.5,             // "the light is going" — the day's last call
    nightStart: 20.2,

    // Dawn dispersal. Anything still standing when the sun comes up loses
    // interest and walks off the map; the far ones simply stop existing,
    // because nobody is watching them.
    disperseRate: 2.6,          // bodies removed per second, farthest first
    disperseKeepRadius: 18,     // inside this they walk away first, visibly

    /**
     * Sleeping through a night is the strongest move in the game, so it is
     * gated on the shelter actually being a shelter: every door and window
     * intact or boarded, and nothing aware of you standing outside.
     */
    sleepClearRadius: 20,
    sleepAwareness: 0.4,        // a body above this awareness inside the radius blocks it
    sleepTimeScale: 9,          // the night still runs — a siege still wakes you
    sleepThirstPerHour: 3.1,    // you dry out slower asleep, but you do dry out
    sleepHungerPerHour: 2.2,
    sleepHealPerHour: 2.4,      // and you mend a little, if you had the calories

    /**
     * Extraction. The convoy forms on the highway north of the checkpoint and
     * leaves at first light on day five. It will not wait, and there is no
     * marker for it — the radio names the place and you have walked past the
     * sandbags every day since.
     */
    extractDay: 5,
    extractFrom: 6.0,
    extractTo: 9.0,
    extractPoint: { x: 0, z: -60 },
    extractRadius: 6.5,
  },

  /**
   * Per-night escalation curves.
   *
   * One row per night, indexed from night 1. Everything the director does at
   * night is multiplied through here, so the difference between night 1 and
   * night 5 is data rather than special cases. `event` is the one pressure
   * novelty that night introduces:
   *
   *   null       nothing new — night 1 is the game as it was
   *   specials   the screamer, the runner and the brute come back
   *   siege      a column forms up and walks at *your* shelter
   *   blackout   the grid dies: streetlights off, fog closes in
   *   everything all of it, and then a run for the road at dawn
   *
   * `specials` scales the weight of every special in the ambient roll, so
   * night 1 at 0 rolls exactly the three original archetypes — which is what
   * makes a no-fortification night-1 win a matter of skill.
   */
  nights: [
    { pop: 1.00, speed: 1.00, specials: 0.0, waveBonus: 0, hunt: 0, event: null },
    { pop: 1.18, speed: 1.03, specials: 1.0, waveBonus: 1, hunt: 1, event: 'specials' },
    { pop: 1.36, speed: 1.07, specials: 1.3, waveBonus: 2, hunt: 2, event: 'siege' },
    { pop: 1.58, speed: 1.11, specials: 1.6, waveBonus: 3, hunt: 2, event: 'blackout' },
    { pop: 1.85, speed: 1.16, specials: 2.0, waveBonus: 4, hunt: 3, event: 'everything' },
  ],

  /**
   * The anti-AFK guarantee.
   *
   * From night two, a passive player is found. Every `huntInterval` seconds a
   * hunting party forms at the edge of the map already knowing where your
   * shelter is and walks to it. `hunt` in the night curve is how many parties
   * that night gets; a player who is out making noise gets them too, but they
   * are much less of a surprise when you are not asleep in the room.
   */
  hunt: {
    interval: 95,
    firstDelay: 70,
    minCount: 3,
    maxCount: 6,
    telegraph: 12,              // seconds of massed groaning before they set off
  },

  /**
   * The siege event (night three onward).
   *
   * The migration, aimed. A column crosses the map on a line that ends at
   * whichever shelter you have made yours, and when it arrives it does what
   * everything else does to a boarded door. It is telegraphed for a long time
   * because the answer is meant to be a decision — hold, or leave — and not a
   * reaction.
   */
  siege: {
    fromNight: 3,               // introduced on night three, and it never leaves
    telegraph: 26,
    minCount: 9,
    maxCount: 15,
    earliestHour: 22.0,
    spread: 7,
  },

  /**
   * The loot economy, day by day.
   *
   * The map holds a fixed number of containers, each with a `richness` pool of
   * rolls rather than a one-shot flag. Emptied containers stay empty; at each
   * dawn a quarter of them come back with one thin roll in them — scavengers
   * moved through, rats got at a shelf, you missed a corner in the dark.
   *
   * `expectedPerDay` is the design target the self-test measures the real
   * tables against: supplies (food, water, medicine — anything with a `supply`
   * value) available versus what a day actually costs. Day one is a glut on
   * purpose; by day four you are living on what the night before left behind.
   */
  economy: {
    restockChance: 0.25,        // fraction of emptied containers that come back
    restockLuck: 0.55,          // <1 biases a restocked roll toward "nothing"
    restockMax: 1,              // items a thin roll can produce
    dayOneRichness: 1,          // most containers hold exactly one search
    richContainers: 2,          // …the marked ones hold two

    /**
     * Supplies available vs. supplies burned, per day.
     *
     * `available` is what the map can *yield* that day — day one is every
     * container on it, every later day is the dawn restock plus whatever you
     * did not get to. `need` is what a day of thirst and hunger costs in
     * item-equivalents (one bottle is 42 thirst, one tin is 46 hunger, and a
     * full day drains 134 and 86 of them).
     *
     * These numbers are computed from the real loot tables by
     * `__H.economy()`, and the metagame self-test asserts this table against
     * that computation — so if you retune a table, this goes stale loudly
     * rather than quietly.
     *
     * The shape is the design: day one is seven days of food lying on the
     * floor and no way to carry it, which is what the stash is for. From day
     * three the map cannot feed you and you are living on what you hoarded.
     */
    expectedPerDay: [
      { day: 1, available: 34, need: 3, note: 'half a day, and everything is still on the shelves' },
      { day: 2, available: 12, need: 5, note: 'the restock, plus everywhere you did not reach' },
      { day: 3, available: 4, need: 5, note: 'net negative — the stash starts going down' },
      { day: 4, available: 3, need: 5, note: 'the map is empty. You are eating yesterday.' },
      { day: 5, available: 3, need: 5, note: 'three hours of road, or a night you cannot afford' },
    ],
  },

  /**
   * Base building.
   *
   * Three fortification tiers per opening, two traps, a stash and a generator.
   * The numbers are all about the same question — how many planks do you have
   * and which door do you spend them on — so the tiers are deliberately
   * expensive rather than deliberately strong.
   */
  base: {
    /**
     * Fortification tiers, in order. `hpMul` multiplies the opening's own max
     * HP to get the barricade layer's HP, so a reinforced house door carries
     * 300 × 4.4 = 1320 on top of its own 300, and a metal-sheeted one 2640.
     * Against three shamblers (~30 dps pooled) that is 25 s bare, 45 s
     * planked, 88 s reinforced and 160 s sheeted.
     */
    fortify: [
      { id: 'planks', name: 'Planks', cost: { planks: 1 }, refund: 'planks', hpMul: 2.0, time: 2.6 },
      { id: 'reinforced', name: 'Reinforced', cost: { planks: 1, tools: 1 }, refund: 'planks', hpMul: 4.4, time: 4.2 },
      { id: 'metal', name: 'Metal sheet', cost: { metal_sheet: 1 }, refund: 'metal_sheet', hpMul: 8.8, time: 5.0 },
    ],

    /**
     * Taking a barricade back off. Quicker than putting it on, far louder, and
     * it gives the materials back — a reinforced frame returns the planks but
     * not the tool roll, which is the small tax that stops board/unboard being
     * a way to store wood.
     *
     * This is not a convenience. Without it, boarding the safehouse door — the
     * thing the day-one objective explicitly tells you to do — seals the last
     * opening in a building whose four windows ship boarded, and the run ends
     * in a locked room.
     */
    unboardTime: 2.2,
    unboardNoise: 18,

    /** Boarding over a hole someone already came through costs more wood. */
    repairPlankCost: 2,
    repairTime: 4.0,

    /**
     * The nailboard. A plank with six nails through it, laid in a doorway.
     * Whatever comes through loses a leg to it — which does not kill anything,
     * but a crawler at ankle height in a doorway you know about is a very
     * different problem from a shambler in it.
     */
    nailboard: {
      craft: { planks: 1, nails: 1 },
      craftTime: 3.0,
      damage: 24,
      cripple: true,
      uses: 6,                  // it bends flat, and then it is a plank again
      rearmTime: 1.4,           // beat between triggers, so a crowd files onto it
      radius: 1.3,
      noise: 9,
    },

    /**
     * Alarm cans. String across a gap, cans hung off it. It does nothing to
     * anything — it just tells you which way to look, ten seconds before you
     * would have found out the hard way. Early warning is the whole fantasy.
     */
    alarm: {
      craft: { tin_can: 2, string: 1 },
      craftTime: 2.0,
      radius: 6.5,
      cooldown: 11,
      noise: 12,                // it is a noise: it draws them too
      uses: 8,
      pingTime: 6.0,            // seconds the HUD bearing stays up
    },

    /**
     * The generator. Fuel in, light and comfort out, and a noise floor that
     * never stops for as long as it runs. Every metre of visibility it buys
     * you is bought with the street knowing exactly where you are.
     */
    generator: {
      fuelPerCan: 240,          // seconds of run time in one fuel can
      maxFuel: 720,
      noise: 26,                // metres, emitted continuously
      noiseInterval: 0.55,
      pressure: 0.055,          // straight into the director's meter, per second
      lightIntensity: 150,
      lightRange: 34,
      startNoise: 34,           // the pull-start is much louder than the idle
    },

    /** The stash. Weight rather than slots, and far more of it than you carry. */
    stash: { maxWeight: 120, maxSlots: 40 },
  },

  /**
   * The radio.
   *
   * A battery set on the kitchen table that catches one fragment each dawn.
   * It is the only exposition in the game and it is deliberately unreliable:
   * it hisses on its own when there is something to hear, and the objective
   * line says so. Nothing about the campaign is ever explained by a menu.
   */
  radio: {
    playTime: 9.0,              // seconds a fragment takes to get out
    firstDay: 2,
    // How far the carrier wave carries lives with the sound, in AudioSys —
    // that file takes no config by design and owns every other rolloff too.
  },

  camera: {
    fov: 74,
    distance: 3.5,
    minDistance: 0.7,
    height: 1.52,
    shoulder: 0.55,
    sensitivity: 0.0023,
    pitchMin: -0.95,
    pitchMax: 0.72,
    smoothing: 18,
    aimDistance: 1.9,
    aimShoulder: 0.68,
    sprintFov: 82,
  },

  combat: {
    // Windup → active → recovery, in seconds. Slower weapons hit harder.
    playerHitStop: 0.055,
    knockbackPlayer: 4.2,
    blockDamageMul: 0.28,
    blockStaggerPush: 2.4,
    backstabMul: 1.85,

    /**
     * Where you hit it. Melee picks a band from the camera pitch — level is the
     * body, look up for the head, look down for the legs — and the revolver
     * traces a real height at the target's distance. Aiming is therefore a
     * decision you make with the mouse you are already holding, not a mode.
     */
    zoneMul: { head: 2.0, body: 1.0, legs: 0.7 },
    zonePitchHigh: 0.17,       // above this camera pitch a swing goes for the head
    zonePitchLow: -0.2,        // below this it goes for the knees
    headStaggerMul: 2.2,       // a hit to the head rattles far more than the damage says
    legStaggerMul: 0.55,

    /**
     * Cripple. One good hit to a leg takes 40% of its speed; the second puts it
     * on the floor for good. A crawler is slow and low and still perfectly
     * capable of taking your ankle off, which is the point of it.
     */
    crippleSpeedMul: 0.6,
    crawlSpeed: 0.82,
    crawlAttackRange: 1.35,
    crawlDamageMul: 0.78,
    crawlEyeHeight: 0.55,

    /**
     * Knockdown. Only weapons that carry `knockdown` can do it, and only into a
     * target already close to finished — so it reads as the blow that finally
     * put it down rather than a stun you can spam.
     */
    knockdownHpFrac: 0.42,
    knockdownTime: 3.4,
    knockdownGetUp: 1.0,       // last second of it is spent getting back up

    /**
     * The stomp. A full second where you are not moving, not blocking, and not
     * looking at the other two. Worth it, sometimes.
     */
    finisherTime: 1.0,
    finisherRange: 1.75,
    finisherNoise: 17,

    // Dodge-step: spacing is the defence. No invulnerability window at all.
    dodgeDistance: 2.0,
    dodgeTime: 0.26,
    dodgeStamina: 20,
    dodgeCooldown: 0.42,
    dodgeLockout: 0.16,        // brief no-attack window as you land
    dodgeTapWindow: 0.26,      // double-tap must land inside this
    dodgeNoise: 6,

    // Shove: no damage, buys 1.5 m and eats a windup.
    shoveDistance: 1.5,
    shovePushTime: 0.24,
    shoveStamina: 24,
    shoveRange: 1.95,
    shoveArcDeg: 110,
    shoveCooldown: 0.55,
    shoveStagger: 0.5,
    shoveNoise: 7,

    /**
     * Bleed. The machete's whole identity: it does not hit as hard as the
     * crowbar but what it opens keeps opening, so backing off after two swings
     * is a real option in a way it never is with a blunt weapon.
     */
    bleedDps: 4.6,
    bleedTime: 7.0,
    bleedMaxStacks: 3,

    /**
     * Iron sights. Radians of wobble at full stamina and at none — a rested
     * survivor can take a head at twenty metres, an exhausted one cannot hit a
     * torso at ten, and no amount of holding still fixes it.
     */
    aimSwayBase: 0.0055,
    aimSwayTired: 0.042,
    aimSwayRate: 1.75,

    // Impact.
    killSlowScale: 0.32,       // time scale during the micro-slow
    killSlowTime: 0.06,        // 60 ms
    damageKick: 0.5,           // camera punch away from whatever hit you
    maxBloodDecals: 40,        // the oldest eight fade as the pool wraps

    /**
     * TTK design notes — hits to put down a *fresh* shambler
     * (ARCHETYPES.shambler.hp, body shots, average damage roll). Individual
     * zombies roll ±15% HP, so a big one occasionally takes one more.
     *
     * Measured by `__H.combatTests()`; if you retune a weapon, re-run it.
     */
    ttk: {
      fists: 7,
      knife: 6,
      crowbar: 4,
      bat: 4,           // 3 on a good roll
      machete: 4,
      axe: 2,
      sledge: 2,
      revolverBody: 2,
      revolverHead: 1,
    },
  },

  /**
   * Weapon condition. Every melee weapon is an object someone else already
   * used, and it keeps a count. The tier multipliers are the whole design: a
   * failing axe still beats a pristine knife, so the decision is "do I spend
   * the tool roll on this or carry a spare".
   */
  durability: {
    tiers: [
      { at: 0.66, name: 'pristine', mul: 1.0 },
      { at: 0.33, name: 'worn', mul: 0.85 },
      { at: 0.0, name: 'failing', mul: 0.65 },
    ],
    wearPerHit: 1,
    wearPerClang: 1.5,        // swinging into a wall is worse for it than a skull
    // The top of each band, in order — what "repair one tier" lifts you to.
    repairTo: [1.0, 0.66, 0.33],
    disarmTime: 0.55,         // hands empty and useless right after it snaps
  },

  /**
   * Fire. Kept deliberately small: one pool is one light and a handful of
   * particles, and there is a hard cap on both, because a molotov thrown into
   * a crowd must not be the moment the frame rate dies.
   */
  fire: {
    poolTime: 6.0,
    poolRadius: 2.3,
    maxPools: 4,
    maxLights: 2,
    lightIntensity: 26,
    lightRange: 13,
    dpsZombie: 26,
    dpsPlayer: 17,
    igniteNoise: 22,
    fleeTime: 5.5,
    fleeSpeedMul: 1.25,
    fleeRadius: 7.0,          // how far from the flames terror reaches
    particlesPerSecond: 46,
  },

  zombie: {
    // Base values; archetypes scale them.
    sightRange: 21,
    sightRangeNight: 15,
    fovDeg: 128,
    peripheralRange: 7.5,     // sensed regardless of facing (very close)
    hearingRange: 26,
    investigateTime: 9.5,
    searchTime: 11,
    loseSightGrace: 2.6,
    attackRange: 1.62,
    attackWindup: 0.52,
    attackRecover: 0.85,
    attackDamage: 14,
    staggerTime: 0.42,
    wanderRadius: 14,
    repathInterval: 0.65,
    separation: 0.95,
    alertRadius: 17,          // how far a zombie's shriek carries to others
    nightSpeedMul: 1.16,
    nightAggroMul: 1.22,
    /**
     * Hard ceiling on bodies in the world.
     *
     * Night five's population target is `targetNight × 1.85` = 56, so a cap of
     * 46 would silently clip the last two nights back to the same crowd as
     * night three and quietly delete the top of the escalation curve. 58 gives
     * the curve room to actually arrive; the AI suite's soak runs 60 and holds
     * frame time, which is where the headroom number comes from.
     */
    maxActive: 58,

    /**
     * AI level of detail. Past `lodDistance` a zombie stops being something you
     * can see the details of, so it stops paying for them: perception runs at
     * `lodHz` on accumulated time and neighbour separation is skipped entirely.
     * Its state machine and movement still run every frame — a horde that
     * freezes when you look away is worse than one that costs a little.
     */
    lodDistance: 30,
    lodHz: 5,

    /** Fresh corpses are interesting. They stand over them for a while. */
    corpseInterest: 3.2,        // metres
    corpseFreshFor: 22,         // seconds after death it still draws them
    lingerTime: 4.5,
  },

  /**
   * The specials.
   *
   * Each is one entry in the ARCHETYPES table plus the smallest amount of
   * special-case logic that its idea needs, and each is gated so that day one
   * plays exactly as it did before this pass: the screamer needs the light to
   * be going, the runner is a night animal, and the brute does not exist until
   * the first dusk has happened.
   */
  specials: {
    screamer: {
      /**
       * The point of it is the two seconds. It is frail, it will not close
       * with you, and if you can reach it or shoot it before the telegraph
       * ends nothing happens at all — which makes it the first thing you look
       * for the moment you hear one inhale.
       */
      telegraph: 2.0,
      alertRadius: 45,
      pressure: 0.85,           // straight into the director's pressure meter
      cooldown: 22,
      keepDistance: 7.0,        // backs off rather than swinging
      minAwareness: 1.0,
      earliestHour: 17.6,       // late afternoon onward
      weight: 14,
    },
    runner: {
      lungeRange: 3.0,
      lungeTime: 0.32,
      lungeSpeed: 11.0,
      lungeRecover: 1.15,       // the punish window, and it is a long one
      lungeCooldown: 3.4,
      burstOn: 1.35,
      burstOff: 1.15,
      burstMul: 1.0,            // full `chase` during a burst …
      cruiseMul: 0.62,          // … and this between them
      nightOnly: true,
      weight: 26,
    },
    brute: {
      /**
       * Five times a shambler on a door. Siege damage already scales with
       * archetype damage (34/14 = 2.43×), so this is the remaining factor:
       * 2.43 × 2.1 ≈ 5.1×. Both numbers are measured by the self-test.
       */
      siegeMul: 2.1,
      blockBreak: true,
      stepNoise: 9,
      afterFirstDusk: true,
      maxAlive: 2,
      weight: 6,
    },
  },

  /**
   * The director.
   *
   * Three phases and a pressure meter. BUILD is the game as it was: ambient
   * spawns toward a population target. PEAK is a crescendo you earned by being
   * loud. RELAX is the important one — a guaranteed window with no spawns at
   * all, because a horde that never stops is a texture, and what you want is a
   * horde that has moods. Night makes the curve harsher in every direction
   * except that: RELAX shortens, it never disappears.
   */
  director: {
    buildMin: 45,               // seconds before PEAK can trigger at all
    buildMax: 150,              // …and after which it fires regardless
    peakTime: 26,
    relaxTime: 40,
    relaxTimeNight: 24,         // shorter, never zero

    peakPressure: 1.0,          // pressure needed to crest early
    pressureDecay: 0.035,       // per second in BUILD
    pressureDecayRelax: 0.22,   // bleeds fast once the wave is over
    pressureFromNoise: 0.34,    // per second at full player noise
    pressureFromKill: 0.06,

    // The crescendo itself.
    waveCount: 6,
    waveCountNight: 9,
    waveInterval: 1.6,          // seconds between arrivals, so it builds
    waveMinDist: 26,
    waveMaxDist: 44,

    // Population targets by phase, day/night.
    targetDay: 20,
    targetNight: 30,
    targetPeakBonus: 8,

    /** Specials may only enter the world during BUILD and PEAK. */
    specialsInPhases: ['build', 'peak'],
  },

  /**
   * The migration. Once a night a loose column crosses the map, going
   * somewhere else entirely. It is not aimed at you — which is exactly why it
   * is frightening, because whether it finds you is up to where you are
   * standing.
   */
  migration: {
    perNight: 1,
    minCount: 10,
    maxCount: 14,
    telegraph: 20,              // seconds of distant groaning before they arrive
    safehouseClearance: 22,     // the column's line stays this far from home
    spawnMargin: 8,             // how far outside the play area they form up
    arriveRadius: 6,            // within this of the far side they are done
    spread: 9,                  // lateral scatter of the column
    earliestHour: 20.0,
    latestHour: 4.0,
    groanInterval: 2.6,
  },

  /**
   * Characters + animation. The rig is asset-driven when the GLBs in
   * `modelPath` are present and falls back to the procedural humanoid in
   * CharacterMesh.js when they are not — both paths read these numbers.
   */
  anim: {
    useModels: true,
    modelPath: 'assets/models/',

    // Models are uniformly scaled to hit these world heights, in metres.
    playerHeight: 1.8,
    // The specials are silhouettes first: the screamer is a tall thin streak,
    // the runner is small and low, the brute is a wall.
    zombieHeight: {
      shambler: 1.74,
      stalker: 1.82,
      bloated: 1.9,
      screamer: 1.94,
      runner: 1.7,
      brute: 2.16,
    },
    scaleJitter: 0.06,          // ±6% per individual

    /**
     * Proportion pass. The source characters are stylised with very large
     * heads; shrinking the head bone and stretching the neck and thighs pulls
     * them back toward adult proportions. Free, because none of the clips
     * animate bone scale.
     */
    headScale: 0.78,
    neckStretch: 1.28,
    legStretch: 1.16,

    /**
     * Crossfade seconds, keyed `from_to`. `*` matches any state, and the
     * lookup order is exact → `from_*` → `*_to` → default.
     */
    fade: {
      default: 0.18,
      idle_walk: 0.2,
      walk_idle: 0.26,
      idle_run: 0.16,
      run_idle: 0.3,
      walk_run: 0.14,
      run_walk: 0.2,
      shamble_lurch: 0.3,
      lurch_shamble: 0.34,
      idle_shamble: 0.4,
      shamble_idle: 0.45,
      '*_stagger': 0.07,
      'stagger_*': 0.22,
      '*_attack': 0.09,
      'attack_*': 0.2,
      '*_block': 0.13,
      'block_*': 0.16,
      '*_death': 0.12,
      '*_jump': 0.09,
      'jump_*': 0.14,
      '*_fall': 0.16,
      'fall_*': 0.1,
    },

    // Locomotion playback rate = speed / clip reference speed, clamped here.
    // Reference speeds are measured from the clips themselves at load.
    // These characters are stylised and short-strided, so a 6 m/s sprint would
    // need a rate near 2.4. Capping at 2.0 trades a little slide at full
    // sprint — where the FOV kick hides it — for legs that do not blur.
    rateMin: 0.62,
    rateMax: 2.0,
    strideTrim: 1.0,            // global fudge if everything slides one way
    moveThreshold: 0.35,        // m/s below which a character is "idle"

    /**
     * Where the strike lands inside each attack clip, 0..1. Playback is time
     * warped so this frame falls exactly on the weapon's windup end — the
     * numbers in Items.js stay authoritative, the animation bends to fit.
     */
    hitFrac: {
      Slash: 0.44,
      Slash_Heavy: 0.46,
      Stab: 0.4,
      Punch: 0.46,
      Idle_Attack: 0.52,
      Run_Attack: 0.5,
      default: 0.45,
    },

    // Overlay one-shots (attack, stagger) blend additively over locomotion
    // once the character is moving faster than this; below it they play as
    // full-body clips, which is how they were authored.
    overlayAboveSpeed: 1.1,
    overlayFade: 0.08,

    /**
     * Distance LOD, metres from the camera. Past `lodDistance` the mixer is
     * stepped at `lodHz` instead of every frame; past `cullDistance` it stops
     * entirely and the character holds its last pose.
     */
    lodDistance: 25,
    lodHz: 14,
    cullDistance: 72,

    // Death: how far the body twists as it goes down, and the settle bounce
    // when it lands.
    deathFallSpread: 1.15,
    deathSettleHeight: 0.055,
    deathSettleTime: 0.34,
  },

  /**
   * Doors, windows, boarding and everything that besieges them.
   *
   * The two balance anchors: an unboarded door buys you ~25 s against one
   * zombie and ~9 s against three, and boarding triples both. Three attackers
   * do not do three times the damage — `siegeCrowdExp` models them getting in
   * each other's way, which is what lets both anchors hold at once.
   */
  openings: {
    doorHp: 300,
    doorDps: 12,              // per zombie of average strength (archetype damage 14)
    siegeCrowdExp: 0.9,       // n attackers deal n^exp times one attacker's damage
    boardHpMul: 2.0,          // fallback only; CFG.base.fortify owns the tiers
    windowHp: 150,

    swingTime: 0.42,
    slamTime: 0.15,
    slamHoldTime: 0.32,       // hold E this long on a door to slam it instead
    boardTime: 2.6,
    vaultTime: 0.7,
    breakGlassOnVault: true,

    // Zombies cannot vault. A broken window is a slow, telegraphed climb.
    climbTime: 3.0,
    siegeRange: 2.1,
    siegeMemory: 14,          // seconds a zombie remembers the opening you used

    // Noise radii, metres.
    creakNoise: 5,
    slamNoise: 20,
    bangNoise: 13,
    vaultNoise: 8,
    glassNoise: 24,
    breakNoise: 26,

    /**
     * Hearing through walls. Each closed solid surface between a sound and a
     * listener multiplies the effective radius by this. Two walls and a closed
     * door is most of the way to silence.
     */
    occlusionMul: 0.45,
    maxOcclusion: 3,
  },

  stealth: {
    crouchSpeed: 1.5,
    crouchFootstepNoise: 2.0,
    crouchAwarenessMul: 0.5,
    /**
     * Crouching is mostly a *range* effect, not a rate one. Halving how fast
     * they fill up still gets you spotted at twenty metres, because the rate
     * only ever needed a second. Shrinking how far away you register at all is
     * what produces a pass distance you can plan around: with a shambler's
     * 21 m eyes this puts daylight detection at ~6.7 m, and night plus cover
     * takes it under 2.5 m.
     */
    crouchSightMul: 0.32,
    crouchCameraDrop: 0.46,
    crouchRigSquash: 0.17,     // body shortens by this fraction when crouched

    // Concealment: crouched in cover, or crouched in darkness with no lit
    // source nearby, halves how far a zombie can pick you out.
    concealSightMul: 0.5,
    darknessLevel: 0.22,      // time-of-day light below this counts as dark
    lightProximity: 9.0,      // metres: a live light this close ruins darkness
    bushRadius: 1.5,

    // The HUD eye starts showing at this awareness and is full at 1.
    eyeFloor: 0.12,

    // Hiding.
    peekOffset: 0.52,          // how far out of the wardrobe the camera sits
    hideEnterTime: 1.0,
    hideSeenAwareness: 0.62,  // watchers above this saw where you went
    dragOutTime: 2.4,
    dragOutDamage: 34,
    searchGiveUpTime: 9.0,
  },

  throwing: {
    speed: 15.0,
    arc: 0.34,                // upward component of the throw, 0..1
    gravity: -19.6,
    landNoise: 18,
    windup: 0.22,
    recover: 0.4,
    stamina: 3,
  },

  noise: {
    // Radius in metres for each noise event type.
    footstepWalk: 5.5,
    footstepSprint: 15,
    jumpLand: 9,
    search: 7.5,
    meleeSwing: 6,
    meleeHit: 13,
    gunshot: 78,
    doorSlam: 16,
    barricade: 12,
    breakGlass: 22,
    flashlightBonus: 8,       // adds to your visual signature, not audio
  },

  loot: {
    searchTimeBase: 1.5,
    scarcityDay: 1.0,
    /**
     * Luck decays across the run. The same shelf that gave you beans on day
     * one is being searched for the fifth time by day five, and the tables do
     * not need rewriting to say so.
     */
    luckPerDay: [1.15, 1.0, 0.92, 0.84, 0.78],
  },

  /**
   * Night four: the grid finally goes.
   *
   * Streetlights die, the fog thickens, and the only lights left on the map
   * are the ones somebody is running — which is the night the generator stops
   * being a luxury and starts being a decision.
   */
  blackout: {
    fogMul: 2.15,
    fogRamp: 12,                // seconds it takes to close in
    warnAt: 21.6,               // the hour the lights go out
  },

  ui: {
    toastTime: 4.2,
  },

  debug: {
    showColliders: false,
    showPaths: false,
    godMode: false,
  },
};

export default CFG;
