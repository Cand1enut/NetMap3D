/* NetMap3D — 3D network map designer prototype
   Units: inches. Rack U = 1.75", 19" rail width, 42U racks. */
'use strict';

//////////////////// Constants & catalog ////////////////////

const U = 1.75;
const RACK_UNITS = 42;
const RACK_W = 19;          // rail-to-rail
const RACK_OUTER_W = 23;

// Cable-manager geometry. Shared by the mesh builder and the router so a cable
// is dressed to where the duct actually is — if these two ever disagree, runs
// float in front of the fingers instead of sitting inside the channel.
const HCM_FINGER_N = 10, HCM_FINGER_W = 1.1, HCM_FINGER_D = 1.6, HCM_FINGER_Z = 1.4;
const VCM_W = 3.2, VCM_D = 6, VCM_FINGER_N = 14, VCM_FINGER_D = 1.2;
// Finger centres across a horizontal duct, in device-local x.
function hcmFingerX(i) { return -RACK_W / 2 + 1.5 + i * (RACK_W - 3) / (HCM_FINGER_N - 1); }
// The gap between two fingers nearest a given x — where a run breaks out of the
// duct. Snapping to a gap is what stops a cable exiting straight through a tooth.
function hcmGapX(x) {
  let best = null;
  for (let i = 0; i < HCM_FINGER_N - 1; i++) {
    const c = (hcmFingerX(i) + hcmFingerX(i + 1)) / 2;
    if (best === null || Math.abs(c - x) < Math.abs(best - x)) best = c;
  }
  return best === null ? x : best;
}
const RACK_D = 30;
const RACK_BASE = 2;        // floor to bottom of U1
const RACK_H = RACK_BASE + RACK_UNITS * U + 1;

const DEVICE_TYPES = {
  switch48: { role: 'switch', label: '48-Port Switch',      uh: 1, ports: 48, rows: 2, depth: 14, color: 0x2f3b4d,
    portLayout: [{ type: 'rj', cols: 24, rows: 2 }] },
  switch24: { role: 'switch', label: '24-Port Switch',      uh: 1, ports: 24, rows: 1, depth: 12, color: 0x33445a,
    portLayout: [{ type: 'rj', cols: 24, rows: 1 }] },
  patch24:  { label: '24-Port Patch Panel', uh: 1, ports: 24, rows: 1, depth: 4,  color: 0x1c1f26, passthrough: true,
    portLayout: [{ type: 'rj', cols: 6 }, { type: 'rj', cols: 6, gapBefore: 0.3 }, { type: 'rj', cols: 6, gapBefore: 0.3 }, { type: 'rj', cols: 6, gapBefore: 0.3 }] },
  router:   { role: 'router', label: 'Router',              uh: 1, ports: 8,  rows: 1, depth: 12, color: 0x3d3550, wan: 1,
    portLayout: [{ type: 'rj', cols: 1 }, { type: 'rj', cols: 7, gapBefore: 0.45 }] },
  firewall: { role: 'router', label: 'Firewall',            uh: 1, ports: 6,  rows: 1, depth: 12, color: 0x50333a, wan: 1,
    portLayout: [{ type: 'rj', cols: 1 }, { type: 'rj', cols: 5, gapBefore: 0.45 }] },
  server:   { role: 'host', label: 'Server',              uh: 2, ports: 4,  rows: 1, depth: 26, color: 0x3a4148,
    portLayout: [{ type: 'rj', cols: 4, rows: 1 }] },
  ups:      { label: 'UPS',                 uh: 2, ports: 0,  rows: 0, depth: 24, color: 0x22262c, powerDevice: true, outlets: 8 },
  hcm:      { label: 'Horiz. Cable Manager',uh: 1, ports: 0,  rows: 0, depth: 5,  color: 0x15181d, manager: true },
  vcm:      { label: 'Vert. Cable Manager', uh: 0, ports: 0,  rows: 0, depth: 5,  color: 0x15181d, manager: true, vertical: true },
  ap:       { role: 'host', label: 'Access Point', uh: 0, ports: 1,  rows: 1, depth: 0,  color: 0xe8ebef, field: true, mountH: 96, mounts: ['ceiling', 'wall'], shape: 'disc' },
  camera:   { role: 'host', label: 'IP Camera',    uh: 0, ports: 1,  rows: 1, depth: 0,  color: 0xdfe3e8, field: true, mountH: 96, mounts: ['ceiling', 'wall'], shape: 'bullet' },
  // Scenery, not a network device — it must never appear as a pingable host.
  person:   { role: 'prop', label: 'Reference Person (5\'10")', short: 'Person', uh: 0, ports: 0, rows: 0, depth: 0, color: 0x3a4148, field: true, mounts: ['desk'], shape: 'person' }
};
for (const k of Object.keys(DEVICE_TYPES)) DEVICE_TYPES[k].cat = 'Generic';

// UniFi product catalog. Representative current lineup; mounts reflect how each
// product is actually installed (wall-only intercoms, ceiling APs, rack gear...).
const UI_SILVER = 0xd9dce1;
// Port electrical spec, per block of a faceplate.
//
// Counts and types come from vendor datasheets and are verifiable. Exact pixel
// geometry of a faceplate is not published anywhere, so block order and spacing
// follow each vendor's house convention rather than a measured drawing — treat
// positions as representative, counts/speeds/PoE as authoritative. SKUs carrying
// `verified` have had their port table checked against the datasheet linked in
// SPEC_SOURCES; everything else is a reasonable default awaiting the same pass.
const SPEED = { fe: 0.1, ge: 1, m25: 2.5, m5: 5, x10: 10, x25: 25, x40: 40, x100: 100 };
const POE = { none: null, af: 'PoE', at: 'PoE+', bt60: 'PoE++ (60W)', bt90: 'PoE++ (90W)' };

// Datasheets backing the `verified: true` entries.
const SPEC_SOURCES = {
  b_c9200: 'https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9200-series-switches/nb-06-cat9200-ser-data-sheet-cte-en.html',
  b_mx85: 'https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX85_Datasheet',
  u_promax48: 'https://techspecs.ui.com/unifi/switching/usw-pro-max-48-poe'
};

// Field builder — APs, cameras, phones, desk gear. These are endpoints unless
// the SKU says otherwise (a desk switch or a desk gateway overrides via extra).
const F = (label, short, mounts, shape, ports = 1, extra = {}) =>
  ({ label, short, uh: 0, ports, rows: 1, depth: 0, color: 0xe8ebef, field: true, mountH: 96, mounts, shape, role: 'host', ...extra });
// Rack-mount builder. `role` defaults to switch because that is what the vast
// majority of rack SKUs in this catalog are; routers/gateways override it via
// extra, and the override wins since extra is spread last.
const R = (label, short, ports, rows = 1, uh = 1, depth = 14, extra = {}) =>
  ({ label, short, uh, ports, rows, depth, color: UI_SILVER, role: 'switch', ...extra });
const UNIFI_CATALOG = {
  // Gateways
  // UDM family, true front panel: 2×4 RJ45 LAN block · RJ45 WAN · stacked SFP+ pair · touchscreen right
  u_udmpromax: { ...R('UDM Pro Max', 'UDMPM', 11, 2, 1, 17, { role: 'router',
    sfp: 2, roleMap: { 9: 'WAN', 10: 'WAN' }, faceInsetL: 3, faceInsetR: 3.4, display: { side: 'R', w: 2.1, h: 1.1 },
    portLayout: [{ type: 'rj', cols: 4, rows: 2 }, { type: 'rj', cols: 1, rows: 1, gapBefore: 0.5 }, { type: 'sfp', cols: 1, rows: 2, gapBefore: 0.5 }]
  }), cat: 'UniFi Gateways' },
  u_udmse:     { ...R('UDM SE', 'UDMSE', 11, 2, 1, 17, { role: 'router',
    sfp: 2, roleMap: { 9: 'WAN', 10: 'WAN' }, faceInsetL: 3, faceInsetR: 3.4, display: { side: 'R', w: 2.1, h: 1.1 },
    portLayout: [{ type: 'rj', cols: 4, rows: 2 }, { type: 'rj', cols: 1, rows: 1, gapBefore: 0.5 }, { type: 'sfp', cols: 1, rows: 2, gapBefore: 0.5 }]
  }), cat: 'UniFi Gateways' },
  // UXG Pro: RJ45 LAN · RJ45 WAN · SFP+ LAN · SFP+ WAN in one row, no display
  u_uxgpro:    { ...R('UXG Pro', 'UXG', 4, 1, 1, 12, { role: 'router',
    sfp: 2, roleMap: { 2: 'WAN', 4: 'WAN' },
    portLayout: [{ type: 'rj', cols: 1 }, { type: 'rj', cols: 1, gapBefore: 0.4 }, { type: 'sfp', cols: 2, gapBefore: 0.5 }]
  }), cat: 'UniFi Gateways' },
  u_dr7:       { ...F('Dream Router 7', 'DR7', ['desk'], 'tower', 5, { role: 'router', wan: 1 }), cat: 'UniFi Gateways' },
  u_ucgultra:  { ...F('Cloud Gateway Ultra', 'UCG', ['desk'], 'deskbox', 5, { role: 'router', wan: 1 }), cat: 'UniFi Gateways' },
  u_ucgmax:    { ...F('Cloud Gateway Max', 'UCGMax', ['desk'], 'deskbox', 5, { role: 'router', wan: 1 }), cat: 'UniFi Gateways' },
  u_ucgfiber:  { ...F('Cloud Gateway Fiber', 'UCGF', ['desk'], 'deskbox', 6, { role: 'router', sfp: 2, roleMap: { 6: 'WAN' } }), cat: 'UniFi Gateways' },
  u_express7:  { ...F('Express 7', 'EX7', ['desk', 'wall'], 'deskbox', 2, { role: 'router', wan: 1 }), cat: 'UniFi Gateways' },
  u_cgindustrial: { ...F('Cloud Gateway Industrial', 'CGI', ['wall'], 'box', 9, { role: 'router', wan: 1 }), cat: 'UniFi Gateways' },
  // Switches
  // UniFi switches: one continuous RJ45 block (no Cisco-style gaps) + stacked SFP+ at right
  // Pro Max 48 PoE: 16× 2.5G (8 PoE+, 8 PoE++) then 32× 1G (24 PoE+, 8 PoE++),
  // then 4× 10G SFP+. The mixed-speed split is the whole reason to buy this SKU,
  // so it now shows on the faceplate instead of 48 identical ports.
  u_promax48:  { ...R('Pro Max 48 PoE', 'PM48', 52, 2, 1, 16, { sfp: 4, faceInsetL: 2.6, verified: true,
    display: { side: 'L', w: 1.6, h: 1.2 },
    portLayout: [
      { type: 'rj', cols: 4, rows: 2, speed: SPEED.m25, poe: POE.at },
      { type: 'rj', cols: 4, rows: 2, speed: SPEED.m25, poe: POE.bt60 },
      { type: 'rj', cols: 12, rows: 2, gapBefore: 0.3, speed: SPEED.ge, poe: POE.at },
      { type: 'rj', cols: 4, rows: 2, speed: SPEED.ge, poe: POE.bt60 },
      { type: 'sfp', cols: 2, rows: 2, gapBefore: 0.6, speed: SPEED.x10, role: 'Uplink' }
    ] }), cat: 'UniFi Switches' },
  u_promax24:  { ...R('Pro Max 24 PoE', 'PM24', 26, 2, 1, 16, { sfp: 2, faceInsetL: 2.6, display: { side: 'L', w: 1.6, h: 1.2 },
    portLayout: [{ type: 'rj', cols: 12, rows: 2 }, { type: 'sfp', cols: 1, rows: 2, gapBefore: 0.6 }] }), cat: 'UniFi Switches' },
  u_pro48:     { ...R('Pro 48 PoE', 'Pro48', 52, 2, 1, 16, { sfp: 4, faceInsetL: 2.2, display: { side: 'L', w: 1.4, h: 1.0 },
    portLayout: [{ type: 'rj', cols: 24, rows: 2 }, { type: 'sfp', cols: 2, rows: 2, gapBefore: 0.6 }] }), cat: 'UniFi Switches' },
  u_pro24:     { ...R('Pro 24 PoE', 'Pro24', 26, 2, 1, 16, { sfp: 2, faceInsetL: 2.2, display: { side: 'L', w: 1.4, h: 1.0 },
    portLayout: [{ type: 'rj', cols: 12, rows: 2 }, { type: 'sfp', cols: 1, rows: 2, gapBefore: 0.6 }] }), cat: 'UniFi Switches' },
  u_agg:       { ...R('Aggregation (8 SFP+)', 'Agg', 8, 1, 1, 10, { sfp: 8,
    portLayout: [{ type: 'sfp', cols: 8, rows: 1 }] }), cat: 'UniFi Switches' },
  u_proagg:    { ...R('Pro Aggregation', 'ProAgg', 32, 2, 1, 14, { sfp: 32, faceInsetL: 2.2, display: { side: 'L', w: 1.4, h: 1.0 },
    portLayout: [{ type: 'sfp', cols: 14, rows: 2 }, { type: 'sfp', cols: 2, rows: 2, gapBefore: 0.6 }] }), cat: 'UniFi Switches' },
  // Desk/wall switches. F() defaults to host because most field gear is an
  // endpoint, so these must declare that they bridge — a Flex Mini really is a
  // 5-port switch and has to behave like one in the simulation.
  u_ultra8:    { ...F('Switch Ultra (8 PoE)', 'Ultra8', ['desk', 'wall'], 'deskbox', 8, { role: 'switch' }), cat: 'UniFi Switches' },
  u_flex25g8:  { ...F('Flex 2.5G 8 PoE', 'Flex8', ['desk', 'wall'], 'deskbox', 9, { role: 'switch', sfp: 1 }), cat: 'UniFi Switches' },
  u_flexmini:  { ...F('Flex Mini 2.5G', 'FlexM', ['desk', 'wall'], 'deskbox', 5, { role: 'switch' }), cat: 'UniFi Switches' },
  // Access points
  u_u7pro:     { ...F('U7 Pro', 'U7Pro', ['ceiling', 'wall'], 'disc'), cat: 'UniFi APs' },
  u_u7promax:  { ...F('U7 Pro Max', 'U7PMax', ['ceiling', 'wall'], 'disc'), cat: 'UniFi APs' },
  u_u7proxgs:  { ...F('U7 Pro XGS', 'U7XGS', ['ceiling', 'wall'], 'disc'), cat: 'UniFi APs' },
  u_e7:        { ...F('E7 (Enterprise WiFi 7)', 'E7', ['ceiling', 'wall'], 'disc'), cat: 'UniFi APs' },
  u_u6pro:     { ...F('U6 Pro', 'U6Pro', ['ceiling', 'wall'], 'disc'), cat: 'UniFi APs' },
  u_u7prowall: { ...F('U7 Pro Wall', 'U7Wall', ['wall'], 'wallap'), cat: 'UniFi APs' },
  u_u6iw:      { ...F('U6 In-Wall', 'U6IW', ['wall'], 'wallap', 5), cat: 'UniFi APs' },
  u_u6mesh:    { ...F('U6 Mesh', 'U6Mesh', ['desk', 'wall', 'ceiling'], 'tower'), cat: 'UniFi APs' },
  u_u7outdoor: { ...F('U7 Outdoor', 'U7Out', ['wall'], 'box'), cat: 'UniFi APs' },
  // Protect cameras
  u_g6bullet:  { ...F('G6 Bullet', 'G6Blt', ['wall', 'ceiling'], 'bullet'), cat: 'UniFi Cameras' },
  u_g6turret:  { ...F('G6 Turret', 'G6Trt', ['wall', 'ceiling'], 'turret'), cat: 'UniFi Cameras' },
  u_g6dome:    { ...F('G6 Dome', 'G6Dom', ['ceiling', 'wall'], 'dome'), cat: 'UniFi Cameras' },
  u_g6ptz:     { ...F('G6 PTZ', 'G6PTZ', ['wall', 'ceiling'], 'ptz'), cat: 'UniFi Cameras' },
  u_aipro:     { ...F('AI Pro', 'AIPro', ['wall', 'ceiling'], 'bullet'), cat: 'UniFi Cameras' },
  u_ai360:     { ...F('AI 360', 'AI360', ['ceiling'], 'dome'), cat: 'UniFi Cameras' },
  u_g5flex:    { ...F('G5 Flex', 'G5Flx', ['wall', 'desk'], 'turret'), cat: 'UniFi Cameras' },
  u_g6instant: { ...F('G6 Instant', 'G6Ins', ['desk', 'wall'], 'box'), cat: 'UniFi Cameras' },
  // Door access (wall-mounted, as installed in real life)
  u_g6entry:    { ...F('G6 Entry (Doorbell)', 'G6Ent', ['wall'], 'doorbell'), cat: 'UniFi Door Access' },
  u_g6proentry: { ...F('G6 Pro Entry', 'G6PEnt', ['wall'], 'doorbellpro'), cat: 'UniFi Door Access' },
  u_g4doorbell: { ...F('G4 Doorbell Pro', 'G4DB', ['wall'], 'doorbell'), cat: 'UniFi Door Access' },
  u_readerg3:   { ...F('Access Reader G3 Pro', 'RdrG3', ['wall'], 'reader'), cat: 'UniFi Door Access' },
  u_intercomview: { ...F('Intercom Viewer', 'IView', ['wall'], 'panel'), cat: 'UniFi Door Access' },
  u_accesshub:  { ...F('Access Hub', 'AHub', ['wall'], 'box', 4), cat: 'UniFi Door Access' },
  // Storage & power
  u_unvr:     { ...R('UNVR', 'UNVR', 2, 1, 1, 20, { role: 'host', sfp: 1, bays: 4, faceInsetL: 12 }), cat: 'UniFi Storage & Power' },
  u_unvrpro:  { ...R('UNVR Pro', 'UNVRP', 2, 1, 2, 20, { role: 'host', sfp: 1, bays: 7, faceInsetL: 12 }), cat: 'UniFi Storage & Power' },
  u_unaspro:  { ...R('UNAS Pro', 'UNAS', 2, 1, 2, 20, { role: 'host', sfp: 1, bays: 7, faceInsetL: 12, display: { side: 'L', w: 1.6, h: 1.0 } }), cat: 'UniFi Storage & Power' },
  u_pdupro:   { ...R('USP PDU Pro', 'PDU', 0, 0, 1, 10, { role: 'power', faceInsetR: 3, display: { side: 'R', w: 1.6, h: 0.9 }, powerDevice: true, outlets: 8 }), cat: 'UniFi Storage & Power' },
  u_unas2:    { ...F('UNAS 2', 'UNAS2', ['desk'], 'box', 1), cat: 'UniFi Storage & Power' }
};
Object.assign(DEVICE_TYPES, UNIFI_CATALOG);

// Office & furniture — computers connect to the network like any other device
const OFFICE_CATALOG = {
  o_ws:      { ...F('Workstation (desk + PC)', 'WS', ['desk'], 'workstation', 1), cat: 'Office & Furniture' },
  o_desk:    { ...F('Office Desk (60")', 'Desk', ['desk'], 'table', 0), cat: 'Office & Furniture' },
  o_chair:   { ...F('Office Chair', 'Chair', ['desk'], 'chair', 0), cat: 'Office & Furniture' },
  o_pc:      { ...F('PC Tower', 'PC', ['desk'], 'pctower', 2), cat: 'Office & Furniture' },
  o_printer: { ...F('Office Printer', 'Printer', ['desk'], 'printer', 1), cat: 'Office & Furniture' },
  o_tv:      { ...F('Wall TV 55"', 'TV', ['wall'], 'tv', 1), cat: 'Office & Furniture' }
};
Object.assign(DEVICE_TYPES, OFFICE_CATALOG);
const FLOOR_SHAPES = new Set(['person', 'table', 'workstation', 'chair', 'pctower', 'printer']);

// Starter multi-brand pack — the assistant can add anything else on demand
const BRAND_PACK = {
  // C9200L-24P-4G: 24× 1G PoE+ over two rows, then FOUR fixed 1G SFP uplinks in a
  // single row. Was modelled with two uplinks — the -4G suffix is literally the
  // uplink count, so half the fibre capacity was missing.
  b_c9200:   { ...R('Cisco Catalyst 9200L-24P-4G', 'C9200', 28, 2, 1, 16, { sfp: 4, verified: true,
    portLayout: [
      { type: 'rj', cols: 6, rows: 2, speed: SPEED.ge, poe: POE.at },
      { type: 'rj', cols: 6, rows: 2, gapBefore: 0.3, speed: SPEED.ge, poe: POE.at },
      { type: 'sfp', cols: 4, rows: 1, gapBefore: 0.5, speed: SPEED.ge, role: 'Uplink' }
    ] }), cat: 'Cisco & Meraki' },
  b_c9300:   { ...R('Cisco Catalyst 9300-48P', 'C9300', 52, 2, 1, 17, { sfp: 4,
    portLayout: [{ type: 'rj', cols: 6, rows: 2 }, { type: 'rj', cols: 6, rows: 2, gapBefore: 0.3 }, { type: 'rj', cols: 6, rows: 2, gapBefore: 0.3 }, { type: 'rj', cols: 6, rows: 2, gapBefore: 0.3 }, { type: 'sfp', cols: 2, rows: 2, gapBefore: 0.5 }] }), cat: 'Cisco & Meraki' },
  // MX85: 4 dedicated WAN (2× SFP + 2× RJ45, one of them PoE+) and 10 LAN
  // (8× RJ45 + 2× SFP), plus a management RJ45. The four SFP cages were missing
  // entirely, so the appliance had no fibre uplink path at all.
  b_mx85:    { ...R('Meraki MX85', 'MX85', 15, 1, 1, 14, { role: 'router', wan: 4, sfp: 4, verified: true,
    roleMap: { 1: 'WAN', 2: 'WAN', 3: 'WAN', 4: 'WAN', 15: 'MGMT' },
    portLayout: [
      { type: 'sfp', cols: 2, speed: SPEED.ge, role: 'WAN' },
      { type: 'rj', cols: 2, gapBefore: 0.3, speed: SPEED.ge, role: 'WAN', poe: POE.at },
      { type: 'rj', cols: 8, gapBefore: 0.5, speed: SPEED.ge },
      { type: 'sfp', cols: 2, gapBefore: 0.4, speed: SPEED.ge },
      { type: 'rj', cols: 1, gapBefore: 0.5, speed: SPEED.ge, role: 'MGMT' }
    ] }), cat: 'Cisco & Meraki' },
  b_mr46:    { ...F('Meraki MR46', 'MR46', ['ceiling', 'wall'], 'disc'), cat: 'Cisco & Meraki' },
  b_a6300:   { ...R('Aruba 6300M 48G PoE', 'A6300', 52, 2, 1, 17, { sfp: 4,
    portLayout: [{ type: 'rj', cols: 12, rows: 2 }, { type: 'rj', cols: 12, rows: 2, gapBefore: 0.35 }, { type: 'sfp', cols: 2, rows: 2, gapBefore: 0.5 }] }), cat: 'Aruba / HPE' },
  b_a1930:   { ...R('Aruba Instant On 1930 24G', 'A1930', 28, 2, 1, 12, { sfp: 4,
    portLayout: [{ type: 'rj', cols: 12, rows: 2 }, { type: 'sfp', cols: 2, rows: 2, gapBefore: 0.5 }] }), cat: 'Aruba / HPE' },
  b_ap655:   { ...F('Aruba AP-655', 'AP655', ['ceiling', 'wall'], 'disc'), cat: 'Aruba / HPE' },
  b_gs728:   { ...R('Netgear GS728TPP', 'GS728', 28, 2, 1, 12, { sfp: 4,
    portLayout: [{ type: 'rj', cols: 12, rows: 2 }, { type: 'sfp', cols: 2, rows: 2, gapBefore: 0.5 }] }), cat: 'Netgear' },
  b_wax630:  { ...F('Netgear WAX630', 'WAX630', ['ceiling', 'wall'], 'disc'), cat: 'Netgear' },
  b_er8411:  { ...R('Omada ER8411 Router', 'ER8411', 10, 1, 1, 14, { role: 'router', wan: 2, sfp: 2,
    portLayout: [{ type: 'sfp', cols: 1 }, { type: 'rj', cols: 1, gapBefore: 0.25 }, { type: 'rj', cols: 6, gapBefore: 0.5 }, { type: 'sfp', cols: 2, gapBefore: 0.5 }] }), cat: 'TP-Link Omada' },
  b_sg3452:  { ...R('Omada SG3452P', 'SG3452', 52, 2, 1, 17, { sfp: 4,
    portLayout: [{ type: 'rj', cols: 24, rows: 2 }, { type: 'sfp', cols: 2, rows: 2, gapBefore: 0.6 }] }), cat: 'TP-Link Omada' },
  b_eap670:  { ...F('Omada EAP670', 'EAP670', ['ceiling', 'wall'], 'disc'), cat: 'TP-Link Omada' },
  b_ccr2004: { ...R('MikroTik CCR2004-16G-2S+', 'CCR2004', 18, 2, 1, 12, { role: 'router', wan: 1, sfp: 2,
    portLayout: [{ type: 'rj', cols: 8, rows: 2 }, { type: 'sfp', cols: 2, rows: 1, gapBefore: 0.5 }] }), cat: 'MikroTik' },
  b_crs326:  { ...R('MikroTik CRS326-24G-2S+', 'CRS326', 26, 2, 1, 11, { sfp: 2,
    portLayout: [{ type: 'rj', cols: 12, rows: 2 }, { type: 'sfp', cols: 2, rows: 1, gapBefore: 0.5 }] }), cat: 'MikroTik' }
};
Object.assign(DEVICE_TYPES, BRAND_PACK);

// ---- Cisco / Meraki ----
// Port tables checked against the datasheets listed in SPEC_SOURCES. Cisco groups
// access ports in blocks of six and puts uplinks hard right; Meraki runs WAN on
// the left, then LAN, then LAN fibre. Counts and speeds are from the datasheet;
// spacing follows house convention.
// The public Internet, as a placeable node. A gateway's WAN port cables to it;
// everything behind that gateway is then NATed out. Modelled as a field device
// so it drops anywhere in the scene.
// The service-provider side of a building. A circuit is not "internet because a
// cable reaches a cloud" — it is a provisioned service that lands on a demarc,
// gets terminated by provider equipment (ONT for fibre, modem for cable/DSL),
// and only then hands Ethernet to the customer router's WAN port. Each link in
// that chain can be missing on a real job, so each is modelled separately.
const WAN_PACK = {
  internet: {
    label: 'Internet', short: 'WAN', uh: 0, ports: 1, rows: 1, depth: 0,
    color: 0x2f6fdb, field: true, mounts: ['desk'], shape: 'cloud',
    isInternet: true, cat: 'WAN'
  },
  // Where the provider's responsibility ends and the customer's begins. The
  // service drop from the street lands here.
  demarc: {
    label: 'Demarc / NID', short: 'Demarc', uh: 0, ports: 2, rows: 1, depth: 0,
    color: 0x8a9099, field: true, mounts: ['wall'], shape: 'box',
    isDemarc: true, cat: 'WAN'
  },
  // Fibre: the ONT terminates the optical service and outputs Ethernet.
  ont: {
    label: 'Fiber ONT', short: 'ONT', uh: 0, ports: 2, rows: 1, depth: 0,
    color: 0xe8ebef, field: true, mounts: ['wall', 'desk'], shape: 'box',
    isCpeTerm: true, service: 'fiber', cat: 'WAN'
  },
  // Coax: DOCSIS modem. Same job, different medium.
  modem: {
    label: 'Cable modem (DOCSIS)', short: 'Modem', uh: 0, ports: 2, rows: 1, depth: 0,
    color: 0x22262c, field: true, mounts: ['desk', 'wall'], shape: 'deskbox',
    isCpeTerm: true, service: 'cable', cat: 'WAN'
  }
};
Object.assign(DEVICE_TYPES, WAN_PACK);

const CISCO_PACK = {
  // --- Catalyst access switches ---
  c_c9200l48: { ...R('Catalyst 9200L-48P-4G', 'C9200-48', 52, 2, 1, 16, { sfp: 4, verified: true,
    portLayout: [
      { type: 'rj', cols: 6, rows: 2, speed: SPEED.ge, poe: POE.at },
      { type: 'rj', cols: 6, rows: 2, gapBefore: 0.3, speed: SPEED.ge, poe: POE.at },
      { type: 'rj', cols: 6, rows: 2, gapBefore: 0.3, speed: SPEED.ge, poe: POE.at },
      { type: 'rj', cols: 6, rows: 2, gapBefore: 0.3, speed: SPEED.ge, poe: POE.at },
      { type: 'sfp', cols: 4, rows: 1, gapBefore: 0.5, speed: SPEED.ge, role: 'Uplink' }
    ] }), cat: 'Cisco & Meraki' },
  c_c9300l24: { ...R('Catalyst 9300L-24P-4X', 'C9300L-24', 28, 2, 1, 17, { sfp: 4, verified: true,
    portLayout: [
      { type: 'rj', cols: 6, rows: 2, speed: SPEED.ge, poe: POE.at },
      { type: 'rj', cols: 6, rows: 2, gapBefore: 0.3, speed: SPEED.ge, poe: POE.at },
      { type: 'sfp', cols: 4, rows: 1, gapBefore: 0.5, speed: SPEED.x10, role: 'Uplink' }
    ] }), cat: 'Cisco & Meraki' },
  c_c9300l48: { ...R('Catalyst 9300L-48P-4X', 'C9300L-48', 52, 2, 1, 17, { sfp: 4, verified: true,
    portLayout: [
      { type: 'rj', cols: 6, rows: 2, speed: SPEED.ge, poe: POE.at },
      { type: 'rj', cols: 6, rows: 2, gapBefore: 0.3, speed: SPEED.ge, poe: POE.at },
      { type: 'rj', cols: 6, rows: 2, gapBefore: 0.3, speed: SPEED.ge, poe: POE.at },
      { type: 'rj', cols: 6, rows: 2, gapBefore: 0.3, speed: SPEED.ge, poe: POE.at },
      { type: 'sfp', cols: 4, rows: 1, gapBefore: 0.5, speed: SPEED.x10, role: 'Uplink' }
    ] }), cat: 'Cisco & Meraki' },

  // --- Firepower NGFW ---
  // 1010 is copper-only with two PoE+ ports; 1120/1140 add four SFP cages.
  // All three carry a separate management RJ45 alongside the data ports.
  c_fpr1010: { ...R('Firepower 1010', 'FPR1010', 9, 1, 1, 12, { role: 'router', verified: true,
    roleMap: { 1: 'WAN', 9: 'MGMT' },
    portLayout: [
      { type: 'rj', cols: 1, speed: SPEED.ge, role: 'WAN' },
      { type: 'rj', cols: 5, gapBefore: 0.4, speed: SPEED.ge },
      { type: 'rj', cols: 2, speed: SPEED.ge, poe: POE.at },
      { type: 'rj', cols: 1, gapBefore: 0.5, speed: SPEED.ge, role: 'MGMT' }
    ] }), cat: 'Cisco & Meraki' },
  c_fpr1120: { ...R('Firepower 1120', 'FPR1120', 13, 1, 1, 16, { role: 'router', sfp: 4, verified: true,
    roleMap: { 1: 'WAN', 13: 'MGMT' },
    portLayout: [
      { type: 'rj', cols: 1, speed: SPEED.ge, role: 'WAN' },
      { type: 'rj', cols: 7, gapBefore: 0.4, speed: SPEED.ge },
      { type: 'sfp', cols: 4, gapBefore: 0.5, speed: SPEED.ge },
      { type: 'rj', cols: 1, gapBefore: 0.5, speed: SPEED.ge, role: 'MGMT' }
    ] }), cat: 'Cisco & Meraki' },
  c_fpr1140: { ...R('Firepower 1140', 'FPR1140', 13, 1, 1, 16, { role: 'router', sfp: 4, verified: true,
    roleMap: { 1: 'WAN', 13: 'MGMT' },
    portLayout: [
      { type: 'rj', cols: 1, speed: SPEED.ge, role: 'WAN' },
      { type: 'rj', cols: 7, gapBefore: 0.4, speed: SPEED.ge },
      { type: 'sfp', cols: 4, gapBefore: 0.5, speed: SPEED.ge },
      { type: 'rj', cols: 1, gapBefore: 0.5, speed: SPEED.ge, role: 'MGMT' }
    ] }), cat: 'Cisco & Meraki' },

  // --- Meraki MX ---
  c_mx67: { ...R('Meraki MX67', 'MX67', 6, 1, 1, 10, { role: 'router', wan: 2, verified: true,
    roleMap: { 1: 'WAN', 2: 'WAN' },
    portLayout: [
      { type: 'rj', cols: 2, speed: SPEED.ge, role: 'WAN' },
      { type: 'rj', cols: 4, gapBefore: 0.5, speed: SPEED.ge }
    ] }), cat: 'Cisco & Meraki' },
  // MX95/105 share a port table: 2× 10G SFP+ and 2× 2.5G mGig for WAN, then
  // 4× 1G copper and 2× 10G fibre for LAN.
  c_mx95: { ...R('Meraki MX95', 'MX95', 10, 1, 1, 16, { role: 'router', wan: 4, sfp: 4, verified: true,
    roleMap: { 1: 'WAN', 2: 'WAN', 3: 'WAN', 4: 'WAN' },
    portLayout: [
      { type: 'sfp', cols: 2, speed: SPEED.x10, role: 'WAN' },
      { type: 'rj', cols: 2, gapBefore: 0.3, speed: SPEED.m25, role: 'WAN', poe: POE.at },
      { type: 'rj', cols: 4, gapBefore: 0.5, speed: SPEED.ge },
      { type: 'sfp', cols: 2, gapBefore: 0.4, speed: SPEED.x10 }
    ] }), cat: 'Cisco & Meraki' },
  c_mx105: { ...R('Meraki MX105', 'MX105', 10, 1, 1, 16, { role: 'router', wan: 4, sfp: 4, verified: true,
    roleMap: { 1: 'WAN', 2: 'WAN', 3: 'WAN', 4: 'WAN' },
    portLayout: [
      { type: 'sfp', cols: 2, speed: SPEED.x10, role: 'WAN' },
      { type: 'rj', cols: 2, gapBefore: 0.3, speed: SPEED.m25, role: 'WAN', poe: POE.at },
      { type: 'rj', cols: 4, gapBefore: 0.5, speed: SPEED.ge },
      { type: 'sfp', cols: 2, gapBefore: 0.4, speed: SPEED.x10 }
    ] }), cat: 'Cisco & Meraki' },

  // --- Meraki MS switches ---
  c_ms120_24p: { ...R('Meraki MS120-24P', 'MS120', 28, 2, 1, 12, { sfp: 4, verified: true,
    portLayout: [
      { type: 'rj', cols: 12, rows: 2, speed: SPEED.ge, poe: POE.at },
      { type: 'sfp', cols: 4, rows: 1, gapBefore: 0.5, speed: SPEED.ge, role: 'Uplink' }
    ] }), cat: 'Cisco & Meraki' },
  c_ms225_48lp: { ...R('Meraki MS225-48LP', 'MS225', 52, 2, 1, 14, { sfp: 4, verified: true,
    portLayout: [
      { type: 'rj', cols: 24, rows: 2, speed: SPEED.ge, poe: POE.at },
      { type: 'sfp', cols: 4, rows: 1, gapBefore: 0.5, speed: SPEED.x10, role: 'Uplink' }
    ] }), cat: 'Cisco & Meraki' },
  c_ms250_48: { ...R('Meraki MS250-48', 'MS250', 52, 2, 1, 16, { sfp: 4, verified: true,
    portLayout: [
      { type: 'rj', cols: 24, rows: 2, speed: SPEED.ge },
      { type: 'sfp', cols: 4, rows: 1, gapBefore: 0.5, speed: SPEED.x10, role: 'Uplink' }
    ] }), cat: 'Cisco & Meraki' },

  // --- Wireless ---
  c_c9120ax: { ...F('Catalyst 9120AX', 'C9120', ['ceiling', 'wall'], 'disc', 1, { portSpeed: SPEED.m25 }), cat: 'Cisco & Meraki' },
  c_c9130ax: { ...F('Catalyst 9130AX', 'C9130', ['ceiling', 'wall'], 'disc', 1, { portSpeed: SPEED.m5 }), cat: 'Cisco & Meraki' },
  c_mr36:    { ...F('Meraki MR36', 'MR36', ['ceiling', 'wall'], 'disc'), cat: 'Cisco & Meraki' },
  c_mr57:    { ...F('Meraki MR57', 'MR57', ['ceiling', 'wall'], 'disc', 1, { portSpeed: SPEED.m5 }), cat: 'Cisco & Meraki' },
  c_cw9164:  { ...F('Meraki CW9164', 'CW9164', ['ceiling', 'wall'], 'disc', 1, { portSpeed: SPEED.m25 }), cat: 'Cisco & Meraki' },
  c_mg21:    { ...F('Meraki MG21 (Cellular)', 'MG21', ['wall', 'ceiling'], 'box', 1), cat: 'Cisco & Meraki' }
};
Object.assign(DEVICE_TYPES, CISCO_PACK);
Object.assign(SPEC_SOURCES, {
  c_c9200l48: SPEC_SOURCES.b_c9200,
  c_c9300l24: 'https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9300-series-switches/nb-06-cat9300-ser-data-sheet-cte-en.html',
  c_c9300l48: 'https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9300-series-switches/nb-06-cat9300-ser-data-sheet-cte-en.html',
  c_fpr1010: 'https://www.cisco.com/c/en/us/support/security/firepower-1000-series/series.html',
  c_fpr1120: 'https://www.cisco.com/c/en/us/support/security/firepower-1000-series/series.html',
  c_fpr1140: 'https://www.cisco.com/c/en/us/support/security/firepower-1000-series/series.html',
  c_mx67: 'https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX67_and_MX68_Datasheet',
  c_mx95: 'https://www.rhinonetworks.com/sites/default/files/2022-02/MX95_105%20Datasheet.pdf',
  c_mx105: 'https://www.rhinonetworks.com/sites/default/files/2022-02/MX95_105%20Datasheet.pdf',
  c_ms120_24p: 'https://meraki.cisco.com/lib/pdf/meraki_datasheet_ms_family.pdf',
  c_ms225_48lp: 'https://meraki.cisco.com/lib/pdf/meraki_datasheet_ms_family.pdf',
  c_ms250_48: 'https://documentation.meraki.com/Switching/MS_-_Switches/Product_Information/Overviews_and_Datasheets/MS250_Datasheet'
});

const CABLE_COLOR_NAMES = {
  '#3b82f6': 'Blue', '#ef4444': 'Red', '#22c55e': 'Green', '#eab308': 'Yellow',
  '#f97316': 'Orange', '#a855f7': 'Purple', '#e5e7eb': 'White', '#111827': 'Black'
};

//////////////////// State ////////////////////

let state = { racks: [], devices: [], cables: [], walls: [], holes: [], links: [], ties: [], measures: [], slabs: [], stairs: [], raceways: [], customTypes: {} };

// Everything is real-scale: 1 unit = 1 inch. Floor grid squares are 1 ft.
function fmtLen(inches) {
  const ft = Math.floor(inches / 12), rem = Math.round(inches % 12);
  return rem === 0 ? `${ft}'` : `${ft}' ${rem}"`;
}
// 9'6" walls — tops meet the next level's slab (120" spacing, 6" slab).
// WALL_T is a real 2x4 partition: 3.5" stud (nominal 2x4 actual is 1.5"x3.5")
// plus 1/2" drywall each face = 4.5". The cavity a cable drops through is the
// 3.5" stud depth, which is what STUD_BAY_D below is for.
const WALL_H = 114, WALL_T = 4.5;
const STUD_D = 3.5;              // stud depth = usable wall cavity
const STUD_OC = 16;              // studs 16" on centre (24" also common)
const OUTLET_AFF = 18;           // data outlets 18" above finished floor (NC STS-1000)
const JHOOK_MAX_SPAN = 60;       // non-continuous supports max 5 ft (ANSI/TIA-569-B, BICSI)
const LEVEL_H = 120;
const SLAB_T = 6;

//////////////////// Building levels ////////////////////
// A storey of the building. `y` is finished-floor elevation, `h` the clear
// height to the underside of the deck above. Below-grade and low-clearance
// storeys are first-class citizens, not an afterthought: crawlspaces, attics
// and basements are where an enormous share of real cable actually runs, and a
// model that can't represent them can't be followed on site.
//
// `route` marks a storey you route through but don't furnish — it gets a
// reduced clear height and no ceiling grid.
const LEVELS = [
  { key: 'base',  name: 'Basement',   short: 'B',  y: -108, h: 102 },
  { key: 'crawl', name: 'Crawlspace', short: 'CS', y: -42,  h: 36, route: true },
  { key: 'l1',    name: 'Level 1',    short: '1',  y: 0,    h: WALL_H },
  { key: 'l2',    name: 'Level 2',    short: '2',  y: 120,  h: WALL_H },
  { key: 'l3',    name: 'Level 3',    short: '3',  y: 240,  h: WALL_H },
  { key: 'l4',    name: 'Level 4',    short: '4',  y: 360,  h: WALL_H },
  { key: 'attic', name: 'Attic',      short: 'A',  y: 480,  h: 84, route: true }
].sort((a, b) => a.y - b.y);

const GROUND_LEVEL = LEVELS.findIndex(l => l.key === 'l1');
let activeLevel = GROUND_LEVEL;
let showAllLevels = false;

function level() { return LEVELS[activeLevel]; }
function levelY() { return level().y; }

// Top of the deck sitting on a storey's walls — its ceiling, and the floor of
// whatever is above it.
//
// Deliberately derived from the storey's own clear height rather than by looking
// up the next entry in LEVELS. Basement and crawlspace are alternatives, not a
// stack: both are below grade, so "the next level up" from a basement is the
// crawlspace elevation, which is wrong for every real building. Wall top plus
// slab is right in all cases, and the level heights are chosen so it lands
// exactly on the next storey's floor.
function deckAbove(idx) {
  const L = LEVELS[idx === undefined ? activeLevel : idx];
  return L.y + L.h + SLAB_T;
}

// Which storey a given elevation belongs to: the highest level at or below it.
function levelIndexForY(y) {
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) if (LEVELS[i].y <= y + 0.5) idx = i;
  return idx;
}

// Undo (Ctrl/Cmd+Z) — snapshot before every mutating action
const undoStack = [];
function undoPush(snap) {
  undoStack.push(snap || serialize());
  if (undoStack.length > 60) undoStack.shift();
}
let nextId = 1;
const uid = () => nextId++;

let mode = 'select';            // select | cable | delete | rack | place
let pendingType = null;         // device type while placing
let cableDraft = null;          // {a:{deviceId,port}, waypoints:[{x,y,z}]}
let selected = null;            // {kind:'device'|'cable'|'rack', id}

// three.js object registries
const rackGroups = new Map();    // rackId -> Group
const deviceGroups = new Map();  // deviceId -> Group
const cableMeshes = new Map();   // cableId -> Mesh
const portMeshes = [];           // flat list of port hitboxes
const portLeds = [];             // per-port link LEDs (light in cable color)
const rackPlanes = [];           // invisible placement planes
const rackFrames = [];           // clickable rack frame meshes
const managerMeshes = [];        // cable-manager meshes (waypoint targets)
const wallMeshes = new Map();    // wallId -> Mesh
const holeGroups = new Map();    // holeId -> Group
const holeMeshes = [];           // raycast targets for drill holes
const tieGroups = new Map();     // tieId -> Group
const tieMeshes = [];            // raycast targets for ties
const slabMeshes = new Map();    // slabId -> Mesh (upper-floor slabs)
const stairGroups = new Map();   // stairId -> Group
const stairMeshes = [];          // raycast targets for stairs
const racewayGroups = new Map(); // racewayId -> Group
const racewayMeshes = [];        // raycast targets for raceways
const measureGroups = new Map(); // measureId -> Group
const measureHits = [];          // raycast targets for measurements
let measureStart = null;
let slabStart = null;
let roomStart = null;

//////////////////// Scene setup ////////////////////

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14181f);
scene.fog = new THREE.Fog(0x14181f, 400, 900);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 2000);
camera.position.set(85, 70, 115);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
// AgX (r160+): film-stock highlight rolloff. ACES clipped the troffer lenses
// and white gear to paper; AgX holds colour into the brightest stops, which is
// most of why the r185 build reads photographic instead of "3D app".
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Image-based lighting: gives metals/plastics realistic reflections. In r185 the
// environment reads hotter, so hold it back or every plastic bezel blows white.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;

// Post-processing: ambient occlusion + LED bloom + FXAA.
// Fully guarded — any failure falls straight back to plain rendering.
//
// The composer MUST own a multisampled target. Left to its default it allocates
// a plain render target, which silently bypasses the `antialias: true` on the
// canvas — every pass after RenderPass then works on jagged input. That is what
// made a 4" baseboard shimmer into a row of teeth at range and turned the cat6
// runs into dotted hairlines: the geometry was right, the sampling wasn't.
// HalfFloat keeps tone mapping and bloom from banding on the smooth wall areas.
let composer = null, fxaaPass = null;
try {
  const dbs = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(dbs.x, dbs.y, {
    type: THREE.HalfFloatType,
    samples: renderer.capabilities.isWebGL2 ? 4 : 0
  });
  composer = new THREE.EffectComposer(renderer, rt);
  composer.addPass(new THREE.RenderPass(scene, camera));
  // GTAO (ground-truth AO, r157+): the real contact-shadow depth SAO faked.
  // Scene units are inches, so the radius is ~1 ft of occlusion reach.
  const gtao = new THREE.GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.updateGtaoMaterial({ radius: 14, distanceExponent: 1.6, thickness: 2, scale: 1.4,
    samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
  gtao.blendIntensity = 0.9;
  composer.addPass(gtao);
  const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.2, 0.5, 0.95);
  composer.addPass(bloom);
  // OutputPass owns tone mapping + sRGB in modern three; everything before it
  // works in linear HDR, FXAA after it works on final display pixels.
  composer.addPass(new THREE.OutputPass());
  fxaaPass = new THREE.ShaderPass(THREE.FXAAShader);
  fxaaPass.material.uniforms.resolution.value.set(1 / innerWidth, 1 / innerHeight);
  composer.addPass(fxaaPass);
  composer.setSize(innerWidth, innerHeight);
  window.__gtao = gtao;
} catch (e) { console.error('composer setup failed, plain rendering:', e); composer = null; }

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.target.set(0, 32, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
controls.update();

const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x30281e, 0.35);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2e0, 0.85);
sun.position.set(120, 180, 90);
sun.castShadow = true;
// 4k map over a frustum sized to a building bay, not the whole 100 ft ground
// plane: ~0.07 in of shadow texel at room scale, which is what makes a rack leg
// meet the floor instead of hovering over a smear.
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.00022;
sun.shadow.normalBias = 0.035;
sun.shadow.radius = 1.6;
const rim = new THREE.DirectionalLight(0x5b7cff, 0.3);
rim.position.set(-100, 60, -120);
scene.add(rim);
const sc = sun.shadow.camera;
sc.left = -150; sc.right = 150; sc.top = 150; sc.bottom = -150; sc.near = 20; sc.far = 520;
scene.add(sun);
// Bounce: a room's floor and walls throw a lot of light back up under desks and
// into rack bays. Without it, every underside crushes to flat black.
const bounce = new THREE.DirectionalLight(0xd8e2f0, 0.3);
bounce.position.set(-40, -120, 60);
scene.add(bounce);

//////////////////// PBR texture helpers ////////////////////
// Everything in this app is drawn procedurally on canvases (no asset downloads,
// so the portable build stays a single folder). These turn those canvases into
// the *other* PBR channels — surfaces read as real materials only once light
// catches their micro-relief, not just their color.

// Scratch canvas -> 2D context, sized once.
function canvas2d(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// Tangent-space normal map from a grayscale height canvas (Sobel on luminance).
// `strength` is the bump depth: ~0.5 for drywall orange-peel, ~3 for tile grout.
function normalFromHeight(src, strength = 1) {
  const w = src.width, h = src.height;
  const s = src.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas2d(w);
  const og = out.getContext('2d');
  const img = og.createImageData(w, h);
  const at = (x, y) => s[((((y % h) + h) % h) * w + (((x % w) + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // central differences; tiled lookups keep the map seamless like the source
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i]     = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  og.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;   // normal/roughness stay linear — never sRGB
  t.anisotropy = 8;
  return t;
}

// Data map (roughness / metalness / AO). Same rule: linear, never sRGB.
function dataTexture(src) {
  const t = new THREE.CanvasTexture(src);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Value noise smoothed over `cell` px — the base for drywall, concrete and carpet
// grain. Returns a canvas of gray values usable as height or roughness directly.
function noiseCanvas(size, cell, lo = 0.35, hi = 0.65) {
  const c = canvas2d(size), g = c.getContext('2d');
  const n = Math.max(2, Math.round(size / cell));
  const v = [];
  for (let i = 0; i < n * n; i++) v.push(Math.random());
  // bilinear upsample of the low-res lattice, wrapping so the tile is seamless
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * n, y0 = Math.floor(fy), ty = fy - y0;
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * n, x0 = Math.floor(fx), tx = fx - x0;
      const a = v[(y0 % n) * n + (x0 % n)], b = v[(y0 % n) * n + ((x0 + 1) % n)];
      const cc = v[((y0 + 1) % n) * n + (x0 % n)], d = v[((y0 + 1) % n) * n + ((x0 + 1) % n)];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);   // smoothstep
      const val = (a + (b - a) * sx) * (1 - sy) + (cc + (d - cc) * sx) * sy;
      const px = (lo + val * (hi - lo)) * 255;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = px;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Stacks several noise octaves for grain that reads at both close and far range.
function fbmCanvas(size, cells, lo = 0.3, hi = 0.7) {
  const c = canvas2d(size), g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'overlay';
  let amp = 1;
  for (const cell of cells) {
    g.globalAlpha = amp;
    g.drawImage(noiseCanvas(size, cell, lo, hi), 0, 0, size, size);
    amp *= 0.55;
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  return c;
}

// Deterministic RNG — albedo, height and roughness must agree on which tile got
// which jitter, or the seams drift apart between channels.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Floor: 12" commercial VCT laid in a 4×4 patch that repeats across the slab.
// Real 12" tiles means the seams *are* the 1-ft scale grid the whole app runs on
// (GridHelper's 100 divisions over 1200" land on the same lines), so the floor
// reads as a real surface and as a ruler at the same time.
const FLOOR_TILE_IN = 12;
const FLOOR_TEX_TILES = 4;                              // 48" of floor per repeat
const FLOOR_REPEAT = 1200 / (FLOOR_TILE_IN * FLOOR_TEX_TILES);

function floorCanvas(p, mode) {
  const S = 1024, n = FLOOR_TEX_TILES, cell = S / n;
  const c = canvas2d(S), g = c.getContext('2d');
  const rnd = seeded(0x5eed);
  g.fillStyle = mode === 'albedo' ? p[1] : mode === 'height' ? '#c0c0c0' : '#707070';
  g.fillRect(0, 0, S, S);
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) {
      const j = rnd(), x = tx * cell, y = ty * cell;
      if (mode === 'albedo') {
        // each tile pulls toward one end of the palette — no two read identical
        g.fillStyle = j < 0.34 ? p[0] : j < 0.67 ? p[1] : p[2];
      } else if (mode === 'rough') {
        // uneven buffing: some tiles hold a polish, others are worn flat
        const v = Math.round(88 + j * 54);
        g.fillStyle = `rgb(${v},${v},${v})`;
      } else {
        g.fillStyle = '#c0c0c0';
      }
      g.fillRect(x, y, cell, cell);
    }
  }
  // VCT chips — fine mineral speckle, the thing that stops a floor looking painted
  const chips = mode === 'albedo' ? 5200 : 2600;
  for (let i = 0; i < chips; i++) {
    const x = rnd() * S, y = rnd() * S, r = 0.6 + rnd() * 1.9;
    const light = rnd() > 0.5;
    g.fillStyle = mode === 'albedo'
      ? (light ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)')
      : mode === 'rough' ? (light ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)')
      : (light ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.22)');
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // tile seams: a recessed, unpolished groove between tiles
  g.lineWidth = 2.5;
  g.strokeStyle = mode === 'albedo' ? p[3] : mode === 'rough' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.75)';
  for (let i = 0; i <= n; i++) {
    const o = i * cell;
    g.beginPath(); g.moveTo(o, 0); g.lineTo(o, S); g.stroke();
    g.beginPath(); g.moveTo(0, o); g.lineTo(S, o); g.stroke();
  }
  return c;
}

function makeFloorTexture(p) {
  p = p || ['#242b37', '#1a202a', '#11151c', 'rgba(0,0,0,0.35)'];
  const t = new THREE.CanvasTexture(floorCanvas(p, 'albedo'));
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(FLOOR_REPEAT, FLOOR_REPEAT);
  t.anisotropy = 16;
  return t;
}
// Relief and wear don't change with the color theme — build them once.
function makeFloorMaps(p) {
  const nrm = normalFromHeight(floorCanvas(p, 'height'), 2.2);
  const rgh = dataTexture(floorCanvas(p, 'rough'));
  for (const t of [nrm, rgh]) { t.repeat.set(FLOOR_REPEAT, FLOOR_REPEAT); t.anisotropy = 16; }
  return { nrm, rgh };
}
const _floorMaps = makeFloorMaps(['#242b37', '#1a202a', '#11151c', 'rgba(0,0,0,0.35)']);
const floorMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(1200, 1200),
  new THREE.MeshStandardMaterial({
    map: makeFloorTexture(),
    normalMap: _floorMaps.nrm, normalScale: new THREE.Vector2(0.45, 0.45),
    roughnessMap: _floorMaps.rgh,
    roughness: 1, metalness: 0.06, envMapIntensity: 0.4
  })
);
floorMesh.rotation.x = -Math.PI / 2;
floorMesh.receiveShadow = true;
floorMesh.userData.isFloor = true;
scene.add(floorMesh);

let grid = new THREE.GridHelper(1200, 100, 0x2c3646, 0x222a36);
grid.position.y = 0.02;
scene.add(grid);

// The work plane is what makes below-grade building possible at all. Every tool
// used to raycast against the floor mesh or an existing slab, so you could only
// draw where something already existed — which meant a basement was impossible,
// because there is nothing down there to click on yet. This invisible plane sits
// at the active storey's elevation and gives every tool a surface to hit.
const workPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(1200, 1200),
  new THREE.MeshBasicMaterial({ visible: false })
);
workPlane.rotation.x = -Math.PI / 2;
workPlane.userData = { isWorkPlane: true, isFloor: true };
scene.add(workPlane);

// A faint grid drawn at the working elevation so you can see where "here" is
// when the storey has no floor yet.
let workGrid = new THREE.GridHelper(1200, 100, 0x4da3ff, 0x2b4468);
workGrid.visible = false;
scene.add(workGrid);

//////////////////// Geometry builders ////////////////////

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.35, envMapIntensity: 0.9, ...opts }));
  }
  return matCache.get(key);
}

//////////////////// Walls & drill holes ////////////////////

// Painted drywall. The give-away on a fake wall is that it's perfectly flat —
// real board has a rolled orange-peel stipple that catches grazing light, plus
// taped seams every 48". Both live in the normal map; the albedo stays near-flat
// because paint genuinely is.
const WALL_TEX_IN = 96;                     // one texture tile covers 8 ft of wall
function wallCanvas(mode) {
  const S = 512, c = canvas2d(S), g = c.getContext('2d');
  if (mode === 'albedo') {
    g.fillStyle = '#b6bcc4'; g.fillRect(0, 0, S, S);
    const img = g.getImageData(0, 0, S, S);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 7;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  } else {
    // stipple: fine overlapping blobs are what orange-peel roller texture is
    g.drawImage(fbmCanvas(S, [7, 3], 0.44, 0.56), 0, 0);
  }
  // taped-and-mudded butt joints — a shallow rise, not a scored line
  const seam = mode === 'albedo' ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.5)';
  g.strokeStyle = seam;
  g.lineWidth = mode === 'albedo' ? 1 : 7;
  for (const x of [0, S / 2]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
  return c;
}
const wallNormal = normalFromHeight(wallCanvas('height'), 0.7);
function makeWallTexture() {
  const t = new THREE.CanvasTexture(wallCanvas('albedo'));
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
const wallMat = new THREE.MeshStandardMaterial({
  color: 0xcfd4db, map: makeWallTexture(),
  normalMap: wallNormal, normalScale: new THREE.Vector2(0.32, 0.32),
  roughness: 0.94, metalness: 0, envMapIntensity: 0.3, transparent: true, opacity: 1
});
// Vinyl-wrapped MDF base — every commercial interior has it, and its absence is
// one of those things you feel before you can name it.
// Kept deliberately matte with almost no environment response. The top edge of a
// 4" base is a sliver a few pixels tall from across a room, and a tight specular
// highlight on a sliver that size aliases into a row of teeth that MSAA cannot
// fix — MSAA resolves coverage, not shading. Real vinyl base is a low-sheen
// extrusion, so matte is both the accurate answer and the stable one.
// 4" tall × 1/8" thick — actual vinyl cove base dimensions. The thickness matters
// beyond pedantry: a thick base presents a wide horizontal top ledge that catches
// light and shimmers from across the room. At 1/8" there is barely a ledge to
// alias, which is exactly why the real product is that thin.
const BASE_H = 4, BASE_T = 0.125;
const baseboardMat = new THREE.MeshStandardMaterial({
  color: 0xe6e2da, roughness: 0.96, metalness: 0, envMapIntensity: 0.04,
  transparent: true, opacity: 1
});
// Each wall gets its own material so texture repeat can follow its real size —
// an 8 ft and a 30 ft wall must show the same size stipple, not one stretched.
// wallMat above stays the template; these are the live instances X-ray drives.
const wallMats = new Set();
function makeWallMaterial(len, h) {
  const m = wallMat.clone();
  m.map = wallMat.map.clone(); m.map.needsUpdate = true;
  m.normalMap = wallMat.normalMap.clone(); m.normalMap.needsUpdate = true;
  for (const t of [m.map, m.normalMap]) t.repeat.set(len / WALL_TEX_IN, h / WALL_TEX_IN);
  m.opacity = xrayOn ? 0.22 : 1;
  m.depthWrite = !xrayOn;
  wallMats.add(m);
  return m;
}

let xrayOn = false;
function setXray(on) {
  xrayOn = on;
  for (const m of wallMats) { m.opacity = on ? 0.22 : 1; m.depthWrite = !on; }
  baseboardMat.opacity = on ? 0.22 : 1;
  baseboardMat.depthWrite = !on;
  document.getElementById('btn-xray').classList.toggle('active', on);
}

function buildWall(w) {
  const dx = w.x2 - w.x1, dz = w.z2 - w.z1;
  const len = Math.hypot(dx, dz);
  const h = w.h || WALL_H;
  const m = new THREE.Mesh(new THREE.BoxGeometry(len, h, WALL_T), makeWallMaterial(len, h));
  m.position.set((w.x1 + w.x2) / 2, (w.y0 || 0) + h / 2, (w.z1 + w.z2) / 2);
  m.rotation.y = Math.atan2(-dz, dx);
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData = { isWall: true, wallId: w.id };
  // built-to-scale: every wall carries its length label
  const lbl = makeTextSprite(fmtLen(len), '#cfe0ff');
  lbl.position.set(0, h / 2 + 5, 0);
  m.add(lbl);
  // Baseboard down both faces, standing proud of the drywall like the real thing.
  // It deliberately neither casts nor receives: a 4" strip pressed flat against a
  // shadow-casting wall sits inside that wall's own depth range, and the shadow
  // map resolves it as a comb of acne. Trim this size contributes no meaningful
  // shadow of its own, so opting out costs nothing and removes the artifact.
  for (const s of [1, -1]) {
    const bb = new THREE.Mesh(new THREE.BoxGeometry(len, BASE_H, BASE_T), baseboardMat);
    bb.position.set(0, -h / 2 + BASE_H / 2, s * (WALL_T / 2 + BASE_T / 2));
    bb.castShadow = false; bb.receiveShadow = false;
    m.add(bb);
  }
  scene.add(m);
  wallMeshes.set(w.id, m);
  scheduleLevelVis();
  scheduleReroute();
  return m;
}

function buildHole(h) {
  const g = new THREE.Group();
  g.position.set(h.x, h.y, h.z);
  const n = new THREE.Vector3(h.nx || 0, h.ny || 0, h.nz || 0).normalize();
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  const r = h.r || 0.9, t = h.t || WALL_T;
  const bore = new THREE.Mesh(new THREE.CylinderGeometry(r, r, t + 1.6, 18), mat(0x05070a, { roughness: 0.9 }));
  bore.rotation.x = Math.PI / 2;
  bore.userData = { isHole: true, holeId: h.id };
  g.add(bore); holeMeshes.push(bore);
  for (const s of [1, -1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.25, 0.14, 8, 26),
      new THREE.MeshStandardMaterial({ color: 0xeab308, emissive: 0x8a6a05, emissiveIntensity: 0.6, roughness: 0.4 }));
    ring.position.z = s * (t / 2 + 0.5);
    ring.userData = { isHole: true, holeId: h.id };
    g.add(ring); holeMeshes.push(ring);
  }
  scene.add(g);
  holeGroups.set(h.id, g);
  scheduleReroute();
  return g;
}

function deleteHole(id) {
  const g = holeGroups.get(id);
  if (g) { scene.remove(g); holeGroups.delete(id); }
  removeFromArr(holeMeshes, m => m.userData.holeId === id);
  removeFromArr(state.holes, h => h.id === id);
  scheduleReroute();
}

function deleteWall(id) {
  for (const h of state.holes.filter(h => h.wallId === id)) deleteHole(h.id);
  const m = wallMeshes.get(id);
  if (m) {
    scene.remove(m);
    m.geometry.dispose();
    wallMats.delete(m.material);
    if (m.material.map) m.material.map.dispose();
    if (m.material.normalMap) m.material.normalMap.dispose();
    m.material.dispose();
    wallMeshes.delete(id);
  }
  removeFromArr(state.walls, w => w.id === id);
  scheduleReroute();
}

//////////////////// Floors (slabs), measurements, text labels ////////////////////

function makeTextSprite(text, color = '#ffd23e') {
  const c = document.createElement('canvas');
  let g = c.getContext('2d');
  g.font = '600 48px -apple-system, "Segoe UI", sans-serif';
  const w = Math.ceil(g.measureText(text).width) + 36;
  c.width = w; c.height = 72;
  g = c.getContext('2d');
  g.font = '600 48px -apple-system, "Segoe UI", sans-serif';
  g.fillStyle = 'rgba(10,13,18,0.82)';
  g.beginPath();
  g.roundRect ? g.roundRect(0, 0, w, 72, 18) : g.rect(0, 0, w, 72);
  g.fill();
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 18, 39);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
  s.scale.set(w / 11, 6.5, 1);
  return s;
}

function makeSlabTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#8d939c'; g.fillRect(0, 0, 512, 512);
  const img = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(0,0,0,0.10)'; // concrete control joints
  for (let i = 0; i <= 512; i += 256) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  return t;
}
const slabMat = new THREE.MeshStandardMaterial({ color: 0xb9bec7, map: makeSlabTexture(), roughness: 0.93, metalness: 0.02, envMapIntensity: 0.3 });

// The underside of a slab is a room's ceiling, and in every commercial building
// that means a 24"×24" lay-in grid — fissured mineral tile in a white tee bar.
// Modelling it is what stops the "floating concrete lid" look from below.
const CEIL_TILE_IN = 24;
function ceilingCanvas(mode) {
  const S = 512, n = 2, cell = S / n;             // 2×2 tiles = 48" per repeat
  const c = canvas2d(S), g = c.getContext('2d');
  if (mode === 'albedo') {
    g.fillStyle = '#eceae4'; g.fillRect(0, 0, S, S);
    g.globalAlpha = 0.5; g.drawImage(fbmCanvas(S, [5, 2], 0.42, 0.58), 0, 0); g.globalAlpha = 1;
    // fissures — the irregular pinholes and worm tracks pressed into mineral tile
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(150,148,140,${0.10 + Math.random() * 0.18})`;
      g.beginPath();
      g.ellipse(Math.random() * S, Math.random() * S, 0.6 + Math.random() * 2.4,
        0.5 + Math.random(), Math.random() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    g.fillStyle = '#b4b4b4'; g.fillRect(0, 0, S, S);
    g.globalAlpha = 0.6; g.drawImage(fbmCanvas(S, [5, 2], 0.4, 0.6), 0, 0); g.globalAlpha = 1;
  }
  // tee-bar grid: tiles sit recessed below the rails, so the grid is the high line
  g.strokeStyle = mode === 'albedo' ? '#f6f6f4' : '#ffffff';
  g.lineWidth = mode === 'albedo' ? 5 : 6;
  for (let i = 0; i <= n; i++) {
    const o = i * cell;
    g.beginPath(); g.moveTo(o, 0); g.lineTo(o, S); g.stroke();
    g.beginPath(); g.moveTo(0, o); g.lineTo(S, o); g.stroke();
  }
  return c;
}
let _ceilMat = null;
function ceilingMaterial() {
  if (_ceilMat) return _ceilMat;
  const alb = new THREE.CanvasTexture(ceilingCanvas('albedo'));
  alb.colorSpace = THREE.SRGBColorSpace;
  alb.wrapS = alb.wrapT = THREE.RepeatWrapping;
  alb.anisotropy = 8;
  const nrm = normalFromHeight(ceilingCanvas('height'), 1.6);
  _ceilMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: alb, normalMap: nrm, normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 0.97, metalness: 0, envMapIntensity: 0.25
  });
  return _ceilMat;
}

// ---- ceiling troffers ----
// Every commercial lay-in ceiling has 2×4 fluorescent/LED troffers on an 8 ft
// grid. The lens is an emissive quad (bloom picks it up); the light it throws is
// a RectAreaLight, which is what makes desks and the VCT floor pick up soft
// rectangular reflections instead of looking lit "from nowhere". Area lights are
// per-fragment expensive, so only the first MAX_AREA_LIGHTS slabs get real
// lights — the rest keep the glowing lenses, which carry most of the look.
const MAX_AREA_LIGHTS = 6;
let areaLightCount = 0;
const trofferLens = new THREE.MeshStandardMaterial({
  color: 0xf4f7fa, emissive: 0xf0f4f8, emissiveIntensity: 2.2, roughness: 0.4
});
const trofferFrame = new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.5, metalness: 0.35 });

function addTroffers(slabMesh, wX, wZ) {
  if (wX < 60 || wZ < 60) return;                 // closets don't get fixtures
  const yUnder = -3.06;                            // just proud of the tile plane
  const nx = Math.max(1, Math.round(wX / 96)), nz = Math.max(1, Math.round(wZ / 96));
  let lit = false;
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const lx = -wX / 2 + (ix + 0.5) * (wX / nx);
      const lz = -wZ / 2 + (iz + 0.5) * (wZ / nz);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(49, 0.5, 25), trofferFrame);
      frame.position.set(lx, yUnder + 0.2, lz);
      slabMesh.add(frame);
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(46, 22), trofferLens);
      lens.rotation.x = Math.PI / 2;               // facing down
      lens.position.set(lx, yUnder - 0.06, lz);
      slabMesh.add(lens);
    }
  }
  // one area light per slab, centred — enough for the reflection read
  if (areaLightCount < MAX_AREA_LIGHTS) {
    const area = new THREE.RectAreaLight(0xf5f8ff, 3.5, Math.min(wX * 0.6, 200), Math.min(wZ * 0.6, 140));
    area.position.set(0, yUnder - 0.4, 0);
    area.lookAt(0, -100, 0);                       // straight down, local space
    slabMesh.add(area);
    slabMesh.userData.hasAreaLight = true;
    areaLightCount++;
    lit = true;
  }
  slabMesh.userData.hasTroffers = true;
  return lit;
}

function buildSlab(s) {
  const wX = Math.abs(s.x2 - s.x1), wZ = Math.abs(s.z2 - s.z1);
  // BoxGeometry material order is +x,-x,+y,-y,+z,-z — index 3 is the underside,
  // the face people actually stand under and look at
  const ceil = ceilingMaterial().clone();
  ceil.map = ceilingMaterial().map.clone();
  ceil.normalMap = ceilingMaterial().normalMap.clone();
  for (const t of [ceil.map, ceil.normalMap]) {
    t.needsUpdate = true;
    t.repeat.set(Math.max(wX, 1) / (CEIL_TILE_IN * 2), Math.max(wZ, 1) / (CEIL_TILE_IN * 2));
  }
  const faces = [slabMat, slabMat, slabMat, ceil, slabMat, slabMat];
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(wX, 1), 6, Math.max(wZ, 1)), faces);
  m.position.set((s.x1 + s.x2) / 2, s.y - 3, (s.z1 + s.z2) / 2);
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData = { isSlab: true, slabId: s.id, topY: s.y };
  addTroffers(m, Math.max(wX, 1), Math.max(wZ, 1));
  scene.add(m);
  slabMeshes.set(s.id, m);
  scheduleLevelVis();
  scheduleReroute();
  return m;
}
function buildRoom(x1, z1, x2, z2, y0) {
  undoPush();
  // Wall height comes from the storey being built on, so a crawlspace gets 3 ft
  // of clearance and a basement gets 8'6" — not one hardcoded 9'6" everywhere.
  const L = LEVELS[levelIndexForY(y0)];
  const wallH = L.h;
  const corners = [[x1, z1], [x2, z1], [x2, z2], [x1, z2], [x1, z1]];
  for (let i = 0; i < 4; i++) {
    const w = { id: uid(), x1: corners[i][0], z1: corners[i][1], x2: corners[i + 1][0], z2: corners[i + 1][1], h: wallH, y0 };
    state.walls.push(w);
    buildWall(w);
  }
  const ceilY = deckAbove(levelIndexForY(y0));
  const ceil = { id: uid(), x1, z1, x2, z2, y: ceilY };
  state.slabs.push(ceil);
  buildSlab(ceil);
  applyLevelVisibility();
  setStatus(`${L.name} room: ${fmtLen(Math.abs(x2 - x1))} × ${fmtLen(Math.abs(z2 - z1))}, ${fmtLen(wallH)} clear, ceiling at ${fmtLen(ceilY)}. X-ray (X) sees inside; the ceiling doubles as the floor above.`);
}

//////////////////// Raceways: conduit, tray, surface raceway, J-hook ////////////////////
// The pathway is a first-class object, not an incidental waypoint. On a real job
// the raceway is designed first and the cables are pulled into it afterwards,
// and its capacity is a hard constraint — you cannot will a 49th cable into a
// 1" EMT. Modelling fill is the difference between a drawing that looks right
// and one a contractor can actually order material from.
//
// Inside diameters are the real EMT figures from NEC Chapter 9, Table 4 — note
// these are EMT specifically, not rigid (RMC), whose IDs differ by enough at the
// larger trade sizes to change how many cables fit. Getting 3" wrong by using
// the RMC figure costs you ~10 cables of capacity on paper.
const RACEWAY_TYPES = {
  emt050:  { label: '½" EMT',            kind: 'conduit', id: 0.622, round: true },
  emt075:  { label: '¾" EMT',            kind: 'conduit', id: 0.824, round: true },
  emt100:  { label: '1" EMT',            kind: 'conduit', id: 1.049, round: true },
  emt125:  { label: '1¼" EMT',           kind: 'conduit', id: 1.380, round: true },
  emt150:  { label: '1½" EMT',           kind: 'conduit', id: 1.610, round: true },
  emt200:  { label: '2" EMT',            kind: 'conduit', id: 2.067, round: true },
  emt250:  { label: '2½" EMT',           kind: 'conduit', id: 2.731, round: true },
  emt300:  { label: '3" EMT',            kind: 'conduit', id: 3.356, round: true },
  emt350:  { label: '3½" EMT',           kind: 'conduit', id: 3.834, round: true },
  emt400:  { label: '4" EMT',            kind: 'conduit', id: 4.334, round: true },
  tray06:  { label: '6" cable tray',     kind: 'tray', w: 6,  d: 4 },
  tray12:  { label: '12" cable tray',    kind: 'tray', w: 12, d: 4 },
  tray24:  { label: '24" cable tray',    kind: 'tray', w: 24, d: 6 },
  ras075:  { label: '¾" surface raceway',kind: 'surface', w: 0.75, d: 0.5 },
  ras150:  { label: '1½" surface raceway',kind: 'surface', w: 1.5, d: 0.75 },
  jhook:   { label: 'J-hook (bridle ring)', kind: 'hook', w: 2, d: 2 },

  // ---- outside plant / underground ----
  // Buried runs sit at a trench depth instead of the plenum. NEC 300.5 puts
  // rigid nonmetallic (PVC) conduit at 18" cover and unprotected direct burial
  // at 24"; warning tape goes ~12" below grade so the next person with a shovel
  // finds it before the backhoe does.
  pvc100:  { label: '1" PVC (buried)',   kind: 'conduit', id: 1.049, burial: true, depth: 18 },
  pvc200:  { label: '2" PVC (buried)',   kind: 'conduit', id: 2.067, burial: true, depth: 18 },
  pvc300:  { label: '3" PVC (buried)',   kind: 'conduit', id: 3.068, burial: true, depth: 18 },
  pvc400:  { label: '4" PVC (buried)',   kind: 'conduit', id: 4.026, burial: true, depth: 18 },
  burial:  { label: 'Direct burial (no conduit)', kind: 'tray', w: 3, d: 2, burial: true, depth: 24 },

  // ---- vertical pathways ----
  // A riser carries backbone between floors through a sleeved, firestopped core.
  riser400: { label: '4" riser sleeve', kind: 'conduit', id: 4.026, vertical: true },
  // A drop inside a stud bay, ceiling down to an outlet box.
  wallbay:  { label: 'Wall cavity drop', kind: 'tray', w: 3.5, d: 3.5, vertical: true, inWall: true }
};

// Usable cross-section, in². Conduit is limited by NEC Chapter 9 Table 1: 53%
// for one conductor, 31% for two, 40% for three or more — the two-cable case
// really is the tightest, because of the wedge of dead space a pair leaves.
// Tray and surface raceway are governed by a 50% fill convention instead.
function racewayCapacityIn2(type, cableCount) {
  const t = RACEWAY_TYPES[type];
  if (!t) return 0;
  if (t.kind === 'conduit') {
    const area = Math.PI * (t.id / 2) ** 2;
    const pct = cableCount <= 1 ? 0.53 : cableCount === 2 ? 0.31 : 0.40;
    return area * pct;
  }
  if (t.kind === 'hook') return Math.PI * 1.0 ** 2;      // a hook just carries a bundle
  return t.w * t.d * 0.5;
}

function cableAreaIn2(n) { return n * Math.PI * (CABLE_R + 0.005) ** 2; }

// Everything a fill readout needs. `over` is the thing that matters: it means
// the design is not buildable as drawn.
function racewayFill(rw) {
  const n = (rw.cables || []).length;
  const cap = racewayCapacityIn2(rw.type, n);
  const used = cableAreaIn2(n);
  const pct = cap > 0 ? (used / cap) * 100 : 0;
  const t = RACEWAY_TYPES[rw.type] || {};
  // how many more of the same cable fit before the limit bites
  let room = 0;
  while (cableAreaIn2(n + room + 1) <= racewayCapacityIn2(rw.type, n + room + 1)) {
    room++;
    if (room > 999) break;
  }
  return { count: n, capacityIn2: cap, usedIn2: used, pct, over: pct > 100, room, label: t.label || rw.type };
}

// Where a pathway sits, by the space it's installed in. Installers don't put
// everything at one height: plenum runs ride just under the deck above a drop
// ceiling, attic/crawlspace runs lie on the joists, buried runs sit at trench
// depth below grade. Getting this right is most of why a model reads as real.
function pathwayY(t) {
  if (t && t.burial) return -(t.depth || 18);              // below grade, NEC cover
  const L = level();
  if (L.route) return levelY() + 4;                        // attic / crawlspace: on the joists
  return levelY() + L.h - 6;                               // plenum above the drop ceiling
}

function racewayPath(rw) {
  return [new THREE.Vector3(rw.x1, rw.y1, rw.z1), new THREE.Vector3(rw.x2, rw.y2, rw.z2)];
}

// Packing slot for cable `i` of `n` inside the raceway cross-section — this is
// what lets 200 runs share one bore and still each come out somewhere different.
function racewaySlot(rw, i, n) {
  const t = RACEWAY_TYPES[rw.type] || {};
  if (t.kind === 'tray' || t.kind === 'surface') {
    // trays fill in layers, bottom-up, the way cable actually lies in one
    const perRow = Math.max(1, Math.floor((t.w - 0.3) / (CABLE_R * 2.2)));
    const row = Math.floor(i / perRow), col = i % perRow;
    const x = -t.w / 2 + 0.15 + (col + 0.5) * (CABLE_R * 2.2);
    const y = -t.d / 2 + 0.15 + (row + 0.5) * (CABLE_R * 2.2);
    return [x, y];
  }
  // round conduit: concentric rings
  if (n <= 1) return [0, 0];
  let idx = i, ring = 0, cap = 1;
  while (idx >= cap) { idx -= cap; ring++; cap = ring * 6; }
  const a = (idx / cap) * Math.PI * 2 + ring * 0.4;
  const r = CABLE_R * 2.15 * ring;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

function buildRaceway(rw) {
  const g = new THREE.Group();
  const [a, b] = racewayPath(rw);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const len = a.distanceTo(b);
  g.position.copy(mid);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
  const t = RACEWAY_TYPES[rw.type] || RACEWAY_TYPES.emt100;
  const fill = racewayFill(rw);
  // overfilled pathways read red — a design error you can see across the room
  const galv = fill.over
    ? mat(0xd23b3b, { metalness: 0.5, roughness: 0.45, emissive: 0x3a0c0c, emissiveIntensity: 0.5 })
    : mat(0xa8b0ba, { metalness: 0.82, roughness: 0.36 });
  if (t.kind === 'conduit') {
    const outer = t.id + 0.12;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(outer / 2, outer / 2, len, 20, 1, true), galv);
    tube.rotation.x = Math.PI / 2;
    tube.material.side = THREE.DoubleSide;
    tube.userData = { isRaceway: true, racewayId: rw.id };
    tube.castShadow = true;
    g.add(tube); racewayMeshes.push(tube);
  } else if (t.kind === 'hook') {
    const hook = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.09, 8, 20, Math.PI * 1.35), galv);
    hook.rotation.y = Math.PI / 2;
    hook.userData = { isRaceway: true, racewayId: rw.id };
    g.add(hook); racewayMeshes.push(hook);
  } else {
    // tray / surface raceway: a U-channel
    const wall = 0.1;
    const base = new THREE.Mesh(new THREE.BoxGeometry(t.w, wall, len), galv);
    base.position.y = -t.d / 2;
    base.userData = { isRaceway: true, racewayId: rw.id };
    base.castShadow = true;
    g.add(base); racewayMeshes.push(base);
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(wall, t.d, len), galv);
      side.position.set(s * t.w / 2, 0, 0);
      side.userData = { isRaceway: true, racewayId: rw.id };
      side.castShadow = true;
      g.add(side); racewayMeshes.push(side);
    }
  }
  // fill label, so capacity is visible without clicking anything
  const lbl = makeTextSprite(`${fill.label} · ${fill.pct.toFixed(0)}% · ${fill.count} cables`,
    fill.over ? '#ff6b6b' : '#cfe0ff');
  lbl.position.set(0, (t.kind === 'conduit' ? t.id / 2 : t.d / 2) + 2.5, 0);
  g.add(lbl);
  scene.add(g);
  racewayGroups.set(rw.id, g);
  collidersDirty = true;
  scheduleLevelVis();
  return g;
}

function rebuildRaceway(rw) {
  const g = racewayGroups.get(rw.id);
  if (g) {
    scene.remove(g);
    g.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    racewayGroups.delete(rw.id);
  }
  removeFromArr(racewayMeshes, m => m.userData.racewayId === rw.id);
  buildRaceway(rw);
}

function deleteRaceway(id) {
  const g = racewayGroups.get(id);
  if (g) {
    scene.remove(g);
    g.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    racewayGroups.delete(id);
  }
  removeFromArr(racewayMeshes, m => m.userData.racewayId === id);
  removeFromArr(state.raceways, r => r.id === id);
  // cables pulled through it fall back to their own routing
  for (const c of state.cables) {
    if (c.raceways && c.raceways.includes(id)) {
      c.raceways = c.raceways.filter(x => x !== id);
      rebuildCable(c);
    }
  }
  scheduleReroute();
}

// Pull a cable into a raceway: it takes the next free slot and follows the
// pathway end to end.
function pullIntoRaceway(cable, rw) {
  rw.cables = rw.cables || [];
  if (!rw.cables.includes(cable.id)) rw.cables.push(cable.id);
  cable.raceways = cable.raceways || [];
  if (!cable.raceways.includes(rw.id)) cable.raceways.push(rw.id);
  rebuildRaceway(rw);
  rebuildCable(cable);
  return racewayFill(rw);
}

// Guide points that carry a cable through every raceway it's pulled into, in
// its own slot. Entry and exit are separate points so the run enters the mouth
// of the pathway rather than teleporting to the middle of it.
function racewayGuide(cable) {
  const pts = [];
  for (const id of cable.raceways || []) {
    const rw = (state.raceways || []).find(r => r.id === id);
    if (!rw) continue;
    const [a, b] = racewayPath(rw);
    const dir = b.clone().sub(a).normalize();
    const u = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const ax = new THREE.Vector3().crossVectors(dir, u).normalize();
    const ay = new THREE.Vector3().crossVectors(dir, ax).normalize();
    const idx = (rw.cables || []).indexOf(cable.id);
    const [sx, sy] = racewaySlot(rw, Math.max(0, idx), (rw.cables || []).length);
    const off = ax.clone().multiplyScalar(sx).add(ay.clone().multiplyScalar(sy));
    pts.push(a.clone().add(off), b.clone().add(off));
  }
  return pts;
}

//////////////////// Stairs ////////////////////
// Rise and run come from the building code every real stair is built to
// (IRC R311.7): max 7¾" rise, min 10" tread. Given a floor-to-floor height the
// tread count falls out of the max rise, which is exactly how a carpenter lays
// one out — and it means a stair drawn here has the real footprint, so you can
// see whether it actually fits the room before anyone frames it.
const STAIR_MAX_RISE = 7.75, STAIR_MIN_TREAD = 10, STAIR_W = 36;

function stairGeometry(totalRise) {
  const steps = Math.max(1, Math.ceil(totalRise / STAIR_MAX_RISE));
  const rise = totalRise / steps;
  const tread = Math.max(STAIR_MIN_TREAD, 11);
  return { steps, rise, tread, run: steps * tread };
}

function buildStair(st) {
  const g = new THREE.Group();
  g.position.set(st.x, st.y0, st.z);
  g.rotation.y = st.rotY || 0;
  const { steps, rise, tread } = stairGeometry(st.rise);
  const wood = mat(0x8a7359, { roughness: 0.62, metalness: 0 });
  const riserM = mat(0xe8e5df, { roughness: 0.7, metalness: 0 });
  const w = st.w || STAIR_W;
  for (let i = 0; i < steps; i++) {
    const z = i * tread;
    const t = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, tread + 1), wood);
    t.position.set(0, (i + 1) * rise - 0.55, z + tread / 2);
    t.castShadow = true; t.receiveShadow = true;
    t.userData = { isStair: true, stairId: st.id, isStairTread: true };
    g.add(t); stairMeshes.push(t);
    const r = new THREE.Mesh(new THREE.BoxGeometry(w, rise, 0.8), riserM);
    r.position.set(0, (i + 0.5) * rise, z);
    r.receiveShadow = true;
    r.userData = { isStair: true, stairId: st.id };
    g.add(r); stairMeshes.push(r);
  }
  // stringers either side
  for (const s of [-1, 1]) {
    const str = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, steps * tread), mat(0x4a4038, { roughness: 0.7 }));
    str.position.set(s * (w / 2 + 0.6), st.rise / 2, (steps * tread) / 2);
    str.rotation.x = -Math.atan2(st.rise, steps * tread);
    str.userData = { isStair: true, stairId: st.id };
    g.add(str); stairMeshes.push(str);
  }
  scene.add(g);
  stairGroups.set(st.id, g);
  collidersDirty = true;
  scheduleLevelVis();
  return g;
}

function deleteStair(id) {
  const g = stairGroups.get(id);
  if (g) {
    scene.remove(g);
    g.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    stairGroups.delete(id);
  }
  removeFromArr(stairMeshes, m => m.userData.stairId === id);
  removeFromArr(state.stairs, s => s.id === id);
  scheduleReroute();
}

// Height of any stair tread under (x,z) — this is what lets walk mode climb.
function stairHeightAt(x, z, belowY) {
  let best = -Infinity;
  for (const st of state.stairs || []) {
    const { steps, rise, tread } = stairGeometry(st.rise);
    // into the stair's local frame
    const dx = x - st.x, dz = z - st.z;
    const c = Math.cos(-(st.rotY || 0)), s = Math.sin(-(st.rotY || 0));
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const w = st.w || STAIR_W;
    if (Math.abs(lx) > w / 2 + 2 || lz < -2 || lz > steps * tread + 2) continue;
    const step = Math.min(steps, Math.max(0, Math.ceil(lz / tread)));
    const y = st.y0 + step * rise;
    if (y <= belowY + 0.5 && y > best) best = y;
  }
  return best;
}

//////////////////// Level switching & visibility ////////////////////
// Every building tool works one storey at a time and hides what's above it —
// Revit, Homestyler and the Sims all do this for the same reason: from outside,
// the storey above is a lid you cannot see or click past. Below stays visible so
// you can line a riser up with the floor underneath.

function objectLevel(o) {
  const u = o.userData || {};
  if (u.isWall) { const w = state.walls.find(x => x.id === u.wallId); return levelIndexForY(w ? (w.y0 || 0) : 0); }
  if (u.isSlab) { const s = state.slabs.find(x => x.id === u.slabId); return levelIndexForY(s ? s.y : 0); }
  return null;
}

function applyLevelVisibility() {
  const top = showAllLevels ? LEVELS.length - 1 : activeLevel;
  for (const [id, m] of wallMeshes) {
    const w = state.walls.find(x => x.id === id);
    m.visible = levelIndexForY(w ? (w.y0 || 0) : 0) <= top;
  }
  for (const [id, m] of slabMeshes) {
    const s = state.slabs.find(x => x.id === id);
    // a slab at the active storey's own elevation is its floor, so it stays;
    // the one overhead belongs to the storey above and gets cut away
    m.visible = levelIndexForY(s ? s.y : 0) <= top;
  }
  for (const [id, g] of deviceGroups) {
    const d = deviceById(id);
    if (!d) continue;
    const y = d.mount === 'wall' ? (d.y || 0) : (d.y0 !== undefined ? d.y0 : (rackById(d.rackId) || {}).y0 || 0);
    g.visible = levelIndexForY(y) <= top;
  }
  for (const [id, g] of rackGroups) {
    const r = rackById(id);
    g.visible = levelIndexForY(r ? (r.y0 || 0) : 0) <= top;
  }
  for (const [id, g] of stairGroups) {
    const st = (state.stairs || []).find(x => x.id === id);
    g.visible = levelIndexForY(st ? st.y0 : 0) <= top;
  }
  for (const [, m] of cableMeshes) m.visible = true;   // runs cross storeys by nature
  // grade is a lid too when you're working underneath it
  const below = levelY() < -0.5;
  floorMesh.visible = !below || showAllLevels;
  grid.visible = floorMesh.visible;
  workPlane.position.y = levelY();
  workGrid.position.y = levelY() + 0.05;
  workGrid.visible = below || (level().route === true);
  updateLevelUI();
}

// Coalesced to one pass per tick — restoring a 200-wall project would otherwise
// re-scan every object once per wall.
let _levelVisQueued = false;
function scheduleLevelVis() {
  if (_levelVisQueued) return;
  _levelVisQueued = true;
  Promise.resolve().then(() => { _levelVisQueued = false; applyLevelVisibility(); });
}

function setLevel(i) {
  activeLevel = Math.max(0, Math.min(LEVELS.length - 1, i));
  applyLevelVisibility();
  const L = level();
  setStatus(`${L.name} — floor at ${fmtLen(L.y)}, ${fmtLen(L.h)} clear.` +
    (L.route ? ' Route-only storey: low clearance, no ceiling grid — this is where the wire actually goes.' : '') +
    ' Storeys above are hidden so you can see in; [ and ] change level.');
}

function updateLevelUI() {
  const sel = document.getElementById('level-sel');
  if (sel && sel.value !== String(activeLevel)) sel.value = String(activeLevel);
  const b = document.getElementById('btn-alllevels');
  if (b) b.classList.toggle('active', showAllLevels);
}

function deleteSlab(id) {
  const m = slabMeshes.get(id);
  if (m) {
    if (m.userData.hasAreaLight) areaLightCount--;   // free the slot
    scene.remove(m); m.geometry.dispose(); slabMeshes.delete(id);
  }
  removeFromArr(state.slabs, s => s.id === id);
  scheduleReroute();
}
// Drawing targets: the floors you can currently see, plus the work plane so a
// storey with nothing built on it yet is still clickable.
//
// Hidden floors are excluded explicitly rather than relying on the raycaster to
// respect `visible` — it does not. Without this, building a basement is
// impossible: the ray from the camera reaches grade (y=0) long before the work
// plane at -108, so every click would snap back to the ground floor.
function groundTargets() {
  const t = [];
  if (floorMesh.visible) t.push(floorMesh);
  for (const m of slabMeshes.values()) if (m.visible) t.push(m);
  t.push(workPlane);
  return t;
}
function groundYFromHit(hit) {
  if (hit.object.userData.isSlab) return hit.object.userData.topY;
  if (hit.object.userData.isWorkPlane) return levelY();
  return 0;
}

// Highest walkable surface at (x,z) at or below `belowY`.
//
// This used to start at 0 and never return anything lower, which quietly made
// basements impossible: you could place a slab at -108 but you would still stand
// on grade and cables would still bottom out at zero. Grade is now just another
// surface, and it only counts where the ground hasn't been excavated.
function groundAt(x, z, belowY) {
  let g = -Infinity;
  for (const s of state.slabs || []) {
    const x1 = Math.min(s.x1, s.x2) - 2, x2 = Math.max(s.x1, s.x2) + 2;
    const z1 = Math.min(s.z1, s.z2) - 2, z2 = Math.max(s.z1, s.z2) + 2;
    if (x >= x1 && x <= x2 && z >= z1 && z <= z2 && s.y <= belowY + 0.5 && s.y > g) g = s.y;
  }
  // grade counts unless we're inside an excavation (a slab below zero here)
  if (belowY >= -0.5 && !excavatedAt(x, z)) g = Math.max(g, 0);
  return g === -Infinity ? 0 : g;
}

// True where a below-grade slab exists — i.e. the ground has been dug out, so
// grade is a hole rather than a floor.
function excavatedAt(x, z) {
  for (const s of state.slabs || []) {
    if (s.y >= -0.5) continue;
    const x1 = Math.min(s.x1, s.x2), x2 = Math.max(s.x1, s.x2);
    const z1 = Math.min(s.z1, s.z2), z2 = Math.max(s.z1, s.z2);
    if (x >= x1 && x <= x2 && z >= z1 && z <= z2) return true;
  }
  return false;
}

function buildMeasure(m) {
  const g = new THREE.Group();
  const a = new THREE.Vector3(m.ax, m.ay, m.az), b = new THREE.Vector3(m.bx, m.by, m.bz);
  const dotGeo = new THREE.SphereGeometry(0.9, 10, 10);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffd23e });
  for (const p of [a, b]) {
    const d = new THREE.Mesh(dotGeo, dotMat);
    d.position.copy(p);
    d.userData = { isMeasure: true, measureId: m.id };
    g.add(d); measureHits.push(d);
  }
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([a, b]),
    new THREE.LineDashedMaterial({ color: 0xffd23e, dashSize: 2.2, gapSize: 1.1 }));
  line.computeLineDistances();
  g.add(line);
  const lbl = makeTextSprite(fmtLen(a.distanceTo(b)));
  lbl.position.copy(a).lerp(b, 0.5);
  lbl.position.y += 4;
  lbl.userData = { isMeasure: true, measureId: m.id };
  g.add(lbl); measureHits.push(lbl);
  scene.add(g);
  measureGroups.set(m.id, g);
  return g;
}
function deleteMeasure(id) {
  const g = measureGroups.get(id);
  if (g) { scene.remove(g); measureGroups.delete(id); }
  removeFromArr(measureHits, o => o.userData.measureId === id);
  removeFromArr(state.measures, mm => mm.id === id);
}

let measureLine = null;
function updatePreviewMeasure(p) {
  const geo = new THREE.BufferGeometry().setFromPoints([measureStart, p]);
  if (measureLine) { measureLine.geometry.dispose(); measureLine.geometry = geo; }
  else {
    measureLine = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0xffd23e, dashSize: 2, gapSize: 1 }));
    scene.add(measureLine);
  }
  measureLine.computeLineDistances();
}
function clearMeasurePreview() {
  if (measureLine) { scene.remove(measureLine); measureLine.geometry.dispose(); measureLine = null; }
}

let _railTex = null;
function getRailTexture() {
  if (_railTex) return _railTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g2 = c.getContext('2d');
  const grad = g2.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, '#1d232d'); grad.addColorStop(0.5, '#2b3442'); grad.addColorStop(1, '#1d232d');
  g2.fillStyle = grad; g2.fillRect(0, 0, 64, 64);
  g2.fillStyle = '#07090d';
  for (const y of [4, 25, 46]) g2.fillRect(23, y, 18, 14); // 3 square holes per U
  _railTex = new THREE.CanvasTexture(c);
  _railTex.wrapS = _railTex.wrapT = THREE.RepeatWrapping;
  _railTex.repeat.set(1, RACK_UNITS);
  _railTex.colorSpace = THREE.SRGBColorSpace;
  return _railTex;
}

function buildRackGroup(rack) {
  const g = new THREE.Group();
  g.position.set(rack.x, rack.y0 || 0, rack.z);
  g.rotation.y = rack.rotY || 0;
  const frameMat = mat(0x161b23, { roughness: 0.4, metalness: 0.65 });

  const postGeo = new THREE.BoxGeometry(2, RACK_H, 3);
  for (const [px, pz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const post = new THREE.Mesh(postGeo, frameMat);
    post.position.set(px * (RACK_OUTER_W / 2 - 1), RACK_H / 2, pz * (RACK_D / 2 - 1.5));
    post.castShadow = true;
    post.userData = { isRackFrame: true, rackId: rack.id };
    g.add(post); rackFrames.push(post);
  }
  for (const y of [1, RACK_H - 0.5]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(RACK_OUTER_W, y === 1 ? 2 : 1, RACK_D), frameMat);
    bar.position.y = y;
    bar.castShadow = true;
    bar.userData = { isRackFrame: true, rackId: rack.id };
    g.add(bar); rackFrames.push(bar);
  }

  // 19" mounting rails with square holes
  const railGeo = new THREE.BoxGeometry(1.4, RACK_UNITS * U, 0.5);
  const railMat = new THREE.MeshStandardMaterial({ map: getRailTexture(), roughness: 0.45, metalness: 0.55, envMapIntensity: 0.8 });
  for (const [rx, rz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(rx * (RACK_W / 2 + 0.8), RACK_BASE + RACK_UNITS * U / 2, rz * (RACK_D / 2 - 1.3));
    rail.userData = { isRackFrame: true, rackId: rack.id };
    g.add(rail); rackFrames.push(rail);
  }

  // Invisible plane used for U-slot placement raycasts
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(RACK_W + 6, RACK_UNITS * U),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  plane.position.set(0, RACK_BASE + RACK_UNITS * U / 2, RACK_D / 2);
  plane.userData = { isRackPlane: true, rackId: rack.id };
  g.add(plane); rackPlanes.push(plane);

  // U markings every 5U on the left post
  for (let u = 5; u <= RACK_UNITS; u += 5) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.12), mat(0x4da3ff));
    tick.position.set(-(RACK_OUTER_W / 2 - 1) + 1.2, RACK_BASE + (u - 0.5) * U, RACK_D / 2 - 1.4);
    g.add(tick);
  }

  scene.add(g);
  rackGroups.set(rack.id, g);
  collidersDirty = true;
  scheduleLevelVis();
  return g;
}

function portGrid(def) {
  // Real-world port layout: column-major numbering (port 1 ABOVE port 2, like
  // actual switches), RJ45s grouped in blocks of 6 columns with gaps, SFP+
  // cages wider/shorter at the far right, WAN ports offset on gateways.
  const pts = [];
  if (!def.ports) return pts;
  // Explicit per-SKU port map: blocks of {type, cols, rows, gapBefore} laid out
  // exactly as on the real faceplate. Column-major numbering inside each block.
  if (def.portLayout) {
    const cellW = 0.66, sfpW = 0.8;
    let total2 = 0;
    for (const b of def.portLayout) total2 += (b.gapBefore || 0) + b.cols * (b.type === 'sfp' ? sfpW : cellW);
    const offX = ((def.faceInsetL || 0) - (def.faceInsetR || 0)) / 2;
    let x = -total2 / 2 + offX, port = 1;
    for (const b of def.portLayout) {
      x += b.gapBefore || 0;
      const w = b.type === 'sfp' ? sfpW : cellW;
      let p = b.start || port;
      for (let c = 0; c < b.cols; c++) {
        const cx = x + w / 2;
        const rows = b.rows || 1;
        for (let r = 0; r < rows; r++) {
          // speed/poe ride along with the port so tooltips, the properties panel
          // and (later) the simulation all read the same electrical truth
          pts.push({
            x: cx, y: rows === 2 ? (r === 0 ? 0.44 : -0.44) : (b.y || 0),
            port: p++, kind: b.type, speed: b.speed, poe: b.poe, role: b.role
          });
        }
        x += w;
      }
      port = Math.max(port, p);
    }
    return pts;
  }
  const total = def.ports;
  const sfp = Math.min(def.sfp || 0, total);
  const rj = total - sfp;
  const rows = def.rows === 2 ? 2 : 1;
  const cellW = 0.66, groupCols = 6, groupGap = 0.3, sfpW = 0.8;
  const rowY = r => rows === 2 ? (r === 0 ? 0.44 : -0.44) : 0;
  const rjCols = rows === 2 ? Math.ceil(rj / 2) : rj;
  const nGroups = rjCols ? Math.ceil(rjCols / groupCols) : 0;
  const wanGap = (def.wan && rows === 1) ? 0.55 : 0;
  const sfpCols = sfp ? (rows === 2 ? Math.ceil(sfp / 2) : sfp) : 0;
  const sfpLead = (sfp && rj) ? 0.6 : 0;
  const totalW = rjCols * cellW + Math.max(0, nGroups - 1) * groupGap + wanGap + sfpLead + sfpCols * sfpW;
  // per-SKU face insets (touchscreens, displays) shift the port block to its true position
  const offX = ((def.faceInsetL || 0) - (def.faceInsetR || 0)) / 2;
  let x = -totalW / 2 + offX, port = 1;
  for (let c = 0; c < rjCols; c++) {
    if (c > 0 && c % groupCols === 0) x += groupGap;
    if (wanGap && c === def.wan) x += wanGap;
    if (def.gapsAfter && def.gapsAfter[c]) x += def.gapsAfter[c]; // per-SKU spacing
    const cx = x + cellW / 2;
    for (let r = 0; r < rows && port <= rj; r++) pts.push({ x: cx, y: rowY(r), port: port++, kind: 'rj' });
    x += cellW;
  }
  if (sfp) {
    x += sfpLead;
    for (let c = 0; c < sfpCols; c++) {
      const cx = x + sfpW / 2;
      for (let r = 0; r < rows && port <= total; r++) pts.push({ x: cx, y: rowY(r), port: port++, kind: 'sfp' });
      x += sfpW;
    }
  }
  return pts;
}

// shared jack geometry/materials — every rack port is a real modeled jack
const GEO_RJ_BEZEL = new THREE.BoxGeometry(0.6, 0.7, 0.08);
const GEO_RJ_HIT = new THREE.BoxGeometry(0.5, 0.56, 0.3);
const GEO_SFP_BEZEL = new THREE.BoxGeometry(0.76, 0.5, 0.08);
const GEO_SFP_HIT = new THREE.BoxGeometry(0.66, 0.36, 0.3);
const GEO_GOLD = new THREE.BoxGeometry(0.3, 0.05, 0.02);
const GEO_LED = new THREE.BoxGeometry(0.09, 0.09, 0.03);

function shade(hex, f) {
  const col = new THREE.Color(hex).multiplyScalar(f);
  col.r = Math.min(1, col.r); col.g = Math.min(1, col.g); col.b = Math.min(1, col.b);
  return '#' + col.getHexString();
}

function makeFaceplateTexture(dev, def) {
  const fw = RACK_W + 2, fh = def.uh * U - 0.18;
  const W = 1024, H = Math.max(64, Math.round(W * fh / fw));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const px = v => (v + fw / 2) / fw * W;
  const py = v => (fh / 2 - v) / fh * H;
  // brushed metal base
  const cc = '#' + new THREE.Color(def.color).getHexString();
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, shade(cc, 1.35)); grad.addColorStop(0.5, cc); grad.addColorStop(1, shade(cc, 0.65));
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.06;
  for (let i = 0; i < 70; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#000000'; g.fillRect(0, Math.random() * H, W, 1); }
  g.globalAlpha = 1;
  // rack screws
  g.fillStyle = '#0b0e13';
  for (const sx of [16, W - 16]) { g.beginPath(); g.arc(sx, H / 2, 7, 0, 7); g.fill(); }
  // ink color adapts to faceplate brightness — UniFi gear is silver
  const lum = new THREE.Color(def.color);
  const ink = (lum.r * 0.299 + lum.g * 0.587 + lum.b * 0.114) > 0.45
    ? 'rgba(26,32,42,0.92)' : 'rgba(232,240,252,0.95)';
  // brand identity: accent stripe + wordmark, readable at a glance
  const BRAND = {
    'Cisco & Meraki': { accent: '#049fd9', brand: 'CISCO' },
    'Aruba / HPE': { accent: '#ff8300', brand: 'ARUBA' },
    'Netgear': { accent: '#f7c325', brand: 'NETGEAR' },
    'TP-Link Omada': { accent: '#00c2b3', brand: 'OMADA' },
    'MikroTik': { accent: '#d9232e', brand: 'MikroTik' }
  };
  const bs = BRAND[def.cat] || (String(def.cat || '').startsWith('UniFi') ? { accent: '#4da3ff', brand: 'UniFi' } : null);
  if (bs) {
    g.fillStyle = bs.accent;
    g.fillRect(30, H - Math.max(4, H * 0.05), W - 60, Math.max(3, H * 0.035)); // accent bar along the bottom
  }
  // port cutouts + silkscreened numbers + role ticks (jacks are real 3D geometry)
  if (def.ports) {
    const rows2 = def.rows === 2;
    g.textAlign = 'center';
    for (const p of portGrid(def)) {
      const sfp = p.kind === 'sfp';
      const role = portRole(def, p.port);
      const cw = (sfp ? 0.82 : 0.64) / fw * W, chh = (sfp ? 0.54 : 0.74) / fh * H;
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(px(p.x) - cw / 2, py(p.y) - chh / 2, cw, chh);
      if (role !== 'LAN') {
        g.fillStyle = role === 'WAN' ? '#e8a33d' : '#7c9dd8';
        g.fillRect(px(p.x) - cw / 2, py(p.y) + (rows2 && p.y > 0 ? -chh / 2 - Math.max(2, H * 0.02) : chh / 2 + Math.max(1, H * 0.006)), cw, Math.max(2, H * 0.016));
      }
      g.fillStyle = ink;
      g.font = `500 ${Math.max(9, Math.round(H * 0.085))}px -apple-system, "Segoe UI", sans-serif`;
      const isTop = rows2 && p.y > 0;
      g.fillText(String(p.port), px(p.x), isTop ? py(p.y) - chh / 2 - H * 0.045 : py(p.y) + chh / 2 + H * 0.09);
    }
    g.textAlign = 'left';
  }
  // drive bays (UNVR / UNAS) with latch handles
  if (def.bays) {
    const bx0 = 30 + ((def.display && def.display.side === 'L') ? (1.4 + def.display.w) * W / fw : 10);
    const bx1 = W * 0.68;
    const bw = (bx1 - bx0) / def.bays;
    for (let i = 0; i < def.bays; i++) {
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(bx0 + i * bw + 3, H * 0.16, bw - 6, H * 0.68);
      g.fillStyle = 'rgba(255,255,255,0.16)';
      g.fillRect(bx0 + i * bw + 8, H * 0.68, bw - 16, Math.max(2, H * 0.06));
      g.fillStyle = '#38e07d';
      g.fillRect(bx0 + i * bw + 8, H * 0.22, Math.max(2, W * 0.003), Math.max(3, H * 0.08));
    }
  }
  // vents when there is empty faceplate area
  if (!def.ports && !def.manager && !def.bays) {
    g.fillStyle = 'rgba(0,0,0,0.45)';
    for (let i = 0; i < 26; i++) g.fillRect(W * 0.3 + i * W * 0.017, H * 0.3, W * 0.006, H * 0.4);
  }
  // brand wordmark + device name + model — readable without hovering
  g.textBaseline = 'middle';
  g.fillStyle = ink;
  const nameX = (def.display && def.display.side === 'L') ? (1.4 + def.display.w) * W / fw + 16 : 34;
  const nameMax = def.display && def.display.side === 'L' ? 90 : 150;
  if (bs) {
    g.font = `700 ${Math.max(11, Math.round(H * 0.13))}px -apple-system, "Segoe UI", sans-serif`;
    g.fillText(bs.brand, nameX, def.rows === 2 ? H * 0.2 : H * 0.14, nameMax);
  }
  g.font = `700 ${Math.min(34, Math.round(H * 0.26))}px -apple-system, "Segoe UI", sans-serif`;
  g.fillText(dev.name, nameX, def.rows === 2 ? H * 0.5 : H * 0.34, nameMax);
  g.font = `500 ${Math.max(10, Math.round(H * 0.11))}px -apple-system, "Segoe UI", sans-serif`;
  g.globalAlpha = 0.75;
  g.fillText(def.label, nameX, def.rows === 2 ? H * 0.8 : H * 0.54, nameMax);
  g.globalAlpha = 1;
  // status LED
  g.fillStyle = '#38e07d';
  g.beginPath(); g.arc(W - 40, H * 0.24, 5, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function makeScreenTexture(dev) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#0d2246');
  grad.addColorStop(1, '#081226');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#eaf2ff';
  g.font = '700 34px -apple-system, "Segoe UI", sans-serif';
  g.textBaseline = 'middle';
  g.fillText(dev.name, 16, 46, 224);
  g.fillStyle = '#7fb0ff';
  g.font = '500 22px -apple-system, "Segoe UI", sans-serif';
  g.fillText(dev.ip || DEVICE_TYPES[dev.type].label, 16, 88, 224);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function updateDeviceFaceplate(devId) {
  const dev = deviceById(devId);
  const g = dev && deviceGroups.get(devId);
  if (!g) return;
  if (g.userData.faceMesh) {
    const m = g.userData.faceMesh.material;
    if (m.map) m.map.dispose();
    m.map = makeFaceplateTexture(dev, DEVICE_TYPES[dev.type]);
    m.needsUpdate = true;
  }
  if (g.userData.screenMesh) {
    const sm = g.userData.screenMesh.material;
    if (sm.map) sm.map.dispose();
    const st = makeScreenTexture(dev);
    sm.map = st;
    sm.emissiveMap = st;
    sm.needsUpdate = true;
  }
}

function isPlaced(dev) {
  const def = DEVICE_TYPES[dev.type];
  if (def.field) return dev.mount === 'wall' || dev.x !== undefined;
  return dev.rackId !== undefined && dev.rackId !== null;
}

function buildDeviceGroup(dev) {
  if (!isPlaced(dev)) return null; // logical-only device from the 2D plan
  const def = DEVICE_TYPES[dev.type];
  const g = new THREE.Group();

  if (def.field) {
    // default mount comes from how the product actually installs
    const mountKind = dev.mount === 'wall' ? 'wall'
      : dev.mount === 'desk' ? 'desk'
      : (def.mounts && !def.mounts.includes('ceiling') && def.mounts.includes('desk')) ? 'desk'
      : 'pole';
    const shape = def.shape || (dev.type === 'camera' ? 'bullet' : 'disc');
    const tag = o => { o.userData = { isDeviceBody: true, deviceId: dev.id }; o.castShadow = true; return o; };
    const white = mat(0xe9edf2, { roughness: 0.3, metalness: 0.05 });
    const dark = mat(0x14181f, { roughness: 0.4 });
    const lensM = mat(0x070a0f, { roughness: 0.12, metalness: 0.3 });
    const metal = mat(0x2a313c, { metalness: 0.6, roughness: 0.45 });
    const mkRing = () => new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.15, 8, 40),
      new THREE.MeshStandardMaterial({ color: 0x4da3ff, emissive: 0x2f7fe0, emissiveIntensity: 1.6 }));

    // builds the product body facing +Z (wall orientation), centered at origin
    function buildHead() {
      const h = new THREE.Group();
      if (shape === 'disc') {
        const d = tag(new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 1.5, 28), white));
        d.rotation.x = Math.PI / 2; h.add(d);
        const r = mkRing(); r.position.z = 0.85; h.add(r);
      } else if (shape === 'bullet') {
        // real G-series bullets are cylinders with a sun hood, not boxes
        const arm = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 3.5, 10), metal));
        arm.rotation.x = Math.PI / 2; arm.position.z = 1.2; h.add(arm);
        const body = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.7, 7, 20), white));
        body.rotation.x = Math.PI / 2 + 0.3; body.position.set(0, -0.6, 5.2); h.add(body);
        const hood = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.85, 1.85, 2.2, 20, 1, true),
          new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.35, side: THREE.DoubleSide })));
        hood.rotation.x = Math.PI / 2 + 0.3; hood.position.set(0, -1.35, 7.6); h.add(hood);
        const lens = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, 1, 20), lensM));
        lens.rotation.x = Math.PI / 2 + 0.3; lens.position.set(0, -1.7, 8.3); h.add(lens);
        const ir = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.12, 6, 20),
          new THREE.MeshStandardMaterial({ color: 0x14181f, emissive: 0x330b0b, emissiveIntensity: 0.4 }));
        ir.rotation.x = 0.3; ir.position.set(0, -1.78, 8.55); h.add(ir);
      } else if (shape === 'wallap') {
        // U7 Pro Wall / In-Wall: white rounded square panel, LED bar at bottom
        const body = tag(new THREE.Mesh(new THREE.RoundedBoxGeometry(5.6, 5.6, 1.1, 2, 0.45), white));
        body.position.z = 0.55; h.add(body);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 0.06),
          new THREE.MeshStandardMaterial({ color: 0x4da3ff, emissive: 0x2f7fe0, emissiveIntensity: 1.6 }));
        bar.position.set(0, -2.2, 1.13); h.add(bar);
      } else if (shape === 'doorbellpro') {
        // G6 Pro Entry: taller unit with camera up top and a touchscreen
        const body = tag(new THREE.Mesh(new THREE.RoundedBoxGeometry(2.8, 7.2, 1.2, 2, 0.5), white));
        body.position.z = 0.6; h.add(body);
        const cam = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.4, 16), lensM));
        cam.rotation.x = Math.PI / 2; cam.position.set(0, 2.5, 1.25); h.add(cam);
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3),
          new THREE.MeshStandardMaterial({ color: 0x0d1b33, emissive: 0x1d4a85, emissiveIntensity: 1.0, roughness: 0.15 }));
        scr.position.set(0, -0.9, 1.22); h.add(scr);
      } else if (shape === 'turret' || shape === 'ptz') {
        const base = tag(new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 1.2, 22), white));
        base.rotation.x = Math.PI / 2; base.position.z = 0.6; h.add(base);
        const ball = tag(new THREE.Mesh(new THREE.SphereGeometry(shape === 'ptz' ? 2.8 : 2.1, 20, 16), white));
        ball.position.z = shape === 'ptz' ? 3.4 : 2.4; h.add(ball);
        const eye = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.8, 16), lensM));
        eye.rotation.x = Math.PI / 2; eye.position.z = (shape === 'ptz' ? 5.6 : 4.1); h.add(eye);
      } else if (shape === 'dome') {
        const base = tag(new THREE.Mesh(new THREE.CylinderGeometry(2.9, 3.1, 1, 24), white));
        base.rotation.x = Math.PI / 2; base.position.z = 0.5; h.add(base);
        const dome = tag(new THREE.Mesh(new THREE.SphereGeometry(2.3, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshPhysicalMaterial({ color: 0x0a0d12, roughness: 0.05, transparent: true, opacity: 0.85, clearcoat: 1 })));
        dome.rotation.x = Math.PI / 2; dome.position.z = 1; h.add(dome);
      } else if (shape === 'doorbell' || shape === 'reader') {
        const s = shape === 'reader' ? 0.8 : 1;
        const body = tag(new THREE.Mesh(new THREE.RoundedBoxGeometry(2.4 * s, 6 * s, 1.1, 2, 0.4), white));
        body.position.z = 0.55; h.add(body);
        const cam = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.7 * s, 0.7 * s, 0.4, 14), lensM));
        cam.rotation.x = Math.PI / 2; cam.position.set(0, 1.8 * s, 1.15); h.add(cam);
        const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.55 * s, 0.55 * s, 0.3, 14),
          new THREE.MeshStandardMaterial({ color: 0x4da3ff, emissive: 0x2f7fe0, emissiveIntensity: 1.3 }));
        btn.rotation.x = Math.PI / 2; btn.position.set(0, -1.7 * s, 1.15); h.add(btn);
      } else if (shape === 'panel') {
        const body = tag(new THREE.Mesh(new THREE.RoundedBoxGeometry(4.6, 7, 0.9, 2, 0.3), dark));
        body.position.z = 0.45; h.add(body);
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 6.1),
          new THREE.MeshStandardMaterial({ color: 0x0d1b33, emissive: 0x16345e, emissiveIntensity: 0.9, roughness: 0.2 }));
        screen.position.z = 0.92; h.add(screen);
      } else if (shape === 'cloud') {
        // overlapping spheres read as a cloud from any angle
        const cm = mat(0xdfe7f5, { roughness: 0.85, metalness: 0 });
        for (const [cx, cy, cz, r] of [[0,0,0,7],[-6,-1.5,0,5],[6,-1.5,0,5],[-2.5,3.5,0,4.5],[3,3,0,4]]) {
          const puff = tag(new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), cm));
          puff.position.set(cx, cy, cz);
          h.add(puff);
        }
      } else if (shape === 'tower') {
        const body = tag(new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 7.5, 26), white));
        body.position.set(0, 0, 0); h.add(body);
        const r = mkRing(); r.rotation.x = Math.PI / 2; r.position.y = -3.4; h.add(r);
      } else if (shape === 'table' || shape === 'workstation') {
        // 60"×30" desk at the standard 29" working height
        const wood = mat(0x9a7856, { roughness: 0.52, metalness: 0 });
        const edge = mat(0x6b543c, { roughness: 0.6, metalness: 0 });
        const legM = mat(0x2b3038, { metalness: 0.55, roughness: 0.42 });
        const top = tag(new THREE.Mesh(new THREE.BoxGeometry(60, 1.2, 30), wood));
        top.position.y = 29.4; h.add(top);
        // banded edge — laminate desks always have a contrasting edge strip
        const band = tag(new THREE.Mesh(new THREE.BoxGeometry(60.4, 0.5, 30.4), edge));
        band.position.y = 28.7; h.add(band);
        for (const s of [-1, 1]) {
          // C-leg frame instead of four sticks: foot, upright, top rail
          const foot = tag(new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 26), legM));
          foot.position.set(s * 27, 0.7, 0); h.add(foot);
          const post = tag(new THREE.Mesh(new THREE.BoxGeometry(2.2, 27, 2.6), legM));
          post.position.set(s * 27, 14.5, 0); h.add(post);
          const rail = tag(new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 24), legM));
          rail.position.set(s * 27, 28, 0); h.add(rail);
        }
        // modesty panel — and the thing that hides cable drops on a real desk
        const modesty = tag(new THREE.Mesh(new THREE.BoxGeometry(50, 11, 0.8), legM));
        modesty.position.set(0, 21, -12.6); h.add(modesty);
        if (shape === 'workstation') {
          // slim-bezel monitor on a proper arm-and-foot stand
          const bezel = tag(new THREE.Mesh(new THREE.BoxGeometry(23.5, 13.8, 0.7), mat(0x15181d, { roughness: 0.35 })));
          bezel.position.set(0, 39.6, -8.6); h.add(bezel);
          const scr = new THREE.Mesh(new THREE.PlaneGeometry(22.8, 13),
            new THREE.MeshStandardMaterial({ color: 0x16375f, emissive: 0x1f5399, emissiveIntensity: 0.85, roughness: 0.18 }));
          scr.position.set(0, 39.6, -8.22); h.add(scr);
          const neck2 = tag(new THREE.Mesh(new THREE.BoxGeometry(1.8, 8.5, 1.6), mat(0x3c424b, { metalness: 0.5, roughness: 0.4 })));
          neck2.position.set(0, 34.2, -9.4); h.add(neck2);
          const foot2 = tag(new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 0.7, 20), mat(0x3c424b, { metalness: 0.5, roughness: 0.4 })));
          foot2.position.set(0, 30.3, -9.4); h.add(foot2);
          const kb = tag(new THREE.Mesh(new THREE.BoxGeometry(17, 0.7, 5.6), mat(0x22262e, { roughness: 0.6 })));
          kb.position.set(-1, 30.4, 2); kb.rotation.x = -0.03; h.add(kb);
          const mouse = tag(new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 10), mat(0x22262e, { roughness: 0.55 })));
          mouse.scale.set(0.7, 0.42, 1.1); mouse.position.set(11, 30.4, 2.4); h.add(mouse);
          const pc = tag(new THREE.Mesh(new THREE.BoxGeometry(7, 16.5, 15.5), mat(0x1a1e26, { roughness: 0.45 })));
          pc.position.set(-23, 8.3, 2); h.add(pc);
        }
      } else if (shape === 'chair') {
        // Task chair: 5-star caster base, gas cylinder, contoured mesh back and
        // armrests. The five-spoke base is the single most recognisable office
        // silhouette there is — a disc on a post reads as a bar stool.
        const fabric = mat(0x262b34, { roughness: 0.92, metalness: 0 });
        const nylon = mat(0x1b1f26, { roughness: 0.55, metalness: 0.1 });
        const chrome = mat(0x9aa3ad, { metalness: 0.85, roughness: 0.3 });
        const seat = tag(new THREE.Mesh(new THREE.CylinderGeometry(9.4, 9.0, 3.2, 22), fabric));
        seat.scale.z = 0.96; seat.position.y = 18.4; h.add(seat);
        // back leans, as every chair does
        const back = tag(new THREE.Mesh(new THREE.BoxGeometry(16.5, 21, 2.2), fabric));
        back.position.set(0, 31.5, -8.4); back.rotation.x = -0.13; h.add(back);
        const lumbar = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 15, 10), nylon));
        lumbar.rotation.z = Math.PI / 2; lumbar.position.set(0, 23.4, -7.6); h.add(lumbar);
        for (const s of [-1, 1]) {
          const arm = tag(new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.5, 9), nylon));
          arm.position.set(s * 9.2, 26.5, -1); h.add(arm);
          const armPost = tag(new THREE.Mesh(new THREE.BoxGeometry(1.3, 8, 1.6), nylon));
          armPost.position.set(s * 9.2, 22.2, -2.4); h.add(armPost);
        }
        const cyl = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.5, 10.5, 14), chrome));
        cyl.position.y = 11.6; h.add(cyl);
        const hub = tag(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 1.4, 14), nylon));
        hub.position.y = 6.1; h.add(hub);
        for (let i = 0; i < 5; i++) {
          const a2 = (i / 5) * Math.PI * 2;
          const spoke = tag(new THREE.Mesh(new THREE.BoxGeometry(11, 1.3, 2.1), nylon));
          spoke.position.set(Math.cos(a2) * 5.5, 5.6, Math.sin(a2) * 5.5);
          spoke.rotation.y = -a2; h.add(spoke);
          const caster = tag(new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 1, 12), nylon));
          caster.rotation.x = Math.PI / 2;
          caster.position.set(Math.cos(a2) * 10.6, 1.5, Math.sin(a2) * 10.6);
          h.add(caster);
        }
      } else if (shape === 'pctower') {
        const pc = tag(new THREE.Mesh(new THREE.BoxGeometry(7.5, 17, 16), mat(0x1a1e26, { roughness: 0.45 })));
        pc.position.y = 8.5; h.add(pc);
        const led2 = new THREE.Mesh(new THREE.CircleGeometry(0.4, 10),
          new THREE.MeshStandardMaterial({ color: 0x4da3ff, emissive: 0x2f7fe0, emissiveIntensity: 1.4 }));
        led2.position.set(0, 14, 8.05); h.add(led2);
      } else if (shape === 'printer') {
        const bd = tag(new THREE.Mesh(new THREE.BoxGeometry(26, 38, 25), mat(0xd8dbe0, { roughness: 0.5 })));
        bd.position.y = 19; h.add(bd);
        const tray = tag(new THREE.Mesh(new THREE.BoxGeometry(20, 1, 12), mat(0x9aa1ab)));
        tray.position.set(0, 39, 2); h.add(tray);
        const pnl = new THREE.Mesh(new THREE.PlaneGeometry(8, 4),
          new THREE.MeshStandardMaterial({ color: 0x14335e, emissive: 0x1d4a85, emissiveIntensity: 0.7 }));
        pnl.position.set(4, 36.5, 12.6); pnl.rotation.x = -0.4; h.add(pnl);
      } else if (shape === 'tv') {
        const bd = tag(new THREE.Mesh(new THREE.BoxGeometry(50, 29, 2.4), mat(0x0b0e13, { roughness: 0.3 })));
        bd.position.z = 1.2; h.add(bd);
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(47.5, 26.5),
          new THREE.MeshStandardMaterial({ color: 0x101d33, emissive: 0x16345e, emissiveIntensity: 0.7, roughness: 0.2 }));
        scr.position.z = 2.45; h.add(scr);
      } else if (shape === 'person') {
        // 5'10" (70") scale reference, built on real proportions — about 7.5 head
        // heights, 18" shoulders, legs just under half of total height. This is
        // the object everything else in the room gets judged against, so a
        // two-shape blob quietly makes every other dimension look wrong too.
        const skin = mat(0xc99a72, { roughness: 0.75, metalness: 0 });
        const shirt = mat(0x4a5a72, { roughness: 0.82, metalness: 0 });
        const pants = mat(0x2f3742, { roughness: 0.88, metalness: 0 });
        const shoe = mat(0x1a1d23, { roughness: 0.6, metalness: 0 });
        const cap = (r1, r2, len, m2) => new THREE.Mesh(new THREE.CapsuleGeometry(r1, len, 6, 14), m2);

        const head = tag(new THREE.Mesh(new THREE.SphereGeometry(3.9, 20, 16), skin));
        head.scale.set(0.86, 1.08, 0.94);        // a head is not a ball
        head.position.y = 65.2; h.add(head);
        const neck = tag(cap(1.5, 0, 1.6, skin)); neck.position.y = 59.8; h.add(neck);

        // torso: chest tapering to waist, then hips
        const chest = tag(new THREE.Mesh(new THREE.CylinderGeometry(6.4, 5.3, 15, 18), shirt));
        chest.scale.z = 0.62; chest.position.y = 50.5; h.add(chest);
        const waist = tag(new THREE.Mesh(new THREE.CylinderGeometry(5.3, 5.6, 8, 18), shirt));
        waist.scale.z = 0.66; waist.position.y = 39.5; h.add(waist);
        const hips = tag(new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.2, 6, 18), pants));
        hips.scale.z = 0.7; hips.position.y = 33.5; h.add(hips);
        // shoulders squared off across the top of the chest
        const shoulders = tag(cap(3.0, 0, 12.4, shirt));
        shoulders.rotation.z = Math.PI / 2; shoulders.position.y = 56.4; h.add(shoulders);

        for (const s of [-1, 1]) {
          const upper = tag(cap(1.75, 0, 10.5, shirt));
          upper.position.set(s * 8.1, 50.4, 0); upper.rotation.z = s * 0.07; h.add(upper);
          const fore = tag(cap(1.5, 0, 10, skin));
          fore.position.set(s * 8.9, 39.4, 0.4); fore.rotation.z = s * 0.05; h.add(fore);
          const hand = tag(new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 10), skin));
          hand.scale.set(0.75, 1.15, 0.5); hand.position.set(s * 9.3, 32.6, 0.6); h.add(hand);
          // legs: thigh and calf are separate, and the gap between them is most
          // of what makes a figure read as a person at a glance
          const thigh = tag(cap(2.55, 0, 13.5, pants));
          thigh.position.set(s * 2.9, 24.5, 0); h.add(thigh);
          const calf = tag(cap(2.0, 0, 13, pants));
          calf.position.set(s * 3.1, 9.5, 0.2); h.add(calf);
          const foot = tag(new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 9.2), shoe));
          foot.position.set(s * 3.1, 1.1, 2.1); h.add(foot);
        }
      } else { // 'box' / 'deskbox'
        const body = tag(new THREE.Mesh(new THREE.RoundedBoxGeometry(6.5, shape === 'box' ? 7.5 : 1.8, shape === 'box' ? 2 : 6.5, 2, 0.3), white));
        body.position.z = shape === 'box' ? 1 : 0; h.add(body);
        const led = new THREE.Mesh(new THREE.CircleGeometry(0.35, 12),
          new THREE.MeshStandardMaterial({ color: 0x4da3ff, emissive: 0x2f7fe0, emissiveIntensity: 1.5 }));
        led.position.set(2.4, shape === 'box' ? 2.6 : 1, shape === 'box' ? 2.05 : 2.4);
        if (shape !== 'box') led.rotation.x = -Math.PI / 2;
        h.add(led);
      }
      return h;
    }

    let portPos;
    if (mountKind === 'wall') {
      g.position.set(dev.x, dev.y, dev.z);
      g.rotation.y = dev.rotY || 0;
      const bracket = tag(new THREE.Mesh(new THREE.BoxGeometry(3.2, 4.2, 0.9), metal));
      bracket.position.z = 0.4;
      g.add(bracket);
      const head = buildHead();
      head.position.z = 0.9;
      g.add(head);
      portPos = new THREE.Vector3(0, -3.6, 0.6);
    } else if (mountKind === 'desk') {
      g.position.set(dev.x, dev.y0 || 0, dev.z);
      g.rotation.y = dev.rotY || 0;
      const head = buildHead();
      if (shape === 'tower') head.position.y = 3.8;
      else if (shape === 'box') { head.rotation.x = -Math.PI / 2; head.position.y = 2.2; }
      else if (FLOOR_SHAPES.has(shape)) head.position.y = 0;
      else head.position.y = 1;
      g.add(head);
      if (shape === 'workstation') portPos = new THREE.Vector3(-24, 8, -6);
      else if (shape === 'pctower') portPos = new THREE.Vector3(0, 8, -8.3);
      else if (shape === 'printer') portPos = new THREE.Vector3(0, 10, -12.8);
      else portPos = new THREE.Vector3(0, 1.2, shape === 'tower' ? -2.5 : -3.4);
    } else {
      // ceiling-height pole mount
      const poleH = def.mountH || 96;
      g.position.set(dev.x, dev.y0 || 0, dev.z);
      const pole = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, poleH, 10), metal));
      pole.position.y = poleH / 2;
      g.add(pole);
      const base = tag(new THREE.Mesh(new THREE.CylinderGeometry(3, 3.8, 1, 18), mat(0x20262f, { metalness: 0.6, roughness: 0.4 })));
      base.position.y = 0.5;
      g.add(base);
      const head = buildHead();
      if (shape === 'disc') { head.rotation.x = -Math.PI / 2; head.position.y = poleH + 0.8; }
      else { head.rotation.x = Math.PI / 2.6; head.position.y = poleH - 0.5; }
      g.add(head);
      portPos = new THREE.Vector3(0, poleH - 3, 0.75);
    }
    if (def.ports) {
      const pm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.5), mat(0x0a0c10, { roughness: 0.4 }));
      pm.position.copy(portPos);
      pm.userData = { isPort: true, deviceId: dev.id, port: 1, side: FRONT };
      g.add(pm); portMeshes.push(pm);
    }
    scene.add(g);
    deviceGroups.set(dev.id, g);
    refreshPortTints();
    scheduleLevelVis();
    return g;
  }

  const rackG = rackGroups.get(dev.rackId);

  if (def.vertical) {
    // Vertical cable manager mounted on the side of the rack. A real one is a
    // CHANNEL, not a solid block: a back pan, two side walls, and a comb of
    // fingers across the front. Cable lives inside it, behind the fingers, and
    // the fingers are what retain it. Modelling it solid meant runs had nowhere
    // to go but in front of the whole assembly.
    const h = RACK_UNITS * U;
    const pan = new THREE.Mesh(new THREE.BoxGeometry(VCM_W, h, 0.4), mat(def.color, { roughness: 0.85 }));
    pan.position.z = -VCM_D / 2 + 0.2;
    pan.castShadow = true;
    pan.userData = { isManager: true, deviceId: dev.id, isDeviceBody: true };
    g.add(pan); managerMeshes.push(pan);
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, h, VCM_D), mat(def.color, { roughness: 0.85 }));
      wall.position.set(sx * (VCM_W / 2 - 0.2), 0, 0);
      wall.castShadow = true;
      wall.userData = { isManager: true, deviceId: dev.id, isDeviceBody: true };
      g.add(wall); managerMeshes.push(wall);
    }
    // The comb. Deliberately NOT flagged isDeviceBody, so it is not a collider:
    // a comb is precisely the thing cable passes between.
    for (let i = 0; i < VCM_FINGER_N; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(VCM_W + 0.2, 0.5, VCM_FINGER_D), mat(0x0c0e12));
      fin.position.set(0, -h / 2 + (i + 0.5) * (h / VCM_FINGER_N), VCM_D / 2 - VCM_FINGER_D / 2);
      g.add(fin);
    }
    const sideX = (dev.side === 'L' ? -1 : 1) * (RACK_OUTER_W / 2 + 1.8);
    g.position.set(sideX, RACK_BASE + h / 2, RACK_D / 2 - 3);
  } else {
    const h = def.uh * U - 0.18;
    const body = new THREE.Mesh(new THREE.BoxGeometry(RACK_W, h, def.depth), mat(def.color));
    body.position.z = -def.depth / 2 + 0.5;
    body.castShadow = true;
    body.userData = { isDeviceBody: true, deviceId: dev.id, isManager: !!def.manager };
    g.add(body);
    if (def.manager) managerMeshes.push(body);

    // faceplate with painted label, bezels, vents
    const face = new THREE.Mesh(
      new THREE.RoundedBoxGeometry(RACK_W + 2, h, 0.55, 2, 0.12),
      new THREE.MeshStandardMaterial({
        map: makeFaceplateTexture(dev, def), roughness: 0.42, metalness: 0.45, envMapIntensity: 1.0
      })
    );
    face.position.z = 0.7;
    face.castShadow = true;
    face.userData = { isDeviceBody: true, deviceId: dev.id, isManager: !!def.manager };
    g.add(face);
    g.userData.faceMesh = face;

    // per-SKU front display — and like the real thing, it SHOWS the device's
    // name and IP, so you know what it is from across the room
    if (def.display) {
      const dw = def.display.w, dh2 = def.display.h;
      const dx = def.display.side === 'L'
        ? -(RACK_W + 2) / 2 + 1.1 + dw / 2
        : (RACK_W + 2) / 2 - 1.1 - dw / 2;
      const st = makeScreenTexture(dev);
      const screen = new THREE.Mesh(
        new THREE.BoxGeometry(dw, dh2, 0.06),
        new THREE.MeshStandardMaterial({
          map: st, emissiveMap: st, emissive: 0xffffff, emissiveIntensity: 0.6,
          color: 0xffffff, roughness: 0.15, metalness: 0.1
        }));
      screen.position.set(dx, 0, 1.0);
      screen.userData = { isDeviceBody: true, deviceId: dev.id };
      g.userData.screenMesh = screen;
      g.add(screen);
    }
    if (def.manager) {
      managerMeshes.push(face);
      // The comb on a horizontal finger duct. Not colliders, for the same
      // reason as the vertical one — cable is meant to pass between them.
      for (let i = 0; i < HCM_FINGER_N; i++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(HCM_FINGER_W, h + 0.7, HCM_FINGER_D), mat(0x0c0e12));
        fin.position.set(hcmFingerX(i), 0, HCM_FINGER_Z);
        g.add(fin);
      }
    }

    // ports
    // real modeled jacks: metal bezel, recessed opening, gold contacts, link LED
    const rows2 = def.rows === 2;
    const MAT_BEZEL = mat(0x9299a2, { metalness: 0.75, roughness: 0.35 });
    const MAT_SFP_BEZEL = mat(0x6b7480, { metalness: 0.85, roughness: 0.3 });
    for (const p of portGrid(def)) {
      const sfp = p.kind === 'sfp';
      const bezel = new THREE.Mesh(sfp ? GEO_SFP_BEZEL : GEO_RJ_BEZEL, sfp ? MAT_SFP_BEZEL : MAT_BEZEL);
      bezel.position.set(p.x, p.y, 0.99);
      g.add(bezel);
      const jack = new THREE.Mesh(sfp ? GEO_SFP_HIT : GEO_RJ_HIT, mat(0x07090d, { roughness: 0.3 }));
      jack.position.set(p.x, p.y, 1.05);
      jack.userData = { isPort: true, deviceId: dev.id, port: p.port, side: FRONT,
        speed: p.speed, poe: p.poe, kind: p.kind, roleHint: p.role };
      g.add(jack); portMeshes.push(jack);
      if (!sfp) {
        const gold = new THREE.Mesh(GEO_GOLD, mat(0xc9a227, { metalness: 1, roughness: 0.3 }));
        gold.position.set(p.x, p.y + 0.16, 1.14);
        g.add(gold);
      }
      // Patch panels are passive copper — no PHY, so no link LEDs. Painting them
      // with lit ports is the tell that gives away a fake rack elevation.
      if (!def.passthrough) {
        const led = new THREE.Mesh(GEO_LED, mat(0x141a20, { roughness: 0.4 }));
        const topRow = rows2 && p.y > 0;
        led.position.set(p.x - (sfp ? 0.3 : 0.22), p.y + ((topRow || !rows2) ? 0.42 : -0.42), 1.04);
        led.userData = { portLed: true, deviceId: dev.id, port: p.port, side: FRONT };
        g.add(led); portLeds.push(led);
      }
    }

    // ---- rear panel: no blank backs ----
    const rearZ = 0.5 - def.depth;
    const metalDark = mat(0x171a1f, { roughness: 0.5, metalness: 0.55 });
    if (!def.manager) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(RACK_W, h, 0.12), metalDark);
      plate.position.z = rearZ + 0.06;
      plate.userData = { isDeviceBody: true, deviceId: dev.id };
      g.add(plate);
    }
    if (def.passthrough) {
      // patch panel rear: the keystone punchdown row — rear cables land here
      for (const p of portGrid(def)) {
        const bz = new THREE.Mesh(GEO_RJ_BEZEL, mat(0x3a4148, { roughness: 0.5 }));
        bz.position.set(p.x, p.y, rearZ - 0.02);
        g.add(bz);
        const jk = new THREE.Mesh(GEO_RJ_HIT, mat(0x07090d, { roughness: 0.3 }));
        jk.position.set(p.x, p.y, rearZ - 0.08);
        jk.userData = { isPort: true, deviceId: dev.id, port: p.port, outward: -1, side: REAR };
        g.add(jk); portMeshes.push(jk);
      }
    } else if (!def.manager) {
      if (def.powerDevice && def.outlets) {
        // UPS / PDU rear: bank of IEC outlets, each a live power port
        const n = def.outlets, ow = 1.35;
        for (let i = 0; i < n; i++) {
          const ox = -((n - 1) / 2) * (ow + 0.5) + i * (ow + 0.5);
          const frame = new THREE.Mesh(new THREE.BoxGeometry(ow, 1.05, 0.14), mat(0x22262c, { roughness: 0.5 }));
          frame.position.set(ox, 0, rearZ - 0.05);
          g.add(frame);
          const sock = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.75, 0.24), mat(0x05070a, { roughness: 0.35 }));
          sock.position.set(ox, 0, rearZ - 0.1);
          sock.userData = { isPort: true, deviceId: dev.id, port: i + 1, outward: -1, side: REAR };
          g.add(sock); portMeshes.push(sock);
        }
        const breaker = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.3), mat(0x8f959d, { metalness: 0.6, roughness: 0.4 }));
        breaker.position.set(RACK_W / 2 - 1.6, 0, rearZ - 0.12);
        g.add(breaker);
      } else {
        // IEC C14 power inlet — a real connectable port (cable it to a UPS/PDU)
        const inletX = RACK_W / 2 - 1.9;
        const inlet = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.0, 0.2), mat(0x0a0c10, { roughness: 0.4 }));
        inlet.position.set(inletX, 0, rearZ - 0.08);
        inlet.userData = { isPort: true, deviceId: dev.id, port: 'PWR', outward: -1, side: REAR };
        g.add(inlet); portMeshes.push(inlet);
        const inletFrame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.25, 0.1), metalDark);
        inletFrame.position.set(inletX, 0, rearZ - 0.03);
        g.add(inletFrame);
        for (let pin = 0; pin < 3; pin++) {
          const pn = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.26, 0.1), mat(0x8f959d, { metalness: 0.9, roughness: 0.3 }));
          pn.position.set(inletX - 0.3 + pin * 0.3, pin === 1 ? 0.14 : -0.08, rearZ - 0.16);
          g.add(pn);
        }
        // fan grille(s)
        const fans = def.uh >= 2 ? 2 : 1;
        for (let f = 0; f < fans; f++) {
          const fx = -RACK_W / 2 + 2.6 + f * 3.4;
          const ring = new THREE.Mesh(new THREE.TorusGeometry(h * 0.32, 0.09, 6, 24), mat(0x2b3038, { metalness: 0.6, roughness: 0.4 }));
          ring.position.set(fx, 0, rearZ - 0.06);
          g.add(ring);
          const hub = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.3, h * 0.3, 0.1, 20), mat(0x05070a, { roughness: 0.6 }));
          hub.rotation.x = Math.PI / 2;
          hub.position.set(fx, 0, rearZ + 0.02);
          g.add(hub);
          for (let s = 0; s < 3; s++) {
            const spoke = new THREE.Mesh(new THREE.BoxGeometry(h * 0.6, 0.07, 0.06), mat(0x2b3038, { metalness: 0.5 }));
            spoke.rotation.z = s * Math.PI / 3;
            spoke.position.set(fx, 0, rearZ - 0.04);
            g.add(spoke);
          }
        }
        // vent slots + serial label
        for (let v = 0; v < 6; v++) {
          const slot = new THREE.Mesh(new THREE.BoxGeometry(0.14, h * 0.55, 0.06), mat(0x05070a));
          slot.position.set(1.2 + v * 0.42, 0, rearZ - 0.03);
          g.add(slot);
        }
        const label2 = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.7, 0.03), mat(0xd8dbe0, { roughness: 0.8 }));
        label2.position.set(4.6, -h * 0.18, rearZ - 0.03);
        g.add(label2);
      }
    }

    g.position.set(0, RACK_BASE + (dev.u - 1) * U + (def.uh * U) / 2, RACK_D / 2 - 1);
  }

  rackG.add(g);
  deviceGroups.set(dev.id, g);
  refreshPortTints();
  collidersDirty = true;
  return g;
}

//////////////////// Cables ////////////////////

// A cable endpoint is (device, port number, side) — not just (device, port).
// Patch panels are why: port 7 exists twice, as the front RJ45 you patch into and
// as the rear punchdown the permanent run terminates on, and those are different
// places in space. Without a side, traverse() simply kept whichever mesh was added
// last — the rear — so every front patch cable silently jumped to the back of the
// panel. Sides also give each face its own capacity, which is what makes a patch
// panel behave like a real 1:1 passthrough instead of a 2-cable port.
const FRONT = 'front', REAR = 'rear';
function epSide(ep) { return ep && ep.side === REAR ? REAR : FRONT; }
function meshSide(o) { return (o.userData && o.userData.side) || FRONT; }

function getPortWorld(deviceId, port, side) {
  const g = deviceGroups.get(deviceId);
  if (!g) return null;
  const want = side === REAR ? REAR : FRONT;
  let mesh = null, fallback = null;
  g.traverse(o => {
    const u = o.userData;
    if (!u || !u.isPort || u.port !== port) return;
    if (meshSide(o) === want) { if (!mesh) mesh = o; }
    else if (!fallback) fallback = o;
  });
  // gear that only exposes the port on one face (UPS outlets, rear power inlets)
  mesh = mesh || fallback;
  if (!mesh) return null;
  const pos = new THREE.Vector3();
  mesh.getWorldPosition(pos);
  const normal = new THREE.Vector3(0, 0, 1);
  const q = new THREE.Quaternion();
  g.getWorldQuaternion(q);
  normal.applyQuaternion(q);
  if (mesh.userData.outward === -1) normal.negate(); // rear-panel ports exit backwards
  return { pos, normal };
}

// ---- Cat6 cable geometry (true to spec) ----
// Real Cat6 outer jacket ≈ 0.23" Ø → 0.115" radius. A hair thicker reads better
// on screen without looking like garden hose.
const CABLE_R = 0.125;
const CABLE_RADIAL = 12;          // round cross-section, no visible facets
const CONN_LEN = 1.05;            // molded RJ45 plug + strain-relief boot
const _cv = new THREE.Vector3();

function ensureColliders() { if (collidersDirty) rebuildRopeColliders(); }

function cablePorts(cable) {
  const a = getPortWorld(cable.a.deviceId, cable.a.port, epSide(cable.a));
  const b = getPortWorld(cable.b.deviceId, cable.b.port, epSide(cable.b));
  return (a && b) ? { a, b } : null;
}

function isPowerPort(deviceId, port) {
  if (port === 'PWR') return true;
  const d = deviceById(deviceId);
  return !!(d && DEVICE_TYPES[d.type].powerDevice);
}

// Guide → dense even polyline, remembering which samples are hard supports
// (the two connector lead-outs at each end + every routed waypoint). Supports
// get pinned so the cable leaves each jack dead-straight through its boot and is
// held wherever the tech routed it.
function resampleGuide(guide) {
  const pts = [guide[0].clone()];
  const pins = new Set([0]);
  for (let s = 0; s < guide.length - 1; s++) {
    const p0 = guide[s], p1 = guide[s + 1];
    const steps = Math.max(2, Math.round(p0.distanceTo(p1) / 3));
    for (let k = 1; k <= steps; k++) pts.push(p0.clone().lerp(p1, k / steps));
    pins.add(pts.length - 1);
  }
  return { pts, pins };
}

// ---- cable-vs-cable separation ----
// Two jackets cannot occupy the same space. The settled polyline of every cable
// is kept here so each new route can be pushed clear of the ones already run —
// which is what turns a pile of intersecting lines into a bundle a tech can
// actually trace by eye.
const cableRoutes = new Map();                 // cableId -> settled points
const CABLE_SEP = CABLE_R * 2 + 0.06;          // jackets touch, never merge
const _sep = new THREE.Vector3();

function buildRouteHash(excludeId) {
  const cell = CABLE_SEP * 2;
  const map = new Map();
  for (const [id, pts] of cableRoutes) {
    if (id === excludeId) continue;
    for (const p of pts) {
      const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)},${Math.floor(p.z / cell)}`;
      let a = map.get(k);
      if (!a) map.set(k, a = []);
      a.push(p);
    }
  }
  return { map, cell };
}

// Push one sample out of every other cable's jacket. Only our own points move —
// routes already laid stay put, so results are stable and order-deterministic.
function separateFromRoutes(p, hash) {
  const { map, cell } = hash;
  const bx = Math.floor(p.x / cell), by = Math.floor(p.y / cell), bz = Math.floor(p.z / cell);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const a = map.get(`${bx + dx},${by + dy},${bz + dz}`);
        if (!a) continue;
        for (const q of a) {
          _sep.subVectors(p, q);
          const d = _sep.length();
          if (d >= CABLE_SEP) continue;
          // exactly coincident: nudge along a fixed axis so the push is defined
          if (d < 1e-4) _sep.set(0.001, CABLE_SEP, 0); else _sep.multiplyScalar((CABLE_SEP - d) / d);
          p.add(_sep);
        }
      }
    }
  }
}

// ---- cable ties ----
// A real tie cinches its cables into one packed bundle and holds them there,
// permanently, whether or not anything is moving. The old implementation only
// existed inside the physics loop, so with physics off (the default) placing a
// tie drew a strap and changed nothing — the cables carried on running wherever
// they liked straight through the band. Ties are a routing constraint first and
// a physics constraint second.

// Cables in a strap pack hexagonally. Radius of a bundle of n jackets, plus the
// strap's own thickness — this is what a real bundle's diameter actually is, so
// it drives both the geometry and the band we draw around it.
function bundleRadius(n) {
  return CABLE_R * (1 + 1.08 * Math.sqrt(Math.max(1, n) - 1)) + 0.06;
}

// Deterministic hex-ish packing slot for member i of n, in the plane normal to
// the run. Deterministic ordering matters: the same cable must land in the same
// slot on every rebuild or the bundle shuffles every time you touch the scene.
function bundleSlot(i, n) {
  if (n <= 1) return [0, 0];
  if (n <= 7) {                                  // centre + one ring of six
    if (i === 0) return [0, 0];
    const a = ((i - 1) / Math.min(n - 1, 6)) * Math.PI * 2;
    const r = CABLE_R * 2.05;
    return [Math.cos(a) * r, Math.sin(a) * r];
  }
  // larger bundles: concentric rings, each holding ~6r/CABLE_R cables
  let idx = i, ring = 0, cap = 1;
  while (idx >= cap) { idx -= cap; ring++; cap = ring * 6; }
  const a = (idx / cap) * Math.PI * 2;
  const r = CABLE_R * 2.05 * ring;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

// Every tie this cable belongs to, resolved to a world target for its slot.
function tieTargetsFor(cableId) {
  const out = [];
  for (const tie of state.ties || []) {
    if (!tie.members) continue;
    const order = tie.members.map(m => m.cableId).slice().sort();  // stable slots
    const idx = order.indexOf(cableId);
    if (idx < 0) continue;
    const centre = new THREE.Vector3(tie.x, tie.y, tie.z);
    const tan = new THREE.Vector3(tie.tx || 1, tie.ty || 0, tie.tz || 0).normalize();
    // any two vectors perpendicular to the run give the packing plane
    const u = new THREE.Vector3(0, 1, 0);
    if (Math.abs(tan.dot(u)) > 0.9) u.set(1, 0, 0);
    const ax = new THREE.Vector3().crossVectors(tan, u).normalize();
    const ay = new THREE.Vector3().crossVectors(tan, ax).normalize();
    const [sx, sy] = bundleSlot(idx, order.length);
    out.push({
      tieId: tie.id,
      pos: centre.clone().addScaledVector(ax, sx).addScaledVector(ay, sy),
      centre
    });
  }
  return out;
}

// Is this sample inside a pathway this cable has been pulled into? Cables in a
// conduit are packed shoulder to shoulder by design — the generic keep-apart
// rule and the wall colliders both have to stand down in there, or the run gets
// squeezed straight back out of the pipe it is supposed to be inside.
const _rwq = new THREE.Vector3(), _rwab = new THREE.Vector3();
function inOwnRaceway(cable, p) {
  for (const id of cable.raceways || []) {
    const rw = (state.raceways || []).find(r => r.id === id);
    if (!rw) continue;
    const [a, b] = racewayPath(rw);
    _rwab.subVectors(b, a);
    const denom = _rwab.lengthSq() || 1;
    const t = Math.max(0, Math.min(1, _rwq.subVectors(p, a).dot(_rwab) / denom));
    _rwq.copy(a).addScaledVector(_rwab, t);
    const rt = RACEWAY_TYPES[rw.type] || {};
    const rad = rt.kind === 'conduit' ? rt.id / 2 + 0.2
      : rt.kind === 'hook' ? 1.4
      : Math.max(rt.w, rt.d) / 2 + 0.2;
    if (p.distanceTo(_rwq) <= rad) return true;
  }
  return false;
}

// Deterministic settle: analytic catenary-style droop between supports, then a
// few relaxation passes that push every free sample out of walls / racks / gear
// and away from other cables, smoothing kinks as it goes. No simulation, no
// jitter — same collider set the live physics uses, so a static cable and a
// physics cable agree and neither clips.
function settleCable(pts, pins, cable) {
  const N = pts.length;
  if (N < 3) return;
  const slack = (cable.slack === undefined ? 2 : cable.slack) / 100;
  const supports = [...pins].sort((a, b) => a - b);
  for (let s = 0; s < supports.length - 1; s++) {
    const i0 = supports[s], i1 = supports[s + 1];
    if (i1 - i0 < 2) continue;
    const p0 = pts[i0], p1 = pts[i1];
    const run = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const rise = Math.abs(p1.y - p0.y);
    const horiz = run / (run + rise + 1e-3);          // vertical drops don't belly
    const depth = Math.min(run * (0.03 + slack * 0.55), 9) * horiz;
    if (depth < 0.02) continue;
    for (let i = i0 + 1; i < i1; i++) {
      const f = (i - i0) / (i1 - i0);
      pts[i].y -= 4 * f * (1 - f) * depth;            // parabolic hang
    }
  }
  ensureColliders();
  const hash = buildRouteHash(cable.id);
  const hasRaceways = !!(cable.raceways && cable.raceways.length);

  // Cable inside a conduit does not hang. The pipe carries it, so the span
  // between entry and exit is dead straight along that cable's own slot — no
  // catenary, no separation, no collision. Without this the droop applied
  // between the two raceway pins bellies the run nine inches below a pipe with a
  // one-inch bore, and the cable renders outside the conduit it is supposedly in.
  const piped = new Map();                            // sample index -> exact point
  if (hasRaceways) {
    const gpts = racewayGuide(cable);
    for (let k = 0; k + 1 < gpts.length; k += 2) {
      const entry = gpts[k], exit = gpts[k + 1];
      let i0 = -1, i1 = -1, d0 = Infinity, d1 = Infinity;
      for (let i = 0; i < N; i++) {
        const a0 = pts[i].distanceToSquared(entry); if (a0 < d0) { d0 = a0; i0 = i; }
        const a1 = pts[i].distanceToSquared(exit);  if (a1 < d1) { d1 = a1; i1 = i; }
      }
      if (i0 < 0 || i1 < 0) continue;
      const lo = Math.min(i0, i1), hi = Math.max(i0, i1);
      const from = lo === i0 ? entry : exit, to = lo === i0 ? exit : entry;
      for (let i = lo; i <= hi; i++) {
        piped.set(i, from.clone().lerp(to, hi === lo ? 0 : (i - lo) / (hi - lo)));
      }
    }
    for (const [i, p] of piped) pts[i].copy(p);
  }

  // Claim the sample nearest each tie and hold it in that tie's packing slot.
  // Neighbours within a few samples get drawn in proportionally so the cable
  // funnels into the strap and back out, rather than kinking at a single point.
  const ties = tieTargetsFor(cable.id);
  const tied = new Map();                              // sample index -> target
  for (const t of ties) {
    let best = -1, bd = Infinity;
    for (let i = 1; i < N - 1; i++) {
      const d = pts[i].distanceToSquared(t.centre);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) tied.set(best, t.pos);
  }
  const applyTies = () => {
    for (const [i, target] of tied) {
      pts[i].copy(target);
      for (let k = 1; k <= 3; k++) {                   // funnel in and out
        const w = 1 - k / 4;
        for (const j of [i - k, i + k]) {
          if (j > 0 && j < N - 1 && !pins.has(j) && !tied.has(j)) pts[j].lerp(target, w * 0.45);
        }
      }
    }
  };

  for (let it = 0; it < 10; it++) {
    for (let i = 1; i < N - 1; i++) {
      if (pins.has(i) || tied.has(i) || piped.has(i)) continue;
      _cv.copy(pts[i - 1]).add(pts[i + 1]).multiplyScalar(0.5);
      pts[i].lerp(_cv, 0.12);                          // relax kinks (min bend radius)
      if (pts[i].y < CABLE_R) pts[i].y = CABLE_R;
    }
    for (let i = 1; i < N - 1; i++) {
      // Interior pins are waypoints — a cable manager finger or a wall bore that
      // several runs share. Those must be allowed to shift a fraction of an inch
      // sideways, or ten cables through one manager all stack on the exact same
      // coordinate. Only the two port pins are truly immovable.
      //
      // Tied samples are exempt from separation outright: inside a strap the
      // cables are *supposed* to be touching, and the generic keep-apart rule
      // would fight the tie forever and win.
      const inPipe = piped.has(i);
      if (!tied.has(i) && !inPipe) separateFromRoutes(pts[i], hash);
      if (!pins.has(i) && !tied.has(i) && !inPipe) collidePoint(pts[i]);
    }
    applyTies();                                       // the strap has the last word
    for (const [i, p] of piped) pts[i].copy(p);         // and so does the pipe
  }
  cableRoutes.set(cable.id, pts.map(p => p.clone()));
}

// Horizontal runs do not fly diagonally across a room — nobody pulls cable that
// way and no inspector would pass it. A real run leaves the rack, climbs to the
// plenum above the ceiling grid, crosses at that height on J-hooks or tray, and
// drops to the device. Anything short enough to be a patch lead stays direct.
// Returns the intermediate guide points; empty means "run it straight".
const PLENUM_MIN_SPAN = 60;        // 5 ft — below this it's a jumper, not a run
function plenumRoute(a, b) {
  if (a.pos.distanceTo(b.pos) < PLENUM_MIN_SPAN) return [];
  const mid = a.pos.clone().add(b.pos).multiplyScalar(0.5);
  // the lowest ceiling slab spanning the midpoint sets the plenum; with no slab
  // modeled yet, ride just under the top of the walls
  let deck = null;
  for (const s of state.slabs || []) {
    const x1 = Math.min(s.x1, s.x2), x2 = Math.max(s.x1, s.x2);
    const z1 = Math.min(s.z1, s.z2), z2 = Math.max(s.z1, s.z2);
    if (mid.x < x1 || mid.x > x2 || mid.z < z1 || mid.z > z2) continue;
    const bottom = s.y - 6;
    if (deck === null || bottom < deck) deck = bottom;
  }
  const y = (deck !== null ? deck : WALL_H) - 4;
  // both ends already up at height? then a straight cross is the real path
  if (y <= Math.max(a.pos.y, b.pos.y) + 3) return [];
  return [
    new THREE.Vector3(a.pos.x, y, a.pos.z),
    new THREE.Vector3(b.pos.x, y, b.pos.z)
  ];
}

// Grid an installer routes on. Waypoints snap here so runs read as deliberately
// dressed, not hand-wobbled. 1" is fine enough to look placed, coarse enough to
// stay tidy. CABLE_BEND_R is a generous stand-in for cat6's ~1" min bend radius.
const CABLE_SNAP = 1;
const CABLE_BEND_R = 1.4;
// Per-cable override, so a run can be dressed tighter or looser by hand. Cat6's
// real minimum is ~4× the 0.25" OD, so 1" is the floor — below that you're
// modelling a damaged cable.
const CABLE_BEND_MIN = 1.0, CABLE_BEND_MAX = 8;
function cableBendRadius(c) {
  const r = c && c.bendR !== undefined ? parseFloat(c.bendR) : CABLE_BEND_R;
  return Math.max(CABLE_BEND_MIN, Math.min(CABLE_BEND_MAX, isFinite(r) ? r : CABLE_BEND_R));
}
function snapCable(v) {
  return new THREE.Vector3(
    Math.round(v.x / CABLE_SNAP) * CABLE_SNAP,
    Math.round(v.y / CABLE_SNAP) * CABLE_SNAP,
    Math.round(v.z / CABLE_SNAP) * CABLE_SNAP);
}

// A clean routed path: straight between control points, a rounded fillet at each
// corner. This is what replaced the physics droop — real dressed cable runs in
// straight pulls with radiused bends, and the user controls the shape by placing
// waypoints, so the route is deterministic and editable instead of simulated.
function roundedCablePath(raw, radius) {
  const p = [];
  for (const v of raw) if (!p.length || p[p.length - 1].distanceToSquared(v) > 1e-5) p.push(v.clone());
  if (p.length < 2) return null;
  const path = new THREE.CurvePath();
  if (p.length === 2) { path.add(new THREE.LineCurve3(p[0], p[1])); return path; }
  let start = p[0].clone();
  for (let i = 1; i < p.length - 1; i++) {
    const cur = p[i];
    const dIn = cur.distanceTo(p[i - 1]), dOut = cur.distanceTo(p[i + 1]);
    const r = Math.min(radius, dIn * 0.45, dOut * 0.45);
    if (r < 0.02) { // segment too short to fillet — keep the sharp vertex
      if (start.distanceToSquared(cur) > 1e-5) path.add(new THREE.LineCurve3(start.clone(), cur.clone()));
      start = cur.clone();
      continue;
    }
    const inDir = new THREE.Vector3().subVectors(p[i - 1], cur).normalize();
    const outDir = new THREE.Vector3().subVectors(p[i + 1], cur).normalize();
    const cutIn = cur.clone().addScaledVector(inDir, r);
    const cutOut = cur.clone().addScaledVector(outDir, r);
    if (start.distanceToSquared(cutIn) > 1e-5) path.add(new THREE.LineCurve3(start.clone(), cutIn));
    path.add(new THREE.QuadraticBezierCurve3(cutIn, cur.clone(), cutOut));
    start = cutOut;
  }
  path.add(new THREE.LineCurve3(start, p[p.length - 1].clone()));
  return path;
}

// Expand one leg into axis-aligned moves so runs turn 90° instead of cutting a
// diagonal. Horizontal first, then vertical — cable is dressed across to its
// column, then up or down it. Legs shorter than MIN_ORTH stay straight, because
// a 2" jumper broken into a staircase looks worse than a short direct pull.
const MIN_ORTH = 4;
function orthLegs(p0, p1) {
  const out = [];
  if (p0.distanceTo(p1) < MIN_ORTH) { out.push(p1.clone()); return out; }
  const cur = p0.clone();
  // take the larger horizontal axis first, then the other, then vertical
  const order = Math.abs(p1.z - p0.z) > Math.abs(p1.x - p0.x) ? ['z', 'x', 'y'] : ['x', 'z', 'y'];
  for (const ax of order) {
    if (Math.abs(p1[ax] - cur[ax]) > 0.05) { cur[ax] = p1[ax]; out.push(cur.clone()); }
  }
  if (!out.length || out[out.length - 1].distanceToSquared(p1) > 1e-6) out.push(p1.clone());
  return out;
}

// How far a run travels vertically before it belongs in a vertical manager.
// Below this it is dressed on the face, because that is what installers do: a
// 48-port switch sandwiched between two 24-port panels is the standard layout
// precisely because every jumper is a short straight drop. Sending a 1U hop out
// to a side channel and back turns a 4" jumper into a 4' one.
const RACK_FACE_MAX_DY = 6 * U;          // 6U

// The horizontal cable manager sitting between two heights in a rack, if any.
// A run passing one is dressed into it — that is the whole reason it is there.
function hcmBetweenY(rackId, yA, yB) {
  const lo = Math.min(yA, yB), hi = Math.max(yA, yB), mid = (lo + hi) / 2;
  let best = null;
  for (const d of state.devices) {
    if (d.rackId !== rackId) continue;
    const def = DEVICE_TYPES[d.type];
    if (!def.manager || def.vertical) continue;
    const cy = RACK_BASE + (d.u - 1) * U + def.uh * U / 2;
    if (cy <= lo || cy >= hi) continue;
    if (best === null || Math.abs(cy - mid) < Math.abs(best - mid)) best = cy;
  }
  return best;
}
// Depth of the channel inside each kind of duct, in rack-local z. A run is
// dressed to this plane, which is behind the finger tips and in front of the
// faceplate — i.e. actually inside the comb, held by it.
const HCM_DUCT_Z = RACK_D / 2 - 1 + HCM_FINGER_Z;
const VCM_DUCT_Z = RACK_D / 2 - 3;

// Real rack dressing, in two regimes because real racks have two.
//
// Short hop (within RACK_FACE_MAX_DY): stay on the face. Drop off the port, run
// across in the gap between the two devices — through a horizontal manager if
// one is there — then drop into the destination port. Out–down–across–down–in.
//
// Long hop: out to a vertical manager (or the nearest side channel), down that
// column, then break out horizontally into the destination port.
//
// Either way every move is a 90, and nothing cuts diagonally across a faceplate.
function rackDressRoute(cable, a, b) {
  const da = deviceById(cable.a.deviceId), db = deviceById(cable.b.deviceId);
  if (!da || !db || !da.rackId || da.rackId !== db.rackId) return null;
  const rg = rackGroups.get(da.rackId);
  if (!rg) return null;
  rg.updateMatrixWorld(true);
  const toLocal = v => rg.worldToLocal(v.clone());
  const toWorld = v => rg.localToWorld(v.clone());
  const la = toLocal(a.pos), lb = toLocal(b.pos);
  const dy = Math.abs(la.y - lb.y);
  if (dy < 1.2) return null;                      // same U — a straight pull is right
  const lead = CONN_LEN + 0.7;
  const lan = toLocal(a.pos.clone().addScaledVector(a.normal, lead));
  const lbn = toLocal(b.pos.clone().addScaledVector(b.normal, lead));
  const z = Math.max(lan.z, lbn.z);               // dress just clear of the faceplates

  if (dy <= RACK_FACE_MAX_DY) {
    const runY = hcmBetweenY(da.rackId, lan.y, lbn.y);
    if (runY === null) {
      // No duct between them: run across midway, so the horizontal leg sits in
      // the gap rather than across either faceplate.
      const midY = (lan.y + lbn.y) / 2;
      return [
        toWorld(new THREE.Vector3(lan.x, midY, z)),
        toWorld(new THREE.Vector3(lbn.x, midY, z))
      ];
    }
    // Through the duct: slide to the nearest finger gap, push back between the
    // fingers into the channel, run along inside it, then back out through a
    // gap at the far end. This is what a finger duct is for — the cable is
    // retained by the comb rather than lying in front of it.
    const gA = hcmGapX(lan.x), gB = hcmGapX(lbn.x);
    return [
      toWorld(new THREE.Vector3(gA, runY, z)),
      toWorld(new THREE.Vector3(gA, runY, HCM_DUCT_Z)),
      toWorld(new THREE.Vector3(gB, runY, HCM_DUCT_Z)),
      toWorld(new THREE.Vector3(gB, runY, z))
    ];
  }
  // dress column: a real vertical manager if the rack has one, else nearest side
  let dressX = null, hasVcm = false;
  for (const d of state.devices) {
    if (d.rackId !== da.rackId || !DEVICE_TYPES[d.type].vertical) continue;
    const x = (d.side === 'L' ? -1 : 1) * (RACK_OUTER_W / 2 + 1.8);
    if (dressX === null || Math.abs(x - la.x) < Math.abs(dressX - la.x)) { dressX = x; hasVcm = true; }
  }
  if (dressX === null) dressX = (la.x + lb.x) / 2 >= 0 ? RACK_W / 2 + 1.6 : -(RACK_W / 2 + 1.6);
  if (!hasVcm) {
    return [
      toWorld(new THREE.Vector3(dressX, lan.y, z)),
      toWorld(new THREE.Vector3(dressX, lbn.y, z))
    ];
  }
  // Into the vertical duct: out to the manager in front of the rails, back
  // through the fingers into the channel, down the channel, then out through
  // the fingers again at the destination.
  return [
    toWorld(new THREE.Vector3(dressX, lan.y, z)),
    toWorld(new THREE.Vector3(dressX, lan.y, VCM_DUCT_Z)),
    toWorld(new THREE.Vector3(dressX, lbn.y, VCM_DUCT_Z)),
    toWorld(new THREE.Vector3(dressX, lbn.y, z))
  ];
}

function cableCurve(cable) {
  const ep = cablePorts(cable);
  if (!ep) return null;
  const { a, b } = ep;
  // a short straight lead-out so the jacket leaves the jack square, then the run
  const lead = CONN_LEN + 0.7;
  const aLead = a.pos.clone().addScaledVector(a.normal, lead);
  const bLead = b.pos.clone().addScaledVector(b.normal, lead);
  // Precedence: a raceway physically carries the cable (overrides everything);
  // then the user's own waypoints; then automatic dressing.
  const rwGuide = racewayGuide(cable);
  let mid = [], orth = true;
  if (rwGuide.length) {
    mid = rwGuide.map(w => (w.clone ? w.clone() : new THREE.Vector3(w.x, w.y, w.z)));
    orth = false;                                  // inside a pipe the path is the pipe
  } else if (cable.waypoints && cable.waypoints.length) {
    mid = cable.waypoints.map(w => new THREE.Vector3(w.x, w.y, w.z));
  } else if (cable.autoRoute !== false) {
    mid = rackDressRoute(cable, a, b) || plenumRoute(a, b);
  }
  // build the control chain, expanding each leg to 90° moves
  const chain = [a.pos.clone(), aLead];
  // Duplicate control points make a zero-length leg, and a zero-length leg has
  // no direction to build a fillet from — it produces NaN and the run vanishes.
  // Both ends of a duct hop landing in the same finger gap is a normal case, so
  // this has to be handled here rather than avoided upstream.
  const add = (p) => {
    const last = chain[chain.length - 1];
    if (last && last.distanceToSquared(p) < 1e-6) return;
    chain.push(p.clone ? p.clone() : new THREE.Vector3(p.x, p.y, p.z));
  };
  const push = (p) => {
    const last = chain[chain.length - 1];
    if (orth) for (const q of orthLegs(last, p)) add(q);
    else add(p);
  };
  for (const m of mid) push(m);
  push(bLead);
  add(b.pos);
  return roundedCablePath(chain, cableBendRadius(cable));
}

// Molded RJ45 plug (frosty polycarbonate) + colored strain-relief boot, aimed
// down the port normal so it sits plugged into the jack 1:1.
function buildConnector(port, color, isPower) {
  const g = new THREE.Group();
  g.position.copy(port.pos);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), port.normal.clone().normalize());
  if (isPower) {
    const body = new THREE.Mesh(new THREE.RoundedBoxGeometry(0.66, 0.52, 0.95, 2, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.62, metalness: 0.12 }));
    body.position.z = 0.42;
    g.add(body);
  } else {
    const plug = new THREE.Mesh(new THREE.RoundedBoxGeometry(0.5, 0.42, 0.64, 2, 0.05),
      new THREE.MeshPhysicalMaterial({
        color: 0xe9eff3, roughness: 0.16, metalness: 0,
        clearcoat: 1, clearcoatRoughness: 0.12, transparent: true, opacity: 0.7, envMapIntensity: 1
      }));
    plug.position.z = 0.29;                            // front edge nudged into the jack
    g.add(plug);
    // 8 gold contacts through the clear housing, and the latch tab angled back
    // over the boot — the two details that say "RJ45" the instant you zoom in.
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 1, roughness: 0.28 });
    const pinGeo = new THREE.BoxGeometry(0.035, 0.012, 0.3);
    for (let i = 0; i < 8; i++) {
      const pin = new THREE.Mesh(pinGeo, gold);
      pin.position.set(-0.157 + i * 0.045, 0.2, 0.2);
      g.add(pin);
    }
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.42),
      new THREE.MeshPhysicalMaterial({
        color: 0xe9eff3, roughness: 0.16, metalness: 0,
        clearcoat: 1, transparent: true, opacity: 0.7
      }));
    latch.position.set(0, -0.25, 0.52);
    latch.rotation.x = -0.42;                          // springs up away from the body
    g.add(latch);
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 0.52, 14),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0 }));
    boot.rotation.x = Math.PI / 2;
    boot.position.z = 0.72;                            // slips over the plug tail
    g.add(boot);
  }
  g.traverse(o => { o.castShadow = true; });
  return g;
}

// Is this cable a blocked STP link? True when either end's port is blocking.
function cableStpBlocked(cable) {
  try {
    for (const v of [undefined, ...stpVlans()]) {
      if (stpBlocked(cable.a.deviceId, cable.a.port, v) || stpBlocked(cable.b.deviceId, cable.b.port, v)) return true;
    }
    return false;
  } catch (e) { return false; }
}

function buildCableMesh(cable) {
  const curve = cableCurve(cable);
  if (!curve) return;
  // segment density from run length — a CurvePath has no fixed point list, and
  // the tube needs enough rings that the rounded corners stay smooth
  const len = curve.getLength();
  const segs = Math.max(24, Math.min(320, Math.round(len / 1.5)));
  const geo = new THREE.TubeGeometry(curve, segs, CABLE_R, CABLE_RADIAL, false);
  const col = new THREE.Color(cable.color);
  // PVC jacket: matte-satin, faint sheen — not the wet-noodle clearcoat it was.
  const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
    color: col, roughness: 0.52, metalness: 0,
    clearcoat: 0.16, clearcoatRoughness: 0.5,
    sheen: 0.35, sheenColor: col.clone().multiplyScalar(0.5), sheenRoughness: 0.85,
    envMapIntensity: 0.7
  }));
  m.castShadow = true;
  m.userData = { isCable: true, cableId: cable.id, curve };
  // A link STP has blocked is up but not forwarding. Real switches show this as
  // an amber/blocked port, so tint the run instead of leaving it look live.
  if (cableStpBlocked(cable)) {
    m.material.color.set(0xffb020);
    m.material.emissive = new THREE.Color(0x3a2600);
    m.material.transparent = true;
    m.material.opacity = 0.55;
  }
  const ep = cablePorts(cable);
  if (ep) {
    m.add(buildConnector(ep.a, col, isPowerPort(cable.a.deviceId, cable.a.port)));
    m.add(buildConnector(ep.b, col, isPowerPort(cable.b.deviceId, cable.b.port)));
  }
  scene.add(m);
  cableMeshes.set(cable.id, m);
  cable.lengthIn = curve.getLength();
  refreshPortTints();
}

// Every material/geometry under a cable mesh is unique (no shared cache) so the
// whole subtree can be disposed safely.
function disposeCableObj(m) {
  scene.remove(m);
  m.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(x => x.dispose && x.dispose());
  });
}

function rebuildCable(cable) {
  const old = cableMeshes.get(cable.id);
  if (old) { disposeCableObj(old); cableMeshes.delete(cable.id); }
  buildCableMesh(cable);
}

// Structural edits (a drilled hole, a new/removed wall or slab) change what
// cables must avoid. Re-settle every existing cable so routes stay 1:1 with the
// building — coalesced to one pass per tick so a 4-wall room is one reroute, and
// skipped entirely during bulk load (cables are built last, already correct).
// Two passes: the first lays each cable clear of the ones before it, the second
// lets the early cables see the late ones, so separation ends up mutual instead
// of "whoever was routed last has to dodge everybody".
let _rerouteQueued = false;
function rerouteAll() {
  collidersDirty = true;
  for (let pass = 0; pass < 2; pass++) {
    for (const c of state.cables) rebuildCable(c);
  }
  if (physOn) for (const c of state.cables) buildRope(c);
}
function scheduleReroute() {
  collidersDirty = true;
  if (_rerouteQueued || !(state.cables && state.cables.length)) return;
  _rerouteQueued = true;
  Promise.resolve().then(() => {
    _rerouteQueued = false;
    if (!(state.cables && state.cables.length)) return;
    rerouteAll();
  });
}

function portLabel(dev, port) {
  if (port === 'PWR') return 'Power inlet';
  if (dev && DEVICE_TYPES[dev.type].powerDevice) return `Outlet ${port}`;
  return `Port ${port}`;
}

// Human label for a port's electrical spec, e.g. "2.5G · PoE++ (60W)".
function portSpecLabel(u) {
  if (!u) return '';
  const bits = [];
  if (u.speed) bits.push(u.speed >= 1 ? `${u.speed}G` : `${u.speed * 1000}M`);
  if (u.kind === 'sfp') bits.push('SFP');
  if (u.poe) bits.push(u.poe);
  return bits.join(' · ');
}

function portRole(def, port) {
  if (port === 'PWR') return 'PWR';
  if (def.powerDevice) return 'PWR';
  if (def.roleMap && def.roleMap[port]) return def.roleMap[port]; // per-SKU truth
  if (def.wan && port <= def.wan) return 'WAN';
  if (def.sfp && def.ports && port > def.ports - def.sfp) return 'SFP+';
  return 'LAN';
}

//////////////////// Interface state: speed, duplex, admin ////////////////////
// IEEE 802.3 Clause 28 autonegotiation: both ends advertise what they can do
// and the highest common capability wins. A 1 G port cabled to a 100 M port
// trains to 100 M — the link comes up, just slower, and both ends report the
// negotiated value rather than their own maximum.
//
// The duplex-mismatch case is the one worth modelling carefully because it is
// the classic real fault: if one end has speed/duplex hardcoded it stops
// autonegotiating, and the end still negotiating cannot detect the partner's
// duplex, so it falls back to half. The link comes UP and passes traffic while
// throwing late collisions — which is why it is so often misdiagnosed as a
// cable fault.
function portMaxSpeed(dev, port) {
  const def = DEVICE_TYPES[dev.type];
  if (!def) return null;
  for (const p of portGrid(def)) if (p.port === port) return p.speed || SPEED.ge;
  return def.portSpeed || SPEED.ge;
}
function portCfgOf(dev, port) { return (dev.portCfg && dev.portCfg[port]) || {}; }
function portAdminDown(dev, port) { return !!portCfgOf(dev, port).shutdown; }
// Configured speed/duplex, or 'auto'.
function portConfiguredSpeed(dev, port) {
  const v = portCfgOf(dev, port).speed;
  return v === undefined || v === '' || v === 'auto' ? null : parseFloat(v);
}
function portConfiguredDuplex(dev, port) {
  const v = portCfgOf(dev, port).duplex;
  return v === 'half' || v === 'full' ? v : null;
}

// Negotiate one link. Returns speed in Gbps, duplex, and any fault.
function negotiateLink(cable) {
  const da = deviceById(cable.a.deviceId), db = deviceById(cable.b.deviceId);
  if (!da || !db) return null;
  if (cable.a.port === 'PWR' || cable.b.port === 'PWR') return null;
  const aAdmin = portAdminDown(da, cable.a.port), bAdmin = portAdminDown(db, cable.b.port);
  if (aAdmin || bAdmin) {
    return { up: false, admin: true,
      reason: `${(aAdmin ? da : db).name} port ${aAdmin ? cable.a.port : cable.b.port} is administratively down (shutdown)` };
  }
  const capA = portMaxSpeed(da, cable.a.port), capB = portMaxSpeed(db, cable.b.port);
  const fixA = portConfiguredSpeed(da, cable.a.port), fixB = portConfiguredSpeed(db, cable.b.port);
  const dupA = portConfiguredDuplex(da, cable.a.port), dupB = portConfiguredDuplex(db, cable.b.port);
  // A hardcoded speed the partner cannot reach means no link at all.
  if (fixA && fixA > capB) return { up: false, reason: `${da.name} port ${cable.a.port} is forced to ${fmtSpeed(fixA)} but ${db.name} port ${cable.b.port} tops out at ${fmtSpeed(capB)} — no link` };
  if (fixB && fixB > capA) return { up: false, reason: `${db.name} port ${cable.b.port} is forced to ${fmtSpeed(fixB)} but ${da.name} port ${cable.a.port} tops out at ${fmtSpeed(capA)} — no link` };
  const speed = Math.min(fixA || capA, fixB || capB);
  let duplex = 'full', mismatch = null;
  if (dupA && dupB && dupA !== dupB) {
    duplex = 'half';
    mismatch = `duplex mismatch: ${da.name} port ${cable.a.port} is ${dupA}, ${db.name} port ${cable.b.port} is ${dupB}`;
  } else if (dupA && !dupB && !fixB) {
    // One side hardcoded, the other autonegotiating → the auto side falls to half.
    duplex = dupA;
    if (dupA === 'full') mismatch = `duplex mismatch: ${da.name} port ${cable.a.port} is hardcoded full, ${db.name} port ${cable.b.port} autonegotiates and will fall back to half`;
  } else if (dupB && !dupA && !fixA) {
    duplex = dupB;
    if (dupB === 'full') mismatch = `duplex mismatch: ${db.name} port ${cable.b.port} is hardcoded full, ${da.name} port ${cable.a.port} autonegotiates and will fall back to half`;
  } else if (dupA || dupB) {
    duplex = dupA || dupB;
  }
  let downshift = null;
  if (speed < Math.max(capA, capB)) {
    // Name whatever actually held the link back: a forced speed, or the slower
    // port. Blaming capability when someone hardcoded the port sends the reader
    // looking at the wrong end.
    const forced = (fixA && fixA === speed && capA > speed) ? `${da.name} port ${cable.a.port} is forced to ${fmtSpeed(speed)}`
                 : (fixB && fixB === speed && capB > speed) ? `${db.name} port ${cable.b.port} is forced to ${fmtSpeed(speed)}`
                 : null;
    const slower = capA < capB ? `${da.name} port ${cable.a.port}` : `${db.name} port ${cable.b.port}`;
    downshift = forced
      ? `trained to ${fmtSpeed(speed)} — ${forced}, though both ends could do ${fmtSpeed(Math.max(capA, capB))}`
      : `trained to ${fmtSpeed(speed)} — ${slower} tops out there, so the faster end steps down`;
  }
  return { up: true, speed, duplex, mismatch, negotiated: !fixA && !fixB, downshift };
}
function fmtSpeed(g) {
  if (g === null || g === undefined) return '—';
  return g < 1 ? `${Math.round(g * 1000)}M` : `${g}G`;
}
// The link a port is on, negotiated. Cached per sim run via flushL2Tables.
let _linkState = new Map();
function linkFor(devId, port) {
  const key = `${devId}:${port}`;
  if (_linkState.has(key)) return _linkState.get(key);
  const c = state.cables.find(x =>
    (x.a.deviceId === devId && x.a.port === port) || (x.b.deviceId === devId && x.b.port === port));
  const res = c ? negotiateLink(c) : null;
  _linkState.set(key, res);
  return res;
}
// `show interfaces status`
function showInterfacesStatus(dev) {
  const def = DEVICE_TYPES[dev.type];
  if (!def || !def.ports) return `${dev.name} has no interfaces`;
  const out = ['Port      Status        Vlan     Duplex  Speed Type'];
  for (let p = 1; p <= def.ports; p++) {
    if (portRole(def, p) === 'PWR') continue;
    const l = linkFor(dev.id, p);
    const status = !l ? 'notconnect' : (l.admin ? 'disabled' : (l.up ? 'connected' : 'notconnect'));
    const vlan = portMode(dev, p) === 'trunk' ? 'trunk' : String(nativeVlanOf(dev, p));
    const dup = l && l.up ? (l.negotiated ? 'a-' : '') + l.duplex : 'auto';
    const spd = l && l.up ? (l.negotiated ? 'a-' : '') + fmtSpeed(l.speed) : 'auto';
    out.push(`${('Gi0/' + p).padEnd(9)} ${status.padEnd(13)} ${vlan.padEnd(8)} ${dup.padEnd(7)} ${spd.padEnd(5)} ${portRole(def, p) === 'SFP+' ? 'SFP' : '10/100/1000'}`);
  }
  return out.join('\n');
}

//////////////////// Functional VLAN engine ////////////////////
// Ports carry an untagged/access VLAN (default 1) plus optional tagged trunks.
// Patch panels are true 1:1 passthroughs: front and rear share a port number.
// A VLAN crosses a cable only when BOTH endpoint ports carry it.

//////////////////// VLAN database ////////////////////
// VLANs existed only implicitly, as numbers typed into port config. A real
// switch holds a VLAN database: each VLAN is an object with an ID and a name,
// it has to exist before a port can be put in it, and VLAN 1 is the default
// that always exists and cannot be deleted.
//
// A port is then either:
//   access — belongs to exactly one VLAN, frames leave untagged
//   trunk  — carries a list of VLANs tagged, plus ONE native VLAN untagged
// The native VLAN is the part that bites people: if two ends of a trunk
// disagree on it, traffic silently crosses between VLANs. That mismatch is a
// real fault and the simulation has to be able to represent it.
const DEFAULT_VLAN = 1;
function vlanDb(dev) {
  const db = new Map();
  db.set(DEFAULT_VLAN, { id: DEFAULT_VLAN, name: 'default', builtin: true });
  for (const v of dev.vlans || []) {
    const id = parseInt(v.id, 10);
    if (id > 0 && id < 4095) db.set(id, { id, name: v.name || `VLAN${id}` });
  }
  return db;
}
function vlanExists(dev, id) { return vlanDb(dev).has(parseInt(id, 10)); }
function vlanName(dev, id) { const e = vlanDb(dev).get(parseInt(id, 10)); return e ? e.name : null; }

// How a port is configured, normalised. `mode` is explicit so a trunk with a
// single allowed VLAN is still a trunk, not an access port.
function portMode(dev, port) {
  const cfg = (dev.portCfg && dev.portCfg[port]) || {};
  if (cfg.mode) return cfg.mode;
  return cfg.tagged ? 'trunk' : 'access';
}
// The untagged VLAN on a port: the access VLAN, or a trunk's native VLAN.
function nativeVlanOf(dev, port) {
  const cfg = (dev.portCfg && dev.portCfg[port]) || {};
  if (portMode(dev, port) === 'trunk') return parseInt(cfg.native, 10) || DEFAULT_VLAN;
  return parseInt(cfg.vlan, 10) || DEFAULT_VLAN;
}
// VLANs a trunk is allowed to carry tagged.
function allowedVlans(dev, port) {
  const cfg = (dev.portCfg && dev.portCfg[port]) || {};
  const out = new Set();
  for (const t of String(cfg.tagged || '').split(/[\s,]+/)) {
    const n = parseInt(t, 10);
    if (n) out.add(n);
  }
  return out;
}
// Two ends of a trunk disagreeing on the native VLAN — a genuine misconfig that
// bridges two VLANs together without anyone intending it.
function nativeVlanMismatch(cable) {
  const da = deviceById(cable.a.deviceId), db = deviceById(cable.b.deviceId);
  if (!da || !db) return null;
  if (portMode(da, cable.a.port) !== 'trunk' || portMode(db, cable.b.port) !== 'trunk') return null;
  const na = nativeVlanOf(da, cable.a.port), nb = nativeVlanOf(db, cable.b.port);
  return na === nb ? null : { a: da, aVlan: na, b: db, bVlan: nb };
}

function carriedVlans(dev, port) {
  const def = DEVICE_TYPES[dev.type];
  if (port === 'PWR' || def.powerDevice) return new Set(); // power carries no data
  if (def.passthrough) return 'ALL';                       // copper is VLAN-blind
  const s = new Set([nativeVlanOf(dev, port)]);            // untagged VLAN always
  if (portMode(dev, port) === 'trunk') for (const v of allowedVlans(dev, port)) s.add(v);
  return s;
}
function portCarries(dev, port, v) {
  const c = carriedVlans(dev, port);
  return c === 'ALL' || c.has(v);
}
function sharedVlans(da, pa, db, pb) {
  const A = carriedVlans(da, pa), B = carriedVlans(db, pb);
  if (A === 'ALL' && B === 'ALL') return 'ALL';
  if (A === 'ALL') return B;
  if (B === 'ALL') return A;
  return new Set([...A].filter(v => B.has(v)));
}

function traceVlan(deviceId, port, v, side) {
  const seenPorts = new Set();   // "devId:port" — what the UI highlights
  const seenJacks = new Set();   // "devId:port:side" — what the walk actually visits
  const cables = new Set();
  const devices = new Set();
  const stack = [[deviceId, port, side === REAR ? REAR : FRONT]];
  while (stack.length) {
    const [dId, p, sd] = stack.pop();
    const jack = dId + ':' + p + ':' + sd;
    if (seenJacks.has(jack)) continue;
    const dev = deviceById(dId);
    if (!dev || !portCarries(dev, p, v)) continue;
    seenJacks.add(jack);
    seenPorts.add(dId + ':' + p);
    devices.add(dId);
    const def = DEVICE_TYPES[dev.type];
    // hop across the cable plugged into this specific jack
    for (const c of state.cables) {
      let other = null;
      if (c.a.deviceId === dId && c.a.port === p && epSide(c.a) === sd) other = c.b;
      else if (c.b.deviceId === dId && c.b.port === p && epSide(c.b) === sd) other = c.a;
      if (!other) continue;
      const od = deviceById(other.deviceId);
      if (od && portCarries(od, other.port, v)) {
        cables.add(c.id);
        stack.push([other.deviceId, other.port, epSide(other)]);
      }
    }
    if (def.passthrough) {
      // a patch port is a straight-through copper pair: front jack and rear
      // punchdown are the same electrical circuit, and it bridges nothing else
      stack.push([dId, p, sd === REAR ? FRONT : REAR]);
    } else if (def.ports > 1) {
      // switch fabric bridges every port carrying v
      for (let q = 1; q <= def.ports; q++) {
        if (q !== p && portCarries(dev, q, v)) stack.push([dId, q, FRONT]);
      }
    }
  }
  return { vlan: v, cables, devices, ports: seenPorts };
}

let vlanFocus = null;
function vlanColor(v) {
  return new THREE.Color().setHSL(((v * 47) % 360) / 360, 0.8, 0.55);
}
function setVlanFocus(f) {
  vlanFocus = f;
  for (const [id, m] of cableMeshes) {
    const inSet = !f || f.cables.has(id);
    m.material.transparent = !inSet;
    m.material.opacity = inSet ? 1 : 0.07;
    m.material.needsUpdate = true;
  }
  // pulses respawn with the right VLAN color
  for (const p of pulses.values()) scene.remove(p.mesh);
  pulses.clear();
  refreshPortTints();
}

//////////////////// Network simulation (L2/L3 reachability) ////////////////////
// Answers the question a diagram can't: can host A actually reach host B, and if
// not, exactly why. Built on the same VLAN model the rest of the app uses — a
// port carries an access VLAN plus optional tagged trunks, a switch bridges every
// port on a VLAN, a patch panel is a straight passthrough — plus an IP/subnet
// layer and gateway-based routing on top. This is the Packet-Tracer core: the
// value is the honest failure reason, not just red/green.

// TIA-568 distinguishes two lengths and they mean different things:
//   permanent link — the fixed cable, outlet to patch panel:      90 m (295 ft)
//   channel        — permanent link plus patch cords at both ends: 100 m (328 ft)
// A run over the channel limit does not pass traffic, so l2Walk refuses it.
// A run between 90 and 100 m is legal only if the patch cords fit inside the
// remaining allowance, which is why exceeding the permanent link is a warning
// rather than a failure.
const COPPER_LIMIT_FT = 328;        // 100 m channel — hard failure
const PERMANENT_LINK_FT = 295;      // 90 m permanent link — warn past this

// ---- IP / subnet math (v4) ----
function parseIp(str) {
  if (!str) return null;
  const s = String(str).trim();
  let cidr = 24, addr = s, mask = null;
  let m = s.match(/^(\d+\.\d+\.\d+\.\d+)\s*\/\s*(\d+)$/);
  if (m) { addr = m[1]; cidr = parseInt(m[2], 10); }
  else if ((m = s.match(/^(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)$/))) { addr = m[1]; mask = m[2]; }
  else if (!/^\d+\.\d+\.\d+\.\d+$/.test(s)) return null;
  const oct = addr.split('.').map(Number);
  if (oct.length !== 4 || oct.some(o => o < 0 || o > 255 || Number.isNaN(o))) return null;
  const int = ((oct[0] << 24) | (oct[1] << 16) | (oct[2] << 8) | oct[3]) >>> 0;
  if (mask) {
    const mo = mask.split('.').map(Number);
    const mi = ((mo[0] << 24) | (mo[1] << 16) | (mo[2] << 8) | mo[3]) >>> 0;
    cidr = 0; let mm = mi; while (mm & 0x80000000) { cidr++; mm = (mm << 1) >>> 0; }
  }
  if (cidr < 0 || cidr > 32) return null;
  const maskInt = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
  return { addr, int, cidr, mask: maskInt, network: (int & maskInt) >>> 0 };
}
function ipStr(int) { return [(int >>> 24) & 255, (int >>> 16) & 255, (int >>> 8) & 255, int & 255].join('.'); }
function sameSubnet(a, b) {
  if (!a || !b) return false;
  const m = Math.min(a.mask, b.mask) >>> 0;   // compare on the wider mask
  return ((a.int & m) >>> 0) === ((b.int & m) >>> 0) && a.cidr === b.cidr;
}
function subnetLabel(ip) { return ip ? `${ipStr(ip.network)}/${ip.cidr}` : '—'; }
// Does a bare address fall inside an interface's subnet? Distinct from
// sameSubnet(), which compares two prefixes and requires equal mask lengths.
function ipInSubnet(addrInt, net) {
  return !!net && ((addrInt & net.mask) >>> 0) === (net.network >>> 0);
}

// ---- device role in the network graph ----
// A device's network role is DECLARED by its catalog entry, never inferred.
// The old version guessed "8 or more ports means switch", which misclassified
// a 5-port desk switch as a host and a 4-NIC server as a switch. Role is a
// property of the product, so the product data has to carry it.
function netClass(dev) {
  const def = DEVICE_TYPES[dev.type];
  if (!def) return 'other';
  if (def.role) return def.role;                // explicit wins, always
  if (def.manager) return 'manager';
  if (def.powerDevice) return 'power';
  if (def.passthrough) return 'patch';
  if (def.isInternet) return 'internet';
  if (def.isDemarc || def.isCpeTerm) return 'wanterm';
  // Anything reaching here has no declared role — that is a catalog gap, not
  // something to paper over with a guess. Flag it loudly in dev and treat it as
  // a host, the least destructive assumption.
  if (!netClass._warned) netClass._warned = new Set();
  if (!netClass._warned.has(dev.type)) {
    netClass._warned.add(dev.type);
    console.warn(`netClass: ${dev.type} has no declared role in DEVICE_TYPES — add role: 'switch'|'router'|'host'`);
  }
  return 'host';
}
function isHostDev(dev) { return isPlaced(dev) && netClass(dev) === 'host' && hostNics(dev).length > 0; }

//////////////////// Simulation clock ////////////////////
// Protocol timers are real: a one-day DHCP lease is 86400 seconds, a MAC entry
// ages at 300 s. Nobody is going to sit here for a day to watch a lease renew,
// so the simulator has a clock you can wind forward. This is a time machine,
// not a shortened timer — the durations stay true to life and the clock moves.
let _simSkewMs = 0;
function simNow() { return Date.now() + _simSkewMs; }
function simResetClock() { _simSkewMs = 0; }
// Winding the clock forward is a discrete-event advance, not a single jump.
// Jumping straight to the target silently skips every timer that should have
// fired on the way — a day-long jump would step over the T1 renewal at the
// halfway mark and report the lease as expired when a real client would have
// renewed it. So we stop at each pending event, in order, and run it.
function simAdvance(secs) {
  const target = simNow() + secs * 1000;
  let guard = 0;
  while (guard++ < 2000) {
    const next = dhcpNextEventAt();
    if (!isFinite(next) || next > target) break;
    _simSkewMs += Math.max(1, next - simNow() + 1);   // land just past the event
    dhcpTick();
  }
  _simSkewMs += Math.max(0, target - simNow());
  dhcpTick();
  return simNow();
}
// The soonest lease timer that has not fired yet.
function dhcpNextEventAt() {
  const now = simNow();
  let next = Infinity;
  for (const b of _dhcpBindings.values()) {
    if (b.state === 'EXPIRED') continue;
    for (const t of [b.t1At, b.t2At, b.expiresAt]) {
      if (isFinite(t) && t > now && t < next) next = t;
    }
  }
  return next;
}
// "2d 03:14:07" / "00:04:30" — the way IOS prints a lease remaining
function fmtDur(ms) {
  if (!isFinite(ms)) return 'Infinite';
  if (ms <= 0) return 'expired';
  let s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const hms = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return d ? `${d}d ${hms}` : hms;
}

//////////////////// DHCP ////////////////////
// Built to RFC 2131 (protocol + lease state machine), RFC 2132 (options) and
// Cisco IOS behaviour, rather than to "hand out the next free address":
//
//   * a server holds SCOPES — one per subnet — not one pool per device
//   * DORA is genuinely exchanged (DISCOVER/OFFER/REQUEST/ACK, or NAK), and the
//     packet log is what the UI prints
//   * every lease has a duration with T1 at 0.5x and T2 at 0.875x of it
//     (RFC 2131 s4.4.5), and on expiry the client MUST stop using the address
//   * addresses can be excluded, reserved by MAC, and are probed for conflicts
//     before being offered — IOS pings twice with a 500 ms timeout
//   * a subnet with no local server is served by a RELAY: the relay stamps
//     giaddr with its own interface address and the server chooses the scope
//     matching giaddr, not the interface the packet arrived on
//
// Defaults are the IOS ones so the CLI will agree with the engine later.
const DHCP_DEFAULT_LEASE_S = 24 * 3600;   // IOS: one day when no lease is set
const DHCP_T1_FRAC = 0.5;                 // RFC 2131 s4.4.5
const DHCP_T2_FRAC = 0.875;
const DHCP_PING_PACKETS = 2;              // ip dhcp ping packets
const DHCP_PING_TIMEOUT_MS = 500;         // ip dhcp ping timeout
// RFC 2132 option codes, plus Cisco's option 150 (TFTP server address).
const DHCP_OPT = { mask: 1, router: 3, dns: 6, hostname: 12, domain: 15,
  broadcast: 28, leaseTime: 51, msgType: 53, serverId: 54, paramList: 55,
  t1: 58, t2: 59, clientId: 61, tftpName: 66, bootfile: 67, tftpIp: 150 };

// Option 61 for Ethernet is hardware type 01 followed by the MAC. IOS prints it
// in the Client-ID column of `show ip dhcp binding` grouped in fours, e.g.
// 0100.5079.6668.f1 — 14 hex digits, so the last group is a pair.
function dhcpClientId(dev, port) {
  const hex = '01' + nicMac(dev, port).replace(/:/g, '').toLowerCase();
  return hex.match(/.{1,4}/g).join('.');
}
// Leases are per NIC, not per device — a dual-homed host DHCPs twice, with two
// MACs, and gets two independent leases on two subnets.
function leaseKey(devId, port) { return `${devId}:${port}`; }

// Bindings survive topology edits, exactly as a real client keeps its address
// when you re-cable a switch. They only end at expiry, release, or a NAK.
const _dhcpBindings = new Map();          // `${serverId}|${clientId}` -> binding
const _dhcpConflicts = new Map();         // serverId -> [{ ip, at, method }]
let _dhcpLeases = new Map();              // hostId -> binding (index for hostIp)
let _dhcpLog = [];                        // packet log of the last resolve

function broadcastOf(ip) { return ((ip.network | (~ip.mask >>> 0)) >>> 0); }
function leaseSecsOf(pool) {
  if (!pool) return DHCP_DEFAULT_LEASE_S;
  if (pool.lease === 'infinite') return Infinity;
  const l = pool.lease;
  if (!l) return DHCP_DEFAULT_LEASE_S;
  const s = (+l.days || 0) * 86400 + (+l.hours || 0) * 3600 + (+l.minutes || 0) * 60;
  return s > 0 ? s : DHCP_DEFAULT_LEASE_S;
}
function leaseLabel(pool) {
  const s = leaseSecsOf(pool);
  if (!isFinite(s)) return 'infinite';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ') || `${s}s`;
}

// Every scope a server holds, normalised. A scope without a valid network
// statement is not a scope — IOS will not activate a pool with no network.
function dhcpPools(server) {
  const d = server.dhcp;
  if (!d || !d.enabled) return [];
  return (d.pools || []).map((p, i) => {
    const net = parseIp(p.network);
    if (!net) return null;
    // Absent an explicit range, the scope is the whole subnet: IOS allocates
    // from the network statement and you carve it back with excluded-address.
    const lo = parseIp(p.poolStart), hi = parseIp(p.poolEnd);
    const start = lo ? lo.int : (net.network + 1) >>> 0;
    const end = hi ? hi.int : (broadcastOf(net) - 1) >>> 0;
    return { ...p, name: p.name || `POOL${i + 1}`, net, start: Math.min(start, end),
      end: Math.max(start, end), leaseSecs: leaseSecsOf(p) };
  }).filter(Boolean);
}
// `ip dhcp excluded-address` is a GLOBAL command on IOS, not a pool subcommand,
// so it lives on the device and applies to every scope it overlaps.
function dhcpExcluded(server) {
  return ((server.dhcp && server.dhcp.excluded) || []).map(r => {
    const a = parseIp(r.from), b = parseIp(r.to || r.from);
    return a ? { from: a.int, to: b ? Math.max(a.int, b.int) : a.int } : null;
  }).filter(Boolean);
}
function isExcluded(server, int) {
  return dhcpExcluded(server).some(r => int >= r.from && int <= r.to);
}
// A reservation is a manual binding: IOS `host <ip>` + `hardware-address` or
// `client-identifier` inside a pool. It is matched before any dynamic address.
function reservationFor(pool, mac, clientId) {
  const m = (mac || '').toLowerCase(), c = (clientId || '').toLowerCase();
  return (pool.reservations || []).find(r =>
    (r.mac && r.mac.toLowerCase().replace(/[.:-]/g, '') === m.replace(/[.:-]/g, '')) ||
    (r.clientId && r.clientId.toLowerCase() === c)) || null;
}

// Conflict detection. IOS pings a candidate address before offering it; an
// answer means somebody is squatting the address and it goes on the conflict
// list instead of being handed out. Our "ping" is authoritative rather than
// probabilistic: we know exactly which devices hold which static addresses.
function dhcpProbe(server, int) {
  for (const d of state.devices) {
    if (!d.ip || d.ip === 'dhcp' || !isPlaced(d)) continue;
    const p = parseIp(d.ip);
    if (p && p.int === int) return d;
  }
  for (const d of state.devices) {                       // router interfaces too
    for (const i of deviceInterfaces(d)) if (i.ip.int === int) return d;
  }
  return null;
}
function noteConflict(serverId, int, holder) {
  let list = _dhcpConflicts.get(serverId);
  if (!list) _dhcpConflicts.set(serverId, list = []);
  if (!list.some(c => c.ip === ipStr(int))) {
    list.push({ ip: ipStr(int), at: simNow(), method: 'Ping', holder: holder ? holder.name : '?' });
  }
}
// Addresses this server has already committed, so two clients never collide.
// A client's own binding is not an obstacle to itself — that is what makes a
// renewal keep the same address instead of walking up the pool every T1.
function leasedInts(serverId, exceptClientId) {
  const s = new Set();
  for (const b of _dhcpBindings.values()) {
    if (b.serverId !== serverId || b.state === 'EXPIRED') continue;
    if (exceptClientId && b.clientId === exceptClientId) continue;
    s.add(b.ipInt);
  }
  return s;
}

// Which servers can serve this client, and how the request reaches them.
// Direct: the server has an interface in the client's segment and a scope for
// that subnet. Relayed: a router on the segment carries `ip helper-address`,
// stamps giaddr with its own address here, and forwards to the helper.
function dhcpServerCandidates(client, walk, vlan) {
  const out = [];
  const seen = new Set();
  const addDirect = (sv, ifaceIpParsed) => {
    if (!sv || !sv.dhcp || !sv.dhcp.enabled || seen.has(sv.id)) return;
    const pool = dhcpPools(sv).find(p => sameSubnet(p.net, ifaceIpParsed));
    if (!pool) return;
    seen.add(sv.id);
    out.push({ server: sv, pool, via: 'direct', giaddr: null, serverIp: ifaceIpParsed });
  };
  for (const [rid, jack] of walk.routers) {
    const sv = deviceById(rid);
    const iface = sv && ifaceIp(sv, jack.port, vlan);
    if (iface) addDirect(sv, iface.ip);
  }
  for (const hid of walk.hosts) {                        // a server appliance/VM
    const sv = deviceById(hid);
    const ip = sv && sv.ip && sv.ip !== 'dhcp' ? parseIp(sv.ip) : null;
    if (ip) addDirect(sv, ip);
  }
  // Relay. The helper is configured on the interface facing the client, which
  // is the interface whose address becomes giaddr.
  for (const [rid, jack] of walk.routers) {
    const relay = deviceById(rid);
    if (!relay) continue;
    const iface = ifaceIp(relay, jack.port, vlan);
    if (!iface) continue;
    for (const helperStr of helpersOn(relay, iface)) {
      const helper = parseIp(helperStr);
      if (!helper) continue;
      const sv = deviceHolding(helper);
      if (!sv || !sv.dhcp || !sv.dhcp.enabled) {
        out.push({ error: `${relay.name} relays to ${helperStr}, but no DHCP server holds that address`, via: 'relay', relay });
        continue;
      }
      // The relay unicasts to the helper, so it must have a route to it. Until
      // routing tables land (roadmap item 9) that means directly connected.
      const reachable = deviceInterfaces(relay).some(i => sameSubnet(i.ip, helper));
      if (!reachable) {
        out.push({ error: `${relay.name} has no interface in ${subnetLabel(helper)} — it cannot reach helper ${helperStr}`, via: 'relay', relay });
        continue;
      }
      // giaddr selects the scope — this is the whole point of relaying.
      const pool = dhcpPools(sv).find(p => sameSubnet(p.net, iface.ip));
      if (!pool) {
        out.push({ error: `${sv.name} has no scope for ${subnetLabel(iface.ip)} (giaddr ${ipStr(iface.ip.int)})`, via: 'relay', relay });
        continue;
      }
      out.push({ server: sv, pool, via: 'relay', relay, giaddr: iface.ip, serverIp: helper });
    }
  }
  return out;
}
// `ip helper-address` is an interface command, so helpers are keyed by the
// interface name deviceInterfaces() reports.
function helpersOn(dev, iface) {
  const h = dev.helpers || {};
  const key = iface.kind === 'svi' ? `Vlan${iface.vlan}` : `Port ${iface.port}`;
  const v = h[key];
  return Array.isArray(v) ? v : (v ? [v] : []);
}
function deviceHolding(ipParsed) {
  for (const d of state.devices) {
    if (d.ip && d.ip !== 'dhcp') { const p = parseIp(d.ip); if (p && p.int === ipParsed.int) return d; }
    for (const i of deviceInterfaces(d)) if (i.ip.int === ipParsed.int) return d;
  }
  return null;
}

// Choose an address, in RFC 2131 s4.3.1 order: the client's existing binding,
// then its requested address if it is free and in range, then the next free
// address in the scope.
function selectAddress(cand, client, requested) {
  const { server, pool } = cand;
  const mac = deviceMac(client), cid = dhcpClientId(client);
  const res = reservationFor(pool, mac, cid);
  if (res) {
    const r = parseIp(res.ip);
    if (r) return { int: r.int, type: 'Manual' };
    return { error: `reservation for ${client.name} has an invalid address "${res.ip}"` };
  }
  const taken = leasedInts(server.id, cid);
  const free = (int) => {
    if (int <= pool.net.network || int >= broadcastOf(pool.net)) return false;
    if (taken.has(int) || isExcluded(server, int)) return false;
    return true;
  };
  const prior = _dhcpBindings.get(`${server.id}|${cid}`);
  if (prior && prior.state !== 'EXPIRED' && free(prior.ipInt)) return { int: prior.ipInt, type: 'Automatic' };
  if (requested && free(requested) && requested >= pool.start && requested <= pool.end) {
    return { int: requested, type: 'Automatic' };
  }
  for (let a = pool.start; a <= pool.end; a++) {
    if (!free(a)) continue;
    const holder = dhcpProbe(server, a);               // ip dhcp ping, 2 x 500 ms
    if (holder) { noteConflict(server.id, a, holder); taken.add(a); continue; }
    return { int: a, type: 'Automatic' };
  }
  return { error: `scope ${pool.name} (${subnetLabel(pool.net)}) is exhausted` };
}

// The options a scope hands back with an ACK.
function poolOptions(pool) {
  const o = {};
  o[DHCP_OPT.mask] = ipStr(pool.net.mask);
  if (pool.defaultRouter) o[DHCP_OPT.router] = pool.defaultRouter;
  if (pool.dns && pool.dns.length) o[DHCP_OPT.dns] = [].concat(pool.dns).join(', ');
  if (pool.domain) o[DHCP_OPT.domain] = pool.domain;
  if (pool.tftp) o[DHCP_OPT.tftpIp] = pool.tftp;
  return o;
}

// One DORA exchange. Returns the binding and the packets, or the reason it
// failed — the reason is what the UI shows, so it has to be the real one.
function dhcpExchange(client, opts = {}) {
  const log = [];
  const port = opts.port !== undefined ? opts.port : hostPort(client);
  const vlan = hostVlan(client, port);
  const walk = l2Walk(client, { vlan, startPort: port });
  const mac = nicMac(client, port), cid = dhcpClientId(client, port);
  const say = (msg, dir, detail) => log.push({ client: client.name, msg, dir, detail });

  if (!walk.start) {
    return { ok: false, reason: walk.overLength
      ? `${client.name}'s drop cable is over the 100 m channel limit — no link, so no DHCP`
      : (linkDownReason(client, port) || `${client.name} isn't cabled to anything`), log };
  }
  // Three ways a client asks, and they are genuinely different exchanges:
  //   INIT      full DORA, broadcast, any server may answer
  //   RENEWING  unicast REQUEST to the server that granted the lease (RFC 2131
  //             s4.4.5) — no DISCOVER, and no other server may answer
  //   REBINDING broadcast REQUEST, any server that knows the binding may ACK
  const mode = opts.mode || 'INIT';
  if (mode === 'INIT') {
    say('DHCPDISCOVER', '→', `broadcast · xid, chaddr ${mac}, option 55 (mask, router, dns, domain)`);
  }

  const cands = dhcpServerCandidates(client, walk, vlan);
  let usable = cands.filter(c => c.server);
  if (mode === 'RENEWING') usable = usable.filter(c => c.server.id === opts.serverId);
  if (!usable.length) {
    const why = cands.find(c => c.error);
    if (mode === 'RENEWING') {
      return { ok: false, reason: `${client.name} can't reach the server that issued its lease`, log };
    }
    return { ok: false, reason: why ? why.error
      : `no DHCP server in ${client.name}'s broadcast domain (VLAN ${vlan}) and no relay configured`, log };
  }
  // Client takes the first offer, which is what real clients do.
  const cand = usable[0];
  const { server, pool } = cand;
  if (cand.via === 'relay' && mode === 'INIT') {
    say('DHCPDISCOVER', '↦', `relayed by ${cand.relay.name}, giaddr ${ipStr(cand.giaddr.int)} → ${server.name}`);
  }
  const requested = opts.requested !== undefined ? opts.requested : null;
  const pick = selectAddress(cand, client, requested);
  if (pick.error) return { ok: false, reason: `${server.name}: ${pick.error}`, log };
  // A renewing client that cannot keep its address gets a NAK and starts over,
  // rather than silently sliding onto a different address.
  if (mode !== 'INIT' && requested && pick.int !== requested) {
    say('DHCPNAK', '←', `${server.name} refuses ${ipStr(requested)} — client returns to INIT`);
    return { ok: false, nak: true, reason: `${client.name}'s address ${ipStr(requested)} is no longer valid in ${pool.name}`, log };
  }

  const secs = pool.leaseSecs;
  if (mode === 'INIT') {
    say('DHCPOFFER', '←', `${server.name} offers ${ipStr(pick.int)} · lease ${leaseLabel(pool)}`);
    say('DHCPREQUEST', '→', `broadcast · option 50 ${ipStr(pick.int)}, option 54 ${ipStr(cand.serverIp.int)}`);
  } else {
    say('DHCPREQUEST', '→', mode === 'RENEWING'
      ? `unicast to ${server.name} ${ipStr(cand.serverIp.int)} · ciaddr ${ipStr(pick.int)} (T1 reached)`
      : `broadcast · ciaddr ${ipStr(pick.int)} (T2 reached, rebinding)`);
  }

  const now = simNow();
  const ms = isFinite(secs) ? secs * 1000 : Infinity;
  const binding = {
    clientId: cid, mac, hostId: client.id, hostNic: port, serverId: server.id, poolName: pool.name,
    ip: ipStr(pick.int), ipInt: pick.int, type: pick.type,
    boundAt: now, leaseSecs: secs,
    t1At: now + (isFinite(ms) ? ms * DHCP_T1_FRAC : Infinity),
    t2At: now + (isFinite(ms) ? ms * DHCP_T2_FRAC : Infinity),
    expiresAt: now + ms,
    state: 'BOUND', renewals: opts.renewals || 0,
    via: cand.via, giaddr: cand.giaddr ? ipStr(cand.giaddr.int) : null,
    relayName: cand.relay ? cand.relay.name : null,
    subnet: subnetLabel(pool.net), options: poolOptions(pool)
  };
  _dhcpBindings.set(`${server.id}|${cid}`, binding);
  const opt = binding.options;
  say('DHCPACK', '←', `${ipStr(pick.int)}/${pool.net.cidr} · router ${opt[3] || 'none'} · dns ${opt[6] || 'none'} · T1 ${fmtDur(isFinite(ms) ? ms * DHCP_T1_FRAC : Infinity)} · T2 ${fmtDur(isFinite(ms) ? ms * DHCP_T2_FRAC : Infinity)}`);
  return { ok: true, binding, log };
}

// Advance every binding against the clock. This is the RFC 2131 client state
// machine: BOUND → RENEWING at T1 (unicast to the leasing server) → REBINDING
// at T2 (broadcast to any server) → EXPIRED, at which point the client must
// stop using the address.
// The per-host index the rest of the engine reads. An expired lease is not in
// it: RFC 2131 s4.4.5 requires the client to stop using the address the moment
// the lease runs out, so an expired host has no address at all.
function indexLeases() {
  _dhcpLeases = new Map();
  for (const b of _dhcpBindings.values()) {
    if (b.state !== 'EXPIRED') _dhcpLeases.set(leaseKey(b.hostId, b.hostNic), b);
  }
  return _dhcpLeases;
}

function dhcpTick() {
  const now = simNow();
  for (const [key, b] of [..._dhcpBindings]) {
    if (!isFinite(b.expiresAt)) continue;
    const client = deviceById(b.hostId);
    if (!client) { _dhcpBindings.delete(key); continue; }
    if (now >= b.expiresAt) {
      // Lease ran out with no successful renewal. Try a fresh DORA — if a
      // server is still there the client re-leases, otherwise it goes dark.
      _dhcpBindings.delete(key);
      const again = dhcpExchange(client, { port: b.hostNic, renewals: 0 });
      if (!again.ok) {
        b.state = 'EXPIRED';
        _dhcpBindings.set(key, b);
      }
      continue;
    }
    if (now >= b.t2At && b.state !== 'REBINDING') b.state = 'REBINDING';
    else if (now >= b.t1At && b.state === 'BOUND') b.state = 'RENEWING';
    // A client in RENEWING/REBINDING that can still reach a server gets an ACK
    // and its timers reset from the new lease — same address, new clock. If it
    // can't, it stays in that state and keeps using the address until expiry,
    // which is exactly what a real client does when a server goes away.
    if (b.state === 'RENEWING' || b.state === 'REBINDING') {
      const r = dhcpExchange(client, {
        mode: b.state, serverId: b.serverId, requested: b.ipInt,
        port: b.hostNic, renewals: (b.renewals || 0) + 1
      });
      if (!r.ok && r.nak) { _dhcpBindings.delete(key); dhcpExchange(client, { port: b.hostNic }); }
    }
  }
  indexLeases();
}

// Make sure every host asking for DHCP has had a chance to lease, then rebuild
// the per-host index the rest of the engine reads.
function resolveDhcp() {
  dhcpTick();
  _dhcpLog = [];
  const askers = state.devices
    .filter(d => isPlaced(d) && netClass(d) === 'host')
    .sort((a, b) => a.id - b.id);
  for (const h of askers) {
    for (const n of hostNics(h)) {
      if (n.ip !== 'dhcp') continue;
      const cid = dhcpClientId(h, n.port);
      let has = null;
      for (const b of _dhcpBindings.values()) if (b.clientId === cid && b.state !== 'EXPIRED') { has = b; break; }
      if (has) continue;
      const r = dhcpExchange(h, { port: n.port });
      _dhcpLog.push({ host: h, nic: n.port, ...r });
    }
  }
  return indexLeases();
}
// `clear ip dhcp binding *`
function dhcpClearBindings() { _dhcpBindings.clear(); _dhcpLeases = new Map(); }
// A client giving the address back before the lease is up.
function dhcpRelease(hostId, port) {
  for (const [k, b] of [..._dhcpBindings]) {
    if (b.hostId === hostId && (port === undefined || b.hostNic === port)) _dhcpBindings.delete(k);
  }
  indexLeases();
}

// A specific NIC's address. Leases are keyed per NIC because each NIC DHCPs
// separately with its own MAC — a dual-homed host really does get two leases.
function nicIp(dev, port) {
  const nics = hostNics(dev);
  const n = port === undefined ? nics[0] : nics.find(x => x.port === port);
  if (!n) return null;
  if (n.ip === 'dhcp') {
    const l = _dhcpLeases.get(leaseKey(dev.id, n.port));
    return l ? parseIp(`${l.ip}/${parseIp(l.subnet).cidr}`) : null;
  }
  return parseIp(n.ip);
}
function hostIp(dev, port) { return nicIp(dev, port === undefined ? hostPort(dev) : port); }
// display string for a host's address, resolving a lease
function nicAddr(dev, port) {
  const n = hostNics(dev).find(x => x.port === port);
  if (!n) return '—';
  if (n.ip === 'dhcp') {
    const l = _dhcpLeases.get(leaseKey(dev.id, port));
    return l ? `${l.ip} (DHCP)` : 'dhcp (no lease)';
  }
  return n.ip || '—';
}
function hostAddr(dev) {
  const nics = hostNics(dev);
  if (nics.length > 1) return nics.map(n => nicAddr(dev, n.port)).join(' / ');
  return nics.length ? nicAddr(dev, nics[0].port) : (dev.ip || '—');
}
// The gateway a DHCP client was told to use (option 3) — a leased host has no
// business inventing one, and a wrong option 3 is a real and common fault.
function dhcpGateway(dev, port) {
  const l = _dhcpLeases.get(leaseKey(dev.id, port === undefined ? hostPort(dev) : port));
  return l && l.options ? l.options[DHCP_OPT.router] || null : null;
}

//////////////////// Layer-3 interface addressing ////////////////////
// A router does not have "an IP" — it has an address on every interface, and
// that is what makes it a gateway for a given subnet. Treating a router as a
// single address meant any router on a segment was assumed to route any subnet,
// which is not how routing works and hid real misconfigurations.
//
// Two ways an L3 device addresses a segment, both real:
//   * routed port  — portCfg[port].ip, e.g. a WAN port or a point-to-point link
//   * SVI          — dev.svi[vlan], the "interface Vlan20" a gateway uses to
//                    route between VLANs (router-on-a-stick, or an L3 switch)
// If a device has neither on a segment, it is NOT a gateway there, full stop.
function ifaceIp(dev, port, vlan) {
  const pc = (dev.portCfg && dev.portCfg[port]) || {};
  if (pc.ip) { const p = parseIp(pc.ip); if (p) return { ip: p, kind: 'routed', port }; }
  if (vlan !== undefined && dev.svi && dev.svi[vlan]) {
    const p = parseIp(dev.svi[vlan]);
    if (p) return { ip: p, kind: 'svi', vlan };
  }
  return null;
}

// Every addressed interface on a device — for inspectors and "show ip int br".
function deviceInterfaces(dev) {
  const out = [];
  const def = DEVICE_TYPES[dev.type] || {};
  for (let p = 1; p <= (def.ports || 0); p++) {
    const pc = (dev.portCfg && dev.portCfg[p]) || {};
    if (pc.ip) { const ip = parseIp(pc.ip); if (ip) out.push({ name: `Port ${p}`, port: p, ip, kind: 'routed' }); }
  }
  for (const [v, addr] of Object.entries(dev.svi || {})) {
    const ip = parseIp(addr);
    if (ip) out.push({ name: `Vlan${v}`, vlan: +v, ip, kind: 'svi' });
  }
  return out;
}

// The gateway serving a host: a router reachable at L2 that actually holds an
// address inside the host's subnet. Returns { id, iface } or a reason it fails,
// so the verdict can name the real problem instead of "no route".
function gatewayForHost(host, walk, hostIpParsed, port) {
  const nicPort = port === undefined ? hostPort(host) : port;
  const vlan = hostVlan(host, nicPort);
  const candidates = [];
  for (const rid of walk.routers.keys()) {
    const r = deviceById(rid);
    const jack = walk.routers.get(rid);
    const iface = ifaceIp(r, jack.port, vlan);
    if (iface && sameSubnet(iface.ip, hostIpParsed)) candidates.push({ id: rid, iface, router: r });
  }
  // A configured default gateway must actually exist on the segment — a wrong
  // or stale gateway address is one of the most common real faults. For a DHCP
  // client the gateway is whatever option 3 said, not a guess: if the scope
  // hands out the wrong router, the client really is broken and must say so.
  const nic = hostNics(host).find(n => n.port === nicPort) || {};
  const viaDhcp = nic.ip === 'dhcp' ? dhcpGateway(host, nicPort) : null;
  const declared = viaDhcp || nic.gateway || host.gateway;
  if (declared) {
    const src = viaDhcp ? `DHCP option 3` : `default gateway`;
    const want = parseIp(declared);
    if (!want) return { error: `${host.name} has an invalid ${src} "${declared}"` };
    const match = candidates.find(c => c.iface.ip.int === want.int);
    if (!match) {
      return { error: candidates.length
        ? `${host.name}'s ${src} ${declared} isn't on this segment — the router here answers on ${candidates.map(c => ipStr(c.iface.ip.int)).join(', ')}`
        : `${host.name}'s ${src} ${declared} is unreachable — no router on this segment holds that address` };
    }
    return match;
  }
  if (!candidates.length) {
    const seen = [...walk.routers.keys()].map(id => deviceById(id).name);
    return { error: seen.length
      ? `${seen.join(', ')} ${seen.length === 1 ? 'is' : 'are'} reachable but ${seen.length === 1 ? 'has' : 'have'} no interface in ${subnetLabel(hostIpParsed)} — no gateway for this subnet`
      : `${host.name}'s subnet ${subnetLabel(hostIpParsed)} has no router reachable` };
  }
  return candidates[0];
}

// data (non-power) port a host actually uses — its first real port
// Why a port has no usable link, for messages that would otherwise say "not
// cabled" about a cable that is plugged in at both ends.
function linkDownReason(dev, port) {
  const c = state.cables.find(x =>
    (x.a.deviceId === dev.id && x.a.port === port) || (x.b.deviceId === dev.id && x.b.port === port));
  if (!c) return `${dev.name} port ${port} has nothing plugged into it`;
  const l = negotiateLink(c);
  if (l && !l.up) return l.reason;
  return null;
}
function hostPort(dev) {
  const def = DEVICE_TYPES[dev.type];
  for (let p = 1; p <= (def.ports || 1); p++) {
    if (portRole(def, p) !== 'PWR') return p;
  }
  return 1;
}

// ---- Host NICs ----
// A host is not one address on one port. A server has a data NIC and a
// management NIC; a workstation may be on wired and wireless at once; a
// firewall host has an inside and an outside leg. Each NIC has its own port,
// address, gateway and MAC, and lands in whatever VLAN its switch port is in.
//
// `dev.ip` remains the primary NIC's address so every existing map still loads
// and every single-homed device keeps working untouched.
function hostNics(dev) {
  const def = DEVICE_TYPES[dev.type] || {};
  const cfg = dev.nics || {};
  const primary = hostPort(dev);
  const out = [];
  for (let p = 1; p <= (def.ports || 1); p++) {
    if (portRole(def, p) === 'PWR') continue;
    if (cfg[p]) {
      out.push({ port: p, ip: cfg[p].ip, gateway: cfg[p].gateway,
        label: cfg[p].label || `NIC${out.length + 1}`, primary: p === primary });
    } else if (p === primary && dev.ip) {
      out.push({ port: p, ip: dev.ip, gateway: dev.gateway, label: 'NIC1', primary: true });
    }
  }
  return out;
}
// Each NIC has its own MAC. The primary keeps the device MAC so bridge IDs,
// existing DHCP bindings and MAC tables are unchanged.
function nicMac(dev, port) {
  if (port === undefined || port === hostPort(dev)) return deviceMac(dev);
  const id = dev.id >>> 0;
  return [0x02, port & 0xff, (id >>> 24) & 0xff, (id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff]
    .map(v => v.toString(16).padStart(2, '0').toUpperCase()).join(':');
}
// The NIC a host sends from, chosen the way a host routing table chooses:
// a NIC whose own subnet contains the destination wins (connected route),
// otherwise the first NIC with a default gateway.
function hostEgressNic(dev, dstInt) {
  const nics = hostNics(dev);
  if (!nics.length) return null;
  for (const n of nics) {
    const ip = nicIp(dev, n.port);
    if (ip && dstInt !== undefined && ipInSubnet(dstInt, ip)) return n;
  }
  for (const n of nics) {
    const gw = n.gateway || (n.ip === 'dhcp' ? dhcpGateway(dev, n.port) : null);
    if (gw && nicIp(dev, n.port)) return n;
  }
  return nics.find(n => nicIp(dev, n.port)) || nics[0];
}
// The VLAN an untagged host on this port lands in — its access VLAN, or the
// trunk's native VLAN if someone plugged a host into a trunk port.
function accessVlanOf(dev, port) { return nativeVlanOf(dev, port); }

// The neighbour on the far end of a jack, stepping straight through any patch
// panels (front↔rear is one circuit) so a drop lands on the switch it patches to.
function hopThroughPatches(dev, port, side) {
  let d = dev, p = port, s = side, guard = 0;
  while (guard++ < 40) {
    const cbl = state.cables.find(c =>
      (c.a.deviceId === d.id && c.a.port === p && epSide(c.a) === s) ||
      (c.b.deviceId === d.id && c.b.port === p && epSide(c.b) === s));
    if (!cbl) return null;
    const far = (cbl.a.deviceId === d.id && cbl.a.port === p && epSide(cbl.a) === s) ? cbl.b : cbl.a;
    const fd = deviceById(far.deviceId);
    if (!fd) return null;
    // A shutdown port, or one whose speed cannot be negotiated with its
    // partner, has no link — the cable is there and the light is not.
    if (cbl.a.port !== 'PWR' && cbl.b.port !== 'PWR') {
      const link = negotiateLink(cbl);
      if (link && !link.up) return null;
    }
    if (netClass(fd) === 'patch') { d = fd; p = far.port; s = epSide(far) === REAR ? FRONT : REAR; continue; }
    return { dev: fd, port: far.port, side: epSide(far), cable: cbl };
  }
  return null;
}

// The VLAN a host lives in = the access VLAN of the switch/router port it lands on.
function hostVlan(dev, port) {
  const p = port === undefined ? hostPort(dev) : port;
  const n = hopThroughPatches(dev, p, FRONT);
  return n ? accessVlanOf(n.dev, n.port) : accessVlanOf(dev, p);
}

// Breadth-first walk of the layer-2 domain from a host's data jack. Honors VLAN
// membership and the copper length limit unless told to relax them (the relaxed
// runs are how we diagnose *why* a ping failed). Returns which host and router
// devices were reached, and a predecessor map for path reconstruction.
function l2Walk(startDev, opts = {}) {
  const vlan = opts.vlan;
  const fromPort = opts.startPort || hostPort(startDev);
  const reachedHosts = new Set(), reachedRouters = new Map(); // routerId -> jack it was reached on
  const prev = new Map();                                     // "devId:port:side" -> previous key
  const seen = new Set();
  const start = hopThroughPatches(startDev, fromPort, FRONT);
  if (!start) return { hosts: reachedHosts, routers: reachedRouters, prev, start: null };
  // The first hop is a cable too. Checking length only when spreading from a
  // switch missed the most common case of all — an over-length drop cable on
  // the host itself, which passed as if it were fine.
  if (!opts.ignoreLength && start.cable && (start.cable.lengthIn || 0) / 12 > COPPER_LIMIT_FT) {
    return { hosts: reachedHosts, routers: reachedRouters, prev, start: null, overLength: true };
  }
  const startKey = `${start.dev.id}:${start.port}:${start.side}`;
  const q = [{ dev: start.dev, port: start.port, side: start.side, key: startKey }];
  prev.set(startKey, `${startDev.id}:${fromPort}:${FRONT}`);
  while (q.length) {
    const cur = q.shift();
    if (seen.has(cur.key)) continue;
    seen.add(cur.key);
    const cls = netClass(cur.dev);
    if (cls === 'router') { if (!reachedRouters.has(cur.dev.id)) reachedRouters.set(cur.dev.id, cur); continue; }
    if (cls === 'host') { reachedHosts.add(cur.dev.id); continue; }
    // switch (or multi-port bridge): spread to every other port on this VLAN,
    // then hop each to its neighbour through any patch panels
    if (cls === 'switch' || cls === 'patch') {
      // the frame must be admitted at the ingress port too — a trunk configured
      // on one end only drops it right here, which is a real misconfiguration
      // this walk needs to reproduce rather than paper over
      if (!opts.ignoreVlan && vlan !== undefined && !portCarries(cur.dev, cur.port, vlan)) continue;
      const def = DEVICE_TYPES[cur.dev.type];
      const nports = def.ports || 0;
      // a blocked port drops the frame — that's the whole point of STP, and it
      // is also what stops this walk looping forever on a redundant topology
      if (!opts.ignoreStp && cls === 'switch' && stpBlocked(cur.dev.id, cur.port, vlan)) continue;
      for (let q2 = 1; q2 <= nports; q2++) {
        if (q2 === cur.port) continue;
        if (!opts.ignoreVlan && vlan !== undefined && !portCarries(cur.dev, q2, vlan)) continue;
        if (!opts.ignoreStp && cls === 'switch' && stpBlocked(cur.dev.id, q2, vlan)) continue;
        const nb = hopThroughPatches(cur.dev, q2, FRONT);
        if (!nb) continue;
        if (!opts.ignoreLength && ((nb.cable && (nb.cable.lengthIn || 0) / 12) > COPPER_LIMIT_FT)) continue;
        const k = `${nb.dev.id}:${nb.port}:${nb.side}`;
        if (!prev.has(k)) prev.set(k, cur.key);
        q.push({ dev: nb.dev, port: nb.port, side: nb.side, key: k });
      }
    }
  }
  return { hosts: reachedHosts, routers: reachedRouters, prev, start };
}


//////////////////// PDU engine ////////////////////
// This is the difference between answering "can A reach B" and Packet Tracer.
// The reachability engine walks the topology and returns a verdict; this walks
// a real frame, hop by hop, and records what every device did with it and why.
//
// A PDU carries genuine layered headers whose fields come from device state —
// the source MAC is the sending NIC's MAC, the destination MAC is whatever ARP
// resolved, TTL decrements at every router, NAT rewrites the L3 source. Nothing
// here is decorative: if a field is wrong on screen it is wrong in the model.
//
// Events are processed from an ordered queue, one device handling one PDU per
// step, so the simulation can be stepped forward and back deterministically.
// No random timers anywhere — see the collaboration section of ROADMAP.md.

let _pduSeq = 0;
function newPdu(spec) {
  return {
    id: ++_pduSeq,
    proto: spec.proto || 'icmp',        // icmp | tcp | udp | arp
    l2: { srcMac: spec.srcMac || null, dstMac: spec.dstMac || null, vlan: spec.vlan, etherType: spec.proto === 'arp' ? 0x0806 : 0x0800 },
    l3: spec.proto === 'arp' ? null : {
      src: spec.srcInt, dst: spec.dstInt, ttl: spec.ttl === undefined ? 64 : spec.ttl,
      proto: spec.proto, icmpType: spec.icmpType || null
    },
    l4: (spec.proto === 'tcp' || spec.proto === 'udp') ? {
      srcPort: spec.srcPort, dstPort: spec.dstPort, flags: spec.flags || (spec.proto === 'tcp' ? 'SYN' : null)
    } : null,
    arp: spec.proto === 'arp' ? {
      op: spec.arpOp || 'request', senderMac: spec.srcMac, senderIp: spec.srcInt,
      targetMac: spec.arpOp === 'reply' ? spec.dstMac : '00:00:00:00:00:00', targetIp: spec.dstInt
    } : null,
    label: spec.label || null,
    origin: spec.origin || null
  };
}
function clonePdu(p) {
  return JSON.parse(JSON.stringify(p));
}
// Human-readable one-liner, the way the event list shows it.
function pduSummary(p) {
  if (p.proto === 'arp') {
    return p.arp.op === 'request'
      ? `ARP who has ${ipStr(p.arp.targetIp)}? tell ${ipStr(p.arp.senderIp)}`
      : `ARP ${ipStr(p.arp.senderIp)} is at ${p.arp.senderMac}`;
  }
  const port = p.l4 ? `:${p.l4.dstPort}` : '';
  const t = p.proto === 'icmp' ? ` ${p.l3.icmpType}` : (p.l4 && p.l4.flags ? ` [${p.l4.flags}]` : '');
  return `${p.proto.toUpperCase()}${t} ${ipStr(p.l3.src)} → ${ipStr(p.l3.dst)}${port}`;
}

// One simulation run: a queue of events, each "device D receives PDU P on
// interface I", plus the trace of what already happened.
function newPduSim() {
  return { queue: [], trace: [], step: 0, done: false, delivered: false, dropped: null };
}
function pduEnqueue(sim, ev) { sim.queue.push(ev); }

// Resolve a destination MAC the way a host does: ARP cache, or an ARP exchange
// that is itself simulated and appears in the trace. Returns the MAC plus the
// exchange it took, so the caller can show the ARP that a ping really needs.
function pduArpResolve(sim, host, nicPort, targetIp, vlan) {
  const cache = arpCaches.get(host.id);
  const known = cache && cache.get(ipStr(targetIp));
  if (known) return { mac: known, cached: true };
  const owner = deviceHoldingAddr(targetIp);
  const req = newPdu({ proto: 'arp', arpOp: 'request', srcMac: nicMac(host, nicPort),
    srcInt: (nicIp(host, nicPort) || {}).int, dstInt: targetIp, vlan,
    label: `ARP request for ${ipStr(targetIp)}` });
  sim.trace.push({ kind: 'arp', devId: host.id, iface: nicPort, pdu: req,
    action: 'broadcast', why: `no ARP entry for ${ipStr(targetIp)} — flooding a request in VLAN ${vlan}` });
  if (!owner) return { mac: null, failed: `nothing on VLAN ${vlan} answered ARP for ${ipStr(targetIp)}` };
  const oPort = owner.nicPort !== undefined ? owner.nicPort : hostPort(owner.dev);
  const replyMac = owner.iface ? deviceMac(owner.dev) : nicMac(owner.dev, oPort);
  const reply = newPdu({ proto: 'arp', arpOp: 'reply', srcMac: replyMac, srcInt: targetIp,
    dstMac: nicMac(host, nicPort), dstInt: (nicIp(host, nicPort) || {}).int, vlan,
    label: `ARP reply from ${owner.dev.name}` });
  sim.trace.push({ kind: 'arp', devId: owner.dev.id, iface: oPort, pdu: reply,
    action: 'reply', why: `${owner.dev.name} owns ${ipStr(targetIp)} — answering with its MAC` });
  arpLearn(host.id, ipStr(targetIp), replyMac);
  return { mac: replyMac, resolved: true };
}
// Whoever holds an address: a host NIC or a router interface.
function deviceHoldingAddr(addrInt) {
  for (const d of state.devices) {
    if (!isPlaced(d)) continue;
    if (netClass(d) === 'host') {
      for (const n of hostNics(d)) {
        const ip = nicIp(d, n.port);
        if (ip && ip.int === addrInt) return { dev: d, nicPort: n.port };
      }
    }
    for (const i of deviceInterfaces(d)) if (i.ip.int === addrInt) return { dev: d, iface: i };
  }
  return null;
}

// Walk one PDU from a source host to a destination address, recording every
// device decision. This is the observable version of pingHosts: same model, but
// it reports the journey rather than the verdict.
const PDU_MAX_EVENTS = 200;
function pduSend(srcDev, dstInt, spec = {}) {
  const sim = newPduSim();
  const srcNic = hostEgressNic(srcDev, dstInt);
  if (!srcNic) { sim.dropped = { why: `${srcDev.name} has no addressed NIC` }; sim.done = true; return sim; }
  const srcIp = nicIp(srcDev, srcNic.port);
  if (!srcIp) { sim.dropped = { why: noAddressReason(srcDev) }; sim.done = true; return sim; }
  const vlan = hostVlan(srcDev, srcNic.port);

  // A host sends to its gateway's MAC when the destination is off-subnet — the
  // L3 destination stays the far host, the L2 destination is the router. Getting
  // that pair right is most of what makes a frame walk read correctly.
  const offSubnet = !ipInSubnet(dstInt, srcIp);
  let nextHopIp = dstInt;
  if (offSubnet) {
    const gwStr = srcNic.gateway || (srcNic.ip === 'dhcp' ? dhcpGateway(srcDev, srcNic.port) : null);
    const gw = gwStr ? parseIp(gwStr) : null;
    if (!gw) {
      sim.dropped = { devId: srcDev.id, why: `${srcDev.name} has no default gateway and ${ipStr(dstInt)} is off-subnet` };
      sim.done = true; return sim;
    }
    nextHopIp = gw.int;
  }
  const arp = pduArpResolve(sim, srcDev, srcNic.port, nextHopIp, vlan);
  if (!arp.mac) {
    sim.dropped = { devId: srcDev.id, why: arp.failed || `ARP failed for ${ipStr(nextHopIp)}` };
    sim.done = true; return sim;
  }
  const pdu = newPdu({ ...spec, proto: spec.proto || 'icmp', icmpType: spec.icmpType || 'echo',
    srcMac: nicMac(srcDev, srcNic.port), dstMac: arp.mac, vlan,
    srcInt: srcIp.int, dstInt, srcPort: spec.srcPort, dstPort: spec.dstPort,
    origin: srcDev.id });
  sim.trace.push({ kind: 'send', devId: srcDev.id, iface: srcNic.port, pdu: clonePdu(pdu),
    action: 'transmit',
    why: offSubnet
      ? `${ipStr(dstInt)} is off-subnet — sending to the gateway's MAC ${arp.mac}, L3 destination unchanged`
      : `${ipStr(dstInt)} is on ${subnetLabel(srcIp)} — sending directly to ${arp.mac}` });
  const first = hopThroughPatches(srcDev, srcNic.port, FRONT);
  if (!first) {
    sim.dropped = { devId: srcDev.id, why: linkDownReason(srcDev, srcNic.port) || `${srcDev.name} is not cabled` };
    sim.done = true; return sim;
  }
  pduEnqueue(sim, { devId: first.dev.id, iface: first.port, pdu, vlan, fromId: srcDev.id });
  pduRun(sim, dstInt);
  return sim;
}

// Process the queue until the PDU is delivered or dropped.
function pduRun(sim, dstInt) {
  let guard = 0;
  while (sim.queue.length && guard++ < PDU_MAX_EVENTS) {
    const ev = sim.queue.shift();
    const dev = deviceById(ev.devId);
    if (!dev) continue;
    const cls = netClass(dev);
    if (cls === 'switch' || cls === 'patch') { pduSwitch(sim, dev, ev); continue; }
    if (cls === 'router') { if (pduRouter(sim, dev, ev, dstInt)) return; continue; }
    if (cls === 'host') { pduHost(sim, dev, ev, dstInt); if (sim.done) return; continue; }
  }
  if (!sim.done) { sim.done = true; if (!sim.dropped) sim.dropped = { why: 'PDU stopped with nowhere to go' }; }
}

// A switch: learn the source MAC, then forward by table or flood.
function pduSwitch(sim, dev, ev) {
  const pdu = ev.pdu;
  const vlan = ev.vlan;
  if (!portCarries(dev, ev.iface, vlan)) {
    sim.trace.push({ kind: 'drop', devId: dev.id, iface: ev.iface, pdu: clonePdu(pdu), action: 'drop',
      why: `port ${ev.iface} does not carry VLAN ${vlan} — frame discarded on ingress` });
    sim.done = true; sim.dropped = { devId: dev.id, why: `VLAN ${vlan} is not allowed on ${dev.name} port ${ev.iface}` };
    return;
  }
  if (stpBlocked(dev.id, ev.iface, vlan)) {
    sim.trace.push({ kind: 'drop', devId: dev.id, iface: ev.iface, pdu: clonePdu(pdu), action: 'drop',
      why: `port ${ev.iface} is ${stpPortState(dev.id, ev.iface, vlan).state} in the VLAN ${vlan} spanning tree` });
    sim.done = true; sim.dropped = { devId: dev.id, why: `spanning tree is blocking ${dev.name} port ${ev.iface}` };
    return;
  }
  macLearn(dev.id, pdu.l2.srcMac, ev.iface, vlan);
  const table = new Map(macEntries(dev.id));
  const hit = table.get(pdu.l2.dstMac);
  const def = DEVICE_TYPES[dev.type];
  const out = [];
  if (hit && hit.vlan === vlan && hit.port !== ev.iface) {
    out.push(hit.port);
    sim.trace.push({ kind: 'switch', devId: dev.id, iface: ev.iface, pdu: clonePdu(pdu), action: 'forward',
      why: `learned ${pdu.l2.srcMac} on port ${ev.iface} · MAC table has ${pdu.l2.dstMac} on port ${hit.port} in VLAN ${vlan}` });
  } else {
    for (let p = 1; p <= (def.ports || 0); p++) {
      if (p === ev.iface || portRole(def, p) === 'PWR') continue;
      if (!portCarries(dev, p, vlan)) continue;
      if (stpBlocked(dev.id, p, vlan)) continue;
      out.push(p);
    }
    sim.trace.push({ kind: 'switch', devId: dev.id, iface: ev.iface, pdu: clonePdu(pdu),
      action: out.length ? 'flood' : 'drop',
      why: out.length
        ? `no MAC entry for ${pdu.l2.dstMac} in VLAN ${vlan} — flooding to ${out.length} port${out.length === 1 ? '' : 's'} in that VLAN`
        : `no MAC entry and no other port carries VLAN ${vlan} — nowhere to flood` });
  }
  for (const p of out) {
    const nb = hopThroughPatches(dev, p, FRONT);
    if (!nb) continue;
    pduEnqueue(sim, { devId: nb.dev.id, iface: nb.port, pdu: clonePdu(pdu), vlan, fromId: dev.id });
  }
}

// A router: ACL in, TTL, route lookup, NAT, ACL out, re-frame for the next hop.
function pduRouter(sim, dev, ev, dstInt) {
  const pdu = ev.pdu;
  const ingressIf = pduIngressIface(dev, ev);
  // A router is a NIC before it is a router: a frame addressed to somebody
  // else's MAC is discarded at layer 2 and never reaches the routing table.
  // Without this a flooded frame gets routed by every router that sees it,
  // which is not what happens and would double-deliver.
  if (pdu.l2.dstMac && pdu.l2.dstMac !== 'ff:ff:ff:ff:ff:ff' && pdu.l2.dstMac !== deviceMac(dev)) {
    sim.trace.push({ kind: 'drop', devId: dev.id, iface: ingressIf, pdu: clonePdu(pdu), action: 'drop',
      why: `frame is addressed to ${pdu.l2.dstMac}, this interface is ${deviceMac(dev)} — not for this router` });
    return false;
  }
  // Is this router itself the destination?
  const mine = deviceInterfaces(dev).find(i => i.ip.int === pdu.l3.dst);
  const aclIn = aclCheck(dev, { in: ingressIf, out: null }, pduToPacket(pdu));
  if (aclIn.blocked) {
    sim.trace.push({ kind: 'drop', devId: dev.id, iface: ingressIf, pdu: clonePdu(pdu), action: 'drop', why: aclIn.reason });
    sim.done = true; sim.dropped = { devId: dev.id, why: aclIn.reason };
    return true;
  }
  if (mine) {
    sim.trace.push({ kind: 'deliver', devId: dev.id, iface: ingressIf, pdu: clonePdu(pdu), action: 'deliver',
      why: `${ipStr(pdu.l3.dst)} is this router's own ${mine.kind === 'svi' ? 'Vlan' + mine.vlan : 'port ' + mine.port} address` });
    sim.done = true; sim.delivered = true;
    return true;
  }
  pdu.l3.ttl--;
  if (pdu.l3.ttl <= 0) {
    sim.trace.push({ kind: 'drop', devId: dev.id, iface: ingressIf, pdu: clonePdu(pdu), action: 'drop',
      why: 'TTL reached zero — router discards the packet and sends ICMP time-exceeded' });
    sim.done = true; sim.dropped = { devId: dev.id, why: `TTL expired at ${dev.name}` };
    return true;
  }
  const route = lookupRoute(dev, pdu.l3.dst);
  if (!route) {
    sim.trace.push({ kind: 'drop', devId: dev.id, iface: ingressIf, pdu: clonePdu(pdu), action: 'drop',
      why: `no route to ${ipStr(pdu.l3.dst)} — routing table has no matching prefix` });
    sim.done = true; sim.dropped = { devId: dev.id, why: `${dev.name} has no route to ${ipStr(pdu.l3.dst)}` };
    return true;
  }
  const egressIf = ifKey(route.ifRef);
  const aclOut = aclCheck(dev, { in: null, out: egressIf }, pduToPacket(pdu));
  if (aclOut.blocked) {
    sim.trace.push({ kind: 'drop', devId: dev.id, iface: egressIf, pdu: clonePdu(pdu), action: 'drop', why: aclOut.reason });
    sim.done = true; sim.dropped = { devId: dev.id, why: aclOut.reason };
    return true;
  }
  // NAT on the way out, if this router translates and the source is inside.
  let natNote = null;
  if (natCfg(dev) && natCfg(dev).enabled && isPrivateIp(pdu.l3.src) && !isPrivateIp(pdu.l3.dst)) {
    const res = natTranslateOutbound(dev, pduToPacket(pdu), pdu.l3.dst);
    if (res && res.entry) {
      natNote = `NAT: ${ipStr(pdu.l3.src)}${pdu.l4 ? ':' + pdu.l4.srcPort : ''} → ${ipStr(res.entry.insideGlobal)}${res.entry.insideGlobalPort ? ':' + res.entry.insideGlobalPort : ''}`;
      pdu.l3.src = res.entry.insideGlobal;
      if (pdu.l4) pdu.l4.srcPort = res.entry.insideGlobalPort;
    } else if (res && res.error) {
      sim.trace.push({ kind: 'drop', devId: dev.id, iface: egressIf, pdu: clonePdu(pdu), action: 'drop', why: res.error });
      sim.done = true; sim.dropped = { devId: dev.id, why: res.error };
      return true;
    }
  }
  // Re-frame: a router rewrites both MACs at every hop. That is the single most
  // commonly misunderstood part of forwarding, so it is stated explicitly.
  const nextHop = route.via !== null ? route.via : pdu.l3.dst;
  const outVlan = route.ifRef && route.ifRef.kind === 'svi' ? route.ifRef.vlan : (ev.vlan || DEFAULT_VLAN);
  const target = deviceHoldingAddr(nextHop);
  const oldSrc = pdu.l2.srcMac, oldDst = pdu.l2.dstMac;
  pdu.l2.srcMac = deviceMac(dev);
  pdu.l2.dstMac = target
    ? (target.iface ? deviceMac(target.dev) : nicMac(target.dev, target.nicPort))
    : 'ff:ff:ff:ff:ff:ff';
  pdu.l2.vlan = outVlan;
  sim.trace.push({ kind: 'route', devId: dev.id, iface: ingressIf, egress: egressIf, pdu: clonePdu(pdu), action: 'route',
    why: `${route.src} route ${ipStr(route.prefix)}/${route.cidr} [${route.ad}/${route.metric}]` +
      `${route.via !== null ? ` via ${ipStr(route.via)}` : ' directly connected'} out ${route.iface}` +
      ` · TTL ${pdu.l3.ttl + 1}→${pdu.l3.ttl} · re-framed ${oldSrc}→${pdu.l2.srcMac}, ${oldDst}→${pdu.l2.dstMac}` +
      (natNote ? ` · ${natNote}` : '') });
  // Hand to whatever is on the egress interface.
  const outPort = route.ifRef && route.ifRef.kind === 'svi' ? null : (route.ifRef ? route.ifRef.port : null);
  if (outPort !== null) {
    const nb = hopThroughPatches(dev, outPort, FRONT);
    if (!nb) { sim.done = true; sim.dropped = { devId: dev.id, why: `${dev.name} ${route.iface} is not cabled` }; return true; }
    pduEnqueue(sim, { devId: nb.dev.id, iface: nb.port, pdu, vlan: outVlan, fromId: dev.id });
  } else {
    // SVI egress: the frame goes back out whichever port reaches the next hop.
    const def = DEVICE_TYPES[dev.type];
    for (let p = 1; p <= (def.ports || 0); p++) {
      if (portRole(def, p) === 'PWR') continue;
      if (!portCarries(dev, p, outVlan)) continue;
      const nb = hopThroughPatches(dev, p, FRONT);
      if (!nb) continue;
      pduEnqueue(sim, { devId: nb.dev.id, iface: nb.port, pdu, vlan: outVlan, fromId: dev.id });
      break;
    }
  }
  return false;
}
function pduIngressIface(dev, ev) {
  for (const i of deviceInterfaces(dev)) {
    if (i.kind === 'svi' && i.vlan === ev.vlan) return ifKey(i);
    if (i.kind === 'routed' && i.port === ev.iface) return ifKey(i);
  }
  return ev.iface;
}
function pduToPacket(pdu) {
  return { proto: pdu.proto, srcInt: pdu.l3 ? pdu.l3.src : 0, dstInt: pdu.l3 ? pdu.l3.dst : 0,
    srcPort: pdu.l4 ? pdu.l4.srcPort : null, dstPort: pdu.l4 ? pdu.l4.dstPort : null,
    icmpType: pdu.l3 ? pdu.l3.icmpType : null,
    established: pdu.l4 && pdu.l4.flags ? /ACK|RST/.test(pdu.l4.flags) : false };
}

// A host: is this frame for me?
function pduHost(sim, dev, ev, dstInt) {
  const pdu = ev.pdu;
  const nic = hostNics(dev).find(n => n.port === ev.iface) || hostNics(dev)[0];
  const myMac = nic ? nicMac(dev, nic.port) : deviceMac(dev);
  const myIp = nic ? nicIp(dev, nic.port) : null;
  if (pdu.l2.dstMac !== myMac && pdu.l2.dstMac !== 'ff:ff:ff:ff:ff:ff') {
    sim.trace.push({ kind: 'drop', devId: dev.id, iface: ev.iface, pdu: clonePdu(pdu), action: 'drop',
      why: `frame is addressed to ${pdu.l2.dstMac}, this NIC is ${myMac} — the NIC discards it` });
    return;
  }
  if (myIp && pdu.l3 && pdu.l3.dst === myIp.int) {
    arpLearn(dev.id, ipStr(pdu.l3.src), pdu.l2.srcMac);
    sim.trace.push({ kind: 'deliver', devId: dev.id, iface: ev.iface, pdu: clonePdu(pdu), action: 'deliver',
      why: `${ipStr(pdu.l3.dst)} is this NIC's address — delivered up the stack` });
    sim.done = true; sim.delivered = true;
    return;
  }
  sim.trace.push({ kind: 'drop', devId: dev.id, iface: ev.iface, pdu: clonePdu(pdu), action: 'drop',
    why: myIp ? `packet is for ${ipStr(pdu.l3.dst)}, this NIC is ${ipStr(myIp.int)} — not mine` : 'host has no address on this NIC' });
}

//////////////////// MAC learning + ARP ////////////////////
// Switches learn a source MAC on the port a frame arrived from; hosts cache the
// IP->MAC of whoever they talked to. Both are runtime state, not design state,
// so they live outside `state` and are never saved — same as a real box losing
// its tables on reboot.
//
// MACs are synthetic and derived from the device id so they're stable across a
// session. First octet 0x02 marks a locally-administered address, which is the
// correct way to mint an address you don't own; inventing a real vendor OUI
// would misattribute hardware we don't have a registry entry for.
// Cisco Catalyst default aging is 300 s: an entry for a station that stops
// talking is discarded, which is why a MAC table is a picture of recent traffic
// rather than a permanent inventory. Timestamps are real wall-clock, so leaving
// the app idle and coming back genuinely shows an aged-out table.
const MAC_AGE_MS = 300 * 1000;
const macTables = new Map();   // switchId -> Map(mac -> { port, vlan, at })
const arpCaches = new Map();   // hostId   -> Map(ipString -> mac)

function deviceMac(dev) {
  const id = dev.id >>> 0;
  const b = [0x02, 0x00, (id >>> 24) & 0xff, (id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff];
  return b.map(v => v.toString(16).padStart(2, '0').toUpperCase()).join(':');
}
function macLearn(devId, mac, port, vlan) {
  let t = macTables.get(devId);
  if (!t) macTables.set(devId, t = new Map());
  t.set(mac, { port, vlan, at: simNow() });
}
// Live entries only — anything past the aging time is gone, and is removed on
// read the way a real table expires it.
function macEntries(devId, ageMs) {
  const t = macTables.get(devId);
  if (!t) return [];
  const limit = ageMs === undefined ? MAC_AGE_MS : ageMs;
  const now = simNow();
  for (const [mac, e] of [...t]) if (now - (e.at || 0) > limit) t.delete(mac);
  return [...t];
}
function arpLearn(hostId, ip, mac) {
  let c = arpCaches.get(hostId);
  if (!c) arpCaches.set(hostId, c = new Map());
  c.set(ip, mac);
}
// Topology or addressing changed — a real switch would age these out; we clear
// them, because a stale table pointing at a deleted cable is worse than empty.
function flushL2Tables() { macTables.clear(); arpCaches.clear(); _stp = null; _linkState = new Map(); }

// The chain of jacks a frame crosses from a to b, or null if it can't get there.
function l2PathJacks(a, b) {
  const w = l2Walk(a, { vlan: hostVlan(a) });
  if (!w.hosts.has(b.id)) return null;
  let endKey = null;
  for (const [k] of w.prev) if (k.startsWith(b.id + ':')) { endKey = k; break; }
  if (!endKey) return null;
  const chain = [];
  for (let k = endKey; k; k = w.prev.get(k)) chain.unshift(k);
  return chain;
}

// Walk a successful conversation and populate every table it would really touch.
function learnFromExchange(a, b) {
  const chain = l2PathJacks(a, b);
  if (!chain) return false;
  const macA = deviceMac(a), macB = deviceMac(b);
  const vlan = hostVlan(a);
  const parse = k => { const [d, p, sd] = k.split(':'); return { id: +d, port: isNaN(+p) ? p : +p, side: sd }; };
  for (let i = 0; i < chain.length; i++) {
    const jack = parse(chain[i]);
    const dev = deviceById(jack.id);
    if (!dev || netClass(dev) !== 'switch') continue;   // patches are passive, hosts don't bridge
    // the frame from A arrived on this port
    macLearn(dev.id, macA, jack.port, vlan);
    // B lives out the port cabled to the next hop
    if (i + 1 < chain.length) {
      const nx = parse(chain[i + 1]);
      const c = portConnection(nx.id, nx.port, nx.side);
      if (c) {
        const near = (c.a.deviceId === dev.id) ? c.a : (c.b.deviceId === dev.id ? c.b : null);
        if (near) macLearn(dev.id, macB, near.port, vlan);
      }
    }
  }
  // ARP: same subnet resolves each other directly, otherwise each side resolves
  // its own gateway — which is exactly what a host's cache really holds
  const ipA = hostIp(a), ipB = hostIp(b);
  if (ipA && ipB) {
    if (sameSubnet(ipA, ipB)) {
      arpLearn(a.id, ipStr(ipB.int), macB);
      arpLearn(b.id, ipStr(ipA.int), macA);
    } else {
      for (const [h, other] of [[a, b], [b, a]]) {
        const w = l2Walk(h, { vlan: hostVlan(h) });
        const hip = hostIp(h);
        const g = hip ? gatewayForHost(h, w, hip) : null;
        // a host ARPs for its gateway's address on THIS segment
        if (g && !g.error) arpLearn(h.id, ipStr(g.iface.ip.int), deviceMac(g.router));
      }
    }
  }
  return true;
}

//////////////////// NAT / Internet ////////////////////
// RFC 1918 §3 reserves exactly three blocks for private internets, verified
// against the RFC text itself:
//     10.0.0.0    - 10.255.255.255  (10/8)
//     172.16.0.0  - 172.31.255.255  (172.16/12)
//     192.168.0.0 - 192.168.255.255 (192.168/16)
// The same section states packets with private source or destination addresses
// "should not be forwarded across" inter-enterprise links — which is precisely
// why a gateway must translate them, and why a host with a private address and
// no NAT gateway cannot reach the Internet node.
const RFC1918 = [
  { net: '10.0.0.0', cidr: 8 },
  { net: '172.16.0.0', cidr: 12 },
  { net: '192.168.0.0', cidr: 16 }
];
function isPrivateIp(ipInt) {
  return RFC1918.some(b => {
    const base = parseIp(b.net + '/' + b.cidr);
    const mask = base.mask;
    return ((ipInt & mask) >>> 0) === base.network;
  });
}
// ---- NAT translation table ----
// Cisco's four address perspectives, which are the whole vocabulary of NAT and
// the reason `show ip nat translations` has four columns:
//   inside local    the private address as the inside host sees itself
//   inside global   what the outside world sees that host as
//   outside local   the outside host as the inside sees it
//   outside global  the outside host's real address
// A translation is created by the first packet of a flow and expires on a timer.
//
// Timeouts are IOS defaults, cross-checked against Cisco's ip nat command
// reference and two independent references: everything except overload 86400 s,
// TCP 86400 s, UDP 300 s, DNS 60 s, ICMP 60 s, and a TCP flow that has seen
// FIN or RST drops to 60 s.
const NAT_TIMEOUT = { tcp: 86400, udp: 300, dns: 60, icmp: 60, finrst: 60, any: 86400 };
const PAT_PORT_MIN = 1024, PAT_PORT_MAX = 65535;
const _natTable = new Map();     // routerId -> Map(key -> entry)

function natCfg(dev) { return dev.nat || null; }
function natTimeoutFor(proto, finrst) {
  if (finrst) return NAT_TIMEOUT.finrst;
  return NAT_TIMEOUT[proto] !== undefined ? NAT_TIMEOUT[proto] : NAT_TIMEOUT.any;
}
function natEntries(routerId) {
  const t = _natTable.get(routerId);
  if (!t) return [];
  const now = simNow();
  for (const [k, e] of [...t]) if (now >= e.expiresAt) t.delete(k);   // aged out
  return [...t.values()];
}
function natClear(routerId) {
  if (routerId === undefined) _natTable.clear(); else _natTable.delete(routerId);
}
// Ports already handed out on a given inside-global address, so PAT never
// double-assigns one.
function patPortsInUse(routerId, globalInt) {
  const s = new Set();
  for (const e of natEntries(routerId)) if (e.insideGlobal === globalInt) s.add(e.insideGlobalPort);
  return s;
}

// Translate a packet leaving the inside. Returns the rewritten packet plus the
// table entry, or null when this router does not NAT this source.
function natTranslateOutbound(router, pkt, outsideInt) {
  const cfg = natCfg(router);
  if (!cfg || !cfg.enabled) return null;
  const globalIp = parseIp(cfg.insideGlobal || '');
  if (!globalIp) return null;
  // Static one-to-one mappings win over the pool — they are matched first on a
  // real box and they are what makes an inside host reachable from outside.
  const stat = (cfg.statics || []).find(s => {
    const l = parseIp(s.local);
    if (!l || l.int !== pkt.srcInt) return false;
    return !s.proto || (s.proto === pkt.proto && (!s.localPort || +s.localPort === pkt.srcPort));
  });
  let key, insideGlobal, insideGlobalPort;
  if (stat) {
    const g = parseIp(stat.global);
    if (!g) return null;
    insideGlobal = g.int;
    insideGlobalPort = stat.globalPort ? +stat.globalPort : pkt.srcPort;
    key = `static|${pkt.proto}|${pkt.srcInt}|${pkt.srcPort}`;
  } else {
    // Only addresses permitted by the NAT ACL are translated; everything else
    // is forwarded untranslated, which is how a real router behaves and how a
    // missing `ip nat inside source list` shows up as "no internet".
    if (cfg.aclId) {
      const acl = deviceAcl(router, cfg.aclId);
      if (!acl) return null;
      if (!aclEvaluate(acl, { ...pkt, dstInt: outsideInt }, { count: false }).permit) return null;
    } else if (!isPrivateIp(pkt.srcInt)) return null;
    insideGlobal = globalIp.int;
    if (cfg.overload) {
      // PAT: many inside hosts on one address, told apart by source port.
      const existing = natEntries(router.id).find(e =>
        e.proto === pkt.proto && e.insideLocal === pkt.srcInt && e.insideLocalPort === pkt.srcPort);
      if (existing) insideGlobalPort = existing.insideGlobalPort;
      else {
        const used = patPortsInUse(router.id, insideGlobal);
        let p = pkt.srcPort && pkt.srcPort >= PAT_PORT_MIN ? pkt.srcPort : PAT_PORT_MIN;
        while (used.has(p) && p < PAT_PORT_MAX) p++;
        if (used.has(p)) return { error: `${router.name}: PAT port pool exhausted on ${ipStr(insideGlobal)}` };
        insideGlobalPort = p;
      }
    } else {
      // Without overload one global address serves one inside host at a time.
      const holder = natEntries(router.id).find(e =>
        e.insideGlobal === insideGlobal && e.insideLocal !== pkt.srcInt);
      if (holder) return { error: `${router.name}: ${ipStr(insideGlobal)} is already translating ${ipStr(holder.insideLocal)} — no overload configured, so there is no second address to hand out` };
      insideGlobalPort = pkt.srcPort;
    }
    key = `${pkt.proto}|${pkt.srcInt}:${pkt.srcPort}|${insideGlobalPort}`;
  }
  let t = _natTable.get(router.id);
  if (!t) _natTable.set(router.id, t = new Map());
  const proto = pkt.proto === 'udp' && pkt.dstPort === 53 ? 'dns' : pkt.proto;
  const entry = t.get(key) || {
    proto: pkt.proto, insideLocal: pkt.srcInt, insideLocalPort: pkt.srcPort,
    insideGlobal, insideGlobalPort, static: !!stat, createdAt: simNow()
  };
  entry.outsideLocal = outsideInt;      // no outside-NAT, so local == global here
  entry.outsideGlobal = outsideInt;
  entry.outsidePort = pkt.dstPort;
  entry.expiresAt = simNow() + natTimeoutFor(proto, pkt.finrst) * 1000;
  t.set(key, entry);
  return { entry, pkt: { ...pkt, srcInt: insideGlobal, srcPort: insideGlobalPort } };
}

// A packet arriving from outside is delivered only if a translation already
// exists for it, or a static/port-forward mapping says where it goes. This is
// the property that makes NAT a de-facto inbound filter.
function natTranslateInbound(router, pkt) {
  const cfg = natCfg(router);
  if (!cfg || !cfg.enabled) return null;
  for (const e of natEntries(router.id)) {
    if (e.proto !== pkt.proto) continue;
    if (e.insideGlobal !== pkt.dstInt) continue;
    if (e.insideGlobalPort !== undefined && pkt.dstPort !== undefined &&
        e.insideGlobalPort !== pkt.dstPort) continue;
    return { entry: e, pkt: { ...pkt, dstInt: e.insideLocal, dstPort: e.insideLocalPort } };
  }
  const fwd = (cfg.statics || []).find(s => {
    const g = parseIp(s.global);
    if (!g || g.int !== pkt.dstInt) return false;
    if (s.proto && s.proto !== pkt.proto) return false;
    if (s.globalPort && +s.globalPort !== pkt.dstPort) return false;
    return true;
  });
  if (fwd) {
    const l = parseIp(fwd.local);
    if (l) return { pkt: { ...pkt, dstInt: l.int, dstPort: fwd.localPort ? +fwd.localPort : pkt.dstPort }, forwarded: fwd };
  }
  return { blocked: true, reason: `${router.name} has no NAT translation for ${ipStr(pkt.dstInt)}${pkt.dstPort ? ':' + pkt.dstPort : ''} — unsolicited inbound traffic is dropped` };
}

// `show ip nat translations`
function showIpNat(dev) {
  const rows = natEntries(dev.id);
  if (!rows.length) return `${dev.name}: no active translations`;
  const port = (a, p) => p === undefined || p === null ? ipStr(a) : `${ipStr(a)}:${p}`;
  const out = ['Pro   Inside global        Inside local         Outside local        Outside global'];
  for (const e of rows) {
    out.push(`${(e.proto || '---').padEnd(5)} ${port(e.insideGlobal, e.insideGlobalPort).padEnd(20)} ` +
      `${port(e.insideLocal, e.insideLocalPort).padEnd(20)} ` +
      `${port(e.outsideLocal, e.outsidePort).padEnd(20)} ${port(e.outsideGlobal, e.outsidePort)}`);
  }
  return out.join('\n');
}

function isInternetNode(dev) { return !!(dev && DEVICE_TYPES[dev.type] && DEVICE_TYPES[dev.type].isInternet); }
function internetNodes() { return state.devices.filter(d => isPlaced(d) && isInternetNode(d)); }

function isDemarc(d) { return !!(d && DEVICE_TYPES[d.type] && DEVICE_TYPES[d.type].isDemarc); }
function isCpeTerm(d) { return !!(d && DEVICE_TYPES[d.type] && DEVICE_TYPES[d.type].isCpeTerm); }

// Everything cabled to a given device, excluding power.
function dataNeighbours(dev) {
  const out = [];
  for (const c of state.cables) {
    const mine = c.a.deviceId === dev.id ? c.a : (c.b.deviceId === dev.id ? c.b : null);
    if (!mine || mine.port === 'PWR') continue;
    const far = mine === c.a ? c.b : c.a;
    const fd = deviceById(far.deviceId);
    if (fd) out.push({ dev: fd, myPort: mine.port, farPort: far.port });
  }
  return out;
}

// A provisioned circuit is what makes a WAN port live. On a real job the chain
// is: ISP service -> demarc/NID -> provider terminating equipment (ONT for
// fibre, DOCSIS modem for coax) -> Ethernet handoff -> customer router WAN.
// Every one of those can be missing or unprovisioned, so each is checked and
// named separately rather than collapsed into "a cable reaches the cloud".
//
// The circuit itself lives on the terminating device: `dev.circuit = { active,
// provider, wanIp }`. No circuit means the modem/ONT is installed but the
// service was never turned up — an extremely common real-world state, and the
// one that makes a tech drive back out to site.
function circuitOf(dev) {
  const c = dev && dev.circuit;
  if (!c) return null;
  return { active: c.active !== false, provider: c.provider || 'ISP', wanIp: c.wanIp || null };
}

// Walk outward from a router's WAN port toward the Internet, reporting the
// first thing that's missing. Returns { ok, net, port, role, term, circuit } or
// { ok:false, reason }.
function wanUplink(router) {
  const def = DEVICE_TYPES[router.type];
  const wanPorts = dataNeighbours(router).filter(n => portRole(def, n.myPort) === 'WAN');
  const anyPorts = wanPorts.length ? wanPorts : dataNeighbours(router);
  if (!anyPorts.length) return { ok: false, reason: `${router.name} has nothing cabled to a WAN port` };

  for (const first of anyPorts) {
    // walk the provider chain, at most a few hops: demarc -> term -> internet
    let cur = first.dev, term = null, hops = [], guard = 0;
    while (cur && guard++ < 6) {
      hops.push(cur);
      if (isInternetNode(cur)) {
        if (!term) {
          // reached the Internet without passing through provider terminating
          // equipment — name whichever of the two situations it actually is
          const viaDemarc = hops.some(isDemarc);
          return { ok: false, reason: viaDemarc
            ? `Service reaches the demarc but nothing terminates it — add an ONT or modem between the demarc and ${router.name}`
            : `${router.name} port ${first.myPort} is cabled straight to the Internet with no demarc or terminating equipment — a WAN port needs a provider handoff, not a direct link` };
        }
        const circ = circuitOf(term);
        if (!circ) return { ok: false, reason: `${term.name} is installed but has no provisioned circuit — the service was never turned up` };
        if (!circ.active) return { ok: false, reason: `${term.name}: circuit from ${circ.provider} is down` };
        return {
          ok: true, net: cur, port: first.myPort, role: portRole(def, first.myPort),
          term, circuit: circ, hops
        };
      }
      if (isCpeTerm(cur)) term = cur;
      // step to the next device away from the router
      const nxt = dataNeighbours(cur).find(n => n.dev.id !== router.id && !hops.some(h => h.id === n.dev.id));
      cur = nxt ? nxt.dev : null;
    }
    // chain ended without reaching the Internet — say where it stopped
    const last = hops[hops.length - 1];
    if (last && isCpeTerm(last)) {
      const circ = circuitOf(last);
      if (!circ) return { ok: false, reason: `${last.name} has no provisioned circuit — no signal from the ISP` };
      return { ok: false, reason: `${last.name} is provisioned but nothing links it onward to the Internet` };
    }
    if (last && isDemarc(last)) return { ok: false, reason: `Service reaches ${last.name} but there's no ONT or modem to terminate it` };
  }
  return { ok: false, reason: `${router.name}'s WAN port leads nowhere — no provider equipment on the far end` };
}

// Can this host reach the public Internet, and by what path?
function pingInternet(host) {
  const ip = hostIp(host);
  if (!ip) return { ok: false, reason: `${host.name} has no valid IP` };
  if (!internetNodes().length) return { ok: false, reason: 'No Internet node placed — add one from the WAN category, plus an ONT or modem and a demarc' };
  const walk = l2Walk(host, { vlan: hostVlan(host) });
  if (!walk.routers.size) return { ok: false, reason: `${host.name}'s subnet ${subnetLabel(ip)} has no router / default gateway reachable` };

  const gw = gatewayForHost(host, walk, ip);
  if (gw.error) return { ok: false, reason: gw.error };
  let lastReason = null;
  for (const rid of [gw.id]) {
    const r = deviceById(rid);
    const up = wanUplink(r);
    if (!up.ok) { lastReason = up.reason; continue; }
    const acl = aclCheck(r, { in: ifKey(gw.iface), out: up.port }, icmpEchoPacket(ip.int, 0));
    if (acl.blocked) return { ok: false, reason: acl.reason, acl };
    const priv = isPrivateIp(ip.int);
    const wanIp = up.circuit.wanIp;
    // A private source needs a real translation, not just the observation that
    // it is private. Build the entry the way the first packet of a flow would,
    // so `show ip nat translations` reflects traffic that actually happened and
    // a gateway with NAT switched off correctly fails to reach the Internet.
    let natted = null;
    if (priv) {
      const outside = parseIp('8.8.8.8').int;         // the Internet node stands in for any public host
      const pkt = { proto: 'icmp', srcInt: ip.int, dstInt: outside, srcPort: null, dstPort: null, icmpType: 'echo' };
      const res = natTranslateOutbound(r, pkt, outside);
      if (!res) {
        return { ok: false, reason: `${host.name} has an RFC 1918 address and ${r.name} is not translating it — enable NAT on the gateway, or the packet leaves with a private source and is dropped upstream` };
      }
      if (res.error) return { ok: false, reason: res.error };
      natted = res.entry;
    }
    return {
      ok: true, mode: 'nat',
      hops: [host.id, rid, ...up.hops.map(h => h.id)],
      translated: priv, nat: natted,
      detail: priv
        ? `${host.name} ${ipStr(ip.int)} (RFC 1918) translated by ${r.name} to ${ipStr(natted.insideGlobal)}${natted.insideGlobalPort ? ':' + natted.insideGlobalPort : ''} — ${up.circuit.provider} circuit via ${up.term.name}`
        : `${host.name} ${ipStr(ip.int)} is publicly routable — forwarded by ${r.name} over the ${up.circuit.provider} circuit, no translation`
    };
  }
  return { ok: false, reason: lastReason || 'no gateway has a working WAN circuit' };
}

//////////////////// Access control lists ////////////////////
// Cisco IP ACL semantics, verified against Cisco documentation:
//   * numbered standard 1-99 / 1300-1999  — matches SOURCE only
//   * numbered extended 100-199 / 2000-2699 — matches source AND destination
//   * wildcard mask is the inverse of a subnet mask: a 0 bit must match,
//     a 1 bit is ignored
//   * entries are evaluated top to bottom and the FIRST match wins
//   * every list ends with an implicit "deny any" that never appears in the
//     running config but is always evaluated
// An ACL is applied to a port in a direction (in/out), which is why the ingress
// and egress interfaces are resolved separately below.
const ACL_STD = [[1, 99], [1300, 1999]];
const ACL_EXT = [[100, 199], [2000, 2699]];
const ACL_SEQ_STEP = 10;               // IOS: first entry 10, then +10

// Cisco's port mnemonics. Three of them mean different things on TCP and UDP
// (512/513/514), which is why these are two tables rather than one.
const ACL_PORTS_TCP = { 'ftp-data': 20, ftp: 21, ssh: 22, telnet: 23, smtp: 25,
  time: 37, whois: 43, tacacs: 49, domain: 53, gopher: 70, finger: 79, www: 80,
  hostname: 101, pop2: 109, pop3: 110, sunrpc: 111, ident: 113, nntp: 119,
  bgp: 179, irc: 194, exec: 512, login: 513, cmd: 514, lpd: 515, talk: 517,
  uucp: 540, klogin: 543, kshell: 544, echo: 7, discard: 9, daytime: 13,
  chargen: 19, drip: 3949 };
const ACL_PORTS_UDP = { echo: 7, discard: 9, time: 37, nameserver: 42,
  tacacs: 49, domain: 53, bootps: 67, bootpc: 68, tftp: 69, sunrpc: 111,
  ntp: 123, 'netbios-ns': 137, 'netbios-dgm': 138, 'netbios-ss': 139,
  snmp: 161, snmptrap: 162, xdmcp: 177, 'mobile-ip': 434, isakmp: 500,
  biff: 512, who: 513, syslog: 514, talk: 517, rip: 520, 'pim-auto-rp': 496 };
// ICMP message types by keyword — a rule may also give a bare numeric type.
const ACL_ICMP = { 'echo-reply': 0, unreachable: 3, 'net-unreachable': 3,
  'host-unreachable': 3, 'port-unreachable': 3, 'packet-too-big': 3,
  'administratively-prohibited': 3, 'source-quench': 4, redirect: 5, echo: 8,
  'router-advertisement': 9, 'router-solicitation': 10, 'time-exceeded': 11,
  'ttl-exceeded': 11, traceroute: 30, 'parameter-problem': 12,
  'timestamp-request': 13, 'timestamp-reply': 14 };

function aclPortNum(tok, proto) {
  if (tok === undefined) return null;
  if (/^\d+$/.test(tok)) return parseInt(tok, 10);
  const t = (proto === 'udp' ? ACL_PORTS_UDP : ACL_PORTS_TCP)[tok];
  return t === undefined ? null : t;
}
function aclPortName(n, proto) {
  const tbl = proto === 'udp' ? ACL_PORTS_UDP : ACL_PORTS_TCP;
  for (const [k, v] of Object.entries(tbl)) if (v === n) return k;
  return String(n);
}
function aclKind(id) {
  const n = parseInt(id, 10);
  if (String(id).match(/^\d+$/)) {
    if (ACL_STD.some(([a, b]) => n >= a && n <= b)) return 'standard';
    if (ACL_EXT.some(([a, b]) => n >= a && n <= b)) return 'extended';
    return null;                       // out of every valid numbered range
  }
  return null;                         // named lists declare their own kind
}
// A list's kind: numbered lists get it from the number, named lists carry it.
function aclKindOf(acl) {
  return acl.kind || aclKind(acl.id) || 'extended';
}
// "any" | "host x.x.x.x" | "x.x.x.x wild.card"
function aclMatchAddr(spec, ipInt) {
  if (!spec || spec.any) return true;
  const base = parseIp(spec.addr);
  if (!base) return false;
  const wild = spec.wild ? parseIp(spec.wild) : null;
  const mask = wild ? (~wild.int) >>> 0 : 0xFFFFFFFF;   // no wildcard = host match
  return ((ipInt & mask) >>> 0) === ((base.int & mask) >>> 0);
}
// eq / neq / lt / gt / range, against the packet's port for that side.
function aclMatchPort(spec, port) {
  if (!spec) return true;
  if (port === null || port === undefined) return false;  // rule wants a port, packet has none
  const p = spec.ports;
  switch (spec.op) {
    case 'eq': return p.includes(port);
    case 'neq': return !p.includes(port);
    case 'lt': return port < p[0];
    case 'gt': return port > p[0];
    case 'range': return port >= p[0] && port <= p[1];
    default: return true;
  }
}
// A rule's protocol admits the packet's protocol. "ip" matches everything,
// which is why a deny ip entry stops ICMP as well as TCP.
function aclMatchProto(rule, pkt) {
  const rp = rule.proto || 'ip';
  if (rp === 'ip') return true;
  return rp === pkt.proto;
}
function aclMatchIcmp(rule, pkt) {
  if (rule.icmpType === undefined || rule.icmpType === null) return true;
  if (pkt.proto !== 'icmp') return false;
  const want = typeof rule.icmpType === 'number' ? rule.icmpType : ACL_ICMP[rule.icmpType];
  const got = typeof pkt.icmpType === 'number' ? pkt.icmpType : ACL_ICMP[pkt.icmpType];
  return want === got;
}

// Evaluate a packet against one list. A packet is
// { proto, srcInt, dstInt, srcPort, dstPort, established, icmpType }.
// Returns { permit, rule, seq, implicit } — implicit deny when nothing matched.
function aclEvaluate(acl, pkt, opts = {}) {
  const kind = aclKindOf(acl);
  const rules = acl.rules || [];
  for (const r of rules) {
    if (r.remark !== undefined) continue;              // remarks never match
    if (!aclMatchAddr(r.src, pkt.srcInt)) continue;
    if (kind === 'extended') {
      if (!aclMatchProto(r, pkt)) continue;
      if (r.dst && !aclMatchAddr(r.dst, pkt.dstInt)) continue;
      if (!aclMatchPort(r.srcPort, pkt.srcPort)) continue;
      if (!aclMatchPort(r.dstPort, pkt.dstPort)) continue;
      if (!aclMatchIcmp(r, pkt)) continue;
      // "established" admits only TCP that is part of an existing conversation
      // — the ACK or RST bit set. A fresh SYN never matches it, which is the
      // whole reason the keyword exists.
      if (r.established && !(pkt.proto === 'tcp' && pkt.established)) continue;
    }
    if (opts.count !== false) r.hits = (r.hits || 0) + 1;
    return { permit: r.action === 'permit', rule: r, seq: r.seq };
  }
  return { permit: false, rule: null, seq: null, implicit: true };
}
function deviceAcl(dev, id) {
  return (dev.acls || []).find(a => String(a.id) === String(id)) || null;
}
// Human-readable "why", naming the entry that did it.
function aclRuleText(acl, r) {
  return aclLineText(acl, r).trim();
}
// Check every ACL a packet meets crossing this router. `ports` is
// { in: <port|null>, out: <port|null> } resolved from the L2 walk on each side.
function aclCheck(router, ports, pkt) {
  const applied = router.aclApply || {};
  for (const [port, dir] of [[ports.in, 'in'], [ports.out, 'out']]) {
    if (port === null || port === undefined) continue;
    const id = (applied[port] || {})[dir];
    if (!id) continue;
    const acl = deviceAcl(router, id);
    if (!acl) continue;
    const res = aclEvaluate(acl, pkt);
    if (!res.permit) {
      const what = `${pkt.proto}${pkt.dstPort ? ' port ' + pkt.dstPort : ''}${pkt.proto === 'icmp' && pkt.icmpType ? ' ' + pkt.icmpType : ''}`;
      const where = typeof port === 'number' ? `port ${port}` : port;
      return {
        blocked: true, router, aclId: acl.id, dir, port, packet: pkt,
        reason: res.implicit
          ? `${what} blocked by ACL ${acl.id} on ${router.name} ${dir} ${where} — implicit deny any at the end of the list`
          : `${what} blocked by ACL ${acl.id} on ${router.name} ${dir} ${where} — "${aclRuleText(acl, res.rule)}"`
      };
    }
  }
  return { blocked: false };
}
// A ping is ICMP echo, not an abstract "packet". Modelling it as such is what
// makes "deny icmp" and "permit tcp any any eq 80" behave differently, which
// they must.
function icmpEchoPacket(srcInt, dstInt) {
  return { proto: 'icmp', srcInt, dstInt, srcPort: null, dstPort: null, icmpType: 'echo', established: false };
}

// Parse real IOS access-list syntax so what you type here is what you'd type on
// the device. Both forms are accepted, because both are real:
//
//   access-list 10 permit 10.0.10.0 0.0.0.255
//   access-list 110 deny tcp any host 10.0.10.5 eq www
//   access-list 110 permit tcp any any established
//   ip access-list extended BLOCK-CCTV
//    10 deny ip 10.0.30.0 0.0.0.255 10.0.10.0 0.0.0.255
//    20 permit ip any any
//
// Returns { acls, errors } — errors carry the line so bad input is reported,
// never silently dropped.
function parseAclText(text) {
  const acls = new Map(), errors = [];
  const lines = String(text || '').split('\n');
  let ctx = null;                        // the named list we're inside, if any
  const get = (id, kind) => {
    if (!acls.has(id)) acls.set(id, { id, kind, rules: [], named: kind !== undefined && !/^\d+$/.test(String(id)) });
    return acls.get(id);
  };
  const nextSeq = (acl) => (acl.rules.reduce((m, r) => Math.max(m, r.seq || 0), 0) || 0) + ACL_SEQ_STEP;

  lines.forEach((raw, i) => {
    const line = raw.trim();
    const err = msg => errors.push({ line: i + 1, text: line, msg });
    if (!line || line.startsWith('!')) return;
    let t = line.split(/\s+/);

    // enter a named list
    if (t[0] === 'ip' && t[1] === 'access-list') {
      const kind = t[2];
      if (kind !== 'standard' && kind !== 'extended') { err('expected "standard" or "extended"'); return; }
      if (!t[3]) { err('named access-list needs a name'); return; }
      ctx = get(t[3], kind);
      ctx.kind = kind; ctx.named = true;
      return;
    }

    let acl, seq = null;
    if (t[0] === 'access-list') {        // numbered, one line per entry
      ctx = null;
      const id = t[1];
      const kind = aclKind(id);
      if (!kind) { err(`${id} is not a valid access-list number`); return; }
      acl = get(id, kind); acl.kind = kind;
      t = t.slice(2);
    } else if (ctx) {                    // a line inside a named list
      acl = ctx;
      if (/^\d+$/.test(t[0])) { seq = parseInt(t[0], 10); t = t.slice(1); }
    } else {
      err('expected "access-list" or "ip access-list"');
      return;
    }

    if (t[0] === 'remark') {
      acl.rules.push({ seq: seq === null ? nextSeq(acl) : seq, remark: t.slice(1).join(' ') });
      return;
    }
    const action = t[0];
    if (action !== 'permit' && action !== 'deny') { err('expected permit, deny or remark'); return; }
    let k = 1;
    const ext = aclKindOf(acl) === 'extended';
    let proto = 'ip';
    if (ext) {
      const p = t[k];
      if (['ip', 'tcp', 'udp', 'icmp'].includes(p)) { proto = p; k++; }
      else { err(`extended list needs a protocol (ip, tcp, udp, icmp), got "${p || 'nothing'}"`); return; }
    }
    const readAddr = () => {
      if (t[k] === 'any') { k++; return { any: true }; }
      if (t[k] === 'host') { k++; return { addr: t[k++] }; }
      const addr = t[k++];
      const wild = (t[k] && /^\d+\.\d+\.\d+\.\d+$/.test(t[k])) ? t[k++] : undefined;
      return wild ? { addr, wild } : { addr };
    };
    const readPort = () => {
      const op = t[k];
      if (!['eq', 'neq', 'lt', 'gt', 'range'].includes(op)) return null;
      if (proto !== 'tcp' && proto !== 'udp') { err(`port operators only apply to tcp and udp, not ${proto}`); return null; }
      k++;
      const want = op === 'range' ? 2 : 1;
      const ports = [];
      // eq accepts a list of ports on real IOS; range takes exactly two.
      while (t[k] !== undefined && ports.length < (op === 'eq' ? 10 : want)) {
        const n = aclPortNum(t[k], proto);
        if (n === null) break;
        ports.push(n); k++;
        if (op !== 'eq' && ports.length === want) break;
      }
      if (!ports.length) { err(`${op} needs a port`); return null; }
      return { op, ports };
    };
    const src = readAddr();
    const srcPort = ext ? readPort() : null;
    const dst = ext ? readAddr() : undefined;
    const dstPort = ext ? readPort() : null;
    let established = false, icmpType = null, log = false;
    while (t[k] !== undefined) {
      const tok = t[k];
      if (tok === 'established') { established = true; k++; continue; }
      if (tok === 'log' || tok === 'log-input') { log = true; k++; continue; }
      if (proto === 'icmp' && (ACL_ICMP[tok] !== undefined || /^\d+$/.test(tok))) {
        icmpType = /^\d+$/.test(tok) ? parseInt(tok, 10) : tok; k++; continue;
      }
      err(`unrecognised keyword "${tok}"`); return;
    }
    if (established && proto !== 'tcp') { err('"established" is only valid on tcp'); return; }
    const rule = { seq: seq === null ? nextSeq(acl) : seq, action, proto, src, hits: 0 };
    if (srcPort) rule.srcPort = srcPort;
    if (dst) rule.dst = dst;
    if (dstPort) rule.dstPort = dstPort;
    if (established) rule.established = true;
    if (icmpType !== null) rule.icmpType = icmpType;
    if (log) rule.log = true;
    acl.rules.push(rule);
  });
  // IOS keeps entries in sequence order, not entry order.
  for (const a of acls.values()) a.rules.sort((x, y) => (x.seq || 0) - (y.seq || 0));
  return { acls: [...acls.values()], errors };
}

// One entry, rendered the way IOS prints it.
function aclLineText(acl, r) {
  if (r.remark !== undefined) return ` remark ${r.remark}`;
  const ext = aclKindOf(acl) === 'extended';
  const addr = sp => sp.any ? 'any' : (sp.wild ? `${sp.addr} ${sp.wild}` : `host ${sp.addr}`);
  const port = sp => !sp ? '' : ` ${sp.op} ${sp.ports.map(p => aclPortName(p, r.proto)).join(' ')}`;
  let s = ` ${r.action}`;
  if (ext) s += ` ${r.proto || 'ip'}`;
  s += ` ${addr(r.src)}${port(r.srcPort)}`;
  if (ext && r.dst) s += ` ${addr(r.dst)}${port(r.dstPort)}`;
  if (r.icmpType !== undefined && r.icmpType !== null) s += ` ${r.icmpType}`;
  if (r.established) s += ' established';
  if (r.log) s += ' log';
  return s;
}
// Render ACLs back to IOS syntax for the editor. Named lists print in their own
// block form; numbered ones print one access-list line per entry.
function aclToText(acls) {
  const out = [];
  for (const a of acls || []) {
    if (a.named) {
      out.push(`ip access-list ${aclKindOf(a)} ${a.id}`);
      for (const r of a.rules) out.push(` ${r.seq}${aclLineText(a, r)}`);
    } else {
      for (const r of a.rules) {
        out.push(r.remark !== undefined
          ? `access-list ${a.id} remark ${r.remark}`
          : `access-list ${a.id}${aclLineText(a, r)}`);
      }
    }
  }
  return out.join('\n');
}
// `show access-lists`, including the per-entry match counts that are how ACLs
// are actually debugged on a live device.
function aclShow(dev) {
  const out = [];
  for (const a of dev.acls || []) {
    out.push(`${aclKindOf(a) === 'standard' ? 'Standard' : 'Extended'} IP access list ${a.id}`);
    for (const r of a.rules) {
      const hits = r.remark === undefined && r.hits ? ` (${r.hits} match${r.hits === 1 ? '' : 'es'})` : '';
      out.push(`    ${r.seq}${aclLineText(a, r)}${hits}`);
    }
  }
  return out.join('\n');
}
function aclResetHits(dev) {
  for (const a of dev.acls || []) for (const r of a.rules) r.hits = 0;
}

//////////////////// Spanning Tree (802.1D) ////////////////////
// Redundant switch-to-switch links create a loop; STP blocks all but one path.
// Modelled on IEEE 802.1D: lowest bridge ID wins root, every other bridge picks
// the port with the lowest cost back to root, each segment elects a designated
// port, and whatever is left blocks.
//
// Path costs use the 802.1D-2004 formula, cost = 20,000,000 / speed in Mbps
// (1G = 20000, 10G = 2000, 100M = 200000). Note Cisco still defaults to the
// legacy 802.1D-1998 short costs (1G = 4, 100M = 19, 10G = 2) — when the IOS
// CLI lands, `show spanning-tree` must print short costs to be faithful, so
// keep STP_SHORT_COST below in sync rather than deriving it.
const STP_PRIO_DEFAULT = 32768;             // 802.1D default bridge priority
const STP_SHORT_COST = { 0.01: 100, 0.1: 19, 1: 4, 10: 2 };  // 802.1D-1998, Cisco default
function stpCost(speedGbps) {
  const mbps = (speedGbps || 1) * 1000;
  return Math.max(1, Math.round(20000000 / mbps));
}
// PVST+ runs one tree per VLAN, and the bridge ID carries the VLAN in it.
// IEEE 802.1t splits the old 16-bit priority into a 4-bit priority plus a
// 12-bit extended system ID holding the VLAN, which is why a configured
// priority must be a multiple of 4096 and why the value a switch actually
// advertises is priority + VLAN. Verified against Cisco's Rapid PVST+ guide
// and two independent references.
const STP_PRIO_STEP = 4096;
function bridgePriority(dev, vlan) {
  const per = dev.stpPriorityPerVlan && vlan !== undefined ? dev.stpPriorityPerVlan[vlan] : undefined;
  const raw = per !== undefined ? per : dev.stpPriority;
  let base = (raw === undefined || raw === null || isNaN(+raw)) ? STP_PRIO_DEFAULT : +raw;
  base = Math.round(base / STP_PRIO_STEP) * STP_PRIO_STEP;      // 802.1t: multiples of 4096 only
  return base + (vlan === undefined ? 0 : vlan);                // extended system ID
}
// Comparable bridge ID: priority first, then MAC — exactly 802.1D's ordering.
function bridgeIdKey(dev, vlan) {
  return String(bridgePriority(dev, vlan)).padStart(6, '0') + '|' + deviceMac(dev);
}
// The mode a switch runs. Cisco defaults to PVST+; rapid-pvst is what modern
// deployments use and changes convergence, not topology.
function stpMode(dev) { return (dev && dev.stpMode) || 'pvst'; }   // 'pvst' | 'rapid-pvst' | 'mst'

// 802.1D port states and their real timers. A port coming up does not forward
// immediately: it listens for BPDUs for one forward delay, learns MACs for
// another, and only then forwards. That 30 s is exactly why PortFast exists and
// why plugging in a PC feels broken without it.
const STP_HELLO_S = 2, STP_FWD_DELAY_S = 15, STP_MAX_AGE_S = 20;
const STP_STATES = ['blocking', 'listening', 'learning', 'forwarding'];
// PortFast/edge ports skip straight to forwarding — correct for a host port,
// and a loop waiting to happen on a switch-to-switch link, which is why BPDU
// guard exists and why we flag it below.
function isEdgePort(dev, port) {
  const cfg = portCfgOf(dev, port);
  if (cfg.portfast !== undefined) return !!cfg.portfast;
  const nb = hopThroughPatches(dev, port, FRONT);
  return !nb || netClass(nb.dev) !== 'switch';
}
// A link runs at the slower of its two ends.
function linkSpeed(cable) {
  // The NEGOTIATED speed, not the port's rated one. A gig port that trained to
  // 100M because of the far end or a forced setting really does cost 200000 in
  // spanning tree, and that can change which link blocks.
  const n = negotiateLink(cable);
  if (n && n.up && n.speed) return n.speed;
  const sp = (ep) => {
    const d = deviceById(ep.deviceId);
    if (!d) return 1;
    const g = portGrid(DEVICE_TYPES[d.type]).find(p => p.port === ep.port);
    return (g && g.speed) || 1;
  };
  return Math.min(sp(cable.a), sp(cable.b));
}

let _stp = null;   // cached result; invalidated with the L2 tables
// One tree per VLAN (PVST+). `_stp` caches per VLAN key; the untagged/global
// view is vlan undefined, which is what the plain 802.1D view used to be.
function stpState(vlan) {
  const key = vlan === undefined ? '*' : String(vlan);
  if (_stp && _stp[key]) return _stp[key];
  if (!_stp) _stp = {};
  const res = computeStp(vlan);
  _stp[key] = res;
  return res;
}
function computeStp(vlan) {
  const switches = state.devices.filter(d => isPlaced(d) && netClass(d) === 'switch');
  const roles = new Map();     // "devId:port" -> role
  if (switches.length < 2) return { rootId: switches[0] && switches[0].id, roles, cost: new Map(), vlan, links: [] };

  // switch-to-switch links only; host and router ports are edge ports
  const links = [];
  for (const c of state.cables) {
    const da = deviceById(c.a.deviceId), db = deviceById(c.b.deviceId);
    if (!da || !db) continue;
    const ea = hopThroughPatches(da, c.a.port, epSide(c.a));
    if (!ea) continue;
    if (netClass(da) !== 'switch' || netClass(ea.dev) !== 'switch') continue;
    if (da.id === ea.dev.id) continue;
    // A per-VLAN tree only spans links that actually carry that VLAN — which is
    // the whole point of PVST+: VLAN 20 can block a link that VLAN 10 forwards.
    if (vlan !== undefined && !(portCarries(da, c.a.port, vlan) && portCarries(ea.dev, ea.port, vlan))) continue;
    links.push({ aId: da.id, aPort: c.a.port, bId: ea.dev.id, bPort: ea.port, cost: stpCost(linkSpeed(c)), cable: c });
  }
  if (!links.length) return { rootId: switches[0].id, roles, cost: new Map(), vlan, links: [] };

  // Each connected component elects its own root — an isolated group of
  // switches is its own L2 island with its own spanning tree, not a set of
  // rootless bridges. Running one global tree blocks every port on any island
  // that can't reach the global root, which is wrong and was caught by test.
  const adj = new Map(switches.map(d => [d.id, []]));
  for (const l of links) { adj.get(l.aId).push(l); adj.get(l.bId).push(l); }
  const cost = new Map(switches.map(d => [d.id, Infinity]));
  const via = new Map();
  const seenComp = new Set();
  let globalRoot = null;

  for (const seed of switches) {
    if (seenComp.has(seed.id)) continue;
    // collect this component
    const comp = [];
    const stack = [seed.id];
    seenComp.add(seed.id);
    while (stack.length) {
      const id = stack.pop();
      comp.push(id);
      for (const l of adj.get(id) || []) {
        const far = l.aId === id ? l.bId : l.aId;
        if (!seenComp.has(far)) { seenComp.add(far); stack.push(far); }
      }
    }
    // 1. root of this component = lowest bridge ID within it
    const root = comp.map(deviceById).sort((x, y) => bridgeIdKey(x, vlan) < bridgeIdKey(y, vlan) ? -1 : 1)[0];
    if (!globalRoot) globalRoot = root;
    cost.set(root.id, 0);
    // 2. least-cost path to that root (Dijkstra over this component)
    const todo = new Set(comp);
    while (todo.size) {
      let cur = null;
      for (const id of todo) if (cur === null || cost.get(id) < cost.get(cur)) cur = id;
      todo.delete(cur);
      if (cost.get(cur) === Infinity) break;
      for (const l of adj.get(cur) || []) {
        const far = l.aId === cur ? l.bId : l.aId;
        const farPort = l.aId === cur ? l.bPort : l.aPort;
        if (!todo.has(far)) continue;
        const nc = cost.get(cur) + l.cost;
        const better = nc < cost.get(far) ||
          (nc === cost.get(far) && via.get(far) &&
            bridgeIdKey(deviceById(cur), vlan) < bridgeIdKey(deviceById(via.get(far).peerId), vlan));
        if (better) { cost.set(far, nc); via.set(far, { link: l, port: farPort, peerId: cur }); }
      }
    }
  }
  // 3. root port on every non-root bridge
  for (const [devId, v] of via) roles.set(`${devId}:${v.port}`, 'root');
  // 4. designated port per segment: the end closer to its root (tie -> lower BID)
  for (const l of links) {
    const ca = cost.get(l.aId), cb = cost.get(l.bId);
    let desig;
    if (ca !== cb) desig = ca < cb ? 'a' : 'b';
    else desig = bridgeIdKey(deviceById(l.aId), vlan) < bridgeIdKey(deviceById(l.bId), vlan) ? 'a' : 'b';
    const dKey = desig === 'a' ? `${l.aId}:${l.aPort}` : `${l.bId}:${l.bPort}`;
    const oKey = desig === 'a' ? `${l.bId}:${l.bPort}` : `${l.aId}:${l.aPort}`;
    if (roles.get(dKey) !== 'root') roles.set(dKey, 'designated');
    // 5. Anything neither root nor designated does not forward. 802.1D calls it
    // blocking; RSTP splits it by WHY: an alternate port is a spare path to the
    // root (a different bridge is designated on that segment), a backup port is
    // a second port of this bridge onto a segment it is already designated for.
    // The distinction is what lets RSTP fail over without recomputing.
    if (!roles.has(oKey)) {
      const oId = desig === 'a' ? l.bId : l.aId;
      const oPort = desig === 'a' ? l.bPort : l.aPort;
      const dId = desig === 'a' ? l.aId : l.bId;
      roles.set(oKey, oId === dId ? 'backup' : 'alternate');
    }
  }
  return { rootId: globalRoot && globalRoot.id, roles, cost, links, vlan };
}
// 802.1D role names for the classic view; RSTP keeps alternate/backup distinct.
function stpRole(devId, port, vlan) {
  const r = stpState(vlan).roles.get(`${devId}:${port}`) || null;
  if (!r) return null;
  const dev = deviceById(devId);
  if (stpMode(dev) === 'rapid-pvst') return r;
  return (r === 'alternate' || r === 'backup') ? 'blocking' : r;
}
// A port is blocked when its role does not forward — under either protocol.
function stpBlocked(devId, port, vlan) {
  const r = stpState(vlan).roles.get(`${devId}:${port}`);
  return r === 'blocking' || r === 'alternate' || r === 'backup';
}

// The state a port is in, and when it will next change. Real 802.1D walks
// blocking -> listening -> learning -> forwarding, 15 s per step, so a port that
// just came up needs 30 s before it passes traffic. RSTP skips that on a
// point-to-point link, and an edge port skips it under both.
const _stpPortUp = new Map();            // "devId:port" -> simNow() when it came up
function stpPortUpAt(devId, port) {
  const k = `${devId}:${port}`;
  if (!_stpPortUp.has(k)) _stpPortUp.set(k, simNow());
  return _stpPortUp.get(k);
}
function stpPortState(devId, port, vlan) {
  const role = stpState(vlan).roles.get(`${devId}:${port}`);
  const dev = deviceById(devId);
  if (!role) {
    // Not a switch-to-switch port: an access port for a host.
    return { state: 'forwarding', role: 'designated', edge: true,
      note: isEdgePort(dev, port) ? 'edge port (PortFast) — forwards immediately' : null };
  }
  if (role === 'blocking' || role === 'alternate' || role === 'backup') {
    return { state: stpMode(dev) === 'rapid-pvst' ? 'discarding' : 'blocking', role };
  }
  if (isEdgePort(dev, port)) return { state: 'forwarding', role, edge: true, note: 'edge port (PortFast)' };
  if (stpMode(dev) === 'rapid-pvst') {
    return { state: 'forwarding', role, note: 'rapid-pvst: proposal/agreement on a point-to-point link, no timer wait' };
  }
  const elapsed = (simNow() - stpPortUpAt(devId, port)) / 1000;
  if (elapsed < STP_FWD_DELAY_S) {
    return { state: 'listening', role, secsLeft: Math.ceil(STP_FWD_DELAY_S - elapsed),
      note: `listening — ${Math.ceil(STP_FWD_DELAY_S - elapsed)} s to learning` };
  }
  if (elapsed < STP_FWD_DELAY_S * 2) {
    return { state: 'learning', role, secsLeft: Math.ceil(STP_FWD_DELAY_S * 2 - elapsed),
      note: `learning MACs — ${Math.ceil(STP_FWD_DELAY_S * 2 - elapsed)} s to forwarding` };
  }
  return { state: 'forwarding', role };
}
// Which VLANs have their own tree — every VLAN any switch carries.
function stpVlans() {
  const set = new Set();
  for (const d of state.devices) {
    if (!isPlaced(d) || netClass(d) !== 'switch') continue;
    for (const v of vlanDb(d).keys()) set.add(v);
    const def = DEVICE_TYPES[d.type];
    for (let p = 1; p <= (def.ports || 0); p++) {
      const c = carriedVlans(d, p);
      if (c !== 'ALL') for (const v of c) set.add(v);
    }
  }
  return [...set].sort((a, b) => a - b);
}

// Layer-2 reachable? Plus the reason it isn't, discovered by relaxing rules.
function l2Reachable(a, b, srcPort, dstPort) {
  const v = hostVlan(a, srcPort);
  const strict = l2Walk(a, { vlan: v, startPort: srcPort });
  if (strict.hosts.has(b.id)) return { ok: true, routers: strict.routers };
  // relax length: a too-long copper run is the only thing stopping it?
  if (l2Walk(a, { vlan: v, startPort: srcPort, ignoreLength: true }).hosts.has(b.id))
    return { ok: false, reason: `a cable on the path exceeds the ${COPPER_LIMIT_FT} ft copper limit`, routers: strict.routers };
  // relax VLAN: physically connected but on a different VLAN / trunk gap
  if (l2Walk(a, { startPort: srcPort, ignoreVlan: true, ignoreLength: true }).hosts.has(b.id))
    return { ok: false, reason: `VLAN mismatch — ${a.name} is on VLAN ${v}, ${b.name} is on VLAN ${hostVlan(b, dstPort)} (or a trunk between them doesn't carry it)`, routers: strict.routers };
  return { ok: false, reason: 'no physical cable path between them', routers: strict.routers };
}

// Full ping verdict, L2 + L3.
// Why a host has no usable address. "No DHCP server in its broadcast domain"
// used to be the only answer offered, which was a guess — an expired lease, an
// exhausted scope and a dead relay are all different faults with different
// fixes, and the engine already knows which one happened.
function noAddressReason(d) {
  const nics = hostNics(d);
  if (!nics.some(n => n.ip === 'dhcp')) return `${d.name} has no valid IP`;
  for (const b of _dhcpBindings.values()) {
    if (b.hostId === d.id && b.state === 'EXPIRED') {
      return `${d.name}'s DHCP lease expired and could not be renewed — it has stopped using ${b.ip}`;
    }
  }
  const logged = _dhcpLog.find(l => l.host && l.host.id === d.id && !l.ok);
  if (logged) return `${d.name} has no DHCP lease — ${logged.reason}`;
  const r = dhcpExchange(d, { port: hostPort(d) });
  return r.ok ? `${d.name} has no valid IP` : `${d.name} has no DHCP lease — ${r.reason}`;
}

// `pkt` lets the caller send something other than a ping. Everything about the
// path is identical — only the packet the ACLs see changes, which is exactly
// the difference between "can these two reach each other" and "can this host
// reach that server on 443".
function pingHosts(aId, bId, pkt, opts = {}) {
  const a = deviceById(aId), b = deviceById(bId);
  if (!a || !b) return { ok: false, reason: 'device not found' };
  if (a.id === b.id) return { ok: true, mode: 'self', hops: [a.id], detail: 'loopback' };
  // A multi-homed host has several addresses and several ways out. Try each
  // destination NIC, choosing the source NIC the way a host routing table
  // would, and report success if any pair works — which is what actually
  // happens when you ping a dual-homed server by either of its names.
  let bNics = hostNics(b).filter(n => nicIp(b, n.port));
  if (!opts.nicPair && bNics.length > 1) {
    // Try the destination NIC a real ping would land on first: one sharing a
    // subnet with any of the source's own NICs. Plain port order made an admin
    // on the management VLAN reach a dual-homed server by routing all the way
    // round to its data NIC, when the two are sitting on the same wire.
    const srcIps = hostNics(a).map(n => nicIp(a, n.port)).filter(Boolean);
    bNics = bNics.slice().sort((x, y) => {
      const near = n => srcIps.some(si => sameSubnet(si, nicIp(b, n.port))) ? 0 : 1;
      return near(x) - near(y);
    });
    let first = null;
    for (const nb of bNics) {
      const r = pingHosts(aId, bId, pkt, { nicPair: { dst: nb.port } });
      if (r.ok) return r;
      if (!first) first = r;
    }
    return first || { ok: false, reason: noAddressReason(b) };
  }
  const dstPort = opts.nicPair ? opts.nicPair.dst : (bNics[0] ? bNics[0].port : hostPort(b));
  const ipB = nicIp(b, dstPort);
  if (!ipB) return { ok: false, reason: noAddressReason(b) };
  const srcNic = hostEgressNic(a, ipB.int) || { port: hostPort(a) };
  const srcPort = srcNic.port;
  const ipA = nicIp(a, srcPort);
  if (!ipA) return { ok: false, reason: noAddressReason(a) };

  if (sameSubnet(ipA, ipB)) {
    const l2 = l2Reachable(a, b, srcPort, dstPort);
    return l2.ok
      ? { ok: true, mode: 'l2', subnet: subnetLabel(ipA), hops: [a.id, b.id], detail: `same subnet ${subnetLabel(ipA)} — ARP resolves directly` }
      : { ok: false, mode: 'l2', reason: `same subnet, but ${l2.reason}` };
  }

  // Different subnets → routing. Each host needs a gateway that genuinely holds
  // an address in that host's subnet, and the two gateways must be able to
  // reach each other. A router merely sitting on the segment is not a gateway.
  const mkPkt = (s, d) => pkt ? { ...icmpEchoPacket(s, d), ...pkt, srcInt: s, dstInt: d } : icmpEchoPacket(s, d);
  const l2A = l2Walk(a, { vlan: hostVlan(a, srcPort), startPort: srcPort });
  const l2B = l2Walk(b, { vlan: hostVlan(b, dstPort), startPort: dstPort });
  const gwA = gatewayForHost(a, l2A, ipA, srcPort);
  if (gwA.error) return { ok: false, mode: 'l3', reason: gwA.error };
  const gwB = gatewayForHost(b, l2B, ipB, dstPort);
  if (gwB.error) return { ok: false, mode: 'l3', reason: gwB.error };

  const ifOf = (walk, rid) => { const j = walk.routers.get(rid); return j ? j.port : null; };
  // Forwarding is a table lookup at every hop, not a graph search for a router
  // that happens to touch both subnets. If a transit router has no route, the
  // packet stops there and says so — which is the real failure and the one the
  // old graph search silently routed around.
  const fwd = forwardPath(gwA.id, ipB.int, ifKey(gwA.iface));
  for (const leg of fwd.legs) {
    const r = deviceById(leg.id);
    const acl = aclCheck(r, { in: leg.inIf, out: leg.outIf }, mkPkt(ipA.int, ipB.int));
    if (acl.blocked) return { ok: false, mode: 'l3', reason: acl.reason, acl };
  }
  if (fwd.error) return { ok: false, mode: 'l3', reason: fwd.error, hops: [a.id, ...fwd.hops] };
  // The echo reply has to get home. Checking only the forward direction passes
  // asymmetric routing — a route out with no route back — which is one of the
  // most common real faults there is and exactly what a ping is used to find.
  const rev = forwardPath(gwB.id, ipA.int, ifKey(gwB.iface));
  if (rev.error) {
    return { ok: false, mode: 'l3', hops: [a.id, ...fwd.hops],
      reason: `${a.name} reaches ${b.name}, but the reply cannot get back — ${rev.error}` };
  }
  for (const leg of rev.legs) {                   // ACLs apply to the return path too
    const r = deviceById(leg.id);
    const acl = aclCheck(r, { in: leg.inIf, out: leg.outIf }, mkPkt(ipB.int, ipA.int));
    if (acl.blocked) {
      return { ok: false, mode: 'l3', hops: [a.id, ...fwd.hops],
        reason: `request reached ${b.name}, but the reply was ${acl.reason}` };
    }
  }
  const names = fwd.hops.map(id => deviceById(id).name);
  const g0 = deviceById(fwd.hops[0]);
  const detail = fwd.hops.length === 1
    ? `routed by ${g0.name}: ${ipStr(gwA.iface.ip.int)} (${gwA.iface.kind === 'svi' ? 'Vlan' + gwA.iface.vlan : 'port ' + gwA.iface.port})` +
      ` → ${ipStr(gwB.iface.ip.int)} (${gwB.iface.kind === 'svi' ? 'Vlan' + gwB.iface.vlan : 'port ' + gwB.iface.port})`
    : `routed via ${names.join(' → ')}`;
  return { ok: true, mode: 'l3', hops: [a.id, ...fwd.hops, b.id], detail };
}

// Shortest path between any router in set A and any in set B, over a graph where
// two routers are adjacent if they share a layer-2 segment (a transit LAN).
function routerAdjacency() {
  const routers = state.devices.filter(d => isPlaced(d) && netClass(d) === 'router');
  const adj = new Map(routers.map(r => [r.id, new Set()]));
  for (const r of routers) {
    const def = DEVICE_TYPES[r.type];
    for (let p = 1; p <= (def.ports || 0); p++) {
      if (portRole(def, p) === 'PWR') continue;
      const seg = l2Walk(r, { startPort: p, ignoreVlan: true });   // physical segment off this port
      for (const other of routers) {
        if (other.id !== r.id && seg.routers.has(other.id)) { adj.get(r.id).add(other.id); adj.get(other.id).add(r.id); }
      }
    }
  }
  return adj;
}
//////////////////// Routing table ////////////////////
// A router does not "find a path"; it looks up a destination in a table and
// forwards to a next hop. Building this as a real table is what makes traceroute
// truthful, what a PDU walk will consult hop by hop, and what makes a missing
// static route fail the way it does on real gear instead of being routed around
// by a graph search.
//
// Administrative distance is how a router picks between sources claiming the
// same prefix — lower wins. Values are Cisco's defaults, cross-checked against
// Cisco's own "Describe Administrative Distance" doc and two independent
// references; they are the numbers `show ip route` prints in [AD/metric].
const AD = { connected: 0, static: 1, eigrpSummary: 5, ebgp: 20, eigrp: 90,
  igrp: 100, ospf: 110, isis: 115, rip: 120, eigrpExternal: 170, ibgp: 200,
  unusable: 255 };
const AD_CODE = { connected: 'C', local: 'L', static: 'S', ospf: 'O',
  eigrp: 'D', rip: 'R', isis: 'i', bgp: 'B' };

// Every route a device knows, newest-correct-first. Connected routes are derived
// from addressed interfaces and cannot be configured away, exactly as on a real
// box. Static routes come from dev.routes.
function routingTable(dev) {
  const out = [];
  for (const i of deviceInterfaces(dev)) {
    const ifName = i.kind === 'svi' ? `Vlan${i.vlan}` : `Port ${i.port}`;
    out.push({ prefix: i.ip.network >>> 0, cidr: i.ip.cidr, mask: i.ip.mask >>> 0,
      via: null, iface: ifName, ad: AD.connected, metric: 0, src: 'connected',
      code: AD_CODE.connected, ifRef: i });
    // The /32 for the router's own address — this is the "L" line on IOS 15+.
    out.push({ prefix: i.ip.int >>> 0, cidr: 32, mask: 0xffffffff >>> 0,
      via: null, iface: ifName, ad: AD.connected, metric: 0, src: 'local',
      code: AD_CODE.local, ifRef: i, local: true });
  }
  for (const r of dev.routes || []) {
    const dst = parseIp(r.prefix);
    if (!dst) continue;
    const nh = r.via ? parseIp(r.via) : null;
    if (r.via && !nh) continue;
    // A static route's outgoing interface is the one whose subnet holds the
    // next hop — if none does, the next hop is unreachable and IOS will not
    // install the route at all.
    let iface = null, ifRef = null;
    if (nh) {
      for (const i of deviceInterfaces(dev)) {
        // A next hop is a bare address, not a prefix — it has no mask of its
        // own, so this is a containment test against the interface's subnet.
        // Comparing it as a subnet fails on any link that is not a /24: a
        // next hop of 192.168.0.2 on a /30 point-to-point parses as /24 and
        // never matches, so the route silently never installs.
        if (ipInSubnet(nh.int, i.ip)) { iface = i.kind === 'svi' ? `Vlan${i.vlan}` : `Port ${i.port}`; ifRef = i; break; }
      }
      if (!iface) continue;                       // unresolvable next hop, not installed
    }
    out.push({ prefix: dst.network >>> 0, cidr: dst.cidr, mask: dst.mask >>> 0,
      via: nh ? nh.int >>> 0 : null, iface: iface || r.iface || null,
      ad: r.ad !== undefined ? +r.ad : AD.static, metric: 0, src: 'static',
      code: AD_CODE.static, ifRef });
  }
  return out;
}

// Longest prefix wins; AD breaks a tie between sources; metric breaks that.
// Returns the winning route, or null for "no route to host".
function lookupRoute(dev, dstInt) {
  let best = null;
  for (const r of routingTable(dev)) {
    if (r.local) continue;                        // /32 local is not a forwarding entry
    if (((dstInt & r.mask) >>> 0) !== r.prefix) continue;
    if (!best) { best = r; continue; }
    if (r.cidr !== best.cidr) { if (r.cidr > best.cidr) best = r; continue; }
    if (r.ad !== best.ad) { if (r.ad < best.ad) best = r; continue; }
    if (r.metric < best.metric) best = r;
  }
  return best;
}

// Forward hop by hop through real table lookups, the way a packet actually
// crosses a network. Returns the router chain, or why it stopped.
// An ACL can be applied to an SVI as readily as to a physical port
// (`interface Vlan20` / `ip access-group X in`), so an interface is keyed by
// port number when it is a routed port and `VlanN` when it is an SVI. Two
// separate bugs came from getting this wrong: SVIs keyed as null made every ACL
// on a routed VLAN unenforceable, and keying L3 ingress by the physical port
// the frame arrived on missed that a routed VLAN ingresses on its SVI.
function ifKey(ref) { return !ref ? null : (ref.kind === 'svi' ? `Vlan${ref.vlan}` : ref.port); }
const ROUTE_MAX_HOPS = 32;                        // IP TTL sanity bound
// `legs` carries the ingress and egress interface at every hop. ACLs are applied
// per interface per direction, so a transit router's interfaces have to come
// from the forwarding path itself — deriving them from the two endpoints' L2
// segments leaves every mid-path interface invisible, and an ACL there is then
// silently never evaluated.
function forwardPath(startRouterId, dstInt, ingressIf) {
  const hops = [], legs = [];
  let cur = deviceById(startRouterId);
  let inIf = ingressIf || null;
  const seen = new Set();
  const portOf = ifKey;
  for (let i = 0; i < ROUTE_MAX_HOPS && cur; i++) {
    hops.push(cur.id);
    if (seen.has(cur.id)) return { hops, legs, error: `routing loop at ${cur.name}` };
    seen.add(cur.id);
    // Destination directly attached to this router? then it is delivered here.
    const conn = routingTable(cur).find(r => !r.local && r.src === 'connected' &&
      ((dstInt & r.mask) >>> 0) === r.prefix);
    if (conn) {
      legs.push({ id: cur.id, inIf, outIf: portOf(conn.ifRef) });
      return { hops, legs, egress: conn };
    }
    const route = lookupRoute(cur, dstInt);
    if (!route) return { hops, legs, error: `${cur.name} has no route to ${ipStr(dstInt)}` };
    legs.push({ id: cur.id, inIf, outIf: portOf(route.ifRef) });
    if (route.via === null) return { hops, legs, egress: route };
    // Walk the wire to whoever owns the next-hop address.
    const nh = deviceHolding({ int: route.via, cidr: 32, mask: 0xffffffff, network: route.via });
    if (!nh) return { hops, legs, error: `${cur.name}: next hop ${ipStr(route.via)} for ${ipStr(route.prefix)}/${route.cidr} is not reachable` };
    if (nh.id === cur.id) return { hops, legs, egress: route };
    // The next router receives on whichever of its interfaces holds that link.
    inIf = null;
    for (const j of deviceInterfaces(nh)) if (ipInSubnet(route.via, j.ip)) { inIf = portOf(j); break; }
    cur = nh;
  }
  return { hops, legs, error: 'TTL exceeded — more than 32 hops' };
}

// `show ip route`
function showIpRoute(dev) {
  const rows = routingTable(dev).sort((a, b) => (a.prefix >>> 0) - (b.prefix >>> 0) || a.cidr - b.cidr);
  if (!rows.length) return `${dev.name} has no addressed interfaces — no routing table`;
  const out = ['Codes: C - connected, L - local, S - static, O - OSPF, D - EIGRP, R - RIP', ''];
  for (const r of rows) {
    const dest = `${ipStr(r.prefix)}/${r.cidr}`;
    const admin = r.src === 'connected' || r.src === 'local' ? '' : ` [${r.ad}/${r.metric}]`;
    const via = r.via !== null ? ` via ${ipStr(r.via)},` : (r.src === 'connected' || r.src === 'local' ? ' is directly connected,' : '');
    out.push(`${r.code.padEnd(2)}   ${dest}${admin}${via} ${r.iface || ''}`.trimEnd());
  }
  return out.join('\n');
}

function routerPath(fromSet, toSet) {
  const adj = routerAdjacency();
  const q = fromSet.map(id => [id]);
  const seen = new Set(fromSet);
  while (q.length) {
    const path = q.shift();
    const last = path[path.length - 1];
    if (toSet.includes(last)) return path;
    for (const nb of (adj.get(last) || [])) {
      if (!seen.has(nb)) { seen.add(nb); q.push([...path, nb]); }
    }
  }
  return null;
}

// Every host that can talk to itself/others — used for the reachability matrix.
function allHosts() { return state.devices.filter(isHostDev); }
function reachabilityMatrix() {
  const hosts = allHosts();
  const rows = hosts.map(a => ({
    id: a.id, name: a.name, ip: a.ip,
    reach: hosts.map(b => a.id === b.id ? 'self' : (pingHosts(a.id, b.id).ok ? 'ok' : 'no'))
  }));
  return { hosts, rows };
}

// `side` is optional: omit it to ask "is anything plugged into this port at all",
// pass it to ask about one specific face of a patch panel.
function portConnection(deviceId, port, side) {
  const hit = (ep) => ep.deviceId === deviceId && ep.port === port &&
    (side === undefined || epSide(ep) === side);
  return state.cables.find(c => hit(c.a) || hit(c.b));
}

function portBaseMat(pm) {
  // jacks stay realistically dark — the link LED carries the connection state
  return mat(0x07090d, { roughness: 0.3 });
}
function refreshPortTints() {
  for (const pm of portMeshes) {
    if (pm === hoverPort && PORT_GLOW) { pm.material = PORT_GLOW; continue; }
    if (vlanFocus && vlanFocus.ports.has(pm.userData.deviceId + ':' + pm.userData.port)) {
      const vc = vlanColor(vlanFocus.vlan);
      pm.material = mat(vc.getHex(), { emissive: vc.clone().multiplyScalar(0.45).getHex(), roughness: 0.35 });
      continue;
    }
    pm.material = portBaseMat(pm);
  }
  for (const led of portLeds) {
    const key = led.userData.deviceId + ':' + led.userData.port;
    if (vlanFocus && vlanFocus.ports.has(key)) {
      const vc = vlanColor(vlanFocus.vlan);
      led.material = mat(vc.getHex(), { emissive: vc.getHex(), emissiveIntensity: 1.8, roughness: 0.3 });
      continue;
    }
    const conn = portConnection(led.userData.deviceId, led.userData.port);
    led.material = conn
      ? mat(new THREE.Color(conn.color).getHex(), { emissive: new THREE.Color(conn.color).getHex(), emissiveIntensity: 1.8, roughness: 0.3 })
      : mat(0x141a20, { roughness: 0.4 });
  }
}

// One cable per physical jack, always. A patch panel port isn't "a port that
// takes two cables" — it's two jacks that share a number, and each holds exactly
// one plug, same as every other RJ45 in the building.
function portFull(deviceId, port, side) {
  return !!portConnection(deviceId, port, side === REAR ? REAR : FRONT);
}
let hoverPort = null;
let PORT_GLOW = null; // lazily created glow material for the hovered port

// Forgiving port picking: exact raycast first, then nearest port within a few
// screen pixels — no pixel-hunting tiny jacks.
const _pv = new THREE.Vector3();
function pickPort(px, py) {
  const direct = firstHit(portMeshes);
  if (direct) return direct.object;
  let best = null, bd = 16;
  for (const pm of portMeshes) {
    pm.getWorldPosition(_pv);
    _pv.project(camera);
    if (_pv.z > 1 || _pv.z < -1) continue;
    const sx = (_pv.x + 1) / 2 * innerWidth, sy = (-_pv.y + 1) / 2 * innerHeight;
    const d = Math.hypot(sx - px, sy - py);
    if (d < bd) { bd = d; best = pm; }
  }
  return best;
}

//////////////////// Removal ////////////////////

function removeFromArr(arr, pred) {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1);
}

//////////////////// Zip ties / velcro wraps ////////////////////

function nearestOnCurve(curve, p, samples = 140) {
  let bt = 0, bd = Infinity, bp = null;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const q = curve.getPointAt(t);
    const d = q.distanceToSquared(p);
    if (d < bd) { bd = d; bt = t; bp = q; }
  }
  return { t: bt, point: bp, dist: Math.sqrt(bd) };
}

function buildTie(tie) {
  const g = new THREE.Group();
  g.position.set(tie.x, tie.y, tie.z);
  const tangent = new THREE.Vector3(tie.tx || 1, tie.ty || 0, tie.tz || 0).normalize();
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
  // the strap wraps the actual packed bundle, so its size is derived from the
  // same radius the routing uses rather than an unrelated fudge factor
  const r = bundleRadius(tie.count || 1) + 0.1;
  const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.075, 8, 28),
    mat(0x14171c, { roughness: 0.5, metalness: 0.1 }));
  band.userData = { isTie: true, tieId: tie.id };
  g.add(band); tieMeshes.push(band);
  // the little ratchet head every zip tie has, sitting proud of the band
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.26),
    mat(0x14171c, { roughness: 0.5 }));
  head.position.set(0, r, 0);
  head.userData = { isTie: true, tieId: tie.id };
  g.add(head); tieMeshes.push(head);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 0.07),
    mat(0x14171c, { roughness: 0.5 }));
  tail.position.set(0, r + 0.6, 0);
  tail.userData = { isTie: true, tieId: tie.id };
  g.add(tail); tieMeshes.push(tail);
  scene.add(g);
  tieGroups.set(tie.id, g);
  return g;
}

function placeTie(hitPoint) {
  // A tie straps cables to EACH OTHER (not to a point in space). In physics
  // mode the bundle hangs and swings together; the strap follows the bundle.
  const p = hitPoint.clone();
  const members = [];
  const centroid = new THREE.Vector3();
  let tangent = null;
  for (const c of state.cables) {
    const cm = cableMeshes.get(c.id);
    if (!cm || !cm.userData.curve) continue;
    const near = nearestOnCurve(cm.userData.curve, p);
    if (near.dist < 4.5) {
      members.push({ cableId: c.id, t: near.t });
      centroid.add(near.point);
      if (!tangent) tangent = cm.userData.curve.getTangentAt(near.t);
    }
  }
  if (!members.length) return null;
  centroid.multiplyScalar(1 / members.length);
  const tie = {
    id: uid(), members, x: centroid.x, y: centroid.y, z: centroid.z,
    tx: tangent.x, ty: tangent.y, tz: tangent.z, count: members.length
  };
  state.ties.push(tie);
  buildTie(tie);
  // the strap only means something once its members have been pulled into it
  for (const m of members) {
    const c = state.cables.find(x => x.id === m.cableId);
    if (c) rebuildCable(c);
  }
  return tie;
}

function deleteTie(id) {
  const g = tieGroups.get(id);
  if (g) { scene.remove(g); tieGroups.delete(id); }
  removeFromArr(tieMeshes, m => m.userData.tieId === id);
  // capture who was strapped before dropping the tie — cutting a tie has to
  // release its bundle, and after the splice there is nothing left to ask
  const tie = (state.ties || []).find(t => t.id === id);
  const freed = tie && tie.members ? tie.members.map(m => m.cableId) : [];
  removeFromArr(state.ties, t => t.id === id);
  for (const c of state.cables) {
    const before = c.waypoints.length;
    removeFromArr(c.waypoints, w => w.tieId === id);
    if (c.waypoints.length !== before || freed.includes(c.id)) {
      rebuildCable(c);
      if (physOn) buildRope(c);
    }
  }
}

function deleteCable(id) {
  flushL2Tables();

  const m = cableMeshes.get(id);
  if (m) { disposeCableObj(m); cableMeshes.delete(id); }
  cableRoutes.delete(id);          // stop steering other cables around a gap
  for (const rw of state.raceways || []) {   // free its slot in every pathway
    if (rw.cables && rw.cables.includes(id)) {
      rw.cables = rw.cables.filter(x => x !== id);
      rebuildRaceway(rw);
    }
  }
  removeFromArr(state.cables, c => c.id === id);
  refreshPortTints();
}

function deleteDevice(id) {
  flushL2Tables();

  for (const c of state.cables.filter(c => c.a.deviceId === id || c.b.deviceId === id)) deleteCable(c.id);
  const g = deviceGroups.get(id);
  if (g) {
    g.parent.remove(g);
    deviceGroups.delete(id);
    removeFromArr(portMeshes, pm => pm.userData.deviceId === id);
    removeFromArr(portLeds, lm => lm.userData.deviceId === id);
    removeFromArr(managerMeshes, mm => mm.userData.deviceId === id);
  }
  removeFromArr(state.devices, d => d.id === id);
  removeFromArr(state.links, l => l.aId === id || l.bId === id);
  collidersDirty = true;
}

function deleteRack(id) {
  for (const d of state.devices.filter(d => d.rackId === id)) deleteDevice(d.id);
  const g = rackGroups.get(id);
  if (g) {
    scene.remove(g);
    rackGroups.delete(id);
    removeFromArr(rackPlanes, p => p.userData.rackId === id);
    removeFromArr(rackFrames, f => f.userData.rackId === id);
  }
  removeFromArr(state.racks, r => r.id === id);
  collidersDirty = true;
}

//////////////////// Placement helpers ////////////////////

function rackOccupied(rackId, u, uh, ignoreId) {
  return state.devices.some(d => {
    if (d.rackId !== rackId || d.id === ignoreId) return false;
    const def = DEVICE_TYPES[d.type];
    if (def.vertical) return false;
    return u < d.u + def.uh && d.u < u + uh;
  });
}

function deviceLabelCounter(type) {
  const base = DEVICE_TYPES[type].short || { switch48: 'Switch', switch24: 'Switch', patch24: 'Patch', router: 'Router',
    firewall: 'FW', server: 'Server', ups: 'UPS', hcm: 'HCM', vcm: 'VCM', ap: 'AP', camera: 'Cam' }[type] || 'Dev';
  let n = 1;
  while (state.devices.some(d => d.name === `${base}-${n}`)) n++;
  return `${base}-${n}`;
}

//////////////////// Ghost (placement preview) ////////////////////

let ghost = null;
function clearGhost() {
  if (ghost) { scene.remove(ghost); ghost = null; }
}
function makeGhost(w, h, d, ok) {
  clearGhost();
  ghost = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ color: ok ? 0x22c55e : 0xef4444, transparent: true, opacity: 0.4, depthWrite: false }));
  scene.add(ghost);
}

//////////////////// Raycasting & input ////////////////////

const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();
let downPos = null;
let hoverInfo = null; // cached placement info from last mousemove

function setMouse(e) {
  mouseNDC.x = (e.clientX / innerWidth) * 2 - 1;
  mouseNDC.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouseNDC, camera);
}

function firstHit(objects) {
  const hits = raycaster.intersectObjects(objects, false);
  return hits.length ? hits[0] : null;
}

const tooltip = document.getElementById('tooltip');
const statusBar = document.getElementById('status');

function deviceById(id) { return state.devices.find(d => d.id === id); }
function rackById(id) { return state.racks.find(r => r.id === id); }

function setStatus(t) { statusBar.textContent = t; }

//////////////////// Cable preview line ////////////////////

let previewLine = null;
function updatePreview(cursorPoint) {
  if (!cableDraft) return;
  const a = getPortWorld(cableDraft.a.deviceId, cableDraft.a.port, epSide(cableDraft.a));
  if (!a) return;
  const pts = [a.pos.clone(), a.pos.clone().addScaledVector(a.normal, 2.5)];
  for (const w of cableDraft.waypoints) pts.push(new THREE.Vector3(w.x, w.y, w.z));
  if (cursorPoint) pts.push(cursorPoint);
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(60));
  if (previewLine) { previewLine.geometry.dispose(); previewLine.geometry = geo; }
  else {
    previewLine = new THREE.Line(geo, new THREE.LineDashedMaterial({
      color: document.getElementById('cable-color').value, dashSize: 1.2, gapSize: 0.6 }));
    scene.add(previewLine);
  }
  previewLine.computeLineDistances();
}
function clearPreview() {
  if (previewLine) { scene.remove(previewLine); previewLine.geometry.dispose(); previewLine = null; }
}

//////////////////// Mouse move ////////////////////

const lastPtr = { x: innerWidth / 2, y: innerHeight / 2 };
function updateHover(cx, cy) {
  lastPtr.x = cx; lastPtr.y = cy;
  hoverInfo = null;
  tooltip.classList.add('hidden');

  // Port hover: forgiving picking in cable mode, glow feedback in all modes
  const directHit = firstHit(portMeshes);
  const pobj = mode === 'cable' ? pickPort(cx, cy) : (directHit ? directHit.object : null);
  if (hoverPort && hoverPort !== pobj) hoverPort.material = portBaseMat(hoverPort);
  hoverPort = pobj || null;
  if (hoverPort) {
    PORT_GLOW = PORT_GLOW || mat(0x8cc4ff, { emissive: 0x2f7fe0, emissiveIntensity: 1.3, roughness: 0.3 });
    hoverPort.material = PORT_GLOW;
  }
  const portHit = pobj ? { object: pobj, point: pobj.getWorldPosition(new THREE.Vector3()) } : null;
  if (portHit) {
    const { deviceId, port } = portHit.object.userData;
    const side = meshSide(portHit.object);
    const dev = deviceById(deviceId);
    const conn = portConnection(deviceId, port, side);
    const role = dev ? portRole(DEVICE_TYPES[dev.type], port) : 'LAN';
    const pcfg = dev && dev.portCfg && dev.portCfg[port];
    // on a patch panel the face is the whole point — say which one you're on
    const face = dev && DEVICE_TYPES[dev.type].passthrough
      ? (side === REAR ? ' · rear punchdown' : ' · front') : '';
    const spec = portSpecLabel(portHit.object.userData);
    const stpr = stpRole(deviceId, port);
    let txt = `${dev ? dev.name : '?'}${dev && dev.ip ? ' (' + dev.ip + ')' : ''} · ${portLabel(dev, port)}${face}`
      + (spec ? ` · ${spec}` : '')
      + (stpr ? ` · STP ${stpr}` : '')
      + (role !== 'LAN' && role !== 'PWR' ? ` (${role})` : '')
      + (pcfg && pcfg.vlan ? ` · VLAN ${pcfg.vlan}` : '')
      + (pcfg && pcfg.label ? ` · ${pcfg.label}` : '');
    if (conn) {
      const isA = conn.a.deviceId === deviceId && conn.a.port === port && epSide(conn.a) === side;
      const other = isA ? conn.b : conn.a;
      const od = deviceById(other.deviceId);
      const oFace = od && DEVICE_TYPES[od.type].passthrough
        ? (epSide(other) === REAR ? ' rear' : ' front') : '';
      txt += `  →  ${od ? od.name : '?'}${od && od.ip ? ' (' + od.ip + ')' : ''} · Port ${other.port}${oFace}`;
    } else if (dev && DEVICE_TYPES[dev.type].passthrough) {
      // show the other face of this same port — that's the run it passes through to
      const mate = portConnection(deviceId, port, side === REAR ? FRONT : REAR);
      txt += mate ? `  ·  free (${side === REAR ? 'front' : 'rear'} is patched)` : '  ·  free';
    }
    tooltip.textContent = txt;
    tooltip.style.left = (cx + 14) + 'px';
    tooltip.style.top = (cy + 10) + 'px';
    tooltip.classList.remove('hidden');
  } else if (mode === 'select' || mode === 'cable' || walkActive) {
    // whole-device tooltip so you always know what you're looking at
    const dh = firstHit(collectDeviceBodies());
    if (dh) {
      const dev = deviceById(dh.object.userData.deviceId);
      if (dev) {
        tooltip.textContent = `${dev.name}${dev.ip ? ' (' + dev.ip + ')' : ''} — ${DEVICE_TYPES[dev.type].label}`;
        tooltip.style.left = (cx + 14) + 'px';
        tooltip.style.top = (cy + 10) + 'px';
        tooltip.classList.remove('hidden');
      }
    }
  }

  if (mode === 'place' && pendingType) {
    const def = DEVICE_TYPES[pendingType];
    if (def.field) {
      const mounts = def.mounts || ['ceiling'];
      // wall mounting when pointing at a wall (only if this product wall-mounts)
      if (mounts.includes('wall')) {
        const wh = firstHit([...wallMeshes.values()]);
        if (wh) {
          const n = wh.face.normal.clone().transformDirection(wh.object.matrixWorld);
          n.y = 0;
          if (n.lengthSq() > 0.01) {
            n.normalize();
            const rotY = Math.atan2(n.x, n.z);
            const wref = state.walls.find(w => w.id === wh.object.userData.wallId);
            const wb = (wref && wref.y0) || 0;
            const y = Math.max(wb + 12, Math.min(wb + ((wref && wref.h) || WALL_H) - 6, Math.round(wh.point.y)));
            const p = wh.point.clone().addScaledVector(n, 0.3);
            makeGhost(9, 9, 6, true);
            ghost.position.set(p.x, y, p.z);
            ghost.rotation.y = rotY;
            hoverInfo = { mountKind: 'wall', x: p.x, y, z: p.z, rotY };
            setStatus(`${def.label} — wall mount at ${(y / 12).toFixed(1)} ft. Click to place.`);
            return;
          }
        }
      }
      const fh = firstHit(groundTargets());
      if (fh) {
        const x = Math.round(fh.point.x / 3) * 3, z = Math.round(fh.point.z / 3) * 3;
        const y0 = groundYFromHit(fh);
        if (mounts.includes('ceiling')) {
          makeGhost(8, def.mountH + 2, 8, true);
          ghost.position.set(x, y0 + (def.mountH + 2) / 2, z);
          ghost.rotation.y = 0;
          hoverInfo = { mountKind: 'pole', x, z, y0 };
          setStatus(`${def.label} — ceiling-pole mount${mounts.includes('wall') ? ', or point at a wall' : ''}. Click to place.`);
        } else if (mounts.includes('desk')) {
          makeGhost(8, 8, 8, true);
          ghost.position.set(x, y0 + 4, z);
          ghost.rotation.y = 0;
          hoverInfo = { mountKind: 'desk', x, z, y0 };
          setStatus(`${def.label} — floor placement${mounts.includes('wall') ? ', or point at a wall' : ''}. Click to place.`);
        } else {
          // wall-only product (intercom, doorbell, reader...) — must go on a wall
          makeGhost(9, 9, 6, false);
          ghost.position.set(x, 48, z);
          hoverInfo = null;
          setStatus(`${def.label} mounts on a wall — point at a wall to place it (draw one with the Wall tool if needed).`);
        }
      } else { clearGhost(); hoverInfo = null; }
      return;
    }
    const hit = firstHit(rackPlanes);
    if (hit) {
      const rackId = hit.object.userData.rackId;
      const g = rackGroups.get(rackId);
      const local = g.worldToLocal(hit.point.clone());
      if (def.vertical) {
        const side = local.x >= 0 ? 'R' : 'L';
        const exists = state.devices.some(d => d.rackId === rackId && d.type === 'vcm' && d.side === side);
        makeGhost(3.4, RACK_UNITS * U, 6, !exists);
        const lp = new THREE.Vector3((side === 'L' ? -1 : 1) * (RACK_OUTER_W / 2 + 1.8), RACK_BASE + RACK_UNITS * U / 2, RACK_D / 2 - 3);
        ghost.position.copy(g.localToWorld(lp));
        ghost.quaternion.copy(g.quaternion);
        hoverInfo = exists ? null : { rackId, side };
        setStatus(`Vertical manager — ${side === 'L' ? 'left' : 'right'} side ${exists ? '(occupied)' : ''}`);
      } else {
        let u = Math.floor((local.y - RACK_BASE) / U) + 1;
        u = Math.max(1, Math.min(RACK_UNITS - def.uh + 1, u));
        const ok = !rackOccupied(rackId, u, def.uh);
        makeGhost(RACK_W + 2, def.uh * U - 0.1, def.depth, ok);
        const lp = new THREE.Vector3(0, RACK_BASE + (u - 1) * U + def.uh * U / 2, RACK_D / 2 - 1);
        ghost.position.copy(g.localToWorld(lp));
        ghost.quaternion.copy(g.quaternion);
        hoverInfo = ok ? { rackId, u } : null;
        setStatus(`${def.label} @ U${u}${def.uh > 1 ? '–U' + (u + def.uh - 1) : ''} ${ok ? '' : '(occupied)'}`);
      }
      return;
    }
    clearGhost();
  }

  if (mode === 'rack') {
    const hit = firstHit(groundTargets());
    if (hit) {
      const x = Math.round(hit.point.x / 6) * 6, z = Math.round(hit.point.z / 6) * 6;
      const y0 = groundYFromHit(hit);
      makeGhost(RACK_OUTER_W, RACK_H, RACK_D, true);
      ghost.position.set(x, y0 + RACK_H / 2, z);
      ghost.rotation.y = pendingRackRot;
      hoverInfo = { x, z, y0 };
    }
    return;
  }

  if (mode === 'wall') {
    const hit = firstHit(groundTargets());
    if (hit) {
      const x = Math.round(hit.point.x / 6) * 6, z = Math.round(hit.point.z / 6) * 6;
      const y0 = wallStart ? wallStart.y0 : groundYFromHit(hit);
      hoverInfo = { x, z, y0 };
      if (wallStart) {
        const dx = x - wallStart.x, dz = z - wallStart.z;
        const len = Math.hypot(dx, dz);
        if (len > 1) {
          makeGhost(len, WALL_H, WALL_T, true);
          ghost.position.set((wallStart.x + x) / 2, y0 + WALL_H / 2, (wallStart.z + z) / 2);
          ghost.rotation.y = Math.atan2(-dz, dx);
          setStatus(`Wall: ${fmtLen(len)} — click to set the end. Esc finishes.`);
        }
      } else {
        makeGhost(4, WALL_H, 4, true);
        ghost.position.set(x, y0 + WALL_H / 2, z);
        setStatus('Click the floor (or an upper floor slab) to start a wall.');
      }
    }
    return;
  }

  if (mode === 'room') {
    const hit = firstHit(groundTargets());
    if (hit) {
      const x = Math.round(hit.point.x / 6) * 6, z = Math.round(hit.point.z / 6) * 6;
      const y0 = roomStart ? roomStart.y0 : groundYFromHit(hit);
      const preset = document.getElementById('room-size').value;
      if (preset !== 'drag') {
        const [pw, pd] = preset.split(',').map(Number);
        makeGhost(pw, WALL_H, pd, true);
        ghost.position.set(x + pw / 2, y0 + WALL_H / 2, z + pd / 2);
        ghost.rotation.y = 0;
        hoverInfo = { x1: x, z1: z, x2: x + pw, z2: z + pd, y0 };
        setStatus(`${fmtLen(pw)} × ${fmtLen(pd)} room — click to build it (corner at cursor).`);
      } else if (roomStart) {
        const wX = Math.abs(x - roomStart.x), wZ = Math.abs(z - roomStart.z);
        if (wX > 12 && wZ > 12) {
          makeGhost(wX, WALL_H, wZ, true);
          ghost.position.set((roomStart.x + x) / 2, y0 + WALL_H / 2, (roomStart.z + z) / 2);
          ghost.rotation.y = 0;
          hoverInfo = { x1: roomStart.x, z1: roomStart.z, x2: x, z2: z, y0 };
          setStatus(`Room: ${fmtLen(wX)} × ${fmtLen(wZ)} — click to build walls + ceiling.`);
        }
      } else {
        makeGhost(6, WALL_H, 6, true);
        ghost.position.set(x, y0 + WALL_H / 2, z);
        hoverInfo = { x, z, y0, start: true };
        setStatus('Click the first corner of the room (drag-size mode).');
      }
    }
    return;
  }

  if (mode === 'raceway') {
    const hit = firstHit(groundTargets());
    if (hit) {
      const x = Math.round(hit.point.x / 6) * 6, z = Math.round(hit.point.z / 6) * 6;
      const type = document.getElementById('raceway-type').value;
      const t = RACEWAY_TYPES[type];
      const y = pathwayY(t);
      hoverInfo = { x, z, y, type };
      if (racewayStart) {
        const len = Math.hypot(x - racewayStart.x, z - racewayStart.z);
        if (len > 6) {
          const size = t.kind === 'conduit' ? t.id + 0.12 : Math.max(t.w, t.d);
          makeGhost(size, size, len, true);
          ghost.position.set((racewayStart.x + x) / 2, y, (racewayStart.z + z) / 2);
          ghost.rotation.y = Math.atan2(x - racewayStart.x, z - racewayStart.z);
          const fits = racewayFill({ type, cables: [] }).room;
          setStatus(`${t.label}: ${fmtLen(len)} at ${fmtLen(y)} — holds ${fits} cat6 at NEC fill. Click to finish.`);
        }
      } else {
        setStatus(`${t.label} — click the start of the run. It lands at ${fmtLen(y)} on ${level().name}.`);
      }
    }
    return;
  }

  if (mode === 'stairs') {
    const hit = firstHit(groundTargets());
    if (hit) {
      const x = Math.round(hit.point.x / 6) * 6, z = Math.round(hit.point.z / 6) * 6;
      // a flight climbs from this floor to the deck resting on its walls
      const deck = deckAbove();
      const rise = deck - levelY();
      if (rise <= 0) { setStatus('Nothing above this storey to climb to — pick a lower level.'); return; }
      const geo = stairGeometry(rise);
      const upName = LEVELS[levelIndexForY(deck)].name;
      hoverInfo = { x, z, y0: levelY(), rise, rotY: pendingRackRot };
      makeGhost(STAIR_W, rise, geo.run, true);
      ghost.position.set(x, levelY() + rise / 2, z);
      ghost.rotation.y = pendingRackRot;
      setStatus(`Stairs ${level().name} → ${upName}: ${geo.steps} risers at ${geo.rise.toFixed(2)}" ` +
        `on ${geo.tread}" treads — ${fmtLen(geo.run)} of run. Q rotates · click to place.`);
    }
    return;
  }

  if (mode === 'slab') {
    // the work plane means this hits at the active storey's elevation even when
    // nothing has been built there yet — which is the whole point for a basement
    const hit = firstHit([workPlane, floorMesh]);
    if (hit) {
      const x = Math.round(hit.point.x / 12) * 12, z = Math.round(hit.point.z / 12) * 12;
      const elev = levelY();
      hoverInfo = { x, z, y: elev };
      if (slabStart) {
        const wX = Math.abs(x - slabStart.x), wZ = Math.abs(z - slabStart.z);
        if (wX > 6 && wZ > 6) {
          makeGhost(wX, SLAB_T, wZ, true);
          ghost.position.set((slabStart.x + x) / 2, elev - SLAB_T / 2, (slabStart.z + z) / 2);
          ghost.rotation.y = 0;
          setStatus(`${level().name} floor: ${fmtLen(wX)} × ${fmtLen(wZ)} at ${fmtLen(elev)} — click to finish.`);
        }
      } else {
        makeGhost(12, SLAB_T, 12, true);
        ghost.position.set(x, elev - SLAB_T / 2, z);
        setStatus(`First corner of the ${level().name} floor slab (${fmtLen(elev)}).` +
          (elev < 0 ? ' Below grade — this excavates, so grade stops being a floor here.' : ''));
      }
    }
    return;
  }

  if (mode === 'measure') {
    const targets = [...groundTargets(), ...wallMeshes.values(), ...rackFrames, ...collectDeviceBodies(), ...cableMeshes.values()];
    const hit = firstHit(targets);
    if (hit) {
      hoverInfo = { p: hit.point.clone() };
      if (measureStart) {
        updatePreviewMeasure(hit.point);
        setStatus(`Distance: ${fmtLen(measureStart.distanceTo(hit.point))} — click to pin this measurement.`);
      } else {
        setStatus('Measure — click the first point (floors, walls, racks, devices, cables all work).');
      }
    }
    return;
  }

  if (mode === 'drill') {
    const dia = currentBitDiameter();
    const hr = dia / 2;
    const wh = firstHit([...wallMeshes.values(), ...slabMeshes.values()]);
    if (wh) {
      const n = wh.face.normal.clone().transformDirection(wh.object.matrixWorld);
      if (wh.object.userData.isSlab) {
        // drilling through a floor/ceiling slab — vertical bore
        const ny = n.y >= 0 ? 1 : -1;
        const s = state.slabs.find(s2 => s2.id === wh.object.userData.slabId);
        const cy = s ? s.y - 3 : wh.point.y - ny * 3;
        makeGhost(dia + 1.4, 8, dia + 1.4, true);
        ghost.position.set(wh.point.x, cy, wh.point.z);
        ghost.rotation.y = 0;
        hoverInfo = { slabId: wh.object.userData.slabId, x: wh.point.x, y: cy, z: wh.point.z, nx: 0, ny, nz: 0, t: 6, r: hr };
        setStatus(`Drill Ø ${dia}" through the ${ny > 0 ? 'floor/ceiling slab' : 'ceiling'} — click to bore between levels.`);
        return;
      }
      n.y = 0;
      if (n.lengthSq() > 0.01) {
        n.normalize();
        const wref = state.walls.find(w => w.id === wh.object.userData.wallId);
        const wb = (wref && wref.y0) || 0;
        const y = Math.max(wb + 4, Math.min(wb + ((wref && wref.h) || WALL_H) - 4, Math.round(wh.point.y)));
        const center = wh.point.clone().addScaledVector(n, -WALL_T / 2);
        makeGhost(dia + 1.4, dia + 1.4, WALL_T + 2, true);
        ghost.position.set(center.x, y, center.z);
        ghost.rotation.y = Math.atan2(n.x, n.z);
        hoverInfo = { wallId: wh.object.userData.wallId, x: center.x, y, z: center.z, nx: n.x, ny: 0, nz: n.z, t: WALL_T, r: hr };
        setStatus(`Drill Ø ${dia}" at ${(y / 12).toFixed(1)} ft — click to drill.`);
        return;
      }
    }
    clearGhost(); hoverInfo = null;
    setStatus('Drill — point at a wall, floor slab, or ceiling. Pick the bit size in the toolbar.');
    return;
  }

  if (mode === 'cable' && cableDraft) {
    // preview follows ports > managers > any surface
    let pt = null;
    if (portHit) pt = portHit.point;
    else {
      const mh = firstHit(managerMeshes);
      if (mh) pt = mh.point.clone().addScaledVector(mh.face.normal.clone().transformDirection(mh.object.matrixWorld), 0.5);
      else {
        const fh = firstHit([floorMesh]);
        if (fh) pt = fh.point;
      }
    }
    updatePreview(pt);
  }
}

renderer.domElement.addEventListener('pointermove', e => {
  if (walkActive) return; // walking: hover runs per-frame from the crosshair
  setMouse(e);
  updateHover(e.clientX, e.clientY);
});

//////////////////// Cable route editing ////////////////////
// A selected cable shows draggable handles: yellow spheres on each bend point,
// blue spheres at segment midpoints to add one. This is the "pull the wire"
// interaction — grab a bend and slide it, everything re-routes live, snapped to
// the same 1" grid the router uses. No physics, fully deterministic.

let cableEdit = null;          // { cableId }
const cableHandleMeshes = [];  // raycast targets (both yellow and blue)
let handleDrag = null;         // active drag: { wpIndex, cable, snap, moved }
const _dragPlane = new THREE.Plane();
const _dragHit = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);

function clearCableHandles() {
  for (const m of cableHandleMeshes) { scene.remove(m); if (m.geometry) m.geometry.dispose(); }
  cableHandleMeshes.length = 0;
  cableEdit = null;
}
const HANDLE_YEL = new THREE.MeshBasicMaterial({ color: 0xffd23e, depthTest: false });
const HANDLE_BLU = new THREE.MeshBasicMaterial({ color: 0x4da3ff, transparent: true, opacity: 0.75, depthTest: false });

function showCableHandles(cable) {
  clearCableHandles();
  cableEdit = { cableId: cable.id };
  const wps = cable.waypoints || [];
  wps.forEach((w, i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), HANDLE_YEL);
    m.position.set(w.x, w.y, w.z);
    m.renderOrder = 999;
    m.userData = { cableHandle: true, wpIndex: i };
    m.updateMatrixWorld();
    scene.add(m); cableHandleMeshes.push(m);
  });
  // add-point handles at midpoints of the control chain (portA, wps…, portB)
  const ep = cablePorts(cable);
  if (ep) {
    const chain = [ep.a.pos.clone(), ...wps.map(w => new THREE.Vector3(w.x, w.y, w.z)), ep.b.pos.clone()];
    for (let i = 0; i < chain.length - 1; i++) {
      const mid = chain[i].clone().add(chain[i + 1]).multiplyScalar(0.5);
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 8), HANDLE_BLU);
      m.position.copy(mid);
      m.renderOrder = 999;
      m.userData = { cableAddHandle: true, insertIndex: i };
      m.updateMatrixWorld();
      scene.add(m); cableHandleMeshes.push(m);
    }
  }
}

// Capture phase so this beats OrbitControls: if the click grabbed a handle we
// disable orbit before its own pointerdown handler reads controls.enabled.
renderer.domElement.addEventListener('pointerdown', e => {
  if (!cableEdit || walkActive) return;
  setMouse(e);
  const hit = firstHit(cableHandleMeshes);
  if (!hit) return;
  const cable = state.cables.find(c => c.id === cableEdit.cableId);
  if (!cable) return;
  if (e.button === 2) {                       // right-click a bend removes it
    if (hit.object.userData.cableHandle) {
      undoPush();
      cable.waypoints.splice(hit.object.userData.wpIndex, 1);
      rebuildCable(cable); showCableHandles(cable);
      e.stopPropagation(); e.preventDefault();
    }
    return;
  }
  if (e.button !== 0) return;
  controls.enabled = false;
  let wpIndex;
  if (hit.object.userData.cableAddHandle) {    // insert a new bend, then drag it
    wpIndex = hit.object.userData.insertIndex;
    const p = snapCable(hit.object.position);
    cable.waypoints.splice(wpIndex, 0, { x: p.x, y: p.y, z: p.z });
  } else {
    wpIndex = hit.object.userData.wpIndex;
  }
  handleDrag = { wpIndex, cable, snap: serialize(), moved: false };
  rebuildCable(cable); showCableHandles(cable);
  e.stopPropagation();
}, true);

window.addEventListener('pointermove', e => {
  if (!handleDrag) return;
  setMouse(e);   // sets mouseNDC and the raycaster
  const w = handleDrag.cable.waypoints[handleDrag.wpIndex];
  const cur = new THREE.Vector3(w.x, w.y, w.z);
  let np = null;
  if (e.shiftKey) {
    // vertical: plane through the point, facing the camera horizontally — take Y
    const n = camera.getWorldDirection(new THREE.Vector3()); n.y = 0; n.normalize();
    _dragPlane.setFromNormalAndCoplanarPoint(n, cur);
    if (raycaster.ray.intersectPlane(_dragPlane, _dragHit)) np = new THREE.Vector3(cur.x, _dragHit.y, cur.z);
  } else {
    // horizontal: slide across the floor plane at the point's height
    _dragPlane.setFromNormalAndCoplanarPoint(_UP, cur);
    if (raycaster.ray.intersectPlane(_dragPlane, _dragHit)) np = new THREE.Vector3(_dragHit.x, cur.y, _dragHit.z);
  }
  if (!np) return;
  np = snapCable(np);
  if (np.x === w.x && np.y === w.y && np.z === w.z) return;
  w.x = np.x; w.y = np.y; w.z = np.z;
  handleDrag.moved = true;
  rebuildCable(handleDrag.cable);
  const h = cableHandleMeshes.find(m => m.userData.cableHandle && m.userData.wpIndex === handleDrag.wpIndex);
  if (h) { h.position.copy(np); h.updateMatrixWorld(); }
});

window.addEventListener('pointerup', () => {
  if (!handleDrag) return;
  const cable = handleDrag.cable;
  if (handleDrag.moved) undoStack.push(handleDrag.snap);   // pre-drag snapshot
  handleDrag = null;
  controls.enabled = true;
  showCableHandles(cable);                                  // re-place midpoint handles
  // refresh the panel's route-point count / length without rebuilding handles twice
  if (selected && selected.kind === 'cable' && selected.id === cable.id) {
    const rp = propsBody.querySelector('.row:nth-child(3) span:last-child');
    updateCablePropStats(cable);
  }
});

// Light refresh of just the numbers in an open cable panel (avoids re-running
// showCableProps, which would rebuild the handles mid-interaction).
function updateCablePropStats(c) {
  const rows = propsBody.querySelectorAll('.row');
  if (rows[2]) rows[2].querySelector('span:last-child').textContent = c.waypoints.length;
  if (rows[3]) rows[3].querySelector('span:last-child').textContent = (c.lengthIn / 12).toFixed(1) + ' ft';
}

//////////////////// Click handling ////////////////////

let pendingRackRot = 0;

renderer.domElement.addEventListener('pointerdown', e => { downPos = { x: e.clientX, y: e.clientY }; camTween = null; });

// double-click a device: fly to a face-on close-up. Double-click it again to
// flip around to the rear panel (power, fans, punchdowns).
let camTween = null;
let inspectLast = null;
renderer.domElement.addEventListener('dblclick', e => {
  if (walkActive) return;
  setMouse(e);
  const dh = firstHit(collectDeviceBodies());
  if (!dh) { inspectLast = null; return; }
  const dev = deviceById(dh.object.userData.deviceId);
  if (!dev) return;
  const def = DEVICE_TYPES[dev.type];
  let side = 1;
  if (!def.field && inspectLast && inspectLast.id === dev.id) side = -inspectLast.side;
  inspectLast = { id: dev.id, side };
  const g = deviceGroups.get(dev.id);
  const q = g.getWorldQuaternion(new THREE.Quaternion());
  const n = new THREE.Vector3(0, 0, side).applyQuaternion(q);
  const center = g.getWorldPosition(new THREE.Vector3());
  if (def.field) {
    if (dev.mount === 'desk') center.y += 18;
    else if (dev.mount !== 'wall') center.y += (def.mountH || 96) - 2;
  }
  center.addScaledVector(n, 1.2);
  const dist = def.field ? 20 : 26;
  camTween = {
    p0: camera.position.clone(), t0: controls.target.clone(),
    p1: center.clone().addScaledVector(n, dist), t1: center, k: 0
  };
  setStatus(side === 1
    ? `${dev.name} — front close-up. Double-click it again to flip to the rear (power inlet, fans).`
    : `${dev.name} — rear panel. The power inlet is a live port: cable it to a UPS/PDU outlet.`);
});

const _centerNDC = new THREE.Vector2(0, 0);
renderer.domElement.addEventListener('pointerup', e => {
  if (walkActive) {
    // Satisfactory-style: interact with whatever the crosshair is on
    if (e.button !== 0) return;
    raycaster.setFromCamera(_centerNDC, camera);
    handleClick();
    return;
  }
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  downPos = null;
  if (moved > 5) return; // was a drag/orbit, not a click
  if (e.button === 2) {
    // right-click steps back: cancel draft → finish wall/slab/measure → back to Select
    if (cableDraft) { cableDraft = null; clearPreview(); setStatus('Cable cancelled.'); }
    else if (wallStart) { wallStart = null; clearGhost(); setStatus('Wall finished.'); }
    else if (measureStart) { measureStart = null; clearMeasurePreview(); setStatus('Measurement cancelled.'); }
    else if (slabStart) { slabStart = null; clearGhost(); setStatus('Slab cancelled.'); }
    else if (roomStart) { roomStart = null; clearGhost(); setStatus('Room cancelled.'); }
    else if (mode !== 'select') setMode('select');
    return;
  }
  if (e.button !== 0) return;
  setMouse(e);
  handleClick();
});

function handleClick() {
  if (mode === 'place' && pendingType) {
    if (!hoverInfo) return;
    undoPush();
    const def = DEVICE_TYPES[pendingType];
    if (placeExistingId) {
      // placing a logical device from the 2D plan into the physical map
      const dev = deviceById(placeExistingId);
      if (!dev) { placeExistingId = null; return; }
      if (def.field && hoverInfo.mountKind === 'wall') Object.assign(dev, { mount: 'wall', x: hoverInfo.x, y: hoverInfo.y, z: hoverInfo.z, rotY: hoverInfo.rotY });
      else if (def.field && hoverInfo.mountKind === 'desk') { Object.assign(dev, { mount: 'desk', x: hoverInfo.x, z: hoverInfo.z, y0: hoverInfo.y0 || 0 }); }
      else if (def.field) { delete dev.mount; Object.assign(dev, { x: hoverInfo.x, z: hoverInfo.z, y0: hoverInfo.y0 || 0 }); }
      else if (def.vertical) Object.assign(dev, { rackId: hoverInfo.rackId, side: hoverInfo.side, u: 0 });
      else Object.assign(dev, { rackId: hoverInfo.rackId, u: hoverInfo.u });
      buildDeviceGroup(dev);
      placeExistingId = null;
      setMode('select');
      setStatus(`${dev.name} is now placed in the physical map.`);
      return;
    }
    let dev;
    if (def.field && hoverInfo.mountKind === 'wall') dev = { id: uid(), type: pendingType, mount: 'wall', x: hoverInfo.x, y: hoverInfo.y, z: hoverInfo.z, rotY: hoverInfo.rotY, name: deviceLabelCounter(pendingType) };
    else if (def.field && hoverInfo.mountKind === 'desk') dev = { id: uid(), type: pendingType, mount: 'desk', x: hoverInfo.x, z: hoverInfo.z, y0: hoverInfo.y0 || 0, name: deviceLabelCounter(pendingType) };
    else if (def.field) dev = { id: uid(), type: pendingType, x: hoverInfo.x, z: hoverInfo.z, y0: hoverInfo.y0 || 0, name: deviceLabelCounter(pendingType) };
    else if (def.vertical) dev = { id: uid(), type: pendingType, rackId: hoverInfo.rackId, side: hoverInfo.side, u: 0, name: deviceLabelCounter(pendingType) };
    else dev = { id: uid(), type: pendingType, rackId: hoverInfo.rackId, u: hoverInfo.u, name: deviceLabelCounter(pendingType) };
    state.devices.push(dev);
    buildDeviceGroup(dev);
    recordRecent(dev.type);
    setStatus(`Placed ${dev.name}. Click another slot, or Esc to finish.`);
    return;
  }

  if (mode === 'rack') {
    if (!hoverInfo) return;
    undoPush();
    const rack = { id: uid(), x: hoverInfo.x, z: hoverInfo.z, y0: hoverInfo.y0 || 0, rotY: pendingRackRot, name: `Rack-${state.racks.length + 1}` };
    state.racks.push(rack);
    buildRackGroup(rack);
    setStatus(`Placed ${rack.name}. Click to add another, Q rotates, Esc to finish.`);
    return;
  }

  if (mode === 'wall') {
    if (!hoverInfo) return;
    if (!wallStart) {
      wallStart = { x: hoverInfo.x, z: hoverInfo.z, y0: hoverInfo.y0 || 0 };
      setStatus('Wall started — click to set the end point.');
    } else if (hoverInfo.x !== wallStart.x || hoverInfo.z !== wallStart.z) {
      undoPush();
      const w = { id: uid(), x1: wallStart.x, z1: wallStart.z, x2: hoverInfo.x, z2: hoverInfo.z, h: WALL_H, y0: wallStart.y0 || 0 };
      state.walls.push(w);
      buildWall(w);
      wallStart = { x: hoverInfo.x, z: hoverInfo.z, y0: wallStart.y0 || 0 }; // chain into the next segment
      setStatus('Wall placed — keep clicking to chain segments, Esc to finish.');
    }
    return;
  }

  if (mode === 'drill') {
    if (!hoverInfo) return;
    undoPush();
    const h = {
      id: uid(), wallId: hoverInfo.wallId, slabId: hoverInfo.slabId,
      x: hoverInfo.x, y: hoverInfo.y, z: hoverInfo.z,
      nx: hoverInfo.nx, ny: hoverInfo.ny || 0, nz: hoverInfo.nz,
      t: hoverInfo.t, r: hoverInfo.r
    };
    state.holes.push(h);
    buildHole(h);
    setStatus(`Ø ${(h.r * 2)}" hole drilled${h.slabId ? ' between levels' : ` at ${(h.y / 12).toFixed(1)} ft`}. Cables route through it.`);
    return;
  }

  if (mode === 'room') {
    if (!hoverInfo) return;
    const preset = document.getElementById('room-size').value;
    if (preset === 'drag' && hoverInfo.start) {
      roomStart = { x: hoverInfo.x, z: hoverInfo.z, y0: hoverInfo.y0 };
      setStatus('Corner set — click the opposite corner to build the room.');
      return;
    }
    if (hoverInfo.x1 === undefined) return;
    buildRoom(hoverInfo.x1, hoverInfo.z1, hoverInfo.x2, hoverInfo.z2, hoverInfo.y0);
    roomStart = null;
    return;
  }

  if (mode === 'raceway') {
    if (!hoverInfo) return;
    if (!racewayStart) {
      racewayStart = { x: hoverInfo.x, z: hoverInfo.z, y: hoverInfo.y };
      setStatus('Start set — click the far end of the run.');
    } else if (Math.hypot(hoverInfo.x - racewayStart.x, hoverInfo.z - racewayStart.z) > 6) {
      undoPush();
      const rw = {
        id: uid(), type: hoverInfo.type,
        x1: racewayStart.x, y1: racewayStart.y, z1: racewayStart.z,
        x2: hoverInfo.x, y2: hoverInfo.y, z2: hoverInfo.z, cables: []
      };
      state.raceways.push(rw);
      buildRaceway(rw);
      racewayStart = null;
      const f = racewayFill(rw);
      setStatus(`${f.label} run placed — holds ${f.room} cat6 at NEC fill. ` +
        `In Cable mode, click the raceway while drawing to pull a run into it.`);
    }
    return;
  }

  if (mode === 'stairs') {
    if (!hoverInfo || hoverInfo.rise === undefined) return;
    undoPush();
    const st = {
      id: uid(), x: hoverInfo.x, z: hoverInfo.z, y0: hoverInfo.y0,
      rise: hoverInfo.rise, rotY: hoverInfo.rotY || 0, w: STAIR_W
    };
    state.stairs.push(st);
    buildStair(st);
    const geo = stairGeometry(st.rise);
    setStatus(`Stairs placed — ${geo.steps} risers at ${geo.rise.toFixed(2)}", ${fmtLen(geo.run)} of run. ` +
      `Walk mode (V) climbs them. Cables route around them, not through.`);
    return;
  }

  if (mode === 'slab') {
    if (!hoverInfo) return;
    if (!slabStart) {
      slabStart = { x: hoverInfo.x, z: hoverInfo.z };
      setStatus('Corner set — click the opposite corner of the slab.');
    } else if (Math.abs(hoverInfo.x - slabStart.x) > 6 && Math.abs(hoverInfo.z - slabStart.z) > 6) {
      undoPush();
      const s = { id: uid(), x1: slabStart.x, z1: slabStart.z, x2: hoverInfo.x, z2: hoverInfo.z, y: hoverInfo.y };
      state.slabs.push(s);
      buildSlab(s);
      slabStart = null;
      setStatus('Floor slab placed — build on it exactly like the ground floor. In Walk mode press F to fly up to it.');
    }
    return;
  }

  if (mode === 'measure') {
    if (!hoverInfo || !hoverInfo.p) return;
    if (!measureStart) {
      measureStart = hoverInfo.p.clone();
      setStatus('First point set — click the second point.');
    } else {
      undoPush();
      const m = { id: uid(), ax: measureStart.x, ay: measureStart.y, az: measureStart.z, bx: hoverInfo.p.x, by: hoverInfo.p.y, bz: hoverInfo.p.z };
      state.measures.push(m);
      buildMeasure(m);
      setStatus(`Measured ${fmtLen(measureStart.distanceTo(hoverInfo.p))} — dimension pinned. Click to start another.`);
      measureStart = null;
      clearMeasurePreview();
    }
    return;
  }

  if (mode === 'cable') {
    const pObj = pickPort(lastPtr.x, lastPtr.y);
    if (pObj) {
      const { deviceId, port } = pObj.userData;
      const side = meshSide(pObj);                 // which face of the jack was clicked
      const faceOf = (d, p, s) => DEVICE_TYPES[d.type].passthrough ? ` ${s === REAR ? 'rear' : 'front'}` : '';
      if (!cableDraft) {
        if (portFull(deviceId, port, side)) { setStatus('That jack already has a cable in it. Pick a free port.'); return; }
        cableDraft = { a: { deviceId, port, side }, waypoints: [] };
        const dev = deviceById(deviceId);
        setStatus(`Cable from ${dev.name} port ${port}${faceOf(dev, port, side)} — click cable managers to route, then click the destination port. Esc cancels.`);
      } else {
        const a = cableDraft.a;
        if (deviceId === a.deviceId && port === a.port && side === epSide(a)) return;
        if (portFull(deviceId, port, side)) { setStatus('That jack already has a cable in it. Pick a free port.'); return; }
        undoPush();
        const cable = {
          id: uid(), a, b: { deviceId, port, side },
          waypoints: cableDraft.waypoints,
          raceways: cableDraft.raceways || [],
          color: document.getElementById('cable-color').value
        };
        state.cables.push(cable);
        for (const rid of cable.raceways) {
          const rw = state.raceways.find(r => r.id === rid);
          if (rw) { rw.cables = rw.cables || []; rw.cables.push(cable.id); rebuildRaceway(rw); }
        }
        buildCableMesh(cable);
        cableDraft = null;
        clearPreview();
        const da = deviceById(cable.a.deviceId), db = deviceById(cable.b.deviceId);
        setStatus(`Connected ${da.name}:${cable.a.port}${faceOf(da, cable.a.port, epSide(cable.a))} → ${db.name}:${cable.b.port}${faceOf(db, cable.b.port, epSide(cable.b))} (~${(cable.lengthIn / 12).toFixed(1)} ft). Click a port to start another cable.`);
      }
      return;
    }
    if (cableDraft) {
      // route through a drilled wall hole: adds entry + exit points
      const hh = firstHit(holeMeshes);
      if (hh) {
        const hole = state.holes.find(h => h.id === hh.object.userData.holeId);
        if (hole) {
          const n = new THREE.Vector3(hole.nx || 0, hole.ny || 0, hole.nz || 0).normalize();
          const ht = (hole.t || WALL_T) / 2 + 1;
          const hp = new THREE.Vector3(hole.x, hole.y, hole.z);
          const last = cableDraft.waypoints.length
            ? new THREE.Vector3().copy(cableDraft.waypoints[cableDraft.waypoints.length - 1])
            : getPortWorld(cableDraft.a.deviceId, cableDraft.a.port, epSide(cableDraft.a)).pos;
          const side = Math.sign(new THREE.Vector3().subVectors(last, hp).dot(n)) || 1;
          const near = hp.clone().addScaledVector(n, side * ht);
          const far = hp.clone().addScaledVector(n, -side * ht);
          cableDraft.waypoints.push({ x: near.x, y: near.y, z: near.z }, { x: far.x, y: far.y, z: far.z });
          setStatus('Cable routed through the wall hole. Click destination port to finish.');
          return;
        }
      }
      // pull the run into a raceway — it takes the next free slot in the pathway
      const rwh = firstHit(racewayMeshes);
      if (rwh) {
        const rw = state.raceways.find(r => r.id === rwh.object.userData.racewayId);
        if (rw) {
          cableDraft.raceways = cableDraft.raceways || [];
          if (!cableDraft.raceways.includes(rw.id)) cableDraft.raceways.push(rw.id);
          const would = racewayFill({ type: rw.type, cables: [...(rw.cables || []), 'draft'] });
          setStatus(would.over
            ? `⚠ ${would.label} would be ${would.pct.toFixed(0)}% full — over NEC limit. Upsize the raceway or split the run.`
            : `Pulled into ${would.label} — ${would.count} cables, ${would.pct.toFixed(0)}% fill, room for ${would.room} more. Click the destination port.`);
          return;
        }
      }
      const mh = firstHit(managerMeshes);
      if (mh) {
        const n = mh.face.normal.clone().transformDirection(mh.object.matrixWorld);
        const p = snapCable(mh.point.clone().addScaledVector(n, 0.6));
        cableDraft.waypoints.push({ x: p.x, y: p.y, z: p.z });
        setStatus(`Route point added (${cableDraft.waypoints.length}). Click the destination port, a manager, a wall, or the floor to keep routing.`);
        return;
      }
      // click any surface — floor, slab, wall, rack, gear — to drop a route
      // point there. This is what makes you feel like you're pulling the wire:
      // click the port, click where it should run, click the far port.
      const sh = firstHit([...groundTargets(), ...wallMeshes.values(), ...rackFrames, ...collectDeviceBodies()]);
      if (sh) {
        // lift off the surface by a jacket radius so the run rides on it, not in it
        const n = sh.face ? sh.face.normal.clone().transformDirection(sh.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
        const p = snapCable(sh.point.clone().addScaledVector(n, CABLE_R + 0.3));
        cableDraft.waypoints.push({ x: p.x, y: p.y, z: p.z });
        setStatus(`Route point added (${cableDraft.waypoints.length}). Keep clicking to route, or click the destination port to finish.`);
      }
    }
    return;
  }

  if (mode === 'tie') {
    const ch = firstHit([...cableMeshes.values()]);
    if (ch) {
      const snap = serialize();
      const tie = placeTie(ch.point);
      if (tie) {
        undoPush(snap);
        setStatus(tie.count > 1
          ? `Tie placed — ${tie.count} cables strapped into one bundle. ${physOn ? '' : 'Turn on Physics (0/P) to watch them cinch together.'}`
          : 'Tie placed on 1 cable — ties shine when they bundle several cables running together.');
      }
    }
    return;
  }

  if (mode === 'delete') {
    const mm = firstHit(measureHits);
    if (mm) { undoPush(); deleteMeasure(mm.object.userData.measureId); setStatus('Measurement removed.'); return; }
    const th = firstHit(tieMeshes);
    if (th) { undoPush(); deleteTie(th.object.userData.tieId); setStatus('Tie removed. (Ctrl+Z undoes)'); return; }
    const ch = firstHit([...cableMeshes.values()]);
    if (ch) { undoPush(); deleteCable(ch.object.userData.cableId); setStatus('Cable deleted. (Ctrl+Z undoes)'); return; }
    const dh = firstHit(collectDeviceBodies());
    if (dh) {
      undoPush();
      const dev = deviceById(dh.object.userData.deviceId);
      deleteDevice(dh.object.userData.deviceId);
      setStatus(`${dev ? dev.name : 'Device'} deleted (with its cables). (Ctrl+Z undoes)`);
      return;
    }
    const hh = firstHit(holeMeshes);
    if (hh) { undoPush(); deleteHole(hh.object.userData.holeId); setStatus('Hole removed. (Ctrl+Z undoes)'); return; }
    const sth = firstHit(stairMeshes);
    if (sth) { undoPush(); deleteStair(sth.object.userData.stairId); setStatus('Stairs removed. (Ctrl+Z undoes)'); return; }
    const rwd = firstHit(racewayMeshes);
    if (rwd) {
      undoPush();
      deleteRaceway(rwd.object.userData.racewayId);
      setStatus('Raceway removed — the cables in it fall back to their own routes. (Ctrl+Z undoes)');
      return;
    }
    const wh = firstHit([...wallMeshes.values()]);
    if (wh) {
      if (confirm('Delete this wall (and its drilled holes)?')) {
        undoPush();
        deleteWall(wh.object.userData.wallId);
        setStatus('Wall deleted. (Ctrl+Z undoes)');
      }
      return;
    }
    const rh = firstHit(rackFrames);
    if (rh) {
      if (confirm('Delete this rack and everything in it?')) {
        undoPush();
        deleteRack(rh.object.userData.rackId);
        setStatus('Rack deleted. (Ctrl+Z undoes)');
      }
      return;
    }
    const sh = firstHit([...slabMeshes.values()]);
    if (sh) {
      if (confirm('Delete this floor slab?')) {
        undoPush();
        deleteSlab(sh.object.userData.slabId);
        setStatus('Floor slab deleted. (Ctrl+Z undoes)');
      }
    }
    return;
  }

  // select mode
  const ph = firstHit(portMeshes);
  const ch = firstHit([...cableMeshes.values()]);
  const dh = firstHit(collectDeviceBodies());
  const rh = firstHit(rackFrames);
  if (ch && (!dh || ch.distance < dh.distance)) { showCableProps(ch.object.userData.cableId); return; }
  if (ph) { showPortProps(ph.object.userData.deviceId, ph.object.userData.port, meshSide(ph.object)); return; }
  if (dh) { showDeviceProps(dh.object.userData.deviceId); return; }
  if (rh) { showRackProps(rh.object.userData.rackId); return; }
  const wh = firstHit([...wallMeshes.values()]);
  if (wh) { showWallProps(wh.object.userData.wallId); return; }
  hideProps();
}

function collectDeviceBodies() {
  const arr = [];
  for (const g of deviceGroups.values()) {
    g.traverse(o => { if (o.userData && o.userData.isDeviceBody) arr.push(o); });
  }
  return arr;
}

//////////////////// Properties panel ////////////////////

const propsEl = document.getElementById('props');
const propsTitle = document.getElementById('props-title');
const propsBody = document.getElementById('props-body');
document.getElementById('props-close').onclick = hideProps;

function hideProps() { propsEl.classList.add('hidden'); selected = null; clearCableHandles(); }

function row(k, v) { return `<div class="row"><span class="k">${k}</span><span>${v}</span></div>`; }

// The ISP circuit terminating on this ONT / modem. Installed hardware with no
// provisioned service is a real and common state, so it's the default: you have
// to turn the circuit up, exactly like waiting on the carrier.
function circuitPropsHtml(dev) {
  if (!isCpeTerm(dev)) return '';
  const c = dev.circuit || {};
  const on = c.active !== false && !!dev.circuit;
  return `
    <div class="row" style="margin-top:10px"><span class="k">ISP circuit</span>
      <input type="checkbox" id="dev-circ-on" ${on ? 'checked' : ''}></div>
    <div id="dev-circ-cfg" style="${on ? '' : 'display:none'}">
      <div class="row"><span class="k">Provider</span>
        <input type="text" id="dev-circ-isp" style="width:118px" value="${c.provider || ''}" placeholder="Comcast"></div>
      <div class="row"><span class="k">WAN address</span>
        <input type="text" id="dev-circ-ip" style="width:118px" value="${c.wanIp || ''}" placeholder="203.0.113.10"></div>
    </div>
    ${on ? '' : '<p class="cbl-edit-hint">Hardware installed, service not turned up — the WAN port stays dark.</p>'}`;
}

function wireCircuitProps(dev) {
  const cb = document.getElementById('dev-circ-on');
  if (!cb) return;
  const cfg = document.getElementById('dev-circ-cfg');
  const isp = document.getElementById('dev-circ-isp');
  const ip = document.getElementById('dev-circ-ip');
  const save = () => {
    dev.circuit = cb.checked
      ? { active: true, provider: (isp.value || '').trim() || 'ISP', wanIp: (ip.value || '').trim() || null }
      : null;
    cfg.style.display = cb.checked ? '' : 'none';
  };
  cb.onchange = save; isp.onchange = save; ip.onchange = save;
}

// ACLs, written in the device's own syntax. Applying one to a port + direction
// mirrors "ip access-group <n> in|out" on a real interface.
function aclPropsHtml(dev) {
  if (netClass(dev) !== 'router') return '';
  const def = DEVICE_TYPES[dev.type];
  const applied = dev.aclApply || {};
  const rows = Object.entries(applied)
    .flatMap(([p, d]) => Object.entries(d).map(([dir, id]) => `<tr><td>Port ${p}</td><td>${dir}</td><td>${id}</td></tr>`)).join('');
  return `
    <div class="row" style="margin-top:10px"><span class="k">Access lists</span></div>
    <textarea id="dev-acl" rows="6" style="width:100%;font-size:11px"
      placeholder="access-list 110 deny tcp any host 10.0.10.5 eq www&#10;access-list 110 permit ip any any&#10;&#10;ip access-list extended BLOCK-CCTV&#10; 10 remark cameras must not reach servers&#10; 20 deny ip 10.0.30.0 0.0.0.255 10.0.10.0 0.0.0.255&#10; 30 permit ip any any">${esc(aclToText(dev.acls))}</textarea>
    <div id="dev-acl-err" class="ai-bad" style="font-size:11px"></div>
    <div class="row"><span class="k">Apply</span>
      <select id="dev-acl-port" style="width:74px">${[
        ...deviceInterfaces(dev).filter(i => i.kind === 'svi').map(i => `<option value="Vlan${i.vlan}">Vlan${i.vlan}</option>`),
        ...Array.from({ length: Math.min(def.ports || 0, 24) }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`)
      ].join('')}</select>
      <select id="dev-acl-dir" style="width:56px"><option value="in">in</option><option value="out">out</option></select>
      <select id="dev-acl-id" style="width:70px"><option value="">none</option>${(dev.acls || []).map(a =>
        `<option value="${a.id}">${a.id}</option>`).join('')}</select>
    </div>
    ${rows ? `<table class="sim-table"><tr><th>Interface</th><th>Dir</th><th>ACL</th></tr>${rows}</table>` : ''}`;
}

// Static routes + the resulting table. A routing table you cannot edit from the
// app is not a feature, so this is the `ip route` half of the mechanism.
function routePropsHtml(dev) {
  if (!deviceInterfaces(dev).length) return '';
  const rows = (dev.routes || []).map((r, i) =>
    `<div class="row" data-route="${i}">
       <input type="text" class="rt-prefix" style="width:104px" value="${esc(r.prefix || '')}" placeholder="0.0.0.0/0">
       <input type="text" class="rt-via" style="width:96px" value="${esc(r.via || '')}" placeholder="next hop">
       <input type="number" class="rt-ad" style="width:44px" value="${r.ad !== undefined ? r.ad : ''}" placeholder="AD">
       <button class="rt-del" title="Remove route">×</button></div>`).join('');
  return `
    <div class="row" style="margin-top:10px"><span class="k">ip route</span></div>${rows}
    <button id="rt-add" style="font-size:11px">+ static route</button>
    <div class="row" style="margin-top:8px"><span class="k">show ip route</span></div>
    <pre style="font-size:10.5px;white-space:pre-wrap;margin:2px 0">${esc(showIpRoute(dev))}</pre>`;
}
function wireRouteProps(dev) {
  const root = propsBody;
  const save = () => {
    dev.routes = [...root.querySelectorAll('[data-route]')].map(el => {
      const g = c => (el.querySelector('.' + c) || {}).value;
      const o = { prefix: (g('rt-prefix') || '').trim(), via: (g('rt-via') || '').trim() };
      const ad = g('rt-ad');
      if (ad !== '' && ad !== undefined) o.ad = +ad;
      return o;
    }).filter(r => r.prefix);
    flushL2Tables();
    showDeviceProps(dev.id);
  };
  for (const el of root.querySelectorAll('.rt-prefix,.rt-via,.rt-ad')) el.onchange = save;
  const add = document.getElementById('rt-add');
  if (add) add.onclick = () => { (dev.routes ||= []).push({ prefix: '', via: '' }); showDeviceProps(dev.id); };
  for (const b of root.querySelectorAll('.rt-del')) b.onclick = e => {
    const i = +e.target.closest('[data-route]').dataset.route;
    dev.routes.splice(i, 1); flushL2Tables(); showDeviceProps(dev.id);
  };
}

// NAT config. `ip nat inside source list <acl> interface <if> overload`, static
// one-to-one, and port forwarding — the three forms that cover real edge NAT.
function natPropsHtml(dev) {
  if (netClass(dev) !== 'router') return '';
  const n = dev.nat || {};
  const on = !!n.enabled;
  const st = (n.statics || []).map((s, i) =>
    `<div class="row" data-nat="${i}">
       <select class="nt-proto" style="width:56px">${['', 'tcp', 'udp'].map(p =>
         `<option value="${p}" ${s.proto === p ? 'selected' : ''}>${p || 'any'}</option>`).join('')}</select>
       <input type="text" class="nt-local" style="width:92px" value="${esc(s.local || '')}" placeholder="inside">
       <input type="number" class="nt-lport" style="width:52px" value="${s.localPort || ''}" placeholder="port">
       <input type="text" class="nt-global" style="width:92px" value="${esc(s.global || '')}" placeholder="outside">
       <input type="number" class="nt-gport" style="width:52px" value="${s.globalPort || ''}" placeholder="port">
       <button class="nt-del" title="Remove">\u00d7</button></div>`).join('');
  return `
    <div class="row" style="margin-top:10px"><span class="k">NAT</span>
      <input type="checkbox" id="dev-nat-on" ${on ? 'checked' : ''}></div>
    <div id="dev-nat-cfg" style="${on ? '' : 'display:none'}">
      <div class="row"><span class="k">inside global</span>
        <input type="text" id="nt-ig" style="width:118px" value="${esc(n.insideGlobal || '')}" placeholder="203.0.113.10"></div>
      <div class="row"><span class="k">overload (PAT)</span>
        <input type="checkbox" id="nt-ovl" ${n.overload ? 'checked' : ''}></div>
      <div class="row"><span class="k">source list</span>
        <select id="nt-acl" style="width:96px"><option value="">RFC 1918</option>${(dev.acls || []).map(a =>
          `<option value="${a.id}" ${String(n.aclId) === String(a.id) ? 'selected' : ''}>${a.id}</option>`).join('')}</select></div>
      <div class="row"><span class="k">static / forward</span></div>${st}
      <button id="nt-add" style="font-size:11px">+ mapping</button>
      <div class="row" style="margin-top:8px"><span class="k">show ip nat translations</span></div>
      <pre style="font-size:10px;white-space:pre-wrap;margin:2px 0">${esc(showIpNat(dev))}</pre>
      <button id="nt-clear" style="font-size:11px">clear ip nat translation *</button>
    </div>`;
}
function wireNatProps(dev) {
  const cb = document.getElementById('dev-nat-on');
  if (!cb) return;
  const root = propsBody;
  const save = () => {
    const g = id => (document.getElementById(id) || {}).value;
    dev.nat = {
      enabled: cb.checked,
      insideGlobal: (g('nt-ig') || '').trim(),
      overload: !!(document.getElementById('nt-ovl') || {}).checked,
      aclId: (g('nt-acl') || '') || undefined,
      statics: [...root.querySelectorAll('[data-nat]')].map(el => {
        const v = c => (el.querySelector('.' + c) || {}).value;
        const o = { local: (v('nt-local') || '').trim(), global: (v('nt-global') || '').trim() };
        if (v('nt-proto')) o.proto = v('nt-proto');
        if (v('nt-lport')) o.localPort = +v('nt-lport');
        if (v('nt-gport')) o.globalPort = +v('nt-gport');
        return o;
      }).filter(x => x.local && x.global)
    };
    natClear(dev.id);
    showDeviceProps(dev.id);
  };
  cb.onchange = save;
  for (const el of root.querySelectorAll('#dev-nat-cfg input, #dev-nat-cfg select')) el.onchange = save;
  const add = document.getElementById('nt-add');
  if (add) add.onclick = () => { dev.nat = dev.nat || { enabled: true }; (dev.nat.statics ||= []).push({ local: '', global: '' }); showDeviceProps(dev.id); };
  const clr = document.getElementById('nt-clear');
  if (clr) clr.onclick = () => { natClear(dev.id); showDeviceProps(dev.id); };
  for (const b of root.querySelectorAll('.nt-del')) b.onclick = e => {
    const i = +e.target.closest('[data-nat]').dataset.nat;
    dev.nat.statics.splice(i, 1); natClear(dev.id); showDeviceProps(dev.id);
  };
}

// Multi-NIC editor. A single-homed device shows the plain IP field it always
// had; adding a NIC switches to the per-port list, because that is the moment
// "the device's address" stops being a meaningful idea.
function nicPropsHtml(dev) {
  if (netClass(dev) !== 'host') return '';
  const def = DEVICE_TYPES[dev.type] || {};
  const dataPorts = [];
  for (let p = 1; p <= (def.ports || 1); p++) if (portRole(def, p) !== 'PWR') dataPorts.push(p);
  if (dataPorts.length < 2) return '';
  const nics = hostNics(dev);
  const rows = nics.map(n =>
    `<div class="row" data-nic="${n.port}">
       <input type="text" class="nc-label" style="width:64px" value="${esc(n.label || '')}" placeholder="label">
       <select class="nc-port" style="width:52px">${dataPorts.map(p =>
         `<option value="${p}" ${p === n.port ? 'selected' : ''}>p${p}</option>`).join('')}</select>
       <input type="text" class="nc-ip" style="width:104px" value="${esc(n.ip || '')}" placeholder="ip or dhcp">
       <input type="text" class="nc-gw" style="width:96px" value="${esc(n.gateway || '')}" placeholder="gateway">
       <button class="nc-del" title="Remove NIC">\u00d7</button></div>
     <p class="cbl-edit-hint" style="margin:0 0 4px">${esc(nicAddr(dev, n.port))} \u00b7 VLAN ${hostVlan(dev, n.port)} \u00b7 ${nicMac(dev, n.port)}</p>`).join('');
  return `
    <div class="row" style="margin-top:10px"><span class="k">NICs</span></div>${rows}
    <button id="nc-add" style="font-size:11px">+ NIC</button>`;
}
function wireNicProps(dev) {
  const root = propsBody;
  const save = () => {
    const nics = {};
    for (const el of root.querySelectorAll('[data-nic]')) {
      const v = c => (el.querySelector('.' + c) || {}).value;
      const port = +v('nc-port');
      if (!port) continue;
      nics[port] = { ip: (v('nc-ip') || '').trim(), gateway: (v('nc-gw') || '').trim(), label: (v('nc-label') || '').trim() };
    }
    dev.nics = nics;
    // dev.ip stays the primary NIC's address so saves and single-homed code paths
    // keep working unchanged.
    const primary = nics[hostPort(dev)];
    if (primary) { dev.ip = primary.ip; dev.gateway = primary.gateway; }
    flushL2Tables(); dhcpClearBindings(); resolveDhcp();
    showDeviceProps(dev.id);
  };
  for (const el of root.querySelectorAll('.nc-ip,.nc-gw,.nc-label,.nc-port')) el.onchange = save;
  const add = document.getElementById('nc-add');
  if (add) add.onclick = () => {
    const def = DEVICE_TYPES[dev.type] || {};
    const used = new Set(hostNics(dev).map(n => n.port));
    let free = null;
    for (let p = 1; p <= (def.ports || 1); p++) {
      if (portRole(def, p) !== 'PWR' && !used.has(p)) { free = p; break; }
    }
    if (free === null) return;
    const cur = {};
    for (const n of hostNics(dev)) cur[n.port] = { ip: n.ip, gateway: n.gateway, label: n.label };
    cur[free] = { ip: '', gateway: '', label: `NIC${Object.keys(cur).length + 1}` };
    dev.nics = cur;
    showDeviceProps(dev.id);
  };
  for (const b of root.querySelectorAll('.nc-del')) b.onclick = e => {
    const port = +e.target.closest('[data-nic]').dataset.nic;
    const cur = {};
    for (const n of hostNics(dev)) if (n.port !== port) cur[n.port] = { ip: n.ip, gateway: n.gateway, label: n.label };
    dev.nics = cur;
    dhcpRelease(dev.id, port);
    flushL2Tables(); resolveDhcp();
    showDeviceProps(dev.id);
  };
}

function wireAclProps(dev) {
  const ta = document.getElementById('dev-acl');
  if (!ta) return;
  const err = document.getElementById('dev-acl-err');
  ta.onchange = () => {
    const { acls, errors } = parseAclText(ta.value);
    err.textContent = errors.length ? errors.map(e => `line ${e.line}: ${e.msg}`).join(' · ') : '';
    dev.acls = acls;
    flushL2Tables();
    showDeviceProps(dev.id);
  };
  const port = document.getElementById('dev-acl-port');
  const dir = document.getElementById('dev-acl-dir');
  const id = document.getElementById('dev-acl-id');
  id.onchange = () => {
    dev.aclApply = dev.aclApply || {};
    dev.aclApply[port.value] = dev.aclApply[port.value] || {};
    if (id.value) dev.aclApply[port.value][dir.value] = id.value;
    else delete dev.aclApply[port.value][dir.value];
    flushL2Tables();
    showDeviceProps(dev.id);
  };
}

// A switch's MAC address table and a host's ARP cache, as learned by actual
// traffic. Empty until something pings — same as a freshly booted device.
function l2TablesHtml(dev) {
  const cls = netClass(dev);
  if (cls === 'switch') {
    const t = macEntries(dev.id);
    if (!t.length) return `<p class="cbl-edit-hint">MAC address table empty — run a ping to populate it. Entries age out after ${MAC_AGE_MS / 1000}s.</p>`;
    const rows = t.sort((a, b) => a[1].port - b[1].port)
      .map(([mac, e]) => `<tr><td>${e.vlan}</td><td>${mac}</td><td>Port ${e.port}</td></tr>`).join('');
    return `<div class="row" style="margin-top:10px"><span class="k">MAC address table</span></div>
      <table class="sim-table"><tr><th>VLAN</th><th>MAC</th><th>Port</th></tr>${rows}</table>`;
  }
  if (cls === 'host') {
    const c = arpCaches.get(dev.id);
    let html = `<div class="row" style="margin-top:10px"><span class="k">MAC</span><span>${deviceMac(dev)}</span></div>`;
    if (c && c.size) {
      html += `<div class="row"><span class="k">ARP cache</span></div><table class="sim-table">` +
        `<tr><th>Address</th><th>MAC</th></tr>` +
        [...c].map(([ip, mac]) => `<tr><td>${ip}</td><td>${mac}</td></tr>`).join('') + `</table>`;
    } else {
      html += `<p class="cbl-edit-hint">ARP cache empty — run a ping to populate it.</p>`;
    }
    return html;
  }
  return '';
}

// DHCP server config. A real server holds a scope per subnet with its own
// range, lease and options, plus device-wide excluded ranges (excluded-address
// is global on IOS, not a pool subcommand). Relay helpers are separate and
// belong to any L3 device, server or not.
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function scopeHtml(p, i) {
  const l = p.lease === 'infinite' ? {} : (p.lease || {});
  const inf = p.lease === 'infinite';
  const res = (p.reservations || []).map((r, j) =>
    `<div class="row" data-res="${i}:${j}">
       <input type="text" class="dh-res-mac" style="width:118px" value="${esc(r.mac || '')}" placeholder="MAC">
       <input type="text" class="dh-res-ip" style="width:96px" value="${esc(r.ip || '')}" placeholder="10.0.10.50">
       <button class="dh-res-del" title="Remove reservation">×</button></div>`).join('');
  return `
  <div class="dh-scope" data-scope="${i}" style="border:1px solid var(--line);border-radius:6px;padding:8px;margin:8px 0">
    <div class="row"><input type="text" class="dh-name" style="width:110px" value="${esc(p.name || '')}" placeholder="VLAN10">
      <button class="dh-del" title="Delete scope">×</button></div>
    <div class="row"><span class="k">network</span>
      <input type="text" class="dh-net" style="width:132px" value="${esc(p.network || '')}" placeholder="10.0.10.0/24"></div>
    <div class="row"><span class="k">range</span>
      <input type="text" class="dh-start" style="width:104px" value="${esc(p.poolStart || '')}" placeholder="auto">
      <input type="text" class="dh-end" style="width:104px" value="${esc(p.poolEnd || '')}" placeholder="auto"></div>
    <div class="row"><span class="k">lease</span>
      <input type="number" class="dh-ld" style="width:44px" min="0" value="${inf ? '' : (l.days ?? 1)}" title="days">d
      <input type="number" class="dh-lh" style="width:44px" min="0" max="23" value="${inf ? '' : (l.hours ?? 0)}" title="hours">h
      <input type="number" class="dh-lm" style="width:44px" min="0" max="59" value="${inf ? '' : (l.minutes ?? 0)}" title="minutes">m
      <label style="font-size:11px"><input type="checkbox" class="dh-inf" ${inf ? 'checked' : ''}> infinite</label></div>
    <div class="row"><span class="k">default-router</span>
      <input type="text" class="dh-gw" style="width:118px" value="${esc(p.defaultRouter || '')}" placeholder="10.0.10.1"></div>
    <div class="row"><span class="k">dns-server</span>
      <input type="text" class="dh-dns" style="width:132px" value="${esc([].concat(p.dns || []).join(', '))}" placeholder="10.0.10.5, 1.1.1.1"></div>
    <div class="row"><span class="k">domain-name</span>
      <input type="text" class="dh-dom" style="width:132px" value="${esc(p.domain || '')}" placeholder="corp.local"></div>
    <div class="row"><span class="k">option 150</span>
      <input type="text" class="dh-tftp" style="width:118px" value="${esc(p.tftp || '')}" placeholder="TFTP server"></div>
    <div class="row"><span class="k">reservations</span></div>${res}
    <button class="dh-res-add" style="font-size:11px">+ reservation</button>
  </div>`;
}

function dhcpPropsHtml(dev) {
  const cls = netClass(dev);
  if (cls !== 'router' && cls !== 'switch' && cls !== 'host') return '';
  const d = dev.dhcp || {};
  const on = !!d.enabled;
  const pools = d.pools || [];
  const exc = (d.excluded || []).map((r, i) =>
    `<div class="row" data-exc="${i}">
       <input type="text" class="dh-exc-a" style="width:104px" value="${esc(r.from || '')}" placeholder="10.0.10.1">
       <input type="text" class="dh-exc-b" style="width:104px" value="${esc(r.to || '')}" placeholder="10.0.10.99">
       <button class="dh-exc-del" title="Remove">×</button></div>`).join('');
  // ip helper-address, per interface — offered on anything with an L3 interface
  const ifaces = deviceInterfaces(dev);
  const helpers = ifaces.length ? `
    <div class="row" style="margin-top:10px"><span class="k">ip helper-address</span></div>
    ${ifaces.map(i => {
      const key = i.kind === 'svi' ? `Vlan${i.vlan}` : `Port ${i.port}`;
      const v = [].concat((dev.helpers || {})[key] || []).join(', ');
      return `<div class="row"><span class="k" style="font-size:11px">${key}</span>
        <input type="text" class="dh-helper" data-if="${esc(key)}" style="width:132px" value="${esc(v)}" placeholder="none"></div>`;
    }).join('')}
    <p class="cbl-edit-hint">A helper relays DHCP off-subnet: the relay stamps giaddr with this interface's address and the server picks the scope matching it.</p>` : '';
  return `
    <div class="row" style="margin-top:10px"><span class="k">DHCP server</span>
      <input type="checkbox" id="dev-dhcp-on" ${on ? 'checked' : ''}></div>
    <div id="dev-dhcp-cfg" style="${on ? '' : 'display:none'}">
      <div id="dh-scopes">${pools.map(scopeHtml).join('')}</div>
      <button id="dh-add" style="font-size:11px">+ scope</button>
      <div class="row" style="margin-top:8px"><span class="k">excluded-address</span></div>${exc}
      <button id="dh-exc-add" style="font-size:11px">+ exclusion</button>
      <p class="cbl-edit-hint">Excluded ranges are device-wide, as on IOS. Hosts with IP set to <b>dhcp</b> lease from the scope matching their subnet.</p>
    </div>
    ${helpers}`;
}

function wireDhcpProps(dev) {
  const cb = document.getElementById('dev-dhcp-on');
  const root = propsBody;
  const redraw = () => { showDeviceProps(dev.id); };
  // Read the whole editor back into the model — one direction, no partial state.
  const save = () => {
    if (!cb) return;
    const pools = [...root.querySelectorAll('.dh-scope')].map(el => {
      const g = c => (el.querySelector('.' + c) || {}).value;
      const inf = (el.querySelector('.dh-inf') || {}).checked;
      const dns = (g('dh-dns') || '').split(',').map(s => s.trim()).filter(Boolean);
      const reservations = [...el.querySelectorAll('[data-res]')].map(r => ({
        mac: (r.querySelector('.dh-res-mac').value || '').trim(),
        ip: (r.querySelector('.dh-res-ip').value || '').trim()
      })).filter(r => r.mac && r.ip);
      return {
        name: (g('dh-name') || '').trim(),
        network: (g('dh-net') || '').trim(),
        poolStart: (g('dh-start') || '').trim(),
        poolEnd: (g('dh-end') || '').trim(),
        lease: inf ? 'infinite' : { days: +g('dh-ld') || 0, hours: +g('dh-lh') || 0, minutes: +g('dh-lm') || 0 },
        defaultRouter: (g('dh-gw') || '').trim(),
        dns, domain: (g('dh-dom') || '').trim(), tftp: (g('dh-tftp') || '').trim(),
        reservations
      };
    });
    const excluded = [...root.querySelectorAll('[data-exc]')].map(r => ({
      from: (r.querySelector('.dh-exc-a').value || '').trim(),
      to: (r.querySelector('.dh-exc-b').value || '').trim()
    })).filter(r => r.from);
    dev.dhcp = { enabled: cb.checked, pools, excluded };
    const helpers = {};
    for (const h of root.querySelectorAll('.dh-helper')) {
      const list = (h.value || '').split(',').map(s => s.trim()).filter(Boolean);
      if (list.length) helpers[h.dataset.if] = list;
    }
    dev.helpers = helpers;
    resolveDhcp();
    refreshSimPickers();
  };
  for (const el of root.querySelectorAll('.dh-helper')) el.onchange = save;
  if (!cb) return;
  const cfg = document.getElementById('dev-dhcp-cfg');
  cb.onchange = () => {
    cfg.style.display = cb.checked ? '' : 'none';
    // Enabling with no scopes seeds one from an interface this device actually
    // holds, so the first scope is real rather than a placeholder.
    if (cb.checked && !(dev.dhcp && dev.dhcp.pools || []).length) {
      const i = deviceInterfaces(dev)[0];
      dev.dhcp = { enabled: true, excluded: [], pools: [i ? {
        name: i.kind === 'svi' ? `VLAN${i.vlan}` : `PORT${i.port}`,
        network: subnetLabel(i.ip), poolStart: '', poolEnd: '',
        lease: { days: 1, hours: 0, minutes: 0 },
        defaultRouter: ipStr(i.ip.int), dns: [], domain: '', tftp: '', reservations: []
      } : { name: 'POOL1', network: '', lease: { days: 1, hours: 0, minutes: 0 }, reservations: [] }] };
      if (i) dev.dhcp.excluded = [{ from: ipStr(i.ip.network + 1), to: ipStr(i.ip.int) }];
      redraw(); return;
    }
    save();
  };
  for (const el of root.querySelectorAll('#dev-dhcp-cfg input')) {
    if (el.id !== 'dev-dhcp-on') el.onchange = save;
  }
  const add = document.getElementById('dh-add');
  if (add) add.onclick = () => {
    save();
    dev.dhcp.pools.push({ name: `POOL${dev.dhcp.pools.length + 1}`, network: '', poolStart: '', poolEnd: '',
      lease: { days: 1, hours: 0, minutes: 0 }, defaultRouter: '', dns: [], domain: '', tftp: '', reservations: [] });
    redraw();
  };
  const excAdd = document.getElementById('dh-exc-add');
  if (excAdd) excAdd.onclick = () => { save(); dev.dhcp.excluded.push({ from: '', to: '' }); redraw(); };
  for (const b of root.querySelectorAll('.dh-del')) b.onclick = e => {
    const i = +e.target.closest('.dh-scope').dataset.scope;
    save(); dev.dhcp.pools.splice(i, 1); redraw();
  };
  for (const b of root.querySelectorAll('.dh-exc-del')) b.onclick = e => {
    const i = +e.target.closest('[data-exc]').dataset.exc;
    save(); dev.dhcp.excluded.splice(i, 1); redraw();
  };
  for (const b of root.querySelectorAll('.dh-res-add')) b.onclick = e => {
    const i = +e.target.closest('.dh-scope').dataset.scope;
    save(); (dev.dhcp.pools[i].reservations ||= []).push({ mac: '', ip: '' }); redraw();
  };
  for (const b of root.querySelectorAll('.dh-res-del')) b.onclick = e => {
    const [i, j] = e.target.closest('[data-res]').dataset.res.split(':').map(Number);
    save(); dev.dhcp.pools[i].reservations.splice(j, 1); redraw();
  };
}

function showDeviceProps(id) {
  clearCableHandles();
  const dev = deviceById(id);
  if (!dev) return;
  const def = DEVICE_TYPES[dev.type];
  const rack = rackById(dev.rackId);
  const used = state.cables.filter(c => c.a.deviceId === id || c.b.deviceId === id).length;
  propsTitle.textContent = 'Device';
  let place;
  if (!isPlaced(dev)) place = row('Position', 'Unplaced (logical)');
  else if (def.field) place = dev.mount === 'wall'
    ? row('Mount', `Wall @ ${(dev.y / 12).toFixed(1)} ft`)
    : row('Position', `${dev.x}", ${dev.z}"`);
  else place = row('Rack', rack ? rack.name : '?') + (def.vertical
        ? row('Side', dev.side === 'L' ? 'Left' : 'Right')
        : row('Position', 'U' + dev.u + (def.uh > 1 ? '–U' + (dev.u + def.uh - 1) : '')));
  propsBody.innerHTML = `
    <input type="text" id="dev-name" value="${dev.name}">
    ${row('Type', def.label)}
    ${place}
    ${def.ports ? row('Ports used', `${used} / ${def.ports}`) : ''}
    <div class="row"><span class="k">IP</span></div>
    <input type="text" id="dev-ip" placeholder="e.g. 10.0.20.4" value="${dev.ip || ''}">
    <div class="row" style="margin-top:6px"><span class="k">Notes</span></div>
    <input type="text" id="dev-notes" placeholder="VLAN, location, model…" value="${dev.notes || ''}">
    ${dhcpPropsHtml(dev)}
    ${circuitPropsHtml(dev)}
    ${nicPropsHtml(dev)}
    ${routePropsHtml(dev)}
    ${natPropsHtml(dev)}
    ${aclPropsHtml(dev)}
    ${l2TablesHtml(dev)}
    ${!isPlaced(dev) ? '<button id="dev-place">Place in 3D map</button>' : ''}
    <button id="dev-del" class="danger">Delete device</button>`;
  propsEl.classList.remove('hidden');
  selected = { kind: 'device', id };
  document.getElementById('dev-name').onchange = e => {
    dev.name = e.target.value.trim() || dev.name;
    updateDeviceFaceplate(id);
  };
  document.getElementById('dev-ip').onchange = e => { dev.ip = e.target.value.trim(); };
  document.getElementById('dev-notes').onchange = e => { dev.notes = e.target.value.trim(); };
  wireDhcpProps(dev);
  wireCircuitProps(dev);
  wireNicProps(dev);
  wireRouteProps(dev);
  wireNatProps(dev);
  wireAclProps(dev);
  const placeBtn = document.getElementById('dev-place');
  if (placeBtn) placeBtn.onclick = () => {
    hideProps();
    openPlan(false);
    setMode('place', dev.type);
    placeExistingId = id;
    setStatus(`Placing ${dev.name} — click a ${DEVICE_TYPES[dev.type].field ? 'floor or wall spot' : 'rack slot'}.`);
  };
  document.getElementById('dev-del').onclick = () => { undoPush(); deleteDevice(id); hideProps(); };
}

function showPortProps(deviceId, port, side) {
  clearCableHandles();
  const dev = deviceById(deviceId);
  if (!dev) return;
  const def = DEVICE_TYPES[dev.type];
  side = side === REAR ? REAR : FRONT;
  dev.portCfg = dev.portCfg || {};
  const cfg = dev.portCfg[port] = dev.portCfg[port] || {};
  const describe = (ep) => {
    const od = deviceById(ep.deviceId);
    const oFace = od && DEVICE_TYPES[od.type].passthrough ? ` (${epSide(ep)})` : '';
    return `${od ? od.name : '?'} : ${ep.port}${oFace}`;
  };
  const conn = portConnection(deviceId, port, side);
  let connTxt = 'unconnected';
  if (conn) {
    const isA = conn.a.deviceId === deviceId && conn.a.port === port && epSide(conn.a) === side;
    connTxt = describe(isA ? conn.b : conn.a);
  }
  // A patch port is one circuit with two faces — show the far side too, so the
  // panel reads the way a real one does: front patched here, permanent run there.
  if (def.passthrough) {
    const otherSide = side === REAR ? FRONT : REAR;
    const mate = portConnection(deviceId, port, otherSide);
    const mateFar = mate && (
      (mate.a.deviceId === deviceId && mate.a.port === port && epSide(mate.a) === otherSide)
        ? mate.b : mate.a);
    connTxt += ` · ${otherSide}: ${mateFar ? describe(mateFar) : 'open'}`;
  }
  const isPwr = portRole(def, port) === 'PWR';
  propsTitle.textContent = isPwr ? 'Power' : 'Port';
  if (isPwr) {
    propsBody.innerHTML = `
      ${row('Device', dev.name)}
      ${row('Connector', portLabel(dev, port))}
      ${row('Connected to', connTxt)}
      <button id="port-dev">Open device settings</button>`;
    propsEl.classList.remove('hidden');
    selected = { kind: 'port', id: deviceId, port };
    document.getElementById('port-dev').onclick = () => showDeviceProps(deviceId);
    return;
  }
  propsBody.innerHTML = `
    ${row('Device', dev.name)}
    ${row('Port', `${port} · ${portRole(def, port)}`)}
    ${row('Connected to', connTxt)}
    <div class="row"><span class="k">Untagged VLAN</span></div>
    <input type="text" id="port-vlan" placeholder="access VLAN, default 1" value="${cfg.vlan || ''}">
    <div class="row" style="margin-top:6px"><span class="k">Tagged VLANs</span></div>
    <input type="text" id="port-tagged" placeholder="trunk: e.g. 10,20,30" value="${cfg.tagged || ''}">
    <div class="row" style="margin-top:6px"><span class="k">Label</span></div>
    <input type="text" id="port-label" placeholder="e.g. Uplink to IDF" value="${cfg.label || ''}">
    <button id="port-trace">Simulate this VLAN</button>
    <button id="port-dev">Open device settings</button>`;
  propsEl.classList.remove('hidden');
  selected = { kind: 'port', id: deviceId, port };
  document.getElementById('port-vlan').onchange = e => { cfg.vlan = e.target.value.trim(); };
  document.getElementById('port-tagged').onchange = e => { cfg.tagged = e.target.value.trim(); };
  document.getElementById('port-label').onchange = e => { cfg.label = e.target.value.trim(); };
  document.getElementById('port-trace').onclick = () => {
    const v = parseInt(cfg.vlan, 10) || 1;
    if (!simOn) setSim(true);
    const f = traceVlan(deviceId, port, v, side);
    setVlanFocus(f);
    setStatus(`VLAN ${v} domain: ${f.devices.size} devices reachable over ${f.cables.size} cables. Blocked links glow red. Esc clears.`);
  };
  document.getElementById('port-dev').onclick = () => showDeviceProps(deviceId);
}

function showCableProps(id) {
  const c = state.cables.find(c => c.id === id);
  if (!c) return;
  const da = deviceById(c.a.deviceId), db = deviceById(c.b.deviceId);
  const opts = Object.entries(CABLE_COLOR_NAMES)
    .map(([hex, name]) => `<option value="${hex}" ${hex === c.color ? 'selected' : ''}>${name}</option>`).join('');
  propsTitle.textContent = 'Cable';
  propsBody.innerHTML = `
    ${row('From', `${da ? da.name : '?'} : ${c.a.port}`)}
    ${row('To', `${db ? db.name : '?'} : ${c.b.port}`)}
    ${row('Route points', c.waypoints.length)}
    ${row('Est. length', (c.lengthIn / 12).toFixed(1) + ' ft')}
    <div class="row"><span class="k">Color</span><select id="cbl-color">${opts}</select></div>
    <div class="row"><span class="k">Bend radius</span><input type="number" id="cbl-bend"
      min="${CABLE_BEND_MIN}" max="${CABLE_BEND_MAX}" step="0.2" style="width:64px"
      value="${cableBendRadius(c)}"><span class="unit">in</span></div>
    <p class="cbl-edit-hint">Drag a <b>yellow</b> handle to move a bend · drag a <b>blue</b>
      handle to add one · Shift-drag raises/lowers · right-click a yellow handle to remove it.</p>
    <button id="cbl-clear">Clear route points</button>
    <button id="cbl-del" class="danger">Delete cable</button>`;
  propsEl.classList.remove('hidden');
  selected = { kind: 'cable', id };
  showCableHandles(c);
  document.getElementById('cbl-color').onchange = e => {
    c.color = e.target.value;
    rebuildCable(c);
    refreshPortTints();
  };
  document.getElementById('cbl-bend').onchange = e => {
    c.bendR = Math.max(CABLE_BEND_MIN, Math.min(CABLE_BEND_MAX, parseFloat(e.target.value) || CABLE_BEND_R));
    e.target.value = c.bendR;
    rebuildCable(c); showCableHandles(c);
  };
  document.getElementById('cbl-clear').onclick = () => {
    undoPush(); c.waypoints = []; rebuildCable(c); showCableProps(id);
  };
  document.getElementById('cbl-del').onclick = () => { undoPush(); deleteCable(id); hideProps(); };
}

function showWallProps(id) {
  clearCableHandles();
  const w = state.walls.find(w => w.id === id);
  if (!w) return;
  const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
  const holes = state.holes.filter(h => h.wallId === id).length;
  propsTitle.textContent = 'Wall';
  propsBody.innerHTML = `
    ${row('Length', (len / 12).toFixed(1) + ' ft')}
    ${row('Height', ((w.h || WALL_H) / 12).toFixed(1) + ' ft')}
    ${row('Drilled holes', holes)}
    <button id="wall-del" class="danger">Delete wall</button>`;
  propsEl.classList.remove('hidden');
  selected = { kind: 'wall', id };
  document.getElementById('wall-del').onclick = () => {
    if (confirm('Delete this wall (and its holes)?')) { undoPush(); deleteWall(id); hideProps(); }
  };
}

function showRackProps(id) {
  clearCableHandles();
  const r = rackById(id);
  if (!r) return;
  const devs = state.devices.filter(d => d.rackId === id).length;
  propsTitle.textContent = 'Rack';
  propsBody.innerHTML = `
    <input type="text" id="rack-name" value="${r.name || 'Rack'}">
    ${row('Size', RACK_UNITS + 'U')}
    ${row('Devices', devs)}
    <button id="rack-rot">Rotate 90°</button>
    <button id="rack-del" class="danger">Delete rack</button>`;
  propsEl.classList.remove('hidden');
  selected = { kind: 'rack', id };
  document.getElementById('rack-name').onchange = e => { r.name = e.target.value.trim() || r.name; };
  document.getElementById('rack-rot').onclick = () => {
    r.rotY = ((r.rotY || 0) + Math.PI / 2) % (Math.PI * 2);
    rackGroups.get(id).rotation.y = r.rotY;
    for (const c of state.cables) {
      const ta = deviceById(c.a.deviceId), tb = deviceById(c.b.deviceId);
      if ((ta && ta.rackId === id) || (tb && tb.rackId === id)) rebuildCable(c);
    }
  };
  document.getElementById('rack-del').onclick = () => {
    if (confirm('Delete this rack and everything in it?')) { undoPush(); deleteRack(id); hideProps(); }
  };
}

//////////////////// Modes & toolbar ////////////////////

const toolButtons = {
  select: document.getElementById('tool-select'),
  cable: document.getElementById('tool-cable'),
  delete: document.getElementById('tool-delete'),
  rack: document.getElementById('tool-rack'),
  wall: document.getElementById('tool-wall'),
  drill: document.getElementById('tool-drill'),
  tie: document.getElementById('tool-tie'),
  measure: document.getElementById('tool-measure'),
  slab: document.getElementById('tool-slab'),
  room: document.getElementById('tool-room'),
  stairs: document.getElementById('tool-stairs'),
  raceway: document.getElementById('tool-raceway')
};
let wallStart = null;
let racewayStart = null;

// Option bar: show only the controls that belong to the active tool. Anything
// marked `.always` (level selector, all-levels) is global context and stays put.
const OPT_TITLES = {
  select: 'Select', cable: 'Cable', tie: 'Tie', delete: 'Delete', rack: 'Rack',
  wall: 'Wall', room: 'Room', slab: 'Floor', stairs: 'Stairs', drill: 'Drill',
  raceway: 'Raceway', measure: 'Measure', place: 'Place'
};
const OPT_HINTS = {
  select: 'Click anything to inspect it. Double-click a device for a close-up.',
  cable: 'Click a port, then cable managers / raceways to route, then the destination port.',
  tie: 'Click a cable — everything running near it gets strapped into the bundle.',
  delete: 'Click a cable, device, rack, wall, hole, stair or raceway to remove it.',
  rack: 'Click the floor to drop a 42U rack. Q rotates.',
  wall: 'Click for the start, click again for the end. Keeps chaining; Esc finishes.',
  room: 'Click two corners — builds four walls and a ceiling at the active level.',
  slab: 'Click two corners to pour a floor slab on the active level.',
  stairs: 'Click to place a flight up to the deck above. Q rotates.',
  drill: 'Click a wall to bore a pass-through at the selected size.',
  raceway: 'Click the start and end of the run. Pull cables in from Cable mode.',
  measure: 'Click two points for a real ft/in dimension.',
  place: 'Click where it mounts — rack slot, wall, ceiling or floor.'
};

function updateOptionBar() {
  const t = document.getElementById('opt-title');
  if (t) t.textContent = OPT_TITLES[mode] || mode;
  const h = document.getElementById('opt-hint');
  if (h) h.textContent = OPT_HINTS[mode] || '';
  for (const el of document.querySelectorAll('#optbar .opt[data-for]')) {
    const want = el.dataset.for === mode;
    // the custom-bit field has its own visibility rule on top of the tool match
    if (el.id === 'opt-bit-custom') {
      const sel = document.getElementById('hole-size');
      el.style.display = (want && sel && sel.value === 'custom') ? '' : 'none';
      continue;
    }
    el.style.display = want ? '' : 'none';
  }
}

(function initMoreMenu() {
  const btn = document.getElementById('btn-more');
  const menu = document.getElementById('more-menu');
  if (!btn || !menu) return;
  btn.onclick = e => { e.stopPropagation(); menu.classList.toggle('hidden'); };
  // any command inside closes it, and so does clicking anywhere else
  menu.addEventListener('click', () => menu.classList.add('hidden'));
  document.addEventListener('click', e => {
    if (!menu.contains(e.target) && e.target !== btn) menu.classList.add('hidden');
  });
})();

// Free-entry drill size: the presets cover the common bits, but core drills and
// custom bores are real, so "Custom…" opens a numeric field.
(function initCustomBit() {
  const sel = document.getElementById('hole-size');
  const wrap = document.getElementById('opt-bit-custom');
  if (!sel || !wrap) return;
  sel.addEventListener('change', () => {
    wrap.style.display = sel.value === 'custom' ? '' : 'none';
  });
})();

// Diameter the Drill tool should use, honouring the custom field.
function currentBitDiameter() {
  const sel = document.getElementById('hole-size');
  if (sel && sel.value === 'custom') {
    const v = parseFloat(document.getElementById('hole-size-custom').value);
    return Math.max(0.125, Math.min(12, isFinite(v) ? v : 1));
  }
  return parseFloat(sel ? sel.value : 1) || 1;
}

(function initRacewayUI() {
  const sel = document.getElementById('raceway-type');
  if (!sel) return;
  for (const [k, t] of Object.entries(RACEWAY_TYPES)) {
    const o = document.createElement('option');
    o.value = k;
    // show what it actually holds — sizing a pathway is a capacity decision
    const fits = racewayFill({ type: k, cables: [] }).room;
    o.textContent = `${t.label} · fits ${fits}`;
    sel.appendChild(o);
  }
  sel.value = 'emt100';
})();

// Level selector: populated from LEVELS so adding a storey is a data edit.
// Listed top-down the way a building section is drawn, so Attic is at the top of
// the list and Basement at the bottom — reading it should feel like the building.
(function initLevelUI() {
  const sel = document.getElementById('level-sel');
  if (!sel) return;
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    const L = LEVELS[i];
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `${L.name}${L.route ? ' · route' : ''}`;
    sel.appendChild(o);
  }
  sel.value = String(activeLevel);
  sel.onchange = e => setLevel(parseInt(e.target.value, 10));
  const all = document.getElementById('btn-alllevels');
  if (all) all.onclick = () => { showAllLevels = !showAllLevels; applyLevelVisibility(); };
})();

function setMode(m, type) {
  mode = m;
  if (typeof clearCableHandles === 'function') clearCableHandles();
  pendingType = type || null;
  cableDraft = null;
  wallStart = null;
  slabStart = null;
  roomStart = null;
  racewayStart = null;
  measureStart = null;
  clearMeasurePreview();
  if (m !== 'place') placeExistingId = null;
  clearPreview();
  clearGhost();
  document.querySelectorAll('.lib-item').forEach(el => el.classList.toggle('active', m === 'place' && el.dataset.type === type));
  for (const [k, btn] of Object.entries(toolButtons)) { if (btn) btn.classList.toggle('active', k === m); }
  updateOptionBar();
  document.querySelectorAll('#hotbar .slot[data-mode]').forEach(s => s.classList.toggle('active', s.dataset.mode === m));
  renderer.domElement.style.cursor = (m === 'select') ? 'default' : 'crosshair';
  const msgs = {
    select: 'Select mode — click a device, cable, wall, or rack to inspect.',
    cable: 'Cable mode — click a source port to start a cable.',
    delete: 'Delete mode — click a cable, device, hole, wall, or rack to remove it.',
    rack: 'Click the floor to place a rack. Q rotates. Esc to finish.',
    wall: 'Wall mode — click the floor to start a wall, click again to end it. Chains until Esc.',
    drill: 'Drill mode — click a wall to drill a cable pass-through hole.',
    tie: 'Tie mode — click a cable to strap it (nearby cables bundle into the same tie).',
    measure: 'Measure — click two points to pin a real-scale ft/in dimension. Everything is 1:1 scale.',
    slab: 'Upper floor — choose the level in the dropdown, then click two corners on the ground plan.',
    room: 'Room — click two corners (or pick a preset size and click once). Builds 4 walls + a ceiling.',
    place: pendingType ? `Placing ${DEVICE_TYPES[pendingType].label} — click a rack slot. Esc cancels.` : ''
  };
  setStatus(msgs[m] || '');
}

toolButtons.select.onclick = () => setMode('select');
toolButtons.cable.onclick = () => setMode('cable');
toolButtons.delete.onclick = () => setMode('delete');
toolButtons.rack.onclick = () => setMode('rack');
toolButtons.wall.onclick = () => setMode('wall');
toolButtons.drill.onclick = () => setMode('drill');
toolButtons.tie.onclick = () => setMode('tie');
toolButtons.measure.onclick = () => setMode('measure');
toolButtons.slab.onclick = () => setMode('slab');
toolButtons.room.onclick = () => setMode('room');
document.getElementById('btn-xray').onclick = () => setXray(!xrayOn);

function populateLibrary() {
  const wrap = document.getElementById('lib-items');
  wrap.innerHTML = '';
  const fixed = ['Generic', 'Office & Furniture', 'UniFi Gateways', 'UniFi Switches', 'UniFi APs', 'UniFi Cameras', 'UniFi Door Access', 'UniFi Storage & Power',
    'Cisco & Meraki', 'Aruba / HPE', 'Netgear', 'TP-Link Omada', 'MikroTik', 'Custom'];
  const extras = [...new Set(Object.values(DEVICE_TYPES).map(d => d.cat))].filter(c => c && !fixed.includes(c));
  const order = [...fixed, ...extras];
  const badge = def => {
    if (!def.field) return def.vertical ? 'side' : def.uh + 'U';
    return (def.mounts || ['ceiling']).map(m => ({ ceiling: 'ceil', wall: 'wall', desk: 'desk' })[m]).join('·');
  };
  for (const cat of order) {
    const types = Object.entries(DEVICE_TYPES).filter(([, d]) => d.cat === cat);
    if (!types.length) continue;
    const det = document.createElement('details');
    if (cat === 'Generic') det.open = true;
    const sum = document.createElement('summary');
    sum.textContent = cat;
    det.appendChild(sum);
    for (const [key, def] of types) {
      const el = document.createElement('div');
      el.className = 'lib-item';
      el.dataset.type = key;
      el.innerHTML = `${def.label} <em>${badge(def)}</em>`;
      el.onclick = () => setMode('place', key);
      det.appendChild(el);
    }
    wrap.appendChild(det);
  }
  if (typeof populatePlanTypes === 'function') populatePlanTypes();
}
populateLibrary();

window.addEventListener('keydown', e => {
  if (walkActive) {
    // hotbar while walking (letters are reserved for movement)
    const digitTools = { Digit1: 'select', Digit2: 'cable', Digit3: 'wall', Digit4: 'drill', Digit5: 'tie', Digit6: 'delete', Digit7: 'rack' };
    if (digitTools[e.code]) setMode(digitTools[e.code]);
    else if (e.code === 'Digit8') setXray(!xrayOn);
    else if (e.code === 'Digit9') setSim(!simOn);
    else if (e.code === 'Digit0') setPhys(!physOn);
    else if (e.code === 'KeyM') setMode('measure');
    else if (e.code === 'KeyB') { document.exitPointerLock(); openBuildMenu(true); }
    else if (e.code === 'KeyF') {
      flyMode = !flyMode;
      walkVy = 0;
      setStatus(flyMode ? 'Flying — Space/C go up and down. F returns to walking.' : 'Walking — Space jumps. F to fly.');
    }
    else if (e.key === 'q' || e.key === 'Q') { if (mode === 'rack') pendingRackRot = (pendingRackRot + Math.PI / 2) % (Math.PI * 2); }
    return;
  }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    if (undoStack.length) { restore(undoStack.pop()); setStatus('Undone.'); }
    else setStatus('Nothing to undo.');
    return;
  }
  if (planOpen) { if (e.key === 'Escape') openPlan(false); return; }
  if (bmenuOpen) { if (e.key === 'Escape' || e.key === 'b' || e.key === 'B') closeBuildMenu(false); return; }
  if (e.key === 'b' || e.key === 'B') { openBuildMenu(false); return; }
  if (e.key === 'Escape') {
    if (cableDraft) { cableDraft = null; clearPreview(); setStatus('Cable cancelled.'); }
    else if (wallStart) { wallStart = null; clearGhost(); setStatus('Wall finished.'); }
    else if (measureStart) { measureStart = null; clearMeasurePreview(); setStatus('Measurement cancelled.'); }
    else if (slabStart) { slabStart = null; clearGhost(); setStatus('Slab cancelled.'); }
    else if (roomStart) { roomStart = null; clearGhost(); setStatus('Room cancelled.'); }
    else if (vlanFocus) { setVlanFocus(null); setStatus('VLAN trace cleared.'); }
    else setMode('select');
  }
  else if (e.key === 'm' || e.key === 'M') setMode('measure');
  else if (e.key === 'c' || e.key === 'C') setMode('cable');
  else if (e.key === 'd' || e.key === 'D') setMode('delete');
  else if (e.key === 'r' || e.key === 'R') setMode('rack');
  else if (e.key === 'w' || e.key === 'W') setMode('wall');
  else if (e.key === 'h' || e.key === 'H') setMode('drill');
  else if (e.key === 'v' || e.key === 'V') enterWalk();
  else if (e.key === 'x' || e.key === 'X') setXray(!xrayOn);
  else if (e.key === 'g' || e.key === 'G') setSim(!simOn);
  else if (e.key === 'p' || e.key === 'P') setPhys(!physOn);
  else if (e.key === 't' || e.key === 'T') setMode('tie');
  else if (e.key === 'q' || e.key === 'Q') { if (mode === 'rack') pendingRackRot = (pendingRackRot + Math.PI / 2) % (Math.PI * 2); }
  else if (e.key === '[') setLevel(activeLevel - 1);      // down a storey
  else if (e.key === ']') setLevel(activeLevel + 1);      // up a storey
  else if (e.key === '\\') { showAllLevels = !showAllLevels; applyLevelVisibility(); }
});

//////////////////// Walk mode (first-person) ////////////////////

let walkActive = false, walkYaw = 0, walkPitch = 0;
let flyMode = false, walkVy = 0;
const EYE_H = 66; // standing eye height in inches
let placeExistingId = null;
const walkKeys = {};

function enterWalk() {
  hideProps();
  // keep the current tool active — build while you walk
  renderer.domElement.requestPointerLock();
}
document.getElementById('btn-walk').onclick = enterWalk;

document.addEventListener('pointerlockchange', () => {
  walkActive = document.pointerLockElement === renderer.domElement;
  controls.enabled = !walkActive;
  document.getElementById('walkhint').classList.toggle('hidden', !walkActive);
  document.getElementById('crosshair').classList.toggle('hidden', !walkActive);
  document.getElementById('hotbar').classList.toggle('hidden', !walkActive);
  document.getElementById('btn-walk').classList.toggle('active', walkActive);
  if (walkActive) {
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    walkYaw = e.y; walkPitch = e.x;
    flyMode = false;
    walkVy = 0;
    // walking is the default; F toggles flying. Land on whichever floor is below.
    camera.position.y = groundAt(camera.position.x, camera.position.z, camera.position.y) + EYE_H;
    setStatus('Walking — WASD move, mouse look, Space jump, F to fly, Shift sprint, click uses the current tool.');
  } else {
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    controls.target.copy(camera.position).addScaledVector(fwd, 80);
    setStatus('Select mode — click a device, cable, wall, or rack to inspect.');
  }
});

document.addEventListener('mousemove', e => {
  if (!walkActive) return;
  walkYaw -= e.movementX * 0.0022;
  walkPitch = Math.max(-1.5, Math.min(1.5, walkPitch - e.movementY * 0.0022));
  camera.quaternion.setFromEuler(new THREE.Euler(walkPitch, walkYaw, 0, 'YXZ'));
});
document.addEventListener('keydown', e => { walkKeys[e.code] = true; });
document.addEventListener('keyup', e => { walkKeys[e.code] = false; });

//////////////////// Traffic simulation ////////////////////

let simOn = false;
// Packet flow. The old animation ran one sphere per cable at 140 in/s, which
// read as a strobe rather than as traffic. These are tuned to look like items
// on a conveyor belt: slow enough to follow with your eye, close enough
// together to read as continuous.
const PULSE_SPEED_IPS = 26;      // ~2 ft/s along the jacket
const PULSE_SPACING_IN = 12;     // one packet per foot of cable
const PULSE_MAX = 64;            // cap for very long runs
const PULSE_GEO = new THREE.SphereGeometry(0.5, 10, 10);
const _pulseM = new THREE.Matrix4();
const _pulsePos = new THREE.Vector3();
const pulses = new Map(); // cableId -> {mesh, frac, n, colHex}

function setSim(on) {
  simOn = on;
  document.getElementById('btn-sim').classList.toggle('active', on);
  if (!on) {
    for (const p of pulses.values()) scene.remove(p.mesh);
    pulses.clear();
    setVlanFocus(null);
    for (const m of cableMeshes.values()) if (m.material.emissive) m.material.emissive.setHex(0x000000);
  }
  setStatus(on ? 'Simulating — packets flow along every cable; VLAN-blocked links glow red. Trace a VLAN from any port\'s properties.' : 'Simulation stopped.');
}
document.getElementById('btn-sim').onclick = () => setSim(!simOn);

function updatePulses(dt) {
  for (const [id, p] of pulses) {
    if (!state.cables.some(c => c.id === id)) { scene.remove(p.mesh); pulses.delete(id); }
  }
  for (const c of state.cables) {
    const cm = cableMeshes.get(c.id);
    if (!cm || !cm.userData.curve) continue;
    // live VLAN validation: a link with no shared VLAN is blocked — glows red
    const da = deviceById(c.a.deviceId), db = deviceById(c.b.deviceId);
    const isPower = c.a.port === 'PWR' || c.b.port === 'PWR' ||
      (da && DEVICE_TYPES[da.type].powerDevice) || (db && DEVICE_TYPES[db.type].powerDevice);
    let blocked = false;
    if (da && db && !isPower) {
      const sh = sharedVlans(da, c.a.port, db, c.b.port);
      blocked = sh !== 'ALL' && sh.size === 0;
    }
    if (isPower) {
      if (cm.material.emissive) cm.material.emissive.setHex(0x000000);
      const stale = pulses.get(c.id);
      if (stale) { scene.remove(stale.mesh); pulses.delete(c.id); }
      continue; // power feeds silently — no packets on a power cord
    }
    if (cm.material.emissive) cm.material.emissive.setHex(blocked ? 0x8a1616 : 0x000000);
    if (blocked || (vlanFocus && !vlanFocus.cables.has(c.id))) {
      const stale = pulses.get(c.id);
      if (stale) { scene.remove(stale.mesh); pulses.delete(c.id); }
      continue;
    }
    // Traffic reads as a conveyor: a steady train of evenly spaced packets
    // moving at one calm speed, not a single dot strobing down the wire. Spacing
    // is a fixed world distance, so a 3 ft patch lead and a 200 ft run show the
    // same density and the same velocity — which is what makes the whole map
    // look like one flowing system rather than a set of unrelated blinks.
    const len = Math.max(c.lengthIn || 60, 12);
    const n = Math.max(1, Math.min(PULSE_MAX, Math.round(len / PULSE_SPACING_IN)));
    const colHex = (vlanFocus ? vlanColor(vlanFocus.vlan)
      : new THREE.Color(c.color).lerp(new THREE.Color(0xffffff), 0.65)).getHex();
    let p = pulses.get(c.id);
    if (p && (p.n !== n || p.colHex !== colHex)) {          // length or focus changed
      scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
      pulses.delete(c.id); p = null;
    }
    if (!p) {
      const m = new THREE.InstancedMesh(PULSE_GEO,
        new THREE.MeshBasicMaterial({ color: colHex }), n);
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
      p = { mesh: m, frac: Math.random(), n, colHex };
      pulses.set(c.id, p);
    }
    p.frac = (p.frac + dt * PULSE_SPEED_IPS / len) % 1;
    const curve = cm.userData.curve;
    for (let i = 0; i < n; i++) {
      const f = (p.frac + i / n) % 1;
      curve.getPointAt(f, _pulsePos);
      _pulseM.makeTranslation(_pulsePos.x, _pulsePos.y, _pulsePos.z);
      p.mesh.setMatrixAt(i, _pulseM);
    }
    p.mesh.instanceMatrix.needsUpdate = true;
  }
}

//////////////////// Cable physics (verlet ropes) ////////////////////

let physOn = false;
const ropes = new Map(); // cableId -> {pts, prev, pins, segLen}

function setPhys(on) {
  physOn = on;
  document.getElementById('btn-phys').classList.toggle('active', on);
  ropes.clear();
  if (on) {
    for (const c of state.cables) buildRope(c);
    setStatus('Cable physics ON — cables hang with real slack. Set slack % per cable in its properties.');
  } else {
    for (const c of state.cables) rebuildCable(c);
    for (const t of state.ties) {
      const g = tieGroups.get(t.id);
      if (g) {
        g.position.set(t.x, t.y, t.z);
        g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1),
          new THREE.Vector3(t.tx || 1, t.ty || 0, t.tz || 0).normalize());
      }
    }
    setStatus('Cable physics off — cables return to drawn routes.');
  }
}
document.getElementById('btn-phys').onclick = () => setPhys(!physOn);

function buildRope(cable) {
  const curve = cableCurve(cable);
  if (!curve) return;
  const len = curve.getLength();
  const N = Math.max(10, Math.min(70, Math.round(len / 3)));
  const pts = [], prev = [];
  for (let i = 0; i < N; i++) {
    const p = curve.getPointAt(i / (N - 1));
    pts.push(p.clone()); prev.push(p.clone());
  }
  const pins = new Map();
  pins.set(0, pts[0].clone());
  pins.set(N - 1, pts[N - 1].clone());
  // rope is held wherever the user routed it: managers, wall holes
  for (const w of cable.waypoints) {
    const wv = new THREE.Vector3(w.x, w.y, w.z);
    let best = 1, bd = Infinity;
    for (let i = 1; i < N - 1; i++) {
      const d = pts[i].distanceToSquared(wv);
      if (d < bd) { bd = d; best = i; }
    }
    pins.set(best, wv.clone());
  }
  const slack = (cable.slack === undefined ? 2 : cable.slack) / 100;
  ropes.set(cable.id, { pts, prev, pins, segLen: (len * (1 + slack)) / (N - 1) });
}

const _ropeOff = new THREE.Vector3();
let physAcc = 0;

// ---- cable collision: ropes cannot clip through walls or floor slabs ----
let collidersDirty = true;
let ropeColliders = [];
let holeZones = [];
const _cl = new THREE.Vector3();
const _hz = new THREE.Vector3();
function rebuildRopeColliders() {
  collidersDirty = false;
  ropeColliders = [];
  holeZones = (state.holes || []).map(h => ({
    c: new THREE.Vector3(h.x, h.y, h.z),
    n: new THREE.Vector3(h.nx || 0, h.ny || 0, h.nz || 0).normalize(),
    r: (h.r || 0.9) + 1.1,
    half: (h.t || WALL_T) / 2 + 1.6
  }));
  const R = 0.28; // cable radius + margin
  for (const [id, m] of wallMeshes) {
    const w = state.walls.find(x => x.id === id);
    if (!w) continue;
    m.updateMatrixWorld(true);
    ropeColliders.push({
      inv: m.matrixWorld.clone().invert(),
      mat: m.matrixWorld.clone(),
      hx: Math.hypot(w.x2 - w.x1, w.z2 - w.z1) / 2 + R,
      hy: (w.h || WALL_H) / 2 + R,
      hz: WALL_T / 2 + R
    });
  }
  for (const s of state.slabs || []) {
    ropeColliders.push({
      aabb: true,
      x1: Math.min(s.x1, s.x2) - R, x2: Math.max(s.x1, s.x2) + R,
      y1: s.y - 6 - R, y2: s.y + R,
      z1: Math.min(s.z1, s.z2) - R, z2: Math.max(s.z1, s.z2) + R
    });
  }
  // rack corner posts — cables route around the frame, not through it
  for (const [, rg] of rackGroups) {
    rg.updateMatrixWorld(true);
    const inv = rg.matrixWorld.clone().invert(), mtx = rg.matrixWorld.clone();
    for (const [px2, pz2] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      ropeColliders.push({
        inv, mat: mtx,
        cx: px2 * (RACK_OUTER_W / 2 - 1), cy: RACK_H / 2, cz: pz2 * (RACK_D / 2 - 1.5),
        hx: 1 + R, hy: RACK_H / 2, hz: 1.5 + R
      });
    }
  }
  // mounted device chassis — cables drape over gear, never through it
  for (const d of state.devices) {
    const dd = DEVICE_TYPES[d.type];
    if (dd.field || dd.vertical || d.rackId === undefined || d.u === undefined) continue;
    const rg = rackGroups.get(d.rackId);
    if (!rg) continue;
    ropeColliders.push({
      inv: rg.matrixWorld.clone().invert(), mat: rg.matrixWorld.clone(),
      cx: 0, cy: RACK_BASE + (d.u - 1) * U + dd.uh * U / 2, cz: RACK_D / 2 - 1 - dd.depth / 2 + 0.5,
      hx: RACK_W / 2 + R, hy: dd.uh * U / 2 + R, hz: Math.max(dd.depth, 2) / 2 + R
    });
  }
  // Field gear and furniture had no colliders at all, so a run would happily pass
  // through a mounting pole, a desk or a standing person. Derive one box per solid
  // mesh directly from its geometry: automatic, and exact for whatever the catalog
  // builds — including anything the assistant adds later.
  for (const d of state.devices) {
    const dd = DEVICE_TYPES[d.type];
    if (!dd.field && !dd.vertical) continue;
    const g = deviceGroups.get(d.id);
    if (!g) continue;
    g.updateMatrixWorld(true);
    g.traverse(o => {
      if (!o.isMesh || !o.geometry || !(o.userData && o.userData.isDeviceBody)) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      bb.getCenter(_bbc); bb.getSize(_bbs);
      ropeColliders.push({
        inv: o.matrixWorld.clone().invert(), mat: o.matrixWorld.clone(),
        cx: _bbc.x, cy: _bbc.y, cz: _bbc.z,
        hx: _bbs.x / 2 + R, hy: _bbs.y / 2 + R, hz: _bbs.z / 2 + R
      });
    });
  }
  // Stairs: one box per tread. A stair is a solid object in a building — cable
  // runs go under, over or beside it, never through the flight.
  for (const st of state.stairs || []) {
    const { steps, rise, tread } = stairGeometry(st.rise);
    const g = stairGroups.get(st.id);
    if (!g) continue;
    g.updateMatrixWorld(true);
    const inv = g.matrixWorld.clone().invert(), mtx = g.matrixWorld.clone();
    for (let i = 0; i < steps; i++) {
      ropeColliders.push({
        inv, mat: mtx,
        cx: 0, cy: (i + 0.5) * rise, cz: i * tread + tread / 2,
        hx: (st.w || STAIR_W) / 2 + R, hy: (i + 0.5) * rise + R, hz: tread / 2 + R
      });
    }
  }
  for (const c of ropeColliders) finalizeCollider(c);
}

// Precompute a world-space AABB per collider. collidePoint runs for every free
// sample of every cable across ten relaxation passes, so rejecting the ~95% of
// colliders that are nowhere near the point with six compares — instead of a
// matrix multiply each — is what keeps a fully-cabled rack interactive.
const _bbc = new THREE.Vector3(), _bbs = new THREE.Vector3();
const _corner = new THREE.Vector3();
function finalizeCollider(c) {
  if (c.aabb) {
    c.wx1 = c.x1; c.wy1 = c.y1; c.wz1 = c.z1;
    c.wx2 = c.x2; c.wy2 = c.y2; c.wz2 = c.z2;
    return;
  }
  let x1 = Infinity, y1 = Infinity, z1 = Infinity, x2 = -Infinity, y2 = -Infinity, z2 = -Infinity;
  for (let i = 0; i < 8; i++) {
    _corner.set(
      (c.cx || 0) + ((i & 1) ? c.hx : -c.hx),
      (c.cy || 0) + ((i & 2) ? c.hy : -c.hy),
      (c.cz || 0) + ((i & 4) ? c.hz : -c.hz)
    ).applyMatrix4(c.mat);
    x1 = Math.min(x1, _corner.x); x2 = Math.max(x2, _corner.x);
    y1 = Math.min(y1, _corner.y); y2 = Math.max(y2, _corner.y);
    z1 = Math.min(z1, _corner.z); z2 = Math.max(z2, _corner.z);
  }
  c.wx1 = x1; c.wy1 = y1; c.wz1 = z1;
  c.wx2 = x2; c.wy2 = y2; c.wz2 = z2;
}
function collidePoint(p) {
  // inside a drilled bore? then walls/slabs don't push — the cable is in the hole
  for (const z of holeZones) {
    _hz.copy(p).sub(z.c);
    const along = _hz.dot(z.n);
    if (Math.abs(along) < z.half && _hz.addScaledVector(z.n, -along).length() < z.r) return;
  }
  for (const c of ropeColliders) {
    // broadphase: world AABB reject before any matrix work
    if (p.x < c.wx1 || p.x > c.wx2 || p.y < c.wy1 || p.y > c.wy2 || p.z < c.wz1 || p.z > c.wz2) continue;
    if (c.aabb) {
      if (p.x > c.x1 && p.x < c.x2 && p.y > c.y1 && p.y < c.y2 && p.z > c.z1 && p.z < c.z2) {
        // push out along the axis of least penetration
        const dx = Math.min(p.x - c.x1, c.x2 - p.x);
        const dy = Math.min(p.y - c.y1, c.y2 - p.y);
        const dz = Math.min(p.z - c.z1, c.z2 - p.z);
        if (dy <= dx && dy <= dz) p.y = (p.y - c.y1 < c.y2 - p.y) ? c.y1 : c.y2;
        else if (dx <= dz) p.x = (p.x - c.x1 < c.x2 - p.x) ? c.x1 : c.x2;
        else p.z = (p.z - c.z1 < c.z2 - p.z) ? c.z1 : c.z2;
      }
      continue;
    }
    _cl.copy(p).applyMatrix4(c.inv);
    _cl.x -= c.cx || 0; _cl.y -= c.cy || 0; _cl.z -= c.cz || 0;
    if (Math.abs(_cl.x) < c.hx && Math.abs(_cl.y) < c.hy && Math.abs(_cl.z) < c.hz) {
      const dx = c.hx - Math.abs(_cl.x), dy = c.hy - Math.abs(_cl.y), dz = c.hz - Math.abs(_cl.z);
      if (dz <= dx && dz <= dy) _cl.z = Math.sign(_cl.z || 1) * c.hz;      // usually out the face
      else if (dy <= dx) _cl.y = Math.sign(_cl.y || 1) * c.hy;
      else _cl.x = Math.sign(_cl.x || 1) * c.hx;
      _cl.x += c.cx || 0; _cl.y += c.cy || 0; _cl.z += c.cz || 0;
      p.copy(_cl.applyMatrix4(c.mat));
    }
  }
}
function ropeSubstep(h) {
  const grav = -386 * h * h; // gravity, verlet form
  for (const [, r] of ropes) {
    const { pts, prev, pins } = r;
    for (let i = 0; i < pts.length; i++) {
      if (pins.has(i)) { pts[i].copy(pins.get(i)); prev[i].copy(pts[i]); continue; }
      const p = pts[i], q = prev[i];
      const nx = p.x + (p.x - q.x) * 0.985;
      const ny = p.y + (p.y - q.y) * 0.985 + grav;
      const nz = p.z + (p.z - q.z) * 0.985;
      q.copy(p);
      p.set(nx, Math.max(0.3, ny), nz); // floor collision
    }
  }
  for (let it = 0; it < 4; it++) {
    for (const [, r] of ropes) {
      const { pts, pins, segLen } = r;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const d = a.distanceTo(b) || 1e-6;
        const diff = (d - segLen) / d / 2;
        _ropeOff.subVectors(b, a).multiplyScalar(diff);
        const pa = pins.has(i), pb = pins.has(i + 1);
        if (!pa && !pb) { a.add(_ropeOff); b.sub(_ropeOff); }
        else if (pa && !pb) b.sub(_ropeOff.multiplyScalar(2));
        else if (!pa && pb) a.add(_ropeOff.multiplyScalar(2));
      }
    }
    // ties bundle cables to EACH OTHER inside the solver so they stay cinched
    for (const tie of state.ties) {
      if (!tie.members || tie.members.length < 2) continue;
      const list = [];
      for (const m of tie.members) {
        const r = ropes.get(m.cableId);
        if (!r) continue;
        list.push({ r, idx: Math.max(1, Math.min(r.pts.length - 2, Math.round(m.t * (r.pts.length - 1)))) });
      }
      if (list.length < 2) continue;
      const c = new THREE.Vector3();
      for (const { r, idx } of list) c.add(r.pts[idx]);
      c.multiplyScalar(1 / list.length);
      list.forEach(({ r, idx }, k) => {
        if (r.pins.has(idx)) return;
        const ang = (k / list.length) * Math.PI * 2;
        r.pts[idx].lerp(c, 0.5);
        r.pts[idx].x += Math.cos(ang) * 0.27;
        r.pts[idx].y += Math.sin(ang) * 0.27;
      });
    }
  }
  // bend stiffness once per substep — cat6 holds a smooth curve without jitter
  for (const [, r] of ropes) {
    const { pts, pins } = r;
    for (let i = 1; i < pts.length - 1; i++) {
      if (pins.has(i)) continue;
      _ropeOff.copy(pts[i - 1]).add(pts[i + 1]).multiplyScalar(0.5);
      pts[i].lerp(_ropeOff, 0.22);
    }
  }
  // no clipping: push every free particle out of walls, slabs and gear
  for (const [, r] of ropes) {
    const { pts, pins } = r;
    for (let i = 0; i < pts.length; i++) {
      if (!pins.has(i)) collidePoint(pts[i]);
    }
  }
}

// Cables are solid to each other in physics mode too, or the sim would undo the
// separation the static settle just achieved. One spatial hash over every
// particle, then a symmetric push — both particles move, unlike the static pass
// where the already-laid route is frozen.
//
// Runs once per frame rather than per 120 Hz substep: separation is a positional
// constraint, and resolving it at frame rate is visually identical while costing
// half as much. It was the single most expensive thing in the physics loop.
function separateRopes() {
  const cell = CABLE_SEP * 2;
  const grid = new Map();
  for (const [id, r] of ropes) {
    for (let i = 0; i < r.pts.length; i++) {
      const p = r.pts[i];
      const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)},${Math.floor(p.z / cell)}`;
      let a = grid.get(k);
      if (!a) grid.set(k, a = []);
      a.push({ r, i, id });
    }
  }
  for (const [, bucket] of grid) {
    for (const A of bucket) {
      const pa = A.r.pts[A.i];
      const bx = Math.floor(pa.x / cell), by = Math.floor(pa.y / cell), bz = Math.floor(pa.z / cell);
      // sweep the 27 neighbouring cells, not just our own — a pair straddling a
      // cell boundary is exactly the pair most likely to be touching
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const near = grid.get(`${bx + dx},${by + dy},${bz + dz}`);
        if (!near) continue;
        for (const B of near) {
          if (A.id === B.id || A === B) continue;
          const pb = B.r.pts[B.i];
          _ropeOff.subVectors(pa, pb);
          const d = _ropeOff.length();
          if (d >= CABLE_SEP) continue;
          // exactly coincident particles have no separating direction of their
          // own; skipping them would weld two cables together forever, so give
          // them a defined one instead
          if (d < 1e-5) _ropeOff.set(0.002, CABLE_SEP, 0);
          else _ropeOff.multiplyScalar((CABLE_SEP - d) / d * 0.5);
          if (!A.r.pins.has(A.i)) pa.add(_ropeOff);
          if (!B.r.pins.has(B.i)) pb.sub(_ropeOff);
        }
      }
    }
  }
  // a separation push can shove a particle into gear, so geometry gets the last word
  for (const [, r] of ropes) {
    const { pts, pins } = r;
    for (let i = 0; i < pts.length; i++) {
      if (!pins.has(i)) collidePoint(pts[i]);
    }
  }
}

function stepRopes(dt) {
  for (const id of [...ropes.keys()]) {
    if (!state.cables.some(c => c.id === id)) ropes.delete(id);
  }
  for (const c of state.cables) if (!ropes.has(c.id)) buildRope(c);
  if (collidersDirty) rebuildRopeColliders();
  // fixed 120 Hz substeps — frame-rate independent, no more jelly
  physAcc = Math.min(physAcc + dt, 0.08);
  const h = 1 / 120;
  while (physAcc >= h) { physAcc -= h; ropeSubstep(h); }
  separateRopes();
  // Ties: pull member particles of each bundle toward their shared centroid,
  // with a small radial offset so cables sit side by side inside the strap.
  for (const tie of state.ties) {
    if (!tie.members) continue;
    const list = [];
    for (const m of tie.members) {
      const r = ropes.get(m.cableId);
      if (!r) continue;
      const idx = Math.max(1, Math.min(r.pts.length - 2, Math.round(m.t * (r.pts.length - 1))));
      list.push({ r, idx });
    }
    if (!list.length) continue;
    const c = new THREE.Vector3();
    for (const { r, idx } of list) c.add(r.pts[idx]);
    c.multiplyScalar(1 / list.length);
    // (bundling itself happens inside the solver; here we just track the strap visual)
    const g = tieGroups.get(tie.id);
    if (g) {
      g.position.copy(c);
      const { r, idx } = list[0];
      _ropeOff.subVectors(r.pts[Math.min(idx + 1, r.pts.length - 1)], r.pts[Math.max(idx - 1, 0)]).normalize();
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _ropeOff.clone());
    }
  }
  // finally, rebuild the tube geometry from the settled particles
  for (const [id, r] of ropes) {
    const m = cableMeshes.get(id);
    if (m) {
      const curve = new THREE.CatmullRomCurve3(r.pts, false, 'centripetal', 0.5);
      m.geometry.dispose();
      m.geometry = new THREE.TubeGeometry(curve, r.pts.length * 2, CABLE_R, CABLE_RADIAL, false);
      m.userData.curve = curve;
      const cc = state.cables.find(c => c.id === id);
      if (cc) cc.lengthIn = curve.getLength();
    }
  }
}

//////////////////// Save / Load / Export ////////////////////

function serialize() {
  return JSON.stringify({ version: 1, nextId, ...state }, null, 2);
}

async function saveMap() {
  const data = serialize();
  if (window.netmapNative) {
    const r = await window.netmapNative.saveFile({ defaultName: 'network-map.json', data });
    if (r.ok) setStatus('Saved to ' + r.filePath);
  } else {
    downloadBlob(data, 'network-map.json', 'application/json');
  }
}

async function loadMap() {
  if (window.netmapNative) {
    const r = await window.netmapNative.openFile();
    if (r.ok) restore(r.data);
  } else {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json';
    inp.onchange = () => {
      const f = inp.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => restore(rd.result);
      rd.readAsText(f);
    };
    inp.click();
  }
}

function clearScene() {
  for (const id of [...cableMeshes.keys()]) deleteCable(id);
  for (const r of [...state.racks]) deleteRack(r.id);
  for (const d of [...state.devices]) deleteDevice(d.id);
  for (const w of [...state.walls]) deleteWall(w.id);
  for (const h of [...state.holes]) deleteHole(h.id);
  for (const t of [...state.ties]) deleteTie(t.id);
  for (const m of [...(state.measures || [])]) deleteMeasure(m.id);
  for (const s of [...(state.slabs || [])]) deleteSlab(s.id);
  for (const st of [...(state.stairs || [])]) deleteStair(st.id);
  for (const rw of [...(state.raceways || [])]) deleteRaceway(rw.id);
  cableRoutes.clear();
  state = { racks: [], devices: [], cables: [], walls: [], holes: [], links: [], ties: [], measures: [], slabs: [], stairs: [], raceways: [], customTypes: state.customTypes || {} };
}

// Saves written before endpoints carried a side: everything defaults to the
// front jack, except that a patch port holding two legacy cables gets the second
// one moved to the rear punchdown — which is what those two cables always meant
// (a patch lead on the front, the permanent run on the back).
function migrateCableSides(cables) {
  const used = new Set();
  for (const c of cables) {
    for (const ep of [c.a, c.b]) {
      if (ep.side === FRONT || ep.side === REAR) { used.add(`${ep.deviceId}:${ep.port}:${ep.side}`); continue; }
      const dev = deviceById(ep.deviceId);
      const def = dev && DEVICE_TYPES[dev.type];
      const front = `${ep.deviceId}:${ep.port}:${FRONT}`;
      // rear-only jacks (UPS outlets, power inlets) were never front to begin with
      const rearOnly = def && (def.powerDevice || ep.port === 'PWR');
      ep.side = (rearOnly || (def && def.passthrough && used.has(front))) ? REAR : FRONT;
      used.add(`${ep.deviceId}:${ep.port}:${ep.side}`);
    }
  }
}

// Saves written when a device had one flat pool ({enabled, poolStart, poolEnd}).
// That pool becomes a scope, with its subnet taken from the start address and
// its gateway from whichever interface of this device sits in that subnet —
// which is what the old code assumed anyway, just never wrote down. Dropping
// these silently would turn a working saved map into a server with no scopes.
function migrateDhcpScopes(devices) {
  for (const d of devices || []) {
    const dh = d.dhcp;
    if (!dh || Array.isArray(dh.pools)) continue;
    if (!dh.poolStart) { d.dhcp = { enabled: !!dh.enabled, pools: [], excluded: [] }; continue; }
    const start = parseIp(dh.poolStart);
    if (!start) { d.dhcp = { enabled: !!dh.enabled, pools: [], excluded: [] }; continue; }
    const iface = deviceInterfaces(d).find(i => sameSubnet(i.ip, start));
    d.dhcp = { enabled: !!dh.enabled, excluded: [], pools: [{
      name: 'POOL1', network: subnetLabel(start),
      poolStart: dh.poolStart, poolEnd: dh.poolEnd || dh.poolStart,
      lease: { days: 1, hours: 0, minutes: 0 },
      defaultRouter: iface ? ipStr(iface.ip.int) : '',
      dns: [], domain: '', tftp: '', reservations: []
    }] };
  }
}

function restore(json) {
  let data;
  try { data = JSON.parse(json); } catch { setStatus('Could not parse that file.'); return; }
  clearScene();
  state = {
    racks: data.racks || [], devices: data.devices || [], cables: data.cables || [],
    walls: data.walls || [], holes: data.holes || [], links: data.links || [], ties: data.ties || [],
    measures: data.measures || [], slabs: data.slabs || [], stairs: data.stairs || [], raceways: data.raceways || [], customTypes: data.customTypes || {}
  };
  nextId = data.nextId || 1000;
  migrateCableSides(state.cables);
  migrateDhcpScopes(state.devices);
  // re-register custom devices BEFORE rebuilding anything that uses them
  Object.assign(DEVICE_TYPES, state.customTypes);
  populateLibrary();
  for (const s of state.slabs) buildSlab(s);
  for (const st of state.stairs) buildStair(st);
  for (const rw of state.raceways) buildRaceway(rw);
  for (const m of state.measures) buildMeasure(m);
  for (const w of state.walls) buildWall(w);
  for (const h of state.holes) buildHole(h);
  for (const r of state.racks) buildRackGroup(r);
  for (const d of state.devices) buildDeviceGroup(d);
  for (const c of state.cables) buildCableMesh(c);
  for (const t of state.ties) buildTie(t);
  hideProps();
  setStatus(`Loaded: ${state.racks.length} racks, ${state.devices.length} devices, ${state.cables.length} cables, ${state.walls.length} walls.`);
}

function exportCSV() {
  const rows = [['Cable ID', 'From Device', 'From IP', 'From Port', 'From Face',
    'To Device', 'To IP', 'To Port', 'To Face', 'Color', 'Route Points', 'Est. Length (ft)']];
  // The face column is what makes this sheet installable: "panel port 12" is
  // ambiguous on site, "panel port 12 rear" is a punchdown instruction.
  const face = (dev, ep) => dev && DEVICE_TYPES[dev.type].passthrough ? epSide(ep) : '';
  for (const c of state.cables) {
    const da = deviceById(c.a.deviceId), db = deviceById(c.b.deviceId);
    rows.push([c.id, da ? da.name : '?', da && da.ip ? da.ip : '', c.a.port, face(da, c.a),
      db ? db.name : '?', db && db.ip ? db.ip : '', c.b.port, face(db, c.b),
      CABLE_COLOR_NAMES[c.color] || c.color, c.waypoints.length, (c.lengthIn / 12).toFixed(1)]);
  }
  // device inventory appended below the cable map
  rows.push([], ['Device', 'Type', 'IP', 'Location', 'Notes']);
  for (const d of state.devices) {
    const def = DEVICE_TYPES[d.type];
    const rack = rackById(d.rackId);
    const loc = def.field ? `floor ${d.x}",${d.z}"` : `${rack ? rack.name : '?'} ${def.vertical ? (d.side === 'L' ? 'left side' : 'right side') : 'U' + d.u}`;
    rows.push([d.name, def.label, d.ip || '', loc, d.notes || '']);
  }
  if (state.links.length) {
    rows.push([], ['Planned Link', 'From', 'To', 'Status']);
    for (const l of state.links) {
      const a = deviceById(l.aId), b = deviceById(l.bId);
      const built = state.cables.some(c =>
        (c.a.deviceId === l.aId && c.b.deviceId === l.bId) ||
        (c.a.deviceId === l.bId && c.b.deviceId === l.aId));
      rows.push([l.id, a ? a.name : '?', b ? b.name : '?', built ? 'Built' : 'Planned']);
    }
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  if (window.netmapNative) {
    window.netmapNative.saveFile({
      defaultName: 'port-map.csv', data: csv,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    }).then(r => { if (r.ok) setStatus('Exported ' + r.filePath); });
  } else {
    downloadBlob(csv, 'port-map.csv', 'text/csv');
  }
}

function downloadBlob(data, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

document.getElementById('btn-save').onclick = () => { currentProject ? saveProject() : saveMap(); };
document.getElementById('btn-load').onclick = () => openLauncher();
document.getElementById('btn-export').onclick = exportCSV;

//////////////////// 2D logical plan view ////////////////////

let planOpen = false, planMode = 'select', planLinkFrom = null;
const planCam = { x: 0, y: 0, s: 1 };
let planDrag = null, planMoved = false, planMouse = null;
const planCanvas = document.getElementById('plan-canvas');
const pctx = planCanvas.getContext('2d');
const NW = 160, NH = 56;

function openPlan(open) {
  planOpen = open;
  document.getElementById('plan2d').classList.toggle('hidden', !open);
  document.getElementById('btn-plan').classList.toggle('active', open);
  if (open) {
    hideProps();
    setMode('select');
    autoLayout(false);
    resizePlan();
    setStatus('2D plan — drag nodes to arrange, Link tool plans connections (dashed until physically cabled), + Device adds logical devices you can later place in 3D.');
  }
}
document.getElementById('btn-plan').onclick = () => openPlan(!planOpen);
document.getElementById('plan-close').onclick = () => openPlan(false);
document.getElementById('plan-layout').onclick = () => autoLayout(true);
for (const m of ['select', 'link', 'delete']) {
  document.getElementById('plan-' + m).onclick = () => {
    planMode = m; planLinkFrom = null;
    document.querySelectorAll('.ptool').forEach(b => b.classList.remove('active'));
    document.getElementById('plan-' + m).classList.add('active');
  };
}
function populatePlanTypes() {
  const sel = document.getElementById('plan-type');
  sel.innerHTML = '';
  const groups = {};
  for (const [key, def] of Object.entries(DEVICE_TYPES)) {
    if (def.manager) continue;
    (groups[def.cat] = groups[def.cat] || []).push([key, def]);
  }
  for (const [cat, items] of Object.entries(groups)) {
    const og = document.createElement('optgroup');
    og.label = cat;
    for (const [key, def] of items) {
      const o = document.createElement('option');
      o.value = key;
      o.textContent = def.label;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
}
populatePlanTypes();

document.getElementById('plan-add').onclick = () => {
  undoPush();
  const type = document.getElementById('plan-type').value;
  const dev = {
    id: uid(), type, name: deviceLabelCounter(type),
    px: planCam.x + (Math.random() - 0.5) * 120, py: planCam.y + (Math.random() - 0.5) * 120
  };
  state.devices.push(dev);
  setStatus(`${dev.name} added to the plan. Click it and use "Place in 3D map" when you're ready to build it.`);
};

function resizePlan() {
  planCanvas.width = planCanvas.clientWidth;
  planCanvas.height = planCanvas.clientHeight;
}
window.addEventListener('resize', () => { if (planOpen) resizePlan(); });

const TIER = { router: 0, firewall: 0, switch48: 1, switch24: 1, patch24: 2, server: 3, ap: 3, camera: 3, ups: 4, hcm: 4, vcm: 4 };
function tierOf(type) {
  if (TIER[type] !== undefined) return TIER[type];
  switch (DEVICE_TYPES[type].cat) {
    case 'UniFi Gateways': return 0;
    case 'UniFi Switches': return 1;
    case 'UniFi APs': case 'UniFi Cameras': case 'UniFi Door Access': return 3;
    default: return 4;
  }
}
function autoLayout(force) {
  const targets = state.devices.filter(d => force || d.px === undefined);
  if (!targets.length) return;
  const tiers = {};
  for (const d of targets) {
    const t = tierOf(d.type);
    (tiers[t] = tiers[t] || []).push(d);
  }
  for (const t of Object.keys(tiers)) {
    tiers[t].forEach((d, i) => {
      d.px = (i - (tiers[t].length - 1) / 2) * (NW + 40);
      d.py = -200 + t * 140;
    });
  }
}

const toScreen = (x, y) => [(x - planCam.x) * planCam.s + planCanvas.width / 2, (y - planCam.y) * planCam.s + planCanvas.height / 2];
const toWorld = (sx, sy) => [(sx - planCanvas.width / 2) / planCam.s + planCam.x, (sy - planCanvas.height / 2) / planCam.s + planCam.y];

function linkBuilt(l) {
  return state.cables.some(c =>
    (c.a.deviceId === l.aId && c.b.deviceId === l.bId) ||
    (c.a.deviceId === l.bId && c.b.deviceId === l.aId));
}

function roundRectPath(x, y, w, h, r) {
  pctx.beginPath();
  pctx.moveTo(x + r, y);
  pctx.arcTo(x + w, y, x + w, y + h, r);
  pctx.arcTo(x + w, y + h, x, y + h, r);
  pctx.arcTo(x, y + h, x, y, r);
  pctx.arcTo(x, y, x + w, y, r);
  pctx.closePath();
}

function drawPlan() {
  const w = planCanvas.width, h = planCanvas.height;
  pctx.clearRect(0, 0, w, h);
  const step = 40 * planCam.s;
  if (step > 13) {
    pctx.fillStyle = '#1b2230';
    const [wx0, wy0] = toWorld(0, 0);
    const ox = (-wx0 * planCam.s % step + step) % step, oy = (-wy0 * planCam.s % step + step) % step;
    for (let x = ox; x < w; x += step) for (let y = oy; y < h; y += step) pctx.fillRect(x - 1, y - 1, 2, 2);
  }
  pctx.lineWidth = 2.5;
  for (const c of state.cables) {
    const a = deviceById(c.a.deviceId), b = deviceById(c.b.deviceId);
    if (!a || !b || a.px === undefined || b.px === undefined) continue;
    const [x1, y1] = toScreen(a.px, a.py), [x2, y2] = toScreen(b.px, b.py);
    pctx.strokeStyle = c.color;
    pctx.setLineDash([]);
    pctx.beginPath(); pctx.moveTo(x1, y1); pctx.lineTo(x2, y2); pctx.stroke();
    if (planCam.s > 0.55) {
      pctx.fillStyle = '#9aa7b8';
      pctx.font = `${10 * planCam.s}px sans-serif`;
      pctx.fillText(String(c.a.port), x1 + (x2 - x1) * 0.22, y1 + (y2 - y1) * 0.22 - 4);
      pctx.fillText(String(c.b.port), x1 + (x2 - x1) * 0.78, y1 + (y2 - y1) * 0.78 - 4);
    }
  }
  for (const l of state.links) {
    if (linkBuilt(l)) continue;
    const a = deviceById(l.aId), b = deviceById(l.bId);
    if (!a || !b || a.px === undefined || b.px === undefined) continue;
    const [x1, y1] = toScreen(a.px, a.py), [x2, y2] = toScreen(b.px, b.py);
    pctx.strokeStyle = '#5b7cff';
    pctx.setLineDash([7, 5]);
    pctx.beginPath(); pctx.moveTo(x1, y1); pctx.lineTo(x2, y2); pctx.stroke();
  }
  pctx.setLineDash([]);
  if (planMode === 'link' && planLinkFrom !== null && planMouse) {
    const a = deviceById(planLinkFrom);
    if (a && a.px !== undefined) {
      const [x1, y1] = toScreen(a.px, a.py);
      pctx.strokeStyle = '#5b7cff';
      pctx.setLineDash([4, 4]);
      pctx.beginPath(); pctx.moveTo(x1, y1); pctx.lineTo(planMouse[0], planMouse[1]); pctx.stroke();
      pctx.setLineDash([]);
    }
  }
  for (const d of state.devices) {
    if (d.px === undefined) continue;
    const def = DEVICE_TYPES[d.type];
    const [cx, cy] = toScreen(d.px, d.py);
    const nw = NW * planCam.s, nh = NH * planCam.s;
    const x = cx - nw / 2, y = cy - nh / 2;
    pctx.fillStyle = '#1b212b';
    pctx.strokeStyle = (selected && selected.kind === 'device' && selected.id === d.id) ? '#4da3ff'
      : (planLinkFrom === d.id ? '#5b7cff' : '#333d4e');
    pctx.lineWidth = 1.5;
    pctx.setLineDash(isPlaced(d) ? [] : [5, 4]);
    roundRectPath(x, y, nw, nh, 8 * planCam.s);
    pctx.fill(); pctx.stroke();
    pctx.setLineDash([]);
    const accent = def.color === 0x1c1f26 ? 0x4da3ff : def.color;
    pctx.fillStyle = '#' + new THREE.Color(accent).getHexString();
    pctx.fillRect(x, y + 2, 4 * planCam.s, nh - 4);
    if (planCam.s > 0.45) {
      pctx.fillStyle = '#e8eefc';
      pctx.font = `600 ${13 * planCam.s}px sans-serif`;
      pctx.fillText(d.name, x + 12 * planCam.s, y + 21 * planCam.s);
      pctx.fillStyle = '#7c8ba0';
      pctx.font = `${11 * planCam.s}px sans-serif`;
      pctx.fillText((d.ip || def.label) + (isPlaced(d) ? '' : ' · unplaced'), x + 12 * planCam.s, y + 40 * planCam.s);
    }
    pctx.lineWidth = 2.5;
  }
}

function planNodeAt(sx, sy) {
  const [wx, wy] = toWorld(sx, sy);
  for (let i = state.devices.length - 1; i >= 0; i--) {
    const d = state.devices[i];
    if (d.px === undefined) continue;
    if (Math.abs(wx - d.px) < NW / 2 && Math.abs(wy - d.py) < NH / 2) return d;
  }
  return null;
}
function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function planEdgeAt(sx, sy) {
  const [wx, wy] = toWorld(sx, sy);
  const tol = 8 / planCam.s;
  for (const c of state.cables) {
    const a = deviceById(c.a.deviceId), b = deviceById(c.b.deviceId);
    if (!a || !b || a.px === undefined || b.px === undefined) continue;
    if (distToSeg(wx, wy, a.px, a.py, b.px, b.py) < tol) return { kind: 'cable', id: c.id };
  }
  for (const l of state.links) {
    if (linkBuilt(l)) continue;
    const a = deviceById(l.aId), b = deviceById(l.bId);
    if (!a || !b || a.px === undefined || b.px === undefined) continue;
    if (distToSeg(wx, wy, a.px, a.py, b.px, b.py) < tol) return { kind: 'link', id: l.id };
  }
  return null;
}

planCanvas.addEventListener('wheel', e => {
  e.preventDefault();
  planCam.s = Math.max(0.2, Math.min(3, planCam.s * (e.deltaY < 0 ? 1.12 : 0.89)));
}, { passive: false });

planCanvas.addEventListener('mousedown', e => {
  planMoved = false;
  const node = planNodeAt(e.offsetX, e.offsetY);
  if (planMode === 'select' && node) {
    const [wx, wy] = toWorld(e.offsetX, e.offsetY);
    planDrag = { kind: 'node', id: node.id, ox: node.px - wx, oy: node.py - wy, sx0: e.offsetX, sy0: e.offsetY };
  } else {
    planDrag = { kind: 'pan', sx0: e.offsetX, sy0: e.offsetY, cx: planCam.x, cy: planCam.y };
  }
});
planCanvas.addEventListener('mousemove', e => {
  planMouse = [e.offsetX, e.offsetY];
  if (!planDrag) return;
  if (Math.hypot(e.offsetX - planDrag.sx0, e.offsetY - planDrag.sy0) > 4) planMoved = true;
  if (!planMoved) return;
  if (planDrag.kind === 'node') {
    const d = deviceById(planDrag.id);
    if (d) {
      const [wx, wy] = toWorld(e.offsetX, e.offsetY);
      d.px = wx + planDrag.ox;
      d.py = wy + planDrag.oy;
    }
  } else {
    planCam.x = planDrag.cx - (e.offsetX - planDrag.sx0) / planCam.s;
    planCam.y = planDrag.cy - (e.offsetY - planDrag.sy0) / planCam.s;
  }
});
planCanvas.addEventListener('mouseup', e => {
  const moved = planMoved;
  planDrag = null;
  if (moved) return;
  const node = planNodeAt(e.offsetX, e.offsetY);
  if (planMode === 'select') {
    if (node) { showDeviceProps(node.id); return; }
    const edge = planEdgeAt(e.offsetX, e.offsetY);
    if (edge && edge.kind === 'cable') { showCableProps(edge.id); return; }
    hideProps();
  } else if (planMode === 'link') {
    if (!node) return;
    if (planLinkFrom === null) {
      planLinkFrom = node.id;
      setStatus(`Link from ${node.name} — click the destination device.`);
    } else if (planLinkFrom !== node.id) {
      const dup = state.links.some(l =>
        (l.aId === planLinkFrom && l.bId === node.id) || (l.aId === node.id && l.bId === planLinkFrom));
      if (!dup) { undoPush(); state.links.push({ id: uid(), aId: planLinkFrom, bId: node.id }); }
      planLinkFrom = null;
      setStatus('Planned link added (dashed). It shows solid once you cable it for real in 3D.');
    }
  } else if (planMode === 'delete') {
    if (node) {
      if (confirm(`Delete ${node.name} (and its cables/links)?`)) { undoPush(); deleteDevice(node.id); hideProps(); }
      return;
    }
    const edge = planEdgeAt(e.offsetX, e.offsetY);
    if (edge) {
      undoPush();
      if (edge.kind === 'cable') deleteCable(edge.id);
      else removeFromArr(state.links, l => l.id === edge.id);
      setStatus('Removed. (Ctrl+Z undoes)');
    }
  }
});

//////////////////// Design assistant (local, no cloud) ////////////////////

const aiEl = document.getElementById('ai');
document.getElementById('btn-ai').onclick = () => {
  aiEl.classList.toggle('hidden');
  if (!aiEl.classList.contains('hidden')) refreshSimPickers();
};
document.getElementById('ai-close').onclick = () => aiEl.classList.add('hidden');
const aiOut = document.getElementById('ai-out');
function aiPrint(html) { aiOut.innerHTML = html; }

function analyzeMap() {
  const issues = [], notes = [];
  const cableCount = id => state.cables.filter(c => c.a.deviceId === id || c.b.deviceId === id).length;
  for (const d of state.devices) {
    const def = DEVICE_TYPES[d.type];
    if (def.ports && isPlaced(d) && !def.manager && cableCount(d.id) === 0)
      issues.push(`<b>${d.name}</b> has no cables connected.`);
    if (def.ports > 4 && cableCount(d.id) / def.ports > 0.8)
      notes.push(`<b>${d.name}</b> is over 80% port capacity — plan spare ports.`);
    if (def.ports && isPlaced(d) && !d.ip && !def.manager && !def.passthrough)
      notes.push(`<b>${d.name}</b> has no IP assigned.`);
  }
  for (const c of state.cables) {
    const ft = (c.lengthIn || 0) / 12;
    const da = deviceById(c.a.deviceId), db = deviceById(c.b.deviceId);
    const runName = `${da ? da.name : '?'}:${c.a.port} → ${db ? db.name : '?'}:${c.b.port}`;
    if (ft > COPPER_LIMIT_FT) {
      issues.push(`Cable <b>${runName}</b> is ${ft.toFixed(0)} ft — past the ${COPPER_LIMIT_FT} ft (100 m) channel limit. This link will not pass traffic.`);
    } else if (ft > PERMANENT_LINK_FT) {
      notes.push(`Cable <b>${runName}</b> is ${ft.toFixed(0)} ft — past the ${PERMANENT_LINK_FT} ft (90 m) permanent link. Legal only if patch cords at both ends stay inside the remaining ${(COPPER_LIMIT_FT - ft).toFixed(0)} ft.`);
    }
    if (da && db) {
      const sh = sharedVlans(da, c.a.port, db, c.b.port);
      if (sh !== 'ALL' && sh.size === 0)
        issues.push(`VLAN mismatch on <b>${da.name}:${c.a.port} ↔ ${db.name}:${c.b.port}</b> — no shared VLAN, link is blocked.`);
    }
  }
  // trunk native VLAN mismatch — silently bridges two VLANs together
  for (const c of state.cables) {
    const mm = nativeVlanMismatch(c);
    if (mm) issues.push(`Native VLAN mismatch: <b>${mm.a.name}</b> uses VLAN ${mm.aVlan} untagged, <b>${mm.b.name}</b> uses VLAN ${mm.bVlan}. Traffic will cross between those VLANs.`);
  }
  // a port placed in a VLAN the device has never been told about
  for (const d of state.devices) {
    if (netClass(d) !== 'switch' || !d.portCfg) continue;
    for (const [p, cfg] of Object.entries(d.portCfg)) {
      const v = nativeVlanOf(d, isNaN(+p) ? p : +p);
      if (!vlanExists(d, v)) issues.push(`<b>${d.name}</b> port ${p} is in VLAN ${v}, which is not in its VLAN database.`);
      for (const t of allowedVlans(d, isNaN(+p) ? p : +p)) {
        if (!vlanExists(d, t)) issues.push(`<b>${d.name}</b> port ${p} trunks VLAN ${t}, which is not in its VLAN database.`);
      }
    }
  }
  if (!state.devices.some(d => d.type === 'ups')) notes.push('No UPS in any rack — add battery backup.');
  if (!state.devices.some(d => DEVICE_TYPES[d.type].passthrough)) notes.push('No patch panel — direct switch runs are harder to service.');
  // AP coverage vs floor area
  let area = 0;
  if (state.walls.length) {
    const xs = state.walls.flatMap(w => [w.x1, w.x2]), zs = state.walls.flatMap(w => [w.z1, w.z2]);
    area += (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs)) / 144;
  }
  for (const s of state.slabs) area += Math.abs(s.x2 - s.x1) * Math.abs(s.z2 - s.z1) / 144;
  if (area > 0) {
    const aps = state.devices.filter(d => (DEVICE_TYPES[d.type].cat === 'UniFi APs' || d.type === 'ap') && isPlaced(d)).length;
    const need = Math.max(1, Math.ceil(area / 1500));
    if (aps < need) notes.push(`~${Math.round(area).toLocaleString()} sq ft mapped but only ${aps} AP${aps === 1 ? '' : 's'} — rule of thumb suggests ${need}.`);
  }
  // power review: everything must plug into something
  for (const d of state.devices) {
    const dd = DEVICE_TYPES[d.type];
    if (!isPlaced(d) || dd.field || dd.manager || dd.passthrough || dd.powerDevice || !d.rackId) continue;
    const powered = state.cables.some(c =>
      (c.a.deviceId === d.id && c.a.port === 'PWR') || (c.b.deviceId === d.id && c.b.port === 'PWR'));
    if (!powered) issues.push(`<b>${d.name}</b> has no power — run a cord from its rear inlet to a UPS/PDU outlet.`);
  }
  // failover / redundancy review
  const isInfra = d => {
    const c = DEVICE_TYPES[d.type].cat;
    return c === 'UniFi Switches' || c === 'UniFi Gateways' || ['switch48', 'switch24', 'router', 'firewall'].includes(d.type);
  };
  for (const d of state.devices) {
    if (!isPlaced(d) || !isInfra(d)) continue;
    const infraLinks = state.cables.filter(c => {
      const o = c.a.deviceId === d.id ? c.b : (c.b.deviceId === d.id ? c.a : null);
      if (!o) return false;
      const od = deviceById(o.deviceId);
      return od && isInfra(od);
    }).length;
    if ((DEVICE_TYPES[d.type].cat === 'UniFi Switches' || d.type.startsWith('switch')) && cableCount(d.id) > 1 && infraLinks === 1)
      notes.push(`<b>${d.name}</b> has a single uplink — no failover path if that link fails.`);
    const ddef = DEVICE_TYPES[d.type];
    let wanTotal = ddef.wan || 0;
    if (ddef.roleMap) wanTotal = Object.values(ddef.roleMap).filter(r => r === 'WAN').length || wanTotal;
    if (wanTotal >= 2) {
      const wanUsed = state.cables.filter(c =>
        (c.a.deviceId === d.id && portRole(ddef, c.a.port) === 'WAN') ||
        (c.b.deviceId === d.id && portRole(ddef, c.b.port) === 'WAN')).length;
      if (wanUsed === 1) notes.push(`<b>${d.name}</b> has ${wanTotal} WAN ports but only 1 cabled — add the second for dual-WAN failover.`);
    }
  }
  const sec = (t, arr, cls) => arr.length ? `<h4 class="${cls}">${t}</h4><ul>${arr.map(i => `<li>${i}</li>`).join('')}</ul>` : '';
  aiPrint(
    sec('Problems', issues, 'ai-bad') + sec('Suggestions', notes, 'ai-note') +
    (!issues.length && !notes.length ? '<p>Map looks clean — no problems found.</p>' : '') +
    `<p class="ai-meta">${state.devices.length} devices · ${state.cables.length} cables · ${state.walls.length} walls · ${state.slabs.length} upper floors</p>`);
}
document.getElementById('ai-analyze').onclick = analyzeMap;

//////////////////// Connectivity panel (ping / trace / matrix) ////////////////////

// The pickers hold every placed device with an IP. Rebuilt each time the panel
// opens so they never go stale against the map.
function refreshSimPickers() {
  resolveDhcp();
  const hosts = allHosts();
  for (const id of ['sim-src', 'sim-dst']) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    const cur = sel.value;
    sel.innerHTML = hosts.map(h => `<option value="${h.id}">${h.name} (${hostAddr(h)})</option>`).join('');
    // the Internet is a valid destination when one is placed — this is the
    // "can my network get out?" test, which is what people actually check first
    if (sel.id === 'sim-dst' && internetNodes().length) {
      sel.innerHTML += `<option value="internet">🌐 Internet (8.8.8.8)</option>`;
    }
    if (hosts.some(h => String(h.id) === cur)) sel.value = cur;
  }
  // default to two different hosts so the first click means something
  const src = document.getElementById('sim-src'), dst = document.getElementById('sim-dst');
  if (src && dst && hosts.length > 1 && src.value === dst.value) dst.selectedIndex = 1;
  return hosts.length;
}

// Flash the cables along a verdict's hop path. Uses the same VLAN-focus dimmer
// the rest of the app uses, so a ping visually IS a highlighted path.
function showPingPath(hops) {
  if (!hops || hops.length < 2) return;
  const cables = new Set();
  // cable chain from one hop device to the next, trying every data port of the
  // source — a router's transit link can hang off any of its ports
  const collect = (fromDev, toId) => {
    const def = DEVICE_TYPES[fromDev.type];
    for (let p = 1; p <= (def.ports || 1); p++) {
      if (portRole(def, p) === 'PWR') continue;
      const walk = l2Walk(fromDev, { startPort: p, ignoreVlan: true });
      let key = null;
      for (const [k] of walk.prev) if (k.startsWith(toId + ':')) { key = k; break; }
      if (!key) continue;
      while (key) {
        const [dId, pp, sd] = key.split(':');
        const c = portConnection(parseInt(dId, 10), isNaN(+pp) ? pp : +pp, sd);
        if (c) cables.add(c.id);
        key = walk.prev.get(key);
      }
      return true;
    }
    return false;
  };
  for (let i = 0; i + 1 < hops.length; i++) collect(deviceById(hops[i]), hops[i + 1]);
  if (!simOn) setSim(true);
  setVlanFocus({ vlan: -1, cables, devices: new Set(hops), ports: new Set() });
}

function runPing() {
  resolveDhcp();
  const a = parseInt(document.getElementById('sim-src').value, 10);
  const dstRaw = document.getElementById('sim-dst').value;
  if (dstRaw === 'internet') return runPingInternet(deviceById(a));
  const b = parseInt(dstRaw, 10);
  const r = pingHosts(a, b);
  const da = deviceById(a), db = deviceById(b);
  // a reply means frames really crossed the path — switches and hosts learn
  if (r.ok) learnFromExchange(da, db);
  if (r.ok) {
    showPingPath(r.hops);
    aiPrint(`<h4 class="ai-good">PING ${da.name} → ${db.name}: reply</h4><p>${r.detail}</p>` +
      (r.hops.length > 2 ? `<p class="ai-meta">${r.hops.map(id => deviceById(id).name).join(' → ')}</p>` : ''));
  } else {
    setVlanFocus(null);
    aiPrint(`<h4 class="ai-bad">PING ${da.name} → ${db.name}: unreachable</h4><p>${r.reason}</p>`);
  }
}

function runPingInternet(host) {
  const r = pingInternet(host);
  if (r.ok) {
    showPingPath(r.hops);
    aiPrint(`<h4 class="ai-good">PING ${host.name} → 8.8.8.8: reply</h4><p>${r.detail}</p>` +
      `<p class="ai-meta">${r.hops.map(id => deviceById(id).name).join(' → ')}</p>`);
  } else {
    setVlanFocus(null);
    aiPrint(`<h4 class="ai-bad">PING ${host.name} → 8.8.8.8: unreachable</h4><p>${r.reason}</p>`);
  }
}

function runTrace() {
  resolveDhcp();
  const a = parseInt(document.getElementById('sim-src').value, 10);
  const dstRaw = document.getElementById('sim-dst').value;
  if (dstRaw === 'internet') return runPingInternet(deviceById(a));
  const b = parseInt(dstRaw, 10);
  const r = pingHosts(a, b);
  const da = deviceById(a), db = deviceById(b);
  if (!r.ok) { setVlanFocus(null); aiPrint(`<h4 class="ai-bad">TRACE ${da.name} → ${db.name}</h4><p>* * * — ${r.reason}</p>`); return; }
  showPingPath(r.hops);
  const rows = r.hops.map((id, i) => {
    const d = deviceById(id);
    return `<tr><td>${i === 0 ? '' : i}</td><td>${d.name}</td><td>${d.ip || netClass(d)}</td></tr>`;
  }).join('');
  aiPrint(`<h4 class="ai-good">TRACE ${da.name} → ${db.name}</h4><table class="sim-table">${rows}</table><p class="ai-meta">${r.detail}</p>`);
}

function runMatrix() {
  resolveDhcp();
  const { hosts, rows } = reachabilityMatrix();
  if (hosts.length < 2) { aiPrint('<p>Fewer than two hosts with IPs — assign IPs in device properties first.</p>'); return; }
  const head = `<tr><th></th>${hosts.map(h => `<th title="${h.name}">${h.name.slice(0, 6)}</th>`).join('')}</tr>`;
  const body = rows.map(r =>
    `<tr><th title="${r.name} (${r.ip})">${r.name.slice(0, 10)}</th>` +
    r.reach.map(v => `<td class="mx-${v}">${v === 'self' ? '·' : v === 'ok' ? '✓' : '✗'}</td>`).join('') + '</tr>').join('');
  const bad = rows.reduce((n, r) => n + r.reach.filter(v => v === 'no').length, 0);
  aiPrint(`<h4>Reachability — ${hosts.length} hosts</h4><table class="sim-table sim-matrix">${head}${body}</table>` +
    (bad ? `<p class="ai-bad">${bad} failing pair${bad === 1 ? '' : 's'} — click Ping on one for the reason.</p>`
         : '<p class="ai-good">Every host reaches every other host.</p>'));
}

document.getElementById('sim-ping').onclick = runPing;
document.getElementById('sim-trace').onclick = runTrace;
document.getElementById('sim-matrix').onclick = runMatrix;

function runDhcp() {
  resolveDhcp();
  const servers = state.devices.filter(d => isPlaced(d) && d.dhcp && d.dhcp.enabled && dhcpPools(d).length);
  const now = simNow();
  let html = '';
  if (_simSkewMs) {
    html += `<p class="ai-meta">Simulation clock is ${fmtDur(_simSkewMs)} ahead of real time.</p>`;
  }
  if (!servers.length) {
    html += '<p>No DHCP scopes. Enable DHCP on a gateway or server and add a scope in its properties.</p>';
  }
  for (const sv of servers) {
    const pools = dhcpPools(sv);
    html += `<h4>${sv.name} · show ip dhcp pool</h4>`;
    html += `<table class="sim-table"><tr><th>Pool</th><th>Subnet</th><th>Range</th><th>Total</th><th>Leased</th><th>Lease</th></tr>${
      pools.map(p => {
        const total = p.end - p.start + 1;
        let excl = 0;
        for (let a = p.start; a <= p.end; a++) if (isExcluded(sv, a)) excl++;
        const leased = [..._dhcpBindings.values()].filter(b => b.serverId === sv.id && b.poolName === p.name && b.state !== 'EXPIRED').length;
        return `<tr><td>${p.name}</td><td>${subnetLabel(p.net)}</td><td>${ipStr(p.start)}–${ipStr(p.end)}</td>` +
          `<td>${total - excl}${excl ? ` <span class="ai-meta">(${excl} excl)</span>` : ''}</td><td>${leased}</td><td>${leaseLabel(p)}</td></tr>`;
      }).join('')}</table>`;
    const opts = pools.filter(p => p.defaultRouter || (p.dns || []).length || p.domain || p.tftp);
    if (opts.length) {
      html += `<table class="sim-table"><tr><th>Pool</th><th>router (3)</th><th>dns (6)</th><th>domain (15)</th><th>tftp (150)</th></tr>${
        opts.map(p => `<tr><td>${p.name}</td><td>${p.defaultRouter || '—'}</td><td>${[].concat(p.dns || []).join(', ') || '—'}</td><td>${p.domain || '—'}</td><td>${p.tftp || '—'}</td></tr>`).join('')}</table>`;
    }
    const binds = [..._dhcpBindings.values()].filter(b => b.serverId === sv.id).sort((a, b) => a.ipInt - b.ipInt);
    if (binds.length) {
      html += `<h4>${sv.name} · show ip dhcp binding</h4>`;
      html += `<table class="sim-table"><tr><th>IP address</th><th>Client-ID/Hardware</th><th>Lease expiration</th><th>Type</th><th>State</th></tr>${
        binds.map(b => {
          const h = deviceById(b.hostId);
          const left = b.expiresAt - now;
          const cls = b.state === 'EXPIRED' ? 'ai-bad' : (b.state === 'BOUND' ? '' : 'ai-warn');
          return `<tr><td>${b.ip}</td><td>${b.clientId}<br><span class="ai-meta">${h ? h.name : '?'} · ${b.mac}</span></td>` +
            `<td>${fmtDur(left)}${b.via === 'relay' ? `<br><span class="ai-meta">via ${b.relayName}, giaddr ${b.giaddr}</span>` : ''}</td>` +
            `<td>${b.type}</td><td class="${cls}">${b.state}${b.renewals ? ` <span class="ai-meta">(${b.renewals} renewals)</span>` : ''}</td></tr>`;
        }).join('')}</table>`;
    }
    const conf = _dhcpConflicts.get(sv.id) || [];
    if (conf.length) {
      html += `<h4>${sv.name} · show ip dhcp conflict</h4><p class="ai-meta">probed with ${DHCP_PING_PACKETS} pings, ${DHCP_PING_TIMEOUT_MS} ms timeout</p>`;
      html += `<table class="sim-table"><tr><th>IP address</th><th>Detection method</th><th>Held by</th></tr>${
        conf.map(c => `<tr><td>${c.ip}</td><td>${c.method}</td><td class="ai-warn">${c.holder}</td></tr>`).join('')}</table>`;
    }
  }
  // Anything that asked and did not get an address, with the actual reason.
  const failures = _dhcpLog.filter(l => !l.ok);
  if (failures.length) {
    html += `<h4>No lease</h4>` + failures.map(f =>
      `<p class="ai-bad">${f.host.name} — ${f.reason}</p>`).join('');
  }
  // The exchange itself, because "it got an address" is not the same as
  // knowing which server answered and what it sent.
  const shown = _dhcpLog.filter(l => l.log && l.log.length).slice(0, 4);
  if (shown.length) {
    html += `<h4>Exchange</h4>`;
    for (const l of shown) {
      html += `<p class="ai-meta">${l.host.name}</p><table class="sim-table">${
        l.log.map(p => `<tr><td style="white-space:nowrap">${p.dir} ${p.msg}</td><td class="ai-meta">${p.detail}</td></tr>`).join('')}</table>`;
    }
  }
  const leasedNow = [..._dhcpLeases.keys()].length;
  html += `<div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">
    <button id="dh-adv-1h">+1 hour</button>
    <button id="dh-adv-12h">+12 hours</button>
    <button id="dh-adv-1d">+1 day</button>
    <button id="dh-clock-reset">Reset clock</button>
    <button id="dh-clear" class="danger">clear ip dhcp binding *</button></div>
    <p class="cbl-edit-hint">${leasedNow} active lease${leasedNow === 1 ? '' : 's'}. Winding the clock forward runs the real RFC 2131 timers — T1 at 50% of the lease, T2 at 87.5%, then expiry.</p>`;
  aiPrint(html);
  const bind = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = () => { fn(); runDhcp(); }; };
  bind('dh-adv-1h', () => simAdvance(3600));
  bind('dh-adv-12h', () => simAdvance(12 * 3600));
  bind('dh-adv-1d', () => simAdvance(86400));
  bind('dh-clock-reset', () => simResetClock());
  bind('dh-clear', () => dhcpClearBindings());
}
document.getElementById('sim-dhcp').onclick = runDhcp;

// `show access-lists` plus a traffic tester. A ping only ever exercises ICMP
// echo, so without a way to send TCP on a chosen port most of an ACL can never
// be verified — and an ACL you cannot test is an ACL you are guessing about.
function runAcl() {
  const withAcls = state.devices.filter(d => isPlaced(d) && (d.acls || []).length);
  let html = '';
  if (!withAcls.length) {
    html += `<p>No access lists. Add them in a router's properties, in IOS syntax:</p>
      <p><code>access-list 110 deny tcp any host 10.0.10.5 eq www</code></p>
      <p><code>ip access-list extended BLOCK-CCTV</code></p>`;
  }
  for (const d of withAcls) {
    const applied = d.aclApply || {};
    const rows = Object.entries(applied).flatMap(([p, dd]) =>
      Object.entries(dd).map(([dir, id]) => `<tr><td>Port ${p}</td><td>${dir}</td><td>${id}</td></tr>`)).join('');
    html += `<h4>${d.name} · show access-lists</h4><pre style="font-size:11px;white-space:pre-wrap">${esc(aclShow(d))}</pre>`;
    html += rows
      ? `<table class="sim-table"><tr><th>Interface</th><th>Dir</th><th>ACL</th></tr>${rows}</table>`
      : `<p class="ai-warn">None of ${d.name}'s lists are applied to an interface — an ACL that isn't applied filters nothing.</p>`;
  }
  const hosts = state.devices.filter(d => isPlaced(d) && netClass(d) === 'host' && d.ip);
  const opts = hosts.map(h => `<option value="${h.id}">${h.name}</option>`).join('');
  html += `<h4>Test traffic</h4>
    <div class="row" style="gap:4px;flex-wrap:wrap">
      <select id="acl-a" style="width:96px">${opts}</select>
      <span class="sim-arrow">→</span>
      <select id="acl-b" style="width:96px">${opts}</select>
      <select id="acl-proto" style="width:64px">
        <option value="icmp">icmp</option><option value="tcp">tcp</option>
        <option value="udp">udp</option></select>
      <input type="text" id="acl-port" style="width:72px" placeholder="port / www">
      <label style="font-size:11px"><input type="checkbox" id="acl-est"> established</label>
      <button id="acl-run">Send</button>
    </div>
    <div id="acl-result" style="margin-top:6px"></div>`;
  aiPrint(html);
  const sel = id => document.getElementById(id);
  if (hosts.length > 1) { sel('acl-a').value = hosts[0].id; sel('acl-b').value = hosts[1].id; }
  const btn = sel('acl-run');
  if (btn) btn.onclick = () => {
    const a = +sel('acl-a').value, b = +sel('acl-b').value;
    const proto = sel('acl-proto').value;
    const raw = (sel('acl-port').value || '').trim();
    const est = sel('acl-est').checked;
    let pkt;
    if (proto === 'icmp') pkt = { proto: 'icmp', icmpType: 'echo', srcPort: null, dstPort: null };
    else {
      const dstPort = raw ? aclPortNum(raw, proto) : null;
      if (raw && dstPort === null) {
        sel('acl-result').innerHTML = `<p class="ai-bad">"${esc(raw)}" isn't a port number or a ${proto} mnemonic.</p>`;
        return;
      }
      // Real clients source from an ephemeral port; rules matching a source
      // port must see something plausible rather than nothing.
      pkt = { proto, srcPort: 49152, dstPort, established: est, icmpType: null };
    }
    for (const d of state.devices) aclResetHits(d);
    const r = pingHosts(a, b, pkt);
    const desc = proto === 'icmp' ? 'icmp echo'
      : `${proto}${pkt.dstPort ? ' → port ' + aclPortName(pkt.dstPort, proto) : ''}${est ? ' established' : ''}`;
    sel('acl-result').innerHTML = r.ok
      ? `<p class="ai-good">${desc}: permitted — ${esc(r.detail || 'delivered')}</p>`
      : `<p class="ai-bad">${desc}: ${esc(r.reason)}</p>`;
  };
}
document.getElementById('sim-acl').onclick = runAcl;


// The Packet panel: send one PDU and step through every device decision it
// causes. This is the observable half of the simulation — everything else
// answers "does it work", this answers "what exactly happened".
let _pduCur = null, _pduAt = 0;
function runPdu() {
  const hosts = state.devices.filter(d => isPlaced(d) && netClass(d) === 'host' && hostNics(d).length);
  if (hosts.length < 2) { aiPrint('<p>Place at least two addressed hosts to send a packet between.</p>'); return; }
  const opts = hosts.map(h => `<option value="${h.id}">${esc(h.name)}</option>`).join('');
  const sel = (id, def) => `<select id="${id}" style="width:104px">${opts}</select>`;
  let html = `<div class="row" style="gap:4px;flex-wrap:wrap">
      ${sel('pdu-a')}<span class="sim-arrow">→</span>${sel('pdu-b')}
      <select id="pdu-proto" style="width:60px">
        <option value="icmp">icmp</option><option value="tcp">tcp</option><option value="udp">udp</option></select>
      <input type="text" id="pdu-port" style="width:64px" placeholder="port">
      <button id="pdu-send">Send</button></div>
    <div id="pdu-out"></div>`;
  aiPrint(html);
  const a = document.getElementById('pdu-a'), b = document.getElementById('pdu-b');
  a.value = hosts[0].id; b.value = hosts[1].id;
  document.getElementById('pdu-send').onclick = () => {
    flushL2Tables();
    const src = deviceById(+a.value), dst = deviceById(+b.value);
    const proto = document.getElementById('pdu-proto').value;
    const raw = (document.getElementById('pdu-port').value || '').trim();
    const dstNic = hostNics(dst).find(n => nicIp(dst, n.port));
    if (!dstNic) { document.getElementById('pdu-out').innerHTML = `<p class="ai-bad">${esc(dst.name)} has no address.</p>`; return; }
    const spec = proto === 'icmp' ? { proto: 'icmp', icmpType: 'echo' }
      : { proto, srcPort: 49152, dstPort: raw ? (aclPortNum(raw, proto) || +raw || 80) : 80, flags: proto === 'tcp' ? 'SYN' : null };
    _pduCur = pduSend(src, nicIp(dst, dstNic.port).int, spec);
    _pduAt = _pduCur.trace.length;
    drawPduTrace();
  };
}
function drawPduTrace() {
  const out = document.getElementById('pdu-out');
  if (!out || !_pduCur) return;
  const sim = _pduCur;
  const shown = sim.trace.slice(0, _pduAt);
  const icon = { arp: 'ARP', send: 'TX', switch: 'SW', route: 'RT', deliver: 'OK', drop: 'X' };
  let html = `<div class="row" style="gap:6px;margin:8px 0;flex-wrap:wrap">
      <button id="pdu-back">← Step back</button>
      <button id="pdu-fwd">Step →</button>
      <button id="pdu-all">Play all</button>
      <span class="ai-meta">${_pduAt} / ${sim.trace.length}</span></div>`;
  html += `<table class="sim-table"><tr><th>#</th><th>Device</th><th>If</th><th>Action</th><th>What happened</th></tr>`;
  shown.forEach((t, i) => {
    const d = deviceById(t.devId);
    const cls = t.action === 'drop' ? 'ai-bad' : (t.action === 'deliver' ? 'ai-good' : '');
    html += `<tr><td>${i + 1}</td><td>${esc(d ? d.name : '?')}</td><td>${t.egress ? `${t.iface}→${t.egress}` : t.iface}</td>` +
      `<td class="${cls}">${t.action}</td><td>${esc(t.why)}</td></tr>`;
  });
  html += '</table>';
  // The headers of the PDU as it stood at the current step — this is the
  // "open the packet" view, and every field is read from the model.
  const cur = shown[shown.length - 1];
  if (cur) {
    const p = cur.pdu;
    html += `<h4>PDU at step ${shown.length} — ${esc(pduSummary(p))}</h4><table class="sim-table">`;
    html += `<tr><th>Layer 2</th><td>src ${p.l2.srcMac || '—'}<br>dst ${p.l2.dstMac || '—'}<br>VLAN ${p.l2.vlan}` +
      ` · ethertype 0x${(p.l2.etherType || 0).toString(16)}</td></tr>`;
    if (p.l3) html += `<tr><th>Layer 3</th><td>src ${ipStr(p.l3.src)}<br>dst ${ipStr(p.l3.dst)}<br>TTL ${p.l3.ttl}` +
      ` · proto ${p.l3.proto}${p.l3.icmpType ? ' · type ' + p.l3.icmpType : ''}</td></tr>`;
    if (p.l4) html += `<tr><th>Layer 4</th><td>src port ${p.l4.srcPort}<br>dst port ${p.l4.dstPort}` +
      `${p.l4.flags ? '<br>flags ' + p.l4.flags : ''}</td></tr>`;
    if (p.arp) html += `<tr><th>ARP</th><td>${p.arp.op} · sender ${p.arp.senderMac} ${ipStr(p.arp.senderIp)}` +
      `<br>target ${p.arp.targetMac} ${ipStr(p.arp.targetIp)}</td></tr>`;
    html += '</table>';
  }
  if (_pduAt === sim.trace.length) {
    html += sim.delivered
      ? `<p class="ai-good">Delivered in ${sim.trace.length} step${sim.trace.length === 1 ? '' : 's'}.</p>`
      : `<p class="ai-bad">Dropped — ${esc(sim.dropped ? sim.dropped.why : 'unknown')}</p>`;
  }
  out.innerHTML = html;
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = () => { fn(); drawPduTrace(); }; };
  bind('pdu-back', () => { _pduAt = Math.max(1, _pduAt - 1); });
  bind('pdu-fwd', () => { _pduAt = Math.min(sim.trace.length, _pduAt + 1); });
  bind('pdu-all', () => { _pduAt = sim.trace.length; });
  // Light the path in 3D so the trace and the model agree visually.
  const ids = shown.map(t => t.devId);
  if (typeof showPingPath === 'function') { try { showPingPath(ids); } catch (e) {} }
}
const pduBtn = document.getElementById('sim-pdu');
if (pduBtn) pduBtn.onclick = runPdu;

function runStp() {
  flushL2Tables();
  const switches = state.devices.filter(d => isPlaced(d) && netClass(d) === 'switch');
  if (switches.length < 2) { aiPrint('<p>Spanning tree needs at least two switches.</p>'); return; }
  const base = stpState();
  if (!base.links || !base.links.length) {
    aiPrint('<p>No switch-to-switch links — nothing for spanning tree to do. ' +
            'Add a redundant link between two switches to see a port block.</p>');
    return;
  }
  // PVST+ runs a tree per VLAN, so the panel does too. The untagged view first,
  // then each VLAN that has its own tree — that is the point of PVST+ and
  // showing only one tree hides the case where VLAN 20 blocks a link VLAN 10
  // forwards.
  const vlans = stpVlans();
  const views = [{ key: undefined, label: 'All VLANs (CST)' },
    ...vlans.map(v => ({ key: v, label: `VLAN ${v}` }))];
  const mode = stpMode(switches[0]);
  let html = `<p class="ai-meta">mode ${mode === 'rapid-pvst' ? 'rapid-pvst (802.1w)' : 'pvst (802.1D)'} · ` +
    `hello ${STP_HELLO_S}s · forward delay ${STP_FWD_DELAY_S}s · max age ${STP_MAX_AGE_S}s · ` +
    `802.1D-2004 costs (1G = 20000)</p>`;
  for (const view of views) {
    const st = stpState(view.key);
    if (!st.links || !st.links.length) continue;
    const root = deviceById(st.rootId);
    if (!root) continue;
    html += `<h4>${view.label} · root ${root.name}</h4>` +
      `<p class="ai-meta">bridge ID ${bridgePriority(root, view.key)}` +
      `${view.key !== undefined ? ` (${bridgePriority(root, view.key) - view.key} + VLAN ${view.key})` : ''}` +
      `.${deviceMac(root)}</p>` +
      `<table class="sim-table"><tr><th>Switch</th><th>Cost</th><th>Port</th><th>Role</th><th>State</th></tr>`;
    for (const d of switches.slice().sort((x, y) => (st.cost.get(x.id) ?? 1e9) - (st.cost.get(y.id) ?? 1e9))) {
      const mine = [...st.roles].filter(([k]) => k.startsWith(d.id + ':'));
      if (!mine.length) continue;
      let first = true;
      for (const [k, role] of mine) {
        const port = k.split(':')[1];
        const ps = stpPortState(d.id, port, view.key);
        const cls = ps.state === 'forwarding' ? 'ai-good'
          : (ps.state === 'blocking' || ps.state === 'discarding') ? 'ai-bad' : 'ai-warn';
        html += `<tr><td>${first ? d.name + (d.id === st.rootId ? ' <b>(root)</b>' : '') : ''}</td>` +
          `<td>${first ? (st.cost.get(d.id) === 0 ? '0' : (st.cost.get(d.id) ?? '—')) : ''}</td>` +
          `<td>${port}</td><td>${role}</td>` +
          `<td class="${cls}">${ps.state}${ps.secsLeft ? ` <span class="ai-meta">${ps.secsLeft}s</span>` : ''}</td></tr>`;
        first = false;
      }
    }
    html += '</table>';
    const blocked = [...st.roles].filter(([, v]) => v !== 'root' && v !== 'designated').length;
    if (blocked) html += `<p class="ai-meta">${blocked} port${blocked === 1 ? '' : 's'} not forwarding — the link is up, the tree is keeping it out of the loop.</p>`;
  }
  // A PortFast port on a switch-to-switch link is a loop waiting to happen —
  // it forwards before the tree has converged. This is exactly what BPDU guard
  // exists to catch, so flag it rather than letting it look fine.
  const risky = [];
  for (const d of switches) {
    const def = DEVICE_TYPES[d.type];
    for (let p = 1; p <= (def.ports || 0); p++) {
      if (portRole(def, p) === 'PWR') continue;
      if (!portCfgOf(d, p).portfast) continue;
      const nb = hopThroughPatches(d, p, FRONT);
      if (nb && netClass(nb.dev) === 'switch') risky.push(`${d.name} port ${p} → ${nb.dev.name}`);
    }
  }
  if (risky.length) {
    html += `<h4 class="ai-bad">PortFast on a switch link</h4>` +
      `<p class="ai-bad">${risky.join('<br>')}</p>` +
      `<p class="ai-meta">PortFast skips listening and learning, so this port forwards before the tree converges — that is a loop. Real deployments pair PortFast with BPDU guard, which shuts the port down the moment a BPDU arrives on it.</p>`;
  }
  html += `<div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">
    <button id="stp-conv">Watch convergence (+5s)</button>
    <button id="stp-reset">Restart ports</button>
    <button id="stp-mode">Toggle pvst / rapid-pvst</button></div>`;
  aiPrint(html);
  const bind = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = () => { fn(); runStp(); }; };
  bind('stp-conv', () => simAdvance(5));
  bind('stp-reset', () => { _stpPortUp.clear(); simResetClock(); });
  bind('stp-mode', () => {
    const next = mode === 'rapid-pvst' ? 'pvst' : 'rapid-pvst';
    for (const d of switches) d.stpMode = next;
    _stpPortUp.clear(); simResetClock();
  });
}
document.getElementById('sim-stp').onclick = runStp;

function autoDesign() {
  if (!state.walls.length) { aiPrint('<p>Draw the building outline first (Wall tool) — the designer works from your layout.</p>'); return; }
  undoPush();
  const xs = state.walls.flatMap(w => [w.x1, w.x2]), zs = state.walls.flatMap(w => [w.z1, w.z2]);
  const x1 = Math.min(...xs), x2 = Math.max(...xs), z1 = Math.min(...zs), z2 = Math.max(...zs);
  const made = [];
  // core rack in a corner
  let rack = state.racks[0];
  if (!rack) {
    rack = { id: uid(), x: x1 + 30, z: z1 + 36, y0: 0, rotY: 0, name: 'Rack-1' };
    state.racks.push(rack); buildRackGroup(rack); made.push('42U rack');
  }
  const inRack = t => state.devices.find(d => d.rackId === rack.id && d.type === t);
  const addRack = (type, u, name) => {
    if (rackOccupied(rack.id, u, DEVICE_TYPES[type].uh)) return null;
    const d = { id: uid(), type, rackId: rack.id, u, name: name || deviceLabelCounter(type) };
    state.devices.push(d); buildDeviceGroup(d); made.push(DEVICE_TYPES[type].label);
    return d;
  };
  const gw = state.devices.find(d => DEVICE_TYPES[d.type].cat === 'UniFi Gateways' && d.rackId) || addRack('u_udmpromax', 40);
  const patch = state.devices.find(d => DEVICE_TYPES[d.type].passthrough) || addRack('patch24', 42);
  const hcmD = state.devices.find(d => d.type === 'hcm') || addRack('hcm', 41);
  const sw = state.devices.find(d => DEVICE_TYPES[d.type].cat === 'UniFi Switches' && d.rackId) || addRack('u_promax24', 39);
  if (!inRack('ups')) addRack('ups', 1);
  // AP grid ~ every 30 ft inside the outline
  let port = 1, apN = 0;
  const usedPorts = new Set(state.cables.flatMap(c => [
    c.a.deviceId === (sw && sw.id) ? c.a.port : null,
    c.b.deviceId === (sw && sw.id) ? c.b.port : null]).filter(Boolean));
  const nextPort = () => { while (usedPorts.has(port)) port++; usedPorts.add(port); return port; };
  for (let ax = x1 + 90; ax < x2 - 30; ax += 360) {
    for (let az = z1 + 90; az < z2 - 30; az += 360) {
      const ap = { id: uid(), type: 'u_u7pro', x: Math.round(ax / 3) * 3, z: Math.round(az / 3) * 3, y0: 0, name: deviceLabelCounter('u_u7pro'), notes: 'auto-design' };
      state.devices.push(ap); buildDeviceGroup(ap); apN++;
      if (sw) {
        const c = { id: uid(), a: { deviceId: sw.id, port: nextPort() }, b: { deviceId: ap.id, port: 1 }, color: '#eab308', waypoints: [] };
        state.cables.push(c); buildCableMesh(c);
      }
    }
  }
  if (apN) made.push(`${apN} ceiling AP${apN > 1 ? 's' : ''} on a 30 ft grid, cabled home`);
  aiPrint(`<h4 class="ai-note">Sample design generated</h4><ul>${made.map(m => `<li>${m}</li>`).join('')}</ul><p>Everything is real: placed, cabled, and editable. Ctrl+Z reverts the whole design.</p>`);
}
document.getElementById('ai-design').onclick = autoDesign;

// Add any real-world device on demand — the result is a complete replica:
// correct U height / mount, full clickable port grid with WAN/SFP roles,
// named faceplate, VLAN support, exports. Saved inside the map file.
function registerCustomDevice(spec, fallbackName) {
  const label = String(spec.label || fallbackName || 'Custom Device').slice(0, 44);
  const brand = String(spec.brand || '').trim().slice(0, 24);
  const mountKind = ['rack', 'wall', 'ceiling', 'desk'].includes(spec.mount) ? spec.mount : 'rack';
  const ports = Math.max(0, Math.min(96, parseInt(spec.ports, 10) || 0));
  const short = (label.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'Dev');
  let def;
  if (mountKind === 'rack') {
    def = {
      label, short,
      uh: Math.max(1, Math.min(8, parseInt(spec.uh, 10) || 1)),
      ports, rows: ports > 26 ? 2 : 1,
      depth: Math.max(4, Math.min(30, parseInt(spec.depth_in, 10) || 14)),
      color: 0x2f3b4d,
      wan: Math.max(0, Math.min(4, parseInt(spec.wan, 10) || 0)),
      sfp: Math.max(0, Math.min(ports, parseInt(spec.sfp, 10) || 0))
    };
  } else {
    def = {
      label, short, uh: 0,
      ports: Math.max(0, Math.min(8, ports || 1)), rows: 1, depth: 0,
      color: 0xe8ebef, field: true, mountH: 96,
      mounts: mountKind === 'ceiling' ? ['ceiling', 'wall'] : [mountKind],
      shape: mountKind === 'wall' ? 'box' : mountKind === 'desk' ? 'deskbox' : 'disc',
      wan: Math.max(0, Math.min(2, parseInt(spec.wan, 10) || 0))
    };
  }
  def.cat = brand || 'Custom';
  let key = 'c_' + short.toLowerCase();
  while (DEVICE_TYPES[key]) key += 'x';
  DEVICE_TYPES[key] = def;
  state.customTypes[key] = def;
  populateLibrary();
  return key;
}

function manualDeviceForm(q) {
  aiPrint(`<h4 class="ai-note">Add “${q}” manually</h4>
    <div class="ai-row">
      <select id="ai-mk-mount"><option value="rack">Rack-mount</option><option value="ceiling">Ceiling</option><option value="wall">Wall</option><option value="desk">Desk</option></select>
      <input type="number" id="ai-mk-uh" value="1" min="1" max="8" title="Rack units (U)" style="width:54px">
    </div>
    <div class="ai-row">
      <input type="number" id="ai-mk-ports" value="24" min="0" max="96" title="Total ports" style="width:60px">
      <input type="number" id="ai-mk-wan" value="0" min="0" max="4" title="WAN ports" style="width:54px">
      <input type="number" id="ai-mk-sfp" value="0" min="0" max="48" title="SFP+ ports" style="width:54px">
      <button id="ai-mk">Add to library</button>
    </div>
    <p class="ai-meta">ports · WAN · SFP+. It becomes a full device — clickable ports, VLANs, faceplate label, exports.</p>`);
  document.getElementById('ai-mk').onclick = () => {
    const key = registerCustomDevice({
      label: q,
      mount: document.getElementById('ai-mk-mount').value,
      uh: document.getElementById('ai-mk-uh').value,
      ports: document.getElementById('ai-mk-ports').value,
      wan: document.getElementById('ai-mk-wan').value,
      sfp: document.getElementById('ai-mk-sfp').value
    }, q);
    setMode('place', key);
    aiPrint(`<p><b>${DEVICE_TYPES[key].label}</b> added to the library — placement armed, click where it mounts.</p>`);
  };
}

document.getElementById('ai-adddev').onclick = async () => {
  const q = document.getElementById('ai-devq').value.trim();
  if (!q) { aiPrint('<p>Type a device name first — e.g. “Catalyst 9300 48-port”.</p>'); return; }
  const ql = q.toLowerCase();
  const hit = Object.entries(DEVICE_TYPES).find(([, d]) => d.label.toLowerCase().includes(ql));
  if (hit) {
    setMode('place', hit[0]);
    aiPrint(`<p><b>${hit[1].label}</b> is already in the library — placement armed, click where it mounts.</p>`);
    return;
  }
  aiPrint('<p>Not in the library — asking the local model for real install specs…</p>');
  try {
    const model = document.getElementById('ai-model').value.trim() || 'llama3';
    const r = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, stream: false,
        messages: [
          { role: 'system', content: 'You output ONLY a JSON object. No prose, no markdown.' },
          { role: 'user', content: `Physical install spec for the network device "${q}". Keys: label (full product name), brand, mount ("rack"|"wall"|"ceiling"|"desk"), uh (rack units, integer), ports (total ethernet ports incl. uplinks, integer), wan (integer), sfp (SFP/SFP+ port count, integer), depth_in (chassis depth in inches, integer).` }
        ]
      })
    });
    const j = await r.json();
    const txt = (j.message && j.message.content) || '';
    const spec = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    const key = registerCustomDevice(spec, q);
    const d = DEVICE_TYPES[key];
    setMode('place', key);
    aiPrint(`<h4 class="ai-note">${d.label} added</h4><p>${d.field ? d.mounts.join('/') + ' mount' : d.uh + 'U rack-mount'} · ${d.ports} ports${d.wan ? ' · ' + d.wan + ' WAN' : ''}${d.sfp ? ' · ' + d.sfp + ' SFP+' : ''}. Filed under “${d.cat}”, saved with the map. Placement armed — click where it mounts.</p>`);
  } catch (e) {
    manualDeviceForm(q);
  }
};

async function askLocalAI() {
  const prompt = document.getElementById('ai-prompt').value.trim() || 'Review this network design and suggest improvements.';
  const model = document.getElementById('ai-model').value.trim() || 'llama3';
  aiPrint('<p>Asking local model…</p>');
  const summary = state.devices.slice(0, 80).map(d => {
    const def = DEVICE_TYPES[d.type];
    return `${d.name} (${def.label}${d.ip ? ', ' + d.ip : ''})`;
  }).join('; ');
  const cables = state.cables.slice(0, 120).map(c => {
    const a = deviceById(c.a.deviceId), b = deviceById(c.b.deviceId);
    return `${a ? a.name : '?'}:${c.a.port}->${b ? b.name : '?'}:${c.b.port} ${(c.lengthIn / 12).toFixed(0)}ft`;
  }).join('; ');
  try {
    const r = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, stream: false,
        messages: [
          { role: 'system', content: 'You are a network design reviewer inside a 3D network planning tool. Be concise and practical.' },
          { role: 'user', content: `Devices: ${summary}\nCables: ${cables}\n\n${prompt}` }
        ]
      })
    });
    const j = await r.json();
    aiPrint(`<div class="ai-reply">${(j.message && j.message.content || 'No reply.').replace(/\n/g, '<br>')}</div>`);
  } catch (e) {
    aiPrint('<p class="ai-bad">No local AI reachable at localhost:11434.</p><p>Install <b>Ollama</b> (ollama.com), run <code>ollama pull llama3</code>, and try again. The Analyze and Auto-design buttons work fully offline without it.</p>');
  }
}
document.getElementById('ai-ask').onclick = askLocalAI;

//////////////////// Build menu (B) — Satisfactory-style tool in hand ////////////////////

let bmenuOpen = false, resumeWalkAfterMenu = false;
const bmenuEl = document.getElementById('bmenu');

function recentDevices() {
  try { return JSON.parse(localStorage.getItem('nm3_recent') || '[]'); } catch (e) { return []; }
}
function recordRecent(type) {
  try {
    const r = recentDevices().filter(t => t !== type);
    r.unshift(type);
    localStorage.setItem('nm3_recent', JSON.stringify(r.slice(0, 8)));
  } catch (e) {}
}
function renderBmenu(q) {
  const box = document.getElementById('bmenu-results');
  const label = document.getElementById('bmenu-label');
  box.innerHTML = '';
  let items;
  if (q.trim()) {
    label.textContent = 'Devices';
    const ql = q.trim().toLowerCase();
    items = Object.entries(DEVICE_TYPES)
      .filter(([, d]) => d.label.toLowerCase().includes(ql) || (d.cat || '').toLowerCase().includes(ql))
      .slice(0, 14);
  } else {
    label.textContent = 'Recent';
    items = recentDevices().filter(t => DEVICE_TYPES[t]).map(t => [t, DEVICE_TYPES[t]]);
    if (!items.length) items = [['u_udmpromax', DEVICE_TYPES.u_udmpromax], ['u_promax24', DEVICE_TYPES.u_promax24], ['u_u7pro', DEVICE_TYPES.u_u7pro], ['patch24', DEVICE_TYPES.patch24]];
  }
  for (const [key, def] of items) {
    const el = document.createElement('div');
    el.className = 'lib-item';
    el.innerHTML = `${def.label} <em>${def.cat || ''}</em>`;
    el.onclick = () => { closeBuildMenu(true); setMode('place', key); };
    box.appendChild(el);
  }
}
function openBuildMenu(fromWalk) {
  resumeWalkAfterMenu = !!fromWalk;
  bmenuOpen = true;
  bmenuEl.classList.remove('hidden');
  const s = document.getElementById('bmenu-q');
  s.value = '';
  renderBmenu('');
  setTimeout(() => s.focus(), 30);
}
function closeBuildMenu(chose) {
  bmenuOpen = false;
  bmenuEl.classList.add('hidden');
  if (resumeWalkAfterMenu && chose) renderer.domElement.requestPointerLock();
  resumeWalkAfterMenu = false;
}
document.querySelectorAll('#bmenu-tools [data-tool]').forEach(b => {
  b.onclick = () => { closeBuildMenu(true); setMode(b.dataset.tool); };
});
document.getElementById('bmenu-q').oninput = e => renderBmenu(e.target.value);
document.getElementById('bmenu-q').onkeydown = e => {
  if (e.key === 'Escape') { closeBuildMenu(false); }
  if (e.key === 'Enter') {
    const first = document.querySelector('#bmenu-results .lib-item');
    if (first) first.onclick();
  }
};
bmenuEl.addEventListener('mousedown', e => { if (e.target === bmenuEl) closeBuildMenu(false); });

//////////////////// Scene themes: bright Studio (default) / Dark ops ////////////////////

// Both themes are lit for a real room, not a product render. The old studio
// preset ran exposure 1.26 over a near-white floor, which clipped the highlights
// to paper and flattened every surface — the fastest way to make a 3D scene look
// fake. Mid-gray VCT with the exposure pulled under 1.0 keeps the whole range on
// screen, so shadows, tile seams and gear all read.
// Intensities are for r155+ physically-correct lighting (no legacy π scaling),
// displayed through AgX. Roughly the old numbers ×π, then tuned by screenshot.
const THEMES = {
  studio: {
    bg: 0xc7cfd8, fog: [0xc7cfd8, 620, 1900], hemi: [0xdae6ff, 0x9c9184, 0.7],
    sun: [0xfff4e2, 2.6], rim: 0.5, exposure: 0.82,
    floor: ['#c2c7ce', '#b3b9c1', '#a6acb5', 'rgba(38,44,54,0.42)'],
    gridC: [0x8d959f, 0xa2a9b3], wall: 0xe7e3dc, slab: 0xc2c6cc
  },
  dark: {
    bg: 0x11151b, fog: [0x11151b, 420, 1000], hemi: [0xa9c4f0, 0x2a231b, 0.55],
    sun: [0xffeed6, 2.2], rim: 0.85, exposure: 0.92,
    floor: ['#2b323e', '#232935', '#1b202a', 'rgba(0,0,0,0.55)'],
    gridC: [0x323d4e, 0x27303e], wall: 0xb9bec7, slab: 0xa6abb3
  }
};
let themeName = 'studio';
try { themeName = localStorage.getItem('nm3_theme') || 'studio'; } catch (e) {}

function applyTheme(name) {
  themeName = name;
  const t = THEMES[name];
  scene.background = new THREE.Color(t.bg);
  scene.fog = new THREE.Fog(t.fog[0], t.fog[1], t.fog[2]);
  hemi.color.setHex(t.hemi[0]);
  hemi.groundColor.setHex(t.hemi[1]);
  hemi.intensity = t.hemi[2];
  sun.color.setHex(t.sun[0]);
  sun.intensity = t.sun[1];
  rim.intensity = t.rim;
  renderer.toneMappingExposure = t.exposure;
  if (floorMesh.material.map) floorMesh.material.map.dispose();
  floorMesh.material.map = makeFloorTexture(t.floor);
  floorMesh.material.needsUpdate = true;
  scene.remove(grid);
  grid = new THREE.GridHelper(1200, 100, t.gridC[0], t.gridC[1]);
  grid.position.y = 0.02;
  scene.add(grid);
  wallMat.color.setHex(t.wall);
  for (const m of wallMats) m.color.setHex(t.wall);
  // trim tracks the wall, a touch brighter — it takes no dynamic shadow, so it
  // has to be tied to the theme or it glows in the dark room
  baseboardMat.color.setHex(t.wall);
  baseboardMat.color.offsetHSL(0, 0, 0.02);
  slabMat.color.setHex(t.slab);
  try { localStorage.setItem('nm3_theme', name); } catch (e) {}
  const b = document.getElementById('btn-theme');
  if (b) b.textContent = name === 'studio' ? 'Dark' : 'Light';
}
document.getElementById('btn-theme').onclick = () => applyTheme(themeName === 'studio' ? 'dark' : 'studio');
applyTheme(themeName);

//////////////////// Projects: real files in a folder you choose ////////////////////
// Like Word/Docs: pick a "NetMap3D Projects" folder once and every project is a
// .json file in it — visible in Finder/Explorer, autosaved every 30 s.
// Falls back to in-app storage when the File System Access API isn't available.

let currentProject = null;
let projectsDir = null; // FileSystemDirectoryHandle
const launcherEl = document.getElementById('launcher');
const projNameEl = document.getElementById('proj-name');
const safeFile = n => n.replace(/[\\/:*?"<>|]/g, '_') + '.json';

function idbGet(key) {
  return new Promise(res => {
    try {
      const rq = indexedDB.open('nm3fs', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
      rq.onsuccess = () => {
        const tx = rq.result.transaction('kv', 'readonly');
        const g = tx.objectStore('kv').get(key);
        g.onsuccess = () => res(g.result || null);
        g.onerror = () => res(null);
      };
      rq.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
function idbSet(key, val) {
  return new Promise(res => {
    try {
      const rq = indexedDB.open('nm3fs', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
      rq.onsuccess = () => {
        const tx = rq.result.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = () => res(true);
        tx.onerror = () => res(false);
      };
      rq.onerror = () => res(false);
    } catch (e) { res(false); }
  });
}

function lsStore() { try { return JSON.parse(localStorage.getItem('nm3_projects') || '{}'); } catch (e) { return {}; } }
function lsStoreSet(s) { try { localStorage.setItem('nm3_projects', JSON.stringify(s)); } catch (e) {} }

async function listProjects() {
  if (projectsDir) {
    const out = [];
    try {
      for await (const [name, h] of projectsDir.entries()) {
        if (h.kind === 'file' && name.endsWith('.json')) {
          const f = await h.getFile();
          out.push({ name: name.replace(/\.json$/, ''), t: f.lastModified });
        }
      }
    } catch (e) { /* permission lapsed */ }
    return out.sort((a, b) => b.t - a.t);
  }
  const s = lsStore();
  return Object.keys(s).map(n => ({ name: n, t: s[n].t })).sort((a, b) => b.t - a.t);
}
async function readProjectData(name) {
  if (projectsDir) {
    const h = await projectsDir.getFileHandle(safeFile(name));
    return await (await h.getFile()).text();
  }
  const s = lsStore();
  return s[name] ? s[name].data : null;
}
async function writeProjectData(name, data) {
  if (projectsDir) {
    const h = await projectsDir.getFileHandle(safeFile(name), { create: true });
    const w = await h.createWritable();
    await w.write(data);
    await w.close();
    return;
  }
  const s = lsStore();
  s[name] = { t: Date.now(), data };
  lsStoreSet(s);
}
async function removeProject(name) {
  if (projectsDir) { try { await projectsDir.removeEntry(safeFile(name)); } catch (e) {} return; }
  const s = lsStore();
  delete s[name];
  lsStoreSet(s);
}

async function saveProject(quiet) {
  if (!currentProject) return;
  try {
    await writeProjectData(currentProject, serialize());
    if (!quiet) setStatus(`Project “${currentProject}” saved${projectsDir ? ' to your projects folder' : ''}.`);
  } catch (e) {
    if (!quiet) setStatus('Save failed — reconnect your projects folder from the Projects screen.');
  }
}
function setProject(name) {
  currentProject = name;
  projNameEl.textContent = name || '';
  launcherEl.classList.add('hidden');
  undoStack.length = 0;
  maybeShowHelp();
}

async function renderLauncher() {
  const folderLine = document.getElementById('launch-folder');
  if (window.showDirectoryPicker) {
    folderLine.innerHTML = projectsDir
      ? `Saving into folder: <b>${projectsDir.name}</b> · <a href="#" id="launch-pickdir">change</a>`
      : `Projects currently save inside the app. <a href="#" id="launch-pickdir">Choose a folder on your computer…</a>`;
    document.getElementById('launch-pickdir').onclick = async ev => {
      ev.preventDefault();
      try {
        projectsDir = await window.showDirectoryPicker({ mode: 'readwrite' });
        await idbSet('dir', projectsDir);
        renderLauncher();
      } catch (e) { /* cancelled */ }
    };
  } else {
    folderLine.textContent = 'Projects save inside the app (this browser cannot write folders). Use Export for files.';
  }
  const list = document.getElementById('launch-list');
  const items = await listProjects();
  list.innerHTML = items.length ? '' : '<p class="l-empty">No saved projects yet — start a new one.</p>';
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'l-row';
    row.innerHTML = `<div><b></b><span>${new Date(it.t).toLocaleString()}</span></div>
      <div class="l-btns"><button data-a="open">Open</button><button data-a="export">Export</button><button data-a="del" class="l-danger">Delete</button></div>`;
    row.querySelector('b').textContent = it.name;
    row.querySelector('[data-a=open]').onclick = async () => {
      const data = await readProjectData(it.name);
      if (!data) { setStatus('Could not read that project.'); return; }
      restore(data);
      setProject(it.name);
      setStatus(`Project “${it.name}” opened.`);
    };
    row.querySelector('[data-a=export]').onclick = async () => {
      const data = await readProjectData(it.name);
      if (data) downloadBlob(data, it.name + '.json', 'application/json');
    };
    row.querySelector('[data-a=del]').onclick = async () => {
      if (!confirm(`Delete project “${it.name}”?`)) return;
      await removeProject(it.name);
      renderLauncher();
    };
    list.appendChild(row);
  }
}
async function openLauncher() {
  await saveProject(true);
  if (!projectsDir && window.showDirectoryPicker) {
    const h = await idbGet('dir');
    if (h) {
      try {
        const perm = await h.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') projectsDir = h;
        else if (perm === 'prompt' && (await h.requestPermission({ mode: 'readwrite' })) === 'granted') projectsDir = h;
      } catch (e) {}
    }
  }
  document.getElementById('launcher-close').classList.toggle('hidden', !currentProject);
  await renderLauncher();
  launcherEl.classList.remove('hidden');
}
document.getElementById('launch-new').onclick = async () => {
  const name = (prompt('Project name:', 'New Site') || '').trim();
  if (!name) return;
  clearScene();
  setProject(name);
  await saveProject(true);
  setStatus(`Project “${name}” — draw the building with Room/Wall, or drop a rack to begin.`);
};
document.getElementById('launch-sample').onclick = () => {
  clearScene();
  referenceSite();
  setProject('Sample Project');
  setStatus('Sample project — a complete working site to explore and edit.');
};
document.getElementById('launch-import').onclick = () => {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json';
  inp.onchange = () => {
    const f = inp.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => {
      restore(rd.result);
      const name = (prompt('Name this project:', f.name.replace(/\.json$/, '')) || 'Imported Site').trim();
      setProject(name);
      await saveProject(true);
    };
    rd.readAsText(f);
  };
  inp.click();
};
document.getElementById('launcher-close').onclick = () => {
  if (currentProject) launcherEl.classList.add('hidden');
};
setInterval(() => saveProject(true), 30000);
window.addEventListener('beforeunload', () => saveProject(true));

//////////////////// Help overlay ////////////////////

const helpEl = document.getElementById('help');
document.getElementById('btn-help').onclick = () => helpEl.classList.remove('hidden');
document.getElementById('help-close').onclick = () => {
  helpEl.classList.add('hidden');
  try { localStorage.setItem('nm3_seenHelp', '1'); } catch (e) { /* file:// may block storage */ }
};
function maybeShowHelp() {
  try { if (!localStorage.getItem('nm3_seenHelp')) helpEl.classList.remove('hidden'); } catch (e) {}
}

//////////////////// Demo scene ////////////////////

// A fully worked reference installation: correct VLAN-to-subnet design, a
// gateway routing between them on SVIs, structured cabling landing on the patch
// panel rear with short leads to the switch. Everything here is how it would be
// built on site — it is a starting point to edit, not a showcase.
function referenceSite() {
  const rack = { id: uid(), x: 0, z: 0, rotY: 0, name: 'Rack-1' };
  state.racks.push(rack);
  buildRackGroup(rack);

  const mk = (type, u, extra = {}) => {
    const d = DEVICE_TYPES[type].field
      ? { id: uid(), type, name: deviceLabelCounter(type), ...extra }
      : { id: uid(), type, rackId: rack.id, u, name: deviceLabelCounter(type), ...extra };
    state.devices.push(d);
    buildDeviceGroup(d);
    return d;
  };
  const patch = mk('patch24', 42);
  const hcm1 = mk('hcm', 41);
  const sw = mk('switch48', 40, { ip: '10.0.0.2' });
  const rtr = mk('router', 38, { ip: '10.0.0.1' });
  // Core gateway. It routes between VLANs on SVIs — one interface per VLAN, each
  // holding the .1 of that subnet. That is what makes it the default gateway for
  // those subnets; a router merely sitting on the wire routes nothing.
  // One scope per VLAN, not one pool per device — each carries its own range,
  // lease and options. Lease lengths follow real practice: a day for wired
  // staff, half a day for transient wireless clients, a week for cameras that
  // never move. The .1–.99 of every subnet is excluded for static infrastructure.
  const udm = mk('u_udmpromax', 35, { ip: '10.0.0.254', notes: 'core gateway',
    svi: { 10: '10.0.10.1/24', 20: '10.0.20.1/24', 30: '10.0.30.1/24' },
    dhcp: { enabled: true,
      excluded: [{ from: '10.0.10.1', to: '10.0.10.99' },
                 { from: '10.0.20.1', to: '10.0.20.99' },
                 { from: '10.0.30.1', to: '10.0.30.99' }],
      pools: [
        { name: 'SERVERS', network: '10.0.10.0/24', poolStart: '10.0.10.100', poolEnd: '10.0.10.200',
          lease: { days: 1, hours: 0, minutes: 0 }, defaultRouter: '10.0.10.1',
          dns: ['10.0.10.5', '1.1.1.1'], domain: 'corp.local', tftp: '', reservations: [] },
        { name: 'WIFI', network: '10.0.20.0/24', poolStart: '10.0.20.100', poolEnd: '10.0.20.200',
          lease: { days: 0, hours: 12, minutes: 0 }, defaultRouter: '10.0.20.1',
          dns: ['10.0.10.5', '1.1.1.1'], domain: 'corp.local', tftp: '', reservations: [] },
        { name: 'CCTV', network: '10.0.30.0/24', poolStart: '10.0.30.100', poolEnd: '10.0.30.200',
          lease: { days: 7, hours: 0, minutes: 0 }, defaultRouter: '10.0.30.1',
          dns: ['10.0.10.5'], domain: 'corp.local', tftp: '', reservations: [] }
      ] } });
  const pmax = mk('u_promax24', 33, { ip: '10.0.0.4', notes: 'Etherlighting demo' });
  mk('firewall', 37, { ip: '10.0.0.254' });
  const srv = mk('server', 20, { ip: '10.0.10.5', gateway: '10.0.10.1' });
  const ups1 = mk('ups', 1);
  mk('vcm', 0, { side: 'R' });
  const ap1 = mk('ap', 0, { x: 66, z: -36, ip: '10.0.20.11', gateway: '10.0.20.1', notes: 'VLAN 20 - WiFi' });
  const cam1 = mk('camera', 0, { x: -60, z: -48, ip: '10.0.30.21', gateway: '10.0.30.1', notes: 'VLAN 30 - CCTV' });

  // walls with a drilled pass-through, a wall-mounted camera, and an AP beyond the wall
  const wallA = { id: uid(), x1: -144, z1: -84, x2: 144, z2: -84, h: WALL_H };
  const wallB = { id: uid(), x1: -144, z1: -84, x2: -144, z2: 120, h: WALL_H };
  state.walls.push(wallA, wallB);
  buildWall(wallA); buildWall(wallB);
  const hole1 = { id: uid(), wallId: wallA.id, x: -30, y: 80, z: -84, nx: 0, nz: 1 };
  state.holes.push(hole1);
  buildHole(hole1);
  const wallCam = mk('camera', 0, { mount: 'wall', x: 50, y: 84, z: -81.6, rotY: 0, ip: '10.0.30.22', gateway: '10.0.30.1', notes: 'VLAN 30 - CCTV' });
  const apFar = mk('ap', 0, { x: -30, z: -170, ip: '10.0.20.12', gateway: '10.0.20.1', notes: 'VLAN 20 - warehouse' });

  // a planned-only device and link for the 2D view
  state.devices.push({ id: uid(), type: 'switch24', name: 'Switch-IDF', ip: '10.0.0.3', notes: 'planned IDF closet' });
  state.links.push({ id: uid(), aId: rtr.id, bId: sw.id });

  // upstairs: a level-2 slab with an AP, plus an office corner downstairs
  const slab2 = { id: uid(), x1: -160, z1: -60, x2: -40, z2: 100, y: 120 };
  state.slabs.push(slab2);
  buildSlab(slab2);
  const apUp = mk('u_u7pro', 0, { x: -100, z: 20, y0: 120, ip: '10.0.20.13', gateway: '10.0.20.1', notes: 'Level 2 WiFi' });
  // front desk PC leases from the gateway — shows DHCP working out of the box
  const ws1 = mk('o_ws', 0, { x: 80, z: 30, rotY: -0.7, ip: 'dhcp', notes: 'front desk PC (DHCP)' });
  mk('o_chair', 0, { x: 92, z: 44, rotY: 2.4 });
  mk('person', 0, { x: 40, z: 60 });

  const hcmG = deviceGroups.get(hcm1.id);
  hcmG.updateWorldMatrix(true, false);
  const wp = hcmG.localToWorld(new THREE.Vector3(0, 0, 2.2));

  // a port argument is either a plain number (front jack) or [number, side]
  const mkCable = (a, ap, b, bp, color, wps = []) => {
    const ep = (dev, p) => Array.isArray(p)
      ? { deviceId: dev.id, port: p[0], side: p[1] }
      : { deviceId: dev.id, port: p, side: FRONT };
    const c = { id: uid(), a: ep(a, ap), b: ep(b, bp), color, waypoints: wps };
    state.cables.push(c);
    buildCableMesh(c);
  };
  // Structured cabling the way it is actually installed. Every horizontal run
  // from a field device terminates on the BACK of the patch panel and never
  // touches the switch; a short patch lead on the FRONT jumps that same port
  // number across to a switch port. Re-patching a drop is then a 6" lead swap,
  // not a re-pull — which is the entire reason the panel is in the rack.
  // dressed down the back, each run on its own vertical line like a real bundle
  const rearWp = (n) => ({ x: 2 + n * 1.4, y: RACK_BASE + 41.5 * U, z: -RACK_D / 2 - 3 });
  // wps empty = let the auto-router take it up into the plenum and across
  const drops = [
    [1, sw, 1,  ap1,     '#eab308', []],
    [2, sw, 26, cam1,    '#a855f7', []],
    [3, sw, 12, wallCam, '#f97316', []],
    // this one is hand-routed through the drilled hole in wall A to the warehouse AP
    [4, sw, 14, apFar,   '#22c55e', [{ x: -30, y: 80, z: -81 }, { x: -30, y: 80, z: -87 }]],
    [5, sw, 18, apUp,    '#eab308', []]
  ];
  for (const [p, swDev, swPort, field, color, wps] of drops) {
    mkCable(swDev, swPort, patch, p, '#3b82f6', [{ x: wp.x - 8 + p * 3, y: wp.y, z: wp.z }]);
    mkCable(patch, [p, REAR], field, 1, color, wps.length ? [rearWp(p), ...wps] : []);
  }
  // in-rack and adjacent gear patches straight to the switch — no panel needed
  mkCable(sw, 42, srv, 1, '#22c55e');
  mkCable(sw, 17, ws1, 1, '#3b82f6');
  // Gateway uplink. This is a trunk: it has to carry every VLAN the gateway
  // routes for, otherwise the SVI for a missing VLAN is unreachable and that
  // subnet has no default gateway.
  mkCable(sw, 2, udm, 1, '#e5e7eb');

  // Port VLAN assignment. Each access port is placed in the VLAN matching the
  // subnet of the device on it — one VLAN per subnet, which is the design the
  // gateway's SVIs assume. Without this every device sits in VLAN 1 and the
  // separation the addressing implies would be fictional.
  const setAccess = (dev, port, vlan) => {
    dev.portCfg = dev.portCfg || {};
    dev.portCfg[port] = { ...(dev.portCfg[port] || {}), vlan: String(vlan) };
  };
  // port -> VLAN, matched to the subnet of the device actually on that port:
  //   42 server 10.0.10.5 · 17 workstation (DHCP 10.0.10.x)      -> VLAN 10
  //   1 AP-1 .20.11 · 18 AP upstairs .20.13 · 14 AP warehouse .20.12 -> VLAN 20
  //   26 Cam-1 .30.21 · 12 wall camera .30.22                    -> VLAN 30
  const VLAN_OF = { 10: [42, 17], 20: [1, 18, 14], 30: [26, 12] };
  for (const [vlan, ports] of Object.entries(VLAN_OF)) {
    for (const p of ports) setAccess(sw, p, vlan);
  }
  // The VLAN database. A port cannot be put in a VLAN that does not exist, so
  // both ends of the trunk have to know all three.
  const VLANS = [{ id: 10, name: 'SERVERS' }, { id: 20, name: 'WIFI' }, { id: 30, name: 'CCTV' }];
  sw.vlans = VLANS.map(v => ({ ...v }));
  udm.vlans = VLANS.map(v => ({ ...v }));
  // The uplink is an explicit trunk: VLAN 10 native (untagged), 20 and 30
  // tagged. Both ends must agree on the native VLAN or traffic silently
  // crosses between VLANs.
  sw.portCfg[2] = { mode: 'trunk', native: '10', tagged: '20,30' };
  udm.portCfg = udm.portCfg || {};
  udm.portCfg[1] = { mode: 'trunk', native: '10', tagged: '20,30' };
  // power cords: rear inlets → UPS outlets, like a real rack
  mkCable(sw, 'PWR', ups1, 1, '#111827');
  mkCable(udm, 'PWR', ups1, 2, '#111827');
  mkCable(pmax, 'PWR', ups1, 3, '#111827');
  setStatus('Reference site loaded — field runs land on the patch panel REAR, short leads patch the FRONT to the switch. Hover any port to see both faces.');
}

// boot into the project launcher — no auto-loaded demo
applyLevelVisibility();   // settle work plane / grade before anything loads
updateOptionBar();        // show the starting tool's options
openLauncher();

// debug/verification handle (used by the automated physics test harness)
window.__nm3debug = {
  ropes, cableMeshes, getState: () => state,
  colliders: () => ({ dirty: collidersDirty, count: ropeColliders.length, holes: holeZones.length })
};

//////////////////// Render loop ////////////////////

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (composer) {
    composer.setSize(innerWidth, innerHeight);
    if (fxaaPass) fxaaPass.material.uniforms.resolution.value.set(1 / innerWidth, 1 / innerHeight);
  }
});

const clock = new THREE.Clock();
(function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (walkActive) {
    const speed = (walkKeys['ShiftLeft'] || walkKeys['ShiftRight']) ? 190 : 68;
    const fwd = new THREE.Vector3(-Math.sin(walkYaw), 0, -Math.cos(walkYaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const v = new THREE.Vector3();
    if (walkKeys['KeyW']) v.add(fwd);
    if (walkKeys['KeyS']) v.sub(fwd);
    if (walkKeys['KeyD']) v.add(right);
    if (walkKeys['KeyA']) v.sub(right);
    if (v.lengthSq()) camera.position.addScaledVector(v.normalize(), speed * dt);
    if (flyMode) {
      if (walkKeys['Space']) camera.position.y += speed * dt;
      if (walkKeys['KeyC']) camera.position.y -= speed * dt;
      camera.position.y = Math.max(6, camera.position.y);
    } else {
      // Grounded walking with a jump. Floor height is whichever is higher under
      // you — the slab you're standing on, or a stair tread. Taking the max is
      // what makes a stair climbable in both directions without any special
      // case: walking up, the tread wins; walking off the top, the slab does.
      const floorY = groundAt(camera.position.x, camera.position.z, camera.position.y - 30);
      const stepY = stairHeightAt(camera.position.x, camera.position.z, camera.position.y - 30);
      const eye = Math.max(floorY, stepY) + EYE_H;
      if (walkKeys['Space'] && camera.position.y <= eye + 0.01) walkVy = 105;
      walkVy -= 420 * dt;
      camera.position.y += walkVy * dt;
      if (camera.position.y <= eye) { camera.position.y = eye; walkVy = 0; }
    }
    // crosshair interaction: hover whatever you're looking at, every frame
    raycaster.setFromCamera(_centerNDC, camera);
    updateHover(innerWidth / 2, innerHeight / 2 + 26);
  } else {
    controls.update();
    if (camTween) {
      camTween.k = Math.min(1, camTween.k + dt * 2.2);
      const s = camTween.k * camTween.k * (3 - 2 * camTween.k);
      camera.position.lerpVectors(camTween.p0, camTween.p1, s);
      controls.target.lerpVectors(camTween.t0, camTween.t1, s);
      if (camTween.k >= 1) camTween = null;
    }
  }
  if (physOn) stepRopes(dt);
  if (simOn) updatePulses(dt);
  if (planOpen) drawPlan();
  if (composer) {
    try { composer.render(); } catch (err) { composer = null; }
  }
  if (!composer) renderer.render(scene, camera);
})();
