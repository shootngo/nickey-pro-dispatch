/* ============================================================================
 * Nickey Dispatch — Google Drive Sync (V2 — debugged)
 * ----------------------------------------------------------------------------
 * Loads on every page. Provides:
 *   - window.NDSync.signIn(), signOut(), syncNow(), isSignedIn(), getEmail()
 *   - Hamburger menu integration (auto-injects "☁ Cloud Sync" item)
 *   - Auto-syncs on save events (custom 'ndsync:save' event)
 *   - Pull-then-push strategy (no data loss when signing in on new device)
 *   - Visible folder in user's Drive: "Nickey Dispatch Data"
 *
 * IMPORTANT: scope is now drive.file (not drive.appdata) so the user can
 * actually see their data file in Drive.
 * ============================================================================ */

(function(){
  'use strict';

  const CLIENT_ID = '1067375485374-cn97feb2m9bj4fr067uab62d0p1j4qkk.apps.googleusercontent.com';
  // drive.file scope only sees files this app creates - safer than full drive access
  const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';
  const FOLDER_NAME = 'Nickey Dispatch Data';
  const DATA_FILE_NAME = 'nickey-dispatch-data.json';
  const SYNC_INTERVAL_MS = 60000; // every 60 seconds

  // localStorage keys we sync
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
  let folderId = null;
  let driveFileId = null;
  let initialPullDone = false;
  let lastError = null;

  // ── LOGGING ─────────────────────────────────────────────────────────────
  function log(msg, data){
    const ts = new Date().toLocaleTimeString();
    if (data !== undefined){
      console.log('[NDSync ' + ts + ']', msg, data);
    } else {
      console.log('[NDSync ' + ts + ']', msg);
    }
  }
  function logError(msg, err){
    const ts = new Date().toLocaleTimeString();
    console.error('[NDSync ' + ts + '] ❌ ' + msg, err);
    lastError = msg + ' — ' + (err && err.message ? err.message : String(err));
  }

  // ── UI: STATUS PILL & MENU INTEGRATION ──────────────────────────────────
  function injectStyles(){
    if (document.getElementById('ndsync-styles')) return;
    const style = document.createElement('style');
    style.id = 'ndsync-styles';
    style.textContent = `
      .ndsync-pill{
        position:fixed;bottom:14px;right:14px;
        z-index:9998;
        background:rgba(0,0,0,0.92);border:1px solid #444;
        color:#aaa;font-size:11px;padding:6px 12px;
        border-radius:14px;font-family:'Source Sans 3',sans-serif;
        opacity:0;transition:opacity 0.3s;
        pointer-events:none;
        display:flex;align-items:center;gap:6px;
      }
      .ndsync-pill.show{opacity:1;}
      .ndsync-pill .dot{width:7px;height:7px;border-radius:50%;background:#888;flex-shrink:0;}
      .ndsync-pill.signed-in{border-color:#28a745;color:#a5d6a7;}
      .ndsync-pill.signed-in .dot{background:#28a745;}
      .ndsync-pill.syncing{border-color:#ffd700;color:#ffd700;}
      .ndsync-pill.syncing .dot{background:#ffd700;animation:ndsync-pulse 0.6s infinite;}
      .ndsync-pill.error{border-color:#cc0000;color:#ff8888;}
      .ndsync-pill.error .dot{background:#cc0000;}
      @keyframes ndsync-pulse{
        0%,100%{opacity:1;}
        50%{opacity:0.4;}
      }

      .ndsync-modal-bg{
        position:fixed;inset:0;background:rgba(0,0,0,0.85);
        z-index:99999;display:none;align-items:center;justify-content:center;padding:20px;
      }
      .ndsync-modal-bg.show{display:flex;}
      .ndsync-modal{
        background:#0a0a0a;border:2px solid #ffd700;border-radius:14px;
        padding:24px;max-width:380px;width:100%;text-align:center;
        font-family:'Source Sans 3',sans-serif;
      }
      .ndsync-modal h3{
        color:#ffd700;font-family:'Rajdhani',sans-serif;
        letter-spacing:2px;text-transform:uppercase;font-size:18px;margin-bottom:14px;
      }
      .ndsync-modal p{color:#ddd;font-size:14px;line-height:1.5;margin-bottom:16px;}
      .ndsync-info{
        background:#1a1a1a;border:1px solid #333;border-radius:8px;
        padding:10px;margin-bottom:14px;font-size:12px;color:#aaa;line-height:1.4;text-align:left;
      }
      .ndsync-info strong{color:#ffd700;}
      .ndsync-email{color:#ffd700;font-weight:700;font-size:14px;}
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
    // Look for the existing hamburger menu (in index.html) and add a Cloud Sync item.
    // Index.html has <div class="menu" id="menuOverlay"> with .menu-item children.
    // For other pages we don't have a hamburger menu, so just rely on the pill.
    const menu = document.querySelector('#menuOverlay .menu');
    if (!menu) return;

    if (document.getElementById('ndsyncMenuItem')) return; // already injected

    const item = document.createElement('div');
    item.className = 'menu-item';
    item.id = 'ndsyncMenuItem';
    item.style.background = 'linear-gradient(135deg,#0a2a0a 0%,#1a3a1a 100%)';
    item.style.color = '#a5d6a7';
    item.style.border = '1px solid #28a745';
    item.innerHTML = '☁️ Cloud Sync <span id="ndsyncMenuStatus" style="font-size:12px;color:#888;display:block;margin-top:2px;font-weight:400;">Not signed in</span>';
    item.onclick = function(){
      // Close the hamburger menu
      const overlay = document.getElementById('menuOverlay');
      if (overlay) overlay.style.display = 'none';
      // Open sync modal
      window.NDSync.openModal();
    };
    // Insert at top of menu
    menu.insertBefore(item, menu.firstChild);

    // Update label based on current state
    updateMenuLabel();
  }

  function updateMenuLabel(){
    const label = document.getElementById('ndsyncMenuStatus');
    if (!label) return;
    if (isSignedIn){
      label.textContent = userEmail ? '✓ ' + userEmail : '✓ Signed in';
      label.style.color = '#a5d6a7';
    } else {
      label.textContent = 'Not signed in';
      label.style.color = '#888';
    }
  }

  function showPill(state, text, durationMs){
    const pill = document.getElementById('ndsyncPill');
    const textEl = document.getElementById('ndsyncPillText');
    if (!pill || !textEl) return;
    pill.classList.remove('signed-in', 'syncing', 'error');
    if (state) pill.classList.add(state);
    textEl.textContent = text;
    pill.classList.add('show');
    if (durationMs){
      setTimeout(() => pill.classList.remove('show'), durationMs);
    }
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
          Sign in on other devices with the same account to access your data anywhere.
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
        <p>
          Sign in with Google to sync your dispatch data, fuel logs, inspections, and earnings across all your devices.
        </p>
        <div class="ndsync-info">
          <strong>🔒 Your data stays private:</strong><br>
          Saved in YOUR Google Drive only. Each driver uses their own Google account. No one else can see your data.
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

  // ── GOOGLE IDENTITY SERVICES ────────────────────────────────────────────
  function loadGoogleScripts(){
    return new Promise((resolve, reject) => {
      if (window.google && window.google.accounts) return resolve();
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = function(){ resolve(); };
      script.onerror = function(){ reject(new Error('Could not load Google sign-in')); };
      document.head.appendChild(script);
    });
  }

  function initTokenClient(){
    if (tokenClient) return tokenClient;
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2){
      log('GIS not loaded yet');
      return null;
    }
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
    log('Got access token');
    accessToken = resp.access_token;
    isSignedIn = true;

    const expiresAt = Date.now() + ((resp.expires_in || 3600) * 1000);
    sessionStorage.setItem('ndsync_token', accessToken);
    sessionStorage.setItem('ndsync_expires', String(expiresAt));

    showPill('syncing', 'Setting up cloud...', 0);
    closeModal();

    fetchUserEmail()
      .then(() => {
        updateMenuLabel();
        return ensureFolder();
      })
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
    .then(r => {
      if (!r.ok) throw new Error('userinfo HTTP ' + r.status);
      return r.json();
    })
    .then(data => {
      userEmail = data.email || null;
      sessionStorage.setItem('ndsync_email', userEmail || '');
      log('User email:', userEmail);
    })
    .catch(err => {
      logError('Could not fetch email', err);
      // Non-fatal, continue
    });
  }

  // ── DRIVE: FOLDER ──────────────────────────────────────────────────────
  function ensureFolder(){
    log('Looking for folder: ' + FOLDER_NAME);
    const q = encodeURIComponent("name='" + FOLDER_NAME + "' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    return fetch('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name)', {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    })
    .then(r => {
      if (!r.ok) throw new Error('folder search HTTP ' + r.status);
      return r.json();
    })
    .then(data => {
      if (data.files && data.files.length > 0){
        folderId = data.files[0].id;
        log('Found folder:', folderId);
        return folderId;
      }
      // Create folder
      log('Creating folder...');
      return fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: FOLDER_NAME,
          mimeType: 'application/vnd.google-apps.folder'
        })
      })
      .then(r => {
        if (!r.ok) throw new Error('create folder HTTP ' + r.status);
        return r.json();
      })
      .then(folder => {
        folderId = folder.id;
        log('Created folder:', folderId);
        return folderId;
      });
    });
  }

  // ── DRIVE: DATA FILE ───────────────────────────────────────────────────
  function ensureDataFile(){
    if (!folderId) throw new Error('No folder ID');
    log('Looking for data file in folder');
    const q = encodeURIComponent("name='" + DATA_FILE_NAME + "' and '" + folderId + "' in parents and trashed=false");
    return fetch('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name,modifiedTime)', {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    })
    .then(r => {
      if (!r.ok) throw new Error('file search HTTP ' + r.status);
      return r.json();
    })
    .then(data => {
      if (data.files && data.files.length > 0){
        driveFileId = data.files[0].id;
        log('Found data file:', driveFileId);
        return driveFileId;
      }
      // Create file with empty payload
      log('Creating data file...');
      const metadata = {
        name: DATA_FILE_NAME,
        parents: [folderId],
        mimeType: 'application/json'
      };
      // Use multipart upload to create file with content in one request
      const boundary = '-------ndsync' + Date.now();
      const initialContent = JSON.stringify({_meta:{created:new Date().toISOString()}});
      const body =
        '--' + boundary + '\r\n' +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(metadata) + '\r\n' +
        '--' + boundary + '\r\n' +
        'Content-Type: application/json\r\n\r\n' +
        initialContent + '\r\n' +
        '--' + boundary + '--';

      return fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'Content-Type': 'multipart/related; boundary=' + boundary
        },
        body: body
      })
      .then(r => {
        if (!r.ok) throw new Error('create file HTTP ' + r.status);
        return r.json();
      })
      .then(file => {
        driveFileId = file.id;
        log('Created data file:', driveFileId);
        return driveFileId;
      });
    });
  }

  // ── DRIVE: PULL ────────────────────────────────────────────────────────
  function pullFromDrive(){
    if (!driveFileId || !accessToken) return Promise.resolve();
    log('Pulling from Drive...');
    showPill('syncing', 'Pulling from cloud...', 0);

    return fetch('https://www.googleapis.com/drive/v3/files/' + driveFileId + '?alt=media', {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    })
    .then(r => {
      if (!r.ok){
        if (r.status === 404){
          log('File empty');
          return null;
        }
        throw new Error('pull HTTP ' + r.status);
      }
      return r.text();
    })
    .then(text => {
      if (!text || text.trim() === '' || text.trim() === '{}') {
        log('Pulled empty data — first time on this account');
        // Push our local data up so cloud has it
        return pushToDrive();
      }
      let cloudData;
      try { cloudData = JSON.parse(text); } catch(e) {
        logError('Could not parse cloud data', e);
        return pushToDrive(); // Recover by pushing our local
      }
      log('Pulled from cloud, keys:', Object.keys(cloudData));
      mergeCloudIntoLocal(cloudData);
      // After merging, push the result back so cloud reflects merged state
      return pushToDrive();
    })
    .catch(err => {
      logError('Pull failed', err);
      showPill('error', 'Pull failed', 4000);
    });
  }

  function mergeCloudIntoLocal(cloudData){
    if (!cloudData || typeof cloudData !== 'object') return;

    // Strategy: for each sync key, if cloud has it AND local doesn't (or local is shorter/older),
    // take cloud. Otherwise keep local. For simple "just me on multiple devices" this works.
    SYNC_KEYS.forEach(key => {
      if (!cloudData.hasOwnProperty(key)) return;
      const cloudVal = cloudData[key];
      if (cloudVal === null || cloudVal === undefined) return;

      const localStr = localStorage.getItem(key);
      const cloudStr = typeof cloudVal === 'string' ? cloudVal : JSON.stringify(cloudVal);

      // If local is empty/null, take cloud
      if (!localStr){
        localStorage.setItem(key, cloudStr);
        log('  merged ' + key + ' (was empty)');
        return;
      }

      // For arrays (records, history), prefer the longer one
      if (Array.isArray(cloudVal)){
        let localArr;
        try { localArr = JSON.parse(localStr); } catch(e){ localArr = []; }
        if (Array.isArray(localArr) && cloudVal.length > localArr.length){
          localStorage.setItem(key, cloudStr);
          log('  merged ' + key + ' (cloud had more: ' + cloudVal.length + ' vs ' + localArr.length + ')');
        }
        // else keep local (it has more or equal data)
        return;
      }

      // For objects (weeklyDeductions, fuelStations), merge keys
      if (typeof cloudVal === 'object' && !Array.isArray(cloudVal)){
        let localObj;
        try { localObj = JSON.parse(localStr); } catch(e){ localObj = {}; }
        if (typeof localObj === 'object' && localObj !== null){
          const merged = Object.assign({}, cloudVal, localObj); // local takes priority
          localStorage.setItem(key, JSON.stringify(merged));
          log('  merged ' + key + ' (object)');
        } else {
          localStorage.setItem(key, cloudStr);
        }
        return;
      }

      // For primitives (currentDriver), keep local if set
      if (!localStr || localStr === ''){
        localStorage.setItem(key, cloudStr);
      }
    });

    // Notify pages that data has been refreshed from cloud
    document.dispatchEvent(new CustomEvent('ndsync:datapulled', {detail: {cloudData: cloudData}}));
  }

  // ── DRIVE: PUSH ────────────────────────────────────────────────────────
  function pushToDrive(){
    if (!driveFileId || !accessToken){
      log('Skipping push (no file or token)');
      return Promise.resolve();
    }

    showPill('syncing', 'Syncing...', 0);

    const payload = {
      _meta: {
        version: '6.0',
        updatedAt: new Date().toISOString(),
        device: getDeviceLabel(),
        email: userEmail
      }
    };
    SYNC_KEYS.forEach(key => {
      const value = localStorage.getItem(key);
      if (value !== null){
        try {
          payload[key] = JSON.parse(value);
        } catch(e){
          payload[key] = value;
        }
      }
    });

    log('Pushing to Drive, payload size: ' + JSON.stringify(payload).length + ' bytes');

    return fetch('https://www.googleapis.com/upload/drive/v3/files/' + driveFileId + '?uploadType=media', {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    .then(r => {
      if (!r.ok) throw new Error('push HTTP ' + r.status);
      return r.json();
    })
    .then(() => {
      const now = new Date().toLocaleTimeString();
      sessionStorage.setItem('ndsync_last_push', now);
      lastError = null; // clear any previous error
      log('Push complete at ' + now);
      showPill('signed-in', '✓ Synced ' + now, 2500);
    })
    .catch(err => {
      logError('Push failed', err);
      showPill('error', 'Sync failed', 4000);
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
      if (isSignedIn && navigator.onLine && initialPullDone){
        pushToDrive();
      }
    }, SYNC_INTERVAL_MS);
    log('Auto-sync started (every ' + (SYNC_INTERVAL_MS/1000) + 's)');
  }

  function stopAutoSync(){
    if (syncInterval){
      clearInterval(syncInterval);
      syncInterval = null;
    }
  }

  // Listen for app save events — pages can dispatch 'ndsync:save' to trigger a push
  document.addEventListener('ndsync:save', function(){
    if (isSignedIn && navigator.onLine && initialPullDone){
      log('Save event triggered sync');
      pushToDrive();
    }
  });

  // Online/focus syncing
  window.addEventListener('online', function(){
    if (isSignedIn && initialPullDone){
      log('Back online - pushing');
      pushToDrive();
    }
  });

  window.addEventListener('focus', function(){
    if (isSignedIn && navigator.onLine && initialPullDone){
      log('Window focus - syncing');
      pushToDrive();
    }
  });

  // ── RESUME SESSION ─────────────────────────────────────────────────────
  function tryResumeSession(){
    const cachedToken = sessionStorage.getItem('ndsync_token');
    const cachedExpires = parseInt(sessionStorage.getItem('ndsync_expires') || '0', 10);
    const cachedEmail = sessionStorage.getItem('ndsync_email');

    if (cachedToken && cachedExpires > Date.now() + 60000){
      accessToken = cachedToken;
      userEmail = cachedEmail;
      isSignedIn = true;
      log('Resumed session for ' + userEmail);
      updateMenuLabel();
      showPill('signed-in', '✓ ' + (userEmail || 'Synced'), 2000);

      ensureFolder()
        .then(() => ensureDataFile())
        .then(() => pullFromDrive())
        .then(() => {
          initialPullDone = true;
          startAutoSync();
        })
        .catch(err => {
          logError('Resume failed - token may be expired', err);
          // Clear bad session
          sessionStorage.removeItem('ndsync_token');
          sessionStorage.removeItem('ndsync_expires');
          accessToken = null;
          isSignedIn = false;
          updateMenuLabel();
          showPill('error', 'Please sign in again', 4000);
        });
      return true;
    }
    return false;
  }

  // ── PUBLIC API ──────────────────────────────────────────────────────────
  window.NDSync = {
    signIn: function(){
      lastError = null;
      showPill('syncing', 'Loading sign-in...', 0);
      loadGoogleScripts()
        .then(() => {
          const tc = initTokenClient();
          if (tc){
            tc.requestAccessToken();
          } else {
            throw new Error('Could not init token client');
          }
        })
        .catch(err => {
          logError('Sign-in failed', err);
          showPill('error', 'Sign-in failed', 4000);
        });
    },

    signOut: function(){
      if (accessToken && window.google && window.google.accounts){
        try { window.google.accounts.oauth2.revoke(accessToken, function(){}); } catch(e){}
      }
      accessToken = null;
      userEmail = null;
      isSignedIn = false;
      driveFileId = null;
      folderId = null;
      initialPullDone = false;
      sessionStorage.removeItem('ndsync_token');
      sessionStorage.removeItem('ndsync_expires');
      sessionStorage.removeItem('ndsync_email');
      sessionStorage.removeItem('ndsync_last_push');
      stopAutoSync();
      updateMenuLabel();
      hidePill();
      closeModal();
      log('Signed out');
    },

    syncNow: function(){
      if (!isSignedIn){
        showPill('error', 'Sign in first', 2500);
        return;
      }
      if (!initialPullDone){
        // Still in initial setup
        return;
      }
      pushToDrive();
      closeModal();
    },

    openModal: openModal,
    closeModal: closeModal,
    isSignedIn: function(){ return isSignedIn; },
    getEmail: function(){ return userEmail; },
    getLastError: function(){ return lastError; }
  };

  // ── INIT ────────────────────────────────────────────────────────────────
  function init(){
    log('Init on ' + window.location.pathname);
    injectStyles();
    injectStatusPill();
    injectModal();
    injectMenuItem();

    if (!tryResumeSession()){
      // Pre-load Google scripts so sign-in is fast when tapped
      loadGoogleScripts().then(initTokenClient).catch(()=>{});
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Run after a short delay to let page load its menu
    setTimeout(init, 100);
  }

})();
