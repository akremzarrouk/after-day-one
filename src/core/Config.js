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
    // Real seconds per in-game hour. Night is deliberately longer to play in.
    secondsPerHour: 46,
    dawnHour: 6.2,
    duskStart: 18.4,
    duskEnd: 20.2,
    dawnStart: 5.0,
    dawnEnd: 7.0,
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
    maxActive: 46,

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
    boardHpMul: 2.0,          // boards carry 2x the door on top of it → 3x total
    windowHp: 150,
    boardPlankCost: 1,

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
