import fs from 'node:fs';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const native = path.resolve('test-output/runtime/native');
const tools = path.join(native, 'tools');
const output = path.resolve('test-output/high-quality'); fs.mkdirSync(output, {recursive: true});
const sources = [
  {name: 'YouTube UHD', url: 'https://www.youtube.com/watch?v=a9LDPn-MO4I'},
  {name: 'YouTube Shorts', url: 'https://www.youtube.com/shorts/18NGQq7p3LY'},
  {name: 'Bilibili without login', url: 'https://www.bilibili.com/video/BV15z4y1U7HS/'}
];
const report = {date: new Date().toISOString(), login: false, probes: [], downloads: []};
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function probe(source) {
  const proc = spawn(path.join(tools, 'yt-dlp.exe'), ['--ignore-config', '--no-plugin-dirs', '--no-playlist', '--socket-timeout', '20', '--retries', '1', '--js-runtimes', `deno:${path.join(tools, 'deno.exe')}`, '--dump-single-json', '--skip-download', '--', source.url], {windowsHide: true});
  let stdout = ''; let stderr = ''; proc.stdout.on('data', d => stdout += d); proc.stderr.on('data', d => { stderr = (stderr + d).slice(-8000); });
  const timeout = setTimeout(() => proc.kill(), 120000);
  const code = await new Promise(resolve => proc.on('exit', resolve)); clearTimeout(timeout);
  if (code !== 0) return {...source, ok: false, error: stderr};
  const data = JSON.parse(stdout);
  return {...source, ok: true, id: data.id, title: data.title, duration: data.duration, formats: (data.formats || []).filter(f => f.vcodec !== 'none' && f.height && !f.has_drm).map(f => ({id: f.format_id, width: f.width, height: f.height, fps: f.fps, vcodec: f.vcodec, acodec: f.acodec, note: f.format_note}))};
}
for (const source of sources) {
  const data = await probe(source); report.probes.push(data); save();
  console.log('PROBE:', data.name, data.ok, data.id || data.error, [...new Set((data.formats || []).map(f => `${f.width}x${f.height}`))].join(', '));
}
if (process.argv.includes('--probe-only')) process.exit(0);
async function download(source, quality, container) {
  const label = source.name.startsWith('Bilibili') ? 'bilibili-no-login' : source.name.includes('Shorts') ? 'youtube-shorts' : 'youtube-uhd';
  const file = path.join(output, `${label}-${quality}.${container}`);
  const proc = spawn(path.join(native, 'NativeDownloadHarness.exe'), [path.join(native, 'MediaDockHost.exe'), file, 'video', source.url, String(quality), '', container], {windowsHide: true});
  let buffer = Buffer.alloc(0), last; const phases = new Set();
  proc.stdout.on('data', d => {
    buffer = Buffer.concat([buffer, d]);
    while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
      const size = buffer.readUInt32LE(0); const event = JSON.parse(buffer.subarray(4, 4 + size)); buffer = buffer.subarray(4 + size);
      if (event.job) { last = event.job; if (!phases.has(last.status)) { phases.add(last.status); console.log(label, quality, last.status, last.error || ''); } }
    }
  });
  let stderr = ''; proc.stderr.on('data', d => stderr += d);
  const code = await new Promise(resolve => proc.on('exit', resolve));
  const result = {source: source.name, url: source.url, requestedQuality: quality, container, ok: code === 0 && last?.status === 'completed', error: last?.error || stderr || undefined};
  if (result.ok) {
    result.file = file; result.verification = last.verification;
    assert.equal(last.verification.fullDecode, true); assert.equal(last.verification.identityMatched, true); assert.equal(last.verification.durationMatched, true);
    const media = JSON.parse(execFileSync(path.join(tools, 'ffprobe.exe'), ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,pix_fmt:format=duration,size', '-of', 'json', file]));
    result.media = media;
    assert.ok(media.streams.some(s => s.codec_type === 'audio')); assert.ok(media.streams.some(s => s.codec_type === 'video'));
    if (quality !== 'best') assert.equal(media.streams.find(s => s.codec_type === 'video').height, Number(quality));
    if (container === 'mkv') assert.equal(last.verification.compatibilityConverted, false);
  }
  report.downloads.push(result); save(); console.log('RESULT:', label, quality, result.ok, result.error || 'verified');
}
const uhd = report.probes[0];
if (uhd.ok) for (const height of [1440, 2160]) {
  if (uhd.formats.some(f => f.height === height)) await download(uhd, height, 'mkv');
  else { report.downloads.push({source: uhd.name, requestedQuality: height, ok: false, error: 'source does not expose this resolution'}); save(); }
}
const short = report.probes[1]; if (short.ok) await download(short, 'best', 'mp4');
const bili = report.probes[2]; if (bili.ok) await download(bili, '1080', 'mp4');
console.log('Report:', path.join(output, 'report.json'));
if (report.downloads.some(d => !d.ok)) process.exitCode = 1;
