import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createFileMenu } from '../../src/ui/FileMenu.js';

describe('FileMenu component', () => {
  let triggerButton;
  let popoverContainer;
  let onOpenProject;
  let onSaveProject;
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
    onOpenProject = vi.fn();
    onSaveProject = vi.fn();
    mockWindow = {
      confirm: vi.fn().mockReturnValue(true),
      setTimeout: vi.fn(),
      location: { reload: vi.fn() },
    };
    mockDocument = {
      addEventListener: vi.fn(),
    };
  });

  it('initializes and attaches click listeners to triggerButton', () => {
    createFileMenu({
      triggerButton,
      popoverContainer,
      onOpenProject,
      onSaveProject,
      windowRef: mockWindow,
      documentRef: mockDocument,
    });

    expect(triggerButton.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
  });
});
