/* ============================================================================
 * Nickey Dispatch — Google Drive Sync (Real Implementation)
 * Pull on load, push on change (30s debounce), pull on focus.
 * One sign-in persists across all pages via localStorage.
 *
 * Record lists (nickeySavedRecords) are MERGE-SAFE: a newer remote file with
 * fewer trips cannot wipe newer local trips. Union-by-id/pickup, then push
 * the combined set. Deletes sync via nickeyDeletedRecordIds tombstones.
 *
 * Immutable Drive snapshots: each successful saved-records push also POSTs a
 * new file nickey-backup-YYYY-MM-DDTHHMMSSZ.json in Nickey Dispatch Data.
 * Those files are never PATCHed. Retention (see NickeyPersist): keep the 30
 * newest OR anything newer than 14 days OR the largest-ever snapshot.
 * Before overwriting the live file, a shrink (>10% or >5 trips) snapshots
 * the current remote and requires an explicit confirm.
 *
 * Google Identity Services (browser token client) only issues ~1 hour access
 * tokens — no refresh token without a server. We keep the stored token and
 * restore it on return. GIS cannot mint a new token in the background (it
 * always needs a tap). After expiry, one tap on the pill/Reconnect is enough;
 * do not force the account picker or auto-open the sign-in modal.
 * ============================================================================ */

(function(){
  'use strict';

  const CLIENT_ID     = '1067375485374-cn97feb2m9bj4fr067uab62d0p1j4qkk.apps.googleusercontent.com';
  // drive.file = files this app creates (main sync file). drive = read/write the
  // Grok-created nickey-bot-inbox.json sibling. userinfo.email = account label.
  const SCOPES        = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email';
  const FOLDER_NAME   = 'Nickey Dispatch Data';
  const DATA_FILE     = 'nickey-dispatch-data.json';
  const BACKUP_PREFIX = 'nickey-backup-';
  const PUSH_DEBOUNCE = 30000;   // ms between auto-pushes
  const TOKEN_BUFFER  = 120000;  // warn this long before hard expiry (GIS has no refresh token)

  const SYNC_KEYS = [
    'nickeySavedRecords', 'nickeyDeletedRecordIds', 'weeklyDeductions', 'fuelStations', 'currentDriver',
    'nickeyInspectionHistory', 'nickeyLatestInspection', 'nickeyIntermodalHistory',
    'nickeyDraftLoad', 'nickeyTrailerInspectionDraft', 'nickeyIntermodalDraft',
    'exportFormat', 'nickeyCustomers', 'geminiApiKey', 'nickeyDispatchFormState',
    'nickeyContacts', 'nickeyCustomSDS'
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
  let silentRefreshPending = false;
  let reconnectNeeded = false;
  let refreshTimer = null;
  let pendingShrink = null;   // { remoteCount, localCount } when overwrite is blocked
  let initialRemoteSnapDone = false;

  function safeGet(key){
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  // Restore persisted session values (used in init, not yet validated)
  const _persisted = {
    token:    safeGet('ndsync_accessToken'),
    expiry:   parseInt(safeGet('ndsync_tokenExpiry') || '0', 10),
    email:    safeGet('ndsync_userEmail'),
    folderId: safeGet('ndsync_folderId'),
    fileId:   safeGet('ndsync_fileId')
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
  function loginHint(){
    return userEmail || _persisted.email || safeGet('ndsync_loginHint') || '';
  }

  function saveToken(token, expiresInSec, email){
    accessToken  = token;
    tokenExpiry  = Date.now() + expiresInSec * 1000;
    userEmail    = email || userEmail;
    isSignedIn   = true;
    reconnectNeeded = false;
    _rawSet('ndsync_accessToken',  token);
    _rawSet('ndsync_tokenExpiry',  String(tokenExpiry));
    if (userEmail) _rawSet('ndsync_userEmail', userEmail);
    log('Token saved, expires in', expiresInSec + 's');
  }

  function clearToken(){
    accessToken = null; tokenExpiry = 0; userEmail = null;
    isSignedIn = false; folderId = null; driveFileId = null;
    initialPullDone = false;
    reconnectNeeded = false;
    ['ndsync_accessToken','ndsync_tokenExpiry','ndsync_userEmail',
     'ndsync_folderId','ndsync_fileId'].forEach(k => {
      try { localStorage.removeItem(k); } catch (e) {}
    });
  }

  // Still send this token to Drive (until hard expiry)
  function tokenUsable(){
    return !!(accessToken && Date.now() < tokenExpiry);
  }

  // Fresh enough that we do not yet ask for a renew tap
  function tokenValid(){
    return !!(accessToken && Date.now() < tokenExpiry - TOKEN_BUFFER);
  }

  function markNeedsReconnect(reason){
    reconnectNeeded = true;
    silentRefreshPending = false;
    const dead = reason === 'Drive 401' || !tokenUsable();
    if (dead) {
      isSignedIn = false;
      accessToken = null;
      tokenExpiry = 0;
      try {
        localStorage.removeItem('ndsync_accessToken');
        localStorage.removeItem('ndsync_tokenExpiry');
      } catch (e) {}
    }
    refreshMenuLabel();
    showPill(null, loginHint() ? '🔑 Tap to reconnect' : '🔑 Sign in to sync');
    log('Reconnect needed', reason || '');
  }

  function scheduleRefresh(){
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    if (!tokenExpiry) return;
    const delay = tokenExpiry - Date.now() - TOKEN_BUFFER;
    const wait = delay > 0 ? delay : (tokenExpiry > Date.now() ? 2000 : 0);
    if (wait <= 0) {
      markNeedsReconnect('token expired');
      return;
    }
    // GIS always opens a popup — never call requestAccessToken from a timer.
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (tokenUsable()) {
        reconnectNeeded = true;
        showPill('syncing', 'Tap to keep Drive sync', 0);
        log('Access token near expiry — waiting for a tap (GIS has no refresh token)');
      } else {
        markNeedsReconnect('token expired');
      }
    }, wait);
  }

  function requestToken(opts){
    opts = opts || {};
    const tc = ensureTokenClient();
    if (!tc) return false;
    const hint = loginHint();
    silentRefreshPending = true;
    const forcePicker = !!opts.forcePicker || (!hint && !opts.silent);
    tc.requestAccessToken({
      prompt: forcePicker ? 'select_account' : '',
      ...(hint ? { login_hint: hint } : {})
    });
    refreshMenuLabel();
    return true;
  }

  function silentRefresh(){
    // GIS cannot refresh in the background on Chrome/PWA. Keep the name for
    // older call sites; only run if a token client exists and we are not already pending.
    if (!tokenClient || silentRefreshPending) return;
    requestToken({ silent: true });
  }

  // ── localStorage INTERCEPT ──────────────────────────────────────────────────
  // Patch setItem so any write to a SYNC_KEY automatically timestamps + queues push.
  // _rawSet bypasses the patch (used internally to avoid loops).
  const _rawSet = localStorage.setItem.bind(localStorage);

  localStorage.setItem = function(key, value){
    try {
      _rawSet(key, value);
    } catch (e) {
      logError('localStorage.setItem failed for ' + key, e);
      if (window.NickeyPersist && typeof NickeyPersist.reportWriteError === 'function') {
        NickeyPersist.reportWriteError(key, e);
      }
      throw e;
    }
    if (SYNC_KEY_SET.has(key)){
      try { _rawSet('ndsync_ts_' + key, new Date().toISOString()); } catch (e) {}
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
        display:flex;align-items:center;gap:6px;opacity:1;transition:opacity 0.3s;}
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
      .ndsync-warn{background:#2a0a0a;border:1px solid #cc0000;border-radius:8px;
        padding:10px;margin-bottom:14px;font-size:13px;color:#ffb0b0;line-height:1.5;text-align:left;}
      .ndsync-backup-list{max-height:46vh;overflow-y:auto;text-align:left;margin-bottom:12px;}
      .ndsync-backup-item{display:block;width:100%;background:#1a1a1a;border:1px solid #444;
        color:#ddd;border-radius:8px;padding:10px 12px;margin-bottom:8px;cursor:pointer;
        font-size:13px;text-align:left;font-family:'Source Sans 3',sans-serif;}
      .ndsync-backup-item:hover{border-color:#ffd700;}
      .ndsync-backup-item .meta{color:#888;font-size:11px;margin-top:3px;}
    `;
    document.head.appendChild(s);
  }

  // ── UI ELEMENTS ─────────────────────────────────────────────────────────────
  function injectPill(){
    if (document.getElementById('ndsyncPill')) return;
    const pill = document.createElement('div');
    pill.id = 'ndsyncPill';
    pill.innerHTML = '<span class="ndot"></span><span id="ndsyncPillText">Not signed in</span>';
    pill.addEventListener('click', () => {
      // One tap to renew when Google's token expired — user gesture lets GIS open.
      if (reconnectNeeded && loginHint() && !tokenUsable()) {
        lastError = null;
        showPill('syncing', 'Reconnecting...', 0);
        loadGIS().then(() => {
          ensureTokenClient();
          if (!requestToken({ silent: false })) {
            window.NDSync.openModal();
          }
        }).catch(() => window.NDSync.openModal());
        return;
      }
      window.NDSync.openModal();
    });
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
    item.addEventListener('click', () => {
      if (reconnectNeeded && loginHint() && !tokenUsable()) {
        lastError = null;
        showPill('syncing', 'Reconnecting...', 0);
        loadGIS().then(() => {
          ensureTokenClient();
          requestToken({ silent: false });
        }).catch(() => window.NDSync.openModal());
        return;
      }
      window.NDSync.openModal();
    });
    menu.insertBefore(item, menu.firstChild);
    injectBackupMenuItems(menu, item);
    refreshMenuLabel();
  }

  function injectBackupMenuItems(menu, afterNode) {
    if (document.getElementById('ndsyncExportMenuItem') || document.getElementById('nickeyExportMenuItem')) return;
    function addItem(id, html, handler) {
      const el = document.createElement('div');
      el.className = 'menu-item';
      el.id = id;
      el.style.cursor = 'pointer';
      el.innerHTML = html;
      el.addEventListener('click', handler);
      if (afterNode && afterNode.nextSibling) menu.insertBefore(el, afterNode.nextSibling);
      else menu.appendChild(el);
      afterNode = el;
    }
    addItem('ndsyncExportMenuItem',
      '📦 Export backup<span style="font-size:11px;color:#888;display:block;margin-top:3px;font-weight:400;">Download Saved Records JSON to this phone</span>',
      () => { closeMenuIfOpen(); persistExport(); });
    addItem('ndsyncImportMenuItem',
      '📥 Import backup<span style="font-size:11px;color:#888;display:block;margin-top:3px;font-weight:400;">Merge a JSON backup — never wipes trips</span>',
      () => { closeMenuIfOpen(); persistImport(); });
    addItem('ndsyncRestoreMenuItem',
      '☁️ Restore from Drive backup<span style="font-size:11px;color:#888;display:block;margin-top:3px;font-weight:400;">List nickey-backup-*.json and merge one</span>',
      () => { closeMenuIfOpen(); openBackupRestore(); });
  }

  function closeMenuIfOpen() {
    const overlay = document.getElementById('menuOverlay');
    if (!overlay) return;
    if (typeof window.toggleMenu === 'function' && overlay.style.display === 'flex') {
      window.toggleMenu();
    } else {
      overlay.style.display = 'none';
      document.body.classList.remove('nd-menu-open');
    }
  }

  function persistExport() {
    if (window.NickeyPersist && NickeyPersist.exportBackupDownload) {
      NickeyPersist.exportBackupDownload();
    }
  }

  function persistImport() {
    if (window.NickeyPersist && NickeyPersist.pickImportFile) {
      NickeyPersist.pickImportFile();
    }
  }

  function refreshMenuLabel(){
    const item = document.getElementById('ndsyncMenuItem');
    if (!item) return;
    const knownEmail = loginHint();
    if (isSignedIn && tokenUsable()){
      item.style.cssText = 'cursor:pointer;background:#0a1f0a;border:1px solid #28a745;color:#a5d6a7;';
      item.innerHTML = '☁️ Cloud Sync — ' + (knownEmail || 'Signed In') +
        '<span style="font-size:11px;color:#69b578;display:block;margin-top:3px;font-weight:400;">Auto-syncing to Google Drive</span>';
    } else if (silentRefreshPending && knownEmail){
      item.style.cssText = 'cursor:pointer;background:#0a1a2a;border:1px solid #4a90e2;color:#a5c8f0;';
      item.innerHTML = '☁️ Cloud Sync — ' + knownEmail +
        '<span style="font-size:11px;color:#4a90e2;display:block;margin-top:3px;font-weight:400;">🔄 Reconnecting...</span>';
    } else if (reconnectNeeded && knownEmail){
      item.style.cssText = 'cursor:pointer;background:#0a1a2a;border:1px solid #4a90e2;color:#a5c8f0;';
      item.innerHTML = '☁️ Cloud Sync — ' + knownEmail +
        '<span style="font-size:11px;color:#4a90e2;display:block;margin-top:3px;font-weight:400;">Tap to reconnect Drive</span>';
    } else {
      item.style.cssText = 'cursor:pointer;';
      item.innerHTML = '☁️ Cloud Sync — Sign in<span style="font-size:11px;color:#888;display:block;margin-top:3px;font-weight:400;font-style:italic;">Tap to sync across devices</span>';
    }
  }

  function showPill(state, text){
    const pill = document.getElementById('ndsyncPill');
    const textEl = document.getElementById('ndsyncPillText');
    if (!pill || !textEl) return;
    pill.className = 'show' + (state ? ' ' + state : '');
    textEl.textContent = text;
  }

  // ── MODAL CONTENT ────────────────────────────────────────────────────────────
  function openModal(){
    const bg   = document.getElementById('ndsyncModalBg');
    const body = document.getElementById('ndsyncModalBody');
    if (!bg || !body) return;

    const lastSync = localStorage.getItem('ndsync_lastSync');
    const syncStr  = lastSync ? new Date(lastSync).toLocaleString() : 'Never';

    if (isSignedIn && tokenUsable()){
      const shrinkHtml = pendingShrink ? `
        <div class="ndsync-warn">
          <strong>⚠ Sync paused — remote would shrink</strong><br>
          Remote has ${pendingShrink.remoteCount} trips, local has ${pendingShrink.localCount}.
          A snapshot of the remote file was saved first. Continue only if you really want the live file to match this phone.
        </div>` : '';
      const lastBak = localStorage.getItem('ndsync_lastBackupAt');
      const bakStr = lastBak ? new Date(lastBak).toLocaleString() : 'None yet';
      body.innerHTML = `
        <div class="ndsync-info">
          <strong>✓ Signed in</strong><br>
          <span class="ndsync-email">${userEmail || 'your account'}</span>
        </div>
        ${shrinkHtml}
        <div class="ndsync-info">
          Last sync: ${syncStr}
          <br>Last Drive snapshot: ${bakStr}
          ${lastError ? '<br><span style="color:#ff8888;">⚠ ' + lastError + '</span>' : ''}
          <br><span style="color:#888;">Google keeps this phone's Drive token for about 1 hour. Leaving and coming back within that hour stays signed in.</span>
        </div>
        <div class="ndsync-btn-row">
          ${pendingShrink
            ? '<button class="ndsync-action danger" onclick="window.NDSync.confirmShrinkPush()">Overwrite live file (' + pendingShrink.localCount + ' trips)</button>'
            : '<button class="ndsync-action primary" onclick="window.NDSync.syncNow()">⟳ Sync Now</button>'}
          <button class="ndsync-action cancel" onclick="window.NDSync.backupNow()">📦 Backup to Drive now</button>
          <button class="ndsync-action cancel" onclick="window.NDSync.openBackupRestore()">☁️ Restore from Drive backup</button>
          <button class="ndsync-action cancel" onclick="window.NDSync.exportBackup()">📦 Export backup</button>
          <button class="ndsync-action cancel" onclick="window.NDSync.importBackup()">📥 Import backup</button>
          <button class="ndsync-action cancel" onclick="window.NickeyBotDrive&&NickeyBotDrive.pullNow()">⬇ Pull bot trips</button>
          <button class="ndsync-action danger"  onclick="window.NDSync.signOut()">Sign Out</button>
          <button class="ndsync-action cancel"  onclick="document.getElementById('ndsyncModalBg').classList.remove('show')">Close</button>
        </div>`;
    } else {
      const hint = loginHint();
      body.innerHTML = hint ? `
        <p>Welcome back — tap Reconnect to restore Cloud Sync.</p>
        <div class="ndsync-info">
          <strong>${hint}</strong><br>
          Google's in-browser Drive token lasts about 1 hour (no refresh token without a server). After that, one tap is enough — you usually will not need to pick the account again if this phone is still signed into Google.
        </div>
        <div class="ndsync-btn-row">
          <button class="ndsync-action primary" onclick="window.NDSync.signIn()">🔐 Reconnect</button>
          <button class="ndsync-action cancel" onclick="window.NDSync.signIn(true)">Use a different account</button>
          <button class="ndsync-action cancel" onclick="window.NDSync.exportBackup()">📦 Export backup</button>
          <button class="ndsync-action cancel" onclick="window.NDSync.importBackup()">📥 Import backup</button>
          <button class="ndsync-action cancel"  onclick="document.getElementById('ndsyncModalBg').classList.remove('show')">Cancel</button>
        </div>` : `
        <p>Sign in with Google to sync your dispatch data across all devices automatically.</p>
        <div class="ndsync-info">
          <strong>🔒 Your data stays private:</strong><br>
          Saved in YOUR Google Drive only.<br>
          Auto-syncs every 30 seconds.<br>
          Also reads <strong>nickey-bot-inbox.json</strong> that Grok writes — never overwrites the main sync file from the bot.
        </div>
        <div class="ndsync-btn-row">
          <button class="ndsync-action primary" onclick="window.NDSync.signIn()">🔐 Sign in with Google</button>
          <button class="ndsync-action cancel" onclick="window.NDSync.exportBackup()">📦 Export backup</button>
          <button class="ndsync-action cancel" onclick="window.NDSync.importBackup()">📥 Import backup</button>
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
    const hint = loginHint();
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      prompt: '',
      login_hint: hint || undefined,
      callback: handleTokenResponse,
      error_callback(err){
        silentRefreshPending = false;
        const type = (err && err.type) || '';
        if (type === 'popup_closed') {
          if (!tokenUsable()) markNeedsReconnect('popup closed');
          else refreshMenuLabel();
          return;
        }
        if (type === 'popup_failed_to_open') {
          log('GIS popup blocked — expected without a tap in PWA/Chrome');
          if (tokenUsable()) {
            isSignedIn = true;
            refreshMenuLabel();
            showPill('signed-in', '✓ Synced', 3000);
            return;
          }
          markNeedsReconnect('popup blocked');
          return;
        }
        logError('OAuth error', err);
        if (tokenUsable()) {
          isSignedIn = true;
          refreshMenuLabel();
          return;
        }
        showPill('error', 'Sign-in failed', 4000);
        markNeedsReconnect('oauth error');
      }
    });
    return tokenClient;
  }

  function handleTokenResponse(resp){
    silentRefreshPending = false;
    if (resp.error){
      if (resp.error === 'interaction_required' || resp.error === 'access_denied'){
        log('Token request needs user interaction', resp.error);
        if (tokenUsable()) {
          isSignedIn = true;
          reconnectNeeded = false;
          refreshMenuLabel();
          showPill('signed-in', '✓ Synced', 3000);
          return;
        }
        markNeedsReconnect(resp.error);
        return;
      }
      logError('Token error', resp);
      if (tokenUsable()) {
        refreshMenuLabel();
        showPill('signed-in', '✓ Still signed in', 3000);
        return;
      }
      markNeedsReconnect('token error');
      return;
    }

    reconnectNeeded = false;
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
        _rawSet('ndsync_loginHint', userEmail);  // persists across sign-out for seamless re-auth
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
        log('Token rejected by Drive');
        markNeedsReconnect('Drive 401');
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
    const P = window.NickeyPersist;
    const remoteTombs = payload.keys.nickeyDeletedRecordIds
      ? (P ? P.parseTombstones(payload.keys.nickeyDeletedRecordIds.value) : [])
      : [];
    const ctx = { localTombs: P ? P.loadTombstones() : [], remoteTombs: remoteTombs };

    SYNC_KEYS.forEach(k => {
      const remote = payload.keys[k];
      if (!remote) return;
      const localVal = localStorage.getItem(k);
      const localTs = localStorage.getItem('ndsync_ts_' + k) || new Date(0).toISOString();
      let nextVal = null;
      let nextTs = remote.updatedAt;
      let keyChanged = false;

      if (P && typeof P.mergeSyncKey === 'function') {
        const merged = P.mergeSyncKey(k, localVal, localTs, remote.value, remote.updatedAt, ctx);
        nextVal = merged.value;
        nextTs = merged.ts || remote.updatedAt;
        keyChanged = !!merged.changed;
        if (merged.tombstones) ctx.localTombs = merged.tombstones;
      } else if (remote.updatedAt > localTs) {
        nextVal = remote.value;
        keyChanged = true;
      }

      if (keyChanged && nextVal != null) {
        _rawSet(k, nextVal);
        _rawSet('ndsync_ts_' + k, nextTs || remote.updatedAt);
        changed++;
        log('Merged key:', k);
      }
    });
    log('Applied', changed, 'keys from Drive');
    return changed;
  }

  // ── FILE UPLOAD (multipart) ───────────────────────────────────────────────────
  // fileId set → PATCH that file (live nickey-dispatch-data.json only).
  // fileId null → POST a brand-new file. Snapshots always POST so they are
  // never overwritten.
  function uploadFile(fileId, data, opts){
    opts = opts || {};
    const json     = JSON.stringify(data, null, 2);
    const boundary = 'ndsync_' + Date.now();
    const meta     = JSON.stringify({
      name: opts.name || DATA_FILE,
      mimeType: 'application/json',
      ...(opts.description ? { description: opts.description } : {}),
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

  function downloadFileJson(fileId){
    return fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: 'Bearer ' + accessToken }
    }).then(r => {
      if (r.status === 401) {
        markNeedsReconnect('Drive 401');
        throw new Error('Token expired');
      }
      if (!r.ok) throw new Error('Fetch file failed: ' + r.status);
      return r.json();
    });
  }

  function persistApi(){
    return window.NickeyPersist || null;
  }

  function tripCountOf(payload){
    const P = persistApi();
    return P && typeof P.countTripsInPayload === 'function' ? P.countTripsInPayload(payload) : 0;
  }

  function wrapSnapshotPayload(payload, reason, count){
    const copy = payload && typeof payload === 'object' ? payload : { version: 1, keys: {} };
    return Object.assign({}, copy, {
      kind: 'nickey-snapshot',
      snapshotAt: new Date().toISOString(),
      snapshotReason: reason || 'push',
      tripCount: count
    });
  }

  function createSnapshot(payload, opts){
    opts = opts || {};
    const P = persistApi();
    const count = tripCountOf(payload);
    const fp = P && P.recordsFingerprint ? P.recordsFingerprint(payload) : '';
    if (opts.skipIfUnchanged && fp && fp === safeGet('ndsync_lastBackupHash')) {
      log('Snapshot skipped — saved records unchanged');
      return Promise.resolve(null);
    }
    const name = (P && P.backupFileName) ? P.backupFileName() : (BACKUP_PREFIX + Date.now() + 'Z.json');
    const snap = wrapSnapshotPayload(payload, opts.reason, count);
    return ensureFolder().then(() => uploadFile(null, snap, {
      name: name,
      description: 'nickey-snapshot trips:' + count
    })).then(f => {
      if (fp) _rawSet('ndsync_lastBackupHash', fp);
      _rawSet('ndsync_lastBackupAt', new Date().toISOString());
      log('Snapshot created', name, f && f.id);
      return f;
    });
  }

  function listBackupFiles(){
    return ensureFolder().then(fid => {
      const q = encodeURIComponent(
        `name contains '${BACKUP_PREFIX}' and '${fid}' in parents and trashed=false`
      );
      return driveReq('GET',
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime,modifiedTime,size,description)&orderBy=createdTime desc&pageSize=100`);
    }).then(data => {
      const P = persistApi();
      const files = (data && data.files) || [];
      return files.filter(f => !P || !P.isBackupFileName || P.isBackupFileName(f.name));
    });
  }

  function pruneSnapshots(){
    const P = persistApi();
    if (!P || typeof P.selectSnapshotsToKeep !== 'function') return Promise.resolve();
    return listBackupFiles().then(files => {
      const plan = P.selectSnapshotsToKeep(files, Date.now());
      if (!plan.trash || !plan.trash.length) return;
      log('Pruning', plan.trash.length, 'old snapshots; keeping', plan.keep.length);
      const jobs = plan.trash.map(f => {
        if (!f.id || (P.isBackupFileName && !P.isBackupFileName(f.name))) return Promise.resolve();
        return driveReq('PATCH',
          'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(f.id),
          JSON.stringify({ trashed: true }),
          'application/json'
        ).catch(err => logError('Could not trash snapshot ' + f.name, err));
      });
      return Promise.all(jobs);
    }).catch(err => {
      logError('Snapshot prune failed', err);
    });
  }

  function formatBackupLabel(file){
    const when = file.createdTime ? new Date(file.createdTime).toLocaleString() : '';
    const P = persistApi();
    const trips = P && P.parseSnapshotTripCount ? P.parseSnapshotTripCount(file) : 0;
    const kb = file.size ? (Math.round(parseInt(file.size, 10) / 102) / 10) + ' KB' : '';
    const bits = [when, trips ? trips + ' trips' : '', kb].filter(Boolean);
    return bits.join(' · ');
  }

  function openBackupRestore(){
    if (!tokenUsable()) {
      openModal();
      return;
    }
    const bg   = document.getElementById('ndsyncModalBg');
    const body = document.getElementById('ndsyncModalBody');
    if (!bg || !body) return;
    body.innerHTML = `
      <div class="ndsync-info">Loading Drive snapshots…</div>
      <div class="ndsync-btn-row">
        <button class="ndsync-action cancel" onclick="window.NDSync.openModal()">Back</button>
      </div>`;
    bg.classList.add('show');
    listBackupFiles().then(files => {
      if (!files.length) {
        body.innerHTML = `
          <div class="ndsync-info">No <strong>nickey-backup-*.json</strong> files in Nickey Dispatch Data yet. Sync or tap Backup to Drive now to create the first snapshot.</div>
          <div class="ndsync-btn-row">
            <button class="ndsync-action primary" onclick="window.NDSync.backupNow()">📦 Backup to Drive now</button>
            <button class="ndsync-action cancel" onclick="window.NDSync.openModal()">Back</button>
          </div>`;
        return;
      }
      const items = files.map(f => {
        const id = String(f.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
        const name = String(f.name || '').replace(/[<>&]/g, '');
        return `<button type="button" class="ndsync-backup-item" data-id="${id}">
          ${name}<div class="meta">${formatBackupLabel(f)}</div></button>`;
      }).join('');
      body.innerHTML = `
        <p>Tap a snapshot to <strong>merge</strong> it into Saved Records (never wipes current trips).</p>
        <div class="ndsync-backup-list">${items}</div>
        <div class="ndsync-btn-row">
          <button class="ndsync-action cancel" onclick="window.NDSync.openModal()">Back</button>
        </div>`;
      body.querySelectorAll('.ndsync-backup-item').forEach(btn => {
        btn.addEventListener('click', () => restoreBackup(btn.getAttribute('data-id')));
      });
    }).catch(err => {
      logError('List backups failed', err);
      body.innerHTML = `
        <div class="ndsync-warn">Could not list Drive backups: ${lastError || err.message}</div>
        <div class="ndsync-btn-row">
          <button class="ndsync-action cancel" onclick="window.NDSync.openModal()">Back</button>
        </div>`;
    });
  }

  function restoreBackup(fileId){
    if (!fileId || !tokenUsable()) return;
    const body = document.getElementById('ndsyncModalBody');
    if (body) body.innerHTML = '<div class="ndsync-info">Downloading snapshot…</div>';
    downloadFileJson(fileId).then(data => {
      const P = persistApi();
      if (!P || typeof P.importBackupMerge !== 'function') {
        throw new Error('Backup import is not available');
      }
      const parsed = P.parseBackupFile(data);
      if (!parsed.ok) throw new Error(parsed.error);
      const when = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString() : 'this snapshot';
      const ok = confirm('Restore from Drive backup (' + when + ')?\n\n' +
        parsed.tripCount + ' trip(s) in this file.\n\n' +
        'This MERGES into Saved Records — existing trips are not wiped.');
      if (!ok) {
        openBackupRestore();
        return null;
      }
      const wr = P.importBackupMerge(data);
      if (!wr.ok) throw new Error(wr.error || 'Merge failed');
      notifyPageOfPull();
      closeModal();
      showPill('signed-in', '✓ Restored ' + wr.count + ' trips', 4000);
      if (P.showToast) P.showToast('Merged Drive backup — ' + wr.count + ' trip(s) saved', false);
      pendingShrink = null;
      return pushToDrive();
    }).catch(err => {
      if (!err) return;
      logError('Restore failed', err);
      if (body) {
        body.innerHTML = `
          <div class="ndsync-warn">Restore failed: ${lastError || err.message}</div>
          <div class="ndsync-btn-row">
            <button class="ndsync-action cancel" onclick="window.NDSync.openBackupRestore()">Back</button>
          </div>`;
      }
    });
  }

  // ── PULL & PUSH ───────────────────────────────────────────────────────────────
  function pullFromDrive(){
    if (!tokenUsable()) return Promise.resolve(0);
    return ensureDataFile().then(fileId => downloadFileJson(fileId)).then(data => {
      const firstSnap = (!initialRemoteSnapDone && !safeGet('ndsync_didInitialSnapshot') && data)
        ? createSnapshot(data, { reason: 'initial-remote', skipIfUnchanged: false })
            .then(() => {
              initialRemoteSnapDone = true;
              _rawSet('ndsync_didInitialSnapshot', '1');
            })
            .catch(err => logError('Initial remote snapshot failed', err))
        : Promise.resolve();
      const changed = applyPayload(data);
      _rawSet('ndsync_lastSync', new Date().toISOString());
      // Merged records were written with _rawSet (no intercept). Push the
      // union so a smaller remote file cannot stay canonical on Drive.
      if (changed > 0 && initialPullDone) debouncedPush();
      return firstSnap.then(() => changed);
    });
  }

  function pushToDrive(opts){
    opts = opts || {};
    if (!tokenUsable() || !initialPullDone) return Promise.resolve();
    if (isSyncing) return Promise.resolve();
    if (!navigator.onLine){ showPill('offline', 'Offline — queued', 3000); return Promise.resolve(); }
    if (pendingShrink && !opts.confirmShrink){
      showPill('error', '⚠ Shrink blocked — tap Cloud Sync');
      return Promise.resolve({ blocked: true });
    }
    isSyncing = true;
    showPill('syncing', 'Syncing...', 0);

    const payload = buildPayload();
    const P = persistApi();

    return ensureDataFile()
      .then(fileId => downloadFileJson(fileId).catch(() => null).then(remote => ({ fileId, remote })))
      .then(({ fileId, remote }) => {
        const localCount = tripCountOf(payload);
        const remoteCount = tripCountOf(remote);
        const shrink = !!(P && typeof P.shouldWarnShrink === 'function' &&
          P.shouldWarnShrink(localCount, remoteCount));

        const preSnap = (shrink && remote)
          ? createSnapshot(remote, { reason: 'pre-shrink', skipIfUnchanged: false })
          : Promise.resolve(null);

        return preSnap.then(() => {
          if (shrink && !opts.confirmShrink){
            pendingShrink = { remoteCount: remoteCount, localCount: localCount };
            lastError = 'Remote has ' + remoteCount + ' trips, local has ' + localCount + ' — continue?';
            log('Push blocked to protect remote history', pendingShrink);
            return { blocked: true };
          }
          return uploadFile(fileId, payload).then(() => {
            pendingShrink = null;
            return createSnapshot(payload, {
              reason: opts.reason || 'post-push',
              skipIfUnchanged: !opts.forceBackup
            }).then(() => pruneSnapshots()).catch(err => {
              logError('Snapshot failed after live push', err);
            });
          });
        });
      })
      .then(result => {
        isSyncing = false;
        if (result && result.blocked){
          showPill('error', '⚠ Shrink blocked — tap Cloud Sync');
          return result;
        }
        lastError = null;
        _rawSet('ndsync_lastSync', new Date().toISOString());
        showPill('signed-in', '✓ Synced', 3000);
        log('Push complete');
        return result;
      })
      .catch(err => {
        isSyncing = false;
        logError('Push failed', err);
        showPill('error', 'Sync failed — will retry', 5000);
        setTimeout(() => {
          if (isSignedIn && initialPullDone && !pendingShrink) pushToDrive();
        }, 60000);
      });
  }

  function backupNow(){
    if (!tokenUsable()){
      openModal();
      return Promise.resolve();
    }
    closeModal();
    showPill('syncing', 'Saving Drive snapshot...', 0);
    return ensureFolder()
      .then(() => createSnapshot(buildPayload(), { reason: 'manual', skipIfUnchanged: false }))
      .then(f => {
        lastError = null;
        showPill('signed-in', '✓ Snapshot saved', 4000);
        log('Manual snapshot', f && f.id);
        return pruneSnapshots();
      })
      .catch(err => {
        logError('Manual snapshot failed', err);
        showPill('error', 'Snapshot failed', 5000);
      });
  }

  function confirmShrinkPush(){
    const p = pendingShrink;
    if (!p){
      closeModal();
      return pushToDrive();
    }
    const ok = confirm('Remote has ' + p.remoteCount + ' trips, local has ' + p.localCount +
      ' — continue?\n\nA snapshot of the remote file was already saved in Drive. Overwrite the live sync file with this phone\'s ' +
      p.localCount + ' trip(s)?');
    if (!ok) return;
    closeModal();
    return pushToDrive({ confirmShrink: true });
  }

  function debouncedPush(){
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => pushToDrive(), PUSH_DEBOUNCE);
  }

  // ── FULL SETUP AFTER SIGN-IN ──────────────────────────────────────────────────
  function setupAndPull(){
    return ensureFolder()
      .then(() => ensureDataFile())
      .then(() => pullFromDrive())
      .then(changed => {
        initialPullDone = true;
        if (changed > 0) notifyPageOfPull();
        document.dispatchEvent(new Event('ndsync:ready'));
        showPill('signed-in', '✓ Synced', 3000);
        log('Initial sync complete, changed keys:', changed);
      });
  }

  function notifyPageOfPull(){
    document.dispatchEvent(new Event('ndsync:pulled'));
    // Soft-reload page data without a full page refresh so in-memory
    // savedRecords cannot overwrite a merged Drive pull on the next save.
    if (typeof loadSavedRecords === 'function') try { loadSavedRecords(); } catch(e){}
    if (typeof renderSavedRecordsBody === 'function') {
      try {
        var ov = document.getElementById('savedRecordsOverlay');
        if (ov && ov.style.display === 'flex') renderSavedRecordsBody();
      } catch(e){}
    }
    if (typeof loadData   === 'function') try { loadData();   } catch(e){}
    if (typeof eeRender   === 'function') try { eeRender();   } catch(e){}
    if (typeof renderPage === 'function') try { renderPage(); } catch(e){}
  }

  // ── EVENT LISTENERS ───────────────────────────────────────────────────────────
  function onAppVisible(){
    if (!navigator.onLine) return;
    if (tokenUsable() && initialPullDone) {
      pullFromDrive().then(changed => {
        if (changed > 0) notifyPageOfPull();
      }).catch(() => {});
      return;
    }
    if (loginHint() && !tokenUsable()) {
      reconnectNeeded = true;
      refreshMenuLabel();
      showPill(null, '🔑 Tap to reconnect');
    }
  }

  window.addEventListener('focus', onAppVisible);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onAppVisible();
  });
  window.addEventListener('pageshow', onAppVisible);

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
    signIn(forcePicker){
      lastError = null;
      reconnectNeeded = false;
      showPill('syncing', 'Loading sign-in...', 0);
      loadGIS().then(() => {
        ensureTokenClient();
        requestToken({ forcePicker: !!forcePicker });
      }).catch(err => {
        logError('Sign-in load failed', err);
        showPill('error', 'Sign-in unavailable', 4000);
      });
    },

    signOut(){
      if (accessToken && window.google?.accounts?.oauth2){
        try { window.google.accounts.oauth2.revoke(accessToken, () => {}); } catch(e){}
      }
      if (refreshTimer){ clearTimeout(refreshTimer); refreshTimer = null; }
      pendingShrink = null;
      clearToken();
      if (pushTimer){ clearTimeout(pushTimer); pushTimer = null; }
      refreshMenuLabel();
      showPill(null, 'Not signed in');
      closeModal();
      log('Signed out');
    },

    syncNow(){
      if (!isSignedIn) return;
      if (pendingShrink){
        openModal();
        return;
      }
      closeModal();
      showPill('syncing', 'Syncing...', 0);
      pullFromDrive()
        .then(changed => { if (changed > 0) notifyPageOfPull(); })
        .catch(() => {})
        .finally(() => pushToDrive());
    },

    backupNow,
    openBackupRestore,
    restoreBackup,
    confirmShrinkPush,
    exportBackup: persistExport,
    importBackup: persistImport,

    openModal, closeModal,
    isSignedIn: () => !!(isSignedIn && tokenUsable()),
    isReady:    () => !!(isSignedIn && initialPullDone && tokenUsable()),
    getEmail:   () => userEmail,
    getLastError: () => lastError,
    getAccessToken: () => accessToken,
    tokenValid,
    tokenUsable,
    getFolderId: () => folderId,
    ensureFolder,
    adoptToken(token, expiresInSec, email){
      if (!token) return;
      saveToken(token, expiresInSec || 3600, email);
      scheduleRefresh();
      refreshMenuLabel();
    },
    CLIENT_ID,
    FOLDER_NAME,
    DATA_FILE
  };

  // ── INIT ──────────────────────────────────────────────────────────────────────
  function init(){
    log('Init on', window.location.pathname);
    injectStyles();
    injectPill();
    injectModal();
    injectMenuItem();

    const persistedUsable = _persisted.token && _persisted.expiry > Date.now();

    if (persistedUsable){
      // Restore full session from localStorage — no Google popup needed
      accessToken  = _persisted.token;
      tokenExpiry  = _persisted.expiry;
      userEmail    = _persisted.email;
      folderId     = _persisted.folderId || null;
      driveFileId  = _persisted.fileId   || null;
      isSignedIn   = true;
      reconnectNeeded = false;
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
        if (tokenUsable()) {
          isSignedIn = true;
          refreshMenuLabel();
          showPill('error', 'Sync paused — will retry', 5000);
          const retryResume = () => {
            if (!tokenUsable()) return;
            setupAndPull()
              .then(() => showPill('signed-in', '✓ Synced', 3000))
              .catch(() => setTimeout(retryResume, 30000));
          };
          setTimeout(retryResume, 8000);
        } else if (!reconnectNeeded) {
          markNeedsReconnect('resume failed');
        }
      });

    } else if (loginHint()){
      // Token expired — wait for a tap. Auto GIS popups fail in the PWA.
      userEmail = _persisted.email || loginHint();
      isSignedIn = false;
      reconnectNeeded = true;
      refreshMenuLabel();
      showPill(null, '🔑 Tap to reconnect');
      loadGIS().then(() => { ensureTokenClient(); }).catch(() => {});

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
