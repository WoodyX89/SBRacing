// Live stats for index.html from Supabase
async function loadHomeStats() {
  if (!window.sb) {
    setTimeout(loadHomeStats, 150);
    return;
  }
  try {
    // Total members (all profiles)
    let totalMembers = 0;
    const totalRes = await window.sb
      .from('profiles')
      .select('id', { count: 'exact', head: true });
    if (!totalRes.error && typeof totalRes.count === 'number') {
      totalMembers = totalRes.count;
    } else {
      const all = await window.sb.from('profiles').select('id');
      if (!all.error && all.data) totalMembers = all.data.length;
    }
    setText('stat-active-members', String(totalMembers));
    setText('hero-active-count', String(totalMembers));

    // Group rides in current year
    const year = new Date().getFullYear();
    const ridesRes = await window.sb
      .from('events')
      .select('id', { count: 'exact', head: true })
      .gte('event_date', year + '-01-01')
      .lte('event_date', year + '-12-31');
    if (!ridesRes.error) setText('stat-group-rides', String(ridesRes.count || 0));

    // Trails logged + average rating (needs public read on rides — see stats_public.sql)
    const trailsRes = await window.sb.from('rides').select('trail_name, rating');
    if (!trailsRes.error && trailsRes.data) {
      const names = {};
      let sum = 0, n = 0;
      trailsRes.data.forEach(function (r) {
        if (r.trail_name) names[r.trail_name.toLowerCase()] = true;
        if (r.rating != null) { sum += Number(r.rating); n++; }
      });
      setText('stat-trails-logged', String(Object.keys(names).length));
      setText('stat-avg-rating', n ? (sum / n).toFixed(1) : '—');
    } else {
      // fallback: count events as activity signal
      setText('stat-trails-logged', '—');
      setText('stat-avg-rating', '—');
    }

    // Hero avatars: a few member photos
    const avatars = await window.sb
      .from('profiles')
      .select('avatar_url, full_name')
      .not('avatar_url', 'is', null)
      .limit(3);
    if (!avatars.error && avatars.data && avatars.data.length) {
      const row = document.querySelector('.flex.-space-x-2');
      if (row) {
        row.innerHTML = avatars.data.map(function (p) {
          return '<div class="w-8 h-8 rounded-full border-2 border-zinc-900 overflow-hidden ring-1 ring-white/30"><img src="' +
            String(p.avatar_url).replace(/"/g, '') + '" alt="" class="w-full h-full object-cover"></div>';
        }).join('');
      }
    }
  } catch (e) {
    console.warn('[home-stats]', e);
  }
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadHomeStats);
} else {
  loadHomeStats();
}
