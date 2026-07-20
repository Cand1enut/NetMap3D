# NetMap3D

**Build the building, run the wire, then follow your own model on site.**

A 3D network design tool for people who actually pull cable. You draw the
structure — floors, walls, basements, crawlspaces — then route real Cat6 through
it at 1:1 scale, into real conduit, onto the correct face of a real patch panel.
The result isn't a diagram that approximates the job. It's a model a technician
can install from.

![NetMap3D](docs/hero.jpg)

---

## Why this exists

Network diagrams tell you what connects to what. They don't tell you whether the
run fits in the conduit, which side of the patch panel it lands on, or how much
cable to put on the truck. Building tools model space beautifully but know
nothing about a network.

NetMap3D is the overlap. Everything is inches, nothing is decorative:

- A **patch panel port exists twice** — the front RJ45 you patch into and the rear
  punchdown the horizontal run terminates on. Separate jacks, separate places,
  one plug each. That's what lets you re-patch a drop by swapping a 6" lead
  instead of re-pulling cable, and the CSV export names the face so
  "panel port 12 rear" is an unambiguous punchdown instruction.
- **Conduit fill is computed, not guessed.** Trade sizes carry their real inside
  diameters from NEC Chapter 9 Table 4, checked against the 53% / 31% / 40%
  rules. Overfill a raceway and it turns red, because that design isn't buildable.
- **Cables can't pass through anything** — not walls, not gear, not each other.
- **Stairs are laid out to IRC R311.7** (max 7¾" riser, min 10" tread), so a
  flight has its real footprint and you can see whether it fits the room.
- The 5'10" reference figure is there so every other dimension has something
  honest to be judged against.

---

## What it looks like

**Structured cabling, done properly.** Horizontal runs land on the panel's rear
punchdown; short leads patch the front across to the switch. Nothing plugs
field-to-switch.

![Rack detail](docs/rack-detail.jpg)

**Raceways with live fill.** Pull runs into conduit or tray and they ride in
their own packed slot — no sag, because the pipe carries them. 200 cables can
share a 24" tray and each still terminate somewhere different.

![Raceway fill](docs/raceway-fill.jpg)

**Real storeys, including below grade.** Basement, crawlspace, ground, upper
floors, attic. Draw on the active level and the ones above cut away so you can
see in.

![Building section](docs/levels-section.jpg)

---

## Run it

```bash
npm install
npm start          # Electron desktop app
```

No build step. It also runs in a plain browser — `npx serve .` — where save/load
falls back to file download/upload.

For a single self-contained file you can hand to someone:

```bash
node build-portable.js   # writes NetMap3D.html, ~1 MB, no dependencies
```

---

## Using it

**Orbit** drag · **Pan** right-drag · **Zoom** scroll · **Walk (V)** first-person
WASD + mouselook, Space jumps, F flies, Esc exits.

The interface is two bars: the build palette on top, and options for whichever
tool is active underneath — cable colour under Cable, bit size under Drill,
trade size under Raceway. The level selector is always visible, because it's
global context.

| Tool | What it does |
|---|---|
| **Cable (C)** | Click a port, optionally route via cable managers, wall holes or raceways, click the destination. Runs over 5 ft auto-route through the plenum the way a tech actually pulls them. |
| **Tie (T)** | Straps nearby cables into a real bundle — members cinch into hex-packed slots and funnel in and out of the strap. |
| **Wall / Room / Floor** | Draw structure on the active level. Room builds four walls plus a ceiling at that storey's real clear height. |
| **Stairs** | A flight from the active level to the deck above, walkable and collidable. |
| **Drill (H)** | Bore a pass-through at a preset or custom size (⅛"–12"). Cables route through it. |
| **Raceway** | EMT ½"–4", cable tray, surface raceway, J-hooks — with NEC fill tracking. |
| **Measure (M)** | Real ft/in dimensions between any two points. |
| **2D Plan** | Logical view. Plan links there, build them in 3D; a planned link turns solid once you actually cable it. |

**Levels:** `[` and `]` move a storey, `\` shows the whole building. Below-grade
storeys excavate — grade stops being a floor where a basement exists.
Crawlspaces and attics are "route" storeys: low clearance, no ceiling grid,
because they exist to run wire through.

**Save/Load** is plain JSON. **Export CSV** gives the cable schedule with IPs,
face, colour, route points and length, plus a device inventory.

---

## Roadmap

Working toward Cisco Packet Tracer's simulation depth with UniFi-OS polish, in a
building you model yourself:

- [x] Install-grade cable routing — collision-aware, no clipping
- [x] True patch panel front/rear semantics
- [x] Building levels, basements, crawlspaces, attics, stairs
- [x] Conduit and raceway with NEC fill
- [ ] 1:1 device port layouts from published spec sheets
- [ ] Simulation engine — MAC/ARP tables, L2 forwarding, VLANs, routing, DHCP, CLI
- [ ] Wider device catalog across major vendors
- [ ] Video walkthrough → building model (photogrammetry import)
- [ ] Real-time multi-user collaboration

---

## Architecture notes

- `state` is plain JSON: `racks[]`, `devices[]`, `cables[]`, `walls[]`, `slabs[]`,
  `stairs[]`, `raceways[]`. It's the save format, and everything 3D is rebuilt
  from it — new features should edit state, then rebuild.
- **A cable endpoint is `(device, port, side)`, never just `(device, port)`.**
  `side` is `'front'` or `'rear'`; capacity is per jack, not per port number.
  Older saves migrate in `migrateCableSides`.
- **Routing precedence:** a raceway beats hand-placed waypoints beats
  auto-routing. A cable inside a pipe has no say in where it goes.
- `settleCable` applies catenary droop, pushes samples out of walls / racks /
  gear / furniture, and separates each run from every other settled route
  (`cableRoutes` + a spatial hash). Ties and raceway spans are exempt — inside a
  strap or a conduit, cables are *supposed* to touch.
- Colliders come from each solid mesh's own geometry bounding box, so anything
  added to the catalog is collidable for free. Each caches a world AABB for
  broadphase rejection.
- Post-processing uses an explicitly **multisampled** composer target. The
  default target silently bypasses the canvas `antialias` flag and shreds thin
  geometry like cat6 — keep it.
- **Adding a tool:** put the button in `#modescroll` and its options in `#optbar`
  with `data-for="<mode>"`. Don't append to the right-hand cluster, and don't
  assume the bar fits.
- Pinned to `three@0.147` for the UMD builds (no bundler). To modernise: Vite +
  current three + ES modules.
