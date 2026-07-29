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
  const tail = '\n;globalThis.__api = {' +
    [...names].map(n => `${n}: (typeof ${n} !== 'undefined' ? ${n} : undefined)`).join(',') + '};\n';
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
      try { fails = checkSite(api, site); }
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
  if (!buckets.size) { console.log('NO FAILURES'); process.exit(0); }
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
    const gw = cidr >= 24 ? `10.${oct2}.${i}.1` : `10.${oct2}.0.1`;
    // host capacity of the prefix, minus network+broadcast, capped at what we build
    const cap = Math.max(1, Math.pow(2, 32 - cidr) - 3);
    vlans.push({ id, name: `V${id}`, base, gw, cidr, cap, n: 1 });
  }
  const hostIp = (v) => {
    if (v.n >= v.cap) return null;
    const n = ++v.n + 1;
    const a = cidr >= 24 ? `10.${20 + (v.id - 10) / 10}.${(v.id - 10) / 10}.${n}`
                         : `10.${20 + (v.id - 10) / 10}.${Math.floor(n / 250)}.${n % 250}`;
    return `${a}/${cidr}`;
  };

  const rtType = pick(byClass.router);
  const router = dev({ type: rtType, name: 'RTR', ip: `${vlans[0].gw}/${cidr}`,
    svi: Object.fromEntries(vlans.map(v => [v.id, `${v.gw}/${cidr}`])),
    vlans: vlans.map(v => ({ id: v.id, name: v.name })), portCfg: {} });

  const dhcpOn = rnd() < 0.6;
  if (dhcpOn) {
    router.dhcp = { enabled: true, pools: vlans.map(v => {
      const hi = cidr >= 24 ? v.base.replace(/\.0$/, '.200') : v.base.replace(/\.0\.0$/, '.250.200');
      const lo = cidr >= 24 ? v.base.replace(/\.0$/, '.150') : v.base.replace(/\.0\.0$/, '.200.10');
      return { name: v.name, network: `${v.base}/${cidr}`, poolStart: lo, poolEnd: hi,
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
