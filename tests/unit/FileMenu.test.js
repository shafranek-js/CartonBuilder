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

  it('disables persistence commands until a workflow is selected', () => {
    createFileMenu({
      triggerButton,
      popoverContainer,
      canPersistProject: () => false,
      windowRef: mockWindow,
      documentRef: mockDocument,
    });

    const triggerClick = triggerButton.addEventListener.mock.calls
      .find(([eventName]) => eventName === 'click')[1];
    triggerClick({ stopPropagation: vi.fn() });

    expect(popoverContainer.innerHTML).toMatch(/id="menuSaveProjectBtn" disabled/);
    expect(popoverContainer.innerHTML).toMatch(/id="menuPlaceArtworkBtn" disabled/);
    expect(popoverContainer.innerHTML).toMatch(/id="menuExportPngBtn" disabled/);
    expect(popoverContainer.innerHTML).toMatch(/id="menuExportSvgBtn" disabled/);
    expect(popoverContainer.innerHTML).toMatch(/id="menuNewProjectBtn"(?! disabled)/);
    expect(popoverContainer.innerHTML).toMatch(/id="menuOpenProjectBtn"(?! disabled)/);
  });
});
