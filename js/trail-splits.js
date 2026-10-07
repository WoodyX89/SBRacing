/**
 * SB Racing — live trail split detector
 * Matches GPS points to mapped trails and times each trail
 * from the moment you join it until you leave or hop to another.
 */
(function (global) {
  'use strict';

  var MATCH_ON_M = 16;
  var MATCH_OFF_M = 26;
  var END_M = 20;
  var SWITCH_CLOSER_M = 8;
  var ENTER_HITS = 3;
  var LEAVE_HITS = 3;
  var SWITCH_HITS = 4;
  var CELL = 0.003; // ~330m
  var SAMPLE_M = 28;
  var MIN_SPLIT_M = 35;
  var MIN_SPLIT_SEC = 12;
  var MAX_SPEED_KMH = 75;

  var network = [];
  var grid = {};
  var current = null;
  var completed = [];
  var enterHits = 0;
  var leaveHits = 0;
  var switchHits = 0;
  var pendingTrailId = null;
  var lastPt = null;

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

  function distToSeg(p, a, b) {
    var toM = 111320;
    var ax = a.lng * toM * Math.cos(a.lat * Math.PI / 180);
    var ay = a.lat * toM;
    var bx = b.lng * toM * Math.cos(b.lat * Math.PI / 180);
    var by = b.lat * toM;
    var px = p.lng * toM * Math.cos(p.lat * Math.PI / 180);
    var py = p.lat * toM;
    var vx = bx - ax, vy = by - ay;
    var wx = px - ax, wy = py - ay;
    var len2 = vx * vx + vy * vy;
    var t = len2 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0;
    var dx = px - (ax + t * vx), dy = py - (ay + t * vy);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function cellKey(lat, lng) {
    return Math.floor(lat / CELL) + ':' + Math.floor(lng / CELL);
  }

  function addToGrid(lat, lng, id) {
    var k = cellKey(lat, lng);
    if (!grid[k]) grid[k] = [];
    if (grid[k].indexOf(id) === -1) grid[k].push(id);
  }

  function nearbyIds(lat, lng) {
    var seen = {};
    var out = [];
    var i0 = Math.floor(lat / CELL);
    var j0 = Math.floor(lng / CELL);
    for (var i = i0 - 1; i <= i0 + 1; i++) {
      for (var j = j0 - 1; j <= j0 + 1; j++) {
        var list = grid[i + ':' + j];
        if (!list) continue;
        for (var n = 0; n < list.length; n++) {
          if (!seen[list[n]]) {
            seen[list[n]] = true;
            out.push(list[n]);
          }
        }
      }
    }
    return out;
  }

  function trailLength(latlngs) {
    var d = 0;
    for (var i = 1; i < latlngs.length; i++) {
      d += haversineM(
        { lat: latlngs[i - 1][0], lng: latlngs[i - 1][1] },
        { lat: latlngs[i][0], lng: latlngs[i][1] }
      );
    }
    return d;
  }

  function distToTrail(pt, trail) {
    var best = Infinity;
    var samples = trail.samples;
    for (var i = 1; i < samples.length; i++) {
      var d = distToSeg(pt, samples[i - 1], samples[i]);
      if (d < best) best = d;
    }
    return best;
  }

  function setNetwork(features) {
    network = [];
    grid = {};
    if (!features || !features.length) return;
    features.forEach(function (tf) {
      var latlngs = tf.latlngs || [];
      if (latlngs.length < 2) return;
      var samples = [];
      var acc = 0;
      var prev = { lat: latlngs[0][0], lng: latlngs[0][1] };
      samples.push(prev);
      addToGrid(prev.lat, prev.lng, tf.id);
      for (var i = 1; i < latlngs.length; i++) {
        var cur = { lat: latlngs[i][0], lng: latlngs[i][1] };
        acc += haversineM(prev, cur);
        if (acc >= SAMPLE_M || i === latlngs.length - 1) {
          samples.push(cur);
          addToGrid(cur.lat, cur.lng, tf.id);
          acc = 0;
        }
        prev = cur;
      }
      var start = { lat: latlngs[0][0], lng: latlngs[0][1] };
      var end = { lat: latlngs[latlngs.length - 1][0], lng: latlngs[latlngs.length - 1][1] };
      network.push({
        id: String(tf.id),
        name: tf.name || 'Trail',
        difficulty: tf.difficulty || 'intermediate',
        start: start,
        end: end,
        samples: samples,
        lengthM: trailLength(latlngs)
      });
    });
  }

  function findTrail(id) {
    for (var i = 0; i < network.length; i++) {
      if (network[i].id === String(id)) return network[i];
    }
    return null;
  }

  function nearestTrail(pt) {
    var ids = nearbyIds(pt.lat, pt.lng);
    var best = null;
    for (var i = 0; i < ids.length; i++) {
      var tr = findTrail(ids[i]);
      if (!tr) continue;
      var d = distToTrail(pt, tr);
      if (!best || d < best.dist) best = { trail: tr, dist: d };
    }
    return best;
  }

  /** Other trail whose start or finish is at this same junction. */
  function junctionTrail(pt, currentId) {
    var ids = nearbyIds(pt.lat, pt.lng);
    var best = null;
    for (var i = 0; i < ids.length; i++) {
      var tr = findTrail(ids[i]);
      if (!tr || String(tr.id) === String(currentId)) continue;
      var dA = haversineM(pt, tr.start);
      var dB = haversineM(pt, tr.end);
      var dEnd = Math.min(dA, dB);
      var dLine = distToTrail(pt, tr);
      if (dEnd <= END_M && dLine <= MATCH_OFF_M) {
        if (!best || dEnd < best.dEnd) best = { trail: tr, dist: dLine, dEnd: dEnd };
      }
    }
    return best;
  }

  function speedKmh(a, b) {
    if (!a || !b || !b.t || !a.t) return 0;
    var dt = (b.t - a.t) / 1000;
    if (dt < 0.4 || dt > 120) return 0;
    return (haversineM(a, b) / dt) * 3.6;
  }

  function openSplit(trail, pt, dist) {
    var dA = haversineM(pt, trail.start);
    var dB = haversineM(pt, trail.end);
    var from = 'mid';
    if (dA <= END_M && dA <= dB) from = 'start';
    else if (dB <= END_M) from = 'end';
    current = {
      trail_id: trail.id,
      trail_name: trail.name,
      difficulty: trail.difficulty || 'intermediate',
      started_at: pt.t || now(),
      ended_at: null,
      entered_from: from,
      saw_start: dA <= END_M,
      saw_end: dB <= END_M,
      t_start_end: dA <= END_M ? (pt.t || now()) : null,
      t_finish_end: dB <= END_M ? (pt.t || now()) : null,
      distance_m: 0,
      max_speed_kmh: 0,
      moving_ms: 0,
      last_pt: pt,
      end_to_end: false
    };
    lastPt = pt;
    enterHits = 0;
    leaveHits = 0;
    switchHits = 0;
    pendingTrailId = null;
  }

  function updateSplit(trail, pt) {
    if (!current) return;
    var prev = current.last_pt || lastPt;
    if (prev) {
      var d = haversineM(prev, pt);
      current.distance_m += d;
      var sp = speedKmh(prev, pt);
      if (sp >= 1.2 && sp <= MAX_SPEED_KMH) {
        current.moving_ms += Math.max(0, (pt.t || now()) - prev.t);
        if (sp > current.max_speed_kmh) current.max_speed_kmh = sp;
      }
    }
    var dA = haversineM(pt, trail.start);
    var dB = haversineM(pt, trail.end);
    if (dA <= END_M) {
      current.saw_start = true;
      if (!current.t_start_end) current.t_start_end = pt.t || now();
    }
    if (dB <= END_M) {
      current.saw_end = true;
      if (!current.t_finish_end) current.t_finish_end = pt.t || now();
    }
    current.end_to_end = !!(current.saw_start && current.saw_end);
    current.last_pt = pt;
    lastPt = pt;
  }

  function closeSplit(reason, pt) {
    if (!current) return null;
    current.ended_at = (pt && pt.t) || now();
    current.left_reason = reason || 'left';
    var elapsed = Math.max(0, Math.floor((current.ended_at - current.started_at) / 1000));
    var moving = Math.max(0, Math.floor((current.moving_ms || 0) / 1000));
    if (current.end_to_end && current.t_start_end && current.t_finish_end) {
      elapsed = Math.max(1, Math.floor(Math.abs(current.t_finish_end - current.t_start_end) / 1000));
    }
    var km = (current.distance_m || 0) / 1000;
    var rec = {
      trail_id: current.trail_id,
      trail_name: current.trail_name,
      difficulty: current.difficulty || 'intermediate',
      started_at: new Date(current.started_at).toISOString(),
      ended_at: new Date(current.ended_at).toISOString(),
      elapsed_sec: elapsed,
      moving_sec: moving || elapsed,
      distance_km: Math.round(km * 100) / 100,
      avg_speed_kmh: moving > 0 ? Math.round((km / (moving / 3600)) * 10) / 10 : 0,
      max_speed_kmh: Math.round((current.max_speed_kmh || 0) * 10) / 10,
      entered_from: current.entered_from,
      end_to_end: !!current.end_to_end,
      saw_start: !!current.saw_start,
      saw_end: !!current.saw_end
    };
    var keep = rec.end_to_end || rec.distance_km * 1000 >= MIN_SPLIT_M || rec.elapsed_sec >= MIN_SPLIT_SEC;
    current = null;
    lastPt = pt || lastPt;
    leaveHits = 0;
    switchHits = 0;
    pendingTrailId = null;
    if (keep) {
      completed.push(rec);
      return rec;
    }
    return null;
  }

  function onPoint(pt) {
    if (!pt || typeof pt.lat !== 'number' || !network.length) return getSnapshot();
    if (!pt.t) pt.t = now();

    var near = nearestTrail(pt);
    var curTrail = current ? findTrail(current.trail_id) : null;
    var curDist = curTrail ? distToTrail(pt, curTrail) : Infinity;

    if (current && curTrail) {
      var atEnd = haversineM(pt, curTrail.start) <= END_M || haversineM(pt, curTrail.end) <= END_M;
      if (atEnd) {
        var hop = junctionTrail(pt, current.trail_id);
        if (hop) {
          closeSplit('switch', pt);
          openSplit(hop.trail, pt, hop.dist);
          return getSnapshot();
        }
      }
      var other = near && near.trail.id !== current.trail_id ? near : null;
      if (other && other.dist + SWITCH_CLOSER_M < curDist && other.dist <= MATCH_ON_M) {
        if (pendingTrailId === other.trail.id) switchHits += 1;
        else { pendingTrailId = other.trail.id; switchHits = 1; }
        if (switchHits >= SWITCH_HITS) {
          closeSplit('switch', pt);
          openSplit(other.trail, pt, other.dist);
          return getSnapshot();
        }
      } else {
        switchHits = 0;
        pendingTrailId = null;
      }

      if (curDist <= MATCH_OFF_M) {
        leaveHits = 0;
        updateSplit(curTrail, pt);
        return getSnapshot();
      }
      leaveHits += 1;
      if (leaveHits >= LEAVE_HITS) {
        closeSplit('left', pt);
      } else {
        updateSplit(curTrail, pt);
      }
      return getSnapshot();
    }

    if (near && near.dist <= MATCH_ON_M) {
      if (pendingTrailId === near.trail.id) enterHits += 1;
      else { pendingTrailId = near.trail.id; enterHits = 1; }
      if (enterHits >= ENTER_HITS) {
        openSplit(near.trail, pt, near.dist);
      }
    } else {
      enterHits = 0;
      pendingTrailId = null;
    }
    lastPt = pt;
    return getSnapshot();
  }

  function getSnapshot() {
    var live = null;
    if (current) {
      var elapsed = Math.max(0, Math.floor((((lastPt && lastPt.t) || now()) - current.started_at) / 1000));
      if (current.end_to_end && current.t_start_end && current.t_finish_end) {
        elapsed = Math.max(1, Math.floor(Math.abs(current.t_finish_end - current.t_start_end) / 1000));
      }
      live = {
        trail_id: current.trail_id,
        trail_name: current.trail_name,
        entered_from: current.entered_from,
        end_to_end: !!current.end_to_end,
        saw_start: !!current.saw_start,
        saw_end: !!current.saw_end,
        elapsed_sec: elapsed,
        distance_km: Math.round((current.distance_m || 0) / 10) / 100,
        max_speed_kmh: Math.round((current.max_speed_kmh || 0) * 10) / 10
      };
    }
    return {
      current: live,
      splits: completed.slice(),
      ready: network.length > 0
    };
  }

  function finalize(pt) {
    if (current) closeSplit('stop', pt || lastPt);
    return getSnapshot();
  }

  function reset() {
    current = null;
    completed = [];
    enterHits = 0;
    leaveHits = 0;
    switchHits = 0;
    pendingTrailId = null;
    lastPt = null;
  }

  function serialize() {
    return {
      current: current,
      completed: completed,
      enterHits: enterHits,
      leaveHits: leaveHits,
      switchHits: switchHits,
      pendingTrailId: pendingTrailId,
      lastPt: lastPt
    };
  }

  function restore(data) {
    if (!data) return;
    current = data.current || null;
    completed = data.completed || [];
    enterHits = data.enterHits || 0;
    leaveHits = data.leaveHits || 0;
    switchHits = data.switchHits || 0;
    pendingTrailId = data.pendingTrailId || null;
    lastPt = data.lastPt || null;
  }

  global.TrailSplits = {
    setNetwork: setNetwork,
    onPoint: onPoint,
    getSnapshot: getSnapshot,
    finalize: finalize,
    reset: reset,
    serialize: serialize,
    restore: restore
  };
})(typeof window !== 'undefined' ? window : this);
