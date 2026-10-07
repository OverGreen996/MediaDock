import {siteName} from './media.js';
const $ = id => document.getElementById(id);
let page, info, sequence = 0;
const states = {queued: '準備下載', downloading: '下載／合併中', processing: '整理影片', verifying: '完整影音驗證中', saving: '選擇儲存位置', completed: '已儲存', failed: '下載失敗', cancelled: '已取消'};
function notice(text, error = false) { $('message').textContent = text; $('message').dataset.error = String(error); $('message').hidden = !text; }
function scanState(text, busy = false) { $('scan-state').textContent = text; $('scan-state').classList.toggle('busy', busy); }
async function send(action, data = {}) {
  const response = await chrome.runtime.sendMessage({action, ...data});
  if (!response?.ok) {
    throw new Error(response?.error || '無法連線，請重新開啟擴充功能。');
  }
  return response.data;
}
async function run(el, fn) { el.disabled = true; try { await fn(); } catch (error) { notice(error.message, true); } finally { el.disabled = false; } }
function options(url = page.url, title = info?.title || page.title) {
  return {url, title, quality: $('quality').value, mode: $('mode').value, container: $('container').value, expected: url === page.url ? info?.identity : undefined, subtitles: $('subtitles').checked, useCookies: $('cookies').checked, referer: url === page.url ? undefined : page.url};
}
function makeButton(text, action, style = 'primary') {
  const el = document.createElement('button'); el.className = style; el.textContent = text; el.addEventListener('click', () => run(el, action)); return el;
}
function empty(text) { const el = document.createElement('div'); el.className = 'empty'; el.textContent = text; return el; }
async function analyze(token) {
  $('video').hidden = false; $('media').hidden = true; $('start').disabled = true; $('quality').disabled = true;
  $('quality').replaceChildren(new Option('正在取得可用畫質…', 'best')); scanState('解析畫質', true);
  try {
    const result = await send('probe', {url: page.url, useCookies: $('cookies').checked});
    if (token !== sequence) return;
    info = result; $('page-title').textContent = info.title;
    $('page-description').textContent = [info.uploader, info.duration ? `${Math.floor(info.duration / 60)} 分 ${Math.floor(info.duration % 60)} 秒` : '', '選擇畫質，再決定存到哪裡。'].filter(Boolean).join(' · ');
    $('quality').replaceChildren(new Option('最佳可用畫質', 'best'));
    const qualities = info.qualities || (info.heights || []).map(height => ({height, width: 0}));
    for (const q of qualities) {
      const resolution = q.width > 0 ? Math.min(q.width, q.height) : q.height;
      const name = `${resolution}p${resolution >= 4320 ? ' · 8K' : resolution >= 2160 ? ' · 4K' : resolution >= 1440 ? ' · 2K' : ''}${q.width > 0 && q.width < q.height ? ` · ${q.width} × ${q.height}` : ''}`;
      $('quality').add(new Option(name, String(q.height)));
    }
    const defaultQuality = qualities.find(q => (q.width > 0 ? Math.min(q.width, q.height) : q.height) <= 1080);
    if (defaultQuality) $('quality').value = String(defaultQuality.height);
    $('quality').disabled = $('mode').value === 'audio'; $('start').disabled = !!info.live;
    scanState(info.live ? '直播暫不支援' : '可下載');
  } catch (error) {
    if (token !== sequence) return;
    scanState('解析未完成'); $('quality').replaceChildren(new Option('最佳可用畫質', 'best'));
    $('quality').disabled = true; $('start').disabled = true;
    notice(error.message + ' 請按重新掃描。', true);
  }
}
function renderMedia() {
  $('media-list').replaceChildren();
  if (!page.media.length) { $('media-list').append(empty('尚未找到媒體。先播放影片，再重新掃描。')); return; }
  page.media.forEach((media, index) => {
    const item = document.createElement('article'); item.className = 'item';
    const title = document.createElement('p'); title.className = 'item-title';
    let basename = ''; try { basename = decodeURIComponent(new URL(media.url).pathname.split('/').pop()); } catch { /* keep a safe fallback */ }
    title.textContent = `${media.kind} · ${basename || String(index + 1).padStart(2, '0')}`;
    const url = document.createElement('p'); url.className = 'item-url'; url.textContent = media.url; url.title = media.url;
    const download = async () => {
      if (!await chrome.permissions.request({origins:[new URL(media.url).origin+'/*']})) {notice('未授權這個媒體來源。');return;}
      const result = await send('start', {...options(media.url, page.title), mime:media.mime, quality: 'best', mode: media.kind === '音訊' ? 'audio' : 'video', container: 'mp4', useCookies: false});
      notice(result.cancelled ? '已取消儲存。' : '已開始下載。關閉此面板仍會繼續。');
    };
    item.append(title, url, makeButton('下載並選擇儲存位置', download));
    $('media-list').append(item);
  });
}
function renderJobs(jobs) {
  const active = jobs.filter(j => ['queued', 'downloading', 'processing', 'verifying', 'saving'].includes(j.status));
  $('count').textContent = active.length ? `${active.length} 項進行中` : jobs.length ? `${jobs.length} 項` : '';
  $('footer-status').textContent = active.length ? '關閉面板仍會繼續下載' : '按需掃描 · 瀏覽器內處理';
  $('jobs').replaceChildren();
  if (!jobs.length) { $('jobs').append(empty('還沒有下載紀錄。')); return; }
  jobs.slice(0, 20).forEach(job => {
    const item = document.createElement('article'); item.className = 'item';
    const title = document.createElement('p'); title.className = 'item-title'; title.textContent = job.title || '媒體';
    const meta = document.createElement('p'); meta.className = `item-meta${job.status === 'failed' ? ' error' : ''}`;
    const completed = job.status === 'completed' ? job.verification?.fullDecode && job.verification?.identityMatched ? '驗證完成' : '已儲存 · 未驗證' : states[job.status] || job.status;
    const width = job.verification?.videoWidth, height = job.verification?.videoHeight;
    const dimensions = height ? width && width < height ? `${width} × ${height}` : `${height}p` : '';
    meta.textContent = `${completed}${job.status === 'completed' && dimensions ? ` · ${dimensions}` : ''}${job.progress > 0 && ['downloading', 'verifying'].includes(job.status) ? ` · ${Math.round(job.progress)}%` : ''}${job.status === 'downloading' && job.speed ? ` · ${job.speed}` : ''}${job.error ? ` · ${job.error}` : ''}`;
    item.append(title, meta);
    if (['queued', 'downloading', 'processing', 'verifying', 'saving'].includes(job.status)) {
      const progress = document.createElement('progress'); progress.max = 100; if (job.progress > 0) progress.value = job.progress;
      item.append(progress); if(job.status!=='saving')item.append(makeButton('取消下載', () => send('cancel', {id: job.id}), 'subtle'));
    } else if (job.status === 'completed' && job.downloadId != null) item.append(makeButton('在資料夾中顯示', () => send('reveal', {downloadId: job.downloadId}), 'subtle'));
    $('jobs').append(item);
  });
}
async function scan(refresh = false) {
  const token = ++sequence; info = null; notice(''); scanState('正在掃描', true); $('refresh').disabled = true;
  try {
    page = await send('scan', {refresh: refresh === true}); if (token !== sequence) return;
    $('page-title').textContent = page.title || '目前頁面'; $('site').textContent = siteName(page.url);
    const isPlatform = ['YouTube', 'Bilibili'].includes(siteName(page.url));
    const h = new URL(page.url).hostname; const bili = h.endsWith('.bilibili.com') || h === 'bilibili.com';
    $('cookie-option').hidden = !bili; $('cookie-hint').hidden = !bili;
    $('watch').textContent = page.watching ? '停止串流偵測' : '啟用串流偵測'; $('watch-hint').hidden = !page.watching;
    if (isPlatform) await analyze(token);
    else {
      $('video').hidden = true; $('media').hidden = false;
      $('page-description').textContent = page.media.length ? `找到 ${page.media.length} 個媒體來源。選擇要保存的影片。` : '自動掃描影片、音訊與串流來源。';
      scanState(page.media.length ? `${page.media.length} 個來源` : '掃描完成'); renderMedia();
    }
  } catch (error) { scanState('無法掃描'); notice(error.message, true); }
  finally { if (token === sequence) $('refresh').disabled = false; }
}
$('refresh').addEventListener('click', () => scan(true));
$('setup').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('mode').addEventListener('change', () => { const audio = $('mode').value === 'audio'; $('quality').disabled = audio; $('container').disabled = audio; });
$('cookies').addEventListener('change', async () => {
  await analyze(++sequence); $('refresh').disabled = false;
});
$('start').addEventListener('click', () => run($('start'), async () => {
  notice('正在下載與驗證。完成後會詢問儲存位置。'); const result = await send('start', options());
  notice(result.cancelled ? '已取消儲存。' : '已開始下載。'); if (!result.cancelled) $('history').open = true;
}));
$('watch').addEventListener('click', () => run($('watch'), async () => {
  if (page?.watching) await send('stopWatch', {tabId: page.tabId});
  else {
    if (!await chrome.permissions.request({origins: ['http://*/*', 'https://*/*']})) { notice('未啟用串流偵測，仍可使用自動頁面掃描。'); return; }
    await send('watch');
  }
  await scan();
}));
$('clear').addEventListener('click', () => run($('clear'), () => send('clearHistory')));
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.jobs) renderJobs(changes.jobs.newValue || []); });
chrome.storage.local.get('jobs').then(data => renderJobs(data.jobs || []));
scan();
