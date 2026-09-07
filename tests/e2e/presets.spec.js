import { expect, test } from '@playwright/test';

async function activate(page, label, key = 'Enter') {
  const action = page.getByRole('button', { name: label });
  await action.focus();
  await action.press(key);
}

async function buildReferenceNet(page) {
  await activate(page, 'Add Base Panel to the bottom edge of Front Panel');
  await activate(page, 'Add Top Panel to the top edge of Front Panel');
  await activate(page, 'Add Back Panel to the top edge of Top Panel');
  await activate(page, 'Add Left Panel to the left edge of Front Panel');
  await activate(page, 'Add Right Panel to the right edge of Back Panel');
}

test.describe('Presets button contextual visibility and workflow isolation', () => {
  test.setTimeout(90_000);

  test('preset button is hidden on Step 0, visible on Step 1 & 2, and isolates presets by workflow', async ({ page }) => {
    await page.goto('/');

    // Wait for splash screen to be completely hidden
    await page.locator('#appSplash').waitFor({ state: 'hidden', timeout: 30_000 });

    // 1. Ensure we are on Step 0 (workflow selection)
    if (!(await page.locator('#workflowStep').isVisible())) {
      const workflowStepBtn = page.locator('.step[data-step-target="workflow"]');
      await expect(workflowStepBtn).toBeEnabled({ timeout: 20_000 });
      await workflowStepBtn.click();
      await expect(page.locator('#workflowStep')).toBeVisible();
    }

    // Verify presets button is HIDDEN on Step 0
    await expect(page.locator('.preset-picker-wrap')).toBeHidden();

    // 2. Choose Quick Layout workflow -> Step 1 (box)
    const quickCard = page.locator('button[data-workflow-mode="quick"]');
    await expect(quickCard).toBeEnabled();
    await quickCard.click();
    await expect(page.locator('#boxStep')).toBeVisible();

    // Verify presets button is VISIBLE on Step 1
    await expect(page.locator('.preset-picker-wrap')).toBeVisible();
    await expect(page.locator('#presetTriggerBtn')).toBeVisible();
    await expect(page.locator('#presetTriggerBtn')).toBeEnabled();

    // Open Presets Popover in Quick mode
    await page.locator('#presetTriggerBtn').click();
    await expect(page.locator('#presetPopover')).toBeVisible();

    // Verify Quick Presets are present and Technical Presets are absent
    await expect(page.locator('#presetPopover')).toContainText('Presets Library');
    await expect(page.locator('#presetPopover')).toContainText('Standard Presets');
    await expect(page.locator('#presetPopover .preset-item[data-id="preset-standard"]')).toBeVisible();
    await expect(page.locator('#presetPopover .preset-item[data-id="preset-cube"]')).toBeVisible();
    await expect(page.locator('#presetPopover .preset-item[data-id="preset-tech-rte"]')).toHaveCount(0);
    await expect(page.locator('#presetPopover .preset-item[data-id="preset-tech-ste"]')).toHaveCount(0);
    await expect(page.locator('#presetPopover .preset-item[data-id="preset-tech-tt-sl123"]')).toHaveCount(0);

    // Apply Quick preset standard
    await page.locator('#presetPopover .preset-item[data-id="preset-standard"] button[data-action="apply"]').click();
    await expect(page.locator('#presetPopover')).toBeHidden();

    // Build the 6-panel net to enable Step 2
    await buildReferenceNet(page);

    // 3. Move to Step 2 (Artwork)
    const artworkStepBtn = page.locator('.step[data-step-target="artwork"]');
    await expect(artworkStepBtn).toBeEnabled();
    await artworkStepBtn.click();
    await expect(page.locator('#artworkStep')).toBeVisible();

    // Verify presets button is VISIBLE on Step 2
    await expect(page.locator('.preset-picker-wrap')).toBeVisible();
    await expect(page.locator('#presetTriggerBtn')).toBeVisible();

    // 4. Return to Step 0 (Workflow selection)
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('.step[data-step-target="workflow"]').click();
    await expect(page.locator('#workflowStep')).toBeVisible();

    // Verify presets button is HIDDEN again on Step 0
    await expect(page.locator('.preset-picker-wrap')).toBeHidden();

    // 5. Choose Technical Dieline workflow -> Step 1 (box)
    const technicalCard = page.locator('button[data-workflow-mode="technical"]');
    await expect(technicalCard).toBeEnabled();
    await technicalCard.click();
    await expect(page.locator('#boxStep')).toBeVisible();
    await expect(page.locator('#technicalWorkflowEditor')).toBeVisible();

    // Verify presets button is VISIBLE on Step 1 (Technical)
    await expect(page.locator('.preset-picker-wrap')).toBeVisible();
    await expect(page.locator('#presetTriggerBtn')).toBeVisible();
    await expect(page.locator('#presetTriggerBtn')).toBeEnabled();

    // Open Presets Popover in Technical mode
    await page.locator('#presetTriggerBtn').click();
    await expect(page.locator('#presetPopover')).toBeVisible();

    // Verify Technical Presets are present and Quick Presets are absent
    await expect(page.locator('#presetPopover')).toContainText('Technical Dielines');
    await expect(page.locator('#presetPopover')).toContainText('Standard Technical Dielines');
    await expect(page.locator('#presetPopover .preset-item[data-id="preset-tech-rte"]')).toBeVisible();
    await expect(page.locator('#presetPopover .preset-item[data-id="preset-tech-ste"]')).toBeVisible();
    await expect(page.locator('#presetPopover .preset-item[data-id="preset-tech-tt-sl123"]')).toBeVisible();
    await expect(page.locator('#presetPopover .preset-item[data-id="preset-standard"]')).toHaveCount(0);
    await expect(page.locator('#presetPopover .preset-item[data-id="preset-cube"]')).toHaveCount(0);

    // Apply technical preset: Snap-Lock Bottom (TT_SL123)
    await page.locator('#presetPopover .preset-item[data-id="preset-tech-tt-sl123"] button[data-action="apply"]').click();

    // Popover should close after applying
    await expect(page.locator('#presetPopover')).toBeHidden();

    // Wait for technical validation to be VALID
    await expect(page.locator('#technicalHostValidation')).toHaveText(
      'Structural VALID · Geometry VALID · Contract VALID',
      { timeout: 20_000 }
    );

    // 6. Move to Step 2 (Artwork) in Technical mode
    const techArtworkBtn = page.locator('.step[data-step-target="artwork"]');
    await expect(techArtworkBtn).toBeEnabled({ timeout: 10_000 });
    await techArtworkBtn.click();
    await expect(page.locator('#artworkStep')).toBeVisible({ timeout: 20_000 });

    // Verify presets button is VISIBLE on Step 2 in Technical mode
    await expect(page.locator('.preset-picker-wrap')).toBeVisible();
    await expect(page.locator('#presetTriggerBtn')).toBeVisible();
  });
});
