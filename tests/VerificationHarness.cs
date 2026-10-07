using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Web.Script.Serialization;
class VerificationHarness {
    static int Main(string[] args) {
        var json = new JavaScriptSerializer();
        Type host = Assembly.LoadFile(Path.GetFullPath(args[0])).GetType("MediaDockHost");
        var flags = BindingFlags.NonPublic | BindingFlags.Static;
        host.GetMethod("InitProcessJob", flags).Invoke(null, null);
        try {
            var metadata = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(args[2]));
            if (args.Length > 3 && args[3] == "identity") {
                var actual = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(args[1]));
                host.GetMethod("CheckIdentity", flags).Invoke(null, new object[] { metadata, actual, args.Length > 4 ? args[4] : metadata["sourceUrl"] });
            } else {
                Type type = host.GetNestedType("Job", BindingFlags.NonPublic); object job = Activator.CreateInstance(type, true);
                type.GetField("Id").SetValue(job, Guid.NewGuid().ToString()); type.GetField("Title").SetValue(job, "Verification test"); type.GetField("Destination").SetValue(job, Path.GetFullPath(args[1]));
                var proof = host.GetMethod("VerifyFile", flags).Invoke(null, new object[] { job, Path.GetFullPath(args[1]), args.Length > 3 ? args[3] : "video", args.Length > 5 ? args[5] : "best", metadata });
                Console.Error.WriteLine(json.Serialize(proof));
            }
            return 0;
        } catch (TargetInvocationException e) { Console.Error.WriteLine(e.InnerException.Message); return 1; }
    }
}
