# Deployment

The complete app is one Node.js process serving the built frontend, HTTP API, and server-sent events. SQLite and account material live in a persistent volume. The provided Compose configuration targets `https://drift.timidan.xyz` behind an existing Caddy proxy on the external Docker network `public_proxy`.

## Build and start

Deploy a reviewed commit from `main`. Build before replacing a running release:

```sh
git status --short --branch
git pull --ff-only origin main
export DRIFT_RELEASE="$(git rev-parse --short=12 HEAD)"
docker compose build
docker compose up -d --no-build
docker compose ps
```

There are no published application ports. The container runs as the `node` user, with a read-only root filesystem, bounded resources, and the `drift_republics_data` volume mounted at `/app/data`. A fresh volume initializes a new world; existing local accounts and testnet journals are not uploaded.

## Proxy and DNS

Provision the DNS record and TLS through the host's approved configuration. Add only this hostname's route to the existing proxy:

```caddyfile
drift.timidan.xyz {
    import cloudflare_only
    encode zstd gzip
    reverse_proxy drift-republics:4187 {
        header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
        flush_interval -1
    }
}
```

The host's existing `cloudflare_only` snippet restricts origin access to Cloudflare and supplies its existing origin certificate. Only with that restriction in place does this route use [Cloudflare's verified visitor header](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip). Do not use this header on an unrestricted origin. Validate the complete Caddy configuration before reloading it.

`DRIFT_TRUST_PROXY=1` requires the private app port and the header replacement above. Forwarding an arbitrary incoming header would allow clients to bypass request limits.

## Verify

```sh
docker compose exec -T drift-republics node -e "fetch('http://127.0.0.1:4187/api/health').then(async r=>{if(!r.ok)process.exit(1);console.log(await r.text())}).catch(()=>process.exit(1))"
curl --fail https://drift.timidan.xyz/api/health
```

Open the public landing page, enter practice, complete the first delivery, and reload to check persistence. Confirm the session cookie is Secure and HttpOnly and that game events stream through the proxy. A healthy process alone does not verify those flows.

The initial configuration permits practice and invitation-only shared play. Chain writes are explicitly disabled. Wallet operator keys, chain configuration, transaction journals, and invitations are private runtime material; keep them out of Git and image build contexts.

## Enable testnet settlement

Place the reviewed `chain.json` and its matching `operator.key` in the existing data volume, owned by the container's `node` user with mode `0600`. Retain the world's data and transaction journal. Verify both RPC chain IDs, the deployed contract authority, and the remaining operator fee budget before activation.

When reusing contracts for a fresh world, assign a unique `tokenNamespace` in `chain.json`. Item and ship IDs are sequential within each world; the namespace prevents reusing another world's chain tokens and equipment slots. Once the chain service has initialized, preserve that namespace with the data volume. Existing deployments without a namespace retain their original IDs.

Set `DRIFT_CHAIN_READ_ONLY=0` in the private deployment environment and recreate only `drift-republics` with the reviewed image. The default remains `1`. Writes also require `writeEnabled: true`, a matching operator key, and an explicit transaction/fee budget in `chain.json`. Verify `/api/config` reports `configured: true`, `readOnly: false`, and `writeEnabled: true`; then verify finalized synchronization separately. These flags alone do not prove a successful wallet purchase.

To pause new operator transactions, set `DRIFT_CHAIN_READ_ONLY=1` and recreate the container. Preserve signed jobs: changing the flag cannot cancel transactions already broadcast. Transactions are available to linked wallets in shared play; practice remains isolated.

## Persistence and rollback

Keep the volume across all releases. Before an update that changes stored data, stop only this app and take a consistent backup of its data volume. Never copy a live SQLite database without its transaction state.

To roll back application code, keep the previous image and start it with the same volume:

```sh
DRIFT_RELEASE=PREVIOUS_COMMIT docker compose up -d --no-build
```

This initial release has no predecessor. Before public cutover, rollback means stopping its staged container while leaving other services and the staged files intact. A later DNS/proxy rollback must restore the exact prior record and route configuration. Do not remove the data volume.
