// BingRewardsBot - drives a REAL Microsoft Edge window with REAL mouse/keyboard input.
//
// Design:
//   * Edge is launched with --remote-debugging-port so we can READ the DOM over CDP
//     (element positions, task text, completion state) - but every click and keystroke
//     is injected at the OS level (SendInput), so the browser sees genuine user input.
//   * Screen coordinates are solved at runtime by moving the real cursor twice and
//     reading the mousemove events back from the page, which handles any DPI scaling,
//     window position and zoom level automatically.
//
// Build (no SDK required, ships with Windows):
//   csc.exe -nologo -target:exe -out:BingRewardsBot.exe Bot.cs

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace BingRewardsBot
{
    // ---------------------------------------------------------------- logging
    class Log
    {
        readonly string _path;
        readonly object _lock = new object();

        public Log(string dir)
        {
            try
            {
                Directory.CreateDirectory(dir);
                _path = Path.Combine(dir, "bot-" + DateTime.Now.ToString("yyyyMMdd") + ".log");
            }
            catch { _path = null; }
        }

        public void Write(string msg)
        {
            string line = "[" + DateTime.Now.ToString("HH:mm:ss") + "] " + msg;
            Console.WriteLine(line);
            if (_path == null) return;
            lock (_lock)
            {
                try { File.AppendAllText(_path, line + Environment.NewLine, Encoding.UTF8); } catch { }
            }
        }

        public void Step(string msg) { Write("== " + msg); }
        public void Ok(string msg) { Write("OK " + msg); }
        public void Warn(string msg) { Write("!! " + msg); }
    }

    // ------------------------------------------------------- input injection
    class InputSim
    {
        [DllImport("user32.dll", SetLastError = true)] static extern bool SetCursorPos(int X, int Y);
        [DllImport("user32.dll", SetLastError = true)] static extern bool GetCursorPos(out POINT p);
        [DllImport("user32.dll")] static extern uint SendInput(uint nInputs, IntPtr pInputs, int cbSize);
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);

        [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }

        const uint LEFTDOWN = 0x0002;
        const uint LEFTUP = 0x0004;
        const uint KEYEVENTF_UNICODE = 0x0004;
        const uint KEYEVENTF_KEYUP = 0x0002;

        readonly Random _rnd = new Random();

        static int InputSize { get { return IntPtr.Size == 8 ? 40 : 28; } }
        static int UnionOff { get { return IntPtr.Size == 8 ? 8 : 4; } }

        public InputSim() { SetProcessDPIAware(); }

        public POINT Cursor()
        {
            POINT p; GetCursorPos(out p); return p;
        }

        /// Human-ish cursor travel: eased steps with tiny timing jitter.
        public void MoveTo(int x, int y)
        {
            POINT cur = Cursor();
            int steps = 10 + _rnd.Next(0, 6);
            for (int i = 1; i <= steps; i++)
            {
                double t = (double)i / steps;
                double e = 1 - Math.Pow(1 - t, 2.4);
                int nx = (int)Math.Round(cur.X + (x - cur.X) * e);
                int ny = (int)Math.Round(cur.Y + (y - cur.Y) * e);
                if (i == steps) { nx = x; ny = y; }
                SetCursorPos(nx, ny);
                Thread.Sleep(6 + _rnd.Next(0, 12));
            }
        }

        void MouseButton(uint flags)
        {
            int size = InputSize;
            IntPtr p = Marshal.AllocHGlobal(size);
            try
            {
                for (int i = 0; i < size; i++) Marshal.WriteByte(p, i, 0);
                Marshal.WriteInt32(p, 0, 0);              // INPUT_MOUSE
                Marshal.WriteInt32(p, UnionOff + 12, (int)flags); // MOUSEINPUT.dwFlags
                SendInput(1, p, size);
            }
            finally { Marshal.FreeHGlobal(p); }
        }

        public void Click(int x, int y)
        {
            MoveTo(x, y);
            Thread.Sleep(70 + _rnd.Next(0, 120));
            MouseButton(LEFTDOWN);
            Thread.Sleep(45 + _rnd.Next(0, 70));
            MouseButton(LEFTUP);
        }

        void SendUnicode(char c, bool up)
        {
            int size = InputSize;
            IntPtr p = Marshal.AllocHGlobal(size);
            try
            {
                for (int i = 0; i < size; i++) Marshal.WriteByte(p, i, 0);
                Marshal.WriteInt32(p, 0, 1);                    // INPUT_KEYBOARD
                Marshal.WriteInt16(p, UnionOff + 0, (short)0);   // wVk
                Marshal.WriteInt16(p, UnionOff + 2, (short)c);   // wScan = UTF-16 unit
                uint f = KEYEVENTF_UNICODE | (up ? KEYEVENTF_KEYUP : 0);
                Marshal.WriteInt32(p, UnionOff + 4, (int)f);
                SendInput(1, p, size);
            }
            finally { Marshal.FreeHGlobal(p); }
        }

        void SendVk(ushort vk, bool up)
        {
            int size = InputSize;
            IntPtr p = Marshal.AllocHGlobal(size);
            try
            {
                for (int i = 0; i < size; i++) Marshal.WriteByte(p, i, 0);
                Marshal.WriteInt32(p, 0, 1);
                Marshal.WriteInt16(p, UnionOff + 0, (short)vk);
                Marshal.WriteInt16(p, UnionOff + 2, (short)0);
                Marshal.WriteInt32(p, UnionOff + 4, (int)(up ? KEYEVENTF_KEYUP : 0));
                SendInput(1, p, size);
            }
            finally { Marshal.FreeHGlobal(p); }
        }

        public void TypeText(string s)
        {
            foreach (char c in s)
            {
                SendUnicode(c, false);
                Thread.Sleep(11 + _rnd.Next(0, 28));
                SendUnicode(c, true);
                Thread.Sleep(9 + _rnd.Next(0, 22));
            }
        }

        public void Tap(ushort vk)
        {
            SendVk(vk, false);
            Thread.Sleep(28 + _rnd.Next(0, 30));
            SendVk(vk, true);
        }

        public void CtrlAThenDelete()
        {
            SendVk(0x11, false); Thread.Sleep(20);
            SendVk(0x41, false); Thread.Sleep(20);
            SendVk(0x41, true); Thread.Sleep(20);
            SendVk(0x11, true); Thread.Sleep(40);
            Tap(0x2E);
        }

        public void Sleep(int ms) { Thread.Sleep(ms); }
        public int Rand(int a, int b) { return _rnd.Next(a, b); }

        public void FocusWindow(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return;
            ShowWindow(hwnd, 9); // SW_RESTORE
            SetForegroundWindow(hwnd);
            Thread.Sleep(180);
        }
    }

    // -------------------------------------------------------- CDP (read/act)
    class Cdp : IDisposable
    {
        ClientWebSocket _ws;
        int _id;
        readonly JavaScriptSerializer _json = new JavaScriptSerializer();
        readonly Log _log;

        public Cdp(Log log) { _json.MaxJsonLength = int.MaxValue; _log = log; }

        public static string HttpGet(string url)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = 4000;
                using (var resp = req.GetResponse())
                using (var sr = new StreamReader(resp.GetResponseStream()))
                    return sr.ReadToEnd();
            }
            catch { return null; }
        }

        public static bool TryConnect(int port, string urlPart)
        {
            string list = HttpGet("http://127.0.0.1:" + port + "/json/list");
            if (string.IsNullOrEmpty(list)) return false;
            string wsUrl = PickTarget(list, urlPart);
            return wsUrl != null;
        }

        static string PickTarget(string listJson, string urlPart)
        {
            var ser = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
            var arr = ser.DeserializeObject(listJson) as object[];
            if (arr == null) return null;
            string fallback = null;
            foreach (var item in arr)
            {
                var d = item as Dictionary<string, object>;
                if (d == null) continue;
                string type = d.ContainsKey("type") ? Convert.ToString(d["type"]) : "";
                string url = d.ContainsKey("url") ? Convert.ToString(d["url"]) : "";
                string ws = d.ContainsKey("webSocketDebuggerUrl") ? Convert.ToString(d["webSocketDebuggerUrl"]) : null;
                if (type != "page" || ws == null) continue;
                if (urlPart != null && url.IndexOf(urlPart, StringComparison.OrdinalIgnoreCase) >= 0) return ws;
                if (fallback == null && url.IndexOf("http", StringComparison.OrdinalIgnoreCase) == 0) fallback = ws;
            }
            return fallback;
        }

        public void Connect(int port, string urlPart)
        {
            string list = HttpGet("http://127.0.0.1:" + port + "/json/list");
            if (string.IsNullOrEmpty(list)) throw new Exception("CDP endpoint not reachable on port " + port);
            string wsUrl = PickTarget(list, urlPart);
            if (wsUrl == null) throw new Exception("no debuggable page target found");
            _ws = new ClientWebSocket();
            _ws.ConnectAsync(new Uri(wsUrl), CancellationToken.None).Wait(10000);
            if (_ws.State != WebSocketState.Open) throw new Exception("CDP websocket failed to open");
        }

        /** 像输入法上屏一样把文本敲进当前焦点元素（会触发 input 事件，中文可靠，比剪贴板稳） */
        public void InsertText(string text)
        {
            var p = new Dictionary<string, object>();
            p["text"] = text;
            Call("Input.insertText", p);
        }

        string ReceiveMessage()
        {
            var buf = new byte[131072];
            using (var ms = new MemoryStream())
            {
                while (true)
                {
                    var task = _ws.ReceiveAsync(new ArraySegment<byte>(buf), CancellationToken.None);
                    task.Wait(30000);
                    if (!task.IsCompleted) throw new Exception("CDP receive timeout");
                    var r = task.Result;
                    if (r.MessageType == WebSocketMessageType.Close) throw new Exception("CDP closed");
                    ms.Write(buf, 0, r.Count);
                    if (r.EndOfMessage) break;
                }
                return Encoding.UTF8.GetString(ms.ToArray());
            }
        }

        public Dictionary<string, object> Call(string method, Dictionary<string, object> prms)        {
            int id = ++_id;
            var msg = new Dictionary<string, object>();
            msg["id"] = id;
            msg["method"] = method;
            msg["params"] = prms ?? new Dictionary<string, object>();
            byte[] bytes = Encoding.UTF8.GetBytes(_json.Serialize(msg));
            try
            {
                _ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None).Wait(10000);
            }
            catch (Exception e)
            {
                _log.Warn("CDP send failed (" + method + "): " + e.Message);
                return null;
            }

            for (int guard = 0; guard < 400; guard++)
            {
                string raw = ReceiveMessage();
                LastRaw = raw;
                var obj = _json.DeserializeObject(raw) as Dictionary<string, object>;
                if (obj == null) continue;
                if (!obj.ContainsKey("id")) continue;                     // event
                if (Convert.ToInt32(obj["id"]) != id) continue;
                if (obj.ContainsKey("error"))
                {
                    _log.Warn("CDP error on " + method + ": " + _json.Serialize(obj["error"]));
                    return null;
                }
                return obj.ContainsKey("result") ? obj["result"] as Dictionary<string, object> : new Dictionary<string, object>();
            }
            return null;
        }

        public string LastRaw = "";

        /// Runs JS in the page and returns the value (primitive / list / dictionary).
        /// CDP shape: { id, result: { result: { type, value }, exceptionDetails?: {...} } }
        public object Eval(string js)
        {
            var prms = new Dictionary<string, object>();
            prms["expression"] = "(function(){" + js + "})()";
            prms["returnByValue"] = true;
            prms["awaitPromise"] = true;
            prms["userGesture"] = true;
            var res = Call("Runtime.evaluate", prms);
            if (res == null) return null;
            if (res.ContainsKey("exceptionDetails"))
            {
                var ex = res["exceptionDetails"] as Dictionary<string, object>;
                if (ex != null && ex.ContainsKey("text"))
                    _log.Warn("JS error: " + Convert.ToString(ex["text"]));
                return null;
            }
            var inner = res.ContainsKey("result") ? res["result"] as Dictionary<string, object> : null;
            if (inner == null) return null;
            return inner.ContainsKey("value") ? inner["value"] : null;
        }

        public void Navigate(string url)
        {
            var prms = new Dictionary<string, object>();
            prms["url"] = url;
            Call("Page.navigate", prms);
        }

        public void BringToFront()
        {
            Call("Page.bringToFront", new Dictionary<string, object>());
        }

        public void SetMobile(string userAgent)
        {
            if (userAgent != null)
            {
                var p = new Dictionary<string, object>();
                p["userAgent"] = userAgent;
                p["platform"] = "iPhone";
                p["acceptLanguage"] = "zh-CN,zh;q=0.9";
                Call("Emulation.setUserAgentOverride", p);

                // mobile:false + deviceScaleFactor:1 —— 只伪装 UA 与视口宽，
                // 不开启触摸/移动渲染，否则 Chromium 不再派发 mousemove，坐标校准会失效。
                var m = new Dictionary<string, object>();
                m["width"] = 400;
                m["height"] = 820;
                m["deviceScaleFactor"] = 1;
                m["mobile"] = false;
                Call("Emulation.setDeviceMetricsOverride", m);
            }
            else
            {
                Call("Emulation.setUserAgentOverride", new Dictionary<string, object> { { "userAgent", "" } });
                try { Call("Emulation.clearDeviceMetricsOverride", new Dictionary<string, object>()); } catch { }
            }
        }

        public void Dispose()
        {
            try { if (_ws != null) _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None).Wait(2000); } catch { }
            try { if (_ws != null) _ws.Dispose(); } catch { }
        }
    }

    // ------------------------------------------------------------- the bot
    class Options
    {
        public int Port = 9333;
        public string ProfileDir;
        public string EdgePath;
        public int DesktopCount = 30;
        public int MobileCount = 20;
        public bool NoDaily, NoSearch, KeepOpen, DryRun, Probe, Force, Quests;
        public int SettleMs = 5000;
    }

    class Bot
    {
        readonly Log _log;
        readonly InputSim _in = new InputSim();
        readonly Options _opt;
        Cdp _cdp;

        // client(CSS px) -> physical screen px
        double _sx = 1, _ox = 0, _sy = 1, _oy = 0;
        bool _calibrated;

        public Bot(Log log, Options opt) { _log = log; _opt = opt; }

        // Microsoft Rewards cards live inside <mee-*> web components with open shadow
        // roots, so plain document.querySelectorAll cannot see them. These helpers walk
        // every shadow root and are re-injected after each navigation.
        const string Helpers = @"
window.__botAll = function(sel, root) {
  var out = [];
  function walk(node) {
    if (!node || !node.querySelectorAll) return;
    var list;
    try { list = node.querySelectorAll(sel); } catch (e) { list = []; }
    for (var i = 0; i < list.length; i++) out.push(list[i]);
    var all;
    try { all = node.querySelectorAll('*'); } catch (e) { all = []; }
    for (var j = 0; j < all.length; j++) { if (all[j].shadowRoot) walk(all[j].shadowRoot); }
  }
  walk(root || document);
  return out;
};
window.__botTxt = function(el) {
  if (!el) return '';
  var t = el.innerText || el.textContent || '';
  return t.replace(/\s+/g, ' ').trim();
};
// Rewards cards open their task in a NEW tab. A background tab gets throttled and its
// layout text disappears, which breaks detection. Force same-tab navigation instead.
window.__botPatch = function() {
  if (window.__botPatched) return 1;
  window.__botPatched = true;
  window.open = function(u) { if (u) { try { location.href = u; } catch (e) {} } return null; };
  document.addEventListener('click', function(e) {
    var n = e.target;
    while (n) {
      if (n.tagName === 'A' && n.getAttribute('target') && n.getAttribute('target') !== '_self') {
        n.setAttribute('target', '_self');
      }
      n = n.parentNode || (n.getRootNode && n.getRootNode().host);
    }
  }, true);
  return 1;
};
window.__botPatch();
return 1;";

        void EnsureHelpers() { _cdp.Eval(Helpers); }

        static double D(object o)
        {
            if (o == null) return 0;
            if (o is double) return (double)o;
            if (o is int) return (int)o;
            if (o is long) return (long)o;
            if (o is decimal) return (double)(decimal)o;
            double r; double.TryParse(Convert.ToString(o), out r); return r;
        }
        static string S(object o) { return o == null ? "" : Convert.ToString(o); }

        static Dictionary<string, object> Dict(object o) { return o as Dictionary<string, object>; }

        /// JavaScriptSerializer hands arrays back as object[], not List<object>.
        static List<object> ListOf(object o)
        {
            if (o == null) return null;
            var l = o as List<object>;
            if (l != null) return l;
            var arr = o as object[];
            if (arr != null) return new List<object>(arr);
            return null;
        }

        public void Run()
        {
            string today = DateTime.Now.ToString("yyyy-MM-dd");
            if (!_opt.Force && AlreadyRanToday(today))
            {
                _log.Ok("今天（" + today + "）已经自动跑过一次，跳过。加 --force 可强制再跑一遍。");
                return;
            }

            EnsureEdge();
            _cdp = new Cdp(_log);
            _cdp.Connect(_opt.Port, "rewards.bing.com");
            _cdp.BringToFront();
            Thread.Sleep(800);

            FocusEdgeWindow();
            Goto("https://rewards.bing.com/dashboard", 3000);
            Calibrate();

            int before = Balance();
            if (before < 0)
            {
                _log.Warn("读不到积分，可能未登录。请先手工登录一次到 " + _opt.ProfileDir);
                return;
            }
            _log.Ok("登录态有效，当前积分: " + before);

            if (!_opt.NoDaily)
            {
                try { ProcessClaimables(); } catch (Exception e) { _log.Warn("领取待领取积分出错: " + e.Message); }
                try { ProcessDashboard(); } catch (Exception e) { _log.Warn("每日活动出错: " + e.Message); }
                if (_opt.Quests)
                {
                    try { ProcessEarnStreaks(); } catch (Exception e) { _log.Warn("打卡页任务出错: " + e.Message); }
                }
                else
                {
                    _log.Write("已跳过积分赚取页的任务板块（punchcard，默认不跑；要跑加 --quests）");
                }
            }
            if (!_opt.NoSearch)
            {
                try { DoSearches(false, _opt.DesktopCount); } catch (Exception e) { _log.Warn("桌面搜索出错: " + e.Message); }
                try { DoSearches(true, _opt.MobileCount); } catch (Exception e) { _log.Warn("移动搜索出错: " + e.Message); }
                try { _cdp.SetMobile(null); } catch { }
            }

            Goto("https://rewards.bing.com/dashboard", 2500);
            int after = Balance();
            _log.Ok("结束积分: " + after + "  本次增加: +" + Math.Max(0, after - before));
            SaveState(today, after);

            if (!_opt.KeepOpen)
            {
                try { _cdp.Dispose(); } catch { }
            }
        }

        // ------------------------------------------------------- day state
        static string StatePath()
        {
            return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "state.txt");
        }

        static bool AlreadyRanToday(string today)
        {
            try
            {
                string p = StatePath();
                if (!File.Exists(p)) return false;
                foreach (string line in File.ReadAllLines(p))
                    if (line.StartsWith("date=") && line.Substring(5).Trim() == today) return true;
            }
            catch { }
            return false;
        }

        static void SaveState(string today, int balance)
        {
            try
            {
                File.WriteAllText(StatePath(),
                    "date=" + today + "\r\nbalance=" + balance + "\r\n", Encoding.UTF8);
            }
            catch { }
        }

        // ---------------------------------------------------- edge lifecycle
        static bool PortAlive(int port)
        {
            try
            {
                using (var c = new TcpClient())
                {
                    var t = c.ConnectAsync("127.0.0.1", port);
                    if (!t.Wait(700) || !c.Connected) return false;
                }
                return Cdp.HttpGet("http://127.0.0.1:" + port + "/json/version") != null;
            }
            catch { return false; }
        }

        static string FindEdge()
        {
            string[] cands = new string[]
            {
                @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe")
            };
            foreach (string c in cands) if (File.Exists(c)) return c;
            return null;
        }

        void EnsureEdge()
        {
            if (PortAlive(_opt.Port) && Cdp.TryConnect(_opt.Port, "rewards.bing.com"))
            {
                _log.Ok("已有可用的 Edge 调试实例 (端口 " + _opt.Port + ")");
                return;
            }

            string edge = _opt.EdgePath;
            if (edge == null || !File.Exists(edge)) edge = FindEdge();
            if (edge == null) throw new Exception("找不到 msedge.exe，请用 --edge 指定路径");

            string profile = _opt.ProfileDir;
            if (profile == null) profile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "profile");

            string args = string.Format(
                "--remote-debugging-port={0} --user-data-dir=\"{1}\" --force-renderer-accessibility " +
                "--no-first-run --no-default-browser-check --start-maximized \"https://rewards.bing.com/dashboard\"",
                _opt.Port, profile);

            _log.Step("启动 Edge: " + edge);
            // UseShellExecute：交给 Windows shell 启动，浏览器才不会被算作本进程的
            // 子进程（否则 bat / 计划任务 / 管道会一直等到浏览器关闭才算命令结束）。
            var psi = new ProcessStartInfo(edge, args);
            psi.UseShellExecute = true;
            psi.WindowStyle = ProcessWindowStyle.Normal;
            try { Process.Start(psi); }
            catch
            {
                var fallback = new ProcessStartInfo();
                fallback.FileName = "cmd.exe";
                fallback.Arguments = "/c start \"\" \"" + edge + "\" " + args + " >nul 2>&1";
                fallback.UseShellExecute = false;
                fallback.CreateNoWindow = true;
                Process.Start(fallback);
            }

            for (int i = 0; i < 40; i++)
            {
                Thread.Sleep(1000);
                if (PortAlive(_opt.Port) && Cdp.TryConnect(_opt.Port, "rewards.bing.com"))
                {
                    _log.Ok("Edge 已就绪 (" + (i + 1) + "s)");
                    return;
                }
            }
            throw new Exception("Edge 启动后 40 秒内未能连上调试端口");
        }

        void FocusEdgeWindow()
        {
            // The tab being "front" inside the browser is not enough - the OS window must be
            // foreground or our real clicks land on whatever is on top of it.
            _cdp.BringToFront();
            Thread.Sleep(300);
            try
            {
                string pageTitle = S(_cdp.Eval("return document.title;"));
                IntPtr hwnd = FindWindowLike(pageTitle);
                if (hwnd == IntPtr.Zero) hwnd = FindWindowLike("Edge");
                if (hwnd == IntPtr.Zero) { _log.Warn("找不到 Edge 窗口，点击可能打偏"); return; }
                ShowWindow(hwnd, 9);          // SW_RESTORE
                SetForegroundWindow(hwnd);
                Thread.Sleep(500);
                _log.Ok("已聚焦 Edge 窗口: " + WindowTitle(hwnd));
            }
            catch (Exception e) { _log.Warn("聚焦窗口失败: " + e.Message); }
        }

        // ---- window enumeration helpers
        delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int n);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hWnd, StringBuilder sb, int max);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr hWnd, StringBuilder sb, int max);

        static string WindowTitle(IntPtr h)
        {
            var sb = new StringBuilder(512);
            GetWindowTextW(h, sb, 512);
            return sb.ToString();
        }

        static IntPtr FindWindowLike(string needle)
        {
            IntPtr found = IntPtr.Zero;
            string want = needle == null ? "" : needle.Trim();
            if (want.Length > 24) want = want.Substring(0, 24);
            EnumWindows(delegate(IntPtr h, IntPtr l)
            {
                if (!IsWindowVisible(h)) return true;
                var cls = new StringBuilder(256);
                GetClassNameW(h, cls, 256);
                if (cls.ToString() != "Chrome_WidgetWin_1") return true;
                string title = WindowTitle(h);
                if (title.Length == 0) return true;
                if (want.Length > 0 && title.IndexOf(want, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    found = h;
                    return false;
                }
                return true;
            }, IntPtr.Zero);
            return found;
        }

        // ------------------------------------------------------- calibration
        void Calibrate()
        {
            double keepOx = _ox, keepOy = _oy, keepSx = _sx, keepSy = _sy;
            _calibrated = false;

            for (int attempt = 0; attempt < 3; attempt++)
            {
                try
                {
                    _cdp.Eval(@"
                        window.__botMM = [];
                        if (!window.__botMMBound) {
                            document.addEventListener('mousemove', function(e){
                                window.__botMM.push([e.clientX, e.clientY]);
                                if (window.__botMM.length > 40) window.__botMM.shift();
                            }, true);
                            window.__botMMBound = true;
                        }
                        return 1;");
                    Thread.Sleep(300);

                    int ax = 520, ay = 430, bx = 980, by = 760;
                    _in.MoveTo(ax, ay); Thread.Sleep(220);
                    object o1 = _cdp.Eval("var a=window.__botMM; return a.length?a[a.length-1]:null;");
                    _in.MoveTo(bx, by); Thread.Sleep(220);
                    object o2 = _cdp.Eval("var a=window.__botMM; return a.length?a[a.length-1]:null;");

                    var p1 = ListOf(o1); var p2 = ListOf(o2);
                    if (p1 == null || p2 == null || p1.Count < 2 || p2.Count < 2) { Thread.Sleep(400); continue; }

                    double c1x = D(p1[0]), c1y = D(p1[1]), c2x = D(p2[0]), c2y = D(p2[1]);
                    if (Math.Abs(c2x - c1x) < 5 || Math.Abs(c2y - c1y) < 5) { Thread.Sleep(400); continue; }

                    _sx = (bx - ax) / (c2x - c1x);
                    _ox = ax - _sx * c1x;
                    _sy = (by - ay) / (c2y - c1y);
                    _oy = ay - _sy * c1y;
                    _calibrated = true;
                    _log.Ok(string.Format("坐标校准完成: physX = {0:F1} + {1:F3}*clientX ; physY = {2:F1} + {3:F3}*clientY",
                        _ox, _sx, _oy, _sy));
                    return;
                }
                catch (Exception e)
                {
                    _log.Warn("坐标校准异常: " + e.Message);
                    Thread.Sleep(400);
                }
            }

            // 三次都失败：优先复用上一次成功的映射，其次退回 dpr 估算（仍继续跑，不中断）
            if (keepSx > 0 && keepSy > 0)
            {
                _ox = keepOx; _oy = keepOy; _sx = keepSx; _sy = keepSy;
                _calibrated = true;
                _log.Warn("本次校准失败，复用上次坐标映射继续运行");
                return;
            }
            double dpr = Math.Max(1, D(_cdp.Eval("return window.devicePixelRatio||1;")));
            _sx = dpr; _sy = dpr; _ox = 0; _oy = 0;
            _calibrated = true;
            _log.Warn("坐标校准失败，改用 dpr 估算继续运行 (dpr=" + dpr + ")");
        }

        int PX(double cx) { return (int)Math.Round(_ox + _sx * cx); }
        int PY(double cy) { return (int)Math.Round(_oy + _sy * cy); }

        // -------------------------------------------------------- primitives
        void WaitReady(int ms)
        {
            int t0 = Environment.TickCount;
            while (Environment.TickCount - t0 < ms)
            {
                object r = _cdp.Eval("return document.readyState;");
                if (r != null && Convert.ToString(r) == "complete") { Thread.Sleep(500); return; }
                Thread.Sleep(250);
            }
        }

        void Goto(string url, int settleMs)
        {
            _cdp.Navigate(url);
            Thread.Sleep(700);
            WaitReady(15000);
            Thread.Sleep(settleMs);
        }

        /// Finds an element by CSS selector, scrolls it into view, returns its rect.
        Dictionary<string, object> RectOf(string selector)
        {
            EnsureHelpers();
            string js = @"
                var el = window.__botAll(" + JsStr(selector) + @")[0];
                if (!el) return null;
                el.scrollIntoView({block:'center', inline:'center'});
                var r = el.getBoundingClientRect();
                if (r.width < 4 || r.height < 2) return null;
                return {x: r.left + r.width/2, y: r.top + r.height/2, w: r.width, h: r.height,
                        t: window.__botTxt(el).slice(0,120)};
            ";
            return Dict(_cdp.Eval(js));
        }

        static string JsStr(string s)
        {
            var sb = new StringBuilder("'");
            foreach (char c in s)
            {
                if (c == '\'') sb.Append("\\'");
                else if (c == '\\') sb.Append("\\\\");
                else if (c == '\n') sb.Append("\\n");
                else sb.Append(c);
            }
            sb.Append("'");
            return sb.ToString();
        }

        bool ClickRect(Dictionary<string, object> rect, string what)
        {
            if (rect == null) return false;
            double cx = D(rect["x"]), cy = D(rect["y"]);
            int px = PX(cx), py = PY(cy);
            if (!_calibrated) { _log.Warn("未校准坐标，跳过点击"); return false; }
            _log.Write("  点击 \"" + Trim(what, 40) + "\"  screen(" + px + "," + py + ")");
            _cdp.BringToFront();
            _in.Click(px, py);
            return true;
        }

        static string Trim(string s, int n)
        {
            if (s == null) return "";
            s = s.Replace("\n", " ").Trim();
            return s.Length <= n ? s : s.Substring(0, n) + "…";
        }

        bool ClickSelector(string selector, string what)
        {
            var r = RectOf(selector);
            return ClickRect(r, what);
        }

        // --------------------------------------------------------- balances
        public int Balance()
        {
            try
            {
                EnsureHelpers();
                object v = _cdp.Eval(@"
                    var out = null;
                    var els = window.__botAll('mee-rewards-counter-animation, #balanceCounter, [class*=""balance""]');
                    for (var i = 0; i < els.length; i++) {
                        var el = els[i];
                        var val = el.getAttribute('value');
                        if (val && /^\d+$/.test(val)) { out = val; break; }
                        var m0 = window.__botTxt(el).match(/^([\d,]{2,9})$/);
                        if (m0) { out = m0[1]; break; }
                    }
                    if (!out) {
                        var m = (document.body.innerText || '').match(/(?:可用积分|可用点数|积分余额|当前积分)\s*[:：]?\s*([\d,]{1,9})/);
                        if (m) out = m[1];
                    }
                    return out;");
                string s = S(v).Replace(",", "");
                int n;
                if (int.TryParse(s, out n)) return n;
                return -1;
            }
            catch { return -1; }
        }

        // ------------------------------------------------- daily dashboard
        const string DashUrl = "https://rewards.bing.com/dashboard";
        const string EarnUrl = "https://rewards.bing.com/earn?section=streaks";

        /** 已经点过一次的卡片文本：punchcard 类要跨天才能完成，不能反复点 */
        readonly HashSet<string> _tried = new HashSet<string>();

        // ---------------------------------------------- claimable point bonus
        /** 领取 dashboard 上「可领取 N」的待领取积分（当天首次搜索奖励、月度奖励等） */
        void ProcessClaimables()
        {
            _log.Step("领取待领取积分");
            int claimed = 0;
            for (int round = 0; round < 6; round++)
            {
                Goto(DashUrl, 2600);
                EnsureHelpers();

                object cv = _cdp.Eval(@"
                    var els = window.__botAll('button, a, [role=""button""]');
                    for (var i = 0; i < els.length; i++) {
                        var el = els[i];
                        var t = (el.innerText || '').replace(/\s+/g, ' ').trim();
                        if (t.indexOf('可领取') !== 0) continue;
                        var m = t.match(/可领取\s*([\d,]+)/);
                        if (!m) continue;
                        var n = parseInt(m[1].replace(/,/g, ''), 10);
                        if (!(n > 0)) continue;
                        var r = el.getBoundingClientRect();
                        if (r.width < 80 || r.height < 40) continue;
                        el.scrollIntoView({block:'center'});
                        var r2 = el.getBoundingClientRect();
                        return {x: r2.left + r2.width/2, y: r2.top + r2.height/2, w: r2.width, h: r2.height, n: n};
                    }
                    return null;");
                var card = Dict(cv);
                if (card == null)
                {
                    if (claimed == 0) _log.Write("  没有待领取的积分");
                    break;
                }

                int n = (int)D(card["n"]);
                _log.Write("  发现可领取 " + n + " 分，点开领取面板");
                if (!ClickRect(card, "可领取")) break;
                Thread.Sleep(1900);

                object bv = _cdp.Eval(@"
                    var dlg = document.querySelector('[role=""dialog""], dialog, section[role=""dialog""]');
                    var bs = (dlg || document).querySelectorAll('button, [role=""button""]');
                    for (var i = 0; i < bs.length; i++) {
                        var el = bs[i];
                        var t = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
                        if (t.indexOf('领取积分') < 0) continue;
                        var r = el.getBoundingClientRect();
                        if (r.width < 100 || r.height < 30) continue;
                        return {x: r.left + r.width/2, y: r.top + r.height/2, w: r.width, h: r.height, t: t};
                    }
                    return null;");
                var btn = Dict(bv);
                if (btn == null)
                {
                    _log.Warn("  面板里没找到「领取积分」按钮，按 Esc 关闭");
                    _in.Tap(0x1B);
                    Thread.Sleep(900);
                    continue;
                }

                if (!ClickRect(btn, "领取积分")) break;
                Thread.Sleep(2200);
                _in.Tap(0x1B);
                Thread.Sleep(900);
                claimed++;
            }
            _log.Ok("领取完成，共领取 " + claimed + " 次");
        }

        void ProcessDashboard()
        {
            _log.Step("打开每日活动页");
            Goto(DashUrl, 3500);

            if (_opt.DryRun)
            {
                int n0 = 0;
                var c0 = ListCards();
                if (c0 != null) foreach (var c in c0)
                {
                    var d = Dict(c); if (d == null) continue;
                    string tt = S(d["t"]);
                    if (!ShouldDo(tt)) continue;
                    _log.Write("  [dry] 将执行: " + Trim(tt, 70));
                    n0++;
                }
                _log.Ok("每日活动待完成 " + n0 + " 个（dry-run 不点击）");
                return;
            }

            int done = 0;
            for (int i = 0; i < 12; i++)
            {
                var cards = ListCards();
                Dictionary<string, object> pick = null;
                if (cards != null) foreach (var c in cards)
                {
                    var d = Dict(c);
                    if (d == null) continue;
                    string tt = S(d["t"]);
                    if (!ShouldDo(tt)) continue;
                    if (_tried.Contains(tt)) continue;
                    pick = d; break;
                }
                if (pick == null) { _log.Write("  没有待完成的活动了"); break; }

                string t = S(pick["t"]);
                var rect = CardRect(S(pick["idx"]));
                if (rect == null) { _log.Warn("目标卡片定位失败，结束本轮"); break; }

                _log.Write("  待办 " + (done + 1) + ": " + Trim(t, 55));
                _tried.Add(t);
                if (!ClickRect(rect, t)) break;
                Thread.Sleep(2400);
                HandleTaskPage(t);
                done++;
                Goto(DashUrl, 2600);
            }
            _log.Ok("每日活动完成 " + done + " 个");
        }

        List<object> ListCards()
        {
            EnsureHelpers();
            object v = _cdp.Eval(@"
                var olds = window.__botAll('[data-bot-idx]');
                for (var k = 0; k < olds.length; k++) olds[k].removeAttribute('data-bot-idx');
                var out = [];
                var cands = window.__botAll('a, button, [role=""button""]');
                var i = 0;
                for (var j = 0; j < cands.length; j++) {
                    var el = cands[j];
                    var t = window.__botTxt(el);
                    if (!t || t.length > 260) continue;
                    var r = el.getBoundingClientRect();
                    if (r.width < 140 || r.height < 70) continue;
                    el.setAttribute('data-bot-idx', String(i));
                    out.push({idx: i, t: t.slice(0, 200)});
                    i++;
                    if (i >= 40) break;
                }
                return out;");
            return ListOf(v);
        }

        Dictionary<string, object> CardRect(string idx)
        {
            EnsureHelpers();
            string js =
                "var el = window.__botAll('[data-bot-idx=\"" + idx + "\"]')[0];" +
                "if (!el) return null;" +
                "el.scrollIntoView({block:'center'});" +
                "var r = el.getBoundingClientRect();" +
                "return {x: r.left + r.width/2, y: r.top + r.height/2, w: r.width, h: r.height};";
            return Dict(_cdp.Eval(js));
        }

        static readonly Regex ProgressRe = new Regex(@"(活动|搜索|签到|任务)[:：]?\s*(\d+)\s*/\s*(\d+)");
        static readonly Regex PunchRe = new Regex(@"(\d+)\s*/\s*(\d+)\s*个任务");
        static readonly Regex PlusRe = new Regex(@"\+\s*\d+");

        bool ShouldDo(string t)
        {
            if (string.IsNullOrEmpty(t)) return false;
            if (t.Contains("签到:") && t.Contains("0/1")) return false;      // needs the Bing mobile app
            if (t.Contains("必应应用")) return false;                        // streaks: phone sign-in
            if (t.Contains("默认搜索引擎")) return false;                    // browser setting, not clickable
            if (t.Contains("进行中")) return false;

            var m = ProgressRe.Match(t);
            if (m.Success)
            {
                int a = int.Parse(m.Groups[2].Value), b = int.Parse(m.Groups[3].Value);
                string kind = m.Groups[1].Value;
                if (kind == "签到") return false;
                return a < b;
            }
            var pm = PunchRe.Match(t);
            if (pm.Success)
            {
                int a = int.Parse(pm.Groups[1].Value), b = int.Parse(pm.Groups[2].Value);
                return a < b;
            }
            if (t.Contains("已完成")) return false;
            if (t.Contains("天/共") && !PlusRe.IsMatch(t)) return false;
            if (PlusRe.IsMatch(t)) return true;
            return false;
        }

        // ------------------------------------------- streaks / earn activities
        void ProcessEarnStreaks()
        {
            _log.Step("打开积分赚取 / 连续打卡页");
            Goto(EarnUrl, 4000);
            _cdp.Eval("window.scrollTo(0,0); return 1;");
            Thread.Sleep(600);

            if (_opt.DryRun)
            {
                var c0 = ListCards();
                int n0 = 0;
                _log.Write("  页面可点卡片 " + (c0 == null ? 0 : c0.Count) + " 个");
                if (c0 != null) foreach (var c in c0)
                {
                    var d = Dict(c); if (d == null) continue;
                    string tt = S(d["t"]);
                    if (!ShouldDo(tt)) continue;
                    _log.Write("  [dry] 将执行: " + Trim(tt, 70));
                    n0++;
                }
                _log.Ok("连续打卡/赚积分待完成 " + n0 + " 个（dry-run 不点击）");
                return;
            }

            int done = 0;
            for (int i = 0; i < 14; i++)
            {
                var cards = ListCards();
                Dictionary<string, object> pick = null;
                if (cards != null) foreach (var c in cards)
                {
                    var d = Dict(c);
                    if (d == null) continue;
                    string tt = S(d["t"]);
                    if (!ShouldDo(tt)) continue;
                    if (_tried.Contains(tt)) continue;
                    pick = d; break;
                }
                if (pick == null) { _log.Write("  该页没有待完成项了（或都已尝试过）"); break; }

                string t = S(pick["t"]);
                var rect = CardRect(S(pick["idx"]));
                if (rect == null) { _log.Warn("卡片定位失败，结束"); break; }

                _log.Step("处理 (" + (done + 1) + "): " + Trim(t, 60));
                _tried.Add(t);
                if (!ClickRect(rect, t)) break;
                Thread.Sleep(2600);
                HandleTaskPage(t);
                done++;
                Goto(EarnUrl, 3000);
                _cdp.Eval("window.scrollTo(0,0); return 1;");
            }
            _log.Ok("连续打卡页处理完毕，执行 " + done + " 个任务");
        }

        // ------------------------------------------------- task page driver
        void HandleTaskPage(string taskName)
        {
            string startUrl = S(_cdp.Eval("return location.href;"));
            for (int step = 0; step < 14; step++)
            {
                // 1) quiz / poll answer option
                var opt = RectOf("[id^='rqAnswerOption'], .rqOption, [class*='answerOption'], [class*='AnswerOption']");
                if (opt != null) { ClickRect(opt, "选项"); Thread.Sleep(1200); continue; }

                // 2) next / submit / claim button
                var btn = FindActionButton();
                if (btn != null) { ClickRect(btn, S(btn["t"])); Thread.Sleep(1500); continue; }

                // 3) a search box on the task page
                var box = RectOf("input#sb_form_q, input[name='q'], input[type='search']");
                if (box != null)
                {
                    ClickRect(box, "搜索框");
                    Thread.Sleep(300);
                    _in.CtrlAThenDelete();
                    _in.TypeText(Query());
                    _in.Tap(0x0D);
                    Thread.Sleep(2500);
                    continue;
                }
                break;
            }

            string url = S(_cdp.Eval("return location.href;"));
            if (url.IndexOf("bing.com/search", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                Thread.Sleep(_opt.SettleMs);
                _cdp.Eval("window.scrollTo(0, document.body.scrollHeight*0.4); return 1;");
                Thread.Sleep(1200);
            }
            else
            {
                Thread.Sleep(_opt.SettleMs);
            }
        }

        Dictionary<string, object> FindActionButton()
        {
            EnsureHelpers();
            object v = _cdp.Eval(@"
                var strict = /^(下一步|下一题|提交|提交答案|完成|继续|查看结果|查看奖励|开始|领取|确定|验证|激活此任务|立即激活|Next|Next question|Submit|Continue|Finish|Done|Claim|Start|Activate)$/i;
                var loose  = /(立即激活|激活此任务|在 YouTube 上观看|了解它的运作方式|立即前往|参与活动|开始活动|去看看|查看详情|Learn more)/i;
                var bad    = /(下载|安装|Install|Download)/i;
                var els = window.__botAll('button, a, [role=""button""], input[type=""submit""]');
                for (var i = 0; i < els.length; i++) {
                    var el = els[i];
                    var t = (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim();
                    if (!t || t.length > 60) continue;
                    if (bad.test(t)) continue;
                    if (!strict.test(t) && !loose.test(t)) continue;
                    var r = el.getBoundingClientRect();
                    if (r.width < 8 || r.height < 6) continue;
                    el.scrollIntoView({block:'center'});
                    var r2 = el.getBoundingClientRect();
                    return {x: r2.left + r2.width/2, y: r2.top + r2.height/2, w: r2.width, h: r2.height, t: t};
                }
                return null;");
            return Dict(v);
        }

        // ------------------------------------------------------------ search
        static readonly string[] FallbackQueries = new string[]
        {
            "weather forecast this week", "best noise cancelling headphones 2026",
            "how to make sourdough bread", "python list comprehension examples",
            "cheapest flights to tokyo", "electric car comparison 2026",
            "home workout for beginners", "history of the printing press",
            "best budget laptop for students", "how do solar panels work",
            "coffee brewing methods explained", "national parks in autumn",
            "learn guitar chords for beginners", "space telescope latest images",
            "healthy dinner recipes quick", "stock market basics explained",
            "how to train for a marathon", "best documentaries 2026",
            "indoor plants that are easy to grow", "mechanical keyboard buying guide",
            "what is quantum computing", "japanese street food guide",
            "how to improve sleep quality", "beginner photography tips",
            "renewable energy statistics", "best hiking trails near me",
            "classic car restoration guide", "how to write a resume",
            "street photography composition", "watercolor painting techniques"
        };

        readonly List<string> _used = new List<string>();
        readonly Random _rnd = new Random();

        string Query()
        {
            for (int attempt = 0; attempt < 40; attempt++)
            {
                string q = FallbackQueries[_rnd.Next(FallbackQueries.Length)];
                string[] tails = new string[] { "", " 2026", " guide", " tips", " review", " explained", " for beginners", " comparison" };
                q = (q + tails[_rnd.Next(tails.Length)]).Trim();
                if (!_used.Contains(q)) { _used.Add(q); return q; }
            }
            string uniq = "search topic " + _rnd.Next(100000, 999999);
            _used.Add(uniq);
            return uniq;
        }

        void DoSearches(bool mobile, int count)
        {
            if (count <= 0) return;
            _log.Step((mobile ? "移动端" : "桌面端") + "搜索积分，计划 " + count + " 次");

            if (mobile)
            {
                _cdp.SetMobile("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1");
                Thread.Sleep(900);
            }

            Goto("https://www.bing.com/?cc=cn", 2600);
            if (mobile) { Thread.Sleep(400); Calibrate(); }

            int lastBal = -1;   // 还没在 dashboard 上读过，第一次 probe 时再取基准
            int stagnant = 0;
            int done = 0;

            for (int i = 0; i < count; i++)
            {
                try
                {
                    var box = RectOf("input#sb_form_q, textarea#sb_form_q, input[name='q']");
                    if (box == null) { _log.Warn("找不到搜索框，重新打开 bing.com"); Goto("https://www.bing.com/", 2500); continue; }

                    ClickRect(box, "搜索框");
                    Thread.Sleep(250);
                    _in.CtrlAThenDelete();
                    Thread.Sleep(120);
                    string q = Query();
                    _cdp.InsertText(q);
                    Thread.Sleep(220);
                    _in.Tap(0x0D);
                    Thread.Sleep(1900 + _rnd.Next(0, 1400));
                    done++;
                    string where = S(_cdp.Eval("location.href"));
                    if (where.IndexOf("q=", StringComparison.OrdinalIgnoreCase) < 0)
                        _log.Warn("  第 " + (i + 1) + " 次搜索可能没提交成功: " + where);

                    if (_rnd.Next(0, 100) < 12)
                    {
                        var res = RectOf("#b_results h2 a, #b_results a[href^='http']");
                        if (res != null) { ClickRect(res, "结果"); Thread.Sleep(1800); }
                    }

                    if ((i + 1) % 5 == 0)
                    {
                        Goto("https://rewards.bing.com/dashboard", 1800);
                        int bal = Balance();
                        _log.Write("  [" + (mobile ? "mobile" : "desktop") + "] 核对积分: " + bal + " (第 " + (i + 1) + " 次)");
                        if (bal >= 0)
                        {
                            // 第一次探测时 lastBal 还是 -1（bing.com 首页读不到积分），先拿它当基准
                            if (lastBal < 0) lastBal = bal;
                            if (bal > lastBal) { stagnant = 0; lastBal = bal; }
                            else
                            {
                                stagnant++;
                                _log.Write("  未增长 " + stagnant + "/2");
                                if (stagnant >= 2)
                                {
                                    _log.Ok((mobile ? "移动端" : "桌面端") + "额度已满，提前结束（已搜索 " + done + " 次）");
                                    break;
                                }
                            }
                        }
                        Goto("https://www.bing.com/", 1500);
                    }
                    Thread.Sleep(_in.Rand(1200, 3200));
                }
                catch (Exception e)
                {
                    _log.Warn("搜索第 " + (i + 1) + " 次异常: " + e.Message);
                    Thread.Sleep(1500);
                }
            }
            _log.Ok((mobile ? "移动端" : "桌面端") + "搜索完成，共 " + done + " 次");
        }
    }

    // ------------------------------------------------------------- entry
    class Program
    {
        static Options Parse(string[] args)
        {
            var o = new Options();
            o.ProfileDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "profile");

            // 统一支持 --desktop=6 与 --desktop 6 两种写法
            var flat = new List<string>();
            foreach (string raw in args)
            {
                int eq = raw.IndexOf('=');
                if (raw.StartsWith("--") && eq > 2)
                {
                    flat.Add(raw.Substring(0, eq));
                    flat.Add(raw.Substring(eq + 1));
                }
                else flat.Add(raw);
            }
            args = flat.ToArray();

            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                switch (a)
                {
                    case "--port": if (i + 1 < args.Length) o.Port = int.Parse(args[++i]); break;
                    case "--profile": if (i + 1 < args.Length) o.ProfileDir = args[++i]; break;
                    case "--edge": if (i + 1 < args.Length) o.EdgePath = args[++i]; break;
                    case "--desktop": if (i + 1 < args.Length) o.DesktopCount = int.Parse(args[++i]); break;
                    case "--mobile": if (i + 1 < args.Length) o.MobileCount = int.Parse(args[++i]); break;
                    case "--settle": if (i + 1 < args.Length) o.SettleMs = int.Parse(args[++i]); break;
                    case "--no-daily": o.NoDaily = true; break;
                    case "--no-search": o.NoSearch = true; break;
                    case "--keep-open": o.KeepOpen = true; break;
                    case "--dry-run": o.DryRun = true; break;
                    case "--probe": o.Probe = true; break;
                    case "--force": o.Force = true; break;
                    case "--quests": o.Quests = true; break;
                    case "--help":
                        Console.WriteLine("BingRewardsBot --simulated mouse/keyboard driver for Microsoft Rewards");
                        Console.WriteLine("  --port N         CDP port (default 9333)");
                        Console.WriteLine("  --profile DIR    Edge profile directory that holds the login");
                        Console.WriteLine("  --edge PATH      msedge.exe path");
                        Console.WriteLine("  --desktop N      desktop searches (default 30)");
                        Console.WriteLine("  --mobile N       mobile searches (default 20)");
                        Console.WriteLine("  --no-daily       skip daily activities");
                        Console.WriteLine("  --no-search      skip searches");
                        Console.WriteLine("  --dry-run        list what would be clicked, click nothing");
                        Console.WriteLine("  --keep-open      keep the CDP session open at the end");
                        Console.WriteLine("  --force          run again even if today already succeeded");
                        Console.WriteLine("  --quests         also work the quest/punchcard board on the earn page");
                        Environment.Exit(0);
                        break;
                }
            }
            return o;
        }

        [STAThread]
        static int Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            var log = new Log(Path.Combine(baseDir, "logs"));
            var opt = Parse(args);

            log.Step("BingRewardsBot 启动  " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
            int code;
            try
            {
                if (opt.Probe) { Probe(opt, log); code = 0; }
                else
                {
                    var bot = new Bot(log, opt);
                    bot.Run();
                    log.Ok("全部完成");
                    code = 0;
                }
            }
            catch (Exception e)
            {
                log.Warn("失败: " + e.Message);
                log.Write(e.StackTrace);
                code = 1;
            }
            // 我们拉起的 Edge 可能继承着 stdout 句柄（或留下后台读线程），
            // 直接以进程退出收尾，否则调用方（管道/tail/计划任务）会一直等 EOF。
            Console.Out.Flush();
            Environment.Exit(code);
            return code;
        }

        static void Probe(Options o, Log log)
        {
            string list = Cdp.HttpGet("http://127.0.0.1:" + o.Port + "/json/list");
            log.Write("GET /json/list -> " + (list == null ? "NULL" : list.Length + " bytes"));
            if (list != null) log.Write(list.Substring(0, Math.Min(700, list.Length)));

            var c = new Cdp(log);
            c.Connect(o.Port, "rewards.bing.com");
            log.Ok("websocket connected");

            log.Write("eval 1+1      -> " + S2(c.Eval("return 1+1;")));
            log.Write("raw after 1+1 -> " + c.LastRaw);
            log.Write("eval title    -> " + S2(c.Eval("return document.title;")));
            log.Write("eval href     -> " + S2(c.Eval("return location.href;")));
            log.Write("eval bodylen  -> " + S2(c.Eval("return (document.body && document.body.innerText || '').length;")));
            c.Dispose();
        }

        static string S2(object o) { return o == null ? "NULL" : o.ToString(); }
    }
}
