<p align="center">
  <img src="https://drift.timidan.xyz/assets/drift/chains/drift-wallet.svg" width="88" height="88" alt="Drift Republics sailing boat logo">
</p>
<h1 align="center">Drift Republics</h1>
<p align="center"><strong>Build a merchant house. Sail the trade routes. Keep the republics afloat.</strong></p>
<p align="center">A browser game about making goods, moving cargo, and building an economy together.</p>
<p align="center"><a href="https://drift.timidan.xyz">Play online</a> · <a href="#play">Gameplay</a> · <a href="#run-locally">Run locally</a> · <a href="SETTLEMENT.md">Creditcoin integration</a> · <a href="DEPLOYMENT.md">Deployment</a></p>

Three floating cities depend on one another. Reedhaven refines fuel, Ironwake works metal, and Bastion builds ships. Start with a small boat and a workshop, find a buyer, and turn a successful delivery into your next upgrade. When Bastion relocates, the trade routes change with it.

Drift Republics runs in a WebGL2-capable browser. Production, inventory, trade, voyages, and shared progress are managed by one authoritative Node.js server and persisted in SQLite. You can try the game without an account or wallet.

## Play

- **Make and sell goods.** Gather materials, run workshop recipes, sell lots, and negotiate prices with other houses.
- **Carry funded orders.** Reserve supplies, agree a delivery fee, load and secure cargo, then choose a route. Arrival completes the delivery and distributes payment.
- **Build your fleet.** Craft fittings, commission cutters, lighters, and barges, and install equipment that changes a boat's capacity and handling.
- **Work with the republics.** Supply civic projects, elect a steward, and contribute the fuel needed to move Bastion to a new anchorage.
- **Explore the Outer Reaches.** Manage wind, hull wear, repairs, and cargo while visiting resource sites and frontier outposts.

New visitors enter an isolated practice harbor. The first job teaches you to reserve four timber, load it, secure the cargo, and sail to the harbor office. Shared play uses invitations and persistent merchant houses.

## Creditcoin integration

An optional testnet market gives crafted ship fittings onchain ownership. The seller reserves an existing item on Creditcoin for a named buyer. The buyer pays native Sepolia test ETH; an Attestcoin proof of the successful source event allows the Creditcoin contract to transfer the item. The buyer can then install it and use its actual capacity in the game.

| Component | Responsibility |
|---|---|
| Game server | Production, Marks, voyages, accounts, and validation of earned items |
| Sepolia checkout | Exact payment, buyer authorization, and mutually exclusive paid/unpaid outcomes |
| Creditcoin inventory | Item ownership, escrow, and equipment slots |
| Attestcoin native verifier | Verification of the source transaction and receipt before settlement |

Marks remain in-game accounting units. No token or payment is bridged. The game authority remains trusted for production and installation rules. See [the settlement protocol](SETTLEMENT.md) for the paid path, delayed proofs, unpaid recovery, and trust boundaries.

The deployment configuration in this repository starts a fresh game world with chain writes disabled. It does not include operator keys, saved accounts, or a chain configuration. Installed-wallet discovery and WalletConnect pairing are implemented; a complete purchase through a real browser wallet remains unverified. The contracts target testnets and have not received an independent security audit.

## Run locally

Requirements: Node.js **22.18 or newer**, npm, and a browser with WebGL2. The Docker build uses Node.js 22.23.1.

```sh
npm ci
npm run dev
```

Open [localhost:4186](http://127.0.0.1:4186). The development command starts Vite on port 4186 and the game API on port 4187.

To serve the complete production build locally:

```sh
npm run build
npm start
```

Open [localhost:4187](http://127.0.0.1:4187). `npm run preview` serves the frontend alone; use `npm start` for gameplay and persistence.

### Shared play

The server creates a private invitation in `data/invite-code.txt`. Share it only with intended participants. A house receives a starter boat, workshop, materials, and 600 test Marks once. Passwords must contain at least 12 characters; keep the one-time recovery code provided at registration.

The pilot supports 12 invited houses, with limited workshop berths per city. Practice worlds are separate from the shared economy. Preserve the entire private data directory across releases.

### Configuration

| Variable | Default / purpose |
|---|---|
| `DRIFT_DATA_DIR` | `data/`; persistent SQLite world and optional chain configuration |
| `DRIFT_HOST` | `127.0.0.1`; public binding requires an explicit HTTPS origin |
| `DRIFT_API_PORT` | `4187` |
| `DRIFT_ORIGIN` | Exact permitted browser origin; use the public HTTPS URL behind a proxy |
| `DRIFT_INVITE` | Optional invitation override; otherwise generated privately |
| `DRIFT_TRUST_PROXY` | Disabled by default; `1` accepts a single IP in `X-Forwarded-For` from a trusted proxy |
| `DRIFT_CHAIN_READ_ONLY` | `1` disables chain writes and skips loading the operator key |
| `DRIFT_WALLETCONNECT_PROJECT_ID` | Public WalletConnect project ID; an empty value disables QR pairing |
| `DRIFT_SOURCE_RPC`, `DRIFT_CTC_RPC` | Optional RPC overrides, checked against the configured chains |

Enable proxy trust only when the application port is private and the proxy replaces `X-Forwarded-For` with the verified client IP. [Deployment instructions](DEPLOYMENT.md) include that configuration.

## Development checks

```sh
npm run check
npm run build
```

The existing checks cover the economy lifecycle, persistence, recovery, sailing, community projects, frontier progression, original geometry, and wallet-provider behavior. They use controlled local accounts and fixtures.

Contract development additionally requires [Foundry](https://getfoundry.sh/):

```sh
npm run contracts
npm run check:contracts
node scripts/check-chain.mjs
```

The chain check starts two temporary Anvil chains and exercises the production worker. Its native verifier is a labelled local fixture. It does not demonstrate real Attestcoin verification or browser-wallet signing. Set `ANVIL_BIN` if Anvil is outside your PATH.

## Project layout

| Path | Contents |
|---|---|
| `src/economy.ts` | Recipes, inventory, trading, voyages, and city decisions |
| `src/game-ui.ts`, `src/guides.ts` | Game panels and contextual tutorials |
| `src/main.ts`, `src/drift-art.ts` | Babylon.js world, boats, harbors, and scenery |
| `src/wallet-actions.ts`, `src/wallet-sdk.ts` | Wallet connection and transaction controls |
| `server/` | HTTP API, sessions, SQLite persistence, and settlement worker |
| `contracts/`, `contract-test/` | Checkout, inventory, order identity, and contract checks |
| `public/assets/` | Game assets and their attribution/license notices |
| `scripts/` | Development, validation, and bounded testnet tooling |

## Scope and credits

This is a single-process pilot. Real-device performance, long-term economic balance, and independent human playtesting remain unverified. Ordinary gameplay requires neither a wallet nor a chain service.

Boats, harbors, islands, and scenery use original authored geometry. Sound includes an original synthesized harbor score. Fonts, materials, interface icons, and network marks retain their respective notices in [ASSETS.md](ASSETS.md). The sailboat logo is adapted from **Sailboat** by Delapouite, [Game-icons.net](https://game-icons.net/1x1/delapouite/sailboat.html), under CC BY 3.0.
