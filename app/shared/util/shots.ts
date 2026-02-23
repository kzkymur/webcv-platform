export const SHOTS_DIR = "1-syncro-checkerboard_shots";

export type ShotKey = { ts: string; cam: string };

// Supported patterns (backward compatible):
// - New: 1-syncro-checkerboard_shots/<ts>/cam-<cam>[.<ext>]
// - Old: 1-syncro-checkerboard_shots/<ts>_cam-<cam>[.<ext>]
export function parseShotKey(path: string): ShotKey | null {
  let m = path.match(/^1-syncro-checkerboard_shots\/([^/]+)\/cam-(.+?)(?:\.[^.\/]+)?$/);
  if (m) return { ts: m[1], cam: m[2] };
  m = path.match(/^1-syncro-checkerboard_shots\/(.+?)_cam-(.+?)(?:\.[^.\/]+)?$/);
  if (m) return { ts: m[1], cam: m[2] };
  return null;
}
