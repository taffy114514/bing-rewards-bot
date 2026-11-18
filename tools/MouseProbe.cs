using System;
using System.Runtime.InteropServices;
using System.Threading;

// Tiny probe for OS-level mouse/keyboard injection. Compiled with csc.exe (.NET Framework 4.x).
// Commands:
//   MouseProbe.exe get
//   MouseProbe.exe move <x> <y>
//   MouseProbe.exe click <x> <y>
//   MouseProbe.exe type <text>
//   MouseProbe.exe key <VK hex>          e.g. 0D = Enter
class MouseProbe
{
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool GetCursorPos(out POINT p);

    [DllImport("user32.dll")]
    static extern uint SendInput(uint nInputs, IntPtr pInputs, int cbSize);

    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;
    const uint KEYEVENTF_UNICODE = 0x0004;
    const uint KEYEVENTF_KEYUP = 0x0002;

    static int InputSize { get { return IntPtr.Size == 8 ? 40 : 28; } }
    static int UnionOffset { get { return IntPtr.Size == 8 ? 8 : 4; } }

    static void MouseButton(uint flags)
    {
        int size = InputSize;
        IntPtr p = Marshal.AllocHGlobal(size);
        try
        {
            for (int i = 0; i < size; i++) Marshal.WriteByte(p, i, 0);
            Marshal.WriteInt32(p, 0, 0); // INPUT_MOUSE
            int off = UnionOffset;
            // MOUSEINPUT: dx(0) dy(4) mouseData(8) dwFlags(12) time(16) dwExtraInfo(24/32)
            Marshal.WriteInt32(p, off + 12, (int)flags); // dwFlags
            uint sent = SendInput(1, p, size);
            if (sent == 0) Console.WriteLine("SendInput failed: " + Marshal.GetLastWin32Error());
        }
        finally { Marshal.FreeHGlobal(p); }
    }

    static void SendUnicode(char c, bool keyUp)
    {
        int size = InputSize;
        IntPtr p = Marshal.AllocHGlobal(size);
        try
        {
            for (int i = 0; i < size; i++) Marshal.WriteByte(p, i, 0);
            Marshal.WriteInt32(p, 0, 1); // INPUT_KEYBOARD
            int off = UnionOffset;
            Marshal.WriteInt16(p, off + 0, (short)0);    // wVk
            Marshal.WriteInt16(p, off + 2, (short)c);    // wScan (unicode code unit)
            uint flags = KEYEVENTF_UNICODE | (keyUp ? KEYEVENTF_KEYUP : 0);
            Marshal.WriteInt32(p, off + 4, (int)flags);
            SendInput(1, p, size);
        }
        finally { Marshal.FreeHGlobal(p); }
    }

    static void SendVk(ushort vk, bool keyUp)
    {
        int size = InputSize;
        IntPtr p = Marshal.AllocHGlobal(size);
        try
        {
            for (int i = 0; i < size; i++) Marshal.WriteByte(p, i, 0);
            Marshal.WriteInt32(p, 0, 1);
            int off = UnionOffset;
            Marshal.WriteInt16(p, off + 0, (short)vk);
            Marshal.WriteInt16(p, off + 2, (short)0);
            Marshal.WriteInt32(p, off + 4, (int)(keyUp ? KEYEVENTF_KEYUP : 0));
            SendInput(1, p, size);
        }
        finally { Marshal.FreeHGlobal(p); }
    }

    static void Main(string[] args)
    {
        SetProcessDPIAware();
        if (args.Length == 0) { Console.WriteLine("usage: MouseProbe <get|move|click|type|key> ..."); return; }

        switch (args[0])
        {
            case "get":
            {
                POINT p;
                GetCursorPos(out p);
                Console.WriteLine(p.X + "," + p.Y);
                break;
            }
            case "move":
            {
                int x = int.Parse(args[1]), y = int.Parse(args[2]);
                SetCursorPos(x, y);
                Thread.Sleep(60);
                POINT p; GetCursorPos(out p);
                Console.WriteLine("cursor=" + p.X + "," + p.Y);
                break;
            }
            case "click":
            {
                int x = int.Parse(args[1]), y = int.Parse(args[2]);
                SetCursorPos(x, y);
                Thread.Sleep(80);
                MouseButton(MOUSEEVENTF_LEFTDOWN);
                Thread.Sleep(60);
                MouseButton(MOUSEEVENTF_LEFTUP);
                Console.WriteLine("clicked " + x + "," + y);
                break;
            }
            case "type":
            {
                string text = args[1];
                foreach (char c in text)
                {
                    SendUnicode(c, false);
                    Thread.Sleep(18);
                    SendUnicode(c, true);
                    Thread.Sleep(18);
                }
                Console.WriteLine("typed " + text.Length + " chars");
                break;
            }
            case "key":
            {
                ushort vk = Convert.ToUInt16(args[1], 16);
                SendVk(vk, false);
                Thread.Sleep(30);
                SendVk(vk, true);
                Console.WriteLine("key 0x" + vk.ToString("X2"));
                break;
            }
            default:
                Console.WriteLine("unknown command: " + args[0]);
                break;
        }
    }
}
