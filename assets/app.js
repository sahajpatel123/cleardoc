(function(){
  "use strict";
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || /[?&]rm=1/.test(location.search);
  const hasGSAP = !!window.gsap;
  const noMotion = reduce || !hasGSAP;          // superset: treat missing libs like reduced motion
  const $=(s,el)=> (el||document).querySelector(s);
  const $$=(s,el)=> [...(el||document).querySelectorAll(s)];
  if(hasGSAP) gsap.registerPlugin(ScrollTrigger);

  /* ---- service worker registration (offline) ---- */
  // Only register on real origins — file:// and other insecure schemes
  // will throw, and we don't want that to break the page.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        // Surface update notifications — when a new SW is waiting, refresh-on-confirm.
        if (reg.waiting) promptSWUpdate(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              promptSWUpdate(sw);
            }
          });
        });
      }).catch((err) => {
        // Silent: a broken SW registration must never block the app.
        console.warn('[sw] registration failed:', err && err.message || err);
      });
    });

    function promptSWUpdate(worker){
      // Soft-prompt via a transient banner — never hard-reload the user
      // without consent (they may be mid-analysis or typing in the textarea).
      let banner = document.getElementById('swUpdateBanner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'swUpdateBanner';
        banner.setAttribute('role', 'status');
        banner.setAttribute('aria-live', 'polite');
        banner.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;background:#14120E;color:#EDE7D8;border:3px solid #FF3B00;box-shadow:6px 6px 0 #14120E;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;font-family:"JetBrains Mono",monospace;font-size:12px;letter-spacing:.06em;text-transform:uppercase;max-width:560px;margin:0 auto;';
        banner.innerHTML = '<span><b style="color:#FF6A3D">Update ready.</b> A newer version is available.</span>';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Reload';
        btn.style.cssText = 'background:#FF3B00;color:#fff;border:none;font-family:inherit;font-size:inherit;padding:8px 14px;cursor:pointer;letter-spacing:inherit;text-transform:inherit;';
        btn.addEventListener('click', () => {
          worker && worker.postMessage && worker.postMessage('SKIP_WAITING');
          window.location.reload();
        });
        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.textContent = 'Later';
        dismiss.style.cssText = 'background:transparent;color:#EDE7D8;border:1px solid #EDE7D8;font-family:inherit;font-size:inherit;padding:7px 12px;cursor:pointer;letter-spacing:inherit;text-transform:inherit;';
        dismiss.addEventListener('click', () => banner.remove());
        banner.appendChild(btn);
        banner.appendChild(dismiss);
        document.body.appendChild(banner);
      }
    }
  }

  /* ---- motion contract ---- */
  const EASE={enter:'power3.out',exit:'power2.in',sweep:'power2.inOut',stamp:'back.out(1.8)'};
  const DUR={micro:.18,base:.32,macro:.6};
  const RISK_COLORS={g:'var(--green)',a:'var(--amber)',r:'var(--danger)'};

  /* ---- shared visibility gate: in-viewport AND tab-visible ---- */
  const gated=[]; // {el, on, off, active}
  function gate(el, on, off){
    const rec={el,on,off,inView:false};
    gated.push(rec);
    if(hasGSAP) ScrollTrigger.create({trigger:el,start:'top 92%',end:'bottom 8%',
      onToggle:self=>{rec.inView=self.isActive; apply(rec);}});
    else { rec.inView=true; apply(rec); }
    return rec;
  }
  function apply(rec){ const run=rec.inView && !document.hidden; run?rec.on():rec.off(); }
  document.addEventListener('visibilitychange',()=>gated.forEach(apply));

  /* ---- scroll helper ---- */
  let lenis=null;
  function scrollToEl(sel){const el=$(sel);if(!el)return;
    if(lenis) lenis.scrollTo(el,{offset:-10}); else el.scrollIntoView({behavior:noMotion?'auto':'smooth'});}

  /* ---- shared clarify engine (offline) ---- */
  const JARGON=[
    [/\bnotwithstanding any provision herein(,? to the contrary)?\b/gi,'no matter what else this says'],
    [/\bnotwithstanding\b/gi,'despite'],[/\bin perpetuity\b/gi,'forever'],[/\bheretofore\b/gi,'until now'],
    [/\bindemnify and hold (\w+ )?harmless\b/gi,'cover the losses of'],[/\bindemnify\b/gi,'cover the losses of'],
    [/\bhold (\w+ )?harmless\b/gi,'not blame'],[/\blessee\b/gi,'you (the renter)'],[/\blessor\b/gi,'the landlord'],
    [/\baforementioned\b/gi,'already-mentioned'],[/\bpursuant to\b/gi,'under'],[/\bset forth herein\b/gi,'written here'],
    [/\bherein\b/gi,'in this document'],[/\bshall\b/gi,'must'],[/\bforfeit\b/gi,'lose'],
    [/\bdeductibles?\b/gi,'out-of-pocket costs'],[/\bpolicyholder\b/gi,'you'],[/\btendered\b/gi,'given'],
    [/\bliable\b/gi,'responsible'],[/\bfacility fees?\b/gi,'extra hospital charges'],[/\bevergreen\b/gi,'auto-renewing']
  ];
  function clarify(raw){
    let text=(raw||"").trim();
    // Soft cap the input length to keep the JARGON regex array (30 patterns,
    // each running .test + .replace) under a second on a typical laptop.
    // Without this, a user pasting a multi-MB string freezes the tab while
    // every pattern sweeps the entire buffer. Cap matches MAX_DOCUMENT_CHARS
    // on the analyze path so the BYOF demo can't outlive its server-side twin.
    const CLARIFY_MAX_CHARS = 40000;
    if(text.length > CLARIFY_MAX_CHARS){
      text = text.slice(0, CLARIFY_MAX_CHARS);
    }
    let found=0;
    // wrap replacements in printable sentinels, THEN HTML-escape user text, so input can never inject markup
    JARGON.forEach(([re,plain])=>{ const r=new RegExp(re.source,re.flags); if(r.test(text)){found++; text=text.replace(new RegExp(re.source,re.flags),"[[B]]"+plain+"[[/B]]");} });
    // Use the shared `esc()` so quote escaping (&quot; / &#39;) applies here
    // too — defense-in-depth against any future template that interpolates
    // clarify()'s html into attribute context.
    text = esc(text);
    const html=text.split("[[B]]").join("<b>").split("[[/B]]").join("</b>");
    return {html, found, changed:found>0, empty:!text};
  }
  // Approximate Flesch-Kincaid reading grade (US grade level 4..18). Always
  // returns a number so the analyzer page can plug it directly into the
  // result panel without null-checking. The BYOF demo uses isGradable()
  // (below) to decide whether the score is meaningful to display.
  function gradeLevel(text){
    const t = String(text||'').trim();
    const words = (t.match(/\b[\w'-]+\b/g) || []);
    if (words.length < 5) return 4;
    const sents = t.split(/[.!?]+/).filter(s => s.trim());
    const wps = words.length / Math.max(1, sents.length || 1);
    const longish = words.filter(w => w.length >= 8).length / words.length;
    return Math.max(4, Math.min(18, Math.round(4 + wps*0.45 + longish*22)));
  }
  // True only when the input has enough words + sentences to make a
  // reading-grade score meaningful. Used by the BYOF demo to gate the
  // "READING LEVEL x → y" display.
  function isGradable(text){
    const t = String(text||'').trim();
    if (t.length < 30) return false;
    return (t.match(/\b[\w'-]+\b/g) || []).length >= 8;
  }

  // Approximate reading time in plain English. Uses 250 words/min as the
  // silent-reading baseline (Brysbaert 2019 meta-analysis of ~9000 readers)
  // — fast enough to feel honest for legal text, conservative enough that
  // dense documents don't undersell. Rounds to the nearest 30s once we hit
  // 1 min so the display doesn't churn between "1 min" and "1 min" as the
  // user types. Returns '—' for empty / wordless input so the UI never
  // shows "0s" or "0 min" (which would mislead the user into thinking the
  // document is trivial).
  //   readTime("")                              → '—'
  //   readTime("hello world")                   → '5s'  (2 words → <60s)
  //   readTime("a ".repeat(100))                → '24s' (100 words → 24s)
  //   readTime("a ".repeat(500))                → '2 min' (500 words → 2.0 min)
  //   readTime("a ".repeat(1500))               → '6 min' (1500 words → 6.0 min)
  //   readTime("a ".repeat(250))                → '1 min' (250 words → 1.0 min)
  function readTime(text){
    const t = String(text||'').trim();
    if (!t) return '—';
    const words = (t.match(/\b[\w'-]+\b/g) || []).length;
    if (words === 0) return '—';
    const seconds = Math.ceil((words / 250) * 60);
    if (seconds < 60) return seconds + 's';
    // Round to nearest 30s once we cross the 1-min threshold. 65s → 1 min,
    // 75s → 1.5 min, 100s → 1.5 min, 105s → 2 min.
    const minutes = Math.round(seconds / 30) / 2;
    return minutes + ' min';
  }

  /* ================= PRELOADER ================= */
  const loader=$('#loader'),bar=$('#loader .lbar i'),lpct=$('#lpct'),panel=$('.reveal-panel');
  let started=false;
  function startSite(){ if(started)return; started=true; try{heroIntro();}catch(e){console.error(e);} initAll(); }
  function boot(){
    if(noMotion){ if(loader)loader.style.display='none'; startSite(); return; }
    const o={v:0};
    gsap.timeline()
      .to(o,{v:100,duration:1.1,ease:'power2.inOut',onStart:()=>loader.classList.add('go'),onUpdate:()=>{bar.style.width=o.v+'%';lpct.textContent=Math.round(o.v)+'%';}})
      .to('#loader .lword,#loader .lbar,#loader .lmeta',{y:-26,opacity:0,duration:.5,ease:EASE.exit,stagger:.05})
      .set(loader,{display:'none'})
      .fromTo(panel,{y:'0%'},{y:'-100%',duration:.9,ease:'power4.inOut'},'<')
      .add(startSite,'-=.3');
  }
  /* hard fallback — never let a stalled rAF / slow preloader trap the page */
  setTimeout(()=>{ if(loader)loader.style.display='none'; startSite(); }, 2800);
  function heroIntro(){
    const chars=splitHeadline();
    if(!chars.length)return;
    if(noMotion){gsap.set(chars,{opacity:1});return;}
    gsap.set('.char',{willChange:'transform,opacity,filter'});
    gsap.fromTo(chars,{yPercent:120,opacity:0,filter:'blur(8px)'},{yPercent:0,opacity:1,filter:'blur(0px)',duration:.6,ease:EASE.enter,stagger:.02,
      onComplete:()=>gsap.set('.char',{clearProps:'willChange'})});
  }
  function splitHeadline(){
    const hl=$('#heroTitle'); if(!hl) return [];
    [...hl.childNodes].forEach(n=>{ if(n.nodeType===3 && n.textContent.trim()){
      const frag=document.createDocumentFragment();
      n.textContent.split(/(\s+)/).forEach(tok=>{ if(tok.trim()===''){frag.appendChild(document.createTextNode(tok));return;}
        const w=document.createElement('span');w.className='word';
        tok.split('').forEach(ch=>{const c=document.createElement('span');c.className='char';c.textContent=ch;w.appendChild(c);}); frag.appendChild(w); });
      hl.replaceChild(frag,n);
    }});
    return $$('#heroTitle .char');
  }
  if(hasGSAP && window.Lenis && !reduce){
    lenis=new Lenis({lerp:0.1, wheelMultiplier:0.9, smoothWheel:true, syncTouch:false});
    lenis.on('scroll',ScrollTrigger.update); gsap.ticker.add(t=>lenis.raf(t*1000)); gsap.ticker.lagSmoothing(0);
  }
  if(document.fonts && document.fonts.ready){ document.fonts.ready.then(()=>setTimeout(boot,60)); }
  else window.addEventListener('load',()=>setTimeout(boot,120));

  /* ================= INIT ================= */
  function initAll(){
    const page=(document.body.dataset.page)||'home';
    const always=[wireScrollCTAs,mobileNav,tickerLoop,wireForgetMe,wireKeyboardShortcuts,wireBackToTop];
    const byPage={
      home:[heroClarifier,fogCanvas,indexBoard,pressRoom,byof,twoPresses,consequences,crossword,vault,classifieds,letters,faq,lastWord,kineticDrift],
      analyze:[analyzePage,faq],
      pricing:[classifieds,faq]
    };
    always.concat(byPage[page]||[]).forEach(fn=>{ try{fn();}catch(e){console.error('[init '+fn.name+']',e);} });
    if(hasGSAP) ScrollTrigger.refresh();
    if(location.hash){ const t=$(location.hash); if(t) setTimeout(()=>scrollToEl(location.hash), noMotion?0:350); }
  }

  /* ---- CTAs ---- */
  function wireScrollCTAs(){
    // same-page #anchors smooth-scroll; cross-page anchors (e.g. index.html#press) navigate normally
    $$('[data-scroll]').forEach(a=>a.addEventListener('click',e=>{ const href=a.getAttribute('href');
      if(href && href.charAt(0)==='#'){ const t=$(href); if(t){ e.preventDefault(); scrollToEl(href); } } }));
    // CTA buttons: a "#id" value scrolls; anything else (e.g. "analyze.html") navigates
    $$('[data-scroll-to]').forEach(b=>b.addEventListener('click',()=>{ const dest=b.dataset.scrollTo;
      if(dest && dest.charAt(0)==='#'){ scrollToEl(dest); const inp=$('#heroInput'); if(inp) setTimeout(()=>inp.focus({preventScroll:true}),noMotion?0:500); }
      else { window.location.href=dest; } }));
  }

  /* ---- Forget Me ----
   * Privacy-promised reset for the current device. Clears everything
   * ClearDoc stores client-side and confirms with a toast.
   * Always wired (works on every page where the footer button exists).
   */
  /* ---- Back-to-top button ----
   * Lazy-built floating button that appears after the user scrolls past
   * ~600px. Click smooth-scrolls to the top using the existing Lenis
   * instance (with a graceful fallback when Lenis is unavailable).
   * Visible on every page; nothing page-specific.
   */
  function wireBackToTop(){
    const THRESHOLD = 600;
    function build(){
      const b = document.createElement('button');
      b.id = 'backToTop';
      b.type = 'button';
      b.className = 'back-to-top no-print';
      b.setAttribute('aria-label', 'Back to top');
      b.innerHTML = '<span class="btt-arrow" aria-hidden="true">↑</span><span class="btt-label">TOP</span>';
      document.body.appendChild(b);
      return b;
    }
    const btn = document.getElementById('backToTop') || build();
    let ticking = false;
    function update(){
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      btn.classList.toggle('show', y > THRESHOLD);
      ticking = false;
    }
    window.addEventListener('scroll', () => {
      if(!ticking){ requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    btn.addEventListener('click', () => {
      try{
        if(lenis) lenis.scrollTo(0, { duration: 0.8 });
        else window.scrollTo({ top: 0, behavior: 'smooth' });
      }catch(_){
        window.scrollTo(0, 0);
      }
    });
    update();
  }

  function wireForgetMe(){
    const btn = $('#forgetBtn');
    if(!btn) return;
    btn.addEventListener('click', forgetMyData);
  }

  let _forgetToastTimer = null;
  function showForgetToast(msg){
    let t = document.getElementById('forgetToast');
    if(!t){
      t = document.createElement('div');
      t.id = 'forgetToast';
      t.className = 'forget-toast ok';
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      t.innerHTML = '<span class="ft-check" aria-hidden="true"></span><span class="ft-text"></span>';
      document.body.appendChild(t);
    }
    const textEl = t.querySelector('.ft-text');
    if(textEl) textEl.innerHTML = msg;
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(_forgetToastTimer);
    _forgetToastTimer = setTimeout(() => {
      t.classList.remove('show');
    }, 4000);
  }

  async function forgetMyData(){
    const btn = $('#forgetBtn');
    if(btn) btn.disabled = true;

    // 1. Wipe our own localStorage keys (don't touch unrelated keys — be polite).
    try {
      const ownKeys = ['cleardoc:lastAnalysis', 'cleardoc:draftInput'];
      for(const k of ownKeys){ localStorage.removeItem(k); }
    } catch(_) {}

    // 2. Strip the share fragment so a refresh doesn't re-show the banner.
    try {
      if(location.hash && location.hash.indexOf('#share=') === 0){
        history.replaceState(null, '', location.pathname + location.search);
      }
    } catch(_) {}

    // 3. Reset analyzer in-memory state. Best-effort: clear whatever we can reach.
    try {
      const docInput = document.getElementById('docInput');
      if(docInput) docInput.value = '';
      // Restore-banner is page-scoped; hide if visible.
      const rb = document.getElementById('restoreBanner');
      if(rb) rb.hidden = true;
      const sb = document.getElementById('shareBanner');
      if(sb) sb.hidden = true;
      const sw = document.getElementById('swUpdateBanner');
      if(sw) sw.remove();
      const panel = document.getElementById('resultPanel');
      if(panel) panel.hidden = true;
      const emptyEl = document.getElementById('resultEmpty');
      if(emptyEl) emptyEl.hidden = false;
      const fileInput = document.getElementById('fileInput');
      if(fileInput) fileInput.value = '';
      const attachTray = document.getElementById('attachTray');
      if(attachTray){ attachTray.hidden = true; attachTray.innerHTML = ''; }
      const askOut = document.getElementById('askOut');
      if(askOut) askOut.innerHTML = '';
      const askInput = document.getElementById('askInput');
      if(askInput) askInput.disabled = true;
      const askBtn = document.getElementById('askBtn');
      if(askBtn) askBtn.disabled = true;
    } catch(_) {}

    // 4. Drop the service worker + clear its caches so the offline shell
    //    is re-fetched from the network on next load.
    try {
      if(navigator.serviceWorker){
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister().catch(()=>{})));
      }
      if('caches' in window){
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k).catch(()=>{})));
      }
    } catch(_) {}

    // 4. Confirm with a green toast — exactly matches the privacy promise copy.
    showForgetToast('Cleared <b>localStorage</b> · <b>drafts</b> · <b>SW caches</b> · <b>URL fragment</b>');

    // 5. Re-enable the button so the user can repeat the action.
    if(btn) btn.disabled = false;
  }

  /* ---- Keyboard shortcuts + help modal ----
   * Wired on every page (in the 'always' init list). Disabled when the
   * user is typing into a form field so it never hijacks ordinary text
   * entry. The `g` + key sequences wait ~1.2s for the second key.
   */
  function wireKeyboardShortcuts(){
    let lastG = 0;
    const G_WINDOW_MS = 1200;

    function isTypingTarget(el){
      if(!el) return false;
      const tag = (el.tagName || '').toLowerCase();
      if(tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if(el.isContentEditable) return true;
      return false;
    }
    function isModalOpen(){
      return !!document.querySelector('.kb-modal.show');
    }
    function openHelp(){
      let m = document.getElementById('kbHelpModal');
      if(!m) m = buildHelpModal();
      m.classList.add('show');
      m.setAttribute('aria-hidden','false');
      const closeBtn = m.querySelector('.kb-modal-close');
      if(closeBtn) closeBtn.focus();
    }
    function closeHelp(){
      const m = document.getElementById('kbHelpModal');
      if(!m) return;
      m.classList.remove('show');
      m.setAttribute('aria-hidden','true');
    }
    function buildHelpModal(){
      const m = document.createElement('div');
      m.id = 'kbHelpModal';
      m.className = 'kb-modal';
      m.setAttribute('role','dialog');
      m.setAttribute('aria-modal','true');
      m.setAttribute('aria-labelledby','kbHelpTitle');
      m.setAttribute('aria-hidden','true');
      m.innerHTML = `
        <div class="kb-modal-backdrop" data-kb-close></div>
        <div class="kb-modal-card" role="document">
          <button type="button" class="kb-modal-close" aria-label="Close">✕</button>
          <h2 id="kbHelpTitle" class="kb-modal-title mono">KEYBOARD SHORTCUTS</h2>
          <div class="kb-modal-grid">
            <div class="kb-row"><kbd>g</kbd><kbd>h</kbd><span>Go home</span></div>
            <div class="kb-row"><kbd>g</kbd><kbd>a</kbd><span>Open the analyzer</span></div>
            <div class="kb-row"><kbd>g</kbd><kbd>p</kbd><span>See pricing</span></div>
            <div class="kb-row"><kbd>/</kbd><span>Focus the document input</span></div>
            <div class="kb-row"><kbd>?</kbd><span>Show this help</span></div>
            <div class="kb-row"><kbd>Esc</kbd><span>Close any modal / banner</span></div>
          </div>
          <p class="kb-modal-foot mono">Shortcuts are disabled while typing in a field.</p>
        </div>`;
      document.body.appendChild(m);
      // Click on backdrop or close button dismisses
      m.addEventListener('click', e => {
        if(e.target.matches('[data-kb-close], .kb-modal-close')) closeHelp();
      });
      return m;
    }
    function navTo(path){
      try { window.location.href = path; } catch(_){}
    }

    // Footer hint button — also opens the help modal (so the shortcut is
    // discoverable even on touch devices where `?` doesn't exist).
    const hint = document.getElementById('kbHint');
    if(hint) hint.addEventListener('click', openHelp);

    document.addEventListener('keydown', e => {
      // Always honor Escape, even while typing — to close any open modal/banner
      if(e.key === 'Escape'){
        if(isModalOpen()){ e.preventDefault(); closeHelp(); return; }
        const rb = document.getElementById('restoreBanner');
        const sb = document.getElementById('shareBanner');
        const sw = document.getElementById('swUpdateBanner');
        if(rb && !rb.hidden){ rb.hidden = true; e.preventDefault(); return; }
        if(sb && !sb.hidden){ sb.hidden = true; e.preventDefault(); return; }
        if(sw){ sw.remove(); e.preventDefault(); return; }
        const toast = document.getElementById('forgetToast');
        if(toast && toast.classList.contains('show')){
          toast.classList.remove('show');
          e.preventDefault();
          return;
        }
        return;
      }

      // From here on, ignore shortcuts when the user is typing into a form field
      if(isTypingTarget(e.target)) return;
      // Also respect modifier keys — never hijack browser/Cmd combos
      if(e.ctrlKey || e.metaKey || e.altKey) return;

      const k = e.key;
      const now = Date.now();

      // '?' opens the help modal (Shift+/ on US layouts)
      if(k === '?'){
        e.preventDefault();
        openHelp();
        return;
      }

      // '/' focuses (and navigates to) the analyzer textarea
      if(k === '/' && !e.shiftKey){
        e.preventDefault();
        const ta = document.getElementById('docInput');
        if(ta){
          if(ta.closest('main') || document.body.dataset.page === 'analyze'){
            ta.focus({preventScroll:false});
          } else {
            navTo('analyze.html');
          }
        } else {
          navTo('analyze.html');
        }
        return;
      }

      // 'g' starts a 2-key navigation sequence
      if(k === 'g' || k === 'G'){
        lastG = now;
        return;
      }
      if(now - lastG > G_WINDOW_MS) return;
      const lc = (k || '').toLowerCase();
      if(lc === 'h'){ e.preventDefault(); navTo('index.html'); return; }
      if(lc === 'a'){ e.preventDefault(); navTo('analyze.html'); return; }
      if(lc === 'p'){ e.preventDefault(); navTo('pricing.html'); return; }
    }, { passive:false });
  }

  function mobileNav(){
    const nav=$('nav'),btn=$('.menu-toggle'),links=$('.navlinks');
    if(!nav||!btn||!links)return;
    const mq=matchMedia('(max-width: 900px)');
    function focusables(){
      // Only consider real interactive descendants of the open drawer
      return $$('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])', links)
        .filter(el => el.offsetParent !== null);
    }
    function setOpen(open){
      nav.classList.toggle('open',open);
      btn.setAttribute('aria-expanded',open?'true':'false');
      btn.setAttribute('aria-label',open?'Close navigation':'Open navigation');
      if(open){
        // Move focus into the drawer so keyboard / screen-reader users
        // land on the first interactive item.
        const first = focusables()[0];
        if(first) first.focus({preventScroll:true});
      } else {
        // Return focus to the toggle so the user doesn't lose their place.
        btn.focus({preventScroll:true});
      }
    }
    btn.addEventListener('click',()=>setOpen(!nav.classList.contains('open')));
    links.addEventListener('click',e=>{ if(e.target.closest('a'))setOpen(false); });
    document.addEventListener('keydown',e=>{
      if(!nav.classList.contains('open')) return;
      if(e.key === 'Escape'){ setOpen(false); return; }
      // Focus trap: cycle Tab / Shift+Tab within the drawer.
      if(e.key === 'Tab'){
        const f = focusables();
        if(f.length === 0) return;
        const first = f[0], last = f[f.length-1];
        const active = document.activeElement;
        if(e.shiftKey && active === first){
          e.preventDefault(); last.focus();
        } else if(!e.shiftKey && active === last){
          e.preventDefault(); first.focus();
        }
      }
    });
    document.addEventListener('click',e=>{ if(mq.matches && nav.classList.contains('open') && !nav.contains(e.target))setOpen(false); });
    const onModeChange=e=>{ if(!e.matches)setOpen(false); };
    if(mq.addEventListener)mq.addEventListener('change',onModeChange);
    else mq.addListener(onModeChange);
  }

  /* ---- HERO clarifier (the product, in the hero) ---- */
  function heroClarifier(){
    const input=$('#heroInput'),btn=$('#heroGo'),msg=$('#heroMsg'),fog=$('#hfog'),clear=$('#hclear'),scan=$('.hscan');
    let auto=null;
    function paint(res, raw){ fog.textContent=raw; clear.innerHTML=res.html; }
    function showResult(res, raw){
      if(auto){auto.kill();auto=null;}
      if(noMotion){ paint(res,raw); gsap.set(clear,{opacity:1}); gsap.set(fog,{opacity:0}); return; }
      paint(res,raw);
      gsap.timeline()
        .set(scan,{opacity:1,top:30}).set(clear,{opacity:0,y:8}).set(fog,{opacity:1})
        .to(scan,{top:'80%',duration:.9,ease:EASE.sweep})
        .to(fog,{opacity:0,duration:DUR.base},'-=.45')
        .to(clear,{opacity:1,y:0,duration:DUR.base},'-=.2')
        .to(scan,{opacity:0,duration:.2});
    }
    function run(){
      const raw=input.value;
      if(!raw.trim()){ msg.classList.add('err'); msg.innerHTML='Paste a sentence first — or try a sample:'+
        ' <button class="chiptry" data-s="Lessee shall forfeit the deposit notwithstanding any notice tendered.">Lease</button>'+
        ' <button class="chiptry" data-s="Patient shall be liable for facility fees pursuant to the terms herein.">Medical bill</button>';
        msg.querySelectorAll('.chiptry').forEach(c=>c.addEventListener('click',()=>{input.value=c.dataset.s;run();})); return; }
      let res; try{ res=clarify(raw); }catch(e){ msg.classList.add('err'); msg.textContent="Couldn't read that — try plain text or a sample."; return; }
      if(!res.changed){ msg.classList.remove('err'); msg.textContent='Already plain English — nothing to clear here. Try a sample sentence.'; return; }
      msg.classList.remove('err'); msg.textContent='✓ Set in plain English — the highlighted words are what changed.';
      if(noMotion){ showResult(res,raw); return; }
      btn.setAttribute('aria-busy','true'); const orig=btn.textContent; btn.textContent='Reading…';
      gsap.delayedCall(.9,()=>{ btn.removeAttribute('aria-busy'); btn.textContent=orig; showResult(res,raw); });
    }
    btn.addEventListener('click',run);
    input.addEventListener('keydown',e=>{if(e.key==='Enter')run();});
    // gentle auto-cycle of sample clauses until the user interacts
    const samples=[
      {f:'Lessee shall, notwithstanding any provision herein, indemnify lessor in perpetuity.',r:'You (the renter) must <b>cover the landlord\'s losses</b> — <span class="w">forever</span>, no matter what else the contract says.'},
      {f:'Notices shall be tendered heretofore pursuant to the terms set forth herein.',r:'Send any notice <b>the way this document already describes</b>.'},
      {f:'Policyholder shall be liable for all deductibles notwithstanding insurer adjustment.',r:'You\'re <b>responsible for the out-of-pocket costs</b> even after insurance adjusts the bill.'}
    ];
    if(!noMotion){
      let i=0; auto=gsap.timeline({repeat:-1});
      samples.forEach(s=>{ auto.set(fog,{textContent:s.f,opacity:1}).set(clear,{innerHTML:s.r,opacity:0,y:8}).set(scan,{opacity:1,top:30})
        .to(scan,{top:'80%',duration:.9,ease:EASE.sweep}).to(fog,{opacity:0,duration:DUR.base},'-=.45')
        .to(clear,{opacity:1,y:0,duration:DUR.base},'-=.2').to(scan,{opacity:0,duration:.2}).to({},{duration:2.4}); });
      gate('.hero',()=>auto&&auto.play(),()=>auto&&auto.pause());
    } else { gsap.set(clear,{opacity:1}); gsap.set(fog,{opacity:0}); }
    input.addEventListener('focus',()=>{ if(auto){auto.kill();auto=null; gsap.set(clear,{opacity:1});gsap.set(fog,{opacity:0});} },{once:true});
  }

  /* ---- FOG CANVAS (perf-tuned) ---- */
  function fogCanvas(){
    const cv=$('#fogcanvas');if(!cv)return;const ctx=cv.getContext('2d');let W,H,grads=[],raf=0,last=0,run=false;
    const puffs=Array.from({length:6},(_,i)=>({x:(i*97%100)/100,y:(i*53%100)/100,r:.3+(i%3)*.08,s:.0004+(i%3)*.0002,p:i}));
    let rt;
    function size(){W=cv.width=cv.offsetWidth;H=cv.height=cv.offsetHeight; buildGrads();}
    function buildGrads(){ grads=puffs.map(pf=>{const rad=pf.r*Math.max(W,H);const g=ctx.createRadialGradient(0,0,0,0,0,rad);
      g.addColorStop(0,'rgba(90,85,74,.10)');g.addColorStop(1,'rgba(90,85,74,0)');return {g,rad};}); }
    function onResize(){clearTimeout(rt);rt=setTimeout(size,150);}
    size(); addEventListener('resize',onResize);
    let t=0;
    function draw(ts){ raf=requestAnimationFrame(draw);
      if(ts-last<33) return; last=ts;            // ~30fps
      ctx.clearRect(0,0,W,H); ctx.globalCompositeOperation='multiply';
      puffs.forEach((pf,k)=>{const cx=(pf.x+Math.sin(t*pf.s+pf.p)*.18)*W,cy=(pf.y+Math.cos(t*pf.s*1.2+pf.p)*.18)*H;
        ctx.save();ctx.translate(cx,cy);ctx.fillStyle=grads[k].g;ctx.beginPath();ctx.arc(0,0,grads[k].rad,0,7);ctx.fill();ctx.restore();});
      t++;
    }
    function start(){ if(run||noMotion)return; run=true; last=0; raf=requestAnimationFrame(draw); }
    function stop(){ run=false; cancelAnimationFrame(raf); }
    gate('.hero',start,stop);
  }

  /* ---- TICKER ---- */
  function tickerLoop(){
    const row=$('#ticker');if(!row||!hasGSAP||noMotion)return;
    const tw=gsap.to(row,{xPercent:-50,duration:32,ease:'none',repeat:-1});
    gate('.ticker',()=>tw.play(),()=>tw.pause());
    ScrollTrigger.create({trigger:'.ticker',start:'top bottom',end:'bottom top',
      onUpdate:s=>{const v=Math.max(-30,Math.min(30,s.getVelocity()/-160));gsap.to(row,{x:'+='+v,duration:.4,overwrite:'auto'});}});
  }

  /* ---- INDEX (count once, honest) ---- */
  function fmt(v,kind){ if(kind==='m')return (v/1000000).toFixed(1)+'M'; if(kind==='dollarm')return '$'+(v/1000000).toFixed(1)+'M'; if(kind==='th')return Math.round(v)+'th'; return Math.round(v).toLocaleString(); }
  function indexBoard(){
    $$('[data-count]').forEach(el=>{ const end=+el.dataset.count,kind=el.dataset.fmt;
      if(noMotion){el.textContent=fmt(end,kind);return;}
      const o={v:0};
      ScrollTrigger.create({trigger:el,start:'top 88%',once:true,onEnter:()=>gsap.to(o,{v:end,duration:1.4,ease:'power2.out',onUpdate:()=>el.textContent=fmt(o.v,kind)})});
    });
  }

  /* ---- PRESS ROOM ---- */
  function pressRoom(){
    const acts=$$('.act'),tabs=$$('.tab'),prog=$('#actprog'),stage=$('#stage'),pauseBtn=$('#pauseDemo');
    const a1lines=$$('#act0 .a1line'),a1rl=$('#a1rl');
    const askType=$('#askType'),think=$('#think'),ansText=$('#ansText'),cite=$('#cite'),conn=$('#connpath'),src=$('#srcClause');
    const rrows=$$('#act2 .rrow'),a3count=$('#a3count');
    const baClean=$('#baClean'),baStamp=$('#baStamp'),baDense=$('#baDense');
    const tls=$$('.transcript .tl');
    const Q='Can I cancel early without penalty?', A="No — you'd owe the remaining 7 months. There is no early-out clause.";
    baDense.innerHTML='Subscriber may not terminate prior to the expiry of the committed term; in the event of early cancellation, the remaining periodic charges for the full committed term shall become immediately due and payable, such sums being non-refundable and not subject to proration or offset of any kind.';
    a1lines.forEach(l=>l.dataset.orig=l.innerHTML);

    function setActive(i){ acts.forEach((a,k)=>gsap.set(a,{autoAlpha:k===i?1:0}));
      tabs.forEach((t,k)=>{t.setAttribute('aria-selected',k===i?'true':'false');t.tabIndex=k===i?0:-1;}); }
    function paintFinal(){
      setActive(3);
      a1lines.forEach(l=>{l.classList.add('clear');l.innerHTML=l.dataset.clear;}); a1rl.textContent='8th';
      askType.textContent=Q; ansText.textContent=A; gsap.set(cite,{opacity:1}); think.style.display='none';
      rrows.forEach(r=>{const c=RISK_COLORS[r.dataset.risk];r.querySelector('.rbar').style.background=c;const f=r.querySelector('.rflag');f.style.opacity=1;f.style.transform='scale(1)';f.style.background=c;}); a3count.textContent='RISK SCORE · 2 TRAPS';
      gsap.set(baClean,{clipPath:'inset(0 0 0 0)'}); gsap.set(baStamp,{opacity:1,scale:1,rotation:-4});
      tls.forEach(t=>t.classList.add('on'));
    }
    if(noMotion){ const cap=document.createElement('div');cap.className='demolabel';cap.style.cssText='justify-content:center;padding:10px';cap.textContent='Static edition — demo animation unavailable.';stage.appendChild(cap); paintFinal(); return; }

    // resets via .set so seeking lands clean
    let traps=0;
    function resetA1(tl){a1lines.forEach(l=>tl.set(l,{className:'a1line',innerHTML:l.dataset.orig,clearProps:'filter,opacity'}));tl.set(a1rl,{textContent:'12th'});tl.set('#a1scan',{opacity:0,top:30});}
    function resetA2(tl){tl.set(askType,{textContent:''}).set(ansText,{textContent:''}).set(cite,{opacity:0}).set(conn,{strokeDashoffset:1}).set(src,{className:'src-clause'}).set(think,{display:'inline-flex'});}
    function resetA3(tl){traps=0;tl.call(()=>{rrows.forEach(r=>{gsap.set(r.querySelector('.rbar'),{background:'transparent'});gsap.set(r.querySelector('.rflag'),{opacity:0,scale:.4});});a3count.textContent='RISK SCORE · 0 TRAPS';});}
    function resetA4(tl){tl.set(baClean,{clipPath:'inset(0 100% 0 0)'}).set(baStamp,{opacity:0,scale:.4});}

    const labels=['a0','a1','a2','a3'], starts={};
    const master=gsap.timeline({paused:true,onUpdate:syncUI});

    // ACT 1
    master.addLabel('a0'); resetA1(master); master.call(()=>setActive(0));
    master.fromTo('#a1scan',{opacity:0,top:20},{opacity:1,duration:.2})
          .to('#a1scan',{top:'78%',duration:2.6,ease:'none'},'<');
    a1lines.forEach((ln,k)=>master.call(()=>{ln.classList.add('clear');ln.innerHTML=ln.dataset.clear;},null,'a0+='+(0.5+k*0.55)));
    master.to({v:12},{v:8,duration:.6,onUpdate:function(){a1rl.textContent=Math.round(this.targets()[0].v)+'th';}})
          .call(()=>tls[0].classList.add('on')).to({},{duration:1});

    // ACT 2
    master.addLabel('a1'); resetA2(master); master.call(()=>setActive(1));
    master.to({i:0},{i:Q.length,duration:1.4,ease:'none',onUpdate:function(){askType.textContent=Q.slice(0,Math.round(this.targets()[0].i));}})
          .to({},{duration:.7}).set(think,{display:'none'})
          .to({n:0},{n:A.split(' ').length,duration:1.8,ease:'none',onUpdate:function(){ansText.textContent=A.split(' ').slice(0,Math.round(this.targets()[0].n)).join(' ');}})
          .fromTo(cite,{opacity:0,scale:1.3},{opacity:1,scale:1,duration:DUR.base,ease:EASE.stamp})
          .fromTo(conn,{strokeDashoffset:1},{strokeDashoffset:0,duration:.7,ease:EASE.sweep})
          .call(()=>src.classList.add('flash')).call(()=>tls[1].classList.add('on'))
          .to({},{duration:1.2}).call(()=>src.classList.remove('flash'));

    // ACT 3
    master.addLabel('a2'); resetA3(master); master.call(()=>setActive(2));
    rrows.forEach((row,k)=>master.call(()=>{const risk=row.dataset.risk,c=RISK_COLORS[risk];
      gsap.to(row.querySelector('.rbar'),{background:c,duration:.2});
      const f=row.querySelector('.rflag');gsap.fromTo(f,{opacity:0,scale:.4},{opacity:1,scale:1,duration:DUR.base,ease:EASE.stamp});gsap.set(f,{background:c});
      if(risk==='r'){traps++;a3count.textContent='RISK SCORE · '+traps+' TRAPS';}},null,'a2+='+(0.4+k*0.5)));
    master.call(()=>tls[2].classList.add('on'),null,'a2+=3').to({},{duration:1});

    // ACT 4
    master.addLabel('a3'); resetA4(master); master.call(()=>setActive(3));
    master.fromTo(baClean,{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 50% 0 0)',duration:1.1,ease:EASE.sweep})
          .to(baDense,{opacity:.25,duration:DUR.base},'<')
          .to({},{duration:.5}).to(baClean,{clipPath:'inset(0 0% 0 0)',duration:.9,ease:EASE.sweep})
          .fromTo(baStamp,{opacity:0,scale:.4,rotation:-4},{opacity:1,scale:1,duration:DUR.macro,ease:EASE.stamp})
          .call(()=>tls[3].classList.add('on')).to({},{duration:1.3});

    labels.forEach(l=>starts[l]=master.labels[l]);
    const order=['a0','a1','a2','a3'];
    function syncUI(){ const t=master.time(); let idx=0;
      for(let k=0;k<order.length;k++){ if(t>=starts[order[k]]) idx=k; }
      const segStart=starts[order[idx]], segEnd=(idx<3?starts[order[idx+1]]:master.duration());
      const p=segEnd>segStart?(t-segStart)/(segEnd-segStart):0;
      prog.style.width=Math.max(0,Math.min(1,p))*100+'%';
      tabs.forEach((tb,k)=>tb.setAttribute('aria-selected',k===idx?'true':'false'));
    }

    let userPaused=false;
    function setPauseUI(){ pauseBtn.setAttribute('aria-pressed',userPaused?'true':'false'); pauseBtn.textContent=userPaused?'▸ Resume demo':'❚❚ Pause demo'; }
    function loopHandler(){ if(master.progress()>=1 && !userPaused) master.restart(); }
    master.eventCallback('onComplete',()=>{ if(!userPaused) master.restart(); });

    pauseBtn.addEventListener('click',()=>{ userPaused=!userPaused; userPaused?master.pause():master.play(); setPauseUI(); });

    function studyAct(i){ userPaused=true; setPauseUI();
      master.pause(); master.tweenFromTo(starts[order[i]], (i<3?starts[order[i+1]]:master.duration()), {ease:'none',onComplete:()=>master.pause()}); }
    tabs.forEach((tb,i)=>tb.addEventListener('click',()=>studyAct(i)));
    // roving tabindex / arrow keys
    $('#tablist').addEventListener('keydown',e=>{ const i=tabs.indexOf(document.activeElement); if(i<0)return;
      let n=null; if(e.key==='ArrowRight'||e.key==='ArrowDown')n=(i+1)%tabs.length; if(e.key==='ArrowLeft'||e.key==='ArrowUp')n=(i-1+tabs.length)%tabs.length;
      if(e.key==='Home')n=0; if(e.key==='End')n=tabs.length-1;
      if(n!=null){e.preventDefault();tabs[n].focus();studyAct(n);} });

    setPauseUI();
    // gate: play/pause in place, never restart on re-enter; respect userPaused
    gate('.pressroom',()=>{ if(!userPaused) master.play(); },()=>master.pause());
  }

  /* ---- BYOF ---- */
  function byof(){
    const inEl=$('#byofIn'),out=$('#byofOut'),scan=$('#byofScan'),jc=$('#byofJargon'),go=$('#byofGo');
    const levelFrom=$('#byofLevelFrom'),levelTo=$('#byofLevelTo');
    const glossary=$('#byofGlossary'),glossaryList=$('#byofGlossaryList');
    let ran=false;
    function setLevels(fromVal, toVal){
      if(levelFrom) levelFrom.textContent = (fromVal==null ? '—' : fromVal+'th');
      if(levelTo) levelTo.textContent = (toVal==null ? '—' : toVal+'th');
    }
    function renderGlossary(matches){
      // matches: [{re, plain}] — the jargon terms the clarify engine replaced.
      if(!glossary || !glossaryList) return;
      if(!matches || !matches.length){
        glossary.hidden = true;
        glossaryList.innerHTML = '';
        return;
      }
      glossaryList.innerHTML = matches.map(m =>
        '<li><code>'+esc(m.term)+'</code><span class="arrow">→</span><span class="plain">'+esc(m.plain)+'</span></li>'
      ).join('');
      glossary.hidden = false;
      // Default collapsed — keeps the visual focus on the rewrite
      glossary.open = false;
    }
    function show(){ const raw=inEl.value;
      if(!raw.trim()){
        out.textContent='Paste or pick a sample, then press “Set in plain English”.';
        jc.textContent='0';
        setLevels(null, null);
        renderGlossary([]);
        return;
      }
      // Run clarify, but also capture which terms were actually replaced so
      // the glossary can list them. We do this by re-scanning with each
      // JARGON pattern against the original text.
      const matches = [];
      JARGON.forEach(([re, plain]) => {
        const r = new RegExp(re.source, re.flags);
        if(r.test(raw)){
          // Find the first matched string in the original
          const m = raw.match(r);
          if(m && m[0]) matches.push({ term: m[0], plain: plain });
        }
      });
      const res=clarify(raw); jc.textContent=res.found;
      renderGlossary(matches);
      // Compute reading level for the original text (or hide if too short)
      const before = isGradable(raw) ? gradeLevel(raw) : null;
      if(!res.changed){
        out.innerHTML='Already plain English — nothing to clear here. Try a sample →';
        setLevels(before, before);
        return;
      }
      const html='You: '+res.html.charAt(0).toUpperCase()+res.html.slice(1);
      // Compute reading level for the rewritten plain-English output
      const plainOut = stripHtmlToText(res.html);
      const after = isGradable(plainOut) ? gradeLevel(plainOut) : null;
      setLevels(before, after);
      if(noMotion){ out.innerHTML=html; return; }
      gsap.set(scan,{opacity:1,top:-50}); gsap.to(scan,{top:'110%',duration:.9,ease:EASE.sweep,onComplete:()=>gsap.to(scan,{opacity:0,duration:.2})});
      const words=html.split(' ');out.innerHTML='';let i=0;
      gsap.to({n:0},{n:words.length,duration:1.1,ease:'none',delay:.2,onUpdate:function(){const k=Math.round(this.targets()[0].n);if(k!==i){i=k;out.innerHTML=words.slice(0,k).join(' ');}}});
    }
    go.addEventListener('click',show);
    $$('.byof .qf').forEach(q=>q.addEventListener('click',()=>{inEl.value=q.dataset.fill;show();}));
    // Live recompute on edit so the "READING LEVEL x → y" stays accurate
    // even before the user clicks the button.
    if(inEl) inEl.addEventListener('input', () => {
      const raw = inEl.value;
      if (!isGradable(raw)) { setLevels(null, null); return; }
      setLevels(gradeLevel(raw), null);
    });
    if(hasGSAP) ScrollTrigger.create({trigger:'.byof',start:'top 60%',once:true,onEnter:()=>{if(!ran){ran=true;show();}}});
    else show();
  }

  /* ---- TWO PRESSES (true same-clause wipe) ---- */
  function twoPresses(){
    const stage=$('#tpStage'),handle=$('#tpHandle'),clear=$('#tpClear');if(!stage||!handle)return;
    let p=50;
    function render(){ handle.style.left=p+'%'; clear.style.clipPath=`inset(0 ${100-p}% 0 0)`; handle.setAttribute('aria-valuenow',Math.round(p)); }
    function setFromX(x){const r=stage.getBoundingClientRect();p=Math.max(0,Math.min(100,((x-r.left)/r.width)*100));render();}
    let drag=false;
    handle.addEventListener('pointerdown',e=>{drag=true;try{handle.setPointerCapture(e.pointerId);}catch(_){ }});
    addEventListener('pointerup',()=>drag=false);
    addEventListener('pointermove',e=>{if(drag)setFromX(e.clientX);});
    handle.addEventListener('keydown',e=>{let d=0;if(e.key==='ArrowRight')d=5;if(e.key==='ArrowLeft')d=-5;if(e.key==='Home')p=0;if(e.key==='End')p=100;
      if(d||e.key==='Home'||e.key==='End'){e.preventDefault();p=Math.max(0,Math.min(100,p+d));render();}});
    render();
    if(noMotion)return;
    const tl=gsap.timeline({paused:true});
    tl.fromTo(stage,{}, {duration:.01}).fromTo(clear,{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 50% 0 0)',duration:1,ease:EASE.sweep,onComplete:render});
    ScrollTrigger.create({trigger:stage,start:'top 75%',once:true,onEnter:()=>tl.play()});
  }

  /* ---- CONSEQUENCES ---- */
  function consequences(){
    const tot=$('#conseqTotal');let grand=0;
    $$('.case').forEach(c=>{const target=+c.dataset.target,amtEl=c.querySelector('[data-amt]'),strike=c.querySelector('.strike'),verdict=c.querySelector('.verdict');
      if(noMotion){amtEl.textContent='$'+target.toLocaleString();verdict.style.opacity=1;verdict.style.transform='none';grand+=target;tot.textContent='$'+grand.toLocaleString();return;}
      const o={v:0};
      ScrollTrigger.create({trigger:c,start:'top 80%',once:true,onEnter:()=>{
        gsap.timeline()
          .to(o,{v:target,duration:1.3,ease:'power1.in',onUpdate:()=>amtEl.textContent='$'+Math.round(o.v).toLocaleString()})
          .to(strike,{scaleX:1,duration:DUR.base,ease:EASE.enter})
          .fromTo(verdict,{opacity:0,scale:.4,rotation:-3},{opacity:1,scale:1,duration:DUR.macro,ease:EASE.stamp})
          .add(()=>{const from=grand;grand+=target;gsap.to({g:from},{g:grand,duration:.5,onUpdate:function(){tot.textContent='$'+Math.round(this.targets()[0].g).toLocaleString();}});});
      }});
    });
  }

  /* ---- CROSSWORD ---- */
  function crossword(){
    const grid=$('#xgrid');if(!grid)return;const N=7,cells={};
    for(let r=0;r<N;r++)for(let c=0;c<N;c++){const d=document.createElement('div');d.className='cell';grid.appendChild(d);cells[r+'-'+c]=d;}
    const words=[
      {ans:'LEASE',cells:[[1,0],[1,1],[1,2],[1,3],[1,4]],num:2},
      {ans:'BILL',cells:[[5,1],[5,2],[5,3],[5,4]],num:4},
      {ans:'TERMS',cells:[[0,1],[1,1],[2,1],[3,1],[4,1]],num:1},
      {ans:'EOB',cells:[[1,4],[2,4],[3,4]],num:3},
    ];
    const labeled={};
    words.forEach(w=>{w.cells.forEach(([r,c],i)=>{const el=cells[r+'-'+c];el.classList.add('open');
      let ch=el.querySelector('.ch'); if(!ch){ch=document.createElement('div');ch.className='ch';el.appendChild(ch);} ch.dataset.letter=w.ans[i];});
      const [r0,c0]=w.cells[0];if(!labeled[r0+'-'+c0]){const num=document.createElement('div');num.className='num';num.textContent=w.num;cells[r0+'-'+c0].appendChild(num);labeled[r0+'-'+c0]=1;}});
    const clues=$$('.clue');
    if(noMotion){ $$('.ch').forEach(c=>{c.textContent=c.dataset.letter;c.style.opacity=1;c.style.transform='scale(1)';});clues.forEach(cl=>{cl.classList.add('done');cl.querySelector('.strike2').style.transform='scaleX(1)';});return; }
    const tl=gsap.timeline({repeat:-1,repeatDelay:2.2,paused:true});
    words.forEach((w,wi)=>{ w.cells.forEach(([r,c])=>{const ch=cells[r+'-'+c].querySelector('.ch');
        tl.call(()=>{ch.textContent=ch.dataset.letter;}).fromTo(ch,{opacity:0,scale:.3},{opacity:1,scale:1,duration:DUR.micro,ease:EASE.stamp});});
      const clue=clues[wi];
      tl.add(()=>clue.classList.add('done')).fromTo(clue.querySelector('.strike2'),{scaleX:0},{scaleX:1,duration:DUR.base}); });
    tl.to({},{duration:1.5}).add(()=>{ $$('.ch').forEach(c=>{c.textContent='';gsap.set(c,{opacity:0,scale:.3});});clues.forEach(cl=>{cl.classList.remove('done');gsap.set(cl.querySelector('.strike2'),{scaleX:0});}); });
    gate('.cross',()=>tl.play(),()=>tl.pause());
  }

  /* ---- VAULT ---- */
  function vault(){
    const paths=$$('.vrow .stamp svg path');paths.forEach(p=>{const len=p.getTotalLength?p.getTotalLength():40;p.style.strokeDasharray=len;p.style.strokeDashoffset=noMotion?0:len;});
    const seals=$$('.seal');
    if(noMotion){seals.forEach(s=>{s.style.opacity=1;s.style.transform='rotate(-8deg) scale(1)';});return;}
    const tl=gsap.timeline({paused:true});
    tl.from('.vrow',{y:14,opacity:0,stagger:.1,duration:DUR.base,ease:EASE.enter})
      .to('.vrow .stamp svg path',{strokeDashoffset:0,duration:DUR.base,stagger:.08},'-=.3')
      .fromTo(seals,{opacity:0,scale:.3,rotation:-12},{opacity:1,scale:1,rotation:-8,duration:DUR.macro,stagger:.08,ease:EASE.stamp},'-=.2');
    ScrollTrigger.create({trigger:'.vault',start:'top 70%',once:true,onEnter:()=>tl.play()});
    const doc=$('#shreddoc'),scan=$('#vscan');
    for(let i=0;i<10;i++){const s=document.createElement('div');s.className='shard';s.style.left=(i*14)+'px';s.style.height='180px';doc.appendChild(s);}
    const shards=$$('.shard',doc);
    const sh=gsap.timeline({repeat:-1,repeatDelay:1.2,paused:true});
    sh.set(scan,{top:-24,opacity:1}).set(shards,{y:0,opacity:0}).to(scan,{top:184,duration:1,ease:'none'}).set(scan,{opacity:0}).set(shards,{opacity:1}).to(shards,{y:200,opacity:0,duration:1,ease:'power1.in',stagger:.04}).to({},{duration:1});
    gate('.vault',()=>sh.play(),()=>sh.pause());
  }

  /* ---- CLASSIFIEDS ---- */
  function classifieds(){
    const btns=$$('.toggle button'),amts=$$('.ad .amt'),cue=$('#saveCue'); if(!$('.classi')) return;
    if(hasGSAP&&!noMotion){ const tl=gsap.timeline({paused:true}); tl.from('.ad',{y:20,opacity:0,stagger:.1,duration:DUR.base,ease:EASE.enter}); ScrollTrigger.create({trigger:'.classi',start:'top 75%',once:true,onEnter:()=>tl.play()}); }

    /* Update each .yr-hint to show the annual total + savings relative
     * to the monthly toggle rate. The Reader hint is static ('free'). */
    function updateYearlyHints(isAnnual){
      $$('.ad').forEach(ad => {
        const amt = ad.querySelector('.amt');
        const hint = ad.querySelector('.yr-hint');
        if(!amt || !hint) return;
        const mo = parseInt(amt.dataset.mo, 10) || 0;
        const yr = parseInt(amt.dataset.yr, 10) || 0;
        if(mo === 0 && yr === 0){
          // Reader — already a free-forever hint in the markup
          return;
        }
        const annualTotal = yr * 12;
        const monthlyTotal = mo * 12;
        const saved = monthlyTotal - annualTotal;
        if(!isAnnual){
          hint.hidden = false;
          hint.textContent = '$' + annualTotal.toLocaleString() + (ad.querySelector('.price small') && /seat/.test(ad.querySelector('.price small').textContent || '') ? '/seat/yr' : '/yr') + ' · save $' + saved + ' annually';
        } else {
          hint.hidden = false;
          hint.textContent = 'Billed $' + annualTotal.toLocaleString() + ' yearly — saving $' + saved + ' vs monthly';
        }
      });
    }

    btns.forEach(b=>b.addEventListener('click',()=>{ btns.forEach(x=>x.setAttribute('aria-pressed','false')); b.setAttribute('aria-pressed','true');
      const yr=b.dataset.cycle==='yr'; cue.hidden=!yr;
      amts.forEach(a=>{ const v=yr?a.dataset.yr:a.dataset.mo;
        if(noMotion){a.textContent='$'+v;} else {const o={v:parseInt(a.textContent.replace(/\D/g,''))||0};gsap.to(o,{v:+v,duration:DUR.base,ease:'power2.out',onUpdate:()=>a.textContent='$'+Math.round(o.v)});} });
      updateYearlyHints(yr);
    }));
    // Initial paint (default = monthly)
    updateYearlyHints(false);
  }

  /* ---- LETTERS ---- */
  function letters(){
    $$('.letter').forEach(card=>{ const scary=card.querySelector('.scary'),clear=card.querySelector('.clarified');
      if(noMotion){scary.style.display='none';clear.style.display='inline';clear.style.opacity=1;return;}
      ScrollTrigger.create({trigger:card,start:'top 82%',once:true,onEnter:()=>{
        gsap.timeline().from(card,{y:18,opacity:0,duration:DUR.base,ease:EASE.enter})
          .to(scary,{filter:'blur(6px)',opacity:0,duration:DUR.base},'+=.4')
          .set(scary,{display:'none'}).set(clear,{display:'inline'})
          .fromTo(clear,{opacity:0,filter:'blur(6px)'},{opacity:1,filter:'blur(0)',duration:DUR.base});
      }});
    });
  }

  /* ---- FAQ ---- */
  function faq(){
    const items=$$('.qa'); if(!items.length) return;
    items.forEach(item=>{ const q=item.querySelector('.q'),a=item.querySelector('.a'),txt=item.querySelector('.ans-text');
      txt.dataset.full=txt.textContent; q.addEventListener('click',()=>toggle(item,true)); });
    function close(item){ item.classList.remove('open'); item.querySelector('.q').setAttribute('aria-expanded','false');
      const a=item.querySelector('.a'); if(noMotion)a.style.maxHeight='0'; else gsap.to(a,{height:0,duration:DUR.base,onComplete:()=>a.style.maxHeight='0'}); }
    function toggle(item,typed){ const open=item.classList.contains('open');
      items.forEach(o=>{if(o!==item&&o.classList.contains('open'))close(o);});
      const a=item.querySelector('.a'),rule=item.querySelector('.arule'),txt=item.querySelector('.ans-text'),corr=item.querySelector('.corrected');
      if(open){close(item);return;}
      item.classList.add('open'); item.querySelector('.q').setAttribute('aria-expanded','true');
      if(noMotion){a.style.maxHeight='none';txt.textContent=txt.dataset.full;rule.style.transform='scaleX(1)';corr.style.opacity=1;corr.style.transform='scale(1)';return;}
      gsap.set(a,{height:'auto'});const h=a.offsetHeight;gsap.fromTo(a,{height:0},{height:h,duration:DUR.base,ease:EASE.enter,onComplete:()=>{a.style.maxHeight='none';a.style.height='auto';}});
      gsap.fromTo(rule,{scaleX:0},{scaleX:1,duration:DUR.base,ease:EASE.enter});
      if(typed){ // first auto-open types; user clicks reveal instantly
        txt.textContent=txt.dataset.full; gsap.fromTo(corr,{opacity:0,scale:.4},{opacity:1,scale:1,duration:DUR.base,ease:EASE.stamp});
      } else { gsap.set(corr,{opacity:0,scale:.4});txt.textContent='';
        gsap.to({i:0},{i:txt.dataset.full.length,duration:Math.min(1.4,txt.dataset.full.length*.012),ease:'none',onUpdate:function(){txt.textContent=txt.dataset.full.slice(0,Math.round(this.targets()[0].i));},onComplete:()=>gsap.to(corr,{opacity:1,scale:1,duration:DUR.base,ease:EASE.stamp})}); }
    }
    // auto-open first item when section enters view (types on); user clicks reveal instantly
    if(hasGSAP&&!noMotion){
      ScrollTrigger.create({trigger:'.faq',start:'top 65%',once:true,onEnter:()=>toggle(items[0],false)});
    } else {
      const it=items[0];it.classList.add('open');it.querySelector('.q').setAttribute('aria-expanded','true');
      it.querySelector('.a').style.maxHeight='none';it.querySelector('.corrected').style.opacity=1;
    }

    /* Expand / collapse all — wired when the page exposes .faq-controls. */
    function openAll(){
      items.forEach(it => { if(!it.classList.contains('open')) toggle(it, true); });
    }
    function closeAll(){
      items.forEach(it => { if(it.classList.contains('open')) close(it); });
    }
    $$('[data-faq-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-faq-action');
        if(action === 'open') openAll();
        else if(action === 'close') closeAll();
      });
    });

    /* FAQ search — filters .qa items by keyword against the question text. */
    const faqSearch = $('#faqSearch');
    const faqSearchEmpty = $('#faqSearchEmpty');
    if(faqSearch){
      function applyFaqFilter(q){
        const needle = String(q || '').trim().toLowerCase();
        let visible = 0;
        items.forEach(item => {
          const qtext = (item.querySelector('.qt') || {}).textContent || '';
          const atext = (item.querySelector('.ans-text') || {}).textContent || '';
          const hay = (qtext + ' ' + atext).toLowerCase();
          const match = !needle || hay.indexOf(needle) !== -1;
          item.style.display = match ? '' : 'none';
          if(match) visible++;
        });
        if(faqSearchEmpty) faqSearchEmpty.hidden = needle === '' || visible > 0;
      }
      faqSearch.addEventListener('input', (e) => applyFaqFilter(e.target.value));
      faqSearch.addEventListener('search', (e) => applyFaqFilter(e.target.value));
      // Escape clears the filter
      faqSearch.addEventListener('keydown', (e) => {
        if(e.key === 'Escape'){ faqSearch.value=''; applyFaqFilter(''); }
      });
    }
  }

  /* ---- LAST WORD ---- */
  function lastWord(){
    const pEl=$('#proof'),proofs=['Caught a $1,900 billing error.','Killed an auto-renew trap.','Read my lease in 90 seconds.'];let pi=0;
    const stamp=$('#stampbig'),clear=$('.ed-clear'),fog=$('.ed-fog'),shock=$('#shock');
    if(noMotion){ stamp.style.top='30px';stamp.style.opacity=1;clear.style.opacity=1;fog.style.opacity=0;return; }
    gsap.set(stamp,{top:-120,opacity:0});
    const tl=gsap.timeline({paused:true});
    tl.to(stamp,{top:30,opacity:1,scale:1.15,duration:.5,ease:'power3.in'}).to(stamp,{scale:1,duration:.2,ease:EASE.enter})
      .to(fog,{opacity:0,duration:DUR.base},'<').to(clear,{opacity:1,duration:DUR.base},'<')
      .fromTo(shock,{scale:0,opacity:.8},{scale:14,opacity:0,duration:.7,ease:'power2.out'},'<');
    ScrollTrigger.create({trigger:'.end',start:'top 65%',once:true,onEnter:()=>tl.play()});
    const rot=gate('.end',()=>{}, ()=>{}); // ensure end is tracked
    let iv=setInterval(()=>{ if(document.hidden||!rot.inView)return; pi=(pi+1)%proofs.length; gsap.to(pEl,{opacity:0,duration:.3,onComplete:()=>{pEl.textContent=proofs[pi];gsap.to(pEl,{opacity:1,duration:.3});}}); },3000);
  }

  /* ---- KINETIC FOOTER ---- */
  function kineticDrift(){ if(!hasGSAP||noMotion)return;
    gsap.to('#kinetic',{xPercent:-28,scrollTrigger:{trigger:'.end',start:'top bottom',end:'bottom top',scrub:.5}}); }

  /* ================= ANALYZE PAGE (real, offline) ================= */
  function analyzePage(){
    const input=$('#docInput'); if(!input) return;
    const btn=$('#analyzeBtn'),clearBtn=$('#clearBtn'),fileInput=$('#fileInput'),
          emptyEl=$('#resultEmpty'),panel=$('#resultPanel'),plainOut=$('#plainOut'),
          riskList=$('#riskList'),riskNote=$('#riskNote'),levelFrom=$('#levelFrom'),levelTo=$('#levelTo'),
          jargonCount=$('#jargonCount'),askInput=$('#askInput'),askBtn=$('#askBtn'),askOut=$('#askOut'),msg=$('#analyzeMsg'),
          attachTray=$('#attachTray'),draftOut=$('#draftOut'),draftNote=$('#draftNote'),copyDraftBtn=$('#copyDraftBtn'),
          downloadDraftBtn=$('#downloadDraftBtn'),
          analyzeLoading=$('#analyzeLoading'),verdictBlock=$('#verdictBlock'),verdictDisplay=$('#verdictDisplay'),verdictCopyBtn=$('#verdictCopyBtn'),
          tagsInput=$('#tagsInput'),tagsList=$('#tagsList'),
          deadlinesBlock=$('#deadlinesBlock'),deadlinesList=$('#deadlinesList'),
          nextStepsBlock=$('#nextStepsBlock'),nextStepsList=$('#nextStepsList'),
          printBtn=$('#printBtn'),saveBtn=$('#saveBtn'),copyBtn=$('#copyBtn'),printDate=$('#printDate'),
          shareBtn=$('#shareBtn'),
          restoreBanner=$('#restoreBanner'),restoreDocName=$('#restoreDocName'),
          restoreWhen=$('#restoreWhen'),restoreBtn=$('#restoreBtn'),dismissRestoreBtn=$('#dismissRestoreBtn'),
          shareBanner=$('#shareBanner'),shareDocName=$('#shareDocName'),
          viewShareBtn=$('#viewShareBtn'),dismissShareBtn=$('#dismissShareBtn'),
          textStats=$('#textStats'),statWords=$('#statWords'),statChars=$('#statChars'),
          statReadTime=$('#statReadTime'),statLevel=$('#statLevel'),statCap=$('#statCap');
    const sampleText=input.value.trim();

    // trap/risk patterns — severity g(note) a(watch) r(trap)
    const RISK=[
      {re:/in perpetuity|perpetual|survive (the )?termination/i, sev:'r', label:'Trap', why:'Never expires — there is no time limit.'},
      {re:/indemnif|hold\s+\w*\s*harmless/i, sev:'r', label:'Trap', why:"You may have to cover the other side's losses, including legal fees."},
      {re:/waiv\w*.{0,30}(jury|class action)|class action waiver|trial by jury/i, sev:'r', label:'Trap', why:'You give up the right to sue in court or join a class action.'},
      {re:/non[-\s]?refundable|forfeit|liquidated damages/i, sev:'r', label:'Trap', why:"Money you won't get back."},
      {re:/auto(matically)?\s*renew|evergreen|successive\s+\w+\s+terms|renew\w* for/i, sev:'a', label:'Watch', why:'Renews automatically unless you cancel in time.'},
      {re:/sole discretion|at any time|without (prior )?notice|reserves the right/i, sev:'a', label:'Watch', why:'The other party can change or act unilaterally.'},
      {re:/late fee|penalty|default interest|assessment/i, sev:'a', label:'Watch', why:'Extra charges may apply.'},
      {re:/governing law|jurisdiction|venue|arbitration/i, sev:'g', label:'Note', why:'Sets which laws/forum apply if there is a dispute.'},
      {re:/confidential|non-?disclosure|proprietary/i, sev:'g', label:'Note', why:'Restricts what you can share.'}
    ];
    function splitSentences(t){ return t.replace(/\s+/g,' ').trim().split(/(?<=[.!?;])\s+/).filter(s=>s.trim().length>1); }
    function trunc(s,n){ s=s.trim(); return s.length>n? s.slice(0,n)+'…' : s; }
    function esc(s){
      // Defense-in-depth: escape &, <, > plus BOTH quote flavours.
      // Templates interpolate `esc(...)` into BOTH text context (`>esc(t)<`)
      // and attribute context (`aria-label="...esc(t)..."`). The text-context
      // chars alone (&<>) are sufficient for the text case, but if a value
      // contains `"` or `'` it can break out of a quoted attribute and add
      // an event handler (e.g. `" onmouseover="alert(1)`). Escaping the
      // quotes here covers every existing call site without code changes,
      // since `&quot;` and `&#39;` render identically in browsers.
      return s.replace(/[&<>"']/g, function(c){
        switch(c){
          case '&': return '&amp;';
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '"': return '&quot;';
          case "'": return '&#39;';
        }
        return c;
      });
    }

    // Mirrors the server-side cap in api/analyze.js — restores must not push
    // a multi-megabyte document back into the textarea.
    const MAX_DOCUMENT_CHARS = 40000;

    /* ── Local persistence (auto-save / restore) ────────────────
     *
     * Privacy promise on the home page: "Auto-purged within 24h".
     * We mirror that here: any analysis is stored for at most 24h,
     * then silently discarded. Storage is best-effort — localStorage
     * can be disabled (private mode, quota exceeded); all failures
     * return silently and the analyzer keeps working without it.
     */
    const SNAPSHOT_KEY='cleardoc:lastAnalysis';
    const SNAPSHOT_VERSION=1;
    const SNAPSHOT_TTL_MS=24*60*60*1000;   // 24h, matches the privacy promise
    const SNAPSHOT_MAX_BYTES=256*1024;     // 256KB hard cap; well under the 5MB localStorage quota

    /* ── Draft autosave ─────────────────────────────────────────────
     * Auto-saves the in-progress textarea content as the user types
     * (debounced). On next visit, the draft is restored so an accidental
     * tab-close or refresh doesn't lose what they were writing. Drafts
     * are NOT sensitive results — they sit alongside the result snapshot
     * but with a longer TTL (7 days) since users may legitimately come
     * back to a draft days later.
     */
    const DRAFT_KEY='cleardoc:draftInput';
    const DRAFT_VERSION=1;
    const DRAFT_TTL_MS=7*24*60*60*1000;     // 7 days
    const DRAFT_DEBOUNCE_MS=500;
    const DRAFT_MAX_BYTES=64*1024;          // 64KB hard cap (well under 5MB quota)
    function saveDraftNow(text){
      try{
        const payload={v:DRAFT_VERSION,ts:Date.now(),text:String(text||'')};
        const json=JSON.stringify(payload);
        if(json.length>DRAFT_MAX_BYTES) return false;
        localStorage.setItem(DRAFT_KEY,json);
        return true;
      }catch(_){ return false; }
    }
    function loadDraft(){
      try{
        const raw=localStorage.getItem(DRAFT_KEY);
        if(!raw) return null;
        const data=JSON.parse(raw);
        if(!data || data.v!==DRAFT_VERSION) return null;
        if(typeof data.ts!=='number' || (Date.now()-data.ts)>DRAFT_TTL_MS){
          clearDraft(); return null;
        }
        if(typeof data.text!=='string' || !data.text.trim()) return null;
        return data;
      }catch(_){ return null; }
    }
    function clearDraft(){
      try{ localStorage.removeItem(DRAFT_KEY); }catch(_){}
    }
    function saveSnapshot(snap){
      try{
        if(!snap || typeof snap!=='object') return false;
        const payload={v:SNAPSHOT_VERSION,ts:Date.now(),...snap};
        const json=JSON.stringify(payload);
        if(json.length>SNAPSHOT_MAX_BYTES) return false;
        localStorage.setItem(SNAPSHOT_KEY,json);
        return true;
      }catch(_){ return false; }
    }
    function loadStoredSnapshot(){
      try{
        const raw=localStorage.getItem(SNAPSHOT_KEY);
        if(!raw) return null;
        const data=JSON.parse(raw);
        if(!data || data.v!==SNAPSHOT_VERSION) return null;
        if(typeof data.ts!=='number' || (Date.now()-data.ts)>SNAPSHOT_TTL_MS){ clearStoredSnapshot(); return null; }
        return data;
      }catch(_){ return null; }
    }
    function clearStoredSnapshot(){
      try{ localStorage.removeItem(SNAPSHOT_KEY); }catch(_){}
    }
    // Comma-separated tag parser — normalises case + length + dedupes.
    // Belt-and-braces against attribute-context interpolation:
    // esc() escapes &<>"', but we also strip anything that could form an
    // attribute bound (space, quote, =, <, >) BEFORE length-capping. This way
    // even if a future template forgets to esc() a tag, the tag itself is
    // also already safe-by-construction. Whitespace inside a tag is also
    // collapsed: a tag is one token, not a multi-attribute payload.
    function parseTags(raw){
      const seen = new Set();
      return String(raw || '')
        .split(',')
        .map(t => t.trim().toLowerCase())
        // drop any char that could escape an attribute or tag context
        .map(t => t.replace(/[<>"'`=\s]/g, ''))
        .filter(t => t.length > 0 && t.length <= 32)
        .filter(t => /^[a-z0-9._-]+$/.test(t))
        .filter(t => { if(seen.has(t)) return false; seen.add(t); return true; })
        .slice(0, 8); // cap to 8 tags per analysis
    }
    function renderTags(tags){
      if(!tagsList) return;
      if(!tags || !tags.length){
        tagsList.innerHTML = '';
        return;
      }
      tagsList.innerHTML = tags.map((t, i) =>
        '<span class="tag">'+esc(t)+'<button type="button" data-tag-remove="'+i+'" aria-label="Remove tag '+esc(t)+'">✕</button></span>'
      ).join('');
      tagsList.querySelectorAll('[data-tag-remove]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-tag-remove'), 10);
          const current = parseTags(tagsInput.value);
          current.splice(idx, 1);
          if(tagsInput) tagsInput.value = current.join(', ');
          renderTags(current);
        });
      });
    }
    if(tagsInput){
      tagsInput.addEventListener('change', () => renderTags(parseTags(tagsInput.value)));
      tagsInput.addEventListener('blur', () => renderTags(parseTags(tagsInput.value)));
    }
    function formatRelativeWhen(ts){
      const diff=Date.now()-ts;
      if(diff<60*1000) return 'just now';
      const mins=Math.floor(diff/(60*1000));
      if(mins<60) return mins+' minute'+(mins===1?'':'s')+' ago';
      const hrs=Math.floor(mins/60);
      if(hrs<24) return hrs+' hour'+(hrs===1?'':'s')+' ago';
      const days=Math.floor(hrs/24);
      return days+' day'+(days===1?'':'s')+' ago';
    }
    function shortDocName(raw, fileName){
      if(fileName){
        return '"'+fileName.replace(/\.[^.]+$/,'').slice(0,40)+'"';
      }
      const trimmed=(raw||'').trim().replace(/\s+/g,' ');
      if(!trimmed) return 'a document';
      if(trimmed.length<=60) return '"'+trimmed+'"';
      return '"'+trimmed.slice(0,57)+'…"';
    }

    /* ── URL-fragment share ────────────────────────────────
     *
     * Share an analysis via URL hash so the data never leaves the
     * sender's device. The fragment is gzipped + base64url-encoded;
     * we ship only the data the recipient needs to render the same
     * result (no AI keys, no server roundtrip).
     *
     * Browser URL length limits are the binding constraint: Chrome
     * silently drops fragments past ~16KB and refuses past ~32KB.
     * We cap aggressively so links work everywhere.
     */
    const SHARE_RAW_MAX = 3000;
    const SHARE_REWRITE_MAX = 3000;
    const SHARE_PAYLOAD_MAX_BYTES = 6000; // base64url bytes; ~4.5KB after gzip
    function b64urlEncode(bytes){
      let bin='';
      for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    }
    function b64urlDecode(str){
      str=String(str||'').replace(/-/g,'+').replace(/_/g,'/');
      while(str.length%4) str+='=';
      const bin=atob(str);
      const out=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
      return out;
    }
    async function gzipString(str){
      if(!('CompressionStream' in window)) return null;
      try{
        const stream=new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
        const buf=await new Response(stream).arrayBuffer();
        return new Uint8Array(buf);
      }catch(_){ return null; }
    }
    // Cap the decompressed payload to defend against gzip bombs — a tiny
    // share URL could otherwise expand to gigabytes of memory on decode.
    // The share schema itself is bounded (a single analysis is well under
    // 50KB of JSON), so 1MB is plenty of headroom and far below any OOM
    // threshold on modern browsers.
    const GUNZIP_MAX_BYTES = 1024 * 1024; // 1 MiB
    async function gunzipString(bytes){
      if(!('DecompressionStream' in window)) return null;
      try{
        const src = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        const reader = src.getReader();
        const decoder = new TextDecoder();
        let out = '';
        let total = 0;
        for(;;){
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > GUNZIP_MAX_BYTES) {
            // Drain + cancel to release the chunk buffers before throwing.
            try { await reader.cancel(); } catch(_){}
            throw new Error('Decompressed share payload exceeds ' + GUNZIP_MAX_BYTES + ' bytes (gzip bomb?)');
          }
          out += decoder.decode(value, { stream: true });
        }
        out += decoder.decode();
        return out;
      }catch(_){ return null; }
    }
    async function encodeSharePayload(payload){
      const json=JSON.stringify(payload);
      const gz=await gzipString(json);
      // Prefer gzip; fall back to uncompressed (larger but still works in any browser)
      if(gz) return { v:2, data: b64urlEncode(gz) };
      return { v:1, data: btoa(unescape(encodeURIComponent(json))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'') };
    }
    // Shared cap for both v2 (gzipped) and v1 (uncompressed) decoded bytes.
    // The browser's own URL-fragment limit (~32KB on Chrome, lower elsewhere)
    // is the practical ceiling, but enforcing an explicit cap here protects
    // against both accidental regressions and any future code path that
    // bypasses the URL fragment (e.g. deep links, future Share-to-API).
    const DECODE_MAX_BYTES = 1024 * 1024; // 1 MiB
    async function decodeSharePayload(token){
      const safe=b64urlDecode(String(token||''));
      // Reject pathologically large payloads before we even try to inflate.
      // gunzipString caps its own output, but a 1MB raw input that fails
      // to inflate as gzip would still be handed to the v1 path below.
      if (safe.length > DECODE_MAX_BYTES) return null;
      // Try v2 (gzipped) first
      const gz=await gunzipString(safe);
      if(gz){
        try{ return JSON.parse(gz); }catch(_){ /* fall through */ }
      }
      // Fall back: assume raw base64url of utf-8 JSON
      try{
        const text=decodeURIComponent(escape(btoa(String.fromCharCode(...safe))));
        return JSON.parse(text);
      }catch(_){ return null; }
    }
    function buildShareSnapshot(){
      if(!lastRaw) return null;
      // Trim long fields so the encoded URL stays under SHARE_PAYLOAD_MAX_BYTES.
      // We send what's needed to re-render the same analysis on the recipient side.
      const verdict = (verdictBlock && !verdictBlock.hidden && verdictDisplay) ? {
        label: (verdictDisplay.querySelector('.verdict-label')||{}).textContent || '',
        summary: (verdictDisplay.querySelector('.verdict-summary')||{}).textContent || ''
      } : null;
      const readingLevel = (levelFrom && levelTo) ? {
        before: parseInt((levelFrom.textContent||'').replace(/\D/g,''),10) || null,
        after: parseInt((levelTo.textContent||'').replace(/\D/g,''),10) || null
      } : null;
      return {
        v: 1,
        ts: Date.now(),
        raw: String(lastRaw).slice(0, SHARE_RAW_MAX),
        rawTruncated: lastRaw.length > SHARE_RAW_MAX,
        fileName: attachedFile && attachedFile.name ? attachedFile.name : null,
        rewriteHtml: (plainOut ? plainOut.innerHTML : '').slice(0, SHARE_REWRITE_MAX),
        rewriteTruncated: plainOut ? (plainOut.innerHTML.length > SHARE_REWRITE_MAX) : false,
        verdict,
        readingLevel,
        jargonFound: jargonCount ? parseInt((jargonCount.textContent||'0').replace(/\D/g,''),10)||0 : 0,
        risks: (lastFlags || []).slice(0, 8).map(r=>({sev:r.rule.sev,label:r.rule.label,clause:String(r.s||'').slice(0,200),why:String(r.rule.why||'').slice(0,200)})),
        deadlines: deadlinesList ? [...deadlinesList.querySelectorAll('.deadline-row')].slice(0,6).map(row=>({
          date: (row.querySelector('.deadline-date')||{}).textContent || '',
          description: (row.querySelector('.deadline-desc')||{}).textContent || ''
        })) : [],
        nextSteps: nextStepsList ? [...nextStepsList.querySelectorAll('li')].slice(0,6).map(li=>li.textContent||'') : []
      };
    }
    async function buildShareUrl(){
      const snap=buildShareSnapshot();
      if(!snap) return null;
      const encoded=await encodeSharePayload(snap);
      const base=location.origin+location.pathname;
      const url=base+'#share='+encoded.data;
      if(url.length>SHARE_PAYLOAD_MAX_BYTES){
        return { ok:false, url, reason:'too_long', bytes:url.length };
      }
      return { ok:true, url, bytes:url.length, truncated: snap.rawTruncated || snap.rewriteTruncated };
    }
    async function shareAnalysis(){
      if(!lastRaw){
        if(msg){msg.textContent='Analyze a document first, then share the link.'; msg.className='analyze-msg';}
        return;
      }
      const result=await buildShareUrl();
      if(!result){
        flashButton(shareBtn, 'Share failed', 1800);
        return;
      }
      if(!result.ok && result.reason==='too_long'){
        if(msg){
          msg.textContent='This analysis is too long to share as a link ('+result.bytes+' bytes). Use Save .txt or Copy instead.';
          msg.className='analyze-msg err';
        }
        flashButton(shareBtn, 'Too long', 1800);
        return;
      }
      let copied=false;
      try{
        if(navigator.clipboard && navigator.clipboard.writeText){
          await navigator.clipboard.writeText(result.url);
          copied=true;
        } else {
          const ta=document.createElement('textarea');
          ta.value=result.url;
          ta.style.cssText='position:fixed;left:-9999px;top:0';
          document.body.appendChild(ta);
          ta.select();
          copied=document.execCommand('copy');
          document.body.removeChild(ta);
        }
      }catch(e){ console.warn('[share] clipboard failed', e); }
      flashButton(shareBtn, copied ? 'Link copied ✓' : 'Copy failed', copied ? 1500 : 1800);
      if(msg){
        const truncNote = result.truncated ? ' (truncated to fit the URL)' : '';
        msg.textContent = copied
          ? ('Share link copied — the document text is encoded in the URL'+truncNote+'. Recipients see the analysis without any server roundtrip.')
          : ('Could not copy the link automatically. Use Save .txt instead.');
        msg.className = copied ? 'analyze-msg' : 'analyze-msg err';
      }
    }
    async function tryLoadSharedAnalysis(){
      if(!location.hash || location.hash.indexOf('#share=') !== 0) return;
      const token=location.hash.slice('#share='.length);
      if(!token) return;
      let snap=null;
      try{ snap=await decodeSharePayload(token); }catch(_){ snap=null; }
      if(!snap || typeof snap!=='object' || snap.v!==1){
        if(msg){msg.textContent='This share link is malformed or from an older version of ClearDoc.'; msg.className='analyze-msg err';}
        return;
      }
      // Stash the decoded payload; user clicks "View" to actually paint it.
      pendingSharedSnapshot=snap;
      if(shareBanner){
        if(shareDocName) shareDocName.textContent=shortDocName(snap.raw||'', snap.fileName||null);
        shareBanner.hidden=false;
        if(!noMotion && window.gsap){
          gsap.from(shareBanner,{y:-6,opacity:0,duration:DUR.base,ease:EASE.enter});
        }
      }
    }
    let pendingSharedSnapshot=null;
    let lastSentences=[],lastFlags=[],lastRaw='',attachedText='',attachedFile=null,chipUrls=[];
    function activeDocumentText(){
      const typed=input.value.trim();
      if(attachedText && (!typed || typed===sampleText)) return attachedText;
      if(attachedText && typed) return attachedText+'\n\nUser context:\n'+typed;
      return typed;
    }

    function analyze(){
      const raw=activeDocumentText().trim();
      if(!raw){ msg.textContent='Paste a document or a clause first — or load a sample below.'; msg.className='analyze-msg err'; input.focus(); return; }
      msg.textContent=''; msg.className='analyze-msg';
      // Guard against double-click — only one analysis at a time
      if(btn && btn.disabled) return;
      if(btn){ btn.setAttribute('aria-busy','true'); btn.dataset.label=btn.textContent; btn.textContent='Reading…'; btn.disabled=true; }
      // show loading state — empty + result hidden, loading visible
      if(panel) panel.hidden=true;
      if(emptyEl) emptyEl.hidden=true;
      if(analyzeLoading) analyzeLoading.hidden=false;
      runAnalysis(raw);
    }

    async function runAnalysis(raw){
      // Always seed local analysis so chat/risks work even if API fails.
      let localResult=null;
      try { localResult=buildLocalAnalysis(raw); } catch(e){ console.error('[local-analysis]',e); }

      // Try AI-backed analysis first; fall back to local on any failure.
      let ai=null, aiError=null;
      try{
        const controller=new AbortController();
        const t=setTimeout(()=>controller.abort(), 45000);
        const res=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({document:raw.slice(0,40000)}),signal:controller.signal});
        clearTimeout(t);
        const data=await res.json().catch(()=>({}));
        if(res.ok && data && data.analysis){ ai=data.analysis; }
        else { aiError=(data&&data.error)||('HTTP '+res.status); }
      }catch(err){
        aiError=(err&&(err.name==='AbortError'?'AI timed out':err.message))||'AI unavailable';
        console.warn('[analyze] AI path failed:',aiError);
      }

      // Hide loading, restore button
      if(analyzeLoading) analyzeLoading.hidden=true;
      if(btn){ btn.removeAttribute('aria-busy'); btn.textContent=btn.dataset.label||'Analyze →'; btn.disabled=false; }

      try{
        render(raw, {ai, local:localResult, aiError});
      }catch(e){
        console.error('[render]',e);
        msg.textContent="Couldn't read that — try pasting plain text.";
        msg.className='analyze-msg err';
        if(emptyEl) emptyEl.hidden=false;
      }
    }
    function render(raw, ctx){
      ctx=ctx||{};
      const ai=ctx.ai||null;
      const local=ctx.local||null;
      const sentences=splitSentences(raw); lastSentences=sentences; lastRaw=raw;

      // 1) plain-english rewrite — prefer AI, fall back to local clarify
      let html='', totalJargon=0;
      if(ai && ai.plainEnglishRewrite){
        // AI returned markdown-ish HTML wrapped in <b>/<br>; render with light sanitization
        html=sanitizeAiRewrite(ai.plainEnglishRewrite);
      } else {
        sentences.forEach(s=>{ const r=clarify(s); totalJargon+=r.found; html+='<p>'+(r.changed?r.html:esc(s))+'</p>'; });
      }
      plainOut.innerHTML=html || '<p>'+esc(raw)+'</p>';
      if(jargonCount) jargonCount.textContent = ai && Number.isFinite(ai.jargonFound) ? ai.jargonFound : totalJargon;

      // 2) reading level — prefer AI, fall back to local gradeLevel
      const before=ai && ai.readingLevel && ai.readingLevel.before ? ai.readingLevel.before : gradeLevel(raw);
      const after=ai && ai.readingLevel && ai.readingLevel.after ? ai.readingLevel.after : Math.max(5,Math.min(before-2,gradeLevel(plainOut.textContent)));
      if(levelFrom) levelFrom.textContent=before+'th'; if(levelTo) levelTo.textContent=after+'th';

      // 3) risk radar — prefer AI risks, fall back to local regex flags
      let flags=[];
      if(ai && Array.isArray(ai.risks) && ai.risks.length){
        flags=ai.risks.map(r=>{
          const sev = r.severity==='trap' ? 'r' : r.severity==='watch' ? 'a' : 'g';
          const label = r.severity==='trap' ? 'Trap' : r.severity==='watch' ? 'Watch' : 'Note';
          const sentence = String(r.clause||'').slice(0,300);
          return { i:-1, s:sentence, rule:{sev, label, why:String(r.explanation||'').slice(0,400)} };
        });
      } else if(local && local.flags){
        flags=local.flags;
      } else {
        sentences.forEach((s,i)=>{ for(const rule of RISK){ if(rule.re.test(s)){ flags.push({i,s,rule}); break; } } });
      }
      lastFlags=flags;
      riskList.innerHTML='';
      if(!flags.length){ riskNote.innerHTML='<span class="riskNote-lead">Risk scan</span> No obvious traps detected — but always read the whole thing.'; }
      else {
        const cnt={r:0,a:0,g:0}; flags.forEach(f=>cnt[f.rule.sev]++);
        const tally=[];
        if(cnt.r) tally.push('<span class="rk-tally rk-tally--r">'+cnt.r+' trap'+(cnt.r>1?'s':'')+'</span>');
        if(cnt.a) tally.push('<span class="rk-tally rk-tally--a">'+cnt.a+' watch</span>');
        if(cnt.g) tally.push('<span class="rk-tally rk-tally--g">'+cnt.g+' note'+(cnt.g>1?'s':'')+'</span>');
        riskNote.innerHTML='<span class="riskNote-lead">'+flags.length+' flagged</span> '+tally.join('');
      }
      flags.forEach(f=>{ const row=document.createElement('div'); row.className='rrow'; row.dataset.risk=f.rule.sev;
        row.innerHTML='<span class="rbar"></span><span class="ro">“'+esc(trunc(f.s,150))+'”<b>'+esc(f.rule.why)+'</b></span><span class="rflag" style="opacity:1;transform:none">'+esc(f.rule.label)+'</span>';
        riskList.appendChild(row); });

      // 4) verdict — AI only
      if(verdictDisplay){
        verdictDisplay.innerHTML='';
        if(ai && ai.verdict && ai.verdict.label){
          const label=String(ai.verdict.label).trim();
          const summary=String(ai.verdict.summary||'').trim();
          const tone=label.toLowerCase().includes('fair')?'fair'
                   : label.toLowerCase().includes('suspicious')?'suspicious'
                   : label.toLowerCase().includes('illegal')?'illegal'
                   :'review';
          verdictDisplay.innerHTML='<span class="verdict-label '+tone+'">'+esc(label)+'</span>'
            +'<div class="verdict-summary">'+esc(summary||'')+'</div>';
          if(verdictBlock) verdictBlock.hidden=false;
        } else {
          if(verdictBlock) verdictBlock.hidden=true;
        }
      }

      // 5) deadlines — AI only
      if(deadlinesList){
        deadlinesList.innerHTML='';
        const dls = (ai && Array.isArray(ai.deadlines)) ? ai.deadlines : [];
        if(dls.length){
          dls.forEach(d=>{
            const row=document.createElement('div');
            row.className='deadline-row';
            row.innerHTML='<span class="deadline-date">'+esc(String(d.date||'').slice(0,80))+'</span>'
              +'<span class="deadline-desc">'+esc(String(d.description||'').slice(0,300))+'</span>';
            deadlinesList.appendChild(row);
          });
          if(deadlinesBlock) deadlinesBlock.hidden=false;
        } else {
          if(deadlinesBlock) deadlinesBlock.hidden=true;
        }
      }

      // 6) next steps — AI only
      if(nextStepsList){
        nextStepsList.innerHTML='';
        const steps = (ai && Array.isArray(ai.nextSteps)) ? ai.nextSteps : [];
        if(steps.length){
          steps.forEach(s=>{
            const li=document.createElement('li');
            li.textContent=String(s).slice(0,400);
            nextStepsList.appendChild(li);
          });
          if(nextStepsBlock) nextStepsBlock.hidden=false;
        } else {
          if(nextStepsBlock) nextStepsBlock.hidden=true;
        }
      }

      // 7) status message — note AI status for transparency with actionable guidance
      if(ctx.aiError && msg){
        const err = String(ctx.aiError || '').toLowerCase();
        const isRate = /429|too many|rate|quota/i.test(err);
        const isNet  = /network|fetch|offline|abort|timed out|timeout/i.test(err);
        const reason = isRate ? 'rate-limited'
                    : isNet  ? 'a network or timeout error'
                    : 'an upstream issue';
        msg.innerHTML = '<strong>AI rewrite skipped</strong> — ' + esc(reason) +
                       '. Showing the <em>local</em> scan (regex risk flags + reading level) below. ' +
                       '<button type="button" class="msg-retry" id="msgRetryBtn">Retry</button>';
        msg.className = 'analyze-msg err';
        const retry = document.getElementById('msgRetryBtn');
        if(retry) retry.addEventListener('click', analyze);
      } else if(!ai && msg){
        msg.innerHTML = '<strong>AI rewrite skipped</strong> — no response. Showing the local scan below. ' +
                       '<button type="button" class="msg-retry" id="msgRetryBtn">Retry</button>';
        msg.className = 'analyze-msg err';
        const retry = document.getElementById('msgRetryBtn');
        if(retry) retry.addEventListener('click', analyze);
      }

      // 8) draft
      if(draftOut){
        draftOut.value=buildDraft(raw, flags);
        if(draftNote) draftNote.textContent='Ready-to-edit draft. Fill in names, dates, and contact details before sending.';
      }
      if(!noMotion && window.gsap) gsap.from('#riskList .rrow',{opacity:0,y:12,stagger:.07,duration:DUR.base,ease:EASE.enter});
      // reveal results
      if(emptyEl) emptyEl.hidden=true; panel.hidden=false; if(askOut) askOut.innerHTML='';
      if(!noMotion && window.gsap) gsap.fromTo(panel,{opacity:0,y:14},{opacity:1,y:0,duration:DUR.base,ease:EASE.enter});
      if(askInput) askInput.disabled=false; if(askBtn) askBtn.disabled=false;

      // Persist for restore-on-refresh. Best-effort; failures are silent.
      // Only the renderable shape is stored — no AI API keys, no PII fields.
      saveSnapshot({
        raw,
        fileName: attachedFile && attachedFile.name ? attachedFile.name : null,
        rewriteHtml: plainOut ? plainOut.innerHTML : '',
        verdict: (verdictBlock && !verdictBlock.hidden && verdictDisplay) ? {
          label: (verdictDisplay.querySelector('.verdict-label')||{}).textContent || '',
          summary: (verdictDisplay.querySelector('.verdict-summary')||{}).textContent || ''
        } : null,
        readingLevel: (levelFrom && levelTo) ? {
          before: parseInt((levelFrom.textContent||'').replace(/\D/g,''),10) || null,
          after: parseInt((levelTo.textContent||'').replace(/\D/g,''),10) || null
        } : null,
        jargonFound: jargonCount ? parseInt((jargonCount.textContent||'0').replace(/\D/g,''),10)||0 : 0,
        risks: flags.map(f=>({sev:f.rule.sev,label:f.rule.label,clause:f.s,why:f.rule.why})),
        deadlines: (deadlinesBlock && !deadlinesBlock.hidden && deadlinesList) ? [...deadlinesList.querySelectorAll('.deadline-row')].map(row=>({
          date: (row.querySelector('.deadline-date')||{}).textContent || '',
          description: (row.querySelector('.deadline-desc')||{}).textContent || ''
        })) : [],
        nextSteps: (nextStepsBlock && !nextStepsBlock.hidden && nextStepsList) ? [...nextStepsList.querySelectorAll('li')].map(li=>li.textContent||'') : [],
        draft: draftOut ? draftOut.value : '',
        provider: (ctx.ai ? 'ai' : 'local'),
        tags: parseTags(tagsInput ? tagsInput.value : '')
      });
      // A successful render means the user is engaged with this analysis — hide the offer
      if(restoreBanner) restoreBanner.hidden=true;
      // Snapshot supersedes the draft — clear it so we don't resurrect stale text
      clearDraft();
    }

    // Build a local-only analysis snapshot (plain rewrite + regex flags) for fallback
    function buildLocalAnalysis(raw){
      const sentences=splitSentences(raw);
      const flags=[];
      sentences.forEach((s,i)=>{ for(const rule of RISK){ if(rule.re.test(s)){ flags.push({i,s,rule}); break; } } });
      let html='', totalJargon=0;
      sentences.forEach(s=>{ const r=clarify(s); totalJargon+=r.found; html+='<p>'+(r.changed?r.html:esc(s))+'</p>'; });
      return {plainEnglishRewrite:html||raw, risks:[], verdict:null, deadlines:[], readingLevel:null, jargonFound:totalJargon, flags};
    }

    /* Paint a stored snapshot back into the result panel — no AI call, no network.
     * Used by the restore banner so a refresh / tab-close doesn't lose a long analysis.
     */
    function paintStoredSnapshot(snap){
      if(!snap || typeof snap!=='object') return;
      lastRaw=String(snap.raw||''); lastSentences=splitSentences(lastRaw);

      // Restored risks come from the snapshot; rebuild the same shape render() produces
      const risks=Array.isArray(snap.risks)?snap.risks:[];
      lastFlags=risks.map(r=>({
        i:-1,
        s:String(r.clause||''),
        rule:{
          sev:['r','a','g'].includes(r.sev)?r.sev:'g',
          label:String(r.label||'Note'),
          why:String(r.why||'')
        }
      }));

      // Pre-fill the textarea ONLY if it's currently the preloaded sample — never clobber
      // a user's in-progress edit. This matches what the file-attachment path does.
      const typedNow=input.value.trim();
      if(!typedNow || typedNow===sampleText){
        // Cap to MAX_DOCUMENT_CHARS so the visible textarea doesn't overflow
        input.value=lastRaw.slice(0, MAX_DOCUMENT_CHARS);
      }

      // Plain-English rewrite (already sanitized when saved; sanitize again defensively)
      if(plainOut){
        plainOut.innerHTML=sanitizeAiRewrite(snap.rewriteHtml||'');
      }
      if(jargonCount){
        const jf=Number(snap.jargonFound);
        jargonCount.textContent=Number.isFinite(jf)?jf:(lastFlags.length);
      }

      // Reading level
      const rl=snap.readingLevel||null;
      if(rl && Number.isFinite(rl.before) && Number.isFinite(rl.after)){
        if(levelFrom) levelFrom.textContent=rl.before+'th';
        if(levelTo) levelTo.textContent=rl.after+'th';
      } else {
        const before=gradeLevel(lastRaw);
        const after=Math.max(5, Math.min(before-2, gradeLevel(plainOut?plainOut.textContent:'')));
        if(levelFrom) levelFrom.textContent=before+'th';
        if(levelTo) levelTo.textContent=after+'th';
      }

      // Risk radar — reuse the same DOM-building block as render()
      if(riskNote){
        if(!lastFlags.length){
          riskNote.innerHTML='<span class="riskNote-lead">Risk scan</span> No obvious traps detected — but always read the whole thing.';
        } else {
          const cnt={r:0,a:0,g:0}; lastFlags.forEach(f=>cnt[f.rule.sev]++);
          const tally=[];
          if(cnt.r) tally.push('<span class="rk-tally rk-tally--r">'+cnt.r+' trap'+(cnt.r>1?'s':'')+'</span>');
          if(cnt.a) tally.push('<span class="rk-tally rk-tally--a">'+cnt.a+' watch</span>');
          if(cnt.g) tally.push('<span class="rk-tally rk-tally--g">'+cnt.g+' note'+(cnt.g>1?'s':'')+'</span>');
          riskNote.innerHTML='<span class="riskNote-lead">'+lastFlags.length+' flagged</span> '+tally.join('');
        }
      }
      if(riskList){
        riskList.innerHTML='';
        lastFlags.forEach(f=>{
          const row=document.createElement('div'); row.className='rrow'; row.dataset.risk=f.rule.sev;
          row.innerHTML='<span class="rbar"></span><span class="ro">“'+esc(trunc(f.s,150))+'”<b>'+esc(f.rule.why)+'</b></span><span class="rflag" style="opacity:1;transform:none">'+esc(f.rule.label)+'</span>';
          riskList.appendChild(row);
        });
      }

      // Verdict
      if(verdictDisplay){
        const v=snap.verdict;
        if(v && v.label){
          const label=String(v.label).trim();
          const summary=String(v.summary||'').trim();
          const tone=label.toLowerCase().includes('fair')?'fair'
                   : label.toLowerCase().includes('suspicious')?'suspicious'
                   : label.toLowerCase().includes('illegal')?'illegal'
                   :'review';
          verdictDisplay.innerHTML='<span class="verdict-label '+tone+'">'+esc(label)+'</span>'
            +'<div class="verdict-summary">'+esc(summary||'')+'</div>';
          if(verdictBlock) verdictBlock.hidden=false;
        } else if(verdictBlock){ verdictBlock.hidden=true; }
      }

      // Restore tags
      if(tagsInput){
        const tags = Array.isArray(snap.tags) ? snap.tags : [];
        tagsInput.value = tags.join(', ');
        renderTags(tags);
      }

      // Deadlines
      if(deadlinesList){
        deadlinesList.innerHTML='';
        const dls=Array.isArray(snap.deadlines)?snap.deadlines:[];
        dls.forEach(d=>{
          const row=document.createElement('div');
          row.className='deadline-row';
          row.innerHTML='<span class="deadline-date">'+esc(String(d.date||'').slice(0,80))+'</span>'
            +'<span class="deadline-desc">'+esc(String(d.description||'').slice(0,300))+'</span>';
          deadlinesList.appendChild(row);
        });
        if(deadlinesBlock) deadlinesBlock.hidden = dls.length===0;
      }

      // Next steps
      if(nextStepsList){
        nextStepsList.innerHTML='';
        const steps=Array.isArray(snap.nextSteps)?snap.nextSteps:[];
        steps.forEach(s=>{
          const li=document.createElement('li');
          li.textContent=String(s).slice(0,400);
          nextStepsList.appendChild(li);
        });
        if(nextStepsBlock) nextStepsBlock.hidden = steps.length===0;
      }

      // Draft (regenerate from the restored risks so the buttons match)
      if(draftOut){
        draftOut.value=buildDraft(lastRaw, lastFlags);
        if(draftNote) draftNote.textContent='Restored from your last analysis. Fill in names, dates, and contact details before sending.';
      }

      // Reveal the panel; hide loading/empty states
      if(emptyEl) emptyEl.hidden=true;
      if(analyzeLoading) analyzeLoading.hidden=true;
      if(panel) panel.hidden=false;
      if(askOut) askOut.innerHTML='';
      if(askInput) askInput.disabled=false;
      if(askBtn) askBtn.disabled=false;

      // Status: surface that this is a restore, not a fresh analysis
      if(msg){
        msg.textContent='Restored your last analysis. Press Analyze to re-run with the current text.';
        msg.className='analyze-msg';
      }

      if(restoreBanner) restoreBanner.hidden=true;
      if(!noMotion && window.gsap && panel){
        gsap.fromTo(panel,{opacity:0,y:14},{opacity:1,y:0,duration:DUR.base,ease:EASE.enter});
      }
    }

    function maybeOfferRestore(){
      if(!restoreBanner) return;
      const snap=loadStoredSnapshot();
      if(!snap) return;
      if(restoreDocName){
        let label=shortDocName(snap.raw, snap.fileName);
        if(Array.isArray(snap.tags) && snap.tags.length){
          label = label + ' · ' + snap.tags.map(t=>'#'+t).join(' ');
        }
        restoreDocName.textContent=label;
      }
      if(restoreWhen) restoreWhen.textContent=formatRelativeWhen(snap.ts);
      restoreBanner.hidden=false;
      if(!noMotion && window.gsap){
        gsap.from(restoreBanner,{y:-6,opacity:0,duration:DUR.base,ease:EASE.enter});
      }
    }

    // Light sanitizer for AI rewrite HTML — only allow safe tags, neutralize anything else
    function sanitizeAiRewrite(html){
      let s=String(html||'');
      // normalize line breaks before/after <br>
      s=s.replace(/\r/g,'');
      // strip <script>/<style> blocks entirely
      s=s.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,'');
      // whitelist allowed tags — non-global regex so .test() is stateless across calls
      const allowed=/^<\/?(?:b|strong|i|em|u|br|p|ul|ol|li|h[1-6])(?:\s[^>]*)?>$/i;
      s=s.replace(/<[^>]+>/g, function(m){ return allowed.test(m) ? m : ''; });
      // normalize paragraph breaks if AI didn't include them
      if(!/<\s*br/i.test(s) && !/<\s*p[\s>]/i.test(s)) s=s.replace(/\n{2,}/g,'<br><br>').replace(/\n/g,'<br>');
      // strip any leftover on* event handlers (defense-in-depth)
      s=s.replace(/\son\w+\s*=\s*"[^"]*"/gi,'').replace(/\son\w+\s*=\s*'[^']*'/gi,'');
      return s;
    }
    function pickBestSentence(question){
      if(!question) return null;
      const stop=new Set('the a an of to in on for and or is are be shall must you your i it this that with from at as by will would can may any all not no its their our'.split(' '));
      const kw=question.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>2 && !stop.has(w));
      let best=null,bestScore=0;
      lastSentences.forEach((s,i)=>{ const low=s.toLowerCase(); let sc=0; kw.forEach(w=>{ if(low.indexOf(w)>-1) sc++; }); if(sc>bestScore){ bestScore=sc; best={s,i}; } });
      return bestScore>0?best:null;
    }
    function localAnswer(q){
      const lowerDoc=lastRaw.toLowerCase(),lowerQ=q.toLowerCase(),best=pickBestSentence(q);
      // Helper: format a citation as "Sentence N of M: \"quote\"" when we
      // have a matched sentence, or just the position otherwise.
      function fmtCite(cite){
        if(!cite) return null;
        const sn = (typeof cite.i === 'number') ? (cite.i + 1) + ' of ' + lastSentences.length : null;
        const snip = cite.s ? '"' + trunc(cite.s, 140) + '"' : '';
        return sn ? ('Sentence ' + sn + (snip ? ' · ' + snip : '')) : null;
      }
      if(/deposit|security/.test(lowerQ) && /forfeit|security deposit|non-refundable|non refundable/.test(lowerDoc)){
        const notice=/sixty|60/.test(lowerDoc)?' The document points to a 60-day written-notice condition.':'';
        return {text:"Not automatically. If you met the notice requirement and there are no valid damage deductions, this text does not clearly say they can keep 100% of your deposit."+notice+" If you missed that condition, it gives them language to argue forfeiture, so ask for the exact reason and an itemized deduction list.", cite:best, citeFmt:fmtCite(best)};
      }
      if(/refund|back|return|get.*fee|money/.test(lowerQ) && /non[-\s]?refundable|non refundable|forfeit/.test(lowerDoc)){
        const refundSentence=lastSentences.find((s)=>/non[-\s]?refundable|non refundable|forfeit/i.test(s));
        const citeObj = refundSentence?{s:refundSentence,i:lastSentences.indexOf(refundSentence)}:best;
        return {text:"Probably not based on this wording. The document says the relevant fee or charge is non-refundable, so you should ask the college for a written refund policy or exception before assuming you will get it back.", cite:citeObj, citeFmt:fmtCite(citeObj)};
      }
      if(/cancel|terminate|early/.test(lowerQ) && /early termination|remaining charges|cancel/.test(lowerDoc)){
        return {text:"Probably not without cost. The document appears to say early termination can trigger the remaining charges or a cancellation assessment, so ask for the exact clause and the dollar calculation before agreeing.", cite:best, citeFmt:fmtCite(best)};
      }
      if(/liable|responsible|pay|owe|cost|fee/.test(lowerQ)){
        const t = best
          ? "The closest sentence says: "+best.s
          : "I do not see a clear liability answer in the text. Look for words like liable, responsible, indemnify, fee, penalty, or assessment.";
        return {text:t, cite:best, citeFmt:fmtCite(best)};
      }
      const t2 = best
        ? "The closest supported answer is based on this sentence: "+best.s
        : "I could not find that directly in the document. It may be implied, missing, or worded differently.";
      return {text:t2, cite:best, citeFmt:fmtCite(best)};
    }
    /* ---- Multi-turn Ask thread ----
     * Each Q&A pair is appended to askHistory and re-rendered into
     * #askThread. The current 'pending' question is held as a stub so
     * the thinking dots appear immediately, then upgraded to the real
     * answer (with citation) when the network response lands.
     */
    let askHistory=[];
    const askThread=$('#askThread'),askClearBtn=$('#askClearBtn');
    function renderAskThread(){
      if(!askThread) return;
      if(!askHistory.length){
        askThread.innerHTML='';
        if(askClearBtn) askClearBtn.hidden=true;
        return;
      }
      askThread.innerHTML = askHistory.map(turn => {
        const pending = turn.pending;
        const aBody = pending
          ? '<span class="think"><i></i><i></i><i></i></span> Asking…'
          : '<div class="ans-line">'+esc(turn.answer)+'</div>' + (turn.cite ? '<div class="cite" style="opacity:1">'+esc(turn.cite)+'</div>' : '');
        return '<div class="ask-q">'+esc(turn.q)+'</div>' +
               '<div class="ask-a">'+aBody+'</div>';
      }).join('');
      if(askClearBtn) askClearBtn.hidden=false;
      // Scroll the latest answer into view
      askThread.scrollTop = askThread.scrollHeight;
    }
    async function ask(){
      const q=(askInput&&askInput.value||'').trim(); if(!q) return;
      if(!lastSentences.length){
        if(askThread) askThread.innerHTML='<div class="ask-a">Analyze a document first, then ask about it.</div>';
        return;
      }
      // Reserve a pending slot so the thinking dots render immediately
      const turn = { q, pending:true, answer:'', cite:'' };
      askHistory.push(turn);
      renderAskThread();
      if(askInput) askInput.value='';
      if(askBtn) askBtn.disabled=true;

      const local=localAnswer(q);
      let answered=false;
      try{
        const res=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          question:q,
          document:lastRaw.slice(0,30000),
          rewrite:plainOut?plainOut.textContent.slice(0,6000):'',
          risks:lastFlags.map(f=>({sentence:f.s,reason:f.rule.why,label:f.rule.label})).slice(0,12),
          fileName:attachedFile&&attachedFile.name,
          history: askHistory.slice(0,-1).map(h=>({q:h.q,a:h.answer||''}))
        })});
        const data=await res.json().catch(()=>({}));
        if(res.ok && data.answer){
          turn.answer=data.answer;
          turn.cite=data.citation||'';
          turn.pending=false;
          answered=true;
          renderAskThread();
        }
      }catch(_){}
      if(!answered){
        turn.answer=local.text;
        turn.cite=local.citeFmt || (local.cite?'local fallback · sentence '+(local.cite.i+1)+' of '+lastSentences.length:'local fallback');
        turn.pending=false;
        renderAskThread();
      }
      if(askBtn) askBtn.disabled=false;
    }
    if(askClearBtn) askClearBtn.addEventListener('click',()=>{
      askHistory=[];
      renderAskThread();
      if(askOut) askOut.innerHTML='';
    });
    function buildDraft(raw, flags){
      const firstRisk=flags[0];
      const issue=firstRisk?firstRisk.rule.why:'Please confirm the document terms in plain language.';
      const quote=firstRisk?'Relevant text: "'+trunc(firstRisk.s,220)+'"':'Relevant document text: "'+trunc(raw,220)+'"';
      return [
        'Subject: Request for clarification and correction',
        '',
        'Hello,',
        '',
        'I am writing about the attached document/notice. I need a clear written explanation of the terms before I agree, pay, sign, or waive any rights.',
        '',
        quote,
        '',
        'My concern: '+issue,
        '',
        'Please send me:',
        '1. A plain-English explanation of this term and how it applies to me.',
        '2. Any itemized calculation, policy, lease clause, invoice line, or rule you are relying on.',
        '3. The deadline for my response, appeal, payment, or cancellation, if any.',
        '4. Confirmation that no fees, penalties, forfeitures, or adverse action will be added while this clarification is pending.',
        '',
        'I am not agreeing to the disputed term or charge by asking for this clarification. Please reply in writing.',
        '',
        'Sincerely,',
        '[YOUR NAME]',
        '[YOUR CONTACT INFORMATION]'
      ].join('\n');
    }

    /* ---- Print / Save / Copy the full analysis ---- */
    // Strip HTML to plain text — preserve paragraph breaks, drop everything else.
    function stripHtmlToText(html){
      if(!html) return '';
      return String(html)
        .replace(/\r/g,'')
        .replace(/<br\s*\/?>/gi,'\n')
        .replace(/<\/(p|li|h[1-6])>/gi,'\n')
        .replace(/<li[^>]*>/gi,'• ')
        .replace(/<[^>]+>/g,'')
        .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
        .replace(/[ \t]+\n/g,'\n')
        .replace(/\n{3,}/g,'\n\n')
        .trim();
    }
    function section(title){
      const t='── '+title.toUpperCase()+' ';
      return t+'─'.repeat(Math.max(0, 70 - t.length));
    }
    function buildAnalysisSummary(){
      if(!lastRaw) return '';
      const NL='\n';
      const out=[];
      out.push('CLEARDOC ANALYSIS');
      out.push('Generated: '+new Date().toLocaleString());
      if(attachedFile && attachedFile.name) out.push('Source file: '+attachedFile.name);
      out.push('cleardoc.app');
      out.push('═'.repeat(70));
      out.push('');

      // 1. Verdict
      const vLabel = verdictDisplay && verdictDisplay.querySelector && verdictDisplay.querySelector('.verdict-label');
      const vSummary = verdictDisplay && verdictDisplay.querySelector && verdictDisplay.querySelector('.verdict-summary');
      if(vLabel && verdictBlock && !verdictBlock.hidden){
        out.push(section('Verdict'));
        out.push(vLabel.textContent.trim());
        if(vSummary && vSummary.textContent.trim()) out.push(vSummary.textContent.trim());
        out.push('');
      }

      // 2. Plain-English rewrite
      if(plainOut && plainOut.textContent && plainOut.textContent.trim()){
        out.push(section('Plain-English Rewrite'));
        out.push(stripHtmlToText(plainOut.innerHTML));
        out.push('');
        if(levelFrom && levelTo){
          out.push('Reading level: '+levelFrom.textContent+' → '+levelTo.textContent);
        }
        if(jargonCount){
          out.push('Jargon found: '+jargonCount.textContent);
        }
        out.push('');
      }

      // 3. Risk radar
      if(lastFlags && lastFlags.length){
        out.push(section('Risk Radar ('+lastFlags.length+' flagged)'));
        lastFlags.forEach((f,i)=>{
          out.push((i+1)+'. ['+f.rule.label.toUpperCase()+']');
          out.push('   "'+trunc(f.s, 200).replace(/\s+/g,' ').trim()+'"');
          out.push('   Why: '+f.rule.why);
          out.push('');
        });
      }

      // 4. Deadlines
      if(deadlinesBlock && !deadlinesBlock.hidden && deadlinesList){
        const rows=deadlinesList.querySelectorAll('.deadline-row');
        if(rows.length){
          out.push(section('Deadlines ('+rows.length+')'));
          rows.forEach(row=>{
            const d=row.querySelector('.deadline-date');
            const x=row.querySelector('.deadline-desc');
            out.push('• '+(d?d.textContent.trim():'')+' — '+(x?x.textContent.trim():''));
          });
          out.push('');
        }
      }

      // 5. Next steps
      if(nextStepsBlock && !nextStepsBlock.hidden && nextStepsList){
        const steps=nextStepsList.querySelectorAll('li');
        if(steps.length){
          out.push(section('Next Steps'));
          steps.forEach((s,i)=>{ out.push((i+1)+'. '+s.textContent.trim()); });
          out.push('');
        }
      }

      // 6. Response draft
      if(draftOut && draftOut.value && draftOut.value.trim()){
        out.push(section('Response Draft'));
        out.push(draftOut.value);
        out.push('');
      }

      out.push('═'.repeat(70));
      out.push('Generated by ClearDoc · cleardoc.app');
      out.push('NOT LEGAL ADVICE. For high-stakes documents, consult a qualified attorney.');
      return out.join(NL);
    }
    function flashButton(b, msg, ms){
      if(!b) return;
      const orig=b.dataset.label||b.textContent;
      b.dataset.label=orig;
      b.textContent=msg;
      clearTimeout(b._flashTimer);
      b._flashTimer=setTimeout(()=>{ b.textContent=orig; }, ms||1400);
    }
    function printAnalysis(){
      if(!lastRaw){
        if(msg){msg.textContent='Analyze a document first, then print the results.'; msg.className='analyze-msg';}
        return;
      }
      if(printDate) printDate.textContent=new Date().toLocaleString();
      window.print();
    }
    function saveAnalysis(){
      if(!lastRaw){
        if(msg){msg.textContent='Analyze a document first, then save the analysis.'; msg.className='analyze-msg';}
        return;
      }
      const text=buildAnalysisSummary();
      const stamp=new Date().toISOString().slice(0,10);
      const filename='cleardoc-analysis-'+stamp+'.txt';
      try{
        const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
        const a=document.createElement('a');
        a.href=url; a.download=filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(()=>URL.revokeObjectURL(url), 1500);
        flashButton(saveBtn, 'Saved ✓');
      }catch(e){
        console.error('[save-analysis]',e);
        flashButton(saveBtn, 'Save failed', 1800);
      }
    }
    async function copyAnalysis(){
      if(!lastRaw){
        if(msg){msg.textContent='Analyze a document first, then copy the summary.'; msg.className='analyze-msg';}
        return;
      }
      const text=buildAnalysisSummary();
      let ok=false;
      try{
        if(navigator.clipboard && navigator.clipboard.writeText){
          await navigator.clipboard.writeText(text);
          ok=true;
        } else {
          const ta=document.createElement('textarea');
          ta.value=text;
          ta.style.cssText='position:fixed;left:-9999px;top:0';
          document.body.appendChild(ta);
          ta.select();
          ok=document.execCommand('copy');
          document.body.removeChild(ta);
        }
      }catch(e){
        console.warn('[copy-analysis] clipboard failed',e);
      }
      flashButton(copyBtn, ok?'Copied ✓':'Copy failed', ok?1400:1800);
    }

    if(btn) btn.addEventListener('click',analyze);
    if(clearBtn) clearBtn.addEventListener('click',()=>{ input.value=''; lastSentences=[]; lastFlags=[]; lastRaw=''; if(panel)panel.hidden=true; if(emptyEl)emptyEl.hidden=false; if(msg){msg.textContent='';msg.className='analyze-msg';} clearAttachments(); clearStoredSnapshot(); clearDraft(); updateTextStats(); input.focus(); });

    /* ---- Live text stats (word/char count + estimated reading level) ---- */
    function updateTextStats(){
      if(!input || !statWords) return;
      const raw = input.value || '';
      const chars = raw.length;
      const words = (raw.match(/\b[\w'-]+\b/g) || []).length;
      const cap = MAX_DOCUMENT_CHARS;
      const overCap = chars > cap;
      const wordFmt = words.toLocaleString();
      const charFmt = chars.toLocaleString();
      statWords.textContent = wordFmt;
      statChars.textContent = charFmt;
      if(statReadTime) statReadTime.textContent = readTime(raw);
      statLevel.textContent = isGradable(raw) ? (gradeLevel(raw) + 'th') : '—';
      if(statCap) statCap.textContent = cap.toLocaleString();
      if(textStats){
        textStats.classList.toggle('over', overCap);
        if(overCap && msg){
          msg.textContent = 'Document exceeds the ' + cap.toLocaleString() + ' character cap. ' +
                            'Trim it or analyze the first ' + cap.toLocaleString() + ' characters.';
          msg.className = 'analyze-msg err';
        }
      }
    }
    if(input){
      input.addEventListener('input', updateTextStats);
      input.addEventListener('change', updateTextStats);
      updateTextStats(); // initial paint for the preloaded sample

      /* Draft autosave — debounced write to localStorage so a tab-close
       * or refresh doesn't lose the user's in-progress text. Cleared on
       * successful analysis (snapshot replaces the draft), on Clear, and
       * on the Forget-my-data reset. The 500ms debounce keeps typing snappy.
       */
      let _draftTimer = null;
      function scheduleDraftSave(){
        clearTimeout(_draftTimer);
        _draftTimer = setTimeout(() => {
          // Don't autosave the preloaded sample — it's the same as the
          // initial value and would just churn localStorage.
          const current = input.value || '';
          if(current.trim() === sampleText.trim()) { clearDraft(); return; }
          // Don't autosave empty input (avoid resurrecting blanks).
          if(!current.trim()) { clearDraft(); return; }
          saveDraftNow(current);
        }, DRAFT_DEBOUNCE_MS);
      }
      input.addEventListener('input', scheduleDraftSave);
      // Also flush on blur / beforeunload so a tab-close captures the latest text.
      input.addEventListener('blur', () => { clearTimeout(_draftTimer); scheduleDraftSave(); });
      window.addEventListener('beforeunload', () => { clearTimeout(_draftTimer); scheduleDraftSave(); });
    }

    // Restore the draft on page load if there is one AND we don't already
    // have an analysis result to show (the snapshot flow already covers that).
    if(input){
      const snap = loadStoredSnapshot();
      const hasResult = snap && snap.raw && (panel && !panel.hidden);
      if(!hasResult){
        const draft = loadDraft();
        if(draft){
          // Only restore if the current textarea still holds the preloaded sample
          // (otherwise the user has intentionally typed something already and
          // we shouldn't clobber it).
          if(input.value.trim() === sampleText.trim()){
            input.value = draft.text.slice(0, MAX_DOCUMENT_CHARS);
            if(msg){
              msg.textContent = 'Restored your in-progress draft from ' + formatRelativeWhen(draft.ts) + '. Press Analyze when ready.';
              msg.className = 'analyze-msg';
            }
            updateTextStats();
          }
        }
      }
    }
    // Restore / dismiss the auto-saved analysis banner
    if(restoreBtn) restoreBtn.addEventListener('click',()=>{
      const snap=loadStoredSnapshot();
      if(snap){ paintStoredSnapshot(snap); }
      else if(restoreBanner){ restoreBanner.hidden=true; }
    });
    if(dismissRestoreBtn) dismissRestoreBtn.addEventListener('click',()=>{
      clearStoredSnapshot();
      if(restoreBanner) restoreBanner.hidden=true;
      if(msg){msg.textContent='Saved analysis dismissed. It will not be offered again until you run a new analysis.'; msg.className='analyze-msg';}
    });
    $$('.qf[data-fill]').forEach(q=>q.addEventListener('click',()=>{ input.value=q.dataset.fill; clearAttachments(); clearDraft(); if(panel)panel.hidden=true; if(emptyEl)emptyEl.hidden=false; if(msg){msg.textContent='Sample loaded. Press Analyze when ready.';msg.className='analyze-msg';} updateTextStats(); }));
    if(copyDraftBtn) copyDraftBtn.addEventListener('click',async()=>{ if(!draftOut||!draftOut.value)return; try{ await navigator.clipboard.writeText(draftOut.value); copyDraftBtn.textContent='Copied'; setTimeout(()=>copyDraftBtn.textContent='Copy draft',1400); }catch(_){ draftOut.focus(); draftOut.select(); } });
    if(verdictCopyBtn) verdictCopyBtn.addEventListener('click',async()=>{
      if(!verdictDisplay) return;
      const label=(verdictDisplay.querySelector('.verdict-label')||{}).textContent || '';
      const summary=(verdictDisplay.querySelector('.verdict-summary')||{}).textContent || '';
      const text=(label + (summary ? ': ' + summary.trim() : '')).trim();
      if(!text) return;
      let ok=false;
      try{
        if(navigator.clipboard && navigator.clipboard.writeText){
          await navigator.clipboard.writeText(text);
          ok=true;
        } else {
          const ta=document.createElement('textarea');
          ta.value=text; ta.style.cssText='position:fixed;left:-9999px;top:0';
          document.body.appendChild(ta); ta.select();
          ok=document.execCommand('copy'); document.body.removeChild(ta);
        }
      }catch(_){}
      const orig='Copy';
      verdictCopyBtn.textContent=ok ? 'Copied ✓' : 'Copy failed';
      clearTimeout(verdictCopyBtn._flashTimer);
      verdictCopyBtn._flashTimer=setTimeout(()=>{ verdictCopyBtn.textContent=orig; },1400);
    });
    if(downloadDraftBtn) downloadDraftBtn.addEventListener('click',()=>{ if(!draftOut||!draftOut.value)return; const url=URL.createObjectURL(new Blob([draftOut.value],{type:'text/plain'})); const a=document.createElement('a'); a.href=url; a.download='cleardoc-response-draft.txt'; a.click(); URL.revokeObjectURL(url); });
    if(printBtn) printBtn.addEventListener('click',printAnalysis);
    if(saveBtn) saveBtn.addEventListener('click',saveAnalysis);
    if(copyBtn) copyBtn.addEventListener('click',copyAnalysis);
    if(shareBtn) shareBtn.addEventListener('click',shareAnalysis);
    // Keyboard shortcuts when results are visible: Cmd/Ctrl+P already triggers window.print(),
    // and our print stylesheet routes that through the clean print layout. No extra wiring needed.

    // Shared-analysis banner (#share= in the URL): paint + clean up the hash on view
    if(viewShareBtn) viewShareBtn.addEventListener('click',()=>{
      if(pendingSharedSnapshot){
        paintStoredSnapshot(pendingSharedSnapshot);
        // Drop the share fragment so a refresh doesn't re-trigger the banner
        try{ history.replaceState(null, '', location.pathname+location.search); }catch(_){}
      }
      if(shareBanner) shareBanner.hidden=true;
    });
    if(dismissShareBtn) dismissShareBtn.addEventListener('click',()=>{
      try{ history.replaceState(null, '', location.pathname+location.search); }catch(_){}
      pendingSharedSnapshot=null;
      if(shareBanner) shareBanner.hidden=true;
      if(msg){msg.textContent='Shared analysis dismissed.'; msg.className='analyze-msg';}
    });

    /* ---- FILE ATTACHMENT — accepts text, PDF, images & common office formats ---- */
    const TEXT_EXT=/\.(txt|text|md|markdown|csv|tsv|log|json|xml|html?|rtf)$/i;
    const IMG_EXT=/\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif|tiff?)$/i;
    const PDF_EXT=/\.pdf$/i;
    const OCR_TIMEOUT_MS = 30000;        // abort if Tesseract hasn't returned after 30s
    // Hard cap on image size fed to Tesseract. Tesseract is single-threaded
    // and runs entirely in the browser; an oversize image (e.g. a 50 MB
    // phone photo) will exhaust tab memory long before OCR_TIMEOUT_MS fires.
    // 10 MB is generous — most OCR-friendly scans come in well under 2 MB.
    // Above the cap, refuse the image up front with a clear toast (vs. the
    // existing opaque "OCR failed" failure mode).
    const MAX_OCR_BYTES = 10 * 1024 * 1024;
    const TESSERACT_SRC = 'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js';
    // SHA-384 of the live tesseract.min.js@5 bytes, for Subresource Integrity.
    // If unpkg is compromised and serves different bytes, the browser refuses
    // to execute. crossorigin=anonymous is required for SRI verification.
    const TESSERACT_SRI = 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F';
    function fmtSize(b){ if(b<1024)return b+' B'; if(b<1048576)return Math.round(b/1024)+' KB'; return (b/1048576).toFixed(1)+' MB'; }
    function extOf(n){ const m=/\.([a-z0-9]+)$/i.exec(n); return m?m[1].toUpperCase():'FILE'; }
    function kindOf(n){ if(IMG_EXT.test(n))return'img'; if(PDF_EXT.test(n))return'pdf'; if(/\.(docx?|odt|pages)$/i.test(n))return'doc'; return'txt'; }
    function clearAttachments(){ if(!attachTray)return; cancelActiveOcr(); chipUrls.forEach(u=>{try{URL.revokeObjectURL(u);}catch(_){}}); chipUrls=[]; attachedText=''; attachedFile=null; attachTray.innerHTML=''; attachTray.hidden=true; if(fileInput)fileInput.value=''; }
    function setSub(chip,cls,txt){ const sub=chip.querySelector('.fsub'); sub.className='fsub '+cls; sub.innerHTML='<span class="dot"></span>'+esc(txt); }
    function makeChip(file){
      const kind=kindOf(file.name);
      const chip=document.createElement('div'); chip.className='attach-chip'; chip.dataset.kind=kind;
      let visual;
      if(kind==='img'){ const url=URL.createObjectURL(file); chipUrls.push(url); visual='<img class="thumb" alt="" src="'+url+'">'; }
      else { visual='<span class="ficon">'+esc(extOf(file.name))+'</span>'; }
      chip.innerHTML=visual+'<div class="fmeta"><div class="fname">'+esc(file.name)+'</div><div class="fsub work"><span class="dot"></span>'+esc(fmtSize(file.size))+'</div></div><button class="fx" type="button" aria-label="Remove attachment">✕</button>';
      chip.querySelector('.fx').addEventListener('click',clearAttachments);
      attachTray.innerHTML=''; attachTray.appendChild(chip); attachTray.hidden=false;
      return chip;
    }
    function prepareForAttachment(){ if(input.value.trim()===sampleText) input.value=''; if(panel)panel.hidden=true; if(emptyEl)emptyEl.hidden=false; if(msg){msg.textContent='File attached. Add your question or context on the left, then press Analyze.';msg.className='analyze-msg';} }
    function readText(file,chip){ const rd=new FileReader();
      rd.onload=()=>{ attachedText=String(rd.result).slice(0,30000); setSub(chip,'ok','Ready · press Analyze'); prepareForAttachment(); };
      rd.onerror=()=>{ setSub(chip,'warn','Could not read — paste the text instead'); };
      rd.readAsText(file); }
    async function readPdf(file,chip){
      if(!window.pdfjsLib){ setSub(chip,'warn','PDF attached · paste the text to analyze'); return; }
      try{ setSub(chip,'work','Reading PDF…');
        const buf=await file.arrayBuffer();
        const pdf=await window.pdfjsLib.getDocument({data:buf}).promise;
        const max=Math.min(pdf.numPages,30); let out='';
        for(let p=1;p<=max;p++){ const page=await pdf.getPage(p); const tc=await page.getTextContent(); out+=tc.items.map(i=>i.str).join(' ')+'\n\n'; }
        out=out.trim();
        if(!out){ setSub(chip,'warn','No selectable text (scanned PDF?) — paste it instead'); return; }
        attachedText=out.slice(0,30000);
        setSub(chip,'ok','Read '+max+' page'+(max>1?'s':'')+(pdf.numPages>max?' of '+pdf.numPages:'')+' · press Analyze');
        prepareForAttachment();
      }catch(err){ console.error(err); setSub(chip,'warn','Could not read this PDF — paste the text instead'); }
    }

    /* ---- Lazy OCR (Tesseract.js) — only loaded when an image is attached ----
     * The 1MB+ Tesseract runtime + English language pack is loaded on-demand
     * from a CDN. Users who never attach an image pay nothing. If the load
     * fails, the network is offline, or OCR takes longer than OCR_TIMEOUT_MS,
     * we fall back to the existing "paste the text" warning so the analyzer
     * is never blocked by a missing dependency.
     */
    let _tesseractPromise=null;
    let _activeOcrWorker=null;
    function loadTesseract(){
      if(window.Tesseract) return Promise.resolve(window.Tesseract);
      if(_tesseractPromise) return _tesseractPromise;
      _tesseractPromise=new Promise((resolve,reject)=>{
        const s=document.createElement('script');
        s.src=TESSERACT_SRC;
        s.integrity = TESSERACT_SRI;
        s.crossOrigin = 'anonymous';
        s.async=true;
        s.onload=()=> window.Tesseract ? resolve(window.Tesseract) : reject(new Error('Tesseract missing on window after load'));
        s.onerror=()=> { _tesseractPromise=null; reject(new Error('Failed to load Tesseract.js')); };
        document.head.appendChild(s);
      });
      return _tesseractPromise;
    }
    async function readImage(file,chip){
      // Size gate BEFORE loading Tesseract. A multi-MB image would
      // load the 1MB+ OCR runtime, then OOM the tab partway through
      // recognition — wasted bandwidth + an opaque "OCR failed"
      // toast. Reject up front instead.
      if(file && typeof file.size === 'number' && file.size > MAX_OCR_BYTES){
        const mb = (file.size / (1024 * 1024)).toFixed(1);
        setSub(chip,'warn','Image too large for OCR (' + mb + ' MB · max 10 MB) — resize it or paste the text instead');
        return;
      }
      setSub(chip,'work','Loading OCR engine…');
      let Tesseract;
      try{ Tesseract = await loadTesseract(); }
      catch(err){
        console.warn('[ocr] load failed:', err && err.message || err);
        setSub(chip,'warn','OCR engine unavailable — paste the text instead');
        return;
      }
      setSub(chip,'work','Reading image…');
      let worker=null;
      let timedOut=false;
      const timer=setTimeout(()=>{
        timedOut=true;
        if(worker && worker.terminate){ try{ worker.terminate(); }catch(_){} }
        setSub(chip,'warn','OCR timed out — paste the text instead');
        _activeOcrWorker=null;
      }, OCR_TIMEOUT_MS);
      try{
        worker=await Tesseract.createWorker('eng');
        _activeOcrWorker=worker;
        const { data } = await worker.recognize(file, {}, {
          logger: m => {
            if(!timedOut && m && m.status==='recognizing text' && typeof m.progress==='number'){
              setSub(chip,'work','Reading image · '+Math.round(m.progress*100)+'%');
            }
          }
        });
        if(timedOut) return; // timeout already fired and set the chip
        clearTimeout(timer);
        const text=String(data && data.text || '').trim();
        if(!text){
          setSub(chip,'warn','No text found in image — paste it instead');
          return;
        }
        attachedText=text.slice(0,30000);
        setSub(chip,'ok','Read '+text.length+' chars · press Analyze');
        prepareForAttachment();
      }catch(err){
        if(timedOut) return; // the timeout handler already set the chip
        console.error('[ocr]', err);
        setSub(chip,'warn','OCR failed — paste the text instead');
      }finally{
        clearTimeout(timer);
        if(worker){ try{ await worker.terminate(); }catch(_){} }
        _activeOcrWorker=null;
      }
    }
    function cancelActiveOcr(){
      if(_activeOcrWorker){
        try{ _activeOcrWorker.terminate(); }catch(_){}
        _activeOcrWorker=null;
      }
    }
    function handleFile(file){ if(!file||!attachTray)return; attachedFile=file; attachedText=''; const chip=makeChip(file); const n=file.name;
      if(PDF_EXT.test(n)) readPdf(file,chip);
      else if(IMG_EXT.test(n)) readImage(file,chip);
      else if(TEXT_EXT.test(n)||(file.type&&file.type.indexOf('text')===0)) readText(file,chip);
      else if(/\.(docx?|odt|pages)$/i.test(n)) setSub(chip,'warn','Office doc attached · paste the text to analyze');
      else readText(file,chip);
    }
    if(fileInput) fileInput.addEventListener('change',e=>{ const f=e.target.files&&e.target.files[0]; if(f) handleFile(f); });
    if(askBtn) askBtn.addEventListener('click',ask);
    if(askInput) askInput.addEventListener('keydown',e=>{ if(e.key==='Enter') ask(); });

    // Offer to restore the last analysis (24h TTL) — never blocks the empty state
    try { maybeOfferRestore(); } catch(e){ console.warn('[restore]', e); }
    // Decode any #share= fragment so we can offer to view it
    try { tryLoadSharedAnalysis(); } catch(e){ console.warn('[share-load]', e); }
  }

})();
