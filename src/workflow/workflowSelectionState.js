export function normalizeWorkflowMode(mode) {
  return mode === 'technical' ? 'technical' : 'quick';
}

export function createWorkflowBootstrapState() {
  return {
    restoring: true,
    chosen: false,
    mode: null,
  };
}

export function completeWorkflowBootstrap(state, result, restoredMode = null) {
  const restored = result === 'autosave' || result === 'example';
  return {
    restoring: false,
    chosen: restored,
    mode: restored ? normalizeWorkflowMode(restoredMode) : null,
  };
}

export function canPersistWorkflow(workflowChosen) {
  return Boolean(workflowChosen);
}

export async function resolveWorkflowSelection({
  currentMode = null,
  workflowChosen = false,
  nextMode,
  hasArtwork = false,
  confirmSwitch = () => true,
  createCheckpoint = async () => {},
  clearArtwork = async () => {},
  commit = () => {},
}) {
  const normalizedMode = normalizeWorkflowMode(nextMode);

  if (workflowChosen && normalizedMode === currentMode) {
    return { status: 'repeat', mode: normalizedMode };
  }

  if (hasArtwork && !confirmSwitch()) {
    return { status: 'cancelled', mode: currentMode };
  }

  if (hasArtwork) {
    try {
      await createCheckpoint();
    } catch (error) {
      return { status: 'checkpoint-error', mode: currentMode, error };
    }
    await clearArtwork();
  }

  commit(normalizedMode);
  return {
    status: workflowChosen ? 'switched' : 'selected',
    mode: normalizedMode,
  };
}
