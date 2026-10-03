/**
 * The office TV: the screen someone on the floor is sharing, or its idle card while nobody is. What's
 * shared, and watching it full screen, is features/voice's.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import { hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { L } from '../../i18n';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    tv: true;
  }
}

export interface TvDeps {
  /** The screens shared on this floor, by who's sharing them (see features/voice). */
  shares(): [string, MediaStream][];
  /** Watches what's on the TV full screen, or shares your screen when nobody's sharing (see features/voice). */
  watch(): void;
}

export function installTv(ctx: Ctx, deps: TvDeps) {
  // TV
  const tvVideo = document.createElement('video');
  tvVideo.muted = true;
  tvVideo.playsInline = true;
  tvVideo.autoplay = true;
  const tvTexture = new THREE.VideoTexture(tvVideo);
  tvTexture.colorSpace = THREE.SRGBColorSpace;
  const idleCanvas = document.createElement('canvas');
  idleCanvas.width = 1280;
  idleCanvas.height = 720;
  const tvIdle = new THREE.CanvasTexture(idleCanvas);
  tvIdle.colorSpace = THREE.SRGBColorSpace;
  /** The idle card: the office's, or on a server's floor a terminal with the server's name and address. */
  let drawn: string | undefined;
  function drawIdle() {
    const f = store.currentFloor();
    const key = f?.ssh ? `${f.name}|${f.ssh.user}@${f.ssh.host}` : '';
    if (key === drawn) return;
    drawn = key;
    const g = idleCanvas.getContext('2d')!;
    if (f?.ssh) {
      g.fillStyle = '#07090c';
      g.fillRect(0, 0, 1280, 720);
      g.fillStyle = '#39ff7a';
      g.textAlign = 'left';
      g.font = '700 46px ui-monospace, Menlo, monospace';
      const at = `${f.ssh.user}@${f.ssh.host}${f.ssh.port === 22 ? '' : `:${f.ssh.port}`}`;
      [`$ ssh ${f.id}`, `${L.serverFloor.tvConnected} ${at}`, '', `🖥️  ${f.name}`, '', `${f.ssh.user}@${f.id}:~$ █`].forEach((line, i) => g.fillText(line, 90, 150 + i * 80));
    } else {
      const grad = g.createLinearGradient(0, 0, 1280, 720);
      grad.addColorStop(0, '#3a0ca3');
      grad.addColorStop(1, '#4cc9f0');
      g.fillStyle = grad;
      g.fillRect(0, 0, 1280, 720);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = '900 88px Nunito, ui-rounded, system-ui, sans-serif';
      g.fillText(L.main.tvTitle, 640, 330);
      g.font = '700 44px Nunito, ui-rounded, system-ui, sans-serif';
      g.fillText(L.main.tvIdle, 640, 420);
    }
    tvIdle.needsUpdate = true;
  }
  drawIdle();
  store.on('floors', drawIdle);
  store.on('floor', drawIdle);
  const tvMat = ctx.office.tvScreen.material as THREE.MeshBasicMaterial;
  tvMat.color.set('#ffffff');
  tvMat.map = tvIdle;
  tvMat.toneMapped = false;
  ctx.interactions.define('tv', {
    reach: 10,
    hint: () => {
      const any = deps.shares().length > 0;
      return { k: String(any), parts: [hintTitle(L.main.tvTitle), key('E', any ? L.hints.watchFull : L.hints.shareYours)] };
    },
    use: onE(() => deps.watch()),
  });

  let tvStream: MediaStream | null = null;
  /** Puts `stream` up on the TV, or the idle card when there's none. */
  function show(stream: MediaStream | null) {
    if (stream !== tvStream) {
      tvStream = stream;
      tvVideo.srcObject = stream;
      if (stream) void tvVideo.play().catch(() => {});
      tvMat.map = stream ? tvTexture : tvIdle;
      tvMat.needsUpdate = true;
    }
  }

  return { show };
}
