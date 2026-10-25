#include <chrono>
#include <iostream>
#include <thread>
#include <atomic>
#include <mutex>
#include <string>
#include <sstream>
#include <algorithm>
#include <cctype>

#if defined(HAVE_WIRINGPI) && HAVE_WIRINGPI
#include <wiringPi.h>
#else
// Mock declarations for non-Raspberry Pi builds / simulation
#define HIGH 1
#define LOW 0
#define INPUT 0
#define OUTPUT 1
#define PUD_DOWN 1
inline int wiringPiSetupGpio() { return -1; }
inline void pinMode(int, int) {}
inline void pullUpDnControl(int, int) {}
inline void digitalWrite(int, int) {}
inline int digitalRead(int) { return 0; }
#endif

#include "metronome.hpp"

using namespace std::chrono_literals;

// Default Pin Configuration (Matches custom setup from Lab 2)
static int g_pin_red   = 16;
static int g_pin_green = 13;
static int g_pin_mode  = 21;
static int g_pin_tap   = 26;

// Metronome engine instance
static metronome g_metronome;

// State management (thread-safe)
static std::mutex g_state_mutex;
static std::mutex g_io_mutex;
static std::atomic<size_t> g_current_bpm(0);
static std::atomic<size_t> g_min_bpm(0);
static std::atomic<size_t> g_max_bpm(0);
static std::atomic<bool> g_is_learn_mode(false);
static std::atomic<bool> g_red_pulse(false);
static std::atomic<bool> g_running(true);
static std::chrono::steady_clock::time_point g_pulse_time;

// Helper to emit JSON line to stdout for Python MQTT adapter
void emit_json(const std::string& json_str) {
	std::lock_guard<std::mutex> lock(g_io_mutex);
	std::cout << json_str << std::endl;
}

void emit_state(const std::string& source = "local") {
	std::lock_guard<std::mutex> lock(g_state_mutex);
	std::ostringstream ss;
	ss << "{\"event\":\"state\","
	   << "\"bpm\":" << g_current_bpm.load() << ","
	   << "\"mode\":\"" << (g_is_learn_mode.load() ? "learn" : "play") << "\","
	   << "\"min\":" << g_min_bpm.load() << ","
	   << "\"max\":" << g_max_bpm.load() << ","
	   << "\"source\":\"" << source << "\"}";
	emit_json(ss.str());
}

void emit_beat(size_t bpm) {
	auto now = std::chrono::system_clock::now();
	auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();
	std::ostringstream ss;
	ss << "{\"event\":\"beat\","
	   << "\"bpm\":" << bpm << ","
	   << "\"timestamp\":" << ms << "}";
	emit_json(ss.str());
}

// Set BPM and update min/max statistics
void set_bpm(size_t bpm, const std::string& source = "local") {
	{
		std::lock_guard<std::mutex> lock(g_state_mutex);
		g_current_bpm = bpm;

		// Min tracks lowest non-zero BPM
		if (bpm > 0) {
			if (g_min_bpm == 0 || bpm < g_min_bpm) {
				g_min_bpm = bpm;
			}
			if (g_max_bpm == 0 || bpm > g_max_bpm) {
				g_max_bpm = bpm;
			}
		}
	}
	emit_state(source);
}

// LED Blink Thread (Play Mode = 50% duty cycle Green LED; Learn Mode = Red Pulse on tap)
void blink_thread_func(bool gpio_available) {
	bool green_on = false;
	auto last_toggle = std::chrono::steady_clock::now();

	while (g_running.load()) {
		auto now = std::chrono::steady_clock::now();

		if (g_is_learn_mode.load()) {
			// In LEARN mode: Green LED is always OFF
			if (green_on) {
				green_on = false;
				if (gpio_available) digitalWrite(g_pin_green, LOW);
			}

			// Red LED pulses for 100ms on tap
			if (g_red_pulse.load()) {
				auto elapsed_pulse = std::chrono::duration_cast<std::chrono::milliseconds>(now - g_pulse_time).count();
				if (elapsed_pulse < 100) {
					if (gpio_available) digitalWrite(g_pin_red, HIGH);
				} else {
					if (gpio_available) digitalWrite(g_pin_red, LOW);
					g_red_pulse = false;
				}
			} else {
				if (gpio_available) digitalWrite(g_pin_red, LOW);
			}
		} else {
			// In PLAY mode: Red LED is always OFF
			if (gpio_available) digitalWrite(g_pin_red, LOW);
			g_red_pulse = false;

			size_t bpm = g_current_bpm.load();
			if (bpm == 0) {
				if (green_on) {
					green_on = false;
					if (gpio_available) digitalWrite(g_pin_green, LOW);
				}
			} else {
				// 50% duty cycle: period = 60000 / BPM ms; half_period = 30000 / BPM ms
				double half_period_ms = 30000.0 / static_cast<double>(bpm);
				auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - last_toggle).count();

				if (elapsed >= half_period_ms) {
					green_on = !green_on;
					if (gpio_available) digitalWrite(g_pin_green, green_on ? HIGH : LOW);
					last_toggle = now;

					// Emit beat event when LED toggles ON
					if (green_on) {
						emit_beat(bpm);
					}
				}
			}
		}

		std::this_thread::sleep_for(5ms);
	}

	// Turn off LEDs on shutdown
	if (gpio_available) {
		digitalWrite(g_pin_red, LOW);
		digitalWrite(g_pin_green, LOW);
	}
}

// Simple parsing helper for incoming JSON or textual commands
void process_command(const std::string& line) {
	if (line.empty()) return;

	// Check for set_bpm
	// Handles: {"cmd":"set_bpm","bpm":120} or SET_BPM 120
	if (line.find("set_bpm") != std::string::npos || line.find("SET_BPM") != std::string::npos) {
		size_t bpm = 0;
		// Try to extract number
		size_t num_pos = line.find_first_of("0123456789");
		if (num_pos != std::string::npos) {
			bpm = std::stoul(line.substr(num_pos));
		}
		set_bpm(bpm, "remote");
		return;
	}

	// Check for set_mode
	// Handles: {"cmd":"set_mode","mode":"play"} or {"cmd":"set_mode","mode":"learn"}
	if (line.find("set_mode") != std::string::npos || line.find("SET_MODE") != std::string::npos) {
		if (line.find("learn") != std::string::npos || line.find("LEARN") != std::string::npos) {
			if (!g_is_learn_mode.load()) {
				g_is_learn_mode = true;
				g_metronome.start_timing();
				emit_state("remote");
			}
		} else if (line.find("play") != std::string::npos || line.find("PLAY") != std::string::npos) {
			if (g_is_learn_mode.load()) {
				g_metronome.stop_timing();
				g_is_learn_mode = false;
				size_t learned_bpm = g_metronome.get_bpm();
				if (learned_bpm > 0) {
					set_bpm(learned_bpm, "local");
				} else {
					emit_state("remote");
				}
			}
		}
		return;
	}

	// Check for reset_min
	if (line.find("reset_min") != std::string::npos || line.find("RESET_MIN") != std::string::npos) {
		{
			std::lock_guard<std::mutex> lock(g_state_mutex);
			g_min_bpm = 0;
		}
		emit_state("remote");
		return;
	}

	// Check for reset_max
	if (line.find("reset_max") != std::string::npos || line.find("RESET_MAX") != std::string::npos) {
		{
			std::lock_guard<std::mutex> lock(g_state_mutex);
			g_max_bpm = 0;
		}
		emit_state("remote");
		return;
	}

	// Check for get_state
	if (line.find("get_state") != std::string::npos || line.find("GET_STATE") != std::string::npos) {
		emit_state("query");
		return;
	}

	// Check for quit
	if (line.find("quit") != std::string::npos || line.find("QUIT") != std::string::npos) {
		g_running = false;
		return;
	}
}

// Thread reading commands from stdin (sent by Python MQTT adapter or user)
void stdin_reader_thread() {
	std::string line;
	while (g_running.load() && std::getline(std::cin, line)) {
		process_command(line);
	}
}

int main(int argc, char* argv[]) {
	// Optional custom pin arguments: ./metronome_core [red] [green] [mode] [tap]
	if (argc >= 5) {
		g_pin_red   = std::stoi(argv[1]);
		g_pin_green = std::stoi(argv[2]);
		g_pin_mode  = std::stoi(argv[3]);
		g_pin_tap   = std::stoi(argv[4]);
	}

	bool gpio_available = true;
	if (wiringPiSetupGpio() < 0) {
		std::cerr << "[metronome_core] NOTICE: GPIO not available. Running in headless / simulation mode." << std::endl;
		gpio_available = false;
	} else {
		pinMode(g_pin_red, OUTPUT);
		pinMode(g_pin_green, OUTPUT);
		pinMode(g_pin_mode, INPUT);
		pinMode(g_pin_tap, INPUT);

		pullUpDnControl(g_pin_mode, PUD_DOWN);
		pullUpDnControl(g_pin_tap, PUD_DOWN);

		digitalWrite(g_pin_red, LOW);
		digitalWrite(g_pin_green, LOW);
	}

	// Emit ready event and initial state
	emit_json("{\"event\":\"ready\",\"status\":\"initialized\"}");
	emit_state("initial");

	// Start LED blinking thread
	std::thread blink_thread(blink_thread_func, gpio_available);

	// Start Stdin reader thread for IPC commands
	std::thread reader_thread(stdin_reader_thread);

	// Button Polling Loop (Hardware Buttons with 50ms Debouncing)
	if (gpio_available) {
		bool mode_prev = false;
		bool tap_prev = false;
		auto last_mode_press = std::chrono::steady_clock::now();
		auto last_tap_press = std::chrono::steady_clock::now();
		const auto debounce_time = 50ms;

		while (g_running.load()) {
			auto now = std::chrono::steady_clock::now();
			bool mode_curr = (digitalRead(g_pin_mode) == HIGH);
			bool tap_curr = (digitalRead(g_pin_tap) == HIGH);

			// Rising edge on Mode button (toggle Play / Learn)
			if (mode_curr && !mode_prev && (now - last_mode_press >= debounce_time)) {
				last_mode_press = now;

				if (!g_is_learn_mode.load()) {
					// PLAY -> LEARN
					g_is_learn_mode = true;
					g_metronome.start_timing();
					emit_json("{\"event\":\"mode_changed\",\"mode\":\"learn\"}");
					emit_state("local");
				} else {
					// LEARN -> PLAY
					g_metronome.stop_timing();
					g_is_learn_mode = false;
					size_t learned_bpm = g_metronome.get_bpm();

					if (learned_bpm > 0) {
						set_bpm(learned_bpm, "local");
					} else {
						emit_json("{\"event\":\"mode_changed\",\"mode\":\"play\",\"note\":\"not_enough_taps\"}");
						emit_state("local");
					}
				}
			}

			// Rising edge on Tap button (records tap in Learn mode)
			if (tap_curr && !tap_prev && (now - last_tap_press >= debounce_time)) {
				last_tap_press = now;

				if (g_is_learn_mode.load()) {
					g_metronome.tap();
					g_pulse_time = now;
					g_red_pulse = true;

					std::ostringstream ss;
					ss << "{\"event\":\"tap\","
					   << "\"count\":" << g_metronome.get_tap_count() << "}";
					emit_json(ss.str());
				}
			}

			mode_prev = mode_curr;
			tap_prev = tap_curr;

			std::this_thread::sleep_for(10ms);
		}
	} else {
		// In headless mode, wait until termination
		while (g_running.load()) {
			std::this_thread::sleep_for(100ms);
		}
	}

	// Clean exit
	g_running = false;
	if (blink_thread.joinable()) blink_thread.join();
	if (reader_thread.joinable()) reader_thread.detach();

	return 0;
}
