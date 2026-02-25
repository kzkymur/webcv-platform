// Minimal stubs to satisfy legacy serialInterface.ts until full homography utils exist.
export const GALVO_MAX_X = 65534;
export const GALVO_MAX_Y = 65534;

export function crampGalvoCoordinate(p: { x: number; y: number }) {
  const x = Math.max(0, Math.min(GALVO_MAX_X, Math.floor(p.x)));
  const y = Math.max(0, Math.min(GALVO_MAX_Y, Math.floor(p.y)));
  return { x, y };
}
