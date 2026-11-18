'use strict';
/** 调试：看 dashboard 真实状态（标题/URL/cookie/文本/截图） */
const path = require('path');
const { loadConfig } = require('./config');
const { launch } = require('./browser');
const engine = require('./engine');

(async () => {
  const cfg = loadConfig();
  const ctx = await launch(cfg, console, { headless: process.argv.includes('--headless') });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(engine.DASHBOARD, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await engine.sleep(5000);

  const cookies = await ctx.cookies();
  const names = cookies.map(c => c.name).sort();
  const authish = cookies.filter(c => /_U$|MSPAuth|RPSSecAuth|MSAAUTH|ESTSAUTH|ANON|MUID|SRCHUID|SRCHUSR/.test(c.name))
    .map(c => `${c.name}@${c.domain}`);

  const info = await page.evaluate(() => {
    const t = document.body ? document.body.innerText.slice(0, 600) : '';
    return {
      url: location.href,
      title: document.title,
      hasSignIn: /登录|Sign in/i.test(t),
      text: t
    };
  });

  console.log('URL      :', info.url);
  console.log('TITLE    :', info.title);
  console.log('COOKIES  :', names.join(', '));
  console.log('AUTHISH  :', authish.join(', ') || '(none)');
  console.log('TEXT-----');
  console.log(info.text);
  console.log('----------');

  const shot = path.join(cfg._root, 'logs', 'dashboard-debug.png');
  await page.screenshot({ path: shot, fullPage: false });
  console.log('截图:', shot);
  await ctx.close();
})();
