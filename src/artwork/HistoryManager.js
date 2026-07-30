function clone(value) {
  return structuredClone(value);
}

export class HistoryManager {
  constructor({ limit = 100, apply }) {
    this.limit = limit;
    this.apply = apply;
    this.undoStack = [];
    this.redoStack = [];
  }

  commit(label, before, after) {
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    this.undoStack.push({ label, before: clone(before), after: clone(after) });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    return true;
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.apply(clone(entry.before));
    this.redoStack.push(entry);
    return entry.label;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.apply(clone(entry.after));
    this.undoStack.push(entry);
    return entry.label;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  toJSON() {
    return {
      undo: clone(this.undoStack),
      redo: clone(this.redoStack),
    };
  }

  restore(state = {}) {
    this.undoStack = clone(state.undo || []).slice(-this.limit);
    this.redoStack = clone(state.redo || []).slice(-this.limit);
  }
}
