// Private club applications — no dues, no Stripe, no instant account.

async function submitClubApplication(e) {
  e.preventDefault();

  const name = (document.getElementById('full-name').value || '').trim();
  const email = (document.getElementById('email').value || '').trim();
  const phone = (document.getElementById('phone')?.value || '').trim();
  const city = (document.getElementById('city')?.value || '').trim();
  const experience = (document.getElementById('experience')?.value || '').trim();
  const howFound = (document.getElementById('how-found')?.value || '').trim();
  const whyJoin = (document.getElementById('why-join')?.value || '').trim();

  if (!name || !email || !experience || !whyJoin) {
    if (typeof showToast === 'function') showToast('Name, email, experience, and why you want in are required', true);
    return;
  }

  const btn = document.getElementById('apply-submit');
  const original = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>SENDING…';
  }

  const row = {
    full_name: name,
    email: email,
    phone: phone || null,
    city: city || null,
    experience: experience,
    how_found: howFound || null,
    why_join: whyJoin,
    status: 'pending'
  };

  try {
    if (!window.sb) throw new Error('Connection not ready. Refresh and try again.');

    const { error } = await window.sb.from('club_applications').insert(row);
    if (error) throw error;

    const form = document.getElementById('apply-form');
    const card = document.getElementById('apply-card');
    const success = document.getElementById('apply-success');
    if (form) form.reset();
    if (card) card.classList.add('hidden');
    if (success) success.classList.remove('hidden');
    if (typeof showToast === 'function') showToast('Application sent. We will be in touch.');
  } catch (err) {
    console.error('[apply]', err);
    const msg = (err && err.message) ? err.message : 'Could not send application';
    if (typeof showToast === 'function') {
      showToast(
        /relation|schema cache|club_applications/i.test(msg)
          ? 'Applications table is not set up yet. Run supabase/club_applications.sql in Supabase.'
          : msg,
        true
      );
    }
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original || 'SUBMIT APPLICATION';
    }
  }
}
