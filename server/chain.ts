import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, defineChain, encodeAbiParameters, encodeFunctionData, getAddress,
  http, isAddress, keccak256, parseAbiParameters, toHex, verifyMessage, zeroAddress, zeroHash,
  type Abi, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { itemsAbi, checkoutAbi } from "../src/contract-abi.ts";
import { GameError, canRemoveRig, type Item, type World } from "../src/economy.ts";
import { onchainTerms, type ChainOrder, type OrderTerms, type PublicChainConfig } from "../src/settlement.ts";

export type ChainConfig = PublicChainConfig & {
  source: PublicChainConfig["source"] & { startBlock: string; chainKey: number };
  destination: PublicChainConfig["destination"] & { startBlock: string };
  proofUrl: string; writeEnabled: boolean;
  tokenNamespace?: string;
  budget?: { maxTransactions: number; maxGas: string; maxFeePerGas: string; maxTotalFee: string };
};
type Transaction = <T>(run: (world: World) => T) => { world: World; result: T };
type Job = { id: string; item: string; player: string; ship: string; kind: "mint" | "install" | "uninstall" | "settle"; body: string; state: string; raw: Hex | null; hash: Hex | null; error: string | null };
const hex = (v: unknown, bytes: number): v is Hex => typeof v === "string" && new RegExp("^0x[0-9a-fA-F]{" + bytes * 2 + "}$").test(v);
function fail(message: string): never { throw new GameError(message); }
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const shortError = (error: unknown): string => error instanceof Error ? error.message.split("\n")[0].slice(0, 180) : "Chain request unavailable.";
const termsAbi = parseAbiParameters("bytes32,(bytes32 itemId,address seller,address buyer,uint256 amount,uint64 expires,uint64 sourceChainId,address source,uint64 destinationChainId,address destination,bytes32 nonce)");
export const orderId = (terms: OrderTerms): Hex => keccak256(encodeAbiParameters(termsAbi, [keccak256(toHex("DRIFT_REPUBLICS_ORDER_V1")), onchainTerms(terms)]));
export const itemToken = (id: string, namespace = ""): Hex => keccak256(toHex("drift:shared:" + (namespace ? namespace + ":" : "") + id));
export const shipToken = (id: string, namespace = ""): Hex => keccak256(toHex("drift:ship:" + (namespace ? namespace + ":" : "") + id));
const stringify = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v);
const kindId = (item: Item) => ({ cargoModule: 1, engine: 2, livery: 3 })[item.kind];

export function createChainService(db: DatabaseSync, dataDir: string, transact: Transaction, readWorld: () => World, now: () => number) {
  const path = resolve(dataDir, "chain.json");
  if (!existsSync(path)) return null;
  const config = JSON.parse(readFileSync(path, "utf8")) as ChainConfig;
  if (config.tokenNamespace !== undefined && (typeof config.tokenNamespace !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(config.tokenNamespace))) throw new Error("Invalid chain token namespace.");
  const readOnly = process.env.DRIFT_CHAIN_READ_ONLY === "1";
  if (!["local", "testnet"].includes(config.mode) || !isAddress(config.authority) || !isAddress(config.source.address) || !isAddress(config.destination.address) ||
      !Number.isSafeInteger(config.source.chainId) || !Number.isSafeInteger(config.destination.chainId) || config.source.chainId === config.destination.chainId ||
      !Number.isSafeInteger(config.source.chainKey) || config.source.chainKey < 1) throw new Error("Invalid chain.json configuration.");
  for (const url of [config.source.rpcUrl, config.destination.rpcUrl, config.proofUrl]) {
    const parsed = new URL(url);
    if (config.mode === "local" ? !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) : parsed.protocol !== "https:") throw new Error("Chain endpoints do not match the declared environment.");
  }
  if (config.mode === "testnet" && (config.source.chainId !== 11155111 || config.destination.chainId !== 102031 || config.source.chainKey !== 1)) throw new Error("Only Sepolia to Creditcoin testnet is configured for this pilot.");
  const fingerprint = keccak256(toHex(JSON.stringify([config.source.chainId, config.source.address.toLowerCase(), config.destination.chainId, config.destination.address.toLowerCase(), ...(config.tokenNamespace ? [config.tokenNamespace] : [])])));
  db.exec("CREATE TABLE IF NOT EXISTS chain_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS chain_challenges (session TEXT PRIMARY KEY,address TEXT NOT NULL,message TEXT NOT NULL,expires INTEGER NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS chain_jobs (id TEXT PRIMARY KEY,item TEXT NOT NULL,player TEXT NOT NULL,ship TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL,raw TEXT,hash TEXT,error TEXT);");
  const old = db.prepare("SELECT value FROM chain_meta WHERE key='deployment'").get() as { value: string } | undefined;
  if (old && old.value !== fingerprint) throw new Error("This data directory belongs to another chain deployment. Preserve it and choose an isolated data directory.");
  db.prepare("INSERT OR IGNORE INTO chain_meta VALUES ('deployment',?)").run(fingerprint);
  transact(w => { w.settlement ??= { mode: config.mode, orders: [], lastSync: 0, block: "0" }; });
  const network = defineChain({ id: config.destination.chainId, name: config.mode === "local" ? "Drift local contracts" : "Creditcoin Testnet", nativeCurrency: { name: "Creditcoin", symbol: "CTC", decimals: 18 }, rpcUrls: { default: { http: [config.destination.rpcUrl] } } });
  const destination = createPublicClient({ chain: network, transport: http(process.env.DRIFT_CTC_RPC ?? config.destination.rpcUrl, { timeout: 10000, retryCount: 0 }) });
  const source = createPublicClient({ transport: http(process.env.DRIFT_SOURCE_RPC ?? config.source.rpcUrl, { timeout: 10000, retryCount: 0 }) });
  const keyPath = resolve(dataDir, "operator.key");
  const account = !readOnly && existsSync(keyPath) ? privateKeyToAccount(readFileSync(keyPath, "utf8").trim() as Hex) : null;
  if (account && !same(account.address, config.authority)) throw new Error("operator.key does not match the deployment's game authority.");
  const wallet = account ? createWalletClient({ account, chain: network, transport: http(process.env.DRIFT_CTC_RPC ?? config.destination.rpcUrl, { timeout: 10000, retryCount: 0 }) }) : null;
  let busy = false, validated = false, closed = false;
  const writeEnabled = config.writeEnabled === true && !!wallet;
  const getOrders = (w: World) => w.settlement!.orders;
  const findOrder = (w: World, id: unknown) => getOrders(w).find(o => o.id === id) ?? fail("This Creditcoin order is no longer available. Refresh the market.");
  const playerFor = (w: World, address: string) => Object.values(w.players).find(p => same(p.wallet, address))?.id ?? "wallet:" + address.toLowerCase();
  function queue(job: Omit<Job, "state" | "raw" | "hash" | "error">): void {
    db.prepare("INSERT INTO chain_jobs (id,item,player,ship,kind,body,state) VALUES (?,?,?,?,?,?,'queued')").run(job.id, job.item, job.player, job.ship, job.kind, job.body);
  }
  function ownItem(w: World, player: string, id: unknown): Item {
    const item = w.items[String(id)];
    if (!item || item.owner !== player || item.consumed || item.listing) fail("This item is not available to your house.");
    return item;
  }
  function docked(w: World, player: string) {
    const ship = w.ships[w.players[player].selectedShip];
    if (ship.owner !== player) fail("Select your own boat before changing chain fittings.");
    if (!ship.port || ship.voyage || ship.chainPending || (w.ports[ship.port].move && now() >= w.ports[ship.port].move!.departAt)) fail("Dock at an anchored harbor and finish any pending fitting change first.");
    return ship;
  }
  async function finalized() {
    if (!validated) {
      const [sourceId, destinationId, authority, checkout, key] = await Promise.all([
        source.getChainId(), destination.getChainId(),
        destination.readContract({ address: config.destination.address, abi: itemsAbi, functionName: "authority" }),
        destination.readContract({ address: config.destination.address, abi: itemsAbi, functionName: "sourceCheckout" }),
        destination.readContract({ address: config.destination.address, abi: itemsAbi, functionName: "sourceChainKey" }),
      ]);
      if (sourceId !== config.source.chainId || destinationId !== config.destination.chainId || !same(authority, config.authority) || !same(checkout, config.source.address) || key !== BigInt(config.source.chainKey)) throw new Error("RPC or contract configuration does not match the deployment.");
      validated = true;
    }
    const block = await destination.getBlock({ blockTag: "finalized" });
    if (block.number === null) throw new Error("Finalized destination block unavailable.");
    if (block.number < BigInt(config.destination.startBlock)) throw new Error("Waiting for the Creditcoin deployment block to finalize.");
    return block;
  }
  async function observedSource(order: ChainOrder): Promise<void> {
    if (!order.sourceTx) return;
    const receipt = await source.getTransactionReceipt({ hash: order.sourceTx }).catch(() => null);
    if (!receipt) return;
    const paidTopic = keccak256(toHex("OrderPaid(bytes32)")), closedTopic = keccak256(toHex("OrderClosedUnpaid(bytes32)"));
    const event = receipt.logs.find(l => same(l.address, config.source.address) && l.topics.length === 2 && l.topics[1] === order.id && [paidTopic, closedTopic].includes(l.topics[0]!));
    transact(w => {
      const current = findOrder(w, order.id);
      if (["owned", "cancelled"].includes(current.status) || current.sourceTx !== order.sourceTx) return;
      const before = JSON.stringify(current);
      if (receipt.status !== "success" || !event) { delete current.sourceTx; current.error = "The submitted transaction did not complete this order. Its escrow remains reserved."; }
      else {
        current.sourcePaid = event.topics[0] === paidTopic;
        if (current.status === "reserved") { current.status = current.sourcePaid ? "paymentObserved" : "verificationPending"; delete current.error; }
      }
      if (before !== JSON.stringify(current)) w.sequence++;
    });
  }
  async function sync(): Promise<bigint> {
    const block = await finalized();
    const world = readWorld();
    const known = Object.values(world.items).filter(i => i.chain);
    const records = await Promise.all(known.map(async item => ({ id: item.id,
      value: await destination.readContract({ address: config.destination.address, abi: itemsAbi, functionName: "items", args: [item.chain!.tokenId], blockNumber: block.number! }),
      escrow: await destination.readContract({ address: config.destination.address, abi: itemsAbi, functionName: "itemOrder", args: [item.chain!.tokenId], blockNumber: block.number! }),
    })));
    const ids = new Set<Hex>(getOrders(world).map(o => o.id));
    records.forEach(r => { if (r.escrow !== zeroHash) ids.add(r.escrow); });
    const orders = await Promise.all([...ids].map(async id => ({ id, value: await destination.readContract({ address: config.destination.address, abi: itemsAbi, functionName: "order", args: [id], blockNumber: block.number! }) })));
    transact(w => {
      const before = JSON.stringify([w.items, w.ships, w.settlement!.orders]);
      for (const record of orders) {
        const [terms, status] = record.value;
        if (status === 0) continue;
        let o = getOrders(w).find(v => v.id === record.id);
        if (!o) {
          const item = known.find(i => i.chain!.tokenId === terms.itemId);
          if (!item) continue;
          o = { id: record.id, item: item.id, seller: playerFor(w, terms.seller), buyer: playerFor(w, terms.buyer), terms: JSON.parse(stringify(terms)), status: "reserved" };
          o.terms.expires = Number(terms.expires); o.terms.sourceChainId = Number(terms.sourceChainId); o.terms.destinationChainId = Number(terms.destinationChainId);
          getOrders(w).push(o);
        }
        o.seller = playerFor(w, terms.seller); o.buyer = playerFor(w, terms.buyer);
        if (status === 2 || status === 3) { o.status = status === 2 ? "owned" : "cancelled"; delete o.error; }
        else if (o.status === "draft") o.status = "reserved";
      }
      for (const record of records) {
        const item = w.items[record.id], chain = item.chain!;
        const [owner, maker, kind, finish, installedShip, consumed] = record.value;
        if (owner === zeroAddress) continue;
        if (kind !== kindId(item) || finish.toLowerCase() !== ("0x" + item.look.hull.slice(1) + item.look.sail.slice(1)).toLowerCase() || !same(maker, w.players[item.maker]?.wallet)) throw new Error("Minted item metadata differs from its game production record.");
        const oldShip = item.installed && w.ships[item.installed];
        const nextShip = Object.values(w.ships).find(s => shipToken(s.id, config.tokenNamespace) === installedShip);
        const newInstallation = nextShip && (item.installed !== nextShip.id || chain.task === "install");
        if (oldShip && (!nextShip || nextShip.id !== oldShip.id)) {
          if (item.kind !== "livery") delete oldShip.modules[item.kind];
          item.port = oldShip.port; delete oldShip.chainPending;
        }
        if (!same(owner, config.destination.address)) item.owner = playerFor(w, owner);
        chain.status = consumed ? "consumed" : same(owner, config.destination.address) ? "escrow" : "owned";
        item.consumed = consumed; item.installed = nextShip?.id ?? null;
        if (nextShip) {
          if (nextShip.owner !== item.owner) throw new Error("Installed item and boat ownership differ.");
          item.port = null; item.ship = null;
          if (newInstallation && (item.kind === "livery" || item.kind === "cargoModule")) nextShip.look = { ...item.look };
          if (item.kind !== "livery") nextShip.modules[item.kind] = item.id;
          if (nextShip.chainPending === item.id && chain.task === "install") { delete nextShip.chainPending; delete chain.task; }
        } else if (chain.task === "uninstall" && oldShip) delete chain.task;
        if (chain.task === "mint") delete chain.task;
        if (!chain.task) delete chain.error;
      }
      if (before !== JSON.stringify([w.items, w.ships, w.settlement!.orders])) w.sequence++;
      w.settlement!.lastSync = now(); w.settlement!.block = String(block.number); delete w.settlement!.error;
    });
    return block.number;
  }
  async function findSource(order: ChainOrder, finalBlock: bigint): Promise<void> {
    const key = "source:" + order.id;
    const saved = db.prepare("SELECT value FROM chain_meta WHERE key=?").get(key) as { value: string } | undefined;
    const from = saved ? BigInt(saved.value) : BigInt(config.source.startBlock);
    if (from > finalBlock) return;
    const to = from + 999n < finalBlock ? from + 999n : finalBlock;
    const logs = await source.getLogs({ address: config.source.address, events: checkoutAbi.filter(v => v.type === "event"), fromBlock: from, toBlock: to });
    const event = logs.find(l => l.args.orderId === order.id);
    if (event?.transactionHash) transact(w => { const o = findOrder(w, order.id); o.sourceTx = event.transactionHash!; w.sequence++; });
    db.prepare("INSERT INTO chain_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, String(to + 1n));
  }
  async function prove(order: ChainOrder, finalBlock: bigint): Promise<void> {
    if (!order.sourceTx || order.sourcePaid === undefined) return;
    const receipt = await source.getTransactionReceipt({ hash: order.sourceTx });
    if (receipt.blockNumber > finalBlock) return;
    const jobId = "settle:" + order.id;
    const existing = db.prepare("SELECT * FROM chain_jobs WHERE id=?").get(jobId) as Job | undefined;
    if (existing && (existing.state !== "failed" || existing.raw)) return;
    const response = await fetch(config.proofUrl.replace(/\/$/, "") + "/api/v1/proof-by-tx/" + config.source.chainKey + "/" + order.sourceTx, { signal: AbortSignal.timeout(10000) });
    const payload = await response.text();
    if (payload.length > 2_000_000) throw new Error("Proof response exceeds the pilot's limit.");
    const proof = JSON.parse(payload);
    if (!response.ok) {
      transact(w => {
        const o = findOrder(w, order.id);
        const error = response.status === 422 ? "Source block is waiting for attestation. The item remains reserved." : "Proof service unavailable. This order will be retried.";
        if (o.status !== "verificationPending" || o.error !== error) w.sequence++;
        o.status = "verificationPending"; o.error = error;
      });
      return;
    }
    if (proof.chainKey !== config.source.chainKey || BigInt(proof.headerNumber) !== receipt.blockNumber || !same(proof.txHash, order.sourceTx) ||
        typeof proof.txBytes !== "string" || !/^0x[0-9a-f]+$/i.test(proof.txBytes) || !hex(proof.merkleProof?.root, 32) ||
        !Array.isArray(proof.merkleProof?.siblings) || proof.merkleProof.siblings.length > 256 ||
        !proof.merkleProof.siblings.every((s: any) => hex(s.hash, 32) && typeof s.isLeft === "boolean") ||
        !hex(proof.continuityProof?.lowerEndpointDigest, 32) || !Array.isArray(proof.continuityProof?.roots) || proof.continuityProof.roots.length > 4096 ||
        !proof.continuityProof.roots.every((r: unknown) => hex(r, 32))) throw new Error("Proof response does not describe this source transaction.");
    transact(w => {
      const o = findOrder(w, order.id);
      if (["owned", "cancelled"].includes(o.status)) return;
      const body = stringify({ functionName: "settle", args: [o.id, proof.headerNumber, proof.txBytes, proof.merkleProof, proof.continuityProof] });
      if (existing) db.prepare("UPDATE chain_jobs SET state='queued',body=?,raw=NULL,hash=NULL,error=NULL WHERE id=?").run(body, jobId);
      else queue({ id: jobId, item: o.item, player: o.buyer, ship: "", kind: "settle", body });
      o.status = "verificationPending"; delete o.error; w.sequence++;
    });
  }
  function finishJob(job: Job, success: boolean, error?: string): void {
    transact(w => {
      db.prepare("UPDATE chain_jobs SET state=?,error=? WHERE id=?").run(success ? "done" : "failed", success ? null : error ?? "Transaction reverted.", job.id);
      const item = w.items[job.item];
      if (job.kind === "settle") {
        const o = getOrders(w).find(o => o.id === job.id.slice(7));
        if (o) { if (job.hash) o.settleTx = job.hash; if (!success) o.error = job.raw ? "Destination transaction reverted. Escrow remains reserved; review is required before another transaction." : "The proof could not execute. Escrow remains reserved while verification is retried."; }
      } else if (item?.chain) {
        if (job.hash) item.chain.tx = job.hash;
        if (!success) {
          delete item.chain.task; item.chain.error = error ?? "The chain transaction reverted. You may retry this action.";
          const ship = w.ships[job.ship]; if (ship?.chainPending === item.id) delete ship.chainPending;
        }
      }
      w.sequence++;
    });
  }
  async function runJob(finalBlock: bigint): Promise<void> {
    if (!writeEnabled || !wallet || !account) return;
    const job = db.prepare("SELECT * FROM chain_jobs WHERE state IN ('queued','signed','sent') ORDER BY rowid LIMIT 1").get() as Job | undefined;
    if (!job) return;
    if (!job.raw) {
      try {
        const body = JSON.parse(job.body);
        await destination.simulateContract({ account, address: config.destination.address, abi: itemsAbi as Abi, functionName: body.functionName, args: body.args });
        const data = encodeFunctionData({ abi: itemsAbi as Abi, functionName: body.functionName, args: body.args });
        const request = await wallet.prepareTransactionRequest({ account, to: config.destination.address, data, chain: network });
        if (config.mode === "testnet") {
          const budget = config.budget;
          const used = JSON.parse((db.prepare("SELECT value FROM chain_meta WHERE key='fee-budget'").get() as { value: string } | undefined)?.value ?? '{"count":0,"fee":"0"}');
          const fee = request.maxFeePerGas ?? request.gasPrice ?? 0n, gas = request.gas ?? 0n;
          if (!budget || gas === 0n || fee === 0n || used.count >= budget.maxTransactions || gas > BigInt(budget.maxGas) || fee > BigInt(budget.maxFeePerGas) || BigInt(used.fee) + gas * fee > BigInt(budget.maxTotalFee)) throw new Error("The approved testnet transaction budget is exhausted or this transaction exceeds its limits.");
        }
        const raw = await wallet.signTransaction(request);
        job.raw = raw; job.hash = keccak256(raw);
        // Commit the exact signed bytes BEFORE broadcast. Restart/retry sends the same hash and nonce.
        db.exec("BEGIN IMMEDIATE");
        try {
          if (config.mode === "testnet") {
            const used = JSON.parse((db.prepare("SELECT value FROM chain_meta WHERE key='fee-budget'").get() as { value: string } | undefined)?.value ?? '{"count":0,"fee":"0"}');
            used.count++; used.fee = String(BigInt(used.fee) + request.gas! * (request.maxFeePerGas ?? request.gasPrice!));
            db.prepare("INSERT INTO chain_meta VALUES ('fee-budget',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(used));
          }
          db.prepare("UPDATE chain_jobs SET raw=?,hash=?,state='signed' WHERE id=?").run(raw, job.hash, job.id);
          db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
      } catch (error) {
        const reverted = error instanceof BaseError && error.walk(e => e instanceof ContractFunctionRevertedError);
        if (reverted instanceof ContractFunctionRevertedError) finishJob(job, false, "The contract rejected this action; the boat is unlocked. " + shortError(reverted));
        else db.prepare("UPDATE chain_jobs SET error=? WHERE id=?").run(shortError(error), job.id);
        throw error;
      }
    }
    const receipt = await destination.getTransactionReceipt({ hash: job.hash! }).catch(() => null);
    if (!receipt) {
      try { await destination.sendRawTransaction({ serializedTransaction: job.raw }); db.prepare("UPDATE chain_jobs SET state='sent',error=NULL WHERE id=?").run(job.id); }
      catch (error) { db.prepare("UPDATE chain_jobs SET error=? WHERE id=?").run(shortError(error), job.id); }
      return;
    }
    if (receipt.blockNumber > finalBlock) return;
    finishJob(job, receipt.status === "success");
  }
  async function step(): Promise<void> {
    if (busy || closed) return;
    busy = true;
    try {
      const finalBlock = await sync();
      if (readOnly) return;
      const open = getOrders(readWorld()).filter(o => !["draft", "owned", "cancelled"].includes(o.status));
      if (open.length) {
        const sourceFinal = await source.getBlock({ blockTag: "finalized" });
        for (const order of open) {
          if (closed) break;
          try {
            if (!order.sourceTx) await findSource(order, sourceFinal.number!);
            let current = findOrder(readWorld(), order.id);
            await observedSource(current); current = findOrder(readWorld(), order.id);
            await prove(current, sourceFinal.number!);
          } catch (error) { transact(w => { const o = findOrder(w, order.id), message = shortError(error); if (o.error !== message) w.sequence++; o.error = message; }); }
        }
      }
      if (!closed) await runJob(finalBlock);
    } catch (error) { transact(w => { const message = shortError(error); if (w.settlement!.error !== message) w.sequence++; w.settlement!.error = message; }); }
    finally { busy = false; }
  }
  async function handle(player: string, session: string, path: string, input: Record<string, unknown>): Promise<unknown> {
    if (path === "/api/wallet/challenge") {
      if (typeof input.address !== "string" || !isAddress(input.address) || input.address === zeroAddress) fail("Choose a wallet address.");
      const address = getAddress(input.address), w = readWorld();
      if (w.players[player].wallet && !same(w.players[player].wallet, address)) fail("This house is already linked to another wallet.");
      const message = "Drift Republics wallet binding\nHouse: " + w.players[player].name + "\nAccount: " + player + "\nWallet: " + address + "\nMarket: " + config.destination.address + "\nChain: " + config.destination.chainId + "\nNonce: " + randomBytes(24).toString("hex") + "\nExpires: " + new Date(now() + 300000).toISOString() + "\nThis signature links your wallet to this house. It does not authorize a payment.";
      db.prepare("INSERT INTO chain_challenges VALUES (?,?,?,?) ON CONFLICT(session) DO UPDATE SET address=excluded.address,message=excluded.message,expires=excluded.expires").run(session, address, message, now() + 300000);
      return { message, address };
    }
    if (path === "/api/wallet/bind") {
      const challenge = db.prepare("SELECT * FROM chain_challenges WHERE session=?").get(session) as { address: Address; message: string; expires: number } | undefined;
      if (!challenge || challenge.expires < now() || !hex(input.signature, 65) || !await verifyMessage({ address: challenge.address, message: challenge.message, signature: input.signature })) fail("The wallet signature is invalid or expired. Open wallet details and link the house again.");
      transact(w => {
        if (Object.values(w.players).some(p => p.id !== player && same(p.wallet, challenge.address))) fail("That wallet is already linked to another house.");
        if (w.players[player].wallet && !same(w.players[player].wallet, challenge.address)) fail("This house is already linked to another wallet.");
        w.players[player].wallet = challenge.address; db.prepare("DELETE FROM chain_challenges WHERE session=?").run(session); w.sequence++;
      });
      return { ok: true };
    }
    if (readOnly && path !== "/api/chain/refresh") fail("This harbor is in chain viewing mode. Purchases and fitting changes are paused.");
    if (!readWorld().players[player].wallet) fail("Link your wallet to this house first.");
    if (path === "/api/chain/mint" || path === "/api/chain/install" || path === "/api/chain/uninstall") {
      if (!writeEnabled) fail("Creditcoin transactions are paused. Your goods are unchanged.");
      await sync();
      transact(w => {
        const item = ownItem(w, player, input.item), ship = docked(w, player), owner = w.players[player].wallet!;
        if (item.chain?.task) fail("This item already has a pending chain action.");
        const action = path.slice(path.lastIndexOf("/") + 1) as "mint" | "install" | "uninstall";
        let args: unknown[];
        if (action === "mint") {
          if (item.tier) fail("Reinforced fittings can only be traded for Marks. They cannot be recorded on Creditcoin yet.");
          if (item.installed || item.ship || item.port !== ship.port || (item.chain && item.chain.status !== "minting")) fail("Publish an uninstalled item from this harbor's warehouse.");
          const maker = w.players[item.maker].wallet;
          if (!maker) fail("The maker must link a wallet before this item is published.");
          item.chain = { tokenId: itemToken(item.id, config.tokenNamespace), status: "minting", task: "mint" };
          args = [item.chain.tokenId, owner, maker, kindId(item), "0x" + item.look.hull.slice(1) + item.look.sail.slice(1)];
        } else {
          if (!item.chain || item.chain.status !== "owned") fail("Wait for confirmed Creditcoin ownership.");
          if (action === "install") {
            if (item.installed || item.port !== ship.port) fail("The item must be in this harbor's warehouse.");
            if (item.kind !== "livery" && ship.modules[item.kind]) fail("Remove the current fitting first.");
          } else {
            if (item.installed !== ship.id || item.kind === "livery") fail("That fitting is not installed on this boat.");
            if (item.kind === "cargoModule" && !canRemoveRig(w, ship)) fail("Unload within the hull limits before removing the cargo rig.");
          }
          item.chain.task = action; ship.chainPending = item.id;
          args = [item.chain.tokenId, owner, action === "install" ? shipToken(ship.id, config.tokenNamespace) : zeroHash];
        }
        queue({ id: randomUUID(), item: item.id, player, ship: ship.id, kind: action, body: stringify({ functionName: action === "mint" ? "mint" : "setInstallation", args }) });
        w.sequence++;
      });
      return { ok: true };
    }
    if (path === "/api/chain/order") {
      await sync();
      return transact(w => {
        const item = ownItem(w, player, input.item), ship = docked(w, player), buyer = w.players[String(input.buyer)];
        if (!item.chain || item.chain.status !== "owned" || item.chain.task || item.installed || item.port !== ship.port) fail("Choose a confirmed, uninstalled item in this harbor.");
        if (!buyer?.wallet || buyer.id === player) fail("Choose another house with a linked wallet.");
        if (typeof input.amount !== "string" || !/^[1-9][0-9]{0,18}$/.test(input.amount) || BigInt(input.amount) > 1000000000000000000n) fail("Enter a price above zero and no more than 1 test ETH.");
        if (!Number.isSafeInteger(input.minutes) || Number(input.minutes) < 5 || Number(input.minutes) > 120) fail("Choose a payment window from 5 to 120 minutes.");
        const existing = getOrders(w).find(o => o.item === item.id && o.status === "draft" && o.terms.expires > Math.floor(now() / 1000));
        if (existing) fail("This item has a draft order. Reserve it or discard the draft first.");
        const terms: OrderTerms = { itemId: item.chain.tokenId, seller: w.players[player].wallet as Address, buyer: buyer.wallet as Address,
          amount: input.amount, expires: Math.floor(now() / 1000) + Number(input.minutes) * 60,
          sourceChainId: config.source.chainId, source: config.source.address, destinationChainId: config.destination.chainId, destination: config.destination.address, nonce: toHex(randomBytes(32)) };
        const order: ChainOrder = { id: orderId(terms), item: item.id, seller: player, buyer: buyer.id, terms, status: "draft" };
        getOrders(w).push(order); w.sequence++; return order;
      }).result;
    }
    if (path === "/api/chain/authorize") {
      if (!hex(input.signature, 65)) fail("Sign the exact quoted order with the seller wallet.");
      const order = findOrder(readWorld(), input.id);
      if (order.seller !== player || order.status !== "draft" || !await verifyMessage({ address: order.terms.seller, message: { raw: order.id }, signature: input.signature })) fail("The signature does not match this seller and quote. Review the order with the seller’s linked wallet.");
      transact(w => { findOrder(w, input.id).signature = input.signature as Hex; w.sequence++; }); return { ok: true };
    }
    if (path === "/api/chain/discard") {
      await sync();
      transact(w => {
        const order = findOrder(w, input.id);
        if (order.seller !== player || order.status !== "draft" || order.signature || order.reserveTx) fail("Only an unsigned, unsubmitted draft can be discarded.");
        w.settlement!.orders = getOrders(w).filter(o => o.id !== order.id); w.sequence++;
      }); return { ok: true };
    }
    if (path === "/api/chain/track") {
      if (!hex(input.hash, 32) || !["source", "reserve"].includes(String(input.side))) fail("Enter the transaction hash and chain.");
      transact(w => {
        const o = findOrder(w, input.id);
        if (o.buyer !== player && o.seller !== player) fail("This order belongs to another house.");
        if (input.side === "reserve") { if (o.seller !== player) fail("Only the seller submits the reservation."); o.reserveTx = input.hash as Hex; }
        else if (!["owned", "cancelled"].includes(o.status)) { o.sourceTx = input.hash as Hex; delete o.sourcePaid; }
        w.sequence++;
      }); return { ok: true };
    }
    if (path === "/api/chain/refresh") { await step(); return { ok: true }; }
    fail("Unknown chain action.");
  }
  return { step, handle, config: { ...config, writeEnabled, readOnly }, close: async () => {
    closed = true;
    while (busy) await new Promise(resolve => setTimeout(resolve, 50));
  } };
}
