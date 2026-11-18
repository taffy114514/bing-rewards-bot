'use strict';
/**
 * 命令行入口
 *   node src/cli.js login           首次登录（手动，有头）
 *   node src/cli.js run             执行每日任务
 *   node src/cli.js run --dry-run   只看不点
 *   node src/cli.js check           检查登录态与当前积分
 *   node src/cli.js stats           历史统计
 * 常用参数： --headless  --desktop N  --mobile N  --no-daily  --no-search  --force-mobile
 */
const readline = require('readline');
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const engine = require('./engine');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--headless') out.headless = true;
    else if (a === '--show') out.headless = false;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--no-daily') out.noDaily = true;
    else if (a === '--no-search') out.noSearch = true;
    else if (a === '--force') out.force = true;
    else if (a === '--force-mobile') out.forceMobile = true;
    else if (a === '--desktop') out.desktop = Number(argv[++i]);
    else if (a === '--mobile') out.mobile = Number(argv[++i]);
    else if (a.startsWith('--desktop=')) out.desktop = Number(a.split('=')[1]);
    else if (a.startsWith('--mobile=')) out.mobile = Number(a.split('=')[1]);
    else if (a === '--help' || a === '-h') out.help = true;
    else out._.push(a);
  }
  return out;
}

function waitEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, () => { rl.close(); resolve(); }));
}

async function cmdLogin(cfg, log) {
  const ctx = await engine.launch(cfg, log, { headless: false });
  const page = ctx.pages()[0] || (await ctx.newPage());
  try {
    await page.goto(engine.DASHBOARD, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    log.raw('');
    log.raw('==================================================================');
    log.raw(' 请在弹出的浏览器窗口中登录 Microsoft 账号（含手机/邮箱验证码）');
    log.raw(' 登录成功、能看到 Rewards 积分页面后，回到本窗口按【回车】');
    log.raw('==================================================================');
    await waitEnter('按回车继续... ');
    const st = await engine.checkLogin(ctx, page, log);
    if (st.loggedIn) {
      const bal = await engine.getBalance(page, log);
      log.ok(`登录成功${st.account ? ` (${st.account})` : ''}，当前积分: ${bal === null ? '未知' : bal}`);
      log.info(`登录态已保存在: ${cfg.browser.userDataDir}`);
      log.info('之后可以直接运行 `npm run run`，或注册计划任务每天自动跑。');
    } else {
      log.error('仍未检测到登录态: ' + st.reason);
      process.exitCode = 2;
    }
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function cmdCheck(cfg, log) {
  const ctx = await engine.launch(cfg, log, { headless: true });
  const page = ctx.pages()[0] || (await ctx.newPage());
  try {
    await page.goto(engine.DASHBOARD, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await engine.sleep(2500);
    const st = await engine.checkLogin(ctx, page, log);
    if (!st.loggedIn) {
      log.error('未登录: ' + st.reason);
      process.exitCode = 2;
      return;
    }
    const bal = await engine.getBalance(page, log);
    const tasks = await engine.runDailySet(page, cfg, log, { dryRun: true });
    log.ok(`账号: ${st.account || '(已登录)'}  当前积分: ${bal === null ? '未知' : bal}`);
    log.info(`待办活动卡片: ${tasks.found} 张`);
  } finally {
    await ctx.close().catch(() => {});
  }
}

function cmdStats(cfg, log) {
  const st = engine.readState(cfg);
  const runs = st.runs || [];
  if (!runs.length) {
    log.info('还没有运行记录。先跑一次 `npm run run`。');
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const todayRuns = runs.filter((r) => String(r.at || '').slice(0, 10) === today);
  console.log('');
  console.log('最近 14 次运行：');
  console.log('时间                  结果  前->后        增加  活动  桌面/移动  耗时');
  for (const r of runs.slice(-14)) {
    const at = String(r.at || '').replace('T', ' ').slice(0, 19);
    console.log(
      `${at}  ${r.ok ? 'OK  ' : 'FAIL'}  ${String(r.before).padStart(5)} -> ${String(r.after).padEnd(5)}` +
      `  ${String(r.gained === null ? '-' : r.gained).padStart(4)}` +
      `  ${String((r.daily && r.daily.executed) || 0).padStart(4)}` +
      `  ${String((r.searches && r.searches.desktop) || 0).padStart(3)}/${String((r.searches && r.searches.mobile) || 0).padEnd(3)}` +
      `  ${Math.round((r.durationMs || 0) / 1000)}s`
    );
  }
  console.log('');
  console.log(`今日运行: ${todayRuns.length} 次`);
  console.log(`累计获得积分: ${st.totalGained || 0}`);
  console.log(`最后运行: ${st.lastRun || '-'}`);
}

function printHelp() {
  console.log(`
Bing Rewards 每日自动任务

用法:
  node src/cli.js login                 首次登录（弹出浏览器手动登录，登录态会保存）
  node src/cli.js run                   执行每日任务（活动 + 桌面/移动搜索）
  node src/cli.js run --dry-run         只检查不执行
  node src/cli.js check                 检查登录态、当前积分、待办数量
  node src/cli.js stats                 查看历史运行与累计积分

参数:
  --headless        无头运行（更快，但可能被判定为非真实浏览而少计分）
  --show            强制有头（默认）
  --desktop N       覆盖桌面搜索次数
  --mobile N        覆盖移动搜索次数
  --no-daily        跳过每日活动
  --no-search       跳过搜索
  --force           今天已成功跑过也强制执行
  --force-mobile    移动端即使无进展也跑满次数
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'run';
  const cfg = loadConfig();
  const log = createLogger(cfg.logDir);

  if (args.help || cmd === 'help') { printHelp(); return; }

  log.raw('');
  log.raw(`==== Bing Rewards Auto  ${new Date().toLocaleString('zh-CN')}  [${cmd}] ====`);
  log.raw(`日志: ${log.file}`);

  try {
    if (cmd === 'login') return await cmdLogin(cfg, log);
    if (cmd === 'check') return await cmdCheck(cfg, log);
    if (cmd === 'stats') return cmdStats(cfg, log);
    if (cmd === 'run') {
      const result = await engine.runAll(cfg, args, log);
      if (!result.ok) process.exitCode = 1;
      return result;
    }
    printHelp();
    process.exitCode = 64;
  } catch (e) {
    log.error('未捕获异常: ' + (e && e.stack ? e.stack : e));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
