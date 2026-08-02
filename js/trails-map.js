// SB Racing — Leaflet trails: green/blue/black, start + checkpoints routing, save

var map, trailLayer, routeLine, routeMarkers = [];
var routeMode = false;
var snapEnabled = true;
var trailSegments = [];
var trailFeatures = []; // {id, name, difficulty, latlngs}
var SNAP_MAX_M = 80;

/** Ordered route points: first = start, rest = checkpoints / end */
var routePoints = [];

var gpsWatchId = null;
var gpsMarker = null;
var gpsAccuracyCircle = null;
var gpsTrackLine = null;
var gpsTrackPoints = [];
var gpsFollow = true;


var AREAS = {
  hat: { center: [50.04, -110.68], zoom: 12 },
  redcliff: { center: [50.08, -110.80], zoom: 12 },
  elkwater: { center: [49.66, -110.29], zoom: 13 },
  cypress: { center: [49.65, -110.26], zoom: 12 }
};

function normalizeDifficulty(raw) {
  var s = String(raw || '').toLowerCase().trim();
  if (!s) return 'intermediate';
  if (/easy|beginner|green|novice|^\s*1\s*$|^\s*0\s*$|white/.test(s)) return 'easy';
  if (/advanced|difficult|hard|black|expert|severe|double|^\s*[45]\s*$|^\s*6\s*$/.test(s)) return 'advanced';
  if (/intermediate|moderate|blue|^\s*2\s*$|^\s*3\s*$/.test(s)) return 'intermediate';
  if (s === 'black' || s === 'double black') return 'advanced';
  if (s === 'blue') return 'intermediate';
  if (s === 'green') return 'easy';
  return 'intermediate';
}

function diffColor(d) {
  var n = normalizeDifficulty(d);
  if (n === 'easy') return '#22c55e';
  if (n === 'advanced') return '#0a0a0a';
  return '#3b82f6';
}

function diffLabel(d) {
  var n = normalizeDifficulty(d);
  if (n === 'easy') return 'Easy';
  if (n === 'advanced') return 'Advanced';
  return 'Intermediate';
}

function haversineKm(a, b) {
  var R = 6371;
  var toRad = Math.PI / 180;
  var dLat = (b[0] - a[0]) * toRad;
  var dLon = (b[1] - a[1]) * toRad;
  var lat1 = a[0] * toRad, lat2 = b[0] * toRad;
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function haversineM(a, b) {
  return haversineKm(a, b) * 1000;
}

function closestOnSegment(p, a, b) {
  var toRad = Math.PI / 180;
  var cosLat = Math.cos(p[0] * toRad) || 1e-6;
  var ax = (a[1] - p[1]) * cosLat, ay = a[0] - p[0];
  var bx = (b[1] - p[1]) * cosLat, by = b[0] - p[0];
  var abx = bx - ax, aby = by - ay;
  var apx = -ax, apy = -ay;
  var ab2 = abx * abx + aby * aby;
  var t = ab2 < 1e-18 ? 0 : (apx * abx + apy * aby) / ab2;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  var lat = p[0] + (ay + t * aby);
  var lng = p[1] + (ax + t * abx) / cosLat;
  var pt = [lat, lng];
  return { point: pt, distM: haversineM(p, pt), t: t };
}

function densifyLine(coords, maxStepDeg) {
  maxStepDeg = maxStepDeg || 0.00025;
  var out = [];
  for (var i = 0; i < coords.length; i++) {
    var c = coords[i];
    var latlng = [c[1], c[0]];
    if (!out.length) { out.push(latlng); continue; }
    var prev = out[out.length - 1];
    var dlat = latlng[0] - prev[0];
    var dlng = latlng[1] - prev[1];
    var steps = Math.ceil(Math.max(Math.abs(dlat), Math.abs(dlng)) / maxStepDeg) || 1;
    for (var s = 1; s <= steps; s++) {
      out.push([prev[0] + (dlat * s) / steps, prev[1] + (dlng * s) / steps]);
    }
  }
  return out;
}

function geometryToLatLngs(geom) {
  if (!geom) return [];
  if (geom.type === 'LineString') {
    return densifyLine(geom.coordinates);
  }
  if (geom.type === 'MultiLineString' && geom.coordinates.length) {
    var all = [];
    geom.coordinates.forEach(function (line) {
      densifyLine(line).forEach(function (ll) { all.push(ll); });
    });
    return all;
  }
  return [];
}

function buildSnapNetwork(geojson) {
  trailSegments = [];
  trailFeatures = [];
  if (!geojson || !geojson.features) return;
  geojson.features.forEach(function (f, idx) {
    if (!f.geometry) return;
    var latlngs = geometryToLatLngs(f.geometry);
    if (latlngs.length < 2) return;
    var id = (f.id != null) ? String(f.id)
      : (f.properties && f.properties.id != null) ? String(f.properties.id)
      : 'idx:' + idx;
    var name = (f.properties && (f.properties.name || f.properties.Name)) || ('Trail ' + (idx + 1));
    var difficulty = normalizeDifficulty(f.properties && (f.properties.difficulty || f.properties.Difficulty || f.properties.rating));
    trailFeatures.push({ id: id, name: name, difficulty: difficulty, latlngs: latlngs, feature: f, index: idx });
    for (var i = 1; i < latlngs.length; i++) {
      trailSegments.push({ a: latlngs[i - 1], b: latlngs[i], trailId: id });
    }
  });
  console.log('[trails] features:', trailFeatures.length, 'segments:', trailSegments.length);
}

/** Snap click → point + optional trail id + vertex index */
function snapToTrails(latlng) {
  var p = [latlng.lat, latlng.lng];
  if (!snapEnabled || !trailSegments.length) {
    return { lat: p[0], lng: p[1], snapped: false, trailId: null, vertexIndex: null };
  }
  var best = null;
  var bestTrailId = null;
  for (var i = 0; i < trailSegments.length; i++) {
    var seg = trailSegments[i];
    var r = closestOnSegment(p, seg.a, seg.b);
    if (!best || r.distM < best.distM) {
      best = r;
      bestTrailId = seg.trailId;
    }
  }
  if (best && best.distM <= SNAP_MAX_M) {
    var trail = trailFeatures.find(function (tf) { return tf.id === bestTrailId; });
    var vIdx = 0;
    if (trail) {
      var nv = nearestVertexIndex(trail.latlngs, best.point);
      vIdx = nv.index;
    }
    return {
      lat: best.point[0],
      lng: best.point[1],
      snapped: true,
      trailId: bestTrailId,
      vertexIndex: vIdx,
      distM: best.distM
    };
  }
  return { lat: p[0], lng: p[1], snapped: false, trailId: null, vertexIndex: null, distM: best ? best.distM : null };
}

function nearestVertexIndex(latlngs, point) {
  var bestI = 0, bestD = Infinity;
  for (var i = 0; i < latlngs.length; i++) {
    var d = haversineM(point, latlngs[i]);
    if (d < bestD) { bestD = d; bestI = i; }
  }
  return { index: bestI, distM: bestD };
}

/** Subpath along a single trail between two vertex indices (inclusive) */
function subpathAlongTrail(trailId, i0, i1) {
  var trail = trailFeatures.find(function (tf) { return tf.id === trailId; });
  if (!trail) return null;
  var a = Math.min(i0, i1), b = Math.max(i0, i1);
  var slice = trail.latlngs.slice(a, b + 1);
  if (i0 > i1) slice = slice.reverse();
  return slice.length >= 2 ? slice : null;
}

/** Build full polyline from routePoints (follow trail between pts when same trail) */
function buildRouteLatLngs() {
  if (!routePoints.length) return [];
  if (routePoints.length === 1) return [[routePoints[0].lat, routePoints[0].lng]];

  var out = [];
  for (var i = 0; i < routePoints.length; i++) {
    var pt = routePoints[i];
    var ll = [pt.lat, pt.lng];
    if (i === 0) {
      out.push(ll);
      continue;
    }
    var prev = routePoints[i - 1];
    // Same trail → only the section between the two points
    if (prev.trailId && pt.trailId && prev.trailId === pt.trailId &&
        prev.vertexIndex != null && pt.vertexIndex != null) {
      var along = subpathAlongTrail(pt.trailId, prev.vertexIndex, pt.vertexIndex);
      if (along && along.length) {
        along.forEach(function (p, j) {
          if (j === 0 && out.length && haversineM(out[out.length - 1], p) < 8) return;
          out.push(p);
        });
        continue;
      }
    }
    // Different trails / free points → straight connector (hop)
    if (out.length && haversineM(out[out.length - 1], ll) < 8) continue;
    out.push(ll);
  }
  return out;
}

function routeDistanceKm() {
  var line = buildRouteLatLngs();
  var d = 0;
  for (var i = 1; i < line.length; i++) d += haversineKm(line[i - 1], line[i]);
  return d;
}

function updateRouteUI() {
  var el = document.getElementById('route-distance');
  var pts = document.getElementById('route-points');
  if (el) el.textContent = routeDistanceKm().toFixed(1) + ' km';
  if (pts) {
    if (!routePoints.length) pts.textContent = 'No start point yet';
    else if (routePoints.length === 1) pts.textContent = 'Start set · add checkpoints';
    else pts.textContent = 'Start + ' + (routePoints.length - 1) + ' checkpoint' + (routePoints.length === 2 ? '' : 's');
  }

  routeMarkers.forEach(function (m) { map.removeLayer(m); });
  routeMarkers = [];
  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }

  var line = buildRouteLatLngs();
  if (line.length >= 2) {
    routeLine = L.polyline(line, { color: '#f97316', weight: 4, opacity: 0.95 }).addTo(map);
  }

  routePoints.forEach(function (pt, i) {
    var isStart = i === 0;
    var isEnd = i === routePoints.length - 1 && i > 0;
    var marker = L.circleMarker([pt.lat, pt.lng], {
      radius: isStart ? 9 : 7,
      color: '#fff',
      weight: 2,
      fillColor: isStart ? '#22c55e' : (isEnd ? '#f97316' : '#3b82f6'),
      fillOpacity: 1
    }).addTo(map);
    var label = isStart ? 'Start' : (isEnd && routePoints.length > 2 ? 'End' : ('CP ' + i));
    marker.bindTooltip(label, { direction: 'top', permanent: false });
    routeMarkers.push(marker);
  });

  updateSelectedList();
}

function updateSelectedList() {
  var el = document.getElementById('selected-trails-list');
  if (!el) return;
  if (!routePoints.length) {
    el.innerHTML = '<p class="text-xs text-zinc-500">Click the map or a trail to set <strong class="text-zinc-300">Start</strong>, then add checkpoints. Only the section between points is used — not the whole trail.</p>';
    return;
  }
  el.innerHTML = routePoints.map(function (pt, i) {
    var label = i === 0 ? 'Start' : ('Checkpoint ' + i);
    var trail = pt.trailId ? trailFeatures.find(function (tf) { return tf.id === pt.trailId; }) : null;
    var extra = trail ? escapeHtmlTrail(trail.name) : (pt.snapped ? 'on trail' : 'off-trail');
    return '<div class="flex items-center gap-2 text-sm py-1.5 border-b border-zinc-800 last:border-0">' +
      '<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:' + (i === 0 ? '#22c55e' : '#3b82f6') + '"></span>' +
      '<span class="flex-1 min-w-0"><span class="font-medium">' + label + '</span>' +
      '<span class="text-xs text-zinc-500 block truncate">' + extra + '</span></span></div>';
  }).join('');
}

function toggleRouteMode() {
  routeMode = !routeMode;
  var btn = document.getElementById('btn-route-mode');
  if (btn) {
    btn.textContent = routeMode ? 'Picking points…' : 'Build route';
    btn.classList.toggle('bg-emerald-600', routeMode);
    btn.classList.toggle('bg-orange-600', !routeMode);
  }
  if (map) map.getContainer().style.cursor = routeMode ? 'crosshair' : '';
  showToast(routeMode
    ? (routePoints.length ? 'Click to add a checkpoint' : 'Click to set the START point')
    : 'Route mode off');
}

function toggleSnap() {
  snapEnabled = !snapEnabled;
  var btn = document.getElementById('btn-snap-toggle');
  if (btn) {
    btn.textContent = snapEnabled ? 'Snap: ON' : 'Snap: OFF';
    btn.classList.toggle('border-emerald-600', snapEnabled);
    btn.classList.toggle('text-emerald-400', snapEnabled);
  }
  showToast(snapEnabled ? 'Snap to trails on' : 'Free placement');
}

function clearRoute() {
  routePoints = [];
  updateRouteUI();
  showToast('Route cleared');
}

function undoWaypoint() {
  if (!routePoints.length) return;
  var removed = routePoints.pop();
  updateRouteUI();
  showToast(routePoints.length === 0 ? 'Start cleared' : 'Removed last point');
}

function addRoutePoint(latlng, opts) {
  opts = opts || {};
  var snapped = opts.skipSnap
    ? { lat: latlng.lat, lng: latlng.lng, snapped: false, trailId: null, vertexIndex: null }
    : snapToTrails(latlng);

  // Optional: require snap when enabled and near trails
  // Allow off-trail for true hops between networks
  var pt = {
    lat: snapped.lat,
    lng: snapped.lng,
    snapped: !!snapped.snapped,
    trailId: snapped.trailId || null,
    vertexIndex: snapped.vertexIndex != null ? snapped.vertexIndex : null
  };

  // Avoid stacking duplicates
  if (routePoints.length) {
    var last = routePoints[routePoints.length - 1];
    if (haversineM([last.lat, last.lng], [pt.lat, pt.lng]) < 5) return;
  }

  routePoints.push(pt);
  updateRouteUI();

  if (routePoints.length === 1) {
    showToast('Start set' + (pt.snapped ? ' (on trail)' : '') + ' · click checkpoints next');
  } else {
    showToast('Checkpoint ' + (routePoints.length - 1) + ' added');
  }
}

/** Trail click: use as start/checkpoint at that location — NOT the whole trail */
function onTrailClick(feature, idx, latlng) {
  if (!routeMode) return;
  addRoutePoint(latlng || L.latLng(0, 0), {});
}

function flyTo(key) {
  var a = AREAS[key];
  if (a && map) map.flyTo(a.center, a.zoom, { duration: 1.2 });
}


async function initMap() {
  map = L.map('trail-map', { scrollWheelZoom: true }).setView(AREAS.hat.center, 11);

  var streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  });

  var satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    }
  );

  var satLabels = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, opacity: 0.85, attribution: 'Labels &copy; Esri' }
  );

  var satelliteGroup = L.layerGroup([satellite, satLabels]);
  streets.addTo(map);

  L.control.layers(
    { 'Street map': streets, 'Satellite': satelliteGroup },
    null,
    { position: 'topright', collapsed: false }
  ).addTo(map);

  try {
    var res = await fetch('assets/trails/region.geojson');
    var geo = await res.json();
    buildSnapNetwork(geo);

    var idx = 0;
    trailLayer = L.geoJSON(geo, {
      style: function (f) {
        var col = diffColor(f.properties && (f.properties.difficulty || f.properties.Difficulty || f.properties.rating));
        return { color: col, weight: 5, opacity: 0.9 };
      },
      onEachFeature: function (f, layer) {
        var i = idx++;
        var p = f.properties || {};
        var name = p.name || p.Name || 'Trail';
        var col = diffColor(p.difficulty || p.Difficulty || p.rating);
        var diff = diffLabel(p.difficulty || p.Difficulty || p.rating);
        var area = p.area ? ' · ' + escapeHtmlTrail(p.area) : '';
        var baseWeight = 5;

        layer.bindPopup(
          '<strong>' + escapeHtmlTrail(name) + '</strong><br>' +
          '<span style="color:' + col + '">' + diff + '</span>' + area +
          '<br><span style="font-size:11px;opacity:.8">In Build route mode, click the trail to set start / checkpoint here</span>'
        );

        layer.on('click', function (e) {
          if (!routeMode) return;
          L.DomEvent.stopPropagation(e);
          addRoutePoint(e.latlng);
        });
      }
    }).addTo(map);

    try {
      map.fitBounds(trailLayer.getBounds(), { padding: [30, 30], maxZoom: 13 });
    } catch (e) {}

  } catch (e) {
    console.warn('[trails] geojson', e);
    showToast('Could not load region.geojson', true);
  }

  map.on('click', function (e) {
    if (!routeMode) return;
    addRoutePoint(e.latlng);
  });

  updateSaveHint();
  updateSelectedList();
  loadMyRoutes();
}

async function updateSaveHint() {
  var hint = document.getElementById('save-route-hint');
  var user = null;
  try {
    if (typeof getCurrentUser === 'function') user = await getCurrentUser();
  } catch (e) {}
  if (hint) {
    hint.textContent = user
      ? 'Saving as ' + (user.email || 'member')
      : 'Log in on Members to save routes.';
  }
}

async function saveRoute() {
  var line = buildRouteLatLngs();
  if (line.length < 2) {
    showToast('Set a start and at least one more point', true);
    return;
  }
  var user = null;
  try { user = await getCurrentUser(); } catch (e) {}
  if (!user) {
    showToast('Log in to save routes', true);
    return;
  }
  var name = ((document.getElementById('route-name') || {}).value || '').trim();
  if (!name) {
    showToast('Name your route', true);
    return;
  }
  var description = ((document.getElementById('route-desc') || {}).value || '').trim() || null;
  var is_public = !!(document.getElementById('route-public') || {}).checked;
  var geojson = {
    type: 'Feature',
    properties: {
      name: name,
      pointCount: routePoints.length,
      points: routePoints.map(function (pt, i) {
        return {
          role: i === 0 ? 'start' : 'checkpoint',
          lat: pt.lat,
          lng: pt.lng,
          trailId: pt.trailId
        };
      })
    },
    geometry: {
      type: 'LineString',
      coordinates: line.map(function (w) { return [w[1], w[0]]; })
    }
  };
  try {
    var result = await window.sb.from('member_routes').insert({
      user_id: user.id,
      name: name,
      description: description,
      distance_km: Math.round(routeDistanceKm() * 100) / 100,
      geojson: geojson,
      is_public: is_public
    });
    if (result.error) throw result.error;
    showToast('Route saved');
    loadMyRoutes();
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Save failed — run member_routes.sql?', true);
  }
}

async function loadMyRoutes() {
  var list = document.getElementById('saved-routes-list');
  if (!list) return;
  var user = null;
  try { user = await getCurrentUser(); } catch (e) {}
  if (!user) {
    list.innerHTML = '<p class="text-zinc-500 text-sm">Sign in to see saved routes.</p>';
    return;
  }
  list.innerHTML = '<p class="text-zinc-500 text-sm">Loading…</p>';
  try {
    var result = await window.sb
      .from('member_routes')
      .select('id, name, distance_km, description, created_at, geojson')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (result.error) throw result.error;
    var data = result.data;
    if (!data || !data.length) {
      list.innerHTML = '<p class="text-zinc-500 text-sm">No saved routes yet.</p>';
      return;
    }
    list.innerHTML = data.map(function (r) {
      return '<div class="flex items-center gap-2 p-3 rounded-2xl bg-zinc-950 border border-zinc-800">' +
        '<div class="flex-1 min-w-0">' +
        '<div class="font-medium truncate">' + escapeHtmlTrail(r.name) + '</div>' +
        '<div class="text-xs text-zinc-500">' + (r.distance_km != null ? r.distance_km + ' km' : '') + '</div></div>' +
        '<button type="button" class="text-xs px-2 py-1 rounded-lg border border-zinc-600 hover:bg-zinc-800" data-load="' + r.id + '">Load</button>' +
        '<button type="button" class="text-xs px-2 py-1 rounded-lg border border-red-900 text-red-400" data-del="' + r.id + '">Del</button>' +
        '</div>';
    }).join('');
    list.querySelectorAll('[data-load]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = parseInt(btn.getAttribute('data-load'), 10);
        var row = data.find(function (x) { return x.id === id; });
        if (row) showSavedRoute(row);
      });
    });
    list.querySelectorAll('[data-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        deleteRoute(parseInt(btn.getAttribute('data-del'), 10));
      });
    });
  } catch (e) {
    list.innerHTML = '<p class="text-red-400 text-sm">' + escapeHtmlTrail(e.message || 'Could not load') + '</p>';
  }
}

function showSavedRoute(row) {
  clearRoute();
  var coords = row.geojson && row.geojson.geometry && row.geojson.geometry.coordinates;
  var pts = row.geojson && row.geojson.properties && row.geojson.properties.points;
  if (pts && pts.length) {
    pts.forEach(function (p) {
      addRoutePoint({ lat: p.lat, lng: p.lng }, { skipSnap: true });
    });
  } else if (coords && coords.length) {
    // Legacy full line — use endpoints + mid samples as points
    addRoutePoint({ lat: coords[0][1], lng: coords[0][0] }, { skipSnap: true });
    if (coords.length > 2) {
      var mid = coords[Math.floor(coords.length / 2)];
      addRoutePoint({ lat: mid[1], lng: mid[0] }, { skipSnap: true });
    }
    var last = coords[coords.length - 1];
    addRoutePoint({ lat: last[1], lng: last[0] }, { skipSnap: true });
  }
  if (routeLine) map.fitBounds(routeLine.getBounds(), { padding: [40, 40] });
  var nameEl = document.getElementById('route-name');
  if (nameEl) nameEl.value = row.name || '';
  showToast('Loaded: ' + row.name);
}

async function deleteRoute(id) {
  if (!confirm('Delete this route?')) return;
  try {
    var result = await window.sb.from('member_routes').delete().eq('id', id);
    if (result.error) throw result.error;
    showToast('Deleted');
    loadMyRoutes();
  } catch (e) {
    showToast(e.message || 'Delete failed', true);
  }
}


// ---------- Live GPS tracking ----------
function isGpsTracking() {
  return gpsWatchId != null;
}

function updateGpsButton() {
  var btn = document.getElementById('btn-gps-track');
  if (!btn) return;
  if (isGpsTracking()) {
    btn.textContent = 'Stop GPS';
    btn.classList.remove('bg-emerald-600', 'border-zinc-600');
    btn.classList.add('bg-red-600', 'hover:bg-red-700');
  } else {
    btn.textContent = 'Track GPS';
    btn.classList.remove('bg-red-600', 'hover:bg-red-700');
    btn.classList.add('border-zinc-600');
  }
  var followBtn = document.getElementById('btn-gps-follow');
  if (followBtn) {
    followBtn.classList.toggle('hidden', !isGpsTracking());
    followBtn.textContent = gpsFollow ? 'Follow: ON' : 'Follow: OFF';
  }
  var useBtn = document.getElementById('btn-gps-use-track');
  if (useBtn) useBtn.classList.toggle('hidden', !gpsTrackPoints.length);
}

function toggleGpsFollow() {
  gpsFollow = !gpsFollow;
  updateGpsButton();
  showToast(gpsFollow ? 'Map follows you' : 'Follow off');
}

function onGpsPosition(pos) {
  if (!map) return;
  var lat = pos.coords.latitude;
  var lng = pos.coords.longitude;
  var acc = pos.coords.accuracy || 30;
  var ll = L.latLng(lat, lng);

  if (!gpsMarker) {
    gpsMarker = L.circleMarker(ll, {
      radius: 8,
      color: '#fff',
      weight: 3,
      fillColor: '#3b82f6',
      fillOpacity: 1
    }).addTo(map);
    gpsMarker.bindTooltip('You', { direction: 'top' });
  } else {
    gpsMarker.setLatLng(ll);
  }

  if (!gpsAccuracyCircle) {
    gpsAccuracyCircle = L.circle(ll, {
      radius: acc,
      color: '#3b82f6',
      weight: 1,
      opacity: 0.4,
      fillColor: '#3b82f6',
      fillOpacity: 0.1
    }).addTo(map);
  } else {
    gpsAccuracyCircle.setLatLng(ll);
    gpsAccuracyCircle.setRadius(acc);
  }

  // Record track (min ~5 m between points)
  var pt = [lat, lng];
  if (!gpsTrackPoints.length || haversineM(gpsTrackPoints[gpsTrackPoints.length - 1], pt) >= 5) {
    gpsTrackPoints.push(pt);
    if (gpsTrackLine) {
      gpsTrackLine.addLatLng(ll);
    } else if (gpsTrackPoints.length >= 2) {
      gpsTrackLine = L.polyline(gpsTrackPoints, {
        color: '#60a5fa',
        weight: 4,
        opacity: 0.85,
        dashArray: '6 8'
      }).addTo(map);
    }
  }

  if (gpsFollow) {
    map.panTo(ll, { animate: true, duration: 0.4 });
  }
  updateGpsButton();
}

function onGpsError(err) {
  var msg = 'GPS error';
  if (err && err.code === 1) msg = 'Location permission denied';
  else if (err && err.code === 2) msg = 'Position unavailable';
  else if (err && err.code === 3) msg = 'GPS timed out';
  else if (err && err.message) msg = err.message;
  showToast(msg, true);
  stopGpsTracking();
}

function startGpsTracking() {
  if (!navigator.geolocation) {
    showToast('GPS not supported in this browser', true);
    return;
  }
  // Secure context required (https or localhost)
  if (typeof window.isSecureContext === 'boolean' && !window.isSecureContext) {
    showToast('GPS needs HTTPS (or localhost)', true);
    return;
  }
  gpsTrackPoints = [];
  if (gpsTrackLine) { map.removeLayer(gpsTrackLine); gpsTrackLine = null; }

  gpsWatchId = navigator.geolocation.watchPosition(onGpsPosition, onGpsError, {
    enableHighAccuracy: true,
    maximumAge: 2000,
    timeout: 15000
  });
  updateGpsButton();
  showToast('GPS tracking on — ride safe');
}

function stopGpsTracking() {
  if (gpsWatchId != null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  updateGpsButton();
  showToast('GPS tracking stopped');
}

function toggleGpsTracking() {
  if (isGpsTracking()) stopGpsTracking();
  else startGpsTracking();
}

/** Turn recorded GPS track into start + checkpoints on the route builder */
function useGpsTrackAsRoute() {
  if (gpsTrackPoints.length < 2) {
    showToast('Not enough GPS points yet', true);
    return;
  }
  routePoints = [];
  // Start
  var first = gpsTrackPoints[0];
  addRoutePoint({ lat: first[0], lng: first[1] }, { skipSnap: false });
  // Sample checkpoints along the track (~every 200m or key points)
  var acc = 0;
  var last = first;
  for (var i = 1; i < gpsTrackPoints.length - 1; i++) {
    acc += haversineM(last, gpsTrackPoints[i]);
    last = gpsTrackPoints[i];
    if (acc >= 200) {
      addRoutePoint({ lat: last[0], lng: last[1] }, { skipSnap: false });
      acc = 0;
    }
  }
  var end = gpsTrackPoints[gpsTrackPoints.length - 1];
  addRoutePoint({ lat: end[0], lng: end[1] }, { skipSnap: false });
  if (gpsTrackLine) map.fitBounds(gpsTrackLine.getBounds(), { padding: [40, 40] });
  showToast('GPS track applied to route — save if you want');
}

function clearGpsTrack() {
  gpsTrackPoints = [];
  if (gpsTrackLine) { map.removeLayer(gpsTrackLine); gpsTrackLine = null; }
  updateGpsButton();
}


function escapeHtmlTrail(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

document.addEventListener('DOMContentLoaded', function () {
  initMap();
});
