import {publicUrl} from './media.js';
import {youtubeProbe,youtubeId} from './platforms.js';
import {prepareFormats} from './network.js';
import {readYouTubePlayer} from './youtube-page.js';
import {sabrInfo} from './sabr.bundle.js';
let historyWrite=Promise.resolve(),creating,idleTimer;
const probes=new Map(),running=new Set();
const playback=new Map();
chrome.webRequest.onBeforeRequest.addListener(d=>{
 if(d.tabId<0||d.method!=='POST'||!d.url.includes('sabr=1')||!d.requestBody?.raw)return;
 const parts=d.requestBody.raw.map(p=>p.bytes).filter(Boolean);const length=parts.reduce((n,b)=>n+b.byteLength,0);if(!length||length>256*1024)return;
 const bytes=new Uint8Array(length);let at=0;for(const part of parts){bytes.set(new Uint8Array(part),at);at+=part.byteLength;}
 const entries=(playback.get(d.tabId)||[]).filter(c=>Date.now()-c.time<120000);entries.push({url:d.url,bytes,time:Date.now()});playback.set(d.tabId,entries.slice(-3));if(playback.size>8)playback.delete(playback.keys().next().value);
},{urls:['https://*.googlevideo.com/videoplayback*'],types:['xmlhttprequest']},['requestBody']);
chrome.tabs.onRemoved.addListener(id=>playback.delete(id));
async function updateJob(patch){historyWrite=historyWrite.catch(()=>{}).then(async()=>{const {jobs=[]}=await chrome.storage.local.get('jobs'),i=jobs.findIndex(j=>j.id===patch.id);if(i>=0&&['completed','failed','cancelled'].includes(jobs[i].status))return;if(i<0)jobs.unshift({...patch,created:Date.now()});else jobs[i]={...jobs[i],...patch};await chrome.storage.local.set({jobs:jobs.slice(0,100)});});return historyWrite;}
async function offscreen(){clearTimeout(idleTimer);if(creating)return creating;creating=(async()=>{if(!(await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length)await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['BLOBS','WORKERS'],justification:'在瀏覽器內串流合併、驗證與儲存媒體。'});})();try{await creating;}finally{creating=null;}}
function releaseIdle(){clearTimeout(idleTimer);if(running.size)return;idleTimer=setTimeout(async()=>{if(running.size)return;const s=await chrome.runtime.sendMessage({target:'engine',action:'idle'}).catch(()=>null);if(s?.idle&&!running.size)await chrome.offscreen.closeDocument().catch(()=>{});},10000);}
async function currentTab(){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||!publicUrl(tab.url))throw new Error('請切換到網站影片頁，再開啟擴充。');return tab;}
async function probe(url,refresh=false){
  if(!youtubeId(url))throw new Error('請開啟 YouTube 一般影片或 Shorts 的播放頁。');
  const cached=probes.get(url);if(!refresh&&cached&&Date.now()-cached.time<90000)return cached.data;
  let info;const tab=await currentTab();
  if(tab.url===url){
    const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:readYouTubePlayer});const raw=result?.result;
    if(raw&&!raw.error){
      const until=Date.now()+20000;let reason='請先播放主影片，等播放驗證就緒後重新讀取。';
      do{for(const capture of (playback.get(tab.id)||[]).filter(c=>Date.now()-c.time<120000).reverse())try{info=sabrInfo(raw,capture,url);break;}catch(e){reason=e.message;}
        if(info)break;await new Promise(resolve=>setTimeout(resolve,500));
      }while(Date.now()<until);
      if(!info)throw new Error(reason);
    }
  }
  if(!info)info=await youtubeProbe(url);probes.set(url,{time:Date.now(),data:info});if(probes.size>12)probes.delete(probes.keys().next().value);return info;
}
async function start(m){
  const url=publicUrl(m.url);if(!url)throw new Error('網址格式不支援。');if(running.size>=2)throw new Error('已有兩項工作，完成後再開始下一項。');
  if(!youtubeId(url))throw new Error('此版本只支援 YouTube 影片與 Shorts。');
  if(m.expected?.sourceUrl!==url)throw new Error('請先讀取目前影片，再開始下載。');
  const tab=await currentTab();if(tab.url!==url)throw new Error('目前影片已切換，請重新讀取。');
  if(m.mode&&m.mode!=='video')throw new Error('此版本只下載完整影片與聲音。');
  let info=await probe(url,true);
  if((await currentTab()).url!==url||info.identity.id!==m.expected.id)throw new Error('影片來源已改變，請重新讀取。');
  const options={quality:m.quality,mode:'video',container:'mp4'};let formats;
  if(info.sabr)try{const direct=await youtubeProbe(url);if(info.sabr.audioTrackId){if(!direct.formats.some(f=>f.audio&&!f.video&&f.language===info.sabr.audioTrackId))throw new Error('備援沒有目前播放器的音軌。');for(const f of direct.formats)if(f.audio&&!f.video)f.original=f.language===info.sabr.audioTrackId;}if(direct.identity.id!==info.identity.id)throw new Error('影片來源不符。');formats=await prepareFormats(direct,options);info=direct;}catch{}
  if(!formats)formats=await prepareFormats(info,options);
  if((await currentTab()).url!==url)throw new Error('目前影片已切換，請重新讀取。');
  const plan={title:info.title,formats,sabr:info.sabr,expected:info.identity,duration:formats[0].duration||info.duration,quality:String(formats[0].height),mode:'video',container:'mp4'};
  const id=crypto.randomUUID();running.add(id);await updateJob({id,title:plan.title,engine:'browser',status:'queued',progress:0});
  try{await offscreen();const r=await chrome.runtime.sendMessage({target:'engine',action:'start',plan:{...plan,id}});if(!r?.ok)throw new Error(r?.error||'下載引擎未啟動。');}catch(e){running.delete(id);await updateJob({id,status:'failed',error:e.message});releaseIdle();throw e;}return {id};
}
async function handle(m){
  await engineReady;
  switch(m.action){
    case 'status':return {ready:true,version:'0.5.0',engine:'browser'};
    case 'probe':{const u=publicUrl(m.url);if(!u)throw new Error('網址格式不支援。');const {formats,sabr,...summary}=await probe(u);return summary;}
    case 'start':return start(m);
    case 'cancel':{const {jobs=[]}=await chrome.storage.local.get('jobs'),j=jobs.find(j=>j.id===m.id);if(!j||!['queued','downloading','processing','verifying','saving'].includes(j.status))return {};if(j.status==='saving'&&j.downloadId==null)throw new Error('請在「另存新檔」視窗按取消。');if(j.downloadId!=null)await chrome.downloads.cancel(j.downloadId).catch(()=>{});await chrome.runtime.sendMessage({target:'engine',action:'cancel',id:j.id}).catch(()=>{});return {};}
    case 'reveal':return chrome.downloads.show(Number(m.downloadId));
    case 'scan':{if(m.refresh)probes.clear();const tab=await currentTab();return {title:tab.title,url:tab.url,tabId:tab.id,supported:!!youtubeId(tab.url)};}
    case 'clearHistory':historyWrite=historyWrite.catch(()=>{}).then(async()=>{const {jobs=[]}=await chrome.storage.local.get('jobs');await chrome.storage.local.set({jobs:jobs.filter(j=>['queued','downloading','processing','verifying','saving'].includes(j.status))});});await historyWrite;return {};
    default:throw new Error('不支援的操作');
  }
}
function youtubeVideoId(url){try{const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='www.youtube.com')return null;const id=u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/shorts\/([\w-]{11})\/?$/)?.[1];return /^[\w-]{11}$/.test(id||'')?id:null;}catch{return null;}}
async function openFromYouTube(s){if(s.id!==chrome.runtime.id||s.frameId!==0||!s.tab?.id||!youtubeVideoId(s.url))throw new Error('未授權的來源');const [t]=await chrome.tabs.query({active:true,windowId:s.tab.windowId});if(t?.id!==s.tab.id||youtubeVideoId(t.url)!==youtubeVideoId(s.url))throw new Error('影片分頁已切換，請在目前影片按下載。');await chrome.action.openPopup({windowId:s.tab.windowId});return {};}
async function engineMessage(m){
  if(m.action==='job'){if(!running.has(m.job.id))return {};await updateJob(m.job);if(['failed','cancelled'].includes(m.job.status)){running.delete(m.job.id);releaseIdle();}return {};}
  if(m.action==='saveFile'){
    if(!running.has(m.id)||!m.verification?.fullDecode||!m.verification?.identityMatched||!m.url.startsWith(`blob:${chrome.runtime.getURL('')}`))throw new Error('檔案尚未通過驗證。');
    await updateJob({id:m.id,status:'saving',verification:m.verification});const downloadId=await chrome.downloads.download({url:m.url,filename:m.filename,saveAs:true});await updateJob({id:m.id,downloadId});const [i]=await chrome.downloads.search({id:downloadId});if(i?.state==='complete')await settle(downloadId,'complete');else if(i?.state==='interrupted')await settle(downloadId,'interrupted',i.error);return {downloadId};
  }throw new Error('不支援的引擎訊息');
}
chrome.runtime.onMessage.addListener((m,s,respond)=>{
  if(m.target==='engine')return false;
  if(m.action==='openDownloader'){openFromYouTube(s).then(data=>respond({ok:true,data}),e=>respond({ok:false,error:e.message}));return true;}
  if(s.id!==chrome.runtime.id||s.tab||!s.url?.startsWith(chrome.runtime.getURL(''))){respond({ok:false,error:'未授權的來源'});return false;}
  const task=s.url===chrome.runtime.getURL('offscreen.html')?engineMessage(m):handle(m);task.then(data=>respond({ok:true,data}),e=>respond({ok:false,error:e.message}));return true;
});
async function settle(downloadId,state,error){await historyWrite;const {jobs=[]}=await chrome.storage.local.get('jobs'),j=jobs.find(j=>j.downloadId===downloadId);if(!j||!running.has(j.id))return;await updateJob({id:j.id,status:state==='complete'?'completed':error==='USER_CANCELED'?'cancelled':'failed',progress:state==='complete'?100:0,error:state==='complete'||error==='USER_CANCELED'?'':error||'儲存中斷'});running.delete(j.id);await chrome.runtime.sendMessage({target:'engine',action:'release',id:j.id}).catch(()=>{});releaseIdle();}
chrome.downloads.onChanged.addListener(d=>{if(['complete','interrupted'].includes(d.state?.current))settle(d.id,d.state.current,d.error?.current);});
async function initialize(){
  await chrome.storage.session.remove(['watched','candidates']);
  const removed=['Origin','Sec-Fetch-Dest','Sec-Fetch-Mode','Sec-Fetch-Site','Sec-CH-UA','Sec-CH-UA-Mobile','Sec-CH-UA-Platform','DNT','X-Client-Data'].map(header=>({header,operation:'remove'}));
  const set=(header,value)=>({header,operation:'set',value});
  const ios='com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)';
  const android='com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12; en_US; Quest 3 Build/SQ3A.220605.009.A1) gzip';
  const rule=(id,domains,headers,regexFilter,priority=1)=>({id,priority,action:{type:'modifyHeaders',requestHeaders:headers},condition:{initiatorDomains:[chrome.runtime.id],requestDomains:domains,resourceTypes:['xmlhttprequest'],...(regexFilter?{regexFilter}:{})}});
  await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:[1,2,3,4,5,6,7],addRules:[
    rule(2,['www.youtube.com','youtubei.googleapis.com'],[...removed,set('User-Agent',ios)],'/youtubei/v1/player'),
    rule(4,['googlevideo.com'],[...removed,set('Referer','https://www.youtube.com/')]),
    rule(1,['googlevideo.com'],[set('User-Agent',ios)],'[?&]c=IOS(?:&|$)',2),
    rule(5,['googlevideo.com'],[set('User-Agent',android)],'[?&]c=ANDROID_VR(?:&|$)',2),
    rule(6,['youtubei.googleapis.com'],[set('User-Agent',android)],'/youtubei/v1/player.*[?&]md_client=ANDROID_VR',2),
    rule(7,['googlevideo.com'],[set('User-Agent',navigator.userAgent)],'[?&]c=WEB(?:&|$)',2)
  ]});
  const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']}),{jobs=[]}=await chrome.storage.local.get('jobs');
  if(contexts.length){for(const j of jobs)if(['queued','downloading','processing','verifying','saving'].includes(j.status))running.add(j.id);return;}
  for(const j of jobs)if(['queued','downloading','processing','verifying','saving'].includes(j.status)){j.status='failed';j.error='瀏覽器或擴充已重新啟動，請重新下載。';}await chrome.storage.local.set({jobs});
}
const engineReady=initialize(); engineReady.catch(console.error);
