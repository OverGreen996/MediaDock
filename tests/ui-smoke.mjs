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
    const platform = ['youtube', 'shorts', 'missing'].includes(kind);
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
  assert.equal(await yt.page.locator('#advanced').count(),0);
  assert.equal(await yt.page.locator('#history').getAttribute('open'), null);
  await yt.page.locator('#quality').selectOption('720');
  await yt.page.locator('#start').click();
  await yt.page.locator('#message').filter({hasText: '已取消儲存'}).waitFor();
  assert.equal((await yt.page.evaluate(() => testCalls.find(c => c.action === 'start'))).quality, '720');
  assert.equal((await yt.page.evaluate(() => testCalls.find(c => c.action === 'start'))).expected.sourceUrl, 'https://www.youtube.com/watch?v=YE7VzlLtp-4');
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
  for(const kind of ['bilibili','generic','vimeo','empty']){const p=await ui(kind);assert.equal(await p.page.locator('#video').isVisible(),false);assert.equal(await p.page.evaluate(()=>testCalls.some(c=>c.action==='probe')),false);assert.equal(await p.page.locator('#media,#watch,#cookies').count(),0);await p.context.close();}
  const dark=await ui('youtube','dark');await dark.context.close();
  assert.deepEqual(errors, []);
  // Actual MV3 load and stable ID verification, in a separate temporary Edge profile.
  const extension = path.join(root, 'extension');
  const ctx = await chromium.launchPersistentContext(path.join(out, 'edge-profile'), {channel: 'msedge', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  let worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  assert.ok(worker.url().includes('fhjcedbbonnlkilcklhodjejolannode'));
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest()); assert.equal(manifest.manifest_version, 3);
  await ctx.close();
  console.log('PASS: YouTube quality/Shorts/save cancellation, other sites disabled, no scanner/login/advanced controls, dark/light UI and Edge MV3 load.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
