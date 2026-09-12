import { SHOALS } from "./region.ts";
export { SHOALS } from "./region.ts";
// Pure boat movement + collision logic. No Babylon imports so Node can run it directly.
// Heading is radians around +Y; forward = (sin heading, cos heading) in XZ (Babylon left-handed).

export interface BoatState {
  x: number;
  z: number;
  heading: number;
  speed: number; // metres per second, negative when reversing
}

export interface BoatInput {
  throttle: number; // -1 .. 1
  steer: number; // -1 (port) .. 1 (starboard)
}

export const HULLS = {
  cutter: { name: "Merchant cutter", hold: 12, tonnes: 20, speed: 18, mass: 1, draft: 0.8, timber: 12, plates: 6 },
  lighter: { name: "Reed lighter", hold: 8, tonnes: 12, speed: 22, mass: 0.7, draft: 0.45, timber: 8, plates: 3 },
  barge: { name: "Freight barge", hold: 24, tonnes: 40, speed: 14, mass: 1.8, draft: 1.15, timber: 20, plates: 10 },
} as const;
export type HullKind = keyof typeof HULLS;
export interface SailingForces { drive: number; mass: number; currentX: number; currentZ: number; anchored: boolean }

/** Shared deterministic weather: a ten-minute cycle, with a forecast from the same clock. */
export function weatherAt(now: number) {
  const phase = (now / 1000 % 600) / 600;
  return { heading: wrapAngle(0.8 + Math.sin(phase * Math.PI * 2) * 0.65),
    strength: 0.8 + Math.sin(phase * Math.PI * 2 + 1) * 0.35,
    sea: phase > 0.65 && phase < 0.85 ? 1.8 : 1,
    fog: phase > 0.35 && phase < 0.5, name: phase > 0.65 && phase < 0.85 ? "Squall" : phase > 0.35 && phase < 0.5 ? "Sea fog" : "Trade wind" };
}
export function sailPower(heading: number, wind: ReturnType<typeof weatherAt>, trim: number, reef: number): number {
  const angle = Math.abs(wrapAngle(heading - wind.heading)); // wind travels toward its heading
  const optimum = angle * 90 / Math.PI;
  const trimEfficiency = trim < 0 ? 1 : Math.max(0.15, 1 - Math.abs(trim - optimum) / 80);
  return Math.max(0, Math.cos(angle / 2) - 0.22) * 1.3 * wind.strength * trimEfficiency * reef;
}
export function depthAt(x: number, z: number): number {
  return SHOALS.reduce((depth, s) => Math.min(depth, s.depth + Math.max(0, Math.hypot(x - s.x, z - s.z) - s.radius) * 0.045), 12);
}

/** Rounded box on the XZ plane: half extents hx/hz plus corner radius r (hx = hz = 0 gives a circle). */
export interface Obstacle {
  x: number;
  z: number;
  hx: number;
  hz: number;
  r: number;
}

export const BOAT = {
  maxSpeed: HULLS.cutter.speed,
  maxReverse: 4,
  accel: 12,
  brake: 14,
  drag: 1.4,
  turnRate: 1.4,
  radius: 2.3,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Signed distance from point to the obstacle surface (negative when inside). */
export function obstacleDistance(x: number, z: number, o: Obstacle): number {
  const dx = Math.max(Math.abs(x - o.x) - o.hx, 0);
  const dz = Math.max(Math.abs(z - o.z) - o.hz, 0);
  return Math.hypot(dx, dz) - o.r;
}

/** True when the hull circle at (x, z) is clear of every obstacle and inside the world. */
export function isClear(x: number, z: number, obstacles: readonly Obstacle[], worldRadius: number): boolean {
  if (Math.hypot(x, z) > worldRadius - BOAT.radius) return false;
  return obstacles.every((o) => obstacleDistance(x, z, o) >= BOAT.radius);
}

function moveAllowed(s: BoatState, nx: number, nz: number, obstacles: readonly Obstacle[], worldRadius: number): boolean {
  const limit = worldRadius - BOAT.radius;
  if (Math.hypot(nx, nz) > limit && Math.hypot(nx, nz) > Math.hypot(s.x, s.z)) return false;
  for (const o of obstacles) {
    const after = obstacleDistance(nx, nz, o) - BOAT.radius;
    // A move is illegal only if it ends inside an obstacle *and* goes deeper than we already are
    // (so a boat overrun by the drifting harbor can still back out).
    if (after < 0 && after < obstacleDistance(s.x, s.z, o) - BOAT.radius - 1e-6) return false;
  }
  return true;
}

/**
 * Advance the boat by dt seconds. Mutates `state`. Returns true when the intended move was blocked
 * by an obstacle or the world edge (the boat may still have slid along it).
 */
export function stepBoat(
  state: BoatState,
  input: BoatInput,
  dt: number,
  obstacles: readonly Obstacle[],
  worldRadius: number,
  maxSpeed: number = BOAT.maxSpeed,
  forces?: SailingForces,
): boolean {
  dt = clamp(dt, 0, 0.1);
  const throttle = clamp(input.throttle, -1, 1);
  const steer = clamp(input.steer, -1, 1);
  if (forces?.anchored) { state.speed = 0; return false; }
  const mass = forces?.mass ?? 1;

  // Speed: accelerate, brake against motion, or coast with drag.
  let v = state.speed;
  if (throttle > 0) v += (v < 0 ? BOAT.brake : BOAT.accel * (forces?.drive ?? 1)) * throttle * dt / mass;
  else if (throttle < 0) v += (v > 0 ? BOAT.brake : BOAT.accel * 0.35) * throttle * dt / mass;
  else v -= Math.sign(v) * Math.min(Math.abs(v), (forces ? 0.3 : BOAT.drag) * dt / mass);
  if (forces) v -= v * (0.06 + Math.abs(steer) * 0.15) * dt;
  const limit = maxSpeed * (forces ? Math.max(0.12, Math.min(1.5, forces.drive)) : 1);
  v = clamp(v, -BOAT.maxReverse / Math.sqrt(mass), Math.max(limit, state.speed - dt * 1.5));

  // Turning is smooth and depends on way through the water (a little rudder authority even at rest).
  const authority = 0.25 + 0.75 * Math.min(1, Math.abs(v) / (BOAT.maxSpeed * 0.5));
  state.heading = wrapAngle(state.heading + steer * BOAT.turnRate * authority * dt / Math.sqrt(mass));

  if (v === 0 && !forces) {
    state.speed = 0;
    return false; // not moving, nothing to block
  }
  const dx = (Math.sin(state.heading) * v + (forces?.currentX ?? 0)) * dt;
  const dz = (Math.cos(state.heading) * v + (forces?.currentZ ?? 0)) * dt;
  const candidates: [number, number][] = [
    [dx, dz],
    [dx, 0],
    [0, dz],
  ];
  let applied = -1;
  for (let i = 0; i < candidates.length; i++) {
    const [cx, cz] = candidates[i];
    if (cx === 0 && cz === 0) continue; // a zero slide is not progress
    if (moveAllowed(state, state.x + cx, state.z + cz, obstacles, worldRadius)) {
      state.x += cx;
      state.z += cz;
      applied = i;
      break;
    }
  }
  if (applied === -1) v = 0; // stopped dead against something
  else if (applied > 0) v *= 0.7; // scraping along something
  state.speed = v;
  return applied !== 0;
}

/** Simple steer-toward-target autopilot. Returns the input to apply and whether the boat has arrived. */
export function navigationInput(state: BoatState, tx: number, tz: number, maxSpeed: number = BOAT.maxSpeed): { input: BoatInput; arrived: boolean } {
  const dx = tx - state.x;
  const dz = tz - state.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 2.2) {
    return { input: { throttle: state.speed > 0.3 ? -1 : 0, steer: 0 }, arrived: true };
  }
  const diff = wrapAngle(Math.atan2(dx, dz) - state.heading);
  const steer = clamp(diff * 1.8, -1, 1);
  const targetSpeed = Math.min(maxSpeed, 0.6 + dist * 0.7) * (Math.abs(diff) > 1 ? 0.35 : 1);
  const throttle = clamp((targetSpeed - state.speed) * 1.5, -1, 1);
  return { input: { throttle, steer }, arrived: false };
}
