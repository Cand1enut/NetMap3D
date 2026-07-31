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

/usr/lib/frr/frrinit.sh start

# hand the container a PID 1 that reaps children and blocks forever; watchfrr is
# already supervising the daemons themselves
trap '/usr/lib/frr/frrinit.sh stop; exit 0' TERM INT
while :; do sleep 3600 & wait $!; done
