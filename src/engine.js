'use strict';
/**
 * 核心引擎：登录检测 / 每日活动 / 搜索任务 / 积分读取 / 状态记录。
 * 所有页面结构识别都做了多选择器回退，Bing 改版时不至于整体失效。
 */
const fs = require('fs');
const { launch, setMobile, getDesktopUA } = require('./browser');
const { createQueryMaker } = require('./words');

const DASHBOARD = 'https://rewards.bing.com/dashboard';
const HOME = 'https://www.bing.com/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
/** 本地日期 YYYY-MM-DD（不能用 toISOString，那是 UTC，凌晨会错一天） */
const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* ------------------------------------------------------------------ */
/* 状态文件                                                            */
/* ------------------------------------------------------------------ */
function readState(cfg) {
  try {
    return JSON.parse(fs.readFileSync(cfg.stateFile, 'utf8'));
  } catch (e) {
    return { runs: [], totalGained: 0, lastRun: null };
  }
}

function writeState(cfg, st) {
  try {
    fs.writeFileSync(cfg.stateFile, JSON.stringify(st, null, 2), 'utf8');
  } catch (e) { /* 忽略 */ }
}

/* ------------------------------------------------------------------ */
/* 页面工具                                                            */
/* ------------------------------------------------------------------ */
async function dismissOverlays(page) {
  await page.evaluate(() => {
    const sels = [
      '#bnp_btn_accept', '#bnp_btn_reject',
      'button#wcpConsentBannerCtrl',
      '#wcpConsentBannerCtrl',
      'button[aria-label*="关闭" i]',
      'button[aria-label*="Close" i]',
      '#email-promo-close',
      '.close-button'
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && el.offsetParent !== null) { try { el.click(); } catch (e) {} }
    }
  }).catch(() => {});
}

/** 递归收集正文（含 shadow DOM） */
async function readPageText(page) {
  return page.evaluate(() => {
    const chunks = [];
    const walk = (node, depth) => {
      if (!node || depth > 80) return;
      if (node.nodeType === 3) {
        const t = node.nodeValue;
        if (t && t.trim()) chunks.push(t);
        return;
      }
      if (node.nodeType !== 1) return;
      const kids = node.childNodes || [];
      for (let i = 0; i < kids.length; i++) walk(kids[i], depth + 1);
      if (node.shadowRoot) walk(node.shadowRoot, depth + 1);
    };
    walk(document.body, 0);
    return chunks.join(' ').replace(/\s+/g, ' ').slice(0, 6000);
  }).catch(() => '');
}

/* ------------------------------------------------------------------ */
/* 登录                                                                */
/* ------------------------------------------------------------------ */
async function checkLogin(ctx, page, log) {
  try {
    if (!/rewards\.bing\.com/.test(page.url())) {
      await page.goto(DASHBOARD, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(2500);
    }
  } catch (e) {
    log.warn('打开 dashboard 失败: ' + e.message);
  }

  const url = page.url();
  if (/login\.live\.com|login\.microsoftonline|signin/i.test(url)) {
    return { loggedIn: false, reason: '被重定向到登录页', url };
  }

  const cookies = await ctx.cookies().catch(() => []);
  // 注意：MUID 只是机器标识，任何访客都有，不能作为登录判据
  const AUTH_COOKIES = ['_U', 'MSPAuth', 'RPSSecAuth', '__Host-MSAAUTH', '__Host-MSAAUTHP', 'ESTSAUTH', 'ESTSAUTHPERSISTENT'];
  const authCookie = cookies.find((c) => AUTH_COOKIES.includes(c.name) && c.value);

  const text = await readPageText(page);
  const signInPrompt = /登录以开始|登录即可|立即登录|Sign in to start|Sign in to earn/i.test(text);
  // 已登录的 Rewards 页面会渲染积分/等级/可领取等区块
  const earnedUi = /可用积分|可领取|积分赚取|会员/i.test(text) && /\d{2,}/.test(text);

  const accountName = await page.evaluate(() => {
    const el = document.querySelector('#mectrl_currentAccount_primary, [data-bi-id="account"]');
    if (el && el.innerText) return el.innerText.trim();
    const body = document.body ? document.body.innerText : '';
    const m = body.match(/\n\s*([^\n]{2,24}?)\s*\n+\s*会员/);
    return m ? m[1].trim() : null;
  }).catch(() => null);

  const loggedIn = !signInPrompt && (!!authCookie || !!accountName || earnedUi);
  return {
    loggedIn,
    reason: loggedIn ? 'ok' : (signInPrompt ? '页面提示登录' : '无登录 Cookie'),
    url,
    account: accountName || null
  };
}

async function tryAutoLogin(page, cfg, log) {
  const { email, password } = cfg.account;
  if (!email || !password) {
    log.warn('未配置账号密码，跳过自动登录');
    return false;
  }
  log.step('尝试自动登录 Microsoft 账号');
  try {
    await page.goto('https://login.live.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2500);
    const emailSel = 'input[type="email"], input[name="loginfmt"]';
    await page.waitForSelector(emailSel, { timeout: 20000 });
    await page.fill(emailSel, email);
    await page.keyboard.press('Enter');
    await sleep(3500);
    const pwdSel = 'input[type="password"], input[name="passwd"]';
    await page.waitForSelector(pwdSel, { timeout: 20000 });
    await page.fill(pwdSel, password);
    await page.keyboard.press('Enter');
    await sleep(6000);
    const t = await readPageText(page);
    if (/保持登录|Stay signed in|保持登录状态/i.test(t)) {
      const btn = await page.$('#idBtn_Back, input[value="否"], #declineButton');
      if (btn) { await btn.click().catch(() => {}); await sleep(3000); }
    }
    if (/验证码|验证你的身份|verify your identity|Enter code/i.test(t)) {
      log.warn('账号需要二次验证，请在浏览器里手动完成');
      return false;
    }
    return true;
  } catch (e) {
    log.warn('自动登录失败: ' + e.message);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 积分读取                                                            */
/* ------------------------------------------------------------------ */
async function getBalance(page, log) {
  let value = null;

  try {
    const dom = await page.evaluate(() => {
      const chunks = [];
      const walk = (node, depth) => {
        if (!node || depth > 80) return;
        if (node.nodeType === 3) {
          const t = node.nodeValue;
          if (t && t.trim()) chunks.push(t);
          return;
        }
        if (node.nodeType !== 1) return;
        const kids = node.childNodes || [];
        for (let i = 0; i < kids.length; i++) walk(kids[i], depth + 1);
        if (node.shadowRoot) walk(node.shadowRoot, depth + 1);
      };
      walk(document.body, 0);
      let attr = null;
      const el = document.querySelector(
        'mee-rewards-counter-animation, #balanceCounter, [class*="balance" i][value]'
      );
      if (el) attr = el.getAttribute('value') || el.getAttribute('data-value') || el.getAttribute('balance');
      return { text: chunks.join(' ').replace(/\s+/g, ' '), attr };
    });

    if (dom.attr && /\d/.test(dom.attr)) {
      value = Number(String(dom.attr).replace(/[^\d]/g, ''));
    }
    if (!Number.isFinite(value)) {
      const patterns = [
        /(?:可用积分|可用点数|积分余额|当前积分|积分)\s*[:：]?\s*([\d,]{1,9})/i,
        /([\d,]{2,9})\s*(?:积分|points?)/i,
        /(?:points?|balance)\s*[:：]?\s*([\d,]{1,9})/i
      ];
      for (const rx of patterns) {
        const m = dom.text.match(rx);
        if (m) { value = Number(m[1].replace(/,/g, '')); break; }
      }
    }
  } catch (e) {
    log.warn('DOM 读积分失败: ' + e.message);
  }

  // API 兜底
  if (!Number.isFinite(value)) {
    try {
      value = await page.evaluate(async () => {
        const guid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
        const r = await fetch(
          `/api/getuserinfo?type=1&X-RequestId=${guid}&X-RequestClient=Edge`,
          { credentials: 'include', headers: { Accept: 'application/json' } }
        );
        if (!r.ok) return null;
        const j = await r.json();
        const v = j.balance ?? j.availablePoints ?? j.rewardsBalance ?? null;
        return typeof v === 'number' ? v : (v ? Number(v) : null);
      });
    } catch (e) { /* 忽略 */ }
  }

  return Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------------ */
/* 每日活动                                                            */
/* ------------------------------------------------------------------ */
async function parseTasks(page) {
  return page.evaluate(() => {
    const items = [];
    const seen = new Set();
    const add = (href, title) => {
      if (!href || seen.has(href)) return;
      seen.add(href);
      items.push({ href, title: String(title || '').slice(0, 140) });
    };

    const structural = [
      'mee-rewards-daily-set-item a[href]',
      'mee-rewards-more-activities-card-item a[href]',
      '[data-bi-area="dailyset"] a[href]',
      '[data-bi-area="moreactivities"] a[href]',
      'mee-rewards-daily-set a[href]'
    ];
    for (const s of structural) {
      let nodes = [];
      try { nodes = document.querySelectorAll(s); } catch (e) { continue; }
      for (const a of nodes) {
        const href = a.href || '';
        if (!/^https?:/i.test(href)) continue;
        if (!/bing\.com|rewards\.bing\.com/i.test(href)) continue;
        const t = a.getAttribute('aria-label') || a.innerText || a.textContent || '';
        add(href, t.replace(/\s+/g, ' ').trim());
      }
    }

    // 兜底：整页扫描 rnoreward / quiz 链接
    if (!items.length) {
      for (const a of document.querySelectorAll('a[href]')) {
        const href = a.href || '';
        if (!/rnoreward=1|rewards\.bing\.com\/(quiz|poll|daily)/i.test(href)) continue;
        const t = a.getAttribute('aria-label') || a.innerText || '';
        add(href, String(t).replace(/\s+/g, ' ').trim());
      }
    }
    return items;
  }).catch(() => []);
}

async function autoQuiz(page, log) {
  let interacted = false;
  for (let step = 0; step < 25; step++) {
    const res = await page.evaluate(() => {
      // 1) 选项
      const opts = document.querySelectorAll(
        '[id^="rqAnswerOption"], [id^="pollOption"], .rqOption, [class*="rqOption" i], [class*="pollOption" i]'
      );
      if (opts.length) {
        const visible = [...opts].filter((el) => el.offsetParent !== null || el.getClientRects().length);
        const target = visible.length ? visible : opts;
        const idx = Math.floor(Math.random() * target.length);
        try { target[idx].click(); } catch (e) {}
        return { acted: 'option', n: target.length };
      }
      // 2) 下一步 / 提交
      const direct = ['#rqNextQuestion', '#nextQuestion', '#finishQuiz', '#rqFinishQuiz', '#rqSubmit', '#submitButton'];
      for (const s of direct) {
        const el = document.querySelector(s);
        if (el && el.offsetParent !== null) { try { el.click(); return { acted: s }; } catch (e) {} }
      }
      const rx = /^(下一步|下一题|下个问题|继续|提交|完成|结束|查看结果|Next|Continue|Submit|Finish|Done|See results?)$/i;
      const cands = [...document.querySelectorAll('button, input[type="button"], input[type="submit"], a[role="button"]')];
      for (const el of cands) {
        const t = (el.innerText || el.value || '').trim();
        if (rx.test(t) && (el.offsetParent !== null || el.getClientRects().length)) {
          try { el.click(); return { acted: t }; } catch (e) {}
        }
      }
      return { acted: null };
    }).catch(() => ({ acted: null }));

    if (!res || !res.acted) break;
    interacted = true;
    await sleep(rand(1200, 2200));
    // 出现“已完成”提示就收工
    const txt = await readPageText(page);
    if (/已完成|已经完成|已获得|积分已增加|Completed|You earned/i.test(txt) && /quiz|question|问题/i.test(txt)) {
      break;
    }
  }
  if (interacted) log.info('  已自动作答/推进 quiz');
  return interacted;
}

async function clickGenericAction(page) {
  return page.evaluate(() => {
    const rx = /^(领取|领取积分|立即领取|开始|立即开始|去完成|去做|参加|开始任务|打卡|签到|领取奖励|查看|查看详情|Claim|Claim now|Start|Begin|Join|Take|Play|Continue|Explore|View)$/i;
    const cands = [...document.querySelectorAll(
      'button, a[role="button"], input[type="button"], input[type="submit"], a[class*="button" i], a[class*="Button" i]'
    )];
    for (const el of cands) {
      const t = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
      if (rx.test(t) && (el.offsetParent !== null || el.getClientRects().length)) {
        try { el.click(); return t; } catch (e) {}
      }
    }
    return null;
  }).catch(() => null);
}

async function runOneTask(page, task, cfg, log) {
  log.info(`  打开: ${task.title || '(无标题)'} -> ${task.href.slice(0, 100)}`);
  try {
    await page.goto(task.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    log.warn('  打开失败: ' + e.message);
    return false;
  }
  await sleep(rand(1800, 2800));
  await dismissOverlays(page);

  const quiz = await autoQuiz(page, log);
  const clicked = await clickGenericAction(page);
  if (clicked) log.info(`  点击按钮: ${clicked}`);
  if (quiz || clicked) await sleep(rand(1500, 2500));

  // 搜索类任务靠停留 + 滚动计分
  await sleep(cfg.dailySet.settleMs);
  await page.mouse.wheel(0, rand(300, 700)).catch(() => {});
  await sleep(rand(800, 1600));
  await dismissOverlays(page);

  const txt = await readPageText(page);
  if (/已完成|已经完成|已完成任务|Completed|You('|’)ve earned/i.test(txt)) {
    log.ok('  该活动显示已完成');
  }
  return true;
}

async function runDailySet(page, cfg, log, opts) {
  const visited = new Set();
  let executed = 0;

  for (let round = 1; round <= Math.max(1, cfg.dailySet.maxRounds); round++) {
    try {
      await page.goto(DASHBOARD, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (e) {
      log.warn('打开 dashboard 失败: ' + e.message);
      break;
    }
    await sleep(rand(2500, 4000));
    await page.waitForSelector(
      'mee-rewards-daily-set-item, mee-rewards-more-activities-card-item, a[href*="rnoreward"]',
      { timeout: 12000 }
    ).catch(() => {});
    await sleep(1500);

    const tasks = await parseTasks(page);
    const pending = tasks.filter((t) => !visited.has(t.href));
    log.step(`每日活动 第 ${round} 轮：发现 ${tasks.length} 张卡片，待处理 ${pending.length} 张`);
    if (!pending.length) break;

    for (const t of pending) {
      visited.add(t.href);
      if (opts.dryRun) {
        log.info(`  [dry-run] 将执行: ${t.title || t.href.slice(0, 90)}`);
        continue;
      }
      await runOneTask(page, t, cfg, log);
      executed++;
      await sleep(rand(1500, 3000));
    }
    if (opts.dryRun) break;
  }
  return { found: visited.size, executed };
}

/* ------------------------------------------------------------------ */
/* 搜索                                                                */
/* ------------------------------------------------------------------ */
async function openFirstResult(page) {
  const href = await page.evaluate(() => {
    const a = document.querySelector('#b_results h2 a[href], li.b_algo h2 a[href]');
    return a ? a.href : null;
  }).catch(() => null);
  if (!href || !/^https?:/i.test(href) || !/^https?:\/\/(?!www\.bing\.com)/i.test(href)) return false;
  try {
    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(rand(1500, 3000));
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(rand(800, 1500));
    return true;
  } catch (e) {
    return false;
  }
}

async function doSearches(page, count, cfg, log, kind, makeQuery, probe) {
  const conf = cfg.search[kind] || cfg.search.desktop;
  let done = 0;
  const forms = ['QBLH', 'QBRE', 'HPCNT', 'BING', 'QBLH'];
  let lastBal = null;
  let stagnant = 0;
  const PROBE_EVERY = 5;

  for (let i = 0; i < count; i++) {
    const q = makeQuery(kind);
    const form = forms[Math.floor(Math.random() * forms.length)];
    const url = `https://www.bing.com/search?q=${encodeURIComponent(q)}&form=${form}&pq=${encodeURIComponent(q.slice(0, 14))}`;

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(rand(conf.minDelay * 1000, conf.maxDelay * 1000));
      await page.mouse.wheel(0, rand(200, 600)).catch(() => {});
      if (Math.random() < cfg.search.openResultRate) {
        await openFirstResult(page).catch(() => {});
      }
      done++;
      log.info(`[${kind}] ${done}/${count}  ${q}`);
    } catch (e) {
      log.warn(`[${kind}] 第 ${i + 1} 次搜索失败: ${e.message}`);
      await sleep(2000);
    }

    await sleep(rand(1200, 2600));

    // 每 5 次核对一次积分：连续两轮不涨就判定今日额度已满，提前收工
    if (probe && done >= PROBE_EVERY && done < count && done % PROBE_EVERY === 0) {
      const bal = await probe();
      if (bal !== null) {
        if (lastBal === null) {
          lastBal = bal;
          log.info(`[${kind}] 核对积分: ${bal}`);
        } else if (bal > lastBal) {
          log.info(`[${kind}] 核对积分: ${lastBal} -> ${bal}（继续）`);
          lastBal = bal;
          stagnant = 0;
        } else {
          log.info(`[${kind}] 核对积分: ${bal}（未增长 ${stagnant + 1}/2）`);
          lastBal = bal;
          stagnant++;
          if (stagnant >= 2) {
            log.warn(`[${kind}] 近 ${stagnant * PROBE_EVERY} 次搜索积分未增长，判定今日${kind === 'mobile' ? '移动' : 'PC'}端额度已满，提前结束`);
            break;
          }
        }
      }
    }
  }
  return done;
}

/* ------------------------------------------------------------------ */
/* 通知                                                                */
/* ------------------------------------------------------------------ */
async function notify(cfg, log, text) {
  const n = cfg.notify || {};
  if (!n.type || !n.webhook) return;
  let payload;
  if (n.type === 'wecom' || n.type === 'dingtalk') {
    payload = { msgtype: 'text', text: { content: text } };
  } else if (n.type === 'telegram') {
    payload = { chat_id: n.telegramChatId, text };
  } else {
    payload = { text };
  }
  try {
    const r = await fetch(n.webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    log.info(`通知已发送 HTTP ${r.status}`);
  } catch (e) {
    log.warn('通知发送失败: ' + e.message);
  }
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */
async function runAll(cfg, opts, log) {
  const t0 = Date.now();

  // 当天已成功跑过就跳过，避免计划任务重复触发浪费额度
  if (!opts.force) {
    const prev = readState(cfg);
    const today = localDay();
    const doneToday = (prev.runs || [])
      .filter((r) => r && r.ok && String(r.at || '').slice(0, 10) === today)
      .pop();
    if (doneToday) {
      log.info(
        `今天（${today}）已成功运行过一次（${doneToday.before} -> ${doneToday.after}），跳过。` +
        `加 --force 可强制再跑一次`
      );
      return {
        ok: true, skipped: true, before: doneToday.before, after: doneToday.after,
        gained: 0, daily: { found: 0, executed: 0 }, searches: { desktop: 0, mobile: 0 },
        error: null, durationMs: 0, finishedAt: new Date().toISOString()
      };
    }
  }

  const makeQuery = createQueryMaker(cfg._root);
  const result = {
    ok: false,
    before: null,
    after: null,
    gained: null,
    daily: { found: 0, executed: 0 },
    searches: { desktop: 0, mobile: 0 },
    error: null,
    account: null
  };

  const ctx = await launch(cfg, log, { headless: opts.headless });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(60000);

  try {
    // ---------- 1. 登录 ----------
    log.step('检查登录状态');
    await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(1500);

    let st = await checkLogin(ctx, page, log);
    if (!st.loggedIn) {
      log.warn('未登录: ' + st.reason);
      if (cfg.account.autoLogin) {
        await tryAutoLogin(page, cfg, log);
        st = await checkLogin(ctx, page, log);
      }
    }
    if (!st.loggedIn) {
      throw new Error('登录态无效，请先运行 `npm run login` 手动登录一次');
    }
    result.account = st.account;
    log.ok('登录态有效' + (st.account ? ` (${st.account})` : ''));

    // ---------- 2. 初始积分 ----------
    await page.goto(DASHBOARD, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(rand(2500, 4000));
    result.before = await getBalance(page, log);
    log.info(`初始积分: ${result.before === null ? '未知' : result.before}`);

    // ---------- 3. 每日活动 ----------
    if (!opts.noDaily && cfg.dailySet.enabled) {
      log.step('开始完成每日活动');
      result.daily = await runDailySet(page, cfg, log, opts);
      log.ok(`每日活动结束：共 ${result.daily.found} 张卡片，执行 ${result.daily.executed} 次`);
    } else {
      log.info('已跳过每日活动');
    }

    // ---------- 4. 搜索任务 ----------
    if (!opts.noSearch) {
      const desktopCount = opts.desktop !== undefined ? opts.desktop : cfg.search.desktop.max;
      const mobileCount = opts.mobile !== undefined ? opts.mobile : cfg.search.mobile.max;

      const desktopUA = await getDesktopUA(page);

      // 搜索过程中用它核对积分，涨不动就提前收工
      const probeBalance = async () => {
        try {
          await page.goto(DASHBOARD, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await sleep(rand(1800, 2800));
          const b = await getBalance(page, log);
          await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
          await sleep(700);
          return b;
        } catch (e) {
          return null;
        }
      };

      if (cfg.search.desktop.enabled && desktopCount > 0) {
        log.step(`桌面搜索 ${desktopCount} 次`);
        await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await sleep(1500);
        result.searches.desktop = await doSearches(page, desktopCount, cfg, log, 'desktop', makeQuery, probeBalance);
      }

      // PC 与移动端额度各自独立计分：两边都跑，各自靠 probe 提前停止
      if (cfg.search.mobile.enabled && mobileCount > 0) {
        log.step(`移动搜索 ${mobileCount} 次`);
        await setMobile(page, true, desktopUA);
        await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await sleep(2000);
        result.searches.mobile = await doSearches(page, mobileCount, cfg, log, 'mobile', makeQuery, probeBalance);
        await setMobile(page, false, desktopUA);
      }
    } else {
      log.info('已跳过搜索任务');
    }

    // ---------- 5. 复查积分 ----------
    await page.goto(DASHBOARD, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(rand(2500, 4000));
    result.after = await getBalance(page, log);
    if (result.before !== null && result.after !== null) {
      result.gained = result.after - result.before;
    }
    result.ok = true;
    log.ok(`结束积分: ${result.after === null ? '未知' : result.after}，本次增加 ${result.gained === null ? '未知' : result.gained}`);
  } catch (e) {
    result.error = e.message;
    log.error('运行失败: ' + e.message);
  } finally {
    if (cfg.browser.keepOpenMs > 0 && !opts.headless) {
      log.info(`保留窗口 ${cfg.browser.keepOpenMs}ms 便于查看`);
      await sleep(cfg.browser.keepOpenMs);
    }
    await ctx.close().catch(() => {});
  }

  result.durationMs = Date.now() - t0;
  result.finishedAt = new Date().toISOString();

  // ---------- 6. 记录状态 ----------
  const state = readState(cfg);
  state.runs = Array.isArray(state.runs) ? state.runs : [];
  state.runs.push({
    at: result.finishedAt,
    ok: result.ok,
    before: result.before,
    after: result.after,
    gained: result.gained,
    daily: result.daily,
    searches: result.searches,
    durationMs: result.durationMs,
    error: result.error
  });
  if (state.runs.length > 180) state.runs = state.runs.slice(-180);
  if (typeof result.gained === 'number' && result.gained > 0) {
    state.totalGained = (state.totalGained || 0) + result.gained;
  }
  state.lastRun = result.finishedAt;
  writeState(cfg, state);

  // ---------- 7. 通知 ----------
  const msg = result.ok
    ? `Bing Rewards 完成：积分 ${result.before} -> ${result.after}（+${result.gained ?? '?'}），活动 ${result.daily.executed} 个，搜索 桌面${result.searches.desktop}/移动${result.searches.mobile}`
    : `Bing Rewards 失败：${result.error}`;
  await notify(cfg, log, msg);

  return result;
}

module.exports = {
  DASHBOARD,
  HOME,
  sleep,
  rand,
  launch,
  checkLogin,
  getBalance,
  readPageText,
  runDailySet,
  doSearches,
  runAll,
  readState,
  writeState,
  setMobile,
  getDesktopUA
};
