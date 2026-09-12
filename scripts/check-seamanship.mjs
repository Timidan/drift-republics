// One voyage-and-shipbuilding scenario; economic trade/replay coverage lives in check-economy.
import assert from 'node:assert/strict';
import { createWorld, addPlayer, advanceWorld, command, cargoWeight, capacity, newSeamanship, sailingForces, sailingPath, SEA_SITES, canRemoveRig } from '../src/economy.ts';
import { HULLS, sailPower, weatherAt, stepBoat, depthAt } from '../src/boat.ts';
let now = 1_800_000_000_000, w = createWorld(now);
addPlayer(w, 'captain', 'Harbor Check', 'reedhaven', 'shipyard', now);
addPlayer(w, 'guest', 'Crew Check', 'reedhaven', 'foundry', now);
const shipId = w.players.captain.selectedShip;
const ship = () => w.ships[shipId];
function act(player, action) {
  const next = structuredClone(w); command(next, player, action, now); w = JSON.parse(JSON.stringify(next));
}
const tick = seconds => { now += seconds * 1000; advanceWorld(w, now); };
// Explicit fixture stock lets this check concentrate on the new mechanics.
w.players.captain.warehouse.reedhaven = { timber: 40, plates: 30, fuel: 15, repairKit: 3, kelp: 12 };
ship().sea = newSeamanship();
act('captain', { action: 'fitGear', gear: 'fishing' });
act('captain', { action: 'cargo', good: 'timber', quantity: 4, direction: 'load' });
act('captain', { action: 'cargo', good: 'repairKit', quantity: 1, direction: 'load' });
act('captain', { action: 'balanceCargo', balance: 1 });
assert.equal(ship().sea.secured, false);
assert.equal(cargoWeight(w, ship()), 4.5);
assert(sailingForces(w, ship(), now).draft > HULLS.cutter.draft);
const deepRoute = sailingPath(w, { x: -270, z: -590 }, { x: -80, z: -230 }, 1.7);
for (let i = 1; i < deepRoute.length; i++) for (let t = 0; t <= 1; t += .02) {
  const a = deepRoute[i - 1], b = deepRoute[i];
  assert(depthAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) >= 1.7, 'charted routes avoid water shallower than the loaded draft');
}
act('captain', { action: 'secureCargo' });
assert.equal(ship().sea.secured, true);
const unchanged = structuredClone(w);
assert.throws(() => act('captain', { action: 'cargo', good: 'plates', quantity: 10, direction: 'load' }), /deck space/);
assert.deepEqual(w, unchanged, 'rejected loading changes neither stock nor cargo');
const wind = weatherAt(now);
assert(sailPower(wind.heading, wind, -1, 1) > 0.5);
assert.equal(sailPower(wind.heading + Math.PI, wind, -1, 1), 0, 'a sail cannot drive directly upwind');
const light = { x: 0, z: 0, speed: 0, heading: 0 }, heavy = { ...light };
for (let i = 0; i < 20; i++) {
  stepBoat(light, { throttle: 1, steer: 0 }, 0.1, [], 90, HULLS.cutter.speed, { drive: 1, mass: 1, currentX: 0, currentZ: 0, anchored: false });
  stepBoat(heavy, { throttle: 1, steer: 0 }, 0.1, [], 90, HULLS.cutter.speed, { drive: 1, mass: 2, currentX: 0, currentZ: 0, anchored: false });
}
assert(light.speed > heavy.speed && light.z > heavy.z, 'cargo inertia changes acceleration');
const workshop = w.workshops.find(v => v.owner === 'captain');
act('captain', { action: 'craft', workshop: workshop.id, recipe: 'engine', batches: 1 });
act('captain', { action: 'craft', workshop: workshop.id, recipe: 'repairKit', batches: 1 });
tick(166);
assert.equal(w.workshops.find(v => v.id === workshop.id).job, null, 'queued jobs complete across an offline interval');
const engine = Object.values(w.items).find(i => i.kind === 'engine');
act('captain', { action: 'install', item: engine.id });
act('captain', { action: 'refuel', quantity: 1 });
act('captain', { action: 'sails', trim: -1, reef: 0, engine: 'on' });
Object.assign(ship(), { x: 0, z: -750, heading: 0, port: null });
for (let i = 0; i < 170; i++) { if (i % 10 === 0) act('captain', { action: 'steer', throttle: 1, steer: 0 }); tick(0.1); }
assert.equal(ship().fuel, 0, 'manual engine drive burns tank fuel');
const site = SEA_SITES[0];
Object.assign(ship(), { x: site.x, z: site.z, speed: 0, nav: null });
act('captain', { action: 'anchor' });
act('captain', { action: 'explore', site: site.id });
assert.equal(ship().cargo.fish, 3);
assert.throws(() => act('captain', { action: 'explore', site: site.id }), /replenish/);
act('captain', { action: 'anchor' });
// Three hard contacts with the same charted stack make a leak; a real kit repairs it.
for (let i = 0; i < 3; i++) {
  Object.assign(ship(), { x: 260, z: -336.5, speed: 6, heading: 0 }); tick(1.5);
}
assert(ship().sea.integrity < 60, 'hard collision damages the hull');
act('captain', { action: 'steer', throttle: 1, steer: 0 }); tick(0.1);
assert(ship().sea.flooding > 0, 'damaged underway hull takes water');
act('captain', { action: 'bail' });
assert.equal(ship().sea.flooding, 0);
const damaged = ship().sea.integrity;
act('captain', { action: 'repair' });
assert(ship().sea.integrity > damaged);
act('captain', { action: 'recover', port: 'reedhaven' });
assert.equal(ship().voyage.tow, true);
now = ship().voyage.arriveAt + 1; advanceWorld(w, now);
assert.equal(ship().port, 'reedhaven'); assert.equal(ship().cargo.fish, 3);
act('captain', { action: 'openCrew' });
act('guest', { action: 'joinCrew', target: shipId });
assert.equal(w.players.guest.selectedShip, shipId);
assert.throws(() => act('guest', { action: 'cargo', good: 'fish', quantity: 1, direction: 'unload' }), /only the captain/);
act('guest', { action: 'cargo', good: 'timber', quantity: 2, direction: 'load' });
act('guest', { action: 'secureCargo' }); act('guest', { action: 'leaveCrew' });
act('captain', { action: 'commissionShip', builder: 'captain', hull: 'lighter', name: 'Shoal Runner', price: 20 });
const buildId = w.builds.at(-1).id;
act('guest', { action: 'contributeBuild', build: buildId, good: 'timber', quantity: 2 });
for (const [good, quantity] of Object.entries({ timber: 6, plates: 3, fuel: 2 })) act('captain', { action: 'contributeBuild', build: buildId, good, quantity });
assert(w.builds.at(-1).readyAt && !w.builds.at(-1).launched); tick(61);
const lighter = w.ships[w.builds.at(-1).launched];
assert.equal(capacity(w, lighter), 8); assert.equal(lighter.maker, 'captain');
lighter.cargo.plates = 7; assert.equal(canRemoveRig(w, lighter), false, 'light hull weight governs both fitting removal paths');
act('captain', { action: 'customize', pattern: 'striped', material: 'copper', cabin: 'flat', railing: 'rope', flag: 'square', figurehead: 'gull', lamps: 'on' });
assert.equal(ship().sea.finish.figurehead, 'gull');
console.log('Seamanship checks passed: wind/inertia, loading, queued production, fuel, fishing, collision/leak/repair/tow, guest permissions, commissioned hull and cosmetics.');
