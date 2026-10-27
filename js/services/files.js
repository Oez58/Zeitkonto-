// Dateien speichern und öffnen, passend zum Gerät.
// Laptop (Chrome/Edge): Speicherort frei wählbar.
// Handy: Teilen-Menü, z.B. "In Dateien sichern" auf dem iPhone. Sonst normaler Download.

const isTouch = () => matchMedia('(pointer: coarse)').matches;

export async function saveFile(data, filename, mime, description = 'Datei') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const ext = '.' + filename.split('.').pop();

  if (window.showSaveFilePicker && !isTouch()) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description, accept: { [mime]: [ext] } }] });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return 'saved';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      // sonst normaler Download als Rückfall
    }
  }

  if (isTouch() && navigator.canShare) {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return 'shared';
      } catch (e) {
        if (e.name === 'AbortError') return 'cancelled';
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}

/** Öffnet die Dateiauswahl und liefert den Text der gewählten Datei. */
export function pickTextFile(accept = '.json,application/json') {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) return resolve(null);
      try {
        resolve({ name: f.name, text: await f.text() });
      } catch (e) {
        reject(e);
      }
    });
    document.body.appendChild(input);
    input.click();
  });
}
