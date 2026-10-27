/**
 * Metronome Thing Dashboard Application (Lab 2)
 * Connects to REST endpoints on Raspberry Pi:
 *  - GET, PUT: /bpm/
 *  - GET, DELETE: /bpm/min/
 *  - GET, DELETE: /bpm/max/
 */

// State
let currentBpm = 0;
let minBpm = 0;
let maxBpm = 0;
let isConnected = false;
let autoRefreshTimer = null;
let animationFrameId = null;
let lastBeatTime = 0;
let lastSoundPlayTime = 0;
let audioCtx = null;
let isTick = true;

// DOM Elements
const apiUrlInput = document.getElementById("apiUrl");
const btnConnect = document.getElementById("btnConnect");
const statusBadge = document.getElementById("statusBadge");

const displayBpm = document.getElementById("displayBpm");
const displayMin = document.getElementById("displayMin");
const displayMinNote = document.getElementById("displayMinNote");
const displayMax = document.getElementById("displayMax");
const displayMaxNote = document.getElementById("displayMaxNote");

const tempoMarking = document.getElementById("tempoMarking");
const tempoPeriod = document.getElementById("tempoPeriod");
const pendulumArm = document.getElementById("pendulumArm");
const ledPlay = document.getElementById("ledPlay");
const ledLearn = document.getElementById("ledLearn");
const soundToggle = document.getElementById("soundToggle");

const bpmSlider = document.getElementById("bpmSlider");
const bpmInput = document.getElementById("bpmInput");
const btnBpmMinus = document.getElementById("btnBpmMinus");
const btnBpmPlus = document.getElementById("btnBpmPlus");
const btnSetBpm = document.getElementById("btnSetBpm");
const presetChips = document.querySelectorAll(".chip");

const btnRefresh = document.getElementById("btnRefresh");
const autoRefreshToggle = document.getElementById("autoRefreshToggle");
const btnResetMin = document.getElementById("btnResetMin");
const btnResetMax = document.getElementById("btnResetMax");
const btnResetBoth = document.getElementById("btnResetBoth");

const logConsole = document.getElementById("logConsole");
const btnClearLog = document.getElementById("btnClearLog");

// Initialize on Load
window.addEventListener("DOMContentLoaded", () => {
  // Restore saved API URL from localStorage
  const savedUrl = localStorage.getItem("metronome_api_url");
  if (savedUrl) {
    apiUrlInput.value = savedUrl;
  }
  const savedSound = localStorage.getItem("metronome_sound");
  if (savedSound !== null) {
    soundToggle.checked = (savedSound === "true");
  } else {
    soundToggle.checked = true;
  }

  // Setup Event Listeners
  setupEventListeners();

  // Test initial connection and load data
  checkConnection();

  // Start auto-refresh
  startAutoRefresh();

  // Start pendulum animation loop
  requestAnimationFrame(metronomeLoop);
});

// Event Listeners
function setupEventListeners() {
  btnConnect.addEventListener("click", () => {
    saveApiUrl();
    checkConnection();
  });

  apiUrlInput.addEventListener("change", () => {
    saveApiUrl();
  });

  // Slider <-> Number input synchronization
  bpmSlider.addEventListener("input", (e) => {
    bpmInput.value = e.target.value;
  });

  bpmInput.addEventListener("input", (e) => {
    let val = parseInt(e.target.value, 10);
    if (!isNaN(val)) {
      bpmSlider.value = Math.min(Math.max(val, 20), 240);
    }
  });

  btnBpmMinus.addEventListener("click", () => {
    let val = Math.max(0, (parseInt(bpmInput.value, 10) || 0) - 1);
    bpmInput.value = val;
    bpmSlider.value = Math.min(Math.max(val, 20), 240);
  });

  btnBpmPlus.addEventListener("click", () => {
    let val = (parseInt(bpmInput.value, 10) || 0) + 1;
    bpmInput.value = val;
    bpmSlider.value = Math.min(Math.max(val, 20), 240);
  });

  // Preset chips
  presetChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const bpm = parseInt(chip.dataset.bpm, 10);
      bpmInput.value = bpm;
      bpmSlider.value = Math.min(Math.max(bpm, 20), 240);
      setDeviceBpm(bpm);
    });
  });

  // Set BPM button
  btnSetBpm.addEventListener("click", () => {
    const val = parseInt(bpmInput.value, 10);
    if (!isNaN(val)) {
      setDeviceBpm(val);
    } else {
      log("Please enter a valid numeric BPM value.", "error");
    }
  });

  // Refresh
  btnRefresh.addEventListener("click", () => {
    fetchAllMetrics();
  });

  autoRefreshToggle.addEventListener("change", () => {
    if (autoRefreshToggle.checked) {
      startAutoRefresh();
      log("Auto-refresh enabled (2s interval)", "info");
    } else {
      stopAutoRefresh();
      log("Auto-refresh disabled", "info");
    }
  });

  // Resets
  btnResetMin.addEventListener("click", resetMinBpm);
  btnResetMax.addEventListener("click", resetMaxBpm);
  btnResetBoth.addEventListener("click", async () => {
    await resetMinBpm();
    await resetMaxBpm();
  });

  // Clear Log
  btnClearLog.addEventListener("click", () => {
    logConsole.innerHTML = "";
  });

  // Web Audio Context initialization on user toggle
  soundToggle.addEventListener("change", () => {
    localStorage.setItem("metronome_sound", soundToggle.checked);
    if (soundToggle.checked) {
      initAudio();
    }
  });

  // Unlock Web Audio on first user interaction anywhere
  const unlockAudio = () => {
    initAudio();
    if (audioCtx && audioCtx.state === "running") {
      document.removeEventListener("pointerdown", unlockAudio);
      document.removeEventListener("keydown", unlockAudio);
    }
  };
  document.addEventListener("pointerdown", unlockAudio);
  document.addEventListener("keydown", unlockAudio);
}

// Initialize and resume AudioContext safely
function initAudio() {
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
  } catch (e) {
    console.error("AudioContext init error:", e);
  }
}

// URL Helper
function getBaseUrl() {
  let url = apiUrlInput.value.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "http://" + url;
  }
  if (url.endsWith("/")) {
    url = url.slice(0, -1);
  }
  return url;
}

function saveApiUrl() {
  localStorage.setItem("metronome_api_url", getBaseUrl());
}

// Logger
function log(msg, type = "info") {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${time}] ${msg}`;
  logConsole.appendChild(entry);
  logConsole.scrollTop = logConsole.scrollHeight;
}

// Parse BPM value (works whether backend returns raw number or JSON object)
function parseBpmValue(data) {
  if (typeof data === "object" && data !== null && "bpm" in data) {
    return Number(data.bpm);
  }
  return Number(data);
}

// Connection check
async function checkConnection() {
  statusBadge.className = "badge badge-connecting";
  statusBadge.textContent = "Connecting...";

  try {
    const res = await fetch(`${getBaseUrl()}/bpm/`, { method: "GET" });
    if (res.ok) {
      statusBadge.className = "badge badge-online";
      statusBadge.textContent = "Connected";
      isConnected = true;
      log(`Connected to Metronome Thing at ${getBaseUrl()}`, "success");
      await fetchAllMetrics();
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    statusBadge.className = "badge badge-offline";
    statusBadge.textContent = "Offline";
    isConnected = false;
    log(`Connection failed to ${getBaseUrl()}: ${err.message}`, "error");
  }
}

// API: Fetch All Metrics
async function fetchAllMetrics() {
  const base = getBaseUrl();
  try {
    // 1. Current BPM
    const bpmRes = await fetch(`${base}/bpm/`);
    if (bpmRes.ok) {
      const bpmData = await bpmRes.json();
      currentBpm = parseBpmValue(bpmData);
      updateBpmDisplay(currentBpm);
    }

    // 2. Min BPM
    const minRes = await fetch(`${base}/bpm/min/`);
    if (minRes.ok) {
      const minData = await minRes.json();
      minBpm = parseBpmValue(minData);
      updateMinDisplay(minBpm);
    }

    // 3. Max BPM
    const maxRes = await fetch(`${base}/bpm/max/`);
    if (maxRes.ok) {
      const maxData = await maxRes.json();
      maxBpm = parseBpmValue(maxData);
      updateMaxDisplay(maxBpm);
    }

    if (!isConnected) {
      statusBadge.className = "badge badge-online";
      statusBadge.textContent = "Connected";
      isConnected = true;
    }
  } catch (err) {
    if (isConnected) {
      statusBadge.className = "badge badge-offline";
      statusBadge.textContent = "Offline";
      isConnected = false;
      log(`Failed to fetch metrics: ${err.message}`, "error");
    }
  }
}

// API: Set BPM (PUT /bpm/)
async function setDeviceBpm(bpm) {
  const base = getBaseUrl();
  log(`Sending PUT /bpm/ with value ${bpm}...`, "info");

  try {
    const res = await fetch(`${base}/bpm/`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bpm),
    });

    if (res.ok) {
      const data = await res.json();
      currentBpm = parseBpmValue(data);
      updateBpmDisplay(currentBpm);
      log(`PUT /bpm/ Success: Tempo set to ${currentBpm} BPM`, "success");
      // Refresh min and max right after
      await fetchAllMetrics();
    } else {
      log(`PUT /bpm/ Error: HTTP ${res.status}`, "error");
    }
  } catch (err) {
    log(`PUT /bpm/ Network Error: ${err.message}`, "error");
  }
}

// API: Reset Min BPM (DELETE /bpm/min/)
async function resetMinBpm() {
  const base = getBaseUrl();
  log("Sending DELETE /bpm/min/...", "info");

  try {
    const res = await fetch(`${base}/bpm/min/`, { method: "DELETE" });
    if (res.ok) {
      minBpm = 0;
      updateMinDisplay(0);
      log("DELETE /bpm/min/ Success: Min BPM reset to 0 (none)", "success");
    } else {
      log(`DELETE /bpm/min/ Error: HTTP ${res.status}`, "error");
    }
  } catch (err) {
    log(`DELETE /bpm/min/ Network Error: ${err.message}`, "error");
  }
}

// API: Reset Max BPM (DELETE /bpm/max/)
async function resetMaxBpm() {
  const base = getBaseUrl();
  log("Sending DELETE /bpm/max/...", "info");

  try {
    const res = await fetch(`${base}/bpm/max/`, { method: "DELETE" });
    if (res.ok) {
      maxBpm = 0;
      updateMaxDisplay(0);
      log("DELETE /bpm/max/ Success: Max BPM reset to 0 (none)", "success");
    } else {
      log(`DELETE /bpm/max/ Error: HTTP ${res.status}`, "error");
    }
  } catch (err) {
    log(`DELETE /bpm/max/ Network Error: ${err.message}`, "error");
  }
}

// Auto-Refresh
function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => {
    if (autoRefreshToggle.checked) {
      fetchAllMetrics();
    }
  }, 2000);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

// UI Updaters
function updateBpmDisplay(bpm) {
  displayBpm.textContent = bpm;

  if (bpm <= 0) {
    tempoMarking.textContent = "Stopped";
    tempoPeriod.textContent = "Period: — ms";
  } else {
    const periodMs = Math.round(60000 / bpm);
    tempoPeriod.textContent = `Period: ${periodMs} ms`;
    tempoMarking.textContent = getTempoMarking(bpm);
  }
}

function updateMinDisplay(val) {
  displayMin.textContent = val;
  displayMinNote.textContent = val === 0 ? "(none)" : "BPM";
}

function updateMaxDisplay(val) {
  displayMax.textContent = val;
  displayMaxNote.textContent = val === 0 ? "(none)" : "BPM";
}

function getTempoMarking(bpm) {
  if (bpm < 50) return "Grave / Largo";
  if (bpm < 66) return "Largo";
  if (bpm < 76) return "Adagio";
  if (bpm < 108) return "Andante";
  if (bpm < 120) return "Moderato";
  if (bpm < 168) return "Allegro";
  if (bpm < 200) return "Presto";
  return "Prestissimo";
}

// Play Click Sound via Web Audio API (Authentic Mechanical Metronome Tick-Tock)
function playClickSound(customFreq = null) {
  if (!soundToggle.checked) return;

  const nowMs = performance.now();
  // Minimum 120ms debounce between clicks to completely eliminate double-clicks
  if (nowMs - lastSoundPlayTime < 120) {
    return;
  }
  lastSoundPlayTime = nowMs;

  initAudio();
  if (!audioCtx) return;

  try {
    const now = audioCtx.currentTime;

    let startFreq, endFreq;
    if (customFreq) {
      startFreq = customFreq;
      endFreq = Math.max(customFreq * 0.15, 60);
    } else {
      // Alternating authentic mechanical Tick (high) / Tock (low)
      startFreq = isTick ? 1600 : 1050;
      endFreq = isTick ? 120 : 80;
      isTick = !isTick;
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.02);

    gain.gain.setValueAtTime(0.8, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.03);
  } catch (e) {
    console.error("Audio playback error:", e);
  }
}

// Metronome Animation Loop (Pendulum and Green Play LED)
function metronomeLoop(timestamp) {
  if (currentBpm > 0) {
    const periodMs = 60000 / currentBpm;
    // Angle in degrees between -28 and +28
    const phase = ((timestamp % periodMs) / periodMs) * 2 * Math.PI;
    const angle = Math.sin(phase) * 28;
    pendulumArm.style.transform = `translateX(-50%) rotate(${angle}deg)`;

    // Detect beat peak / flash LED
    const timeSinceLastBeat = timestamp - lastBeatTime;
    if (timeSinceLastBeat >= periodMs) {
      lastBeatTime = timestamp;
      ledPlay.classList.add("active");
      playClickSound();
      setTimeout(() => {
        ledPlay.classList.remove("active");
      }, Math.min(100, periodMs / 3));
    }
  } else {
    // Stopped
    pendulumArm.style.transform = "translateX(-50%) rotate(0deg)";
    ledPlay.classList.remove("active");
  }

  requestAnimationFrame(metronomeLoop);
}
