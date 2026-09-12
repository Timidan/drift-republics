// Default is read-only preparation. --broadcast <review hash> is used only after explicit authorization.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, defineChain, encodeDeployData, formatEther, getContractAddress, http, keccak256, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const directory = resolve('data/testnet'); mkdirSync(directory, { recursive: true, mode: 0o700 });
if (process.argv.length !== 2 && !(process.argv[2] === '--broadcast' && process.argv.length === 4)) throw new Error('Use no arguments to prepare, or --broadcast <review hash> after authorization.');
const write = (name, value) => writeFileSync(resolve(directory, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const accounts = Object.fromEntries(['operator', 'seller', 'buyer'].map(name => {
  const path = resolve(directory, name + '.key');
  if (!existsSync(path)) write(name + '.key', generatePrivateKey() + '\n');
  return [name, privateKeyToAccount(readFileSync(path, 'utf8').trim())];
}));
const chainSettings = {
  source: { id: 11155111, name: 'Ethereum Sepolia', symbol: 'ETH', rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com', explorer: 'https://sepolia.etherscan.io', gasPrice: 10000000000n, gas: 1000000n },
  destination: { id: 102031, name: 'Creditcoin Testnet', symbol: 'CTC', rpcUrl: 'https://rpc.cc3-testnet.creditcoin.network', explorer: 'https://creditcoin-testnet.blockscout.com', gasPrice: 2000000000n, gas: 3000000n },
};
const networks = Object.fromEntries(Object.entries(chainSettings).map(([side, v]) => {
  const chain = defineChain({ id: v.id, name: v.name, nativeCurrency: { name: v.symbol, symbol: v.symbol, decimals: 18 }, rpcUrls: { default: { http: [v.rpcUrl] } } });
  const url = process.env[side === 'source' ? 'DRIFT_SOURCE_RPC' : 'DRIFT_CTC_RPC'] ?? v.rpcUrl;
  return [side, { chain, client: createPublicClient({ chain, transport: http(url, { timeout: 15000, retryCount: 0 }) }), wallet: createWalletClient({ account: accounts.operator, chain, transport: http(url, { timeout: 15000, retryCount: 0 }) }) }];
}));
for (const [side, n] of Object.entries(networks)) if (await n.client.getChainId() !== chainSettings[side].id) throw new Error('Wrong RPC chain: ' + side);
const abi = async name => JSON.parse(readFileSync(`contract-out/${name}.sol/${name}.json`, 'utf8'));
const broadcast = process.argv[2] === '--broadcast';
const reviewPath = resolve(directory, 'review.json');
let review;
if (!broadcast) {
  if (['source-deployment.json', 'destination-deployment.json'].some(name => existsSync(resolve(directory, name)))) throw new Error('Signed deployments already exist. Preserve this review and resume its exact hash.');
  const sourceNonce = await networks.source.client.getTransactionCount({ address: accounts.operator.address, blockTag: 'pending' });
  const destinationNonce = await networks.destination.client.getTransactionCount({ address: accounts.operator.address, blockTag: 'pending' });
  const sourceAddress = getContractAddress({ from: accounts.operator.address, nonce: BigInt(sourceNonce) });
  const destinationAddress = getContractAddress({ from: accounts.operator.address, nonce: BigInt(destinationNonce) });
  const checkout = await abi('DriftCheckout'), items = await abi('DriftItems');
  const operations = [
    { side: 'source', contract: 'DriftCheckout', nonce: sourceNonce, address: sourceAddress, data: encodeDeployData({ abi: checkout.abi, bytecode: checkout.bytecode.object }) },
    { side: 'destination', contract: 'DriftItems', nonce: destinationNonce, address: destinationAddress, data: encodeDeployData({ abi: items.abi, bytecode: items.bytecode.object, args: [accounts.operator.address, sourceAddress, 11155111n, 1n] }) },
  ].map(op => ({ ...op, chainId: chainSettings[op.side].id, value: '0', gas: String(chainSettings[op.side].gas), gasPrice: String(chainSettings[op.side].gasPrice), calldataHash: keccak256(op.data) }));
  review = {
    purpose: 'Deploy Drift source checkout and Creditcoin inventory, then run one paid rig purchase-to-delivery and one unpaid recovery trial. Test assets only.',
    preparedAt: new Date().toISOString(), authority: accounts.operator.address,
    accounts: Object.fromEntries(Object.entries(accounts).map(([name, account]) => [name, account.address])), operations,
    workerBudget: { maxTransactions: 12, maxGas: '2000000', maxFeePerGas: '2000000000', maxTotalFee: '50000000000000000' },
    purchaseAmountWei: '100000000000000',
    userTransactions: { count: 4, reservationGas: '300000', paymentGas: '180000', unpaidCloseGas: '120000', sourceGasPrice: '10000000000', destinationGasPrice: '2000000000' },
    exclusions: ['mainnet', 'public hosting', 'DNS/proxy changes', 'unrelated accounts or balances', 'additional paid orders'],
  };
  write('review.json', review);
  const reviewHash = keccak256(toHex(readFileSync(reviewPath, 'utf8')));
  const balances = {};
  for (const [name, account] of Object.entries(accounts)) {
    balances[name] = { address: account.address };
    for (const [side, n] of Object.entries(networks)) balances[name][chainSettings[side].symbol] = formatEther(await n.client.getBalance({ address: account.address }));
  }
  write('readiness.json', { at: new Date().toISOString(), reviewHash, balances, requiredFunding: { operator: { ETH: '0.015', CTC: '0.1' }, seller: { ETH: '0.005', CTC: '0.01' }, buyer: { ETH: '0.005', CTC: '0.01' } } });
  const lines = [
    '# Drift testnet transaction review', '', 'Prepared ' + review.preparedAt + '. No transaction has been broadcast by preparation.', '',
    'Review hash: `' + reviewHash + '`', '',
    'Two deployments use the dedicated operator wallet. The source checkout accepts native Sepolia test ETH. Creditcoin escrow releases an existing item only after the native Attestcoin verifier accepts its terminal source event.', '',
    '| Operation | Chain | Predicted contract | Value | Gas limit | Gas-price ceiling |', '|---|---|---|---:|---:|---:|',
    ...operations.map(o => `| ${o.contract} | ${o.chainId} | ${o.address} | 0 | ${o.gas} | ${BigInt(o.gasPrice) / 1000000000n} gwei |`), '',
    '| Dedicated wallet | Address | Suggested Sepolia ETH | Suggested testnet CTC |', '|---|---|---:|---:|',
    ...Object.entries(accounts).map(([name, account]) => `| ${name} | ${account.address} | ${name === 'operator' ? '0.015' : '0.005'} | ${name === 'operator' ? '0.1' : '0.01'} |`), '',
    'All three wallets currently hold the balances recorded in readiness.json. Keys stay in this private data directory and are never included in evidence or public files.', '',
    'Deployment gas is capped at 0.01 test ETH and 0.006 test CTC. The game worker may sign at most 12 further transactions, with a total fee ceiling of 0.05 test CTC. Each worker transaction is capped at 2,000,000 gas and 2 gwei. Insufficient funds or an exceeded cap stops new signing.', '',
    'The planned purchase transfers exactly 0.0001 Sepolia test ETH from buyer to seller. A second order closes unpaid. The trial creates two local authenticated game houses, consumes real workshop inputs, preserves the paid reservation through a delayed proof, installs the rig, completes a 14-unit delivery, removes it and tests unpaid cancellation. It does not change Marks during the source payment.', '',
    'The trial signs four user transactions: two Creditcoin reservations (300,000 gas each at 2 gwei), one source payment (180,000 gas at 10 gwei) and one unpaid close (120,000 gas at 10 gwei). These add at most 0.0012 test CTC and 0.003 test ETH in gas, plus the 0.0001 test ETH purchase. Exact signed bytes are persisted before broadcast; rerunning resumes the same transaction.', '',
    'No mainnet action, public deployment, DNS/proxy change or unrelated wallet use is included. Authorization must name this bounded bundle; if the review hash, deployment nonces or bytecode change, preparation must be reviewed again.', '',
    'Raw deployment calldata and its hashes are in review.json. Only after authorization:', '',
    '```sh', 'node scripts/testnet.mjs --broadcast ' + reviewHash, 'node scripts/testnet-trial.mjs --run ' + reviewHash, '```', '',
    'The trial records actual receipts separately from local fixture checks. Existing upstream proof verification is not a Drift purchase.', '',
  ];
  write('REVIEW.md', lines.join('\n'));
  console.log(JSON.stringify({ prepared: true, broadcast: false, reviewHash, review: resolve(directory, 'REVIEW.md'), balances }, null, 2));
} else {
  review = JSON.parse(readFileSync(reviewPath, 'utf8'));
  const expected = keccak256(toHex(readFileSync(reviewPath, 'utf8')));
  if (process.argv[3] !== expected) throw new Error('Supply the exact reviewed bundle hash. Nothing was broadcast.');
  if (review.authority.toLowerCase() !== accounts.operator.address.toLowerCase()) throw new Error('The operator wallet changed.');
  const receipts = {};
  for (const op of review.operations) {
    if (keccak256(op.data) !== op.calldataHash) throw new Error('Deployment calldata changed.');
    const n = networks[op.side], signedPath = resolve(directory, op.side + '-deployment.json');
    let signed = existsSync(signedPath) ? JSON.parse(readFileSync(signedPath, 'utf8')) : null;
    if (!signed) {
      const nonce = await n.client.getTransactionCount({ address: accounts.operator.address, blockTag: 'pending' });
      if (nonce !== op.nonce) throw new Error('The reviewed deployment nonce changed on ' + op.side + '. Prepare a new review.');
      const needed = BigInt(op.gas) * BigInt(op.gasPrice);
      if (await n.client.getBalance({ address: accounts.operator.address }) < needed) throw new Error('Fund the dedicated operator on ' + op.side + ' before deploying.');
      const raw = await n.wallet.signTransaction({ account: accounts.operator, chain: n.chain, data: op.data, nonce, gas: BigInt(op.gas), gasPrice: BigInt(op.gasPrice), value: 0n, type: 'legacy' });
      signed = { reviewHash: expected, raw, hash: keccak256(raw) }; write(op.side + '-deployment.json', signed);
    }
    if (signed.reviewHash !== expected) throw new Error('Saved transaction belongs to another review.');
    let receipt = await n.client.getTransactionReceipt({ hash: signed.hash }).catch(() => null);
    if (!receipt) { await n.client.sendRawTransaction({ serializedTransaction: signed.raw }); receipt = await n.client.waitForTransactionReceipt({ hash: signed.hash, timeout: 180000 }); }
    if (receipt.status !== 'success' || receipt.contractAddress?.toLowerCase() !== op.address.toLowerCase()) throw new Error('Deployment failed or its address differs from the review.');
    receipts[op.side] = { hash: receipt.transactionHash, block: String(receipt.blockNumber), address: receipt.contractAddress };
    write('deployment-receipts.json', receipts);
    console.log(JSON.stringify({ deployed: op.contract, ...receipts[op.side] }));
  }
  const config = { mode: 'testnet', authority: accounts.operator.address, writeEnabled: true, budget: review.workerBudget,
    proofUrl: 'https://proof-gen-api.cc3-testnet.creditcoin.network',
    source: { chainId: 11155111, chainKey: 1, address: receipts.source.address, startBlock: receipts.source.block, rpcUrl: chainSettings.source.rpcUrl, explorer: chainSettings.source.explorer },
    destination: { chainId: 102031, address: receipts.destination.address, startBlock: receipts.destination.block, rpcUrl: chainSettings.destination.rpcUrl, explorer: chainSettings.destination.explorer },
  };
  write('chain.json', config);
  console.log('Deployment receipts and bounded game-worker configuration saved. The purchase-to-use trial has not run yet.');
}
