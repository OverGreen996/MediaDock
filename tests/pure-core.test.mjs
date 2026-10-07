import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {publicUrl,mediaKind,filename,siteName} from '../extension/media.js';
import {youtubeId,cdnUrl,youtubeProbe,bilibiliResult,selectFormats,summarize,readBilibiliPage,readBilibiliApi,signWbi} from '../extension/platforms.js';
import {prepareFormats,checkFormats,youtubeHlsFormats} from '../extension/network.js';
test('URLs reject local hosts, credentials and unsupported protocols',()=>{
 for(const u of ['javascript:alert(1)','blob:https://example.com/a','file:///C:/x','http://127.0.0.1/a','https://[::1]/x','http://localhost/x','https://nas.local/a','https://a:pass@example.com/'])assert.equal(publicUrl(u),null);
 assert.equal(publicUrl('https://cdn.example.com/a.mp4?token=123'),'https://cdn.example.com/a.mp4?token=123');
});
test('media detection distinguishes files, manifests and transport segments',()=>{
 assert.equal(mediaKind('https://cdn.example.com/a.m3u8'),'HLS');assert.equal(mediaKind('https://cdn.example.com/a.mpd'),'DASH');assert.equal(mediaKind('https://cdn.example.com/movie','video/mp4'),'影片');assert.equal(mediaKind('https://cdn.example.com/a.m4a'),'音訊');assert.equal(mediaKind('https://cdn.example.com/a.ts','video/mp2t'),null);assert.equal(mediaKind('https://cdn.example.com/a.jpg'),null);
});
test('platform routing and output filenames cannot be spoofed',()=>{
 assert.equal(siteName('https://www.youtube.com/watch?v=a'),'YouTube');assert.notEqual(siteName('https://youtube.com.attacker.com/'),'YouTube');assert.equal(filename('CON','https://cdn.example.com/a.mp4'),'MediaDock/_CON.mp4');assert.equal(filename('../測試:影片','https://cdn.example.com/a.webm'),'MediaDock/.._測試_影片.webm');
});
test('YouTube watch, Shorts and short links require an exact video ID',()=>{
 for(const u of ['https://www.youtube.com/watch?v=a9LDPn-MO4I','https://www.youtube.com/shorts/a9LDPn-MO4I','https://youtu.be/a9LDPn-MO4I'])assert.equal(youtubeId(u),'a9LDPn-MO4I');assert.equal(youtubeId('https://youtube.com.evil.com/watch?v=a9LDPn-MO4I'),null);assert.equal(youtubeId('https://www.youtube.com/watch?v=short'),null);
});
test('platform media URLs stay on their own trusted CDN domains',()=>{
 assert.ok(cdnUrl('https://rr1.googlevideo.com/videoplayback','YouTube'));assert.equal(cdnUrl('https://googlevideo.com.evil.com/a','YouTube'),null);assert.equal(cdnUrl('http://rr1.googlevideo.com/a','YouTube'),null);assert.ok(cdnUrl('https://upos-test.bilivideo.com/a','Bilibili'));assert.equal(cdnUrl('https://evil.com/a','Bilibili'),null);
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
function bili(){return {sourceUrl:'https://www.bilibili.com/video/BV15z4y1U7HS/?p=2',video:{bvid:'BV15z4y1U7HS',aid:123,title:'Correct'},part:{page:2,cid:456,part:'Part 2'},play:{timelength:60000,dash:{video:[{id:80,baseUrl:'https://upos-test.bilivideo.com/v',mimeType:'video/mp4',codecs:'avc1.640028',width:1920,height:1080}],audio:[{id:30280,baseUrl:'https://upos-test.bilivideo.com/a',mimeType:'audio/mp4',codecs:'mp4a.40.2'}]}}};}
test('Bilibili binds the exact BV, CID, part and page URL',()=>{
 const raw=bili(),info=bilibiliResult(raw,raw.sourceUrl);assert.equal(info.identity.cid,'456');assert.equal(info.identity.part,2);assert.equal(info.heights[0],1080);
 assert.throws(()=>bilibiliResult({...raw,video:{...raw.video,bvid:'BVdifferent'}},raw.sourceUrl));assert.throws(()=>bilibiliResult({...raw,part:{...raw.part,page:1}},raw.sourceUrl));assert.throws(()=>bilibiliResult(raw,raw.sourceUrl.replace('p=2','p=1')));
});
test('Bilibili uses the logged-in page player, rejecting stale CID and opted-out login',async()=>{
 const raw=bili();raw.play.dash.video[0].baseUrl='https://upos-test.bilivideo.com/456/456-1-30080.m4s';
 const context={URL,location:{href:raw.sourceUrl},__INITIAL_STATE__:{cid:456,videoData:{...raw.video,pages:[raw.part]}},__playinfo__:{data:raw.play}};
 const read=vm.runInNewContext('('+readBilibiliPage.toString()+')',context);
 assert.equal((await read(true)).via,'page');assert.equal((await read(false)).play,undefined);
 context.__INITIAL_STATE__.cid=999;assert.match((await read(true)).error,/分 P/);
 context.__INITIAL_STATE__.cid=456;raw.play.dash.video[0].baseUrl='https://upos-test.bilivideo.com/999/999-1.m4s';assert.match((await read(true)).error,/CID/);
});
test('Bilibili signed API fallback preserves part and uses credentials only when requested',async()=>{
 const images={img_url:'https://i0.hdslb.com/bfs/wbi/0123456789abcdef0123456789abcdef.png',sub_url:'https://i0.hdslb.com/bfs/wbi/fedcba9876543210fedcba9876543210.png'};
 const query=signWbi({cid:456,bvid:'BV15z4y1U7HS'},images,1700000000000),p=new URLSearchParams(query),key='1022a87ffdaf532cb45ee953dce8c96d';
 assert.equal(p.get('wts'),'1700000000');
 const canonical=query.split('&w_rid=')[0];assert.equal(p.get('w_rid'),createHash('md5').update(canonical+key).digest('hex'));
 const fetcher=async(url,init)=>{assert.equal(init.credentials,'omit');if(url.includes('/view?'))return Response.json({code:0,data:{bvid:'BV15z4y1U7HS',aid:123,title:'Correct',pages:[{page:2,cid:456}]}});if(url.endsWith('/nav'))return Response.json({code:-101,data:{wbi_img:images}});assert.ok(url.includes('/wbi/playurl?'));assert.equal(new URL(url).searchParams.get('cid'),'456');assert.ok(new URL(url).searchParams.get('w_rid'));return Response.json({code:0,data:bili().play});};
 const raw=await readBilibiliApi(bili().sourceUrl,false,fetcher);assert.equal(raw.part.cid,456);assert.equal(raw.via,'api');
});
test('Bilibili HTTP CDN URLs upgrade to HTTPS and primary failures use trusted backups',async()=>{
 assert.equal(cdnUrl('http://upos-test.bilivideo.com/v','Bilibili'),'https://upos-test.bilivideo.com/v');
 const f={...video(),url:'https://upos-test.bilivideo.com/v',backups:['https://evil.com/v','https://upos-backup.akamaized.net/v']};
 const seen=[];const result=await checkFormats([f],'Bilibili',async url=>{seen.push(url);return new Response(url===f.url?'':new Uint8Array([1,2]),{status:url===f.url?403:206,headers:{'Content-Type':'video/mp4'}});});
 assert.equal(result[0].url,f.backups[1]);assert.equal(result[0].height,1080);assert.equal(seen.includes(f.backups[0]),false);
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
function background(){
 const stores={local:{},session:{}},listeners={},calls=[],root='chrome-extension://test/';let page={id:7,url:'https://example.com/library',title:'Media'},allowed=false;
 const event=name=>({addListener:fn=>listeners[name]=fn});
 const chrome={storage:Object.fromEntries(Object.entries(stores).map(([name,data])=>[name,{get:async key=>typeof key==='string'?{[key]:structuredClone(data[key])}:structuredClone(data),set:async v=>Object.assign(data,structuredClone(v))}])),runtime:{id:'test',getURL:path=>root+path,onMessage:event('message'),getContexts:async()=>[],sendMessage:async m=>{calls.push(m);return {ok:true}}},offscreen:{createDocument:async o=>calls.push({create:o}),closeDocument:async()=>{}},permissions:{contains:async()=>allowed},tabs:{query:async()=>[page],onRemoved:event('removed')},scripting:{executeScript:async()=>[{result:{title:page.title,url:page.url,media:[{url:'https://cdn.example.com/a.mp4',mime:'video/mp4'}]}}]},downloads:{download:async o=>{calls.push({download:o});return 9},search:async()=>[{state:'in_progress'}],cancel:async()=>{},show:async()=>{},onChanged:event('downloads')},declarativeNetRequest:{updateDynamicRules:async()=>{}},webRequest:{onHeadersReceived:event('headers'),onBeforeRequest:event('requests')},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},openPopup:async o=>calls.push({popup:o})}};
 const source=fs.readFileSync(new URL('../extension/background.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 vm.runInNewContext(source,{chrome,publicUrl,mediaKind,siteName,youtubeProbe,readBilibiliPage:()=>{},bilibiliResult,selectFormats,prepareFormats,crypto:webcrypto,URL,console,setTimeout:()=>0,clearTimeout:()=>{}});
 const send=async(message,sender={id:'test',url:root+'popup.html'})=>new Promise(resolve=>listeners.message(message,sender,resolve));
 return {send,calls,stores,listeners,allow:()=>allowed=true,tab:t=>page=t,root};
}
test('loading and scanning general pages starts no media engine',async()=>{
 const b=background();await new Promise(r=>setTimeout(r,0));const s=await b.send({action:'status'});assert.equal(s.data.ready,true);const r=await b.send({action:'scan'});assert.equal(r.data.media.length,1);assert.equal(b.calls.length,0);
});
test('untrusted pages and content scripts cannot start downloads',async()=>{
 const b=background();for(const s of [{id:'test',url:'https://evil.com/'},{id:'test',url:b.root+'popup.html',tab:{id:1}},{id:'other',url:b.root+'popup.html'}])assert.equal((await b.send({action:'start',url:'https://cdn.example.com/a.mp4'},s)).ok,false);assert.equal(b.calls.length,0);
});
test('source permission is required before starting the browser engine',async()=>{
 const b=background();await new Promise(r=>setTimeout(r,0));assert.equal((await b.send({action:'start',url:'https://cdn.example.com/a.mp4'})).ok,false);b.allow();const r=await b.send({action:'start',url:'https://cdn.example.com/a.mp4'});assert.equal(r.ok,true);assert.equal(b.calls.filter(c=>c.create).length,1);assert.equal(b.calls.find(c=>c.action==='start').plan.expected.sourceUrl,'https://cdn.example.com/a.mp4');
});
test('save requests cannot skip verification or substitute external URLs',async()=>{
 const b=background();b.allow();await new Promise(r=>setTimeout(r,0));const {data}=await b.send({action:'start',url:'https://cdn.example.com/a.mp4'}),s={id:'test',url:b.root+'offscreen.html'};
 for(const m of [{verification:{},url:'blob:'+b.root+'a'},{verification:{fullDecode:true,identityMatched:true},url:'https://evil.com/a.mp4'}])assert.equal((await b.send({action:'saveFile',id:data.id,...m},s)).ok,false);assert.equal(b.calls.some(c=>c.download),false);
});
test('verified files request Save As, pending until the file is saved',async()=>{
 const b=background();b.allow();await new Promise(r=>setTimeout(r,0));const {data}=await b.send({action:'start',url:'https://cdn.example.com/a.mp4'});const r=await b.send({action:'saveFile',id:data.id,url:'blob:'+b.root+'file',filename:'MediaDock/a.mp4',verification:{fullDecode:true,identityMatched:true}},{id:'test',url:b.root+'offscreen.html'});assert.equal(r.ok,true);assert.equal(b.calls.find(c=>c.download).download.saveAs,true);assert.equal(b.stores.local.jobs[0].status,'saving');
});
test('YouTube inline button opens only for the active matching video',async()=>{
 const b=background(),url='https://www.youtube.com/watch?v=a9LDPn-MO4I';b.tab({id:7,url,windowId:3});await new Promise(r=>setTimeout(r,0));assert.equal((await b.send({action:'openDownloader'},{id:'test',frameId:0,url,tab:{id:7,windowId:3}})).ok,true);assert.equal(b.calls[0].popup.windowId,3);assert.equal((await b.send({action:'openDownloader'},{id:'test',frameId:0,url:url.replace('a9LDPn-MO4I','18NGQq7p3LY'),tab:{id:7,windowId:3}})).ok,false);
});
test('shipped extension needs no native host, cookies API or remote code',()=>{
 const m=JSON.parse(fs.readFileSync(new URL('../extension/manifest.json',import.meta.url)));assert.equal(m.permissions.includes('nativeMessaging'),false);assert.equal(m.permissions.includes('cookies'),false);assert.equal(m.permissions.includes('offscreen'),true);assert.equal(m.content_security_policy.extension_pages.includes('unsafe-eval'),false);for(const n of ['background.js','popup.js','offscreen.js'])assert.doesNotMatch(fs.readFileSync(new URL('../extension/'+n,import.meta.url),'utf8'),/connectNative|Install\.cmd|\.exe\b/);assert.ok(fs.statSync(new URL('../extension/engine.bundle.js',import.meta.url)).size>1000);
});
