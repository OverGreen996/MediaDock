// Exercises the production downloader with a pre-selected file path. The save dialog itself
// is tested separately; no test-only flags or paths are added to the shipping native host.
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
class NativeDownloadHarness {
    static int Main(string[] args) {
        Type host = Assembly.LoadFile(Path.GetFullPath(args[0])).GetType("MediaDockHost");
        var flags = BindingFlags.NonPublic | BindingFlags.Static;
        host.GetMethod("InitProcessJob", flags).Invoke(null, null);
        host.GetMethod("InitPrivate", flags).Invoke(null, null);
        Type jobType = host.GetNestedType("Job", BindingFlags.NonPublic);
        object job = Activator.CreateInstance(jobType, true);
        jobType.GetField("Id").SetValue(job, Guid.NewGuid().ToString());
        jobType.GetField("Title").SetValue(job, "Big Buck Bunny sample");
        jobType.GetField("Destination").SetValue(job, Path.GetFullPath(args[1]));
        string quality = args.Length > 4 ? args[4] : "best";
        var request = new Dictionary<string, object> { { "url", args.Length > 3 ? args[3] : "https://www.w3schools.com/html/mov_bbb.mp4" }, { "quality", quality }, { "mode", args.Length > 2 ? args[2] : "video" } };
        if (args.Length > 5 && args[5].Length > 0) request["expected"] = new Dictionary<string, object> { {"id", args[5]}, {"extractor_key", "Generic"}, {"webpage_url", request["url"]}, {"sourceUrl", request["url"]} };
        host.GetMethod("Download", flags).Invoke(null, new object[] { job, request, request["mode"], quality, args.Length > 6 ? args[6] : "mp4" });
        return File.Exists(args[1]) ? 0 : 1;
    }
}
