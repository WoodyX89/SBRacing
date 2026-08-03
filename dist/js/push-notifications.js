// Native remote push (APNs) — after Apple Developer is active
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

function pushPlugin() {
  try {
    if (!window.Capacitor) return null;
    if (Capacitor.Plugins && Capacitor.Plugins.PushNotifications) {
      return Capacitor.Plugins.PushNotifications;
    }
    if (typeof Capacitor.registerPlugin === 'function') {
      return Capacitor.registerPlugin('PushNotifications');
    }
  } catch (e) {
    console.warn('[push] register failed', e);
  }
  return null;
}

async function savePushToken(token, platform) {
  if (!window.sb || !token) return;
  var user = null;
  try {
    var session = await window.sb.auth.getSession();
    user = session && session.data && session.data.session && session.data.session.user;
  } catch (e) {}
  try {
    await window.sb.from('push_tokens').upsert({
      token: token,
      platform: platform || 'ios',
      user_id: user ? user.id : null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'token' });
    console.log('[push] token saved');
  } catch (e) {
    console.warn('[push] save token', e);
  }
}

async function initPushNotifications() {
  console.log('[push] native=', isNativeApp(), 'plugin=', !!pushPlugin());
  var Push = pushPlugin();
  if (!Push) {
    console.log('[push] skip — plugin not available (install @capacitor/push-notifications + cap sync)');
    return;
  }
  if (!isNativeApp()) {
    console.log('[push] skip — not native platform');
    return;
  }

  try {
    var perm = await Push.requestPermissions();
    console.log('[push] permissions', JSON.stringify(perm));
    if (perm.receive !== 'granted') return;
    await Push.register();
  } catch (e) {
    console.warn('[push] register failed', e);
    return;
  }

  Push.addListener('registration', function (token) {
    var value = token && (token.value || token);
    console.log('[push] device token', value);
    var platform = 'ios';
    try { platform = Capacitor.getPlatform() || 'ios'; } catch (e) {}
    savePushToken(value, platform);
  });

  Push.addListener('registrationError', function (err) {
    console.warn('[push] registrationError', err);
  });

  Push.addListener('pushNotificationReceived', function (notification) {
    console.log('[push] foreground', notification);
    if (typeof showToast === 'function') {
      showToast(((notification && notification.title) || 'SB Racing') + (notification.body ? ': ' + notification.body : ''));
    }
  });

  Push.addListener('pushNotificationActionPerformed', function (action) {
    try {
      var data = action && action.notification && action.notification.data;
      window.location.href = (data && data.url) || 'events.html';
    } catch (e) {
      window.location.href = 'events.html';
    }
  });
}

/** Generic remote push to all registered devices via edge function */
async function broadcastPush(opts) {
  opts = opts || {};
  if (!window.sb) return;
  try {
    var title = opts.title || 'SB Racing';
    var body = opts.body || '';
    if (body.length > 180) body = body.slice(0, 177) + '…';
    var res = await window.sb.functions.invoke('notify-event', {
      body: {
        title: title,
        body: body,
        data: {
          url: opts.url || 'index.html',
          type: opts.type || 'activity'
        }
      }
    });
    if (res.error) console.warn('[push] broadcast', res.error);
    else console.log('[push] broadcast ok', res.data);
  } catch (e) {
    console.warn('[push] broadcastPush', e);
  }
}

async function sendEventPushToAll(eventPayload, opts) {
  opts = opts || {};
  if (!window.sb) return;
  try {
    var name = (eventPayload && (eventPayload.title || eventPayload.name)) || '';
    var title;
    var body;
    var url = 'events.html';
    var type = 'event';
    if (opts.isDelete) {
      title = 'SB Racing · Event cancelled';
      body = (name || 'An event') + ' was removed';
      if (eventPayload && eventPayload.event_date) body += ' · ' + eventPayload.event_date;
      type = 'event_delete';
    } else if (opts.isEdit) {
      title = 'SB Racing · Event updated';
      if (opts.changeSummary) {
        body = (name ? name + ' — ' : '') + opts.changeSummary;
      } else {
        body = name || 'An event was updated';
        if (eventPayload && eventPayload.event_date) body += ' · ' + eventPayload.event_date;
      }
      type = 'event_edit';
    } else {
      title = 'SB Racing · New event';
      body = name || 'A new ride was posted';
      if (eventPayload && eventPayload.event_date) body += ' · ' + eventPayload.event_date;
    }
    if (body.length > 180) body = body.slice(0, 177) + '…';
    await broadcastPush({ title: title, body: body, url: url, type: type });
  } catch (e) {
    console.warn('[push] sendEventPushToAll', e);
  }
}

document.addEventListener('DOMContentLoaded', function () {
  setTimeout(initPushNotifications, 500);
  setTimeout(initPushNotifications, 2000);
});
