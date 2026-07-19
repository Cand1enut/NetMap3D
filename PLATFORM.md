# NetMap3D Platform — Design Document (v1)

**Product thesis:** Homestyler for network engineers. Teams design buildings and networks together in real time at 1:1 install-grade fidelity, then hand the model to a tech who installs from it port-by-port, hole-by-hole. Fun and intuitive like a game; precise like a spec sheet.

This document is decision-complete: next sessions execute it top-down without re-deriving choices.

---

## 1. Architecture overview

```
Browser / Desktop app (existing three.js client)
        │  websocket (ops) + https (REST)
        ▼
   Sync service (Node + y-websocket or PartyKit)   ←→   Postgres (orgs, users, projects meta, billing state)
        │                                                    │
        ▼                                                    ▼
   Object storage (S3/R2: project snapshots,            Stripe (subscriptions, seats)
   thumbnails, exports, GLTF asset packs)
```

Client stays a single-page three.js app — the entire current codebase carries forward. The platform wraps it; it does not replace it.

## 2. Real-time collaboration (the core bet)

**Why we're ready:** every mutation in the current app already flows through one JSON `state` object, and every mutating action already calls `undoPush()`. That is an op boundary. We upgrade, not rewrite.

**Sync model — Yjs CRDT:**
- Project doc = `Y.Map` mirroring `state`: `racks`, `devices`, `cables`, `walls`, `holes`, `slabs`, `ties`, `links`, `measures`, `customTypes` as `Y.Array`s of plain objects (objects are small and replaced whole on edit — element-level LWW is fine at this granularity; no need for per-field CRDTs in v1).
- Client refactor (1 session): introduce `mutate(fn)` wrapper. Every site that currently does `undoPush(); state.x.push(...)` becomes `mutate(s => s.x.push(...))`. `mutate` applies to the Y doc inside a transaction; a Y observer rebuilds affected meshes (we already have builders + delete fns per entity type keyed by id — observer diffing by id is mechanical).
- Undo becomes `Y.UndoManager` scoped to local origin (undo undoes *your* ops only — Google-Docs semantics).
- Offline: y-indexeddb persistence → open, edit offline, sync on reconnect. The existing file format stays as import/export (a `.json` is just a doc snapshot).

**Presence (awareness protocol):**
- Broadcast per-user: cursor ray hit point, camera pose, active tool, selection id, walk-mode avatar position.
- Render: colored name-tagged cursors; in walk mode, a simple avatar capsule (we already have a person mesh) at collaborators' positions — you literally see your teammate walking the site. Ghost previews (wall drafts, placements) broadcast so others see intent.

**Conflict UX:** object-level last-writer-wins + soft locks: selecting an object marks it in awareness; others see a colored outline and a "Sarah is editing" chip. No hard locks.

**Server:** start with hosted **PartyKit** or **Liveblocks** (fastest to ship, generous free tier) with a clean adapter interface so we can move to self-hosted `y-websocket` + Redis when unit economics matter. Auth token gates room access; room id = project id.

## 3. Accounts, orgs, projects

- **Auth:** Clerk or Auth.js — email magic link + Google SSO. JWT passed to sync service.
- **Data model:** `users`, `orgs`, `memberships(role: owner|admin|editor|viewer|installer)`, `projects(org_id, name, thumbnail, updated_at, y_snapshot_ref)`, `invites`, `share_links(project_id, role, token, expires)`.
- **Installer role** is the differentiator: read-only + walk mode + checklists + measurements — what the on-site tech gets on a tablet via a share link. No account required to view via link (viewer), account required to edit.
- Periodic snapshot job: Y doc → JSON snapshot → S3 + thumbnail render (headless three.js — our smoke harness already proves the app runs headless; add a real GL context via `headless-gl` or puppeteer for thumbnails).

## 4. Subscriptions (Stripe)

| Tier | Price (launch guess) | Limits |
|---|---|---|
| Free | $0 | 1 user, 3 projects, core tools, community catalog |
| Pro | $19/user/mo | Unlimited projects, exports (CSV/BOM/PDF), custom devices, priority catalog updates |
| Team | $39/user/mo | Real-time collaboration, roles, share links, installer mode, org catalog packs |
| Enterprise | Contact | SSO/SAML, self-host sync, audit log, support SLA |

- Stripe Checkout + Customer Portal (no custom billing UI in v1). Webhooks set `orgs.plan`; client feature-gates locally with server verification on sync join.
- Collaboration is the paywall anchor; single-player stays generous so the free tier seeds virality (shared read-only links show "Made with NetMap3D — edit free").

## 5. Website (marketing + app shell)

- One Next.js repo, two surfaces: `netmap3d.com` (marketing: hero with live embedded demo scene — our standalone build IS the demo, iframe it), and `app.netmap3d.com` (auth-gated client + project dashboard reusing the launcher design we just built).
- Landing structure: hero (tagline + live 3D demo), the loop (Plan → Build → Walk → Install), fidelity section (port-level screenshots), collaboration section, pricing, footer. Draft page shipped alongside this doc (`site/index.html`) using the same design tokens as the app.

## 6. Asset/catalog pipeline (realism track, parallel)

- Catalog becomes versioned JSON packs served from CDN: `packs/unifi.json`, `packs/cisco.json` + optional GLTF refs per SKU: `{ model: "u_udmpromax.glb", dims, portLayout, ... }`.
- Client: add `GLTFLoader`; if a def has `model`, load it (cached) and overlay our functional port hitboxes at the pack's declared port coordinates — models are visual shells; ports/LEDs/VLANs stay engine-driven so *every* device remains fully functional even mid-rollout.
- Sourcing order: flagship UniFi (UDM family, Pro Max switches, U7 APs, G6 cameras) → rest of UniFi → Cisco/Aruba/etc. Community submissions later (moderated pack PRs).

## 7. Security & fidelity guardrails

- Server-side validation of ops (schema + bounds) — clients are untrusted.
- Project data is customer-sensitive (physical security layouts!): encryption at rest, org-scoped access checks on every room join, share-link expiry, audit log (Enterprise).
- Keep the local-AI stance: Ollama stays a local-only integration; cloud AI features must be opt-in per org.

## 8. Migration path (nothing breaks)

1. Current portable build keeps working forever (offline single-player).
2. Session A: `mutate()` refactor + Yjs local-only (proves op model; zero server).
3. Session B: PartyKit room + presence cursors → first two-browser demo.
4. Session C: auth + project dashboard (port the launcher to the web app).
5. Session D: Stripe + roles + share links + installer mode.
6. Session E: marketing site live, closed beta invites.
Each session ends with the harness green + a shippable build, same as today.

## 9. Open questions (decide next session)

- PartyKit vs Liveblocks vs self-host day one (recommend: PartyKit for dev speed).
- Product name/domain check (NetMap3D availability, or rebrand before public).
- Seat-based vs project-based pricing for small MSPs (recommend: seats, min 2 for Team).
- Whether installer mode ships mobile-first PWA immediately (recommend: yes — it's the wedge into real crews).
