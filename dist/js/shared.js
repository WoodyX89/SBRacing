
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
    try {
        const res = await fetch('partials/nav.html', { cache: 'no-cache' });
        if (!res.ok) throw new Error('nav ' + res.status);
        mount.innerHTML = await res.text();
        ensureTrailsNavLink();
        updateNavCartVisibility();
    } catch (e) {
        console.error('[nav] failed to load partials/nav.html', e);
        mount.innerHTML = '<nav id="navbar" class="fixed top-0 left-0 right-0 z-[100] bg-black p-4 text-white"><a href="index.html">SB Racing</a> — nav failed to load</nav>';
    }
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
let cart = JSON.parse(localStorage.getItem('sb_cart') || '[]');

function updateCartCount() {
  var n = (typeof cart !== 'undefined' && cart) ? cart.length : 0;
  ['cart-count', 'cart-count-mobile'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.textContent = n;
  });
}

function addToCart(name, price) {
    cart.push({ id: Date.now(), name, price: Number(price) });
    localStorage.setItem('sb_cart', JSON.stringify(cart));
    updateCartCount();
    showToast(`${name} added to cart`);
}

function showCart() {
    const drawer = document.getElementById('cart-drawer');
    if (!drawer) {
        window.location.href = 'merch.html';
        return;
    }
    const itemsContainer = document.getElementById('cart-items');
    itemsContainer.innerHTML = '';

    if (cart.length === 0) {
        itemsContainer.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full text-center py-12">
                <i class="fa-solid fa-shopping-cart text-5xl text-zinc-700 mb-4"></i>
                <p class="text-zinc-400">Your cart is empty</p>
            </div>`;
        document.getElementById('cart-total').textContent = '$0';
    } else {
        let total = 0;
        cart.forEach((item, index) => {
            total += item.price;
            itemsContainer.innerHTML += `
                <div class="flex justify-between items-start bg-zinc-950 border border-zinc-700 rounded-2xl p-4">
                    <div>
                        <div class="font-medium">${item.name}</div>
                        <div class="font-mono text-xs text-orange-500 mt-px">$${item.price}</div>
                    </div>
                    <button onclick="removeFromCart(${index})" class="text-xs px-3 py-1 text-red-400 hover:text-red-500">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>`;
        });
        document.getElementById('cart-total').textContent = '$' + total.toFixed(2);
    }
    drawer.classList.remove('hidden');
    drawer.classList.add('flex');
}

function removeFromCart(index) {
    cart.splice(index, 1);
    localStorage.setItem('sb_cart', JSON.stringify(cart));
    updateCartCount();
    showCart();
}

function hideCart() {
    const drawer = document.getElementById('cart-drawer');
    if (drawer) {
        drawer.classList.remove('flex');
        drawer.classList.add('hidden');
    }
}

async function checkout() {
    if (cart.length === 0) return;
    const total = cart.reduce((sum, item) => sum + item.price, 0);

    // Save order to Supabase if available
    try {
        if (window.sb) {
            const session = await getSession();
            const { error } = await sb.from('orders').insert({
                user_id: session?.user?.id || null,
                customer_email: session?.user?.email || null,
                items: cart,
                total: total,
                status: 'pending'
            });
            if (error) console.warn('Order save failed (still completing demo checkout):', error.message);
        }
    } catch (e) {
        console.warn('Supabase order error:', e);
    }

    hideCart();
    setTimeout(() => {
        showToast(`Thank you! $${total.toFixed(2)} order placed. We'll be in touch.`);
        cart = [];
        localStorage.setItem('sb_cart', JSON.stringify(cart));
        updateCartCount();
    }, 300);
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
    // Find actions row: parent of the cart button (most reliable)
    const cartBtn = document.querySelector('#navbar button[onclick*="showCart"], #navbar #cart-count');
    const actions = cartBtn
        ? (cartBtn.closest('button') || cartBtn).parentElement
        : document.querySelector('#navbar .flex.items-center.gap-x-4');
    if (!actions) {
        console.warn('[nav-auth] actions row not found');
        return;
    }

    let slot = document.getElementById('nav-auth');
    if (!slot) {
        slot = document.createElement('div');
        slot.id = 'nav-auth';
        slot.className = 'flex items-center';
        // Place right after cart button
        const cartEl = actions.querySelector('button[onclick*="showCart"]') || actions.firstElementChild;
        if (cartEl && cartEl.nextSibling) {
            actions.insertBefore(slot, cartEl.nextSibling);
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
                <button type="button" onclick="navLogout()" class="hidden md:inline-flex text-xs text-zinc-500 hover:text-white px-1.5 py-1" title="Log out">
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

document.addEventListener('DOMContentLoaded', async () => {
    await loadSiteNav();
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


