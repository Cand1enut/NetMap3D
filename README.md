# NetMap3D

3D Network Designer / Network Diagram Maker.

3D network map designer prototype — rack layout, port-level cabling, cable-management routing. Desktop app (Electron + Three.js).

## Run it

```bash
cd netmap3d
npm install
npm start
```

No build step. Also works in a plain browser: `npx serve .` and open the URL (save/load falls back to file download/upload).

## Using it

- **Orbit** drag · **Pan** right-drag · **Zoom** scroll · **Walk (V):** first-person WASD + mouselook, Space/C up/down, Shift sprint, Esc exits
- **Device Library (left):** generic gear plus a UniFi catalog (gateways, switches, APs, cameras, door access, storage/power). Each product places the way it mounts in real life — rack slots snap to U positions, ceiling APs go on poles, doorbells/intercoms/readers require a wall, desk gear sits on the floor plane.
- **Cable tool (C):** click a source port, optionally click cable managers or drilled wall holes to route, then click the destination port. Connected ports tint to the cable color. Runs longer than 5 ft auto-route the way a tech actually pulls them — up out of the rack, across at plenum height, down to the device — unless you place waypoints yourself.
- **Patch panels are true 1:1 passthroughs.** Every port exists twice: the front RJ45 you patch into and the rear punchdown the permanent run terminates on. They are separate jacks in separate places, each holding exactly one plug. Cable the front to a switch and the rear stays open for the horizontal run, which is what lets you re-patch a drop by swapping a 6" lead instead of re-pulling cable. Hover any port to see both faces; the CSV export carries a **Face** column so "panel port 12 rear" is an unambiguous punchdown instruction on site.
- **Wall (W):** click floor to start, click again to end; chains until Esc. **Drill (H):** click a wall to make a cable pass-through. **X-ray (X):** see cables through walls.
- **Levels:** basement, crawlspace, ground, upper floors and attic. Everything you draw lands on the **active level**, and levels above it are hidden so you can see and click inside — `[` and `]` change level, `\` shows the whole building. Below-grade storeys excavate: grade stops being a floor where a basement exists. Crawlspaces and attics are "route" storeys — low clearance, no ceiling grid, because they exist to run wire through.
- **Stairs:** click to place a flight from the active level to the deck above. Rise and run are laid out to IRC R311.7 (max 7¾" riser, min 10" tread), so the footprint is real and you can tell whether it fits. Walk mode climbs them; cables route around them.
- **Raceway:** conduit (EMT ½"–4"), cable tray, surface raceway and J-hooks. Draw the pathway, then in Cable mode click it while drawing a run to pull that run into it. Cables inside a raceway travel in their own packed slot and don't sag — the pipe carries them. Fill is computed from real inside diameters against NEC Chapter 9 limits (53% one cable, 31% two, 40% for three or more) and shown live on the pathway; overfilled raceways turn red, because that design isn't buildable.
- **Tie (T):** straps cables into a real bundle. Members are pulled into hex-packed slots and funnel in and out of the strap, whether or not Physics is on.
- **Tie (T):** click a cable to strap it; cables within ~3.5" get bundled into the same tie.
- **Physics (P):** cables become simulated ropes pinned at ports/managers/holes/ties and drape under gravity. Per-cable "Slack %" in cable properties.
- **Simulate (G):** animated packets flow along every cable.
- **2D Plan:** flowchart-style logical view. Devices are nodes (dashed = not yet placed physically), physical cables are solid, planned links dashed — a planned link turns solid automatically once you cable it in 3D. Add logical devices there, then "Place in 3D map" from their properties.
- **+ Rack (R)** · **Delete (D)** · **Select** to inspect/rename; devices carry IP + notes metadata (shown in tooltips and exports).
- **Save/Load:** JSON (includes walls, holes, ties, links, 2D layout). **Export CSV:** cable map with IPs + device inventory + planned-link status.

## Architecture notes (for extending)

- `state` = plain JSON: `racks[]`, `devices[]`, `cables[]` (cable = two `{deviceId, port, side}` endpoints + waypoint list). This is the save format — everything 3D is rebuilt from it, so new features should edit state then rebuild.
- **A cable endpoint is `(device, port, side)`, never just `(device, port)`.** `side` is `'front'` or `'rear'`; port meshes carry a matching `userData.side`, and `getPortWorld(id, port, side)` resolves to the right jack, falling back when a device only exposes the port on one face (UPS outlets, rear power inlets). Capacity is per jack, not per port number. Saves written before this migrate in `migrateCableSides` — everything defaults to front, and a patch port holding two legacy cables gets the second moved to the rear.
- Device catalog is `DEVICE_TYPES` in `app.js` — add a type (label, U height, port count/rows, depth, color) and it appears; add a matching `.lib-item` in `index.html`.
- Cables are true-to-spec Cat6 (`CABLE_R` ≈ 0.125" radius, round cross-section) with molded RJ45 plug, 8 gold contacts, latch tab and strain-relief boot at each jack. The route is **collision-aware by default** (no physics mode needed): `cableCurve` builds a guide (port → connector lead-out → waypoints or `plenumRoute` → destination), resamples it, then `settleCable` applies a catenary droop, pushes every free sample out of walls / racks / gear / furniture, and separates it from every other cable's settled polyline (`cableRoutes` + a spatial hash) — so cables drape, never clip, and never share space. Interior waypoint pins may shift laterally so several runs through one manager sit side by side instead of stacking on one coordinate. `centripetal` Catmull-Rom keeps short switch↔patch jumpers from knotting. Structural edits (drill/wall/slab) re-route via `scheduleReroute`, which runs two passes so separation ends up mutual.
- Colliders (`rebuildRopeColliders`) cover walls, slabs, rack frames, rack chassis **and** field gear/furniture — the last derived automatically from each solid mesh's own geometry bounding box, so anything the catalog or the assistant adds is collidable for free. Each collider caches a world AABB for broadphase rejection.
- Post-processing runs through an explicitly **multisampled** composer target (`samples: 4`, HalfFloat). Leaving `EffectComposer` on its default target silently bypasses the canvas's `antialias: true` and every pass then works on jagged input — thin geometry like cat6 and baseboard shimmers badly. If you touch the composer setup, keep the multisampled target.
- Rebuild the portable single-file `NetMap3D.html` with `node build-portable.js` (inlines three.js + `style.css` + `app.js`).
- Pinned `three@0.147` for the UMD builds (no bundler needed). To modernize: switch to Vite + current three + ES modules.

## Ideas for v2

Cable trays/conduits between racks, per-port labels & VLAN metadata, bill of materials, 2D top-down floor plan view, device models (GLTF) instead of boxes, undo/redo, multi-select.
