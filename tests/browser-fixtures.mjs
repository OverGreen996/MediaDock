import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
const out=path.resolve('test-output/pure'),fixtures=path.join(out,'fixtures'),extension=path.join(out,`fixture-extension-${Date.now()}`);
await fs.mkdir(fixtures,{recursive:true});
const ffmpeg=process.env.MEDIA_DOCK_TEST_FFMPEG||'ffmpeg';
function generate(args){const r=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y',...args],{cwd:fixtures,encoding:'utf8'});if(r.error||r.status!==0)throw new Error('Test fixtures require FFmpeg (PATH or MEDIA_DOCK_TEST_FFMPEG): '+(r.error?.message||r.stderr));}
generate(['-f','lavfi','-i','testsrc2=size=288x162:rate=20','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-g','10','-c:a','aac','-movflags','+faststart','sample.mp4']);
generate(['-i','sample.mp4','-c','copy','-hls_time','0.5','-hls_playlist_type','vod','index.m3u8']);
generate(['-i','sample.mp4','-c','copy','-seg_duration','0.5','-use_template','1','-use_timeline','1','-f','dash','index.mpd']);
await fs.cp(path.resolve('extension'),extension,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('http://media.example.test/*');await fs.writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
let origin;
const server=http.createServer(async(req,res)=>{try{
  const u=new URL(req.url,origin),file=u.pathname.slice(1);res.setHeader('Access-Control-Allow-Origin','*');
  if(file==='page'){const media=u.searchParams.get('file');res.writeHead(200,{'Content-Type':'text/html'}).end(`<html><title>MediaDock controlled media validation</title><body><h1>Controlled media</h1><a href="${origin}/${media}">Download source</a></body></html>`);return;}
  if(file==='bad.mp4'){res.writeHead(200,{'Content-Type':'text/html'}).end('<html>Server error, not a video</html>');return;}
  if(!/^[\w.-]+$/.test(file)){res.writeHead(404).end();return;}
  let data=await fs.readFile(path.join(fixtures,file==='slow.mp4'?'sample.mp4':file==='broken.mp4'?'sample.mp4':file));
  if(file==='broken.mp4')data=data.subarray(0,Math.floor(data.length*0.6));
  if(file==='slow.mp4')await new Promise(r=>setTimeout(r,3000));
  const type=file.endsWith('.m3u8')?'application/vnd.apple.mpegurl':file.endsWith('.mpd')?'application/dash+xml':file.endsWith('.ts')?'video/mp2t':'video/mp4';
  const range=req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  if(range){const start=Number(range[1]),end=Math.min(Number(range[2]||data.length-1),data.length-1);res.writeHead(206,{'Content-Type':type,'Content-Range':`bytes ${start}-${end}/${data.length}`,'Accept-Ranges':'bytes'}).end(data.subarray(start,end+1));}
  else res.writeHead(200,{'Content-Type':type}).end(data);
 }catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://media.example.test:${server.address().port}`;
const ctx=await chromium.launchPersistentContext(path.join(out,`fixtures-profile-${Date.now()}`),{channel:'msedge',headless:true,acceptDownloads:true,args:[`--host-resolver-rules=MAP media.example.test 127.0.0.1`,`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
const report=[];
try{
 const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker'),page=await ctx.newPage(),cdp=await ctx.browser().newBrowserCDPSession();
 await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out,eventsEnabled:true});
 let seq=0;const pending=new Map();
 cdp.on('Target.receivedMessageFromTarget',e=>{const r=JSON.parse(e.message);if(r.id){const p=pending.get(r.id);pending.delete(r.id);p?.(r);}});
 async function popup(){
  await page.bringToFront();
  for(let i=0;i<4;i++){try{await worker.evaluate(()=>chrome.action.openPopup());break;}catch(e){if(i===3)throw e;await new Promise(r=>setTimeout(r,300));}}
  const t=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url.endsWith('/popup.html'));
  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:t.targetId,flatten:false});
  return async expression=>{const id=++seq,p=new Promise(resolve=>pending.set(id,resolve));await cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true,userGesture:true}})});const r=await p;if(r.result.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
 }
 for(const file of ['sample.mp4','index.m3u8','index.mpd','bad.mp4','broken.mp4','slow.mp4']){
  await page.goto(`${origin}/page?file=${file}`);const evaluate=await popup();
  for(let i=0;i<40;i++){if(await evaluate(`document.querySelector('#media-list .primary')!==null`))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(await evaluate(`document.querySelector('#media-list .primary')!==null`),true,file+' detection');
  const before=(await worker.evaluate(()=>chrome.storage.local.get('jobs'))).jobs?.length||0;
  await evaluate(`document.querySelector('#media-list .primary').click()`);
  let job;
  for(let i=0;i<90;i++){
   const jobs=(await worker.evaluate(()=>chrome.storage.local.get('jobs'))).jobs||[];
   if(jobs.length>before)job=jobs[0];
   if(file==='slow.mp4'&&job&&!['completed','failed','cancelled'].includes(job.status))await evaluate(`document.querySelector('#history').open=true;document.querySelector('#jobs button')?.click();`);
   if(job&&['completed','failed','cancelled'].includes(job.status))break;
   await new Promise(r=>setTimeout(r,500));
  }
  const expected=['bad.mp4','broken.mp4'].includes(file)?'failed':file==='slow.mp4'?'cancelled':'completed';
  report.push({file,expected,...job});console.log(file,job?.status,job?.error||'',job?.verification?.videoFrames||0);
  assert.equal(job?.status,expected,job?.error||file+' timeout');
  if(expected==='failed'||expected==='cancelled')assert.equal(job.downloadId,undefined,'A rejected source must never be saved');
  await evaluate('window.close()');
  for(let i=0;i<20;i++){if(!(await worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:['POPUP']}))).length)break;await new Promise(r=>setTimeout(r,100));}
 }
 await new Promise(r=>setTimeout(r,11000));
 assert.equal((await worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']}))).length,0,'idle engine released');
 const helper=await ctx.newPage();await helper.goto(`chrome-extension://${manifest.key?'fhjcedbbonnlkilcklhodjejolannode':''}/setup.html`);
 const leftovers=await helper.evaluate(async()=>{const root=await navigator.storage.getDirectory();const names=[];for await(const n of root.keys())names.push(n);return names;});
 assert.equal(leftovers.length,0,'temporary media removed');
 console.log('PASS: real Edge MV3, MP4/HLS/DASH, wrong-content and truncated-file rejection, cancellation, idle release and temporary-file cleanup.');
}finally{await fs.writeFile(path.join(out,'fixture-report.json'),JSON.stringify(report,null,2));await ctx.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
