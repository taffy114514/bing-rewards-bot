// Coordinate calibration: move the REAL cursor to known physical points and read
// back what the page received, so we can solve  clientX = (physX - offsetX) / scale.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  let page = null;
  for (const ctx of browser.contexts()) for (const p of ctx.pages()) if (p.url().includes('rewards.bing.com')) page = p;
  if (!page) { console.log('no rewards page'); await browser.close(); return; }

  await page.bringToFront();
  await page.waitForTimeout(600);

  await page.evaluate(() => {
    window.__mm = [];
    if (!window.__mmBound) {
      document.addEventListener('mousemove', (e) => {
        window.__mm.push([e.clientX, e.clientY, e.screenX, e.screenY]);
      }, true);
      window.__mmBound = true;
    }
  });

  const probe = path.join(__dirname, 'MouseProbe.exe');
  const pts = [[500, 400], [1000, 800], [700, 300]];
  for (const [x, y] of pts) {
    execFileSync(probe, ['move', String(x), String(y)]);
    await page.waitForTimeout(260);
  }

  const geo = await page.evaluate(() => ({
    screenX: window.screenX, screenY: window.screenY,
    outerW: window.outerWidth, outerH: window.outerHeight,
    innerW: window.innerWidth, innerH: window.innerHeight,
    dpr: window.devicePixelRatio
  }));
  const mm = await page.evaluate(() => window.__mm.slice(-6));

  console.log('geo  =', JSON.stringify(geo));
  console.log('moves=', JSON.stringify(mm));

  // Solve linear mapping from physical cursor to client coords using the samples.
  if (mm.length >= 2) {
    const a = mm[mm.length - 2], b = mm[mm.length - 1];
    const map = (p, c, pl, cl) => {
      const scale = (c - cl) / (p - pl);
      const off = c - scale * p;
      return { scale, off };
    };
    console.log('X mapping:', JSON.stringify(map(pts[1][0], a[0], pts[0][0], 0)));
  }
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
