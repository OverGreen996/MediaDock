using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;
class SaveDialogSmoke {
    delegate bool EnumProc(IntPtr handle, IntPtr param);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr param);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle, out uint process);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr handle, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr handle, EnumProc callback, IntPtr param);
    [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr handle);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr handle, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr handle, uint message, IntPtr wparam, string text);
    static int Main(string[] args) {
        Type host = Assembly.LoadFile(Path.GetFullPath(args[0])).GetType("MediaDockHost");
        Exception failure = null;
        bool cancel = args.Length < 2;
        var automation = new Thread(() => {
            try {
                AutomationElement dialog = null;
                IntPtr dialogHandle = IntPtr.Zero;
                for (int i = 0; i < 120; i++) {
                    IntPtr found = IntPtr.Zero;
                    EnumWindows((handle, param) => {
                        uint pid; GetWindowThreadProcessId(handle, out pid);
                        if (pid != Process.GetCurrentProcess().Id) return true;
                        var title = new StringBuilder(256); var cls = new StringBuilder(256);
                        GetWindowText(handle, title, 256); GetClassName(handle, cls, 256);
                        if (title.ToString().Contains("MediaDock") && cls.ToString() == "#32770") { found = handle; return false; }
                        return true;
                    }, IntPtr.Zero);
                    if (found != IntPtr.Zero) { dialogHandle = found; dialog = AutomationElement.FromHandle(found); }
                    if (dialog != null) break; Thread.Sleep(100);
                }
                if (dialog == null) throw new Exception("Save dialog did not appear");
                if (cancel) { PostMessage(dialogHandle, 0x10, IntPtr.Zero, IntPtr.Zero); return; }
                if (!cancel) {
                    var filename = dialog.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.AutomationIdProperty, "1001"));
                    if (filename == null) {
                        IntPtr edit = IntPtr.Zero;
                        EnumChildWindows(dialogHandle, (handle, param) => {
                            var cls = new StringBuilder(256); var text = new StringBuilder(256);
                            GetClassName(handle, cls, 256); GetWindowText(handle, text, 256);
                            if (cls.ToString() == "Edit" && text.ToString().Contains("MediaDock save test")) { edit = handle; return false; }
                            return true;
                        }, IntPtr.Zero);
                        if (edit == IntPtr.Zero) throw new Exception("File name field not found");
                        SendMessage(edit, 0x0c, IntPtr.Zero, Path.GetFullPath(args[1]));
                        PostMessage(dialogHandle, 0x111, new IntPtr(1), IntPtr.Zero); return;
                    }
                    object pattern;
                    if (!filename.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) {
                        filename = filename.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit));
                        if (filename == null || !filename.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) throw new Exception("File name field is not editable");
                    }
                    ((ValuePattern)pattern).SetValue(Path.GetFullPath(args[1]));
                }
                var button = dialog.FindFirst(TreeScope.Descendants, new AndCondition(new PropertyCondition(AutomationElement.AutomationIdProperty, cancel ? "2" : "1"), new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button)));
                if (button == null) throw new Exception("Save/Cancel button not found");
                ((InvokePattern)button.GetCurrentPattern(InvokePattern.Pattern)).Invoke();
            } catch (Exception error) { failure = error; Console.Error.WriteLine(error); }
        });
        automation.IsBackground = true; automation.SetApartmentState(ApartmentState.STA); automation.Start();
        object result = host.GetMethod("ChooseSavePath", BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, new object[] { "MediaDock save test", "mp4" });
        automation.Join();
        if (failure != null) return 1;
        if (cancel && result != null || !cancel && !String.Equals((string)result, Path.GetFullPath(args[1]), StringComparison.OrdinalIgnoreCase)) return 1;
        Console.WriteLine(cancel ? "PASS: native Windows SaveFileDialog cancellation." : "PASS: native Windows SaveFileDialog selected path.");
        return 0;
    }
}
