import {publicUrl,mediaKind,siteName} from './media.js';
import {youtubeProbe,readBilibiliPage,readBilibiliApi,bilibiliResult} from './platforms.js';
import {prepareFormats} from './network.js';
let historyWrite=Promise.resolve(),creating,idleTimer;
const watched=new Set(),candidates=new Map(),probes=new Map(),running=new Set();
const ready=chrome.storage.session.get(['watched','candidates']).then(d=>{(d.watched||[]).forEach(id=>watched.add(id));Object.entries(d.candidates||{}).forEach(([id,list])=>candidates.set(Number(id),list));});
function saveDetection(){return chrome.storage.session.set({watched:[...watched],candidates:Object.fromEntries(candidates)});}
async function updateJob(patch){historyWrite=historyWrite.catch(()=>{}).then(async()=>{const {jobs=[]}=await chrome.storage.local.get('jobs'),i=jobs.findIndex(j=>j.id===patch.id);if(i>=0&&['completed','failed','cancelled'].includes(jobs[i].status))return;if(i<0)jobs.unshift({...patch,created:Date.now()});else jobs[i]={...jobs[i],...patch};await chrome.storage.local.set({jobs:jobs.slice(0,100)});});return historyWrite;}
async function offscreen(){clearTimeout(idleTimer);if(creating)return creating;creating=(async()=>{if(!(await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length)await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['BLOBS','WORKERS'],justification:'在瀏覽器內串流合併、驗證與儲存媒體。'});})();try{await creating;}finally{creating=null;}}
function releaseIdle(){clearTimeout(idleTimer);if(running.size)return;idleTimer=setTimeout(async()=>{if(running.size)return;const s=await chrome.runtime.sendMessage({target:'engine',action:'idle'}).catch(()=>null);if(s?.idle&&!running.size)await chrome.offscreen.closeDocument().catch(()=>{});},10000);}
async function currentTab(){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||!publicUrl(tab.url))throw new Error('請切換到網站影片頁，再開啟擴充。');return tab;}
async function probe(url,useLogin=true,refresh=false){
  const key=`${url}|${useLogin}`,cached=probes.get(key);if(!refresh&&cached&&Date.now()-cached.time<90000)return cached.data;
  let info;
  if(siteName(url)==='YouTube')info=await youtubeProbe(url);
  else if(siteName(url)==='Bilibili'){
    const tab=await currentTab();if(tab.url!==url)throw new Error('目前影片已切換，請重新掃描。');
    const [r]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:readBilibiliPage,args:[!!useLogin]});
    let raw=r?.result;
    if(!raw||raw.error)raw=await readBilibiliApi(url,!!useLogin);
    if(raw.error)throw new Error(raw.error);info=bilibiliResult(raw,url);
  }else throw new Error('此網站請從媒體清單選擇來源；專用解析支援 YouTube 與 Bilibili。');
  probes.set(key,{time:Date.now(),data:info});if(probes.size>12)probes.delete(probes.keys().next().value);return info;
}
async function start(m){
  const url=publicUrl(m.url);if(!url)throw new Error('網址格式不支援。');if(running.size>=2)throw new Error('已有兩項工作，完成後再開始下一項。');
  let plan;
  if(['YouTube','Bilibili'].includes(siteName(url))){
    if(m.expected?.sourceUrl!==url)throw new Error('請先掃描目前影片，再開始下載。');
    const info=await probe(url,m.useCookies!==false,true);
    if(info.identity.id!==m.expected.id||info.identity.cid!==m.expected.cid)throw new Error('影片來源已改變，請重新掃描。');
    const formats=await prepareFormats(info,m);
    plan={title:info.title,formats,expected:info.identity,duration:formats[0].duration||info.duration,quality:m.quality,mode:m.mode||'video',container:m.container||'mp4'};
  }else{
    const kind=mediaKind(url,m.mime);if(!kind)throw new Error('找不到可辨識的媒體格式。');
    if(!await chrome.permissions.contains({origins:[new URL(url).origin+'/*']}))throw new Error('請先授權此媒體來源。');
    plan={title:String(m.title||'媒體').slice(0,200),formats:[{url,video:kind!=='音訊',audio:true,mime:m.mime||'',kind}],expected:{sourceUrl:url,platform:'網站'},quality:'best',mode:kind==='音訊'?'audio':'video',container:'mp4'};
  }
  const id=crypto.randomUUID();running.add(id);await updateJob({id,title:plan.title,engine:'browser',status:'queued',progress:0});
  try{await offscreen();const r=await chrome.runtime.sendMessage({target:'engine',action:'start',plan:{...plan,id}});if(!r?.ok)throw new Error(r?.error||'下載引擎未啟動。');}catch(e){running.delete(id);await updateJob({id,status:'failed',error:e.message});releaseIdle();throw e;}return {id};
}
async function handle(m){
  await ready; await engineReady;
  switch(m.action){
    case 'status':return {ready:true,version:'0.4.1',engine:'browser'};
    case 'probe':{const u=publicUrl(m.url);if(!u)throw new Error('網址格式不支援。');return probe(u,m.useCookies!==false);}
    case 'start':case 'direct':return start(m);
    case 'cancel':{const {jobs=[]}=await chrome.storage.local.get('jobs'),j=jobs.find(j=>j.id===m.id);if(!j||!['queued','downloading','processing','verifying','saving'].includes(j.status))return {};if(j.status==='saving'&&j.downloadId==null)throw new Error('請在「另存新檔」視窗按取消。');if(j.downloadId!=null)await chrome.downloads.cancel(j.downloadId).catch(()=>{});await chrome.runtime.sendMessage({target:'engine',action:'cancel',id:j.id}).catch(()=>{});return {};}
    case 'reveal':return chrome.downloads.show(Number(m.downloadId));
    case 'scan':{
      if(m.refresh)probes.clear();const tab=await currentTab();
      if(['YouTube','Bilibili'].includes(siteName(tab.url)))return {title:tab.title,url:tab.url,media:[],tabId:tab.id,watching:false};
      const [r]=await chrome.scripting.executeScript({target:{tabId:tab.id},files:['scan.js']}),p=r?.result||{title:tab.title,url:tab.url,media:[]};
      const all=new Map([...p.media,...(candidates.get(tab.id)||[])].filter(x=>publicUrl(x.url)&&mediaKind(x.url,x.mime)).map(x=>[x.url,{...x,kind:mediaKind(x.url,x.mime)}]));
      return {...p,tabId:tab.id,watching:watched.has(tab.id),media:[...all.values()].slice(0,100)};
    }
    case 'watch':{if(!await chrome.permissions.contains({origins:['http://*/*','https://*/*']}))throw new Error('請先授權串流偵測。');const tab=await currentTab();watched.add(tab.id);await saveDetection();return {tabId:tab.id};}
    case 'stopWatch':watched.delete(m.tabId);candidates.delete(m.tabId);await saveDetection();await chrome.action.setBadgeText({tabId:m.tabId,text:''});return {};
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
chrome.webRequest.onHeadersReceived.addListener(d=>{if(!watched.size)return;ready.then(()=>{if(!watched.has(d.tabId)||!publicUrl(d.url)||d.statusCode<200||d.statusCode>=300)return;const mime=d.responseHeaders?.find(h=>h.name.toLowerCase()==='content-type')?.value||'',kind=mediaKind(d.url,mime);if(!kind||/\.([cm]?4s|ts)$|\/videoplayback$/i.test(new URL(d.url).pathname))return;const list=candidates.get(d.tabId)||[];if(list.some(x=>x.url===d.url))return;list.unshift({url:d.url,mime,kind,source:'網路串流'});candidates.set(d.tabId,list.slice(0,60));saveDetection();chrome.action.setBadgeText({tabId:d.tabId,text:String(Math.min(list.length,60))});chrome.action.setBadgeBackgroundColor({tabId:d.tabId,color:'#2563eb'});});},{urls:['http://*/*','https://*/*']},['responseHeaders']);
chrome.webRequest.onBeforeRequest.addListener(d=>{if(d.type!=='main_frame')return;ready.then(()=>{if(!watched.has(d.tabId)&&!candidates.has(d.tabId))return;candidates.delete(d.tabId);saveDetection();chrome.action.setBadgeText({tabId:d.tabId,text:''});});},{urls:['http://*/*','https://*/*']});
chrome.tabs.onRemoved.addListener(id=>{ready.then(()=>{if(!watched.has(id)&&!candidates.has(id))return;watched.delete(id);candidates.delete(id);saveDetection();});});
async function settle(downloadId,state,error){await historyWrite;const {jobs=[]}=await chrome.storage.local.get('jobs'),j=jobs.find(j=>j.downloadId===downloadId);if(!j||!running.has(j.id))return;await updateJob({id:j.id,status:state==='complete'?'completed':error==='USER_CANCELED'?'cancelled':'failed',progress:state==='complete'?100:0,error:state==='complete'||error==='USER_CANCELED'?'':error||'儲存中斷'});running.delete(j.id);await chrome.runtime.sendMessage({target:'engine',action:'release',id:j.id}).catch(()=>{});releaseIdle();}
chrome.downloads.onChanged.addListener(d=>{if(['complete','interrupted'].includes(d.state?.current))settle(d.id,d.state.current,d.error?.current);});
async function initialize(){
  const removed=['Origin','Sec-Fetch-Dest','Sec-Fetch-Mode','Sec-Fetch-Site','Sec-CH-UA','Sec-CH-UA-Mobile','Sec-CH-UA-Platform','DNT','X-Client-Data'].map(header=>({header,operation:'remove'}));
  const set=(header,value)=>({header,operation:'set',value});
  const ios='com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)';
  const android='com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12; en_US; Quest 3 Build/SQ3A.220605.009.A1) gzip';
  const rule=(id,domains,headers,regexFilter,priority=1)=>({id,priority,action:{type:'modifyHeaders',requestHeaders:headers},condition:{initiatorDomains:[chrome.runtime.id],requestDomains:domains,resourceTypes:['xmlhttprequest'],...(regexFilter?{regexFilter}:{})}});
  await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:[1,2,3,4,5,6],addRules:[
    rule(1,['bilivideo.com','bilivideo.cn','hdslb.com','akamaized.net'],[...removed,set('Referer','https://www.bilibili.com/')]),
    rule(2,['www.youtube.com','youtubei.googleapis.com'],[...removed,set('User-Agent',ios)],'/youtubei/v1/player'),
    rule(3,['api.bilibili.com'],[...removed,set('Referer','https://www.bilibili.com/'),set('User-Agent','node')]),
    rule(4,['googlevideo.com'],[...removed,set('Referer','https://www.youtube.com/'),set('User-Agent',ios)]),
    rule(5,['googlevideo.com'],[set('User-Agent',android)],'[?&]c=ANDROID_VR(?:&|$)',2),
    rule(6,['youtubei.googleapis.com'],[set('User-Agent',android)],'/youtubei/v1/player.*[?&]md_client=ANDROID_VR',2)
  ]});
  const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']}),{jobs=[]}=await chrome.storage.local.get('jobs');
  if(contexts.length){for(const j of jobs)if(['queued','downloading','processing','verifying','saving'].includes(j.status))running.add(j.id);return;}
  for(const j of jobs)if(['queued','downloading','processing','verifying','saving'].includes(j.status)){j.status='failed';j.error='瀏覽器或擴充已重新啟動，請重新下載。';}await chrome.storage.local.set({jobs});
}
const engineReady=initialize(); engineReady.catch(console.error);
