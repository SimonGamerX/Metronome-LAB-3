#!/usr/bin/env python3
"""
Metronome Device Client (Hybrid C++ & Python Architecture)
Course: B8019 - Programming the Internet of Things (Fall 2026)
Group: iotpj

Role:
  - Manages the MQTT connection to the Mosquitto broker (paho-mqtt).
  - Configures Last Will and Testament (LWT) for status tracking.
  - Subscribes to remote command topics (cmd/#) with QoS 1.
  - Interfaces via IPC with the high-performance C++ metronome_core engine
    (which handles physical GPIO, WiringPi, LED blinking, and button debouncing).
  - Publishes retained state topics (state/#) and transient event topics (event/#).
"""

import sys
import os
import json
import time
import signal
import argparse
import subprocess
import threading
import warnings
from typing import Optional

# Suppress paho-mqtt deprecation warnings across v1 and v2
warnings.filterwarnings("ignore", category=DeprecationWarning)

try:
    import paho.mqtt.client as mqtt
except ImportError:
    print("[ERROR] 'paho-mqtt' is not installed.")
    print("Please install it with: pip install paho-mqtt")
    sys.exit(1)


class MetronomeDeviceClient:
    def __init__(self, broker: str = "localhost", port: int = 1883, group: str = "iotpj",
                 core_path: Optional[str] = None):
        self.broker = broker
        self.port = port
        self.group = group
        self.core_path = core_path or self._find_core_binary()
        
        # Topic definitions
        self.topic_prefix = f"metronome/{self.group}"
        self.topic_status = f"{self.topic_prefix}/status"
        self.topic_cmd_wildcard = f"{self.topic_prefix}/cmd/#"
        self.topic_cmd_set_bpm = f"{self.topic_prefix}/cmd/set_bpm"
        self.topic_cmd_set_mode = f"{self.topic_prefix}/cmd/set_mode"
        self.topic_cmd_reset_min = f"{self.topic_prefix}/cmd/reset_min"
        self.topic_cmd_reset_max = f"{self.topic_prefix}/cmd/reset_max"

        self.topic_state_bpm = f"{self.topic_prefix}/state/bpm"
        self.topic_state_mode = f"{self.topic_prefix}/state/mode"
        self.topic_state_min = f"{self.topic_prefix}/state/min"
        self.topic_state_max = f"{self.topic_prefix}/state/max"
        self.topic_event_beat = f"{self.topic_prefix}/event/beat"
        self.topic_event_tap = f"{self.topic_prefix}/event/tap"

        # Process & Thread state
        self.core_proc: Optional[subprocess.Popen] = None
        self.running = True
        self.proc_lock = threading.Lock()

        # Cache of latest state
        self.current_bpm = 0
        self.current_mode = "play"
        self.current_min = 0
        self.current_max = 0

        # MQTT Client initialization
        # Compatible with both paho-mqtt v1 and v2
        try:
            self.client = mqtt.Client(
                callback_api_version=mqtt.CallbackAPIVersion.VERSION1,
                client_id=f"metronome_device_{self.group}"
            )
        except AttributeError:
            self.client = mqtt.Client(client_id=f"metronome_device_{self.group}")

        self._configure_mqtt()

    def _find_core_binary(self) -> str:
        candidates = [
            os.path.join(os.path.dirname(__file__), "metronome_core"),
            os.path.join(os.path.dirname(__file__), "build", "metronome_core"),
            "./metronome_core",
            "./build/metronome_core",
            os.path.join(os.path.dirname(__file__), "metronome_core.exe")
        ]
        for c in candidates:
            if os.path.isfile(c) and os.access(c, os.X_OK):
                return os.path.abspath(c)
        return os.path.join(os.path.dirname(__file__), "metronome_core")

    def _configure_mqtt(self):
        # Configure Last Will and Testament (LWT)
        # When ungracefully disconnected, broker publishes {"status": "offline"} with retain=True
        lwt_payload = json.dumps({"status": "offline"})
        self.client.will_set(self.topic_status, payload=lwt_payload, qos=1, retain=True)

        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            print(f"[MQTT] Connected successfully to broker {self.broker}:{self.port}")
            # 1. Publish status: ONLINE (retained = True, QoS = 1)
            online_payload = json.dumps({"status": "online"})
            self.client.publish(self.topic_status, payload=online_payload, qos=1, retain=True)
            print(f"[MQTT] Published LWT Online Status -> {self.topic_status}")

            # 2. Subscribe to all command topics
            self.client.subscribe(self.topic_cmd_wildcard, qos=1)
            print(f"[MQTT] Subscribed to command topics -> {self.topic_cmd_wildcard} (QoS 1)")

            # 3. Request initial state from C++ core
            self.send_to_core({"cmd": "get_state"})
        else:
            print(f"[MQTT] Connection failed with result code: {rc}")

    def _on_disconnect(self, client, userdata, rc):
        if rc != 0:
            print(f"[MQTT WARNING] Unexpected broker disconnect (rc={rc}). Will auto-reconnect...")

    def _on_message(self, client, userdata, msg):
        topic = msg.topic
        payload_str = msg.payload.decode("utf-8", errors="ignore").strip()
        print(f"[MQTT RECV] {topic} -> {payload_str}")

        try:
            payload = json.loads(payload_str) if payload_str else {}
        except json.JSONDecodeError:
            print(f"[MQTT ERROR] Failed to parse JSON from topic {topic}: {payload_str}")
            return

        # Route commands to C++ core
        if topic == self.topic_cmd_set_bpm:
            bpm = payload.get("bpm")
            if bpm is not None:
                self.send_to_core({"cmd": "set_bpm", "bpm": int(bpm)})

        elif topic == self.topic_cmd_set_mode:
            mode = payload.get("mode", "").lower()
            if mode in ["play", "learn"]:
                self.send_to_core({"cmd": "set_mode", "mode": mode})

        elif topic == self.topic_cmd_reset_min:
            self.send_to_core({"cmd": "reset_min"})

        elif topic == self.topic_cmd_reset_max:
            self.send_to_core({"cmd": "reset_max"})

    def send_to_core(self, cmd_dict: dict):
        with self.proc_lock:
            if self.core_proc and self.core_proc.stdin and not self.core_proc.stdin.closed:
                try:
                    line = json.dumps(cmd_dict) + "\n"
                    self.core_proc.stdin.write(line.encode("utf-8"))
                    self.core_proc.stdin.flush()
                except Exception as e:
                    print(f"[IPC ERROR] Failed to write to metronome_core stdin: {e}")

    def _core_reader_loop(self):
        """Reads JSON lines emitted by C++ metronome_core and publishes to MQTT."""
        while self.running and self.core_proc and self.core_proc.stdout:
            try:
                line_bytes = self.core_proc.stdout.readline()
                if not line_bytes:
                    break
                line = line_bytes.decode("utf-8", errors="ignore").strip()
                if not line:
                    continue

                # Parse JSON event from C++ core
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    # Non-JSON debugging log from C++ core
                    print(f"[C++ CORE LOG] {line}")
                    continue

                event_type = data.get("event")

                if event_type == "state":
                    self.current_bpm = data.get("bpm", 0)
                    self.current_mode = data.get("mode", "play")
                    self.current_min = data.get("min", 0)
                    self.current_max = data.get("max", 0)
                    source = data.get("source", "local")

                    print(f"[DEVICE STATE] BPM={self.current_bpm} Mode={self.current_mode} "
                          f"Min={self.current_min} Max={self.current_max} (source={source})")

                    # Publish retained state topics with QoS 1
                    bpm_payload = json.dumps({"bpm": self.current_bpm, "source": source})
                    self.client.publish(self.topic_state_bpm, bpm_payload, qos=1, retain=True)

                    mode_payload = json.dumps({"mode": self.current_mode})
                    self.client.publish(self.topic_state_mode, mode_payload, qos=1, retain=True)

                    min_payload = json.dumps({"value": self.current_min})
                    self.client.publish(self.topic_state_min, min_payload, qos=1, retain=True)

                    max_payload = json.dumps({"value": self.current_max})
                    self.client.publish(self.topic_state_max, max_payload, qos=1, retain=True)

                elif event_type == "beat":
                    bpm = data.get("bpm", self.current_bpm)
                    ts = data.get("timestamp", int(time.time() * 1000))
                    beat_payload = json.dumps({"bpm": bpm, "timestamp": ts})
                    self.client.publish(self.topic_event_beat, beat_payload, qos=0, retain=False)

                elif event_type == "tap":
                    count = data.get("count", 0)
                    tap_payload = json.dumps({"count": count, "timestamp": int(time.time() * 1000)})
                    self.client.publish(self.topic_event_tap, tap_payload, qos=0, retain=False)
                    print(f"[PHYSICAL TAP] Tap #{count} recorded on hardware button!")

                elif event_type == "mode_changed":
                    new_mode = data.get("mode")
                    print(f"[PHYSICAL BUTTON] Mode switched to: {new_mode}")

            except Exception as e:
                if self.running:
                    print(f"[READER ERROR] Exception in core reader thread: {e}")
                break

    def start(self):
        print("=" * 60)
        print("  Metronome Thing Device Client (Hybrid C++ & Python)")
        print(f"  Group ID:       {self.group}")
        print(f"  Broker:         {self.broker}:{self.port}")
        print(f"  Topic Prefix:   {self.topic_prefix}")
        print(f"  C++ Core:       {self.core_path}")
        print("=" * 60)

        # 1. Start C++ metronome_core subprocess
        if not os.path.exists(self.core_path):
            print(f"[WARNING] C++ binary '{self.core_path}' not found!")
            print("Please compile C++ core first: cd device && mkdir -p build && cd build && cmake .. && make")
            print("Starting in simulation fallback mode...")
            self.core_proc = None
        else:
            try:
                self.core_proc = subprocess.Popen(
                    [self.core_path],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    bufsize=0
                )
                print(f"[PROCESS] Spawned C++ metronome_core (PID: {self.core_proc.pid})")
            except Exception as e:
                print(f"[ERROR] Failed to start {self.core_path}: {e}")
                self.core_proc = None

        # 2. Launch background reader thread for C++ stdout
        if self.core_proc:
            reader_thread = threading.Thread(target=self._core_reader_loop, daemon=True)
            reader_thread.start()

        # 3. Connect to Mosquitto Broker
        try:
            self.client.connect(self.broker, self.port, keepalive=60)
        except Exception as e:
            print(f"[FATAL] Could not connect to MQTT broker at {self.broker}:{self.port} - {e}")
            print("Check that Mosquitto is running: sudo systemctl status mosquitto")
            self.stop()
            sys.exit(1)

        self.client.loop_start()

        # Keep running until interrupted
        try:
            while self.running:
                time.sleep(0.5)
                # Check if core subprocess died
                if self.core_proc and self.core_proc.poll() is not None:
                    print(f"[ERROR] C++ metronome_core process exited with code {self.core_proc.returncode}")
                    break
        except KeyboardInterrupt:
            print("\n[SHUTDOWN] Interrupted by user (Ctrl+C). Cleaning up...")
        finally:
            self.stop()

    def stop(self):
        self.running = False

        # 1. Graceful MQTT offline status
        try:
            offline_payload = json.dumps({"status": "offline"})
            self.client.publish(self.topic_status, payload=offline_payload, qos=1, retain=True)
            time.sleep(0.2)
            self.client.loop_stop()
            self.client.disconnect()
            print("[MQTT] Disconnected cleanly.")
        except Exception:
            pass

        # 2. Terminate C++ subprocess
        with self.proc_lock:
            if self.core_proc and self.core_proc.poll() is None:
                try:
                    self.send_to_core({"cmd": "quit"})
                    time.sleep(0.2)
                    self.core_proc.terminate()
                    self.core_proc.wait(timeout=2.0)
                except Exception:
                    self.core_proc.kill()
                print("[PROCESS] C++ metronome_core terminated.")


def main():
    parser = argparse.ArgumentParser(description="Metronome Thing Device Client (Hybrid C++/Python)")
    parser.add_argument("--broker", default="localhost", help="MQTT broker host (default: localhost)")
    parser.add_argument("--port", type=int, default=1883, help="MQTT broker port (default: 1883)")
    parser.add_argument("--group", default="iotpj", help="Group identifier for topics (default: iotpj)")
    parser.add_argument("--core", default=None, help="Path to metronome_core executable")
    args = parser.parse_args()

    client = MetronomeDeviceClient(
        broker=args.broker,
        port=args.port,
        group=args.group,
        core_path=args.core
    )

    def sig_handler(sig, frame):
        client.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, sig_handler)
    signal.signal(signal.SIGTERM, sig_handler)

    client.start()


if __name__ == "__main__":
    main()
