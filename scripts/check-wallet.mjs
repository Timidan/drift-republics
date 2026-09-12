// AppKit boundary fixture; no browser wallet, relay, signature prompt, or public-chain transaction.
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import { walletActions } from '../src/wallet-actions.ts';

globalThis.document = { querySelectorAll: () => [] };
const account = privateKeyToAccount('0x' + '11'.repeat(32)), calls = [];
const provider = { request: async ({ method, params }) => {
  calls.push(method);
  if (method === 'eth_requestAccounts') return [account.address];
  if (method === 'wallet_switchEthereumChain') return null;
  if (method === 'personal_sign') return account.signMessage({ message: { raw: params[0] } });
  throw new Error('Unexpected fixture request: ' + method);
} };
let notify = () => {}, opened = 0, loaded = [], connected = false;
const connector = {
  open: async () => { opened++; notify(); }, disconnect: async () => { connected = false; notify(); },
  provider: () => connected ? provider : null, account: () => connected ? { address: account.address, chainId: 102031, isConnected: true } : { isConnected: false },
  name: () => 'AppKit fixture', subscribe: fn => { notify = fn; return () => { notify = () => {}; }; },
};
let state = { practice: false, me: { id: 'house', wallet: null } }, refreshed = false, notice = '';
const wallet = walletActions({
  state: () => state, tell: message => { notice = message; }, refresh: async () => { refreshed = true; },
  api: async (path, input) => {
    if (path === '/wallet/challenge') { assert.equal(input.address, account.address); return { message: 'Bind the local fixture house; no payment.' }; }
    assert.equal(path, '/wallet/bind');
    assert.ok(await verifyMessage({ address: account.address, message: 'Bind the local fixture house; no payment.', signature: input.signature }));
    state.me.wallet = account.address; return { ok: true };
  },
}, async (projectId, networks) => { loaded.push({ projectId, networks }); return connector; });
wallet.configure({ configured: false }, '4ef92de0a4db844630626a0a9238350b');
connected = true;
await wallet.run('choose');
assert.equal(opened, 1); assert.equal(loaded[0].projectId.length, 32); assert.equal(loaded[0].networks, undefined, 'connection works before settlement contracts are configured');
assert.match(wallet.connection, /AppKit fixture/); assert.equal(calls.length, 0, 'connecting does not request a signature or transaction');
const config = { configured: true, mode: 'local', writeEnabled: true, authority: account.address,
  source: { chainId: 31337, address: account.address, rpcUrl: 'http://127.0.0.1:1', explorer: '' },
  destination: { chainId: 31338, address: account.address, rpcUrl: 'http://127.0.0.1:2', explorer: '' } };
wallet.configure(config, '4ef92de0a4db844630626a0a9238350b');
await wallet.run('bind');
assert.equal(state.me.wallet, account.address); assert.ok(refreshed); assert.ok(calls.includes('personal_sign'));
state.practice = true; calls.length = 0;
await wallet.run('bind');
assert.match(notice, /Join the shared harbor/); assert.equal(calls.length, 0);
state.practice = false;
wallet.configure({ ...config, readOnly: true, writeEnabled: false }, '4ef92de0a4db844630626a0a9238350b');
await wallet.run('pay', { id: 'unsubmitted-order' });
assert.match(notice, /paused/); assert.equal(calls.length, 0, 'viewing mode stops before a wallet request');
await wallet.run('disconnect'); calls.length = 0;
await wallet.run('bind');
assert.equal(wallet.address, ''); assert.match(notice, /Choose a wallet/); assert.equal(calls.length, 0, 'a disconnected AppKit account cannot reuse a stale provider');
console.log('wallet checks passed: AppKit connection is separate from binding, signatures, and readonly transaction guards. FIXTURE ONLY.');
