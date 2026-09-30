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
        statusEl.textContent = memberRoleLabel(profile);
    }

    const av = document.getElementById('member-avatar');
    if (av) {
        av.src = profile?.avatar_url || '/assets/logo.png';
    }

    window._myProfile = profile || null;
    fillProfileForm(profile, user);

    window._myId = user.id;
    window._isAdmin = !!(profile && profile.is_admin);

    // Admin tab — only for is_admin
    var adminBtn = document.getElementById('admin-tab-btn');
    if (adminBtn) {
        if (window._isAdmin) {
            adminBtn.classList.remove('hidden');
            refreshAdminAppBadge();
            loadClubPushMaster();
        } else {
            adminBtn.classList.add('hidden');
        }
    }

    await loadMemberDirectory();
    loadPrivateEvents();
    switchMemberTab(7);
    if (window.SBBadges) {
        window.SBBadges.loadBadgeCatalog().then(function () {
            return window.SBBadges.evaluateMyBadges();
        }).then(function () {
            if (user && user.id) window.SBBadges.renderOwnBadges(user.id);
        }).catch(function (e) { console.warn('[badges] boot', e); });
    }
}

function memberRoleLabel(p) {
    if (p && p.is_admin) return 'Admin';
    if (p && p.is_leader) return 'Leader';
    var tierLabel = {
        trail_rider: 'Trail Rider',
        coulee_crusher: 'Coulee Crusher',
        youth: 'Youth',
        none: 'Member'
    };
    return tierLabel[p && p.membership_tier] || 'Member';
}

let _memberDirCache = [];
var _riderScoreByUser = {};

function riderScoreBadge(score) {
  if (score == null || score === '') return '';
  return '<span class="shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg border border-orange-800 text-orange-400">' + score + '</span>';
}

function scoreForUser(userId) {
  if (!userId) return null;
  var n = _riderScoreByUser[String(userId)];
  return (typeof n === 'number') ? n : null;
}

function paintOwnRiderScore() {
  var nameEl = document.getElementById('member-name');
  if (!nameEl) return;
  var wrap = document.getElementById('member-name-wrap');
  if (!wrap) {
    wrap = nameEl.parentElement;
  }
  var existing = document.getElementById('member-rider-score');
  var score = scoreForUser(window._myId);
  if (score == null) {
    if (existing) existing.remove();
    return;
  }
  if (!existing) {
    existing = document.createElement('span');
    existing.id = 'member-rider-score';
    existing.className = 'ml-2 align-middle text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg border border-orange-800 text-orange-400';
    nameEl.insertAdjacentElement('afterend', existing);
  }
  existing.textContent = score;
}

async function attachRiderScores(members) {
  if (!window.sb || !members || !members.length) return;
  try {
    var year = new Date().getFullYear();
    var res = await window.sb
      .from('member_routes')
      .select('user_id, distance_km, elev_gain_m, avg_speed_kmh, max_speed_kmh, trail_splits, geojson, created_at')
      .gte('created_at', year + '-01-01');
    if (res.error) {
      res = await window.sb
        .from('member_routes')
        .select('user_id, distance_km, elev_gain_m, created_at, geojson')
        .gte('created_at', year + '-01-01');
    }
    if (res.error) throw res.error;
    var byUser = {};
    (res.data || []).forEach(function (row) {
      var id = String(row.user_id || '');
      if (!id) return;
      if (!byUser[id]) byUser[id] = [];
      byUser[id].push(typeof enrichRideRow === 'function' ? enrichRideRow(row) : row);
    });
    _riderScoreByUser = {};
    Object.keys(byUser).forEach(function (id) {
      var scored = computeRiderScore(byUser[id]);
      _riderScoreByUser[id] = scored && scored.total != null ? scored.total : 0;
    });
    members.forEach(function (p) {
      var n = _riderScoreByUser[String(p.id)];
      p.rider_score = typeof n === 'number' ? n : null;
    });
  } catch (e) {
    console.warn('[rider-score]', e);
  }
}

async function loadMemberDirectory() {
  const grid = document.getElementById('member-directory');
  if (!grid || !window.sb) return;
  try {
    var res = await window.sb
      .from('profiles')
      .select('id, full_name, avatar_url, membership_tier, membership_status, created_at, riding_bike, experience_level, is_admin, is_leader')
      .order('full_name', { ascending: true });
    if (res.error && /riding_bike|experience_level|is_leader|is_admin|column|schema cache/i.test(String(res.error.message || ''))) {
      res = await window.sb
        .from('profiles')
        .select('id, full_name, avatar_url, membership_tier, membership_status, created_at, is_admin')
        .order('full_name', { ascending: true });
    }
    if (res.error) throw res.error;
    var data = res.data || [];
    await attachRiderScores(data);
    _memberDirCache = data;
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
  grid.innerHTML = list.map(function (p) {
    const name = p.full_name || 'Member';
    const initial = name.charAt(0).toUpperCase();
    const av = p.avatar_url
      ? '<img src="' + escapeAttr(p.avatar_url) + '" class="w-12 h-12 rounded-2xl object-cover bg-zinc-800" alt="">'
      : '<div class="w-12 h-12 rounded-2xl bg-orange-600 text-white flex items-center justify-center font-bold">' + initial + '</div>';
    const tier = memberRoleLabel(p);
    const active = p.membership_status === 'active';
    const exp = experienceLabel(p.experience_level);
    const sub = [tier + (active ? ' · Active' : ''), exp].filter(Boolean).join(' · ');
    const score = riderScoreBadge(p.rider_score);
    return '<button type="button" onclick="openMemberProfile(\'' + p.id + '\')" class="text-left flex items-center gap-3 p-4 rounded-2xl bg-zinc-950 border border-zinc-800 hover:border-orange-700/60 transition-all w-full">' +
      av +
      '<div class="min-w-0 flex-1"><div class="font-semibold truncate flex items-center gap-2">' + escapeHtml(name) + score + '</div>' +
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
    var cols = 'id, full_name, avatar_url, membership_tier, membership_status, created_at, email, is_admin, is_leader, bio, riding_bike, experience_level';
    if (window._isAdmin) cols += ', emergency_contact, phone';
    var res = await window.sb.from('profiles').select(cols).eq('id', userId).maybeSingle();
    if (res.error && /bio|riding_bike|experience_level|emergency_contact|column|schema cache/i.test(String(res.error.message || ''))) {
      res = await window.sb
        .from('profiles')
        .select('id, full_name, avatar_url, membership_tier, membership_status, created_at, email, is_admin, is_leader, emergency_contact, phone')
        .eq('id', userId)
        .maybeSingle();
    }
    if (res.error) throw res.error;
    var p = res.data;
    if (!p) {
      body.innerHTML = '<p class="text-zinc-500">Member not found</p>';
      return;
    }
    const name = p.full_name || 'Member';
    const initial = name.charAt(0).toUpperCase();
    const av = p.avatar_url
      ? '<img src="' + escapeAttr(p.avatar_url) + '" class="w-24 h-24 rounded-3xl object-cover bg-zinc-800 border border-zinc-700" alt="">'
      : '<div class="w-24 h-24 rounded-3xl bg-orange-600 text-white flex items-center justify-center text-2xl font-bold">' + initial + '</div>';
    let rideHtml = '';
    try {
      var rideRes = await window.sb
        .from('member_routes')
        .select('id, name, distance_km, elev_gain_m, points, created_at, geojson')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(8);
      if (rideRes.error) {
        rideRes = await window.sb
          .from('member_routes')
          .select('id, name, distance_km, created_at, geojson')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(8);
      }
      var rides = rideRes.data || [];
      if (rides.length) {
        rideHtml = '<div class="mt-4"><div class="text-xs uppercase tracking-widest text-zinc-500 mb-2">Recent rides</div><div class="space-y-2">' +
          rides.map(function (r) {
            return '<button type="button" class="w-full text-left text-sm bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 flex items-center gap-3" onclick="openRideRouteModalById(\'' + r.id + '\')">' +
              routeThumbSvg(r.geojson, 72, 40) +
              '<span class="min-w-0 flex-1"><span class="block truncate font-medium">' + escapeHtml(r.name || 'Ride') + '</span>' +
              '<span class="block text-xs text-zinc-500">' + formatRideMeta(r) + '</span></span></button>';
          }).join('') + '</div></div>';
        window._profileRideCache = (window._profileRideCache || {});
        rides.forEach(function (r) { window._profileRideCache[String(r.id)] = r; });
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
      '<div class="text-sm text-emerald-400 mt-1">' + escapeHtml(memberRoleLabel(p)) +
      (p.membership_status === 'active' ? ' · Active' : '') + '</div>' +
      (exp ? '<div class="text-xs text-zinc-400 mt-1">' + escapeHtml(exp) + '</div>' : '') +
      (joined ? '<div class="text-xs text-zinc-500 mt-1">Joined ' + joined + '</div>' : '') +
      '</div></div>' +
      (extra ? '<div class="space-y-3 pt-1">' + extra + '</div>' : '') +
      rideHtml +
      '<div id="profile-badges-mount" class="pt-2"></div>';
    if (window.SBBadges) {
      window.SBBadges.renderProfileBadges(userId, document.getElementById('profile-badges-mount'));
    }
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
        tier.textContent = memberRoleLabel(profile) + (st ? ' · ' + st : '');
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
        window._myProfile = Object.assign({}, window._myProfile || {}, updates);
        if (avatar_url) window._myProfile.avatar_url = avatar_url;
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
        loadClubPushMaster();
    }
    if (String(tabIndex) === '4') {
        if (window._myProfile) fillProfileForm(window._myProfile, { email: window._myProfile.email });
        loadProfileRecentRides();
        if (window.SBBadges && window._myId) {
            window.SBBadges.loadBadgeCatalog().then(function () {
                return window.SBBadges.loadMemberBadges(window._myId);
            }).then(function () {
                window.SBBadges.renderOwnBadges(window._myId);
            }).catch(function () {});
        }
    }
    if (String(tabIndex) === '7') loadRideLeaderboard(window._lbPeriod || 'yearly');
    if (String(tabIndex) === '8') loadRideStats(window._statsPeriod || 'yearly');
}

async function loadRideLeaderboard(period) {
    period = period || 'yearly';
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
            return '<button type="button" onclick="openMemberProfile(\'' + escapeHtml(String(row.user_id || '')) + '\')" class="w-full text-left flex items-center gap-3 bg-zinc-950 border ' +
                (mine ? 'border-orange-700' : 'border-zinc-800') +
                ' rounded-2xl px-4 py-3 hover:border-orange-600 transition-colors">' +
                '<div class="w-8 text-center font-semibold">' + medal + '</div>' +
                '<div class="flex-1 min-w-0">' +
                '<div class="font-medium truncate text-zinc-100">' + escapeHtml(row.full_name || 'Rider') +
                (mine ? ' <span class="text-orange-500 text-xs">you</span>' : '') + '</div>' +
                '<div class="text-xs text-zinc-500">' + (row.rides || 0) + ' ride' + (row.rides === 1 ? '' : 's') + '</div>' +
                '</div>' +
                '<div class="text-right shrink-0">' +
                '<div class="font-semibold text-orange-400">' + (row.points || 0) + ' pts</div>' +
                '<div class="text-[11px] text-zinc-500">' + (row.km || 0) + ' km · +' + (row.elev_m || 0) + ' m</div>' +
                '</div></button>';
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
    if (typeof evaluateMyBadges === 'function') evaluateMyBadges();
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



function applyClubPushMasterUi(enabled) {
  var sw = document.getElementById('admin-push-master-switch');
  var hint = document.getElementById('admin-push-master-hint');
  if (sw) sw.setAttribute('aria-checked', enabled ? 'true' : 'false');
  if (hint) {
    hint.textContent = enabled
      ? 'Master switch for every device. Off pauses events, forum, RSVP, and admin broadcasts.'
      : 'Paused — no remote pushes will leave the club until you turn this back on.';
  }
  window._clubPushEnabled = !!enabled;
  syncAdminPushPausedUi();
}

function syncAdminPushPausedUi() {
  var paused = window._clubPushEnabled === false;
  var banner = document.getElementById('admin-push-paused-banner');
  var btn = document.getElementById('admin-push-send-btn');
  if (banner) {
    if (paused) banner.classList.remove('hidden');
    else banner.classList.add('hidden');
  }
  if (btn) {
    btn.disabled = !!paused;
    if (paused) btn.innerHTML = '<i class="fa-solid fa-bell-slash mr-2"></i>PUSHES PAUSED';
    else btn.innerHTML = '<i class="fa-solid fa-paper-plane mr-2"></i>SEND PUSH';
  }
}

async function loadClubPushMaster() {
  if (!window._isAdmin) return;
  try {
    var enabled = true;
    if (typeof getClubPushEnabled === 'function') {
      enabled = await getClubPushEnabled();
    }
    applyClubPushMasterUi(enabled);
  } catch (e) {
    console.warn('[admin push master] load', e);
  }
}

async function toggleClubPushMaster() {
  if (!window._isAdmin) {
    if (typeof showToast === 'function') showToast('Admins only', true);
    return;
  }
  var sw = document.getElementById('admin-push-master-switch');
  var currentlyOn = !!(sw && sw.getAttribute('aria-checked') === 'true');
  var next = !currentlyOn;
  if (sw) sw.disabled = true;
  try {
    var enabled;
    if (typeof setClubPushEnabled === 'function') {
      enabled = await setClubPushEnabled(next);
    } else {
      throw new Error('Push helper missing');
    }
    applyClubPushMasterUi(enabled);
    if (typeof showToast === 'function') {
      showToast(enabled ? 'Club push notifications ON' : 'Club push notifications OFF');
    }
  } catch (e) {
    console.warn('[admin push master] toggle', e);
    if (typeof showToast === 'function') showToast((e && e.message) || 'Could not update push switch', true);
    applyClubPushMasterUi(currentlyOn);
  } finally {
    if (sw) sw.disabled = false;
  }
}

window.loadClubPushMaster = loadClubPushMaster;
window.toggleClubPushMaster = toggleClubPushMaster;

/** Admin-only: send custom remote push via notify-event edge function */
async function sendAdminPush() {
    var titleEl = document.getElementById('admin-push-title');
    var bodyEl = document.getElementById('admin-push-body');
    var audienceEl = document.getElementById('admin-push-audience');
    var urlEl = document.getElementById('admin-push-url');
    var btn = document.getElementById('admin-push-send-btn');
    var statusEl = document.getElementById('admin-push-status');

    if (window._clubPushEnabled === false) {
        if (typeof showToast === 'function') showToast('Club pushes are paused', true);
        syncAdminPushPausedUi();
        return;
    }

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
      rec = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
    }

    if (typeof showToast === 'function') {
      showToast(action === 'approved' ? 'Approved' : 'Denied');
    }
    if (action === 'approved' && rec && rec.email) {
      try {
        var token = rec.invite_token;
        var acceptUrl = (window.SB_SITE_URL || 'https://sbracing.ca').replace(/\/$/, '') + '/accept' + (token ? ('?t=' + encodeURIComponent(token)) : '');
        var mail = await window.sb.functions.invoke('send-approval-email', {
          body: {
            to: rec.email,
            name: rec.full_name,
            acceptUrl: acceptUrl
          }
        });
        if (mail.error) {
          console.warn('[apps] smtp2go', mail.error);
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
  if (which === 'badges') return 'admin-badges-modal';
  if (which === 'review') return 'admin-review-modal';
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
  if (which === 'push') syncAdminPushPausedUi();
  if (which === 'badges') loadAdminBadgeAward();
  if (which === 'review') loadRideReviewQueue();
}

function closeAdminTool(which) {
  var id = which ? adminToolModalId(which) : '';
  var ids = id ? [id] : ['admin-apps-modal', 'admin-perms-modal', 'admin-push-modal', 'admin-badges-modal', 'admin-review-modal'];
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
    var clubRole = p.is_admin ? 'admin' : (p.is_leader ? 'leader' : 'member');
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
        '<div class="grid sm:grid-cols-3 gap-2 mt-3">' +
          '<label class="text-[10px] uppercase tracking-wider text-zinc-500">Membership' +
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
          '<label class="text-[10px] uppercase tracking-wider text-zinc-500">Club role' +
            '<select ' + (mine ? 'disabled title="You cannot change your own admin flag"' : '') +
              ' onchange="queueMemberPerm(\'' + id + '\',\'club_role\',this.value)" class="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200">' +
              opt('member', 'Member', clubRole) +
              opt('leader', 'Leader', clubRole) +
              opt('admin', 'Admin', clubRole) +
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
  if ((field === 'is_admin' || field === 'club_role') && window._myId && String(window._myId) === String(userId)) {
    if (typeof showToast === 'function') showToast('You cannot change your own admin access', true);
    loadAdminMembers();
    return;
  }
  var patch = {};
  if (field === 'club_role') {
    if (value === 'admin') {
      patch.is_admin = true;
    } else if (value === 'leader') {
      patch.is_admin = false;
      patch.is_leader = true;
    } else {
      patch.is_admin = false;
      patch.is_leader = false;
    }
  } else if (field === 'is_admin') patch.is_admin = value === 'true' || value === true;
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

function routeCoordsFromGeojson(gj) {
  if (!gj) return [];
  var geom = gj.geometry || gj;
  var coords = geom.coordinates || [];
  if (geom.type === 'MultiLineString' && coords.length) {
    coords = coords.reduce(function (acc, line) { return acc.concat(line); }, []);
  }
  if (coords.length && Array.isArray(coords[0]) && typeof coords[0][0] === 'number') {
    return coords.map(function (c) { return { lng: c[0], lat: c[1] }; });
  }
  var pts = (gj.properties && gj.properties.points) || [];
  return pts.filter(function (p) { return p && p.lat != null && p.lng != null; });
}

function routeThumbSvg(gj, w, h) {
  w = w || 88;
  h = h || 48;
  var pts = routeCoordsFromGeojson(gj);
  if (pts.length < 2) {
    return '<div class="shrink-0 rounded-lg bg-zinc-900 border border-zinc-800" style="width:' + w + 'px;height:' + h + 'px"></div>';
  }
  var minLat = pts[0].lat, maxLat = pts[0].lat, minLng = pts[0].lng, maxLng = pts[0].lng;
  pts.forEach(function (p) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  });
  var pad = 4;
  var dx = Math.max(maxLng - minLng, 0.00001);
  var dy = Math.max(maxLat - minLat, 0.00001);
  var d = pts.map(function (p, i) {
    var x = pad + ((p.lng - minLng) / dx) * (w - pad * 2);
    var y = pad + (1 - (p.lat - minLat) / dy) * (h - pad * 2);
    return (i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return '<svg class="shrink-0 rounded-lg bg-zinc-900 border border-zinc-800" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">' +
    '<path d="' + d + '" fill="none" stroke="#f97316" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
    '</svg>';
}

function formatRideClock(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return m + ':' + String(s).padStart(2, '0');
}

function enrichRideRow(r) {
  r = r || {};
  var p = (r.geojson && r.geojson.properties) ? r.geojson.properties : {};
  var elapsed = r.elapsed_sec != null ? r.elapsed_sec : p.elapsed_sec;
  var moving = r.moving_sec != null ? r.moving_sec : p.moving_sec;
  var avg = r.avg_speed_kmh != null ? r.avg_speed_kmh : p.avg_speed_kmh;
  var top = r.max_speed_kmh != null ? r.max_speed_kmh : p.max_speed_kmh;
  var elev = r.elev_gain_m != null ? r.elev_gain_m : p.elev_gain_m;
  var dist = r.distance_km != null ? Number(r.distance_km) : (p.distance_km != null ? Number(p.distance_km) : 0);
  if ((avg == null || avg === 0) && moving && dist) avg = dist / (Number(moving) / 3600);
  return {
    id: r.id,
    user_id: r.user_id,
    name: r.name,
    created_at: r.created_at,
    started_at: r.started_at || p.started_at,
    geojson: r.geojson,
    points: r.points || p.score || 0,
    review_status: r.review_status || p.review_status || 'ok',
    review_reason: r.review_reason || p.review_reason || '',
    distance_km: dist || 0,
    elev_gain_m: Number(elev) || 0,
    elev_loss_m: Number(r.elev_loss_m != null ? r.elev_loss_m : p.elev_loss_m) || 0,
    elapsed_sec: Number(elapsed) || 0,
    moving_sec: Number(moving) || 0,
    avg_speed_kmh: Math.round((Number(avg) || 0) * 10) / 10,
    max_speed_kmh: Math.round((Number(top) || 0) * 10) / 10,
    trail_name: r.trail_name || p.trail_name || null,
    trail_id: r.trail_id || p.trail_id || null,
    trail_splits: Array.isArray(r.trail_splits) ? r.trail_splits : (Array.isArray(p.trail_splits) ? p.trail_splits : [])
  };
}

function formatRideMeta(r) {
  r = enrichRideRow(r);
  var bits = [];
  if (r.distance_km) bits.push(Number(r.distance_km).toFixed(1) + ' km');
  if (r.elev_gain_m) bits.push('+' + Math.round(r.elev_gain_m) + ' m');
  if (r.elapsed_sec) bits.push(formatRideClock(r.elapsed_sec));
  if (r.avg_speed_kmh) bits.push(r.avg_speed_kmh.toFixed(1) + ' avg');
  if (r.max_speed_kmh) bits.push(r.max_speed_kmh.toFixed(1) + ' top');
  if (r.points) bits.push(r.points + ' pts');
  if (r.created_at) {
    try {
      bits.push(new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    } catch (e) {}
  }
  return bits.join(' · ') || 'Saved route';
}

async function fetchMemberRoutes(userId, limit) {
  if (!window.sb || !userId) return [];
  var q = window.sb
    .from('member_routes')
    .select('id, name, distance_km, elev_gain_m, elev_loss_m, points, created_at, geojson, elapsed_sec, moving_sec, avg_speed_kmh, max_speed_kmh, started_at, trail_name, trail_id, trail_splits')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (limit) q = q.limit(limit);
  var res = await q;
  if (res.error) {
    res = await window.sb
      .from('member_routes')
      .select('id, name, distance_km, created_at, geojson')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit || 20);
  }
  if (res.error) throw res.error;
  return res.data || [];
}

async function loadProfileRecentRides() {
  var box = document.getElementById('profile-recent-rides');
  if (!box) return;
  try {
    var user = await getCurrentUser();
    if (!user) {
      box.innerHTML = '<p class="text-zinc-500 text-sm">Sign in to see saved rides.</p>';
      return;
    }
    box.innerHTML = '<p class="text-zinc-500 text-sm">Loading…</p>';
    var rides = await fetchMemberRoutes(user.id, 20);
    window._profileRideCache = {};
    rides.forEach(function (r) { window._profileRideCache[String(r.id)] = r; });
    if (!rides.length) {
      box.innerHTML = '<p class="text-zinc-500 text-sm">No saved routes yet. Record or draw a route on <a class="text-orange-400 hover:underline" href="trails.html">Trails</a> and tap Save.</p>';
      return;
    }
    box.innerHTML = rides.map(function (r) {
      return '<button type="button" onclick="openRideRouteModalById(\'' + r.id + '\')" class="w-full text-left flex items-center gap-3 p-3 rounded-2xl bg-zinc-950 border border-zinc-800 hover:border-orange-700 transition-colors">' +
        routeThumbSvg(r.geojson, 88, 52) +
        '<span class="min-w-0 flex-1">' +
        '<span class="block font-medium truncate text-zinc-100">' + escapeHtml(r.name || 'Ride') + '</span>' +
        '<span class="block text-xs text-zinc-500 mt-0.5">' + escapeHtml(formatRideMeta(r)) + '</span>' +
        '</span><button type="button" class="shrink-0 text-zinc-500 hover:text-red-400 px-2 py-2" onclick="event.stopPropagation();deleteSavedRide(\'' + r.id + '\')" title="Delete ride"><i class="fa-solid fa-trash"></i></button></button>';
    }).join('');
  } catch (e) {
    console.warn('[profile rides]', e);
    box.innerHTML = '<p class="text-red-400 text-sm">' + escapeHtml(e.message || 'Could not load rides') + '</p>';
  }
}

function openRideRouteModalById(id) {
  var row = window._profileRideCache && window._profileRideCache[String(id)];
  if (!row) {
    if (typeof showToast === 'function') showToast('Ride not loaded', true);
    return;
  }
  openRideRouteModal(row);
}

function openRideRouteModal(row) {
  var modal = document.getElementById('ride-route-modal');
  var title = document.getElementById('ride-route-title');
  var meta = document.getElementById('ride-route-meta');
  var mapEl = document.getElementById('ride-route-map');
  var link = document.getElementById('ride-route-open-trails');
  if (!modal || !mapEl) return;
  if (title) title.textContent = row.name || 'Ride';
  if (meta) meta.textContent = formatRideMeta(row);
  mapEl.innerHTML = routeThumbSvg(row.geojson, 520, 240).replace('width="520"', 'width="100%"').replace('height="240"', 'height="100%" class="w-full h-full"');
  if (link) link.href = 'trails.html?route=' + encodeURIComponent(row.id);
  window._openRideId = row.id || null;
  modal.style.display = 'flex';
  if (typeof lockPageForModal === 'function') lockPageForModal(true);
}

function closeRideRouteModal() {
  var modal = document.getElementById('ride-route-modal');
  if (modal) modal.style.display = 'none';
  window._openRideId = null;
  if (typeof lockPageForModal === 'function') lockPageForModal(false);
}

async function deleteSavedRide(id) {
  id = id || window._openRideId;
  if (!id) {
    if (typeof showToast === 'function') showToast('No ride selected', true);
    return;
  }
  if (!confirm('Delete this ride? This cannot be undone.')) return;
  try {
    if (!window.sb) throw new Error('Not connected');
    var res = await window.sb.from('member_routes').delete().eq('id', id);
    if (res.error) throw res.error;
    if (window._profileRideCache) delete window._profileRideCache[String(id)];
    closeRideRouteModal();
    if (typeof showToast === 'function') showToast('Ride deleted');
    loadProfileRecentRides();
    if (typeof loadRideStats === 'function') loadRideStats(window._statsPeriod || 'yearly');
  } catch (e) {
    console.error('[delete ride]', e);
    if (typeof showToast === 'function') showToast(e.message || 'Could not delete ride', true);
  }
}

function scoreTargets(diff) {
  var d = String(diff || 'intermediate').toLowerCase();
  if (d === 'easy' || d === 'green') return { avg: 11, top: 28, weight: 0.45 };
  if (d === 'advanced' || d === 'black' || d === 'expert') return { avg: 17, top: 48, weight: 1 };
  return { avg: 14, top: 36, weight: 0.7 };
}

function clamp01(n) { return Math.max(0, Math.min(1, n)); }

/** 0–100 skill score for the selected period. Volume stays in club points. */
function computeRiderScore(rides, club) {
  var parts = { speed: 0, peak: 0, difficulty: 0, completion: 0, climb: 0 };
  if (!rides || !rides.length) return { total: 0, parts: parts, note: 'Record a ride to start a score.' };

  var speedW = 0, speedSum = 0, peakBest = 0, peakCap = 36;
  var km = 0, diffKm = 0, elev = 0, runs = 0, e2e = 0;
  rides.forEach(function (r) {
    var splits = r.trail_splits || [];
    if (splits.length) {
      splits.forEach(function (s) {
        var t = scoreTargets(s.difficulty);
        var skm = Number(s.distance_km) || 0;
        var w = Math.max(0.2, skm);
        if (s.avg_speed_kmh) {
          speedSum += clamp01(s.avg_speed_kmh / t.avg) * w;
          speedW += w;
        }
        if ((s.max_speed_kmh || 0) / t.top > peakBest) {
          peakBest = (s.max_speed_kmh || 0) / t.top;
          peakCap = t.top;
        }
        km += skm;
        diffKm += skm * t.weight;
        runs += 1;
        if (s.end_to_end) e2e += 1;
      });
    } else if (r.avg_speed_kmh) {
      var w2 = Math.max(0.2, r.distance_km || 0);
      speedSum += clamp01(r.avg_speed_kmh / 14) * w2;
      speedW += w2;
      if ((r.max_speed_kmh || 0) / 36 > peakBest) peakBest = (r.max_speed_kmh || 0) / 36;
    }
    km += splits.length ? 0 : (r.distance_km || 0);
    elev += r.elev_gain_m || 0;
  });

  var absSpeed = clamp01(speedW ? speedSum / speedW : 0);
  var absPeak = clamp01(peakBest);
  var myAvg = speedW ? (speedSum / speedW) : 0;
  var clubAvg = club && club.avgSpeed ? club.avgSpeed : 0;
  var clubTop = club && club.topSpeed ? club.topSpeed : 0;
  var vsClubSpeed = clubAvg > 0 ? clamp01((myAvg * 14) / clubAvg) : absSpeed;
  var vsClubPeak = clubTop > 0 ? clamp01((peakBest * peakCap) / clubTop) : absPeak;
  if (clubAvg > 0) parts.speed = Math.round(((absSpeed + vsClubSpeed) / 2) * 30);
  else parts.speed = Math.round(absSpeed * 30);
  if (clubTop > 0) parts.peak = Math.round(((absPeak + vsClubPeak) / 2) * 15);
  else parts.peak = Math.round(absPeak * 15);
  parts.vsClub = !!(clubAvg || clubTop);
  parts.difficulty = Math.round(clamp01(km ? diffKm / km : 0.5) * 20);
  parts.completion = Math.round(clamp01(runs ? e2e / runs : 0) * 20);
  var climbRate = km > 0.3 ? (elev / km) / 20 : 0;
  parts.climb = Math.round(clamp01(climbRate) * 15);
  var total = parts.speed + parts.peak + parts.difficulty + parts.completion + parts.climb;
  var note = total >= 90 ? 'Dialed in' : total >= 75 ? 'Strong' : total >= 55 ? 'Building' : total >= 30 ? 'Getting started' : 'Room to climb';
  if (parts.vsClub) note += ' · compared to club';
  return { total: total, parts: parts, note: note, peakCap: peakCap };
}

function rideInStatsPeriod(r, period) {
  var t = r.started_at || r.created_at;
  if (!t || period === 'all') return true;
  var d = new Date(t);
  if (isNaN(d.getTime())) return true;
  var now = new Date();
  if (period === 'weekly') return (now - d) <= 7 * 24 * 3600 * 1000;
  if (period === 'monthly') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  if (period === 'yearly') return d.getFullYear() === now.getFullYear();
  return true;
}

async function loadRideStats(period) {
  period = period || window._statsPeriod || 'yearly';
  window._statsPeriod = period;
  document.querySelectorAll('.stats-period').forEach(function (btn) {
    var on = btn.getAttribute('data-period') === period;
    btn.classList.toggle('border-orange-600', on);
    btn.classList.toggle('text-orange-500', on);
    btn.classList.toggle('border-zinc-700', !on);
    btn.classList.toggle('text-zinc-400', !on);
  });
  var status = document.getElementById('stats-status');
  var summary = document.getElementById('stats-summary');
  var prs = document.getElementById('stats-prs');
  var trails = document.getElementById('stats-trails');
  var list = document.getElementById('stats-rides');
  if (summary) summary.innerHTML = '<p class="text-zinc-500 text-sm col-span-full">Loading…</p>';
  try {
    var user = await getCurrentUser();
    if (!user) {
      if (status) status.textContent = 'Sign in to see your stats.';
      if (summary) summary.innerHTML = '';
      return;
    }
    var raw = await fetchMemberRoutes(user.id, 200);
    var rides = raw.map(enrichRideRow).filter(function (r) { return rideInStatsPeriod(r, period); });
    var labels = { weekly: 'this week', monthly: 'this month', yearly: 'this year', all: 'all time' };
    if (status) {
      status.textContent = rides.length
        ? rides.length + ' ride' + (rides.length === 1 ? '' : 's') + ' ' + (labels[period] || period)
        : 'No saved rides ' + (labels[period] || period) + '. Record one on Trails.';
    }
    if (!rides.length) {
      if (summary) summary.innerHTML = '';
      if (prs) prs.innerHTML = '<p class="text-zinc-500 text-sm col-span-full">Save a GPS ride to start a history.</p>';
      if (trails) trails.innerHTML = '';
      if (list) list.innerHTML = '';
      return;
    }

    var totKm = 0, totElev = 0, totPts = 0, totElapsed = 0, totMoving = 0, maxTop = 0;
    rides.forEach(function (r) {
      totKm += r.distance_km || 0;
      totElev += r.elev_gain_m || 0;
      if (r.review_status !== 'dq' && r.review_status !== 'flagged') totPts += Number(r.points) || 0;
      totElapsed += r.elapsed_sec || 0;
      totMoving += r.moving_sec || 0;
      if ((r.max_speed_kmh || 0) > maxTop) maxTop = r.max_speed_kmh || 0;
    });
    var overallAvg = totMoving > 0 ? totKm / (totMoving / 3600) : 0;

    function scoreBar(label, value, max) {
      var pct = max ? Math.round((value / max) * 100) : 0;
      return '<div><div class="flex justify-between text-zinc-400 mb-1"><span>' + label + '</span><span>' + value + '/' + max + '</span></div>' +
        '<div class="h-1.5 rounded-full bg-zinc-800 overflow-hidden"><div class="h-full bg-orange-500" style="width:' + pct + '%"></div></div></div>';
    }
    function card(label, value, sub) {
      return '<div class="rounded-2xl bg-zinc-950 border border-zinc-800 p-4">' +
        '<div class="text-[10px] uppercase tracking-wider text-zinc-500">' + label + '</div>' +
        '<div class="text-xl font-black tracking-tight text-zinc-100 mt-1">' + value + '</div>' +
        (sub ? '<div class="text-[11px] text-zinc-500 mt-0.5">' + sub + '</div>' : '') +
        '</div>';
    }
    var club = await loadClubPace(period);
    var rider = computeRiderScore(rides, club);
    if (summary) {
      summary.innerHTML =
        '<div class="rounded-2xl bg-zinc-950 border border-orange-700 p-4 col-span-2 sm:col-span-3 lg:col-span-4">' +
          '<div class="flex items-end justify-between gap-3">' +
            '<div><div class="text-[10px] uppercase tracking-wider text-orange-400">Rider score</div>' +
            '<div class="text-4xl font-black tracking-tight text-zinc-100 mt-1">' + rider.total + '<span class="text-lg text-zinc-500">/100</span></div>' +
            '<div class="text-xs text-zinc-400 mt-1">' + escapeHtml(rider.note) + ' · work the bars, not just the km</div></div>' +
            '<div class="text-right text-[11px] text-zinc-500">Club points ' + Math.round(totPts) + '</div>' +
          '</div>' +
          '<div class="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-4 text-[11px]">' +
            scoreBar('Speed', rider.parts.speed, 30) +
            scoreBar('Top speed', rider.parts.peak, 15) +
            scoreBar('Difficulty', rider.parts.difficulty, 20) +
            scoreBar('Finish trails', rider.parts.completion, 20) +
            scoreBar('Climb', rider.parts.climb, 15) +
          '</div>' +
        '</div>' +
        card('Rides', String(rides.length)) +
        card('Distance', totKm.toFixed(1) + ' km') +
        card('Climbing', Math.round(totElev) + ' m') +
        card('Points', String(Math.round(totPts)), 'volume') +
        card('Elapsed', formatRideClock(totElapsed)) +
        card('Moving', formatRideClock(totMoving)) +
        card('Avg speed', overallAvg.toFixed(1) + ' km/h', 'moving time') +
        card('Top speed', maxTop.toFixed(1) + ' km/h');
    }

    function bestOf(arr, key, minVal) {
      var best = null;
      arr.forEach(function (r) {
        var v = Number(r[key]) || 0;
        if (v <= (minVal || 0)) return;
        if (!best || v > Number(best[key])) best = r;
      });
      return best;
    }
    function fastestTime(arr) {
      var best = null;
      arr.forEach(function (r) {
        var v = Number(r.moving_sec || r.elapsed_sec) || 0;
        if (v <= 0) return;
        if (!best || v < (Number(best.moving_sec || best.elapsed_sec) || 0)) best = r;
      });
      return best;
    }
    function prRow(label, ride, value, key) {
      if (!ride) return '<div class="rounded-2xl bg-zinc-950 border border-zinc-800 p-4 text-sm text-zinc-500">' + label + ' — no data yet</div>';
      return '<button type="button" onclick="openPbChart(\'' + key + '\')" class="text-left rounded-2xl bg-zinc-950 border border-zinc-800 hover:border-orange-700 p-4 w-full">' +
        '<div class="text-[10px] uppercase tracking-wider text-zinc-500">' + label + '</div>' +
        '<div class="font-semibold text-zinc-100 mt-1">' + escapeHtml(value) + '</div>' +
        '<div class="text-xs text-zinc-500 mt-0.5 truncate">' + escapeHtml(ride.name || 'Ride') +
        (ride.trail_name ? ' · ' + ride.trail_name : '') + ' · tap for chart</div></button>';
    }
    var longest = bestOf(rides, 'distance_km', 0);
    var mostClimb = bestOf(rides, 'elev_gain_m', 0);
    var fastestAvg = bestOf(rides.filter(function (r) { return (r.distance_km || 0) >= 0.5; }), 'avg_speed_kmh', 0);
    var fastestTop = bestOf(rides, 'max_speed_kmh', 0);
    var splitRides = [];
    rides.forEach(function (r) {
      (r.trail_splits || []).forEach(function (s) {
        splitRides.push({
          id: r.id,
          name: s.trail_name || r.name,
          trail_name: s.trail_name,
          moving_sec: s.moving_sec || s.elapsed_sec,
          elapsed_sec: s.elapsed_sec,
          end_to_end: s.end_to_end
        });
      });
    });
    var bestTime = fastestTime(splitRides.filter(function (s) { return s.end_to_end; })) ||
      fastestTime(splitRides) ||
      fastestTime(rides.filter(function (r) { return r.trail_name && (r.moving_sec || r.elapsed_sec); }));
    if (prs) {
      prs.innerHTML =
        prRow('Longest ride', longest, longest ? longest.distance_km.toFixed(1) + ' km' : '', 'distance') +
        prRow('Most climbing', mostClimb, mostClimb ? Math.round(mostClimb.elev_gain_m) + ' m' : '', 'climb') +
        prRow('Best average', fastestAvg, fastestAvg ? fastestAvg.avg_speed_kmh.toFixed(1) + ' km/h' : '', 'avg') +
        prRow('Top speed', fastestTop, fastestTop ? fastestTop.max_speed_kmh.toFixed(1) + ' km/h' : '', 'top') +
        prRow('Fastest trail time', bestTime, bestTime ? formatRideClock(bestTime.moving_sec || bestTime.elapsed_sec) : '', 'time');
      function seriesOf(key) {
        return rides.map(function (r) {
          return { t: new Date(r.started_at || r.created_at).getTime() || 0, v: Number(r[key]) || 0 };
        }).filter(function (p) { return p.v > 0; });
      }
      window._pbChart = {
        distance: Object.assign(packPb('Longest ride', 'km', false, longest && longest.distance_km, club && club.compare && club.compare.distance), { series: seriesOf('distance_km') }),
        climb: Object.assign(packPb('Most climbing', 'm', false, mostClimb && mostClimb.elev_gain_m, club && club.compare && club.compare.climb), { series: seriesOf('elev_gain_m') }),
        avg: Object.assign(packPb('Best average', 'km/h', false, fastestAvg && fastestAvg.avg_speed_kmh, club && club.compare && club.compare.avg), { series: seriesOf('avg_speed_kmh') }),
        top: Object.assign(packPb('Top speed', 'km/h', false, fastestTop && fastestTop.max_speed_kmh, club && club.compare && club.compare.top), { series: seriesOf('max_speed_kmh') }),
        time: Object.assign(packPb('Fastest end-to-end', 'sec', true, bestTime && (bestTime.elapsed_sec || bestTime.moving_sec), clubTimeCompare(club, bestTime)), { series: splitRides.filter(function (s) { return s.end_to_end; }).map(function (s) { return { t: 0, v: s.elapsed_sec || s.moving_sec }; }) })
      };
    }

    var byTrail = {};
    rides.forEach(function (r) {
      var parts = (r.trail_splits && r.trail_splits.length) ? r.trail_splits : null;
      if (parts) {
        parts.forEach(function (s) {
          var key = s.trail_id || s.trail_name;
          if (!key) return;
          if (!byTrail[key]) byTrail[key] = { name: s.trail_name || key, runs: 0, e2e: 0, km: 0, bestSec: null, bestE2E: null, top: 0 };
          var g = byTrail[key];
          g.runs += 1;
          if (s.end_to_end) g.e2e += 1;
          g.km += Number(s.distance_km) || 0;
          if ((s.max_speed_kmh || 0) > g.top) g.top = s.max_speed_kmh || 0;
          var sec = s.elapsed_sec || s.moving_sec;
          if (s.end_to_end && sec && (!g.bestE2E || sec < g.bestE2E)) g.bestE2E = sec;
          if (sec && (!g.bestSec || sec < g.bestSec)) g.bestSec = sec;
        });
      } else if (r.trail_name || r.trail_id) {
        var key2 = r.trail_id || r.trail_name;
        if (!byTrail[key2]) byTrail[key2] = { name: r.trail_name || key2, runs: 0, e2e: 0, km: 0, bestSec: null, top: 0 };
        var g2 = byTrail[key2];
        g2.runs += 1;
        g2.km += r.distance_km || 0;
        if ((r.max_speed_kmh || 0) > g2.top) g2.top = r.max_speed_kmh || 0;
        var sec2 = r.moving_sec || r.elapsed_sec;
        if (sec2 && (!g2.bestSec || sec2 < g2.bestSec)) g2.bestSec = sec2;
      }
    });
    var trailRows = Object.keys(byTrail).map(function (k) { return byTrail[k]; });
    trailRows.sort(function (a, b) { return b.runs - a.runs; });
    window._trailGraphs = {};
    trailRows.forEach(function (g) {
      var mine = [];
      rides.forEach(function (r) {
        (r.trail_splits || []).forEach(function (s) {
          if ((s.trail_name || s.trail_id) !== g.name && s.trail_name !== g.name) return;
          if (!s.end_to_end) return;
          mine.push({ t: new Date(s.started_at || r.started_at || r.created_at).getTime() || mine.length, v: s.elapsed_sec || s.moving_sec });
        });
      });
      var clubArr = (club && club.e2eByTrail && club.e2eByTrail[g.name]) || [];
      var cmp = clubArr.length ? (function () {
        var sum = 0, best = clubArr[0];
        clubArr.forEach(function (x) { sum += x.v; if (x.v < best.v) best = x; });
        return { avg: sum / clubArr.length, best: best.v, who: (club.names && club.names[best.user_id]) || 'Club rider', ride: g.name };
      })() : null;
      window._trailGraphs[g.name] = Object.assign(packPb(g.name + ' end-to-end', 'sec', true, g.bestE2E, cmp), { series: mine });
    });
    if (trails) {
      if (!trailRows.length) {
        trails.innerHTML = '<p class="text-zinc-500 text-sm">Record a ride on Trails — splits appear when GPS matches a mapped trail.</p>';
      } else {
        var e2eBoard = trailRows.filter(function (g) { return g.bestE2E; }).slice().sort(function (a, b) { return a.bestE2E - b.bestE2E; });
        trails.innerHTML =
          (e2eBoard.length
            ? '<div class="font-semibold mb-2">Your end-to-end times</div>' + e2eBoard.map(function (g) {
              return '<button type="button" onclick="openTrailGraph(\'' + escapeAttr(g.name) + '\')" class="w-full text-left rounded-2xl bg-zinc-950 border border-orange-900/50 px-4 py-3 mb-2"><div class="font-medium text-zinc-100">' + escapeHtml(g.name) + '</div>' +
                '<div class="text-sm text-orange-400 mt-0.5">' + formatRideClock(g.bestE2E) + ' best · ' + g.e2e + ' finish' + (g.e2e === 1 ? '' : 'es') + ' · tap for graph</div></button>';
            }).join('') + '<div class="font-semibold mb-2 mt-4">All trails</div>'
            : '') +
          trailRows.map(function (g) {
          return '<button type="button" onclick="openTrailGraph(\'' + escapeAttr(g.name) + '\')" class="w-full text-left rounded-2xl bg-zinc-950 border border-zinc-800 px-4 py-3">' +
            '<div class="font-medium text-zinc-100">' + escapeHtml(g.name) + '</div>' +
            '<div class="text-xs text-zinc-500 mt-1">' +
            g.runs + ' run' + (g.runs === 1 ? '' : 's') +
            (g.e2e ? ' · ' + g.e2e + ' end-to-end' : '') +
            (g.bestE2E ? ' · E2E ' + formatRideClock(g.bestE2E) : '') +
            ' · ' + g.km.toFixed(1) + ' km' +
            (g.top ? ' · top ' + g.top.toFixed(1) + ' km/h' : '') +
            ' · tap for graph</div></button>';
        }).join('');
      }
    }

    window._profileRideCache = window._profileRideCache || {};
    rides.forEach(function (r) { window._profileRideCache[String(r.id)] = r; });
    if (list) {
      list.innerHTML = rides.map(function (r) {
        var splitHtml = '';
        if (r.trail_splits && r.trail_splits.length) {
          splitHtml = '<span class="block text-[11px] text-zinc-500 mt-1 space-y-0.5">' +
            r.trail_splits.map(function (s) {
              return '<span class="block">' + escapeHtml(s.trail_name || 'Trail') +
                (s.end_to_end ? ' · end-to-end' : '') +
                ' · ' + formatRideClock(s.elapsed_sec || s.moving_sec) +
                (s.max_speed_kmh ? ' · ' + Number(s.max_speed_kmh).toFixed(1) + ' top' : '') +
                '</span>';
            }).join('') + '</span>';
        }
        return '<button type="button" onclick="openRideRouteModalById(\'' + r.id + '\')" class="w-full text-left flex items-center gap-3 p-3 rounded-2xl bg-zinc-950 border border-zinc-800 hover:border-orange-700 transition-colors">' +
          routeThumbSvg(r.geojson, 88, 52) +
          '<span class="min-w-0 flex-1">' +
          '<span class="block font-medium truncate text-zinc-100">' + escapeHtml(r.name || 'Ride') +
          (r.trail_name ? ' <span class="text-orange-400 text-xs font-normal">' + escapeHtml(r.trail_name) + '</span>' : '') +
          '</span>' +
          '<span class="block text-xs text-zinc-500 mt-0.5">' + escapeHtml(formatRideMeta(r)) + '</span>' +
          splitHtml +
          '</span><button type="button" class="shrink-0 text-zinc-500 hover:text-red-400 px-2 py-2" onclick="event.stopPropagation();deleteSavedRide(\'' + r.id + '\')" title="Delete ride"><i class="fa-solid fa-trash"></i></button></button>';
      }).join('');
    }
    renderClubPace(club, rides);
    setStatsSection(window._statsSection || 'you');
  } catch (e) {
    console.warn('[stats]', e);
    if (status) status.textContent = e.message || 'Could not load stats';
    if (summary) summary.innerHTML = '';
  }
}

async function riderNames(ids) {
  var map = {};
  (_memberDirCache || []).forEach(function (p) { if (p && p.id) map[p.id] = p.full_name || 'Member'; });
  var missing = (ids || []).filter(function (id) { return id && !map[id]; });
  if (missing.length && window.sb) {
    try {
      var res = await window.sb.from('profiles').select('id, full_name').in('id', missing.slice(0, 80));
      (res.data || []).forEach(function (p) { map[p.id] = p.full_name || 'Member'; });
    } catch (e) {}
  }
  return map;
}

function packPb(title, unit, lowerBetter, you, clubStat) {
  return {
    title: title,
    unit: unit,
    lowerBetter: !!lowerBetter,
    you: Number(you) || 0,
    avg: clubStat && clubStat.avg ? Number(clubStat.avg) : 0,
    best: clubStat && clubStat.best ? Number(clubStat.best) : 0,
    who: (clubStat && clubStat.who) || '',
    ride: (clubStat && clubStat.ride) || ''
  };
}

function clubTimeCompare(club, bestTime) {
  if (!club || !club.e2eByTrail || !bestTime) return null;
  var key = bestTime.trail_name || bestTime.name;
  var arr = club.e2eByTrail[key] || [];
  if (!arr.length) {
    var all = [];
    Object.keys(club.e2eByTrail).forEach(function (k) { all = all.concat(club.e2eByTrail[k]); });
    arr = all;
  }
  if (!arr.length) return null;
  var sum = 0, best = arr[0];
  arr.forEach(function (x) { sum += x.v; if (x.v < best.v) best = x; });
  return { avg: sum / arr.length, best: best.v, who: (club.names && club.names[best.user_id]) || 'Club rider', ride: best.name || key || '' };
}

function pbLabel(v, unit) {
  if (!v) return '—';
  if (unit === 'sec') return formatRideClock(v);
  if (unit === 'm') return Math.round(v) + ' m';
  return Number(v).toFixed(1) + ' ' + unit;
}

function graphSvg(pack) {
  var series = (pack.series || []).slice().sort(function (a, b) { return a.t - b.t; });
  var w = 440, h = 220, pad = 28;
  var vals = series.map(function (p) { return p.v; }).concat([pack.avg || 0, pack.best || 0, pack.you || 0]).filter(function (n) { return n > 0; });
  var min = vals.length ? Math.min.apply(null, vals) : 0;
  var max = vals.length ? Math.max.apply(null, vals) : 1;
  if (max === min) max = min + 1;
  function y(v) { return pad + (1 - (v - min) / (max - min)) * (h - pad * 2); }
  function x(i) { return pad + (series.length < 2 ? (w - pad * 2) / 2 : i * ((w - pad * 2) / (series.length - 1))); }
  var d = series.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1); }).join(' ');
  var dots = series.map(function (p, i) {
    return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="4" fill="#f97316"><title>' + pbLabel(p.v, pack.unit) + '</title></circle>';
  }).join('');
  function guide(v, color, label) {
    if (!v) return '';
    var yy = y(v).toFixed(1);
    return '<line x1="' + pad + '" y1="' + yy + '" x2="' + (w - 8) + '" y2="' + yy + '" stroke="' + color + '" stroke-dasharray="4 4"/>' +
      '<text x="' + (w - 8) + '" y="' + (Number(yy) - 4) + '" fill="' + color + '" font-size="10" text-anchor="end">' + label + ' ' + pbLabel(v, pack.unit) + '</text>';
  }
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="w-full h-56">' +
    guide(pack.avg, '#a1a1aa', 'Avg') +
    guide(pack.best, '#22c55e', 'Best') +
    (d ? '<path d="' + d + '" fill="none" stroke="#f97316" stroke-width="2.5"/>' : '') +
    dots +
    '<text x="' + pad + '" y="' + (h - 6) + '" fill="#71717a" font-size="10">Your rides</text>' +
    '</svg>' +
    '<div class="flex gap-3 text-[11px] text-zinc-400 mt-1"><span class="text-orange-400">● you</span><span>┈ club avg</span><span class="text-emerald-400">┈ club best</span></div>';
}

function showGraph(pack) {
  var modal = document.getElementById('pb-chart-modal');
  var chart = document.getElementById('pb-chart');
  if (!pack || !modal || !chart) return;
  document.getElementById('pb-chart-title').textContent = pack.title;
  document.getElementById('pb-chart-sub').textContent = pack.lowerBetter ? 'Lower is better' : 'Higher is better';
  chart.innerHTML = graphSvg(pack);
  var who = document.getElementById('pb-chart-who');
  if (who) {
    who.textContent = pack.who
      ? ('Club best: ' + pack.who + (pack.ride ? ' · ' + pack.ride : '') + ' · ' + pbLabel(pack.best, pack.unit))
      : 'No other club rides in this period yet.';
  }
  modal.style.display = 'flex';
}

function openPbChart(key) {
  showGraph(window._pbChart && window._pbChart[key]);
}

function openTrailGraph(key) {
  showGraph(window._trailGraphs && window._trailGraphs[key]);
}

function closePbChart() {
  var modal = document.getElementById('pb-chart-modal');
  if (modal) modal.style.display = 'none';
}

function setStatsSection(section) {
  window._statsSection = section || 'you';
  ['you', 'club', 'trails', 'log'].forEach(function (id) {
    var el = document.getElementById('stats-sec-' + id);
    if (el) el.classList.toggle('hidden', id !== window._statsSection);
  });
  document.querySelectorAll('.stats-section').forEach(function (btn) {
    var on = btn.getAttribute('data-section') === window._statsSection;
    btn.classList.toggle('border-orange-600', on);
    btn.classList.toggle('text-orange-500', on);
    btn.classList.toggle('border-zinc-700', !on);
    btn.classList.toggle('text-zinc-400', !on);
  });
}

async function loadClubPace(period) {
  var empty = { riders: 0, avgSpeed: 0, topSpeed: 0, trails: [] };
  if (!window.sb) return empty;
  try {
    var res = await window.sb
      .from('member_routes')
      .select('user_id, distance_km, avg_speed_kmh, max_speed_kmh, trail_name, trail_splits, geojson, created_at, started_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (res.error) return empty;
    var rows = (res.data || []).map(enrichRideRow).filter(function (r) { return rideInStatsPeriod(r, period); });
    var users = {};
    var speedW = 0, speedSum = 0, top = 0;
    var trails = {};
    var distVals = [], climbVals = [], avgVals = [], topVals = [];
    var e2eByTrail = {};
    rows.forEach(function (r) {
      if (r.user_id) users[r.user_id] = true;
      if (r.avg_speed_kmh && r.distance_km) {
        speedSum += r.avg_speed_kmh * r.distance_km;
        speedW += r.distance_km;
      }
      if ((r.max_speed_kmh || 0) > top) top = r.max_speed_kmh;
      if (r.distance_km) distVals.push({ v: r.distance_km, user_id: r.user_id, name: r.name });
      if (r.elev_gain_m) climbVals.push({ v: r.elev_gain_m, user_id: r.user_id, name: r.name });
      if (r.avg_speed_kmh && (r.distance_km || 0) >= 0.5) avgVals.push({ v: r.avg_speed_kmh, user_id: r.user_id, name: r.name });
      if (r.max_speed_kmh) topVals.push({ v: r.max_speed_kmh, user_id: r.user_id, name: r.name });
      var parts = (r.trail_splits && r.trail_splits.length) ? r.trail_splits : (r.trail_name ? [r] : []);
      parts.forEach(function (s) {
        var key = s.trail_id || s.trail_name;
        if (!key) return;
        if (!trails[key]) trails[key] = { name: s.trail_name || key, w: 0, sum: 0, top: 0, n: 0, bestE2E: null, e2e: 0 };
        var g = trails[key];
        var km = Number(s.distance_km) || 0;
        if (s.avg_speed_kmh && km) { g.sum += s.avg_speed_kmh * km; g.w += km; }
        if ((s.max_speed_kmh || 0) > g.top) g.top = s.max_speed_kmh;
        g.n += 1;
        if (s.end_to_end) {
          g.e2e += 1;
          var et = s.elapsed_sec || s.moving_sec;
          if (et && (!g.bestE2E || et < g.bestE2E)) g.bestE2E = et;
          if (et) {
            var ek = String(s.trail_name || key);
            if (!e2eByTrail[ek]) e2eByTrail[ek] = [];
            e2eByTrail[ek].push({ v: et, user_id: r.user_id, name: s.trail_name || r.name, t: s.started_at || r.started_at || r.created_at });
          }
        }
      });
    });
    var list = Object.keys(trails).map(function (k) {
      var g = trails[k];
      return { name: g.name, avg: g.w ? g.sum / g.w : 0, top: g.top, n: g.n, bestE2E: g.bestE2E, e2e: g.e2e };
    }).sort(function (a, b) { return b.n - a.n; });
    var names = await riderNames(Object.keys(users));
    function stat(arr, lower) {
      if (!arr.length) return { avg: 0, best: 0, who: '' };
      var sum = 0;
      var best = arr[0];
      arr.forEach(function (x) {
        sum += x.v;
        if (lower ? x.v < best.v : x.v > best.v) best = x;
      });
      return { avg: sum / arr.length, best: best.v, who: names[best.user_id] || 'Club rider', ride: best.name || '' };
    }
    return {
      riders: Object.keys(users).length,
      avgSpeed: speedW ? speedSum / speedW : 0,
      topSpeed: top,
      trails: list,
      names: names,
      compare: {
        distance: stat(distVals, false),
        climb: stat(climbVals, false),
        avg: stat(avgVals, false),
        top: stat(topVals, false)
      },
      e2eByTrail: e2eByTrail
    };
  } catch (e) {
    return empty;
  }
}

function renderClubPace(club, myRides) {
  var box = document.getElementById('stats-club');
  if (!box) return;
  club = club || { riders: 0, avgSpeed: 0, topSpeed: 0, trails: [] };
  if (!club.riders && !club.trails.length) {
    box.innerHTML = '<p class="text-zinc-500 text-sm">No club ride data for this period yet. Other members’ saved rides show up here when the table allows members to read them.</p>';
    return;
  }
  var myAvg = 0, myW = 0, myTop = 0;
  (myRides || []).forEach(function (r) {
    if (r.avg_speed_kmh && r.distance_km) { myAvg += r.avg_speed_kmh * r.distance_km; myW += r.distance_km; }
    if ((r.max_speed_kmh || 0) > myTop) myTop = r.max_speed_kmh;
  });
  myAvg = myW ? myAvg / myW : 0;
  function line(label, you, clubVal) {
    var delta = (you && clubVal) ? (you - clubVal) : 0;
    var cmp = clubVal ? ((delta >= 0 ? '+' : '') + delta.toFixed(1) + ' vs club') : 'no club data';
    return '<div class="rounded-2xl bg-zinc-950 border border-zinc-800 p-4"><div class="text-[10px] uppercase tracking-wider text-zinc-500">' + label + '</div>' +
      '<div class="text-xl font-black text-zinc-100 mt-1">' + (you ? you.toFixed(1) : '—') + ' <span class="text-sm text-zinc-500">you</span></div>' +
      '<div class="text-xs text-zinc-400 mt-1">Club avg ' + (clubVal ? clubVal.toFixed(1) : '—') + ' · ' + cmp + '</div></div>';
  }
  var e2eClub = (club.trails || []).filter(function (t) { return t.bestE2E; }).slice().sort(function (a, b) { return a.bestE2E - b.bestE2E; });
  var trails = (e2eClub.length
    ? '<div class="font-semibold mb-2">Club end-to-end times</div>' + e2eClub.map(function (t) {
      return '<div class="rounded-2xl bg-zinc-950 border border-orange-900/50 px-4 py-3 mb-2"><div class="font-medium text-zinc-100">' + escapeHtml(t.name) + '</div>' +
        '<div class="text-sm text-orange-400 mt-0.5">' + formatRideClock(t.bestE2E) + ' club best · ' + t.e2e + ' finish' + (t.e2e === 1 ? '' : 'es') + '</div></div>';
    }).join('') + '<div class="font-semibold mb-2 mt-4">By trail</div>'
    : '') +
    (club.trails || []).map(function (t) {
    return '<div class="rounded-2xl bg-zinc-950 border border-zinc-800 px-4 py-3"><div class="font-medium text-zinc-100">' + escapeHtml(t.name) + '</div>' +
      '<div class="text-xs text-zinc-500 mt-1">' + t.n + ' run' + (t.n === 1 ? '' : 's') +
      (t.bestE2E ? ' · E2E ' + formatRideClock(t.bestE2E) : '') +
      ' · club avg ' + (t.avg ? t.avg.toFixed(1) : '—') + ' km/h · top ' + (t.top ? t.top.toFixed(1) : '—') + ' km/h</div></div>';
  }).join('');
  box.innerHTML =
    '<div class="text-xs text-zinc-500 mb-3">' + club.riders + ' rider' + (club.riders === 1 ? '' : 's') + ' with saved rides in this period.</div>' +
    '<div class="grid sm:grid-cols-2 gap-2 mb-4">' +
      line('Average speed', myAvg, club.avgSpeed) +
      line('Top speed', myTop, club.topSpeed) +
    '</div>' +
    '<div class="font-semibold mb-2">By trail</div>' +
    (trails || '<p class="text-zinc-500 text-sm">No trail splits in club rides yet.</p>');
}

window.openTrailGraph = openTrailGraph;
window.openPbChart = openPbChart;
window.closePbChart = closePbChart;
async function loadRideReviewQueue() {
  var box = document.getElementById('admin-review-list');
  if (!box || !window.sb) return;
  box.innerHTML = '<p class="text-zinc-500">Loading…</p>';
  try {
    var res = await window.sb
      .from('member_routes')
      .select('id, user_id, name, distance_km, avg_speed_kmh, max_speed_kmh, points, review_status, review_reason, created_at')
      .in('review_status', ['flagged', 'dq'])
      .order('created_at', { ascending: false })
      .limit(80);
    if (res.error) throw res.error;
    var rows = res.data || [];
    if (!rows.length) {
      box.innerHTML = '<p class="text-zinc-500">No flagged or DQ rides.</p>';
      return;
    }
    var names = await riderNames(rows.map(function (r) { return r.user_id; }));
    box.innerHTML = rows.map(function (r) {
      var st = r.review_status === 'dq' ? 'DQ' : 'Flagged';
      return '<div class="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">' +
        '<div class="font-medium text-zinc-100">' + escapeHtml(r.name || 'Ride') +
        ' <span class="text-xs ' + (r.review_status === 'dq' ? 'text-red-400' : 'text-amber-400') + '">' + st + '</span></div>' +
        '<div class="text-xs text-zinc-500 mt-1">' + escapeHtml(names[r.user_id] || 'Rider') +
        ' · ' + (r.distance_km || 0) + ' km · avg ' + (r.avg_speed_kmh || 0) +
        ' · top ' + (r.max_speed_kmh || 0) + '</div>' +
        (r.review_reason ? '<div class="text-xs text-orange-400 mt-1">' + escapeHtml(r.review_reason) + '</div>' : '') +
        '<div class="flex gap-2 mt-3">' +
        '<button type="button" class="px-3 py-1.5 rounded-xl border border-red-800 text-red-400 text-xs" onclick="setRideReview(\'' + r.id + '\',\'dq\')">DQ</button>' +
        '<button type="button" class="px-3 py-1.5 rounded-xl border border-emerald-700 text-emerald-400 text-xs" onclick="setRideReview(\'' + r.id + '\',\'ok\')">Clear</button>' +
        '</div></div>';
    }).join('');
  } catch (e) {
    box.innerHTML = '<p class="text-red-400">Run ride-fairness.sql in Supabase. ' + escapeHtml(e.message || '') + '</p>';
  }
}

async function setRideReview(id, status) {
  try {
    var patch = { review_status: status };
    if (status === 'dq') patch.points = 0;
    var res = await window.sb.from('member_routes').update(patch).eq('id', id);
    if (res.error) throw res.error;
    loadRideReviewQueue();
    if (typeof showToast === 'function') showToast(status === 'ok' ? 'Ride cleared' : 'Ride disqualified');
  } catch (e) {
    if (typeof showToast === 'function') showToast(e.message || 'Update failed', true);
  }
}

window.loadRideReviewQueue = loadRideReviewQueue;
window.setRideReview = setRideReview;
window.setStatsSection = setStatsSection;
window.loadRideStats = loadRideStats;
window.loadProfileRecentRides = loadProfileRecentRides;
window.openRideRouteModalById = openRideRouteModalById;
window.deleteSavedRide = deleteSavedRide;
window.openRideRouteModal = openRideRouteModal;
window.closeRideRouteModal = closeRideRouteModal;




async function loadAdminBadgeAward() {
  var sel = document.getElementById('admin-badge-member');
  var badge = document.getElementById('admin-badge-slug');
  if (!sel || !window.sb) return;
  sel.innerHTML = '<option value="">Loading…</option>';
  try {
    var pr = await window.sb.from('profiles').select('id, full_name').order('full_name');
    var people = pr.data || [];
    sel.innerHTML = '<option value="">Select member</option>' + people.map(function (p) {
      return '<option value="' + p.id + '">' + String(p.full_name || p.id).replace(/</g,'') + '</option>';
    }).join('');
    if (window.SBBadges) {
      var cats = await window.SBBadges.loadBadgeCatalog();
      var manuals = cats.filter(function (b) { return b.award_type === 'manual'; });
      if (badge) {
        badge.innerHTML = manuals.map(function (b) {
          return '<option value="' + b.slug + '">' + b.name + '</option>';
        }).join('') || '<option value="trail-day">Trail Day</option>';
      }
    }
  } catch (e) {
    sel.innerHTML = '<option value="">Could not load members</option>';
  }
}

async function submitAdminBadgeAward() {
  var userId = (document.getElementById('admin-badge-member') || {}).value;
  var slug = (document.getElementById('admin-badge-slug') || {}).value;
  if (!userId || !slug) {
    showToast('Pick a member and a badge', true);
    return;
  }
  try {
    await window.SBBadges.awardBadge(userId, slug);
    showToast('Badge awarded');
  } catch (e) {
    showToast(e.message || 'Award failed', true);
  }
}
window.loadAdminBadgeAward = loadAdminBadgeAward;
window.submitAdminBadgeAward = submitAdminBadgeAward;
