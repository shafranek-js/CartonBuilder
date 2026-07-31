import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createEditMenu } from '../../src/ui/EditMenu.js';

describe('EditMenu component', () => {
  let triggerButton;
  let popoverContainer;
  let onUndo;
  let onRedo;
  let onReplaceArtwork;
  let onRemoveArtwork;
  let mockWindow;
  let mockDocument;

  beforeEach(() => {
    triggerButton = {
      addEventListener: vi.fn(),
      setAttribute: vi.fn(),
      contains: vi.fn().mockReturnValue(false),
    };
    popoverContainer = {
      hidden: true,
      innerHTML: '',
      querySelector: vi.fn(),
      contains: vi.fn().mockReturnValue(false),
    };
    onUndo = vi.fn();
    onRedo = vi.fn();
    onReplaceArtwork = vi.fn();
    onRemoveArtwork = vi.fn();
    mockWindow = {};
    mockDocument = {
      addEventListener: vi.fn(),
    };
  });

  it('initializes and attaches click listeners to triggerButton', () => {
    createEditMenu({
      triggerButton,
      popoverContainer,
      onUndo,
      onRedo,
      onReplaceArtwork,
      onRemoveArtwork,
      windowRef: mockWindow,
      documentRef: mockDocument,
    });

    expect(triggerButton.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
  });
});
