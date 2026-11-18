'use strict';
/** 浏览器启动 / 反自动化指纹 / 移动端模拟 */
const { chromium } = require('playwright');

const DESKTOP_UA_FALLBACK =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function launch(cfg, log, opts = {}) {
  const headless = opts.headless !== undefined ? opts.headless : cfg.browser.headless;
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,AutofillServerCommunication',
    '--disable-infobars'
  ];
  if (cfg.browser.windowPosition) args.push(`--window-position=${cfg.browser.windowPosition}`);
  if (cfg.browser.windowSize) args.push(`--window-size=${cfg.browser.windowSize}`);

  log.info(`启动浏览器 channel=${cfg.browser.channel} headless=${headless}`);

  const ctx = await chromium.launchPersistentContext(cfg.browser.userDataDir, {
    channel: cfg.browser.channel || undefined,
    headless,
    locale: cfg.locale,
    timezoneId: cfg.timezone,
    viewport: { width: 1200, height: 900 },
    args,
    ignoreDefaultArgs: ['--enable-automation'],
    slowMo: cfg.browser.slowMo || 0
  });

  // 指纹伪装：去掉 navigator.webdriver 等自动化痕迹
  await ctx.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      if (!window.chrome) window.chrome = { runtime: {} };
      const origQuery = window.navigator.permissions && window.navigator.permissions.query;
      if (origQuery) {
        window.navigator.permissions.query = (params) =>
          params && params.name === 'notifications'
            ? Promise.resolve({ state: 'denied' })
            : origQuery.call(window.navigator.permissions, params);
      }
    } catch (e) { /* 忽略 */ }
  });

  return ctx;
}

async function getDesktopUA(page) {
  try {
    const ua = await page.evaluate(() => navigator.userAgent);
    if (ua && ua.length > 20) return ua;
  } catch (e) { /* 忽略 */ }
  return DESKTOP_UA_FALLBACK;
}

/** 把当前 page 切成移动端 / 恢复桌面端（共用同一个 context 与登录态） */
async function setMobile(page, mobile, desktopUA) {
  const cdp = await page.context().newCDPSession(page);
  if (mobile) {
    await cdp.send('Emulation.setUserAgentOverride', {
      userAgent: MOBILE_UA,
      acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8',
      platform: 'iPhone'
    });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 3, mobile: true
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  } else {
    await cdp.send('Emulation.setUserAgentOverride', {
      userAgent: desktopUA || DESKTOP_UA_FALLBACK,
      acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8',
      platform: 'Win32'
    });
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  }
  try { await cdp.detach(); } catch (e) { /* 忽略 */ }
}

module.exports = { launch, setMobile, getDesktopUA, MOBILE_UA, DESKTOP_UA_FALLBACK };
