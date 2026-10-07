// Runs in the current YouTube page. Return player metadata only; never read account cookies.
export function readYouTubePlayer(){
 try{
 const u=new URL(location.href),id=u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/shorts\/([\w-]{11})\/?$/)?.[1];
 if(u.protocol!=='https:'||u.hostname!=='www.youtube.com'||!/^[-\w]{11}$/.test(id||''))throw new Error('請開啟 YouTube 影片播放頁。');
 const player=document.getElementById('movie_player'),data=player?.getPlayerResponse?.();
 if(document.querySelector('.ad-showing')||player?.isAdPlaying?.())throw new Error('請等廣告結束，播放主影片後再讀取。');
 if(data?.videoDetails?.videoId!==id||player.getVideoData?.().video_id!==id)throw new Error('播放器尚未載入目前影片。');
 if(data.videoDetails.isLive||data.videoDetails.isLiveContent)throw new Error('直播與直播回放暫不支援。');
 const formats=data.streamingData?.adaptiveFormats;if(!formats?.length||!data.streamingData.serverAbrStreamingUrl)throw new Error('播放器尚未提供專用串流。');
 return {id,sourceUrl:u.href,title:data.videoDetails.title,uploader:data.videoDetails.author,duration:Number(data.videoDetails.lengthSeconds),rawUrl:data.streamingData.serverAbrStreamingUrl,formats:formats.slice(0,200).filter(f=>!f.drmFamilies?.length).map(f=>({itag:f.itag,xtags:f.xtags,lastModified:f.lastModified,width:f.width,height:f.height,mimeType:f.mimeType,bitrate:f.bitrate,contentLength:Number(f.contentLength)||0,approxDurationMs:Number(f.approxDurationMs),audioQuality:f.audioQuality,qualityLabel:f.qualityLabel,audioTrackId:f.audioTrack?.id,isOriginal:f.audioTrack?.audioIsDefault!==false}))};
 }catch(error){return {error:error.message};}
}
