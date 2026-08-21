document.addEventListener('DOMContentLoaded', function(){
(function(){
  const CLASSIC = [1,2,4,7,11,16];
  const HARDCORE = [1,1,2,2,3,4];
  let DURATIONS = CLASSIC;
  let difficulty = 'classic';

  // Music data comes from Deezer's public search API — no key required.
  // Deezer natively supports JSONP (a <script>-tag callback, not a fetch/XHR
  // call) specifically so browser apps can call it directly, which sidesteps
  // the CORS problem entirely instead of depending on a third-party proxy
  // that can go down on its own.
  function jsonp(url){
    return new Promise((resolve, reject)=>{
      const cbName = 'dzcb_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      let done = false;
      const cleanup = ()=>{ delete window[cbName]; script.remove(); };
      window[cbName] = data => { if(done) return; done = true; cleanup(); resolve(data); };
      script.onerror = () => { if(done) return; done = true; cleanup(); reject(new Error('jsonp load failed')); };
      const sep = url.includes('?') ? '&' : '?';
      script.src = url + sep + 'output=jsonp&callback=' + cbName;
      document.body.appendChild(script);
      setTimeout(()=>{ if(done) return; done = true; cleanup(); reject(new Error('jsonp timeout')); }, 9000);
    });
  }

  const QUICK_ARTISTS = ['Drake','Taylor Swift','The Weeknd','Bad Bunny','Billie Eilish','Kendrick Lamar','Dua Lipa','SZA','Tame Impala','Rihanna'];

  let state = {
    guessIndex:0, over:false, current:null, audio:null,
    pool:[], playedRecently:[], mode:null, contextLabel:''
  };

  const $ = id => document.getElementById(id);
  const els = {
    grooves:$('grooves'), playBtn:$('playBtn'), record:$('record'), tonearm:$('tonearm'),
    input:$('guessInput'), guessBtn:$('guessBtn'), skipBtn:$('skipBtn'), suggestions:$('suggestions'),
    reveal:$('reveal'), revealImg:$('revealImg'), revealTitle:$('revealTitle'), revealArtist:$('revealArtist'),
    resultTag:$('resultTag'), nextBtn:$('nextBtn'), shareBtn:$('shareBtn'), status:$('status'),
    streakVal:$('streakVal'), bestVal:$('bestVal'), streakVal2:$('streakVal2'), bestVal2:$('bestVal2'),
    gameContext:$('gameContext'), artistInput:$('artistInput'), artistResults:$('artistResults'),
    quickChips:$('quickChips')
  };

  function norm(s){ return s.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }

  function showScreen(id){
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    $('screen-'+id).classList.add('active');
  }
  document.querySelectorAll('[data-back]').forEach(b=>{
    b.addEventListener('click', ()=>{
      if(state.audio) state.audio.pause();
      clearTimeout(playSnippet._t);
      showScreen(b.dataset.back);
    });
  });
  $('switchModeBtn').addEventListener('click', ()=>{
    if(state.audio) state.audio.pause();
    clearTimeout(playSnippet._t);
    showScreen('home');
  });

  // ---- difficulty ----
  $('diffToggle').addEventListener('click', e=>{
    const b = e.target.closest('button'); if(!b) return;
    document.querySelectorAll('#diffToggle button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    difficulty = b.dataset.diff;
    DURATIONS = difficulty==='hardcore' ? HARDCORE : CLASSIC;
  });

  // ---- quick-start chips ----
  QUICK_ARTISTS.forEach(name=>{
    const chip = document.createElement('div');
    chip.className = 'quick-chip glass';
    chip.textContent = name;
    chip.addEventListener('click', ()=>{
      showScreen('artist');
      els.artistResults.innerHTML = '<div class="empty-hint">cueing up '+name+'\'s catalog…</div>';
      selectArtist(null, name);
    });
    els.quickChips.appendChild(chip);
  });
  const surpriseChip = document.createElement('div');
  surpriseChip.className = 'quick-chip glass';
  surpriseChip.textContent = '🎲 Surprise me';
  surpriseChip.addEventListener('click', ()=>{
    const name = QUICK_ARTISTS[Math.floor(Math.random()*QUICK_ARTISTS.length)];
    showScreen('artist');
    els.artistResults.innerHTML = '<div class="empty-hint">cueing up '+name+'\'s catalog…</div>';
    selectArtist(null, name);
  });
  els.quickChips.appendChild(surpriseChip);

  // ---- stats ----
  function loadStats(){
    const s = localStorage.getItem('spindle_streak') || '0';
    const b = localStorage.getItem('spindle_best') || '0';
    els.streakVal.textContent = s; els.bestVal.textContent = b;
    els.streakVal2.textContent = s; els.bestVal2.textContent = b;
  }
  function bumpStreak(win){
    let streak = parseInt(localStorage.getItem('spindle_streak')||'0',10);
    let best = parseInt(localStorage.getItem('spindle_best')||'0',10);
    streak = win ? streak+1 : 0;
    best = Math.max(best, streak);
    localStorage.setItem('spindle_streak', streak);
    localStorage.setItem('spindle_best', best);
    loadStats();
    [els.streakVal,els.streakVal2,els.bestVal,els.bestVal2].forEach(el=>{
      el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
    });
  }

  // ================= ARTIST MODE =================
  let artistDebounce;
  els.artistInput.addEventListener('input', e=>{
    clearTimeout(artistDebounce);
    const q = e.target.value.trim();
    if(!q){ els.artistResults.innerHTML = '<div class="empty-hint">Start typing an artist name — Drake, Adele, Tame Impala, anyone on Deezer.</div>'; return; }
    artistDebounce = setTimeout(()=>searchArtists(q), 350);
  });

  async function searchArtists(q){
    els.artistResults.innerHTML = '<div class="empty-hint">searching…</div>';
    try{
      const data = await jsonp(`https://api.deezer.com/search/artist?q=${encodeURIComponent(q)}&limit=8`);
      const artists = (data.data||[]).filter(a=>a.name);
      if(!artists.length){ els.artistResults.innerHTML = '<div class="empty-hint">No artists found. Try a different spelling.</div>'; return; }
      els.artistResults.innerHTML = '';
      artists.forEach(a=>{
        const row = document.createElement('div');
        row.className = 'result-item glass';
        row.innerHTML = `<div><div class="name">${a.name}</div><div class="type">${(a.nb_fan||0).toLocaleString()} fans</div></div><div>→</div>`;
        row.addEventListener('click', ()=>selectArtist(a.id, a.name));
        els.artistResults.appendChild(row);
      });
    }catch(e){
      els.artistResults.innerHTML = '<div class="empty-hint">Couldn\'t reach the music service. Check your connection and try again.</div>';
    }
  }

  async function selectArtist(artistId, name){
    els.artistResults.innerHTML = '<div class="empty-hint">cueing up '+name+'\'s catalog…</div>';
    try{
      // quick-start chips pass a name only — resolve the artist id first
      if(artistId == null){
        const found = await jsonp(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=1`);
        const match = found.data && found.data[0];
        if(!match){ els.artistResults.innerHTML = '<div class="empty-hint">Couldn\'t find '+name+'. Try another artist.</div>'; return; }
        artistId = match.id;
      }
      const data = await jsonp(`https://api.deezer.com/artist/${artistId}/top?limit=50`);
      const seen = new Set();
      const tracks = (data.data||[]).filter(t=>{
        if(!t.preview) return false;
        const key = norm(t.title);
        if(seen.has(key)) return false;
        seen.add(key);
        return true;
      }).map(t=>({ title:t.title, artist:t.artist.name, previewUrl:t.preview, artwork:t.album.cover_medium }));

      if(tracks.length < 4){
        els.artistResults.innerHTML = '<div class="empty-hint">Not enough previewable tracks for '+name+'. Try another artist.</div>';
        return;
      }
      startGame({ mode:'artist', pool:tracks, contextLabel:'Artist · '+name });
    }catch(e){
      els.artistResults.innerHTML = '<div class="empty-hint">Something went wrong fetching that catalog. Try again.</div>';
    }
  }

  $('cardArtist').addEventListener('click', ()=>showScreen('artist'));

  // ================= GAME ENGINE =================
  function buildGrooves(){
    els.grooves.innerHTML = '';
    DURATIONS.forEach((d)=>{
      const g = document.createElement('div');
      g.className = 'groove';
      g.innerHTML = `<div class="fill"></div><span>${d}s</span>`;
      els.grooves.appendChild(g);
    });
    updateGrooveUI();
  }
  function updateGrooveUI(){
    [...els.grooves.children].forEach((g,i)=>{
      g.classList.toggle('played', i < state.guessIndex || (state.over && i===state.guessIndex));
      g.classList.toggle('current', i === state.guessIndex && !state.over);
    });
  }

  function startGame({mode, pool, contextLabel}){
    state.mode = mode; state.pool = pool; state.contextLabel = contextLabel; state.playedRecently = [];
    state.sessionHistory = [];
    els.gameContext.textContent = contextLabel + ' · ' + (difficulty==='hardcore'?'Hardcore':'Classic');
    showScreen('game');
    newRound();
  }

  function pickTrack(){
    let available = state.pool.filter(t => !state.playedRecently.includes(t.title));
    if(!available.length){ state.playedRecently = []; available = state.pool; }
    const track = available[Math.floor(Math.random()*available.length)];
    state.playedRecently.push(track.title);
    return track;
  }

  function newRound(){
    state.guessIndex = 0; state.over = false;
    els.reveal.classList.remove('show');
    els.nextBtn.classList.remove('show');
    els.shareBtn.classList.remove('show');
    els.input.value = '';
    els.input.disabled = false;
    els.tonearm.classList.remove('down');
    els.record.classList.remove('spinning');
    buildGrooves();

    const track = pickTrack();
    state.current = track;
    state.audio = new Audio(track.previewUrl);
    state.audio.preload = 'auto';
    setControlsEnabled(true);
    els.status.textContent = 'tap play — you get ' + DURATIONS[0] + ' second' + (DURATIONS[0]>1?'s':'');
  }

  function setControlsEnabled(on){
    els.playBtn.disabled = !on;
    els.guessBtn.disabled = !on;
    els.skipBtn.disabled = !on;
    els.input.disabled = !on;
  }

  function playSnippet(){
    if(!state.current || state.over) return;
    const dur = DURATIONS[state.guessIndex];
    const a = state.audio;
    a.currentTime = 0;
    a.play().catch(()=>{ els.status.textContent = 'tap play again to start audio'; });
    els.record.classList.add('spinning');
    els.tonearm.classList.add('down');
    els.playBtn.classList.remove('pulse-ring'); void els.playBtn.offsetWidth; els.playBtn.classList.add('pulse-ring');
    els.status.textContent = 'playing ' + dur + 's…';
    clearTimeout(playSnippet._t);
    playSnippet._t = setTimeout(()=>{
      a.pause();
      els.record.classList.remove('spinning');
      els.tonearm.classList.remove('down');
      if(!state.over) els.status.textContent = 'guess, or skip for a longer clip';
    }, dur*1000);
  }

  function endGame(win){
    state.over = true;
    clearTimeout(playSnippet._t);
    if(state.audio) state.audio.pause();
    els.record.classList.remove('spinning');
    els.tonearm.classList.remove('down');
    setControlsEnabled(false);
    els.playBtn.disabled = false;
    updateGrooveUI();

    const s = state.current;
    els.revealImg.src = s.artwork;
    els.revealTitle.textContent = s.title;
    els.revealArtist.textContent = s.artist;
    els.resultTag.textContent = win ? ('SOLVED · ' + DURATIONS[state.guessIndex] + 's') : 'MISSED';
    els.reveal.style.background = win ? 'linear-gradient(90deg, var(--good), #4E7A3A)' : 'linear-gradient(90deg, var(--red), #8E2E1D)';
    els.reveal.classList.add('show');
    els.nextBtn.classList.add('show');
    els.shareBtn.classList.add('show');
    els.status.textContent = win ? 'nice ear.' : 'better luck next spin.';
    state.lastResult = { win, seconds: DURATIONS[state.guessIndex] };
    state.sessionHistory.push({ title:s.title, artist:s.artist, win, seconds: DURATIONS[state.guessIndex] });
    bumpStreak(win);
  }

  function submitGuess(guessText){
    if(!state.current || state.over) return;
    const g = norm(guessText);
    if(!g) return;
    const titleN = norm(state.current.title);
    const win = titleN.includes(g) || titleN === g || (g.length>2 && titleN.split(' ')[0]===g.split(' ')[0] && titleN.startsWith(g));
    if(win){ endGame(true); return; }
    advance('wrong');
  }

  function advance(reason){
    if(state.guessIndex >= DURATIONS.length - 1){ endGame(false); return; }
    if(reason==='wrong') els.grooves.children[state.guessIndex].classList.add('miss');
    state.guessIndex++;
    els.input.value = '';
    closeSuggestions();
    updateGrooveUI();
    els.status.textContent = reason==='skip' ? 'skipped — next clip is longer' : 'not quite — try again';
  }

  function renderSuggestions(q){
    const nq = norm(q);
    if(!nq){ closeSuggestions(); return; }
    const matches = state.pool.filter(t => norm(t.title).includes(nq)).slice(0,6);
    if(!matches.length){ closeSuggestions(); return; }
    els.suggestions.innerHTML = matches.map(t=>`<div class="suggestion" data-title="${t.title.replace(/"/g,'&quot;')}"><b>${t.title}</b> — ${t.artist}</div>`).join('');
    els.suggestions.classList.add('open');
  }
  function closeSuggestions(){ els.suggestions.classList.remove('open'); els.suggestions.innerHTML = ''; }

  els.playBtn.addEventListener('click', playSnippet);
  els.skipBtn.addEventListener('click', ()=>advance('skip'));
  els.guessBtn.addEventListener('click', ()=>submitGuess(els.input.value));
  els.input.addEventListener('input', e=>renderSuggestions(e.target.value));
  els.input.addEventListener('keydown', e=>{ if(e.key==='Enter') submitGuess(els.input.value); });
  els.suggestions.addEventListener('click', e=>{
    const el = e.target.closest('.suggestion'); if(!el) return;
    els.input.value = el.dataset.title; closeSuggestions(); submitGuess(el.dataset.title);
  });
  document.addEventListener('click', e=>{ if(!e.target.closest('.guess-zone')) closeSuggestions(); });
  els.nextBtn.addEventListener('click', newRound);

  // ================= SHARE CARD =================
  function drawVinylIcon(ctx, cx, cy, r){
    ctx.save();
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fillStyle = '#1c1c1c'; ctx.fill();
    for(let i=r*0.3;i<r;i+=6){
      ctx.beginPath(); ctx.arc(cx,cy,i,0,Math.PI*2);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.stroke();
    }
    const grad = ctx.createRadialGradient(cx-r*0.15,cy-r*0.15,2,cx,cy,r*0.32);
    grad.addColorStop(0,'#F0B85C'); grad.addColorStop(1,'#C4432B');
    ctx.beginPath(); ctx.arc(cx,cy,r*0.32,0,Math.PI*2); ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath(); ctx.arc(cx,cy,r*0.045,0,Math.PI*2); ctx.fillStyle = '#170F09'; ctx.fill();
    ctx.restore();
  }

  function truncateText(ctx, text, maxWidth){
    if(ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while(t.length > 1 && ctx.measureText(t + '…').width > maxWidth){ t = t.slice(0, -1); }
    return t + '…';
  }

  function drawCheckIcon(ctx, cx, cy, s, ok){
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, s, 0, Math.PI*2);
    ctx.fillStyle = ok ? 'rgba(127,176,105,0.18)' : 'rgba(196,67,43,0.18)';
    ctx.fill();
    ctx.strokeStyle = ok ? '#7FB069' : '#C4432B';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    if(ok){
      ctx.moveTo(cx - s*0.45, cy);
      ctx.lineTo(cx - s*0.1, cy + s*0.4);
      ctx.lineTo(cx + s*0.5, cy - s*0.4);
    } else {
      ctx.moveTo(cx - s*0.4, cy - s*0.4); ctx.lineTo(cx + s*0.4, cy + s*0.4);
      ctx.moveTo(cx + s*0.4, cy - s*0.4); ctx.lineTo(cx - s*0.4, cy + s*0.4);
    }
    ctx.stroke();
    ctx.restore();
  }

  function buildShareCanvas(){
    const W = 640;
    const history = state.sessionHistory || [];
    const total = history.length;
    const wins = history.filter(h=>h.win).length;
    const pct = total ? Math.round((wins/total)*100) : 0;

    const MAX_ROWS = 12;
    const shown = history.slice(-MAX_ROWS).reverse(); // most recent first
    const overflow = total - shown.length;

    const headerH = 300;
    const rowH = 46;
    const listH = shown.length * rowH + (overflow > 0 ? 34 : 0) + 20;
    const footerH = 110;
    const H = headerH + listH + footerH;

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createLinearGradient(0,0,W,H);
    grad.addColorStop(0,'#2A1B10'); grad.addColorStop(1,'#150E09');
    ctx.fillStyle = grad; ctx.fillRect(0,0,W,H);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#E8A33D';
    ctx.font = 'italic 700 28px Georgia, serif';
    ctx.fillText('Spindle', W/2, 56);

    ctx.fillStyle = '#B3A491';
    ctx.font = '400 14px Arial, sans-serif';
    ctx.fillText(truncateText(ctx, state.contextLabel || '', W-80), W/2, 82);

    drawVinylIcon(ctx, W/2, 150, 62);

    ctx.fillStyle = pct>=60 ? '#7FB069' : (pct>=30 ? '#E8A33D' : '#C4432B');
    ctx.font = '700 46px Arial, sans-serif';
    ctx.fillText(pct + '%', W/2, 245);

    ctx.fillStyle = '#F3E9DC';
    ctx.font = '600 16px Arial, sans-serif';
    ctx.fillText(wins + ' solved · ' + (total-wins) + ' missed · ' + total + ' played', W/2, 275);

    // progress bar
    const barW = 420, barX = W/2 - barW/2, barY = 292, barHt = 8;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    roundRect(ctx, barX, barY, barW, barHt, 4); ctx.fill();
    ctx.fillStyle = '#E8A33D';
    roundRect(ctx, barX, barY, barW*(pct/100), barHt, 4); ctx.fill();

    // list
    let y = headerH;
    ctx.textAlign = 'left';
    shown.forEach(entry=>{
      const rowY = y + rowH/2;
      drawCheckIcon(ctx, 60, rowY, 15, entry.win);
      ctx.fillStyle = '#F3E9DC';
      ctx.font = '600 17px Arial, sans-serif';
      const title = truncateText(ctx, entry.title, 380);
      ctx.fillText(title, 92, rowY - 6);
      ctx.fillStyle = '#8C7A68';
      ctx.font = '400 13px Arial, sans-serif';
      ctx.fillText(truncateText(ctx, entry.artist, 380), 92, rowY + 14);
      ctx.textAlign = 'right';
      ctx.fillStyle = entry.win ? '#7FB069' : '#C4432B';
      ctx.font = '600 13px Arial, sans-serif';
      ctx.fillText(entry.win ? (entry.seconds + 's') : '—', W-40, rowY + 4);
      ctx.textAlign = 'left';
      y += rowH;
    });
    if(overflow > 0){
      ctx.textAlign = 'center';
      ctx.fillStyle = '#6E5B48';
      ctx.font = '400 13px Arial, sans-serif';
      ctx.fillText('+ ' + overflow + ' earlier this session', W/2, y + 22);
      y += 34;
    }

    ctx.strokeStyle = 'rgba(232,163,61,0.25)';
    ctx.beginPath(); ctx.moveTo(120, y+16); ctx.lineTo(W-120, y+16); ctx.stroke();

    const streak = localStorage.getItem('spindle_streak') || '0';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#E8A33D';
    ctx.font = '700 15px Arial, sans-serif';
    ctx.fillText('Current streak: ' + streak, W/2, y + 50);

    ctx.fillStyle = '#6E5B48';
    ctx.font = '400 12px Arial, sans-serif';
    ctx.fillText('guess the song, live · real audio every round', W/2, y + 78);

    return canvas;
  }
  function roundRect(ctx, x, y, w, h, r){
    if(w <= 0) w = 0.001;
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }

  els.shareBtn.addEventListener('click', ()=>{
    const canvas = buildShareCanvas();
    const url = canvas.toDataURL('image/png');
    $('shareImg').src = url;
    $('downloadLink').href = url;
    $('shareModal').classList.add('show');
    $('nativeShareBtn').onclick = async ()=>{
      try{
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], 'spindle-result.png', {type:'image/png'});
        if(navigator.canShare && navigator.canShare({files:[file]})){
          await navigator.share({ files:[file], title:'Spindle', text:'Guess the song, live.' });
        } else {
          $('downloadLink').click();
        }
      }catch(e){ $('downloadLink').c
