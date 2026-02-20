// script.js — TruthScore (fully fixed)

// ═══════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════
const BACKEND_URL   = "https://truthscore.onrender.com";
const DEMO_VIDEO_ID = 'dQw4w9WgXcQ';
const SHEETS_URL    = 'https://script.google.com/macros/s/AKfycbxaPe-cbB1hZZ8QKKG2VLO3fo-bFWfaYqBji2_HAkDu7RwV5WkWM3GMrKSpPSPIEvE/exec';
const PAYPAL_BTN_ID = 'JGGHMKAMLZ3X8';
const PAYPAL_CLIENT = 'BAAN-6uTeFePPlFBTb2KRwscuk_CN958_Dp1xPe78I33ZlxbgpQfjilAnXMcrm02M5iYbM9Xr2EnqAwPXs';


// ═══════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════
const $  = id  => document.getElementById(id);
const $q = sel => document.querySelector(sel);

function safeText(id, val) { const el = $(id); if (el) el.textContent = val; }
function safeHTML(id, val) { const el = $(id); if (el) el.innerHTML  = val; }

function extractVideoId(url) {
    if (!url) return null;
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/i,
        /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
    try {
        const u = new URL(url.includes("://") ? url : "https://youtube.com/watch?v=" + url);
        return u.searchParams.get("v") || null;
    } catch (e) { return null; }
}

async function postToSheets(payload) {
    try {
        await fetch(SHEETS_URL, {
            method: 'POST', mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) { console.warn('Sheets post failed:', e); }
}


// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════
let _lastScore   = '--';
let _lastTitle   = '';
let _reportText  = '';
let _paypalDone  = false;


// ═══════════════════════════════════════════════════════
// BOOT — wire all events after DOM ready
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    $('analyzeBtn')?.addEventListener('click', () => runAnalyze());
    $('videoInput')?.addEventListener('keypress', e => { if (e.key === 'Enter') runAnalyze(); });
    $('demoBtn')?.addEventListener('click', () => {
        $('videoInput').value = `https://youtu.be/${DEMO_VIDEO_ID}`;
        runAnalyze(DEMO_VIDEO_ID);
    });
    $('shareBtn')?.addEventListener('click', shareResult);
    $('copyBtn')?.addEventListener('click',  copyReport);
    $('newBtn')?.addEventListener('click',   resetTool);
    $('proModal')?.addEventListener('click', e => { if (e.target === $('proModal')) closeProModal(); });
});


// ═══════════════════════════════════════════════════════
// LOADING OVERLAY — dark theme matching site
// ═══════════════════════════════════════════════════════
function createLoadingOverlay() {
    if ($('loadingOverlay')) return;
    const el = document.createElement('div');
    el.id = 'loadingOverlay';
    el.innerHTML = `
    <style>
      #loadingOverlay{position:fixed;inset:0;background:rgba(0,0,0,.93);display:flex;align-items:center;justify-content:center;z-index:99999;animation:tsOFade .3s}
      @keyframes tsOFade{from{opacity:0}to{opacity:1}}
      #tsBox{background:#111;border:1px solid #222;border-radius:18px;padding:2.5rem;max-width:460px;width:90%;text-align:center;box-shadow:0 25px 80px rgba(0,0,0,.8)}
      #tsIcon{font-size:3rem;margin-bottom:.75rem;display:inline-block;animation:tsPulse 2s infinite}
      @keyframes tsPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
      #tsTitle{font-family:'Syne',sans-serif;font-size:1.3rem;font-weight:800;color:#f0f0f0;margin-bottom:.35rem}
      #tsMsg{color:#666;font-size:.9rem;margin-bottom:1.4rem}
      #tsBarWrap{width:100%;height:7px;background:#1a1a1a;border-radius:4px;overflow:hidden;margin-bottom:1.4rem}
      #tsBar{width:0%;height:100%;background:linear-gradient(90deg,#ff3c3c,#ff8080);transition:width .6s ease;border-radius:4px}
      #tsInfo{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:10px;padding:.9rem 1.1rem;text-align:left;margin-bottom:1.2rem}
      #tsInfo p{margin:0;color:#fcd34d;font-size:.84rem;line-height:1.5}
      #tsWaitBtn{background:#ff3c3c;color:#fff;border:none;border-radius:10px;padding:.8rem 1.6rem;font-family:'Syne',sans-serif;font-weight:700;font-size:.9rem;cursor:pointer;transition:background .2s}
      #tsWaitBtn:hover{background:#b91c1c}
      #tsSubNote{color:#444;font-size:.75rem;margin-top:.5rem}
    </style>
    <div id="tsBox">
      <div id="tsIcon">🛡️</div>
      <h3 id="tsTitle">Waking up analysis engine…</h3>
      <p id="tsMsg">Connecting to server…</p>
      <div id="tsBarWrap"><div id="tsBar"></div></div>
      <div id="tsInfo">
        <p><strong>⚡ Free Plan:</strong> First analysis takes ~45 sec while the server wakes from sleep.</p>
        <p style="margin-top:.35rem;font-size:.8rem;">Subsequent scans are much faster.</p>
      </div>
      <button id="tsWaitBtn" onclick="openProModal();removeLoadingOverlay();">🚀 Join Pro Waitlist — Keep Servers Awake</button>
      <p id="tsSubNote">Early members get 50% off when we launch</p>
    </div>`;
    document.body.appendChild(el);

    [
        { t: 0,     msg: 'Connecting to server…',    pct: 10 },
        { t: 8000,  msg: 'Server online…',           pct: 30 },
        { t: 15000, msg: 'Fetching video data…',     pct: 50 },
        { t: 25000, msg: 'Scanning comments…',       pct: 70 },
        { t: 35000, msg: 'Calculating TruthScore…',  pct: 85 },
        { t: 42000, msg: 'Almost done…',             pct: 95 },
    ].forEach(s => setTimeout(() => {
        const m = $('tsMsg'), b = $('tsBar');
        if (m) m.textContent = s.msg;
        if (b) b.style.width = s.pct + '%';
    }, s.t));
}

function removeLoadingOverlay() {
    const b = $('tsBar'); if (b) b.style.width = '100%';
    setTimeout(() => $('loadingOverlay')?.remove(), 400);
}
window.removeLoadingOverlay = removeLoadingOverlay;


// ═══════════════════════════════════════════════════════
// ANALYZE
// ═══════════════════════════════════════════════════════
async function runAnalyze(optionalId) {
    $('inputError')?.classList.add('hidden');
    const raw = optionalId || $('videoInput')?.value.trim();
    if (!raw) { showErr('Please paste a YouTube URL or video ID.'); return; }
    const id = extractVideoId(raw) || raw;
    if (!id)  { showErr('Could not read a video ID — try the full YouTube URL.'); return; }

    $('resultSection')?.classList.add('hidden');
    $('emailGate')?.classList.remove('hidden');
    $('flagsCard')?.classList.add('hidden');

    createLoadingOverlay();
    const btn = $('analyzeBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Analyzing…'; }

    try {
        const res = await fetch(`${BACKEND_URL}/api/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoId: id })
        });
        if (!res.ok) {
            const e = await res.json().catch(() => ({ message: 'Server error' }));
            throw new Error(e.message || 'Analysis failed');
        }
        const data = await res.json();
        removeLoadingOverlay();
        renderResults(data);
    } catch (err) {
        removeLoadingOverlay();
        showErr(err.message || 'Failed to analyse. Please try again.');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Analyze →'; }
    }
}

function showErr(msg) {
    const el = $('inputError');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}


// ═══════════════════════════════════════════════════════
// RENDER RESULTS
// ═══════════════════════════════════════════════════════
function renderResults(payload) {
    const { video, analysis } = payload;
    const score = Math.round(analysis.score);
    _lastScore = score;
    _lastTitle = video.title;

    const dislikePct = (analysis.likeDislikeRatio * 100).toFixed(1);

    // Show section
    $('resultSection')?.classList.remove('hidden');

    // Video meta
    safeText('videoTitle',  video.title);
    safeText('channelInfo', `${video.channelTitle} · ${video.channelAgeYears || 0} yrs old`);
    const votesText = video.dislikeCount !== undefined
        ? `${video.likeCount.toLocaleString()} likes · ${video.dislikeCount.toLocaleString()} hidden dislikes`
        : `${video.likeCount.toLocaleString()} likes`;
    safeHTML('metaInfo', `${video.viewCount.toLocaleString()} views · ${votesText} · ${video.commentCount.toLocaleString()} comments`);

    // Score ring
    const ring = $('scoreRing'), num = $('ringNum');
    if (ring && num) {
        num.textContent  = `${score}%`;
        ring.className   = 'score-ring';
        ring.classList.add(score >= 75 ? 'ring-green' : score >= 45 ? 'ring-amber' : 'ring-red');
    }

    // Mini stats
    safeText('channelTrust', `${Math.round(analysis.channelTrustScore)}/100`);
    const drEl = $('dislikeRatio');
    if (drEl) {
        drEl.textContent = `${dislikePct}%`;
        drEl.style.color = parseFloat(dislikePct) > 30 ? 'var(--red)' : parseFloat(dislikePct) > 15 ? 'var(--amber)' : 'var(--green)';
    }
    safeText('engagement', `${(analysis.engagementRatio * 100).toFixed(3)}%`);

    // Build flags list for gate
    const sorted = [...analysis.flags].sort((a, b) =>
        ({ red:1, yellow:2, blue:3, green:4 }[a.type]||5) - ({ red:1, yellow:2, blue:3, green:4 }[b.type]||5)
    );
    window._pendingFlags = sorted.map(f => ({
        cls : f.type === 'red' ? 'fd-red' : f.type === 'yellow' ? 'fd-amber' : f.type === 'blue' ? 'fd-amber' : 'fd-green',
        html: `<div class="flag-text">${f.text}${f.impact ? `<span style="font-size:.8rem;color:var(--muted);display:block;margin-top:.1rem;">${f.impact}</span>` : ''}</div>`
    }));

    // Report text for copy button
    const verdict = score >= 75 ? 'Likely Legit' : score >= 45 ? 'Be Careful' : 'HIGH RISK 🚨';
    _reportText = [
        `TruthScore Analysis`,
        `──────────────────────────────`,
        `Title:         ${video.title}`,
        `Channel:       ${video.channelTitle}`,
        `TruthScore:    ${score}% — ${verdict}`,
        `Channel Trust: ${Math.round(analysis.channelTrustScore)}/100`,
        `Dislike Ratio: ${dislikePct}%`,
        `Engagement:    ${(analysis.engagementRatio * 100).toFixed(3)}%`,
        ``,
        `Flags:`,
        ...analysis.flags.map(f => `  • ${f.text}`)
    ].join('\n');
    window._reportText = _reportText;

    // Reset gate
    const gs = $('gateStatus');
    if (gs) { gs.textContent = "No spam. We'll also notify you when the Chrome extension launches."; gs.style.color = 'var(--muted)'; }
    const ge = $('gateEmail'); if (ge) ge.value = '';
    $('emailGate')?.classList.remove('hidden');
    $('flagsCard')?.classList.add('hidden');

    // PayPal
    injectPayPal();

    window.scrollTo({ top: ($('resultSection')?.offsetTop || 300) - 80, behavior: 'smooth' });
}


// ═══════════════════════════════════════════════════════
// EMAIL GATE
// ═══════════════════════════════════════════════════════
async function unlockReport() {
    const emailEl = $('gateEmail'), statusEl = $('gateStatus');
    const email   = emailEl?.value.trim() || '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (statusEl) { statusEl.textContent = '⚠️ Please enter a valid email address.'; statusEl.style.color = '#fca5a5'; }
        return;
    }
    if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)'; }

    await postToSheets({ type:'unlock', email, videoTitle:_lastTitle, score:_lastScore, timestamp:new Date().toISOString() });

    // Show flags
    $('emailGate')?.classList.add('hidden');
    const fc = $('flagsCard'), ul = $('flagsList');
    if (fc && ul) {
        ul.innerHTML = '';
        (window._pendingFlags || []).forEach(f => {
            const li = document.createElement('li');
            li.className = 'flag-item';
            li.innerHTML = `<div class="flag-dot ${f.cls}"></div>${f.html}`;
            ul.appendChild(li);
        });
        fc.classList.remove('hidden');
    }
}
window.unlockReport = unlockReport;


// ═══════════════════════════════════════════════════════
// ACTION BUTTONS
// ═══════════════════════════════════════════════════════
function shareResult() {
    const s    = parseInt(_lastScore);
    const risk = s >= 75 ? '✅ Looks Legit' : s >= 45 ? '⚠️ Suspicious' : '🚨 HIGH RISK';
    const text = encodeURIComponent(
        `Just ran "${_lastTitle}" through TruthScore — scored ${_lastScore}% ${risk}\n\nCheck any YouTube video free:\nhttps://truthscore.online`
    );
    window.open(`https://x.com/intent/tweet?text=${text}`, '_blank', 'width=560,height=420');
}

function copyReport() {
    const rpt = window._reportText;
    if (!rpt) return;
    const btn = $('copyBtn');
    const restore = btn ? btn.textContent : '';
    const done = () => { if (btn) { btn.textContent = '✅ Copied!'; setTimeout(() => btn.textContent = restore, 2000); } };
    if (navigator.clipboard) {
        navigator.clipboard.writeText(rpt).then(done).catch(() => fallbackCopy(rpt, done));
    } else { fallbackCopy(rpt, done); }
}
function fallbackCopy(text, cb) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand('copy'); cb(); } catch(e) {}
    document.body.removeChild(ta);
}

function resetTool() {
    $('resultSection')?.classList.add('hidden');
    $('emailGate')?.classList.remove('hidden');
    $('flagsCard')?.classList.add('hidden');
    const v = $('videoInput'); if (v) v.value = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.shareResult = shareResult;
window.copyReport  = copyReport;
window.resetTool   = resetTool;


// ═══════════════════════════════════════════════════════
// PRO MODAL
// ═══════════════════════════════════════════════════════
function openProModal() {
    $('proModal')?.classList.add('open');
    const mf = $('modalForm'), ms = $('modalSuccess');
    if (mf) mf.style.display = '';
    if (ms) ms.style.display = 'none';
    const ps = $('proStatus');
    if (ps) { ps.textContent = 'No spam. We only email you when we launch.'; ps.style.color = 'var(--muted)'; }
}
function closeProModal() { $('proModal')?.classList.remove('open'); }

async function submitProWaitlist() {
    const name = $('proName')?.value.trim() || '', email = $('proEmail')?.value.trim() || '';
    const statusEl = $('proStatus');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (statusEl) { statusEl.textContent = '⚠️ Please enter a valid email.'; statusEl.style.color = '#fca5a5'; }
        return;
    }
    if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)'; }
    await postToSheets({ type:'pro_waitlist', name, email, timestamp:new Date().toISOString() });
    const mf = $('modalForm'), ms = $('modalSuccess');
    if (mf) mf.style.display = 'none';
    if (ms) ms.style.display = 'block';
}

window.openProModal      = openProModal;
window.closeProModal     = closeProModal;
window.submitProWaitlist = submitProWaitlist;


// ═══════════════════════════════════════════════════════
// PAYPAL — injected into pro card on first result render
// ═══════════════════════════════════════════════════════
function injectPayPal() {
    if (_paypalDone) return;

    const proCard = document.querySelector('.pro-card');
    if (!proCard) return;

    // Create container
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin:.75rem 0;display:flex;justify-content:center;';
    const container = document.createElement('div');
    container.id = 'paypal-ts-container';
    wrap.appendChild(container);

    // Insert before .pro-sub
    const sub = proCard.querySelector('.pro-sub');
    proCard.insertBefore(wrap, sub || null);

    // Load SDK then render
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT}&components=hosted-buttons&disable-funding=venmo&currency=USD`;
    script.onload = () => {
        window.paypal?.HostedButtons?.({ hostedButtonId: PAYPAL_BTN_ID })
              .render('#paypal-ts-container');
        _paypalDone = true;
    };
    document.body.appendChild(script);
}
