// Members area — real Supabase Auth + ride logs + profile

async function initMembersPage() {
    const session = await getSession();
    if (session?.user) {
        await showDashboard(session.user);
    } else {
        showLoginWall();
    }

    // Listen for auth changes
    sb.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
            await showDashboard(session.user);
        } else if (event === 'SIGNED_OUT') {
            showLoginWall();
        }
    });
}

function showLoginWall() {
    document.getElementById('login-wall')?.classList.remove('hidden');
    document.getElementById('member-dashboard')?.classList.add('hidden');
}

async function showDashboard(user) {
    const wall = document.getElementById('login-wall');
    const dashboard = document.getElementById('member-dashboard');
    if (!dashboard) return;

    wall?.classList.add('hidden');
    dashboard.classList.remove('hidden');

    // Load profile
    const profile = await getProfile(user.id);
    const nameEl = document.getElementById('member-name');
    if (nameEl) {
        nameEl.textContent = profile?.full_name || user.email?.split('@')[0] || 'Member';
    }

    const tierLabel = {
        trail_rider: 'Trail Rider',
        coulee_crusher: 'Premium Member • Coulee Crusher',
        youth: 'Youth / Student',
        none: 'Member'
    };
    const statusEl = dashboard.querySelector('.text-emerald-400 span') || dashboard.querySelector('.text-emerald-400');
    if (statusEl && profile) {
        statusEl.textContent = tierLabel[profile.membership_tier] || 'Member';
    }

    // Load rides
    await loadRides(user.id);

    // Load community feed
    await loadPosts();
}

async function loginMember(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        showToast('Enter email and password', true);
        return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    const original = btn?.innerHTML;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> LOGGING IN...';
    }

    try {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        showToast('Welcome back!');
        // Dashboard shown via onAuthStateChange
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Login failed', true);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }
}

async function logoutMember() {
    await sb.auth.signOut();
    showToast('Logged out');
    showLoginWall();
}

function switchMemberTab(tabIndex) {
    document.querySelectorAll('.member-tab-content').forEach(el => el.classList.add('hidden'));
    document.getElementById(`tab-${tabIndex}`)?.classList.remove('hidden');

    document.querySelectorAll('.member-tab').forEach((btn, idx) => {
        if (idx == tabIndex) {
            btn.classList.add('border-b-2', 'border-orange-600', 'text-orange-500', 'font-semibold');
            btn.classList.remove('text-zinc-400');
        } else {
            btn.classList.remove('border-b-2', 'border-orange-600', 'text-orange-500', 'font-semibold');
            btn.classList.add('text-zinc-400');
        }
    });
}

async function loadRides(userId) {
    const { data, error } = await sb
        .from('rides')
        .select('*')
        .eq('user_id', userId)
        .order('ride_date', { ascending: false })
        .limit(50);

    if (error) {
        console.error(error);
        return;
    }

    window.memberRides = data || [];
    renderRideLog();
}

function renderRideLog() {
    const container = document.getElementById('ride-log-list');
    if (!container) return;
    container.innerHTML = '';

    const rides = window.memberRides || [];
    if (rides.length === 0) {
        container.innerHTML = `<p class="text-xs text-zinc-500 italic px-1">No rides logged yet. Tap the button above to add your first one.</p>`;
        return;
    }

    rides.forEach(ride => {
        const rating = ride.rating || 0;
        container.innerHTML += `
            <div class="bg-zinc-950 border border-zinc-700 rounded-2xl px-5 py-4 flex items-center justify-between text-sm">
                <div>
                    <div class="font-medium">${escapeHtml(ride.trail_name)}</div>
                    <div class="text-xs text-zinc-400 font-mono">${ride.ride_date} • ${ride.distance || '—'} • ${ride.duration || '—'}</div>
                </div>
                <div class="flex items-center gap-x-px text-amber-400">
                    ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}
                </div>
            </div>`;
    });
}

async function logNewRide() {
    const user = await getCurrentUser();
    if (!user) {
        showToast('Please log in first', true);
        return;
    }

    const trail = prompt('Trail name?', 'Cypress Hills - New Flow Line');
    if (!trail) return;
    const distance = prompt('Distance (e.g. 18.4 km)', '18.4 km') || null;
    const duration = prompt('Ride time (e.g. 2h 10m)', '2h 10m') || null;
    const rating = parseInt(prompt('Rating (1-5 stars)', '5')) || 5;

    const { data, error } = await sb.from('rides').insert({
        user_id: user.id,
        trail_name: trail,
        ride_date: new Date().toISOString().split('T')[0],
        distance,
        duration,
        rating: Math.max(1, Math.min(5, rating))
    }).select().single();

    if (error) {
        showToast('Could not save ride: ' + error.message, true);
        return;
    }

    window.memberRides = window.memberRides || [];
    window.memberRides.unshift(data);
    renderRideLog();
    showToast('Ride logged! Thanks for riding with SB Racing.');
}

async function loadPosts() {
    const container = document.querySelector('#tab-3 .space-y-4');
    if (!container) return;

    const { data, error } = await sb
        .from('posts')
        .select('*, profiles(full_name)')
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        console.warn('Posts load error (table may be empty):', error.message);
        return;
    }

    if (!data || data.length === 0) return;

    container.innerHTML = data.map(post => {
        const name = post.profiles?.full_name || 'Member';
        const timeAgo = formatTimeAgo(post.created_at);
        return `
            <div class="bg-zinc-950 border border-zinc-700 rounded-2xl p-4">
                <div class="flex gap-x-3">
                    <div class="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0 text-xs font-bold text-orange-500">
                        ${name.charAt(0).toUpperCase()}
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-baseline justify-between">
                            <span class="font-semibold">${escapeHtml(name)}</span>
                            <span class="text-xs text-zinc-500">${timeAgo}</span>
                        </div>
                        <div class="text-sm mt-0.5">${escapeHtml(post.body)}</div>
                        <div class="flex gap-x-5 mt-3 text-xs">
                            <button onclick="likePost(${post.id}, this)" class="flex items-center gap-x-1 text-zinc-400 hover:text-orange-400">
                                <i class="fa-solid fa-heart"></i> <span class="like-count">${post.likes || 0}</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;
    }).join('');
}

async function likePost(postId, element) {
    const countEl = element.querySelector('.like-count');
    let count = parseInt(countEl.textContent) || 0;
    count++;
    countEl.textContent = count;
    element.style.color = '#f59e0b';

    // Fire and forget update
    await sb.from('posts').update({ likes: count }).eq('id', postId);
}

async function rsvpEvent(eventIndex, title, dateStr) {
    // Simple RSVP from members private events tab
    const user = await getCurrentUser();
    if (!user) {
        showToast('Log in to RSVP', true);
        return;
    }
    const profile = await getProfile(user.id);
    showToast(`RSVP interest recorded for ${title}. Check Events page for full RSVP.`);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatTimeAgo(iso) {
    const d = new Date(iso);
    const now = new Date();
    const sec = Math.floor((now - d) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
    if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
    if (sec < 604800) return Math.floor(sec / 86400) + 'd ago';
    return d.toLocaleDateString();
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
    if (typeof sb !== 'undefined') {
        initMembersPage();
    } else {
        console.error('Supabase client not loaded');
    }
});
