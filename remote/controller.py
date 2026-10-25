#!/usr/bin/env python3
"""
Metronome Remote Controller Client
Course: B8019 - Programming the Internet of Things (Fall 2026)
Group: iotpj

Role:
  - Publishes commands to the metronome device using QoS 1:
      metronome/<group>/cmd/set_bpm   -> {"bpm": 120}
      metronome/<group>/cmd/set_mode  -> {"mode": "play"} or {"mode": "learn"}
      metronome/<group>/cmd/reset_min -> {"reset": true}
      metronome/<group>/cmd/reset_max -> {"reset": true}
  - Supports both interactive REPL mode and single-shot command-line flags.
"""

import sys
import json
import time
import argparse
import warnings

# Suppress paho-mqtt deprecation warnings across v1 and v2
warnings.filterwarnings("ignore", category=DeprecationWarning)

try:
    import paho.mqtt.client as mqtt
except ImportError:
    print("[ERROR] 'paho-mqtt' is not installed.")
    print("Please install it with: pip install paho-mqtt")
    sys.exit(1)


class MetronomeController:
    def __init__(self, broker: str = "localhost", port: int = 1883, group: str = "iotpj"):
        self.broker = broker
        self.port = port
        self.group = group
        self.prefix = f"metronome/{self.group}/cmd"

        try:
            self.client = mqtt.Client(
                callback_api_version=mqtt.CallbackAPIVersion.VERSION1,
                client_id=f"metronome_controller_{int(time.time())}"
            )
        except AttributeError:
            self.client = mqtt.Client(client_id=f"metronome_controller_{int(time.time())}")

        self.client.on_connect = self.on_connect
        self.connected = False

    def on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            self.connected = True
        else:
            print(f"[ERROR] Connection failed with code {rc}")

    def connect(self):
        try:
            self.client.connect(self.broker, self.port, keepalive=60)
            self.client.loop_start()
            # Wait briefly for connection
            timeout = 3.0
            start = time.time()
            while not self.connected and (time.time() - start < timeout):
                time.sleep(0.05)
            if not self.connected:
                print(f"[WARNING] Connecting to {self.broker}:{self.port} timed out.")
        except Exception as e:
            print(f"[FATAL ERROR] Cannot connect to broker: {e}")
            sys.exit(1)

    def publish_cmd(self, cmd_name: str, payload_dict: dict):
        topic = f"{self.prefix}/{cmd_name}"
        payload_str = json.dumps(payload_dict)
        # Using QoS 1 for commands per assignment specifications
        res = self.client.publish(topic, payload_str, qos=1, retain=False)
        res.wait_for_publish(timeout=2.0)
        print(f"[MQTT SENT] Topic: {topic} | QoS: 1 | Payload: {payload_str}")

    def set_bpm(self, bpm: int):
        self.publish_cmd("set_bpm", {"bpm": bpm})

    def set_mode(self, mode: str):
        mode = mode.lower()
        if mode not in ["play", "learn"]:
            print("[ERROR] Mode must be either 'play' or 'learn'")
            return
        self.publish_cmd("set_mode", {"mode": mode})

    def reset_min(self):
        self.publish_cmd("reset_min", {"reset": True})

    def reset_max(self):
        self.publish_cmd("reset_max", {"reset": True})

    def disconnect(self):
        self.client.loop_stop()
        self.client.disconnect()


def run_interactive(ctrl: MetronomeController):
    print("=" * 60)
    print("  IoT Metronome Remote Controller (Interactive Console)")
    print(f"  Broker: {ctrl.broker}:{ctrl.port} | Group: {ctrl.group}")
    print("=" * 60)
    print("Available Commands:")
    print("  bpm <val>           - Set BPM tempo (e.g., 'bpm 120')")
    print("  mode <play|learn>   - Switch metronome mode")
    print("  reset-min           - Reset tracked minimum BPM")
    print("  reset-max           - Reset tracked maximum BPM")
    print("  reset-both          - Reset both minimum & maximum BPM")
    print("  preset <name>       - Use tempo preset (largo, andante, allegro, presto, stop)")
    print("  help                - Display this menu")
    print("  exit / quit         - Exit controller")
    print("=" * 60)

    presets = {
        "stop": 0,
        "largo": 50,
        "adagio": 60,
        "andante": 80,
        "moderato": 108,
        "allegretto": 120,
        "allegro": 144,
        "presto": 180
    }

    while True:
        try:
            line = input("\n[controller]> ").strip()
            if not line:
                continue

            parts = line.split()
            cmd = parts[0].lower()

            if cmd in ["quit", "exit"]:
                break

            elif cmd in ["bpm", "set_bpm", "set-bpm"]:
                if len(parts) < 2:
                    print("Usage: bpm <number>")
                    continue
                try:
                    bpm_val = int(parts[1])
                    ctrl.set_bpm(bpm_val)
                except ValueError:
                    print("Invalid BPM integer value.")

            elif cmd in ["mode", "set_mode", "set-mode"]:
                if len(parts) < 2:
                    print("Usage: mode <play|learn>")
                    continue
                ctrl.set_mode(parts[1])

            elif cmd in ["reset-min", "reset_min", "rmin"]:
                ctrl.reset_min()

            elif cmd in ["reset-max", "reset_max", "rmax"]:
                ctrl.reset_max()

            elif cmd in ["reset-both", "reset_both"]:
                ctrl.reset_min()
                ctrl.reset_max()

            elif cmd in ["preset"]:
                if len(parts) < 2 or parts[1].lower() not in presets:
                    print(f"Usage: preset <name> (available: {', '.join(presets.keys())})")
                    continue
                preset_bpm = presets[parts[1].lower()]
                ctrl.set_bpm(preset_bpm)

            elif cmd == "help":
                print("Commands: bpm <val>, mode <play|learn>, reset-min, reset-max, preset <name>, quit")

            else:
                print(f"Unknown command: '{cmd}'. Type 'help' for options.")

        except (KeyboardInterrupt, EOFError):
            break

    ctrl.disconnect()
    print("\n[CONTROLLER] Controller exited.")


def main():
    parser = argparse.ArgumentParser(description="MQTT Metronome Remote Controller")
    parser.add_argument("--broker", default="localhost", help="MQTT broker address (default: localhost)")
    parser.add_argument("--port", type=int, default=1883, help="MQTT broker port (default: 1883)")
    parser.add_argument("--group", default="iotpj", help="Group identifier (default: iotpj)")

    # Single-shot command flags
    parser.add_argument("--bpm", type=int, help="Set BPM immediately and exit")
    parser.add_argument("--mode", choices=["play", "learn"], help="Set mode immediately and exit")
    parser.add_argument("--reset-min", action="store_true", help="Reset minimum BPM and exit")
    parser.add_argument("--reset-max", action="store_true", help="Reset maximum BPM and exit")

    args = parser.parse_args()

    ctrl = MetronomeController(broker=args.broker, port=args.port, group=args.group)
    ctrl.connect()

    # If flags were provided, run in non-interactive batch mode
    has_flag = False
    if args.bpm is not None:
        ctrl.set_bpm(args.bpm)
        has_flag = True
    if args.mode is not None:
        ctrl.set_mode(args.mode)
        has_flag = True
    if args.reset_min:
        ctrl.reset_min()
        has_flag = True
    if args.reset_max:
        ctrl.reset_max()
        has_flag = True

    if has_flag:
        time.sleep(0.3)
        ctrl.disconnect()
    else:
        run_interactive(ctrl)


if __name__ == "__main__":
    main()
