(function(){
  "use strict";
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || /[?&]rm=1/.test(location.search);
  const hasGSAP = !!window.gsap;
  const noMotion = reduce || !hasGSAP;          // superset: treat missing libs like reduced motion
  const $=(s,el)=> (el||document).querySelector(s);
  const $$=(s,el)=> [...(el||document).querySelectorAll(s)];
  if(hasGSAP) gsap.registerPlugin(ScrollTrigger);

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
    let text=(raw||"").trim(); let found=0;
    // wrap replacements in printable sentinels, THEN HTML-escape user text, so input can never inject markup
    JARGON.forEach(([re,plain])=>{ const r=new RegExp(re.source,re.flags); if(r.test(text)){found++; text=text.replace(new RegExp(re.source,re.flags),"[[B]]"+plain+"[[/B]]");} });
    text=text.replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
    const html=text.split("[[B]]").join("<b>").split("[[/B]]").join("</b>");
    return {html, found, changed:found>0, empty:!text};
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
    const always=[wireScrollCTAs,tickerLoop];
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
    let ran=false;
    function show(){ const raw=inEl.value;
      if(!raw.trim()){ out.textContent='Paste or pick a sample, then press “Set in plain English”.'; jc.textContent='0'; return; }
      const res=clarify(raw); jc.textContent=res.found;
      if(!res.changed){ out.innerHTML='Already plain English — nothing to clear here. Try a sample →'; return; }
      const html='You: '+res.html.charAt(0).toUpperCase()+res.html.slice(1);
      if(noMotion){ out.innerHTML=html; return; }
      gsap.set(scan,{opacity:1,top:-50}); gsap.to(scan,{top:'110%',duration:.9,ease:EASE.sweep,onComplete:()=>gsap.to(scan,{opacity:0,duration:.2})});
      const words=html.split(' ');out.innerHTML='';let i=0;
      gsap.to({n:0},{n:words.length,duration:1.1,ease:'none',delay:.2,onUpdate:function(){const k=Math.round(this.targets()[0].n);if(k!==i){i=k;out.innerHTML=words.slice(0,k).join(' ');}}});
    }
    go.addEventListener('click',show);
    $$('.byof .qf').forEach(q=>q.addEventListener('click',()=>{inEl.value=q.dataset.fill;show();}));
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
    btns.forEach(b=>b.addEventListener('click',()=>{ btns.forEach(x=>x.setAttribute('aria-pressed','false')); b.setAttribute('aria-pressed','true');
      const yr=b.dataset.cycle==='yr'; cue.hidden=!yr;
      amts.forEach(a=>{ const v=yr?a.dataset.yr:a.dataset.mo;
        if(noMotion){a.textContent='$'+v;} else {const o={v:parseInt(a.textContent.replace(/\D/g,''))||0};gsap.to(o,{v:+v,duration:DUR.base,ease:'power2.out',onUpdate:()=>a.textContent='$'+Math.round(o.v)});} }); }));
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
          downloadDraftBtn=$('#downloadDraftBtn');
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
    function gradeLevel(text){ const words=(text.match(/\b[\w'-]+\b/g)||[]); const sents=text.split(/[.!?]+/).filter(s=>s.trim());
      const wps=words.length/Math.max(1,sents.length); const longish=words.filter(w=>w.length>=8).length/Math.max(1,words.length);
      return Math.max(4,Math.min(18,Math.round(4 + wps*0.45 + longish*22))); }
    function trunc(s,n){ s=s.trim(); return s.length>n? s.slice(0,n)+'…' : s; }
    function esc(s){ return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
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
      if(btn){ btn.setAttribute('aria-busy','true'); btn.dataset.label=btn.textContent; btn.textContent='Reading…'; }
      const finish=()=>{ if(btn){ btn.removeAttribute('aria-busy'); btn.textContent=btn.dataset.label||'Analyze →'; } try{ render(raw); }catch(e){ console.error(e); msg.textContent="Couldn't read that — try pasting plain text."; msg.className='analyze-msg err'; } };
      if(noMotion) finish(); else setTimeout(finish, 600);
    }
    function render(raw){
      const sentences=splitSentences(raw); lastSentences=sentences; lastRaw=raw;
      // 1) plain-english rewrite
      let html='', totalJargon=0;
      sentences.forEach(s=>{ const r=clarify(s); totalJargon+=r.found; html+='<p>'+(r.changed?r.html:esc(s))+'</p>'; });
      plainOut.innerHTML=html || '<p>'+esc(raw)+'</p>';
      if(jargonCount) jargonCount.textContent=totalJargon;
      // 2) reading level
      const before=gradeLevel(raw); const after=Math.max(5,Math.min(before-2,gradeLevel(plainOut.textContent)));
      if(levelFrom) levelFrom.textContent=before+'th'; if(levelTo) levelTo.textContent=after+'th';
      // 3) risk radar
      const flags=[]; sentences.forEach((s,i)=>{ for(const rule of RISK){ if(rule.re.test(s)){ flags.push({i,s,rule}); break; } } });
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
      if(draftOut){
        draftOut.value=buildDraft(raw, flags);
        if(draftNote) draftNote.textContent='Ready-to-edit draft. Fill in names, dates, and contact details before sending.';
      }
      if(!noMotion && window.gsap) gsap.from('#riskList .rrow',{opacity:0,y:12,stagger:.07,duration:DUR.base,ease:EASE.enter});
      // reveal results
      if(emptyEl) emptyEl.hidden=true; panel.hidden=false; if(askOut) askOut.innerHTML='';
      if(!noMotion && window.gsap) gsap.fromTo(panel,{opacity:0,y:14},{opacity:1,y:0,duration:DUR.base,ease:EASE.enter});
      if(askInput) askInput.disabled=false; if(askBtn) askBtn.disabled=false;
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
      if(/deposit|security/.test(lowerQ) && /forfeit|security deposit|non-refundable|non refundable/.test(lowerDoc)){
        const notice=/sixty|60/.test(lowerDoc)?' The document points to a 60-day written-notice condition.':'';
        return {text:"Not automatically. If you met the notice requirement and there are no valid damage deductions, this text does not clearly say they can keep 100% of your deposit."+notice+" If you missed that condition, it gives them language to argue forfeiture, so ask for the exact reason and an itemized deduction list.", cite:best};
      }
      if(/refund|back|return|get.*fee|money/.test(lowerQ) && /non[-\s]?refundable|non refundable|forfeit/.test(lowerDoc)){
        const refundSentence=lastSentences.find((s)=>/non[-\s]?refundable|non refundable|forfeit/i.test(s));
        return {text:"Probably not based on this wording. The document says the relevant fee or charge is non-refundable, so you should ask the college for a written refund policy or exception before assuming you will get it back.", cite:refundSentence?{s:refundSentence,i:lastSentences.indexOf(refundSentence)}:best};
      }
      if(/cancel|terminate|early/.test(lowerQ) && /early termination|remaining charges|cancel/.test(lowerDoc)){
        return {text:"Probably not without cost. The document appears to say early termination can trigger the remaining charges or a cancellation assessment, so ask for the exact clause and the dollar calculation before agreeing.", cite:best};
      }
      if(/liable|responsible|pay|owe|cost|fee/.test(lowerQ)){
        return {text:best?"The closest sentence says: "+best.s:"I do not see a clear liability answer in the text. Look for words like liable, responsible, indemnify, fee, penalty, or assessment.", cite:best};
      }
      return {text:best?"The closest supported answer is based on this sentence: "+best.s:"I could not find that directly in the document. It may be implied, missing, or worded differently.", cite:best};
    }
    async function ask(){
      const q=(askInput&&askInput.value||'').trim(); if(!q) return;
      if(!lastSentences.length){ askOut.innerHTML='Analyze a document first, then ask about it.'; return; }
      const local=localAnswer(q);
      askOut.innerHTML='<span class="think" style="display:inline-flex"><i></i><i></i><i></i></span> Asking Gemini…';
      if(askBtn) askBtn.disabled=true;
      let answered=false;
      try{
        const res=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          question:q,
          document:lastRaw.slice(0,30000),
          rewrite:plainOut?plainOut.textContent.slice(0,6000):'',
          risks:lastFlags.map(f=>({sentence:f.s,reason:f.rule.why,label:f.rule.label})).slice(0,12),
          fileName:attachedFile&&attachedFile.name
        })});
        const data=await res.json().catch(()=>({}));
        if(res.ok && data.answer){
          const cite=data.citation?'<div class="cite" style="opacity:1">'+esc(data.citation)+'</div>':'';
          askOut.innerHTML='<div class="ans-line">'+esc(data.answer)+'</div>'+cite;
          answered=true;
        }
      }catch(_){}
      if(!answered){
        const cite=local.cite?'<div class="cite" style="opacity:1">local fallback · sentence '+(local.cite.i+1)+' of '+lastSentences.length+'</div>':'<div class="cite" style="opacity:1">local fallback</div>';
        askOut.innerHTML='<div class="ans-line">'+esc(local.text)+'</div>'+cite;
      }
      if(askBtn) askBtn.disabled=false;
    }
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

    if(btn) btn.addEventListener('click',analyze);
    if(clearBtn) clearBtn.addEventListener('click',()=>{ input.value=''; lastSentences=[]; lastFlags=[]; lastRaw=''; if(panel)panel.hidden=true; if(emptyEl)emptyEl.hidden=false; if(msg){msg.textContent='';msg.className='analyze-msg';} clearAttachments(); input.focus(); });
    $$('.qf[data-fill]').forEach(q=>q.addEventListener('click',()=>{ input.value=q.dataset.fill; clearAttachments(); if(panel)panel.hidden=true; if(emptyEl)emptyEl.hidden=false; if(msg){msg.textContent='Sample loaded. Press Analyze when ready.';msg.className='analyze-msg';} }));
    if(copyDraftBtn) copyDraftBtn.addEventListener('click',async()=>{ if(!draftOut||!draftOut.value)return; try{ await navigator.clipboard.writeText(draftOut.value); copyDraftBtn.textContent='Copied'; setTimeout(()=>copyDraftBtn.textContent='Copy draft',1400); }catch(_){ draftOut.focus(); draftOut.select(); } });
    if(downloadDraftBtn) downloadDraftBtn.addEventListener('click',()=>{ if(!draftOut||!draftOut.value)return; const url=URL.createObjectURL(new Blob([draftOut.value],{type:'text/plain'})); const a=document.createElement('a'); a.href=url; a.download='cleardoc-response-draft.txt'; a.click(); URL.revokeObjectURL(url); });

    /* ---- FILE ATTACHMENT — accepts text, PDF, images & common office formats ---- */
    const TEXT_EXT=/\.(txt|text|md|markdown|csv|tsv|log|json|xml|html?|rtf)$/i;
    const IMG_EXT=/\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif|tiff?)$/i;
    const PDF_EXT=/\.pdf$/i;
    function fmtSize(b){ if(b<1024)return b+' B'; if(b<1048576)return Math.round(b/1024)+' KB'; return (b/1048576).toFixed(1)+' MB'; }
    function extOf(n){ const m=/\.([a-z0-9]+)$/i.exec(n); return m?m[1].toUpperCase():'FILE'; }
    function kindOf(n){ if(IMG_EXT.test(n))return'img'; if(PDF_EXT.test(n))return'pdf'; if(/\.(docx?|odt|pages)$/i.test(n))return'doc'; return'txt'; }
    function clearAttachments(){ if(!attachTray)return; chipUrls.forEach(u=>{try{URL.revokeObjectURL(u);}catch(_){}}); chipUrls=[]; attachedText=''; attachedFile=null; attachTray.innerHTML=''; attachTray.hidden=true; if(fileInput)fileInput.value=''; }
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
    function handleFile(file){ if(!file||!attachTray)return; attachedFile=file; attachedText=''; const chip=makeChip(file); const n=file.name;
      if(PDF_EXT.test(n)) readPdf(file,chip);
      else if(IMG_EXT.test(n)){ setSub(chip,'warn','Image attached · add text/context, then Analyze'); prepareForAttachment(); }
      else if(TEXT_EXT.test(n)||(file.type&&file.type.indexOf('text')===0)) readText(file,chip);
      else if(/\.(docx?|odt|pages)$/i.test(n)) setSub(chip,'warn','Office doc attached · paste the text to analyze');
      else readText(file,chip);
    }
    if(fileInput) fileInput.addEventListener('change',e=>{ const f=e.target.files&&e.target.files[0]; if(f) handleFile(f); });
    if(askBtn) askBtn.addEventListener('click',ask);
    if(askInput) askInput.addEventListener('keydown',e=>{ if(e.key==='Enter') ask(); });
  }

})();
