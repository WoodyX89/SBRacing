// SB Racing — Member forum (posts, polls, images, comments, likes)

var forumUser = null;
var forumProfiles = {};
var forumMetaByPost = {}; // postId -> { likes, comments, options, votes }
var forumPostsById = {};
var forumRealtimeChannel = null;
var composerMode = 'post';
var pendingImageFile = null;
var pollOptionCount = 0;

function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeAgo(iso) {
  if (!iso) return '';
  var t = new Date(iso).getTime();
  var s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString();
}

function avatarHtml(userId, size) {
  size = size || 'w-10 h-10';
  var p = forumProfiles[userId] || {};
  var name = p.full_name || 'Member';
  var initial = (name.charAt(0) || 'M').toUpperCase();
  if (p.avatar_url) {
    return '<img src="' + esc(p.avatar_url) + '" alt="" class="' + size + ' rounded-full object-cover bg-zinc-800">';
  }
  return '<span class="' + size + ' rounded-full bg-orange-600 text-white flex items-center justify-center text-sm font-bold">' + esc(initial) + '</span>';
}

function displayName(userId) {
  var p = forumProfiles[userId];
  return (p && p.full_name) ? p.full_name : 'Member';
}

async function loadProfiles(userIds) {
  var ids = [];
  (userIds || []).forEach(function (id) {
    if (id && !forumProfiles[id]) ids.push(id);
  });
  if (!ids.length) return;
  try {
    var res = await window.sb.from('profiles').select('id, full_name, avatar_url').in('id', ids);
    if (res.data) {
      res.data.forEach(function (p) { forumProfiles[p.id] = p; });
    }
  } catch (e) {
    console.warn('[forum] profiles', e);
  }
}

function setComposerMode(mode) {
  composerMode = mode;
  var postTab = document.getElementById('tab-post');
  var pollTab = document.getElementById('tab-poll');
  var wrap = document.getElementById('poll-options-wrap');
  if (mode === 'poll') {
    postTab.className = 'px-4 py-2 rounded-2xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800';
    pollTab.className = 'px-4 py-2 rounded-2xl bg-orange-600 text-white font-semibold';
    wrap.classList.remove('hidden');
    if (!document.querySelectorAll('#poll-options-list input').length) {
      addPollOptionRow();
      addPollOptionRow();
    }
  } else {
    pollTab.className = 'px-4 py-2 rounded-2xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800';
    postTab.className = 'px-4 py-2 rounded-2xl bg-orange-600 text-white font-semibold';
    wrap.classList.add('hidden');
  }
}

function addPollOptionRow() {
  pollOptionCount++;
  var list = document.getElementById('poll-options-list');
  var row = document.createElement('div');
  row.className = 'flex gap-2';
  row.innerHTML =
    '<input type="text" class="poll-opt flex-1 bg-zinc-950 border border-zinc-700 rounded-2xl px-4 py-2 text-sm outline-none focus:border-orange-600" placeholder="Option ' + pollOptionCount + '">' +
    '<button type="button" class="px-3 text-zinc-500 hover:text-red-400" onclick="this.parentElement.remove()"><i class="fa-solid fa-times"></i></button>';
  list.appendChild(row);
}

function onForumImagePicked(e) {
  var file = e.target.files && e.target.files[0];
  pendingImageFile = file || null;
  var nameEl = document.getElementById('forum-image-name');
  var clearBtn = document.getElementById('forum-image-clear');
  var preview = document.getElementById('forum-image-preview');
  if (file) {
    nameEl.textContent = file.name;
    clearBtn.classList.remove('hidden');
    var url = URL.createObjectURL(file);
    preview.classList.remove('hidden');
    preview.querySelector('img').src = url;
  } else {
    clearForumImage();
  }
}

function clearForumImage() {
  pendingImageFile = null;
  var input = document.getElementById('forum-image');
  if (input) input.value = '';
  document.getElementById('forum-image-name').textContent = '';
  document.getElementById('forum-image-clear').classList.add('hidden');
  document.getElementById('forum-image-preview').classList.add('hidden');
}

async function uploadForumImage(file, userId) {
  var ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!ext) ext = 'jpg';
  var path = userId + '/' + Date.now() + '.' + ext;
  var res = await window.sb.storage.from('forum').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'image/jpeg'
  });
  if (res.error) throw res.error;
  var pub = window.sb.storage.from('forum').getPublicUrl(path);
  return pub.data.publicUrl;
}

async function submitForumPost() {
  if (!forumUser) {
    showToast('Log in to post', true);
    return;
  }
  var body = (document.getElementById('forum-body').value || '').trim();
  var options = [];
  if (composerMode === 'poll') {
    document.querySelectorAll('#poll-options-list .poll-opt').forEach(function (inp) {
      var v = (inp.value || '').trim();
      if (v) options.push(v);
    });
    if (options.length < 2) {
      showToast('Add at least 2 poll options', true);
      return;
    }
    if (!body) body = 'Poll';
  } else if (!body && !pendingImageFile) {
    showToast('Write something or add a photo', true);
    return;
  }

  try {
    var imageUrl = null;
    if (pendingImageFile) {
      imageUrl = await uploadForumImage(pendingImageFile, forumUser.id);
    }
    var insert = await window.sb.from('forum_posts').insert({
      user_id: forumUser.id,
      body: body,
      image_url: imageUrl,
      post_type: composerMode === 'poll' ? 'poll' : 'post'
    }).select('id').single();
    if (insert.error) throw insert.error;
    var postId = insert.data.id;

    if (composerMode === 'poll') {
      var rows = options.map(function (label, i) {
        return { post_id: postId, label: label, sort_order: i };
      });
      var optRes = await window.sb.from('forum_poll_options').insert(rows);
      if (optRes.error) throw optRes.error;
    }

    document.getElementById('forum-body').value = '';
    clearForumImage();
    document.getElementById('poll-options-list').innerHTML = '';
    pollOptionCount = 0;
    var wasPoll = composerMode === 'poll';
    setComposerMode('post');
    showToast('Posted');
    try {
      if (typeof notifyActivityAll === 'function') {
        await notifyActivityAll({
          title: wasPoll ? 'SB Racing · New poll' : 'SB Racing · Forum post',
          body: (body || (wasPoll ? 'New poll' : 'New photo post')).slice(0, 120),
          url: 'forum.html',
          type: wasPoll ? 'forum_poll' : 'forum_post'
        });
      }
    } catch (nerr) {
      console.warn(nerr);
    }
    await loadForumFeed();
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Post failed — run forum.sql?', true);
  }
}

function likesLabel(likes) {
  likes = likes || [];
  if (!likes.length) return '';
  var names = likes.map(function (l) { return displayName(l.user_id); });
  // unique preserve order
  var seen = {};
  names = names.filter(function (n) {
    if (seen[n]) return false;
    seen[n] = true;
    return true;
  });
  if (names.length === 1) return names[0] + ' liked this';
  if (names.length === 2) return names[0] + ' and ' + names[1] + ' liked this';
  if (names.length === 3) return names[0] + ', ' + names[1] + ' and ' + names[2] + ' liked this';
  return names[0] + ', ' + names[1] + ' and ' + (names.length - 2) + ' others liked this';
}

/** Update heart + names on one card only (no full feed refresh) */
function updatePostLikeUi(postId) {
  var meta = forumMetaByPost[postId] || { likes: [] };
  var likes = meta.likes || [];
  var liked = forumUser && likes.some(function (l) { return String(l.user_id) === String(forumUser.id); });
  var root = document.querySelector('[data-post-id="' + postId + '"]');
  if (!root) return;
  var btn = root.querySelector('[data-like-btn]');
  if (btn) {
    btn.className = liked
      ? 'text-orange-500 inline-flex items-center gap-1'
      : 'text-zinc-400 hover:text-orange-400 inline-flex items-center gap-1';
    btn.innerHTML =
      '<i class="fa-' + (liked ? 'solid' : 'regular') + ' fa-heart"></i>' +
      '<span data-like-count>' + likes.length + '</span>';
  }
  var namesEl = root.querySelector('[data-like-names]');
  if (namesEl) {
    namesEl.textContent = likesLabel(likes);
    namesEl.classList.toggle('hidden', !likes.length);
  }
}

async function toggleForumLike(postId) {
  if (!forumUser) {
    showToast('Log in to like', true);
    return;
  }
  postId = Number(postId);
  if (!forumMetaByPost[postId]) {
    forumMetaByPost[postId] = { likes: [], comments: [], options: [], votes: [] };
  }
  var likes = forumMetaByPost[postId].likes || [];
  var mine = likes.find(function (l) { return String(l.user_id) === String(forumUser.id); });

  // Optimistic UI
  if (mine) {
    forumMetaByPost[postId].likes = likes.filter(function (l) { return String(l.user_id) !== String(forumUser.id); });
  } else {
    forumMetaByPost[postId].likes = likes.concat([{ post_id: postId, user_id: forumUser.id }]);
    if (!forumProfiles[forumUser.id]) {
      forumProfiles[forumUser.id] = { id: forumUser.id, full_name: 'You' };
      try {
        var pr = await getProfile(forumUser.id);
        if (pr) forumProfiles[forumUser.id] = pr;
      } catch (e0) {}
    }
  }
  updatePostLikeUi(postId);
  try { if (typeof hapticSelection === 'function') hapticSelection(); } catch (eH) {}

  try {
    if (mine) {
      var del = await window.sb.from('forum_likes').delete()
        .eq('post_id', postId)
        .eq('user_id', forumUser.id);
      if (del.error) throw del.error;
    } else {
      var ins = await window.sb.from('forum_likes').insert({ post_id: postId, user_id: forumUser.id }).select('*').maybeSingle();
      if (ins.error) throw ins.error;
      if (ins.data) {
        // replace optimistic row with real row if ids matter
        forumMetaByPost[postId].likes = (forumMetaByPost[postId].likes || []).filter(function (l) {
          return String(l.user_id) !== String(forumUser.id);
        }).concat([ins.data]);
        updatePostLikeUi(postId);
      }
    }
  } catch (e) {
    // rollback
    if (mine) {
      forumMetaByPost[postId].likes = likes;
    } else {
      forumMetaByPost[postId].likes = likes.filter(function (l) { return String(l.user_id) !== String(forumUser.id); });
    }
    updatePostLikeUi(postId);
    showToast(e.message || 'Like failed', true);
  }
}

async function refreshLikesForPost(postId) {
  postId = Number(postId);
  try {
    var res = await window.sb.from('forum_likes').select('*').eq('post_id', postId);
    if (res.error) throw res.error;
    var likes = res.data || [];
    if (!forumMetaByPost[postId]) forumMetaByPost[postId] = { likes: [], comments: [], options: [], votes: [] };
    forumMetaByPost[postId].likes = likes;
    var uids = likes.map(function (l) { return l.user_id; });
    await loadProfiles(uids);
    updatePostLikeUi(postId);
  } catch (e) {
    console.warn('[forum] refresh likes', e);
  }
}

function subscribeForumRealtime() {
  if (!window.sb || forumRealtimeChannel) return;
  try {
    forumRealtimeChannel = window.sb
      .channel('forum-likes-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'forum_likes' }, function (payload) {
        var row = payload.new || payload.old;
        if (!row || row.post_id == null) return;
        var postId = Number(row.post_id);
        // Ignore if we don't have this post on screen
        if (!document.querySelector('[data-post-id="' + postId + '"]')) return;
        // Debounce rapid events per post
        clearTimeout(subscribeForumRealtime['_t' + postId]);
        subscribeForumRealtime['_t' + postId] = setTimeout(function () {
          refreshLikesForPost(postId);
        }, 80);
      })
      .subscribe(function (status) {
        console.log('[forum] realtime', status);
      });
  } catch (e) {
    console.warn('[forum] realtime setup failed', e);
  }
}

async function submitForumComment(postId) {
  if (!forumUser) {
    showToast('Log in to comment', true);
    return;
  }
  var input = document.getElementById('comment-input-' + postId);
  var body = input ? (input.value || '').trim() : '';
  if (!body) return;
  try {
    var res = await window.sb.from('forum_comments').insert({
      post_id: postId,
      user_id: forumUser.id,
      body: body
    });
    if (res.error) throw res.error;
    if (input) input.value = '';
    try {
      if (typeof notifyActivityAll === 'function') {
        await notifyActivityAll({
          title: 'SB Racing · Forum comment',
          body: body.slice(0, 120),
          url: 'forum.html',
          type: 'forum_comment'
        });
      }
    } catch (nerr) {
      console.warn(nerr);
    }
    await loadForumFeed();
  } catch (e) {
    showToast(e.message || 'Comment failed', true);
  }
}

async function votePoll(postId, optionId) {
  if (!forumUser) {
    showToast('Log in to vote', true);
    return;
  }
  try {
    // Upsert: one vote per user per poll
    var existing = await window.sb.from('forum_poll_votes')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', forumUser.id)
      .maybeSingle();
    if (existing.data) {
      var up = await window.sb.from('forum_poll_votes')
        .update({ option_id: optionId })
        .eq('id', existing.data.id);
      if (up.error) throw up.error;
    } else {
      var ins = await window.sb.from('forum_poll_votes').insert({
        post_id: postId,
        option_id: optionId,
        user_id: forumUser.id
      });
      if (ins.error) throw ins.error;
    }
    await loadForumFeed();
  } catch (e) {
    showToast(e.message || 'Vote failed', true);
  }
}

async function deleteForumPost(postId) {
  if (!confirm('Delete this post?')) return;
  try {
    var res = await window.sb.from('forum_posts').delete().eq('id', postId);
    if (res.error) throw res.error;
    showToast('Post deleted');
    await loadForumFeed();
  } catch (e) {
    showToast(e.message || 'Delete failed', true);
  }
}

async function deleteForumComment(commentId) {
  if (!confirm('Delete this comment?')) return;
  try {
    var res = await window.sb.from('forum_comments').delete().eq('id', commentId);
    if (res.error) throw res.error;
    showToast('Comment deleted');
    await loadForumFeed();
  } catch (e) {
    showToast(e.message || 'Delete failed', true);
  }
}

function renderPoll(post, options, votes, myVoteOptionId) {
  var total = votes.length;
  var counts = {};
  options.forEach(function (o) { counts[o.id] = 0; });
  votes.forEach(function (v) {
    if (counts[v.option_id] != null) counts[v.option_id]++;
  });

  return options.map(function (o) {
    var c = counts[o.id] || 0;
    var pct = total ? Math.round((c / total) * 100) : 0;
    var mine = myVoteOptionId === o.id;
    return (
      '<button type="button" onclick="votePoll(' + post.id + ',' + o.id + ')" ' +
      'class="w-full text-left relative overflow-hidden rounded-2xl border ' +
      (mine ? 'border-orange-600' : 'border-zinc-700') + ' px-4 py-3 mb-2 hover:border-zinc-500">' +
      '<div class="absolute inset-0 bg-orange-600/20" style="width:' + pct + '%"></div>' +
      '<div class="relative flex justify-between text-sm">' +
      '<span>' + esc(o.label) + (mine ? ' <i class="fa-solid fa-check text-orange-500"></i>' : '') + '</span>' +
      '<span class="text-zinc-400">' + pct + '% · ' + c + '</span>' +
      '</div></button>'
    );
  }).join('') +
  '<div class="text-xs text-zinc-500 mt-1">' + total + ' vote' + (total === 1 ? '' : 's') + '</div>';
}

function renderPostCard(post, meta) {
  var likes = meta.likes || [];
  var comments = meta.comments || [];
  var options = meta.options || [];
  var votes = meta.votes || [];
  var liked = forumUser && likes.some(function (l) { return l.user_id === forumUser.id; });
  var myVote = null;
  if (forumUser) {
    var mv = votes.find(function (v) { return v.user_id === forumUser.id; });
    if (mv) myVote = mv.option_id;
  }
  var isAdmin = forumUser && forumProfiles[forumUser.id] && forumProfiles[forumUser.id].is_admin;
  var canDelete = forumUser && (forumUser.id === post.user_id || isAdmin);

  var commentsHtml = comments.map(function (c) {
    var canDeleteComment = forumUser && (forumUser.id === c.user_id || isAdmin);
    return (
      '<div class="flex gap-2 py-2 border-t border-zinc-800 group">' +
      avatarHtml(c.user_id, 'w-7 h-7') +
      '<div class="min-w-0 flex-1">' +
      '<div class="text-xs flex items-center gap-2">' +
      '<span class="font-medium">' + esc(displayName(c.user_id)) + '</span>' +
      ' <span class="text-zinc-500">' + timeAgo(c.created_at) + '</span>' +
      (canDeleteComment
        ? '<button type="button" onclick="deleteForumComment(' + c.id + ')" class="ml-auto w-5 h-5 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center shrink-0" title="Delete comment"><i class="fa-solid fa-xmark text-[10px]"></i></button>'
        : '') +
      '</div>' +
      '<div class="text-sm text-zinc-300">' + esc(c.body) + '</div>' +
      '</div></div>'
    );
  }).join('');

  var cardInner =
    '<div class="flex items-start gap-3">' +
    avatarHtml(post.user_id) +
    '<div class="flex-1 min-w-0">' +
    '<div class="flex items-center gap-2 flex-wrap">' +
    '<span class="font-semibold text-sm">' + esc(displayName(post.user_id)) + '</span>' +
    '<span class="text-xs text-zinc-500">' + timeAgo(post.created_at) + '</span>' +
    (post.post_type === 'poll' ? '<span class="text-[10px] uppercase tracking-wide text-orange-500 border border-orange-900/50 px-1.5 py-0.5 rounded">Poll</span>' : '') +
    '</div>' +
    (post.body ? '<p class="mt-2 text-sm whitespace-pre-wrap">' + esc(post.body) + '</p>' : '') +
    (post.image_url
      ? '<a href="' + esc(post.image_url) + '" target="_blank" rel="noopener"><img src="' + esc(post.image_url) + '" alt="" class="mt-3 max-h-80 rounded-2xl border border-zinc-700 object-cover w-full"></a>'
      : '') +
    (post.post_type === 'poll' && options.length
      ? '<div class="mt-4">' + renderPoll(post, options, votes, myVote) + '</div>'
      : '') +
    '<div class="flex items-center gap-4 mt-4 text-sm">' +
    '<button type="button" data-like-btn onclick="toggleForumLike(' + post.id + ')" class="' +
    (liked ? 'text-orange-500' : 'text-zinc-400 hover:text-orange-400') + ' inline-flex items-center gap-1">' +
    '<i class="fa-' + (liked ? 'solid' : 'regular') + ' fa-heart"></i>' +
    '<span data-like-count>' + likes.length + '</span>' +
    '</button>' +
    '<span class="text-zinc-500"><i class="fa-regular fa-comment mr-1"></i>' + comments.length + '</span>' +
    '</div>' +
    '<div data-like-names class="text-xs text-zinc-500 mt-1.5 ' + (likes.length ? '' : 'hidden') + '">' +
    esc(likesLabel(likes)) +
    '</div>' +
    '<div class="mt-3 space-y-0">' + commentsHtml + '</div>' +
    '<div class="mt-3 flex gap-2">' +
    '<input id="comment-input-' + post.id + '" type="text" placeholder="Add a comment…" ' +
    'class="flex-1 bg-zinc-950 border border-zinc-700 rounded-2xl px-4 py-2 text-sm outline-none focus:border-orange-600" ' +
    'onkeydown="if(event.key===\'Enter\'){event.preventDefault();submitForumComment(' + post.id + ')}">' +
    '<button type="button" onclick="submitForumComment(' + post.id + ')" class="px-4 py-2 rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-sm">Send</button>' +
    '</div>' +
    '</div></div>';

  if (!canDelete) {
    return '<article data-post-id="' + post.id + '" class="bg-zinc-900 border border-zinc-800 rounded-3xl p-5">' + cardInner + '</article>';
  }

  // Swipeable card — reveal Delete action on swipe left
  return (
    '<div class="relative overflow-hidden rounded-3xl" data-swipe-post="' + post.id + '" data-post-id="' + post.id + '">' +
    '<div class="absolute inset-y-0 right-0 w-24 flex items-stretch">' +
    '<button type="button" onclick="deleteForumPost(' + post.id + ')" class="flex-1 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex flex-col items-center justify-center gap-1">' +
    '<i class="fa-solid fa-trash text-base"></i>Delete' +
    '</button></div>' +
    '<article class="relative bg-zinc-900 border border-zinc-800 rounded-3xl p-5 touch-pan-y transition-transform duration-200 will-change-transform" data-swipe-content>' +
    cardInner +
    '</article></div>'
  );
}

async function loadForumFeed() {
  var feed = document.getElementById('forum-feed');
  if (!feed) return;
  feed.innerHTML = '<div class="flex justify-center py-12 text-zinc-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>';

  try {
    var postsRes = await window.sb
      .from('forum_posts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (postsRes.error) throw postsRes.error;
    var posts = postsRes.data || [];
    if (!posts.length) {
      feed.innerHTML = '<p class="text-center text-zinc-500 py-10">No posts yet — be the first.</p>';
      return;
    }

    var ids = posts.map(function (p) { return p.id; });
    var userIds = posts.map(function (p) { return p.user_id; });

    var [likesRes, commentsRes, optionsRes, votesRes] = await Promise.all([
      window.sb.from('forum_likes').select('*').in('post_id', ids),
      window.sb.from('forum_comments').select('*').in('post_id', ids).order('created_at', { ascending: true }),
      window.sb.from('forum_poll_options').select('*').in('post_id', ids).order('sort_order'),
      window.sb.from('forum_poll_votes').select('*').in('post_id', ids)
    ]);

    var likes = likesRes.data || [];
    var comments = commentsRes.data || [];
    var options = optionsRes.data || [];
    var votes = votesRes.data || [];

    comments.forEach(function (c) { userIds.push(c.user_id); });
    await loadProfiles(userIds);

    likes.forEach(function (l) { userIds.push(l.user_id); });
    await loadProfiles(userIds);

    feed.innerHTML = posts.map(function (post) {
      var meta = {
        likes: likes.filter(function (l) { return l.post_id === post.id; }),
        comments: comments.filter(function (c) { return c.post_id === post.id; }),
        options: options.filter(function (o) { return o.post_id === post.id; }),
        votes: votes.filter(function (v) { return v.post_id === post.id; })
      };
      forumMetaByPost[post.id] = meta;
      forumPostsById[post.id] = post;
      return renderPostCard(post, meta);
    }).join('');
    initSwipeToDelete(feed);
    subscribeForumRealtime();
  } catch (e) {
    console.error(e);
    feed.innerHTML = '<p class="text-center text-red-400 py-10">' + esc(e.message || 'Could not load feed') +
      '<br><span class="text-xs text-zinc-500">Run supabase/forum.sql in Supabase if tables are missing.</span></p>';
  }
}

/** Native-style swipe-left to reveal Delete on own/admin posts */
function initSwipeToDelete(container) {
  if (!container) return;
  var openEl = null;
  var startX = 0;
  var startY = 0;
  var currentX = 0;
  var tracking = false;
  var horizontal = null;
  var content = null;
  var maxSwipe = -96; // width of the delete panel

  function closeOpen() {
    if (openEl) {
      openEl.style.transform = 'translateX(0)';
      openEl = null;
    }
  }

  container.querySelectorAll('[data-swipe-post]').forEach(function (wrap) {
    var article = wrap.querySelector('[data-swipe-content]');
    if (!article) return;

    article.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      // Close any other open swipe
      if (openEl && openEl !== article) closeOpen();
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      currentX = 0;
      tracking = true;
      horizontal = null;
      content = article;
      article.style.transition = 'none';
    }, { passive: true });

    article.addEventListener('touchmove', function (e) {
      if (!tracking || !content) return;
      var dx = e.touches[0].clientX - startX;
      var dy = e.touches[0].clientY - startY;

      if (horizontal === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        horizontal = Math.abs(dx) > Math.abs(dy);
        if (!horizontal) {
          tracking = false;
          return;
        }
      }
      if (!horizontal) return;

      // Only allow left swipe
      currentX = Math.min(0, Math.max(maxSwipe, dx));
      content.style.transform = 'translateX(' + currentX + 'px)';
    }, { passive: true });

    article.addEventListener('touchend', function () {
      if (!tracking || !content) return;
      tracking = false;
      content.style.transition = 'transform 0.2s ease';
      if (currentX < maxSwipe / 2) {
        // Snap open
        content.style.transform = 'translateX(' + maxSwipe + 'px)';
        openEl = content;
      } else {
        content.style.transform = 'translateX(0)';
        if (openEl === content) openEl = null;
      }
      content = null;
    });

    // Tap outside / on card to close
    article.addEventListener('click', function (e) {
      if (openEl === article && currentX < -10) {
        // If already open, a tap closes it (unless they hit the delete button)
        e.preventDefault();
        e.stopPropagation();
        closeOpen();
      }
    });
  });
}

async function initForum() {
  forumUser = null;
  try {
    forumUser = await getCurrentUser();
  } catch (e) {}

  var wall = document.getElementById('forum-login-wall');
  var app = document.getElementById('forum-app');
  if (!forumUser) {
    if (wall) wall.classList.remove('hidden');
    if (app) app.classList.add('hidden');
    return;
  }
  if (wall) wall.classList.add('hidden');
  if (app) app.classList.remove('hidden');
  forumProfiles[forumUser.id] = forumProfiles[forumUser.id] || {};
  try {
    var pr = await getProfile(forumUser.id);
    if (pr) forumProfiles[forumUser.id] = pr;
  } catch (e) {}
  await loadForumFeed();
  subscribeForumRealtime();
}

document.addEventListener('DOMContentLoaded', function () {
  setTimeout(initForum, 100);
});
