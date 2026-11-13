// What's still on screen with a phone's keyboard up. iOS (and Chrome on Android, by default) only
// shrinks the visual viewport for it, so a window as tall as the screen would have its bottom, and
// the box being typed in, under the keyboard. The page's windows read these instead on a phone
// (styles/base.css): --vv-h, how tall the visible part is, and --vv-top, how far down it starts.
const vv = typeof window !== 'undefined' ? window.visualViewport : null;
if (vv) {
  const root = document.documentElement;
  const sync = () => {
    root.style.setProperty('--vv-h', `${Math.round(vv.height)}px`);
    root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
  };
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  sync();
}
