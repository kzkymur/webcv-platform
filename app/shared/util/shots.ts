export const SHOTS_DIR = "1-syncro-checkerboard_shots";

export type ShotKey = { ts: string; cam: string };

// 1-syncro-checkerboard_shots/<ts>_cam-<cam>[.<ext>]
// Accept optional extension (e.g., .rgb, .gray) but exclude it from cam name
export function parseShotKey(path: string): ShotKey | null {
  const m = path.match(/^1-syncro-checkerboard_shots\/(.+?)_cam-(.+?)(?:\.[^.\/]+)?$/);
  if (!m) return null;
  return { ts: m[1], cam: m[2] };
}

