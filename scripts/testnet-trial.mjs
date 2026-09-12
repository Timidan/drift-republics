// Resumable, bounded REAL Sepolia -> Creditcoin trial. No fixture or accelerated clock.
// Default is read-only readiness; --run <review hash> is used only after authorization.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, http, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createGameServer } from '../server/main.ts';
import { checkoutAbi, itemsAbi } from '../src/contract-abi.ts';
import { onchainTerms } from '../src/settlement.ts';

const directory = resolve('data/testnet');
const read = name => JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
const review = read('review.json'), reviewHash = keccak256(toHex(readFileSync(resolve(directory, 'review.json'), 'utf8')));
if (process.argv.length === 2) {
  console.log(JSON.stringify({ broadcast: false, reviewHash, deploymentsRecorded: existsSync(resolve(directory, 'deployment-receipts.json')), configured: existsSync(resolve(directory, 'chain.json')), trialRecorded: existsSync(resolve(directory, 'trial.json')) }, null, 2));
  process.exit(0);
}
assert.equal(process.argv[2], '--run', 'Use --run only after explicit authorization.');
assert.equal(process.argv[3], reviewHash, 'Supply the exact authorized review hash.');
assert.equal(process.argv.length, 4);
const config = read('chain.json');
assert.equal(config.mode, 'testnet');
assert.equal(config.source.chainId, 11155111); assert.equal(config.destination.chainId, 102031);
assert.equal(config.writeEnabled, true); assert.deepEqual(config.budget, review.workerBudget);
for (const side of ['source', 'destination']) assert.equal(config[side].address.toLowerCase(), review.operations.find(op => op.side === side).address.toLowerCase());
const accounts = Object.fromEntries(['seller', 'buyer'].map(name => [name, privateKeyToAccount(readFileSync(resolve(directory, name + '.key'), 'utf8').trim())]));
for (const name of ['seller', 'buyer']) assert.equal(accounts[name].address, review.accounts[name]);
const networks = Object.fromEntries(['source', 'destination'].map(side => {
  const c = config[side], chain = defineChain({ id: c.chainId, name: side, nativeCurrency: { name: side === 'source' ? 'ETH' : 'CTC', symbol: side === 'source' ? 'ETH' : 'CTC', decimals: 18 }, rpcUrls: { default: { http: [c.rpcUrl] } } });
  const rpc = process.env[side === 'source' ? 'DRIFT_SOURCE_RPC' : 'DRIFT_CTC_RPC'] ?? c.rpcUrl;
  return [side, { chain, rpc, client: createPublicClient({ chain, transport: http(rpc, { timeout: 15000, retryCount: 0 }) }) }];
}));
for (const [side, n] of Object.entries(networks)) assert.equal(await n.client.getChainId(), config[side].chainId);
const trial = existsSync(resolve(directory, 'trial.json')) ? read('trial.json') : { reviewHash, createdAt: new Date().toISOString(), password: randomBytes(24).toString('hex'), steps: {}, commandKeys: {}, transactions: {} };
assert.equal(trial.reviewHash, reviewHash);
const save = () => {
  writeFileSync(resolve(directory, 'trial.json.tmp'), JSON.stringify(trial, null, 2) + '\n', { mode: 0o600 });
  renameSync(resolve(directory, 'trial.json.tmp'), resolve(directory, 'trial.json'));
};
save();
let app, base;
const clients = { seller: {}, buyer: {} };
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function start() {
  app = createGameServer({ dataDir: directory, tick: false });
  await new Promise(done => app.server.listen(0, '127.0.0.1', done));
  base = 'http://127.0.0.1:' + app.server.address().port;
}
async function request(who, path, body) {
  const c = clients[who];
  const response = await fetch(base + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:4186', ...(c.cookie ? { Cookie: c.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const value = await response.json();
  if (!response.ok) throw new Error(path + ': ' + JSON.stringify(value));
  if (response.headers.get('set-cookie')) c.cookie = response.headers.get('set-cookie').split(';')[0];
  if (value.me) c.state = value;
  return value;
}
const state = who => request(who, '/state');
async function command(who, label, action) {
  trial.commandKeys[label] ??= randomUUID(); save();
  return request(who, '/command', { key: trial.commandKeys[label], command: action });
}
async function step(label, fn) {
  if (Object.hasOwn(trial.steps, label)) return trial.steps[label];
  console.log('Trial: ' + label);
  const value = await fn(); trial.steps[label] = value ?? true; save(); return value;
}
async function until(label, test, chain = true) {
  const deadline = Date.now() + 45 * 60_000;
  let lastReport = 0;
  while (Date.now() < deadline) {
    if (chain) await app.chainStep();
    await state('buyer'); await state('seller');
    if (await test()) return;
    if (Date.now() - lastReport > 55000) { console.log('Waiting: ' + label); lastReport = Date.now(); }
    await sleep(10000);
  }
  throw new Error(label + ' is still pending. Run the same authorized command to resume; saved transactions are reused.');
}
async function send(label, who, side, functionName, args, value = 0n) {
  const n = networks[side], abi = side === 'source' ? checkoutAbi : itemsAbi;
  let signed = trial.transactions[label];
  if (!signed) {
    assert.ok(Object.keys(trial.transactions).length < 4, 'The four reviewed user transactions are exhausted.');
    const data = encodeFunctionData({ abi, functionName, args }), account = accounts[who];
    const gas = functionName === 'reserve' ? 300000n : functionName === 'pay' ? 180000n : 120000n;
    const gasPrice = side === 'source' ? 10000000000n : 2000000000n;
    assert.ok(await n.client.estimateGas({ account, to: config[side].address, data, value }) <= gas, 'Transaction exceeds its reviewed gas limit.');
    assert.ok(await n.client.getGasPrice() <= gasPrice, 'Network gas price exceeds the reviewed ceiling.');
    assert.ok(await n.client.getBalance({ address: account.address }) >= value + gas * gasPrice, 'Fund the dedicated ' + who + ' wallet on ' + side + '.');
    const wallet = createWalletClient({ account, chain: n.chain, transport: http(n.rpc) });
    const raw = await wallet.signTransaction({ account, chain: n.chain, to: config[side].address, data, value, gas, gasPrice, nonce: await n.client.getTransactionCount({ address: account.address, blockTag: 'pending' }), type: 'legacy' });
    signed = { side, who, functionName, raw, hash: keccak256(raw) }; trial.transactions[label] = signed; save();
  }
  assert.equal(signed.side, side); assert.equal(signed.who, who); assert.equal(signed.functionName, functionName); assert.equal(keccak256(signed.raw), signed.hash);
  let receipt = await n.client.getTransactionReceipt({ hash: signed.hash }).catch(() => null);
  if (!receipt) {
    try { await n.client.sendRawTransaction({ serializedTransaction: signed.raw }); }
    catch (error) { if (!await n.client.getTransaction({ hash: signed.hash }).catch(() => null)) throw error; }
    receipt = await n.client.waitForTransactionReceipt({ hash: signed.hash, timeout: 180000 });
  }
  assert.equal(receipt.status, 'success', 'A transaction reverted. Stop and review; do not automatically pay again.');
  signed.block = String(receipt.blockNumber); save(); return signed.hash;
}
async function sail(label, port) {
  await step(label, async () => {
    await command('buyer', label, { action: 'voyage', port, route: 'sail' });
    await until(label + ' arrival', () => clients.buyer.state.ships[clients.buyer.state.me.selectedShip].port === port, false);
  });
}
try {
  await start();
  const invite = readFileSync(resolve(directory, 'invite-code.txt'), 'utf8').trim();
  for (const [who, home, workshop] of [['seller', 'bastion', 'shipyard'], ['buyer', 'reedhaven', 'refinery']]) {
    const name = who === 'seller' ? 'Trial Shipwright' : 'Trial Hauler';
    try { await request(who, '/login', { name, password: trial.password }); }
    catch { await request(who, '/register', { name, password: trial.password, invite, home, workshop }); }
    if (!clients[who].state.me.wallet) {
      const challenge = await request(who, '/wallet/challenge', { address: accounts[who].address });
      await request(who, '/wallet/bind', { signature: await accounts[who].signMessage({ message: challenge.message }) });
    }
    await state(who); assert.equal(clients[who].state.me.wallet.toLowerCase(), accounts[who].address.toLowerCase());
  }
  const rig = await step('craft', async () => {
    for (const [who, recipe, batches] of [['seller', 'cargoModule', 1], ['buyer', 'fuel', 6]]) await command(who, 'craft-' + who, { action: 'craft', workshop: clients[who].state.workshops.find(w => w.owner === clients[who].state.me.id).id, recipe, batches, look: { hull: '#a63f32', sail: '#f4e8cf' } });
    await until('real workshop production', () => Object.values(clients.seller.state.items).some(i => i.maker === clients.seller.state.me.id) && !clients.buyer.state.workshops.some(w => w.owner === clients.buyer.state.me.id && w.job), false);
    return Object.values(clients.seller.state.items).find(i => i.maker === clients.seller.state.me.id).id;
  });
  await step('mint', async () => {
    if (!clients.seller.state.items[rig].chain) await request('seller', '/chain/mint', { item: rig });
    await until('finalized earned-item mint', () => clients.seller.state.items[rig].chain?.status === 'owned');
  });
  async function reserve(label, who, other) {
    return step(label, async () => {
      await state(who);
      let order = clients[who].state.settlement.orders.find(o => o.item === rig && o.seller === clients[who].state.me.id && !['owned', 'cancelled'].includes(o.status));
      order ??= await request(who, '/chain/order', { item: rig, buyer: clients[other].state.me.id, amount: review.purchaseAmountWei, minutes: 5 });
      const signature = order.signature ?? await accounts[who].signMessage({ message: { raw: order.id } });
      if (!order.signature) await request(who, '/chain/authorize', { id: order.id, signature });
      const hash = await send(label, who, 'destination', 'reserve', [onchainTerms(order.terms), signature]);
      await request(who, '/chain/track', { id: order.id, side: 'reserve', hash });
      await until('finalized ' + label, () => clients[who].state.settlement.orders.find(o => o.id === order.id)?.status === 'reserved');
      return { ...order, signature };
    });
  }
  const paidOrder = await reserve('paid-reservation', 'seller', 'buyer');
  await step('pay-once', async () => {
    const record = await networks.destination.client.readContract({ address: config.destination.address, abi: itemsAbi, functionName: 'order', args: [paidOrder.id], blockTag: 'finalized' });
    assert.equal(record[1], 1);
    const item = await networks.destination.client.readContract({ address: config.destination.address, abi: itemsAbi, functionName: 'items', args: [paidOrder.terms.itemId], blockTag: 'finalized' });
    assert.equal(item[0].toLowerCase(), config.destination.address.toLowerCase());
    const hash = await send('source-payment', 'buyer', 'source', 'pay', [onchainTerms(paidOrder.terms), paidOrder.signature], BigInt(review.purchaseAmountWei));
    await request('buyer', '/chain/track', { id: paidOrder.id, side: 'source', hash });
    return hash;
  });
  await step('expiry-restart', async () => {
    // Withhold worker polling past the payment deadline, then restart the real service.
    await until('paid reservation past expiry', async () => (await networks.source.client.getBlock()).timestamp > BigInt(paidOrder.terms.expires), false);
    await app.close(); await start(); await state('buyer');
    assert.equal(clients.buyer.state.items[rig].chain.status, 'escrow');
  });
  await step('verified-ownership', async () => {
    await until('native Attestcoin settlement', () => clients.buyer.state.items[rig].owner === clients.buyer.state.me.id && clients.buyer.state.items[rig].chain.status === 'owned');
    assert.equal(clients.buyer.state.me.marks, 600);
    return clients.buyer.state.settlement.orders.find(o => o.id === paidOrder.id);
  });
  await sail('pickup', 'bastion');
  await step('install', async () => {
    const item = clients.buyer.state.items[rig];
    if (!item.installed && !item.chain.task) await request('buyer', '/chain/install', { item: rig });
    await until('confirmed rig installation', () => clients.buyer.state.ships[clients.buyer.state.me.selectedShip].modules.cargoModule === rig);
  });
  const delivery = await step('delivery-order', async () => {
    await command('seller', 'request-fuel', { action: 'requestDelivery', port: 'bastion', good: 'fuel', quantity: 14, price: 140, minutes: 30 });
    return clients.seller.state.deliveries.at(-1).id;
  });
  await step('supply', () => command('buyer', 'supply-fuel', { action: 'supplyDelivery', delivery, port: 'reedhaven', fee: 0 }).then(() => true));
  await sail('load-port', 'reedhaven');
  await step('load', () => command('buyer', 'load-fuel', { action: 'takeHaul', delivery }).then(() => true));
  await sail('deliver', 'bastion');
  await step('use-confirmed', async () => {
    await state('buyer'); await state('seller');
    assert.equal(clients.buyer.state.deliveries.find(d => d.id === delivery).status, 'delivered');
    assert.equal(clients.buyer.state.me.marks, 740); assert.equal(clients.seller.state.me.warehouse.bastion.fuel, 16);
  });
  await step('uninstall', async () => {
    const item = clients.buyer.state.items[rig];
    if (item.installed && !item.chain.task) await request('buyer', '/chain/uninstall', { item: rig });
    await until('confirmed rig removal', () => !clients.buyer.state.items[rig].installed && !clients.buyer.state.ships[clients.buyer.state.me.selectedShip].chainPending);
  });
  const unpaid = await reserve('unpaid-reservation', 'buyer', 'seller');
  await step('close-unpaid', async () => {
    await until('unpaid order expiry', async () => (await networks.source.client.getBlock()).timestamp > BigInt(unpaid.terms.expires), false);
    return send('unpaid-close', 'seller', 'source', 'closeUnpaid', [onchainTerms(unpaid.terms)]);
  });
  await step('recovery', async () => {
    // Intentionally omit source hash tracking: the persisted event cursor must discover the close.
    await until('native unpaid recovery', () => clients.buyer.state.settlement.orders.find(o => o.id === unpaid.id)?.status === 'cancelled');
    assert.equal(clients.buyer.state.items[rig].owner, clients.buyer.state.me.id);
    assert.equal(Object.keys(clients.buyer.state.items).length, 1);
  });
  const evidence = { at: new Date().toISOString(), environment: 'REAL Sepolia -> Creditcoin testnet', reviewHash, source: config.source, destination: config.destination,
    item: clients.buyer.state.items[rig], delivery: clients.buyer.state.deliveries.find(d => d.id === delivery), orders: clients.buyer.state.settlement.orders,
    transactions: Object.fromEntries(Object.entries(trial.transactions).map(([name, tx]) => [name, { hash: tx.hash, side: tx.side, block: tx.block }])), completedSteps: Object.keys(trial.steps) };
  writeFileSync(resolve(directory, 'trial-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  console.log('REAL testnet trial completed; inspect data/testnet/trial-evidence.json. Browser-wallet signing is a separate check.');
} finally { await app?.close(); }
