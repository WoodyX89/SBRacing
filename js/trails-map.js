// SB Racing — Trails map (simplified for phone)
// - Track ride (GPS)
// - Drop checkpoints to plan a route
// - Trail popups with short description + photos

var map, trailLayer, routeLine, routeMarkers = [];
var checkpointMode = false;
var trailFeatures = [];
var highlightedLayer = null;
var currentDiffFilter = '';
var currentAreaFilter = '';

/** Ordered checkpoints: first = start, rest = checkpoints */
var routePoints = [];

var gpsMarker = null;
var gpsAccuracyCircle = null;
var gpsTrackLine = null;
var rideFollow = true;

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
  if (geom.type === 'LineString') return densifyLine(geom.coordinates);
  if (geom.type === 'MultiLineString' && geom.coordinates.length) {
    var all = [];
    geom.coordinates.forEach(function (line) {
      densifyLine(line).forEach(function (ll) { all.push(ll); });
    });
    return all;
  }
  return [];
}

function buildTrailIndex(geojson) {
  trailFeatures = [];
  if (!geojson || !geojson.features) return;
  geojson.features.forEach(function (f, idx) {
    if (!f.geometry) return;
    var latlngs = geometryToLatLngs(f.geometry);
    if (latlngs.length < 2) return;
    var id = (f.id != null) ? String(f.id)
      : (f.properties && f.properties.id != null) ? String(f.properties.id)
      : (f.properties && f.properties.osm_id != null) ? String(f.properties.osm_id)
      : 'idx:' + idx;
    var name = (f.properties && (f.properties.name || f.properties.Name)) || ('Trail ' + (idx + 1));
    var difficulty = normalizeDifficulty(f.properties && (f.properties.difficulty || f.properties.Difficulty || f.properties.rating));
    var area = (f.properties && f.properties.area) || '';
    trailFeatures.push({
      id: id,
      name: name,
      difficulty: difficulty,
      area: area,
      latlngs: latlngs,
      feature: f,
      index: idx,
      layer: null
    });
  });
  console.log('[trails] features:', trailFeatures.length);
}

function routeDistanceKm() {
  var d = 0;
  for (var i = 1; i < routePoints.length; i++) {
    d += haversineKm(
      [routePoints[i - 1].lat, routePoints[i - 1].lng],
      [routePoints[i].lat, routePoints[i].lng]
    );
  }
  return d;
}

function updateCheckpointUI() {
  var el = document.getElementById('checkpoint-distance');
  var pts = document.getElementById('checkpoint-count');
  if (el) el.textContent = routeDistanceKm().toFixed(1) + ' km';
  if (pts) {
    if (!routePoints.length) pts.textContent = '0 points';
    else if (routePoints.length === 1) pts.textContent = 'Start set';
    else pts.textContent = 'Start + ' + (routePoints.length - 1) + ' checkpoint' + (routePoints.length === 2 ? '' : 's');
  }

  var hud = document.getElementById('map-checkpoint-hud');
  var hudDist = document.getElementById('map-cp-distance');
  var hudPts = document.getElementById('map-cp-points');
  if (hud) {
    if (routePoints.length > 0 || checkpointMode) hud.classList.add('visible');
    else hud.classList.remove('visible');
  }
  if (hudDist) hudDist.textContent = routeDistanceKm().toFixed(1) + ' km';
  if (hudPts) {
    hudPts.textContent = routePoints.length === 0
      ? 'tap map'
      : (routePoints.length === 1 ? 'start set' : routePoints.length + ' pts');
  }

  routeMarkers.forEach(function (m) { map.removeLayer(m); });
  routeMarkers = [];
  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }

  if (routePoints.length >= 2) {
    var line = routePoints.map(function (p) { return [p.lat, p.lng]; });
    routeLine = L.polyline(line, { color: '#f97316', weight: 4, opacity: 0.95, dashArray: null }).addTo(map);
  }

  routePoints.forEach(function (pt, i) {
    var isStart = i === 0;
    var isEnd = i === routePoints.length - 1 && i > 0;
    var marker = L.circleMarker([pt.lat, pt.lng], {
      radius: isStart ? 10 : 8,
      color: '#fff',
      weight: 2,
      fillColor: isStart ? '#22c55e' : (isEnd ? '#f97316' : '#3b82f6'),
      fillOpacity: 1
    }).addTo(map);
    var label = isStart ? 'Start' : (isEnd && routePoints.length > 2 ? 'End' : ('CP ' + i));
    marker.bindTooltip(label, { direction: 'top', permanent: false });
    routeMarkers.push(marker);
  });

  updateCheckpointList();
  updateFabCheckpointState();
}

function updateCheckpointList() {
  var el = document.getElementById('checkpoint-list');
  if (!el) return;
  if (!routePoints.length) {
    el.innerHTML = '<p class="text-xs text-zinc-500">No checkpoints yet — turn on “Add checkpoints” and tap the map.</p>';
    return;
  }
  el.innerHTML = routePoints.map(function (pt, i) {
    var label = i === 0 ? 'Start' : ('Checkpoint ' + i);
    return '<div class="flex items-center gap-2 text-sm py-1.5 border-b border-zinc-800 last:border-0">' +
      '<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:' + (i === 0 ? '#22c55e' : '#3b82f6') + '"></span>' +
      '<span class="flex-1 min-w-0"><span class="font-medium">' + label + '</span>' +
      '<span class="text-xs text-zinc-500 block">' + pt.lat.toFixed(5) + ', ' + pt.lng.toFixed(5) + '</span></span></div>';
  }).join('');
}

function updateFabCheckpointState() {
  var fab = document.getElementById('fab-checkpoint');
  var btn = document.getElementById('btn-checkpoint-mode');
  if (fab) fab.classList.toggle('active-checkpoint', checkpointMode);
  if (btn) {
    btn.textContent = checkpointMode ? 'Dropping points…' : 'Add checkpoints';
    btn.classList.toggle('bg-emerald-600', checkpointMode);
    btn.classList.toggle('bg-orange-600', !checkpointMode);
  }
}

function toggleCheckpointMode() {
  checkpointMode = !checkpointMode;
  updateFabCheckpointState();
  if (map) map.getContainer().style.cursor = checkpointMode ? 'crosshair' : '';
  updateCheckpointUI();
  showToast(checkpointMode
    ? (routePoints.length ? 'Tap map to add a checkpoint' : 'Tap map to set the START point')
    : 'Checkpoint mode off');
}

function clearCheckpoints() {
  routePoints = [];
  updateCheckpointUI();
  showToast('Checkpoints cleared');
}

function undoCheckpoint() {
  if (!routePoints.length) return;
  routePoints.pop();
  updateCheckpointUI();
  showToast(routePoints.length === 0 ? 'Start cleared' : 'Removed last point');
}

function addCheckpoint(latlng) {
  var pt = { lat: latlng.lat, lng: latlng.lng };
  if (routePoints.length) {
    var last = routePoints[routePoints.length - 1];
    if (haversineM([last.lat, last.lng], [pt.lat, pt.lng]) < 8) return;
  }
  routePoints.push(pt);
  updateCheckpointUI();
  if (routePoints.length === 1) {
    showToast('Start set · tap more points for checkpoints');
  } else {
    showToast('Checkpoint ' + (routePoints.length - 1) + ' added');
  }
}

function focusTrail(trailId, openPopup) {
  var trail = trailFeatures.find(function (tf) { return tf.id === trailId; });
  if (!trail || !trail.latlngs.length) return;
  clearHighlight();
  if (trail.layer) {
    highlightLayer(trail.layer);
    if (openPopup) {
      try {
        var mid = trail.latlngs[Math.floor(trail.latlngs.length / 2)];
        trail.layer.openPopup(L.latLng(mid[0], mid[1]));
      } catch (e) {}
    }
  }
  var bounds = L.latLngBounds(trail.latlngs);
  map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
}

function highlightLayer(layer) {
  clearHighlight();
  if (!layer) return;
  highlightedLayer = layer;
  try {
    layer.setStyle({ weight: 9, opacity: 1 });
    if (layer._path) layer._path.classList.add('trail-highlight');
  } catch (e) {}
}

function clearHighlight() {
  if (highlightedLayer) {
    try {
      var f = highlightedLayer.feature;
      var col = diffColor(f && f.properties && (f.properties.difficulty || f.properties.Difficulty || f.properties.rating));
      highlightedLayer.setStyle({ weight: 5, opacity: 0.9, color: col });
      if (highlightedLayer._path) highlightedLayer._path.classList.remove('trail-highlight');
    } catch (e) {}
    highlightedLayer = null;
  }
}

function flyTo(key) {
  var a = AREAS[key];
  if (a && map) map.flyTo(a.center, a.zoom, { duration: 1.2 });
}

function locateMe() {
  if (!navigator.geolocation) {
    showToast('Geolocation not available', true);
    return;
  }
  showToast('Finding your location…');
  navigator.geolocation.getCurrentPosition(
    function (pos) {
      var ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
      map.flyTo(ll, 14, { duration: 1 });
      if (!gpsMarker) {
        gpsMarker = L.circleMarker(ll, {
          radius: 8, color: '#fff', weight: 3,
          fillColor: '#3b82f6', fillOpacity: 1
        }).addTo(map);
        gpsMarker.bindTooltip('You', { direction: 'top' });
      } else {
        gpsMarker.setLatLng(ll);
      }
      if (!gpsAccuracyCircle) {
        gpsAccuracyCircle = L.circle(ll, {
          radius: pos.coords.accuracy || 30,
          color: '#3b82f6', weight: 1, opacity: 0.35,
          fillColor: '#3b82f6', fillOpacity: 0.08
        }).addTo(map);
      } else {
        gpsAccuracyCircle.setLatLng(ll);
        gpsAccuracyCircle.setRadius(pos.coords.accuracy || 30);
      }
      showToast('Location found');
    },
    function () {
      showToast('Could not get location — check permissions', true);
    },
    { enableHighAccuracy: true, timeout: 12000 }
  );
}

// ---------- Trail browser ----------

function setDiffFilter(diff) {
  currentDiffFilter = diff || '';
  document.querySelectorAll('.trail-filter-btn').forEach(function (btn) {
    var d = btn.getAttribute('data-diff') || '';
    var active = d === currentDiffFilter;
    btn.classList.toggle('border-orange-600', active);
    btn.classList.toggle('bg-orange-600/20', active);
    btn.classList.toggle('text-orange-400', active);
    btn.classList.toggle('border-zinc-600', !active);
    btn.classList.toggle('text-zinc-400', !active);
  });
  filterTrailBrowser();
}

function setAreaFilter(area) {
  currentAreaFilter = area || '';
  document.querySelectorAll('.trail-area-btn').forEach(function (btn) {
    var a = btn.getAttribute('data-area') || '';
    var active = a === currentAreaFilter;
    btn.classList.toggle('border-orange-600', active);
    btn.classList.toggle('bg-orange-600/20', active);
    btn.classList.toggle('text-orange-400', active);
    btn.classList.toggle('border-zinc-600', !active);
    btn.classList.toggle('text-zinc-400', !active);
  });
  filterTrailBrowser();
}

function filterTrailBrowser() {
  var q = ((document.getElementById('trail-search') || {}).value || '').toLowerCase().trim();
  var list = document.getElementById('trail-browser-list');
  if (!list) return;

  var matches = trailFeatures.filter(function (tf) {
    if (currentDiffFilter && tf.difficulty !== currentDiffFilter) return false;
    if (currentAreaFilter) {
      var area = (tf.area || '').toLowerCase();
      if (currentAreaFilter === 'Cypress Hills / Elkwater') {
        if (area.indexOf('cypress') === -1 && area.indexOf('elkwater') === -1) return false;
      } else if (area.indexOf(currentAreaFilter.toLowerCase()) === -1) {
        return false;
      }
    }
    if (q && tf.name.toLowerCase().indexOf(q) === -1) return false;
    return true;
  });

  matches.sort(function (a, b) { return a.name.localeCompare(b.name); });

  if (!matches.length) {
    list.innerHTML = '<p class="text-xs text-zinc-500 px-2 py-3">No trails match.</p>';
    return;
  }

  list.innerHTML = matches.slice(0, 80).map(function (tf) {
    var col = diffColor(tf.difficulty);
    var safeId = String(tf.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return '<div class="trail-browser-item" data-id="' + escapeHtmlTrail(tf.id) + '" onclick="onBrowserTrailClick(\'' + safeId + '\')">' +
      '<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:' + col + '; box-shadow:0 0 0 1px rgba(255,255,255,0.2)"></span>' +
      '<div class="flex-1 min-w-0">' +
      '<div class="text-sm font-medium truncate">' + escapeHtmlTrail(tf.name) + '</div>' +
      '<div class="text-[10px] text-zinc-500 truncate">' + diffLabel(tf.difficulty) + (tf.area ? ' · ' + escapeHtmlTrail(tf.area) : '') + '</div>' +
      '</div>' +
      '</div>';
  }).join('');

  if (matches.length > 80) {
    list.innerHTML += '<p class="text-[10px] text-zinc-500 px-2 py-2">Showing first 80 of ' + matches.length + '</p>';
  }
}

function onBrowserTrailClick(trailId) {
  focusTrail(trailId, true);
  document.querySelectorAll('.trail-browser-item').forEach(function (el) {
    el.classList.toggle('active', el.getAttribute('data-id') === trailId);
  });
}

/** Enhanced popup: description + photos from trail-info.js */
function buildTrailPopupHtml(name, diff, area, trailId) {
  var col = diffColor(diff);
  var norm = normalizeDifficulty(diff);
  var info = (typeof getTrailDescription === 'function')
    ? getTrailDescription(name, area, diff)
    : { desc: '', photos: [] };
  var photosHtml = '';
  if (info.photos && info.photos.length) {
    photosHtml = '<div class="trail-popup-photos">' +
      info.photos.map(function (src) {
        return '<img src="' + src + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">';
      }).join('') + '</div>';
  }
  var descHtml = info.desc
    ? '<div class="trail-popup-desc">' + escapeHtmlTrail(info.desc) + '</div>'
    : '';
  var linkHtml = info.trailforks
    ? '<a href="' + info.trailforks + '" target="_blank" rel="noopener" class="trail-popup-btn" style="text-decoration:none">Trailforks</a>'
    : '';
  var safeId = String(trailId).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  // Advanced (black) is hard to read on dark popup — white pill badge
  var diffBadge;
  if (norm === 'advanced') {
    diffBadge =
      '<span style="display:inline-block;background:#fff;color:#0a0a0a;font-size:11px;font-weight:700;' +
      'padding:2px 8px;border-radius:999px;line-height:1.4">' +
      diffLabel(diff) + '</span>';
  } else {
    diffBadge = '<span style="color:' + col + ';font-size:12px;font-weight:600">' + diffLabel(diff) + '</span>';
  }

  return '<div style="min-width:200px;max-width:280px">' +
    '<strong style="font-size:15px">' + escapeHtmlTrail(name) + '</strong><br>' +
    '<div style="margin-top:4px;display:flex;align-items:center;flex-wrap:wrap;gap:6px">' +
    diffBadge +
    (area ? '<span style="font-size:11px;opacity:.75">' + escapeHtmlTrail(area) + '</span>' : '') +
    '</div>' +
    photosHtml +
    descHtml +
    '<div class="trail-popup-actions">' +
    '<button type="button" class="trail-popup-btn primary" onclick="addTrailMidpointAsCheckpoint(\'' + safeId + '\')">' +
    '<i class="fa-solid fa-map-pin"></i> Add checkpoint</button>' +
    '<button type="button" class="trail-popup-btn" onclick="focusTrail(\'' + safeId + '\', false)">Zoom</button>' +
    linkHtml +
    '</div>' +
    '</div>';
}

/** Drop a checkpoint roughly in the middle of a trail (quick plan aid) */
function addTrailMidpointAsCheckpoint(trailId) {
  var trail = trailFeatures.find(function (tf) { return tf.id === trailId; });
  if (!trail || !trail.latlngs.length) return;
  var mid = trail.latlngs[Math.floor(trail.latlngs.length / 2)];
  if (!checkpointMode) {
    checkpointMode = true;
    updateFabCheckpointState();
    if (map) map.getContainer().style.cursor = 'crosshair';
  }
  addCheckpoint({ lat: mid[0], lng: mid[1] });
  if (map) map.closePopup();
}

async function initMap() {
  map = L.map('trail-map', { scrollWheelZoom: true, tap: true }).setView(AREAS.hat.center, 11);

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
    { position: 'topright', collapsed: true }
  ).addTo(map);

  try {
    var res = await fetch('assets/trails/region.geojson');
    var geo = await res.json();
    buildTrailIndex(geo);

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
        var diff = normalizeDifficulty(p.difficulty || p.Difficulty || p.rating);
        var area = p.area || '';
        var id = (f.id != null) ? String(f.id)
          : (p.id != null) ? String(p.id)
          : (p.osm_id != null) ? String(p.osm_id)
          : 'idx:' + i;

        var tf = trailFeatures.find(function (t) { return t.id === id; });
        if (tf) tf.layer = layer;
        layer.feature = f;

        layer.bindPopup(buildTrailPopupHtml(name, diff, area, id), {
          maxWidth: 300,
          className: 'trail-popup'
        });

        layer.on('click', function (e) {
          if (checkpointMode) {
            L.DomEvent.stopPropagation(e);
            addCheckpoint(e.latlng);
          } else {
            highlightLayer(layer);
          }
        });

        layer.on('mouseover', function () {
          if (!checkpointMode) {
            try { layer.setStyle({ weight: 7, opacity: 1 }); } catch (err) {}
          }
        });
        layer.on('mouseout', function () {
          if (highlightedLayer !== layer) {
            try { layer.setStyle({ weight: 5, opacity: 0.9 }); } catch (err) {}
          }
        });
      }
    }).addTo(map);

    try {
      map.fitBounds(trailLayer.getBounds(), { padding: [30, 30], maxZoom: 13 });
    } catch (e) {}

    filterTrailBrowser();

  } catch (e) {
    console.warn('[trails] geojson', e);
    showToast('Could not load region.geojson', true);
    var list = document.getElementById('trail-browser-list');
    if (list) list.innerHTML = '<p class="text-xs text-red-400 px-2 py-3">Failed to load trails</p>';
  }

  map.on('click', function (e) {
    if (!checkpointMode) return;
    addCheckpoint(e.latlng);
  });

  updateSaveHint();
  updateCheckpointList();
  loadMyRoutes();
  updateFabCheckpointState();
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
  if (routePoints.length < 2) {
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
    name = 'Route ' + new Date().toLocaleDateString();
  }
  var geojson = {
    type: 'Feature',
    properties: {
      name: name,
      pointCount: routePoints.length,
      points: routePoints.map(function (pt, i) {
        return {
          role: i === 0 ? 'start' : 'checkpoint',
          lat: pt.lat,
          lng: pt.lng
        };
      })
    },
    geometry: {
      type: 'LineString',
      coordinates: routePoints.map(function (p) { return [p.lng, p.lat]; })
    }
  };
  try {
    var result = await window.sb.from('member_routes').insert({
      user_id: user.id,
      name: name,
      description: null,
      distance_km: Math.round(routeDistanceKm() * 100) / 100,
      geojson: geojson,
      is_public: false
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
  clearCheckpoints();
  var pts = row.geojson && row.geojson.properties && row.geojson.properties.points;
  var coords = row.geojson && row.geojson.geometry && row.geojson.geometry.coordinates;
  if (pts && pts.length) {
    pts.forEach(function (p) {
      routePoints.push({ lat: p.lat, lng: p.lng });
    });
  } else if (coords && coords.length) {
    coords.forEach(function (c) {
      routePoints.push({ lat: c[1], lng: c[0] });
    });
  }
  updateCheckpointUI();
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

// ---------- Live ride tracking ----------
var rideTimerId = null;

function formatRideTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return m + ':' + String(s).padStart(2, '0');
}

function updateRideUI(snap) {
  if (!snap) snap = (window.RideTracker && RideTracker.getSnapshot()) || { status: 'idle', distanceKm: 0, elevGainM: 0, elapsedSec: 0, pointCount: 0 };

  var badge = document.getElementById('ride-status-badge');
  if (badge) {
    badge.textContent = snap.status === 'recording' ? 'Recording' : snap.status === 'paused' ? 'Paused' : 'Idle';
    badge.className = 'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ' +
      (snap.status === 'recording'
        ? 'bg-emerald-950 text-emerald-400 border-emerald-700'
        : snap.status === 'paused'
          ? 'bg-amber-950 text-amber-400 border-amber-700'
          : 'bg-zinc-800 text-zinc-400 border-zinc-700');
  }

  var banner = document.getElementById('ride-recording-banner');
  var bannerLabel = document.getElementById('ride-recording-label');
  var bannerDot = document.getElementById('ride-recording-dot');
  var panel = document.getElementById('ride-panel');
  if (banner) {
    if (snap.status === 'recording') {
      banner.classList.remove('hidden');
      banner.classList.add('flex');
      banner.className = 'flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold border bg-emerald-950/80 text-emerald-300 border-emerald-700';
      if (bannerLabel) bannerLabel.textContent = 'Location recording is ON';
      if (bannerDot) bannerDot.className = 'w-2.5 h-2.5 rounded-full shrink-0 bg-emerald-400 ride-pulse';
      if (panel) {
        panel.classList.add('ring-2', 'ring-emerald-600/60');
        panel.classList.remove('ring-amber-600/60');
      }
    } else if (snap.status === 'paused') {
      banner.classList.remove('hidden');
      banner.classList.add('flex');
      banner.className = 'flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold border bg-amber-950/80 text-amber-300 border-amber-700';
      if (bannerLabel) bannerLabel.textContent = 'Recording paused — location still held';
      if (bannerDot) bannerDot.className = 'w-2.5 h-2.5 rounded-full shrink-0 bg-amber-400';
      if (panel) {
        panel.classList.add('ring-2', 'ring-amber-600/60');
        panel.classList.remove('ring-emerald-600/60');
      }
    } else {
      banner.classList.add('hidden');
      banner.classList.remove('flex');
      if (panel) panel.classList.remove('ring-2', 'ring-emerald-600/60', 'ring-amber-600/60');
    }
  }

  var elDist = document.getElementById('ride-distance');
  var elTime = document.getElementById('ride-time');
  var elElev = document.getElementById('ride-elev');
  var elPts = document.getElementById('ride-points');
  if (elDist) elDist.textContent = (snap.distanceKm || 0).toFixed(2) + ' km';
  if (elTime) elTime.textContent = formatRideTime(snap.elapsedSec);
  if (elElev) elElev.textContent = (snap.elevGainM || 0) + ' m';
  if (elPts) elPts.textContent = String(snap.pointCount || 0);

  var mapHud = document.getElementById('map-ride-hud');
  var mapDist = document.getElementById('map-ride-distance');
  var mapTime = document.getElementById('map-ride-time');
  var mapStatus = document.getElementById('map-ride-status-label');
  var mapDot = document.getElementById('map-ride-dot');
  if (mapHud) {
    if (snap.status === 'recording' || snap.status === 'paused') mapHud.classList.add('visible');
    else mapHud.classList.remove('visible');
  }
  if (mapDist) mapDist.textContent = (snap.distanceKm || 0).toFixed(2) + ' km';
  if (mapTime) mapTime.textContent = formatRideTime(snap.elapsedSec);
  if (mapStatus) {
    mapStatus.textContent = snap.status === 'recording' ? 'Recording' : snap.status === 'paused' ? 'Paused' : '';
    mapStatus.className = snap.status === 'paused' ? 'text-amber-400' : 'text-emerald-400';
  }
  if (mapDot) {
    mapDot.className = 'w-2 h-2 rounded-full ' +
      (snap.status === 'recording' ? 'bg-emerald-400 ride-pulse' : 'bg-amber-400');
  }

  var fab = document.getElementById('fab-ride');
  var fabIcon = document.getElementById('fab-ride-icon');
  if (fab) {
    fab.classList.toggle('recording', snap.status === 'recording');
    fab.classList.toggle('active-ride', snap.status === 'paused');
    if (fabIcon) {
      if (snap.status === 'recording') fabIcon.className = 'fa-solid fa-pause';
      else fabIcon.className = 'fa-solid fa-play';
    }
  }

  var isActive = snap.status === 'recording' || snap.status === 'paused';
  var btnStart = document.getElementById('btn-ride-start');
  var btnPause = document.getElementById('btn-ride-pause');
  var btnStop = document.getElementById('btn-ride-stop');
  var btnFollow = document.getElementById('btn-ride-follow');
  var btnUse = document.getElementById('btn-ride-use-as-route');
  var btnSave = document.getElementById('btn-ride-save');
  var btnGpx = document.getElementById('btn-ride-gpx');

  if (btnStart) {
    if (snap.status === 'paused') {
      btnStart.textContent = 'Resume';
      btnStart.classList.remove('hidden');
    } else if (snap.status === 'recording') {
      btnStart.classList.add('hidden');
    } else {
      btnStart.textContent = 'Start ride';
      btnStart.classList.remove('hidden');
    }
  }
  if (btnPause) btnPause.classList.toggle('hidden', snap.status !== 'recording');
  if (btnStop) {
    btnStop.classList.toggle('hidden', !isActive && !(snap.pointCount > 0 && snap.status === 'idle'));
    if (snap.status === 'idle' && snap.pointCount > 0) btnStop.classList.add('hidden');
  }
  if (btnFollow) {
    btnFollow.classList.toggle('hidden', !isActive);
    btnFollow.textContent = rideFollow ? 'Follow: ON' : 'Follow: OFF';
  }
  if (btnUse) btnUse.classList.toggle('hidden', !(snap.pointCount >= 2));
  if (btnSave) btnSave.classList.toggle('hidden', !(snap.pointCount >= 2 && snap.status === 'idle'));
  if (btnGpx) btnGpx.classList.toggle('hidden', !(snap.pointCount >= 2));

  renderRideTrack(snap);
}

function fabRideToggle() {
  if (!window.RideTracker) {
    showToast('Ride tracker not loaded', true);
    return;
  }
  var snap = RideTracker.getSnapshot();
  if (snap.status === 'idle') rideStart();
  else if (snap.status === 'recording') ridePause();
  else if (snap.status === 'paused') rideStart();
}

function renderRideTrack(snap) {
  if (!map || !snap || !snap.points) return;
  var latlngs = snap.points.map(function (p) { return [p.lat, p.lng]; });

  if (gpsTrackLine) {
    map.removeLayer(gpsTrackLine);
    gpsTrackLine = null;
  }
  if (latlngs.length >= 2) {
    gpsTrackLine = L.polyline(latlngs, {
      color: '#f97316',
      weight: 4,
      opacity: 0.9
    }).addTo(map);
  }

  var last = snap.lastPoint || (snap.points.length ? snap.points[snap.points.length - 1] : null);
  if (last) {
    var ll = L.latLng(last.lat, last.lng);
    var acc = last.acc || 25;
    if (!gpsMarker) {
      gpsMarker = L.circleMarker(ll, {
        radius: 8,
        color: '#fff',
        weight: 3,
        fillColor: '#f97316',
        fillOpacity: 1
      }).addTo(map);
      gpsMarker.bindTooltip('You', { direction: 'top' });
    } else {
      gpsMarker.setLatLng(ll);
    }
    if (!gpsAccuracyCircle) {
      gpsAccuracyCircle = L.circle(ll, {
        radius: acc,
        color: '#f97316',
        weight: 1,
        opacity: 0.35,
        fillColor: '#f97316',
        fillOpacity: 0.08
      }).addTo(map);
    } else {
      gpsAccuracyCircle.setLatLng(ll);
      gpsAccuracyCircle.setRadius(acc);
    }
    if (rideFollow && (snap.status === 'recording' || snap.status === 'paused')) {
      map.panTo(ll, { animate: true, duration: 0.35 });
    }
  }
}

function toggleGpsFollow() {
  rideFollow = !rideFollow;
  updateRideUI();
  showToast(rideFollow ? 'Map follows you' : 'Follow off');
}

async function rideStart() {
  if (!window.RideTracker) {
    showToast('Ride tracker not loaded', true);
    return;
  }
  try {
    var snap = await RideTracker.start();
    startRideTimer();
    updateRideUI(snap);
    showToast(snap.status === 'recording' ? 'Ride started — ride safe' : 'Recording');
  } catch (e) {
    console.error(e);
    showToast((e && e.message) || 'Could not start GPS', true);
  }
}

async function ridePause() {
  if (!window.RideTracker) return;
  try {
    var snap = await RideTracker.pause();
    updateRideUI(snap);
    showToast('Ride paused');
  } catch (e) {
    showToast((e && e.message) || 'Pause failed', true);
  }
}

async function rideStop() {
  if (!window.RideTracker) return;
  try {
    var snap = await RideTracker.stop();
    stopRideTimer();
    updateRideUI(snap);
    showToast(snap.pointCount >= 2 ? 'Ride stopped — save or export below' : 'Ride stopped');
  } catch (e) {
    showToast((e && e.message) || 'Stop failed', true);
  }
}

function startRideTimer() {
  stopRideTimer();
  rideTimerId = setInterval(function () { updateRideUI(); }, 1000);
}

function stopRideTimer() {
  if (rideTimerId) {
    clearInterval(rideTimerId);
    rideTimerId = null;
  }
}

/** Turn recorded ride into checkpoints (simplified sampling) */
function useRideAsCheckpoints() {
  if (!window.RideTracker) return;
  var snap = RideTracker.getSnapshot();
  if (!snap.points || snap.points.length < 2) {
    showToast('Not enough points yet', true);
    return;
  }
  routePoints = [];
  var first = snap.points[0];
  routePoints.push({ lat: first.lat, lng: first.lng });
  var acc = 0;
  var last = first;
  for (var i = 1; i < snap.points.length - 1; i++) {
    var p = snap.points[i];
    acc += haversineM([last.lat, last.lng], [p.lat, p.lng]);
    last = p;
    if (acc >= 250) {
      routePoints.push({ lat: p.lat, lng: p.lng });
      acc = 0;
    }
  }
  var end = snap.points[snap.points.length - 1];
  routePoints.push({ lat: end.lat, lng: end.lng });
  updateCheckpointUI();
  if (gpsTrackLine) map.fitBounds(gpsTrackLine.getBounds(), { padding: [40, 40] });
  showToast('Track applied as checkpoints — name & save if you like');
}

async function saveRecordedRide() {
  if (!window.RideTracker) return;
  var snap = RideTracker.getSnapshot();
  if (!snap.points || snap.points.length < 2) {
    showToast('Nothing to save', true);
    return;
  }
  var user = null;
  try { user = await getCurrentUser(); } catch (e) {}
  if (!user) {
    showToast('Log in on Members to save rides', true);
    return;
  }
  var name = prompt('Name this ride', 'Ride ' + new Date().toLocaleDateString());
  if (!name) return;
  name = name.trim();
  if (!name) return;

  var geojson = RideTracker.toGeoJSON(name);
  try {
    var result = await window.sb.from('member_routes').insert({
      user_id: user.id,
      name: name,
      description: 'Recorded ride · ' + (snap.elevGainM || 0) + ' m elev · ' + formatRideTime(snap.elapsedSec),
      distance_km: Math.round(snap.distanceKm * 100) / 100,
      geojson: geojson,
      is_public: false
    });
    if (result.error) throw result.error;
    showToast('Ride saved');
    loadMyRoutes();
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Save failed — is member_routes set up?', true);
  }
}

function downloadRideGPX() {
  if (!window.RideTracker) return;
  var gpx = RideTracker.toGPX('SB Racing Ride');
  if (!gpx) {
    showToast('No track to export', true);
    return;
  }
  var blob = new Blob([gpx], { type: 'application/gpx+xml' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'sb-ride-' + new Date().toISOString().slice(0, 10) + '.gpx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  showToast('GPX downloaded');
}

function escapeHtmlTrail(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Load poker-run checkpoints when opened via trails.html?event=ID */
var eventCheckpointMarkers = [];
var activeEventId = null;

function parseLocCoords(loc) {
  if (loc && loc.lat != null && loc.lng != null && !isNaN(Number(loc.lat)) && !isNaN(Number(loc.lng))) {
    return { lat: Number(loc.lat), lng: Number(loc.lng) };
  }
  var desc = (loc && loc.description) || '';
  var m = desc.match(/📍\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  return null;
}

async function loadEventCheckpointsOnMap(eventId) {
  if (!map || !window.sb || !eventId) return;
  activeEventId = eventId;
  eventCheckpointMarkers.forEach(function (m) {
    try { map.removeLayer(m); } catch (e) {}
  });
  eventCheckpointMarkers = [];

  var eventTitle = '';
  try {
    var evRes = await window.sb.from('events').select('id, title, category').eq('id', eventId).maybeSingle();
    if (evRes.data) eventTitle = evRes.data.title || '';
  } catch (e) {}

  var locs = [];
  try {
    var result = await window.sb
      .from('poker_locations')
      .select('id, name, description, lat, lng, sort_order')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true });
    if (result.error) {
      result = await window.sb
        .from('poker_locations')
        .select('id, name, description, sort_order')
        .eq('event_id', eventId)
        .order('sort_order', { ascending: true });
    }
    locs = result.data || [];
  } catch (e) {
    console.warn('[trails] event checkpoints', e);
  }

  var latlngs = [];
  locs.forEach(function (loc, i) {
    var c = parseLocCoords(loc);
    if (!c) return;
    latlngs.push([c.lat, c.lng]);
    var marker = L.marker([c.lat, c.lng], {
      icon: L.divIcon({
        className: '',
        html: '<div style="background:#f97316;color:#fff;width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700"><span style="transform:rotate(45deg)">' + (i + 1) + '</span></div>',
        iconSize: [28, 28],
        iconAnchor: [14, 28]
      })
    }).addTo(map);
    marker.bindTooltip((loc.name || ('Checkpoint ' + (i + 1))), { direction: 'top', permanent: false });
    eventCheckpointMarkers.push(marker);
  });

  // Banner under map tip area
  var banner = document.getElementById('event-ride-banner');
  if (!banner) {
    var wrap = document.getElementById('trail-map-wrap');
    if (wrap && wrap.parentNode) {
      banner = document.createElement('div');
      banner.id = 'event-ride-banner';
      banner.className = 'mt-2 rounded-2xl border border-orange-800/60 bg-orange-950/40 px-4 py-3 flex flex-wrap items-center justify-between gap-2';
      wrap.parentNode.insertBefore(banner, wrap.nextSibling);
    }
  }
  if (banner) {
    banner.innerHTML =
      '<div class="min-w-0">' +
      '<div class="text-xs uppercase tracking-wider text-orange-400 font-semibold">Event ride</div>' +
      '<div class="font-semibold truncate">' + escapeHtmlTrail(eventTitle || ('Event #' + eventId)) + '</div>' +
      '<div class="text-[11px] text-zinc-400">' + latlngs.length + ' checkpoint' + (latlngs.length === 1 ? '' : 's') + ' on map · use the green play button to track</div>' +
      '</div>' +
      '<button type="button" onclick="fabRideToggle()" class="shrink-0 px-4 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-sm font-semibold">' +
      '<i class="fa-solid fa-play mr-1"></i> Start tracking</button>';
  }

  if (latlngs.length) {
    try {
      map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 14 });
    } catch (e) {}
    showToast((eventTitle || 'Event') + ' · ' + latlngs.length + ' checkpoints loaded');
  } else {
    showToast('Event loaded — no mapped checkpoints yet', true);
  }
}

document.addEventListener('DOMContentLoaded', function () {
  initMap().then(function () {
    var q = new URLSearchParams(location.search);
    var eventId = q.get('event') || q.get('e');
    if (eventId) {
      loadEventCheckpointsOnMap(eventId);
    }
  }).catch(function () {});

  if (window.RideTracker) {
    RideTracker.onUpdate(function (snap) {
      updateRideUI(snap);
    });
    var recovered = RideTracker.initFromStorage();
    updateRideUI();
    if (recovered) {
      var s = RideTracker.getSnapshot();
      if (s.status === 'recording' || s.status === 'paused') {
        startRideTimer();
        showToast('Recovered in-progress ride (' + (s.pointCount || 0) + ' points)');
      } else if (s.pointCount >= 2) {
        showToast('Recovered last ride — save or export it');
      }
    }
  }
});
