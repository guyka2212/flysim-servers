# Let friends join from anywhere: a tunnel

Your FPV Sim server listens on a port on your computer (25580 unless you chose another). People on
the **same Wi-Fi / network** can join right away with your computer's local address, for example
`192.168.1.20:25580` (find it with `ipconfig` on Windows or `ip addr` on Linux).

Friends **outside your network** can't reach that address. You can either open a port on your
router (port forwarding), or use a **tunnel**: a free service that gives your server a public
address and forwards it to your computer, with no router settings. It works just like a Minecraft
server tunnel.

The server speaks WebSocket over plain **TCP**, so any TCP tunnel works. Below: playit.gg (free, easy),
then other options.

---

## playit.gg, step by step

1. **Start your server first.** Double-click `start.bat` (Windows) or run `./start.sh` (Linux) and
   note the port it says it is listening on, e.g. `Listening on port 25580`.

2. **Make an account.** Go to <https://playit.gg> and sign up (free). A Google / Discord login works.

3. **Download the playit agent.** On the playit.gg site choose **Download** and get the program for
   your system:
   - Windows: the `.msi` installer. Install it and run **playit**.
   - Linux: follow the commands on the download page (a `.deb` package, or the plain binary for
     other distributions), then run `playit` in a terminal.

4. **Link the agent to your account.** When the agent starts it shows a link (or opens your browser).
   Open it, log in, and give the agent a name, e.g. `fpv-server`. The agent is now online.

5. **Create the tunnel.** On the playit.gg dashboard: **Tunnels → Add Tunnel**.
   - **Tunnel type:** `TCP` (you can also pick a custom TCP tunnel; do *not* pick a game preset that is UDP only).
   - **Local address:** `127.0.0.1`
   - **Local port:** your server port, e.g. `25580`
   - **Agent:** the agent you just linked.
   - Click **Add Tunnel**.

6. **Copy the public address.** The tunnel shows an address like
   `example-word.gl.joinmc.link:12345` or `147.185.221.20:12345`. That address, **including the
   number after the colon**, is what your friends type in the game.

7. **Test it.** On any device, open `http://<that address>` in a web browser (e.g.
   `http://example-word.gl.joinmc.link:12345`). You should see **"FPV Sim server is running"**.
   If you do, the tunnel works.

8. **Friends join.** In the game: **Multiplayer → Add server**, paste the address, **Save**, then
   **Join**.

9. **Keep the playit agent running** while people play (it can start with Windows; there is an
   option in the agent). If you close it, the address stops working until you open it again; the
   address itself stays the same.

**Owner:** put *your* game user name in `server.settings` (`Owner-user-name=YourName`) so you get the
**Start** button in the lobby.

---

## Other tunnels

All of these forward TCP to `127.0.0.1:<your port>`:

- **ngrok** (<https://ngrok.com>): `ngrok tcp 25580`, then share the `tcp://0.tcp.ngrok.io:12345`
  address *without* `tcp://`: `0.tcp.ngrok.io:12345`. (Free accounts need a card on file for TCP.)
- **Cloudflare Tunnel**, **Tailscale Funnel**, **zrok**, **localtonet**, **pinggy**: any of their TCP
  tunnels works the same way.
- **Tailscale / ZeroTier / Radmin VPN** (a private network instead of a public address): everyone
  installs it, joins your network, and uses your VPN address, e.g. `100.101.102.103:25580`.

## Port forwarding instead

On your router, forward **TCP** port `25580` (or yours) to your computer's local IP, allow it in the
firewall (Windows asks the first time the server starts: tick *Private* and *Public*), and give
friends your public IP (search "what is my ip") with the port: `203.0.113.7:25580`.

## Problems

- **"Could not connect"**: is the server window still open? Is the playit agent online? Does the
  browser test (step 7) show the page?
- **Works at home, not for friends**: they must use the tunnel address, not `192.168…` or `localhost`.
- **"Different game version"**: update the game and run the installer again to update the server.
- **"Port is already in use"**: another program uses that port; start the server on another port,
  and change the tunnel's local port to match.
