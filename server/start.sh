#!/bin/sh
# Starts the FPV Sim server.   ./start.sh          asks for the port
#                              ./start.sh 25580    on that port
#                              ./start.sh gui      also opens the admin window (desktop only)
cd "$(dirname "$0")"
NODE=node
[ -x ./runtime/bin/node ] && NODE=./runtime/bin/node
exec "$NODE" flysim-server.mjs "$@"
