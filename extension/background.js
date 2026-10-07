import {publicUrl, mediaKind, filename, siteName} from './media.js';

const HOST = 'com.mediadock.downloader';
let nativePort;
let idleTimer;
const activeNative = new Set();
const probes = new Map();
const pending = new Map();
let historyWrite = Promise.resolve();
const watched = new Set();
const candidates = new Map();
const ready = chrome.storage.session.get(['watched', 'candidates']).then(data => {
  (data.watched || []).forEach(id => watched.add(id));
  Object.entries(data.candidates || {}).forEach(([id, list]) => candidates.set(Number(id), list));
});

function saveDetection() {
  return chrome.storage.session.set({watched: [...watched], candidates: Object.fromEntries(candidates)});
}

async function updateJob(patch) {
  historyWrite = historyWrite.catch(() => {}).then(async () => {
    const {jobs = []} = await chrome.storage.local.get('jobs');
    const index = jobs.findIndex(j => j.id === patch.id);
    if (index < 0) jobs.unshift({...patch, created: Date.now()});
    else jobs[index] = {...jobs[index], ...patch};
    await chrome.storage.local.set({jobs: jobs.slice(0, 100)});
  });
  return historyWrite;
}

function connect() {
  if (nativePort) return nativePort;
  const port = chrome.runtime.connectNative(HOST);
  nativePort = port;
  port.onMessage.addListener(message => {
    if (message.event === 'job') {
      if (['completed', 'failed', 'cancelled'].includes(message.job.status)) activeNative.delete(message.job.id);
      updateJob(message.job); releaseWhenIdle(); return;
    }
    const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer); pending.delete(message.id);
    if (message.ok) item.resolve(message.data); else item.reject(new Error(message.error || '本機助手發生錯誤'));
    releaseWhenIdle();
  });
  port.onDisconnect.addListener(() => {
    if (nativePort !== port) return; // an intentional idle release
    const reason = chrome.runtime.lastError?.message || '本機助手已斷線';
    if (nativePort === port) nativePort = null;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(`本機助手未連線：${reason}。請開啟安裝說明。`)); }
    pending.clear();
    activeNative.clear();
    historyWrite = historyWrite.catch(() => {}).then(async () => {
      const {jobs = []} = await chrome.storage.local.get('jobs');
      await chrome.storage.local.set({jobs: jobs.map(j => j.engine === 'native' && ['queued', 'downloading', 'processing', 'verifying'].includes(j.status) ? {...j, status: 'failed', error: '本機助手已斷線，請重新下載。'} : j)});
    });
  });
  return port;
}

function releaseWhenIdle() {
  clearTimeout(idleTimer);
  if (!nativePort || pending.size || activeNative.size) return;
  idleTimer = setTimeout(() => {
    if (pending.size || activeNative.size || !nativePort) return;
    const port = nativePort; nativePort = null; port.disconnect();
  }, 30000);
}

function rpc(action, data = {}) {
  return new Promise((resolve, reject) => {
    clearTimeout(idleTimer);
    const id = crypto.randomUUID();
    const port = connect();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('操作逾時，請重試；也可先更新本機工具。')); releaseWhenIdle(); }, action === 'probe' ? 150000 : action === 'start' ? 30 * 60000 : 20000);
    pending.set(id, {resolve, reject, timer});
    try { port.postMessage({id, action, ...data}); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}

async function bilibiliCookies(url, enabled) {
  if (!enabled) return [];
  const host = new URL(url).hostname;
  if (host !== 'bilibili.com' && !host.endsWith('.bilibili.com')) throw new Error('登入狀態僅支援 bilibili.com 影片頁，請先開啟完整影片網址。');
  if (!await chrome.permissions.contains({permissions: ['cookies'], origins: ['https://*.bilibili.com/*']})) throw new Error('請先授權 Bilibili 登入狀態。');
  const cookies = await chrome.cookies.getAll({domain: 'bilibili.com'});
  return cookies.filter(c => c.domain === 'bilibili.com' || c.domain.endsWith('.bilibili.com')).map(c => ({domain: c.domain, path: c.path, secure: c.secure, expires: c.expirationDate || 0, name: c.name, value: c.value, httpOnly: c.httpOnly}));
}

function supportsVerification(status) {
  const [major, minor] = String(status.version || '').split('.').map(Number);
  return status.ready && (major > 0 || major === 0 && minor >= 2);
}

async function handle(message) {
  await ready;
  switch (message.action) {
    case 'status': {
      const status = await rpc('status');
      return {...status, ready: !!supportsVerification(status), updateNeeded: status.ready && !supportsVerification(status)};
    }
    case 'probe': {
      const url = publicUrl(message.url);
      if (!url) throw new Error('請輸入公開網站的 HTTP／HTTPS 網址。');
      const key = `${url}|${!!message.useCookies}`;
      const cached = probes.get(key);
      if (cached && Date.now() - cached.time < 180000 && !message.useCookies) return cached.data;
      const data = await rpc('probe', {url, cookies: await bilibiliCookies(url, message.useCookies), userAgent: navigator.userAgent});
      if (!message.useCookies) { probes.set(key, {time: Date.now(), data}); if (probes.size > 20) probes.delete(probes.keys().next().value); }
      return data;
    }
    case 'start': {
      const url = publicUrl(message.url);
      if (!url) throw new Error('網址格式不支援。');
      const status = await rpc('status');
      if (!status.ready) throw new Error('缺少本機工具，請重新執行新版 Install.cmd。');
      if (!supportsVerification(status)) throw new Error('本機助手需要更新，請重新執行新版 Install.cmd。');
      const jobId = crypto.randomUUID();
      await updateJob({id: jobId, title: String(message.title || '影片').slice(0, 200), engine: 'native', status: 'queued', progress: 0});
      activeNative.add(jobId);
      try {
        const result = await rpc('start', {jobId, url, title: message.title, quality: message.quality, mode: message.mode, container: message.container, expected: message.expected?.sourceUrl === url ? message.expected : undefined, subtitles: !!message.subtitles, referer: publicUrl(message.referer), cookies: await bilibiliCookies(url, message.useCookies), userAgent: navigator.userAgent});
        if (result.cancelled) { activeNative.delete(jobId); releaseWhenIdle(); await updateJob({id: jobId, status: 'cancelled'}); return result; }
      } catch (error) { activeNative.delete(jobId); releaseWhenIdle(); await updateJob({id: jobId, status: 'failed', error: error.message}); throw error; }
      return {id: jobId};
    }
    case 'direct': {
      const url = publicUrl(message.url);
      const kind = mediaKind(url || '', message.mime);
      if (!url || !kind || kind === 'HLS' || kind === 'DASH') throw new Error('此來源需要本機助手合併串流。');
      return handle({...message, action: 'start', quality: 'best', mode: kind === '音訊' ? 'audio' : 'video', container: 'mp4', useCookies: false});
    }
    case 'cancel': {
      if (String(message.id).startsWith('browser-')) {
        await chrome.downloads.cancel(Number(message.id.slice(8)));
        return updateJob({id: message.id, status: 'cancelled'});
      }
      return rpc('cancel', {jobId: message.id});
    }
    case 'folder': return rpc('folder');
    case 'reveal': return chrome.downloads.show(Number(message.downloadId));
    case 'revealNative': {
      const {jobs = []} = await chrome.storage.local.get('jobs');
      const job = jobs.find(j => j.id === message.id && j.status === 'completed' && j.engine === 'native');
      if (!job?.path) throw new Error('找不到已下載檔案的位置。');
      return rpc('reveal', {path: job.path});
    }
    case 'scan': {
      if (message.refresh) probes.clear();
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (!tab?.id || !publicUrl(tab.url)) throw new Error('請切換到一般網站影片頁，再開啟擴充功能。');
      if (['YouTube', 'Bilibili'].includes(siteName(tab.url))) return {title: tab.title, url: tab.url, media: [], tabId: tab.id, watching: false};
      const result = await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['scan.js']});
      const page = result[0]?.result || {title: tab.title, url: tab.url, media: []};
      const all = new Map([...page.media, ...(candidates.get(tab.id) || [])].filter(x => publicUrl(x.url) && mediaKind(x.url, x.mime)).map(x => [x.url, {...x, kind: mediaKind(x.url, x.mime)}]));
      return {title: page.title, url: page.url, tabId: tab.id, watching: watched.has(tab.id), media: [...all.values()].slice(0, 100)};
    }
    case 'watch': {
      if (!await chrome.permissions.contains({origins: ['http://*/*', 'https://*/*']})) throw new Error('請先授權串流偵測。');
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (!publicUrl(tab?.url)) throw new Error('請先開啟一般網站影片頁。');
      watched.add(tab.id); await saveDetection(); return {tabId: tab.id};
    }
    case 'stopWatch': {
      watched.delete(message.tabId); candidates.delete(message.tabId); await saveDetection();
      await chrome.action.setBadgeText({tabId: message.tabId, text: ''}); return {};
    }
    case 'clearHistory': {
      historyWrite = historyWrite.catch(() => {}).then(async () => {
        const {jobs = []} = await chrome.storage.local.get('jobs');
        await chrome.storage.local.set({jobs: jobs.filter(j => ['queued', 'downloading', 'processing', 'verifying'].includes(j.status))});
      });
      await historyWrite; return {};
    }
    default: throw new Error('不支援的操作');
  }
}

function youtubeVideoId(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'www.youtube.com') return null;
    const id = u.pathname === '/watch' ? u.searchParams.get('v') : u.pathname.match(/^\/shorts\/([\w-]{11})\/?$/)?.[1];
    return /^[\w-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}

async function openFromYouTube(sender) {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab?.id || !youtubeVideoId(sender.url)) throw new Error('未授權的來源');
  const [tab] = await chrome.tabs.query({active: true, windowId: sender.tab.windowId});
  if (tab?.id !== sender.tab.id || youtubeVideoId(tab.url) !== youtubeVideoId(sender.url)) throw new Error('影片分頁已切換，請在目前影片按下載。');
  if (!chrome.action.openPopup) throw new Error('請更新瀏覽器，或點工具列的 MediaDock 圖示。');
  await chrome.action.openPopup({windowId: sender.tab.windowId});
  return {};
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // The YouTube content script may only open the extension UI. It cannot probe, read cookies, or download.
  if (message.action === 'openDownloader') {
    openFromYouTube(sender).then(data => respond({ok: true, data}), error => respond({ok: false, error: error.message}));
    return true;
  }
  // A page/content script cannot start a native command or browser download.
  const root = chrome.runtime.getURL('');
  if (sender.id !== chrome.runtime.id || sender.tab || !sender.url?.startsWith(root)) { respond({ok: false, error: '未授權的來源'}); return false; }
  handle(message).then(data => respond({ok: true, data}), error => respond({ok: false, error: error.message}));
  return true;
});

chrome.webRequest.onHeadersReceived.addListener(details => {
  if (!watched.size) return;
  ready.then(() => {
    if (!watched.has(details.tabId) || !publicUrl(details.url) || details.statusCode < 200 || details.statusCode >= 300) return;
    const mime = details.responseHeaders?.find(h => h.name.toLowerCase() === 'content-type')?.value || '';
    const kind = mediaKind(details.url, mime);
    if (!kind || /\.([cm]?4s|ts)$|\/videoplayback$/i.test(new URL(details.url).pathname)) return;
    const list = candidates.get(details.tabId) || [];
    if (list.some(x => x.url === details.url)) return;
    list.unshift({url: details.url, mime, kind, source: '網路串流'});
    candidates.set(details.tabId, list.slice(0, 60)); saveDetection();
    chrome.action.setBadgeText({tabId: details.tabId, text: String(Math.min(list.length, 60))});
    chrome.action.setBadgeBackgroundColor({tabId: details.tabId, color: '#2563eb'});
  });
}, {urls: ['http://*/*', 'https://*/*']}, ['responseHeaders']);

chrome.webRequest.onBeforeRequest.addListener(details => {
  if (details.type !== 'main_frame') return;
  ready.then(() => { if (!watched.has(details.tabId) && !candidates.has(details.tabId)) return; candidates.delete(details.tabId); saveDetection(); chrome.action.setBadgeText({tabId: details.tabId, text: ''}); });
}, {urls: ['http://*/*', 'https://*/*']});
chrome.tabs.onRemoved.addListener(id => { ready.then(() => { if (!watched.has(id) && !candidates.has(id)) return; watched.delete(id); candidates.delete(id); saveDetection(); }); });
chrome.downloads.onChanged.addListener(async delta => {
  const {jobs = []} = await chrome.storage.local.get('jobs');
  const job = jobs.find(j => j.downloadId === delta.id);
  if (!job || job.status === 'cancelled') return;
  if (delta.state?.current === 'complete') await updateJob({id: job.id, status: 'completed', progress: 100});
  else if (delta.state?.current === 'interrupted') await updateJob({id: job.id, status: delta.error?.current === 'USER_CANCELED' ? 'cancelled' : 'failed', error: delta.error?.current === 'USER_CANCELED' ? '' : delta.error?.current || '下載中斷'});
});
chrome.runtime.onStartup.addListener(async () => {
  historyWrite = historyWrite.catch(() => {}).then(async () => {
    const {jobs = []} = await chrome.storage.local.get('jobs');
    for (const job of jobs) {
      if (!['queued', 'downloading', 'processing', 'verifying'].includes(job.status)) continue;
      if (job.engine === 'native') { job.status = 'failed'; job.error = '瀏覽器已關閉，請重新下載。'; }
      else {
        const [item] = await chrome.downloads.search({id: job.downloadId});
        job.status = item?.state === 'complete' ? 'completed' : item?.state === 'in_progress' ? 'downloading' : 'failed';
      }
    }
    await chrome.storage.local.set({jobs});
  });
});
