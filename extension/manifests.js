import {publicUrl} from './media.js';
function seconds(value){const m=String(value||'').match(/^P(?:(\d+(?:\.\d+)?)D)?T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/);return m?Number(m[1]||0)*86400+Number(m[2]||0)*3600+Number(m[3]||0)*60+Number(m[4]||0):0;}
const children=(node,name)=>[...node.children].filter(x=>x.localName===name);
function base(node,url){const value=children(node,'BaseURL')[0]?.textContent?.trim();return value?new URL(value,url).href:url;}
function attributes(node){return Object.fromEntries([...(node?.attributes||[])].map(x=>[x.name,x.value]));}
export async function resolveDash(plan){
  const url=plan.formats[0].url,response=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`DASH 清單回應 ${response.status}`);
  const text=await response.text();if(text.length>2*1024*1024)throw new Error('DASH 清單過大。');
  const doc=new DOMParser().parseFromString(text,'application/xml'),mpd=doc.documentElement;
  if(mpd.localName!=='MPD'||doc.querySelector('parsererror'))throw new Error('DASH 清單格式不正確。');
  if(mpd.getAttribute('type')==='dynamic')throw new Error('DASH 直播暫不支援。');
  if([...doc.getElementsByTagName('*')].some(n=>n.localName==='ContentProtection'))throw new Error('此 DASH 影片含加密保護。');
  const periods=children(mpd,'Period');if(periods.length!==1)throw new Error('多段 Period 的 DASH 暫不支援。');
  const period=periods[0],duration=seconds(period.getAttribute('duration'))||seconds(mpd.getAttribute('mediaPresentationDuration'));
  const mpdBase=base(mpd,response.url),periodBase=base(period,mpdBase),candidates=[];
  for(const adapt of children(period,'AdaptationSet')){
    const adaptBase=base(adapt,periodBase);
    for(const rep of children(adapt,'Representation')){
      const a={...attributes(adapt),...attributes(rep)},mime=a.mimeType||'',type=a.contentType||mime.split('/')[0];
      if(!['video','audio'].includes(type))continue;
      candidates.push({adapt,rep,a,type,url:base(rep,adaptBase),height:Number(a.height)||0,bitrate:Number(a.bandwidth)||0});
    }
  }
  const selected=['video','audio'].map(type=>candidates.filter(c=>c.type===type).sort((a,b)=>b.height-a.height||Number(/avc1|mp4a/.test(b.a.codecs||''))-Number(/avc1|mp4a/.test(a.a.codecs||''))||b.bitrate-a.bitrate)[0]).filter(Boolean);
  if(!selected.length)throw new Error('DASH 清單沒有可下載的影音。');
  const formats=selected.map(c=>{
    const templates=[children(c.adapt,'SegmentTemplate')[0],children(c.rep,'SegmentTemplate')[0]].filter(Boolean),template=templates.at(-1);
    const list=children(c.rep,'SegmentList')[0]||children(c.adapt,'SegmentList')[0];let segments;
    if(template){
      const a=Object.assign({},...templates.map(attributes)),timescale=Number(a.timescale)||1,start=Number(a.startNumber)||1;
      const substitute=(s,number,time)=>s.replace(/\$\$/g,'\u0000').replace(/\$(RepresentationID|Bandwidth|Number|Time)(?:%0(\d+)d)?\$/g,(_,key,pad)=>String({RepresentationID:c.a.id,Bandwidth:c.a.bandwidth,Number:number,Time:time}[key]??'').padStart(Number(pad)||0,'0')).replace(/\u0000/g,'$');
      if(!a.initialization||!a.media)throw new Error('DASH 缺少初始化或媒體分段。');
      segments=[new URL(substitute(a.initialization,start,0),c.url).href];
      const timeline=templates.map(t=>children(t,'SegmentTimeline')[0]).filter(Boolean).at(-1);
      let number=start,time=0;
      if(timeline){const items=children(timeline,'S');for(let i=0;i<items.length;i++){
        const s=items[i],d=Number(s.getAttribute('d'));if(!(d>0))throw new Error('DASH 分段片長錯誤。');
        if(s.hasAttribute('t'))time=Number(s.getAttribute('t'));
        let count=Number(s.getAttribute('r')||0)+1;
        if(count===0){const boundary=items[i+1]?.getAttribute('t');if(boundary===null||boundary===undefined){if(!duration)throw new Error('DASH 缺少總片長。');count=Math.ceil((duration*timescale-time)/d);}else count=Math.ceil((Number(boundary)-time)/d);}
        if(count<1||count>20000||segments.length+count>20000)throw new Error('DASH 分段數量不支援。');
        for(let j=0;j<count;j++){segments.push(new URL(substitute(a.media,number++,time),c.url).href);time+=d;}
      }}else{
        const d=Number(a.duration);if(!(d>0&&duration>0))throw new Error('DASH 缺少分段片長。');
        const count=Math.ceil(duration*timescale/d);if(count>20000)throw new Error('DASH 分段過多。');
        for(let i=0;i<count;i++)segments.push(new URL(substitute(a.media,start+i,i*d),c.url).href);
      }
    }else if(list){
      const init=children(list,'Initialization')[0];if(!init?.getAttribute('sourceURL')||init.hasAttribute('range'))throw new Error('此 DASH 初始化形式暫不支援。');
      segments=[new URL(init.getAttribute('sourceURL'),c.url).href,...children(list,'SegmentURL').map(s=>{if(s.hasAttribute('mediaRange'))throw new Error('DASH 分段位元組範圍暫不支援。');return new URL(s.getAttribute('media'),c.url).href;})];
    }else if(c.url===url||!publicUrl(c.url))throw new Error('DASH 缺少媒體網址。');
    if(segments?.some(s=>!publicUrl(s)))throw new Error('DASH 分段網址不支援。');
    return {url:c.url,segments,video:c.type==='video',audio:c.type==='audio',height:c.height,mime:c.a.mimeType||''};
  });
  return {...plan,formats,duration:duration||undefined};
}
