import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const out=path.resolve('test-output/pure'),cases=[];
for(const name of process.argv.slice(2).length?process.argv.slice(2):['youtube-1440','youtube-2160','shorts-2964','bili-best']){
 const job=JSON.parse(fs.readFileSync(path.join(out,name+'-report.json'),'utf8'))[0];
 const saved=JSON.parse(fs.readFileSync(path.join(out,name+'-files.json'),'utf8'))[0];
 assert.ok(saved.filename.startsWith(out+path.sep));
 const hash=createHash('sha256');for await(const chunk of fs.createReadStream(saved.filename))hash.update(chunk);assert.equal(hash.digest('hex'),job.verification.sha256,'Saved bytes differ from verified bytes');
 cases.push({name,job,saved});
}
const server=http.createServer((req,res)=>{
 if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html'}).end('<html><head><style>body{font-family:Segoe UI;background:#111827;color:#f9fafb;margin:24px}h1{font-size:24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}article{background:#1f2937;padding:16px;border-radius:12px}canvas{width:100%;height:200px;object-fit:contain;background:#000}p{margin:8px 0;font-size:13px}</style></head><body><h1>MediaDock 0.4 · Saved-file playback verification</h1><div class="grid"></div></body></html>');return;}
 const c=cases[Number(req.url.slice(1))];if(!c){res.writeHead(404).end();return;}
 const size=fs.statSync(c.saved.filename).size,range=req.headers.range?.match(/bytes=(\d+)-(\d*)/),start=range?Number(range[1]):0,end=range?Math.min(Number(range[2]||size-1),size-1):size-1;
 res.writeHead(range?206:200,{'Content-Type':'video/mp4','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});fs.createReadStream(c.saved.filename,{start,end}).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1000,height:690}}),report=[];
try{
 await page.goto(origin);
 for(let i=0;i<cases.length;i++){
  const c=cases[i];
  const result=await page.evaluate(async({index,url,name,verification})=>{
   const video=document.createElement('video');video.muted=true;video.preload='auto';video.src=url;
   const event=(name,timeout=25000)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(name+' timeout')),timeout);video.addEventListener(name,()=>{clearTimeout(timer);resolve();},{once:true});video.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Playback error '+video.error?.code));},{once:true});});
   await event('loadedmetadata');await video.play();await new Promise(r=>setTimeout(r,350));video.pause();
   const duration=video.duration,width=video.videoWidth,height=video.videoHeight;
   const seeks=[];for(const fraction of [0.1,0.4,0.8]){const done=event('seeked');video.currentTime=duration*fraction;await done;await video.play();await new Promise(r=>setTimeout(r,150));video.pause();seeks.push(video.currentTime);}
   const article=document.createElement('article'),label=document.createElement('p'),canvas=document.createElement('canvas');canvas.width=480;canvas.height=270;const scale=Math.min(480/width,270/height);canvas.getContext('2d').drawImage(video,(480-width*scale)/2,(270-height*scale)/2,width*scale,height*scale);label.textContent=`${name} · ${width} × ${height} · ${duration.toFixed(2)} s · source ${verification.sourceId}`;article.append(canvas,label);document.querySelector('.grid').append(article);
   const sought=event('seeked');video.currentTime=Math.max(0,duration-0.6);await sought;const ended=event('ended',15000);await video.play();await ended;
   const frames=video.getVideoPlaybackQuality().totalVideoFrames;video.src='';video.load();return {duration,width,height,seeks,ended:true,frames};
  },{index:i,url:origin+'/'+i,name:c.name,verification:c.job.verification});
  assert.equal(result.height,c.job.verification.videoHeight);assert.ok(Math.abs(result.width-c.job.verification.videoWidth)<=1);assert.ok(Math.abs(result.duration-c.job.verification.duration)<0.5);assert.ok(result.frames>0);
  report.push({name:c.name,sourceId:c.job.verification.sourceId,sha256:c.job.verification.sha256,...result});console.log('PASS',c.name,result.width+'x'+result.height,'seek and natural end');
 }
 await page.screenshot({path:path.join(out,'verified-playback.png')});
}finally{fs.writeFileSync(path.join(out,'playback-report.json'),JSON.stringify(report,null,2));await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
