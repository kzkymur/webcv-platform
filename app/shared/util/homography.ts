// 3x3 homography helpers (row-major 9 numbers)

export function invertHomography(H: ArrayLike<number>): Float32Array {
  const m = H as any;
  const a = m[0], b = m[1], c = m[2];
  const d = m[3], e = m[4], f = m[5];
  const g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const Hc = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  if (!isFinite(det) || Math.abs(det) < 1e-12) {
    return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  }
  const invDet = 1.0 / det;
  return new Float32Array([
    A * invDet,
    D * invDet,
    G * invDet,
    B * invDet,
    E * invDet,
    Hc * invDet,
    C * invDet,
    F * invDet,
    I * invDet,
  ]);
}

export function applyHomography(H: ArrayLike<number>, x: number, y: number): { x: number; y: number } {
  const m = H as any;
  const X = m[0] * x + m[1] * y + m[2];
  const Y = m[3] * x + m[4] * y + m[5];
  const W = m[6] * x + m[7] * y + m[8];
  if (Math.abs(W) < 1e-12) return { x: Number.NaN, y: Number.NaN };
  return { x: X / W, y: Y / W };
}

