'use strict';
/**
 * 搜索词生成器。
 * 目标：每个查询都不重复（Bing 对完全相同的查询通常不重复计分），
 * 同时看起来像正常用户的长尾搜索。
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_BANK = [
  // 中文本地生活 / 常识
  '红烧肉的家常做法', '空气炸锅 鸡翅 时间', '腰椎间盘突出 锻炼', '阳台种菜 西红柿',
  '笔记本电脑 散热 不好', '高铁 儿童票 身高标准', '五险一金 计算方式', '个人所得税 专项附加扣除',
  '二手房 交易 税费', '驾考科目二 倒车入库 技巧', '儿童 近视 防控', '猫咪 掉毛 严重',
  '空气净化器 滤芯 更换', '手机 电池 健康度', '云南 旅游 最佳季节', '周末 亲子 活动',
  '常见 植物 浇水 频率', '咖啡 手冲 水温', '净水器 反渗透 区别', '冰箱 除味 方法',
  // 科技 / 学习
  'JavaScript 数组去重', 'Python 读取 excel 合并', 'Linux 查看端口占用', 'nginx 反向代理 配置',
  'docker 清理 磁盘空间', 'sql 分组 取最新一条', 'git 撤销 最近一次提交', '正则 匹配 中文',
  'http 状态码 301 302 区别', 'redis 持久化 方式', 'excel 数据透视表 教程', 'word 页眉 首页不同',
  'photoshop 抠图 头发', 'pr 视频 导出 参数', '显卡 显存 作用', '固态硬盘 寿命',
  // 消费 / 生活
  '电饭煲 内胆 材质', '洗衣液 和 洗衣凝珠 区别', '羽绒服 清洗 方法', '实木家具 保养',
  '电动牙刷 声波 和 旋转', '扫地机器人 激光导航', '空调 一匹 适合 多大面积', '燃气热水器 升数 选择',
  '婴儿 奶粉 分段', '老人 血压计 选购', '运动鞋 缓震 技术', '行李箱 尺寸 登机',
  // 英文（移动端常用）
  'best budget mechanical keyboard', 'how to fix slow wifi router', 'python pandas merge example',
  'css grid vs flexbox', 'coffee grinder burr vs blade', 'home office desk setup ideas',
  'how to train a puppy basic commands', 'cheap flights to tokyo tips',
  'beginner guitar chords chart', 'how to remove hard water stains'
];

const SUFFIX = ['怎么样', '推荐', '2026', '最新', '对比', '注意事项', '教程', '价格',
  '哪个好', '为什么', '解决方法', '入门', '测评', '经验分享', '知乎', '视频'];

function loadBank(root) {
  const file = path.join(root, 'keywords.txt');
  try {
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, 'utf8')
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('#'));
      if (lines.length) return lines;
    }
  } catch (e) { /* 用内置词库兜底 */ }
  return DEFAULT_BANK;
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function createQueryMaker(root) {
  const bank = loadBank(root);
  const used = new Set();
  const year = new Date().getFullYear();

  return function makeQuery(kind) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const base = pick(bank);
      const r = Math.random();
      let q;
      if (r < 0.30) q = base;
      else if (r < 0.55) q = `${base} ${pick(SUFFIX)}`;
      else if (r < 0.72) q = `${base} ${year}`;
      else if (r < 0.85) q = `${pick(bank)} ${pick(bank)}`.slice(0, 60);
      else q = `${base} ${kind === 'mobile' ? pick(['手机', 'app', '移动端']) : pick(['电脑', 'pc'])}`;

      q = q.replace(/\s+/g, ' ').trim().slice(0, 80);
      if (q.length >= 2 && !used.has(q)) {
        used.add(q);
        return q;
      }
    }
    // 极端情况：加随机短码保证唯一
    const q = `${pick(bank)} ${Math.random().toString(36).slice(2, 7)}`;
    used.add(q);
    return q;
  };
}

module.exports = { createQueryMaker, DEFAULT_BANK };
