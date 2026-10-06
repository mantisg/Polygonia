/* game.js - the run itself: world, player, enemies, weapons, xp, level-ups, director, rendering. */
(function () {
  const PG = window.PG;
  const { rnd, rndi, pick, clamp } = PG;
  const TAU = Math.PI * 2;
  const CELL = 96;      // enemy spatial-hash cell
  const OCELL = 256;    // obstacle grid cell
  const TILE_W = 626, TILE_H = 417;  // paper_bg_3.png size (used only to lay out world objects like the Python version did)

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const nearestTmp = [];
  const nearestD = [];

  class Game {
    constructor(canvas, ui) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.ui = ui;
      this.mode = 'idle';      // idle | play | choose | pause | dead | won
      this.cols = Math.ceil(PG.WORLD_W / CELL);
      this.rows = Math.ceil(PG.WORLD_H / CELL);
      this.heads = new Int32Array(this.cols * this.rows);
      this.next = new Int32Array(8192);
      this.bgPattern = null;
      this.cx = 0; this.cy = 0; this.shake = 0;
      this.enemies = []; this.bigs = [];
      this.projs = []; this.gems = []; this.pickups = []; this.parts = [];
      this.obstacles = []; this.ogrid = new Map();
      this.weapons = []; this.passives = {};
      this.player = null;
      this.headless = false;
      this.resize();
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const W = window.innerWidth, H = window.innerHeight;
      this.canvas.width = Math.floor(W * dpr);
      this.canvas.height = Math.floor(H * dpr);
      this.zoom = Math.min(W / PG.VIEW_W, H / PG.VIEW_H);
      this.z = this.zoom * dpr;
      this.viewW = this.canvas.width / this.z;
      this.viewH = this.canvas.height / this.z;
      this.viewR = Math.hypot(this.viewW, this.viewH) / 2;
      if (PG.bgTile) this.bgPattern = this.ctx.createPattern(PG.bgTile, 'repeat');
      this.cacheEpoch = (this.cacheEpoch || 0) + 1;
    }

    /* ------------------------------------------------------------------ run setup */
    start(charId) {
      const ch = PG.CHARACTERS.find(c => c.id === charId) || PG.CHARACTERS[0];
      this.char = ch;
      this.diffId = PG.settings.difficulty; this.diff = PG.DIFFICULTIES[this.diffId] || PG.DIFFICULTIES.normal;
      this.t = 0; this.kills = 0; this.moolah = 0;
      this.enemies = []; this.bigs = []; this.projs = []; this.gems = []; this.pickups = []; this.parts = []; this.fx = [];
      this.weapons = []; this.passives = {};
      this.revivesUsed = 0; this.blastPending = false; this.noHit = true;
      this.evIdx = 0; this.spawnAcc = 0; this.nextId = 1;
      this.pending = []; this.choosing = false;
      this.autoPick = null; this.anchor = null; this.idleT = 0;
      this.pieTimer = 60; this.magnetTimer = 150;
      this.boss = null; this.deadT = 0; this.endShown = false;
      this.player = {
        x: PG.WORLD_W / 2, y: PG.WORLD_H / 2, hp: ch.hp, maxHp: ch.hp,
        level: 1, xp: 0, xpNeed: PG.xpNeeded(1),
        face: 1, moving: false, animT: 0, inv: 0, flash: 0, hurtR: ch.hurtR, dead: false,
      };
      this.recalcMods(true);
      this.rerolls = this.mods.reroll;
      this.addWeapon(ch.weapon);
      this.buildWorld();
      // starter pickups scattered like the Python version's pies
      for (let i = 0; i < 3; i++) this.scatterPickup('pie');
      for (let i = 0; i < 2; i++) this.scatterPickup('magnet');
      this.cx = clamp(this.player.x - this.viewW / 2, 0, Math.max(0, PG.WORLD_W - this.viewW));
      this.cy = clamp(this.player.y - this.viewH / 2, 0, Math.max(0, PG.WORLD_H - this.viewH));
      this.mode = 'play';
      this.invDirty = true;
      if (PG.save.data.runs < 3) this.ui.banner('WASD / arrows to move - your weapons fire on their own');
    }

    buildWorld() {
      this.obstacles = [];
      this.ogrid = new Map();
      const cxw = PG.WORLD_W / 2, cyw = PG.WORLD_H / 2;
      const add = (kind, x, y, scale) => {
        if (Math.hypot(x - cxw, y - cyw) < 320) return;
        const o = { kind, x, y, scale: scale || 1, circles: [] };
        if (kind === 'tree') { o.img = PG.img.tree; o.sortY = y + 100; o.circles.push({ x, y: y + 74, r: 40 }); }
        else if (kind === 'bush') { o.img = PG.img.bush; o.sortY = y + 28; o.circles.push({ x: x - 40, y: y - 20, r: 34 }, { x: x + 10, y: y - 20, r: 40 }); }
        else {
          const s = o.scale; o.img = PG.img.cabin; o.sortY = y + 165 * s;
          for (let k = -2; k <= 2; k++) o.circles.push({ x: x + k * 78 * s, y: y + 125 * s, r: 52 * s });
        }
        o.hw = o.img.width * o.scale / 2; o.hh = o.img.height * o.scale / 2;
        this.obstacles.push(o);
        for (const c of o.circles) {
          const gx = Math.floor(c.x / OCELL), gy = Math.floor(c.y / OCELL);
          const key = gy * 1000 + gx;
          let arr = this.ogrid.get(key);
          if (!arr) this.ogrid.set(key, (arr = []));
          arr.push(c);
        }
      };
      // The Python version seeded every paper tile so the map is always the same; keep that.
      for (let ty = 0; ty < PG.WORLD_H; ty += TILE_H) {
        for (let tx = 0; tx < PG.WORLD_W; tx += TILE_W) {
          const rng = mulberry32(((tx * 73856093) ^ (ty * 19349663)) >>> 0);
          if (rng() < 0.42) add('tree', tx + 10 + rng() * (TILE_W - 20), ty + 10 + rng() * (TILE_H - 20));
          if (rng() < 0.32) add('bush', tx + 10 + rng() * (TILE_W - 20), ty + 10 + rng() * (TILE_H - 20));
        }
      }
      const rng = mulberry32(2718);
      for (let i = 0; i < 6; i++) add('cabin', 500 + rng() * (PG.WORLD_W - 1000), 400 + rng() * (PG.WORLD_H - 800), 0.75);
    }

    scatterPickup(kind) {
      for (let i = 0; i < 40; i++) {
        const x = rnd(200, PG.WORLD_W - 200), y = rnd(200, PG.WORLD_H - 200);
        if (Math.hypot(x - this.player.x, y - this.player.y) < 700) continue;
        this.pickups.push({ k: kind, x, y, ph: rnd(0, TAU) });
        return;
      }
    }

    /* ------------------------------------------------------------- weapons / passives */
    addWeapon(id) {
      const def = PG.WEAPONS[id];
      const w = { id, def, level: 1, timer: 0.4, active: false, actT: 0, angle: 0, eff: null, birds: null };
      this.weapons.push(w);
      this.refreshWeapon(w);
      this.invDirty = true;
      return w;
    }
    refreshWeapon(w) {
      const s = Object.assign({}, w.def.base);
      for (let i = 0; i < w.level - 1; i++) w.def.up[i].apply(s);
      const m = this.mods;
      s.dmg *= m.dmg;
      s.cd = Math.max(0.12, s.cd * m.cd);
      if (s.size != null) s.size *= m.area;
      const k = w.def.kind;
      if (k === 'orbit') { s.radius *= m.area; s.dur *= m.dur; }
      else if (k === 'lob') { s.radius *= m.area; s.range *= m.dur; }
      else if (k === 'nova') { s.radius *= m.area; }
      else if (k === 'flock') { s.radius *= m.area; s.speed *= m.pspeed; }
      else { s.speed *= m.pspeed; s.range *= m.dur; }
      w.eff = s;
    }
    recalcMods(first) {
      const base = this.char.hp;
      const m = { move: 1, dmg: 1, cd: 1, area: 1, pspeed: 1, dur: 1, xp: 1, magnet: 1, maxHp: base, regen: 0, armor: 0, luck: 0, revive: 0, reroll: 0, moolahMul: 1, choices: 0 };
      for (const id in this.passives) PG.PASSIVES[id].mod(m, this.passives[id]);
      for (const pk of PG.PERKS) { const rk = PG.save.rank(pk.id); if (rk) pk.apply(m, rk); }   // permanent Archive perks
      m.cd = Math.max(0.55, m.cd);
      this.mods = m;
      const p = this.player;
      if (p) {
        const diff = m.maxHp - p.maxHp;
        p.maxHp = m.maxHp;
        if (diff > 0) p.hp = Math.min(p.maxHp, p.hp + diff);
      }
      for (const w of this.weapons) this.refreshWeapon(w);
    }

    /* ---------------------------------------------------------------- leveling */
    addXp(v) {
      const p = this.player;
      p.xp += v * this.mods.xp;
      while (p.xp >= p.xpNeed) {
        p.xp -= p.xpNeed;
        p.level++;
        p.xpNeed = PG.xpNeeded(p.level);
        this.pending.push('LEVEL UP!');
        PG.audio.sfx('level');
      }
    }
    checkChoices() {
      if (this.choosing || !this.pending.length || this.mode !== 'play') return;
      const title = this.pending.shift();
      const roll = this.rollChoices();
      // nothing left to upgrade and the player chose "Always ...": apply it without interrupting the run
      if (this.autoPick && roll.length && roll.every(c => c.kind === 'heal' || c.kind === 'money')) {
        const c = roll.find(x => x.kind === this.autoPick);
        if (c) { this.choosing = true; this.applyChoice(c); PG.audio.sfx('pick'); return; }
      }
      this.choosing = true;
      this.mode = 'choose';
      PG.audio.sfx('level');
      this.ui.showChoices(roll, title, ch => this.applyChoice(ch), {
        setAuto: k => { this.autoPick = k; },
        left: () => this.rerolls,
        reroll: () => { if (this.rerolls <= 0) return null; this.rerolls--; return this.rollChoices(); },
      });
    }
    rollChoices() {
      const opts = [];
      for (const w of this.weapons) {
        if (w.level < w.def.max) opts.push({ kind: 'weapon', id: w.id, weight: 3, lvl: w.level + 1, text: w.def.up[w.level - 1].text, name: w.def.name, icon: w.def.icon, tag: 'Weapon' });
      }
      if (this.weapons.length < PG.MAX_WEAPONS) {
        for (const id in PG.WEAPONS) {
          if (PG.isOpen('weapon', id) && !this.weapons.some(w => w.id === id)) {
            const d = PG.WEAPONS[id];
            opts.push({ kind: 'weapon', id, weight: 1.8, lvl: 1, text: d.desc, name: d.name, icon: d.icon, tag: 'New weapon' });
          }
        }
      }
      const owned = Object.keys(this.passives);
      for (const id of owned) {
        const d = PG.PASSIVES[id];
        if (this.passives[id] < d.max) opts.push({ kind: 'passive', id, weight: 2.4, lvl: this.passives[id] + 1, text: d.lv, name: d.name, icon: d.icon, tag: 'Passive' });
      }
      if (owned.length < PG.MAX_PASSIVES) {
        for (const id in PG.PASSIVES) {
          if (!(id in this.passives) && PG.isOpen('passive', id)) {
            const d = PG.PASSIVES[id];
            opts.push({ kind: 'passive', id, weight: 1.3, lvl: 1, text: d.lv + ' - ' + d.desc, name: d.name, icon: d.icon, tag: 'New passive' });
          }
        }
      }
      const out = [];
      const n = Math.min(3 + this.mods.choices + (this.mods.luck >= 0.5 ? 1 : 0), 5, opts.length);
      for (let i = 0; i < n; i++) {
        let tot = 0; for (const o of opts) tot += o.weight;
        let r = Math.random() * tot, idx = 0;
        for (; idx < opts.length - 1; idx++) { r -= opts[idx].weight; if (r <= 0) break; }
        out.push(opts.splice(idx, 1)[0]);
      }
      if (!out.length) {
        out.push({ kind: 'heal', name: 'Pie', icon: 'pie', lvl: 0, text: 'Restore 50 HP', tag: 'Snack' });
        out.push({ kind: 'money', name: 'Moolah', icon: 'money', lvl: 0, text: '+' + PG.FILLER_MOOLAH + ' moolah', tag: 'Cash' });
      }
      return out;
    }
    applyChoice(c) {
      const p = this.player;
      if (c.kind === 'weapon') {
        const w = this.weapons.find(x => x.id === c.id);
        if (w) { w.level++; this.refreshWeapon(w); } else this.addWeapon(c.id);
      } else if (c.kind === 'passive') {
        this.passives[c.id] = (this.passives[c.id] || 0) + 1;
        this.recalcMods();
      } else if (c.kind === 'heal') p.hp = Math.min(p.maxHp, p.hp + 50);
      else if (c.kind === 'money') this.moolah += PG.FILLER_MOOLAH;
      this.invDirty = true;
      this.choosing = false;
      this.mode = 'play';
    }

    /* ----------------------------------------------------------------- spawning */
    spawnPos() {
      const p = this.player, R = this.viewR + 90;
      let x = p.x, y = p.y;
      for (let i = 0; i < 8; i++) {
        const a = rnd(0, TAU);
        x = clamp(p.x + Math.cos(a) * R, 60, PG.WORLD_W - 60);
        y = clamp(p.y + Math.sin(a) * R, 60, PG.WORLD_H - 60);
        // stay off-screen where the world lets us
        if (Math.abs(x - p.x) > this.viewW / 2 + 40 || Math.abs(y - p.y) > this.viewH / 2 + 40) break;
      }
      return { x, y };
    }
    spawnEnemy(key, x, y, opt) {
      const d = PG.ENEMIES[key];
      opt = opt || {};
      const t = this.t;
      const hp = d.hp * (opt.hpMult != null ? opt.hpMult : PG.hpMult(t)) * this.diff.hp * PG.ENEMY_HP_MULT;
      const scale = d.scale || 1;
      const img = PG.img[d.sprite];
      const e = {
        id: this.nextId++, key, d, x, y, r: d.r, hp, maxHp: hp,
        speed: d.speed * PG.ENEMY_SPEED_MULT * (d.boss || d.elite ? 1 : PG.speedMult(t)),
        dmg: d.dmg * PG.dmgMult(t) * this.diff.dmg,
        xp: d.xp, scale, img, sil: PG.sil[d.sprite],
        kx: 0, ky: 0, flash: 0, phase: rnd(0, TAU), dead: false,
        ai: d.ai || null, aiT: rnd(1.2, 3), aiS: 0, dx: 0, dy: 0, pawT: 0, craneT: 0,
        treasure: opt.treasure || 0, sy: y,
      };
      this.enemies.push(e);
      return e;
    }
    pickType() {
      const t = this.t;
      const pool = [['multiply', 4], ['square', 3]];
      if (t >= 45) pool.push(['positive', 3]);
      if (t >= 70) pool.push(['triangle', 3]);
      if (t >= 100) pool.push(['divisive', 3 + Math.min(3, t / 400)]);
      if (t >= 160) pool.push(['pentagon', 2 + Math.min(2, t / 500)]);
      if (t >= 260) pool.push(['hexagon', 2 + Math.min(2, t / 600)]);
      let tot = 0; for (const p of pool) tot += p[1];
      let r = Math.random() * tot;
      for (const p of pool) { r -= p[1]; if (r <= 0) return p[0]; }
      return 'multiply';
    }
    spawnRandom() {
      const t = this.t;
      const { x, y } = this.spawnPos();
      if (t >= 120 && Math.random() < Math.min(0.012, (t - 120) / 60 * 0.0012)) {
        const avail = Object.keys(PG.ELITE_UNLOCK).filter(k => t >= PG.ELITE_UNLOCK[k]);
        if (avail.length) { this.spawnEnemy(pick(avail), x, y); return; }
      }
      this.spawnEnemy(this.pickType(), x, y);
    }
    runEvent(ev) {
      const p = this.player;
      if (ev.msg) this.ui.banner(ev.msg);
      if (ev.ring) {
        const R = this.viewR + 70, rn = Math.max(4, Math.round(ev.ring * this.diff.spawn));
        for (let i = 0; i < rn; i++) {
          const a = (i / rn) * TAU;
          this.spawnEnemy(this.pickType(), clamp(p.x + Math.cos(a) * R, 50, PG.WORLD_W - 50), clamp(p.y + Math.sin(a) * R, 50, PG.WORLD_H - 50));
        }
      }
      if (ev.elites) {
        for (let i = 0; i < ev.n; i++) {
          const { x, y } = this.spawnPos();
          this.spawnEnemy(pick(ev.elites), x, y, { treasure: i === 0 && !ev.noTreasure ? 1 : 0 });
        }
      }
      if (ev.boss) {
        const { x, y } = this.spawnPos();
        const d = PG.ENEMIES[ev.boss];
        const e = this.spawnEnemy(ev.boss, x, y, { hpMult: ev.hpMult, treasure: 2 });
        e.maxHp = e.hp = d.hp * ev.hpMult * this.diff.hp * PG.ENEMY_HP_MULT;
        this.boss = e;
        if (this.ui.bossName) this.ui.bossName(d.name || 'BOSS');
        PG.audio.sfx('boss');
        this.shake = 14;
      }
    }
    director(dt) {
      const T = PG.TIMELINE;
      while (this.evIdx < T.length && T[this.evIdx].t <= this.t) this.runEvent(T[this.evIdx++]);
      this.spawnAcc += PG.spawnRate(this.t) * this.diff.spawn * dt;
      let guard = 60;
      while (this.spawnAcc >= 1 && guard--) {
        this.spawnAcc -= 1;
        if (this.enemies.length < PG.MAX_ENEMIES) this.spawnRandom();
      }
      // late game: camping in one spot calls in a ring of enemies
      if (this.t >= PG.LATE_T) {
        const p = this.player, a = this.anchor;
        if (!a || Math.hypot(p.x - a.x, p.y - a.y) > PG.IDLE_RADIUS) { this.anchor = { x: p.x, y: p.y }; this.idleT = 0; }
        else if ((this.idleT += dt) >= PG.IDLE_SECS) {
          this.idleT = -4;
          const l = (this.t - PG.LATE_T) / 60;
          this.runEvent({ ring: Math.round(50 + 6 * l), elites: ['starficer', 'robot', 'illuminawty', 'stopbro'], n: 3, noTreasure: true });
        }
      }
      // world pickups keep coming
      this.pieTimer -= dt;
      if (this.pieTimer <= 0) { this.pieTimer = 75 / (PG.PIE_RATE * (1 + this.mods.luck * 0.5)); if (this.pickups.filter(k => k.k === 'pie').length < 5) this.scatterPickup('pie'); }
      this.magnetTimer -= dt;
      if (this.magnetTimer <= 0) { this.magnetTimer = 150; if (this.pickups.filter(k => k.k === 'magnet').length < 3) this.scatterPickup('magnet'); }
    }

    /* ------------------------------------------------------------------ helpers */
    pushOut(x, y, r) {
      // returns [dx, dy] to move a circle out of static obstacles
      let ox = 0, oy = 0;
      const gx0 = Math.floor((x - r - 60) / OCELL), gx1 = Math.floor((x + r + 60) / OCELL);
      const gy0 = Math.floor((y - r - 60) / OCELL), gy1 = Math.floor((y + r + 60) / OCELL);
      for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
        const arr = this.ogrid.get(gy * 1000 + gx);
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const c = arr[i];
          const dx = x + ox - c.x, dy = y + oy - c.y;
          const min = r + c.r;
          const d2 = dx * dx + dy * dy;
          if (d2 < min * min && d2 > 0.0001) {
            const d = Math.sqrt(d2);
            ox += (dx / d) * (min - d); oy += (dy / d) * (min - d);
          }
        }
      }
      return [ox, oy];
    }
    buildGrid() {
      this.heads.fill(-1);
      this.bigs.length = 0;
      const E = this.enemies, cols = this.cols, rows = this.rows;
      for (let i = 0; i < E.length; i++) {
        const e = E[i];
        if (e.r > 60) { this.bigs.push(e); continue; }
        const cx = clamp((e.x / CELL) | 0, 0, cols - 1), cy = clamp((e.y / CELL) | 0, 0, rows - 1);
        const c = cy * cols + cx;
        this.next[i] = this.heads[c];
        this.heads[c] = i;
      }
    }
    forNear(x, y, rad, fn) {
      const cols = this.cols, rows = this.rows, E = this.enemies;
      const x0 = clamp(((x - rad - 60) / CELL) | 0, 0, cols - 1), x1 = clamp(((x + rad + 60) / CELL) | 0, 0, cols - 1);
      const y0 = clamp(((y - rad - 60) / CELL) | 0, 0, rows - 1), y1 = clamp(((y + rad + 60) / CELL) | 0, 0, rows - 1);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        for (let i = this.heads[cy * cols + cx]; i !== -1; i = this.next[i]) fn(E[i]);
      }
      for (let i = 0; i < this.bigs.length; i++) fn(this.bigs[i]);
    }
    nearest(n, maxR) {
      const p = this.player, mr2 = maxR * maxR, E = this.enemies;
      nearestTmp.length = 0; nearestD.length = 0;
      for (let i = 0; i < E.length; i++) {
        const e = E[i];
        if (e.dead) continue;
        const dx = e.x - p.x, dy = e.y - p.y, d2 = dx * dx + dy * dy;
        if (d2 > mr2) continue;
        if (nearestTmp.length < n) {
          let j = nearestTmp.length;
          nearestTmp.push(e); nearestD.push(d2);
          while (j > 0 && nearestD[j - 1] > d2) { nearestD[j] = nearestD[j - 1]; nearestTmp[j] = nearestTmp[j - 1]; j--; }
          nearestD[j] = d2; nearestTmp[j] = e;
        } else if (d2 < nearestD[n - 1]) {
          let j = n - 1;
          while (j > 0 && nearestD[j - 1] > d2) { nearestD[j] = nearestD[j - 1]; nearestTmp[j] = nearestTmp[j - 1]; j--; }
          nearestD[j] = d2; nearestTmp[j] = e;
        }
      }
      return nearestTmp;
    }

    damageEnemy(e, dmg, kx, ky) {
      if (e.dead) return;
      e.hp -= dmg;
      e.flash = 0.09;
      if (!e.d.noKnock) { e.kx += kx; e.ky += ky; }
      PG.audio.sfx('hit');
      if (e.hp <= 0) this.killEnemy(e);
    }
    burst(x, y, n, cols) {
      if (this.parts.length > 420) return;
      for (let i = 0; i < n; i++) {
        const a = rnd(0, TAU), s = rnd(60, 260);
        this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.3, 0.6), max: 0.6, size: rnd(4, 9), col: pick(cols) });
      }
    }
    dropGem(x, y, v, spread, money) {
      // xp gems merge into an existing gem once the map is crowded; money just stops dropping
      if (this.gems.length >= 700) {
        if (money) return;
        for (let tries = 0; tries < 6; tries++) {
          const g = this.gems[(Math.random() * this.gems.length) | 0];
          if (g.t < 3) { g.v += v; g.t = g.v >= 100 ? 2 : g.v >= 50 ? 1 : 0; return; }
        }
        return;
      }
      this.gems.push({ x: x + (spread ? rnd(-spread, spread) : 0), y: y + (spread ? rnd(-spread, spread) : 0), v, t: money ? 3 : (v >= 100 ? 2 : v >= 50 ? 1 : 0), ph: rnd(0, TAU), sp: 0, pull: false });
    }
    killEnemy(e) {
      e.dead = true;
      this.kills++;
      if (this.kills >= 500) PG.save.unlockAch('ACH_HORDE500');
      const xpv = e.xp * (1 + this.t / 60 * 0.05);
      const d = e.d;
      if (d.boss) {
        for (let i = 0; i < 8; i++) this.dropGem(e.x, e.y, 100, 120);
        this.dropGem(e.x, e.y, Math.round(40 * PG.MOOLAH_RATE), 0, true);
        this.pickups.push({ k: 'pie', x: e.x + 50, y: e.y + 30, ph: 0 });
        this.shake = 12;
        this.boss = null;
        PG.audio.sfx('boss');
        if (e.key === 'midboss') PG.save.unlockAch('ACH_MIDBOSS');
        if (e.key === 'kingtaurus') PG.save.unlockAch('ACH_KINGTAURUS');
      } else {
        this.dropGem(e.x, e.y, Math.round(xpv), d.elite ? 40 : 6);
        if (d.elite) {
          for (let i = 0; i < 2; i++) this.dropGem(e.x, e.y, Math.max(1, Math.round(5 * PG.MOOLAH_RATE)), 30, true);
          if (Math.random() < 0.25 * PG.PIE_RATE) this.pickups.push({ k: 'pie', x: e.x, y: e.y, ph: 0 });
        } else if (Math.random() < 0.03 * PG.MOOLAH_RATE * (1 + this.mods.luck)) {
          this.dropGem(e.x, e.y, 1, 0, true);
        }
        if (Math.random() < 0.0035 * PG.PIE_RATE * (1 + this.mods.luck)) this.pickups.push({ k: 'pie', x: e.x, y: e.y, ph: 0 });
      }
      for (let i = 0; i < e.treasure; i++) this.pickups.push({ k: 'treasure', x: e.x + i * 60 - (e.treasure - 1) * 30, y: e.y, ph: rnd(0, TAU) });
      if (d.split) {
        for (let i = 0; i < 2; i++) {
          const a = i * Math.PI + rnd(0, 1);
          const c = this.spawnEnemy(d.split, e.x + Math.cos(a) * 24, e.y + Math.sin(a) * 24, { hpMult: PG.hpMult(this.t) });
          c.kx = Math.cos(a) * 160; c.ky = Math.sin(a) * 160;
        }
      }
      this.burst(e.x, e.y, d.boss ? 40 : d.elite ? 14 : 5, ['#ffffff', '#f4e9a8', '#d8d8d8', '#222222', '#ff9aa2']);
      PG.audio.sfx('kill');
    }
    hurtPlayer(raw, src) {
      const p = this.player;
      if (p.inv > 0 || p.dead) return;
      this.lastHitBy = src || '?';
      const dmg = Math.max(1, Math.round(raw - this.mods.armor));
      p.hp -= dmg;
      p.inv = 0.45; p.flash = 0.2;
      this.shake = Math.max(this.shake, 6);
      PG.audio.sfx('hurt');
      this.noHit = false;
      PG.save.unlockAch('ACH_FIRST_HIT');
      if (p.hp <= 0 && this.revivesUsed < this.mods.revive) {
        this.revivesUsed++; this.blastPending = true; p.hp = 1; p.inv = 5;
        return;
      }
      if (p.hp <= 0) {
        p.hp = 0; p.dead = true;
        this.mode = 'dead'; this.deadT = 0;
        PG.audio.sfx('die');
        this.burst(p.x, p.y, 40, ['#111111', '#f4e9a8', '#ff5555', '#ffffff']);
        if (this.t < 60) PG.save.unlockAch('ACH_QUICK_TRIP');
      }
    }
    win() {
      this.mode = 'won'; this.deadT = 0;
      for (const e of this.enemies) this.burst(e.x, e.y, 2, ['#ffffff', '#f4e9a8', '#9ad0ff', '#ff9aa2']);
      this.enemies = []; this.bigs = []; this.boss = null; this.fx = [];
      PG.audio.sfx('win');
      PG.save.unlockAch('ACH_SURVIVE_20');
      if (this.diffId === 'hard') PG.save.unlockAch('ACH_HARD');
      if (this.diffId === 'nightmare') PG.save.unlockAch('ACH_NIGHTMARE');
      if (this.noHit) PG.save.unlockAch('ACH_NOHIT');
      if (this.revivesUsed > 0) PG.save.unlockAch('ACH_REVIVE_WIN');
      const cw = PG.save.data.charsWon;
      cw[this.char.id] = 1;
      if (PG.CHARACTERS.every(c => cw[c.id])) PG.save.unlockAch('ACH_ALL_CHARS');
      PG.save.write();
    }

    /* ------------------------------------------------------------------- update */
    update(dt) {
      if (this.mode === 'dead' || this.mode === 'won') {
        this.deadT += dt;
        this.updateParts(dt);
        if (this.deadT > (this.mode === 'dead' ? 1.5 : 1.2) && !this.endShown) {
          this.endShown = true;
          this.ui.showEnd(this.mode === 'won', this.stats());
        }
        return;
      }
      if (this.mode !== 'play') return;
      dt = Math.min(dt, 0.05);
      this.t += dt;
      // time-survived achievements - 30 min is unreachable until Endless Mode lets a run continue past
      // RUN_TIME, but the check is harmless (and ready) in the meantime; unlockAch() is itself idempotent.
      if (this.t >= 600) PG.save.unlockAch('ACH_SURVIVE_10');
      if (this.t >= 1800) PG.save.unlockAch('ACH_SURVIVE_30');
      if (this.weapons.length >= PG.MAX_WEAPONS && Object.keys(this.passives).length >= PG.MAX_PASSIVES) PG.save.unlockAch('ACH_FULLY_LOADED');
      if (this.moolah >= 300) PG.save.unlockAch('ACH_MOOLAH300');
      if (this.t >= PG.RUN_TIME) { this.win(); return; }
      const p = this.player;

      // --- movement
      const ax = PG.input.axis();
      let mx = ax.x, my = ax.y;
      const len = Math.hypot(mx, my);
      p.moving = len > 0;
      if (len > 0) {
        mx /= len; my /= len;
        const sp = this.char.speed * this.mods.move;
        p.x += mx * sp * dt; p.y += my * sp * dt;
        if (mx < 0) p.face = -1; else if (mx > 0) p.face = 1;
        p.animT += dt;
      } else p.animT = 0;
      const po = this.pushOut(p.x, p.y + 38, 24);
      p.x += po[0]; p.y += po[1];
      p.x = clamp(p.x, PG.BORDER, PG.WORLD_W - PG.BORDER);
      p.y = clamp(p.y, PG.BORDER, PG.WORLD_H - PG.BORDER);
      if (p.inv > 0) p.inv -= dt;
      if (p.flash > 0) p.flash -= dt;
      if (this.mods.regen > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + this.mods.regen * dt);

      this.director(dt);
      this.compact();
      this.buildGrid();
      this.updateEnemies(dt);
      if (this.blastPending) { this.blastPending = false; this.doRevive(); }
      this.updateWeapons(dt);
      this.updateProjs(dt);
      this.updateFx(dt);
      this.updateGems(dt);
      this.updateParts(dt);
      if (this.shake > 0) this.shake = Math.max(0, this.shake - 40 * dt);

      // camera
      const tx = clamp(p.x - this.viewW / 2, 0, Math.max(0, PG.WORLD_W - this.viewW));
      const ty = clamp(p.y - this.viewH / 2, 0, Math.max(0, PG.WORLD_H - this.viewH));
      const k = Math.min(1, dt * 14);
      this.cx += (tx - this.cx) * k; this.cy += (ty - this.cy) * k;

      this.checkChoices();
    }

    updateEnemies(dt) {
      const p = this.player, E = this.enemies, cols = this.cols, rows = this.rows, heads = this.heads, next = this.next;
      const bigs = this.bigs;
      const kd = Math.exp(-9 * dt);
      for (let i = 0; i < E.length; i++) {
        const e = E[i];
        if (e.dead) continue;
        let dx = p.x - e.x, dy = p.y - e.y;
        let d = Math.hypot(dx, dy) || 1;
        let dirx = dx / d, diry = dy / d;
        let sp = e.speed;

        // --- special behaviours
        if (e.ai === 'dash' || e.ai === 'charge') {
          const boss = e.ai === 'charge';
          e.aiT -= dt;
          if (e.aiS === 0 && e.aiT <= 0) { e.aiS = 1; e.aiT = boss ? 0.9 : 0.45; e.dx = dirx; e.dy = diry; }
          else if (e.aiS === 1) { sp = 0; dirx = 0; diry = 0; e.dx = dirx || e.dx; if (e.aiT <= 0) { e.aiS = 2; e.aiT = boss ? 0.9 : 0.55; e.dx = dx / d; e.dy = dy / d; } }
          else if (e.aiS === 2) { dirx = e.dx; diry = e.dy; sp = e.speed * (boss ? 3.8 : 3.6); if (e.aiT <= 0) { e.aiS = 0; e.aiT = rnd(boss ? 1.6 : 1.8, boss ? 2.6 : 3); } }
        } else if (e.ai === 'strafe' && d > 240) {
          const a = Math.sin(this.t * 2.2 + e.phase) * 0.95, c = Math.cos(a), s = Math.sin(a);
          const nx = dirx * c - diry * s, ny = dirx * s + diry * c; dirx = nx; diry = ny;
        }

        let vx = dirx * sp + e.kx, vy = diry * sp + e.ky;
        e.kx *= kd; e.ky *= kd;
        let nx = e.x + vx * dt, ny = e.y + vy * dt;

        // --- soft separation from neighbours (keeps the horde from stacking into one pixel)
        if (e.r <= 60) {
          const cx = clamp((e.x / CELL) | 0, 0, cols - 1), cy = clamp((e.y / CELL) | 0, 0, rows - 1);
          let sx = 0, sy = 0, seen = 0;
          const x0 = cx > 0 ? cx - 1 : 0, x1 = cx < cols - 1 ? cx + 1 : cx, y0 = cy > 0 ? cy - 1 : 0, y1 = cy < rows - 1 ? cy + 1 : cy;
          for (let gy = y0; gy <= y1 && seen < 14; gy++) for (let gx = x0; gx <= x1 && seen < 14; gx++) {
            for (let j = heads[gy * cols + gx]; j !== -1; j = next[j]) {
              if (j === i) continue;
              const o = E[j];
              const ex = e.x - o.x, ey = e.y - o.y, d2 = ex * ex + ey * ey;
              const min = (e.r + o.r) * 0.8;
              if (d2 < min * min) {
                const dd = Math.sqrt(d2) || 0.01;
                const push = (min - dd) / min;
                sx += (ex / dd) * push; sy += (ey / dd) * push; seen++;
                if (seen >= 14) break;
              }
            }
          }
          for (let b = 0; b < bigs.length; b++) {
            const o = bigs[b], ex = e.x - o.x, ey = e.y - o.y, min = e.r + o.r * 0.85, d2 = ex * ex + ey * ey;
            if (d2 < min * min) { const dd = Math.sqrt(d2) || 0.01; const push = (min - dd) / min; sx += (ex / dd) * push * 2; sy += (ey / dd) * push * 2; }
          }
          nx += sx * 240 * dt; ny += sy * 240 * dt;
        }

        // --- static obstacles (trees, bushes, cabins)
        const fr = e.r * 0.55;
        const po = this.pushOut(nx, ny + e.r * 0.4, fr);
        nx += po[0]; ny += po[1];
        e.x = clamp(nx, 30, PG.WORLD_W - 30);
        e.y = clamp(ny, 30, PG.WORLD_H - 30);
        if (e.flash > 0) e.flash -= dt;

        // --- contact damage
        const hx = e.x - p.x, hy = e.y - p.y;
        const rr = e.r * 0.78 + p.hurtR * 0.9;
        if (hx * hx + hy * hy < rr * rr) this.hurtPlayer(e.dmg, e.key);
      }
      if (this.boss && this.boss.dead) this.boss = null;
    }
    compact() {
      // drop dead enemies before the grid is rebuilt (indices in the grid point into this array)
      const E = this.enemies;
      let w = 0;
      for (let i = 0; i < E.length; i++) if (!E[i].dead) E[w++] = E[i];
      E.length = w;
    }

    updateWeapons(dt) {
      const p = this.player;
      for (const w of this.weapons) {
        const s = w.eff;
        const kind = w.def.kind;
        if (kind === 'flock') {
          this.updateFlock(w, dt);
        } else if (kind !== 'orbit') {
          w.timer -= dt;
          if (w.timer <= 0) {
            const fired = kind === 'proj' ? this.fireProj(w) : kind === 'boomer' ? this.fireBoomer(w) : kind === 'lob' ? this.fireLob(w) : this.fireNova(w);
            w.timer = fired ? s.cd : 0.08;
          }
        } else {
          if (w.active) {
            w.actT -= dt; w.angle += s.spin * dt;
            if (w.actT <= 0) { w.active = false; w.timer = s.cd; }
            else this.hitPaws(w);
          } else {
            w.timer -= dt;
            if (w.timer <= 0) { w.active = true; w.actT = s.dur; w.angle = rnd(0, TAU); }
          }
        }
      }
    }
    fireProj(w) {
      const p = this.player, s = w.eff;
      const targets = this.nearest(w.def.fan ? 1 : s.count, s.range + 120);
      if (!targets.length) return false;
      const speed = s.speed, life = s.range / speed;
      const img = w.def.icon;
      const n = s.count;
      const base0 = Math.atan2(targets[0].y - p.y, targets[0].x - p.x);
      for (let i = 0; i < n; i++) {
        let ang;
        if (w.def.fan) ang = base0 + (n > 1 ? (i / (n - 1) - 0.5) * s.spread * Math.PI / 180 : 0) + rnd(-0.03, 0.03);
        else { const t = targets[i % targets.length]; ang = Math.atan2(t.y - p.y, t.x - p.x) + rnd(-s.spread, s.spread) * Math.PI / 360; }
        this.projs.push({
          x: p.x, y: p.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
          dmg: s.dmg, r: (w.def.icon === 'star' ? 15 : 13) * s.size, pierce: s.pierce, life, img,
          rot: rnd(0, TAU), spin: w.def.icon === 'star' ? 16 : 8, ang, hit: [], size: s.size,
        });
      }
      return true;
    }
    fireBoomer(w) {
      const p = this.player, s = w.eff;
      const targets = this.nearest(1, s.range + 140);
      if (!targets.length) return false;
      const base0 = Math.atan2(targets[0].y - p.y, targets[0].x - p.x), n = s.count;
      for (let i = 0; i < n; i++) {
        const ang = base0 + (n > 1 ? (i - (n - 1) / 2) * 0.42 : 0);
        this.projs.push({
          boom: true, out: true, trav: 0, maxD: s.range, x: p.x, y: p.y, vx: Math.cos(ang) * s.speed, vy: Math.sin(ang) * s.speed,
          dmg: s.dmg, r: 16 * s.size, pierce: 9999, life: 8, img: w.def.flyIcon || 'magnet', rot: rnd(0, TAU), spin: 13, ang, hit: [], size: s.size, speed: s.speed,
        });
      }
      return true;
    }
    fireLob(w) {
      const p = this.player, s = w.eff;
      const targets = this.nearest(s.count, s.range + 60);
      if (!targets.length) return false;
      const flight = 0.6;
      for (let i = 0; i < s.count; i++) {
        const t = targets[i % targets.length];
        // lead the shot: the crowd is walking toward the player
        const dx = p.x - t.x, dy = p.y - t.y, d = Math.hypot(dx, dy) || 1;
        const lead = t.ai === 'charge' ? 0 : t.speed * flight * 0.85;
        const extra = i >= targets.length ? 55 : 0;
        this.fx.push({ k: 'lob', sx: p.x, sy: p.y, tx: t.x + (dx / d) * lead + rnd(-extra, extra), ty: t.y + (dy / d) * lead + rnd(-extra, extra), t: -i * 0.09, dur: flight, dmg: s.dmg, rad: s.radius, rot: rnd(0, TAU) });
      }
      return true;
    }
    fireNova(w) {
      const s = w.eff;
      for (let i = 0; i < s.rings; i++) this.fx.push({ k: 'nova', t: -i * 0.28, dur: 0.5, R: s.radius, dmg: s.dmg, kn: s.knock, hit: [], col: '#141414' });
      PG.audio.sfx('boss');
      return true;
    }
    updateFx(dt) {
      const F = this.fx, p = this.player;
      let w = 0;
      for (let i = 0; i < F.length; i++) {
        const f = F[i];
        f.t += dt;
        if (f.t < 0) { F[w++] = f; continue; }
        if (f.k === 'lob') {
          if (f.t >= f.dur) {
            // land: splat damage in a circle, then a short-lived splat sprite
            const x = f.tx, y = f.ty, R = f.rad;
            this.forNear(x, y, R, e => {
              if (e.dead) return;
              const dx = e.x - x, dy = e.y - y, rr = R + e.r * 0.6;
              if (dx * dx + dy * dy < rr * rr) { const d = Math.hypot(dx, dy) || 1; this.damageEnemy(e, f.dmg, (dx / d) * 160, (dy / d) * 160); }
            });
            this.shake = Math.max(this.shake, 2);
            this.burst(x, y, 10, ['#f4c37a', '#e8935a', '#ffffff', '#c0392b']);
            F[w++] = { k: 'splat', t: 0, dur: 0.5, x, y, rad: R };
            continue;
          }
        } else if (f.k === 'nova') {
          const cr = f.R * Math.min(1, f.t / f.dur), x = p.x, y = p.y;
          this.forNear(x, y, cr, e => {
            if (e.dead || f.hit.indexOf(e.id) !== -1) return;
            const dx = e.x - x, dy = e.y - y, rr = cr + e.r * 0.5;
            if (dx * dx + dy * dy < rr * rr) {
              f.hit.push(e.id);
              const d = Math.hypot(dx, dy) || 1;
              if (f.dmg > 0) this.damageEnemy(e, f.dmg, (dx / d) * f.kn, (dy / d) * f.kn);
            }
          });
          if (f.t >= f.dur) continue;
        } else if (f.t >= f.dur) continue;
        F[w++] = f;
      }
      F.length = w;
    }
    doRevive() {
      // Spare Shape: half HP back, a shockwave that clears the crowd, and a moment of safety
      const p = this.player;
      p.hp = Math.ceil(p.maxHp * 0.5); p.inv = 2.2; p.dead = false;
      this.fx.push({ k: 'nova', t: 0, dur: 0.6, R: 640, dmg: 120, kn: 900, hit: [], col: '#e3a600' });
      this.shake = 14;
      this.ui.banner('Spare Shape! Back on your feet.');
      PG.audio.sfx('level');
      this.burst(p.x, p.y, 30, ['#ffe27a', '#ffffff', '#ffb347']);
    }
    hitPaws(w) {
      const p = this.player, s = w.eff, now = this.t;
      const n = s.count;
      for (let k = 0; k < n; k++) {
        const a = w.angle + (k / n) * TAU;
        const px = p.x + Math.cos(a) * s.radius, py = p.y + Math.sin(a) * s.radius;
        const pr = 30 * s.size;
        this.forNear(px, py, pr, e => {
          if (e.dead || e.pawT > now) return;
          const dx = e.x - px, dy = e.y - py, rr = pr + e.r * 0.8;
          if (dx * dx + dy * dy < rr * rr) {
            e.pawT = now + 0.35;
            const d = Math.hypot(dx, dy) || 1;
            this.damageEnemy(e, s.dmg, (dx / d) * 260, (dy / d) * 260);
          }
        });
      }
    }
    updateFlock(w, dt) {
      // persistent "birds" (paper cranes), each bouncing on its own star/rosette pattern inside an
      // imaginary circle around the player: fly dead straight from the last point on the circle to
      // the next one, and each time you land on the circle, the next point is roughly the opposite
      // side, rotated an extra turn from a plain reversal. Three things keep every crane on its own
      // path instead of clumping:
      //  1. Spacing - each new crane's starting angle is the last crane's angle plus a random
      //     15-30 degree step (not a fully independent random angle), so spawns can't land within a
      //     few degrees of each other by chance.
      //  2. A random turn size per bird (b.turn, rolled once at spawn from CRANE_TURN_MIN..MAX) - two
      //     birds with the exact same turn rate trace parallel copies of the same star forever and
      //     never drift apart even if they start at different angles, so each bird needs its own rate.
      //  3. A random starting point partway along the first leg (not always starting exactly on the
      //     player) - every leg is close to a full diameter, so same-speed birds launched at the same
      //     moment would otherwise keep swinging back past the player in sync and "clump" there
      //     over and over even with (1) and (2) in place.
      const p = this.player, s = w.eff, now = this.t;
      const n = Math.max(1, Math.round(s.count));
      let B = w.birds;
      if (!B) B = w.birds = [];
      while (B.length < n) {
        if (w.craneAng == null) w.craneAng = rnd(0, TAU);
        else w.craneAng += rnd(PG.CRANE_TURN_MIN, PG.CRANE_TURN_MAX); // always the same direction, so every crane stays >=15 deg from every earlier one, not just the last
        const ang = w.craneAng;
        const turnDir = rnd(0, 1) < 0.5 ? 1 : -1;
        const turn = rnd(PG.CRANE_TURN_MIN, PG.CRANE_TURN_MAX);
        const tx = p.x + Math.cos(ang) * s.radius, ty = p.y + Math.sin(ang) * s.radius;
        const frac = rnd(0, 1);
        B.push({ x: p.x + (tx - p.x) * frac, y: p.y + (ty - p.y) * frac, ang, turnDir, turn });
      }
      if (B.length > n) B.length = n;
      const hitR = 24 * s.size, R = s.radius;
      for (let bi = 0; bi < B.length; bi++) {
        const b = B[bi];
        const tx = p.x + Math.cos(b.ang) * R, ty = p.y + Math.sin(b.ang) * R;
        const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy) || 1;
        const step = s.speed * dt;
        if (step >= d) {
          b.x = tx; b.y = ty;
          b.ang += Math.PI + b.turnDir * b.turn;
        } else {
          b.x += (dx / d) * step; b.y += (dy / d) * step;
        }
        this.forNear(b.x, b.y, hitR, e => {
          if (e.dead || e.craneT > now) return;
          const ex = e.x - b.x, ey = e.y - b.y, rr = hitR + e.r * 0.8;
          if (ex * ex + ey * ey < rr * rr) {
            e.craneT = now + s.cd;
            const ed = Math.hypot(ex, ey) || 1;
            this.damageEnemy(e, s.dmg, (ex / ed) * 220, (ey / ed) * 220);
          }
        });
      }
    }
    updateProjs(dt) {
      const P = this.projs;
      let w = 0;
      for (let i = 0; i < P.length; i++) {
        const q = P[i];
        q.life -= dt; q.rot += q.spin * dt;
        let back = false;
        if (q.boom) {
          const pl = this.player;
          if (q.out) {
            const step = q.speed * dt;
            q.x += q.vx * dt; q.y += q.vy * dt; q.trav += step;
            if (q.trav >= q.maxD) { q.out = false; q.hit.length = 0; }
          } else {
            const dx = pl.x - q.x, dy = pl.y - q.y, d = Math.hypot(dx, dy) || 1, sp = q.speed * 1.2;
            q.vx = (dx / d) * sp; q.vy = (dy / d) * sp;
            q.x += q.vx * dt; q.y += q.vy * dt;
            if (d < 36) back = true;
          }
        } else { q.x += q.vx * dt; q.y += q.vy * dt; }
        let alive = !back && q.life > 0 && q.x > -100 && q.y > -100 && q.x < PG.WORLD_W + 100 && q.y < PG.WORLD_H + 100;
        if (alive) {
          this.forNear(q.x, q.y, q.r, e => {
            if (!alive || e.dead) return;
            const dx = e.x - q.x, dy = e.y - q.y, rr = q.r + e.r * 0.85;
            if (dx * dx + dy * dy < rr * rr && q.hit.indexOf(e.id) === -1) {
              q.hit.push(e.id);
              const sp = Math.hypot(q.vx, q.vy) || 1;
              this.damageEnemy(e, q.dmg, (q.vx / sp) * 200, (q.vy / sp) * 200);
              if (q.pierce-- <= 0) { alive = false; if (!this.headless) this.burst(q.x, q.y, 2, ['#ffffff', '#f4e9a8']); }
            }
          });
        }
        if (alive) P[w++] = q;
      }
      P.length = w;
    }
    updateGems(dt) {
      const p = this.player, G = this.gems;
      const mr = 95 * this.mods.magnet, mr2 = mr * mr;
      let w = 0;
      for (let i = 0; i < G.length; i++) {
        const g = G[i];
        const dx = p.x - g.x, dy = p.y - g.y, d2 = dx * dx + dy * dy;
        if (d2 < mr2) g.pull = true;
        if (g.pull) {
          const d = Math.sqrt(d2) || 1;
          g.sp = Math.min(1100, g.sp + 2600 * dt);
          const step = Math.min(d, g.sp * dt);
          g.x += (dx / d) * step; g.y += (dy / d) * step;
          if (d < 30) {
            if (g.t === 3) { const v = Math.max(1, Math.round(g.v * (1 + this.mods.luck) * this.mods.moolahMul)); this.moolah += v; PG.audio.sfx('gem'); }
            else { this.addXp(g.v); PG.audio.sfx('gem'); }
            continue;
          }
        }
        G[w++] = g;
      }
      G.length = w;
      // pickups
      const K = this.pickups;
      let kw = 0;
      for (let i = 0; i < K.length; i++) {
        const k = K[i];
        const dx = p.x - k.x, dy = p.y - k.y, d2 = dx * dx + dy * dy;
        const rr = k.k === 'treasure' ? 90 : 65;
        if (d2 < rr * rr) {
          if (k.k === 'pie') { if (p.hp < p.maxHp) { p.hp = Math.min(p.maxHp, p.hp + 30); PG.audio.sfx('pick'); this.burst(k.x, k.y, 6, ['#f4c37a', '#ffffff']); continue; } }
          else if (k.k === 'magnet') { for (const g of G) g.pull = true; PG.audio.sfx('pick'); this.ui.banner('Paperclip magnet!'); continue; }
          else if (k.k === 'treasure') { this.pending.push('TREASURE!'); PG.audio.sfx('pick'); this.burst(k.x, k.y, 14, ['#ffe27a', '#ffffff', '#ffb347']); continue; }
        }
        K[kw++] = k;
      }
      K.length = kw;
    }
    updateParts(dt) {
      const A = this.parts;
      let w = 0;
      for (let i = 0; i < A.length; i++) {
        const a = A[i];
        a.life -= dt;
        if (a.life <= 0) continue;
        a.x += a.vx * dt; a.y += a.vy * dt;
        const f = Math.exp(-4 * dt); a.vx *= f; a.vy *= f;
        A[w++] = a;
      }
      A.length = w;
    }

    stats() {
      return { time: this.t, level: this.player.level, kills: this.kills, moolah: this.moolah, char: this.char, diff: this.diffId };
    }

    /* ------------------------------------------------------------------ render */
    render() {
      const ctx = this.ctx, z = this.z;
      if (!this.player) return;
      if (!this.bgPattern && PG.bgTile) this.bgPattern = ctx.createPattern(PG.bgTile, 'repeat');
      let cx = this.cx, cy = this.cy;
      if (this.shake > 0) { const sh = this.shake * PG.settings.shake; cx += rnd(-1, 1) * sh; cy += rnd(-1, 1) * sh; }
      this.rcx = cx; this.rcy = cy;
      const p = this.player, t = this.t;
      const vw = this.viewW, vh = this.viewH;
      // desk behind the paper
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#7a6650';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      const base = () => ctx.setTransform(z, 0, 0, z, -cx * z, -cy * z);
      base();
      // paper
      const x0 = Math.max(0, cx), y0 = Math.max(0, cy), x1 = Math.min(PG.WORLD_W, cx + vw), y1 = Math.min(PG.WORLD_H, cy + vh);
      ctx.fillStyle = this.bgPattern || '#f4f4f4';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 8;
      ctx.strokeRect(0, 0, PG.WORLD_W, PG.WORLD_H);

      const inView = (x, y, m) => x > cx - m && x < cx + vw + m && y > cy - m && y < cy + vh + m;

      // ground layer: gems, pickups, boss telegraphs
      for (const g of this.gems) {
        if (!inView(g.x, g.y, 40)) continue;
        if (g.t === 3) { const s = 0.75 + Math.sin(t * 5 + g.ph) * 0.05; ctx.drawImage(PG.img.money, g.x - 25 * s, g.y - 25 * s, 50 * s, 50 * s); }
        else { const gs = 45 + g.t * 6, bob = Math.sin(t * 4 + g.ph) * 3; ctx.drawImage(PG.gemImg[g.t], g.x - gs / 2, g.y - gs / 2 + bob, gs, gs); }
      }
      for (const k of this.pickups) {
        if (!inView(k.x, k.y, 120)) continue;
        const bob = Math.sin(t * 3 + k.ph) * 5;
        if (k.k === 'pie') ctx.drawImage(PG.img.pie, k.x - 30, k.y - 30 + bob, 60, 60);
        else if (k.k === 'magnet') this.spr(PG.img.magnet, k.x, k.y + bob, 1.5, Math.sin(t * 2 + k.ph) * 0.3, 1);
        else {
          const gl = ctx.createRadialGradient(k.x, k.y, 10, k.x, k.y, 90);
          gl.addColorStop(0, 'rgba(255,226,122,0.75)'); gl.addColorStop(1, 'rgba(255,226,122,0)');
          ctx.fillStyle = gl; ctx.fillRect(k.x - 90, k.y - 90, 180, 180);
          ctx.drawImage(PG.img.cBackpack, k.x - 45, k.y - 45 + bob, 90, 90);
          ctx.strokeStyle = '#141414'; ctx.lineWidth = 4; ctx.strokeRect(k.x - 45, k.y - 45 + bob, 90, 90);
        }
      }
      for (const e of this.enemies) {
        if (e.aiS === 1 && inView(e.x, e.y, 200)) {
          ctx.strokeStyle = 'rgba(220,30,30,' + (0.4 + 0.4 * Math.sin(t * 30)) + ')'; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.arc(e.x, e.y + e.r * 0.4, e.r * (1.1 + 0.4 * (1 - e.aiT / (e.ai === 'charge' ? 0.9 : 0.45))), 0, TAU); ctx.stroke();
        }
      }

      // depth-sorted layer
      const list = this._list || (this._list = []);
      const pool = this._pool || (this._pool = []);
      list.length = 0;
      let pn = 0;
      const add = (sy, o, k) => { let it = pool[pn]; if (!it) it = pool[pn] = { sy: 0, o: null, k: 0 }; pn++; it.sy = sy; it.o = o; it.k = k; list.push(it); };
      for (const o of this.obstacles) {
        if (o.x + o.hw < cx || o.x - o.hw > cx + vw || o.y + o.hh < cy || o.y - o.hh > cy + vh) continue;
        add(o.sortY, o, 0);
      }
      for (const e of this.enemies) {
        if (!inView(e.x, e.y, 130)) continue;
        e.sy = e.y + e.r * 0.6;
        add(e.sy, e, 1);
      }
      add(p.y + 55, p, 2);
      list.sort((a, b) => a.sy - b.sy);
      for (let i = 0; i < list.length; i++) {
        const it = list[i], o = it.o;
        if (it.k === 0) this.spr(o.img, o.x, o.y, o.scale, 0, 1);
        else if (it.k === 1) this.drawEnemy(o, t);
        else this.drawPlayer(p, t);
      }

      // paws + projectiles on top
      for (const w of this.weapons) {
        if (w.def.kind !== 'orbit' || !w.active) continue;
        const s = w.eff, n = s.count;
        const fade = w.actT < 0.3 ? w.actT / 0.3 : 1;
        ctx.globalAlpha = fade;
        for (let k = 0; k < n; k++) {
          const a = w.angle + (k / n) * TAU;
          this.spr(PG.img.paw, p.x + Math.cos(a) * s.radius, p.y + Math.sin(a) * s.radius, 1.25 * s.size, a + Math.PI / 2, 1);
        }
        ctx.globalAlpha = 1;
      }
      for (const q of this.projs) {
        if (!inView(q.x, q.y, 40)) continue;
        this.spr(PG.img[q.img], q.x, q.y, 1.1 * q.size, (q.img === 'star' || q.boom) ? q.rot : q.ang + Math.sin(q.rot) * 0.6, 1);
      }
      for (const w of this.weapons) {
        if (w.def.kind !== 'flock' || !w.birds) continue;
        const img = PG.img[w.def.flyIcon], s = w.eff;
        for (const b of w.birds) {
          if (!inView(b.x, b.y, 60)) continue;
          const tx = p.x + Math.cos(b.ang) * s.radius, ty = p.y + Math.sin(b.ang) * s.radius;
          const ang = Math.atan2(ty - b.y, tx - b.x) + Math.PI; // crane art faces left by default
          this.spr(img, b.x, b.y, 1.1 * s.size, ang, 1);
        }
      }

      // weapon effects: pies in flight, splats, shockwaves
      for (const f of this.fx) {
        if (f.t < 0) continue;
        if (f.k === 'lob') {
          const u = f.t / f.dur, x = f.sx + (f.tx - f.sx) * u, y = f.sy + (f.ty - f.sy) * u, h = Math.sin(Math.PI * u) * 170;
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          ctx.beginPath(); ctx.ellipse(x, y + 6, 22 * (1 - h / 400), 9, 0, 0, TAU); ctx.fill();
          ctx.strokeStyle = 'rgba(200,60,40,0.35)'; ctx.lineWidth = 3; ctx.setLineDash([8, 8]);
          ctx.beginPath(); ctx.arc(f.tx, f.ty, f.rad * 0.7, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
          this.spr(PG.img.pie, x, y - h, 1.3 + h / 300, f.rot + u * 9, 1);
        } else if (f.k === 'splat') {
          const u = f.t / f.dur, r = f.rad * (0.65 + 0.35 * Math.min(1, u * 3));
          ctx.globalAlpha = (1 - u) * 0.85;
          ctx.fillStyle = '#e8a15c'; ctx.strokeStyle = '#141414'; ctx.lineWidth = 5;
          ctx.beginPath();
          for (let k = 0; k <= 14; k++) { const a = (k / 14) * TAU, rr = r * (0.86 + 0.14 * Math.sin(k * 2.7 + f.x)); ctx[k ? 'lineTo' : 'moveTo'](f.x + Math.cos(a) * rr, f.y + Math.sin(a) * rr * 0.86); }
          ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.globalAlpha = 1;
        } else if (f.k === 'nova') {
          const u = Math.min(1, f.t / f.dur), r = f.R * u;
          ctx.globalAlpha = 1 - u * 0.85;
          ctx.strokeStyle = f.col; ctx.lineWidth = 14 * (1 - u * 0.6) + 2;
          ctx.setLineDash([26, 14]);
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineWidth = 4; ctx.strokeStyle = '#d8262b';
          ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.93, 0, TAU); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      // particles
      for (const a of this.parts) {
        ctx.globalAlpha = Math.min(1, a.life / 0.25);
        ctx.fillStyle = a.col;
        ctx.fillRect(a.x - a.size / 2, a.y - a.size / 2, a.size, a.size);
      }
      ctx.globalAlpha = 1;

      // player health bar (same idea as the Python version: red backing, green fill above the head)
      if (!p.dead) {
        const bw = 96, bh = 10, bx = p.x - bw / 2, by = p.y - 88;
        ctx.fillStyle = '#000'; ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
        ctx.fillStyle = '#8b1a1a'; ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = '#2bbd3f'; ctx.fillRect(bx, by, bw * clamp(p.hp / p.maxHp, 0, 1), bh);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // draw a sprite centred at world (x,y) with scale/rotation/flip, in world units
    spr(img, x, y, sc, ang, flip) {
      const ctx = this.ctx, z = this.z;
      const k = sc * z, c = Math.cos(ang), s = Math.sin(ang);
      ctx.setTransform(flip * k * c, flip * k * s, -k * s, k * c, (x - this.rcx) * z, (y - this.rcy) * z);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.setTransform(z, 0, 0, z, -this.rcx * z, -this.rcy * z);
    }
    // Pre-rotated, pre-scaled copy of a sprite (one per wobble step) so a crowd of enemies is just 1:1 blits.
    rotated(img, scale, step) {
      if (img.__epoch !== this.cacheEpoch) { img.__c = {}; img.__epoch = this.cacheEpoch; }
      const key = (step + 8) * 1000 + Math.round(scale * 100);
      let c = img.__c[key];
      if (c) return c;
      const k = scale * this.z, ang = step * 0.034;
      const cs = Math.abs(Math.cos(ang)), sn = Math.abs(Math.sin(ang));
      const w = img.width * k, h = img.height * k;
      c = document.createElement('canvas');
      c.width = Math.ceil(w * cs + h * sn) + 2;
      c.height = Math.ceil(w * sn + h * cs) + 2;
      const x = c.getContext('2d');
      x.translate(c.width / 2, c.height / 2);
      x.rotate(ang);
      x.scale(k, k);
      x.drawImage(img, -img.width / 2, -img.height / 2);
      img.__c[key] = c;
      return c;
    }
    drawEnemy(e, t) {
      const ctx = this.ctx, z = this.z;
      let step = Math.round(Math.sin(t * 10 + e.phase) * 0.17 / 0.034);   // same +-10 degree wobble as the Python enemies
      const ox = e.aiS === 1 ? Math.sin(t * 60) * 4 : 0;
      const sx = (e.x + ox - this.rcx) * z, sy = (e.y - this.rcy) * z;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const c = this.rotated(e.img, e.scale, step);
      ctx.drawImage(c, Math.round(sx - c.width / 2), Math.round(sy - c.height / 2));
      if (e.flash > 0 && e.sil) {
        const f = this.rotated(e.sil, e.scale, step);
        ctx.globalAlpha = 0.75;
        ctx.drawImage(f, Math.round(sx - f.width / 2), Math.round(sy - f.height / 2));
        ctx.globalAlpha = 1;
      }
      ctx.setTransform(z, 0, 0, z, -this.rcx * z, -this.rcy * z);
    }
    drawPlayer(p, t) {
      const ch = this.char;
      let key = ch.stand;
      if (p.moving) key = ch.move[Math.floor(p.animT / ch.frameTime) % ch.move.length];
      const img = PG.img[key];
      const ctx = this.ctx;
      if (p.dead) {
        const f = clamp(this.deadT / 1.4, 0, 1);
        ctx.globalAlpha = 1 - f;
        this.spr(img, p.x, p.y + f * 30, 1, f * 1.2 * p.face, p.face);
        ctx.globalAlpha = 1;
        return;
      }
      if (p.inv > 0 && Math.floor(t * 20) % 2 === 0) ctx.globalAlpha = 0.5;
      this.spr(img, p.x, p.y, 1, p.moving ? Math.sin(t * 14) * 0.05 : 0, p.face);
      ctx.globalAlpha = 1;
    }
  }

  PG.Game = Game;
})();
