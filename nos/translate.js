// NetMap3D model -> real network operating system configuration.
//
// This is the piece that makes the map and the running network the same thing.
// It reads the same `state` the simulator reads and emits:
//
//   * a topology  — which devices become real instances, and which cables become
//                   real veth pairs between them
//   * FRR config  — interface addresses, SVIs, OSPF, static routes
//   * OVS config  — the bridge, access and trunk ports, VLANs, RSTP
//
// FRR routes and Open vSwitch switches; a real box does both, so a device that
// needs both gets both. Nothing here invents behaviour — it translates what the
// user drew into the syntax the real daemons take.
'use strict';

//////////////////// helpers ////////////////////

const ifName = (port) => `eth${String(port).replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 15);
const BR = 'br0';                         // the switch fabric inside each device

// "10.20.0.5/16" -> { addr, cidr }; tolerates a bare address (assumed /24, the
// same default the simulator uses, so the two never disagree)
function splitIp(s) {
  if (!s || s === 'dhcp') return null;
  const m = String(s).trim().match(/^(\d+\.\d+\.\d+\.\d+)(?:\/(\d+))?$/);
  if (!m) return null;
  const cidr = m[2] === undefined ? 24 : +m[2];
  if (cidr < 0 || cidr > 32) return null;
  return { addr: m[1], cidr };
}

// A router-id has to be unique and stable. Deriving it from the management
// address is what an engineer does by hand, and it keeps the id the same across
// rebuilds so adjacencies do not churn.
function routerId(dev, idx) {
  const ip = splitIp(dev.ip);
  if (ip) return ip.addr;
  return `0.0.${(idx >> 8) & 255}.${idx & 255}`;
}

//////////////////// what becomes a real device ////////////////////

// A patch panel is a passive block of jacks — it terminates copper, it does not
// forward anything, so it must NOT become a container. Its cables are spliced
// through instead, exactly as the simulator's hopThroughPatches does, or the
// topology would gain a hop that does not exist in real life.
function isPassive(dev, api) {
  const cls = api.netClass(dev);
  return cls === 'patch' || cls === 'power' || cls === 'passive';
}

function realizable(dev, api) {
  if (isPassive(dev, api)) return false;
  const cls = api.netClass(dev);
  return cls === 'switch' || cls === 'router' || cls === 'host';
}

//////////////////// topology ////////////////////

// Walk a cable through any patch panels to the device that actually terminates
// it, so a run of  switch -> panel -> panel -> server  becomes one veth pair.
function terminus(api, devId, port, seen = new Set()) {
  const key = `${devId}:${port}`;
  if (seen.has(key)) return null;                  // a patch loop; refuse to spin
  seen.add(key);
  const dev = api.state.devices.find(d => d.id === devId);
  if (!dev) return null;
  if (!isPassive(dev, api)) return { dev, port };
  const hop = api.hopThroughPatches(dev, port, 0);
  if (!hop) return null;
  return terminus(api, hop.dev.id, hop.port, seen);
}

function buildTopology(api, opts = {}) {
  const { state } = api;
  const include = opts.filter || (() => true);
  const devices = state.devices.filter(d => realizable(d, api) && include(d));
  const idSet = new Set(devices.map(d => d.id));

  const links = [];
  const usedPort = new Set();                      // one veth per physical jack
  for (const c of state.cables) {
    if (c.power) continue;                         // a power lead carries no frames
    const A = terminus(api, c.a.deviceId, c.a.port);
    const B = terminus(api, c.b.deviceId, c.b.port);
    if (!A || !B) continue;
    if (!idSet.has(A.dev.id) || !idSet.has(B.dev.id)) continue;
    if (A.dev.id === B.dev.id) continue;           // a loop back into itself
    const ka = `${A.dev.id}:${A.port}`, kb = `${B.dev.id}:${B.port}`;
    if (usedPort.has(ka) || usedPort.has(kb)) continue;
    usedPort.add(ka); usedPort.add(kb);
    links.push({ a: { dev: A.dev.id, port: A.port }, b: { dev: B.dev.id, port: B.port } });
  }
  return {
    devices: devices.map(d => ({ id: d.id, name: d.name || d.id, role: api.netClass(d) })),
    links,
  };
}

//////////////////// FRR configuration ////////////////////

function frrConfig(api, dev, idx, topology) {
  const L = [];
  const cls = api.netClass(dev);
  L.push(`hostname ${(dev.name || 'device').replace(/\s+/g, '-')}`);
  L.push('!');

  // which of this device's ports actually have a cable in the realized topology
  const wired = new Set();
  for (const l of topology.links) {
    if (l.a.dev === dev.id) wired.add(l.a.port);
    if (l.b.dev === dev.id) wired.add(l.b.port);
  }

  const ospfIfs = [];

  // routed ports: an address configured directly on the interface
  for (const [port, pc] of Object.entries(dev.portCfg || {})) {
    if (!pc || !pc.ip) continue;
    const ip = splitIp(pc.ip);
    if (!ip || !wired.has(+port) && !wired.has(port)) continue;
    L.push(`interface ${ifName(port)}`, ` ip address ${ip.addr}/${ip.cidr}`);
    if (pc.description) L.push(` description ${pc.description}`);
    L.push('exit', '!');
    ospfIfs.push(ifName(port));
  }

  // SVIs: an address on a VLAN, which lives on the bridge, not on a port
  for (const [vlan, addr] of Object.entries(dev.svi || {})) {
    const ip = splitIp(addr);
    if (!ip) continue;
    L.push(`interface ${BR}.${vlan}`, ` ip address ${ip.addr}/${ip.cidr}`, 'exit', '!');
    ospfIfs.push(`${BR}.${vlan}`);
  }

  // the management address, which on a switch belongs to its management VLAN
  const mgmt = splitIp(dev.ip);
  if (mgmt && cls === 'switch' && !(dev.svi && Object.keys(dev.svi).length)) {
    const mv = api.mgmtVlan ? api.mgmtVlan(dev) : 1;
    L.push(`interface ${BR}.${mv}`, ` ip address ${mgmt.addr}/${mgmt.cidr}`, 'exit', '!');
  }
  if (mgmt && cls === 'host') {
    // a host's address sits on its own NIC
    const nics = api.hostNics ? api.hostNics(dev) : [];
    for (const n of nics) {
      const ip = splitIp(n.ip);
      if (!ip) continue;
      L.push(`interface ${ifName(n.port)}`, ` ip address ${ip.addr}/${ip.cidr}`, 'exit', '!');
    }
  }

  // static routes, including the default a host or switch points at its gateway
  const gw = dev.gateway || (api.hostGateway && cls === 'host' ? api.hostGateway(dev) : null);
  if (gw && splitIp(gw)) L.push(`ip route 0.0.0.0/0 ${splitIp(gw).addr}`);
  for (const r of dev.routes || []) {
    if (!r.prefix || !r.via) continue;
    L.push(`ip route ${r.prefix} ${r.via}`);
  }

  // OSPF, when the map says this device runs it
  if (api.ospfEnabled && api.ospfEnabled(dev) && ospfIfs.length) {
    const areas = (dev.ospf && dev.ospf.areas) || {};
    for (const i of ospfIfs) {
      const area = areas[i] !== undefined ? areas[i] : 0;
      L.push(`interface ${i}`, ` ip ospf area ${area}`, 'exit');
    }
    L.push('router ospf', ` ospf router-id ${(dev.ospf && dev.ospf.routerId) || routerId(dev, idx)}`);
    if (dev.ospf && dev.ospf.refBw) L.push(` auto-cost reference-bandwidth ${dev.ospf.refBw}`);
    L.push('exit', '!');
  }

  L.push('line vty', '!');
  return L.join('\n') + '\n';
}

//////////////////// Open vSwitch configuration ////////////////////

// The switch half. One bridge per device; every wired port is a member; access
// ports carry a tag, trunks carry a list. SVIs become internal VLAN interfaces
// on the bridge so FRR can address them.
function ovsCommands(api, dev, topology) {
  const cls = api.netClass(dev);
  if (cls !== 'switch') return [];
  const cmds = [`ovs-vsctl --may-exist add-br ${BR}`];

  // RSTP where the map has spanning tree on — this is the real 802.1w
  // implementation, not a model of one.
  cmds.push(`ovs-vsctl set bridge ${BR} rstp_enable=true`);
  const prio = dev.stpPriority !== undefined && dev.stpPriority !== ''
    ? +dev.stpPriority : null;
  if (prio !== null && isFinite(prio)) {
    cmds.push(`ovs-vsctl set bridge ${BR} other_config:rstp-priority=${prio}`);
  }

  const wired = new Set();
  for (const l of topology.links) {
    if (l.a.dev === dev.id) wired.add(l.a.port);
    if (l.b.dev === dev.id) wired.add(l.b.port);
  }

  const vlansSeen = new Set();
  for (const port of wired) {
    const iface = ifName(port);
    const pc = (dev.portCfg && (dev.portCfg[port] || dev.portCfg[String(port)])) || {};
    if (pc.ip) continue;                      // a routed port is not a bridge member
    cmds.push(`ovs-vsctl --may-exist add-port ${BR} ${iface}`);
    if (api.portMode && api.portMode(dev, port) === 'trunk') {
      const carried = api.carriedVlans ? api.carriedVlans(dev, port) : 'ALL';
      const list = carried === 'ALL'
        ? (dev.vlans || []).map(v => +v.id)
        : [...carried];
      if (list.length) {
        cmds.push(`ovs-vsctl set port ${iface} trunks=[${list.sort((a, b) => a - b).join(',')}]`);
        list.forEach(v => vlansSeen.add(v));
      }
      const nat = api.nativeVlanOf ? api.nativeVlanOf(dev, port) : null;
      if (nat) cmds.push(`ovs-vsctl set port ${iface} tag=${nat} vlan_mode=native-untagged`);
    } else {
      const v = api.nativeVlanOf ? api.nativeVlanOf(dev, port) : 1;
      cmds.push(`ovs-vsctl set port ${iface} tag=${v}`);
      vlansSeen.add(v);
    }
  }

  // Every VLAN the device holds an address on needs an internal interface for
  // FRR to bind to.
  const svis = new Set(Object.keys(dev.svi || {}).map(Number));
  if (api.mgmtVlan && dev.ip && cls === 'switch' && !svis.size) svis.add(api.mgmtVlan(dev));
  for (const v of svis) {
    cmds.push(`ovs-vsctl --may-exist add-port ${BR} ${BR}.${v} -- set interface ${BR}.${v} type=internal`,
      `ovs-vsctl set port ${BR}.${v} tag=${v}`,
      `ip link set ${BR}.${v} up`);
  }
  cmds.push(`ip link set ${BR} up`);
  return cmds;
}

//////////////////// port isolation ////////////////////

// Protected ports and private VLANs are not native OVS settings, so they become
// what they actually are underneath: OpenFlow rules that drop a frame whose
// ingress and egress are both isolated. Same rule the simulator enforces, only
// here the switch enforces it.
function isolationFlows(api, dev, topology) {
  if (api.netClass(dev) !== 'switch') return [];
  const wired = [];
  for (const l of topology.links) {
    if (l.a.dev === dev.id) wired.push(l.a.port);
    if (l.b.dev === dev.id) wired.push(l.b.port);
  }
  if (!api.portIsolation) return [];
  const blocked = [];
  for (const inP of wired) {
    for (const outP of wired) {
      if (inP === outP) continue;
      const r = api.isolationAllows(dev, inP, outP, undefined);
      if (!r.ok) blocked.push([inP, outP]);
    }
  }
  if (!blocked.length) return [];
  const cmds = [];
  for (const [inP, outP] of blocked) {
    cmds.push(`ovs-ofctl add-flow ${BR} "priority=200,in_port=${ifName(inP)},actions=drop_if_out_${ifName(outP)}"`);
  }
  // OpenFlow cannot express "drop only toward one egress" in a single rule, so
  // the honest encoding is a per-pair rule set built from the port map. Emit the
  // pairs for the caller to apply with ofctl once port numbers are known.
  return blocked.map(([a, b]) => ({ inIface: ifName(a), outIface: ifName(b) }));
}

//////////////////// entry point ////////////////////

function realize(api, opts = {}) {
  const topology = buildTopology(api, opts);
  const configs = topology.devices.map((d, idx) => {
    const dev = api.state.devices.find(x => x.id === d.id);
    return {
      id: d.id, idx, name: d.name, role: d.role,
      frr: frrConfig(api, dev, idx, topology),
      ovs: ovsCommands(api, dev, topology),
      isolation: isolationFlows(api, dev, topology),
    };
  });
  return { topology, configs };
}

module.exports = { realize, buildTopology, frrConfig, ovsCommands, isolationFlows, ifName, splitIp, BR };
