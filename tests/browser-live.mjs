import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('test-output/pure');fs.mkdirSync(out,{recursive:true});
const kind=process.argv[2]||'youtube',quality=process.argv[3]||'2160';
const ctx=await chromium.launchPersistentContext(path.join(out,`edge-profile-${kind}-${quality}-${Date.now()}`),{channel:'msedge',headless:true,acceptDownloads:true,args:[`--disable-extensions-except=${path.resolve('extension')}`,`--load-extension=${path.resolve('extension')}`]});
try{
 const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');worker.on('console',m=>console.log('WORKER',m.text()));
 const page=await ctx.newPage();
 page.on('console',m=>{if(m.type()==='error')console.log('PAGE ERROR',m.text());});
 await ctx.route('https://www.youtube.com/watch?**',r=>r.request().isNavigationRequest()?r.fulfill({contentType:'text/html',body:'<html><title>YouTube pure extension validation</title><body>Video page</body></html>'}):r.continue());
 await ctx.route('https://www.youtube.com/shorts/**',r=>r.request().isNavigationRequest()?r.fulfill({contentType:'text/html',body:'<html><title>Shorts validation</title><body>Shorts page</body></html>'}):r.continue());
 await ctx.route('https://www.bilibili.com/video/**',r=>r.request().isNavigationRequest()?r.fulfill({contentType:'text/html',body:'<html><title>Bilibili validation</title><body>Bilibili page</body></html>'}):r.continue());
 await page.goto(kind==='bili'?'https://www.bilibili.com/video/BV15z4y1U7HS/':kind==='shorts'?'https://www.youtube.com/shorts/18NGQq7p3LY':'https://www.youtube.com/watch?v=a9LDPn-MO4I');
 await worker.evaluate(()=>chrome.action.openPopup());
 const cdp=await ctx.browser().newBrowserCDPSession();
 await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out,eventsEnabled:true});
 const target=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url.endsWith('/popup.html'));
 const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});
 let seq=0;const pending=new Map();
 cdp.on('Target.receivedMessageFromTarget',event=>{const r=JSON.parse(event.message);if(r.id){const p=pending.get(r.id);pending.delete(r.id);p?.(r);}else if(r.method==='Runtime.exceptionThrown')console.log('POPUP ERROR',r.params.exceptionDetails);});
 const command=(method,params)=>new Promise(resolve=>{const id=++seq;pending.set(id,resolve);cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})});});
 const evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.result.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
 await command('Runtime.enable',{});
 for(let i=0;i<60;i++){if(await evaluate(`!document.querySelector('#quality').disabled`))break;await new Promise(r=>setTimeout(r,500));}
 console.log('UI',await evaluate(`({quality:document.querySelector('#quality').value,options:[...document.querySelector('#quality').options].map(o=>o.textContent),message:document.querySelector('#message').textContent})`));
 assert.equal(await evaluate(`document.querySelector('#start').disabled`),false,'Platform parsing failed');
 await evaluate(`document.querySelector('#quality').value=${JSON.stringify(quality)};document.querySelector('#start').click();`);
 let jobs,last='';
 for(let i=0;i<360;i++){
   jobs=(await worker.evaluate(()=>chrome.storage.local.get('jobs'))).jobs||[];
   const j=jobs[0];const status=j?j.status+' '+Math.round(j.progress||0):'waiting';if(status!==last){console.log(status,j?.error||'');last=status;}
   if(j&&['completed','failed','cancelled'].includes(j.status))break;
   await new Promise(r=>setTimeout(r,1000));
 }
 fs.writeFileSync(path.join(out,`${kind}-${quality}-report.json`),JSON.stringify(jobs,null,2));
 assert.equal(jobs[0]?.status,'completed',jobs[0]?.error||'Timeout');
 const files=await worker.evaluate(()=>chrome.downloads.search({}));console.log('FILE',files.map(f=>({filename:f.filename,state:f.state,bytes:f.fileSize,mime:f.mime})));
 fs.writeFileSync(path.join(out,`${kind}-${quality}-files.json`),JSON.stringify(files.map(f=>({filename:f.filename,state:f.state,bytes:f.fileSize,mime:f.mime})),null,2));
}finally{await ctx.close();}
