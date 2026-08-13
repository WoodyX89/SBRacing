// Local notifications for Capacitor (vanilla JS — registerPlugin required)
function isNativeApp() {
  try {
    if (!window.Capacitor) return false;
    if (typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform()) return true;
    var p = typeof Capacitor.getPlatform === 'function' ? Capacitor.getPlatform() : '';
    return p === 'ios' || p === 'android';
  } catch (e) {
    return false;
  }
}

/** Capacitor static sites must registerPlugin — Plugins.X is empty otherwise */
function getLocalNotificationsPlugin() {
  try {
    if (!window.Capacitor) return null;
    if (Capacitor.Plugins && Capacitor.Plugins.LocalNotifications) {
      return Capacitor.Plugins.LocalNotifications;
    }
    if (typeof Capacitor.registerPlugin === 'function') {
      return Capacitor.registerPlugin('LocalNotifications');
    }
  } catch (e) {
    console.warn('[notify] registerPlugin failed', e);
  }
  return null;
}

async function ensureNotifyPermission() {
  var LN = getLocalNotificationsPlugin();
  if (!LN) {
    console.warn('[notify] no LocalNotifications plugin');
    return false;
  }
  try {
    var perms = await LN.checkPermissions();
    console.log('[notify] checkPermissions', JSON.stringify(perms));
    if (perms && perms.display === 'granted') return true;
    if (perms && perms.display === 'denied') {
      console.warn('[notify] denied — Settings → SB Racing → Notifications');
      return false;
    }
    var req = await LN.requestPermissions();
    console.log('[notify] requestPermissions', JSON.stringify(req));
    return !!(req && req.display === 'granted');
  } catch (e) {
    console.warn('[notify] permission error', e);
    return false;
  }
}

var _notifySeq = 1;

async function notifyLocal(opts) {
  var LN = getLocalNotificationsPlugin();
  if (!LN) {
    console.warn('[notify] no plugin — cannot schedule');
    return false;
  }
  if (!(await ensureNotifyPermission())) {
    console.warn('[notify] no permission');
    return false;
  }
  var id = opts.id != null ? Number(opts.id) : (Math.floor(Date.now() % 1000000000) + (_notifySeq++));
  var title = opts.title || 'SB Racing';
  var body = opts.body || '';
  var when = opts.scheduleAt ? new Date(opts.scheduleAt) : new Date(Date.now() + 1500);
  if (isNaN(when.getTime())) when = new Date(Date.now() + 1500);
  // iOS requires future date
  if (when.getTime() <= Date.now() + 500) when = new Date(Date.now() + 1500);
  try {
    await LN.schedule({
      notifications: [{
        id: id,
        title: title,
        body: body,
        schedule: { at: when },
        sound: 'default',
        extra: opts.extra || {}
      }]
    });
    console.log('[notify] scheduled', id, title, '|', body);
    return true;
  } catch (e) {
    console.warn('[notify] schedule failed', e);
    return false;
  }
}

async function notifyEventDeleted(eventRow) {
  var name = (eventRow && (eventRow.title || eventRow.name)) || 'Event';
  var when = eventRow && eventRow.event_date ? String(eventRow.event_date) : '';
  var body = when ? (name + ' · ' + when) : name;
  if (body.length > 180) body = body.slice(0, 177) + '…';
  await notifyLocal({
    title: 'SB Racing · Event cancelled',
    body: (body + ' — cancelled'),
    extra: { type: 'event_delete', id: eventRow && eventRow.id }
  });
}

async function notifyEventAdded(eventRow, opts) {
  opts = opts || {};
  var name = (eventRow && (eventRow.title || eventRow.name)) || (opts.isEdit ? 'Event updated' : 'New event');
  var when = eventRow && eventRow.event_date ? String(eventRow.event_date) : '';
  var body;
  if (opts.isEdit && opts.changeSummary) {
    body = name + ' — ' + opts.changeSummary;
  } else if (opts.isEdit) {
    body = name + (when ? ' · ' + when : '') + ' (updated)';
  } else {
    body = when ? name + ' · ' + when : name;
  }
  // iOS truncates long bodies — keep reasonable length
  if (body.length > 180) body = body.slice(0, 177) + '…';
  await notifyLocal({
    title: opts.isEdit ? 'SB Racing · Event updated' : 'SB Racing · New event',
    body: body,
    extra: {
      type: opts.isEdit ? 'event_edit' : 'event',
      id: eventRow && eventRow.id,
      changes: opts.changeSummary || ''
    }
  });
}

/**
 * Local alert for any community activity (posts, comments, events).
 * opts: { title, body, url, type }
 */
async function notifyActivity(opts) {
  opts = opts || {};
  var title = opts.title || 'SB Racing';
  var body = opts.body || '';
  if (body.length > 180) body = body.slice(0, 177) + '…';
  await notifyLocal({
    title: title,
    body: body,
    extra: { type: opts.type || 'activity', url: opts.url || '' }
  });
}

/** Local + remote (when APNs edge function is live) */
async function notifyActivityAll(opts) {
  try {
    await notifyActivity(opts);
  } catch (e) {
    console.warn('[notify] local activity', e);
  }
  try {
    if (typeof broadcastPush === 'function') {
      await broadcastPush(opts);
    } else if (typeof sendEventPushToAll === 'function' && opts) {
      // fallback shape for older push helper
      await window.sb?.functions?.invoke('notify-event', {
        body: {
          title: opts.title || 'SB Racing',
          body: opts.body || '',
          data: { url: opts.url || 'forum.html', type: opts.type || 'activity' }
        }
      });
    }
  } catch (e) {
    console.warn('[notify] remote activity', e);
  }
}

var _activityWatchTimer = null;
var _lastStamps = {
  event: null,
  forum_post: null,
  forum_comment: null,
  event_comment: null
};

async function pollStamp(table, selectCols, stampKey, buildNotify) {
  if (!window.sb) return;
  try {
    var res = await window.sb
      .from(table)
      .select(selectCols)
      .order('created_at', { ascending: false })
      .limit(1);
    if (res.error || !res.data || !res.data.length) return;
    var row = res.data[0];
    var stamp = row.created_at || String(row.id);
    if (_lastStamps[stampKey] == null) {
      _lastStamps[stampKey] = stamp;
      return;
    }
    if (stamp !== _lastStamps[stampKey]) {
      _lastStamps[stampKey] = stamp;
      var opts = buildNotify(row);
      if (opts) await notifyActivity(opts);
    }
  } catch (e) {
    // table may not exist yet
  }
}

async function pollCommunityActivityOnce() {
  await pollStamp('events', 'id, title, name, event_date, created_at', 'event', function (row) {
    var name = row.title || row.name || 'Event';
    return {
      title: 'SB Racing · New event',
      body: name,
      url: 'events.html',
      type: 'event'
    };
  });
  await pollStamp('forum_posts', 'id, body, post_type, created_at', 'forum_post', function (row) {
    var preview = (row.body || (row.post_type === 'poll' ? 'New poll' : 'New post')).slice(0, 100);
    return {
      title: 'SB Racing · Forum',
      body: preview,
      url: 'forum.html',
      type: 'forum_post'
    };
  });
  await pollStamp('forum_comments', 'id, body, post_id, created_at', 'forum_comment', function (row) {
    return {
      title: 'SB Racing · Forum comment',
      body: (row.body || 'New comment').slice(0, 120),
      url: 'forum.html',
      type: 'forum_comment'
    };
  });
  await pollStamp('event_comments', 'id, body, event_id, created_at', 'event_comment', function (row) {
    return {
      title: 'SB Racing · Event comment',
      body: (row.body || 'New comment').slice(0, 120),
      url: 'events.html',
      type: 'event_comment'
    };
  });
}

function startEventNotificationWatch(intervalMs) {
  intervalMs = intervalMs || 45000;
  if (_activityWatchTimer) return;
  pollCommunityActivityOnce();
  _activityWatchTimer = setInterval(pollCommunityActivityOnce, intervalMs);
}

async function testLocalNotification() {
  console.log('[notify] Capacitor', !!window.Capacitor);
  console.log('[notify] platform', window.Capacitor && Capacitor.getPlatform && Capacitor.getPlatform());
  console.log('[notify] native', isNativeApp());
  console.log('[notify] plugin', !!getLocalNotificationsPlugin());
  var ok = await ensureNotifyPermission();
  if (!ok) {
    if (typeof showToast === 'function') showToast('Notifications blocked — check Settings', true);
    return;
  }
  await notifyLocal({ title: 'SB Racing', body: 'Test notification — local alerts work.' });
  if (typeof showToast === 'function') showToast('Test notification sent');
}

function bootNativeNotifications() {
  var native = isNativeApp();
  var plugin = !!getLocalNotificationsPlugin();
  console.log('[notify] boot native=', native, 'plugin=', plugin);
  if (!native) return;
  ensureNotifyPermission().then(function (ok) {
    console.log('[notify] granted=', ok);
    if (ok) startEventNotificationWatch(60 * 1000);
  });
}

document.addEventListener('DOMContentLoaded', function () {
  bootNativeNotifications();
  setTimeout(bootNativeNotifications, 500);
  setTimeout(bootNativeNotifications, 1500);
});


/** Stable local id for an event reminder (cancel/reschedule). */
function eventReminderNotifyId(eventId) {
  return 700000000 + (Number(eventId) % 100000000);
}

async function cancelEventReminder(eventId) {
  var LN = getLocalNotificationsPlugin();
  if (!LN) return;
  try {
    await LN.cancel({ notifications: [{ id: eventReminderNotifyId(eventId) }] });
  } catch (e) {
    console.warn('[notify] cancel reminder', e);
  }
}

/**
 * Schedule "event tomorrow" style local alerts for RSVPs the current user holds.
 * Remind 24h before event start (or 1h before if already inside the 24h window).
 * eventsList: array of event rows; rsvpMap: event_id -> rsvp row
 */
async function scheduleEventReminders(eventsList, rsvpMap) {
  if (!isNativeApp()) return;
  if (!(await ensureNotifyPermission())) return;
  eventsList = eventsList || [];
  rsvpMap = rsvpMap || {};
  var now = Date.now();
  for (var i = 0; i < eventsList.length; i++) {
    var ev = eventsList[i];
    var rsvp = rsvpMap[ev.id];
    if (!rsvp || rsvp.status === 'cancelled') {
      await cancelEventReminder(ev.id);
      continue;
    }
    var startMs = null;
    if (typeof eventStartMs === 'function') {
      startMs = eventStartMs(ev);
    } else {
      var d = String(ev.event_date || '');
      var t = ev.event_time ? String(ev.event_time).slice(0, 5) : '12:00';
      startMs = new Date(d + 'T' + t + ':00').getTime();
    }
    if (!startMs || isNaN(startMs) || startMs <= now) {
      await cancelEventReminder(ev.id);
      continue;
    }
    var remindAt = startMs - 24 * 60 * 60 * 1000;
    if (remindAt <= now) {
      // Already inside 24h window — remind 1 hour before if still future
      remindAt = startMs - 60 * 60 * 1000;
    }
    if (remindAt <= now) continue;

    var name = ev.title || ev.name || 'Event';
    var whenStr = ev.event_date || '';
    if (ev.event_time) whenStr += ' · ' + String(ev.event_time).slice(0, 5);
    await notifyLocal({
      id: eventReminderNotifyId(ev.id),
      title: 'SB Racing · Tomorrow',
      body: name + (whenStr ? ' · ' + whenStr : ''),
      scheduleAt: new Date(remindAt).toISOString(),
      extra: { type: 'event_reminder', id: ev.id, url: 'events.html' }
    });
  }
  console.log('[notify] event reminders scheduled');
}
