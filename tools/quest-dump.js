// 打印当前 Edge 页面的 URL / 标题 / 所有可点卡片文本，用于摸清 punchcard 内页结构
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => /rewards\.bing\.com/.test(p.url()));
  if (!page) { console.log('no rewards page'); process.exit(0); }

  const target = process.argv[2];
  const clickText = process.argv[3];
  if (target && target.startsWith('http')) {
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
  }
  if (clickText) {
    const clicked = await page.evaluate((needle) => {
      const out = [];
      const grep = (root) => {
        root.querySelectorAll('*').forEach(el => {
          if (el.tagName.includes('-') && el.shadowRoot) grep(el.shadowRoot);
        });
        root.querySelectorAll('a,button,[role=button]').forEach(el => out.push(el));
      };
      grep(document);
      const hit = out.find(el => ((el.innerText || '').replace(/\s+/g, ' ')).includes(needle));
      if (!hit) return null;
      hit.scrollIntoView({ block: 'center' });
      hit.click();
      return (hit.innerText || '').replace(/\s+/g, ' ').slice(0, 80);
    }, clickText);
    console.log('CLICKED:', clicked);
    await page.waitForTimeout(6000);
  }

  console.log('URL  :', page.url());
  console.log('TITLE:', await page.title());

  const info = await page.evaluate(() => {
    const all = [];
    const walk = (root) => {
      root.querySelectorAll('*').forEach(el => {
        if (el.tagName.includes('-')) {
          const sh = el.shadowRoot;
          if (sh) walk(sh);
        }
      });
      root.querySelectorAll('a,button,[role=button]').forEach(el => {
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length < 200) all.push({ tag: el.tagName, href: el.getAttribute('href') || '', t });
      });
    };
    walk(document);
    return {
      knowntags: [...new Set([...document.querySelectorAll('*')].map(e => e.tagName).filter(t => t.includes('-')))],
      links: all.slice(0, 80),
      bodytext: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1200)
    };
  });
  console.log('CUSTOM TAGS:', info.knowntags.join(' '));
  console.log('\n--- LINKS/BUTTONS ---');
  info.links.forEach((l, i) => console.log(i, '|', l.tag, '|', l.href.slice(0, 70), '|', l.t.slice(0, 90)));
  console.log('\n--- BODY TRIM ---');
  console.log(info.bodytext);
  await browser.close();
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
