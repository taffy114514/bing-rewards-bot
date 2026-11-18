// 点开「可领取」面板后打印里面所有可点元素，用于摸清"领取积分"按钮的结构
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => /rewards\.bing\.com/.test(p.url())) || ctx.pages()[0];
  await page.goto('https://rewards.bing.com/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const clicked = await page.evaluate(() => {
    const out = [];
    const grep = (root) => {
      root.querySelectorAll('*').forEach(el => { if (el.tagName.includes('-') && el.shadowRoot) grep(el.shadowRoot); });
      root.querySelectorAll('*').forEach(el => out.push(el));
    };
    grep(document);
    const hit = out.find(el => ((el.innerText || '').replace(/\s+/g, ' ')).startsWith('可领取'));
    if (!hit) return null;
    hit.scrollIntoView({ block: 'center' });
    hit.click();
    return (hit.innerText || '').replace(/\s+/g, ' ');
  });
  console.log('CLICKED:', clicked);
  await page.waitForTimeout(3000);

  const info = await page.evaluate(() => {
    const btns = [];
    const grep = (root) => {
      root.querySelectorAll('*').forEach(el => { if (el.tagName.includes('-') && el.shadowRoot) grep(el.shadowRoot); });
      root.querySelectorAll('button, a, [role=button], [role=dialog], dialog').forEach(el => {
        const t = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        const r = el.getBoundingClientRect();
        if (t) btns.push({ tag: el.tagName, role: el.getAttribute('role') || '', t: t.slice(0, 70), w: Math.round(r.width), h: Math.round(r.height) });
      });
    };
    grep(document);
    return {
      btns,
      hasClaimText: (document.body.innerText || '').includes('领取积分'),
      dialogs: document.querySelectorAll('dialog,[role=dialog]').length,
      tail: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400)
    };
  });
  console.log('hasClaimText:', info.hasClaimText, ' dialogs:', info.dialogs);
  console.log('--- buttons/links ---');
  info.btns.forEach((b, i) => console.log(i, '|', b.tag, b.role, b.w + 'x' + b.h, '|', b.t));
  console.log('--- text ---');
  console.log(info.tail);
  await browser.close();
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
