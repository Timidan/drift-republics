// Small runnable check for the real boat controller (node scripts/check-boat.mjs).
import assert from "node:assert/strict";
import { BOAT, isClear, stepBoat } from "../src/boat.ts";

const dt = 1 / 60;
const world = 500;

// 1. Full throttle from rest: moves along its heading (+Z) with a bounded top speed.
const s = { x: 0, z: 0, heading: 0, speed: 0 };
for (let i = 0; i < 600; i++) stepBoat(s, { throttle: 1, steer: 0 }, dt, [], world);
assert.ok(s.z > 20 && Math.abs(s.x) < 1e-6, "should travel along +Z");
assert.ok(s.speed <= BOAT.maxSpeed && s.speed > BOAT.maxSpeed * 0.95, "should sit at bounded max speed");
assert.ok(s.z > 150, "a cutter should cover at least 150 m in ten seconds at full throttle");

// 2. A wall dead ahead blocks the move: boat never enters it, reports blocked, ends stopped.
const wall = { x: 0, z: 12, hx: 3, hz: 1, r: 0.5 };
const b = { x: 0, z: 0, heading: 0, speed: 0 };
let blocked = false;
for (let i = 0; i < 600; i++) {
  blocked = stepBoat(b, { throttle: 1, steer: 0 }, dt, [wall], world) || blocked;
  assert.ok(isClear(b.x, b.z, [wall], world), "boat must stay outside the obstacle");
}
assert.ok(blocked, "should report the blocked move");
assert.ok(b.z <= 12 - 1 - 0.5 - BOAT.radius + 1e-6 && b.z > 5, "should stop right in front of the wall");
assert.equal(b.speed, 0, "should be stopped");

console.log("boat checks passed");
