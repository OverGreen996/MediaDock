import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
const root = path.resolve('test-output/runtime/native');
const out = path.resolve('test-output/verification'); fs.mkdirSync(out, {recursive: true});
const sample = path.resolve('test-output/saved/測試 100% 媒體.mp4');
const duration = Number(JSON.parse(execFileSync(path.join(root, 'tools/ffprobe.exe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', sample])).format.duration);
const base = {id: 'mov_bbb', extractor_key: 'Generic', sourceUrl: 'https://www.w3schools.com/html/mov_bbb.mp4', webpage_url: 'https://www.w3schools.com/html/mov_bbb.mp4', duration, acodec: 'aac'};
const results = [];
async function check(name, file, metadata, mode, pass, match, quality = 'best') {
  const meta = path.join(out, 'expected.json'); fs.writeFileSync(meta, JSON.stringify(metadata));
  const proc = spawn(path.join(root, 'VerificationHarness.exe'), [path.join(root, 'MediaDockHost.exe'), file, meta, mode, base.sourceUrl, quality], {windowsHide: true});
  let stderr = ''; proc.stdout.resume(); proc.stderr.on('data', d => stderr += d.toString());
  const code = await new Promise(resolve => proc.on('exit', resolve));
  assert.equal(code === 0, pass, `${name}: ${stderr}`); if (match) assert.match(stderr, match);
  const proof = pass && mode !== 'identity' ? JSON.parse(stderr.trim()) : undefined;
  if (proof) { assert.equal(proof.fullDecode, true); assert.equal(proof.sha256.length, 64); }
  results.push({name, rejected: !pass, proof}); console.log('PASS:', name);
}
await check('valid MP4 full decode', sample, base, 'video', true);
await check('valid MP3 full decode', path.resolve('test-output/saved/測試 100% 媒體.mp3'), base, 'audio', true);
const html = path.join(out, 'login-page.mp4'); fs.writeFileSync(html, '<html>Login required</html>');
await check('HTML disguised as MP4 rejected', html, base, 'video', false);
const empty = path.join(out, 'empty.mp4'); fs.writeFileSync(empty, '');
await check('empty file rejected', empty, base, 'video', false);
await check('wrong duration rejected', sample, {...base, duration: 90}, 'video', false);
await check('different quality rejected', sample, base, 'video', false, undefined, '999');
await check('audio-only file rejected as video', path.resolve('test-output/saved/測試 100% 媒體.mp3'), base, 'video', false);
const bytes = fs.readFileSync(sample); const corrupt = path.join(out, 'corrupt-tail.mp4');
fs.writeFileSync(corrupt, bytes.subarray(0, Math.floor(bytes.length * .85)));
await check('truncated tail rejected', corrupt, base, 'video', false);
const brokenPackets = path.join(out, 'corrupt-packets.mp4'); const modified = Buffer.from(bytes); modified.fill(0, Math.floor(bytes.length * .8), Math.floor(bytes.length * .85)); fs.writeFileSync(brokenPackets, modified);
await check('intact container with damaged late packets rejected', brokenPackets, base, 'video', false);
const noAudio = path.join(out, 'silent.mp4');
execFileSync(path.join(root, 'tools/ffmpeg.exe'), ['-v', 'error', '-y', '-i', sample, '-map', '0:v:0', '-c', 'copy', '-an', noAudio]);
await check('missing expected audio rejected', noAudio, base, 'video', false);
const incompatible = path.join(out, 'mpeg4-video.mp4');
execFileSync(path.join(root, 'tools/ffmpeg.exe'), ['-v', 'error', '-y', '-i', sample, '-t', '2', '-c:v', 'mpeg4', '-c:a', 'aac', incompatible]);
await check('incompatible MP4 converted and fully decoded', incompatible, {...base, duration: 2}, 'video', true);
assert.equal(results.at(-1).proof.compatibilityConverted, true); assert.deepEqual(results.at(-1).proof.codecs, ['h264', 'aac']);
const actual = path.join(out, 'actual.json'); fs.writeFileSync(actual, JSON.stringify(base));
await check('matching source ID accepted', actual, base, 'identity', true);
await check('wrong video ID rejected', actual, {...base, id: 'another-video'}, 'identity', false);
await check('wrong Bilibili part URL rejected', actual, {...base, webpage_url: base.webpage_url + '?p=2'}, 'identity', false);
await check('wrong source URL rejected', actual, {...base, sourceUrl: 'https://example.com/a'}, 'identity', false);
for (const entry of JSON.parse(fs.readFileSync('test-output/platform-downloads.json'))) {
  if (!entry.ok) continue;
  const proof = entry.verification;
  await check(`saved ${entry.site} complete revalidation`, path.resolve(`test-output/saved/${entry.site}-360p.mp4`), {id: proof.sourceId, sourceUrl: proof.sourceUrl, title: proof.title, duration: proof.expectedDuration, acodec: 'aac'}, 'video', true, undefined, '360');
  assert.equal(results.at(-1).proof.sha256, proof.sha256, 'revalidated bytes must match the file whose source ID was checked during download');
}
const hqReport = 'test-output/high-quality/report.json';
if (fs.existsSync(hqReport)) for (const entry of JSON.parse(fs.readFileSync(hqReport)).downloads.filter(x => x.ok)) {
  const proof = entry.verification;
  const video = entry.media.streams.find(s => s.codec_type === 'video');
  const audio = entry.media.streams.find(s => s.codec_type === 'audio');
  await check(`saved ${entry.source} ${video.width}x${video.height} complete revalidation`, entry.file, {id: proof.sourceId, sourceUrl: proof.sourceUrl, title: proof.title, duration: proof.expectedDuration, acodec: audio.codec_name}, 'video', true, undefined, String(video.height));
  const verified = results.at(-1).proof;
  assert.equal(verified.sha256, proof.sha256);
  assert.equal(verified.videoWidth, video.width);
  assert.equal(verified.videoHeight, video.height);
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(results, null, 2));
