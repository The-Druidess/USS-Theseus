'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const A = require('./_assert');
const WorldModel = require('../frontend/app/worldmodel');
const source = fs.readFileSync(path.join(__dirname, '../frontend/app/hulls.js'), 'utf8');
const ids = ['bridge', 'promenade', 'engineering', 'jefferies'];
const context = {
  clearRect() {}, save() {}, restore() {}, translate() {}, scale() {}
};
const element = () => ({
  dataset: {}, attributes: {}, handlers: {}, hidden: false,
  setAttribute(key, value) { this.attributes[key] = value; },
  addEventListener(key, fn) { this.handlers[key] = fn; },
  focus() { this.focused = true; },
  getBoundingClientRect() { return { width: 800, height: 600 }; },
  getContext() { return context; }
});
const elements = Object.fromEntries(['stage-wrap', 'stage', 'hull-shell', 'hull-canvas', 'hull-title', 'hull-level', 'hull-status', 'hull-shell-copy'].map(id => [id, element()]));
const tabs = ids.map(id => { const tab = element(); tab.dataset.hull = id; return tab; });
let bakes = 0, draws = 0, observes = 0, buildOpen = false, closes = 0, station = null, framed = [];
const sandbox = {
  module: { exports: {} }, WorldModel,
  App: { station: () => station },
  World: { frameHull(bounds) { framed.push(bounds); } },
  window: { devicePixelRatio: 2 },
  document: { getElementById: id => elements[id], querySelectorAll: () => tabs },
  ResizeObserver: class { observe() { observes++; } },
  SpaceBG: { draw() {} },
  StationBake: {
    WALL: {},
    bake(geo) { bakes++; return { W: geo.W, H: geo.H }; },
    drawBase() { draws++; }, drawLight() {}
  },
  Build: { isOpen: () => buildOpen, close() { closes++; buildOpen = false; } }
};
vm.runInNewContext(source, sandbox);
const hulls = sandbox.module.exports;
for (const id of ids.slice(1)) {
  const doc = hulls.shellDoc(id), model = WorldModel.deserialize(doc), geo = model.projectGeometry();
  A.eq(doc.props, [], id + ' starts without furniture or crew assignments');
  A.eq(doc.belts, {}, id + ' starts without workflows');
  A.eq(model.rooms().length, 1, id + ' has one blank hull');
  let count = 0;
  for (let y = 0; y < geo.ROWS; y++) for (let x = 0; x < geo.COLS; x++) if (geo.walkable(x, y)) count++;
  A.eq(count, id === 'jefferies' ? 328 : 876, id + ' has the intended floor area after corner chamfers');
  A.eq(JSON.stringify(hulls.shellDoc(id)), JSON.stringify(doc), id + ' shell is deterministic');
}
A.throws(() => hulls.shellDoc('bridge'), 'Bridge never gets replaced by a blank shell');
A.throws(() => hulls.select('unknown'), 'unknown hull is rejected explicitly');
hulls.init();
A.eq(hulls.active, 'bridge', 'Bridge is initially selected');
A.ok(elements['hull-shell'].hidden, 'shell hidden on Bridge');
A.eq(elements.stage.attributes['aria-hidden'], 'false', 'live stage accessible on Bridge');
ids.forEach((id, index) => {
  tabs[index].handlers.click();
  A.eq(hulls.active, id, id + ' is clickable');
  A.eq(tabs.map(tab => tab.attributes['aria-selected']), ids.map(candidate => String(candidate === id)), 'exactly one selected tab');
  A.eq(tabs.map(tab => tab.tabIndex), ids.map(candidate => candidate === id ? 0 : -1), 'tab focus follows selection');
  A.eq(elements['hull-shell'].hidden, id === 'bridge', 'only blank hulls show the shell panel');
  A.eq(elements.stage.attributes['aria-hidden'], String(id !== 'bridge'), 'hidden Bridge is inaccessible');
  A.eq(elements['stage-wrap'].dataset.hullLive, String(id === 'bridge'), id + ' live stage visibility follows its configuration');
});
A.eq(bakes, 3, 'each blank shell baked once');
A.eq(elements['hull-canvas'].width, 1600, 'shell canvas respects device pixel ratio');
const factory = WorldModel.defaultDoc(2);
factory.rooms = {
  etsy: { id: 'etsy', name: 'ETSY', kind: 'factory', rects: [{ x1: 0, y1: 0, x2: 9, y2: 7 }] },
  fiverr: { id: 'fiverr', name: 'FIVERR', kind: 'factory', rects: [{ x1: 10, y1: 0, x2: 19, y2: 7 }] },
  review: { id: 'review', name: 'REVIEW', kind: 'factory', rects: [{ x1: 0, y1: 8, x2: 9, y2: 15 }] },
  bridge: { id: 'bridge', name: 'THE BRIDGE', kind: 'bridge', rects: [{ x1: 30, y1: 0, x2: 39, y2: 9 }] }
};
factory.order = ['etsy', 'fiverr', 'review', 'bridge'];
factory.props = [
  { id: 'p-etsy', t: 'console', x: 1, y: 1, w: 2, h: 1, block: true },
  { id: 'p-bridge', t: 'console', x: 31, y: 1, w: 2, h: 1, block: true }
];
factory.belts = { '4,2': 'E', '34,2': 'W' };
factory.meta.spawnRoomId = 'bridge';
factory.meta.trunkRoomId = 'bridge';
factory.meta.hulls = {
  bridge: { x1: 28, y1: -2, x2: 42, y2: 12, roomIds: ['bridge'] },
  promenade: { x1: -2, y1: -2, x2: 22, y2: 17, roomIds: ['etsy', 'fiverr', 'review'] }
};
station = WorldModel.deserialize(factory);
const promenade = hulls.layoutDoc('promenade', station);
A.eq(promenade.order, ['etsy', 'fiverr', 'review'], 'Promenade layout contains all three factory rooms');
A.eq(promenade.props.map(prop => prop.id), ['p-etsy'], 'Promenade layout keeps its room equipment only');
A.eq(Object.keys(promenade.belts), ['4,2'], 'Promenade layout keeps its conveyor tiles only');
A.eq(hulls.layoutDoc('bridge', station).order, ['bridge'], 'Bridge layout excludes the Promenade factory rooms');
const expanded = JSON.parse(JSON.stringify(factory));
expanded.rooms.extra = { id: 'extra', name: 'PROMENADE ADDITION', kind: 'hab', rects: [{ x1: 10, y1: 16, x2: 12, y2: 17 }] };
expanded.order.push('extra');
expanded.props.push({ id: 'extra-prop', t: 'console', x: 11, y: 16, w: 1, h: 1, block: true });
expanded.belts['10,16'] = 'E';
const expandedLayout = hulls.layoutDoc('promenade', WorldModel.deserialize(expanded));
A.eq(expandedLayout.order, ['etsy', 'fiverr', 'review', 'extra'], 'rooms built within hull bounds join that hull view');
A.eq(expandedLayout.props.map(prop => prop.id), ['p-etsy', 'extra-prop'], 'props in new hull rooms join the hull view');
A.ok(expandedLayout.belts['10,16'], 'belts in new hull rooms join the hull view');
hulls.select('promenade');
A.ok(elements['hull-status'].textContent.includes('factory floor'), 'Promenade status identifies the factory floor');
A.ok(elements['hull-shell-copy'].hidden, 'Promenade map hides its bottom caption');
A.ok(elements['hull-shell'].hidden, 'configured Promenade uses the live station view');
A.eq(elements.stage.attributes['aria-hidden'], 'false', 'configured Promenade keeps the live station view accessible');
A.eq(elements['stage-wrap'].dataset.hullLive, 'true', 'configured Promenade stage is visible');
A.eq(hulls.activeBounds(), { x1: -2, y1: -2, x2: 22, y2: 17 }, 'active hull bounds come from the selected deck');
A.eq(framed[framed.length - 1], { x1: -2, y1: -2, x2: 22, y2: 17 }, 'live station camera frames the Promenade bounds');
hulls.select('bridge');
A.eq(hulls.activeBounds(), { x1: 28, y1: -2, x2: 42, y2: 12 }, 'Bridge clipping bounds exclude the factory rooms');
A.eq(bakes, 3, 'configured Promenade does not bake an empty preview');
let prevented = false;
tabs[3].handlers.keydown({ key: 'ArrowRight', preventDefault() { prevented = true; } });
A.ok(prevented && tabs[0].focused, 'arrow navigation wraps and focuses Bridge');
A.eq(hulls.active, 'bridge', 'right arrow wraps to Bridge');
tabs[0].handlers.keydown({ key: 'End', preventDefault() {} });
A.eq(hulls.active, 'jefferies', 'End selects Jefferies');
tabs[3].handlers.keydown({ key: 'Home', preventDefault() {} });
A.eq(hulls.active, 'bridge', 'Home selects Bridge');
tabs[0].handlers.keydown({ key: 'ArrowLeft', preventDefault() {} });
A.eq(hulls.active, 'jefferies', 'left arrow wraps to Jefferies');
buildOpen = true;
hulls.select('engineering', true);
A.eq(closes, 0, 'Build mode can change hull without closing');
buildOpen = true;
hulls.select('promenade');
A.eq(closes, 1, 'external hull changes still close the builder');
hulls.init();
A.eq(observes, 1, 'reinitialization does not duplicate the resize observer');
A.eq(hulls.active, 'bridge', 'reentering the ship returns to Bridge');
A.eq(bakes, 3, 'switches reuse cached blank hull layouts');
A.ok(draws >= 3, 'shells are rendered');
A.ok(!source.includes('World.loadStation') && !source.includes('persist('), 'hull switching never replaces or saves the live station');
const build = fs.readFileSync(path.join(__dirname, '../frontend/app/build.js'), 'utf8');
A.ok(!A.fnBody(build, 'function open(').includes("Hulls.select('bridge')"), 'Build mode preserves the selected hull');
A.report('hulls');
