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

    window._myId = user.id;
    window._isAdmin = !!(profile && profile.is_admin);

    // Admin tab — only for is_admin
    var adminBtn = document.getElementById('admin-tab-btn');
    if (adminBtn) {
        if (window._isAdmin) {
            adminBtn.classList.remove('hidden');
            refreshAdminAppBadge();
        } else {
            adminBtn.classList.add('hidden');
        }
    }

    await loadMemberDirectory();
    loadPrivateEvents();
    switchMemberTab(7);
}

let _memberDirCache = [];

async function loadMemberDirectory() {
  const grid = document.getElementById('member-directory');
  if (!grid || !window.sb) return;
  try {
    var res = await window.sb
      .from('profiles')
      .select('id, full_name, avatar_url, membership_tier, membership_status, created_at, riding_bike, experience_level')
      .order('full_name', { ascending: true });
    if (res.error && /riding_bike|experience_level|column|schema cache/i.test(String(res.error.message || ''))) {
      res = await window.sb
        .from('profiles')
        .select('id, full_name, avatar_url, membership_tier, membership_status, created_at')
        .order('full_name', { ascending: true });
    }
    if (res.error) throw res.error;
    var data = res.data;
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
    const exp = experienceLabel(p.experience_level);
    const sub = [tier + (active ? ' · Active' : ''), exp].filter(Boolean).join(' · ');
    return '<button type="button" onclick="openMemberProfile(\'' + p.id + '\')" class="text-left flex items-center gap-3 p-4 rounded-2xl bg-zinc-950 border border-zinc-800 hover:border-orange-700/60 transition-all w-full">' +
      av +
      '<div class="min-w-0 flex-1"><div class="font-semibold truncate">' + escapeHtml(name) + '</div>' +
      '<div class="text-xs ' + (active ? 'text-emerald-400' : 'text-zinc-500') + '">' + escapeHtml(sub) + '</div></div>' +
      '<i class="fa-solid fa-chevron-right text-zinc-600 text-xs"></i></button>';
  }).join('');
}

function lockPageForModal(lock) {
  var html = document.documentElement;
  var body = document.body;
  if (!body) return;
  if (lock) {
    if (!window._sbModalLockCount) {
      window._sbModalScrollY = window.scrollY || window.pageYOffset || 0;
    }
    window._sbModalLockCount = (window._sbModalLockCount || 0) + 1;
    html.classList.add('sb-page-lock');
    body.classList.add('sb-page-lock');
    body.style.position = 'fixed';
    body.style.width = '100%';
    body.style.left = '0';
    body.style.right = '0';
    body.style.top = '-' + (window._sbModalScrollY || 0) + 'px';
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
  } else {
    window._sbModalLockCount = Math.max(0, (window._sbModalLockCount || 1) - 1);
    if (window._sbModalLockCount > 0) return;
    html.classList.remove('sb-page-lock');
    body.classList.remove('sb-page-lock');
    body.style.position = '';
    body.style.width = '';
    body.style.left = '';
    body.style.right = '';
    body.style.top = '';
    body.style.overflow = '';
    html.style.overflow = '';
    if (window._sbModalScrollY != null) window.scrollTo(0, window._sbModalScrollY);
  }
}
window.lockPageForModal = lockPageForModal;

function experienceLabel(level) {
  var map = {
    beginner: 'Beginner',
    intermediate: 'Intermediate',
    advanced: 'Advanced',
    expert: 'Expert / Race'
  };
  return map[level] || '';
}

async function openMemberProfile(userId) {
  const modal = document.getElementById('member-profile-modal');
  const body = document.getElementById('member-profile-body');
  if (!modal || !body) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  lockPageForModal(true);
  body.innerHTML = '<div class="text-zinc-500 text-sm">Loading…</div>';
  try {
    var cols = 'id, full_name, avatar_url, membership_tier, membership_status, created_at, email, is_admin, bio, riding_bike, experience_level';
    if (window._isAdmin) cols += ', emergency_contact, phone';
    var res = await window.sb.from('profiles').select(cols).eq('id', userId).maybeSingle();
    if (res.error && /bio|riding_bike|experience_level|emergency_contact|column|schema cache/i.test(String(res.error.message || ''))) {
      res = await window.sb
        .from('profiles')
        .select('id, full_name, avatar_url, membership_tier, membership_status, created_at, email, is_admin, emergency_contact, phone')
        .eq('id', userId)
        .maybeSingle();
    }
    if (res.error) throw res.error;
    var p = res.data;
    if (!p) {
      body.innerHTML = '<p class="text-zinc-500">Member not found</p>';
      return;
    }
    const tierLabel = { trail_rider: 'Trail Rider', coulee_crusher: 'Coulee Crusher', youth: 'Youth', none: 'Member' };
    const name = p.full_name || 'Member';
    const initial = name.charAt(0).toUpperCase();
    const av = p.avatar_url
      ? '<img src="' + escapeAttr(p.avatar_url) + '" class="w-24 h-24 rounded-3xl object-cover bg-zinc-800 border border-zinc-700" alt="">'
      : '<div class="w-24 h-24 rounded-3xl bg-orange-600 text-white flex items-center justify-center text-2xl font-bold">' + initial + '</div>';
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
    const exp = experienceLabel(p.experience_level);
    var extra = '';
    if (p.bio) extra += '<div><div class="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Bio</div><p class="text-sm text-zinc-300 whitespace-pre-wrap">' + escapeHtml(p.bio) + '</p></div>';
    if (p.riding_bike) extra += '<div><div class="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Riding bike</div><p class="text-sm text-zinc-200">' + escapeHtml(p.riding_bike) + '</p></div>';
    if (exp) extra += '<div><div class="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Experience</div><p class="text-sm text-zinc-200">' + escapeHtml(exp) + '</p></div>';
    if (window._isAdmin && (p.emergency_contact || p.phone)) {
      extra += '<div class="rounded-2xl border border-orange-900/60 bg-orange-950/20 p-3">' +
        '<div class="text-[10px] uppercase tracking-widest text-orange-400 mb-1">Admin only</div>' +
        (p.phone ? '<p class="text-sm text-zinc-300">Phone: ' + escapeHtml(p.phone) + '</p>' : '') +
        (p.emergency_contact ? '<p class="text-sm text-zinc-300">Emergency: ' + escapeHtml(p.emergency_contact) + '</p>' : '') +
        '</div>';
    }
    body.innerHTML =
      '<div class="flex items-center gap-4">' + av +
      '<div><div class="text-xl font-bold">' + escapeHtml(name) + '</div>' +
      '<div class="text-sm text-emerald-400 mt-1">' + escapeHtml(tierLabel[p.membership_tier] || 'Member') +
      (p.membership_status === 'active' ? ' · Active' : '') + '</div>' +
      (exp ? '<div class="text-xs text-zinc-400 mt-1">' + escapeHtml(exp) + '</div>' : '') +
      (joined ? '<div class="text-xs text-zinc-500 mt-1">Joined ' + joined + '</div>' : '') +
      '</div></div>' +
      (extra ? '<div class="space-y-3 pt-1">' + extra + '</div>' : '') +
      rideHtml;
  } catch (e) {
    body.innerHTML = '<p class="text-red-400 text-sm">' + escapeHtml(e.message || 'Failed to load') + '</p>';
  }
}

function closeMemberProfile() {
  const modal = document.getElementById('member-profile-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  lockPageForModal(false);
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
    var bio = document.getElementById('profile-bio');
    var bike = document.getElementById('profile-bike');
    var exp = document.getElementById('profile-experience');
    if (bio) bio.value = profile?.bio || '';
    if (bike) bike.value = profile?.riding_bike || '';
    if (exp) exp.value = profile?.experience_level || '';
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
            if (typeof compressImageFile === 'function') {
                try { file = await compressImageFile(file, 1200, 0.82); } catch (ce) {}
            }
            if (file.size > 3.5 * 1024 * 1024) throw new Error('Image must be under 3.5MB');
            const ext = 'jpg';
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
            bio: (document.getElementById('profile-bio') && document.getElementById('profile-bio').value.trim()) || null,
            riding_bike: (document.getElementById('profile-bike') && document.getElementById('profile-bike').value.trim()) || null,
            experience_level: (document.getElementById('profile-experience') && document.getElementById('profile-experience').value) || null,
            updated_at: new Date().toISOString()
        };
        if (avatar_url) updates.avatar_url = avatar_url;

        var upd = await window.sb.from('profiles').update(updates).eq('id', user.id);
        if (upd.error && /bio|riding_bike|experience_level|column|schema cache/i.test(String(upd.error.message || ''))) {
            var fallback = {
                full_name: updates.full_name,
                phone: updates.phone,
                emergency_contact: updates.emergency_contact,
                updated_at: updates.updated_at
            };
            if (avatar_url) fallback.avatar_url = avatar_url;
            upd = await window.sb.from('profiles').update(fallback).eq('id', user.id);
            if (!upd.error) {
                throw new Error('Saved name and photo. Run profile_bio.sql in Supabase so bio, bike, and experience can save.');
            }
        }
        if (upd.error) throw upd.error;

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
  lockPageForModal(false);
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
    if (String(tabIndex) === '1') loadPrivateEvents();
    if (String(tabIndex) === '5') loadMemberDirectory();
    if (String(tabIndex) === '6') {
        // Tools open in their own modals
    }
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

function privateEventImageUrl(ev) {
    if (!ev) return '';
    if (ev.image_url) return String(ev.image_url);
    var m = String(ev.description || '').match(/\[\[image:([^\]]+)\]\]/i);
    return m ? m[1].trim() : '';
}

function privateEventExpired(ev) {
    if (!ev) return false;
    var exp = String(ev.description || '').match(/\[\[expire:(\d{4}-\d{2}-\d{2})T(\d{1,2}:\d{2})(?::\d{2})?\]\]/i);
    if (exp) {
        var hh = exp[2].length === 4 ? '0' + exp[2] : exp[2];
        var d = new Date(exp[1] + 'T' + hh + ':00');
        if (!isNaN(d.getTime())) return Date.now() > d.getTime();
    }
    if (!ev.event_date) return false;
    var dateStr = String(ev.event_date).slice(0, 10);
    var timeStr = '23:59:59';
    if (ev.event_time) {
        var tm = String(ev.event_time).match(/(\d{1,2}):(\d{2})/);
        if (tm) timeStr = (tm[1].length === 1 ? '0' + tm[1] : tm[1]) + ':' + tm[2] + ':00';
    }
    var start = new Date(dateStr + 'T' + timeStr);
    if (isNaN(start.getTime())) return false;
    return Date.now() > start.getTime();
}

async function loadPrivateEvents() {
    var list = document.getElementById('private-events-list');
    if (!list || !window.sb) return;
    list.innerHTML = '<div class="text-center text-zinc-500 py-8"><i class="fa-solid fa-spinner fa-spin"></i></div>';
    try {
        var res = await window.sb
            .from('events')
            .select('*')
            .eq('is_members_only', true)
            .order('event_date', { ascending: true })
            .limit(40);
        if (res.error) throw res.error;
        var rows = res.data || [];
        rows.sort(function (a, b) {
            var aDone = privateEventExpired(a) ? 1 : 0;
            var bDone = privateEventExpired(b) ? 1 : 0;
            if (aDone !== bDone) return aDone - bDone;
            return String(a.event_date || '').localeCompare(String(b.event_date || ''));
        });
        if (!rows.length) {
            list.innerHTML =
                '<div class="text-center text-zinc-500 py-10 border border-zinc-800 rounded-2xl bg-zinc-950">' +
                '<p class="font-medium text-zinc-300">No members-only events yet.</p>' +
                '<p class="text-xs mt-2">When a leader checks <span class="text-orange-400">Members only</span> on an event, it shows up here.</p>' +
                '<a href="events.html" class="inline-block mt-4 text-sm font-semibold text-orange-500">Open Events</a>' +
                '</div>';
            return;
        }
        list.innerHTML = rows.map(function (ev) {
            var expired = privateEventExpired(ev);
            var dateObj = ev.event_date ? new Date(String(ev.event_date).slice(0, 10) + 'T12:00:00') : null;
            var dateLabel = dateObj && !isNaN(dateObj.getTime())
                ? dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : '';
            var timeLabel = ev.event_time ? String(ev.event_time).slice(0, 5) : '';
            var img = privateEventImageUrl(ev);
            var imgHtml = img
                ? '<img src="' + escapeHtml(img) + '" alt="" class="w-16 h-16 rounded-2xl object-cover bg-zinc-800 shrink-0">'
                : '<div class="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center text-orange-500 shrink-0"><i class="fa-solid fa-lock"></i></div>';
            var sub = [dateLabel, timeLabel, ev.location].filter(Boolean).join(' · ');
            var cta = expired
                ? '<span class="px-3 py-1.5 text-xs font-semibold rounded-2xl border border-zinc-700 text-zinc-500">Completed</span>'
                : '<a href="events.html" class="px-4 py-1.5 text-xs font-semibold rounded-2xl border border-orange-600 text-orange-500 hover:bg-orange-950/40">View / RSVP</a>';
            return (
                '<div class="flex items-center gap-3 bg-zinc-950 border border-zinc-700 rounded-2xl p-4">' +
                imgHtml +
                '<div class="min-w-0 flex-1">' +
                '<div class="font-medium truncate">' + escapeHtml(ev.title || 'Event') + '</div>' +
                '<div class="text-xs text-zinc-400 mt-0.5 truncate">' + escapeHtml(sub || 'Members only') + '</div>' +
                '</div>' + cta + '</div>'
            );
        }).join('');
    } catch (e) {
        console.error('[members] private events', e);
        list.innerHTML = '<p class="text-center text-red-400 py-8 text-sm">Could not load members-only events.</p>';
    }
}

async function rsvpEvent(eventId) {
    location.href = 'events.html';
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

async function refreshAdminAppBadge() {
  var badge = document.getElementById('admin-tab-badge');
  if (!badge || !window._isAdmin || !window.sb) return;
  try {
    var res = await window.sb
      .from('club_applications')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    var count = typeof res.count === 'number' ? res.count : ((res.data && res.data.length) || 0);
    if (res.error) throw res.error;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch (e) {
    console.warn('[apps] badge', e);
  }
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
    refreshAdminAppBadge();
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
      var link = (window.SB_SITE_URL || 'https://sbracing.ca').replace(/\/$/, '') + '/accept?t=' + encodeURIComponent(app.invite_token);
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
        var acceptUrl = (window.SB_SITE_URL || 'https://sbracing.ca').replace(/\/$/, '') + '/accept' + (token ? ('?t=' + encodeURIComponent(token)) : '');
        var sessMail = await getSession();
        var access = (sessMail && sessMail.access_token) || '';
        var fnUrl = (window.SB_URL || '').replace(/\/$/, '') + '/functions/v1/send-approval-email';
        var mailRes = await fetch(fnUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + access,
            apikey: window.SB_ANON_KEY || ''
          },
          body: JSON.stringify({
            to: rec.email,
            name: rec.full_name,
            acceptUrl: acceptUrl
          })
        });
        if (!mailRes.ok) {
          var mailText = '';
          try { mailText = await mailRes.text(); } catch (e) {}
          console.warn('[apps] smtp2go', mailRes.status, mailText);
          if (typeof showToast === 'function') {
            showToast('Approved — email failed, copy the invite link', true);
          }
        } else if (typeof showToast === 'function') {
          showToast('Approved — invite email sent');
        }
      } catch (mailErr) {
        console.warn('[apps] notify email', mailErr);
        if (typeof showToast === 'function') {
          showToast('Approved — email failed, copy the invite link', true);
        }
      }
    }
    await loadClubApplications(_appFilter);
  } catch (err) {
    console.error('[apps] review', err);
    if (typeof showToast === 'function') showToast(err.message || 'Could not update application', true);
  }
}

function ensureAdminPermsUi() {
  return;
}

function adminToolModalId(which) {
  if (which === 'apps') return 'admin-apps-modal';
  if (which === 'perms') return 'admin-perms-modal';
  if (which === 'push') return 'admin-push-modal';
  return '';
}

function openAdminTool(which) {
  var id = adminToolModalId(which);
  var modal = document.getElementById(id);
  if (!modal) return;
  modal.style.display = 'flex';
  lockPageForModal(true);
  if (which === 'apps') loadClubApplications(window._appFilter || 'pending');
  if (which === 'perms') loadAdminMembers();
}

function closeAdminTool(which) {
  var id = which ? adminToolModalId(which) : '';
  var ids = id ? [id] : ['admin-apps-modal', 'admin-perms-modal', 'admin-push-modal'];
  ids.forEach(function (mid) {
    var modal = document.getElementById(mid);
    if (modal) modal.style.display = 'none';
  });
  lockPageForModal(false);
}

window.openAdminTool = openAdminTool;
window.closeAdminTool = closeAdminTool;

var _adminMemberCache = [];

async function loadAdminMembers() {
  var list = document.getElementById('admin-members-list');
  var status = document.getElementById('admin-members-status');
  if (!list) return;
  if (!window._isAdmin) {
    list.innerHTML = '<p class="text-zinc-500 text-sm">Admin only.</p>';
    return;
  }
  list.innerHTML = '<p class="text-zinc-500 text-sm"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading members…</p>';
  try {
    var res = await window.sb
      .from('profiles')
      .select('id, full_name, email, membership_tier, membership_status, is_admin, is_leader, created_at')
      .order('full_name', { ascending: true });
    if (res.error && /is_leader|column|schema cache/i.test(String(res.error.message || ''))) {
      res = await window.sb
        .from('profiles')
        .select('id, full_name, email, membership_tier, membership_status, is_admin, created_at')
        .order('full_name', { ascending: true });
    }
    if (res.error) throw res.error;
    _adminMemberCache = res.data || [];
    if (status) status.textContent = _adminMemberCache.length + ' member' + (_adminMemberCache.length === 1 ? '' : 's');
    renderAdminMembers(_adminMemberCache);
  } catch (err) {
    console.warn('[admin-members]', err);
    list.innerHTML = '<p class="text-red-400 text-sm">' + escapeHtml(err.message || 'Could not load members') +
      '</p><p class="text-zinc-500 text-xs mt-2">If this is an RLS error, run the admin update policy in supabase (profiles: admins can update other rows).</p>';
  }
}

function filterAdminMembers() {
  var q = (document.getElementById('admin-member-search')?.value || '').trim().toLowerCase();
  var rows = !_adminMemberCache ? [] : _adminMemberCache.filter(function (p) {
    if (!q) return true;
    return String(p.full_name || '').toLowerCase().includes(q) ||
      String(p.email || '').toLowerCase().includes(q);
  });
  renderAdminMembers(rows);
}

function renderAdminMembers(rows) {
  var list = document.getElementById('admin-members-list');
  if (!list) return;
  if (!rows.length) {
    list.innerHTML = '<p class="text-zinc-500 text-sm">No members match.</p>';
    return;
  }
  list.innerHTML = rows.map(function (p) {
    var id = String(p.id);
    var mine = window._myId && String(window._myId) === id;
    var tier = p.membership_tier || 'none';
    var st = p.membership_status || 'active';
    return (
      '<div class="bg-zinc-950 border border-zinc-800 rounded-2xl p-4" data-uid="' + escapeAttr(id) + '">' +
        '<div class="flex flex-wrap items-start justify-between gap-2">' +
          '<div class="min-w-0">' +
            '<div class="font-semibold truncate">' + escapeHtml(p.full_name || 'Member') +
              (mine ? ' <span class="text-[10px] uppercase tracking-wider text-orange-400">you</span>' : '') +
            '</div>' +
            '<div class="text-xs text-zinc-500 truncate">' + escapeHtml(p.email || '') + '</div>' +
          '</div>' +
          '<div class="flex flex-wrap gap-1">' +
            (p.is_admin ? '<span class="text-[10px] uppercase tracking-wider px-2 py-1 rounded-lg border border-orange-800 text-orange-400">Admin</span>' : '') +
            (p.is_leader ? '<span class="text-[10px] uppercase tracking-wider px-2 py-1 rounded-lg border border-emerald-800 text-emerald-400">Leader</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-3">' +
          '<label class="text-[10px] uppercase tracking-wider text-zinc-500">Role' +
            '<select onchange="queueMemberPerm(\'' + id + '\',\'membership_tier\',this.value)" class="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200">' +
              opt('none', 'Member', tier) +
              opt('trail_rider', 'Trail Rider', tier) +
              opt('coulee_crusher', 'Coulee Crusher', tier) +
              opt('youth', 'Youth / Student', tier) +
            '</select></label>' +
          '<label class="text-[10px] uppercase tracking-wider text-zinc-500">Status' +
            '<select onchange="queueMemberPerm(\'' + id + '\',\'membership_status\',this.value)" class="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200">' +
              opt('active', 'Active', st) +
              opt('pending', 'Pending', st) +
              opt('inactive', 'Inactive', st) +
              opt('denied', 'Denied', st) +
            '</select></label>' +
          '<label class="text-[10px] uppercase tracking-wider text-zinc-500">Leader' +
            '<select onchange="queueMemberPerm(\'' + id + '\',\'is_leader\',this.value)" class="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200">' +
              opt('false', 'No', p.is_leader ? 'true' : 'false') +
              opt('true', 'Yes', p.is_leader ? 'true' : 'false') +
            '</select></label>' +
          '<label class="text-[10px] uppercase tracking-wider text-zinc-500">Access' +
            '<select ' + (mine ? 'disabled title="You cannot change your own admin flag"' : '') +
              ' onchange="queueMemberPerm(\'' + id + '\',\'is_admin\',this.value)" class="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200">' +
              opt('false', 'Member', p.is_admin ? 'true' : 'false') +
              opt('true', 'Admin', p.is_admin ? 'true' : 'false') +
            '</select></label>' +
        '</div>' +
      '</div>'
    );
  }).join('');
}

function opt(value, label, current) {
  return '<option value="' + value + '"' + (String(current) === String(value) ? ' selected' : '') + '>' + label + '</option>';
}

async function queueMemberPerm(userId, field, value) {
  if (!window._isAdmin) {
    if (typeof showToast === 'function') showToast('Admin only', true);
    return;
  }
  if (!userId || !field) return;
  if (field === 'is_admin' && window._myId && String(window._myId) === String(userId)) {
    if (typeof showToast === 'function') showToast('You cannot change your own admin access', true);
    loadAdminMembers();
    return;
  }
  var patch = {};
  if (field === 'is_admin') patch.is_admin = value === 'true' || value === true;
  else if (field === 'is_leader') {
    patch.is_leader = value === 'true' || value === true;
  } else patch[field] = value;
  try {
    var upd = await window.sb.from('profiles').update(patch).eq('id', userId).select('id, full_name, email, membership_tier, membership_status, is_admin, is_leader, created_at').maybeSingle();
    if (upd.error && /is_leader|column|schema cache/i.test(String(upd.error.message || ''))) {
      if (field === 'is_leader') {
        throw new Error('Add is_leader to profiles (SQL: alter table profiles add column if not exists is_leader boolean default false)');
      }
      var fallback = Object.assign({}, patch);
      delete fallback.is_leader;
      upd = await window.sb.from('profiles').update(fallback).eq('id', userId).select('id, full_name, email, membership_tier, membership_status, is_admin, created_at').maybeSingle();
    }
    if (upd.error) throw upd.error;
    _adminMemberCache = (_adminMemberCache || []).map(function (row) {
      return String(row.id) === String(userId) && upd.data ? upd.data : row;
    });
    if (typeof showToast === 'function') showToast('Permissions saved');
    filterAdminMembers();
  } catch (err) {
    console.error('[admin-members] save', err);
    if (typeof showToast === 'function') showToast(err.message || 'Could not save permissions', true);
    loadAdminMembers();
  }
}

window.ensureAdminPermsUi = ensureAdminPermsUi;
window.loadAdminMembers = loadAdminMembers;
window.filterAdminMembers = filterAdminMembers;
window.queueMemberPerm = queueMemberPerm;

async function copyAppInvite(token) {
  var link = (window.SB_SITE_URL || 'https://sbracing.ca').replace(/\/$/, '') + '/accept?t=' + encodeURIComponent(token || '');
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

// ─── Notification preference toggles ───────────────────────────────────────
var NOTIF_PREF_KEY = 'sb_notif_prefs';
var NOTIF_PREF_IDS = {
  notify_push: 'pref-notify-push',
  notify_events: 'pref-notify-events',
  notify_forum: 'pref-notify-forum',
  notify_comments: 'pref-notify-comments',
  notify_rsvp: 'pref-notify-rsvp',
  notify_admin: 'pref-notify-admin'
};

function defaultNotifPrefs() {
  return {
    notify_push: true,
    notify_events: true,
    notify_forum: true,
    notify_comments: true,
    notify_rsvp: true,
    notify_admin: true
  };
}

function readLocalNotifPrefs() {
  try {
    var raw = localStorage.getItem(NOTIF_PREF_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function writeLocalNotifPrefs(prefs) {
  try {
    localStorage.setItem(NOTIF_PREF_KEY, JSON.stringify(prefs));
  } catch (e) {}
}

function setSwitchOn(el, on) {
  if (!el) return;
  el.setAttribute('aria-checked', on ? 'true' : 'false');
}

function isSwitchOn(el) {
  return !!(el && el.getAttribute('aria-checked') === 'true');
}

function applyNotifPrefsToUI(prefs) {
  Object.keys(NOTIF_PREF_IDS).forEach(function (key) {
    var el = document.getElementById(NOTIF_PREF_IDS[key]);
    if (!el) return;
    var val = prefs[key];
    setSwitchOn(el, val !== false);
  });
}

function collectNotifPrefsFromUI() {
  var prefs = defaultNotifPrefs();
  Object.keys(NOTIF_PREF_IDS).forEach(function (key) {
    var el = document.getElementById(NOTIF_PREF_IDS[key]);
    prefs[key] = isSwitchOn(el);
  });
  return prefs;
}

function prefsFromProfile(profile) {
  var prefs = defaultNotifPrefs();
  if (!profile) return prefs;
  Object.keys(NOTIF_PREF_IDS).forEach(function (key) {
    if (typeof profile[key] === 'boolean') prefs[key] = profile[key];
  });
  return prefs;
}

async function loadNotifSettings() {
  var local = readLocalNotifPrefs();
  if (local) applyNotifPrefsToUI(Object.assign(defaultNotifPrefs(), local));
  else applyNotifPrefsToUI(defaultNotifPrefs());

  try {
    var user = await getCurrentUser();
    if (!user) return collectNotifPrefsFromUI();
    var profile = await getProfile(user.id);
    if (profile) {
      var fromServer = prefsFromProfile(profile);
      // Server wins when columns exist; otherwise keep local/defaults
      var merged = Object.assign(defaultNotifPrefs(), local || {}, fromServer);
      applyNotifPrefsToUI(merged);
      writeLocalNotifPrefs(merged);
      return merged;
    }
  } catch (e) {
    console.warn('[notif prefs] load', e);
  }
  return collectNotifPrefsFromUI();
}

async function persistNotifPrefs(prefs) {
  writeLocalNotifPrefs(prefs);
  var errEl = document.getElementById('notif-settings-error');
  if (errEl) {
    errEl.classList.add('hidden');
    errEl.textContent = '';
  }
  try {
    var user = await getCurrentUser();
    if (!user || !window.sb) return true;
    var patch = {
      notify_push: !!prefs.notify_push,
      notify_events: !!prefs.notify_events,
      notify_forum: !!prefs.notify_forum,
      notify_comments: !!prefs.notify_comments,
      notify_rsvp: !!prefs.notify_rsvp,
      notify_admin: !!prefs.notify_admin,
      updated_at: new Date().toISOString()
    };
    var { error } = await window.sb.from('profiles').update(patch).eq('id', user.id);
    if (error) {
      console.warn('[notif prefs] supabase update', error);
      // Local save still succeeded — columns may not exist yet
      return true;
    }
    return true;
  } catch (e) {
    console.warn('[notif prefs] persist', e);
    return true;
  }
}

async function saveNotifSettings() {
  var prefs = collectNotifPrefsFromUI();
  var ok = await persistNotifPrefs(prefs);
  if (typeof window.showNotifSavedBanner === 'function') window.showNotifSavedBanner();
  if (typeof showToast === 'function') showToast('Notification settings saved');
  return ok;
}

function bindNotifToggles() {
  Object.keys(NOTIF_PREF_IDS).forEach(function (key) {
    var el = document.getElementById(NOTIF_PREF_IDS[key]);
    if (!el || el._sbBound) return;
    el._sbBound = true;
    el.addEventListener('click', function () {
      var next = !isSwitchOn(el);
      setSwitchOn(el, next);
      var prefs = collectNotifPrefsFromUI();
      persistNotifPrefs(prefs);
      if (typeof window.showNotifSavedBanner === 'function') window.showNotifSavedBanner();
    });
  });
}

window.loadNotifSettings = loadNotifSettings;
window.saveNotifSettings = saveNotifSettings;

document.addEventListener('DOMContentLoaded', function () {
  bindNotifToggles();
  loadNotifSettings();
});


