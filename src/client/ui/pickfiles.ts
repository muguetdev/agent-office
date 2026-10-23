// The browser's own file picker, for buttons that take files from your computer (📎 in a worker's
// terminal, ⬆️ Upload in its Code tab): `onPick` gets what you picked, and nothing if you cancel.
export function pickFiles(onPick: (files: File[]) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.hidden = true;
  // In the page while it's open: Safari won't open a picker for an input that isn't.
  document.body.append(input);
  const done = () => input.remove();
  input.addEventListener('cancel', done);
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    done();
    if (files.length) onPick(files);
  });
  input.click();
}
