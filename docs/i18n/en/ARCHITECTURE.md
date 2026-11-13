> **English edition** — machine-assisted translation, unified by the i18n PM. **The Chinese original governs.**
> Source: `docs/ARCHITECTURE.md` · Source baseline: 2026-11-13 · Glossary: [GLOSSARY.md](../GLOSSARY.md) · Governance: [README.md](../README.md)

# Architecture Overview (Stable Entry Point)

> This document is the **stable entry point** for the platform architecture: layering, plugin tree, service catalog, event contracts, storage architecture, and the auth model.
> Historical evolution and design discussions live in `docs/internal/` (not part of the external contract); external capability contracts live in `docs/contract-*.md`.

## In One Sentence

One cordis plugin tree: the foundation layer provides storage / events / HTTP / tool runtime, every business domain is an independent plugin package, cross-plugin coordination goes exclusively through the event bus, and all REST/MCP traffic passes through the unified auth middleware + RBAC.

## Layering

```
Foundation   platform-core      storage (JSON/SQLite dual backend) · event bus · HTTP · ToolRuntime-lite · YAML · signing · scenegraph · behavior pipeline
Base         resource-core      resource ontology: attribute schema + lifecycle state machine + dependency graph (the shared substrate of every asset)
Domains      iam · authn · usage · audit · market · connector · mcp · nas · skillhub
             agent · app · modelgw · connect · update · portal · flow-core · exec-hub · workforce
Access       console · panel-core · dsh-bridge · rq-card · dingtalk-bridge
```

## Plugin Tree & Boot Order

Standalone host assembly is defined in `src/boot-all.ts` (equivalent to the dsh host form in `cordis.yml`):

```
platform-core → resource-core → iam → authn → usage → audit → market → connector
→ mcp → nas → skillhub → agent → app → modelgw → connect(host role) → update
→ portal → console → panel-core → flow-core → exec-hub → workforce → dingtalk-bridge
```

Assembly constraints (enforced by the `npm run lint:boot-order` gate):

- `restoreAll()` must run before any business collection is read (done inside platform-core `apply()`);
- `console` precedes every plugin that self-registers guarded routes (panel/exec/flow depend on its auth middleware being in place first);
- `connector` precedes `mcp`/`modelgw`; `nas` precedes `skillhub`; `exec-hub` precedes `workforce`;
- in the dsh host form, `connect` takes the client role and boots at a different position (intentional difference, see the cordis.yml comments).

## Foundation-Layer Service Catalog (`ctx.*`)

| Service | Provider | Responsibility |
| --- | --- | --- |
| `ctx.opsStorage` | `StorageService` | Business collection storage (JSON/SQLite dual backend, see next section) |
| `ctx.txnStore` | `SqliteTxnService` | Dedicated substrate for metering/transaction ledgers (`data/txnstore.db`, WAL + transactions + idempotent unique indexes) |
| `ctx.platformBus` | `PlatformBusService` | Platform event bus — the only glue between plugins |
| `ctx.tools` | `ToolRuntimeLite` | Tool registration runtime under the standalone host (under a full dsh host, the host's real ToolRuntime provides this) |
| `ctx.httpServer` | `HttpServerService` | HTTP service: REST routes, static assets, SPA fallback |
| `ctx.workforcePolicy` | `WorkforcePolicyRegistry` | Narrow port for digital-employee policy (assembly-order independent, prevents circular deps) |
| `ctx.behaviors` | `BehaviorService` | Behavior event collection pipeline (WP-03/D6) |
| `ctx.scenegraphs` | `ScenegraphService` | Industry scenario graphs (built-in channel loading + hot refresh) |

## Event Contracts (The Iron Rule of Coordination)

**Every state change must emit an event; cross-plugin coordination goes only through the event bus or extension points — directly reading another plugin's data is forbidden.**

Typical chains:

- `iam.user.frozen` → authn revokes all tokens
- `mcp.unhealthy` → circuit breaker + audit
- `panel.message.created` / `audit.alert.fired` → DingTalk bridge delivery
- `scenegraph.updated` → scenario graph hot refresh

The event list declared by each plugin lives in `packages/*/manifest/events.yaml`.

## Storage Architecture

```
data/
  collections.db        # business collections (when PLATFORM_STORAGE=sqlite; WAL + synchronous=FULL)
  txnstore.db           # metering & transaction ledgers (always SQLite, pre-existing behavior)
  *.json                # JSON backend for business collections (default form; under sqlite mode these are the rollback source)
  oidc-keys.json        # OIDC signing keys (read directly from file, not a collection; move to KMS in production)
```

- **The `Collection<T>` contract is the only seam**: `all/get/find/findOne/insert/update/remove/replaceAll/count/onChange/uniqueOn`.
  All 27 business plugins are storage-backend agnostic.
- **json backend** (default): in-memory Map + 250ms debounced atomic flush; collections marked `durability: 'durable'` skip the debounce and fsync immediately.
- **sqlite backend** (`PLATFORM_STORAGE=sqlite`): every write commits as a transaction; `uniqueOn` → engine-level unique indexes;
  resident memory does not grow with record count; on first boot it automatically back-fills from same-name JSON files (the files are kept as the rollback source).
  Decision and acceptance records: [`adr-0001-storage-migration.md`](../../adr-0001-storage-migration.md).
- **Metering ledgers** always go through `SqliteTxnService`: append-only, transactional, engine-level idempotency (schema v1).
- Honest boundary: both forms are single-process, single-writer; multi-node HA requires a Postgres collection backend (phase two).

## Auth & Permission Model

- Every `/api/*` route passes through the unified auth middleware + RBAC; anonymous requests to unmatched routes uniformly return 401 (no route-probing side channel).
- Permission points are centrally registered (`packages/*/manifest/permissions.yaml`; 86 static + 8 idempotent per-plugin registrations at boot = 94 in the runtime catalog), shared by Console / CLI / MCP tools.
- Tokens: dual-track identity (human + machine credentials), audience (aud) narrowing, on-behalf-of chains, refresh rotation + replay protection;
  uniqueness constraints (e.g., the "one person, one account" rule on identityLinks) are backed by engine-level unique indexes under the sqlite backend.
- External protocol keys stay ASCII and are never rewritten (Chinese annotations in `docs/协议键中文对照总表.md`).

## Access Surfaces

| Surface | Entry | Notes |
| --- | --- | --- |
| REST | `/api/*` (450 deduplicated routes) | unified auth + RBAC |
| MCP | `/mcp` (86 registered tools, each declaring its minimal permission) | the platform itself is an MCP server; under the dsh host form, tools are directly visible to models |
| CLI | `dshctl.mjs` (16 command groups) | machine-readable output first |
| A2A | `/api/agents/:slug/a2a` (JSON-RPC) + `/.well-known/*` (signed card discovery, spec-bare) + `/v1/a2a/*` (SSE) | digital-employee mutual invocation & collaboration surface (plugin-a2a, see docs/a2a-uhp-implementation.md) |
| UHP | `/v1/uhp` (capability discovery, unauthenticated, spec-bare) + `/v1/uhp/responses` (task surface, self-validating Bearer + uhp.invoke) | harness unified execution driver (plugin-uhp) |
| Console | `/` (SPA, zh-CN/en-US/ja-JP runtime switching) | `/docs` serves only the public allowlist of onboarding guides |

## Key Invariants (Read Before Changing Anything)

1. The `Collection<T>` interface must not change breaking-ly; storage backends are replaceable with zero plugin changes.
2. Every state change must emit an event; cross-plugin direct data reads are forbidden.
3. Protocol keys stay ASCII forever; i18n applies only to presentation-layer copy.
4. Demo/degraded capabilities must be explicitly labeled (`exec: demo`) and never silently fill in; the model gateway errors directly when no endpoint exists.
5. The platform does not resell or revenue-share: the price book is a zero-price snapshot (`charge` is always 0).
6. Anonymous requests to unmatched routes uniformly return 401; the `/docs` allowlist denies by default — tighter over looser.

## Documentation Map

- External: this file · `README.md` · `docs/deploy-enterprise.md` · `docs/contract-*.md` (7 capability contracts)
  · `docs/*-onboarding.md` / `docs/*-integration.md` (onboarding guides) · `docs/i18n/`
- Internal process material (QA reports / handoffs / refactoring baselines / release notes / dev plans): `docs/internal/` (not part of the external contract)
