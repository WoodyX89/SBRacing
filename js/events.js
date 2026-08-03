// Events — list + RSVP + admin add/edit/delete

let allEvents = [];
let isAdmin = false;
let editingEventId = null;
let editingEventBaseline = null;
/** @type {Record<number, {likes: any[], comments: any[], liked: boolean}>} */
let eventSocial = {};
let eventsCurrentUserId = null;

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
  try {
    const user = await getCurrentUser();
    if (!user) return;
    const profile = await getProfile(user.id);
    isAdmin = !!(profile && profile.is_admin);
  } catch (e) {
    console.warn('[events] admin check', e);
  }
}

function showAdminChrome() {
  const btn = document.getElementById('btn-add-event');
  const badge = document.getElementById('events-admin-badge');
  if (btn) btn.classList.toggle('hidden', !isAdmin);
  if (badge) badge.classList.toggle('hidden', !isAdmin);
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
      // Public: upcoming only; admin: all (including past) for management
      if (!isAdmin) {
        q = q.gte('event_date', new Date().toISOString().split('T')[0]);
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
      if (!isAdmin) {
        url += '&event_date=gte.' + new Date().toISOString().split('T')[0];
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
    await loadEventSocial();
    renderEvents();
    console.log('[events] loaded', allEvents.length, 'admin=', isAdmin);
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
        ${isAdmin ? '<p class="text-sm mt-2 text-orange-500">Click Add Event to create one.</p>' : ''}
      </div>`;
    return;
  }

  grid.innerHTML = allEvents.map((ev) => {
    const spotsLeft = Math.max(0, (ev.capacity || 40) - (ev.spots_taken || 0));
    const dateObj = new Date(ev.event_date + 'T12:00:00');
    const dateLabel = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
    const timeLabel = ev.event_time ? String(ev.event_time).slice(0, 5) : '';
    const diffClass = {
      easy: 'bg-emerald-900/60 text-emerald-400',
      intermediate: 'bg-amber-900/60 text-amber-400',
      advanced: 'bg-orange-900/60 text-orange-400',
      all_levels: 'bg-sky-900/60 text-sky-400'
    }[ev.difficulty] || 'bg-zinc-800 text-zinc-400';
    const badgeColor = ev.is_featured ? 'text-orange-400' : (ev.category === 'clinic' ? 'text-sky-400' : 'text-emerald-400');
    const badgeText = ev.is_featured ? 'FEATURED' : (ev.category === 'clinic' ? 'CLINIC' : (ev.category === 'social' ? 'SOCIAL' : 'RIDE'));

    const pokerBtn = (isAdmin && ev.category === 'poker_run') ? `
        <a href="poker.html?e=${ev.id}" class="text-xs px-3 py-1.5 rounded-xl border border-orange-700 text-orange-400 hover:bg-orange-950/40">
          <i class="fa-solid fa-spade mr-1"></i>Poker run
        </a>
        <button type="button" onclick="showPokerAdminFor(${ev.id})" class="text-xs px-3 py-1.5 rounded-xl border border-zinc-600 hover:bg-zinc-800">
          Checkpoints
        </button>` : (ev.category === 'poker_run' ? `
        <a href="poker.html?e=${ev.id}" class="text-xs px-3 py-1.5 rounded-xl border border-orange-700 text-orange-400">Leaderboard</a>` : '');
    const adminBtns = isAdmin ? `
      <div class="flex gap-2 mt-3">
        <button type="button" onclick="openEventModal(${ev.id})" class="text-xs px-3 py-1.5 rounded-xl border border-zinc-600 hover:bg-zinc-800">
          <i class="fa-solid fa-pen mr-1"></i>Edit
        </button>
      </div>` : '';

    const cardBody = `
        <div class="flex justify-between items-start gap-3">
          <div class="min-w-0">
            <div class="text-xs font-mono tracking-widest ${badgeColor}">${badgeText}</div>
            <div class="font-bold text-xl mt-1">${escapeHtml(ev.title)}</div>
            ${ev.location ? `<div class="text-xs text-zinc-500 mt-1"><i class="fa-solid fa-location-dot mr-1"></i>${escapeHtml(ev.location)}</div>` : ''}
          </div>
          <div class="text-right shrink-0">
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
          <button type="button" onclick="openRsvp(${ev.id})" class="w-full py-3 rounded-2xl bg-white text-zinc-900 font-semibold text-sm hover:bg-amber-50 active:scale-[0.98] transition-all">
            RSVP
          </button>
          ${pokerBtn ? `<div class="flex flex-wrap gap-2 mt-3">${pokerBtn}</div>` : ''}
          ${adminBtns}
          ${renderEventSocial(ev.id)}
        </div>`;

    if (!isAdmin) {
      return `<div class="trail-card bg-zinc-900 border border-zinc-800 rounded-3xl p-6 flex flex-col">${cardBody}</div>`;
    }

    // Admin: swipe-left to delete
    return `
      <div class="relative overflow-hidden rounded-3xl" data-swipe-event="${ev.id}">
        <div class="absolute inset-y-0 right-0 w-24 flex items-stretch">
          <button type="button" onclick="deleteEvent(${ev.id})" class="flex-1 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex flex-col items-center justify-center gap-1">
            <i class="fa-solid fa-trash text-base"></i>Delete
          </button>
        </div>
        <div class="trail-card relative bg-zinc-900 border border-zinc-800 rounded-3xl p-6 flex flex-col touch-pan-y transition-transform duration-200 will-change-transform" data-swipe-content>
          ${cardBody}
        </div>
      </div>`;
  }).join('');

  initEventSwipeToDelete(grid);
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

function renderEventSocial(eventId) {
  var s = eventSocial[eventId] || { likes: [], comments: [], liked: false };
  var likeCount = (s.likes && s.likes.length) || 0;
  var comments = s.comments || [];
  var commentsHtml = comments.map(function (c) {
    var canDelete = (eventsCurrentUserId && c.user_id === eventsCurrentUserId) || isAdmin;
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
  return (
    '<div class="mt-4 pt-3 border-t border-zinc-800">' +
    '<div class="flex items-center gap-3 text-sm">' +
    '<button type="button" onclick="toggleEventLike(' + eventId + ')" class="' +
    (s.liked ? 'text-orange-500' : 'text-zinc-400 hover:text-orange-400') + '">' +
    '<i class="fa-' + (s.liked ? 'solid' : 'regular') + ' fa-heart mr-1"></i>' + likeCount +
    '</button>' +
    '<button type="button" onclick="toggleEventComments(' + eventId + ')" class="text-zinc-400 hover:text-white text-sm">' +
    '<i class="fa-regular fa-comment mr-1"></i>' + comments.length +
    '</button>' +
    '</div>' +
    '<div id="event-comments-' + eventId + '" class="hidden mt-2 space-y-1">' +
    commentsHtml +
    '<div class="flex gap-2 mt-2">' +
    '<input id="event-comment-input-' + eventId + '" type="text" placeholder="Comment…" ' +
    'class="flex-1 bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-1.5 text-xs outline-none focus:border-orange-600" ' +
    'onkeydown="if(event.key===\'Enter\'){event.preventDefault();submitEventComment(' + eventId + ')}">' +
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
    var nameMap = {};
    if (userIds.length) {
      var pr = await window.sb.from('profiles').select('id, full_name').in('id', userIds);
      if (pr.data) pr.data.forEach(function (p) { nameMap[p.id] = p.full_name || 'Member'; });
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

async function toggleEventLike(eventId) {
  var user = null;
  try { user = await getCurrentUser(); } catch (e) {}
  if (!user) {
    showToast('Log in to like events', true);
    return;
  }
  try {
    var existing = await window.sb.from('event_likes')
      .select('id')
      .eq('event_id', eventId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (existing.data) {
      await window.sb.from('event_likes').delete().eq('id', existing.data.id);
    } else {
      await window.sb.from('event_likes').insert({ event_id: eventId, user_id: user.id });
    }
    await loadEventSocial();
    renderEvents();
  } catch (e) {
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
          title: 'SB Racing · Event comment',
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
  if (!isAdmin) {
    showToast('Admin only — log in as admin', true);
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
  if (!isAdmin) {
    showToast('Admin only', true);
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
  if (!isAdmin) return;
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

function openRsvp(eventId) {
  const ev = allEvents.find((e) => e.id === eventId);
  if (!ev) return;
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
  modal.classList.remove('hidden');
  modal.classList.add('flex');
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

  try {
    const session = await getSession();
    const { error } = await window.sb.from('rsvps').insert({
      event_id: eventId,
      user_id: session && session.user ? session.user.id : null,
      full_name: fullName,
      email: email,
      emergency_contact: emergency,
      waiver_accepted: !!waiver,
      status: 'confirmed'
    });
    if (error) throw error;
    showToast('RSVP confirmed!');
    hideRSVPModal();
    await loadEvents();
  } catch (err) {
    console.error(err);
    showToast(err.message || 'RSVP failed', true);
  }
}
// alias
async function submitRsvp(e) { return submitRSVP(e); }
function rsvpEvent(id) { openRsvp(id); }

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
