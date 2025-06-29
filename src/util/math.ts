import * as math from "mathjs";
import { Coordinate } from "./calcHomography";

export type LineSegment = {
  s: Coordinate;
  e: Coordinate;
};
export const LineSegment = (s: Coordinate, e: Coordinate): LineSegment => ({
  s,
  e,
});

export const arrayToMatrix = (a: number[], column: number): number[][] => {
  if (a.length % column !== 0) {
    throw new Error("invalid args");
  }
  const m = [];
  for (let i = 0; i < a.length / column; i++) {
    m.push(a.slice(i * column, (i + 1) * column));
  }
  return m;
};

export const affine = (p: Coordinate, matrix: number[]): Coordinate => {
  const posArray = [p.x, p.y, 1];
  const h = math.multiply(arrayToMatrix(matrix, 3), posArray);
  return {
    x: h[0] / h[2],
    y: h[1] / h[2],
  };
};

export const distance = (a: Coordinate, b: Coordinate): number =>
  Math.pow(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2), 0.5);

export const getSlope = (line: LineSegment) => {
  const { s, e } = line;
  return (e.y - s.y) / (e.x - s.x);
};
export const roundTheta = (theta: number) => {
  while (theta < 0) {
    theta += 2 * Math.PI;
  }
  while (theta > 2 * Math.PI) {
    theta -= 2 * Math.PI;
  }
  return theta;
};
export const getTheta = (line: LineSegment) => {
  const { s, e } = line;
  return (
    Math.atan(getSlope(line)) +
    (Number(s.x <= e.x) ^ Number(s.y <= e.y) ? Math.PI : 0) +
    (e.y < s.y ? Math.PI : 0)
  );
};

export const isSameValue = (a: number, b: number, buffer: number = 0) =>
  Math.abs(a - b) < buffer;
export const isSamePoint = (a: Coordinate, b: Coordinate, buffer: number = 0) =>
  isSameValue(a.x, b.x, buffer) && isSameValue(a.y, b.y, buffer);

export const aIsBetweenBnC = (a: number, b: number, c: number) =>
  b <= a && a <= c;
export const isOnLine = (p: Coordinate, line: LineSegment, buffer: number) => {
  const slope = getSlope(line);
  if (Infinity === slope) return isSameValue(p.x, line.s.x, buffer);
  return isSameValue(p.y, (p.x - line.s.x) * slope + line.s.y, buffer);
};
export const isOnLineSegment = (
  p: Coordinate,
  line: LineSegment,
  buffer: number
) =>
  isOnLine(p, line, buffer) &&
  (aIsBetweenBnC(p.x, line.s.x, line.e.x) ||
    aIsBetweenBnC(p.x, line.e.x, line.s.x));

export const getCentroid = (ps: Coordinate[]) =>
  ps.reduce(
    (a, p) => ({
      x: p.x / ps.length + a.x,
      y: p.y / ps.length + a.y,
    }),
    { x: 0, y: 0 }
  );
export const getCrossPoint = (
  a: LineSegment,
  b: LineSegment
): Coordinate | null => {
  const xA = a.s.x;
  const yA = a.s.y;
  const xB = a.e.x;
  const yB = a.e.y;
  const xC = b.s.x;
  const yC = b.s.y;
  const xD = b.e.x;
  const yD = b.e.y;
  const a1 = yA - yB,
    a2 = yC - yD,
    b1 = xB - xA,
    b2 = xD - xC,
    c1 = xA * (yB - yA) - yA * (xB - xA),
    c2 = xC * (yD - yC) - yC * (xD - xC);

  if (a1 * b2 == a2 * b1) return null;

  return {
    x: (c2 * b1 - c1 * b2) / (a1 * b2 - a2 * b1),
    y: (c2 * a1 - c1 * a2) / (b1 * a2 - b2 * a1),
  };
};

export const addCordinate = (a: Coordinate, b: Coordinate): Coordinate => ({
  x: a.x + b.x,
  y: a.y + b.y,
});