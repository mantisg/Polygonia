/* ui.js - DOM screens and the HUD. The game talks to this through PG.ui. */
(function () {
  const PG = window.PG;
  const $ = id => document.getElementById(id);
  const asset = key => 'assets/' + PG.ASSETS[key];

  const ui = (PG.ui = {
    screens: ['loading', 'title', 'select', 'level', 'pause', 'end', 'archive', 'options'],
    opts: null, archiveFrom: 'title', refundArmed: false,
    choiceCb: null, choices: [], selIndex: 0,
    last: {},

    show(name) {
      this.screens.forEach(s => $('screen-' + s).classList.toggle('hidden', s !== name));
    },
    hideAll() { this.show(null); },

    /* ---- title / select ---- */
    initTitle() {
      const b = PG.save.data;
      $('title-best').textContent = b.bestTime > 0
        ? 'Best run: ' + PG.fmtTime(b.bestTime) + '   |   Moolah banked: ' + b.moolah + '   |   Escapes: ' + b.wins
        : 'Survive 20 minutes. Escape from 2-D.';
      $('arch-dot').classList.toggle('hidden', !PG.save.canAfford());
    },
    buildSelect(onPick) {
      const wrap = $('cards');
      wrap.innerHTML = '';
      this.portraits = [];
      PG.CHARACTERS.forEach(ch => {
        const w = PG.WEAPONS[ch.weapon];
        const d = document.createElement('div');
        d.className = 'char';
        d.innerHTML =
          '<img class="portrait" src="' + asset(ch.stand) + '" alt="' + ch.name + '">' +
          '<div class="cname">' + ch.name + '</div>' +
          '<div class="blurb">' + ch.blurb + '</div>' +
          '<div class="wpn"><img src="' + asset(w.icon) + '" alt=""><span>' + w.name + '</span></div>';
        d.addEventListener('click', () => { PG.audio.sfx('click'); onPick(ch.id); });
        const im = d.querySelector('img.portrait');
        d.addEventListener('mouseenter', () => { im.dataset.walk = '1'; });
        d.addEventListener('mouseleave', () => { im.dataset.walk = ''; im.src = asset(ch.stand); });
        this.portraits.push({ im, ch });
        wrap.appendChild(d);
      });
      // little walk-cycle on hover using the character's own frames
      let f = 0;
      setInterval(() => {
        f++;
        this.portraits.forEach(p => {
          if (p.im.dataset.walk) p.im.src = asset(p.ch.move[f % p.ch.move.length]);
        });
      }, 300);
    },

    /* ---- level-up / treasure ---- */
    showChoices(choices, title, cb, opts) {
      this.choices = choices; this.choiceCb = cb; this.opts = opts || null;
      $('level-title').textContent = title;
      $('level-title').style.color = title === 'TREASURE!' ? '#d19a00' : '';
      this.drawChoices();
      PG.audio.duck(true);
      this.show('level');
    },
    doReroll() {
      if (!this.choiceCb || !this.opts || !this.opts.reroll) return;
      const c = this.opts.reroll();
      if (!c) return;
      PG.audio.sfx('click');
      this.choices = c;
      this.drawChoices();
    },
    drawChoices() {
      const choices = this.choices, opts = this.opts;
      this.selIndex = 0;
      const rb = $('reroll'), left = opts && opts.left ? opts.left() : 0;
      rb.classList.toggle('hidden', !opts || !opts.reroll || left <= 0);
      rb.textContent = 'Keep Tabs (R) - ' + left + ' left';
      const wrap = $('choices');
      wrap.innerHTML = '';
      choices.forEach((c, i) => {
        const d = document.createElement('div');
        d.className = 'choice';
        const isCard = c.icon.charAt(0) === 'c' && c.icon.length > 3 && c.icon !== 'confetti';
        d.innerHTML =
          '<div class="tag">' + c.tag + '</div>' +
          '<img class="art' + (isCard ? '' : ' sprite') + '" src="' + asset(c.icon) + '" alt="">' +
          (isCard ? '' : '<div class="nm">' + c.name + '</div>') +
          '<div class="nm" style="font-size:16px;margin-top:0;">' + (c.lvl ? '<span class="lv">Lv ' + c.lvl + '</span>' : '') + '</div>' +
          '<div class="txt">' + c.text + '</div>' +
          '<div class="key">' + (i + 1) + '</div>';
        if ((c.kind === 'heal' || c.kind === 'money') && this.opts && this.opts.setAuto) {
          const b = document.createElement('button');
          b.className = 'pbtn auto';
          b.textContent = c.kind === 'heal' ? 'Always Pie' : 'Always Moolah';
          b.addEventListener('click', e => { e.stopPropagation(); this.opts.setAuto(c.kind); this.pickChoice(i); });
          d.appendChild(b);
        }
        d.addEventListener('mouseenter', () => { this.selIndex = i; this.highlightSel(); });
        d.addEventListener('click', () => this.pickChoice(i));
        wrap.appendChild(d);
      });
      this.highlightSel();
    },
    // arrow-key navigation of the level-up cards, so a keyboard/arrow-key player never has to reach for the mouse
    highlightSel() {
      const cards = $('choices').querySelectorAll('.choice');
      cards.forEach((c, i) => c.classList.toggle('sel', i === this.selIndex));
    },
    moveSel(delta) {
      const n = this.choices.length;
      if (!n) return;
      this.selIndex = (this.selIndex + delta + n) % n;
      this.highlightSel();
      PG.audio.sfx('click');
    },
    confirmSel() { this.pickChoice(this.selIndex); },
    pickChoice(i) {
      if (!this.choiceCb || !this.choices[i]) return;
      const cb = this.choiceCb, c = this.choices[i];
      this.choiceCb = null;
      PG.audio.sfx('pick');
      PG.audio.duck(false);
      this.hideAll();
      cb(c);
    },

    /* ---- pause ---- */
    showPause(game) {
      const inv = $('pause-inv');
      const wl = game.weapons.map(w => '<div class="line"><img src="' + asset(w.def.icon) + '"><span>' + w.def.name + ' &nbsp;Lv ' + w.level + (w.level >= w.def.max ? ' (MAX)' : '') + '</span></div>').join('');
      const pl = Object.keys(game.passives).map(id => {
        const d = PG.PASSIVES[id];
        return '<div class="line"><img src="' + asset(d.icon) + '"><span>' + d.name + ' &nbsp;Lv ' + game.passives[id] + ' - ' + d.lv + '</span></div>';
      }).join('') || '<div class="line">none yet</div>';
      inv.innerHTML = '<div class="col"><h3>Weapons</h3>' + wl + '</div><div class="col"><h3>Passives</h3>' + pl + '</div>';
      PG.audio.duck(true);
      this.show('pause');
    },

    /* ---- end of run ---- */
    showEnd(won, s) {
      const t = $('end-title');
      t.textContent = won ? 'You escaped 2-D!' : 'Crumpled!';
      t.className = 'marker ' + (won ? 'win' : 'lose');
      $('end-sub').textContent = won ? s.char.name + ' made it to the third dimension.' : s.char.name + ' was folded up and tossed.';
      const r = PG.save.recordRun(won, s);
      $('end-stats').innerHTML =
        'Time survived: <b>' + PG.fmtTime(s.time) + '</b> &nbsp; Level: <b>' + s.level + '</b> &nbsp; Defeated: <b>' + s.kills + '</b>' +
        '<div class="reward">Filed in The Archive:<br>collected ' + r.pickups + ' + survived ' + r.time + ' + defeated ' + r.kills +
        (r.win ? ' + escaped ' + r.win : '') + (r.mult !== 1 ? ' (x' + r.mult + ' ' + r.diffName + ')' : '') + ' = <b>+' + r.total + ' moolah</b><br>Balance: <b>' + PG.save.data.moolah + '</b></div>';
      PG.audio.playTrack('menu', PG.MUSIC_MENU);   // the run is over - back to menu music (silence until one is set)
      this.show('end');
    },

    /* ---- the archive: permanent perks and unlocks ---- */
    openArchive(from) {
      this.archiveFrom = from || 'title';
      this.refundArmed = false;
      this.renderArchive();
      this.show('archive');
      $('screen-archive').scrollTop = 0;
    },
    closeArchive() {
      if (this.archiveFrom === 'title') this.initTitle();
      this.show(this.archiveFrom);
    },
    renderArchive() {
      const S = PG.save, d = S.data;
      $('arch-bal').textContent = d.moolah;
      let h = '<h2>Perks <small style="font-family:var(--hand);font-size:20px">- permanent, applied to every run</small></h2><div class="agrid">';
      PG.PERKS.forEach(p => {
        const rk = S.rank(p.id), maxed = rk >= p.max, c = maxed ? 0 : PG.perkCost(p, rk);
        let pips = '';
        for (let i = 0; i < p.max; i++) pips += i < rk ? '\u25CF' : '\u25CB';
        h += '<div class="acard' + (maxed ? ' maxed' : '') + '"><img src="' + asset(p.icon) + '" alt="">' +
          '<div class="an">' + p.name + '</div><div class="pips">' + pips + '</div>' +
          '<div class="ad">' + p.per + (p.max > 1 ? ' per rank' : '') + '</div>' +
          (maxed ? '<div class="own">MAXED</div>' : '<button class="pbtn" data-perk="' + p.id + '"' + (d.moolah < c ? ' disabled' : '') + '>Buy - ' + c + '</button>') + '</div>';
      });
      h += '</div><h2>Unlocks <small style="font-family:var(--hand);font-size:20px">- new things to find in level-ups</small></h2><div class="agrid">';
      const card = (kind, id, def) => {
        const open = PG.isOpen(kind, id);
        return '<div class="acard' + (open ? ' maxed' : '') + '"><img src="' + asset(def.icon) + '" alt="">' +
          '<div class="an">' + def.name + '</div><div class="pips">' + (kind === 'weapon' ? 'WEAPON' : 'PASSIVE') + '</div>' +
          '<div class="ad">' + (def.desc || '') + (kind === 'passive' ? ' (' + def.lv + ')' : '') + '</div>' +
          (open ? '<div class="own">UNLOCKED</div>' : '<button class="pbtn" data-unlock="' + kind + ':' + id + '"' + (d.moolah < def.cost ? ' disabled' : '') + '>Unlock - ' + def.cost + '</button>') + '</div>';
      };
      for (const id in PG.WEAPONS) if (PG.WEAPONS[id].cost) h += card('weapon', id, PG.WEAPONS[id]);
      for (const id in PG.PASSIVES) if (PG.PASSIVES[id].cost) h += card('passive', id, PG.PASSIVES[id]);
      h += '</div><h2>Records</h2><div class="arec">Runs: <b>' + d.runs + '</b> &nbsp;|&nbsp; Escapes: <b>' + d.wins + '</b> &nbsp;|&nbsp; Defeated: <b>' + d.kills + '</b><br>' +
        'Escapes by difficulty: ' + Object.keys(PG.DIFFICULTIES).map(k => PG.DIFFICULTIES[k].name + ' <b>' + (d.winsBy[k] || 0) + '</b>').join(' &nbsp;|&nbsp; ') + '<br>' +
        'Best time: <b>' + PG.fmtTime(d.bestTime) + '</b>' +
        PG.CHARACTERS.map(c => ' &nbsp;|&nbsp; ' + c.name + ': <b>' + PG.fmtTime(d.best[c.id] || 0) + '</b>').join('') + '</div>';
      const achN = PG.ACHIEVEMENTS.filter(a => S.hasAch(a.id)).length;
      h += '<h2>Achievements <small style="font-family:var(--hand);font-size:20px">- ' + achN + ' / ' + PG.ACHIEVEMENTS.length + '</small></h2><div class="agrid">';
      PG.ACHIEVEMENTS.forEach(a => {
        const got = S.hasAch(a.id);
        h += '<div class="acard ach-card' + (got ? ' maxed' : ' locked') + '">' +
          '<div class="ach-badge">' + (got ? '✓' : '?') + '</div>' +
          '<div class="an">' + a.name + '</div>' +
          '<div class="ad">' + a.desc + '</div>' +
          (got ? '<div class="ach-date">Unlocked ' + new Date(d.achievements[a.id]).toLocaleDateString() + '</div>' : '') + '</div>';
      });
      h += '</div>';
      const spent = PG.PERKS.reduce((a, p) => { let t = 0; for (let i = 0; i < S.rank(p.id); i++) t += PG.perkCost(p, i); return a + t; }, 0);
      h += '<div class="arch-foot"><button class="pbtn" id="arch-refund"' + (spent ? '' : ' disabled') + '>' +
        (this.refundArmed ? 'Really? Click again to refund ' + spent : 'Refund all perks (' + spent + ')') + '</button></div>';
      $('arch-body').innerHTML = h;
    },
    archiveClick(e) {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      const S = PG.save;
      if (b.dataset.perk) { if (S.buyPerk(b.dataset.perk)) PG.audio.sfx('level'); }
      else if (b.dataset.unlock) { const [k, id] = b.dataset.unlock.split(':'); if (S.buyUnlock(k, id)) PG.audio.sfx('level'); }
      else if (b.id === 'arch-refund') {
        if (!this.refundArmed) { this.refundArmed = true; clearTimeout(this._rt); this._rt = setTimeout(() => { this.refundArmed = false; if (!$('screen-archive').classList.contains('hidden')) this.renderArchive(); }, 3500); PG.audio.sfx('click'); }
        else { this.refundArmed = false; S.refundPerks(); PG.audio.sfx('pick'); }
      }
      const y = $('screen-archive').scrollTop;
      this.renderArchive();
      $('screen-archive').scrollTop = y;
    },

    /* ---- options ---- */
    optFrom: 'title', binding: null, optMsg: '', resetArmed: false,
    optionsOpen() { return !$('screen-options').classList.contains('hidden'); },
    openOptions(from) {
      this.optFrom = from || 'title';
      this.binding = null; this.optMsg = ''; this.resetArmed = false;
      this.renderOptions();
      this.show('options');
      $('screen-options').scrollTop = 0;
    },
    closeOptions() {
      PG.input.capture = null; this.binding = null; this.resetArmed = false;
      PG.save.write();
      if (this.optFrom === 'title') this.initTitle();
      this.show(this.optFrom);
    },
    keyLabel(k) {
      if (!k) return '-';
      const m = { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', space: 'Space', ' ': 'Space', enter: 'Enter', shift: 'Shift', control: 'Ctrl', alt: 'Alt', backspace: 'Bksp' };
      return m[k] || (k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1));
    },
    renderOptions() {
      const S = PG.settings, inRun = this.optFrom === 'pause';
      const seg = (attr, items, cur) => '<div class="seg">' + items.map(i => '<button class="pbtn sm' + (String(i[0]) === String(cur) ? ' on' : '') + '" data-' + attr + '="' + i[0] + '">' + i[1] + '</button>').join('') + '</div>';
      const D = PG.DIFFICULTIES, dd = D[S.difficulty];
      const pct = v => Math.round(v * 100) + '%';
      let h = '<div class="omsg" id="opt-msg">' + this.optMsg + '</div>';

      h += '<div class="osec"><h2>Difficulty</h2>' +
        seg('diff', Object.keys(D).map(k => [k, D[k].name]), S.difficulty) +
        '<div class="odesc">Enemies spawn x' + dd.spawn + ', have x' + dd.hp + ' health and hit for x' + dd.dmg + '. Moolah earned x' + dd.reward + '.' +
        (inRun ? ' <b>Applies to your next run.</b>' : '') + '</div></div>';

      h += '<div class="osec"><h2>Sound</h2>' +
        '<div class="orow"><span class="lbl">Music</span><input type="range" min="0" max="100" value="' + Math.round(S.music * 100) + '" data-vol="music"><span class="val" id="v-music">' + pct(S.music) + '</span></div>' +
        '<div class="orow"><span class="lbl">Sound effects</span><input type="range" min="0" max="100" value="' + Math.round(S.sfx * 100) + '" data-vol="sfx"><span class="val" id="v-sfx">' + pct(S.sfx) + '</span></div>' +
        '<div class="orow"><span class="lbl">Mute everything</span><button class="pbtn sm' + (PG.audio.muted ? ' on' : '') + '" data-toggle="mute">' + (PG.audio.muted ? 'Muted' : 'Sound on') + '</button></div></div>';

      h += '<div class="osec"><h2>Controls</h2>';
      PG.ACTIONS.forEach(a => {
        h += '<div class="orow"><span class="lbl">' + a.name + '</span>';
        [0, 1].forEach(slot => {
          const wait = this.binding && this.binding.action === a.id && this.binding.slot === slot;
          h += '<button class="pbtn sm kbtn' + (wait ? ' wait' : '') + '" data-bind="' + a.id + ':' + slot + '">' + (wait ? 'press a key...' : this.keyLabel(S.keys[a.id][slot])) + '</button>';
        });
        h += '</div>';
      });
      h += '<div class="odesc">Click a key box, then press the new key. Backspace clears a slot. Esc always pauses, and 1-5 always pick level-up cards.</div>' +
        '<div class="orow"><span class="lbl"></span><button class="pbtn sm" data-act="reset-keys">Reset controls</button></div></div>';

      h += '<div class="osec"><h2>Display &amp; gameplay</h2>' +
        '<div class="orow"><span class="lbl">Screen shake</span>' + seg('shake', [[0, 'Off'], [0.5, 'Reduced'], [1, 'Full']], S.shake) + '</div>' +
        '<div class="orow"><span class="lbl">Pause when the window loses focus</span><button class="pbtn sm' + (S.autopause ? ' on' : '') + '" data-toggle="autopause">' + (S.autopause ? 'On' : 'Off') + '</button></div>' +
        '<div class="orow"><span class="lbl">Show frames per second</span><button class="pbtn sm' + (S.fps ? ' on' : '') + '" data-toggle="fps">' + (S.fps ? 'On' : 'Off') + '</button></div>' +
        '<div class="orow"><span class="lbl">Fullscreen</span><button class="pbtn sm" data-act="fullscreen">' + (document.fullscreenElement ? 'Exit fullscreen' : 'Go fullscreen') + '</button></div></div>';

      const d = PG.save.data;
      h += '<div class="osec"><h2>Data</h2>' +
        '<div class="orow"><span class="lbl">Reset options to defaults<br><small>difficulty, volume, controls, display (progress is kept)</small></span><button class="pbtn sm" data-act="reset-settings">Reset options</button></div>' +
        '<div class="orow"><span class="lbl">Erase all progress<br><small>moolah (' + d.moolah + '), perks, unlocks and records. Options are kept.</small></span>' +
        '<button class="pbtn sm danger' + (this.resetArmed ? ' armed' : '') + '" data-act="reset-progress">' + (this.resetArmed ? 'Really erase EVERYTHING? Click again' : 'Reset all progress') + '</button></div></div>';

      $('opt-body').innerHTML = h;
    },
    startBind(action, slot) {
      this.binding = { action, slot }; this.optMsg = 'Press the new key for "' + PG.ACTIONS.find(a => a.id === action).name + '"  (Esc cancels)';
      PG.input.capture = k => {
        this.binding = null;
        const keys = PG.settings.keys;
        if (k === 'escape') this.optMsg = 'Cancelled.';
        else if (k === 'backspace' || k === 'delete') { keys[action][slot] = ''; this.optMsg = 'Cleared.'; }
        else if (/^[1-5]$/.test(k) || k === 'tab') this.optMsg = 'That key is reserved. Try another.';
        else {
          for (const id in keys) keys[id] = keys[id].map(x => (x === k ? '' : x));   // one key, one job
          keys[action][slot] = k;
          this.optMsg = this.keyLabel(k) + ' is now bound.';
        }
        PG.save.write();
        this.renderOptions();
      };
      this.renderOptions();
    },
    optionsClick(e) {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      const S = PG.settings, D = b.dataset;
      const y = $('screen-options').scrollTop;
      PG.audio.sfx('click');
      this.optMsg = '';
      if (D.diff) { S.difficulty = D.diff; this.optMsg = PG.DIFFICULTIES[D.diff].name + ' selected.' + (this.optFrom === 'pause' ? ' It starts with your next run.' : ''); }
      else if (D.shake !== undefined) S.shake = parseFloat(D.shake);
      else if (D.toggle === 'mute') { PG.audio.setMuted(!PG.audio.muted); $('mute').classList.toggle('off', PG.audio.muted); }
      else if (D.toggle === 'autopause') S.autopause = !S.autopause;
      else if (D.toggle === 'fps') { S.fps = !S.fps; $('fps').classList.toggle('hidden', !S.fps); }
      else if (D.bind) { const p = D.bind.split(':'); this.startBind(p[0], parseInt(p[1], 10)); $('screen-options').scrollTop = y; return; }
      else if (D.act === 'reset-keys') { PG.settings.keys = JSON.parse(JSON.stringify(PG.DEFAULT_KEYS)); this.optMsg = 'Controls reset.'; }
      else if (D.act === 'fullscreen') {
        const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
        if (p && p.catch) p.catch(() => {});
        setTimeout(() => { if (this.optionsOpen()) this.renderOptions(); }, 300);
        return;
      }
      else if (D.act === 'reset-settings') { PG.save.resetSettings(); $('fps').classList.add('hidden'); PG.audio.applyVolume(); this.optMsg = 'Options reset to defaults.'; }
      else if (D.act === 'reset-progress') {
        if (!this.resetArmed) {
          this.resetArmed = true; clearTimeout(this._rst);
          this._rst = setTimeout(() => { this.resetArmed = false; if (this.optionsOpen()) this.renderOptions(); }, 4000);
        } else {
          this.resetArmed = false; PG.save.resetProgress(); this.optMsg = 'All progress erased. A fresh start.';
        }
      }
      PG.save.write();
      this.renderOptions();
      $('screen-options').scrollTop = y;
    },
    optionsInput(e) {
      const el = e.target;
      if (!el.dataset || !el.dataset.vol) return;
      const v = Math.max(0, Math.min(1, parseInt(el.value, 10) / 100));
      PG.settings[el.dataset.vol] = v;
      $('v-' + el.dataset.vol).textContent = Math.round(v * 100) + '%';
      if (el.dataset.vol === 'music') PG.audio.applyVolume();
      PG.save.write();
    },

    /* ---- achievements ---- */
    // called by PG.save.unlockAch() whenever one is earned, in or out of a run - stacks if several land at once.
    achToast(a) {
      const wrap = $('ach-toasts');
      if (!wrap) return;
      PG.audio.sfx('level');
      const d = document.createElement('div');
      d.className = 'ach-toast';
      d.innerHTML = '<div class="ach-toast-h">Achievement Unlocked!</div><div class="ach-toast-n">' + a.name + '</div><div class="ach-toast-d">' + a.desc + '</div>';
      wrap.appendChild(d);
      requestAnimationFrame(() => d.classList.add('show'));
      setTimeout(() => {
        d.classList.remove('show');
        setTimeout(() => d.remove(), 400);
      }, 4200);
    },

    /* ---- HUD ---- */
    banner(text) {
      const b = $('banner');
      b.textContent = text; b.classList.add('show');
      clearTimeout(this._bt);
      this._bt = setTimeout(() => b.classList.remove('show'), 2600);
    },
    reset() {
      this.last = {};
      $('bossbar').classList.add('hidden');
      $('banner').classList.remove('show');
      $('vignette').classList.remove('low');
    },
    bossName(n) { $('bossname').textContent = n; },
    hudVisible(v) { $('hud').classList.toggle('hidden', !v); if (!v) $('vignette').classList.remove('low'); },
    hud(g) {
      const p = g.player, L = this.last;
      const xp = Math.min(100, (p.xp / p.xpNeed) * 100).toFixed(1);
      if (L.xp !== xp) { $('xpfill').style.width = xp + '%'; L.xp = xp; }
      const lv = 'LV ' + p.level;
      if (L.lv !== lv) { $('lvl').textContent = lv; L.lv = lv; }
      const tm = PG.fmtTime(g.t);
      if (L.tm !== tm) { $('timer').textContent = tm; L.tm = tm; }
      if (L.k !== g.kills) { $('kills').textContent = g.kills; L.k = g.kills; }
      if (L.m !== g.moolah) { $('moolah').textContent = g.moolah; L.m = g.moolah; }
      const low = p.hp / p.maxHp < 0.3 && !p.dead;
      if (L.low !== low) { $('vignette').classList.toggle('low', low); L.low = low; }
      if (g.invDirty) {
        g.invDirty = false;
        $('inv-w').innerHTML = g.weapons.map(w => '<div class="slot"><img src="' + asset(w.def.icon) + '"><b>' + w.level + '</b></div>').join('');
        $('inv-p').innerHTML = Object.keys(g.passives).map(id => '<div class="slot"><img src="' + asset(PG.PASSIVES[id].icon) + '"><b>' + g.passives[id] + '</b></div>').join('');
      }
      const bb = $('bossbar');
      if (g.boss && !g.boss.dead) {
        if (L.boss !== true) { bb.classList.remove('hidden'); L.boss = true; }
        const f = (Math.max(0, g.boss.hp) / g.boss.maxHp * 100).toFixed(1);
        if (L.bf !== f) { $('bossfill').style.width = f + '%'; L.bf = f; }
      } else if (L.boss) { bb.classList.add('hidden'); L.boss = false; }
    },
  });
})();
