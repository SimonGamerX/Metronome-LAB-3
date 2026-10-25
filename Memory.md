# Project Memory & Revision Log

> **Purpose**: This file acts as the persistent project memory across sessions. It documents the project specifications, architectural decisions, hardware setups, current implementation status, and a verification checklist for ongoing revisioning.

---

## 1. Project Context & Objectives
- **Course**: B8019 - Programming the Internet of Things
- **Assignment**: Lab 2 – Developing a Metronome Thing Using Your Raspberry Pi
- **Instructors**: Prof. Sumi Helal & TA Junjie Li (`lijunjie@ufl.edu`)
- **Core Goal**: 
  - Build an embedded IoT digital metronome on Raspberry Pi using C++, `wiringPi`, and `cpprestsdk`.
  - Create a companion web dashboard (HTML/CSS/JS) to interact with the device's RESTful API.
  - Final deliverables: Submission zip with `part1/`, `part2/`, and a group contributions PDF.

---

## 2. Directory Structure & File Roles

```text
metronome/
├── Memory.md                       <- Persistent project memory & revision log
├── contributions_template.md       <- Group contribution report template for submission
│
├── metronome/                      <- PROFESSOR'S ORIGINAL STARTER SKELETON (UNTOUCHED)
│   ├── CMakeLists.txt              <- Original starter CMakeLists
│   ├── main.cpp                    <- Original starter main.cpp (dummy 1s blink & /answer)
│   ├── metronome.hpp               <- Original starter metronome.hpp (beat_samples = 3)
│   ├── rest.hpp                    <- Original starter rest.hpp
│   ├── Lab 2 – Developing... (1).pdf <- Lab specification PDF
│   └── Module 7- Lab 2... .pptx    <- Lecture slides guide
│
├── part1/                          <- COMPLETED IMPLEMENTATION (FOR COMPILATION & SUBMISSION)
│   ├── CMakeLists.txt              <- Multi-arch CMakeLists linking wiringPi, crypto, ssl
│   ├── main.cpp                    <- Full GPIO, debouncing, threading & REST API
│   ├── metronome.hpp               <- Updated with beat_samples = 4
│   ├── metronome.cpp               <- Full tap timing & BPM calculation logic
│   └── rest.hpp                    <- Endpoint maker + CORS response helper
│
└── part2/                          <- COMPLETED HTML DASHBOARD (FOR SUBMISSION)
    ├── index.html                  <- Web dashboard layout & controls
    ├── style.css                   <- Dashboard styling & mechanical metronome skin
    └── app.js                      <- API client, pendulum animation & audio clicks
```

---

## 3. Hardware Setup & Pin Mapping

| Component | Pin (BCM GPIO) | Physical Header Pin | Function / Logic |
| :--- | :---: | :---: | :--- |
| **Red LED** | `GPIO 17` | Pin 11 | Pulses on tap during **Learn Mode**; OFF in Play Mode |
| **Green LED** | `GPIO 27` | Pin 13 | Blinks at current BPM (50% duty cycle) in **Play Mode**; OFF when BPM = 0 or in Learn Mode |
| **Mode Button (PB2)** | `GPIO 23` | Pin 16 | Toggles between Play Mode and Learn Mode (rising-edge triggered) |
| **Tap Button (PB1)** | `GPIO 24` | Pin 18 | Records tap timestamps in Learn Mode (rising-edge triggered) |
| **Pull-down Resistors** | Internal | — | Software enabled via `pullUpDnControl(pin, PUD_DOWN)` for both buttons |

---

## 4. Architecture & Key Technical Decisions

### Part One — Embedded Application (`part1/`)
- **WiringPi Support**:
  - WiringPi installed from git (`git clone https://github.com/WiringPi/WiringPi.git` $\to$ `./build`).
  - `CMakeLists.txt` links `cpprestsdk::cpprest`, `wiringPi`, `boost_system`, `crypto`, `ssl`, and `pthread`.
- **REST API Endpoints (`main.cpp`, `rest.hpp`)**:
  - Uses `web::http::methods::DEL`.
  - Listens on `http://0.0.0.0:8080`.
  - Routes support both slash and non-slash variants.
  - `rest::reply_json()` explicitly adds CORS headers (`Access-Control-Allow-Origin: *`, etc.) to every response.
- **Timing & Rolling Window (`metronome.hpp`, `metronome.cpp`)**:
  - Sample size set to `beat_samples = 4` (storing the 4 most recent taps).
  - Satisfies rule: *"At least 4 taps are required to create a valid BPM measurement."*

### Part Two — Web Dashboard (`part2/`)
- **Files**: `index.html`, `style.css`, `app.js` (clean vanilla stack, zero dependencies).
- **Features**:
  - Configurable Raspberry Pi URL (`http://<ip>:8080`) stored in `localStorage`.
  - Animated pendulum metronome visualizer synchronized to `currentBpm`.
  - Built-in optional audio tick sound via Web Audio API.
  - Real-time display for Current BPM, Min BPM, and Max BPM.
  - Controls: BPM slider (20–240), numeric input, and tempo preset buttons.
  - Buttons to trigger `GET`, `PUT /bpm/`, `DELETE /bpm/min/`, and `DELETE /bpm/max/`.
  - Auto-refresh toggle (polls every 2 seconds).
  - Live REST activity log console.

---

## 5. Ongoing Revision & Quality Checklist
*Review this checklist whenever reviewing or making additions:*

- [x] **Original starter preserved**: `metronome/` contains the professor's original code untouched.
- [x] **WiringPi Active**: Code uses `wiringPi` matching the professor's design.
- [x] **CMake Multiarch & OpenSSL 3.0**: `part1/CMakeLists.txt` links `crypto` and `ssl`.
- [x] **4-Tap Minimum Requirement**: Verified in `part1/metronome.cpp` line 44 (`m_beat_count < beat_samples` returns 0).
- [x] **Period-Based Calculation**: Verified in `part1/metronome.cpp` (uses deltas between successive taps).
- [x] **Min/Max Rule**: Verified in `part1/main.cpp` (`min` only tracks values $> 0$; DELETE resets to 0).
- [x] **LED States**: Verified in `part1/main.cpp` (Green LED OFF when BPM = 0; Red pulses only on tap during Learn mode).
- [x] **CORS Support**: Verified in `part1/rest.hpp` (OPTIONS + all responses carry `Access-Control-Allow-Origin: *`).
- [x] **Debouncing**: Verified in `part1/main.cpp` (50ms debounce window on rising edges).
- [x] **Zero Build Artifacts in `part1`**: Verified (clean source code).
- [x] **Offline Capability & Clean Submission in `part2`**: Verified (only `index.html`, `style.css`, `app.js`).
- [x] **Lab 2 Freeze Guarantee**: `part1/` and `part2/` are strictly locked/frozen; all Lab 3 work will live in independent directories.

---

## 6. Revision History

| Revision | Timestamp | Author | Summary of Changes |
| :---: | :---: | :---: | :--- |
| **v1.0** | 2026-10-12 | Antigravity AI | Initial full implementation. |
| **v1.1** | 2026-10-12 | Antigravity AI | Restored `metronome/` folder to original untouched skeleton. |
| **v1.2** | 2026-10-14 | Antigravity AI | Resolved CMake `find_package(cpprestsdk)` issue on Bookworm. |
| **v1.4** | 2026-10-14 | Antigravity AI | Configured `main.cpp` and `CMakeLists.txt` to link git-built `wiringPi`. |
| **v1.5** | 2026-10-14 | Antigravity AI | Fixed `methods::DEL` and lambda constness in `main.cpp`. |
| **v1.6** | 2026-10-14 | Antigravity AI | Added `crypto`, `ssl`, and `pthread` to `target_link_libraries` in `CMakeLists.txt`. |
| **v1.7** | 2026-10-19 | Antigravity AI | Cleaned `part2` to contain strictly the submission files (`index.html`, `style.css`, `app.js`). |
| **v2.0** | 2026-10-25 | Antigravity AI | Analyzed Lab 3 MQTT Metronome specification (`LAB3 Guides/`). Froze `part1` & `part2`. |
| **v2.1** | 2026-10-25 | Antigravity AI | Implemented Lab 3 hybrid architecture: `device/` (C++ core + Python MQTT), `remote/` (dashboard + CLI tools), `README.md`, `report.md`, and `report.pdf`. |
| **v2.2** | 2026-10-25 | Antigravity AI | Extracted member photos (Riccardo, Nicola, Simone) and reconstructed `report.pdf` to match the exact 2-page layout, styling, and typography of the Lab 2 report. |

---

## 7. Lab 3 Specifications & Architecture Plan

- **Course**: B8019 - Programming the Internet of Things (Fall 2026)
- **Assignment**: Lab 3 – Extending Your Metronome Thing with MQTT
- **Due Date**: 1 November 2026
- **Group ID**: `iotpj`
- **Deliverables**: Single `.zip` containing:
  - `device/`: Raspberry Pi metronome MQTT client & instructions.
  - `remote/`: Dashboard, controller, and monitor clients.
  - `README.md`: Setup, broker config, topic hierarchy, execution guide.
  - `report.pdf`: Design, topic space, QoS/LWT rationale, comparison with REST, demo YouTube link.
- **Key Architectural Changes from Lab 2**:
  - Replaces REST (HTTP request/response, client polling via `cpprestsdk`) with **MQTT (Publish/Subscribe, event-driven)** via Mosquitto broker.
  - Topic structure:
    - `metronome/<group>/cmd/...` (`set_bpm`, `set_mode`, `reset_min`, `reset_max`) with **QoS 1**.
    - `metronome/<group>/state/...` (`bpm`, `mode`, `min`, `max`) with **Retain = True**.
    - `metronome/<group>/event/...` (`beat`) with **QoS 0/1**.
    - `metronome/<group>/status` (`online` / `offline`) with **Last Will and Testament (LWT)** (retained).
  - Preserves exact Lab 2 hardware setup (GPIO 16 Red LED, GPIO 13 Green LED, GPIO 21 Mode button, GPIO 26 Tap button) and metronome logic (4 taps minimum, 50% duty cycle blink, min/max statistics).
  - Bidirectional sync: hardware interactions publish state updates immediately; remote MQTT commands update local playback and publish state updates.
- **Implementation Status**:
  - [x] `device/`: C++ `metronome_core` (CMakeLists.txt, metronome.hpp, metronome.cpp, main.cpp) with IPC JSON stream over stdio.
  - [x] `device/`: Python `device_client.py` with paho-mqtt, LWT, QoS 1, Retain.
  - [x] `remote/`: Python `monitor.py` for live telemetry and late-joining retained state verification.
  - [x] `remote/`: Python `controller.py` for interactive & batch QoS 1 command dispatching.
  - [x] `remote/dashboard/`: Web Dashboard (`index.html`, `style.css`, `app.js`, `paho-mqtt.min.js`) with WebSockets (port 9001), pendulum animation, audio ticks, and live MQTT log.
  - [x] `README.md`: Comprehensive instructions for broker setup, building, running, and verification.
  - [x] `report.md` & `report.pdf`: Complete submission report with YouTube link placeholder and member contributions.
  - [x] `part1/` & `part2/`: Completely frozen and untouched.
