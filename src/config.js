'use strict';
/**
 * 配置加载：config.json 与内置默认值深合并。
 * 相对路径统一按项目根目录（bing-rewards/）解析。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const DEFAULTS = {
  locale: 'zh-CN',
  timezone: 'Asia/Shanghai',
  browser: {
    channel: 'msedge',
    headless: false,
    userDataDir: './profile',
    // 把窗口挪到屏幕外：有头运行（能正常计分）但不打扰日常使用
    windowPosition: '-2400,-2400',
    windowSize: '1200,900',
    slowMo: 0,
    keepOpenMs: 0
  },
  account: {
    email: '',
    password: '',
    autoLogin: false
  },
  search: {
    desktop: { enabled: true, max: 32, minDelay: 4, maxDelay: 9 },
    mobile: { enabled: true, max: 22, minDelay: 4, maxDelay: 9 },
    openResultRate: 0.12
  },
  dailySet: {
    enabled: true,
    settleMs: 6000,
    maxRounds: 2
  },
  notify: {
    type: '',
    webhook: '',
    telegramChatId: ''
  },
  stateFile: './state.json',
  logDir: './logs'
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, over) {
  if (!isPlainObject(base)) return over === undefined ? base : over;
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  if (!isPlainObject(over)) return out;
  for (const k of Object.keys(over)) {
    out[k] = isPlainObject(base[k]) && isPlainObject(over[k])
      ? deepMerge(base[k], over[k])
      : over[k];
  }
  return out;
}

function loadConfig(file) {
  const cfgFile = file || path.join(ROOT, 'config.json');
  let user = {};
  if (fs.existsSync(cfgFile)) {
    try {
      const raw = fs.readFileSync(cfgFile, 'utf8').replace(/^\uFEFF/, '');
      user = JSON.parse(raw);
    } catch (e) {
      throw new Error(`config.json 解析失败: ${e.message}`);
    }
  }
  const cfg = deepMerge(DEFAULTS, user);
  cfg.browser.userDataDir = path.resolve(ROOT, cfg.browser.userDataDir);
  cfg.stateFile = path.resolve(ROOT, cfg.stateFile);
  cfg.logDir = path.resolve(ROOT, cfg.logDir);
  cfg._root = ROOT;
  cfg._file = cfgFile;
  return cfg;
}

module.exports = { loadConfig, DEFAULTS, ROOT };
