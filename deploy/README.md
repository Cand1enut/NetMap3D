# Running NetMap3D on Ubuntu Server

The point of this: keep NetMap3D on the homelab box and open it from any
machine. It also puts the real switch instances where the CPU and RAM are —
they run as native containers on Linux, not inside a VM on a laptop.

```bash
ssh homelab
sudo git clone git@github.com:Cand1enut/NetMap3D.git /srv/netmap3d
cd /srv/netmap3d
npm run nos:build          # builds the FRRouting image (once, ~5 min)
sudo cp deploy/netmap3d.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now netmap3d
```

Then `http://<server>:8080` from any browser on the network.

`docker compose -f deploy/docker-compose.yml up -d` works too, but read the
socket note in that file first — systemd on the host is the safer default.

## Reaching it from outside the LAN

Do not port-forward 8080 to the internet. There is no authentication in front of
it yet, and real-NOS mode can start containers. Use a private network:

```bash
sudo tailscale up            # then http://homelab:8080 from any of your devices
```

WireGuard is equally fine. Authentication is a prerequisite before this is ever
exposed publicly — it is tracked in ROADMAP.md alongside the multi-user work.

## Real switches

With `NETMAP3D_NOS=1`, NetMap3D can materialise a site as **real network
operating systems** rather than a simulation:

* every L3 device becomes a **FRRouting** container — real `zebra`, `ospfd`,
  `bgpd`, `isisd`
* every cable becomes a **veth pair** joining the two containers' network
  namespaces
* protocols converge because real daemons exchange real packets; routes land in
  the real Linux FIB and real traffic follows them

```bash
curl -s localhost:8080/api/health          # is the image built, is NOS enabled
curl -s localhost:8080/api/nos/status      # what is running
curl -sX POST localhost:8080/api/nos/vtysh \
  -H 'content-type: application/json' \
  -d '{"idx":0,"command":"show ip ospf neighbor"}'
```

`/api/nos/vtysh` is the real `vtysh`, so `show ip ospf neighbor` prints what the
adjacency state machine actually believes — not a re-implementation of it.

### What this costs

Roughly 25–40 MB of RAM per device for `zebra` + `ospfd`. Budget accordingly;
a few hundred devices is a few GB. Protocol timers are the real ones, so a
first OSPF adjacency takes tens of seconds to reach `Full` exactly as it does on
hardware.

### Why it needs privilege

Moving a veth into another namespace and creating `/var/run/netns` entries are
root operations, and spawning containers means talking to the docker socket.
That is inherent to running real network stacks; it is why the service is scoped
with `ReadWritePaths` rather than left wide open.

## Development

The dev loop on a Mac targets a local Ubuntu VM with the same OS and runtime as
the server, so nothing is rewritten on the way to deployment:

```bash
brew install colima docker
colima start --cpu 4 --memory 8 --disk 40 --vm-type vz --mount-type virtiofs
npm run nos:build
NETMAP3D_NOS=1 npm run serve
```

The manager notices it is not on the Docker host and relays `ip` commands
through `colima ssh`. On the server it runs them directly. That is the only
difference between the two environments.
