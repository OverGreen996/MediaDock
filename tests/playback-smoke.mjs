import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.CODEX_NODE_MODULES ? path.join(process.env.CODEX_NODE_MODULES, 'playwright') : 'playwright');
const highQuality = process.argv.includes('--high-quality');
const entries = highQuality ? JSON.parse(fs.readFileSync('test-output/high-quality/report.json')).downloads.filter(x => x.ok).map(x => ({name: path.basename(x.file), file: x.file, width: x.media.streams.find(s => s.codec_type === 'video').width, height: x.media.streams.find(s => s.codec_type === 'video').height})) : ['YouTube-360p.mp4', 'Bilibili-360p.mp4'].map(name => ({name, file: path.resolve('test-output/saved', name), height: 360}));
const names = entries.map(x => x.name);
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(req.url.slice(1));
  if (!names.includes(name)) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<html lang="zh-Hant"><style>body{font:16px Segoe UI,sans-serif;background:#f5f6f8;color:#202124;margin:24px}h1{font-size:22px}section{margin:24px 0}div{display:flex;gap:12px}img{width:300px;border-radius:8px}p{font-size:13px;color:#555}</style><h1>MediaDock · 實際下载檔案播放檢查</h1><video id="video" muted preload="auto"></video><main></main></html>'); return; }
  const file = entries.find(x => x.name === name).file; const size = fs.statSync(file).size;
  const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/); const start = range ? Number(range[1]) : 0; const end = range && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
  if (start >= size || end < start) { res.writeHead(416, {'Content-Range': `bytes */${size}`}).end(); return; }
  const headers = {'Content-Type': name.endsWith('.mkv') ? 'video/x-matroska' : 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1};
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(range ? 206 : 200, headers); fs.createReadStream(file, {start, end}).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({channel: 'msedge', headless: true}); const results = [];
try {
  const page = await browser.newPage({viewport: {width: 1000, height: 580}}); await page.goto(base);
  for (const [index, entry] of entries.entries()) {
    const {name} = entry;
    await page.evaluate(url => { video.src = url; video.load(); }, `${base}/${name}`);
    await page.waitForFunction(() => video.readyState >= 3);
    await page.evaluate(() => video.play()); await page.waitForFunction(() => video.currentTime > .3);
    const result = await page.evaluate(() => ({duration: video.duration, width: video.videoWidth, height: video.videoHeight, decodedFrames: video.getVideoPlaybackQuality().totalVideoFrames, error: video.error?.code || null}));
    assert.equal(result.height, entry.height); if (entry.width) assert.equal(result.width, entry.width); assert.ok(result.decodedFrames > 0); assert.equal(result.error, null);
    await page.evaluate(({name, index}) => { video.pause(); const section = document.createElement('section'); section.id = 'sample-' + index; const p = document.createElement('p'); p.textContent = name + ` · ${video.videoWidth} × ${video.videoHeight} · 開頭、片中、片尾播放通過`; section.append(p, document.createElement('div')); document.querySelector('main').append(section); }, {name, index});
    for (const seconds of highQuality ? [result.duration * .1, result.duration * .4, result.duration * .8] : [60, 240, 500]) {
      await page.evaluate(time => new Promise(resolve => { video.addEventListener('seeked', resolve, {once: true}); video.currentTime = time; }), seconds);
      await page.evaluate(({index, seconds}) => { const canvas = document.createElement('canvas'); canvas.width = Math.round(video.videoWidth * Math.min(1, 600 / video.videoWidth)); canvas.height = Math.round(video.videoHeight * Math.min(1, 600 / video.videoWidth)); canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height); const img = document.createElement('img'); img.src = canvas.toDataURL(); img.alt = `${seconds} 秒實際影片畫面`; document.querySelector(`#sample-${index} div`).append(img); }, {index, seconds});
    }
    await page.evaluate(() => new Promise(resolve => { video.addEventListener('seeked', resolve, {once: true}); video.currentTime = Math.max(0, video.duration - .75); }));
    await page.evaluate(() => video.play()); await page.waitForFunction(() => video.ended, {timeout: 10000});
    assert.equal(await page.evaluate(() => video.error?.code || null), null);
    results.push({file: name, browser: 'Edge', ...result, middleAndEndPlayback: true}); console.log('PASS: Edge actual playback and seeking:', name);
  }
  await page.evaluate(() => video.remove());
  await page.screenshot({path: highQuality ? 'test-output/high-quality/verified-content.png' : 'test-output/verified-content.png', fullPage: true});
  fs.writeFileSync(highQuality ? 'test-output/high-quality/playback-report.json' : 'test-output/playback-report.json', JSON.stringify(results, null, 2));
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
