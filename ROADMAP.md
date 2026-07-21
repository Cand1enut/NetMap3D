# NetMap3D — Execution Roadmap

Written for a fresh Claude (Opus 4.8) session or any contributor to continue
with zero conversation history. Read this file plus README.md before touching
code.

North star: Cisco Packet Tracer's functionality with UniFi-OS polish, inside a
1:1 building you model yourself — the same file is the network sim and the
install plan a tech follows on site. After the sim is solid: real-time
multi-user collaboration (Google-Docs style). Owner: Tom (`Cand1enut` on
GitHub).

## Ground rules (owner-set, do not renegotiate)

1. Push to GitHub for **every version**. Remote is
   `git@github.com:Cand1enut/NetMap3D.git` over SSH (key installed and working
   on this Mac). Bump `package.json` version + the `.ver` span in `index.html`
   each release.
2. `NetMap3D.html` (portable single-file build) is **committed on purpose**.
   A pre-commit hook in `.git/hooks/pre-commit` rebuilds it when
   app.js/index.html/style.css are staged. Building elsewhere: run
   `node build-portable.js` before committing (hooks don't travel with
   clones).
3. Everything must keep working as a double-click file. No dependency that
   adds an install step for end users. (Engine question was asked and
   answered: stay on three.js; upgrade its version, don't migrate engines.)
4. Accuracy over decoration. Counts/speeds/PoE/fill limits come from published
   specs with sources recorded (`SPEC_SOURCES`); never invent hardware detail.
   If a spec can't be verified, say so in a comment instead of guessing.
5. Write like a person. Short sentences. No marketing voice, no AI filler —
   the owner has called this out once already.
6. When the owner reports a bug, find the root cause. The report "can't
   change wire colors" was actually a toolbar-layout bug hiding the control.

## Current state (v0.11.0, Jul 2026)

Single-page app: `app.js` (~6k lines, no bundler, three.js r147 UMD, pinned),
`index.html` (two-tier toolbar), `style.css` (UniFi-ish tokens),
`build-portable.js` → `NetMap3D.html`. Electron wrapper also works
(`npm start`). Repo root doubles as the web root (`npx serve .`).

Done and verified:

- **Cable routing.** Collision-aware (walls/gear/furniture/stairs, per-mesh
  AABB colliders + broadphase), cable-vs-cable separation, ties as a routing
  constraint (hex-packed bundles, work with Physics off), plenum auto-route
  for runs > 5 ft, raceways (EMT ½"–4"/tray/surface/J-hook) with NEC Ch.9
  Table 4 fill — all ten EMT trade sizes match the table exactly.
- **Patch panels.** Endpoint = `(device, port, side)`. Front jack and rear
  punchdown are separate jacks, one plug each; VLAN trace bridges front↔rear
  as one circuit. Legacy saves migrate via `migrateCableSides`.
- **Building.** `LEVELS` table (basement −108, crawlspace −42, ground 0,
  L2–L4, attic 480) with per-storey clear heights; invisible work plane makes
  below-grade drawing possible; `deckAbove()` = wall top + slab thickness —
  never "next entry in LEVELS" (a building has basement OR crawlspace, not
  both stacked). IRC R311.7 stairs, walkable in first person, collidable.
- **Rendering.** Multisampled composer target (4×, HalfFloat) — never let
  EffectComposer allocate its default target; it silently bypasses canvas AA
  and shreds thin geometry. Procedural PBR floor/wall/ceiling.
- **Devices.** 22 Cisco/Meraki SKUs + full UniFi catalog; per-port `speed` /
  `poe` / `role` from datasheets, `verified: true` + `SPEC_SOURCES[sku]` URL.
  Faceplate spacing is vendor convention, not measured — counts are the truth.
- **Simulation v1.** `parseIp`/`sameSubnet` (v4, bare IP defaults /24),
  `l2Walk` (VLAN checked at BOTH ends of a trunk, patch passthrough, 328 ft
  copper limit), `pingHosts` (L2 + gateway routing + router-to-router transit
  via `routerPath`), failure diagnosis by rule relaxation (re-walk ignoring
  length, then VLANs, to name the one broken thing), `reachabilityMatrix`.
  UI in the Assistant panel: src/dst pickers, Ping / Trace / Matrix;
  successful paths highlight their cables in 3D.

Architecture invariants (each has bitten once when broken):

- `state` is plain JSON and is the save format. Edit state, then rebuild.
- Sim role derives from catalog data via `netClass()`: WAN ⇒ router,
  ports ≥ 8 or switch-ish cat ⇒ switch, `passthrough` ⇒ patch, `manager` /
  `powerDevice` excluded, else host. **New devices must inherit simulation
  for free — never hardcode per-SKU sim logic.**
- New tools: button goes in `#modescroll`, options in `#optbar` with
  `data-for="<mode>"`. Never append to `#barright`; it must always fit.
- Verify with numbers, not eyes: `npx http-server -p 4173 .`, drive the page
  from browser JS (`__nm3debug`, `state`, and all engine functions are
  globals), assert counts/distances. Screenshots only for visual work.

## Ordered plan

One item = one version, committed and pushed, acceptance check passing in the
browser harness before commit.

### Phase 1 — Packet Tracer core (in progress)

1. **v0.12 DHCP.** Router-class devices get `dhcp: {enabled, poolStart,
   poolEnd}` in props (default: serve their own subnet). Hosts may set
   ip = `dhcp`; resolution broadcasts in the host's L2 domain and leases the
   next free address; leases visible in device props and a DHCP table in the
   Assistant. Accept: host with ip=dhcp pings a static host; removing the
   server produces the verdict "no DHCP server in broadcast domain".
2. **v0.13 MAC + ARP tables.** Ping/trace populate per-switch MAC tables
   (port → learned MACs; deterministic fake MACs derived from device id) and
   per-host ARP caches. Click a switch → MAC table in props. Accept: after a
   ping, the access switch maps both hosts to the correct ports; tables
   flush when a cable is deleted.
3. **v0.14 STP.** Redundant switch↔switch links elect a root (lowest device
   id wins), blocked ports computed and rendered dashed amber; `l2Walk` uses
   the spanning tree so loops terminate and redundancy reads as standby.
   Accept: a triangle of three switches yields exactly one blocked link;
   cutting a forwarding link makes the walk succeed over the standby.
4. **v0.15 ACLs.** Per-router ordered rules (allow/deny, src/dst subnet).
   `pingHosts` consults them on routed paths; verdict names the matching
   rule. Accept: a deny rule turns the matrix cell red with
   "blocked by ACL <name> rule <n>".
5. **v0.16 NAT + WAN.** New "Internet" catalog node; a router with a cabled
   WAN port NATs its inside subnets. Add a "ping 8.8.8.8" preset. Accept:
   host→internet succeeds iff some gateway has WAN cabling; verdict explains
   the NAT path.
6. **v0.17 Device CLI.** Terminal in router/switch props. Read commands
   first, IOS-flavoured, all reading live sim state: `show ip interface
   brief`, `show mac address-table`, `show vlan`, `show spanning-tree`,
   `show access-lists`, `show running-config`, `ping`. Config commands
   (vlan, access-list, ip address, shutdown) as a second pass. Accept:
   every show command agrees with the panels.

### Phase 2 — catalog depth

7. **v0.18** Speed/PoE verification pass for Aruba, Netgear, Omada, MikroTik
   (the treatment Cisco got in commit dcf80e6); add MX68 (deferred: its LAN
   table needed confirming), ISR/Catalyst 8000 routers (deferred: onboard
   port counts unconfirmed), and anything the owner names. Keep
   `SPEC_SOURCES` complete. Accept: every rack SKU's laid-out port count
   equals its declared count.
8. **v0.19** Structure/furniture depth: doors + windows as wall cutouts that
   cables route around, elevators as walkable shafts, more
   office/warehouse/retail furniture, per-room floor/wall/ceiling material
   picker. The Sims-style building variety the owner asked for.

### Phase 3 — platform

9. **v0.20** three.js r147 → current, via Vite + ES modules, zero feature
   changes in the same version so regressions are attributable. Keep the
   multisampled target, the portable single-file output (Vite single-file
   plugin), and Electron. Unlocks WebGPURenderer as an optional path later.
10. **v0.21** Scan import: RoomPlan USDZ/JSON (iPhone LiDAR) and
    photogrammetry floor plans → `state.walls`/`state.slabs` + cleanup UI.
    Integrate external scanners' output; do NOT attempt in-app video
    reconstruction.

### Phase 4 — collaboration (owner sequenced this last)

11. Op-log over the single JSON `state` (all mutations already funnel through
    it), CRDT sync (Yjs or Automerge) over WebSocket, presence cursors, share
    links with roles. PLATFORM.md holds the earlier architecture sketch
    (rooms, auth, hosting, pricing).

Also wanted, slot when convenient: team tasks pinned to objects ("drill this
hole"), GLTF product models, LACP/HA/failover simulation (cut a link, watch
traffic reroute), BOM export.

## Traps already hit once (don't repeat)

- `THREE.Object3D.traverse()` visits everything and the LAST matching mesh
  wins an assignment — patch rear jacks silently beat front jacks until
  endpoints became side-aware.
- The single-row toolbar overflowed at 1440px and 17 controls were
  unreachable; the bug report said "can't change wire colors". Measure
  `getBoundingClientRect().right` vs viewport whenever adding UI.
- Catenary droop inside a conduit bellied cables out through the pipe wall;
  raceway spans are pinned straight, and ties/raceway interiors are exempt
  from cable separation (cables in a strap are supposed to touch).
- RMC and EMT inside diameters differ from 2½" up; NEC fill numbers are per
  conduit type.
- Cisco suffixes encode counts: 9200L-24P-**4G** = four 1G uplinks.
- Grade (y = 0) must stop acting as a floor where a basement excavates, and
  the raycaster does NOT respect `visible = false` — exclude hidden meshes in
  `groundTargets()` yourself.
- Ship the demo with the gateway cabled; otherwise every routed ping reports
  "no gateway", which is correct and looks broken.
- Pushes get rejected because the owner edits on GitHub directly (has
  happened twice). Always fetch + inspect + rebase; never force-push over
  their commits; preserve their README edits.

## Per-version cadence

`node --check app.js` → browser-harness asserts → screenshot if visual →
bump version (package.json + index.html `.ver`) → commit (hook rebuilds
portable) → push → short plain-voice summary to the owner: what shipped,
what was verified, what's next.
