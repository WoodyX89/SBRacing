// Live stats for index.html — works logged out via public_home_stats()
async function loadHomeStats() {
  if (!window.sb) {
    setTimeout(loadHomeStats, 150);
    return;
  }
  try {
    var rpc = await window.sb.rpc('public_home_stats');
    if (!rpc.error && rpc.data) {
      var row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
      if (row) {
        if (row.members != null) {
          setText('stat-active-members', String(row.members));
          setText('hero-active-count', String(row.members));
        }
        if (row.rides_year != null) setText('stat-rides-saved', String(row.rides_year));
        if (row.km_year != null) {
          var km = Number(row.km_year) || 0;
          setText('stat-club-km', km ? (km >= 100 ? String(Math.round(km)) : km.toFixed(1)) : '0');
        }
        if (row.events_year != null) setText('stat-events-year', String(row.events_year));
        loadHomeAvatars();
        return;
      }
    }

    var year = new Date().getFullYear();
    var yearStart = year + '-01-01';

    var totalMembers = 0;
    var totalRes = await window.sb.from('profiles').select('id', { count: 'exact', head: true });
    if (!totalRes.error && typeof totalRes.count === 'number') {
      totalMembers = totalRes.count;
    } else {
      var all = await window.sb.from('profiles').select('id');
      if (!all.error && all.data) totalMembers = all.data.length;
    }
    setText('stat-active-members', String(totalMembers));
    setText('hero-active-count', String(totalMembers));

    var eventsRes = await window.sb
      .from('events')
      .select('id', { count: 'exact', head: true })
      .gte('event_date', yearStart)
      .lte('event_date', year + '-12-31');
    if (!eventsRes.error) setText('stat-events-year', String(eventsRes.count || 0));

    var ridesRes = await window.sb
      .from('member_routes')
      .select('id, distance_km', { count: 'exact' })
      .gte('created_at', yearStart);
    if (ridesRes.error) {
      setText('stat-rides-saved', '—');
      setText('stat-club-km', '—');
    } else {
      setText('stat-rides-saved', String(ridesRes.count || (ridesRes.data || []).length));
      var km2 = 0;
      (ridesRes.data || []).forEach(function (r) { km2 += Number(r.distance_km) || 0; });
      setText('stat-club-km', km2 ? (km2 >= 100 ? Math.round(km2).toString() : km2.toFixed(1)) : '0');
    }

    loadHomeAvatars();
  } catch (e) {
    console.warn('[home-stats]', e);
  }
}

async function loadHomeAvatars() {
  try {
    var avatars = await window.sb
      .from('profiles')
      .select('avatar_url, full_name')
      .not('avatar_url', 'is', null)
      .limit(3);
    if (!avatars.error && avatars.data && avatars.data.length) {
      var row = document.querySelector('.flex.-space-x-2');
      if (row) {
        row.innerHTML = avatars.data.map(function (p) {
          return '<div class="w-8 h-8 rounded-full border-2 border-zinc-900 overflow-hidden ring-1 ring-white/30"><img src="' +
            String(p.avatar_url).replace(/"/g, '') + '" alt="" class="w-full h-full object-cover"></div>';
        }).join('');
      }
    }
  } catch (e) {}
}

function setText(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadHomeStats);
} else {
  loadHomeStats();
}
