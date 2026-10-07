export function publicUrl(value) {
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    const h = u.hostname.toLowerCase();
    if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return null;
    return u.href;
  } catch { return null; }
}

export function filename(title, url, mime = '') {
  let ext = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  if (!['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mp3', 'm4a', 'aac', 'ogg', 'wav', 'flac'].includes(ext)) ext = ({'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav'})[mime.toLowerCase().split(';')[0]] || 'mp4';
  const name = String(title || 'media').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 110) || 'media';
  return `MediaDock/${/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? '_' : ''}${name}.${ext}`;
}
