// Events — list + RSVP + admin add/edit/delete

let allEvents = [];
let isAdmin = false;
let editingEventId = null;

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
          <i class="fa-solid fa-spade mr-1"></i>Leaderboard
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
        <button type="button" onclick="deleteEvent(${ev.id})" class="text-xs px-3 py-1.5 rounded-xl border border-red-900 text-red-400 hover:bg-red-950/50">
          <i class="fa-solid fa-trash mr-1"></i>Delete
        </button>
      </div>` : '';

    return `
      <div class="trail-card bg-zinc-900 border border-zinc-800 rounded-3xl p-6 flex flex-col">
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
        </div>
      </div>`;
  }).join('');
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

  const ev = id ? allEvents.find((e) => e.id === id) : null;
  document.getElementById('ev-title').value = ev ? ev.title : '';
  document.getElementById('ev-description').value = ev ? (ev.description || '') : '';
  document.getElementById('ev-date').value = ev ? ev.event_date : '';
  document.getElementById('ev-time').value = ev && ev.event_time ? String(ev.event_time).slice(0, 5) : '';
  document.getElementById('ev-location').value = ev ? (ev.location || '') : '';
  document.getElementById('ev-difficulty').value = ev ? (ev.difficulty || 'all_levels') : 'all_levels';
  document.getElementById('ev-capacity').value = ev ? (ev.capacity || 40) : 40;
  document.getElementById('ev-category').value = ev ? (ev.category || 'ride') : 'ride';
  document.getElementById('ev-featured').checked = !!(ev && ev.is_featured);
  document.getElementById('ev-members-only').checked = !!(ev && ev.is_members_only);

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeEventModal() {
  const modal = document.getElementById('event-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  editingEventId = null;
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
  try {
    const { error } = await window.sb.from('events').delete().eq('id', id);
    if (error) throw error;
    showToast('Event deleted');
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