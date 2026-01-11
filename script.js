// script.js

// ===============================
// CONFIG
// ===============================
const BACKEND_URL = "https://truthscore.onrender.com";
const DEMO_VIDEO_ID = 'dQw4w9WgXcQ';


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
// LOADING OVERLAY
// ===============================
function createLoadingOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.innerHTML = `
        <style>
            #loadingOverlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.9);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 99999;
                animation: fadeIn 0.3s;
            }
            
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            
            #loadingBox {
                background: white;
                padding: 2.5rem;
                border-radius: 16px;
                max-width: 520px;
                width: 90%;
                text-align: center;
                box-shadow: 0 25px 80px rgba(0,0,0,0.5);
            }
            
            #loadingIcon {
                font-size: 3.5rem;
                margin-bottom: 1rem;
                animation: pulse 2s infinite;
            }
            
            @keyframes pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.1); }
            }
            
            #loadingTitle {
                font-size: 1.5rem;
                font-weight: 700;
                margin-bottom: 0.5rem;
                color: #1f2937;
            }
            
            #loadingMessage {
                color: #6b7280;
                font-size: 1rem;
                margin-bottom: 1.5rem;
            }
            
            #progressBarContainer {
                width: 100%;
                height: 10px;
                background: #e5e7eb;
                border-radius: 5px;
                overflow: hidden;
                margin-bottom: 1.5rem;
            }
            
            #progressBar {
                width: 0%;
                height: 100%;
                background: linear-gradient(90deg, #3b82f6, #8b5cf6);
                transition: width 0.5s ease;
            }
            
            #upgradeBox {
                background: #fef3c7;
                padding: 1.25rem;
                border-radius: 10px;
                border-left: 5px solid #f59e0b;
                text-align: left;
                margin-bottom: 1.25rem;
            }
            
            #upgradeBox p {
                margin: 0;
                color: #92400e;
                font-size: 0.95rem;
                line-height: 1.5;
            }
            
            #upgradeBox strong {
                color: #78350f;
            }
            
            #supportBtn {
                display: inline-block;
                background: linear-gradient(135deg, #3b82f6, #8b5cf6);
                color: white;
                padding: 0.85rem 1.75rem;
                border-radius: 8px;
                text-decoration: none;
                font-weight: 700;
                font-size: 1rem;
                transition: all 0.2s;
                cursor: pointer;
                border: none;
            }
            
            #supportBtn:hover {
                transform: scale(1.05);
                box-shadow: 0 5px 20px rgba(59, 130, 246, 0.4);
            }
            
            #supportNote {
                color: #9ca3af;
                font-size: 0.85rem;
                margin-top: 0.75rem;
            }
        </style>
        
        <div id="loadingBox">
            <div id="loadingIcon">⏳</div>
            <h3 id="loadingTitle">Waking up the AI analysis engine...</h3>
            <p id="loadingMessage">Starting analysis...</p>
            
            <div id="progressBarContainer">
                <div id="progressBar"></div>
            </div>
            
            <div id="upgradeBox">
                <p><strong>⚡ Free Plan:</strong> Analysis takes ~45 seconds</p>
                <p style="margin-top: 0.5rem; font-size: 0.9rem;">This happens because our free server needs to wake up from sleep mode.</p>
            </div>
            
            <button id="supportBtn" onclick="window.scrollTo({top: document.body.scrollHeight, behavior: 'smooth'}); document.getElementById('loadingOverlay').remove();">
                ☕ Support TruthScore & Keep Servers Awake
            </button>
            <p id="supportNote">Just $7/month keeps the server running 24/7 for everyone</p>
        </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Progress animation
    const stages = [
        { time: 0, msg: "Waking up server...", progress: 10 },
        { time: 8000, msg: "Server online, connecting...", progress: 30 },
        { time: 15000, msg: "Fetching video data...", progress: 50 },
        { time: 25000, msg: "Analyzing comments...", progress: 70 },
        { time: 35000, msg: "Calculating scam score...", progress: 85 },
        { time: 42000, msg: "Almost done...", progress: 95 }
    ];
    
    stages.forEach(stage => {
        setTimeout(() => {
            const msgEl = document.getElementById('loadingMessage');
            const bar = document.getElementById('progressBar');
            if (msgEl && bar) {
                msgEl.textContent = stage.msg;
                bar.style.width = stage.progress + '%';
            }
        }, stage.time);
    });
}

function removeLoadingOverlay() {
    const bar = document.getElementById('progressBar');
    if (bar) bar.style.width = '100%';
    
    setTimeout(() => {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) overlay.remove();
    }, 400);
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
    
    resultSection.classList.add('hidden');
    
    // Show loading overlay
    createLoadingOverlay();
    
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
        
        removeLoadingOverlay();
        renderResults(data);

    } catch (error) {
        removeLoadingOverlay();
        showInputError(error.message || "Failed to analyze the video. Check backend URL or server status.");
    } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = "Analyze";
    }
}


// ===============================
// RENDER RESULTS
// ===============================
function renderResults(payload) {
    resultSection.classList.remove("hidden");
    const { video, analysis } = payload;
    const score = Math.round(analysis.score);

    videoTitle.textContent = video.title;
    channelInfo.textContent = `${video.channelTitle} • ${video.channelAgeYears || 0} years old`;
    
    const totalVotes = video.likeCount + (video.dislikeCount || 0);
    const votesText = video.dislikeCount !== undefined 
        ? `${video.likeCount.toLocaleString()} likes • ${video.dislikeCount.toLocaleString()} dislikes`
        : `${video.likeCount.toLocaleString()} likes`;

    metaInfo.innerHTML =
        `${video.viewCount.toLocaleString()} views • ${votesText} • ` +
        `${video.commentCount.toLocaleString()} comments`;

    scoreDisplay.textContent = `${score}%`;
    scoreDisplay.className = 'score-badge';
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

    flagsList.innerHTML = "";
    analysis.flags.sort((a, b) => {
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

    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}
