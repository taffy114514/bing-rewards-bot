'use strict';
/** 简易日志：控制台 + logs/YYYY-MM-DD.log */
const fs = require('fs');
const path = require('path');

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stamp = (d = new Date()) => `${dayKey(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

function stringify(v) {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

function createLogger(logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  const file = path.join(logDir, `${dayKey()}.log`);

  const write = (level, msg) => {
    const line = `[${stamp()}] [${level}] ${msg}`;
    process.stdout.write(line + '\n');
    try { fs.appendFileSync(file, line + '\n'); } catch (e) { /* 日志失败不影响主流程 */ }
  };

  const fmt = (m, args) => (args.length ? m + ' ' + args.map(stringify).join(' ') : String(m));

  return {
    file,
    info: (m, ...a) => write('INFO', fmt(m, a)),
    warn: (m, ...a) => write('WARN', fmt(m, a)),
    error: (m, ...a) => write('ERR ', fmt(m, a)),
    ok: (m, ...a) => write(' OK ', fmt(m, a)),
    step: (m, ...a) => write('STEP', fmt(m, a)),
    raw: (m) => process.stdout.write(String(m) + '\n')
  };
}

module.exports = { createLogger, dayKey };
