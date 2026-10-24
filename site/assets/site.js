(() => {
  'use strict';
  const root = document.documentElement;
  const themeButton = document.querySelector('.theme-switch');
  const themeLabel = document.querySelector('.theme-text');
  const themeSymbol = document.querySelector('.theme-symbol');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  const storedTheme = () => {
    try { return localStorage.getItem('asbcs-theme'); }
    catch { return null; }
  };
  const currentTheme = () => {
    const explicit = root.dataset.theme;
    return explicit === 'light' || explicit === 'dark'
      ? explicit : (prefersDark.matches ? 'dark' : 'light');
  };
  const updateThemeControl = () => {
    const target = currentTheme() === 'dark' ? 'light' : 'dark';
    themeButton.setAttribute('aria-label', 'Switch to ' + target + ' mode');
    themeButton.setAttribute('title', 'Switch to ' + target + ' mode');
    themeLabel.textContent = target.toUpperCase();
    themeSymbol.textContent = target === 'light' ? '☼' : '☾';
  };
  if (themeButton) {
    updateThemeControl();
    themeButton.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('asbcs-theme', next); }
      catch { /* Local storage is optional; the toggle still works. */ }
      updateThemeControl();
    });
    const onPreferenceChange = () => {
      if (!root.dataset.theme && !storedTheme()) updateThemeControl();
    };
    if (prefersDark.addEventListener) prefersDark.addEventListener('change', onPreferenceChange);
    else if (prefersDark.addListener) prefersDark.addListener(onPreferenceChange);
  }

  const menuButton = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.main-nav');
  const closeMenu = () => {
    if (!menuButton || !nav) return;
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open navigation');
    nav.classList.remove('is-open');
  };
  if (menuButton && nav) {
    menuButton.addEventListener('click', () => {
      const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
      menuButton.setAttribute('aria-expanded', String(!isOpen));
      menuButton.setAttribute('aria-label', isOpen ? 'Open navigation' : 'Close navigation');
      nav.classList.toggle('is-open', !isOpen);
    });
    nav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { closeMenu(); menuButton.focus(); }
    });
    document.addEventListener('click', event => {
      if (!nav.contains(event.target) && !menuButton.contains(event.target)) closeMenu();
    });
    const desktop = window.matchMedia('(min-width: 1041px)');
    if (desktop.addEventListener) desktop.addEventListener('change', closeMenu);
    else if (desktop.addListener) desktop.addListener(closeMenu);
  }
  const page = document.body.dataset.page;
  if (page && page !== 'home') {
    const active = document.querySelector('[data-nav="' + page + '"]');
    if (active) { active.classList.add('active'); active.setAttribute('aria-current', 'page'); }
  }
  const search = document.querySelector('#community-search');
  if (search) {
    const rows = [...document.querySelectorAll('#community-directory li')];
    const count = document.querySelector('#directory-count');
    const empty = document.querySelector('#directory-empty');
    search.addEventListener('input', () => {
      const term = search.value.trim().toLocaleLowerCase();
      let visible = 0;
      for (const row of rows) {
        const matches = (row.dataset.name || '').includes(term);
        row.hidden = !matches;
        if (matches) visible++;
      }
      if (count) count.textContent = visible + ' SHOWN';
      if (empty) empty.hidden = visible !== 0;
    });
  }
})();