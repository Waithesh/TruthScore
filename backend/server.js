// server.js — TruthScore Backend
require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const cors    = require('cors');
const { YoutubeTranscript } = require('youtube-transcript');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

const PORT   = process.env.PORT || 3000;
const YT_KEY = process.env.YOUTUBE_API_KEY;
if (!YT_KEY) {
  console.warn('WARNING: YOUTUBE_API_KEY not set. Add it to Render environment variables.');
}

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) {
  console.warn('WARNING: GEMINI_API_KEY not set. Web-grounded and transcript analysis will be skipped.');
}
const GEMINI_MODEL    = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ── Low-level Gemini call via plain REST (no SDK) ─────────────────────
// grounded=true attaches Google Search so Gemini checks the LIVE WEB —
// scam reports, forum threads, reviews — not just what YouTube's own
// API says about itself. That's the actual point of this feature.
async function callGemini(prompt, { grounded = false } = {}) {
  if (!GEMINI_KEY) return null;
  try {
    const body = { contents: [{ parts: [{ text: prompt }] }] };
    if (grounded) body.tools = [{ google_search: {} }];

    const res = await axios.post(`${GEMINI_ENDPOINT}?key=${GEMINI_KEY}`, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000
    });
    const parts = res.data?.candidates?.[0]?.content?.parts || [];
    return parts.map(p => p.text || '').join('').trim() || null;
  } catch (e) {
    console.warn('[gemini] request failed:', e.response?.data?.error?.message || e.message);
    return null;
  }
}

// Pulls a JSON object out of a Gemini reply even if the model wrapped it
// in commentary, citations, or code fences — grounded answers especially
// tend to add explanatory text around the actual result.
function extractJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json|```/g, '');
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); }
  catch (e) { return null; }
}

// ── Health check — lets frontend ping to wake server ─────────────────
app.get('/', (req, res) => res.json({ status: 'ok', service: 'TruthScore' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Helpers ───────────────────────────────────────────────────────────
function extractVideoId(urlOrId) {
  if (!urlOrId) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/i,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  for (const p of patterns) {
    const m = urlOrId.match(p);
    if (m) return m[1];
  }
  try {
    const u = new URL(urlOrId.includes('://') ? urlOrId : `https://youtube.com/watch?v=${urlOrId}`);
    return u.searchParams.get('v') || null;
  } catch(e) { return null; }
}

// ── Fetch hidden dislikes ─────────────────────────────────────────────
async function fetchDislikeData(videoId) {
  try {
    const res = await axios.get(`https://returnyoutubedislikeapi.com/votes?videoId=${videoId}`, { timeout: 8000 });
    return {
      dislikes: parseInt(res.data.dislikes) || 0,
      likes:    parseInt(res.data.likes)    || 0,
    };
  } catch(e) {
    return { dislikes: 0, likes: 0 };
  }
}

// ── Fetch all YouTube data ────────────────────────────────────────────
async function fetchYouTubeData(videoId) {
  const base = 'https://www.googleapis.com/youtube/v3';

  // Video details
  const videoRes = await axios.get(
    `${base}/videos?part=snippet,statistics,contentDetails&id=${videoId}&key=${YT_KEY}`,
    { timeout: 10000 }
  );
  if (!videoRes.data.items || videoRes.data.items.length === 0) {
    const e = new Error('Video not found or is private');
    e.status = 404;
    throw e;
  }
  const v = videoRes.data.items[0];

  // Dislike data (runs in parallel with comments + channel)
  const [dislikeData, commentsResult, channelResult] = await Promise.allSettled([
    fetchDislikeData(videoId),
    axios.get(
      `${base}/commentThreads?part=snippet&videoId=${videoId}&maxResults=100&order=relevance&key=${YT_KEY}`,
      { timeout: 10000 }
    ),
    axios.get(
      `${base}/channels?part=snippet,statistics&id=${v.snippet.channelId}&key=${YT_KEY}`,
      { timeout: 10000 }
    )
  ]);

  const dislikes = dislikeData.status === 'fulfilled' ? dislikeData.value : { dislikes: 0, likes: 0 };

  let comments = [];
  if (commentsResult.status === 'fulfilled') {
    comments = (commentsResult.value.data.items || [])
      .map(c => c.snippet.topLevelComment.snippet.textDisplay);
  }

  let channel = null;
  if (channelResult.status === 'fulfilled') {
    const items = channelResult.value.data.items || [];
    if (items.length > 0) {
      const ch = items[0];
      channel = {
        subscriberCount: parseInt(ch.statistics.subscriberCount || 0),
        videoCount:      parseInt(ch.statistics.videoCount      || 0),
        viewCount:       parseInt(ch.statistics.viewCount       || 0),
        createdAt:       ch.snippet.publishedAt
      };
    }
  }

  return {
    videoId,
    title:        v.snippet.title,
    description:  v.snippet.description || '',
    viewCount:    parseInt(v.statistics.viewCount    || 0),
    likeCount:    dislikes.likes || parseInt(v.statistics.likeCount || 0),
    dislikeCount: dislikes.dislikes,
    commentCount: parseInt(v.statistics.commentCount || 0),
    channelTitle: v.snippet.channelTitle,
    channelId:    v.snippet.channelId,
    publishedAt:  v.snippet.publishedAt,
    thumbnailUrl: v.snippet.thumbnails?.high?.url || null,
    comments,
    duration: v.contentDetails?.duration || null,
    channel
  };
}

// ── Fetch transcript (unofficial — YouTube's caption API requires OAuth
//    from the video owner, so this uses the public timedtext endpoint via
//    youtube-transcript instead). This can fail for videos with no captions,
//    or break if YouTube changes the endpoint — always treat as optional. ──
async function fetchTranscript(videoId) {
  try {
    const chunks = await YoutubeTranscript.fetchTranscript(videoId);
    const text = chunks.map(c => c.text).join(' ');
    console.log(`[transcript] fetched ${chunks.length} caption chunks, ${text.length} chars for ${videoId}`);
    // Cap length — keeps Gemini token usage (and latency) predictable
    return text.slice(0, 12000);
  } catch (e) {
    console.warn(`[transcript] fetch failed for ${videoId}:`, e.message);
    return null; // no captions available, or fetch blocked — that's fine
  }
}

// ── Gemini transcript analysis (bonus signal — only fires when captions
//    happen to be available, which is often NOT the case). Returns null
//    on any failure so it never breaks the overall response. ──
async function analyzeTranscriptWithGemini(transcript, title) {
  if (!GEMINI_KEY) { console.warn('[gemini-transcript] skipped: GEMINI_API_KEY not configured'); return null; }
  if (!transcript) { console.warn('[gemini-transcript] skipped: no transcript available'); return null; }

  const prompt = `You are a fraud-detection assistant. Analyze this YouTube video transcript for manipulative sales tactics.

Title: ${title}

Transcript (may be truncated):
"""${transcript}"""

Return ONLY valid JSON, no markdown fences, no commentary, in this exact shape:
{
  "manipulationScore": <integer 0-100, where 100 = no manipulative language found, 0 = severe>,
  "flags": [
    { "type": "red" | "yellow" | "green", "text": "short finding", "impact": "why it matters" }
  ]
}
Look specifically for: unverifiable income/results claims, fake urgency or scarcity, hidden or buried pitches,
cult-like in-group language, fear-based pressure, and vague "secret method" claims. If none are found, return
a single green flag saying so and a high manipulationScore.`;

  const raw    = await callGemini(prompt, { grounded: false });
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed.manipulationScore !== 'number' || !Array.isArray(parsed.flags)) {
    console.warn('[gemini-transcript] skipped: bad response shape:', raw ? raw.slice(0, 200) : '(no response)');
    return null;
  }
  console.log(`[gemini-transcript] success — manipulationScore=${parsed.manipulationScore}, flags=${parsed.flags.length}`);
  return parsed;
}

// ── Web-grounded reputation check — THE main new signal. Doesn't need a
//    transcript, doesn't depend on YouTube's own numbers at all. Gemini
//    actually searches the live web for scam reports, complaints, fact-
//    checks of the specific claims in the title, forum/Reddit discussion,
//    etc. This is what catches a channel that looks clean by every YouTube
//    metric but has a documented bad reputation elsewhere on the internet. ──
async function webGroundedCheck(title, channelTitle, description) {
  if (!GEMINI_KEY) { console.warn('[gemini-web] skipped: GEMINI_API_KEY not configured'); return null; }

  const prompt = `You are a fraud-detection researcher with live web search access. Investigate whether this YouTube video or channel has any documented scam reports, disputed claims, or credible criticism anywhere on the web — not just on YouTube itself.

Video title: "${title}"
Channel: "${channelTitle}"
Description (may be truncated): "${(description || '').slice(0, 2000)}"

Search for things like: the channel name plus "scam" or "reviews" or "complaints", fact-checks of any specific
income or results claims in the title, Reddit/forum discussion, news coverage, refund complaints, watchdog sites.

Return ONLY a JSON object, no markdown fences, no extra commentary, in this exact shape:
{
  "webTrustScore": <integer 0-100, 100 = no negative findings anywhere, 0 = well-documented scam>,
  "flags": [
    { "type": "red" | "yellow" | "green" | "blue", "text": "short finding", "source": "domain or 'no results found'" }
  ]
}
If your search turns up nothing notable either way, say so explicitly with one blue flag and a neutral
score around 60-70. Do not invent findings that your search did not actually surface.`;

  const raw    = await callGemini(prompt, { grounded: true });
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed.webTrustScore !== 'number' || !Array.isArray(parsed.flags)) {
    console.warn('[gemini-web] skipped: bad response shape:', raw ? raw.slice(0, 200) : '(no response)');
    return null;
  }
  console.log(`[gemini-web] success — webTrustScore=${parsed.webTrustScore}, flags=${parsed.flags.length}`);
  return parsed;
}

function analyzeVideoData(data) {
  const flags = [];
  let score = 55; // slightly optimistic baseline — most videos are not scams
  const titleLower = (data.title       || '').toLowerCase();
  const descLower  = (data.description || '').toLowerCase();

  // ── 1. Title / Description scan ──────────────────────────────────────

  // Hard scam signals — these are specific enough to only appear in bad content
  const hardScamKeywords = [
    'guaranteed income', 'guaranteed profit', 'get rich quick', 'secret method',
    'make money fast', 'overnight success', 'zero effort', 'no effort required',
    'autopilot income', 'autopilot money', 'instant cash', 'instant profit'
  ];

  // Soft signals — these appear in both legitimate and scam content
  const softScamKeywords = [
    'passive income', 'no work', 'easy money', 'make money online',
    'work from home', 'financial freedom', 'side hustle'
  ];

  const urgencyWords = [
    'limited time', 'act now', 'hurry', "don't miss", 'last chance',
    'expires soon', 'only today', 'ending soon'
  ];

  const moneyPatterns = [
    /\$[\d,]+\s*(per|\/)\s*(day|hour|week)/i,
    /\$?(\d+)k\s*(per|in|\/)\s*(day|week|month)/i,
    /\$[\d,]{5,}/
  ];

  const hasHardScam  = hardScamKeywords.some(kw => titleLower.includes(kw) || descLower.includes(kw));
  const hasSoftScam  = softScamKeywords.some(kw => titleLower.includes(kw));
  const hasUrgency   = urgencyWords.some(kw     => titleLower.includes(kw) || descLower.includes(kw));
  const hasMoneyClaim = moneyPatterns.some(p    => p.test(data.title) || p.test(data.description));
  const hasTimeClaim  = /(\d+\s*(hour|day|minute|week)s?|overnight|instantly|immediately)/i.test(data.title);

  if (hasHardScam && hasMoneyClaim && hasTimeClaim) {
    score -= 35;
    flags.push({ type: 'red',    text: 'Unrealistic income + fast-result claims detected',   impact: 'Classic scam pattern — proceed with extreme caution' });
  } else if (hasHardScam && hasMoneyClaim) {
    score -= 25;
    flags.push({ type: 'red',    text: 'High-risk income claims combined with scam keywords', impact: 'High chance of misleading content' });
  } else if (hasHardScam) {
    score -= 15;
    flags.push({ type: 'yellow', text: 'Title contains known scam phrases',                   impact: 'Verify carefully before trusting' });
  } else if (hasSoftScam && hasMoneyClaim) {
    // soft scam + money claim is a yellow, not red — lots of legit finance channels do this
    score -= 10;
    flags.push({ type: 'yellow', text: 'Income-related claims detected in title',             impact: 'Common in both legitimate and misleading content — check the details' });
  } else {
    score += 12;
    flags.push({ type: 'green',  text: 'Title looks reasonable',                              impact: 'No blatant scam phrases found' });
  }

  if (hasUrgency) {
    score -= 10;
    flags.push({ type: 'yellow', text: 'Urgency / FOMO language detected', impact: 'Common psychological pressure tactic' });
  }

  const emojiCount = (data.title.match(/[💰🤑💸💵💴💶💷🔥⚡✨🚀💎]/g) || []).length;
  if (emojiCount > 3) {
    score -= 6;
    flags.push({ type: 'yellow', text: `${emojiCount} hype emojis in title`, impact: 'Strong clickbait indicator' });
  }

  // ── 2. Engagement & dislike analysis ─────────────────────────────────
  const totalVotes       = data.likeCount + data.dislikeCount;
  const engagementRatio  = totalVotes / Math.max(data.viewCount, 1);
  const commentRatio     = data.commentCount / Math.max(data.viewCount, 1);
  const likeDislikeRatio = totalVotes > 0 ? data.dislikeCount / totalVotes : 0;

  // Adjusted thresholds — fairer for smaller channels
  if (data.viewCount > 50000 && engagementRatio < 0.003) {
    score -= 20;
    flags.push({ type: 'red',    text: `Very low engagement for view count (${(engagementRatio * 100).toFixed(3)}%)`, impact: 'Possible purchased views or bot traffic' });
  } else if (engagementRatio < 0.008) {
    score -= 8;
    flags.push({ type: 'yellow', text: 'Below-average engagement ratio', impact: 'Audience may not be finding real value' });
  } else if (engagementRatio > 0.025) {
    score += 15;
    flags.push({ type: 'green',  text: 'Healthy engagement ratio',       impact: 'Indicates genuine audience interest' });
  }

  if (data.dislikeCount > 0) {
    if (likeDislikeRatio > 0.3) {
      score -= 20;
      flags.push({ type: 'red',    text: `High estimated dislike ratio: ${(likeDislikeRatio * 100).toFixed(1)}% of votes are dislikes`, impact: 'Strong sign of poor or misleading content' });
    } else if (likeDislikeRatio > 0.15) {
      score -= 10;
      flags.push({ type: 'yellow', text: `Elevated estimated dislike ratio: ${(likeDislikeRatio * 100).toFixed(1)}%`, impact: 'Viewers are expressing dissatisfaction' });
    } else {
      flags.push({ type: 'green',  text: `Low dislike ratio: ${(likeDislikeRatio * 100).toFixed(1)}% — viewers generally satisfied`, impact: 'Positive signal' });
    }
  }

  if (data.commentCount === 0 && data.viewCount > 10000) {
    score -= 15;
    flags.push({ type: 'red', text: 'Comments disabled on a popular video', impact: 'Often used to hide negative viewer feedback' });
  }

  // ── 3. Comment sentiment (per-comment scoring, not per-keyword) ───────
  const negativePatterns = [
    'scam', 'fake', 'fraud', 'ripoff', 'rip off', 'misleading', 'liar', 'lying',
    'lost money', 'lost my money', "didn't work", 'does not work', 'doesnt work',
    'waste of time', 'waste of money', 'clickbait', 'not worth', "don't buy",
    'disappointed', 'refund', 'reported', 'false', 'bs ', 'bullshit'
  ];
  const positivePatterns = [
    'works', 'worked', 'it works', 'helpful', 'thank you', 'thanks',
    'great video', 'great content', 'awesome', 'legit', 'legitimate',
    'honest', 'recommend', 'valuable', 'learned', 'success', 'love this',
    'love your', 'amazing', 'best video', 'keep it up', 'well explained'
  ];

  let negComments = 0, posComments = 0, scamMentions = 0;

  (data.comments || []).forEach(c => {
    const lc = c.toLowerCase();
    const hasNeg = negativePatterns.some(w => lc.includes(w));
    const hasPos = positivePatterns.some(w => lc.includes(w));

    // Count each comment once even if multiple keywords match
    if (hasNeg) negComments++;
    if (hasPos && !hasNeg) posComments++; // only count as positive if no negative signal

    if (lc.includes('scam') || lc.includes('fake') || lc.includes('fraud')) scamMentions++;
  });

  const totalSentimentComments = negComments + posComments;

  if (negComments > posComments * 1.5 && negComments > 3) {
    score -= 20;
    flags.push({ type: 'red',    text: 'Comment section dominated by negative / scam warnings', impact: 'Viewer complaints clearly present' });
  } else if (negComments > posComments && negComments > 2) {
    score -= 8;
    flags.push({ type: 'yellow', text: 'Some negative comments found',  impact: 'Worth reading the comment section carefully' });
  } else if (posComments > negComments && totalSentimentComments > 3) {
    score += 6;
    flags.push({ type: 'green',  text: 'Comments skew positive',        impact: 'Viewers report finding value' });
  }

  if (scamMentions > 2) {
    score -= 20;
    flags.push({ type: 'red', text: `${scamMentions} comments explicitly call this a scam or fake`, impact: 'Major red flag — do not trust blindly' });
  } else if (scamMentions === 2) {
    score -= 10;
    flags.push({ type: 'yellow', text: '2 comments question the legitimacy of this video', impact: 'Worth investigating further' });
  }

  // ── 4. Affiliate / sponsored content (smarter detection) ─────────────

  // Strong affiliate signals — these are specific to scammy funnels
  const hardAffiliateIndicators = [
    'bit.ly', 'bitly', 'tinyurl', 'clickbank', 'digistore',
    'join my course', 'limited spots', 'only a few spots',
    'dm me for', 'dm me to', 'link in bio', 'discount link'
  ];

  // Soft affiliate signals — legitimate creators do these too
  const softAffiliateIndicators = [
    'affiliat', 'use code', 'enroll now', 'join now', 'free training',
    'course', 'coaching', 'mentorship'
  ];

  const hasHardAffiliate = hardAffiliateIndicators.some(k => descLower.includes(k));
  const hasSoftAffiliate = softAffiliateIndicators.some(k => descLower.includes(k));

  if (hasHardAffiliate) {
    score -= 18;
    flags.push({ type: 'red',    text: 'High-pressure affiliate funnel detected in description', impact: 'Creator profits heavily from your clicks — verify independently' });
  } else if (hasSoftAffiliate) {
    score -= 6;
    flags.push({ type: 'yellow', text: 'Affiliate links or course pitch detected in description', impact: 'Creator may earn a commission — not necessarily a red flag' });
  }

  const sponsorIndicators = ['sponsored', 'paid promotion', 'partnered with', 'thanks to our sponsor', 'brand deal'];
  if (sponsorIndicators.some(k => titleLower.includes(k) || descLower.includes(k))) {
    score -= 5;
    flags.push({ type: 'blue', text: 'Sponsored / paid promotion content', impact: "Content may be biased toward a sponsor's product" });
  }

  // ── 5. Channel trust score ────────────────────────────────────────────
  let channelTrustScore = 50;
  if (data.channel) {
    const years         = (Date.now() - new Date(data.channel.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 365);
    const sub           = data.channel.subscriberCount || 0;
    const videoCount    = data.channel.videoCount      || 0;
    const videosPerYear = videoCount / Math.max(years, 0.1);

    if (years > 5)        channelTrustScore += 20;
    else if (years > 2)   channelTrustScore += 10;
    else if (years < 0.5) channelTrustScore -= 15;

    if (sub > 100000)     channelTrustScore += 20;
    else if (sub > 10000) channelTrustScore += 10;
    else if (sub < 1000)  channelTrustScore -= 10;

    if (videosPerYear > 50)               channelTrustScore += 10;
    else if (videosPerYear < 5 && years > 1) channelTrustScore -= 5;

    channelTrustScore = Math.max(0, Math.min(100, channelTrustScore));

    // Brand-new channel with sudden viral video — strong scam signal
    if (years < 0.5 && sub < 1000 && data.viewCount > 10000) {
      score -= 15;
      flags.push({ type: 'red', text: 'Brand-new or tiny channel with a sudden viral video', impact: 'Common tactic for affiliate funnel scams' });
    }

    // Let channel trust nudge the main score slightly
    if (channelTrustScore >= 80) score += 5;
    else if (channelTrustScore <= 30) score -= 8;

  } else {
    channelTrustScore = 30;
  }

  score = Math.max(0, Math.min(100, score));

  return { score, flags, engagementRatio, commentRatio, likeDislikeRatio, channelTrustScore };
}

// ── API endpoint ──────────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  try {
    const raw     = (req.body && (req.body.videoId || req.body.url)) || '';
    const videoId = extractVideoId(raw) || raw;
    if (!videoId) return res.status(400).json({ message: 'videoId is required' });

    const data     = await fetchYouTubeData(videoId);
    const analysis = analyzeVideoData(data);

    // Three independent signals, blended with NORMALIZED weights — meaning
    // if a signal doesn't fire (e.g. transcript almost always won't, since
    // most videos have it disabled), the remaining signals fill in the full
    // weight rather than silently underweighting the score toward 0.
    const weighted = [{ score: analysis.score, weight: 0.55 }]; // mechanical (existing) signal

    // Web-grounded check — the main new "internet perspective" signal.
    // Runs on every video regardless of captions; this is the one that
    // matters most for what you're trying to catch.
    const webResult = await webGroundedCheck(data.title, data.channelTitle, data.description);
    if (webResult) {
      analysis.flags = [...analysis.flags, ...webResult.flags];
      analysis.webTrustScore = webResult.webTrustScore;
      weighted.push({ score: webResult.webTrustScore, weight: 0.30 });
    }

    // Transcript analysis — bonus signal, only fires when captions happen
    // to be available. Never blocks or degrades the response if absent.
    const transcript   = await fetchTranscript(videoId);
    const geminiResult = await analyzeTranscriptWithGemini(transcript, data.title);
    if (geminiResult) {
      analysis.flags = [...analysis.flags, ...geminiResult.flags];
      analysis.manipulationScore = geminiResult.manipulationScore;
      weighted.push({ score: geminiResult.manipulationScore, weight: 0.15 });
    }

    const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
    analysis.score = Math.round(weighted.reduce((sum, w) => sum + w.score * w.weight, 0) / totalWeight);
    analysis.score = Math.max(0, Math.min(100, analysis.score));

    const channelAgeYears = data.channel?.createdAt
      ? Math.floor((Date.now() - new Date(data.channel.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 365))
      : null;

    return res.json({
      geminiUsed: analysis.webTrustScore !== undefined || analysis.manipulationScore !== undefined,
      video: {
        videoId:      data.videoId,
        title:        data.title,
        description:  data.description,
        viewCount:    data.viewCount,
        likeCount:    data.likeCount,
        dislikeCount: data.dislikeCount,
        commentCount: data.commentCount,
        channelTitle: data.channelTitle,
        channelId:    data.channelId,
        thumbnailUrl: data.thumbnailUrl,
        channel:      data.channel,
        channelAgeYears
      },
      analysis
    });
  } catch(err) {
    console.error('Analyze error:', err?.message || err);
    res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
  }
});

app.listen(PORT, () => console.log(`TruthScore backend running on port ${PORT}`));
