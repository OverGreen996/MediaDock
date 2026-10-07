export function publicUrl(value) {
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    const h = u.hostname.toLowerCase();
    if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return null;
    return u.href;
  } catch { return null; }
}

export function mediaKind(url, type = '') {
  let path;
  try { path = new URL(url).pathname.toLowerCase(); } catch { return null; }
  type = type.toLowerCase().split(';')[0];
  if (/\.m3u8$/.test(path) || /mpegurl/.test(type)) return 'HLS';
  if (/\.mpd$/.test(path) || type === 'application/dash+xml') return 'DASH';
  if (/\.(mp4|webm|mov|m4v|ogv)$/.test(path) || type.startsWith('video/') && !/mp2t/.test(type)) return '影片';
  if (/\.(mp3|m4a|aac|ogg|wav|flac)$/.test(path) || type.startsWith('audio/')) return '音訊';
  return null;
}

export function siteName(url) {
  try {
    const h = new URL(url).hostname;
    if (h === 'youtu.be' || h === 'youtube.com' || h.endsWith('.youtube.com')) return 'YouTube';
    if (h === 'bilibili.com' || h.endsWith('.bilibili.com') || h === 'b23.tv') return 'Bilibili';
    const platforms = [['Vimeo', 'vimeo.com'], ['Dailymotion', 'dailymotion.com'], ['Dailymotion', 'dai.ly'], ['Twitch', 'twitch.tv'], ['TikTok', 'tiktok.com'], ['Instagram', 'instagram.com'], ['Facebook', 'facebook.com'], ['Facebook', 'fb.watch'], ['X', 'x.com'], ['X', 'twitter.com'], ['抖音', 'douyin.com'], ['優酷', 'youku.com'], ['騰訊影片', 'v.qq.com'], ['AcFun', 'acfun.cn'], ['Niconico', 'nicovideo.jp'], ['SoundCloud', 'soundcloud.com']];
    for (const [name, domain] of platforms) if (h === domain || h.endsWith('.' + domain)) return name;
    return h;
  } catch { return '網站'; }
}

export function filename(title, url, mime = '') {
  let ext = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  if (!['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mp3', 'm4a', 'aac', 'ogg', 'wav', 'flac'].includes(ext)) ext = ({'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav'})[mime.toLowerCase().split(';')[0]] || 'mp4';
  const name = String(title || 'media').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 110) || 'media';
  return `MediaDock/${/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? '_' : ''}${name}.${ext}`;
}
