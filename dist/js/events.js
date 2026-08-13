// Events — list + RSVP + admin add/edit/delete

let allEvents = [];
let isAdmin = false;
let isLeader = false;
/** Admin or Leader may manage events (merch stays admin-only). */
let canManageEvents = false;
let editingEventId = null;
let editingEventBaseline = null;
/** @type {Record<number, {likes: any[], comments: any[], liked: boolean}>} */
let eventSocial = {};
let eventsCurrentUserId = null;
let eventProfiles = {}; // user_id -> { full_name }
let eventRealtimeChannel = null;
/** @type {Record<number, object>} event_id -> my rsvp row */
let myRsvpByEvent = {};
/** @type {Record<number, number>} confirmed rsvp counts */
let rsvpCountByEvent = {};

function normalizeEventField(key, val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'boolean') return val ? 'yes' : 'no';
  var s = String(val).trim();
  if (key === 'event_date') {
    var m = s.match(/(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : s;
  }
  if (key === 'event_time') {
    var tm = s.match(/(\d{1,2}:\d{2})/);
    return tm ? tm[1] : s;
  }
  if (key === 'capacity') return String(parseInt(s, 10) || s);
  return s;
}


/** Event moment in local time: date + time (or noon if no time). */
function eventStartMs(ev) {
  if (!ev || !ev.event_date) return 0;
  var dateStr = normalizeEventField('event_date', ev.event_date);
  var timeStr = '12:00:00';
  if (ev.event_time) {
    var tm = String(ev.event_time);
    var m = tm.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      timeStr = (m[1].length === 1 ? '0' + m[1] : m[1]) + ':' + m[2] + ':' + (m[3] || '00');
    }
  }
  var d = new Date(dateStr + 'T' + timeStr);
  if (isNaN(d.getTime())) d = new Date(dateStr + 'T12:00:00');
  return d.getTime();
}

/** True once 24 hours have passed since event start. */
function isEventExpired(ev) {
  var start = eventStartMs(ev);
  if (!start) return false;
  return Date.now() > (start + 24 * 60 * 60 * 1000);
}

function summarizeEventChanges(before, after) {
  if (!before || !after) return '';
  var labels = {
    title: 'Title',
    description: 'Description',
    event_date: 'Date',
    event_time: 'Time',
    location: 'Location',
    difficulty: 'Difficulty',
    capacity: 'Capacity',
    category: 'Category',
    is_featured: 'Featured',
    is_members_only: 'Members only'
  };
  var parts = [];
  Object.keys(labels).forEach(function (key) {
    if (after[key] === undefined && before[key] === undefined) return;
    var a = normalizeEventField(key, before[key]);
    var b = normalizeEventField(key, after[key]);
    if (a === b) return;
    var label = labels[key];
    if (key === 'description') {
      parts.push(label + ' changed');
    } else if (!a) {
      parts.push(label + ': ' + b);
    } else if (!b) {
      parts.push(label + ' cleared');
    } else {
      parts.push(label + ': ' + a + ' → ' + b);
    }
  });
  return parts.join(' · ');
}



async function initEvents() {
  await checkAdmin();
  await loadEvents();
  showAdminChrome();
}

async function checkAdmin() {
  isAdmin = false;
  isLeader = false;
  canManageEvents = false;
  try {
    const user = await getCurrentUser();
    if (!user) return;
    const profile = await getProfile(user.id);
    isAdmin = !!(profile && profile.is_admin);
    isLeader = !!(profile && (profile.is_leader === true || profile.role === 'leader'));
    // Full admin always includes event management
    canManageEvents = isAdmin || isLeader;
  } catch (e) {
    console.warn('[events] admin check', e);
  }
}

function showAdminChrome() {
  const btn = document.getElementById('btn-add-event');
  const badge = document.getElementById('events-admin-badge');
  if (btn) btn.classList.toggle('hidden', !canManageEvents);
  if (badge) {
    badge.classList.toggle('hidden', !canManageEvents);
    if (canManageEvents) {
      badge.textContent = isAdmin ? 'ADMIN' : 'LEADER';
    }
  }
}

async function loadEvents() {
  const grid = document.getElementById('events-grid');
  if (!grid) return;

  grid.innerHTML = `
    <div class="col-span-full flex justify-center py-16 text-zinc-500">
      <i class="fa-solid fa-spinner fa-spin text-2xl"></i>
    </div>`;

  try {
    let data = null;

    const clientQuery = (async () => {
      let q = window.sb.from('events').select('*').order('event_date', { ascending: true });
      // Members: ~60 days history + upcoming (expired stay visible, stamped)
      if (!canManageEvents) {
        var from = new Date();
        from.setDate(from.getDate() - 60);
        q = q.gte('event_date', from.toISOString().split('T')[0]);
      }
      const res = await q.limit(50);
      if (res.error) throw res.error;
      return res.data || [];
    })();

    data = await Promise.race([
      clientQuery,
      new Promise((r) => setTimeout(() => r(null), 3000))
    ]);

    if (!data) {
      // fetch fallback
      const session = typeof getSessionFromStorage === 'function' ? getSessionFromStorage() : null;
      const token = (session && session.access_token) || window.SB_ANON_KEY;
      let url = window.SB_URL + '/rest/v1/events?select=*&order=event_date.asc&limit=50';
      if (!canManageEvents) {
        var from2 = new Date();
        from2.setDate(from2.getDate() - 60);
        url += '&event_date=gte.' + from2.toISOString().split('T')[0];
      }
      const res = await fetch(url, {
        headers: {
          apikey: window.SB_ANON_KEY,
          Authorization: 'Bearer ' + token,
          Accept: 'application/json'
        }
      });
      if (!res.ok) throw new Error('events fetch ' + res.status);
      data = await res.json();
    }

    allEvents = data || [];
    // Completed (24h past start) stay visible; sort to bottom
    allEvents = allEvents.slice().sort(function (a, b) {
      var ax = isEventExpired(a) ? 1 : 0;
      var bx = isEventExpired(b) ? 1 : 0;
      if (ax !== bx) return ax - bx;
      return String(a.event_date || '').localeCompare(String(b.event_date || ''));
    });
    await loadEventSocial();
    await loadMyRsvps();
    renderEvents();
    subscribeEventLikesRealtime();
    try {
      if (typeof scheduleEventReminders === 'function') {
        await scheduleEventReminders(allEvents, myRsvpByEvent);
      }
    } catch (rerr) {
      console.warn('[events] reminders', rerr);
    }
    console.log('[events] loaded', allEvents.length, 'admin=', isAdmin, 'leader=', isLeader, 'manage=', canManageEvents);
  } catch (err) {
    console.error(err);
    grid.innerHTML = `
      <div class="col-span-full text-center py-12 text-zinc-500">
        <p>Could not load events.</p>
        <p class="text-sm mt-2">${escapeHtml(err.message || '')}</p>
      </div>`;
  }
}

function renderEvents() {
  const grid = document.getElementById('events-grid');
  if (!grid) return;

  if (!allEvents.length) {
    grid.innerHTML = `
      <div class="col-span-full text-center py-12 text-zinc-500">
        <p>No events yet.</p>
        ${canManageEvents ? '<p class="text-sm mt-2 text-orange-500">Click Add Event to create one.</p>' : ''}
      </div>`;
    return;
  }

  grid.innerHTML = allEvents.map((ev) => {
    var taken = rsvpCountByEvent[ev.id] != null ? rsvpCountByEvent[ev.id] : (ev.spots_taken || 0);
    const spotsLeft = Math.max(0, (ev.capacity || 40) - taken);
    var myRsvp = myRsvpByEvent[ev.id];
    var expired = isEventExpired(ev);
    var rsvpBtnHtml;
    if (expired) {
      rsvpBtnHtml =
        '<button type="button" disabled class="w-full py-3 rounded-2xl border border-zinc-800 text-zinc-600 font-semibold text-sm cursor-not-allowed">' +
        '<i class="fa-solid fa-flag-checkered mr-1"></i> Completed</button>';
      if (canManageEvents) {
        rsvpBtnHtml +=
          '<button type="button" onclick="openRsvpList(' + ev.id + ')" class="mt-2 w-full py-2 rounded-2xl border border-zinc-700 text-xs text-zinc-400 hover:text-white">' +
          '<i class="fa-solid fa-users mr-1"></i> View RSVPs (' + taken + ')</button>';
      }
    } else if (myRsvp && myRsvp.status !== 'cancelled') {
      rsvpBtnHtml =
        '<div class="space-y-2">' +
        '<button type="button" class="w-full py-3 rounded-2xl bg-emerald-900/50 border border-emerald-700 text-emerald-400 font-semibold text-sm cursor-default">' +
        '<i class="fa-solid fa-check mr-1"></i> You\'re going' +
        (myRsvp.status === 'waitlist' ? ' (waitlist)' : '') +
        '</button>' +
        '<button type="button" onclick="cancelRsvp(' + ev.id + ')" class="w-full py-2 rounded-2xl border border-zinc-700 text-zinc-400 hover:text-white text-xs">Cancel RSVP</button>' +
        '</div>';
    } else if (spotsLeft <= 0) {
      rsvpBtnHtml =
        '<button type="button" onclick="openRsvp(' + ev.id + ')" class="w-full py-3 rounded-2xl border border-amber-700 text-amber-400 font-semibold text-sm hover:bg-amber-950/30">' +
        'Join waitlist</button>';
    } else {
      rsvpBtnHtml =
        '<button type="button" onclick="openRsvp(' + ev.id + ')" class="w-full py-3 rounded-2xl bg-white text-zinc-900 font-semibold text-sm hover:bg-amber-50 active:scale-[0.98] transition-all">' +
        'RSVP · ' + spotsLeft + ' left</button>';
    }
    if (canManageEvents) {
      rsvpBtnHtml +=
        '<button type="button" onclick="openRsvpList(' + ev.id + ')" class="mt-2 w-full py-2 rounded-2xl border border-zinc-700 text-xs text-zinc-400 hover:text-white">' +
        '<i class="fa-solid fa-users mr-1"></i> View RSVPs (' + taken + ')</button>';
    }

    const dateObj = new Date(ev.event_date + 'T12:00:00');
    const dateLabel = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
    const timeLabel = ev.event_time ? String(ev.event_time).slice(0, 5) : '';
    const diffClass = {
      easy: 'bg-emerald-900/60 text-emerald-400',
      intermediate: 'bg-amber-900/60 text-amber-400',
      advanced: 'bg-orange-900/60 text-orange-400',
      all_levels: 'bg-sky-900/60 text-sky-400'
    }[ev.difficulty] || 'bg-zinc-800 text-zinc-400';
    var badgeColor = expired ? 'text-zinc-500' : (ev.is_featured ? 'text-orange-400' : (ev.category === 'clinic' ? 'text-sky-400' : 'text-emerald-400'));
    var badgeText = expired ? 'COMPLETED' : (ev.is_featured ? 'FEATURED' : (ev.category === 'clinic' ? 'CLINIC' : (ev.category === 'social' ? 'SOCIAL' : 'RIDE')));

    const pokerBtn = (canManageEvents && ev.category === 'poker_run') ? `
        <a href="poker.html?e=${ev.id}" class="text-xs px-3 py-1.5 rounded-xl border border-orange-700 text-orange-400 hover:bg-orange-950/40">
          <i class="fa-solid fa-spade mr-1"></i>Poker run
        </a>
        <button type="button" onclick="showPokerAdminFor(${ev.id})" class="text-xs px-3 py-1.5 rounded-xl border border-zinc-600 hover:bg-zinc-800">
          Checkpoints
        </button>` : (ev.category === 'poker_run' ? `
        <a href="poker.html?e=${ev.id}" class="text-xs px-3 py-1.5 rounded-xl border border-orange-700 text-orange-400">Leaderboard</a>` : '');
    const adminBtns = canManageEvents ? `
      <div class="flex gap-2 mt-3">
        <button type="button" onclick="openEventModal(${ev.id})" class="text-xs px-3 py-1.5 rounded-xl border border-zinc-600 hover:bg-zinc-800">
          <i class="fa-solid fa-pen mr-1"></i>Edit
        </button>
      </div>` : '';

    // Website (http/https) always gets corner X for admins. Native (capacitor) gets swipe only.
    var isNative = (location.protocol === 'capacitor:' || location.protocol === 'ionic:');
    var showCornerX = canManageEvents && !isNative;

    const webDeleteX = showCornerX
      ? ('<button type="button" onclick="deleteEvent(' + ev.id + ')" title="Delete event" ' +
         'class="absolute top-3 right-3 z-20 w-7 h-7 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shadow-lg border border-red-400">' +
         '<i class="fa-solid fa-xmark text-xs"></i></button>')
      : '';

    const cardOpacity = ''; // keep solid so swipe-delete panel doesn't show through
    const completedStamp = expired
      ? ('<div class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden rounded-3xl">' +
         '<span style="transform:rotate(-18deg) scale(1.15);letter-spacing:0.35em;" ' +
         'class="px-10 py-4 border-4 border-zinc-400 bg-zinc-950 text-zinc-300 text-2xl sm:text-3xl font-black uppercase shadow-2xl whitespace-nowrap">COMPLETED</span>' +
         '</div>')
      : '';
    const cardBody = `
        ${webDeleteX}
        ${completedStamp}
        <div class="flex justify-between items-start gap-3 ${showCornerX ? 'pr-10' : ''}">
          <div class="min-w-0">
            <div class="text-xs font-mono tracking-widest ${badgeColor}">${badgeText}</div>
            <div class="font-bold text-xl mt-1">${escapeHtml(ev.title)}</div>
            ${ev.location ? `<div class="text-xs text-zinc-500 mt-1"><i class="fa-solid fa-location-dot mr-1"></i>${escapeHtml(ev.location)}</div>` : ''}
          </div>
          <div class="text-right shrink-0 ${showCornerX ? 'mr-2' : ''}">
            <div class="text-xs text-zinc-400">${dateLabel}</div>
            <div class="font-mono text-sm">${escapeHtml(timeLabel)}</div>
          </div>
        </div>
        ${ev.description ? `<p class="text-sm text-zinc-400 mt-3 line-clamp-3">${escapeHtml(ev.description)}</p>` : ''}
        <div class="mt-auto pt-6">
          <div class="flex items-center gap-x-2 text-xs mb-4 flex-wrap gap-y-1">
            <span class="px-2 py-1 rounded-lg ${diffClass}">${escapeHtml((ev.difficulty || 'all_levels').replace('_', ' '))}</span>
            <span class="text-zinc-500">${spotsLeft} spots left</span>
            ${ev.is_members_only ? '<span class="text-orange-500">Members only</span>' : ''}
          </div>
          ${rsvpBtnHtml}
          ${pokerBtn ? `<div class="flex flex-wrap gap-2 mt-3">${pokerBtn}</div>` : ''}
          ${adminBtns}
          ${renderEventSocial(ev.id)}
        </div>`;

    if (!canManageEvents) {
      return `<div data-event-id="${ev.id}" class="trail-card relative bg-zinc-900 border border-zinc-800 rounded-3xl p-6 flex flex-col ${cardOpacity}">${cardBody}</div>`;
    }

    // Native admin: swipe-left to delete
    if (isNative) {
      return `
      <div class="relative overflow-hidden rounded-3xl" data-swipe-event="${ev.id}" data-event-id="${ev.id}">
        <div class="absolute inset-y-0 right-0 w-24 flex items-stretch">
          <button type="button" onclick="deleteEvent(${ev.id})" class="flex-1 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex flex-col items-center justify-center gap-1">
            <i class="fa-solid fa-trash text-base"></i>Delete
          </button>
        </div>
        <div class="trail-card relative bg-zinc-900 border border-zinc-800 rounded-3xl p-6 flex flex-col touch-pan-y transition-transform duration-200 will-change-transform ${cardOpacity}" data-swipe-content>
          ${cardBody}
        </div>
      </div>`;
    }

    // Website admin: X in corner only (no swipe)
    return `<div data-event-id="${ev.id}" class="trail-card relative bg-zinc-900 border border-zinc-800 rounded-3xl p-6 flex flex-col ${cardOpacity}">${cardBody}</div>`;
  }).join('');

  // Swipe only in the Capacitor app
  if (location.protocol === 'capacitor:' || location.protocol === 'ionic:') {
    initEventSwipeToDelete(grid);
  }
}

/** Swipe-left to reveal Delete on event cards (admin only) */
function initEventSwipeToDelete(container) {
  if (!container) return;
  var openEl = null;
  var startX = 0;
  var startY = 0;
  var currentX = 0;
  var tracking = false;
  var horizontal = null;
  var content = null;
  var maxSwipe = -96;

  function closeOpen() {
    if (openEl) {
      openEl.style.transform = 'translateX(0)';
      openEl = null;
    }
  }

  container.querySelectorAll('[data-swipe-event]').forEach(function (wrap) {
    var article = wrap.querySelector('[data-swipe-content]');
    if (!article) return;

    article.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      if (openEl && openEl !== article) closeOpen();
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      currentX = 0;
      tracking = true;
      horizontal = null;
      content = article;
      article.style.transition = 'none';
    }, { passive: true });

    article.addEventListener('touchmove', function (e) {
      if (!tracking || !content) return;
      var dx = e.touches[0].clientX - startX;
      var dy = e.touches[0].clientY - startY;
      if (horizontal === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        horizontal = Math.abs(dx) > Math.abs(dy);
        if (!horizontal) { tracking = false; return; }
      }
      if (!horizontal) return;
      currentX = Math.min(0, Math.max(maxSwipe, dx));
      content.style.transform = 'translateX(' + currentX + 'px)';
    }, { passive: true });

    article.addEventListener('touchend', function () {
      if (!tracking || !content) return;
      tracking = false;
      content.style.transition = 'transform 0.2s ease';
      if (currentX < maxSwipe / 2) {
        content.style.transform = 'translateX(' + maxSwipe + 'px)';
        openEl = content;
      } else {
        content.style.transform = 'translateX(0)';
        if (openEl === content) openEl = null;
      }
      content = null;
    });

    article.addEventListener('click', function (e) {
      if (openEl === article && currentX < -10) {
        e.preventDefault();
        e.stopPropagation();
        closeOpen();
      }
    });
  });
}

function eventDisplayName(userId) {
  var p = eventProfiles[userId];
  return (p && p.full_name) ? p.full_name : 'Member';
}

function eventLikesLabel(likes) {
  likes = likes || [];
  if (!likes.length) return '';
  var names = likes.map(function (l) { return eventDisplayName(l.user_id); });
  var seen = {};
  names = names.filter(function (n) {
    if (seen[n]) return false;
    seen[n] = true;
    return true;
  });
  if (names.length === 1) return names[0] + ' liked this';
  if (names.length === 2) return names[0] + ' and ' + names[1] + ' liked this';
  if (names.length === 3) return names[0] + ', ' + names[1] + ' and ' + names[2] + ' liked this';
  return names[0] + ', ' + names[1] + ' and ' + (names.length - 2) + ' others liked this';
}

function updateEventLikeUi(eventId) {
  eventId = Number(eventId);
  var s = eventSocial[eventId] || { likes: [], comments: [], liked: false };
  var likes = s.likes || [];
  s.liked = !!(eventsCurrentUserId && likes.some(function (l) { return String(l.user_id) === String(eventsCurrentUserId); }));
  eventSocial[eventId] = s;
  var root = document.querySelector('[data-event-id="' + eventId + '"]');
  if (!root) return;
  var btn = root.querySelector('[data-like-btn]');
  if (btn) {
    btn.className = s.liked
      ? 'text-orange-500 inline-flex items-center gap-1'
      : 'text-zinc-400 hover:text-orange-400 inline-flex items-center gap-1';
    btn.innerHTML =
      '<i class="fa-' + (s.liked ? 'solid' : 'regular') + ' fa-heart"></i>' +
      '<span data-like-count>' + likes.length + '</span>';
  }
  var namesEl = root.querySelector('[data-like-names]');
  if (namesEl) {
    namesEl.textContent = eventLikesLabel(likes);
    namesEl.classList.toggle('hidden', !likes.length);
  }
}

function renderEventSocial(eventId) {
  var s = eventSocial[eventId] || { likes: [], comments: [], liked: false };
  var likeCount = (s.likes && s.likes.length) || 0;
  var comments = s.comments || [];
  var commentsHtml = comments.map(function (c) {
    var canDelete = (eventsCurrentUserId && c.user_id === eventsCurrentUserId) || canManageEvents;
    return '<div class="text-xs text-zinc-400 border-t border-zinc-800 py-1.5 flex items-start gap-2">' +
      '<div class="min-w-0 flex-1">' +
      '<span class="text-zinc-300 font-medium">' + escapeHtml(c._name || 'Member') + '</span> ' +
      escapeHtml(c.body) +
      '</div>' +
      (canDelete
        ? '<button type="button" onclick="deleteEventComment(' + c.id + ')" class="shrink-0 w-5 h-5 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center" title="Delete comment"><i class="fa-solid fa-xmark text-[10px]"></i></button>'
        : '') +
      '</div>';
  }).join('');
  var names = eventLikesLabel(s.likes || []);
  return (
    '<div class="mt-4 pt-3 border-t border-zinc-800" data-event-social="' + eventId + '">' +
    '<div class="flex items-center gap-3 text-sm">' +
    '<button type="button" data-like-btn onclick="toggleEventLike(' + eventId + ')" class="' +
    (s.liked ? 'text-orange-500' : 'text-zinc-400 hover:text-orange-400') + ' inline-flex items-center gap-1">' +
    '<i class="fa-' + (s.liked ? 'solid' : 'regular') + ' fa-heart"></i>' +
    '<span data-like-count>' + likeCount + '</span>' +
    '</button>' +
    '<button type="button" onclick="toggleEventComments(' + eventId + ')" class="text-zinc-400 hover:text-white text-sm">' +
    '<i class="fa-regular fa-comment mr-1"></i>' + comments.length +
    '</button>' +
    '</div>' +
    '<div data-like-names class="text-xs text-zinc-500 mt-1.5 ' + (names ? '' : 'hidden') + '">' +
    escapeHtml(names) +
    '</div>' +
    '<div id="event-comments-' + eventId + '" class="hidden mt-2 space-y-1">' +
    commentsHtml +
    '<div class="flex gap-2 mt-2">' +
    '<input id="event-comment-input-' + eventId + '" type="text" placeholder="Comment…" ' +
    'class="flex-1 bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-1.5 text-xs outline-none focus:border-orange-600" ' +
    "onkeydown=\"if(event.key==='Enter'){event.preventDefault();submitEventComment(" + eventId + ')}\">' +
    '<button type="button" onclick="submitEventComment(' + eventId + ')" class="text-xs px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700">Send</button>' +
    '</div></div></div>'
  );
}

function toggleEventComments(eventId) {
  var el = document.getElementById('event-comments-' + eventId);
  if (el) el.classList.toggle('hidden');
}

async function loadEventSocial() {
  eventSocial = {};
  if (!allEvents.length || !window.sb) return;
  var ids = allEvents.map(function (e) { return e.id; });
  try {
    var user = null;
    try { user = await getCurrentUser(); } catch (e) {}
    eventsCurrentUserId = user ? user.id : null;

    var [likesRes, commentsRes] = await Promise.all([
      window.sb.from('event_likes').select('*').in('event_id', ids),
      window.sb.from('event_comments').select('*').in('event_id', ids).order('created_at', { ascending: true })
    ]);
    // Tables may not exist yet
    if (likesRes.error && String(likesRes.error.message || '').indexOf('event_likes') >= 0) return;
    if (commentsRes.error && String(commentsRes.error.message || '').indexOf('event_comments') >= 0) return;

    var likes = likesRes.data || [];
    var comments = commentsRes.data || [];
    var userIds = [];
    comments.forEach(function (c) { if (c.user_id) userIds.push(c.user_id); });
    likes.forEach(function (l) { if (l.user_id) userIds.push(l.user_id); });
    var nameMap = {};
    if (userIds.length) {
      var pr = await window.sb.from('profiles').select('id, full_name').in('id', userIds);
      if (pr.data) {
        pr.data.forEach(function (p) {
          nameMap[p.id] = p.full_name || 'Member';
          eventProfiles[p.id] = { full_name: p.full_name || 'Member' };
        });
      }
    }
    comments.forEach(function (c) { c._name = nameMap[c.user_id] || 'Member'; });

    allEvents.forEach(function (ev) {
      var elikes = likes.filter(function (l) { return l.event_id === ev.id; });
      var ecomments = comments.filter(function (c) { return c.event_id === ev.id; });
      eventSocial[ev.id] = {
        likes: elikes,
        comments: ecomments,
        liked: !!(eventsCurrentUserId && elikes.some(function (l) { return l.user_id === eventsCurrentUserId; }))
      };
    });
  } catch (e) {
    console.warn('[events] social', e);
  }
}

async function refreshEventLikes(eventId) {
  eventId = Number(eventId);
  try {
    var res = await window.sb.from('event_likes').select('*').eq('event_id', eventId);
    if (res.error) throw res.error;
    var likes = res.data || [];
    var uids = likes.map(function (l) { return l.user_id; }).filter(Boolean);
    if (uids.length) {
      var pr = await window.sb.from('profiles').select('id, full_name').in('id', uids);
      if (pr.data) {
        pr.data.forEach(function (p) {
          eventProfiles[p.id] = { full_name: p.full_name || 'Member' };
        });
      }
    }
    if (!eventSocial[eventId]) eventSocial[eventId] = { likes: [], comments: [], liked: false };
    eventSocial[eventId].likes = likes;
    eventSocial[eventId].liked = !!(eventsCurrentUserId && likes.some(function (l) {
      return String(l.user_id) === String(eventsCurrentUserId);
    }));
    updateEventLikeUi(eventId);
  } catch (e) {
    console.warn('[events] refresh likes', e);
  }
}

function subscribeEventLikesRealtime() {
  if (!window.sb || eventRealtimeChannel) return;
  try {
    eventRealtimeChannel = window.sb
      .channel('event-likes-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_likes' }, function (payload) {
        var row = payload.new || payload.old;
        if (!row || row.event_id == null) return;
        var eventId = Number(row.event_id);
        if (!document.querySelector('[data-event-id="' + eventId + '"]')) return;
        clearTimeout(subscribeEventLikesRealtime['_t' + eventId]);
        subscribeEventLikesRealtime['_t' + eventId] = setTimeout(function () {
          refreshEventLikes(eventId);
        }, 80);
      })
      .subscribe(function (status) {
        console.log('[events] realtime', status);
      });
  } catch (e) {
    console.warn('[events] realtime setup failed', e);
  }
}

async function toggleEventLike(eventId) {
  var user = null;
  try { user = await getCurrentUser(); } catch (e) {}
  if (!user) {
    showToast('Log in to like events', true);
    return;
  }
  eventId = Number(eventId);
  eventsCurrentUserId = user.id;
  if (!eventSocial[eventId]) eventSocial[eventId] = { likes: [], comments: [], liked: false };
  var likes = eventSocial[eventId].likes || [];
  var mine = likes.find(function (l) { return String(l.user_id) === String(user.id); });

  // Optimistic
  if (mine) {
    eventSocial[eventId].likes = likes.filter(function (l) { return String(l.user_id) !== String(user.id); });
  } else {
    eventSocial[eventId].likes = likes.concat([{ event_id: eventId, user_id: user.id }]);
    if (!eventProfiles[user.id]) {
      eventProfiles[user.id] = { full_name: 'You' };
      try {
        var pr = await window.sb.from('profiles').select('id, full_name').eq('id', user.id).maybeSingle();
        if (pr.data) eventProfiles[user.id] = { full_name: pr.data.full_name || 'Member' };
      } catch (e0) {}
    }
  }
  eventSocial[eventId].liked = !mine;
  updateEventLikeUi(eventId);
  try { if (typeof hapticSelection === 'function') hapticSelection(); } catch (eH) {}

  try {
    if (mine) {
      var del = await window.sb.from('event_likes').delete()
        .eq('event_id', eventId)
        .eq('user_id', user.id);
      if (del.error) throw del.error;
    } else {
      var ins = await window.sb.from('event_likes').insert({ event_id: eventId, user_id: user.id }).select('*').maybeSingle();
      if (ins.error) throw ins.error;
      if (ins.data) {
        eventSocial[eventId].likes = (eventSocial[eventId].likes || []).filter(function (l) {
          return String(l.user_id) !== String(user.id);
        }).concat([ins.data]);
        updateEventLikeUi(eventId);
      }
    }
  } catch (e) {
    eventSocial[eventId].likes = likes;
    eventSocial[eventId].liked = !!mine;
    updateEventLikeUi(eventId);
    showToast(e.message || 'Like failed — run forum.sql?', true);
  }
}

async function submitEventComment(eventId) {
  var user = null;
  try { user = await getCurrentUser(); } catch (e) {}
  if (!user) {
    showToast('Log in to comment', true);
    return;
  }
  var input = document.getElementById('event-comment-input-' + eventId);
  var body = input ? (input.value || '').trim() : '';
  if (!body) return;
  try {
    var res = await window.sb.from('event_comments').insert({
      event_id: eventId,
      user_id: user.id,
      body: body
    });
    if (res.error) throw res.error;
    if (input) input.value = '';
    try {
      var ev = allEvents.find(function (e) { return e.id === eventId; });
      var evTitle = (ev && ev.title) ? ev.title : 'Event';
      if (typeof notifyActivityAll === 'function') {
        await notifyActivityAll({
          title: 'Event comment',
          body: evTitle + ' — ' + body.slice(0, 100),
          url: 'events.html',
          type: 'event_comment'
        });
      }
    } catch (nerr) {
      console.warn(nerr);
    }
    await loadEventSocial();
    renderEvents();
    var panel = document.getElementById('event-comments-' + eventId);
    if (panel) panel.classList.remove('hidden');
  } catch (e) {
    showToast(e.message || 'Comment failed — run forum.sql?', true);
  }
}

async function deleteEventComment(commentId) {
  if (!confirm('Delete this comment?')) return;
  try {
    var res = await window.sb.from('event_comments').delete().eq('id', commentId);
    if (res.error) throw res.error;
    showToast('Comment deleted');
    await loadEventSocial();
    renderEvents();
  } catch (e) {
    showToast(e.message || 'Delete failed', true);
  }
}

function openEventModal(id) {
  if (!canManageEvents) {
    showToast('Leaders and admins can manage events', true);
    return;
  }
  editingEventId = (id !== undefined && id !== null && id !== '') ? id : null;
  const modal = document.getElementById('event-modal');
  const title = document.getElementById('event-modal-title');
  if (!modal) return;

  title.textContent = id ? 'Edit Event' : 'Add Event';
  editingEventBaseline = null;

  const ev = id ? allEvents.find((e) => String(e.id) === String(id)) : null;
  document.getElementById('ev-title').value = ev ? ev.title : '';
  document.getElementById('ev-description').value = ev ? (ev.description || '') : '';
  document.getElementById('ev-date').value = ev && ev.event_date ? normalizeEventField('event_date', ev.event_date) : '';
  document.getElementById('ev-time').value = ev && ev.event_time ? String(ev.event_time).slice(0, 5) : '';
  document.getElementById('ev-location').value = ev ? (ev.location || '') : '';
  document.getElementById('ev-difficulty').value = ev ? (ev.difficulty || 'all_levels') : 'all_levels';
  document.getElementById('ev-capacity').value = ev ? (ev.capacity || 40) : 40;
  document.getElementById('ev-category').value = ev ? (ev.category || 'ride') : 'ride';
  document.getElementById('ev-featured').checked = !!(ev && ev.is_featured);
  document.getElementById('ev-members-only').checked = !!(ev && ev.is_members_only);

  if (ev) {
    editingEventBaseline = {
      title: ev.title || '',
      description: ev.description || null,
      event_date: normalizeEventField('event_date', ev.event_date),
      event_time: normalizeEventField('event_time', ev.event_time) || null,
      location: ev.location || null,
      difficulty: ev.difficulty || '',
      capacity: ev.capacity != null ? parseInt(ev.capacity, 10) : 40,
      category: ev.category || '',
      is_featured: !!ev.is_featured,
      is_members_only: !!ev.is_members_only
    };
  } else {
    editingEventBaseline = null;
  }
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeEventModal() {
  const modal = document.getElementById('event-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  editingEventId = null;
  editingEventBaseline = null;
}

async function saveEvent(e) {
  e.preventDefault();
  if (!canManageEvents) {
    showToast('Leaders and admins can manage events', true);
    return;
  }

  const payload = {
    title: document.getElementById('ev-title').value.trim(),
    description: document.getElementById('ev-description').value.trim() || null,
    event_date: document.getElementById('ev-date').value,
    event_time: document.getElementById('ev-time').value || null,
    location: document.getElementById('ev-location').value.trim() || null,
    difficulty: document.getElementById('ev-difficulty').value,
    capacity: parseInt(document.getElementById('ev-capacity').value, 10) || 40,
    category: document.getElementById('ev-category').value,
    is_featured: document.getElementById('ev-featured').checked,
    is_members_only: document.getElementById('ev-members-only').checked
  };

  if (!payload.title || !payload.event_date) {
    showToast('Title and date are required', true);
    return;
  }

  const btn = e.target.querySelector('button[type="submit"]');
  const original = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  }

  try {
    let error;
    if (editingEventId) {
      ({ error } = await window.sb.from('events').update(payload).eq('id', editingEventId));
    } else {
      ({ error } = await window.sb.from('events').insert(payload));
    }
    if (error) throw error;

    showToast(editingEventId ? 'Event updated' : 'Event added');
    // Local + remote notify on both create and edit (include what changed)
    try {
      var isEdit = !!editingEventId;
      var changeSummary = '';
      if (isEdit) {
        var prev = editingEventBaseline;
        if (!prev) {
          prev = allEvents.find(function (ev) {
            return String(ev.id) === String(editingEventId);
          });
        }
        changeSummary = summarizeEventChanges(prev, payload);
        console.log('[events] edit diff:', changeSummary || '(none)', prev, payload);
      }
      var notifyOpts = { isEdit: isEdit, changeSummary: changeSummary };
      if (typeof notifyEventAdded === 'function') {
        await notifyEventAdded(payload, notifyOpts);
      }
      if (typeof sendEventPushToAll === 'function') {
        await sendEventPushToAll(payload, notifyOpts);
      }
    } catch (nerr) {
      console.warn(nerr);
    }
    closeEventModal();
    await loadEvents();
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Save failed (check admin RLS)', true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }
}

async function deleteEvent(id) {
  if (!canManageEvents) return;
  if (!confirm('Delete this event?')) return;
  const prev = allEvents.find(function (ev) { return String(ev.id) === String(id); }) || null;
  const deletedTitle = (prev && (prev.title || prev.name)) || 'Event';
  const deletedDate = prev && prev.event_date ? normalizeEventField('event_date', prev.event_date) : '';
  try {
    const { error } = await window.sb.from('events').delete().eq('id', id);
    if (error) throw error;
    showToast('Event deleted');
    console.log('[events] deleted', id, deletedTitle);
    try {
      if (typeof notifyEventDeleted === 'function') {
        await notifyEventDeleted({
          id: id,
          title: deletedTitle,
          name: deletedTitle,
          event_date: deletedDate
        });
      } else {
        console.warn('[events] notifyEventDeleted missing');
      }
      if (typeof sendEventPushToAll === 'function') {
        await sendEventPushToAll(
          { title: deletedTitle, event_date: deletedDate },
          { isDelete: true }
        );
      }
    } catch (nerr) {
      console.warn('[events] delete notify failed', nerr);
    }
    await loadEvents();
  } catch (err) {
    showToast(err.message || 'Delete failed', true);
  }
}

async function loadMyRsvps() {
  myRsvpByEvent = {};
  rsvpCountByEvent = {};
  if (!window.sb || !allEvents.length) return;
  var ids = allEvents.map(function (e) { return e.id; });
  // Prefer events.spots_taken (synced by DB trigger). Leaders can refine via list modal.
  allEvents.forEach(function (ev) {
    rsvpCountByEvent[ev.id] = Number(ev.spots_taken) || 0;
  });
  // Leaders/admins: get accurate counts from rsvps if permitted
  if (canManageEvents) {
    try {
      var countRes = await window.sb
        .from('rsvps')
        .select('event_id, status')
        .in('event_id', ids)
        .eq('status', 'confirmed');
      if (!countRes.error && countRes.data) {
        var tally = {};
        countRes.data.forEach(function (r) {
          tally[r.event_id] = (tally[r.event_id] || 0) + 1;
        });
        Object.keys(tally).forEach(function (id) {
          rsvpCountByEvent[id] = tally[id];
        });
      }
    } catch (e) {
      console.warn('[rsvp] counts', e);
    }
  }

  var user = null;
  try { user = await getCurrentUser(); } catch (e) {}
  if (!user) return;
  try {
    var mine = await window.sb
      .from('rsvps')
      .select('*')
      .eq('user_id', user.id)
      .in('event_id', ids)
      .neq('status', 'cancelled');
    if (mine.error) throw mine.error;
    (mine.data || []).forEach(function (r) {
      myRsvpByEvent[r.event_id] = r;
    });
  } catch (e) {
    // Fallback: by email from profile
    try {
      var pr = await getProfile(user.id);
      var email = (pr && pr.email) || user.email;
      if (email) {
        var byEmail = await window.sb
          .from('rsvps')
          .select('*')
          .eq('email', email)
          .in('event_id', ids)
          .neq('status', 'cancelled');
        if (byEmail.data) {
          byEmail.data.forEach(function (r) {
            myRsvpByEvent[r.event_id] = r;
          });
        }
      }
    } catch (e2) {
      console.warn('[rsvp] mine', e2);
    }
  }
}

async function openRsvp(eventId) {
  const ev = allEvents.find((e) => String(e.id) === String(eventId));
  if (!ev) return;
  if (isEventExpired(ev)) {
    showToast('This event has ended', true);
    return;
  }
  const modal = document.getElementById('rsvp-modal');
  if (!modal) {
    showToast('RSVP for: ' + ev.title);
    return;
  }
  const idEl = document.getElementById('rsvp-event-id');
  if (idEl) idEl.value = eventId;
  const titleEl = document.getElementById('rsvp-event-title');
  if (titleEl) titleEl.textContent = ev.title;
  const dateEl = document.getElementById('rsvp-event-date');
  if (dateEl) {
    const d = new Date(ev.event_date + 'T12:00:00');
    const dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const timeLabel = ev.event_time ? String(ev.event_time).slice(0, 5) : '';
    dateEl.textContent = dateLabel + (timeLabel ? ' • ' + timeLabel : '');
  }
  // Prefill from profile / auth
  try {
    var user = await getCurrentUser();
    if (user) {
      var pr = null;
      try { pr = await getProfile(user.id); } catch (e) {}
      var nameEl = document.getElementById('rsvp-name');
      var emailEl = document.getElementById('rsvp-email');
      if (nameEl && !nameEl.value) {
        nameEl.value = (pr && pr.full_name) || (user.email ? user.email.split('@')[0] : '');
      }
      if (emailEl && !emailEl.value) {
        emailEl.value = (pr && pr.email) || user.email || '';
      }
      var em = document.getElementById('rsvp-emergency');
      if (em && !em.value && pr && pr.emergency_contact) em.value = pr.emergency_contact;
    }
  } catch (e) {}

  var taken = rsvpCountByEvent[ev.id] != null ? rsvpCountByEvent[ev.id] : (ev.spots_taken || 0);
  var left = Math.max(0, (ev.capacity || 40) - taken);
  var note = document.getElementById('rsvp-spots-note');
  if (note) {
    note.textContent = left > 0
      ? left + ' spot' + (left === 1 ? '' : 's') + ' left'
      : 'Event is full — you will be added to the waitlist';
    note.className = 'text-xs mt-1 ' + (left > 0 ? 'text-zinc-500' : 'text-amber-400');
  }
  var submitBtn = document.querySelector('#rsvp-form button[type="submit"]');
  if (submitBtn) {
    submitBtn.textContent = left > 0 ? 'CONFIRM MY SPOT' : 'JOIN WAITLIST';
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  modal.style.zIndex = '99999';
}

function hideRSVPModal() {
  const modal = document.getElementById('rsvp-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}
function closeRsvpModal() { hideRSVPModal(); }

async function submitRSVP(e) {
  e.preventDefault();
  const eventId = parseInt(document.getElementById('rsvp-event-id').value, 10);
  const fullName = document.getElementById('rsvp-name').value.trim();
  const email = document.getElementById('rsvp-email').value.trim();
  const emergency = (document.getElementById('rsvp-emergency') && document.getElementById('rsvp-emergency').value.trim()) || null;
  const waiverEl = document.getElementById('waiver-check') || document.getElementById('rsvp-waiver');
  const waiver = waiverEl ? waiverEl.checked : true;

  if (!fullName || !email) {
    showToast('Name and email required', true);
    return;
  }
  if (waiverEl && !waiver) {
    showToast('Please accept the waiver', true);
    return;
  }

  const ev = allEvents.find(function (x) { return Number(x.id) === eventId; });
  const taken = rsvpCountByEvent[eventId] != null ? rsvpCountByEvent[eventId] : ((ev && ev.spots_taken) || 0);
  const capacity = (ev && ev.capacity) || 40;
  const status = taken >= capacity ? 'waitlist' : 'confirmed';

  var btn = e.target && e.target.querySelector ? e.target.querySelector('[type="submit"]') : null;
  if (!btn && e.submitter) btn = e.submitter;
  if (btn) { btn.disabled = true; }

  try {
    var user = null;
    try { user = await getCurrentUser(); } catch (err) {}

    // Upsert-like: if already has active rsvp, update
    var existingId = null;
    if (user) {
      var ex = await window.sb.from('rsvps').select('id, status')
        .eq('event_id', eventId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (ex.data) existingId = ex.data.id;
    }
    if (!existingId) {
      var ex2 = await window.sb.from('rsvps').select('id')
        .eq('event_id', eventId)
        .eq('email', email)
        .maybeSingle();
      if (ex2.data) existingId = ex2.data.id;
    }

    var payload = {
      event_id: eventId,
      user_id: user ? user.id : null,
      full_name: fullName,
      email: email,
      emergency_contact: emergency,
      waiver_accepted: !!waiver,
      status: status
    };

    var error = null;
    if (existingId) {
      var up = await window.sb.from('rsvps').update(payload).eq('id', existingId).select('*').maybeSingle();
      error = up.error;
      if (up.data) myRsvpByEvent[eventId] = up.data;
    } else {
      var ins = await window.sb.from('rsvps').insert(payload).select('*').maybeSingle();
      error = ins.error;
      if (ins.data) myRsvpByEvent[eventId] = ins.data;
    }
    if (error) throw error;

    // Update local counts immediately so UI reflects remaining spots
    var newTaken = taken;
    if (status === 'confirmed' && !existingId) {
      newTaken = taken + 1;
    } else if (status === 'confirmed' && existingId) {
      // was already counted or upgrading from waitlist — prefer +1 only if previous wasn't confirmed
      var prev = myRsvpByEvent[eventId];
      if (!prev || prev.status !== 'confirmed') newTaken = taken + 1;
    }
    rsvpCountByEvent[eventId] = newTaken;
    if (ev) ev.spots_taken = newTaken;
    // Keep spots_taken in sync on events row (best effort)
    if (status === 'confirmed') {
      try {
        await window.sb.from('events').update({ spots_taken: newTaken }).eq('id', eventId);
      } catch (e2) {}
    }

    showToast(status === 'waitlist' ? 'Added to waitlist' : 'RSVP confirmed!');
    // Alert leaders/admins of new RSVP
    try {
      var evName = (ev && ev.title) ? ev.title : 'Event';
      var msg = fullName + ' RSVP\'d to ' + evName + (status === 'waitlist' ? ' (waitlist)' : '');
      if (typeof broadcastPush === 'function') {
        await broadcastPush({
          title: 'New RSVP',
          body: msg,
          url: 'events.html',
          type: 'rsvp',
          audience: 'leaders'
        });
      }
      if (typeof notifyLocal === 'function' && typeof isNativeApp === 'function' && isNativeApp()) {
        // local only for the acting device is noisy; skip local for actor
      }
    } catch (nerr) {
      console.warn('[rsvp] leader notify', nerr);
    }
    try {
      if (typeof scheduleEventReminders === 'function') {
        await scheduleEventReminders(allEvents, myRsvpByEvent);
      }
    } catch (rerr) {
      console.warn('[rsvp] reminder', rerr);
    }

    try { if (typeof haptic === 'function') haptic('medium'); } catch (h) {}
    hideRSVPModal();
    await loadMyRsvps();
    renderEvents();
  } catch (err) {
    console.error(err);
    var msg = err.message || 'RSVP failed';
    if (String(msg).indexOf('rsvps') >= 0 || err.code === '42P01') {
      msg = 'RSVP table missing — run rsvps.sql in Supabase';
    }
    if (String(msg).toLowerCase().indexOf('duplicate') >= 0 || err.code === '23505') {
      msg = 'You already RSVP’d to this event';
    }
    showToast(msg, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function submitRsvp(e) { return submitRSVP(e); }
function rsvpEvent(id) { openRsvp(id); }

async function cancelRsvp(eventId) {
  eventId = Number(eventId);
  var row = myRsvpByEvent[eventId];
  if (!row) {
    showToast('No RSVP found', true);
    return;
  }
  if (!confirm('Cancel your RSVP for this event?')) return;
  try {
    var res = await window.sb.from('rsvps').update({ status: 'cancelled' }).eq('id', row.id);
    if (res.error) throw res.error;
    var wasConfirmed = row.status === 'confirmed';
    delete myRsvpByEvent[eventId];
    // Update remaining spots immediately
    if (wasConfirmed) {
      var next = Math.max(0, (rsvpCountByEvent[eventId] || 1) - 1);
      rsvpCountByEvent[eventId] = next;
      var evRow = allEvents.find(function (e) { return Number(e.id) === eventId; });
      if (evRow) evRow.spots_taken = next;
      try {
        await window.sb.from('events').update({ spots_taken: next }).eq('id', eventId);
      } catch (e2) {}
    }
    showToast('RSVP cancelled');
    try {
      if (typeof cancelEventReminder === 'function') await cancelEventReminder(eventId);
      if (typeof scheduleEventReminders === 'function') await scheduleEventReminders(allEvents, myRsvpByEvent);
    } catch (rerr) {}

    try { if (typeof haptic === 'function') haptic('light'); } catch (h) {}
    await loadMyRsvps();
    renderEvents();
  } catch (e) {
    showToast(e.message || 'Could not cancel', true);
  }
}

async function openRsvpList(eventId) {
  if (!canManageEvents) {
    showToast('Leaders and admins only', true);
    return;
  }
  eventId = Number(eventId);
  var ev = allEvents.find(function (e) { return Number(e.id) === eventId; });
  var modal = document.getElementById('rsvp-list-modal');
  var body = document.getElementById('rsvp-list-body');
  var title = document.getElementById('rsvp-list-title');
  if (!modal || !body) {
    showToast('RSVP list UI missing — update events.html', true);
    return;
  }
  if (title) title.textContent = (ev && ev.title) ? ('RSVPs · ' + ev.title) : 'RSVPs';
  body.innerHTML = '<p class="text-sm text-zinc-500 p-4">Loading…</p>';
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  modal.style.zIndex = '99999';
  try {
    var res = await window.sb
      .from('rsvps')
      .select('*')
      .eq('event_id', eventId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: true });
    if (res.error) throw res.error;
    var rows = res.data || [];
    if (!rows.length) {
      body.innerHTML = '<p class="text-sm text-zinc-500 p-4">No RSVPs yet.</p>';
      return;
    }
    body.innerHTML =
      '<div class="space-y-2 p-2 max-h-[60vh] overflow-y-auto" style="-webkit-overflow-scrolling:touch">' +
      rows.map(function (r) {
        var st = r.status === 'waitlist'
          ? '<span class="text-amber-400 text-[10px] uppercase">waitlist</span>'
          : '<span class="text-emerald-400 text-[10px] uppercase">confirmed</span>';
        return (
          '<div class="flex items-start justify-between gap-2 bg-zinc-950 border border-zinc-800 rounded-2xl px-3 py-2">' +
          '<div class="min-w-0">' +
          '<div class="font-medium text-sm truncate">' + escapeHtml(r.full_name) + '</div>' +
          '<div class="text-xs text-zinc-500 truncate">' + escapeHtml(r.email) + '</div>' +
          (r.emergency_contact ? '<div class="text-[11px] text-zinc-600">ICE: ' + escapeHtml(r.emergency_contact) + '</div>' : '') +
          '</div>' +
          '<div class="text-right shrink-0 space-y-1">' + st +
          '<button type="button" onclick="adminCancelRsvp(' + r.id + ',' + eventId + ')" class="block text-[11px] text-red-400 hover:text-red-300">Remove</button>' +
          '</div></div>'
        );
      }).join('') +
      '</div>';
  } catch (e) {
    body.innerHTML = '<p class="text-sm text-red-400 p-4">' + escapeHtml(e.message || String(e)) + '</p>';
  }
}

function hideRsvpListModal() {
  var modal = document.getElementById('rsvp-list-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

async function adminCancelRsvp(rsvpId, eventId) {
  if (!canManageEvents) return;
  if (!confirm('Remove this RSVP?')) return;
  try {
    var res = await window.sb.from('rsvps').update({ status: 'cancelled' }).eq('id', rsvpId);
    if (res.error) throw res.error;
    showToast('RSVP removed');
    await loadMyRsvps();
    openRsvpList(eventId);
    renderEvents();
  } catch (e) {
    showToast(e.message || 'Failed', true);
  }
}

function showAllEvents() {
  loadEvents();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bootEvents() {
  if (!window.sb) {
    setTimeout(bootEvents, 150);
    return;
  }
  initEvents().catch((e) => console.error('[events] init', e));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootEvents);
} else {
  bootEvents();
}


function showPokerAdminFor(eventId) {
  let panel = document.getElementById('poker-admin-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'poker-admin-panel';
    panel.className = 'mt-10 border border-zinc-700 rounded-3xl p-6 bg-zinc-950';
    const section = document.getElementById('events');
    if (section) section.appendChild(panel);
  }
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (typeof loadPokerAdmin === 'function') loadPokerAdmin(eventId);
  else showToast('Load js/poker.js for checkpoint admin', true);
}
