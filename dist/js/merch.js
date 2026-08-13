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

/** Same product Name = one shop listing; colours are separate rows sharing that name. */
function productGroupKey(p) {
  return (p.name || '').trim().toLowerCase() || ('id-' + p.id);
}

/** Units of this product (id) currently in the local cart */
function cartQtyForProductId(productId) {
  if (productId == null || typeof cart === 'undefined' || !cart || !cart.length) return 0;
  var n = 0;
  for (var i = 0; i < cart.length; i++) {
    if (String(cart[i].productId) === String(productId)) n += Number(cart[i].qty) || 0;
  }
  return n;
}

/** Stock remaining after subtracting items already in the cart */
function availableStock(p) {
  if (!p) return 0;
  return Math.max(0, (Number(p.stock_qty) || 0) - cartQtyForProductId(p.id));
}

function isOutOfStock(p) {
  return availableStock(p) <= 0;
}

/** Refresh product cards / detail after cart changes */
function refreshMerchStockUi() {
  try {
    if (typeof renderProducts === 'function' && document.getElementById('products-grid')) {
      renderProducts();
    }
  } catch (e) {}
  try {
    if (_detailGroupKey && typeof renderProductDetail === 'function') {
      var variants = (allProducts || []).filter(function (p) {
        return p.is_active !== false && productGroupKey(p) === _detailGroupKey;
      });
      if (variants.length) renderProductDetail(variants, _detailSelectedId);
    }
  } catch (e2) {}
}

function groupIsSoldOut(variants) {
  return !variants.length || variants.every(isOutOfStock);
}

/** Public shop: one card per product Name. Admin grid lists every colour row. */
function renderProducts() {
  const grid = document.getElementById('products-grid');
  if (!grid) return;

  var visible = isAdmin
    ? allProducts.slice()
    : allProducts.filter(function (p) { return p.is_active !== false; });

  if (visible.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full text-center py-16 text-zinc-500">
        <i class="fa-solid fa-shirt text-4xl mb-4 text-zinc-700"></i>
        <p>No merchandise listed yet.</p>
        ${isAdmin ? '<p class="text-sm mt-2 text-orange-500">Use the admin panel below to add your first item.</p>' : ''}
      </div>`;
    return;
  }

  // Group strictly by Name
  var groups = {};
  visible.forEach(function (p) {
    var key = productGroupKey(p);
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });
  var groupKeys = Object.keys(groups);

  // Sold-out products last
  groupKeys.sort(function (a, b) {
    var aOut = groupIsSoldOut(groups[a]) ? 1 : 0;
    var bOut = groupIsSoldOut(groups[b]) ? 1 : 0;
    if (aOut !== bOut) return aOut - bOut;
    return a.localeCompare(b);
  });

  // Same layout for admin and shoppers: one card per product Name (no duplicate images)
  grid.className = groupKeys.length === 1
    ? 'grid grid-cols-1 max-w-lg mx-auto gap-6'
    : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto';

  grid.innerHTML = groupKeys.map(function (key) {
    return renderGroupCard(groups[key], key);
  }).join('');
}

function renderGroupCard(variants, groupKey) {
  // Prefer in-stock variant for hero image
  var sorted = variants.slice().sort(function (a, b) {
    return (isOutOfStock(a) ? 1 : 0) - (isOutOfStock(b) ? 1 : 0);
  });
  var primary = sorted[0];
  var allSoldOut = variants.every(isOutOfStock);
  var colors = variants.map(function (v) { return v.color || 'Default'; }).filter(Boolean);
  var uniqueColors = colors.filter(function (c, i) { return colors.indexOf(c) === i; });
  var price = Number(primary.price) || 0;
  var img = primary.image_url
    ? `<img src="${escapeAttr(primary.image_url)}" class="w-full h-full object-cover ${allSoldOut ? 'blur-sm grayscale' : 'group-hover:scale-105'} transition duration-500" alt="">`
    : `<div class="w-full h-full flex items-center justify-center bg-zinc-800 text-zinc-600"><i class="fa-solid fa-shirt text-4xl"></i></div>`;

  // Admin: compact variant list (no extra product images)
  var adminTools = '';
  if (isAdmin) {
    var totalStock = variants.reduce(function (s, v) { return s + (Number(v.stock_qty) || 0); }, 0);
    var variantLines = variants.slice().sort(function (a, b) {
      var c = (a.color || '').localeCompare(b.color || '');
      if (c !== 0) return c;
      return productSizeLabel(a).localeCompare(productSizeLabel(b), undefined, { numeric: true });
    }).map(function (v) {
      var qty = Number(v.stock_qty) || 0;
      var label = escapeHtml([v.color || 'Default', productSizeLabel(v) || '—'].join(' · '));
      return (
        '<div class="flex items-center justify-between gap-2 py-1 border-b border-zinc-800/80 last:border-0">' +
        '<span class="text-[11px] text-zinc-400 truncate">' + label +
        ' <span class="font-mono ' + (qty === 0 ? 'text-red-400' : 'text-zinc-500') + '">×' + qty + '</span></span>' +
        '<span class="shrink-0 flex gap-1">' +
        '<button type="button" onclick="editProduct(' + v.id + ')" class="text-[10px] text-orange-500 hover:text-orange-400 px-1">Edit</button>' +
        '<button type="button" onclick="deleteProduct(' + v.id + ')" class="text-[10px] text-red-400 hover:text-red-300 px-1">Del</button>' +
        '</span></div>'
      );
    }).join('');
    adminTools =
      '<div class="mt-4 pt-3 border-t border-zinc-800">' +
      '<div class="flex items-center justify-between text-[11px] text-zinc-500 mb-2">' +
      '<span>' + variants.length + ' variant' + (variants.length === 1 ? '' : 's') + ' · ' + totalStock + ' units</span>' +
      '<button type="button" onclick="addVariantForGroup(\'' + escapeAttr(groupKey).replace(/'/g, "\\'") + '\')" ' +
      'class="text-orange-500 hover:text-orange-400">+ Add size/colour</button></div>' +
      '<div class="max-h-36 overflow-y-auto">' + variantLines + '</div></div>';
  }

  return `
    <div class="product-card bg-zinc-950 border border-zinc-800 rounded-3xl overflow-hidden group ${allSoldOut ? 'opacity-80' : ''}">
      <div class="aspect-[4/3] bg-zinc-800 relative overflow-hidden">
        ${img}
        ${allSoldOut ? '<div class="absolute inset-0 bg-black/40 flex items-center justify-center"><span class="px-4 py-2 rounded-full bg-black/80 border border-red-800 text-red-400 text-xs font-bold tracking-[2px]">SOLD OUT</span></div>' : ''}
        ${primary.badge ? '<div class="absolute top-3 right-3 px-3 py-1 text-[10px] font-mono tracking-widest bg-orange-600/90 rounded-full">' + escapeHtml(primary.badge) + '</div>' : ''}
      </div>
      <div class="p-6">
        <div class="flex justify-between items-start gap-3">
          <div>
            <div class="font-semibold text-lg">${escapeHtml(primary.name)}</div>
            <div class="text-sm text-zinc-500 mt-1 line-clamp-2">${escapeHtml(primary.description || '')}</div>
            ${uniqueColors.length ? '<div class="text-xs text-zinc-400 mt-2">' + uniqueColors.length + ' colour' + (uniqueColors.length > 1 ? 's' : '') + ': ' + escapeHtml(uniqueColors.join(', ')) + '</div>' : ''}
          </div>
          <div class="font-mono text-lg whitespace-nowrap">$${price.toFixed(0)}</div>
        </div>
        <button type="button" onclick="openProductDetail('${escapeAttr(groupKey)}')"
                class="mt-5 w-full py-3 text-sm font-semibold rounded-2xl ${allSoldOut ? 'border border-zinc-700 text-zinc-500 cursor-not-allowed' : 'bg-orange-600 hover:bg-orange-700 text-white'} transition-all"
                ${allSoldOut ? 'disabled' : ''}>
          ${allSoldOut ? 'SOLD OUT' : 'SELECT COLOUR & SIZE'}
        </button>
        ${adminTools}
      </div>
    </div>`;
}

var _detailGroupKey = null;
var _detailSelectedId = null;
var _detailSelectedColor = null;

function productColorKey(p) {
  return (p.color || '').trim().toLowerCase() || 'default';
}

/** Single size on the row (preferred). Falls back to first entry of legacy sizes CSV. */
function productSizeLabel(p) {
  var s = (p.size || '').trim();
  if (s) return s;
  var legacy = (p.sizes || '').trim();
  if (!legacy) return '';
  return legacy.split(',')[0].trim();
}

function isNativeShell() {
  try {
    if (typeof isNativeAppShell === 'function') return isNativeAppShell();
  } catch (e) {}
  try {
    return !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  } catch (e2) {}
  return false;
}

function openProductDetail(groupKey) {
  var variants = allProducts.filter(function (p) {
    return p.is_active !== false && productGroupKey(p) === groupKey;
  });
  if (!variants.length) {
    showToast('Product not available', true);
    return;
  }
  _detailGroupKey = groupKey;
  var first = variants.find(function (v) { return !isOutOfStock(v); }) || variants[0];
  _detailSelectedId = first.id;
  _detailSelectedColor = productColorKey(first);
  renderProductDetail(variants, first.id);
  var modal = document.getElementById('product-detail-modal');
  var sheet = document.getElementById('product-detail-sheet');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    modal.style.zIndex = '99999';
    if (isNativeShell()) {
      modal.classList.add('native-detail-overlay');
      modal.style.alignItems = 'flex-end';
      modal.style.justifyContent = 'stretch';
      modal.style.padding = '0';
      modal.style.paddingTop = 'env(safe-area-inset-top, 0px)';
      document.body.style.overflow = 'hidden';
      if (sheet) {
        sheet.classList.add('native-detail-sheet');
        sheet.style.maxWidth = '100%';
        sheet.style.width = '100%';
        sheet.style.maxHeight = 'min(90dvh, calc(100dvh - env(safe-area-inset-top, 0px) - 8px))';
        sheet.style.borderRadius = '20px 20px 0 0';
        sheet.style.borderLeft = 'none';
        sheet.style.borderRight = 'none';
        sheet.style.borderBottom = 'none';
      }
    } else {
      modal.classList.remove('native-detail-overlay');
      modal.style.alignItems = '';
      modal.style.justifyContent = '';
      modal.style.padding = '';
      if (sheet) {
        sheet.classList.remove('native-detail-sheet');
        sheet.style.maxWidth = '';
        sheet.style.width = '';
        sheet.style.maxHeight = '';
        sheet.style.borderRadius = '';
      }
    }
  }
  try { if (typeof haptic === 'function') haptic('light'); } catch (e) {}
}

function closeProductDetail() {
  var modal = document.getElementById('product-detail-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('native-detail-overlay');
    modal.style.display = 'none';
    modal.style.alignItems = '';
    modal.style.justifyContent = '';
    modal.style.padding = '';
  }
  document.body.style.overflow = '';
  _detailGroupKey = null;
  _detailSelectedId = null;
  _detailSelectedColor = null;
}

/** Pick a colour (by representative product id); size list updates for that colour. */
function selectDetailColor(productId) {
  var variants = allProducts.filter(function (p) {
    return p.is_active !== false && productGroupKey(p) === _detailGroupKey;
  });
  var picked = variants.find(function (v) { return Number(v.id) === Number(productId); });
  if (!picked) return;
  _detailSelectedColor = productColorKey(picked);
  // Prefer in-stock row for this colour
  var sameColor = variants.filter(function (v) { return productColorKey(v) === _detailSelectedColor; });
  var best = sameColor.find(function (v) { return !isOutOfStock(v); }) || sameColor[0] || picked;
  _detailSelectedId = best.id;
  renderProductDetail(variants, best.id);
}

/** Pick a size row (exact product id for name + colour + size). */
function selectDetailSizeById(productId) {
  var variants = allProducts.filter(function (p) {
    return p.is_active !== false && productGroupKey(p) === _detailGroupKey;
  });
  var picked = variants.find(function (v) { return Number(v.id) === Number(productId); });
  if (!picked) return;
  if (isOutOfStock(picked)) {
    showToast('That size is sold out', true);
    return;
  }
  _detailSelectedId = picked.id;
  _detailSelectedColor = productColorKey(picked);
  renderProductDetail(variants, picked.id);
}

function renderProductDetail(variants, selectedId) {
  var selected = variants.find(function (v) { return Number(v.id) === Number(selectedId); }) || variants[0];
  if (!selected) return;
  _detailSelectedId = selected.id;
  _detailSelectedColor = productColorKey(selected);

  var imgEl = document.getElementById('detail-image');
  var nameEl = document.getElementById('detail-name');
  var descEl = document.getElementById('detail-desc');
  var priceEl = document.getElementById('detail-price');
  var stockEl = document.getElementById('detail-stock');
  var colorsEl = document.getElementById('detail-colors');
  var sizesEl = document.getElementById('detail-sizes');
  var addBtn = document.getElementById('detail-add-btn');

  if (nameEl) nameEl.textContent = selected.name || '';
  if (descEl) descEl.textContent = selected.description || '';
  if (priceEl) priceEl.textContent = '$' + Number(selected.price).toFixed(2);

  var soldOut = isOutOfStock(selected);
  var sizeLabel = productSizeLabel(selected);
  if (stockEl) {
    var stockMsg = soldOut
      ? 'Sold out'
      : (availableStock(selected) + ' in stock' + (sizeLabel ? ' · ' + sizeLabel : '') + (selected.color ? ' · ' + selected.color : ''));
    stockEl.textContent = stockMsg;
    stockEl.className = 'text-xs ' + (soldOut ? 'text-red-400' : 'text-emerald-400');
  }

  if (imgEl) {
    // Image from any row of this colour that has an image
    var colorRows = variants.filter(function (v) { return productColorKey(v) === _detailSelectedColor; });
    var imgSrc = selected.image_url || (colorRows.find(function (v) { return v.image_url; }) || {}).image_url;
    if (imgSrc) {
      imgEl.innerHTML = '<img src="' + escapeAttr(imgSrc) + '" class="w-full h-full object-cover ' + (soldOut ? 'blur-sm grayscale' : '') + '" alt="">';
      if (soldOut) {
        imgEl.innerHTML += '<div class="absolute inset-0 flex items-center justify-center"><span class="px-3 py-1 rounded-full bg-black/80 text-red-400 text-xs font-bold">SOLD OUT</span></div>';
      }
    } else {
      imgEl.innerHTML = '<div class="w-full h-full flex items-center justify-center bg-zinc-800 text-zinc-600"><i class="fa-solid fa-shirt text-5xl"></i></div>';
    }
  }

  // Unique colours (one button per colour)
  if (colorsEl) {
    var byColor = {};
    variants.forEach(function (v) {
      var ck = productColorKey(v);
      if (!byColor[ck]) byColor[ck] = [];
      byColor[ck].push(v);
    });
    colorsEl.innerHTML = Object.keys(byColor).map(function (ck) {
      var rows = byColor[ck];
      var rep = rows.find(function (v) { return !isOutOfStock(v); }) || rows[0];
      var allOut = rows.every(isOutOfStock);
      var active = ck === _detailSelectedColor;
      var hex = (rep.color_hex || '').trim();
      var swatch = hex
        ? '<span class="w-5 h-5 rounded-full border border-white/20 shrink-0" style="background:' + escapeAttr(hex) + '"></span>'
        : (rep.image_url
          ? '<img src="' + escapeAttr(rep.image_url) + '" class="w-8 h-8 rounded-lg object-cover ' + (allOut ? 'grayscale opacity-50' : '') + '" alt="">'
          : '<span class="w-5 h-5 rounded-full bg-zinc-600"></span>');
      return (
        '<button type="button" onclick="selectDetailColor(' + rep.id + ')" ' +
        'class="flex items-center gap-2 px-3 py-2 rounded-2xl border text-sm transition-colors ' +
        (active ? 'border-orange-600 bg-orange-950/40 text-white' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500') +
        (allOut ? ' opacity-60' : '') + '">' +
        swatch +
        '<span>' + escapeHtml(rep.color || 'Default') + (allOut ? ' · Sold out' : '') + '</span></button>'
      );
    }).join('');
  }

  // Sizes for selected colour — each size is its own product row with own stock
  if (sizesEl) {
    var sizeRows = variants.filter(function (v) {
      return productColorKey(v) === _detailSelectedColor;
    });
    // Dedupe by size label; prefer the selected id
    var bySize = {};
    sizeRows.forEach(function (v) {
      var sk = productSizeLabel(v) || 'One size';
      if (!bySize[sk] || Number(v.id) === Number(selected.id)) bySize[sk] = v;
    });
    var sizeKeys = Object.keys(bySize);
    // Sort: in-stock first, then label
    sizeKeys.sort(function (a, b) {
      var aOut = isOutOfStock(bySize[a]) ? 1 : 0;
      var bOut = isOutOfStock(bySize[b]) ? 1 : 0;
      if (aOut !== bOut) return aOut - bOut;
      return a.localeCompare(b, undefined, { numeric: true });
    });

    if (!sizeKeys.length) {
      sizesEl.innerHTML = '<p class="text-xs text-zinc-500">No sizes</p>';
    } else {
      sizesEl.innerHTML = sizeKeys.map(function (sk) {
        var row = bySize[sk];
        var oos = isOutOfStock(row);
        var active = Number(row.id) === Number(selected.id);
        var qty = availableStock(row);
        return (
          '<button type="button" onclick="selectDetailSizeById(' + row.id + ')" ' +
          'class="detail-size-btn px-4 py-2 rounded-xl border text-sm transition-colors ' +
          (active ? 'border-orange-600 bg-orange-950/40 text-white' : 'border-zinc-700 text-zinc-300 hover:border-orange-600') +
          (oos ? ' opacity-50 line-through' : '') + '" ' + (oos ? 'disabled' : '') + '>' +
          escapeHtml(sk) +
          (oos ? ' · 0' : ' · ' + qty) +
          '</button>'
        );
      }).join('');
    }
  }

  if (addBtn) {
    if (soldOut) {
      addBtn.disabled = true;
      addBtn.textContent = 'Sold out';
      addBtn.className = 'w-full py-3.5 rounded-2xl border border-zinc-700 text-zinc-500 font-semibold text-sm cursor-not-allowed';
      addBtn.onclick = null;
    } else {
      addBtn.disabled = false;
      addBtn.textContent = 'Add to cart';
      addBtn.className = 'w-full py-3.5 rounded-2xl bg-orange-600 hover:bg-orange-700 text-white font-semibold text-sm';
      addBtn.onclick = function () { addDetailToCart(); };
    }
  }
}

function addDetailToCart() {
  var selected = allProducts.find(function (p) { return Number(p.id) === Number(_detailSelectedId); });
  if (!selected) {
    showToast('Select a colour and size', true);
    return;
  }
  if (isOutOfStock(selected)) {
    showToast('That option is sold out', true);
    return;
  }
  if (typeof addToCart !== 'function') {
    showToast('Cart not ready — refresh', true);
    return;
  }
  addToCart(selected.name, selected.price, {
    productId: selected.id,
    size: productSizeLabel(selected),
    color: selected.color || ''
  });
  closeProductDetail();
}

/** Pending product while size modal is open (avoids broken HTML onclick quoting) */
var _pendingCartProduct = null;

/** Look up product from loaded list and start add-to-cart / size flow */
function addProductToCartById(id) {
  var product = allProducts.find(function (x) { return Number(x.id) === Number(id); });
  if (!product) {
    showToast('Product not found', true);
    return;
  }
  addProductToCart(product);
}

/** Size picker when product has sizes; otherwise add directly */
function addProductToCart(product) {
  if (!product) return;
  var sizesRaw = (product.sizes || '').trim();
  var sizes = sizesRaw
    ? sizesRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
    : [];

  if (sizes.length === 0) {
    if (typeof addToCart !== 'function') {
      showToast('Cart not ready — refresh the page', true);
      return;
    }
    addToCart(product.name, product.price, { productId: product.id });
    return;
  }

  var modal = document.getElementById('size-picker-modal');
  var title = document.getElementById('size-picker-title');
  var list = document.getElementById('size-picker-list');
  if (!modal || !list) {
    addToCart(product.name, product.price, { productId: product.id });
    return;
  }

  _pendingCartProduct = {
    id: product.id,
    name: product.name,
    price: Number(product.price)
  };

  if (title) title.textContent = product.name;
  list.innerHTML = sizes.map(function (sz) {
    var safe = String(sz).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return (
      '<button type="button" class="w-full py-3 rounded-2xl border border-zinc-700 hover:border-orange-600 hover:bg-zinc-950 font-semibold text-sm transition-colors" ' +
      "onclick=\"confirmSizePick('" + safe + "')\">" +
      escapeHtml(sz) +
      '</button>'
    );
  }).join('');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}

function confirmSizePick(size) {
  var product = _pendingCartProduct;
  closeSizePicker();
  if (!product) {
    showToast('Could not add item — try again', true);
    return;
  }
  if (typeof addToCart !== 'function') {
    showToast('Cart not ready — refresh the page', true);
    return;
  }
  addToCart(product.name, product.price, { productId: product.id, size: size });
  _pendingCartProduct = null;
}

function closeSizePicker() {
  var modal = document.getElementById('size-picker-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.style.display = 'none';
  _pendingCartProduct = null;
}

function showAdminUI() {
  const panel = document.getElementById('admin-panel');
  if (panel) panel.classList.remove('hidden');
  const badge = document.getElementById('admin-badge');
  if (badge) badge.classList.remove('hidden');
  const addBtn = document.getElementById('admin-add-btn');
  if (addBtn) addBtn.classList.remove('hidden');
  loadAdminOrders();
  loadSalesDashboard();
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
  var sizeEl = document.getElementById('prod-size');
  if (sizeEl) sizeEl.value = product ? (product.size || productSizeLabel(product) || '') : '';
  var stockEl = document.getElementById('prod-stock');
  if (stockEl) stockEl.value = product && product.stock_qty != null ? product.stock_qty : 0;
  var colorEl = document.getElementById('prod-color');
  if (colorEl) colorEl.value = product?.color || '';

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

/** Prefill add form from an existing product group (new colour/size row) */
function addVariantForGroup(groupKey) {
  var variants = allProducts.filter(function (p) {
    return productGroupKey(p) === groupKey;
  });
  var primary = variants[0];
  if (!primary) {
    openProductModal();
    return;
  }
  openProductModal({
    name: primary.name,
    description: primary.description || '',
    price: primary.price,
    image_url: primary.image_url || '',
    badge: primary.badge || '',
    color: primary.color || '',
    is_active: true,
    stock_qty: 0,
    size: ''
  });
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
    is_active: document.getElementById('prod-active').checked,
    size: (document.getElementById('prod-size') && document.getElementById('prod-size').value.trim()) || '',
    sizes: (document.getElementById('prod-size') && document.getElementById('prod-size').value.trim()) || '',
    stock_qty: (function () {
      var el = document.getElementById('prod-stock');
      if (!el) return 0;
      var n = parseInt(el.value, 10);
      return isNaN(n) ? 0 : Math.max(0, n);
    })(),
    color: (document.getElementById('prod-color') && document.getElementById('prod-color').value.trim()) || ''
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

function orderMonthKey(iso) {
  if (!iso) return 'unknown';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return 'unknown';
  var m = d.getMonth() + 1;
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : String(m));
}

function orderMonthLabel(key) {
  if (key === 'unknown') return 'Unknown date';
  var parts = key.split('-');
  var y = parts[0];
  var m = parseInt(parts[1], 10) - 1;
  var names = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return (names[m] || key) + ' ' + y;
}

function renderOrderCard(o) {
  var items = Array.isArray(o.items) ? o.items : [];
  var itemsHtml = items.map(function (it) {
    var sz = it.size ? ' · ' + escapeHtml(it.size) : '';
    var col = it.color ? ' · ' + escapeHtml(it.color) : '';
    return '<div class="text-xs text-zinc-400">' +
      escapeHtml(String(it.qty || 1)) + '× ' + escapeHtml(it.name || '') + col + sz +
      ' — $' + (Number(it.price) * (it.qty || 1)).toFixed(2) + '</div>';
  }).join('');
  var ship = [o.shipping_address, o.shipping_city, o.shipping_province, o.shipping_postal]
    .filter(Boolean).join(', ');
  var when = o.created_at ? new Date(o.created_at).toLocaleString() : '';
  var statusOpts = ['pending', 'paid', 'shipped', 'cancelled'].map(function (s) {
    return '<option value="' + s + '"' + (o.status === s ? ' selected' : '') + '>' + s + '</option>';
  }).join('');
  return (
    '<div class="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 space-y-2" id="order-row-' + o.id + '">' +
    '<div class="flex flex-wrap items-start justify-between gap-2">' +
    '<div><div class="font-semibold text-sm">#' + o.id + ' · $' + Number(o.total).toFixed(2) +
    '</div><div class="text-xs text-zinc-500">' + escapeHtml(when) + '</div></div>' +
    '<div class="flex items-center gap-2">' +
    '<select onchange="updateOrderStatus(' + o.id + ', this.value)" class="bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-1.5 text-xs">' +
    statusOpts + '</select>' +
    '<button type="button" onclick="deleteOrder(' + o.id + ')" title="Delete order" ' +
    'class="px-2.5 py-1.5 rounded-xl border border-red-900/60 text-red-400 hover:bg-red-950/50 text-xs">' +
    '<i class="fa-solid fa-trash"></i></button></div></div>' +
    '<div class="text-sm">' + escapeHtml(o.customer_name || '') +
    ' · <a class="text-orange-500" href="mailto:' + escapeAttr(o.customer_email || '') + '">' +
    escapeHtml(o.customer_email || '') + '</a>' +
    (o.customer_phone ? ' · ' + escapeHtml(o.customer_phone) : '') + '</div>' +
    (ship ? '<div class="text-xs text-zinc-500">' + escapeHtml(ship) + '</div>' : '') +
    (o.notes ? '<div class="text-xs text-zinc-500 italic">' + escapeHtml(o.notes) + '</div>' : '') +
    '<div class="pt-1 space-y-0.5">' + itemsHtml + '</div></div>'
  );
}

async function loadAdminOrders() {
  var box = document.getElementById('admin-orders-list');
  if (!box || !window.sb || !isAdmin) return;
  box.innerHTML = '<p class="text-sm text-zinc-500 p-3">Loading orders…</p>';
  try {
    var res = await window.sb
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(120);
    if (res.error) throw res.error;
    var rows = res.data || [];
    if (!rows.length) {
      box.innerHTML = '<p class="text-sm text-zinc-500 p-3">No orders yet.</p>';
      return;
    }

    // Group by year-month (newest months first)
    var groups = {};
    rows.forEach(function (o) {
      var key = orderMonthKey(o.created_at);
      if (!groups[key]) groups[key] = [];
      groups[key].push(o);
    });
    var monthKeys = Object.keys(groups).sort(function (a, b) {
      if (a === 'unknown') return 1;
      if (b === 'unknown') return -1;
      return b.localeCompare(a); // YYYY-MM descending
    });

    box.innerHTML = monthKeys.map(function (key) {
      var list = groups[key];
      var monthTotal = list.reduce(function (s, o) { return s + (Number(o.total) || 0); }, 0);
      var header =
        '<div class="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 px-3 py-2 flex items-center justify-between gap-2">' +
        '<div class="text-xs font-semibold uppercase tracking-widest text-orange-500">' +
        escapeHtml(orderMonthLabel(key)) + '</div>' +
        '<div class="text-[11px] text-zinc-500 font-mono">' + list.length + ' order' + (list.length === 1 ? '' : 's') +
        ' · $' + monthTotal.toFixed(2) + '</div></div>';
      return (
        '<div class="mb-4 last:mb-0">' +
        header +
        '<div class="space-y-3 p-3">' +
        list.map(renderOrderCard).join('') +
        '</div></div>'
      );
    }).join('');
  } catch (e) {
    console.error('[orders]', e);
    box.innerHTML = '<p class="text-sm text-red-400 p-3">Could not load orders: ' + escapeHtml(e.message || String(e)) + '</p>';
  }
}

async function updateOrderStatus(id, status) {
  if (!window.sb || !isAdmin) return;
  var res = await window.sb.from('orders').update({ status: status }).eq('id', id);
  if (res.error) {
    showToast(res.error.message, true);
    return;
  }
  showToast('Order #' + id + ' → ' + status);
  loadSalesDashboard();
}

async function deleteOrder(id) {
  if (!window.sb || !isAdmin) return;
  if (!confirm('Delete order #' + id + ' permanently? This cannot be undone.')) return;
  var res = await window.sb.from('orders').delete().eq('id', id).select('id');
  if (res.error) {
    showToast(res.error.message, true);
    return;
  }
  if (!res.data || !res.data.length) {
    showToast('Delete blocked by database permissions. Run orders_delete_policy.sql in Supabase.', true);
    return;
  }
  showToast('Order #' + id + ' deleted');
  var row = document.getElementById('order-row-' + id);
  if (row) row.remove();
  else loadAdminOrders();
  loadSalesDashboard();
}

var _salesChart = null;
var _salesChartRange = 'month';
var _salesOrdersCache = null;

/** Sales + stock dashboard (admin) */
async function loadSalesDashboard() {
  var statsEl = document.getElementById('sales-stats');
  var stockEl = document.getElementById('stock-table');
  var chartWrap = document.getElementById('sales-chart-wrap');
  if (!statsEl && !stockEl && !chartWrap) return;
  if (!window.sb || !isAdmin) return;

  try {
    var ordersRes = await window.sb.from('orders').select('*').order('created_at', { ascending: true }).limit(500);
    if (ordersRes.error) throw ordersRes.error;
    var orders = ordersRes.data || [];
    _salesOrdersCache = orders;

    var paid = orders.filter(function (o) { return o.status === 'paid' || o.status === 'shipped'; });
    var pending = orders.filter(function (o) { return o.status === 'pending'; });
    var revenue = paid.reduce(function (s, o) { return s + (Number(o.total) || 0); }, 0);
    var pendingValue = pending.reduce(function (s, o) { return s + (Number(o.total) || 0); }, 0);

    var soldMap = {};
    paid.forEach(function (o) {
      var items = Array.isArray(o.items) ? o.items : [];
      items.forEach(function (it) {
        var key = (it.name || 'Item') +
          (it.color ? ' · ' + it.color : '') +
          (it.size ? ' · ' + it.size : '');
        soldMap[key] = (soldMap[key] || 0) + (Number(it.qty) || 1);
      });
    });
    var topSold = Object.keys(soldMap).map(function (k) {
      return { name: k, qty: soldMap[k] };
    }).sort(function (a, b) { return b.qty - a.qty; }).slice(0, 8);

    if (statsEl) {
      statsEl.innerHTML =
        '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' +
        cardStat('Revenue (paid/shipped)', '$' + revenue.toFixed(2), 'text-emerald-400') +
        cardStat('Pending value', '$' + pendingValue.toFixed(2), 'text-orange-400') +
        cardStat('Orders (paid/shipped)', String(paid.length), 'text-white') +
        cardStat('Pending orders', String(pending.length), 'text-zinc-300') +
        '</div>' +
        (topSold.length
          ? '<div class="mt-4"><div class="text-xs uppercase tracking-widest text-zinc-500 mb-2">Top sellers</div><div class="space-y-1">' +
            topSold.map(function (t) {
              return '<div class="flex justify-between text-sm border-b border-zinc-800 py-1.5"><span class="truncate pr-3">' +
                escapeHtml(t.name) + '</span><span class="font-mono text-orange-500">' + t.qty + ' sold</span></div>';
            }).join('') + '</div></div>'
          : '<p class="text-sm text-zinc-500 mt-4">No paid sales yet.</p>');
    }

    renderSalesChart(_salesChartRange);

    if (stockEl) {
      // One inventory row per Name + Colour; size dropdown loads that size's qty
      var groups = {};
      allProducts.forEach(function (p) {
        var key = productGroupKey(p) + '||' + productColorKey(p);
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
      });
      var keys = Object.keys(groups).sort(function (a, b) {
        return a.localeCompare(b);
      });
      if (!keys.length) {
        stockEl.innerHTML = '<p class="text-sm text-zinc-500">No products.</p>';
      } else {
        stockEl.innerHTML =
          '<div class="overflow-x-auto -mx-1"><table class="w-full text-sm text-left min-w-[440px]">' +
          '<thead class="text-xs text-zinc-500 border-b border-zinc-800"><tr>' +
          '<th class="py-2 pr-2">Product</th><th class="py-2 pr-2">Colour</th><th class="py-2 pr-2">Size</th><th class="py-2 pr-2">Qty</th><th class="py-2">Save</th></tr></thead><tbody>' +
          keys.map(function (key, idx) {
            var rows = groups[key];
            var sample = rows[0];
            var rowId = 'invg-' + idx;
            var sorted = rows.slice().sort(function (a, b) {
              return (isOutOfStock(a) ? 1 : 0) - (isOutOfStock(b) ? 1 : 0);
            });
            var def = sorted[0];
            var defSize = productSizeLabel(def) || 'S';
            var defQty = Number(def.stock_qty) || 0;
            var defPid = def.id;
            return '<tr class="border-b border-zinc-900" id="' + rowId + '" ' +
              'data-name="' + escapeAttr(sample.name || '') + '" ' +
              'data-color="' + escapeAttr(sample.color || '') + '" ' +
              'data-product-id="' + defPid + '">' +
              '<td class="py-2 pr-2 align-middle"><div class="font-medium text-sm truncate max-w-[9rem]">' + escapeHtml(sample.name) + '</div></td>' +
              '<td class="py-2 pr-2 align-middle text-zinc-400 text-xs">' + escapeHtml(sample.color || '—') + '</td>' +
              '<td class="py-2 pr-2 align-middle">' + invSizeSelectHtml(rowId, defSize) + '</td>' +
              '<td class="py-2 pr-2 align-middle">' +
              '<input type="number" min="0" step="1" value="' + defQty + '" ' +
              'id="' + rowId + '-qty" ' +
              'class="w-16 bg-zinc-900 border border-zinc-700 rounded-xl px-2 py-1.5 text-sm font-mono text-center outline-none focus:border-orange-600 ' +
              (defQty === 0 ? 'text-red-400' : defQty <= 5 ? 'text-orange-400' : 'text-zinc-200') + '">' +
              '</td>' +
              '<td class="py-2 align-middle whitespace-nowrap">' +
              '<button type="button" onclick="saveInventoryRow(\'' + rowId + '\')" ' +
              'class="px-3 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold">Save</button> ' +
              '<button type="button" onclick="editProduct(' + defPid + ')" class="text-xs text-zinc-500 hover:text-orange-400 ml-1">Edit</button>' +
              '</td></tr>';
          }).join('') +
          '</tbody></table></div>' +
          '<p class="text-[11px] text-zinc-500 mt-2">Pick a size to load its qty, change the number, then press <strong>Save</strong>.</p>';
      }
    }
  } catch (e) {
    console.error('[sales]', e);
    if (statsEl) statsEl.innerHTML = '<p class="text-sm text-red-400">' + escapeHtml(e.message || String(e)) + '</p>';
  }
}

function setSalesChartRange(range) {
  _salesChartRange = range || 'month';
  document.querySelectorAll('[data-sales-range]').forEach(function (btn) {
    var on = btn.getAttribute('data-sales-range') === _salesChartRange;
    btn.classList.toggle('bg-orange-600', on);
    btn.classList.toggle('text-white', on);
    btn.classList.toggle('border-zinc-700', !on);
    btn.classList.toggle('text-zinc-400', !on);
  });
  renderSalesChart(_salesChartRange);
}

function renderSalesChart(range) {
  var canvas = document.getElementById('sales-chart');
  if (!canvas) return;
  if (typeof Chart === 'undefined') {
    var msg = document.getElementById('sales-chart-msg');
    if (msg) msg.textContent = 'Chart library loading…';
    return;
  }

  var orders = (_salesOrdersCache || []).filter(function (o) {
    return o.status === 'paid' || o.status === 'shipped' || o.status === 'pending';
  });

  var buckets = {};
  var labels = [];
  var now = new Date();

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  if (range === 'day') {
    // Last 14 days
    for (var d = 13; d >= 0; d--) {
      var day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
      var key = day.getFullYear() + '-' + pad(day.getMonth() + 1) + '-' + pad(day.getDate());
      labels.push(key.slice(5)); // MM-DD
      buckets[key] = { revenue: 0, orders: 0, pending: 0 };
    }
    orders.forEach(function (o) {
      if (!o.created_at) return;
      var dt = new Date(o.created_at);
      var key = dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
      if (!buckets[key]) return;
      if (o.status === 'pending') buckets[key].pending += Number(o.total) || 0;
      else {
        buckets[key].revenue += Number(o.total) || 0;
        buckets[key].orders += 1;
      }
    });
  } else if (range === 'year') {
    // Last 5 years
    for (var y = 4; y >= 0; y--) {
      var yr = now.getFullYear() - y;
      var keyY = String(yr);
      labels.push(keyY);
      buckets[keyY] = { revenue: 0, orders: 0, pending: 0 };
    }
    orders.forEach(function (o) {
      if (!o.created_at) return;
      var keyY = String(new Date(o.created_at).getFullYear());
      if (!buckets[keyY]) return;
      if (o.status === 'pending') buckets[keyY].pending += Number(o.total) || 0;
      else {
        buckets[keyY].revenue += Number(o.total) || 0;
        buckets[keyY].orders += 1;
      }
    });
  } else {
    // month — last 12 months
    for (var m = 11; m >= 0; m--) {
      var md = new Date(now.getFullYear(), now.getMonth() - m, 1);
      var keyM = md.getFullYear() + '-' + pad(md.getMonth() + 1);
      labels.push(keyM);
      buckets[keyM] = { revenue: 0, orders: 0, pending: 0 };
    }
    orders.forEach(function (o) {
      if (!o.created_at) return;
      var dt = new Date(o.created_at);
      var keyM = dt.getFullYear() + '-' + pad(dt.getMonth() + 1);
      if (!buckets[keyM]) return;
      if (o.status === 'pending') buckets[keyM].pending += Number(o.total) || 0;
      else {
        buckets[keyM].revenue += Number(o.total) || 0;
        buckets[keyM].orders += 1;
      }
    });
  }

  var fullKeys = Object.keys(buckets).sort();
  // Align labels with fullKeys for month/year/day consistently
  if (range === 'day') {
    fullKeys = Object.keys(buckets).sort();
    labels = fullKeys.map(function (k) { return k.slice(5); });
  } else if (range === 'year') {
    fullKeys = Object.keys(buckets).sort();
    labels = fullKeys;
  } else {
    fullKeys = Object.keys(buckets).sort();
    labels = fullKeys;
  }

  var revenueData = fullKeys.map(function (k) { return Math.round((buckets[k].revenue || 0) * 100) / 100; });
  var ordersData = fullKeys.map(function (k) { return buckets[k].orders || 0; });
  var pendingData = fullKeys.map(function (k) { return Math.round((buckets[k].pending || 0) * 100) / 100; });

  if (_salesChart) {
    _salesChart.destroy();
    _salesChart = null;
  }

  var ctx = canvas.getContext('2d');
  _salesChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          type: 'bar',
          label: 'Revenue ($)',
          data: revenueData,
          backgroundColor: 'rgba(249, 115, 22, 0.75)',
          borderRadius: 6,
          yAxisID: 'y'
        },
        {
          type: 'line',
          label: 'Orders',
          data: ordersData,
          borderColor: 'rgba(52, 211, 153, 1)',
          backgroundColor: 'rgba(52, 211, 153, 0.15)',
          tension: 0.3,
          yAxisID: 'y1',
          pointRadius: 3,
          pointHitRadius: 12
        },
        {
          type: 'bar',
          label: 'Pending ($)',
          data: pendingData,
          backgroundColor: 'rgba(113, 113, 122, 0.45)',
          borderRadius: 6,
          yAxisID: 'y'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: '#a1a1aa', boxWidth: 12, font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              var v = ctx.parsed.y;
              if (ctx.dataset.label && ctx.dataset.label.indexOf('$') >= 0) {
                return ctx.dataset.label + ': $' + Number(v).toFixed(2);
              }
              return ctx.dataset.label + ': ' + v;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#71717a', maxRotation: 45, minRotation: 0, font: { size: 10 } },
          grid: { color: 'rgba(39,39,42,0.8)' }
        },
        y: {
          position: 'left',
          ticks: {
            color: '#71717a',
            font: { size: 10 },
            callback: function (v) { return '$' + v; }
          },
          grid: { color: 'rgba(39,39,42,0.8)' }
        },
        y1: {
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#71717a', font: { size: 10 }, precision: 0 }
        }
      }
    }
  });

  var msg = document.getElementById('sales-chart-msg');
  if (msg) msg.textContent = '';
}

function cardStat(label, value, valueClass) {
  return (
    '<div class="bg-zinc-950 border border-zinc-800 rounded-2xl p-4">' +
    '<div class="text-[11px] uppercase tracking-widest text-zinc-500">' + escapeHtml(label) + '</div>' +
    '<div class="text-xl font-semibold mt-1 font-mono ' + (valueClass || '') + '">' + escapeHtml(value) + '</div></div>'
  );
}

/** Fixed size options for inventory + product form */
var SIZE_OPTIONS = ['S', 'M', 'L', 'XL', 'XXL', 'One Size', 'N/A'];

function invSizeSelectHtml(rowId, current) {
  var cur = current || '';
  var opts = SIZE_OPTIONS.map(function (s) {
    return '<option value="' + escapeAttr(s) + '"' + (s === cur ? ' selected' : '') + '>' + escapeHtml(s) + '</option>';
  }).join('');
  if (cur && SIZE_OPTIONS.indexOf(cur) === -1) {
    opts = '<option value="' + escapeAttr(cur) + '" selected>' + escapeHtml(cur) + '</option>' + opts;
  }
  return (
    '<select id="' + rowId + '-size" onchange="onInventorySizeChange(\'' + rowId + '\')" ' +
    'class="bg-zinc-900 border border-zinc-700 rounded-xl px-2 py-1.5 text-xs outline-none focus:border-orange-600 max-w-[7.5rem]">' +
    opts + '</select>'
  );
}

/** Find product row for name + colour + size */
function findInventoryProduct(name, color, size) {
  var nk = (name || '').trim().toLowerCase();
  var ck = (color || '').trim().toLowerCase() || 'default';
  var sk = (size || '').trim().toLowerCase();
  return allProducts.find(function (p) {
    return productGroupKey(p) === nk &&
      productColorKey(p) === ck &&
      productSizeLabel(p).toLowerCase() === sk;
  }) || null;
}

/** When size changes: load that size's stock into the qty field (does not save yet) */
function onInventorySizeChange(rowId) {
  var tr = document.getElementById(rowId);
  if (!tr) return;
  var name = tr.getAttribute('data-name') || '';
  var color = tr.getAttribute('data-color') || '';
  var sizeEl = document.getElementById(rowId + '-size');
  var qtyEl = document.getElementById(rowId + '-qty');
  if (!sizeEl || !qtyEl) return;
  var size = sizeEl.value || '';
  var match = findInventoryProduct(name, color, size);
  var qty = match ? (Number(match.stock_qty) || 0) : 0;
  qtyEl.value = qty;
  qtyEl.classList.toggle('text-red-400', qty === 0);
  qtyEl.classList.toggle('text-orange-400', qty > 0 && qty <= 5);
  qtyEl.classList.toggle('text-zinc-200', qty > 5);
  if (match) {
    tr.setAttribute('data-product-id', String(match.id));
  } else {
    tr.setAttribute('data-product-id', '');
  }
}

/** Save qty for the currently selected size on this inventory row */
async function saveInventoryRow(rowId) {
  if (!window.sb || !isAdmin) return;
  var tr = document.getElementById(rowId);
  if (!tr) return;
  var name = tr.getAttribute('data-name') || '';
  var color = tr.getAttribute('data-color') || '';
  var sizeEl = document.getElementById(rowId + '-size');
  var qtyEl = document.getElementById(rowId + '-qty');
  if (!sizeEl || !qtyEl) return;
  var size = (sizeEl.value || '').trim();
  if (!size) {
    showToast('Select a size first', true);
    return;
  }
  var n = parseInt(qtyEl.value, 10);
  if (isNaN(n) || n < 0) n = 0;

  var match = findInventoryProduct(name, color, size);
  if (match) {
    var res = await window.sb.from('products').update({
      stock_qty: n,
      size: size,
      sizes: size
    }).eq('id', match.id).select('id, stock_qty');
    if (res.error) {
      showToast(res.error.message, true);
      return;
    }
    if (!res.data || !res.data.length) {
      showToast('Save blocked — check admin permissions', true);
      return;
    }
    match.stock_qty = n;
    match.size = size;
    match.sizes = size;
    tr.setAttribute('data-product-id', String(match.id));
    showToast((color ? color + ' · ' : '') + size + ' → ' + n);
    renderProducts();
    return;
  }

  // No row for this size yet — clone from any same name+colour product
  var template = allProducts.find(function (p) {
    return productGroupKey(p) === (name || '').trim().toLowerCase() &&
      productColorKey(p) === ((color || '').trim().toLowerCase() || 'default');
  });
  if (!template) {
    showToast('No product found to attach this size to', true);
    return;
  }
  var payload = {
    name: template.name,
    description: template.description || null,
    price: template.price,
    image_url: template.image_url || null,
    badge: template.badge || null,
    sort_order: template.sort_order || 0,
    is_active: template.is_active !== false,
    color: template.color || '',
    color_hex: template.color_hex || '',
    size: size,
    sizes: size,
    stock_qty: n
  };
  var ins = await window.sb.from('products').insert(payload).select('*').single();
  if (ins.error) {
    showToast(ins.error.message, true);
    return;
  }
  if (ins.data) allProducts.push(ins.data);
  tr.setAttribute('data-product-id', String(ins.data.id));
  showToast('Created ' + size + ' · stock ' + n);
  await loadProducts();
  if (isAdmin) loadSalesDashboard();
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
