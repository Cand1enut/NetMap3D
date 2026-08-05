// Randomised network fuzzer — the regression gate.
//
// Runs entirely against the MODEL: it never builds a mesh, a collider or a
// shadow, because these tests are about the simulation, not the picture. That
// is what makes 100,000 iterations take minutes instead of hours.
//
// Every generated site is checked against invariants that must hold for ANY
// topology. When one fails, the site is shrunk to the smallest version that
// still fails and printed with its seed, so it reproduces exactly.
//
// Usage:  node fuzz.js [iterations] [seed]
'use strict';

// deterministic RNG so any failure reproduces from its seed
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Load app.js with just enough of a DOM/THREE shim that its top level runs and
// every engine function becomes available. Nothing here draws.
function loadEngine() {
  const fs = require('fs'), vm = require('vm');
  const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
  const noop = () => {};
  const el = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild: noop, addEventListener: noop, removeEventListener: noop, getContext: () => ctx2d(),
    querySelectorAll: () => [], querySelector: () => null, children: [], dataset: {},
    setAttribute: noop, getAttribute: () => null, focus: noop, click: noop, remove: noop,
    innerHTML: '', textContent: '', value: '', options: [], width: 0, height: 0 });
  // A 2D context real enough for the procedural texture code: correctly sized
  // ImageData, so the height->normal pass has something to write into. Drawing
  // ops are no-ops — the fuzzer never looks at the pixels.
  const ctx2d = (cv) => new Proxy({}, { get: (t, k) => {
    const w = () => Math.max(1, (cv && cv.width) | 0), h = () => Math.max(1, (cv && cv.height) | 0);
    if (k === 'getImageData' || k === 'createImageData')
      return (a, b, c, d) => {
        const iw = (k === 'createImageData' ? (a | 0) : (c | 0)) || w();
        const ih = (k === 'createImageData' ? (b | 0) : (d | 0)) || h();
        return { width: iw, height: ih, data: new Uint8ClampedArray(iw * ih * 4) };
      };
    if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient')
      return () => ({ addColorStop: noop });
    if (k === 'createPattern') return () => ({ setTransform: noop });
    if (k === 'measureText') return () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
    if (k === 'canvas') return cv || { width: 1, height: 1 };
    return noop;
  }});
  const V3 = class { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
    set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} clone(){return new V3(this.x,this.y,this.z);}
    copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;} add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
    sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;} multiplyScalar(s){this.x*=s;this.y*=s;this.z*=s;return this;}
    addScaledVector(v,s){this.x+=v.x*s;this.y+=v.y*s;this.z+=v.z*s;return this;}
    length(){return Math.hypot(this.x,this.y,this.z);} lengthSq(){return this.x**2+this.y**2+this.z**2;}
    normalize(){const l=this.length()||1;return this.multiplyScalar(1/l);}
    distanceTo(v){return Math.hypot(this.x-v.x,this.y-v.y,this.z-v.z);}
    distanceToSquared(v){return (this.x-v.x)**2+(this.y-v.y)**2+(this.z-v.z)**2;}
    dot(v){return this.x*v.x+this.y*v.y+this.z*v.z;} lerp(){return this;} applyQuaternion(){return this;}
    setFromMatrixPosition(){return this;} crossVectors(){return this;} negate(){this.x*=-1;this.y*=-1;this.z*=-1;return this;}
    toArray(){return [this.x,this.y,this.z];} applyMatrix4(){return this;} transformDirection(){return this;} };
  const Obj3D = class { constructor(){ this.children=[]; this.position=new V3(); this.rotation={x:0,y:0,z:0};
      this.scale=new V3(1,1,1); this.userData={}; this.visible=true; this.matrixWorld={elements:new Array(16).fill(0),
        clone(){return this;}, invert(){return this;}}; this.quaternion={setFromUnitVectors:noop,copy:noop}; }
    add(...c){ for(const x of c) if(x) this.children.push(x); return this; } remove(){return this;}
    traverse(f){ f(this); for(const c of this.children) c.traverse && c.traverse(f); }
    getWorldPosition(v){ return (v||new V3()).copy(this.position); }
    getWorldQuaternion(q){ return q||{}; } updateMatrixWorld(){} localToWorld(v){return v;} worldToLocal(v){return v;}
    lookAt(){} };
  // A callable, infinitely-chainable stub. Used only for render-side THREE
  // objects the model never inspects, so making it truthy is safe here.
  const autoStub = () => {
    const f = function () { return f; };
    f._c = Object.create(null);
    return new Proxy(f, {
      get(t, k) {
        if (typeof k !== 'string') return Reflect.get(t, k);
        if (k === 'then' || k === 'toJSON') return undefined;
        if (k in t._c) return t._c[k];           // assigned, or previously vivified
        if (Reflect.has(t, k)) return t[k];      // genuine function property
        t._c[k] = autoStub();
        return t._c[k];
      },
      set(t, k, v) { t._c[k] = v; return true; },
      has(t, k) { return typeof k === 'string' ? (k in t._c) || Reflect.has(t, k) : Reflect.has(t, k); },
    });
  };
  const THREE = new Proxy({
    Vector2: class { constructor(x=0,y=0){this.x=x;this.y=y;} set(x,y){this.x=x;this.y=y;return this;} },
    Vector3: V3, Object3D: Obj3D, Group: Obj3D,
    Mesh: class extends Obj3D { constructor(g,m){ super(); this.geometry=g||{dispose:noop,computeBoundingBox:noop,
      boundingBox:{min:new V3(),max:new V3(),getCenter:v=>v,getSize:v=>v},attributes:{position:{count:0,array:[]}}};
      this.material=m||{dispose:noop}; this.isMesh=true; } },
    InstancedMesh: class extends Obj3D { constructor(){ super(); this.instanceMatrix={needsUpdate:false,setUsage:noop};
      this.isInstancedMesh=true; } setMatrixAt(){} getMatrixAt(){} },
    LineSegments: class extends Obj3D {}, Line: class extends Obj3D {}, Sprite: class extends Obj3D {},
    Matrix4: class { constructor(){this.elements=new Array(16).fill(0);} makeTranslation(){return this;}
      clone(){return this;} invert(){return this;} },
    Quaternion: class { setFromUnitVectors(){return this;} copy(){return this;} },
    Box3: class { setFromObject(){return this;} getCenter(v){return v||new V3();} getSize(v){return v||new V3();} },
    Color: class { constructor(){} setHex(){return this;} getHex(){return 0;} lerp(){return this;} getHexString(){return '000000';} },
    CanvasTexture: class { constructor(){ this.wrapS=this.wrapT=0; this.repeat={set:noop};
      this.needsUpdate=false; } clone(){return this;} dispose(){} },
    DataTexture: class { constructor(){ this.repeat={set:noop}; } clone(){return this;} dispose(){} },
    BufferAttribute: class { constructor(a,i){ this.array=a; this.itemSize=i; this.count=a?a.length/i:0; } },
    BufferGeometry: class { constructor(){ this.attributes={}; } setAttribute(n,a){ this.attributes[n]=a; return this; }
      setIndex(){return this;} toNonIndexed(){return this;} dispose(){} computeBoundingBox(){}
      translate(){return this;} },
    CatmullRomCurve3: class { constructor(p){ this.points=p||[]; }
      getPoints(n){ return this.points.length?this.points:[new V3()]; }
      getPointAt(t,v){ return (v||new V3()).copy(this.points[0]||new V3()); }
      getLength(){ let L=0; for(let i=1;i<this.points.length;i++) L+=this.points[i].distanceTo(this.points[i-1]); return L; } },
  }, { get: (t, k) => {
    if (k in t) return t[k];
    if (typeof k === 'string' && /^[A-Z]/.test(k)) {
      // Any other THREE export: cameras, lights, geometries, materials, helpers.
      // It extends Object3D because half of them are scene-graph nodes and the
      // app sets .position/.rotation on them straight after construction.
      if (!t['_fb']) t['_fb'] = class extends Obj3D { constructor(){ super();
        this.dispose=noop; this.attributes={position:{count:0,array:[]}};
        this.repeat={set:noop}; this.setSize=noop; this.setPixelRatio=noop;
        this.target=new V3(); this.shadow={mapSize:{set:noop,width:0,height:0},camera:new Obj3D(),
          bias:0,normalBias:0,radius:0,blurSamples:0}; this.left=this.right=this.top=this.bottom=0;
        this.near=0.1; this.far=1e4; this.aspect=1; this.fov=60;
        this.updateProjectionMatrix=noop; this.setFromCamera=noop;
        this.intersectObjects=()=>[]; this.intersectObject=()=>[];
        // renderer / composer / pass surface
        this.shadowMap={enabled:false,type:0,autoUpdate:true,needsUpdate:false};
        this.domElement={style:{},addEventListener:noop,removeEventListener:noop,
          getBoundingClientRect:()=>({left:0,top:0,width:1280,height:800}),
          requestPointerLock:noop,width:1280,height:800};
        this.outputColorSpace=''; this.toneMapping=0; this.toneMappingExposure=1;
        this.capabilities={isWebGL2:true,getMaxAnisotropy:()=>16};
        this.info={render:{calls:0,triangles:0},memory:{geometries:0,textures:0},reset:noop};
        this.render=noop; this.setAnimationLoop=noop; this.setClearColor=noop;
        this.setRenderTarget=noop; this.clear=noop; this.compile=noop; this.dispose=noop;
        this.getContext=()=>({getExtension:()=>null}); this.addPass=noop; this.setSampleLevel=noop;
        this.uniforms={}; this.enabled=true; this.samples=0; this.texture={};
        this.material={uniforms:{},dispose:noop}; this.strength=0; this.radius=0; this.threshold=0;
        this.resolution={set:noop}; this.blendFunction=0; this.output=0;
        // anything else this render object is asked for auto-vivifies
        return new Proxy(this, {
          get(t, k) {
            if (typeof k !== 'string' || k in t) return Reflect.get(t, k);
            if (k === 'then' || k === 'toJSON') return undefined;
            t[k] = autoStub(); return t[k];
          },
        });
      } };
      return t['_fb'];
    }
    return 0;
  }});

  const doc = { createElement: (t) => {
      if (t !== 'canvas') return el();
      // Procedural textures are generated at 1-2k square and the height->normal
      // pass is O(n^2) in plain JS. The fuzzer never looks at a pixel, so clamp
      // every canvas to 4x4 — this is the difference between minutes and hours.
      const cv = { _w: 4, _h: 4, style: {}, toDataURL: () => '' };
      Object.defineProperty(cv, 'width',  { get: () => cv._w, set: v => { cv._w = Math.min(4, Math.max(1, v | 0)); } });
      Object.defineProperty(cv, 'height', { get: () => cv._h, set: v => { cv._h = Math.min(4, Math.max(1, v | 0)); } });
      cv.getContext = () => ctx2d(cv);
      return cv;
    },
    getElementById: () => el(), querySelector: () => null, querySelectorAll: () => [],
    body: el(), addEventListener: noop, exitPointerLock: noop, scripts: [] };
  const sandbox = {
    THREE, document: doc, console,
    window: { addEventListener: noop, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
      requestAnimationFrame: noop, matchMedia: () => ({ matches:false, addEventListener:noop }) },
    navigator: { userAgent: 'node' }, location: { href: '' },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    requestAnimationFrame: noop, cancelAnimationFrame: noop,
    // real timers would keep the process alive forever and fire animation work
    setInterval: () => 0, clearInterval: noop,
    performance: { now: () => Date.now() }, setTimeout: () => 0, clearTimeout: noop,
    fetch: () => Promise.reject(new Error('no network in fuzz')),
    alert: noop, confirm: () => false, prompt: () => null, Image: class {},
  };
  // model-only: app.js skips every geometry builder
  sandbox.NETMAP3D_HEADLESS = true;
  sandbox.window.NETMAP3D_HEADLESS = true;
  sandbox.window.THREE = THREE;
  sandbox.globalThis = sandbox;
  // app.js reads browser globals bare (innerWidth, innerHeight, …) — mirror the
  // window properties onto the sandbox so those resolve.
  for (const k of Object.keys(sandbox.window)) if (!(k in sandbox)) sandbox[k] = sandbox.window[k];
  // Top-level `const`/`let` in a vm script live in script scope, not on the
  // global object, so a plain run leaves `state` and friends unreachable. Code
  // appended to the SAME script can see them — so export every top-level
  // binding by name.
  const names = new Set();
  for (const m of src.matchAll(/^(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm))
    names.add(m[1]);
  // Getters, not values. `state` is a `let` that clearScene() REASSIGNS, so a
  // snapshot taken at load time goes stale the moment a new site is built —
  // which looked exactly like "referenceSite() produced nothing".
  const tail = '\n;globalThis.__api = {' +
    [...names].map(n => `get ${n}() { return typeof ${n} !== 'undefined' ? ${n} : undefined; }`).join(',') + '};\n';
  vm.createContext(sandbox);
  try { vm.runInContext(src + tail, sandbox, { filename: 'app.js' }); }
  catch (e) { console.error('engine failed to load:', e.message); console.error(e.stack.split('\n').slice(0,8).join('\n')); throw e; }
  return sandbox;
}

module.exports = { mulberry32, loadEngine };

if (require.main === module) {
  const iterations = +(process.argv[2] || 1000);
  const seed0 = +(process.argv[3] || 12345);
  let env;
  try { env = loadEngine(); }
  catch (e) { console.error('FATAL: could not load engine headlessly.'); process.exit(2); }
  const api = env.__api || {};
  // The rejection gate runs once — it is about the CLI's rules, not a topology.
  const rejectFails = checkRejects(api);
  if (rejectFails.length) {
    console.log('REJECTION GATE FAILURES:');
    for (const f of rejectFails) console.log('  ' + f);
  } else console.log('rejection gate: ok');

  const t0 = Date.now();
  const buckets = new Map();       // failure signature -> {count, seed, example}
  let built = 0, skipped = 0, crashed = 0;

  for (let n = 0; n < iterations; n++) {
    const seed = seed0 + n;
    const rnd = mulberry32(seed);
    let site = null, fails = [];
    try { site = genSite(api, rnd); } catch (e) {
      crashed++; fails = ['generator threw: ' + e.message];
    }
    if (!site && !fails.length) { skipped++; continue; }
    if (site) {
      built++;
      try { fails = checkSite(api, site).concat(checkRealism(api, site)); }
      catch (e) { crashed++; fails = ['oracle threw: ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]]; }
    }
    for (const f of fails) {
      // bucket by shape, not by the specific names/addresses in the message
      const sig = f.replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d+)?/g, 'IP')
                   .replace(/\b[A-Z]+\d+\b/g, 'DEV').replace(/\d+/g, 'N');
      if (!buckets.has(sig)) buckets.set(sig, { count: 0, seed, example: f });
      buckets.get(sig).count++;
    }
  }

  const ms = Date.now() - t0;
  console.log(`\n=== fuzz: ${iterations} iterations in ${(ms / 1000).toFixed(1)}s ` +
    `(${(ms / Math.max(1, iterations)).toFixed(2)} ms/site) ===`);
  console.log(`built ${built}, skipped ${skipped}, harness crashes ${crashed}`);
  if (!buckets.size && !rejectFails.length) { console.log('NO FAILURES'); process.exit(0); }
  if (!buckets.size) { console.log('no topology failures'); process.exit(1); }
  const sorted = [...buckets.entries()].sort((a, b) => b[1].count - a[1].count);
  console.log(`\n${sorted.length} distinct failure signatures:`);
  for (const [sig, b] of sorted)
    console.log(`  [${String(b.count).padStart(6)}x] seed ${b.seed}  ${b.example}`);
  process.exit(1);
}

//////////////////// Topology generator ////////////////////
// Builds straight into the model — no buildDeviceGroup, no buildCableMesh, no
// colliders. That is what "model only" means and it is why this runs at ~1000
// sites/minute instead of one site per second.

function genSite(api, rnd) {
  const { state, uid, DEVICE_TYPES } = api;
  state.racks.length = 0; state.devices.length = 0; state.cables.length = 0;
  state.walls.length = 0; state.slabs.length = 0; state.raceways.length = 0;
  state.holes.length = 0; state.links.length = 0; state.ties.length = 0;

  const pick = a => a[Math.floor(rnd() * a.length)];
  const iRand = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

  // Pick device types by what they actually are, not by name, so the generator
  // keeps working as the catalogue grows.
  const byClass = { router: [], switch: [], host: [] };
  for (const t of Object.keys(DEVICE_TYPES)) {
    const probe = { id: 'probe', type: t };
    let cls; try { cls = api.netClass(probe); } catch { continue; }
    if (cls === 'router') byClass.router.push(t);
    else if (cls === 'switch') byClass.switch.push(t);
    else if (api.isComputerHost && api.isComputerHost(probe)) byClass.host.push(t);
  }
  if (!byClass.router.length || !byClass.switch.length || !byClass.host.length) return null;

  const portsOf = t => (DEVICE_TYPES[t] && DEVICE_TYPES[t].ports) || 8;
  // A device the engine ignores is a device the fuzzer cannot test: isPlaced()
  // requires a rack for rack gear and coordinates for field gear, so every
  // generated device gets a real home. Rack-mount kit goes in a real rack.
  const gRack = { id: uid(), x: 0, z: 0, y0: 0, rotY: 0, units: 42, mount: 'floor', name: 'FUZZ' };
  state.racks.push(gRack);
  let nextU = 1, fieldX = 0;
  const dev = o => {
    const def = DEVICE_TYPES[o.type] || {};
    const home = def.field ? { x: (fieldX += 40), z: 0, y: 0 }
                           : { rackId: gRack.id, u: (nextU = Math.min(42, nextU + 1)) };
    const d = { id: uid(), name: o.name || o.type, ...home, ...o };
    state.devices.push(d); return d;
  };
  const wire = (a, pa, b, pb) => {
    const c = { id: uid(), a: { deviceId: a.id, port: pa, side: 0 },
      b: { deviceId: b.id, port: pb, side: 0 }, color: 0x2f81f7, waypoints: [] };
    state.cables.push(c); return c;
  };

  // Randomised address plan. Prefix length varies so /16-through-/30 handling is
  // exercised, not just the /24 happy path that hid two real bugs before.
  const cidr = pick([16, 20, 22, 23, 24, 25, 26, 28, 30]);
  const vlanCount = iRand(1, 4);
  const vlans = [];
  for (let i = 0; i < vlanCount; i++) {
    const id = 10 + i * 10;
    const oct2 = 20 + i;
    const base = cidr >= 24 ? `10.${oct2}.${i}.0` : `10.${oct2}.0.0`;
    // host capacity of the prefix, minus network+broadcast, capped at what we build
    const cap = Math.max(1, Math.pow(2, 32 - cidr) - 3);
    // the gateway takes the first usable address, the way almost every real
    // network is numbered
    const np = api.parseIp(`${base}/${cidr}`);
    const gw = api.ipStr((np.network >>> 0) + (cidr >= 31 ? 0 : 1));
    vlans.push({ id, name: `V${id}`, base, gw, cidr, cap, n: 1 });
  }
  // Walk the prefix arithmetically so a host is never handed the network or the
  // broadcast address, whatever the mask is.
  const hostIp = (v) => {
    const net = api.parseIp(`${v.base}/${cidr}`);
    const size = Math.pow(2, 32 - cidr);
    const usable = cidr >= 31 ? size : size - 2;         // RFC 3021 for /31
    if (v.n >= usable) return null;
    const base = (net.network >>> 0) + (cidr >= 31 ? 0 : 1);
    return `${api.ipStr(base + v.n++)}/${cidr}`;
  };

  const rtType = pick(byClass.router);
  const router = dev({ type: rtType, name: 'RTR', ip: `${vlans[0].gw}/${cidr}`,
    svi: Object.fromEntries(vlans.map(v => [v.id, `${v.gw}/${cidr}`])),
    vlans: vlans.map(v => ({ id: v.id, name: v.name })), portCfg: {} });

  const dhcpOn = rnd() < 0.6;
  if (dhcpOn) {
    // Pool bounds are computed from the prefix, not pasted into the last octet.
    // A /26 has 62 usable addresses, so a range ending .200 is not a tight pool
    // -- it is outside the network, and a real router rejects it outright.
    router.dhcp = { enabled: true, pools: vlans.map(v => {
      const net = api.parseIp(`${v.base}/${cidr}`);
      const size = Math.pow(2, 32 - cidr);
      const first = (net.network >>> 0) + 1;             // .0 is the network
      const last = (net.network >>> 0) + size - 2;       // and the top is broadcast
      const lo = Math.min(first + 9, last);              // leave room for statics
      const hi = Math.min(lo + 89, last);
      return { name: v.name, network: `${v.base}/${cidr}`,
        poolStart: api.ipStr(lo), poolEnd: api.ipStr(hi),
        lease: { days: 1 }, defaultRouter: v.gw, dns: [], domain: 'f.local', reservations: [] };
    })};
  }

  // switch tiers, each uplinked to the one above — random depth exercises the
  // multi-hop L2 walk and STP rather than one flat segment
  const tiers = iRand(1, 3), sw = [];
  let parent = router, parentPort = 2;
  for (let t = 0; t < tiers; t++) {
    const st = pick(byClass.switch);
    const s = dev({ type: st, name: `SW${t + 1}`, ip: `10.99.0.${t + 2}/24`,
      gateway: vlans[0].gw, vlans: vlans.map(v => ({ id: v.id, name: v.name })), portCfg: {} });
    for (let p = 1; p <= Math.min(4, portsOf(st)); p++) s.portCfg[p] = { mode: 'trunk', allowed: 'all' };
    wire(parent, parentPort, s, 1);
    sw.push(s); parent = s; parentPort = 2;
  }

  const hosts = [];
  const perSwitch = iRand(1, 5);
  for (const s of sw) {
    const free = portsOf(s.type);
    for (let i = 0; i < perSwitch; i++) {
      const port = 5 + i;
      if (port > free) break;
      const v = pick(vlans);
      const useDhcp = dhcpOn && rnd() < 0.5;
      const ip = useDhcp ? 'dhcp' : hostIp(v);
      if (!ip) continue;
      const h = dev({ type: pick(byClass.host), name: `H${hosts.length + 1}`,
        ip, gateway: v.gw, vlan: v.id });
      s.portCfg[port] = { mode: 'access', vlan: v.id };
      wire(s, port, h, 1);
      hosts.push({ dev: h, vlan: v });
    }
  }
  if (!hosts.length) return null;

  // a redundant link often enough to keep STP honest
  if (sw.length >= 2 && rnd() < 0.35) wire(sw[0], 3, sw[sw.length - 1], 3);

  return { router, sw, hosts, vlans, cidr, dhcpOn };
}

//////////////////// Invariants ////////////////////
// Each returns null when it holds, or a string naming what broke.

function checkSite(api, site) {
  const fails = [];
  const { state } = api;
  const say = (k, m) => fails.push(`${k}: ${m}`);

  // 1. nothing in the model is malformed
  for (const d of state.devices) {
    if (!d.id) say('model', 'device with no id');
    if (!api.DEVICE_TYPES[d.type]) say('model', `unknown device type ${d.type}`);
  }
  for (const c of state.cables) {
    for (const e of [c.a, c.b]) {
      if (!state.devices.some(d => d.id === e.deviceId)) say('model', 'cable to nonexistent device');
      const owner = state.devices.find(d => d.id === e.deviceId);
      const np = owner && (api.DEVICE_TYPES[owner.type].ports || 8);
      if (owner && (e.port < 1 || e.port > np))
        say('model', `cable on ${owner.type} port ${e.port} of ${np}`);
    }
  }
  // no port double-booked — one jack, one cable, always
  const seen = new Set();
  for (const c of state.cables) for (const e of [c.a, c.b]) {
    const k = `${e.deviceId}/${e.port}/${e.side}`;
    if (seen.has(k)) say('model', `port ${k} has two cables in it`);
    seen.add(k);
  }

  // 2. addressing is well formed and inside its own prefix
  for (const { dev, vlan } of site.hosts) {
    if (dev.ip === 'dhcp') continue;
    const ip = api.parseIp(dev.ip);
    if (!ip) { say('addr', `unparseable ${dev.ip}`); continue; }
    const gw = api.parseIp(`${vlan.gw}/${site.cidr}`);
    if (gw && api.ipInSubnet && !api.ipInSubnet(ip.int, gw))
      say('addr', `${dev.ip} is not inside its own gateway prefix ${vlan.gw}/${site.cidr}`);
  }

  // 3. DHCP hands out distinct, in-scope addresses
  if (site.dhcpOn) {
    let res = null;
    try { res = api.resolveDhcp ? api.resolveDhcp() : null; } catch (e) { say('dhcp', 'threw ' + e.message); }
    const given = new Map();
    for (const { dev } of site.hosts) {
      if (dev.ip !== 'dhcp') continue;
      const ifaces = api.deviceInterfaces(dev);
      for (const i of ifaces) {
        if (!i.ip) continue;
        const s = api.ipStr(i.ip);
        if (given.has(s)) say('dhcp', `duplicate address ${s} on ${dev.name} and ${given.get(s)}`);
        given.set(s, dev.name);
      }
    }
  }

  // 4. reachability is symmetric when no policy says otherwise
  const addressed = site.hosts.filter(h => h.dev.ip && h.dev.ip !== 'dhcp');
  for (let i = 0; i < Math.min(addressed.length, 6); i++) {
    for (let j = i + 1; j < Math.min(addressed.length, 6); j++) {
      const A = addressed[i], B = addressed[j];
      const ia = api.deviceInterfaces(A.dev)[0], ib = api.deviceInterfaces(B.dev)[0];
      if (!ia || !ib) continue;
      let ab, ba;
      try { ab = api.deviceReach(A.dev, ib.ip.int); ba = api.deviceReach(B.dev, ia.ip.int); }
      catch (e) { say('reach', 'threw ' + e.message); continue; }
      if (!!ab.ok !== !!ba.ok)
        say('reach', `asymmetric ${A.dev.name}->${B.dev.name} ${ab.ok} but back ${ba.ok} (${ab.why || ba.why})`);
      // same VLAN, same switch fabric, no ACLs generated: it must work
      if (A.vlan.id === B.vlan.id && !ab.ok)
        say('reach', `same-VLAN ${A.vlan.id} peers unreachable: ${ab.why}`);
    }
  }

  // 5. every host reaches its own default gateway
  for (const { dev, vlan } of addressed.slice(0, 6)) {
    const gw = api.parseIp(`${vlan.gw}/${site.cidr}`);
    if (!gw) continue;
    let r; try { r = api.deviceReach(dev, gw.int); } catch (e) { say('gw', 'threw ' + e.message); continue; }
    if (!r.ok) say('gw', `${dev.name} cannot reach its gateway ${vlan.gw}: ${r.why}`);
  }

  // 6. save/load round trip is lossless
  if (api.serializeState && api.loadState) {
    try {
      const before = JSON.stringify(api.serializeState());
      api.loadState(JSON.parse(before));
      const after = JSON.stringify(api.serializeState());
      if (before !== after) say('io', 'save/load round trip changed the model');
    } catch (e) { say('io', 'round trip threw ' + e.message); }
  }
  return fails;
}

//////////////////// Realism invariants ////////////////////
// Not "is the model self-consistent" but "would a real network behave this
// way". Each check cites the standard or the vendor behaviour it enforces, so a
// failure is arguable against a primary source rather than against taste.

function checkRealism(api, site) {
  const bad = [];
  const { state } = api;
  const say = (rule, m) => bad.push(`${rule}: ${m}`);

  // RFC 1918 / IEEE: VLAN IDs are 1-4094, and Cisco reserves 1002-1005 for
  // FDDI/Token Ring defaults -- they cannot be used or deleted.
  for (const d of state.devices) {
    for (const v of d.vlans || []) {
      const id = +v.id;
      if (!(id >= 1 && id <= 4094)) say('vlan-range', `${d.name} has VLAN ${id}, outside 1-4094`);
      if (id >= 1002 && id <= 1005) say('vlan-reserved', `${d.name} uses reserved VLAN ${id}`);
    }
  }

  // A host address may not be the network or the broadcast address of its own
  // prefix. /31 is the exception -- RFC 3021 gives point-to-point links both
  // addresses -- and /32 is a single host.
  for (const d of state.devices) {
    for (const i of api.deviceInterfaces(d)) {
      const ip = i.ip;
      if (!ip || ip.cidr >= 31) continue;
      const net = ip.network >>> 0, bcast = (net | (~ip.mask >>> 0)) >>> 0;
      if ((ip.int >>> 0) === net) say('net-addr', `${d.name} ${api.ipStr(ip.int)}/${ip.cidr} is the network address`);
      if ((ip.int >>> 0) === bcast) say('bcast-addr', `${d.name} ${api.ipStr(ip.int)}/${ip.cidr} is the broadcast address`);
    }
  }

  // Two devices answering the same address in one broadcast domain is a
  // duplicate-IP conflict; real stacks log it and one of them stops working.
  const byAddr = new Map();
  for (const d of state.devices) {
    for (const i of api.deviceInterfaces(d)) {
      const k = i.ip.int >>> 0;
      if (byAddr.has(k) && byAddr.get(k) !== d.name)
        say('dup-ip', `${api.ipStr(k)} answered by both ${byAddr.get(k)} and ${d.name}`);
      byAddr.set(k, d.name);
    }
  }

  // A default gateway must live inside the subnet it serves, or the host can
  // never ARP for it.
  for (const { dev, vlan } of site.hosts) {
    const gwStr = api.hostGateway ? api.hostGateway(dev) : dev.gateway;
    if (!gwStr) continue;
    const gw = api.parseIp(gwStr);
    const ip = api.deviceInterfaces(dev)[0];
    if (!gw || !ip) continue;
    if (!api.ipInSubnet(gw.int, ip.ip))
      say('gw-offsubnet', `${dev.name} gateway ${gwStr} is outside its own ${api.ipStr(ip.ip.network)}/${ip.ip.cidr}`);
  }

  // RFC 2131 s4.4.5: renewal at T1 = 0.5 x lease, rebinding at T2 = 0.875 x
  // lease. Pool ranges must lie inside the pool's own network.
  for (const d of state.devices) {
    for (const p of (d.dhcp && d.dhcp.pools) || []) {
      const net = api.parseIp(p.network);
      if (!net) { say('pool-net', `${d.name} pool ${p.name} has an unparseable network`); continue; }
      for (const [lbl, a] of [['start', p.poolStart], ['end', p.poolEnd]]) {
        const v = a && api.parseIp(a);
        if (!v) continue;
        if (!api.ipInSubnet(v.int, net))
          say('pool-range', `${d.name} pool ${p.name} ${lbl} ${a} is outside ${p.network}`);
      }
      if (p.defaultRouter) {
        const r = api.parseIp(p.defaultRouter);
        if (r && !api.ipInSubnet(r.int, net))
          say('pool-router', `${d.name} pool ${p.name} default-router ${p.defaultRouter} is outside ${p.network}`);
      }
    }
  }
  for (const b of (api._dhcpBindings ? api._dhcpBindings.values() : [])) {
    if (!isFinite(b.leaseSecs)) continue;
    const ms = b.leaseSecs * 1000;
    const t1 = (b.t1At - b.boundAt) / ms, t2 = (b.t2At - b.boundAt) / ms;
    if (Math.abs(t1 - 0.5) > 0.01) say('dhcp-t1', `T1 is ${t1.toFixed(3)} of the lease, RFC 2131 says 0.5`);
    if (Math.abs(t2 - 0.875) > 0.01) say('dhcp-t2', `T2 is ${t2.toFixed(3)} of the lease, RFC 2131 says 0.875`);
  }

  // IEEE 802.1t: with the extended system ID the configurable part of the
  // bridge priority moves in steps of 4096.
  for (const d of state.devices) {
    if (d.stpPriority === undefined || d.stpPriority === '') continue;
    const pr = +d.stpPriority;
    if (!isFinite(pr) || pr % 4096 !== 0)
      say('stp-priority', `${d.name} bridge priority ${d.stpPriority} is not a multiple of 4096`);
  }

  // RFC 5517: a primary private VLAN has at most ONE isolated secondary.
  for (const d of state.devices) {
    const pv = d.pvlan || {};
    for (const [id, def] of Object.entries(pv)) {
      if (def.type !== 'primary') continue;
      const iso = (def.assoc || []).filter(v => pv[v] && pv[v].type === 'isolated');
      if (iso.length > 1)
        say('pvlan-isolated', `${d.name} primary VLAN ${id} has ${iso.length} isolated secondaries; only one is legal`);
      for (const v of def.assoc || [])
        if (!pv[v]) say('pvlan-assoc', `${d.name} VLAN ${id} associates undefined secondary ${v}`);
    }
    // a secondary may belong to only one primary
    const owner = new Map();
    for (const [id, def] of Object.entries(pv)) {
      if (def.type !== 'primary') continue;
      for (const v of def.assoc || []) {
        if (owner.has(v)) say('pvlan-shared', `${d.name} secondary ${v} is associated with primaries ${owner.get(v)} and ${id}`);
        owner.set(v, id);
      }
    }
  }

  // A port is access or trunk, never both, and one jack takes one cable.
  for (const d of state.devices) {
    for (const [p, c] of Object.entries(d.portCfg || {})) {
      if (c.mode === 'access' && c.tagged) say('port-mode', `${d.name} port ${p} is access but carries a tagged list`);
      if (c.pvMode === 'host' && c.pvSecondary === undefined)
        say('pvlan-host', `${d.name} port ${p} is a private-VLAN host port with no secondary`);
    }
  }

  // TIA-568: 100 m channel for balanced twisted pair. Anything longer is not a
  // link, it is a fault, and must be reported as one.
  for (const c of state.cables) {
    const ft = (c.lengthIn || 0) / 12;
    if (ft > 328 && !c.fiber) say('copper-limit', `a ${Math.round(ft)} ft copper run exceeds the 328 ft channel limit`);
  }

  return bad;
}

//////////////////// Rejection gate ////////////////////
// A realism oracle over generated-valid configs passes trivially. The sharper
// question is whether the app REFUSES what real gear refuses, so these feed
// impossible configuration through the CLI -- the same surface a user types at
// -- and require a `%` rejection. Each line cites the real behaviour.
function checkRejects(api) {
  const bad = [];
  const { state } = api;
  state.racks.length = 0; state.devices.length = 0; state.cables.length = 0;
  const rack = { id: api.uid(), x: 0, z: 0, y0: 0, rotY: 0, units: 42, mount: 'floor', name: 'R' };
  state.racks.push(rack);
  const sw = { id: api.uid(), type: 'c_c9300l48', name: 'SW1', rackId: rack.id, u: 10,
    ip: '10.0.0.2/24', vlans: [{ id: 10, name: 'A' }], portCfg: {}, pvlan: {} };
  state.devices.push(sw);
  const sess = { dev: sw, mode: 'priv', name: 'SW1' };
  const run = (cmd) => {
    try {
      const r = api.iosExec(sess, cmd);
      const out = (r && r.out) || '';
      // A configuration command that succeeds prints nothing at all. Any output
      // is a diagnostic -- and not all of them start with '%': IOS answers a
      // network address with a bare "Bad mask /24 for address 10.9.9.0".
      return out.trim() ? out.replace(/\s+/g, ' ').trim() : null;
    } catch (e) { return 'THREW ' + e.message; }
  };
  run('configure terminal');

  const mustReject = [
    ['vlan 4095', 'VLAN IDs stop at 4094'],
    ['vlan 0', 'VLAN 0 is not assignable'],
    ['no vlan 1', 'VLAN 1 exists by default and cannot be deleted'],
    ['no vlan 1002', 'VLANs 1002-1005 are Cisco defaults and cannot be deleted'],
    ['interface gi0/99', 'a 48-port switch has no port 99'],
    ['interface vlan 5000', 'VLAN 5000 is out of range'],
    ['ip route 10.0.0.0 255.0.0.0', 'no next hop given'],
    ['ip route 10.0.0.0 255.255.255.999 10.0.0.1', 'not a valid mask'],
    ['spanning-tree vlan 4095 priority 4096', 'VLAN out of range'],
    ['spanning-tree vlan 10 priority 61441', 'priority tops out at 61440'],
    ['spanning-tree vlan 10 priority -4096', 'priority cannot be negative'],
  ];
  const mustRejectOnIf = [
    ['ip address 10.9.9.0 255.255.255.0', 'that is the network address'],
    ['ip address 10.9.9.255 255.255.255.0', 'that is the broadcast address'],
    ['ip address 10.9.9.1 255.255.255.999', 'not a valid mask'],
    ['ip address 10.9.9.1 255.0.255.0', 'a mask must be contiguous ones then zeros'],
    ['switchport access vlan 4095', 'VLAN out of range'],
    ['switchport access vlan 1002', 'a Token Ring/FDDI VLAN cannot carry Ethernet'],
    ['switchport private-vlan host-association 10 999', '999 is not a secondary private VLAN'],
    ['switchport trunk native vlan 4095', 'VLAN out of range'],
    ['switchport trunk allowed vlan 4095', 'VLAN out of range'],
    ['speed 40', 'not a speed this interface supports'],
    ['duplex banana', 'duplex is auto, full or half'],
  ];
  // and things real gear ACCEPTS, so the gate cannot be passed by rejecting all
  const mustAccept = [
    ['vlan 1002', 'the reserved VLANs exist and are enterable on real IOS'],
    ['vlan 20', 'an ordinary VLAN'],
    ['vlan 4094', 'the top of the range is valid'],
  ];
  const mustAcceptOnIf = [
    ['ip address 10.9.9.1 255.255.255.0', 'an ordinary host address'],
    ['ip address 10.9.9.0 255.255.255.254', '/31 has no network address — RFC 3021'],
    ['ip address 10.9.9.1 255.255.255.255', 'a /32 host address'],
    ['switchport access vlan 20', 'an ordinary access VLAN'],
    ['switchport trunk allowed vlan 10,20,30', 'an ordinary allowed list'],
    ['speed auto', 'autonegotiation'],
    ['duplex full', 'a real duplex setting'],
  ];

  for (const [cmd, why] of mustReject) if (!run(cmd)) bad.push(`accepted "${cmd}" — ${why}`);
  run('interface gi0/1');
  for (const [cmd, why] of mustRejectOnIf) if (!run(cmd)) bad.push(`accepted "${cmd}" — ${why}`);
  run('exit');
  if (!run('spanning-tree vlan 10 priority 1000'))
    bad.push('accepted "spanning-tree vlan 10 priority 1000" — 802.1t priority steps by 4096');
  for (const [cmd, why] of mustAccept) {
    const e = run(cmd);
    if (e) bad.push(`rejected "${cmd}" — ${why} (${e})`);
    run('exit');
  }
  run('interface gi0/2');
  for (const [cmd, why] of mustAcceptOnIf) {
    const e = run(cmd);
    if (e) bad.push(`rejected "${cmd}" — ${why} (${e})`);
  }
  run('exit');
  return bad;
}
