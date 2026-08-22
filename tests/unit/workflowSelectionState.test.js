import { describe, expect, it, vi } from 'vitest';
import {
  canPersistWorkflow,
  completeWorkflowBootstrap,
  createWorkflowBootstrapState,
  resolveWorkflowSelection,
} from '../../src/workflow/workflowSelectionState.js';

describe('workflow selection state machine', () => {
  it('keeps Step 0 unavailable during bootstrap and exposes it only for an empty restore', () => {
    const bootstrap = createWorkflowBootstrapState();
    expect(bootstrap).toEqual({ restoring: true, chosen: false, mode: null });
    expect(completeWorkflowBootstrap(bootstrap, 'empty')).toEqual({
      restoring: false,
      chosen: false,
      mode: null,
    });
    expect(completeWorkflowBootstrap(bootstrap, 'example', 'technical')).toEqual({
      restoring: false,
      chosen: true,
      mode: 'technical',
    });
  });

  it('supports first Quick/Technical selection and makes repeat selection a no-op', async () => {
    const commit = vi.fn();

    await expect(resolveWorkflowSelection({
      workflowChosen: false,
      nextMode: 'quick',
      commit,
    })).resolves.toMatchObject({ status: 'selected', mode: 'quick' });
    expect(commit).toHaveBeenLastCalledWith('quick');

    await expect(resolveWorkflowSelection({
      workflowChosen: true,
      currentMode: 'quick',
      nextMode: 'quick',
      commit,
    })).resolves.toEqual({ status: 'repeat', mode: 'quick' });
    expect(commit).toHaveBeenCalledTimes(1);

    await expect(resolveWorkflowSelection({
      workflowChosen: true,
      currentMode: 'quick',
      nextMode: 'technical',
      commit,
    })).resolves.toMatchObject({ status: 'switched', mode: 'technical' });
    expect(commit).toHaveBeenLastCalledWith('technical');
  });

  it('checkpoints and clears artwork before a successful workflow switch', async () => {
    const createCheckpoint = vi.fn().mockResolvedValue(undefined);
    const clearArtwork = vi.fn().mockResolvedValue(undefined);
    const commit = vi.fn();

    await expect(resolveWorkflowSelection({
      workflowChosen: true,
      currentMode: 'quick',
      nextMode: 'technical',
      hasArtwork: true,
      confirmSwitch: vi.fn().mockReturnValue(true),
      createCheckpoint,
      clearArtwork,
      commit,
    })).resolves.toMatchObject({ status: 'switched', mode: 'technical' });

    expect(createCheckpoint).toHaveBeenCalledOnce();
    expect(clearArtwork).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith('technical');
  });

  it('cancels a workflow switch when confirmation is declined', async () => {
    const confirmSwitch = vi.fn().mockReturnValue(false);
    const createCheckpoint = vi.fn();
    const clearArtwork = vi.fn();
    const commit = vi.fn();

    await expect(resolveWorkflowSelection({
      workflowChosen: true,
      currentMode: 'quick',
      nextMode: 'technical',
      hasArtwork: true,
      confirmSwitch,
      createCheckpoint,
      clearArtwork,
      commit,
    })).resolves.toEqual({ status: 'cancelled', mode: 'quick' });

    expect(confirmSwitch).toHaveBeenCalledOnce();
    expect(createCheckpoint).not.toHaveBeenCalled();
    expect(clearArtwork).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('does not switch or clear artwork when checkpoint creation fails', async () => {
    const checkpointError = new Error('checkpoint failed');
    const createCheckpoint = vi.fn().mockRejectedValue(checkpointError);
    const clearArtwork = vi.fn();
    const commit = vi.fn();

    await expect(resolveWorkflowSelection({
      workflowChosen: true,
      currentMode: 'quick',
      nextMode: 'technical',
      hasArtwork: true,
      confirmSwitch: vi.fn().mockReturnValue(true),
      createCheckpoint,
      clearArtwork,
      commit,
    })).resolves.toEqual({ status: 'checkpoint-error', mode: 'quick', error: checkpointError });

    expect(clearArtwork).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('blocks persistence before workflow selection', () => {
    expect(canPersistWorkflow(false)).toBe(false);
    expect(canPersistWorkflow(true)).toBe(true);
  });
});
