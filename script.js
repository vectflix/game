document.addEventListener('DOMContentLoaded', function(){
(function(){
  const CLASSIC = [1,2,4,7,11,16];
  const HARDCORE = [1,1,2,2,3,4];
  let DURATIONS = CLASSIC;
  let difficulty = 'classic';

  // iTunes' /search endpoint doesn't reliably send CORS headers to deployed
  // sites (it's a known quirk — works on localhost, fails once hosted).
  // Routing through a keyless public CORS relay fixes it without any API key.
  function corsUrl(target){
    return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(target);
  }
  async function fetchJSON(target){
    const res = await fetch(corsUrl(target));
    if(!res.ok) throw new Error('bad response');
    return res.json();
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
      selectArtist(name);
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
    selectArtist(name);
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
    if(!q){ els.artistResults.innerHTML = '<div class="empty-hint">Start typing an artist name — Drake, Adele, Tame Impala, anyone with music on Apple Music.</div>'; return; }
    artistDebounce = setTimeout(()=>searchArtists(q), 350);
  });

  async function searchArtists(q){
    els.artistResults.innerHTML = '<div class="empty-hint">searching…</div>';
    try{
      const data = await fetchJSON(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=musicArtist&limit=8`);
      const artists = (data.results||[]).filter(a=>a.artistName);
      if(!artists.length){ els.artistResults.innerHTML = '<div class="empty-hint">No artists found. Try a different spelling.</div>'; return; }
      els.artistResults.innerHTML = '';
      artists.forEach(a=>{
        const row = document.createElement('div');
        row.className = 'result-item glass';
        row.innerHTML = `<div><div class="name">${a.artistName}</div><div class="type">${a.primaryGenreName||'Artist'}</div></div><div>→</div>`;
        row.addEventListener('click', ()=>selectArtist(a.artistName));
        els.artistResults.appendChild(row);
      });
    }catch(e){
      els.artistResults.innerHTML = '<div class="empty-hint">Couldn\'t reach the music service. Check your connection and try again.</div>';
    }
  }

  async function selectArtist(name){
    els.artistResults.innerHTML = '<div class="empty-hint">cueing up '+name+'\'s catalog…</div>';
    try{
      const data = await fetchJSON(`https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=song&attribute=artistTerm&limit=50`);
      const seen = new Set();
      const tracks = (data.results||[]).filter(t=>{
        if(!t.previewUrl) return false;
        if(t.artistName.toLowerCase() !== name.toLowerCase()) return false;
        const key = norm(t.trackName);
        if(seen.has(key)) return false;
        seen.add(key);
        return true;
      }).map(t=>({ title:t.trackName, artist:t.artistName, previewUrl:t.previewUrl, artwork:t.artworkUrl100.replace('100x100','400x400') }));

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

  function buildShareCanvas(){
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 800;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0,0,640,800);
    grad.addColorStop(0,'#2A1B10'); grad.addColorStop(1,'#150E09');
    ctx.fillStyle = grad; ctx.fillRect(0,0,640,800);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#E8A33D';
    ctx.font = 'italic 700 30px Georgia, serif';
    ctx.fillText('Spindle', 320, 70);

    drawVinylIcon(ctx, 320, 250, 130);

    const r = state.lastResult || {win:false, seconds:DURATIONS[DURATIONS.length-1]};
    ctx.fillStyle = r.win ? '#7FB069' : '#C4432B';
    ctx.font = '700 20px Arial, sans-serif';
    ctx.fillText(r.win ? ('SOLVED IN ' + r.seconds + 's') : 'MISSED', 320, 430);

    ctx.fillStyle = '#F3E9DC';
    ctx.font = '700 30px Georgia, serif';
    wrapText(ctx, state.current.title, 320, 480, 560, 36);

    ctx.fillStyle = '#B3A491';
    ctx.font = '400 18px Arial, sans-serif';
    ctx.fillText(state.current.artist, 320, 530);

    ctx.strokeStyle = 'rgba(232,163,61,0.3)';
    ctx.beginPath(); ctx.moveTo(120,590); ctx.lineTo(520,590); ctx.stroke();

    ctx.fillStyle = '#F3E9DC';
    ctx.font = '400 15px Arial, sans-serif';
    ctx.fillText(state.contextLabel, 320, 630);

    const streak = localStorage.getItem('spindle_streak') || '0';
    ctx.fillStyle = '#E8A33D';
    ctx.font = '700 16px Arial, sans-serif';
    ctx.fillText('Streak: ' + streak, 320, 662);

    ctx.fillStyle = '#6E5B48';
    ctx.font = '400 12px Arial, sans-serif';
    ctx.fillText('guess the song, live · real audio every round', 320, 750);

    return canvas;
  }
  function wrapText(ctx, text, x, y, maxWidth, lineHeight){
    const words = text.split(' ');
    let line = ''; const lines = [];
    words.forEach(w=>{
      const test = line + w + ' ';
      if(ctx.measureText(test).width > maxWidth && line){ lines.push(line); line = w + ' '; }
      else line = test;
    });
    lines.push(line);
    const startY = y - (lines.length-1)*lineHeight/2;
    lines.forEach((l,i)=> ctx.fillText(l.trim(), x, startY + i*lineHeight));
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
      }catch(e){ $('downloadLink').click(); }
    };
  });
  $('closeModal').addEventListener('click', ()=> $('shareModal').classList.remove('show'));
  $('shareModal').addEventListener('click', e=>{ if(e.target.id==='shareModal') $('shareModal').classList.remove('show'); });

  loadStats();
})();
});
