/**
 * Saves or downloads a Blob using the native browser Save File Picker dialog (showSaveFilePicker)
 * if available, or falls back to traditional anchor download link.
 */
export async function saveOrDownloadFile({
  blob,
  suggestedName = 'carton-project.carton',
  types = [
    {
      description: 'CartonBuilder Project (*.carton)',
      accept: { 'application/x-carton-project': ['.carton', '.json'] },
    },
  ],
  windowRef = window,
  documentRef = document,
}) {
  if (typeof windowRef.showSaveFilePicker === 'function') {
    try {
      const handle = await windowRef.showSaveFilePicker({
        suggestedName,
        types,
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      if (err.name === 'AbortError') {
        // User cancelled the native save dialog
        return false;
      }
      console.warn('showSaveFilePicker failed, falling back to download:', err);
    }
  }

  // Fallback for browsers without showSaveFilePicker
  const url = windowRef.URL.createObjectURL(blob);
  const anchor = documentRef.createElement('a');
  anchor.href = url;
  anchor.download = suggestedName;
  documentRef.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  windowRef.setTimeout(() => windowRef.URL.revokeObjectURL(url), 1000);
  return true;
}
