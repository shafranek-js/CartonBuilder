import { expect, test } from '@playwright/test';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { BoxNetModel } from '../../src/model/BoxNetModel.js';

async function chooseWorkflow(page, mode) {
  const card = page.locator(`button[data-workflow-mode="${mode}"]`);
  if (!(await card.isVisible())) {
    const workflowStep = page.locator('.step[data-step-target="workflow"]');
    await expect(workflowStep).toBeVisible({ timeout: 20_000 });
    await expect(workflowStep).toBeEnabled({ timeout: 20_000 });
    await workflowStep.click();
    await expect(page.locator('#workflowStep')).toBeVisible();
  }
  await expect(card).toBeEnabled();
  if (await card.getAttribute('aria-pressed') !== 'true' || !(await page.locator('#boxStep').isVisible())) {
    await card.click();
  }
  await expect(page.locator('#boxStep')).toBeVisible();
}

async function quickState(page) {
  return page.evaluate(() => window.cartonBuilderApp.getState().cartonSource.box);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.step')).toHaveCount(5);
});

test('Quick Layout exposes only manual Custom Net controls and preserves six-panel artwork surfaces', async ({ page }) => {
  await chooseWorkflow(page, 'quick');

  await expect(page.locator('.construction-library')).toHaveCount(0);
  for (const id of [
    'constructionTemplate',
    'constructionResetDefaults',
    'constructionParameters',
    'constructionGlue',
    'constructionTuck',
    'constructionDust',
    'constructionEar',
    'constructionStatus',
    'constructionDisclaimer',
  ]) {
    await expect(page.locator(`#${id}`)).toHaveCount(0);
  }
  await expect(page.locator('#boxWidth')).toBeVisible();
  await expect(page.locator('#boardCaliper')).toBeVisible();
  await expect(page.locator('#panelCount')).toHaveText('1/6');

  for (const label of [
    'Add Base Panel to the bottom edge of Front Panel',
    'Add Top Panel to the top edge of Front Panel',
    'Add Back Panel to the top edge of Top Panel',
    'Add Left Panel to the left edge of Front Panel',
    'Add Right Panel to the right edge of Back Panel',
  ]) {
    await page.getByRole('button', { name: label }).click();
  }

  await expect(page.locator('#panelCount')).toHaveText('6/6');
  const state = await quickState(page);
  expect(state.construction).toEqual({
    templateId: 'legacy-six-panel',
    templateVersion: 1,
    parameters: {},
  });
  expect(state.panels.map((panel) => panel.id).sort()).toEqual([
    'back', 'bottom', 'front', 'left', 'right', 'top',
  ]);
  expect(state.elements.map((element) => element.id)).toEqual([
    'front', 'bottom', 'top', 'back', 'left', 'right',
  ]);
  expect(JSON.stringify(state)).not.toMatch(/"templateId":"(ste|rte)"/);
});

test('Quick preset, Reset Box and New Project keep the Custom Net invariant', async ({ page }) => {
  await chooseWorkflow(page, 'quick');
  await page.locator('#presetTriggerBtn').click();
  await page.locator('[data-id="preset-standard"] [data-action="apply"]').click();
  expect((await quickState(page)).construction.templateId).toBe('legacy-six-panel');

  await page.getByRole('button', { name: 'Add Base Panel to the bottom edge of Front Panel' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#cancelButton').click();
  await expect(page.locator('#panelCount')).toHaveText('1/6');
  expect((await quickState(page)).construction).toEqual({
    templateId: 'legacy-six-panel',
    templateVersion: 1,
    parameters: {},
  });

  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.locator('#menuNewProjectBtn').click();
  await expect(page.locator('#workflowStep')).toBeVisible();
  await chooseWorkflow(page, 'quick');
  expect((await quickState(page)).construction.templateId).toBe('legacy-six-panel');

  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());
  await page.reload();
  await expect(page.locator('#boxStep')).toBeVisible();
  expect((await quickState(page)).construction).toEqual({
    templateId: 'legacy-six-panel',
    templateVersion: 1,
    parameters: {},
  });
});

for (const templateId of ['ste', 'rte']) {
  test(`old Quick ${templateId.toUpperCase()} archive is converted once with a warning`, async ({ page }) => {
    const oldState = new BoxNetModel(
      { width: 180, height: 110, depth: 45 },
      { caliperMm: 0.55 },
      { templateId, parameters: {} },
    ).toJSON();
    const snapshot = {
      schemaVersion: 17,
      meta: { name: `Old Quick ${templateId} construction` },
      workflowStep: 'box',
      workflowSelection: 'quick',
      cartonSource: { mode: 'quick', box: oldState },
      artworks: [],
      activeArtworkIndex: -1,
      render: {},
      prepress: {},
      view: {},
      history: { undo: [], redo: [] },
    };
    const writer = new ZipWriter(new BlobWriter('application/zip'));
    await writer.add('manifest.json', new TextReader(JSON.stringify({
      format: 'carton-builder-project',
      version: 5,
      assets: [],
      previews: [],
      renderAssets: [],
    })));
    await writer.add('project.json', new TextReader(JSON.stringify(snapshot)));
    const archive = await writer.close();

    await page.locator('#projectFileInput').setInputFiles({
      name: `old-quick-${templateId}.carton`,
      mimeType: 'application/zip',
      buffer: Buffer.from(await archive.arrayBuffer()),
    });
    await expect(page.locator('#boxStep')).toBeVisible();
    await expect(page.locator('#toast')).toContainText('converted to Custom Net');

    const state = await quickState(page);
    expect(state.construction).toEqual({
      templateId: 'legacy-six-panel',
      templateVersion: 1,
      parameters: {},
    });
    expect(state.dimensions).toEqual({ width: 180, height: 110, depth: 45 });
    expect(state.board).toEqual({ caliperMm: 0.55 });
    expect(state.panels).toHaveLength(6);
    expect(state.elements.every((element) => element.role === 'body')).toBe(true);
    expect(JSON.stringify(state)).not.toMatch(/glue|tuck|dust|lock/i);
  });
}

test('Technical Dieline remains the lazy PBD workflow', async ({ page }) => {
  await chooseWorkflow(page, 'technical');
  await expect(page.locator('#technicalHostFrame')).toHaveAttribute('src', /plugins\/packaging-box-designer\/1\.2\.0\/index\.html/);
  await expect(page.locator('#technicalHostValidation')).toHaveText(
    'Structural VALID · Geometry VALID · Contract VALID',
    { timeout: 20_000 },
  );
  await expect(page.locator('#constructionTemplate')).toHaveCount(0);
});
