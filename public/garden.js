'use strict';

(() => {
  const get = id => document.getElementById(id);
  const page = get('garden-page');
  const world = get('garden-world');
  const viewport = get('garden-viewport');
  const pad = get('draw-pad');
  const pen = pad.getContext('2d');
  const draft = get('doodle-editor');
  const memory = get('doodle-memory');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const colors = {Plum:'#4c2365', Coral:'#c45664', Fern:'#437858', Gold:'#ba831e', Blue:'#426b9b'};
  const guide = 'Swipe to explore. Tap the grass to guide your snail.';
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const strokes = [];
  const pictures = new Map();
  let ink = colors.Plum;
  let drawing = null;
  let harvest = null;
  let saving = false;
  let revision = 0;
  let cursor = {x:.08, y:.79};
  let drag = null;

  function openMemory(id) {
    const item = pictures.get(id);
    if (!item) return;
    const image = new Image();
    image.alt = 'Your original doodle';
    image.src = item.url;
    get('memory-image').replaceChildren(image);
    get('memory-note').textContent = item.note;
    get('memory-note').hidden = !item.note;
    get('memory-date').textContent = 'Planted ' + new Date(item.created).toLocaleDateString(undefined,{dateStyle:'long'});
    memory.showModal();
  }

  async function refresh(newId) {
    const version = ++revision;
    try {
      const saved = await storageService.listDoodles();
      if (version !== revision) return;
      saved.sort((a,b) => a.created - b.created);
      const list = get('find-memory');
      list.replaceChildren(new Option('Choose a memory',''));
      const plants = document.createDocumentFragment();
      for (const [index, data] of saved.entries()) {
        if (!pictures.has(data.id)) pictures.set(data.id, {url:data.image,note:data.note});
        const item = pictures.get(data.id);
        Object.assign(item, {created:data.created,x:data.x,y:data.y});
        const label = 'Doodle ' + (index + 1) + (data.note ? ' · ' + data.note : '');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = data.id === newId ? 'plant new' : 'plant';
        button.classList.toggle('visitor',index % 3 === 0);
        button.disabled = !!harvest;
        button.setAttribute('aria-label',label);
        button.style.left = data.x * 100 + '%';
        button.style.top = data.y * 100 + '%';
        const image = new Image();
        image.alt = '';
        image.src = item.url;
        button.append(image);
        button.addEventListener('click',() => openMemory(data.id));
        plants.append(button);
        list.add(new Option(label, data.id));
      }
      get('garden-plots').replaceChildren(plants);
      get('garden-count').textContent = saved.length + (saved.length === 1 ? ' doodle' : ' doodles');
      get('memory-picker').hidden = !saved.length || !!harvest;
    } catch {
      get('garden-message').textContent = 'Your garden could not be loaded. Check your storage or connection and reopen it.';
    }
  }

  function lookAt(x) {
    viewport.scrollTo({left:x * world.clientWidth - viewport.clientWidth / 2, behavior:reducedMotion.matches ? 'instant' : 'smooth'});
  }
  function walk(x, y) {
    const next = {x:clamp(x,.021,.979),y:clamp(y,.42,.93)};
    const snail = get('snail');
    if (next.x !== cursor.x) snail.classList.toggle('facing-left',next.x < cursor.x);
    cursor = next;
    snail.style.left = cursor.x * 100 + '%';
    snail.style.top = cursor.y * 100 + '%';
  }
  function step(direction) {
    const center = viewport.scrollLeft + viewport.clientWidth / 2;
    walk((center + direction * viewport.clientWidth * .66) / world.clientWidth, cursor.y);
    lookAt(cursor.x);
  }
  function landmark() {
    const center = (viewport.scrollLeft + viewport.clientWidth / 2) / world.clientWidth;
    get('garden-place').textContent = ['Clover meadow','Willow hollow','Moonflower field'][clamp(Math.floor(center * 3),0,2)];
  }
  get('walk-left').onclick = () => step(-1);
  get('walk-right').onclick = () => step(1);
  viewport.addEventListener('scroll',landmark,{passive:true});
  new ResizeObserver(landmark).observe(viewport);
  get('find-memory').onchange = event => {
    const id = event.target.value;
    if (pictures.has(id)) { lookAt(pictures.get(id).x); openMemory(id); }
    event.target.value = '';
  };
  get('memory-close').onclick = () => memory.close();

  function placementUI() {
    page.classList.toggle('placing',!!harvest);
    get('garden-draw').textContent = harvest ? 'Back to drawing' : 'Plant a doodle';
    get('plant-here').hidden = !harvest;
    get('plant-here').disabled = saving;
    get('garden-draw').disabled = saving;
    get('memory-picker').hidden = !pictures.size || !!harvest;
    for (const plant of get('garden-plots').children) plant.disabled = !!harvest;
    get('garden-hint').textContent = harvest ? 'Tap a patch of grass to plant, or guide your snail and plant beside it.' : guide;
  }

  async function plant() {
    if (!harvest || saving) return;
    saving = true;
    placementUI();
    const item = {...harvest, x:cursor.x, y:cursor.y, created:Date.now()};
    try {
      await storageService.saveDoodle(item);
      harvest = null;
      strokes.length = 0;
      get('doodle-note').value = '';
      const beside = (item.x > .9 ? -54 : 54) / world.clientWidth;
      walk(item.x + beside, item.y + .015);
      await refresh(item.id);
      get('garden-message').textContent = 'Planted! Tap your doodle to open its memory.';
    } catch {
      get('garden-message').textContent = 'The doodle could not be saved. Your drawing is still here. Check your storage or connection and try again.';
    } finally {
      saving = false;
      placementUI();
    }
  }
  get('plant-here').onclick = () => { lookAt(cursor.x); plant(); };
  viewport.addEventListener('keydown', event => {
    if (event.target !== viewport || saving) return;
    const moves = {ArrowLeft:[-.02,0],ArrowRight:[.02,0],ArrowUp:[0,-.06],ArrowDown:[0,.06]};
    if (moves[event.key]) {
      event.preventDefault();
      const [dx,dy] = moves[event.key];
      walk(cursor.x + dx, cursor.y + dy);
      lookAt(cursor.x);
    } else if (harvest && event.key === 'Enter') { event.preventDefault(); plant(); }
  });
  viewport.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || event.target.closest('.plant') || saving) return;
    drag = {id:event.pointerId,x:event.clientX,y:event.clientY,scroll:viewport.scrollLeft,moved:false};
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    drag.moved ||= Math.hypot(dx,event.clientY - drag.y) > 7;
    if (drag.moved && event.pointerType === 'mouse') viewport.scrollLeft = drag.scroll - dx;
  });
  viewport.addEventListener('pointerup', event => {
    if (drag?.id !== event.pointerId) return;
    const moved = drag.moved;
    drag = null;
    if (moved) return;
    const rect = world.getBoundingClientRect();
    const y = (event.clientY - rect.top) / rect.height;
    if (y < .42) {
      get('garden-message').textContent = 'Choose a spot on the grass.';
      return;
    }
    walk((event.clientX - rect.left) / rect.width, y);
    if (harvest) plant();
  });
  viewport.addEventListener('lostpointercapture',event => { if (drag?.id === event.pointerId) drag = null; });

  for (const [name,color] of Object.entries(colors)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label',name + ' ink');
    button.setAttribute('aria-pressed',String(color === ink));
    button.style.setProperty('--ink',color);
    button.onclick = () => {
      ink = color;
      for (const swatch of get('ink-palette').children) swatch.setAttribute('aria-pressed',String(swatch === button));
    };
    get('ink-palette').append(button);
  }

  function point(e,rect) {
    const weight = e.pointerType === 'pen' && e.pressure > 0 ? 3 + 9 * e.pressure : 7;
    return {x:clamp((e.clientX - rect.left) / rect.width,0,1) * pad.width,
      y:clamp((e.clientY - rect.top) / rect.height,0,1) * pad.height, weight};
  }
  function paint(color, p, previous) {
    pen.fillStyle = pen.strokeStyle = color;
    pen.beginPath();
    if (previous) {
      pen.lineCap = 'round';
      pen.lineWidth = (previous.weight + p.weight) / 2;
      pen.moveTo(previous.x,previous.y); pen.lineTo(p.x,p.y); pen.stroke();
    } else {
      pen.arc(p.x,p.y,p.weight / 2,0,Math.PI * 2); pen.fill();
    }
  }
  function redraw() {
    pen.clearRect(0,0,pad.width,pad.height);
    for (const stroke of strokes) stroke.points.forEach((p,i) => paint(stroke.ink,p,stroke.points[i-1]));
    get('choose-spot').disabled = get('undo-stroke').disabled = !strokes.length;
  }
  pad.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (drawing) {
      if (drawing.kind !== 'touch' || e.pointerType !== 'pen') return;
      strokes.pop(); redraw();
    }
    const first = point(e,pad.getBoundingClientRect());
    drawing = {id:e.pointerId,kind:e.pointerType,ink,points:[first]};
    strokes.push(drawing);
    pad.setPointerCapture(e.pointerId);
    paint(ink,first);
    get('choose-spot').disabled = get('undo-stroke').disabled = false;
  });
  function extend(e) {
    if (drawing?.id !== e.pointerId) return;
    const rect = pad.getBoundingClientRect();
    const samples = e.getCoalescedEvents?.();
    for (const sample of samples?.length ? samples : [e]) {
      const p = point(sample,rect);
      const last = drawing.points.at(-1);
      if (last.x === p.x && last.y === p.y) continue;
      paint(drawing.ink,p,last);
      drawing.points.push(p);
    }
  }
  pad.addEventListener('pointermove', extend);
  pad.addEventListener('pointerup', e => { extend(e); if (drawing?.id === e.pointerId) drawing = null; });
  pad.addEventListener('lostpointercapture',e => { if (drawing?.id === e.pointerId) drawing = null; });
  get('undo-stroke').onclick = () => { drawing = null; strokes.pop(); redraw(); };
  get('garden-draw').onclick = () => {
    harvest = null;
    placementUI();
    redraw();
    get('garden-message').textContent = '';
    draft.showModal();
  };
  get('draw-close').onclick = () => draft.close();
  get('choose-spot').onclick = () => {
    if (!strokes.length) return;
    let left=pad.width, top=pad.height, right=0, bottom=0;
    for (const stroke of strokes) for (const p of stroke.points) {
      left=Math.min(left,p.x-p.weight); right=Math.max(right,p.x+p.weight);
      top=Math.min(top,p.y-p.weight); bottom=Math.max(bottom,p.y+p.weight);
    }
    const image = document.createElement('canvas');
    left = Math.max(0,Math.floor(left)); top = Math.max(0,Math.floor(top));
    image.width = Math.min(pad.width,Math.ceil(right)) - left;
    image.height = Math.min(pad.height,Math.ceil(bottom)) - top;
    image.getContext('2d').drawImage(pad,-left,-top);
    const note = get('doodle-note').value.trim();
    image.toBlob(blob => {
      if (!blob || !draft.open) return;
      harvest = {id:crypto.randomUUID(), image:blob, note};
      draft.close();
      placementUI();
      viewport.focus({preventScroll:true});
    });
  };
  function enter() {
    if (location.hash !== '#garden') return;
    placementUI();
    refresh();
  }
  storageService.subscribe((key, external) => {
    if (key === '*' || (external && key.startsWith('doodle.'))) enter();
  });
  window.addEventListener('hashchange',enter);
  window.addEventListener('focus',enter);
  enter();
})();
