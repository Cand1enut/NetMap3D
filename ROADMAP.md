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

## Owner update, Jul 2026 — the app is accurate but it feels clunky

Cables now route correctly (v0.25.1/.2). The owner's next pass is about how the
thing FEELS to use. Verbatim: "the current floor system is wack", "there's other
systems that function similarly and they all feel clunky", "the current system
to utilize the packet tracer roadmapped system is clunky and unintuitive, it
needs to look and feel clean and be easy to read and configure".

Take that as a standing verdict on the whole interaction model, not six separate
bugs. The pattern behind every item below is the same: the app makes you pick a
mode from a list and then edit numbers in a side panel, when you should be able
to point at the thing and manipulate it directly.

**1. Levels must go. Replace with real building volume.**
There is no reason for a "Level 1 / Level 2 / …" dropdown. Wanted: cut a
basement out of the ground the way you'd cut a room, build inside it, build a
ceiling over it, and move through the whole structure continuously — on foot or
flying — with no level picker anywhere. Floors and ceilings become slabs you
draw and cut openings in; a "storey" is an emergent consequence of where the
slabs are, never a mode you are in. `LEVELS`, `activeLevel`, `setLevel()`,
`showAllLevels` and the level `<select>` all get deleted rather than restyled.
Stairs, drilling, raceways and device placement then work off real Y, not off a
level index. This is the largest item here and it touches placement, picking,
camera and save format — spec the whole thing before starting, and expect the
save migration to be the risky part.

**2. Manual cable editing must be intuitive.**
Auto-routing will never be right 100% of the time, and when it is wrong the
override has to feel like pulling cable, not like editing a list of waypoints.
Draggable handles exist but are not discoverable. Wanted: grab a run anywhere
along its length and pull it, with the segment staying orthogonal and the
neighbours re-dressing to follow; add and remove bends by direct manipulation;
snap to rails, ducts and other runs; visible feedback for what a drag will do
before releasing it.

**3. The 2D planner should read like a flowchart.**
Links are drawn as bare straight lines (`moveTo`/`lineTo`, app.js ~7591–7615),
so the plan is a diagonal cat's cradle. It should use the same orthogonal
routing idea as the 3D view: clean right-angle runs with rounded corners,
lanes that avoid overlapping nodes, and arrowheads/junctions that read as a
diagram. This is the cheapest item on the list and is mostly `drawPlan()`.

**4. ~~Packet flow looked like a strobe~~ — DONE v0.25.3.**
One sphere per cable at 140 in/s. Now a steady train of evenly spaced packets at
26 in/s with a fixed 12" world spacing, so a patch lead and a 200 ft run show
the same density and speed. Instanced per cable, so it is still one draw call.

**5. The simulation UI needs rebuilding, and switches need a real terminal.**
The DHCP/ACL/VLAN/STP work is accurate but is driven through cramped property
panels and a print-only output pane. It needs to look and read like a network
tool: legible tables, obvious state, configuration that is quick to change and
hard to get wrong.

And the CLI stops being a print-out. A managed switch needs an actual terminal:
a prompt, real mode transitions (user → enable → config → interface), command
parsing with IOS abbreviation (`sh ru`, `int gi1/0/1`), `?` completion, error
text that matches the real box ("% Invalid input detected at '^' marker."),
and `show` output rendered from live engine state rather than canned strings.
Config typed at the terminal must mutate the same model the 3D view and the
simulation read, in both directions — that bidirectionality is the whole point
and is the part most likely to be faked. Per the standing rule: a Cisco switch
gets IOS, a UniFi device gets UniFi OS, and each is a working environment, not
a skin. Do one vendor completely before starting a second.

**6. Cost of the build — a real bill of materials, with order links.**
Track what the design costs, priced at the cheapest reputable seller, with a
per-item custom price override and links to actually order the gear.

The app already computes every cable's true routed length, so this is a genuine
installer's BOM, not just a list of boxes. It rolls up:
- devices by SKU and quantity
- cable by type and total footage, plus the waste factor a real estimate carries
- connectors and keystones, counted from actual endpoints
- patch panels, racks, managers, and raceway/conduit by the foot from `state.raceways`
- optionally a labour line, since drops are usually quoted per-drop

Data model: a bundled price book keyed by SKU carrying MSRP, street price,
currency, the source it came from, and the date it was captured. A per-SKU or
per-device custom price always wins and is visibly marked as owner-set. Every
price displayed shows its "as of" date — a stale price presented as current is
the same class of error as a fake `show` command.

**Constraint that shapes this: the app cannot silently fetch live prices.** It
is a single portable HTML file with no backend; browsers block cross-origin
retailer requests and retailers block scrapers regardless. So live pricing is
NOT an invisible auto-feature. Honest options, in order of preference:
- ship the price book with the build, refreshed when a version is cut
- import a CSV/JSON price list the owner supplies or exports from a distributor
- opt-in fetch, only if a backend or proxy ever exists
Never render an old number as if it were today's.

"Reputable" needs modelling, not a guess. For network gear the distinction that
actually matters is **authorized distributor vs grey market** — grey-market
Cisco and UniFi voids warranty, invalidates licensing and is where counterfeit
optics come from. So a seller entry carries whether it is authorized for that
brand, and the UI says so. Cheapest-that-is-reputable means cheapest authorized
seller by default, with grey-market listings shown only if the owner opts in and
clearly labelled. Order links are per-SKU and should prefer a stable product URL,
falling back to a search URL keyed on the exact manufacturer part number.

**7. Export configs the real hardware can actually load.**
The design should port to the gear: take what was configured in NetMap3D and
emit it in the form that specific device consumes, so a switch can be preloaded
rather than hand-typed on site. This is what turns the file into an install
plan, and it must share one config model with the terminal (item 5) — two
renderers of the same config will drift, and the drift will be discovered on a
live switch.

**The fault line: some vendors take a config file, some genuinely cannot.**
Fabricating an artifact for the second group would be the worst kind of fake in
this project, because a file that looks loadable and isn't wastes a site visit.

Text-config devices — a real, loadable file:
- **Cisco IOS / IOS-XE** — plain CLI text, delivered by `copy tftp: startup-config`,
  SCP, `configure replace`, or console paste.
- **Aruba AOS-CX** — CLI text, and it also accepts declarative JSON via REST.
- **MikroTik RouterOS** — an `/export`-style script loaded with `/import file=`.
- **Netgear/others with text backup** — case by case; verify per model, never assume.

Controller and cloud devices — no per-device config file exists:
- **UniFi** — config lives in the controller, not the switch. Export must be
  API calls against the Network API or a provisioning payload. Do NOT emit a
  fake `.unf`.
- **Meraki** — Dashboard API only; cloud-managed, no file.
- **Omada / Instant On** — controller-held; binary backups are proprietary.
For these, the export is an API script plus a human-readable worklist, and the
UI says plainly that the device cannot be file-preloaded.

Zero-touch is the payoff and it is already half-built: the DHCP work models
option 150 (TFTP server) and option 67 (bootfile). A real Cisco ZTP flow is
exactly that — switch boots factory-default, DHCPs, pulls its config from TFTP
by filename. NetMap3D already knows the topology, the scopes and the per-device
config, so it can emit both the config files and the DHCP scope that serves
them, named per device. That is a genuine end-to-end install artifact.

Guardrails, because a generated config can black-hole a switch:
- flag any line that changes the interface the operator is likely connected
  through, and never bury it silently in the middle of a file
- emit VLANs and trunk allowed-lists explicitly (`switchport trunk allowed vlan
  add`, not a bare `vlan` that replaces the list)
- mark the export as reviewed-by-a-human-before-load, and show a diff against
  the device's current running config when one has been imported
- round-trip test: export a config, re-import it, and the model must be identical

**8. Where no file can be loaded, emit a runbook instead.**
For every device that cannot be preloaded (item 7), export the ordered
instructions to configure the real thing by hand so it ends up matching
NetMap3D. Same config model as the terminal and the file export — that is now
three consumers of one model, and any of them rendering independently will drift.

The instructions are vendor-shaped, not generic:
- **CLI without a loadable file** — exact commands including mode transitions
  (`configure terminal`, `interface GigabitEthernet1/0/12`, `exit`), in the
  order they must actually be typed.
- **GUI/controller devices (UniFi, Meraki, Omada, Instant On)** — the real
  navigation path and field values, e.g. Settings → Networks → Create New
  Network, VLAN ID 20. These are the devices that need this most, because they
  are precisely the ones with no file to load.

**Order is the substance of this feature, not a presentation detail.** A list of
settings is not a runbook. The generator has to respect real dependencies:
1. VLANs must exist before any port can be assigned to one.
2. Uplinks/trunks before access ports — configure the edge first and you cut
   the path you are working over.
3. Core before edge, for the same reason, so the site-level order matters as
   much as the per-device order.
4. Addressing and management access before anything that depends on reaching it.
5. DHCP scopes after the SVIs they serve exist.
6. ACLs last. They are the most likely step to strand the operator.

Lockout handling is mandatory, not a nicety: any step that changes the port,
VLAN or address the operator is likely connected through gets called out before
it appears, with the recovery path stated (console cable, second uplink, or
`reload in 5` before applying and `reload cancel` after it is confirmed good).

Each phase ends with a verification step and its expected output — `show vlan
brief` listing 10, 20, 30; a link light; a successful ping — so the technician
knows the phase took before moving on. A runbook without checkpoints just moves
the failure further down the page.

This is the feature nothing else can produce, because it can fold in the
physical plan the app already has: "punch panel port 12 rear, patch front 12 to
Gi1/0/12" and then "configure Gi1/0/12 as access VLAN 20" belong in the same
numbered sequence. Output must be printable and readable on a phone in a closet.

## Cloud + real-time collaboration is an ARCHITECTURAL CONSTRAINT, not item 9

This becomes a cloud app where several people edit one site simultaneously,
Google-Docs style. That is owner priority 4, but it must not be treated as
something bolted on after the rest — it constrains the data model now, and every
item above is affected by it. Retrofitting sync onto ad-hoc mutation is a
rewrite, not a feature.

**Concrete debt already in the code, cheap now and expensive later:**
- `uid()` is `nextId++` (app.js:471). Two clients will both mint id 1001 and
  silently collide. Needs client-prefixed or UUID ids before any sync work.
- ~15 direct `state.devices.push(...)`-style mutations. Every edit needs to
  become an operation that can be applied, inverted for undo, merged, and
  broadcast. The op log is also a better undo system than the current snapshot
  one, so this pays for itself even single-player.
- `simNow()` is `Date.now() + skew`. In a shared session the simulation clock
  has to be session state, or two clients disagree about whether a lease has
  expired.

**What is already right, and should be preserved deliberately:** design state
lives in `state` and is saved; runtime state (MAC tables, ARP caches, DHCP
bindings, STP, sim clock) lives outside it and is never saved, because a real
box loses its tables on reboot. That boundary is exactly the one collaboration
needs — design state syncs as the shared document, runtime state does not.
Nothing random touches design or protocol state (`Math.random()` appears only in
procedural textures and the cosmetic packet phase), so the simulation is
deterministic and can be replayed identically on every client from synced design
state. Keep it that way: no random fuzz in protocol timers, ever.

**Conflict semantics must be per object type, not one global rule.** Two people
dragging the same cable waypoint is last-write-wins and harmless. Two people
assigning the same switch port is a real conflict that must be *rejected*, not
merged — the physical world cannot have two cables in one jack, and silently
merging would produce a design that cannot be built. Same for rack U slots and
conduit fill.

Also needed: presence (cursors, selection, collaborator cameras), read-only
share links, and version history.

**Local-first, sync optional.** The portable double-click file is an owner
requirement and does not go away. Local-first with optional sync is the honest
architecture and is also the best one — the file keeps working with no account,
no server, and no connection.

**This relaxes one earlier constraint.** Item 6 says the app cannot fetch live
prices because there is no backend and browsers block cross-origin retailer
requests. Once a server exists it can proxy that, so live pricing and
server-side config push become possible. Do not design item 6 in a way that
makes that impossible later, and do not depend on it before the backend is real.

## Definition of done — the data centre build

Owner-set acceptance test for the whole simulation: **build an entire data
centre in the app and verify it functions 100% completely.** Not a unit test,
not a scripted probe — a full site, built the way one would really be built,
that then has to actually work.

What that has to exercise, all at once and all correct:
- Multiple racks, real SKUs, structured cabling landing on patch panel rears
  with short leads to switches, cable management that reads as professionally
  dressed
- Pathways: in walls, in ceilings, underground between buildings, in racks
- Full addressing: VLANs per subnet, gateway SVIs, DHCP scopes, static
  assignments that do not collide
- Redundancy: multiple uplinks with spanning tree blocking correctly, and a cut
  link failing over
- Security: ACLs enforcing real segmentation between zones
- Internet: provisioned circuit, demarc, terminating equipment, NAT
- Every host reaching what it should and nothing reaching what it should not,
  proven by the reachability matrix
- Vendor management interfaces reflecting and controlling all of it

If any part of that build reveals something the simulation gets wrong, that is a
defect to fix, not a limitation to document. The build is not "done" until it
runs clean end to end.

## Method: specify the whole mechanism BEFORE writing it

The recurring failure in this project has not been any single shortcut — it is
building each mechanism to the minimum that makes the immediate feature work,
then correcting it when the owner notices. VLANs shipped as "parse an integer
out of port config" and only later became a VLAN database with access/trunk
modes, native VLAN and allowed lists. That should have been the starting point,
because that is what a VLAN *is*.

Before writing any network mechanism, write its complete real model here first,
then build to that spec. If the spec is too large for the session, the mechanism
does not get started — a partial is what causes this.

Specs for what remains, written up front:

**Routing table / protocols.** Per-device table of routes, each with
destination prefix, next-hop, outgoing interface, administrative distance and
metric. Connected routes appear automatically for every addressed interface.
Static routes configurable. Longest-prefix match wins; AD breaks ties between
sources (connected 0, static 1, EIGRP 90, OSPF 110, RIP 120). A default route
is 0.0.0.0/0. Forwarding is a table lookup, not "find a router that touches both
subnets".

**NAT.** A translation table with the four Cisco address perspectives (inside
local, inside global, outside local, outside global) per flow. PAT overloads
many inside hosts onto one outside address by port. Static NAT maps one to one.
Port forwarding maps an outside port to an inside socket. Translations are
created on the first packet and time out.

**ACLs (completing).** Protocol and port matching (`permit tcp any host x eq
80`), named lists with their own syntax and sequence numbers, `established`,
ICMP types, remarks. Per-entry hit counters, since that is how ACLs are actually
debugged. — BUILT in v0.25.0. Still absent, and each needs its own spec before
being started: reflexive ACLs, time-based ACLs, object groups, and the
`ip access-list resequence` command.

**STP (completing).** Port states blocking → listening → learning → forwarding
on real timers (hello 2 s, forward delay 15 s, max age 20 s). BPDU exchange
rather than a computed answer. PortFast/edge ports. RSTP and PVST+, since PVST+
is what Cisco actually runs and means one tree per VLAN.

**DHCP (completing).** A scope per subnet, not one pool per device. Lease time
with renewal at T1/T2 and expiry. Reservations by MAC. Options: default gateway,
DNS servers, domain name, TFTP. Exclusions. DHCP relay (ip helper-address) for
subnets with no local server. — BUILT in v0.24.0.

**VTP.** Still deliberately absent. Spec it before building: a domain name, a
revision number, server/client/transparent modes, and the fact that a client
with a higher revision number overwrites the domain — which is the single most
destructive real-world VTP behaviour and the reason it must not be faked.

**Interfaces.** Speed and duplex negotiation — a 1 G port cabled to a 100 M port
trains to 100 M and both ends report it. Administrative state (`shutdown`)
separate from operational state. Error counters.

**Hosts.** Multiple NICs rather than an assumed port 1, each with its own
address, VLAN and gateway.

## Known shortcuts — FIX THESE, they are simulation errors

Owner standard: "literally zero shortcuts, everything needs to be true to life
100% with not a single thing left to the imagination, 1:1. Corner cutting
results in an inaccurate simulation."

Audited honestly after being caught shipping "a cable reaching the Internet node
means internet access" (fixed in v0.19.1). These are the remaining known
divergences from reality. Each is a defect, not a backlog nicety. Fix in roughly
this order — the first one is foundational and several others depend on it.

1. ~~**Routers have one `ip` field**~~ — FIXED v0.21.0. Routed ports
   (`portCfg[port].ip`) and SVIs (`svi[vlan]`); a device with neither on a
   segment is not a gateway there. Host default gateways are verified against
   addresses actually present. Caught a real VLAN/subnet mismatch in the sample
   site the moment it went in.
2. ~~**`netClass()` guesses device role from port count**~~ — FIXED v0.20.0.
   Role is declared on every one of the 100 catalog entries; an undeclared SKU
   warns in console rather than being guessed. Caught three real
   misclassifications (Flex Mini, Switch Ultra, Flex 2.5G were simulated as
   endpoints instead of switches).
3. ~~**DHCP serves one pool per device**~~ — FIXED v0.24.0. A scope per subnet
   with its own range, lease, options (3/6/15/150), reservations by MAC, and
   device-wide excluded ranges (global on IOS, not a pool subcommand). Conflict
   detection probes an address before offering it — 2 pings, 500 ms — and lists
   the squatter. Relay works: the relay stamps giaddr and the server picks the
   scope matching giaddr rather than the arrival interface.
4. ~~**No DHCP lease lifecycle**~~ — FIXED v0.24.0. Real durations with T1 at
   0.5x and T2 at 0.875x (RFC 2131 s4.4.5), BOUND → RENEWING → REBINDING →
   EXPIRED, and on expiry the client stops using the address. RENEWING unicasts
   to the leasing server; REBINDING broadcasts. A client that cannot keep its
   address gets a NAK and restarts.
5. ~~**ACLs match addresses only**~~ — FIXED v0.25.0. Protocol (ip/tcp/udp/
   icmp), port operators (eq/neq/lt/gt/range) with Cisco's mnemonics — kept as
   separate TCP and UDP tables because 512/513/514 mean different things on
   each — `established` (ACK or RST, TCP only), ICMP types, `log`, and remarks.
   Named lists have their own `ip access-list extended NAME` block syntax with
   sequence numbers starting at 10 and stepping by 10, and entries evaluate in
   sequence order. Per-entry hit counters, shown by `show access-lists`.
   A ping is now genuinely ICMP echo, so `deny icmp any any echo` stops a ping
   while leaving TCP alone — which the old address-only model could not express.
   The sim panel gained a traffic tester, because a ping only ever exercises
   ICMP echo and most of an ACL could otherwise never be verified.
6. **NAT has no translation table and no PAT.** Real NAT tracks
   inside-local/inside-global/outside-local/outside-global per flow and
   overloads many inside hosts onto one public address by port. Also missing:
   static NAT, port forwarding.
7. **STP converges instantly with no port states.** Real 802.1D moves
   blocking -> listening -> learning -> forwarding on timers (hello 2s,
   forward delay 15s, max age 20s), has PortFast/edge ports, and elects on
   BPDUs. Also missing: RSTP/PVST+, which is what Cisco actually runs.
8. ~~**MAC tables never age**~~ — FIXED v0.22.0. Entries timestamped, 300 s
   Cisco default, expired on read.
9. **No routing protocols and no routing table.** Static routes, connected
   routes, OSPF/EIGRP, administrative distance, longest-prefix match.
10. **Hosts assume a single NIC on port 1** (`hostVlan`, `hostPort`).
11. ~~**No VLAN database**~~ — FIXED v0.23.0. Named VLANs, VLAN 1 builtin,
    access vs trunk modes, explicit native VLAN, allowed-list pruning, and
    detection of native-VLAN mismatch and ports in undeclared VLANs. VTP still
    absent (deliberately — it is a distinct mechanism, spec it before building).
12. **Link speed/duplex is never negotiated** — a 1G port cabled to a 100M port
    should train to 100M and both ends should report it.
13. ~~**Cable length affects nothing but a warning**~~ — FIXED v0.22.0. Channel
    limit (100 m) fails the link; permanent link (90 m) warns with the remaining
    patch-cord allowance. Fixing it exposed that the first hop was never
    length-checked at all.

14. **Soft shadows are silently disabled.** three.js r185 logs
    "PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead" on every
    load — the renderer is quietly downgrading shadow filtering, so shadow edges
    are harder than intended. `THREE.Clock` is deprecated in favour of
    `THREE.Timer` on the same load. Both are one-line fixes; noticed while
    testing DHCP, recorded rather than fixed mid-mechanism.

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

- **Advancing a simulated clock must be a discrete-event walk, not one jump.**
  Skipping straight to the target time steps over every timer that should have
  fired on the way: a one-day jump on a one-day lease sailed past the T1
  renewal at the halfway mark and reported the lease as expired, when a real
  client would have renewed it and still been up. `simAdvance()` now stops at
  each pending event in order. Any future timer mechanism (STP, ARP, NAT
  translation timeouts, OSPF hellos) must register its next event the same way.
- **A client's own lease must not count against itself.** The free-address set
  included the requesting client's current binding, so every renewal walked it
  one address up the pool. Renewal keeping the same address is the entire point
  of a renewal.
- **A stale index outlives the thing it indexes.** Lease expiry marked the
  binding EXPIRED but left the host→lease map alone, so an expired client kept
  answering with its old address. Rebuild derived state wherever the source
  changes, not only in the one function that happens to be called first.
- **The browser cached `app.js` across reloads and I tested stale code twice**,
  including one round where a fix appeared not to work. `node make-dev.js`
  writes a gitignored `dev.html` with cache-busted asset URLs — test through
  that, and assert a known-new string is present before trusting any result.
- `referenceSite()` appends to the scene rather than replacing it. Call
  `clearScene()` first in any test, or you get several sites layered on top of
  each other — which briefly looked like a duplicate-address bug when it was
  really two independent gateways serving the same subnet.
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
