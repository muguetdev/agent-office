// The code editor's viewer (see code-editor.ts) for the files it shows rather than edits
// (shared/media.ts): pictures (SVG drawn as a picture, so its scripts never run), sound and video
// with their controls, PDFs in the browser's own viewer, a font's letters, and a 3D model (glTF) to
// turn round. Anything else that isn't text, or text too big to edit, gets its size and a download.
// The bytes come from the office's /api/code/raw, as they are.
import type { MediaKind } from '../../shared/media';
import { h } from './dom';
import { L } from '../i18n';

export type ViewKind = MediaKind | 'binary';

export interface MediaPane {
  el: HTMLElement;
  /** The file showing, or null while the editor is on a text file. */
  readonly path: string | null;
  show(file: string, kind: ViewKind): void;
  hide(): void;
}

/** A size in bytes, in words people read. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let n = bytes / 1024;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[u]}`;
}

/** `urlOf(file, download)`: where the office serves a file's bytes (as itself, or as a download). */
export function mediaPane(urlOf: (file: string, download?: boolean) => string): MediaPane {
  const size = h('span.cm-size');
  const fit = h('button.code-tool.hidden', { type: 'button', title: L.code.mediaFitTip }, L.code.mediaFit);
  const out = h('a.code-tool', { target: '_blank', rel: 'noopener' }, L.code.mediaOpen) as HTMLAnchorElement;
  const down = h('a.code-tool', {}, L.code.mediaDownload) as HTMLAnchorElement;
  const stage = h('div.cm-stage');
  const el = h('div.code-media.hidden', {}, h('div.cm-bar', {}, size, h('span.grow'), fit, out, down), stage);
  let path: string | null = null;
  /** What stops the one showing (a sound playing, the 3D loop). */
  let stop: (() => void) | undefined;
  /** Bumped by each show, so a model or font that loads after you've moved on is dropped. */
  let shown = 0;

  const failed = (why: string) => stage.replaceChildren(h('p.cm-note', {}, L.code.mediaFailed(why)));

  function image(src: string) {
    const img = h('img.cm-img', { src, alt: '' }) as HTMLImageElement;
    let actual = false;
    fit.classList.remove('hidden');
    fit.onclick = () => {
      actual = !actual;
      img.classList.toggle('actual', actual);
    };
    img.onload = () => (size.textContent = `${size.textContent} · ${img.naturalWidth}×${img.naturalHeight}`);
    img.onerror = () => failed(L.code.notFound);
    stage.replaceChildren(h('div.cm-checker', {}, img));
  }

  function player(tag: 'audio' | 'video', src: string) {
    const m = h(`${tag}.cm-${tag}`, { src, controls: true, preload: 'metadata', playsinline: true }) as HTMLMediaElement;
    m.onerror = () => failed(L.code.mediaCantPlay);
    stage.replaceChildren(m);
    stop = () => {
      m.pause();
      m.removeAttribute('src');
      m.load();
    };
  }

  async function font(src: string, mine: number) {
    const family = `cm-font-${mine}`;
    try {
      const face = await new FontFace(family, `url("${src}")`).load();
      if (mine !== shown) return;
      document.fonts.add(face);
      stop = () => document.fonts.delete(face);
    } catch (err) {
      if (mine === shown) failed((err as Error).message);
      return;
    }
    const line = (px: number, text: string) => h('p.cm-font', { style: `font-family:'${family}';font-size:${px}px` }, text);
    stage.replaceChildren(
      h(
        'div.cm-fonts',
        {},
        line(56, 'Aa Bb Cc 123'),
        line(32, L.code.mediaPangram),
        line(20, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
        line(20, 'abcdefghijklmnopqrstuvwxyz 0123456789'),
        line(20, '!?@#$%&*()[]{}<>/\\|+-=_.,:;"\'`~^ çãéõüñ'),
        line(14, L.code.mediaPangram),
      ),
    );
  }

  async function model(src: string, mine: number) {
    stage.replaceChildren(h('p.cm-note', {}, L.code.loading));
    // three.js and its loader come with the first model, not before.
    const [THREE, { GLTFLoader }, { OrbitControls }] = await Promise.all([import('three'), import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/controls/OrbitControls.js')]);
    let gltf;
    try {
      gltf = await new GLTFLoader().loadAsync(src);
    } catch (err) {
      if (mine === shown) failed((err as Error).message);
      return;
    }
    if (mine !== shown) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(3, 5, 4);
    scene.add(sun, gltf.scene);
    // Framed to fit, whatever its size.
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.001, box.getSize(new THREE.Vector3()).length() / 2);
    const camera = new THREE.PerspectiveCamera(40, 1, radius / 100, radius * 100);
    camera.position.copy(centre).add(new THREE.Vector3(radius * 1.6, radius * 1.1, radius * 2.2));
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(centre);
    controls.enableDamping = true;
    const mixer = gltf.animations.length ? new THREE.AnimationMixer(gltf.scene) : undefined;
    for (const clip of gltf.animations.slice(0, 1)) mixer?.clipAction(clip).play();
    const holder = h('div.cm-model', {}, renderer.domElement, h('span.cm-hint', {}, L.code.mediaModelHint));
    stage.replaceChildren(holder);
    const clock = new THREE.Clock();
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const { clientWidth: w, clientHeight: hgt } = holder;
      if (w && hgt && (renderer.domElement.width !== Math.floor(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.floor(hgt * renderer.getPixelRatio()))) {
        renderer.setSize(w, hgt, false);
        camera.aspect = w / hgt;
        camera.updateProjectionMatrix();
      }
      mixer?.update(clock.getDelta());
      controls.update();
      renderer.render(scene, camera);
    };
    tick();
    stop = () => {
      cancelAnimationFrame(frame);
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }

  function hide() {
    stop?.();
    stop = undefined;
    shown++;
    path = null;
    stage.replaceChildren();
    el.classList.add('hidden');
  }

  function show(file: string, kind: ViewKind) {
    hide();
    const mine = shown;
    path = file;
    el.classList.remove('hidden');
    size.textContent = '';
    fit.classList.add('hidden');
    const src = urlOf(file);
    out.href = src;
    out.classList.toggle('hidden', kind === 'binary' || kind === 'font' || kind === 'model');
    down.href = urlOf(file, true);
    down.setAttribute('download', file.split('/').pop() ?? 'file');
    // Its size, from the office, without fetching it all.
    void fetch(src, { method: 'HEAD', cache: 'no-store' }).then((r) => {
      const n = Number(r.headers.get('content-length'));
      if (mine === shown && r.ok && Number.isFinite(n)) {
        size.textContent = size.textContent ? `${sizeText(n)} ${size.textContent}` : sizeText(n);
        if (kind === 'binary') stage.replaceChildren(h('p.cm-note', {}, L.code.mediaBinary(sizeText(n))), down.cloneNode(true));
      }
    });
    if (kind === 'image' || kind === 'svg') image(src);
    else if (kind === 'audio' || kind === 'video') player(kind, src);
    else if (kind === 'pdf') stage.replaceChildren(h('iframe.cm-pdf', { src, title: file }));
    else if (kind === 'font') void font(src, mine);
    else if (kind === 'model') void model(src, mine).catch((err: Error) => mine === shown && failed(err.message));
    else stage.replaceChildren(h('p.cm-note', {}, L.code.mediaBinary('')), down.cloneNode(true));
  }

  return {
    el,
    get path() {
      return path;
    },
    show,
    hide,
  };
}
