/* Rescue 1 Movers — zero-dependency progressive enhancements.
   No analytics, tracking pixels, or lead capture. SmartMoving handles estimate requests. */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const storageKey = 'rescue1-move-plan-v1';

  // Header/navigation
  const toggle = $('#mobile-toggle');
  const menu = $('#mobile-menu');
  let menuOpen = false;

  function setMenu(open) {
    if (!toggle || !menu) return;
    menuOpen = Boolean(open);
    menu.hidden = !menuOpen;
    toggle.setAttribute('aria-expanded', String(menuOpen));
    toggle.setAttribute('aria-label', menuOpen ? 'Close menu' : 'Open menu');
    const use = $('use', toggle);
    if (use) use.setAttribute('href', menuOpen ? '#i-close' : '#i-menu');
    document.body.classList.toggle('no-scroll', menuOpen);
  }

  toggle?.addEventListener('click', () => setMenu(!menuOpen));
  $$('#mobile-menu a').forEach(link => link.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menuOpen) {
      setMenu(false);
      toggle?.focus();
    }
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 1080 && menuOpen) setMenu(false);
  }, { passive: true });

  // Reveal motion is optional; content remains visible without JavaScript.
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.documentElement.classList.add('js-motion');
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px 30px 0px', threshold: 0.05 });
    $$('.reveal').forEach(item => observer.observe(item));
  }

  const year = $('#copyright-year');
  if (year) year.textContent = String(new Date().getFullYear());

  // Avoid displaying a redundant sticky CTA over the actual hero and quote form.
  const floatingQuote = $('.floating-quote');
  const estimate = $('#estimate');
  const hero = $('.hero');
  if (floatingQuote && estimate && hero) {
    let estimateVisible = false;
    const updateFloatingQuote = () => {
      const heroEnd = hero.offsetTop + hero.offsetHeight - 80;
      const shouldHide = window.scrollY < heroEnd || estimateVisible;
      floatingQuote.classList.toggle('is-hidden', shouldHide);
    };
    if ('IntersectionObserver' in window) {
      const quoteObserver = new IntersectionObserver(entries => {
        estimateVisible = entries.some(item => item.isIntersecting);
        updateFloatingQuote();
      }, { threshold: 0.05 });
      quoteObserver.observe(estimate);
    }
    window.addEventListener('scroll', updateFloatingQuote, { passive: true });
    window.addEventListener('resize', updateFloatingQuote, { passive: true });
    updateFloatingQuote();
  }

  // Move planner. No estimates or prices are fabricated. No data leaves the browser.
  const form = $('#planner-form');
  const empty = $('#planner-empty');
  const output = $('#planner-output');
  const checklist = $('#checklist');
  const progressBar = $('#progress-bar');
  const progressLabel = $('#progress-label');
  const taskCount = $('#task-count');
  const dateField = $('#moving-date');
  let plan = null;

  const coreTasks = [
    { id: 'inventory', label: 'Walk through your space and identify everything that needs to move.' },
    { id: 'estimate', label: 'Request your free estimate from Rescue 1 Movers.' },
    { id: 'declutter', label: 'Sort what you want to keep, donate, sell, or recycle.' },
    { id: 'essentials', label: 'Pack a separate bag with medications, chargers, keys, and essentials.' },
    { id: 'label', label: 'Label boxes by room and flag anything fragile.' },
    { id: 'paths', label: 'Clear safe pathways and reserve space for loading.' }
  ];
  const moveTasks = {
    home: [
      { id: 'utilities', label: 'Schedule utility transfers and address changes.' },
      { id: 'large', label: 'Make a note of oversized furniture and tricky doorways.' }
    ],
    apartment: [
      { id: 'management', label: 'Confirm building rules, elevator access, and loading zones.' },
      { id: 'stairs', label: 'Note stairs, floor level, parking distance, and narrow access points.' }
    ],
    office: [
      { id: 'team', label: 'Coordinate an office move schedule with your team.' },
      { id: 'equipment', label: 'Document workstations, electronics, and equipment needing special care.' }
    ]
  };
  const distanceTasks = {
    local: [
      { id: 'localparking', label: 'Check loading and parking access at both addresses.' }
    ],
    long: [
      { id: 'travel', label: 'Confirm destination, travel dates, and delivery timing with the crew.' },
      { id: 'overnight', label: 'Set aside essentials you may need during travel or before delivery.' }
    ]
  };
  const labels = { home: 'HOME', apartment: 'APARTMENT', office: 'OFFICE', local: 'LOCAL', long: 'LONG-DISTANCE' };

  function getTasks(type, distance) {
    return [...coreTasks, ...moveTasks[type], ...distanceTasks[distance]];
  }

  function readStorage() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (!value || !['home', 'apartment', 'office'].includes(value.type) ||
          !['local', 'long'].includes(value.distance) ||
          !Array.isArray(value.done)) return null;
      return {
        type: value.type,
        distance: value.distance,
        date: typeof value.date === 'string' ? value.date.slice(0, 10) : '',
        done: value.done.filter(item => typeof item === 'string')
      };
    } catch {
      return null;
    }
  }

  function saveStorage() {
    if (!plan) return;
    try { localStorage.setItem(storageKey, JSON.stringify(plan)); } catch { /* storage disabled */ }
  }

  function setRadio(name, value) {
    const input = $$('input[name="' + name + '"]', form).find(item => item.value === value);
    if (input) input.checked = true;
  }

  function updateProgress() {
    if (!plan || !checklist) return;
    const tasks = getTasks(plan.type, plan.distance);
    const done = tasks.filter(item => plan.done.includes(item.id)).length;
    const percent = tasks.length ? done / tasks.length * 100 : 0;
    progressBar.style.width = percent + '%';
    progressLabel.textContent = done + ' / ' + tasks.length + ' COMPLETE';
    taskCount.textContent = tasks.length + ' STEPS';
  }

  function printDate(value) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'MOVE DATE: TO BE DECIDED';
    const date = new Date(value + 'T12:00:00');
    if (Number.isNaN(date.getTime())) return 'MOVE DATE: TO BE DECIDED';
    return 'TARGET MOVE DATE: ' + new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
  }

  function renderPlan() {
    if (!form || !empty || !output || !checklist || !plan) return;
    const tasks = getTasks(plan.type, plan.distance);
    empty.hidden = true;
    output.hidden = false;
    const heading = $('#planner-result-title');
    if (heading) heading.textContent = labels[plan.type] + ' MOVE / ' + labels[plan.distance];
    const dateText = $('#planner-date');
    if (dateText) dateText.textContent = printDate(plan.date);
    checklist.replaceChildren();

    for (const task of tasks) {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      const text = document.createElement('span');
      checkbox.type = 'checkbox';
      checkbox.checked = plan.done.includes(task.id);
      checkbox.setAttribute('aria-label', task.label);
      text.textContent = task.label;
      checkbox.addEventListener('change', () => {
        plan.done = checkbox.checked
          ? [...new Set([...plan.done, task.id])]
          : plan.done.filter(id => id !== task.id);
        saveStorage();
        updateProgress();
      });
      label.append(checkbox, text);
      li.append(label);
      checklist.append(li);
    }
    updateProgress();
  }

  if (form && checklist) {
    const previous = readStorage();
    if (previous) {
      setRadio('moveType', previous.type);
      setRadio('moveDistance', previous.distance);
      if (dateField) dateField.value = previous.date;
      plan = previous;
      renderPlan();
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      const data = new FormData(form);
      const type = String(data.get('moveType') || 'home');
      const distance = String(data.get('moveDistance') || 'local');
      if (!moveTasks[type] || !distanceTasks[distance]) return;
      const nextDate = dateField?.value || '';
      // Reset the checklist only when its identity changes; preserve progress on date edits.
      const retained = plan && plan.type === type && plan.distance === distance ? plan.done : [];
      plan = { type, distance, date: nextDate, done: retained };
      saveStorage();
      renderPlan();
      if (window.innerWidth < 761 && output) {
        output.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
      }
    });

    $('#print-plan')?.addEventListener('click', () => {
      if (plan) window.print();
    });
  }

  // Native <details> works without JS. Keep at most one FAQ open at a time.
  const faqs = $$('.faq-accordion details');
  faqs.forEach(item => item.addEventListener('toggle', () => {
    if (item.open) faqs.forEach(other => { if (other !== item) other.open = false; });
  }));
})();
