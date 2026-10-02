/**
 * Open membership: create a login + active profile in one step.
 * No club_applications / approval email.
 */
async function submitClubApplication(e) {
  e.preventDefault();

  var name = (document.getElementById('full-name').value || '').trim();
  var email = (document.getElementById('email').value || '').trim().toLowerCase();
  var phone = (document.getElementById('phone') && document.getElementById('phone').value || '').trim();
  var city = (document.getElementById('city') && document.getElementById('city').value || '').trim();
  var experience = (document.getElementById('experience') && document.getElementById('experience').value || '').trim();
  var password = (document.getElementById('password') && document.getElementById('password').value) || '';
  var password2 = (document.getElementById('password-2') && document.getElementById('password-2').value) || '';

  if (!name || !email || !password) {
    if (typeof showToast === 'function') showToast('Name, email, and password are required', true);
    return;
  }
  if (password.length < 6) {
    if (typeof showToast === 'function') showToast('Password must be at least 6 characters', true);
    return;
  }
  if (password !== password2) {
    if (typeof showToast === 'function') showToast('Passwords do not match', true);
    return;
  }

  var btn = document.getElementById('apply-submit');
  var original = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>CREATING ACCOUNT…';
  }

  try {
    if (!window.sb) throw new Error('Connection not ready. Refresh and try again.');

    var result = await window.sb.auth.signUp({
      email: email,
      password: password,
      options: {
        data: { full_name: name, phone: phone || null, city: city || null },
        emailRedirectTo: (window.SB_SITE_URL || location.origin) + '/members.html'
      }
    });
    if (result.error) throw result.error;

    var user = (result.data && result.data.user) || null;
    var session = result.data && result.data.session;

    if (!session) {
      var signed = await window.sb.auth.signInWithPassword({ email: email, password: password });
      if (!signed.error) {
        session = signed.data && signed.data.session;
        user = (signed.data && signed.data.user) || user;
      }
    }

    if (user && user.id) {
      var row = {
        id: user.id,
        full_name: name,
        email: email,
        membership_status: 'active',
        membership_tier: 'member',
        phone: phone || null,
        experience_level: experience || null
      };
      var up = await window.sb.from('profiles').upsert(row, { onConflict: 'id' });
      if (up.error) {
        var fallback = { id: user.id, full_name: name, email: email, membership_status: 'active' };
        var up2 = await window.sb.from('profiles').upsert(fallback, { onConflict: 'id' });
        if (up2.error) console.warn('[join] profile', up2.error);
      }
    }

    try {
      await window.sb.functions.invoke('notify-event', {
        body: {
          title: 'New member',
          body: name + ' just signed up (' + email + ')',
          audience: 'leaders',
          data: {
            url: 'https://sbracing.ca/members',
            type: 'new_member',
            audience: 'leaders'
          }
        }
      });
    } catch (pushErr) {
      console.warn('[join] leader push', pushErr);
    }

    var form = document.getElementById('apply-form');
    var card = document.getElementById('apply-card');
    var success = document.getElementById('apply-success');
    if (form) form.reset();
    if (card) card.classList.add('hidden');
    if (success) success.classList.remove('hidden');

    if (session) {
      if (typeof showToast === 'function') showToast('You are in. Welcome to SB Racing.');
      setTimeout(function () { location.href = 'members.html'; }, 900);
    } else {
      var note = document.getElementById('apply-success-note');
      if (note) {
        note.textContent = 'Account created, but email confirmation is still on in Supabase. Turn off Confirm email under Authentication → Providers → Email, or they will not land on the members list until they confirm.';
      }
      if (typeof showToast === 'function') showToast('Account created. Confirm email.');
    }
  } catch (err) {
    console.error('[join]', err);
    var msg = (err && err.message) ? err.message : 'Could not create account';
    if (/already registered|already been registered|User already registered/i.test(msg)) {
      msg = 'That email already has an account. Log in on the Members page.';
    }
    if (typeof showToast === 'function') showToast(msg, true);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original || 'CREATE ACCOUNT';
    }
  }
}
