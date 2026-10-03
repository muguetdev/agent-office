// The areas a server's floor's workers can each look after (see server/servers.ts): what the hire window
// offers there, one at a time or the whole team at once. Each one's first task is its brief: a prompt,
// so it's in English whatever the office speaks; its label is the office's language.
import { L } from '../../i18n';

export interface ServerRole {
  icon: string;
  label: string;
  prompt: string;
}

const brief = (area: string, scope: string) =>
  `You're responsible for ${area} on this floor's server (reach it with the ssh command in AGENTS.md). ${scope}\n\n` +
  'Start by surveying your area read-only: what runs, how it is configured, how healthy it is, and what looks risky or wasteful. ' +
  'Then report what you found, most urgent first, with what you would do about each. Do not change anything on the server until you are asked to.';

export function serverRoles(): ServerRole[] {
  return [
    { icon: '🗄️', label: L.serverRoles.db, prompt: brief('its databases', 'That is PostgreSQL, Redis, ClickHouse or whatever else stores data there: connections, slow queries, disk use, replication, and whether the backups run and can be restored.') },
    { icon: '🛡️', label: L.serverRoles.security, prompt: brief('its security and network', 'That is the firewall and which ports are open to the internet, the reverse proxy (Caddy, nginx) and its TLS, Cloudflare in front of it, SSH and fail2ban, users and keys, and updates.') },
    { icon: '⚙️', label: L.serverRoles.apps, prompt: brief('its applications and APIs', 'That is the backend services (PM2 apps, systemd units, containers): their CPU and memory, restarts, logs and log volume, errors, and how they are started and configured.') },
    { icon: '📈', label: L.serverRoles.monitoring, prompt: brief('its monitoring and alerts', 'That is Prometheus, Alertmanager, exporters, bots and dashboards: what is watched, what is not, which alerts fire or would never fire, and the disk, memory and CPU trends.') },
    { icon: '🎨', label: L.serverRoles.frontends, prompt: brief('its frontends and deploys', 'That is the web apps and sites it serves, how they are built and deployed, which domains route to which app, caching, and how a release reaches the server.') },
  ];
}
