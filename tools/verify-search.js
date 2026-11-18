// 验证 Bing 搜索框：真实键盘输入（playwright keyboard）+ 回车，是否真的提交并跳转到 /search?q=
const { chromium } = require('playwright');

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = b.contexts()[0];
  const page = ctx.pages()[0];
  page.on('framenavigated', f => { if (f === page.mainFrame()) console.log('NAV ->', f.url().slice(0, 140)); });

  await page.goto('https://www.bing.com/?cc=cn', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const box = await page.$('#sb_form_q');
  console.log('search box found:', !!box);
  await box.click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type('珍珠奶茶', { delay: 60 });
  const val = await page.evaluate(() => document.querySelector('#sb_form_q').value);
  console.log('input value after typing:', JSON.stringify(val));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  console.log('URL after Enter:', page.url().slice(0, 160));

  // 顺便读一下 rewards 面板里的搜索进度
  await page.goto('https://www.bing.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const panel = await page.evaluate(() => {
    const b = document.querySelector('#id_rh, #rh_rwm, [id*="reward"]');
    if (b) b.click();
    return b ? (b.id || b.tagName) : null;
  });
  console.log('clicked rewards button:', panel);
  await page.waitForTimeout(2500);
  const txt = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
  const m = txt.match(/(搜索|search)[^0-9]{0,20}\d+\s*\/\s*\d+/gi);
  console.log('搜索进度片段:', m ? m.slice(0, 3) : '(未找到)');
  await b.close();
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
