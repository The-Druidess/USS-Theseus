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
const elements = Object.fromEntries(['stage-wrap', 'stage', 'hull-shell', 'hull-canvas', 'hull-title', 'hull-level', 'hull-status'].map(id => [id, element()]));
const tabs = ids.map(id => { const tab = element(); tab.dataset.hull = id; return tab; });
let bakes = 0, draws = 0, observes = 0, buildOpen = false, closes = 0;
const sandbox = {
  module: { exports: {} }, WorldModel,
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
});
A.eq(bakes, 3, 'each shell baked once');
A.eq(elements['hull-canvas'].width, 1600, 'shell canvas respects device pixel ratio');
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
hulls.select('engineering');
A.eq(closes, 1, 'leaving Bridge closes its builder');
hulls.init();
A.eq(observes, 1, 'reinitialization does not duplicate the resize observer');
A.eq(hulls.active, 'bridge', 'reentering the ship returns to Bridge');
A.eq(bakes, 3, 'switches reuse baked shells');
A.ok(draws >= 3, 'shells are rendered');
A.ok(!source.includes('World.loadStation') && !source.includes('persist('), 'hull switching never replaces or saves the live station');
const build = fs.readFileSync(path.join(__dirname, '../frontend/app/build.js'), 'utf8');
A.ok(A.fnBody(build, 'function open(').includes("Hulls.select('bridge')"), 'all Build entry points return to Bridge');
A.report('hulls');
