let worker;
const active=new Set(),urls=new Map(),released=new Set();
async function send(m){const r=await chrome.runtime.sendMessage(m);if(!r?.ok)throw new Error(r?.error||'下載工作已中斷。');return r.data;}
async function release(id){released.add(id);const url=urls.get(id);if(url){URL.revokeObjectURL(url);urls.delete(id);}active.delete(id);worker?.postMessage({action:'release',id});}
function getWorker(){
  if(worker)return worker;worker=new Worker('engine.bundle.js',{type:'module'});
  worker.onerror=async e=>{worker?.terminate();worker=null;for(const id of active)await send({action:'job',job:{id,status:'failed',error:e.message||'下載引擎發生錯誤'}}).catch(()=>{});for(const id of [...active])await release(id);};
  worker.onmessage=async({data:d})=>{
    if(d.type==='released'&&!active.size&&!urls.size){worker?.terminate();worker=null;}
    if(d.type==='job'){await send({action:'job',job:d.job}).catch(()=>{});if(['failed','cancelled'].includes(d.job.status))await release(d.job.id);}
    if(d.type==='file'){
      const {id,file,filename,verification}=d;if(released.has(id))return;
      const mime=filename.endsWith('.webm')?(verification.videoFrames?'video/webm':'audio/webm'):filename.endsWith('.m4a')?'audio/mp4':'video/mp4';
      const url=URL.createObjectURL(new Blob([file],{type:mime}));urls.set(id,url);
      try{await send({action:'saveFile',id,url,filename,verification});if(released.has(id))await release(id);}catch(e){await send({action:'job',job:{id,status:/cancel|canceled|取消/i.test(e.message)?'cancelled':'failed',error:e.message}}).catch(()=>{});await release(id);}
    }
  };return worker;
}
chrome.runtime.onMessage.addListener((m,s,respond)=>{
  if(m.target!=='engine'||s.id!==chrome.runtime.id||s.tab||s.url!==chrome.runtime.getURL('background.js'))return false;
  if(m.action==='start'){
    active.add(m.plan.id);respond({ok:true});
    (async()=>{try{const plan=m.plan;if(released.has(plan.id))return;getWorker().postMessage({action:'start',plan});}catch(e){await send({action:'job',job:{id:m.plan.id,status:'failed',error:e.message}}).catch(()=>{});await release(m.plan.id);}})();
  }
  else if(m.action==='cancel'){released.add(m.id);worker?.postMessage({action:'cancel',id:m.id});send({action:'job',job:{id:m.id,status:'cancelled',error:''}}).catch(()=>{});if(!worker)active.delete(m.id);respond({ok:true});}
  else if(m.action==='release'){release(m.id);respond({ok:true});}
  else if(m.action==='idle')respond({idle:!active.size&&!urls.size});return false;
});
