#include "metronome.hpp"
#include <chrono>
#include <cmath>

void metronome::start_timing() {
	m_timing = true;
	m_beat_count = 0;
	for (size_t i = 0; i < beat_samples; ++i) {
		m_beats[i] = 0;
	}
}

void metronome::stop_timing() {
	m_timing = false;
}

void metronome::tap() {
	if (!m_timing) {
		return;
	}

	// Record current steady timestamp in milliseconds
	auto now = std::chrono::steady_clock::now();
	size_t now_ms = static_cast<size_t>(
		std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count()
	);

	if (m_beat_count < beat_samples) {
		m_beats[m_beat_count] = now_ms;
	} else {
		// Shift samples left (FIFO running window) to keep only the 4 most recent taps
		for (size_t i = 0; i < beat_samples - 1; ++i) {
			m_beats[i] = m_beats[i + 1];
		}
		m_beats[beat_samples - 1] = now_ms;
	}
	m_beat_count++;
}

size_t metronome::get_bpm() const {
	// At least beat_samples (4 taps) are required to create a valid BPM measurement
	if (m_beat_count < beat_samples) {
		return 0;
	}

	// Calculate deltas between consecutive recorded taps
	size_t total_delta_ms = 0;
	for (size_t i = 1; i < beat_samples; ++i) {
		if (m_beats[i] <= m_beats[i - 1]) {
			return 0; // Guard against non-monotonic or identical timestamps
		}
		total_delta_ms += (m_beats[i] - m_beats[i - 1]);
	}

	size_t num_intervals = beat_samples - 1;
	if (num_intervals == 0 || total_delta_ms == 0) {
		return 0;
	}

	double avg_delta_ms = static_cast<double>(total_delta_ms) / static_cast<double>(num_intervals);
	if (avg_delta_ms <= 0.0) {
		return 0;
	}

	// BPM = 60,000 ms / avg_delta_ms
	double bpm = 60000.0 / avg_delta_ms;
	return static_cast<size_t>(std::round(bpm));
}
