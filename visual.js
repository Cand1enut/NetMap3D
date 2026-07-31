// Visual regression harness — the tier the headless fuzzer cannot cover.
//
// fuzz.js runs against the model and so catches nothing about how the scene
// LOOKS. This drives a real browser with real WebGL, renders named views, and
// measures the frame: exposure, contrast, whether anything drew at all. Those
// are the checks that turn "everything looks super dark" into a number instead
// of an impression.
//
// Usage:
//   node visual.js                 measure every view, print a table
//   node visual.js --save <dir>    also write each view as a PNG
'use strict';

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.NETMAP_URL || 'http://127.0.0.1:4173/dev.html';
const W = 1280, H = 800;

// Each view names a camera placement over the reference site. Keep these stable
// — a view's numbers are only meaningful compared against the same view.
const VIEWS = [
  { name: 'hall-overview',  cam: [-150, 190, 300], target: [60, 40, 40] },
  { name: 'hall-aisle',     cam: [40, 60, 150],    target: [40, 45, -60] },
  { name: 'rack-closeup',   cam: [-95, 55, 40],    target: [-135, 45, 30] },
  { name: 'runway-under',   cam: [0, 100, 120],    target: [0, 84, -40] },
  { name: 'mdf-room',       cam: [-260, 90, -260], target: [-320, 45, -330] },
];

// What a frame has to satisfy. These are deliberately wide: they catch a scene
// that is black, blown out, or flat, not small art-direction changes.
const BOUNDS = {
  meanLuma:      [45, 190],   // neither a dark room nor a white-out
  p05:           [4, 120],    // real shadow, but not crushed to black
  p95:           [110, 255],  // real highlight
  contrast:      [45, 255],   // p95 - p05: a flat frame reads as fog
  shareBlack:    [0, 0.35],   // fraction below luma 16
  shareClipped:  [0, 0.15],   // fraction above luma 250
  // A data hall genuinely reads near-grey -- concrete, steel, black bezels -- so
  // this only catches a frame with no chroma at all. A blank render is caught by
  // the contrast bound, not this one.
  distinctHues:  [1, 999],
};

function stats(px) {
  const hist = new Uint32Array(256);
  const hues = new Set();
  let sum = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const L = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    hist[L]++; sum += L; n++;
    // a coarse hue bucket, only to prove the frame is not monochrome
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn > 24) hues.add(Math.round(((mx === r ? (g - b) / (mx - mn)
      : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn)) + 6) % 6));
  }
  const pct = (k) => { let c = 0; const t = n * k;
    for (let L = 0; L < 256; L++) { c += hist[L]; if (c >= t) return L; } return 255; };
  let black = 0, clipped = 0;
  for (let L = 0; L < 16; L++) black += hist[L];
  for (let L = 250; L < 256; L++) clipped += hist[L];
  const p05 = pct(0.05), p95 = pct(0.95);
  return { meanLuma: +(sum / n).toFixed(1), p05, p50: pct(0.5), p95,
    contrast: p95 - p05, shareBlack: +(black / n).toFixed(3),
    shareClipped: +(clipped / n).toFixed(3), distinctHues: hues.size };
}

(async () => {
  const saveIdx = process.argv.indexOf('--save');
  const saveDir = saveIdx > -1 ? process.argv[saveIdx + 1] : null;
  if (saveDir) fs.mkdirSync(saveDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 180000,
    args: ['--no-sandbox', '--enable-gpu', '--use-gl=angle',
           '--use-angle=metal', '--hide-scrollbars', `--window-size=${W},${H}`],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('typeof referenceSite === "function"', { timeout: 30000 });

  await page.evaluate(() => {
    const l = document.getElementById('launcher'); if (l) l.style.display = 'none';
    clearScene(); referenceSite();
    window.dispatchEvent(new Event('resize'));
  });

  const rows = [];
  for (const v of VIEWS) {
    await page.evaluate((v) => {
      camera.position.set(...v.cam);
      controls.target.set(...v.target);
      controls.update();
      if (typeof markShadowsDirty === 'function') markShadowsDirty();
    }, v);
    await new Promise(r => setTimeout(r, 350));       // let shadows/GTAO settle
    const buf = await page.screenshot({ type: 'png' });
    if (saveDir) fs.writeFileSync(path.join(saveDir, v.name + '.png'), Buffer.from(buf));
    // decode via the page itself — no image library needed on the Node side
    const px = await page.evaluate(async (b64) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64; });
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      return Array.from(g.getImageData(0, 0, c.width, c.height).data);
    }, Buffer.from(buf).toString('base64'));
    rows.push({ view: v.name, ...stats(px) });
  }
  await browser.close();

  const fails = [];
  console.log('\nview             mean   p05   p50   p95  contr  black  clip  hues');
  for (const r of rows) {
    console.log(`${r.view.padEnd(16)}${String(r.meanLuma).padStart(5)}` +
      `${String(r.p05).padStart(6)}${String(r.p50).padStart(6)}${String(r.p95).padStart(6)}` +
      `${String(r.contrast).padStart(7)}${String(r.shareBlack).padStart(7)}` +
      `${String(r.shareClipped).padStart(6)}${String(r.distinctHues).padStart(6)}`);
    for (const [k, [lo, hi]] of Object.entries(BOUNDS)) {
      if (r[k] < lo || r[k] > hi) fails.push(`${r.view}: ${k}=${r[k]} outside [${lo}, ${hi}]`);
    }
  }
  if (errors.length) { console.log('\npage errors:'); for (const e of errors.slice(0, 8)) console.log('  ' + e); }
  if (fails.length) { console.log('\nFAILURES:'); for (const f of fails) console.log('  ' + f); process.exit(1); }
  console.log('\nall views within bounds');
})().catch(e => { console.error('visual harness failed:', e && (e.stack || e.message || e)); process.exit(2); });
