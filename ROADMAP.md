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

## Current state (v0.14.0, Jul 2026)

Single-page app: `app.js` (~6k lines, no bundler, three.js **r185** bundled to
`vendor/three-bundle.js` by `build-vendor.js` and exposed as window.THREE),
`index.html` (two-tier toolbar), `style.css` (UniFi-ish tokens),
`build-portable.js` → `NetMap3D.html`. Electron wrapper also works
(`npm start`). Repo root doubles as the web root (`npx serve .`).

Done and verified:

- **Cable routing.** Deterministic, no physics: orthogonal 90° legs
  (`orthLegs`), rack dressing via the vertical manager (`rackDressRoute`),
  rounded corners at a per-cable bend radius, waypoints snapped to a 1" grid
  and draggable (yellow = move, blue = add, right-click = remove). Collision
  colliders + cable-vs-cable separation still apply outside pathways.
  23 pathway types (EMT, tray, surface, J-hook, buried PVC, direct burial,
  riser sleeve, wall cavity) with NEC Ch.9 Table 4 fill; `pathwayY()` places
  each run in its real space (plenum / attic / crawlspace / trench).
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

Owner-set priority order (stated Jul 2026). Work them in this order.

### 1. Cable running + rack management  ← CURRENT

Not done until any install method looks clean and hand-adjustable. The owner's
bar: "no weird angles or messed up cable management." Reference real cable
management photos when unsure what good looks like.

Every one of these must work and look right — none is more important than the
others, they are alternatives an installer picks between:

- in walls (stud cavity, floor to floor)   - on walls (surface raceway)
- in ceilings (plenum, attic, crawlspace)  - on ceilings (surface mount)
- outside (aerial / exterior)              - underground (trench)
- in racks (vertical + horizontal managers)

Done so far: orthogonal 90-degree routing, rack dress route via vertical
manager, per-cable bend radius, drag-to-edit waypoint handles, buried/riser/
wall-cavity pathway types, per-space elevations (pathwayY).

Still to do:
- In-wall routing as a first-class action: click a wall while cabling to drop a
  waypoint on the wall centerline; run vertically in the cavity; pass floors
  through a sleeve. Must look clean with X-ray on.
- Bundling: parallel runs sharing a pathway should lie side by side and break
  out cleanly, not overlap. (Tie system packs bundles; extend to pathways.)
- Service loops (12-24in copper) stored in managers, figure-8, respecting bend
  radius.
- Slack/length realism + TIA 90 m permanent-link warning (separate from the
  existing 100 m channel check).
- Verify each method visually against reference photos before calling done.

### 2. Packet Tracer functionality — 100%

Existing: L2/L3 reachability, ping/trace/matrix, DHCP (v0.14 partial).
Remaining, roughly in order:
- MAC + ARP tables, inspectable per device
- STP with blocked-port rendering
- ACLs, NAT + an Internet node
- Device CLI (IOS-flavoured show commands first, then config)
- Routing protocols, VLAN trunk depth, LACP/HA/failover
All of it must derive from catalog data via netClass() so new devices inherit
simulation for free.

### 3. Challenges / practice mode

Packet-Tracer-style scenarios the user can attempt: a broken network to fix, a
spec to build to, graded on the sim's own verdicts. Needs a scenario file
format and a checker built on reachabilityMatrix + the analyzer.

### 4. Multiplayer, Google-Docs style

Real-time collaborative editing so people plan and learn together. Op-log over
the single JSON state, CRDT (Yjs/Automerge) over WebSocket, presence cursors,
share links. PLATFORM.md has the earlier architecture sketch.

### 5. Graphics: Xbox-360 era quality

Target: looks like a game from ~10 years ago. Size is not a constraint (up to
10 GB) as long as it stays a double-click app.
Done: three.js r185, AgX tone mapping, GTAO, ceiling troffers with area lights,
procedural PBR surfaces.
Next: real product models (GLTF) instead of primitives, better materials, baked
or screen-space GI, richer furniture/environment, texture detail.

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
