import { createPublicClient, createWalletClient, custom, defineChain, formatEther, http, isAddress, parseEther, zeroAddress, type EIP1193Provider, type Hex } from "viem";
import { itemsAbi, checkoutAbi } from "./contract-abi.ts";
import { onchainTerms, type PublicChainConfig } from "./settlement.ts";
import { loadWalletSdk, type WalletConnector, type WalletSdkNetwork } from "./wallet-sdk.ts";
import type { GameState } from "./game-ui.ts";
export const WALLET_WRITES = ["mint", "install", "uninstall", "order", "reserve", "pay", "close", "discard"];

type Hooks = { state: () => GameState | null; api: (path: string, body?: unknown) => Promise<any>; refresh: () => Promise<void>; tell: (text: string, bad?: boolean) => void };
type SdkLoader = (projectId: string, networks?: readonly WalletSdkNetwork[]) => Promise<WalletConnector>;
export function walletActions(hooks: Hooks, sdkLoader: SdkLoader = loadWalletSdk) {
  let config: (PublicChainConfig & { writeEnabled: boolean }) | null = null;
  let busy = false;
  let projectId = "", provider: EIP1193Provider | null = null, providerName = "", accountName = "", chainName = "", balances = "";
  let connector: WalletConnector | null = null, unsubscribe: (() => void) | null = null;
  const disconnected = () => { accountName = ""; chainName = ""; balances = ""; };
  const network = (side: "source" | "destination") => {
    if (!config) throw new Error("Creditcoin trades are not enabled in this harbor.");
    const chain = config[side];
    return defineChain({ id: chain.chainId, name: config.mode === "local" ? "Drift local " + side : side === "source" ? "Ethereum Sepolia" : "Creditcoin Testnet",
      nativeCurrency: { name: side === "source" ? "Ether" : "Creditcoin", symbol: side === "source" ? "ETH" : "CTC", decimals: 18 }, rpcUrls: { default: { http: [chain.rpcUrl] } } });
  };
  const appKitNetworks = () => config ? (["source", "destination"] as const).map(side => network(side)) as WalletSdkNetwork[] : undefined;
  const syncConnection = () => {
    const account = connector?.account();
    provider = account?.isConnected ? connector?.provider() ?? null : null;
    if (!provider || !account?.address || !isAddress(account.address)) { disconnected(); return; }
    accountName = account.address; chainName = account.chainId === undefined ? "" : String(account.chainId); providerName = connector?.name() ?? "Wallet";
  };
  async function wallet(): Promise<WalletConnector> {
    if (connector) return connector;
    if (!projectId) throw new Error("Wallet connection is unavailable in this harbor. You can keep playing without it.");
    connector = await sdkLoader(projectId, appKitNetworks());
    unsubscribe = connector.subscribe(syncConnection); syncConnection();
    return connector;
  }
  async function openWallet(): Promise<void> {
    const current = await wallet();
    for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog[open]")) dialog.close();
    await current.open(); syncConnection();
  }
  async function connected(side: "source" | "destination", binding = false, preview = false) {
    const state = hooks.state();
    if (!state || state.practice && !preview) throw new Error("Join the shared harbor first.");
    const chain = network(side);
    syncConnection();
    if (!provider) { await openWallet(); throw new Error("Choose a wallet in the wallet window, then continue this action."); }
    const client = createWalletClient({ transport: custom(provider), chain });
    const [account] = await client.requestAddresses();
    if (!account || account === zeroAddress) throw new Error("Choose a wallet account.");
    accountName = account;
    if (!binding && account.toLowerCase() !== state.me.wallet?.toLowerCase()) throw new Error("Select the wallet linked to this merchant house.");
    try { await client.switchChain({ id: chain.id }); }
    catch (error) {
      if ((error as { code?: number }).code !== 4902 && !(error instanceof Error && error.message.includes("4902"))) throw error;
      await client.addChain({ chain }); await client.switchChain({ id: chain.id });
    }
    chainName = String(chain.id);
    return { client, account, chain };
  }
  async function run(action: string, values: Record<string, unknown> = {}): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      if (WALLET_WRITES.includes(action) && (!config?.writeEnabled || config.readOnly)) throw new Error("Chain purchases and fitting changes are paused for this harbor.");
      if (action === "choose") {
        await openWallet();
        hooks.tell(accountName ? "Wallet connected. House linking is a separate signature." : "Choose a wallet in the wallet window. House linking is a separate signature.");
        return;
      }
      if (action === "disconnect") {
        await connector?.disconnect(); unsubscribe?.(); unsubscribe = null; connector = null; provider = null; providerName = ""; disconnected(); hooks.tell("Wallet disconnected. Any existing house link stays in place."); return;
      }
      if (action === "sourceNetwork" || action === "destinationNetwork") {
        await connected(action === "sourceNetwork" ? "source" : "destination", true); hooks.tell("Wallet network selected."); return;
      }
      if (action === "balances") {
        const address = hooks.state()?.me.wallet;
        if (!address || !isAddress(address) || !config) throw new Error("Link your wallet before checking test balances.");
        balances = "Checking test balances…";
        const amounts = await Promise.all((["source", "destination"] as const).map(side => createPublicClient({ chain: network(side), transport: http(config![side].rpcUrl) }).getBalance({ address })));
        balances = Number(formatEther(amounts[0])).toFixed(6) + " Sepolia ETH · " + Number(formatEther(amounts[1])).toFixed(6) + " test CTC";
        return;
      }
      if (action === "bind") {
        const { client, account } = await connected("destination", true);
        const challenge = await hooks.api("/wallet/challenge", { address: account });
        const signature = await client.signMessage({ account, message: challenge.message });
        await hooks.api("/wallet/bind", { signature });
        hooks.tell("Wallet linked to this house.");
      } else if (["mint", "install", "uninstall"].includes(action)) {
        await hooks.api("/chain/" + action, { item: values.item });
        hooks.tell("Fitting change requested. Wait for Creditcoin confirmation.");
      } else if (action === "order") {
        await hooks.api("/chain/order", { ...values, amount: parseEther(String(values.price)).toString(), minutes: Number(values.minutes) });
      } else if (action === "refresh" || action === "discard") {
        await hooks.api("/chain/" + action, values);
      } else {
        const order = hooks.state()?.settlement?.orders.find(o => o.id === values.id);
        if (!order || !config) throw new Error("This order is unavailable.");
        const terms = onchainTerms(order.terms);
        const destination = createPublicClient({ transport: http(config.destination.rpcUrl), chain: network("destination") });
        const computed = await destination.readContract({ address: config.destination.address, abi: itemsAbi, functionName: "orderId", args: [terms] });
        if (computed !== order.id) throw new Error("The displayed terms do not match this contract order.");
        if (action === "reserve") {
          const { client, account, chain } = await connected("destination");
          if (account.toLowerCase() !== order.terms.seller.toLowerCase()) throw new Error("Only the seller’s linked wallet can reserve this fitting.");
          const signature = order.signature ?? await client.signMessage({ account, message: { raw: order.id } });
          await hooks.api("/chain/authorize", { id: order.id, signature });
          const hash = await client.writeContract({ account, chain, address: config.destination.address, abi: itemsAbi, functionName: "reserve", args: [terms, signature] });
          await hooks.api("/chain/track", { id: order.id, side: "reserve", hash });
          hooks.tell("Reservation submitted. Payment opens after the escrow is finalized.");
        } else if (action === "pay" || action === "close") {
          const block = await destination.getBlock({ blockTag: "finalized" });
          const [, status] = await destination.readContract({ address: config.destination.address, abi: itemsAbi, functionName: "order", args: [order.id], blockNumber: block.number! });
          const [owner] = await destination.readContract({ address: config.destination.address, abi: itemsAbi, functionName: "items", args: [terms.itemId], blockNumber: block.number! });
          if (status !== 1 || owner.toLowerCase() !== config.destination.address.toLowerCase()) throw new Error("The fitting’s reservation is not yet confirmed on Creditcoin. No Sepolia payment was sent.");
          const { client, account, chain } = await connected("source");
          let hash: Hex;
          if (action === "pay") {
            if (!order.signature || account.toLowerCase() !== terms.buyer.toLowerCase()) throw new Error("The buyer and signed quote must match this order.");
            hash = await client.writeContract({ account, chain, address: config.source.address, abi: checkoutAbi, functionName: "pay", args: [terms, order.signature], value: terms.amount });
          } else hash = await client.writeContract({ account, chain, address: config.source.address, abi: checkoutAbi, functionName: "closeUnpaid", args: [terms] });
          await hooks.api("/chain/track", { id: order.id, side: "source", hash });
          hooks.tell(action === "pay" ? "Payment submitted. Creditcoin must verify it before you own the fitting." : "Unpaid closure submitted. The fitting stays reserved until Creditcoin verifies the closure.");
        } else throw new Error("Unknown wallet action.");
      }
      await hooks.refresh();
    } catch (error) {
      const message = error && typeof error === "object" && "shortMessage" in error ? String(error.shortMessage) : error instanceof Error ? error.message : String(error);
      if (action === "balances") balances = "Test balances unavailable. Try again.";
      hooks.tell(message.split("\n")[0].slice(0, 220), true);
    } finally { busy = false; }
  }
  return {
    run, configure: (value: any, walletConnectProjectId: string) => { config = value?.configured ? value : null; projectId = /^[a-f0-9]{32}$/i.test(walletConnectProjectId) ? walletConnectProjectId : ""; },
    get config() { return config; }, get busy() { return busy; }, get balances() { return balances; }, get address() { return accountName; },
    get connection() { return accountName ? providerName + " · " + accountName.slice(0, 8) + "…" + accountName.slice(-6) + (chainName ? " · chain " + chainName : "") : "No wallet connected on this device."; },
  };
}
