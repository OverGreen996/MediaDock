// Injected only when the user presses “掃描頁面”; no page scripts or globals are trusted.
(() => {
  const found = new Map();
  function add(value, type = '', source = '頁面', base = document.baseURI) {
    if (!value) return;
    try {
      const u = new URL(value, base);
      if (!['https:', 'http:'].includes(u.protocol)) return;
      if (!type && !/\.(mp4|webm|mov|m4v|ogv|mp3|m4a|aac|ogg|wav|flac|m3u8|mpd)(?:$|\?)/i.test(u.href)) return;
      found.set(u.href, {url: u.href, mime: type, source});
    } catch { /* blob URLs contain no downloadable remote address */ }
  }
  const docs = [document];
  for (let i = 0; i < docs.length && i < 20; i++) {
    const doc = docs[i];
    const collect = (value, type, source) => add(value, type, source || (i ? '內嵌播放器' : '頁面'), doc.baseURI);
    doc.querySelectorAll('video,audio').forEach(el => { collect(el.currentSrc, el.tagName === 'VIDEO' ? 'video/unknown' : 'audio/unknown'); collect(el.getAttribute('src'), el.tagName === 'VIDEO' ? 'video/unknown' : 'audio/unknown'); });
    doc.querySelectorAll('video source,audio source').forEach(el => collect(el.src, el.type));
    [...doc.querySelectorAll('a[href]')].slice(0, 5000).forEach(el => collect(el.href));
    doc.defaultView?.performance.getEntriesByType('resource').slice(-400).forEach(entry => collect(entry.name, '', '已載入資源'));
    doc.querySelectorAll('iframe').forEach(frame => {
      try { if (docs.length < 20 && frame.contentDocument && !docs.includes(frame.contentDocument)) docs.push(frame.contentDocument); } catch { /* cross-origin players use the optional network detector */ }
    });
  }
  return {title: document.title, url: location.href, media: [...found.values()].slice(0, 100)};
})();
