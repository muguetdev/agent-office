// How a server's floor's server is doing (see servers.ts): its load, memory, disk and uptime, its Docker
// containers and its services, read over SSH every little while someone's on the floor, for the
// machine monitor and the services board. And restarting one of them, for admins.
import { spawn } from 'node:child_process';
import type { ServerState, ServerUnit } from '../shared/protocol.js';
import { configFile } from './servers.js';

/** How often the server's looked at while someone's on its floor; and, with nobody there, at most. */
const EVERY_MS = 15_000;
const IDLE_MS = 5 * 60_000;
/** How many readings the monitor's graphs go back. */
const HISTORY = 40;
/** A container's or a service's name, as Docker and systemd have them: nothing a shell would read as more. */
export const UNIT_RE = /^[A-Za-z0-9_.@:-]{1,128}$/;
/** The system's own services, which are always there and nobody restarts from the office. */
const SYSTEM = /^(systemd-|dbus|getty@|serial-getty|user@|user-runtime-dir|polkit|rsyslog|cron|snapd|snap\.|unattended-upgrades|multipathd|udisks|upower|accounts-daemon|irqbalance|networkd-dispatcher|ModemManager|packagekit|qemu-guest-agent|apport|blk-availability|console-setup|keyboard-setup|kmod|lvm2|plymouth|setvbuf|ufw|finalrd|e2scrub|grub|open-iscsi|iscsid|lxd|cloud-|apparmor|ssh\b|sshd|chrony|atd|fwupd|thermald|wpa_supplicant|NetworkManager|avahi|bluetooth|cups|rtkit|colord|kerneloops|uuidd|systemd)/;

/** What the server's asked, as one script on ssh's stdin: a line per reading, parsed by `read`. */
const SCRIPT = `
echo "LOAD $(cut -d' ' -f1-3 /proc/loadavg)"
echo "CPUS $(nproc 2>/dev/null || echo 1)"
awk '/^MemTotal:|^MemAvailable:/ {print $1, $2}' /proc/meminfo
df -P -B1 / | awk 'NR==2 {print "DISK", $2, $3}'
echo "UP $(cut -d. -f1 /proc/uptime)"
echo "HOST $(hostname)"
head -1 /proc/stat | sed 's/^cpu /CPU1 /'
sleep 1
head -1 /proc/stat | sed 's/^cpu /CPU2 /'
if command -v docker >/dev/null 2>&1; then docker ps -a --format 'D|{{.Names}}|{{.Image}}|{{.State}}|{{.Status}}' 2>/dev/null | head -60; fi
# PM2's apps: their names and how they're doing, never their environment (it holds their secrets).
if command -v pm2 >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{try{for(const p of JSON.parse(s))console.log(["P",p.name,p.pm2_env.status,p.pm2_env.restart_time,p.monit.cpu,p.monit.memory].join("|"))}catch{}})' | head -60; fi
if command -v systemctl >/dev/null 2>&1; then systemctl list-units --type=service --all --no-legend --plain --no-pager 2>/dev/null | awk '{print "S|" $1 "|" $3 "|" $4}' | head -400; fi
`;

/** One reading, from the script's output. */
export function read(out: string, at = Date.now()): Omit<ServerState, 'history'> {
  const s: Omit<ServerState, 'history'> = { at, ok: true, cpu: 0, load: [0, 0, 0], cpus: 1, memTotal: 0, memUsed: 0, diskTotal: 0, diskUsed: 0, uptime: 0, containers: [], services: [], processes: [] };
  let memAvail = 0;
  const ticks: number[][] = [];
  for (const line of out.split('\n')) {
    const [word, ...rest] = line.trim().split(' ');
    if (word === 'LOAD') s.load = rest.slice(0, 3).map(Number).map((n) => (Number.isFinite(n) ? n : 0)) as [number, number, number];
    else if (word === 'CPUS') s.cpus = Math.max(1, Number(rest[0]) || 1);
    else if (word === 'MemTotal:') s.memTotal = Number(rest[0]) * 1024 || 0;
    else if (word === 'MemAvailable:') memAvail = Number(rest[0]) * 1024 || 0;
    else if (word === 'DISK') [s.diskTotal, s.diskUsed] = [Number(rest[0]) || 0, Number(rest[1]) || 0];
    else if (word === 'UP') s.uptime = Number(rest[0]) || 0;
    else if (word === 'HOST') s.host = rest.join(' ').slice(0, 64);
    else if (word === 'CPU1' || word === 'CPU2') ticks.push(rest.filter(Boolean).map(Number));
    else if (line.startsWith('P|')) {
      const [, name, state, restarts, cpu, mem] = line.split('|');
      if (UNIT_RE.test(name ?? '')) s.processes.push({ name, state: state ?? '', restarts: Number(restarts) || 0, cpu: Number(cpu) || 0, mem: Number(mem) || 0 });
    }
    else if (line.startsWith('D|')) {
      const [, name, image, state, status] = line.split('|');
      if (UNIT_RE.test(name ?? '')) s.containers.push({ name, image: (image ?? '').slice(0, 80), state: state ?? '', status: (status ?? '').slice(0, 60) });
    } else if (line.startsWith('S|')) {
      const [, unit, active, sub] = line.split('|');
      const name = (unit ?? '').replace(/\.service$/, '');
      // The ones that matter: whatever's failed, and what's running that isn't the system's own.
      if (!UNIT_RE.test(name) || (active !== 'failed' && (sub !== 'running' || SYSTEM.test(name)))) continue;
      s.services.push({ name, state: active === 'failed' ? 'failed' : 'running', status: sub ?? '' });
    }
  }
  s.memUsed = Math.max(0, s.memTotal - memAvail);
  // CPU: what wasn't idle (nor waiting on the disk) between the two looks, a second apart.
  if (ticks.length === 2) {
    const d = ticks[1].map((v, i) => v - (ticks[0][i] ?? 0));
    const total = d.reduce((a, b) => a + (b > 0 ? b : 0), 0);
    const idle = (d[3] ?? 0) + (d[4] ?? 0);
    s.cpu = total > 0 ? Math.max(0, Math.min(100, Math.round(((total - idle) / total) * 100))) : 0;
  }
  s.services.sort((a, b) => (a.state === b.state ? a.name.localeCompare(b.name) : a.state === 'failed' ? -1 : 1));
  s.services = s.services.slice(0, 40);
  return s;
}

/** Runs `script` on the floor's server (`ssh <id> sh -s`), with what it printed, or why it couldn't. */
function onServer(dataDir: string, id: string, script: string, timeout = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn('ssh', ['-F', configFile(dataDir, id), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', id, 'sh -s'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => p.kill(), timeout);
    p.stdout.on('data', (d) => (out = (out + d).slice(-512 * 1024)));
    p.stderr.on('data', (d) => (err = (err + d).slice(-4096)));
    p.on('error', (e) => reject(e));
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split('\n').slice(-2).join(' ') || `ssh exited ${code}`));
    });
    p.stdin.end(script);
  });
}

/** Watches one server's floor's server, while its floor is open. */
export class ServerWatch {
  state: ServerState | null = null;
  private timer?: NodeJS.Timeout;
  private looking = false;
  private history: [number, number][] = [];

  constructor(
    private dataDir: string,
    private id: string,
    /** Anyone's on the floor, to see it. */
    private watched: () => boolean,
    /** Whether the floor's still open; once it isn't, the watch stops. */
    private open: () => boolean,
    private changed: (state: ServerState) => void,
  ) {
    void this.look();
    this.timer = setInterval(() => {
      if (!this.open()) return this.stop();
      if (this.watched() || !this.state || Date.now() - this.state.at > IDLE_MS) void this.look();
    }, EVERY_MS);
    // It never keeps the office from closing.
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
  }

  async look(): Promise<void> {
    if (this.looking) return;
    this.looking = true;
    try {
      const r = read(await onServer(this.dataDir, this.id, SCRIPT));
      this.history = [...this.history, [r.cpu, r.memTotal ? Math.round((r.memUsed / r.memTotal) * 100) : 0] as [number, number]].slice(-HISTORY);
      this.state = { ...r, history: this.history };
    } catch (err) {
      this.state = { ...(this.state ?? read('')), at: Date.now(), ok: false, error: (err as Error).message.slice(0, 300), history: this.history };
    }
    this.looking = false;
    this.changed(this.state);
  }

  /** Restarts a container or a service it last saw there. Resolves to what went wrong, if anything. */
  async restart(kind: ServerUnit['kind'], name: string): Promise<string | undefined> {
    const known = (kind === 'container' ? this.state?.containers : kind === 'process' ? this.state?.processes : this.state?.services)?.some((u) => u.name === name);
    if (!known || !UNIT_RE.test(name)) return 'unknown';
    try {
      await onServer(this.dataDir, this.id, { container: `docker restart '${name}'`, process: `pm2 restart '${name}'`, service: `systemctl restart '${name}'` }[kind], 120_000);
      return undefined;
    } catch (err) {
      return (err as Error).message.slice(0, 300);
    } finally {
      void this.look();
    }
  }
}
