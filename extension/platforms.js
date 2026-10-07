import {publicUrl} from './media.js';
import {md5} from './crypto.bundle.js';

export function youtubeId(value) {
  const u = new URL(value);
  if (!['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(u.hostname)) return null;
  const id = u.hostname === 'youtu.be' ? u.pathname.slice(1) : u.pathname === '/watch' ? u.searchParams.get('v') : u.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})\/?$/)?.[1];
  return /^[\w-]{11}$/.test(id || '') ? id : null;
}
export function cdnUrl(value, platform) {
  let clean = publicUrl(value);
  if (!clean) return null;
  const h = new URL(clean).hostname;
  if (platform === 'YouTube') return clean.startsWith('https://')&&h.endsWith('.googlevideo.com') ? clean : null;
  if (platform === 'Bilibili') {if(!(['bilivideo.com','bilivideo.cn','hdslb.com'].some(d => h === d || h.endsWith('.'+d)) || /^upos[\w.-]*\.akamaized\.net$/.test(h)))return null;const u=new URL(clean);u.protocol='https:';return u.href;}
  return clean.startsWith('https://')?clean:null;
}
export function summarize(data) {
  const qualities = [...new Map(data.formats.filter(f => f.video && f.height > 0).sort((a,b) => b.height-a.height || b.width-a.width).map(f => [f.height,{height:f.height,width:f.width}])).values()];
  return {...data, qualities, heights:qualities.map(q=>q.height)};
}
export async function youtubeProbe(url, fetcher = fetch, onlyClient) {
  const id = youtubeId(url);
  if (!id) throw new Error('請開啟 YouTube 影片或 Shorts 的播放頁。');
  let reason = '目前無法取得可下載的影音來源';
  const clients = [
    {clientName:'iOS',clientVersion:'20.11.6',deviceMake:'Apple',deviceModel:'iPhone10,4',osName:'iOS',osVersion:'16.7.7.20H330'},
    {clientName:'ANDROID_VR',clientVersion:'1.65.10',deviceMake:'Oculus',deviceModel:'Quest 3',osName:'Android',osVersion:'12'},
  ];
  for (const client of clients.filter(c=>!onlyClient||c.clientName===onlyClient)) {
    try {
    const response = await fetcher('https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false&md_client='+client.clientName, {
      method:'POST', credentials:'omit', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({videoId:id,context:{client:{...client,hl:'en',gl:'US'}},contentCheckOk:true,racyCheckOk:true}), signal:AbortSignal.timeout(25000)
    });
    if (!response.ok) {reason=`YouTube 回應 ${response.status}`; continue;}
    const json = await response.json();
    if (json.videoDetails?.videoId !== id) {reason=json.playabilityStatus?.reason || '影片來源無法核對';continue;}
    if (json.videoDetails.isLiveContent && (json.videoDetails.isLive || !json.streamingData?.adaptiveFormats?.length)) throw new Error('直播暫不支援。');
    const formats = [...(json.streamingData?.formats||[]),...(json.streamingData?.adaptiveFormats||[])].filter(f=>!f.drmFamilies?.length && !f.signatureCipher && !f.cipher && !f.url?.includes('sabr=1')).map(f=>({
      id:String(f.itag),url:cdnUrl(f.url,'YouTube'),mime:f.mimeType||'',video:!!f.width,audio:!!f.audioQuality||!!f.audioBitrate,
      width:Number(f.width)||0,height:Number(f.height)||0,bitrate:Number(f.bitrate)||0,length:Number(f.contentLength)||0,
      language:f.audioTrack?.id || '',original:f.audioTrack?.audioIsDefault !== false,duration:Number(f.approxDurationMs)/1000 || Number(json.videoDetails.lengthSeconds)
    })).filter(f=>f.url && !new URL(f.url).searchParams.has('n'));
    if (!formats.some(f=>f.video) || !formats.some(f=>f.audio)) continue;
    return summarize({title:json.videoDetails.title,uploader:json.videoDetails.author,duration:Number(json.videoDetails.lengthSeconds),live:false,platform:'YouTube',client:client.clientName,hls:cdnUrl(json.streamingData?.hlsManifestUrl,'YouTube'),formats,identity:{id,sourceUrl:url,platform:'YouTube',duration:Number(json.videoDetails.lengthSeconds)}});
    } catch(error) {reason=error.message||'無法連線到 YouTube';}
  }
  throw new Error(`${reason}。網站解析可能需要更新；不會用其他影片代替。`);
}

// Executed in the current Bilibili page. Credentials stay in the browser; no cookie API or export.
export async function readBilibiliPage(useLogin, pageUrl) {
  try {
  const href=pageUrl || location.href;
  const u = new URL(href), match = u.pathname.match(/\/video\/(BV[\w]+|av\d+)/i);
  if (!match) throw new Error('請開啟完整的 Bilibili 影片播放頁。');
  if(!useLogin)throw new Error('未使用網站登入狀態。');
  const state=globalThis.__INITIAL_STATE__,video=state?.videoData,play=globalThis.__playinfo__?.data;
  if(!video||!play)throw new Error('網站播放器尚未提供影音資料。');
  if(match[1].startsWith('BV')?video.bvid!==match[1]:String(video.aid)!==match[1].slice(2))throw new Error('網站播放器的影片已切換。');
  const partNumber = Number(u.searchParams.get('p') || 1);
  if (!Number.isInteger(partNumber)||partNumber < 1) throw new Error('分 P 編號不正確。');
  const part = video.pages?.find(p=>p.page===partNumber);
  if (!part) throw new Error('找不到目前的分 P。');
  const cid=Number(state.cid||video.cid);
  if(cid!==Number(part.cid))throw new Error('網站播放器的分 P 尚未更新。');
  const urls=[...(play.dash?.video||[]),...(play.durl||[])].map(f=>f.baseUrl||f.base_url||f.url);
  if(!urls.some(value=>{try{return new URL(value).pathname.split('/').some(s=>s===String(part.cid)||s.startsWith(part.cid+'-'));}catch{return false;}}))throw new Error('網站影音來源無法核對目前 CID。');
  return {video:{bvid:video.bvid,aid:video.aid,title:video.title,uploader:video.owner?.name},part,play:{timelength:play.timelength,quality:play.quality,dash:play.dash,durl:play.durl},sourceUrl:href,via:'page'};
  } catch(error) { return {error:error.message || '讀取 Bilibili 失敗。'}; }
}
export function signWbi(params, images, now=Date.now()) {
  const table=[46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
  const keys=['img_url','sub_url'].map(k=>new URL(images[k]).pathname.split('/').pop().split('.')[0]).join('');
  if(keys.length<64)throw new Error('Bilibili 簽名資料不完整。');
  const key=table.map(i=>keys[i]).join('').slice(0,32);
  const values={...params,wts:Math.floor(now/1000)};
  const query=Object.keys(values).sort().map(k=>encodeURIComponent(k)+'='+encodeURIComponent(String(values[k]).replace(/[!'()*]/g,''))).join('&');
  const digest=Array.from(md5(new TextEncoder().encode(query+key)),b=>b.toString(16).padStart(2,'0')).join('');
  return query+'&w_rid='+digest;
}
export async function readBilibiliApi(url,useLogin,fetcher=fetch) {
  const u=new URL(url),id=u.pathname.match(/\/video\/(BV[\w]+|av\d+)/i)?.[1];
  if(!id)throw new Error('請開啟完整的 Bilibili 影片播放頁。');
  const api=async(path,allowFailure=false)=>{
    const response=await fetcher('https://api.bilibili.com/'+path,{credentials:useLogin?'include':'omit',signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error(`Bilibili 解析回應 ${response.status}`);
    const json=await response.json();if(json.code!==0&&!allowFailure)throw new Error(json.message||`Bilibili 解析回應 ${json.code}`);return json.data;
  };
  const video=await api('x/web-interface/view?'+(id.startsWith('BV')?'bvid='+encodeURIComponent(id):'aid='+id.slice(2)));
  const p=Number(u.searchParams.get('p')||1),part=video.pages?.find(part=>part.page===p);
  if(!Number.isInteger(p)||!part)throw new Error('找不到目前的分 P。');
  const params={bvid:video.bvid,cid:part.cid,qn:127,fnval:4048,fnver:0,fourk:1};
  let play,reason;
  try{const nav=await api('x/web-interface/nav',true);play=await api('x/player/wbi/playurl?'+signWbi(params,nav.wbi_img));}catch(error){reason=error.message;}
  if(!play)try{play=await api('x/player/playurl?'+new URLSearchParams(params));}catch(error){throw new Error(`${reason||error.message}。請先在網站正常播放，再重新掃描。`);}
  return {video:{bvid:video.bvid,aid:video.aid,title:video.title,uploader:video.owner?.name},part,play,sourceUrl:url,via:'api'};
}
export function bilibiliResult(raw, url) {
  const u = new URL(url), id = u.pathname.match(/\/video\/(BV[\w]+|av\d+)/i)?.[1];
  if (!id || raw.sourceUrl !== url || (id.startsWith('BV')?raw.video.bvid!==id:`av${raw.video.aid}`!==id) || raw.part.page!==Number(u.searchParams.get('p')||1)) throw new Error('影片或分 P 已切換，請重新掃描。');
  const duration = raw.play.timelength/1000;
  let formats = ['video','audio'].flatMap(type=>(raw.play.dash?.[type]||[]).map(f=>({
    id:`${type}-${f.id}-${f.codecs}`,url:cdnUrl(f.baseUrl||f.base_url,'Bilibili'),mime:`${f.mimeType||f.mime_type||`${type}/mp4`}; codecs="${f.codecs}"`,
    video:type==='video',audio:type==='audio',width:f.width||0,height:f.height||0,bitrate:f.bandwidth||0,length:0,duration,
    backups:(f.backupUrl||f.backup_url||[]).map(url=>cdnUrl(url,'Bilibili')).filter(Boolean)
  }))).filter(f=>f.url);
  if (!formats.length && raw.play.durl?.length===1) {
    const q=raw.play.quality,height=({16:360,32:480,64:720,74:720,80:1080,112:1080,116:1080,120:2160,125:2160,126:2160,127:4320})[q];
    formats=[{id:String(q),url:cdnUrl(raw.play.durl[0].url,'Bilibili'),mime:'video/mp4',video:true,audio:true,width:0,height:height||0,bitrate:0,length:raw.play.durl[0].size||0,duration}].filter(f=>f.url);
  }
  if (!formats.some(f=>f.video) || !formats.some(f=>f.audio)) throw new Error('此影片目前沒有完整的可下載影音來源。');
  return summarize({title:raw.video.title+(raw.part.page>1?` · P${raw.part.page} ${raw.part.part}`:''),uploader:raw.video.uploader,duration,live:false,platform:'Bilibili',via:raw.via,formats,identity:{id:raw.video.bvid,cid:String(raw.part.cid),part:raw.part.page,sourceUrl:url,platform:'Bilibili',duration}});
}

export function selectFormats(info, quality='best', audioOnly=false, container='mp4') {
  const audio = info.formats.filter(f=>f.audio && !f.video).sort((a,b)=>Number(b.original!==false)-Number(a.original!==false) || (/mp4a|audio\/mp4/.test(b.mime)?1:0)-(/mp4a|audio\/mp4/.test(a.mime)?1:0) || b.bitrate-a.bitrate)[0];
  if (audioOnly) {if(!audio) throw new Error('找不到獨立音軌。');return [audio];}
  const video = info.formats.filter(f=>f.video && (quality==='best' || f.height===Number(quality))).sort((a,b)=>b.height-a.height || (container==='webm'?Number(/vp9|vp09|av01/.test(b.mime))-Number(/vp9|vp09|av01/.test(a.mime)):Number(/avc1/.test(b.mime))-Number(/avc1/.test(a.mime))) || b.bitrate-a.bitrate)[0];
  if (!video) throw new Error('指定畫質已失效，請重新掃描。');
  if (video.audio) return [video];
  if (!audio) throw new Error('找不到聲音，無法儲存完整影片。');
  if (Math.abs(video.duration-audio.duration)>2) throw new Error('影音片長不一致，請重新掃描。');
  return [video,audio];
}
