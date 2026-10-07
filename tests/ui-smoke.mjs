import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.CODEX_NODE_MODULES ? path.join(process.env.CODEX_NODE_MODULES, 'playwright') : 'playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const out = path.join(root, 'test-output'); fs.mkdirSync(out, {recursive: true});
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '');
  const file = path.resolve(root, 'extension', name || 'popup.html');
  if (!file.startsWith(path.join(root, 'extension') + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/popup.html`;
const browser = await chromium.launch({channel: 'msedge', headless: true});
const errors = [];
async function ui(kind, theme = 'light') {
  const context = await browser.newContext({viewport: {width: 368, height: 580}, colorScheme: theme, reducedMotion: 'reduce'});
  await context.addInitScript(({kind}) => {
    const platform = ['youtube', 'shorts', 'bilibili', 'missing'].includes(kind);
    window.testCalls = [];
    let storageListener;
    window.chrome = {
      runtime: {
        openOptionsPage: async () => testCalls.push({action: 'options'}),
        sendMessage: async message => {
          testCalls.push(message);
          if (message.action === 'scan') return {ok: true, data: {title: platform ? 'Big Buck Bunny · Blender Open Movie' : '影片資料庫', url: kind === 'bilibili' ? 'https://www.bilibili.com/video/BVtest?p=3' : kind === 'vimeo' ? 'https://vimeo.com/1084537' : kind === 'shorts' ? 'https://www.youtube.com/shorts/18NGQq7p3LY' : platform ? 'https://www.youtube.com/watch?v=YE7VzlLtp-4' : 'https://example.com/library', tabId: 1, watching: false, media: platform || kind === 'empty' || kind === 'vimeo' ? [] : [{url: 'https://cdn.example.com/intro-1080p.mp4', kind: '影片', mime: 'video/mp4'}, {url: 'https://cdn.example.com/lesson-720p.webm', kind: '影片', mime: 'video/webm'}, {url: 'https://cdn.example.com/master.m3u8', kind: 'HLS'}]}};
          if (message.action === 'status') return kind === 'missing' ? {ok: false, error: 'not installed'} : {ok: true, data: {ready: true}};
          if (message.action === 'probe') return {ok: true, data: {title: 'Big Buck Bunny · Blender Open Movie', uploader: 'Blender', duration: 596, heights: [2160, 1440, 1080, 720, 480], ...(kind === 'shorts' ? {qualities: [{width: 2160, height: 2964}, {width: 1440, height: 1976}, {width: 1080, height: 1482}, {width: 720, height: 988}]} : {}), identity: {sourceUrl: message.url, id: 'movie', extractor_key: 'fixture', duration: 596}}};
          if (message.action === 'clearHistory') storageListener?.({jobs: {newValue: []}}, 'local');
          return {ok: true, data: {id: 'test', cancelled: message.action === 'start'}};
        }
      }, storage: {local: {get: async () => ({jobs: []})}, onChanged: {addListener: fn => storageListener = fn}}, permissions: {request: async () => true}
    };
  }, {kind});
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector('#scan-state').classList.contains('busy'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({path: path.join(out, `${kind}-${theme}.png`), fullPage: true});
  return {context, page};
}
try {
  const yt = await ui('youtube');
  assert.equal(await yt.page.locator('#quality').inputValue(), '1080');
  assert.equal(await yt.page.locator('#advanced').getAttribute('open'), null);
  assert.equal(await yt.page.locator('#history').getAttribute('open'), null);
  await yt.page.locator('#quality').selectOption('720');
  await yt.page.locator('#start').click();
  await yt.page.locator('#message').filter({hasText: '已取消儲存'}).waitFor();
  assert.equal((await yt.page.evaluate(() => testCalls.find(c => c.action === 'start'))).quality, '720');
  assert.equal((await yt.page.evaluate(() => testCalls.find(c => c.action === 'start'))).expected.sourceUrl, 'https://www.youtube.com/watch?v=YE7VzlLtp-4');
  await yt.page.locator('#advanced summary').click(); await yt.page.locator('#mode').selectOption('audio');
  assert.equal(await yt.page.locator('#quality').isDisabled(), true);
  await yt.page.locator('#refresh').click();
  assert.equal(await yt.page.evaluate(() => testCalls.findLast(c => c.action === 'scan').refresh), true);
  await yt.context.close();
  const shorts = await ui('shorts');
  assert.equal(await shorts.page.locator('#quality').inputValue(), '1482');
  assert.match(await shorts.page.locator('#quality option[value="1482"]').textContent(), /1080p.*1080 × 1482/);
  assert.match(await shorts.page.locator('#quality option[value="2964"]').textContent(), /2160p.*4K.*2160 × 2964/);
  await shorts.page.locator('#quality').selectOption('2964');
  await shorts.page.locator('#start').click();
  const shortsStart = await shorts.page.evaluate(() => testCalls.find(c => c.action === 'start'));
  assert.equal(shortsStart.quality, '2964');
  assert.equal(shortsStart.expected.sourceUrl, 'https://www.youtube.com/shorts/18NGQq7p3LY');
  await shorts.context.close();
  const bili = await ui('bilibili');
  await bili.page.locator('#advanced summary').click(); assert.equal(await bili.page.locator('#cookie-option').isVisible(), true);
  await bili.page.locator('#cookies').check();
  await bili.page.waitForFunction(() => testCalls.some(c => c.action === 'probe' && c.useCookies));
  assert.equal(await bili.page.evaluate(() => testCalls.find(c => c.action === 'probe').url.includes('?p=3')), true);
  await bili.context.close();
  const generic = await ui('generic'); assert.equal(await generic.page.locator('#media-list .item').count(), 3);
  assert.equal(await generic.page.evaluate(() => testCalls.some(c => c.action === 'status' || c.action === 'probe')), false);
  await generic.page.locator('#media-list .primary').first().click();
  assert.equal(await generic.page.evaluate(() => testCalls.some(c => c.action === 'start' && c.url.endsWith('intro-1080p.mp4'))), true);
  await generic.page.locator('#media-list .primary').last().click();
  assert.equal(await generic.page.evaluate(() => testCalls.some(c => c.action === 'start' && c.url.endsWith('master.m3u8'))), true);
  await generic.context.close();
  const multi = await ui('vimeo'); assert.equal(await multi.page.locator('#site').textContent(), 'Vimeo');
  assert.equal(await multi.page.evaluate(() => testCalls.some(c => c.action === 'probe')), false);
  await multi.page.locator('#platform-probe').click(); await multi.page.locator('#start').waitFor();
  assert.equal(await multi.page.evaluate(() => testCalls.find(c => c.action === 'probe').url), 'https://vimeo.com/1084537');
  assert.equal(await multi.page.locator('#quality').inputValue(), '1080'); await multi.context.close();
  for (const kind of ['missing', 'empty']) { const p = await ui(kind); if (kind === 'missing') assert.equal(await p.page.locator('#start').isDisabled(), true); await p.context.close(); }
  for (const kind of ['youtube', 'generic']) { const p = await ui(kind, 'dark'); await p.context.close(); }
  const fixture = await browser.newPage();
  await fixture.setContent('<video src="https://cdn.example.com/movie.mp4"></video><video></video><audio><source src="https://cdn.example.com/song.m4a" type="audio/mp4"></audio><a href="https://cdn.example.com/master.m3u8">串流</a><a href="https://cdn.example.com/pic.jpg">image</a><video src="blob:https://example.com/abc"></video>');
  const scan = fs.readFileSync(path.join(root, 'extension/scan.js'), 'utf8');
  const scanResult = await fixture.evaluate(scan);
  assert.equal(scanResult.media.length, 3);
  assert.equal(scanResult.media.some(x => x.url.includes('null') || x.url.startsWith('blob:')), false);
  await fixture.evaluate(() => { const frame = document.createElement('iframe'); document.body.append(frame); frame.contentDocument.body.innerHTML = '<video src="https://cdn.example.com/embedded.mp4"></video>'; });
  assert.equal((await fixture.evaluate(scan)).media.length, 4);
  await fixture.close();
  assert.deepEqual(errors, []);
  // Actual MV3 load and stable ID verification, in a separate temporary Edge profile.
  const extension = path.join(root, 'extension');
  const ctx = await chromium.launchPersistentContext(path.join(out, 'edge-profile'), {channel: 'msedge', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  let worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  assert.ok(worker.url().includes('fhjcedbbonnlkilcklhodjejolannode'));
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest()); assert.equal(manifest.manifest_version, 3);
  await ctx.close();
  console.log('PASS: platform auto analysis, current Bilibili part, quality/save cancellation, generic resource selection, dark/light UI, DOM scanner, no general-site helper startup, Edge MV3 load.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
