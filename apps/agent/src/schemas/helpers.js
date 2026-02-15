import { safeString } from "../utils.js";

export { safeString };

export function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, num));
}

export function isVector(value) {
  return (
    value &&
    typeof value === "object" &&
    Number.isFinite(Number(value.x)) &&
    Number.isFinite(Number(value.y)) &&
    Number.isFinite(Number(value.z))
  );
}

export function normalizeVector(value) {
  return {
    x: Number(value.x),
    y: Number(value.y),
    z: Number(value.z),
  };
}
