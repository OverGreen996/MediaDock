import {cdnUrl,selectFormats,youtubeProbe} from './platforms.js';

function attributes(line){return Object.fromEntries([...line.matchAll(/([\w-]+)=(?:"([^"]*)"|([^,]*))/g)].map(m=>[m[1],m[2]??m[3]]));}
export function youtubeHlsFormats(text,url,duration){
  if(!text.startsWith('#EXTM3U')||text.length>2*1024*1024)throw new Error('YouTube 串流清單不正確。');
  const lines=text.split(/\r?\n/).map(s=>s.trim()),groups=new Map(),formats=[];
  for(const line of lines)if(line.startsWith('#EXT-X-MEDIA:')){const a=attributes(line);if(a.TYPE==='AUDIO'&&a.URI){const audio=cdnUrl(new URL(a.URI,url).href,'YouTube');if(audio)groups.set(a['GROUP-ID'],{id:'hls-audio-'+a['GROUP-ID'],url:audio,kind:'HLS',video:false,audio:true,mime:'audio/mp4',duration,bitrate:0,original:a.DEFAULT==='YES'});}}
  for(let i=0;i<lines.length;i++)if(lines[i].startsWith('#EXT-X-STREAM-INF:')){
    const a=attributes(lines[i]),size=a.RESOLUTION?.match(/^(\d+)x(\d+)$/),next=lines[i+1];
    if(!size||!next||next.startsWith('#'))continue;
    const source=cdnUrl(new URL(next,url).href,'YouTube');if(!source)continue;
    const separate=groups.get(a.AUDIO);
    formats.push({id:'hls-'+size[2]+'-'+i,url:source,kind:'HLS',video:true,audio:!separate&&/mp4a|aac|opus/.test(a.CODECS||''),width:Number(size[1]),height:Number(size[2]),mime:'video/mp4; codecs="'+(a.CODECS||'')+'"',duration,bitrate:Number(a.BANDWIDTH)||0,audioGroup:separate?.id});
  }
  return [...formats,...groups.values()];
}
async function response(url,fetcher,manifest=false,range='bytes=0-1023'){
  const r=await fetcher(url,{cache:'no-store',credentials:'omit',headers:manifest?{}:{Range:range},signal:AbortSignal.timeout(12000)});
  if(!r.ok){await r.body?.cancel().catch(()=>{});throw new Error(`影音來源回應 ${r.status}`);}
  if(/text\/html|application\/json/i.test(r.headers.get('content-type')||'')){await r.body?.cancel().catch(()=>{});throw new Error('影音來源回傳網頁或錯誤訊息。');}
  return r;
}
export async function checkFormats(formats,platform,fetcher=fetch){
  const checked=[];
  for(const f of formats){
    let chosen,reason;
    for(const url of [...new Set([f.url,...(f.backups||[])])].slice(0,4)){
      if(!cdnUrl(url,platform))continue;
      try{
        const r=await response(url,fetcher,f.kind==='HLS');let duration=f.duration;
        if(f.kind==='HLS'){
          const text=await r.text();if(text.length>2*1024*1024||!text.startsWith('#EXTM3U'))throw new Error('影音串流清單不正確。');
          if(/#EXT-X-KEY:.*METHOD=(?!NONE)/.test(text)||/#EXT-X-SESSION-KEY/.test(text))throw new Error('此串流含加密保護，暫不支援。');
          if(!text.includes('#EXT-X-ENDLIST'))throw new Error('此串流不是已結束的隨選影片。');
          const times=[...text.matchAll(/#EXTINF:([\d.]+)/g)].map(m=>Number(m[1]));if(!times.length)throw new Error('串流沒有影音分段。');
          duration=times.reduce((a,b)=>a+b,0);
          const segment=text.split(/\r?\n/).map(s=>s.trim()).find(s=>s&&!s.startsWith('#'));
          const segmentUrl=cdnUrl(new URL(segment,url).href,platform);if(!segmentUrl)throw new Error('串流來源網域不正確。');
          const media=await response(segmentUrl,fetcher);const reader=media.body.getReader();try{if((await reader.read()).done)throw new Error('影音來源沒有資料。');}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
        }else{
          const length=f.length||Number(r.headers.get('content-range')?.split('/')[1])||0;
          const reader=r.body.getReader();try{if((await reader.read()).done)throw new Error('影音來源沒有資料。');}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
          if(length>1024){const tail=await response(url,fetcher,false,`bytes=${length-1024}-${length-1}`);const reader=tail.body.getReader();try{if((await reader.read()).done)throw new Error('影音來源結尾沒有資料。');}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
        }
        chosen={...f,url,duration,backups:[...new Set([f.url,...(f.backups||[])])].filter(u=>u!==url&&cdnUrl(u,platform))};break;
      }catch(error){reason=error.message;}
    }
    if(!chosen)throw new Error(reason||'沒有可連線的影音來源。');checked.push(chosen);
  }
  return checked;
}
export async function prepareFormats(info,options,fetcher=fetch){
  const select=data=>selectFormats(data,options.quality,options.mode==='audio',options.container);
  if(info.sabr)return select(info);
  let reason;
  try{return await checkFormats(select(info),info.platform,fetcher);}catch(error){reason=error.message;}
  const primaryReason=reason;
  if(info.platform!=='YouTube')throw new Error(`${info.platform} ${reason}。請在網站播放後重新讀取。`);
  let alternate;
  try{alternate=await youtubeProbe(info.identity.sourceUrl,fetcher,info.client==='ANDROID_VR'?'iOS':'ANDROID_VR');return await checkFormats(select(alternate),'YouTube',fetcher);}catch(error){reason=error.message||reason;}
  for(const data of [info,alternate].filter(d=>d?.hls))try{
    const r=await response(data.hls,fetcher,true),formats=youtubeHlsFormats(await r.text(),data.hls,data.duration);
    let selected=select({...data,formats});
    const group=selected[0].audioGroup;if(group){const audio=formats.find(f=>f.id===group);if(!audio)throw new Error('串流缺少相符音訊。');selected=[selected[0],audio];}
    return await checkFormats(selected,'YouTube',fetcher);
  }catch(error){reason=error.message;}
  throw new Error(`YouTube 目前沒有能下載的相同畫質來源（${[...new Set([primaryReason,reason])].join('；備援：')}）。重新讀取不一定能解除來源限制；不會改下載其他影片或降低畫質。`);
}
