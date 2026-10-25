/**
 * Metronome Thing MQTT Dashboard Application (Lab 3)
 * Group: iotpj
 * 
 * Features:
 *  - Connects to Mosquitto MQTT Broker via WebSockets (default port: 9001).
 *  - Subscribes to:
 *      metronome/<group>/status   (LWT detection)
 *      metronome/<group>/state/#  (Retained state: bpm, mode, min, max)
 *      metronome/<group>/event/#  (Beat ticks, tap events)
 *  - Publishes commands with QoS 1:
 *      metronome/<group>/cmd/set_bpm
 *      metronome/<group>/cmd/set_mode
 *      metronome/<group>/cmd/reset_min
 *      metronome/<group>/cmd/reset_max
 *  - Real-time pendulum animation, virtual LEDs, and synthesized Web Audio tick.
 */

// Application State
let client = null;
let isBrokerConnected = false;
let currentBpm = 0;
let currentMode = "play";
let minBpm = 0;
let maxBpm = 0;
let audioCtx = null;
let animationFrameId = null;
let lastBeatTimestamp = 0;

// DOM Elements
const brokerHostInput = document.getElementById("brokerHost");
const brokerPortInput = document.getElementById("brokerPort");
const groupIdInput = document.getElementById("groupId");
const btnConnect = document.getElementById("btnConnect");
const brokerBadge = document.getElementById("brokerBadge");
const deviceBadge = document.getElementById("deviceBadge");

const displayBpm = document.getElementById("displayBpm");
const displayBpmSource = document.getElementById("displayBpmSource");
const displayMin = document.getElementById("displayMin");
const displayMinNote = document.getElementById("displayMinNote");
const displayMax = document.getElementById("displayMax");
const displayMaxNote = document.getElementById("displayMaxNote");

const tempoMarking = document.getElementById("tempoMarking");
const tempoPeriod = document.getElementById("tempoPeriod");
const modeDisplay = document.getElementById("modeDisplay");
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
  // Load saved configurations from localStorage
  const savedHost = localStorage.getItem("metronome_mqtt_host");
  const savedPort = localStorage.getItem("metronome_mqtt_port");
  const savedGroup = localStorage.getItem("metronome_mqtt_group");
  if (savedHost) brokerHostInput.value = savedHost;
  if (savedPort) brokerPortInput.value = savedPort;
  if (savedGroup) groupIdInput.value = savedGroup;

  setupEventListeners();
  requestAnimationFrame(pendulumLoop);
});

// Event Listeners
function setupEventListeners() {
  btnConnect.addEventListener("click", () => {
    if (isBrokerConnected) {
      disconnectMqtt();
    } else {
      connectMqtt();
    }
  });

  // Slider & Number Input Sync
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
    const val = parseInt(bpmInput.value, 10);
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

  soundToggle.addEventListener("change", () => {
    if (soundToggle.checked && !audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
  });
}

// MQTT Connection Logic
function connectMqtt() {
  const host = brokerHostInput.value.trim() || "localhost";
  const port = parseInt(brokerPortInput.value.trim(), 10) || 9001;
  const group = groupIdInput.value.trim() || "iotpj";

  localStorage.setItem("metronome_mqtt_host", host);
  localStorage.setItem("metronome_mqtt_port", port);
  localStorage.setItem("metronome_mqtt_group", group);

  const clientId = "dashboard_" + Math.random().toString(16).substr(2, 8);
  log(`[MQTT] Connecting to ws://${host}:${port} as ${clientId}...`, "info");

  btnConnect.disabled = true;
  btnConnect.textContent = "Connecting...";

  try {
    client = new Paho.MQTT.Client(host, Number(port), "/mqtt", clientId);
  } catch (err) {
    // Fallback without path if standard websocket
    try {
      client = new Paho.MQTT.Client(host, Number(port), clientId);
    } catch (e) {
      log(`[MQTT Error] Initialization failed: ${e.message}`, "error");
      btnConnect.disabled = false;
      btnConnect.textContent = "Connect";
      return;
    }
  }

  client.onConnectionLost = onConnectionLost;
  client.onMessageArrived = onMessageArrived;

  client.connect({
    onSuccess: onConnectSuccess,
    onFailure: onConnectFailure,
    useSSL: false,
    timeout: 5,
    keepAliveInterval: 30
  });
}

function onConnectSuccess() {
  isBrokerConnected = true;
  btnConnect.disabled = false;
  btnConnect.textContent = "Disconnect";
  btnConnect.className = "btn btn-danger";

  brokerBadge.textContent = "Broker: Connected";
  brokerBadge.className = "badge badge-online";

  const group = groupIdInput.value.trim() || "iotpj";
  const prefix = `metronome/${group}`;

  log(`[MQTT Success] Connected to broker! Subscribing to ${prefix}/#`, "success");

  // Subscribe to Status (LWT), State, and Events
  client.subscribe(`${prefix}/status`, { qos: 1 });
  client.subscribe(`${prefix}/state/#`, { qos: 1 });
  client.subscribe(`${prefix}/event/#`, { qos: 0 });
}

function onConnectFailure(response) {
  isBrokerConnected = false;
  btnConnect.disabled = false;
  btnConnect.textContent = "Connect";
  btnConnect.className = "btn btn-primary";

  brokerBadge.textContent = "Broker: Disconnected";
  brokerBadge.className = "badge badge-offline";

  log(`[MQTT Failed] Could not connect: ${response.errorMessage || response}`, "error");
}

function onConnectionLost(response) {
  isBrokerConnected = false;
  btnConnect.disabled = false;
  btnConnect.textContent = "Connect";
  btnConnect.className = "btn btn-primary";

  brokerBadge.textContent = "Broker: Disconnected";
  brokerBadge.className = "badge badge-offline";

  deviceBadge.textContent = "Device: Unknown";
  deviceBadge.className = "badge badge-offline";

  if (response.errorCode !== 0) {
    log(`[MQTT Lost] Connection lost: ${response.errorMessage}`, "warn");
  }
}

function disconnectMqtt() {
  if (client && isBrokerConnected) {
    client.disconnect();
    log("[MQTT] Disconnected by user.", "info");
  }
  isBrokerConnected = false;
  btnConnect.textContent = "Connect";
  btnConnect.className = "btn btn-primary";
  brokerBadge.textContent = "Broker: Disconnected";
  brokerBadge.className = "badge badge-offline";
}

// MQTT Message Handling
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

  const retainNote = isRetained ? " [RETAINED]" : "";
  log(`[RECV${retainNote}] ${topic}: ${payloadStr}`, isRetained ? "info" : "event");

  // 1. Status topic (Online / Offline detection via LWT)
  if (topic === `${prefix}/status`) {
    const status = (data.status || "").toLowerCase();
    if (status === "online") {
      deviceBadge.textContent = "Device: Online";
      deviceBadge.className = "badge badge-online";
    } else {
      deviceBadge.textContent = "Device: Offline (LWT)";
      deviceBadge.className = "badge badge-offline";
    }
  }

  // 2. State BPM topic
  else if (topic === `${prefix}/state/bpm`) {
    const bpm = data.bpm !== undefined ? parseInt(data.bpm, 10) : 0;
    updateBpmState(bpm, data.source || "unknown");
  }

  // 3. State Mode topic
  else if (topic === `${prefix}/state/mode`) {
    const mode = (data.mode || "play").toLowerCase();
    updateModeState(mode);
  }

  // 4. State Min topic
  else if (topic === `${prefix}/state/min`) {
    minBpm = data.value !== undefined ? parseInt(data.value, 10) : 0;
    displayMin.textContent = minBpm;
    displayMinNote.textContent = minBpm > 0 ? "tracked" : "(none)";
  }

  // 5. State Max topic
  else if (topic === `${prefix}/state/max`) {
    maxBpm = data.value !== undefined ? parseInt(data.value, 10) : 0;
    displayMax.textContent = maxBpm;
    displayMaxNote.textContent = maxBpm > 0 ? "tracked" : "(none)";
  }

  // 6. Beat event
  else if (topic === `${prefix}/event/beat`) {
    triggerBeatTick();
  }

  // 7. Tap event
  else if (topic === `${prefix}/event/tap`) {
    triggerTapPulse();
  }
}

// Publishing Commands (QoS 1)
function publishCommand(cmdName, payloadObj) {
  if (!client || !isBrokerConnected) {
    log(`[Error] Cannot publish: Broker not connected!`, "error");
    return;
  }
  const group = groupIdInput.value.trim() || "iotpj";
  const topic = `metronome/${group}/cmd/${cmdName}`;
  const payloadStr = JSON.stringify(payloadObj);

  const message = new Paho.MQTT.Message(payloadStr);
  message.destinationName = topic;
  message.qos = 1; // Commands use QoS 1 per spec
  message.retained = false;

  client.send(message);
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

// State Update Helpers
function updateBpmState(bpm, source) {
  currentBpm = bpm;
  displayBpm.textContent = bpm;
  displayBpmSource.textContent = `state/bpm (source: ${source})`;

  // Update slider and number input
  if (bpm > 0) {
    bpmInput.value = bpm;
    bpmSlider.value = Math.min(Math.max(bpm, 20), 240);
  }

  // Update Tempo Name & Period
  if (bpm === 0) {
    tempoMarking.textContent = "Stopped";
    tempoPeriod.textContent = "Period: — ms";
  } else {
    const periodMs = Math.round(60000 / bpm);
    tempoPeriod.textContent = `Period: ${periodMs} ms (Half: ${Math.round(periodMs / 2)} ms)`;
    tempoMarking.textContent = getTempoMarking(bpm);
  }
}

function updateModeState(mode) {
  currentMode = mode;
  if (mode === "learn") {
    modeDisplay.textContent = "Mode: LEARN";
    modeDisplay.className = "mode-tag mode-learn";
    ledPlay.classList.remove("active");
  } else {
    modeDisplay.textContent = "Mode: PLAY";
    modeDisplay.className = "mode-tag mode-play";
    ledLearn.classList.remove("active");
  }
}

function getTempoMarking(bpm) {
  if (bpm < 60) return "Largo";
  if (bpm < 66) return "Larghetto";
  if (bpm < 76) return "Adagio";
  if (bpm < 108) return "Andante";
  if (bpm < 120) return "Moderato";
  if (bpm < 168) return "Allegro";
  if (bpm < 200) return "Presto";
  return "Prestissimo";
}

// Beat & Pulse Visual / Audio Feedback
function triggerBeatTick() {
  if (currentMode === "play" && currentBpm > 0) {
    ledPlay.classList.add("active");
    setTimeout(() => ledPlay.classList.remove("active"), 120);

    if (soundToggle.checked) {
      playClickSound(1000);
    }
  }
}

function triggerTapPulse() {
  ledLearn.classList.add("active");
  setTimeout(() => ledLearn.classList.remove("active"), 120);

  if (soundToggle.checked) {
    playClickSound(1400);
  }
}

function playClickSound(freq = 1000) {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.04);
  } catch (e) {
    // AudioContext permission guard
  }
}

// Continuous Pendulum Animation Loop
function pendulumLoop(timestamp) {
  if (currentBpm > 0 && currentMode === "play") {
    const periodMs = 60000 / currentBpm;
    // Angle oscillates between -28 deg and +28 deg
    const angle = Math.sin((timestamp / periodMs) * 2 * Math.PI) * 28;
    pendulumArm.style.transform = `rotate(${angle.toFixed(2)}deg)`;
  } else {
    pendulumArm.style.transform = "rotate(0deg)";
  }
  requestAnimationFrame(pendulumLoop);
}

// Log Feed
function log(msg, type = "info") {
  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;
  const time = new Date().toLocaleTimeString();
  entry.textContent = `[${time}] ${msg}`;
  logConsole.appendChild(entry);
  logConsole.scrollTop = logConsole.scrollHeight;
}
