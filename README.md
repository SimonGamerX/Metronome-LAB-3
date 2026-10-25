# Metronome Thing with MQTT (Lab 3)

**Course**: B8019 - Programming the Internet of Things (Fall 2026)  
**Professor**: Sumi Helal  
**Teaching Assistant**: Junjie Li (`lijunjie@ufl.edu`)  
**Group Identifier**: `iotpj`  

---

## 1. System Architecture Overview

This project extends the physical digital metronome Thing from Lab 2 into an event-driven, publish/subscribe IoT system powered by **MQTT** and a **Mosquitto** message broker.

```
+--------------------------------------------------------------------------------+
|                             RASPBERRY PI 4B                                    |
|                                                                                |
|  +--------------------+     Stdio IPC     +---------------------------------+  |
|  |   metronome_core   | <==============>  |        device_client.py         |  |
|  |     (C++ Engine)   |   (JSON stream)   |       (Python MQTT Bridge)      |  |
|  +--------------------+                   +---------------------------------+  |
|    | (WiringPi GPIO)                                 | (paho-mqtt)             |
|    |                                                 v                         |
|    +--> Red & Green LEDs                  +---------------------+              |
|    +--> Mode & Tap Buttons                |  Mosquitto Broker   |              |
|                                           | (TCP 1883 / WS 9001)|              |
+-------------------------------------------+----------+----------+--------------+
                                                       |
                             MQTT Publish / Subscribe  |
                                                       v
+--------------------------------------------------------------------------------+
|                              REMOTE CLIENTS                                    |
|                                                                                |
|  +--------------------+   +-----------------------+   +---------------------+  |
|  |   Web Dashboard    |   |   Python Controller   |   |   Python Monitor    |  |
|  | (WS: port 9001)    |   |     controller.py     |   |     monitor.py      |  |
|  +--------------------+   +-----------------------+   +---------------------+  |
+--------------------------------------------------------------------------------+
```

### Why a Hybrid (C++ & Python) Infrastructure?
* **C++ Engine (`metronome_core`)**: Reuses the deterministic timing engine and hardware GPIO routines from Lab 2 without compromise. C++ handles microsecond-accurate tap delta calculations, the 4-sample FIFO rolling window, button debouncing (50ms), and the 50% duty cycle LED blinking thread without garbage collection pauses or Python GIL jitter.
* **Python MQTT Client (`device_client.py`)**: Uses `paho-mqtt` to handle asynchronous broker communication, Last Will and Testament (LWT), QoS 1 handshakes, JSON message parsing, and retained state management.
* **IPC (Inter-Process Communication)**: The Python client spawns `metronome_core` as a supervised child process and exchanges structured JSON streams over standard I/O pipes.

---

## 2. MQTT Topic Space Design

All topics use the group prefix **`metronome/iotpj/`**:

| Topic | Purpose | Direction | QoS | Retained? | Sample Payload |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `metronome/iotpj/status` | Online / Offline presence (LWT) | Device $\to$ Broker | 1 | **Yes** | `{"status": "online"}` / `{"status": "offline"}` |
| `metronome/iotpj/cmd/set_bpm` | Set target tempo | Remote $\to$ Device | 1 | No | `{"bpm": 120}` |
| `metronome/iotpj/cmd/set_mode` | Switch Play / Learn mode | Remote $\to$ Device | 1 | No | `{"mode": "play"}` or `{"mode": "learn"}` |
| `metronome/iotpj/cmd/reset_min`| Reset minimum tracked BPM | Remote $\to$ Device | 1 | No | `{"reset": true}` |
| `metronome/iotpj/cmd/reset_max`| Reset maximum tracked BPM | Remote $\to$ Device | 1 | No | `{"reset": true}` |
| `metronome/iotpj/state/bpm` | Current BPM tempo | Device $\to$ Remote | 1 | **Yes** | `{"bpm": 120, "source": "remote"}` |
| `metronome/iotpj/state/mode` | Current mode (`play` / `learn`) | Device $\to$ Remote | 1 | **Yes** | `{"mode": "play"}` |
| `metronome/iotpj/state/min` | Lowest non-zero BPM recorded | Device $\to$ Remote | 1 | **Yes** | `{"value": 60}` |
| `metronome/iotpj/state/max` | Highest BPM recorded | Device $\to$ Remote | 1 | **Yes** | `{"value": 180}` |
| `metronome/iotpj/event/beat` | Pulse event on each beat tick | Device $\to$ Remote | 0 | No | `{"bpm": 120, "timestamp": 1729864800000}` |
| `metronome/iotpj/event/tap` | Physical tap feedback in Learn | Device $\to$ Remote | 0 | No | `{"count": 3, "timestamp": 1729864800000}` |

---

## 3. Hardware Circuit & Pin Configuration

| Component | BCM GPIO | Physical Header Pin | Resistor / Mode | Function / Visual Feedback |
| :--- | :---: | :---: | :---: | :--- |
| **Red LED** | `GPIO 16` | Pin 36 | 220–330 $\Omega$ series | Pulses for 100ms on each tap in **Learn Mode**; OFF in Play Mode |
| **Green LED** | `GPIO 13` | Pin 33 | 220–330 $\Omega$ series | Blinks at current BPM (50% duty cycle) in **Play Mode**; OFF when BPM = 0 |
| **Mode Button (PB2)** | `GPIO 21` | Pin 40 | Software Pull-Down | Toggles between Play Mode and Learn Mode (50ms debounce) |
| **Tap Button (PB1)** | `GPIO 26` | Pin 37 | Software Pull-Down | Records tap timestamps in Learn Mode (min 4 taps required) |

*(Note: Custom pin assignments can also be passed as command line arguments to `metronome_core`: `./metronome_core [red] [green] [mode] [tap]`)*.

---

## 4. Software Setup & Installation

### Step 1: Install Mosquitto Broker and Dependencies (on Raspberry Pi)

```bash
sudo apt update
sudo apt install -y mosquitto mosquitto-clients cmake g++ make python3 python3-pip
python3 -m pip install --break-system-packages paho-mqtt
```

### Step 2: Configure Mosquitto for TCP and WebSocket Access

To allow remote computers and the Web Dashboard to connect to Mosquitto, configure both port `1883` (MQTT TCP) and port `9001` (MQTT over WebSockets):

```bash
sudo nano /etc/mosquitto/conf.d/metronome.conf
```

Add the following lines:
```text
# Standard MQTT listener for device, CLI controller, and CLI monitor
listener 1883 0.0.0.0
allow_anonymous true

# WebSocket listener for the browser dashboard
listener 9001 0.0.0.0
protocol websockets
allow_anonymous true
```

Restart the broker to apply the configuration:
```bash
sudo systemctl restart mosquitto
sudo systemctl status mosquitto
```

Verify your Raspberry Pi's IP address:
```bash
hostname -I
```

---

## 5. Building and Running the Device

### Step 1: Compile the C++ Engine

```bash
cd device
mkdir -p build && cd build
cmake ..
make
```

This compiles the `metronome_core` executable.

### Step 2: Start the Device Client

```bash
cd ../  # (Back to the device/ folder)
python3 device_client.py --broker localhost --group iotpj
```

When started, the device:
1. Spawns `metronome_core` to control LEDs and buttons.
2. Connects to Mosquitto and arms its **Last Will and Testament (LWT)** (`metronome/iotpj/status` $\to$ `offline`, retained).
3. Publishes `metronome/iotpj/status` $\to$ `online` (retained, QoS 1).
4. Subscribes to `metronome/iotpj/cmd/#` (QoS 1).
5. Emits initial retained state (`bpm`, `mode`, `min`, `max`).

---

## 6. Running the Remote Clients

### Option A: Interactive Web Dashboard
1. Open [`remote/dashboard/index.html`](file:///c:/Users/Withe/OneDrive/Desktop/metronome/remote/dashboard/index.html) in any modern web browser (Chrome, Edge, Firefox, Safari).
2. Enter your Raspberry Pi's IP address in the **Broker Host** field (or `localhost` if running locally).
3. Ensure the **WS Port** is `9001` and **Group ID** is `iotpj`.
4. Click **Connect**.
5. The dashboard will instantly populate all current values from **retained messages**, swing the pendulum in sync with the physical metronome, and allow full bidirectional control!

### Option B: Python CLI Monitor (Real-Time Telemetry)
In a separate terminal (on the Pi or laptop):
```bash
cd remote
python3 monitor.py --broker <PI_IP_ADDRESS> --group iotpj
```

* **Demonstrating Retained Messages**: Run `monitor.py` *after* the metronome has already been running. Notice that `monitor.py` receives the device's current BPM, mode, min, max, and online status **immediately upon connecting**, with zero delay!

### Option C: Python CLI Controller
In another terminal:
```bash
cd remote
python3 controller.py --broker <PI_IP_ADDRESS> --group iotpj
```

Interactive commands:
* `bpm 120`: Sets tempo to 120 BPM with QoS 1.
* `mode learn`: Transitions device to Learn Mode.
* `mode play`: Transitions device to Play Mode.
* `reset-min`: Resets minimum tracked BPM.
* `reset-max`: Resets maximum tracked BPM.
* `preset allegro`: Sets tempo to 144 BPM.
* `help` / `exit`: Shows help or exits.

*(Single-shot commands are also supported, e.g. `python3 controller.py --bpm 140`)*.

---

## 7. Verification and Testing Checklist

- [x] **Local Hardware**: Press Mode button on Pi to enter Learn Mode (Red LED pulses on each tap); tap at least 4 times, press Mode again; Green LED blinks at learned tempo.
- [x] **Remote Control**: Send `bpm 160` via `controller.py` or the Web Dashboard; Green LED tempo updates immediately.
- [x] **Bidirectional Sync**: Tap a rhythm locally on the breadboard; Web Dashboard and `monitor.py` update immediately via retained state.
- [x] **Retained Messages**: Start `monitor.py` after device is running; all 4 state values are delivered instantly.
- [x] **Last Will and Testament (LWT)**: Force-kill the device process (`kill -9 <PID>` or unplug power); the broker automatically publishes `{"status": "offline"}` to `metronome/iotpj/status`, and both dashboard and monitor show `Device: Offline (LWT)` in red!
- [x] **Quality of Service (QoS 1)**: Verified on all command topics (`cmd/set_bpm`, `cmd/set_mode`, etc.).
