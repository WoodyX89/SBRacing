// Soggy Scoop — news feed (public read, admin create/edit/delete + image upload)

let newsPosts = [];
let newsIsAdmin = false;
let newsEditingId = null;
let newsPendingImageUrl = null; // set after successful upload or when editing

const NEWS_CATEGORY_META = {
  club:  { label: 'Club',  icon: 'fa-flag',            accent: 'border-l-orange-500' },
  event: { label: 'Event', icon: 'fa-calendar-days',   accent: 'border-l-zinc-500' },
  ride:  { label: 'Ride',  icon: 'fa-bicycle',         accent: 'border-l-orange-600' },
  alert: { label: 'Alert', icon: 'fa-triangle-exclamation', accent: 'border-l-amber-500' }
};

function newsClient() {
  return window.sb || null;
}

async function initHomeFeed() {
  await checkNewsAdmin();
  await loadNewsPosts();
  bindNewsAdminUI();
}

async function checkNewsAdmin() {
  newsIsAdmin = false;
  const client = newsClient();
  if (!client) return;
  try {
    let user = null;
    if (typeof getSessionFromStorage === 'function') {
      const s = getSessionFromStorage();
      user = s && s.user;
    }
    if (!user) {
      const { data } = await client.auth.getSession();
      user = data && data.session && data.session.user;
    }
    if (!user) return;
    const { data: profile } = await client
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();
    newsIsAdmin = !!(profile && profile.is_admin);
  } catch (e) {
    console.warn('[news] admin check', e);
  }

  const bar = document.getElementById('news-admin-bar');
  if (bar) bar.classList.toggle('hidden', !newsIsAdmin);
}

async function loadNewsPosts() {
  const loading = document.getElementById('feed-loading');
  const empty = document.getElementById('feed-empty');
  if (loading) loading.classList.remove('hidden');
  if (empty) empty.classList.add('hidden');

  const client = newsClient();
  if (!client) {
    if (loading) loading.classList.add('hidden');
    if (empty) empty.classList.remove('hidden');
    return;
  }

  try {
    const { data, error } = await client
      .from('news_posts')
      .select('*')
      .eq('published', true)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    newsPosts = data || [];
  } catch (err) {
    console.warn('[news] load failed', err);
    newsPosts = [];
  }

  if (loading) loading.classList.add('hidden');
  renderNewsFeed();
}

function renderNewsFeed() {
  const feed = document.getElementById('home-feed');
  const empty = document.getElementById('feed-empty');
  if (!feed) return;

  if (!newsPosts.length) {
    feed.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  feed.innerHTML = newsPosts.map(function (post) {
    const meta = NEWS_CATEGORY_META[post.category] || NEWS_CATEGORY_META.club;
    const when = formatNewsTime(post.created_at);
    const pin = post.is_pinned
      ? '<span class="text-[10px] uppercase tracking-wider text-orange-500 font-semibold">Pinned</span>'
      : '';
    const link = post.link_url
      ? '<a href="' + escapeHtml(post.link_url) + '" class="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-orange-500 hover:text-orange-400">' +
        (escapeHtml(post.link_label || 'Open') + ' <i class="fa-solid fa-arrow-right text-[10px]"></i></a>')
      : '';
    const img = post.image_url
      ? '<div class="mt-3 -mx-0 overflow-hidden rounded-xl border border-zinc-800">' +
        '<img src="' + escapeHtml(post.image_url) + '" alt="" class="w-full max-h-72 object-cover" loading="lazy"></div>'
      : '';
    const adminBtns = newsIsAdmin
      ? '<div class="flex gap-2 mt-3 pt-3 border-t border-zinc-800">' +
        '<button type="button" onclick="editNewsPost(' + post.id + ')" class="text-xs px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300">Edit</button>' +
        '<button type="button" onclick="deleteNewsPost(' + post.id + ')" class="text-xs px-3 py-1.5 rounded-xl bg-red-950/60 hover:bg-red-900/60 text-red-400">Delete</button>' +
        '</div>'
      : '';

    return (
      '<article class="border-l-4 ' + meta.accent + ' rounded-2xl bg-zinc-900 border border-zinc-800 p-4">' +
        '<div class="flex items-start gap-3">' +
          '<div class="w-9 h-9 rounded-xl bg-zinc-800 flex items-center justify-center shrink-0 text-zinc-400">' +
            '<i class="fa-solid ' + meta.icon + ' text-sm"></i>' +
          '</div>' +
          '<div class="min-w-0 flex-1">' +
            '<div class="flex items-center gap-2 flex-wrap mb-0.5">' +
              '<span class="text-[10px] uppercase tracking-wider text-zinc-500">' + meta.label + '</span>' +
              pin +
              '<span class="text-[10px] text-zinc-600 ml-auto">' + when + '</span>' +
            '</div>' +
            '<h3 class="font-semibold text-sm text-white leading-snug">' + escapeHtml(post.title) + '</h3>' +
            img +
            '<p class="text-xs text-zinc-400 mt-1.5 leading-relaxed whitespace-pre-wrap">' + escapeHtml(post.body) + '</p>' +
            link +
            adminBtns +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }).join('');
}

function formatNewsTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60 * 60 * 1000) return Math.max(1, Math.round(diff / 60000)) + 'm ago';
    if (diff < 24 * 60 * 60 * 1000) return Math.round(diff / 3600000) + 'h ago';
    if (diff < 7 * 24 * 60 * 60 * 1000) return Math.round(diff / 86400000) + 'd ago';
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  } catch (e) {
    return '';
  }
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setNewsImagePreview(url) {
  newsPendingImageUrl = url || null;
  const hidden = document.getElementById('news-image-url');
  const wrap = document.getElementById('news-image-preview-wrap');
  const img = document.getElementById('news-image-preview');
  const clearBtn = document.getElementById('news-image-clear');
  if (hidden) hidden.value = url || '';
  if (url) {
    if (img) img.src = url;
    if (wrap) wrap.classList.remove('hidden');
    if (clearBtn) clearBtn.classList.remove('hidden');
  } else {
    if (img) img.src = '';
    if (wrap) wrap.classList.add('hidden');
    if (clearBtn) clearBtn.classList.add('hidden');
  }
}

function setNewsImageStatus(msg, isError) {
  const el = document.getElementById('news-image-status');
  if (!el) return;
  if (!msg) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.toggle('text-red-400', !!isError);
  el.classList.toggle('text-zinc-500', !isError);
}

async function uploadNewsImage(file) {
  if (!newsIsAdmin) {
    if (typeof showToast === 'function') showToast('Admins only', true);
    return;
  }
  const client = newsClient();
  if (!client) {
    if (typeof showToast === 'function') showToast('Supabase not loaded', true);
    return;
  }
  if (!file || !file.type || file.type.indexOf('image/') !== 0) {
    if (typeof showToast === 'function') showToast('Choose an image file', true);
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    if (typeof showToast === 'function') showToast('Image must be under 5 MB', true);
    return;
  }

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = 'posts/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;

  setNewsImageStatus('Uploading…');
  try {
    const { error } = await client.storage.from('news').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'image/jpeg'
    });
    if (error) throw error;
    const { data: pub } = client.storage.from('news').getPublicUrl(path);
    const url = pub && pub.publicUrl ? pub.publicUrl + '?t=' + Date.now() : null;
    if (!url) throw new Error('No public URL returned');
    setNewsImagePreview(url);
    setNewsImageStatus('Photo ready');
    if (typeof showToast === 'function') showToast('Photo uploaded');
  } catch (err) {
    console.error('[news] image upload', err);
    setNewsImageStatus(err.message || 'Upload failed — run supabase/news_feed.sql?', true);
    if (typeof showToast === 'function') {
      showToast(err.message || 'Upload failed', true);
    }
  }
}

function bindNewsAdminUI() {
  const openBtn = document.getElementById('news-compose-open');
  const cancelBtn = document.getElementById('news-compose-cancel');
  const saveBtn = document.getElementById('news-compose-save');
  const form = document.getElementById('news-compose-form');
  const fileInput = document.getElementById('news-image-file');
  const clearBtn = document.getElementById('news-image-clear');

  if (openBtn) {
    openBtn.addEventListener('click', function () {
      newsEditingId = null;
      resetNewsForm();
      if (form) form.classList.remove('hidden');
      openBtn.classList.add('hidden');
    });
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      newsEditingId = null;
      resetNewsForm();
      if (form) form.classList.add('hidden');
      if (openBtn) openBtn.classList.remove('hidden');
    });
  }
  if (saveBtn) {
    saveBtn.addEventListener('click', saveNewsPost);
  }
  if (fileInput) {
    fileInput.addEventListener('change', function () {
      const file = fileInput.files && fileInput.files[0];
      if (file) uploadNewsImage(file);
      fileInput.value = '';
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      setNewsImagePreview(null);
      setNewsImageStatus('');
    });
  }

  const refresh = document.getElementById('refresh-feed');
  if (refresh) {
    refresh.addEventListener('click', function () {
      loadNewsPosts();
    });
  }
}

function resetNewsForm() {
  const title = document.getElementById('news-title');
  const body = document.getElementById('news-body');
  const category = document.getElementById('news-category');
  const linkUrl = document.getElementById('news-link-url');
  const linkLabel = document.getElementById('news-link-label');
  const pinned = document.getElementById('news-pinned');
  const heading = document.getElementById('news-compose-heading');
  const fileInput = document.getElementById('news-image-file');
  if (title) title.value = '';
  if (body) body.value = '';
  if (category) category.value = 'club';
  if (linkUrl) linkUrl.value = '';
  if (linkLabel) linkLabel.value = '';
  if (pinned) pinned.checked = false;
  if (heading) heading.textContent = 'New post';
  if (fileInput) fileInput.value = '';
  setNewsImagePreview(null);
  setNewsImageStatus('');
}

function editNewsPost(id) {
  if (!newsIsAdmin) return;
  const post = newsPosts.find(function (p) { return p.id === id; });
  if (!post) return;
  newsEditingId = id;
  const title = document.getElementById('news-title');
  const body = document.getElementById('news-body');
  const category = document.getElementById('news-category');
  const linkUrl = document.getElementById('news-link-url');
  const linkLabel = document.getElementById('news-link-label');
  const pinned = document.getElementById('news-pinned');
  const form = document.getElementById('news-compose-form');
  const openBtn = document.getElementById('news-compose-open');
  const heading = document.getElementById('news-compose-heading');
  if (title) title.value = post.title || '';
  if (body) body.value = post.body || '';
  if (category) category.value = post.category || 'club';
  if (linkUrl) linkUrl.value = post.link_url || '';
  if (linkLabel) linkLabel.value = post.link_label || '';
  if (pinned) pinned.checked = !!post.is_pinned;
  setNewsImagePreview(post.image_url || null);
  setNewsImageStatus(post.image_url ? 'Current photo' : '');
  if (heading) heading.textContent = 'Edit post';
  if (form) form.classList.remove('hidden');
  if (openBtn) openBtn.classList.add('hidden');
  if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveNewsPost() {
  if (!newsIsAdmin) {
    if (typeof showToast === 'function') showToast('Admins only', true);
    return;
  }
  const client = newsClient();
  if (!client) return;

  const title = (document.getElementById('news-title') || {}).value || '';
  const body = (document.getElementById('news-body') || {}).value || '';
  const category = (document.getElementById('news-category') || {}).value || 'club';
  const linkUrl = ((document.getElementById('news-link-url') || {}).value || '').trim();
  const linkLabel = ((document.getElementById('news-link-label') || {}).value || '').trim();
  const pinned = !!(document.getElementById('news-pinned') || {}).checked;
  const imageUrl = newsPendingImageUrl || ((document.getElementById('news-image-url') || {}).value || '').trim() || null;

  if (!title.trim() || !body.trim()) {
    if (typeof showToast === 'function') showToast('Title and body required', true);
    return;
  }

  const payload = {
    title: title.trim(),
    body: body.trim(),
    category: category,
    link_url: linkUrl || null,
    link_label: linkLabel || null,
    image_url: imageUrl || null,
    is_pinned: pinned,
    published: true,
    updated_at: new Date().toISOString()
  };

  const saveBtn = document.getElementById('news-compose-save');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
  }

  try {
    let error;
    if (newsEditingId) {
      ({ error } = await client.from('news_posts').update(payload).eq('id', newsEditingId));
    } else {
      let userId = null;
      try {
        const { data } = await client.auth.getSession();
        userId = data && data.session && data.session.user && data.session.user.id;
      } catch (e) {}
      payload.created_by = userId;
      ({ error } = await client.from('news_posts').insert(payload));
    }
    if (error) throw error;

    if (typeof showToast === 'function') showToast(newsEditingId ? 'Post updated' : 'Post published');
    newsEditingId = null;
    resetNewsForm();
    const form = document.getElementById('news-compose-form');
    const openBtn = document.getElementById('news-compose-open');
    if (form) form.classList.add('hidden');
    if (openBtn) openBtn.classList.remove('hidden');
    await loadNewsPosts();
  } catch (err) {
    console.error('[news] save', err);
    if (typeof showToast === 'function') {
      showToast(err.message || 'Save failed — run supabase/news_feed.sql?', true);
    }
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Publish';
    }
  }
}

async function deleteNewsPost(id) {
  if (!newsIsAdmin) return;
  if (!confirm('Delete this post?')) return;
  const client = newsClient();
  if (!client) return;
  try {
    const { error } = await client.from('news_posts').delete().eq('id', id);
    if (error) throw error;
    if (typeof showToast === 'function') showToast('Post deleted');
    await loadNewsPosts();
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'Delete failed', true);
  }
}

window.editNewsPost = editNewsPost;
window.deleteNewsPost = deleteNewsPost;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(initHomeFeed, 150);
  });
} else {
  setTimeout(initHomeFeed, 150);
}
