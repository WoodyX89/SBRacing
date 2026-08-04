/**
 * SB Racing — Offline-first ride tracker
 * --------------------------------------
 * Works in three layers (best → fallback):
 *  1. @capgo/background-geolocation  (true background on iOS/Android)
 *  2. @capacitor/geolocation          (native permissions, foreground)
 *  3. navigator.geolocation           (browser / PWA)
 *
 * Records: lat, lng, altitude, accuracy, timestamp
 * Computes: distance, elevation gain/loss, elapsed + moving time
 * Persists active ride to localStorage so a kill/restart can recover it.
 *
 * App Store notes:
 *  - Tracking only starts after explicit user action (Start Ride)
 *  - Persistent notification while recording (Android required)
 *  - User can stop at any time
 *  - UIBackgroundModes = location + Always usage string required
 */

(function (global) {
  'use strict';

  var STORAGE_KEY = 'sbr_active_ride_v1';
  var MIN_POINT_DISTANCE_M = 4;       // ignore jitter closer than this
  var MIN_ELEV_DELTA_M = 2.5;         // ignore small altitude noise
  var MAX_ACCURACY_M = 45;            // discard very inaccurate points
  var MOVING_SPEED_THRESHOLD_KMH = 1.2;

  var state = {
    status: 'idle',          // idle | recording | paused
    points: [],              // {lat,lng,alt,acc,t,speed?}
    startTs: null,
    pauseStartedTs: null,
    pausedMs: 0,
    distanceM: 0,
    elevGainM: 0,
    elevLossM: 0,
    lastAcceptedAlt: null,
    provider: null           // 'capgo' | 'capacitor' | 'browser'
  };

  var listeners = [];
  var watchHandle = null;    // browser watchId or capacitor callback id
  var capgoRunning = false;

  // ---------- helpers ----------
  function now() { return Date.now(); }

  function haversineM(a, b) {
    var R = 6371000;
    var toRad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toRad;
    var dLng = (b.lng - a.lng) * toRad;
    var lat1 = a.lat * toRad, lat2 = b.lat * toRad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function emit() {
    var snap = getSnapshot();
    listeners.forEach(function (cb) {
      try { cb(snap); } catch (e) { console.error('[RideTracker] listener error', e); }
    });
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        status: state.status,
        points: state.points,
        startTs: state.startTs,
        pauseStartedTs: state.pauseStartedTs,
        pausedMs: state.pausedMs,
        distanceM: state.distanceM,
        elevGainM: state.elevGainM,
        elevLossM: state.elevLossM,
        lastAcceptedAlt: state.lastAcceptedAlt
      }));
    } catch (e) { /* quota / private mode */ }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.points)) return false;
      state.status = data.status === 'recording' || data.status === 'paused' ? data.status : 'idle';
      state.points = data.points || [];
      state.startTs = data.startTs || null;
      state.pauseStartedTs = data.pauseStartedTs || null;
      state.pausedMs = data.pausedMs || 0;
      state.distanceM = data.distanceM || 0;
      state.elevGainM = data.elevGainM || 0;
      state.elevLossM = data.elevLossM || 0;
      state.lastAcceptedAlt = data.lastAcceptedAlt != null ? data.lastAcceptedAlt : null;
      return state.points.length > 0;
    } catch (e) {
      return false;
    }
  }

  function clearPersist() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  function acceptPoint(raw) {
    if (state.status !== 'recording') return;

    var lat = raw.lat;
    var lng = raw.lng;
    var alt = (typeof raw.alt === 'number' && isFinite(raw.alt)) ? raw.alt : null;
    var acc = (typeof raw.acc === 'number' && isFinite(raw.acc)) ? raw.acc : 999;
    var t = raw.t || now();
    var speed = (typeof raw.speed === 'number' && isFinite(raw.speed)) ? raw.speed : null; // m/s

    if (acc > MAX_ACCURACY_M) return;

    var pt = { lat: lat, lng: lng, alt: alt, acc: acc, t: t, speed: speed };

    if (state.points.length) {
      var prev = state.points[state.points.length - 1];
      var dist = haversineM(prev, pt);
      if (dist < MIN_POINT_DISTANCE_M) return;

      state.distanceM += dist;

      // Elevation gain / loss with simple deadband
      if (alt != null && state.lastAcceptedAlt != null) {
        var dAlt = alt - state.lastAcceptedAlt;
        if (Math.abs(dAlt) >= MIN_ELEV_DELTA_M) {
          if (dAlt > 0) state.elevGainM += dAlt;
          else state.elevLossM += -dAlt;
          state.lastAcceptedAlt = alt;
        }
      } else if (alt != null) {
        state.lastAcceptedAlt = alt;
      }
    } else {
      if (alt != null) state.lastAcceptedAlt = alt;
    }

    state.points.push(pt);
    persist();
    emit();
  }

  // ---------- provider detection ----------
  function hasCapgo() {
    return !!(global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.BackgroundGeolocation);
  }

  function hasCapacitorGeo() {
    return !!(global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.Geolocation);
  }

  function isNative() {
    try {
      return !!(global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform());
    } catch (e) {
      return false;
    }
  }

  // ---------- Capgo background provider ----------
  async function startCapgo() {
    var BG = global.Capacitor.Plugins.BackgroundGeolocation;
    await BG.start({
      backgroundMessage: 'SB Racing is recording your ride',
      backgroundTitle: 'Ride in progress',
      requestPermissions: true,
      stale: false,
      distanceFilter: 5
    }, function (location, error) {
      if (error) {
        console.warn('[RideTracker] Capgo error', error);
        return;
      }
      if (!location) return;
      acceptPoint({
        lat: location.latitude,
        lng: location.longitude,
        alt: location.altitude,
        acc: location.accuracy,
        t: location.time || now(),
        speed: location.speed
      });
    });
    capgoRunning = true;
    state.provider = 'capgo';
  }

  async function stopCapgo() {
    if (!capgoRunning) return;
    try {
      await global.Capacitor.Plugins.BackgroundGeolocation.stop();
    } catch (e) {}
    capgoRunning = false;
  }

  // ---------- Capacitor Geolocation (foreground / limited background) ----------
  async function startCapacitorGeo() {
    var Geo = global.Capacitor.Plugins.Geolocation;
    // Request permission first
    var perm = await Geo.requestPermissions();
    if (perm && perm.location === 'denied') {
      throw new Error('Location permission denied');
    }

    // Continuous watch
    watchHandle = await Geo.watchPosition({
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 3000
    }, function (pos, err) {
      if (err) {
        console.warn('[RideTracker] Capacitor geo error', err);
        return;
      }
      if (!pos || !pos.coords) return;
      acceptPoint({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        alt: pos.coords.altitude,
        acc: pos.coords.accuracy,
        t: pos.timestamp || now(),
        speed: pos.coords.speed
      });
    });
    state.provider = 'capacitor';
  }

  async function stopCapacitorGeo() {
    if (watchHandle == null) return;
    try {
      await global.Capacitor.Plugins.Geolocation.clearWatch({ id: watchHandle });
    } catch (e) {}
    watchHandle = null;
  }

  // ---------- Browser fallback ----------
  function startBrowser() {
    if (!navigator.geolocation) throw new Error('Geolocation not supported');
    if (typeof window.isSecureContext === 'boolean' && !window.isSecureContext) {
      throw new Error('GPS requires HTTPS (or localhost)');
    }
    watchHandle = navigator.geolocation.watchPosition(
      function (pos) {
        acceptPoint({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          alt: pos.coords.altitude,
          acc: pos.coords.accuracy,
          t: pos.timestamp || now(),
          speed: pos.coords.speed
        });
      },
      function (err) {
        console.warn('[RideTracker] browser geo error', err);
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
    state.provider = 'browser';
  }

  function stopBrowser() {
    if (watchHandle != null) {
      navigator.geolocation.clearWatch(watchHandle);
      watchHandle = null;
    }
  }

  // ---------- public API ----------
  function getSnapshot() {
    var elapsedMs = 0;
    if (state.startTs) {
      var end = state.status === 'paused' && state.pauseStartedTs
        ? state.pauseStartedTs
        : now();
      elapsedMs = Math.max(0, end - state.startTs - (state.pausedMs || 0));
    }

    // Approximate moving time: sum segments where speed > threshold or dist implies movement
    var movingMs = 0;
    for (var i = 1; i < state.points.length; i++) {
      var a = state.points[i - 1];
      var b = state.points[i];
      var dt = b.t - a.t;
      if (dt <= 0 || dt > 120000) continue; // ignore huge gaps (pause)
      var dist = haversineM(a, b);
      var speedKmh = (dist / (dt / 1000)) * 3.6;
      if (speedKmh >= MOVING_SPEED_THRESHOLD_KMH) movingMs += dt;
    }

    return {
      status: state.status,
      points: state.points.slice(),
      distanceKm: state.distanceM / 1000,
      distanceM: state.distanceM,
      elevGainM: Math.round(state.elevGainM),
      elevLossM: Math.round(state.elevLossM),
      elapsedSec: Math.floor(elapsedMs / 1000),
      movingSec: Math.floor(movingMs / 1000),
      pointCount: state.points.length,
      provider: state.provider,
      startTs: state.startTs,
      lastPoint: state.points.length ? state.points[state.points.length - 1] : null
    };
  }

  async function start() {
    if (state.status === 'recording') return getSnapshot();

    // Resume from paused
    if (state.status === 'paused') {
      if (state.pauseStartedTs) {
        state.pausedMs += (now() - state.pauseStartedTs);
        state.pauseStartedTs = null;
      }
      state.status = 'recording';
      await _startProvider();
      persist();
      emit();
      return getSnapshot();
    }

    // Fresh start
    state.points = [];
    state.distanceM = 0;
    state.elevGainM = 0;
    state.elevLossM = 0;
    state.lastAcceptedAlt = null;
    state.pausedMs = 0;
    state.pauseStartedTs = null;
    state.startTs = now();
    state.status = 'recording';

    await _startProvider();
    persist();
    emit();
    return getSnapshot();
  }

  async function _startProvider() {
    if (isNative() && hasCapgo()) {
      await startCapgo();
    } else if (isNative() && hasCapacitorGeo()) {
      await startCapacitorGeo();
    } else {
      startBrowser();
    }
  }

  async function pause() {
    if (state.status !== 'recording') return getSnapshot();
    state.status = 'paused';
    state.pauseStartedTs = now();
    await _stopProvider();
    persist();
    emit();
    return getSnapshot();
  }

  async function stop() {
    if (state.status === 'idle') return getSnapshot();
    state.status = 'idle';
    if (state.pauseStartedTs) {
      state.pausedMs += (now() - state.pauseStartedTs);
      state.pauseStartedTs = null;
    }
    await _stopProvider();
    // Keep points in memory so caller can save; clear storage so we don't auto-resume
    clearPersist();
    emit();
    return getSnapshot();
  }

  async function _stopProvider() {
    if (state.provider === 'capgo') await stopCapgo();
    else if (state.provider === 'capacitor') await stopCapacitorGeo();
    else stopBrowser();
  }

  function onUpdate(cb) {
    if (typeof cb === 'function') listeners.push(cb);
    return function off() {
      listeners = listeners.filter(function (x) { return x !== cb; });
    };
  }

  function toGeoJSON(name) {
    var snap = getSnapshot();
    if (!snap.points.length) return null;
    return {
      type: 'Feature',
      properties: {
        name: name || 'Recorded ride',
        distance_km: Math.round(snap.distanceKm * 100) / 100,
        elev_gain_m: snap.elevGainM,
        elev_loss_m: snap.elevLossM,
        elapsed_sec: snap.elapsedSec,
        moving_sec: snap.movingSec,
        point_count: snap.pointCount,
        started_at: snap.startTs ? new Date(snap.startTs).toISOString() : null,
        recorded_with: 'SB Racing RideTracker'
      },
      geometry: {
        type: 'LineString',
        coordinates: snap.points.map(function (p) {
          return p.alt != null ? [p.lng, p.lat, p.alt] : [p.lng, p.lat];
        })
      }
    };
  }

  function toGPX(name) {
    var snap = getSnapshot();
    if (!snap.points.length) return null;
    var nm = (name || 'SB Racing Ride').replace(/[<>&]/g, '');
    var lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="SB Racing" xmlns="http://www.topografix.com/GPX/1/1">',
      '  <trk>',
      '    <name>' + nm + '</name>',
      '    <trkseg>'
    ];
    snap.points.forEach(function (p) {
      var t = new Date(p.t).toISOString();
      var elev = p.alt != null ? ('<ele>' + p.alt.toFixed(1) + '</ele>') : '';
      lines.push(
        '      <trkpt lat="' + p.lat.toFixed(7) + '" lon="' + p.lng.toFixed(7) + '">' +
        elev + '<time>' + t + '</time></trkpt>'
      );
    });
    lines.push('    </trkseg>', '  </trk>', '</gpx>');
    return lines.join('\n');
  }

  /** Call once on page load — recovers an interrupted ride */
  function initFromStorage() {
    if (restore()) {
      emit();
      return true;
    }
    return false;
  }

  global.RideTracker = {
    start: start,
    pause: pause,
    stop: stop,
    getSnapshot: getSnapshot,
    onUpdate: onUpdate,
    toGeoJSON: toGeoJSON,
    toGPX: toGPX,
    initFromStorage: initFromStorage,
    clearPersist: clearPersist,
    // exposed for UI that wants to force a provider check
    isNative: isNative,
    hasBackgroundSupport: function () { return isNative() && hasCapgo(); }
  };
})(typeof window !== 'undefined' ? window : this);
