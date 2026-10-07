import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
const native = path.resolve('test-output/runtime/native');
const results = [];
for (const [site, url] of [['YouTube', 'https://www.youtube.com/watch?v=YE7VzlLtp-4'], ['Bilibili', 'https://www.bilibili.com/video/BV15z4y1U7HS/']]) {
  const file = path.resolve(`test-output/saved/${site}-360p.mp4`);
  const proc = spawn(path.join(native, 'NativeDownloadHarness.exe'), [path.join(native, 'MediaDockHost.exe'), file, 'video', url, '360'], {windowsHide: true});
  let buffer = Buffer.alloc(0); let last;
  proc.stdout.on('data', data => {
    buffer = Buffer.concat([buffer, data]);
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
      const size = buffer.readUInt32LE(0); last = JSON.parse(buffer.subarray(4, size + 4).toString()); buffer = buffer.subarray(size + 4);
      if (['failed', 'completed', 'processing'].includes(last.job?.status)) console.log(site, last.job.status, last.job.error || '');
    }
  });
  proc.stderr.on('data', data => process.stderr.write(data));
  const code = await new Promise(resolve => proc.on('exit', resolve));
  if (code !== 0 || last?.job?.status !== 'completed') { results.push({site, ok: false, error: last?.job?.error}); continue; }
  assert.equal(last.job.verification.fullDecode, true); assert.equal(last.job.verification.identityMatched, true); assert.equal(last.job.verification.durationMatched, true);
  const probe = JSON.parse(execFileSync(path.join(native, 'tools/ffprobe.exe'), ['-v', 'error', '-show_entries', 'stream=codec_type,height:format=duration,size', '-of', 'json', file]));
  assert.ok(probe.streams.some(s => s.codec_type === 'audio')); assert.ok(probe.streams.some(s => s.codec_type === 'video' && s.height <= 360));
  results.push({site, ok: true, streams: probe.streams, duration: probe.format.duration, size: probe.format.size, verification: last.job.verification});
}
fs.writeFileSync('test-output/platform-downloads.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
if (results.some(r => !r.ok)) process.exitCode = 1;
