/* node test/theme-custom-phosphor.test.js — the machine assertion the CUSTOM phosphor controls
   (ui/system/set-hue,set-sat,set-glow,set-theme-custom, finding d87c49c9) were missing. The APPEARANCE › CUSTOM
   sliders promise: dragging hue/sat/glow (or picking the CUSTOM swatch) derives + APPLIES + PERSISTS a bespoke
   phosphor palette (theme='custom', store.settings.themeHue/Sat/Glow, deriveCustomTheme).

   deriveCustomTheme + its helpers (hslToRgb/rgbHex/clampN) are a fully self-contained pure block inside the
   StationUI IIFE — so we EVAL-EXTRACT it and exercise the real computation (the chat-linkify house pattern),
   then SOURCE-LOCK the persistence + the theme-bezel-var trap (the derived vars MUST be written on document.body,
   not :root/documentElement — the composite --bezel/--well recipes resolve var(--ph) against body-level inline
   vars, so writing them on the root would silently lose the theme). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const uiSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/stationui.js'), 'utf8');

/* ---- extract the pure derivation cluster and eval it ---- */
function slice(re, label) { const m = re.exec(uiSrc); A.ok(m, 'stationui.js still defines ' + label); return m ? m[0] : ''; }
const hsl = slice(/function hslToRgb\(h, s, l\)\s*\{[\s\S]*?\n  \}/, 'hslToRgb');
const rgbHex = slice(/const rgbHex = [^\n]+/, 'rgbHex');
const clampN = slice(/const clampN = [^\n]+/, 'clampN');
const derive = slice(/function deriveCustomTheme\(hue, sat, glowPct\)\s*\{[\s\S]*?\n  \}/, 'deriveCustomTheme');
// eslint-disable-next-line no-new-func
const deriveCustomTheme = new Function(hsl + '\n' + rgbHex + '\n' + clampN + '\n' + derive + '\nreturn deriveCustomTheme;')();

/* ---- computation: the derived var set is complete, well-formed, and hue-responsive ---- */
const amber = deriveCustomTheme(35, 100, 100);
for (const v of ['--ph', '--ph-bright', '--ph-dim', '--ph-faint', '--ink', '--ph-glow', '--ph-glow2', '--bg', '--panel', '--text', '--gold', '--ph-rgb']) {
  A.ok(Object.prototype.hasOwnProperty.call(amber, v), 'derived palette includes ' + v);
}
A.ok(/^#[0-9a-f]{6}$/.test(amber['--ph']), '--ph is a 6-digit hex colour');
A.ok(/^rgba\(/.test(amber['--ph-glow']), '--ph-glow is an rgba() bloom');
// determinism: same inputs → byte-identical palette
A.eq(JSON.stringify(deriveCustomTheme(35, 100, 100)), JSON.stringify(amber), 'deriveCustomTheme is deterministic (same input → same palette)');
// hue moves the phosphor colour
A.ok(deriveCustomTheme(200, 100, 100)['--ph'] !== amber['--ph'], 'a different hue yields a different --ph');
A.ok(deriveCustomTheme(35, 0, 100)['--ph'] !== amber['--ph'], 'dropping saturation changes --ph');

/* ---- glow dial scales ONLY the two bloom vars, not the palette ---- */
const dim = deriveCustomTheme(35, 100, 0), bright = deriveCustomTheme(35, 100, 150);
A.eq(dim['--ph'], bright['--ph'], 'glow does not touch the base --ph colour');
A.ok(dim['--ph-glow'] !== bright['--ph-glow'], 'glow scales the --ph-glow bloom');
A.ok(/0\.000/.test(deriveCustomTheme(35, 100, 0)['--ph-glow']), 'glow 0% → the bloom alpha is fully scaled down');

/* ---- clamping: out-of-range / malformed inputs fall to the sane defaults (no crash, no NaN colour) ---- */
A.eq(deriveCustomTheme(999, 999, 999)['--ph'], deriveCustomTheme(359, 100, 150)['--ph'], 'out-of-range hue/sat/glow clamp to their ceilings (hue capped at 359, sat 100, glow 150)');
A.notThrows(() => deriveCustomTheme(NaN, undefined, 'x'), 'malformed inputs derive a palette rather than throwing');
A.eq(deriveCustomTheme(NaN, undefined, 'x')['--ph'], deriveCustomTheme(136, 100, 100)['--ph'],
  'malformed inputs use the neon-green default hue');

/* ---- persistence + the theme-bezel-var TRAP (source-lock) ---- */
A.ok(/theme:\s*'green',\s*themeHue:\s*136,\s*themeSat:\s*100,\s*themeGlow:\s*100/.test(uiSrc), 'defaults() seeds green phosphor and matching custom sliders');
A.ok(/crtGlass:\s*'full',\s*staticLevel:\s*0/.test(uiSrc), 'new stations default to a clear, static-free feed');
A.ok(/function save\(\)[\s\S]{0,120}localStorage\.setItem\(KEY/.test(uiSrc), 'settings persist to localStorage (survive reload)');
// applySettings re-derives on load and writes the vars on document.body (NOT :root) — the bezel trap
A.ok(/s\.theme === 'custom'[\s\S]{0,200}deriveCustomTheme\(s\.themeHue, s\.themeSat, s\.themeGlow\)/.test(uiSrc), 'applySettings re-derives the custom palette from the persisted hue/sat/glow');
A.ok(/for \(const k in vars\) document\.body\.style\.setProperty\(k, vars\[k\]\)/.test(uiSrc), 'derived vars are written on document.body (the bezel-var trap — NOT :root/documentElement)');
A.ok(!/documentElement\.style\.setProperty\('--ph'/.test(uiSrc), 'the phosphor vars are NEVER set on documentElement (would break the body-level bezel recipes)');
A.ok(/document\.body\.classList\.add\('theme-custom'\)/.test(uiSrc), 'custom mode stamps the theme-custom body class');

/* ---- the controls exist and are wired ---- */
A.ok(/id="set-hue"/.test(uiSrc) && /id="set-sat"/.test(uiSrc) && /id="set-glow"/.test(uiSrc), 'the HUE/SATURATION/GLOW sliders render');
A.ok(/deriveCustomTheme\(s\.themeHue, s\.themeSat, 100\)\['--ph'\]/.test(uiSrc), 'the CUSTOM swatch tints itself from the live derivation (set-theme-custom)');
A.ok(/function setTheme\(/.test(uiSrc), 'StationUI exposes setTheme (the preset/custom swatch entry point)');

/* ---- shared green defaults without removing intentional palette choices ---- */
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const css = read('frontend/css/style.css');
const rootPalette = /:root\s*\{([\s\S]*?)\}/.exec(css)[1];
A.ok(/--ph:\s*#3dff70/.test(rootPalette) && /--ph-rgb:\s*61,\s*255,\s*112/.test(rootPalette),
  'first paint uses the green phosphor and its matching RGB token');
A.ok(!/body\.theme-amber\s*\{/.test(css), 'the retired amber phosphor preset no longer overrides neon green');
A.ok(/const THEMES = \[\['green', '#3dff70'\]/.test(uiSrc) && !/const THEMES = \[[^\n]*\['amber'/.test(uiSrc),
  'the appearance picker no longer offers the orange preset');
A.ok(/if \(r\.settings\.theme === 'amber'\) \{\s*r\.settings\.theme = 'green';\s*r\.settings\.themeHue = 136;\s*r\.settings\.themeSat = 100;/.test(uiSrc),
  'saved amber preference migrates to the neon-green palette');
A.ok(/const PHOSPHOR = Object\.freeze\(\[\['green', '#3dff70'\]/.test(read('frontend/app/app.js')),
  'new station creation offers neon green without the retired amber phosphor');
const loadSettings = new Function('KEY', 'localStorage', 'defaults', 'notifyDefaults',
  A.fnBody(uiSrc, 'function load()') + '\nreturn load;')(
  'settings',
  { getItem: () => JSON.stringify({ v: 1, settings: { theme: 'amber', themeHue: 35, themeSat: 100 } }) },
  () => ({ theme: 'green', themeHue: 136, themeSat: 100, staticLevel: 0, notifyPrefs: {} }),
  () => ({})
);
A.eq([loadSettings().settings.theme, loadSettings().settings.themeHue, loadSettings().settings.themeSat], ['green', 136, 100],
  'loading an older amber save actually applies the green preference and hue');
let storedSettings = JSON.stringify({ v: 1, settings: { staticLevel: 100 } });
const staticStorage = { getItem: () => storedSettings, setItem: (_key, value) => { storedSettings = value; } };
const loadStaticSettings = new Function('KEY', 'localStorage', 'defaults', 'notifyDefaults',
  A.fnBody(uiSrc, 'function load()') + '\nreturn load;')(
  'settings', staticStorage, () => ({ staticLevel: 0, notifyPrefs: {} }), () => ({})
);
A.eq(loadStaticSettings().settings.staticLevel, 0, 'an existing installation migrates to the requested static-free setting');
A.eq(JSON.parse(storedSettings).staticLevelRevision, 1, 'the migration is written to storage once');
const savedChoice = JSON.parse(storedSettings);
savedChoice.settings.staticLevel = 35;
storedSettings = JSON.stringify(savedChoice);
A.eq(loadStaticSettings().settings.staticLevel, 35, 'a later slider choice survives the next boot');
for (const file of ['frontend/index.html', 'frontend/agent-station-demo.html']) {
  A.ok(/<body class="theme-green glass-demo">/.test(read(file)), file + ' starts green before settings load');
}
A.ok(/--ph:\s*#3dff70/.test(read('frontend/plugin-kit/kit.css')), 'plugin windows default to green before host theme synchronization');
for (const file of ['frontend/css/workflow-panel.css', 'frontend/css/workflows-window.css']) {
  A.ok(!/#ffb23e|255,\s*178,\s*62/.test(read(file)), file + ' uses themed live accents instead of baked-in orange');
}
const site = read('website/styles.css');
A.ok(/--amber:#3dff70;/.test(site) && /--brand-rgb:61,255,112;/.test(site), 'public website aliases use the same terminal green');
A.ok(/--amber:#3dff70;/.test(read('website/docs/docs.css')), 'documentation does not override the brand with orange');
for (const file of ['website/styles.css', 'website/home.css', 'website/market.css', 'website/docs/guides/guides.css']) {
  A.ok(!/rgba\(255,\s*(?:157,\s*47|140,\s*30|120,\s*20|90,\s*10)/.test(read(file)),
    file + ' routes decorative orange glows through green brand tokens');
}
A.ok(/'61,255,112'/.test(read('website/home.js')) && !/'255,157,47'/.test(read('website/home.js')),
  'homepage canvas particles match the green CSS brand');
A.ok(/--bad:\s*#ff5c4d/.test(rootPalette), 'danger remains semantic red, not phosphor green');
A.ok(/#d2452f/.test(read('website/docs/guides/guides.css')), 'public guide safety warnings keep their distinct danger color');

A.report('theme-custom-phosphor');
