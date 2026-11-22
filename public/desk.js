'use strict';

(() => {
  const home = document.getElementById('home-page');
  const planner = document.getElementById('planner-page');
  const preview = document.getElementById('space-preview');
  const editor = document.getElementById('editor');
  const spaces = {
    notebook: {title:'Notebook', description:'Planned for this space: open a lecture PDF beside a grid page, then write and arrange microscope images with your Pencil.'},
    review: {title:'Review', description:'Planned for this space: hide a label on a lecture image, name what you see, and flip it over to check your answer.'}
  };

  function navigate(moveFocus) {
    const section = location.hash === '#planner' ? 'planner' : 'home';
    home.hidden = section !== 'home';
    planner.hidden = section !== 'planner';
    document.title = section === 'planner' ? 'Study calendar · Abi’s study desk' : 'Abi’s study desk';
    for (const link of document.querySelectorAll('.desk-nav a')) {
      if (link.hash === '#' + section) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    }
    if (moveFocus) {
      if (preview.open) preview.close();
      if (editor.open) editor.close();
      (section === 'planner' ? planner : home).querySelector('h1').focus({preventScroll:true});
      window.scrollTo(0, 0);
    }
  }

  document.getElementById('home-today').addEventListener('click', () => document.getElementById('today').click());
  for (const button of document.querySelectorAll('[data-preview]')) {
    button.addEventListener('click', () => {
      const space = spaces[button.dataset.preview];
      document.getElementById('preview-name').textContent = space.title;
      document.getElementById('preview-description').textContent = space.description;
      preview.showModal();
    });
  }
  document.getElementById('preview-close').addEventListener('click', () => preview.close());
  window.addEventListener('hashchange', () => navigate(true));
  navigate(false);

  const motion = matchMedia('(hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference)');
  const light = document.getElementById('pointer-light');
  const art = document.getElementById('desk-art');
  let frame = 0;
  let visible = false;
  let x = 0, y = 0, targetX = 0, targetY = 0;
  function track() {
    x += (targetX - x) * .18;
    y += (targetY - y) * .18;
    light.style.transform = 'translate3d(' + (x - 150) + 'px,' + (y - 150) + 'px,0)';
    if (!home.hidden) {
      const driftX = (x / window.innerWidth - .5) * 8;
      const driftY = (y / window.innerHeight - .5) * 5;
      art.style.transform = 'translate(' + driftX + 'px,' + driftY + 'px)';
    }
    frame = Math.abs(targetX - x) + Math.abs(targetY - y) > .6 ? requestAnimationFrame(track) : 0;
  }
  function hide() {
    light.style.opacity = '0';
    art.style.transform = '';
    visible = false;
    cancelAnimationFrame(frame);
    frame = 0;
  }
  function move(event) {
    if (!motion.matches || event.pointerType !== 'mouse') { if (visible) hide(); return; }
    targetX = event.clientX;
    targetY = event.clientY;
    if (!visible) {
      x = targetX;
      y = targetY;
      visible = true;
      light.style.opacity = '1';
    }
    if (!frame) frame = requestAnimationFrame(track);
  }
  document.addEventListener('pointermove', move, {passive:true});
  document.documentElement.addEventListener('pointerleave', hide);
  window.addEventListener('blur', hide);
  motion.addEventListener('change', hide);
})();
