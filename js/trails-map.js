// SB Racing — Leaflet trails: green/blue/black, click-trail routing, save

var map, trailLayer, routeLine, routeMarkers = [];
var waypoints = [];
var routeMode = false;
var snapEnabled = true;
var trailSegments = [];
var SNAP_MAX_M = 80;
/** Ordered list of selected trail features for the current route */
var selectedTrails = [];
/** layer <-> feature id for highlight */
var trailLayerById = {};

var AREAS = {
  hat: { center: [50.04, -110.68], zoom: 12 },
  redcliff: { center: [50.08, -110.80], zoom: 12 },
  elkwater: { center: [49.66, -110.29], zoom: 13 },
  cypress: { center: [49.65, -110.26], zoom: 12 }
};

/** Normalize difficulty from many GeoJSON styles → easy | intermediate | advanced */
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

/** Classic trail colors: green / blue / black */
function diffColor(d) {
  var n = normalizeDifficulty(d);
  if (n === 'easy') return '#22c55e';       // green
  if (n === 'advanced') return '#0a0a0a';   // black
  return '#3b82f6';                        // blue intermediate
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
  var cosLat = Math.cos(p[0] * toRad);
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

function snapToTrails(latlng) {
  var p = [latlng.lat, latlng.lng];
  if (!snapEnabled || !trailSegments.length) {
    return { lat: p[0], lng: p[1], snapped: false, distM: null };
  }
  var best = null;
  for (var i = 0; i < trailSegments.length; i++) {
    var seg = trailSegments[i];
    var r = closestOnSegment(p, seg.a, seg.b);
    if (!best || r.distM < best.distM) best = r;
  }
  if (best && best.distM <= SNAP_MAX_M) {
    return { lat: best.point[0], lng: best.point[1], snapped: true, distM: best.distM };
  }
  return { lat: p[0], lng: p[1], snapped: false, distM: best ? best.distM : null };
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

function ingestTrailGeometry(geom) {
  if (!geom) return;
  if (geom.type === 'LineString') {
    var densified = densifyLine(geom.coordinates);
    for (var i = 1; i < densified.length; i++) {
      trailSegments.push({ a: densified[i - 1], b: densified[i] });
    }
  } else if (geom.type === 'MultiLineString') {
    geom.coordinates.forEach(function (line) {
      ingestTrailGeometry({ type: 'LineString', coordinates: line });
    });
  } else if (geom.type === 'GeometryCollection' && geom.geometries) {
    geom.geometries.forEach(ingestTrailGeometry);
  }
}

function buildSnapNetwork(geojson) {
  trailSegments = [];
  if (!geojson || !geojson.features) return;
  geojson.features.forEach(function (f) {
    if (f.geometry) ingestTrailGeometry(f.geometry);
  });
  console.log('[trails] snap segments:', trailSegments.length);
}

/** LineString / MultiLineString → [lat,lng][] path (first line only for Multi) */
function geometryToLatLngs(geom) {
  if (!geom) return [];
  if (geom.type === 'LineString') {
    return geom.coordinates.map(function (c) { return [c[1], c[0]]; });
  }
  if (geom.type === 'MultiLineString' && geom.coordinates.length) {
    // concatenate all parts
    var all = [];
    geom.coordinates.forEach(function (line) {
      line.forEach(function (c) { all.push([c[1], c[0]]); });
    });
    return all;
  }
  return [];
}

function pathLengthKm(latlngs) {
  var d = 0;
  for (var i = 1; i < latlngs.length; i++) d += haversineKm(latlngs[i - 1], latlngs[i]);
  return d;
}

/** Prefer direction that continues from last waypoint */
function orientPath(latlngs) {
  if (!waypoints.length || latlngs.length < 2) return latlngs.slice();
  var last = waypoints[waypoints.length - 1];
  var dStart = haversineM(last, latlngs[0]);
  var dEnd = haversineM(last, latlngs[latlngs.length - 1]);
  if (dEnd < dStart) return latlngs.slice().reverse();
  return latlngs.slice();
}

function featureId(f, idx) {
  if (f.id != null) return String(f.id);
  if (f.properties && f.properties.id != null) return String(f.properties.id);
  if (f.properties && f.properties.name) return 'n:' + f.properties.name + ':' + idx;
  return 'idx:' + idx;
}

function isTrailSelected(id) {
  return selectedTrails.some(function (t) { return t.id === id; });
}

function restyleTrailLayer(id) {
  var layer = trailLayerById[id];
  if (!layer) return;
  var selected = isTrailSelected(id);
  var base = layer.options._baseColor || '#3b82f6';
  layer.setStyle({
    color: selected ? '#f97316' : base,
    weight: selected ? 7 : 5,
    opacity: selected ? 1 : 0.9
  });
  if (selected) layer.bringToFront();
}

function rebuildWaypointsFromSelection() {
  waypoints = [];
  routeMarkers.forEach(function (m) { map.removeLayer(m); });
  routeMarkers = [];
  selectedTrails.forEach(function (t, ti) {
    var path = orientPath(t.latlngs);
    // If continuing, skip duplicate join point
    path.forEach(function (ll, i) {
      if (waypoints.length && i === 0) {
        var last = waypoints[waypoints.length - 1];
        if (haversineM(last, ll) < 15) return;
      }
      waypoints.push(ll);
    });
    // Marker at start of each trail segment
    if (path.length) {
      var marker = L.circleMarker(path[0], {
        radius: 6,
        color: '#fff',
        weight: 2,
        fillColor: '#f97316',
        fillOpacity: 1
      }).addTo(map);
      marker.bindTooltip(t.name || ('Trail ' + (ti + 1)), { direction: 'top' });
      routeMarkers.push(marker);
    }
  });
  updateRouteUI();
  updateSelectedList();
}

function toggleTrailInRoute(feature, idx, layer) {
  var id = featureId(feature, idx);
  var existing = selectedTrails.findIndex(function (t) { return t.id === id; });
  if (existing >= 0) {
    selectedTrails.splice(existing, 1);
    restyleTrailLayer(id);
    rebuildWaypointsFromSelection();
    showToast('Removed from route');
    return;
  }
  var latlngs = geometryToLatLngs(feature.geometry);
  if (latlngs.length < 2) {
    showToast('Trail has no line geometry', true);
    return;
  }
  var name = (feature.properties && (feature.properties.name || feature.properties.Name)) || 'Trail';
  selectedTrails.push({
    id: id,
    name: name,
    difficulty: normalizeDifficulty(feature.properties && (feature.properties.difficulty || feature.properties.Difficulty || feature.properties.rating)),
    latlngs: latlngs,
    feature: feature
  });
  restyleTrailLayer(id);
  rebuildWaypointsFromSelection();
  showToast('Added: ' + name);
}

function updateSelectedList() {
  var el = document.getElementById('selected-trails-list');
  if (!el) return;
  if (!selectedTrails.length) {
    el.innerHTML = '<p class="text-xs text-zinc-500">Click trails on the map to build a route.</p>';
    return;
  }
  el.innerHTML = selectedTrails.map(function (t, i) {
    return '<div class="flex items-center gap-2 text-sm py-1.5 border-b border-zinc-800 last:border-0">' +
      '<span class="text-zinc-500 text-xs w-5">' + (i + 1) + '.</span>' +
      '<span class="flex-1 truncate font-medium">' + escapeHtmlTrail(t.name) + '</span>' +
      '<span class="text-[10px] uppercase tracking-wide ' +
        (t.difficulty === 'easy' ? 'text-green-400' : t.difficulty === 'advanced' ? 'text-zinc-300' : 'text-blue-400') +
      '">' + diffLabel(t.difficulty) + '</span>' +
      '</div>';
  }).join('');
}

function routeDistanceKm() {
  var d = 0;
  for (var i = 1; i < waypoints.length; i++) d += haversineKm(waypoints[i - 1], waypoints[i]);
  return d;
}

function updateRouteUI() {
  var el = document.getElementById('route-distance');
  var pts = document.getElementById('route-points');
  if (el) el.textContent = routeDistanceKm().toFixed(1) + ' km';
  if (pts) {
    pts.textContent = selectedTrails.length
      ? (selectedTrails.length + ' trail' + (selectedTrails.length === 1 ? '' : 's'))
      : (waypoints.length + ' point' + (waypoints.length === 1 ? '' : 's'));
  }
  if (routeLine) map.removeLayer(routeLine);
  routeLine = null;
  if (waypoints.length >= 2) {
    routeLine = L.polyline(waypoints, { color: '#f97316', weight: 4, opacity: 0.95, dashArray: null }).addTo(map);
    routeLine.bringToFront();
  }
}

function toggleRouteMode() {
  routeMode = !routeMode;
  var btn = document.getElementById('btn-route-mode');
  if (btn) {
    btn.textContent = routeMode ? 'Click trails to add…' : 'Build route';
    btn.classList.toggle('bg-emerald-600', routeMode);
    btn.classList.toggle('bg-orange-600', !routeMode);
  }
  if (map) map.getContainer().style.cursor = routeMode ? 'pointer' : '';
  showToast(routeMode ? 'Click a trail to add it to your route' : 'Route mode off');
}

function toggleSnap() {
  snapEnabled = !snapEnabled;
  var btn = document.getElementById('btn-snap-toggle');
  if (btn) {
    btn.textContent = snapEnabled ? 'Snap: ON' : 'Snap: OFF';
    btn.classList.toggle('border-emerald-600', snapEnabled);
    btn.classList.toggle('text-emerald-400', snapEnabled);
  }
  showToast(snapEnabled ? 'Point snap on' : 'Point snap off');
}

function clearRoute() {
  selectedTrails.forEach(function (t) { restyleTrailLayer(t.id); });
  selectedTrails = [];
  waypoints = [];
  routeMarkers.forEach(function (m) { map.removeLayer(m); });
  routeMarkers = [];
  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
  updateRouteUI();
  updateSelectedList();
}

function undoWaypoint() {
  // Undo last selected trail if any
  if (selectedTrails.length) {
    var t = selectedTrails.pop();
    restyleTrailLayer(t.id);
    rebuildWaypointsFromSelection();
    showToast('Removed: ' + t.name);
    return;
  }
  if (!waypoints.length) return;
  waypoints.pop();
  var m = routeMarkers.pop();
  if (m) map.removeLayer(m);
  updateRouteUI();
}

function addWaypoint(latlng, opts) {
  opts = opts || {};
  var snapped = opts.skipSnap ? { lat: latlng.lat, lng: latlng.lng, snapped: false }
    : snapToTrails(latlng);
  if (routeMode && snapEnabled && !opts.skipSnap && !snapped.snapped) {
    showToast('Click a trail (or closer to one)', true);
    return;
  }
  var ll = [snapped.lat, snapped.lng];
  if (waypoints.length) {
    var last = waypoints[waypoints.length - 1];
    if (haversineM(last, ll) < 2) return;
  }
  waypoints.push(ll);
  var marker = L.circleMarker(ll, {
    radius: 6, color: '#fff', weight: 2,
    fillColor: '#f97316', fillOpacity: 1
  }).addTo(map);
  routeMarkers.push(marker);
  updateRouteUI();
}

function flyTo(key) {
  var a = AREAS[key];
  if (a && map) map.flyTo(a.center, a.zoom, { duration: 1.2 });
}

async function initMap() {
  map = L.map('trail-map', { scrollWheelZoom: true }).setView(AREAS.hat.center, 11);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  try {
    var res = await fetch('assets/trails/region.geojson');
    var geo = await res.json();
    buildSnapNetwork(geo);
    trailLayer = L.geoJSON(geo, {
      style: function (f) {
        var col = diffColor(f.properties && (f.properties.difficulty || f.properties.Difficulty || f.properties.rating));
        return { color: col, weight: 5, opacity: 0.9 };
      },
      onEachFeature: function (f, layer, idx) {
        // Leaflet doesn't pass idx reliably in onEachFeature — use feature index counter
      }
    });

    // Re-bind with index for stable ids
    var idx = 0;
    trailLayer = L.geoJSON(geo, {
      style: function (f) {
        var col = diffColor(f.properties && (f.properties.difficulty || f.properties.Difficulty || f.properties.rating));
        return { color: col, weight: 5, opacity: 0.9 };
      },
      onEachFeature: function (f, layer) {
        var i = idx++;
        var id = featureId(f, i);
        var col = diffColor(f.properties && (f.properties.difficulty || f.properties.Difficulty || f.properties.rating));
        layer.options._baseColor = col;
        layer.options._featureId = id;
        layer.options._featureIndex = i;
        trailLayerById[id] = layer;

        var p = f.properties || {};
        var name = p.name || p.Name || 'Trail';
        var diff = diffLabel(p.difficulty || p.Difficulty || p.rating);
        layer.bindPopup(
          '<strong>' + escapeHtmlTrail(name) + '</strong><br>' +
          '<span style="color:' + col + '">' + diff + '</span>' +
          (p.area ? ' · ' + escapeHtmlTrail(p.area) : '') +
          '<br><button type="button" class="trail-add-btn" style="margin-top:6px;padding:4px 10px;border-radius:8px;background:#ea580c;color:#fff;border:0;cursor:pointer;font-size:12px">Add to route</button>'
        );
        layer.on('popupopen', function () {
          var btn = document.querySelector('.trail-add-btn');
          if (btn) {
            btn.onclick = function () {
              toggleTrailInRoute(f, i, layer);
              map.closePopup();
            };
          }
        });
        layer.on('click', function (e) {
          if (!routeMode) return;
          L.DomEvent.stopPropagation(e);
          toggleTrailInRoute(f, i, layer);
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

  // Point-click still works in route mode (snap) if you miss a line
  map.on('click', function (e) {
    if (!routeMode) return;
    // Prefer trail clicks (handled above). Map click = optional point snap.
    addWaypoint(e.latlng);
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
  if (waypoints.length < 2) {
    showToast('Select at least one trail (or 2 points)', true);
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
  if (selectedTrails.length && !description) {
    description = selectedTrails.map(function (t) { return t.name; }).join(' → ');
  }
  var is_public = !!(document.getElementById('route-public') || {}).checked;
  var geojson = {
    type: 'Feature',
    properties: {
      name: name,
      trails: selectedTrails.map(function (t) { return t.name; })
    },
    geometry: {
      type: 'LineString',
      coordinates: waypoints.map(function (w) { return [w[1], w[0]]; })
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
  if (!coords || !coords.length) return;
  coords.forEach(function (c) {
    addWaypoint({ lat: c[1], lng: c[0] }, { skipSnap: true });
  });
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

function escapeHtmlTrail(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

document.addEventListener('DOMContentLoaded', function () {
  initMap();
});
