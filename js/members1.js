// Members area — real Supabase Auth + ride logs + profile

async function initMembersPage() {
    console.log('[members] init start');
    // Always show login wall first so UI is never stuck blank
    showLoginWall();

    let session = null;
    try {
        session = await Promise.race([
            getSession(),
            new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 3000); })
        ]);
    } catch (e) {
        console.warn('[members] getSession error', e);
    }

    console.log('[members] session', session && session.user && session.user.email);

    if (session && session.user) {
        try {
            await showDashboard(session.user);
        } catch (e) {
            console.error('[members] dashboard error', e);
            showLoginWall();
        }
    } else {
        showLoginWall();
    }

    if (window.sb) {
        window.sb.auth.onAuthStateChange(async function (event, session) {
            console.log('[members] auth event', event);
            if (event === 'SIGNED_IN' && session && session.user) {
                await showDashboard(session.user);
            } else if (event === 'SIGNED_OUT') {
                showLoginWall();
            }
        });
    }
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

    const av = document.getElementById('member-avatar');
    if (av) {
        av.src = profile?.avatar_url || '/assets/logo.png';
    }

    fillProfileForm(profile, user);

    // Load rides
    await loadRides(user.id);

    // Load community feed
    await loadPosts();
}

function fillProfileForm(profile, user) {
    const name = document.getElementById('profile-full-name');
    const email = document.getElementById('profile-email');
    const phone = document.getElementById('profile-phone');
    const emergency = document.getElementById('profile-emergency');
    const tier = document.getElementById('profile-tier-display');
    const preview = document.getElementById('profile-avatar-preview');
    if (name) name.value = profile?.full_name || '';
    if (email) email.value = profile?.email || user?.email || '';
    if (phone) phone.value = profile?.phone || '';
    if (emergency) emergency.value = profile?.emergency_contact || '';
    if (tier) {
        const labels = {
            trail_rider: 'Trail Rider',
            coulee_crusher: 'Coulee Crusher (Premium)',
            youth: 'Youth / Student',
            none: 'No active membership'
        };
        const st = profile?.membership_status || '';
        tier.textContent = (labels[profile?.membership_tier] || 'Member') + (st ? ' · ' + st : '');
    }
    if (preview) preview.src = profile?.avatar_url || '/assets/logo.png';
}

async function saveProfile(e) {
    e.preventDefault();
    const user = await getCurrentUser();
    if (!user) {
        showToast('Please log in', true);
        return;
    }

    const btn = document.getElementById('profile-save-btn');
    const original = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = 'Saving…';
    }

    try {
        let avatar_url = null;
        const fileInput = document.getElementById('profile-avatar-file');
        const file = fileInput && fileInput.files && fileInput.files[0];

        if (file) {
            if (file.size > 3.5 * 1024 * 1024) throw new Error('Image must be under 3.5MB');
            const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/jpeg/, 'jpg');
            const path = user.id + '/avatar.' + ext;
            const { error: upErr } = await window.sb.storage
                .from('avatars')
                .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
            if (upErr) throw upErr;
            const { data: pub } = window.sb.storage.from('avatars').getPublicUrl(path);
            avatar_url = pub.publicUrl + '?t=' + Date.now();
        }

        const updates = {
            full_name: document.getElementById('profile-full-name').value.trim() || null,
            phone: document.getElementById('profile-phone').value.trim() || null,
            emergency_contact: document.getElementById('profile-emergency').value.trim() || null,
            updated_at: new Date().toISOString()
        };
        if (avatar_url) updates.avatar_url = avatar_url;

        const { error } = await window.sb.from('profiles').update(updates).eq('id', user.id);
        if (error) throw error;

        // refresh header
        const nameEl = document.getElementById('member-name');
        if (nameEl && updates.full_name) nameEl.textContent = updates.full_name;
        if (avatar_url) {
            const av = document.getElementById('member-avatar');
            const prev = document.getElementById('profile-avatar-preview');
            if (av) av.src = avatar_url;
            if (prev) prev.src = avatar_url;
        }
        if (fileInput) fileInput.value = '';
        showToast('Profile saved');
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Could not save profile', true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = original || 'Save profile';
        }
    }
}

// live preview when choosing a file
document.addEventListener('change', function (ev) {
    if (ev.target && ev.target.id === 'profile-avatar-file' && ev.target.files && ev.target.files[0]) {
        const url = URL.createObjectURL(ev.target.files[0]);
        const prev = document.getElementById('profile-avatar-preview');
        if (prev) prev.src = url;
    }
});


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
        const { data, error } = await window.sb.auth.signInWithPassword({ email, password });
        if (error) throw error;

        // Session is written to localStorage by the client — use it immediately
        if (data.session?.user) {
            showToast('Welcome back!');
            await showDashboard(data.session.user);
            if (typeof updateNavAuth === 'function') {
                await updateNavAuth(data.session.user);
            }
        } else if (data.user && !data.session) {
            showToast('Check your email to confirm your account before logging in.', true);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = original;
            }
        } else {
            showToast('Login returned no session. Disable "Confirm email" in Supabase Auth settings.', true);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = original;
            }
        }
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
    await window.sb.auth.signOut();
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

    const { data, error } = await window.sb.from('rides').insert({
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
    await window.sb.from('posts').update({ likes: count }).eq('id', postId);
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


function bootMembers() {
  if (!window.sb) {
    console.warn('[members] sb not ready, retrying...');
    setTimeout(bootMembers, 150);
    return;
  }
  initMembersPage().catch(function (e) {
    console.error('[members] init failed', e);
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootMembers);
} else {
  bootMembers();
}

