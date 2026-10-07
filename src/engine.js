import {Input,UrlSource,BlobSource,ALL_FORMATS,Output,Mp4OutputFormat,WebMOutputFormat,StreamTarget,EncodedPacketSink,EncodedVideoPacketSource,EncodedAudioPacketSource,VideoSampleSink,AudioSampleSink} from 'mediabunny';
import {sha256} from '@noble/hashes/sha2.js';
import {filename,publicUrl} from '../extension/media.js';

const tasks=new Map();
const rootPromise=navigator.storage.getDirectory();
const cleanPromise=rootPromise.then(async root=>{for await(const name of root.keys())if(/^job-[\w-]+(?:-\d+)?\.tmp$/.test(name))await root.removeEntry(name).catch(()=>{});});
function patch(plan,status,progress=0,extra={}){postMessage({type:'job',job:{id:plan.id,status,progress,...extra}});}
function progress(plan,status){let last=0;return value=>{if(Date.now()-last>800){last=Date.now();patch(plan,status,Math.max(0,Math.min(99,value)));}};}
function durationTolerance(duration){return Math.max(0.15,Math.min(2,duration*0.005));}
function checkedFetch(controller){return async(input,init={})=>{
  const url=typeof input==='string'?input:input.url||String(input);
  if(!publicUrl(url))throw new Error('媒體包含不支援的網址。');
  const response=await fetch(input,{...init,credentials:'omit',signal:AbortSignal.any([controller.signal,init.signal||AbortSignal.timeout(90000)])});
  if(!response.ok)throw new Error(`來源回應 ${response.status}，請重新掃描。`);
  const type=response.headers.get('content-type')||'';
  if(/text\/html|application\/json/.test(type))throw new Error('來源回傳網頁或錯誤訊息，並非影片。');
  if(/\.m3u8(?:[?#]|$)/i.test(url)||/mpegurl/.test(type)){
    const text=await response.clone().text();
    if(text.length>2*1024*1024)throw new Error('串流清單過大。');
    if(/#EXT-X-KEY:.*METHOD=(?!NONE)/.test(text)||/#EXT-X-SESSION-KEY/.test(text))throw new Error('此串流含加密保護，暫不支援。');
    if(/#EXTINF/.test(text)&&!text.includes('#EXT-X-ENDLIST'))throw new Error('直播串流暫不支援。');
  }
  return response;
};}
async function downloadSegments(f,plan,index,fetcher,task){
  const root=await rootPromise,name=`job-${plan.id}-${index}.tmp`;task.names.push(name);
  const handle=await root.getFileHandle(name,{create:true}),access=await handle.createSyncAccessHandle();
  let at=0;const update=progress(plan,'downloading');
  try{for(let i=0;i<f.segments.length;i++){
    const response=await fetcher(f.segments[i]);const reader=response.body.getReader();
    try{for(;;){const {value,done}=await reader.read();if(done)break;at+=access.write(value,{at});task.controller.signal.throwIfAborted();}}
    finally{reader.releaseLock();}update(i/f.segments.length*100);
  }access.flush();}finally{access.close();}
  return new BlobSource(await handle.getFile());
}
async function hash(file,signal){const digest=sha256.create();const reader=file.stream().getReader();try{for(;;){signal.throwIfAborted();const {value,done}=await reader.read();if(done)break;digest.update(value);}}finally{reader.releaseLock();}return Array.from(digest.digest(),b=>b.toString(16).padStart(2,'0')).join('');}
export async function verifyFile(file,plan,signal=new AbortController().signal,onProgress=()=>{}){
  const input=new Input({source:new BlobSource(file,{maxCacheSize:2*1024*1024}),formats:ALL_FORMATS});
  try{
    const video=await input.getPrimaryVideoTrack(),audio=await input.getPrimaryAudioTrack();
    if(plan.mode!=='audio'&&!video)throw new Error('檔案沒有影像。');
    if(plan.mode==='audio'&&!audio||plan.expected.platform!=='網站'&&plan.mode!=='audio'&&!audio)throw new Error('檔案沒有聲音。');
    const duration=await input.computeDuration();
    if(!Number.isFinite(duration)||duration<=0)throw new Error('影片片長不正確。');
    if(plan.duration>0&&Math.abs(duration-plan.duration)>durationTolerance(plan.duration))throw new Error(`片長不符：預期 ${plan.duration.toFixed(1)} 秒，實際 ${duration.toFixed(1)} 秒。`);
    if(video&&plan.quality!=='best'&&Number(plan.quality)!==video.displayHeight)throw new Error('下載的畫質與選擇不符。');
    let frames=0,audioSamples=0,videoEnd=0,audioEnd=0;
    if(video){
      if(!await video.canDecode())throw new Error('此瀏覽器無法驗證這個影像編碼，請選另一個畫質或格式。');
      for await(const sample of new VideoSampleSink(video).samples()){
        try{signal.throwIfAborted();frames++;videoEnd=Math.max(videoEnd,sample.timestamp+sample.duration);onProgress(sample.timestamp/duration*75);}finally{sample.close();}
        if(frames%32===0)await new Promise(r=>setTimeout(r,0));
      }
      if(!frames||videoEnd<duration-durationTolerance(duration)||plan.packetCounts?.video&&frames<plan.packetCounts.video)throw new Error('影像未完整解碼至結尾。');
    }
    if(audio){
      if(!await audio.canDecode())throw new Error('此瀏覽器無法驗證這個音訊編碼。');
      for await(const sample of new AudioSampleSink(audio).samples()){
        try{signal.throwIfAborted();audioSamples++;audioEnd=Math.max(audioEnd,sample.timestamp+sample.duration);onProgress((video?75:0)+sample.timestamp/duration*(video?25:100));}finally{sample.close();}
        if(audioSamples%128===0)await new Promise(r=>setTimeout(r,0));
      }
      if(!audioSamples||audioEnd<duration-durationTolerance(duration))throw new Error('聲音未完整解碼至結尾。');
    }
    return {fullDecode:true,identityMatched:true,sourceUrl:plan.expected.sourceUrl,sourceId:plan.expected.id||'',cid:plan.expected.cid||'',videoWidth:video?.displayWidth||0,videoHeight:video?.displayHeight||0,duration,videoFrames:frames,audioSamples,hasAudio:!!audio,sha256:await hash(file,signal),size:file.size,compatibilityConverted:false};
  }finally{input.dispose();}
}
async function run(plan){
  const task={controller:new AbortController(),names:[],inputs:[]};tasks.set(plan.id,task);
  const signal=task.controller.signal,fetcher=checkedFetch(task.controller),update=progress(plan,'downloading');
  let access,output;
  try{
    await cleanPromise;signal.throwIfAborted();
    patch(plan,'downloading');
    const selected=[];
    for(let i=0;i<plan.formats.length;i++){
      const f=plan.formats[i];const source=f.segments?await downloadSegments(f,plan,i,fetcher,task):new UrlSource(f.url,{maxCacheSize:4*1024*1024,parallelism:1,fetchFn:fetcher,getRetryDelay:(attempts,error)=>!signal.aborted&&error instanceof TypeError&&attempts<3?attempts:null});
      const input=new Input({source,formats:ALL_FORMATS});task.inputs.push(input);
      const video=f.video&&plan.mode!=='audio'?await input.getPrimaryVideoTrack():null,audio=f.audio?await input.getPrimaryAudioTrack():null;
      if(f.video&&plan.mode!=='audio'&&!video||f.audio&&!audio&&(plan.expected.platform!=='網站'||plan.mode==='audio'))throw new Error('來源缺少預期的影音軌道。');
      if(video)selected.push({track:video,type:'video'});if(audio)selected.push({track:audio,type:'audio'});
    }
    if(!selected.length)throw new Error('來源不含可用的媒體。');
    const declared=await task.inputs[0].getDurationFromMetadata();
    let duration=plan.duration||declared||await task.inputs[0].computeDuration();
    if(!plan.duration)plan.duration=duration;
    if(!Number.isFinite(duration)||duration<=0)throw new Error('直播或未知片長來源暫不支援。');
    let format=plan.container==='webm'?new WebMOutputFormat():new Mp4OutputFormat({fastStart:'fragmented'});
    const codecs=await Promise.all(selected.map(s=>s.track.getCodec()));
    // Choose a container compatible with the original tracks; never silently drop audio or transcode.
    if(!codecs.every(c=>format.getSupportedCodecs().includes(c))){format=plan.container==='webm'?new Mp4OutputFormat({fastStart:'fragmented'}):new WebMOutputFormat();if(!codecs.every(c=>format.getSupportedCodecs().includes(c)))throw new Error('原始影音編碼無法合併為支援的格式。');}
    const ext=format instanceof WebMOutputFormat?'webm':plan.mode==='audio'?'m4a':'mp4';
    const root=await rootPromise,name=`job-${plan.id}.tmp`;task.names.push(name);
    const handle=await root.getFileHandle(name,{create:true});access=await handle.createSyncAccessHandle();access.truncate(0);
    output=new Output({format,target:new StreamTarget(new WritableStream({write(chunk){signal.throwIfAborted();access.write(chunk.data,{at:chunk.position});}}),{chunked:true,chunkSize:1024*1024})});
    const streams=[];
    for(let i=0;i<selected.length;i++){
      const {track,type}=selected[i];if(!codecs[i])throw new Error('無法辨識媒體編碼。');
      const source=type==='video'?new EncodedVideoPacketSource(codecs[i]):new EncodedAudioPacketSource(codecs[i]);
      if(type==='video')output.addVideoTrack(source,{transformationMatrix:await track.getTransformationMatrix()});else output.addAudioTrack(source);
      const iterator=new EncodedPacketSink(track).packets()[Symbol.asyncIterator]();
      streams.push({source,iterator,next:await iterator.next(),config:await track.getDecoderConfig(),first:true,type,end:0,count:0,expectedEnd:await track.getDurationFromMetadata()});
    }
    output.setMetadataTags({title:plan.title,comment:`MediaDock source: ${plan.expected.sourceUrl}`});await output.start();
    let packets=0;
    while(streams.some(s=>!s.next.done)){
      signal.throwIfAborted();const s=streams.filter(s=>!s.next.done).sort((a,b)=>a.next.value.timestamp-b.next.value.timestamp)[0];
      const packet=s.next.value;await s.source.add(packet,s.first?{decoderConfig:s.config}:undefined);s.first=false;packets++;s.count++;s.end=Math.max(s.end,packet.timestamp+packet.duration);update(packet.timestamp/duration*100);s.next=await s.iterator.next();if(s.next.done)s.source.close();
      if(packets%64===0)await new Promise(r=>setTimeout(r,0));
    }
    for(const s of streams)if(s.expectedEnd>0&&s.end<s.expectedEnd-durationTolerance(s.expectedEnd))throw new Error('來源的影音分段不完整，已停止儲存。');
    plan.packetCounts=Object.fromEntries(streams.map(s=>[s.type,s.count]));
    patch(plan,'processing');await output.finalize();access.flush();access.close();access=null;
    task.inputs.forEach(i=>i.dispose());task.inputs=[];
    const file=await handle.getFile();if(file.size<128)throw new Error('媒體檔案不完整。');
    patch(plan,'verifying');const verification=await verifyFile(file,plan,signal,progress(plan,'verifying'));
    signal.throwIfAborted();postMessage({type:'file',id:plan.id,file,verification,filename:filename(plan.title,`https://media.invalid/file.${ext}`)});
  }catch(e){
    access?.close();await output?.cancel().catch(()=>{});task.inputs.forEach(i=>i.dispose());
    patch(plan,signal.aborted?'cancelled':'failed',0,{error:signal.aborted?'':e.message||'下載或驗證失敗。'});
  }
}
self.onmessage=async({data})=>{
  if(data.action==='start')run(data.plan);
  if(data.action==='cancel')tasks.get(data.id)?.controller.abort();
  if(data.action==='release'){
    const task=tasks.get(data.id);tasks.delete(data.id);
    if(task){task.controller.abort();const root=await rootPromise;for(const name of task.names)await root.removeEntry(name).catch(()=>{});}
    postMessage({type:'released',id:data.id});
  }
};
