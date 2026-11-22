/* USS Theseus hull navigation. Non-Bridge hulls render their saved room layouts when defined. */
'use strict';

const Hulls = (() => {
  const tiers = [
    { id: 'bridge', name: 'Bridge', level: 'Upper hull' },
    { id: 'promenade', name: 'Promenade', level: 'Mid hull', floor: 'rust' },
    { id: 'engineering', name: 'Engineering', level: 'Lower hull', floor: 'rust' },
    { id: 'jefferies', name: 'Jefferies', level: 'Service hull', floor: 'corridor' }
  ];
  let active = 'bridge', bound = false, canvas, context, panel, tabs, observer;
  const shells = new Map();

  function layoutDoc(id, station) {
    if (!station || typeof station.serialize !== 'function' || typeof station.roomAt !== 'function') return null;
    const source = station.serialize();
    const hull = source.meta && source.meta.hulls && source.meta.hulls[id];
    if (!hull || !Array.isArray(hull.roomIds) || !hull.roomIds.length) return null;

    const roomIds = new Set(hull.roomIds);
    if (roomIds.size !== hull.roomIds.length) throw new Error('Duplicate room in the ' + id + ' hull layout');
    for (const roomId of roomIds) {
      if (!source.rooms[roomId]) throw new Error('Missing room ' + roomId + ' in the ' + id + ' hull layout');
    }

    const hasBounds = [hull.x1, hull.y1, hull.x2, hull.y2].every(Number.isFinite);
    const belongsToHull = room => hasBounds && room && Array.isArray(room.rects) && room.rects.length > 0 &&
      room.rects.every(rect => rect.x1 >= hull.x1 && rect.y1 >= hull.y1 && rect.x2 <= hull.x2 && rect.y2 <= hull.y2);
    const included = new Set(source.order.filter(roomId =>
      roomIds.has(roomId) || belongsToHull(source.rooms[roomId])));
    if (Array.from(roomIds).some(roomId => !included.has(roomId))) {
      throw new Error('Incomplete room list in the ' + id + ' hull layout');
    }

    const doc = JSON.parse(JSON.stringify(source));
    doc.order = source.order.filter(roomId => included.has(roomId));
    if (new Set(doc.order).size !== doc.order.length) {
      throw new Error('Incomplete room list in the ' + id + ' hull layout');
    }
    doc.rooms = {};
    for (const roomId of doc.order) doc.rooms[roomId] = source.rooms[roomId];
    doc.props = source.props.filter(prop => included.has(station.roomAt(prop.x, prop.y)));
    doc.belts = Object.fromEntries(Object.entries(source.belts || {}).filter(([key]) => {
      const [x, y] = key.split(',').map(Number);
      return included.has(station.roomAt(x, y));
    }));
    doc.edges = [];
    const home = doc.order.find(roomId => doc.rooms[roomId].kind !== 'corridor') || doc.order[0];
    doc.meta.spawnRoomId = home;
    doc.meta.trunkRoomId = home;
    return doc;
  }

  function savedLayout(id) {
    return typeof App !== 'undefined' && typeof App.station === 'function'
      ? layoutDoc(id, App.station())
      : null;
  }

  function activeBounds() {
    if (typeof App === 'undefined' || typeof App.station !== 'function') return null;
    const station = App.station();
    if (!station) return null;
    const source = typeof station.doc === 'function' ? station.doc() : station.serialize();
    const hull = source.meta && source.meta.hulls && source.meta.hulls[active];
    if (!hull || ![hull.x1, hull.y1, hull.x2, hull.y2].every(Number.isFinite)) return null;
    return { x1: hull.x1, y1: hull.y1, x2: hull.x2, y2: hull.y2 };
  }

  function transportRoute(station, geo, from, to, blockers) {
    const doc = station.doc();
    const layouts = (doc.meta && doc.meta.hulls) || {};
    const hullAt = point => {
      const x = point.x + geo.origin.tx, y = point.y + geo.origin.ty;
      return Object.keys(layouts).find(id => {
        const h = layouts[id];
        return h && x >= h.x1 && x <= h.x2 && y >= h.y1 && y <= h.y2;
      });
    };
    const source = hullAt(from), destination = hullAt(to);
    if (!source || !destination || source === destination) return null;
    const pads = geo.props.filter(p => p.t === 'transporter_pad');
    const center = p => ({ x: p.x + Math.floor((p.w || 1) / 2), y: p.y + Math.floor((p.h || 1) / 2) });
    const origins = pads.filter(p => hullAt(center(p)) === source);
    const arrivals = pads.filter(p => hullAt(center(p)) === destination);
    for (const a of origins) for (const b of arrivals) {
      const start = center(a), end = center(b);
      const first = geo.path(from.x, from.y, start.x, start.y, blockers);
      if (!first) continue;
      const last = geo.path(end.x, end.y, to.x, to.y, blockers);
      if (!last || !geo.walkable(end.x, end.y, blockers)) continue;
      return [...(first.length ? first : [start]), { x: end.x, y: end.y, transportFrom: a.id, transportTo: b.id }, ...last];
    }
    return null;
  }

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
    if (id === 'jefferies') {
      doc.props.push({ id: 'preview-transporter', t: 'transporter_pad', x: 18, y: 9, w: 3, h: 3, block: false });
    }
    return doc;
  }

  function draw() {
    if (active === 'bridge' || savedLayout(active) || !canvas) return;
    const box = panel.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(box.width * ratio);
    canvas.height = Math.round(box.height * ratio);
    const doc = savedLayout(active) || shellDoc(active);
    const signature = JSON.stringify(doc);
    let cached = shells.get(active);
    if (!cached || cached.signature !== signature) {
      const model = WorldModel.create(doc);
      const geo = model.projectGeometry(StationBake.WALL);
      cached = { signature, geo, baked: StationBake.bake(geo) };
      shells.set(active, cached);
    }
    const baked = cached.baked;
    context.clearRect(0, 0, canvas.width, canvas.height);
    SpaceBG.draw(context, canvas.width, canvas.height, 0, { scale: 1, panX: 0, panY: 0 });
    const scale = Math.min(canvas.width * .86 / baked.W, canvas.height * .64 / baked.H);
    context.save();
    context.imageSmoothingEnabled = false;
    context.translate((canvas.width - baked.W * scale) / 2, (canvas.height - baked.H * scale) / 2);
    context.scale(scale, scale);
    StationBake.drawBase(context, baked, 0, 0);
    if (cached.geo.props.length && typeof PropSprites !== 'undefined') {
      const previousContext = PropSprites.getCtx();
      try {
        PropSprites.setCtx(context);
        PropSprites.setNow(0);
        for (const prop of cached.geo.props) PropSprites.draw(prop, false);
      } finally {
        PropSprites.setCtx(previousContext);
      }
    }
    StationBake.drawLight(context, baked, 0, 0);
    context.restore();
  }

  function select(id, fromBuild) {
    const tier = tiers.find(t => t.id === id);
    if (!tier) throw new Error('Unknown Theseus hull: ' + id);
    if (!bound) return;
    if (!fromBuild && id !== 'bridge' && typeof Build !== 'undefined' && Build.isOpen()) Build.close();
    const hasLayout = id !== 'bridge' && !!savedLayout(id);
    const liveHull = id === 'bridge' || hasLayout;
    active = id;
    const stageWrap = document.getElementById('stage-wrap');
    stageWrap.dataset.hull = id;
    stageWrap.dataset.hullLive = String(liveHull);
    const bridge = document.getElementById('stage');
    bridge.setAttribute('aria-hidden', String(!liveHull));
    panel.hidden = liveHull;
    panel.setAttribute('aria-labelledby', 'hull-tab-' + id);
    tabs.forEach(tab => {
      const selected = tab.dataset.hull === id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    document.getElementById('hull-title').textContent = tier.name;
    document.getElementById('hull-level').textContent = tier.level;
    document.getElementById('hull-status').textContent = tier.level + ' / ' + tier.name +
      (id === 'bridge' ? ' / live crew' : hasLayout
        ? (id === 'promenade' ? ' / factory floor' : ' / saved room layout')
        : ' / blank shell; layout to be defined');
    document.getElementById('hull-shell-copy').hidden = id === 'promenade' || hasLayout;
    if (liveHull && typeof World !== 'undefined' && typeof World.frameHull === 'function') {
      World.frameHull(activeBounds());
    }
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

  return { init, select, redraw: draw, shellDoc, layoutDoc, activeBounds, transportRoute, get active() { return active; } };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Hulls;
