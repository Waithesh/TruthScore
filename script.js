// ═══════════════════════════════════════════════════════════════════
// TruthScore — script.js (fully fixed)
// ═══════════════════════════════════════════════════════════════════

const BACKEND_URL = 'https://truthscore.onrender.com';
const DEMO_VIDEO_ID = 'dQw4w9WgXcQ';

const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbzD7h7wHB61GyYgjte--Tfzh2kQ5Qdu_N_TvnVZanM/exec';
// CRITICAL FIX: Google Apps Script requires GET requests (params in URL)
// or form-encoded POST. Sending JSON with mode:'no-cors' silently strips
// headers and the Apps Script body is empty — that's why nothing saved.
// Solution: append data as URL query params and use GET with no-cors.
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbxaPe-cbB1hZZ8QKKG2VLO3fo-bFWfaYqBji2_HAkDu7RwV5WkWM3GMrKSpPSPIEvE/exec';

const PAYPAL_BTN = 'JGGHMKAMLZ3X8';
const PAYPAL_KEY = 'BAAN-6uTeFePPlFBTb2KRwscuk_CN958_Dp1xPe78I33ZlxbgpQfjilAnXMcrm02M5iYbM9Xr2EnqAwPXs';

// ── Helpers ──────────────────────────────────────────────────────────
const $  = id  => document.getElementById(id);
const $q = sel => document.querySelector(sel);
const setText = (id, v) => { const e = $(id); if (e) e.textContent = v; };
const setHTML = (id, v) => { const e = $(id); if (e) e.innerHTML   = v; };

function fmtNum(n) {
    n = parseInt(n);
    if (isNaN(n)) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000)    return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
}

function escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
    } catch { return null; }
}

// ── Google Sheets save (GET request — the CORRECT method) ────────────
async function saveToSheets(data) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(data)) params.append(k, String(v));
    const url = SHEETS_URL + '?' + params.toString();
    try {
        // GET + no-cors works perfectly: Apps Script reads e.parameter on GET
        await fetch(url, { method: 'GET', mode: 'no-cors' });
    } catch {
        // Fallback: image beacon — always fires even if fetch is blocked
        try { new Image().src = url; } catch {}
    }
}

// ── App State ────────────────────────────────────────────────────────
let _state = {
    score:   null,
    title:   '',
    channel: '',
    report:  '',
    flags:   [],
    videoId: null,
    ppDone:  false
};

// ── Boot ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

    $('analyzeBtn')?.addEventListener('click', () => runAnalyze());
    $('videoInput')?.addEventListener('keypress', e => { if (e.key === 'Enter') runAnalyze(); });
    $('demoBtn')   ?.addEventListener('click', () => {
        $('videoInput').value = 'https://youtu.be/' + DEMO_VIDEO_ID;
        runAnalyze(DEMO_VIDEO_ID);
    });

    $('shareBtn')?.addEventListener('click', doShare);
    $('copyBtn') ?.addEventListener('click', doCopy);
    $('newBtn')  ?.addEventListener('click', doReset);

    $('unlockBtn')?.addEventListener('click', unlockReport);
    $('gateEmail')?.addEventListener('keypress', e => { if (e.key === 'Enter') unlockReport(); });

    $('proModal')?.addEventListener('click', e => {
        if (e.target === $('proModal')) closeProModal();
    });
});

// ── Loader overlay ───────────────────────────────────────────────────
function showLoader() {
    if ($('tsOverlay')) return;
    const el = document.createElement('div');
    el.id = 'tsOverlay';
    el.innerHTML = `
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
    document.body.appendChild(el);
    $('tsWBtn').addEventListener('click', () => { hideLoader(); openProModal(); });

    [
        { t: 0,     msg: 'Connecting to server\u2026',   pct: 10 },
        { t: 8000,  msg: 'Server online\u2026',           pct: 30 },
        { t: 15000, msg: 'Fetching video data\u2026',     pct: 50 },
        { t: 25000, msg: 'Scanning comments\u2026',       pct: 70 },
        { t: 35000, msg: 'Calculating TruthScore\u2026',  pct: 85 },
        { t: 42000, msg: 'Almost done\u2026',             pct: 95 },
    ].forEach(s => setTimeout(() => {
        const m = $('tsMsg'), b = $('tsBar');
        if (m) m.textContent = s.msg;
        if (b) b.style.width  = s.pct + '%';
    }, s.t));
}

function hideLoader() {
    const b = $('tsBar');
    if (b) b.style.width = '100%';
    setTimeout(() => $('tsOverlay')?.remove(), 400);
}

// ── Fetch public teaser data (no API key needed) ─────────────────────
async function fetchTeaserData(videoId) {
    const out = { title: null, channel: null, likes: null, dislikes: null, views: null };

    // YouTube oEmbed → title + channel (free, no key)
    try {
        const r = await fetch(
            'https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=' + videoId + '&format=json'
        );
        if (r.ok) {
            const d = await r.json();
            out.title   = d.title       || null;
            out.channel = d.author_name || null;
        }
    } catch {}

    // ReturnYouTubeDislike → likes, hidden dislikes, views (free, no key)
    try {
        const r = await fetch('https://returnyoutubedislikeapi.com/votes?videoId=' + videoId);
        if (r.ok) {
            const d = await r.json();
            out.likes    = d.likes     ?? null;
            out.dislikes = d.dislikes  ?? null;
            out.views    = d.viewCount ?? null;
        }
    } catch {}

    return out;
}

// ── ANALYZE ──────────────────────────────────────────────────────────
async function runAnalyze(optId) {
    const errEl = $('inputError');
    if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }

    const raw = optId || $('videoInput')?.value.trim() || '';
    if (!raw) { showErr('Please paste a YouTube URL or video ID.'); return; }

    const id = extractVideoId(raw) || (raw.length === 11 ? raw : null);
    if (!id)  { showErr('Could not find a video ID — please paste the full YouTube URL.'); return; }

    _state = { score: null, title: '', channel: '', report: '', flags: [], videoId: id, ppDone: _state.ppDone };

    $('resultSection')?.classList.add('hidden');
    $('emailGate')    ?.classList.remove('hidden');
    $('flagsCard')    ?.classList.add('hidden');

    const btn = $('analyzeBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Analyzing\u2026'; }

    showLoader();

    // Fetch teaser immediately from free public APIs (~1 sec)
    let teaser = {};
    try { teaser = await fetchTeaserData(id); } catch {}
    if (teaser.title || teaser.channel) renderTeaser(teaser);

    // Hit backend for full AI analysis (may take 45 sec on cold start)
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 65000);

        const res = await fetch(BACKEND_URL + '/api/analyze', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ videoId: id }),
            signal:  controller.signal
        });
        clearTimeout(timer);

        if (!res.ok) {
            const e = await res.json().catch(() => ({ message: 'Server error' }));
            throw new Error(e.message || 'Analysis failed');
        }
        const data = await res.json();
        hideLoader();
        renderFullResults(data, teaser);
    } catch (err) {
        hideLoader();
        if (teaser.title || teaser.channel) {
            renderPartialResults(teaser); // show partial score from public data
        } else {
            showErr('Could not connect to server. Please try again in a moment.');
            $('resultSection')?.classList.add('hidden');
        }
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Analyze \u2192'; }
    }
}

function showErr(msg) {
    const e = $('inputError');
    if (e) { e.textContent = msg; e.classList.remove('hidden'); }
}

// ── Render teaser (instant — from public APIs) ───────────────────────
function renderTeaser(t) {
    _state.title   = t.title   || '';
    _state.channel = t.channel || '';

    setText('videoTitle',  t.title   || 'Loading\u2026');
    setText('channelInfo', t.channel || '');

    const parts = [];
    if (t.views    != null) parts.push(fmtNum(t.views)    + ' views');
    if (t.likes    != null) parts.push(fmtNum(t.likes)    + ' likes');
    if (t.dislikes != null) parts.push(fmtNum(t.dislikes) + ' hidden dislikes');
    setHTML('metaInfo', parts.join(' &middot; ') || '');

    const ring = $('scoreRing'), num = $('ringNum');
    if (ring && num) { num.textContent = '\u2026'; ring.className = 'score-ring ring-amber'; }
    setText('channelTrust', '\u2026');
    setText('engagement',   '\u2026');

    const drEl = $('dislikeRatio');
    if (drEl) {
        if (t.likes != null && t.dislikes != null) {
            const pct = ((t.dislikes / (t.likes + t.dislikes + 1)) * 100).toFixed(1);
            drEl.textContent = pct + '%';
            drEl.style.color = parseFloat(pct) > 30 ? 'var(--red)' : parseFloat(pct) > 15 ? 'var(--amber)' : 'var(--green)';
        } else { drEl.textContent = '\u2026'; }
    }

    resetGateUI();
    $('resultSection')?.classList.remove('hidden');
    window.scrollTo({ top: ($('resultSection')?.offsetTop || 300) - 80, behavior: 'smooth' });
}

// ── Render partial results (backend failed — public API only) ─────────
function renderPartialResults(t) {
    const dr = (t.likes != null && t.dislikes != null)
        ? (t.dislikes / (t.likes + t.dislikes + 1)) * 100 : null;

    const score = dr !== null ? Math.round(Math.max(0, Math.min(100, 100 - dr * 2.5))) : 50;
    _state.score = score;

    const ring = $('scoreRing'), num = $('ringNum');
    if (ring && num) {
        num.textContent = score + '%';
        ring.className  = 'score-ring ' + (score >= 75 ? 'ring-green' : score >= 45 ? 'ring-amber' : 'ring-red');
    }

    const flags = [];
    if (dr !== null) {
        const pct = dr.toFixed(1);
        if (dr > 30)      flags.push({ cls: 'fd-red',   text: 'High hidden dislike ratio: ' + pct + '% — strong negative signal',     impact: 'Many viewers disliked this video' });
        else if (dr > 15) flags.push({ cls: 'fd-amber', text: 'Elevated hidden dislike ratio: ' + pct + '% — moderate warning',        impact: 'Worth being cautious' });
        else              flags.push({ cls: 'fd-green', text: 'Low dislike ratio: ' + pct + '% — viewers generally satisfied',          impact: 'Positive signal' });
    }
    flags.push({ cls: 'fd-amber', text: 'Full AI analysis (comment scanning, language detection) unavailable — backend is warming up. Re-analyze in ~1 minute for the complete report.', impact: '' });

    _state.flags  = flags;
    _state.report = buildReport(t.title, t.channel, score, null, null, null, flags.map(f => f.text));
}

// ── Render full results (backend succeeded) ───────────────────────────
function renderFullResults(payload, teaser) {
    const { video, analysis } = payload;
    const score   = Math.round(analysis.score);
    const drPct   = (analysis.likeDislikeRatio * 100).toFixed(1);

    _state.score   = score;
    _state.title   = video.title        || teaser?.title   || '';
    _state.channel = video.channelTitle || teaser?.channel || '';

    setText('videoTitle',  video.title);
    setText('channelInfo', video.channelTitle + ' \u2022 ' + (video.channelAgeYears || 0) + ' yrs old');

    const votesText = video.dislikeCount !== undefined
        ? fmtNum(video.likeCount) + ' likes \u00b7 ' + fmtNum(video.dislikeCount) + ' hidden dislikes'
        : fmtNum(video.likeCount) + ' likes';
    setHTML('metaInfo', fmtNum(video.viewCount) + ' views \u00b7 ' + votesText + ' \u00b7 ' + fmtNum(video.commentCount) + ' comments');

    const ring = $('scoreRing'), num = $('ringNum');
    if (ring && num) {
        num.textContent = score + '%';
        ring.className  = 'score-ring ' + (score >= 75 ? 'ring-green' : score >= 45 ? 'ring-amber' : 'ring-red');
    }

    setText('channelTrust', Math.round(analysis.channelTrustScore) + '/100');
    const drEl = $('dislikeRatio');
    if (drEl) {
        drEl.textContent = drPct + '%';
        drEl.style.color = parseFloat(drPct) > 30 ? 'var(--red)' : parseFloat(drPct) > 15 ? 'var(--amber)' : 'var(--green)';
    }
    setText('engagement', (analysis.engagementRatio * 100).toFixed(3) + '%');

    const sorted = [...analysis.flags].sort((a, b) =>
        ({ red: 1, yellow: 2, blue: 3, green: 4 }[a.type] || 5) -
        ({ red: 1, yellow: 2, blue: 3, green: 4 }[b.type] || 5)
    );
    _state.flags = sorted.map(f => ({
        cls:    f.type === 'red' ? 'fd-red' : (f.type === 'yellow' || f.type === 'blue') ? 'fd-amber' : 'fd-green',
        text:   f.text,
        impact: f.impact || ''
    }));

    _state.report = buildReport(
        video.title, video.channelTitle, score,
        Math.round(analysis.channelTrustScore), drPct,
        (analysis.engagementRatio * 100).toFixed(3) + '%',
        analysis.flags.map(f => f.text)
    );

    resetGateUI();
    $('emailGate')?.classList.remove('hidden');
    $('flagsCard') ?.classList.add('hidden');
    $('resultSection')?.classList.remove('hidden');

    injectPayPal();
    window.scrollTo({ top: ($('resultSection')?.offsetTop || 300) - 80, behavior: 'smooth' });
}

function resetGateUI() {
    const gs = $('gateStatus');
    if (gs) { gs.textContent = "No spam. We\u2019ll also notify you when the Chrome extension launches."; gs.style.color = 'var(--muted)'; }
    const ge = $('gateEmail'); if (ge) ge.value = '';
    const ub = $('unlockBtn'); if (ub) { ub.disabled = false; ub.textContent = 'Unlock Free'; }
}

function buildReport(title, channel, score, trust, drPct, engagement, flagTexts) {
    const verdict = score >= 75 ? 'Likely Legit' : score >= 45 ? 'Be Careful' : 'HIGH RISK';
    const lines = [
        '\u2501'.repeat(32),
        '  TruthScore Analysis Report',
        '\u2501'.repeat(32),
        'Title:         ' + (title    || '\u2014'),
        'Channel:       ' + (channel  || '\u2014'),
        'TruthScore:    ' + score + '% \u2014 ' + verdict,
    ];
    if (trust      != null) lines.push('Channel Trust: ' + trust + '/100');
    if (drPct      != null) lines.push('Dislike Ratio: ' + drPct + '%');
    if (engagement != null) lines.push('Engagement:    ' + engagement);
    lines.push('', 'Red Flags & Insights:');
    (flagTexts || []).forEach(t => lines.push('  \u2022 ' + t));
    lines.push('', 'Checked at https://truthscore.online');
    return lines.join('\n');
}

// ── Email Gate — unlock full report ──────────────────────────────────
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
    if (statusEl)  { statusEl.textContent = 'Saving your email\u2026'; statusEl.style.color = 'var(--muted)'; }

    // Save to Google Sheets (GET request — works with no-cors)
    await saveToSheets({
        type:       'unlock',
        email:      email,
        videoTitle: _state.title || '',
        score:      String(_state.score ?? ''),
        timestamp:  new Date().toISOString()
    });

    // Hide gate — always reveal flags regardless of save success
    $('emailGate')?.classList.add('hidden');

    const fc = $('flagsCard'), ul = $('flagsList');
    if (fc && ul) {
        ul.innerHTML = '';

        if (_state.flags.length === 0) {
            ul.innerHTML = `<li class="flag-item">
                <div class="flag-dot fd-amber"></div>
                <div class="flag-text">Analysis is still loading. Please wait a moment and try again.</div>
            </li>`;
        } else {
            _state.flags.forEach(f => {
                const li = document.createElement('li');
                li.className = 'flag-item';
                li.innerHTML = `<div class="flag-dot ${escHtml(f.cls)}"></div>
                    <div>
                        <div class="flag-text">${escHtml(f.text)}</div>
                        ${f.impact ? `<div class="flag-impact" style="font-size:.78rem;color:var(--muted);margin-top:.2rem;">${escHtml(f.impact)}</div>` : ''}
                    </div>`;
                ul.appendChild(li);
            });
        }
        fc.classList.remove('hidden');
    }

    if (unlockBtn) { unlockBtn.disabled = false; unlockBtn.textContent = 'Unlock Free'; }
    setTimeout(() => { window.scrollTo({ top: (fc?.offsetTop || 400) - 80, behavior: 'smooth' }); }, 100);
}
window.unlockReport = unlockReport;

// ── Share on X ────────────────────────────────────────────────────────
function doShare() {
    if (_state.score === null) {
        alert('Please analyze a video first, then share the result!');
        return;
    }
    const s    = _state.score;
    const risk = s >= 75 ? '\u2705 Looks Legit' : s >= 45 ? '\u26a0\ufe0f Suspicious' : '\ud83d\udea8 HIGH RISK';
    const tweet = (_state.title ? '"' + _state.title + '"' : 'a YouTube video')
        + ' scored ' + s + '% on TruthScore \u2014 ' + risk + '\n\nCheck any YouTube video free:\nhttps://truthscore.online';
    window.open('https://x.com/intent/tweet?text=' + encodeURIComponent(tweet), '_blank', 'noopener,width=560,height=420');
}

// ── Copy Report ────────────────────────────────────────────────────────
function doCopy() {
    if (!_state.report) {
        alert('No report yet. Please analyze a video first.');
        return;
    }
    const btn  = $('copyBtn');
    const orig = btn?.textContent || '\ud83d\udccb Copy Report';
    const onOk = () => {
        if (btn) { btn.textContent = '\u2705 Copied!'; setTimeout(() => btn.textContent = orig, 2500); }
    };
    if (navigator.clipboard) {
        navigator.clipboard.writeText(_state.report).then(onOk).catch(() => fallbackCopy(onOk));
    } else {
        fallbackCopy(onOk);
    }
}

function fallbackCopy(cb) {
    const ta = document.createElement('textarea');
    ta.value = _state.report;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand('copy'); cb(); } catch {}
    document.body.removeChild(ta);
}

// ── Analyze Another ────────────────────────────────────────────────────
function doReset() {
    _state = { score: null, title: '', channel: '', report: '', flags: [], videoId: null, ppDone: _state.ppDone };
    $('resultSection')?.classList.add('hidden');
    $('emailGate')    ?.classList.remove('hidden');
    $('flagsCard')    ?.classList.add('hidden');
    const v = $('videoInput');
    if (v) { v.value = ''; v.focus(); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Pro Waitlist Modal ─────────────────────────────────────────────────
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
    setTimeout(() => $('proEmail')?.focus(), 150);
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
    if (st) { st.textContent = 'Saving your email\u2026'; st.style.color = 'var(--muted)'; }

    await saveToSheets({ type: 'pro_waitlist', name, email, timestamp: new Date().toISOString() });

    const mf = $('modalForm'), ms = $('modalSuccess');
    if (mf) mf.style.display = 'none';
    if (ms) ms.style.display = 'block';
    if (sb) { sb.disabled = false; sb.textContent = 'Secure My Spot \u2014 Free'; }
}

// Expose to window — required for HTML onclick attributes
window.openProModal      = openProModal;
window.closeProModal     = closeProModal;
window.submitProWaitlist = submitProWaitlist;
window.unlockReport      = unlockReport;
window.hideLoader        = hideLoader;

// ── PayPal ─────────────────────────────────────────────────────────────
function injectPayPal() {
    if (_state.ppDone) return;
    const proCard = $q('.pro-card');
    if (!proCard) return;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin:.75rem 0;display:flex;justify-content:center;';
    const container = document.createElement('div');
    container.id = 'paypal-ts-btn';
    wrap.appendChild(container);
    proCard.insertBefore(wrap, proCard.querySelector('.pro-sub') || null);

    const s = document.createElement('script');
    s.src = 'https://www.paypal.com/sdk/js?client-id=' + PAYPAL_KEY + '&components=hosted-buttons&disable-funding=venmo&currency=USD';
    s.onload = () => {
        window.paypal?.HostedButtons?.({ hostedButtonId: PAYPAL_BTN }).render('#paypal-ts-btn');
        _state.ppDone = true;
    };
    document.body.appendChild(s);
}
