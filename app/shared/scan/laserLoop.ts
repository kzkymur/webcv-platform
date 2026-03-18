export function createLoopAwareLaserSetter(
  laserPct: number | undefined,
  applyLaser: (pct: number) => void
): (currentTimeMs: number) => void {
  let lastTickMs = -1;
  let appliedInCurrentPass = false;

  return (currentTimeMs: number): void => {
    if (currentTimeMs < lastTickMs) {
      appliedInCurrentPass = false;
    }
    lastTickMs = currentTimeMs;

    if (appliedInCurrentPass) return;
    if (typeof laserPct !== "number" || !Number.isFinite(laserPct)) return;

    try {
      applyLaser(laserPct);
      appliedInCurrentPass = true;
    } catch {}
  };
}
