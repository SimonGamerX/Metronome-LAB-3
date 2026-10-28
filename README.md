# Metronome Thing (MQTT) — Setup & Run Guide

**Group ID**: `iotpj`  
**Topic Prefix**: `metronome/iotpj/`  
**YouTube Demo Video**: [Video Demonstration Here](https://youtu.be/f7nMIJXFRQo) (`https://youtu.be/f7nMIJXFRQo`)

---

## 1. Install Dependencies

On Raspberry Pi and remote machine:
```bash
sudo apt update
sudo apt install -y mosquitto mosquitto-clients cmake g++ make python3 python3-pip
python3 -m pip install --break-system-packages paho-mqtt
```

---

## 2. Configure & Start Mosquitto Broker

Create the configuration file:
```bash
sudo nano /etc/mosquitto/conf.d/metronome.conf
```

Add the following lines (enables TCP port 1883 and WebSocket port 9001):
```text
listener 1883 0.0.0.0
allow_anonymous true

listener 9001 0.0.0.0
protocol websockets
allow_anonymous true
```

Restart and check the broker:
```bash
sudo systemctl restart mosquitto
sudo systemctl status mosquitto
```

Find your Raspberry Pi's IP address:
```bash
hostname -I
```

---

## 3. Build & Run Device Client (Raspberry Pi)

Compile the C++ core:
```bash
cd device
mkdir -p build && cd build
cmake ..
make
```

Start the device client:
```bash
cd ..
python3 device_client.py --broker localhost --group iotpj
```

---

## 4. Run Remote Clients

### Option A: Web Dashboard
Open [`remote/dashboard/index.html`](remote/dashboard/index.html) in your browser:
* **Broker Host**: Enter Raspberry Pi IP (or `localhost`)
* **WS Port**: `9001`
* **Group ID**: `iotpj`
* Click **Connect**

### Option B: Python CLI Monitor
```bash
cd remote
python3 monitor.py --broker <PI_IP_ADDRESS> --group iotpj
```

### Option C: Python CLI Controller
Interactive REPL:
```bash
cd remote
python3 controller.py --broker <PI_IP_ADDRESS> --group iotpj
```

Single-shot command examples:
```bash
python3 controller.py --broker <PI_IP_ADDRESS> --group iotpj --bpm 120
python3 controller.py --broker <PI_IP_ADDRESS> --group iotpj --mode learn
python3 controller.py --broker <PI_IP_ADDRESS> --group iotpj --mode play
python3 controller.py --broker <PI_IP_ADDRESS> --group iotpj --reset-min
python3 controller.py --broker <PI_IP_ADDRESS> --group iotpj --reset-max
```
