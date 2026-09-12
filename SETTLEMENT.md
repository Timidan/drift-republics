# Earned item settlement

The source checkout receives native Sepolia test ETH. The Creditcoin contract owns the item escrow. No tokens or payment are bridged, and the two chains are not atomic.

## What each component proves

The game service validates workshop inputs, production completion, docking, ship ownership and capacity. Its operator authorizes minting and installation. Creditcoin enforces finite item IDs, recorded ownership, exclusive equipment slots, one-time livery consumption and escrow transitions. This trusts the game authority for production and installation correctness; chain verification does not make those offchain rules trustless.

Attestcoin's native verifier at `0x0000000000000000000000000000000000000FD2` verifies source transaction bytes against the configured source-chain key and attested block. The contract then decodes the successful receipt with the official EVM V1 decoder and requires an exact checkout emitter, event signature and order ID. An HTTP proof response or observed source receipt alone cannot assign ownership.

The first supported environment is Sepolia (`11155111`, source chain key `1`) → Creditcoin testnet (`102031`). Only the pure decoder and verifier interface from `@gluwa/asc-contracts` are used; no writability service, bridge, indexer account or full SDK is necessary.

## Paid path

1. The game consumes the recipe and creates one owned fitting with its maker and finish. Publication mints its deterministic finite ID once. Existing free preview colors cannot mint it.
2. The seller signs an order binding item, seller, buyer, native source amount, expiry, both chain IDs and contract addresses, and nonce. Both contracts derive the same domain-separated order ID.
3. The seller submits `reserve`; Creditcoin moves the existing uninstalled item into escrow. Installed or consumed items cannot be reserved.
4. The wallet client reads **finalized** Creditcoin reservation and escrow ownership before exposing the source payment. The source contract checks buyer, exact value, domain, signature and deadline, records `Paid`, then transfers ETH to the seller. A rejected transfer reverts the transaction.
5. The worker observes the source receipt, waits for source finality, obtains the documented proof and submits `settle`. Native proof acceptance plus an exact `OrderPaid` event transfers the reserved item once to the bound buyer.
6. Finalized destination reads update the game. Installation at the item's harbor is a separate game-authorized Creditcoin transaction; its confirmed slot changes boat appearance and usable capacity.

The source cannot itself query destination escrow. A buyer bypassing the provided finalized-escrow check can pay a signed order that was never reserved. Use the supplied client or perform that check independently. The contracts are a pilot and have not received an independent security audit.

## Expiry and unpaid recovery

Expiry stops new source payments. It **never** releases destination escrow on its own. A paid transaction can be proved after expiry, including after a worker outage. There is no administrative escrow escape hatch that can hand a paid item back to its seller.

After expiry, anyone may call `closeUnpaid(terms)` on the source, but only an order whose source state remains open can become `ClosedUnpaid`. This terminal state cannot later be paid. A verified `OrderClosedUnpaid` event returns the item to the seller on Creditcoin. Payment and closure are mutually exclusive source transitions. Duplicate destination settlement reverts.

If the proof service or source attestation is unavailable, the item remains reserved. The system retries and displays that state; it does not claim a timed refund or guaranteed eventual liveness. Because the seller already receives a successful payment, there is no automatic source refund for an attestation outage. This is the recoverable reservation protocol's availability tradeoff.

Unsigned proof simulations may be refreshed and retried. If a signed settlement transaction reverts, the worker preserves its bytes and stops that order for review; it does not automatically spend gas on a replacement.

## Worker recovery

The worker persists exact signed bytes and their hash before broadcast. Retries and restarts submit those same bytes. Finalized destination receipts settle jobs; deterministic contract rejection unlocks a pending fitting action. Network/funding failures stay pending with the saved journal.

Each open order has a persisted, bounded source event cursor. A transaction hash lost by the browser can be recovered by scanning finalized source logs. Mint metadata is checked against the original game record. Game account binding requires a short-lived, single-use EIP-191 wallet challenge; a wallet belongs to one house.

Testnet deployment and trial scripts also journal their signed transactions and enforce reviewed transaction and fee ceilings. Runtime configuration, credentials, and signed bytes remain in the private data directory. Never replace that directory to get a failed payment through again.

## Runtime availability

The provided deployment starts with chain writes disabled and no operator key or chain configuration. Ordinary gameplay remains available. A separate configured testnet environment is required for wallet binding and settlement.

Installed-wallet discovery, WalletConnect pairing, and transaction controls are implemented. A complete purchase through a real browser wallet remains unverified. Local contract and worker checks use an explicitly labelled verifier fixture; they do not prove native Attestcoin verification.

Primary documentation inspected September 9, 2026: [readability flow](https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure/dapp-design-patterns-readability), [environments](https://docs.attestcoin.org/attestcoin-protocol/attestcoin-protocol-chains-environments), and the [testnet proof API](https://proof-gen-api.cc3-testnet.creditcoin.network/).
