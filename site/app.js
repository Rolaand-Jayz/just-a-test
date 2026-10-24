(() => {
  'use strict';
  const menuToggle = document.querySelector('.menu-toggle');
  const nav = document.getElementById('primary-nav');
  const closeMenu = () => {
    nav.classList.remove('is-open');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open navigation');
  };
  menuToggle.addEventListener('click', () => {
    const open = menuToggle.getAttribute('aria-expanded') !== 'true';
    nav.classList.toggle('is-open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  });
  nav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenu();
  });
  document.addEventListener('click', event => {
    if (!nav.contains(event.target) && !menuToggle.contains(event.target)) closeMenu();
  });
  window.matchMedia('(min-width: 951px)').addEventListener('change', event => {
    if (event.matches) closeMenu();
  });

  const input = document.getElementById('community-query');
  const items = Array.from(document.querySelectorAll('#community-list li'));
  const count = document.getElementById('community-count');
  const empty = document.getElementById('empty-search');
  const update = () => {
    const query = input.value.trim().toLocaleLowerCase();
    let visible = 0;
    items.forEach(item => {
      const match = item.textContent.toLocaleLowerCase().includes(query);
      item.hidden = !match;
      if (match) visible++;
    });
    count.textContent = visible + ' / ' + items.length;
    empty.hidden = visible !== 0;
  };
  input.addEventListener('input', update);
  update();
  document.getElementById('copyright-year').textContent = String(new Date().getFullYear());
})();