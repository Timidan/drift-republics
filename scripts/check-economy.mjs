// One three-house HTTP lifecycle, plus transaction rollback / replay / ownership checks.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createGameServer } from "../server/main.ts";
import { guideSteps } from "../src/guides.ts";

const dataDir = await mkdtemp(join(tmpdir(), "drift-economy-check-"));
const invite = randomBytes(16).toString("hex");
const password = randomBytes(24).toString("hex");
let clock = Date.now(), app, base;
async function start() {
  app = createGameServer({ dataDir, invite, now: () => clock, tick: false });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  base = "http://127.0.0.1:" + app.server.address().port;
}
async function request(client, path, body, expected = 200) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:4186", ...(client.cookie ? { Cookie: client.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  const cookie = response.headers.get("set-cookie");
  if (cookie) client.cookie = cookie.split(";")[0];
  if (result.me) client.state = result;
  return result;
}
const act = (client, command, key = randomUUID(), expected = 200) => request(client, "/api/command", { key, command }, expected);
const state = client => request(client, "/api/state");
async function sail(client, port) {
  const quote = await request(client, "/api/quote", { port, route: "sail" });
  await act(client, { action: "voyage", port, route: "sail" });
  clock = quote.arriveAt + 100;
  await state(client);
  assert.equal(client.state.ships[client.state.me.selectedShip].port, port);
}
try {
  await start();
  const producer = {}, hauler = {}, shipwright = {};
  for (const [client, name, home, workshop] of [
    [producer, "Kelp House", "reedhaven", "refinery"],
    [hauler, "Cargo House", "reedhaven", "foundry"],
    [shipwright, "Rig House", "bastion", "shipyard"],
  ]) await request(client, "/api/register", { name, password, invite, home, workshop }, 201);
  await request({}, "/api/state", undefined, 401);
  for (const [client, recipe, batches] of [[producer, "fuel", 6], [hauler, "plates", 2], [shipwright, "cargoModule", 1]]) {
    await act(client, {
      action: "craft", workshop: client.state.workshops.find(w => w.owner === client.state.me.id).id,
      recipe, batches, look: { hull: "#a63f32", sail: "#f4e8cf" },
    });
  }
  clock += 270_001;
  await state(shipwright);
  const rig = Object.values(shipwright.state.items).find(i => i.owner === shipwright.state.me.id);
  assert.equal(rig.kind, "cargoModule");
  await act(shipwright, { action: "listItem", item: rig.id, price: 120 });
  const listing = shipwright.state.listings.find(l => l.item === rig.id);
  await act(hauler, { action: "counterListing", listing: listing.id, price: 80 });
  await act(shipwright, { action: "acceptCounter", listing: listing.id, buyer: hauler.state.me.id });
  await sail(hauler, "bastion");
  await act(hauler, { action: "install", item: rig.id });
  const vessel = hauler.state.ships[hauler.state.me.selectedShip];
  assert.equal(vessel.modules.cargoModule, rig.id);
  assert.equal(vessel.look.hull, "#a63f32", "owned fitting changes the authoritative appearance");
  await act(shipwright, { action: "requestDelivery", port: "bastion", good: "fuel", quantity: 14, price: 140, minutes: 10 });
  const delivery = shipwright.state.deliveries.at(-1);
  await act(producer, { action: "supplyDelivery", delivery: delivery.id, port: "reedhaven", fee: 30 });
  await sail(hauler, "reedhaven");
  await act(hauler, { action: "takeHaul", delivery: delivery.id });
  assert.equal(hauler.state.ships[vessel.id].deliveries.length, 1, "14-unit load fits after the upgrade");
  const voyageKey = randomUUID();
  const voyage = { action: "voyage", port: "bastion", route: "sail" };
  await act(hauler, { ...voyage, berth: hauler.state.ports.bastion.berth + 1 }, randomUUID(), 400);
  await act(hauler, voyage, voyageKey);
  clock = hauler.state.ships[vessel.id].voyage.arriveAt + 1;
  await state(hauler);
  assert.equal(hauler.state.deliveries.find(d => d.id === delivery.id).status, "delivered");
  await state(producer); await state(shipwright);
  assert.equal(shipwright.state.me.warehouse.bastion.fuel, 16);
  assert.equal(producer.state.me.marks, 691);
  assert.equal(hauler.state.me.marks, 540);
  assert.equal(shipwright.state.me.marks, 534);
  const civicFunds = Object.values(shipwright.state.civicAccounts).reduce((n, city) => n + city.funds, 0);
  const civicEscrow = shipwright.state.deliveries.filter(d => d.civic && !['delivered', 'cancelled'].includes(d.status)).reduce((n, d) => n + d.price, 0);
  assert.equal(producer.state.me.marks + hauler.state.me.marks + shipwright.state.me.marks + civicFunds + civicEscrow, 9300, "fees circulate to cities; trade conserves all house and charter funds including civic reservations");
  await act(hauler, voyage, voyageKey);
  assert.equal(hauler.state.ships[vessel.id].voyage, null, "retry cannot start or pay the completed voyage twice");
  await act(producer, { action: "install", item: rig.id }, randomUUID(), 403);

  // A late missing recipe input must roll back earlier input deductions in the same SQLite transaction.
  await act(hauler, { action: "listGoods", good: "plates", quantity: 3, price: 9 }, randomUUID(), 400);
  await sail(hauler, "reedhaven");
  await act(hauler, { action: "listGoods", good: "plates", quantity: 3, price: 9 });
  await act(shipwright, { action: "buyListing", listing: hauler.state.listings.find(l => l.good === "plates").id });
  await sail(shipwright, "reedhaven");
  await act(shipwright, { action: "cargo", direction: "load", good: "plates", quantity: 3 });
  await sail(shipwright, "bastion");
  await act(shipwright, { action: "cargo", direction: "unload", good: "plates", quantity: 3 });
  const before = { ...shipwright.state.me.warehouse.bastion };
  const workshop = shipwright.state.workshops.find(w => w.owner === shipwright.state.me.id);
  await act(shipwright, { action: "craft", workshop: workshop.id, recipe: "cargoModule", batches: 1 }, randomUUID(), 400);
  await state(shipwright);
  assert.deepEqual(shipwright.state.me.warehouse.bastion, before);

  // The same three-house supply chain must also launch a usable second vessel.
  await act(hauler, { action: "craft", workshop: hauler.state.workshops.find(w => w.owner === hauler.state.me.id).id, recipe: "plates", batches: 1 });
  await act(shipwright, { action: "extract", port: "bastion", quantity: 4 });
  clock += 75_001; await state(hauler);
  await act(hauler, { action: "listGoods", good: "plates", quantity: 3, price: 9 });
  await act(shipwright, { action: "buyListing", listing: hauler.state.listings.find(l => l.good === "plates").id });
  await sail(shipwright, "reedhaven");
  await act(shipwright, { action: "cargo", direction: "load", good: "plates", quantity: 3 });
  await sail(shipwright, "bastion");
  await act(shipwright, { action: "cargo", direction: "unload", good: "plates", quantity: 3 });
  await act(shipwright, { action: "buildShip", name: "Trade Wind" });
  clock += 60_001; await state(shipwright);
  const fleet = Object.values(shipwright.state.ships).filter(s => s.owner === shipwright.state.me.id);
  assert.equal(fleet.length, 2);
  assert.equal(shipwright.state.me.warehouse.bastion.timber, 0);
  assert.equal(shipwright.state.me.warehouse.bastion.plates, 0);
  await act(shipwright, { action: "selectShip", ship: fleet.find(s => s.name === "Trade Wind").id });

  const oldRoute = await request(producer, "/api/quote", { port: "bastion", route: "sail" });
  await act(shipwright, { action: "contribute", port: "bastion", quantity: 4 });
  await act(shipwright, { action: "requestDelivery", port: "bastion", good: "timber", quantity: 1, price: 1, minutes: 10 });
  const pending = shipwright.state.deliveries.at(-1);
  await act(shipwright, { action: "moveCity", port: "bastion", anchorage: "scrap" });
  assert.ok(shipwright.state.ports.bastion.move.departAt > pending.deadline, "relocation protects existing delivery deadlines");
  const deadline = pending.deadline;
  await app.close();
  clock += 20_000;
  await start();
  await state(shipwright);
  assert.equal(shipwright.state.deliveries.find(d => d.id === pending.id).deadline, deadline + 20_000, "service downtime extends the pending delivery");
  assert.equal(shipwright.state.items[rig.id].owner, hauler.state.me.id, "ownership survives restart");
  assert.equal(shipwright.state.ships[vessel.id].modules.cargoModule, rig.id, "installed equipment survives restart");
  clock = shipwright.state.ports.bastion.move.arriveAt + 1;
  await state(shipwright);
  assert.equal(shipwright.state.ports.bastion.x, 300);
  const newRoute = await request(producer, "/api/quote", { port: "bastion", route: "sail" });
  assert.ok(newRoute.distance > oldRoute.distance, "moving toward scrap lengthens the fuel supply route");
  const practice = {};
  await request(practice, "/api/practice", {}, 201);
  assert.equal(practice.state.practice, true);
  assert.equal(practice.state.me.marks, 600);
  assert.equal(guideSteps("wallet", practice.state, null)[1].target, "wallet", "wallet lesson opens wallet details");
  assert.equal(guideSteps("trade", practice.state, null)[0].status, "Practice delivery: Needs supplies.");
  await act(practice, { action: "supplyDelivery", delivery: "practice-timber", port: "reedhaven", fee: 0 });
  await act(practice, { action: "takeHaul", delivery: "practice-timber" });
  await sail(practice, "bastion");
  assert.equal(practice.state.me.marks, 712);
  assert.equal(practice.state.workshops.find(w => w.owner === "harbor-office").job.recipe, "cargoModule", "practice delivery starts real construction");
  clock += 90_001; await state(practice);
  assert.ok(practice.state.ships[practice.state.players["harbor-office"].selectedShip].modules.cargoModule, "practice construction produces an installed rig");
  await state(producer);
  assert.equal(producer.state.practice, false);
  await state(hauler); await state(shipwright);
  const sharedMarks = [producer,hauler,shipwright].reduce((n,c)=>n+c.state.me.marks,0) + Object.values(producer.state.civicAccounts).reduce((n,c)=>n+c.funds,0) +
    producer.state.deliveries.filter(d=>!['delivered','cancelled'].includes(d.status)).reduce((n,d)=>n+d.price,0) + (producer.state.builds??[]).filter(b=>!b.launched).reduce((n,b)=>n+b.price,0);
  assert.equal(sharedMarks, 3*600+3*2500, "practice did not mint shared money; civic upkeep only transfers it");
  // Account recovery preserves the house and consumes each code exactly once.
  const formerSession = { cookie: producer.cookie }, originalHouse = producer.state.me.id;
  const firstCode = (await request(producer, "/api/account/recovery", { password })).recoveryCode;
  const nextPassword = randomBytes(24).toString("hex");
  const changed = await request(producer, "/api/account/password", { password, nextPassword });
  await request(formerSession, "/api/state", undefined, 401);
  await request({}, "/api/account/recover", { name: "Kelp House", code: firstCode, password }, 401);
  const recovered = {};
  const result = await request(recovered, "/api/account/recover", { name: "Kelp House", code: changed.recoveryCode, password });
  assert.equal(result.me.id, originalHouse);
  assert.notEqual(result.recoveryCode, changed.recoveryCode);
  await request(producer, "/api/state", undefined, 401);
  await request({}, "/api/account/recover", { name: "Kelp House", code: changed.recoveryCode, password }, 401);
  await request({}, "/api/login", { name: "Kelp House", password: nextPassword }, 401);
  await request(producer, "/api/login", { name: "Kelp House", password });
  assert.equal(producer.state.me.id, originalHouse);
  // A trusted proxy gives each visitor a budget; direct clients cannot spoof one.
  const previousTrust = process.env.DRIFT_TRUST_PROXY;
  try {
    for (const trusted of [true, false]) {
      await app.close();
      process.env.DRIFT_TRUST_PROXY = trusted ? "1" : "0";
      await start();
      const attempt = async ip => (await fetch(base + "/api/login", {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:4186", "X-Forwarded-For": ip }, body: "{}",
      })).status;
      for (let i = 0; i < 30; i++) assert.equal(await attempt("198.51.100.1"), 400);
      assert.equal(await attempt("198.51.100.1"), 429);
      assert.equal(await attempt("198.51.100.2"), trusted ? 400 : 429);
    }
  } finally {
    if (previousTrust === undefined) delete process.env.DRIFT_TRUST_PROXY;
    else process.env.DRIFT_TRUST_PROXY = previousTrust;
  }
  console.log("economy checks passed: craft/trade/equip/haul, second vessel, rollback, restart, relocation, practice isolation, password/recovery rotation and session revocation");
} finally {
  await app?.close();
  await rm(dataDir, { recursive: true, force: true });
}
