import {createRequire} from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.CODEX_NODE_MODULES ? path.join(process.env.CODEX_NODE_MODULES, 'playwright') : 'playwright');
const extension = path.resolve('extension'); const output = path.resolve('test-output');
const context = await chromium.launchPersistentContext(path.join(output, 'youtube-button-edge-profile'), {channel: 'msedge', headless: true, viewport: {width: 1100, height: 500}, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
const markup = `<html lang="zh-Hant"><head><title>MediaDock YouTube button test</title><style>
body{margin:36px;font-family:"Segoe UI",sans-serif;background:#fff;color:#0f0f0f;--yt-spec-text-primary:#0f0f0f;--yt-spec-badge-chip-background:#f2f2f2;--yt-spec-button-chip-background-hover:#e5e5e5}h1{font-size:24px}p{font-size:13px;color:#777}#top-level-buttons-computed{display:flex;width:max-content;gap:8px;align-items:center}yt-button-view-model,segmented-like-dislike-button-view-model{display:inline-flex}button{border:0;background:var(--yt-spec-badge-chip-background);color:inherit;padding:0 14px;height:36px;border-radius:24px;font-size:14px}reel-action-bar-view-model{display:flex;flex-direction:column;align-items:center;gap:10px;width:70px}ytd-shorts{display:none}reel-action-bar-view-model button{height:48px}body.dark{background:#0f0f0f;color:#f1f1f1;--yt-spec-text-primary:#f1f1f1;--yt-spec-badge-chip-background:#272727;--yt-spec-button-chip-background-hover:#3f3f3f}@media(max-width:650px){body{margin:16px}}
</style></head><body><h1>影片標題 · YouTube 操作列預覽</h1><p>此畫面使用測試頁；下載按鈕由真實 Edge 擴充功能注入。</p><ytd-watch-flexy><div id="top-level-buttons-computed"><segmented-like-dislike-button-view-model><button>讚 234 ｜ 倒讚</button></segmented-like-dislike-button-view-model><yt-button-view-model id="share"><button aria-label="分享">分享</button></yt-button-view-model><yt-button-view-model><button>儲存</button></yt-button-view-model></div></ytd-watch-flexy><ytd-shorts><reel-action-bar-view-model><button-view-model><button aria-label="喜歡">讚</button></button-view-model><button-view-model id="short-share"><button aria-label="分享">分享</button></button-view-model><button-view-model><button>更多</button></button-view-model></reel-action-bar-view-model></ytd-shorts></body></html>`;
await context.route('https://www.youtube.com/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: markup}));
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('https://www.youtube.com/watch?v=a9LDPn-MO4I');
  const host = page.locator('#mediadock-yt-download'), button = host.locator('button');
  await button.waitFor(); assert.equal(await host.count(), 1);
  assert.equal(await host.evaluate(e => e.previousElementSibling.id), 'share');
  await page.screenshot({path: path.join(output, 'youtube-button-light.png')});
  await page.locator('#top-level-buttons-computed').screenshot({path: path.join(output, 'youtube-button-preview.png')});
  await page.evaluate(() => document.body.classList.add('dark'));
  assert.equal(await button.evaluate(e => getComputedStyle(e).color), 'rgb(241, 241, 241)');
  await page.screenshot({path: path.join(output, 'youtube-button-dark.png')});
  await page.setViewportSize({width: 360, height: 500});
  assert.equal(await button.evaluate(e => e.getBoundingClientRect().width), 36);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({width: 1100, height: 500});
  // Page-generated clicks must not open privileged extension UI.
  await button.evaluate(e => e.click());
  assert.equal((await worker.evaluate(() => chrome.runtime.getContexts({contextTypes: ['POPUP']}))).length, 0);
  await button.click();
  await button.waitFor({state: 'visible'});
  await page.waitForFunction(() => !document.getElementById('mediadock-yt-download').shadowRoot.querySelector('button').disabled);
  const popupContexts = await worker.evaluate(() => chrome.runtime.getContexts({contextTypes: ['POPUP']}));
  assert.equal(popupContexts.length, 1, await host.locator('.toast').textContent());
  assert.ok(popupContexts[0].documentUrl.endsWith('/popup.html'));
  console.log('PASS: actual Edge content script injection, Share adjacency, dark/light themes, trusted click opens real extension popup; synthetic clicks ignored.');
  await page.locator('h1').click();
  // Replace YouTube's whole action row: the observer must restore exactly one button.
  await page.evaluate(() => { const row = document.querySelector('#top-level-buttons-computed'); const copy = row.cloneNode(true); copy.querySelector('#mediadock-yt-download').remove(); copy.querySelector('#share').replaceChildren(); row.replaceWith(copy); });
  await button.waitFor(); assert.equal(await host.count(), 1);
  await page.evaluate(() => { const b = document.createElement('button'); b.setAttribute('aria-label', 'Share'); b.textContent = 'Share'; document.querySelector('#share').append(b); });
  await page.waitForFunction(() => document.querySelector('#mediadock-yt-download')?.previousElementSibling?.id === 'share');
  // YouTube SPA navigation changes the URL without creating a new document.
  await page.evaluate(() => { document.dispatchEvent(new Event('yt-navigate-start')); history.pushState({}, '', '/watch?v=YE7VzlLtp-4'); document.dispatchEvent(new Event('yt-navigate-finish')); });
  await button.waitFor(); assert.equal(await host.count(), 1);
  await page.evaluate(() => { document.dispatchEvent(new Event('yt-navigate-start')); history.pushState({}, '', '/'); document.dispatchEvent(new Event('yt-navigate-finish')); });
  await host.waitFor({state: 'detached'});
  await page.evaluate(() => { history.pushState({}, '', '/shorts/18NGQq7p3LY'); document.querySelector('ytd-watch-flexy').style.display = 'none'; document.querySelector('ytd-shorts').style.display = 'block'; document.dispatchEvent(new Event('yt-navigate-finish')); });
  await button.waitFor(); assert.equal(await host.getAttribute('shorts'), '');
  assert.equal(await host.evaluate(e => e.previousElementSibling.id), 'short-share');
  await page.screenshot({path: path.join(output, 'youtube-button-shorts.png')});
  assert.deepEqual(errors, []);
  console.log('PASS: row replacement, SPA video switching, removal on home page, Shorts action rail, no duplicate buttons or page errors.');
} finally { await context.close(); }
