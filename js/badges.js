/* SB Racing — member badges */
(function () {
  var catalog = [];
  var earnedByUser = {};
  var lastStats = null;

  function badgeSrc(b) {
    if (!b) return 'assets/logo.png';
    return b.icon_path || ('assets/badges/' + b.slug + '.png');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function loadBadgeCatalog() {
    if (!window.sb) return [];
    if (catalog.length) return catalog;
    var res = await window.sb.from('badges').select('*').order('sort_order');
    if (res.error) throw res.error;
    catalog = res.data || [];
    return catalog;
  }

  async function loadMemberBadges(userId) {
    if (!window.sb || !userId) return [];
    var res = await window.sb
      .from('member_badges')
      .select('badge_slug, earned_at, source')
      .eq('user_id', userId);
    if (res.error) throw res.error;
    earnedByUser[userId] = res.data || [];
    return earnedByUser[userId];
  }


  async function awardBadgesFromSavedRides(userId, preloaded) {
    if (!window.sb || !userId) return [];
    var rides = preloaded;
    if (!rides) {
      var res = await window.sb.from('member_routes')
        .select('distance_km, started_at, created_at, trail_name, trail_splits, review_status')
        .eq('user_id', userId);
      if (res.error || !res.data) return [];
      rides = res.data.filter(function (r) { return r.review_status !== 'dq'; });
    }
    var km = 0;
    var longest = 0;
    var e2e = false;
    var night = false;
    rides.forEach(function (r) {
      var d = Number(r.distance_km) || 0;
      km += d;
      if (d > longest) longest = d;
      var when = new Date(r.started_at || r.created_at);
      var hr = when.getHours();
      if (!isNaN(hr) && (hr >= 20 || hr < 5)) night = true;
      (r.trail_splits || []).forEach(function (s) { if (s && s.end_to_end) e2e = true; });
      if (r.trail_name) e2e = e2e || false;
    });
    var want = [];
    if (rides.length >= 1) want.push('first-pedal');
    if (rides.length >= 5) want.push('regular');
    if (rides.length >= 15) want.push('fixture');
    if (longest >= 20) want.push('twenty-k');
    if (km >= 100) want.push('century-dirt');
    if (e2e) want.push('local-line');
    if (night) want.push('night-owl');
    var known = {};
    catalog.forEach(function (b) { if (b && b.slug) known[b.slug] = true; });
    var earned = {};
    (earnedByUser[userId] || []).forEach(function (row) { earned[row.badge_slug] = true; });
    var fresh = [];
    for (var i = 0; i < want.length; i++) {
      var slug = want[i];
      if (!known[slug] || earned[slug]) continue;
      try {
        var aw = await awardBadge(userId, slug);
        if (!aw || aw.ok !== false) fresh.push(slug);
      } catch (e) {
        console.warn('[badges] ride award', slug, e);
      }
    }
    return fresh;
  }

  async function evaluateMyBadges() {
    if (!window.sb) return null;
    try {
      var user = await getCurrentUser();
      if (!user) return null;
      await loadMemberBadges(user.id);
      var already = {};
      (earnedByUser[user.id] || []).forEach(function (row) { already[row.badge_slug] = true; });
      var awarded = [];
      try {
        var res = await window.sb.rpc('evaluate_member_badges', { p_user_id: user.id });
        if (res.error) console.warn('[badges] evaluate', res.error);
        else {
          lastStats = res.data && res.data.stats;
          awarded = (res.data && res.data.awarded) || [];
        }
      } catch (rpcErr) {
        console.warn('[badges] rpc', rpcErr);
      }
      var fromRides = await awardBadgesFromSavedRides(user.id);
      fromRides.forEach(function (slug) {
        if (awarded.indexOf(slug) < 0) awarded.push(slug);
      });
      var fresh = awarded.filter(function (slug) { return !already[slug]; });
      if (fresh.length && typeof showToast === 'function') {
        var names = fresh.map(function (slug) {
          var b = catalog.find(function (x) { return x.slug === slug; });
          return b ? b.name : slug;
        });
        showToast('Badge unlocked: ' + names.join(', '));
      }
      await loadMemberBadges(user.id);
      renderOwnBadges(user.id);
      return res.data;
    } catch (e) {
      console.warn('[badges]', e);
      return null;
    }
  }

  function renderBadgeGrid(container, userId, opts) {
    opts = opts || {};
    if (!container) return;
    var earned = earnedByUser[userId] || [];
    var earnedMap = {};
    earned.forEach(function (row) { earnedMap[row.badge_slug] = row; });
    var list = catalog.slice();
    if (!list.length) {
      container.innerHTML = '<p class="text-xs text-zinc-500">Run badges.sql in Supabase to enable badges.</p>';
      return;
    }
    container.innerHTML = list.map(function (b) {
      var got = earnedMap[b.slug];
      if (b.secret && !got && !opts.showLockedSecrets) return '';
      var src = badgeSrc(b);
      var date = got && got.earned_at
        ? new Date(got.earned_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '';
      return '<button type="button" class="sb-badge ' + (got ? 'is-earned' : 'is-locked') + '" data-slug="' + esc(b.slug) + '" title="' + esc(b.name) + '">' +
        '<img src="' + esc(src) + '" alt="' + esc(b.name) + '" class="sb-badge-img">' +
        '<span class="sb-badge-name">' + esc(b.name) + '</span>' +
        (got ? '<span class="sb-badge-date">' + esc(date) + '</span>' : '<span class="sb-badge-date">Locked</span>') +
        '</button>';
    }).join('');
    container.querySelectorAll('.sb-badge').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var slug = btn.getAttribute('data-slug');
        var b = catalog.find(function (x) { return x.slug === slug; });
        if (!b) return;
        var got = earnedMap[slug];
        var msg = b.name + ' — ' + (got ? b.description + (got.earned_at ? ' · ' + new Date(got.earned_at).toLocaleDateString() : '') : (b.secret ? 'Keep riding.' : b.description));
        showBadgeBanner(msg, container);
      });
    });
  }

  function showBadgeBanner(msg, fromEl) {
    var modal = document.getElementById('member-profile-modal');
    var inModal = modal && !modal.classList.contains('hidden') && modal.style.display !== 'none'
      && fromEl && modal.contains(fromEl);
    var banner = document.getElementById('member-profile-badge-banner');
    if (inModal && banner) {
      banner.textContent = msg;
      banner.classList.remove('hidden');
      banner.scrollIntoView({ block: 'nearest' });
      clearTimeout(showBadgeBanner._t);
      showBadgeBanner._t = setTimeout(function () { banner.classList.add('hidden'); }, 5000);
      return;
    }
    var toast = document.getElementById('success-toast');
    if (toast) toast.style.zIndex = '100001';
    if (typeof showToast === 'function') showToast(msg);
  }

  function renderOwnBadges(userId) {
    renderBadgeGrid(document.getElementById('my-badges-grid'), userId, { showLockedSecrets: false });
    var countEl = document.getElementById('my-badges-count');
    if (countEl) {
      var n = (earnedByUser[userId] || []).length;
      countEl.textContent = n ? n + ' earned' : '';
    }
  }

  async function renderProfileBadges(userId, mountEl) {
    if (!mountEl) return;
    try {
      await loadBadgeCatalog();
      await loadMemberBadges(userId);
      mountEl.innerHTML = '<div class="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Badges</div><div class="sb-badge-grid" id="profile-badges-grid"></div>';
      renderBadgeGrid(document.getElementById('profile-badges-grid'), userId);
    } catch (e) {
      mountEl.innerHTML = '';
    }
  }

  async function awardBadge(userId, slug) {
    var res = await window.sb.rpc('award_member_badge', { p_user_id: userId, p_slug: slug });
    if (res.error) throw res.error;
    if (res.data && res.data.ok === false) throw new Error(res.data.error || 'Could not award');
    return res.data;
  }


  async function backfillRideBadges() {
    if (!window.sb) return;
    var status = document.getElementById('admin-badge-backfill');
    if (status) status.textContent = 'Checking saved rides…';
    var res = await window.sb.from('member_routes')
      .select('user_id, distance_km, started_at, created_at, trail_splits, review_status')
      .limit(5000);
    if (res.error) {
      if (status) status.textContent = res.error.message || 'Could not read rides';
      return;
    }
    await loadBadgeCatalog();
    var byUser = {};
    (res.data || []).forEach(function (r) {
      if (!r.user_id || r.review_status === 'dq') return;
      if (!byUser[r.user_id]) byUser[r.user_id] = [];
      byUser[r.user_id].push(r);
    });
    var ids = Object.keys(byUser);
    var awarded = 0;
    for (var i = 0; i < ids.length; i++) {
      if (status) status.textContent = 'Updating ' + (i + 1) + ' / ' + ids.length;
      var got = await awardBadgesFromSavedRides(ids[i], byUser[ids[i]]);
      awarded += got.length;
    }
    if (status) status.textContent = 'Done. ' + awarded + ' new badge' + (awarded === 1 ? '' : 's') + ' across ' + ids.length + ' rider' + (ids.length === 1 ? '' : 's') + '.';
    if (typeof showToast === 'function') showToast('Ride badges updated');
  }
  window.backfillRideBadges = backfillRideBadges;

  window.SBBadges = {
    loadBadgeCatalog: loadBadgeCatalog,
    loadMemberBadges: loadMemberBadges,
    evaluateMyBadges: evaluateMyBadges,
    renderOwnBadges: renderOwnBadges,
    renderProfileBadges: renderProfileBadges,
    renderBadgeGrid: renderBadgeGrid,
    awardBadge: awardBadge,
    catalog: function () { return catalog; }
  };
  window.evaluateMyBadges = evaluateMyBadges;
})();
