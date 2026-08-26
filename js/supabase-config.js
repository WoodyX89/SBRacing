/* SB Racing Supabase client */
(function () {
  var SUPABASE_URL = 'https://vuqwfpwtwacwvaofqjdp.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_6dLxJc4-Oo0kHicqjLJIvg_4ejoWwF2';

  var lib = window.supabase;
  if (!lib || typeof lib.createClient !== 'function') {
    console.error('[sb] window.supabase missing. CDN script did not load.');
    return;
  }

  try {
    window.sb = lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage,
        // No-op lock — prevents Safari deadlocks that hang getSession()
        lock: async function (name, acquireTimeout, fn) { return await fn(); }
      }
    });
    window.SB_URL = SUPABASE_URL;
    window.SB_ANON_KEY = SUPABASE_ANON_KEY;
    // Public HTTPS origin for Stripe return URLs (Capacitor cannot use capacitor://)
    window.SB_SITE_URL = window.SB_SITE_URL || 'https://sbracing.ca';
    console.log('[sb] ready', SUPABASE_URL);
  } catch (err) {
    console.error('[sb] createClient error', err);
  }
})();

/** Read session from localStorage — does not hang */
function getSessionFromStorage() {
  try {
    var keys = Object.keys(localStorage);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.indexOf('auth-token') === -1 && k.indexOf('sb-') !== 0) continue;
      if (k.indexOf('auth') === -1) continue;
      var raw = localStorage.getItem(k);
      if (!raw) continue;
      var parsed = JSON.parse(raw);
      // supabase-js v2 shape
      var sess = parsed;
      if (parsed && parsed.currentSession) sess = parsed.currentSession;
      if (parsed && parsed.user && parsed.access_token) sess = parsed;
      if (sess && (sess.user || sess.access_token)) {
        return {
          access_token: sess.access_token,
          refresh_token: sess.refresh_token,
          user: sess.user || null
        };
      }
    }
  } catch (e) {
    console.warn('[sb] storage parse', e);
  }
  return null;
}

async function getSession() {
  // Prefer non-blocking storage read
  var stored = getSessionFromStorage();
  if (stored && stored.user) return stored;

  if (!window.sb) return null;
  try {
    var result = await Promise.race([
      window.sb.auth.getSession().then(function (r) { return r.data.session; }),
      new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 2000); })
    ]);
    return result;
  } catch (e) {
    console.warn('getSession failed:', e);
    return null;
  }
}

async function getCurrentUser() {
  var session = await getSession();
  return session && session.user ? session.user : null;
}

/** Profile via REST fetch — avoids client query hangs */
async function getProfile(userId) {
  if (!userId) return null;
  var session = getSessionFromStorage();
  var token = (session && session.access_token) || window.SB_ANON_KEY;
  try {
    var res = await fetch(
      window.SB_URL + '/rest/v1/profiles?id=eq.' + encodeURIComponent(userId) + '&select=*',
      {
        headers: {
          apikey: window.SB_ANON_KEY,
          Authorization: 'Bearer ' + token,
          Accept: 'application/json'
        }
      }
    );
    if (!res.ok) {
      console.warn('getProfile status', res.status);
      return null;
    }
    var rows = await res.json();
    return rows && rows[0] ? rows[0] : null;
  } catch (e) {
    console.warn('getProfile failed:', e);
    return null;
  }
}

async function signOut() {
  try {
    if (window.sb) await window.sb.auth.signOut();
  } catch (e) {}
  // clear any leftover tokens
  Object.keys(localStorage).forEach(function (k) {
    if (k.indexOf('auth-token') !== -1) localStorage.removeItem(k);
  });
  location.href = 'members.html';
}

var MEMBERSHIP_TIERS = {
  0: { name: 'Trail Rider', price: 45, slug: 'trail_rider' },
  1: { name: 'Coulee Crusher', price: 85, slug: 'coulee_crusher' },
  2: { name: 'Youth / Student', price: 25, slug: 'youth' }
};
