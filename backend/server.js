// server.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors({
  origin: '*' // in production, lock this to your frontend domain
}));

const PORT = process.env.PORT || 3000;
const YT_KEY = process.env.YOUTUBE_API_KEY;
if(!YT_KEY) {
  console.warn('WARNING: WARNING: YOUTUBE_API_KEY not defined. Set in .env before starting.');
}

function extractVideoId(urlOrId) {
  if(!urlOrId) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/i,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  for(const p of patterns) {
    const m = urlOrId.match(p);
    if(m) return m[1];
  }
  // try URL parsing for v param
  try {
    const u = new URL(urlOrId.includes('://') ? urlOrId : `https://youtube.com/watch?v=${urlOrId}`);
    return u.searchParams.get('v') || null;
  } catch(e){
    return null;
  }
}

// Fetch Dislike Count from ReturnYouTubeDislike API
async function fetchDislikeData(videoId) {
    try {
        const url = `https://returnyoutubedislikeapi.com/votes?videoId=${videoId}`;
        const res = await axios.get(url);
        return {
            dislikes: parseInt(res.data.dislikes) || 0,
            likes: parseInt(res.data.likes) || 0,
        };
    } catch(e) {
        return { dislikes: 0, likes: 0 };
    }
}

// Fetch video details + comments (first 100) + channel stats
async function fetchYouTubeData(videoId) {
  const base = 'https://www.googleapis.com/youtube/v3';
  
  // Video details
  const videoUrl = `${base}/videos?part=snippet,statistics,contentDetails&id=${videoId}&key=${YT_KEY}`;
  const videoRes = await axios.get(videoUrl);
  if(!videoRes.data.items || videoRes.data.items.length === 0) {
    const e = new Error('Video not found');
    e.status = 404;
    throw e;
  }
  const v = videoRes.data.items[0];

  // Dislike Data 
  const dislikeData = await fetchDislikeData(videoId);
  
  // Comments (top-level only, up to 100)
  let comments = [];
  try {
    const comUrl = `${base}/commentThreads?part=snippet&videoId=${videoId}&maxResults=100&key=${YT_KEY}`;
    const comRes = await axios.get(comUrl);
    comments = (comRes.data.items || []).map(c => c.snippet.topLevelComment.snippet.textDisplay);
  } catch (e) {
    comments = [];
  }
  
  // Channel
  const channelId = v.snippet.channelId;
  let channel = null;
  try {
    const chUrl = `${base}/channels?part=snippet,statistics&id=${channelId}&key=${YT_KEY}`;
    const chRes = await axios.get(chUrl);
    if(chRes.data.items && chRes.data.items.length > 0) {
      const ch = chRes.data.items[0];
      channel = {
        subscriberCount: parseInt(ch.statistics.subscriberCount || 0),
        videoCount: parseInt(ch.statistics.videoCount || 0),
        viewCount: parseInt(ch.statistics.viewCount || 0),
        createdAt: ch.snippet.publishedAt
      };
    }
  } catch(e){
    channel = null;
  }

  return {
    videoId,
    title: v.snippet.title,
    description: v.snippet.description,
    viewCount: parseInt(v.statistics.viewCount || 0),
    likeCount: dislikeData.likes || parseInt(v.statistics.likeCount || 0),
    dislikeCount: dislikeData.dislikes, // Added to main object
    commentCount: parseInt(v.statistics.commentCount || 0),
    channelTitle: v.snippet.channelTitle,
    channelId,
    publishedAt: v.snippet.publishedAt,
    thumbnailUrl: (v.snippet.thumbnails && v.snippet.thumbnails.high && v.snippet.thumbnails.high.url) || null,
    comments,
    duration: v.contentDetails && v.contentDetails.duration,
    channel
  };
}

// Analysis logic (moved server-side for safety)
function analyzeVideoData(data) {
  const flags = [];
  let score = 50;
  const titleLower = (data.title || '').toLowerCase();
  const descLower = (data.description || '').toLowerCase();

  // 1. Title/description keywords (Scam, Urgency, Hype)
  const scamKeywords = ['passive income','no work','autopilot','guaranteed','secret method','get rich','easy money','make money fast','overnight success','zero effort','no effort'];
  const urgencyWords = ['limited time','act now','hurry','don\'t miss','last chance','expires soon','only today'];
  const hasScamKeywords = scamKeywords.some(kw => titleLower.includes(kw) || descLower.includes(kw));
  const hasUrgency = urgencyWords.some(kw => titleLower.includes(kw) || descLower.includes(kw));

  // money & time claims
  const moneyPatterns = [
    /\$[\d,]+\s*(per|\/)\s*(day|hour|week)/i,
    /\$?(\d+)k\s*(per|in|\/)/i,
    /\$[\d,]{5,}/
  ];
  const hasMoneyClaim = moneyPatterns.some(p => p.test(data.title) || p.test(data.description));
  const hasTimeClaim = /(\d+\s*(hour|day|minute|week)s?|overnight|instantly|immediately)/i.test(data.title);

  if(hasScamKeywords && hasMoneyClaim && hasTimeClaim) {
    score -= 35;
    flags.push({ type:'red', text:'Unrealistic income + fast-result claims detected', impact:'Common pattern for scams' });
  } else if(hasScamKeywords && hasMoneyClaim) {
    score -= 25;
    flags.push({ type:'red', text:'High-risk income claims with scam keywords', impact:'High chance of misleading content' });
  } else if(hasScamKeywords) {
    score -= 15;
    flags.push({ type:'yellow', text:'Title contains known scam phrases', impact:'Verify carefully' });
  } else {
    score += 12;
    flags.push({ type:'green', text:'Title looks reasonable', impact:'No blatant scam phrases found' });
  }

  if(hasUrgency) {
    score -= 10;
    flags.push({ type:'yellow', text:'Urgency or FOMO language detected', impact:'Often used in funnels' });
  }

  // emoji check
  const emojiCount = (data.title.match(/[💰🤑💸💵💴💶💷🔥⚡✨🚀💎]/g) || []).length;
  if(emojiCount > 3) {
    score -= 6;
    flags.push({ type:'yellow', text:`Multiple hype emojis in title (${emojiCount})`, impact:'Clickbait indicator' });
  }

  // 2. Engagement Analysis (INCLUDING DISLIKES)
  const totalVotes = data.likeCount + data.dislikeCount;
  const engagementRatio = totalVotes / Math.max(data.viewCount, 1);
  const commentRatio = data.commentCount / Math.max(data.viewCount, 1);
  const likeDislikeRatio = totalVotes > 0 
    ? data.dislikeCount / totalVotes
    : 0; // The ratio of dislikes to total votes

  if(data.viewCount > 100000 && engagementRatio < 0.003) {
    score -= 20;
    flags.push({ type:'red', text:`Very low engagement for high view count (${(engagementRatio*100).toFixed(3)}% interactions)`, impact:'Possible purchased views or bots' });
  } else if(engagementRatio < 0.01) {
    score -= 10;
    flags.push({ type:'yellow', text:'Below-average engagement ratio', impact:'Audience may not find value' });
  } else if(engagementRatio > 0.03) {
    score += 15;
    flags.push({ type:'green', text:'Healthy engagement ratio', impact:'Indicates genuine audience' });
  }

  // Dislike Ratio Check (NEW LOGIC)
  if (data.dislikeCount > 0) {
      if (likeDislikeRatio > 0.3) { // Over 30% of votes are dislikes
          score -= 20;
          flags.push({ type:'red', text:`High Dislike Ratio (${(likeDislikeRatio*100).toFixed(1)}%)`, impact:'Strong sign of controversial or poor quality content' });
      } else if (likeDislikeRatio > 0.15) { // Over 15% of votes are dislikes
          score -= 10;
          flags.push({ type:'yellow', text:`Noticeable Dislike Ratio (${(likeDislikeRatio*100).toFixed(1)}%)`, impact:'Viewers are expressing dissatisfaction' });
      }
  }


  if(data.commentCount === 0 && data.viewCount > 10000) {
    score -= 15;
    flags.push({ type:'red', text:'Comments disabled on a popular video', impact:'Often used to hide negative feedback' });
  }

  // 3. Comment Sentiment
  const negativeWords = ['scam','fake','lie','lying','liar','didn\'t work','lost money','waste','clickbait','bs','bullshit','refund','disappointed','misleading','fraud','ripoff','don\'t buy','not worth'];
  const positiveWords = ['works','worked','helpful','thank','thanks','great','awesome','legit','legitimate','real','honest','recommend','valuable','learned','success'];

  let neg=0, pos=0, scamMentions=0;
  (data.comments || []).forEach(c => {
    const lc = c.toLowerCase();
    negativeWords.forEach(w => { if(lc.includes(w)) neg++; });
    positiveWords.forEach(w => { if(lc.includes(w)) pos++; });
    if(lc.includes('scam') || lc.includes('fake') || lc.includes('fraud')) scamMentions++;
  });

  if(neg > pos*1.5 && neg > 3) {
    score -= 20;
    flags.push({ type:'red', text:'Multiple negative comments mentioning scam/fake', impact:'Viewer complaints present' });
  } else if(neg > pos) {
    score -= 8;
    flags.push({ type:'yellow', text:'Some negative comments found', impact:'Check comment examples' });
  } else if(pos > neg) {
    score += 6;
    flags.push({ type:'green', text:'Comments skew positive', impact:'Audience reports value' });
  }

  if(scamMentions > 1) {
    score -= 20;
    flags.push({ type:'red', text:`${scamMentions} comments explicitly mention "scam" or "fake"`, impact:'Strong red flag' });
  }

  // 4. Affiliate / Sponsored Content Detection (ENHANCED)
  // Affiliate Link Detection
  const affiliateIndicators = ['bit.ly','bitly','tinyurl','clickbank','digistore','affiliat','join now','enroll now','course','coaching','mentorship','dm me on instagram','link in bio','join my course','limited spots','use code','discount link','free training'];
  const hasAffiliate = affiliateIndicators.some(k => descLower.includes(k));
  if(hasAffiliate) {
    score -= 18;
    flags.push({ type:'red', text:'Affiliate links / course pitch detected in description', impact:'Often monetization-heavy funnels' });
  }
  
  // Sponsored Content Detection (NEW LOGIC)
  const sponsorIndicators = ['sponsored','paid promotion','ad','advertisement','partnered with','thanks to our sponsor','brand deal'];
  const hasSponsor = sponsorIndicators.some(k => titleLower.includes(k) || descLower.includes(k));
  if(hasSponsor) {
    score -= 5; 
    flags.push({ type:'blue', text:'Sponsored content detected', impact:'Content may be biased towards the sponsor\'s product' });
  }

  // 5. Channel Trust Score (Formalized)
  let channelTrustScore = 50; // Base score out of 100
  if(data.channel) {
    const createdAt = new Date(data.channel.createdAt);
    const years = (Date.now() - createdAt.getTime()) / (1000*60*60*24*365);
    const sub = data.channel.subscriberCount || 0;
    const videoCount = data.channel.videoCount || 0;
    
    // Channel Age
    if(years > 5) channelTrustScore += 20;
    else if(years > 2) channelTrustScore += 10;
    else if(years < 0.5) channelTrustScore -= 15;

    // Subscriber Count
    if(sub > 100000) channelTrustScore += 20;
    else if(sub > 10000) channelTrustScore += 10;
    else if(sub < 1000) channelTrustScore -= 10;

    // Consistency (Videos per year)
    const videosPerYear = videoCount / Math.max(years, 0.1); // min 0.1 years to avoid division by zero
    if(videosPerYear > 50) channelTrustScore += 10;
    else if(videosPerYear < 5 && years > 1) channelTrustScore -= 5;
    
    channelTrustScore = Math.max(0, Math.min(100, channelTrustScore));
    
    // Strong Penalty for new channel + potential fraud
    if(years < 0.5 && sub < 1000 && data.viewCount > 10000) {
      score -= 15;
      flags.push({ type:'red', text:'Very new or small channel with sudden viral video', impact:'Often used to promote affiliate funnels' });
    }
  } else {
    channelTrustScore = 30; // Default low if channel data is unavailable
  }

  // clamp final score
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    flags,
    engagementRatio,
    commentRatio,
    likeDislikeRatio, 
    channelTrustScore 
  };
}

// API endpoints
// POST /api/analyze  { videoId: 'abcd...' }
app.post('/api/analyze', async (req, res) => {
  try {
    const videoIdRaw = (req.body && (req.body.videoId || req.body.url)) || '';
    const videoId = extractVideoId(videoIdRaw) || videoIdRaw;
    if(!videoId) return res.status(400).json({ message: 'videoId required' });

    const data = await fetchYouTubeData(videoId);
    const analysis = analyzeVideoData(data);
    
    // add convenience fields
    const channelAgeYears = data.channel && data.channel.createdAt ? Math.floor((Date.now() - new Date(data.channel.createdAt)) / (1000*60*60*24*365)) : null;

    return res.json({
      video: {
        videoId: data.videoId,
        title: data.title,
        description: data.description,
        viewCount: data.viewCount,
        likeCount: data.likeCount,
        dislikeCount: data.dislikeCount, // <--- ADDED THIS FIELD
        commentCount: data.commentCount,
        channelTitle: data.channelTitle,
        channelId: data.channelId,
        thumbnailUrl: data.thumbnailUrl,
        comments: data.comments,
        channel: data.channel,
        channelAgeYears
      },
      analysis
    });
  } catch (err) {
    console.error(err && err.message ? err.message : err);
    const status = err.status || 500;
    res.status(status).json({ message: err.message || 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`TruthScore backend running on port ${PORT}`);
});