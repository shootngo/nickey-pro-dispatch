/* ============================================================================
 * Nickey Dispatch — Google Drive Sync (Real Implementation)
 * Pull on load, push on change (30s debounce), pull on focus.
 * One sign-in persists across all pages via localStorage.
 * ============================================================================ */

(function(){
  'use strict';

  const CLIENT_ID     = '1067375485374-cn97feb2m9bj4fr067uab62d0p1j4qkk.apps.googleusercontent.com';
  const SCOPES        = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';
  const FOLDER_NAME   = 'Nickey Dispatch Data';
  const DATA_FILE     = 'nickey-dispatch-data.json';
  const PUSH_DEBOUNCE = 30000;   // ms between auto-pushes
  const TOKEN_BUFFER  = 120000;  // refresh token 2 min before expiry

  const SYNC_KEYS = [
    'nickeySavedRecords', 'weeklyDeductions', 'fuelStations', 'currentDriver',
    'nickeyInspectionHistory', 'nickeyLatestInspection', 'nickeyIntermodalHistory',
    'nickeyDraftLoad', 'nickeyTrailerInspectionDraft', 'nickeyIntermodalDraft',
    'exportFormat', 'nickeyCustomers', 'geminiApiKey', 'nickeyDispatchFormState'
  ];
  const SYNC_KEY_SET = new Set(SYNC_KEYS);

  // ── STATE ───────────────────────────────────────────────────────────────────
  let tokenClient    = null;
  let accessToken    = null;
  let tokenExpiry    = 0;
  let userEmail      = null;
  let isSignedIn     = false;
  let folderId       = null;
  let driveFileId    = null;
  let initialPullDone = false;
  let pushTimer      = null;
  let lastError      = null;
  let isSyncing      = false;

  // Restore persisted session values (used in init, not yet validated)
  const _persisted = {
    token:    localStorage.getItem('ndsync_accessToken'),
    expiry:   parseInt(localStorage.getItem('ndsync_tokenExpiry') || '0', 10),
    email:    localStorage.getItem('ndsync_userEmail'),
    folderId: localStorage.getItem('ndsync_folderId'),
    fileId:   localStorage.getItem('ndsync_fileId')
  };

  // ── LOGGING ─────────────────────────────────────────────────────────────────
  function log(msg, data){
    console.log('[NDSync]', msg, data !== undefined ? data : '');
  }
  function logError(msg, err){
    const detail = err ? (err.message || JSON.stringify(err)) : '';
    lastError = detail ? msg + ': ' + detail : msg;
    console.error('[NDSync ERROR]', lastError);
  }

  // ── TOKEN MANAGEMENT ────────────────────────────────────────────────────────
  function saveToken(token, expiresInSec, email){
    accessToken  = token;
    tokenExpiry  = Date.now() + expiresInSec * 1000;
    userEmail    = email || userEmail;
    isSignedIn   = true;
    _rawSet('ndsync_accessToken',  token);
    _rawSet('ndsync_tokenExpiry',  String(tokenExpiry));
    if (userEmail) _rawSet('ndsync_userEmail', userEmail);
    log('Token saved, expires in', expiresInSec + 's');
  }

  function clearToken(){
    accessToken = null; tokenExpiry = 0; userEmail = null;
    isSignedIn = false; folderId = null; driveFileId = null;
    initialPullDone = false;
    ['ndsync_accessToken','ndsync_tokenExpiry','ndsync_userEmail',
     'ndsync_folderId','ndsync_fileId'].forEach(k => localStorage.removeItem(k));
  }

  function tokenValid(){
    return !!(accessToken && Date.now() < tokenExpiry - TOKEN_BUFFER);
  }

  function scheduleRefresh(){
    const delay = tokenExpiry - Date.now() - TOKEN_BUFFER;
    if (delay > 0) setTimeout(silentRefresh, delay);
  }

  function silentRefresh(){
    if (tokenClient) tokenClient.requestAccessToken({ prompt: '' });
  }

  // ── localStorage INTERCEPT ──────────────────────────────────────────────────
  // Patch setItem so any write to a SYNC_KEY automatically timestamps + queues push.
  // _rawSet bypasses the patch (used internally to avoid loops).
  const _rawSet = localStorage.setItem.bind(localStorage);

  localStorage.setItem = function(key, value){
    _rawSet(key, value);
    if (SYNC_KEY_SET.has(key)){
      _rawSet('ndsync_ts_' + key, new Date().toISOString());
      if (isSignedIn && initialPullDone) debouncedPush();
    }
  };

  // ── STYLES ──────────────────────────────────────────────────────────────────
  function injectStyles(){
    if (document.getElementById('ndsync-styles')) return;
    const s = document.createElement('style');
    s.id = 'ndsync-styles';
    s.textContent = `
      #ndsyncPill{position:fixed;bottom:14px;right:14px;z-index:9998;
        background:rgba(0,0,0,0.92);border:1px solid #444;color:#aaa;
        font-size:11px;padding:6px 12px;border-radius:14px;cursor:pointer;
        display:flex;align-items:center;gap:6px;opacity:0;transition:opacity 0.3s;}
      #ndsyncPill.show{opacity:1;}
      #ndsyncPill.signed-in{border-color:#28a745;color:#a5d6a7;}
      #ndsyncPill.signed-in .ndot{background:#28a745;}
      #ndsyncPill.syncing{border-color:#ffd700;color:#ffd700;}
      #ndsyncPill.syncing .ndot{background:#ffd700;animation:ndpulse 0.6s infinite;}
      #ndsyncPill.error{border-color:#cc0000;color:#ff8888;}
      #ndsyncPill.error .ndot{background:#cc0000;}
      #ndsyncPill.offline{border-color:#666;color:#888;}
      #ndsyncPill.offline .ndot{background:#666;}
      @keyframes ndpulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
      .ndot{width:7px;height:7px;border-radius:50%;background:#555;flex-shrink:0;}
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
        padding:10px;margin-bottom:14px;font-size:12px;color:#aaa;line-height:1.6;text-align:left;}
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
    document.head.appendChild(s);
  }

  // ── UI ELEMENTS ─────────────────────────────────────────────────────────────
  function injectPill(){
    if (document.getElementById('ndsyncPill')) return;
    const pill = document.createElement('div');
    pill.id = 'ndsyncPill';
    pill.innerHTML = '<span class="ndot"></span><span id="ndsyncPillText">Not signed in</span>';
    pill.addEventListener('click', () => window.NDSync.openModal());
    document.body.appendChild(pill);
  }

  function injectModal(){
    if (document.getElementById('ndsyncModalBg')) return;
    const bg = document.createElement('div');
    bg.className = 'ndsync-modal-bg';
    bg.id = 'ndsyncModalBg';
    bg.innerHTML = '<div class="ndsync-modal"><h3>☁ Cloud Sync</h3><div id="ndsyncModalBody"></div></div>';
    bg.addEventListener('click', e => { if (e.target === bg) bg.classList.remove('show'); });
    document.body.appendChild(bg);
  }

  function injectMenuItem(){
    const menu = document.querySelector('#menuOverlay .menu');
    if (!menu || document.getElementById('ndsyncMenuItem')) return;
    const item = document.createElement('div');
    item.className = 'menu-item';
    item.id = 'ndsyncMenuItem';
    item.style.cursor = 'pointer';
    item.addEventListener('click', () => window.NDSync.openModal());
    menu.insertBefore(item, menu.firstChild);
    refreshMenuLabel();
  }

  function refreshMenuLabel(){
    const item = document.getElementById('ndsyncMenuItem');
    if (!item) return;
    if (isSignedIn){
      item.style.cssText = 'cursor:pointer;background:#0a1f0a;border:1px solid #28a745;color:#a5d6a7;';
      item.innerHTML = '☁️ Cloud Sync — ' + (userEmail || 'Signed In') +
        '<span style="font-size:11px;color:#69b578;display:block;margin-top:3px;font-weight:400;">Auto-syncing to Google Drive</span>';
    } else {
      item.style.cssText = 'cursor:pointer;';
      item.innerHTML = '☁️ Cloud Sync — Sign in<span style="font-size:11px;color:#888;display:block;margin-top:3px;font-weight:400;font-style:italic;">Tap to sync across devices</span>';
    }
  }

  function showPill(state, text, durMs){
    const pill = document.getElementById('ndsyncPill');
    const textEl = document.getElementById('ndsyncPillText');
    if (!pill || !textEl) return;
    pill.className = 'show' + (state ? ' ' + state : '');
    textEl.textContent = text;
    if (durMs) setTimeout(() => pill.classList.remove('show'), durMs);
  }

  // ── MODAL CONTENT ────────────────────────────────────────────────────────────
  function openModal(){
    const bg   = document.getElementById('ndsyncModalBg');
    const body = document.getElementById('ndsyncModalBody');
    if (!bg || !body) return;

    const lastSync = localStorage.getItem('ndsync_lastSync');
    const syncStr  = lastSync ? new Date(lastSync).toLocaleString() : 'Never';

    if (isSignedIn){
      body.innerHTML = `
        <div class="ndsync-info">
          <strong>✓ Signed in</strong><br>
          <span class="ndsync-email">${userEmail || 'your account'}</span>
        </div>
        <div class="ndsync-info">
          Last sync: ${syncStr}
          ${lastError ? '<br><span style="color:#ff8888;">⚠ ' + lastError + '</span>' : ''}
        </div>
        <div class="ndsync-btn-row">
          <button class="ndsync-action primary" onclick="window.NDSync.syncNow()">⟳ Sync Now</button>
          <button class="ndsync-action danger"  onclick="window.NDSync.signOut()">Sign Out</button>
          <button class="ndsync-action cancel"  onclick="document.getElementById('ndsyncModalBg').classList.remove('show')">Close</button>
        </div>`;
    } else {
      body.innerHTML = `
        <p>Sign in with Google to sync your dispatch data across all devices automatically.</p>
        <div class="ndsync-info">
          <strong>🔒 Your data stays private:</strong><br>
          Saved in YOUR Google Drive only.<br>
          Auto-syncs every 30 seconds.
        </div>
        <div class="ndsync-btn-row">
          <button class="ndsync-action primary" onclick="window.NDSync.signIn()">🔐 Sign in with Google</button>
          <button class="ndsync-action cancel"  onclick="document.getElementById('ndsyncModalBg').classList.remove('show')">Cancel</button>
        </div>`;
    }
    bg.classList.add('show');
  }

  function closeModal(){
    const bg = document.getElementById('ndsyncModalBg');
    if (bg) bg.classList.remove('show');
  }

  // ── GOOGLE IDENTITY SERVICES ─────────────────────────────────────────────────
  function loadGIS(){
    return new Promise((resolve, reject) => {
      if (window.google && window.google.accounts) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load Google Identity Services'));
      document.head.appendChild(s);
    });
  }

  function ensureTokenClient(){
    if (tokenClient) return tokenClient;
    if (!window.google?.accounts?.oauth2) return null;
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: handleTokenResponse,
      error_callback(err){
        if (err.type === 'popup_closed') return;
        logError('OAuth error', err);
        showPill('error', 'Sign-in failed', 4000);
      }
    });
    return tokenClient;
  }

  function handleTokenResponse(resp){
    if (resp.error){
      if (resp.error === 'interaction_required' || resp.error === 'access_denied'){
        log('Silent re-auth needs user interaction');
        return;
      }
      logError('Token error', resp);
      showPill('error', 'Sign-in failed', 4000);
      return;
    }

    const expiresIn = parseInt(resp.expires_in || '3600', 10);

    // Fetch email if not yet known, then finish setup
    const emailStep = userEmail ? Promise.resolve() : fetchUserEmail(resp.access_token);
    emailStep.then(() => {
      saveToken(resp.access_token, expiresIn, userEmail);
      scheduleRefresh();
      refreshMenuLabel();
      closeModal();

      if (!initialPullDone){
        showPill('syncing', 'Setting up sync...', 0);
        return setupAndPull().then(() => pushToDrive());
      } else {
        return pushToDrive();
      }
    }).catch(err => {
      logError('Post-auth setup failed', err);
      showPill('error', 'Setup failed', 5000);
    });
  }

  function fetchUserEmail(token){
    return fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + (token || accessToken) }
    }).then(r => r.json()).then(d => {
      if (d.email){
        userEmail = d.email;
        _rawSet('ndsync_userEmail', userEmail);
        log('Email:', userEmail);
      }
    }).catch(() => {});
  }

  // ── DRIVE API ────────────────────────────────────────────────────────────────
  function driveReq(method, url, body, contentType){
    const headers = { Authorization: 'Bearer ' + accessToken };
    if (contentType) headers['Content-Type'] = contentType;
    return fetch(url, { method, headers, body }).then(r => {
      if (r.status === 401){
        log('Token expired — requesting silent refresh');
        silentRefresh();
        throw new Error('Token expired');
      }
      if (r.status === 204) return null;
      return r.json().then(data => {
        if (!r.ok) throw new Error(data?.error?.message || 'HTTP ' + r.status);
        return data;
      });
    });
  }

  function ensureFolder(){
    if (folderId) return Promise.resolve(folderId);
    if (_persisted.folderId){
      folderId = _persisted.folderId;
      return Promise.resolve(folderId);
    }
    const q = encodeURIComponent(
      `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    return driveReq('GET', `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`)
      .then(data => {
        if (data.files && data.files.length){
          folderId = data.files[0].id;
        } else {
          return driveReq('POST', 'https://www.googleapis.com/drive/v3/files',
            JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
            'application/json'
          ).then(f => { folderId = f.id; });
        }
      }).then(() => {
        _rawSet('ndsync_folderId', folderId);
        log('Folder ready:', folderId);
        return folderId;
      });
  }

  function ensureDataFile(){
    if (driveFileId) return Promise.resolve(driveFileId);
    if (_persisted.fileId){
      driveFileId = _persisted.fileId;
      return Promise.resolve(driveFileId);
    }
    return ensureFolder().then(fid => {
      const q = encodeURIComponent(
        `name='${DATA_FILE}' and '${fid}' in parents and trashed=false`
      );
      return driveReq('GET', `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);
    }).then(data => {
      if (data.files && data.files.length){
        driveFileId = data.files[0].id;
        _rawSet('ndsync_fileId', driveFileId);
        log('Data file found:', driveFileId);
        return driveFileId;
      }
      // Create new data file with current local data
      return uploadFile(null, buildPayload()).then(f => {
        driveFileId = f.id;
        _rawSet('ndsync_fileId', driveFileId);
        log('Data file created:', driveFileId);
        return driveFileId;
      });
    });
  }

  // ── SYNC PAYLOAD ─────────────────────────────────────────────────────────────
  function buildPayload(){
    const payload = { version: 1, device: deviceLabel(), syncedAt: new Date().toISOString(), keys: {} };
    SYNC_KEYS.forEach(k => {
      const val = localStorage.getItem(k);
      if (val !== null){
        payload.keys[k] = {
          value: val,
          updatedAt: localStorage.getItem('ndsync_ts_' + k) || new Date(0).toISOString()
        };
      }
    });
    return payload;
  }

  function applyPayload(payload){
    if (!payload || !payload.keys) return 0;
    let changed = 0;
    SYNC_KEYS.forEach(k => {
      const remote = payload.keys[k];
      if (!remote) return;
      const localTs = localStorage.getItem('ndsync_ts_' + k) || new Date(0).toISOString();
      if (remote.updatedAt > localTs){
        // Write directly, bypassing our intercept (this is incoming data, not an outgoing change)
        _rawSet(k, remote.value);
        _rawSet('ndsync_ts_' + k, remote.updatedAt);
        changed++;
        log('Applied key:', k);
      }
    });
    log('Applied', changed, 'keys from Drive');
    return changed;
  }

  // ── FILE UPLOAD (multipart) ───────────────────────────────────────────────────
  function uploadFile(fileId, data){
    const json     = JSON.stringify(data, null, 2);
    const boundary = 'ndsync_' + Date.now();
    const meta     = JSON.stringify({
      name: DATA_FILE,
      mimeType: 'application/json',
      ...(folderId && !fileId ? { parents: [folderId] } : {})
    });
    const body = [
      '--' + boundary,
      'Content-Type: application/json; charset=UTF-8',
      '',
      meta,
      '--' + boundary,
      'Content-Type: application/json',
      '',
      json,
      '--' + boundary + '--'
    ].join('\r\n');

    const url    = fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    const method = fileId ? 'PATCH' : 'POST';
    return driveReq(method, url, body, `multipart/related; boundary="${boundary}"`);
  }

  // ── PULL & PUSH ───────────────────────────────────────────────────────────────
  function pullFromDrive(){
    if (!tokenValid()) return Promise.resolve(0);
    return ensureDataFile().then(fileId => {
      return fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: 'Bearer ' + accessToken }
      });
    }).then(r => {
      if (!r.ok) throw new Error('Fetch file failed: ' + r.status);
      return r.json();
    }).then(data => {
      const changed = applyPayload(data);
      _rawSet('ndsync_lastSync', new Date().toISOString());
      return changed;
    });
  }

  function pushToDrive(){
    if (!tokenValid() || !initialPullDone || isSyncing) return;
    if (!navigator.onLine){ showPill('offline', 'Offline — queued', 3000); return; }
    isSyncing = true;
    showPill('syncing', 'Syncing...', 0);

    ensureDataFile().then(fileId => uploadFile(fileId, buildPayload()))
      .then(() => {
        lastError = null;
        isSyncing = false;
        _rawSet('ndsync_lastSync', new Date().toISOString());
        showPill('signed-in', '✓ Synced', 3000);
        log('Push complete');
      })
      .catch(err => {
        isSyncing = false;
        logError('Push failed', err);
        showPill('error', 'Sync failed — will retry', 5000);
        // retry once after 60s
        setTimeout(() => { if (isSignedIn && initialPullDone) pushToDrive(); }, 60000);
      });
  }

  function debouncedPush(){
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushToDrive, PUSH_DEBOUNCE);
  }

  // ── FULL SETUP AFTER SIGN-IN ──────────────────────────────────────────────────
  function setupAndPull(){
    return ensureFolder()
      .then(() => ensureDataFile())
      .then(() => pullFromDrive())
      .then(changed => {
        initialPullDone = true;
        if (changed > 0) notifyPageOfPull();
        showPill('signed-in', '✓ Synced', 3000);
        log('Initial sync complete, changed keys:', changed);
      });
  }

  function notifyPageOfPull(){
    document.dispatchEvent(new Event('ndsync:pulled'));
    // Soft-reload page data without a full page refresh
    if (typeof loadData   === 'function') try { loadData();   } catch(e){}
    if (typeof eeRender   === 'function') try { eeRender();   } catch(e){}
    if (typeof renderPage === 'function') try { renderPage(); } catch(e){}
  }

  // ── EVENT LISTENERS ───────────────────────────────────────────────────────────
  window.addEventListener('focus', () => {
    if (!isSignedIn || !navigator.onLine || !initialPullDone) return;
    pullFromDrive().then(changed => {
      if (changed > 0) notifyPageOfPull();
    }).catch(() => {});
  });

  window.addEventListener('online', () => {
    log('Network back online');
    if (isSignedIn && initialPullDone) pushToDrive();
  });

  window.addEventListener('offline', () => {
    showPill('offline', 'Offline', 3000);
  });

  // Legacy event used by some pages when they save data
  document.addEventListener('ndsync:save', () => {
    if (isSignedIn && navigator.onLine && initialPullDone) debouncedPush();
  });

  // ── HELPERS ───────────────────────────────────────────────────────────────────
  function deviceLabel(){
    const ua = navigator.userAgent;
    if (/Mobile|Android/.test(ua)) return 'Mobile';
    if (/iPad|Tablet/.test(ua)) return 'Tablet';
    return 'Desktop';
  }

  // ── PUBLIC API ────────────────────────────────────────────────────────────────
  window.NDSync = {
    signIn(){
      lastError = null;
      showPill('syncing', 'Loading sign-in...', 0);
      loadGIS().then(() => {
        const tc = ensureTokenClient();
        if (tc) tc.requestAccessToken({ prompt: 'select_account' });
      }).catch(err => {
        logError('Sign-in load failed', err);
        showPill('error', 'Sign-in unavailable', 4000);
      });
    },

    signOut(){
      if (accessToken && window.google?.accounts?.oauth2){
        try { window.google.accounts.oauth2.revoke(accessToken, () => {}); } catch(e){}
      }
      clearToken();
      if (pushTimer){ clearTimeout(pushTimer); pushTimer = null; }
      refreshMenuLabel();
      const pill = document.getElementById('ndsyncPill');
      if (pill) pill.classList.remove('show');
      closeModal();
      log('Signed out');
    },

    syncNow(){
      if (!isSignedIn) return;
      closeModal();
      showPill('syncing', 'Syncing...', 0);
      pullFromDrive()
        .then(changed => { if (changed > 0) notifyPageOfPull(); })
        .catch(() => {})
        .finally(() => pushToDrive());
    },

    openModal, closeModal,
    isSignedIn: () => isSignedIn,
    getEmail:   () => userEmail,
    getLastError: () => lastError
  };

  // ── INIT ──────────────────────────────────────────────────────────────────────
  function init(){
    log('Init on', window.location.pathname);
    injectStyles();
    injectPill();
    injectModal();
    injectMenuItem();

    const tokenStillGood = _persisted.token && _persisted.expiry > Date.now() + 60000;

    if (tokenStillGood){
      // Restore full session
      accessToken  = _persisted.token;
      tokenExpiry  = _persisted.expiry;
      userEmail    = _persisted.email;
      folderId     = _persisted.folderId || null;
      driveFileId  = _persisted.fileId   || null;
      isSignedIn   = true;
      refreshMenuLabel();
      showPill('syncing', 'Reconnecting...', 0);

      loadGIS().then(() => {
        ensureTokenClient();
        scheduleRefresh();
        return setupAndPull();
      }).then(() => {
        showPill('signed-in', '✓ Synced', 3000);
      }).catch(err => {
        logError('Resume failed', err);
        // Token might be revoked; try silent re-auth
        silentRefresh();
      });

    } else if (_persisted.email){
      // Token expired but we know who they are; try silent re-auth
      userEmail = _persisted.email;
      isSignedIn = false;
      refreshMenuLabel();
      loadGIS().then(() => {
        ensureTokenClient();
        silentRefresh();
      }).catch(() => { showPill(null, 'Not signed in', 3000); });

    } else {
      showPill(null, 'Not signed in', 3000);
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 100);
  }

})();
