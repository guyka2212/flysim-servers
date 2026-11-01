#!/bin/sh
# FPV Sim server installer for Linux (and macOS).
#   curl -fsSL https://raw.githubusercontent.com/guyka2212/flysim-servers/main/install.sh | sh
# or download it and run:  sh install.sh
# Makes an "FPV-Sim-Server" folder here, downloads the server into it, and a private copy of
# Node.js if this machine has no Node.js 18 or newer. Run again to update (settings are kept).
set -e
REPO="https://raw.githubusercontent.com/guyka2212/flysim-servers/main/server"
DEST="$(pwd)/FPV-Sim-Server"
echo
echo " FPV Sim server installer"
echo " Installing into: $DEST"
echo
mkdir -p "$DEST"

if command -v curl >/dev/null 2>&1; then
  get() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  get() { wget -q "$1" -O "$2"; }
else
  echo " Needs curl or wget (e.g. sudo apt install curl)."
  exit 1
fi

for f in flysim-server.mjs maps.json admin.html start.bat start.sh Tunnel.md README.md; do
  echo "  downloading $f"
  get "$REPO/$f" "$DEST/$f"
done
chmod +x "$DEST/start.sh"

node_ok() {
  command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 18 ]
}
if ! node_ok && [ ! -x "$DEST/runtime/bin/node" ]; then
  echo
  echo " Node.js 18+ not found: downloading a private copy into FPV-Sim-Server/runtime ..."
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) echo " Unsupported system: install Node.js 18+ from https://nodejs.org and run start.sh"; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    armv7l) arch=armv7l ;;
    *) echo " Unsupported CPU $(uname -m): install Node.js 18+ yourself."; exit 1 ;;
  esac
  get https://nodejs.org/dist/index.json /tmp/flysim-node-index.json
  # The newest LTS release is the first entry with "lts" set.
  v=$(tr '{' '\n' < /tmp/flysim-node-index.json | grep '"lts":"' | head -n 1 | sed 's/.*"version":"\([^"]*\)".*/\1/')
  name="node-$v-$os-$arch"
  echo "  Node.js $v ($os-$arch)"
  get "https://nodejs.org/dist/$v/$name.tar.gz" "/tmp/$name.tar.gz"
  rm -rf "$DEST/runtime"
  mkdir -p "$DEST/runtime"
  tar -xzf "/tmp/$name.tar.gz" -C "$DEST/runtime" --strip-components=1
  rm -f "/tmp/$name.tar.gz" /tmp/flysim-node-index.json
fi

echo
echo " Done. Next:"
echo "  1. cd FPV-Sim-Server && ./start.sh   (once: it makes eula.txt and server.settings)"
echo "  2. In eula.txt change  eula=false  to  eula=true"
echo "  3. In server.settings set  Owner-user-name=  to your user name in the game"
echo "  4. ./start.sh again   (./start.sh gui on a desktop for the admin window)"
echo "  5. Friends outside your network: see Tunnel.md (playit.gg)"
echo
