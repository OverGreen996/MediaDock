import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root = path.resolve('test-output/runtime/native');
const files = path.resolve('test-output/saved'); fs.mkdirSync(files, {recursive: true});
async function download(mode, file, wrongId = '') {
  const args = [path.join(root, 'MediaDockHost.exe'), file, mode];
  if (wrongId) args.push('https://www.w3schools.com/html/mov_bbb.mp4', 'best', wrongId);
  const proc = spawn(path.join(root, 'NativeDownloadHarness.exe'), args, {windowsHide: true});
  let buffer = Buffer.alloc(0); const messages = [];
  proc.stdout.on('data', d => {
    buffer = Buffer.concat([buffer, d]);
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
      const size = buffer.readUInt32LE(0); messages.push(JSON.parse(buffer.subarray(4, size + 4).toString())); buffer = buffer.subarray(size + 4);
    }
  });
  proc.stderr.on('data', d => process.stderr.write(d));
  const code = await new Promise(resolve => proc.on('exit', resolve));
  assert.equal(code, 0, JSON.stringify(messages));
  if (wrongId) { assert.equal(messages.at(-1)?.job?.status, 'failed'); assert.match(messages.at(-1).job.error, /不一致/); return; }
  assert.equal(messages.at(-1)?.job?.status, 'completed', JSON.stringify(messages));
  assert.equal(messages.at(-1)?.job?.path, file);
  assert.equal(messages.at(-1)?.job?.verification?.fullDecode, true);
  assert.equal(messages.at(-1)?.job?.verification?.identityMatched, true);
  assert.ok(messages.some(m => m.job.status === 'verifying'));
  assert.ok(messages.some(m => m.job.status === 'downloading' && m.job.progress > 0));
  const media = JSON.parse(execFileSync(path.join(root, 'tools/ffprobe.exe'), ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'json', file]));
  assert.ok(Number(media.format.duration) > 9); assert.ok(Number(media.format.size) > 100000);
}
const mp4 = path.join(files, '測試 100% 媒體.mp4'); const mp3 = path.join(files, '測試 100% 媒體.mp3');
await download('video', mp4);
const before = createHash('sha256').update(fs.readFileSync(mp4)).digest('hex');
await download('audio', mp3);
assert.equal(createHash('sha256').update(fs.readFileSync(mp4)).digest('hex'), before, 'MP3 conversion must preserve an existing MP4 with the same basename');
await download('video', mp4, 'wrong-source-id');
assert.equal(createHash('sha256').update(fs.readFileSync(mp4)).digest('hex'), before, 'failed identity verification must not overwrite an existing destination');
assert.equal(fs.readdirSync(files).some(name => name.startsWith('.MediaDock-tmp-')), false);
console.log('PASS: real native MP4 download, MP3 conversion, destination with Unicode/space/%, matching progress/completion, intermediate cleanup, existing MP4 preservation.');
