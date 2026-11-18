// Probe: connect to the real Edge instance over CDP and dump the earn/streaks page.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctxs = browser.contexts();
  console.log('contexts:', ctxs.length);
  for (const ctx of ctxs) {
    for (const page of ctx.pages()) {
      console.log('PAGE:', page.url(), '|', await page.title());
    }
  }

  let page = null;
  for (const ctx of ctxs) for (const p of ctx.pages()) if (p.url().includes('rewards.bing.com')) page = p;
  if (!page) { console.log('no rewards page'); await browser.close(); return; }

  console.log('\n--- window geometry ---');
  console.log(await page.evaluate(() => ({
    screenX: window.screenX, screenY: window.screenY,
    outerW: window.outerWidth, outerH: window.outerHeight,
    innerW: window.innerWidth, innerH: window.innerHeight,
    dpr: window.devicePixelRatio,
    chromeH: window.outerHeight - window.innerHeight
  })));

  console.log('\n--- candidate task elements ---');
  const items = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    // 找所有带"去完成/立即完成/开始/签到/进行中"之类文本的可点元素，以及卡片容器
    const nodes = document.querySelectorAll('a, button, [role="button"], [role="link"], meecard, mee-rewards-card, [class*="card"]');
    for (const el of nodes) {
      const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt || txt.length > 120) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 20 || r.height < 10) continue;
      if (r.top < 0 || r.top > 3000) continue;
      const key = txt + '|' + Math.round(r.left) + '|' + Math.round(r.top);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        tag: el.tagName.toLowerCase(),
        href: el.getAttribute('href') || '',
        txt: txt.slice(0, 90),
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        w: Math.round(r.width), h: Math.round(r.height)
      });
      if (out.length >= 60) break;
    }
    return out;
  });
  for (const it of items) console.log(`${it.tag} | ${it.txt} | page(${it.x},${it.y}) ${it.w}x${it.h} | ${it.href.slice(0, 70)}`);

  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
