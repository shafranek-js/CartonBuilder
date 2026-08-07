export function createDocumentRegistry() {
  const documents = new Map();

  return {
    open(docId, document) {
      if (documents.has(docId)) {
        documents.get(docId).destroy();
      }
      documents.set(docId, document);
      return document;
    },

    get(docId) {
      return documents.get(docId) || null;
    },

    has(docId) {
      return documents.has(docId);
    },

    close(docId) {
      const document = documents.get(docId);
      if (!document) return false;
      documents.delete(docId);
      document.destroy();
      return true;
    },

    closeAll() {
      for (const document of documents.values()) {
        try {
          document.destroy();
        } catch {
          // keep closing the remaining documents
        }
      }
      documents.clear();
    },

    get size() {
      return documents.size;
    },
  };
}
