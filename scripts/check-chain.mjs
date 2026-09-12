// Actual local source/destination contracts + authenticated HTTP clients + the production worker.
// Only Attestcoin's native proof verification is replaced by a clearly labelled local fixture.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPublicClient, createWalletClient, defineChain, encodeAbiParameters, http, keccak256, parseAbiParameters, toHex, zeroHash } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { createGameServer } from '../server/main.ts';
import { checkoutAbi, itemsAbi } from '../src/contract-abi.ts';
import { onchainTerms } from '../src/settlement.ts';

assert.equal(process.argv.length, 2, 'This check is local only. Use scripts/testnet-trial.mjs for the authorized testnet trial.');

const localMnemonic = 'test test test test test test test test test test test junk';
const accounts = [0, 1, 2, 9].map(addressIndex => mnemonicToAccount(localMnemonic, { addressIndex }));
const [operator, sellerWallet, buyerWallet, fixtureWallet] = accounts;
const directory = await mkdtemp(join(tmpdir(), 'drift-chain-check-'));
const children = [];
const miningClients = [];
const invite = randomBytes(18).toString('hex'), password = randomBytes(20).toString('hex');
let clock = Date.now(), app, proofServer, base, proofReady = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function unusedPort() {
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}
async function localChain(id) {
  const port = await unusedPort(), rpcUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.env.ANVIL_BIN ?? 'anvil', ['--silent', '--host', '127.0.0.1', '--port', String(port), '--chain-id', String(id), '--slots-in-an-epoch', '1'], { stdio: 'ignore' });
  children.push(child);
  const chain = defineChain({ id, name: 'Drift local fixture', nativeCurrency: { name: 'Test Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const client = createPublicClient({ chain, transport: http(rpcUrl, { retryCount: 0, timeout: 2000 }) });
  miningClients.push(client);
  for (let i = 0; i < 50; i++) { if (await client.getChainId().catch(() => 0) === id) return { client, chain, rpcUrl }; await sleep(50); }
  throw new Error('Local Anvil did not start.');
}
const wallet = (account, network) => createWalletClient({ account, chain: network.chain, transport: http(network.rpcUrl) });
const artifact = async name => JSON.parse(await readFile(`contract-out/${name}.sol/${name}.json`, 'utf8'));
async function deploy(network, name, args = []) {
  const contract = await artifact(name);
  const hash = await wallet(operator, network).deployContract({ abi: contract.abi, bytecode: contract.bytecode.object, args });
  const receipt = await network.client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success');
  return { address: receipt.contractAddress, startBlock: String(receipt.blockNumber) };
}
async function request(client, path, body, expected = 200) {
  const response = await fetch(base + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:4186', ...(client.cookie ? { Cookie: client.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  if (response.headers.get('set-cookie')) client.cookie = response.headers.get('set-cookie').split(';')[0];
  if (result.me) client.state = result;
  return result;
}
const act = (client, command, expected) => request(client, '/command', { key: randomUUID(), command }, expected);
const state = client => request(client, '/state');
async function start() {
  app = createGameServer({ dataDir: directory, invite, now: () => clock, tick: false });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + app.server.address().port;
}
async function pump(client, condition, description) {
  for (let i = 0; i < 30; i++) {
    for (const chain of miningClients) await chain.request({ method: 'anvil_mine', params: ['0x3', '0x1'] });
    await app.chainStep(); await state(client);
    if (condition(client.state)) return;
    await sleep(40);
  }
  const { settlement, items } = client.state;
  throw new Error(description + ' did not complete: ' + JSON.stringify({ settlement, items }));
}
async function sail(client, port) {
  const quote = await request(client, '/quote', { port, route: 'sail' });
  await act(client, { action: 'voyage', port, route: 'sail' }); clock = quote.arriveAt + 100; await state(client);
}
try {
  const source = await localChain(31337), destination = await localChain(31338);
  const checkout = await deploy(source, 'DriftCheckout');
  const market = await deploy(destination, 'DriftItems', [operator.address, checkout.address, 31337n, 1n]);
  const fixture = JSON.parse(await readFile('contract-out/DriftSettlement.t.sol/LocalBlockProver.json', 'utf8'));
  await destination.client.request({ method: 'anvil_setCode', params: ['0x0000000000000000000000000000000000000FD2', fixture.deployedBytecode.object] });
  for (const chain of miningClients) await chain.request({ method: 'anvil_mine', params: ['0x3', '0x1'] });
  proofServer = createServer(async (req, res) => {
    try {
      const hash = req.url?.split('/').at(-1);
      if (!proofReady) { res.writeHead(422, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: 'Local fixture: proof deliberately delayed', retriable: true })); return; }
      assert.match(hash, /^0x[a-f0-9]{64}$/i);
      const receipt = await source.client.getTransactionReceipt({ hash });
      const chunks = [
        encodeAbiParameters(parseAbiParameters('uint64,uint64,address,bool,address,uint256,bytes'), [0n, 100000n, receipt.from, false, receipt.to, 0n, '0x']),
        '0x',
        encodeAbiParameters(parseAbiParameters('uint8,uint64,(address address_,bytes32[] topics,bytes data)[],bytes'), [receipt.status === 'success' ? 1 : 0, receipt.gasUsed, receipt.logs.map(l => ({ address_: l.address, topics: l.topics, data: l.data })), receipt.logsBloom]),
      ];
      const txBytes = encodeAbiParameters(parseAbiParameters('uint8,bytes[]'), [2, chunks]);
      const approved = await wallet(fixtureWallet, destination).writeContract({ address: '0x0000000000000000000000000000000000000FD2', abi: fixture.abi, functionName: 'approve', args: [txBytes, receipt.blockNumber] });
      await destination.client.waitForTransactionReceipt({ hash: approved });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ chainKey: 1, headerNumber: Number(receipt.blockNumber), txHash: hash, txBytes, merkleProof: { root: keccak256(txBytes), siblings: [] }, continuityProof: { lowerEndpointDigest: zeroHash, roots: [] } }));
    } catch { res.writeHead(503); res.end('{}'); }
  });
  await new Promise(resolve => proofServer.listen(0, '127.0.0.1', resolve));
  const config = { mode: 'local', authority: operator.address, writeEnabled: true, proofUrl: 'http://127.0.0.1:' + proofServer.address().port,
    source: { ...checkout, chainId: 31337, chainKey: 1, rpcUrl: source.rpcUrl, explorer: '' }, destination: { ...market, chainId: 31338, rpcUrl: destination.rpcUrl, explorer: '' } };
  await writeFile(join(directory, 'chain.json'), JSON.stringify(config), { mode: 0o600 });
  await writeFile(join(directory, 'operator.key'), toHex(operator.getHdKey().privateKey), { mode: 0o600 });
  await start();
  const seller = {}, buyer = {};
  for (const [client, account, name, home, workshop] of [[seller, sellerWallet, 'Chain Shipwright', 'bastion', 'shipyard'], [buyer, buyerWallet, 'Chain Hauler', 'reedhaven', 'refinery']]) {
    await request(client, '/register', { name, password, invite, home, workshop }, 201);
    const challenge = await request(client, '/wallet/challenge', { address: account.address });
    await request(client, '/wallet/bind', { signature: await account.signMessage({ message: challenge.message }) });
    await state(client); assert.equal(client.state.me.wallet.toLowerCase(), account.address.toLowerCase());
  }
  for (const [client, recipe, batches] of [[seller, 'cargoModule', 1], [buyer, 'fuel', 6]]) await act(client, { action: 'craft', workshop: client.state.workshops.find(w => w.owner === client.state.me.id).id, recipe, batches, look: { hull: '#a63f32', sail: '#f4e8cf' } });
  const marksBeforeChain=buyer.state.me.marks;
  clock += 270001; await state(seller);
  const rig = Object.values(seller.state.items).find(i => i.owner === seller.state.me.id);
  await request(seller, '/chain/mint', { item: rig.id });
  await pump(seller, w => w.items[rig.id].chain?.status === 'owned', 'earned-item mint');
  const order = await request(seller, '/chain/order', { item: rig.id, buyer: buyer.state.me.id, amount: '100000000000000', minutes: 5 });
  const signature = await sellerWallet.signMessage({ message: { raw: order.id } });
  await request(seller, '/chain/authorize', { id: order.id, signature });
  const reservation = await wallet(sellerWallet, destination).writeContract({ address: market.address, abi: itemsAbi, functionName: 'reserve', args: [onchainTerms(order.terms), signature] });
  await destination.client.waitForTransactionReceipt({ hash: reservation });
  await pump(buyer, w => w.settlement.orders.find(o => o.id === order.id)?.status === 'reserved', 'reservation indexing');
  await request(buyer, '/chain/install', { item: rig.id }, 400);
  const paid = await wallet(buyerWallet, source).writeContract({ address: checkout.address, abi: checkoutAbi, functionName: 'pay', args: [onchainTerms(order.terms), signature], value: BigInt(order.terms.amount) });
  await source.client.waitForTransactionReceipt({ hash: paid });
  await request(buyer, '/chain/track', { id: order.id, side: 'source', hash: paid });
  await pump(buyer, w => w.settlement.orders.find(o => o.id === order.id)?.status === 'verificationPending', 'delayed-proof state');
  const afterExpiry = order.terms.expires + 60;
  await source.client.request({ method: 'evm_setNextBlockTimestamp', params: [afterExpiry] }); await source.client.request({ method: 'evm_mine', params: [] });
  await destination.client.request({ method: 'evm_setNextBlockTimestamp', params: [afterExpiry] }); await destination.client.request({ method: 'evm_mine', params: [] });
  clock = afterExpiry * 1000;
  await assert.rejects(() => wallet(sellerWallet, source).writeContract({ address: checkout.address, abi: checkoutAbi, functionName: 'closeUnpaid', args: [onchainTerms(order.terms)] }));
  await app.close(); await start();
  await state(buyer); assert.equal(buyer.state.items[rig.id].chain.status, 'escrow', 'paid item survives expiry and service restart');
  proofReady = true;
  // Model a persisted reverted transaction: a fresh proof must not replace its signed bytes.
  const jobs = new DatabaseSync(join(directory, 'drift.sqlite'));
  jobs.prepare("INSERT INTO chain_jobs VALUES (?,?,?,?,?,?,'failed',?,?,?)").run('settle:' + order.id, rig.id, buyer.state.me.id, '', 'settle', '{}', '0x01', zeroHash, 'Local reverted-transaction fixture');
  await app.chainStep();
  assert.equal(jobs.prepare('SELECT raw FROM chain_jobs WHERE id=?').get('settle:' + order.id).raw, '0x01', 'a reverted settlement must not be replaced automatically');
  jobs.prepare('DELETE FROM chain_jobs WHERE id=?').run('settle:' + order.id);
  jobs.close();
  await pump(buyer, w => w.items[rig.id].owner === w.me.id && w.items[rig.id].chain.status === 'owned', 'proof-settled ownership');
  assert.equal(buyer.state.me.marks, marksBeforeChain, 'source payment does not mint or spend Marks');
  await sail(buyer, 'bastion');
  await request(buyer, '/chain/install', { item: rig.id });
  await act(buyer, { action: 'voyage', port: 'reedhaven', route: 'sail' }, 400);
  await pump(buyer, w => w.ships[w.me.selectedShip].modules.cargoModule === rig.id && !w.ships[w.me.selectedShip].chainPending, 'confirmed fitting installation');
  assert.equal(buyer.state.ships[buyer.state.me.selectedShip].look.hull, '#a63f32');
  await state(seller); await act(seller, { action: 'requestDelivery', port: 'bastion', good: 'fuel', quantity: 14, price: 140, minutes: 10 });
  const delivery = seller.state.deliveries.at(-1);
  await act(buyer, { action: 'supplyDelivery', delivery: delivery.id, port: 'reedhaven', fee: 0 });
  await sail(buyer, 'reedhaven'); await act(buyer, { action: 'takeHaul', delivery: delivery.id }); await sail(buyer, 'bastion');
  assert.equal(buyer.state.me.marks, marksBeforeChain-6+140-7, 'three berths and the 5% sale fee reach city treasuries'); assert.equal(buyer.state.deliveries.find(d => d.id === delivery.id).status, 'delivered');
  await state(seller); assert.equal(seller.state.me.warehouse.bastion.fuel, 16);
  // Remove and resell the same finite rig. This order ends unpaid and returns it to its current owner.
  await request(buyer, '/chain/uninstall', { item: rig.id });
  await pump(buyer, w => !w.items[rig.id].installed && !w.ships[w.me.selectedShip].chainPending, 'confirmed module removal');
  const unpaid = await request(buyer, '/chain/order', { item: rig.id, buyer: seller.state.me.id, amount: '100000000000000', minutes: 5 });
  const unpaidSignature = await buyerWallet.signMessage({ message: { raw: unpaid.id } });
  await request(buyer, '/chain/authorize', { id: unpaid.id, signature: unpaidSignature });
  const reservedAgain = await wallet(buyerWallet, destination).writeContract({ address: market.address, abi: itemsAbi, functionName: 'reserve', args: [onchainTerms(unpaid.terms), unpaidSignature] });
  await destination.client.waitForTransactionReceipt({ hash: reservedAgain });
  await pump(buyer, w => w.items[rig.id].chain.status === 'escrow', 'second reservation');
  await source.client.request({ method: 'evm_setNextBlockTimestamp', params: [unpaid.terms.expires + 1] }); await source.client.request({ method: 'evm_mine', params: [] });
  const closed = await wallet(sellerWallet, source).writeContract({ address: checkout.address, abi: checkoutAbi, functionName: 'closeUnpaid', args: [onchainTerms(unpaid.terms)] });
  await source.client.waitForTransactionReceipt({ hash: closed });
  // Do not report the hash: the persisted source scan must discover the missed event itself.
  await pump(buyer, w => w.settlement.orders.find(o => o.id === unpaid.id)?.status === 'cancelled', 'missed-event recovery and unpaid cancellation');
  assert.equal(buyer.state.items[rig.id].owner, buyer.state.me.id); assert.equal(buyer.state.items[rig.id].chain.status, 'owned');
  assert.equal(Object.keys(buyer.state.items).length, 1, 'no duplicate item minted by settlement or retries');
  await app.close();
  // Viewing mode must not load even an unusable operator key or accept a transaction job.
  await writeFile(join(directory, 'operator.key'), 'not-a-signing-key', { mode: 0o600 });
  process.env.DRIFT_CHAIN_READ_ONLY = '1';
  await start();
  const viewing = await request(buyer, '/config');
  assert.equal(viewing.settlement.readOnly, true); assert.equal(viewing.settlement.writeEnabled, false);
  await request(buyer, '/chain/install', { item: rig.id }, 400);
  await app.chainStep(); await state(buyer);
  assert.equal(buyer.state.items[rig.id].installed, null);
  console.log('chain pipeline passed: two authenticated wallets, earned mint, reservation, delayed proof + restart, ownership, equip, 14-unit delivery, uninstall, missed-source-event recovery and unpaid cancellation. LOCAL PROOF FIXTURE ONLY.');
} finally {
  delete process.env.DRIFT_CHAIN_READ_ONLY;
  await app?.close();
  if (proofServer) await new Promise(resolve => proofServer.close(resolve));
  for (const child of children) child.kill('SIGTERM');
  await Promise.all(children.map(child => child.exitCode !== null ? null : new Promise(resolve => child.once('exit', resolve))));
  await rm(directory, { recursive: true, force: true });
}
