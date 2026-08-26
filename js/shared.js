
/** Ensure Trails link exists even if an old partials/nav.html is cached/deployed */
function ensureTrailsNavLink() {
    var desktop = document.querySelector('#navbar .nav-link[href="trails.html"]');
    var mobile = document.querySelector('#mobile-menu .mobile-nav-link[href="trails.html"]');
    if (!desktop) {
        var events = document.querySelector('#navbar .nav-link[href="events.html"]');
        if (events && events.parentElement) {
            var a = document.createElement('a');
            a.href = 'trails.html';
            a.className = 'nav-link px-3 py-2 hover:text-white transition-colors';
            a.textContent = 'Trails';
            events.insertAdjacentElement('afterend', a);
        }
    }
    if (!mobile) {
        var mevents = document.querySelector('#mobile-menu .mobile-nav-link[href="events.html"]');
        if (mevents && mevents.parentElement) {
            var m = document.createElement('a');
            m.href = 'trails.html';
            m.className = 'mobile-nav-link px-4 py-3 rounded-2xl hover:bg-zinc-800';
            m.textContent = 'Trails & Routes';
            mevents.insertAdjacentElement('afterend', m);
        }
    }
}


function isMerchPage() {
    const path = (location.pathname || '').toLowerCase();
    return path.endsWith('merch.html') || path.includes('/merch');
}

function updateNavCartVisibility() {
  // Cart + notifications live in desktop header + mobile hamburger on ALL pages.
  var btn = document.getElementById('nav-cart-btn');
  if (btn) {
    btn.classList.add('hidden');
    btn.style.display = 'none';
  }
  var desktop = document.getElementById('nav-cart-desktop');
  if (desktop) {
    desktop.classList.remove('hidden');
    desktop.style.display = '';
  }
  var mobileBtn = document.getElementById('nav-cart-btn-mobile');
  if (mobileBtn) {
    mobileBtn.classList.remove('hidden');
    mobileBtn.style.display = 'flex';
  }
  var notifDesk = document.getElementById('nav-notif-desktop');
  if (notifDesk) {
    notifDesk.classList.remove('hidden');
    notifDesk.style.display = '';
  }
  var notifMobile = document.getElementById('nav-notif-btn-mobile');
  if (notifMobile) {
    notifMobile.classList.remove('hidden');
    notifMobile.style.display = 'flex';
  }
  try { if (typeof updateNotifCount === 'function') updateNotifCount(); } catch (e) {}
}


// Load shared navbar from partials/nav.html (one file for every page)
async function loadSiteNav() {
    const mount = document.getElementById('site-nav');
    if (!mount) return;
    const candidates = [
        'partials/nav.html',
        './partials/nav.html',
        '/partials/nav.html'
    ];
    let lastErr = null;
    for (const url of candidates) {
        try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (!res.ok) throw new Error('nav ' + res.status + ' ' + url);
            mount.innerHTML = await res.text();
            ensureTrailsNavLink();
            updateNavCartVisibility();
            return;
        } catch (e) {
            lastErr = e;
        }
    }
    console.error('[nav] failed to load partials/nav.html', lastErr);
    // Minimal top bar for website fallback — bottom tabs are injected by applyNavShell()
    mount.innerHTML = '<nav id="navbar" class="fixed top-0 left-0 right-0 z-[100] bg-black p-4 text-white border-b border-zinc-800"><a href="index.html" class="font-bold">SB Racing</a></nav>';
}

async function loadSiteFooter() {
    var mount = document.getElementById('site-footer');
    var candidates = [
        'partials/footer.html',
        './partials/footer.html',
        '/partials/footer.html',
        'footer.html'
    ];
    var html = null;
    var lastErr = null;
    for (var i = 0; i < candidates.length; i++) {
        try {
            var res = await fetch(candidates[i], { cache: 'no-cache' });
            if (!res.ok) throw new Error('footer ' + res.status + ' ' + candidates[i]);
            html = await res.text();
            console.log('[footer] loaded', candidates[i]);
            break;
        } catch (e) {
            lastErr = e;
        }
    }
    if (html && mount) {
        mount.innerHTML = html;
    } else if (!html) {
        console.error('[footer] failed to load partials/footer.html', lastErr);
    }
    ensureCartUi();
    try { updateNotifCount(); } catch (e) {}
}

/** Inject cart drawer if footer partial failed */
function ensureCartUi() {
    if (document.getElementById('cart-drawer')) return;
    var wrap = document.createElement('div');
    wrap.id = 'site-footer-fallback';
    wrap.innerHTML =
      '<div id="cart-drawer" class="hidden fixed inset-0 bg-black/60 z-[90] flex justify-end">' +
      '<div class="w-full max-w-md bg-zinc-900 h-full overflow-y-auto p-6 flex flex-col">' +
      '<div class="flex justify-between items-center mb-6">' +
      '<div class="font-bold text-xl">Your Cart</div>' +
      '<button type="button" onclick="hideCart()" class="text-zinc-400 hover:text-white"><i class="fa-solid fa-times text-2xl"></i></button></div>' +
      '<div id="cart-items" class="flex-1 space-y-4"></div>' +
      '<div class="border-t border-zinc-800 pt-4 mt-4">' +
      '<div class="flex justify-between text-lg font-semibold mb-4"><span>Total</span><span id="cart-total">$0.00</span></div>' +
      '<button type="button" onclick="openCheckoutModal()" class="w-full py-3.5 rounded-2xl bg-orange-600 hover:bg-orange-700 font-semibold">Checkout</button>' +
      '</div></div></div>' +
      '<div id="success-toast" class="hidden fixed bottom-24 left-1/2 -translate-x-1/2 bg-emerald-600 text-white px-8 py-3 rounded-2xl shadow-xl z-[110] text-sm font-medium">Done</div>';
    document.body.appendChild(wrap);
    var drawer = document.getElementById('cart-drawer');
    if (drawer) {
      drawer.addEventListener('click', function (e) {
        if (e.target && e.target.id === 'cart-drawer') hideCart();
      });
    }
    console.log('[footer] injected fallback cart UI');
}


// Shared navigation + cart + toast helpers for multi-page SB Racing site

function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    if (menu) menu.classList.toggle('hidden');
}

function initNavbar() {
    const navbar = document.getElementById('navbar');
    if (!navbar) return;

    // Always solid black — never let hero show through at top of page
    navbar.style.background = '#000';
    navbar.style.backgroundColor = '#000';
    navbar.style.backgroundImage = 'none';
    navbar.style.opacity = '1';
    navbar.style.zIndex = '100';

    window.addEventListener('scroll', () => {
        navbar.style.backgroundColor = '#000000';
        navbar.style.backgroundImage = 'none';
        // Optional shadow only — never change color
        if (window.scrollY > 30) navbar.classList.add('nav-scrolled');
        else navbar.classList.remove('nav-scrolled');
    });
}

function setActiveNav() {
    const path = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-link, .mobile-nav-link').forEach(link => {
        const href = link.getAttribute('href');
        if (href === path || (path === '' && href === 'index.html')) {
            link.classList.add('nav-active');
        }
    });
    // Bottom tab bar (mobile)
    document.querySelectorAll('.bottom-tab').forEach(tab => {
        const href = tab.getAttribute('href') || tab.getAttribute('data-tab');
        tab.classList.remove('bottom-tab-active');
        if (href === path) {
            tab.classList.add('bottom-tab-active');
        }
    });
}

function showToast(message, isError = false) {
    let toast = document.getElementById('success-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'success-toast';
        toast.className = 'hidden fixed bottom-6 left-1/2 -translate-x-1/2 text-white px-8 py-3 rounded-2xl shadow-xl flex items-center gap-x-3 text-sm font-medium z-[100]';
        toast.innerHTML = '<i class="fa-solid fa-check-circle"></i><span id="toast-message"></span>';
        document.body.appendChild(toast);
    }
    toast.classList.remove('bg-emerald-600', 'bg-red-600');
    toast.classList.add(isError ? 'bg-red-600' : 'bg-emerald-600');
    const icon = toast.querySelector('i');
    if (icon) icon.className = isError ? 'fa-solid fa-exclamation-circle' : 'fa-solid fa-check-circle';
    const msgEl = document.getElementById('toast-message');
    msgEl.textContent = message;
    toast.style.transition = 'none';
    toast.style.opacity = '1';
    toast.classList.remove('hidden');
    toast.classList.add('flex');
    void toast.offsetWidth;
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
            toast.style.opacity = '1';
            toast.classList.remove('flex');
            toast.classList.add('hidden');
        }, 200);
    }, 3500);
}

// ---------- Cart (localStorage + optional order save) ----------
// Cart: [{ productId, name, price, qty, size }]
let cart = (function () {
  try {
    var raw = JSON.parse(localStorage.getItem('sb_cart') || '[]');
    if (!Array.isArray(raw)) return [];
    // Migrate legacy {id,name,price} rows
    return raw.map(function (item) {
      return {
        productId: item.productId != null ? item.productId : null,
        name: item.name || 'Item',
        price: Number(item.price) || 0,
        qty: Math.max(1, Number(item.qty) || 1),
        size: item.size || ''
      };
    });
  } catch (e) {
    return [];
  }
})();

function cartItemCount() {
  return cart.reduce(function (n, item) { return n + (item.qty || 1); }, 0);
}

function cartTotal() {
  return cart.reduce(function (sum, item) {
    return sum + (Number(item.price) || 0) * (item.qty || 1);
  }, 0);
}

function saveCart() {
  localStorage.setItem('sb_cart', JSON.stringify(cart));
  updateCartCount();
}

var _hapticsPlugin = null;
var _hapticsTried = false;

function getHapticsPlugin() {
  if (_hapticsPlugin) return _hapticsPlugin;
  try {
    if (!window.Capacitor) return null;
    var H = null;
    var plugs = Capacitor.Plugins || {};
    H = plugs.Haptics || plugs.haptics || null;
    if (!H && typeof Capacitor.registerPlugin === 'function') {
      try { H = Capacitor.registerPlugin('Haptics'); } catch (e1) {}
    }
    if (!H && typeof Capacitor.getPlugin === 'function') {
      try { H = Capacitor.getPlugin('Haptics'); } catch (e2) {}
    }
    if (H) {
      _hapticsPlugin = H;
      console.log('[haptics] plugin ready', Object.keys(H));
    } else if (!_hapticsTried && isNativeAppShell()) {
      _hapticsTried = true;
      console.warn('[haptics] not registered. plugins=', Object.keys(plugs));
      console.warn('[haptics] run: npm i @capacitor/haptics && npx cap sync ios && clean Xcode build');
    }
    return H;
  } catch (e) {
    return null;
  }
}

/** Call from Safari console on device: testHaptics() */
window.testHaptics = function () {
  console.log('Capacitor?', !!window.Capacitor);
  console.log('native?', isNativeAppShell());
  console.log('plugins', window.Capacitor && Capacitor.Plugins && Object.keys(Capacitor.Plugins));
  var H = getHapticsPlugin();
  console.log('Haptics plugin', H);
  haptic('medium');
  setTimeout(function () { hapticSelection(); }, 300);
  setTimeout(function () { haptic('warning'); }, 600);
  return !!H;
};

function haptic(style) {
  try {
    var H = getHapticsPlugin();
    if (!H) return;
    var s = (style || 'light').toLowerCase();
    var p;
    if (s === 'success' || s === 'warning' || s === 'error') {
      if (typeof H.notification === 'function') {
        var map = { success: 'SUCCESS', warning: 'WARNING', error: 'ERROR' };
        p = H.notification({ type: map[s] });
      }
    } else if (typeof H.impact === 'function') {
      var impact = 'LIGHT';
      if (s === 'medium') impact = 'MEDIUM';
      if (s === 'heavy') impact = 'HEAVY';
      // Cap 5+ accepts string style; also try ImpactStyle-like object
      p = H.impact({ style: impact });
    }
    if (p && typeof p.catch === 'function') p.catch(function (err) { console.warn('[haptics] fail', err); });
  } catch (e) {
    console.warn('[haptics]', e);
  }
}

function hapticSelection() {
  try {
    var H = getHapticsPlugin();
    if (!H) return;
    if (typeof H.selectionStart === 'function') {
      Promise.resolve(H.selectionStart())
        .then(function () { return H.selectionChanged && H.selectionChanged(); })
        .then(function () { return H.selectionEnd && H.selectionEnd(); })
        .catch(function () { haptic('light'); });
    } else if (typeof H.selectionChanged === 'function') {
      Promise.resolve(H.selectionChanged()).catch(function () { haptic('light'); });
    } else {
      haptic('light');
    }
  } catch (e) {
    haptic('light');
  }
}

/** Retry plugin lookup after native bridge finishes loading */
function armHapticsRetry() {
  var n = 0;
  var t = setInterval(function () {
    n += 1;
    _hapticsPlugin = null;
    if (getHapticsPlugin() || n >= 20) clearInterval(t);
  }, 200);
}

function updateCartCount() {
  var n = cartItemCount();
  ['cart-count', 'cart-count-mobile', 'cart-count-native'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.textContent = n;
  });
}


// ─── In-app notification inbox (localStorage) ───────────────────────────────
var NOTIF_STORAGE_KEY = 'sb_notifications';
var NOTIF_MAX = 50;

function loadNotifications() {
  try {
    var raw = localStorage.getItem(NOTIF_STORAGE_KEY);
    var list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function saveNotifications(list) {
  try {
    localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(list.slice(0, NOTIF_MAX)));
  } catch (e) {}
}

function notifUnreadCount() {
  // Badge stays until Clear all — count every item in the inbox
  return loadNotifications().length;
}

function updateNotifCount() {
  var n = notifUnreadCount();
  ['notif-count', 'notif-count-mobile', 'notif-count-native'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = n > 99 ? '99+' : String(n);
    if (n > 0) {
      el.classList.remove('hidden');
      el.style.display = '';
    } else {
      el.classList.add('hidden');
    }
  });
  // Keep iOS home-screen badge in sync when possible
  try {
    if (typeof syncNativeBadge === 'function') syncNativeBadge(n);
  } catch (e) {}
}

/**
 * Add a notification to the in-app inbox.
 * opts: { title, body, url, type, id }
 * Returns the new item id.
 */
function addNotification(opts) {
  opts = opts || {};
  var list = loadNotifications();
  var id = opts.id != null ? String(opts.id) : ('n' + Date.now() + '-' + Math.floor(Math.random() * 10000));
  // de-dupe by id if provided
  if (opts.id != null) {
    var exists = list.some(function (n) { return String(n.id) === id; });
    if (exists) {
      updateNotifCount();
      return id;
    }
  }
  list.unshift({
    id: id,
    title: opts.title || 'Update',
    body: opts.body || '',
    url: opts.url || '',
    type: opts.type || 'activity',
    read: false,
    ts: Date.now()
  });
  saveNotifications(list);
  updateNotifCount();
  return id;
}

function markNotificationRead(id) {
  var list = loadNotifications();
  var changed = false;
  list.forEach(function (n) {
    if (String(n.id) === String(id) && !n.read) {
      n.read = true;
      changed = true;
    }
  });
  if (changed) {
    saveNotifications(list);
    updateNotifCount();
  }
}

function removeNotification(id) {
  var list = loadNotifications().filter(function (n) { return String(n.id) !== String(id); });
  saveNotifications(list);
  updateNotifCount();
  if (document.getElementById('notif-drawer') && !document.getElementById('notif-drawer').classList.contains('hidden')) {
    showNotifications();
  }
}

function clearAllNotifications() {
  saveNotifications([]);
  updateNotifCount();
  // Clear delivered OS notifications + native badge
  try {
    var Push = window.Capacitor && (Capacitor.Plugins && Capacitor.Plugins.PushNotifications
      || (typeof Capacitor.registerPlugin === 'function' && Capacitor.registerPlugin('PushNotifications')));
    if (Push && typeof Push.removeAllDeliveredNotifications === 'function') {
      Push.removeAllDeliveredNotifications();
    }
  } catch (e) {}
  // Reset server-side badge_count so the next push starts from 1 again
  try {
    if (typeof resetServerBadge === 'function') resetServerBadge();
  } catch (e) {}
  showNotifications();
  if (typeof haptic === 'function') haptic('light');
}

/** Tell the edge function to zero this user's device badge_count */
async function resetServerBadge() {
  try {
    if (!window.sb || !window.sb.functions) return;
    await window.sb.functions.invoke('notify-event', {
      body: { action: 'clear-badge' }
    });
  } catch (e) {
    console.warn('[badge] resetServerBadge', e);
  }
}

/** Keep server badge_count aligned with the in-app inbox (optional) */
async function syncServerBadge(count) {
  try {
    if (!window.sb || !window.sb.functions) return;
    count = Math.max(0, Number(count) || 0);
    await window.sb.functions.invoke('notify-event', {
      body: { action: 'set-badge', badge: count }
    });
  } catch (e) {
    console.warn('[badge] syncServerBadge', e);
  }
}

function ensureNotifUi() {
  if (document.getElementById('notif-drawer')) return;
  var wrap = document.createElement('div');
  wrap.id = 'notif-drawer-fallback';
  wrap.innerHTML =
    '<div id="notif-drawer" class="hidden fixed inset-0 bg-black/60 z-[99999] flex justify-end">' +
    '<div class="w-full max-w-md bg-zinc-900 h-full overflow-hidden p-0 flex flex-col border-l border-zinc-700">' +
    '<div class="p-6 flex justify-between items-center border-b border-zinc-700">' +
    '<div class="font-bold text-xl">Notifications</div>' +
    '<div class="flex items-center gap-3">' +
    '<button type="button" onclick="clearAllNotifications()" class="text-xs text-zinc-400 hover:text-orange-400 font-medium">Clear all</button>' +
    '<button type="button" onclick="hideNotifications()" class="text-zinc-400 hover:text-white"><i class="fa-solid fa-times text-2xl"></i></button>' +
    '</div></div>' +
    '<div id="notif-items" class="flex-1 overflow-auto p-4 space-y-3 text-sm"></div>' +
    '</div></div>';
  document.body.appendChild(wrap);
  var drawer = document.getElementById('notif-drawer');
  if (drawer) {
    drawer.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'notif-drawer') hideNotifications();
    });
  }
}

function escapeNotifHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNotifTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  var now = Date.now();
  var diff = Math.floor((now - d.getTime()) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return d.toLocaleDateString();
}

function showNotifications() {
  ensureNotifUi();
  if (typeof haptic === 'function') haptic('light');
  var drawer = document.getElementById('notif-drawer');
  if (!drawer) return;

  var native = typeof isNativeAppShell === 'function' && isNativeAppShell();
  drawer.style.zIndex = '99999';
  drawer.classList.remove('hidden');
  drawer.classList.add('flex');
  drawer.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  var sheet = drawer.firstElementChild;
  if (sheet && native) {
    sheet.style.maxHeight = 'min(88dvh, calc(100dvh - env(safe-area-inset-top, 0px) - 3.5rem))';
    sheet.style.height = 'auto';
    sheet.style.width = '100%';
    sheet.style.maxWidth = '100%';
    sheet.style.borderRadius = '20px 20px 0 0';
    sheet.style.alignSelf = 'flex-end';
    drawer.style.alignItems = 'flex-end';
    drawer.style.justifyContent = 'center';
  }

  var itemsContainer = document.getElementById('notif-items');
  if (!itemsContainer) return;
  itemsContainer.innerHTML = '';

  var list = loadNotifications();
  // Badge stays until user taps Clear all (or removes individual items)
  if (list.length === 0) {
    itemsContainer.innerHTML =
      '<div class="flex flex-col items-center justify-center text-center py-16">' +
      '<i class="fa-regular fa-bell text-5xl text-zinc-600 mb-4"></i>' +
      '<p class="text-zinc-400">No notifications yet</p>' +
      '<p class="text-xs text-zinc-600 mt-2">Club updates and event alerts will show up here</p></div>';
  } else {
    list.forEach(function (n) {
      var unreadDot = n.read
        ? ''
        : '<span class="w-2 h-2 rounded-full bg-orange-500 shrink-0 mt-1.5"></span>';
      var bg = n.read ? 'bg-zinc-950/60' : 'bg-zinc-950 border-orange-900/40';
      itemsContainer.innerHTML +=
        '<div class="flex gap-3 items-start ' + bg + ' border border-zinc-700 rounded-2xl p-4">' +
        unreadDot +
        '<button type="button" class="flex-1 min-w-0 text-left" onclick="openNotification(\'' + escapeNotifHtml(n.id).replace(/'/g, '') + '\')">' +
        '<div class="font-medium text-sm leading-snug">' + escapeNotifHtml(n.title) + '</div>' +
        (n.body ? '<div class="text-xs text-zinc-400 mt-1 line-clamp-2">' + escapeNotifHtml(n.body) + '</div>' : '') +
        '<div class="text-[11px] text-zinc-600 mt-1.5">' + formatNotifTime(n.ts) + '</div>' +
        '</button>' +
        '<button type="button" onclick="removeNotification(\'' + escapeNotifHtml(n.id).replace(/'/g, '') + '\')" class="text-zinc-500 hover:text-red-400 p-1 shrink-0" aria-label="Remove">' +
        '<i class="fa-solid fa-xmark"></i></button>' +
        '</div>';
    });
  }
}

function hideNotifications() {
  if (typeof haptic === 'function') haptic('light');
  var drawer = document.getElementById('notif-drawer');
  if (drawer) {
    drawer.classList.remove('flex');
    drawer.classList.add('hidden');
    drawer.style.display = '';
    drawer.style.alignItems = '';
    drawer.style.justifyContent = '';
  }
  document.body.style.overflow = '';
}

function openNotification(id) {
  var list = loadNotifications();
  var item = null;
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].id) === String(id)) { item = list[i]; break; }
  }
  // Keep badge until Clear all — only mark visual state, do not remove from count
  markNotificationRead(id);
  hideNotifications();
  if (item && item.url) {
    try { window.location.href = item.url; } catch (e) {}
  }
}

/**
 * Sync the iOS/Android home-screen app icon badge with the in-app inbox count.
 * Uses @capawesome/capacitor-badge when installed (recommended).
 * Falls back to clearing via PushNotifications when count is 0.
 *
 * Install once on your Mac:
 *   npm install @capawesome/capacitor-badge
 *   npx cap sync ios
 */
function getBadgePlugin() {
  try {
    if (!window.Capacitor) return null;
    if (Capacitor.Plugins && Capacitor.Plugins.Badge) return Capacitor.Plugins.Badge;
    if (typeof Capacitor.registerPlugin === 'function') {
      return Capacitor.registerPlugin('Badge');
    }
  } catch (e) {}
  return null;
}

async function syncNativeBadge(count) {
  count = Math.max(0, Number(count) || 0);
  try {
    if (!window.Capacitor) return;
    var native = false;
    try {
      if (typeof isNativeAppShell === 'function') native = isNativeAppShell();
      else if (typeof Capacitor.isNativePlatform === 'function') native = Capacitor.isNativePlatform();
    } catch (e) {}
    if (!native) return;

    var Badge = getBadgePlugin();
    if (Badge) {
      try {
        // Request permission on iOS (no-op on Android / already granted)
        if (typeof Badge.checkPermissions === 'function') {
          var perms = await Badge.checkPermissions();
          if (perms && perms.display === 'prompt' && typeof Badge.requestPermissions === 'function') {
            await Badge.requestPermissions();
          }
        }
        if (count <= 0) {
          if (typeof Badge.clear === 'function') await Badge.clear();
          else if (typeof Badge.set === 'function') await Badge.set({ count: 0 });
        } else if (typeof Badge.set === 'function') {
          await Badge.set({ count: count });
        }
        return;
      } catch (e) {
        console.warn('[badge] Badge plugin error', e);
      }
    }

    // Fallback: clear only (Capacitor Push has no setBadge API)
    if (count === 0) {
      var Push = Capacitor.Plugins && Capacitor.Plugins.PushNotifications
        || (typeof Capacitor.registerPlugin === 'function' && Capacitor.registerPlugin('PushNotifications'));
      if (Push && typeof Push.removeAllDeliveredNotifications === 'function') {
        await Push.removeAllDeliveredNotifications();
      }
    } else {
      console.warn('[badge] Install @capawesome/capacitor-badge to set the home-screen badge count');
    }
  } catch (e) {
    console.warn('[badge] syncNativeBadge', e);
  }
}


/**
 * Add to cart. size optional. Merges same productId+size (or name+size).
 * @param {string} name
 * @param {number} price
 * @param {{productId?:number|string, size?:string, qty?:number}} [opts]
 */
function addToCart(name, price, opts) {
  opts = opts || {};
  var productId = opts.productId != null ? opts.productId : null;
  var size = (opts.size || '').trim();
  var qty = Math.max(1, Number(opts.qty) || 1);

  // Cap by remaining stock (DB stock minus what's already in cart)
  if (productId != null && typeof allProducts !== 'undefined' && allProducts && allProducts.length) {
    var prod = allProducts.find(function (p) { return String(p.id) === String(productId); });
    if (prod) {
      var already = 0;
      for (var i = 0; i < cart.length; i++) {
        if (String(cart[i].productId) === String(productId)) already += Number(cart[i].qty) || 0;
      }
      var left = Math.max(0, (Number(prod.stock_qty) || 0) - already);
      if (left <= 0) {
        showToast('Sold out', true);
        return;
      }
      if (qty > left) qty = left;
    }
  }

  var existing = cart.findIndex(function (item) {
    if (productId != null && item.productId != null) {
      return String(item.productId) === String(productId) && (item.size || '') === size;
    }
    return item.name === name && (item.size || '') === size;
  });

  if (existing >= 0) {
    cart[existing].qty += qty;
  } else {
    cart.push({
      productId: productId,
      name: name,
      price: Number(price) || 0,
      qty: qty,
      size: size
    });
  }
  saveCart();
  haptic('medium');
  var label = size ? name + ' (' + size + ')' : name;
  showToast(label + ' added to cart');
  // Update remaining stock numbers on merch page
  if (typeof refreshMerchStockUi === 'function') {
    try { refreshMerchStockUi(); } catch (e) {}
  }
}

function showCart() {
  ensureCartUi();
  haptic('light');
  var drawer = document.getElementById('cart-drawer');
  if (!drawer) {
    window.location.href = 'merch.html';
    return;
  }
  var itemsContainer = document.getElementById('cart-items');
  if (!itemsContainer) return;

  var native = isNativeAppShell();
  // Raise above top navbar (z-200) and bottom tabs (z-100)
  drawer.style.zIndex = '99999';
  drawer.classList.toggle('native-cart-overlay', native);

  // Mark sheet panel for native layout
  var sheet = drawer.firstElementChild;
  if (sheet) {
    sheet.classList.toggle('native-cart-sheet', native);
    if (native) {
      sheet.style.maxHeight = 'min(88dvh, calc(100dvh - env(safe-area-inset-top, 0px) - 3.5rem))';
      sheet.style.height = 'auto';
      sheet.style.width = '100%';
      sheet.style.maxWidth = '100%';
      sheet.style.borderRadius = '20px 20px 0 0';
      sheet.style.display = 'flex';
      sheet.style.flexDirection = 'column';
      sheet.style.overflow = 'hidden';
      sheet.style.background = '#1c1c1e';
      sheet.style.paddingBottom = '0';
    } else {
      sheet.style.maxHeight = '';
      sheet.style.height = '';
      sheet.style.width = '';
      sheet.style.maxWidth = '';
      sheet.style.borderRadius = '';
      sheet.style.paddingBottom = '';
    }
  }

  itemsContainer.innerHTML = '';
  itemsContainer.style.webkitOverflowScrolling = 'touch';
  itemsContainer.style.overflowY = 'auto';
  itemsContainer.style.minHeight = '0';
  itemsContainer.style.flex = '1 1 auto';

  if (cart.length === 0) {
    itemsContainer.innerHTML =
      '<div class="native-cart-empty flex flex-col items-center justify-center text-center py-12">' +
      '<i class="fa-solid fa-shopping-cart text-5xl text-zinc-600 mb-4"></i>' +
      '<p class="text-zinc-400">Your cart is empty</p></div>';
    var totEl = document.getElementById('cart-total');
    if (totEl) totEl.textContent = '$0.00';
  } else {
    cart.forEach(function (item, index) {
      var line = (Number(item.price) || 0) * (item.qty || 1);
      var sizeHtml = item.size
        ? '<div class="text-[11px] text-zinc-500 mt-0.5">Size: ' + escapeCartHtml(item.size) + '</div>'
        : '';
      itemsContainer.innerHTML +=
        '<div class="flex gap-3 items-start bg-zinc-950 border border-zinc-700 rounded-2xl p-4">' +
        '<div class="flex-1 min-w-0">' +
        '<div class="font-medium truncate">' + escapeCartHtml(item.name) + '</div>' +
        sizeHtml +
        '<div class="font-mono text-xs text-orange-500 mt-1">$' + Number(item.price).toFixed(2) + ' each</div>' +
        '<div class="flex items-center gap-2 mt-3">' +
        '<button type="button" onclick="changeCartQty(' + index + ', -1)" class="w-10 h-10 rounded-xl border border-zinc-700 hover:bg-zinc-800 text-base">−</button>' +
        '<span class="w-8 text-center text-sm font-mono">' + item.qty + '</span>' +
        '<button type="button" onclick="changeCartQty(' + index + ', 1)" class="w-10 h-10 rounded-xl border border-zinc-700 hover:bg-zinc-800 text-base">+</button>' +
        '</div></div>' +
        '<div class="text-right shrink-0">' +
        '<div class="font-mono text-sm">$' + line.toFixed(2) + '</div>' +
        '<button type="button" onclick="removeFromCart(' + index + ')" class="mt-2 text-xs text-red-400 hover:text-red-300 px-2 py-1">' +
        '<i class="fa-solid fa-trash"></i></button></div></div>';
    });
    var totEl2 = document.getElementById('cart-total');
    if (totEl2) totEl2.textContent = '$' + cartTotal().toFixed(2);
  }

  // Header: add grab + Done on native
  var header = sheet && sheet.children[0];
  if (native && header && !header.querySelector('.native-cart-grab')) {
    var grab = document.createElement('div');
    grab.className = 'native-cart-grab';
    header.insertBefore(grab, header.firstChild);
    header.style.flexDirection = 'column';
    header.style.alignItems = 'stretch';
    header.style.paddingTop = '10px';
    var row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';
    row.style.width = '100%';
    while (header.childNodes.length > 1) {
      row.appendChild(header.childNodes[1]);
    }
    header.appendChild(row);
  }

  // Footer checkout area: pad above home indicator; sit above bottom tabs area
  var footer = sheet && sheet.lastElementChild;
  if (footer) {
    if (native) {
      footer.style.paddingBottom = 'calc(16px + env(safe-area-inset-bottom, 0px))';
      footer.style.flexShrink = '0';
    } else {
      footer.style.paddingBottom = '';
    }
  }

  drawer.classList.remove('hidden');
  drawer.classList.add('flex');
  if (native) {
    drawer.style.display = 'flex';
    drawer.style.alignItems = 'flex-end';
    drawer.style.justifyContent = 'stretch';
    document.body.style.overflow = 'hidden';
  }
}

function changeCartQty(index, delta) {
  if (!cart[index]) return;
  var item = cart[index];
  var next = (item.qty || 1) + delta;
  if (next <= 0) {
    cart.splice(index, 1);
  } else {
    // Cap increase by remaining stock
    if (delta > 0 && item.productId != null && typeof allProducts !== 'undefined' && allProducts) {
      var prod = allProducts.find(function (p) { return String(p.id) === String(item.productId); });
      if (prod) {
        var others = 0;
        for (var i = 0; i < cart.length; i++) {
          if (i !== index && String(cart[i].productId) === String(item.productId)) {
            others += Number(cart[i].qty) || 0;
          }
        }
        var max = Math.max(0, (Number(prod.stock_qty) || 0) - others);
        if (next > max) {
          next = max;
          if (next <= (item.qty || 1)) {
            showToast('No more in stock', true);
          }
        }
      }
    }
    item.qty = next;
  }
  saveCart();
  hapticSelection();
  showCart();
  if (typeof refreshMerchStockUi === 'function') {
    try { refreshMerchStockUi(); } catch (e) {}
  }
}

function removeFromCart(index) {
  cart.splice(index, 1);
  saveCart();
  haptic('warning');
  showCart();
  if (typeof refreshMerchStockUi === 'function') {
    try { refreshMerchStockUi(); } catch (e) {}
  }
}

function hideCart() {
  haptic('light');
  var drawer = document.getElementById('cart-drawer');
  if (drawer) {
    drawer.classList.remove('flex', 'native-cart-overlay');
    drawer.classList.add('hidden');
    drawer.style.display = '';
    drawer.style.alignItems = '';
    drawer.style.justifyContent = '';
  }
  document.body.style.overflow = '';
}

function escapeCartHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Opens checkout form modal (collect shipping). Stripe later. */
function checkout() {
  if (cart.length === 0) return;
  hideCart();
  openCheckoutModal();
}

function openCheckoutModal() {
  var modal = document.getElementById('checkout-modal');
  if (!modal) {
    // Fallback if partial not loaded yet
    alert('Checkout form not ready. Refresh and try again.');
    return;
  }
  var totalEl = document.getElementById('checkout-total-display');
  if (totalEl) totalEl.textContent = '$' + cartTotal().toFixed(2);
  var err = document.getElementById('checkout-error');
  if (err) { err.textContent = ''; err.classList.add('hidden'); }

  // Prefill from session if available
  try {
    if (window.sb && window.sb.auth) {
      window.sb.auth.getSession().then(function (res) {
        var user = res.data && res.data.session && res.data.session.user;
        if (!user) return;
        var email = document.getElementById('co-email');
        var name = document.getElementById('co-name');
        if (email && !email.value) email.value = user.email || '';
        var meta = user.user_metadata || {};
        if (name && !name.value) name.value = meta.full_name || meta.name || '';
      }).catch(function () {});
    }
  } catch (e) {}

  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}

function closeCheckoutModal() {
  var modal = document.getElementById('checkout-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

async function submitCheckout(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (cart.length === 0) {
    closeCheckoutModal();
    return;
  }

  var name = (document.getElementById('co-name') || {}).value || '';
  var email = (document.getElementById('co-email') || {}).value || '';
  var phone = (document.getElementById('co-phone') || {}).value || '';
  var address = (document.getElementById('co-address') || {}).value || '';
  var city = (document.getElementById('co-city') || {}).value || '';
  var province = (document.getElementById('co-province') || {}).value || '';
  var postal = (document.getElementById('co-postal') || {}).value || '';
  var notes = (document.getElementById('co-notes') || {}).value || '';
  var errEl = document.getElementById('checkout-error');
  var btn = document.getElementById('checkout-submit-btn');

  name = name.trim();
  email = email.trim();
  if (!name || !email) {
    if (errEl) {
      errEl.textContent = 'Name and email are required.';
      errEl.classList.remove('hidden');
    }
    return;
  }

  var items = cart.map(function (item) {
    return {
      productId: item.productId,
      name: item.name,
      price: Number(item.price),
      qty: item.qty || 1,
      size: item.size || '',
      color: item.color || ''
    };
  });

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Redirecting to payment…';
  }
  if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }

  try {
    if (!window.sb || !window.SB_URL) {
      throw new Error('Store is offline. Try again later.');
    }

    var headers = {
      'Content-Type': 'application/json',
      'apikey': window.SB_ANON_KEY || '',
      'Authorization': 'Bearer ' + (window.SB_ANON_KEY || '')
    };
    try {
      var sess = await window.sb.auth.getSession();
      var token = sess.data && sess.data.session && sess.data.session.access_token;
      if (token) headers.Authorization = 'Bearer ' + token;
    } catch (e) {}

    // Public site origin for Stripe success/cancel return (not capacitor://)
    var origin = (window.SB_SITE_URL || '').replace(/\/$/, '');
    if (!origin && /^https?:/i.test(location.protocol)) {
      origin = location.origin;
    }
    if (!origin) {
      origin = 'https://sbracing.ca';
    }

    var res = await fetch(window.SB_URL + '/functions/v1/create-checkout-session', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        items: items,
        origin: origin,
        customer: {
          name: name,
          email: email,
          phone: phone || null,
          address: address || null,
          city: city || null,
          province: province || null,
          postal: postal || null,
          notes: notes || null
        }
      })
    });

    var data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      throw new Error((data && data.error) || ('Payment setup failed (' + res.status + ')'));
    }
    if (!data.url) {
      throw new Error('No payment URL returned. Check Stripe keys on the server.');
    }

    // Keep cart until paid — success page clears it
    try {
      sessionStorage.setItem('sb_checkout_pending', '1');
    } catch (e) {}

    closeCheckoutModal();
    showToast('Opening secure Stripe checkout…');
    window.location.href = data.url;
  } catch (err) {
    console.error('[checkout]', err);
    if (errEl) {
      errEl.textContent = err.message || 'Could not start payment.';
      errEl.classList.remove('hidden');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Pay with card';
    }
  }
}

/** After Stripe redirects back to merch.html?checkout=success */
function handleStripeCheckoutReturn() {
  try {
    var q = new URLSearchParams(location.search);
    var status = q.get('checkout');
    if (!status) return;
    if (status === 'success') {
      cart = [];
      saveCart();
      try { sessionStorage.removeItem('sb_checkout_pending'); } catch (e) {}
      showToast('Payment received — thank you! We’ll process your order soon.');
      if (typeof loadProducts === 'function') {
        setTimeout(function () { try { loadProducts(); } catch (e) {} }, 400);
      }
    } else if (status === 'cancel') {
      showToast('Payment cancelled — your cart is still here.', true);
    }
    if (window.history && history.replaceState) {
      history.replaceState(null, '', location.pathname);
    }
  } catch (e) {
    console.warn('[checkout] return', e);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', handleStripeCheckoutReturn);
} else {
  handleStripeCheckoutReturn();
}

// Escape closes modals
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        const open = document.querySelectorAll('.fixed.inset-0:not(.hidden)');
        if (open.length > 0) {
            const el = open[open.length - 1];
            el.classList.add('hidden');
            el.classList.remove('flex');
        }
    }
});

// ---------- Auth status in nav ----------
async function updateNavAuth(forcedUser) {
    // Prefer the right-side actions cluster (#nav-actions)
    const actions = document.getElementById('nav-actions') ||
        document.getElementById('native-header-actions') ||
        document.querySelector('#navbar .nav-row > div:last-child') ||
        document.querySelector('#navbar .flex.items-center.gap-x-3, #navbar .flex.items-center.gap-x-4');
    if (!actions) {
        console.warn('[nav-auth] actions row not found');
        return;
    }

    let slot = document.getElementById('nav-auth');
    if (!slot) {
        slot = document.createElement('div');
        slot.id = 'nav-auth';
        slot.className = 'flex items-center';
        // Place after cart, before hamburger / JOIN
        const cartEl = document.getElementById('nav-cart-desktop') || document.getElementById('nav-cart-native');
        const joinEl = actions.querySelector('a[href="join.html"]');
        if (cartEl && cartEl.nextSibling) {
            actions.insertBefore(slot, cartEl.nextSibling);
        } else if (joinEl) {
            actions.insertBefore(slot, joinEl);
        } else {
            actions.appendChild(slot);
        }
    }

    // Mobile menu slot
    let mobileSlot = document.getElementById('nav-auth-mobile');
    if (!mobileSlot) {
        const mobileMenu = document.querySelector('#mobile-menu .flex.flex-col, #mobile-menu > div');
        if (mobileMenu) {
            mobileSlot = document.createElement('div');
            mobileSlot.id = 'nav-auth-mobile';
            mobileSlot.className = 'pt-3 border-t border-zinc-800 mt-2';
            mobileMenu.appendChild(mobileSlot);
        }
    }

    let user = forcedUser || null;
    let profile = null;
    try {
        if (!user && window.sb) {
            const { data: { session } } = await window.sb.auth.getSession();
            user = session?.user || null;
        }
        if (user && typeof getProfile === 'function') {
            try {
                profile = await getProfile(user.id);
            } catch (_) { /* ignore profile errors for nav */ }
        }
    } catch (e) {
        console.warn('[nav-auth] session check failed', e);
    }

    console.log('[nav-auth] user:', user ? (user.email || user.id) : null);

    // Desktop JOIN CTA
    const desktopJoin = Array.from(document.querySelectorAll('#navbar a[href="join.html"]'))
        .find(a => (a.className || '').includes('bg-white') || (a.textContent || '').includes('JOIN THE CREW'));

    const websiteOnly = !isNativeAppShell();

    if (user) {
        const rawName = profile?.full_name || (user.email ? user.email.split('@')[0] : 'Member');
        const name = String(rawName).split(' ')[0];
        const email = user.email || '';
        const display = name.length > 14 ? name.slice(0, 12) + '…' : name;
        const initial = (display.charAt(0) || 'M').toUpperCase();

        const avatarUrl = (profile && profile.avatar_url) ? profile.avatar_url : '';
        const avatarHtml = avatarUrl
            ? `<img src="${escapeAttrNav(avatarUrl)}" alt="" class="w-8 h-8 rounded-full object-cover bg-zinc-800" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="w-8 h-8 rounded-full bg-orange-600 text-white hidden items-center justify-center text-xs font-bold">${initial}</span>`
            : `<span class="w-8 h-8 rounded-full bg-orange-600 text-white flex items-center justify-center text-xs font-bold">${initial}</span>`;
        const avatarHtmlLg = avatarUrl
            ? `<img src="${escapeAttrNav(avatarUrl)}" alt="" class="w-9 h-9 rounded-full object-cover bg-zinc-800" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="w-9 h-9 rounded-full bg-orange-600 text-white hidden items-center justify-center font-bold">${initial}</span>`
            : `<span class="w-9 h-9 rounded-full bg-orange-600 text-white flex items-center justify-center font-bold">${initial}</span>`;

        // Website-only: change password control in the nav
        const changePwDesktop = websiteOnly
            ? `<button type="button" onclick="openChangePasswordModal()" class="hidden md:inline-flex items-center gap-x-1.5 px-2.5 py-1.5 rounded-xl text-xs text-zinc-400 hover:text-white hover:bg-zinc-800/80 transition-all border border-transparent hover:border-zinc-700" title="Change password">
                    <i class="fa-solid fa-key text-[10px]"></i>
                    <span>Password</span>
               </button>`
            : '';

        slot.style.display = 'flex';
        slot.innerHTML = `
            <div class="flex items-center gap-x-1.5">
                <a href="members.html" class="relative flex items-center gap-x-2 px-1.5 py-1 rounded-2xl hover:bg-zinc-800/80 transition-all" title="${escapeAttrNav(email)}">
                    <span class="relative inline-flex">
                        ${avatarHtml}
                        <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-zinc-900" title="Logged in"></span>
                    </span>
                    <span class="text-sm font-medium max-w-[100px] truncate hidden md:inline pl-1">${escapeHtmlNav(display)}</span>
                </a>
                ${changePwDesktop}
            </div>`;

        if (desktopJoin) desktopJoin.style.display = 'none';

        if (mobileSlot) {
            const changePwMobile = websiteOnly
                ? `<button type="button" onclick="openChangePasswordModal(); try{toggleMobileMenu()}catch(e){}" class="mt-2 w-full text-left px-4 py-3 rounded-2xl hover:bg-zinc-800 text-zinc-300 text-sm">
                        <i class="fa-solid fa-key mr-2"></i> Change password
                   </button>`
                : '';
            mobileSlot.innerHTML = `
                <a href="members.html" class="flex items-center gap-x-3 px-4 py-3 rounded-2xl bg-zinc-800/80">
                    <span class="relative inline-flex">${avatarHtmlLg}</span>
                    <div class="min-w-0">
                        <div class="font-medium truncate">${escapeHtmlNav(profile?.full_name || display)}</div>
                        <div class="text-xs text-emerald-400">Logged in</div>
                    </div>
                </a>
                ${changePwMobile}
                <button type="button" onclick="navLogout()" class="mt-2 w-full text-left px-4 py-3 rounded-2xl hover:bg-zinc-800 text-zinc-400 text-sm">
                    <i class="fa-solid fa-right-from-bracket mr-2"></i> Log out
                </button>`;
        }
    } else {
        // Website-only: reset password link when logged out
        const resetPwDesktop = websiteOnly
            ? `<button type="button" onclick="openResetPasswordModal()" class="hidden sm:inline-flex items-center gap-x-1.5 px-2.5 py-1.5 rounded-xl text-xs text-zinc-500 hover:text-zinc-300 transition-all" title="Reset password">
                    <i class="fa-solid fa-key text-[10px]"></i>
                    <span>Reset password</span>
               </button>`
            : '';

        slot.style.display = 'flex';
        slot.innerHTML = `
            <div class="flex items-center gap-x-1.5">
                <a href="members.html" class="flex items-center gap-x-2 px-3 py-1.5 rounded-2xl border border-zinc-700 hover:border-zinc-500 text-sm text-zinc-400 hover:text-white transition-all">
                    <i class="fa-solid fa-user text-xs"></i>
                    <span class="hidden sm:inline">Log in</span>
                </a>
                ${resetPwDesktop}
            </div>`;

        if (desktopJoin) desktopJoin.style.display = '';

        if (mobileSlot) {
            const resetPwMobile = websiteOnly
                ? `<button type="button" onclick="openResetPasswordModal(); try{toggleMobileMenu()}catch(e){}" class="mt-2 w-full text-left px-4 py-3 rounded-2xl hover:bg-zinc-800 text-zinc-400 text-sm">
                        <i class="fa-solid fa-key mr-2"></i> Reset password
                   </button>`
                : '';
            mobileSlot.innerHTML = `
                <a href="members.html" class="flex items-center gap-x-2 px-4 py-3 rounded-2xl hover:bg-zinc-800 text-zinc-300">
                    <i class="fa-solid fa-user"></i>
                    <span>Log in</span>
                </a>
                ${resetPwMobile}`;
        }
    }
}


async function navLogout() {
    try {
        if (window.sb) {
            await window.sb.auth.signOut();
        }

    } catch (e) {
        console.warn(e);
    }
    localStorage.removeItem('sb_member');
    showToast('Logged out');
    await updateNavAuth();
    // If on members page, refresh so dashboard hides
    if (window.location.pathname.includes('members')) {
        window.location.reload();
    }
}

function escapeHtmlNav(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttrNav(str) {
    return escapeHtmlNav(str).replace(/'/g, '&#39;');
}

// ---------- Password change / reset (website only) ----------
function ensurePasswordModal() {
    if (document.getElementById('password-modal')) return;
    var wrap = document.createElement('div');
    wrap.id = 'password-modal';
    wrap.className = 'fixed inset-0 z-[200] hidden items-center justify-center p-4';
    wrap.style.cssText = 'display:none;background:rgba(0,0,0,0.75);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);';
    wrap.innerHTML =
        '<div class="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-3xl shadow-2xl overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="pw-modal-title">' +
        '  <div class="px-6 py-5 border-b border-zinc-800 flex items-center justify-between">' +
        '    <h3 id="pw-modal-title" class="text-lg font-semibold tracking-tight">Password</h3>' +
        '    <button type="button" onclick="closePasswordModal()" class="w-9 h-9 rounded-xl hover:bg-zinc-800 flex items-center justify-center text-zinc-400" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>' +
        '  </div>' +
        '  <div class="px-6 py-5 space-y-4">' +
        '    <p id="pw-modal-desc" class="text-sm text-zinc-400"></p>' +
        '    <div id="pw-reset-fields" class="hidden space-y-3">' +
        '      <div>' +
        '        <label class="text-xs font-medium tracking-widest text-zinc-400">EMAIL</label>' +
        '        <input type="email" id="pw-reset-email" autocomplete="email" placeholder="you@email.com" class="mt-1.5 w-full bg-zinc-950 border border-zinc-700 rounded-2xl px-5 py-3 text-sm outline-none focus:border-orange-600">' +
        '      </div>' +
        '    </div>' +
        '    <div id="pw-change-fields" class="hidden space-y-3">' +
        '      <div>' +
        '        <label class="text-xs font-medium tracking-widest text-zinc-400">NEW PASSWORD</label>' +
        '        <input type="password" id="pw-new" autocomplete="new-password" minlength="6" placeholder="Min 6 characters" class="mt-1.5 w-full bg-zinc-950 border border-zinc-700 rounded-2xl px-5 py-3 text-sm outline-none focus:border-orange-600">' +
        '      </div>' +
        '      <div>' +
        '        <label class="text-xs font-medium tracking-widest text-zinc-400">CONFIRM NEW PASSWORD</label>' +
        '        <input type="password" id="pw-new-confirm" autocomplete="new-password" minlength="6" placeholder="Repeat password" class="mt-1.5 w-full bg-zinc-950 border border-zinc-700 rounded-2xl px-5 py-3 text-sm outline-none focus:border-orange-600">' +
        '      </div>' +
        '    </div>' +
        '    <p id="pw-modal-msg" class="text-sm hidden"></p>' +
        '  </div>' +
        '  <div class="px-6 py-4 border-t border-zinc-800 flex gap-3 justify-end">' +
        '    <button type="button" onclick="closePasswordModal()" class="px-4 py-2.5 rounded-2xl text-sm text-zinc-400 hover:text-white hover:bg-zinc-800">Cancel</button>' +
        '    <button type="button" id="pw-modal-submit" class="px-5 py-2.5 rounded-2xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold">Submit</button>' +
        '  </div>' +
        '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) {
        if (e.target === wrap) closePasswordModal();
    });
}

var _pwModalMode = null; // 'reset' | 'change' | 'recovery'

function openPasswordModal(mode) {
    if (typeof isNativeAppShell === 'function' && isNativeAppShell()) {
        showToast('Password changes are available on the website', true);
        return;
    }
    ensurePasswordModal();
    _pwModalMode = mode || 'reset';
    var modal = document.getElementById('password-modal');
    var title = document.getElementById('pw-modal-title');
    var desc = document.getElementById('pw-modal-desc');
    var resetFields = document.getElementById('pw-reset-fields');
    var changeFields = document.getElementById('pw-change-fields');
    var msg = document.getElementById('pw-modal-msg');
    var submit = document.getElementById('pw-modal-submit');

    if (msg) {
        msg.classList.add('hidden');
        msg.textContent = '';
    }

    if (_pwModalMode === 'reset') {
        if (title) title.textContent = 'Reset password';
        if (desc) desc.textContent = 'Enter the email on your account. We\'ll send a link to set a new password.';
        if (resetFields) resetFields.classList.remove('hidden');
        if (changeFields) changeFields.classList.add('hidden');
        if (submit) {
            submit.textContent = 'Send reset link';
            submit.onclick = submitResetPassword;
        }
        var emailInput = document.getElementById('pw-reset-email');
        if (emailInput && !emailInput.value) {
            try {
                var loginEmail = document.getElementById('login-email');
                if (loginEmail && loginEmail.value) emailInput.value = loginEmail.value.trim();
            } catch (e) {}
        }
        setTimeout(function () { try { document.getElementById('pw-reset-email').focus(); } catch (e) {} }, 50);
    } else {
        // change or recovery (set new password while session is recovery/authenticated)
        if (title) title.textContent = _pwModalMode === 'recovery' ? 'Set new password' : 'Change password';
        if (desc) desc.textContent = _pwModalMode === 'recovery'
            ? 'Choose a new password for your account.'
            : 'Enter a new password for your account (min 6 characters).';
        if (resetFields) resetFields.classList.add('hidden');
        if (changeFields) changeFields.classList.remove('hidden');
        var n1 = document.getElementById('pw-new');
        var n2 = document.getElementById('pw-new-confirm');
        if (n1) n1.value = '';
        if (n2) n2.value = '';
        if (submit) {
            submit.textContent = 'Update password';
            submit.onclick = submitChangePassword;
        }
        setTimeout(function () { try { document.getElementById('pw-new').focus(); } catch (e) {} }, 50);
    }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
}

function openResetPasswordModal() {
    openPasswordModal('reset');
}

function openChangePasswordModal() {
    openPasswordModal('change');
}

function closePasswordModal() {
    var modal = document.getElementById('password-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.style.display = 'none';
    _pwModalMode = null;
}

async function submitResetPassword() {
    if (!window.sb) {
        showToast('Auth not ready — try again', true);
        return;
    }
    var emailEl = document.getElementById('pw-reset-email');
    var email = (emailEl && emailEl.value || '').trim();
    if (!email || email.indexOf('@') === -1) {
        showToast('Enter a valid email', true);
        return;
    }
    var submit = document.getElementById('pw-modal-submit');
    var msg = document.getElementById('pw-modal-msg');
    if (submit) {
        submit.disabled = true;
        submit.textContent = 'Sending…';
    }
    try {
        // Redirect back to members page so recovery session is picked up on the website
        var redirectTo = (window.location.origin || '') + (window.location.pathname.indexOf('/') === 0
            ? window.location.pathname.replace(/[^/]+$/, 'members.html')
            : '/members.html');
        if (!/members\.html/i.test(redirectTo)) {
            redirectTo = (window.location.origin || '') + '/members.html';
        }
        var { error } = await window.sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo });
        if (error) throw error;
        if (msg) {
            msg.classList.remove('hidden');
            msg.className = 'text-sm text-emerald-400';
            msg.textContent = 'Check your email for a reset link. It may take a minute.';
        }
        showToast('Reset link sent — check your email');
        if (submit) {
            submit.textContent = 'Sent';
            setTimeout(closePasswordModal, 1800);
        }
    } catch (err) {
        console.warn('[password] reset', err);
        showToast((err && err.message) || 'Could not send reset email', true);
        if (submit) {
            submit.disabled = false;
            submit.textContent = 'Send reset link';
        }
    }
}

async function submitChangePassword() {
    if (!window.sb) {
        showToast('Auth not ready — try again', true);
        return;
    }
    var p1 = (document.getElementById('pw-new') && document.getElementById('pw-new').value) || '';
    var p2 = (document.getElementById('pw-new-confirm') && document.getElementById('pw-new-confirm').value) || '';
    if (p1.length < 6) {
        showToast('Password must be at least 6 characters', true);
        return;
    }
    if (p1 !== p2) {
        showToast('Passwords do not match', true);
        return;
    }
    var submit = document.getElementById('pw-modal-submit');
    if (submit) {
        submit.disabled = true;
        submit.textContent = 'Updating…';
    }
    try {
        var { data, error } = await window.sb.auth.updateUser({ password: p1 });
        if (error) throw error;
        showToast('Password updated');
        closePasswordModal();
        // Clear recovery hash from URL if present
        try {
            if (window.history && window.history.replaceState && (location.hash || location.search)) {
                var clean = location.pathname + location.search.replace(/[?&](type|access_token|refresh_token|expires_in|token_type)=[^&]*/g, '').replace(/^&/, '?');
                if (clean.endsWith('?')) clean = clean.slice(0, -1);
                window.history.replaceState({}, document.title, clean || location.pathname);
            }
        } catch (e) {}
    } catch (err) {
        console.warn('[password] update', err);
        showToast((err && err.message) || 'Could not update password', true);
        if (submit) {
            submit.disabled = false;
            submit.textContent = 'Update password';
        }
    }
}

/** If user lands from Supabase recovery email, open set-new-password modal */
function handlePasswordRecoveryFromUrl() {
    if (typeof isNativeAppShell === 'function' && isNativeAppShell()) return;
    try {
        var hash = String(location.hash || '');
        var search = String(location.search || '');
        var isRecovery = /type=recovery/i.test(hash) || /type=recovery/i.test(search);
        if (!isRecovery && window.sb && window.sb.auth) {
            // Also listen once for PASSWORD_RECOVERY event
            window.sb.auth.onAuthStateChange(function (event) {
                if (event === 'PASSWORD_RECOVERY') {
                    openPasswordModal('recovery');
                }
            });
        }
        if (isRecovery) {
            // Give client a moment to parse tokens from URL
            setTimeout(function () { openPasswordModal('recovery'); }, 400);
        }
    } catch (e) {
        console.warn('[password] recovery check', e);
    }
}

/** True only inside the Capacitor iOS/Android shell — not mobile Safari/Chrome */
function isNativeAppShell() {
    try {
        var proto = String(window.location.protocol || '');
        if (proto === 'capacitor:' || proto === 'ionic:') return true;
    } catch (e0) {}
    try {
        if (window.Capacitor) {
            if (typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform()) return true;
            var p = typeof Capacitor.getPlatform === 'function' ? Capacitor.getPlatform() : '';
            if (p === 'ios' || p === 'android') return true;
        }
    } catch (e) {}
    try {
        if (window.cordova && /ios|android/i.test(String(window.cordova.platformId || ''))) return true;
    } catch (e2) {}
    return false;
}

function ensureBottomTabsEl() {
    var existing = document.getElementById('bottom-tabs');
    if (existing) return existing;
    var nav = document.createElement('nav');
    nav.id = 'bottom-tabs';
    nav.setAttribute('aria-hidden', 'true');
    nav.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;z-index:100;background:rgba(9,9,11,0.95);border-top:1px solid #27272a;padding-bottom:env(safe-area-inset-bottom,0px);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);';
    nav.innerHTML =
      '<div style="display:flex;align-items:stretch;justify-content:space-around;height:56px;max-width:32rem;margin:0 auto;">' +
      tabLink('forum.html', 'fa-comments', 'HQ') +
      tabLink('events.html', 'fa-calendar-days', 'Events') +
      tabLink('trails.html', 'fa-route', 'Trails') +
      tabLink('members.html', 'fa-users', 'Members') +
      tabLink('merch.html', 'fa-shirt', 'Merch') +
      '</div>';
    document.body.appendChild(nav);
    return nav;
}

function tabLink(href, icon, label) {
    return (
      '<a href="' + href + '" class="bottom-tab" data-tab="' + href + '" ' +
      'style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:10px;font-weight:500;color:#71717a;text-decoration:none;-webkit-tap-highlight-color:transparent;">' +
      '<i class="fa-solid ' + icon + '" style="font-size:18px;margin-bottom:2px;"></i>' +
      '<span>' + label + '</span></a>'
    );
}

/** Website keeps full nav. Native app: same navbar, hide menu pieces only. */
function applyNavShell() {
    var native = isNativeAppShell();
    document.documentElement.classList.toggle('is-native-app', native);
    if (document.body) document.body.classList.toggle('is-native-app', native);

    // Remove any old injected native-only bars
    var extra = document.getElementById('native-topbar');
    if (extra) extra.remove();

    var tabs = ensureBottomTabsEl();
    if (native) {
        tabs.style.setProperty('display', 'block', 'important');
        tabs.setAttribute('aria-hidden', 'false');
        hideWebsiteMenuForNative();
    } else {
        tabs.style.setProperty('display', 'none', 'important');
        tabs.setAttribute('aria-hidden', 'true');
        showWebsiteMenuForWeb();
    }

    try {
        var pathName = (window.location.pathname.split('/').pop() || 'index.html');
        tabs.querySelectorAll('.bottom-tab').forEach(function (tab) {
            var href = tab.getAttribute('href') || tab.getAttribute('data-tab');
            var active = href === pathName;
            tab.classList.toggle('bottom-tab-active', active);
            tab.style.color = active ? '#f97316' : '#71717a';
            if (!tab.dataset.hapticBound) {
                tab.dataset.hapticBound = '1';
                tab.addEventListener('click', function () { hapticSelection(); }, { passive: true });
            }
        });
    } catch (e) {}

    console.log('[nav] shell=', native ? 'native-app' : 'website', 'protocol=', location.protocol);
}

/** Hide only menu pieces — keep logo, cart, avatar (real website header). */
function hideWebsiteMenuForNative() {
    var navbar = document.getElementById('navbar');
    if (!navbar) return;

    navbar.style.removeProperty('display');
    navbar.style.setProperty('display', 'block', 'important');
    navbar.style.setProperty('visibility', 'visible', 'important');
    navbar.style.setProperty('opacity', '1', 'important');

    // Logo goes to app home (Soggy Scoop), not the website index
    navbar.querySelectorAll('a[href="index.html"]').forEach(function (a) {
        a.setAttribute('href', 'home.html');
    });

    // Hide every text nav link (About, Merch, Events, HQ, Trails, Members, Join, Cart text link)
    navbar.querySelectorAll('a.nav-link, button.nav-link').forEach(function (el) {
        el.style.setProperty('display', 'none', 'important');
    });

    // Hide the whole desktop links container if present
    var row = navbar.querySelector('.nav-row');
    if (row) {
        Array.prototype.forEach.call(row.children, function (kid) {
            // Middle column: has multiple .nav-link children
            if (kid.querySelectorAll && kid.querySelectorAll('a.nav-link, button.nav-link').length >= 2) {
                kid.style.setProperty('display', 'none', 'important');
            }
        });
    }

    // Hamburger
    navbar.querySelectorAll('button[onclick*="toggleMobileMenu"]').forEach(function (btn) {
        btn.style.setProperty('display', 'none', 'important');
    });

    // Mobile dropdown
    var mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenu) {
        mobileMenu.classList.add('hidden');
        mobileMenu.style.setProperty('display', 'none', 'important');
    }

    // JOIN THE CREW button
    navbar.querySelectorAll('a[href="join.html"]').forEach(function (a) {
        a.style.setProperty('display', 'none', 'important');
    });

    // Mobile menu links (if menu somehow visible)
    document.querySelectorAll('#mobile-menu a, #mobile-menu button').forEach(function (el) {
        // whole menu already hidden
    });

    // Right-side actions: show cart + avatar only
    var actions = navbar.querySelector('.nav-row > div:last-child') ||
        navbar.querySelector('.flex.items-center.gap-x-4');
    if (actions) {
        actions.style.setProperty('display', 'flex', 'important');
        actions.style.setProperty('align-items', 'center', 'important');
        actions.style.setProperty('gap', '0.75rem', 'important');

        // Single cart only: force the real desktop cart button visible; remove any extra
        document.querySelectorAll('#nav-cart-native').forEach(function (el) { el.remove(); });
        var deskCart = document.getElementById('nav-cart-desktop');
        if (!deskCart) {
            deskCart = document.createElement('button');
            deskCart.type = 'button';
            deskCart.id = 'nav-cart-desktop';
            deskCart.setAttribute('onclick', 'showCart()');
            deskCart.setAttribute('aria-label', 'Cart');
            deskCart.className = 'inline-flex items-center justify-center relative w-11 h-11 rounded-2xl bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 active:scale-95 transition-all';
            deskCart.innerHTML =
                '<i class="fa-solid fa-shopping-cart text-lg"></i>' +
                '<span id="cart-count" class="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-mono bg-orange-600 text-white rounded-full px-1">0</span>';
            var authSlot = document.getElementById('nav-auth');
            if (authSlot && authSlot.parentElement === actions) {
                actions.insertBefore(deskCart, authSlot);
            } else {
                actions.insertBefore(deskCart, actions.firstChild);
            }
        }
        deskCart.classList.remove('hidden');
        deskCart.style.setProperty('display', 'inline-flex', 'important');

        // Notification bell (same treatment as cart on native)
        var deskNotif = document.getElementById('nav-notif-desktop');
        if (!deskNotif) {
            deskNotif = document.createElement('button');
            deskNotif.type = 'button';
            deskNotif.id = 'nav-notif-desktop';
            deskNotif.setAttribute('aria-label', 'Notifications');
            deskNotif.setAttribute('onclick', 'showNotifications()');
            deskNotif.className = 'inline-flex items-center justify-center relative w-11 h-11 rounded-2xl bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 active:scale-95 transition-all';
            deskNotif.innerHTML =
                '<i class="fa-solid fa-bell text-lg"></i>' +
                '<span id="notif-count" class="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-mono bg-orange-600 text-white rounded-full px-1 hidden">0</span>';
            if (deskCart && deskCart.parentElement === actions) {
                actions.insertBefore(deskNotif, deskCart);
            } else {
                actions.insertBefore(deskNotif, actions.firstChild);
            }
        }
        deskNotif.classList.remove('hidden');
        deskNotif.style.setProperty('display', 'inline-flex', 'important');

        if (!document.getElementById('nav-auth')) {
            var auth = document.createElement('div');
            auth.id = 'nav-auth';
            auth.className = 'flex items-center';
            actions.appendChild(auth);
        }
    }


    // Hide any leftover lock icons in the header
    navbar.querySelectorAll('.fa-lock').forEach(function (ic) {
        var wrap = ic.closest('a, button, span') || ic;
        if (wrap && !wrap.closest('#nav-auth')) {
            // don't strip avatar area
            var parentLink = ic.closest('a.nav-link');
            if (parentLink) parentLink.style.setProperty('display', 'none', 'important');
        }
    });

    // Pin actions to the right of the header
    var row = navbar.querySelector('.nav-row');
    if (row) {
        row.style.setProperty('display', 'flex', 'important');
        row.style.setProperty('justify-content', 'space-between', 'important');
        row.style.setProperty('align-items', 'center', 'important');
        row.style.setProperty('width', '100%', 'important');
    }
    if (actions) {
        actions.style.setProperty('margin-left', 'auto', 'important');
    }

    try { if (typeof updateCartCount === 'function') updateCartCount(); } catch (e) {}
    try { if (typeof updateNotifCount === 'function') updateNotifCount(); } catch (e) {}
    setTimeout(function () { try { updateNavAuth(); } catch (e2) {} }, 100);
    setTimeout(function () { try { updateNavAuth(); } catch (e3) {} }, 500);
}

function showWebsiteMenuForWeb() {
    var navbar = document.getElementById('navbar');
    if (!navbar) return;
    navbar.style.removeProperty('display');
    navbar.querySelectorAll('button[onclick*="toggleMobileMenu"]').forEach(function (btn) {
        btn.style.removeProperty('display');
    });
    var mm = document.getElementById('mobile-menu');
    if (mm) mm.style.removeProperty('display');
    var nativeOnly = document.getElementById('nav-cart-native');
    if (nativeOnly) nativeOnly.remove();
    var desk = document.getElementById('nav-cart-desktop');
    if (desk) {
        desk.classList.add('hidden');
        desk.classList.add('md:inline-flex');
        desk.style.removeProperty('display');
    }
}


function startNavShellWatch() {
    applyNavShell();
    var tries = 0;
    var timer = setInterval(function () {
        tries += 1;
        applyNavShell();
        if (isNativeAppShell() || tries >= 25) clearInterval(timer);
    }, 120);
    window.addEventListener('load', applyNavShell);
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadSiteNav();
    await loadSiteFooter();
    ensureCartUi();
    armHapticsRetry();
    startNavShellWatch();
    ensureTrailsNavLink();
    updateNavCartVisibility();
    initNavbar();
    setActiveNav();
    updateCartCount();
    try { updateNotifCount(); } catch (e) {}
    ensureNotifUi();

    // Re-sync home-screen badge when returning from background
    try {
      if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App) {
        Capacitor.Plugins.App.addListener('appStateChange', function (state) {
          if (state && state.isActive) {
            try { updateNotifCount(); } catch (e) {}
          }
        });
      } else if (window.Capacitor && typeof Capacitor.registerPlugin === 'function') {
        var App = Capacitor.registerPlugin('App');
        if (App && App.addListener) {
          App.addListener('appStateChange', function (state) {
            if (state && state.isActive) {
              try { updateNotifCount(); } catch (e) {}
            }
          });
        }
      }
    } catch (e) {}

    const bootAuth = () => {
        const client = window.sb;
        if (!client) return false;
        updateNavAuth();
        client.auth.onAuthStateChange((event, session) => {
            console.log('[nav-auth] event:', event);
            updateNavAuth(session?.user || null);
            if (event === 'PASSWORD_RECOVERY') {
                try { openPasswordModal('recovery'); } catch (e) {}
            }
        });
        try { handlePasswordRecoveryFromUrl(); } catch (e) {}
        return true;
    };
    if (!bootAuth()) {
        setTimeout(bootAuth, 50);
        setTimeout(bootAuth, 200);
        setTimeout(bootAuth, 500);
        setTimeout(bootAuth, 1200);
    }
});




