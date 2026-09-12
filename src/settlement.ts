// Public settlement state; private transaction journals and keys remain in the service.
export type OrderTerms = {
  itemId: `0x${string}`; seller: `0x${string}`; buyer: `0x${string}`; amount: string; expires: number;
  sourceChainId: number; source: `0x${string}`; destinationChainId: number; destination: `0x${string}`; nonce: `0x${string}`;
};
export const onchainTerms = (t: OrderTerms) => ({ ...t, amount: BigInt(t.amount), expires: BigInt(t.expires), sourceChainId: BigInt(t.sourceChainId), destinationChainId: BigInt(t.destinationChainId) });
export type ChainOrder = {
  id: `0x${string}`; item: string; seller: string; buyer: string; terms: OrderTerms; signature?: `0x${string}`;
  status: "draft" | "reserved" | "paymentObserved" | "verificationPending" | "owned" | "cancelled";
  sourceTx?: `0x${string}`; reserveTx?: `0x${string}`; settleTx?: `0x${string}`; error?: string;
  sourcePaid?: boolean;
};
export type Settlement = {
  mode: "local" | "testnet"; lastSync: number; block: string; error?: string; orders: ChainOrder[];
};
export type PublicChainConfig = {
  mode: "local" | "testnet"; authority: `0x${string}`;
  readOnly?: boolean;
  source: { chainId: number; address: `0x${string}`; rpcUrl: string; explorer: string };
  destination: { chainId: number; address: `0x${string}`; rpcUrl: string; explorer: string };
};
