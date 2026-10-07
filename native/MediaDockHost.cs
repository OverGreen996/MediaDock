using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class MediaDockHost {
    static readonly string Root = AppDomain.CurrentDomain.BaseDirectory;
    static readonly string Tools = Path.Combine(Root, "tools");
    static readonly string CookieRoot = Path.Combine(Root, "private");
    static readonly string Downloads = GetDownloads();
    static readonly object OutputLock = new object();
    static readonly object JobLock = new object();
    static readonly Dictionary<string, Job> Jobs = new Dictionary<string, Job>();
    static readonly SemaphoreSlim ProbeSlots = new SemaphoreSlim(2);
    static readonly SemaphoreSlim DialogSlot = new SemaphoreSlim(1);
    static readonly SemaphoreSlim VerifySlot = new SemaphoreSlim(1);
    static readonly Stream Output = Console.OpenStandardOutput();
    static IntPtr processJob;
    static volatile bool closing;
    const double DurationTolerance = 2;
    static JavaScriptSerializer Json() { return new JavaScriptSerializer { MaxJsonLength = 16000000, RecursionLimit = 120 }; }
    sealed class Job { public string Id, Title, CookiePath, Destination; public Process Process; public bool Cancelled, IdentityMatched; public object Verification; }
    static Dictionary<string, object> Obj(params object[] pairs) { var d = new Dictionary<string, object>(); for (int i = 0; i < pairs.Length; i += 2) d[(string)pairs[i]] = pairs[i + 1]; return d; }
    static string Text(Dictionary<string, object> d, string key, string fallback = "") { object v; return d.TryGetValue(key, out v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : fallback; }
    static bool Flag(Dictionary<string, object> d, string key) { object v; return d.TryGetValue(key, out v) && v is bool && (bool)v; }
    static double Number(Dictionary<string, object> d, string key) { double n; return Double.TryParse(Text(d, key), NumberStyles.Float, CultureInfo.InvariantCulture, out n) ? n : 0; }
    static string Short(string s, int limit) { return s.Length > limit ? s.Substring(0, limit) : s; }

    static string GetDownloads() {
        IntPtr path;
        Guid id = new Guid("374DE290-123F-4565-9164-39C4925E467B");
        if (SHGetKnownFolderPath(ref id, 0, IntPtr.Zero, out path) == 0) {
            try { return Path.Combine(Marshal.PtrToStringUni(path), "MediaDock"); } finally { Marshal.FreeCoTaskMem(path); }
        }
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads", "MediaDock");
    }
    [DllImport("shell32.dll")] static extern int SHGetKnownFolderPath(ref Guid rfid, uint flags, IntPtr token, out IntPtr path);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [StructLayout(LayoutKind.Sequential)] struct BasicLimit { public long Time1, Time2; public uint Flags; public UIntPtr MinWorking, MaxWorking; public uint ActiveProcess; public UIntPtr Affinity; public uint Priority, Scheduling; }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit { public BasicLimit Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob; }
    static void InitProcessJob() {
        processJob = CreateJobObject(IntPtr.Zero, null);
        if (processJob == IntPtr.Zero) throw new IOException("無法建立程序管理。請重試。");
        var limits = new ExtendedLimit(); limits.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE: also terminate FFmpeg/Deno children.
        int size = Marshal.SizeOf(limits); IntPtr ptr = Marshal.AllocHGlobal(size);
        try { Marshal.StructureToPtr(limits, ptr, false); if (!SetInformationJobObject(processJob, 9, ptr, (uint)size)) throw new IOException("無法設定程序管理。"); }
        finally { Marshal.FreeHGlobal(ptr); }
    }
    static void InitPrivate() {
        Directory.CreateDirectory(CookieRoot);
        var security = new DirectorySecurity(); security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User, FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        Directory.SetAccessControl(CookieRoot, security);
        foreach (string file in Directory.GetFiles(CookieRoot, "*.cookies.txt")) {
            int pid;
            if (!Int32.TryParse(Path.GetFileName(file).Split('-')[0], out pid)) { Delete(file); continue; }
            try { using (Process prior = Process.GetProcessById(pid)) { if (prior.HasExited) Delete(file); } }
            catch (ArgumentException) { Delete(file); }
        }
    }
    public static int Main(string[] args) {
        try {
            InitProcessJob(); InitPrivate();
            Stream input = Console.OpenStandardInput();
            while (true) {
                byte[] header = Read(input, 4); if (header == null) break;
                uint length = BitConverter.ToUInt32(header, 0);
                if (length == 0 || length > 1024 * 1024) break;
                byte[] body = Read(input, (int)length); if (body == null) break;
                var request = Json().Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(body));
                ThreadPool.QueueUserWorkItem(_ => Handle(request));
            }
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
        finally {
            closing = true;
            if (processJob != IntPtr.Zero) CloseHandle(processJob);
            lock (JobLock) { foreach (Job job in Jobs.Values) Delete(job.CookiePath); }
        }
    }
    static byte[] Read(Stream stream, int size) {
        byte[] data = new byte[size]; int at = 0;
        while (at < size) { int n = stream.Read(data, at, size - at); if (n == 0) return null; at += n; }
        return data;
    }
    static void Send(object value) {
        if (closing) return;
        byte[] data = Encoding.UTF8.GetBytes(Json().Serialize(value));
        if (data.Length > 900000) throw new IOException("回應太大");
        lock (OutputLock) { if (closing) return; Output.Write(BitConverter.GetBytes(data.Length), 0, 4); Output.Write(data, 0, data.Length); Output.Flush(); }
    }
    static void Handle(Dictionary<string, object> request) {
        string id = Text(request, "id");
        try {
            object result;
            switch (Text(request, "action")) {
                case "status":
                    var missing = new [] { "yt-dlp.exe", "ffmpeg.exe", "ffprobe.exe", "deno.exe" }.Where(x => !File.Exists(Path.Combine(Tools, x))).ToArray();
                    result = Obj("ready", missing.Length == 0, "missing", missing, "downloads", Downloads, "version", "0.2.1"); break;
                case "probe": result = Probe(request); break;
                case "start": result = Start(request); break;
                case "cancel": result = Cancel(Text(request, "jobId")); break;
                case "folder":
                    Directory.CreateDirectory(Downloads);
                    Process.Start(new ProcessStartInfo("explorer.exe", Quote(Downloads)) { UseShellExecute = true }); result = Obj(); break;
                case "reveal":
                    string path = Text(request, "path");
                    if (!Path.IsPathRooted(path) || !File.Exists(path) || !new [] { ".mp4", ".mkv", ".mp3", ".webm", ".m4a", ".mov", ".ogg", ".wav" }.Contains(Path.GetExtension(path).ToLowerInvariant())) throw new ArgumentException("找不到已下載檔案。");
                    Process.Start(new ProcessStartInfo("explorer.exe", "/select," + Quote(path)) { UseShellExecute = true }); result = Obj(); break;
                default: throw new ArgumentException("不支援的操作");
            }
            Send(Obj("id", id, "ok", true, "data", result));
        } catch (Exception error) { Send(Obj("id", id, "ok", false, "error", Short(error.Message, 2000))); }
    }
    static string Url(string value) {
        Uri uri;
        if (!Uri.TryCreate(value, UriKind.Absolute, out uri) || (uri.Scheme != "https" && uri.Scheme != "http") || uri.UserInfo.Length != 0 || uri.HostNameType != UriHostNameType.Dns || uri.IsLoopback || uri.Host.EndsWith(".local", StringComparison.OrdinalIgnoreCase) || uri.Host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase) || uri.Host.EndsWith(".internal", StringComparison.OrdinalIgnoreCase) || value.Length > 16000 || value.IndexOfAny(new [] { '\r', '\n', '\0' }) >= 0) throw new ArgumentException("只支援公開網站 HTTP／HTTPS 網址。");
        return uri.AbsoluteUri;
    }
    // Windows CommandLineToArgvW escaping; never shell-concatenate untrusted arguments.
    internal static string Quote(string value) {
        var output = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { output.Append('\\', slashes * 2 + 1).Append(c); slashes = 0; continue; }
            output.Append('\\', slashes).Append(c); slashes = 0;
        }
        output.Append('\\', slashes * 2).Append('"'); return output.ToString();
    }
    static Process Spawn(List<string> arguments, string tool = "yt-dlp.exe") {
        string exe = Path.Combine(Tools, tool);
        if (!File.Exists(exe)) throw new FileNotFoundException("請先執行 Install.cmd 安裝本機下載工具。");
        var start = new ProcessStartInfo(exe, String.Join(" ", arguments.Select(Quote))) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, WorkingDirectory = Root };
        start.EnvironmentVariables["PATH"] = Tools + ";" + Environment.GetEnvironmentVariable("PATH");
        var process = new Process { StartInfo = start };
        process.Start();
        process.StandardInput.Close(); // Do not inherit or consume the browser's native-messaging pipe.
        if (!AssignProcessToJobObject(processJob, process.Handle)) { Kill(process); throw new IOException("無法管理下載程序，請重啟瀏覽器後重試。"); }
        return process;
    }
    static List<string> Common(Dictionary<string, object> request, out string cookiePath) {
        string url = Url(Text(request, "url"));
        var result = new List<string> { "--ignore-config", "--no-plugin-dirs", "--no-playlist", "--encoding", "utf-8", "--socket-timeout", "20", "--retries", "3", "--ffmpeg-location", Tools, "--js-runtimes", "deno:" + Path.Combine(Tools, "deno.exe") };
        cookiePath = Cookies(request, url);
        if (cookiePath != null) { result.Add("--cookies"); result.Add(cookiePath); }
        string agent = Text(request, "userAgent");
        if (agent.Length > 0 && agent.Length < 500 && agent.IndexOfAny(new [] { '\r', '\n', '\0' }) < 0) { result.Add("--user-agent"); result.Add(agent); }
        string referer = Text(request, "referer");
        if (referer.Length > 0) { result.Add("--referer"); result.Add(Url(referer)); }
        return result;
    }
    static string Cookies(Dictionary<string, object> request, string url) {
        object raw;
        if (!request.TryGetValue("cookies", out raw) || !(raw is IList) || ((IList)raw).Count == 0) return null;
        string host = new Uri(url).Host;
        if (host != "bilibili.com" && !host.EndsWith(".bilibili.com", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Cookie 僅支援 Bilibili 影片頁。");
        if (((IList)raw).Count > 300) throw new ArgumentException("Cookie 數量超過限制。");
        var output = new StringBuilder("# Netscape HTTP Cookie File\n");
        foreach (object item in (IList)raw) {
            var c = item as Dictionary<string, object>; if (c == null) continue;
            string domain = Text(c, "domain").ToLowerInvariant();
            if (domain.TrimStart('.') != "bilibili.com" && !domain.TrimStart('.').EndsWith(".bilibili.com")) throw new ArgumentException("Cookie 網域不符合。");
            string[] fields = { domain, domain.StartsWith(".") ? "TRUE" : "FALSE", Text(c, "path", "/"), Flag(c, "secure") ? "TRUE" : "FALSE", Math.Max(0, (long)Number(c, "expires")).ToString(CultureInfo.InvariantCulture), Text(c, "name"), Text(c, "value") };
            if (fields.Any(x => x.Length > 20000 || x.IndexOfAny(new [] { '\r', '\n', '\t', '\0' }) >= 0)) throw new ArgumentException("Cookie 格式不符合。");
            if (Flag(c, "httpOnly")) fields[0] = "#HttpOnly_" + fields[0];
            output.AppendLine(String.Join("\t", fields));
        }
        string path = Path.Combine(CookieRoot, Process.GetCurrentProcess().Id + "-" + Guid.NewGuid().ToString("N") + ".cookies.txt");
        File.WriteAllText(path, output.ToString(), new UTF8Encoding(false)); return path;
    }
    static object Probe(Dictionary<string, object> request, Job owner = null) {
        if (!ProbeSlots.Wait(0)) throw new InvalidOperationException("已有兩個解析進行中，請稍候再試。");
        string cookie = null;
        try {
            var args = Common(request, out cookie); args.AddRange(new [] { "--dump-single-json", "--skip-download", "--", Url(Text(request, "url")) });
            using (Process p = Spawn(args)) {
                if (owner != null) lock (JobLock) { owner.Process = p; if (owner.Cancelled || closing) { Kill(p); throw new OperationCanceledException(); } }
                var stdout = new StringBuilder(); var stderr = new StringBuilder(); object capture = new object(); bool tooLarge = false;
                p.OutputDataReceived += (_, e) => { if (e.Data == null) return; lock (capture) { if (stdout.Length + e.Data.Length > 15000000) tooLarge = true; else stdout.AppendLine(e.Data); } };
                p.ErrorDataReceived += (_, e) => { if (e.Data == null) return; lock (capture) { stderr.AppendLine(e.Data); if (stderr.Length > 8000) stderr.Remove(0, stderr.Length - 8000); } };
                p.BeginOutputReadLine(); p.BeginErrorReadLine();
                if (!p.WaitForExit(120000)) { Kill(p); throw new TimeoutException("影片解析超過兩分鐘，請重試或更新工具。"); }
                p.WaitForExit();
                if (owner != null && owner.Cancelled) throw new OperationCanceledException();
                if (p.ExitCode != 0) throw new IOException(FriendlyError(stderr.ToString()));
                if (tooLarge) throw new IOException("影片資訊超過大小限制，請使用單支影片網址。");
                var data = Json().Deserialize<Dictionary<string, object>>(stdout.ToString());
                object formatsRaw; var heights = new SortedSet<int>(); var widths = new Dictionary<int, int>();
                if (data.TryGetValue("formats", out formatsRaw) && formatsRaw is IList) foreach (object format in (IList)formatsRaw) {
                    var f = format as Dictionary<string, object>;
                    if (f == null || Text(f, "vcodec") == "none" || Flag(f, "has_drm")) continue;
                    int height = (int)Number(f, "height"); if (height > 0) { heights.Add(height); widths[height] = Math.Max(widths.ContainsKey(height) ? widths[height] : 0, (int)Number(f, "width")); }
                }
                return Obj("title", Short(Text(data, "title", "影片"), 500), "uploader", Short(Text(data, "uploader"), 200), "duration", Number(data, "duration"), "heights", heights.Reverse().ToArray(), "qualities", heights.Reverse().Select(h => Obj("height", h, "width", widths[h])).ToArray(), "live", Flag(data, "is_live"), "identity", Obj("id", Text(data, "id"), "extractor_key", Text(data, "extractor_key"), "webpage_url", Text(data, "webpage_url"), "sourceUrl", Url(Text(request, "url")), "duration", Number(data, "duration")));
            }
        } finally { Delete(cookie); ProbeSlots.Release(); }
    }
    static object Start(Dictionary<string, object> request) {
        string id = Text(request, "jobId"); Guid parsed;
        if (!Guid.TryParse(id, out parsed)) throw new ArgumentException("下載識別碼錯誤。");
        Url(Text(request, "url"));
        string mode = Text(request, "mode", "video"), quality = Text(request, "quality", "best"), container = Text(request, "container", "mp4");
        if (mode != "video" && mode != "audio") throw new ArgumentException("下載模式錯誤。");
        int height;
        if (quality != "best" && (!Int32.TryParse(quality, out height) || height < 100 || height > 16384)) throw new ArgumentException("畫質選項錯誤。");
        if (container != "mp4" && container != "mkv") throw new ArgumentException("格式選項錯誤。");
        foreach (string tool in new [] { "yt-dlp.exe", "ffmpeg.exe", "ffprobe.exe", "deno.exe" }) if (!File.Exists(Path.Combine(Tools, tool))) throw new FileNotFoundException("缺少 " + tool + "，請執行 Install.cmd。");
        var job = new Job { Id = id, Title = Short(Text(request, "title", "影片"), 200) };
        lock (JobLock) {
            if (Jobs.Count >= 2) throw new InvalidOperationException("同時最多下載兩支影片，請等目前下載完成。");
            if (Jobs.ContainsKey(id)) throw new ArgumentException("重複下載識別碼。"); Jobs.Add(id, job);
        }
        try {
            job.Destination = ChooseSavePath(job.Title, mode == "audio" ? "mp3" : container);
            if (job.Destination == null) { lock (JobLock) Jobs.Remove(id); return Obj("id", id, "cancelled", true); }
            if (closing) throw new OperationCanceledException();
        } catch { lock (JobLock) Jobs.Remove(id); throw; }
        ThreadPool.QueueUserWorkItem(_ => Download(job, request, mode, quality, container));
        return Obj("id", id);
    }
    static string ChooseSavePath(string title, string extension) {
        if (!DialogSlot.Wait(0)) throw new InvalidOperationException("請先完成目前的儲存位置選擇。");
        try {
            string chosen = null; Exception failure = null;
            var thread = new Thread(() => {
                try {
                    string name = Regex.Replace(title, "[<>:\"/\\\\|?*\\x00-\\x1f]", "_").TrimEnd('.', ' ');
                    if (name.Length == 0) name = "影片";
                    if (Regex.IsMatch(name, @"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", RegexOptions.IgnoreCase)) name = "_" + name;
                    Directory.CreateDirectory(Downloads);
                    using (var owner = new Form { TopMost = true, ShowInTaskbar = false, Opacity = 0, Width = 1, Height = 1, StartPosition = FormStartPosition.CenterScreen })
                    using (var dialog = new SaveFileDialog { Title = "MediaDock — 選擇儲存位置", InitialDirectory = Downloads, FileName = Short(name, 100) + "." + extension, DefaultExt = extension, Filter = extension.ToUpperInvariant() + " 媒體檔案|*." + extension, AddExtension = true, OverwritePrompt = true, CheckPathExists = true, RestoreDirectory = true }) {
                        owner.Show(); owner.Activate();
                        if (dialog.ShowDialog(owner) == DialogResult.OK) {
                            chosen = Path.GetFullPath(dialog.FileName);
                            if (Path.GetExtension(chosen).ToLowerInvariant() != "." + extension) throw new ArgumentException("請使用 ." + extension + " 副檔名。");
                        }
                    }
                } catch (Exception error) { failure = error; }
            });
            thread.SetApartmentState(ApartmentState.STA); thread.Start(); thread.Join();
            if (failure != null) throw failure;
            return chosen;
        } finally { DialogSlot.Release(); }
    }
    static void Event(Job job, string status, double progress = 0, string error = "", string speed = "") {
        Send(Obj("event", "job", "job", Obj("id", job.Id, "engine", "native", "title", job.Title, "status", status, "progress", progress, "error", error, "speed", speed, "path", job.Destination, "verification", job.Verification)));
    }
    static void CheckIdentity(Dictionary<string, object> expected, Dictionary<string, object> actual, string source) {
        if (expected == null || actual == null || Text(expected, "sourceUrl") != Url(source) || Text(expected, "id").Length == 0 || Text(actual, "id") != Text(expected, "id") || Text(actual, "extractor_key") != Text(expected, "extractor_key") || Text(actual, "webpage_url") != Text(expected, "webpage_url"))
            throw new IOException("影片來源或分集與解析結果不一致，已停止儲存。請重新掃描。");
        double duration = Number(expected, "duration"), current = Number(actual, "duration");
        if (duration > 0 && (current <= 0 || Math.Abs(current - duration) > DurationTolerance)) throw new IOException("來源片長已改變，請重新掃描。");
    }
    static Dictionary<string, object> ReadMedia(Job job, string file) {
            var output = new StringBuilder(); var errors = new StringBuilder(); object capture = new object();
            var probeArgs = new List<string> { "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "stream=codec_type,codec_name,pix_fmt,width,height,duration:format=duration,format_name", "-of", "json", file };
            lock (JobLock) { if (job.Cancelled || closing) throw new OperationCanceledException(); job.Process = Spawn(probeArgs, "ffprobe.exe"); }
            using (Process p = job.Process) {
                p.OutputDataReceived += (_, e) => { if (e.Data != null) lock (capture) { if (output.Length < 100000) output.AppendLine(e.Data); } };
                p.ErrorDataReceived += (_, e) => { if (e.Data != null) lock (capture) { if (errors.Length < 8000) errors.AppendLine(e.Data); } };
                p.BeginOutputReadLine(); p.BeginErrorReadLine();
                if (!p.WaitForExit(60000)) { Kill(p); throw new IOException("媒體檢查逾時，未儲存檔案。"); } p.WaitForExit();
                if (job.Cancelled) throw new OperationCanceledException();
                if (p.ExitCode != 0 || errors.Length > 0) throw new IOException("檔案無法解析，可能是錯誤頁面或不完整媒體。未儲存檔案。");
            }
            return Json().Deserialize<Dictionary<string, object>>(output.ToString());
    }
    static void CompatibleMp4(Job job, string file, double duration) {
        string converted = file + ".compatible.mp4"; var errors = new StringBuilder(); object capture = new object();
        try {
            Event(job, "processing");
            var args = new List<string> { "-hide_banner", "-nostdin", "-v", "error", "-xerror", "-err_detect", "explode", "-protocol_whitelist", "file,pipe", "-threads", "2", "-i", file, "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-threads", "2", "-filter_threads", "1", "-movflags", "+faststart", "-n", converted };
            lock (JobLock) { if (job.Cancelled || closing) throw new OperationCanceledException(); job.Process = Spawn(args, "ffmpeg.exe"); }
            using (Process p = job.Process) {
                try { p.PriorityClass = ProcessPriorityClass.BelowNormal; } catch (System.ComponentModel.Win32Exception) { }
                p.OutputDataReceived += (_, e) => { };
                p.ErrorDataReceived += (_, e) => { if (e.Data != null) lock (capture) { if (errors.Length < 8000) errors.AppendLine(e.Data); } };
                p.BeginOutputReadLine(); p.BeginErrorReadLine();
                int timeout = (int)Math.Min(86400000, Math.Max(120000, duration * 30000 + 60000));
                if (!p.WaitForExit(timeout)) { Kill(p); throw new IOException("MP4 相容格式轉換逾時，未儲存檔案。"); } p.WaitForExit();
                if (job.Cancelled) throw new OperationCanceledException();
                if (p.ExitCode != 0 || errors.Length > 0 || !File.Exists(converted)) throw new IOException("MP4 相容格式轉換失敗，未儲存檔案。");
            }
            File.Replace(converted, file, null);
        } finally { Delete(converted); }
    }
    static object VerifyFile(Job job, string file, string mode, string quality, Dictionary<string, object> metadata) {
        while (!VerifySlot.Wait(250)) { if (job.Cancelled || closing) throw new OperationCanceledException(); }
        try {
            if (job.Cancelled || closing) throw new OperationCanceledException();
            Event(job, "verifying");
            var data = ReadMedia(job, file);
            var format = data["format"] as Dictionary<string, object>; var streams = (data["streams"] as IList).Cast<object>().OfType<Dictionary<string, object>>().ToArray();
            var video = streams.Where(s => Text(s, "codec_type") == "video").ToArray(); var audio = streams.Where(s => Text(s, "codec_type") == "audio").ToArray();
            double duration = Number(format, "duration"), expectedDuration = Number(metadata, "duration");
            if (duration <= 0 || new FileInfo(file).Length == 0) throw new IOException("媒體片長無效，未儲存檔案。");
            if (mode == "audio" ? audio.Length == 0 : video.Length == 0) throw new IOException("缺少要求的影音串流，未儲存檔案。");
            if (Text(metadata, "acodec") != "none" && Text(metadata, "acodec").Length > 0 && audio.Length == 0) throw new IOException("原影片有聲音，但下載檔缺少音訊，未儲存檔案。");
            if (expectedDuration > 0 && Math.Abs(duration - expectedDuration) > DurationTolerance) throw new IOException("下載片長與來源不符，可能只下載了部分影片，未儲存檔案。");
            int maxHeight; if (mode != "audio" && Int32.TryParse(quality, out maxHeight) && video.Any(s => Number(s, "height") != maxHeight)) throw new IOException("來源無法提供所選畫質，未儲存檔案。請重新掃描或選擇其他畫質。");
            bool converted = false;
            if (mode == "video" && Path.GetExtension(file).Equals(".mp4", StringComparison.OrdinalIgnoreCase) && (video.Any(s => Text(s, "codec_name") != "h264" || Text(s, "pix_fmt") != "yuv420p") || audio.Any(s => Text(s, "codec_name") != "aac"))) {
                CompatibleMp4(job, file, duration); converted = true; data = ReadMedia(job, file);
                streams = (data["streams"] as IList).Cast<object>().OfType<Dictionary<string, object>>().ToArray();
                double finalDuration = Number(data["format"] as Dictionary<string, object>, "duration");
                if (Math.Abs(finalDuration - duration) > DurationTolerance) throw new IOException("轉換後片長與來源不符，未儲存檔案。"); duration = finalDuration;
            }
            Event(job, "verifying"); var errors = new StringBuilder(); object capture = new object(); double decodedSeconds = 0; long frames = 0;
            var decodeArgs = new List<string> { "-hide_banner", "-nostdin", "-v", "error", "-xerror", "-err_detect", "explode", "-protocol_whitelist", "file,pipe", "-threads", "2", "-i", file, "-map", "0:v?", "-map", "0:a?", "-threads", "2", "-filter_threads", "1", "-filter_complex_threads", "1", "-progress", "pipe:1", "-nostats", "-f", "null", "-" };
            lock (JobLock) { if (job.Cancelled || closing) throw new OperationCanceledException(); job.Process = Spawn(decodeArgs, "ffmpeg.exe"); }
            using (Process p = job.Process) {
                try { p.PriorityClass = ProcessPriorityClass.BelowNormal; } catch (System.ComponentModel.Win32Exception) { }
                p.OutputDataReceived += (_, e) => {
                    if (e.Data == null) return;
                    if (e.Data.StartsWith("frame=")) Int64.TryParse(e.Data.Substring(6).Trim(), out frames);
                    if (e.Data.StartsWith("out_time_us=")) { double value; if (Double.TryParse(e.Data.Substring(12), NumberStyles.Float, CultureInfo.InvariantCulture, out value)) { decodedSeconds = Math.Max(decodedSeconds, value / 1000000); if (!job.Cancelled) Event(job, "verifying", Math.Min(99, decodedSeconds / duration * 100)); } }
                };
                p.ErrorDataReceived += (_, e) => { if (e.Data != null) lock (capture) { if (errors.Length < 8000) errors.AppendLine(e.Data); } };
                p.BeginOutputReadLine(); p.BeginErrorReadLine();
                int timeout = (int)Math.Min(86400000, Math.Max(120000, duration * 10000 + 60000));
                if (!p.WaitForExit(timeout)) { Kill(p); throw new IOException("完整解碼驗證逾時，未儲存檔案。"); } p.WaitForExit();
                if (job.Cancelled) throw new OperationCanceledException();
                if (p.ExitCode != 0 || errors.Length > 0 || mode != "audio" && frames == 0 || decodedSeconds < duration - DurationTolerance) throw new IOException("影音完整解碼未通過，檔案可能損壞或截斷，未儲存檔案。");
            }
            string hash; using (var sha = System.Security.Cryptography.SHA256.Create()) using (var input = File.OpenRead(file)) hash = BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
            return Obj("fullDecode", true, "identityMatched", job.IdentityMatched, "sourceId", Text(metadata, "id"), "title", Text(metadata, "title"), "sourceUrl", Text(metadata, "sourceUrl"), "duration", duration, "expectedDuration", expectedDuration, "durationMatched", expectedDuration > 0, "videoWidth", streams.Where(s => Text(s, "codec_type") == "video").Select(s => (int)Number(s, "width")).DefaultIfEmpty(0).Max(), "videoHeight", streams.Where(s => Text(s, "codec_type") == "video").Select(s => (int)Number(s, "height")).DefaultIfEmpty(0).Max(), "videoFrames", frames, "decodedSeconds", decodedSeconds, "codecs", streams.Where(s => Text(s, "codec_type") == "video" || Text(s, "codec_type") == "audio").Select(s => Text(s, "codec_name")).ToArray(), "compatibilityConverted", converted, "sha256", hash);
        } finally { VerifySlot.Release(); }
    }
    static void Download(Job job, Dictionary<string, object> request, string mode, string quality, string container) {
        string stage = null;
        try {
            object rawIdentity; var identity = request.TryGetValue("expected", out rawIdentity) ? rawIdentity as Dictionary<string, object> : null;
            if (identity == null) { Event(job, "processing"); identity = ((Dictionary<string, object>)Probe(request, job))["identity"] as Dictionary<string, object>; }
            string destinationFolder = Path.GetDirectoryName(job.Destination);
            stage = Path.Combine(destinationFolder, ".MediaDock-tmp-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(stage); File.SetAttributes(stage, FileAttributes.Hidden);
            var args = Common(request, out job.CookiePath);
            args.AddRange(new [] { "--no-simulate", "--check-formats", "--print", "before_dl:MEDIADOCK_META:%(.{id,extractor_key,webpage_url,original_url,title,duration,acodec,vcodec,height})j" });
            args.AddRange(new [] { "--windows-filenames", "--no-overwrites", "--newline", "--progress", "--progress-delta", "1", "--paths", stage, "--output", "media.%(ext)s", "--match-filters", "!is_live", "--print", "after_move:MEDIADOCK_FILE:%(filepath)j", "--progress-template", "download:MEDIADOCK_PROGRESS:%(progress)j", "--progress-template", "postprocess:MEDIADOCK_PROCESS:%(progress.status)s" });
            if (mode == "audio") args.AddRange(new [] { "-f", "ba/b", "--extract-audio", "--audio-format", "mp3", "--audio-quality", "0" });
            else {
                string cap = quality == "best" ? "" : "[height<=" + quality + "]";
                args.AddRange(new [] { "-f", "bv*" + cap + "+ba/b" + cap, "--merge-output-format", container, "--remux-video", container });
                if (container == "mp4") args.AddRange(new [] { "-S", "res,vcodec:h264,acodec:aac" });
            }
            if (Flag(request, "subtitles")) args.AddRange(new [] { "--write-subs", "--write-auto-subs", "--sub-langs", "zh.*,en.*", "--sub-format", "srt/best", "--convert-subs", "srt" });
            args.Add("--"); args.Add(Url(Text(request, "url")));
            string file = null; Dictionary<string, object> metadata = null; string errorText = ""; object errorLock = new object();
            lock (JobLock) { if (job.Cancelled || closing) throw new OperationCanceledException(); job.Process = Spawn(args); }
            using (Process p = job.Process) {
                p.OutputDataReceived += (_, e) => {
                    if (e.Data == null || job.Cancelled || closing) return;
                    try {
                        if (e.Data.StartsWith("MEDIADOCK_PROGRESS:")) {
                            var progress = Json().Deserialize<Dictionary<string, object>>(e.Data.Substring(19));
                            double total = Number(progress, "total_bytes"); if (total == 0) total = Number(progress, "total_bytes_estimate");
                            double pct = total > 0 ? Math.Min(99, 100 * Number(progress, "downloaded_bytes") / total) : 0;
                            double speed = Number(progress, "speed");
                            Event(job, "downloading", pct, "", speed > 0 ? (speed / 1048576).ToString("0.0", CultureInfo.InvariantCulture) + " MB/s" : "");
                        } else if (e.Data.StartsWith("MEDIADOCK_PROCESS:")) Event(job, "processing", 99);
                        else if (e.Data.StartsWith("MEDIADOCK_FILE:")) file = Json().Deserialize<string>(e.Data.Substring(15));
                        else if (e.Data.StartsWith("MEDIADOCK_META:")) metadata = Json().Deserialize<Dictionary<string, object>>(e.Data.Substring(15));
                    } catch (ArgumentException) { /* malformed progress should not fail a completed download */ }
                    catch (InvalidOperationException) { /* malformed metadata is rejected before publishing */ }
                };
                p.ErrorDataReceived += (_, e) => { if (e.Data != null) lock (errorLock) { errorText += "\n" + e.Data; if (errorText.Length > 8000) errorText = errorText.Substring(errorText.Length - 8000); } };
                Event(job, "downloading"); p.BeginOutputReadLine(); p.BeginErrorReadLine(); p.WaitForExit();
                if (job.Cancelled) throw new OperationCanceledException();
                if (p.ExitCode != 0) throw new IOException(FriendlyError(errorText));
                string expected = Path.Combine(stage, "media" + Path.GetExtension(job.Destination));
                if (file == null || !String.Equals(Path.GetFullPath(file), expected, StringComparison.OrdinalIgnoreCase) || !File.Exists(file)) throw new IOException("未產生影片檔案。直播、DRM 或受限來源可能不支援。");
                CheckIdentity(identity, metadata, Text(request, "url"));
                job.IdentityMatched = true;
                metadata["sourceUrl"] = Url(Text(request, "url"));
                if (Number(identity, "duration") > 0) metadata["duration"] = Number(identity, "duration");
                job.Verification = VerifyFile(job, file, mode, quality, metadata);
                if (job.Cancelled || closing) throw new OperationCanceledException();
                if (File.Exists(job.Destination)) File.Replace(file, job.Destination, null);
                else File.Move(file, job.Destination);
                foreach (string subtitle in Directory.GetFiles(stage, "media.*.srt")) {
                    string suffix = Path.GetFileName(subtitle).Substring(5);
                    string target = Path.ChangeExtension(job.Destination, null) + suffix;
                    for (int n = 1; File.Exists(target); n++) target = Path.ChangeExtension(job.Destination, null) + " (" + n + ")" + suffix;
                    File.Move(subtitle, target);
                }
                Event(job, "completed", 100);
            }
        } catch (OperationCanceledException) { Event(job, "cancelled"); }
        catch (Exception error) { Event(job, job.Cancelled ? "cancelled" : "failed", 0, job.Cancelled ? "" : Short(error.Message, 1500)); }
        finally {
            lock (JobLock) { Jobs.Remove(job.Id); } Delete(job.CookiePath);
            if (stage != null) {
                string resolved = Path.GetFullPath(stage);
                string parent = Path.GetFullPath(Path.GetDirectoryName(job.Destination)).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                if (resolved.StartsWith(parent, StringComparison.OrdinalIgnoreCase) && Regex.IsMatch(Path.GetFileName(resolved), @"^\.MediaDock-tmp-[a-f0-9]{32}$")) {
                    try { Directory.Delete(resolved, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
                }
            }
        }
    }
    static object Cancel(string id) {
        Job job;
        lock (JobLock) { if (!Jobs.TryGetValue(id, out job)) return Obj(); job.Cancelled = true; }
        if (job.Process != null) Kill(job.Process);
        return Obj();
    }
    static void Kill(Process process) {
        try {
            if (process.HasExited) return;
            var info = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "taskkill.exe"), "/PID " + process.Id.ToString(CultureInfo.InvariantCulture) + " /T /F") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            using (var killer = Process.Start(info)) { killer.WaitForExit(5000); }
            if (!process.HasExited) process.Kill();
        } catch (InvalidOperationException) { } catch (System.ComponentModel.Win32Exception) { }
    }
    static void Delete(string path) { if (path == null) return; try { File.Delete(path); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
    static string FriendlyError(string error) {
        string detail = error.Split('\n').LastOrDefault(line => line.Contains("ERROR:")) ?? error.Trim();
        if (detail.Contains("Sign in") || detail.Contains("cookies") || detail.Contains("login")) return "網站要求登入或驗證。Bilibili 可勾選登入狀態；YouTube 請先更新工具。\n" + Short(detail, 900);
        if (detail.Contains("403")) return "來源拒絕存取（403）。請重新解析網址、確認帳號權限，或更新工具。\n" + Short(detail, 900);
        return "下載工具無法處理此來源。請更新工具或更換網址。\n" + Short(detail, 1200);
    }
}
