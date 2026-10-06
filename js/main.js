/* main.js - boot, screen flow and the frame loop. */
(function () {
  const PG = window.PG;
  const ui = PG.ui;
  const $ = id => document.getElementById(id);
  let game = null, lastCharId = PG.CHARACTERS[0].id, last = 0;

  PG.save.load();
  PG.steam.init();
  PG.audio.init();
  PG.input.init();
  $('mute').classList.toggle('off', PG.audio.muted);
  $('fps').classList.toggle('hidden', !PG.settings.fps);

  function startRun(charId) {
    lastCharId = charId;
    PG.audio.playTrack('run', PG.MUSIC_RUN);
    ui.hideAll();
    ui.hudVisible(true);
    ui.reset();
    game.start(charId);
    game.invDirty = true;
  }
  function toSelect() {
    game.mode = 'idle';
    ui.hudVisible(false);
    PG.audio.duck(false);
    PG.audio.playTrack('menu', PG.MUSIC_MENU);
    ui.show('select');
  }
  function toTitle() {
    game.mode = 'idle';
    ui.hudVisible(false);
    PG.audio.duck(false);
    PG.audio.playTrack('menu', PG.MUSIC_MENU);
    ui.initTitle();
    ui.show('title');
  }
  function pause() {
    if (game.mode !== 'play') return;
    game.mode = 'pause';
    ui.showPause(game);
  }
  function resume() {
    if (game.mode !== 'pause') return;
    game.mode = 'play';
    ui.hideAll();
    PG.audio.duck(false);
  }

  // ---------------------------------------------------------------- input
  PG.input.onKey = (k, e) => {
    if (!game) return;
    if (PG.input.is('mute', k)) { PG.audio.setMuted(!PG.audio.muted); $('mute').classList.toggle('off', PG.audio.muted); if (ui.optionsOpen()) ui.renderOptions(); }
    if (ui.optionsOpen()) { if (k === 'escape') ui.closeOptions(); return; }
    if (game.mode === 'choose' && /^[1-5]$/.test(k)) ui.pickChoice(parseInt(k, 10) - 1);
    if (game.mode === 'choose' && PG.input.is('reroll', k)) ui.doReroll();
    // arrow keys + Enter navigate and pick a level-up card, so you never have to leave the arrow keys for the mouse
    if (game.mode === 'choose') {
      if (k === 'arrowleft' || k === 'arrowup') { ui.moveSel(-1); return; }
      if (k === 'arrowright' || k === 'arrowdown') { ui.moveSel(1); return; }
      if (k === 'enter' || k === 'space') { ui.confirmSel(); return; }
    }
    if (k === 'escape' && !$('screen-archive').classList.contains('hidden')) { ui.closeArchive(); return; }
    if (k === 'escape' || PG.input.is('pause', k)) { if (game.mode === 'play') pause(); else if (game.mode === 'pause') resume(); }
  };
  $('mute').addEventListener('click', () => { PG.audio.setMuted(!PG.audio.muted); $('mute').classList.toggle('off', PG.audio.muted); });
  $('title-start').addEventListener('click', () => { PG.audio.playTrack('menu', PG.MUSIC_MENU); PG.audio.sfx('click'); ui.show('select'); });
  $('select-back').addEventListener('click', toTitle);
  $('title-options').addEventListener('click', () => { PG.audio.playTrack('menu', PG.MUSIC_MENU); PG.audio.sfx('click'); ui.openOptions('title'); });
  $('pause-options').addEventListener('click', () => { PG.audio.sfx('click'); ui.openOptions('pause'); });
  $('opt-back').addEventListener('click', () => { PG.audio.sfx('click'); ui.closeOptions(); });
  $('opt-body').addEventListener('click', e => ui.optionsClick(e));
  $('opt-body').addEventListener('input', e => ui.optionsInput(e));
  $('title-archive').addEventListener('click', () => { PG.audio.playTrack('menu', PG.MUSIC_MENU); PG.audio.sfx('click'); ui.openArchive('title'); });
  $('select-archive').addEventListener('click', () => { PG.audio.sfx('click'); ui.openArchive('select'); });
  $('end-archive').addEventListener('click', () => { PG.audio.sfx('click'); ui.openArchive('end'); });
  $('arch-back').addEventListener('click', () => { PG.audio.sfx('click'); ui.closeArchive(); });
  $('arch-body').addEventListener('click', e => ui.archiveClick(e));
  $('reroll').addEventListener('click', () => ui.doReroll());
  $('pause-resume').addEventListener('click', resume);
  $('pause-menu').addEventListener('click', toSelect);
  $('pause-exit').addEventListener('click', toTitle);
  $('end-again').addEventListener('click', () => startRun(lastCharId));
  $('end-menu').addEventListener('click', toSelect);
  window.addEventListener('blur', () => { if (game && game.mode === 'play' && PG.settings.autopause) pause(); });
  window.addEventListener('resize', () => { if (game) game.resize(); });

  // ---------------------------------------------------------------- frame loop
  let fpsAcc = 0, fpsN = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000 || 0);
    last = now;
    if (PG.settings.fps) { fpsAcc += dt; fpsN++; if (fpsAcc >= 0.5) { $('fps').textContent = Math.round(fpsN / fpsAcc) + ' fps'; fpsAcc = 0; fpsN = 0; } }
    if (game.mode !== 'idle') {
      game.update(dt);
      game.render();
      if (game.mode !== 'dead' || game.deadT < 0.1) ui.hud(game);
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- boot
  PG.loadAssets(f => { $('loadfill').style.width = Math.round(f * 100) + '%'; }).then(() => {
    game = PG.game = new PG.Game($('game'), ui);
    ui.buildSelect(startRun);
    ui.initTitle();
    ui.show('title');
    last = performance.now();
    requestAnimationFrame(frame);
  });
})();
