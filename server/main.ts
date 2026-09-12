import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { isIP } from "node:net";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  addPlayer, advanceWorld, command, createWorld, GameError, PORT_IDS, publicWorld, voyageQuote, workshopLimit,
  type PortId, type RouteKind, type WorkshopKind, type World,
} from "../src/economy.ts";
import { createChainService } from "./chain.ts";

const scrypt = promisify(scryptCallback);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
type Session = { hash: string; player: string; world: string; expires: number };
type Options = { dataDir?: string; invite?: string; origin?: string; now?: () => number; maxPlayers?: number; tick?: boolean };

export function createGameServer(options: Options = {}) {
  const dataDir = resolve(options.dataDir ?? process.env.DRIFT_DATA_DIR ?? resolve(ROOT, "data"));
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const databasePath = resolve(dataDir, "drift.sqlite");
  const db = new DatabaseSync(databasePath);
  chmodSync(databasePath, 0o600);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS worlds (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER);" +
    "CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created INTEGER NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS account_recovery (player TEXT PRIMARY KEY REFERENCES accounts(id), hash TEXT NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, player TEXT NOT NULL, world TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE, expires INTEGER NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS commands (world TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE, player TEXT NOT NULL, key TEXT NOT NULL, body_hash TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(world, player, key));"
  );
  const now = options.now ?? Date.now;
  const shared = db.prepare("SELECT id FROM worlds WHERE id='shared'").get();
  if (!shared) db.prepare("INSERT INTO worlds (id,data) VALUES (?,?)").run("shared", JSON.stringify(createWorld(now())));
  const invitePath = resolve(dataDir, "invite-code.txt");
  let invite = options.invite ?? process.env.DRIFT_INVITE;
  if (!invite) {
    if (!existsSync(invitePath)) writeFileSync(invitePath, randomBytes(12).toString("hex") + "\n", { mode: 0o600 });
    invite = readFileSync(invitePath, "utf8").trim();
  }
  if (!invite || invite.length < 12) throw new Error("DRIFT_INVITE must have at least 12 characters.");
  const expectedInvite = sha(invite);
  const configuredOrigin = options.origin ?? process.env.DRIFT_ORIGIN;
  const allowedOrigins = new Set(configuredOrigin ? [new URL(configuredOrigin).origin] : [
    "http://127.0.0.1:4186", "http://localhost:4186", "http://127.0.0.1:4187",
  ]);
  const secureCookie = configuredOrigin?.startsWith("https://") ?? false;
  const maximumPlayers = options.maxPlayers ?? 12;
  const trustProxy = process.env.DRIFT_TRUST_PROXY === "1";
  const clients = new Set<{ session: Session; response: ServerResponse }>();
  const limits = new Map<string, { count: number; until: number }>();

  function readWorld(worldId: string): World {
    const row = db.prepare("SELECT data FROM worlds WHERE id=?").get(worldId) as { data: string } | undefined;
    if (!row) throw new GameError("This practice session has expired. Start a new practice harbor.", 401);
    return JSON.parse(row.data) as World;
  }
  // ponytail: one process owns this pilot world; split simulation workers only after measuring its capacity.
  // All mutations read and commit inside the SQLite transaction; thrown actions cannot partially spend stock or money.
  function transact<T>(worldId: string, operation: (world: World) => T): { world: World; result: T } {
    db.exec("BEGIN IMMEDIATE");
    try {
      const world = readWorld(worldId);
      advanceWorld(world, now());
      const result = operation(world);
      db.prepare("UPDATE worlds SET data=? WHERE id=?").run(JSON.stringify(world), worldId);
      db.exec("COMMIT");
      return { world, result };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  // Preserve pending order deadlines across a service interruption before normal ticking resumes.
  for (const row of db.prepare("SELECT id,data FROM worlds").all() as { id: string; data: string }[]) {
    const world = JSON.parse(row.data) as World;
    advanceWorld(world, now(), true);
    db.prepare("UPDATE worlds SET data=? WHERE id=?").run(JSON.stringify(world), row.id);
  }
  function session(req: IncomingMessage): Session {
    const token = req.headers.cookie?.split(";").map(v => v.trim()).find(v => v.startsWith("drift_session="))?.slice(14);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new GameError("Sign in or start a practice session.", 401);
    const result = db.prepare("SELECT * FROM sessions WHERE hash=? AND expires>?").get(sha(token), now()) as Session | undefined;
    if (!result) throw new GameError("Your session expired. Sign in again.", 401);
    return result;
  }
  function issueSession(res: ServerResponse, player: string, world: string): void {
    const token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions VALUES (?,?,?,?)").run(sha(token), player, world, now() + 24 * 60 * 60_000);
    res.setHeader("Set-Cookie", "drift_session=" + token + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400" + (secureCookie ? "; Secure" : ""));
  }
  function recoveryCode(player: string): string {
    const code = randomBytes(24).toString("hex");
    db.prepare("INSERT INTO account_recovery VALUES (?,?) ON CONFLICT(player) DO UPDATE SET hash=excluded.hash").run(player, sha(code));
    return code.match(/.{8}/g)!.join("-");
  }
  function revokeSessions(player: string): void {
    db.prepare("DELETE FROM sessions WHERE player=?").run(player);
    for (const client of clients) if (client.session.player === player) { client.response.end(); clients.delete(client); }
  }
  function json(res: ServerResponse, status: number, value: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(JSON.stringify(value));
  }
  function rate(req: IncomingMessage, group: string, limit: number, milliseconds: number): void {
    // Enable only behind a proxy that replaces this header; the app port must stay private.
    const forwarded = trustProxy ? req.headers["x-forwarded-for"] : undefined;
    const address = typeof forwarded === "string" && isIP(forwarded.trim()) ? forwarded.trim() : req.socket.remoteAddress ?? "local";
    const key = address + ":" + group;
    const t = now();
    const value = limits.get(key);
    if (!value || value.until <= t) limits.set(key, { count: 1, until: t + milliseconds });
    else {
      value.count++;
      if (value.count > limit) throw new GameError("Too many requests. Wait a moment before trying again.", 429);
    }
    if (limits.size > 1000) for (const [k, v] of limits) if (v.until <= t) limits.delete(k);
  }
  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    if (!req.headers["content-type"]?.startsWith("application/json")) throw new GameError("The request format is unreadable. Reload the game and try again.", 415);
    let bytes = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) {
      const buffer = Buffer.from(chunk); bytes += buffer.length;
      if (bytes > 8192) throw new GameError("This request is too large.", 413);
      chunks.push(buffer);
    }
    let value: unknown;
    try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new GameError("The request could not be read. Reload the game and try again."); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new GameError("The request is incomplete. Reload the game and try again.");
    return value as Record<string, unknown>;
  }
  function checkOrigin(req: IncomingMessage): void {
    const origin = req.headers.origin;
    if (!origin || !allowedOrigins.has(origin)) throw new GameError("This request came from an unrecognized origin.", 403);
  }
  function stateFor(s: Session): ReturnType<typeof publicWorld> {
    return publicWorld(transact(s.world, () => undefined).world, s.player);
  }
  const chain = createChainService(db, dataDir, operation => transact("shared", operation), () => readWorld("shared"), now);
  const chainTimer = chain && options.tick !== false ? setInterval(() => { void chain.step(); }, chain.config.mode === "local" ? 1000 : 15000) : null;
  chainTimer?.unref();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://drift.local");
      const path = url.pathname;
      res.setHeader("Referrer-Policy", "same-origin");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (path.startsWith("/api/")) {
        rate(req, "api", 600, 60_000);
        if (req.method === "GET" && path === "/api/health") return json(res, 200, { ok: true });
        if (req.method === "GET" && path === "/api/config") {
          let sessionActive = false;
          try { session(req); sessionActive = true; } catch {}
          return json(res, 200, {
          sessionActive,
          practiceAvailable: true, inviteRequired: true, maxPlayers: maximumPlayers,
          players: (db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n,
          walletConnectProjectId: process.env.DRIFT_WALLETCONNECT_PROJECT_ID ?? "4ef92de0a4db844630626a0a9238350b",
          settlement: chain ? { configured: true, ...chain.config } : { configured: false, mode: "unconfigured" },
          });
        }
        if (req.method === "POST") checkOrigin(req);
        if (req.method === "POST" && path === "/api/practice") {
          rate(req, "practice", 10, 60 * 60_000);
          await body(req);
          const worldId = "practice-" + randomUUID(), playerId = randomUUID();
          const world = createWorld(now(), true);
          addPlayer(world, playerId, "Visitor", "reedhaven", "refinery", now());
          const office = addPlayer(world, "harbor-office", "Practice harbor office", "bastion", "shipyard", now());
          office.npc = true;
          office.marks = 480;
          office.warehouse.bastion.timber = 0;
          world.deliveries.push({
            id: "practice-timber", buyer: office.id, supplier: null, carrier: null, ship: null, from: null,
            to: "bastion", berth: 0, good: "timber", quantity: 4, price: 120, fee: 0,
            deadline: now() + 60 * 60_000, status: "open", note: "Practice job: deliver 4 timber for the harbor office’s cargo rig.", offers: [],
          });
          db.prepare("INSERT INTO worlds VALUES (?,?,?)").run(worldId, JSON.stringify(world), now() + 24 * 60 * 60_000);
          issueSession(res, playerId, worldId); return json(res, 201, publicWorld(world, playerId));
        }
        if (req.method === "POST" && path === "/api/account/recover") {
          rate(req, "auth", 30, 15 * 60_000);
          const input = await body(req);
          if (typeof input.name !== "string" || input.name.length > 24 || typeof input.code !== "string" || input.code.length > 80 ||
              typeof input.password !== "string" || input.password.length < 12 || input.password.length > 128) throw new GameError("Enter your house name, recovery code and a new password of 12–128 characters.");
          const code = input.code.replace(/[\s-]/g, "").toLowerCase();
          const account = db.prepare("SELECT a.id,r.hash FROM accounts a JOIN account_recovery r ON r.player=a.id WHERE a.name=?").get(input.name.trim()) as { id: string; hash: string } | undefined;
          if (!/^[a-f0-9]{48}$/.test(code) || !timingSafeEqual(Buffer.from(sha(code)), Buffer.from(account?.hash ?? "0".repeat(64))) || !account) throw new GameError("The house name or recovery code is incorrect.", 401);
          const salt = randomBytes(16).toString("hex"), hash = (await scrypt(input.password, salt, 64) as Buffer).toString("hex");
          const result = transact("shared", world => {
            // Consume inside the transaction: two simultaneous recoveries cannot reuse the same code.
            if (!db.prepare("DELETE FROM account_recovery WHERE player=? AND hash=?").run(account.id, account.hash).changes) throw new GameError("This recovery code has already been replaced.", 401);
            db.prepare("UPDATE accounts SET password_hash=?,salt=? WHERE id=?").run(hash, salt, account.id);
            db.prepare("DELETE FROM sessions WHERE player=?").run(account.id);
            return { ...publicWorld(world, account.id), recoveryCode: recoveryCode(account.id) };
          });
          revokeSessions(account.id); issueSession(res, account.id, "shared");
          return json(res, 200, result.result);
        }
        if (req.method === "POST" && (path === "/api/register" || path === "/api/login")) {
          rate(req, "auth", 30, 15 * 60_000);
          const input = await body(req);
          if (typeof input.name !== "string" || !/^[a-z0-9][a-z0-9 _-]{2,23}$/i.test(input.name.trim()) ||
              typeof input.password !== "string" || input.password.length < 12 || input.password.length > 128) {
            throw new GameError("Use a 3–24 character house name and a password of 12–128 characters.");
          }
          const name = input.name.trim();
          const existing = db.prepare("SELECT * FROM accounts WHERE name=?").get(name) as
            { id: string; password_hash: string; salt: string } | undefined;
          if (path === "/api/login") {
            // Run scrypt even for an absent account so account lookup does not skip password verification work.
            const hash = await scrypt(input.password, existing?.salt ?? "unavailable-house", 64) as Buffer;
            const expected = existing ? Buffer.from(existing.password_hash, "hex") : Buffer.alloc(64);
            if (!existing || !timingSafeEqual(hash, expected)) throw new GameError("Incorrect house name or password.", 401);
            const current = db.prepare("SELECT password_hash FROM accounts WHERE id=?").get(existing.id) as { password_hash: string };
            if (current.password_hash !== existing.password_hash) throw new GameError("Your password changed. Sign in again.", 401);
            issueSession(res, existing.id, "shared");
            return json(res, 200, publicWorld(transact("shared", () => undefined).world, existing.id));
          }
          if (existing) throw new GameError("This house name is already taken. Choose another name.", 409);
          const suppliedInvite = typeof input.invite === "string" ? input.invite.trim() : "";
          if (!timingSafeEqual(Buffer.from(sha(suppliedInvite)), Buffer.from(expectedInvite))) throw new GameError("An invitation is required for this shared harbor.", 403);
          if ((db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n >= maximumPlayers) throw new GameError("This harbor has reached its house limit. You can still play in practice.", 409);
          if (!PORT_IDS.includes(input.home as PortId) || !["refinery", "foundry", "shipyard"].includes(String(input.workshop))) throw new GameError("Choose a home city and workshop.");
          const salt = randomBytes(16).toString("hex");
          const hash = (await scrypt(input.password, salt, 64) as Buffer).toString("hex");
          const playerId = randomUUID();
          const result = transact("shared", world => {
            if ((db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n >= maximumPlayers) throw new GameError("This harbor has reached its house limit. You can still play in practice.", 409);
            if (world.workshops.filter(v => v.port === input.home).length >= workshopLimit(world, input.home as PortId)) throw new GameError("This city has no room for another workshop. Choose another home city.");
            db.prepare("INSERT INTO accounts VALUES (?,?,?,?,?)").run(playerId, name, hash, salt, now());
            addPlayer(world, playerId, name, input.home as PortId, input.workshop as WorkshopKind, now());
            return recoveryCode(playerId);
          });
          issueSession(res, playerId, "shared"); return json(res, 201, { ...publicWorld(result.world, playerId), recoveryCode: result.result });
        }
        const s = session(req);
        if (req.method === "POST" && ["/api/account/password", "/api/account/recovery"].includes(path)) {
          if (s.world !== "shared") throw new GameError("Sign in to your merchant house first.", 401);
          rate(req, "auth", 30, 15 * 60_000);
          const input = await body(req);
          if (typeof input.password !== "string" || input.password.length < 12 || input.password.length > 128) throw new GameError("Enter your current password.");
          const account = db.prepare("SELECT password_hash,salt FROM accounts WHERE id=?").get(s.player) as { password_hash: string; salt: string };
          const supplied = await scrypt(input.password, account.salt, 64) as Buffer;
          if (!timingSafeEqual(supplied, Buffer.from(account.password_hash, "hex"))) throw new GameError("Incorrect current password.", 401);
          const changing = path.endsWith("/password");
          if (changing && (typeof input.nextPassword !== "string" || input.nextPassword.length < 12 || input.nextPassword.length > 128)) throw new GameError("Use a new password of 12–128 characters.");
          const salt = randomBytes(16).toString("hex");
          const hash = changing ? (await scrypt(input.nextPassword as string, salt, 64) as Buffer).toString("hex") : "";
          const result = transact("shared", () => {
            const current = db.prepare("SELECT password_hash FROM accounts WHERE id=?").get(s.player) as { password_hash: string };
            if (current.password_hash !== account.password_hash || !db.prepare("SELECT hash FROM sessions WHERE hash=?").get(s.hash)) throw new GameError("Your sign-in changed. Sign in again.", 401);
            if (changing) {
              db.prepare("UPDATE accounts SET password_hash=?,salt=? WHERE id=?").run(hash, salt, s.player);
              db.prepare("DELETE FROM sessions WHERE player=?").run(s.player);
            }
            return { recoveryCode: recoveryCode(s.player) };
          });
          if (changing) { revokeSessions(s.player); issueSession(res, s.player, "shared"); }
          return json(res, 200, result.result);
        }
        if (req.method === "POST" && (path.startsWith("/api/chain/") || path.startsWith("/api/wallet/"))) {
          if (s.world !== "shared") throw new GameError("Creditcoin fittings belong to shared play. Join a merchant house first.");
          if (!chain) throw new GameError("The chain contracts have not been configured for this harbor.", 503);
          rate(req, "chain", 60, 60_000);
          return json(res, 200, await chain.handle(s.player, s.hash, path, await body(req)));
        }
        if (req.method === "POST" && path === "/api/logout") {
          db.prepare("DELETE FROM sessions WHERE hash=?").run(s.hash);
          res.setHeader("Set-Cookie", "drift_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" + (secureCookie ? "; Secure" : ""));
          return json(res, 200, { ok: true });
        }
        if (req.method === "GET" && path === "/api/state") return json(res, 200, stateFor(s));
        if (req.method === "GET" && path === "/api/events") {
          if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) throw new GameError("Unrecognized origin.", 403);
          if ([...clients].filter(c => c.session.hash === s.hash).length >= 4) throw new GameError("Too many open game windows.", 429);
          res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
          res.write("data: " + JSON.stringify(stateFor(s)) + "\n\n");
          const client = { session: s, response: res };
          clients.add(client); req.on("close", () => clients.delete(client)); return;
        }
        if (req.method === "POST" && path === "/api/quote") {
          const input = await body(req), world = transact(s.world, () => undefined).world;
          const ship = world.ships[typeof input.ship === "string" ? input.ship : world.players[s.player].selectedShip];
          if (!ship || ship.owner !== s.player) throw new GameError("This boat does not belong to you.", 403);
          if (!PORT_IDS.includes(input.port as PortId) || !["sail", "powered", "hazard"].includes(String(input.route))) throw new GameError("Choose a route and destination.");
          return json(res, 200, voyageQuote(world, ship, input.port as PortId, input.route as RouteKind, now()));
        }
        if (req.method === "POST" && path === "/api/command") {
          const input = await body(req);
          if (typeof input.key !== "string" || !/^[a-zA-Z0-9_-]{16,80}$/.test(input.key)) throw new GameError("A unique command key is required.");
          if (!input.command || typeof input.command !== "object" || Array.isArray(input.command)) throw new GameError("Expected a command object.");
          const bodyHash = sha(JSON.stringify(input.command));
          const result = transact(s.world, world => {
            if (world.players[s.player]?.npc) throw new GameError("NPC houses are controlled by the practice simulation.", 403);
            const previous = db.prepare("SELECT body_hash FROM commands WHERE world=? AND player=? AND key=?").get(s.world, s.player, input.key as string) as { body_hash: string } | undefined;
            if (previous) {
              if (previous.body_hash !== bodyHash) throw new GameError("This command key was used for another action.", 409);
              return;
            }
            command(world, s.player, input.command, now());
            db.prepare("INSERT INTO commands VALUES (?,?,?,?,?)").run(s.world, s.player, input.key as string, bodyHash, now());
          });
          return json(res, 200, publicWorld(result.world, s.player));
        }
        return json(res, 404, { error: "Unknown endpoint." });
      }
      if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method not allowed." });
      const root = resolve(ROOT, "dist");
      let requested = resolve(root, "." + decodeURIComponent(path));
      if (requested !== root && !requested.startsWith(root + sep)) return json(res, 403, { error: "Invalid path." });
      if (path === "/" || !extname(path)) requested = resolve(root, "index.html");
      let content: Buffer;
      try { const info = await stat(requested); if (!info.isFile()) throw new Error("not a file"); content = await readFile(requested); }
      catch { return json(res, 404, { error: "Build the client with npm run build before serving it." }); }
      const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".ogg": "audio/ogg", ".md": "text/plain; charset=utf-8", ".glb": "model/gltf-binary", ".txt": "text/plain" };
      res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https: wss:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'");
      res.writeHead(200, { "Content-Type": types[extname(requested)] ?? "application/octet-stream", "Cache-Control": extname(requested) === ".html" ? "no-cache" : "public,max-age=3600" });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (error instanceof GameError) json(res, error.status, { error: error.message });
      else { console.error("Game request failed:", error instanceof Error ? error.name : "unknown"); json(res, 500, { error: "That action could not be completed. Reload to check your progress before trying again." }); }
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 15_000;
  let pulses = 0;
  const timer = options.tick === false ? null : setInterval(() => {
    try {
      const t = now();
      const worlds = new Set<string>(["shared", ...[...clients].map(c => c.session.world)]);
      const states = new Map<string, World>();
      for (const worldId of worlds) states.set(worldId, transact(worldId, () => undefined).world);
      if (++pulses % 3 === 0) for (const client of clients) {
        if (client.session.expires <= t || !db.prepare("SELECT hash FROM sessions WHERE hash=?").get(client.session.hash)) {
          client.response.end(); clients.delete(client); continue;
        }
        const world = states.get(client.session.world);
        if (world && !client.response.writableEnded && client.response.writableLength < 256_000) {
          client.response.write("data: " + JSON.stringify(publicWorld(world, client.session.player)) + "\n\n");
        } else { client.response.end(); clients.delete(client); }
      }
      if (pulses % 600 === 0) {
        db.prepare("DELETE FROM sessions WHERE expires<=?").run(t);
        db.prepare("DELETE FROM worlds WHERE expires IS NOT NULL AND expires<=?").run(t);
      }
    } catch (error) { console.error("World tick failed:", error instanceof Error ? error.name : "unknown"); }
  }, 100);
  timer?.unref();
  return {
    server,
    chainStep: chain?.step,
    close: async () => {
      if (timer) clearInterval(timer);
      if (chainTimer) clearInterval(chainTimer);
      for (const client of clients) client.response.end();
      clients.clear();
      await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
      await chain?.close();
      db.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const host = process.env.DRIFT_HOST ?? "127.0.0.1";
  if (!["127.0.0.1", "::1", "localhost"].includes(host) && !process.env.DRIFT_ORIGIN?.startsWith("https://")) {
    throw new Error("A public listener requires an explicit HTTPS DRIFT_ORIGIN behind the approved proxy.");
  }
  const app = createGameServer();
  const port = Number(process.env.DRIFT_API_PORT ?? 4187);
  app.server.listen(port, host, () => console.log("Drift economy listening on " + host + ":" + port + ". Shared invitation is in the private data directory."));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
