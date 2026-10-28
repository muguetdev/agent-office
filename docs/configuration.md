# Configuration

Back to the [README](../README.md).

## Where the office keeps things

The office keeps its data in `~/agent-office` (`--home` or `AGENT_OFFICE_HOME` to move it) and clones projects next to it, as `~/agent-office/<owner>/<repo>`. To clone them somewhere else, like `~/Workspace`, an admin picks the **Workspace folder** in ⚙️ Settings → **🏢 Building** (or start with `--projects` or `AGENT_OFFICE_PROJECTS`). Floors you already have stay where they are, and a checkout of the same repository that's already in the new folder is used as it is. The building's map is in `~/agent-office/.agent-office/map.json`, and maps of your own go in `~/agent-office/.agent-office/maps/` (see [Maps](maps.md)). The list of floors is `~/agent-office/.agent-office/floors.json` (the floors each member may go to, and the rooftop bar's guest link, are in `accounts.json`; a server floor's SSH key and config are in `~/agent-office/.agent-office/ssh/`, and its folder is `<workspace>/servers/<floor>`, with its linked repository cloned inside it as `<repo>`), and each account's own Claude and GitHub sign-ins are in `~/agent-office/.agent-office/homes/<account>/` (revoking the account deletes them). Each floor keeps its workers, queue, pictures and worktrees in its own checkout's `.agent-office/`.

Already have a checkout? Pick its repository anyway: a checkout of it that's already where the workspace folder would clone it is used as it is. You can still start the office in a project, `agent-office ~/code/my-project`: that project becomes a floor, and the office keeps its data in `~/code/my-project/.agent-office` as it did before there were floors. An office that already ran in a project carries on in it when you start `agent-office` there again. An admin can take that project off the building in the elevator like any other floor.

## Command line

```
agent-office [dir] [options]

      --home <dir>        Where the office keeps its data without a [dir] (default ~/agent-office)
      --projects <dir>    Where new floors are cloned, as <dir>/<owner>/<repo> (default ~/agent-office;
                          also settable from ⚙️ Settings)
  -p, --port <n>          Port (default 4600, env PORT)
  -H, --host <addr>       Bind address (default 127.0.0.1; 0.0.0.0 lets your network in)
      --password <pw>     Office password (env AGENT_OFFICE_PASSWORD)
      --no-open           Don't open the office in your browser when it starts
      --agent <cmd>       Default agent command (default "claude")
      --agent-args <str>  Extra args for the configured agent, e.g. "--model opus"
      --dsh-profile <n>   DeepSeek Harness profile over ACP (default "acp")
      --tls-cert <file>   Serve HTTPS with this cert…
      --tls-key <file>    …and key
      --self-signed       Serve HTTPS with a generated self-signed cert
      --trust-proxy       Trust X-Forwarded-* (behind Caddy/nginx)
      --turn <url>        Add a TURN server for voice, e.g. turn:user:pass@host:3478
                          (env AGENT_OFFICE_TURN, several separated by spaces)
      --budget <usd>      Daily tracked Claude Code budget (OpenCode/Codex/Grok/Muse/DSH excluded)
      --budget-pause      ...and nobody can hire a new worker until the next day
      --max-workers <n>   Run at most n workers at once, across every floor (env AGENT_OFFICE_MAX_WORKERS)
      --webhook <url>     Post to this Slack / Discord webhook when a worker needs input or finishes
      --city <name>       Put the office in a real city: its sun and live weather (open-meteo.com)
      --weather <kind>    Pin the weather: clear, cloudy, rain, storm, snow or fog
      --real-time-sky     Start the sky on the real clock, not a day an hour (env AGENT_OFFICE_SKY_CLOCK=real; ⚙️ Settings can switch it)

agent-office setup [--projects <dir>] [--project <owner/repo>]... [--home <dir>]

  The first-start walkthrough again: the workspace folder, GitHub sign-in and
  repositories to clone as floors. With --projects / --project it asks nothing.
  Run it while the office is stopped.

agent-office prune [dir] [-n|--dry-run] [-f|--force]

  Removes leftover worker worktrees under .agent-office/worktrees/ and their
  office/* branches, in one floor's checkout (dir). Anything with uncommitted changes or unpushed commits is
  kept unless --force is given. A worker across several projects has worktrees of them in its
  own floor's workspace: prune each project to clear those out.

agent-office accounts [list | invite [name] [--admin] | revoke <name> | role <name> admin|member | password on|off] [-d <dir>]

  Invite, list and revoke people's own accounts, and switch the shared password
  off or on. Works while the office runs.

agent-office tunnel [office@address | url] [--port <n>] [--office-port <n>] [--name <name>] [--password <pw>] [--no-open] [--insecure] [-- <ssh options>]

  On your own computer, for an office that runs somewhere else: every web server
  a worker starts there opens on the same port here, by itself, and closes when
  the worker stops it. Given an SSH address it opens the tunnel to the office too.
  See docs/tunnel.md.
```

The building holds up to **32 project floors**. That's separate from `--max-workers`, which caps the workers running at once across the building.

**Language.** The office speaks the language in `AGENT_OFFICE_LANG` (`en`, `pt-BR` or `ko`), else English (not the terminal's `LANG`, so an office already running doesn't switch on an upgrade), in its notices and errors, its console and what it posts to Slack or Discord. An admin can change it in ⚙️ Settings → Building. Each page is in the language its person picked in ⚙️ Settings → You, or else their browser's.

## Agent machines

Optional, and off until an admin sets it up: a **machines host** gives each worker you choose a desktop computer of its own (Ubuntu with XFCE, viewed in the browser, and Google Chrome with its DevTools open to the office), so it can use websites like a person would while you watch.

1. **The host.** A Linux server with Docker, separate from the office. Install it with the files in [`deploy/machines/`](../deploy/machines/): `install.sh` on the host, as root (its [README](../deploy/machines/README.md) says what it sets up): the machine image, `ce-machines` (which makes, lists and deletes machines) and the forced command that limits what an office's key can do there.
2. **The office.** In ⚙️ Settings → *Building* → **🖥️ Agent machines**, put in the host as `user@host` or `user@host:port`, and this office's name on the host (a slug; it's made from the office's name, and each office on the host needs its own). Save: the office makes an SSH key of its own for it (`<home>/machines/office_key`) and shows its public half with the exact line to run on the host, `ce-machines authorize "<key>" <office>`. Run that there, then press **Test**: it says how many machines are in use and how much memory the host has free.
3. **Each machine's size** (memory, `4g`, and CPUs, `2`; a desktop with Chrome needs about 4 GB, and Chrome gets killed for memory at 2 GB), **how many a floor may have** at once (4), and whether **members** may give the workers on their floors machines, not only admins (on, by default). Guests never may.

The setting is kept in `<home>/machines.json`, the key and the host's key (`known_hosts`, taken the first time and checked after) in `<home>/machines/`, and each worker's machine in its floor's `workers.json`. **Remove** stops new machines; workers that have one keep it until they're sent home.

The office reaches the host only over SSH with that key (`ce-machines …` as the forced command, nothing else), and each machine's desktop and Chrome through an `ssh -N -L` forward of its own to a port on the office's `127.0.0.1` (started again if it drops). The desktop is served to the browser by the office itself at `/api/machines/<worker>/desktop/`. The browser MCP server is run with `npx -y chrome-devtools-mcp@latest`, so the office's machine needs `npx` and a way to npm's registry.

**A shell in the machine.** A worker with a machine also has the `machine` command on its PATH (next to `office-workers`), which talks to the office's hook server with the worker's own token and only ever acts on that worker's machine:

```
machine run [--root] [--timeout <s>] [--cwd <dir>] -- <command…>   # bash in the machine; exits with its exit code
machine put <local-file> <remote-path>                               # copy a file in (up to 100 MB)
machine get <remote-path> <local-file>                               # copy a file out
machine info                                                         # its id, desktop and Chrome, what's installed
```

Commands run as the desktop's user `abc` in `/config` (its home), with `DISPLAY` set to its desktop, for 600 seconds unless `--timeout` says otherwise (3600 at most), and keep the last 1 MB of their output. `abc` has passwordless `sudo`, so `machine run -- sudo apt-get install -y golang-go` works; it's root in that container only (no Docker socket, no `--privileged`). The desktop and Chrome are in the same machine, so a dev server started there is at `localhost` in the worker's Chrome. Claude Code, Codex and OpenCode also get `machine_run`, `machine_put` and `machine_get` as tools of the office's MCP server, and the note a worker with a machine is given says all this. A Claude Code worker may run `machine run` and `machine info` (and `machine_run`) without asking; copying files to or from the office's disk asks as any other command does.

**Updating the host.** `install.sh` rebuilds the image; a machine that's already running keeps the image it was made with until it's made again: take the worker's machine away (🖥️ in its ⚙️) and give it back. `/etc/ce-machines.json` on the host is kept as it is.

## Windows GitHub setup

Install GitHub CLI on the machine running the office, and sign in as the user running it:

```powershell
winget install --id GitHub.cli --source winget
gh auth login
gh auth status
```

A terminal or desktop app opened before installation may keep an older PATH. The office checks PATH first, then the standard `ProgramFiles` and `ProgramFiles(x86)` GitHub CLI folders, and the per-user `LOCALAPPDATA\Programs\GitHub CLI` and `LOCALAPPDATA\Microsoft\WinGet\Links` folders. This lookup applies to repository listing, cloning, terminal setup and account sign-in. Custom installation locations still need to be on the server process's PATH; reopen the launcher after updating PATH. A GitHub sign-in in another user's session or on your browser's machine does not sign in the office server. After signing in, use the elevator's refresh button to reload repositories.
