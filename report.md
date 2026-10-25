# Lab 3 Report: Extending Your Metronome Thing with MQTT

**Course**: B8019 - Programming the Internet of Things  
**Semester**: Fall 2026  
**Instructor**: Professor Sumi Helal  
**Teaching Assistant**: Junjie Li (`lijunjie@ufl.edu`)  
**Group Name / Identifier**: `iotpj`  
**Submission Date**: 1 November 2026  

---

## Demonstration Video
* **YouTube Video Link**: `https://youtu.be/[INSERT_YOUR_DEMO_VIDEO_LINK_HERE]`
* *(The video demonstrates the group introduction, hardware setup, local button/LED interactions, remote MQTT command execution via QoS 1, late-joining subscriber receiving retained messages, and unexpected device crash triggering Last Will and Testament).*

---

## 1. System Architecture & Design Choices

In this lab, we extended the physical digital metronome Thing built in Lab 2 into an event-driven, decoupled IoT system using MQTT and the Mosquitto message broker.

### Hybrid Implementation Architecture
To achieve optimal real-time performance while maximizing modularity, our team adopted a **hybrid C++ and Python architecture** on the Raspberry Pi:
1. **Deterministic C++ Engine (`device/metronome_core`)**:
   - Manages physical hardware GPIO via `WiringPi`.
   - Executes real-time button edge detection with a 50ms software debouncing filter.
   - Computes BPM using a 4-sample FIFO running window derived from successive tap deltas.
   - Drives the Green LED 50% duty cycle blinking thread without garbage collection interruptions or Python GIL jitter.
2. **Asynchronous Python MQTT Bridge (`device/device_client.py`)**:
   - Uses `paho-mqtt` to manage network connectivity with the Mosquitto broker.
   - Handles advanced MQTT protocols: Last Will and Testament (LWT), QoS 1 handshakes, and retained message publication.
   - Interfaces with the C++ engine through standard I/O (IPC) using structured JSON message streams.
3. **Decoupled Remote Clients (`remote/`)**:
   - **Interactive Web Dashboard**: Browser-based interface connecting via MQTT over WebSockets (port 9001). Features a synchronized animated pendulum, Play/Learn virtual LEDs, Web Audio ticks, tempo presets, and a live MQTT event console.
   - **Python CLI Monitor (`monitor.py`)**: Subscribes to telemetry topics to verify live event streams and late-joining retained messages.
   - **Python CLI Controller (`controller.py`)**: Interactive command-line client enabling rapid command dispatching (`set_bpm`, `set_mode`, `reset_min`, `reset_max`).

```
+-----------------------------------------------------------------------------------+
|                                 RASPBERRY PI 4B                                   |
|                                                                                   |
|  +--------------------+      Stdio IPC       +---------------------------------+  |
|  |   metronome_core   | <==================> |        device_client.py         |  |
|  |     (C++ Engine)   |    (JSON stream)     |       (Python MQTT Bridge)      |  |
|  +--------------------+                      +---------------------------------+  |
|    | (WiringPi GPIO)                                    | (paho-mqtt)             |
|    +--> LEDs (Red & Green)                              v                         |
|    +--> Buttons (Mode & Tap)                 +---------------------+              |
|                                              |  Mosquitto Broker   |              |
|                                              | (TCP 1883 / WS 9001)|              |
+----------------------------------------------+----------+----------+--------------+
                                                          |
                                MQTT Publish / Subscribe  |
                                                          v
+-----------------------------------------------------------------------------------+
|                                 REMOTE CLIENTS                                    |
|                                                                                   |
|  +--------------------+      +-----------------------+      +------------------+  |
|  |   Web Dashboard    |      |   Python Controller   |      |  Python Monitor  |  |
|  | (WS: port 9001)    |      |     controller.py     |      |    monitor.py    |  |
|  +--------------------+      +-----------------------+      +------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 2. Topic Hierarchy & Payload Design

Our topic hierarchy uses the unique group prefix **`metronome/iotpj/`** to avoid topic collisions. We cleanly separated commands, state, transient events, and lifecycle presence:

| Topic | Category | Direction | QoS | Retain | JSON Payload Format | Description |
| :--- | :---: | :---: | :---: | :---: | :--- | :--- |
| `metronome/iotpj/status` | Lifecycle | Dev $\to$ Broker | 1 | **Yes** | `{"status": "online"}` / `{"status": "offline"}` | Device connection state (LWT) |
| `metronome/iotpj/cmd/set_bpm` | Command | Rem $\to$ Dev | 1 | No | `{"bpm": 120}` | Instructs device to set target tempo |
| `metronome/iotpj/cmd/set_mode` | Command | Rem $\to$ Dev | 1 | No | `{"mode": "play"}` or `{"mode": "learn"}` | Switches device operating mode |
| `metronome/iotpj/cmd/reset_min`| Command | Rem $\to$ Dev | 1 | No | `{"reset": true}` | Resets minimum recorded BPM |
| `metronome/iotpj/cmd/reset_max`| Command | Rem $\to$ Dev | 1 | No | `{"reset": true}` | Resets maximum recorded BPM |
| `metronome/iotpj/state/bpm` | State | Dev $\to$ Rem | 1 | **Yes** | `{"bpm": 120, "source": "remote"}` | Current active tempo |
| `metronome/iotpj/state/mode` | State | Dev $\to$ Rem | 1 | **Yes** | `{"mode": "play"}` | Current operating mode |
| `metronome/iotpj/state/min` | State | Dev $\to$ Rem | 1 | **Yes** | `{"value": 60}` | Minimum non-zero tempo recorded |
| `metronome/iotpj/state/max` | State | Dev $\to$ Rem | 1 | **Yes** | `{"value": 180}` | Maximum tempo recorded |
| `metronome/iotpj/event/beat` | Event | Dev $\to$ Rem | 0 | No | `{"bpm": 120, "timestamp": 1729864800000}` | Instantaneous beat pulse |
| `metronome/iotpj/event/tap` | Event | Dev $\to$ Rem | 0 | No | `{"count": 3, "timestamp": 1729864800000}` | Physical tap event during Learn mode |

---

## 3. MQTT Advanced Features: Retained Messages, QoS, and LWT

### A. Retained Messages
* **Why Used**: In standard MQTT publish/subscribe, messages are lost if a subscriber is not active at the instant of publication. For long-lived device state (`state/bpm`, `state/mode`, `state/min`, `state/max`, and `status`), this is unacceptable because a dashboard or monitor connecting hours later would have to poll or wait for a change.
* **Implementation**: We flag all state publications with `retain = true`.
* **Demonstration**: When a user launches `remote/monitor.py` or opens the Web Dashboard while the metronome has already been running for hours, the broker immediately transmits all cached state topics. The dashboard instantly reflects the active tempo and min/max statistics without issuing any request.

### B. Quality of Service (QoS 1)
* **Why Used**: In IoT systems operating over wireless networks, network packets can be lost due to interference or congestion.
  * For **state-changing commands** (`cmd/set_bpm`, `cmd/set_mode`, etc.), missing a command leaves the system in an inconsistent state. Thus, we enforce **QoS 1 ("At least once")**, which requires a two-way `PUBACK` handshake between sender and broker.
  * For **state topics**, we also utilize **QoS 1** to guarantee that the broker retains the authoritative update.
  * For **transient events** (`event/beat`, `event/tap`), we utilize **QoS 0 ("At most once")** to avoid network overhead, as lost ticks are superseded by the next beat within fractions of a second.

### C. Last Will and Testament (LWT)
* **Why Used**: If a device experiences a sudden power loss, kernel crash, or network failure, it cannot send a graceful disconnect message.
* **Implementation**: Upon establishing its MQTT connection, `device_client.py` registers an LWT on topic `metronome/iotpj/status` with payload `{"status": "offline"}`, `qos = 1`, and `retain = true`. Once connected, the device publishes `{"status": "online"}` (retained).
* **Recovery / Detection**: If the Raspberry Pi loses power or is terminated abruptly, the Mosquitto broker detects the broken TCP socket keepalive and automatically publishes the LWT message on behalf of the dead device. Remote dashboards immediately transition their status badge from `Device: Online` to `Device: Offline (LWT)` in real time.

---

## 4. Architectural Comparison: REST (Lab 2) vs. MQTT (Lab 3)

| Architectural Dimension | RESTful API (Lab 2) | MQTT Publish/Subscribe (Lab 3) |
| :--- | :--- | :--- |
| **Communication Paradigm** | Synchronous Request/Response (Client-driven) | Asynchronous Publish/Subscribe (Event-driven) |
| **Coupling** | **Tightly Coupled**: Clients must know the IP address and exact port (`http://<ip>:8080/bpm/`) of the Raspberry Pi. | **Decoupled**: Clients and device only know the broker's address and shared topic names. The device does not know who or how many clients exist. |
| **Network Overhead & Latency** | **High**: Each state check required a new HTTP request with HTTP headers, TCP connection overhead, and CORS preflight (`OPTIONS`). Periodic polling (every 2s) wasted bandwidth when tempo remained static. | **Minimal**: A persistent TCP connection with a lightweight 2-byte MQTT header. Data is transmitted only when an event occurs ("push" model). |
| **Multiplexing / Many-to-Many** | **Difficult**: If multiple dashboards or monitoring stations were open, each had to poll the device independently, overloading the Pi's CPU. | **Effortless**: One publish from the device is replicated by the Mosquitto broker to any number of subscribers simultaneously. |
| **Disconnection Handling** | **Passive**: The client only discovered a crash after an HTTP request timed out. | **Active**: The broker instantly broadcasts the device's Last Will and Testament (LWT) upon connection loss. |
| **Hardware Determinism** | C++ thread was burdened with handling HTTP listening and socket parsing alongside GPIO blinking. | High-speed GPIO routines run uninhibited in C++, while lightweight asynchronous network I/O is handled by Python. |

---

## 5. Remote Interface Walkthrough & Screenshots

### Web Dashboard
The Web Dashboard (`remote/dashboard/index.html`) provides a responsive, unified control and telemetry station:
* **Connection & Presence Bar**: Configurable broker host, WebSocket port (9001), group ID (`iotpj`), and live LWT status pill (`Device: Online` vs `Device: Offline`).
* **Mechanical Metronome Skin**: Animated pendulum with real-time angular displacement synchronized to `state/bpm`.
* **Hardware LED Mirrors**: Virtual Green LED (Play mode 50% duty cycle blink) and Red LED (Learn mode tap pulse).
* **Audio Synthesizer**: Web Audio API tick sound generated in phase with metronome beats.
* **Command Dispatchers**: Slider, preset chips (Largo, Andante, Allegro, Presto), Mode toggles, and Min/Max resets running over QoS 1.
* **Activity Console**: Real-time terminal feed displaying every MQTT packet with topic, QoS, and payload.

*(Insert screenshots of the Web Dashboard and Python Monitor here)*

---

## 6. Group Member Contributions

| Member Name | Contribution Percentage | Primary Responsibilities |
| :--- | :---: | :--- |
| **[Member 1 Name]** | 50% | Embedded C++ metronome core (`metronome.cpp`, `main.cpp`), WiringPi GPIO configuration, Hardware breadboard circuit, IPC JSON communication |
| **[Member 2 Name]** | 50% | Python MQTT client (`device_client.py`), Mosquitto broker setup & LWT/QoS 1 configuration, Web Dashboard development (`app.js`, `style.css`, `index.html`), CLI tools (`monitor.py`, `controller.py`), Lab report & video demonstration |
| **Total** | **100%** | |
