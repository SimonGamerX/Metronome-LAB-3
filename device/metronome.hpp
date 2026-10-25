#pragma once

#include <cstddef>

class metronome {
public:
	// Minimum of 4 taps required per lab specifications
	static constexpr size_t beat_samples = 4;

public:
	metronome() = default;
	~metronome() = default;

public:
	// Call when entering learn mode to reset timing window
	void start_timing();

	// Call when leaving learn mode
	void stop_timing();

	// Record a tap in learn mode
	void tap();

	// Calculate and return current learned BPM (returns 0 if < 4 taps)
	size_t get_bpm() const;

	// Query number of recorded taps in current session
	size_t get_tap_count() const { return m_beat_count; }

	// Check if timing is currently active
	bool is_timing() const { return m_timing; }

private:
	bool m_timing = false;
	size_t m_beat_count = 0;
	size_t m_beats[beat_samples] = {0};
};
