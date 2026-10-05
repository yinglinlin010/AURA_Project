import type {
  CabinNavigation,
  CabinRoute,
} from "../../../contracts/protocol/src/cabin.js";
export function distance(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180,
    lat = ((a[1] + b[1]) * rad) / 2;
  return (
    Math.hypot((b[0] - a[0]) * rad * Math.cos(lat), (b[1] - a[1]) * rad) *
    6371000
  );
}
export function lengths(route: CabinRoute): number[] {
  const result = [0];
  for (let i = 1; i < route.coordinates.length; i++)
    result.push(
      result[i - 1]! +
        distance(route.coordinates[i - 1]!, route.coordinates[i]!),
    );
  return result;
}
export function along(route: CabinRoute, meters: number): [number, number] {
  const cumulative = lengths(route),
    total = cumulative.at(-1) ?? 0,
    target =
      Math.min(1, Math.max(0, meters / Math.max(1, route.distanceMeters))) *
      total;
  for (let i = 1; i < cumulative.length; i++) {
    if (cumulative[i]! >= target) {
      const fraction =
        (target - cumulative[i - 1]!) /
        Math.max(0.001, cumulative[i]! - cumulative[i - 1]!);
      const a = route.coordinates[i - 1]!,
        b = route.coordinates[i]!;
      return [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
    }
  }
  return route.coordinates.at(-1)!;
}
export function project(
  route: CabinRoute,
  point: [number, number],
): { meters: number; offset: number } {
  const cumulative = lengths(route),
    cos = Math.cos((point[1] * Math.PI) / 180);
  let best = Infinity,
    progress = 0;
  for (let i = 1; i < route.coordinates.length; i++) {
    const a = route.coordinates[i - 1]!,
      b = route.coordinates[i]!,
      dx = (b[0] - a[0]) * cos,
      dy = b[1] - a[1],
      px = (point[0] - a[0]) * cos,
      py = point[1] - a[1];
    const t = Math.max(
      0,
      Math.min(1, (px * dx + py * dy) / Math.max(1e-18, dx * dx + dy * dy)),
    );
    const projected: [number, number] = [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
    ];
    const offset = distance(point, projected);
    if (offset < best) {
      best = offset;
      progress = cumulative[i - 1]! + (cumulative[i]! - cumulative[i - 1]!) * t;
    }
  }
  return {
    meters:
      (progress / Math.max(1, cumulative.at(-1) ?? 0)) * route.distanceMeters,
    offset: best,
  };
}
export function updateNavigation(
  nav: CabinNavigation,
  route: CabinRoute,
  meters: number,
  position: [number, number],
  now: number,
): CabinNavigation {
  const traveled = Math.min(route.distanceMeters, Math.max(0, meters)),
    remaining = Math.max(0, route.distanceMeters - traveled);
  const next = route.steps?.find(
    (step) => step.offsetMeters > traveled + 10 && step.type !== "depart",
  );
  return {
    ...nav,
    status: remaining <= 10 ? "arrived" : "active",
    position,
    traveledMeters: traveled,
    remainingMeters: remaining,
    remainingSeconds:
      route.durationSeconds * (remaining / Math.max(1, route.distanceMeters)),
    instruction:
      remaining <= 10
        ? "已抵達目的地"
        : next
          ? next.instruction
          : "沿規劃路線前進",
    nextManeuverMeters: next
      ? Math.max(0, next.offsetMeters - traveled)
      : remaining,
    updatedAt: now,
  };
}
