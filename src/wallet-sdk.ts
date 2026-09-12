import type { EIP1193Provider } from "viem";
import type { AppKitNetwork } from "@reown/appkit/networks";

export type WalletSdkNetwork = AppKitNetwork;

export type WalletConnector = {
  open: () => Promise<void>;
  disconnect: () => Promise<void>;
  provider: () => EIP1193Provider | null;
  account: () => { address?: string; chainId?: string | number; isConnected?: boolean } | undefined;
  name: () => string;
  subscribe: (sync: () => void) => () => void;
};

export async function loadWalletSdk(projectId: string, networks?: readonly AppKitNetwork[]): Promise<WalletConnector> {
  const [{ createAppKit }, { EthersAdapter }, chains] = await Promise.all([
    import("@reown/appkit"), import("@reown/appkit-adapter-ethers"), import("viem/chains"),
  ]);
  const appKit = createAppKit({
    adapters: [new EthersAdapter()],
    networks: (networks?.length ? networks : [chains.sepolia, chains.creditCoin3Testnet]) as [AppKitNetwork, ...AppKitNetwork[]],
    metadata: { name: "Drift Republics", description: "Trade earned ship fittings between merchant houses.", url: location.origin, icons: [location.origin + "/assets/drift/chains/drift-wallet.svg"] },
    projectId, themeMode: "dark",
    themeVariables: { "--w3m-font-family": "'Atkinson Hyperlegible Next', sans-serif", "--w3m-accent": "#efc580", "--w3m-color-mix": "#142e39", "--w3m-color-mix-strength": 35, "--w3m-border-radius-master": "2px", "--w3m-z-index": 10000 },
    features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, history: false },
  });
  await appKit.ready();
  const provider = () => {
    const modern = appKit as typeof appKit & { getProviders?: () => Record<string, unknown> };
    return (modern.getProviders?.()["eip155"] ?? appKit.getWalletProvider()) as EIP1193Provider | null;
  };
  const sync = (callback: () => void) => {
    const offAccount = appKit.subscribeAccount(callback, "eip155");
    const offProviders = appKit.subscribeProviders(callback);
    const offState = appKit.subscribeState(callback);
    return () => { offAccount(); offProviders(); offState(); };
  };
  return {
    open: async () => { await appKit.open(); }, disconnect: () => appKit.disconnect("eip155"), provider,
    account: () => ({ ...appKit.getAccount("eip155"), chainId: appKit.getChainId() }), name: () => appKit.getWalletInfo("eip155")?.name ?? "Wallet",
    subscribe: sync,
  };
}
