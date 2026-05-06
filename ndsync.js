/* ============================================================================
 * Nickey Dispatch — Google Drive Sync Module
 * ----------------------------------------------------------------------------
 * Single file shared by index.html, earnings.html, inspection.html,
 * intermodal.html, and sds.html.
 *
 * Loads on page open. Adds:
 *   - Sign-in / Sign-out button to top-right corner
 *   - Auto-syncs localStorage to Google Drive every 30s
 *   - Pulls latest from Drive on page load (when signed in)
 *   - Falls back to localStorage when offline
 *
 * Each driver signs in with their OWN Google account.
 * Their data lives in a private folder in their OWN Google Drive.
 * No driver can see another driver's data.
 * ============================================================================ */

(function(){
  'use strict';

  // ── CONFIG ──────────────────────────────────────────────────────────────
  const CLIENT_ID = '1067375485374-cn97feb2m9bj4fr067uab62d0p1j4qkk.apps.googleusercontent.com';
  const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';
  const DATA_FILE_NAME = 'nickey-dispatch-data.json';
  const SYNC_INTERVAL_MS = 30000; // every 30 seconds

  // localStorage keys we sync (everything Nickey Dispatch saves):
  const SYNC_KEYS = [
    'nickeySavedRecords',
    'weeklyDeductions',
    'fuelStations',
    'currentDriver',
    'nickeyInspectionHistory',
    'nickeyLatestInspection',
    'nickeyIntermodalHistory',
    'nickeyDraftLoad',
    'nickeyTrailerInspectionDraft',
    'nickeyIntermodalDraft',
    'exportFormat'
  ];

  // ── STATE ───────────────────────────────────────────────────────────────
  let tokenClient = null;
  let accessToken = null;
  let userEmail = null;
  let isSignedIn = false;
  let syncInterval = null;
  let driveFileId = null; // ID of the cloud data file once we find/create it

  // ── UI: SIGN-IN BUTTON ──────────────────────────────────────────────────
  function injectSyncUI(){
    // Don't add UI to SDS pages — they're reference-only, no data to sync
    if (window.location.pathname.endsWith('sds.html')) return;

    const style = document.createElement('style');
    style.textContent = `
      .ndsync-btn{
        position:fixed;top:10px;right:10px;
        z-index:9999;
        background:#000;border:1.5px solid #ffd700;
        color:#ffd700;
        font-family:'Rajdhani',sans-serif;font-weight:700;
        font-size:11px;letter-spacing:1px;text-transform:uppercase;
        padding:6px 10px;border-radius:14px;cursor:pointer;
        box-shadow:0 2px 8px rgba(0,0,0,0.5);
        display:flex;align-items:center;gap:6px;
        transition:all 0.2s;
      }
      .ndsync-btn:hover{background:#ffd700;color:#000;}
      .ndsync-btn .dot{
        width:7px;height:7px;border-radius:50%;
        background:#888;flex-shrink:0;
      }
      .ndsync-btn.signed-in .dot{background:#28a745;animation:ndPulse 2s infinite;}
      .ndsync-btn.syncing .dot{background:#ffd700;animation:ndPulse 0.6s infinite;}
      .ndsync-btn.error .dot{background:#cc0000;}
      @keyframes ndPulse{
        0%,100%{opacity:1;transform:scale(1);}
        50%{opacity:0.5;transform:scale(1.3);}
      }
      .ndsync-status{
        position:fixed;top:42px;right:10px;
        z-index:9998;
        background:rgba(0,0,0,0.92);border:1px solid #444;
        color:#aaa;font-size:10px;padding:4px 10px;
        border-radius:10px;font-family:'Source Sans 3',sans-serif;
        opacity:0;transition:opacity 0.3s;
        pointer-events:none;max-width:240px;
      }
      .ndsync-status.show{opacity:1;}
      .ndsync-modal-bg{
        position:fixed;inset:0;background:rgba(0,0,0,0.85);
        z-index:99999;display:none;align-items:center;justify-content:center;padding:20px;
      }
      .ndsync-modal-bg.show{display:flex;}
      .ndsync-modal{
        background:#0a0a0a;border:2px solid #ffd700;border-radius:14px;
        padding:24px;max-width:380px;width:100%;text-align:center;
      }
      .ndsync-modal h3{
        color:#ffd700;font-family:'Rajdhani',sans-serif;
        letter-spacing:2px;text-transform:uppercase;font-size:18px;margin-bottom:14px;
      }
      .ndsync-modal p{color:#ddd;font-size:14px;line-height:1.5;margin-bottom:16px;}
      .ndsync-modal .ndsync-info{
        background:#1a1a1a;border:1px solid #333;border-radius:8px;
        padding:10px;margin-bottom:14px;font-size:12px;color:#aaa;line-height:1.4;
      }
      .ndsync-modal .ndsync-email{
        color:#ffd700;font-weight:700;font-family:'Rajdhani',sans-serif;
        font-size:15px;letter-spacing:1px;
      }
      .ndsync-btn-row{display:flex;gap:8px;flex-direction:column;}
      .ndsync-action{
        padding:12px;border-radius:8px;font-size:14px;font-weight:700;
        cursor:pointer;border:none;letter-spacing:1px;text-transform:uppercase;
        font-family:'Rajdhani',sans-serif;
      }
      .ndsync-action.primary{background:#ffd700;color:#000;}
      .ndsync-action.danger{background:#1a1a1a;color:#cc6666;border:1px solid #cc6666;}
      .ndsync-action.cancel{background:#1a1a1a;color:#aaa;border:1px solid #444;}
    `;
    document.head.appendChild(style);

    // Sync status button (top-right)
    const btn = document.createElement('button');
    btn.className = 'ndsync-btn';
    btn.id = 'ndsyncBtn';
    btn.innerHTML = '<span class="dot"></span><span id="ndsyncBtnLabel">Sign In</span>';
    btn.onclick = openSyncModal;
    document.body.appendChild(btn);

    // Status pill (shows below button briefly)
    const status = document.createElement('div');
    status.className = 'ndsync-status';
    status.id = 'ndsyncStatus';
    document.body.appendChild(status);

    // Modal
    const modalBg = document.createElement('div');
    modalBg.className = 'ndsync-modal-bg';
    modalBg.id = 'ndsyncModalBg';
    modalBg.innerHTML = `
      <div class="ndsync-modal">
        <h3 id="ndsyncModalTitle">Cloud Sync</h3>
        <div id="ndsyncModalBody"></div>
      </div>
    `;
    document.body.appendChild(modalBg);
    modalBg.addEventListener('click', function(e){
      if (e.target === modalBg) modalBg.classList.remove('show');
    });
  }

  function showStatus(msg, durationMs){
    const el = document.getElementById('ndsyncStatus');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), durationMs || 2500);
  }

  function setBtnState(state, label){
    const btn = document.getElementById('ndsyncBtn');
    const lbl = document.getElementById('ndsyncBtnLabel');
    if (!btn || !lbl) return;
    btn.classList.remove('signed-in', 'syncing', 'error');
    if (state) btn.classList.add(state);
    if (label) lbl.textContent = label;
  }

  function openSyncModal(){
    const bg = document.getElementById('ndsyncModalBg');
    const body = document.getElementById('ndsyncModalBody');
    if (!bg || !body) return;

    if (isSignedIn){
      body.innerHTML = `
        <div class="ndsync-info">
          <strong style="color:#a5d6a7;">✓ Signed in as</strong><br>
          <span class="ndsync-email">${userEmail || 'your account'}</span>
        </div>
        <p style="font-size:13px;color:#aaa;">
          Your data is syncing to your private Google Drive folder.<br>
          Sign in on other devices with the same account to access your data anywhere.
        </p>
        <div class="ndsync-btn-row">
          <button class="ndsync-action primary" onclick="window.NDSync.syncNow()">⟳ Sync Now</button>
          <button class="ndsync-action danger" onclick="window.NDSync.signOut()">Sign Out</button>
          <button class="ndsync-action cancel" onclick="document.getElementById('ndsyncModalBg').classList.remove('show')">Close</button>
        </div>
      `;
    } else {
      body.innerHTML = `
        <p>
          Sign in with your Google account to sync your dispatch data, fuel logs,
          inspections, and earnings across all your devices.
        </p>
        <div class="ndsync-info">
          <strong style="color:#ffd700;">Your data stays private:</strong><br>
          Saved in YOUR Google Drive only. No one else — not Frank, not Nickey, not Anthropic — can see your data. Each driver uses their own account.
        </div>
        <div class="ndsync-btn-row">
          <button class="ndsync-action primary" onclick="window.NDSync.signIn()">🔐 Sign in with Google</button>
          <button class="ndsync-action cancel" onclick="document.getElementById('ndsyncModalBg').classList.remove('show')">Cancel</button>
        </div>
      `;
    }
    bg.classList.add('show');
  }

  // ── GOOGLE IDENTITY SERVICES (GIS) ──────────────────────────────────────
  function loadGoogleScripts(){
    return new Promise((resolve, reject) => {
      // Already loaded?
      if (window.google && window.google.accounts) return resolve();

      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = function(){ resolve(); };
      script.onerror = function(){ reject(new Error('Failed to load Google Identity Services')); };
      document.head.appendChild(script);
    });
  }

  function initTokenClient(){
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2){
      console.warn('[NDSync] Google Identity Services not yet loaded');
      return;
    }
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: handleTokenResponse,
      error_callback: function(err){
        console.error('[NDSync] Token error:', err);
        showStatus('Sign-in failed', 4000);
        setBtnState('error', 'Sign In');
      }
    });
  }

  function handleTokenResponse(resp){
    if (resp.error){
      console.error('[NDSync] Token error:', resp);
      showStatus('Sign-in failed', 4000);
      setBtnState('error', 'Sign In');
      return;
    }
    accessToken = resp.access_token;
    isSignedIn = true;

    // Save token expiry so we know when to refresh
    const expiresAt = Date.now() + ((resp.expires_in || 3600) * 1000);
    sessionStorage.setItem('ndsync_token', accessToken);
    sessionStorage.setItem('ndsync_expires', String(expiresAt));

    // Get user email for display
    fetchUserEmail().then(() => {
      setBtnState('signed-in', userEmail || 'Synced');
      showStatus('✓ Signed in', 2500);

      // Close modal if open
      const modalBg = document.getElementById('ndsyncModalBg');
      if (modalBg) modalBg.classList.remove('show');

      // Find or create Drive file, then pull data
      ensureDriveFile()
        .then(() => pullFromDrive())
        .then(() => startAutoSync());
    });
  }

  function fetchUserEmail(){
    return fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    })
    .then(r => r.json())
    .then(data => {
      userEmail = data.email || 'signed in';
      sessionStorage.setItem('ndsync_email', userEmail);
    })
    .catch(err => {
      console.warn('[NDSync] Could not fetch user email:', err);
    });
  }

  // ── DRIVE: FIND OR CREATE DATA FILE ─────────────────────────────────────
  function ensureDriveFile(){
    // Look for existing data file in appDataFolder
    return fetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name)&q=' + encodeURIComponent("name='" + DATA_FILE_NAME + "'"), {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    })
    .then(r => r.json())
    .then(data => {
      if (data.files && data.files.length > 0){
        driveFileId = data.files[0].id;
        console.log('[NDSync] Found existing Drive file:', driveFileId);
        return driveFileId;
      } else {
        // Create new file
        return createDriveFile();
      }
    });
  }

  function createDriveFile(){
    const metadata = {
      name: DATA_FILE_NAME,
      parents: ['appDataFolder']
    };
    return fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(metadata)
    })
    .then(r => r.json())
    .then(data => {
      driveFileId = data.id;
      console.log('[NDSync] Created new Drive file:', driveFileId);
      // Initialize with empty data
      return pushToDrive();
    });
  }

  // ── DRIVE: PULL DATA ────────────────────────────────────────────────────
  function pullFromDrive(){
    if (!driveFileId || !accessToken) return Promise.resolve();
    setBtnState('syncing', 'Syncing...');
    return fetch('https://www.googleapis.com/drive/v3/files/' + driveFileId + '?alt=media', {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    })
    .then(r => {
      if (!r.ok){
        if (r.status === 404){
          console.log('[NDSync] File empty/new — nothing to pull');
          return null;
        }
        throw new Error('Pull failed: ' + r.status);
      }
      return r.text();
    })
    .then(text => {
      if (!text || text.trim() === '') return;
      const cloudData = JSON.parse(text);
      mergeCloudIntoLocal(cloudData);
      setBtnState('signed-in', userEmail || 'Synced');
      showStatus('✓ Pulled from cloud', 2000);
      console.log('[NDSync] Pull complete');
    })
    .catch(err => {
      console.error('[NDSync] Pull error:', err);
      setBtnState('error', 'Sync Error');
      showStatus('⚠ Sync failed', 4000);
    });
  }

  function mergeCloudIntoLocal(cloudData){
    if (!cloudData || typeof cloudData !== 'object') return;

    // For each known sync key, prefer the cloud version IF it has more data
    // This is a simple "cloud wins" strategy. Per-record timestamp merging
    // could be added later, but for "just me on multiple devices" it's fine.
    SYNC_KEYS.forEach(key => {
      if (cloudData.hasOwnProperty(key) && cloudData[key] !== null && cloudData[key] !== undefined){
        try {
          const value = typeof cloudData[key] === 'string' ? cloudData[key] : JSON.stringify(cloudData[key]);
          localStorage.setItem(key, value);
        } catch(e){
          console.warn('[NDSync] Could not merge key', key, e);
        }
      }
    });

    // Trigger a soft page refresh so app picks up new data
    // (only on initial sign-in pull; not on auto-syncs)
    if (cloudData._initialPull){
      // Don't reload, just dispatch a custom event so the app can re-render
      document.dispatchEvent(new CustomEvent('ndsync:datapulled'));
    }
  }

  // ── DRIVE: PUSH DATA ────────────────────────────────────────────────────
  function pushToDrive(){
    if (!driveFileId || !accessToken) return Promise.resolve();
    setBtnState('syncing', 'Syncing...');

    // Gather all sync keys from localStorage
    const payload = {
      _meta: {
        version: '6.0',
        updatedAt: new Date().toISOString(),
        device: getDeviceLabel()
      }
    };
    SYNC_KEYS.forEach(key => {
      const value = localStorage.getItem(key);
      if (value !== null){
        try {
          payload[key] = JSON.parse(value);
        } catch(e){
          payload[key] = value; // store as string if not JSON
        }
      }
    });

    return fetch('https://www.googleapis.com/upload/drive/v3/files/' + driveFileId + '?uploadType=media', {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    .then(r => {
      if (!r.ok) throw new Error('Push failed: ' + r.status);
      return r.json();
    })
    .then(() => {
      setBtnState('signed-in', userEmail || 'Synced');
      showStatus('✓ Synced', 1500);
      console.log('[NDSync] Push complete at', new Date().toLocaleTimeString());
    })
    .catch(err => {
      console.error('[NDSync] Push error:', err);
      setBtnState('error', 'Sync Error');
      showStatus('⚠ Sync failed', 4000);
    });
  }

  function getDeviceLabel(){
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Win/.test(ua)) return 'Windows';
    return 'Device';
  }

  // ── AUTO-SYNC ───────────────────────────────────────────────────────────
  function startAutoSync(){
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => {
      if (isSignedIn && navigator.onLine){
        pushToDrive();
      }
    }, SYNC_INTERVAL_MS);
    console.log('[NDSync] Auto-sync started (every ' + (SYNC_INTERVAL_MS/1000) + 's)');
  }

  function stopAutoSync(){
    if (syncInterval){
      clearInterval(syncInterval);
      syncInterval = null;
    }
  }

  // ── PUBLIC API ──────────────────────────────────────────────────────────
  window.NDSync = {
    signIn: function(){
      if (!tokenClient){
        showStatus('Loading Google sign-in...', 2000);
        loadGoogleScripts()
          .then(() => {
            initTokenClient();
            if (tokenClient) tokenClient.requestAccessToken();
          })
          .catch(err => {
            console.error('[NDSync] Failed to load Google:', err);
            showStatus('⚠ No internet?', 4000);
          });
      } else {
        tokenClient.requestAccessToken();
      }
    },

    signOut: function(){
      if (accessToken && window.google && window.google.accounts){
        window.google.accounts.oauth2.revoke(accessToken, function(){
          console.log('[NDSync] Token revoked');
        });
      }
      accessToken = null;
      userEmail = null;
      isSignedIn = false;
      driveFileId = null;
      sessionStorage.removeItem('ndsync_token');
      sessionStorage.removeItem('ndsync_expires');
      sessionStorage.removeItem('ndsync_email');
      stopAutoSync();
      setBtnState('', 'Sign In');
      showStatus('Signed out', 2000);
      const modalBg = document.getElementById('ndsyncModalBg');
      if (modalBg) modalBg.classList.remove('show');
    },

    syncNow: function(){
      if (!isSignedIn){
        showStatus('Sign in first', 2500);
        return;
      }
      pushToDrive();
      const modalBg = document.getElementById('ndsyncModalBg');
      if (modalBg) modalBg.classList.remove('show');
    },

    isSignedIn: function(){ return isSignedIn; },
    getUserEmail: function(){ return userEmail; }
  };

  // ── INIT ────────────────────────────────────────────────────────────────
  function init(){
    injectSyncUI();

    // Check for existing token in session
    const cachedToken = sessionStorage.getItem('ndsync_token');
    const cachedExpires = parseInt(sessionStorage.getItem('ndsync_expires') || '0', 10);
    const cachedEmail = sessionStorage.getItem('ndsync_email');

    if (cachedToken && cachedExpires > Date.now() + 60000){ // valid for 1+ min
      // Resume session
      accessToken = cachedToken;
      userEmail = cachedEmail;
      isSignedIn = true;
      setBtnState('signed-in', userEmail || 'Synced');
      console.log('[NDSync] Resumed session for', userEmail);

      // Load Google scripts in background for sign-out support
      loadGoogleScripts().then(initTokenClient).catch(()=>{});

      // Find file & start syncing
      ensureDriveFile()
        .then(() => pullFromDrive())
        .then(() => startAutoSync())
        .catch(err => console.error('[NDSync] Resume failed:', err));
    } else {
      // Pre-load Google scripts so sign-in is fast when tapped
      loadGoogleScripts().then(initTokenClient).catch(err => {
        console.warn('[NDSync] Could not pre-load Google:', err);
      });
    }
  }

  // Handle online/offline transitions
  window.addEventListener('online', function(){
    if (isSignedIn){
      console.log('[NDSync] Back online — syncing');
      pushToDrive();
    }
  });

  // Sync when window regains focus (user came back to the app)
  window.addEventListener('focus', function(){
    if (isSignedIn && navigator.onLine){
      pushToDrive();
    }
  });

  // Sync before page closes
  window.addEventListener('beforeunload', function(){
    if (isSignedIn && navigator.onLine && navigator.sendBeacon){
      // Best-effort sync on close (though browsers may block this)
      try {
        const payload = {};
        SYNC_KEYS.forEach(key => {
          const v = localStorage.getItem(key);
          if (v !== null) {
            try { payload[key] = JSON.parse(v); } catch(e){ payload[key] = v; }
          }
        });
        // Note: sendBeacon doesn't support custom auth headers, so we just rely on auto-sync
      } catch(e){}
    }
  });

  // Wait for DOM ready
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
