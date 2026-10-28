// The machines host as an admin set it up in ⚙️ Settings (machines.json in the office's data dir), and
// the office's own SSH key for it (in <dataDir>/machines/), made the first time it's needed.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MachinesSettings } from '../../shared/protocol.js';
import {
  MACHINE_CPUS_DEFAULT,
  MACHINE_CPUS_MAX,
  MACHINE_CPUS_MIN,
  MACHINE_ID_RE,
  MACHINE_MEM_DEFAULT,
  MACHINE_MEM_RE,
  MACHINES_PER_FLOOR_DEFAULT,
  MACHINES_PER_FLOOR_MAX,
  parseMachinesHost,
  slug,
} from '../../shared/machines.js';
import { keyPath, machinesDir } from './ssh.js';

/** What the host calls this office when nobody's named it: the office's name, else the machine's. */
export function defaultOfficeName(officeName: string): string {
  return slug(officeName) || slug(os.hostname()) || 'office';
}

/** The setting as it's kept, with anything missing or wrong put back to its default. */
export function cleanSettings(v: unknown, officeName: string): MachinesSettings {
  const s = (v && typeof v === 'object' ? v : {}) as Partial<MachinesSettings>;
  const cpus = Number(s.cpus);
  const perFloor = Number(s.perFloor);
  return {
    host: typeof s.host === 'string' && parseMachinesHost(s.host) ? s.host.trim() : '',
    office: typeof s.office === 'string' && MACHINE_ID_RE.test(s.office) ? s.office : defaultOfficeName(officeName),
    mem: typeof s.mem === 'string' && MACHINE_MEM_RE.test(s.mem) ? s.mem : MACHINE_MEM_DEFAULT,
    cpus: Number.isFinite(cpus) && cpus >= MACHINE_CPUS_MIN && cpus <= MACHINE_CPUS_MAX ? Math.round(cpus * 100) / 100 : MACHINE_CPUS_DEFAULT,
    perFloor: Number.isInteger(perFloor) && perFloor >= 1 && perFloor <= MACHINES_PER_FLOOR_MAX ? perFloor : MACHINES_PER_FLOOR_DEFAULT,
    members: typeof s.members === 'boolean' ? s.members : true,
  };
}

export class MachinesConfig {
  private file: string;
  settings: MachinesSettings;

  constructor(
    private dataDir: string,
    private officeName: string,
  ) {
    this.file = path.join(dataDir, 'machines.json');
    let saved: unknown;
    try {
      saved = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      saved = undefined;
    }
    this.settings = cleanSettings(saved, officeName);
  }

  /** The host, when one is set up. */
  get target() {
    return this.settings.host ? parseMachinesHost(this.settings.host) : undefined;
  }

  save(next: MachinesSettings) {
    this.settings = cleanSettings(next, this.officeName);
    try {
      writeFileSync(this.file, JSON.stringify(this.settings, null, 2), { mode: 0o600 });
    } catch {
      // a full disk shouldn't take the office down
    }
  }

  /** The office's key for the host: made the first time, kept after. Its public half, or undefined when ssh-keygen isn't there. */
  publicKey(make = true): string | undefined {
    const key = keyPath(this.dataDir);
    try {
      if (!existsSync(key)) {
        if (!make) return undefined;
        mkdirSync(machinesDir(this.dataDir), { recursive: true, mode: 0o700 });
        execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `command-express-${this.settings.office}`, '-f', key], { stdio: 'ignore' });
      }
      return readFileSync(`${key}.pub`, 'utf8').trim();
    } catch {
      return undefined;
    }
  }
}
