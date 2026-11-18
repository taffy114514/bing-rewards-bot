// Verify a REAL OS-level click lands on the intended page element.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  let page = null;
  for (const ctx of browser.contexts()) for (const p of ctx.pages()) if (p.url().includes('rewards.bing.com')) page = p;
  if (!page) { console.log('no page'); await browser.close(); return; }

  await page.bringToFront();
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    window.__clicks = [];
    if (!window.__clickBound) {
      document.addEventListener('click', (e) => {
        const t = e.target;
        window.__clicks.push({
          x: e.clientX, y: e.clientY,
          tag: t && t.tagName, txt: (t && (t.innerText || t.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 50)
        });
      }, true);
      window.__clickBound = true;
    }
  });

  const probe = path.join(__dirname, 'MouseProbe.exe');

  // Derive the physical->client mapping from two real cursor moves.
  execFileSync(probe, ['move', '600', '500']); await page.waitForTimeout(200);
  const m1 = await page.evaluate(() => { const a = window.__mm || []; return a.length ? a[a.length - 1] : null; });
  execFileSync(probe, ['move', '900', '700']); await page.waitForTimeout(200);
  const m2 = await page.evaluate(() => { const a = window.__mm || []; return a.length ? a[a.length - 1] : null; });
  if (!m1 || !m2) { console.log('mousemove not captured'); await browser.close(); return; }
  const sx = (900 - 600) / (m2[0] - m1[0]);
  const ox = 600 - sx * m1[0];
  const sy = (700 - 500) / (m2[1] - m1[1]);
  const oy = 500 - sy * m1[1];
  const toPhys = (cx, cy) => [Math.round(ox + sx * cx), Math.round(oy + sy * cy)];
  console.log(`mapping: physX = ${ox.toFixed(2)} + ${sx.toFixed(3)} * clientX ; physY = ${oy.toFixed(2)} + ${sy.toFixed(3)} * clientY`);

  // Pick the "每日连续打卡活动" card (still 1/3) and click its centre through the real cursor.
  const target = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, [role="button"]')];
    const el = btns.find(b => (b.innerText || '').includes('每日连续打卡活动'));
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, txt: el.innerText.split('\n')[0] };
  });
  if (!target) { console.log('card not found'); await browser.close(); return; }

  const [px, py] = toPhys(target.cx, target.cy);
  console.log(`target "${target.txt}" client(${Math.round(target.cx)},${Math.round(target.cy)}) -> phys(${px},${py})`);
  execFileSync(probe, ['click', String(px), String(py)]);
  await page.waitForTimeout(1800);

  const clicks = await page.evaluate(() => window.__clicks);
  console.log('clicks received:', JSON.stringify(clicks));
  console.log('url after:', page.url());
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
