import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {publicUrl, mediaKind, filename, siteName} from '../extension/media.js';

test('public URLs reject local addresses, credentials and unsupported schemes', () => {
  for (const url of ['javascript:alert(1)', 'blob:https://example.com/123', 'file:///C:/x', 'http://127.0.0.1/a', 'https://[::1]/x', 'http://localhost/x', 'https://nas.local/a', 'http://test.localhost/x', 'https://a:pass@example.com/']) assert.equal(publicUrl(url), null, url);
  assert.equal(publicUrl('https://cdn.example.com/a.mp4?token=123'), 'https://cdn.example.com/a.mp4?token=123');
});
test('media detection distinguishes manifests, normal files and transport segments', () => {
  assert.equal(mediaKind('https://cdn.example.com/a.m3u8?q=1'), 'HLS');
  assert.equal(mediaKind('https://cdn.example.com/media', 'application/dash+xml'), 'DASH');
  assert.equal(mediaKind('https://cdn.example.com/movie', 'video/mp4; charset=UTF-8'), '影片');
  assert.equal(mediaKind('https://cdn.example.com/a.m4a'), '音訊');
  assert.equal(mediaKind('https://cdn.example.com/chunk.ts', 'video/mp2t'), null);
  assert.equal(mediaKind('https://cdn.example.com/a.jpg'), null);
});
test('domain routing cannot be spoofed; filenames remain inside download subdirectory', () => {
  assert.equal(siteName('https://www.youtube.com/watch?v=a'), 'YouTube');
  assert.equal(siteName('https://www.bilibili.com/video/BVabc/?p=3'), 'Bilibili');
  assert.notEqual(siteName('https://youtube.com.attacker.com/'), 'YouTube');
  assert.notEqual(siteName('https://notbilibili.com/'), 'Bilibili');
  assert.equal(filename('../測試:影片', 'https://cdn.example.com/a.webm'), 'MediaDock/.._測試_影片.webm');
  assert.equal(filename('CON', 'https://cdn.example.com/a.mp4'), 'MediaDock/_CON.mp4');
});

function background() {
  const stores = {local: {}, session: {}};
  const listeners = {};
  const calls = [];
  const root = 'chrome-extension://test/';
  let port;
  let allow = false;
  let source = {id: 12, url: 'https://www.bilibili.com/video/BV123?p=2', title: '當前影片'};
  let nativeReply = action => action === 'status' ? {ready: true, version: '0.2.0'} : action === 'probe' ? {title: '範例', heights: [1080, 720]} : {};
  const event = name => ({addListener: (fn) => { listeners[name] = fn; }});
  const chrome = {
    storage: Object.fromEntries(Object.entries(stores).map(([name, data]) => [name, {get: async key => typeof key === 'string' ? {[key]: structuredClone(data[key])} : structuredClone(data), set: async values => Object.assign(data, structuredClone(values))}])),
    runtime: {id: 'test', getURL: path => root + path, onMessage: event('message'), onStartup: event('startup'), connectNative: () => {
      port = {onMessage: event('nativeMessage'), onDisconnect: event('disconnect'), postMessage: msg => {
        calls.push(msg);
        queueMicrotask(() => {
          try { const result = nativeReply(msg.action, msg); listeners.nativeMessage({id: msg.id, ok: true, data: result}); }
          catch (e) { listeners.nativeMessage({id: msg.id, ok: false, error: e.message}); }
        });
      }, disconnect: () => listeners.disconnect()}; return port;
    }},
    permissions: {contains: async () => allow}, cookies: {getAll: async () => [{domain: '.bilibili.com', name: 'session', value: 'sensitive', path: '/', httpOnly: true}, {domain: '.evil.com', name: 'other', value: 'should-not-send'}]},
    tabs: {query: async () => [source], onRemoved: event('tabRemoved')},
    scripting: {executeScript: async () => { calls.push({action: 'injection'}); return [{result: {title: source.title, url: source.url, media: [{url: 'https://cdn.example.com/test.mp4', mime: 'video/mp4'}]}}]; }},
    downloads: {download: async opts => { calls.push({action: 'browserDownload', ...opts}); return 9; }, search: async () => [{state: 'complete'}], onChanged: event('downloadChanged'), cancel: async () => {}, show: () => {}},
    webRequest: {onHeadersReceived: event('headers'), onBeforeRequest: event('beforeRequest')},
    action: {setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, openPopup: async options => { calls.push({action: 'openPopup', ...options}); }}
  };
  const context = {chrome, URL, crypto: webcrypto, navigator: {userAgent: 'TestBrowser'}, Map, Set, Promise, setTimeout: (...args) => { const t = setTimeout(...args); t.unref(); return t; }, clearTimeout};
  const code = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8').replace(/^import .*\n/, '');
  vm.runInNewContext(code, {...context, publicUrl, mediaKind, filename, siteName});
  const message = (action, data = {}, sender = {id: 'test', url: root + 'popup.html'}) => new Promise(resolve => listeners.message({action, ...data}, sender, resolve));
  return {stores, calls, listeners, message, source: value => source = value, permissions: value => allow = value, reply: fn => nativeReply = fn};
}
test('a web page or content script cannot trigger native/download commands', async () => {
  const bg = background();
  for (const sender of [{id: 'test', url: 'https://www.youtube.com/', tab: {id: 1}}, {id: 'other', url: 'chrome-extension://test/popup.html'}, {id: 'test', url: 'chrome-extension://test/popup.html', tab: {id: 3}}]) {
    assert.equal((await bg.message('start', {url: 'https://example.com'}, sender)).ok, false);
  }
  assert.equal(bg.calls.length, 0);
});
test('YouTube button may only open UI for the active top-level video tab', async () => {
  const bg = background();
  const url = 'https://www.youtube.com/watch?v=a9LDPn-MO4I';
  const tab = {id: 12, windowId: 3, url, title: 'UHD video'};
  bg.source(tab);
  const sender = {id: 'test', frameId: 0, url, tab};
  assert.equal((await bg.message('openDownloader', {url: 'https://evil.test/video'}, sender)).ok, true);
  assert.deepEqual(bg.calls, [{action: 'openPopup', windowId: 3}]);
  for (const bad of [{...sender, id: 'other'}, {...sender, frameId: 1}, {...sender, url: 'https://www.youtube.com/'}, {...sender, url: 'https://www.youtube.com.evil.test/watch?v=a9LDPn-MO4I'}, {...sender, url: 'https://www.youtube.com/watch?v=YE7VzlLtp-4'}, {...sender, tab: {...tab, id: 22}}]) assert.equal((await bg.message('openDownloader', {}, bad)).ok, false);
  assert.equal((await bg.message('start', {url}, sender)).ok, false);
  assert.equal((await bg.message('probe', {url}, sender)).ok, false);
  assert.equal(bg.calls.length, 1);
  bg.source({...tab, url: 'https://www.youtube.com/shorts/18NGQq7p3LY'});
  assert.equal((await bg.message('openDownloader', {}, {...sender, url: 'https://www.youtube.com/shorts/18NGQq7p3LY'})).ok, true);
});
test('platforms skip DOM scans, other sites scan and return only media', async () => {
  const bg = background();
  const platform = await bg.message('scan'); assert.equal(platform.ok, true); assert.equal(bg.calls.length, 0);
  bg.source({id: 1, title: 'Website', url: 'https://example.com/watch'});
  const result = await bg.message('scan'); assert.equal(result.data.media[0].kind, '影片'); assert.equal(bg.calls[0].action, 'injection');
});
test('public probes use short cache; Cookie mode requires explicit permission and scopes cookies', async () => {
  const bg = background(); const url = 'https://www.bilibili.com/video/BV1?p=2';
  assert.equal((await bg.message('probe', {url})).ok, true);
  await bg.message('probe', {url}); assert.equal(bg.calls.filter(c => c.action === 'probe').length, 1);
  assert.equal((await bg.message('probe', {url, useCookies: true})).ok, false);
  bg.permissions(true); await bg.message('probe', {url, useCookies: true});
  const cookieCall = bg.calls.at(-1); assert.equal(cookieCall.cookies.length, 1); assert.equal(cookieCall.cookies[0].domain, '.bilibili.com');
  assert.equal(JSON.stringify(bg.stores).includes('sensitive'), false);
  assert.equal((await bg.message('probe', {url: 'https://www.youtube.com/watch?v=x', useCookies: true})).ok, false);
});
test('cancelled native save dialog is terminal; progress events update the same history entry', async () => {
  const bg = background(); bg.reply(action => action === 'status' ? {ready: true, version: '0.2.0'} : {cancelled: true});
  const cancelled = await bg.message('start', {url: 'https://example.com/a', title: '影片'});
  assert.equal(cancelled.data.cancelled, true); assert.equal(bg.stores.local.jobs[0].status, 'cancelled');
  bg.reply(action => action === 'status' ? {ready: true, version: '0.2.0'} : {}); await bg.message('start', {url: 'https://example.com/b', title: '第二支', quality: '1080'});
  const id = bg.stores.local.jobs[0].id;
  bg.listeners.nativeMessage({event: 'job', job: {id, status: 'downloading', progress: 33}});
  bg.listeners.nativeMessage({event: 'job', job: {id, status: 'completed', progress: 100, path: 'C:\\Videos\\test.mp4'}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(bg.stores.local.jobs.length, 2); assert.equal(bg.stores.local.jobs[0].status, 'completed');
  await bg.message('clearHistory'); assert.equal(bg.stores.local.jobs.length, 0);
});
test('ordinary files also require native verification; no unchecked browser download', async () => {
  const bg = background();
  await bg.message('direct', {url: 'https://cdn.example.com/test.mp4', title: 'test'});
  assert.equal(bg.calls.some(c => c.action === 'start'), true); assert.equal(bg.stores.local.jobs[0].engine, 'native');
  assert.equal(bg.calls.some(c => c.action === 'browserDownload'), false);
  assert.equal((await bg.message('direct', {url: 'https://cdn.example.com/test.m3u8'})).ok, false);
});
test('multi-platform names use exact domain boundaries', () => {
  for (const [url, name] of [['https://player.vimeo.com/video/1', 'Vimeo'], ['https://www.dailymotion.com/video/a', 'Dailymotion'], ['https://www.twitch.tv/videos/1', 'Twitch'], ['https://www.tiktok.com/@x/video/1', 'TikTok'], ['https://www.instagram.com/reel/1/', 'Instagram'], ['https://x.com/a/status/1', 'X'], ['https://v.qq.com/x/cover/a.html', '騰訊影片']]) assert.equal(siteName(url), name);
  assert.notEqual(siteName('https://vimeo.com.evil.test/'), 'Vimeo');
});
test('older helper cannot bypass verification', async () => {
  const bg = background(); bg.reply(() => ({ready: true, version: '0.1.0'}));
  const status = await bg.message('status'); assert.equal(status.data.ready, false); assert.equal(status.data.updateNeeded, true);
  const result = await bg.message('start', {url: 'https://example.com/video.mp4'}); assert.equal(result.ok, false); assert.match(result.error, /需要更新/);
  assert.equal(bg.calls.some(c => c.action === 'start'), false);
});
test('verification is active work; history clearing preserves it, disconnect fails it', async () => {
  const bg = background(); await bg.message('start', {url: 'https://example.com/a'}); const id = bg.stores.local.jobs[0].id;
  bg.listeners.nativeMessage({event: 'job', job: {id, engine: 'native', status: 'verifying', progress: 50}});
  await bg.message('clearHistory'); assert.equal(bg.stores.local.jobs[0].status, 'verifying');
  bg.listeners.disconnect(); await new Promise(resolve => setImmediate(resolve)); assert.equal(bg.stores.local.jobs[0].status, 'failed');
});
test('network detection only records explicitly watched tabs and rejects transport segments', async () => {
  const bg = background(); bg.source({id: 7, title: 'Page', url: 'https://example.com'}); bg.permissions(true);
  await bg.message('watch');
  const headers = [{name: 'Content-Type', value: 'application/vnd.apple.mpegurl'}];
  bg.listeners.headers({tabId: 7, url: 'https://cdn.example.com/a.m3u8', statusCode: 200, responseHeaders: headers});
  bg.listeners.headers({tabId: 8, url: 'https://cdn.example.com/b.m3u8', statusCode: 200, responseHeaders: headers});
  bg.listeners.headers({tabId: 7, url: 'https://cdn.example.com/chunk.ts', statusCode: 200, responseHeaders: [{name: 'content-type', value: 'video/mp2t'}]});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(bg.stores.session.candidates[7].length, 1); assert.equal(bg.stores.session.candidates[8], undefined);
  await bg.message('stopWatch', {tabId: 7}); assert.equal(bg.stores.session.candidates[7], undefined);
});
