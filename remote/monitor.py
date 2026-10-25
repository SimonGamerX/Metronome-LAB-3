#!/usr/bin/env python3
"""
Metronome Remote Monitor Client
Course: B8019 - Programming the Internet of Things (Fall 2026)
Group: iotpj

Role:
  - Subscribes to:
      metronome/<group>/state/#
      metronome/<group>/event/#
      metronome/<group>/status
  - Demonstrates MQTT Retained Messages: Upon connecting, the monitor
    immediately receives the latest state values published previously by the device!
  - Displays formatted real-time metronome telemetry in the terminal.
"""

import sys
import json
import time
import argparse
import warnings
from datetime import datetime

# Suppress paho-mqtt deprecation warnings across v1 and v2
warnings.filterwarnings("ignore", category=DeprecationWarning)

try:
    import paho.mqtt.client as mqtt
except ImportError:
    print("[ERROR] 'paho-mqtt' is not installed.")
    print("Please install it with: pip install paho-mqtt")
    sys.exit(1)


class MetronomeMonitor:
    def __init__(self, broker: str = "localhost", port: int = 1883, group: str = "iotpj"):
        self.broker = broker
        self.port = port
        self.group = group
        self.prefix = f"metronome/{self.group}"

        # Cached state
        self.status = "UNKNOWN"
        self.bpm = 0
        self.mode = "UNKNOWN"
        self.min_bpm = 0
        self.max_bpm = 0
        self.last_beat_time = None
        self.total_beats = 0
        self.retained_count = 0

        # MQTT Client initialization
        try:
            self.client = mqtt.Client(
                callback_api_version=mqtt.CallbackAPIVersion.VERSION1,
                client_id=f"metronome_monitor_{int(time.time())}"
            )
        except AttributeError:
            self.client = mqtt.Client(client_id=f"metronome_monitor_{int(time.time())}")

        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message

    def on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            print(f"\n[CONNECTED] Connected to MQTT broker at {self.broker}:{self.port}")
            print(f"[GROUP ID]   {self.group}")
            print(f"[SUBSCRIBING] Subscribing to state, event, and status topics...")

            # Subscribing to state topics (will immediately receive retained messages)
            self.client.subscribe(f"{self.prefix}/status", qos=1)
            self.client.subscribe(f"{self.prefix}/state/#", qos=1)
            self.client.subscribe(f"{self.prefix}/event/#", qos=0)

            print("[READY] Waiting for telemetry... (Late-joining demo active)\n")
        else:
            print(f"[ERROR] Connection failed with code {rc}")

    def on_message(self, client, userdata, msg):
        topic = msg.topic
        payload_raw = msg.payload.decode("utf-8", errors="ignore").strip()
        is_retained = msg.retain
        now_str = datetime.now().strftime("%H:%M:%S.%f")[:-3]

        if is_retained:
            self.retained_count += 1
            retain_tag = "[RETAINED - CACHED STATE]"
        else:
            retain_tag = "[LIVE EVENT]"

        try:
            data = json.loads(payload_raw) if payload_raw else {}
        except json.JSONDecodeError:
            data = {"raw": payload_raw}

        # Topic parsing
        if topic == f"{self.prefix}/status":
            self.status = data.get("status", "unknown").upper()
            status_symbol = "🟢" if self.status == "ONLINE" else "🔴"
            print(f"[{now_str}] {retain_tag} Device Status: {status_symbol} {self.status} (Topic: {topic})")

        elif topic == f"{self.prefix}/state/bpm":
            self.bpm = data.get("bpm", 0)
            source = data.get("source", "unknown")
            print(f"[{now_str}] {retain_tag} Current BPM: {self.bpm} (source={source})")

        elif topic == f"{self.prefix}/state/mode":
            self.mode = data.get("mode", "unknown").upper()
            mode_symbol = "▶" if self.mode == "PLAY" else "⚙"
            print(f"[{now_str}] {retain_tag} Metronome Mode: {mode_symbol} {self.mode}")

        elif topic == f"{self.prefix}/state/min":
            self.min_bpm = data.get("value", 0)
            print(f"[{now_str}] {retain_tag} Minimum BPM: {self.min_bpm}")

        elif topic == f"{self.prefix}/state/max":
            self.max_bpm = data.get("value", 0)
            print(f"[{now_str}] {retain_tag} Maximum BPM: {self.max_bpm}")

        elif topic == f"{self.prefix}/event/beat":
            self.total_beats += 1
            self.last_beat_time = now_str
            bpm = data.get("bpm", self.bpm)
            print(f"  [{now_str}] ♫ BEAT TICK | BPM: {bpm} | Total Beats: {self.total_beats}")

        elif topic == f"{self.prefix}/event/tap":
            count = data.get("count", 0)
            print(f"  [{now_str}] 👆 PHYSICAL TAP RECORDED | Tap #{count} in Learn Mode")

        else:
            print(f"[{now_str}] {topic}: {payload_raw}")

    def run(self):
        print("=" * 65)
        print("      IoT Metronome Remote Monitor (MQTT Telemetry)")
        print(f"      Broker:  {self.broker}:{self.port}")
        print(f"      Group:   {self.group}")
        print(f"      Prefix:  {self.prefix}/#")
        print("=" * 65)

        try:
            self.client.connect(self.broker, self.port, keepalive=60)
        except Exception as e:
            print(f"[FATAL ERROR] Cannot connect to broker: {e}")
            sys.exit(1)

        try:
            self.client.loop_forever()
        except KeyboardInterrupt:
            print("\n[MONITOR] Stopping monitor client...")
            self.client.disconnect()


def main():
    parser = argparse.ArgumentParser(description="MQTT Metronome Remote Monitor")
    parser.add_argument("--broker", default="localhost", help="MQTT broker address (default: localhost)")
    parser.add_argument("--port", type=int, default=1883, help="MQTT broker port (default: 1883)")
    parser.add_argument("--group", default="iotpj", help="Group identifier (default: iotpj)")
    args = parser.parse_args()

    monitor = MetronomeMonitor(broker=args.broker, port=args.port, group=args.group)
    monitor.run()


if __name__ == "__main__":
    main()
