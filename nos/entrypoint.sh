#!/bin/sh
# Start FRR the way the Ubuntu package expects and then stay in the foreground.
# The official frrouting image ships /usr/lib/frr/docker-start; the Debian/Ubuntu
# package does not — it has frrinit.sh, which launches watchfrr and daemonises.
set -e

mkdir -p /var/run/frr /var/log/frr
chown -R frr:frr /var/run/frr /var/log/frr /etc/frr

# forwarding is the whole job; ignore failure when the sysctl is already set
# read-only by the runtime
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
sysctl -w net.ipv6.conf.all.forwarding=1 >/dev/null 2>&1 || true

# Open vSwitch first: the switch fabric has to exist before the routing daemons
# start binding addresses to interfaces on top of it.
mkdir -p /var/run/openvswitch /var/log/openvswitch /etc/openvswitch
if [ ! -f /etc/openvswitch/conf.db ]; then
  ovsdb-tool create /etc/openvswitch/conf.db /usr/share/openvswitch/vswitch.ovsschema
fi
ovsdb-server /etc/openvswitch/conf.db \
  --remote=punix:/var/run/openvswitch/db.sock \
  --remote=db:Open_vSwitch,Open_vSwitch,manager_options \
  --pidfile=/var/run/openvswitch/ovsdb-server.pid --detach --log-file=/var/log/openvswitch/ovsdb-server.log
ovs-vsctl --no-wait init
ovs-vswitchd --pidfile=/var/run/openvswitch/ovs-vswitchd.pid --detach \
  --log-file=/var/log/openvswitch/ovs-vswitchd.log

/usr/lib/frr/frrinit.sh start

# hand the container a PID 1 that reaps children and blocks forever; watchfrr is
# already supervising the daemons themselves
trap '/usr/lib/frr/frrinit.sh stop; ovs-appctl -t ovs-vswitchd exit 2>/dev/null; ovs-appctl -t ovsdb-server exit 2>/dev/null; exit 0' TERM INT
while :; do sleep 3600 & wait $!; done
