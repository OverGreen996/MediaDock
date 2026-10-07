import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const root = path.resolve('test-output/runtime/native');
if (!fs.existsSync(path.join(root, 'MediaDockHost.exe'))) throw new Error('先編譯助手並用 Install.ps1 -ToolsOnly -TargetRoot test-output/runtime 準備工具。');
const host = spawn(path.join(root, 'MediaDockHost.exe'), ['chrome-extension://fhjcedbbonnlkilcklhodjejolannode/'], {windowsHide: true});
let buffer = Buffer.alloc(0), sequence = 0;
const waiting = new Map(); const events = []; let stderr = '';
host.stderr.on('data', d => stderr += d);
host.stdout.on('data', d => {
  buffer = Buffer.concat([buffer, d]);
  while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
    const size = buffer.readUInt32LE(0); const message = JSON.parse(buffer.subarray(4, 4 + size).toString()); buffer = buffer.subarray(4 + size);
    if (message.event) { events.push(message); continue; }
    const item = waiting.get(message.id); if (item) { waiting.delete(message.id); clearTimeout(item.timer); item.resolve(message); }
  }
});
function rpc(action, data = {}) {
  return new Promise((resolve, reject) => {
    const id = String(++sequence);
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`Timeout: ${action}, ${stderr}`)); }, 150000);
    waiting.set(id, {resolve, reject, timer});
    const body = Buffer.from(JSON.stringify({id, action, ...data})); const header = Buffer.alloc(4); header.writeUInt32LE(body.length); host.stdin.write(Buffer.concat([header, body]));
  });
}
try {
  const status = await rpc('status'); assert.equal(status.ok, true); assert.equal(status.data.ready, true);
  assert.equal((await rpc('probe', {url: 'file:///C:/secret'})).ok, false);
  assert.equal((await rpc('probe', {url: 'http://127.0.0.1/video.mp4'})).ok, false);
  assert.equal((await rpc('start', {url: 'https://example.com', jobId: 'not-a-guid'})).ok, false);
  assert.equal((await rpc('probe', {url: 'https://www.youtube.com/watch?v=test', cookies: [{domain: '.bilibili.com', name: 'session', value: 'x'}]})).ok, false);
  assert.equal((await rpc('cancel', {jobId: 'nonexistent'})).ok, true);
  const sample = await rpc('probe', {url: 'https://www.w3schools.com/html/mov_bbb.mp4'});
  assert.equal(sample.ok, true, sample.error); assert.ok(sample.data.title); assert.ok(Array.isArray(sample.data.heights));
  console.log('PASS: framed native protocol, real yt-dlp probe, tool status, URL/input validation, Cookie domain boundary, cancellation.');
  if (process.argv.includes('--shorts')) {
    const reply = await rpc('probe', {url: 'https://www.youtube.com/shorts/18NGQq7p3LY'});
    assert.equal(reply.ok, true, reply.error);
    assert.ok(reply.data.qualities.some(q => q.width === 1080 && q.height === 1482));
    assert.ok(reply.data.qualities.some(q => q.width === 2160 && q.height === 2964));
    assert.deepEqual(reply.data.qualities.map(q => q.height), reply.data.heights);
    fs.writeFileSync('test-output/high-quality/native-shorts-probe.json', JSON.stringify(reply.data, null, 2));
    console.log('PASS: live Shorts probe reports width and height independently.');
  }
  if (process.argv.includes('--live')) {
    const sites = [['YouTube', 'https://www.youtube.com/watch?v=YE7VzlLtp-4'], ['Bilibili', 'https://www.bilibili.com/video/BV15z4y1U7HS/']];
    const report = [];
    for (const [site, url] of sites) {
      const reply = await rpc('probe', {url});
      const item = {site, url, ok: reply.ok, data: reply.ok ? reply.data : undefined, error: reply.error}; report.push(item); console.log(JSON.stringify(item));
    }
    fs.writeFileSync('test-output/live-probes.json', JSON.stringify(report, null, 2));
  }
} finally { host.stdin.end(); for (const w of waiting.values()) clearTimeout(w.timer); }
