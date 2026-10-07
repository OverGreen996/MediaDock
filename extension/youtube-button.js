(() => {
  if (window.top !== window || document.getElementById('mediadock-yt-download')) return;
  let host, container, timer, toastTimer;
  const discover = new MutationObserver(schedule);
  const local = new MutationObserver(schedule);
  const shareName = /share|分享|共有|シェア|공유|teilen|partager|compartir|поделиться/i;
  function videoPage() {
    const url = new URL(location.href);
    return url.pathname === '/watch' && /^[\w-]{11}$/.test(url.searchParams.get('v') || '') || /^\/shorts\/[\w-]{11}\/?$/.test(url.pathname);
  }
  function schedule() { if (!timer) timer = setTimeout(() => { timer = null; mount(); }, 100); }
  function visible(el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && !el.closest('[hidden], [aria-hidden="true"]'); }
  function row() {
    if (location.pathname === '/watch') return document.querySelector('ytd-watch-flexy #top-level-buttons-computed');
    return [...document.querySelectorAll('ytd-shorts reel-action-bar-view-model, ytd-reel-video-renderer[is-active] #actions')].find(visible);
  }
  function create() {
    host = document.createElement('span'); host.id = 'mediadock-yt-download';
    const shadow = host.attachShadow({mode: 'open'});
    shadow.innerHTML = `<style>
      :host{display:inline-flex;position:relative;flex:none;margin-left:8px;vertical-align:middle;color:var(--yt-spec-text-primary,#0f0f0f);font-family:Roboto,"Segoe UI",sans-serif}
      button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:36px;padding:0 14px;border:0;border-radius:999px;background:var(--yt-spec-badge-chip-background,rgba(0,0,0,.05));color:inherit;font:500 14px/1.2 Roboto,"Segoe UI",sans-serif;cursor:pointer;white-space:nowrap}
      button:hover{background:var(--yt-spec-button-chip-background-hover,rgba(0,0,0,.1))}button:focus-visible{outline:2px solid var(--yt-spec-call-to-action,#065fd4);outline-offset:3px}button:disabled{opacity:.65;cursor:wait}svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
      :host([shorts]){margin:0;display:flex;justify-content:center}:host([shorts]) button{flex-direction:column;gap:5px;border-radius:12px;padding:8px 4px;font-size:12px;background:transparent;min-width:48px}:host([shorts]) svg{box-sizing:content-box;width:24px;height:24px;padding:12px;border-radius:50%;background:var(--yt-spec-badge-chip-background,rgba(0,0,0,.05))}:host([shorts]) button:hover svg{background:var(--yt-spec-button-chip-background-hover,rgba(0,0,0,.1))}
      .toast{position:absolute;z-index:1000;top:calc(100% + 8px);right:0;min-width:200px;max-width:280px;padding:10px 12px;background:var(--yt-spec-raised-background,#fff);color:inherit;box-shadow:0 3px 14px #0003;border-radius:8px;font-size:12px;line-height:1.6}.toast[hidden]{display:none}
      @media(max-width:650px){:host(:not([shorts])) button{width:36px;padding:0}:host(:not([shorts])) button>span{display:none}}
    </style><button type="button" title="下載影片 · MediaDock" aria-label="使用 MediaDock 下載這部影片"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/></svg><span>下載</span></button><div class="toast" role="status" hidden></div>`;
    const button = shadow.querySelector('button'), toast = shadow.querySelector('.toast');
    button.addEventListener('click', async event => {
      if (!event.isTrusted) return;
      event.preventDefault(); event.stopPropagation();
      if (button.disabled) return;
      button.disabled = true; toast.hidden = true;
      try {
        const reply = await chrome.runtime.sendMessage({action: 'openDownloader'});
        if (!reply?.ok) throw new Error(reply?.error || '請點工具列的 MediaDock 圖示。');
      } catch (error) {
        toast.textContent = /context invalidated/i.test(error.message) ? '擴充功能已更新，請重新整理影片頁。' : error.message;
        toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 7000);
      } finally { button.disabled = false; }
    });
  }
  function mount() {
    if (!videoPage()) { cleanup(); return; }
    const next = row();
    if (!next) {
      host?.remove(); container = null; local.disconnect();
      discover.observe(document.body, {childList: true, subtree: true}); return;
    }
    if (!host) create();
    host.toggleAttribute('shorts', location.pathname.startsWith('/shorts/'));
    const share = [...next.querySelectorAll('button')].find(b => shareName.test(b.getAttribute('aria-label') || b.textContent));
    let anchor = share;
    while (anchor && anchor.parentElement !== next) anchor = anchor.parentElement;
    if (anchor && host.previousElementSibling !== anchor) anchor.after(host);
    else if (!anchor && host.parentElement !== next) next.append(host);
    discover.disconnect();
    if (container !== next) {
      container = next; local.disconnect();
      // Watch the small action row and direct ancestor children, not player ticks or comments.
      local.observe(next, {childList: true, subtree: true});
      for (let node = next.parentElement; node && node !== document.body; node = node.parentElement) local.observe(node, {childList: true});
    }
  }
  function cleanup() { clearTimeout(timer); timer = null; clearTimeout(toastTimer); discover.disconnect(); local.disconnect(); host?.remove(); container = null; }
  function begin() { cleanup(); if (videoPage() && document.body) mount(); }
  document.addEventListener('yt-navigate-start', cleanup);
  document.addEventListener('yt-navigate-finish', begin);
  document.addEventListener('yt-page-data-updated', schedule);
  window.addEventListener('popstate', begin);
  window.addEventListener('pagehide', cleanup);
  window.addEventListener('pageshow', begin);
  begin();
})();
