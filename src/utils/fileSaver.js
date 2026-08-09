/**
 * Reserve the native save destination while the user activation from the
 * initiating click is still alive. Archive/render work can then happen before
 * the destination is written without losing the first-click picker.
 */
export async function requestSaveDestination({
  suggestedName = 'carton-project.carton',
  types = [
    {
      description: 'CartonBuilder Project (*.carton)',
      accept: { 'application/x-carton-project': ['.carton', '.json'] },
    },
  ],
  windowRef = window,
}) {
  if (typeof windowRef.showSaveFilePicker === 'function') {
    try {
      const handle = await windowRef.showSaveFilePicker({
        suggestedName,
        types,
      });
      return { kind: 'native', handle };
    } catch (err) {
      if (err.name === 'AbortError') {
        // User cancelled the native save dialog
        return null;
      }
      console.warn('showSaveFilePicker failed, falling back to download:', err);
    }
  }

  return { kind: 'download' };
}

async function writeNativeDestination({ destination, blob, signal, onProgress = null }) {
  const writable = await destination.handle.createWritable();
  try {
    if (signal?.aborted) throw new DOMException('File write aborted.', 'AbortError');
    if (typeof blob?.stream === 'function' && typeof blob.size === 'number' && typeof onProgress === 'function') {
      const reader = blob.stream().getReader();
      let written = 0;
      try {
        for (;;) {
          if (signal?.aborted) throw new DOMException('File write aborted.', 'AbortError');
          const { done, value } = await reader.read();
          if (done) break;
          await writable.write(value);
          written += value.byteLength || value.length || 0;
          onProgress(written, blob.size);
        }
      } finally {
        reader.releaseLock?.();
      }
    } else {
      await writable.write(blob);
      onProgress?.(blob.size || 1, blob.size || 1);
    }
    await writable.close();
    return true;
  } catch (error) {
    try {
      await writable.abort?.();
    } catch {
      // Best effort cleanup; the original error is more useful to callers.
    }
    throw error;
  }
}

export async function writeSaveDestination({
  destination,
  blob,
  suggestedName = 'carton-project.carton',
  windowRef = window,
  documentRef = document,
  signal,
  onProgress = null,
}) {
  if (!destination) return false;
  if (destination.kind === 'native') {
    return writeNativeDestination({ destination, blob, signal, onProgress });
  }

  // Fallback for browsers without showSaveFilePicker
  if (signal?.aborted) throw new DOMException('File download aborted.', 'AbortError');
  const url = windowRef.URL.createObjectURL(blob);
  const anchor = documentRef.createElement('a');
  anchor.href = url;
  anchor.download = suggestedName;
  documentRef.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  windowRef.setTimeout(() => windowRef.URL.revokeObjectURL(url), 1000);
  onProgress?.(1, 1);
  return true;
}

/**
 * Backwards-compatible one-shot API for callers that do not need to reserve a
 * native destination before asynchronous work starts.
 */
export async function saveOrDownloadFile({
  blob,
  suggestedName = 'carton-project.carton',
  types,
  windowRef = window,
  documentRef = document,
  signal,
  onProgress = null,
}) {
  const destination = await requestSaveDestination({ suggestedName, types, windowRef });
  return writeSaveDestination({
    destination,
    blob,
    suggestedName,
    windowRef,
    documentRef,
    signal,
    onProgress,
  });
}
