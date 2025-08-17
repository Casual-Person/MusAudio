// React ElasticSlider integration removed

// Global app state (ensure defined before any function uses it)
const state = (window.__musState = window.__musState || {
  _welcomeRan: false,
  design: (typeof localStorage!=='undefined' ? localStorage.getItem('design') : '') || 'liquid',
  shuffle: false,
  repeat: 'off',
  queue: [],
  queueIndex: 0,
  isPlaying: false,
  position: 0,
  duration: 0,
  // DJ Automix
  djAutomixEnabled: (typeof localStorage!=='undefined' ? (localStorage.getItem('djAutomix') === '1') : false),
  crossfadeSec: 6,
  // Internal automix state (runtime only)
  _automix: { preparing:false, prepared:null, targetIndex:-1, active:false },
  // Web Atmos
  virtualizationEnabled: (typeof localStorage!=='undefined' ? (localStorage.getItem('virtualize') !== '0') : true),
  atmosLayout: null,
  workletNode: null,
  workletKind: 'stereo',
  // Room analysis & calibration
  roomAnalysisEnabled: (typeof localStorage!=='undefined' ? localStorage.getItem('roomAnalysis')==='1' : false),
  roomCalib: (function(){
    try{ const s = localStorage.getItem('roomCalibration'); return s? JSON.parse(s) : null; }catch{ return null; }
  })(),
  // Playback routing
  playbackMode: 'pcm', // 'pcm' | 'native'
  nativeEl: null,
  nativeUrl: '',
  libraryIndex: null,
  libraryCache: null,
  useStaticLibrary: false,
  staticLibraryBaseUrl: './applefolders',
  rootHandle: null,
  libraryMode: 'artists',
  libraryNavStack: [],
  playlists: []
});
if (typeof window !== 'undefined' && window.__welcomeDone == null) window.__welcomeDone = false;

// Initialize playlists from localStorage on startup
(function initLocalPlaylists(){
  try{
    const s = localStorage.getItem('playlists');
    if (s){ const arr = JSON.parse(s); if (Array.isArray(arr)) state.playlists = arr; }
  }catch{}
})();

// Simple in-memory artwork cache: key -> { type, url }

async function getCoverPngUrl(album){
  try{
    // Static bundled library: build encoded URL directly
    if (state.useStaticLibrary){
      const base = state.staticLibraryBaseUrl.replace(/\/$/, '');
      const encJoin = (parts)=> parts.map(encodeURIComponent).join('/');
      const parts = album.coverRelPath ? album.coverRelPath.split('/').filter(Boolean) : [...album.folderParts, 'cover.png'];
      return `${base}/${encJoin(parts)}`;
    }
    if (album.coverIsPng && album.imageUrl) return album.imageUrl;
    const root = await getRootHandleFromCache(); if (!root) return '';
    let dir = root; for (const p of album.folderParts){ dir = await dir.getDirectoryHandle(p); }
    const file = await dir.getFileHandle('cover.png').then(h=>h.getFile());
    return URL.createObjectURL(file);
  }catch{ return ''; }
}
// Helper: ensure track titles are shown without file extensions
function displayTrackName(name){
  const s = String(name||'').trim();
  // Strip the final ".ext" if present (keeps dots within the base name)
  return s.replace(/\.[^.]+$/, '');
}

let mediaSessionActionsBound = false;
async function updateMediaSession(track, album){
  try{
    if (!('mediaSession' in navigator)) return;
    const coverUrl = await getCoverPngUrl(album);
    const artwork = coverUrl ? [{ src: coverUrl, sizes: '512x512', type: 'image/png' }] : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: displayTrackName(track.name),
      artist: album.artist,
      album: album.album,
      artwork
    });
    if (!mediaSessionActionsBound){
      mediaSessionActionsBound = true;
      try{ navigator.mediaSession.setActionHandler('play', ()=> play()); }catch{}
      try{ navigator.mediaSession.setActionHandler('pause', ()=> pause()); }catch{}
      try{ navigator.mediaSession.setActionHandler('previoustrack', ()=> previousTrack()); }catch{}
      try{ navigator.mediaSession.setActionHandler('nexttrack', ()=> nextTrack()); }catch{}
      try{ navigator.mediaSession.setActionHandler('seekto', (e)=>{ if (typeof e.seekTime==='number'){ seekTo(e.seekTime); } }); }catch{}
      try{ navigator.mediaSession.setActionHandler('seekbackward', (e)=>{ const s = (e.seekOffset||10); seekTo((state.position||0)-s); }); }catch{}
      try{ navigator.mediaSession.setActionHandler('seekforward', (e)=>{ const s = (e.seekOffset||10); seekTo((state.position||0)+s); }); }catch{}
    }
  }catch{}
}

function previousTrack(){
  if (state.queue.length===0) return;
  if (state.repeat==='one') return loadTrackByQueueIndex(state.queueIndex);
  if (state.shuffle){
    const i = Math.floor(Math.random()*state.queue.length);
    return loadTrackByQueueIndex(i);
  }
  const prev = state.queueIndex-1;
  if (prev < 0){
    if (state.repeat==='all') return loadTrackByQueueIndex(state.queue.length-1);
    return pause();
  }
  loadTrackByQueueIndex(prev);
}

function seekTo(seconds){
  const t = Math.max(0, Math.min(seconds, state.duration||0));
  if (state.playbackMode === 'native' && state.nativeEl){
    try{ state.nativeEl.currentTime = t; }catch{}
  } else {
    state.workletNode?.port.postMessage({ type:'seek', position: t });
  }
}
const artworkCache = new Map();
import { initDecoder, decodeToPcm, hasEac3Decoder } from './decoder.js?v=3';
import { extractMp3Tags } from './mp3-metadata.js';

// React sliders integration removed

function getCurrentVolume(){
  try{
    if (state.playbackMode === 'native' && state.nativeEl && typeof state.nativeEl.volume === 'number'){
      return state.nativeEl.volume;
    }
    if (state.gainNode && state.gainNode.gain){
      const v = state.gainNode.gain.value; if (!Number.isNaN(v)) return v;
    }
  }catch{}
  const vb = document.getElementById('volumeBar');
  return vb ? (parseFloat(vb.value||'1')||1) : 1;
}



const $ = (sel)=>document.querySelector(sel);
const $$ = (sel)=>document.querySelectorAll(sel);

// PWA - avoid SW on local dev to prevent fetch issues with Live Server
const isLocalDev = ['localhost','127.0.0.1'].includes(location.hostname);
// SW control flags:
//  - Default: disabled (prevents loops). Enable explicitly with ?sw=1 (persists in sessionStorage.sw)
//  - Emergency kill: ?nosw=1 (persists in sessionStorage.nosw) always disables
let swDisabled = true;
try{
  const qs = new URLSearchParams(location.search);
  const wantEnable = qs.get('sw') === '1';
  const wantDisable = qs.get('nosw') === '1';
  if (wantEnable) { sessionStorage.setItem('sw','1'); sessionStorage.removeItem('nosw'); }
  if (wantDisable) { sessionStorage.setItem('nosw','1'); sessionStorage.removeItem('sw'); }
  const enabledBySession = sessionStorage.getItem('sw') === '1';
  const disabledBySession = sessionStorage.getItem('nosw') === '1';
  swDisabled = disabledBySession ? true : !enabledBySession; // disabled unless explicitly enabled
}catch{}

if ('serviceWorker' in navigator && !isLocalDev && !swDisabled) {
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('./sw.js').then(reg=>{
      // If there's an update waiting, activate it immediately
      function activateWaiting(){
        if (reg.waiting) {
          reg.waiting.postMessage('SKIP_WAITING');
        }
      }
      // Listen for new worker
      reg.addEventListener('updatefound', ()=>{
        const sw = reg.installing || reg.waiting;
        if (!sw) return;
        sw.addEventListener('statechange', ()=>{
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            activateWaiting();
          }
        });
      });
      // Also try on ready
      if (reg.waiting) activateWaiting();
      // Disable auto-reload on controller change to avoid loops; optionally show a toast in the future
      navigator.serviceWorker.addEventListener('controllerchange', ()=>{
        console.debug('[SW] controller changed; update active. Reload manually if needed.');
      });
    }).catch(()=>{});
  });
}
// During local dev, ensure no stale SW controls the page
if ('serviceWorker' in navigator && (isLocalDev || swDisabled)) {
  window.addEventListener('load', async ()=>{
    try{
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=> r.unregister().catch(()=>{})));
      if (window.caches){
        const keys = await caches.keys();
        await Promise.all(keys.map(k=> caches.delete(k).catch(()=>{})));
      }
      // Do not auto-reload; avoid dev reload loops. Manually refresh if needed.
    }catch{}
  });
}

// ------------------------------
// Background rotator (crossfade images behind UI)
// ------------------------------
(function initBackgrounds(){
  async function start(){
    try{
      const overlay = document.getElementById('welcomeOverlay');
      if (!overlay) return;
      // Ensure we have two layers to crossfade
      let layers = overlay.querySelectorAll('.bg-layer');
      if (layers.length < 2){
        const a = document.createElement('div'); a.className = 'bg-layer';
        const b = document.createElement('div'); b.className = 'bg-layer';
        overlay.appendChild(a); overlay.appendChild(b);
        layers = overlay.querySelectorAll('.bg-layer');
      }

      // Load manifest of background images
      let paths = [];
      try{
        const res = await fetch('./img/backgrounds/manifest.json', { cache: 'no-cache' });
        if (res.ok){ const json = await res.json(); if (Array.isArray(json)) paths = json.filter(p=> typeof p === 'string'); }
      }catch{}
      if (!paths || paths.length === 0){
        // Fallback to a few known bundled images
        paths = [
          'img/backgrounds/4k-firewatch-river-stream-vnjdrwvxeo4f66qt.jpg',
          'img/backgrounds/4k-new-york-city-skyline-5l5t6upo5g9w4yzi.jpg',
          'img/backgrounds/712437.jpg'
        ];
      }

      // Filter to supported image extensions
      paths = paths.filter(p=> /\.(png|jpe?g|webp|gif)$/i.test(p));
      if (paths.length === 0) return;

      // Start from a random index for variety
      let idx = Math.floor(Math.random()*paths.length);
      let showing = 0; // which layer is visible

      const preload = (url)=> new Promise((resolve)=>{ const im = new Image(); im.onload = ()=> resolve(true); im.onerror = ()=> resolve(false); im.src = url; });

      async function setBackground(nextUrl){
        const cur = layers[showing];
        const nxt = layers[1-showing];
        nxt.style.backgroundImage = `url(${nextUrl})`;
        // Force reflow then crossfade
        void nxt.offsetWidth;
        nxt.classList.add('visible');
        cur.classList.remove('visible');
        showing = 1 - showing;
      }

      // Initial image
      const firstUrl = paths[idx % paths.length];
      await preload(firstUrl);
      layers[0].style.backgroundImage = `url(${firstUrl})`;
      layers[0].classList.add('visible');

      // Preload next in background
      const nextIdx = (idx+1) % paths.length;
      preload(paths[nextIdx]);

      // Cycle periodically
      let timer = null;
      const periodMs = 20000; // 20s
      const tick = async ()=>{
        idx = (idx+1) % paths.length;
        const url = paths[idx];
        await preload(url);
        await setBackground(url);
        // Preload the following one
        preload(paths[(idx+1)%paths.length]);
      };

      function startTimer(){ if (!timer) timer = setInterval(tick, periodMs); }
      function stopTimer(){ if (timer){ clearInterval(timer); timer = null; } }
      document.addEventListener('visibilitychange', ()=>{ document.hidden ? stopTimer() : startTimer(); });
      startTimer();
    }catch{}
  }

  if (!window.__welcomeDone){ window.addEventListener('welcome:done', start, { once:true }); return; }
  start();
})();

// ------------------------------
// Static brand title init (removes ASCII title effect)
// ------------------------------
(function initBrandTitle(){
  const el = document.getElementById('brandTitle') || document.querySelector('.brand');
  if (el && !el.textContent) el.textContent = 'MusAudio';
})();

// Welcome animation sequence
async function runWelcomeAnimation(){
  try{ console.debug('[welcome] runWelcomeAnimation() invoked'); }catch{}
  if (state._welcomeRan) { try{ console.debug('[welcome] already ran, skipping'); }catch{}; return; }
  state._welcomeRan = true;
  const headerBtn = $('#userPhotoBtn');
  const img = $('#userPhoto');
  const glass = $('#glassContainer');

  // Helper to dispatch completion exactly once
  let _done = false;
  const markDone = (reason)=>{
    if (_done) return; _done = true;
    try{ window.__welcomeDone = true; window.dispatchEvent(new Event('welcome:done')); console.debug('[welcome] done dispatched:', reason); }catch{}
  };

  try{
    if (!headerBtn || !img || !glass){
      console.debug('[welcome] missing elements, skipping animation', { hasHeaderBtn: !!headerBtn, hasImg: !!img, hasGlass: !!glass });
      if (glass){ glass.style.opacity='1'; glass.style.transform='translateY(0)'; }
      markDone('missing-elements');
      return;
    }

    // Start watchdog to prevent getting stuck
    let wd = setTimeout(()=>{ console.debug('[welcome] watchdog fired (2s) — forcing completion'); markDone('watchdog'); }, 2000);
    const clearWd = ()=>{ try{ clearTimeout(wd); }catch{} wd = null; };

    // Ensure initial states
    glass.style.opacity = glass.style.opacity || '0';
    glass.style.transform = glass.style.transform || 'translateY(10px)';
    // Hide header avatar during intro
    headerBtn.style.opacity = '0';
    // Ensure it's visible size-wise after animation (CSS default is scale(0))
    headerBtn.style.transform = 'scale(1)';

    // Create floating intro avatar in center
    const size = 56; // slightly larger for pop effect
    const intro = document.createElement('div');
    intro.className = 'welcome-intro';
    intro.style.position = 'fixed';
    intro.style.zIndex = '9999';
    const vw = window.innerWidth; const vh = window.innerHeight;
    let startX = Math.round(vw/2 - size/2);
    let startY = Math.round(vh/2 - size/2);
    intro.style.left = startX+'px';
    intro.style.top = startY+'px';
    intro.style.width = size+'px'; intro.style.height = size+'px';
    intro.style.borderRadius = '14px'; intro.style.overflow = 'hidden';
    intro.style.boxShadow = 'var(--shadow)';
    intro.style.border = '1px solid var(--glass-border)';
    intro.style.background = '#111';
    intro.style.transform = 'scale(0.4)'; intro.style.opacity = '0';
    intro.style.transition = 'transform 600ms cubic-bezier(.2,.8,.2,1), opacity 600ms';
    const pic = document.createElement('img'); pic.alt = 'User photo'; pic.style.width='100%'; pic.style.height='100%'; pic.style.objectFit='contain'; pic.style.background='#000';
    pic.src = img.src || '';
    intro.appendChild(pic);
    document.body.appendChild(intro);

    // Pop-in
    try{ console.debug('[welcome] pop-in start'); }catch{}
    requestAnimationFrame(()=>{ intro.style.transform='scale(1)'; intro.style.opacity='1'; });
    await new Promise(r=>setTimeout(r, 650));
    try{ console.debug('[welcome] pop-in end'); }catch{}

    // Move to header button position
    const rect = headerBtn.getBoundingClientRect();
    const dx = Math.round(rect.left - startX);
    const dy = Math.round(rect.top - startY);
    try{ console.debug('[welcome] move-to-header', { dx, dy, rect }); }catch{}
    intro.animate([
      { transform: 'translate(0px, 0px) scale(1)' },
      { transform: `translate(${dx}px, ${dy}px) scale(1)` }
    ], { duration: 600, easing: 'ease-in-out' });
    await new Promise(r=>setTimeout(r, 620));

    // Reveal header avatar and remove intro
    headerBtn.style.transition = 'opacity 250ms ease';
    headerBtn.style.opacity = '1';
    intro.remove();

    // Fade in glass
    glass.style.transition = 'opacity 600ms ease, transform 600ms ease';
    glass.style.opacity = '1';
    glass.style.transform = 'translateY(0)';
    try{ console.debug('[welcome] animation complete'); }catch{}
    clearWd();
    markDone('normal');
  }catch(err){
    console.debug('[welcome] animation error, falling back:', err);
    try{ document.querySelectorAll('.welcome-intro').forEach(n=>n.remove()); }catch{}
    if (glass){ glass.style.opacity='1'; glass.style.transform='translateY(0)'; }
    if (headerBtn){ headerBtn.style.opacity='1'; headerBtn.style.transform='scale(1)'; }
    markDone('error');
  }
}
  
// Local image picker removed: avatar is managed by Clerk only

// PWA installed detection and Login button behavior
(function setupPwaMode(){
  const loginBtn = document.getElementById('loginBtn');
  const userPhotoBtn = document.getElementById('userPhotoBtn');
  if (!loginBtn || !userPhotoBtn) return;

  const isStandaloneNow = ()=>
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    || window.navigator.standalone === true
    || (document.referrer||'').startsWith('android-app://');

  function showLogin(){ loginBtn.hidden = false; userPhotoBtn.hidden = true; }
  function showAvatar(){ loginBtn.hidden = true; userPhotoBtn.hidden = false; }

  // Apply early based on PWA mode (Clerk will refine later)
  const applyEarly = ()=>{ isStandaloneNow() ? showLogin() : showAvatar(); };
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', applyEarly, { once:true });
  } else {
    applyEarly();
  }

  // Also react if display-mode changes (rare)
  try{
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener?.('change', applyEarly);
  }catch{}
})();

// Clerk integration: initialize and bind UI
window.addEventListener('load', async ()=>{
  const clerk = window.Clerk;
  const loginBtn = document.getElementById('loginBtn');
  const userPhotoBtn = document.getElementById('userPhotoBtn');
  const userPhotoImg = document.getElementById('userPhoto');
  if (!clerk || !loginBtn || !userPhotoBtn || !userPhotoImg) return;
  try{
    await clerk.load();
  }catch(e){ console.warn('Clerk load failed:', e); return; }

  function renderAuth(){
    const user = clerk.user;
    if (user){
      // Show avatar
      loginBtn.hidden = true;
      userPhotoBtn.hidden = false;
      if (user.imageUrl) userPhotoImg.src = user.imageUrl;
    } else {
      // Show login if in standalone, else keep avatar for demo mode
      const isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
        || window.navigator.standalone === true
        || (document.referrer||'').startsWith('android-app://');
      loginBtn.hidden = !isStandalone ? true : false;
      userPhotoBtn.hidden = !isStandalone ? false : true;
    }
  }

  // Bind Login -> open Clerk sign-in modal
  loginBtn.onclick = (e)=>{
    e.preventDefault();
    if (typeof clerk.openSignIn === 'function'){
      clerk.openSignIn({
        appearance: { elements: { card: { backdropFilter: 'blur(12px)' } } },
        redirectUrl: location.href
      });
    }
  };

  // Clicking avatar -> open profile if available
  userPhotoBtn.onclick = ()=>{
    if (typeof clerk.openUserProfile === 'function') clerk.openUserProfile();
  };

  // Try to react to auth changes if API exists; otherwise poll briefly
  try{ clerk.addListener?.(()=> renderAuth()); }catch{}
  renderAuth();
  // fallback small poll
  let tries=0; const iv = setInterval(()=>{ renderAuth(); if (++tries>20) clearInterval(iv); }, 500);

  // After Clerk is ready, run school detection if signed in
  try{
    if (clerk.user) await handlePostLogin(clerk.user);
    clerk.addListener?.((e)=>{ try{ if (clerk.user) handlePostLogin(clerk.user); }catch{} });
  }catch{}
});
// Dock removed

// ---------------- School detection and branding ----------------
const BRAND_PROFILES = {
  'SECA':        { title: 'MusAudio — SECA', color: '#0b5fff' },
  'Edison High': { title: 'MusAudio — Edison', color: '#0ea5e9' },
  'Weber Institute': { title: 'MusAudio — Weber', color: '#22c55e' },
  'Marshall Elementary': { title: 'MusAudio — Marshall', color: '#f59e0b' },
  'SUSD':        { title: 'MusAudio — SUSD', color: '#ef4444' },
  'Delta College': { title: 'MusAudio — Delta College', color: '#7c3aed' },
  'Default':     { title: 'MusAudio', color: getComputedStyle(document.documentElement).getPropertyValue('--red') || '#e50914' }
};

function applyBranding(school){
  const prof = BRAND_PROFILES[school] || BRAND_PROFILES['Default'];
  // Title (typewriter optional stub)
  try{ document.title = prof.title; }catch{}
  // Theme color + accent var
  try{
    document.documentElement.style.setProperty('--red', prof.color);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', prof.color);
  }catch{}
  // Header brand text
  const brandEl = document.querySelector('.brand');
  if (brandEl) brandEl.textContent = school==='Default' ? 'MusAudio' : `MusAudio — ${school}`;
}

// Rough geofences (bounding boxes) for SUSD schools — placeholder values; tune as needed
const SCHOOL_BOXES = [
  { name:'SECA',               box:{ latMin:37.95, latMax:38.00, lonMin:-121.35, lonMax:-121.30 } },
  { name:'Edison High',        box:{ latMin:37.95, latMax:38.01, lonMin:-121.32, lonMax:-121.28 } },
  { name:'Weber Institute',    box:{ latMin:37.95, latMax:38.02, lonMin:-121.33, lonMax:-121.29 } },
  { name:'Marshall Elementary',box:{ latMin:37.94, latMax:38.01, lonMin:-121.35, lonMax:-121.30 } },
  { name:'SUSD',               box:{ latMin:37.93, latMax:38.05, lonMin:-121.42, lonMax:-121.22 } }
];

function matchSchoolByGeo(lat, lon){
  for (const s of SCHOOL_BOXES){
    const b=s.box; if (lat>=b.latMin && lat<=b.latMax && lon>=b.lonMin && lon<=b.lonMax) return s.name;
  }
  return null;
}

function requestGeo(timeoutMs=6000){
  return new Promise((resolve)=>{
    if (!navigator.geolocation){ resolve({ ok:false, reason:'no-geo' }); return; }
    let done=false; const to=setTimeout(()=>{ if(!done){ done=true; resolve({ ok:false, reason:'timeout' }); } }, timeoutMs);
    navigator.geolocation.getCurrentPosition((pos)=>{
      if (done) return; done=true; clearTimeout(to);
      const { latitude, longitude } = pos.coords || {};
      resolve({ ok:true, lat:latitude, lon:longitude });
    },()=>{
      if (done) return; done=true; clearTimeout(to);
      resolve({ ok:false, reason:'denied' });
    },{ enableHighAccuracy:false, timeout: timeoutMs, maximumAge: 120000 });
  });
}

async function handlePostLogin(user){
  try{
    const email = (user.primaryEmailAddress && (user.primaryEmailAddress.emailAddress||user.primaryEmailAddress)) || '';
    const domain = String(email.split('@')[1]||'').toLowerCase();
    // Restore saved school from metadata if present
    let saved = undefined;
    try{ saved = user.publicMetadata?.school; }catch{}
    if (saved){ applyBranding(saved); return; }

    if (domain === 'mustangs.deltacollege.edu'){
      applyBranding('Delta College');
      await maybeSaveSchool(user, 'Delta College');
      return;
    }
    if (domain === 'stocktonusd.org'){
      const g = await requestGeo();
      if (g.ok){
        const name = matchSchoolByGeo(g.lat, g.lon) || 'SUSD';
        applyBranding(name);
        await maybeSaveSchool(user, name);
        return;
      }
      // blocked or failed -> manual modal
      openSchoolModal('We could not get your location. Choose your school to continue.');
      return;
    }
    // Other domains -> default branding
    applyBranding('Default');
  }catch(e){ console.warn('Post-login school detection failed:', e); }
}

async function maybeSaveSchool(user, school){
  try{ await user.update?.({ publicMetadata: { ...(user.publicMetadata||{}), school } }); }catch{}
}

// Modal interactions
const schoolModal = ()=> document.getElementById('schoolModal');
function openSchoolModal(message){
  const dlg = schoolModal(); if (!dlg) return;
  const msg = document.getElementById('schoolModalMsg'); if (msg) msg.textContent = message||msg.textContent;
  dlg.showModal?.();
}
function closeSchoolModal(){ const dlg = schoolModal(); if (dlg?.open) dlg.close(); }

document.addEventListener('click', (e)=>{
  if (e.target?.id === 'closeSchoolModalBtn' || e.target?.id === 'cancelSchoolBtn'){ closeSchoolModal(); }
  if (e.target?.id === 'confirmSchoolBtn'){
    const sel = document.getElementById('schoolSelect');
    const otherRow = document.getElementById('otherSchoolRow');
    const other = document.getElementById('otherSchoolInput');
    let val = sel?.value || 'SUSD';
    if (val === 'Other'){ val = (other?.value||'').trim() || 'SUSD'; }
    applyBranding(val);
    try{ const clerk = window.Clerk; if (clerk?.user) maybeSaveSchool(clerk.user, val); }catch{}
    closeSchoolModal();
  }
});

document.addEventListener('change', (e)=>{
  if (e.target?.id === 'schoolSelect'){
    const show = e.target.value === 'Other';
    const row = document.getElementById('otherSchoolRow'); if (row) row.style.display = show? 'flex':'none';
  }
});

// Install prompt after 20 uses
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e)=>{ e.preventDefault(); deferredPrompt = e; });
(function uses(){
  const count = (parseInt(localStorage.getItem('uses')||'0',10)+1);
  localStorage.setItem('uses', String(count));
  const installedFlag = (localStorage.getItem('installed') === '1');
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  const btn = $('#installBtn');
  if (btn){ btn.hidden = installedFlag || standalone || (count < 20); }
})();
$('#installBtn').addEventListener('click', async ()=>{
  if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; }
});
window.addEventListener('appinstalled', ()=>{
  try{ localStorage.setItem('installed','1'); }catch{}
  const btn = $('#installBtn'); if (btn) btn.hidden = true;
  deferredPrompt = null;
});

// Settings dialog
const settings = $('#settingsPanel');
$('#settingsBtn').addEventListener('click', ()=> {
  // Reflect current state into controls each open
  try{
    const vt = $('#virtualizeToggle');
    if (vt){
      vt.checked = !!state.virtualizationEnabled;
      // Disable if not using Atmos (<=2ch)
      const canVirtualize = !!(state.atmosLayout && (state.atmosLayout.channels||0) > 2);
      vt.disabled = !canVirtualize;
    }
    const dj = $('#djAutomixToggle');
    if (dj){ dj.checked = !!state.djAutomixEnabled; }
    const lo = $('#layoutOut');
    if (lo){
      const ly = state.atmosLayout;
      if (ly){
        const ch = ly.channels||2;
        const ac = (ly.acmod!=null)? ` (acmod ${ly.acmod}${ly.lfeon?'+lfe':''})` : '';
        lo.textContent = `Layout: ${ch}ch${ac}`;
      } else {
        lo.textContent = 'Layout: unknown';
      }
    }
    // Ensure meters exist with correct count when opening settings
    const ly = state.atmosLayout;
    const wrap = document.getElementById('meters');
    if (wrap){
      const existing = wrap.querySelectorAll('.meter').length;
      const want = (ly && (ly.channels||0) > 2) ? ly.channels : 0;
      if (want && existing !== want) renderMeters(want);
      if (!want){ wrap.innerHTML=''; wrap.style.opacity='0.5'; }
    }
    // Room analysis controls
    const raToggle = $('#roomAnalysisToggle');
    const analyzeBtn = $('#analyzeRoomBtn');
    const modeOut = $('#atmosModeOut');
    const raEnabled = !!state.roomAnalysisEnabled;
    if (raToggle) raToggle.checked = raEnabled;
    if (analyzeBtn) analyzeBtn.disabled = !raEnabled;
    if (modeOut) modeOut.textContent = state.roomCalib ? 'Calibrated' : (raEnabled ? 'Enabled (not calibrated)' : 'Disabled');
  }catch{}
  settings.showModal();
});
$('#closeSettingsBtn').addEventListener('click', ()=> settings.close());

// Virtualization toggle wiring
(function initVirtualizeToggle(){
  const vt = document.getElementById('virtualizeToggle');
  if (!vt) return;
  // Initial state
  vt.checked = !!state.virtualizationEnabled;
  vt.addEventListener('change', (e)=>{
    const enabled = !!e.target.checked;
    state.virtualizationEnabled = enabled;
    try{ localStorage.setItem('virtualize', enabled ? '1' : '0'); }catch{}
    // Apply at runtime if Atmos mixer active
    try{ state.workletNode?.port?.postMessage({ type:'virtualization', enabled }); }catch{}
  });
})();

// DJ Automix toggle wiring
(function initDjAutomixToggle(){
  const t = document.getElementById('djAutomixToggle');
  if (!t) return;
  // Initial state
  t.checked = !!state.djAutomixEnabled;
  t.addEventListener('change', (e)=>{
    const on = !!e.target.checked;
    state.djAutomixEnabled = on;
    try{ localStorage.setItem('djAutomix', on ? '1' : '0'); }catch{}
  });
})();

// Clerk helpers for settings persistence
function debounce(fn, wait){ let t=null; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), wait); }; }
async function getClerk(){ try{ const c = window.Clerk; if (!c) return null; await c.load(); return c; }catch{ return null; } }
const debouncedUserUpdate = debounce(async (patch)=>{
  try{
    const c = await getClerk(); const user = c?.user; if (!user) return;
    const cur = user.publicMetadata || {};
    await user.update({ publicMetadata: { ...cur, ...patch } });
  }catch{}
}, 500);
function saveToClerk(patch){ debouncedUserUpdate(patch); }

// -------- Playlists: local + Clerk persistence helpers --------
function sanitizePlaylistsForClerk(arr){
  try{
    return (Array.isArray(arr)? arr: []).map(p=>({
      id: p.id,
      name: p.name,
      tracks: (p.tracks||[]).map(t=>({ albumKey: t.albumKey, trackIndex: t.trackIndex })),
      collaborative: !!p.collaborative,
      createdAt: p.createdAt || Date.now(),
      updatedAt: p.updatedAt || Date.now()
      // Note: cover files are local-only for now due to size/access constraints
    }));
  }catch{ return []; }
}

function setPlaylists(arr, opts={}){
  try{ state.playlists = Array.isArray(arr) ? arr : []; }catch{ state.playlists = []; }
  try{ localStorage.setItem('playlists', JSON.stringify(state.playlists)); }catch{}
  if (!opts.silentClerk){
    try{ saveToClerk({ playlists: sanitizePlaylistsForClerk(state.playlists) }); }catch{}
  }
}

function addPlaylist(pl, opts={}){
  const now = Date.now();
  const base = {
    id: pl.id || `pl_${now}`,
    name: (pl.name||'').trim() || 'Untitled Playlist',
    tracks: Array.isArray(pl.tracks)? pl.tracks : [],
    collaborative: !!pl.collaborative,
    createdAt: pl.createdAt || now,
    updatedAt: now,
    cover: pl.cover || null
  };
  setPlaylists([...(state.playlists||[]), base], opts);
  return base;
}

function mergePlaylists(localArr, remoteArr){
  const local = Array.isArray(localArr)? localArr: [];
  const remote = Array.isArray(remoteArr)? remoteArr: [];
  const byId = new Map();
  for (const p of local){ if (p && p.id) byId.set(p.id, p); }
  for (const r of remote){
    if (!r || !r.id){ continue; }
    const l = byId.get(r.id);
    if (!l){ byId.set(r.id, r); continue; }
    const lu = l.updatedAt||0, ru = r.updatedAt||0;
    byId.set(r.id, ru >= lu ? r : l);
  }
  return Array.from(byId.values());
}

function updatePlaylist(id, patch, opts={}){
  const list = Array.isArray(state.playlists)? state.playlists.slice(): [];
  const idx = list.findIndex(p=> p && p.id === id);
  if (idx === -1) return null;
  const now = Date.now();
  const next = { ...list[idx], ...patch, updatedAt: now };
  list[idx] = next;
  setPlaylists(list, opts);
  return next;
}

function removePlaylist(id, opts={}){
  const list = Array.isArray(state.playlists)? state.playlists: [];
  const filtered = list.filter(p=> p && p.id !== id);
  setPlaylists(filtered, opts);
}

// Design language
function applyDesign(mode){
  document.body.dataset.design = mode;
  localStorage.setItem('design', mode);
  // Animated transition pulse
  try{
    const ov = document.createElement('div');
    ov.style.position='fixed'; ov.style.inset='0'; ov.style.pointerEvents='none';
    ov.style.background='radial-gradient(600px 300px at 50% 50%, rgba(255,255,255,0.18), transparent 60%)';
    ov.style.opacity='0'; ov.style.transition='opacity 500ms'; ov.style.zIndex='10';
    document.body.appendChild(ov);
    requestAnimationFrame(()=>{ ov.style.opacity='1'; });
    setTimeout(()=>{ ov.style.opacity='0'; setTimeout(()=> ov.remove(), 520); }, 220);
  }catch{}
}

// Promote setDesign so both UI and Clerk loader can use it
function setDesign(val){
  state.design = val;
  try{ localStorage.setItem('design', val); }catch{}
  applyDesign(val);
  // Persist to Clerk if signed in
  saveToClerk({ design: val });
}

// -------- Room Analysis: toggle + calibration flow --------
(function initRoomAnalysisUI(){
  const toggle = document.getElementById('roomAnalysisToggle');
  const analyzeBtn = document.getElementById('analyzeRoomBtn');
  const out = document.getElementById('atmosModeOut');
  function reflect(){
    if (toggle) toggle.checked = !!state.roomAnalysisEnabled;
    if (analyzeBtn) analyzeBtn.disabled = !state.roomAnalysisEnabled;
    if (out) out.textContent = state.roomCalib ? 'Calibrated' : (state.roomAnalysisEnabled ? 'Enabled (not calibrated)' : 'Disabled');
  }
  reflect();
  toggle?.addEventListener('change', (e)=>{
    const on = !!e.target.checked;
    state.roomAnalysisEnabled = on;
    try{ localStorage.setItem('roomAnalysis', on? '1':'0'); }catch{}
    saveToClerk({ roomAnalysisEnabled: on });
    if (on && !state.roomCalib){ openRoomCalibration(); }
    reflect();
  });
  analyzeBtn?.addEventListener('click', ()=>{
    if (!state.roomCalib){ openRoomCalibration(); return; }
    // Simple post-calibration placeholder: show ready
    if (out) out.textContent = 'Calibrated — Ready';
  });
})();

// Calibration session helpers
function openRoomCalibration(){
  const dlg = document.getElementById('roomCalibModal'); if (!dlg) return;
  const wrap = document.getElementById('roomCalibVideoWrap'); if (!wrap) return;
  const stepEl = document.getElementById('roomCalibStep');
  const hintEl = document.getElementById('roomCalibHint');
  const blurEl = document.getElementById('roomCalibBlur');
  const nextBtn = document.getElementById('roomCalibNextBtn');
  const cancelBtn = document.getElementById('roomCalibCancelBtn');
  const closeBtn = document.getElementById('closeRoomCalibBtn');
  const msgEl = document.getElementById('roomCalibMsg');
  const steps = ['Face up','Face left','Face right','Face down','Rotate slowly'];
  let idx = 0; let stream = null; let raf = 0; let interval = 0; let lastScore = 0;
  const video = document.createElement('video');
  video.id='roomCalibVideo'; video.autoplay=true; video.playsInline=true; video.muted=true; video.style.width='100%';
  const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently:true });

  function setStep(i){ idx = i; if (stepEl) stepEl.textContent = `Step ${i+1}/${steps.length}`; if (hintEl) hintEl.textContent = steps[i]||''; }
  function computeBlurScore(){
    if (!video.videoWidth || !video.videoHeight) return 0;
    const w = Math.max(64, Math.floor(video.videoWidth/3));
    const h = Math.max(64, Math.floor(video.videoHeight/3));
    canvas.width = w; canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0,0,w,h);
    // simple gradient magnitude density
    let edges=0; const thr=80; const data = img.data; const stride = w*4;
    for (let y=1;y<h-1;y++){
      for (let x=1;x<w-1;x++){
        const o = (y*w + x)*4;
        const gx = (data[o+4]||0) - (data[o-4]||0);
        const gy = (data[o+stride]||0) - (data[o-stride]||0);
        const mag = Math.abs(gx)+Math.abs(gy);
        if (mag>thr) edges++;
      }
    }
    return edges/(w*h);
  }
  function tick(){
    lastScore = computeBlurScore();
    // warning-only UI: no numeric score
    if (blurEl) blurEl.textContent = (lastScore < 0.055) ? 'Background too blurry' : '';
    // gate Next button on clarity
    if (nextBtn) nextBtn.disabled = lastScore < 0.055;
    raf = requestAnimationFrame(tick);
  }
  async function start(){
    try{
      if (msgEl) msgEl.textContent = 'Requesting camera permission...';
      dlg.showModal();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
        if (msgEl) msgEl.textContent = 'Camera not supported in this browser.';
        return;
      }
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio:false });
      video.srcObject = stream; wrap.innerHTML=''; wrap.appendChild(video);
      setStep(0);
      if (msgEl) msgEl.textContent = '';
      tick();
    }catch(e){
      const insecure = (location.protocol !== 'https:') && (location.hostname !== 'localhost');
      if (msgEl) msgEl.textContent = insecure ? 'Camera requires HTTPS or localhost.' : ('Camera access denied: ' + (e?.message||''));
    }
  }
  function stop(){
    try{ cancelAnimationFrame(raf); }catch{}
    try{ clearInterval(interval); }catch{}
    try{ stream?.getTracks?.().forEach(t=>t.stop()); }catch{}
    try{ video.srcObject = null; }catch{}
  }
  async function finish(){
    stop();
    const calib = { ts: Date.now(), steps: steps.length, blurMin: lastScore, devicePixelRatio: window.devicePixelRatio||1 };
    state.roomCalib = calib;
    try{ localStorage.setItem('roomCalibration', JSON.stringify(calib)); }catch{}
    saveToClerk({ roomCalibration: calib });
    try{
      const analyzeBtn = document.getElementById('analyzeRoomBtn'); if (analyzeBtn) analyzeBtn.disabled = !state.roomAnalysisEnabled ? true : false;
      const out = document.getElementById('atmosModeOut'); if (out) out.textContent = 'Calibrated';
    }catch{}
    dlg.close();
  }
  nextBtn?.addEventListener('click', ()=>{
    if (lastScore < 0.055){ msgEl && (msgEl.textContent = 'Background appears blurry. Move to a clearer background.'); return; }
    if (idx < steps.length-1){ setStep(idx+1); msgEl && (msgEl.textContent = ''); }
    else { finish(); }
  }, { once:false });
  cancelBtn?.addEventListener('click', ()=>{ stop(); dlg.close(); });
  closeBtn?.addEventListener('click', ()=>{ stop(); dlg.close(); });
  start();
}

// Initialize custom design dropdown (with native select fallback)
(function initDesignControl(){
  // Fallback: native select if present
  const nativeSel = $('#designSelect');
  if (nativeSel){
    if (state.design) nativeSel.value = state.design;
    nativeSel.addEventListener('change', ()=> setDesign(nativeSel.value));
  }

  const root = document.getElementById('designDropdown');
  const btn = document.getElementById('designDropdownBtn');
  const list = document.getElementById('designDropdownList');
  if (!root || !btn || !list){
    // still apply saved design once
    applyDesign(state.design || 'liquid');
    return;
  }
  const label = root.querySelector('.dropdown-label');
  const options = Array.from(list.querySelectorAll('[role="option"]'));
  // Make options focusable for keyboard navigation
  options.forEach(o=>{ if (!o.hasAttribute('tabindex')) o.setAttribute('tabindex','-1'); });

  function applySelection(val){
    options.forEach(o=> o.setAttribute('aria-selected', String(o.dataset.value===val)));
    root.dataset.value = val;
    if (label){ const o = options.find(o=>o.dataset.value===val); if (o) label.textContent = o.textContent; }
    setDesign(val);
  }

  // Init value from saved state or markup
  applySelection(state.design || root.dataset.value || (localStorage.getItem('design')||'liquid'));

  function closeList(){ btn.setAttribute('aria-expanded','false'); list.style.display='none'; }
  function openList(){
    btn.setAttribute('aria-expanded','true');
    list.style.display='block';
    const cur = options.find(o=> o.getAttribute('aria-selected')==='true') || options[0];
    (cur||list).focus();
  }

  btn.addEventListener('click', (e)=>{
    e.preventDefault();
    const expanded = btn.getAttribute('aria-expanded')==='true';
    expanded? closeList(): openList();
  });
  options.forEach(o=> o.addEventListener('click', ()=>{ applySelection(o.dataset.value); closeList(); }));
  document.addEventListener('click', (e)=>{ if (!root.contains(e.target)) closeList(); });
  list.addEventListener('keydown', (e)=>{
    if (e.key==='Escape'){ e.preventDefault(); closeList(); btn.focus(); return; }
    const idx = options.findIndex(o=> o.getAttribute('aria-selected')==='true');
    if (e.key==='ArrowDown' || e.key==='ArrowUp'){
      e.preventDefault();
      let ni = idx<0? 0 : (e.key==='ArrowDown'? Math.min(options.length-1, idx+1): Math.max(0, idx-1));
      options[ni].focus?.();
      options.forEach((o,i)=> o.setAttribute('aria-selected', String(i===ni)));
    }
    if (e.key==='Enter' || e.key===' '){
      e.preventDefault();
      const cur = options.find(o=> o.getAttribute('aria-selected')==='true') || options[0];
      if (cur){ applySelection(cur.dataset.value); closeList(); btn.focus(); }
    }
  });
})();

// Load settings from Clerk public metadata on ready/sign-in
(async function loadClerkSettings(){
  try{
    const c = await getClerk(); if (!c) return;
    const applyFromMeta = ()=>{
      try{
        const meta = c.user?.publicMetadata || {};
        if (meta.design && typeof meta.design === 'string'){
          // Avoid re-saving immediately; temporarily silence save
          const orig = saveToClerk; saveToClerk = ()=>{};
          try{ setDesign(meta.design); } finally { saveToClerk = orig; }
        }
        // Playlists: merge Clerk -> local and avoid immediate re-save
        if (Array.isArray(meta.playlists)){
          const merged = mergePlaylists(state.playlists||[], meta.playlists);
          const orig = saveToClerk; saveToClerk = ()=>{};
          try{ setPlaylists(merged); } finally { saveToClerk = orig; }
        } else {
          // If Clerk has none but local exists, push local up
          if ((state.playlists||[]).length){
            saveToClerk({ playlists: sanitizePlaylistsForClerk(state.playlists) });
          }
        }
      }catch{}
    };
    applyFromMeta();
    // Listen for auth changes to re-apply on sign-in
    try{ c.addListener?.((e)=>{ if (e?.type && /session|auth|user/.test(e.type)) applyFromMeta(); }); }catch{}
  }catch{}
})();

// Pointer-positioned ripple for .icon-btn (works with CSS --rx/--ry)
document.addEventListener('pointerdown', (e)=>{
  const btn = e.target.closest && e.target.closest('.icon-btn');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
  btn.style.setProperty('--rx', `${e.clientX - rect.left}px`);
  btn.style.setProperty('--ry', `${e.clientY - rect.top}px`);
});

// Shuffle button: toggle + persist
(function initShuffle(){
  const btn = document.getElementById('shuffleBtn');
  if (!btn) return;
  // Restore from localStorage
  let active = false;
  try{ active = localStorage.getItem('shuffle') === '1'; }catch{}
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  if (typeof state === 'object') state.shuffle = !!active;
  btn.addEventListener('click', ()=>{
    const now = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', now ? 'true' : 'false');
    if (typeof state === 'object') state.shuffle = !!now;
    try{ localStorage.setItem('shuffle', now ? '1' : '0'); }catch{}
  });
})();

// Hover popup: keep visible when hovering area or popup, hide with small delay
(function initHoverPopup(){
  const popup = document.getElementById('popupImageContainer');
  if (!popup) return;
  let hideTimer = null;
  let stick = false; // true while hovering popup
  let isShown = false;

  const show = ()=>{
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (!isShown){ popup.classList.add('show'); isShown = true; }
  };
  const hideLater = (delay=180)=>{
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(()=>{ if (!stick && isShown){ popup.classList.remove('show'); isShown = false; } }, delay);
  };

  // Keep visible while mouse is over the popup
  popup.addEventListener('mouseenter', ()=>{ stick = true; show(); });
  popup.addEventListener('mouseleave', ()=>{ stick = false; hideLater(220); });
  // Prevent any accidental navigation/propagation on popup clicks
  popup.addEventListener('click', (e)=>{ e.preventDefault?.(); e.stopPropagation?.(); }, true);
  const imgEl = document.getElementById('popupImage');
  if (imgEl) imgEl.addEventListener('click', (e)=>{ e.preventDefault?.(); e.stopPropagation?.(); }, true);

  // Global hover: show when cursor is within 256px from bottom-left corner
  let mmPending = false; let lastEvt = null;
  const onMM = ()=>{
    mmPending = false;
    const e = lastEvt; if (!e) return;
    try{
      const vh = window.innerHeight;
      const fromLeft = e.clientX;
      const fromBottom = vh - e.clientY;
      const inHotspot = (fromLeft >= 0 && fromLeft <= 256 && fromBottom >= 0 && fromBottom <= 256);
      if (inHotspot) show(); else hideLater(220);
    }catch{}
  };
  window.addEventListener('mousemove', (e)=>{
    lastEvt = e;
    if (!mmPending){ mmPending = true; requestAnimationFrame(onMM); }
  }, { passive:true });
})();

// Optional: prevent reloads during debugging. Enable with ?debugreload=1 (persists in session)
(function initReloadGuard(){
  try{
    const qs = new URLSearchParams(location.search);
    const enable = qs.get('debugreload') === '1';
    if (enable) sessionStorage.setItem('debug_noreload','1');
    const on = sessionStorage.getItem('debug_noreload') === '1';
    if (!on) return;
    window.addEventListener('beforeunload', (e)=>{
      console.warn('[debug] beforeunload intercepted to diagnose reloads');
      e.preventDefault(); e.returnValue = '';
    });
  }catch{}
})();

// Headphone detection & NC
let hpEnabled = false; let hpInUse = false; let ncMode = 'off';
$('#enableHeadphoneDetectBtn').addEventListener('click', async ()=>{
  try{
    await navigator.mediaDevices.getUserMedia({audio:true});
    hpEnabled = true;
    $('#hpStatusOut').textContent = 'Headphones: Monitoring';
  }catch(e){
    $('#hpStatusOut').textContent = 'Headphones: Permission denied';
  }
});

navigator.mediaDevices?.addEventListener?.('devicechange', async ()=>{
  if (!hpEnabled) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const outs = devices.filter(d=>d.kind==='audiooutput');
  const likelyHP = outs.some(o=>/headphone|bluetooth|airpods|buds/i.test(o.label));
  const prev = hpInUse; hpInUse = likelyHP;
  $('#hpStatusOut').textContent = 'Headphones: ' + (hpInUse? 'Detected' : 'Not detected');
  if (prev && !hpInUse) pause();
  if (!prev && hpInUse && state.currentTrackMeta) play();
});

$$('input[name="ncMode"]').forEach(r=> r.addEventListener('change', (e)=>{
  ncMode = e.target.value;
  // short notification sound when NC engaged
  if (ncMode !== 'off') beep();
}));

function beep(){
  const ctx = state.audioCtx || new (window.AudioContext||window.webkitAudioContext)();
  if (!state.audioCtx) state.audioCtx = ctx;
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type='sine'; o.frequency.setValueAtTime(880, ctx.currentTime);
  g.gain.setValueAtTime(0.001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.1, ctx.currentTime+0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.25);
  o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime+0.26);
}

// Legacy edge-density analyzer removed in favor of guided calibration flow.

// Library: pick directory and index
$('#pickWorkspaceBtn').addEventListener('click', async ()=>{
  try{
    const dir = await window.showDirectoryPicker({ id:'apple-folders' });
    state.rootHandle = dir;
    const index = await buildLibraryIndex(dir);
    state.libraryIndex = index;
    localStorage.setItem('libraryIndex', JSON.stringify(index.serialized));
    enterArtistsView();
    // Auto-generate audio mapping JSON (no UI impact)
    try{
      const mapping = await buildAudioMappingJSON(dir, index.serialized);
      await promptSaveIndex(mapping);
    }catch(e){ console.warn('JSON mapping failed:', e); }
  }catch(e){ /* canceled */ }
});

function inferMetaFromPath(pathParts){
  // Expect artist/album/track.ext
  const len = pathParts.length;
  const track = pathParts[len-1];
  const d1 = pathParts[len-2];
  const d2 = pathParts[len-3];
  const d3 = pathParts[len-4];
  const discLike = d1 && /^(disc|cd)\s*\d+/i.test(d1);
  const album = discLike ? (d2 || 'Unknown Album') : (d1 || 'Unknown Album');
  const artist = discLike ? (d3 || 'Unknown Artist') : (d2 || 'Unknown Artist');
  return { artist, album, track };
}

// Find artwork file within a directory, optionally recursing into subfolders (limited depth)
async function findArtworkInDir(dirHandle, depth=1){
  const videoCandidates = ['square_animated_artwork.mp4','artwork.mp4'];
  const imageCandidates = ['cover.png','cover.jpg','folder.png','folder.jpg','artwork.png','artwork.jpg'];

  // Try files in the current directory first (prefer video)
  for (const name of videoCandidates){
    try { const fh = await dirHandle.getFileHandle(name); return { type:'video', handle: fh }; } catch{}
  }
  for (const name of imageCandidates){
    try { const fh = await dirHandle.getFileHandle(name); return { type:'image', handle: fh }; } catch{}
  }

  // Recurse into subdirectories if allowed
  if (depth > 0){
    try{
      for await (const [name, handle] of dirHandle.entries()){
        if (handle.kind === 'directory'){
          const found = await findArtworkInDir(handle, depth-1);
          if (found) return found;
        }
      }
    }catch{}
  }
  return null;
}

async function buildLibraryIndex(rootHandle){
  const albumsMap = new Map();
  async function traverse(dirHandle, prefix=[]) {
    for await (const [name, handle] of dirHandle.entries()){
      if (handle.kind === 'directory'){
        await traverse(handle, [...prefix, name]);
      } else {
        const lower = name.toLowerCase();
        const ext = lower.split('.').pop();
        if (!['m4a','ac4','ec3','wma','dts','mp3','flac','wav'].includes(ext)) continue;
        const meta = inferMetaFromPath([...prefix, name]);
        const albumKey = meta.artist+'::'+meta.album;
        // Determine the album root folder parts (artist/album). If last folder is Disc/CD, drop it.
        let albumFolderParts = prefix;
        const last = prefix[prefix.length-1];
        if (last && /^(disc|cd)\s*\d+/i.test(last)){
          albumFolderParts = prefix.slice(0, Math.max(0, prefix.length-1));
        }
        if (!albumsMap.has(albumKey)){
          albumsMap.set(albumKey, { artist: meta.artist, album: meta.album, tracks: [], dir: dirHandle, albumFolderParts, key: albumKey });
        } else {
          // Keep the shortest (closest to root) album folder parts if multiple are seen
          const cur = albumsMap.get(albumKey);
          if (!cur.albumFolderParts || albumFolderParts.length < cur.albumFolderParts.length){
            cur.albumFolderParts = albumFolderParts;
          }
        }
        const track = { name: name.replace(/\.[^.]+$/, ''), filename:name, ext, pathParts:[...prefix, name], codec: (ext||'').toUpperCase() };
        // If MP3, attempt to read ID3 tags and embedded artwork
        if (ext === 'mp3'){
          try{
            const file = await handle.getFile();
            const tags = await extractMp3Tags(file);
            if (tags){
              if (tags.title) track.name = tags.title;
              if (tags.artist) track.tagArtist = tags.artist;
              if (tags.album) track.tagAlbum = tags.album;
              if (tags.pictureUrl) track.pictureUrl = tags.pictureUrl; // blob URL
              track.id3 = tags.raw || null;
            }
          }catch{}
        }
        albumsMap.get(albumKey).tracks.push(track);
      }
    }
  }
  await traverse(rootHandle, []);

  const albums = [];
  for (const [,a] of [...albumsMap.entries()].sort((x,y)=> x[1].album.localeCompare(y[1].album))){
    // Prefer tag-derived artist/album if available and consistent across tracks
    const firstWithTags = (a.tracks||[]).find(t=> t.tagArtist || t.tagAlbum);
    const displayArtist = firstWithTags?.tagArtist || a.artist;
    const displayAlbum = firstWithTags?.tagAlbum || a.album;
    const primaryCodec = (a.tracks && a.tracks[0]?.codec) ? a.tracks[0].codec : '';
    // detect artwork in album folder
    let coverType = 'none';
    let imageUrl = '';
    let coverIsPng = false;
    let videoUrl = '';
    try{
      let albumFolder = rootHandle;
      for (const part of a.albumFolderParts){
        albumFolder = await albumFolder.getDirectoryHandle(part);
      }
      // Prefer cover.png in the album root first
      try{
        const fhImg = await albumFolder.getFileHandle('cover.png');
        const file = await fhImg.getFile();
        imageUrl = URL.createObjectURL(file);
        coverType = 'image';
        coverIsPng = true;
      }catch{}
      // If no cover.png, fall back to animated artwork in root or subfolders
      if (!imageUrl){
        const found = await findArtworkInDir(albumFolder, 2);
        if (found){
          const file = await found.handle.getFile();
          const url = URL.createObjectURL(file);
          if (found.type === 'image'){ imageUrl = url; coverType = 'image'; }
          else if (found.type === 'video'){ videoUrl = url; coverType = 'video'; }
        }
      }
    }catch{ /* ignore */ }
    // As a final fallback, if album still lacks image, try embedded art from any MP3 track
    if (!imageUrl){
      try{
        const picTrack = (a.tracks||[]).find(t=> t.ext==='mp3' && t.pictureUrl);
        if (picTrack && picTrack.pictureUrl){ imageUrl = picTrack.pictureUrl; coverType = 'image'; }
      }catch{}
    }
    // Persist eager-detected artwork in RAM cache map as well
    if (a.key){
      if (imageUrl) artworkCache.set(a.key, { type:'image', url: imageUrl });
      else if (videoUrl) artworkCache.set(a.key, { type:'video', url: videoUrl });
    }
    albums.push({ artist:a.artist, album:a.album, displayArtist, displayAlbum, primaryCodec, coverType, handle:rootHandle, folderParts:a.albumFolderParts, tracks:a.tracks, key:a.key, imageUrl, videoUrl, coverIsPng });
  }

  // Serialized for caching (paths only)
  const serialized = {
    albums: albums.map(al=>({ artist:al.artist, album:al.album, coverType:al.coverType, folderParts:al.folderParts, key: al.key, imageUrl: al.imageUrl||'', videoUrl: al.videoUrl||'', coverIsPng: !!al.coverIsPng, tracks: al.tracks.map(t=>({ name:t.name, filename:t.filename, ext:t.ext, pathParts:t.pathParts })) }))
  };

  // View model
  return { serialized, view: serialized };
}

function renderLibrary(index){
  const list = $('#libraryList'); list.innerHTML = '';
  const q = ($('#searchInput').value||'').toLowerCase();
  for (const album of index.albums){
    const match = album.album.toLowerCase().includes(q) || album.artist.toLowerCase().includes(q)
      || album.tracks.some(t=> t.name.toLowerCase().includes(q));
    if (!match) continue;
    const card = document.createElement('article'); card.className='card'; card.tabIndex=0; card.setAttribute('role','button');
    const media = document.createElement('div'); media.className='card-media';
    // Library should always show static cover.png even if animated exists
    if (album.imageUrl){
      const img = document.createElement('img'); img.alt='Album cover'; img.src = album.imageUrl; media.appendChild(img);
    } else {
      const img = document.createElement('img'); img.alt='Album cover'; media.appendChild(img);
      awaitAlbumArtworkUrl(album, 'image').then(url=>{ if (url) img.src = url; });
    }
    const body = document.createElement('div'); body.className='card-body';
    const title = document.createElement('div'); title.className='card-title'; title.textContent = (album.displayAlbum||album.album);
    const sub = document.createElement('div'); sub.className='card-sub'; sub.textContent = (album.displayArtist||album.artist);
    // Codec badge (based on first track extension)
    if (album.primaryCodec){
      const badge = document.createElement('span');
      badge.className = 'codec-badge';
      badge.textContent = album.primaryCodec;
      badge.setAttribute('aria-label', 'Codec');
      body.appendChild(badge);
    }
    body.append(title, sub);
    card.append(media, body);

    card.addEventListener('click', ()=>{
      // load album into queue
      state.queue = album.tracks.map((t,i)=> ({ album, index:i }));
      state.queueIndex = 0;
      updateQueuePanel();
      loadTrackByQueueIndex(0);
    });

    list.appendChild(card);
  }
}

// --- Enhanced Library Views (Artists / Albums / Details) ---

function computeArtistsView(index){
  const map = new Map();
  for (const album of (index?.albums||[])){
    const name = album.artist||'Unknown Artist';
    if (!map.has(name)) map.set(name, { name, albums: [] });
    map.get(name).albums.push(album);
  }
  return [...map.values()].sort((a,b)=> a.name.localeCompare(b.name));
}

async function awaitArtistProfileUrl(artist){
  try{
    const anyAlbum = artist.albums[0]; if (!anyAlbum) return '';
    if (state.useStaticLibrary){
      const base = state.staticLibraryBaseUrl.replace(/\/$/, '');
      const artistParts = (anyAlbum.folderParts||[]).slice(0, -1);
      if (artistParts.length){
        const enc = artistParts.map(encodeURIComponent).join('/');
        const url = `${base}/${enc}/folder.png`;
        // probe existence once
        try{ const res = await fetch(url, { method:'HEAD' }); if (res.ok) return url; }catch{}
      }
      // fallback to album cover
      if (anyAlbum.imageUrl) return anyAlbum.imageUrl;
      const img = await awaitAlbumArtworkUrl(anyAlbum, 'image');
      return img||'';
    }
    // Picker-based
    const root = await getRootHandleFromCache(); if (!root) return '';
    let dir = root;
    for (const p of (anyAlbum.folderParts||[]).slice(0,-1)){ dir = await dir.getDirectoryHandle(p); }
    try{ const file = await dir.getFileHandle('folder.png').then(h=>h.getFile()); return URL.createObjectURL(file); }catch{}
    if (anyAlbum.imageUrl) return anyAlbum.imageUrl;
    const img = await awaitAlbumArtworkUrl(anyAlbum, 'image');
    return img||'';
  }catch{}
  return '';
}

function enterArtistsView(){
  state.libraryMode = 'artists';
  const detail = $('#libraryDetail'); if (detail) { detail.hidden = true; detail.innerHTML = ''; }
  const back = $('#libBackBtn'); if (back) back.hidden = true;
  // Sync toggle UI
  try{
    const tLib = document.getElementById('libToggleLibrary');
    const tPl = document.getElementById('libTogglePlaylists');
    const newBtn = document.getElementById('newPlaylistBtn');
    if (tLib && tPl){
      tLib.classList.add('active'); tLib.setAttribute('aria-selected','true');
      tPl.classList.remove('active'); tPl.setAttribute('aria-selected','false');
    }
    if (newBtn) newBtn.hidden = true;
  }catch{}
  if (state.libraryIndex) renderArtistsGrid(state.libraryIndex.view);
}

function renderArtistsGrid(index){
  const list = $('#libraryList'); if (!list) return; list.innerHTML = '';
  const q = ($('#searchInput').value||'').toLowerCase();
  const artists = computeArtistsView(index).filter(a=>{
    if (!q) return true;
    return a.name.toLowerCase().includes(q) || a.albums.some(al=> (al.album||'').toLowerCase().includes(q));
  });
  for (const a of artists){
    const card = document.createElement('article'); card.className='card artist-card'; card.tabIndex=0; card.setAttribute('role','button');
    const media = document.createElement('div'); media.className='card-media';
    const img = document.createElement('img'); img.alt = 'Artist profile'; media.appendChild(img);
    // async load profile
    awaitArtistProfileUrl(a).then(url=>{ if (url) img.src = url; });
    const body = document.createElement('div'); body.className='card-body';
    const title = document.createElement('div'); title.className='card-title'; title.textContent = a.name;
    const sub = document.createElement('div'); sub.className='card-sub'; sub.textContent = `${a.albums.length} album${a.albums.length!==1?'s':''}`;
    body.append(title, sub);
    card.append(media, body);
    card.addEventListener('click', (e)=> showArtistDetail(a, card));
    list.appendChild(card);
  }
}

function showBackButton(show){ const b=$('#libBackBtn'); if (!b) return; b.hidden = !show; }

function pushNav(stateObj){ (state.libraryNavStack||[]).push(stateObj); }
function popNav(){ return (state.libraryNavStack||[]).pop(); }

async function showArtistDetail(artist, fromEl){
  state._currentArtist = artist;
  pushNav({ mode: state.libraryMode, payload: artist });
  state.libraryMode = 'artistDetail';
  const list = $('#libraryList'); const detail = $('#libraryDetail'); if (!detail) return;
  if (list) list.innerHTML = '';
  detail.hidden = false; detail.innerHTML = '';
  showBackButton(true);
  // Build hero
  const hero = document.createElement('div'); hero.className = 'detail-hero artist-hero';
  const heroImg = document.createElement('img'); heroImg.alt = 'Artist'; hero.appendChild(heroImg);
  detail.appendChild(hero);
  awaitArtistProfileUrl(artist).then(url=>{ if (url) heroImg.src = url; });
  const title = document.createElement('div'); title.className='detail-title'; title.textContent = artist.name;
  detail.appendChild(title);
  // Albums grid
  const grid = document.createElement('div'); grid.className='detail-grid';
  detail.appendChild(grid);
  for (const album of artist.albums){
    const card = document.createElement('article'); card.className='card'; card.tabIndex=0; card.setAttribute('role','button');
    const media = document.createElement('div'); media.className='card-media';
    const img = document.createElement('img'); img.alt='Album cover'; media.appendChild(img);
    if (album.imageUrl) img.src = album.imageUrl; else awaitAlbumArtworkUrl(album,'image').then(url=>{ if (url) img.src = url; });
    const body = document.createElement('div'); body.className='card-body';
    const t = document.createElement('div'); t.className='card-title'; t.textContent = album.album;
    const s = document.createElement('div'); s.className='card-sub'; s.textContent = `${(album.tracks||[]).length} tracks`;
    body.append(t,s); card.append(media, body);
    card.addEventListener('click', ()=> showAlbumDetail(album, artist, card));
    grid.appendChild(card);
  }
  // Animations
  try{
    if (window.gsap){ gsap.fromTo(detail, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }); }
    if (fromEl && window.gsap){ requestAnimationFrame(()=> animateCardToHero(fromEl, hero, 'artist')); }
  }catch{}
}

async function showAlbumDetail(album, artist, fromEl){
  state._currentAlbum = album;
  pushNav({ mode: state.libraryMode, payload: album });
  state.libraryMode = 'albumDetail';
  const detail = $('#libraryDetail'); if (!detail) return;
  detail.hidden = false; detail.innerHTML = '';
  showBackButton(true);
  // Hero
  const hero = document.createElement('div'); hero.className='detail-hero album-hero';
  const vid = document.createElement('video'); vid.muted=true; vid.loop=true; vid.playsInline=true; vid.autoplay=true; vid.style.display='none';
  const img = document.createElement('img'); img.alt='Album cover'; img.style.display='none';
  hero.append(vid, img);
  detail.appendChild(hero);
  // Prefer animated video if available
  try{
    const vUrl = await awaitAlbumArtworkUrl(album, 'video');
    if (vUrl){ vid.src = vUrl; vid.style.display='block'; } else {
      const iUrl = album.imageUrl || await awaitAlbumArtworkUrl(album,'image');
      if (iUrl){ img.src = iUrl; img.style.display='block'; }
    }
  }catch{}
  const title = document.createElement('div'); title.className='detail-title'; title.textContent = album.album;
  const sub = document.createElement('div'); sub.className='detail-sub'; sub.textContent = artist? artist.name : (album.artist||'');
  detail.append(title, sub);
  // Track list in album order
  const ul = document.createElement('ul'); ul.className='track-list';
  const getNo = (t)=>{ const m = /^(\d{1,3})/.exec(t.filename||t.name||''); return m? parseInt(m[1],10): 999; };
  const tracks = [...(album.tracks||[])].map((t,i)=> ({t, i})).sort((a,b)=> getNo(a.t)-getNo(b.t));
  tracks.forEach(({t,i},order)=>{
    const li = document.createElement('li'); li.className='track-item'; li.textContent = `${i+1}. ${displayTrackName(t.name)}`;
    li.addEventListener('click', ()=>{
      state.queue = album.tracks.map((tt,idx)=> ({ album, index: idx }));
      state.queueIndex = i; updateQueuePanel(); loadTrackByQueueIndex(i);
    });
    ul.appendChild(li);
  });
  detail.appendChild(ul);
  try{
    if (window.gsap){ gsap.fromTo(detail, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }); }
    if (fromEl && window.gsap){ requestAnimationFrame(()=> animateCardToHero(fromEl, hero, 'album')); }
  }catch{}
}

function goBackLibrary(){
  const prev = popNav();
  if (!prev){ enterArtistsView(); return; }
  if (prev.mode === 'artistDetail'){ enterArtistsView(); return; }
  if (prev.mode === 'albumDetail'){ showArtistDetail(state._currentArtist || prev.payload); return; }
  enterArtistsView();
}

$('#libBackBtn')?.addEventListener('click', goBackLibrary);

// Render based on mode when searching
$('#searchInput').addEventListener('input', ()=>{
  if (!state.libraryIndex && state.libraryMode !== 'playlists') return;
  if (state.libraryMode === 'artists') return renderArtistsGrid(state.libraryIndex.view);
  if (state.libraryMode === 'albums') return renderLibrary(state.libraryIndex.view);
  if (state.libraryMode === 'artistDetail') return showArtistDetail(state._currentArtist);
  if (state.libraryMode === 'albumDetail') return showAlbumDetail(state._currentAlbum, state._currentArtist);
  if (state.libraryMode === 'playlists') return renderPlaylistsView();
});

// ------------------------------
// Playlists UI wiring
// ------------------------------
function renderPlaylistsView(){
  const list = document.getElementById('libraryList'); if (!list) return; list.innerHTML = '';
  const detail = document.getElementById('libraryDetail'); if (detail){ detail.hidden = true; detail.innerHTML=''; }
  const back = document.getElementById('libBackBtn'); if (back) back.hidden = true;
  const q = (document.getElementById('searchInput')?.value||'').toLowerCase();
  const items = (state.playlists||[]).filter(pl=> !q || (pl.name||'').toLowerCase().includes(q));
  if (!items.length){
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.cssText = 'opacity:0.8; text-align:center; padding:24px;';
    const msg = document.createElement('div'); msg.textContent = 'No playlists yet.'; msg.style.marginBottom = '8px';
    const hint = document.createElement('div'); hint.className='muted'; hint.textContent = 'Click New Playlist to create one.';
    const btn = document.createElement('button'); btn.className='btn'; btn.textContent='New Playlist'; btn.style.marginTop='10px';
    btn.addEventListener('click', ()=> document.getElementById('newPlaylistBtn')?.click());
    empty.append(msg, hint, btn);
    list.appendChild(empty);
    return;
  }
  // Basic list of playlists with actions
  for (const pl of items){
    const row = document.createElement('div');
    row.className = 'row';
    row.style.cssText = 'padding:10px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.12); margin:6px 0; background:rgba(255,255,255,0.04); display:flex; align-items:center; gap:8px';
    const info = document.createElement('div'); info.style.flex='1';
    const name = document.createElement('div'); name.textContent = pl.name || 'Untitled Playlist'; name.style.fontWeight='600';
    const sub = document.createElement('div'); sub.className='muted'; sub.textContent = `${(pl.tracks||[]).length} track${(pl.tracks||[]).length===1?'':'s'}`;
    info.append(name, sub);
    const actions = document.createElement('div'); actions.style.display='flex'; actions.style.gap='6px';
    const editBtn = document.createElement('button'); editBtn.className='icon-btn'; editBtn.title='Edit'; editBtn.setAttribute('aria-label','Edit playlist'); editBtn.textContent='✎';
    const delBtn = document.createElement('button'); delBtn.className='icon-btn'; delBtn.title='Delete'; delBtn.setAttribute('aria-label','Delete playlist'); delBtn.textContent='🗑';
    editBtn.addEventListener('click', (e)=>{ e.stopPropagation(); openPlaylistEditor(pl); });
    delBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const ok = confirm(`Delete playlist "${pl.name||'Untitled Playlist'}"?`);
      if (!ok) return;
      removePlaylist(pl.id);
      renderPlaylistsView();
    });
    actions.append(editBtn, delBtn);
    row.append(info, actions);
    list.appendChild(row);
  }
}

// Toggle buttons wiring
document.getElementById('libToggleLibrary')?.addEventListener('click', ()=>{
  const tLib = document.getElementById('libToggleLibrary');
  const tPl = document.getElementById('libTogglePlaylists');
  const newBtn = document.getElementById('newPlaylistBtn');
  tLib?.classList.add('active'); tLib?.setAttribute('aria-selected','true');
  tPl?.classList.remove('active'); tPl?.setAttribute('aria-selected','false');
  if (newBtn) newBtn.hidden = true;
  enterArtistsView();
});
document.getElementById('libTogglePlaylists')?.addEventListener('click', ()=>{
  const tLib = document.getElementById('libToggleLibrary');
  const tPl = document.getElementById('libTogglePlaylists');
  const newBtn = document.getElementById('newPlaylistBtn');
  state.libraryMode = 'playlists';
  tPl?.classList.add('active'); tPl?.setAttribute('aria-selected','true');
  tLib?.classList.remove('active'); tLib?.setAttribute('aria-selected','false');
  if (newBtn) newBtn.hidden = false;
  renderPlaylistsView();
});

// Playlist dialog wiring
let _plCoverObjectUrl = '';
let _editingPlaylistId = '';
function resetPlaylistDialog(){
  try{ if (_plCoverObjectUrl){ URL.revokeObjectURL(_plCoverObjectUrl); _plCoverObjectUrl=''; } }catch{}
  const v = document.getElementById('plCoverVideo');
  const img = document.getElementById('plCoverImage');
  const ph = document.getElementById('plCoverPlaceholder');
  if (v){ try{ v.pause(); }catch{} v.removeAttribute('src'); v.load?.(); v.style.display='none'; }
  if (img){ img.removeAttribute('src'); img.style.display='none'; }
  if (ph) ph.style.display='';
  const f = document.getElementById('plCoverFile'); if (f) f.value='';
  const name = document.getElementById('plName'); if (name) name.value='';
  const collabT = document.getElementById('plCollabToggle'); if (collabT) collabT.checked = false;
  const collabRow = document.getElementById('plCollabRow'); if (collabRow) collabRow.style.display='none';
  populateSongPicker();
  // Reset header/buttons for create mode by default
  const hdr = document.querySelector('#playlistDialog .modal-header h3'); if (hdr) hdr.textContent = 'Create Playlist';
  const done = document.getElementById('donePlaylistBtn'); if (done) done.textContent = 'Done';
}

function closePlaylistDialog(){
  const dlg = document.getElementById('playlistDialog');
  try{ if (_plCoverObjectUrl){ URL.revokeObjectURL(_plCoverObjectUrl); _plCoverObjectUrl=''; } }catch{}
  dlg?.close();
}

document.getElementById('newPlaylistBtn')?.addEventListener('click', ()=>{
  resetPlaylistDialog();
  _editingPlaylistId = '';
  document.getElementById('playlistDialog')?.showModal();
});
document.getElementById('closePlaylistDlgBtn')?.addEventListener('click', closePlaylistDialog);
document.getElementById('cancelPlaylistBtn')?.addEventListener('click', closePlaylistDialog);

document.getElementById('plCollabToggle')?.addEventListener('change', (e)=>{
  const row = document.getElementById('plCollabRow'); if (!row) return;
  const on = !!(e.currentTarget && e.currentTarget.checked);
  row.style.display = on ? 'flex' : 'none';
});

document.getElementById('plCoverFile')?.addEventListener('change', (e)=>{
  const v = document.getElementById('plCoverVideo');
  const img = document.getElementById('plCoverImage');
  const ph = document.getElementById('plCoverPlaceholder');
  const file = e.target?.files && e.target.files[0];
  if (!v || !img || !ph) return;
  // Reset previous
  try{ if (_plCoverObjectUrl){ URL.revokeObjectURL(_plCoverObjectUrl); _plCoverObjectUrl=''; } }catch{}
  if (!file){
    if (v){ try{ v.pause(); }catch{} v.removeAttribute('src'); v.load?.(); v.style.display='none'; }
    if (img){ img.removeAttribute('src'); img.style.display='none'; }
    ph.style.display='';
    return;
  }
  const url = URL.createObjectURL(file); _plCoverObjectUrl = url;
  const type = (file.type||'').toLowerCase();
  if (type.startsWith('video/')){
    img.style.display='none'; ph.style.display='none';
    v.style.display='block'; v.src=url; v.loop=true; v.muted=true; v.playsInline=true; v.play?.().catch(()=>{});
  } else if (type.startsWith('image/')){
    v.style.display='none'; try{ v.pause(); }catch{} v.removeAttribute('src'); v.load?.();
    ph.style.display='none'; img.style.display='block'; img.src=url;
  } else {
    // Unsupported -> fallback to placeholder
    try{ v.pause(); }catch{} v.removeAttribute('src'); v.load?.(); v.style.display='none';
    img.removeAttribute('src'); img.style.display='none'; ph.style.display='';
  }
});

function collectSelectedTracksFromPicker(){
  const picker = document.getElementById('plSongPicker'); if (!picker) return [];
  const rows = picker.querySelectorAll('.song-item[aria-selected="true"]');
  const out = [];
  rows.forEach(row=>{
    const albumKey = row.dataset.key || '';
    const trackIndex = parseInt(row.dataset.index||'-1', 10);
    if (albumKey && trackIndex>=0) out.push({ albumKey, trackIndex });
  });
  return out;
}

document.getElementById('donePlaylistBtn')?.addEventListener('click', ()=>{
  const nameEl = document.getElementById('plName');
  const collabEl = document.getElementById('plCollabToggle');
  const name = (nameEl?.value||'').trim() || 'Untitled Playlist';
  const collaborative = !!(collabEl?.checked);
  const tracks = collectSelectedTracksFromPicker();
  // Cover: keep local-only reference for now (not synced to Clerk)
  let cover = null;
  try{
    const fileInput = document.getElementById('plCoverFile');
    const f = fileInput?.files && fileInput.files[0];
    if (f){ cover = { name: f.name, type: f.type, size: f.size }; }
  }catch{}
  if (_editingPlaylistId){
    const patch = { name, collaborative, tracks };
    if (cover) patch.cover = cover; // only update cover if a new one was selected
    updatePlaylist(_editingPlaylistId, patch);
  } else {
    addPlaylist({ name, collaborative, tracks, cover });
  }
  _editingPlaylistId = '';
  closePlaylistDialog();
  if (state.libraryMode === 'playlists') renderPlaylistsView();
});

function populateSongPicker(){
  const picker = document.getElementById('plSongPicker'); if (!picker) return;
  picker.innerHTML='';
  const idx = state.libraryIndex?.view;
  if (!idx || !Array.isArray(idx.albums) || idx.albums.length===0){
    const msg = document.createElement('div'); msg.className='muted'; msg.style.padding='10px';
    msg.textContent = 'Load your library to pick songs.';
    picker.appendChild(msg); return;
  }
  // Flat list of tracks with album/artist labels; click to toggle selection
  for (const album of idx.albums){
    const artist = album.artist || '';
    for (let i=0; i<(album.tracks||[]).length; i++){
      const t = album.tracks[i];
      const row = document.createElement('div');
      row.className='song-item'; row.setAttribute('role','option'); row.setAttribute('aria-selected','false');
      row.dataset.key = album.key || '';
      row.dataset.index = String(i);
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06)';
      const label = document.createElement('div'); label.textContent = `${displayTrackName(t.name)} — ${artist} · ${album.album}`; label.style.flex='1'; label.style.minWidth='0';
      const sel = document.createElement('span'); sel.className='muted'; sel.textContent='Add';
      row.addEventListener('click', ()=>{
        const selected = row.getAttribute('aria-selected')==='true';
        row.setAttribute('aria-selected', String(!selected));
        sel.textContent = !selected ? 'Added' : 'Add';
      });
      row.append(label, sel);
      picker.appendChild(row);
    }
  }
}

async function awaitAlbumArtworkUrl(album, type){
  try{
    // Cache hit
    if (album.key && artworkCache.has(album.key)){
      const cached = artworkCache.get(album.key);
      if (cached.type === type && cached.url) return cached.url;
    }
    if (state.useStaticLibrary){
      // Construct URL from parts under static base
      const base = state.staticLibraryBaseUrl.replace(/\/$/, '');
      const encJoin = (parts)=> parts.map(encodeURIComponent).join('/');
      if (type==='video'){
        const parts = album.videoRelPath ? album.videoRelPath.split('/').filter(Boolean) : [...album.folderParts, 'square_animated_artwork.mp4'];
        const url = `${base}/${encJoin(parts)}`;
        if (album.key) artworkCache.set(album.key, { type:'video', url });
        return url;
      }
      // image
      const imgParts = album.coverRelPath ? album.coverRelPath.split('/').filter(Boolean) : [...album.folderParts, 'cover.png'];
      const url = `${base}/${encJoin(imgParts)}`;
      if (album.key) artworkCache.set(album.key, { type:'image', url });
      return url;
    }
    // Picker-based flow
    const root = await getRootHandleFromCache();
    if (!root) return '';
    let dir = root;
    for (const part of album.folderParts){
      dir = await dir.getDirectoryHandle(part);
    }
    // Prefer exact type first in the album root
    try{
      if (type==='video'){
        const file = await dir.getFileHandle('square_animated_artwork.mp4').then(h=>h.getFile());
        const url = URL.createObjectURL(file);
        if (album.key) artworkCache.set(album.key, { type:'video', url });
        return url;
      }
      if (type==='image'){
        const file = await dir.getFileHandle('cover.png').then(h=>h.getFile());
        const url = URL.createObjectURL(file);
        if (album.key) artworkCache.set(album.key, { type:'image', url });
        return url;
      }
    }catch{}
    // Otherwise search within subfolders for any known artwork
    const found = await findArtworkInDir(dir, 2);
    if (found){
      const file = await found.handle.getFile();
      const url = URL.createObjectURL(file);
      if (album.key) artworkCache.set(album.key, { type: found.type, url });
      return url;
    }
  }catch{}
  return '';
}

async function getRootHandleFromCache(){
  // During the session, we retain the directory handle in memory
  // Cross-session persistence would require IndexedDB and permissions persistence
  return state.rootHandle;
}

// Player engine
async function ensureAudioGraph(){
  if (!state.audioCtx){
    state.audioCtx = new (window.AudioContext||window.webkitAudioContext)({ latencyHint:'interactive', sampleRate: 48000 });
    // Load stereo player and atmos mixer processors
    await state.audioCtx.audioWorklet.addModule('./audio-worklet.js');
    try{ await state.audioCtx.audioWorklet.addModule('./atmos-worklet.js'); }
    catch(e){ console.warn('atmos worklet load failed:', e); }
    state.gainNode = state.audioCtx.createGain();
    state.gainNode.connect(state.audioCtx.destination);
  }
}

function createOrSwapPlayer(kind){
  if (!state.audioCtx) return;
  try{ state.workletNode?.disconnect(); }catch{}
  try{ state.workletNode && (state.workletNode.port.onmessage = null); }catch{}
  const name = (kind==='atmos')? 'atmos-mixer' : 'pcm-player';
  try{
    state.workletNode = new AudioWorkletNode(state.audioCtx, name);
  }catch(e){
    console.warn('Worklet node create failed for', name, '-> falling back to pcm-player:', e);
    state.workletNode = new AudioWorkletNode(state.audioCtx, 'pcm-player');
  }
  state.workletNode.connect(state.gainNode);
  state.workletKind = (name==='atmos-mixer')? 'atmos' : 'stereo';
  state.workletNode.port.onmessage = (e)=>{
    const d = e.data || {};
    if (d.type==='tick'){
      state.position = d.time;
      updateTimeUI();
      try{ onAutomixTick(); }catch{}
      return;
    }
    if (d.type==='levels'){
      updateMeters(d.levels, d.channels);
      return;
    }
    if (d.type==='automix_switched'){
      // Completed crossfade: we are now on next track already inside the worklet
      const am = state._automix||{};
      if (am.prepared && am.prepared.item){
        const { album, index } = am.prepared.item;
        // Advance queue index
        state.queueIndex = am.targetIndex|0;
        state.duration = Number(d.duration)||am.prepared.duration||0;
        // Update labels and media session to new track
        const track = album.tracks[index];
        const title = displayTrackName(track.name);
        state.currentTrackMeta = { title, artist: album.artist, album: album.album, ext: track.ext };
        try{ $('#trackTitle').textContent = title; $('#trackArtist').textContent = album.artist; }catch{}
        try{ updateMediaSession(track, album); }catch{}
        try{ updateQueuePanel(); }catch{}
        // Refresh artwork and Atmos UI (stereo path after automix)
        try{ updateArtwork(album); }catch{}
        try{ state.atmos = false; $('#atmosBtn').style.display = 'none'; renderMeters(0); }catch{}
      }
      // Reset automix state post-switch
      state._automix = { preparing:false, prepared:null, targetIndex:-1, active:false };
      return;
    }
  };
}

// ------------------------------
// DJ Automix helpers (beat-aware onset + crossfade)
// ------------------------------
function estimateOnsetFrame(pcm, channels, sampleRate){
  try{
    const totalFrames = Math.floor((pcm.length||0)/Math.max(1,channels));
    const maxFrames = Math.min(totalFrames, Math.floor(sampleRate*20));
    const hop = 1024; const win = 2048;
    let prevEnergy = 0; let baseline = 1e-6; let count = 0;
    const startFrame = Math.floor(sampleRate*0.15); // skip first 150ms
    // Build baseline over first second
    const baseEnd = Math.min(maxFrames, Math.floor(sampleRate*1.0));
    for (let f=startFrame; f+win<baseEnd; f+=hop){
      let e=0; const i0=f*channels; const i1=(f+win)*channels;
      for (let i=i0;i<i1;i+=channels){ const L=pcm[i]||0; const R=channels>1?(pcm[i+1]||0):L; e += L*L + R*R; }
      baseline += e; count++;
    }
    baseline = (baseline/(count||1))||1e-6;
    // Find first significant rise
    for (let f=startFrame; f+win<maxFrames; f+=hop){
      let e=0; const i0=f*channels; const i1=(f+win)*channels;
      for (let i=i0;i<i1;i+=channels){ const L=pcm[i]||0; const R=channels>1?(pcm[i+1]||0):L; e += L*L + R*R; }
      const rise = e - prevEnergy;
      const cond = (e > baseline*1.8) && (rise > baseline*0.35);
      if (cond){ return f; }
      prevEnergy = e;
    }
    return Math.floor(sampleRate*0.5); // fallback 0.5s in
  }catch{ return 0; }
}

function computeNextIndexForAutomix(){
  if (!Array.isArray(state.queue) || state.queue.length===0) return -1;
  if (state.repeat==='one') return state.queueIndex; // will mix into same track (not ideal)
  if (state.shuffle){ return Math.floor(Math.random()*state.queue.length); }
  const next = state.queueIndex+1;
  if (next>=state.queue.length){ return (state.repeat==='all')? 0 : -1; }
  return next;
}

async function prepareNextForAutomix(){
  if (state._automix.preparing || state._automix.prepared) return;
  const idx = computeNextIndexForAutomix();
  if (idx<0) return;
  const item = state.queue[idx]; if (!item) return;
  const { album, index } = item; const track = album.tracks[index];
  try{
    state._automix.preparing = true;
    const file = await getFileFromAlbum(track);
    const { pcm, sampleRate, channels, duration } = await decodeToPcm(file, track.ext);
    // Only support stereo path for now (workletKind must be 'stereo')
    if (state.workletKind !== 'stereo') { state._automix.preparing = false; return; }
    // Estimate onset in first seconds
    const onsetFrame = estimateOnsetFrame(pcm, channels, sampleRate);
    // Send buffer to worklet as B, start at onsetFrame
    try{ state.workletNode?.port.postMessage({ type:'prepareB', pcm, channels, startFrame: onsetFrame }); }catch{}
    state._automix = { preparing:false, prepared:{ pcm, channels, sampleRate, duration, onsetFrame, item }, targetIndex: idx, active:false };
  }catch(e){ console.warn('[automix] prepare failed:', e); state._automix = { preparing:false, prepared:null, targetIndex:-1, active:false }; }
}

function startAutomixIfReady(){
  const am = state._automix||{};
  if (!am.prepared || am.active) return;
  const dur = Math.max(0.5, Number(state.crossfadeSec||6));
  try{ state.workletNode?.port.postMessage({ type:'startCrossfade', durationSec: dur }); }catch{}
  state._automix.active = true;
}

function onAutomixTick(){
  if (!state.djAutomixEnabled) return;
  if (state.playbackMode !== 'pcm') return;
  if (state.workletKind !== 'stereo') return; // atmos mixer not supported yet
  const remaining = Math.max(0, (state.duration||0) - (state.position||0));
  // Prepare slightly before crossfade start
  const lead = Math.max(1.0, Math.min(8.0, (state.crossfadeSec||6) + 2));
  if (!state._automix.prepared && remaining <= lead){ prepareNextForAutomix(); }
  // Start crossfade exactly crossfadeSec from end
  if (state._automix.prepared && !state._automix.active && remaining <= (state.crossfadeSec||6)){
    startAutomixIfReady();
  }
}

function updateTimeUI(){
  $('#currentTime').textContent = formatTime(state.position);
  $('#duration').textContent = formatTime(state.duration);
  const p = state.duration? state.position/state.duration : 0;
  $('#seekBar').value = String(Math.max(0, Math.min(1, p)));
}

// ------- Per-channel meters (Web Atmos) -------
function channelLabels(count){
  const ly = state.atmosLayout || {};
  const lfe = !!ly.lfeon;
  const labels = [];
  if (count <= 2) return labels;
  // Base AC-3 order assumption: L, C, R, Ls, Rs, (LFE)
  labels.push('L');
  if (count >= 2) labels.push('C');
  if (count >= 3) labels.push('R');
  if (count >= 4) labels.push('Ls');
  if (count >= 5) labels.push('Rs');
  if (count >= 6) labels.push(lfe ? 'LFE' : 'S6');
  // Extras as heights/wides generically
  for (let i = labels.length; i < count; i++) labels.push('Ht' + (i - labels.length + 1));
  return labels.slice(0, count);
}

function renderMeters(count){
  const wrap = document.getElementById('meters');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!count || count<=2){ wrap.style.opacity='0.5'; return; }
  wrap.style.opacity='1';
  const labels = channelLabels(count);
  for (let i=0;i<count;i++){
    const cell = document.createElement('div'); cell.className = 'meter';
    const bar = document.createElement('div'); bar.className = 'meter-bar'; bar.style.height = '0%'; bar.dataset.idx = String(i);
    const lab = document.createElement('div'); lab.className = 'meter-label'; lab.textContent = labels[i] || `Ch${i+1}`;
    cell.appendChild(bar); cell.appendChild(lab); wrap.appendChild(cell);
  }
}

function updateMeters(levels, ch){
  try{
    const wrap = document.getElementById('meters'); if (!wrap) return;
    const bars = wrap.querySelectorAll('.meter-bar'); if (!bars || bars.length===0) return;
    const n = Math.min(bars.length, (ch||bars.length));
    for (let i=0;i<n;i++){
      const lv = Math.max(0, Math.min(1, levels[i]||0));
      // Map RMS to dBFS -> height (0..100). -60dB -> 0%, 0dB -> 100%
      const db = 20*Math.log10(lv||1e-6);
      const pct = Math.max(0, Math.min(100, (db+60)*(100/60)));
      const el = bars[i];
      el.style.height = pct.toFixed(1)+'%';
      // Colorize: green < -18dB, yellow < -6dB, red otherwise
      let bg;
      if (db > -6) bg = 'linear-gradient(180deg, rgba(231,76,60,0.95), rgba(192,57,43,0.95))';
      else if (db > -18) bg = 'linear-gradient(180deg, rgba(241,196,15,0.95), rgba(243,156,18,0.95))';
      else bg = 'linear-gradient(180deg, rgba(46,204,113,0.95), rgba(39,174,96,0.95))';
      el.style.background = bg;
      // Tooltip
      try{
        const name = el.parentElement?.querySelector('.meter-label')?.textContent || `Ch${i+1}`;
        el.title = `${name}: ${db.toFixed(1)} dBFS`;
      }catch{}
    }
  }catch{}
}

// Update playback mode badge ('Native' | 'PCM')
function updateModeBadge(){
  const el = document.getElementById('modeBadge');
  if (!el) return;
  const mode = state.playbackMode === 'native' ? 'Native' : 'PCM';
  el.textContent = mode;
  try{ el.setAttribute('aria-label', 'Playback mode: ' + mode); }catch{}
  try{ el.title = 'Playback mode: ' + mode; }catch{}
}

// Ensure the badge shows an initial value
try{
  if (document.readyState !== 'loading') updateModeBadge();
  else window.addEventListener('DOMContentLoaded', ()=> updateModeBadge(), { once:true });
}catch{}

function formatTime(sec){
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec/60); const s = Math.floor(sec%60); return `${m}:${s.toString().padStart(2,'0')}`;
}

// --- Native EC-3 HTMLMediaElement management ---
function teardownNative(){
  try{
    if (state.nativeEl){
      try{ state.nativeEl.pause(); }catch{}
      try{ state.nativeEl.removeAttribute('src'); state.nativeEl.load(); }catch{}
      try{ state.nativeEl.remove(); }catch{}
    }
  }catch{}
  try{ if (state.nativeUrl){ URL.revokeObjectURL(state.nativeUrl); } }catch{}
  state.nativeEl = null; state.nativeUrl = '';
}

function ensureNativeEl(){
  if (state.nativeEl) return state.nativeEl;
  const a = document.createElement('audio');
  a.hidden = true; a.preload = 'metadata'; a.playsInline = true;
  // initialize volume from UI slider if present
  try{
    const vb = document.getElementById('volumeBar');
    if (vb) a.volume = parseFloat(vb.value||'1') || 1;
  }catch{}
  a.addEventListener('timeupdate', ()=>{
    state.position = a.currentTime||0; updateTimeUI();
  });
  a.addEventListener('loadedmetadata', ()=>{
    state.duration = isFinite(a.duration)? a.duration : 0; updateTimeUI();
  });
  a.addEventListener('ended', ()=>{
    if (state.repeat==='one'){
      a.currentTime = 0; a.play().catch(()=>{}); return;
    }
    if (state.shuffle){ const i = Math.floor(Math.random()*state.queue.length); loadTrackByQueueIndex(i); return; }
    const next = state.queueIndex+1;
    if (next>=state.queue.length){
      if (state.repeat==='all') return loadTrackByQueueIndex(0);
      pause(); return;
    }
    loadTrackByQueueIndex(next);
  });
  a.addEventListener('play', ()=>{ state.isPlaying = true; try{ $('#playPauseBtn .icon-play').className = 'icon-pause'; }catch{} });
  a.addEventListener('pause', ()=>{ state.isPlaying = false; try{ $('#playPauseBtn .icon-pause').className = 'icon-play'; }catch{} });
  document.body.appendChild(a);
  state.nativeEl = a;
  return a;
}

async function loadTrackByQueueIndex(i){
  // Reset any pending automix prep when explicitly loading a track
  state._automix = { preparing:false, prepared:null, targetIndex:-1, active:false };
  state.queueIndex = i;
  const item = state.queue[i]; if (!item) return;
  const { album, index } = item;
  const track = album.tracks[index];
  const title = displayTrackName(track.name);
  state.currentTrackMeta = { title, artist: album.artist, album: album.album, ext: track.ext };
  $('#trackTitle').textContent = title;
  $('#trackArtist').textContent = album.artist;

  // Artwork
  try{
    console.debug('[Artwork] album.coverType=%s videoRelPath=%s coverRelPath=%s folderParts=%o', album.coverType, album.videoRelPath, album.coverRelPath, album.folderParts);
  }catch{}
  await updateArtwork(album);

  // Media Session (cover.png only)
  await updateMediaSession(track, album);

  // Dolby Atmos detection via file extension only (ffmpeg.wasm-only build)
  state.atmos = ['ac4','ec3'].includes(track.ext);

  $('#atmosBtn').style.display = state.atmos? 'grid' : 'none';

  // Select playback path
  const isEc3 = /^(ec3|ac3)$/i.test(track.ext||'');
  const file = await getFileFromAlbum(track);
  if (isEc3){
    // Native path only when Safari reports EC-3 support; otherwise fall through to PCM (ffmpeg)
    const canNative = await hasEac3Decoder().catch(()=>false);
    if (canNative){
      // ensure PCM engine is paused if active
      try{ state.workletNode?.port.postMessage({ type:'pause' }); }catch{}
      teardownNative();
      const a = ensureNativeEl();
      const url = URL.createObjectURL(file);
      state.nativeUrl = url; state.playbackMode = 'native'; updateModeBadge();
      state.position = 0; state.duration = 0; updateTimeUI();
      a.src = url;
      try{ await a.play(); }catch(e){ console.warn('Native play failed:', e); }
      return;
    }
  }

  // PCM path
  teardownNative();
  await ensureAudioGraph();
  let pcm, sampleRate, channels, duration, ec3Info, sourceChannels;
  try{
    ({ pcm, sampleRate, channels, duration, ec3Info, sourceChannels } = await decodeToPcm(file, track.ext));
  }catch(e){
    console.error('Decode failed for ext', track.ext, e);
    const ext = (track.ext || 'unknown').toUpperCase();
    alert(`Decoding failed (${ext}). ${e?.message || 'Unsupported codec or file.'}`);
    return;
  }
  state.duration = duration; state.playbackMode = 'pcm'; updateModeBadge();
  const needsAtmos = (channels||0) > 2;
  createOrSwapPlayer(needsAtmos ? 'atmos' : 'stereo');
  const layout = ec3Info ? { acmod: ec3Info.acmod|0, lfeon: !!ec3Info.lfeon, channels: channels } : { channels };
  state.atmosLayout = layout;
  try{
    const lo = $('#layoutOut');
    if (lo){
      const ch = layout.channels||2;
      const ac = (layout.acmod!=null)? ` (acmod ${layout.acmod}${layout.lfeon?'+lfe':''})` : '';
      lo.textContent = `Layout: ${ch}ch${ac}`;
    }
    const vt = $('#virtualizeToggle'); if (vt) vt.disabled = !needsAtmos;
    // Render meters based on channel count
    try{ renderMeters(needsAtmos ? channels : 0); }catch{}
  }catch{}
  const msg = needsAtmos
    ? { type:'load', pcm, sampleRate, channels, layout, virtualization: !!state.virtualizationEnabled }
    : { type:'load', pcm, sampleRate, channels };
  state.workletNode.port.postMessage(msg);
  play();
}

async function getFileFromAlbum(track){
  if (state.useStaticLibrary){
    const base = state.staticLibraryBaseUrl.replace(/\/$/, '');
    const encJoin = (parts)=> parts.map(encodeURIComponent).join('/');
    const url = `${base}/${encJoin(track.pathParts)}`;
    const res = await fetch(url, { cache:'no-cache' });
    const blob = await res.blob();
    // Provide a File-like object (decoder expects File/Blob)
    return new File([blob], track.filename, { type: blob.type||'application/octet-stream' });
  }
  // Picker-based flow
  let root = await getRootHandleFromCache();
  if (!root) {
    root = await window.showDirectoryPicker({ id:'apple-folders' });
    state.rootHandle = root;
  }
  let dir = root;
  for (let i=0;i<track.pathParts.length-1;i++){
    dir = await dir.getDirectoryHandle(track.pathParts[i]);
  }
  const fh = await dir.getFileHandle(track.pathParts[track.pathParts.length-1]);
  return fh.getFile();
}

async function updateArtwork(album){
  const v = $('#artworkVideo'); const img = $('#artworkImage');
  // Reset current media state
  try{ v.pause(); }catch{}
  try{ v.removeAttribute('src'); v.load(); }catch{}
  try{ img.removeAttribute('src'); }catch{}
  v.style.display='none'; img.style.display='none';

  if (album.coverType==='video'){
    let url = '';
    try{ url = await awaitAlbumArtworkUrl(album, 'video'); }catch{}
    if (url){
      try{
        // Ensure autoplay-friendly flags
        v.muted = true; v.loop = true; v.playsInline = true;
        // Instrument basic debug once
        try{
          v.addEventListener('error', ()=>{
            const err = (v.error? (v.error.message||v.error.code): 'unknown');
            console.warn('[ArtworkVideo] error', err);
          }, { once:true });
          v.addEventListener('loadedmetadata', ()=>{
            console.debug('[ArtworkVideo] loadedmetadata', { w:v.videoWidth, h:v.videoHeight, rs:v.readyState });
          }, { once:true });
          v.addEventListener('canplay', ()=>{
            console.debug('[ArtworkVideo] canplay', { rs:v.readyState });
          }, { once:true });
          v.addEventListener('playing', ()=>{
            console.debug('[ArtworkVideo] playing');
          }, { once:true });
        }catch{}

        v.src = url;
        v.load();
        v.currentTime = 0;

        // Wait for first frame or timeout
        await Promise.race([
          new Promise((res)=> v.addEventListener('loadeddata', res, { once:true })),
          new Promise((res)=> setTimeout(res, 1500))
        ]);

        v.style.display = 'block';
        await v.play();
        // If dimensions are zero after play, treat as failure
        if (!v.videoWidth || !v.videoHeight){ throw new Error('Video has no dimensions (codec unsupported?)'); }
        return;
      }catch(e){
        console.warn('Animated artwork failed, falling back to image:', e);
      }
    }
    // Fallback to image if video missing or fails
    try{
      const imgUrl = await awaitAlbumArtworkUrl(album, 'image');
      if (imgUrl){ img.src = imgUrl; img.style.display='block'; return; }
    }catch{}
  } else if (album.coverType==='image'){
    try{
      const imgUrl = await awaitAlbumArtworkUrl(album, 'image');
      if (imgUrl){ img.src = imgUrl; img.style.display='block'; return; }
    }catch{}
  }
  // Final fallback: hide both if nothing found
}

function play(){
  if (state.playbackMode === 'native' && state.nativeEl){
    state.nativeEl.play().catch(()=>{});
    return;
  }
  if (!state.audioCtx) return; state.audioCtx.resume();
  state.workletNode?.port.postMessage({ type:'play' });
  state.isPlaying = true;
  $('#playPauseBtn .icon-play').className = 'icon-pause';
}
function pause(){
  if (state.playbackMode === 'native' && state.nativeEl){
    try{ state.nativeEl.pause(); }catch{}
    state.isPlaying = false;
    $('#playPauseBtn .icon-pause').className = 'icon-play';
    return;
  }
  if (!state.audioCtx) return;
  state.workletNode?.port.postMessage({ type:'pause' });
  state.isPlaying = false;
  $('#playPauseBtn .icon-pause').className = 'icon-play';
}

$('#playPauseBtn').addEventListener('click', ()=> state.isPlaying? pause(): play());
$('#prevBtn').addEventListener('click', ()=>{
  if (state.queue.length===0) return;
  const i = (state.queueIndex-1+state.queue.length)%state.queue.length; loadTrackByQueueIndex(i);
});
$('#nextBtn').addEventListener('click', ()=>{
  if (state.queue.length===0) return; nextTrack();
});
$('#shuffleBtn').addEventListener('click', (e)=>{
  state.shuffle = !state.shuffle; e.currentTarget.setAttribute('aria-pressed', String(state.shuffle));
});
$('#repeatBtn').addEventListener('click', (e)=>{
  state.repeat = state.repeat==='off'? 'all': state.repeat==='all'? 'one':'off';
  e.currentTarget.setAttribute('aria-pressed', String(state.repeat!=='off'));
});
$('#queueBtn').addEventListener('click', ()=>{
  const q = $('#queuePanel'); const exp = q.getAttribute('aria-expanded')==='true'; q.setAttribute('aria-expanded', String(!exp));
});
$('#seekBar').addEventListener('input', (e)=>{
  const p = parseFloat(e.target.value||'0');
  const t = p * (state.duration||0);
  seekTo(t);
});
$('#volumeBar').addEventListener('input', (e)=>{
  const v = parseFloat(e.target.value||'1');
  if (state.playbackMode === 'native' && state.nativeEl){
    try{ state.nativeEl.volume = v; }catch{}
  } else {
    state.gainNode && (state.gainNode.gain.value = v);
  }
});

async function nextTrack(){
  // If DJ Automix is enabled on PCM stereo, trigger immediate crossfade
  if (state.djAutomixEnabled && state.playbackMode==='pcm' && state.workletKind==='stereo'){
    try{
      if (!state._automix.prepared){ await prepareNextForAutomix(); }
      if (state._automix.prepared){ startAutomixIfReady(); return; }
      // else fall through to normal next if not prepared
    }catch{}
  }
  if (state.repeat==='one') return loadTrackByQueueIndex(state.queueIndex);
  if (state.shuffle){
    const i = Math.floor(Math.random()*state.queue.length);
    return loadTrackByQueueIndex(i);
  }
  const next = state.queueIndex+1;
  if (next>=state.queue.length){
    if (state.repeat==='all') return loadTrackByQueueIndex(0);
    return pause();
  }
  loadTrackByQueueIndex(next);
}

function updateQueuePanel(){
  const q = $('#queuePanel'); q.innerHTML='';
  state.queue.forEach((item, i)=>{
    const div = document.createElement('div'); div.className='queue-item'; div.setAttribute('role','option'); div.setAttribute('aria-selected', String(i===state.queueIndex));
    div.textContent = (i+1)+'. '+displayTrackName(item.album.tracks[item.index].name);
    div.addEventListener('click', ()=> loadTrackByQueueIndex(i));
    q.appendChild(div);
  });
}

// Atmos button shake + dialog
$('#atmosBtn').addEventListener('click', ()=>{
  const btn = $('#atmosBtn');
  btn.style.animation='shake 500ms';
  setTimeout(()=>{ btn.style.animation='none'; $('#atmosDialog').showModal(); }, 500);
});
$('#closeAtmosDialogBtn').addEventListener('click', ()=> $('#atmosDialog').close());

// Keyboard accessibility
window.addEventListener('keydown', (e)=>{
  if (e.key===' '){ e.preventDefault(); state.isPlaying? pause(): play(); }
  if (e.key==='ArrowRight'){
    if (state.playbackMode === 'native' && state.nativeEl){ state.nativeEl.currentTime = Math.min((state.nativeEl.currentTime||0)+5, state.duration||1e9); }
    else { state.workletNode?.port.postMessage({ type:'nudge', delta: 5 }); }
  }
  if (e.key==='ArrowLeft'){
    if (state.playbackMode === 'native' && state.nativeEl){ state.nativeEl.currentTime = Math.max((state.nativeEl.currentTime||0)-5, 0); }
    else { state.workletNode?.port.postMessage({ type:'nudge', delta: -5 }); }
  }
});

// Media Session
if ('mediaSession' in navigator){
  navigator.mediaSession.setActionHandler('play', ()=> play());
  navigator.mediaSession.setActionHandler('pause', ()=> pause());
  navigator.mediaSession.setActionHandler('previoustrack', ()=> $('#prevBtn').click());
  navigator.mediaSession.setActionHandler('nexttrack', ()=> $('#nextBtn').click());
}

// Init
(function init(){
  // Do not block UI on decoder init
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=> { runWelcomeAnimation(); }, { once:true });
  } else {
    // DOM already ready
    runWelcomeAnimation();
  }
  // Extra safety: also try on window load in case of timing issues
  window.addEventListener('load', ()=> setTimeout(()=>{ try{ runWelcomeAnimation(); }catch(e){ console.debug('[welcome] load fallback error', e); } }, 50), { once:true });
  (async()=>{
    try { await initDecoder(); }
    catch(e){ console.warn('Decoder init failed:', e); }
  })();
  bindCtrlG();
  
  // Add hover detection for popup image
  const hoverDetectionArea = document.getElementById('hoverDetectionArea');
  const popupImageContainer = document.getElementById('popupImageContainer');
  const popupImage = document.getElementById('popupImage');
  
  if (hoverDetectionArea && popupImageContainer && popupImage) {
    hoverDetectionArea.addEventListener('mouseenter', () => {
      popupImageContainer.classList.add('show');
    });
    
    hoverDetectionArea.addEventListener('mouseleave', () => {
      popupImageContainer.classList.remove('show');
    });
    
    popupImage.addEventListener('click', () => {
      window.open('https://guns.lol/starlight13418', '_blank');
    });
  }
})();

function bindCtrlG(){
  window.addEventListener('keydown', async (e)=>{
    if (!e.ctrlKey) return;
    if (e.key==='g' || e.key==='G'){
      e.preventDefault();
      try{
        devourChooseBtnAnimation();
        await loadFromFolderJson();
        enterArtistsView();
      }
      catch(err){ console.warn('Load from JSON failed:', err); }
    }
  });
}

async function loadFromFolderJson(){
  // First, try static bundled JSON (no picker)
  try{
    const base = state.staticLibraryBaseUrl.replace(/\/$/, '');
    const candidates = [
      `${base}/applemapping.json`,
      `${base}/musaudiomap.json`
    ];
    for (const url of candidates){
      try{
        const res = await fetch(url, { cache:'no-cache' });
        if (!res.ok) continue;
        const mapping = await res.json();
        console.debug('[library] loaded static mapping from', url);
        state.useStaticLibrary = true;
        const serialized = mappingToSerializedIndex(mapping);
        state.libraryIndex = { serialized, view: serialized };
        enterArtistsView();
        return;
      }catch{}
    }
  }catch(err){ /* ignore and fall back */ }

  // Try to load mapping from cookies first
  try {
    const cookies = document.cookie.split('; ');
    for (const cookie of cookies) {
      const [name, value] = cookie.split('=');
      if (name === 'libraryMapping') {
        const mapping = JSON.parse(decodeURIComponent(value));
        const serialized = mappingToSerializedIndex(mapping);
        state.libraryIndex = { serialized, view: serialized };
        enterArtistsView();
        return;
      }
    }
  } catch (e) {
    console.warn('Could not load mapping from cookies:', e);
  }

  // Fallback: File System Access flow (picker)
  if (!state.rootHandle){
    try{ state.rootHandle = await window.showDirectoryPicker({ id:'apple-folders' }); }
    catch{ return; }
  }
  
  // Build comprehensive mapping in memory only - never write to disk
  const mapping = await buildMusAudioMapJSON(state.rootHandle);
  
  // Store mapping in temporary cache
  state.libraryCache = mapping;
  
  // Convert mapping -> internal serialized index
  const serialized = mappingToSerializedIndex(mapping);
  state.libraryIndex = { serialized, view: serialized };
  
  // Store in cookies for persistence across sessions
  try {
    document.cookie = `libraryMapping=${JSON.stringify(mapping)}; max-age=3600; path=/`;
  } catch (e) {
    console.warn('Could not store mapping in cookies:', e);
  }
  
  enterArtistsView();
}

function mappingToSerializedIndex(mapping){
  // mapping.audio: [{ artist, album, audioPathParts, coverPngPathParts|null, animatedArtworkPathParts|null }]
  const albumsMap = new Map();
  for (const item of (mapping?.audio||[])){
    const parts = item.audioPathParts||[];
    const meta = inferMetaFromPath(parts);
    const key = meta.artist+'::'+meta.album;
    if (!albumsMap.has(key)){
      const folderParts = (()=>{
        const folder = parts.slice(0, -1);
        const last = folder[folder.length-1];
        if (last && /^(disc|cd)\s*\d+/i.test(last)) return folder.slice(0, -1);
        return folder;
      })();
      albumsMap.set(key, {
        artist: meta.artist,
        album: meta.album,
        folderParts,
        key,
        coverType: 'none',
        coverRelPath: '',
        coverIsPng: false,
        videoRelPath: '',
        tracks: []
      });
    }
    const album = albumsMap.get(key);
    album.tracks.push({
      name: item.name || meta.track || 'Unknown',
      filename: parts[parts.length-1] || '',
      ext: parts.length>0 ? parts[parts.length-1].split('.').pop() : '',
      pathParts: parts
    });
    // Detect cover png path
    const coverPath = item.coverPngPathParts ? item.coverPngPathParts.join('/') : '';
    const animPath = item.animatedArtworkPathParts ? item.animatedArtworkPathParts.join('/') : '';
    // Prefer animated artwork when present; always remember its relative path
    if (animPath){
      album.videoRelPath = animPath;
      if (album.coverType === 'none') album.coverType = 'video';
    }
    if (coverPath){ album.coverRelPath = coverPath; if (album.coverType==='none'){ album.coverType='image'; album.coverIsPng = true; } }
    // If folderParts not set, derive from whichever path exists
    if ((!album.folderParts || album.folderParts.length===0)){
      const pathStr = coverPath || animPath || '';
      const parts = pathStr ? pathStr.split('/').filter(Boolean) : [];
      if (parts.length>1) album.folderParts = parts.slice(0,-1);
    }
  }
  // Overlay album-level JSON (string paths): mapping.albums entries can provide direct cover/video paths
  if (Array.isArray(mapping?.albums)){
    for (const a of mapping.albums){
      const key = (a.artist||'')+'::'+(a.album||'');
      if (!key.includes('::')) continue;
      if (!albumsMap.has(key)){
        // Derive folderParts from provided string paths (prefer cover)
        const coverPath = a.coverPngPath || (Array.isArray(a.coverPngPathParts)? a.coverPngPathParts.join('/') : '');
        const animPath = a.animatedArtworkPath || (Array.isArray(a.animatedArtworkPathParts)? a.animatedArtworkPathParts.join('/') : '');
        const pathStr = coverPath || animPath || '';
        const parts = pathStr ? pathStr.split('/').filter(Boolean) : [];
        const folderParts = parts.length>1 ? parts.slice(0,-1) : [];
        albumsMap.set(key, { artist:a.artist||'', album:a.album||'', key, folderParts, tracks: [], coverType:'none', coverIsPng:false, coverRelPath:'', videoRelPath:'' });
      }
      const album = albumsMap.get(key);
      const coverPath = a.coverPngPath || (Array.isArray(a.coverPngPathParts)? a.coverPngPathParts.join('/') : '');
      const animPath = a.animatedArtworkPath || (Array.isArray(a.animatedArtworkPathParts)? a.animatedArtworkPathParts.join('/') : '');
      if (animPath){ album.videoRelPath = animPath; album.coverType = 'video'; }
      if (coverPath){ album.coverRelPath = coverPath; if (album.coverType==='none'){ album.coverType='image'; album.coverIsPng = true; } }
      // If folderParts not set, derive from whichever path exists
      if ((!album.folderParts || album.folderParts.length===0)){
        const pathStr = coverPath || animPath || '';
        const parts = pathStr ? pathStr.split('/').filter(Boolean) : [];
        if (parts.length>1) album.folderParts = parts.slice(0,-1);
      }
    }
  }
  const albums = [...albumsMap.values()].sort((a,b)=> a.album.localeCompare(b.album));
  return { albums };
}

// Analyze the selected folder and build a comprehensive map for musaudiomap.json
async function buildMusAudioMapJSON(root){
  const artistsMap = new Map(); // artist -> { name, folderPngPathParts|null }
  const albumsMap = new Map();  // key -> { artist, album, coverPngPathParts|null, animatedArtworkPathParts|null }
  const files = [];

  async function walk(dir, parts=[]){
    for await (const [name, handle] of dir.entries()){
      const cur = [...parts, name];
      if (handle.kind === 'directory'){
        await walk(handle, cur);
      } else {
        const lower = name.toLowerCase();
        const ext = lower.split('.').pop();
        const isAudio = ['m4a','ac4','ec3','wma','dts','mp3','flac','wav'].includes(ext);
        const isImage = name.toLowerCase()==='cover.png';
        const isVideo = name.toLowerCase()==='square_animated_artwork.mp4';
        if (!(isAudio||isImage||isVideo)) continue;

        // artist/album/track.ext or artist/album/Disc 1/track.ext
        const { artist, album } = inferMetaFromPath(cur);
        const albumFolderParts = (()=>{
          // remove filename
          const folder = parts;
          const last = folder[folder.length-1];
          if (last && /^(disc|cd)\s*\d+/i.test(last)) return folder.slice(0, -1);
          return folder;
        })();
        const artistFolderParts = albumFolderParts.slice(0, -1);

        // Track file list with artist name
        files.push({ pathParts: cur, type: isAudio? 'audio' : (isImage? 'cover' : 'video'), artist });

        // Artists
        if (!artistsMap.has(artist)){
          artistsMap.set(artist, { name: artist, folderPngPathParts: null });
          // try to locate folder.png once
          try{
            let dirA = root; for (const p of artistFolderParts){ dirA = await dirA.getDirectoryHandle(p); }
            const fh = await dirA.getFileHandle('folder.png');
            const file = await fh.getFile();
            artistsMap.get(artist).folderPngPathParts = [...artistFolderParts, 'folder.png'];
          }catch{}
        }

        // Albums
        const key = artist+'::'+album;
        if (!albumsMap.has(key)) albumsMap.set(key, { artist, album, coverPngPathParts: null, animatedArtworkPathParts: null });
        if (isImage && !albumsMap.get(key).coverPngPathParts){
          try{ let d=root; for (const p of albumFolderParts){ d=await d.getDirectoryHandle(p); } const f=await d.getFileHandle('cover.png').then(h=>h.getFile()); albumsMap.get(key).coverPngPathParts = [...albumFolderParts, 'cover.png'];}catch{}
        }
        if (isVideo && !albumsMap.get(key).animatedArtworkPathParts){
          try{ let d=root; for (const p of albumFolderParts){ d=await d.getDirectoryHandle(p); } const f=await d.getFileHandle('square_animated_artwork.mp4').then(h=>h.getFile()); albumsMap.get(key).animatedArtworkPathParts = [...albumFolderParts, 'square_animated_artwork.mp4'];}catch{}
        }
      }
    }
  }
  await walk(root, []);

  const artists = [...artistsMap.values()].sort((a,b)=> a.name.localeCompare(b.name));
  const albums = [...albumsMap.values()].sort((a,b)=> a.album.localeCompare(b.album));
  return { generatedAt: new Date().toISOString(), artists, albums, files };
}

async function promptSaveIndex(data){
  try{
    if ('showSaveFilePicker' in window){
      const h = await window.showSaveFilePicker({ suggestedName: 'musaudio-index.json', types:[{ description:'JSON', accept: { 'application/json':['.json'] } }] });
      const w = await h.createWritable();
      await w.write(new Blob([JSON.stringify(data, null, 2)], { type:'application/json' }));
      await w.close();
      return;
    }
  }catch{}
  // Fallback: download
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download='musaudio-index.json'; a.click();
  setTimeout(()=> URL.revokeObjectURL(url), 5000);
}

// Build a compact audio mapping JSON:
// For every audio file, include artist (from artist folder) and animated artwork path if it exists in the album root
async function buildAudioMappingJSON(rootHandle, serialized){
  const out = { generatedAt: new Date().toISOString(), audio: [] };

  // Small helper to get a directory from parts
  async function dirFromParts(parts){
    let dir = rootHandle;
    for (const p of parts){ dir = await dir.getDirectoryHandle(p, { create:false }); }
    return dir;
  }

  for (const album of (serialized?.albums||[])){
    // Determine if album has animated artwork in album root
    let animatedParts = null;
    try{
      const albumDir = await dirFromParts(album.folderParts);
      await albumDir.getFileHandle('square_animated_artwork.mp4', { create:false });
      animatedParts = [...album.folderParts, 'square_animated_artwork.mp4'];
    }catch{ animatedParts = null; }

    for (const t of (album.tracks||[])){
      out.audio.push({
        artist: album.artist,
        audioPathParts: t.pathParts,
        animatedArtworkPathParts: animatedParts,
      });
    }
  }
  return out;
}

// (Reverted) No hotkey/artist UI wiring. No manual indexing API is exposed.

// Search-bar "devour" animation
function devourChooseBtnAnimation(){
  const search = document.getElementById('searchInput');
  const btn = document.getElementById('pickWorkspaceBtn');
  if (!search || !btn) return;
  try{
    if (window.gsap){
      gsap.to(btn, { duration: 0.4, opacity: 0, scaleX: 0.6, width: 0, paddingLeft: 0, paddingRight: 0, margin: 0, ease: 'power2.in', onComplete: ()=>{ btn.hidden = true; } });
      const parent = btn.parentElement;
      const w = parent ? parent.getBoundingClientRect().width : null;
      if (w){
        gsap.to(search, { duration: 0.5, width: w, ease: 'power2.out' });
      }else{
        gsap.fromTo(search, { flexGrow: 1, scaleX: 1 }, { duration: 0.5, scaleX: 1.04, ease: 'power2.out', yoyo: true, repeat: 1 });
      }
    } else {
      btn.hidden = true;
    }
  }catch{}
}

// FLIP-style animation from a source card into the hero box
function animateCardToHero(fromEl, heroEl, kind){
  try{
    const fr = fromEl.getBoundingClientRect();
    const to = heroEl.getBoundingClientRect();
    const dx = fr.left - to.left;
    const dy = fr.top - to.top;
    const sx = fr.width / Math.max(1, to.width);
    const sy = fr.height / Math.max(1, to.height);
    gsap.fromTo(heroEl, { transformOrigin:'top left', x: dx, y: dy, scaleX: sx, scaleY: sy, borderRadius: kind==='artist'? '16px':'16px' }, { x:0, y:0, scaleX:1, scaleY:1, borderRadius: kind==='artist'? '9999px':'16px', duration: 0.45, ease: 'power3.out' });
  }catch{}
}
