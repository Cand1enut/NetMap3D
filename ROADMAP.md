# NetMap3D — Long-Term Roadmap

North star: a cloud SaaS where network engineers survey, design, and install together — fun and intuitive, but genuinely productive.

**Guiding principle — install-grade fidelity.** A technician should be able to follow the map and perform the installation with perfect accuracy down to the most minute detail: exact ports, exact holes, exact lengths, exact mounts. Nothing is a note or an "essence" of a thing — everything in the diagram exists 1:1 in the model. Between video survey, the local AI, and hand-tweaking the little things, producing a model should be fast and understandable for even the most novice tech. That fidelity is the differentiator versus every other network planning tool.

## Target workflow (the product loop)

Video survey onsite → auto-converted to an in-app 3D building model → add detail manually where needed → drill holes, route cables, cable-manage the rack → the finished model becomes a 1:1 referenceable map used onsite during the real install.

## Planned phases

1. **Real-time collaboration (Google Docs-style).** Shared maps, simultaneous multi-user editing, presence cursors, share links with roles. Technical path: move state mutations through an op log (the app already funnels all changes through a single JSON `state`), sync via CRDT (Yjs/Automerge) over WebSocket; host state in the cloud.
2. **Video → building model.** Onsite walkthrough video converted to walls/rooms the wiring can be routed through. Technical path: photogrammetry / SLAM (e.g. COLMAP, Gaussian splatting, or Apple RoomPlan-style scan APIs) → extract floor plan + wall segments into the existing `state.walls` format; manual cleanup tools on top.
3. **Team tasks.** To-dos pinned to devices/cables/locations in the map ("drill this hole", "run this cable"), assignable, visible to the whole team, checked off during install. Extends `state` with `tasks[]` linked to object ids.
4. **Graphical realism (ongoing).** Real product models (GLTF), PBR textures, better lighting/shadows, realistic cable rendering. Goal: minor realism, not photorealism at the cost of performance.
5. **Cloud SaaS.** Hosted maps, orgs/teams, auth, billing. The renderer is already pure web tech, so the desktop app and browser app share one codebase.
6. **Multi-brand catalogs.** Cisco, Aruba, Netgear, Mikrotik, TP-Link Omada, etc., alongside UniFi — same mount-aware catalog format (`DEVICE_TYPES` entries are pure data; catalogs can become JSON packs loaded at runtime). Starter pack shipped; assistant adds anything else on demand.
7. **Simulation depth.** Failover paths (dual-WAN, redundant uplinks), LACP/LAG groups, HA pairs, load-balancer modeling — the analyzer already flags missing redundancy; simulation will actively exercise it (cut a link, watch traffic reroute).
8. **UX north star.** UniFi-OS-grade look and feel — clean, sleek, beautiful — paired with videogame-grade controls: walk, build, and inspect with the fluidity of Satisfactory, approachable enough that anyone picks it up cold.

## Where the current build already points that way

- Single serializable JSON `state` = the future sync document and file format.
- Mount-aware catalog format is data-driven — new brands are data packs, not code.
- 2D plan ↔ 3D build separation mirrors the future plan → survey → install pipeline.
- Walls/holes/ties model the physical install actions that tasks will attach to.
