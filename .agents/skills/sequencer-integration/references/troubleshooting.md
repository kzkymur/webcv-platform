Troubleshooting

Common Errors (exact messages)

- Invalid pitch/speed: "Invalid pitch value: <v>. Must be positive number" / "Invalid speed value: <v>. Must be positive number".
- Invalid delay: "Invalid delay value: <v>. Must be non-negative number".
- Play/Stop state: "Sequencer is already playing", "Sequencer is not playing", "Timer is already playing", "Timer is not playing".
- Insert bounds: "Invalid index: <i>. Must be between 0 and <len>".
- Independent insert: "Insert operation not supported for IndependentSequencer".
- Fragment duplicates: "Fragment already exists in sequencer"; Not found: "Fragment not found in sequencer".
- CustomFragment constraints: "Name cannot be empty", "Start point cannot be negative", "CustomFragment callback cannot be set directly", "currentTime have to be number".
- Timer total: "Total time must be larger than 0" (when set to negative/NaN).

Fixes

- Validate numbers before calls; coerce strings to numbers and check `Number.isNaN`.
- Gate `play/stop` with `isPlaying()`.
- For Independent mode, avoid `insert`; build order with `push` and start times.
- Ensure `CustomFragment` children are added before playback; do not set its callback.
- For rendering, ensure there is at least one fragment (non-zero total duration).

