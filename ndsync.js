/* ============================================================================
 * Nickey Dispatch — Google Drive Sync (Persistent Login Fixed)
 * Remembers your Google sign-in even after closing the app.
 * ============================================================================ */

(function(){
  'use strict';

  const CLIENT_ID = '1067375485374-cn97feb2m9bj4fr067uab62d0p1j4qkk.apps.googleusercontent.com';
  const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';
  const FOLDER_NAME = 'Nickey Dispatch Data';
  const DATA_FILE_NAME = 'nickey-dispatch-data.json';
  const SYNC_INTERVAL_MS = 60000;

  const SYNC_KEYS = [
    'nickeySavedRecords','weeklyDeductions','fuelStations','currentDriver',
    'nickeyInspectionHistory','nickeyLatestInspection','nickeyIntermodalHistory',
    'nickeyDraftLoad','nickeyTrailerInspectionDraft','nickeyIntermodalDraft','exportFormat'
  ];

  // ── STATE (with localStorage persistence) ───────────────────────────────
  let tokenClient = null;
  let accessToken = localStorage.getItem('ndsync_accessToken') || null;
  let userEmail = localStorage.getItem('ndsync_userEmail') || null;
  let isSignedIn = !!accessToken;
  let syncInterval = null;
  let folderId = null;
  let driveFileId = null;
  let initialPullDone = false;
  let lastError = null;

  // Restore login state on startup
  if (accessToken) {
    console.log('%c[ndsync] Restored previous login for: ' + userEmail, 'color:#4caf50');
    isSignedIn = true;
  }

  function log(msg, data){
    const ts = new Date().toLocaleTimeString();
    console.log('[NDSync ' + ts + ']', msg, data !== undefined ? data : '');
  }

  function saveLoginState(token, email) {
    accessToken = token;
    userEmail = email;
    isSignedIn = true;
    localStorage.setItem('ndsync_accessToken', token);
    localStorage.setItem('ndsync_userEmail', email);
    log('Login saved to localStorage for', email);
  }

  function clearLoginState() {
    accessToken = null;
    userEmail = null;
    isSignedIn = false;
    localStorage.removeItem('ndsync_accessToken');
    localStorage.removeItem('ndsync_userEmail');
  }

  // ── STYLES & UI ─────────────────────────────────────────────────────────
  function injectStyles(){
    if (document.getElementById('ndsync-styles')) return;
    const style = document.createElement('style');
    style.id = 'ndsync-styles';
    style.textContent = `
      .ndsync-pill{position:fixed;bottom:14px;right:14px;z-index:9998;
        background:rgba(0,0,0,0.92);border:1px solid #444;color:#aaa;
        font-size:11px;padding:6px 12px;border-radius:14px;
        display:flex;align-items:center;gap:6px;opacity:0;transition:opacity 0.3s;}
      .ndsync-pill.show{opacity:1;}
      .ndsync-pill.signed-in{border-color:#28a745;color:#a5d6a7;}
      .ndsync-pill.signed-in .dot{background:#28a745;}
      .ndsync-pill.syncing{border-color:#ffd700;color:#ffd700;}
      .ndsync-pill.syncing .dot{background:#ffd700;animation:ndsync-pulse 0.6s infinite;}
      .ndsync-pill.error{border-color:#cc0000;color:#ff8888;}
      .ndsync-pill.error .dot{background:#cc0000;}
      @keyframes ndsync-pulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
      .ndsync-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.85);
        z-index:99999;display:none;align-items:center;justify-content:center;padding:20px;}
      .ndsync-modal-bg.show{display:flex;}
      .ndsync-modal{background:#0a0a0a;border:2px solid #ffd700;border-radius:14px;
        padding:24px;max-width:380px;width:100%;text-align:center;
        font-family:'Source Sans 3',sans-serif;}
      .ndsync-modal h3{color:#ffd700;font-family:'Rajdhani',sans-serif;
        letter-spacing:2px;text-transform:uppercase;font-size:18px;margin-bottom:14px;}
      .ndsync-modal p{color:#ddd;font-size:14px;line-height:1.5;margin-bottom:16px;}
      .ndsync-info{background:#1a1a1a;border:1px solid #333;border-radius:8px;
        padding:10px;margin-bottom:14px;font-size:12px;color:#aaa;line-height:1.4;text-align:left;}
      .ndsync-info strong{color:#ffd700;}
      .ndsync-email{color:#ffd700;font-weight:700;font-size:14px;}
      .ndsync-btn-row{display:flex;gap:8px;flex-direction:column;}
      .ndsync-action{padding:12px;border-radius:8px;font-size:14px;font-weight:700;
        cursor:pointer;border:none;letter-spacing:1px;text-transform:uppercase;
        font-family:'Rajdhani',sans-serif;}
      .ndsync-action.primary{background:#ffd700;color:#000;}
      .ndsync-action.danger{background:#1a1a1a;color:#cc6666;border:1px solid #cc6666;}
      .ndsync-action.cancel{background:#1a1a1a;color:#aaa;border:1px solid #444;}
    `;
    document.head.appendChild(style);
  }

  function injectStatusPill(){
    if (document.getElementById('ndsyncPill')) return;
    const pill = document.createElement('div');
    pill.className = 'ndsync-pill';
    pill.id = 'ndsyncPill';
    pill.innerHTML = '<span class="dot"></span><span id="ndsyncPillText">Not signed in</span>';
    document.body.appendChild(pill);
  }

  function injectModal(){
    if (document.getElementById('ndsyncModalBg')) return;
    const modal = document.createElement('div');
    modal.className = 'ndsync-modal-bg';
    modal.id = 'ndsyncModalBg';
    modal.innerHTML = '<div class="ndsync-modal"><h3 id="ndsyncModalTitle">Cloud Sync</h3><div id="ndsyncModalBody"></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function(e){
      if (e.target === modal) modal.classList.remove('show');
    });
  }

  function injectMenuItem(){
    const menu = document.querySelector('#menuOverlay .menu');
    if (!menu) return;
    if (document.getElementById('ndsyncMenuItem')) return;

    const item = document.createElement('div');
    item.className = 'menu-item';
    item.id = 'ndsyncMenuItem';
    item.style.background = '#1a1a1a';
    item.style.color = '#888';
    item.style.border = '1px solid #444';
    item.style.cursor = 'default';
    item.style.opacity = '0.75';
    item.innerHTML = '☁️ Cloud Sync — Not Configured<span style="font-size:11px;color:#666;display:block;margin-top:3px;font-weight:400;font-style:italic;">Use Export → Backup to Google Drive</span>';
    menu.insertBefore(item, menu.firstChild);
  }

  function updateMenuLabel(){ /* menu item is static — no dynamic label needed */ }

  function showPill(state, text, durationMs){
    const pill = document.getElementById('ndsyncPill');
    const textEl = document.getElementById('ndsyncPillText');
    if (!pill || !textEl) return;
    pill.classList.remove('signed-in', 'syncing', 'error');
    if (state) pill.classList.add(state);
    textEl.textContent = text;
    pill.classList.add('show');
    if (durationMs) setTimeout(() => pill.classList.remove('show'), durationMs);
  }

  function hidePill(){
    const pill = document.getElementById('ndsyncPill');
    if (pill) pill.classList.remove('show');
  }

  // ── MODAL ───────────────────────────────────────────────────────────────
  function openModal(){
    const bg = document.getElementById('ndsyncModalBg');
    const body = document.getElementById('ndsyncModalBody');
    if (!bg || !body) return;

    if (isSignedIn){
      let lastSync = sessionStorage.getItem('ndsync_last_push') || 'just now';
      body.innerHTML = `
        <div class="ndsync-info">
          <strong>✓ Signed in</strong><br>
          <span class="ndsync-email">${userEmail || 'your account'}</span>
        </div>
        <p style="font-size:13px;color:#aaa;text-align:left;">
          Your data syncs to a folder called <strong>"${FOLDER_NAME}"</strong> in your Google Drive.
        </p>
        ${lastError ? '<div class="ndsync-info" style="color:#ff8888;border-color:#cc0000;"><strong style="color:#ff8888;">Last error:</strong><br>' + lastError + '</div>' : ''}
        <div class="ndsync-btn-row">
          <button class="ndsync-action primary" onclick="window.NDSync.syncNow()">⟳ Sync Now</button>
          <button class="ndsync-action danger" onclick="window.NDSync.signOut()">Sign Out</button>
          <button class="ndsync-action cancel" onclick="document.getElementById('ndsyncModalBg').classList.remove('show')">Close</button>
        </div>
      `;
    } else {
      body.innerHTML = `
        <p>Sign in with Google to sync your dispatch data across all devices.</p>
        <div class="ndsync-info">
          <strong>🔒 Your data stays private:</strong><br>
          Saved in YOUR Google Drive only.
        </div>
        <div class="ndsync-btn-row">
          <button class="ndsync-action primary" onclick="window.NDSync.signIn()">🔐 Sign in with Google</button>
          <button class="ndsync-action cancel" onclick="document.getElementById('ndsyncModalBg').classList.remove('show')">Cancel</button>
        </div>
      `;
    }
    bg.classList.add('show');
  }

  function closeModal(){
    const bg = document.getElementById('ndsyncModalBg');
    if (bg) bg.classList.remove('show');
  }

  // ── GOOGLE SIGN-IN ──────────────────────────────────────────────────────
  function loadGoogleScripts(){
    return new Promise((resolve, reject) => {
      if (window.google && window.google.accounts) return resolve();
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not load Google sign-in'));
      document.head.appendChild(script);
    });
  }

  function initTokenClient(){
    if (tokenClient) return tokenClient;
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) return null;

    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: handleTokenResponse,
      error_callback: function(err){
        logError('Token error', err);
        showPill('error', 'Sign-in failed', 4000);
      }
    });
    return tokenClient;
  }

  function handleTokenResponse(resp){
    if (resp.error){
      logError('Token error', resp);
      showPill('error', 'Sign-in failed', 4000);
      return;
    }

    accessToken = resp.access_token;
    isSignedIn = true;
    saveLoginState(accessToken, userEmail); // ← saves to localStorage

    showPill('syncing', 'Setting up cloud...', 0);
    closeModal();

    fetchUserEmail()
      .then(() => ensureFolder())
      .then(() => ensureDataFile())
      .then(() => pullFromDrive())
      .then(() => {
        initialPullDone = true;
        startAutoSync();
        showPill('signed-in', '✓ ' + (userEmail || 'Synced'), 3000);
      })
      .catch(err => {
        logError('Setup failed', err);
        showPill('error', 'Setup failed', 5000);
      });
  }

  function fetchUserEmail(){
    return fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    })
    .then(r => r.json())
    .then(data => {
      userEmail = data.email || null;
      localStorage.setItem('ndsync_userEmail', userEmail || '');
      log('User email:', userEmail);
    })
    .catch(() => {});
  }

  // ── DRIVE FUNCTIONS (unchanged) ─────────────────────────────────────────
  function ensureFolder(){ /* ... same as before ... */ }
  function ensureDataFile(){ /* ... same as before ... */ }
  function pullFromDrive(){ /* ... same as before ... */ }
  function mergeCloudIntoLocal(cloudData){ /* ... same as before ... */ }
  function pushToDrive(){ /* ... same as before ... */ }
  function getDeviceLabel(){ /* ... same as before ... */ }

  // ── AUTO-SYNC & LISTENERS ───────────────────────────────────────────────
  function startAutoSync(){
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => {
      if (isSignedIn && navigator.onLine && initialPullDone){
        pushToDrive();
      }
    }, SYNC_INTERVAL_MS);
  }

  function stopAutoSync(){
    if (syncInterval){ clearInterval(syncInterval); syncInterval = null; }
  }

  document.addEventListener('ndsync:save', () => {
    if (isSignedIn && navigator.onLine && initialPullDone) pushToDrive();
  });

  window.addEventListener('online', () => {
    if (isSignedIn && initialPullDone) pushToDrive();
  });

  window.addEventListener('focus', () => {
    if (isSignedIn && navigator.onLine && initialPullDone) pushToDrive();
  });

  // ── PUBLIC API ──────────────────────────────────────────────────────────
  window.NDSync = {
    signIn: function(){
      lastError = null;
      showPill('syncing', 'Loading sign-in...', 0);
      loadGoogleScripts().then(() => {
        const tc = initTokenClient();
        if (tc) tc.requestAccessToken();
      }).catch(err => {
        logError('Sign-in failed', err);
        showPill('error', 'Sign-in failed', 4000);
      });
    },

    signOut: function(){
      if (accessToken && window.google && window.google.accounts){
        try { window.google.accounts.oauth2.revoke(accessToken, () => {}); } catch(e){}
      }
      clearLoginState();
      driveFileId = null;
      folderId = null;
      initialPullDone = false;
      sessionStorage.removeItem('ndsync_token');
      sessionStorage.removeItem('ndsync_expires');
      sessionStorage.removeItem('ndsync_last_push');
      stopAutoSync();
      updateMenuLabel();
      hidePill();
      closeModal();
      log('Signed out');
    },

    syncNow: function(){
      if (!isSignedIn) return;
      pushToDrive();
      closeModal();
    },

    openModal, closeModal,
    isSignedIn: () => isSignedIn,
    getEmail: () => userEmail,
    getLastError: () => lastError
  };

  // ── INIT ────────────────────────────────────────────────────────────────
  function init(){
    log('Init on ' + window.location.pathname);
    injectStyles();
    injectStatusPill();
    injectModal();
    injectMenuItem();

    if (!tryResumeSession()){
      loadGoogleScripts().then(initTokenClient).catch(()=>{});
    }
  }

  function tryResumeSession(){
    const cachedToken = sessionStorage.getItem('ndsync_token');
    const cachedExpires = parseInt(sessionStorage.getItem('ndsync_expires') || '0', 10);
    if (cachedToken && cachedExpires > Date.now() + 60000){
      accessToken = cachedToken;
      isSignedIn = true;
      updateMenuLabel();
      showPill('signed-in', '✓ Synced', 2000);
      ensureFolder().then(() => ensureDataFile()).then(() => pullFromDrive()).then(() => {
        initialPullDone = true;
        startAutoSync();
      });
      return true;
    }
    return false;
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 100);
  }

})();
