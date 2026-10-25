/**
 * Metronome Thing MQTT Dashboard (Lab 3)
 * Group: iotpj
 * Exact visual match & animation behavior of Lab 2 Dashboard
 */

// State
let currentBpm = 0;
let currentMode = "play";
let minBpm = 0;
let maxBpm = 0;
let isConnected = false;
let client = null;
let audioCtx = null;
let lastBeatTime = 0;

// DOM Elements
const brokerHostInput = document.getElementById("brokerHost");
const brokerPortInput = document.getElementById("brokerPort");
const groupIdInput = document.getElementById("groupId");
const btnConnect = document.getElementById("btnConnect");
const brokerBadge = document.getElementById("brokerBadge");
const statusBadge = document.getElementById("statusBadge");

const displayBpm = document.getElementById("displayBpm");
const displayBpmSource = document.getElementById("displayBpmSource");
const displayMin = document.getElementById("displayMin");
const displayMinNote = document.getElementById("displayMinNote");
const displayMax = document.getElementById("displayMax");
const displayMaxNote = document.getElementById("displayMaxNote");

const tempoMarking = document.getElementById("tempoMarking");
const tempoPeriod = document.getElementById("tempoPeriod");
const modeBadge = document.getElementById("modeBadge");
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

const btnModePlay = document.getElementById("btnModePlay");
const btnModeLearn = document.getElementById("btnModeLearn");
const btnResetMin = document.getElementById("btnResetMin");
const btnResetMax = document.getElementById("btnResetMax");
const btnResetBoth = document.getElementById("btnResetBoth");

const logConsole = document.getElementById("logConsole");
const btnClearLog = document.getElementById("btnClearLog");

// Initialize on Load
window.addEventListener("DOMContentLoaded", () => {
  // Restore saved connection params
  const savedHost = localStorage.getItem("metronome_mqtt_host");
  const savedPort = localStorage.getItem("metronome_mqtt_port");
  const savedGroup = localStorage.getItem("metronome_mqtt_group");
  if (savedHost) brokerHostInput.value = savedHost;
  if (savedPort) brokerPortInput.value = savedPort;
  if (savedGroup) groupIdInput.value = savedGroup;

  setupEventListeners();

  // Start pendulum animation loop
  requestAnimationFrame(metronomeLoop);
});

// Event Listeners
function setupEventListeners() {
  btnConnect.addEventListener("click", () => {
    if (isConnected) {
      disconnectMqtt();
    } else {
      connectMqtt();
    }
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
    let val = Math.min(300, (parseInt(bpmInput.value, 10) || 0) + 1);
    bpmInput.value = val;
    bpmSlider.value = Math.min(Math.max(val, 20), 240);
  });

  // Preset Chips
  presetChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const bpm = parseInt(chip.getAttribute("data-bpm"), 10);
      bpmInput.value = bpm;
      bpmSlider.value = Math.min(Math.max(bpm, 20), 240);
      publishBpm(bpm);
    });
  });

  btnSetBpm.addEventListener("click", () => {
    let val = parseInt(bpmInput.value, 10);
    if (!isNaN(val)) {
      publishBpm(val);
    }
  });

  btnModePlay.addEventListener("click", () => {
    publishMode("play");
  });

  btnModeLearn.addEventListener("click", () => {
    publishMode("learn");
  });

  btnResetMin.addEventListener("click", () => {
    publishReset("min");
  });

  btnResetMax.addEventListener("click", () => {
    publishReset("max");
  });

  btnResetBoth.addEventListener("click", () => {
    publishReset("min");
    publishReset("max");
  });

  btnClearLog.addEventListener("click", () => {
    logConsole.innerHTML = "";
  });

  // Web Audio Context initialization on user gesture
  soundToggle.addEventListener("change", () => {
    if (soundToggle.checked && !audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContext();
    }
  });
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

// MQTT Connection
function connectMqtt() {
  const host = brokerHostInput.value.trim() || "localhost";
  const port = parseInt(brokerPortInput.value.trim(), 10) || 9001;
  const group = groupIdInput.value.trim() || "iotpj";

  localStorage.setItem("metronome_mqtt_host", host);
  localStorage.setItem("metronome_mqtt_port", port);
  localStorage.setItem("metronome_mqtt_group", group);

  // Check if user accidentally entered raw TCP port 1883 instead of WebSocket port 9001
  if (port === 1883) {
    log("⚠️ Port 1883 is the raw TCP MQTT port (for Python/C++).", "error");
    log("Web browsers require the WebSocket port (usually 9001).", "error");
    log("➡️ Please change 'Port' to 9001 and ensure Mosquitto has WebSockets enabled!", "info");
  }

  brokerBadge.className = "badge badge-connecting";
  brokerBadge.textContent = "Connecting...";
  btnConnect.disabled = true;

  const clientId = "web_dash_" + Math.random().toString(16).substring(2, 8);
  log(`Connecting to ws://${host}:${port} as ${clientId}...`, "info");

  // Attempt connection with path "" first, fallback to "/mqtt" if needed
  attemptConnection(host, port, "", clientId, group, () => {
    // Fallback attempt with "/mqtt"
    log("Retrying with path '/mqtt'...", "info");
    attemptConnection(host, port, "/mqtt", clientId, group, null);
  });
}

function attemptConnection(host, port, path, clientId, group, fallbackFn) {
  try {
    client = new Paho.MQTT.Client(host, Number(port), path, clientId);
  } catch (e) {
    log(`Initialization error: ${e.message}`, "error");
    brokerBadge.className = "badge badge-offline";
    brokerBadge.textContent = "Broker: Offline";
    btnConnect.disabled = false;
    return;
  }

  client.onConnectionLost = onConnectionLost;
  client.onMessageArrived = onMessageArrived;

  client.connect({
    onSuccess: () => {
      isConnected = true;
      btnConnect.disabled = false;
      btnConnect.textContent = "Disconnect";
      btnConnect.className = "btn btn-danger";

      brokerBadge.className = "badge badge-online";
      brokerBadge.textContent = "Broker: Online";

      const prefix = `metronome/${group}`;
      log(`Connected to broker at ws://${host}:${port}${path}`, "success");
      log(`Subscribing to ${prefix}/# (retained state, events, status)...`, "info");

      // Subscribe to topics
      client.subscribe(`${prefix}/status`, { qos: 1 });
      client.subscribe(`${prefix}/state/#`, { qos: 1 });
      client.subscribe(`${prefix}/event/#`, { qos: 0 });
    },
    onFailure: (err) => {
      if (fallbackFn) {
        fallbackFn();
      } else {
        isConnected = false;
        btnConnect.disabled = false;
        btnConnect.textContent = "Connect";
        btnConnect.className = "btn btn-primary";

        brokerBadge.className = "badge badge-offline";
        brokerBadge.textContent = "Broker: Offline";
        log(`Connection failed to ws://${host}:${port}: ${err.errorMessage || err}`, "error");

        if (port === 1883) {
          log("💡 Tip: Change Port to 9001 (WebSockets) in the connection bar above.", "error");
        } else {
          log("💡 Tip: On your Pi, verify that port 9001 is open: 'ss -tulpn | grep 9001'", "info");
          log("If not running, add 'listener 9001 0.0.0.0' and 'protocol websockets' to /etc/mosquitto/conf.d/metronome.conf and run 'sudo systemctl restart mosquitto'", "info");
        }
      }
    },
    useSSL: false,
    timeout: 5,
    keepAliveInterval: 30
  });
}

function onConnectionLost(response) {
  isConnected = false;
  btnConnect.disabled = false;
  btnConnect.textContent = "Connect";
  btnConnect.className = "btn btn-primary";

  brokerBadge.className = "badge badge-offline";
  brokerBadge.textContent = "Broker: Offline";

  statusBadge.className = "badge badge-offline";
  statusBadge.textContent = "Device: Offline";

  if (response.errorCode !== 0) {
    log(`Connection lost: ${response.errorMessage}`, "error");
  }
}

function disconnectMqtt() {
  if (client && isConnected) {
    client.disconnect();
  }
  isConnected = false;
  btnConnect.textContent = "Connect";
  btnConnect.className = "btn btn-primary";
  brokerBadge.className = "badge badge-offline";
  brokerBadge.textContent = "Broker: Offline";
  statusBadge.className = "badge badge-offline";
  statusBadge.textContent = "Device: Offline";
  log("Disconnected by user.", "info");
}

// MQTT Message Receiver
function onMessageArrived(message) {
  const topic = message.destinationName;
  const payloadStr = message.payloadString;
  const isRetained = message.retained;
  const group = groupIdInput.value.trim() || "iotpj";
  const prefix = `metronome/${group}`;

  let data = {};
  try {
    data = JSON.parse(payloadStr);
  } catch (e) {
    data = { raw: payloadStr };
  }

  const retainTag = isRetained ? " [RETAINED]" : "";
  log(`[RECV${retainTag}] ${topic}: ${payloadStr}`, isRetained ? "info" : "event");

  // Status (LWT)
  if (topic === `${prefix}/status`) {
    const st = (data.status || "").toLowerCase();
    if (st === "online") {
      statusBadge.className = "badge badge-online";
      statusBadge.textContent = "Device: Online";
    } else {
      statusBadge.className = "badge badge-offline";
      statusBadge.textContent = "Device: Offline (LWT)";
    }
  }

  // State: BPM
  else if (topic === `${prefix}/state/bpm`) {
    currentBpm = parseInt(data.bpm !== undefined ? data.bpm : data, 10) || 0;
    updateBpmDisplay(currentBpm);
    displayBpmSource.textContent = `state/bpm (source: ${data.source || "unknown"})`;
    // Sync slider & input
    if (currentBpm > 0) {
      bpmInput.value = currentBpm;
      bpmSlider.value = Math.min(Math.max(currentBpm, 20), 240);
    }
  }

  // State: Mode
  else if (topic === `${prefix}/state/mode`) {
    currentMode = (data.mode || "play").toLowerCase();
    updateModeDisplay(currentMode);
  }

  // State: Min
  else if (topic === `${prefix}/state/min`) {
    minBpm = parseInt(data.value !== undefined ? data.value : data, 10) || 0;
    updateMinDisplay(minBpm);
  }

  // State: Max
  else if (topic === `${prefix}/state/max`) {
    maxBpm = parseInt(data.value !== undefined ? data.value : data, 10) || 0;
    updateMaxDisplay(maxBpm);
  }

  // Event: Beat
  else if (topic === `${prefix}/event/beat`) {
    if (currentMode === "play") {
      ledPlay.classList.add("active");
      playClickSound(1200);
      setTimeout(() => ledPlay.classList.remove("active"), 100);
    }
  }

  // Event: Tap
  else if (topic === `${prefix}/event/tap`) {
    ledLearn.classList.add("active");
    playClickSound(1600);
    setTimeout(() => ledLearn.classList.remove("active"), 100);
  }
}

// Publishing Commands (QoS 1)
function publishCommand(cmd, payload) {
  if (!client || !isConnected) {
    log("Cannot send: Not connected to broker!", "error");
    return;
  }
  const group = groupIdInput.value.trim() || "iotpj";
  const topic = `metronome/${group}/cmd/${cmd}`;
  const payloadStr = JSON.stringify(payload);

  const msg = new Paho.MQTT.Message(payloadStr);
  msg.destinationName = topic;
  msg.qos = 1;
  msg.retained = false;
  client.send(msg);

  log(`[PUBLISH QoS 1] ${topic} -> ${payloadStr}`, "success");
}

function publishBpm(bpm) {
  publishCommand("set_bpm", { bpm: bpm });
}

function publishMode(mode) {
  publishCommand("set_mode", { mode: mode });
}

function publishReset(type) {
  publishCommand(`reset_${type}`, { reset: true });
}

// UI Updaters (Matching Lab 2)
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

function updateModeDisplay(mode) {
  if (mode === "learn") {
    modeBadge.textContent = "Mode: LEARN";
    modeBadge.className = "mode-badge mode-badge-learn";
    ledPlay.classList.remove("active");
  } else {
    modeBadge.textContent = "Mode: PLAY";
    modeBadge.className = "mode-badge mode-badge-play";
    ledLearn.classList.remove("active");
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

// Play Click Sound via Web Audio API (Exact Lab 2)
function playClickSound(freq = 1200) {
  if (!soundToggle.checked || !audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.04);
  } catch (e) {
    console.error(e);
  }
}

// Metronome Animation Loop (Exact Lab 2 pendulum physics & green play LED blink)
function metronomeLoop(timestamp) {
  if (currentBpm > 0 && currentMode === "play") {
    const periodMs = 60000 / currentBpm;
    // Angle in degrees between -28 and +28
    const phase = ((timestamp % periodMs) / periodMs) * 2 * Math.PI;
    const angle = Math.sin(phase) * 28;
    pendulumArm.style.transform = `translateX(-50%) rotate(${angle}deg)`;

    // Detect beat peak / flash LED locally if no MQTT event broker
    const timeSinceLastBeat = timestamp - lastBeatTime;
    if (timeSinceLastBeat >= periodMs) {
      lastBeatTime = timestamp;
      ledPlay.classList.add("active");
      playClickSound(1200);
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
