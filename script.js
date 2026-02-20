// ═══════════════════════════════════════════════
// TruthScore — script.js
// ═══════════════════════════════════════════════

// ── CONFIG ──────────────────────────────────────
const BACKEND_URL   = 'https://truthscore.onrender.com';
const DEMO_VIDEO_ID = 'dQw4w9WgXcQ';

// FIX: Use GET request with URL params — JSON POST with no-cors silently
// drops the body, so Google Apps Script never received anything before.
// Replace this URL with your new deployment /exec URL:
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbx-KXqaZjQ5Nmd_T4oEsh5WvKg4YuqmG_RooCVhqWCCBazQyVFzMauE1tKkvyhqVT4/exec';

const PAYPAL_BTN = 'JGGHMKAMLZ3X8';
const PAYPAL_KEY = 'BAAN-6uTeFePPlFBTb2KRwscuk_CN958_Dp1xPe78I33ZlxbgpQfjilAnXMcrm02M5iYbM9Xr2EnqAwPXs';

// localStorage key — once a user submits email, we remember them
const LS_KEY = 'ts_unlocked';

// ── UTILS ────────────────────────────────────────
const $  = id  => document.getElementById(id);
const $q = sel => document.querySelector(sel);
function setText(id, v) { const e = $(id); if (e) e.textContent = v; }
function setHTML(id, v) { const e = $(id); if (e) e.innerHTML   = v; }

function extractVideoId(url) {
    if (!url) return null;
    const pats = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/i,
        /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const p of pats) { const m = url.match(p); if (m) return m[1]; }
    try {
        const u = new URL(url.includes('://') ? url : 'https://youtube.com/watch?v=' + url);
        return u.searchParams.get('v') || null;
    } catch(e) { return null; }
}

// FIX: Send as GET with URL params — works correctly with no-cors.
// Google Apps Script reads params via e.parameter in doGet().
function saveToSheets(data) {
    try {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(data)) {
            params.append(k, String(v));
        }
        const url = SHEETS_URL + '?' + params.toString();
        // Use no-cors GET — Apps Script receives e.parameter correctly
        fetch(url, { method: 'GET', mode: 'no-cors' }).catch(() => {
            // Fallback: image beacon always fires
            new Image().src = url;
        });
    } catch(e) {
        console.warn('Sheets save error:', e);
    }
}

// Check if this user has already submitted their email
function isUnlocked() {
    try { return !!localStorage.getItem(LS_KEY); } catch(e) { return false; }
}
function markUnlocked(email) {
    try { localStorage.setItem(LS_KEY, email || '1'); } catch(e) {}
}

// ── STATE ────────────────────────────────────────
let _score  = '--';
let _title  = '';
let _report = '';
let _flags  = [];   // [{cls, text, impact}]
let _ppDone = false;

// ── BOOT ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

    // Analyze button
    $('analyzeBtn')?.addEventListener('click', () => runAnalyze());
    $('videoInput')?.addEventListener('keypress', e => { if (e.key === 'Enter') runAnalyze(); });
    $('demoBtn')   ?.addEventListener('click', () => {
        $('videoInput').value = 'https://youtu.be/' + DEMO_VIDEO_ID;
        runAnalyze(DEMO_VIDEO_ID);
    });

    // Result action buttons
    $('shareBtn')?.addEventListener('click', doShare);
    $('copyBtn') ?.addEventListener('click', doCopy);
    $('newBtn')  ?.addEventListener('click', doReset);

    // Email gate
    $('unlockBtn')?.addEventListener('click', unlockReport);
    $('gateEmail')?.addEventListener('keypress', e => { if (e.key === 'Enter') unlockReport(); });

    // Pro modal — close on backdrop
    $('proModal')?.addEventListener('click', e => {
        if (e.target === $('proModal')) closeProModal();
    });
});

// ── LOADER ───────────────────────────────────────
function showLoader() {
    if ($('tsOverlay')) return;
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
        { t: 0,     msg: 'Connecting to server\u2026',   pct: 10 },
        { t: 8000,  msg: 'Server online\u2026',           pct: 30 },
        { t: 15000, msg: 'Fetching video data\u2026',     pct: 50 },
        { t: 25000, msg: 'Scanning comments\u2026',       pct: 70 },
        { t: 35000, msg: 'Calculating TruthScore\u2026',  pct: 85 },
        { t: 42000, msg: 'Almost done\u2026',             pct: 95 },
    ];
    stages.forEach(s => setTimeout(() => {
        const m = $('tsMsg'), b = $('tsBar');
        if (m) m.textContent = s.msg;
        if (b) b.style.width  = s.pct + '%';
    }, s.t));
}

function hideLoader() {
    const b = $('tsBar');
    if (b) b.style.width = '100%';
    setTimeout(() => $('tsOverlay')?.remove(), 350);
}
window.hideLoader   = hideLoader;
window.openProModal = openProModal; // pre-declare ref

// ── ANALYZE ──────────────────────────────────────
async function runAnalyze(optId) {
    const errEl = $('inputError');
    if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }

    const raw = optId || $('videoInput')?.value.trim();
    if (!raw) { showErr('Please paste a YouTube URL or video ID.'); return; }
    const id = extractVideoId(raw) || raw;
    if (!id) { showErr('Could not read a video ID — try the full YouTube URL.'); return; }

    // Reset
    _score = '--'; _title = ''; _report = ''; _flags = [];
    $('resultSection')?.classList.add('hidden');
    $('emailGate')    ?.classList.remove('hidden');
    $('flagsCard')    ?.classList.add('hidden');

    showLoader();

    const btn = $('analyzeBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Analyzing\u2026'; }

    try {
        const res = await fetch(BACKEND_URL + '/api/analyze', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ videoId: id })
        });
        if (!res.ok) {
            const e = await res.json().catch(() => ({ message: 'Server error' }));
            throw new Error(e.message || 'Analysis failed');
        }
        const data = await res.json();
        hideLoader();
        renderResults(data);
    } catch(err) {
        hideLoader();
        showErr(err.message || 'Failed to analyse. Server may be waking up — please wait 30 seconds and try again.');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Analyze \u2192'; }
    }
}

function showErr(msg) {
    const e = $('inputError');
    if (e) { e.textContent = msg; e.classList.remove('hidden'); }
}

// ── RENDER RESULTS ───────────────────────────────
function renderResults(payload) {
    const { video, analysis } = payload;
    const score = Math.round(analysis.score);

    _score = score;
    _title = video.title;

    const dislikePct = (analysis.likeDislikeRatio * 100).toFixed(1);

    // Video meta
    setText('videoTitle',  video.title);
    setText('channelInfo', video.channelTitle + ' \u2022 ' + (video.channelAgeYears || 0) + ' yrs old');
    const votesText = video.dislikeCount !== undefined
        ? video.likeCount.toLocaleString() + ' likes \u00b7 ' + video.dislikeCount.toLocaleString() + ' hidden dislikes'
        : video.likeCount.toLocaleString() + ' likes';
    setHTML('metaInfo', video.viewCount.toLocaleString() + ' views \u00b7 ' + votesText + ' \u00b7 ' + video.commentCount.toLocaleString() + ' comments');

    // Score ring
    const ring = $('scoreRing'), num = $('ringNum');
    if (ring && num) {
        num.textContent = score + '%';
        ring.className  = 'score-ring ' + (score >= 75 ? 'ring-green' : score >= 45 ? 'ring-amber' : 'ring-red');
    }

    // Mini stats
    setText('channelTrust', Math.round(analysis.channelTrustScore) + '/100');
    const drEl = $('dislikeRatio');
    if (drEl) {
        drEl.textContent = dislikePct + '%';
        drEl.style.color = parseFloat(dislikePct) > 30 ? 'var(--red)'
                         : parseFloat(dislikePct) > 15 ? 'var(--amber)'
                         : 'var(--green)';
    }
    setText('engagement', (analysis.engagementRatio * 100).toFixed(3) + '%');

    // Sort and store flags
    const sorted = [...analysis.flags].sort((a, b) =>
        ({ red: 1, yellow: 2, blue: 3, green: 4 }[a.type] || 5) -
        ({ red: 1, yellow: 2, blue: 3, green: 4 }[b.type] || 5)
    );
    _flags = sorted.map(f => ({
        cls:    f.type === 'red' ? 'fd-red' : (f.type === 'yellow' || f.type === 'blue') ? 'fd-amber' : 'fd-green',
        text:   f.text,
        impact: f.impact || ''
    }));

    // Build report text
    const verdict = score >= 75 ? 'Likely Legit' : score >= 45 ? 'Be Careful' : 'HIGH RISK';
    _report = [
        'TruthScore Analysis',
        '\u2500'.repeat(30),
        'Title:         ' + video.title,
        'Channel:       ' + video.channelTitle,
        'TruthScore:    ' + score + '% \u2014 ' + verdict,
        'Channel Trust: ' + Math.round(analysis.channelTrustScore) + '/100',
        'Dislike Ratio: ' + dislikePct + '%',
        'Engagement:    ' + (analysis.engagementRatio * 100).toFixed(3) + '%',
        '',
        'Flags:',
        ...analysis.flags.map(f => '  \u2022 ' + f.text),
        '',
        'https://truthscore.online'
    ].join('\n');

    // Reset gate UI
    const gs = $('gateStatus');
    if (gs) { gs.textContent = "No spam. We\u2019ll notify you when the Chrome extension launches."; gs.style.color = 'var(--muted)'; }
    const ge = $('gateEmail'); if (ge) ge.value = '';
    const ub = $('unlockBtn'); if (ub) { ub.disabled = false; ub.textContent = 'Unlock Free'; }

    // If user already gave email before — skip the gate entirely
    if (isUnlocked()) {
        $('emailGate')?.classList.add('hidden');
        showFlags();
    } else {
        $('emailGate')?.classList.remove('hidden');
        $('flagsCard') ?.classList.add('hidden');
    }

    $('resultSection')?.classList.remove('hidden');
    injectPayPal();

    const top = ($('resultSection')?.offsetTop || 300) - 80;
    window.scrollTo({ top, behavior: 'smooth' });
}

// ── SHOW FLAGS (after gate unlock) ───────────────
function showFlags() {
    const fc = $('flagsCard'), ul = $('flagsList');
    if (!fc || !ul) return;
    ul.innerHTML = '';
    _flags.forEach(f => {
        const li = document.createElement('li');
        li.className = 'flag-item';
        li.innerHTML = '<div class="flag-dot ' + f.cls + '"></div>'
            + '<div>'
            + '<div class="flag-text">' + f.text + '</div>'
            + (f.impact ? '<div class="flag-impact" style="font-size:.78rem;color:var(--muted);margin-top:.2rem;">' + f.impact + '</div>' : '')
            + '</div>';
        ul.appendChild(li);
    });
    fc.classList.remove('hidden');
}

// ── EMAIL GATE ────────────────────────────────────
async function unlockReport() {
    const emailEl   = $('gateEmail');
    const statusEl  = $('gateStatus');
    const unlockBtn = $('unlockBtn');
    const email     = emailEl?.value.trim() || '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (statusEl) { statusEl.textContent = '\u26a0\ufe0f Please enter a valid email address.'; statusEl.style.color = '#fca5a5'; }
        emailEl?.focus();
        return;
    }

    if (unlockBtn) { unlockBtn.disabled = true; unlockBtn.textContent = 'Saving\u2026'; }
    if (statusEl)  { statusEl.textContent = 'Saving\u2026'; statusEl.style.color = 'var(--muted)'; }

    // Save email to Google Sheets
    saveToSheets({
        type:       'unlock',
        email:      email,
        videoTitle: _title  || '',
        score:      String(_score),
        timestamp:  new Date().toISOString()
    });

    // Remember this user so they never see the gate again
    markUnlocked(email);

    // Hide gate, show full flags
    $('emailGate')?.classList.add('hidden');
    showFlags();

    if (unlockBtn) { unlockBtn.disabled = false; unlockBtn.textContent = 'Unlock Free'; }

    // Scroll to flags
    setTimeout(() => {
        const fc = $('flagsCard');
        if (fc) window.scrollTo({ top: fc.offsetTop - 80, behavior: 'smooth' });
    }, 100);
}
window.unlockReport = unlockReport;

// ── ACTION BUTTONS ────────────────────────────────

// 🐦 Share on X
function doShare() {
    if (_score === '--') {
        showErr('Analyze a video first, then share the result!');
        return;
    }
    const s    = parseInt(_score);
    const risk = s >= 75 ? '\u2705 Looks Legit' : s >= 45 ? '\u26a0\ufe0f Suspicious' : '\ud83d\udea8 HIGH RISK';
    const text = '"' + _title + '" scored ' + _score + '% on TruthScore \u2014 ' + risk
        + '\n\nCheck any YouTube video free:\nhttps://truthscore.online';
    window.open(
        'https://x.com/intent/tweet?text=' + encodeURIComponent(text),
        '_blank', 'noopener,width=560,height=420'
    );
}

// 📋 Copy Report
function doCopy() {
    if (!_report) {
        showErr('Analyze a video first, then copy the report!');
        return;
    }
    const btn  = $('copyBtn');
    const orig = btn ? btn.textContent : '';
    const ok   = () => {
        if (btn) { btn.textContent = '\u2705 Copied!'; setTimeout(() => btn.textContent = orig, 2500); }
    };
    if (navigator.clipboard) {
        navigator.clipboard.writeText(_report).then(ok).catch(() => fbCopy(ok));
    } else {
        fbCopy(ok);
    }
}
function fbCopy(cb) {
    const ta = document.createElement('textarea');
    ta.value = _report;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand('copy'); cb(); } catch(e) {}
    document.body.removeChild(ta);
}

// Analyze Another
function doReset() {
    _score = '--'; _title = ''; _report = ''; _flags = [];
    $('resultSection')?.classList.add('hidden');
    $('emailGate')    ?.classList.remove('hidden');
    $('flagsCard')    ?.classList.add('hidden');
    const v = $('videoInput');
    if (v) { v.value = ''; v.focus(); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── PRO MODAL ─────────────────────────────────────
function openProModal() {
    const modal = $('proModal');
    if (!modal) return;
    modal.classList.add('open');
    const mf = $('modalForm'), ms = $('modalSuccess');
    if (mf) mf.style.display = '';
    if (ms) ms.style.display = 'none';
    const ps = $('proStatus');
    if (ps) { ps.textContent = 'No spam. We only email you when we launch.'; ps.style.color = 'var(--muted)'; }
    const sb = $('proSubmitBtn');
    if (sb) { sb.disabled = false; sb.textContent = 'Secure My Spot \u2014 Free'; }
    setTimeout(() => $('proEmail')?.focus(), 100);
}

function closeProModal() {
    $('proModal')?.classList.remove('open');
}

async function submitProWaitlist() {
    const name  = $('proName') ?.value.trim() || '';
    const email = $('proEmail')?.value.trim() || '';
    const st    = $('proStatus');
    const sb    = $('proSubmitBtn');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (st) { st.textContent = '\u26a0\ufe0f Please enter a valid email address.'; st.style.color = '#fca5a5'; }
        $('proEmail')?.focus();
        return;
    }

    if (sb) { sb.disabled = true; sb.textContent = 'Saving\u2026'; }
    if (st) { st.textContent = 'Saving\u2026'; st.style.color = 'var(--muted)'; }

    saveToSheets({ type: 'pro_waitlist', name, email, timestamp: new Date().toISOString() });

    const mf = $('modalForm'), ms = $('modalSuccess');
    if (mf) mf.style.display = 'none';
    if (ms) ms.style.display = 'block';
    if (sb) { sb.disabled = false; }
}

// All modal functions global — used by onclick in HTML
window.openProModal      = openProModal;
window.closeProModal     = closeProModal;
window.submitProWaitlist = submitProWaitlist;

// ── PAYPAL ────────────────────────────────────────
function injectPayPal() {
    if (_ppDone) return;
    const proCard = $q('.pro-card');
    if (!proCard) return;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin:.75rem 0;display:flex;justify-content:center;';
    const container = document.createElement('div');
    container.id = 'paypal-ts-btn';
    wrap.appendChild(container);
    const sub = proCard.querySelector('.pro-sub');
    proCard.insertBefore(wrap, sub || null);

    const s = document.createElement('script');
    s.src = 'https://www.paypal.com/sdk/js?client-id=' + PAYPAL_KEY + '&components=hosted-buttons&disable-funding=venmo&currency=USD';
    s.onload = () => {
        window.paypal?.HostedButtons?.({ hostedButtonId: PAYPAL_BTN }).render('#paypal-ts-btn');
        _ppDone = true;
    };
    document.body.appendChild(s);
}
