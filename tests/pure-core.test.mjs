import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {publicUrl,filename} from '../extension/media.js';
import {youtubeId,cdnUrl,youtubeProbe,selectFormats,summarize} from '../extension/platforms.js';
import {prepareFormats,checkFormats,youtubeHlsFormats} from '../extension/network.js';
import {sabrInfo} from '../extension/sabr.bundle.js';
import {VideoPlaybackAbrRequest} from 'googlevideo/protos';
import {readYouTubePlayer} from '../extension/youtube-page.js';
test('URLs reject local hosts, credentials and unsupported protocols',()=>{
 for(const u of ['javascript:alert(1)','blob:https://example.com/a','file:///C:/x','http://127.0.0.1/a','https://[::1]/x','http://localhost/x','https://nas.local/a','https://a:pass@example.com/'])assert.equal(publicUrl(u),null);
 assert.equal(publicUrl('https://cdn.example.com/a.mp4?token=123'),'https://cdn.example.com/a.mp4?token=123');
});
test('output filenames stay safe',()=>{assert.equal(filename('CON','https://rr1.googlevideo.com/a.mp4'),'MediaDock/_CON.mp4');assert.equal(filename('../測試:影片','https://rr1.googlevideo.com/a.webm'),'MediaDock/.._測試_影片.webm');});
test('YouTube watch, Shorts and short links require an exact video ID',()=>{
 for(const u of ['https://www.youtube.com/watch?v=a9LDPn-MO4I','https://www.youtube.com/shorts/a9LDPn-MO4I','https://youtu.be/a9LDPn-MO4I'])assert.equal(youtubeId(u),'a9LDPn-MO4I');assert.equal(youtubeId('https://youtube.com.evil.com/watch?v=a9LDPn-MO4I'),null);assert.equal(youtubeId('https://www.youtube.com/watch?v=short'),null);
});
test('platform media URLs stay on their own trusted CDN domains',()=>{
 assert.ok(cdnUrl('https://rr1.googlevideo.com/videoplayback','YouTube'));assert.equal(cdnUrl('https://googlevideo.com.evil.com/a','YouTube'),null);assert.equal(cdnUrl('http://rr1.googlevideo.com/a','YouTube'),null);assert.equal(cdnUrl('https://evil.com/a','YouTube'),null);
});
const video=(height=1080,mime='video/mp4; codecs="avc1.640028"')=>({url:'https://rr1.googlevideo.com/a',video:true,audio:false,width:1920,height,mime,bitrate:100,duration:60});
const audio={url:'https://rr1.googlevideo.com/b',video:false,audio:true,mime:'audio/mp4; codecs="mp4a.40.2"',bitrate:100,duration:60};
test('quality selection requires the exact height, audio and matching duration',()=>{
 const info={formats:[video(1080),video(2160),audio]};assert.equal(selectFormats(info,'1080')[0].height,1080);assert.equal(selectFormats(info,'best')[0].height,2160);assert.throws(()=>selectFormats(info,'720'));assert.throws(()=>selectFormats({formats:[video()]},'best'));assert.throws(()=>selectFormats({formats:[video(),{...audio,duration:5}]},'best'));assert.equal(selectFormats(info,'best',true)[0],audio);
});
test('Shorts preserve real width and height',()=>{
 const d=summarize({formats:[{...video(2964),width:2160},{...video(1482),width:1080},audio]});assert.deepEqual(d.qualities,[{height:2964,width:2160},{height:1482,width:1080}]);assert.equal(selectFormats(d,'1482')[0].width,1080);
});
test('YouTube parser verifies identity and excludes DRM and untrusted URLs',async()=>{
 const url='https://www.youtube.com/watch?v=a9LDPn-MO4I';let calls=0;
 const fetcher=async(endpoint,init)=>{calls++;assert.equal(init.credentials,'omit');assert.equal(JSON.parse(init.body).videoId,'a9LDPn-MO4I');return {ok:true,json:async()=>({videoDetails:{videoId:'a9LDPn-MO4I',title:'Correct video',lengthSeconds:'60'},streamingData:{adaptiveFormats:[{itag:137,url:'https://rr1.googlevideo.com/a',width:1920,height:1080,mimeType:'video/mp4',qualityLabel:'1080p',approxDurationMs:'60000'},{itag:140,url:'https://rr1.googlevideo.com/b',mimeType:'audio/mp4',audioQuality:'AUDIO_QUALITY_MEDIUM',approxDurationMs:'60000'},{itag:313,url:'https://evil.com/a',width:3840,height:2160},{itag:999,url:'https://rr1.googlevideo.com/a',width:3840,height:2160,drmFamilies:['widevine']}]}})};};
 const data=await youtubeProbe(url,fetcher);assert.equal(data.identity.id,'a9LDPn-MO4I');assert.equal(data.formats.length,2);assert.equal(calls,1);
 await assert.rejects(youtubeProbe(url,async()=>({ok:true,json:async()=>({videoDetails:{videoId:'18NGQq7p3LY'}})})),/不會用其他影片代替/);
});
test('YouTube 403 fallback keeps exact quality, matching audio and checks real HLS segments',async()=>{
 const hls='https://manifest.googlevideo.com/master.m3u8',master='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",DEFAULT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="a"\nvideo.m3u8\n',playlist='#EXTM3U\n#EXTINF:2.0,\nchunk.m4s\n#EXT-X-ENDLIST\n';
 const info={platform:'YouTube',client:'iOS',hls,duration:2,formats:[{...video(),duration:2},{...audio,duration:2}],identity:{id:'a9LDPn-MO4I',sourceUrl:'https://www.youtube.com/watch?v=a9LDPn-MO4I'}};
 const formats=youtubeHlsFormats(master,hls,2);assert.equal(formats[0].height,1080);assert.equal(formats[0].audio,false);
 const seen=[];const fetcher=async url=>{seen.push(url);if(url.includes('/youtubei/'))return Response.json({playabilityStatus:{reason:'Unavailable'},videoDetails:{videoId:'other'}});if(url===hls)return new Response(master);if(url.endsWith('.m3u8'))return new Response(playlist);if(url.endsWith('.m4s'))return new Response(new Uint8Array([1,2]),{headers:{'Content-Type':'video/mp4'}});return new Response('',{status:403});};
 const selected=await prepareFormats(info,{quality:'1080',mode:'video',container:'mp4'},fetcher);assert.equal(selected.length,2);assert.equal(selected[0].height,1080);assert.equal(selected[1].id,selected[0].audioGroup);assert.ok(seen.some(u=>u.endsWith('chunk.m4s')));
 await assert.rejects(prepareFormats(info,{quality:'2160',mode:'video'},fetcher),/不會改下載其他影片或降低畫質/);
});
test('HLS preflight rejects encrypted playlists, live playlists and HTML segments',async()=>{
 const f={url:'https://manifest.googlevideo.com/video.m3u8',kind:'HLS'};
 for(const text of ['#EXTM3U\n#EXT-X-KEY:METHOD=AES-128\n#EXTINF:2,\nx.ts\n#EXT-X-ENDLIST','#EXTM3U\n#EXTINF:2,\nx.ts'])await assert.rejects(checkFormats([f],'YouTube',async()=>new Response(text)));
 await assert.rejects(checkFormats([f],'YouTube',async url=>url.endsWith('.m3u8')?new Response('#EXTM3U\n#EXTINF:2,\nx.ts\n#EXT-X-ENDLIST'):new Response('<html>',{headers:{'Content-Type':'text/html'}})),/網頁/);
});
test('a readable initial range does not hide forbidden later media ranges or use cached probes',async()=>{
 const calls=[],f={...video(),length:4096};
 await assert.rejects(checkFormats([f],'YouTube',async(url,init)=>{assert.equal(init.cache,'no-store');calls.push(init.headers.Range);return new Response(new Uint8Array([1,2]),{status:init.headers.Range==='bytes=0-1023'?206:403});}),/403/);
 assert.deepEqual(calls,['bytes=0-1023','bytes=3072-4095']);
});
test('SABR capture is bound to the exact page, video, source and web client',()=>{
 const url='https://www.youtube.com/watch?v=a9LDPn-MO4I',source='https://rr1.googlevideo.com/videoplayback?sabr=1&id=bound',raw={id:'a9LDPn-MO4I',sourceUrl:url,rawUrl:source,title:'Correct',duration:60,formats:[{itag:137,width:1920,height:1080,approxDurationMs:60000,mimeType:'video/mp4',lastModified:'123',bitrate:1000},{itag:140,audioQuality:'medium',approxDurationMs:60000,mimeType:'audio/mp4',lastModified:'123',bitrate:100}]};
 const request={selectedFormatIds:[],bufferedRanges:[],preferredAudioFormatIds:[],preferredVideoFormatIds:[],preferredSubtitleFormatIds:[],field1000:[],videoPlaybackUstreamerConfig:new Uint8Array([1,2]),streamerContext:{clientInfo:{clientName:1,clientVersion:'test'},sabrContexts:[],unsentSabrContexts:[],poToken:new Uint8Array(40).fill(3)}};
 const capture={url:source,bytes:VideoPlaybackAbrRequest.encode(request).finish()};assert.equal(sabrInfo(raw,capture,url).heights[0],1080);
 assert.throws(()=>sabrInfo({...raw,id:'18NGQq7p3LY'},capture,url));assert.throws(()=>sabrInfo(raw,{...capture,url:source.replace('id=bound','id=other')},url));assert.throws(()=>sabrInfo(raw,{...capture,url:'https://evil.com/videoplayback?sabr=1&id=bound'},url));
 request.streamerContext.poToken=new Uint8Array(12);assert.throws(()=>sabrInfo(raw,{...capture,bytes:VideoPlaybackAbrRequest.encode(request).finish()},url),/播放驗證/);
 request.streamerContext.poToken=undefined;assert.throws(()=>sabrInfo(raw,{...capture,bytes:VideoPlaybackAbrRequest.encode(request).finish()},url),/播放驗證/);
});
test('SABR keeps the current audio variant when multiple tracks share an itag',()=>{
 const url='https://www.youtube.com/watch?v=a9LDPn-MO4I',source='https://rr1.googlevideo.com/videoplayback?sabr=1&id=bound';
 const request={selectedFormatIds:[],bufferedRanges:[],preferredAudioFormatIds:[],preferredVideoFormatIds:[],preferredSubtitleFormatIds:[],field1000:[],clientAbrState:{audioTrackId:'zh.0'},videoPlaybackUstreamerConfig:new Uint8Array([1,2]),streamerContext:{clientInfo:{clientName:1},sabrContexts:[],unsentSabrContexts:[],poToken:new Uint8Array(40).fill(3)}};
 const raw={id:'a9LDPn-MO4I',sourceUrl:url,rawUrl:source,duration:60,formats:[{itag:299,width:1920,height:1080,mimeType:'video/mp4',approxDurationMs:60000},{itag:140,audioQuality:'medium',mimeType:'audio/mp4',audioTrackId:'en.1',xtags:'lang=en',isOriginal:true,approxDurationMs:60000},{itag:140,audioQuality:'medium',mimeType:'audio/mp4',audioTrackId:'zh.0',xtags:'lang=zh',isOriginal:false,approxDurationMs:60000}]};
 const info=sabrInfo(raw,{url:source,bytes:VideoPlaybackAbrRequest.encode(request).finish()},url);assert.equal(selectFormats(info,'1080')[1].raw.xtags,'lang=zh');assert.equal(info.sabr.audioTrackId,'zh.0');
});
test('page player metadata rejects advertisements and mismatched videos',()=>{
 const url='https://www.youtube.com/watch?v=a9LDPn-MO4I',data={videoDetails:{videoId:'18NGQq7p3LY'}};
 const context={URL,location:{href:url},document:{querySelector:()=>false,getElementById:()=>({getPlayerResponse:()=>data,getVideoData:()=>({video_id:data.videoDetails.videoId})})}};
 const read=vm.runInNewContext('('+readYouTubePlayer.toString()+')',context);assert.match(read().error,/目前影片/);context.document.querySelector=()=>true;assert.match(read().error,/廣告/);
});
function background(){
 const stores={local:{},session:{}},listeners={},calls=[],root='chrome-extension://test/';let page={id:7,url:'https://www.youtube.com/watch?v=a9LDPn-MO4I',title:'YouTube'};
 const event=name=>({addListener:fn=>listeners[name]=fn});
 const chrome={storage:Object.fromEntries(Object.entries(stores).map(([name,data])=>[name,{get:async key=>typeof key==='string'?{[key]:structuredClone(data[key])}:structuredClone(data),set:async v=>Object.assign(data,structuredClone(v)),remove:async keys=>keys.forEach(k=>delete data[k])}])),runtime:{id:'test',getURL:path=>root+path,onMessage:event('message'),getContexts:async()=>[],sendMessage:async m=>{calls.push(m);return {ok:true}}},offscreen:{createDocument:async o=>calls.push({create:o}),closeDocument:async()=>{}},tabs:{query:async()=>[page],onRemoved:event('removed')},scripting:{executeScript:async()=>[{result:{error:'Test page has no web player'}}]},downloads:{download:async o=>{calls.push({download:o});return 9},search:async()=>[{state:'in_progress'}],cancel:async()=>{},show:async()=>{},onChanged:event('downloads')},declarativeNetRequest:{updateDynamicRules:async()=>{}},webRequest:{onHeadersReceived:event('headers'),onBeforeRequest:event('requests')},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},openPopup:async o=>calls.push({popup:o})}};
 const source=fs.readFileSync(new URL('../extension/background.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 vm.runInNewContext(source,{chrome,publicUrl,youtubeId,readYouTubePlayer:()=>{},sabrInfo,youtubeProbe:async url=>({title:'Correct',duration:60,identity:{id:youtubeId(url),sourceUrl:url,platform:'YouTube'}}),prepareFormats:async()=>[video(),audio],navigator:{userAgent:'Test'},crypto:webcrypto,URL,console,setTimeout:()=>0,clearTimeout:()=>{}});
 const send=async(message,sender={id:'test',url:root+'popup.html'})=>new Promise(resolve=>listeners.message(message,sender,resolve));
 return {send,calls,stores,listeners,tab:t=>page=t,root};
}
test('non-YouTube pages cannot probe or start, and reading creates no engine',async()=>{
 const b=background();b.tab({id:7,url:'https://example.com/library',title:'Other'});await new Promise(r=>setTimeout(r,0));
 assert.equal((await b.send({action:'scan'})).data.supported,false);
 for(const action of ['probe','start','direct','watch','stopWatch'])assert.equal((await b.send({action,url:'https://example.com/movie.mp4'})).ok,false);
 assert.equal(b.calls.length,0);
});
const downloadRequest={action:'start',url:'https://www.youtube.com/watch?v=a9LDPn-MO4I',quality:'1080',expected:{id:'a9LDPn-MO4I',sourceUrl:'https://www.youtube.com/watch?v=a9LDPn-MO4I'}};
test('untrusted pages and content scripts cannot start downloads',async()=>{
 const b=background();for(const s of [{id:'test',url:'https://evil.com/'},{id:'test',url:b.root+'popup.html',tab:{id:1}},{id:'other',url:b.root+'popup.html'}])assert.equal((await b.send({action:'start',url:'https://cdn.example.com/a.mp4'},s)).ok,false);assert.equal(b.calls.length,0);
});
test('YouTube source must match the current tab and rejects audio-only requests',async()=>{
 const b=background();await new Promise(r=>setTimeout(r,0));
 for(const request of [{...downloadRequest,mode:'audio'},{...downloadRequest,expected:{...downloadRequest.expected,id:'18NGQq7p3LY'}}])assert.equal((await b.send(request)).ok,false);
 b.tab({id:7,url:'https://www.youtube.com/watch?v=18NGQq7p3LY'});assert.equal((await b.send(downloadRequest)).ok,false);assert.equal(b.calls.length,0);
});
test('save requests cannot skip verification or substitute external URLs',async()=>{
 const b=background();await new Promise(r=>setTimeout(r,0));const {data}=await b.send(downloadRequest),s={id:'test',url:b.root+'offscreen.html'};
 for(const m of [{verification:{},url:'blob:'+b.root+'a'},{verification:{fullDecode:true,identityMatched:true},url:'https://evil.com/a.mp4'}])assert.equal((await b.send({action:'saveFile',id:data.id,...m},s)).ok,false);assert.equal(b.calls.some(c=>c.download),false);
});
test('verified files request Save As, pending until the file is saved',async()=>{
 const b=background();await new Promise(r=>setTimeout(r,0));const {data}=await b.send(downloadRequest);const r=await b.send({action:'saveFile',id:data.id,url:'blob:'+b.root+'file',filename:'MediaDock/a.mp4',verification:{fullDecode:true,identityMatched:true}},{id:'test',url:b.root+'offscreen.html'});assert.equal(r.ok,true);assert.equal(b.calls.find(c=>c.download).download.saveAs,true);assert.equal(b.stores.local.jobs[0].status,'saving');
});
test('YouTube inline button opens only for the active matching video',async()=>{
 const b=background(),url='https://www.youtube.com/watch?v=a9LDPn-MO4I';b.tab({id:7,url,windowId:3});await new Promise(r=>setTimeout(r,0));assert.equal((await b.send({action:'openDownloader'},{id:'test',frameId:0,url,tab:{id:7,windowId:3}})).ok,true);assert.equal(b.calls[0].popup.windowId,3);assert.equal((await b.send({action:'openDownloader'},{id:'test',frameId:0,url:url.replace('a9LDPn-MO4I','18NGQq7p3LY'),tab:{id:7,windowId:3}})).ok,false);
});
test('shipped extension needs no native host, cookies API or remote code',()=>{
 const m=JSON.parse(fs.readFileSync(new URL('../extension/manifest.json',import.meta.url)));assert.equal(m.permissions.includes('nativeMessaging'),false);assert.equal(m.permissions.includes('cookies'),false);assert.equal(m.optional_host_permissions,undefined);assert.deepEqual(m.host_permissions,['https://www.youtube.com/*','https://youtubei.googleapis.com/*','https://*.googlevideo.com/*']);for(const f of ['scan.js','manifests.js','crypto.bundle.js'])assert.equal(fs.existsSync(new URL('../extension/'+f,import.meta.url)),false);assert.equal(m.permissions.includes('cookies'),false);assert.equal(m.permissions.includes('offscreen'),true);assert.equal(m.content_security_policy.extension_pages.includes('unsafe-eval'),false);for(const n of ['background.js','popup.js','offscreen.js'])assert.doesNotMatch(fs.readFileSync(new URL('../extension/'+n,import.meta.url),'utf8'),/connectNative|Install\.cmd|\.exe\b/);assert.ok(fs.statSync(new URL('../extension/engine.bundle.js',import.meta.url)).size>1000);
});
