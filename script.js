// script.js

// ===============================
// CONFIG
// ===============================

// When testing locally, your backend runs on:
//    http://localhost:3000
//
const BACKEND_URL = "https://truthscore.onrender.com";
const DEMO_VIDEO_ID = 'dQw4w9WgXcQ'; // Rick Astley - Change this to a high-risk video for a better demo


// ===============================
// EXTRACT VIDEO ID
// ===============================
function extractVideoId(url) {
    if (!url) return null;

    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/i,
        /^([a-zA-Z0-9_-]{11})$/
    ];

    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }

    // fallback attempt using URL parsing
    try {
        const u = new URL(url.includes("://") ? url : "https://youtube.com/watch?v=" + url);
        return u.searchParams.get("v") || null;
    } catch (e) {
        return null;
    }
}


// ===============================
// DOM ELEMENTS
// ===============================
const input = document.getElementById("videoInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const demoBtn = document.getElementById("demoBtn"); 
const inputError = document.getElementById("inputError");

const resultSection = document.getElementById("resultSection");
const videoTitle = document.getElementById("videoTitle");
const channelInfo = document.getElementById("channelInfo");
const metaInfo = document.getElementById("metaInfo");

const scoreDisplay = document.getElementById('truth-score-display');
const scoreLabel = document.querySelector('.score-label');
const channelTrustDisplay = document.getElementById('channel-trust-display');
const dislikeRatioDisplay = document.getElementById('dislike-ratio-display');
const totalVotesDisplay = document.getElementById('total-votes-display');
const engagementRatioDisplay = document.getElementById('engagement-ratio-display');

const flagsList = document.getElementById("flagsList");

const copyReport = document.getElementById("copyReport");
const analyzeAnother = document.getElementById("analyzeAnother");


// ===============================
// EVENT HANDLERS
// ===============================
analyzeBtn.addEventListener("click", () => runAnalyze());
input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") runAnalyze();
});
demoBtn.addEventListener('click', () => {
    input.value = `https://youtu.be/${DEMO_VIDEO_ID}`;
    runAnalyze(DEMO_VIDEO_ID);
});


// ===============================
// SHOW ERROR
// ===============================
function showInputError(msg) {
    inputError.textContent = msg;
    inputError.classList.remove("hidden");
}


// ===============================
// MAIN ANALYZE FUNCTION
// ===============================
async function runAnalyze(optionalId) {
    inputError.classList.add("hidden");
    const raw = optionalId || input.value.trim();
    
    if (!raw) {
        showInputError("Please paste a YouTube URL or video ID.");
        return;
    }

    const id = extractVideoId(raw) || raw;

    if (!id) {
        showInputError("Could not extract a YouTube video ID. Try a full URL.");
        return;
    }
    
    // Clear previous results
    resultSection.classList.add('hidden');

    // Show loading state
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = "Analyzing...";

    try {
        const response = await fetch(`${BACKEND_URL}/api/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoId: id })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({ message: "Server error" }));
            throw new Error(err.message || "Analysis failed");
        }

        const data = await response.json();
        renderResults(data);

    } catch (error) {
        showInputError(error.message || "Failed to analyze the video. Check backend URL or server status.");
    } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = "Analyze";
    }
}


// ===============================
// RENDER RESULTS (Pure CSS updates)
// ===============================
function renderResults(payload) {
    resultSection.classList.remove("hidden");
    const { video, analysis } = payload;
    const score = Math.round(analysis.score);

    // 1. Populate video info
    videoTitle.textContent = video.title;
    channelInfo.textContent = `${video.channelTitle} • ${video.channelAgeYears || 0} years old`;
    
    const totalVotes = video.likeCount + (video.dislikeCount || 0);
    const votesText = video.dislikeCount !== undefined 
        ? `${video.likeCount.toLocaleString()} likes • ${video.dislikeCount.toLocaleString()} dislikes`
        : `${video.likeCount.toLocaleString()} likes`;

    metaInfo.innerHTML =
        `${video.viewCount.toLocaleString()} views • ${votesText} • ` +
        `${video.commentCount.toLocaleString()} comments`;

    // 2. Main Score (TruthScore)
    scoreDisplay.textContent = `${score}%`;
    scoreDisplay.className = 'score-badge'; // Reset classes
    if (score >= 75) {
        scoreDisplay.classList.add('score-high');
        scoreLabel.textContent = "Likely Legit";
    } else if (score >= 45) {
        scoreDisplay.classList.add('score-medium');
        scoreLabel.textContent = "Be Careful";
    } else {
        scoreDisplay.classList.add('score-low');
        scoreLabel.textContent = "High Risk";
    }

    // 3. New Stat Cards
    channelTrustDisplay.textContent = `${Math.round(analysis.channelTrustScore)}/100`;
    
    const dislikeRatioPercent = (analysis.likeDislikeRatio * 100).toFixed(1);
    dislikeRatioDisplay.textContent = `${dislikeRatioPercent}%`;
    dislikeRatioDisplay.classList.remove('stat-red', 'stat-yellow');
    if (dislikeRatioPercent > 30) {
        dislikeRatioDisplay.classList.add('stat-red');
    } else if (dislikeRatioPercent > 15) {
        dislikeRatioDisplay.classList.add('stat-yellow');
    }

    totalVotesDisplay.textContent = `${totalVotes.toLocaleString()} total votes`;
    engagementRatioDisplay.textContent = `${(analysis.engagementRatio * 100).toFixed(3)}%`;


    // 4. Flags
    flagsList.innerHTML = "";
    analysis.flags.sort((a, b) => {
        // Sort Red > Yellow > Blue > Green
        const order = { 'red': 1, 'yellow': 2, 'blue': 3, 'green': 4 };
        return order[a.type] - order[b.type];
    }).forEach(f => {
        const li = document.createElement("li");
        li.className = "flag-item";
        
        let flagClass = 'flag-green';
        if(f.type === 'red') flagClass = 'flag-red';
        else if(f.type === 'yellow') flagClass = 'flag-yellow';
        else if(f.type === 'blue') flagClass = 'flag-blue'; 

        li.innerHTML = `
            <div class="flag-dot ${flagClass}"></div>
            <div>
                <div class="flag-text">${f.text}</div>
                <div class="flag-impact">${f.impact || ""}</div>
            </div>
        `;
        flagsList.appendChild(li);
    });

    // 5. Buttons
    copyReport.onclick = () => {
        const summary = `
TruthScore Analysis
-----------------------------------
Title: ${video.title}
Channel: ${video.channelTitle}
TruthScore: ${score}% (${scoreLabel.textContent})
Channel Trust: ${Math.round(analysis.channelTrustScore)}/100
Dislike Ratio: ${dislikeRatioPercent}%

Flags:
${analysis.flags.map(f => "- " + f.text).join("\n")}
        `;
        navigator.clipboard.writeText(summary)
            .then(() => alert("Summary copied to clipboard!"));
    };

    analyzeAnother.onclick = () => {
        resultSection.classList.add("hidden");
        input.value = "";
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    // Scroll to results
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });

}
