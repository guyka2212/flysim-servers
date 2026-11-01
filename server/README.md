# FPV Sim server

Multiplayer server for FPV Sim. Runs on Windows and Linux (and macOS) with Node.js 18+; the
installer fetches a private copy of Node.js if you don't have it.

## Start

| | Windows | Linux |
| --- | --- | --- |
| Start (asks for the port) | `start.bat` | `./start.sh` |
| Start on a port | `start.bat 25580` | `./start.sh 25580` |
| With the admin window | `start.bat gui` | `./start.sh gui` |

The first start makes **eula.txt** and **server.settings** and stops: change `eula=false` to
`eula=true` in eula.txt, then start again. Without `gui` the server needs no desktop, so it runs on a
headless Linux box or VPS too (use `screen` / `tmux` / a systemd service to keep it running).

The port you type is saved; press Enter next time to keep it. Players join with
`your-address:port`; for friends outside your network, see **Tunnel.md**.

## server.settings

`key=value`, one per line; `true` / `false` switch things on and off, numbers are numbers. Save the
file and type `reload` in the server window (or restart).

| Setting | Default | What it does |
| --- | --- | --- |
| `server-name` | My FPV Sim server | Name in the server list and lobby |
| `motd` | Welcome!… | Message in the lobby |
| `port` | 25580 | TCP port |
| `Owner-user-name` | (empty) | **Your** game user name: you get the Start button and can run commands from the game |
| `max-drones` | 16 | Most players at once |
| `drone-collision` | true | Drones bump into each other |
| `drone-show` | true | Players see each other (false: everyone flies alone on the same map) |
| `show-names` | true | Names float above the drones |
| `voting-time` | 30 | Seconds the map vote lasts (ends early when everyone voted) |
| `min-players` | 1 | Players needed before the owner can start |
| `allow-teleport` | true | Players may use the map (M) to teleport |
| `allow-recording` | true | Players may record (V) |
| `maps` | all | Maps in the vote: `all` or ids, e.g. `paris,lake,stadium` |
| `password` | (empty) | Players must type it to join |
| `whitelist` | false | Only names in whitelist.txt (one per line) may join |
| `state-rate` | 20 | Position updates per second (10-30) |

## How a round works

Everyone who joins waits in the **lobby** and sees who is in. When the owner presses **Start**, a
**map vote** begins: every player picks a map; the most votes wins, and a tie is decided at random.
Everyone loads the map and flies together. The owner can press **Start** again (or type `lobby`) to
end the round and go back to the lobby for a new vote.

## Commands (type in the server window)

| Command | |
| --- | --- |
| `help` | All commands |
| `list` | Who is online (name, IP, drone, ping) |
| `kick <name> [reason]` | Remove a player |
| `ban <name> [reason]` / `unban <name>` / `banlist` | Keep someone out (by name, and by IP when they connect directly) |
| `tp <name> <target>` / `tpall <target>` | Teleport a player (or everyone) to a player |
| `say <text>` | Message everyone |
| `vote` / `map <id>` / `maps` / `lobby` | Start the vote, force a map, list maps, end the round |
| `owner <name>` | Set the owner |
| `set <key> <value>` / `settings` / `reload` | Change and show settings |
| `stop` | Shut down |

The owner can also run these from the game (Multiplayer lobby → console field).

## Files

| File | |
| --- | --- |
| `flysim-server.mjs` | The server |
| `maps.json` | The map list for the vote (the maps themselves are in the game) |
| `admin.html` | The admin window for `gui` (only on this computer: `127.0.0.1`) |
| `server.settings`, `eula.txt` | Made on first start |
| `banned.json`, `whitelist.txt`, `server.log` | Bans, the optional whitelist, the log |
| `runtime/` | Private Node.js, if the installer had to download it |
