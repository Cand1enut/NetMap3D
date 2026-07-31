// Real network operating systems, wired the way the map says.
//
// Every L3 device in a NetMap3D site becomes a real FRRouting container; every
// cable becomes a real veth pair joining the two containers' network
// namespaces. Nothing here simulates a protocol: OSPF adjacencies form because
// two real ospfd processes exchange real hellos over a real link.
//
// The `ip` commands have to run on the DOCKER HOST, not on the machine driving
// this module. On the Ubuntu server they are the same box. On a Mac the host is
// the Colima VM, so they are relayed through `colima ssh`. That is the only
// difference between dev and deploy.
'use strict';

const { execFile } = require('child_process');

const IMAGE = process.env.NETMAP3D_FRR_IMAGE || 'netmap3d/frr:latest';
const PREFIX = 'nm3d';                 // every object we create is named nm3d-*
const NETNS_DIR = '/var/run/netns';

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 << 20, ...opts }, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; return reject(err); }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

// Are we already on the Docker host, or do we have to hop into a VM to get there?
let _hostMode = null;
async function hostMode() {
  if (_hostMode) return _hostMode;
  try {
    await run('sh', ['-c', 'test -d /sys/class/net && command -v ip >/dev/null && test "$(uname -s)" = Linux']);
    _hostMode = 'local';
  } catch {
    _hostMode = 'colima';
  }
  return _hostMode;
}

// Run a shell command with root on the Docker host.
async function hostExec(script) {
  const mode = await hostMode();
  if (mode === 'local') return run('sh', ['-c', `sudo sh -c ${shq(script)}`]);
  return run('colima', ['ssh', '--', 'sudo', 'sh', '-c', script]);
}
function shq(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

async function docker(args, opts) { return run('docker', args, opts); }

//////////////////// naming ////////////////////
// Container and interface names have hard limits — a Linux interface name is 15
// characters — so devices get a short stable index rather than their UUID.
const cname = (idx) => `${PREFIX}-${idx}`;
const nsname = (idx) => `${PREFIX}${idx}`;

//////////////////// lifecycle ////////////////////

async function imagePresent() {
  try {
    const { stdout } = await docker(['image', 'inspect', IMAGE, '--format', '{{.Id}}']);
    return !!stdout.trim();
  } catch { return false; }
}

async function destroyLab() {
  // containers first, then the netns symlinks they leave behind
  const { stdout } = await docker(['ps', '-aq', '--filter', `name=^${PREFIX}-`]);
  const ids = stdout.split('\n').map(s => s.trim()).filter(Boolean);
  if (ids.length) await docker(['rm', '-f', ...ids]);
  await hostExec(`rm -f ${NETNS_DIR}/${PREFIX}* 2>/dev/null; true`);
  return { removed: ids.length };
}

// topology: { devices: [{ id, name, role }], links: [{ a:{dev,port}, b:{dev,port} }] }
// Returns a map from NetMap3D device id -> the running instance.
async function buildLab(topology, opts = {}) {
  const log = [];
  const t0 = Date.now();
  if (!await imagePresent()) throw new Error(`image ${IMAGE} is not built — run: docker build -f nos/Dockerfile.frr -t ${IMAGE} nos/`);
  if (opts.clean !== false) await destroyLab();

  const devices = topology.devices || [];
  const byId = new Map();
  devices.forEach((d, i) => byId.set(d.id, { ...d, idx: i, ns: nsname(i), container: cname(i) }));

  // 1. start every device with NO network — we supply every interface ourselves,
  //    so there is no stray docker0 path that could carry traffic the map does
  //    not have a cable for.
  for (const d of byId.values()) {
    await docker(['run', '-d', '--name', d.container, '--hostname', (d.name || d.container).slice(0, 63),
      '--network', 'none', '--privileged', '--cap-add', 'NET_ADMIN', '--cap-add', 'SYS_ADMIN',
      '--sysctl', 'net.ipv4.ip_forward=1', IMAGE]);
  }
  log.push(`started ${byId.size} containers in ${Date.now() - t0} ms`);

  // 2. expose each container's netns to iproute2 on the host
  const t1 = Date.now();
  const nsScript = [`mkdir -p ${NETNS_DIR}`];
  for (const d of byId.values()) {
    nsScript.push(`pid=$(docker inspect -f '{{.State.Pid}}' ${d.container}) && ` +
      `ln -sfT /proc/$pid/ns/net ${NETNS_DIR}/${d.ns}`);
    // A fresh network namespace hands you a loopback that is DOWN. No real
    // device boots that way, and OSPF will not advertise a loopback it cannot
    // see up — which silently costs you every router-ID and management prefix.
    nsScript.push(`ip -n ${d.ns} link set lo up`);
  }
  await hostExec(nsScript.join('\n'));
  log.push(`bound ${byId.size} namespaces in ${Date.now() - t1} ms`);

  // 3. one veth pair per cable. The interface inside each container is named for
  //    the port it represents, so generated config and the map agree.
  const t2 = Date.now();
  const linkScript = [];
  let n = 0;
  const wired = [];
  for (const l of topology.links || []) {
    const A = byId.get(l.a.dev), B = byId.get(l.b.dev);
    if (!A || !B) continue;                      // a link to something we did not model
    const ta = `${PREFIX}v${n}a`, tb = `${PREFIX}v${n}b`;
    const ia = ifName(l.a.port), ib = ifName(l.b.port);
    linkScript.push(
      `ip link add ${ta} type veth peer name ${tb}`,
      `ip link set ${ta} netns ${A.ns}`,
      `ip link set ${tb} netns ${B.ns}`,
      `ip -n ${A.ns} link set ${ta} name ${ia}`,
      `ip -n ${B.ns} link set ${tb} name ${ib}`,
      `ip -n ${A.ns} link set ${ia} up`,
      `ip -n ${B.ns} link set ${ib} up`);
    wired.push({ a: `${A.name}:${ia}`, b: `${B.name}:${ib}` });
    n++;
  }
  if (linkScript.length) await hostExec(linkScript.join('\n'));
  log.push(`wired ${n} links in ${Date.now() - t2} ms`);

  return { devices: [...byId.values()], links: wired, log, ms: Date.now() - t0 };
}

// A NetMap3D port number becomes a predictable interface name. Kept under the
// 15-character kernel limit.
function ifName(port) {
  const p = String(port).replace(/[^A-Za-z0-9]/g, '');
  return `eth${p}`.slice(0, 15);
}

//////////////////// configuration ////////////////////

// Push a full FRR config into a device the way `frr-reload` does on real gear:
// the running config becomes the file, and only the delta is applied.
async function applyConfig(idx, confText) {
  const b64 = Buffer.from(confText, 'utf8').toString('base64');
  return docker(['exec', cname(idx), 'sh', '-c',
    `echo ${b64} | base64 -d > /etc/frr/frr.conf && chown frr:frr /etc/frr/frr.conf && ` +
    `/usr/lib/frr/frr-reload.py --reload --stdout /etc/frr/frr.conf 2>&1 | tail -5 || ` +
    `vtysh -f /etc/frr/frr.conf`]);
}

// Run a command in the device's own CLI. This is the real vtysh, so `show ip
// ospf neighbor` prints what the real adjacency state machine believes.
async function vtysh(idx, command) {
  const { stdout } = await docker(['exec', cname(idx), 'vtysh', '-c', command]);
  return stdout;
}

// And the dataplane, for the things vtysh does not own.
async function sh(idx, command) {
  const { stdout } = await docker(['exec', cname(idx), 'sh', '-c', command]);
  return stdout;
}

async function status() {
  const { stdout } = await docker(['ps', '--filter', `name=^${PREFIX}-`,
    '--format', '{{.Names}}\t{{.Status}}']);
  return stdout.split('\n').filter(Boolean).map(l => {
    const [name, st] = l.split('\t');
    return { name, status: st };
  });
}

module.exports = { buildLab, destroyLab, applyConfig, vtysh, sh, status, imagePresent, ifName, cname, IMAGE };
