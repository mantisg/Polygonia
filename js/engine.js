/* engine.js - asset loading, input, audio and small helpers. No game rules in here. */
(function () {
  const PG = (window.PG = window.PG || {});

  /* --------------------------------------------------------------- helpers */
  PG.rnd = (a, b) => a + Math.random() * (b - a);
  PG.rndi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  PG.pick = arr => arr[Math.floor(Math.random() * arr.length)];
  PG.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  PG.fmtTime = s => {
    s = Math.max(0, Math.floor(s));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };

  /* ------------------------------------------------------------- persistence */
  PG.save = {
    data: { bestTime: 0, moolah: 0, runs: 0, wins: 0, kills: 0, muted: false, perks: {}, unlocked: {}, best: {}, winsBy: {}, achievements: {}, charsWon: {}, settings: null },
    load() {
      try {
        const raw = localStorage.getItem('polygonia-escape-from-2d');
        if (raw) Object.assign(this.data, JSON.parse(raw));
      } catch (e) { /* storage unavailable - fine */ }
      const d = this.data;   // older saves lack the archive fields
      if (!d.perks || typeof d.perks !== 'object') d.perks = {};
      if (!d.unlocked || typeof d.unlocked !== 'object') d.unlocked = {};
      if (!d.best || typeof d.best !== 'object') d.best = {};
      d.kills = d.kills || 0;
      if (!d.winsBy || typeof d.winsBy !== 'object') d.winsBy = {};
      if (!d.achievements || typeof d.achievements !== 'object') d.achievements = {};
      if (!d.charsWon || typeof d.charsWon !== 'object') d.charsWon = {};
      this.fixSettings();
    },
    // fill anything missing with defaults (older saves have no settings at all)
    fixSettings() {
      const d = this.data, S = d.settings || {};
      const st = Object.assign({}, PG.DEFAULT_SETTINGS, S);
      st.keys = {};
      for (const a of PG.ACTIONS) {
        const v = S.keys && Array.isArray(S.keys[a.id]) ? S.keys[a.id] : PG.DEFAULT_KEYS[a.id];
        st.keys[a.id] = [v[0] || '', v[1] || ''];
      }
      if (!PG.DIFFICULTIES[st.difficulty]) st.difficulty = 'normal';
      d.settings = PG.settings = st;
    },
    /* wipe every bit of progress (moolah, perks, unlocks, records). Settings and key bindings are kept. */
    resetProgress() {
      const d = this.data;
      d.moolah = 0; d.runs = 0; d.wins = 0; d.kills = 0; d.bestTime = 0;
      d.perks = {}; d.unlocked = {}; d.best = {}; d.winsBy = {};
      this.write();
    },
    resetSettings() {
      this.data.settings = null;
      this.fixSettings();
      this.write();
    },
    write() {
      try { localStorage.setItem('polygonia-escape-from-2d', JSON.stringify(this.data)); } catch (e) { /* ignore */ }
    },
    rank(id) { return this.data.perks[id] || 0; },
    /* moolah earned by a run: pickups + survival + kills (+ a bonus for escaping) */
    reward(won, s) {
      const r = { pickups: s.moolah, time: Math.floor(s.time / 3), kills: Math.floor(s.kills / 25), win: won ? 500 : 0 };
      const dd = PG.DIFFICULTIES[s.diff] || PG.DIFFICULTIES.normal;
      r.mult = dd.reward; r.diffName = dd.name;
      r.total = Math.round((r.pickups + r.time + r.kills + r.win) * dd.reward);
      return r;
    },
    recordRun(won, s) {
      const d = this.data, r = this.reward(won, s);
      d.runs++; d.kills += s.kills; d.moolah += r.total;
      if (won) { d.wins++; d.winsBy[s.diff] = (d.winsBy[s.diff] || 0) + 1; }
      if (s.time > d.bestTime) d.bestTime = s.time;
      const id = s.char.id;
      if (s.time > (d.best[id] || 0)) d.best[id] = s.time;
      this.write();
      return r;
    },
    buyPerk(id) {
      const p = PG.perkById(id), d = this.data, rk = this.rank(id);
      if (!p || rk >= p.max) return false;
      const c = PG.perkCost(p, rk);
      if (d.moolah < c) return false;
      d.moolah -= c; d.perks[id] = rk + 1; this.write();
      if (this.archiveComplete()) this.unlockAch('ACH_ARCHIVE');
      return true;
    },
    buyUnlock(kind, id) {
      const def = (kind === 'weapon' ? PG.WEAPONS : PG.PASSIVES)[id], d = this.data;
      if (!def || !def.cost || PG.isOpen(kind, id) || d.moolah < def.cost) return false;
      d.moolah -= def.cost; d.unlocked[kind + ':' + id] = 1; this.write();
      if (this.archiveComplete()) this.unlockAch('ACH_ARCHIVE');
      return true;
    },
    /* full refund of every perk rank (unlocks stay bought) */
    refundPerks() {
      const d = this.data; let back = 0;
      PG.PERKS.forEach(p => { for (let i = 0; i < this.rank(p.id); i++) back += PG.perkCost(p, i); });
      d.perks = {}; d.moolah += back; this.write();
      return back;
    },
    /* is there anything in the Archive the player can afford right now? */
    canAfford() {
      const d = this.data;
      for (const p of PG.PERKS) { const rk = this.rank(p.id); if (rk < p.max && d.moolah >= PG.perkCost(p, rk)) return true; }
      for (const id in PG.WEAPONS) if (PG.WEAPONS[id].cost && !PG.isOpen('weapon', id) && d.moolah >= PG.WEAPONS[id].cost) return true;
      for (const id in PG.PASSIVES) if (PG.PASSIVES[id].cost && !PG.isOpen('passive', id) && d.moolah >= PG.PASSIVES[id].cost) return true;
      return false;
    },
    /* every perk maxed and every gated weapon/passive bought */
    archiveComplete() {
      for (const p of PG.PERKS) if (this.rank(p.id) < p.max) return false;
      for (const id in PG.WEAPONS) if (PG.WEAPONS[id].cost && !PG.isOpen('weapon', id)) return false;
      for (const id in PG.PASSIVES) if (PG.PASSIVES[id].cost && !PG.isOpen('passive', id)) return false;
      return true;
    },

    /* -------------------------------------------------------- achievements */
    hasAch(id) { return !!this.data.achievements[id]; },
    /* unlock once, persist, toast, and (in the Tauri desktop build) tell Steam. Safe to call repeatedly. */
    unlockAch(id) {
      const d = this.data, a = PG.achById(id);
      if (!a || d.achievements[id]) return false;
      d.achievements[id] = Date.now();
      this.write();
      PG.steam.unlock(id);
      if (PG.ui && PG.ui.achToast) PG.ui.achToast(a);
      return true;
    },
  };

  /* ------------------------------------------------------- Steam (desktop build) */
  // No-op in the browser. Inside the Tauri desktop wrapper (see src-tauri/), window.__TAURI__
  // is present and this calls the `unlock_achievement` command, which forwards to Steamworks
  // when the app was built with the `steam` Cargo feature (see src-tauri/src/achievements.rs).
  PG.steam = {
    available: false,
    init() {
      this.available = typeof window !== 'undefined' && !!(window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke);
    },
    unlock(id) {
      if (!this.available) return;
      try { window.__TAURI__.core.invoke('unlock_achievement', { id }); } catch (e) { /* ignore - never let a Steam call break the game */ }
    },
  };

  /* ---------------------------------------------------------------- assets */
  PG.img = {};   // key -> HTMLImageElement
  PG.sil = {};   // key -> white silhouette canvas (hit flash)
  PG.gemImg = []; // tinted paperclip gems: blue, yellow, pink

  PG.loadAssets = function (onProgress) {
    const keys = Object.keys(PG.ASSETS);
    let done = 0;
    return Promise.all(keys.map(k => new Promise(res => {
      const im = new Image();
      im.onload = im.onerror = () => {
        PG.img[k] = im;
        done++;
        if (onProgress) onProgress(done / keys.length);
        res();
      };
      im.src = 'assets/' + PG.ASSETS[k];
    }))).then(() => {
      // white silhouettes for the enemy hit-flash
      Object.keys(PG.ENEMIES).forEach(k => {
        const key = PG.ENEMIES[k].sprite;
        if (PG.sil[key] || !PG.img[key] || !PG.img[key].width) return;
        const c = document.createElement('canvas');
        c.width = PG.img[key].width; c.height = PG.img[key].height;
        const x = c.getContext('2d');
        x.drawImage(PG.img[key], 0, 0);
        x.globalCompositeOperation = 'source-in';
        x.fillStyle = '#fff';
        x.fillRect(0, 0, c.width, c.height);
        PG.sil[key] = c;
      });
      // the three exp gem art files are identical, so tint them to the colours on the Exp card
      const src = PG.img.gem;
      [0, 170, 90].forEach(deg => {
        const c = document.createElement('canvas');
        c.width = src.width; c.height = src.height;
        const x = c.getContext('2d');
        try { x.filter = 'hue-rotate(' + deg + 'deg) saturate(1.4)'; } catch (e) { /* older browsers */ }
        x.drawImage(src, 0, 0);
        PG.gemImg.push(c);
      });
      // paper background tile with the thin grid border the Python version drew on every tile
      const bg = PG.img.bg;
      const t = document.createElement('canvas');
      t.width = bg.width; t.height = bg.height;
      const tx = t.getContext('2d');
      tx.drawImage(bg, 0, 0);
      tx.strokeStyle = 'rgba(0,0,0,0.2)';
      tx.lineWidth = 1;
      tx.strokeRect(0.5, 0.5, t.width - 1, t.height - 1);
      PG.bgTile = t;
    });
  };

  /* ----------------------------------------------------------------- input */
  PG.input = {
    keys: {}, capture: null,
    keyName(e) { return e.key === ' ' ? 'space' : e.key.toLowerCase(); },
    is(action, k) { return PG.settings.keys[action].indexOf(k) !== -1; },
    down(action) { const b = PG.settings.keys[action]; return !!((b[0] && this.keys[b[0]]) || (b[1] && this.keys[b[1]])); },
    init() {
      window.addEventListener('keydown', e => {
        const k = this.keyName(e);
        if (this.capture) {            // options screen is waiting for a key to bind
          e.preventDefault();
          if (e.repeat) return;
          const cb = this.capture; this.capture = null; cb(k);
          return;
        }
        this.keys[k] = true;
        const typing = e.target && e.target.matches && e.target.matches('textarea,input[type=text]');
        if (!typing && (k === 'space' || k.startsWith('arrow') || ['up', 'down', 'left', 'right'].some(a => this.is(a, k)))) e.preventDefault();
        if (this.onKey) this.onKey(k, e);
      });
      window.addEventListener('keyup', e => { this.keys[this.keyName(e)] = false; });
      window.addEventListener('blur', () => { this.keys = {}; });
    },
    axis() {
      let x = 0, y = 0;
      if (this.down('left')) x -= 1;
      if (this.down('right')) x += 1;
      if (this.down('up')) y -= 1;
      if (this.down('down')) y += 1;
      if (this.override) return this.override();   // used by the test bot
      return { x, y };
    },
  };

  /* ----------------------------------------------------------------- audio */
  PG.audio = {
    ctx: null, music: null, trackCache: {}, curKey: null, curList: null, listIdx: {}, muted: false, last: {}, ducked: false,
    init() {
      this.muted = !!PG.save.data.muted;
    },
    unlock() {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    getTrack(url) {
      if (!this.trackCache[url]) {
        const a = new Audio(url);
        a.preload = 'auto';
        this.trackCache[url] = a;
      }
      return this.trackCache[url];
    },
    // key is 'run' or 'menu'; spec is that context's file, a list of files to alternate between run to run, or
    // null/undefined for silence (e.g. no menu track yet). A multi-track spec loops the list, moving to the next
    // track each time one ends, so the player isn't stuck hearing the same song on repeat.
    playTrack(key, spec) {
      this.unlock();
      if (this.curKey === key) { this.applyVolume(); return; }   // already the active context
      if (this.music) { this.music.pause(); this.music.onended = null; }
      this.curKey = key;
      const list = Array.isArray(spec) ? spec.filter(Boolean) : (spec ? [spec] : []);
      this.curList = list;
      if (!list.length) { this.music = null; return; }
      if (this.listIdx[key] == null) this.listIdx[key] = 0;
      this._playListTrack(key);
    },
    _playListTrack(key) {
      const list = this.curList, idx = this.listIdx[key] % list.length;
      const a = this.getTrack(list[idx]);
      a.loop = list.length <= 1;   // a single track loops itself; a playlist advances on 'ended' instead
      a.muted = this.muted;
      try { a.currentTime = 0; } catch (e) { /* not loaded yet - fine, plays from the start anyway */ }
      this.music = a;
      this.applyVolume();
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
      a.onended = list.length > 1 ? () => {
        if (this.curKey !== key) return;   // the player left this context while the track was playing
        this.listIdx[key] = (idx + 1) % list.length;
        this._playListTrack(key);
      } : null;
    },
    stopMusic() { if (this.music) { this.music.pause(); this.music.onended = null; } this.curKey = null; },
    setMuted(m) {
      this.muted = m;
      PG.save.data.muted = m;
      PG.save.write();
      Object.values(this.trackCache).forEach(a => { a.muted = m; });
    },
    // music slider 0..1 -> element volume (0.7 default == the original 0.32); sfx slider scales the synth blips
    applyVolume() { if (this.music) this.music.volume = Math.min(1, 0.457 * PG.settings.music * (this.ducked ? 0.44 : 1)); },
    duck(on) { this.ducked = on; this.applyVolume(); },
    // tiny synth blips so the game has feedback without any extra audio files
    sfx(name) {
      if (this.muted || !this.ctx || PG.settings.sfx <= 0) return;
      const now = this.ctx.currentTime;
      const gap = { hit: 0.045, gem: 0.035, kill: 0.03 }[name] || 0.02;
      if (this.last[name] && now - this.last[name] < gap) return;
      this.last[name] = now;
      const S = {
        hit:   { f: 220, f2: 120, t: 0.06, type: 'square',   v: 0.05 },
        kill:  { f: 380, f2: 200, t: 0.08, type: 'triangle', v: 0.05 },
        gem:   { f: 660, f2: 990, t: 0.07, type: 'sine',     v: 0.05 },
        pick:  { f: 520, f2: 880, t: 0.16, type: 'triangle', v: 0.09 },
        hurt:  { f: 180, f2: 70,  t: 0.22, type: 'sawtooth', v: 0.10 },
        level: { f: 523, f2: 1046, t: 0.35, type: 'triangle', v: 0.12 },
        boss:  { f: 110, f2: 55,  t: 0.7,  type: 'sawtooth', v: 0.13 },
        die:   { f: 330, f2: 40,  t: 0.9,  type: 'sawtooth', v: 0.14 },
        win:   { f: 440, f2: 1320, t: 0.9, type: 'triangle', v: 0.14 },
        click: { f: 500, f2: 700, t: 0.07, type: 'square',   v: 0.05 },
      }[name];
      if (!S) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = S.type;
      o.frequency.setValueAtTime(S.f, now);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, S.f2), now + S.t);
      const vol = S.v * (PG.settings.sfx / 0.8);
      g.gain.setValueAtTime(Math.max(0.0002, vol), now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + S.t);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(now); o.stop(now + S.t + 0.02);
    },
  };
})();
