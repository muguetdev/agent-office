// A server's floor's own screens (see server/server-watch.ts): the machine monitor shows how its server's
// doing, and the services board its Docker containers and services, instead of the office machine's and
// its workers' web servers.
import * as THREE from 'three';
import type { ServerState } from '../../../shared/protocol';
import { fmtGb, loadColor } from './machine';
import { L } from '../../i18n';

const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';
const MONO = 'ui-monospace, Menlo, monospace';
const INK = '#0d1117';
const MUTED = '#8b949e';
const GOOD = '#39ff7a';
const BAD = '#ef476f';

function canvasTexture(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return { canvas, g: canvas.getContext('2d')!, texture };
}

/** "3 d 4 h", "5 h 12 min", "8 min". */
export function uptimeLabel(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

const pct = (used: number, total: number) => (total ? Math.round((used / total) * 100) : 0);

/** The machine monitor on a server's floor: its load and memory, with the last few minutes of each, its disk and uptime. */
export class ServerMonitorTexture {
  private c = canvasTexture(920, 520);
  readonly texture = this.c.texture;
  private drawn = '';

  render(s: ServerState | null, name: string) {
    const key = JSON.stringify([s, name]);
    if (key === this.drawn) return;
    this.drawn = key;
    const { g, canvas } = this.c;
    const W = canvas.width;
    const H = canvas.height;
    g.fillStyle = INK;
    g.fillRect(0, 0, W, H);
    g.textAlign = 'left';
    g.fillStyle = '#ffffff';
    g.font = `900 38px ${FONT}`;
    g.fillText(`🖥️ ${name}`, 30, 60);
    const [label, color] = !s ? ['…', MUTED] : s.ok ? [L.serverFloor.online, GOOD] : [L.serverFloor.offline, BAD];
    g.font = `800 28px ${FONT}`;
    const tw = g.measureText(label).width;
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(W - 30 - tw - 32, 24, tw + 32, 48, 24);
    g.fill();
    g.fillStyle = INK;
    g.textAlign = 'center';
    g.fillText(label, W - 30 - (tw + 32) / 2, 58);
    if (!s) return void (this.texture.needsUpdate = true);
    this.panel(30, 96, 415, 'CPU', s.cpu, `load ${s.load.map((n) => n.toFixed(1)).join(' ')} · ${L.machine.cores(s.cpus)}`, s.history.map(([c]) => c));
    this.panel(475, 96, 415, L.machine.memory, pct(s.memUsed, s.memTotal), s.memTotal ? L.machine.of(fmtGb(s.memUsed), fmtGb(s.memTotal)) : '', s.history.map(([, m]) => m));
    // Footer: the disk, how long it's been up, and what runs on it.
    const disk = pct(s.diskUsed, s.diskTotal);
    const failed = s.services.filter((x) => x.state === 'failed').length;
    g.textAlign = 'left';
    g.font = `800 28px ${FONT}`;
    let x = 30;
    for (const [text, c] of [
      [`💾 ${disk}% ${L.serverFloor.ofDisk(fmtGb(s.diskTotal))}`, loadColor(disk)],
      [`⏱ ${uptimeLabel(s.uptime)}`, '#ffffff'],
      ...(s.processes.length ? [[`📦 ${s.processes.filter((x) => x.state === 'online').length}/${s.processes.length}`, s.processes.some((x) => x.state !== 'online') ? BAD : '#ffffff'] as const] : []),
      ...(s.containers.length ? [[`🐳 ${s.containers.filter((x) => x.state === 'running').length}/${s.containers.length}`, '#ffffff'] as const] : []),
      [`⚙️ ${s.services.length - failed}${failed ? ` · ❌ ${failed}` : ''}`, failed ? BAD : '#ffffff'],
    ] as const) {
      g.fillStyle = c;
      g.fillText(text, x, 470);
      x += g.measureText(text).width + 34;
    }
    this.texture.needsUpdate = true;
  }

  private panel(x: number, y: number, w: number, name: string, value: number, sub: string, history: number[]) {
    const { g } = this.c;
    const color = loadColor(value);
    g.fillStyle = '#161b22';
    g.beginPath();
    g.roundRect(x, y, w, 300, 18);
    g.fill();
    g.textAlign = 'left';
    g.fillStyle = MUTED;
    g.font = `800 28px ${FONT}`;
    g.fillText(name, x + 20, y + 42);
    g.fillStyle = color;
    g.font = `900 84px ${FONT}`;
    g.fillText(`${value}%`, x + 20, y + 124);
    g.fillStyle = MUTED;
    g.font = `700 22px ${MONO}`;
    g.fillText(sub, x + 20, y + 160);
    const gx = x + 20;
    const gy = y + 180;
    const gw = w - 40;
    const gh = 100;
    if (history.length < 2) return;
    const step = gw / (history.length - 1);
    g.beginPath();
    history.forEach((v, i) => (i ? g.lineTo : g.moveTo).call(g, gx + i * step, gy + gh - (Math.max(0, Math.min(100, v)) / 100) * gh));
    g.strokeStyle = color;
    g.lineWidth = 4;
    g.stroke();
  }
}

/** The services board on a server's floor: its containers and services, a light each, failed ones first. */
export class ServerServicesTexture {
  private c = canvasTexture(1200, 600);
  readonly texture = this.c.texture;
  private drawn = '';

  render(s: ServerState | null) {
    const rows = [
      ...(s?.services.filter((x) => x.state === 'failed').map((x) => ({ icon: '⚙️', name: x.name, note: L.serverFloor.failed2, ok: false })) ?? []),
      ...(s?.processes.map((x) => ({ icon: '📦', name: x.name, note: `${x.state} · CPU ${Math.round(x.cpu)}% · ${Math.round(x.mem / 2 ** 20)} MB`, ok: x.state === 'online' })) ?? []),
      ...(s?.containers.map((x) => ({ icon: '🐳', name: x.name, note: x.status, ok: x.state === 'running' })) ?? []),
      ...(s?.services.filter((x) => x.state === 'running').map((x) => ({ icon: '⚙️', name: x.name, note: x.status, ok: true })) ?? []),
    ];
    const key = JSON.stringify(rows);
    if (key === this.drawn) return;
    this.drawn = key;
    const { g, canvas } = this.c;
    const W = canvas.width;
    const H = canvas.height;
    g.fillStyle = INK;
    g.fillRect(0, 0, W, H);
    if (!rows.length) {
      g.textAlign = 'center';
      g.fillStyle = '#e9ecef';
      g.font = `900 46px ${FONT}`;
      g.fillText(s ? L.serverFloor.nothingRuns : L.serverFloor.looking, W / 2, H / 2);
      this.texture.needsUpdate = true;
      return;
    }
    // Two columns of up to 8 each.
    const per = 8;
    const shown = rows.slice(0, per * 2);
    const rowH = (H - 30) / per;
    shown.forEach((r, i) => {
      const x = 24 + Math.floor(i / per) * (W / 2);
      const y = 15 + (i % per) * rowH;
      g.beginPath();
      g.arc(x + 18, y + rowH / 2, 11, 0, Math.PI * 2);
      g.fillStyle = r.ok ? GOOD : BAD;
      g.fill();
      g.textAlign = 'left';
      g.fillStyle = '#ffffff';
      g.font = `800 30px ${MONO}`;
      g.fillText(`${r.icon} ${r.name}`.slice(0, 26), x + 42, y + rowH / 2 + 2);
      g.fillStyle = MUTED;
      g.font = `600 20px ${FONT}`;
      g.fillText(r.note.slice(0, 40), x + 42, y + rowH / 2 + 26);
    });
    if (rows.length > shown.length) {
      g.textAlign = 'right';
      g.fillStyle = MUTED;
      g.font = `800 24px ${FONT}`;
      g.fillText(L.serverFloor.more(rows.length - shown.length), W - 24, H - 12);
    }
    this.texture.needsUpdate = true;
  }
}
