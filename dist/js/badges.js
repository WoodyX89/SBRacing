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

  async function evaluateMyBadges() {
    if (!window.sb) return null;
    try {
      var user = await getCurrentUser();
      if (!user) return null;
      var res = await window.sb.rpc('evaluate_member_badges', { p_user_id: user.id });
      if (res.error) {
        console.warn('[badges] evaluate', res.error);
        return null;
      }
      lastStats = res.data && res.data.stats;
      var awarded = (res.data && res.data.awarded) || [];
      if (awarded.length && typeof showToast === 'function') {
        var names = awarded.map(function (slug) {
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
        if (typeof showToast === 'function') showToast(msg);
      });
    });
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
