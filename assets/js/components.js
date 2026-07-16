async function loadComponents() {
  try {
    const headerRes = await fetch('/assets/html/header.html');
    const headerHTML = await headerRes.text();
    document.getElementById('header-container').innerHTML = headerHTML;
    updateAuthUI();
  } catch (err) { console.error('Header load failed', err); }

  try {
    const footerRes = await fetch('/assets/html/footer.html');
    const footerHTML = await footerRes.text();
    document.getElementById('footer-container').innerHTML = footerHTML;
  } catch (err) { console.error('Footer load failed', err); }
}

async function updateAuthUI() {
  const supabase = window.supabase;
  if (!supabase) return;
  const { data: { user } } = await supabase.auth.getUser();
  const nav = document.getElementById('main-nav');
  const mobileNav = document.getElementById('mobile-menu');
  if (user) {
    const { data: profile } = await supabase.from('profiles').select('full_name, is_admin').eq('id', user.id).single();
    const displayName = profile?.full_name || user.email;
    const adminLink = profile?.is_admin ? '<a href="/admin">Admin</a>' : '';
    const userMenu = `
      <a href="/dashboard.html">Dashboard</a>
      <a href="/profile.html">${displayName}</a>
      ${adminLink}
      <a href="#" id="logout-link">Logout</a>
    `;
    if (nav) nav.innerHTML = userMenu;
    if (mobileNav) mobileNav.innerHTML = userMenu;
    document.getElementById('logout-link')?.addEventListener('click', async (e) => {
      e.preventDefault();
      await supabase.auth.signOut();
      window.location.href = '/login.html';
    });
  } else {
    const guestMenu = `
      <a href="/">Home</a>
      <a href="/login.html">Login</a>
      <a href="/register.html">Register</a>
    `;
    if (nav) nav.innerHTML = guestMenu;
    if (mobileNav) mobileNav.innerHTML = guestMenu;
  }
}

function toggleMobileMenu() {
  document.getElementById('mobile-menu')?.classList.toggle('active');
}

document.addEventListener('DOMContentLoaded', loadComponents);
