// Events page — load from Supabase + RSVP

async function loadEvents() {
    const container = document.querySelector('#events .grid');
    if (!container) return;

    try {
        const { data, error } = await sb
            .from('events')
            .select('*')
            .gte('event_date', new Date().toISOString().split('T')[0])
            .order('event_date', { ascending: true })
            .limit(12);

        if (error) throw error;

        if (!data || data.length === 0) {
            // Keep the static HTML fallback if no rows yet
            console.log('No upcoming events in DB — showing static cards');
            return;
        }

        // Replace static cards with live data
        container.innerHTML = data.map((ev, idx) => {
            const spotsLeft = Math.max(0, (ev.capacity || 40) - (ev.spots_taken || 0));
            const dateObj = new Date(ev.event_date + 'T12:00:00');
            const dateLabel = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
            const timeLabel = ev.event_time ? ev.event_time.slice(0, 5) : '';
            const difficultyColors = {
                easy: 'bg-emerald-900/60 text-emerald-400',
                intermediate: 'bg-emerald-900/60 text-emerald-400',
                advanced: 'bg-orange-900/60 text-orange-400',
                all_levels: 'bg-sky-900/60 text-sky-400'
            };
            const badgeColor = ev.is_featured ? 'text-orange-400' : (ev.category === 'clinic' ? 'text-sky-400' : 'text-emerald-400');
            const badgeText = ev.is_featured ? 'FEATURED' : (ev.category === 'clinic' ? 'CLINIC' : 'THIS WEEK');

            return `
            <div class="trail-card bg-zinc-900 border border-zinc-800 rounded-3xl p-6 flex flex-col">
                <div class="flex justify-between items-start">
                    <div>
                        <div class="text-xs font-mono tracking-widest ${badgeColor}">${badgeText}</div>
                        <div class="font-bold text-xl mt-1">${escapeHtml(ev.title)}</div>
                    </div>
                    <div class="text-right">
                        <div class="text-xs text-zinc-400">${dateLabel}</div>
                        <div class="font-mono text-sm">${timeLabel}</div>
                    </div>
                </div>
                <div class="mt-auto pt-6">
                    <div class="flex items-center gap-x-2 text-xs mb-4 flex-wrap gap-y-1">
                        <span class="px-3 py-1 ${difficultyColors[ev.difficulty] || 'bg-zinc-800'} rounded-full text-[10px] font-medium uppercase">${(ev.difficulty || '').replace('_', ' ')}</span>
                        <span class="px-3 py-1 bg-zinc-800 rounded-full text-[10px]">${escapeHtml(ev.location || '')}</span>
                    </div>
                    <p class="text-sm text-zinc-400 line-clamp-2">${escapeHtml(ev.description || '')}</p>
                    <div class="flex items-center justify-between mt-6">
                        <div class="text-xs text-zinc-400">${spotsLeft} spots left • ${ev.spots_taken || 0} signed up</div>
                        <button onclick="rsvpEvent(${ev.id}, '${escapeAttr(ev.title)}', '${dateLabel} • ${timeLabel}')"
                                class="text-xs font-semibold px-5 py-2 rounded-2xl border border-orange-600 text-orange-500 hover:bg-orange-950 active:bg-orange-900 transition-all">
                            RSVP
                        </button>
                    </div>
                </div>
            </div>`;
        }).join('');

    } catch (err) {
        console.warn('Could not load events from Supabase:', err.message);
        // Static HTML remains as fallback
    }
}

let currentEvent = null;

function rsvpEvent(eventId, title, dateStr) {
    currentEvent = { id: eventId, title, dateStr };

    document.getElementById('rsvp-event-title').textContent = title;
    document.getElementById('rsvp-event-date').textContent = dateStr;

    // Pre-fill if logged in
    getCurrentUser().then(user => {
        if (user) {
            getProfile(user.id).then(profile => {
                if (profile) {
                    const nameInput = document.getElementById('rsvp-name');
                    const emailInput = document.getElementById('rsvp-email');
                    if (nameInput && !nameInput.value) nameInput.value = profile.full_name || '';
                    if (emailInput && !emailInput.value) emailInput.value = profile.email || user.email || '';
                }
            });
        }
    });

    const modal = document.getElementById('rsvp-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function hideRSVPModal() {
    const modal = document.getElementById('rsvp-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

async function submitRSVP(e) {
    e.preventDefault();

    const name = document.getElementById('rsvp-name').value.trim();
    const email = document.getElementById('rsvp-email').value.trim();
    const emergency = document.getElementById('rsvp-emergency')?.value?.trim() || '';
    const waiver = document.getElementById('waiver-check')?.checked;

    if (!name || !email) {
        showToast('Name and email required', true);
        return;
    }
    if (!waiver) {
        showToast('Please accept the waiver', true);
        return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    const original = btn?.innerHTML;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }

    try {
        const user = await getCurrentUser();

        const { error } = await sb.from('rsvps').insert({
            event_id: currentEvent.id,
            user_id: user?.id || null,
            full_name: name,
            email: email,
            emergency_contact: emergency,
            waiver_accepted: true,
            status: 'confirmed'
        });

        if (error) {
            if (error.code === '23505') {
                showToast('You already RSVP\'d to this event');
            } else {
                throw error;
            }
        } else {
            // Best-effort increment spots_taken
            try {
                await sb.rpc('increment_spots', { event_id_input: currentEvent.id });
            } catch (_) {
                // ignore if function doesn't exist
            }
            showToast(`You're confirmed for ${currentEvent.title}! See you on the trails, ${name.split(' ')[0]}.`);
        }

        hideRSVPModal();
        currentEvent = null;
        // Refresh events list
        loadEvents();

    } catch (err) {
        console.error(err);
        showToast(err.message || 'RSVP failed', true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }
}

function showAllEvents() {
    showToast('Showing all upcoming events');
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

function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof sb !== 'undefined') {
        loadEvents();
    }
});
