export const ArtworkKind = Object.freeze({
  PDF: 'pdf',
  PDF_AI: 'pdf-compatible-ai',
  REJECTED: 'rejected',
});

export function classifyArtwork({ recognized, isPDF, extension }) {
  if (!recognized) {
    return {
      kind: ArtworkKind.REJECTED,
      errorCode: extension === 'ai' ? 'aiNotPdfCompatible' : 'pdfDamaged',
    };
  }
  if (!isPDF) {
    return {
      kind: ArtworkKind.REJECTED,
      errorCode: extension === 'ai' ? 'aiNotPdfCompatible' : 'pdfDamaged',
    };
  }
  return {
    kind: extension === 'ai' ? ArtworkKind.PDF_AI : ArtworkKind.PDF,
    errorCode: null,
  };
}

export function classifyArtworkWithMuPdf(mupdf, bytes, extension) {
  let recognized = false;
  let isPDF = false;
  try {
    const document = mupdf.Document.openDocument(bytes, 'application/pdf');
    isPDF = document.isPDF();
    document.destroy();
    recognized = true;
  } catch {
    recognized = false;
  }
  return classifyArtwork({ recognized, isPDF, extension });
}
