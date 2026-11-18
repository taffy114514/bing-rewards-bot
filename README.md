# Bing Rewards 自动跑分机器人

> Windows 上用**真实鼠标点击 + 真实键盘输入**驱动 Edge，自动完成 [Microsoft Rewards](https://rewards.bing.com) 的每日积分任务。

![platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D6)
![runtime](https://img.shields.io/badge/runtime-.NET%20Framework%204.x-512BD4)
![license](https://img.shields.io/badge/license-MIT-green)
![deps](https://img.shields.io/badge/dependencies-none-brightgreen)

不是无痕爬虫，也不是协议刷分：程序启动一个受控 Edge，**用 `SendInput` 在屏幕坐标上真的把鼠标点下去、把按键敲进去**，
浏览器内核看到的是货真价实的用户输入事件。所以跑的时候你可以随时接管鼠标，页面就是被人操作的样子。

---

## 特性

- **真实输入** —— `SendInput` 发 OS 级鼠标/键盘事件，不是 `element.click()`
- **单文件 exe** —— 一个 `Bot.cs` 编译成 exe，不依赖 Python / Node / Playwright
- **坐标自动校准** —— 启动时三点采样解线性映射，DPI 缩放、系统缩放、窗口位置、最大化都自适应
- **穿透 shadow DOM** —— Rewards 的卡片藏在 `<mee-*>` 自定义元素的 shadow root 里，递归遍历才看得见
- **幂等** —— 同一天成功跑过自动跳过；某端积分不再增长就提前收工，不空转
- **免权限自启** —— 不用管理员，装一个登录自启动快捷方式即可每天自动跑
- **可观测** —— 每一步都写日志到 `src-bot/logs/bot-YYYYMMDD.log`

---

## 它会做什么

| 环节 | 说明 |
|---|---|
| ① 领取待领取积分 | dashboard 上「可领取 N」卡片 → 点开侧边面板 → 点「领取积分」 |
| ② 每日活动 | `/dashboard` 逐张点掉待完成的每日活动卡片（quiz / poll 自动作答） |
| ③ 桌面搜索 | 真实点搜索框 → 逐字输入随机长尾词 → 回车 → 读结果 |
| ④ 移动搜索 | 同一登录态切 iPhone UA，做移动端额度 |

可选：`--quests` 才会去跑积分赚取页的 punchcard 任务板（Super Duolingo、每周专属这类，
要跨天累积、一张卡里套 5～8 个子任务，很费时间，默认关闭）。

---

## 工作原理

```
┌──────────────────────────────────────────────────────────────┐
│ 1. 启动受控 Edge                                              │
│    msedge.exe --remote-debugging-port=9333                   │
│               --user-data-dir=<独立 profile>                  │
│    （独立配置目录，不碰你日常 Edge 的标签页和登录态）           │
└───────────────────────────┬──────────────────────────────────┘
                            ↓ CDP (WebSocket JSON-RPC)
┌──────────────────────────────────────────────────────────────┐
│ 2. 读 DOM 知道"点哪里"                                        │
│    Runtime.evaluate → 递归 shadowRoot 收集卡片 → 返回元素 rect │
│    （window.__botAll 递归穿透 open shadow root）               │
└───────────────────────────┬──────────────────────────────────┘
                            ↓ 页面坐标 → 屏幕坐标
┌──────────────────────────────────────────────────────────────┐
│ 3. 坐标校准（每次运行重算）                                     │
│    注入 mousemove 监听 → 移三次鼠标 → 读回 clientX/Y           │
│    最小二乘解：physX = ox + sx*clientX   (实机 sx=1.25, dpr)  │
└───────────────────────────┬──────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ 4. SendInput 真点/真打字                                       │
│    左键 down/up、SetCursorPos、逐字 VkKeyScan                  │
│    → 浏览器收到 isTrusted=true 的真实事件                      │
└──────────────────────────────────────────────────────────────┘
```

**为什么不用 `element.click()`？** 因为那就成了典型的自动化脚本；而真实输入事件在
事件来源、焦点链、鼠标轨迹上都和真人一致。CDP 只用来"看"，不用来"点"。

---

## 快速开始

### 1. 前置条件

- Windows 10 / 11
- Microsoft Edge（系统自带）
- **Edge 里已登录** Microsoft 账号（Windows 账户同步通常就已登录）
- .NET Framework 4.x（Win10/11 自带，无需安装）

### 2. 编译（或者直接用 release 里的 exe）

```bat
cd src-bot
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe -nologo -target:exe ^
    -out:BingRewardsBot.exe -r:System.Web.Extensions.dll Bot.cs
```

> 用系统自带的 csc（C# 5 语法），不需要装 Visual Studio 或 .NET SDK。

### 3. 跑

```bat
run-bot.bat
```

第一次会自己拉起 Edge、校准坐标、开始干活。日志在 `src-bot\logs\bot-YYYYMMDD.log`。

---

## 命令行参数

```bat
run-bot.bat --dry-run                 :: 只列出会点什么，一下都不点
run-bot.bat --no-search               :: 只做活动，不搜索
run-bot.bat --no-daily                :: 只搜索，不做活动
run-bot.bat --desktop=10 --mobile=5   :: 限制搜索次数（调试用）
run-bot.bat --keep-open               :: 跑完不关浏览器，方便看页面
run-bot.bat --force                   :: 今天已经跑过了也再跑一遍
run-bot.bat --quests                  :: 额外跑 punchcard 任务板（默认关）
run-bot.bat --probe                   :: 只测 CDP 连通性和页面标题
```

| 参数 | 说明 |
|---|---|
| `--port=N` | CDP 调试端口，默认 `9333` |
| `--edge="路径"` | 指定 msedge.exe 路径 |
| `--profile="目录"` | 指定 Edge 用户数据目录（登录态所在） |
| `--headless` | 无头模式（不推荐，容易被判定非真人） |
| `--desktop=N` / `--mobile=N` | 覆盖搜索次数上限 |

默认桌面 30 次、移动 20 次。程序跑完会在 `src-bot\state.txt` 记下当天日期，
**同一天再跑会自动跳过**；要重跑加 `--force`。

---

## 每天自动跑

### 方案 A：登录自启动（免管理员，推荐）

```bat
install-bot-autostart.bat
```

在 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\` 放一个
`BingRewardsBot.lnk` → `bot-autostart.bat`，每次登录 Windows 后约 3 分钟自动跑一遍。
靠程序内置的"当天已跑过就跳过"保证一天只跑一次。

- 立刻测试这条链路：`bot-autostart.bat --now`（跳过 3 分钟等待）
- 取消：删掉上面那个 `.lnk`
- 自启日志：`src-bot\logs\autostart.log`

### 方案 B：固定时点（需管理员，右键运行一次）

```bat
:: 右键 → 以管理员身份运行
register-task-admin.bat            :: 默认每天 09:30
register-task-admin.bat 08:15      :: 自定义时间
```

> 为什么不能普通权限注册计划任务？注册 `schtasks` / `Register-ScheduledTask`
> 需要提升的令牌；普通用户（Medium 完整性级别、Administrators 组为 deny-only）
> 会被系统直接拒绝。所以默认给的是免权限的登录自启动。

两套可以共存，同一天第二次会自动跳过。

---

## 目录结构

```
bing-rewards/
├─ src-bot/                  ← 主方案：真实鼠标 exe 版
│  ├─ Bot.cs                 全部逻辑（CDP 客户端 / SendInput / 业务编排）
│  ├─ BingRewardsBot.exe     编译产物
│  ├─ profile/               Edge 独立配置（登录态，不要提交）
│  ├─ state.txt              当天运行记录
│  └─ logs/                  运行日志
├─ tools/                    ← 开发期用的探测脚本（可选）
│  ├─ MouseProbe.cs          SendInput 最小验证工具
│  ├─ cdp-probe.js           用 Playwright 读页面、摸 DOM 结构
│  ├─ calib.js               坐标映射标定
│  └─ claim-probe.js         「可领取」面板结构探测
├─ src/                      ← 备选方案：Node + Playwright 静默版
│  ├─ cli.js  engine.js  browser.js  words.js  logger.js  config.js
├─ config.json               Node 版配置
├─ keywords.txt              搜索词库（一行一个，越多越好）
├─ run-bot.bat               exe 版入口
├─ run.bat                   Node 版入口
├─ bot-autostart.bat         登录自启动（延迟 3 分钟）
├─ install-bot-autostart.bat 安装自启动快捷方式
└─ register-task-admin.bat   管理员运行 → 注册固定时点计划任务
```

### 两套实现的区别

| | exe 真实鼠标版（主） | Node 静默版（备） |
|---|---|---|
| 操作方式 | **真实鼠标 + 键盘**（SendInput） | Playwright，无可见鼠标动作 |
| 覆盖 | 领取、每日活动、桌面 + 移动搜索 | 每日活动、桌面 + 移动搜索 |
| 依赖 | 无 | Node + `npm install` |
| 适合 | 要"像人一样"跑 | 后台静默跑 |

Node 版用法：

```bat
npm install
npm run login     :: 首次登录（会弹浏览器）
npm run dry       :: 只看不点
npm run run       :: 正式执行
node src/cli.js stats   :: 最近 14 次运行与累计积分
```

---

## 积分规则参考（2026，各区不同）

| 项目 | 上限 |
|---|---|
| PC 搜索 | 约 90 分/天（3 分 × 30 次） |
| 移动搜索 | 约 60 分/天（3 分 × 20 次） |
| 每日活动 | 约 30–60 分/天 |
| Edge 专属活动 | 额外 10–30 分/天 |

程序**不写死上限**，靠积分探测判断何时该停：每 5 次搜索回 dashboard 读一次余额，
连续两轮没涨就判定该端额度已满并退出。

---

## 常见问题

**Q: 搜索都提交成功了（URL 带 `q=`），但积分一分不涨？**

先区分是"程序问题"还是"账号状态"：

1. 手动在 Edge 里搜 2～3 次，看积分涨不涨
2. 手动也不涨 → 账号当日额度已满，或被 Bing 风控静默降权（大量自动化搜索后常见），停 1～3 天自然恢复
3. 手动涨、程序不涨 → 把 `search` 的间隔调大、加长单次停留，避免短时间高频

**Q: 提示"登录态无效"？**

先手动打开那个 Edge 配置目录登一次：
`msedge.exe --user-data-dir="<项目>\src-bot\profile"`，登录后关掉再跑程序。
`profile/` 目录等于登录态，删掉即退出登录。

**Q: 坐标点偏了 / 点到别处？**

程序每次运行都会重新校准。若日志里出现"校准失败，复用上次坐标映射"，通常是页面还没加载完
（`Goto` 的 settle 时间不够）或窗口被别的窗口盖住。把 Edge 窗口前置再跑一次即可。

**Q: 卡片一个都找不到？**

Rewards 的卡片在 `<mee-*>` 自定义元素的 open shadow root 里，`document.querySelectorAll`
看不到。改版后如果连 `window.__botAll` 也扫不到，用 `tools/cdp-probe.js` 重新摸一遍 DOM。

**Q: 会不会影响账号安全？**

程序只做「打开页面 + 搜索 + 点按钮」，不抓取数据、不上传、不联网存任何信息。
登录态只在本机 `profile/` 目录里。但自动化操作本身可能违反 Microsoft Rewards 的服务条款，
账号风险由使用者自行承担。

---

## 免责声明

本项目仅供个人学习 Windows 自动化（CDP、SendInput、UI 探测）使用。
使用本工具可能违反 [Microsoft 服务协议](https://www.microsoft.com/servicesagreement)，
可能导致积分被清零或账号受限。请自行评估并承担风险，作者不承担任何后果。

---

## License

[MIT](LICENSE)

---

## 发布到 GitHub

仓库已 `git init` 并提交好，用自带脚本一键建仓库 + 推送：

```powershell
# 1) 生成 token: https://github.com/settings/tokens -> Generate new token (classic)，勾 repo
# 2) 在本目录执行：
.\publish.ps1 -Token "ghp_xxxxxxxx"
```

脚本会校验 token、创建仓库、推送 `main`，完成后打印仓库地址。
token 只通过 `http.extraHeader` 传给 git，**不会写进 `.git/config`**，用完去同一页面 Revoke 即可。

> 注意：`.gitignore` 已排除 `profile/`、`state.txt`、`logs/`、`*.exe`、`node_modules/`。
> 其中 `profile/` 带着登录态 cookie，**永远不要提交**。
