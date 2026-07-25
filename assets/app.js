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

  // Compact "time ago" formatter for the history panel. Picks the
  // largest sensible unit so users see "just now" / "5m ago" /
  // "2h ago" / "yesterday" / "3d ago" — the standard pattern in
  // chat / email clients. Falls back to a short date string once
  // the difference crosses 7 days. Defensive on bad input.
  //   formatRelativeTime(Date.now() - 30*1000)   → 'just now'
  //   formatRelativeTime(Date.now() - 5*60*1000) → '5m ago'
  //   formatRelativeTime(Date.now() - 2*3600e3)  → '2h ago'
  //   formatRelativeTime(yesterday)              → 'yesterday'
  //   formatRelativeTime(Date.now() - 3*86400e3) → '3d ago'
  //   formatRelativeTime(very old)               → '7/15/2025'
  function detectLanguage(text){
    const t = String(text||'').toLowerCase();
    if (!t || t.length < 12) return null;
    // Distinctive-word fingerprints per language. Picked words that
    // are highly characteristic (function words + common legalese
    // terms) so a 50-word sample is enough to discriminate.
    const sigs = {
      es: { words: /\b(este|esta|para|con|los|las|del|por|como| pero|porque|tiene|son|mas|más| días|años|mes|arrendamiento|alquiler|indemnizar|seguro|factura|recibo|cláusula)\b/g, label: 'Spanish', tts: 'es-ES' },
      fr: { words: /\b(ce|les|des|est|une|avec|pour|dans|que|mais|qui|sur|vous|nous|son|tout|trois|jours|mois|ans|loyer|assurance|facture|reçu|clause|résiliation)\b/g, label: 'French', tts: 'fr-FR' },
      de: { words: /\b(der|die|das|den|mit|für|auf|von|dem|des|ein|eine|nicht|auch|wird|sind|jahre|monat|tag|miete|versicherung|rechnung|quittung|kündigung)\b/g, label: 'German', tts: 'de-DE' },
      it: { words: /\b(che|per|con|sono|come|più|degli|della|questo|questa|sono|anni|mese|giorni|affitto|assicurazione|fattura|ricevuta|clausola)\b/g, label: 'Italian', tts: 'it-IT' },
      pt: { words: /\b(este|esta|para|com|os|as|do|da|por|mas|não|são|anos|mês|dias|aluguel|seguro|fatura|recibo|cláusula|rescisão)\b/g, label: 'Portuguese', tts: 'pt-BR' },
      en: { words: /\b(the|this|that|with|for|from|are|was|were|will|would|should|days|years|month|rent|insurance|invoice|receipt|clause|landlord|tenant)\b/g, label: 'English', tts: 'en-US' },
    };
    let best = null;
    for(const code of Object.keys(sigs)){
      const hits = (t.match(sigs[code].words) || []).length;
      if (hits === 0) continue;
      if (!best || hits > best.count){
        best = { code, hits, label: sigs[code].label, tts: sigs[code].tts, count: hits };
      }
    }
    // Require at least 2 hits to claim a language — single hits
    // would over-claim (e.g. "the" appears in many languages).
    if (!best || best.count < 2) return null;
    return best;
  }

  function formatRelativeTime(ts){
    if(typeof ts !== 'number' || !Number.isFinite(ts)) return '';
    const diff = Date.now() - ts;
    if(diff < 0) return 'just now'; // future ts (clock skew) — don't say "-5m ago"
    if(diff < 60 * 1000) return 'just now';
    const minutes = Math.floor(diff / 60000);
    if(minutes < 60) return minutes + 'm ago';
    const hours = Math.floor(diff / 3600000);
    if(hours < 24) return hours + 'h ago';
    const days = Math.floor(diff / 86400000);
    if(days === 1) return 'yesterday';
    if(days < 7) return days + 'd ago';
    // Older than a week — fall back to a short date string. toLocaleDateString
    // without options gives "7/15/2025" on most locales.
    return new Date(ts).toLocaleDateString();
  }

  // Structural summary of the input — sentence count, paragraph
  // count, average + longest sentence length in words. Lives at the
  // IIFE level so it's available to the analyzer page. Defensive on
  // every step: empty input → null (caller hides the summary line).
  //   summarizeStructure("")
  //     → null
  //   summarizeStructure("Hello world. This is a test.")
  //     → {sentences:2, paragraphs:1, avgWords:3, longestWords:4}
  //   summarizeStructure("P1.\n\nP2 sentence one. P2 sentence two.")
  //     → {sentences:3, paragraphs:2, avgWords:3, longestWords:4}
  function summarizeStructure(text){
    const t = String(text||'').trim();
    if (!t || t.length < 8) return null;
    // Sentence split: terminal punctuation + whitespace. Defensive
    // against runs of terminators ("Wait... Really?!" → 2 sentences).
    const sentences = t.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 1);
    if (sentences.length === 0) return null;
    // Paragraph split: blank-line separated. A single newline is a
    // hard line wrap (often used in legal docs), not a paragraph.
    const paragraphs = t.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    // Word counts per sentence
    const wordCounts = sentences.map(s => {
      const m = s.match(/\b[\w'-]+\b/g);
      return m ? m.length : 0;
    });
    const totalWords = wordCounts.reduce((a, b) => a + b, 0);
    const avgWords = Math.round(totalWords / sentences.length);
    const longestWords = wordCounts.reduce((a, b) => Math.max(a, b), 0);
    return {
      sentences: sentences.length,
      paragraphs: Math.max(paragraphs.length, 1),
      avgWords,
      longestWords,
    };
  }

  // Compare-time diff helper — splits two texts into sentences and
  // returns the sentences unique to each side. Used by the compare
  // panel to surface "what's actually different" beyond the score.
  // Matches are normalized (lowercased, whitespace-collapsed) so
  // casing and line-wrap differences don't cause false splits.
  //   diffSentences("A. B. C.", "A. D.") → {onlyA:["B","C"], onlyB:["D"]}
  //   diffSentences("", "anything")      → {onlyA:[], onlyB:["anything"]}
  function diffSentences(a, b){
    const split = (s) => String(s||'')
      .split(/(?<=[.!?])\s+/)
      .map(x => x.replace(/\s+/g, ' ').trim().toLowerCase())
      .filter(x => x.length > 3);
    const sa = split(a), sb = split(b);
    const setB = new Set(sb);
    const setA = new Set(sa);
    const onlyA = sa.filter(x => !setB.has(x));
    const onlyB = sb.filter(x => !setA.has(x));
    // Preserve original casing for display
    const orig = (s, src) => {
      const t = String(s||'').split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(x => x.length > 3);
      return t.filter(x => x.replace(/\s+/g,' ').trim().toLowerCase() === s) || [];
    };
    // Map the unique normalized forms back to their original-cased
    // source sentences by re-splitting the raw input. Cheap (small N).
    const displayFromRaw = (raw, normalizedList) => {
      const rawSplit = String(raw||'').split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(x => x.length > 3);
      const seen = new Set();
      const out = [];
      for(const orig of rawSplit){
        const k = orig.replace(/\s+/g,' ').trim().toLowerCase();
        if(normalizedList.indexOf(k) >= 0 && !seen.has(k)){
          seen.add(k);
          out.push(orig);
          if(out.length >= 5) break; // cap at 5 per side — no flooding
        }
      }
      return out;
    };
    return {
      onlyA: displayFromRaw(a, onlyA),
      onlyB: displayFromRaw(b, onlyB),
      shared: sa.length - onlyA.length, // = sb.length - onlyB.length
    };
  }

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

  // Document-type detection — labels the input as a lease, medical bill,
  // terms of service, etc., so users orient before clicking Analyze.
  // Each type is keyed off 2-4 distinctive phrases that are highly
  // unlikely to co-occur in other doc types. We score by total matched
  // keyword count and return the highest-scoring type, with a
  // confidence floor (≥2 matches) so the badge only appears when we're
  // actually confident — better to say nothing than mislabel.
  //   detectDocType("")                                      → null
  //   detectDocType("Tenant shall pay rent to the lessor…")   → {name:'lease', label:'Lease', confidence:'high', matches:3}
  //   detectDocType("This subscription auto-renews monthly…") → {name:'subscription', label:'Subscription', confidence:'high', matches:2}
  //   detectDocType("hello world foo bar baz")               → null  (only 1 weak match — below confidence floor)
  const DOC_TYPES = [
    { name: 'lease',          label: 'Lease',          patterns: [/\b(landlord|lessor|lessee|tenant|security deposit|premises|rent)\b/gi, /\b(eviction|lease term|monthly rent|square (feet|footage))\b/gi] },
    { name: 'medical',        label: 'Medical Bill',   patterns: [/\b(medical bill|insurance|EOB|copay|coinsurance|deductible|provider)\b/gi, /\b(patient|CPT|ICD|balance bill|facility fee)\b/gi] },
    { name: 'subscription',   label: 'Subscription',   patterns: [/\b(auto[- ]?renew|subscription|billing (cycle|period)|monthly fee|cancel anytime)\b/gi, /\b(free trial|prorat|refund)\b/gi] },
    { name: 'employment',     label: 'Employment',     patterns: [/\b(employee|employer|salary|wages|at-will|non[- ]?compete|severance)\b/gi, /\b(overtime|promotion|probation|stock option)\b/gi] },
    { name: 'loan',           label: 'Loan',           patterns: [/\b(loan|principal|interest rate|mortgage|lender|borrower)\b/gi, /\b(repayment|amortiz|collateral|default|escrow)\b/gi] },
    { name: 'privacy',        label: 'Privacy Policy', patterns: [/\b(privacy policy|personal (data|information)|cookies|gdpr|ccpa)\b/gi, /\b(data (collection|sharing|retention)|third[- ]?party|opt[- ]?out)\b/gi] },
    { name: 'terms',          label: 'Terms of Service', patterns: [/\b(terms of (service|use)|acceptable use|prohibited|content)\b/gi, /\b(intellectual property|indemnif|limitation of liability|warranty)\b/gi] },
    { name: 'insurance',      label: 'Insurance',      patterns: [/\b(insurance|claim|coverage|policyholder|premium|deductible)\b/gi, /\b(adjuster|denial|appeal|underwrit|exclusion)\b/gi] },
    { name: 'debt',           label: 'Debt Collection', patterns: [/\b(debt|collection|past due|delinquent|creditor)\b/gi, /\b(minimum payment|settlement|charge[- ]?off|wage garnishment)\b/gi] },
    { name: 'tax',            label: 'Tax',            patterns: [/\b(IRS|tax return|adjusted gross|taxable income|filing)\b/gi, /\b(audit|deduction|withhold|1099|W-?2|estimated tax)\b/gi] },
  ];

  // Per-type "what to look for" tips — shown below the type badge so
  // users learn the vocabulary of traps BEFORE they hit Analyze. Each
  // tip is a short, scannable list of the 3-4 most common trap clauses
  // in that document category. Tips are hand-curated, not auto-generated,
  // so each one is something a lawyer or paralegal would actually point
  // out — not a guess from the keyword patterns.
  //   getDocTypeTip('lease')    → 'early-termination fees, security-deposit traps, rent escalation'
  //   getDocTypeTip('medical')  → 'balance billing, facility fees, upcoding, out-of-network charges'
  //   getDocTypeTip('unknown')  → null
  const DOC_TYPE_TIPS = {
    lease:        'early-termination fees, security-deposit traps, rent escalation, subletting bans',
    medical:      'balance billing, facility fees, upcoding, surprise out-of-network charges',
    subscription: 'auto-renewal clauses, free-trial → paid traps, cancellation friction, price-change rights',
    employment:   'non-compete scope, IP assignment, at-will waivers, severance limits, arbitration',
    loan:         'prepayment penalties, variable-rate resets, balloon payments, default triggers',
    privacy:      'data-sharing with third parties, arbitration clauses, opt-out friction, retention periods',
    terms:        'unilateral changes, IP license grants, class-action waivers, indemnification, warranty disclaimers',
    insurance:    'coverage exclusions, claim-denial procedures, network restrictions, pre-authorization traps',
    debt:         'validation rights, statute of limitations, settlement pitfalls, wage-garnishment exposure',
    tax:          'filing deadlines, estimated-tax underpayment, audit triggers, deduction limits',
  };
  function getDocTypeTip(name){
    if(!name || typeof name !== 'string') return null;
    return DOC_TYPE_TIPS[name] || null;
  }

  // Live deadline preview — finds date / "by X days" / "before [date]"
  // patterns in the input as the user types. Same regex shape as the
  // AI-side deadline extractor, so what we count here is what the
  // analyze panel will surface. Each pattern produces { match, kind,
  // urgencyDays, label }. urgencyDays < 0 means already past (red);
  // < 7 = urgent (danger); < 30 = soon (amber); else = future (ink).
  //   extractDeadlines("within 30 days of signing.")
  //     → [{match:'within 30 days', kind:'relative', urgencyDays:30,
  //         label:'in 30 days'}]
  //   extractDeadlines("") → []
  const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  // (month, day, year) e.g. "January 15, 2026" or "Jan 15 2026"
  const DATE_PATTERNS = [
    // "January 15, 2026" / "Jan 15, 2026" / "January 15 2026"
    { re: /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi, kind: 'absolute' },
    // "by 2026-01-15" / "2026/01/15"
    { re: /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g, kind: 'iso' },
    // "within N days" / "in N days" / "N-day notice"
    { re: /\b(?:within|in|after|before|by)\s+(\d{1,3})\s+(?:days?|business\s+days?)\b/gi, kind: 'relative' },
    { re: /\b(\d{1,3})[- ](?:day|days?)[\s-]+(?:notice|window|period)\b/gi, kind: 'relative-notice' },
  ];
  function _parseAbsoluteDate(month, day, year){
    const mi = MONTHS.indexOf(month.toLowerCase().slice(0,3));
    if (mi < 0) return null;
    const d = parseInt(day, 10), y = parseInt(year, 10);
    if (!d || d < 1 || d > 31) return null;
    if (!y || y < 1900 || y > 2200) return null;
    return new Date(y, mi, d);
  }
  function _urgencyFromDate(dt){
    if (!dt || isNaN(dt.getTime())) return null;
    const ms = dt.getTime() - Date.now();
    return Math.round(ms / (1000 * 60 * 60 * 24));
  }
  function extractDeadlines(text){
    const t = String(text||'');
    if (!t || t.length < 8) return [];
    const out = [];
    const seen = new Set();
    for (const p of DATE_PATTERNS) {
      // Reset lastIndex between patterns (regex with /g flag is stateful)
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(t)) !== null) {
        let dt = null, label = m[0].trim();
        if (p.kind === 'absolute') {
          dt = _parseAbsoluteDate(m[1], m[2], m[3]);
          if (dt) label = m[1] + ' ' + m[2] + ', ' + m[3];
        } else if (p.kind === 'iso') {
          dt = new Date(parseInt(m[1],10), parseInt(m[2],10)-1, parseInt(m[3],10));
          if (dt) label = m[1] + '-' + m[2].padStart(2,'0') + '-' + m[3].padStart(2,'0');
        } else if (p.kind === 'relative') {
          const n = parseInt(m[1], 10);
          if (!n) continue;
          dt = new Date(Date.now() + n * 86400000);
          label = 'in ' + n + ' day' + (n === 1 ? '' : 's');
        } else if (p.kind === 'relative-notice') {
          const n = parseInt(m[1], 10);
          if (!n) continue;
          dt = new Date(Date.now() + n * 86400000);
          label = n + '-day notice';
        }
        if (!dt) continue;
        // De-dupe by date (so "Jan 15" + "January 15" both match the same row)
        const key = dt.toISOString().slice(0,10);
        if (seen.has(key)) continue;
        seen.add(key);
        const urgency = _urgencyFromDate(dt);
        out.push({ match: m[0], label, date: dt, urgencyDays: urgency });
      }
    }
    // Sort by urgency ascending — past dates first (most urgent), then
    // soonest future date. Cap at 8 unique deadlines.
    out.sort((a, b) => a.urgencyDays - b.urgencyDays);
    return out.slice(0, 8);
  }

  // Format a Date as an iCalendar UTC stamp (YYYYMMDDTHHMMSSZ). The
  // 'Z' suffix marks UTC — required by RFC 5545 § 3.3.5 for DATE-TIME
  // values when no TZID is given. Defensive: returns null on bad input.
  //   _icsDateStamp(new Date('2026-01-15T12:00:00Z')) → '20260115T120000Z'
  //   _icsDateStamp(null) → null
  function _icsDateStamp(d){
    if (!d || isNaN(d.getTime())) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return d.getUTCFullYear() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) + 'T' +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds()) + 'Z';
  }

  // Build an ICS file string for a single all-day event marking a
  // deadline. Output is RFC 5545 compliant — Google / Apple / Outlook
  // all import it cleanly. CRLF line endings (RFC requirement); lines
  // are folded at 75 octets per the spec (we keep them short anyway).
  //   buildIcsForDate(new Date('2026-01-15'), 'Document deadline')
  //     → "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:...\r\n..."
  function buildIcsForDate(dt, summary){
    if (!dt || isNaN(dt.getTime())) return '';
    const stamp = _icsDateStamp(new Date());
    // Use VALUE=DATE (all-day event) for deadlines so users don't have
    // to set a time. Format YYYYMMDD (no T…Z suffix for all-day).
    const pad = (n) => String(n).padStart(2, '0');
    const dstart = dt.getUTCFullYear() + pad(dt.getUTCMonth() + 1) + pad(dt.getUTCDate());
    const uid = 'cleardoc-' + stamp + '-' + dstart + '@cleardoc.app';
    const safeSummary = String(summary || 'Document deadline')
      // RFC 5545 § 3.3.11 — escape commas, semicolons, backslashes, newlines
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n')
      .slice(0, 80);
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ClearDoc//Deadlines//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:' + uid,
      'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + dstart,
      'SUMMARY:' + safeSummary,
      'DESCRIPTION:Extracted from your document via ClearDoc (cleardoc.app)',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n') + '\r\n';
  }

  // Build a multi-event ICS file from an array of {date, label} pairs.
  // Returns '' if no valid dates. Each event gets its own VEVENT block
  // sharing one VCALENDAR wrapper — calendar apps import all events at
  // once. Caps at 50 events to avoid runaway ICS files (defensive).
  //   buildIcs([{date: new Date('2026-01-15'), label: 'in 30 days'},
  //             {date: new Date('2026-03-01'), label: 'in 75 days'}])
  //     → "BEGIN:VCALENDAR\r\n…\r\nBEGIN:VEVENT\r\n…\r\nEND:VEVENT\r\n
  //        BEGIN:VEVENT\r\n…\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
  function buildIcs(items){
    if(!Array.isArray(items) || items.length === 0) return '';
    const valid = items.filter(it => it && it.date && !isNaN(it.date.getTime())).slice(0, 50);
    if(valid.length === 0) return '';
    const stamp = _icsDateStamp(new Date());
    const pad = (n) => String(n).padStart(2, '0');
    const safeText = (s) => String(s || 'Document deadline')
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;')
      .replace(/,/g, '\\,').replace(/\n/g, '\\n').slice(0, 80);
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ClearDoc//Deadlines//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];
    valid.forEach((it, i) => {
      const dstart = it.date.getUTCFullYear() + pad(it.date.getUTCMonth() + 1) + pad(it.date.getUTCDate());
      // Per-event UID — same date can appear multiple times if the
      // user has multiple doc sources, so we suffix with the index.
      const uid = 'cleardoc-' + stamp + '-' + dstart + '-' + i + '@cleardoc.app';
      lines.push(
        'BEGIN:VEVENT',
        'UID:' + uid,
        'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + dstart,
        'SUMMARY:' + safeText('Document deadline: ' + it.label),
        'DESCRIPTION:Extracted from your document via ClearDoc (cleardoc.app)',
        'END:VEVENT'
      );
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }
  function detectDocType(text){
    const t = String(text||'').trim();
    if (!t || t.length < 20) return null;
    let best = null;
    for (const d of DOC_TYPES) {
      let m = 0;
      for (const re of d.patterns) {
        const hits = t.match(re);
        if (hits) m += hits.length;
      }
      // Confidence: 2-3 matches = "likely", 4+ = "high". 1 match is too
      // weak (single "tenant" mention in a credit-card terms doc would
      // be misleading), so we require ≥2.
      if (m < 2) continue;
      const conf = m >= 4 ? 'high' : 'likely';
      const candidate = { name: d.name, label: d.label, confidence: conf, matches: m };
      if (!best || m > best.matches) best = candidate;
    }
    return best;
  }

  function readTimeBand(text){
    const t = String(text||'').trim();
    if (!t) return null;
    const words = (t.match(/\b[\w'-]+\b/g) || []).length;
    if (words === 0) return null;
    const minutes = words / 250; // raw minutes, not rounded
    if (minutes < 1) return 'quick';
    if (minutes < 5) return 'standard';
    if (minutes < 15) return 'long';
    return 'marathon';
  }

  // Convert a numeric Flesch-Kincaid grade (4..18) to a human-friendly
  // label so the analyzer doesn't read like a school grade report.
  // "12th" makes users feel judged; "College" is descriptive of the
  // document, not the reader. Bands match the conventional US school
  // grade ranges so users can mentally translate back to the numeric.
  //   friendlyGrade(4)  → 'Elementary'
  //   friendlyGrade(7)  → 'Middle school'
  //   friendlyGrade(10) → 'High school'
  //   friendlyGrade(13) → 'College'
  //   friendlyGrade(16) → 'Graduate'
  //   friendlyGrade(null) → null
  function friendlyGrade(n){
    if(typeof n !== 'number' || !Number.isFinite(n)) return null;
    if (n <= 5) return 'Elementary';
    if (n <= 8) return 'Middle school';
    if (n <= 12) return 'High school';
    if (n <= 15) return 'College';
    return 'Graduate';
  }

  // Density band for the friendly-grade label — drives the color cue
  // (lighter = simpler doc, darker = denser). Matches how the
  // readTimeBand works: a friendly visual cue that scales with how
  // hard the doc will be to read.
  //   gradeDensity(4)  → 'easy'        (green — plain English)
  //   gradeDensity(10) → 'standard'    (default ink — typical)
  //   gradeDensity(13) → 'dense'       (amber — college-level)
  //   gradeDensity(17) → 'very-dense'  (danger red — graduate-level)
  function gradeDensity(n){
    if(typeof n !== 'number' || !Number.isFinite(n)) return null;
    if (n <= 8) return 'easy';
    if (n <= 12) return 'standard';
    if (n <= 15) return 'dense';
    return 'very-dense';
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
  // showUndoChip — renders a small floating "↶ undo" control near
  // the textarea after a successful apply, so users can revert in
  // one click. Hidden on initial render. Reused by the apply path.
  // Iter #52: shows the count of applied suggestions so users see
  // how many changes will be reverted on click ("↶ undo 5" = 5
  // suggestions currently applied). One click still reverts ALL of
  // them — the count is just for transparency.
  // Iter #53: pairs the undo chip with a re-analyze chip so users
  // can immediately re-run the analysis on the modified document
  // and see the new (low) risk counts.
  // Iter #54: showAnalyzeToast — success message with risk delta
  // after re-analyze. "✓ 2 risks remaining (down from 7)".
  let _undoChip = null;
  let _reAnalyzeChip = null;
  let _analyzeToast = null;
  function showAnalyzeToast(text){
    if(!_analyzeToast){
      _analyzeToast = document.createElement('div');
      _analyzeToast.id = 'analyzeToast';
      _analyzeToast.className = 'analyze-toast';
      _analyzeToast.setAttribute('role','status');
      _analyzeToast.setAttribute('aria-live','polite');
      document.body.appendChild(_analyzeToast);
    }
    _analyzeToast.textContent = text;
    _analyzeToast.classList.remove('toast-out');
    _analyzeToast.classList.add('toast-in');
    clearTimeout(_analyzeToast._fadeTimer);
    _analyzeToast._fadeTimer = setTimeout(() => {
      _analyzeToast.classList.remove('toast-in');
      _analyzeToast.classList.add('toast-out');
    }, 3200);
  }

  // showTemplateSuggestion (iter #58) — one-click "Save as template?"
  // prompt that appears after a successful analysis. Smooth on-ramp
  // from analysis → saved template. Dismissable; user can always
  // open the templates panel manually to save later.
  function showTemplateSuggestion(raw){
    const input = document.getElementById('docInput');
    if(!input || !raw) return;
    // Remove any existing suggestion
    const existing = document.getElementById('tplSuggest');
    if(existing) existing.remove();
    const wrap = document.createElement('div');
    wrap.id = 'tplSuggest';
    wrap.className = 'tpl-suggest';
    wrap.setAttribute('role','status');
    wrap.setAttribute('aria-live','polite');
    wrap.innerHTML =
      '<span class="tpl-suggest-text">💾 Save as template for next time?</span>' +
      '<button type="button" class="tpl-suggest-yes" data-tpl-suggest-yes="1">Yes</button>' +
      '<button type="button" class="tpl-suggest-no" data-tpl-suggest-no="1">No</button>';
    document.body.appendChild(wrap);
    // Pre-fill a default name (type label if available)
    const detectedLang = input._detectedLang;
    const defaultName = detectedLang ? detectedLang.label + ' template' : 'My template';
    // Auto-dismiss after 12s (don't be annoying)
    clearTimeout(wrap._fadeTimer);
    wrap._fadeTimer = setTimeout(() => {
      wrap.classList.add('tpl-suggest-out');
      setTimeout(() => { if(wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 350);
    }, 12000);
    // Click handlers
    wrap.querySelector('[data-tpl-suggest-yes]').addEventListener('click', () => {
      const ok = saveTemplate(defaultName, raw, detectedLang ? detectedLang.label : null);
      wrap.classList.add('tpl-suggest-out');
      setTimeout(() => { if(wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 350);
      if(ok){
        showAnalyzeToast('✓ Template saved');
      } else {
        showAnalyzeToast('Template already exists');
      }
    });
    wrap.querySelector('[data-tpl-suggest-no]').addEventListener('click', () => {
      wrap.classList.add('tpl-suggest-out');
      setTimeout(() => { if(wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 350);
    });
  }
  function showUndoChip(){
    if(!_undoChip){
      _undoChip = document.createElement('button');
      _undoChip.type = 'button';
      _undoChip.id = 'applyUndoChip';
      _undoChip.className = 'apply-undo-chip';
      _undoChip.setAttribute('data-undo-apply', '1');
      _undoChip.title = 'Restore the input to its pre-apply state';
      _undoChip.hidden = true;
      // Insert near the textarea
      const input = document.getElementById('docInput');
      if(input && input.parentNode) input.parentNode.appendChild(_undoChip);
    }
    if(!_reAnalyzeChip){
      _reAnalyzeChip = document.createElement('button');
      _reAnalyzeChip.type = 'button';
      _reAnalyzeChip.id = 'reAnalyzeChip';
      _reAnalyzeChip.className = 're-analyze-chip';
      _reAnalyzeChip.setAttribute('data-re-analyze', '1');
      _reAnalyzeChip.textContent = '↻ Re-analyze';
      _reAnalyzeChip.title = 'Re-run the analysis on the modified document';
      _reAnalyzeChip.hidden = true;
      const input = document.getElementById('docInput');
      if(input && input.parentNode) input.parentNode.appendChild(_reAnalyzeChip);
      // Click → trigger the existing analyze() flow (iter #53) and
      // show a success toast with the risk-count delta (iter #54)
      // so users see "✓ 2 risks remaining (down from 7)".
      _reAnalyzeChip.addEventListener('click', () => {
        // Capture pre-analyze risk count (for the delta)
        const pre = (typeof matchRisks === 'function')
          ? matchRisks(input ? input.value : '').reduce((a, h) => a + (h ? 1 : 0), 0)
          : 0;
        const analyzeBtn = document.getElementById('analyzeBtn');
        if(!analyzeBtn) return;
        analyzeBtn.click();
        // After a short delay, compute the new count and show the delta.
        // The delay lets the analyze() flow finish updating
        // lastSentences + lastFlags before we read them.
        clearTimeout(_reAnalyzeChip._toastTimer);
        _reAnalyzeChip._toastTimer = setTimeout(() => {
          const post = (typeof matchRisks === 'function')
            ? matchRisks(input ? input.value : '').reduce((a, h) => a + (h ? 1 : 0), 0)
            : 0;
          if(post < pre){
            showAnalyzeToast('✓ ' + (post === 0 ? 'No' : post) + ' risk' +
              (post === 1 ? '' : 's') + ' remaining (down from ' + pre + ')');
          } else if(post === pre && post > 0){
            showAnalyzeToast('✓ ' + post + ' risk' + (post === 1 ? '' : 's') + ' (no change)');
          } else if(post > pre){
            showAnalyzeToast('⚠ ' + post + ' risk' + (post === 1 ? '' : 's') + ' (up from ' + pre + ')');
          } else {
            showAnalyzeToast('✓ No risks detected');
          }
        }, 800);
      });
    }
    // Count applied suggestions (iter #52) so users see "↶ undo N"
    // instead of just "↶ undo apply". Reads from the same
    // _appliedSuggestions set the apply path maintains.
    const input = document.getElementById('docInput');
    const count = (input && input._appliedSuggestions) ? input._appliedSuggestions.size : 0;
    if(count > 0){
      _undoChip.textContent = '↶ undo ' + count;
      _reAnalyzeChip.hidden = false;
    } else {
      _undoChip.textContent = '↶ undo apply';
      _reAnalyzeChip.hidden = true;
    }
    _undoChip.hidden = false;
  }

  // applyOneMatched — apply a single suggestion at the matched
  // token's position. Extracted from the iter #45 inline handler
  // so the iter #51 dry-run confirm can call it after the user
  // accepts. Pairs with the existing _undoSnapshot (single-row
  // overwrite is fine; multi-level undo would be overkill).
  function applyOneMatched(input, suggestion, matched, rcApply){
    if(!input || !suggestion || !matched) return;
    const raw = input.value || '';
    const idx = raw.toLowerCase().indexOf(matched.toLowerCase());
    if(idx < 0) return;
    if(!input._undoSnapshot) input._undoSnapshot = null;
    input._undoSnapshot = raw;
    const newValue = raw.slice(0, idx) + suggestion + raw.slice(idx + matched.length);
    input.value = newValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    try {
      input.focus();
      input.setSelectionRange(idx, idx + suggestion.length);
      input.classList.add('rd-flash');
      clearTimeout(input._rdFlashTimer);
      input._rdFlashTimer = setTimeout(() => {
        input.classList.remove('rd-flash');
      }, 1200);
    } catch(_){}
    showUndoChip();
    if(!input._appliedSuggestions) input._appliedSuggestions = new Set();
    input._appliedSuggestions.add(suggestion);
    if(rcApply){
      const row = rcApply.closest('.risk-counter');
      if(row) row.classList.add('rc-applied');
      rcApply.textContent = '✓ applied';
      rcApply.disabled = true;
      clearTimeout(rcApply._flashTimer);
      rcApply._flashTimer = setTimeout(() => { rcApply.textContent = 'applied'; }, 1400);
    }
  }

  // doApplyAll — apply each pending suggestion in sequence (called
  // after the iter #48 confirmation modal). Same logic as the inline
  // apply handler but extracted so the async confirm flow can call it
  // without re-pulling hits.
  function doApplyAll(pending, input, aaBtn){
    if(!pending || pending.length === 0 || !input) return;
    const before = input.value || '';
    input._undoSnapshot = before;
    let applied = 0;
    let workingText = before;
    for(const h of pending){
      if(!h.counter || !h.matched) continue;
      if(input._appliedSuggestions.has(h.counter)) continue;
      const idx = workingText.toLowerCase().indexOf(h.matched.toLowerCase());
      if(idx < 0) continue;
      workingText = workingText.slice(0, idx) + h.counter + workingText.slice(idx + h.matched.length);
      input._appliedSuggestions.add(h.counter);
      applied++;
    }
    if(applied === 0) return;
    input.value = workingText;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if(typeof updateTextStats === 'function') updateTextStats();
    showUndoChip();
    if(aaBtn){
      aaBtn.textContent = '✓ applied ' + applied;
      clearTimeout(aaBtn._flashTimer);
      aaBtn._flashTimer = setTimeout(() => { aaBtn.textContent = '✓ Apply all'; }, 1800);
    }
  }

  // Confirm modal — generic in-page dialog used by destructive
  // actions (e.g. iter #48's apply-all). Returns a Promise so the
  // caller can await the user's choice. Reuses the kb-modal CSS class
  // for visual consistency with the keyboard-shortcut help modal.
  function showConfirmModal(opts){
    return new Promise((resolve) => {
      const m = document.createElement('div');
      m.className = 'kb-modal apply-confirm-modal';
      m.setAttribute('role','dialog');
      m.setAttribute('aria-modal','true');
      m.setAttribute('aria-labelledby','acm-title');
      m.innerHTML =
        '<div class="kb-modal-bg" data-acm-bg="1"></div>' +
        '<div class="kb-modal-card apply-confirm-card">' +
          '<h2 id="acm-title" class="kb-modal-title">' + esc(opts.title || 'Confirm') + '</h2>' +
          '<div class="apply-confirm-body">' + (opts.bodyHtml || esc(opts.body || '')) + '</div>' +
          '<div class="apply-confirm-actions">' +
            '<button type="button" class="acm-btn acm-cancel" data-acm="0">Cancel</button>' +
            '<button type="button" class="acm-btn acm-confirm" data-acm="1">' + esc(opts.confirmLabel || 'Confirm') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(m);
      // Focus the confirm button (safer default for destructive actions)
      const confirmBtn = m.querySelector('.acm-confirm');
      if(confirmBtn) setTimeout(() => confirmBtn.focus(), 0);
      const close = (val) => {
        if(m.parentNode) m.parentNode.removeChild(m);
        resolve(val);
      };
      m.addEventListener('click', (e) => {
        if(e.target.matches('[data-acm]')) close(e.target.getAttribute('data-acm') === '1');
        else if(e.target.matches('[data-acm-bg]')) close(false);
      });
      m.addEventListener('keydown', (e) => {
        if(e.key === 'Escape') close(false);
        else if(e.key === 'Enter' && document.activeElement && document.activeElement.matches('.acm-confirm')) close(true);
      });
    });
  }

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
          shareBtn=$('#shareBtn'),speakBtn=$('#speakBtn'),
          voicePicker=$('#voicePicker'),risksAvoidedBadge=$('#risksAvoidedBadge'),
          shareBadgeBtn=$('#shareBadgeBtn'),resetBadgeBtn=$('#resetBadgeBtn'),
          badgeExplainBtn=$('#badgeExplainBtn'),savedVersionBadge=$('#savedVersionBadge'),
          savedVersionSelect=$('#savedVersionSelect'),savedVersionSnippet=$('#savedVersionSnippet'),
          versionHistoryBtn=$('#versionHistoryBtn'),riskTrendBtn=$('#riskTrendBtn'),
          playbookBtn=$('#playbookBtn'),recentStats=$('#recentStats'),
          famousContractBtn=$('#famousContractBtn'),voicePreviewBtn=$('#voicePreviewBtn'),
          restoreBanner=$('#restoreBanner'),restoreDocName=$('#restoreDocName'),
          restoreWhen=$('#restoreWhen'),restoreBtn=$('#restoreBtn'),dismissRestoreBtn=$('#dismissRestoreBtn'),
          shareBanner=$('#shareBanner'),shareDocName=$('#shareDocName'),
          viewShareBtn=$('#viewShareBtn'),dismissShareBtn=$('#dismissShareBtn'),
          textStats=$('#textStats'),statWords=$('#statWords'),statChars=$('#statChars'),
          statReadTime=$('#statReadTime'),statLevel=$('#statLevel'),statFriendly=$('#statFriendly'),statCap=$('#statCap'),
          statDocType=$('#statDocType'),docTypeTip=$('#docTypeTip'),docTypeTipText=$('#docTypeTipText'),
          docSummary=$('#docSummary'),dsSentences=$('#dsSentences'),dsSentenceS=$('#dsSentenceS'),
          dsParagraphs=$('#dsParagraphs'),dsParagraphS=$('#dsParagraphS'),
          dsAvgWords=$('#dsAvgWords'),dsLongest=$('#dsLongest'),dsLang=$('#dsLang'),
          dsJargon=$('#dsJargon'),dsJargonCount=$('#dsJargonCount'),dsJargonS=$('#dsJargonS'),
          dsJargonPreview=$('#dsJargonPreview'),
          deadlinesPreview=$('#deadlinesPreview'),deadlinesCount=$('#deadlinesCount'),
          deadlinesPlural=$('#deadlinesPlural'),deadlinesSoonest=$('#deadlinesSoonest'),
          deadlinesTimeline=$('#deadlinesTimeline'),
          deadlinesCalBtn=$('#deadlinesCalBtn'),deadlinesSpeakBtn=$('#deadlinesSpeakBtn'),
          compareToggle=$('#compareToggle'),comparePanel=$('#comparePanel'),
          inputB=$('#docInputB'),compareStats=$('#compareStats'),
          compareVerdict=$('#compareVerdict'),compareDiff=$('#compareDiff'),
          comparePngBtn=$('#comparePngBtn'),
          micBtn=$('#micBtn'),
          historyBtn=$('#historyBtn'),historyPanel=$('#historyPanel'),
          historyList=$('#historyList'),historyClearBtn=$('#historyClearBtn'),
          historyFilter=$('#historyFilter'),
          tplBtn=$('#tplBtn'),tplPanel=$('#tplPanel'),tplList=$('#tplList'),
          tplNameInput=$('#tplNameInput'),tplSaveBtn=$('#tplSaveBtn'),tplClearBtn=$('#tplClearBtn'),
          riskPreview=$('#riskPreview'),riskCount=$('#riskCount'),riskDetail=$('#riskDetail'),
          watchWrap=$('#watchWrap'),watchCount=$('#watchCount'),watchS=$('#watchS'),
          noteWrap=$('#noteWrap'),noteCount=$('#noteCount'),noteS=$('#noteS');
    const sampleText=input.value.trim();

    // trap/risk patterns — severity g(note) a(watch) r(trap)
    const RISK=[
      {re:/in perpetuity|perpetual|survive (the )?termination/i, sev:'r', label:'Trap', why:'Never expires — there is no time limit.',
        counter:'Limit this clause to a fixed term (e.g. 2 years) or to claims discovered within 12 months of termination.',
        tip:'A fixed-term liability cap limits your worst-case exposure to a known amount and timeframe. Insurers and courts both expect this — the "perpetual" wording is a holdover from old commercial-paper drafting, not a real risk-shifting term.'},
      {re:/indemnif|hold\s+\w*\s*harmless/i, sev:'r', label:'Trap', why:"You may have to cover the other side's losses, including legal fees.",
        counter:'Narrow to "mutual indemnification" (both sides cover their own losses) and cap at the value of the contract.',
        tip:'One-sided indemnification is unusual outside enterprise contracts. Mutual indemnity is the industry norm — it puts both parties on the same footing and is much easier to get accepted than a flat cap.'},
      {re:/waiv\w*.{0,30}(jury|class action)|class action waiver|trial by jury/i, sev:'r', label:'Trap', why:'You give up the right to sue in court or join a class action.',
        counter:'Strike the class-action waiver entirely, or replace with "individual arbitration only" so a bad actor can still be held accountable.',
        tip:'Class-action waivers are unenforceable in many jurisdictions (California, NJ, etc.). The clause will likely be voided anyway, so removing it cleans the contract without weakening your real position.'},
      {re:/non[-\s]?refundable|forfeit|liquidated damages/i, sev:'r', label:'Trap', why:"Money you won't get back.",
        counter:'Replace with "refundable less reasonable administrative costs (capped at 10%)" — keeps the fee but gives you most of it back.',
        tip:'Forfeiture clauses are heavily disfavored by courts — they often get voided as "penalties" rather than "liquidated damages". Refundable-with-cap is more enforceable AND more useful to you.'},
      {re:/auto(matically)?\s*renew|evergreen|successive\s+\w+\s+terms|renew\w* for/i, sev:'a', label:'Watch', why:'Renews automatically unless you cancel in time.',
        counter:'Add "with 60-day prior written notice and ability to cancel via email" so you control the renewal, not the clock.',
        tip:'Auto-renewal is a revenue-protection tool for the seller. A 30-day prior-notice + email-cancel clause is the most common compromise — sellers accept it because churn is low either way.'},
      {re:/sole discretion|at any time|without (prior )?notice|reserves the right/i, sev:'a', label:'Watch', why:'The other party can change or act unilaterally.',
        counter:'Insert "with 30-day prior written notice and your right to terminate without penalty" so changes can\'t ambush you.',
        tip:'"Sole discretion" without notice is enforceable in many B2B contexts but heavily regulated in consumer law. Adding a notice requirement is a small ask that protects you from bad-faith unilateral changes.'},
      {re:/late fee|penalty|default interest|assessment/i, sev:'a', label:'Watch', why:'Extra charges may apply.',
        counter:'Cap late fees at the lesser of $25 or 5% of the overdue amount (the federal credit-card standard). Reject default-interest >10% APR.',
        tip:'Many US states cap late fees at 1-1.5% per month. Anything above 18% APR is potentially usurious under state law — pushing the contract below the usury threshold is in your favor.'},
      {re:/governing law|jurisdiction|venue|arbitration/i, sev:'g', label:'Note', why:'Sets which laws/forum apply if there is a dispute.',
        counter:'Negotiate "your home state" jurisdiction — companies prefer their home venue; you should too. Reject mandatory arbitration entirely if possible.',
        tip:'The seller picks their home venue for a reason: their lawyers are local, their precedents favor them. Pushing for your own state is a small ask that can save $50K+ in dispute-resolution costs if things go wrong.'},
      {re:/confidential|non-?disclosure|proprietary/i, sev:'g', label:'Note', why:'Restricts what you can share.',
        counter:'Add a "whistleblower carve-out" so you can disclose to regulators/law enforcement even if the NDA is broad. Standard in most jurisdictions.',
        tip:'Federal whistleblower law (Dodd-Frank, SEC, OSHA) already protects most disclosures to regulators. An explicit contract clause is belt-and-suspenders — and prevents the other side from arguing the NDA overrides federal law.'}
    ];
    // Count how many distinct RISK patterns the input matches, broken
    // down by severity. Same pattern source as the analyze path, so
    // the live preview is never out of sync with what Analyze will
    // actually flag. Each pattern counted at most once even if it
    // matches multiple times — "1 trap" is more useful to the user
    // than "8 hits on the indemnify regex".
    //   countRisksBySeverity("")                           → {trap:0, watch:0, note:0}
    //   countRisksBySeverity("The fee is non-refundable.") → {trap:1, watch:0, note:0}
    //   countRisksBySeverity("Auto-renews. Sole discretion. Non-refundable.")
    //                                                         → {trap:1, watch:2, note:0}
    function countRisksBySeverity(text){
      const t = String(text||'').trim();
      const out = { trap: 0, watch: 0, note: 0 };
      if (!t || t.length < 4) return out;
      for (const r of RISK) {
        if (!r || !r.re || !r.re.test(t)) continue;
        // Map severity code → out key. 'r' = trap (high), 'a' = watch
        // (amber/medium), 'g' = note (gray/low). Unknown codes fall
        // into 'note' as the safest default — the analyze path
        // surfaces them as gray notes anyway.
        if (r.sev === 'r') out.trap += 1;
        else if (r.sev === 'a') out.watch += 1;
        else out.note += 1;
      }
      return out;
    }

    // Return the RISK entries that actually matched the input, in RISK
    // declaration order (so traps surface before watches before notes).
    // Each item is { sev, label, why, matched: <substring from input> }
    // where `matched` is the first hit of the regex against the input
    // — useful for letting users see WHAT triggered the flag.
    //   matchRisks("Auto-renews. Non-refundable.")
    //     → [
    //         {sev:'a', label:'Watch', why:'Renews automatically…', matched:'Auto-renews'},
    //         {sev:'r', label:'Trap',  why:"Money you won't…", matched:'Non-refundable'},
    //       ]
    //   matchRisks("")  → []
    function matchRisks(text){
      const t = String(text||'').trim();
      const out = [];
      if (!t || t.length < 4) return out;
      for (const r of RISK) {
        if (!r || !r.re) continue;
        const m = r.re.exec(t);
        if (!m) continue;
        out.push({ sev: r.sev, label: r.label, why: r.why, matched: m[0], counter: r.counter || null });
      }
      return out;
    }

    // Render the expanded pattern list under the risk pill. One row
    // per matched pattern; rows are sorted trap → watch → note so the
    // loudest always reads first. The matched substring is shown in
    // mono so it visually pops as the smoking-gun token.
    //   renderRiskDetail([{sev:'r', label:'Trap', why:'…', matched:'non-refundable'}])
    //     → <div class="risk-detail-row trap">
    //         <span class="rd-tag">TRAP</span>
    //         <code class="rd-hit">non-refundable</code>
    //         <span class="rd-why">Money you won't get back.</span>
    //       </div>
    function renderRiskDetail(hits){
      if(!riskDetail) return;
      if(!Array.isArray(hits) || hits.length === 0){
        riskDetail.innerHTML = '<div class="risk-detail-empty">No patterns matched.</div>';
        return;
      }
      // Severity rank so trap floats to the top of the list.
      const rank = { r: 0, a: 1, g: 2 };
      const ordered = hits.slice().sort((a, b) => (rank[a.sev]||9) - (rank[b.sev]||9));
      // esc() lives in this same scope (analyzePage), defense-in-depth
      // so a matched substring can never inject HTML.
      const parts = [];
      // Copy button — exports the matched patterns as plain text so
      // users can paste into an email / doc without screenshotting.
      // Delegated to riskDetail (not bound per-render) so re-renders
      // during typing don't stack handlers.
      parts.push(
        '<div class="risk-detail-toolbar">',
          '<span class="rd-count">' + ordered.length + ' pattern' + (ordered.length === 1 ? '' : 's') + '</span>',
          // Iter #80: severity filter — let users narrow the list
          // to a single severity (power-user feature for focused
          // analysis). Default is "all" (no filter). The change
          // handler re-renders the risk list (iter #80 click handler).
          '<select class="rd-severity-filter mono" data-rd-severity-filter aria-label="Filter risks by severity" title="Filter risks by severity">',
            '<option value="">All severities</option>',
            '<option value="r">🔴 Traps only</option>',
            '<option value="a">🟡 Watches only</option>',
            '<option value="g">🟢 Notes only</option>',
          '</select>',
          '<button type="button" class="rd-apply-all" data-rd-apply-all="1" aria-label="Apply every suggestion in one click">✓ Apply all</button>',
          '<button type="button" class="rd-speak-suggestions" data-rd-speak-suggestions="1" aria-label="Read every suggestion aloud">🔊 Read all</button>',
          '<button type="button" class="rd-speak" data-rd-speak="1" aria-label="Read risks aloud">🔊</button>',
          '<button type="button" class="rd-redline" data-rd-redline="1" aria-label="Export redline suggestions">📝 redline</button>',
          '<button type="button" class="rd-copy" data-rd-copy="1" aria-label="Copy match list to clipboard">Copy</button>',
        '</div>'
      );
      for(const h of ordered){
        const sevClass = h.sev === 'r' ? 'trap' : (h.sev === 'a' ? 'watch' : 'note');
        const tagText = h.sev === 'r' ? 'TRAP' : (h.sev === 'a' ? 'WATCH' : 'NOTE');
        // data-rd-locate carries the matched substring verbatim so the
        // delegated click handler can find it in the source input. The
        // row is also tabindex=0 + role=button so keyboard users get
        // parity with mouse — Enter / Space triggers the same locate.
        // Iter #79: per-risk $ tooltip ("What would I save?") — uses
        // the same per-severity rates as the iter #62/65 badge so
        // the numbers stay consistent across all surfaces.
        const SAVINGS_PER = { r: 200, a: 50, g: 20 };
        const sev = h.sev === 'r' ? 'r' : (h.sev === 'a' ? 'a' : 'g');
        const rate = SAVINGS_PER[sev];
        const tooltip = '$' + rate + ' — this ' +
          (sev === 'r' ? 'trap' : sev === 'a' ? 'watch' : 'note') +
          ' could have cost you ~$' + rate + ' if you signed without ' +
          'seeing it. Click to highlight in the source.';
        parts.push(
          '<div class="risk-detail-row ' + sevClass + '" data-rd-locate="' + esc(h.matched || '') + '" tabindex="0" role="button" title="' + esc(tooltip) + '">',
            '<span class="rd-tag">' + tagText + '</span>',
            '<code class="rd-hit">' + esc(h.matched || '') + '</code>',
            '<span class="rd-why">' + esc(h.why || '') + '</span>',
          '</div>'
        );
        // Iter #79: "What would I save?" tooltip — per-risk-row
        // $ estimate of the cost it could have caused. Uses the
        // same per-severity rates as the iter #62/65 badge so
        // the numbers stay consistent across all surfaces.
        // Set the title on the LAST child of the risk-detail-row
        // so it shows on the whole row (incl. the tag + original
        // text) — matches the "where to find the cost" use case.
        // We append a title attribute to the row element.
        // (Actual tooltip text is set on the row below after escape)
        // Negotiation suggestion (iter #41) — for each risk, suggest
        // a counter-clause the user could propose. Shown as a sub-row
        // with a "→ suggest:" prefix so users see WHAT to ask for.
        if(h.counter){
          // data-rc-match carries the original matched substring so the
          // apply handler can find+replace it in the source input.
          // If the user already applied this suggestion, render the
          // row in its applied state (green checkmark, disabled button)
          // so they can see which suggestions they've used.
          const input = (typeof window !== 'undefined' && document.getElementById) ? document.getElementById('docInput') : null;
          const appliedSet = (input && input._appliedSuggestions) || null;
          const isApplied = appliedSet && appliedSet.has(h.counter);
          const rowCls = sevClass + (isApplied ? ' rc-applied' : '');
          const applyLabel = isApplied ? '✓ applied' : 'apply';
          const applyDisabled = isApplied ? ' disabled' : '';
          // Iter #74: optional "why this works" tip — pulled from
          // h.tip if the risk pattern provides one. Builds trust
          // by explaining the legal/business rationale, not just
          // the counter-clause text.
          const tip = h.tip ? '<button type="button" class="rc-tip" data-rc-tip="' +
            esc(h.tip) + '" aria-label="Why this works">💡</button>' : '';
          parts.push(
            '<div class="risk-counter ' + rowCls + '">',
              '<span class="rc-kicker">' + (isApplied ? '✓ applied:' : '→ suggest:') + '</span>',
              '<span class="rc-text">' + esc(h.counter) + '</span>',
              '<button type="button" class="rc-apply" data-rc-apply="' + esc(h.counter) + '" data-rc-match="' + esc(h.matched || '') + '" aria-label="Apply this suggestion to the source"' + applyDisabled + '>' + applyLabel + '</button>',
              '<button type="button" class="rc-copy" data-rc-copy="' + esc(h.counter) + '" aria-label="Copy suggestion to clipboard">copy</button>',
              '<button type="button" class="rc-speak" data-rc-speak="' + esc(h.counter) + '" aria-label="Read suggestion aloud">🔊</button>',
              tip,
            '</div>'
          );
        }
      }
      riskDetail.innerHTML = parts.join('');
    }

    // Format the matched-pattern list as plain text suitable for pasting
    // into email / a chat / a doc. Trap reads loudest; one row per hit;
    // closes with a ClearDoc attribution so the source is preserved.
    //   formatMatchesForCopy(hits) →
    //     "TRAP — non-refundable: Money you won't get back.
    //      WATCH — auto-renews: Renews automatically unless you cancel in time.
    //      ...
    //      — matched by ClearDoc (cleardoc.app)"
    function formatMatchesForCopy(hits){
      if(!Array.isArray(hits) || hits.length === 0) return '';
      const rank = { r: 0, a: 1, g: 2 };
      const ordered = hits.slice().sort((a, b) => (rank[a.sev]||9) - (rank[b.sev]||9));
      const lines = [];
      // Header — gives the export a recognizable shape when pasted
      // into an email / chat ("ClearDoc Risk Report" + count + date)
      lines.push('CLEARINGDOC RISK REPORT');
      lines.push(new Date().toISOString().slice(0, 10) + ' · ' + ordered.length + ' pattern' + (ordered.length === 1 ? '' : 's'));
      lines.push('');
      let n = 0;
      for(const h of ordered){
        n++;
        const tag = h.sev === 'r' ? 'TRAP' : (h.sev === 'a' ? 'WATCH' : 'NOTE');
        const matched = (h.matched || '').trim();
        const why = (h.why || '').trim();
        lines.push(n + '. [' + tag + '] ' + matched);
        lines.push('   Why: ' + why);
        // Include the counter-suggestion when present (iter #41)
        // so a single Copy captures the full negotiation playbook
        if(h.counter){
          lines.push('   → Suggest: ' + h.counter);
        }
      }
      lines.push('', '— matched by ClearDoc (cleardoc.app)');
      return lines.join('\n');
    }
    // Redline format — original clause + counter-suggestion pairs,
    // formatted so users can paste into a Word redline / email as a
    // starting point for negotiation. Each section: tag, why, the
    // original sentence, then the proposed replacement.
    //   formatRedline(hits) →
    //     REDLINE — Document Negotiation Suggestions
    //     Generated by ClearDoc · 2026-07-24
    //     ========================================
    //
    //     1. [TRAP] non-refundable — Money you won't get back.
    //        Original: "All fees are non-refundable."
    //        Proposed: "Replace with refundable less reasonable..."
    //     …
    function formatRedline(hits){
      if(!Array.isArray(hits) || hits.length === 0) return '';
      const rank = { r: 0, a: 1, g: 2 };
      const ordered = hits.slice().sort((a, b) => (rank[a.sev]||9) - (rank[b.sev]||9));
      const lines = [
        'REDLINE — Document Negotiation Suggestions',
        'Generated by ClearDoc (cleardoc.app) · ' + new Date().toISOString().slice(0, 10),
        '='.repeat(60),
        '',
      ];
      let n = 1;
      for(const h of ordered){
        const tag = h.sev === 'r' ? 'TRAP' : (h.sev === 'a' ? 'WATCH' : 'NOTE');
        const matched = (h.matched || '').trim();
        const why = (h.why || '').trim();
        lines.push(n + '. [' + tag + '] ' + matched);
        lines.push('   Why: ' + why);
        if(h.counter){
          lines.push('   Proposed: ' + h.counter);
        }
        lines.push('');
        n++;
      }
      lines.push('='.repeat(60));
      lines.push('Review each suggestion with your lawyer before sending.');
      return lines.join('\n');
    }
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
        // Push to history (capped) — lets users come back to a doc they
        // analyzed yesterday. Best-effort; failures are silent.
        pushHistory(snap.raw);
        // Iter #60/61: bump the per-user "risks avoided" counter
        // with the risk count from this analysis, broken down by
        // severity. Tangible value metric that drives engagement.
        try {
          if(Array.isArray(snap.risks) && snap.risks.length > 0){
            let trap = 0, watch = 0, note = 0;
            for(const r of snap.risks){
              if(!r) continue;
              if(r.sev === 'r') trap++;
              else if(r.sev === 'a') watch++;
              else if(r.sev === 'g') note++;
            }
            bumpRisksAvoidedBySeverity(trap, watch, note);
            // Iter #77: also push to the risk-trend sparkline
            try { if(typeof pushRiskTrend === 'function') pushRiskTrend(snap.risks.length); } catch(_){}
          }
        } catch(_){}
        // Iter #67: surface the version-comparison delta (if a saved
        // "before" version exists). No-op if no saved version.
        try { if(typeof showVersionDelta === 'function') showVersionDelta(); } catch(_){}
        return true;
      }catch(_){ return false; }
    }

    /* ── Risks-avoided counter (iter #60) ───────────────────────
     * Tracks the total number of risk patterns the user has
     * surfaced across all their analyses. Shown in the result
     * panel and as a "value" stat — gives users a tangible
     * metric for what ClearDoc has done for them.
     * Privacy: localStorage only, no PII.
     */
    const RISKS_KEY = 'cleardoc:risksAvoided';
    const RISKS_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
    function getRisksAvoided(){
      // Iter #61: returns a breakdown by severity (trap/watch/note)
      // in addition to the total count. Backward-compatible — old
      // payloads (count + ts) still return a count; severity fields
      // default to 0 if missing.
      try {
        const raw = localStorage.getItem(RISKS_KEY);
        if(!raw) return { count: 0, trap: 0, watch: 0, note: 0 };
        const data = JSON.parse(raw);
        if(!data || typeof data.count !== 'number') return { count: 0, trap: 0, watch: 0, note: 0 };
        if(typeof data.ts === 'number' && (Date.now() - data.ts) > RISKS_TTL_MS) return { count: 0, trap: 0, watch: 0, note: 0 };
        return {
          count: data.count,
          trap: typeof data.trap === 'number' ? data.trap : 0,
          watch: typeof data.watch === 'number' ? data.watch : 0,
          note: typeof data.note === 'number' ? data.note : 0,
        };
      } catch(_){ return { count: 0, trap: 0, watch: 0, note: 0 }; }
    }
    // bumpRisksAvoidedBySeverity — iter #61. Bumps the counter
    // using the per-severity breakdown from this analysis. Falls
    // back to the legacy n-only bump when no breakdown is given
    // (backward-compat for older callers).
    function bumpRisksAvoidedBySeverity(trap, watch, note){
      try {
        const cur = getRisksAvoided();
        const n = (Number(trap)||0) + (Number(watch)||0) + (Number(note)||0);
        if(n <= 0) return;
        const next = {
          count: cur.count + n,
          trap:  cur.trap  + (Number(trap)  || 0),
          watch: cur.watch + (Number(watch) || 0),
          note:  cur.note  + (Number(note)  || 0),
          ts: Date.now(),
        };
        localStorage.setItem(RISKS_KEY, JSON.stringify(next));
      } catch(_){}
    }
    // Legacy single-n bump (kept for callers that don't have a
    // breakdown). Routes through bumpRisksAvoidedBySeverity with
    // 0/0/n so the totals stay consistent.
    function bumpRisksAvoided(n){
      bumpRisksAvoidedBySeverity(0, 0, n);
    }

    /* ── Risk trend (iter #77) ─────────────────────────────────────
     * Saves the last N risk counts (just the number + ts) so
     * users can see a sparkline of how their risk counts trend
     * over time. Visual engagement metric.
     */
    const TREND_KEY = 'cleardoc:riskTrend';
    const TREND_MAX = 10;
    const TREND_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
    function getRiskTrend(){
      try {
        const raw = localStorage.getItem(TREND_KEY);
        if(!raw) return [];
        const arr = JSON.parse(raw);
        if(!Array.isArray(arr)) return [];
        const cutoff = Date.now() - TREND_TTL_MS;
        const fresh = arr.filter(p => p && typeof p.ts === 'number' && p.ts >= cutoff);
        if(fresh.length !== arr.length){
          try { localStorage.setItem(TREND_KEY, JSON.stringify(fresh)); } catch(_){}
        }
        return fresh;
      } catch(_){ return []; }
    }
    function pushRiskTrend(count){
      try {
        if(typeof count !== 'number' || count < 0) return;
        const arr = getRiskTrend();
        arr.unshift({ ts: Date.now(), count });
        while(arr.length > TREND_MAX) arr.pop();
        localStorage.setItem(TREND_KEY, JSON.stringify(arr));
      } catch(_){}
    }

    /* ── Analysis history ─────────────────────────────────────────────
     * Saves the last N analyses (just the raw text + a snippet + ts)
     * so users can restore any of them. Capped at 5 entries (FIFO) to
     * stay well under the localStorage quota. 7-day TTL on each entry
     * mirrors the draft TTL — old analyses are quietly dropped.
     */
    const HISTORY_KEY='cleardoc:history';
    const HISTORY_VERSION=1;
    const HISTORY_MAX_ENTRIES=5;
    const HISTORY_TTL_MS=7*24*60*60*1000;
    function pushHistory(raw){
      try{
        const text = String(raw || '').trim();
        if (!text || text.length < 8) return false;
        const snippet = text.slice(0, 80).replace(/\s+/g, ' ');
        // Detect language at save time so the history entry carries
        // it without re-running detection on every render. Cheap (a few
        // regexes over the trimmed text).
        const lang = (typeof detectLanguage === 'function') ? detectLanguage(text) : null;
        const entry = {
          v: HISTORY_VERSION,
          ts: Date.now(),
          snippet,
          text,
          lang: lang ? lang.code : null,
          langLabel: lang ? lang.label : null,
        };
        const arr = readHistoryRaw();
        // Skip duplicates of the most recent entry (avoids stacking
        // repeated analyze-button clicks with the same text).
        if (arr.length && arr[0].snippet === snippet && arr[0].text === text){
          // Update timestamp only — refresh recency
          arr[0].ts = entry.ts;
          // Refresh language too (in case detectLanguage patterns improved)
          arr[0].lang = entry.lang;
          arr[0].langLabel = entry.langLabel;
          localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
          return true;
        }
        arr.unshift(entry);
        // FIFO cap
        while (arr.length > HISTORY_MAX_ENTRIES) arr.pop();
        localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
        return true;
      }catch(_){ return false; }
    }
    function readHistoryRaw(){
      try{
        const raw = localStorage.getItem(HISTORY_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        // TTL sweep: drop entries older than HISTORY_TTL_MS
        const cutoff = Date.now() - HISTORY_TTL_MS;
        const fresh = arr.filter(e => e && typeof e.ts === 'number' && e.ts >= cutoff);
        if (fresh.length !== arr.length){
          try { localStorage.setItem(HISTORY_KEY, JSON.stringify(fresh)); } catch(_){}
        }
        return fresh;
      }catch(_){ return []; }
    }
    function clearHistory(){
      try { localStorage.removeItem(HISTORY_KEY); } catch(_){}
    }

    /* ── Document templates (iter #57) ───────────────────────────
     * Save a doc + detected type as a reusable template for
     * similar future docs (e.g. a lease template the user reuses
     * when analyzing different properties). Distinct from history
     * (iter #25): history is automatic + 5-entry FIFO, templates
     * are intentional + named + 10-entry cap + never auto-purged.
     */
    const TPL_KEY = 'cleardoc:templates';
    const TPL_VERSION = 1;
    const TPL_MAX_ENTRIES = 10;
    function readTemplates(){
      try{
        const raw = localStorage.getItem(TPL_KEY);
        if(!raw) return [];
        const arr = JSON.parse(raw);
        if(!Array.isArray(arr)) return [];
        return arr.filter(t => t && typeof t.name === 'string' && typeof t.text === 'string');
      }catch(_){ return []; }
    }
    function saveTemplate(name, text, typeLabel){
      try{
        const t = (name || '').trim() || ('Untitled ' + new Date().toLocaleDateString());
        const trimmedText = String(text || '').trim();
        if(!trimmedText || trimmedText.length < 8) return false;
        const entry = {
          v: TPL_VERSION,
          ts: Date.now(),
          name: t.slice(0, 60),
          text: trimmedText.slice(0, 40000), // mirror input cap
          type: typeLabel || null,
        };
        const arr = readTemplates();
        // Skip if same name + same text already exists
        if(arr.some(e => e.name === entry.name && e.text === entry.text)) return false;
        arr.unshift(entry);
        while(arr.length > TPL_MAX_ENTRIES) arr.pop();
        localStorage.setItem(TPL_KEY, JSON.stringify(arr));
        return true;
      }catch(_){ return false; }
    }
    function clearTemplates(){
      try { localStorage.removeItem(TPL_KEY); } catch(_){}
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
      // Show the read-aloud button only when SpeechSynthesis is available
      // AND there's a rewrite to speak (avoids a broken button when the
      // local fallback produced no rewrite text).
      if(speakBtn){
        if(typeof window !== 'undefined' && 'speechSynthesis' in window && plainOut && plainOut.textContent && plainOut.textContent.trim().length > 0){
          speakBtn.hidden = false;
          // Voice picker: only show if there are actual voices to
          // choose from. Some browsers expose getVoices() but return
          // [] until the first async load — we re-populate when that
          // happens (voiceschanged event).
          if(voicePicker && typeof populateVoicePicker === 'function'){
            populateVoicePicker(plainOut._detectedLang || null);
            voicePicker.hidden = voicePicker.options.length <= 1;
          }
          // Preview button follows the picker (or shows alone if
          // SpeechSynthesis exists but picker has 0 voices — at least
          // users get the System default preview)
          if(voicePreviewBtn){
            voicePreviewBtn.hidden = !voicePicker || voicePicker.hidden;
          }
        }
      }
      if(!noMotion && window.gsap) gsap.fromTo(panel,{opacity:0,y:14},{opacity:1,y:0,duration:DUR.base,ease:EASE.enter});
      if(askInput) askInput.disabled=false; if(askBtn) askBtn.disabled=false;

      // Persist for restore-on-refresh. Best-effort; failures are silent.
      // Only the renderable shape is stored — no AI API keys, no PII fields.
      // Iter #67: also surface the version-comparison delta (if a
      // saved "before" version exists). Quietly no-ops if there's no
      // saved version.
      saveSnapshot({
        raw,
        fileName: attachedFile && attachedFile.name ? attachedFile.name : null,
        rewriteHtml: plainOut ? plainOut.innerHTML : '',
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
      // Auto-suggest template (iter #58) — after a successful analysis,
      // prompt the user to save the doc as a template for next time.
      // Smooth on-ramp from analysis → saved template. The prompt
      // skips itself if the doc is already a known template (by content
      // hash) or is too short to be a meaningful template.
      if(typeof showTemplateSuggestion === 'function' && input){
        const raw = (input.value || '').trim();
        if(raw.length >= 200){
          const existing = (typeof readTemplates === 'function') ? readTemplates() : [];
          const alreadySaved = existing.some(t => t.text === raw);
          if(!alreadySaved){
            showTemplateSuggestion(raw);
          }
        }
      }
      // Iter #60/61: update the "📊 N risks avoided" badge in the
      // result-actions row. Shows a tangible value metric broken
      // down by severity: "📊 8 trap + 5 watch + 1 note avoided".
      // Falls back to the plain total if all severity counts are 0
      // (backward-compat with old payloads).
      if(risksAvoidedBadge && typeof getRisksAvoided === 'function'){
        const data = getRisksAvoided();
        const total = data.count || 0;
        if(total > 0){
          let text = '📊 ' + total + ' risk' + (total === 1 ? '' : 's') + ' avoided';
          // Add severity breakdown if any of the per-sev counts are > 0
          if(data.trap || data.watch || data.note){
            const parts = [];
            if(data.trap)  parts.push(data.trap  + ' trap');
            if(data.watch) parts.push(data.watch + ' watch');
            if(data.note)  parts.push(data.note  + ' note');
            if(parts.length > 0) text += ' (' + parts.join(' + ') + ')';
          }
          risksAvoidedBadge.textContent = text;
          // Tooltip (iter #62) — show the estimated $ value of what
          // these risks would have cost. Per-severity rates (rough
          // industry averages: trap = $200, watch = $50, note = $20)
          // are conservative — actual cost varies wildly by contract.
          const SAVINGS_PER = { r: 200, a: 50, g: 20 };
          const trapVal  = (data.trap  || 0) * SAVINGS_PER.r;
          const watchVal = (data.watch || 0) * SAVINGS_PER.a;
          const noteVal  = (data.note  || 0) * SAVINGS_PER.g;
          const totalVal = trapVal + watchVal + noteVal;
          const fmt = (n) => '$' + n.toLocaleString('en-US');
          risksAvoidedBadge.title =
            'Approx. ' + fmt(totalVal) + ' in avoided costs (' +
            fmt(trapVal) + ' from ' + (data.trap  || 0) + ' trap + ' +
            fmt(watchVal)+ ' from ' + (data.watch || 0) + ' watch + ' +
            fmt(noteVal) + ' from ' + (data.note  || 0) + ' note). ' +
            'Estimates only — actual cost varies by contract.';
          risksAvoidedBadge.hidden = false;
          // Iter #63: show the share button so users can copy a
          // one-liner to clipboard for social / email.
          if(shareBadgeBtn){
            shareBadgeBtn.hidden = false;
            shareBadgeBtn.dataset.text =
              'I avoided ' + total + ' risk' + (total === 1 ? '' : 's') +
              ' with ClearDoc! (cleardoc.app) — approx. ' + fmt(totalVal) +
              ' in saved costs. ' + parts.join(' + ');
          }
          if(resetBadgeBtn) resetBadgeBtn.hidden = false;
          if(badgeExplainBtn) badgeExplainBtn.hidden = false;
        } else {
          risksAvoidedBadge.hidden = true;
          if(shareBadgeBtn) shareBadgeBtn.hidden = true;
          if(resetBadgeBtn) resetBadgeBtn.hidden = true;
          if(badgeExplainBtn) badgeExplainBtn.hidden = true;
        }
      }
    }
    // Iter #81: recent-analyses mini-stats — a small inline summary
    // showing "N analyses · M risks caught" so users can see their
    // engagement at a glance. Sits next to the risks-avoided badge.
    // Hidden when both counts are 0 (no point showing zeros).
    if(recentStats && typeof readHistoryRaw === 'function'){
      const arr = readHistoryRaw();
      const total = (arr.length || 0);
      const caught = (typeof getRisksAvoided === 'function') ? (getRisksAvoided().count || 0) : 0;
      if(total > 0 || caught > 0){
        recentStats.hidden = false;
        recentStats.textContent = '📊 ' + total + ' analyse' + (total === 1 ? 's' : 's') +
          ' · ' + caught + ' risk' + (caught === 1 ? '' : 's') + ' caught';
        recentStats.title = 'Across your last ' + total + ' analyse' + (total === 1 ? 's' : 's') +
          ', ClearDoc caught ' + caught + ' risk' + (caught === 1 ? '' : 's') +
          ' across all your analyses. ' +
          (typeof formatRelativeTime === 'function' && arr[0] && arr[0].ts
            ? 'Most recent: ' + formatRelativeTime(arr[0].ts) + '. '
            : '');
      } else {
        recentStats.hidden = true;
      }
    }

    // showVersionDelta (iter #67) — if a saved version exists, compute
    // the delta vs the current analysis and show a one-liner. "Down
    // from 7 risks to 4 (3 fixed)" — gives users a tangible impact
    // signal for their edits. Toast shows the snippet of the saved
    // version so users can verify which one is being compared.
    const lastVersionDelta = (function(){
      let lastVal = null;
      return function() { return lastVal; };
    })();
    function showVersionDelta(){
      try {
        const v = getSavedVersion();
        if(!v) return;
        const before = v;
        if(typeof matchRisks !== 'function' || !input) return;
        const afterHits = matchRisks(input.value || '');
        const afterCount = afterHits.length;
        const trap = afterHits.filter(h => h && h.sev === 'r').length;
        const watch = afterHits.filter(h => h && h.sev === 'a').length;
        const note = afterHits.filter(h => h && h.sev === 'g').length;
        const d = afterCount - before.count;
        lastVersionDelta({ before, after: { count: afterCount, trap, watch, note } });
        let sym = '±';
        let label = 'same';
        // Iter #70: color-code the toast by direction. Green for
        // improvements (count dropped), red for regressions (rose),
        // gray for "same". Toggles a class on the existing toast
        // element so the CSS handles the visual.
        let deltaCls = 'delta-same';
        if(d < 0){
          sym = '−';
          label = Math.abs(d) + ' fixed';
          deltaCls = 'delta-fixed';
        } else if(d > 0){
          sym = '+';
          label = d + ' new';
          deltaCls = 'delta-new';
        }
        const ago = (Date.now() - before.ts) < 60000 ? 'just now' :
          formatRelativeTime(before.ts);
        // Paint directly on the toast element (showAnalyzeToast
        // doesn't support a class; we do it inline so the class
        // takes effect this frame).
        if(_analyzeToast){
          _analyzeToast.textContent = '📊 Saved version: ' + before.count +
            ' risks → now ' + afterCount + ' (' + sym + ' ' + label + ') · ' + ago;
          _analyzeToast.classList.remove('delta-fixed','delta-new','delta-same','toast-out');
          _analyzeToast.classList.add('toast-in', deltaCls);
          clearTimeout(_analyzeToast._fadeTimer);
          _analyzeToast._fadeTimer = setTimeout(() => {
            _analyzeToast.classList.remove('toast-in', deltaCls);
            _analyzeToast.classList.add('toast-out');
          }, 3200);
        } else {
          showAnalyzeToast('📊 Saved version: ' + before.count + ' risks → now ' +
            afterCount + ' (' + sym + ' ' + label + ') · ' + ago);
        }
        // Re-evaluate the clear button (the saved version is still
        // there — just refreshed by comparison)
        if(typeof showClearVersionBtn === 'function') showClearVersionBtn();
      } catch(_){}
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
      // Document structural summary — sentence count, paragraph count,
      // avg + longest sentence length. Sits above textstats as a quick
      // shape-of-the-doc read. Hidden when too short to be meaningful.
      if(docSummary && typeof summarizeStructure === 'function'){
        const s = summarizeStructure(raw);
        if(!s){
          docSummary.hidden = true;
        } else {
          docSummary.hidden = false;
          if(dsSentences) dsSentences.textContent = s.sentences;
          if(dsSentenceS) dsSentenceS.textContent = s.sentences === 1 ? '' : 's';
          if(dsParagraphs) dsParagraphs.textContent = s.paragraphs;
          if(dsParagraphS) dsParagraphS.textContent = s.paragraphs === 1 ? '' : 's';
          if(dsAvgWords) dsAvgWords.textContent = s.avgWords;
          if(dsLongest) dsLongest.textContent = s.longestWords;
          // Flag dense prose: longest sentence > 60 words is a strong
          // signal that the doc has run-on legalese worth flagging.
          docSummary.classList.remove('ds-dense');
          if(s.longestWords > 60) docSummary.classList.add('ds-dense');
          // Language detection — tag the doc with the detected
          // language (Spanish, French, German, Italian, Portuguese,
          // English). TTS uses this to pick a matching voice. Hidden
          // when detection is inconclusive (< 2 hits) so we don't
          // mislead users with a wrong guess.
          if(dsLang && typeof detectLanguage === 'function'){
            const lang = detectLanguage(raw);
            if(lang){
              dsLang.hidden = false;
              dsLang.textContent = '🌐 ' + lang.label;
              dsLang.title = 'Detected language: ' + lang.label +
                ' (' + lang.hits + ' signal' + (lang.hits === 1 ? '' : 's') + ')';
              // Stash on the input so the TTS handler can pick it up
              if(input) input._detectedLang = lang;
            } else {
              dsLang.hidden = true;
              dsLang.textContent = '';
              dsLang.title = '';
              if(input) input._detectedLang = null;
            }
          }
          // Jargon-swap count — reuses the home-page clarify() engine
          // to count JARGON matches in the input. Hidden when zero
          // (clean docs shouldn't show a swap badge). When > 0,
          // clicking the badge reveals the plain-English preview.
          if(dsJargon && typeof clarify === 'function'){
            const c = clarify(raw);
            if(c && c.found > 0){
              dsJargon.hidden = false;
              if(dsJargonCount) dsJargonCount.textContent = c.found;
              if(dsJargonS) dsJargonS.textContent = c.found === 1 ? '' : 's';
              // Stash the rendered preview on the button so the click
              // handler can paint it without re-running clarify().
              dsJargon._previewHtml = c.html;
              // If the preview is already open, refresh its content
              // so it stays in sync with the input.
              if(dsJargonPreview && !dsJargonPreview.hidden){
                dsJargonPreview.innerHTML = c.html;
              }
            } else {
              dsJargon.hidden = true;
              if(dsJargonPreview && !dsJargonPreview.hidden){
                dsJargonPreview.hidden = true;
                dsJargon.setAttribute('aria-expanded', 'false');
                dsJargon.classList.remove('ds-open');
              }
            }
          }
        }
      }
      if(statReadTime){
        statReadTime.textContent = readTime(raw);
        // Band-based color cue. Single class swap (add+remove) keeps the
        // toggle O(1) and lets the CSS own the visual treatment.
        const band = readTimeBand(raw);
        statReadTime.classList.remove('band-quick','band-standard','band-long','band-marathon');
        if (band) statReadTime.classList.add('band-' + band);
      }
      // Document-type badge — "Lease" / "Medical Bill" / "Subscription" etc.
      // Single class swap (doc-type-<name>) lets the CSS own the color
      // (each type gets a distinct accent so users can recognize their
      // doc type at a glance). Hidden when no type matches — better to
      // say "—" than mislabel.
      if(statDocType){
        const dt = (typeof detectDocType === 'function') ? detectDocType(raw) : null;
        if(dt){
          statDocType.textContent = dt.label;
          statDocType.title = 'Looks like a ' + dt.label.toLowerCase() +
            ' (' + dt.matches + ' signal' + (dt.matches === 1 ? '' : 's') + ')';
          // Drop any old doc-type classes, then add the active one
          statDocType.className = '';
          statDocType.classList.add('dt-' + dt.name, 'dt-conf-' + dt.confidence);
          // Per-type "what to look for" tip — hand-curated vocabulary of
          // traps for each doc category. Shown only when the badge is
          // active, so a clean / unknown doc doesn't get a dangling tip.
          if(docTypeTip && docTypeTipText && typeof getDocTypeTip === 'function'){
            const tip = getDocTypeTip(dt.name);
            if(tip){
              docTypeTipText.textContent = tip;
              docTypeTip.hidden = false;
              docTypeTip.className = 'doc-type-tip mono dtt-' + dt.name;
            } else {
              docTypeTip.hidden = true;
            }
          }
        } else {
          statDocType.textContent = '—';
          statDocType.title = '';
          statDocType.className = '';
          // No type → hide the tip too (no orphan tip when type disappears)
          if(docTypeTip) docTypeTip.hidden = true;
        }
      }
      statLevel.textContent = isGradable(raw) ? (gradeLevel(raw) + 'th') : '—';
      // Friendly label next to the numeric grade — "12th · College"
      // reads as a description of the document, not a judgment of the
      // reader. Color-codes by density (easy/standard/dense/very-dense).
      if(statFriendly){
        if(isGradable(raw)){
          const g = gradeLevel(raw);
          const label = friendlyGrade(g);
          const density = gradeDensity(g);
          if(label){
            statFriendly.textContent = label;
            statFriendly.title = 'Grade ' + g + ' (' + label + ' level)';
            statFriendly.hidden = false;
            statFriendly.className = 'stat-friendly density-' + (density || 'standard');
          } else {
            statFriendly.hidden = true;
          }
        } else {
          statFriendly.hidden = true;
        }
      }
      // Live deadlines preview — count date / "N days" patterns detected
      // in the input. Shows the soonest one with urgency color so users
      // see timing pressure before clicking Analyze. Hidden when none.
      if(deadlinesPreview && typeof extractDeadlines === 'function'){
        const dls = extractDeadlines(raw);
        if(dls.length === 0){
          deadlinesPreview.hidden = true;
          if(deadlinesCalBtn){
            deadlinesCalBtn._deadlines = null;
            deadlinesCalBtn.disabled = true;
          }
        } else {
          deadlinesPreview.hidden = false;
          if(deadlinesCount) deadlinesCount.textContent = dls.length;
          if(deadlinesPlural) deadlinesPlural.textContent = dls.length === 1 ? '' : 's';
          // Soonest is dls[0] (sorted ascending by urgencyDays — past
          // dates first, then soonest future). Format the label.
          const soon = dls[0];
          let soonestLabel = soon.label;
          if(typeof soon.urgencyDays === 'number'){
            if(soon.urgencyDays < 0){
              soonestLabel = soon.label + ' (' + Math.abs(soon.urgencyDays) + 'd ago)';
            } else if(soon.urgencyDays === 0){
              soonestLabel = 'today';
            } else if(soon.urgencyDays === 1){
              soonestLabel = 'tomorrow';
            } else if(soon.urgencyDays < 30){
              soonestLabel = 'in ' + soon.urgencyDays + ' days';
            }
          }
          if(deadlinesSoonest) deadlinesSoonest.textContent = soonestLabel;
          // Stash the deadlines list on the button so the click
          // handler can build a multi-event ICS without re-extracting.
          // Button label scales with the count so users know what
          // they're exporting: 1 → '+ calendar'; 3 → '+ 3 calendar'.
          if(deadlinesCalBtn){
            deadlinesCalBtn._deadlines = dls;
            deadlinesCalBtn.disabled = false;
            deadlinesCalBtn.title = (dls.length === 1)
              ? 'Add this deadline to your calendar'
              : 'Add all ' + dls.length + ' deadlines to your calendar';
            const label = (dls.length === 1) ? '+ calendar' : ('+ ' + dls.length + ' calendar');
            deadlinesCalBtn._origText = label;
            deadlinesCalBtn.textContent = label;
          }
          // Urgency band: past = danger, < 7 days = danger, < 30 days =
          // amber, else default. Past dates read loudest because an
          // already-missed deadline is the most urgent signal.
          deadlinesPreview.classList.remove('dp-past','dp-urgent','dp-soon','dp-future');
          const u = soon.urgencyDays;
          if(typeof u === 'number'){
            if(u < 0) deadlinesPreview.classList.add('dp-past');
            else if(u < 7) deadlinesPreview.classList.add('dp-urgent');
            else if(u < 30) deadlinesPreview.classList.add('dp-soon');
            else deadlinesPreview.classList.add('dp-future');
          }
          // Inline urgency-dot timeline — shows EVERY detected deadline
          // (up to 8) as a colored dot, so users see the full picture
          // at a glance instead of just "soonest: X". Dot color maps
          // to the same urgency bands as the pill bg. Hover for the
          // full date label.
          //   [● ● ○ ○]   ← 4 deadlines: 2 urgent, 2 future
          if(deadlinesTimeline){
            const dots = dls.map(d => {
              const du = d.urgencyDays;
              let cls = 'dp-dot-future';
              if(typeof du === 'number'){
                if(du < 0) cls = 'dp-dot-past';
                else if(du < 7) cls = 'dp-dot-urgent';
                else if(du < 30) cls = 'dp-dot-soon';
              }
              // Title = "Mon DD, YYYY — in N days" / "Nd ago" for screen-readers
              let tip = d.label;
              if(typeof du === 'number'){
                if(du < 0) tip += ' (' + Math.abs(du) + 'd ago)';
                else if(du > 0) tip = 'in ' + du + ' days';
                else tip = 'today';
              }
              return '<span class="dp-dot ' + cls + '" title="' + tip +
                '" aria-label="' + tip + '"></span>';
            }).join('');
            deadlinesTimeline.innerHTML = dots;
            deadlinesTimeline.title = dls.length + ' deadline' + (dls.length === 1 ? '' : 's') + ' total';
          }
        }
      }
      if(statCap) statCap.textContent = cap.toLocaleString();
      // Live risk preview — count trap patterns detected in the input
      // so users see "this doc has 3 risks" BEFORE they hit Analyze.
      // Hides itself when no patterns match (clean docs shouldn't get
      // a scary-looking pill). countRisksBySeverity() lives in this
      // same scope and uses the local RISK array below.
      if(typeof countRisksBySeverity === 'function'){
        const sev = countRisksBySeverity(raw);
        const rc = sev.trap + sev.watch + sev.note;
        if(riskPreview){
          riskPreview.hidden = rc === 0;
          if(riskCount) riskCount.textContent = sev.trap;
          if(watchCount) watchCount.textContent = sev.watch;
          if(noteCount) noteCount.textContent = sev.note;
          // Pluralize the per-severity labels so the pill reads
          // naturally at any count ("1 trap" / "2 traps").
          if(watchS) watchS.textContent = sev.watch === 1 ? '' : 'es';
          if(noteS) noteS.textContent = sev.note === 1 ? '' : 's';
          // Hide per-severity sub-spans with zero counts so the pill
          // doesn't read "0 notes" — just show what fired.
          if(watchWrap) watchWrap.hidden = sev.watch === 0;
          if(noteWrap) noteWrap.hidden = sev.note === 0;
          // Band: any trap → trap (danger red, loudest). Otherwise any
          // watch → watch (amber). Otherwise any note → note (ink).
          // Single class swap keeps the CSS owning the visual treatment.
          riskPreview.classList.remove('risk-watch','risk-trap','risk-note');
          if(sev.trap >= 1) riskPreview.classList.add('risk-trap');
          else if(sev.watch >= 1) riskPreview.classList.add('risk-watch');
          else riskPreview.classList.add('risk-note');
        }
        // Render the detail list whenever the user has expanded it.
        // Collapsed (the common case) → no DOM cost. Expanded →
        // rebuild with the current matched patterns so it stays in
        // sync as the user types.
        if(riskDetail && !riskDetail.hidden && typeof matchRisks === 'function'){
          const hits = matchRisks(raw);
          renderRiskDetail(hits);
        }
        // If the user just cleared the input, collapse the detail
        // so we don't leave an orphan expanded list dangling.
        if(riskDetail && rc === 0 && !riskDetail.hidden){
          riskDetail.hidden = true;
          if(riskPreview){
            riskPreview.setAttribute('aria-expanded','false');
            riskPreview.classList.remove('rp-open');
          }
        }
      }
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

      /* History panel — toggles a dropdown of past analyses (saved
       * in localStorage on each successful analysis). Click an
       * entry to load it back into the textarea. */
      // Current language filter ('all' or a 2-letter code). Default 'all'.
      let currentLangFilter = 'all';
      const renderHistory = () => {
        if(!historyList || !historyPanel) return;
        const items = (typeof readHistoryRaw === 'function') ? readHistoryRaw() : [];
        if(items.length === 0){
          historyList.innerHTML = '<li class="hp-empty">No past analyses yet.</li>';
          if(historyFilter) historyFilter.hidden = true;
          return;
        }
        // Update the filter row — show count per language so users
        // see at a glance which languages are present in history.
        if(historyFilter){
          historyFilter.hidden = false;
          const counts = items.reduce((acc, it) => {
            const k = it && it.lang ? it.lang : 'und';
            acc[k] = (acc[k] || 0) + 1;
            return acc;
          }, {});
          historyFilter.querySelectorAll('[data-hp-filter]').forEach(btn => {
            const code = btn.getAttribute('data-hp-filter');
            const isActive = code === currentLangFilter;
            btn.classList.toggle('hp-filter-active', isActive);
            // Label format: "English (3)" / "Spanish (1)" / "All (5)"
            const base = btn.textContent.replace(/\s*\(\d+\)\s*$/, '');
            const count = code === 'all' ? items.length : (counts[code] || 0);
            btn.textContent = base + ' (' + count + ')';
          });
        }
        // Apply the filter
        const filtered = currentLangFilter === 'all'
          ? items
          : items.filter(it => it && it.lang === currentLangFilter);
        if(filtered.length === 0){
          historyList.innerHTML = '<li class="hp-empty">No analyses match that language filter.</li>';
          return;
        }
        historyList.innerHTML = filtered.map((it, i) => {
          const ts = it && it.ts ? new Date(it.ts) : null;
          const full = ts ? ts.toLocaleString() : '';
          const rel = (typeof formatRelativeTime === 'function' && ts) ? formatRelativeTime(it.ts) : full;
          const snippet = (it && it.snippet) ? it.snippet : '';
          // Language pill — only show if detection was conclusive
          const langPill = (it && it.langLabel)
            ? '<span class="hp-lang hp-lang-' + esc(it.lang) + '">' + esc(it.langLabel) + '</span>'
            : '';
          return '<li><button type="button" class="hp-item" data-hp-idx="' + i +
            '" title="' + esc(full) + '"><span class="hp-row"><span class="hp-when">' +
            esc(rel) + '</span>' + langPill +
            '</span><span class="hp-snip">' + esc(snippet) + '</span></button></li>';
        }).join('');
      };
      // Filter button click handler (delegated)
      if(historyFilter){
        historyFilter.addEventListener('click', (e) => {
          const btn = e.target.closest && e.target.closest('[data-hp-filter]');
          if(!btn) return;
          currentLangFilter = btn.getAttribute('data-hp-filter') || 'all';
          renderHistory();
        });
      }

      // Template panel handlers (iter #57) — save / load / clear
      // named document templates. Click a saved template to load
      // its text into the input textarea.
      function renderTemplates(){
        if(!tplList || !tplPanel) return;
        const items = (typeof readTemplates === 'function') ? readTemplates() : [];
        if(items.length === 0){
          tplList.innerHTML = '<li class="tpl-empty">No saved templates yet. Type a doc, give it a name, and Save.</li>';
          return;
        }
        tplList.innerHTML = items.map((t, i) => {
          const ts = t && t.ts ? new Date(t.ts) : null;
          const ago = ts ? ts.toLocaleDateString() : '';
          const type = t.type ? '<span class="tpl-type">' + esc(t.type) + '</span>' : '';
          return '<li>' +
            '<button type="button" class="tpl-item" data-tpl-idx="' + i +
            '" title="Click to load this template"><span class="tpl-name">' +
            esc(t.name || 'Untitled') + '</span>' + type +
            '<span class="tpl-when">' + esc(ago) + '</span></button>' +
            '<button type="button" class="tpl-edit" data-tpl-edit="' + i +
            '" title="Edit this template">✏️</button>' +
          '</li>';
        }).join('');
      }
      // updateTemplate — update an existing template by index (iter #59).
      // Removes the old entry, then re-saves with the new fields.
      // Reuses saveTemplate (which dedupes by name+text) so we don't
      // need a separate write path.
      function updateTemplate(idx, name, text){
        try{
          const items = readTemplates();
          if(!Array.isArray(items) || idx < 0 || idx >= items.length) return false;
          const old = items[idx];
          if(!old) return false;
          // Remove the old entry
          items.splice(idx, 1);
          localStorage.setItem(TPL_KEY, JSON.stringify(items));
          // Re-save with the new fields (saveTemplate dedupes)
          return saveTemplate(name, text, old.type);
        }catch(_){ return false; }
      }
      if(tplList){
        tplList.addEventListener('click', (e) => {
          // Edit button (iter #59) — opens inline edit mode
          const editBtn = e.target.closest && e.target.closest('[data-tpl-edit]');
          if(editBtn){
            e.preventDefault();
            e.stopPropagation();
            const idx = parseInt(editBtn.getAttribute('data-tpl-edit') || '0', 10);
            const items = (typeof readTemplates === 'function') ? readTemplates() : [];
            const t = items[idx];
            if(!t) return;
            // Render the row in edit mode
            const li = editBtn.closest('li');
            if(!li) return;
            li.innerHTML =
              '<div class="tpl-edit-form">' +
                '<input type="text" class="tpl-edit-name" maxlength="60" value="' + esc(t.name || '') + '" aria-label="Template name">' +
                '<textarea class="tpl-edit-text" rows="4" maxlength="40000" aria-label="Template text">' + esc(t.text || '') + '</textarea>' +
                '<div class="tpl-edit-actions">' +
                  '<button type="button" class="tpl-edit-save" data-tpl-edit-save="' + idx + '">💾 Save</button>' +
                  '<button type="button" class="tpl-edit-cancel" data-tpl-edit-cancel="' + idx + '">Cancel</button>' +
                  '<button type="button" class="tpl-edit-delete" data-tpl-edit-delete="' + idx + '">🗑 Delete</button>' +
                '</div>' +
              '</div>';
            // Focus the name input
            const nameInput = li.querySelector('.tpl-edit-name');
            if(nameInput) setTimeout(() => nameInput.focus(), 0);
            return;
          }
          // Edit-save button — write the updated template
          const saveBtn = e.target.closest && e.target.closest('[data-tpl-edit-save]');
          if(saveBtn){
            e.preventDefault();
            e.stopPropagation();
            const idx = parseInt(saveBtn.getAttribute('data-tpl-edit-save') || '0', 10);
            const li = saveBtn.closest('li');
            const nameInput = li && li.querySelector('.tpl-edit-name');
            const textInput = li && li.querySelector('.tpl-edit-text');
            if(!nameInput || !textInput) return;
            const ok = updateTemplate(idx, nameInput.value, textInput.value);
            renderTemplates();
            if(ok){
              showAnalyzeToast('✓ Template updated');
            } else {
              showAnalyzeToast('Template unchanged or duplicate');
            }
            return;
          }
          // Edit-cancel button — discard changes, re-render
          const cancelBtn = e.target.closest && e.target.closest('[data-tpl-edit-cancel]');
          if(cancelBtn){
            e.preventDefault();
            e.stopPropagation();
            renderTemplates();
            return;
          }
          // Edit-delete button — remove the template entirely
          const deleteBtn = e.target.closest && e.target.closest('[data-tpl-edit-delete]');
          if(deleteBtn){
            e.preventDefault();
            e.stopPropagation();
            const idx = parseInt(deleteBtn.getAttribute('data-tpl-edit-delete') || '0', 10);
            const items = (typeof readTemplates === 'function') ? readTemplates() : [];
            if(!Array.isArray(items) || idx < 0 || idx >= items.length) return;
            const removed = items.splice(idx, 1);
            try { localStorage.setItem(TPL_KEY, JSON.stringify(items)); } catch(_){}
            renderTemplates();
            if(removed.length) showAnalyzeToast('🗑 Template deleted');
            return;
          }
          // Default: load the template into the input
          const btn = e.target.closest && e.target.closest('[data-tpl-idx]');
          if(btn && !input) return;
          if(btn){
            const idx = parseInt(btn.getAttribute('data-tpl-idx') || '0', 10);
            const items = (typeof readTemplates === 'function') ? readTemplates() : [];
            const t = items[idx];
            if(!t || !t.text) return;
            input.value = t.text;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
            if(tplPanel) tplPanel.hidden = true;
          }
        });
      }
      if(tplSaveBtn){
        tplSaveBtn.addEventListener('click', () => {
          if(!input) return;
          const name = tplNameInput ? tplNameInput.value : '';
          // Pull the detected type from the live _detectedLang
          const detectedLang = input._detectedLang;
          const typeLabel = detectedLang ? detectedLang.label : null;
          const ok = saveTemplate(name, input.value, typeLabel);
          if(ok){
            if(tplNameInput) tplNameInput.value = '';
            renderTemplates();
            if(tplSaveBtn){
              const orig = tplSaveBtn.textContent;
              tplSaveBtn.textContent = '✓ saved';
              clearTimeout(tplSaveBtn._flashTimer);
              tplSaveBtn._flashTimer = setTimeout(() => { tplSaveBtn.textContent = orig; }, 1400);
            }
          } else {
            if(tplSaveBtn){
              const orig = tplSaveBtn.textContent;
              tplSaveBtn.textContent = 'duplicate';
              clearTimeout(tplSaveBtn._flashTimer);
              tplSaveBtn._flashTimer = setTimeout(() => { tplSaveBtn.textContent = orig; }, 1400);
            }
          }
        });
      }
      if(tplClearBtn){
        tplClearBtn.addEventListener('click', () => {
          if(typeof clearTemplates === 'function') clearTemplates();
          renderTemplates();
        });
      }
      if(historyBtn && historyPanel){
        historyBtn.addEventListener('click', () => {
          const willOpen = historyPanel.hidden;
          historyPanel.hidden = !willOpen;
          historyBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
          historyBtn.classList.toggle('qf-open', willOpen);
          historyBtn.textContent = willOpen ? '− history' : '📚 history';
          if(willOpen) renderHistory();
        });
        // Delegated click on a history item → restore that doc
        historyList.addEventListener('click', (e) => {
          const btn = e.target.closest && e.target.closest('[data-hp-idx]');
          if(!btn || !input) return;
          const idx = parseInt(btn.getAttribute('data-hp-idx') || '0', 10);
          const items = (typeof readHistoryRaw === 'function') ? readHistoryRaw() : [];
          const it = items[idx];
          if(!it || !it.text) return;
          input.value = it.text;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus();
          // Close the panel
          historyPanel.hidden = true;
          historyBtn.setAttribute('aria-expanded', 'false');
          historyBtn.classList.remove('qf-open');
          historyBtn.textContent = '📚 history';
          // Auto-scroll the textarea into view
          try { input.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(_){}
        });
        if(historyClearBtn){
          historyClearBtn.addEventListener('click', () => {
            if(typeof clearHistory === 'function') clearHistory();
            renderHistory();
          });
        }
      }

      /* Voice input — Web Speech API dictation into the main
       * textarea. Hidden by default; only shown when the browser
       * supports SpeechRecognition (Chrome, Edge, Safari 14.1+).
       * Click again to stop; interim results paint live so users
       * see what they're saying as they say it. */
      if(micBtn && input){
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if(!SR){
          micBtn.hidden = true; // unsupported browser → hide entirely
        } else {
          let recognition = null;
          let isRecording = false;
          let baseValue = ''; // text in the textarea when recording started
          micBtn.addEventListener('click', () => {
            if(isRecording){
              try { recognition && recognition.stop(); } catch(_) {}
              isRecording = false;
              micBtn.textContent = '🎤 dictate';
              micBtn.classList.remove('qf-mic-active');
              return;
            }
            try {
              recognition = new SR();
              recognition.continuous = true;
              recognition.interimResults = true;
              recognition.lang = navigator.language || 'en-US';
              baseValue = input.value || '';
              recognition.onerror = (e) => {
                // 'no-speech', 'aborted', 'not-allowed' — surface a
                // brief flash but don't crash the page
                micBtn.textContent = '🎤 ' + (e.error || 'error');
                clearTimeout(micBtn._errTimer);
                micBtn._errTimer = setTimeout(() => {
                  micBtn.textContent = isRecording ? '■ stop' : '🎤 dictate';
                }, 1400);
              };
              recognition.onend = () => {
                isRecording = false;
                micBtn.textContent = '🎤 dictate';
                micBtn.classList.remove('qf-mic-active');
                micBtn.classList.remove('qf-mic-paused');
                clearTimeout(silenceTimer);
              };
              // Auto-pause: stop recognition after 2.5s of no result
              // (speech-end event + a fallback timer). Standard dictation
              // UX (Google Docs voice typing, Apple Dictation) — users
              // pause naturally without hunting for a stop button.
              const SILENCE_MS = 2500;
              let silenceTimer = null;
              const bumpSilence = () => {
                clearTimeout(silenceTimer);
                silenceTimer = setTimeout(() => {
                  if(isRecording){
                    try { recognition.stop(); } catch(_) {}
                    micBtn.classList.add('qf-mic-paused');
                    micBtn.textContent = '■ paused';
                    setTimeout(() => {
                      micBtn.textContent = '🎤 dictate';
                      micBtn.classList.remove('qf-mic-paused');
                    }, 1400);
                  }
                }, SILENCE_MS);
              };
              recognition.onspeechend = () => bumpSilence();
              recognition.onresult = (e) => {
                bumpSilence();
                let interim = '', final = '';
                for(let i = e.resultIndex; i < e.results.length; i++){
                  const t = e.results[i][0].transcript;
                  if(e.results[i].isFinal) final += t;
                  else interim += t;
                }
                const sep = baseValue && !baseValue.endsWith(' ') && final ? ' ' : '';
                input.value = baseValue + sep + final + interim;
                input.dispatchEvent(new Event('input', { bubbles: true }));
              };
              recognition.start();
              isRecording = true;
              micBtn.textContent = '■ stop';
              micBtn.classList.add('qf-mic-active');
            } catch(err){
              // Start can throw if the page isn't HTTPS or mic is blocked
              micBtn.textContent = '🎤 unavailable';
              clearTimeout(micBtn._errTimer);
              micBtn._errTimer = setTimeout(() => {
                micBtn.textContent = '🎤 dictate';
              }, 1400);
            }
          });
        }
      }

      /* Compare-panel toggle — opens the second textarea. Click
       * again (or Escape) to close. The comparison row beneath both
       * inputs shows side-by-side stats so users can see which
       * contract / clause is riskier at a glance. */
      if(compareToggle && comparePanel){
        compareToggle.addEventListener('click', () => {
          const willOpen = comparePanel.hidden;
          comparePanel.hidden = !willOpen;
          compareToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
          compareToggle.classList.toggle('qf-open', willOpen);
          compareToggle.textContent = willOpen ? '− compare' : '+ compare';
          if(willOpen && inputB) setTimeout(() => inputB.focus(), 50);
          else updateCompareStats();
        });
      }
      // Template panel toggle (iter #57) — shows/hides the saved-templates list
      if(tplBtn && tplPanel){
        tplBtn.addEventListener('click', () => {
          const willOpen = tplPanel.hidden;
          tplPanel.hidden = !willOpen;
          tplBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
          tplBtn.classList.toggle('qf-open', willOpen);
          tplBtn.textContent = willOpen ? '− templates' : '💾 templates';
          if(willOpen) renderTemplates();
        });
      }
      if(inputB){
        inputB.addEventListener('input', updateCompareStats);
        inputB.addEventListener('change', updateCompareStats);
        inputB.addEventListener('keydown', (e) => {
          if(e.key === 'Escape' && comparePanel && !comparePanel.hidden){
            e.preventDefault();
            comparePanel.hidden = true;
            if(compareToggle){
              compareToggle.setAttribute('aria-expanded', 'false');
              compareToggle.classList.remove('qf-open');
              compareToggle.textContent = '+ compare';
            }
            input.focus();
          }
        });
      }

      /* Export comparison as PNG — render the verdict + side-by-side
       * stats to a canvas, then download as a PNG. Uses the same
       * Blob + download pattern as the calendar export. The user
       * gets a shareable image for Slack/email threads. */
      if(comparePngBtn){
        comparePngBtn.addEventListener('click', () => {
          if(!compareStats || !compareVerdict) return;
          const verdictText = (compareVerdict.textContent || '').trim();
          const verdictCls = (compareVerdict.className || '').match(/cmp-verdict-(\w+)/);
          const verdictKind = verdictCls ? verdictCls[1] : 'even';
          if(!verdictText) return;
          // Parse the rendered table to a 2D array (rows × cols)
          const table = compareStats.querySelector('table');
          const rows = [];
          if(table){
            const trs = table.querySelectorAll('tr');
            trs.forEach(tr => {
              const cells = Array.from(tr.querySelectorAll('th,td')).map(c => c.textContent.trim());
              rows.push(cells);
            });
          }
          // Render to canvas
          const W = 560, rowH = 36, headerH = 60, verdictH = 56, footerH = 32;
          // Parse the diff section (when present) so the PNG is a
          // complete shareable artifact — verdict + stats + unique
          // clauses all in one image.
          const diffRows = [];
          if(compareDiff && !compareDiff.hidden){
            const items = compareDiff.querySelectorAll('.cmp-diff-row');
            items.forEach(d => {
              const label = (d.querySelector('b') || {}).textContent || '';
              const sentences = Array.from(d.querySelectorAll('li')).map(li => (li.textContent || '').trim()).filter(Boolean);
              if(sentences.length){
                diffRows.push({ label: label.trim(), sentences });
              }
            });
          }
          // Measure the diff block height (each sentence capped at 2
          // lines × 16px line-height ≈ 32px; + label header ~22px)
          const diffLineH = 16;
          const diffLabelH = 22;
          const diffSideW = (W - 16 - 16 - 8) / 2;
          const measureDiff = (d) => {
            ctx.save();
            ctx.font = '12px monospace';
            // Crude word-wrap estimate: clip to chars that fit the
            // column width, then count lines.
            const pxPerChar = 7; // monospace estimate
            const charsPerLine = Math.max(20, Math.floor(diffSideW / pxPerChar));
            const lines = d.sentences.reduce((n, s) => {
              const clipped = s.slice(0, 120);
              return n + Math.max(1, Math.ceil(clipped.length / charsPerLine));
            }, 0);
            ctx.restore();
            return diffLabelH + (lines * diffLineH) + 8;
          };
          const diffH = diffRows.reduce((n, d) => n + measureDiff(d), 0) + (diffRows.length ? 28 : 0);
          const H = headerH + verdictH + (rows.length * rowH) + diffH + footerH;
          const canvas = document.createElement('canvas');
          canvas.width = W; canvas.height = H;
          const ctx = canvas.getContext('2d');
          // Background — paper
          ctx.fillStyle = '#EDE7D8';
          ctx.fillRect(0, 0, W, H);
          // Header bar
          ctx.fillStyle = '#14120E';
          ctx.fillRect(0, 0, W, headerH);
          ctx.fillStyle = '#FF3B00';
          ctx.font = 'bold 24px monospace';
          ctx.fillText('CLEARDOC', 16, 28);
          ctx.fillStyle = '#EDE7D8';
          ctx.font = '12px monospace';
          ctx.fillText('document comparison', 16, 48);
          // Verdict band
          const verdictColor = verdictKind === 'danger' ? '#C6361F' :
                               verdictKind === 'amber' ? '#9A6A00' : '#5A554A';
          ctx.fillStyle = verdictColor;
          ctx.fillRect(0, headerH, W, verdictH);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 18px monospace';
          ctx.fillText(verdictText, 18, headerH + 36);
          // Table
          const tableY = headerH + verdictH;
          if(rows.length){
            const labelW = 110;
            const colW = (W - 16 - labelW - 16) / 2;
            // Header row
            ctx.fillStyle = '#14120E';
            ctx.fillRect(0, tableY, W, rowH);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px monospace';
            ctx.fillText('', 16, tableY + 22);
            ctx.fillText('ORIGINAL', 16 + labelW, tableY + 22);
            ctx.fillText('COMPARE', 16 + labelW + colW, tableY + 22);
            // Body rows
            for(let i = 1; i < rows.length; i++){
              const r = rows[i];
              const y = tableY + i * rowH;
              if(i % 2 === 0){ ctx.fillStyle = '#E3DBC8'; ctx.fillRect(0, y, W, rowH); }
              ctx.fillStyle = '#5A554A';
              ctx.font = '11px monospace';
              ctx.fillText((r[0] || '').toUpperCase(), 16, y + 22);
              ctx.fillStyle = '#14120E';
              ctx.font = 'bold 14px monospace';
              ctx.fillText((r[1] || '').slice(0, 24), 16 + labelW, y + 22);
              ctx.fillText((r[2] || '').slice(0, 24), 16 + labelW + colW, y + 22);
            }
          }
          // Diff block — unique-clauses section
          if(diffRows.length){
            const diffY = tableY + (rows.length * rowH);
            // Sub-header bar
            ctx.fillStyle = '#14120E';
            ctx.fillRect(0, diffY, W, 28);
            ctx.fillStyle = '#FF3B00';
            ctx.font = 'bold 11px monospace';
            ctx.fillText("// WHAT'S DIFFERENT", 16, diffY + 18);
            ctx.fillStyle = '#EDE7D8';
            ctx.font = '10px monospace';
            ctx.fillText(diffRows[0].sentences.length + ' + ' + (diffRows[1] ? diffRows[1].sentences.length : 0) + ' unique clauses', W - 200, diffY + 18);
            // Render each side
            let penY = diffY + 28 + 8;
            const pxPerChar = 7;
            const charsPerLine = Math.max(20, Math.floor(diffSideW / pxPerChar));
            diffRows.forEach((d, idx) => {
              const x = idx === 0 ? 16 : (16 + diffSideW + 8);
              ctx.fillStyle = '#5A554A';
              ctx.font = 'bold 10px monospace';
              ctx.fillText((d.label || '').toUpperCase(), x, penY + 12);
              penY += diffLabelH;
              ctx.fillStyle = '#14120E';
              ctx.font = '12px monospace';
              d.sentences.slice(0, 4).forEach(s => {
                const clipped = s.slice(0, 120);
                // Word-wrap to charsPerLine
                for(let i = 0; i < clipped.length; i += charsPerLine){
                  ctx.fillText(clipped.slice(i, i + charsPerLine), x, penY);
                  penY += diffLineH;
                }
              });
              penY += 4;
            });
          }
          // Footer
          ctx.fillStyle = '#5A554A';
          ctx.font = '10px monospace';
          const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
          ctx.fillText('cleardoc.app · exported ' + ts + ' UTC', 16, H - 12);
          // Download
          try {
            canvas.toBlob((blob) => {
              if(!blob) return;
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'cleardoc-comparison-' + Date.now() + '.png';
              a.click();
              URL.revokeObjectURL(url);
              // Flash feedback
              const orig = '📸 Export PNG';
              comparePngBtn.textContent = '✓ exported';
              clearTimeout(comparePngBtn._flashTimer);
              comparePngBtn._flashTimer = setTimeout(() => {
                comparePngBtn.textContent = orig;
              }, 1400);
            }, 'image/png');
          } catch(_){}
        });
      }

      /* Side-by-side comparison stats — fires on input changes to
       * either textarea. Renders a 2-column row (Original | Compare)
       * showing type, level, risks, deadlines. The riskier side is
       * highlighted with .cmp-riskier so users see "LEFT is riskier"
       * without parsing every cell. Hidden when panel closed or
       * B side is empty. */
      function updateCompareStats(){
        if(!comparePanel || !compareStats) return;
        if(comparePanel.hidden){
          compareStats.innerHTML = '';
          if(compareVerdict){ compareVerdict.hidden = true; compareVerdict.textContent = ''; }
          if(compareDiff){ compareDiff.hidden = true; compareDiff.innerHTML = ''; }
          return;
        }
        const a = input ? (input.value || '') : '';
        const b = inputB ? (inputB.value || '') : '';
        if(!b.trim()){
          compareStats.innerHTML = '';
          if(compareVerdict){ compareVerdict.hidden = true; compareVerdict.textContent = ''; }
          if(compareDiff){ compareDiff.hidden = true; compareDiff.innerHTML = ''; }
          return;
        }
        const stat = (raw) => {
          const dt = (typeof detectDocType === 'function') ? detectDocType(raw) : null;
          const sev = (typeof countRisksBySeverity === 'function') ? countRisksBySeverity(raw) : {trap:0,watch:0,note:0};
          const grade = (typeof gradeLevel === 'function' && typeof friendlyGrade === 'function')
            ? friendlyGrade(gradeLevel(raw)) : null;
          const dls = (typeof extractDeadlines === 'function') ? extractDeadlines(raw) : [];
          return {
            type: dt ? dt.label : '—',
            risks: sev.trap + sev.watch + sev.note,
            trap: sev.trap,
            level: grade || '—',
            deadlines: dls.length,
          };
        };
        const sa = stat(a), sb = stat(b);
        // Identify riskier side: traps first (worst signal), then total
        // risks, then deadlines. Any column that "wins" is highlighted.
        let leftRiskier = false, rightRiskier = false;
        let verdict = '', verdictCls = '';
        const diff = (n) => (n > 1 ? 's' : '');
        if(sb.trap > sa.trap){
          rightRiskier = true;
          const d = sb.trap - sa.trap;
          verdict = 'COMPARE WINS — ' + d + ' more trap' + diff(d);
          verdictCls = 'cmp-verdict-danger';
        } else if(sa.trap > sb.trap){
          leftRiskier = true;
          const d = sa.trap - sb.trap;
          verdict = 'ORIGINAL WINS — ' + d + ' more trap' + diff(d);
          verdictCls = 'cmp-verdict-danger';
        } else if(sb.risks > sa.risks){
          rightRiskier = true;
          const d = sb.risks - sa.risks;
          verdict = 'COMPARE WINS — ' + d + ' more risk' + diff(d);
          verdictCls = 'cmp-verdict-amber';
        } else if(sa.risks > sb.risks){
          leftRiskier = true;
          const d = sa.risks - sb.risks;
          verdict = 'ORIGINAL WINS — ' + d + ' more risk' + diff(d);
          verdictCls = 'cmp-verdict-amber';
        } else if(sb.deadlines > sa.deadlines){
          rightRiskier = true;
          const d = sb.deadlines - sa.deadlines;
          verdict = 'COMPARE WINS — ' + d + ' more deadline' + diff(d);
          verdictCls = 'cmp-verdict-amber';
        } else if(sa.deadlines > sb.deadlines){
          leftRiskier = true;
          const d = sa.deadlines - sb.deadlines;
          verdict = 'ORIGINAL WINS — ' + d + ' more deadline' + diff(d);
          verdictCls = 'cmp-verdict-amber';
        } else {
          verdict = 'EVEN — both score identically';
          verdictCls = 'cmp-verdict-even';
        }
        // Render the verdict badge above the table
        if(compareVerdict){
          compareVerdict.hidden = false;
          compareVerdict.textContent = verdict;
          compareVerdict.className = 'compare-verdict mono ' + verdictCls;
        }
        const cell = (s, risk) => '<td class="' + (risk ? 'cmp-riskier' : '') + '">' + s + '</td>';
        compareStats.innerHTML =
          '<table class="cmp-table">' +
          '<thead><tr><th></th>' + cell('Original', leftRiskier) + cell('Compare', rightRiskier) + '</tr></thead>' +
          '<tbody>' +
            '<tr><th>type</th>' + cell(esc(sa.type)) + cell(esc(sb.type)) + '</tr>' +
            '<tr><th>level</th>' + cell(esc(sa.level)) + cell(esc(sb.level)) + '</tr>' +
            '<tr><th>risks</th>' + cell(String(sa.risks) + (sa.trap ? ' <span class="cmp-trap">(' + sa.trap + ' trap)</span>' : '')) + cell(String(sb.risks) + (sb.trap ? ' <span class="cmp-trap">(' + sb.trap + ' trap)</span>' : '')) + '</tr>' +
            '<tr><th>deadlines</th>' + cell(String(sa.deadlines)) + cell(String(sb.deadlines)) + '</tr>' +
          '</tbody></table>';
        // Diff — sentence-level. Pairs with the verdict by answering
        // "what's actually different?" beyond the score. Cap at 5
        // per side so the panel doesn't flood.
        if(compareDiff && typeof diffSentences === 'function'){
          const d = diffSentences(a, b);
          const totalDiff = d.onlyA.length + d.onlyB.length;
          if(totalDiff === 0){
            compareDiff.hidden = true;
            compareDiff.innerHTML = '';
          } else {
            compareDiff.hidden = false;
            const row = (label, items, cls) => {
              if(items.length === 0) return '';
              return '<div class="cmp-diff-row ' + cls + '"><b>only in ' + label +
                ' (' + items.length + ')</b><ol>' +
                items.map(s => '<li>' + esc(s) + '</li>').join('') +
                '</ol></div>';
            };
            // Shared-count header — "X in both" plus the two
            // only-in counts, all in one line so users see the
            // shape of the diff at a glance before reading the rows.
            const shared = typeof d.shared === 'number' ? d.shared : 0;
            compareDiff.innerHTML =
              '<div class="cmp-diff-head">// what\'s different</div>' +
              '<div class="cmp-diff-summary"><b>' + shared + '</b> in both' +
              ' · <b>' + d.onlyA.length + '</b> only in Original' +
              ' · <b>' + d.onlyB.length + '</b> only in Compare</div>' +
              row('Original', d.onlyA, 'cmp-diff-a') +
              row('Compare',  d.onlyB, 'cmp-diff-b');
          }
        }
      }

      /* Jargon-swap button — toggles a plain-English preview under the
       * doc-summary. Reuses the home-page clarify() engine so the
       * mappings stay in sync with the home-page BYOF demo. The
       * rendered HTML is stashed on the button at updateTextStats()
       * time so the click is O(1) — no re-clarify on every open. */
      if(dsJargon && dsJargonPreview){
        dsJargon.addEventListener('click', () => {
          if(!dsJargon._previewHtml){
            dsJargon.hidden = true;
            return;
          }
          const willOpen = dsJargonPreview.hidden;
          dsJargonPreview.hidden = !willOpen;
          dsJargon.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
          dsJargon.classList.toggle('ds-open', willOpen);
          if(willOpen){
            dsJargonPreview.innerHTML = dsJargon._previewHtml;
          }
        });
        dsJargon.addEventListener('keydown', (e) => {
          if(e.key === 'Escape' && !dsJargonPreview.hidden){
            e.preventDefault();
            dsJargonPreview.hidden = true;
            dsJargon.setAttribute('aria-expanded', 'false');
            dsJargon.classList.remove('ds-open');
          }
        });
      }

      /* Click-to-expand: toggles the matched-pattern list under the
       * risk pill. Pressing Escape while focused collapses it (matches
       * the FAQ disclosure pattern elsewhere in the app). */
      if(riskPreview){
        riskPreview.addEventListener('click', () => {
          if(!riskDetail) return;
          const willOpen = riskDetail.hidden;
          riskDetail.hidden = !willOpen;
          riskPreview.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
          riskPreview.classList.toggle('rp-open', willOpen);
        });
        riskPreview.addEventListener('keydown', (e) => {
          if(e.key === 'Escape' && riskDetail && !riskDetail.hidden){
            e.preventDefault();
            riskDetail.hidden = true;
            riskPreview.setAttribute('aria-expanded','false');
            riskPreview.classList.remove('rp-open');
          }
        });
      }
      /* Copy-button delegation on riskDetail. Bound once (outside any
       * per-render loop) so re-renders during typing don't stack
       * handlers — uses event bubbling to catch clicks on the rendered
       * button. Pattern matches the verdictCopyBtn click handler
       * elsewhere in the file (clipboard API + execCommand fallback). */
      /* Calendar-export button — single-click ICS download. Exports
       * ALL detected deadlines (up to 8) as one multi-event .ics,
       * not just the soonest. Uses the same Blob+download pattern
       * as downloadDraftBtn. Stashes the deadlines list on the
       * button via _deadlines so re-renders during typing don't
       * break the binding. */
      /* Deadline-readaloud — speaks each deadline aloud with its
       * urgency. Reuses the same pattern as risk-readaloud:
       * SpeechSynthesisUtterance + boundary-event row highlighting
       * on the timeline dots. Toggles; click again to stop. */
      if(deadlinesSpeakBtn){
        deadlinesSpeakBtn.addEventListener('click', () => {
          const list = deadlinesCalBtn && deadlinesCalBtn._deadlines;
          if(!Array.isArray(list) || list.length === 0) return;
          if(typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.speaking){
            try { window.speechSynthesis.cancel(); } catch(_) {}
            deadlinesSpeakBtn.classList.remove('dp-speaking');
            const dots = deadlinesTimeline ? deadlinesTimeline.querySelectorAll('.dp-dot') : [];
            dots.forEach(d => d.classList.remove('dp-speaking'));
            return;
          }
          if(typeof window === 'undefined' || !('speechSynthesis' in window)){
            deadlinesSpeakBtn.hidden = true;
            return;
          }
          // Format each deadline as spoken text: "Deadline: in 5 days."
          // or "Deadline: tomorrow." or "Deadline: January 15, 2026."
          const phrase = (d) => {
            const u = typeof d.urgencyDays === 'number' ? d.urgencyDays : null;
            let when;
            if(u === null) when = d.label;
            else if(u < 0) when = Math.abs(u) + ' days ago';
            else if(u === 0) when = 'today';
            else if(u === 1) when = 'tomorrow';
            else if(u < 30) when = 'in ' + u + ' days';
            else when = d.label;
            return 'Deadline: ' + when + '.';
          };
          const script = list.map(phrase).join(' ');
          const dots = deadlinesTimeline ? Array.from(deadlinesTimeline.querySelectorAll('.dp-dot')) : [];
          const u = new SpeechSynthesisUtterance(script);
          try {
            const voices = window.speechSynthesis.getVoices();
            const v = voices.find(v => /^en[-_]/i.test(v.lang)) || voices[0];
            if(v) u.voice = v;
          } catch(_){}
          u.rate = 1.0;
          // Compute per-dot charIndex ranges so onboundary can advance
          let perDot = []; // [{end, idx}]
          let pos = 0;
          for(let i = 0; i < list.length; i++){
            pos += phrase(list[i]).length + 1;
            perDot.push({ end: pos, idx: i });
          }
          let activeIdx = -1;
          u.onboundary = (ev) => {
            if(typeof ev.charIndex !== 'number') return;
            let found = activeIdx;
            for(const r of perDot){
              if(ev.charIndex < r.end){ found = r.idx; break; }
              found = r.idx;
            }
            if(found !== activeIdx && found >= 0 && dots[found]){
              activeIdx = found;
              dots.forEach((d, i) => d.classList.toggle('dp-speaking', i === found));
              try { dots[found].scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch(_){}
              // Cross-link to the source textarea — select the matched
              // date string + flash, so users see + hear + read together.
              // Pairs with iter #30 (risk cross-link) and iter #15
              // (click-to-locate). Skipped when the deadline has no
              // captured original match (e.g. relative-only deadlines
              // whose match is just a relative phrase).
              if(input && list[found] && list[found].match){
                const raw = input.value || '';
                const matched = list[found].match;
                const idx = raw.toLowerCase().indexOf(matched.toLowerCase());
                if(idx >= 0){
                  try {
                    input.focus();
                    input.setSelectionRange(idx, idx + matched.length);
                    input.classList.add('rd-flash');
                    clearTimeout(input._rdFlashTimer);
                    input._rdFlashTimer = setTimeout(() => {
                      input.classList.remove('rd-flash');
                    }, 1200);
                  } catch(_){}
                }
              }
            }
          };
          u.onend = u.onerror = () => {
            deadlinesSpeakBtn.classList.remove('dp-speaking');
            dots.forEach(d => d.classList.remove('dp-speaking'));
          };
          try {
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(u);
            deadlinesSpeakBtn.classList.add('dp-speaking');
          } catch(_){}
        });
      }
      if(deadlinesCalBtn){
        deadlinesCalBtn.addEventListener('click', () => {
          const list = deadlinesCalBtn._deadlines;
          if(!Array.isArray(list) || list.length === 0) return;
          const ics = (typeof buildIcs === 'function')
            ? buildIcs(list.map(d => ({ date: d.date, label: d.label })))
            : '';
          if(!ics) return;
          const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          // Filename: cleardoc-deadlines-YYYY-MM-DD.ics — uses the
          // soonest date so the file is easy to identify. Plural
          // ('deadlines' not 'deadline') because we always export
          // multi-event files now.
          const pad = (n) => String(n).padStart(2, '0');
          const soonest = list[0];
          const fname = 'cleardoc-deadlines-' +
            soonest.date.getFullYear() + '-' +
            pad(soonest.date.getMonth() + 1) + '-' +
            pad(soonest.date.getDate()) + '.ics';
          a.download = fname;
          a.click();
          URL.revokeObjectURL(url);
          // Flash feedback — 'added N ✓' if multiple, just 'added ✓' for 1
          const isMulti = list.length > 1;
          const orig = deadlinesCalBtn._origText || (isMulti ? ('+ ' + list.length + ' calendar') : '+ calendar');
          deadlinesCalBtn.textContent = isMulti ? ('added ' + list.length + ' ✓') : 'added ✓';
          clearTimeout(deadlinesCalBtn._flashTimer);
          deadlinesCalBtn._flashTimer = setTimeout(() => {
            deadlinesCalBtn.textContent = orig;
          }, 1400);
        });
      }

      // Iter #80: severity filter — delegated change handler on
      // riskDetail. When the user picks a severity from the <select>,
      // we hide risk-detail-row + risk-counter pairs whose severity
      // doesn't match. Cheap (no re-render needed) — just toggles
      // `display: none` on the existing DOM nodes.
      if(riskDetail){
        riskDetail.addEventListener('change', (e) => {
          const sel = e.target.closest && e.target.closest('[data-rd-severity-filter]');
          if(!sel) return;
          const wantSev = sel.value || '';
          const kids = Array.from(riskDetail.children);
          for(let i = 0; i < kids.length; i++){
            const k = kids[i];
            if(!(k.classList && k.classList.contains('risk-detail-row'))) continue;
            const rowSev = (k.classList.contains('trap') ? 'r' : (k.classList.contains('watch') ? 'a' : 'g'));
            const show = !wantSev || rowSev === wantSev;
            k.style.display = show ? '' : 'none';
            if(kids[i + 1] && kids[i + 1].classList && kids[i + 1].classList.contains('risk-counter')){
              kids[i + 1].style.display = show ? '' : 'none';
              i++;
            }
          }
          const countEl = riskDetail.querySelector('.rd-count');
          if(countEl){
            const visibleRows = kids.filter(k => k.classList && k.classList.contains('risk-detail-row') && k.style.display !== 'none').length;
            countEl.textContent = visibleRows + ' pattern' + (visibleRows === 1 ? '' : 's');
          }
        });
      }

      if(riskDetail){
        riskDetail.addEventListener('click', async (e) => {
          // 0a. Undo chip — restore the input to its pre-apply state.
          // Also clears all "applied" badges so the risk rows reset.
          const undoBtn = e.target.closest && e.target.closest('[data-undo-apply]');
          if(undoBtn && input && typeof input._undoSnapshot === 'string'){
            e.preventDefault();
            e.stopPropagation();
            input.value = input._undoSnapshot;
            input._undoSnapshot = null;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            // Reset all applied badges
            input._appliedSuggestions = null;
            riskDetail.querySelectorAll('.risk-counter.rc-applied').forEach(row => {
              row.classList.remove('rc-applied');
            });
            riskDetail.querySelectorAll('.rc-apply').forEach(btn => {
              btn.textContent = 'apply';
              btn.disabled = false;
            });
            // Hide the chip
            const chip = document.getElementById('applyUndoChip');
            if(chip) chip.hidden = true;
            return;
          }
          // 0b. Apply button — swaps the counter-clause into the source
          // input at the position of the matched token. Stores the
          // previous text on the input so the user can undo with one
          // click ("revert"). Pairs with iter #15's selection logic
          // for visual feedback.
          const rcApply = e.target.closest && e.target.closest('[data-rc-apply]');
          if(rcApply && input){
            e.preventDefault();
            e.stopPropagation();
            const suggestion = rcApply.getAttribute('data-rc-apply') || '';
            const matched = rcApply.getAttribute('data-rc-match') || '';
            if(!suggestion || !matched) return;
            // Single-row dry-run (iter #51) — show the before→after
            // for THIS suggestion in a small confirm modal so the
            // per-row apply is no longer one-click destructive.
            // Lighter than the apply-all modal (single row, no
            // overflow, no "review first" disclaimer — it's just one
            // specific change the user already saw in the suggestion).
            (async () => {
              const rem = (matched || '').trim().split(/\s+/).filter(Boolean).length;
              const add = (suggestion || '').trim().split(/\s+/).filter(Boolean).length;
              const dryrun = '<div class="apply-dryrun">' +
                '<div class="dryrun-stats">1 substitution · <span class="dryrun-add">+' + add + '</span> · <span class="dryrun-remove">−' + rem + '</span></div>' +
                '<div class="dryrun-item">' +
                  '<div class="dryrun-num">1.</div>' +
                  '<div class="dryrun-body">' +
                    '<div class="dryrun-from">− ' + esc(matched) + '</div>' +
                    '<div class="dryrun-to">+ ' + esc(suggestion) + '</div>' +
                  '</div>' +
                '</div>' +
              '</div>';
              const ok = await showConfirmModal({
                title: 'Apply this suggestion?',
                bodyHtml: '<p>This will replace one clause in your document with the counter-suggestion shown below. You can undo with the <b>↶ undo apply</b> chip after.</p>' + dryrun,
                confirmLabel: 'Apply',
              });
              if(!ok) return;
              applyOneMatched(input, suggestion, matched, rcApply);
            })();
            return;
          }
          // 0a. Per-suggestion 💡 tip button (iter #74) — shows
          // why this counter-clause works in a small modal. Builds
          // trust by explaining the legal/business rationale, not
          // just the counter-clause text.
          const rcTip = e.target.closest && e.target.closest('[data-rc-tip]');
          if(rcTip){
            e.preventDefault();
            e.stopPropagation();
            const text = rcTip.getAttribute('data-rc-tip') || '';
            if(!text) return;
            showConfirmModal({
              title: 'Why this works',
              bodyHtml: '<p style="font-family:Archivo,sans-serif;text-transform:none;letter-spacing:0;line-height:1.5">' + esc(text) + '</p>',
              confirmLabel: 'Got it',
            });
            return;
          }
          // 0b. Per-suggestion copy button — copies the counter-clause
          // text only (not the whole match list) so the user can
          // paste it directly into an email / redline.
          const rcCopy = e.target.closest && e.target.closest('[data-rc-copy]');
          if(rcCopy){
            e.preventDefault();
            e.stopPropagation();
            const text = rcCopy.getAttribute('data-rc-copy') || '';
            if(!text) return;
            let ok = false;
            try {
              if(navigator.clipboard && navigator.clipboard.writeText){
                await navigator.clipboard.writeText(text);
                ok = true;
              } else {
                const ta = document.createElement('textarea');
                ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
                document.body.appendChild(ta); ta.select();
                ok = document.execCommand('copy'); document.body.removeChild(ta);
              }
            } catch(_) {}
            const orig = 'copy';
            rcCopy.textContent = ok ? '✓ copied' : 'failed';
            clearTimeout(rcCopy._flashTimer);
            rcCopy._flashTimer = setTimeout(() => { rcCopy.textContent = orig; }, 1400);
            return;
          }
          // 0c. Per-suggestion speak button (iter #55) — speak the
          // counter-clause text aloud so users can rehearse it
          // before they go into a negotiation. Reuses the same
          // SpeechSynthesis pattern as the iter #27/29 TTS.
          const rcSpeak = e.target.closest && e.target.closest('[data-rc-speak]');
          if(rcSpeak && typeof window !== 'undefined' && 'speechSynthesis' in window){
            e.preventDefault();
            e.stopPropagation();
            const text = rcSpeak.getAttribute('data-rc-speak') || '';
            if(!text) return;
            // Stop any current speech first (so multiple plays don't
            // overlap)
            try { window.speechSynthesis.cancel(); } catch(_) {}
            const u = new SpeechSynthesisUtterance(text);
            // Prefer the detected language's voice (iter #35)
            try {
              const input = document.getElementById('docInput');
              const detectedLang = (input && input._detectedLang) || null;
              if(detectedLang && detectedLang.tts){
                u.lang = detectedLang.tts;
                const voices = window.speechSynthesis.getVoices();
                const v = voices.find(v => v && v.lang && v.lang.toLowerCase().startsWith(detectedLang.tts.toLowerCase().split('-')[0]));
                if(v) u.voice = v;
              } else {
                const voices = window.speechSynthesis.getVoices();
                const v = voices.find(v => /^en[-_]/i.test(v.lang)) || voices[0];
                if(v) u.voice = v;
              }
            } catch(_){}
            u.rate = 1.0; u.pitch = 1.0;
            const orig = '🔊';
            rcSpeak.textContent = '◼';
            u.onend = u.onerror = () => {
              rcSpeak.textContent = orig;
            };
            try { window.speechSynthesis.speak(u); } catch(_){}
            return;
          }
          // 1. Copy button takes precedence
          const copyBtn = e.target.closest && e.target.closest('[data-rd-copy]');
          if(copyBtn){
            e.preventDefault();
            e.stopPropagation();
            // Pull the live hit list (matches what's painted). Falls back
            // to scraping rendered rows if matchRisks isn't in scope.
            let hits = (typeof matchRisks === 'function') ? matchRisks(input ? input.value : '') : [];
            if(!Array.isArray(hits) || hits.length === 0){
              const rows = riskDetail.querySelectorAll('.risk-detail-row');
              if(rows.length){
                hits = Array.from(rows).map((r) => {
                  const tag = (r.querySelector('.rd-tag') || {}).textContent || '';
                  const hit = (r.querySelector('.rd-hit') || {}).textContent || '';
                  const why = (r.querySelector('.rd-why') || {}).textContent || '';
                  const sev = /TRAP/.test(tag) ? 'r' : /WATCH/.test(tag) ? 'a' : 'g';
                  return { sev, matched: hit.trim(), why: why.trim() };
                });
              }
            }
            const text = formatMatchesForCopy(hits);
            if(!text) return;
            let ok = false;
            try {
              if(navigator.clipboard && navigator.clipboard.writeText){
                await navigator.clipboard.writeText(text);
                ok = true;
              } else {
                const ta = document.createElement('textarea');
                ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
                document.body.appendChild(ta); ta.select();
                ok = document.execCommand('copy'); document.body.removeChild(ta);
              }
            } catch(_) {}
            const orig = 'Copy';
            copyBtn.textContent = ok ? 'Copied ✓' : 'Copy failed';
            clearTimeout(copyBtn._flashTimer);
            copyBtn._flashTimer = setTimeout(() => { copyBtn.textContent = orig; }, 1400);
            return;
          }
          // 1. Apply-all button — applies every unmatched suggestion
          // in sequence. Iterates the live hit list, swaps each
          // matched token with its counter, and re-renders so the
          // applied badge (iter #46) lights up across all rows.
          const aaBtn = e.target.closest && e.target.closest('[data-rd-apply-all]');
          if(aaBtn && input){
            e.preventDefault();
            e.stopPropagation();
            let hits = (typeof matchRisks === 'function') ? matchRisks(input ? input.value : '') : [];
            if(!Array.isArray(hits) || hits.length === 0) return;
            // Count how many would actually be applied (skip already-applied)
            if(!input._appliedSuggestions) input._appliedSuggestions = new Set();
            const pending = hits.filter(h => h.counter && h.matched && !input._appliedSuggestions.has(h.counter));
            if(pending.length === 0){
              aaBtn.textContent = 'nothing to apply';
              clearTimeout(aaBtn._flashTimer);
              aaBtn._flashTimer = setTimeout(() => { aaBtn.textContent = '✓ Apply all'; }, 1400);
              return;
            }
            // Build a dry-run preview (iter #49) — show each before→after
            // pair in the confirm modal so users see the exact change
            // BEFORE clicking Apply. Cap at 5 visible items + a
            // "(+N more)" line so the modal doesn't overflow.
            // Stats summary (iter #50): word-count delta so users see
            // the magnitude at a glance ("3 substitutions · +18 / -12 words").
            let previewHtml = '';
            let addedWords = 0, removedWords = 0;
            pending.forEach(h => {
              if(!h || !h.matched || !h.counter) return;
              const rem = (h.matched || '').trim().split(/\s+/).filter(Boolean).length;
              const add = (h.counter || '').trim().split(/\s+/).filter(Boolean).length;
              removedWords += rem;
              addedWords += add;
            });
            const wordDelta = addedWords - removedWords;
            const wordDeltaStr = wordDelta === 0 ? '±0' : (wordDelta > 0 ? '+' + wordDelta : String(wordDelta));
            previewHtml += '<div class="dryrun-stats">' +
              '<b>' + pending.length + '</b> substitution' + (pending.length === 1 ? '' : 's') +
              ' · <span class="dryrun-add">+' + addedWords + ' words</span>' +
              ' · <span class="dryrun-remove">−' + removedWords + ' words</span>' +
              ' · <span class="dryrun-delta">net ' + wordDeltaStr + '</span>' +
            '</div>';
            previewHtml += '<div class="apply-dryrun">';
            const visible = pending.slice(0, 5);
            visible.forEach((h, i) => {
              previewHtml += '<div class="dryrun-item">' +
                '<div class="dryrun-num">' + (i + 1) + '.</div>' +
                '<div class="dryrun-body">' +
                  '<div class="dryrun-from">− ' + esc(h.matched) + '</div>' +
                  '<div class="dryrun-to">+ ' + esc(h.counter) + '</div>' +
                '</div>' +
              '</div>';
            });
            if(pending.length > visible.length){
              previewHtml += '<div class="dryrun-more">+ ' + (pending.length - visible.length) + ' more change' +
                (pending.length - visible.length === 1 ? '' : 's') + ' …</div>';
            }
            previewHtml += '</div>';
            // Confirm before destructive batch apply (iter #48) —
            // prevents accidental rewrites of a long document.
            (async () => {
              const ok = await showConfirmModal({
                title: 'Apply ' + pending.length + ' suggestion' + (pending.length === 1 ? '' : 's') + '?',
                bodyHtml: '<p>This will replace <b>' + pending.length + '</b> matched clause' +
                  (pending.length === 1 ? '' : 's') + ' in your document with the counter-suggestions ' +
                  'shown above. You can undo with the <b>↶ undo apply</b> chip after.</p>' +
                  previewHtml +
                  '<p class="apply-confirm-note">Tip: review each suggestion before applying — counter-clauses ' +
                  'are a starting point, not legal advice.</p>',
                confirmLabel: 'Apply all',
              });
              if(!ok) return;
              doApplyAll(pending, input, aaBtn);
            })();
            return;
          }
          // 1a. Redline button — export counter-suggestions as a
          // downloadable text file (pasteable into Word / email as a
          // negotiation starting point). Same hit-list lookup as Copy.
          const rlBtn = e.target.closest && e.target.closest('[data-rd-redline]');
          if(rlBtn){
            e.preventDefault();
            e.stopPropagation();
            let hits = (typeof matchRisks === 'function') ? matchRisks(input ? input.value : '') : [];
            if(!Array.isArray(hits) || hits.length === 0){
              const rows = riskDetail.querySelectorAll('.risk-detail-row');
              if(rows.length){
                hits = Array.from(rows).map((r) => {
                  const tag = (r.querySelector('.rd-tag') || {}).textContent || '';
                  const hit = (r.querySelector('.rd-hit') || {}).textContent || '';
                  const why = (r.querySelector('.rd-why') || {}).textContent || '';
                  const counter = (r.nextElementSibling && r.nextElementSibling.classList && r.nextElementSibling.classList.contains('risk-counter'))
                    ? ((r.nextElementSibling.querySelector('.rc-text') || {}).textContent || '').trim() : '';
                  const sev = /TRAP/.test(tag) ? 'r' : /WATCH/.test(tag) ? 'a' : 'g';
                  return { sev, matched: hit.trim(), why: why.trim(), counter };
                });
              }
            }
            const text = (typeof formatRedline === 'function') ? formatRedline(hits) : '';
            if(!text) return;
            try {
              const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'cleardoc-redline-' + Date.now() + '.txt';
              a.click();
              URL.revokeObjectURL(url);
              rlBtn.textContent = '✓ exported';
              clearTimeout(rlBtn._flashTimer);
              rlBtn._flashTimer = setTimeout(() => { rlBtn.textContent = '📝 redline'; }, 1400);
            } catch(_){}
            return;
          }
          // 1b. Speak button — read the matched patterns aloud via
          // SpeechSynthesis. Each row gets a karaoke-style highlight
          // as the voice reads it (reuses the rd-speaking class).
          // 0d. Speak-all-suggestions button (iter #56) — speak every
          // counter-suggestion in sequence so users can rehearse
          // the entire negotiation playbook in one pass. Uses the
          // same SpeechSynthesis pipeline as iter #55's per-row
          // speak button, with a queue to play them in order.
          const speakAllBtn = e.target.closest && e.target.closest('[data-rd-speak-suggestions]');
          if(speakAllBtn && typeof window !== 'undefined' && 'speechSynthesis' in window){
            e.preventDefault();
            e.stopPropagation();
            let hits = (typeof matchRisks === 'function') ? matchRisks(input ? input.value : '') : [];
            if(!Array.isArray(hits) || hits.length === 0) return;
            const speakable = hits.filter(h => h.counter);
            if(speakable.length === 0) return;
            // Toggle: stop if already speaking
            if(window.speechSynthesis.speaking){
              try { window.speechSynthesis.cancel(); } catch(_) {}
              speakAllBtn.textContent = '🔊 Read all';
              return;
            }
            try { window.speechSynthesis.cancel(); } catch(_) {}
            const detectedLang = (input && input._detectedLang) || null;
            const pickVoiceLocal = (langTag) => {
              try {
                const voices = window.speechSynthesis.getVoices();
                if(langTag){
                  const prefix = String(langTag).toLowerCase().split('-')[0];
                  return voices.find(v => v && v.lang && v.lang.toLowerCase().startsWith(prefix)) || voices.find(v => /^en[-_]/i.test(v.lang)) || voices[0] || null;
                }
                return voices.find(v => /^en[-_]/i.test(v.lang)) || voices[0] || null;
              } catch(_) { return null; }
            };
            const voice = pickVoiceLocal(detectedLang && detectedLang.tts);
            // Build a script: each suggestion as a separate
            // utterance so the user can pause between them
            // (SpeechSynthesisUtterance.onend chains to the next).
            const queue = [];
            const labelFor = (h) => (h.sev === 'r' ? 'trap' : (h.sev === 'a' ? 'watch' : 'note'));
            speakable.forEach((h, i) => {
              const u = new SpeechSynthesisUtterance(labelFor(h) + '. ' + h.counter);
              if(voice) u.voice = voice;
              if(detectedLang && detectedLang.tts) u.lang = detectedLang.tts;
              u.rate = 1.0; u.pitch = 1.0;
              queue.push(u);
            });
            // Chain: each utterance's onend triggers the next
            queue.forEach((u, i) => {
              u.onend = () => {
                if(i + 1 < queue.length){
                  try { window.speechSynthesis.speak(queue[i + 1]); } catch(_) {}
                } else {
                  // Last one done — restore button label
                  speakAllBtn.textContent = '🔊 Read all';
                }
              };
              u.onerror = () => { speakAllBtn.textContent = '🔊 Read all'; };
            });
            try {
              window.speechSynthesis.speak(queue[0]);
              speakAllBtn.textContent = '◼ Stop';
            } catch(_){}
            return;
          }
          const speakBtn = e.target.closest && e.target.closest('[data-rd-speak]');
          if(speakBtn && typeof window !== 'undefined' && 'speechSynthesis' in window){
            e.preventDefault();
            e.stopPropagation();
            // If currently speaking, stop
            if(window.speechSynthesis.speaking){
              try { window.speechSynthesis.cancel(); } catch(_) {}
              speakBtn.classList.remove('rd-speaking');
              return;
            }
            // Pull the live hit list (matches what's painted)
            let hits = (typeof matchRisks === 'function') ? matchRisks(input ? input.value : '') : [];
            if(!Array.isArray(hits) || hits.length === 0){
              const rows = riskDetail.querySelectorAll('.risk-detail-row');
              if(rows.length){
                hits = Array.from(rows).map((r) => {
                  const tag = (r.querySelector('.rd-tag') || {}).textContent || '';
                  const hit = (r.querySelector('.rd-hit') || {}).textContent || '';
                  const why = (r.querySelector('.rd-why') || {}).textContent || '';
                  const sev = /TRAP/.test(tag) ? 'r' : /WATCH/.test(tag) ? 'a' : 'g';
                  return { sev, matched: hit.trim(), why: why.trim() };
                });
              }
            }
            if(!hits.length) return;
            // Build a spoken script with explicit per-row markers so we
            // can advance the highlight via boundary events. Inject a
            // silent-ish marker (a period) between each row so the
            // boundary event fires reliably for each transition.
            const labelFor = (h) => h.sev === 'r' ? 'trap' : (h.sev === 'a' ? 'watch' : 'note');
            const script = hits.map(h => labelFor(h) + '. ' + (h.matched || '') + '. ' + (h.why || '') + '.').join(' ');
            const rowSpans = Array.from(riskDetail.querySelectorAll('.risk-detail-row'));
            const u = new SpeechSynthesisUtterance(script);
            // Prefer English voice
            try {
              const voices = window.speechSynthesis.getVoices();
              const v = voices.find(v => /^en[-_]/i.test(v.lang)) || voices[0];
              if(v) u.voice = v;
            } catch(_){}
            u.rate = 1.0;
            // Estimate which row is being spoken by tracking charIndex
            let perRow = []; // [{end: charIndex, idx: rowIdx}]
            let pos = 0;
            for(let i = 0; i < hits.length; i++){
              const line = labelFor(hits[i]) + '. ' + (hits[i].matched || '') + '. ' + (hits[i].why || '') + '.';
              pos += line.length + 1; // +1 for the join space
              perRow.push({ end: pos, idx: i });
            }
            let activeIdx = -1;
            u.onboundary = (ev) => {
              if(typeof ev.charIndex !== 'number') return;
              let found = activeIdx;
              for(const r of perRow){
                if(ev.charIndex < r.end){ found = r.idx; break; }
                found = r.idx;
              }
              if(found !== activeIdx && found >= 0 && rowSpans[found]){
                activeIdx = found;
                rowSpans.forEach((s, i) => s.classList.toggle('rd-speaking', i === found));
                try { rowSpans[found].scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch(_){}
                // Cross-link to the source textarea — highlight the
                // matched term in the original input as the voice
                // reads it. Users see + hear + read together. Pairs
                // with iter #15's click-to-locate; same selection
                // semantics (case-insensitive indexOf, sentence-
                // extending selection).
                if(input && hits[found] && hits[found].matched){
                  const raw = input.value || '';
                  const matched = hits[found].matched;
                  const idx = raw.toLowerCase().indexOf(matched.toLowerCase());
                  if(idx >= 0){
                    const sentenceTerm = /[.!?;\n]/g;
                    const startMatch = raw.slice(0, idx).search(sentenceTerm);
                    const selStart = startMatch < 0 ? 0 : startMatch + 1;
                    const after = raw.slice(idx + matched.length);
                    const endRel = after.search(sentenceTerm);
                    const selEnd = idx + matched.length + (endRel < 0 ? 0 : endRel);
                    try {
                      input.focus();
                      input.setSelectionRange(selStart, selEnd);
                      input.classList.add('rd-flash');
                      clearTimeout(input._rdFlashTimer);
                      input._rdFlashTimer = setTimeout(() => {
                        input.classList.remove('rd-flash');
                      }, 1200);
                    } catch(_){}
                  }
                }
              }
            };
            u.onend = u.onerror = () => {
              speakBtn.classList.remove('rd-speaking');
              rowSpans.forEach(s => s.classList.remove('rd-speaking'));
            };
            try {
              window.speechSynthesis.cancel();
              window.speechSynthesis.speak(u);
              speakBtn.classList.add('rd-speaking');
            } catch(_){}
            return;
          }
          // 2. Row click → locate the source sentence in the input
          const row = e.target.closest && e.target.closest('[data-rd-locate]');
          if(row && input){
            e.preventDefault();
            e.stopPropagation();
            const matched = row.getAttribute('data-rd-locate') || '';
            if(!matched) return;
            const raw = input.value || '';
            const idx = raw.toLowerCase().indexOf(matched.toLowerCase());
            if(idx < 0) return;
            // Extend selection to the surrounding sentence so users see
            // context, not just the bare matched token. Sentence = run of
            // non-terminator chars on either side.
            const sentenceTerm = /[.!?;\n]/g;
            const startMatch = raw.slice(0, idx).search(sentenceTerm);
            const selStart = startMatch < 0 ? 0 : startMatch + 1;
            const after = raw.slice(idx + matched.length);
            const endRel = after.search(sentenceTerm);
            const selEnd = idx + matched.length + (endRel < 0 ? 0 : endRel);
            input.focus();
            try { input.setSelectionRange(selStart, selEnd); } catch(_) {}
            // Brief flash on the textarea so the selection is visible
            // even if the user's eye was on the risk list a moment ago.
            input.classList.add('rd-flash');
            clearTimeout(input._rdFlashTimer);
            input._rdFlashTimer = setTimeout(() => {
              input.classList.remove('rd-flash');
            }, 1200);
          }
        });
        // Keyboard parity: Enter / Space on a focused row triggers locate
        riskDetail.addEventListener('keydown', (e) => {
          if(e.key !== 'Enter' && e.key !== ' ') return;
          const row = e.target.closest && e.target.closest('[data-rd-locate]');
          if(!row) return;
          e.preventDefault();
          row.click();
        });
      }

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

    /* Iter #67: Document version comparison — store the current
     * risk state as a "before" version, then any future re-analysis
     * shows the delta. Lets users see the impact of their edits
     * (e.g. "Down from 7 risks to 4"). Persists across reloads so
     * users can save a version Monday, edit Tuesday, analyze
     * Wednesday, and see the comparison. */
    const VERSION_KEY = 'cleardoc:savedVersion';
    const VERSIONS_MAX = 5;
    // Iter #71: localStorage now stores an ARRAY of versions
    // (was a single object in iter #67). Older single-object
    // payloads are normalized to a one-element array on read.
    function readVersions(){
      try {
        const raw = localStorage.getItem(VERSION_KEY);
        if(!raw) return [];
        const v = JSON.parse(raw);
        if(Array.isArray(v)) return v.filter(x => x && typeof x.ts === 'number');
        // Legacy single-object payload → wrap it
        if(v && typeof v.ts === 'number') return [v];
        return [];
      } catch(_){ return []; }
    }
    function writeVersions(arr){
      try {
        const trimmed = arr.slice(0, VERSIONS_MAX);
        localStorage.setItem(VERSION_KEY, JSON.stringify(trimmed));
      } catch(_){}
    }
    // The "active" version is the most-recently-saved one by
    // default. Users can pick a different one via the
    // savedVersionSelect dropdown.
    let _activeVersionId = null;
    function getActiveVersion(){
      const arr = readVersions();
      if(arr.length === 0) return null;
      if(_activeVersionId){
        const found = arr.find(v => v.id === _activeVersionId);
        if(found) return found;
      }
      return arr[0]; // most recent
    }
    function getSavedVersion(){
      return getActiveVersion();
    }
    function saveCurrentVersion(name){
      if(typeof matchRisks !== 'function' || !input) return;
      const raw = input.value || '';
      if(raw.length < 12) return;
      const hits = matchRisks(raw);
      const count = hits.length;
      const trap  = hits.filter(h => h && h.sev === 'r').length;
      const watch = hits.filter(h => h && h.sev === 'a').length;
      const note  = hits.filter(h => h && h.sev === 'g').length;
      const ts = Date.now();
      const id = 'v_' + ts + '_' + Math.random().toString(36).slice(2, 8);
      const label = (name && name.trim()) || ('Snapshot ' + (readVersions().length + 1));
      const entry = {
        id, ts, label, count, trap, watch, note,
        snippet: raw.slice(0, 80).replace(/\s+/g, ' '),
      };
      const arr = readVersions();
      arr.unshift(entry);
      writeVersions(arr);
      _activeVersionId = id;
    }
    function deleteVersion(id){
      const arr = readVersions().filter(v => v.id !== id);
      writeVersions(arr);
      if(_activeVersionId === id){
        _activeVersionId = arr.length > 0 ? arr[0].id : null;
      }
    }
    function clearAllVersions(){
      try { localStorage.removeItem(VERSION_KEY); } catch(_){}
      _activeVersionId = null;
    }
    const saveVersionBtn = document.getElementById('saveVersionBtn');
    const clearVersionBtn = document.getElementById('clearVersionBtn');
    function showClearVersionBtn(){
      if(!clearVersionBtn) return;
      const v = getSavedVersion();
      clearVersionBtn.hidden = !v;
      // Iter #69: also show a persistent "📌 vs saved version"
      // badge while a baseline exists, so users always know there's
      // something to compare against.
      if(savedVersionBadge){
        if(v){
          savedVersionBadge.hidden = false;
          const ago = (Date.now() - v.ts) < 60000 ? 'just now' :
            (typeof formatRelativeTime === 'function' ? formatRelativeTime(v.ts) : 'recently');
          savedVersionBadge.textContent = '📌 vs saved version (' + v.count + ' risks · ' + ago + ')';
          savedVersionBadge.title = 'The next analysis will compare against this saved baseline. ' +
            (v.snippet ? 'Saved snippet: "' + v.snippet + '"' : '');
        } else {
          savedVersionBadge.hidden = true;
        }
      }
      // Iter #73: snippet preview — when a saved version is active,
      // show its saved snippet inline so users can verify which
      // version they're comparing against without opening DevTools.
      if(savedVersionSnippet){
        if(v && v.snippet){
          savedVersionSnippet.hidden = false;
          savedVersionSnippet.innerHTML = '📄 <b>' + esc(v.label) + '</b>: "' +
            esc(v.snippet) + '"';
        } else {
          savedVersionSnippet.hidden = true;
        }
      }
      // Iter #76: show the "📚 history" button whenever a version
      // exists. Click → modal with the full list of saved versions
      // (date + count + snippet) for inspection.
      if(versionHistoryBtn){
        const allVersions = readVersions();
        versionHistoryBtn.hidden = allVersions.length === 0;
      }
    }
    // Iter #76: version history modal — shows the full list of
    // saved versions in chronological order (newest first, same
    // order as the picker). Uses showConfirmModal with custom HTML
    // for the list, so we can render the rich row content.
    // Iter #77: risk-trend button visibility — shown when there's
    // at least 2 trend points (1 point is meaningless).
    if(riskTrendBtn){
      const trend = (typeof getRiskTrend === 'function') ? getRiskTrend() : [];
      riskTrendBtn.hidden = trend.length < 2;
    }
    // Iter #78: Negotiation playbook export — opens a printable
    // window with a structured checklist of the current suggestions,
    // tips, and saved versions. Users can print to PDF or share
    // with a co-counsel before going into a negotiation.
    if(playbookBtn){
      playbookBtn.addEventListener('click', () => {
        // Read the rendered risk list so the playbook matches what's
        // visible in the expanded list (keeps the two surfaces in sync).
        const items = [];
        let prevRisk = null;
        if(riskDetail){
          for(const row of Array.from(riskDetail.children)){
            if(row.classList && row.classList.contains('risk-detail-row')){
              prevRisk = row;
            } else if(row.classList && row.classList.contains('risk-counter') && prevRisk){
              const tag = (prevRisk.querySelector('.rd-tag') || {}).textContent || '';
              const original = (prevRisk.querySelector('.rd-hit') || {}).textContent || '';
              const counter = (row.querySelector('.rc-text') || {}).textContent || '';
              const tipEl = row.querySelector('.rc-tip');
              const tip = tipEl ? tipEl.getAttribute('data-rc-tip') : '';
              const applyBtn = row.querySelector('.rc-apply');
              const applied = applyBtn ? applyBtn.disabled : false;
              items.push({ tag: tag.trim(), original: original.trim(), counter: counter.trim(), tip: tip ? tip.trim() : '', applied });
              prevRisk = null;
            }
          }
        }
        const versions = readVersions();
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        // Build a printable HTML document. Opens in a new window
        // so the user can print to PDF via the browser dialog.
        const html = '<!doctype html><html><head><meta charset="utf-8"><title>Negotiation Playbook · ' +
          dateStr + '</title>' +
          '<style>' +
          'body{font-family:Archivo,sans-serif;color:#14120E;max-width:780px;margin:40px auto;padding:0 20px;line-height:1.5}' +
          'h1{font-size:24px;border-bottom:3px solid #14120E;padding-bottom:8px}' +
          'h2{font-size:18px;margin-top:32px;color:#5A554A}' +
          '.meta{color:#5A554A;font-size:13px;margin-bottom:24px}' +
          'ol{padding-left:24px}li{margin-bottom:16px}' +
          '.tag{display:inline-block;padding:2px 8px;background:#14120E;color:#EDE7D8;font-family:"JetBrains Mono",monospace;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-right:8px}' +
          '.tag.trap{background:#C6361F}.tag.watch{background:#9A6A00}.tag.note{background:#176B53}' +
          '.original{font-style:italic;color:#5A554A;margin:4px 0}' +
          '.counter{font-weight:600;margin:4px 0}' +
          '.tip{background:#f3f3f3;padding:8px 12px;margin:8px 0;font-size:13px;border-left:3px solid #FF3B00}' +
          '.applied{color:#176B53;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}' +
          '.empty{color:#5A554A;font-style:italic}' +
          '.version{border:1px solid #ddd;padding:8px;margin:6px 0;font-size:13px}' +
          '.version .name{font-weight:600}' +
          '.version .meta{font-size:11px;font-family:"JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.04em}' +
          '.footer{margin-top:48px;padding-top:16px;border-top:1px solid #ddd;font-size:11px;color:#5A554A;font-family:"JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.04em}' +
          '@media print{body{margin:0;max-width:100%}}' +
          '</style></head><body>' +
          '<h1>Negotiation Playbook</h1>' +
          '<p class="meta">Generated by ClearDoc · ' + dateStr + ' · ' + items.length +
          ' suggestion' + (items.length === 1 ? '' : 's') + ' to consider</p>' +
          (items.length > 0 ? (
            '<h2>Counter-clause playbook</h2>' +
            '<ol>' +
            items.map((it, i) => {
              const tagCls = (it.tag || 'note').toLowerCase();
              return '<li>' +
                '<div><span class="tag ' + esc(tagCls) + '">' + esc(it.tag) + '</span>' +
                (it.applied ? ' <span class="applied">✓ applied</span>' : '') + '</div>' +
                (it.original ? '<div class="original">Original: "' + esc(it.original) + '"</div>' : '') +
                (it.counter ? '<div class="counter">Counter: "' + esc(it.counter) + '"</div>' : '') +
                (it.tip ? '<div class="tip">💡 ' + esc(it.tip) + '</div>' : '') +
              '</li>';
            }).join('') +
            '</ol>'
          ) : '<p class="empty">No suggestions to consider (no risks found in current analysis).</p>') +
          (versions.length > 0 ? (
            '<h2>Saved versions</h2>' +
            versions.map(v => {
              const ago = (Date.now() - v.ts) < 60000 ? 'just now' :
                (typeof formatRelativeTime === 'function' ? formatRelativeTime(v.ts) : 'recently');
              return '<div class="version">' +
                '<div class="name">' + esc(v.label) + (v.id === _activeVersionId ? ' (active)' : '') + '</div>' +
                '<div class="meta">' + v.count + ' risks · ' + esc(ago) + '</div>' +
                (v.snippet ? '<div class="original">"' + esc(v.snippet) + '"</div>' : '') +
              '</div>';
            }).join('')
          ) : '<p class="empty">No saved versions.</p>') +
          '<div class="footer">ClearDoc · cleardoc.app · Generated ' + dateStr + '</div>' +
          '</body></html>';
        // Open the playbook in a new window so the browser's
        // print dialog handles PDF export. No network — it's a
        // blob URL from the same data the user already has.
        try {
          const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const w = window.open(url, '_blank');
          if(!w) showAnalyzeToast('📋 Pop-up blocked — try the URL bar');
          setTimeout(() => { try { URL.revokeObjectURL(url); } catch(_){} }, 30000);
        } catch(_) {
          showAnalyzeToast('📋 Pop-up blocked');
        }
      });
    }

    // Iter #82: "Compare to a famous contract" — benchmark the
    // current input against well-known contracts. Users can see
    // "this is similar to a typical SaaS ToS" — a reference
    // point for the contract type and risk pattern.
    if(famousContractBtn){
      // Database of well-known contract types + their typical
      // risk patterns. Each entry has a name + a sample snippet
      // (the part the user pastes) + a list of typical risks.
      const FAMOUS_CONTRACTS = [
        {
          name: 'Typical SaaS Terms of Service',
          doc: 'You agree to be bound by these Terms. The Service Provider may modify, suspend, or terminate the service at any time, at their sole discretion, without prior notice. Your continued use constitutes acceptance. You grant a worldwide, perpetual, royalty-free license. These Terms are governed by the laws of California. Any dispute shall be resolved by binding arbitration in San Francisco.',
          docType: 'Terms of Service',
          typical: ['modification without notice', 'binding arbitration', 'perpetual license', 'sole discretion'],
        },
        {
          name: 'Standard Residential Lease',
          doc: 'This Lease Agreement is for the residential premises located at the above address. Tenant shall pay rent to the Landlord in advance on the first day of each month. Security deposit is non-refundable. Maintenance charges are at Landlord\'s sole discretion. This lease auto-renews for successive twelve-month terms unless either party provides 60 days written notice.',
          docType: 'Lease',
          typical: ['non-refundable deposit', 'auto-renewal', 'sole discretion', 'unilateral maintenance charges'],
        },
        {
          name: 'Generic NDA (Mutual)',
          doc: 'This Mutual Non-Disclosure Agreement is entered into by both parties. Confidential Information shall be kept confidential for a period of 3 years. Upon termination, all Confidential Information shall be returned. The receiving party shall not disclose any Confidential Information to any third party without prior written consent.',
          docType: 'NDA',
          typical: ['time-limited confidentiality', 'return of materials'],
        },
        {
          name: 'Typical SaaS Subscription',
          doc: 'Your subscription will auto-renew at the then-current rate. You may cancel at any time, but refunds are not provided for partial subscription periods. The service may be modified or discontinued at any time without notice. You authorize us to charge your payment method for all recurring fees.',
          docType: 'Subscription',
          typical: ['auto-renewal', 'no refunds', 'modification without notice'],
        },
      ];
      famousContractBtn.addEventListener('click', async () => {
        if(typeof matchRisks !== 'function' || !input){
          showAnalyzeToast('📚 Run an analysis first');
          return;
        }
        const userHits = matchRisks(input.value || '');
        if(userHits.length === 0){
          showAnalyzeToast('📚 Type a document first to benchmark it');
          return;
        }
        // Build comparison: for each famous contract, run matchRisks
        // on its snippet and show the similarity. The comparison is
        // based on which risk patterns are common to both — a
        // useful "this is similar to a typical SaaS ToS" signal.
        const rows = [];
        for(const fc of FAMOUS_CONTRACTS){
          const fcHits = matchRisks(fc.doc);
          // Find the overlap (risk labels common to both)
          const userLabels = new Set(userHits.map(h => h.label || ''));
          const fcLabels = new Set(fcHits.map(h => h.label || ''));
          let overlap = 0;
          for(const l of userLabels){ if(fcLabels.has(l)) overlap++; }
          const score = Math.round((overlap / Math.max(1, Math.max(userLabels.size, fcLabels.size))) * 100);
          rows.push({
            name: fc.name,
            docType: fc.docType,
            userCount: userHits.length,
            fcCount: fcHits.length,
            overlap: overlap,
            score: score,
            typical: fc.typical.join(' / '),
          });
        }
        // Sort by score desc — highest match first
        rows.sort((a, b) => b.score - a.score);
        const bodyHtml = '<div class="fc-list">' +
          rows.map(r => '<div class="fc-row">' +
            '<div class="fc-name"><b>' + esc(r.name) + '</b> <span class="fc-type">' + esc(r.docType) + '</span></div>' +
            '<div class="fc-meta">Match: <b>' + r.score + '%</b> (' + r.overlap + ' of your ' + r.userCount + ' risk' + (r.userCount === 1 ? '' : 's') + ' also appear in this type · ' + esc(r.typical) + ')</div>' +
          '</div>').join('') +
          '</div>' +
          '<p class="vh-note">Local comparison — no network calls. Uses the same regex engine as the live analysis, so the match is exactly what ClearDoc would catch in the reference contract.</p>';
        await showConfirmModal({
          title: '📚 Compare to a famous contract',
          bodyHtml: bodyHtml,
          confirmLabel: 'Close',
        });
      });
    }

    if(riskTrendBtn){
      riskTrendBtn.addEventListener('click', async () => {
        const trend = (typeof getRiskTrend === 'function') ? getRiskTrend() : [];
        if(trend.length < 2){
          showAnalyzeToast('📈 Need at least 2 analyses to show a trend');
          return;
        }
        // Build a simple ASCII chart (sparkline-style)
        const max = Math.max.apply(null, trend.map(p => p.count));
        const min = Math.min.apply(null, trend.map(p => p.count));
        const range = Math.max(1, max - min);
        const bars = trend.slice().reverse().map(p => {
          const h = Math.round((p.count - min) / range * 5);
          return '▁▂▃▄▅▆▇'[h] || '▁';
        }).join('');
        const latest = trend[0];
        const previous = trend[1];
        const delta = latest.count - previous.count;
        const dir = delta < 0 ? '↓' : (delta > 0 ? '↑' : '±');
        const ago = (Date.now() - latest.ts) < 60000 ? 'just now' :
          (typeof formatRelativeTime === 'function' ? formatRelativeTime(latest.ts) : 'recently');
        const body = '<div class="trend-chart" style="font-family:JetBrains Mono,monospace;line-height:1.4;font-size:14px;letter-spacing:0">' +
          '<div style="color:var(--ink-soft);font-size:var(--t-micro);text-transform:uppercase;letter-spacing:.06em">Risk counts over time (newest right)</div>' +
          '<div style="font-size:18px;margin:8px 0;color:var(--ink)">' + bars + '</div>' +
          '<div style="color:var(--ink-soft);font-size:var(--t-meta)">' +
            'Latest: <b style="color:var(--ink)">' + latest.count + ' risks</b> · ' + ago +
            (delta !== 0 ? ' (<b style="color:' + (delta < 0 ? 'var(--green)' : 'var(--danger)') + '">' + dir + ' ' + Math.abs(delta) + '</b>)' : ' (no change)') +
          '</div>' +
        '</div>' +
        '<p class="vh-note" style="margin-top:var(--s2)">Trend is from the last ' + trend.length + ' analyses (max 10, 30-day window). Local only — never leaves your device.</p>';
        await showConfirmModal({
          title: '📈 Risk trend',
          bodyHtml: body,
          confirmLabel: 'Close',
        });
      });
    }

    if(versionHistoryBtn){
      versionHistoryBtn.addEventListener('click', async () => {
        const allVersions = readVersions();
        if(allVersions.length === 0){
          showAnalyzeToast('📚 No versions saved yet');
          return;
        }
        const rows = allVersions.map((v, i) => {
          const ago = (Date.now() - v.ts) < 60000 ? 'just now' :
            (typeof formatRelativeTime === 'function' ? formatRelativeTime(v.ts) : 'recently');
          return '<div class="vh-row' + (v.id === _activeVersionId ? ' vh-active' : '') + '">' +
            '<div class="vh-num">' + (i + 1) + '.</div>' +
            '<div class="vh-body">' +
              '<div class="vh-name">' + esc(v.label) + (v.id === _activeVersionId ? ' <span class="vh-marker">active</span>' : '') + '</div>' +
              '<div class="vh-meta">' + v.count + ' risks · ' + esc(ago) + '</div>' +
              (v.snippet ? '<div class="vh-snippet">"' + esc(v.snippet) + '"</div>' : '') +
            '</div>' +
          '</div>';
        }).join('');
        await showConfirmModal({
          title: '📚 Saved versions (' + allVersions.length + ')',
          bodyHtml: '<div class="vh-list">' + rows + '</div>' +
            '<p class="vh-note">Active version is highlighted. Use the picker (next to the badge) to switch which version the next analysis compares against.</p>',
          confirmLabel: 'Close',
        });
      });
    }
      // Iter #71: refresh the version selector dropdown with all
      // saved versions. Users pick which one to compare against.
      if(savedVersionSelect){
        const arr = readVersions();
        if(arr.length > 0){
          savedVersionSelect.innerHTML = '<option value="">— pick a saved version —</option>' +
            arr.map(v => '<option value="' + esc(v.id) + '"' +
              (v.id === (_activeVersionId || arr[0].id) ? ' selected' : '') + '>' +
              esc(v.label) + ' (' + v.count + ' risks · ' +
              ((Date.now() - v.ts) < 60000 ? 'just now' :
                (typeof formatRelativeTime === 'function' ? formatRelativeTime(v.ts) : 'recently')) +
              ')</option>'
            ).join('');
          savedVersionSelect.hidden = false;
          // Iter #72: enable per-version delete. Setting this
          // attribute lets the change handler distinguish a
          // "switched the active version" event from a "delete this
          // version" event.
          savedVersionSelect.dataset.mode = 'picker';
        } else {
          savedVersionSelect.hidden = true;
        }
      }
    }
    // After any analysis, the clear button reflects whether a
    // saved version exists. Cheap (one localStorage read).
    showClearVersionBtn();
    if(saveVersionBtn){
      saveVersionBtn.addEventListener('click', async () => {
        // Iter #71: prompt for an optional name (default: Snapshot N).
        // showConfirmModal doesn't accept a free-text input, so we use
        // the native window.prompt for the name. Falls back silently
        // to the default name on cancel.
        let name = '';
        try {
          name = window.prompt('Name this version (optional):', '');
          if(name === null) return; // user cancelled
        } catch(_){ /* old browsers — skip the prompt */ }
        const before = getSavedVersion();
        saveCurrentVersion(name);
        const after = getSavedVersion();
        showClearVersionBtn();
        if(!after){
          showAnalyzeToast('📌 No version to save');
          return;
        }
        if(before && before.id !== after.id && before.count === after.count){
          showAnalyzeToast('📌 Saved as "' + after.label + '" (same risk count)');
        } else {
          showAnalyzeToast('📌 Saved as "' + after.label + '" (' + after.count + ' risks)');
        }
      });
    }
    // Iter #71: select change — pick a different saved version to
    // compare against (the dropdown was repopulated by showClearVersionBtn)
    if(savedVersionSelect){
      savedVersionSelect.addEventListener('change', () => {
        _activeVersionId = savedVersionSelect.value || null;
        showClearVersionBtn();
      });
    }
    // Iter #72: per-version delete. Clicking × next to a saved
    // version removes only that one. The picker is repopulated
    // so the user immediately sees the updated list. Implemented
    // as a separate click handler so the "switch" change handler
    // and the "delete" click handler don't interfere.
    if(savedVersionSelect){
      savedVersionSelect.addEventListener('click', (e) => {
        // The select's option text includes ×; we use a simple
        // data attribute on the selected option to indicate
        // delete intent. For now, use a Cmd/Ctrl+click shortcut:
        // Cmd+click an option to delete it.
        if((e.metaKey || e.ctrlKey) && savedVersionSelect.value){
          const id = savedVersionSelect.value;
          if(id){
            deleteVersion(id);
            showClearVersionBtn();
            showAnalyzeToast('🗑 Version deleted');
          }
        }
      });
    }
    if(clearVersionBtn){
      clearVersionBtn.addEventListener('click', async () => {
        const v = getSavedVersion();
        if(!v) return;
        const ok = await showConfirmModal({
          title: 'Clear the saved baseline?',
          bodyHtml: '<p>This will delete your "before" version. Future analyses won\'t show a delta until you save a new baseline.</p>' +
            '<p class="apply-confirm-note">Useful when you want to start a new before/after cycle.</p>',
          confirmLabel: 'Clear',
        });
        if(!ok) return;
        try { localStorage.removeItem(VERSION_KEY); } catch(_){}
        showClearVersionBtn();
        if(savedVersionBadge) savedVersionBadge.hidden = true;
        if(savedVersionSnippet) savedVersionSnippet.hidden = true;
        showAnalyzeToast('🗑 Baseline cleared');
      });
    }
    if(copyBtn) copyBtn.addEventListener('click',copyAnalysis);
    // Iter #63: Share-button handler — copies the share one-liner
    // to the clipboard with the standard navigator.clipboard
    // + execCommand fallback pattern (same as the existing
    // copy/apply/rc-copy handlers in the file).
    if(shareBadgeBtn){
      shareBadgeBtn.addEventListener('click', async () => {
        const text = shareBadgeBtn.dataset.text || '';
        if(!text) return;
        let ok = false;
        try {
          if(navigator.clipboard && navigator.clipboard.writeText){
            await navigator.clipboard.writeText(text);
            ok = true;
          } else {
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
            document.body.appendChild(ta); ta.select();
            ok = document.execCommand('copy'); document.body.removeChild(ta);
          }
        } catch(_) {}
        const orig = '📤 Share';
        shareBadgeBtn.textContent = ok ? '✓ copied' : 'failed';
        clearTimeout(shareBadgeBtn._flashTimer);
        shareBadgeBtn._flashTimer = setTimeout(() => { shareBadgeBtn.textContent = orig; }, 1400);
      });
    }
    // Iter #64: Reset button — clears the localStorage counter
    // (for testing, new users, or privacy). Uses the existing
    // confirm modal so users don't wipe their stats by accident.
    if(resetBadgeBtn){
      resetBadgeBtn.addEventListener('click', async () => {
        // Show the current count + savings in the confirm so users
        // know what they're wiping (iter #65). Pulls from the
        // same getRisksAvoided() the badge uses.
        let preview = '';
        if(typeof getRisksAvoided === 'function'){
          const d = getRisksAvoided();
          const n = d.count || 0;
          if(n > 0){
            const SAVINGS_PER = { r: 200, a: 50, g: 20 };
            const totalVal = (d.trap||0) * SAVINGS_PER.r +
                              (d.watch||0) * SAVINGS_PER.a +
                              (d.note||0) * SAVINGS_PER.g;
            preview = ' Currently: <b>' + n + ' risk' + (n === 1 ? '' : 's') +
              ' avoided (~$' + totalVal.toLocaleString('en-US') + ' in saved costs)</b>.';
          }
        }
        const ok = await showConfirmModal({
          title: 'Reset the risks-avoided counter?',
          bodyHtml: '<p>This will clear your local "risks avoided" counter. Future analyses will start from 0.</p>' +
            (preview ? '<p>' + preview + '</p>' : '') +
            '<p class="apply-confirm-note">Useful for new users or if you want to test the counter.</p>',
          confirmLabel: 'Reset',
        });
        if(!ok) return;
        try { localStorage.removeItem(RISKS_KEY); } catch(_){}
        // Hide badge + share + reset buttons
        if(risksAvoidedBadge) risksAvoidedBadge.hidden = true;
        if(shareBadgeBtn) shareBadgeBtn.hidden = true;
        resetBadgeBtn.hidden = true;
        showAnalyzeToast('↺ Counter reset');
      });
    }
    // Iter #66: explainer button — opens a small dialog with the
    // reasoning behind the per-severity $ rates. Transparency
    // builds trust: users see where the numbers come from.
    if(badgeExplainBtn){
      badgeExplainBtn.addEventListener('click', async () => {
        await showConfirmModal({
          title: 'Where do these numbers come from?',
          bodyHtml: '<p>The badge estimates how much these risks would have cost you. Per-severity rates:</p>' +
            '<p><b style="color:var(--danger)">trap  = $200</b><br>' +
            'High stakes. Could void a contract, trigger a penalty, or shift a big liability. Conservative — the actual cost can be much higher.</p>' +
            '<p><b style="color:var(--amber)">watch = $50</b><br>' +
            'Medium stakes. Could trigger unwanted terms, missed deadlines, or administrative headaches.</p>' +
            '<p><b style="color:var(--green)">note  = $20</b><br>' +
            'Low stakes. Minor administrative cost — extra paperwork, follow-up calls, or small fees.</p>' +
            '<p class="apply-confirm-note">These are conservative industry-rough estimates. Real costs vary wildly by contract, jurisdiction, and situation. Use the number as a relative gauge, not a literal price tag.</p>',
          confirmLabel: 'Got it',
        });
      });
    }
    if(shareBtn) shareBtn.addEventListener('click',shareAnalysis);
    /* Read-aloud TTS — speaks the plain-English rewrite via the
     * Web Speech API. Click toggles playback; the button label
     * flips to "■ Stop" while speaking. Picks an English voice if
     * one is available (so e.g. Chrome on a French system still
     * reads in English). Disabled when SpeechSynthesis is missing. */
    if(speakBtn){
      if(typeof window === 'undefined' || !('speechSynthesis' in window)){
        speakBtn.hidden = true; // unsupported browser → hide entirely
      } else {
        let isSpeaking = false;
        let sentenceSpans = []; // cached wrapper spans for the highlighter

        // Voice picker — populates the <select> with all available
        // voices, preferring the detected language. User's pick is
        // persisted to localStorage so it survives reloads. Falls
        // back gracefully when no voices are available.
        const VOICE_KEY = 'cleardoc:ttsVoice';
        const getStoredVoice = () => {
          try { return localStorage.getItem(VOICE_KEY) || ''; } catch(_) { return ''; }
        };
        const setStoredVoice = (v) => {
          try { localStorage.setItem(VOICE_KEY, v || ''); } catch(_) {}
        };
        const populateVoicePicker = (detectedLang) => {
          if(!voicePicker) return;
          const allVoices = (typeof window.speechSynthesis.getVoices === 'function')
            ? window.speechSynthesis.getVoices() : [];
          if(allVoices.length === 0) return;
          // Build the option list. Group: detected-lang voices first
          // (if any), then other voices. Each option's value is the
          // voice's name (which uniquely identifies it in
          // SpeechSynthesis).
          const storedName = getStoredVoice();
          const prefix = detectedLang ? String(detectedLang.tts || '').toLowerCase().split('-')[0] : '';
          const matching = prefix ? allVoices.filter(v => v && v.lang && v.lang.toLowerCase().startsWith(prefix)) : [];
          const others = allVoices.filter(v => !matching.includes(v));
          const ordered = matching.concat(others);
          // Default option: "System default" — lets the OS pick
          voicePicker.innerHTML = '<option value="">System default</option>';
          ordered.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.name;
            opt.textContent = v.name + ' (' + (v.lang || '?') + ')';
            voicePicker.appendChild(opt);
          });
          // Restore prior selection if it still exists
          if(storedName && ordered.some(v => v.name === storedName)){
            voicePicker.value = storedName;
          }
          voicePicker.onchange = () => setStoredVoice(voicePicker.value);
        };
        // Some browsers (Chrome) load voices asynchronously. Re-populate
        // when they become available. One-shot (not duplicated).
        if(typeof window.speechSynthesis.onvoiceschanged !== 'undefined'){
          window.speechSynthesis.onvoiceschanged = () => {
            if(voicePicker && !voicePicker.hidden){
              populateVoicePicker((plainOut && plainOut._detectedLang) || null);
            }
          };
        }
        // Preview button — speak a sample phrase using the
        // currently-selected voice so users can compare voices before
        // committing. The sample is language-aware: uses the detected
        // language's BCP-47 tag (so the voice speaks in the right
        // language even if the picked voice isn't a great match).
        if(voicePreviewBtn){
          voicePreviewBtn.addEventListener('click', () => {
            if(!window.speechSynthesis) return;
            // Stop any current speech first
            try { window.speechSynthesis.cancel(); } catch(_) {}
            const sample = 'Hello — this is a sample of how I sound.';
            const u = new SpeechSynthesisUtterance(sample);
            const allVoices = window.speechSynthesis.getVoices();
            const stored = (typeof getStoredVoice === 'function') ? getStoredVoice() : '';
            const explicit = stored && allVoices.find(v => v && v.name === stored);
            if(explicit) u.voice = explicit;
            const detectedLang = (plainOut && plainOut._detectedLang) || null;
            if(detectedLang && detectedLang.tts) u.lang = detectedLang.tts;
            u.rate = 1.0; u.pitch = 1.0;
            const orig = '▶ preview';
            u.onend = u.onerror = () => {
              voicePreviewBtn.textContent = orig;
            };
            try { window.speechSynthesis.speak(u); voicePreviewBtn.textContent = '◼ stop'; } catch(_){}
          });
        }
        const pickVoice = () => {
          const voices = (typeof window.speechSynthesis.getVoices === 'function')
            ? window.speechSynthesis.getVoices() : [];
          return voices.find(v => /^en[-_]/i.test(v.lang)) || voices[0] || null;
        };
        // Voice picker that prefers a specific BCP-47 language tag
        // (e.g. 'es-ES'). Falls back to the prefix match, then the
        // first available voice. Pairs with iter #35's detectLanguage.
        const pickVoiceForLang = (langTag) => {
          const voices = (typeof window.speechSynthesis.getVoices === 'function')
            ? window.speechSynthesis.getVoices() : [];
          if(!langTag) return pickVoice();
          const prefix = String(langTag).toLowerCase().split('-')[0];
          return voices.find(v => v && v.lang && v.lang.toLowerCase() === String(langTag).toLowerCase())
              || voices.find(v => v && v.lang && v.lang.toLowerCase().startsWith(prefix))
              || pickVoice();
        };
        // Wrap the rewrite's sentences in <span class="spoken"> so the
        // active sentence can be highlighted as the TTS reads it. Idempotent
        // — only wraps once per analyze (cached on the element via a flag).
        const wrapSentences = () => {
          if(!plainOut) return [];
          if(plainOut._spansBuilt) return plainOut._spans;
          const text = plainOut.textContent || '';
          const html = plainOut.innerHTML;
          if(!text || text.length < 4) return [];
          // Split on terminal punctuation, walk the original HTML and
          // chunk it into sentences. Cheap heuristic: split by the same
          // regex we use elsewhere, then re-glue around already-wrapped
          // HTML tags so we don't break the rewrite's inline marks.
          const re = /(?<=[.!?])\s+/;
          const parts = text.split(re).filter(s => s.trim().length > 0);
          if(parts.length <= 1){
            plainOut._spansBuilt = true;
            plainOut._spans = [];
            return [];
          }
          // Rebuild as plain text wrapped in spans (strip the existing
          // inline markup — this is a one-shot for the audio reader, and
          // the original rewrite is preserved in the snapshot).
          const wrapped = parts.map(s => '<span class="spoken">' + esc(s.trim()) + '</span>').join(' ');
          plainOut.innerHTML = wrapped;
          plainOut._spansBuilt = true;
          plainOut._spans = Array.from(plainOut.querySelectorAll('.spoken'));
          return plainOut._spans;
        };
        const clearHighlight = () => {
          if(sentenceSpans.length){
            sentenceSpans.forEach(s => s.classList.remove('spoken-active'));
          }
        };
        const setActive = (idx) => {
          if(!sentenceSpans.length) return;
          sentenceSpans.forEach((s, i) => {
            s.classList.toggle('spoken-active', i === idx);
          });
          // Auto-scroll the active sentence into view (button-sized window)
          const active = sentenceSpans[idx];
          if(active && typeof active.scrollIntoView === 'function'){
            try { active.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch(_){}
          }
        };
        speakBtn.addEventListener('click', () => {
          if(isSpeaking){
            try { window.speechSynthesis.cancel(); } catch(_) {}
            isSpeaking = false;
            speakBtn.textContent = '🔊 Read aloud';
            speakBtn.classList.remove('speaking');
            clearHighlight();
            return;
          }
          const text = plainOut ? plainOut.textContent : '';
          if(!text || !text.trim()) return;
          try {
            window.speechSynthesis.cancel(); // wipe any pending utterance
            sentenceSpans = wrapSentences();
            const u = new SpeechSynthesisUtterance(text);
            // Voice priority: explicit user pick (voicePicker) →
            // detected language → English-preferring default.
            const detectedLang = input && input._detectedLang;
            const stored = (typeof getStoredVoice === 'function') ? getStoredVoice() : '';
            const allVoices = (typeof window.speechSynthesis.getVoices === 'function')
              ? window.speechSynthesis.getVoices() : [];
            const explicit = stored && allVoices.find(v => v && v.name === stored);
            const v = explicit
              || (detectedLang && detectedLang.tts ? pickVoiceForLang(detectedLang.tts) : null)
              || pickVoice();
            if(v) u.voice = v;
            if(detectedLang && detectedLang.tts) u.lang = detectedLang.tts;
            u.rate = 1.0;
            u.pitch = 1.0;
            // boundary event fires at each sentence boundary. charIndex
            // tells us where in the text we are — we map it to the
            // highest sentence span whose text starts at or before
            // that index. Defensive on browsers that don't fire it.
            let activeIdx = 0;
            u.onboundary = (ev) => {
              if(typeof ev.charIndex !== 'number') return;
              let found = 0;
              let pos = 0;
              for(let i = 0; i < sentenceSpans.length; i++){
                pos += (sentenceSpans[i].textContent || '').length + 1; // +1 for the space
                if(ev.charIndex < pos) { found = i; break; }
                found = i;
              }
              if(found !== activeIdx){
                activeIdx = found;
                setActive(found);
              }
            };
            u.onend = u.onerror = () => {
              isSpeaking = false;
              speakBtn.textContent = '🔊 Read aloud';
              speakBtn.classList.remove('speaking');
              clearHighlight();
            };
            window.speechSynthesis.speak(u);
            isSpeaking = true;
            speakBtn.textContent = '■ Stop';
            speakBtn.classList.add('speaking');
            // Highlight the first sentence immediately so users see
            // the highlighter working even before the first boundary
            // event fires (some browsers delay the first boundary).
            if(sentenceSpans.length > 0) setActive(0);
          } catch(_) {}
        });
      }
    }
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
