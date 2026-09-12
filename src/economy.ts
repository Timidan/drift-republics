import { BOAT, HULLS, depthAt, weatherAt, sailPower, wrapAngle, isClear, navigationInput, stepBoat, type BoatState, type Obstacle, type HullKind } from "./boat.ts";
import type { Settlement } from "./settlement.ts";
import { WORLD_RADIUS, REGION_VERSION, PORT_SITES, ANCHORAGES, REGION_OBSTACLES, SEA_SITES, LANTERN_BUOYS, CITY_DISTRICTS } from "./region.ts";
export { SEA_SITES, WORLD_RADIUS, CITY_STYLE, ANCHORAGES } from "./region.ts";

export const PORT_IDS = ["reedhaven", "ironwake", "bastion"] as const;
export type PortId = typeof PORT_IDS[number];
export const GOOD_IDS = ["kelp", "timber", "scrap", "fuel", "plates", "repairKit", "fish", "ammunition"] as const;
export type Good = typeof GOOD_IDS[number];
export type Stock = Partial<Record<Good, number>>;
export type ItemKind = "cargoModule" | "engine" | "livery";
export type WorkshopKind = "refinery" | "foundry" | "shipyard";
export type RouteKind = "sail" | "powered" | "hazard";
export interface Point { x: number; z: number }
export interface Look { hull: string; sail: string }
export const DEFAULT_LOOK: Look = { hull: "#244e73", sail: "#f4e8cf" };
export const GOOD_NAMES: Record<Good | ItemKind, string> = {
  kelp: "Kelp", timber: "Timber", scrap: "Scrap", fuel: "Fuel", plates: "Plates",
  repairKit: "Repair kits", cargoModule: "Cargo rig", engine: "Engine", livery: "Livery kit",
  fish: "Fish", ammunition: "Shot crates",
};
export const GOOD_WEIGHT: Record<Good, number> = { kelp: 0.5, timber: 1, scrap: 1.5, fuel: 0.75, plates: 2, repairKit: 0.5, fish: 0.5, ammunition: 0.5 };
export const WAREHOUSE_LIMIT = 240;
export interface Seamanship {
  hull: HullKind; trim: number; reef: number; engine: boolean; anchor: boolean; secured: boolean; balance: number;
  integrity: number; flooding: number; fittingWear?: number; fuelUsed: number; lastHit: number; lastBail: number;
  refits?: string[]; gear: string[]; crew: string[]; openCrew: boolean; discovered: string[]; catches: Record<string, number>;
  work: { kind: string; start: number; until: number } | null;
  finish: { pattern: string; material: string; cabin: string; railing: string; flag: string; figurehead: string; lamps: boolean };
}
export function newSeamanship(hull: HullKind = "cutter"): Seamanship {
  return { hull, trim: -1, reef: 1, engine: false, anchor: false, secured: true, balance: 0, integrity: 100, flooding: 0,
    fuelUsed: 0, lastHit: 0, lastBail: 0, refits: [], gear: [], crew: [], openCrew: false, discovered: [], catches: {}, work: null,
    fittingWear: 0, finish: { pattern: "crest", material: "enamel", cabin: "copper", railing: "brass", flag: "swallowtail", figurehead: "none", lamps: true } };
}
export const RECIPES: Record<string, { name: string; workshop: WorkshopKind; inputs: Stock; output: Good | ItemKind; quantity: number; seconds: number; components?: number; tier?: 2 }> = {
  fuel: { name: "Refine fuel", workshop: "refinery", inputs: { kelp: 3 }, output: "fuel", quantity: 2, seconds: 45 },
  plates: { name: "Forge plates", workshop: "foundry", inputs: { scrap: 3, fuel: 1 }, output: "plates", quantity: 2, seconds: 75 },
  repairKit: { name: "Make repair kits", workshop: "shipyard", inputs: { timber: 1, plates: 1 }, output: "repairKit", quantity: 2, seconds: 45 },
  engine: { name: "Build engine", workshop: "shipyard", inputs: { plates: 4, timber: 2, fuel: 1 }, output: "engine", quantity: 1, seconds: 120 },
  cargoModule: { name: "Build cargo rig", workshop: "shipyard", inputs: { plates: 3, timber: 4, repairKit: 1 }, output: "cargoModule", quantity: 1, seconds: 90 },
  livery: { name: "Mix a livery kit", workshop: "refinery", inputs: { kelp: 2, fuel: 1 }, output: "livery", quantity: 1, seconds: 60 },
  provisions: { name: "Render fish oil", workshop: "refinery", inputs: { fish: 3 }, output: "fuel", quantity: 2, seconds: 35 },
  ammunition: { name: "Cast shot crates", workshop: "foundry", inputs: { scrap: 2, fuel: 1 }, output: "ammunition", quantity: 6, seconds: 40 },
  reinforcedRig: { name: "Forge a reinforced cargo rig", workshop: "shipyard", inputs: { plates: 2, timber: 2 }, output: "cargoModule", quantity: 1, seconds: 90, components: 2, tier: 2 },
};
export const ANNEX_INPUTS: Stock = { timber: 12, plates: 6, fuel: 4 };
export const OUTPOST_INPUTS: Stock = { timber: 8, plates: 4, fuel: 2 };
export const FRONTIER_SITES = [
  { id: "corsair", name: "Corsair's Rest", x: 80, z: -380 },
  { id: "west-watch", name: "Westwatch Anchorage", x: -300, z: -60 },
  { id: "east-watch", name: "Emberwatch Anchorage", x: 380, z: 150 },
] as const;
export interface Outpost extends Point {
  id: string; name: string; owner: string | null; stock: Stock; fortification: number;
  builtAt: number; protectedUntil: number; refillAt: number;
}
export interface Raid {
  id: string; target: string; attacker: string; ship: string; startAt: number; endAt: number;
  attack: number; defense: number; barrage: boolean; status: "fighting" | "won" | "repelled";
  loot: Stock; damage: number;
}
export interface Build {
  id: string; buyer: string; builder: string; port: PortId; hull: HullKind; name: string; price: number;
  stock: Stock; accepted?: boolean; contributions: { player: string; good: Good; quantity: number }[];
  readyAt: number | null; launched: string | null; cancelled?: boolean; expiresAt?: number;
  finance?: { principal: number; repayment: number; lender: string | null; status: "requested" | "funded" | "repaid" | "defaulted"; debt: number };
}
export interface Port extends Point {
  id: PortId; name: string; berth: number; steward: string | null;
  treasury: Stock; votes: Record<string, string>;
  civic?: { prosperity: number; consumed: number; nextAt: number; priority: "homes" | "industry" | "harbor";
    annex?: { stock: Stock; completedAt: number | null; maintained: boolean } };
  move: { from: Point; to: Point; departAt: number; arriveAt: number } | null;
}
export interface Workshop {
  id: string; owner: string; port: PortId; kind: WorkshopKind;
  job: { recipe: string; batches: number; readyAt: number; look: Look } | null;
  queue?: NonNullable<Workshop["job"]>[];
}
export interface Voyage {
  from: Point; to: Point; port: PortId; berth: number; route: RouteKind;
  startAt: number; arriveAt: number; fuel: number; kits: number; distance: number;
  waypoints: Point[];
  frontier?: string; tow?: boolean; wear?: number; fittingWear?: number; damageApplied?: number; fittingApplied?: number; risk?: string; marks?: number;
}
export interface Ship extends BoatState {
  id: string; owner: string; name: string; port: PortId | null; cargo: Stock;
  cargoItems: string[]; deliveries: string[]; fuel: number; look: Look;
  modules: { cargoModule?: string; engine?: string };
  nav: Point | null; voyage: Voyage | null; input: { throttle: number; steer: number; until: number };
  chainPending?: string;
  sea?: Seamanship; maker?: string; quality?: number;
}
export interface Item {
  id: string; owner: string; maker: string; kind: ItemKind; look: Look;
  port: PortId | null; ship: string | null; installed: string | null;
  listing: string | null; consumed: boolean; quality?: number; tier?: 2;
  chain?: { tokenId: `0x${string}`; status: "minting" | "owned" | "escrow" | "consumed"; tx?: `0x${string}`; task?: "mint" | "install" | "uninstall"; error?: string };
}
export interface Player {
  id: string; name: string; home: PortId; marks: number; warehouse: Record<PortId, Stock>;
  selectedShip: string; wallet: string | null; npc?: boolean;
  specialty?: WorkshopKind; haulRate?: number; available?: boolean;
  career?: { produced: number; trades: number; hauled: number; civic: number; earned: number; rank: number };
  notices: { id: string; at: number; text: string }[];
}
export interface Listing {
  id: string; seller: string; port: PortId; good: Good | null; quantity: number;
  item: string | null; price: number; createdAt: number;
  offers: { buyer: string; price: number }[];
}
export interface Delivery {
  id: string; buyer: string; supplier: string | null; carrier: string | null;
  ship: string | null; from: PortId | null; to: PortId; berth: number;
  good: Good; quantity: number; price: number; fee: number; deadline: number;
  status: "open" | "stocked" | "aboard" | "sailing" | "delivered" | "cancelled";
  note: string; offers: { supplier: string; price: number }[];
  civic?: boolean; project?: boolean; local?: boolean; haulOffers?: { carrier: string; fee: number }[]; reservedCarrier?: string;
}
export const DELIVERY_STATUS: Record<Delivery["status"], string> = {
  open: "Needs supplies", stocked: "Ready to load", aboard: "Cargo aboard",
  sailing: "On delivery", delivered: "Delivered", cancelled: "Cancelled",
};
export interface Extraction { player: string; port: PortId; good: Good; quantity: number; readyAt: number }
export interface World {
  version: number; practice: boolean; createdAt: number; updatedAt: number; sequence: number;
  players: Record<string, Player>; ships: Record<string, Ship>; items: Record<string, Item>;
  ports: Record<PortId, Port>; workshops: Workshop[]; listings: Listing[]; deliveries: Delivery[];
  extraction: Extraction[]; resources: Record<PortId, { good: Good; available: number; refillAt: number }>;
  ledger: { id: string; at: number; text: string }[];
  regionVersion?: number; trades?: { at: number; port: PortId; good: Good | ItemKind; quantity: number; total: number; buyer: string; seller: string; civic: boolean }[];
  messages?: { id: string; player: string; text: string; at: number }[];
  settlement?: Settlement;
  builds?: Build[]; outposts?: Outpost[]; raids?: Raid[];
}
export class GameError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function requireGame(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new GameError(message, status);
}
function id(w: World, prefix: string): string { return prefix + "-" + ++w.sequence; }
function integer(value: unknown, min = 1, max = 1000): number {
  requireGame(Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max, "Enter a whole number from " + min + " to " + max + ".");
  return Number(value);
}
function text(value: unknown, max = 120): string {
  requireGame(typeof value === "string" && value.trim().length > 0 && value.trim().length <= max, "Enter text of at most " + max + " characters.");
  return value.trim();
}
function member<T extends string>(value: unknown, values: readonly T[]): T {
  requireGame(typeof value === "string" && values.includes(value as T), "Choose one of the available options.");
  return value as T;
}
function look(value: unknown): Look {
  requireGame(value && typeof value === "object", "Choose a hull and sail color.");
  const l = value as Record<string, unknown>;
  requireGame(typeof l.hull === "string" && /^#[0-9a-f]{6}$/i.test(l.hull) && typeof l.sail === "string" && /^#[0-9a-f]{6}$/i.test(l.sail), "Colors must use six hexadecimal digits.");
  return { hull: l.hull.toLowerCase(), sail: l.sail.toLowerCase() };
}
function goods(stock: Stock, good: Good, change: number): void {
  const next = (stock[good] ?? 0) + change;
  requireGame(Number.isSafeInteger(next) && next >= 0, "Not enough " + GOOD_NAMES[good].toLowerCase() + ".");
  stock[good] = next;
}
function spend(p: Player, amount: number): void {
  requireGame(Number.isSafeInteger(amount) && amount >= 0 && p.marks >= amount, "Not enough Marks.");
  p.marks -= amount;
}
function notice(w: World, player: string, message: string, now: number): void {
  const p = w.players[player];
  if (p) p.notices = [{ id: id(w, "notice"), at: now, text: message }, ...p.notices].slice(0, 30);
}
function record(w: World, message: string, now: number): void {
  w.ledger = [{ id: id(w, "event"), at: now, text: message }, ...w.ledger].slice(0, 60);
}
export const GUIDE_PRICE: Record<Good | ItemKind, number> = { kelp: 3, timber: 6, scrap: 4, fuel: 12, plates: 18, repairKit: 16, fish: 6, ammunition: 5, engine: 180, cargoModule: 160, livery: 32 };
export const itemName = (item: Pick<Item, "kind" | "tier">) => item.tier === 2 ? "Reinforced cargo rig" : GOOD_NAMES[item.kind];
export function salvageYield(item: Pick<Item, "kind" | "tier">): Stock {
  return item.tier === 2 ? { timber: 4, plates: 3 } : item.kind === "cargoModule" ? { timber: 2, plates: 1 }
    : item.kind === "engine" ? { plates: 2, timber: 1 } : { kelp: 1 };
}
export const frontierWindow = (now: number) => now % 300_000 < 120_000;
export const raidDefense = (outpost: Outpost) => (outpost.owner ? 45 : 65) + outpost.fortification * 20;
export const raidAttack = (ship: Ship, barrage: boolean) => Math.floor(50 + (ship.sea?.integrity ?? 100) / 4 + (ship.sea?.hull === "barge" ? 10 : 0) + (barrage ? 35 : 0));
export function activeRaid(w: Pick<World, "raids">, ship: Ship): Raid | undefined { return w.raids?.find(r => r.ship === ship.id && r.status === "fighting"); }
export const RANKS = ["New house", "Trusted merchant", "Guild partner", "Republic patron"];
export const REFITS = {
  hold: { name: "Longshore cargo racks", rank: 1, inputs: { timber: 6, plates: 4 }, benefit: "+4 deck spaces" },
  sails: { name: "Stormsilk rigging", rank: 2, inputs: { kelp: 10, timber: 4, fuel: 3 }, benefit: "+10% sailing speed" },
  bracing: { name: "Copper hull bracing", rank: 3, inputs: { plates: 8, timber: 4, repairKit: 2 }, benefit: "35% less passage wear" },
} as const;
const newCareer = () => ({ produced: 0, trades: 0, hauled: 0, civic: 0, earned: 0, rank: 0 });
export const marketFee = (price: number) => Math.max(1, Math.ceil(price * 0.05));
export function cityHouse(w: World, port: PortId): Player { return w.players["civic-" + port]; }
export function cityNeeds(w: Pick<World, "ports">, port: PortId): Stock {
  const priority = w.ports[port].civic?.priority ?? "homes";
  const annex = !!w.ports[port].civic?.annex?.completedAt;
  return { fish: priority === "homes" ? 4 : 2, fuel: (priority === "industry" ? 4 : 2) + (annex ? 1 : 0),
    timber: priority === "harbor" ? 3 : 2, plates: priority === "harbor" ? 2 : 1, ...(annex ? { repairKit: 1 } : {}) };
}
export function cityPrice(w: World, port: PortId, good: Good): number {
  const target = (cityNeeds(w, port)[good] ?? 2) * 3, stock = cityHouse(w, port)?.warehouse[port][good] ?? 0;
  return Math.round(GUIDE_PRICE[good] * (1 + Math.max(0, 1 - stock / target) * 0.3));
}
export function specialist(player: Pick<Player, "specialty" | "home">, workshop: Pick<Workshop, "kind" | "port">): boolean {
  return player.specialty === workshop.kind && player.home === workshop.port;
}
export function craftSeconds(w: { players: Record<string, Pick<Player, "specialty" | "home">>; ports: World["ports"] }, workshop: Workshop, recipe: string, batches: number): number {
  const bonus = specialist(w.players[workshop.owner], workshop) ? 0.65 : 1.15;
  const city = (w.ports[workshop.port].civic?.prosperity ?? 65) >= 80 ? 0.9 : 1;
  return Math.ceil(RECIPES[recipe].seconds * batches * bonus * city * (w.ports[workshop.port].civic?.annex?.maintained ? 0.9 : 1));
}
export function workshopLimit(w: Pick<World, "ports">, port: PortId): number { return 6 + Math.min(3, Math.floor((w.ports[port].civic?.consumed ?? 0) / 40)) + (w.ports[port].civic?.annex?.completedAt ? 2 : 0); }
function tradeRecord(w: World, port: PortId, good: Good | ItemKind, quantity: number, total: number, buyer: string, seller: string, civic: boolean, now: number): void {
  w.trades = [{ at: now, port, good, quantity, total, buyer, seller, civic }, ...(w.trades ?? [])].slice(0, 120);
}
function reward(w: World, player: string, kind: "produced" | "trades" | "hauled" | "civic", earned: number, now: number, quantity = 1): void {
  const p = w.players[player]; if (!p || p.npc) return;
  const career = p.career ??= newCareer(); career[kind] += quantity; career.earned += earned;
  const score = career.produced + career.trades * 2 + career.hauled * 3 + career.civic * 2;
  const rank = score >= 60 ? 3 : score >= 25 ? 2 : score >= 8 ? 1 : 0;
  if (rank > career.rank) { career.rank = rank; notice(w, p.id, RANKS[rank] + ": new ship refits are available at the shipyard.", now); }
}
// One versioned upgrade preserves saved stock, money, identities and accepted transaction terms.
function upgradeWorld(w: World, now: number): void {
  if ((w.regionVersion ?? 1) < REGION_VERSION) {
    const scale = (p: Point) => { p.x *= 10; p.z *= 10; };
    for (const port of Object.values(w.ports)) { scale(port); if (port.move) { scale(port.move.from); scale(port.move.to); } }
    for (const ship of Object.values(w.ships)) {
      scale(ship); if (ship.nav) scale(ship.nav);
      if (ship.port) Object.assign(ship, berthPoint(w.ports[ship.port]));
      if (ship.voyage) {
        scale(ship.voyage.from); scale(ship.voyage.to); ship.voyage.waypoints.forEach(scale); ship.voyage.distance *= 10;
      }
    }
    w.resources.bastion.good = "timber";
    w.regionVersion = REGION_VERSION;
    record(w, "The Outer Reaches are charted. Existing stock, ownership and accepted orders are preserved.", now);
    w.version++;
  }
  w.trades ??= []; w.messages ??= []; w.raids ??= [];
  w.outposts ??= [{ ...FRONTIER_SITES[0], owner: null, stock: { timber: 12, scrap: 12, plates: 6 }, fortification: 0,
    builtAt: now, protectedUntil: 0, refillAt: now + 300_000 }];
  for (const p of Object.values(w.players)) {
    p.specialty ??= w.workshops.find(s => s.owner === p.id)?.kind ?? "refinery";
    p.career ??= newCareer(); p.haulRate ??= 12; p.available ??= true;
  }
  for (const port of PORT_IDS) {
    w.ports[port].civic ??= { prosperity: 65, consumed: 0, nextAt: now + 300_000, priority: "homes" };
    if (!cityHouse(w, port)) w.players["civic-" + port] = {
      id: "civic-" + port, name: w.ports[port].name + " civic house", home: port, marks: 2500,
      warehouse: { reedhaven: {}, ironwake: {}, bastion: {} }, selectedShip: "", wallet: null, npc: true, notices: [],
    };
  }
}
function civicTick(w: World, now: number): void {
  for (const port of PORT_IDS) {
    const city = w.ports[port], civic = city.civic!, house = cityHouse(w, port), needs = cityNeeds(w, port);
    if (!civic.consumed) civic.prosperity = 65;
    if (now >= civic.nextAt) {
      // ponytail: at most one hour of unattended civic consumption; use scheduled simulation for persistent large worlds.
      const cycles = Math.min(12, Math.floor((now - civic.nextAt) / 300_000) + 1);
      for (let i = 0; i < cycles; i++) {
        for (const resident of Object.values(w.players)) if (!resident.npc && resident.home === port && (resident.career?.rank ?? 0) >= 1) {
          const contribution = Math.min(Math.floor(Math.max(0,resident.marks-600)*0.1), Math.max(0,2500-house.marks));
          if (contribution) { spend(resident,contribution); house.marks+=contribution; notice(w,resident.id,contribution+' Marks civic upkeep paid to '+city.name+'. Your first 600 Marks stay protected.',now); }
        }
        if (civic.annex?.completedAt) civic.annex.maintained =
          (house.warehouse[port].fuel ?? 0) >= needs.fuel! && (house.warehouse[port].repairKit ?? 0) >= 1;
        let met = 0, total = 0;
        for (const [good, quantity] of Object.entries(needs) as [Good, number][]) {
          const used = Math.min(house.warehouse[port][good] ?? 0, quantity);
          goods(house.warehouse[port], good, -used); civic.consumed += used; met += used; total += quantity;
        }
        if (civic.consumed > 0) civic.prosperity = Math.max(20, Math.min(100, civic.prosperity + (met / total >= 0.8 ? 8 : met / total >= 0.5 ? 2 : -6)));
      }
      civic.nextAt = now + 300_000; w.version++;
    }
    if (city.move) continue;
    if (civic.annex && !civic.annex.completedAt) for (const [good, required] of Object.entries(ANNEX_INPUTS) as [Good, number][]) {
      const quantity = required - (civic.annex.stock[good] ?? 0);
      if (quantity <= 0 || w.deliveries.some(d => d.project && d.to === port && d.good === good && !["cancelled", "delivered"].includes(d.status))) continue;
      const price = cityPrice(w, port, good) * quantity;
      if (house.marks < price) continue;
      spend(house, price);
      w.deliveries.push({ id: id(w, "annex"), buyer: house.id, supplier: null, carrier: null, ship: null, from: null,
        to: port, berth: city.berth, good, quantity, price, fee: 0, deadline: now + 1200_000, status: "open",
        note: "Build the harbor workshop annex. Materials are consumed in construction.", offers: [], civic: true, project: true });
      w.version++;
    }
    for (const good of Object.keys(needs) as Good[]) {
      if ((house.warehouse[port][good] ?? 0) >= needs[good]! * 2 ||
          w.deliveries.some(d => d.civic && !d.project && d.to === port && d.good === good && !["cancelled", "delivered"].includes(d.status))) continue;
      const quantity = needs[good]! * 2, price = cityPrice(w, port, good) * quantity;
      if (house.marks < price) continue;
      spend(house, price);
      w.deliveries.push({ id: id(w, "civic"), buyer: house.id, supplier: null, carrier: null, ship: null, from: null,
        to: port, berth: city.berth, good, quantity, price, fee: 0, deadline: now + 1200_000, status: "open",
        note: good === "fish" ? "Provision the harbor kitchens." : good === "fuel" ? "Keep the lanterns and tide engines alight." : good === "timber" ? "Renew the piers and timber gardens." : "Maintain the floating pontoons.", offers: [], civic: true });
      w.version++;
    }
  }
}
function startBuild(w: World, build: NonNullable<World["builds"]>[number], now: number): void {
  const hull = HULLS[build.hull];
  if (!build.cancelled && !build.launched && build.accepted !== false && !build.readyAt && (build.stock.timber ?? 0) >= hull.timber &&
      (build.stock.plates ?? 0) >= hull.plates && (build.stock.fuel ?? 0) >= 2) {
    requireGame(!build.expiresAt || now + 60000 <= build.expiresAt, "The commission needs a full minute before its deadline. Cancel and agree a new commission.");
    if (build.finance?.status === "requested") delete build.finance;
    build.readyAt = now + 60000;
  }
}

function closeBuild(w: World, build: Build, now: number): void {
  for (const c of build.contributions) goods(w.players[c.player].warehouse[build.port], c.good, c.quantity);
  w.players[build.buyer].marks += build.price;
  const loan = build.finance;
  if (loan?.status === "funded") {
    const maker = w.players[build.builder], recovered = Math.min(maker.marks, loan.principal);
    spend(maker, recovered); w.players[loan.lender!].marks += recovered;
    loan.debt = loan.principal - recovered; loan.status = loan.debt ? "defaulted" : "repaid";
    notice(w, loan.lender!, build.name + " closed: " + recovered + " Marks returned; " + loan.debt + " remains owed.", now);
  }
  if (loan?.status === "requested") delete build.finance;
  build.cancelled = true; build.price = 0; build.stock = {}; build.contributions = [];
  notice(w, build.buyer, build.name + " closed; commission funds and contributed materials returned.", now);
}

export function createWorld(now: number, practice = false): World {
  const w: World = {
    version: 1, regionVersion: REGION_VERSION, trades: [], messages: [], practice, createdAt: now, updatedAt: now, sequence: 0, players: {}, ships: {}, items: {},
    ports: {
      reedhaven: { id: "reedhaven", name: "Reedhaven", ...PORT_SITES.reedhaven, berth: 0, steward: null, treasury: { fuel: 20 }, votes: {}, move: null },
      ironwake: { id: "ironwake", name: "Ironwake", ...PORT_SITES.ironwake, berth: 0, steward: null, treasury: { fuel: 20 }, votes: {}, move: null },
      bastion: { id: "bastion", name: "Bastion", ...PORT_SITES.bastion, berth: 0, steward: null, treasury: { fuel: 20 }, votes: {}, move: null },
    },
    workshops: [], listings: [], deliveries: [], extraction: [],
    resources: {
      reedhaven: { good: "kelp", available: 48, refillAt: now + 60_000 },
      ironwake: { good: "scrap", available: 48, refillAt: now + 60_000 },
      bastion: { good: "timber", available: 48, refillAt: now + 60_000 },
    },
    ledger: [],
  };
  upgradeWorld(w, now);
  civicTick(w, now);
  return w;
}
export function berthPoint(port: Point): Point { return { x: port.x + 28, z: port.z - 48 }; }
export function addPlayer(w: World, playerId: string, name: string, home: PortId, kind: WorkshopKind, now: number): Player {
  requireGame(!w.players[playerId], "This house has already received its starter goods.", 409);
  const shipId = id(w, "ship");
  const p: Player = {
    id: playerId, name, home, marks: 600, warehouse: { reedhaven: {}, ironwake: {}, bastion: {} },
    selectedShip: shipId, wallet: null, notices: [], specialty: kind, haulRate: 12, available: true, career: newCareer(),
  };
  p.warehouse[home] = kind === "refinery" ? { kelp: 18, timber: 6, fuel: 2 }
    : kind === "foundry" ? { scrap: 18, fuel: 4, timber: 4 }
    : { timber: 12, plates: 3, repairKit: 1, fuel: 2 };
  const at = berthPoint(w.ports[home]);
  w.players[playerId] = p;
  w.ships[shipId] = {
    id: shipId, owner: playerId, name: name + "'s skiff", x: at.x, z: at.z, heading: -0.55, speed: 0,
    port: home, cargo: {}, cargoItems: [], deliveries: [], fuel: 0, look: { ...DEFAULT_LOOK },
    modules: {}, nav: null, voyage: null, input: { throttle: 0, steer: 0, until: 0 },
  };
  w.workshops.push({ id: id(w, "workshop"), owner: playerId, port: home, kind, job: null });
  if (!w.ports[home].steward) w.ports[home].steward = playerId;
  notice(w, playerId, "Your starter goods are in " + w.ports[home].name + ". Make goods, find a buyer, or take a hauling job.", now);
  record(w, name + " opened a merchant house in " + w.ports[home].name + ".", now);
  return p;
}
export function reinforced(w: Pick<World, "items">, ship: Ship): boolean { return !!ship.modules.cargoModule && w.items[ship.modules.cargoModule]?.tier === 2; }
export function capacity(w: Pick<World, "items">, ship: Ship): number { return HULLS[ship.sea?.hull ?? "cutter"].hold + (ship.modules.cargoModule ? reinforced(w, ship) ? 8 : 4 : 0) + (ship.sea?.refits?.includes("hold") ? 4 : 0); }
export function shipSpeed(w: Pick<World, "items">, ship: Ship): number { return HULLS[ship.sea?.hull ?? "cutter"].speed * (ship.modules.cargoModule ? reinforced(w, ship) ? 0.75 : 0.9 : 1) * (ship.quality ?? 1) * (ship.sea?.refits?.includes("sails") ? 1.1 : 1); }
export function cargoWeight(w: Pick<World, "deliveries" | "items">, ship: Ship): number {
  return Object.entries(ship.cargo).reduce((n, [g, q]) => n + GOOD_WEIGHT[g as Good] * q!, 0) + ship.cargoItems.length * 3 +
    ship.deliveries.reduce((n, id) => { const d = w.deliveries.find(d => d.id === id); return n + (d ? GOOD_WEIGHT[d.good] * d.quantity : 0); }, 0) + (reinforced(w, ship) ? 2 : 0);
}
export function canRemoveRig(w: Pick<World, "deliveries" | "items">, ship: Ship): boolean {
  const hull = HULLS[ship.sea?.hull ?? "cutter"];
  return loadUnits(w, ship) <= hull.hold + (ship.sea?.refits?.includes("hold") ? 4 : 0) && cargoWeight(w, ship) - (reinforced(w, ship) ? 2 : 0) <= hull.tonnes;
}
export function sailingForces(w: Pick<World, "deliveries" | "items">, ship: Ship, now: number) {
  const sea = ship.sea ?? newSeamanship(), hull = HULLS[sea.hull], weight = cargoWeight(w, ship);
  const wind = weatherAt(now), draft = hull.draft + weight / hull.tonnes * 0.5 + sea.flooding / 200;
  return { mass: hull.mass + weight / hull.tonnes, anchored: sea.anchor,
    drive: (sailPower(ship.heading, wind, sea.trim, sea.reef) + (sea.engine && ship.modules.engine && ship.fuel > 0 ? 0.9 : 0)) *
      (sea.integrity / 160 + 0.375) * (1 - (sea.fittingWear ?? 0) / 250) * (1 - sea.flooding / 120) * (1 - Math.abs(sea.balance) * Math.min(1, weight / hull.tonnes) * 0.2) * (draft > depthAt(ship.x, ship.z) ? 0.1 : 1),
    currentX: Math.sin(now / 90000 + ship.z / 30) * 0.08, currentZ: Math.cos(ship.x / 30) * 0.06, draft };
}
export function shipNavigation(w: Pick<World, "items">, ship: Ship, now: number) {
  let target = ship.nav ?? ship;
  const wind = weatherAt(now), angle = Math.atan2(target.x - ship.x, target.z - ship.z);
  const powered = ship.sea?.engine && ship.modules.engine && ship.fuel > 0;
  if (!powered && Math.hypot(target.x - ship.x, target.z - ship.z) > 3 && Math.abs(wrapAngle(angle - wind.heading)) > 2.4) {
    const tack = wind.heading + (Math.floor(now / 6000) % 2 ? 2.1 : -2.1);
    target = { x: ship.x + Math.sin(tack) * 60, z: ship.z + Math.cos(tack) * 60 };
  }
  return navigationInput(ship, target.x, target.z, shipSpeed(w, ship));
}
function fits(w: World, ship: Ship, qty: number, weight: number): void {
  requireGame(loadUnits(w, ship) + qty <= capacity(w, ship), "There is not enough deck space. Unload cargo or choose a larger boat.");
  requireGame(cargoWeight(w, ship) + weight <= HULLS[ship.sea?.hull ?? "cutter"].tonnes + (ship.modules.cargoModule ? 6 : 0), "This cargo is too heavy. Unload some goods before adding more.");
}
export function warehouseUsed(stock: Stock): number { return Object.values(stock).reduce((n, q) => n + q!, 0); }
function warehouseRoom(p: Player, port: PortId, qty: number): void {
  requireGame(warehouseUsed(p.warehouse[port]) + qty <= WAREHOUSE_LIMIT, "This warehouse holds 240 units. Sell or move some goods to make room.");
}
function deckWork(ship: Ship, kind: string, now: number): void { ship.sea!.work = { kind, start: now, until: now + 4000 }; }
export function loadUnits(w: Pick<World, "deliveries">, ship: Ship): number {
  const cargo = Object.values(ship.cargo).reduce((a, n) => a + (n ?? 0), 0);
  const sealed = ship.deliveries.reduce((n, delivery) => n + (w.deliveries.find(d => d.id === delivery)?.quantity ?? 0), 0);
  return cargo + sealed + ship.cargoItems.length * 4;
}
export function worldObstacles(w: Pick<World, "ports" | "outposts">): Obstacle[] {
  return [...PORT_IDS.flatMap(id => [
    { x: w.ports[id].x - 3, z: w.ports[id].z + 5, hx: id === "bastion" ? 31 : 24, hz: 24, r: 3 },
    { x: w.ports[id].x + 18, z: w.ports[id].z - 36, hx: 2.7, hz: 18.1, r: 0 },
    { x: w.ports[id].x - 9, z: w.ports[id].z - 35, hx: 6, hz: 9, r: 0 },
    ...(w.ports[id].civic?.annex ? [{x:w.ports[id].x+43,z:w.ports[id].z+15,hx:6.5,hz:7.5,r:0}] : []),
    ...CITY_DISTRICTS.map(d => ({...d, x:w.ports[id].x+d.x, z:w.ports[id].z+d.z})),
  ]), ...REGION_OBSTACLES, ...(w.outposts ?? []).map(o => ({x:o.x,z:o.z,hx:7,hz:6,r:1}))];
}
function playerShip(w: World, p: Player, shipId?: unknown): Ship {
  const ship = w.ships[typeof shipId === "string" ? shipId : p.selectedShip];
  requireGame(ship && (ship.owner === p.id || ship.sea?.crew.includes(p.id)), "That boat does not belong to you.", 403);
  return ship;
}
function atPort(w: World, ship: Ship): PortId {
  requireGame(ship.port && !ship.voyage, "Dock at a harbor first.");
  const port = w.ports[ship.port];
  requireGame(!port.move || w.updatedAt < port.move.departAt, "This harbor is moving. Wait for it to anchor.");
  return ship.port;
}
function ownedItem(w: World, p: Player, itemId: unknown): Item {
  const item = w.items[text(itemId, 100)];
  requireGame(item && item.owner === p.id && !item.consumed, "That item does not belong to you.", 403);
  requireGame(!item.listing && !item.installed, "Remove the item from its listing or boat first.");
  requireGame(!item.chain, "This item's ownership is controlled by its Creditcoin contract.");
  return item;
}
function completeDelivery(w: World, d: Delivery, ship: Ship, now: number): void {
  if (d.to !== ship.port || !d.supplier || !d.carrier || (d.status !== "aboard" && d.status !== "sailing")) return;
  const annex = d.project ? w.ports[d.to].civic?.annex : undefined;
  if (!annex && warehouseUsed(w.players[d.buyer].warehouse[d.to]) + d.quantity > WAREHOUSE_LIMIT) return;
  goods(annex ? annex.stock : w.players[d.buyer].warehouse[d.to], d.good, d.quantity);
  if (annex && !annex.completedAt && Object.entries(ANNEX_INPUTS).every(([g, q]) => (annex.stock[g as Good] ?? 0) >= q!)) {
    annex.completedAt = now;
    record(w, w.ports[d.to].name + " opened its workshop annex. Two new berths; supply fuel and repair kits to power its production bonus.", now);
  }
  const fee = d.civic ? 0 : marketFee(d.price);
  w.players[d.supplier].marks += d.price - d.fee - fee;
  w.players[d.carrier].marks += d.fee;
  if (fee) cityHouse(w, d.to).marks += fee;
  tradeRecord(w, d.to, d.good, d.quantity, d.price, d.buyer, d.supplier, !!d.civic, now);
  reward(w, d.supplier, d.civic ? "civic" : "trades", d.price - d.fee - fee, now);
  if (!d.local && d.from !== d.to) reward(w, d.carrier, "hauled", d.carrier === d.supplier ? 0 : d.fee, now);
  ship.deliveries = ship.deliveries.filter(v => v !== d.id);
  d.status = "delivered";
  notice(w, d.buyer, "Delivered: " + d.quantity + " " + GOOD_NAMES[d.good] + " at " + w.ports[d.to].name + ".", now);
  notice(w, d.supplier, "Delivery complete. You received " + (d.price - d.fee - fee) + " Marks.", now);
  if (d.carrier !== d.supplier) notice(w, d.carrier, "Hauling fee received: " + d.fee + " Marks.", now);
  record(w, w.players[d.carrier].name + " delivered " + d.quantity + " " + GOOD_NAMES[d.good] + " to " + w.ports[d.to].name + ".", now);
  if (w.practice && d.id === "practice-timber") {
    const workshop = w.workshops.find(v => v.owner === d.buyer && v.kind === "shipyard")!;
    command(w, d.buyer, { action: "craft", workshop: workshop.id, recipe: "cargoModule", batches: 1, look: DEFAULT_LOOK }, now);
    notice(w, d.carrier, "The harbor office has started building a cargo rig with your timber.", now);
  }
}
function cancelDelivery(w: World, d: Delivery, now: number): void {
  requireGame(d.status !== "sailing", "A committed voyage cannot be cancelled.");
  if (d.status === "delivered" || d.status === "cancelled") return;
  w.players[d.buyer].marks += d.price;
  if (d.supplier && d.from) goods(w.players[d.supplier].warehouse[d.from], d.good, d.quantity);
  if (d.ship) w.ships[d.ship].deliveries = w.ships[d.ship].deliveries.filter(v => v !== d.id);
  d.status = "cancelled";
  notice(w, d.buyer, "Order closed; its reserved Marks were returned.", now);
  if (d.supplier) notice(w, d.supplier, "Order closed; its reserved stock was returned.", now);
}

// ponytail: a bounded 24 m navigation grid covers this authored region; use a navigation mesh if islands become narrow or fleets outgrow it.
export function sailingPath(w: World, from: Point, to: Point, draft = 0): Point[] {
  from = { x: from.x, z: from.z }; to = { x: to.x, z: to.z };
  const obstacles = worldObstacles(w);
  const navigable = (x: number, z: number) => isClear(x, z, obstacles, WORLD_RADIUS) && depthAt(x, z) >= draft;
  const clear = (a: Point, b: Point) => {
    const steps = Math.ceil(Math.hypot(a.x - b.x, a.z - b.z));
    for (let n = 0; n <= steps; n++) {
      const t = steps ? n / steps : 0;
      if (!navigable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  };
  requireGame(navigable(to.x, to.z), "That destination is too close to land or too shallow for this hull.");
  if (clear(from, to)) return [from, to];
  const nodes: Point[] = [from, to];
  const grid = new Map<string, number>();
  for (let x = -864; x <= 864; x += 24) for (let z = -864; z <= 864; z += 24) {
    if (navigable(x, z)) { grid.set(x + "," + z, nodes.length); nodes.push({ x, z }); }
  }
  const distance = nodes.map(() => Infinity);
  const prior = nodes.map(() => -1);
  const pending = new Set<number>([0]);
  distance[0] = 0;
  while (pending.size) {
    let current = -1; let best = Infinity;
    for (const n of pending) {
      const score = distance[n] + Math.hypot(nodes[n].x - to.x, nodes[n].z - to.z);
      if (score < best) { current = n; best = score; }
    }
    if (current === 1) break;
    pending.delete(current);
    const p = nodes[current];
    const neighbors: number[] = [];
    if (current === 0) {
      for (let n = 2; n < nodes.length; n++) if (Math.hypot(p.x - nodes[n].x, p.z - nodes[n].z) <= 42 && clear(p, nodes[n])) neighbors.push(n);
    } else {
      for (const dx of [-24, 0, 24]) for (const dz of [-24, 0, 24]) {
        if (!dx && !dz) continue;
        const n = grid.get((p.x + dx) + "," + (p.z + dz));
        if (n !== undefined && clear(p, nodes[n])) neighbors.push(n);
      }
    }
    if (clear(p, to)) neighbors.push(1);
    for (const next of neighbors) {
      const cost = distance[current] + Math.hypot(p.x - nodes[next].x, p.z - nodes[next].z);
      if (cost < distance[next]) { distance[next] = cost; prior[next] = current; pending.add(next); }
    }
  }
  requireGame(prior[1] >= 0, "No safe route was found. Choose another destination or a smaller hull.");
  const result: Point[] = [];
  for (let n = 1; n !== -1; n = prior[n]) result.unshift(nodes[n]);
  const simplified: Point[] = [result[0]];
  for (let i = 0; i < result.length - 1;) {
    let next = result.length - 1;
    while (next > i + 1 && !clear(result[i], result[next])) next--;
    simplified.push(result[next]); i = next;
  }
  return simplified;
}
export function voyageQuote(w: World, ship: Ship, destination: PortId, route: RouteKind, now: number, frontier?: typeof FRONTIER_SITES[number]): Voyage {
  requireGame(!ship.voyage, "This boat is already on a voyage.");
  const port = w.ports[destination];
  requireGame(frontier || !port.move || now < port.move.departAt, "The destination is moving; wait for its next berth.");
  requireGame(route !== "powered" || ship.modules.engine, "Fit an engine for powered voyages.");
  const to = frontier ? { x: frontier.x + 18, z: frontier.z - 18 } : berthPoint(port);
  const from = { x: ship.x, z: ship.z };
  const draft = sailingForces(w, ship, now).draft;
  let waypoints = sailingPath(w, from, to, draft);
  let lane = '';
  if (route !== "hazard" && Math.hypot(from.x - to.x, from.z - to.z) > 100) {
    const reefDistance = waypoints.slice(1).reduce((n,p,i)=>n+Math.hypot(p.x-waypoints[i].x,p.z-waypoints[i].z),0);
    const candidates = LANTERN_BUOYS.slice().sort((a,b)=>(Math.hypot(from.x-a.x,from.z-a.z)+Math.hypot(to.x-a.x,to.z-a.z))-(Math.hypot(from.x-b.x,from.z-b.z)+Math.hypot(to.x-b.x,to.z-b.z)));
    for (const beacon of candidates) {
      if (!isClear(beacon.x, beacon.z, worldObstacles(w), WORLD_RADIUS) || depthAt(beacon.x, beacon.z) < draft + 0.3) continue;
      try {
        const path = [...sailingPath(w, from, beacon, draft + 0.3), ...sailingPath(w, beacon, to, draft + 0.3).slice(1)];
        const laneDistance = path.slice(1).reduce((n,p,i)=>n+Math.hypot(p.x-path[i].x,p.z-path[i].z),0);
        if (laneDistance <= reefDistance + 1 || laneDistance / 240 >= reefDistance / 95) continue;
        waypoints = path; lane = beacon.name; break;
      } catch (e) { if (!(e instanceof GameError)) throw e; }
    }
    requireGame(lane, "No sheltered lantern lane is available for this hull. Inspect the reef passage or choose another harbor.");
  }
  const distance = waypoints.slice(1).reduce((total, p, i) => total + Math.hypot(p.x - waypoints[i].x, p.z - waypoints[i].z), 0);
  const sea = ship.sea ?? newSeamanship(), wind = weatherAt(now);
  requireGame(sea.integrity >= 25 && sea.flooding < 40, "Repair the hull and bail out water before you set sail.");
  const windFactor = 0.85 + wind.strength * 0.2;
  const seconds = Math.max(5, Math.ceil(distance / shipSpeed(w, ship) * (1 + cargoWeight(w, ship) / 100) / windFactor * (route === "powered" ? 0.65 : 1)));
  const arriveAt = now + seconds * 1000;
  requireGame(frontier || !port.move || arriveAt < port.move.departAt, "The city will move before you arrive. Choose another route or wait for it to anchor.");
  const weather = Math.max(wind.sea, weatherAt(now + seconds * 500).sea, weatherAt(arriveAt).sea);
  const wear = Math.round(distance / (route === "hazard" ? 95 : 240) * weather * (sea.secured ? 1 : 1.3) /
    (ship.quality ?? 1) * (sea.refits?.includes("bracing") ? 0.65 : 1) * 10) / 10;
  requireGame(sea.integrity - wear >= 15, "This passage would leave the hull unsafe. Repair it or choose the lantern lane.");
  return { from, to, frontier: frontier?.id, port: destination, berth: port.berth, route, startAt: now, arriveAt, distance, waypoints,
    fuel: route === "powered" ? Math.max(1, Math.ceil(distance / 120)) : 0, kits: 0,
    wear, fittingWear: ship.modules.engine || ship.modules.cargoModule ? Math.round(wear * 4) / 10 : 0,
    risk: (route === "hazard" ? "Exposed reef waters" : lane ? "Lantern lane via " + lane : "Harbor approach") + (weather > 1 ? " · squall forecast" : " · trade winds"), marks: 2 };
}
export function voyagePosition(v: Voyage, now: number): Point {
  let remaining = Math.min(1, Math.max(0, (now - v.startAt) / (v.arriveAt - v.startAt))) * v.distance;
  for (let i = 1; i < v.waypoints.length; i++) {
    const a = v.waypoints[i - 1], b = v.waypoints[i];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (remaining <= length) {
      const t = length ? remaining / length : 1;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    remaining -= length;
  }
  return v.to;
}

export function advanceWorld(w: World, now: number, resume = false): void {
  const dt = Math.min(0.1, Math.max(0, (now - w.updatedAt) / 1000));
  if (resume && now - w.updatedAt > 5000) {
    const gap = now - w.updatedAt;
    for (const d of w.deliveries) if (!["delivered", "cancelled"].includes(d.status)) d.deadline += gap;
    for (const build of w.builds ?? []) if (build.expiresAt && !build.cancelled && !build.launched) build.expiresAt += gap;
    for (const port of Object.values(w.ports)) if (port.move && port.move.departAt > w.updatedAt) {
      port.move.departAt += gap; port.move.arriveAt += gap;
    }
  }
  upgradeWorld(w, now);
  w.updatedAt = now;
  for (const port of Object.values(w.ports)) {
    if (port.move) {
      const t = Math.min(1, Math.max(0, (now - port.move.departAt) / (port.move.arriveAt - port.move.departAt)));
      port.x = port.move.from.x + (port.move.to.x - port.move.from.x) * t;
      port.z = port.move.from.z + (port.move.to.z - port.move.from.z) * t;
      if (t >= 1) { port.move = null; port.berth++;
        record(w, port.name + " anchored by the " + (port.x < 0 ? "lantern gardens" : "ember reefs") + ". Its timber gardens remain aboard.", now); }
    }
    const resource = w.resources[port.id];
    if (now >= resource.refillAt) {
      if (resource.available < 48) w.version++;
      resource.available = Math.min(48, resource.available + Math.floor((now - resource.refillAt) / 60_000 + 1) * 12);
      resource.refillAt = now + 60_000;
    }
  }
  for (const job of w.extraction.filter(j => j.readyAt <= now)) {
    if (warehouseUsed(w.players[job.player].warehouse[job.port]) + job.quantity > WAREHOUSE_LIMIT) continue;
    goods(w.players[job.player].warehouse[job.port], job.good, job.quantity);
    notice(w, job.player, "Gathered " + job.quantity + " " + GOOD_NAMES[job.good] + " at " + w.ports[job.port].name + ".", now);
    job.quantity = 0;
  }
  w.extraction = w.extraction.filter(j => j.quantity > 0);
  for (const workshop of w.workshops) while (workshop.job && workshop.job.readyAt <= now) {
    const job = workshop.job, recipe = RECIPES[job.recipe];
    if (GOOD_IDS.includes(recipe.output as Good)) {
      if (warehouseUsed(w.players[workshop.owner].warehouse[workshop.port]) + recipe.quantity * job.batches > WAREHOUSE_LIMIT) break;
      goods(w.players[workshop.owner].warehouse[workshop.port], recipe.output as Good, recipe.quantity * job.batches);
    } else {
      for (let n = 0; n < job.batches; n++) {
        const itemId = id(w, "item");
        w.items[itemId] = { id: itemId, owner: workshop.owner, maker: workshop.owner, kind: recipe.output as ItemKind,
          look: { ...job.look }, port: workshop.port, ship: null, installed: null, listing: null, consumed: false, tier: recipe.tier, quality: specialist(w.players[workshop.owner], workshop) ? 1.08 : 1 };
        if (w.practice && w.players[workshop.owner].npc && recipe.output === "cargoModule") {
          command(w, workshop.owner, { action: "install", item: itemId }, now);
        }
      }
    }
    reward(w, workshop.owner, "produced", 0, now, job.batches);
    notice(w, workshop.owner, recipe.name + " completed in " + w.ports[workshop.port].name + ".", now);
    workshop.job = workshop.queue?.shift() ?? null;
    if (workshop.job) workshop.job.readyAt = job.readyAt + craftSeconds(w, workshop, workshop.job.recipe, workshop.job.batches) * 1000;
  }
  for (const build of w.builds ?? []) if (build.readyAt && build.readyAt <= now && !build.launched && !build.cancelled) {
    const shipId = id(w, "ship"), at = berthPoint(w.ports[build.port]);
    w.ships[shipId] = { id: shipId, owner: build.buyer, maker: build.builder, name: build.name, ...at, heading: -0.55, speed: 0,
      port: build.port, cargo: {}, cargoItems: [], deliveries: [], fuel: 0, look: { ...DEFAULT_LOOK }, modules: {}, nav: null,
      voyage: null, input: { throttle: 0, steer: 0, until: 0 }, sea: newSeamanship(build.hull),
      quality: specialist(w.players[build.builder], {kind:'shipyard',port:build.port}) ? 1.08 : 1 };
    build.launched = shipId;
    const repayment = build.finance?.status === "funded" ? build.finance.repayment : 0;
    if (repayment) { w.players[build.finance!.lender!].marks += repayment; build.finance!.status = "repaid"; }
    w.players[build.builder].marks += build.price - repayment;
    reward(w, build.builder, "produced", build.price - repayment, now);
    notice(w, build.buyer, build.name + " launched. Select it in your fleet.", now);
    record(w, w.players[build.builder].name + " launched " + build.name + " for " + w.players[build.buyer].name + ".", now);
  }
  for (const build of w.builds ?? []) if (!build.launched && !build.cancelled && build.expiresAt && build.expiresAt <= now) closeBuild(w, build, now);
  for (const outpost of w.outposts!) if (!outpost.owner && now >= outpost.refillAt && !w.raids!.some(r => r.target === outpost.id && r.status === "fighting")) {
    for (const good of ["timber", "scrap", "plates"] as Good[]) outpost.stock[good] = Math.min(good === "plates" ? 6 : 12, (outpost.stock[good] ?? 0) + 2);
    outpost.refillAt = now + 300_000; w.version++;
  }
  for (const raid of w.raids!) if (raid.status === "fighting" && raid.endAt <= now) {
    const ship = w.ships[raid.ship], target = w.outposts!.find(o => o.id === raid.target)!;
    raid.status = raid.attack >= raid.defense ? "won" : "repelled";
    raid.damage = (raid.status === "won" ? 10 : 25) + (raid.barrage ? 5 : 0);
    ship.sea!.integrity = Math.max(5, ship.sea!.integrity - raid.damage);
    if (raid.status === "won") {
      let remaining = 6;
      for (const good of GOOD_IDS) while (remaining && (target.stock[good] ?? 0) > 0) {
        if (loadUnits(w, ship) + 1 > capacity(w, ship) || cargoWeight(w, ship) + GOOD_WEIGHT[good] > HULLS[ship.sea!.hull].tonnes + (ship.modules.cargoModule ? 6 : 0)) break;
        goods(target.stock, good, -1); goods(ship.cargo, good, 1); goods(raid.loot, good, 1); remaining--;
      }
    }
    if (raid.barrage) target.fortification = Math.max(0, target.fortification - 1);
    target.protectedUntil = now + 120_000;
    notice(w, raid.attacker, (raid.status === "won" ? "Raid won" : "Raid repelled") + ": " + warehouseUsed(raid.loot) + " goods aboard, " + raid.damage + " hull damage. Repair before returning.", now);
    if (target.owner) notice(w, target.owner, target.name + " was raided: " + warehouseUsed(raid.loot) + " exposed goods lost. Core warehouses remain protected.", now);
    record(w, w.players[raid.attacker].name + " " + (raid.status === "won" ? "raided " : "was repelled by ") + target.name + ".", now); w.version++;
  }
  w.raids = [...w.raids!.filter(r => r.status === "fighting"), ...w.raids!.filter(r => r.status !== "fighting").slice(-30)];
  const obstacles = worldObstacles(w);
  for (const ship of Object.values(w.ships)) {
    const sea = ship.sea ??= newSeamanship();
    if (sea.work && sea.work.until <= now) { sea.work = null; w.version++; }
    for (const site of SEA_SITES) if (Math.hypot(ship.x - site.x, ship.z - site.z) < 18 && !sea.discovered.includes(site.id)) {
      sea.discovered.push(site.id); notice(w, ship.owner, "Discovered " + site.name + ".", now);
    }
    if (activeRaid(w, ship)) { ship.speed = 0; continue; }
    if (ship.voyage) {
      const passage = ship.voyage;
      const progress = Math.min(1, Math.max(0, (now - passage.startAt) / (passage.arriveAt - passage.startAt)));
      const damage = (passage.wear ?? 0) * progress, fitting = (passage.fittingWear ?? 0) * progress;
      sea.integrity = Math.max(5, sea.integrity - Math.max(0, damage - (passage.damageApplied ?? 0)));
      sea.fittingWear = Math.min(100, (sea.fittingWear ?? 0) + Math.max(0, fitting - (passage.fittingApplied ?? 0)));
      passage.damageApplied = damage; passage.fittingApplied = fitting;
      const position = voyagePosition(passage, now);
      if (Math.hypot(ship.x - position.x, ship.z - position.z) > 0.01) ship.heading = Math.atan2(position.x - ship.x, position.z - ship.z);
      Object.assign(ship, position);
      ship.speed = ship.voyage.distance / ((ship.voyage.arriveAt - ship.voyage.startAt) / 1000);
      if (now >= ship.voyage.arriveAt) {
        ship.port = passage.frontier ? null : passage.port; ship.voyage = null; ship.speed = 0; sea.anchor = !!passage.frontier;
        notice(w, ship.owner, ship.name + " arrived at " + (passage.frontier ? FRONTIER_SITES.find(s => s.id === passage.frontier)!.name : w.ports[ship.port!].name) + ".", now); w.version++;
        for (const delivery of [...ship.deliveries]) {
          const d = w.deliveries.find(v => v.id === delivery);
          if (d) completeDelivery(w, d, ship, now);
        }
      }
    } else if (ship.port) {
      Object.assign(ship, berthPoint(w.ports[ship.port]));
      ship.speed = 0;
      for (const delivery of [...ship.deliveries]) { const d = w.deliveries.find(d => d.id === delivery); if (d) completeDelivery(w, d, ship, now); }
    } else {
      let input = ship.input.until > now ? ship.input : { throttle: 0, steer: 0 };
      if (ship.nav) {
        const nav = shipNavigation(w, ship, now);
        input = nav.input;
        if (nav.arrived && Math.abs(ship.speed) < 0.3) { ship.nav = null; w.version++; }
      }
      const before = Math.abs(ship.speed), forces = sailingForces(w, ship, now);
      if (before > 0.5 && !sea.anchor) {
        sea.integrity = Math.max(5, sea.integrity - dt * 0.008);
        if (ship.modules.engine || ship.modules.cargoModule) sea.fittingWear = Math.min(100, (sea.fittingWear ?? 0) + dt * 0.003);
      }
      const hit = stepBoat(ship, input, dt, obstacles, WORLD_RADIUS, shipSpeed(w, ship), forces);
      if (hit || (forces.draft > depthAt(ship.x, ship.z) && before > 1)) {
        if (before > 1.5 && now - sea.lastHit > 1200) {
          sea.integrity = Math.max(5, sea.integrity - before * 3); sea.lastHit = now;
          notice(w, ship.owner, "Your boat hit an obstacle. Check the hull and use a repair kit if needed.", now);
        }
        if (ship.nav) { ship.nav = null; notice(w, ship.owner, "Route blocked. Choose open water or a harbor voyage.", now); }
      }
      if (!sea.secured && before > 2 && Math.abs(input.steer) > 0.4) sea.balance = Math.max(-1, Math.min(1, sea.balance + input.steer * dt * 0.25));
      if (sea.engine && ship.modules.engine && ship.fuel > 0 && input.throttle > 0 && !sea.anchor) {
        sea.fuelUsed += dt / 15;
        if (sea.fuelUsed >= 1) { ship.fuel--; sea.fuelUsed -= 1; w.version++; }
      }
      if (ship.input.until > now || ship.nav) sea.flooding = Math.min(90, sea.flooding + Math.max(0, 60 - sea.integrity) * dt / 150);
    }
  }
  for (const d of w.deliveries) if (d.deadline <= now && !["sailing", "delivered", "cancelled"].includes(d.status)) cancelDelivery(w, d, now);
  civicTick(w, now);
}

export function command(w: World, playerId: string, data: unknown, now: number): void {
  requireGame(data && typeof data === "object" && !Array.isArray(data), "Expected an action.");
  const a = data as Record<string, unknown>;
  const p = w.players[playerId];
  requireGame(p, "Sign in to play.", 401);
  const action = text(a.action, 40);
  const ship = playerShip(w, p, a.ship);
  const sea = ship.sea ??= newSeamanship();
  requireGame(ship.owner === p.id || ["selectShip", "steer", "stop", "sails", "anchor", "cargo", "secureCargo", "balanceCargo", "bail", "repair", "leaveCrew"].includes(action), "Only the owner can spend the house's stock or commit this boat.", 403);
  requireGame(!activeRaid(w, ship) || ["selectShip", "message", "leaveCrew"].includes(action), "Your crew is committed to this 20-second raid. Wait for the result.");
  if (ship.chainPending && ["sailFrontier", "buildOutpost", "raid", "outpostCargo", "fortifyOutpost","steer", "navigate", "stop", "dock", "voyage", "cargo", "refuel", "moveItem", "install", "uninstall", "recover", "sails", "anchor", "fitGear", "customize", "joinCrew"].includes(action)) {
    throw new GameError("This boat is waiting for its Creditcoin fitting change to be confirmed.");
  }
  switch (action) {
    case "sails": {
      requireGame(!ship.voyage, "The voyage crew is handling this passage.");
      sea.trim = integer(a.trim, -1, 90); sea.reef = integer(a.reef, 0, 2) / 2;
      requireGame(a.engine === "off" || a.engine === "on", "Choose an engine setting.");
      requireGame(a.engine !== "on" || (ship.modules.engine && ship.fuel > 0), "Fit an engine and load fuel first.");
      sea.engine = a.engine === "on"; break;
    }
    case "anchor": {
      requireGame(!ship.voyage && !ship.port && Math.abs(ship.speed) <= 1.2, "Slow below 1.2 m/s in open water to handle the anchor.");
      sea.anchor = !sea.anchor; ship.nav = null; ship.input.until = 0; deckWork(ship, "anchor", now); break;
    }
    case "secureCargo": sea.secured = true; deckWork(ship, "lash", now); break;
    case "balanceCargo": {
      requireGame(Math.abs(ship.speed) <= 1.2, "Slow down before moving the deck load.");
      sea.balance = integer(a.balance, -1, 1); sea.secured = false; deckWork(ship, "load", now); break;
    }
    case "bail": {
      requireGame(now - sea.lastBail >= 3000 && sea.flooding > 0, "Bail only when water is aboard. Wait three seconds between buckets.");
      sea.flooding = Math.max(0, sea.flooding - 12); sea.lastBail = now; deckWork(ship, "bail", now); break;
    }
    case "repair": {
      requireGame(!ship.voyage && (sea.integrity < 100 || (sea.fittingWear ?? 0) > 0), "Repairs need hull or fitting damage. Wait until your current trip ends.");
      const stock = ship.port ? p.warehouse[atPort(w, ship)] : ship.cargo;
      requireGame(ship.owner === p.id || !!ship.port, "A guest repairer uses their own kit at a harbor.");
      goods(stock, "repairKit", -1); sea.integrity = Math.min(100, sea.integrity + 35); sea.fittingWear = Math.max(0, (sea.fittingWear ?? 0) - 35); deckWork(ship, "repair", now);
      record(w, p.name + " repaired " + ship.name + ".", now); break;
    }
    case "recover": {
      requireGame(!ship.port && !ship.voyage, "Harbor recovery is for boats stranded at sea.");
      const port = member(a.port, PORT_IDS), to = berthPoint(w.ports[port]);
      requireGame(!w.ports[port].move, "Choose an anchored harbor for recovery.");
      const cost = 10 + Math.ceil(Math.hypot(ship.x - to.x, ship.z - to.z) / 5);
      spend(p, cost); cityHouse(w, port).marks += cost; sea.anchor = false; ship.nav = null; ship.input.until = 0;
      const waypoints = sailingPath(w, ship, to), distance = waypoints.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - waypoints[i].x, p.z - waypoints[i].z), 0);
      const arriveAt = now + Math.max(10000, distance / 2 * 1000);
      for (const id of ship.deliveries) {
        const delivery = w.deliveries.find(d => d.id === id)!;
        requireGame(delivery.to === port && delivery.berth === w.ports[port].berth && arriveAt < delivery.deadline, "Recovery must honor the loaded delivery's berth and deadline. Arrange cancellation with its buyer first.");
      }
      ship.voyage = { from: { x: ship.x, z: ship.z }, to, port, berth: w.ports[port].berth, route: "sail", startAt: now,
        arriveAt, distance, waypoints, fuel: 0, kits: 0, tow: true };
      for (const id of ship.deliveries) w.deliveries.find(d => d.id === id)!.status = "sailing";
      notice(w, p.id, "Harbor tug dispatched for " + cost + " Marks. Cargo stays aboard; delivery deadlines still apply.", now); break;
    }
    case "fitGear": {
      const port = atPort(w, ship), gear = member(a.gear, ["fishing", "salvage", "sounder", "cannon"] as const);
      requireGame(!sea.gear.includes(gear), "This equipment is already fitted.");
      if (gear === "salvage") requireGame(ship.modules.cargoModule, "Fit a cargo rig to handle wreck salvage.");
      goods(p.warehouse[port], "timber", -2); goods(p.warehouse[port], "plates", gear === "cannon" ? -3 : -1); sea.gear.push(gear); break;
    }
    case "explore": {
      const site = SEA_SITES.find(s => s.id === a.site);
      requireGame(site && Math.hypot(ship.x - site.x, ship.z - site.z) <= 8, "Sail within eight metres of the site.");
      requireGame(!ship.voyage && sea.anchor && Math.abs(ship.speed) <= 0.5, "Anchor at the site before working.");
      requireGame(sea.gear.includes(site.gear), "Fit the site's equipment at a harbor first.");
      requireGame((sea.catches[site.id] ?? 0) <= now, "Let the site replenish for one minute.");
      fits(w, ship, site.quantity, site.quantity * GOOD_WEIGHT[site.good]);
      goods(ship.cargo, site.good, site.quantity); sea.catches[site.id] = now + 60000; sea.secured = false;
      deckWork(ship, "salvage", now); break;
    }
    case "customize": {
      atPort(w, ship);
      const finish = { pattern: member(a.pattern, ["crest", "striped", "plain"]), material: member(a.material, ["enamel", "timber", "copper"]),
        cabin: member(a.cabin, ["copper", "canvas", "flat"]), railing: member(a.railing, ["brass", "rope"]),
        flag: member(a.flag, ["swallowtail", "square", "none"]), figurehead: member(a.figurehead, ["none", "gull", "sun"]), lamps: a.lamps === "on" };
      requireGame(a.lamps === "on" || a.lamps === "off", "Choose a lamp setting.");
      spend(p, 20); cityHouse(w, ship.port!).marks += 20; sea.finish = finish; deckWork(ship, "paint", now); break;
    }
    case "openCrew": sea.openCrew = !sea.openCrew; break;
    case "joinCrew": {
      const target = w.ships[text(a.target, 100)];
      requireGame(target?.sea?.openCrew && target.owner !== p.id && ship.port && target.port === ship.port, "Meet an inviting captain at the same harbor.");
      requireGame(target.sea.crew.length < 2 && !target.sea.crew.includes(p.id), "This boat's two guest berths are occupied.");
      target.sea.crew.push(p.id); p.selectedShip = target.id; break;
    }
    case "leaveCrew": sea.crew = sea.crew.filter(id => id !== p.id); p.selectedShip = Object.values(w.ships).find(s => s.owner === p.id)!.id; break;
    case "commissionShip": {
      const port = atPort(w, ship), builder = text(a.builder, 100), hull = member(a.hull, ["cutter", "lighter", "barge"] as const);
      requireGame(w.workshops.some(s => s.owner === builder && s.port === port && s.kind === "shipyard"), "Choose a local shipwright.");
      requireGame(Object.values(w.ships).filter(s => s.owner === p.id).length + (w.builds ?? []).filter(b => b.buyer === p.id && !b.launched && !b.cancelled).length < 4, "Four boats per house, including commissions.");
      const price = integer(a.price, builder === p.id ? 0 : 1, 100000), name = text(a.name, 24); spend(p, price);
      (w.builds ??= []).push({ id: id(w, "build"), buyer: p.id, builder, port, hull, name, price, stock: {}, accepted: builder === p.id, contributions: [], readyAt: null, launched: null, expiresAt: now + 1800_000 }); break;
    }
    case "contributeBuild": {
      const build = w.builds?.find(b => b.id === a.build), port = atPort(w, ship), good = member(a.good, ["timber", "plates", "fuel"] as const);
      requireGame(build && !build.cancelled && !build.launched && build.port === port && !build.readyAt, "Choose an unstarted local commission.");
      const quantity = integer(a.quantity), needs = { timber: HULLS[build.hull].timber, plates: HULLS[build.hull].plates, fuel: 2 };
      requireGame(quantity <= needs[good] - (build.stock[good] ?? 0), "Contribute only the materials still required.");
      goods(p.warehouse[port], good, -quantity); goods(build.stock, good, quantity); build.contributions.push({ player: p.id, good, quantity });
      startBuild(w, build, now);
      record(w, p.name + " contributed " + quantity + " " + GOOD_NAMES[good] + " to " + build.name + ".", now); break;
    }
    case "cancelBuild": {
      const build = w.builds?.find(b => b.id === a.build);
      requireGame(build && !build.cancelled && !build.launched && (build.buyer === p.id || build.builder === p.id) && !build.readyAt, "Only its buyer or shipwright can cancel an unstarted commission.");
      closeBuild(w, build, now); break;
    }
    case "selectShip": p.selectedShip = ship.id; break;
    case "renameShip": ship.name = text(a.name, 24); break;
    case "steer": {
      requireGame(!ship.voyage, "A committed voyage is already underway.");
      ship.input = { throttle: integer(a.throttle, -1, 1), steer: integer(a.steer, -1, 1), until: now + 1500 };
      if (ship.input.throttle || ship.input.steer) { ship.port = null; }
      ship.nav = null; break;
    }
    case "navigate": {
      requireGame(!ship.voyage, "A committed voyage is already underway.");
      requireGame(typeof a.x === "number" && Number.isFinite(a.x) && typeof a.z === "number" && Number.isFinite(a.z), "Invalid destination.");
      requireGame(isClear(a.x, a.z, worldObstacles(w), WORLD_RADIUS), "Choose open water inside the chart.");
      requireGame(!sea.anchor, "Raise the anchor before sailing.");
      ship.nav = { x: a.x, z: a.z }; ship.port = null; ship.input.until = 0; break;
    }
    case "stop": {
      requireGame(!ship.voyage, "A committed voyage cannot be cancelled.");
      ship.nav = null; ship.input = { throttle: -Math.sign(ship.speed), steer: 0, until: now + 1500 }; break;
    }
    case "dock": {
      requireGame(!ship.voyage && !ship.port, "Sail to a harbor before docking.");
      const portId = member(a.port, PORT_IDS), port = w.ports[portId], berth = berthPoint(port);
      requireGame(!port.move || now < port.move.departAt, "This harbor is moving.");
      requireGame(Math.hypot(ship.x - berth.x, ship.z - berth.z) <= 6 && Math.abs(ship.speed) <= 1, "Approach the berth slowly before docking.");
      requireGame(Math.abs(wrapAngle(ship.heading + 0.55)) < 0.9, "Turn your bow to follow the glowing berth arrow.");
      const fee = Math.min(2, p.marks); spend(p, fee); cityHouse(w, portId).marks += fee;
      sea.anchor = false; ship.port = portId; ship.nav = null; ship.speed = 0; ship.input.until = 0; Object.assign(ship, berth);
      for (const delivery of [...ship.deliveries]) { const d = w.deliveries.find(v => v.id === delivery); if (d) completeDelivery(w, d, ship, now); }
      break;
    }
    case "cargo": {
      const port = atPort(w, ship), good = member(a.good, GOOD_IDS), qty = integer(a.quantity), loading = a.direction === "load";
      requireGame(a.direction === "load" || a.direction === "unload", "Choose load or unload.");
      requireGame(ship.owner === p.id || loading, "Guests may contribute their own stock, but only the captain can unload cargo.", 403);
      if (loading) fits(w, ship, qty, qty * GOOD_WEIGHT[good]); else warehouseRoom(p, port, qty);
      goods(loading ? p.warehouse[port] : ship.cargo, good, -qty);
      goods(loading ? ship.cargo : p.warehouse[port], good, qty); sea.secured = false; deckWork(ship, "load", now); break;
    }
    case "refuel": {
      const port = atPort(w, ship), qty = integer(a.quantity, 1, 30);
      requireGame(ship.fuel + qty <= 30, "The tank holds 30 fuel.");
      goods(p.warehouse[port], "fuel", -qty); ship.fuel += qty; deckWork(ship, "refuel", now); break;
    }
    case "extract": {
      const portId = member(a.port, PORT_IDS), port = w.ports[portId], resource = w.resources[portId];
      requireGame(w.workshops.some(v => v.owner === p.id && v.port === portId), "Build a workshop in this city before sending a gathering crew.");
      requireGame(!port.move || now < port.move.departAt, "Extraction pauses while the city is moving.");
      requireGame(!w.extraction.some(j => j.player === p.id && j.port === portId), "Your gathering crew is already working here.");
      const qty = integer(a.quantity, 1, 12);
      requireGame(resource.available >= qty, "This resource site needs time to replenish.");
      const fee = Math.ceil(qty / 2); spend(p, fee); cityHouse(w, portId).marks += fee;
      resource.available -= qty;
      w.extraction.push({ player: p.id, port: portId, good: resource.good, quantity: qty, readyAt: now + 30_000 }); break;
    }
    case "craft": {
      const workshop = w.workshops.find(v => v.id === a.workshop && v.owner === p.id);
      requireGame(workshop, "That workshop does not belong to you.", 403);
      const recipe = RECIPES[text(a.recipe, 30)], batches = integer(a.batches, 1, 10);
      requireGame(recipe && recipe.workshop === workshop.kind, "This workshop cannot make that item.");
      requireGame((workshop.queue?.length ?? 0) < 2, "Two batches are already queued. Wait for a batch to finish.");
      if (recipe.components) {
        requireGame(batches === 1 && Array.isArray(a.items) && a.items.length === recipe.components && new Set(a.items).size === recipe.components, "Choose two different ordinary cargo rigs for one upgrade.");
        const components = a.items.map(item => ownedItem(w, p, item));
        requireGame(components.every(i => i.kind === "cargoModule" && !i.tier && i.port === workshop.port), "Choose two ordinary cargo rigs in this warehouse. Remove them from boats and sale offers first.");
        for (const item of components) item.consumed = true;
      }
      const appearance = a.look ? look(a.look) : { ...DEFAULT_LOOK };
      for (const [good, qty] of Object.entries(recipe.inputs)) goods(p.warehouse[workshop.port], good as Good, -(qty! * batches));
      const fee = batches * 2; spend(p, fee); cityHouse(w, workshop.port).marks += fee;
      const job = { recipe: String(a.recipe), batches, readyAt: now + craftSeconds(w, workshop, String(a.recipe), batches) * 1000, look: appearance };
      if (workshop.job) (workshop.queue ??= []).push(job); else workshop.job = job; break;
    }
    case "salvageItem": {
      const item = ownedItem(w, p, a.item), port = atPort(w, ship), output = salvageYield(item);
      requireGame(item.port === port && w.workshops.some(s => s.port === port && s.kind === "shipyard" && s.owner === p.id), "Bring this uninstalled fitting to your shipyard’s warehouse.");
      warehouseRoom(p, port, warehouseUsed(output)); item.consumed = true;
      for (const [good, quantity] of Object.entries(output)) goods(p.warehouse[port], good as Good, quantity!);
      notice(w, p.id, itemName(item) + " dismantled; recovered materials are in your warehouse.", now); break;
    }
    case "buildWorkshop": {
      const port = atPort(w, ship), kind = member(a.kind, ["refinery", "foundry", "shipyard"] as const);
      requireGame(w.workshops.filter(v => v.port === port).length < workshopLimit(w, port), "The workshop berths are full. Supply civic projects to expand this harbor.");
      goods(p.warehouse[port], "timber", -8); goods(p.warehouse[port], "plates", -4);
      spend(p, 60); cityHouse(w, port).marks += 60;
      w.workshops.push({ id: id(w, "workshop"), owner: p.id, port, kind, job: null }); break;
    }
    case "buildShip": {
      const port = atPort(w, ship);
      requireGame(w.workshops.some(v => v.port === port && v.owner === p.id && v.kind === "shipyard"), "Build at your shipyard.");
      command(w, playerId, { action: "commissionShip", builder: playerId, hull: a.hull ?? "cutter", name: a.name, price: 0 }, now);
      const build = w.builds!.at(-1)!;
      for (const [good, quantity] of Object.entries({ timber: HULLS[build.hull].timber, plates: HULLS[build.hull].plates, fuel: 2 })) {
        command(w, playerId, { action: "contributeBuild", build: build.id, good, quantity }, now);
      }
      break;
    }
    case "listGoods": {
      const port = atPort(w, ship), good = member(a.good, GOOD_IDS), qty = integer(a.quantity), price = integer(a.price, 1, 1_000_000);
      requireGame(w.listings.filter(v => v.seller === p.id).length < 20, "Close an offer before opening another.");
      goods(p.warehouse[port], good, -qty);
      w.listings.push({ id: id(w, "listing"), seller: p.id, port, good, quantity: qty, item: null, price, createdAt: now, offers: [] }); break;
    }
    case "listItem": {
      const item = ownedItem(w, p, a.item), port = atPort(w, ship), price = integer(a.price, 1, 1_000_000);
      requireGame(item.port === port, "The item must be in this harbor's warehouse.");
      requireGame(w.listings.filter(v => v.seller === p.id).length < 20, "Close an offer before opening another.");
      item.listing = id(w, "listing");
      w.listings.push({ id: item.listing, seller: p.id, port, good: null, quantity: 1, item: item.id, price, createdAt: now, offers: [] }); break;
    }
    case "cancelListing": {
      const listing = w.listings.find(v => v.id === a.listing);
      requireGame(listing && listing.seller === p.id, "That offer does not belong to you.", 403);
      if (listing.good) goods(p.warehouse[listing.port], listing.good, listing.quantity);
      if (listing.item) w.items[listing.item].listing = null;
      w.listings = w.listings.filter(v => v.id !== listing.id); break;
    }
    case "counterListing": {
      const listing = w.listings.find(v => v.id === a.listing);
      requireGame(listing && listing.seller !== p.id, "Choose another player's offer.");
      const price = integer(a.price, 1, 1_000_000);
      requireGame(p.marks >= price, "You cannot offer more Marks than you have.");
      listing.offers = [...listing.offers.filter(v => v.buyer !== p.id), { buyer: p.id, price }];
      notice(w, listing.seller, p.name + " offered " + price + " Marks for your listing.", now); break;
    }
    case "buyListing":
    case "acceptCounter": {
      const listing = w.listings.find(v => v.id === a.listing);
      requireGame(listing, "This offer is no longer available.", 409);
      const offer = action === "acceptCounter" ? listing.offers.find(v => v.buyer === a.buyer) : null;
      if (action === "acceptCounter") requireGame(listing.seller === p.id && offer, "Choose an offer on your listing.", 403);
      const buyer = offer ? w.players[offer.buyer] : p;
      requireGame(buyer.id !== listing.seller, "You already own this stock.");
      const price = offer?.price ?? listing.price;
      const fee = marketFee(price);
      spend(buyer, price); w.players[listing.seller].marks += price - fee; cityHouse(w, listing.port).marks += fee;
      tradeRecord(w, listing.port, listing.good ?? w.items[listing.item!].kind, listing.quantity, price, buyer.id, listing.seller, false, now);
      reward(w, listing.seller, "trades", price - fee, now);
      if (listing.good) { warehouseRoom(buyer, listing.port, listing.quantity); goods(buyer.warehouse[listing.port], listing.good, listing.quantity); }
      if (listing.item) { const item = w.items[listing.item]; item.owner = buyer.id; item.listing = null; }
      w.listings = w.listings.filter(v => v.id !== listing.id);
      notice(w, buyer.id, "Purchased stock is waiting in " + w.ports[listing.port].name + ".", now);
      notice(w, listing.seller, "Your offer sold for " + (price - fee) + " Marks after the " + fee + " Mark harbor fee.", now);
      record(w, buyer.name + " bought from " + w.players[listing.seller].name + " in " + w.ports[listing.port].name + ".", now); break;
    }
    case "requestDelivery": {
      const to = member(a.port, PORT_IDS), good = member(a.good, GOOD_IDS), quantity = integer(a.quantity, 1, 16);
      const price = integer(a.price, 1, 1_000_000), minutes = integer(a.minutes, 1, 60), deadline = now + minutes * 60_000;
      const port = w.ports[to];
      requireGame(!port.move || deadline < port.move.departAt, "Set a deadline before this berth closes.");
      requireGame(w.deliveries.filter(v => v.buyer === p.id && !["delivered", "cancelled"].includes(v.status)).length < 10, "Close a request before opening another.");
      spend(p, price);
      w.deliveries.push({ id: id(w, "delivery"), buyer: p.id, supplier: null, carrier: null, ship: null, from: null, to, berth: port.berth,
        good, quantity, price, fee: 0, deadline, status: "open", note: typeof a.note === "string" ? a.note.trim().slice(0, 120) : "", offers: [] }); break;
    }
    case "counterDelivery": {
      const d = w.deliveries.find(v => v.id === a.delivery);
      requireGame(d && d.status === "open" && d.buyer !== p.id, "Choose another player's open request.");
      const price = integer(a.price, 1, 1_000_000);
      d.offers = [...d.offers.filter(v => v.supplier !== p.id), { supplier: p.id, price }];
      notice(w, d.buyer, p.name + " quoted " + price + " Marks for your delivery request.", now); break;
    }
    case "acceptDeliveryCounter": {
      const d = w.deliveries.find(v => v.id === a.delivery);
      const offer = d?.offers.find(v => v.supplier === a.supplier);
      requireGame(d && d.buyer === p.id && d.status === "open" && offer, "Choose a quote on your open request.", 403);
      if (offer.price > d.price) spend(p, offer.price - d.price); else p.marks += d.price - offer.price;
      d.price = offer.price; d.supplier = offer.supplier; d.offers = []; notice(w, offer.supplier, "Your delivery price was accepted. Supply the stock to confirm.", now); break;
    }
    case "supplyDelivery": {
      const d = w.deliveries.find(v => v.id === a.delivery), from = member(a.port, PORT_IDS);
      requireGame(d && d.status === "open" && d.buyer !== p.id && d.deadline > now, "This request is no longer open.");
      requireGame(!d.supplier || d.supplier === p.id, "The buyer accepted another supplier's quote.");
      requireGame(from !== d.to, "Delivery cargo must travel between harbors. Use a local offer or Supply here for civic needs.");
      const fee = integer(a.fee, 0, d.price - (d.civic ? 0 : marketFee(d.price)));
      goods(p.warehouse[from], d.good, -d.quantity);
      d.supplier = p.id; d.from = from; d.fee = fee; d.status = "stocked"; d.offers = [];
      notice(w, d.buyer, p.name + " supplied your order. It is ready for transport.", now); break;
    }
    case "takeHaul": {
      const d = w.deliveries.find(v => v.id === a.delivery), port = atPort(w, ship);
      requireGame(d && d.status === "stocked" && d.from === port && d.supplier, "Dock where this cargo is waiting.");
      requireGame(d.fee > 0 || d.supplier === p.id, "This supplier is carrying its own order.");
      requireGame(!d.reservedCarrier || d.reservedCarrier === p.id, "This haul is reserved for the accepted carrier.");
      fits(w, ship, d.quantity, GOOD_WEIGHT[d.good] * d.quantity);
      d.carrier = p.id; d.ship = ship.id; d.status = "aboard"; ship.deliveries.push(d.id); sea.secured = false; deckWork(ship, "load", now);
      completeDelivery(w, d, ship, now); break;
    }
    case "cancelDelivery": {
      const d = w.deliveries.find(v => v.id === a.delivery);
      requireGame(d && (d.buyer === p.id || d.supplier === p.id), "This order does not belong to you.", 403);
      cancelDelivery(w, d, now); break;
    }
    case "voyage": {
      const destination = member(a.port, PORT_IDS), route = member(a.route, ["sail", "powered", "hazard"] as const);
      const v = voyageQuote(w, ship, destination, route, now);
      requireGame((a.berth === undefined || a.berth === v.berth) && (a.maxFuel === undefined || (Number.isSafeInteger(a.maxFuel) && Number(a.maxFuel) >= v.fuel)) &&
        (a.maxKits === undefined || (Number.isSafeInteger(a.maxKits) && Number(a.maxKits) >= v.kits)), "The berth or supplies changed. Review the voyage again.");
      requireGame(ship.fuel >= v.fuel, "Load enough fuel before departure.");
      for (const delivery of ship.deliveries) {
        const d = w.deliveries.find(v => v.id === delivery)!;
        requireGame(d.to === destination && d.berth === w.ports[destination].berth && v.arriveAt < d.deadline, "A loaded delivery must reach its contracted berth before its deadline.");
      }
      const fee = Math.min(p.marks, v.marks ?? 0); spend(p, fee); cityHouse(w, destination).marks += fee;
      if (v.kits) goods(ship.cargo, "repairKit", -v.kits);
      sea.anchor = false; ship.fuel -= v.fuel; ship.voyage = v; ship.port = null; ship.nav = null; ship.input.until = 0;
      for (const delivery of ship.deliveries) w.deliveries.find(d => d.id === delivery)!.status = "sailing";
      break;
    }
    case "moveItem": {
      const item = ownedItem(w, p, a.item), port = atPort(w, ship);
      if (a.direction === "load") {
        requireGame(item.port === port, "The item must be here."); fits(w, ship, 4, 3);
        item.port = null; item.ship = ship.id; ship.cargoItems.push(item.id);
      } else {
        requireGame(a.direction === "unload" && item.ship === ship.id, "This item is not aboard.");
        ship.cargoItems = ship.cargoItems.filter(v => v !== item.id); item.ship = null; item.port = port;
      }
      break;
    }
    case "install": {
      const item = ownedItem(w, p, a.item), port = atPort(w, ship);
      requireGame(item.port === port || item.ship === ship.id, "Bring the item to this harbor.");
      if (item.kind === "livery") { ship.look = { ...item.look }; item.consumed = true; }
      else {
        requireGame(!ship.modules[item.kind], "Remove the existing fitting first.");
        ship.modules[item.kind] = item.id; item.installed = ship.id;
        if (item.kind === "cargoModule") ship.look = { ...item.look };
      }
      ship.cargoItems = ship.cargoItems.filter(v => v !== item.id);
      item.port = null; item.ship = null;
      notice(w, p.id, GOOD_NAMES[item.kind] + " installed on " + ship.name + ".", now); break;
    }
    case "uninstall": {
      const port = atPort(w, ship), kind = member(a.kind, ["cargoModule", "engine"] as const), itemId = ship.modules[kind];
      requireGame(itemId, "That fitting is not installed.");
      requireGame(!w.items[itemId].chain, "Use Remove on Creditcoin for this fitting.");
      if (kind === "cargoModule") requireGame(canRemoveRig(w, ship), "Unload within the hull limits before removing the cargo rig.");
      const item = w.items[itemId]; item.installed = null; item.port = port; delete ship.modules[kind]; break;
    }
    case "contribute": {
      const port = member(a.port, PORT_IDS), qty = integer(a.quantity, 1, 100);
      goods(p.warehouse[port], "fuel", -qty); goods(w.ports[port].treasury, "fuel", qty);
      record(w, p.name + " contributed " + qty + " fuel to " + w.ports[port].name + ".", now); break;
    }
    case "voteSteward": {
      const portId = member(a.port, PORT_IDS), target = w.players[text(a.player, 100)], port = w.ports[portId];
      requireGame(p.home === portId && target && target.home === portId && !target.npc, "Residents choose a steward from their own city.");
      port.votes[p.id] = target.id;
      const residents = Object.values(w.players).filter(v => v.home === portId && !v.npc);
      if (residents.filter(v => port.votes[v.id] === target.id).length > residents.length / 2) {
        port.steward = target.id; port.votes = {}; record(w, target.name + " became steward of " + port.name + ".", now);
      }
      break;
    }
    case "moveCity": {
      const portId = member(a.port, PORT_IDS), port = w.ports[portId];
      requireGame(port.steward === p.id, "Only this city's elected steward can commit its move.", 403);
      requireGame(portId === "bastion", "Bastion is the movable shipyard city in this first region.");
      requireGame(!port.move, "This move is already committed.");
      const anchorage = member(a.anchorage, ["kelp", "scrap"] as const);
      const to = { ...ANCHORAGES[anchorage] };
      requireGame(Math.hypot(port.x - to.x, port.z - to.z) > 1, "The city is already at that anchorage.");
      let departAt = now + 300_000;
      for (const d of w.deliveries) if (d.to === portId && !(d.civic && !d.project && d.status === "open") && !["delivered", "cancelled"].includes(d.status)) departAt = Math.max(departAt, d.deadline + 1000);
      for (const d of w.deliveries) if (d.to === portId && d.civic && !d.project && d.status === "open") cancelDelivery(w, d, now);
      goods(port.treasury, "fuel", -15);
      port.move = { from: { x: port.x, z: port.z }, to, departAt, arriveAt: departAt + 120_000 };
      record(w, port.name + " will relocate toward the " + anchorage + " supply. Existing delivery deadlines are protected.", now); break;
    }
    case "supplyCivic": {
      const port = atPort(w, ship), d = w.deliveries.find(d => d.id === a.delivery);
      requireGame(d?.civic && d.status === "open" && d.to === port, "Choose an open civic need at this harbor.");
      goods(p.warehouse[port], d.good, -d.quantity);
      d.supplier = p.id; d.carrier = p.id; d.from = port; d.ship = ship.id; d.local = true; d.status = "aboard";
      completeDelivery(w, d, ship, now); deckWork(ship, "load", now); break;
    }
    case "carrierProfile": p.haulRate = integer(a.rate, 1, 200); p.available = a.available === true; break;
    case "quoteHaul": {
      const d = w.deliveries.find(d => d.id === a.delivery);
      requireGame(d && d.status === "stocked" && d.supplier !== p.id, "Choose another supplier's waiting cargo.");
      const fee = integer(a.fee, 1, d.price - (d.civic ? 0 : marketFee(d.price)));
      d.haulOffers = [...(d.haulOffers ?? []).filter(o => o.carrier !== p.id), { carrier: p.id, fee }];
      notice(w, d.supplier!, p.name + " quoted " + fee + " Marks to carry your cargo.", now); break;
    }
    case "acceptHaulQuote": {
      const d = w.deliveries.find(d => d.id === a.delivery), quote = d?.haulOffers?.find(o => o.carrier === a.carrier);
      requireGame(d && d.status === "stocked" && d.supplier === p.id && quote, "Accept a carrier quote for your waiting cargo.");
      d.fee = quote.fee; d.reservedCarrier = quote.carrier; d.haulOffers = [];
      notice(w, quote.carrier, p.name + " accepted your hauling quote. Collect the order cargo at " + w.ports[d.from!].name + ".", now); break;
    }
    case "acceptBuild": {
      const build = w.builds?.find(b => b.id === a.build);
      requireGame(build && !build.cancelled && !build.launched && build.builder === p.id && build.accepted === false, "Choose a commission addressed to your shipyard.");
      build.accepted = true; startBuild(w, build, now); notice(w, build.buyer, p.name + " accepted the commission for " + build.name + ".", now); break;
    }
    case "requestAdvance": {
      const build = w.builds?.find(b => b.id === a.build);
      requireGame(build && build.builder === p.id && build.buyer !== p.id && build.accepted && !build.readyAt && !build.launched && !build.cancelled && !build.finance, "Accept another house’s commission before requesting an advance. Construction must not have started.");
      requireGame(!w.builds!.some(b => b.builder === p.id && b.finance?.status === "defaulted"), "Repay outstanding commission debt first.");
      const principal = integer(a.principal, 1, Math.min(100, Math.floor(build.price / 2))), repayment = integer(a.repayment, principal, Math.min(build.price, Math.floor(principal * 1.1)));
      build.finance = { principal, repayment, lender: null, status: "requested", debt: 0 };
      build.expiresAt ??= now + 1800_000; break;
    }
    case "fundAdvance": {
      const build = w.builds?.find(b => b.id === a.build), loan = build?.finance;
      requireGame(build && loan?.status === "requested" && !build.readyAt && !build.launched && !build.cancelled && build.expiresAt! > now && build.builder !== p.id && build.buyer !== p.id, "Choose another house’s open request for an advance.");
      requireGame(!w.builds!.some(b => b.builder === build.builder && b.finance?.status === "defaulted"), "This builder has unpaid commission debt.");
      requireGame(a.principal === loan.principal && a.repayment === loan.repayment, "Review the advance terms again.");
      spend(p, loan.principal); w.players[build.builder].marks += loan.principal; loan.lender = p.id; loan.status = "funded";
      notice(w, build.builder, p.name + " advanced " + loan.principal + " Marks; " + loan.repayment + " comes from the launch payout.", now); break;
    }
    case "repayAdvance": {
      const build = w.builds?.find(b => b.id === a.build), loan = build?.finance;
      requireGame(build?.builder === p.id && loan?.status === "defaulted", "Choose your unpaid commission debt.");
      spend(p, loan.debt); w.players[loan.lender!].marks += loan.debt; loan.debt = 0; loan.status = "repaid"; break;
    }
    case "startAnnex": {
      const port = atPort(w, ship), city = w.ports[port];
      requireGame(city.steward === p.id && !city.civic!.annex, "Only the steward can start this city's first workshop annex.");
      const cost = Object.entries(ANNEX_INPUTS).reduce((n, [g, q]) => n + cityPrice(w, port, g as Good) * q!, 0);
      requireGame(cityHouse(w, port).marks >= cost, "The civic treasury must fund every construction order first.");
      city.civic!.annex = { stock: {}, completedAt: null, maintained: false }; civicTick(w, now); break;
    }
    case "sailFrontier": {
      const target = FRONTIER_SITES.find(s => s.id === a.target);
      requireGame(target && !ship.deliveries.length, "Unload sealed delivery cargo before a frontier expedition.");
      const passage = voyageQuote(w, ship, p.home, "hazard", now, target);
      ship.voyage = passage; ship.port = null; ship.nav = null; ship.input.until = 0; sea.anchor = false; break;
    }
    case "buildOutpost": {
      const site = FRONTIER_SITES.find(s => s.id === a.target);
      requireGame(site && site.id !== "corsair" && !w.outposts!.some(o => o.id === site.id || o.owner === p.id), "Choose an empty frontier site; one outpost per house.");
      requireGame(a.acceptRisk === true && !ship.port && !ship.voyage && sea.anchor && Math.hypot(ship.x - site.x, ship.z - site.z) <= 35, "Anchor at the site and accept the risk to exposed stock.");
      for (const [g, q] of Object.entries(OUTPOST_INPUTS)) goods(ship.cargo, g as Good, -q!);
      w.outposts!.push({ ...site, owner: p.id, stock: {}, fortification: 0, builtAt: now, protectedUntil: now + 120_000, refillAt: 0 });
      record(w, p.name + " established " + site.name + ", open to frontier raids after two minutes.", now); break;
    }
    case "outpostCargo":
    case "fortifyOutpost":
    case "raid": {
      const target = w.outposts!.find(o => o.id === a.target);
      requireGame(target && !ship.port && !ship.voyage && sea.anchor && Math.hypot(ship.x - target.x, ship.z - target.z) <= 35, "Anchor within 35 metres of this outpost.");
      requireGame(!w.raids!.some(r => r.target === target.id && r.status === "fighting"), "This outpost is already in battle.");
      if (action === "raid") {
        requireGame(target.owner !== p.id && !ship.deliveries.length && sea.integrity >= 35 && sea.gear.includes("cannon"), "Bring a cannon and a hull with at least 35% integrity. Unload all delivery orders before raiding.");
        requireGame(now >= target.protectedUntil && (!target.owner || frontierWindow(now)), "This outpost is protected. Wait until its protection ends and player raids are open.");
        requireGame(a.mode === "skirmish" || a.mode === "barrage", "Choose skirmish or barrage.");
        const barrage = a.mode === "barrage", fuel = barrage ? 2 : 1;
        requireGame(ship.fuel >= fuel, "Load fuel into your tank before raiding.");
        goods(ship.cargo, "ammunition", barrage ? -6 : -3); ship.fuel -= fuel;
        const raid: Raid = { id: id(w, "raid"), target: target.id, attacker: p.id, ship: ship.id, startAt: now, endAt: now + 20_000,
          attack: raidAttack(ship, barrage), defense: raidDefense(target), barrage, status: "fighting", loot: {}, damage: 0 };
        w.raids!.push(raid); ship.nav = null; ship.input.until = 0; ship.speed = 0;
      } else {
        requireGame(target.owner === p.id, "Only the owner can manage this outpost.", 403);
        if (action === "fortifyOutpost") {
          requireGame(target.fortification < 3, "This outpost has all three defensive tiers.");
          goods(ship.cargo, "plates", -2); goods(ship.cargo, "repairKit", -1); target.fortification++;
        } else {
          const good = member(a.good, GOOD_IDS), quantity = integer(a.quantity, 1, 40), deposit = a.direction === "deposit";
          requireGame(deposit || a.direction === "withdraw", "Choose deposit or withdraw.");
          if (deposit) requireGame(warehouseUsed(target.stock) + quantity <= 40, "The exposed store holds 40 units.");
          else fits(w, ship, quantity, GOOD_WEIGHT[good] * quantity);
          goods(deposit ? ship.cargo : target.stock, good, -quantity); goods(deposit ? target.stock : ship.cargo, good, quantity);
        }
      }
      break;
    }
    case "cityPriority": {
      const port = member(a.port, PORT_IDS), city = w.ports[port];
      requireGame(city.steward === p.id, "The elected steward sets the civic priority.", 403);
      city.civic!.priority = member(a.priority, ["homes", "industry", "harbor"] as const);
      record(w, p.name + " set " + city.name + "'s civic priority to " + city.civic!.priority + ".", now); break;
    }
    case "refit": {
      const port = atPort(w, ship), kind = member(a.kind, ["hold", "sails", "bracing"] as const), refit = REFITS[kind];
      requireGame((p.career?.rank ?? 0) >= refit.rank, "Earn the listed merchant rank to commission this refit.");
      requireGame(!sea.refits?.includes(kind), "This refit is already aboard.");
      for (const [good, quantity] of Object.entries(refit.inputs)) goods(p.warehouse[port], good as Good, -quantity);
      (sea.refits ??= []).push(kind); deckWork(ship, "repair", now); break;
    }
    case "message": {
      const message = text(a.text, 180);
      requireGame(!(w.messages ?? []).some(m => m.player === p.id && now - m.at < 5000), "Wait five seconds between harbor messages.");
      w.messages = [...(w.messages ?? []), { id: id(w, "message"), player: p.id, text: message, at: now }].slice(-30); break;
    }
    default: throw new GameError("Unknown action.");
  }
  w.version++;
}

export function publicWorld(w: World, playerId: string): Omit<World, "players"> & { players: Record<string, Omit<Player, "warehouse" | "marks" | "notices">>; me: Player; warehouseTotals: Record<PortId, number>; civicAccounts: Record<PortId, { funds: number; stock: Stock; cycleCost: number }> } {
  const me = w.players[playerId];
  requireGame(me, "Sign in to play.", 401);
  const players = Object.fromEntries(Object.values(w.players).map(({ warehouse: _warehouse, marks: _marks, notices: _notices, ...p }) => [p.id, p]));
  const warehouseTotals = Object.fromEntries(PORT_IDS.map(port => [port, Object.values(w.players).reduce((n, p) => n + warehouseUsed(p.warehouse[port]), 0)])) as Record<PortId, number>;
  const civicAccounts = Object.fromEntries(PORT_IDS.map(port => [port, { funds: cityHouse(w, port).marks, stock: cityHouse(w, port).warehouse[port], cycleCost:Object.entries(cityNeeds(w,port)).reduce((n,[good,quantity])=>n+cityPrice(w,port,good as Good)*quantity,0) }])) as Record<PortId, { funds: number; stock: Stock; cycleCost: number }>;
  return { ...w, players, me, warehouseTotals, civicAccounts };
}
