import {SabrStream} from 'googlevideo/sabr-stream';
import {VideoPlaybackAbrRequest} from 'googlevideo/protos';
import {Logger,LogLevel} from 'googlevideo/utils';
import {cdnUrl,youtubeId,summarize} from '../extension/platforms.js';
Logger.getInstance().setLogLevels(LogLevel.NONE);
export function decodeCapture(bytes){
  if(bytes.length>256*1024)throw new Error('YouTube 播放請求過大。');
  const request=VideoPlaybackAbrRequest.decode(new Uint8Array(bytes));
  const b64=bytes=>{let text='';for(let i=0;i<bytes.length;i+=4096)text+=String.fromCharCode(...bytes.subarray(i,i+4096));return btoa(text);};
  if(!request.videoPlaybackUstreamerConfig||!request.streamerContext?.clientInfo)throw new Error('YouTube 播放來源尚未完整。');
  if((request.streamerContext.poToken?.length||0)<32)throw new Error('請先播放主影片，等播放驗證就緒後重新讀取。');
  return {audioTrackId:request.clientAbrState?.audioTrackId||'',videoPlaybackUstreamerConfig:b64(request.videoPlaybackUstreamerConfig),clientInfo:request.streamerContext.clientInfo,poToken:request.streamerContext.poToken?.length?b64(request.streamerContext.poToken):undefined};
}
export function sabrInfo(raw,capture,url){
 if(raw.error||raw.id!==youtubeId(url)||raw.sourceUrl!==url)throw new Error(raw.error||'目前影片已切換。');
 const source=cdnUrl(capture.url,'YouTube'),original=cdnUrl(raw.rawUrl,'YouTube');
 if(!source||!original||new URL(source).searchParams.get('sabr')!=='1'||!new URL(original).searchParams.get('id')||new URL(source).searchParams.get('id')!==new URL(original).searchParams.get('id'))throw new Error('播放來源與目前影片不符。');
 const config=decodeCapture(capture.bytes);if(config.clientInfo.clientName!==1)throw new Error('播放來源不是目前的 YouTube 網頁播放器。');
 const formats=raw.formats.map(f=>({id:String(f.itag),url:source,kind:'SABR',mime:f.mimeType||'',video:!!f.width,audio:!!f.audioQuality,width:Number(f.width)||0,height:Number(f.height)||0,bitrate:Number(f.bitrate)||0,original:config.audioTrackId?f.audioTrackId===config.audioTrackId:f.isOriginal!==false,duration:Number(f.approxDurationMs)/1000||raw.duration,raw:f}));
 if(config.audioTrackId&&!formats.some(f=>f.audio&&f.raw.audioTrackId===config.audioTrackId))throw new Error('播放器音軌尚未對應影音格式，請重新讀取。');
 if(!formats.some(f=>f.video)||!formats.some(f=>f.audio))throw new Error('播放器沒有完整影音格式。');
 return summarize({title:raw.title,uploader:raw.uploader,duration:raw.duration,live:false,platform:'YouTube',client:'WEB_SABR',formats,sabr:{...config,serverAbrStreamingUrl:source,formats:raw.formats,durationMs:raw.duration*1000},identity:{id:raw.id,sourceUrl:url,platform:'YouTube',duration:raw.duration}});
}
export async function openSabr(config,videoId,audioId,fetcher=fetch){
 const video=typeof videoId==='object'?videoId:config.formats.find(f=>f.itag===videoId),audio=typeof audioId==='object'?audioId:config.formats.find(f=>f.itag===audioId);
 const stream=new SabrStream({...config,fetch:(input,init)=>fetcher.call(globalThis,input,init)});
 const result=await stream.start({videoFormat:video,audioFormat:audio,maxRetries:2,stallDetectionMs:20000});
 if(result.selectedFormats.videoFormat.itag!==video.itag||result.selectedFormats.audioFormat.itag!==audio.itag||result.selectedFormats.audioFormat.xtags!==audio.xtags||result.selectedFormats.videoFormat.xtags!==video.xtags){stream.abort();throw new Error('YouTube 串流格式與選擇不符。');}
 return {...result,abort:()=>stream.abort()};
}
