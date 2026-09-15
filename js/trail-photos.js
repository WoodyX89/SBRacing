/**
 * SB Racing — member trail photo gallery
 * Uploads go to the `trail-photos` Storage bucket + `trail_photos` table.
 */
(function () {
  var BUCKET = 'trail-photos';
  var MAX_BYTES = 8 * 1024 * 1024;
  var MAX_EDGE = 1600;
  var JPEG_QUALITY = 0.82;

  var cacheByName = {};
  var cacheLoaded = false;
  var cachePromise = null;
  var pendingUpload = null;
  var galleryState = { photos: [], index: 0, trailName: '', trailId: '' };
  var swipe = { x: 0, y: 0, active: false };

  function esc(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normName(name) {
    return String(name || '').trim();
  }

  function cacheKey(name) {
    return normName(name).toLowerCase();
  }

  function getStaticPhotos(name, area, diff) {
    var info = (typeof getTrailDescription === 'function')
      ? getTrailDescription(name, area, diff)
      : null;
    var list = (info && info.photos) ? info.photos : [];
    return list.map(function (src) {
      return {
        id: 'static:' + src,
        image_url: src,
        caption: '',
        user_id: null,
        isStatic: true
      };
    });
  }

  function memberPhotosFor(name) {
    return cacheByName[cacheKey(name)] || [];
  }

  function allPhotosFor(name, area, diff) {
    var members = memberPhotosFor(name);
    var statics = getStaticPhotos(name, area, diff);
    // Member uploads first (newest already first), then bundled fallbacks
    // if there are no member shots yet — always keep statics as extras
    // so a trail never looks empty.
    var urls = {};
    var out = [];
    members.concat(statics).forEach(function (p) {
      if (!p || !p.image_url || urls[p.image_url]) return;
      urls[p.image_url] = true;
      out.push(p);
    });
    return out;
  }

  async function loadAllPhotos(force) {
    if (cacheLoaded && !force) return cacheByName;
    if (cachePromise && !force) return cachePromise;
    cachePromise = (async function () {
      if (!window.sb) return cacheByName;
      try {
        var res = await window.sb
          .from('trail_photos')
          .select('id, trail_name, trail_id, user_id, image_url, storage_path, caption, created_at')
          .order('created_at', { ascending: false })
          .limit(2000);
        if (res.error) throw res.error;
        var next = {};
        (res.data || []).forEach(function (row) {
          var k = cacheKey(row.trail_name);
          if (!next[k]) next[k] = [];
          next[k].push(row);
        });
        cacheByName = next;
        cacheLoaded = true;
      } catch (e) {
        console.warn('[trail-photos] load', e);
      }
      return cacheByName;
    })();
    return cachePromise;
  }

  function addToCache(row) {
    var k = cacheKey(row.trail_name);
    if (!cacheByName[k]) cacheByName[k] = [];
    cacheByName[k] = [row].concat(cacheByName[k].filter(function (r) { return r.id !== row.id; }));
  }

  function removeFromCache(id) {
    Object.keys(cacheByName).forEach(function (k) {
      cacheByName[k] = cacheByName[k].filter(function (r) { return r.id !== id; });
    });
  }

  function findTrail(trailId) {
    if (!trailId || typeof trailFeatures === 'undefined') return null;
    return trailFeatures.find(function (tf) { return tf.id === trailId; }) || null;
  }

  function refreshOpenPopup(trailId) {
    var trail = findTrail(trailId);
    if (!trail || !trail.layer || typeof buildTrailPopupHtml !== 'function') return;
    var html = buildTrailPopupHtml(trail.name, trail.difficulty, trail.area, trail.id);
    try {
      trail.layer.setPopupContent(html);
    } catch (e) {}
  }

  function ensureOverlay() {
    if (document.getElementById('trail-gallery')) return;
    var wrap = document.createElement('div');
    wrap.id = 'trail-gallery';
    wrap.className = 'trail-gallery hidden';
    wrap.innerHTML =
      '<button type="button" class="trail-gallery-close" onclick="closeTrailGallery()" aria-label="Close">' +
      '<i class="fa-solid fa-xmark"></i></button>' +
      '<button type="button" class="trail-gallery-nav prev" onclick="trailGalleryStep(-1)" aria-label="Previous">' +
      '<i class="fa-solid fa-chevron-left"></i></button>' +
      '<button type="button" class="trail-gallery-nav next" onclick="trailGalleryStep(1)" aria-label="Next">' +
      '<i class="fa-solid fa-chevron-right"></i></button>' +
      '<div class="trail-gallery-stage" id="trail-gallery-stage">' +
      '  <img id="trail-gallery-img" alt="">' +
      '</div>' +
      '<div class="trail-gallery-meta">' +
      '  <div class="trail-gallery-title" id="trail-gallery-title"></div>' +
      '  <div class="trail-gallery-count" id="trail-gallery-count"></div>' +
      '  <div class="trail-gallery-caption" id="trail-gallery-caption"></div>' +
      '  <button type="button" class="trail-gallery-delete hidden" id="trail-gallery-delete" onclick="deleteCurrentTrailPhoto()">' +
      '    <i class="fa-solid fa-trash"></i> Delete my photo' +
      '  </button>' +
      '</div>' +
      '<div class="trail-gallery-dots" id="trail-gallery-dots"></div>';
    document.body.appendChild(wrap);

    var stage = document.getElementById('trail-gallery-stage');
    stage.addEventListener('touchstart', onSwipeStart, { passive: true });
    stage.addEventListener('touchmove', onSwipeMove, { passive: true });
    stage.addEventListener('touchend', onSwipeEnd);
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) closeTrailGallery();
    });
    document.addEventListener('keydown', function (e) {
      if (wrap.classList.contains('hidden')) return;
      if (e.key === 'Escape') closeTrailGallery();
      if (e.key === 'ArrowLeft') trailGalleryStep(-1);
      if (e.key === 'ArrowRight') trailGalleryStep(1);
    });
  }

  function ensureFileInput() {
    var input = document.getElementById('trail-photo-input');
    if (input) return input;
    input = document.createElement('input');
    input.id = 'trail-photo-input';
    input.type = 'file';
    input.accept = 'image/*';
    input.className = 'hidden';
    input.addEventListener('change', onPhotoPicked);
    document.body.appendChild(input);
    return input;
  }

  function onSwipeStart(e) {
    var t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    swipe.active = true;
    swipe.x = t.clientX;
    swipe.y = t.clientY;
  }

  function onSwipeMove() {}

  function onSwipeEnd(e) {
    if (!swipe.active) return;
    swipe.active = false;
    var t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    var dx = t.clientX - swipe.x;
    var dy = t.clientY - swipe.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    trailGalleryStep(dx < 0 ? 1 : -1);
  }

  function renderGallery() {
    var photos = galleryState.photos;
    if (!photos.length) return;
    if (galleryState.index < 0) galleryState.index = photos.length - 1;
    if (galleryState.index >= photos.length) galleryState.index = 0;
    var photo = photos[galleryState.index];
    var img = document.getElementById('trail-gallery-img');
    var title = document.getElementById('trail-gallery-title');
    var count = document.getElementById('trail-gallery-count');
    var caption = document.getElementById('trail-gallery-caption');
    var del = document.getElementById('trail-gallery-delete');
    var dots = document.getElementById('trail-gallery-dots');
    img.src = photo.image_url;
    title.textContent = galleryState.trailName || 'Trail photos';
    count.textContent = (galleryState.index + 1) + ' / ' + photos.length;
    caption.textContent = photo.caption || (photo.isStatic ? 'Club photo' : 'Member photo');
    var me = window._trailPhotoUserId;
    var canDelete = !photo.isStatic && photo.user_id && me && photo.user_id === me;
    del.classList.toggle('hidden', !canDelete);

    var maxDots = Math.min(photos.length, 12);
    var html = '';
    for (var i = 0; i < maxDots; i++) {
      var idx = photos.length <= 12 ? i : Math.round(i * (photos.length - 1) / (maxDots - 1));
      html += '<button type="button" class="trail-gallery-dot' +
        (idx === galleryState.index ? ' active' : '') +
        '" onclick="trailGalleryGo(' + idx + ')"></button>';
    }
    dots.innerHTML = html;
  }

  window.openTrailGallery = function (trailId, startIndex) {
    var trail = findTrail(trailId);
    var name = trail ? trail.name : '';
    var area = trail ? trail.area : '';
    var diff = trail ? trail.difficulty : '';
    var photos = allPhotosFor(name, area, diff);
    if (!photos.length) {
      if (typeof showToast === 'function') showToast('No photos yet — add the first one', true);
      return;
    }
    ensureOverlay();
    galleryState.photos = photos;
    galleryState.index = startIndex || 0;
    galleryState.trailName = name;
    galleryState.trailId = trailId;
    renderGallery();
    document.getElementById('trail-gallery').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  };

  window.closeTrailGallery = function () {
    var el = document.getElementById('trail-gallery');
    if (el) el.classList.add('hidden');
    document.body.style.overflow = '';
  };

  window.trailGalleryStep = function (dir) {
    galleryState.index += dir;
    renderGallery();
  };

  window.trailGalleryGo = function (idx) {
    galleryState.index = idx;
    renderGallery();
  };

  window.startTrailPhotoUpload = async function (trailId) {
    var trail = findTrail(trailId);
    if (!trail) return;
    var user = null;
    try {
      if (typeof getCurrentUser === 'function') user = await getCurrentUser();
    } catch (e) {}
    if (!user) {
      if (typeof showToast === 'function') showToast('Log in on Members to add photos', true);
      return;
    }
    window._trailPhotoUserId = user.id;
    pendingUpload = { trailId: trail.id, trailName: trail.name, userId: user.id };
    var input = ensureFileInput();
    input.value = '';
    input.click();
  };

  async function onPhotoPicked(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !pendingUpload) return;
    if (file.size > 20 * 1024 * 1024) {
      if (typeof showToast === 'function') showToast('Photo is too large (max ~8 MB after compress)', true);
      return;
    }
    if (typeof showToast === 'function') showToast('Uploading photo…');
    try {
      var prepared = await prepareImage(file);
      var row = await uploadPhoto(prepared, pendingUpload);
      addToCache(row);
      refreshOpenPopup(pendingUpload.trailId);
      if (typeof showToast === 'function') showToast('Photo added to ' + pendingUpload.trailName);
    } catch (err) {
      console.error('[trail-photos] upload', err);
      var msg = (err && err.message) || 'Upload failed';
      if (/bucket|not found|row-level|policy|42501/i.test(msg)) {
        msg = 'Upload blocked — run supabase/trail_photos.sql in the SQL editor';
      }
      if (typeof showToast === 'function') showToast(msg, true);
    }
    pendingUpload = null;
  }

  function prepareImage(file) {
    return new Promise(function (resolve) {
      if (!file.type || file.type.indexOf('image/') !== 0) {
        resolve(file);
        return;
      }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = cw;
          canvas.height = ch;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, cw, ch);
          canvas.toBlob(function (blob) {
            URL.revokeObjectURL(url);
            if (!blob) {
              resolve(file);
              return;
            }
            var out = new File([blob], 'trail.jpg', { type: 'image/jpeg' });
            if (out.size > MAX_BYTES) {
              canvas.toBlob(function (smaller) {
                resolve(smaller ? new File([smaller], 'trail.jpg', { type: 'image/jpeg' }) : file);
              }, 'image/jpeg', 0.65);
            } else {
              resolve(out);
            }
          }, 'image/jpeg', JPEG_QUALITY);
        } catch (err) {
          URL.revokeObjectURL(url);
          resolve(file);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      img.src = url;
    });
  }

  async function uploadPhoto(file, ctx) {
    if (!window.sb) throw new Error('Supabase is not ready');
    var ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!ext || ext === 'jpeg') ext = 'jpg';
    var slug = cacheKey(ctx.trailName).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trail';
    var path = ctx.userId + '/' + slug + '/' + Date.now() + '.' + ext;
    var up = await window.sb.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'image/jpeg'
    });
    if (up.error) throw up.error;
    var pub = window.sb.storage.from(BUCKET).getPublicUrl(path);
    var url = pub && pub.data && pub.data.publicUrl;
    if (!url) throw new Error('Could not get photo URL');
    var ins = await window.sb.from('trail_photos').insert({
      trail_name: ctx.trailName,
      trail_id: ctx.trailId || null,
      user_id: ctx.userId,
      image_url: url,
      storage_path: path,
      caption: null
    }).select('id, trail_name, trail_id, user_id, image_url, storage_path, caption, created_at').single();
    if (ins.error) throw ins.error;
    return ins.data;
  }

  window.deleteCurrentTrailPhoto = async function () {
    var photo = galleryState.photos[galleryState.index];
    if (!photo || photo.isStatic || !photo.id) return;
    if (!window.confirm('Delete this photo?')) return;
    try {
      if (photo.storage_path) {
        await window.sb.storage.from(BUCKET).remove([photo.storage_path]);
      }
      var del = await window.sb.from('trail_photos').delete().eq('id', photo.id);
      if (del.error) throw del.error;
      removeFromCache(photo.id);
      galleryState.photos.splice(galleryState.index, 1);
      refreshOpenPopup(galleryState.trailId);
      if (!galleryState.photos.length) {
        closeTrailGallery();
      } else {
        renderGallery();
      }
      if (typeof showToast === 'function') showToast('Photo deleted');
    } catch (e) {
      if (typeof showToast === 'function') showToast((e && e.message) || 'Could not delete', true);
    }
  };

  window.getTrailGalleryPhotos = function (name, area, diff) {
    return allPhotosFor(name, area, diff);
  };

  window.trailPhotosReady = loadAllPhotos();

  document.addEventListener('DOMContentLoaded', function () {
    ensureFileInput();
    ensureOverlay();
    loadAllPhotos().then(function () {
      getCurrentUser().then(function (user) {
        if (user) window._trailPhotoUserId = user.id;
      }).catch(function () {});
    });
  });
})();
