(function () {
  const STORAGE_KEY = 'permission-out.theme';
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  function readPreference() {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  }

  function writePreference(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* Theme still applies for this session. */ }
  }

  function storedTheme() {
    const value = readPreference();
    return value === 'light' || value === 'dark' ? value : null;
  }

  function resolvedTheme() {
    return storedTheme() || (media.matches ? 'dark' : 'light');
  }

  function updateButton(theme) {
    const button = document.getElementById('themeToggle');
    if (!button) return;
    const dark = theme === 'dark';
    button.dataset.theme = theme;
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute('aria-label', dark ? 'โหมดมืด กดเพื่อเปลี่ยนเป็นโหมดสว่าง' : 'โหมดสว่าง กดเพื่อเปลี่ยนเป็นโหมดมืด');
    button.title = dark ? 'Dark mode · เปลี่ยนเป็น Light mode' : 'Light mode · เปลี่ยนเป็น Dark mode';
    const icon = button.querySelector('.theme-toggle-icon');
    const label = button.querySelector('.theme-toggle-label');
    if (icon) icon.textContent = dark ? '\u263E' : '\u2600';
    if (label) label.textContent = dark ? 'Dark' : 'Light';
  }

  function applyTheme(theme, persist) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#070914' : '#f4f7fb');
    if (persist) writePreference(theme);
    updateButton(theme);
    window.dispatchEvent(new CustomEvent('permission-theme-change', { detail: { theme } }));
  }

  applyTheme(resolvedTheme(), false);

  document.addEventListener('DOMContentLoaded', function () {
    updateButton(root.dataset.theme);
    document.getElementById('themeToggle')?.addEventListener('click', function () {
      applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
    });
  });

  media.addEventListener?.('change', function () {
    if (!storedTheme()) applyTheme(resolvedTheme(), false);
  });
})();
