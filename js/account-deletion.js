/**
 * SB Racing — in-app account deletion
 * App Store Guideline 5.1.1(v): apps that support account creation must offer account deletion.
 *
 * Requires Supabase SQL function `public.delete_own_account()` (see supabase/delete_own_account.sql).
 */
(function (global) {
  'use strict';

  function getClient() {
    return global.sb || (global.supabase && null);
  }

  function showError(msg) {
    var el = document.getElementById('delete-account-error');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
  }

  function openDeleteAccountModal() {
    var modal = document.getElementById('delete-account-modal');
    var input = document.getElementById('delete-account-confirm-input');
    if (!modal) return;
    showError('');
    if (input) input.value = '';
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    setTimeout(function () { if (input) input.focus(); }, 50);
  }

  function closeDeleteAccountModal() {
    var modal = document.getElementById('delete-account-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.style.display = 'none';
    showError('');
  }

  async function confirmDeleteAccount() {
    var input = document.getElementById('delete-account-confirm-input');
    var btn = document.getElementById('delete-account-confirm-btn');
    var typed = (input && input.value || '').trim();

    if (typed !== 'DELETE') {
      showError('Type DELETE in all caps to confirm.');
      if (input) input.focus();
      return;
    }

    var client = global.sb;
    if (!client || !client.auth) {
      showError('Not signed in or Supabase is unavailable.');
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Deleting…';
    }
    showError('');

    try {
      // 1) Preferred: single RPC that cleans data + auth user (security definer)
      var rpc = await client.rpc('delete_own_account');
      if (rpc.error) {
        // 2) Fallback: best-effort client deletes of known tables, then sign out
        //    (auth user may remain until you run the SQL function)
        console.warn('[delete-account] RPC failed, trying client cleanup:', rpc.error.message);
        await clientCleanup(client);
        // Still try RPC once more in case transient error
        var rpc2 = await client.rpc('delete_own_account');
        if (rpc2.error) {
          throw new Error(
            rpc.error.message +
            ' — Run supabase/delete_own_account.sql in the Supabase SQL editor, then try again.'
          );
        }
      }

      try { await client.auth.signOut(); } catch (e) { /* ignore */ }

      closeDeleteAccountModal();

      // Reset UI to login wall
      var dash = document.getElementById('member-dashboard');
      var wall = document.getElementById('login-wall');
      if (dash) dash.classList.add('hidden');
      if (wall) wall.classList.remove('hidden');

      if (typeof global.showToast === 'function') {
        global.showToast('Your account has been deleted.');
      } else {
        alert('Your account has been deleted.');
      }

      // Optional: hard refresh so no cached member state remains
      setTimeout(function () {
        try { location.reload(); } catch (e) {}
      }, 600);
    } catch (err) {
      console.error('[delete-account]', err);
      showError(err.message || 'Could not delete account. Please try again or email support.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Delete forever';
      }
    }
  }

  /** Best-effort cleanup when RPC is missing — does not remove auth.users */
  async function clientCleanup(client) {
    var session = (await client.auth.getSession()).data.session;
    if (!session || !session.user) return;
    var uid = session.user.id;

    // Tables may not all exist — ignore individual errors
    var attempts = [
      function () { return client.from('rides').delete().eq('user_id', uid); },
      function () { return client.from('ride_logs').delete().eq('user_id', uid); },
      function () { return client.from('push_tokens').delete().eq('user_id', uid); },
      function () { return client.from('profiles').delete().eq('id', uid); },
      function () { return client.from('members').delete().eq('id', uid); },
      function () { return client.from('member_profiles').delete().eq('id', uid); }
    ];

    for (var i = 0; i < attempts.length; i++) {
      try {
        await attempts[i]();
      } catch (e) { /* table missing or RLS — ignore */ }
    }
  }

  // Backdrop click closes modal
  document.addEventListener('DOMContentLoaded', function () {
    var modal = document.getElementById('delete-account-modal');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeDeleteAccountModal();
      });
    }
  });

  global.openDeleteAccountModal = openDeleteAccountModal;
  global.closeDeleteAccountModal = closeDeleteAccountModal;
  global.confirmDeleteAccount = confirmDeleteAccount;
})(typeof window !== 'undefined' ? window : this);
