# Command Express machines host

A **machines host** is a Linux server that runs "machines" for Command Express
offices. A machine is a Docker container that gives one AI coding agent its own
desktop computer:

- an XFCE desktop in the browser (linuxserver.io webtop / Selkies) on container
  port 3000, served under a path prefix;
- Google Chrome, started with the desktop and restarted if it is closed, with
  the Chrome DevTools Protocol (CDP) on container port 9223;
- git, curl, build-essential, Python 3 + pip + venv, Node.js LTS + npm, VS Code,
  pt_BR/en_US UTF-8 locales and Noto fonts (including colour emoji);
- passwordless `sudo` for the desktop's user `abc`, so an agent can install
  what it needs (`sudo apt-get install -y golang-go`), and a shell in the
  machine for its office (`ce-machines exec`, `put`, `get`).

A desktop with Chrome needs about **4 GB** of memory (Chrome is killed for
memory at 2 GB), which is the default size.

Offices never get a shell on the host. They run one command,
`ce-machines`, over SSH with their own key, and reach their machines' desktop
and CDP ports through SSH local port forwards. Nothing but SSH (port 22) is
exposed to the internet.

```
office ──ssh (forced command)──▶ ce-machines-ssh <office> ──▶ ce-machines ──▶ docker
office ──ssh -L 127.0.0.1:<port> (whitelisted ports only)──▶ machine desktop / CDP
```

## Files

| Path | What |
| --- | --- |
| `Dockerfile` | The machine image, `command-express/machine:latest`. |
| `rootfs/etc/s6-overlay/s6-rc.d/svc-chrome` | s6 service: Chrome with CDP on 127.0.0.1:9222, restarted by s6 when it exits. |
| `rootfs/etc/s6-overlay/s6-rc.d/svc-cdp-proxy` | s6 service: socat relaying 0.0.0.0:9223 → 127.0.0.1:9222. |
| `rootfs/usr/local/bin/bwrap` | Keeps XFCE's panel and desktop from crashing on their icons under the seccomp profile (see below). |
| `seccomp/chrome.json` | Seccomp profile for machines (Docker's default plus namespace syscalls). |
| `seccomp/make-profile.py` | Regenerates `chrome.json` from Docker's default profile. |
| `bin/ce-machines` | The control command (Python 3, standard library only). |
| `bin/ce-machines-ssh` | Forced command for office SSH keys. |
| `install.sh` | Installs/updates everything on a host (idempotent). |

## Install

On a fresh Ubuntu 24.04 (or similar) server, as root, with only SSH open:

```sh
# copy this folder to the server, then:
cd machines-host
./install.sh            # installs Docker if missing, builds the image, installs the scripts
SKIP_BUILD=1 ./install.sh   # re-install the scripts only
```

`install.sh` is safe to re-run. It:

1. installs Docker (`docker.io`) and Python 3 if they are missing;
2. builds `command-express/machine:latest` (`docker build --pull`; about 3–4
   minutes on a 10-CPU VPS once the base image is cached);
3. installs `/usr/local/bin/ce-machines`, `/usr/local/bin/ce-machines-ssh` and
   `/usr/local/share/ce-machines/seccomp-chrome.json`, creates an empty
   `/etc/ce-machines.json` if there is none;
4. re-syncs office keys and prints the relevant `sshd -T` settings, warning if
   `AllowTcpForwarding` or `PermitRootLogin` would block offices.

It does not open firewall ports or touch `authorized_keys`.

Recommended host hardening (not done by `install.sh`): key-only SSH
(`PasswordAuthentication no`, `PermitRootLogin prohibit-password`), a firewall
allowing only 22/tcp, fail2ban, unattended-upgrades. Docker-published ports
bypass ufw, which is why every machine port is bound to `127.0.0.1`.

### Settings

`/etc/ce-machines.json` overrides the defaults in `bin/ce-machines`
(`DEFAULTS`). Common keys:

```json
{
  "defaultMem": "4g",
  "defaultCpus": "4",
  "pidsLimit": 4096,
  "shmSize": "2g",
  "reserveMem": "3g",
  "subfolder": "/api/machines/{id}/desktop/",
  "tz": "America/Sao_Paulo",
  "readyTimeout": 90,
  "execTimeout": 600,
  "execMaxTimeout": 3600,
  "execOutputMax": 1048576,
  "fileMax": 104857600
}
```

`install.sh` never overwrites an existing `/etc/ce-machines.json`.

**Updating.** Re-running `install.sh` rebuilds the image, but a machine that
already exists keeps running the image it was created with. It gets the new
one when it is made again (`delete` + `create`; from an office: take the
worker's machine away and give it back).

## CLI contract

Every command prints one JSON value on stdout. On failure it prints
`{"error": "<message>"}` and exits non-zero. Sizes are bytes; times are UTC
ISO 8601.

Validation: `<id>` and office names match `^[a-z0-9][a-z0-9-]{0,39}$`;
`--mem` matches `^[0-9]+[mg]$` and must be 512m–8g; `--cpus` is a number
from 1 to 4. Machine ids are global on the host (container `ce-<id>`), so
offices should prefix their ids (e.g. `<office>-<agent>`).

### `ce-machines ping`

```json
{"ok": true, "version": "1"}
```

### `ce-machines status`

```json
{"cpus": 10, "memTotal": 25198452736, "memAvailable": 21499609088,
 "machines": 1, "maxMachines": 10, "canCreate": true}
```

`machines` counts every machine on the host (all offices).
`maxMachines = floor((memTotal - reserveMem) / defaultMem)`.

### `ce-machines create <id> [--mem 4g] [--cpus 2]`

Creates the machine, or starts it if it already exists (and belongs to the
caller's office), then waits until the desktop answers HTTP 200 at its
subfolder and CDP answers `/json/version` (up to `readyTimeout`, 90 s):

```json
{"id": "t1", "state": "running", "desktopPort": 32772, "cdpPort": 32773,
 "created": "2026-10-28T17:17:28Z", "new": true}
```

`desktopPort`/`cdpPort` are random host ports on 127.0.0.1; they can change
when a machine is restarted, so always take them from `create`/`list` right
before opening forwards. `new` is false when an existing machine was returned.
Errors include `host is at capacity (N of M machines)`, `not enough memory on
host ...` (sum of memory limits would exceed `memTotal - reserveMem`) and
`machine id X is in use by another office`.

Run as root on the host, `--office NAME` sets the owner (default `default`).
Over SSH the office is always the key's office and `--office` is refused.

Container settings: name `ce-<id>`, labels `ce.machine=1`, `ce.id`, `ce.office`;
`--memory`/`--memory-swap` = `--mem`, `--cpus`, `--pids-limit 4096`,
`--shm-size 2g`, `--restart unless-stopped`, volume `ce-<id>-config` on
`/config` (home directory, Chrome profile; survives restarts),
`-p 127.0.0.1::3000 -p 127.0.0.1::9223`, env `SUBFOLDER`, `TITLE`, `TZ`,
seccomp profile `seccomp-chrome.json`. No `--privileged`, no Docker socket,
no host network.

### `ce-machines delete <id>`

Stops and removes the container and its `/config` volume. Idempotent:

```json
{"id": "t1", "deleted": true}
```

### `ce-machines list`

The caller's office's machines (as root: all machines, or `list --office NAME`):

```json
[{"id": "t1", "office": "test", "state": "running", "desktopPort": 32772,
  "cdpPort": 32773, "created": "2026-10-28T17:17:28Z", "memUsage": 459276288}]
```

`memUsage` is bytes from `docker stats` (null when the machine is not running).

### `ce-machines exec <id> [--root] [--timeout S] [--cwd DIR] -- <command…>`

Runs one command line with bash inside a running machine of the caller's
office: `docker exec -u abc|root -w <cwd> -e DISPLAY=:1 ce-<id> timeout -k 10
<S> bash -lc <command>` (an argument vector; the line is read by bash in the
container, never by a shell on the host). Defaults: user `abc`, cwd `/config`
(its home), timeout 600 s (at most `execMaxTimeout`, 3600). Instead of
`-- <command…>`, `--command-b64 <base64>` (and `--cwd-b64`) carry it as base64,
which is what offices send: it passes SSH's command line and shlex unchanged.

```json
{"exitCode": 0, "stdout": "go version go1.26.8 linux/amd64\n", "stderr": "",
 "truncated": false, "timedOut": false}
```

stdout and stderr keep their last `execOutputMax` bytes (1 MB) each;
`truncated` says one was cut. On timeout, the command's whole process group
gets SIGTERM (SIGKILL 10 s later), `exitCode` is 124 and `timedOut` true. A
command the machine couldn't start (a `--cwd` that isn't there) comes back as
exit code 126/127 with docker's message in `stderr`. Something started in the
background (`nohup npm run dev > dev.log 2>&1 &`) keeps running after it.

### `ce-machines put <id> <dest-path> [--root]` / `get <id> <path> [--root]`

`put` writes its stdin to `<dest-path>` in the machine (folders made as
needed) and answers `{"id", "path", "bytes"}`; `get` writes the file to
stdout, raw (the one command that doesn't answer in JSON, unless it fails).
Paths are absolute, with no control characters (`--path-b64 <base64>` too);
files up to `fileMax` (100 MB). They run as `abc` unless `--root`.

### Root-only commands (not available over SSH)

- `ce-machines authorize "<ssh public key>" <office>` → `{"office": "...", "authorized": true}`
- `ce-machines revoke <office>` → `{"office": "...", "revoked": <lines removed>}`
- `ce-machines sync-keys` → `{"ok": true}` (re-writes office port whitelists; run automatically on create/delete)

## Authorizing an office

On the office side, create a dedicated key (no passphrase, used only for this):

```sh
ssh-keygen -t ed25519 -N "" -f ~/.ssh/ce-machines
```

On the host, as root:

```sh
ce-machines authorize "$(cat ce-machines.pub)" my-office
```

The office then calls:

```sh
ssh -i ~/.ssh/ce-machines -o IdentitiesOnly=yes root@HOST ce-machines create my-office-a1
ssh -i ~/.ssh/ce-machines -o IdentitiesOnly=yes -N \
    -L 23000:127.0.0.1:<desktopPort> -L 29223:127.0.0.1:<cdpPort> root@HOST
```

Forward targets must be written as `127.0.0.1` (not `localhost`); sshd matches
them literally. To remove an office: `ce-machines revoke my-office` (its
machines are not deleted; delete them first if wanted).

## Security model

- **Only SSH is exposed.** Machine ports are published on 127.0.0.1 of the
  host only, on random ports.
- **Office keys are boxed in.** `authorize` writes a line like:

  ```
  restrict,command="/usr/local/bin/ce-machines-ssh my-office",port-forwarding,permitopen="127.0.0.1:32772",permitopen="127.0.0.1:32773",permitlisten="127.0.0.1:1" ssh-ed25519 AAAA... ce-office:my-office
  ```

  `restrict` disables PTY, agent/X11 forwarding and `~/.ssh/rc`; the forced
  command means the key can never get a shell; `permitopen` lists exactly the
  desktop/CDP ports of *that office's* machines, so an office cannot reach
  another office's machines or any other local service. The list is rewritten
  under a lock every time machines are created, started or deleted (with no
  machines the key gets no forwarding at all). `permitlisten` pins remote
  (`-R`) forwards to loopback port 1, which in practice disables them
  (authorized_keys accepts neither `none` nor port 0 there).
  `permitopen="127.0.0.1:*"` also works on OpenSSH 9.6 if a host prefers a
  looser rule, but it would let an office reach every loopback port.
- **No shell parsing.** `ce-machines-ssh` splits `$SSH_ORIGINAL_COMMAND` with
  `shlex` into argv, allows only `ping|status|list|create|delete|exec|put|get`,
  rejects `--office` (before exec's `--`), control characters and commands
  over 1 KiB (120 000 characters for `exec`, whose command line is there), and calls
  `ce-machines` in-process with the office name. `ce-machines` validates every
  value and calls Docker with argument vectors only.
- **Office scoping.** `list` shows only the office's machines; `create`,
  `delete`, `exec`, `put` and `get` refuse ids owned by another office. The
  office itself only ever runs `exec`/`put`/`get` in the machine of the worker
  whose hook token asked (see the office's `machine` command).
- **Containers.** No `--privileged`, no Docker socket, no host network,
  memory/CPU/PID limits, default capabilities. The desktop's user `abc` has
  passwordless `sudo` (`/etc/sudoers.d/abc`, checked with `visudo -c` at
  build), and `exec --root` runs as root, which is fine because the container
  is the agent's machine: root there is root in that container only, under the
  same seccomp profile, AppArmor profile and capabilities. `apt-get` works
  (tested: `sudo apt-get install -y golang-go`).
- **Seccomp.** Chrome's sandbox needs user/PID/network namespaces. With
  Docker's default seccomp profile Chrome aborts ("Failed to move to new
  namespace ... Operation not permitted"). Rather than `seccomp=unconfined`
  (no syscall filter at all, as the webtop docs suggest) or Chrome's
  `--no-sandbox`, machines use `seccomp/chrome.json`: Docker's default profile
  with only `clone`, `unshare` and `setns` allowed unconditionally. Chrome then
  runs with its full sandbox. Trade-off: processes in a machine can create
  user namespaces, a known kernel attack surface; keep the host kernel
  patched (unattended-upgrades). Mounting stays forbidden (seccomp and
  Docker's AppArmor profile), so `bwrap` gets as far as "Failed to make /
  slave". The image's image loaders (glycin, used by XFCE's panel and desktop
  for every icon) don't recognise that message and keep trying bwrap, so
  without help the panel and desktop crash at start, leaving a black screen
  with only Chrome. `rootfs/usr/local/bin/bwrap` answers the way glycin
  expects when bwrap can't work, and it then loads images unsandboxed, as it
  does under Docker's default profile.
- **No passwords** anywhere; the desktop has no login of its own and is only
  reachable through the office's SSH forward (and the office's own auth in
  front of its proxy).
- **Not isolated:** disk usage (no per-container quota on overlay2) and
  outbound network (machines can reach the internet, by design).

## The desktop's size

Selkies resizes the desktop to the size of the browser window (or iframe)
showing it, and follows it when that changes (its `enable_resize` setting,
on by default; don't set `SELKIES_MANUAL_WIDTH`/`HEIGHT`, which lock it,
1024×768 when only one is given). Chrome starts maximized (`--start-maximized`
in `svc-chrome`) and the window manager keeps it so as the desktop grows or
shrinks, so the desktop and Chrome fill whatever shows them.

## Putting the desktop behind a reverse proxy

The desktop is served by nginx inside the machine under `SUBFOLDER`
(default `/api/machines/<id>/desktop/`). The proxy must forward that prefix
**unchanged** (do not strip it) to `127.0.0.1:<desktopPort>` on the office side
of the SSH forward:

- page and assets: `GET <prefix>` (with trailing slash) and below;
- WebSocket: `<prefix>api/websockets` (the stream, input, clipboard); other
  HTTP endpoints under `<prefix>api/` (upload, print, turn).
- Pass `Upgrade`/`Connection: upgrade`, use HTTP/1.1, long read timeouts
  (hours) and no response buffering. Selkies does not check `Origin`
  (`SELKIES_ALLOWED_ORIGINS=*`) and needs no special headers.
- Redirect `<prefix-without-slash>` to `<prefix>`.

CDP (`cdpPort`) notes: Chrome only answers `/json/*` when the `Host` header is
an IP address or `localhost`, and refuses DevTools WebSockets that carry an
`Origin` header (Playwright/Puppeteer clients send none). The
`webSocketDebuggerUrl` it returns uses the Host it was asked with.

## Measurements (10-CPU / 23 GB VPS, Docker 29)

- Image `command-express/machine:latest`: 7.6 GB on disk (1.9 GB compressed);
  the webtop base alone is 5.2 GB. Build: ~3.5 min with the base cached.
- `create` → ready: ~5–7 s (3 concurrent creates finished in ~9 s).
- RAM per machine: ~440 MiB idle (desktop + Chrome on `about:blank`, nobody
  watching); ~630 MiB after a desktop viewing session with a page open.
- PIDs: ~415 idle, ~740 with the desktop streamed and two tabs; raise
  `pidsLimit` if agents run heavy parallel builds.
