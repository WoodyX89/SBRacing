// Merchandise — load from Supabase + admin CRUD

let allProducts = [];
let isAdmin = false;
let editingProductId = null;

async function initMerch() {
  try {
    await Promise.race([
      checkAdmin(),
      new Promise(function (r) { setTimeout(r, 3000); })
    ]);
  } catch (e) {
    console.warn('[merch] checkAdmin', e);
    isAdmin = false;
  }
  await loadProducts();
  if (isAdmin) showAdminUI();
  console.log('[merch] loaded', allProducts.length, 'products, admin=', isAdmin);
}

async function checkAdmin() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      isAdmin = false;
      return;
    }
    const profile = await getProfile(user.id);
    isAdmin = !!(profile && profile.is_admin);
  } catch (e) {
    isAdmin = false;
  }
}

async function loadProducts() {
  const grid = document.getElementById('products-grid');
  if (!grid) return;

  grid.innerHTML = `
    <div class="col-span-full flex justify-center py-16 text-zinc-500">
      <i class="fa-solid fa-spinner fa-spin text-2xl"></i>
    </div>`;

  try {
    let data = null;
    const clientQuery = (async () => {
      let query = window.sb.from('products').select('*').order('sort_order', { ascending: true });
      if (!isAdmin) query = query.eq('is_active', true);
      const res = await query;
      if (res.error) throw res.error;
      return res.data || [];
    })();

    data = await Promise.race([
      clientQuery,
      new Promise((resolve) => setTimeout(() => resolve(null), 2500))
    ]);

    if (!data) {
      console.warn('[merch] client query slow — using fetch');
      const session = typeof getSessionFromStorage === 'function' ? getSessionFromStorage() : null;
      const token = (session && session.access_token) || window.SB_ANON_KEY;
      let url = window.SB_URL + '/rest/v1/products?select=*&order=sort_order.asc';
      if (!isAdmin) url += '&is_active=eq.true';
      const res = await fetch(url, {
        headers: {
          apikey: window.SB_ANON_KEY,
          Authorization: 'Bearer ' + token,
          Accept: 'application/json'
        }
      });
      if (!res.ok) throw new Error('products fetch ' + res.status);
      data = await res.json();
    }

    allProducts = data || [];
    renderProducts();
  } catch (err) {
    console.error(err);
    grid.innerHTML = `
      <div class="col-span-full text-center py-12 text-zinc-500">
        <p class="mb-2">Could not load products.</p>
        <p class="text-xs">${escapeHtml(err.message || '')}</p>
        <p class="text-xs mt-2">Make sure you ran <code class="text-orange-500">supabase/schema.sql</code></p>
      </div>`;
  }
}

function renderProducts() {
  const grid = document.getElementById('products-grid');
  if (!grid) return;

  if (allProducts.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full text-center py-16 text-zinc-500">
        <i class="fa-solid fa-shirt text-4xl mb-4 text-zinc-700"></i>
        <p>No merchandise listed yet.</p>
        ${isAdmin ? '<p class="text-sm mt-2 text-orange-500">Use the admin panel below to add your first item.</p>' : ''}
      </div>`;
    return;
  }

  grid.innerHTML = allProducts.map(p => {
    const img = p.image_url
      ? `<img src="${escapeAttr(p.image_url)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="${escapeAttr(p.name)}" onerror="this.parentElement.innerHTML='<div class=\\'w-full h-full flex items-center justify-center bg-zinc-800 text-zinc-600\\'><i class=\\'fa-solid fa-image text-3xl\\'></i></div>'">`
      : `<div class="w-full h-full flex items-center justify-center bg-zinc-800 text-zinc-600"><i class="fa-solid fa-shirt text-3xl"></i></div>`;

    const badge = p.badge
      ? `<div class="absolute top-3 right-3 px-3 py-1 text-[10px] font-mono tracking-widest ${p.badge.toUpperCase() === 'BESTSELLER' ? 'bg-orange-600/90' : 'bg-black/70'} rounded-full">${escapeHtml(p.badge)}</div>`
      : '';

    const inactiveBadge = (!p.is_active && isAdmin)
      ? `<div class="absolute top-3 left-3 px-3 py-1 text-[10px] font-mono tracking-widest bg-red-900/80 text-red-300 rounded-full">HIDDEN</div>`
      : '';

    const adminBtns = isAdmin ? `
      <div class="flex gap-2 mt-2">
        <button onclick="editProduct(${p.id})" class="flex-1 py-1.5 text-xs rounded-xl border border-zinc-700 hover:bg-zinc-800 text-zinc-400">
          <i class="fa-solid fa-pen"></i> Edit
        </button>
        <button onclick="deleteProduct(${p.id})" class="py-1.5 px-3 text-xs rounded-xl border border-red-900/50 hover:bg-red-950 text-red-400">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>` : '';

    return `
      <div class="product-card bg-zinc-950 border border-zinc-800 rounded-3xl overflow-hidden group ${!p.is_active ? 'opacity-60' : ''}">
        <div class="aspect-[4/3] bg-zinc-800 relative overflow-hidden">
          ${img}
          ${badge}
          ${inactiveBadge}
        </div>
        <div class="p-5">
          <div class="flex justify-between items-start gap-2">
            <div class="min-w-0">
              <div class="font-semibold truncate">${escapeHtml(p.name)}</div>
              <div class="text-xs text-zinc-500 line-clamp-2">${escapeHtml(p.description || '')}</div>
            </div>
            <div class="font-mono text-right whitespace-nowrap">$${Number(p.price).toFixed(0)}</div>
          </div>
          <button onclick="addToCart('${escapeAttr(p.name)}', ${Number(p.price)})"
                  class="mt-4 w-full py-2.5 text-sm font-semibold rounded-2xl border border-zinc-700 hover:bg-zinc-900 active:bg-zinc-950 transition-all flex items-center justify-center gap-x-2">
            <i class="fa-solid fa-plus text-xs"></i>
            <span>ADD TO CART</span>
          </button>
          ${adminBtns}
        </div>
      </div>`;
  }).join('');
}

function showAdminUI() {
  const panel = document.getElementById('admin-panel');
  if (panel) panel.classList.remove('hidden');
  const badge = document.getElementById('admin-badge');
  if (badge) badge.classList.remove('hidden');
  const addBtn = document.getElementById('admin-add-btn');
  if (addBtn) addBtn.classList.remove('hidden');
}

function openProductModal(product = null) {
  editingProductId = product ? product.id : null;
  document.getElementById('product-modal-title').textContent = product ? 'Edit Product' : 'Add Product';
  document.getElementById('prod-name').value = product?.name || '';
  document.getElementById('prod-description').value = product?.description || '';
  document.getElementById('prod-price').value = product?.price ?? '';
  document.getElementById('prod-image').value = product?.image_url || '';
  document.getElementById('prod-badge').value = product?.badge || '';
  document.getElementById('prod-sort').value = product?.sort_order ?? 0;
  document.getElementById('prod-active').checked = product ? !!product.is_active : true;

  const preview = document.getElementById('prod-image-preview');
  if (product?.image_url) {
    preview.src = product.image_url;
    preview.classList.remove('hidden');
  } else {
    preview.classList.add('hidden');
  }

  const modal = document.getElementById('product-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeProductModal() {
  const modal = document.getElementById('product-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  editingProductId = null;
}

function editProduct(id) {
  const p = allProducts.find(x => x.id === id);
  if (p) openProductModal(p);
}

async function deleteProduct(id) {
  if (!confirm('Delete this product permanently?')) return;
  const { error } = await window.sb.from('products').delete().eq('id', id);
  if (error) {
    showToast(error.message, true);
    return;
  }
  showToast('Product deleted');
  await loadProducts();
}

async function saveProduct(e) {
  e.preventDefault();
  if (!isAdmin) {
    showToast('Admin access required', true);
    return;
  }

  const payload = {
    name: document.getElementById('prod-name').value.trim(),
    description: document.getElementById('prod-description').value.trim() || null,
    price: parseFloat(document.getElementById('prod-price').value),
    image_url: document.getElementById('prod-image').value.trim() || null,
    badge: document.getElementById('prod-badge').value.trim() || null,
    sort_order: parseInt(document.getElementById('prod-sort').value) || 0,
    is_active: document.getElementById('prod-active').checked
  };

  if (!payload.name || isNaN(payload.price)) {
    showToast('Name and price are required', true);
    return;
  }

  const btn = e.target.querySelector('button[type="submit"]');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

  try {
    let error;
    if (editingProductId) {
      ({ error } = await window.sb.from('products').update(payload).eq('id', editingProductId));
    } else {
      ({ error } = await window.sb.from('products').insert(payload));
    }
    if (error) throw error;

    showToast(editingProductId ? 'Product updated' : 'Product added');
    closeProductModal();
    await loadProducts();
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Save failed', true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

function previewImageUrl() {
  const url = document.getElementById('prod-image').value.trim();
  const preview = document.getElementById('prod-image-preview');
  if (url) {
    preview.src = url;
    preview.classList.remove('hidden');
  } else {
    preview.classList.add('hidden');
  }
}

/** Optional: upload image file to Supabase Storage bucket "merch" */
async function uploadProductImage(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (!isAdmin) {
    showToast('Admin only — log in as admin first', true);
    return;
  }
  if (!window.sb) {
    showToast('Supabase not loaded', true);
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    showToast('Image must be under 5 MB', true);
    return;
  }

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  showToast('Uploading image...');
  const { data, error } = await window.sb.storage.from('merch').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'image/jpeg'
  });

  if (error) {
    console.error('upload error', error);
    showToast('Upload failed: ' + error.message, true);
    return;
  }

  const { data: pub } = window.sb.storage.from('merch').getPublicUrl(path);
  if (pub?.publicUrl) {
    document.getElementById('prod-image').value = pub.publicUrl;
    previewImageUrl();
    showToast('Image uploaded');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

function bootMerch() {
  if (!window.sb) {
    console.warn('[merch] sb not ready, retrying...');
    setTimeout(bootMerch, 150);
    return;
  }
  initMerch().catch(function (e) {
    console.error('[merch] init failed', e);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootMerch);
} else {
  bootMerch();
}
