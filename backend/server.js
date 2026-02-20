// server.js — TruthScore Backend
require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const cors    = require('cors');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

const PORT   = process.env.PORT || 3000;
const YT_KEY = process.env.YOUTUBE_API_KEY;
if (!YT_KEY) {
  console.warn('WARNING: YOUTUBE_API_KEY not set. Add it to Render environment variables.');
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

// ── Analysis engine ───────────────────────────────────────────────────
function analyzeVideoData(data) {
  const flags = [];
  let score = 50;
  const titleLower = (data.title       || '').toLowerCase();
  const descLower  = (data.description || '').toLowerCase();

  // 1 — Title / Description scan
  const scamKeywords  = ['passive income','no work','autopilot','guaranteed','secret method','get rich','easy money','make money fast','overnight success','zero effort','no effort'];
  const urgencyWords  = ['limited time','act now','hurry','don\'t miss','last chance','expires soon','only today'];
  const moneyPatterns = [/\$[\d,]+\s*(per|\/)\s*(day|hour|week)/i, /\$?(\d+)k\s*(per|in|\/)/i, /\$[\d,]{5,}/];

  const hasScamKeywords = scamKeywords.some(kw => titleLower.includes(kw) || descLower.includes(kw));
  const hasUrgency      = urgencyWords.some(kw  => titleLower.includes(kw) || descLower.includes(kw));
  const hasMoneyClaim   = moneyPatterns.some(p  => p.test(data.title) || p.test(data.description));
  const hasTimeClaim    = /(\d+\s*(hour|day|minute|week)s?|overnight|instantly|immediately)/i.test(data.title);

  if (hasScamKeywords && hasMoneyClaim && hasTimeClaim) {
    score -= 35;
    flags.push({ type: 'red',    text: 'Unrealistic income + fast-result claims detected',   impact: 'Classic scam pattern' });
  } else if (hasScamKeywords && hasMoneyClaim) {
    score -= 25;
    flags.push({ type: 'red',    text: 'High-risk income claims combined with scam keywords', impact: 'High chance of misleading content' });
  } else if (hasScamKeywords) {
    score -= 15;
    flags.push({ type: 'yellow', text: 'Title contains known scam phrases',                   impact: 'Verify carefully before trusting' });
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

  // 2 — Engagement & dislike analysis
  const totalVotes       = data.likeCount + data.dislikeCount;
  const engagementRatio  = totalVotes / Math.max(data.viewCount, 1);
  const commentRatio     = data.commentCount / Math.max(data.viewCount, 1);
  const likeDislikeRatio = totalVotes > 0 ? data.dislikeCount / totalVotes : 0;

  if (data.viewCount > 100000 && engagementRatio < 0.003) {
    score -= 20;
    flags.push({ type: 'red',    text: `Very low engagement for view count (${(engagementRatio * 100).toFixed(3)}%)`, impact: 'Possible purchased views or bot traffic' });
  } else if (engagementRatio < 0.01) {
    score -= 10;
    flags.push({ type: 'yellow', text: 'Below-average engagement ratio', impact: 'Audience may not find real value' });
  } else if (engagementRatio > 0.03) {
    score += 15;
    flags.push({ type: 'green',  text: 'Healthy engagement ratio',       impact: 'Indicates genuine audience interest' });
  }

  if (data.dislikeCount > 0) {
    if (likeDislikeRatio > 0.3) {
      score -= 20;
      flags.push({ type: 'red',    text: `High hidden dislike ratio: ${(likeDislikeRatio * 100).toFixed(1)}% of votes are dislikes`, impact: 'Strong sign of poor or misleading content' });
    } else if (likeDislikeRatio > 0.15) {
      score -= 10;
      flags.push({ type: 'yellow', text: `Elevated dislike ratio: ${(likeDislikeRatio * 100).toFixed(1)}% of votes are dislikes`,    impact: 'Viewers are expressing dissatisfaction' });
    } else {
      flags.push({ type: 'green',  text: `Low dislike ratio: ${(likeDislikeRatio * 100).toFixed(1)}% — viewers generally satisfied`, impact: 'Positive signal' });
    }
  }

  if (data.commentCount === 0 && data.viewCount > 10000) {
    score -= 15;
    flags.push({ type: 'red', text: 'Comments disabled on a popular video', impact: 'Often used to hide negative viewer feedback' });
  }

  // 3 — Comment sentiment
  const negativeWords = ['scam','fake','lie','lying','liar','didn\'t work','lost money','waste','clickbait','bullshit','refund','disappointed','misleading','fraud','ripoff','don\'t buy','not worth'];
  const positiveWords = ['works','worked','helpful','thank','thanks','great','awesome','legit','legitimate','real','honest','recommend','valuable','learned','success'];

  let neg = 0, pos = 0, scamMentions = 0;
  (data.comments || []).forEach(c => {
    const lc = c.toLowerCase();
    negativeWords.forEach(w => { if (lc.includes(w)) neg++; });
    positiveWords.forEach(w => { if (lc.includes(w)) pos++; });
    if (lc.includes('scam') || lc.includes('fake') || lc.includes('fraud')) scamMentions++;
  });

  if (neg > pos * 1.5 && neg > 3) {
    score -= 20;
    flags.push({ type: 'red',    text: 'Comment section dominated by negative / scam warnings', impact: 'Viewer complaints clearly present' });
  } else if (neg > pos) {
    score -= 8;
    flags.push({ type: 'yellow', text: 'Some negative comments found',  impact: 'Worth reading the comment section' });
  } else if (pos > neg) {
    score += 6;
    flags.push({ type: 'green',  text: 'Comments skew positive',        impact: 'Viewers report finding value' });
  }

  if (scamMentions > 1) {
    score -= 20;
    flags.push({ type: 'red', text: `${scamMentions} comments explicitly call this a scam or fake`, impact: 'Major red flag — do not trust blindly' });
  }

  // 4 — Affiliate / sponsored content
  const affiliateIndicators = ['bit.ly','bitly','tinyurl','clickbank','digistore','affiliat','join now','enroll now','course','coaching','mentorship','dm me','link in bio','join my course','limited spots','use code','discount link','free training'];
  const sponsorIndicators   = ['sponsored','paid promotion','partnered with','thanks to our sponsor','brand deal'];

  if (affiliateIndicators.some(k => descLower.includes(k))) {
    score -= 18;
    flags.push({ type: 'red',  text: 'Affiliate links or course pitch detected in description', impact: 'Monetisation-heavy funnel — creator profits from your click' });
  }
  if (sponsorIndicators.some(k => titleLower.includes(k) || descLower.includes(k))) {
    score -= 5;
    flags.push({ type: 'blue', text: 'Sponsored / paid promotion content',                      impact: 'Content may be biased toward a sponsor\'s product' });
  }

  // 5 — Channel trust score
  let channelTrustScore = 50;
  if (data.channel) {
    const years        = (Date.now() - new Date(data.channel.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 365);
    const sub          = data.channel.subscriberCount || 0;
    const videoCount   = data.channel.videoCount      || 0;
    const videosPerYear = videoCount / Math.max(years, 0.1);

    if (years > 5)         channelTrustScore += 20;
    else if (years > 2)    channelTrustScore += 10;
    else if (years < 0.5)  channelTrustScore -= 15;

    if (sub > 100000)      channelTrustScore += 20;
    else if (sub > 10000)  channelTrustScore += 10;
    else if (sub < 1000)   channelTrustScore -= 10;

    if (videosPerYear > 50)              channelTrustScore += 10;
    else if (videosPerYear < 5 && years > 1) channelTrustScore -= 5;

    channelTrustScore = Math.max(0, Math.min(100, channelTrustScore));

    if (years < 0.5 && sub < 1000 && data.viewCount > 10000) {
      score -= 15;
      flags.push({ type: 'red', text: 'Brand-new or tiny channel with a sudden viral video', impact: 'Common tactic for affiliate funnel scams' });
    }
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
    const channelAgeYears = data.channel?.createdAt
      ? Math.floor((Date.now() - new Date(data.channel.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 365))
      : null;

    return res.json({
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
