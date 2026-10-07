import {youtubeId} from './platforms.js';
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
function options(){return {url:page.url,quality:$('quality').value,expected:info?.identity};}
function makeButton(text, action, style = 'primary') {
  const el = document.createElement('button'); el.className = style; el.textContent = text; el.addEventListener('click', () => run(el, action)); return el;
}
function empty(text) { const el = document.createElement('div'); el.className = 'empty'; el.textContent = text; return el; }
async function analyze(token) {
  $('video').hidden = false; $('start').disabled = true; $('quality').disabled = true;
  $('quality').replaceChildren(new Option('正在取得可用畫質…', 'best')); scanState('解析畫質', true);
  try {
    const result = await send('probe', {url: page.url});
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
    $('quality').disabled = false; $('start').disabled = !!info.live;
    scanState(info.live ? '直播暫不支援' : '已讀取畫質');
  } catch (error) {
    if (token !== sequence) return;
    scanState('解析未完成'); $('quality').replaceChildren(new Option('最佳可用畫質', 'best'));
    $('quality').disabled = true; $('start').disabled = true;
    notice(error.message + ' 請重新讀取影片。', true);
  }
}
function renderJobs(jobs) {
  const active = jobs.filter(j => ['queued', 'downloading', 'processing', 'verifying', 'saving'].includes(j.status));
  $('count').textContent = active.length ? `${active.length} 項進行中` : jobs.length ? `${jobs.length} 項` : '';
  $('footer-status').textContent = active.length ? '關閉面板仍會繼續下載' : '僅限 YouTube · 瀏覽器內處理';
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
  const token = ++sequence; info = null; notice(''); scanState('正在讀取', true); $('refresh').disabled = true;
  try {
    page = await send('scan', {refresh: refresh === true}); if (token !== sequence) return;
    $('site').textContent = 'YouTube';
    if (youtubeId(page.url)) await analyze(token);
    else { $('video').hidden=true;scanState('僅限 YouTube');$('page-title').textContent='開啟 YouTube 影片';$('page-description').textContent='支援一般影片與 Shorts。開啟播放頁後，再點 MediaDock。'; }
  } catch (error) { scanState('無法讀取'); notice(error.message, true); }
  finally { if (token === sequence) $('refresh').disabled = false; }
}
$('refresh').addEventListener('click', () => scan(true));
$('setup').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('start').addEventListener('click', () => run($('start'), async () => {
  notice('正在核對可下載來源，接著下載與驗證。完成後詢問儲存位置。'); const result = await send('start', options());
  notice(result.cancelled ? '已取消儲存。' : '已開始下載。'); if (!result.cancelled) $('history').open = true;
}));
$('clear').addEventListener('click', () => run($('clear'), () => send('clearHistory')));
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.jobs) renderJobs(changes.jobs.newValue || []); });
chrome.storage.local.get('jobs').then(data => renderJobs(data.jobs || []));
scan();
