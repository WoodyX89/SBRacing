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

    // Admin tab — only for is_admin
    var adminBtn = document.getElementById('admin-tab-btn');
    if (adminBtn) {
        if (profile && profile.is_admin) {
            adminBtn.classList.remove('hidden');
        } else {
            adminBtn.classList.add('hidden');
        }
    }

    await loadMemberDirectory();
    switchMemberTab(7);
}

let _memberDirCache = [];

async function loadMemberDirectory() {
  const grid = document.getElementById('member-directory');
  if (!grid || !window.sb) return;
  try {
    const { data, error } = await window.sb
      .from('profiles')
      .select('id, full_name, avatar_url, membership_tier, membership_status, created_at')
      .order('full_name', { ascending: true });
    if (error) throw error;
    _memberDirCache = data || [];
    renderMemberDirectory(_memberDirCache);
  } catch (e) {
    console.error(e);
    grid.innerHTML = '<div class="col-span-full text-center text-zinc-500 py-8">Could not load members</div>';
  }
}

function filterMemberDirectory() {
  const q = (document.getElementById('member-dir-search')?.value || '').trim().toLowerCase();
  const list = !_memberDirCache ? [] : _memberDirCache.filter(function (p) {
    if (!q) return true;
    return String(p.full_name || '').toLowerCase().includes(q) || String(p.membership_tier || '').includes(q);
  });
  renderMemberDirectory(list);
}

function renderMemberDirectory(list) {
  const grid = document.getElementById('member-directory');
  if (!grid) return;
  if (!list.length) {
    grid.innerHTML = '<div class="col-span-full text-center text-zinc-500 py-8">No members found</div>';
    return;
  }
  const tierLabel = { trail_rider: 'Trail Rider', coulee_crusher: 'Coulee Crusher', youth: 'Youth', none: 'Member' };
  grid.innerHTML = list.map(function (p) {
    const name = p.full_name || 'Member';
    const initial = name.charAt(0).toUpperCase();
    const av = p.avatar_url
      ? '<img src="' + escapeAttr(p.avatar_url) + '" class="w-12 h-12 rounded-2xl object-cover bg-zinc-800" alt="">'
      : '<div class="w-12 h-12 rounded-2xl bg-orange-600 text-white flex items-center justify-center font-bold">' + initial + '</div>';
    const tier = tierLabel[p.membership_tier] || 'Member';
    const active = p.membership_status === 'active';
    return '<button type="button" onclick="openMemberProfile(\'' + p.id + '\')" class="text-left flex items-center gap-3 p-4 rounded-2xl bg-zinc-950 border border-zinc-800 hover:border-orange-700/60 transition-all w-full">' +
      av +
      '<div class="min-w-0 flex-1"><div class="font-semibold truncate">' + escapeHtml(name) + '</div>' +
      '<div class="text-xs ' + (active ? 'text-emerald-400' : 'text-zinc-500') + '">' + escapeHtml(tier) + (active ? ' · Active' : '') + '</div></div>' +
      '<i class="fa-solid fa-chevron-right text-zinc-600 text-xs"></i></button>';
  }).join('');
}

async function openMemberProfile(userId) {
  const modal = document.getElementById('member-profile-modal');
  const body = document.getElementById('member-profile-body');
  if (!modal || !body) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  body.innerHTML = '<div class="text-zinc-500 text-sm">Loading…</div>';
  try {
    const { data: p, error } = await window.sb
      .from('profiles')
      .select('id, full_name, avatar_url, membership_tier, membership_status, created_at, email')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!p) {
      body.innerHTML = '<p class="text-zinc-500">Member not found</p>';
      return;
    }
    const tierLabel = { trail_rider: 'Trail Rider', coulee_crusher: 'Coulee Crusher', youth: 'Youth', none: 'Member' };
    const name = p.full_name || 'Member';
    const initial = name.charAt(0).toUpperCase();
    const av = p.avatar_url
      ? '<img src="' + escapeAttr(p.avatar_url) + '" class="w-20 h-20 rounded-2xl object-cover bg-zinc-800" alt="">'
      : '<div class="w-20 h-20 rounded-2xl bg-orange-600 text-white flex items-center justify-center text-2xl font-bold">' + initial + '</div>';
    // public ride count if allowed
    let rideHtml = '';
    try {
      const { data: rides } = await window.sb.from('rides').select('trail_name, rating, ride_date').eq('user_id', userId).order('ride_date', { ascending: false }).limit(5);
      if (rides && rides.length) {
        rideHtml = '<div class="mt-4"><div class="text-xs uppercase tracking-widest text-zinc-500 mb-2">Recent rides</div><div class="space-y-2">' +
          rides.map(function (r) {
            return '<div class="text-sm bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 flex justify-between gap-2"><span class="truncate">' + escapeHtml(r.trail_name || 'Ride') + '</span><span class="text-zinc-500 text-xs shrink-0">' + (r.rating ? r.rating + '★' : '') + '</span></div>';
          }).join('') + '</div></div>';
      }
    } catch (_) {}
    const joined = p.created_at ? new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
    body.innerHTML =
      '<div class="flex items-center gap-4">' + av +
      '<div><div class="text-xl font-bold">' + escapeHtml(name) + '</div>' +
      '<div class="text-sm text-emerald-400 mt-1">' + escapeHtml(tierLabel[p.membership_tier] || 'Member') +
      (p.membership_status === 'active' ? ' · Active' : '') + '</div>' +
      (joined ? '<div class="text-xs text-zinc-500 mt-1">Joined ' + joined + '</div>' : '') +
      '</div></div>' + rideHtml;
  } catch (e) {
    body.innerHTML = '<p class="text-red-400 text-sm">' + escapeHtml(e.message || 'Failed to load') + '</p>';
  }
}

function closeMemberProfile() {
  const modal = document.getElementById('member-profile-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
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
    fillNotificationPrefs(profile);
    refreshNotifyOsStatus();
}

function prefChecked(id, fallback) {
    var el = document.getElementById(id);
    if (!el) return fallback;
    return !!el.checked;
}

function setPrefChecked(id, value) {
    var el = document.getElementById(id);
    if (el) el.checked = value !== false;
}

function fillNotificationPrefs(profile) {
    setPrefChecked('pref-notify-push', profile?.notify_push);
    setPrefChecked('pref-notify-events', profile?.notify_events);
    setPrefChecked('pref-notify-forum', profile?.notify_forum);
    setPrefChecked('pref-notify-comments', profile?.notify_comments);
    setPrefChecked('pref-notify-rsvp', profile?.notify_rsvp);
    setPrefChecked('pref-notify-admin', profile?.notify_admin);
}

async function refreshNotifyOsStatus() {
    var el = document.getElementById('notify-os-status');
    if (!el) return;
    var granted = null;
    try {
        var Push = window.Capacitor && (
            (Capacitor.Plugins && Capacitor.Plugins.PushNotifications) ||
            (typeof Capacitor.registerPlugin === 'function' && Capacitor.registerPlugin('PushNotifications'))
        );
        if (Push && typeof Push.checkPermissions === 'function') {
            var perm = await Push.checkPermissions();
            granted = perm && perm.receive === 'granted';
        }
    } catch (e) {}
    if (granted === true) {
        el.textContent = 'iPhone notifications: allowed';
        el.className = 'text-xs text-emerald-400 mb-4';
    } else if (granted === false) {
        el.textContent = 'iPhone notifications: off — enable them in Settings → SB Racing → Notifications';
        el.className = 'text-xs text-amber-400 mb-4';
    } else {
        el.textContent = 'Phone permission is controlled in iOS Settings → SB Racing → Notifications.';
        el.className = 'text-xs text-zinc-500 mb-4';
    }
}

async function saveNotificationPrefs() {
    var user = await getCurrentUser();
    var statusEl = document.getElementById('notify-prefs-status');
    if (!user) {
        if (typeof showToast === 'function') showToast('Log in first', true);
        return;
    }
    var updates = {
        notify_push: prefChecked('pref-notify-push', true),
        notify_events: prefChecked('pref-notify-events', true),
        notify_forum: prefChecked('pref-notify-forum', true),
        notify_comments: prefChecked('pref-notify-comments', true),
        notify_rsvp: prefChecked('pref-notify-rsvp', true),
        notify_admin: prefChecked('pref-notify-admin', true),
        updated_at: new Date().toISOString()
    };
    try {
        var res = await window.sb.from('profiles').update(updates).eq('id', user.id);
        if (res.error) throw res.error;
        if (statusEl) {
            statusEl.classList.remove('hidden');
            statusEl.className = 'text-xs text-emerald-400 mt-3';
            statusEl.textContent = 'Saved';
        }
    } catch (e) {
        console.warn('[notify prefs]', e);
        if (statusEl) {
            statusEl.classList.remove('hidden');
            statusEl.className = 'text-xs text-red-400 mt-3';
            statusEl.textContent = (e && e.message) || 'Could not save — run notification-prefs.sql';
        }
        if (typeof showToast === 'function') showToast((e && e.message) || 'Could not save notification settings', true);
    }
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

/** Take web + iOS app to the private club application form */
function goToJoinApplication() {
  window.location.href = 'join.html';
}

function openSignupRequestModal() {
  goToJoinApplication();
}

function closeSignupRequestModal() {
  var modal = document.getElementById('signup-request-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

async function submitSignupRequest(e) {
  if (e && e.preventDefault) e.preventDefault();
  var name = ((document.getElementById('su-name') || {}).value || '').trim();
  var email = ((document.getElementById('su-email') || {}).value || '').trim();
  var phone = ((document.getElementById('su-phone') || {}).value || '').trim();
  var message = ((document.getElementById('su-message') || {}).value || '').trim();
  var errEl = document.getElementById('signup-request-error');
  var okEl = document.getElementById('signup-request-ok');
  var btn = document.getElementById('signup-request-btn');

  if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
  if (okEl) { okEl.textContent = ''; okEl.classList.add('hidden'); }

  if (!name || !email) {
    if (errEl) {
      errEl.textContent = 'Name and email are required.';
      errEl.classList.remove('hidden');
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Sending…';
  }

  try {
    // FormSubmit delivers to info@sbracing.ca (confirm email once on first use)
    var res = await fetch('https://formsubmit.co/ajax/info@sbracing.ca', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        name: name,
        email: email,
        phone: phone || '—',
        message: message || 'No message',
        _subject: 'SB Racing membership request — ' + name,
        _template: 'table',
        _replyto: email,
        source: 'Members login — Request access'
      })
    });

    var data = {};
    try { data = await res.json(); } catch (e) {}

    if (!res.ok) {
      throw new Error((data && (data.message || data.error)) || 'Could not send request');
    }

    if (okEl) {
      okEl.textContent = 'Request sent. Check your inbox if FormSubmit asks you to confirm, and we’ll email you from info@sbracing.ca.';
      okEl.classList.remove('hidden');
    }
    showToast('Membership request sent');
    var form = document.getElementById('signup-request-form');
    if (form) form.reset();
    setTimeout(closeSignupRequestModal, 1800);
  } catch (err) {
    console.error('[signup-request]', err);
    // Fallback: open mail client
    try {
      var body = encodeURIComponent(
        'Name: ' + name + '\nEmail: ' + email + '\nPhone: ' + (phone || '—') +
        '\n\n' + (message || '') + '\n\n— Sent from SB Racing Members page'
      );
      window.location.href =
        'mailto:info@sbracing.ca?subject=' +
        encodeURIComponent('Membership request — ' + name) +
        '&body=' + body;
      showToast('Opening email app as fallback…');
      closeSignupRequestModal();
    } catch (e2) {
      if (errEl) {
        errEl.textContent = err.message || 'Could not send. Email info@sbracing.ca directly.';
        errEl.classList.remove('hidden');
      }
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Send request';
    }
  }
}

window.openSignupRequestModal = openSignupRequestModal;
window.closeSignupRequestModal = closeSignupRequestModal;
window.submitSignupRequest = submitSignupRequest;

function switchMemberTab(tabIndex) {
    document.querySelectorAll('.member-tab-content').forEach(el => el.classList.add('hidden'));
    document.getElementById('tab-' + tabIndex)?.classList.remove('hidden');

    document.querySelectorAll('.member-tab').forEach((btn) => {
        const id = btn.getAttribute('data-tab');
        if (String(id) === String(tabIndex)) {
            btn.classList.add('border-b-2', 'border-orange-600', 'text-orange-500', 'font-semibold');
            btn.classList.remove('text-zinc-400');
        } else {
            btn.classList.remove('border-b-2', 'border-orange-600', 'text-orange-500', 'font-semibold');
            btn.classList.add('text-zinc-400');
        }
    });
    if (String(tabIndex) === '5') loadMemberDirectory();
    if (String(tabIndex) === '6') loadClubApplications(window._appFilter || 'pending');
    if (String(tabIndex) === '7') loadRideLeaderboard(window._lbPeriod || 'weekly');
}

async function loadRideLeaderboard(period) {
    period = period || 'weekly';
    window._lbPeriod = period;
    document.querySelectorAll('.lb-period').forEach(function (btn) {
        var on = btn.getAttribute('data-period') === period;
        btn.classList.toggle('border-orange-600', on);
        btn.classList.toggle('text-orange-500', on);
        btn.classList.toggle('border-zinc-700', !on);
        btn.classList.toggle('text-zinc-400', !on);
    });
    var list = document.getElementById('leaderboard-list');
    var status = document.getElementById('lb-status');
    if (list) list.innerHTML = '<p class="text-zinc-500">Loading…</p>';
    if (status) status.textContent = '';

    var me = null;
    try {
        var u = await getCurrentUser();
        me = u && u.id;
    } catch (e) {}

    try {
        if (!window.sb) throw new Error('Not connected');
        var res = await window.sb.rpc('ride_leaderboard', { p_period: period });
        if (res.error) throw res.error;
        var rows = res.data || [];
        var labels = { weekly: 'this week', monthly: 'this month', yearly: 'this year' };
        if (status) {
            status.textContent = rows.length
                ? rows.length + ' rider' + (rows.length === 1 ? '' : 's') + ' ' + (labels[period] || period)
                : 'No saved rides ' + (labels[period] || period) + ' yet.';
        }
        if (!list) return;
        if (!rows.length) {
            list.innerHTML = '<p class="text-zinc-500">Save a ride from Trails to get on the board.</p>';
            return;
        }
        list.innerHTML = rows.map(function (row, i) {
            var mine = me && String(row.user_id) === String(me);
            var rank = i + 1;
            var medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank + '.';
            return '<div class="flex items-center gap-3 bg-zinc-950 border ' +
                (mine ? 'border-orange-700' : 'border-zinc-800') +
                ' rounded-2xl px-4 py-3">' +
                '<div class="w-8 text-center font-semibold">' + medal + '</div>' +
                '<div class="flex-1 min-w-0">' +
                '<div class="font-medium truncate">' + escapeHtml(row.full_name || 'Rider') +
                (mine ? ' <span class="text-orange-500 text-xs">you</span>' : '') + '</div>' +
                '<div class="text-xs text-zinc-500">' + (row.rides || 0) + ' ride' + (row.rides === 1 ? '' : 's') + '</div>' +
                '</div>' +
                '<div class="text-right shrink-0">' +
                '<div class="font-semibold text-orange-400">' + (row.points || 0) + ' pts</div>' +
                '<div class="text-[11px] text-zinc-500">' + (row.km || 0) + ' km · +' + (row.elev_m || 0) + ' m</div>' +
                '</div></div>';
        }).join('');
    } catch (e) {
        console.warn('[leaderboard]', e);
        if (list) {
            list.innerHTML = '<p class="text-red-400">Run ride-leaderboard.sql in Supabase, then save a ride from Trails.</p>';
        }
        if (status) status.textContent = (e && e.message) || 'Leaderboard not available yet';
    }
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

/** Community Feed: activity the current user is involved in (posts, comments). */
async function loadPosts() {
    const container = document.querySelector('#tab-3 .space-y-4');
    if (!container || !window.sb) return;

    let user = null;
    try {
        const { data: { session } } = await window.sb.auth.getSession();
        user = session && session.user;
    } catch (e) {}
    if (!user) {
        container.innerHTML = '<p class="text-center text-zinc-500 py-8">Log in to see your activity.</p>';
        return;
    }

    container.innerHTML = '<div class="text-center text-zinc-500 py-8"><i class="fa-solid fa-spinner fa-spin"></i></div>';

    try {
        const uid = user.id;
        const items = [];

        // Forum posts the user authored
        const myPosts = await window.sb
            .from('forum_posts')
            .select('id, body, created_at, post_type')
            .eq('user_id', uid)
            .order('created_at', { ascending: false })
            .limit(25);
        (myPosts.data || []).forEach(function (p) {
            items.push({
                kind: 'forum_post',
                id: p.id,
                body: p.body || (p.post_type === 'poll' ? 'Posted a poll' : 'Posted in Trail Talk'),
                created_at: p.created_at,
                url: 'forum.html',
                label: 'You posted in Trail Talk'
            });
        });

        // Forum comments by the user
        const myForumComments = await window.sb
            .from('forum_comments')
            .select('id, body, created_at, post_id')
            .eq('user_id', uid)
            .order('created_at', { ascending: false })
            .limit(25);
        (myForumComments.data || []).forEach(function (c) {
            items.push({
                kind: 'forum_comment',
                id: c.id,
                body: c.body,
                created_at: c.created_at,
                url: 'forum.html',
                label: 'You commented in Trail Talk'
            });
        });

        // Event comments by the user
        const myEventComments = await window.sb
            .from('event_comments')
            .select('id, body, created_at, event_id')
            .eq('user_id', uid)
            .order('created_at', { ascending: false })
            .limit(25);
        (myEventComments.data || []).forEach(function (c) {
            items.push({
                kind: 'event_comment',
                id: c.id,
                body: c.body,
                created_at: c.created_at,
                url: 'events.html',
                label: 'You commented on an event'
            });
        });

        // Comments from others on the user's forum posts
        const myPostIds = (myPosts.data || []).map(function (p) { return p.id; });
        if (myPostIds.length) {
            const replies = await window.sb
                .from('forum_comments')
                .select('id, body, created_at, post_id, user_id')
                .in('post_id', myPostIds)
                .neq('user_id', uid)
                .order('created_at', { ascending: false })
                .limit(25);
            const replyUserIds = (replies.data || []).map(function (r) { return r.user_id; }).filter(Boolean);
            let nameMap = {};
            if (replyUserIds.length) {
                const profiles = await window.sb.from('profiles').select('id, full_name').in('id', replyUserIds);
                (profiles.data || []).forEach(function (pr) { nameMap[pr.id] = pr.full_name || 'Member'; });
            }
            (replies.data || []).forEach(function (r) {
                const who = nameMap[r.user_id] || 'Someone';
                items.push({
                    kind: 'forum_reply',
                    id: r.id,
                    body: r.body,
                    created_at: r.created_at,
                    url: 'forum.html',
                    label: who + ' replied to your post'
                });
            });
        }

        items.sort(function (a, b) {
            return new Date(b.created_at) - new Date(a.created_at);
        });

        if (!items.length) {
            container.innerHTML =
                '<div class="text-center text-zinc-500 py-10">' +
                '<p class="mb-2">No activity yet.</p>' +
                '<p class="text-sm">Post or comment in <a href="forum.html" class="text-orange-400 hover:underline">Trail Talk</a> or on an <a href="events.html" class="text-orange-400 hover:underline">event</a>.</p>' +
                '</div>';
            return;
        }

        container.innerHTML = items.slice(0, 40).map(function (item) {
            const timeAgo = formatTimeAgo(item.created_at);
            const icon = item.kind === 'forum_post' ? 'fa-pen' :
                (item.kind.indexOf('comment') >= 0 || item.kind === 'forum_reply' ? 'fa-comment' : 'fa-bolt');
            return (
                '<a href="' + item.url + '" class="block bg-zinc-950 border border-zinc-700 rounded-2xl p-4 hover:border-zinc-500 transition-colors">' +
                '<div class="flex gap-x-3">' +
                '<div class="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0 text-orange-500">' +
                '<i class="fa-solid ' + icon + ' text-sm"></i></div>' +
                '<div class="flex-1 min-w-0">' +
                '<div class="flex items-baseline justify-between gap-2">' +
                '<span class="font-semibold text-sm">' + escapeHtml(item.label) + '</span>' +
                '<span class="text-xs text-zinc-500 shrink-0">' + timeAgo + '</span></div>' +
                '<div class="text-sm mt-0.5 text-zinc-300 line-clamp-3">' + escapeHtml(item.body || '') + '</div>' +
                '</div></div></a>'
            );
        }).join('');
    } catch (e) {
        console.error('[members] community feed', e);
        container.innerHTML = '<p class="text-center text-red-400 py-8">Could not load activity.</p>';
    }
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



/** Admin-only: send custom remote push via notify-event edge function */
async function sendAdminPush() {
    var titleEl = document.getElementById('admin-push-title');
    var bodyEl = document.getElementById('admin-push-body');
    var audienceEl = document.getElementById('admin-push-audience');
    var urlEl = document.getElementById('admin-push-url');
    var btn = document.getElementById('admin-push-send-btn');
    var statusEl = document.getElementById('admin-push-status');

    var title = (titleEl && titleEl.value || 'Update').trim().slice(0, 80);
    var body = (bodyEl && bodyEl.value || '').trim().slice(0, 200);
    var audience = (audienceEl && audienceEl.value) || 'all';
    var url = (urlEl && urlEl.value || 'events.html').trim() || 'events.html';

    if (!body) {
        if (typeof showToast === 'function') showToast('Enter a message', true);
        if (bodyEl) bodyEl.focus();
        return;
    }

    // Confirm before broadcasting
    var audienceLabel = audience === 'all' ? 'everyone' : (audience === 'leaders' ? 'leaders & admins' : 'admins only');
    if (!confirm('Send this push to ' + audienceLabel + '?\n\n"' + title + '"\n' + body)) return;

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>SENDING…';
    }
    if (statusEl) {
        statusEl.classList.remove('hidden');
        statusEl.className = 'text-sm text-zinc-400';
        statusEl.textContent = 'Sending…';
    }

    try {
        if (!window.sb) throw new Error('Supabase not ready');

        // Prefer existing broadcastPush helper if available
        if (typeof broadcastPush === 'function') {
            var pushRes = await broadcastPush({
                title: title,
                body: body,
                url: url,
                type: 'admin',
                audience: audience,
                excludeSelf: false
            });
            if (pushRes && pushRes.error) throw pushRes.error;
            console.log('[admin push]', pushRes);
            if (statusEl && pushRes && typeof pushRes.sent === 'number') {
                statusEl.className = 'text-sm text-emerald-400';
                statusEl.textContent = 'Sent ' + pushRes.sent + ' of ' + (pushRes.total || pushRes.sent) + ' devices.';
            }
        } else {
            var res = await window.sb.functions.invoke('notify-event', {
                body: {
                    title: title,
                    body: body,
                    audience: audience,
                    data: { url: url, type: 'admin', audience: audience }
                }
            });
            if (res.error) throw res.error;
            console.log('[admin push]', res.data);
        }

        if (typeof showToast === 'function') showToast('Push sent');
        if (statusEl) {
            statusEl.className = 'text-sm text-emerald-400';
            statusEl.textContent = 'Push sent to ' + audienceLabel + '.';
        }
        if (bodyEl) bodyEl.value = '';
        var countEl = document.getElementById('admin-push-body-count');
        if (countEl) countEl.textContent = '0';
    } catch (e) {
        console.warn('[admin push]', e);
        var msg = (e && (e.message || e.error_description)) || String(e);
        if (typeof showToast === 'function') showToast(msg || 'Push failed', true);
        if (statusEl) {
            statusEl.className = 'text-sm text-red-400';
            statusEl.textContent = 'Failed: ' + msg;
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-paper-plane mr-2"></i>SEND PUSH';
        }
    }
}

// Live character count for admin push body
document.addEventListener('DOMContentLoaded', function () {
    var bodyEl = document.getElementById('admin-push-body');
    var countEl = document.getElementById('admin-push-body-count');
    if (bodyEl && countEl) {
        bodyEl.addEventListener('input', function () {
            countEl.textContent = String((bodyEl.value || '').length);
        });
    }
});

var _appFilter = 'pending';
var _appCache = [];

function escapeApp(str) {
  return escapeHtml(str || '');
}

function experienceLabel(v) {
  var map = {
    new: 'New to mountain biking',
    casual: 'Casual',
    regular: 'Regular',
    advanced: 'Advanced / race pace'
  };
  return map[v] || v || '—';
}

function formatAppDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (e) {
    return iso;
  }
}

function setAppFilterButtons(filter) {
  document.querySelectorAll('.app-filter').forEach(function (btn) {
    var on = btn.getAttribute('data-filter') === filter;
    btn.classList.toggle('border-orange-600', on);
    btn.classList.toggle('text-orange-500', on);
    btn.classList.toggle('border-zinc-700', !on);
    btn.classList.toggle('text-zinc-400', !on);
  });
}

async function loadClubApplications(filter) {
  if (filter) _appFilter = filter;
  window._appFilter = _appFilter;
  setAppFilterButtons(_appFilter);

  var list = document.getElementById('admin-apps-list');
  var status = document.getElementById('admin-apps-status');
  if (!list) return;
  list.innerHTML = '<p class="text-zinc-500 text-sm"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading applications…</p>';
  if (status) status.textContent = '';

  try {
    if (!window.sb) throw new Error('Not connected');
    var q = window.sb.from('club_applications').select('*').order('created_at', { ascending: false });
    if (_appFilter && _appFilter !== 'all') q = q.eq('status', _appFilter);
    var res = await q;
    if (res.error) throw res.error;
    _appCache = res.data || [];
    renderClubApplications(_appCache);
    if (status) {
      var n = _appCache.length;
      status.textContent = n ? (n + ' ' + (_appFilter === 'all' ? 'application' : _appFilter) + (n === 1 ? '' : 's')) : 'No applications in this view.';
    }
  } catch (err) {
    console.warn('[apps]', err);
    var msg = (err && err.message) || 'Could not load applications';
    list.innerHTML = '<div class="bg-zinc-950 border border-red-900 rounded-2xl p-4 text-sm text-red-400">' +
      escapeApp(msg) +
      (/club_applications|schema cache|relation/i.test(msg)
        ? '<p class="text-zinc-500 mt-2">Run supabase SQL in club_applications.sql first.</p>'
        : '') +
      '</div>';
    if (status) status.textContent = '';
  }
}

function renderClubApplications(rows) {
  var list = document.getElementById('admin-apps-list');
  if (!list) return;
  if (!rows || !rows.length) {
    list.innerHTML = '<p class="text-zinc-500 text-sm">Nothing here.</p>';
    return;
  }
  list.innerHTML = rows.map(function (app) {
    var st = app.status || 'pending';
    var badge = st === 'approved'
      ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
      : st === 'denied'
        ? 'bg-red-950 text-red-400 border-red-900'
        : 'bg-amber-950 text-amber-400 border-amber-800';
    var pending = st === 'pending';
    var invite = '';
    if (st === 'approved' && app.invite_token) {
      var link = (location.origin || 'https://sbracing.ca') + '/accept.html?t=' + encodeURIComponent(app.invite_token);
      invite = '<div class="mt-3 text-xs text-zinc-400">Invite link <button type="button" onclick="copyAppInvite(\'' +
        String(app.invite_token).replace(/'/g, '') + '\')" class="text-orange-400 hover:text-orange-300">Copy</button>' +
        '<div class="font-mono text-[10px] text-zinc-500 break-all mt-1">' + escapeApp(link) + '</div></div>';
    }
    return (
      '<div class="bg-zinc-950 border border-zinc-800 rounded-2xl p-4">' +
        '<div class="flex flex-wrap items-start justify-between gap-3">' +
          '<div class="min-w-0">' +
            '<div class="font-semibold truncate">' + escapeApp(app.full_name) + '</div>' +
            '<div class="text-xs text-zinc-400 mt-0.5">' +
              '<a href="mailto:' + escapeApp(app.email) + '" class="hover:text-orange-400">' + escapeApp(app.email) + '</a>' +
              (app.phone ? ' · ' + escapeApp(app.phone) : '') +
              (app.city ? ' · ' + escapeApp(app.city) : '') +
            '</div>' +
          '</div>' +
          '<span class="text-[10px] uppercase tracking-wider px-2 py-1 rounded-lg border ' + badge + '">' + escapeApp(st) + '</span>' +
        '</div>' +
        '<div class="grid sm:grid-cols-2 gap-2 mt-3 text-xs text-zinc-400">' +
          '<div><span class="text-zinc-500">Experience</span><div class="text-zinc-200">' + escapeApp(experienceLabel(app.experience)) + '</div></div>' +
          '<div><span class="text-zinc-500">Heard about us</span><div class="text-zinc-200">' + escapeApp(app.how_found || '—') + '</div></div>' +
        '</div>' +
        '<p class="text-sm text-zinc-300 mt-3 whitespace-pre-wrap">' + escapeApp(app.why_join || '') + '</p>' +
        '<div class="text-[11px] text-zinc-600 mt-2">Applied ' + escapeApp(formatAppDate(app.created_at)) +
          (app.reviewed_at ? ' · Reviewed ' + escapeApp(formatAppDate(app.reviewed_at)) : '') + '</div>' +
        invite +
        (pending
          ? '<div class="flex flex-wrap gap-2 mt-4">' +
              '<button type="button" onclick="reviewClubApplication(\'' + app.id + '\',\'approved\')" class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold">Approve</button>' +
              '<button type="button" onclick="reviewClubApplication(\'' + app.id + '\',\'denied\')" class="px-4 py-2 rounded-xl border border-red-800 text-red-400 hover:bg-red-950 text-xs font-semibold">Deny</button>' +
              '<a href="mailto:' + encodeURIComponent(app.email) + '" class="px-4 py-2 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-900 text-xs font-semibold">Email</a>' +
            '</div>'
          : '') +
      '</div>'
    );
  }).join('');
}

async function reviewClubApplication(id, action) {
  if (!id || (action !== 'approved' && action !== 'denied')) return;
  var verb = action === 'approved' ? 'approve' : 'deny';
  if (!confirm('Really ' + verb + ' this application?')) return;

  var note = null;
  if (action === 'denied') {
    note = window.prompt('Optional note (only admins see this)') || null;
  }

  try {
    if (!window.sb) throw new Error('Not connected');

    var rec = null;
    var rpc = await window.sb.rpc('review_club_application', {
      p_id: id,
      p_action: action,
      p_note: note
    });
    if (rpc.error) {
      console.warn('[apps] rpc failed, trying direct update', rpc.error);
      var token = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '') : String(Date.now());
      var sess = await getSession();
      var base = {
        status: action,
        review_note: note,
        reviewed_at: new Date().toISOString()
      };
      if (sess && sess.user) base.reviewed_by = sess.user.id;
      var patch = Object.assign({}, base);
      if (action === 'approved') patch.invite_token = token;
      var upd = await window.sb.from('club_applications').update(patch).eq('id', id).select().maybeSingle();
      if (upd.error && /invite_token/i.test(upd.error.message || '')) {
        upd = await window.sb.from('club_applications').update(base).eq('id', id).select().maybeSingle();
      }
      if (upd.error) throw upd.error;
      rec = upd.data || {};
      if (action === 'approved' && !rec.invite_token) rec.invite_token = token;
      if (rec && rec.email) {
        try {
          if (action === 'approved') {
            await window.sb.from('profiles').update({ membership_status: 'active' }).ilike('email', rec.email);
          } else {
            await window.sb.from('profiles').update({ membership_status: 'denied' }).ilike('email', rec.email);
          }
        } catch (e2) {
          console.warn('[apps] profile sync', e2);
        }
      }
    } else {
      rec = rpc.data;
    }

    if (typeof showToast === 'function') {
      showToast(action === 'approved' ? 'Approved' : 'Denied');
    }
    if (action === 'approved' && rec && rec.email) {
      try {
        var token = rec.invite_token;
        var acceptUrl = (location.origin || 'https://sbracing.ca') + '/accept.html' + (token ? ('?t=' + encodeURIComponent(token)) : '');
        await fetch('https://formsubmit.co/ajax/' + encodeURIComponent(rec.email), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            _subject: 'You are in — SB Racing',
            _template: 'table',
            name: rec.full_name,
            message: 'Your application to SB Racing was approved. Create your login here: ' + acceptUrl,
            link: acceptUrl
          })
        });
      } catch (mailErr) {
        console.warn('[apps] notify email', mailErr);
      }
    }
    await loadClubApplications(_appFilter);
  } catch (err) {
    console.error('[apps] review', err);
    if (typeof showToast === 'function') showToast(err.message || 'Could not update application', true);
  }
}

async function copyAppInvite(token) {
  var link = (location.origin || 'https://sbracing.ca') + '/accept.html?t=' + encodeURIComponent(token || '');
  try {
    await navigator.clipboard.writeText(link);
    if (typeof showToast === 'function') showToast('Invite link copied');
  } catch (e) {
    window.prompt('Copy this invite link', link);
  }
}

window.loadClubApplications = loadClubApplications;
window.reviewClubApplication = reviewClubApplication;
window.copyAppInvite = copyAppInvite;

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

