/* Polygonia: Escape from 2-D
 * data.js - every tunable number and piece of content lives here.
 * Add a character, weapon, passive or enemy by adding an entry below.
 */
(function () {
  const PG = (window.PG = window.PG || {});

  PG.TITLE = 'Polygonia: Escape from 2-D';
  PG.WORLD_W = 7200;          // same 3.75-screen world the Python version used (1920x1080 * 3.75)
  PG.WORLD_H = 4050;
  PG.VIEW_W = 1920;           // logical view (identical to the Python game on a 1080p screen); the canvas scales to fit any window
  PG.VIEW_H = 1080;
  PG.RUN_TIME = 20 * 60;      // seconds to survive
  PG.BORDER = 40;
  PG.MAX_ENEMIES = 1400;
  PG.MAX_WEAPONS = 6;
  PG.MAX_PASSIVES = 6;
  PG.ENEMY_HP_MULT = 1.2;     // global multiplier on every enemy's health (bosses included)
  PG.ENEMY_SPEED_MULT = 1.1;  // global multiplier on every enemy's movement speed (bosses included)
  PG.MOOLAH_RATE = 0.6;       // multiplier on in-run moolah drops (0.6 = 40% fewer)
  PG.FILLER_MOOLAH = 20;      // moolah for the "nothing left to upgrade" level-up card
  PG.PIE_RATE = 0.65;         // multiplier on every random pie drop (0.65 = 35% fewer)
  // Paper Crane: each bird gets its own random bounce-turn in this range (degrees), picked once at spawn,
  // so same-direction birds don't share the exact same turn rate and trace parallel (clumped) patterns forever.
  PG.CRANE_TURN_MIN = 15 * Math.PI / 180;
  PG.CRANE_TURN_MAX = 30 * Math.PI / 180;

  /* ---------------------------------------------------------------- assets */
  PG.ASSETS = {
    title: 'Title_Screen.png', btnStart: 'Start-Button.png', btnMenu: 'Menu-Button.png', btnExit: 'Exit-Button.png',
    bg: 'paper_bg_3.png', bg2: 'paper_bg.jpg', bg3: 'paper_bg_2.jpg',
    nin1: 'Ninjircle-1.png', nin2: 'Ninjircle-2.png', nin3: 'Ninjircle-2_1.png',
    tri1: 'Tridolf-1.png', tri2: 'Tridolf-2.png', tri3: 'Tridolf-3.png',
    sqw1: 'Sqwerewolf-1.png', sqw2: 'Sqwerewolf-2.png', sqw3: 'Sqwerewolf-3.png',
    multiply: 'minion-multiply.png', positive: 'positive.png', divisive: 'divisive.png',
    square: 'shape-square.png', triangle: 'shape-triangle.png', pentagon: 'shape-pentagon.png', hexagon: 'shape-hexagon.png',
    starficer: 'starficer.png', robot: 'attack_robot_1.png', illuminawty: 'illuminawty.png',
    stopbro: 'Stop-Bro_1.png', kingtaurus: 'kingtaurus.png',
    tree: 'tree.png', bush: 'Bush2.png', cabin: 'Cabin.png',
    pie: 'pie.png', gem: 'exp-10.png', money: 'Money.png', magnet: 'paperclip-stroke.png',
    star: 'NinjaStar.png', confetti: 'WizardConfetti.png', paw: 'Paw-Attack.png',
    football: 'Football.png', crane: 'Crane.png',
    cBackpack: 'backpack-card.png', cCalk: 'Calk-card.png', spare: 'Circle-Ninja.png', cChart: 'chart-card.png', cExp: 'exp-card.png',
    cLunchbox: 'lunchbox-card.png', cMoolah: 'moolah-card.png', cNotebook: 'Notebook-card.png',
    cPencil: 'Pencil-card.png', cQuicks: 'Quicks-card.png', cRuler: 'Ruler-card.png',
    cFootball: 'football-card.png', cCrane: 'crane-card.png',
  };
  // plays only while a run is actually in progress. A list alternates: whichever one played last run picks up
  // where it left off, and each track hands off to the next one on the list when it ends.
  PG.MUSIC_RUN = ['assets/Polygonia_Theme.mp3', 'assets/Tool_Medley.mp3'];
  PG.MUSIC_MENU = null;                           // title screen / menus - drop a file in and point this at it when it's ready

  /* ------------------------------------------------------------ characters */
  // Base stats match the Python game: 100 HP, 300 speed. Each shape's identity is its starting weapon.
  PG.CHARACTERS = [
    {
      id: 'ninjircle', name: 'Ninjircle', weapon: 'ninjastars',
      blurb: 'A circle with a mission. Fast, quiet, and very pointy.',
      stand: 'nin1', move: ['nin2', 'nin3'], frameTime: 0.3,
      speed: 300, hp: 100, hurtR: 34,
    },
    {
      id: 'tridolf', name: 'Tridolf', weapon: 'confetti',
      blurb: 'A triangle wizard. Deadly AND festive.',
      stand: 'tri1', move: ['tri2', 'tri3'], frameTime: 0.4,
      speed: 300, hp: 100, hurtR: 34,
    },
    {
      id: 'sqwerewolf', name: 'Sqwerewolf', weapon: 'paws',
      blurb: 'A square with a furry problem. Keeps enemies at paw\'s length.',
      stand: 'sqw1', move: ['sqw2', 'sqw3'], frameTime: 0.4,
      speed: 300, hp: 100, hurtR: 36,
    },
  ];

  /* --------------------------------------------------------------- weapons */
  // Each weapon has a base stat block and up to 7 upgrade steps (levels 2..8).
  // `up[i].apply(stats)` is applied cumulatively; `up[i].text` is what the level-up card shows.
  PG.WEAPONS = {
    ninjastars: {
      name: 'Ninja Stars', icon: 'star', kind: 'proj', max: 8,
      desc: 'Throws stars at the nearest enemies.',
      base: { dmg: 8, cd: 0.67, count: 1, speed: 700, range: 400, pierce: 0, size: 1, spread: 5 },
      up: [
        { text: '+1 star', apply: s => { s.count += 1; } },
        { text: '+5 damage', apply: s => { s.dmg += 5; } },
        { text: 'Stars pierce +1 enemy', apply: s => { s.pierce += 1; } },
        { text: '+1 star', apply: s => { s.count += 1; } },
        { text: 'Throws 20% faster', apply: s => { s.cd *= 0.8; } },
        { text: '+6 damage, pierce +1', apply: s => { s.dmg += 6; s.pierce += 1; } },
        { text: '+2 stars', apply: s => { s.count += 2; s.dmg += 3; } },
      ],
    },
    confetti: {
      name: 'Wizard Confetti', icon: 'confetti', kind: 'proj', fan: true, max: 8,
      desc: 'A festive fan of magic paper. Fires at the nearest enemy.',
      base: { dmg: 12, cd: 1.0, count: 1, speed: 600, range: 500, pierce: 0, size: 1, spread: 26 },
      up: [
        { text: '+1 piece of confetti', apply: s => { s.count += 1; } },
        { text: '+6 damage', apply: s => { s.dmg += 6; } },
        { text: '+1 piece, pierce +1', apply: s => { s.count += 1; s.pierce += 1; } },
        { text: 'Casts 20% faster', apply: s => { s.cd *= 0.8; } },
        { text: '+1 piece, +6 damage', apply: s => { s.count += 1; s.dmg += 6; } },
        { text: 'Pierce +1, wider fan', apply: s => { s.pierce += 1; s.spread += 8; } },
        { text: '+2 pieces of confetti', apply: s => { s.count += 2; s.dmg += 4; } },
      ],
    },
    paws: {
      name: 'Squirrel Burst', icon: 'paw', kind: 'orbit', max: 8,
      desc: 'Powerful paws orbit around you for a short time.',
      // cd = pause between swings; dur = how long the paws stay out
      base: { dmg: 15, cd: 0.7, count: 1, radius: 90, dur: 3.0, spin: 4.0, size: 1 },
      up: [
        { text: '+1 paw', apply: s => { s.count += 1; } },
        { text: '+8 damage', apply: s => { s.dmg += 8; } },
        { text: 'Wider orbit, bigger paws', apply: s => { s.radius += 25; s.size += 0.2; } },
        { text: '+1 paw', apply: s => { s.count += 1; } },
        { text: 'Stays out 1s longer', apply: s => { s.dur += 1.0; s.cd *= 0.6; } },
        { text: '+10 damage, spins faster', apply: s => { s.dmg += 10; s.spin += 1.2; } },
        { text: '+2 paws', apply: s => { s.count += 2; s.radius += 15; } },
      ],
    },
  };

  /* ---------------------------------------------------------------- passives */
  // `mod(m, lvl)` writes into the player's modifier block (see Game.recalcMods).
  PG.PASSIVES = {
    quicks:   { name: 'Quicks',   icon: 'cQuicks',   max: 4, desc: 'I am speeeeeed!!!!',      lv: '+20% move speed',            mod: (m, l) => { m.move += 0.20 * l; } },
    chart:    { name: 'Chart',    icon: 'cChart',    max: 5, desc: 'Line go up.',             lv: '+12% damage',                mod: (m, l) => { m.dmg += 0.12 * l; } },
    calk:     { name: 'Calk',     icon: 'cCalk',     max: 5, desc: 'Crunching the numbers.',  lv: '-6% cooldowns',              mod: (m, l) => { m.cd -= 0.06 * l; } },
    ruler:    { name: 'Ruler',    icon: 'cRuler',    max: 5, desc: 'Measure twice, hit once.',lv: '+12% area / size',           mod: (m, l) => { m.area += 0.12 * l; } },
    pencil:   { name: 'Pencil',   icon: 'cPencil',   max: 5, desc: 'Sharpened.',              lv: '+15% projectile speed, +10% duration', mod: (m, l) => { m.pspeed += 0.15 * l; m.dur += 0.10 * l; } },
    exp:      { name: 'Exp',      icon: 'cExp',      max: 5, desc: 'Paperclips everywhere.',  lv: '+12% experience gained',     mod: (m, l) => { m.xp += 0.12 * l; } },
    backpack: { name: 'Backpack', icon: 'cBackpack', max: 5, desc: 'Room for more.',          lv: '+35% pickup range',          mod: (m, l) => { m.magnet += 0.35 * l; } },
    lunchbox: { name: 'Lunchbox', icon: 'cLunchbox', max: 5, desc: 'Packed with love.',       lv: '+20 max HP, +0.4 HP/sec regen', mod: (m, l) => { m.maxHp += 20 * l; m.regen += 0.4 * l; } },
    notebook: { name: 'Notebook', icon: 'cNotebook', max: 5, desc: 'Notes on enemy weaknesses.', lv: '-1 damage taken',        mod: (m, l) => { m.armor += 1 * l; } },
    moolah:   { name: 'Moolah',   icon: 'cMoolah',   max: 5, desc: 'Shiny green stuff.',      lv: '+25% moolah, more pies',     mod: (m, l) => { m.luck += 0.25 * l; } },
  };

  /* ------------------------------------------------------ archive: unlockable weapons */
  // Anything with a `cost` is locked until bought in The Archive (see PG.isOpen).
  Object.assign(PG.WEAPONS, {
    boomerang: {
      name: 'Paper Football', icon: 'cFootball', flyIcon: 'football', kind: 'boomer', max: 8, cost: 500,
      desc: 'A folded paper football that spirals out, then comes back. Hits going and coming.',
      base: { dmg: 10, cd: 1.15, count: 1, speed: 560, range: 360, size: 1.6 },
      up: [
        { text: '+1 football', apply: s => { s.count += 1; } },
        { text: '+6 damage', apply: s => { s.dmg += 6; } },
        { text: 'Flies farther, bigger spiral', apply: s => { s.range += 90; s.size += 0.25; } },
        { text: '+1 football', apply: s => { s.count += 1; } },
        { text: 'Throws 20% faster', apply: s => { s.cd *= 0.8; } },
        { text: '+8 damage, faster flight', apply: s => { s.dmg += 8; s.speed += 120; } },
        { text: '+2 footballs', apply: s => { s.count += 2; s.dmg += 4; } },
      ],
    },
    crane: {
      name: 'Paper Crane', icon: 'cCrane', flyIcon: 'crane', kind: 'flock', max: 8, cost: 500,
      desc: 'Paper cranes zip dead straight across a wide circle around you, bouncing to a new angle every time they reach the edge, and clipping anything they fly through.',
      base: { dmg: 9, cd: 0.45, count: 1, speed: 480, radius: 480, size: 1.15 },
      up: [
        { text: '+1 crane', apply: s => { s.count += 1; } },
        { text: '+5 damage', apply: s => { s.dmg += 5; } },
        { text: 'Wider flight circle, bigger cranes', apply: s => { s.radius += 60; s.size += 0.15; } },
        { text: '+1 crane', apply: s => { s.count += 1; } },
        { text: 'Strikes 20% more often', apply: s => { s.cd *= 0.8; } },
        { text: '+7 damage, cranes triple their speed', apply: s => { s.dmg += 7; s.speed *= 3; } },
        { text: '+2 cranes', apply: s => { s.count += 2; s.dmg += 3; } },
      ],
    },
    pieslinger: {
      name: 'Pie Slinger', icon: 'pie', kind: 'lob', max: 8, cost: 500,
      desc: 'Lobs pies that splat where the crowd is heading.',
      base: { dmg: 24, cd: 1.7, count: 1, range: 520, radius: 105 },
      up: [
        { text: '+1 pie', apply: s => { s.count += 1; } },
        { text: '+12 damage', apply: s => { s.dmg += 12; } },
        { text: 'Bigger splat', apply: s => { s.radius += 35; } },
        { text: '+1 pie', apply: s => { s.count += 1; } },
        { text: 'Slings 20% faster', apply: s => { s.cd *= 0.8; } },
        { text: '+16 damage, bigger splat', apply: s => { s.dmg += 16; s.radius += 20; } },
        { text: '+2 pies', apply: s => { s.count += 2; s.dmg += 8; } },
      ],
    },
    stopbro: {
      name: 'Stop, Bro!', icon: 'stopbro', kind: 'nova', max: 8, cost: 500,
      desc: 'A shockwave of pure "stop" that shoves the whole crowd back.',
      base: { dmg: 14, cd: 2.8, radius: 250, knock: 460, rings: 1 },
      up: [
        { text: '+10 damage', apply: s => { s.dmg += 10; } },
        { text: 'Wider shockwave', apply: s => { s.radius += 60; } },
        { text: 'Pulses 20% faster', apply: s => { s.cd *= 0.8; } },
        { text: 'A second ring follows', apply: s => { s.rings += 1; } },
        { text: '+14 damage, harder shove', apply: s => { s.dmg += 14; s.knock += 200; } },
        { text: 'Wider shockwave', apply: s => { s.radius += 80; } },
        { text: 'Pulses 25% faster, +10 damage', apply: s => { s.cd *= 0.75; s.dmg += 10; } },
      ],
    },
  });
  PG.PASSIVES.notebook.cost = 400;
  PG.PASSIVES.pencil.cost = 400;
  PG.PASSIVES.moolah.cost = 400;

  /* ------------------------------------------------------ archive: permanent perks */
  // Bought with banked moolah. Cost of the next rank = round(cost * (1 + A*rank + B*rank^2) / 5) * 5 (see PG.perkCost).
  // apply(mods, rank) runs on top of the in-run passives (see Game.recalcMods).
  PG.PERKS = [
    { id: 'might',    name: 'Chart', icon: 'cChart',    max: 10, cost: 70,  grow: 1.26, per: '+6% damage',            apply: (m, l) => { m.dmg += 0.06 * l; } },
    { id: 'vitality', name: 'Hearty Breakfast',  icon: 'cLunchbox', max: 10, cost: 60,  grow: 1.24, per: '+12 max HP',            apply: (m, l) => { m.maxHp += 12 * l; } },
    { id: 'recovery', name: 'Floor Pies',         icon: 'pie',       max: 5,  cost: 120,  grow: 1.45, per: '+0.25 HP/sec regen',    apply: (m, l) => { m.regen += 0.25 * l; } },
    { id: 'padding',  name: 'Taking Notes', icon: 'cNotebook', max: 3,  cost: 250, grow: 1.8,  per: '-1 damage taken (notes on enemy weaknesses)',       apply: (m, l) => { m.armor += l; } },
    { id: 'swift',    name: 'Quicks',     icon: 'cQuicks',   max: 5,  cost: 90,  grow: 1.38, per: '+4% move speed',        apply: (m, l) => { m.move += 0.04 * l; } },
    { id: 'haste',    name: 'Calk',         icon: 'cCalk',     max: 5,  cost: 160, grow: 1.45, per: '-3% cooldowns',         apply: (m, l) => { m.cd -= 0.03 * l; } },
    { id: 'reach',    name: 'Backpack',         icon: 'cBackpack', max: 5,  cost: 70,  grow: 1.4,  per: '+15% pickup range',     apply: (m, l) => { m.magnet += 0.15 * l; } },
    { id: 'growth',   name: 'Study Habits',      icon: 'cExp',      max: 8,  cost: 90,  grow: 1.3, per: '+5% experience',        apply: (m, l) => { m.xp += 0.05 * l; } },
    { id: 'area',     name: 'Ruler',   icon: 'cRuler',    max: 5,  cost: 130, grow: 1.42,  per: '+5% area / size',       apply: (m, l) => { m.area += 0.05 * l; } },
    { id: 'greed',    name: 'Piggy Bank',        icon: 'cMoolah',   max: 5,  cost: 90,  grow: 1.5,  per: '+10% moolah',           apply: (m, l) => { m.moolahMul += 0.10 * l; } },
    { id: 'reroll',   name: 'Keep Tabs',    icon: 'magnet',    max: 4,  cost: 220, grow: 1.6,  per: '+1 reroll of level-up cards per run', apply: (m, l) => { m.reroll += l; } },
    { id: 'revive',   name: 'Spare Shape',       icon: 'spare',     max: 2,  cost: 1200, grow: 2.0,  per: 'Come back once at half HP, with a shockwave', apply: (m, l) => { m.revive += l; } },
    { id: 'sight',    name: 'Foresight',         icon: 'illuminawty', max: 1, cost: 3500, grow: 1,   per: '+1 card on every level-up', apply: (m, l) => { m.choices += l; } },
  ];
  PG.PERK_A = 2.4; PG.PERK_B = 0.28;   // price ramp: cost(rank) = base * (1 + A*rank + B*rank^2)
  PG.perkCost = (p, rank) => Math.round(p.cost * (1 + PG.PERK_A * rank + PG.PERK_B * rank * rank) / 5) * 5;
  PG.perkById = id => PG.PERKS.find(p => p.id === id);
  // weapons / passives that must be bought in the Archive first
  PG.isOpen = (kind, id) => {
    const d = (kind === 'weapon' ? PG.WEAPONS : PG.PASSIVES)[id];
    return !d.cost || !!(PG.save.data.unlocked && PG.save.data.unlocked[kind + ':' + id]);
  };

  /* ------------------------------------------------------ options: difficulty, controls, defaults */
  // spawn/hp/dmg multiply the enemy director; reward multiplies the moolah paid at the end of a run.
  PG.DIFFICULTIES = {
    easy:      { name: 'Easy',      spawn: 0.75, hp: 0.70, dmg: 0.70, reward: 0.75 },
    normal:    { name: 'Normal',    spawn: 1.00, hp: 1.00, dmg: 1.00, reward: 1.00 },
    hard:      { name: 'Hard',      spawn: 1.20, hp: 1.20, dmg: 1.20, reward: 1.50 },
    nightmare: { name: 'Nightmare', spawn: 1.50, hp: 1.50, dmg: 1.50, reward: 2.25 },
  };
  // Rebindable actions (each has two key slots). Esc always pauses / goes back, and 1-5 always pick level-up cards.
  PG.ACTIONS = [
    { id: 'up',     name: 'Move up' },
    { id: 'down',   name: 'Move down' },
    { id: 'left',   name: 'Move left' },
    { id: 'right',  name: 'Move right' },
    { id: 'pause',  name: 'Pause' },
    { id: 'reroll', name: 'Reroll level-up cards (Keep Tabs)' },
    { id: 'mute',   name: 'Mute / unmute' },
  ];
  PG.DEFAULT_KEYS = {
    up: ['w', 'arrowup'], down: ['s', 'arrowdown'], left: ['a', 'arrowleft'], right: ['d', 'arrowright'],
    pause: ['p', ''], reroll: ['r', ''], mute: ['m', ''],
  };
  PG.DEFAULT_SETTINGS = { difficulty: 'normal', music: 0.7, sfx: 0.8, shake: 1, fps: false, autopause: true };

  /* -------------------------------------------------------------- achievements */
  // `id` is also the Steam "API Name" - create an achievement with this exact (case-sensitive) name
  // in the Steamworks App Admin for every entry here. Unlocking happens in PG.save.unlockAch(id)
  // (js/engine.js), which is called from the various hook points in js/game.js, persists locally,
  // shows a toast (js/ui.js), and - when running inside the Tauri desktop build - notifies Steam
  // through PG.steam.unlock() (js/engine.js -> the `unlock_achievement` Tauri command -> Rust).
  PG.ACHIEVEMENTS = [
    { id: 'ACH_SURVIVE_10',   name: 'Halfway There',         desc: 'Survive 10 minutes in a single run.' },
    { id: 'ACH_SURVIVE_20',   name: 'Escape from 2-D',       desc: 'Survive the full run and escape.' },
    { id: 'ACH_SURVIVE_30',   name: 'Into the Void',         desc: 'Survive 30 minutes. (Endless Mode, coming soon)' },
    { id: 'ACH_MIDBOSS',      name: 'Short Circuit',         desc: 'Defeat the mid-boss.' },
    { id: 'ACH_KINGTAURUS',   name: 'Dimension Breaker',     desc: 'Defeat Kingtaurus.' },
    { id: 'ACH_HARD',         name: 'Tough as Paper',        desc: 'Escape on Hard difficulty.' },
    { id: 'ACH_NIGHTMARE',    name: 'Nightmare Fuel',        desc: 'Escape on Nightmare difficulty.' },
    { id: 'ACH_NOHIT',        name: 'Untouchable',           desc: 'Escape without taking a single hit.' },
    { id: 'ACH_REVIVE_WIN',   name: 'Second Chance',         desc: 'Use a Spare Shape revive and still escape.' },
    { id: 'ACH_ALL_CHARS',    name: 'Shape Shifter',         desc: 'Escape with every character.' },
    { id: 'ACH_FULLY_LOADED', name: 'Fully Loaded',          desc: 'Fill every weapon and passive slot in a single run.' },
    { id: 'ACH_ARCHIVE',      name: 'The Archive, Complete', desc: 'Max every perk and unlock everything in the Archive.' },
    { id: 'ACH_HORDE500',     name: 'Horde Clearer',         desc: 'Defeat 500 enemies in a single run.' },
    { id: 'ACH_MOOLAH300',    name: 'Big Spender',           desc: 'Collect 300 moolah in a single run.' },
    { id: 'ACH_FIRST_HIT',    name: 'Ouch',                  desc: 'Take damage for the first time.' },
    { id: 'ACH_QUICK_TRIP',   name: 'Quick Trip',            desc: "Die within the first minute. We've all been there." },
  ];
  PG.achById = id => PG.ACHIEVEMENTS.find(a => a.id === id);

  /* ---------------------------------------------------------------- enemies */

  // r = hit radius, xp = base experience value of the gem they drop.
  PG.ENEMIES = {
    multiply:  { sprite: 'multiply',  r: 28, hp: 5,   speed: 150, dmg: 6,  xp: 10 },
    positive:  { sprite: 'positive',  r: 32, hp: 9,   speed: 135, dmg: 8,  xp: 10 },
    divisive:  { sprite: 'divisive',  r: 31, hp: 12,   speed: 125, dmg: 8,  xp: 10, split: 'divisiveHalf' },
    divisiveHalf: { sprite: 'divisive', scale: 0.6, r: 19, hp: 3, speed: 195, dmg: 4, xp: 5 },
    // plain wireframe grunts (hand-drawn, no gated unlock - just more faces in the horde)
    square:    { sprite: 'square',    r: 26, hp: 7,   speed: 140, dmg: 7,  xp: 10 },
    triangle:  { sprite: 'triangle',  r: 30, hp: 6,   speed: 160, dmg: 7,  xp: 10 },
    pentagon:  { sprite: 'pentagon',  r: 29, hp: 14,  speed: 120, dmg: 9,  xp: 10 },
    hexagon:   { sprite: 'hexagon',   r: 28, hp: 18,  speed: 110, dmg: 10, xp: 10 },
    // elites (the "mini bosses" from the Python game) - buffed closer to Stop, Bro!'s threat level
    // (starficer/illuminawty/robot used to be noticeably softer; Stop, Bro! is the one with noKnock,
    // so bumping their hp/dmg this far still leaves it the single scariest one-on-one, but a *group*
    // of any of these four now reads as "mini boss", not "slightly tougher grunt")
    starficer:   { sprite: 'starficer',   r: 32, hp: 200, speed: 165, dmg: 18, xp: 50, elite: true, ai: 'dash' },
    robot:       { sprite: 'robot',       r: 40, hp: 230, speed: 105, dmg: 19, xp: 50, elite: true, scale: 1.5 },
    illuminawty: { sprite: 'illuminawty', r: 33, hp: 210, speed: 175, dmg: 18, xp: 50, elite: true, ai: 'strafe' },
    stopbro:     { sprite: 'stopbro',     r: 32, hp: 280, speed: 85,  dmg: 16, xp: 50, elite: true, noKnock: true },
    // mid-boss at 10:00. PLACEHOLDER art (the robot, scaled up): drop the new sprite into assets/, add it to PG.ASSETS, and change `sprite` below.
    midboss:     { sprite: 'robot',       name: 'MID-BOSS', r: 78, hp: 1800, speed: 118, dmg: 24, xp: 80, elite: true, boss: true, ai: 'charge', scale: 2.6, noKnock: true },
    // final boss
    kingtaurus:  { sprite: 'kingtaurus',  name: 'KINGTAURUS',  r: 100, hp: 3200, speed: 150, dmg: 45, xp: 100, elite: true, boss: true, ai: 'charge', scale: 1.7, noKnock: true },
  };
  PG.ELITE_UNLOCK = { starficer: 120, robot: 240, illuminawty: 330, stopbro: 420 };

  /* --------------------------------------------------------- ramp / timeline */
  // enemies spawned per second at time t (seconds)
  // Past LATE_T (14:00) a maxed-out build should no longer be able to just stand still: the pressure ramps up
  // (more spawns, tougher and harder-hitting enemies, faster crowd) and standing in one spot summons extra rings.
  PG.LATE_T = 840;
  const late = t => Math.max(0, t - PG.LATE_T) / 60;   // minutes past LATE_T
  PG.spawnRate = function (t) {
    const m = t / 60, l = late(t);
    return 1.8 + 1.4 * m + 0.09 * m * m + 5 * l + 0.8 * l * l;
  };
  PG.hpMult = function (t) { const m = t / 60, l = late(t); return 1 + 0.32 * m + 0.032 * m * m + 1.6 * l + 0.35 * l * l; };
  PG.dmgMult = function (t) { return 1 + 0.04 * (t / 60) + 0.25 * late(t); };
  PG.speedMult = function (t) { return 1 + Math.min(0.25, t / 60 * 0.012) + 0.07 * late(t); };
  PG.IDLE_RADIUS = 300;   // leave a circle this big...
  PG.IDLE_SECS = 3.5;     // ...within this many seconds or a ring of enemies is called in (after LATE_T)

  // Scripted moments. ring = encirclement; elites = group of mini bosses (first one drops a treasure);
  // boss = Kingtaurus (drops 2 treasures).
  PG.TIMELINE = [
    { t: 60,   ring: 18, msg: 'They\'re closing in...' },
    { t: 150,  elites: ['starficer'], n: 1, msg: 'A Starficer is on patrol!' },
    { t: 240,  ring: 32 },
    { t: 270,  elites: ['starficer', 'robot'], n: 2, msg: 'Mini bosses approaching!' },
    { t: 390,  elites: ['illuminawty', 'robot'], n: 2, msg: 'The Illuminawty sees you.' },
    { t: 450,  ring: 50 },
    { t: 510,  elites: ['stopbro', 'illuminawty', 'starficer'], n: 3, msg: 'Stop, bro.' },
    { t: 600,  boss: 'midboss', hpMult: 1, msg: 'A mid-boss lumbers in!' },
    { t: 690,  ring: 65 },
    { t: 720,  elites: ['starficer', 'robot', 'illuminawty', 'stopbro'], n: 4 },
    { t: 810,  ring: 80 },
    { t: 840,  elites: ['starficer', 'robot', 'illuminawty', 'stopbro'], n: 5 },
    { t: 885,  ring: 85 },
    { t: 930,  ring: 95 },
    { t: 900,  elites: ['starficer', 'robot', 'illuminawty', 'stopbro'], n: 5 },
    { t: 960,  elites: ['starficer', 'robot', 'illuminawty', 'stopbro'], n: 7, msg: 'The horde thickens...' },
    { t: 1000, ring: 105 },
    { t: 1050, elites: ['starficer', 'robot', 'illuminawty', 'stopbro'], n: 9 },
    { t: 1080, ring: 115, msg: 'You\'re Almost Free' },
    { t: 1110, boss: 'kingtaurus', hpMult: 4.8, msg: 'KINGTAURUS has arrived!' },
    { t: 1140, elites: ['starficer', 'robot', 'illuminawty', 'stopbro'], n: 8, msg: 'Almost out of 2-D!' },
    { t: 1170, ring: 160 },
  ];

  /* XP needed to go from level L to L+1 */
  PG.xpNeeded = function (L) { return Math.round(75 + 20 * L + 6.3 * L * L); };
})();
