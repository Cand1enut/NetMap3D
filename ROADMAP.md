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
4. **Never guess. Research first.** (Owner, verbatim: "don't guess on ANYTHING.")
   Every dimension, port count, speed, PoE class, fill limit, code depth, bend
   radius, spacing and command syntax must come from a published source, and the
   source goes in the code — `SPEC_SOURCES` for hardware, an inline comment with
   the standard cited (NEC 300.5, TIA-568, IRC R311.7, NEC Ch.9 Table 4) for
   everything else. This has already caught real errors: EMT vs RMC inside
   diameters, and the Catalyst 9200L-24P-**4G** uplink count.
   If something genuinely can't be verified: leave it out, or implement it and
   mark it `// UNVERIFIED:` with what would confirm it — never quietly guess and
   never present an assumption as fact to the owner.
   **Cross-reference every fact against 3-5 independent sources**, and prefer the
   primary one (the RFC, the IEEE standard, the NEC/TIA text, the vendor's own
   datasheet) over blogs that quote it. A single search repeats one site's
   mistake; agreement across several, anchored to the primary, is what makes it
   safe to encode. Cite the primary source in the comment.
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

Done, each with its acceptance test passing:
- L2/L3 reachability, ping/trace/matrix (v0.11)
- DHCP (v0.15) — pools, leases, "no server in broadcast domain" verdict
- MAC + ARP tables (v0.16) — learned by real traffic, flushed on topology change
- STP 802.1D (v0.17) — per-component root election, blocked ports honoured by
  l2Walk and rendered amber
- IP ACLs (v0.18) — Cisco semantics, real access-list syntax parser that
  round-trips, per-port in/out application

Remaining, roughly in order:
- NAT + an Internet node
- Device CLI / management interfaces (see the vendor section below). The ACL
  parser in v0.18 is the first piece of the IOS command layer — extend it
  rather than starting a second parser.
- Routing protocols, VLAN trunk depth, LACP/HA/failover
All of it must derive from catalog data via netClass() so new devices inherit
simulation for free.

#### Management interfaces must match the real vendor

Owner requirement: "a cisco switch needs to use cisco commands and operate like
a cisco switch, a unifi setup would have a unifiOS simulator."

**Decided (owner):** build them how they are in real life. If a product is
GUI-managed, that's fine — but the interface must be *present* for every device.
Not every vendor is CLI-managed, so a fake CLI for a GUI product would be less
accurate, not more. Build the surface the product actually has.

**These are not mockups or screenshots — they are fully functioning simulated
environments that both work and look like the real thing.** Owner, verbatim:
"a cisco switch should operate like the cisco cli, a unifi switch should have a
fully functional simulated unifiOS... they are fully functioning simulated
environments that function and look like the real thing."

What that requires, concretely:

- **Bidirectional.** The interface doesn't just display state, it *sets* it.
  `switchport access vlan 20` in IOS changes the port's VLAN in `state`, which
  changes what `pingHosts` returns, which changes the 3D view. Same for the
  UniFi console: change a port profile in the UI and the sim reflects it.
  Managing the whole network through these interfaces must be possible as a
  full alternative to the app's own property panels.
- **Stateful and authentic.** Running-config vs startup-config with unsaved
  changes; `write memory` / `copy run start` actually persists. Mode
  restrictions enforced (no `configure terminal` from user EXEC). Real error
  text — IOS answers a bad command with `% Invalid input detected at '^'
  marker.`, not a generic error.
- **Visually faithful.** UniFi OS should look like UniFi OS: its dark console
  chrome, device list, the port panel with its port grid and per-port profile
  editor, clients, topology. IOS should look like a terminal with the right
  banner, prompts and paging (`--More--`).
- **Good enough to practise on.** Someone studying for a CCNA should be able to
  configure a switch through the IOS CLI here and have it genuinely work — that
  is what makes the challenges phase (item 3) worth anything.

**Standard: identical. No shortcuts, no half-working demos.** (Owner, verbatim:
"commands should be identical... everything should be identical... no shortcuts,
no half working demos, everything.")

How that is actually achieved — this is a method, not a softening:

1. **Every implemented command is verified against vendor documentation or real
   device output before it ships.** Exact syntax, exact argument forms, exact
   output formatting (column headers, spacing, order), exact error text. Never
   approximate from memory; cite the source in a comment. This follows ground
   rule 4 — the same rule that already caught the EMT/RMC and 9200L-4G errors.
2. **Depth before breadth.** Finish a command family completely — every form,
   every flag, correct output, correct errors — before starting the next. A
   half-done family is exactly the "half working demo" being ruled out. Ten
   command families that are genuinely identical beat a hundred that are close.
3. **Never fake a response.** A command that is not implemented yet must not
   return invented output. Authentic behaviour is already the correct fallback:
   real IOS answers an unrecognised command with
   `% Invalid input detected at '^' marker.` — so an unimplemented command is
   indistinguishable from one the real device rejects, and nothing lies.
4. **Track coverage honestly.** Keep a per-vendor checklist in the repo of which
   command families are complete and verified. "Done" means verified, not
   written. Report coverage to the owner as a fact, never as an impression.

The end state is full parity for the products in the catalog. The path there is
one verified family at a time — never a broad shallow layer that looks right in
a screenshot and falls over on the second command.

CLI-first — build a real command interpreter:
- **Cisco IOS / IOS-XE** (Catalyst): mode hierarchy `>` user EXEC → `#` priv
  EXEC (`enable`) → `(config)#` (`configure terminal`) → `(config-if)#`.
  Commands `show running-config`, `show ip interface brief`, `show vlan brief`,
  `show mac address-table`, `show interfaces status`, `show spanning-tree`,
  `show cdp neighbors`; config `interface GigabitEthernet1/0/1`,
  `switchport mode access|trunk`, `switchport access vlan N`,
  `switchport trunk allowed vlan a,b`, `no shutdown`, `write memory`.
  Interface naming matters (`GigabitEthernet1/0/1`, `TenGigabitEthernet1/1/1`,
  `Vlan10`). Support `?` help, tab completion and abbreviation (`sh ip int br`)
  — that's most of what makes it feel like IOS.
- **Aruba/HPE AOS-CX**: similar shape, different syntax — `interface 1/1/1`,
  `vlan access 20`, `vlan trunk allowed 10,20`. Do NOT reuse IOS syntax.
- **MikroTik RouterOS**: completely different — hierarchical menus,
  `/interface print`, `/ip address print`, `/interface bridge vlan print`,
  prompt `[admin@MikroTik] >`.

GUI-first — build a simulated console panel, not a CLI:
- **UniFi (UniFi OS / Network application)**: the real management surface is the
  web console — Devices, Ports, Networks/VLANs, Clients, Topology. A "UniFi OS
  simulator" means those panels, styled like UniFi OS, reading live sim state.
  (Switches do have SSH, but nobody configures UniFi that way.)
- **Meraki**: cloud dashboard, no meaningful CLI.
- **TP-Link Omada / Aruba Instant On / Netgear**: controller web UI.

Shared engine, per-vendor front end: every interface reads and writes the same
sim state (VLANs, port config, MAC/ARP, routes). The vendor layer is only
syntax/presentation, so a new SKU inherits management from its vendor pack.

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

## Known shortcuts — FIX THESE, they are simulation errors

Owner standard: "literally zero shortcuts, everything needs to be true to life
100% with not a single thing left to the imagination, 1:1. Corner cutting
results in an inaccurate simulation."

Audited honestly after being caught shipping "a cable reaching the Internet node
means internet access" (fixed in v0.19.1). These are the remaining known
divergences from reality. Each is a defect, not a backlog nicety. Fix in roughly
this order — the first one is foundational and several others depend on it.

1. **Routers have one `ip` field, not per-interface addresses.** Real routers
   address every interface separately, and that is what makes a default gateway,
   inter-VLAN routing (SVIs), and NAT inside/outside meaningful. Everything below
   is compromised until this is fixed. Needs `portCfg[port].ip` on routers, SVIs
   per VLAN, and hostIp/gateway logic reading them.
2. ~~**`netClass()` guesses device role from port count**~~ — FIXED v0.20.0.
   Role is declared on every one of the 100 catalog entries; an undeclared SKU
   warns in console rather than being guessed. Caught three real
   misclassifications (Flex Mini, Switch Ultra, Flex 2.5G were simulated as
   endpoints instead of switches).
3. **DHCP serves one pool per device.** Real gateways serve a scope per
   subnet/VLAN, with lease time, reservations, and options (gateway, DNS).
4. **No DHCP lease lifecycle** — no lease time, renewal, or expiry.
5. **ACLs match addresses only.** Real ACLs match protocol and ports
   (`permit tcp any host x eq 80`), established, ICMP types. Named ACLs are
   currently treated as extended rather than having their own syntax.
6. **NAT has no translation table and no PAT.** Real NAT tracks
   inside-local/inside-global/outside-local/outside-global per flow and
   overloads many inside hosts onto one public address by port. Also missing:
   static NAT, port forwarding.
7. **STP converges instantly with no port states.** Real 802.1D moves
   blocking -> listening -> learning -> forwarding on timers (hello 2s,
   forward delay 15s, max age 20s), has PortFast/edge ports, and elects on
   BPDUs. Also missing: RSTP/PVST+, which is what Cisco actually runs.
8. **MAC tables never age.** Real default aging is 300 s.
9. **No routing protocols and no routing table.** Static routes, connected
   routes, OSPF/EIGRP, administrative distance, longest-prefix match.
10. **Hosts assume a single NIC on port 1** (`hostVlan`, `hostPort`).
11. **No VLAN database.** VLANs exist implicitly via port config; there is no
    `vlan 20 / name SALES`, no trunk native VLAN, no allowed-list pruning,
    no VTP.
12. **Link speed/duplex is never negotiated** — a 1G port cabled to a 100M port
    should train to 100M and both ends should report it.
13. **Cable length affects nothing but a warning.** Real copper past 100 m
    fails; the sim should mark the link down, not just flag it.

Rule going forward: when a mechanism is modelled, model the whole mechanism. If
it cannot be finished now, it does not ship as a partial — it stays out and
stays on this list. A half-modelled mechanism silently teaches the user
something false, which is worse than an absent feature.

**Do not reason "I would normally simplify this, but I was told not to."** The
simplification should not be a candidate in the first place. Owner, verbatim:
"reverse that thinking and don't even consider corner cutting a possibility."
Two tells that a shortcut is being taken, both caught in this project:
- A heuristic standing in for data (port count guessing device role).
- Bulk regex-patching a data file instead of reading each entry and setting it
  deliberately. If the edit is too tedious to do properly, that is a signal the
  data model is wrong, not a licence to batch-guess.

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
- STP has **two** cost tables differing by orders of magnitude: 802.1D-1998
  short (1G=4, 100M=19, 10G=2) vs 802.1D-2004 long (20,000,000 / speed-in-Mbps,
  so 1G=20000). Cisco still defaults to short, so `show spanning-tree` must
  print short costs even though the engine computes long ones. Both are in the
  code; keep them in sync.
- STP must elect a root **per connected component**. One global tree leaves
  every switch on an isolated island rootless and blocks all its ports. Caught
  by the triangle acceptance test, not by inspection.
- Grade (y = 0) must stop acting as a floor where a basement excavates, and
  the raycaster does NOT respect `visible = false` — exclude hidden meshes in
  `groundTargets()` yourself.
- Ship the demo with the gateway cabled; otherwise every routed ping reports
  "no gateway", which is correct and looks broken.
- Pushes get rejected because the owner edits on GitHub directly (has
  happened twice). Always fetch + inspect + rebase; never force-push over
  their commits; preserve their README edits.
- Backticks inside a `git commit -m "..."` heredoc/double-quoted string are
  shell command substitution — `` `state` `` silently vanished from a commit
  body once. Use single quotes around code words in commit messages, or write
  the message to a file and use `-F`.

## Per-version cadence

`node --check app.js` → browser-harness asserts → screenshot if visual →
bump version (package.json + index.html `.ver`) → commit (hook rebuilds
portable) → push → short plain-voice summary to the owner: what shipped,
what was verified, what's next.
