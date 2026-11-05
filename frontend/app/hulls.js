/* USS Theseus hull navigation. New hulls are render-only shells until their layouts are defined. */
'use strict';

const Hulls = (() => {
  const tiers = [
    { id: 'bridge', name: 'Bridge', level: 'Upper hull' },
    { id: 'promenade', name: 'Promenade', level: 'Mid hull', floor: 'cobalt' },
    { id: 'engineering', name: 'Engineering', level: 'Lower hull', floor: 'rust' },
    { id: 'jefferies', name: 'Jefferies', level: 'Service hull', floor: 'corridor' }
  ];
  let active = 'bridge', bound = false, canvas, context, panel, tabs, observer;
  const shells = new Map();

  function shellDoc(id) {
    const tier = tiers.find(t => t.id === id);
    if (!tier || id === 'bridge') throw new Error('No blank hull shell for ' + id);
    const doc = WorldModel.defaultDoc(1);
    doc.meta.name = 'USS THESEUS / ' + tier.name.toUpperCase();
    const room = doc.rooms[doc.meta.spawnRoomId];
    room.name = tier.name.toUpperCase();
    room.floorStyle = tier.floor;
    room.rects = id === 'jefferies'
      ? [{ x1: 0, y1: 8, x2: 39, y2: 13 }, { x1: 17, y1: 0, x2: 22, y2: 21 }]
      : [{ x1: 0, y1: 0, x2: 39, y2: 21 }];
    return doc;
  }

  function draw() {
    if (active === 'bridge' || !canvas) return;
    const box = panel.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(box.width * ratio);
    canvas.height = Math.round(box.height * ratio);
    let baked = shells.get(active);
    if (!baked) {
      const model = WorldModel.create(shellDoc(active));
      baked = StationBake.bake(model.projectGeometry(StationBake.WALL));
      shells.set(active, baked);
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    SpaceBG.draw(context, canvas.width, canvas.height, 0, { scale: 1, panX: 0, panY: 0 });
    const scale = Math.min(canvas.width * .86 / baked.W, canvas.height * .64 / baked.H);
    context.save();
    context.imageSmoothingEnabled = false;
    context.translate((canvas.width - baked.W * scale) / 2, (canvas.height - baked.H * scale) / 2);
    context.scale(scale, scale);
    StationBake.drawBase(context, baked, 0, 0);
    StationBake.drawLight(context, baked, 0, 0);
    context.restore();
  }

  function select(id) {
    const tier = tiers.find(t => t.id === id);
    if (!tier) throw new Error('Unknown Theseus hull: ' + id);
    if (!bound) return;
    if (id !== 'bridge' && typeof Build !== 'undefined' && Build.isOpen()) Build.close();
    active = id;
    document.getElementById('stage-wrap').dataset.hull = id;
    const bridge = document.getElementById('stage');
    bridge.setAttribute('aria-hidden', String(id !== 'bridge'));
    panel.hidden = id === 'bridge';
    panel.setAttribute('aria-labelledby', 'hull-tab-' + id);
    tabs.forEach(tab => {
      const selected = tab.dataset.hull === id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    document.getElementById('hull-title').textContent = tier.name;
    document.getElementById('hull-level').textContent = tier.level;
    document.getElementById('hull-status').textContent = tier.level + ' / ' + tier.name +
      (id === 'bridge' ? ' / live crew' : ' / blank shell; layout to be defined');
    draw();
  }

  function init() {
    if (!bound) {
      panel = document.getElementById('hull-shell');
      canvas = document.getElementById('hull-canvas');
      context = canvas.getContext('2d');
      tabs = Array.from(document.querySelectorAll('#hull-tabs [role="tab"]'));
      tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => select(tab.dataset.hull));
        tab.addEventListener('keydown', event => {
          let next;
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + tabs.length - 1) % tabs.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = tabs.length - 1;
          else return;
          event.preventDefault();
          select(tabs[next].dataset.hull);
          tabs[next].focus();
        });
      });
      observer = new ResizeObserver(draw);
      observer.observe(panel);
      bound = true;
      if (document.fonts) document.fonts.ready.then(() => { shells.clear(); draw(); });
      if (typeof IndustrialTextures !== 'undefined') IndustrialTextures.ready.then(() => { shells.clear(); draw(); });
    }
    select('bridge');
  }

  return { init, select, shellDoc, get active() { return active; } };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Hulls;
