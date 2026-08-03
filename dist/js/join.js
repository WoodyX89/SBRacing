// Membership signup + payment demo → real Supabase Auth + profiles

let selectedTierPrice = 0;
let selectedTierName = '';
let selectedTierSlug = '';

function selectTier(tierIndex, element) {
    document.querySelectorAll('.tier-card').forEach(card => {
        card.classList.remove('border-orange-600', 'scale-[1.015]');
        card.classList.add('border-zinc-700');
    });
    element.classList.remove('border-zinc-700');
    element.classList.add('border-orange-600', 'scale-[1.015]');

    const tier = MEMBERSHIP_TIERS[tierIndex];
    selectedTierName = tier.name;
    selectedTierPrice = tier.price;
    selectedTierSlug = tier.slug;

    document.getElementById('tier-name').innerHTML = selectedTierName;
    document.getElementById('tier-price').innerHTML = '$' + selectedTierPrice;
    document.getElementById('selected-tier').value = tierIndex;
}

function submitMembership(e) {
    e.preventDefault();

    const tier = document.getElementById('selected-tier').value;
    if (tier === '' || tier === null) {
        alert('Please select a membership tier first by clicking one of the cards above.');
        return;
    }

    const name = document.getElementById('full-name').value.trim();
    const email = document.getElementById('email').value.trim();
    const phone = document.getElementById('phone')?.value?.trim() || '';

    if (!name || !email) {
        showToast('Name and email are required', true);
        return;
    }

    window.pendingMember = {
        name,
        email,
        phone,
        tier: selectedTierName,
        tierSlug: selectedTierSlug,
        price: selectedTierPrice
    };

    showPaymentModal();
}

function showPaymentModal() {
    const modal = document.getElementById('payment-modal');
    const pending = window.pendingMember;
    if (!pending) return;

    document.getElementById('payment-tier-name').textContent = pending.tier;
    document.getElementById('payment-amount').textContent = '$' + pending.price;
    document.getElementById('payment-total').textContent = '$' + pending.price;

    // Show password fields if they don't exist yet (we'll create account on "pay")
    let pwSection = document.getElementById('signup-password-section');
    if (!pwSection) {
        const form = document.getElementById('payment-form');
        const insertBefore = form.querySelector('button[type="submit"]');
        const div = document.createElement('div');
        div.id = 'signup-password-section';
        div.className = 'space-y-4 mb-4';
        div.innerHTML = `
            <div class="text-xs text-zinc-400 mb-1">Create your members account password</div>
            <div>
                <label class="text-xs font-medium text-zinc-400">PASSWORD (min 6 characters)</label>
                <input type="password" id="signup-password" required minlength="6"
                       class="mt-1.5 w-full bg-zinc-950 border border-zinc-700 rounded-2xl px-5 py-3 text-sm outline-none focus:border-orange-600"
                       placeholder="Choose a password">
            </div>
            <div>
                <label class="text-xs font-medium text-zinc-400">CONFIRM PASSWORD</label>
                <input type="password" id="signup-password-confirm" required minlength="6"
                       class="mt-1.5 w-full bg-zinc-950 border border-zinc-700 rounded-2xl px-5 py-3 text-sm outline-none focus:border-orange-600"
                       placeholder="Confirm password">
            </div>
        `;
        form.insertBefore(div, insertBefore);
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function hidePaymentModal() {
    const modal = document.getElementById('payment-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

async function processPayment(e) {
    e.preventDefault();

    const pending = window.pendingMember;
    if (!pending) return;

    const password = document.getElementById('signup-password')?.value;
    const passwordConfirm = document.getElementById('signup-password-confirm')?.value;

    if (!password || password.length < 6) {
        showToast('Password must be at least 6 characters', true);
        return;
    }
    if (password !== passwordConfirm) {
        showToast('Passwords do not match', true);
        return;
    }

    const btn = e.target.querySelector('button[type="submit"]') || e.target.querySelector('button');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<span class="flex items-center justify-center gap-x-2"><i class="fa-solid fa-spinner fa-spin"></i> CREATING ACCOUNT...</span>`;
    btn.disabled = true;

    try {
        // 1. Create auth user
        const { data: authData, error: authError } = await sb.auth.signUp({
            email: pending.email,
            password: password,
            options: {
                data: {
                    full_name: pending.name,
                    phone: pending.phone
                }
            }
        });

        if (authError) throw authError;

        const userId = authData.user?.id;

        // 2. Update profile with membership info
        if (userId) {
            const expires = new Date();
            expires.setFullYear(expires.getFullYear() + 1);

            const { error: profileError } = await sb
                .from('profiles')
                .upsert({
                    id: userId,
                    email: pending.email,
                    full_name: pending.name,
                    phone: pending.phone,
                    membership_tier: pending.tierSlug,
                    membership_status: 'active',
                    membership_expires_at: expires.toISOString()
                }, { onConflict: 'id' });

            if (profileError) {
                console.warn('Profile update warning:', profileError.message);
                // Continue — trigger may have already created the row
            }
        }

        hidePaymentModal();
        showToast(`Welcome to SB Racing, ${pending.name.split(' ')[0]}! Your ${pending.tier} membership is active.`);

        // Reset form
        document.getElementById('membership-form').reset();
        document.getElementById('tier-name').innerHTML = 'Please select a tier above';
        document.getElementById('tier-price').innerHTML = '';
        document.querySelectorAll('.tier-card').forEach(c => {
            c.classList.remove('border-orange-600', 'scale-[1.015]');
            c.classList.add('border-zinc-700');
        });

        window.pendingMember = null;

        // Redirect to members area
        setTimeout(() => {
            window.location.href = 'members.html';
        }, 1600);

    } catch (err) {
        console.error(err);
        showToast(err.message || 'Signup failed. Try a different email or check console.', true);
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// Pre-select popular tier
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const tiers = document.querySelectorAll('.tier-card');
        if (tiers.length > 1) tiers[1].click();
    }, 300);
});
