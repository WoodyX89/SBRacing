// Supabase client configuration for SB Racing
// Uses the public (anon / publishable) key — safe for frontend

const SUPABASE_URL = 'https://vuqwfpwtwacwvaofqjdp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1cXdmcHd0d2Fjd3Zhb2ZxamRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyODk2NjIsImV4cCI6MjEwMDg2NTY2Mn0.2fxwGOqnqZXkF5CUW-8Lmurqx0j2Eo_Y1HehNEKh_-g';

// Load the Supabase JS client from CDN if not already present
if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
  console.warn('Supabase JS not loaded yet. Include the CDN script before this file.');
}

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
  },
});

// Expose globally
window.sb = sb;

// Auth helpers
async function getSession() {
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

async function getCurrentUser() {
  const { data: { user } } = await sb.auth.getUser();
  return user;
}

async function getProfile(userId) {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) {
    console.error('getProfile error:', error);
    return null;
  }
  return data;
}

async function signOut() {
  await sb.auth.signOut();
  localStorage.removeItem('sb_member');
  window.location.href = 'members.html';
}

// Membership tiers (kept in sync with DB enum / values)
const MEMBERSHIP_TIERS = {
  0: { name: 'Trail Rider', price: 45, slug: 'trail_rider' },
  1: { name: 'Coulee Crusher', price: 85, slug: 'coulee_crusher' },
  2: { name: 'Youth / Student', price: 25, slug: 'youth' },
};
