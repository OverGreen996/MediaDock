import {publicUrl} from './media.js';

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
  return null;
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

export function selectFormats(info, quality='best', audioOnly=false, container='mp4') {
  const audio = info.formats.filter(f=>f.audio && !f.video).sort((a,b)=>Number(b.original!==false)-Number(a.original!==false) || (/mp4a|audio\/mp4/.test(b.mime)?1:0)-(/mp4a|audio\/mp4/.test(a.mime)?1:0) || b.bitrate-a.bitrate)[0];
  if (audioOnly) {if(!audio) throw new Error('找不到獨立音軌。');return [audio];}
  const video = info.formats.filter(f=>f.video && (quality==='best' || f.height===Number(quality))).sort((a,b)=>b.height-a.height || (container==='webm'?Number(/vp9|vp09|av01/.test(b.mime))-Number(/vp9|vp09|av01/.test(a.mime)):Number(/avc1/.test(b.mime))-Number(/avc1/.test(a.mime))) || b.bitrate-a.bitrate)[0];
  if (!video) throw new Error('指定畫質已失效，請重新讀取。');
  if (video.audio) return [video];
  if (!audio) throw new Error('找不到聲音，無法儲存完整影片。');
  if (Math.abs(video.duration-audio.duration)>2) throw new Error('影音片長不一致，請重新讀取。');
  return [video,audio];
}
