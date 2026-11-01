# FPV Sim Servers

Your own multiplayer server for FPV Sim, for Windows and Linux.

**Website with the full guide: https://guyka2212.github.io/flysim-servers/**

## Quick start

- **Windows:** download [`install.bat`](install.bat), put it in an empty folder, double-click it.
- **Linux:** in an empty folder run
  ```sh
  curl -fsSL https://raw.githubusercontent.com/guyka2212/flysim-servers/main/install.sh | sh
  ```

Then, in the new `FPV-Sim-Server` folder:

1. Run `start.bat` / `./start.sh` once. It creates `eula.txt` and `server.settings`.
2. In `eula.txt` change `eula=false` to `eula=true`.
3. In `server.settings` set `Owner-user-name=` to your user name in the game.
4. Start again and choose the port (Enter keeps 25580). Add `gui` for the admin window.
5. Share `your-ip:port`, or a tunnel address for friends outside your network: [server/Tunnel.md](server/Tunnel.md).

In the game: **Multiplayer → Add server → Join**.

## What's here

| | |
| --- | --- |
| `index.html`, `img/` | The website (GitHub Pages) |
| `install.bat`, `install.sh` | Installers: download the server (and Node.js if needed) |
| `server/` | The server: `flysim-server.mjs`, `maps.json`, `admin.html`, start scripts, [README](server/README.md), [Tunnel.md](server/Tunnel.md) |

The server is a single Node.js file with no dependencies. It speaks WebSocket over TCP.
