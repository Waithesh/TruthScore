// ═══════════════════════════════════════════════
// TruthScore — script.js
// ═══════════════════════════════════════════════

// ── CONFIG — update SHEETS_URL with your new /exec deployment link ──
const BACKEND_URL   = 'https://truthscore.onrender.com';
const DEMO_VIDEO_ID = 'dQw4w9WgXcQ';
const SHEETS_URL    = 'https://script.google.com/macros/s/AKfycbz_Gm3jeFFj8WzWatTj5CHegqFX1rtbosTsz2jEkMpwyAcZrTmkdNXb6bLMCH1LqmmN/exec';
// PayPal hosted button is now injected directly in index.html

const LS_KEY        = 'ts_email_given'; // localStorage key for returning users

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

// Send data to Google Sheets via GET (no-cors safe — body is NOT sent in no-cors POST)
function saveToSheets(data) {
  try {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(data)) params.append(k, String(v));
    const url = SHEETS_URL + '?' + params.toString();
    fetch(url, { method: 'GET', mode: 'no-cors' })
      .catch(() => { try { new Image().src = url; } catch(e) {} });
  } catch(e) { console.warn('Sheets:', e); }
}

function hasGivenEmail() {
  try { return !!localStorage.getItem(LS_KEY); } catch(e) { return false; }
}
function rememberEmail(email) {
  try { localStorage.setItem(LS_KEY, email); } catch(e) {}
}

// ── STATE ────────────────────────────────────────
let _score  = null;   // number or null
let _title  = '';
let _report = '';
let _flags  = [];

// ── BOOT ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  $('analyzeBtn')?.addEventListener('click',    () => runAnalyze());
  $('videoInput')?.addEventListener('keypress', e  => { if (e.key === 'Enter') runAnalyze(); });
  $('demoBtn')   ?.addEventListener('click',    () => {
    $('videoInput').value = 'https://youtu.be/' + DEMO_VIDEO_ID;
    runAnalyze(DEMO_VIDEO_ID);
  });

  $('shareBtn')?.addEventListener('click', doShare);
  $('copyBtn') ?.addEventListener('click', doCopy);
  $('newBtn')  ?.addEventListener('click', doReset);

  $('unlockBtn') ?.addEventListener('click',    unlockReport);
  $('gateEmail') ?.addEventListener('keypress', e => { if (e.key === 'Enter') unlockReport(); });

  $('proModal')?.addEventListener('click', e => {
    if (e.target === $('proModal')) closeProModal();
  });
});

// ── LOADING OVERLAY ───────────────────────────────
function showLoader() {
  if ($('tsOverlay')) return;
  const d = document.createElement('div');
  d.id = 'tsOverlay';
  d.innerHTML = `
<style>
#tsOverlay{position:fixed;inset:0;background:rgba(0,0,0,.93);display:flex;align-items:center;justify-content:center;z-index:99999;animation:tsF .3s}
@keyframes tsF{from{opacity:0}to{opacity:1}}
#tsBox{background:#111;border:1px solid #222;border-radius:18px;padding:2.5rem;max-width:460px;width:90%;text-align:center}
#tsIco{font-size:3rem;margin-bottom:.75rem;animation:tsP 2s infinite;display:inline-block}
@keyframes tsP{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
#tsTtl{font-family:'Syne',sans-serif;font-size:1.3rem;font-weight:800;color:#f0f0f0;margin-bottom:.35rem}
#tsMsg{color:#777;font-size:.9rem;margin-bottom:1.4rem}
#tsBarW{width:100%;height:7px;background:#1a1a1a;border-radius:4px;overflow:hidden;margin-bottom:1.4rem}
#tsBar{width:0%;height:100%;background:linear-gradient(90deg,#ff3c3c,#ff8080);transition:width .6s ease;border-radius:4px}
#tsInfo{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:10px;padding:.9rem 1.1rem;text-align:left;margin-bottom:1.2rem}
#tsInfo p{margin:0;color:#fcd34d;font-size:.84rem;line-height:1.5}
#tsWBtn{background:#ff3c3c;color:#fff;border:none;border-radius:10px;padding:.8rem 1.6rem;font-family:'Syne',sans-serif;font-weight:700;font-size:.9rem;cursor:pointer;transition:background .2s}
#tsWBtn:hover{background:#b91c1c}
#tsNote{color:#444;font-size:.75rem;margin-top:.5rem}
</style>
<div id="tsBox">
  <div id="tsIco">🛡️</div>
  <h3 id="tsTtl">Waking up analysis engine…</h3>
  <p  id="tsMsg">Connecting to server…</p>
  <div id="tsBarW"><div id="tsBar"></div></div>
  <div id="tsInfo">
    <p><strong>⚡ Free Tier Notice:</strong> First request wakes the server — takes up to 45 seconds. Subsequent analyses are fast.</p>
  </div>
  <button id="tsWBtn">🚀 Join Pro Waitlist — Skip the Wait</button>
  <p id="tsNote">Early members get 50% off Pro forever</p>
</div>`;
  document.body.appendChild(d);
  $('tsWBtn').addEventListener('click', () => { hideLoader(); openProModal(); });

  [
    { t: 0,     msg: 'Connecting to server…',   pct: 8  },
    { t: 5000,  msg: 'Server is waking up…',    pct: 25 },
    { t: 15000, msg: 'Fetching video data…',    pct: 45 },
    { t: 25000, msg: 'Scanning comments…',      pct: 65 },
    { t: 35000, msg: 'Calculating score…',      pct: 82 },
    { t: 43000, msg: 'Almost done…',            pct: 94 },
  ].forEach(s => setTimeout(() => {
    setText('tsMsg', s.msg);
    const b = $('tsBar'); if (b) b.style.width = s.pct + '%';
  }, s.t));
}

function hideLoader() {
  const b = $('tsBar'); if (b) b.style.width = '100%';
  setTimeout(() => $('tsOverlay')?.remove(), 400);
}
window.hideLoader   = hideLoader;
window.openProModal = openProModal;

// ── ANALYZE ───────────────────────────────────────
async function runAnalyze(optId) {
  // Clear any previous error
  const errEl = $('inputError');
  if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }

  const raw = optId || ($('videoInput')?.value.trim() || '');
  if (!raw) { showErr('Please paste a YouTube URL or video ID.'); return; }

  const id = extractVideoId(raw) || (raw.length === 11 ? raw : null);
  if (!id)  { showErr('Could not find a video ID — please paste the full YouTube URL.'); return; }

  // Reset state + UI
  _score = null; _title = ''; _report = ''; _flags = [];
  $('resultSection')?.classList.add('hidden');
  $('emailGate')    ?.classList.remove('hidden');
  $('flagsCard')    ?.classList.add('hidden');

  const btn = $('analyzeBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Analyzing…'; }

  showLoader();

  try {
    const res = await fetch(BACKEND_URL + '/api/analyze', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ videoId: id })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ message: 'Server error' }));
      throw new Error(errData.message || 'Analysis failed');
    }

    const data = await res.json();
    hideLoader();
    renderResults(data);

  } catch(err) {
    hideLoader();
    if (err.name === 'TypeError' || err.message.includes('fetch')) {
      showErr('Could not reach the analysis server. It may still be waking up — please wait 30 seconds and try again.');
    } else {
      showErr(err.message || 'Analysis failed. Please try again.');
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Analyze →'; }
  }
}

function showErr(msg) {
  const e = $('inputError');
  if (e) { e.textContent = msg; e.classList.remove('hidden'); }
}

// ── RENDER RESULTS ────────────────────────────────
function renderResults(payload) {
  const { video, analysis } = payload;
  const score = Math.round(analysis.score);

  _score = score;
  _title = video.title;

  const dislikePct = (analysis.likeDislikeRatio * 100).toFixed(1);

  // Video summary — always visible
  setText('videoTitle',  video.title);
  setText('channelInfo', video.channelTitle + ' • ' + (video.channelAgeYears || 0) + ' yrs old');

  // Use "est. dislikes" to be honest about the data source
  const votesText = video.dislikeCount != null
    ? video.likeCount.toLocaleString() + ' likes · ' + video.dislikeCount.toLocaleString() + ' est. dislikes'
    : video.likeCount.toLocaleString() + ' likes';
  setHTML('metaInfo', video.viewCount.toLocaleString() + ' views · ' + votesText + ' · ' + video.commentCount.toLocaleString() + ' comments');

  // ── GATED: Score ring shows "?" until email submitted ──
  const ring = $('scoreRing'), num = $('ringNum');
  if (ring && num) {
    num.textContent = '?';
    ring.className  = 'score-ring ring-locked';
  }

  // ── GATED: Mini stats replaced with blur placeholders ──
  const channelTrustEl = $('channelTrust');
  const dislikeRatioEl = $('dislikeRatio');
  const engagementEl   = $('engagement');
  if (channelTrustEl) { channelTrustEl.textContent = '??/100'; channelTrustEl.classList.add('stat-locked'); }
  if (dislikeRatioEl) { dislikeRatioEl.textContent = '?%';     dislikeRatioEl.classList.add('stat-locked'); }
  if (engagementEl)   { engagementEl.textContent   = '?%';     engagementEl.classList.add('stat-locked');   }

  // Store flags and full data for reveal after email
  const sorted = [...analysis.flags].sort((a, b) =>
    ({ red: 1, yellow: 2, blue: 3, green: 4 }[a.type] || 5) -
    ({ red: 1, yellow: 2, blue: 3, green: 4 }[b.type] || 5)
  );
  _flags = sorted.map(f => ({
    cls:    f.type === 'red' ? 'fd-red' : (f.type === 'yellow' || f.type === 'blue') ? 'fd-amber' : 'fd-green',
    text:   f.text,
    impact: f.impact || ''
  }));

  // Store the real values so we can reveal them after unlock
  _realScore       = score;
  _realDislikePct  = dislikePct;
  _realTrust       = Math.round(analysis.channelTrustScore);
  _realEngagement  = (analysis.engagementRatio * 100).toFixed(3);
  _realRingClass   = score >= 75 ? 'ring-green' : score >= 45 ? 'ring-amber' : 'ring-red';
  _realDislikeColor = parseFloat(dislikePct) > 30 ? 'var(--red)'
                    : parseFloat(dislikePct) > 15 ? 'var(--amber)'
                    : 'var(--green)';

  // Build shareable report text (built now, used after unlock)
  const verdict = score >= 75 ? 'Likely Legit' : score >= 45 ? 'Be Careful' : 'HIGH RISK';
  _report = [
    '══════════════════════════════',
    '  TruthScore Analysis Report',
    '══════════════════════════════',
    'Title:         ' + video.title,
    'Channel:       ' + video.channelTitle,
    'TruthScore:    ' + score + '% — ' + verdict,
    'Channel Trust: ' + Math.round(analysis.channelTrustScore) + '/100',
    'Dislike Ratio: ' + dislikePct + '%',
    'Engagement:    ' + (analysis.engagementRatio * 100).toFixed(3) + '%',
    '',
    'Red Flags & Insights:',
    ...analysis.flags.map(f => '  • ' + f.text),
    '',
    'Checked at https://truthscore.online'
  ].join('\n');

  // Reset gate UI with better message
  const gs = $('gateStatus');
  if (gs) { gs.textContent = 'Free forever. No spam. Unsubscribe anytime.'; gs.style.color = 'var(--muted)'; }
  const ge = $('gateEmail');  if (ge) ge.value = '';
  const ub = $('unlockBtn');  if (ub) { ub.disabled = false; ub.textContent = 'Reveal Full Report'; }

  // Returning users skip the gate automatically
  if (hasGivenEmail()) {
    $('emailGate')?.classList.add('hidden');
    revealLockedUI();
    renderFlags();
  } else {
    $('emailGate')?.classList.remove('hidden');
    $('flagsCard') ?.classList.add('hidden');
  }

  $('resultSection')?.classList.remove('hidden');
  window.scrollTo({ top: ($('resultSection')?.offsetTop || 300) - 80, behavior: 'smooth' });
  scheduleProPopup(); // trigger popup 5 sec after results appear
}

// ── REVEAL LOCKED UI (score + stats) ─────────────
function revealLockedUI() {
  // Reveal score ring
  const ring = $('scoreRing'), num = $('ringNum');
  if (ring && num) {
    num.textContent = _realScore + '%';
    ring.className  = 'score-ring ' + _realRingClass;
  }

  // Reveal stats
  const channelTrustEl = $('channelTrust');
  const dislikeRatioEl = $('dislikeRatio');
  const engagementEl   = $('engagement');

  if (channelTrustEl) {
    channelTrustEl.textContent = _realTrust + '/100';
    channelTrustEl.classList.remove('stat-locked');
  }
  if (dislikeRatioEl) {
    dislikeRatioEl.textContent = _realDislikePct + '%';
    dislikeRatioEl.style.color = _realDislikeColor;
    dislikeRatioEl.classList.remove('stat-locked');
  }
  if (engagementEl) {
    engagementEl.textContent = _realEngagement + '%';
    engagementEl.classList.remove('stat-locked');
  }
}

// ── RENDER FLAGS ──────────────────────────────────
function renderFlags() {
  const fc = $('flagsCard'), ul = $('flagsList');
  if (!fc || !ul) return;
  ul.innerHTML = '';
  _flags.forEach(f => {
    const li = document.createElement('li');
    li.className = 'flag-item';
    li.innerHTML = `<div class="flag-dot ${f.cls}"></div>
      <div>
        <div class="flag-text">${f.text}</div>
        ${f.impact ? `<div style="font-size:.78rem;color:var(--muted);margin-top:.2rem;">${f.impact}</div>` : ''}
      </div>`;
    ul.appendChild(li);
  });
  fc.classList.remove('hidden');
}

// ── EMAIL GATE UNLOCK ─────────────────────────────
async function unlockReport() {
  const emailEl  = $('gateEmail');
  const statusEl = $('gateStatus');
  const btn      = $('unlockBtn');
  const email    = emailEl?.value.trim() || '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (statusEl) { statusEl.textContent = '⚠️ Please enter a valid email address.'; statusEl.style.color = '#fca5a5'; }
    emailEl?.focus();
    return;
  }

  if (btn)      { btn.disabled = true; btn.textContent = 'Unlocking…'; }
  if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)'; }

  // Save to Google Sheets
  saveToSheets({
    type:       'unlock',
    email:      email,
    videoTitle: _title         || '',
    score:      _score != null ? String(_score) : '',
    timestamp:  new Date().toISOString()
  });

  // Remember so they never see this gate again
  rememberEmail(email);

  // Reveal everything
  $('emailGate')?.classList.add('hidden');
  revealLockedUI();
  renderFlags();

  if (btn) { btn.disabled = false; btn.textContent = 'Reveal Full Report'; }

  setTimeout(() => {
    const fc = $('flagsCard');
    if (fc) window.scrollTo({ top: fc.offsetTop - 80, behavior: 'smooth' });
  }, 100);
}
window.unlockReport = unlockReport;

// ── ACTION BUTTONS ────────────────────────────────
function doShare() {
  if (_score === null) { showErr('Analyze a video first — then you can share it!'); return; }
  const risk = _score >= 75 ? '✅ Looks Legit' : _score >= 45 ? '⚠️ Suspicious' : '🚨 HIGH RISK';
  const text = `"${_title}" scored ${_score}% on TruthScore — ${risk}\n\nCheck any YouTube video free:\nhttps://truthscore.online`;
  window.open('https://x.com/intent/tweet?text=' + encodeURIComponent(text), '_blank', 'noopener,width=560,height=420');
}

function doCopy() {
  if (!_report) { showErr('Analyze a video first — then you can copy the report!'); return; }
  const btn  = $('copyBtn');
  const orig = btn?.textContent || '📋 Copy Report';
  const ok   = () => { if (btn) { btn.textContent = '✅ Copied!'; setTimeout(() => btn.textContent = orig, 2500); } };
  if (navigator.clipboard) {
    navigator.clipboard.writeText(_report).then(ok).catch(() => fbCopy(ok));
  } else { fbCopy(ok); }
}
function fbCopy(cb) {
  const ta = document.createElement('textarea');
  ta.value = _report; ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand('copy'); cb(); } catch(e) {}
  document.body.removeChild(ta);
}

function doReset() {
  _score = null; _title = ''; _report = ''; _flags = [];
  $('resultSection')?.classList.add('hidden');
  $('emailGate')    ?.classList.remove('hidden');
  $('flagsCard')    ?.classList.add('hidden');
  const v = $('videoInput'); if (v) { v.value = ''; v.focus(); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── PRO MODAL ─────────────────────────────────────
function openProModal() {
  const modal = $('proModal'); if (!modal) return;
  modal.classList.add('open');
  const mf = $('modalForm'), ms = $('modalSuccess');
  if (mf) mf.style.display = '';
  if (ms) ms.style.display = 'none';
  const ps = $('proStatus');
  if (ps) { ps.textContent = 'No spam. We only email you when we launch.'; ps.style.color = 'var(--muted)'; }
  const sb = $('proSubmitBtn');
  if (sb) { sb.disabled = false; sb.textContent = 'Secure My Spot — Free'; }
  setTimeout(() => $('proEmail')?.focus(), 100);
}
function closeProModal() { $('proModal')?.classList.remove('open'); }

async function submitProWaitlist() {
  const name  = $('proName') ?.value.trim() || '';
  const email = $('proEmail')?.value.trim() || '';
  const st    = $('proStatus');
  const sb    = $('proSubmitBtn');

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (st) { st.textContent = '⚠️ Please enter a valid email address.'; st.style.color = '#fca5a5'; }
    $('proEmail')?.focus();
    return;
  }
  if (sb) { sb.disabled = true; sb.textContent = 'Saving…'; }
  if (st) { st.textContent = 'Saving…'; st.style.color = 'var(--muted)'; }

  saveToSheets({ type: 'pro_waitlist', name, email, timestamp: new Date().toISOString() });

  const mf = $('modalForm'), ms = $('modalSuccess');
  if (mf) mf.style.display = 'none';
  if (ms) ms.style.display = 'block';
  if (sb) { sb.disabled = false; sb.textContent = 'Secure My Spot — Free'; }
}

// Expose all globals needed by HTML onclick attributes
window.openProModal      = openProModal;
window.closeProModal     = closeProModal;
window.submitProWaitlist = submitProWaitlist;
window.unlockReport      = unlockReport;

// ── PRO UPGRADE POPUP ─────────────────────────────
// Appears 5 seconds after results load
// Never shows again within 24 hours
// Never shows if user is already Pro

const POPUP_KEY        = 'ts_popup_dismissed'; // localStorage key
const POPUP_COOLDOWN   = 24 * 60 * 60 * 1000; // 24 hours in ms
const PRO_KEY          = 'ts_is_pro';          // set this when user pays

function shouldShowProPopup() {
  // Never show to Pro members
  try { if (localStorage.getItem(PRO_KEY)) return false; } catch(e) {}
  // Check cooldown — don't show if dismissed within 24 hours
  try {
    const dismissed = localStorage.getItem(POPUP_KEY);
    if (dismissed && Date.now() - parseInt(dismissed) < POPUP_COOLDOWN) return false;
  } catch(e) {}
  return true;
}

function showProPopup() {
  if (!shouldShowProPopup()) return;
  const popup = $('proPopup');
  if (!popup) return;
  popup.style.display = 'flex';
}

function closeProPopup() {
  const popup = $('proPopup');
  if (popup) popup.style.display = 'none';
  // Record dismissal time so it won't show again for 24 hours
  try { localStorage.setItem(POPUP_KEY, String(Date.now())); } catch(e) {}
}
window.closeProPopup = closeProPopup;

// Call this after results render — hooked into renderResults below
function scheduleProPopup() {
  if (!shouldShowProPopup()) return;
  setTimeout(showProPopup, 5000); // 5 seconds after results appear
}
window.scheduleProPopup = scheduleProPopup;
