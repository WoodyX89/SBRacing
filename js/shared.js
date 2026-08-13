
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
  // Cart lives in desktop nav links + mobile hamburger menu on ALL pages.
  // Header action-row cart is intentionally not used.
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

// Load shared footer + cart drawer + toast from partials/footer.html
async function loadSiteFooter() {
    const mount = document.getElementById('site-footer');
    if (!mount) return;
    const candidates = [
        'partials/footer.html',
        './partials/footer.html',
        '/partials/footer.html'
    ];
    let lastErr = null;
    for (const url of candidates) {
        try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (!res.ok) throw new Error('footer ' + res.status + ' ' + url);
            mount.innerHTML = await res.text();
            return;
        } catch (e) {
            lastErr = e;
        }
    }
    console.error('[footer] failed to load partials/footer.html', lastErr);
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

function updateCartCount() {
  var n = cartItemCount();
  ['cart-count', 'cart-count-mobile', 'cart-count-native'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.textContent = n;
  });
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
      size: size,
      color: (opts.color || '').trim()
    });
  }
  saveCart();
  var color = (opts.color || '').trim();
  var bits = [];
  if (color) bits.push(color);
  if (size) bits.push(size);
  var label = bits.length ? name + ' (' + bits.join(' · ') + ')' : name;
  showToast(label + ' added to cart');
}

function showCart() {
  var drawer = document.getElementById('cart-drawer');
  if (!drawer) {
    window.location.href = 'merch.html';
    return;
  }
  var itemsContainer = document.getElementById('cart-items');
  if (!itemsContainer) return;
  itemsContainer.innerHTML = '';

  if (cart.length === 0) {
    itemsContainer.innerHTML =
      '<div class="flex flex-col items-center justify-center h-full text-center py-12">' +
      '<i class="fa-solid fa-shopping-cart text-5xl text-zinc-700 mb-4"></i>' +
      '<p class="text-zinc-400">Your cart is empty</p></div>';
    var totEl = document.getElementById('cart-total');
    if (totEl) totEl.textContent = '$0.00';
  } else {
    cart.forEach(function (item, index) {
      var line = (Number(item.price) || 0) * (item.qty || 1);
      var metaBits = [];
      if (item.color) metaBits.push(escapeCartHtml(item.color));
      if (item.size) metaBits.push('Size ' + escapeCartHtml(item.size));
      var sizeHtml = metaBits.length
        ? '<div class="text-[11px] text-zinc-500 mt-0.5">' + metaBits.join(' · ') + '</div>'
        : '';
      itemsContainer.innerHTML +=
        '<div class="flex gap-3 items-start bg-zinc-950 border border-zinc-700 rounded-2xl p-4">' +
        '<div class="flex-1 min-w-0">' +
        '<div class="font-medium truncate">' + escapeCartHtml(item.name) + '</div>' +
        sizeHtml +
        '<div class="font-mono text-xs text-orange-500 mt-1">$' + Number(item.price).toFixed(2) + ' each</div>' +
        '<div class="flex items-center gap-2 mt-3">' +
        '<button type="button" onclick="changeCartQty(' + index + ', -1)" class="w-8 h-8 rounded-xl border border-zinc-700 hover:bg-zinc-800 text-sm">−</button>' +
        '<span class="w-8 text-center text-sm font-mono">' + item.qty + '</span>' +
        '<button type="button" onclick="changeCartQty(' + index + ', 1)" class="w-8 h-8 rounded-xl border border-zinc-700 hover:bg-zinc-800 text-sm">+</button>' +
        '</div></div>' +
        '<div class="text-right shrink-0">' +
        '<div class="font-mono text-sm">$' + line.toFixed(2) + '</div>' +
        '<button type="button" onclick="removeFromCart(' + index + ')" class="mt-2 text-xs text-red-400 hover:text-red-300">' +
        '<i class="fa-solid fa-trash"></i></button></div></div>';
    });
    var totEl2 = document.getElementById('cart-total');
    if (totEl2) totEl2.textContent = '$' + cartTotal().toFixed(2);
  }
  drawer.classList.remove('hidden');
  drawer.classList.add('flex');
}

function changeCartQty(index, delta) {
  if (!cart[index]) return;
  cart[index].qty = Math.max(1, (cart[index].qty || 1) + delta);
  if (cart[index].qty <= 0) cart.splice(index, 1);
  saveCart();
  showCart();
}

function removeFromCart(index) {
  cart.splice(index, 1);
  saveCart();
  showCart();
}

function hideCart() {
  var drawer = document.getElementById('cart-drawer');
  if (drawer) {
    drawer.classList.remove('flex');
    drawer.classList.add('hidden');
  }
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

  var total = cartTotal();
  var items = cart.map(function (item) {
    return {
      productId: item.productId,
      name: item.name,
      price: Number(item.price),
      qty: item.qty || 1,
      size: item.size || ''
    };
  });

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Placing order…';
  }
  if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }

  var userId = null;
  try {
    if (window.sb && window.sb.auth) {
      var sess = await window.sb.auth.getSession();
      userId = sess.data && sess.data.session && sess.data.session.user
        ? sess.data.session.user.id
        : null;
    }
  } catch (e) {}

  try {
    if (!window.sb) throw new Error('Store is offline. Try again later.');

    var payload = {
      user_id: userId,
      customer_name: name,
      customer_email: email,
      customer_phone: phone || null,
      shipping_address: address || null,
      shipping_city: city || null,
      shipping_province: province || null,
      shipping_postal: postal || null,
      notes: notes || null,
      items: items,
      total: total,
      status: 'pending'
    };

    var result = await window.sb.from('orders').insert(payload);
    if (result.error) throw new Error(result.error.message);

    cart = [];
    saveCart();
    closeCheckoutModal();
    showToast('Order placed — $' + total.toFixed(2) + '. We\'ll email you about payment.');
  } catch (err) {
    console.error('[checkout]', err);
    if (errEl) {
      errEl.textContent = err.message || 'Could not place order.';
      errEl.classList.remove('hidden');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Place order';
    }
  }
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
                <button type="button" onclick="navLogout()" class="nav-logout-btn inline-flex items-center justify-center w-9 h-9 rounded-2xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all" title="Log out">
                    <i class="fa-solid fa-right-from-bracket"></i>
                </button>
            </div>`;

        if (desktopJoin) desktopJoin.style.display = 'none';

        if (mobileSlot) {
            mobileSlot.innerHTML = `
                <a href="members.html" class="flex items-center gap-x-3 px-4 py-3 rounded-2xl bg-zinc-800/80">
                    <span class="relative inline-flex">${avatarHtmlLg}</span>
                    <div class="min-w-0">
                        <div class="font-medium truncate">${escapeHtmlNav(profile?.full_name || display)}</div>
                        <div class="text-xs text-emerald-400">Logged in</div>
                    </div>
                </a>
                <button type="button" onclick="navLogout()" class="mt-2 w-full text-left px-4 py-3 rounded-2xl hover:bg-zinc-800 text-zinc-400 text-sm">
                    <i class="fa-solid fa-right-from-bracket mr-2"></i> Log out
                </button>`;
        }
    } else {
        slot.style.display = 'flex';
        slot.innerHTML = `
            <a href="members.html" class="flex items-center gap-x-2 px-3 py-1.5 rounded-2xl border border-zinc-700 hover:border-zinc-500 text-sm text-zinc-400 hover:text-white transition-all">
                <i class="fa-solid fa-user text-xs"></i>
                <span class="hidden sm:inline">Log in</span>
            </a>`;

        if (desktopJoin) desktopJoin.style.display = '';

        if (mobileSlot) {
            mobileSlot.innerHTML = `
                <a href="members.html" class="flex items-center gap-x-2 px-4 py-3 rounded-2xl hover:bg-zinc-800 text-zinc-300">
                    <i class="fa-solid fa-user"></i>
                    <span>Log in</span>
                </a>`;
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

    // Ensure logout icon is visible on native (not desktop-only)
    setTimeout(function () {
        navbar.querySelectorAll('.nav-logout-btn, button[onclick*="navLogout"]').forEach(function (btn) {
            btn.classList.remove('hidden');
            btn.style.setProperty('display', 'inline-flex', 'important');
        });
    }, 150);
    setTimeout(function () {
        navbar.querySelectorAll('.nav-logout-btn, button[onclick*="navLogout"]').forEach(function (btn) {
            btn.classList.remove('hidden');
            btn.style.setProperty('display', 'inline-flex', 'important');
        });
    }, 600);

    try { if (typeof updateCartCount === 'function') updateCartCount(); } catch (e) {}
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
    startNavShellWatch();
    ensureTrailsNavLink();
    updateNavCartVisibility();
    initNavbar();
    setActiveNav();
    updateCartCount();

    const bootAuth = () => {
        const client = window.sb;
        if (!client) return false;
        updateNavAuth();
        client.auth.onAuthStateChange((event, session) => {
            console.log('[nav-auth] event:', event);
            updateNavAuth(session?.user || null);
        });
        return true;
    };
    if (!bootAuth()) {
        setTimeout(bootAuth, 50);
        setTimeout(bootAuth, 200);
        setTimeout(bootAuth, 500);
        setTimeout(bootAuth, 1200);
    }
});




