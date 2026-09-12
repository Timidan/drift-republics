import {
  capacity, cargoWeight, DEFAULT_LOOK, DELIVERY_STATUS, GOOD_IDS, GOOD_NAMES, loadUnits, PORT_IDS, RECIPES, shipSpeed,
  GUIDE_PRICE, RANKS, REFITS, ANNEX_INPUTS, OUTPOST_INPUTS, FRONTIER_SITES, activeRaid, raidAttack, raidDefense, frontierWindow, itemName, salvageYield, cityNeeds, craftSeconds, specialist, workshopLimit, marketFee, berthPoint,
  type Build, type Good, type ItemKind, type Look, type PortId, type RouteKind, type Ship, type Voyage, type publicWorld,
} from "./economy.ts";
import { HULLS, weatherAt, depthAt, sailPower, wrapAngle } from "./boat.ts";
import { newSeamanship, SEA_SITES, warehouseUsed, WAREHOUSE_LIMIT, sailingForces } from "./economy.ts";
import { formatEther } from "viem";
import { walletActions, WALLET_WRITES } from "./wallet-actions.ts";
import { icon, ACTION_ICONS } from "./icons.ts";
import { CITY_STYLE, LANDMARKS, ANCHORAGES, LANTERN_BUOYS } from "./region.ts";
import { guideSteps, type GuideTopic } from "./guides.ts";

export type GameState = ReturnType<typeof publicWorld>;
type Panel = "harbor" | "workshop" | "shipyard" | "voyage" | "city" | "deck" | "chart" | "frontier";
type Hooks = { state: (state: GameState) => void; preview: (look: Look | null) => void; focusPort: (port: PortId) => void };
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (label: string, action: string, values: Record<string, unknown> = {}, disabled = false, kind = "command") =>
  '<button type="button" data-' + kind + '="' + action + '" ' + Object.entries(values).map(([k, v]) => 'data-' + k + '="' + esc(v) + '"').join(" ") + (disabled ? " disabled" : "") + ">" + icon(ACTION_ICONS[action] ?? 'arrow') + '<span>' + esc(label) + "</span></button>";
const amount = (name: string, value: number, max = 1000, min = 1) =>
  '<input name="' + name + '" type="number" value="' + value + '" min="' + min + '" max="' + max + '" required aria-label="' + name + '">';
const goodOptions = () => GOOD_IDS.map(g => '<option value="' + g + '">' + GOOD_NAMES[g] + "</option>").join("");
const materials = (stock: Record<string, number | undefined>) => Object.entries(stock).map(([g, n]) => '<span class="resource-chip">' + icon(g) + n + ' ' + GOOD_NAMES[g as keyof typeof GOOD_NAMES] + '</span>').join(' ');
const fittingArt = (kind: ItemKind) => icon(kind);
const clockText = (when: number) => {
  const seconds = Math.max(0, Math.ceil((when - Date.now()) / 1000));
  return seconds < 60 ? seconds + "s" : Math.floor(seconds / 60) + "m " + seconds % 60 + "s";
};

export function startGameUI(hooks: Hooks) {
  let state: GameState | null = null;
  let panel: Panel = "harbor";
  let port: PortId = "reedhaven";
  let source: EventSource | null = null;
  let preview: Look | null = null;
  let quote: Voyage | null = null;
  let route: RouteKind = "sail";
  let workGood = '';
  let stockedWork = false;
  let pending = false;
  let nextCommand: Record<string, unknown> | null = null;
  let reconnecting = false;
  let lastRevision = "";
  let refreshDeferred = false;
  let observedShip = "";
  let accountPending = false;
  let guideTopic: GuideTopic = "trade", guideStep = 0, guideActive = false;
  const guide = $<HTMLDialogElement>("guide-dialog");
  const context = $("context-content");
  const toast = $("game-toast");
  let toastTimer = 0;
  let rewardTimer = 0;
  const workspace = $("game-context");
  const chromeSize = new ResizeObserver(() => {
    document.documentElement.style.setProperty('--hud-clearance', Math.ceil($("hud-top").getBoundingClientRect().bottom) + 8 + 'px');
    document.documentElement.style.setProperty('--tabs-height', Math.ceil($("game-tabs").getBoundingClientRect().height) + 'px');
  });
  chromeSize.observe($("hud-top")); chromeSize.observe($("game-tabs"));
  const wallet = walletActions({ state: () => state, api, refresh: async () => accept(await api("/state"), true), tell });
  const walletButton = (label: string, action: string, values: Record<string, unknown> = {}, disabled = false) =>
    button(label, action, values, disabled || WALLET_WRITES.includes(action) && (!wallet.config?.writeEnabled || !!wallet.config.readOnly), "wallet");

  const motionAllowed = () => !matchMedia('(prefers-reduced-motion: reduce)').matches && !document.documentElement.classList.contains('calm-motion');
  function animate(el: HTMLElement, frames: Keyframe[], duration = 240): void {
    if (!motionAllowed()) return;
    el.getAnimations().forEach(a => a.cancel());
    el.animate(frames, { duration, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
  document.addEventListener('pointerdown', event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button:not(:disabled)') : null;
    if (target) animate(target, [{ scale: '.94' }, { scale: '1' }], 260);
  });
  function tell(message: string, bad = false): void {
    toast.textContent = message; toast.hidden = false; animate(toast, [{ opacity: 0, translate: '0 8px' }, { opacity: 1, translate: '0 0' }]); toast.classList.toggle("error", bad);
    window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { toast.hidden = true; }, 6500);
  }
  async function api(path: string, body?: unknown): Promise<any> {
    const response = await fetch("/api" + path, {
      method: body === undefined ? "GET" : "POST", credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "That action could not be completed. Reload to check your progress before trying again.");
    return data;
  }
  function ship(): Ship { return state!.ships[state!.me.selectedShip]; }
  function docked(): boolean { return !!state && ship().port === port && !ship().voyage && (!state.ports[port].move || Date.now() < state.ports[port].move!.departAt); }
  function name(player: string | null): string { return player ? state?.players[player]?.name ?? "Unknown house" : "Unassigned"; }
  function accept(next: GameState, force = false): void {
    const changedHouse = state?.me.id !== next.me.id;
    const previous = state;
    state = next;
    if (changedHouse) {
      port = next.me.home; preview = null; panel = "harbor"; quote = null; hooks.preview(null); force = true;
      guideTopic = "trade"; guideStep = next.practice ? 0 : 2; guideActive = false;
      try {
        const saved = JSON.parse(localStorage.getItem("drift-guide:" + next.me.id) ?? "null");
        if (saved && ["trade", "commission", "haul", "migration", "wallet", "sell", "buy"].includes(saved.topic) && Number.isInteger(saved.step)) {
          guideTopic = saved.topic; guideStep = Math.max(0, Math.min(saved.step, guideSteps(guideTopic, next, wallet.config).length - 1)); guideActive = saved.active === true;
        }
      } catch { /* An unreadable local bookmark does not affect the saved house. */ }
    }
    if (observedShip !== next.me.selectedShip) { observedShip = next.me.selectedShip; quote = null; force = true; }
    hooks.state(next);
    if (!changedHouse && previous) {
      const earned = (next.me.career?.earned ?? 0) - (previous.me.career?.earned ?? 0);
      const rank = (next.me.career?.rank ?? 0) > (previous.me.career?.rank ?? 0);
      const launched = Object.values(next.ships).find(s=>s.owner===next.me.id&&!previous.ships[s.id]&&next.builds?.some(b=>b.launched===s.id));
      const crafted = Object.values(next.items).find(i => i.owner === next.me.id && !previous.items[i.id]);
      const battle = next.raids?.find(r => r.attacker === next.me.id && r.status !== 'fighting' && previous.raids?.some(old => old.id === r.id && old.status === 'fighting'));
      if (next.me.marks !== previous.me.marks) animate($('house-marks'), [{ scale: '1.15', color: '#ffd887' }, { scale: '1' }], 420);
      if (earned > 0 || rank || launched || crafted || battle) {
        const banner = $("reward-banner");
        banner.innerHTML = icon(battle ? 'cannon' : crafted ? crafted.kind : launched ? 'shipyard' : rank ? 'star' : 'marks') + '<div><strong>' + (battle ? battle.status === 'won' ? 'Raid won · '+warehouseUsed(battle.loot)+' goods aboard' : 'Raid repelled' : crafted ? itemName(crafted)+' ready' : launched ? esc(launched.name)+' is afloat' : rank ? RANKS[next.me.career!.rank] : '+' + earned + ' Marks earned') + '</strong><span>' + (battle ? battle.damage+' hull damage. Your crew has returned.' : crafted ? 'Your new fitting is ready. Open Shipyard to use it.' : launched ? 'Select your new boat in Your fleet.' : rank ? 'A new ship refit is available.' : 'Your house’s work record has been updated.') + '</span></div>';
        banner.hidden = false; animate(banner, [{opacity:0, translate:'0 -18px',scale:'.92'}, {opacity:1, translate:'0 0',scale:'1'}], 420); window.clearTimeout(rewardTimer); rewardTimer = window.setTimeout(() => { banner.hidden = true; }, 5500);
        window.dispatchEvent(new CustomEvent('drift-reward', {detail: launched ? 'launch' : rank ? 'rank' : 'trade'}));
      }
    }
    const active = document.activeElement;
    const typing = active instanceof Element && !!active.closest("#context-content input, #context-content textarea, #context-content select");
    const revision = next.version + ":" + next.sequence;
    if (force || revision !== lastRevision || changedHouse) {
      lastRevision = revision;
      if (typing && !force) refreshDeferred = true;
      else render(!force && !changedHouse);
      if (panel === 'frontier' && next.raids?.some(r=>r.ship===next.me.selectedShip && r.status==='fighting' && !previous?.raids?.some(old=>old.id===r.id))) context.querySelector('.battle-card')?.scrollIntoView({block:'start',behavior:motionAllowed()?'smooth':'instant'});
    }
    updateMeters();
  }
  function events(): void {
    source?.close();
    source = new EventSource("/api/events");
    source.onmessage = event => { reconnecting = false; accept(JSON.parse(event.data) as GameState); };
    source.onerror = () => { reconnecting = true; updateMeters(); };
  }
  async function perform(command: Record<string, unknown>, options: { silent?: boolean } = {}): Promise<void> {
    if (!state) return;
    const key = crypto.randomUUID();
    try {
      const next = await api("/command", { key, command });
      accept(next, !options.silent);
    } catch (error) { tell(error instanceof Error ? error.message : String(error), true); }
  }
  async function submit(command: Record<string, unknown>): Promise<void> {
    if (pending) return;
    pending = true;
    context.setAttribute("aria-busy", "true");
    try { await perform(command); } finally { pending = false; context.removeAttribute("aria-busy"); updateMeters(); }
  }
  function updateMeters(): void {
    if (!state) return;
    const s = ship();
    $("house-name").textContent = state.practice ? "Practice harbor" : state.me.name;
    $("house-marks").textContent = state.me.marks + " Marks";
    $("boat-load").textContent = loadUnits(state, s) + " / " + capacity(state!, s) + " spaces";
    $("boat-fuel").textContent = s.fuel + " / 30 fuel";
    const sea = s.sea ?? newSeamanship(), wind = weatherAt(Date.now());
    const windBearing = ['N','NE','E','SE','S','SW','W','NW'][((Math.round(wind.heading / (Math.PI / 4)) % 8) + 8) % 8];
    $("sea-weather").textContent = wind.name + " · wind toward " + windBearing + " · " + (wind.strength * 12).toFixed(0) + " kn";
    const gauges: Record<string, string> = {
      "hull-health": Math.round(sea.integrity) + "% hull · " + Math.round(sea.flooding) + "% flooding · " + Math.round(100 - (sea.fittingWear ?? 0)) + "% fittings",
      "deck-weight": cargoWeight(state, s).toFixed(1) + " / " + (HULLS[sea.hull].tonnes + (s.modules.cargoModule ? 6 : 0)) + " tonnes · " + loadUnits(state, s) + " / " + capacity(state!, s) + " deck spaces",
      "deck-depth": depthAt(s.x, s.z).toFixed(1) + " m depth · " + sailingForces(state, s, Date.now()).draft.toFixed(2) + " m draft",
      "deck-wind": Math.round(sailPower(s.heading, wind, sea.trim, sea.reef) * 100) + "% sail drive · " + (sea.anchor ? "anchor down" : s.port ? "moored" : "underway"),
      "deck-balance": (sea.secured ? "Lashed" : "Loose cargo") + " · " + (Math.abs(sea.balance) < 0.1 ? "balanced" : Math.round(Math.abs(sea.balance) * 100) + "% to " + (sea.balance < 0 ? "port" : "starboard")),
      "deck-work": sea.work ? "Crew at work: " + sea.work.kind : "Deck ready",
      "weather-forecast": wind.name + " now; " + weatherAt(Date.now() + 120000).name + " in two minutes. Amber rings mark shallow water. Approach the glowing berth slowly, with your bow following its arrow.",
    };
    for (const [id, value] of Object.entries(gauges)) { const el = document.getElementById(id); if (el) el.textContent = value; }
    for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-command="anchor"]')) button.disabled = !!s.port || !!s.voyage || Math.abs(s.speed) > 1.2;
    for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-command="bail"]')) button.disabled = sea.flooding <= 0;
    const repairStock = s.port ? state.me.warehouse[s.port] : s.cargo;
    const repairReason = s.voyage ? 'Repair after arrival.' : sea.integrity >= 100 && (sea.fittingWear ?? 0) <= 0 ? 'Hull and fittings are sound.' : !(repairStock.repairKit ?? 0) ? 'Bring one repair kit to '+(s.port ? 'this harbor warehouse.' : 'your hold.') : s.owner !== state.me.id && !s.port ? 'Guests repair at a harbor with their own kit.' : '';
    for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-command="repair"]')) { button.disabled = !!repairReason; button.title = repairReason; }
    const repairHelp = document.getElementById('repair-help');
    if (repairHelp) repairHelp.textContent = repairReason;
    for (const site of SEA_SITES) {
      const distance = Math.hypot(s.x - site.x, s.z - site.z);
      const label = document.querySelector<HTMLElement>('[data-site-distance="' + site.id + '"]');
      if (label) label.textContent = Math.round(distance) + ' m · requires ' + site.gear;
      const button = document.querySelector<HTMLButtonElement>('button[data-command="explore"][data-site="' + site.id + '"]');
      if (button) button.disabled = s.owner !== state.me.id || !sea.anchor || !sea.gear.includes(site.gear) || distance > 8 || (sea.catches[site.id] ?? 0) > Date.now();
    }
    $("connection-state").textContent = reconnecting ? "Reconnecting. Waiting for your saved progress." : state.practice ? "Practice goods stay separate" : "Shared harbor";
    $("account-button").querySelector('span')!.textContent = state.practice ? "Join harbor" : "House";
    $("account-button").setAttribute('aria-label', state.practice ? 'Join shared harbor' : 'House account');
    $("account-intro").textContent = state.practice ? "Your practice goods and Marks stay separate. Join shared play to trade with other merchant houses." : "Signed in as " + state.me.name + ". Save a recovery code to keep access to this house, its vessels and stock.";
    $("selected-boat-name").textContent = s.name;
    $("wallet-link-status").textContent = state.me.wallet ? "House wallet: " + state.me.wallet : state.practice ? "Practice needs no wallet. Join shared play to own fittings on Creditcoin." : !wallet.config ? "You can link a house when this harbor enables Creditcoin trades." : "Link your connected wallet to " + state.me.name + " to own fittings on Creditcoin.";
    $("wallet-connection").textContent = wallet.connection;
    $("wallet-balances").textContent = wallet.balances;
    $("wallet-availability").textContent = !wallet.config ? "Creditcoin trades are not enabled in this harbor. You can connect a wallet and trade ordinary fittings for Marks." : wallet.config.readOnly ? "Creditcoin purchases and fitting changes are paused. You can still check ownership." : !wallet.config.writeEnabled ? "New Creditcoin trades are paused." : "Pay with Sepolia test ETH. Verified payment releases the fitting on Creditcoin Testnet.";
    $("chain-mode").textContent = !wallet.config ? "Creditcoin trades unavailable here" : wallet.config.mode === "local" ? "Local test networks" : "Creditcoin Testnet · test funds only";
    $("wallet-button-label").textContent = wallet.address ? wallet.address.slice(0, 6) + "…" + wallet.address.slice(-4) : "Connect wallet";
    $("wallet-button").title = wallet.connection;
    $("wallet-network").textContent = wallet.address ? "Wallet & house" : "Creditcoin testnet";
    $("wallet-house").hidden = !state.practice;
    $("wallet-bind").hidden = state.practice || !wallet.config || !!state.me.wallet || !wallet.address;
    $<HTMLButtonElement>("wallet-bind").disabled = wallet.busy;
    $<HTMLButtonElement>("wallet-choose").disabled = wallet.busy;
    $("wallet-choose").textContent = wallet.address ? "Manage wallet" : "Connect wallet";
    $("wallet-disconnect").hidden = !wallet.address;
    $("wallet-check-balances").hidden = !state.me.wallet || !wallet.config;
    $<HTMLButtonElement>("wallet-check-balances").disabled = wallet.busy;
    for (const el of document.querySelectorAll<HTMLElement>("[data-account]")) el.hidden = el.dataset.account === "member" ? state.practice : !state.practice;
    $("wallet-action-status").hidden = !wallet.busy;
    $("wallet-action-status").textContent = wallet.busy ? "Waiting for your wallet or the network…" : "";
    $("selected-boat-location").textContent = s.voyage ? "Bound for " + (s.voyage.frontier ? FRONTIER_SITES.find(f => f.id === s.voyage!.frontier)!.name : state.ports[s.voyage.port].name) : s.port ? "Docked · " + state.ports[s.port].name : "At sea";
    $("sea-actions").hidden = !!s.port || !!s.voyage;
    for (const element of document.querySelectorAll<HTMLElement>('[data-frontier-distance]')) {
      const site = FRONTIER_SITES.find(f=>f.id===element.dataset.frontierDistance)!;
      element.textContent = Math.round(Math.hypot(s.x-site.x,s.z-site.z))+' m';
    }
    const windowLabel = document.getElementById('raid-window');
    if (windowLabel) windowLabel.textContent = frontierWindow(Date.now()) ? 'Player raid window open · '+clockText(Math.floor(Date.now()/300000)*300000+120000)+' left' : 'Player raid window opens in '+clockText((Math.floor(Date.now()/300000)+1)*300000);
    for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-command="raid"]')) {
      const target = state.outposts?.find(o => o.id === button.dataset.target);
      button.disabled = !target || !!activeRaid(state, s) || !!s.voyage || !sea.anchor || !sea.gear.includes('cannon') || sea.integrity < 35 || s.deliveries.length > 0 || Math.hypot(s.x-target.x,s.z-target.z)>35 || target.protectedUntil>Date.now() || !!target.owner && !frontierWindow(Date.now()) || (s.cargo.ammunition??0)<(button.dataset.mode==='barrage'?6:3) || s.fuel<(button.dataset.mode==='barrage'?2:1);
    }
    for (const element of document.querySelectorAll<HTMLElement>("[data-until]")) element.textContent = clockText(Number(element.dataset.until));
    for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-opens-at]")) button.disabled = !wallet.config?.writeEnabled || !!wallet.config.readOnly || Date.now() < Number(button.dataset.opensAt);
    for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-closes-at]")) button.disabled = !wallet.config?.writeEnabled || !!wallet.config.readOnly || Date.now() >= Number(button.dataset.closesAt);
    for (const progress of document.querySelectorAll<HTMLProgressElement>("progress[data-ready]")) {
      progress.value = Math.max(0, progress.max - Math.max(0, Number(progress.dataset.ready) - Date.now()) / 1000);
    }
    const training = state.deliveries.find(d => d.id === "practice-timber");
    $("practice-guide").hidden = !state.practice || training?.status === 'delivered';
    const construction = state.workshops.find(w => state!.players[w.owner].npc)?.job;
    if (training) $("practice-guide").textContent = training.status === "open"
      ? "Practice 1 / 4 · Reserve four timber from Reedhaven for this order."
      : training.status === "stocked" ? "Practice 2 / 4 · Load the reserved timber onto your boat."
      : ["aboard", "sailing"].includes(training.status) ? "Your first delivery · Bastion is expecting this timber."
      : training.status === "delivered" ? construction
        ? "Practice 4 / 4 · You received your Marks. The harbor’s cargo rig will be ready in " + clockText(construction.readyAt) + ". Inspect Bastion’s workshop."
        : Object.values(state.items).some(i => state!.players[i.owner].npc && i.installed)
          ? "Practice 4 / 4 · You received your Marks. The harbor office has installed the rig made with your timber."
          : "Practice 4 / 4 · Delivery complete. Your practice progress is saved."
      : "The practice order was cancelled. You can still explore, produce and sail.";
    const departure = state.ports.bastion.move;
    $("departure-notice").hidden = !departure;
    if (departure) $("departure-notice").textContent = Date.now() < departure.departAt
      ? "Bastion departs in " + clockText(departure.departAt) : "Bastion anchors in " + clockText(departure.arriveAt);
    $("quick-health").style.width = Math.max(0, sea.integrity) + '%';
    $("quick-health").parentElement!.setAttribute('aria-label', Math.round(sea.integrity) + '% hull integrity');
    $("quick-anchor-label").textContent = sea.anchor ? 'Raise anchor' : 'Drop anchor';
    const nearest = PORT_IDS.map(p => { const berth = berthPoint(state!.ports[p]); return {p, distance:Math.hypot(s.x-berth.x,s.z-berth.z)}; }).sort((a,b)=>a.distance-b.distance)[0];
    const approach = !s.port && !s.voyage && nearest.distance < 60;
    const aligned = Math.abs(wrapAngle(s.heading + 0.55)) < 0.9, slow = Math.abs(s.speed) <= 1;
    $("docking-guide").hidden = !approach;
    $("docking-guide").textContent = nearest.distance > 6 ? state.ports[nearest.p].name + ' berth · ' + Math.round(nearest.distance) + ' m · follow the glowing arrow' : !slow ? 'Slow down to dock' : !aligned ? 'Turn your bow to follow the berth arrow' : 'Ready to dock';
    const moor = $<HTMLButtonElement>("quick-dock"); moor.hidden = !approach; moor.dataset.port = nearest.p; moor.disabled = nearest.distance > 6 || !aligned || !slow;
    nextCommand = null;
    let objective: [string,string,string,Panel,PortId?] = ['Make your first sale','Find a city buying goods you already own. Your starter stock is in your home warehouse.','Find paid work','chart',s.port ?? state.me.home];
    if (training && state.practice) objective = training.status === 'open' ? ['Your first timber delivery','Bastion needs four timber. Reserve them from your Reedhaven warehouse.','Supply timber','harbor','bastion'] :
      training.status === 'stocked' ? ['Load the order cargo','The timber is reserved. Load it onto your boat at Reedhaven.','Load timber','harbor','reedhaven'] :
      ['aboard','sailing'].includes(training.status) ? ['Bring timber to Bastion','Compare passages, lash the cargo, then set sail. The shipwright pays when it arrives.','Chart the passage','voyage','bastion'] :
      ['Your first trade is complete','You delivered the timber and received your Marks. Join shared play or find another order.','Explore new work','chart'];
    else if ((state.me.career?.rank ?? 0) > 0) objective = ['Your house is growing','Your merchant rank gives you access to boat refits. Check the materials in Shipyard.','See earned refits','shipyard',s.port ?? state.me.home];
    if (training && state.practice && ['open','stocked','aboard'].includes(training.status)) {
      if (training.status === 'open') {
        objective = ['1. Accept your first delivery','Bastion needs 4 timber. You already have it. Reserve the timber, carry it there, and get paid.','Reserve 4 timber','harbor'];
        nextCommand = {action:'supplyDelivery',delivery:training.id,port:'reedhaven',fee:0};
      } else if (training.status === 'stocked' && s.port === training.from) {
        objective = ['2. Put the timber aboard','Your cargo is waiting on the dock. Load it onto your cutter.','Load my boat','harbor'];
        nextCommand = {action:'takeHaul',delivery:training.id};
      } else if (training.status === 'aboard' && !sea.secured) {
        objective = ['3. Tie down the cargo','Lash the timber to tie it down. This reduces damage from rough water.','Lash cargo','deck'];
        nextCommand = {action:'secureCargo'};
      } else if (training.status === 'aboard') objective = ['4. Deliver to Bastion','Review the route’s travel time, fuel and docking fee, then set sail.','Review my trip','voyage','bastion'];
    } else if (!state.practice && !s.voyage && s.port && (state.me.career?.rank ?? 0) === 0) {
      const order = state.deliveries.find(d => d.civic && d.to === s.port && d.status === 'open' && (state!.me.warehouse[s.port!][d.good] ?? 0) >= d.quantity);
      if (order) {
        objective = ['Sell '+order.quantity+' '+GOOD_NAMES[order.good],state.ports[s.port].name+' is buying stock you already own. Deliver it from your warehouse to earn '+order.price+' Marks.','Deliver · earn '+order.price+' Marks','harbor',s.port];
        nextCommand = {action:'supplyCivic',delivery:order.id};
      }
    }
    if (guideActive && !nextCommand) {
      const lesson = guideSteps(guideTopic, state, wallet.config)[guideStep];
      objective = [lesson.title, lesson.status, 'Resume lesson', 'chart'];
    }
    if (s.voyage?.frontier) objective = ['Bound for '+FRONTIER_SITES.find(f=>f.id===s.voyage!.frontier)!.name+' · '+clockText(s.voyage.arriveAt),'Your crew will anchor outside the outpost. Review its defenses and the supplies aboard.','Review frontier','frontier'];
    else if (s.voyage) objective = ['Bound for '+(s.voyage.frontier ? FRONTIER_SITES.find(f => f.id === s.voyage!.frontier)!.name : state.ports[s.voyage.port].name)+' · '+clockText(s.voyage.arriveAt),'Your crew is sailing to the destination. Check the destination’s market for a return delivery.','Find return work','harbor',s.voyage.port];
    const battle = activeRaid(state,s);
    if (battle) objective = ['Cannons engaged · '+clockText(battle.endAt),battle.attack+' attack against '+battle.defense+' defense. The crew is committed until the battle ends.','Battle report','frontier'];
    $("objective").dataset.underway=String(!!s.voyage);
    $("objective-eyebrow").textContent = state.practice ? 'Learn the merchant’s trade' : RANKS[state.me.career?.rank ?? 0];
    $("objective-title").textContent = objective[0]; $("objective-copy").textContent = objective[1];
    const action = $("objective-action"); action.innerHTML = esc(objective[2]) + icon('arrow'); action.dataset.panel = objective[3];
    if (objective[4]) action.dataset.port = objective[4]; else delete action.dataset.port;
    if (guideActive && !s.voyage && !nextCommand) { delete action.dataset.panel; action.dataset.guideResume = "true"; } else delete action.dataset.guideResume;
    if (nextCommand && !s.voyage) { delete action.dataset.panel; action.dataset.nextStep = 'true'; } else delete action.dataset.nextStep;
    (action as HTMLButtonElement).disabled = pending;
    if (guide.open) updateGuideStatus();
  }
  function civicOrders(): string {
    const city = state!.ports[port], orders = state!.deliveries.filter(d => d.civic && d.to === port && d.status === 'open');
    return '<div class="demand-intro">' + icon(CITY_STYLE[port].crest) + '<div><strong>Wanted in ' + city.name + '</strong><p>' + CITY_STYLE[port].title + ' · paid from the city treasury</p></div></div>' +
      (orders.length ? orders.map(d => { const sources=PORT_IDS.filter(p=>p!==d.to && (state!.me.warehouse[p][d.good]??0)>=d.quantity); return '<article class="civic-order">' + icon(d.good) + '<div><strong>' + d.quantity + ' ' + GOOD_NAMES[d.good] + '</strong><small>' +
        (d.project ? 'Workshop annex construction' : {fish:'Meals for residents',fuel:'Lamps and industry',timber:'Homes and harbor repairs',plates:'Public workshops',repairKit:'Annex maintenance'}[d.good as string] ?? 'City provisions') +
        '</small></div><div class="civic-price">' + d.price + ' Marks<small>' + (d.price / d.quantity).toFixed(1) + ' / unit</small></div><div class="civic-actions">' +
        (docked() && (state!.me.warehouse[port][d.good] ?? 0) >= d.quantity ? button('Supply here', 'supplyCivic', {delivery:d.id}) :
          '<small>' + (state!.me.warehouse[port][d.good] ?? 0) + ' / ' + d.quantity + ' in your warehouse here.</small>' + (sources.length ? sources.map(p=>button('Supply from '+state!.ports[p].name,'supplyDelivery',{delivery:d.id,port:p,fee:0})).join('') : button('Find a supply route', 'chart', {}, false, 'panel'))) +
        '</div></article>'; }).join('') : '<p class="empty-state">' + (city.move ? 'City orders resume once the city anchors.' : 'The city has no new orders. Check again after it uses supplies and has Marks to spend.') + '</p>') +
      '<p class="muted">Residents use supplies every five minutes. Selling to the city helps it grow. Harbor fees pay for future orders.</p><div class="button-row">' +
      button('Trade chart','chart',{},false,'panel') + button('City stores','city',{},false,'panel') + '</div>';
  }
  function careerPanel(): string {
    const c = state!.me.career, rank = c?.rank ?? 0, score = (c?.produced ?? 0) + (c?.trades ?? 0) * 2 + (c?.hauled ?? 0) * 3 + (c?.civic ?? 0) * 2, next = [8,25,60][rank];
    return '<div class="career-panel">' + icon('star') + '<strong>' + RANKS[rank] + '</strong><p>' + (c?.produced ?? 0) + ' goods made · ' + (c?.trades ?? 0) + ' trades · ' +
      (c?.hauled ?? 0) + ' hauls · ' + (c?.civic ?? 0) + ' city supply orders</p>' + (next ? '<progress value="' + score + '" max="' + next + '" aria-label="Progress toward ' +
      RANKS[rank + 1] + '"></progress><small>' + (next - score) + ' standing points to ' + RANKS[rank + 1] +
      '. Making goods earns 1 point. Trades and city orders earn 2; deliveries earn 3.</small>' : '<p>Your house is a republic patron. Keep the cities supplied and build your fleet.</p>') + '</div>';
  }
  function refitsPanel(): string {
    const sea = ship().sea ?? newSeamanship();
    return careerPanel() + '<h3>Boat refits</h3>' + Object.entries(REFITS).map(([key,r]) => {
      const fitted = sea.refits?.includes(key), locked = (state!.me.career?.rank ?? 0) < r.rank;
      const stocked = Object.entries(r.inputs).every(([g,n]) => (state!.me.warehouse[port][g as Good] ?? 0) >= n);
      return '<article class="refit-row">' + icon(key === 'hold' ? 'cargoModule' : key === 'sails' ? 'livery' : 'plates') + '<div><strong>' + r.name + '</strong><small>' + r.benefit +
        '</small><p>' + materials(r.inputs) + '</p>' + button(fitted ? 'Fitted' : locked ? RANKS[r.rank] + ' required' : 'Fit upgrade', 'refit', {kind:key}, !!fitted || locked || !docked() || !stocked) +
        (!locked && !fitted && !stocked ? '<small>Bring the listed materials to this warehouse.</small>' : '') + '</div></article>';
    }).join('');
  }
  function chartPanel(): string {
    const needs = state!.deliveries.filter(d => d.status === 'open' && d.buyer !== state!.me.id);
    const point = (p: {x:number;z:number}) => ({x:(p.x + 900) / 3, y:(900 - p.z) / 3});
    const cities = PORT_IDS.map(p => {
      const c = state!.ports[p], at = point(c), resource = state!.resources[p].good;
      const nearest = PORT_IDS.filter(q=>q!==p).sort((a,b)=>Math.hypot(c.x-state!.ports[a].x,c.z-state!.ports[a].z)-Math.hypot(c.x-state!.ports[b].x,c.z-state!.ports[b].z))[0];
      const labelY = at.y + (state!.ports[nearest].z > c.z ? 50 : -115);
      return '<g><circle cx="' + at.x + '" cy="' + at.y + '" r="22" fill="' + CITY_STYLE[p].dark + '" stroke="' + CITY_STYLE[p].color +
        '" stroke-width="2"/><use href="/assets/drift/published-icons.svg#' + CITY_STYLE[p].crest + '" x="' + (at.x-14) + '" y="' + (at.y-14) + '" width="28" height="28" color="' + CITY_STYLE[p].color +
        '"/><text class="city-title" x="' + at.x + '" y="' + labelY + '" text-anchor="middle">' + c.name + '</text><text class="map-goods" x="' + at.x + '" y="' +
        (labelY+36) + '" text-anchor="middle">' + GOOD_NAMES[resource] + ' source</text><text class="map-goods" x="' + at.x + '" y="' + (labelY+72) + '" text-anchor="middle">' + needs.filter(d => d.to===p).length + ' funded orders</text></g>';
    }).join('');
    const lanes = PORT_IDS.flatMap((p,i) => PORT_IDS.slice(i+1).map(q => {
      const a=point(state!.ports[p]),b=point(state!.ports[q]); return '<path d="M' + a.x + ',' + a.y + 'L' + b.x + ',' + b.y + '"/>';
    })).join('');
    const position=point(ship()), move=state!.ports.bastion.move, destination=move ? point(move.to) : null;
    const hasStock = (d: typeof needs[number]) => PORT_IDS.some(p=>p!==d.to&&(state!.me.warehouse[p][d.good]??0)>=d.quantity);
    const runs = needs.filter(d=>(!workGood||d.good===workGood)&&(!stockedWork||hasStock(d))).sort((a,b)=>Number(hasStock(b))-Number(hasStock(a))||b.price/b.quantity-a.price/a.quantity).slice(0,12).map(d=>{
      const offer=state!.listings.filter(l=>l.good===d.good && l.quantity===d.quantity && l.port!==d.to && l.seller!==state!.me.id).sort((a,b)=>a.price-b.price)[0];
      const ownSource=PORT_IDS.find(p=>p!==d.to && (state!.me.warehouse[p][d.good]??0)>=d.quantity);
      const producer=state!.workshops.filter(w=>Object.values(RECIPES).some(r=>r.output===d.good&&r.workshop===w.kind)).sort((a,b)=>Math.hypot(state!.ports[a.port].x-state!.ports[d.to].x,state!.ports[a.port].z-state!.ports[d.to].z)-Math.hypot(state!.ports[b.port].x-state!.ports[d.to].x,state!.ports[b.port].z-state!.ports[d.to].z))[0];
      const from=ownSource??offer?.port??PORT_IDS.find(p=>state!.resources[p].good===d.good)??producer?.port;
      const site=SEA_SITES.find(s=>s.good===d.good), origin=from?state!.ports[from]:site;
      const distance=origin?Math.round(Math.hypot(origin.x-state!.ports[d.to].x,origin.z-state!.ports[d.to].z)):0;
      const costs=offer && !ownSource ? offer.price : null, fee=d.civic?0:marketFee(d.price), margin=costs===null?null:d.price-fee-costs-2;
      return '<article class="trade-run">'+icon(d.good)+'<div><strong>'+d.quantity+' '+GOOD_NAMES[d.good]+' → '+state!.ports[d.to].name+'</strong><p>'+
        (from?state!.ports[from].name+' · '+(ownSource?'your stock available':costs!==null?costs+' Marks listed lot':producer&&producer.port===from?'producer: '+esc(name(producer.owner)):from===d.to?'local supply':'renewable source'):site?site.name+' · requires '+site.gear:'No producing workshop yet')+'<br>'+
        d.price+' Marks funded · '+(d.price/d.quantity).toFixed(1)+' / unit'+(distance?' · '+distance+' m direct · ~'+Math.ceil(distance/shipSpeed(state!, ship()))+'s base sailing':'')+
        '</p></div><span class="margin">'+(margin===null?icon('marks'):(margin>=0?'+':'')+margin)+'</span>'+button('Inspect order','harbor',{port:d.to},false,'panel')+'</article>';
    }).join('');
    const map = '<p class="muted">Crests mark the cities. The gold arrow marks your boat. Lines connect trading partners; use Set sail to plan a safe route.</p><svg class="trade-map" viewBox="0 0 600 600" role="img" aria-label="Outer Reaches city supplies, connections and your position">'+lanes+
      LANDMARKS.map(l=>{const a=point(l);return '<circle cx="'+a.x+'" cy="'+a.y+'" r="'+l.radius/3+'" fill="#6f8a82" opacity=".8"/>';}).join('')+
      LANTERN_BUOYS.map(l=>{const a=point(l);return '<circle cx="'+a.x+'" cy="'+a.y+'" r="5" fill="none" stroke="#ffdc8a" stroke-width="2"><title>'+l.name+' lantern</title></circle>';}).join('')+
      (destination?'<path d="M'+point(state!.ports.bastion).x+','+point(state!.ports.bastion).y+'L'+destination.x+','+destination.y+'" style="stroke:#c6a4ff;stroke-width:4"/><circle cx="'+destination.x+'" cy="'+destination.y+'" r="18" fill="none" stroke="#c6a4ff"/>':'')+
      cities+'<path d="M-8,8L0,-12L8,8L0,4Z" transform="translate('+position.x+' '+position.y+')" style="fill:#ffcf78;stroke:#172039;stroke-width:2;stroke-dasharray:none"/></svg>';
    return '<div class="trade-chart-columns"><section class="trade-work"><h3>Funded work</h3><p class="muted">Orders you can supply appear first, followed by the best price per unit. Travel times are estimates. Use Set sail for route details.</p><details class="form-details"><summary>How margins work</summary><p>The estimate subtracts the matching lot’s price, the market fee and 2 Marks for docking. You still need to cover fuel, repairs, production and any carrier fee. Orders using your own goods show the payment only.</p></details>'+
      '<div class="button-row"><label>Goods <select id="work-good"><option value="">All goods</option>'+GOOD_IDS.map(g=>'<option value="'+g+'"'+(workGood===g?' selected':'')+'>'+GOOD_NAMES[g]+'</option>').join('')+'</select></label><label class="toggle-line"><input id="work-stock" type="checkbox"'+(stockedWork?' checked':'')+'> Show orders I can supply</label></div>'+
      (runs||'<p>No orders match these filters. Try all goods or compare city stores.</p>')+'</section><section class="trade-geography">'+map+'<h3>Recent unit prices</h3><p class="muted">Latest completed trade at each city. A dash means no recorded trade.</p><table class="price-board"><thead><tr><th>Goods</th>'+
      PORT_IDS.map(p=>'<th title="'+state!.ports[p].name+'">'+icon(CITY_STYLE[p].crest)+'<span class="sr-only">'+state!.ports[p].name+'</span></th>').join('')+
      '</tr></thead><tbody>'+GOOD_IDS.map(g=>'<tr><td>'+icon(g)+' '+GOOD_NAMES[g]+'</td>'+PORT_IDS.map(p=>{const t=state!.trades?.find(t=>t.port===p && t.good===g);return '<td>'+(t?(t.total/t.quantity).toFixed(1):'—')+'</td>';}).join('')+'</tr>').join('')+
      '</tbody></table><details class="form-details"><summary>Starting workshop guide prices</summary><p class="muted">Guide prices in Marks per unit. Use them to compare costs. They are not sale offers.</p>'+
      materials(Object.fromEntries(GOOD_IDS.map(g=>[g,GUIDE_PRICE[g]])))+'</details><h3>Choose a harbor</h3><div class="button-row">'+PORT_IDS.map(p=>button(state!.ports[p].name,'harbor',{port:p},false,'panel')).join('')+'</div></section></div>';
  }

  function warehouse(): string {
    const stock = state!.me.warehouse[port], s = ship();
    return (!s.port && !s.voyage ? button("Dock at this berth", "dock", { port }) : "") +
      '<div class="section-title"><h3>Your warehouse</h3><span>' + warehouseUsed(stock) + ' / ' + WAREHOUSE_LIMIT + ' units</span></div>' +
      '<table class="stock-table"><thead><tr><th>Goods</th><th>Warehouse</th><th>Aboard</th></tr></thead><tbody>' +
      GOOD_IDS.map(g => "<tr><td>" + icon(g) + GOOD_NAMES[g] + "</td><td>" + (stock[g] ?? 0) + "</td><td>" + (s.cargo[g] ?? 0) + "</td></tr>").join("") +
      '</tbody></table><form data-form="cargo" class="cargo-form"><label>Goods<select name="good">' + goodOptions() +
      '</select></label><label>Quantity' + amount("quantity", 4) + '</label><div class="button-row"><button name="direction" value="load"' +
      (!docked() ? " disabled" : "") + '>Load cargo</button><button name="direction" value="unload"' + (!docked() ? " disabled" : "") +
      '>Unload cargo</button></div></form>' + (!docked() ? '<p class="muted">Dock here to load, unload, refuel or install equipment.</p>' : "") +
      '<p class="muted">' + (capacity(state!, s)-loadUnits(state!,s)) + ' free deck spaces. Check the warehouse and boat columns before moving goods.</p><form data-form="refuel" class="inline-form"><label>Fuel for tank · ' + Math.min(30-s.fuel,stock.fuel??0) + ' available ' + amount("quantity", Math.max(1,Math.min(2,30-s.fuel,stock.fuel??0)), Math.max(1,Math.min(30-s.fuel,stock.fuel??0))) + '</label><button' + (!docked() || s.fuel>=30 || !(stock.fuel??0) ? " disabled" : "") + '>Refuel</button></form>';
  }
  function deckPanel(): string {
    const s = ship(), sea = s.sea ?? newSeamanship(), own = s.owner === state!.me.id;
    const select = (label: string, key: string, options: string[], value: string) => '<label>' + label + '<select name="' + key + '">' + options.map(o => '<option' + (o === value ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></label>';
    return '<div class="boat-specs"><strong>' + esc(s.name) + '</strong><span>' + HULLS[sea.hull].name + ' · ' + esc(name(s.owner)) + '</span></div>' +
      '<div class="deck-readings"><strong id="hull-health"></strong><span id="deck-weight"></span><span id="deck-depth"></span><span id="deck-wind"></span><span id="deck-balance"></span></div>' +
      '<div class="helm-pad" aria-label="Hold to steer"><button type="button" data-helm="KeyA" aria-label="Turn left">↶</button><button type="button" data-helm="KeyW">Forward</button><button type="button" data-helm="KeyD" aria-label="Turn right">↷</button><button type="button" data-helm="KeyS">Brake / reverse</button></div>' +
      '<form data-form="sails"><fieldset class="sail-setting"><legend>Sail area</legend><div class="segmented">' + [[0, 'Furled'], [1, 'Reefed'], [2, 'Full sail']].map(([value,label]) => '<label><input type="radio" name="reef" value="' + value + '"' + (sea.reef * 2 === value ? ' checked' : '') + '><span>' + icon('livery') + label + '</span></label>').join('') + '</div></fieldset>' +
      '<label class="toggle-line"><input name="autoTrim" type="checkbox"' + (sea.trim < 0 ? ' checked' : '') + '> Crew trims the sail</label><label>Manual sail angle<input name="trim" type="range" min="0" max="90" value="' + Math.max(0, sea.trim) + '"></label>' +
      select('Engine assist', 'engine', ['off', 'on'], sea.engine ? 'on' : 'off') + '<button' + (s.voyage ? ' disabled' : '') + '>Set sails and engine</button></form>' +
      '<p class="muted">Use W/S to move or brake and A/D to turn. Sailing into the wind slows the boat. Turn across the wind to catch it again. An engine uses one fuel every 15 seconds while driving.</p>' +
      '<div class="button-row">' + button(sea.anchor ? 'Raise anchor' : 'Drop anchor', 'anchor', {}, !!s.port || !!s.voyage || Math.abs(s.speed) > 1.2) + button('Lash cargo', 'secureCargo') + button('Bail water', 'bail', {}, sea.flooding <= 0) + button('Repair · 1 kit', 'repair', {}, (sea.integrity >= 100 && (sea.fittingWear ?? 0) <= 0) || !!s.voyage) + '</div>' +
      '<p id="repair-help" class="muted"></p><form data-form="balanceCargo"><fieldset class="sail-setting"><legend>Balance the cargo</legend><div class="segmented">' + [[-1, 'Port'], [0, 'Center'], [1, 'Starboard']].map(([value,label]) => '<label><input type="radio" name="balance" value="' + value + '"' + (sea.balance === value ? ' checked' : '') + '><span>' + label + '</span></label>').join('') + '</div></fieldset><button>' + icon('cargoModule') + 'Move cargo</button></form><p id="deck-work" aria-live="polite"></p>' +
      '<h3>Weather and docking</h3><p id="weather-forecast"></p>' +
      '<h3>Expedition equipment</h3><p class="muted">Each fitting uses 2 timber and 1 plate from this harbor. The salvage winch also needs a cargo rig.</p><div class="button-row">' +
      [['fishing', 'Fishing lines'], ['salvage', 'Salvage winch'], ['sounder', 'Lead-line sounder']].map(([gear, label]) => button(sea.gear.includes(gear) ? label + ' fitted' : 'Fit ' + label.toLowerCase(), 'fitGear', { gear }, !own || !s.port || sea.gear.includes(gear))).join('') + '</div>' +
      SEA_SITES.map(site => '<article class="sea-site"><strong>' + (sea.discovered.includes(site.id) ? site.name : 'Uncharted signal') + '</strong><p data-site-distance="' + site.id + '">' + Math.round(Math.hypot(s.x - site.x, s.z - site.z)) + ' m · requires ' + site.gear + '</p>' +
        '<div class="button-row"><button type="button" data-site="' + site.id + '">Chart course</button>' + button('Gather at this site', 'explore', { site: site.id }, !own || !sea.anchor || !sea.gear.includes(site.gear) || Math.hypot(s.x - site.x, s.z - site.z) > 8) + '</div></article>').join('') +
      '<h3>Voyage crew</h3><p>Captain: ' + esc(name(s.owner)) + '. ' + (sea.crew.length ? sea.crew.map(id => esc(name(id))).join(', ') : 'Two guest berths available.') + '</p><p class="muted">Guests can steer, adjust sails, load their own goods and bail water. At a harbor, they can use their own repair kits. The captain plans trips and handles trade.</p>' +
      (own ? button(sea.openCrew ? 'Close crew invitation' : 'Invite a deck crew', 'openCrew') : button('Return to my boat', 'leaveCrew')) +
      Object.values(state!.ships).filter(v => v.owner !== state!.me.id && v.sea?.openCrew && v.port && v.port === s.port).map(v => '<p>' + esc(v.name) + ' ' + button('Join crew', 'joinCrew', { target: v.id }, !own) + '</p>').join('') +
      (!s.port && !s.voyage && own ? '<details class="form-details"><summary>Call a harbor tug</summary><p>Recovery costs 10 Marks plus 1 per 5 m to the chosen berth. Cargo stays aboard. The tow travels at 2 m/s; repairs are separate.</p>' + PORT_IDS.map(p => button('Tow to ' + state!.ports[p].name, 'recover', { port: p })).join('') + '</details>' : '');
  }
  function offers(): string {
    const listings = state!.listings.filter(l => l.port === port);
    return '<div class="section-title"><h3>Player offers</h3><span>Whole lots · Marks</span></div>' + (listings.length ? listings.map(l => {
      const title = l.item ? itemName(state!.items[l.item]) : l.quantity + " " + GOOD_NAMES[l.good!];
      return '<article class="trade-row"><div><strong>' + icon(l.item ? state!.items[l.item].kind : l.good!) + esc(title) + '</strong><span>' + esc(name(l.seller)) + ' · ' + (l.price / (l.item ? 1 : l.quantity)).toFixed(1) + ' Marks / unit</span></div><strong>' + l.price +
        ' Marks</strong><div class="trade-actions">' + (l.seller === state!.me.id
          ? button("Cancel offer", "cancelListing", { listing: l.id }) + l.offers.map(o =>
            '<p>' + esc(name(o.buyer)) + ": " + o.price + " Marks " + button("Accept quote", "acceptCounter", { listing: l.id, buyer: o.buyer }) + "</p>").join("")
          : button("Buy lot", "buyListing", { listing: l.id }) +
            '<form data-form="counterListing" class="inline-form"><input type="hidden" name="listing" value="' + esc(l.id) + '">' + amount("price", l.price) + '<button>Offer a price</button></form>') +
        "</div></article>";
    }).join("") : '<p class="empty-state">No sale offers here yet. List goods from your warehouse or request a delivery.</p>') +
      '<details class="form-details"><summary>List your warehouse stock</summary><p class="muted">The city receives 5% of each sale, rounded up to a whole Mark. You receive the rest.</p><form data-form="listGoods"><label>Goods<select name="good">' + goodOptions() +
      '</select></label><div class="form-columns"><label>Quantity' + amount("quantity", 4) + '</label><label>Lot price · Marks' + amount("price", 40, 1_000_000) +
      '</label></div><button' + (!docked() ? " disabled" : "") + '>Reserve stock and list</button></form></details>';
  }
  function deliveries(onlyPractice = false): string {
    const mine=state!.me.id, live=state!.deliveries.filter(d=>(onlyPractice ? d.id==='practice-timber' : d.id!=='practice-timber'&&(!d.civic||d.status!=='open')) && !['delivered','cancelled'].includes(d.status) && (d.to===port || d.from===port || d.supplier===mine || d.carrier===mine));
    return '<div class="section-title"><h3>Delivery orders</h3><span>Payment reserved</span></div>'+live.map(d=>{
      let actions='';
      if(d.status==='open' && d.buyer!==mine && (!d.supplier || d.supplier===mine)){
        const sources=PORT_IDS.filter(p=>p!==d.to), selected=sources.includes(ship().port!)?ship().port:sources[0];
        actions+='<details class="form-details"'+(onlyPractice?' open':'')+'><summary>Supply from another harbor</summary><form data-form="supplyDelivery" class="inline-form"><input type="hidden" name="delivery" value="'+esc(d.id)+'"><label>Warehouse<select name="port">'+
          sources.map(p=>'<option value="'+p+'"'+(p===selected?' selected':'')+'>'+state!.ports[p].name+' · '+(state!.me.warehouse[p][d.good]??0)+' available</option>').join('')+
          '</select></label><label>Carrier payment'+amount('fee',0,Math.max(0,d.price-(d.civic?0:marketFee(d.price))),0)+'</label><button>'+icon('cargoModule')+'Reserve goods</button></form><p class="muted">Supplier receives '+d.price+' minus the agreed carrier payment'+(d.civic?'.':' and '+marketFee(d.price)+' Marks city fee.')+'</p></details>'+
          (!d.civic?'<form data-form="counterDelivery" class="inline-form"><input type="hidden" name="delivery" value="'+esc(d.id)+'"><label>Your total quote'+amount('price',d.price)+'</label><button>Quote a price</button></form>':'');
      }
      if(d.status==='stocked'){
        if(d.from===ship().port && (d.fee>0 || d.supplier===mine) && (!d.reservedCarrier || d.reservedCarrier===mine)) actions+=button('Load order cargo','takeHaul',{delivery:d.id});
        if(d.supplier!==mine) actions+='<form data-form="quoteHaul" class="inline-form"><input type="hidden" name="delivery" value="'+esc(d.id)+'"><label>Your hauling fee'+amount('fee',Math.min(state!.me.haulRate??12,d.price-(d.civic?0:marketFee(d.price))),d.price-(d.civic?0:marketFee(d.price)))+'</label><button>'+icon('chat')+'Quote delivery fee</button></form>';
        if(d.supplier===mine) actions+=(d.haulOffers??[]).map(o=>'<p>'+esc(name(o.carrier))+' · '+o.fee+' Marks '+button('Hire carrier','acceptHaulQuote',{delivery:d.id,carrier:o.carrier})+'</p>').join('');
      }
      if((d.buyer===mine||d.supplier===mine)&&d.status!=='sailing') actions+=button('Cancel order','cancelDelivery',{delivery:d.id});
      if(d.buyer===mine) actions+=d.offers.map(o=>'<p>'+esc(name(o.supplier))+': '+o.price+' Marks '+button('Accept quote','acceptDeliveryCounter',{delivery:d.id,supplier:o.supplier})+'</p>').join('');
      const waiting=d.status==='sailing' && d.ship && state!.ships[d.ship]?.port===d.to && !state!.ships[d.ship]?.voyage;
      return '<article class="delivery-row"><strong>'+icon(d.good)+d.quantity+' '+GOOD_NAMES[d.good]+'</strong><span class="price">'+icon('marks')+d.price+' Marks · '+(d.price/d.quantity).toFixed(1)+' / unit</span><p>'+
        (d.from?state!.ports[d.from].name+' → ':'Deliver to ')+state!.ports[d.to].name+'</p><p class="muted">'+esc(name(d.buyer))+' · '+(waiting?'Arrived. Waiting for room in the buyer’s warehouse.':DELIVERY_STATUS[d.status]+' · <span data-until="'+d.deadline+'">'+clockText(d.deadline)+'</span>')+'</p>'+
        (d.note?'<p class="order-note">'+esc(d.note)+'</p>':'')+(d.supplier?'<p class="muted">Supplier: '+esc(name(d.supplier))+' · carrier earns '+d.fee+' Marks'+(d.reservedCarrier?' · reserved for '+esc(name(d.reservedCarrier)):'')+'</p>':'')+
        '<div class="trade-actions">'+actions+'</div></article>';
    }).join('')+(live.length?'':'<p class="empty-state">No active orders here. Compare other harbors or post your own request.</p>')+
      (onlyPractice ? '' : '<details class="form-details"><summary>Request a delivery to this harbor</summary><form data-form="requestDelivery"><label>Goods<select name="good">'+goodOptions()+'</select></label><div class="form-columns"><label>Quantity'+amount('quantity',4,16)+'</label><label>Total payment'+amount('price',80,1_000_000)+'</label><label>Deadline · minutes'+amount('minutes',20,60)+'</label></div><label>Order note<input name="note" maxlength="120" placeholder="Please deliver before Bastion moves"></label><button>'+icon('marks')+'Reserve Marks and post</button></form></details>'+
      '<details class="form-details"><summary>Carrier directory</summary><p class="muted">Offer to carry an order that is ready to load. The supplier accepts your fee. You receive it when the delivery completes.</p>'+
      Object.values(state!.players).filter(p=>!p.npc&&p.available&&p.id!==mine).map(p=>'<p>'+icon('cutter')+esc(p.name)+' · asks '+(p.haulRate??12)+' Marks / haul</p>').join('')+
      '<form data-form="carrierProfile"><label>Your starting fee'+amount('rate',state!.me.haulRate??12,200)+'</label><label class="toggle-line"><input type="checkbox" name="available"'+(state!.me.available?' checked':'')+'>Available for hauling</label><button>Update availability</button></form></details>');
  }
  function workshopPanel(): string {
    const own = state!.workshops.filter(w => w.port === port && w.owner === state!.me.id);
    const resource = state!.resources[port], gathering = state!.extraction.find(j => j.player === state!.me.id && j.port === port);
    const office = state!.practice ? state!.workshops.find(w => w.port === port && state!.players[w.owner].npc) : undefined;
    return (office?.job ? '<div class="practice-guide">Harbor construction: your timber is becoming a cargo rig. <strong data-until="' + office.job.readyAt + '">' + clockText(office.job.readyAt) + '</strong><progress max="90" value="0" data-ready="' + office.job.readyAt + '" aria-label="Harbor cargo rig construction"></progress></div>' : "") +
      '<div class="resource-strip"><strong>' + icon(resource.good) + GOOD_NAMES[resource.good] + " grounds</strong><span>" + resource.available + " available</span></div>" +
      (gathering ? '<p>Gathering ' + gathering.quantity + " · ready in <strong data-until=\"" + gathering.readyAt + "\">" + clockText(gathering.readyAt) + "</strong></p>"
        : '<form data-form="extract" class="inline-form"><label>Gather ' + amount("quantity", Math.max(1, Math.min(6, resource.available)), Math.max(1, Math.min(12, resource.available))) + '</label><button' + (!own.length || resource.available < 1 ? " disabled" : "") + '>' + icon(resource.good) + 'Send crew · 30s</button></form><p class="muted">Gathering pays 1 Mark per two units to the city. Your local workshop sends the crew.</p>') +
      own.map(w => '<article class="workshop"><h3>' + icon(w.kind === 'refinery' ? 'fuel' : w.kind === 'foundry' ? 'forge' : 'shipyard') + esc(w.kind[0].toUpperCase() + w.kind.slice(1)) + '</h3>' + (specialist(state!.me, w) ? '<span class="specialist-badge">' + icon('star') + 'Home specialist · faster work, better fittings</span>' : '<p class="muted">This workshop works at the standard speed. Your home specialty works faster.</p>') + (w.job
        ? '<p class="production-job"><strong>' + RECIPES[w.job.recipe].name + '</strong><span>' + w.job.batches + (w.job.batches === 1 ? ' batch' : ' batches') + ' · <b data-until="' + w.job.readyAt + '">' +
          clockText(w.job.readyAt) + '</b></span><progress max="' + craftSeconds(state!, w, w.job.recipe, w.job.batches) + '" value="0" data-ready="' + w.job.readyAt +
          '" aria-label="Production underway"></progress><small>Materials are set aside. Your goods finish while you are away.</small></p>'
        : "") + '<p class="muted">Queue: ' + (w.queue?.map(j => RECIPES[j.recipe].name).join(' → ') || 'empty') + '</p>' + Object.entries(RECIPES).filter(([, r]) => r.workshop === w.kind).map(([key, r]) =>
          (() => { const rigs = Object.values(state!.items).filter(i => i.owner === state!.me.id && i.kind === 'cargoModule' && !i.tier && !i.consumed && !i.installed && !i.listing && !i.chain && i.port === port).slice(0,2); const available = Math.max(0, Math.min(r.components ? rigs.length === 2 ? 1 : 0 : 10, Math.floor(state!.me.marks / 2), ...Object.entries(r.inputs).map(([g,n])=>Math.floor((state!.me.warehouse[port][g as Good]??0)/n)))); return '<form data-form="craft" class="recipe"><input type="hidden" name="workshop" value="' + esc(w.id) + '"><input type="hidden" name="recipe" value="' + key +
          '"><div><strong class="recipe-head">' + icon(r.output) + r.name + '</strong><p class="recipe-flow">' + materials(r.inputs) + icon('arrow') + icon(r.output) + r.quantity + ' ' + (r.tier ? 'Reinforced cargo rig' : GOOD_NAMES[r.output]) + '</p><small>' + craftSeconds(state!, w, key, 1) +
          's per batch · 2 Marks city fee · ' + state!.deliveries.filter(d => d.status === 'open' && d.good === r.output).reduce((n,d) => n + d.quantity, 0) + ' units wanted<br>Estimated materials and fee: ' + Object.entries(r.inputs).reduce((n,[g,q]) => n + GUIDE_PRICE[g as keyof typeof GUIDE_PRICE] * q, 2 + (r.components ?? 0) * GUIDE_PRICE.cargoModule) + ' Marks / batch · ' + available + ' batches possible from your stock and funds.</small>' + (r.components ? '<p class="order-note">Consumes two ordinary rigs: '+(rigs.map(i=>esc(i.id)).join(' + ') || 'craft two first')+'. Output adds 8 deck spaces, weighs 2 tonnes, and reduces sailing speed by 25%. Trade this reinforced rig for Marks only.</p>'+rigs.map(i=>'<input type="hidden" name="items" value="'+esc(i.id)+'">').join('') : '') + '</div><label>Batch' + amount("batches", 1, Math.max(1, available)) + '</label><button' + ((w.queue?.length ?? 0) >= 2 || !available ? ' disabled' : '') + '>' + icon('workshop') + (r.components ? 'Use two rigs to upgrade' : w.job ? 'Queue batch' : 'Make batch') + '</button></form>'; })()).join("") + "</article>").join("") +
      (!own.length ? '<p class="empty-state">You have no workshop here. Choose your home harbor or build a workshop below.</p>' : "") +
      '<details class="form-details"><summary>Build another workshop</summary><p class="muted">60 Marks, 8 timber and 4 plates. ' + state!.workshops.filter(w => w.port === port).length + ' / ' + workshopLimit(state!, port) + ' berths occupied. Supplying the city creates more workshop spaces. Your home specialty still works faster.</p><form data-form="buildWorkshop">' +
      '<label>Workshop<select name="kind"><option value="refinery">Refinery</option><option value="foundry">Foundry</option><option value="shipyard">Shipyard</option></select></label><button' +
      (!docked() ? " disabled" : "") + '>Build workshop</button></form></details>';
  }
  function shipyardPanel(): string {
    const s = ship(), paint = preview ?? s.look;
    const items = Object.values(state!.items).filter(i => i.owner === state!.me.id && !i.consumed);
    return '<div class="boat-specs">' + icon(s.sea?.hull ?? 'cutter') + '<div><strong>' + esc(s.name) + '</strong><span>' + capacity(state!, s) + " deck spaces · " + shipSpeed(state!, s).toFixed(1) +
      ' m/s sailing · ' + (s.modules.engine ? "engine fitted" : "sail power") + '</span></div></div>' + commissions() + refitsPanel() +
      '<details class="form-details"><summary>Livery & finish preview</summary><div class="paint-preview"><div class="section-title"><h3>The livery workshop</h3><span>Finish preview</span></div>' +
      '<p class="livery-description">Choose colors for a cargo rig or livery kit. This preview shows how they will look on your boat.</p>' +
      '<div class="paint-inputs"><label>Hull<input id="hull-color" type="color" value="' + esc(paint.hull) + '"></label><label>Sail<input id="sail-color" type="color" value="' +
      esc(paint.sail) + '"></label></div><div id="paint-swatches">' + [
        ["Bluewater", "#244e73", "#f4e8cf"], ["Kelp Guild", "#24776e", "#efe3b5"], ["Emberwake", "#a63f32", "#f4e8cf"], ["Pearl", "#e1ddd0", "#d6e4e6"],
      ].map(([label, color, sail]) => '<button type="button" data-paint="' + color + '" data-sail="' + sail + '" style="--swatch:' + color + ';--sail:' + sail + '" aria-label="' + label +
        ' finish" aria-pressed="' + (paint.hull === color && paint.sail === sail) + '"><span class="finish-cloth" aria-hidden="true"></span><span>' + label + '</span></button>').join("") +
      '</div><p class="muted">Previewing does not change your boat. Craft a rig or livery kit in these colors, then install it.</p>' +
      '<div class="button-row"><button type="button" id="btn-inspect">Inspect boat</button><button type="button" data-cancel-preview>Cancel preview</button></div></div></details>' +
      '<h3>Your fittings</h3>' + (items.length ? items.map(i => {
        const place = i.installed ? "Installed on " + state!.ships[i.installed]?.name : i.port ? state!.ports[i.port].name : i.ship ? "Aboard " + state!.ships[i.ship]?.name : "Unavailable";
        const available = !i.listing && !i.installed && !i.chain;
        let actions = "";
        if (i.installed && i.installed === s.id) actions = i.chain
          ? walletButton("Remove on Creditcoin", "uninstall", { item: i.id }, !docked() || !!i.chain.task || !!s.chainPending)
          : button("Remove fitting", "uninstall", { kind: i.kind }, !docked());
        if (available) {
          actions += button("Install", "install", { item: i.id }, !docked() || !(i.port === port || i.ship === s.id));
          if (i.ship === s.id) actions += button("Unload fitting", "moveItem", { item: i.id, direction: "unload" }, !docked());
          if (i.port === port) actions += button("Load fitting · 4 spaces", "moveItem", { item: i.id, direction: "load" }, !docked()) +
            '<form data-form="listItem" class="inline-form"><input type="hidden" name="item" value="' + esc(i.id) + '">' + amount("price", 100, 1_000_000) + '<button' +
            (!docked() ? " disabled" : "") + '>List for Marks</button></form>';
          if (!state!.practice && !i.tier && i.port === port) actions += walletButton("Record on Creditcoin", "mint", { item: i.id }, !docked() || !wallet.config || !state!.me.wallet);
        }
        if (available && i.port === port) actions += '<details class="salvage-confirm"><summary>Dismantle for materials</summary><p>Consumes this '+itemName(i)+'. Recover '+materials(salvageYield(i))+'.</p>'+button('Dismantle fitting', 'salvageItem', {item:i.id}, !docked() || !state!.workshops.some(w=>w.owner===state!.me.id && w.port===port && w.kind==='shipyard'))+'</details>';
        if (i.chain?.status === "owned" && !i.installed) actions += walletButton("Install on Creditcoin", "install", { item: i.id }, !docked() || i.port !== port || !!i.chain.task || !!s.chainPending);
        if (i.chain?.status === "minting" && !i.chain.task) actions += walletButton("Retry publication", "mint", { item: i.id }, !docked());
        return '<article class="item-row"><div class="item-swatch" style="--swatch:' + esc(i.look.hull) + '">' + fittingArt(i.kind) + '</div><div><strong>' + itemName(i) +
          '</strong><span>' + esc(place) + '</span><small>Made by ' + esc(name(i.maker)) + (i.listing ? " · listed for sale" : "") +
          (i.chain ? " · Creditcoin " + esc(({minting:"awaiting publication",owned:"ownership confirmed",escrow:"reserved for sale",consumed:"used"})[i.chain.status]) + (i.chain.task ? " · " + ({mint:"recording ownership",install:"installing",uninstall:"removing"})[i.chain.task] : "") : "") + '</small>' +
          (i.chain?.error ? '<p class="chain-error">' + esc(i.chain.error) + '</p>' : "") + '</div><div class="trade-actions">' + actions + "</div></article>";
      }).join("") : '<p class="empty-state">Craft a rig, engine or livery kit, or buy one from another player. Your fittings appear here.</p>') +
      customization() +
      '<form data-form="renameShip" class="inline-form"><label>Boat name<input name="name" maxlength="24" value="' + esc(s.name) + '" required></label><button>Rename</button></form><details class="form-details" data-chain-market><summary>Creditcoin fitting market</summary>' + chainMarket() + '</details>';
  }
  function customization(): string {
    const s = ship(), finish = (s.sea ?? newSeamanship()).finish;
    const choices: Record<keyof typeof finish, string[]> = { pattern: ['crest', 'striped', 'plain'], material: ['enamel', 'timber', 'copper'],
      cabin: ['copper', 'canvas', 'flat'], railing: ['brass', 'rope'], flag: ['swallowtail', 'square', 'none'], figurehead: ['none', 'gull', 'sun'], lamps: ['on', 'off'] };
    const completed = state!.deliveries.filter(d => d.status === 'delivered' && (d.carrier === state!.me.id || d.supplier === state!.me.id));
    const customers = new Set(completed.map(d => d.buyer));
    return '<details class="form-details"><summary>Cabin, cloth & deck details</summary><p>Shipwright fitting service · 20 Marks. Owned livery colors stay on the vessel.</p><form data-form="customize"><div class="form-columns">' +
      Object.entries(choices).map(([key, values]) => '<label>' + key[0].toUpperCase() + key.slice(1) + '<select name="' + key + '">' + values.map(value => '<option' +
        (String(key === 'lamps' ? finish.lamps ? 'on' : 'off' : finish[key as keyof typeof finish]) === value ? ' selected' : '') + '>' + value + '</option>').join('') + '</select></label>').join('') +
      '</div><button' + (!docked() || s.owner !== state!.me.id ? ' disabled' : '') + '>Fit details · 20 Marks</button></form></details>' +
      '<h3>House work record</h3><p>' + completed.length + ' completed deliveries · ' + customers.size + ' customers · ' + Math.max(0, completed.length - customers.size) + ' repeat orders.</p><p class="muted">House initials appear on your crest and nameplate. A brass trophy is mounted after your first completed delivery. Hull maker: ' + esc(name(s.maker ?? s.owner)) + '.</p>';
  }
  function commissions(): string {
    const builders = state!.workshops.filter(w => w.kind === 'shipyard' && w.port === port);
    return '<h3>Commission a boat</h3><form data-form="commissionShip"><fieldset class="hull-options"><legend>Choose a hull</legend>' + Object.entries(HULLS).map(([key, h]) => '<label class="hull-option"><input type="radio" name="hull" value="'+key+'"'+(key==='cutter'?' checked':'')+' aria-label="'+h.name+'">' + icon(key) + '<span><strong>' + h.name + '</strong><small>' + h.hold + ' deck spaces · ' + h.tonnes + ' t · ' + h.speed + ' m/s · ' + h.draft + ' m draft<br>' + h.timber + ' timber + ' + h.plates + ' plates + 2 fuel</small></span></label>').join('') +
      '</fieldset>'+(!builders.length?'<p class="muted">No shipwright has a workshop here. Choose a harbor with a shipyard or establish one.</p>':'')+'<label>Shipwright<select name="builder">' + builders.map(w => '<option value="' + esc(w.owner) + '">' + esc(name(w.owner)) + '</option>').join('') +
      '</select></label><label>Boat name<input name="name" maxlength="24" required value="New Horizon"></label><label>Shipwright payment · Marks' + amount('price', 60, 100000, 0) +
      '</label><button' + (!docked() || !builders.length ? ' disabled' : '') + '>Reserve Marks and commission boat</button></form><p class="muted">The shipwright must accept your offer. Any house can contribute materials. Construction takes one minute once all supplies arrive. A home shipyard specialist builds boats that sail 8% faster. The maker receives payment at launch, less any agreed advance repayment. Commissions expire after 30 minutes. Unfinished orders return the buyer’s payment and contributed materials.</p>' +
      (state!.builds ?? []).filter(b => b.port === port).slice(-8).map(b => {
        const h = HULLS[b.hull], needs = { timber: h.timber, plates: h.plates, fuel: 2 };
        return '<article class="commission"><strong>' + esc(b.name) + ' · ' + h.name + '</strong><p>' + esc(name(b.builder)) + ' → ' + esc(name(b.buyer)) + ' · ' + b.price + ' Marks</p>' + (b.expiresAt && !b.cancelled && !b.launched ? '<p>Deadline in <span data-until="'+b.expiresAt+'">'+clockText(b.expiresAt)+'</span>.</p>' : '') +
          (!b.cancelled && !b.launched && b.accepted === false ? '<p>Awaiting the shipwright’s acceptance.</p>' + (b.builder === state!.me.id ? button('Accept commission', 'acceptBuild', {build:b.id}) : '') : '') +
          (b.cancelled ? '<p>Closed · buyer and contributors refunded.</p>' : b.launched ? '<p>Launched · maker recorded</p>' : b.readyAt ? '<p>Building · <b data-until="' + b.readyAt + '">' + clockText(b.readyAt) + '</b></p><progress max="60" value="0" data-ready="' + b.readyAt + '" aria-label="Vessel construction"></progress>' :
            '<p>' + Object.entries(needs).map(([good, n]) => icon(good) + (b.stock[good as keyof typeof needs] ?? 0) + '/' + n + ' ' + good).join(' · ') + '</p><form data-form="contributeBuild" class="inline-form"><input type="hidden" name="build" value="' + esc(b.id) + '"><label>Material<select name="good"><option>timber</option><option>plates</option><option>fuel</option></select></label><label>Units' + amount('quantity', 1) + '</label><button' + (!docked() ? ' disabled' : '') + '>Contribute</button></form>' + (b.buyer === state!.me.id || b.builder === state!.me.id ? button('Cancel and return contributions', 'cancelBuild', { build: b.id }) : '')) + advancePanel(b) + '</article>';
      }).join('');
  }
  function advancePanel(b: Build): string {
    const loan = b.finance, mine = state!.me.id;
    if (!loan) return b.builder === mine && b.buyer !== mine && b.accepted && !b.readyAt && !b.launched && !b.cancelled && b.price >= 2 ?
      '<details><summary>Borrow Marks for materials</summary><p>Borrow Marks from another house before construction starts. Repayment comes from your '+b.price+' Marks launch payment. If the commission is cancelled or expires, the lender takes your available Marks, up to the amount borrowed. Any unpaid amount stays as debt. You must repay it before borrowing again.</p><form data-form="requestAdvance"><input type="hidden" name="build" value="'+esc(b.id)+'"><label>Borrow · up to half the commission, maximum 100 Marks'+amount('principal',Math.min(80,Math.floor(b.price/2)),Math.min(100,Math.floor(b.price/2)))+'</label><label>Repay · amount borrowed plus up to 10%'+amount('repayment',Math.floor(Math.min(80,Math.floor(b.price/2))*1.1),b.price)+'</label><button>Offer these terms</button></form></details>' : '';
    return '<div class="advance-terms"><strong>Loan for materials · '+loan.status+'</strong><p>'+loan.principal+' Marks '+(loan.status==='requested'?'requested':'advanced')+' → '+loan.repayment+' from launch payment · maker keeps '+(b.cancelled?0:b.price-loan.repayment)+'.</p>'+
      (loan.status==='requested' && !b.cancelled && !b.launched && !b.readyAt && b.builder!==mine && b.buyer!==mine ? '<p>If the commission fails, repayment comes only from the builder’s available Marks. You could lose the amount you lend.</p>'+button('Advance '+loan.principal+' Marks · accept risk','fundAdvance',{build:b.id,principal:loan.principal,repayment:loan.repayment},state!.me.marks<loan.principal) : '')+
      (loan.status==='defaulted' ? '<p>'+loan.debt+' Marks owed to '+esc(name(loan.lender))+'.</p>'+(b.builder===mine?button('Repay '+loan.debt+' Marks','repayAdvance',{build:b.id},state!.me.marks<loan.debt):'') : '')+'</div>';
  }
  function chainMarket(): string {
    const config = wallet.config;
    const title = '<h3 id="chain-market" tabindex="-1">Creditcoin fitting market</h3><div class="chain-route"><span><img src="/assets/drift/chains/ethereum.png" alt="" width="28" height="28">' + (config?.mode === 'local' ? 'Local source' : 'Sepolia payment') + '</span><span aria-hidden="true">→</span><span><img src="/assets/drift/chains/creditcoin.svg" alt="" width="28" height="28">' + (config?.mode === 'local' ? 'Local items' : 'Creditcoin ownership') + '</span></div><div class="button-row"><button type="button" data-guide="wallet">Wallet setup</button><button type="button" data-guide="sell">Seller guide</button><button type="button" data-guide="buy">Buyer guide</button></div>';
    if (state!.practice) return title + '<p class="muted">Creditcoin records ownership of fittings traded between merchant houses. Join shared play to use this market. Practice goods stay separate.</p>';
    if (!config) return title + '<p class="muted">Creditcoin trades are not enabled in this harbor. You can still use ordinary fittings or sell them for Marks.</p>';
    const me = state!.me.id, settlement = state!.settlement;
    const available = Object.values(state!.items).filter(i => i.owner === me && i.chain?.status === "owned" && !i.installed && !i.consumed && !i.chain.task && i.port === port);
    const buyers = Object.values(state!.players).filter(p => p.id !== me && p.wallet && !p.npc);
    const orders = settlement?.orders.filter(o => o.seller === me || o.buyer === me) ?? [];
    const paused = !!config.readOnly || !config.writeEnabled;
    return title + '<p class="network-note">' + (config.mode === "local" ? 'Local contract rehearsal · local test ETH' : 'Sepolia → Creditcoin testnet · test ETH') + '</p>' +
      (!state!.me.wallet ? walletButton("Link wallet", "bind") : '<p class="muted">Wallet ' + esc(state!.me.wallet.slice(0, 8)) + '…' + esc(state!.me.wallet.slice(-6)) + '</p>') +
      (config.readOnly ? '<p class="chain-error">Creditcoin purchases and fitting changes are paused. You can link a wallet and check ownership.</p>' : !config.writeEnabled ? '<p class="chain-error">Creditcoin transactions are paused. Check again later.</p>' : '') +
      (settlement?.error ? '<p class="chain-error">' + esc(settlement.error) + '</p>' : '') +
      '<p class="muted">Record a crafted fitting on Creditcoin and reserve it for a buyer. They pay in Sepolia test ETH. Creditcoin verifies that payment before transferring ownership. The game submits publication and installation changes. Marks are not used for this purchase.</p>' +
      (available.length && buyers.length ? '<details class="form-details"><summary>Quote an item to another house</summary><form data-form="chainOrder"><label>Item<select name="item">' +
        available.map(i => '<option value="' + esc(i.id) + '">' + itemName(i) + ' · ' + esc(i.id) + '</option>').join('') +
        '</select></label><label>Buyer<select name="buyer">' + buyers.map(p => '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>').join('') +
        '</select></label><label>Price · test ETH<input name="price" inputmode="decimal" value="0.0001" required></label><label>Payment window · minutes' + amount("minutes", 30, 120, 5) +
        '</label><button' + (paused ? ' disabled' : '') + '>Create quote</button></form></details>' : '<p class="muted">To create a quote, keep an uninstalled Creditcoin fitting in this harbor. The buyer must be another house with a linked wallet.</p>') +
      orders.map(o => {
        const buyer = o.buyer === me, seller = o.seller === me;
        const expired = o.terms.expires * 1000 < Date.now();
        const status = ({ draft: 'Quote ready for the seller', reserved: 'Fitting reserved on Creditcoin', paymentObserved: 'Payment found; ownership transfer pending', verificationPending: o.sourcePaid === false ? 'Unpaid return awaiting verification' : 'Payment verification pending', owned: 'Ownership verified; buyer owns fitting', cancelled: 'Unpaid order closed; fitting returned' })[o.status];
        const txLink = (hash: string | undefined, side: 'source' | 'destination', label: string) => hash && config[side].explorer ? '<a href="' + esc(config[side].explorer + '/tx/' + hash) + '" target="_blank" rel="noopener">' + label + '</a> ' : '';
        return '<article class="chain-order"><strong>' + esc(GOOD_NAMES[state!.items[o.item].kind]) + ' · ' + formatEther(BigInt(o.terms.amount)) + ' test ETH</strong>' +
          '<p>' + esc(name(o.seller)) + ' → ' + esc(name(o.buyer)) + '</p><p class="chain-status">' + status + '</p>' +
          '<p class="muted">Payment window ends ' + esc(new Date(o.terms.expires * 1000).toLocaleString()) + '. A missed deadline alone does not return the fitting. An unpaid order needs verified closure on Sepolia.</p>' +
          '<details><summary>Order details</summary><dl class="exact-terms"><dt>Order</dt><dd>' + esc(o.id) + '</dd><dt>Item</dt><dd>' + esc(o.terms.itemId) +
          '</dd><dt>Seller / ETH recipient</dt><dd>' + esc(o.terms.seller) + '</dd><dt>Buyer / item recipient</dt><dd>' + esc(o.terms.buyer) + '</dd><dt>Payment contract</dt><dd>' + esc(o.terms.source) +
          ' · chain ' + o.terms.sourceChainId + '</dd><dt>Fitting reservation contract</dt><dd>' + esc(o.terms.destination) + ' · chain ' + o.terms.destinationChainId + '</dd></dl></details>' +
          (o.error ? '<p class="chain-error">' + esc(o.error) + '</p>' : '') + '<div class="button-row">' +
          (seller && o.status === 'draft' && !expired ? walletButton('Sign quote and reserve fitting', 'reserve', { id: o.id }, paused) + (!o.signature && !o.reserveTx ? walletButton('Discard unsigned quote', 'discard', { id: o.id }, paused) : '') : '') +
          (buyer && o.status === 'reserved' && !expired && !o.sourceTx && o.signature ? walletButton('Review payment in wallet', 'pay', { id: o.id, 'closes-at': o.terms.expires * 1000 }, paused) : '') +
          (o.status === 'reserved' && !o.sourceTx ? walletButton('Close unpaid order on Sepolia', 'close', { id: o.id, 'opens-at': o.terms.expires * 1000 }, !expired || paused) : '') +
          walletButton('Check status', 'refresh') + '</div><p class="transaction-links">' + txLink(o.reserveTx, 'destination', 'Reservation') + txLink(o.sourceTx, 'source', 'Source transaction') + txLink(o.settleTx, 'destination', 'Verification') + '</p></article>';
      }).join('');
  }
  function voyagePanel(): string {
    const s = ship();
    if (s.voyage) return '<div class="voyage-underway"><h3>Your boat is underway</h3><p>' + esc((s.voyage.frontier ? FRONTIER_SITES.find(f => f.id === s.voyage!.frontier)!.name : state!.ports[s.voyage.port].name)) +
      '</p><strong data-until="' + s.voyage.arriveAt + '">' + clockText(s.voyage.arriveAt) + '</strong><p>Your crew completes the trip and delivery while you are away.</p></div>';
    const sealed = s.deliveries.map(d => state!.deliveries.find(v => v.id === d)!).filter(Boolean);
    return '<label>Destination<select id="voyage-destination">' + PORT_IDS.map(p => '<option value="' + p + '"' + (p === port ? " selected" : "") + ">" + state!.ports[p].name + "</option>").join("") +
      '</select></label><details class="form-details"><summary>Route options · ' + (route === 'sail' ? 'Lantern passage' : route === 'powered' ? 'Powered passage' : 'Reef passage') + '</summary><fieldset class="route-options"><legend>Choose a passage</legend>' + [
        ["sail", "Lantern passage", "Sheltered sea lanes · compare total wear and time below"], ["powered", "Powered passage", "Lantern lanes at speed · engine and fuel required"], ["hazard", "Reef passage", "Direct coastal cut · greater wear per meter"],
      ].map(([value, label, description]) => '<label><input type="radio" name="route-kind" value="' + value + '"' + (route === value ? " checked" : "") +
        '><span><strong>' + label + "</strong><small>" + description + "</small></span></label>").join("") +
      '</fieldset></details><div id="voyage-quote" aria-live="polite">' + (quote ? '<dl><div><dt>Distance</dt><dd>' + Math.round(quote.distance) +
        ' m</dd></div><div><dt>Travel time</dt><dd>' + Math.ceil((quote.arriveAt - quote.startAt) / 1000) +
        's</dd></div><div><dt>Fuel</dt><dd>' + quote.fuel + ' / ' + s.fuel + '</dd></div><div><dt>Hull wear</dt><dd>' + (quote.wear ?? 0) +
        '%</dd></div><div><dt>Docking fee</dt><dd>' + (quote.marks ?? 2) + ' Marks</dd></div></dl><p class="muted">' + esc(quote.risk) + '. ' + (s.sea?.secured ? 'Cargo is lashed.' : 'Loose cargo increases wear. Lash before departure.') + '</p>' : '<p class="muted">Calculating your trip…</p>') +
      '</div><p>Deck spaces: ' + loadUnits(state!, s) + " / " + capacity(state!, s) + '</p>' +
      (sealed.length ? '<p class="order-note">Order cargo: ' + sealed.map(d => d.quantity + " " + GOOD_NAMES[d.good] + " to " + state!.ports[d.to].name).join("; ") + "</p>" : "") +
      '<button id="confirm-voyage" type="button" class="primary"' + (!quote || s.fuel < quote.fuel || (s.cargo.repairKit ?? 0) < quote.kits ? " disabled" : "") +
      '>' + icon('voyage') + 'Set sail</button><p class="muted">Your crew steers and docks for you. Delivery payment arrives automatically. Fuel and docking fees are paid on departure.</p>';
  }
  function frontierPanel(): string {
    const s = ship(), sea = s.sea ?? newSeamanship(), mine = state!.me.id, fighting = activeRaid(state!, s);
    return '<div class="frontier-intro"><span class="eyebrow">The Outer Reaches</span><h3>Explore and raid the frontier</h3><p>Fit a cannon at any harbor for 2 timber + 3 plates. Cast shot crates at a foundry, load them aboard, and fuel your tank. Frontier passages cross exposed water and wear the hull; carry repair kits for the return. Skirmishes use 3 crates + 1 fuel; barrages use 6 crates + 2 fuel and weaken one defensive tier.</p><p>Wins take up to 6 goods from exposed stock, within your hold and weight limits. Skirmishes cause 10 hull damage on a win, 25 on defeat; barrages add 5. Core cities and their warehouses remain protected.</p><strong id="raid-window"></strong><p>Player outposts are vulnerable for the first 2 minutes of every 5-minute cycle. New outposts and raid survivors have 2 minutes of protection.</p></div>'+
      '<div class="button-row">'+button('Fit cannon · 2 timber + 3 plates','fitGear',{gear:'cannon'},!s.port||sea.gear.includes('cannon'))+button('Load supplies','harbor',{},false,'panel')+button('Repair hull','repair',{},!!s.voyage)+'</div>'+
      (fighting ? '<article class="battle-card"><strong>'+icon('cannon')+'Battle underway · '+fighting.attack+' attack / '+fighting.defense+' defense</strong><p>The raid has started. Result in <b data-until="'+fighting.endAt+'">'+clockText(fighting.endAt)+'</b>.</p><progress max="20" value="0" data-ready="'+fighting.endAt+'" aria-label="Raid progress"></progress></article>' : '')+
      FRONTIER_SITES.map(site => {
        const outpost = state!.outposts?.find(o=>o.id===site.id), here = !s.port && !s.voyage && sea.anchor && Math.hypot(s.x-site.x,s.z-site.z)<=35;
        return '<article class="frontier-card"><h3>'+icon('cannon')+esc(site.name)+'</h3><p><span data-frontier-distance="'+site.id+'">'+Math.round(Math.hypot(s.x-site.x,s.z-site.z))+' m</span> · '+(outpost?outpost.owner?esc(name(outpost.owner))+' outpost':'Corsair store · game-controlled':'Unclaimed anchorage')+'</p>'+
          button(s.voyage?.frontier===site.id?'Sailing here':'Sail to anchorage','sailFrontier',{target:site.id},!!s.voyage||!!fighting||here||!!s.deliveries.length)+
          (!outpost ? '<p>Build with cargo aboard: '+materials(OUTPOST_INPUTS)+'. One outpost per house. Construction materials are consumed.</p><form data-form="buildOutpost"><input type="hidden" name="target" value="'+site.id+'"><label class="toggle-line"><input type="checkbox" name="acceptRisk" required>I accept that other houses can raid stock deposited here.</label><button'+(!here?' disabled':'')+'>Build outpost & accept raids</button></form>' : '<p>Exposed goods: '+(warehouseUsed(outpost.stock)?materials(outpost.stock):'empty')+'</p><p>Defense '+raidDefense(outpost)+' · fortification '+outpost.fortification+'/3'+(outpost.protectedUntil>Date.now()?' · protected for <span data-until="'+outpost.protectedUntil+'">'+clockText(outpost.protectedUntil)+'</span>':'')+'</p>'+
            (outpost.owner===mine ? '<form data-form="outpostCargo" class="inline-form"><input type="hidden" name="target" value="'+site.id+'"><label>Goods<select name="good">'+goodOptions()+'</select></label><label>Units'+amount('quantity',1,40)+'</label><button name="direction" value="deposit"'+(!here?' disabled':'')+'>Store cargo at risk</button><button name="direction" value="withdraw"'+(!here?' disabled':'')+'>Load aboard</button></form>'+button('Fortify · 2 plates + 1 repair kit','fortifyOutpost',{target:site.id},!here||outpost.fortification>=3) : '<p>Your skirmish attack: '+raidAttack(s,false)+' · barrage: '+raidAttack(s,true)+'. Attack ≥ defense wins.</p><div class="button-row">'+button('Skirmish · 3 shot + 1 fuel','raid',{target:site.id,mode:'skirmish'},!here)+button('Barrage · 6 shot + 2 fuel','raid',{target:site.id,mode:'barrage'},!here)+'</div>'))+'</article>';
      }).join('')+'<h3>Recent raids</h3>'+(state!.raids??[]).filter(r=>r.status!=='fighting'&&(r.attacker===mine||state!.outposts?.some(o=>o.id===r.target&&o.owner===mine))).slice(-5).reverse().map(r=>'<p>'+esc(name(r.attacker))+' · '+r.status+' · '+materials(r.loot)+' · '+r.damage+' hull damage</p>').join('')+
      '<p>The corsair store gains 2 timber, 2 scrap and 2 plates every five minutes. It holds at most 12 timber, 12 scrap and 6 plates. Raids award goods, not Marks.</p>';
  }
  function cityPanel(): string {
    const city=state!.ports[port], move=city.move, civic=city.civic!, account=state!.civicAccounts[port], needs=cityNeeds(state!,port);
    const distance=(a:{x:number;z:number},p:PortId)=>Math.round(Math.hypot(a.x-state!.ports[p].x,a.z-state!.ports[p].z));
    return '<div class="demand-intro">'+icon(CITY_STYLE[port].crest)+'<div><strong>'+city.name+'</strong><p>'+CITY_STYLE[port].title+'</p></div></div><p class="city-story"><strong>'+CITY_STYLE[port].keeper+'</strong><br>'+CITY_STYLE[port].story+'</p><div class="civic-health"><div><strong>City prosperity</strong><span>'+civic.prosperity+' / 100</span></div><progress value="'+civic.prosperity+'" max="100" aria-label="City prosperity"></progress><small>'+
      civic.consumed+' provisions consumed · '+workshopLimit(state!,port)+' workshop berths · '+(civic.prosperity>=80?'Workshops finish 10% faster':'At 80 prosperity, workshops finish 10% faster')+'</small><div><span>Available city funds</span><strong>'+account.funds+' Marks</strong></div><small>Full provisions cost about '+account.cycleCost+' Marks per five-minute cycle. Unreserved funds cover '+Math.floor(account.funds/account.cycleCost)+' cycles before new income.</small></div>'+
      '<article class="annex-project"><h3>Workshop annex</h3><p>Construction consumes '+materials(ANNEX_INPUTS)+'. Two more workshop berths; an extra fuel and repair kit each civic cycle keeps production 10% faster.</p>'+(!civic.annex ? '<p>Reserve '+Object.entries(ANNEX_INPUTS).reduce((n,[g,q])=>n+Math.round(GUIDE_PRICE[g as Good]*(1+Math.max(0,1-(account.stock[g as Good]??0)/((needs[g as Good]??2)*3))*.3))*q!,0)+' Marks from city funds.</p>'+button('Fund workshop annex','startAnnex',{},!docked()||city.steward!==state!.me.id) : civic.annex.completedAt ? '<strong>Annex open · '+(civic.annex.maintained?'production bonus active':'awaiting fuel and repair-kit upkeep')+'</strong>' : '<p>'+Object.entries(ANNEX_INPUTS).map(([g,q])=>(civic.annex!.stock[g as Good]??0)+'/'+q+' '+GOOD_NAMES[g as Good]).join(' · ')+'</p>'+button('Fill construction orders','harbor',{},false,'panel'))+'</article>'+
      '<h3>Provision the republic</h3><p class="muted">Next consumption in <span data-until="'+civic.nextAt+'">'+clockText(civic.nextAt)+'</span>. Each cycle uses the needs below. Satisfied needs improve prosperity; shortages reduce it.</p><table class="stock-table"><thead><tr><th>Goods</th><th>Stored</th><th>Each cycle</th></tr></thead><tbody>'+
      Object.entries(needs).map(([g,n])=>'<tr><td>'+icon(g)+GOOD_NAMES[g as keyof typeof GOOD_NAMES]+'</td><td>'+(account.stock[g as keyof typeof account.stock]??0)+'</td><td>'+n+'</td></tr>').join('')+
      '</tbody></table><p class="muted">Trade fees and services return to civic funds. Orders reserve only money the city already holds.</p><p class="muted">At Trusted merchant rank or above, your house helps fund its home city every five minutes. It pays 10% of unreserved Marks above 600. Payments stop when the city holds 2,500 Marks. Your first 600 Marks and reserved payments stay protected. While you are away, this upkeep applies for up to one hour.</p>'+
      button('Supply city needs','harbor',{},false,'panel')+'<form data-form="cityPriority"><label>City priority<select name="priority">'+[['homes','Homes · more meals'],['industry','Industry · more fuel'],['harbor','Harbor · more timber and plates']].map(([value,label])=>'<option value="'+value+'"'+(civic.priority===value?' selected':'')+'>'+label+'</option>').join('')+'</select></label><button'+(city.steward!==state!.me.id?' disabled':'')+'>Set priority</button></form><p class="muted">Elected steward: '+esc(name(city.steward))+'.</p>'+
      (move?'<div class="departure-card"><strong>'+(Date.now()<move.departAt?'Preparing to migrate':'The republic is underway')+'</strong><p>Departure: <span data-until="'+move.departAt+'">'+clockText(move.departAt)+'</span> · arrival: <span data-until="'+move.arriveAt+'">'+clockText(move.arriveAt)+'</span></p><p>Accepted delivery deadlines remain protected. Civic buying resumes at anchor.</p></div>':'')+
      (port==='bastion'?'<h3>Choose the next anchorage</h3><p>The living timber gardens travel with Bastion. West brings the city closer to kelp refineries; east brings it closer to the foundries. A move uses 15 fuel and takes two minutes, after at least five minutes of notice.</p><table class="stock-table"><thead><tr><th>Passage to</th><th>Now</th><th>West</th><th>East</th></tr></thead><tbody>'+
        (['reedhaven','ironwake'] as PortId[]).map(p=>'<tr><td>'+state!.ports[p].name+'</td><td>'+distance(city,p)+' m</td><td>'+distance(ANCHORAGES.kelp,p)+' m</td><td>'+distance(ANCHORAGES.scrap,p)+' m</td></tr>').join('')+
        '</tbody></table><div class="button-row">'+button('West · lantern gardens','moveCity',{port,anchorage:'kelp'},!!move||city.steward!==state!.me.id)+button('East · ember foundries','moveCity',{port,anchorage:'scrap'},!!move||city.steward!==state!.me.id)+'</div><p>Fuel set aside for the move: '+(city.treasury.fuel??0)+' fuel</p><form data-form="contribute" class="inline-form"><label>Local fuel'+amount('quantity',4,100)+'</label><button>'+icon('fuel')+'Contribute</button></form>':'')+
      '<details class="form-details"><summary>Elect a steward</summary><p>A majority of resident houses chooses the steward.</p>'+Object.values(state!.players).filter(p=>p.home===port&&!p.npc).map(p=>'<div class="resident-row"><span>'+esc(p.name)+'</span>'+button('Vote','voteSteward',{port,player:p.id},state!.me.home!==port)+'</div>').join('')+'</details>'+
      '<h3>Harbor radio</h3><p class="muted">Coordinate cargo, commissions and migration with the houses in this region.</p><ol class="radio-log">'+(state!.messages??[]).slice(-12).map(m=>'<li><strong>'+esc(name(m.player))+'</strong><p>'+esc(m.text)+'</p></li>').join('')+'</ol><form data-form="message"><label>Your message<textarea name="text" maxlength="180" rows="2" required placeholder="Looking for a carrier to Ironwake…"></textarea></label><button>'+icon('chat')+'Send to harbor</button></form>'+
      '<details class="form-details"><summary>Recent harbor activity</summary><ol class="activity-log">'+state!.ledger.slice(0,12).map(e=>'<li>'+esc(e.text)+'</li>').join('')+'</ol></details>';
  }

  function render(preserveDrafts = false): void {
    if (!state) return;
    const formKey = (form: HTMLFormElement) => JSON.stringify([form.dataset.form, ...Array.from(form.querySelectorAll<HTMLInputElement>('input[type="hidden"]'), input => [input.name, input.value])]);
    const drafts = new Map(preserveDrafts ? Array.from(context.querySelectorAll('form'), form => [formKey(form), new FormData(form)] as const) : []);
    const expanded = preserveDrafts ? Array.from(context.querySelectorAll('details[open]'), detail => detail.querySelector('summary')?.textContent) : [];
    $("economy-ui").hidden = false;
    $("context-title").textContent = ({ harbor: "Harbor market", workshop: "Workshops", shipyard: "Shipyard", voyage: "Set sail", city: "Republic", deck: "Aboard your boat", chart: "Trade chart", frontier: "Frontier raids" })[panel];
    workspace.dataset.view = panel;
    workspace.style.setProperty('--city-dark', CITY_STYLE[port].dark);
    $("port-crest").innerHTML = icon(CITY_STYLE[port].crest);
    $<HTMLSelectElement>("port-selector").value = port;
    for (const tab of document.querySelectorAll<HTMLButtonElement>("#game-tabs [data-panel]")) tab.setAttribute("aria-pressed", String(!workspace.hidden && tab.dataset.panel === panel));
    $("more-views-button").setAttribute("aria-pressed", String(!workspace.hidden && ['shipyard', 'deck', 'city', 'frontier'].includes(panel)));
    $("fleet-list").innerHTML = Object.values(state.ships).filter(s => (s.owner === state!.me.id || s.sea?.crew.includes(state!.me.id))).map(s =>
      '<button type="button" data-fleet="' + esc(s.id) + '" class="' + (s.id === state!.me.selectedShip ? "selected" : "") + '">' + icon(s.sea?.hull ?? 'cutter') + '<span class="fleet-text"><strong>' + esc(s.name) +
      "</strong><span>" + (s.voyage ? "Sailing · " + (s.voyage.frontier ? FRONTIER_SITES.find(f => f.id === s.voyage!.frontier)!.name : state!.ports[s.voyage.port].name) : s.port ? state!.ports[s.port].name : "At sea") + "</span></span></button>").join("");
    $("fleet-count").textContent = Object.values(state.ships).filter(s => s.owner === state!.me.id).length + (Object.values(state.ships).filter(s => s.owner === state!.me.id).length === 1 ? ' boat' : ' boats');
    context.innerHTML = panel === "harbor" ? (state.practice ? deliveries(true) : "") + civicOrders() + offers() + deliveries() + '<details class="form-details"><summary>Warehouse & cargo</summary>' + warehouse() + '</details>' : panel === "workshop" ? workshopPanel() : panel === "shipyard" ? shipyardPanel() : panel === "voyage" ? voyagePanel() : panel === "deck" ? deckPanel() : panel === 'chart' ? chartPanel() : panel === 'frontier' ? frontierPanel() : cityPanel();
    if (panel !== "frontier") context.insertAdjacentHTML('afterbegin', '<button type="button" class="workspace-help" data-guide="' + (panel === 'shipyard' ? 'commission' : panel === 'city' ? 'migration' : panel === 'voyage' || panel === 'deck' ? 'haul' : 'trade') + '">' + icon('book') + 'Read the guide</button>');
    for (const form of context.querySelectorAll('form')) {
      const draft = drafts.get(formKey(form));
      if (draft) for (const field of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input[name], select[name], textarea[name]')) {
        const value = draft.get(field.name);
        if (field instanceof HTMLInputElement && ['radio','checkbox'].includes(field.type)) field.checked = draft.getAll(field.name).includes(field.value);
        else if (typeof value === 'string') field.value = value;
      }
    }
    for (const detail of context.querySelectorAll('details')) if (expanded.includes(detail.querySelector('summary')?.textContent)) detail.open = true;
    const autoTrim = context.querySelector<HTMLInputElement>('[name="autoTrim"]');
    if (autoTrim) context.querySelector<HTMLInputElement>('[name="trim"]')!.disabled = autoTrim.checked;
    const notices = state.me.notices.slice(0, 5);
    $("house-notices").innerHTML = notices.map(n => "<li>" + esc(n.text) + "</li>").join("");
    updateMeters();
  }
  async function refreshQuote(): Promise<void> {
    quote = null;
    if (!state || ship().voyage) { render(); return; }
    const selectedPort = port, selectedRoute = route, selectedShip = ship().id;
    try {
      const result = await api("/quote", { port, route, ship: selectedShip }) as Voyage;
      if (selectedPort !== port || selectedRoute !== route || selectedShip !== ship().id) return;
      quote = result; render();
    } catch (error) {
      render();
      if (panel === "voyage") $("voyage-quote").textContent = error instanceof Error ? error.message : String(error);
    }
  }
  function open(next: Panel, selectedPort?: PortId): void {
    if (selectedPort) port = selectedPort;
    else if (next === "voyage" && state) {
      const delivery = state.deliveries.find(d => ship().deliveries.includes(d.id));
      if (delivery) port = delivery.to;
    }
    panel = next; quote = null;
    workspace.hidden = false; document.body.classList.add('workspace-open');
    $<HTMLDetailsElement>("fleet").open = false;
    hooks.preview(panel === "shipyard" ? preview : null);
    render();
    animate(workspace, [{opacity:0, translate:'0 14px'}, {opacity:1, translate:'0 0'}]);
    if ($("more-views").matches(":popover-open")) $("more-views").hidePopover();
    context.scrollTop = 0;
    $("context-title").focus({ preventScroll: true });
    if (panel === "voyage") void refreshQuote();
  }
  function closeWorkspace(): void {
    workspace.hidden = true; document.body.classList.remove('workspace-open');
    hooks.preview(null);
    for (const tab of document.querySelectorAll('#game-tabs [aria-pressed]')) tab.setAttribute('aria-pressed','false');
    $("scene").focus({preventScroll:true});
  }
  $("context-close").addEventListener('click',closeWorkspace);
  $("quick-dock").addEventListener('click', () => void submit({action:'dock',port:$("quick-dock").dataset.port}));
  document.addEventListener('keydown', event => {
    if (event.key==='Escape' && !$("more-views").matches(":popover-open") && !workspace.hidden && !document.querySelector('dialog[open]')) closeWorkspace();
  });
  const settings=$<HTMLDialogElement>("settings-dialog");
  $("settings-button").addEventListener('click',()=>settings.showModal());
  $("settings-close").addEventListener('click',()=>settings.close());
  function saveGuide(): void {
    if (state) localStorage.setItem("drift-guide:" + state.me.id, JSON.stringify({ topic: guideTopic, step: guideStep, active: guideActive }));
  }
  function updateGuideStatus(): void {
    if (!state) return;
    const status = document.getElementById("guide-live-status");
    if (status) status.textContent = guideSteps(guideTopic, state, wallet.config)[guideStep].status;
  }
  function renderGuide(): void {
    if (!state) return;
    const steps = guideSteps(guideTopic, state, wallet.config), step = steps[guideStep];
    $<HTMLSelectElement>("guide-topic").value = guideTopic;
    $("guide-step-count").textContent = "Step " + (guideStep + 1) + " of " + steps.length;
    $("guide-content").innerHTML = '<h3 tabindex="-1" id="guide-step-title">' + esc(step.title) + '</h3><p>' + esc(step.text) + '</p><p id="guide-live-status" class="guide-live-status"></p>' +
      (step.links?.map(([label, href]) => '<p><a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + ' ↗</a></p>').join('') ?? '') +
      '<button id="guide-action" type="button" class="primary">' + esc(step.button) + ' ' + icon('arrow') + '</button>' +
      (guideTopic === 'wallet' && guideStep === 2 ? '<div class="button-row">' + walletButton('Select Sepolia in wallet', 'sourceNetwork', {}, state.practice || !wallet.config) + walletButton('Select Creditcoin in wallet', 'destinationNetwork', {}, state.practice || !wallet.config) + '</div>' : '');
    $<HTMLButtonElement>("guide-back").disabled = guideStep === 0;
    $("guide-next").textContent = guideStep + 1 === steps.length ? 'Back to the game' : 'Next step';
    $("guide-action").onclick = () => {
      guide.close();
      if (step.target === 'account' || step.target === 'wallet') $<HTMLDialogElement>(step.target === 'wallet' ? 'wallet-dialog' : 'account-dialog').showModal();
      else {
        open(step.target === 'chain' ? 'shipyard' : step.target, step.port);
        if (step.target === 'chain') {
          const details = context.querySelector<HTMLDetailsElement>('[data-chain-market]');
          if (details) { details.open = true; details.scrollIntoView({ block: 'start' }); }
        }
      }
      $("objective").hidden = false; saveGuide(); updateMeters();
    };
    updateGuideStatus();
  }
  function openGuide(topic?: GuideTopic): void {
    if (!state) return;
    for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) dialog.close();
    if (topic) { guideTopic = topic; guideStep = topic === 'trade' && state.practice && state.deliveries.some(d => d.id === 'practice-timber' && d.status === 'delivered') ? 1 : 0; }
    guideActive = true; saveGuide(); renderGuide(); guide.showModal();
  }
  $("guide-close").onclick = () => guide.close();
  $("guide-topic").onchange = () => { guideTopic = $<HTMLSelectElement>('guide-topic').value as GuideTopic; guideStep = 0; guideActive = true; saveGuide(); renderGuide(); };
  $("guide-back").onclick = () => { guideStep = Math.max(0, guideStep - 1); saveGuide(); renderGuide(); $("guide-step-title").focus(); };
  $("guide-next").onclick = () => {
    if (!state) return;
    if (guideStep + 1 === guideSteps(guideTopic, state, wallet.config).length) { guideActive = false; guide.close(); saveGuide(); updateMeters(); return; }
    guideStep++; saveGuide(); renderGuide(); $("guide-step-title").focus();
  };
  $("objective").hidden=localStorage.getItem('drift-hide-guidance')==='yes';
  $("objective-dismiss").addEventListener('click',()=>{ $("objective").hidden=true; localStorage.setItem('drift-hide-guidance','yes'); });
  $("show-guidance").addEventListener('click',()=>{ $("objective").hidden=false; localStorage.removeItem('drift-hide-guidance'); settings.close(); });
  for (const id of ['text-scale','calm-motion','effects-volume','music-volume']) {
    const control=$<HTMLInputElement>(id), saved=localStorage.getItem('drift-setting-'+id);
    if (control.type==='checkbox') control.checked=saved===null?matchMedia('(prefers-reduced-motion: reduce)').matches:saved==='true';
    else if (saved!==null && Number.isFinite(Number(saved))) control.value=saved;
    const apply=()=>{
      if(id==='text-scale') document.documentElement.style.setProperty('--text-size',String(Number(control.value)/100));
      if(id==='calm-motion') document.documentElement.classList.toggle('calm-motion',control.checked);
      localStorage.setItem('drift-setting-'+id,control.type==='checkbox'?String(control.checked):control.value);
      window.dispatchEvent(new CustomEvent('drift-settings'));
    };
    control.addEventListener('input',apply); apply();
  }
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
    if (!target) return;
    if (target.dataset.nextStep && nextCommand) { void submit(nextCommand); return; }
    if (target.hasAttribute('data-wallet-market')) { $<HTMLDialogElement>('wallet-dialog').close(); open('shipyard', ship().port ?? state!.me.home); const market = context.querySelector<HTMLDetailsElement>('[data-chain-market]'); if (market) { market.open = true; market.scrollIntoView({block:'start'}); } return; }
    if (target.dataset.guide) { openGuide(target.dataset.guide as GuideTopic); return; }
    if (target.dataset.guideResume) { openGuide(); return; }
    if (target.dataset.wallet) { const { wallet: action, ...values } = target.dataset; void wallet.run(action, values); return; }
    if (target.dataset.site && !target.dataset.command) { const site = SEA_SITES.find(s => s.id === target.dataset.site)!; void perform({ action: "navigate", x: site.x, z: site.z }).then(() => { if (ship().nav) closeWorkspace(); }); return; }
    if (target.dataset.panel) { open(target.dataset.panel as Panel, target.dataset.port as PortId | undefined); return; }
    if (target.dataset.fleet) { void submit({ action: "selectShip", ship: target.dataset.fleet }); return; }
    if (target.dataset.command) {
      const { command: action, ...values } = target.dataset;
      void submit({ action, ...values, ...(action === "supplyDelivery" ? {fee:Number(values.fee)} : action === "fundAdvance" ? {principal:Number(values.principal),repayment:Number(values.repayment)} : {}) }); return;
    }
    if (target.dataset.paint) {
      preview = { hull: target.dataset.paint, sail: target.dataset.sail ?? ship().look.sail };
      hooks.preview(preview); render(); return;
    }
    if (target.hasAttribute("data-cancel-preview")) { preview = null; hooks.preview(null); render(); }
    if (target.id === "confirm-voyage" && quote) {
      void submit({ action: "voyage", port, route, maxFuel: quote.fuel, maxKits: quote.kits, berth: quote.berth }).then(() => { quote = null; if (ship().voyage) closeWorkspace(); });
    }
  });
  document.addEventListener("input", event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !state) return;
    if (target.id === "hull-color" || target.id === "sail-color") {
      preview = { ...(preview ?? ship().look), [target.id === "hull-color" ? "hull" : "sail"]: target.value };
      hooks.preview(preview);
    }
  });
  document.addEventListener("change", event => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.id === 'work-good') { workGood=target.value; render(true); }
    if (target instanceof HTMLInputElement && target.id === 'work-stock') { stockedWork=target.checked; render(true); }
    if (target instanceof HTMLSelectElement && (target.id === "port-selector" || target.id === "voyage-destination")) {
      port = target.value as PortId; quote = null;
      if (target.id === "port-selector") hooks.focusPort(port);
      if (panel === "voyage") void refreshQuote(); else render();
    }
    if (target instanceof HTMLInputElement && target.name === "route-kind") { route = target.value as RouteKind; void refreshQuote(); }
    if (target instanceof HTMLInputElement && target.name === 'autoTrim') target.form!.querySelector<HTMLInputElement>('[name="trim"]')!.disabled = target.checked;
  });
  context.addEventListener("focusout", () => {
    if (refreshDeferred) window.setTimeout(() => {
      if (!document.activeElement?.closest("#context-content input, #context-content textarea, #context-content select")) { refreshDeferred = false; render(true); }
    }, 0);
  });
  document.addEventListener("submit", event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.dataset.form) return;
    event.preventDefault();
    const values: Record<string, unknown> = Object.fromEntries(new FormData(form));
    const submitter = (event as SubmitEvent).submitter;
    if (submitter instanceof HTMLButtonElement && submitter.name) values[submitter.name] = submitter.value;
    for (const field of form.querySelectorAll<HTMLInputElement>('input[type="number"]')) values[field.name] = Number(field.value);
    const action = form.dataset.form;
    if (action === "chainOrder") { void wallet.run("order", values); return; }
    if (["login", "register", "account/recover", "account/password", "account/recovery"].includes(action)) {
      if (accountPending) return;
      accountPending = true;
      const buttons = [...form.querySelectorAll<HTMLButtonElement>('button')]; buttons.forEach(b => b.disabled = true);
      void (async () => {
        const error = $("account-error");
        error.textContent = "";
        try {
          const result = await api("/" + action, values);
          const { recoveryCode, ...next } = result;
          if (next.me) { accept(next as GameState, true); events(); }
          else if (action === 'account/password') { accept(await api('/state'), true); events(); }
          form.reset();
          if (recoveryCode) {
            $<HTMLInputElement>('recovery-code').value = recoveryCode; $('recovery-result').hidden = false;
            $('recovery-result').scrollIntoView({ block: 'nearest' }); $('recovery-code').focus();
          } else $<HTMLDialogElement>("account-dialog").close();
        } catch (e) { error.textContent = e instanceof Error ? e.message : String(e); }
        finally { accountPending = false; buttons.forEach(b => b.disabled = false); }
      })(); return;
    }
    if (["extract", "requestDelivery", "contribute", "cityPriority"].includes(action)) values.port = port;
    if (action === 'sails') { values.reef = Number(values.reef); values.trim = values.autoTrim ? -1 : Number(values.trim); delete values.autoTrim; }
    if (action === 'balanceCargo') values.balance = Number(values.balance);
    if (action === 'carrierProfile') values.available = values.available === 'on';
    if (action === 'buildOutpost') values.acceptRisk = values.acceptRisk === 'on';
    if (action === "craft") { values.look = preview ?? ship().look; values.items = new FormData(form).getAll('items'); }
    void submit({ action, ...values }).then(() => {
      if (action==='message' && state?.messages?.at(-1)?.text===values.text) form.reset();
    });
  });
  $("account-button").addEventListener("click", () => $<HTMLDialogElement>("account-dialog").showModal());
  $("wallet-button").addEventListener("click", () => { if (wallet.address) $<HTMLDialogElement>("wallet-dialog").showModal(); else void wallet.run("choose"); });
  $("wallet-details-button").addEventListener("click", () => { $<HTMLDialogElement>("settings-dialog").close(); $<HTMLDialogElement>("wallet-dialog").showModal(); });
  $("wallet-close").addEventListener("click", () => $<HTMLDialogElement>("wallet-dialog").close());
  $("wallet-house").addEventListener("click", () => { $<HTMLDialogElement>("wallet-dialog").close(); $<HTMLDialogElement>("account-dialog").showModal(); });
  $("account-close").addEventListener("click", () => $<HTMLDialogElement>("account-dialog").close());
  $("account-dialog").addEventListener('close', () => {
    $('recovery-result').hidden = true; $<HTMLInputElement>('recovery-code').value = ''; $('account-error').textContent = '';
    for (const form of document.querySelectorAll<HTMLFormElement>('#account-dialog form')) form.reset();
  });
  $('recovery-select').onclick = () => { const code = $<HTMLInputElement>('recovery-code'); code.focus(); code.select(); };
  $('recovery-saved').onclick = () => { $('recovery-result').hidden = true; $<HTMLInputElement>('recovery-code').value = ''; };
  $("logout-button").addEventListener("click", () => {
    void (async () => {
      try { await api("/logout", {}); accept(await api("/practice", {}), true); events(); $<HTMLDialogElement>("account-dialog").close(); }
      catch (error) { tell(error instanceof Error ? error.message : String(error), true); }
    })();
  });
  window.setInterval(updateMeters, 1000);
  void (async () => {
    try {
      const config = await api("/config");
      wallet.configure(config.settlement, config.walletConnectProjectId ?? '');
      const next = config.sessionActive ? await api("/state") : await api("/practice", {});
      accept(next, true); events();
    } catch (error) { tell("The harbor cannot connect. Check your connection and reload. " + (error instanceof Error ? error.message : String(error)), true); }
  })();
  return {
    get state() { return state; },
    get preview() { return !workspace.hidden && panel === "shipyard" ? preview : null; },
    open,
    close: closeWorkspace,
    navigate: (x: number, z: number) => perform({ action: "navigate", x, z }, { silent: true }),
    steer: (throttle: number, steer: number) => perform({ action: "steer", throttle, steer }, { silent: true }),
    stop: () => perform({ action: "stop" }, { silent: true }),
    dock: (selectedPort: PortId) => perform({ action: "dock", port: selectedPort }),
    tell,
  };
}
