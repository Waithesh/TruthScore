// script.js — TruthScore (single source of truth, no inline conflicts)

// ═══════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════
const BACKEND_URL   = 'https://truthscore.onrender.com';
const DEMO_VIDEO_ID = 'dQw4w9WgXcQ';
const SHEETS_URL    = 'https://script.google.com/macros/s/AKfycbxaPe-cbB1hZZ8QKKG2VLO3fo-bFWfaYqBji2_HAkDu7RwV5WkWM3GMrKSpPSPIEvE/exec';
const PAYPAL_BTN    = 'JGGHMKAMLZ3X8';
const PAYPAL_KEY    = 'BAAN-6uTeFePPlFBTb2KRwscuk_CN958_Dp1xPe78I33ZlxbgpQfjilAnXMcrm02M5iYbM9Xr2EnqAwPXs';

// ═══════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════
const $  = id  => document.getElementById(id);
const $q = sel => document.querySelector(sel);
function setText(id, v) { const e=$( id); if(e) e.textContent=v; }
function setHTML(id, v) { const e=$(id); if(e) e.innerHTML=v; }

function extractVideoId(url) {
    if (!url) return null;
    const pats = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/i,
        /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const p of pats) { const m=url.match(p); if(m) return m[1]; }
    try {
        const u = new URL(url.includes('://') ? url : 'https://youtube.com/watch?v='+url);
        return u.searchParams.get('v') || null;
    } catch(e) { return null; }
}

async function postToSheets(data) {
    try {
        await fetch(SHEETS_URL, {
            method: 'POST', mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    } catch(e) { console.warn('Sheets:', e); }
}

// ═══════════════════════════════════════════════
// STATE  (single source, no duplication)
// ═══════════════════════════════════════════════
let _score   = '--';
let _title   = '';
let _report  = '';
let _flags   = [];   // [{cls, text, impact}]
let _ppDone  = false;

// ═══════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {

    // Analyze
    $('analyzeBtn')?.addEventListener('click', () => runAnalyze());
    $('videoInput')?.addEventListener('keypress', e => { if(e.key==='Enter') runAnalyze(); });
    $('demoBtn')?.addEventListener('click', () => {
        $('videoInput').value = 'https://youtu.be/'+DEMO_VIDEO_ID;
        runAnalyze(DEMO_VIDEO_ID);
    });

    // Result action buttons
    $('shareBtn')?.addEventListener('click', doShare);
    $('copyBtn') ?.addEventListener('click', doCopy);
    $('newBtn')  ?.addEventListener('click', doReset);

    // Pro modal — close on backdrop click
    $('proModal')?.addEventListener('click', e => { if(e.target===$('proModal')) closeProModal(); });
});

// ═══════════════════════════════════════════════
// LOADING OVERLAY  (dark theme)
// ═══════════════════════════════════════════════
function showLoader() {
    if($('tsOverlay')) return;
    const d = document.createElement('div');
    d.id = 'tsOverlay';
    d.innerHTML = `
<style>
#tsOverlay{position:fixed;inset:0;background:rgba(0,0,0,.93);display:flex;align-items:center;justify-content:center;z-index:99999;animation:tsF .3s}
@keyframes tsF{from{opacity:0}to{opacity:1}}
#tsBox{background:#111;border:1px solid #222;border-radius:18px;padding:2.5rem;max-width:460px;width:90%;text-align:center}
#tsIco{font-size:3rem;margin-bottom:.75rem;display:inline-block;animation:tsP 2s infinite}
@keyframes tsP{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
#tsTtl{font-family:'Syne',sans-serif;font-size:1.3rem;font-weight:800;color:#f0f0f0;margin-bottom:.35rem}
#tsMsg{color:#666;font-size:.9rem;margin-bottom:1.4rem}
#tsBarW{width:100%;height:7px;background:#1a1a1a;border-radius:4px;overflow:hidden;margin-bottom:1.4rem}
#tsBar{width:0%;height:100%;background:linear-gradient(90deg,#ff3c3c,#ff8080);transition:width .6s ease;border-radius:4px}
#tsInfo{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:10px;padding:.9rem 1.1rem;text-align:left;margin-bottom:1.2rem}
#tsInfo p{margin:0;color:#fcd34d;font-size:.84rem;line-height:1.5}
#tsWBtn{background:#ff3c3c;color:#fff;border:none;border-radius:10px;padding:.8rem 1.6rem;font-family:'Syne',sans-serif;font-weight:700;font-size:.9rem;cursor:pointer}
#tsWBtn:hover{background:#b91c1c}
#tsNote{color:#444;font-size:.75rem;margin-top:.5rem}
</style>
<div id="tsBox">
  <div id="tsIco">&#128737;</div>
  <h3 id="tsTtl">Waking up analysis engine&hellip;</h3>
  <p  id="tsMsg">Connecting to server&hellip;</p>
  <div id="tsBarW"><div id="tsBar"></div></div>
  <div id="tsInfo">
    <p><strong>&#9889; Free Plan:</strong> First analysis takes ~45 sec while the server wakes from sleep.</p>
    <p style="margin-top:.35rem;font-size:.8rem;">Subsequent scans are much faster.</p>
  </div>
  <button id="tsWBtn">&#128640; Join Pro Waitlist &mdash; Keep Servers Awake</button>
  <p id="tsNote">Early members get 50% off when we launch</p>
</div>`;
    document.body.appendChild(d);
    $('tsWBtn').addEventListener('click', () => { hideLoader(); openProModal(); });

    const stages = [
        {t:0,    msg:'Connecting to server\u2026',   pct:10},
        {t:8000, msg:'Server online\u2026',           pct:30},
        {t:15000,msg:'Fetching video data\u2026',     pct:50},
        {t:25000,msg:'Scanning comments\u2026',       pct:70},
        {t:35000,msg:'Calculating TruthScore\u2026',  pct:85},
        {t:42000,msg:'Almost done\u2026',             pct:95},
    ];
    stages.forEach(s => setTimeout(() => {
        const m=$('tsMsg'), b=$('tsBar');
        if(m) m.textContent=s.msg;
        if(b) b.style.width=s.pct+'%';
    }, s.t));
}

function hideLoader() {
    const b=$('tsBar'); if(b) b.style.width='100%';
    setTimeout(()=>$('tsOverlay')?.remove(), 350);
}
// expose for loader button
window.hideLoader   = hideLoader;
window.openProModal = openProModal;   // pre-declared below

// ═══════════════════════════════════════════════
// ANALYZE
// ═══════════════════════════════════════════════
async function runAnalyze(optId) {
    const errEl = $('inputError');
    if(errEl) errEl.classList.add('hidden');

    const raw = optId || $('videoInput')?.value.trim();
    if(!raw) { showErr('Please paste a YouTube URL or video ID.'); return; }
    const id = extractVideoId(raw) || raw;
    if(!id)  { showErr('Could not read a video ID — try the full YouTube URL.'); return; }

    // Reset result area
    $('resultSection')?.classList.add('hidden');
    $('emailGate')    ?.classList.remove('hidden');
    $('flagsCard')    ?.classList.add('hidden');

    showLoader();
    const btn = $('analyzeBtn');
    if(btn){ btn.disabled=true; btn.textContent='Analyzing\u2026'; }

    try {
        const res = await fetch(BACKEND_URL+'/api/analyze', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({videoId:id})
        });
        if(!res.ok) {
            const e = await res.json().catch(()=>({message:'Server error'}));
            throw new Error(e.message||'Analysis failed');
        }
        const data = await res.json();
        hideLoader();
        renderResults(data);
    } catch(err) {
        hideLoader();
        showErr(err.message||'Failed to analyse. Please try again.');
    } finally {
        if(btn){ btn.disabled=false; btn.textContent='Analyze \u2192'; }
    }
}

function showErr(msg) {
    const e=$('inputError'); if(e){e.textContent=msg;e.classList.remove('hidden');}
}

// ═══════════════════════════════════════════════
// RENDER RESULTS
// ═══════════════════════════════════════════════
function renderResults(payload) {
    const {video, analysis} = payload;
    const score = Math.round(analysis.score);

    // Save to state
    _score = score;
    _title = video.title;

    const dislikePct = (analysis.likeDislikeRatio * 100).toFixed(1);

    // Video meta
    setText('videoTitle',  video.title);
    setText('channelInfo', video.channelTitle+' \u2022 '+(video.channelAgeYears||0)+' yrs old');
    const votesText = video.dislikeCount !== undefined
        ? video.likeCount.toLocaleString()+' likes \u00b7 '+video.dislikeCount.toLocaleString()+' hidden dislikes'
        : video.likeCount.toLocaleString()+' likes';
    setHTML('metaInfo', video.viewCount.toLocaleString()+' views \u00b7 '+votesText+' \u00b7 '+video.commentCount.toLocaleString()+' comments');

    // Score ring
    const ring=$('scoreRing'), num=$('ringNum');
    if(ring && num){
        num.textContent = score+'%';
        ring.className  = 'score-ring '+(score>=75?'ring-green':score>=45?'ring-amber':'ring-red');
    }

    // Mini stats
    setText('channelTrust', Math.round(analysis.channelTrustScore)+'/100');
    const drEl=$('dislikeRatio');
    if(drEl){
        drEl.textContent=dislikePct+'%';
        drEl.style.color = parseFloat(dislikePct)>30?'var(--red)':parseFloat(dislikePct)>15?'var(--amber)':'var(--green)';
    }
    setText('engagement', (analysis.engagementRatio*100).toFixed(3)+'%');

    // Store flags for gate unlock
    const sorted = [...analysis.flags].sort((a,b)=>
        ({red:1,yellow:2,blue:3,green:4}[a.type]||5) - ({red:1,yellow:2,blue:3,green:4}[b.type]||5)
    );
    _flags = sorted.map(f => ({
        cls : f.type==='red'?'fd-red':f.type==='yellow'?'fd-amber':f.type==='blue'?'fd-amber':'fd-green',
        text: f.text,
        impact: f.impact||''
    }));

    // Build copy-report text
    const verdict = score>=75?'Likely Legit':score>=45?'Be Careful':'HIGH RISK';
    _report = [
        'TruthScore Analysis',
        '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
        'Title:         '+video.title,
        'Channel:       '+video.channelTitle,
        'TruthScore:    '+score+'% \u2014 '+verdict,
        'Channel Trust: '+Math.round(analysis.channelTrustScore)+'/100',
        'Dislike Ratio: '+dislikePct+'%',
        'Engagement:    '+(analysis.engagementRatio*100).toFixed(3)+'%',
        '',
        'Flags:',
        ...analysis.flags.map(f=>'  \u2022 '+f.text)
    ].join('\n');

    // Reset gate UI
    const gs=$('gateStatus');
    if(gs){ gs.textContent="No spam. We'll also notify you when the Chrome extension launches."; gs.style.color='var(--muted)'; }
    const ge=$('gateEmail'); if(ge) ge.value='';
    $('emailGate')?.classList.remove('hidden');
    $('flagsCard') ?.classList.add('hidden');

    // Show section
    $('resultSection')?.classList.remove('hidden');

    // PayPal
    injectPayPal();

    // Scroll to results
    const top = ($('resultSection')?.offsetTop||300)-80;
    window.scrollTo({top, behavior:'smooth'});
}

// ═══════════════════════════════════════════════
// EMAIL GATE
// ═══════════════════════════════════════════════
async function unlockReport() {
    const emailEl  = $('gateEmail');
    const statusEl = $('gateStatus');
    const email    = emailEl?.value.trim()||'';

    if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
        if(statusEl){ statusEl.textContent='\u26a0\ufe0f Please enter a valid email.'; statusEl.style.color='#fca5a5'; }
        return;
    }
    if(statusEl){ statusEl.textContent='Saving\u2026'; statusEl.style.color='var(--muted)'; }

    await postToSheets({
        type:'unlock', email,
        videoTitle:_title, score:String(_score),
        timestamp:new Date().toISOString()
    });

    // Reveal flags
    $('emailGate')?.classList.add('hidden');
    const fc=$('flagsCard'), ul=$('flagsList');
    if(fc && ul){
        ul.innerHTML='';
        _flags.forEach(f=>{
            const li=document.createElement('li');
            li.className='flag-item';
            li.innerHTML='<div class="flag-dot '+f.cls+'"></div>'
                +'<div><div class="flag-text">'+f.text+'</div>'
                +(f.impact?'<div class="flag-impact">'+f.impact+'</div>':'')
                +'</div>';
            ul.appendChild(li);
        });
        fc.classList.remove('hidden');
    }
}
// MUST be global — called by onclick in HTML
window.unlockReport = unlockReport;

// ═══════════════════════════════════════════════
// ACTION BUTTONS
// ═══════════════════════════════════════════════
function doShare() {
    const s = parseInt(_score);
    const risk = s>=75?'\u2705 Looks Legit':s>=45?'\u26a0\ufe0f Suspicious':'\ud83d\udea8 HIGH RISK';
    const text = encodeURIComponent(
        'Just ran "'+_title+'" through TruthScore \u2014 scored '+_score+'% '+risk+'\n\nCheck any YouTube video free:\nhttps://truthscore.online'
    );
    window.open('https://x.com/intent/tweet?text='+text,'_blank','width=560,height=420');
}

function doCopy() {
    if(!_report) return;
    const btn=$('copyBtn');
    const orig=btn?btn.textContent:'';
    const ok=()=>{ if(btn){btn.textContent='\u2705 Copied!'; setTimeout(()=>btn.textContent=orig,2000);} };
    if(navigator.clipboard){
        navigator.clipboard.writeText(_report).then(ok).catch(()=>fbCopy(ok));
    } else { fbCopy(ok); }
}
function fbCopy(cb){
    const ta=document.createElement('textarea');
    ta.value=_report; ta.style='position:fixed;opacity:0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    try{document.execCommand('copy');cb();}catch(e){}
    document.body.removeChild(ta);
}

function doReset() {
    $('resultSection')?.classList.add('hidden');
    $('emailGate')    ?.classList.remove('hidden');
    $('flagsCard')    ?.classList.add('hidden');
    const v=$('videoInput'); if(v) v.value='';
    window.scrollTo({top:0,behavior:'smooth'});
}

// ═══════════════════════════════════════════════
// PRO MODAL
// ═══════════════════════════════════════════════
function openProModal() {
    $('proModal')?.classList.add('open');
    const mf=$('modalForm'), ms=$('modalSuccess');
    if(mf) mf.style.display='';
    if(ms) ms.style.display='none';
    const ps=$('proStatus');
    if(ps){ ps.textContent='No spam. We only email you when we launch.'; ps.style.color='var(--muted)'; }
}
function closeProModal() { $('proModal')?.classList.remove('open'); }

async function submitProWaitlist() {
    const name  = $('proName') ?.value.trim()||'';
    const email = $('proEmail')?.value.trim()||'';
    const st    = $('proStatus');

    if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
        if(st){ st.textContent='\u26a0\ufe0f Please enter a valid email.'; st.style.color='#fca5a5'; }
        return;
    }
    if(st){ st.textContent='Saving\u2026'; st.style.color='var(--muted)'; }

    await postToSheets({type:'pro_waitlist',name,email,timestamp:new Date().toISOString()});

    const mf=$('modalForm'), ms=$('modalSuccess');
    if(mf) mf.style.display='none';
    if(ms) ms.style.display='block';
}

// All modal functions MUST be global — used by onclick in HTML
window.openProModal      = openProModal;
window.closeProModal     = closeProModal;
window.submitProWaitlist = submitProWaitlist;

// ═══════════════════════════════════════════════
// PAYPAL — injected once on first result
// ═══════════════════════════════════════════════
function injectPayPal() {
    if(_ppDone) return;
    const proCard=$q('.pro-card'); if(!proCard) return;

    const wrap=document.createElement('div');
    wrap.style.cssText='margin:.75rem 0;display:flex;justify-content:center;';
    const container=document.createElement('div');
    container.id='paypal-ts-btn';
    wrap.appendChild(container);
    const sub=proCard.querySelector('.pro-sub');
    proCard.insertBefore(wrap, sub||null);

    const s=document.createElement('script');
    s.src='https://www.paypal.com/sdk/js?client-id='+PAYPAL_KEY+'&components=hosted-buttons&disable-funding=venmo&currency=USD';
    s.onload=()=>{
        window.paypal?.HostedButtons?.({hostedButtonId:PAYPAL_BTN}).render('#paypal-ts-btn');
        _ppDone=true;
    };
    document.body.appendChild(s);
}
