import { readFile } from 'node:fs/promises';

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
  degrees,
  rgb,
} from 'pdf-lib';
import { expect, test } from '@playwright/test';
import { sha256 } from '../../src/artwork/fileValidation.js';
import { TechnicalCartonDocument } from '../../src/carton/TechnicalCartonDocument.js';
import { createTechnicalBoxModelAdapter } from '../../src/carton/technicalBoxModelAdapter.js';
import { createTechnicalPresentationProjection } from '../../src/carton/technicalPresentation.js';
import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import { arcToCubicSegments, getDielineSegments } from '../../src/model/dieline.js';
import { createProjectArchive } from '../../src/project/projectArchive.js';

async function activate(page, label, key = 'Enter') {
  const action = page.getByRole('button', { name: label });
  await action.focus();
  await action.press(key);
}

async function chooseWorkflow(page, mode) {
  const card = page.locator(`button[data-workflow-mode="${mode}"]`);
  if (!(await card.isVisible())) {
    await page.locator('.step[data-step-target="workflow"]').click();
    await expect(page.locator('#workflowStep')).toBeVisible();
  }
  if (await card.getAttribute('aria-pressed') !== 'true' || !(await page.locator('#boxStep').isVisible())) {
    await card.click();
  }
  await expect(page.locator('#boxStep')).toBeVisible();
}

async function buildReferenceNet(page) {
  await chooseWorkflow(page, 'quick');
  await activate(page, 'Add Base Panel to the bottom edge of Front Panel');
  await activate(page, 'Add Top Panel to the top edge of Front Panel');
  await activate(page, 'Add Back Panel to the top edge of Top Panel');
  await activate(page, 'Add Left Panel to the left edge of Front Panel');
  await activate(page, 'Add Right Panel to the right edge of Back Panel');
}

async function openMenuExport(page, group, buttonSelector) {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.locator('#menuExportItem').hover();
  const groupIndex = group === '3d' ? 1 : 0;
  await page.locator('#menuExportItem > .file-menu-submenu > .file-menu-submenu-anchor').nth(groupIndex).hover();
  return page.locator(buttonSelector);
}

async function openFileAction(page, buttonSelector) {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.locator('#fileMenuPopover')).toBeVisible();
  return page.locator(buttonSelector);
}

async function openEditAction(page, buttonSelector) {
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('#editMenuPopover')).toBeVisible();
  return page.locator(buttonSelector);
}

async function openArtworkStep(page) {
  await buildReferenceNet(page);
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#artworkStep')).toBeVisible();
}

async function loadGeneratedPng(page, fileName = 'sample-artwork.png') {
  await page.evaluate(async (name) => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 400;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f6cf43';
    context.fillRect(0, 0, 600, 400);
    context.fillStyle = '#2657c8';
    context.fillRect(40, 40, 520, 320);
    context.fillStyle = '#ffffff';
    context.font = 'bold 54px sans-serif';
    context.textAlign = 'center';
    context.fillText('CARTON', 300, 220);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], name, { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.getElementById('artworkFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, fileName);
  await expect(page.locator('#artworkFileName')).toHaveText(fileName);
  await expect(page.locator('#processingOverlay')).toBeHidden();
}

async function loadGeneratedVectorPdf(page, fileName = 'vector-artwork.pdf', { replace = true } = {}) {
  const source = await PDFDocument.create();
  const pdfPage = source.addPage([720, 480]);
  pdfPage.drawRectangle({ x: 0, y: 0, width: 720, height: 480, color: rgb(0.2, 0.4, 0.8) });
  const bytes = await source.save();
  if (replace) {
    page.once('dialog', (dialog) => dialog.accept());
    await (await openEditAction(page, '#menuReplaceArtworkBtn')).click();
  }
  await page.locator('#artworkFileInput').setInputFiles({
    name: fileName,
    mimeType: 'application/pdf',
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator('#artworkFileName')).toHaveText(fileName, { timeout: 20_000 });
  await expect(page.locator('#processingOverlay')).toBeHidden();
}

async function inspectFlatPdfDownload(download) {
  const bytes = await readFile(await download.path());
  const document = await PDFDocument.load(bytes);
  const page = document.getPage(0);
  const resources = page.node.Resources();
  const properties = resources.lookup(PDFName.of('Properties'), PDFDict);
  const xObjects = resources.lookup(PDFName.of('XObject'), PDFDict);
  const xObjectSubtypes = xObjects.entries().map(([, reference]) => {
    const object = document.context.lookup(reference);
    return (object?.dict || object)?.get(PDFName.of('Subtype'))?.asString() || null;
  });
  const contents = page.node.lookup(PDFName.of('Contents'), PDFArray);
  let content = '';
  for (let index = 0; index < contents.size(); index += 1) {
    const stream = document.context.lookup(contents.get(index));
    content += stream instanceof PDFRawStream
      ? new TextDecoder().decode(decodePDFRawStream(stream).decode())
      : stream.getUnencodedContentsString();
  }
  return {
    bytes,
    document,
    page,
    properties,
    xObjectSubtypes,
    content,
  };
}

async function loadTechnicalFixtureBoxModel(cartonType) {
  const fixture = JSON.parse(await readFile(
    new URL(`../../src/workflow/fixtures/${cartonType.toLowerCase()}-workflow.v1.json`, import.meta.url),
    'utf8',
  ));
  const document = await TechnicalCartonDocument.create(fixture);
  return createTechnicalBoxModelAdapter(document);
}

function decodeXmlText(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

async function loadRenderBackground(page, fileName = 'checkpoint-background.png') {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext('2d');
    context.fillStyle = '#2b5cff';
    context.fillRect(0, 0, 8, 8);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await page.locator('#renderBackgroundFile').setInputFiles({
    name: fileName,
    mimeType: 'image/png',
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator('#renderBackgroundFileName')).toHaveText(fileName);
}

async function captureCheckpointFingerprint(page) {
  return page.evaluate(async () => {
    const digestBlob = async (blob) => {
      if (!(blob instanceof Blob)) return null;
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      return {
        size: blob.size,
        type: blob.type,
        sha256: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
      };
    };
    const payload = await window.cartonBuilderApp.artwork.createProjectCheckpoint();
    const snapshot = structuredClone(payload.snapshot);
    if (snapshot.meta) snapshot.meta.updatedAt = '<normalized>';
    return {
      snapshot,
      artworkBlobs: await Promise.all(payload.artworkBlobs.map(async (entry) => ({
        originalBlob: await digestBlob(entry.originalBlob),
        previewBlob: await digestBlob(entry.previewBlob),
      }))),
      renderAssets: await Promise.all(payload.renderAssets.map(async ({ blob, ...metadata }) => ({
        metadata,
        blob: await digestBlob(blob),
      }))),
      technicalAssets: payload.technicalAssets ? {
        modelBlob: await digestBlob(payload.technicalAssets.modelBlob),
        svgBlob: await digestBlob(payload.technicalAssets.svgBlob),
      } : null,
    };
  });
}

async function captureLiveFingerprint(page) {
  return page.evaluate(async () => {
    const digestBlob = async (blob) => {
      if (!(blob instanceof Blob)) return null;
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    };
    const snapshot = window.cartonBuilderApp.getState();
    if (snapshot.meta) snapshot.meta.updatedAt = '<normalized>';
    return {
      snapshot,
      originalSha256: await digestBlob(window.cartonBuilderApp.artwork.originalBlob),
      previewSha256: await digestBlob(window.cartonBuilderApp.artwork.previewBlob),
      renderAssets: await Promise.all(window.cartonBuilderApp.render.getRenderAssets().map(async ({ blob, ...metadata }) => ({
        metadata,
        sha256: await digestBlob(blob),
      }))),
    };
  });
}

async function createTechnicalArtworkProject(page, artworkName = 'technical-checkpoint.png', cartonType = 'RTE') {
  await chooseWorkflow(page, 'technical');
  const frame = page.frameLocator('#technicalHostFrame');
  await expect(page.locator('#technicalHostValidation')).toHaveText(
    'Structural VALID · Geometry VALID · Contract VALID',
    { timeout: 20_000 },
  );
  if (cartonType !== 'RTE') {
    await frame.locator('#cartonType').selectOption(cartonType);
    await expect(page.locator('#technicalHostValidation')).toHaveText(
      'Structural VALID · Geometry VALID · Contract VALID',
    );
  }
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#artworkStep')).toBeVisible();
  await loadGeneratedPng(page, artworkName);
  return frame;
}

async function snapTechnicalArtworkToTarget(page, kind, { bypass = false } = {}) {
  const target = await page.evaluate(({ targetKind }) => {
    const app = window.cartonBuilderApp;
    const snapTargets = app.artwork.getSnapTargets();
    const distanceToBoundary = (point, segment) => {
      let best = Infinity;
      for (let index = 0; index <= 32; index += 1) {
        const fraction = index / 32;
        const sample = segment.kind === 'ARC'
          ? (() => {
            const start = Math.atan2(segment.start.y - segment.center.y, segment.start.x - segment.center.x);
            const end = Math.atan2(segment.end.y - segment.center.y, segment.end.x - segment.center.x);
            const delta = segment.clockwise
              ? ((start - end) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)
              : ((end - start) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
            const angle = segment.clockwise ? start - delta * fraction : start + delta * fraction;
            return {
              x: segment.center.x + segment.radius * Math.cos(angle),
              y: segment.center.y + segment.radius * Math.sin(angle),
            };
          })()
          : {
            x: segment.start.x + (segment.end.x - segment.start.x) * fraction,
            y: segment.start.y + (segment.end.y - segment.start.y) * fraction,
          };
        best = Math.min(best, Math.hypot(point.x - sample.x, point.y - sample.y));
      }
      return best;
    };
    const candidates = snapTargets.semanticTargets.filter((entry) => entry.kind === targetKind && entry.point);
    const boundaries = snapTargets.panelBoundaries;
    const target = candidates.slice().sort((first, second) => {
      const firstDistance = Math.min(...boundaries.map((boundary) => distanceToBoundary(first.point, boundary.segment)));
      const secondDistance = Math.min(...boundaries.map((boundary) => distanceToBoundary(second.point, boundary.segment)));
      return secondDistance - firstDistance || String(first.id).localeCompare(String(second.id));
    })[0];
    if (!target) throw new Error(`No semantic ${targetKind} target is available`);
    const model = app.artwork.artwork;
    model.setScaleX(0.03);
    model.setScaleY(0.03);
    model.setVisibleCenter(target.point.x, target.point.y);
    app.artwork.render();
    return {
      id: target.id,
      kind: target.kind,
      point: { x: target.point.x, y: target.point.y },
      halfExtents: {
        x: model.displayedWidthMm / 2,
        y: model.displayedHeightMm / 2,
      },
    };
  }, { targetKind: kind });
  const image = page.locator('#artworkWorkspace image.artwork-image').last();
  const imageBox = await image.boundingBox();
  if (!imageBox) throw new Error('Technical artwork image has no screen bounds');
  const targetScreen = await page.evaluate((point) => {
    const svg = document.getElementById('artworkWorkspace');
    const svgPoint = svg.createSVGPoint();
    svgPoint.x = point.x;
    svgPoint.y = point.y;
    const screen = svgPoint.matrixTransform(svg.getScreenCTM());
    return { x: screen.x, y: screen.y };
  }, {
    x: target.point.x + (kind === 'panel-center' ? 0 : target.halfExtents.x),
    y: target.point.y + (kind === 'panel-center' ? 0 : target.halfExtents.y),
  });
  const start = {
    x: imageBox.x + imageBox.width / 2,
    y: imageBox.y + imageBox.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  if (bypass) {
    await page.keyboard.down('Control');
    await page.mouse.move(targetScreen.x, targetScreen.y, { steps: 1 });
    await page.keyboard.up('Control');
    await expect(page.locator('.snap-guide')).toHaveCount(0);
  } else {
    await page.mouse.move(targetScreen.x, targetScreen.y, { steps: 1 });
    const guide = page.locator(`.snap-guide[data-snap-kind="${kind}"]`);
    const guideCount = await guide.count();
    if (guideCount !== 1) {
      const diagnostic = await page.evaluate(() => {
        const app = window.cartonBuilderApp;
        const svg = document.getElementById('artworkWorkspace');
        const targets = app.artwork.getSnapTargets().semanticTargets;
        return {
          center: { x: app.artwork.artwork.centerXmm, y: app.artwork.artwork.centerYmm },
          zoom: app.artwork.renderer.viewport.zoom,
          guides: [...svg.querySelectorAll('.snap-guide')].map((node) => ({
            kind: node.dataset.snapKind,
            id: node.dataset.snapId,
          })),
          targetKinds: targets.reduce((counts, target) => {
            counts[target.kind] = (counts[target.kind] || 0) + 1;
            return counts;
          }, {}),
        };
      });
      throw new Error(`Expected semantic guide ${kind}; target=${JSON.stringify(target)} screen=${JSON.stringify(targetScreen)} diagnostic=${JSON.stringify(diagnostic)}`);
    }
    await expect(guide).toHaveAttribute('data-snap-id', target.id);
    const snapped = await page.evaluate(() => ({
      x: window.cartonBuilderApp.artwork.artwork.centerXmm,
      y: window.cartonBuilderApp.artwork.artwork.centerYmm,
    }));
    const expectedCenter = kind === 'panel-center'
      ? target.point
      : {
        x: target.point.x + target.halfExtents.x,
        y: target.point.y + target.halfExtents.y,
      };
    expect(snapped.x).toBeCloseTo(expectedCenter.x, 4);
    expect(snapped.y).toBeCloseTo(expectedCenter.y, 4);
  }
  await page.mouse.up();
  await expect(page.locator('.snap-guide')).toHaveCount(0);
  return target;
}

async function chooseTechnicalVerticalBoundary(page) {
  return page.evaluate(() => {
    const app = window.cartonBuilderApp;
    const target = app.artwork.getSnapTargets().panelBoundaries
      .filter((entry) => entry.segment?.kind === 'LINE')
      .filter((entry) => Math.abs(entry.segment.start.x - entry.segment.end.x) < 1e-7)
      .sort((first, second) => (
        first.segment.start.x - second.segment.start.x
        || String(first.id).localeCompare(String(second.id))
      ))[0];
    if (!target) throw new Error('No vertical Technical panel boundary is available');
    return {
      id: target.id,
      x: target.segment.start.x,
      y: (target.segment.start.y + target.segment.end.y) / 2,
    };
  });
}

async function prepareTechnicalSideBoundary(page) {
  const target = await chooseTechnicalVerticalBoundary(page);
  await page.evaluate(({ x, y }) => {
    const app = window.cartonBuilderApp;
    const model = app.artwork.artwork;
    model.setScaleX(0.08);
    model.setScaleY(0.08);
    model.setVisibleCenter(x - model.displayedWidthMm / 2 - 2, y);
    app.artwork.render();
  }, target);
  return target;
}

async function dragTechnicalSideToBoundary(page, target) {
  const handle = page.locator('.resize-side-handle[data-resize-side="e"]');
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('Technical east resize handle has no screen bounds');
  const targetScreen = await page.evaluate(({ x, y }) => {
    const svg = document.getElementById('artworkWorkspace');
    const point = svg.createSVGPoint();
    point.x = x;
    point.y = y;
    const screen = point.matrixTransform(svg.getScreenCTM());
    return { x: screen.x, y: screen.y };
  }, target);
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetScreen.x, targetScreen.y, { steps: 2 });
  const guide = page.locator(`.snap-guide[data-snap-kind="panel-boundary"][data-snap-id="${target.id}"]`);
  if (await guide.count() !== 1) {
    const diagnostic = await page.evaluate((screenPoint) => {
      const app = window.cartonBuilderApp;
      const model = app.artwork.artwork;
      const svg = document.getElementById('artworkWorkspace');
      return {
        center: { x: model.centerXmm, y: model.centerYmm },
        visibleCenter: model.visibleCenter,
        width: model.displayedWidthMm,
        height: model.displayedHeightMm,
        handleBox: document.querySelector('.resize-side-handle[data-resize-side="e"]')?.getBoundingClientRect().toJSON(),
        elementAtHandle: (() => {
          const box = document.querySelector('.resize-side-handle[data-resize-side="e"]')?.getBoundingClientRect();
          const node = box ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) : null;
          return node?.outerHTML?.slice(0, 240) || node?.getAttribute?.('data-resize-side') || node?.className?.baseVal || node?.className || node?.tagName;
        })(),
        targetScreen: screenPoint,
        elementAtTarget: document.elementFromPoint(screenPoint.x, screenPoint.y)?.className?.baseVal
          || document.elementFromPoint(screenPoint.x, screenPoint.y)?.className
          || document.elementFromPoint(screenPoint.x, screenPoint.y)?.tagName,
        guides: [...svg.querySelectorAll('.snap-guide')].map((node) => ({
          kind: node.dataset.snapKind,
          id: node.dataset.snapId,
        })),
        targetCount: app.artwork.getSnapTargets().panelBoundaries.length,
      };
    }, targetScreen);
    throw new Error(`Expected exact Technical side boundary guide: ${JSON.stringify(diagnostic)}`);
  }
  const contact = await page.evaluate((boundaryX) => {
    const model = window.cartonBuilderApp.artwork.artwork;
    return { x: model.visibleCenter.x + model.displayedWidthMm / 2, boundaryX };
  }, target.x);
  expect(contact.x).toBeCloseTo(contact.boundaryX, 4);
  await page.mouse.up();
  await expect(page.locator('.snap-guide')).toHaveCount(0);
}

async function prepareTechnicalProportionalBoundary(page) {
  const target = await chooseTechnicalVerticalBoundary(page);
  await page.evaluate(({ x, y }) => {
    const app = window.cartonBuilderApp;
    const model = app.artwork.artwork;
    model.setScaleX(0.08);
    model.setScaleY(0.08);
    const halfWidth = model.displayedWidthMm / 2;
    const halfHeight = model.displayedHeightMm / 2;
    const desiredFactor = 1 + 2 / Math.max(0.001, halfWidth);
    model.setVisibleCenter(
      x - halfWidth - 2,
      y - desiredFactor * halfHeight,
    );
    app.artwork.render();
  }, target);
  return target;
}

async function prepareTechnicalCropBoundary(page) {
  const target = await chooseTechnicalVerticalBoundary(page);
  await page.evaluate(({ x, y }) => {
    const app = window.cartonBuilderApp;
    const model = app.artwork.artwork;
    model.setScaleX(0.08);
    model.setScaleY(0.08);
    model.setVisibleCenter(x - model.displayedWidthMm / 2 + 2, y);
    app.artwork.render();
  }, target);
  return target;
}

async function dragTechnicalProportionalCornerToBoundary(page, target) {
  if (await page.locator('#constrainProportionsBtn').getAttribute('aria-pressed') !== 'true') {
    await page.locator('#constrainProportionsBtn').click();
  }
  const handle = page.locator('.resize-handle[data-handle="se"]');
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('Technical southeast resize handle has no screen bounds');
  const initialGeometry = await page.evaluate(() => {
    const model = window.cartonBuilderApp.artwork.artwork;
    const anchor = model.getReferencePosition();
    const start = {
      x: model.visibleCenter.x + model.displayedWidthMm / 2,
      y: model.visibleCenter.y + model.displayedHeightMm / 2,
    };
    const factor = (0 - anchor.x) / (start.x - anchor.x);
    return {
      anchor,
      start,
      expectedY: anchor.y + (start.y - anchor.y) * factor,
    };
  });
  const targetScreen = await page.evaluate(({ x, y }) => {
    const svg = document.getElementById('artworkWorkspace');
    const point = svg.createSVGPoint();
    point.x = x;
    point.y = y;
    const screen = point.matrixTransform(svg.getScreenCTM());
    return { x: screen.x, y: screen.y };
  }, target);
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetScreen.x, targetScreen.y, { steps: 2 });
  const guide = page.locator(`.snap-guide[data-snap-kind="panel-boundary"][data-snap-id="${target.id}"]`);
  if (await guide.count() !== 1) {
    const diagnostic = await page.evaluate((boundary) => {
      const app = window.cartonBuilderApp;
      const targets = app.artwork.getSnapTargets();
      return {
        center: app.artwork.artwork.visibleCenter,
        width: app.artwork.artwork.displayedWidthMm,
        height: app.artwork.artwork.displayedHeightMm,
        boundary,
        initialGeometry: boundary.initialGeometry,
        rawPoint: app.artwork.renderer.clientToModel(
          boundary.targetScreen.x,
          boundary.targetScreen.y,
        ),
        semantic: targets.panelBoundaries.find((entry) => entry.id === boundary.id),
        legacy: targets.segments.x.filter((entry) => Math.abs(entry.coordinate - boundary.x) < 1e-7),
        guides: [...document.querySelectorAll('#artworkWorkspace .snap-guide')].map((node) => ({
          kind: node.dataset.snapKind,
          id: node.dataset.snapId,
        })),
      };
    }, { ...target, initialGeometry, targetScreen });
    throw new Error(`Expected exact Technical proportional boundary guide: ${JSON.stringify(diagnostic)}`);
  }
  const contact = await page.evaluate(({ x, y }) => {
    const model = window.cartonBuilderApp.artwork.artwork;
    return {
      x: model.visibleCenter.x + model.displayedWidthMm / 2,
      y: model.visibleCenter.y + model.displayedHeightMm / 2,
      targetX: x,
      targetY: y,
    };
  }, target);
  expect(contact.x).toBeCloseTo(contact.targetX, 4);
  expect(contact.y).toBeCloseTo(contact.targetY, 4);
  await page.mouse.up();
  await expect(page.locator('.snap-guide')).toHaveCount(0);
}

async function dragTechnicalCropEastToBoundary(page, target) {
  await page.locator('#cropFrameButton').click();
  const handle = page.locator('.crop-side-handle[data-crop-edge="e"]');
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('Technical east crop handle has no screen bounds');
  const targetScreen = await page.evaluate(({ x, y }) => {
    const svg = document.getElementById('artworkWorkspace');
    const point = svg.createSVGPoint();
    point.x = x;
    point.y = y;
    const screen = point.matrixTransform(svg.getScreenCTM());
    return { x: screen.x, y: screen.y };
  }, target);
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetScreen.x, targetScreen.y, { steps: 2 });
  const guide = page.locator(`.snap-guide[data-snap-kind="panel-boundary"][data-snap-id="${target.id}"]`);
  if (await guide.count() !== 1) {
    const diagnostic = await page.evaluate(() => ({
      center: window.cartonBuilderApp.artwork.artwork.visibleCenter,
      crop: window.cartonBuilderApp.artwork.artwork.crop,
      guides: [...document.querySelectorAll('#artworkWorkspace .snap-guide')].map((node) => ({
        kind: node.dataset.snapKind,
        id: node.dataset.snapId,
      })),
    }));
    throw new Error(`Expected exact Technical crop boundary guide: ${JSON.stringify(diagnostic)}`);
  }
  await page.mouse.up();
  await expect(page.locator('.snap-guide')).toHaveCount(0);
  await page.locator('#cropFrameButton').click();
  const crop = await page.evaluate(() => {
    const model = window.cartonBuilderApp.artwork.artwork;
    return {
      right: model.centerXmm + model.crop.x + model.crop.width - model.unrotatedWidthMm / 2,
      crop: model.crop,
    };
  });
  expect(crop.right).toBeCloseTo(target.x, 4);
}

async function assertTechnicalRestoreRoundTrip(page, cartonType) {
  await chooseWorkflow(page, 'technical');
  const frame = page.frameLocator('#technicalHostFrame');
  await expect(page.locator('#technicalHostValidation')).toHaveText(
    'Structural VALID · Geometry VALID · Contract VALID',
    { timeout: 20_000 },
  );
  if (cartonType !== 'RTE') {
    await frame.locator('#cartonType').selectOption(cartonType);
    await expect(page.locator('#technicalHostValidation')).toHaveText(
      'Structural VALID · Geometry VALID · Contract VALID',
    );
  }
  await expect(frame.locator('#cartonType')).toHaveValue(cartonType);
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#artworkStep')).toBeVisible();
  await loadGeneratedPng(page, `technical-${cartonType}.png`);
  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());
  const committed = await page.evaluate(() => {
    const state = window.cartonBuilderApp.getState();
    return {
      workflowSelection: state.workflowSelection,
      modelSha256: state.cartonSource?.modelSha256,
      svgSha256: state.cartonSource?.svgSha256,
    };
  });

  await page.reload();
  await expect(page.locator('#artworkStep')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('button[data-workflow-mode="technical"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(frame.locator('#cartonType')).toHaveValue(cartonType, { timeout: 20_000 });
  await expect(page.locator('#artworkFileName')).toHaveText(`technical-${cartonType}.png`);
  await expect.poll(() => page.evaluate(() => {
    const state = window.cartonBuilderApp.getState();
    return {
      workflowSelection: state.workflowSelection,
      modelSha256: state.cartonSource?.modelSha256,
      svgSha256: state.cartonSource?.svgSha256,
    };
  })).toEqual(committed);

  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await page.locator('.step[data-step-target="box"]').click();
  await expect(page.locator('#boxStep')).toBeVisible();
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#artworkStep')).toBeVisible();
  expect(dialogs).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  // Headless Chromium exposes the native picker API, which does not emit a
  // Playwright download event. The browser fallback is the deterministic
  // contract exercised by these export tests.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const request = indexedDB.open('carton-builder', 6);
    await new Promise((resolve) => {
      request.onsuccess = () => {
        const db = request.result;
        if (db.objectStoreNames.contains('projects')) {
          const tx = db.transaction('projects', 'readwrite');
          tx.objectStore('projects').clear();
          tx.oncomplete = tx.onerror = resolve;
        } else {
          resolve();
        }
      };
      request.onerror = resolve;
    });
  });
  await page.evaluate(() => {
    localStorage.setItem('carton-builder-first-run-example-v1', 'true');
  });
  await page.reload();
});

test('opens a neutral transient workflow step before any project is chosen', async ({ page }) => {
  await expect(page.locator('#workflowStep')).toBeVisible();
  await expect(page.locator('#boxStep')).toBeHidden();
  await expect(page.locator('#artworkStep')).toBeHidden();
  await expect(page.locator('[data-step-target="workflow"]')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('[data-step-target="box"]')).toBeDisabled();
  await expect(page.locator('[data-step-target="artwork"]')).toBeDisabled();
  expect(await page.evaluate(() => ({
    step: window.cartonBuilderApp.step,
    state: window.cartonBuilderApp.getState(),
    technicalFrameSrc: document.getElementById('technicalHostFrame').getAttribute('src'),
  }))).toEqual({ step: 'workflow', state: null, technicalFrameSrc: null });

  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.locator('#menuNewProjectBtn')).toBeEnabled();
  await expect(page.locator('#menuOpenProjectBtn')).toBeEnabled();
  await expect(page.locator('#menuSaveProjectBtn')).toBeDisabled();
  await expect(page.locator('#menuPlaceArtworkBtn')).toBeDisabled();
  await expect(page.locator('#menuExportPngBtn')).toBeDisabled();
});

test('selects Quick Layout with keyboard and exposes the active card state', async ({ page }) => {
  const quick = page.locator('button[data-workflow-mode="quick"]');
  await quick.focus();
  await expect(quick).toBeFocused();
  await quick.press('Space');
  await expect(page.locator('#boxStep')).toBeVisible();
  await expect(quick).toHaveAttribute('aria-pressed', 'true');
  await expect(quick).toHaveAttribute('data-current', 'true');
  await expect(page.locator('[data-step-target="workflow"]')).toHaveClass(/complete/);
  await expect(page.locator('[data-step-target="box"]')).toHaveAttribute('aria-current', 'step');
  expect(await page.evaluate(() => window.cartonBuilderApp.getState().workflowSelection)).toBe('quick');
  await page.locator('[data-step-target="workflow"]').click();
  await expect(quick.locator('.workflow-current')).toBeVisible();
  await quick.click();
  await expect(page.locator('#boxStep')).toBeVisible();
});

test('New Project returns to the neutral workflow step', async ({ page }) => {
  await chooseWorkflow(page, 'quick');
  await (await openFileAction(page, '#menuNewProjectBtn')).click();
  await expect(page.locator('#workflowStep')).toBeVisible();
  await expect(page.locator('#boxStep')).toBeHidden();
  expect(await page.evaluate(() => window.cartonBuilderApp.getState())).toBe(null);
});

test('cancelling a workflow switch keeps the original workflow and artwork state', async ({ page }) => {
  await openArtworkStep(page);
  await loadGeneratedPng(page, 'workflow-cancel.png');
  const before = await page.evaluate(() => ({
    workflowSelection: window.cartonBuilderApp.getState().workflowSelection,
    fileName: window.cartonBuilderApp.artwork.artwork.source.fileName,
    step: window.cartonBuilderApp.step,
  }));
  await page.locator('[data-step-target="workflow"]').click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('button[data-workflow-mode="technical"]').click();
  await expect(page.locator('#workflowStep')).toBeVisible();
  await expect(page.locator('button[data-workflow-mode="quick"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('button[data-workflow-mode="technical"]')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => ({
    workflowSelection: window.cartonBuilderApp.getState().workflowSelection,
    fileName: window.cartonBuilderApp.artwork.artwork.source.fileName,
    step: window.cartonBuilderApp.step,
  }))).toEqual({ ...before, step: 'workflow' });
});

test('keeps the five-step stepper inside the header at compact widths', async ({ page }) => {
  const expectedAccessibleNames = ['Select Workflow', 'Create Box', 'Place Artwork', 'Preview / Export', 'Render'];
  for (const width of [1920, 1280, 900, 620, 320]) {
    await page.setViewportSize({ width, height: 720 });
    await expect.poll(() => page.locator('.step').evaluateAll((buttons) => (
      buttons.map((button) => button.getAttribute('aria-label'))
    ))).toEqual(expectedAccessibleNames);
    const geometry = await page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      };
      const steps = [...document.querySelectorAll('.step')].map((element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      });
      return {
        viewportWidth: window.innerWidth,
        steps,
        left: rect('.stepper-left-tools'),
        right: rect('.header-right-tools'),
      };
    });
    const stepLeft = Math.min(...geometry.steps.map((step) => step.left));
    const stepRight = Math.max(...geometry.steps.map((step) => step.right));
    expect(stepLeft).toBeGreaterThanOrEqual(-1);
    expect(stepRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(stepLeft).toBeGreaterThanOrEqual(geometry.left.right - 1);
    expect(stepRight).toBeLessThanOrEqual(geometry.right.left + 1);
  }
});

test('opening one top menu closes the other', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1200);

  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.locator('#fileMenuPopover')).toBeVisible();
  await expect(page.locator('#editMenuPopover')).toBeHidden();

  await page.getByRole('button', { name: 'Contacts', exact: true }).click();
  await expect(page.locator('#contactsMenuPopover')).toBeVisible();
  await expect(page.locator('#fileMenuPopover')).toBeHidden();
  await expect(page.locator('#editMenuPopover')).toBeHidden();

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('#editMenuPopover')).toBeVisible();
  await expect(page.locator('#fileMenuPopover')).toBeHidden();
  await expect(page.locator('#contactsMenuPopover')).toBeHidden();

  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.locator('#fileMenuPopover')).toBeVisible();
  await expect(page.locator('#editMenuPopover')).toBeHidden();
});

test('shows clickable contact links in the top menu', async ({ page }) => {
  await page.getByRole('button', { name: 'Contacts', exact: true }).click();
  const popover = page.locator('#contactsMenuPopover');
  await expect(popover).toBeVisible();
  await expect(popover.locator('a')).toHaveCount(3);
  await expect(popover.locator('a').nth(0)).toHaveAttribute('href', 'mailto:pavel.p.popovic@gmail.com');
  await expect(popover.locator('a').nth(1)).toHaveAttribute('href', 'https://t.me/Grabovvski');
  await expect(popover.locator('a').nth(2)).toHaveAttribute('href', 'https://www.linkedin.com/in/grabovsky/');
  await expect(popover.locator('a').nth(1)).toHaveAttribute('target', '_blank');
  await expect(popover.locator('a').nth(2)).toHaveAttribute('rel', 'noopener noreferrer');
});

test('completes the technical workflow for RTE, STE and TT_SL123 and restores technical autosave', async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await chooseWorkflow(page, 'technical');
  const frame = page.frameLocator('#technicalHostFrame');
  await expect(page.locator('#technicalHostValidation')).toHaveText(
    'Structural VALID · Geometry VALID · Contract VALID',
    { timeout: 20_000 },
  );
  const presentationSvg = frame.locator('#canvas svg');
  for (const id of ['flipHorizontalBtn', 'flipVerticalBtn', 'rotateCcwBtn', 'rotateCwBtn']) {
    await expect(frame.locator(`#${id}`)).toBeVisible();
  }
  await frame.locator('#flipHorizontalBtn').click();
  await expect(presentationSvg).toHaveAttribute('data-presentation-transform', '-1,0,0,1');
  await frame.locator('#flipHorizontalBtn').click();
  await frame.locator('#flipVerticalBtn').click();
  await expect(presentationSvg).toHaveAttribute('data-presentation-transform', '1,0,0,-1');
  await frame.locator('#flipVerticalBtn').click();
  await frame.locator('#rotateCcwBtn').click();
  await expect(presentationSvg).toHaveAttribute('data-presentation-transform', '0,-1,1,0');
  await frame.locator('#rotateCwBtn').click();
  await frame.locator('#rotateCwBtn').click();
  await expect(presentationSvg).toHaveAttribute('data-presentation-transform', '0,1,-1,0');

  const types = ['RTE', 'STE', 'TT_SL123'];
  const expectedArcCounts = { RTE: 19, STE: 20, TT_SL123: 21 };
  for (const [index, cartonType] of types.entries()) {
    if (index > 0) {
      await page.locator('.step[data-step-target="box"]').click();
      await expect(frame.locator('#cartonType')).toBeVisible();
      await frame.locator('#cartonType').selectOption(cartonType);
      await expect(page.locator('#technicalHostValidation')).toHaveText(
        'Structural VALID · Geometry VALID · Contract VALID',
      );
    }

    const step2 = page.locator('.step[data-step-target="artwork"]');
    await expect(step2).toBeEnabled();
    const presentationGeometryBounds = await frame
      .locator('#canvas svg path.boundary, #canvas svg path.fold, #canvas svg path.feature')
      .evaluateAll((paths) => {
        const boxes = paths.map((path) => path.getBBox());
        const minX = Math.min(...boxes.map((box) => box.x));
        const minY = Math.min(...boxes.map((box) => box.y));
        const maxX = Math.max(...boxes.map((box) => box.x + box.width));
        const maxY = Math.max(...boxes.map((box) => box.y + box.height));
        return { width: maxX - minX, height: maxY - minY };
      });
    await step2.click();
    await expect(page.locator('#artworkStep')).toBeVisible();
    await expect.poll(() => page.evaluate(() => (
      window.cartonBuilderApp.getState().cartonSource?.source?.cartonType
    ))).toBe(cartonType);

    const arcFlags = await page.locator('#artworkWorkspace path.dieline-cut, #artworkWorkspace path.dieline-fold')
      .evaluateAll((paths) => paths
        .filter((path) => path.getAttribute('d')?.includes('A'))
        .map((path) => {
          const match = path.getAttribute('d').match(/A\S+ \S+ 0 ([01]) ([01]) /);
          return match ? { largeArc: Number(match[1]), sweep: Number(match[2]) } : null;
        }));
    expect(arcFlags).toHaveLength(expectedArcCounts[cartonType]);
    expect(arcFlags.every((flags) => flags?.largeArc === 0)).toBe(true);
    const presentedBounds = await page.locator([
      '#artworkWorkspace path.dieline-cut',
      '#artworkWorkspace path.dieline-fold',
      '#artworkWorkspace line.dieline-cut',
      '#artworkWorkspace line.dieline-fold',
    ].join(', '))
      .evaluateAll((paths) => {
        const boxes = paths.map((path) => path.getBBox());
        const minX = Math.min(...boxes.map((box) => box.x));
        const minY = Math.min(...boxes.map((box) => box.y));
        const maxX = Math.max(...boxes.map((box) => box.x + box.width));
        const maxY = Math.max(...boxes.map((box) => box.y + box.height));
        return { width: maxX - minX, height: maxY - minY };
      });
    expect(presentedBounds.width > presentedBounds.height)
      .toBe(presentationGeometryBounds.width > presentationGeometryBounds.height);
  }

  await loadGeneratedPng(page, 'technical-autosave.png');
  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());
  await expect.poll(async () => page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('carton-builder');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise((resolve, reject) => {
      const transaction = database.transaction('projects', 'readonly');
      const request = transaction.objectStore('projects').get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return value?.snapshot?.cartonSource?.mode === 'technical'
      && value?.technicalAssets?.modelBlob instanceof Blob;
  })).toBe(true);

  const committedBeforeReload = await page.evaluate(() => {
    const source = window.cartonBuilderApp.getState().cartonSource;
    return {
      workflowSelection: window.cartonBuilderApp.getState().workflowSelection,
      modelSha256: source.modelSha256,
      svgSha256: source.svgSha256,
    };
  });
  await page.reload();
  await expect(page.locator('#artworkStep')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('button[data-workflow-mode="technical"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(frame.locator('#cartonType')).toHaveValue('TT_SL123', { timeout: 20_000 });
  await expect(page.locator('#artworkFileName')).toHaveText('technical-autosave.png');
  await expect.poll(() => page.evaluate(() => {
    const state = window.cartonBuilderApp.getState();
    return {
      workflowSelection: state.workflowSelection,
      modelSha256: state.cartonSource?.modelSha256,
      svgSha256: state.cartonSource?.svgSha256,
    };
  })).toEqual(committedBeforeReload);

  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await page.locator('.step[data-step-target="box"]').click();
  await expect(page.locator('#boxStep')).toBeVisible();
  await expect(frame.locator('#canvas svg')).toHaveAttribute('data-presentation-transform', '0,1,-1,0');
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#artworkStep')).toBeVisible();
  expect(dialogs).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('technical SVG export preserves canonical metadata and provenance for RTE, STE and TT_SL123', async ({ page }) => {
  test.setTimeout(90_000);
  await chooseWorkflow(page, 'technical');
  const frame = page.frameLocator('#technicalHostFrame');
  await expect(page.locator('#technicalHostValidation')).toHaveText(
    'Structural VALID · Geometry VALID · Contract VALID',
    { timeout: 20_000 },
  );
  await frame.locator('#flipHorizontalBtn').click();
  await expect(frame.locator('#canvas svg')).toHaveAttribute('data-presentation-transform', '-1,0,0,1');

  for (const [index, cartonType] of ['RTE', 'STE', 'TT_SL123'].entries()) {
    if (index > 0) {
      await page.locator('.step[data-step-target="box"]').click();
      await expect(frame.locator('#cartonType')).toBeVisible();
      await frame.locator('#cartonType').selectOption(cartonType);
      await expect(page.locator('#technicalHostValidation')).toHaveText(
        'Structural VALID · Geometry VALID · Contract VALID',
      );
    }

    await page.locator('.step[data-step-target="artwork"]').click();
    await expect(page.locator('#artworkStep')).toBeVisible();
    await expect(page.locator('.step[data-step-target="preview"]')).toBeDisabled();
    await expect(page.locator('.step[data-step-target="render"]')).toBeDisabled();

    const downloadPromise = page.waitForEvent('download');
    await (await openMenuExport(page, '2d', '#menuExportSvgBtn')).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    await expect.poll(async () => readFile(downloadPath, 'utf8'), { timeout: 10_000 })
      .toContain('<metadata id="cartonbuilder-metadata"');
    const exported = await readFile(downloadPath, 'utf8');
    const pbdMetadata = exported.match(/<metadata id="cartonbuilder-metadata"[^>]*>[\s\S]*?<\/metadata>/g) || [];
    const provenance = exported.match(/<metadata id="cartonbuilder-export-provenance"[^>]*>[\s\S]*?<\/metadata>/g) || [];

    expect(pbdMetadata).toHaveLength(1);
    expect(provenance).toHaveLength(1);
    expect(provenance[0]).toContain(`&quot;cartonType&quot;:&quot;${cartonType}&quot;`);
    const provenanceJson = JSON.parse(decodeXmlText(
      provenance[0].slice(provenance[0].indexOf('>') + 1, provenance[0].lastIndexOf('</metadata>')),
    ));
    const canonicalMarkup = exported.replace(provenance[0], '');
    const canonicalSha256 = await sha256(new Blob([canonicalMarkup], { type: 'image/svg+xml' }));
    expect(provenanceJson.integrity.sourceSemanticSvgSha256).toBe(canonicalSha256);
    expect(exported).toContain('data-export-schema-version="pbd.svg.v4"');
    expect(exported).toContain('data-presentation-transform="-1,0,0,1"');
    expect(exported).toContain('data-semantic-layer="regions"');
    expect(exported).toContain('data-semantic-layer="folds"');
  }
});

const expectedTechnicalPdfGeometry = {
  RTE: { widthMm: 374.4, heightMm: 312.3, primitiveCount: 90, cutCount: 78, arcCount: 19, foldCount: 12, openCutCount: 12 },
  STE: { widthMm: 379.32, heightMm: 319.68, primitiveCount: 90, cutCount: 78, arcCount: 20, foldCount: 12, openCutCount: 12 },
  TT_SL123: { widthMm: 374.4, heightMm: 273.6995, primitiveCount: 84, cutCount: 72, arcCount: 21, foldCount: 12, openCutCount: 8 },
};

for (const cartonType of ['RTE', 'STE', 'TT_SL123']) {
  test(`technical flat PDF export downloads exact Dieline OCG and artwork for ${cartonType}`, async ({ page }) => {
    test.setTimeout(90_000);
    const semanticCounts = expectedTechnicalPdfGeometry[cartonType];
    const frame = await createTechnicalArtworkProject(page, `technical-flat-pdf-${cartonType}.png`, cartonType);
    const technicalBoxModel = await loadTechnicalFixtureBoxModel(cartonType);
    const presentationTransform = (await frame.locator('#canvas svg').getAttribute('data-presentation-transform'))
      .split(',').map(Number);
    expect(technicalBoxModel.getPresentationTransform()).toEqual({
      a: presentationTransform[0],
      b: presentationTransform[1],
      c: presentationTransform[2],
      d: presentationTransform[3],
    });
    const expectedDieline = getDielineSegments(technicalBoxModel);
    const expectedCutCubicCount = expectedDieline.cut
      .reduce((count, segment) => count + (segment.kind === 'ARC' ? arcToCubicSegments(segment).length : 0), 0);
    const expectedFoldCubicCount = expectedDieline.fold
      .reduce((count, segment) => count + (segment.kind === 'ARC' ? arcToCubicSegments(segment).length : 0), 0);
    const openCutSegments = expectedDieline.cut.filter((segment) => segment.role === 'OPEN_CUT');
    expect(expectedDieline.cut).toHaveLength(semanticCounts.cutCount);
    expect(expectedDieline.fold).toHaveLength(semanticCounts.foldCount);
    expect([...expectedDieline.cut, ...expectedDieline.fold]
      .filter((segment) => segment.kind === 'ARC')).toHaveLength(semanticCounts.arcCount);
    expect(openCutSegments).toHaveLength(semanticCounts.openCutCount);
    const downloadPromise = page.waitForEvent('download');
    await (await openMenuExport(page, '2d', '#menuExportPdfBtn')).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('carton-artwork.pdf');
    const inspected = await inspectFlatPdfDownload(download);

    expect(inspected.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(Number.isFinite(inspected.page.getWidth())).toBe(true);
    expect(Number.isFinite(inspected.page.getHeight())).toBe(true);
    expect(inspected.page.getWidth()).toBeGreaterThan(0);
    expect(inspected.page.getHeight()).toBeGreaterThan(0);
    expect(inspected.page.getWidth()).toBeCloseTo(semanticCounts.widthMm * (72 / 25.4), 4);
    expect(inspected.page.getHeight()).toBeCloseTo(semanticCounts.heightMm * (72 / 25.4), 4);
    expect(inspected.properties.entries().map(([name]) => name.asString())).toEqual(['/Dieline']);
    expect(inspected.xObjectSubtypes).toContain('/Image');
    expect(inspected.content).toContain('/OC /Dieline BDC');
    expect(inspected.content).toContain('/CutContourCS CS');
    expect(inspected.content).toContain('Do');
    const dielineContent = inspected.content.slice(
      inspected.content.indexOf('/OC /Dieline BDC'),
      inspected.content.indexOf('EMC', inspected.content.indexOf('/OC /Dieline BDC')),
    );
    const foldMarker = dielineContent.match(/\[[^\]]+\]\s+0\s+d/);
    expect(foldMarker).toBeTruthy();
    const cutContent = dielineContent.slice(0, foldMarker.index);
    const foldContent = dielineContent.slice(foldMarker.index + foldMarker[0].length);
    expect((cutContent.match(/\bS\b/g) || []).length).toBe(semanticCounts.cutCount);
    expect((foldContent.match(/\bS\b/g) || []).length).toBe(semanticCounts.foldCount);
    expect((dielineContent.match(/\bS\b/g) || []).length).toBe(semanticCounts.primitiveCount);
    expect((cutContent.match(/\bc\b/g) || []).length).toBe(expectedCutCubicCount);
    expect((foldContent.match(/\bc\b/g) || []).length).toBe(expectedFoldCubicCount);
    expect((dielineContent.match(/\bc\b/g) || []).length)
      .toBe(expectedCutCubicCount + expectedFoldCubicCount);
    const cutStrokePaths = cutContent
      .split(/\bS\b/)
      .slice(0, -1)
      .map((strokePath) => {
        const starts = [...strokePath.matchAll(/[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s+[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s+m/g)];
        const start = starts.at(-1);
        return start ? strokePath.slice(start.index).trim() : null;
      })
      .filter(Boolean);
    expect(cutStrokePaths).toHaveLength(semanticCounts.cutCount);

    const geometryBounds = technicalBoxModel.getBounds();
    const projectedOpenCutSegments = openCutSegments.map((segment) => {
      const cubicPieces = segment.kind === 'ARC' ? arcToCubicSegments(segment) : [];
      const end = cubicPieces.at(-1)?.end || segment.end;
      const toPdfPoint = (point) => ({
        x: (point.x - geometryBounds.minX) * (72 / 25.4),
        y: (geometryBounds.maxY - point.y) * (72 / 25.4),
      });
      return {
        start: toPdfPoint(segment.start),
        end: toPdfPoint(end),
        cubicCount: cubicPieces.length,
      };
    });
    const openCutStrokePaths = cutStrokePaths.slice(-projectedOpenCutSegments.length);
    expect(openCutStrokePaths).toHaveLength(projectedOpenCutSegments.length);
    const expectedOpenCutCubicCount = projectedOpenCutSegments
      .reduce((count, segment) => count + segment.cubicCount, 0);
    const actualOpenCutCubicCount = openCutStrokePaths
      .reduce((count, strokePath) => count + (strokePath.match(/\bc\b/g) || []).length, 0);
    expect(actualOpenCutCubicCount).toBe(expectedOpenCutCubicCount);
    projectedOpenCutSegments.forEach((segment, index) => {
      const strokePath = openCutStrokePaths[index];
      expect((strokePath.match(/\bc\b/g) || []).length).toBe(segment.cubicCount);
      expect(strokePath).toContain(`${segment.start.x} ${segment.start.y} m`);
      expect(strokePath).toContain(`${segment.end.x} ${segment.end.y}`);
    });
    expect(inspected.content.indexOf('Do')).toBeLessThan(inspected.content.indexOf('/OC /Dieline BDC'));
    expect(inspected.content).not.toContain('/Bleed');
    expect(inspected.content).not.toContain('/Safe');
    expect(inspected.content).not.toContain('/Artwork');
    expect(inspected.content).not.toContain('/Knife');
    expect(inspected.content).not.toContain('/FoldLine');
  });
}

test('technical flat PDF keeps vector artwork as a Form XObject with crop, rotation and flips', async ({ page }) => {
  test.setTimeout(90_000);
  await chooseWorkflow(page, 'technical');
  await expect(page.locator('#technicalHostValidation')).toHaveText(
    'Structural VALID · Geometry VALID · Contract VALID',
    { timeout: 20_000 },
  );
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#artworkStep')).toBeVisible();
  await loadGeneratedVectorPdf(page, 'technical-vector-flat.pdf');
  await page.evaluate(() => {
    const model = window.cartonBuilderApp.artwork.artwork;
    model.applyCrop({
      x: model.unrotatedWidthMm * 0.18,
      y: model.unrotatedHeightMm * 0.12,
      width: model.unrotatedWidthMm * 0.62,
      height: model.unrotatedHeightMm * 0.68,
    });
    model.rotateQuarterTurns(1);
    model.flipHorizontal();
    model.flipVertical();
    window.cartonBuilderApp.artwork.render();
  });
  expect(await page.evaluate(() => ({
    flipX: window.cartonBuilderApp.artwork.artwork.flipX,
    flipY: window.cartonBuilderApp.artwork.artwork.flipY,
  }))).toEqual({ flipX: true, flipY: true });

  const downloadPromise = page.waitForEvent('download');
  await (await openMenuExport(page, '2d', '#menuExportPdfBtn')).click();
  const download = await downloadPromise;
  const inspected = await inspectFlatPdfDownload(download);
  expect(inspected.xObjectSubtypes).toContain('/Form');
  expect(inspected.xObjectSubtypes).not.toContain('/Image');
  expect(inspected.content).toMatch(/-\d+(?:\.\d+)? 0 0 -\d+(?:\.\d+)? 0 0 cm/);
  expect(inspected.content.indexOf('Do')).toBeLessThan(inspected.content.indexOf('/OC /Dieline BDC'));
});

for (const cartonType of ['RTE', 'STE']) {
  test(`restores ${cartonType} technical workflow without replacing artwork`, async ({ page }) => {
    test.setTimeout(60_000);
    await assertTechnicalRestoreRoundTrip(page, cartonType);
  });
}

test('persists workflow selection independently and lets an opened Quick project override it', async ({ page }) => {
  await chooseWorkflow(page, 'technical');
  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());
  await page.reload();
  await expect(page.locator('button[data-workflow-mode="technical"]')).toHaveAttribute('aria-pressed', 'true');

  const quickBox = new BoxNetModel({ width: 200, height: 100, depth: 50 });
  quickBox.addPanel('Front', 'bottom', 'Base');
  quickBox.addPanel('Front', 'top', 'Top');
  quickBox.addPanel('Top', 'top', 'Back');
  quickBox.addPanel('Front', 'left', 'Left');
  quickBox.addPanel('Back', 'right', 'Right');
  const quickArchive = await createProjectArchive({
    snapshot: {
      schemaVersion: 17,
      meta: { name: 'Quick project override' },
      workflowStep: 'box',
      workflowSelection: 'quick',
      cartonSource: { mode: 'quick', box: quickBox.toJSON() },
      artworks: [],
      activeArtworkIndex: -1,
      render: {},
      renderAppearance: {},
      prepress: {},
      view: {},
      history: { undo: [], redo: [] },
    },
    artworkBlobs: [],
  });
  await (await openFileAction(page, '#menuOpenProjectBtn')).click();
  await page.locator('#projectFileInput').setInputFiles({
    name: 'quick-override.carton',
    mimeType: 'application/zip',
    buffer: Buffer.from(await quickArchive.arrayBuffer()),
  });
  await expect(page.locator('#boxStep')).toBeVisible();
  await expect(page.locator('button[data-workflow-mode="quick"]')).toHaveAttribute('aria-pressed', 'true');
});

test('restores a complete project checkpoint including artwork and Render assets', async ({ page }) => {
  test.setTimeout(60_000);
  await openArtworkStep(page);
  await loadGeneratedPng(page, 'checkpoint-artwork.png');
  await loadRenderBackground(page);

  const before = await page.evaluate(async () => {
    const digest = async (blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const app = window.cartonBuilderApp;
    const renderState = app.render.getState();
    renderState.background.mode = 'image';
    renderState.background.image.fit = 'contain';
    renderState.background.image.positionX = 0.21;
    renderState.background.image.positionY = 0.72;
    app.render.applySettings({
      renderSettings: renderState,
      boardAppearance: { ...app.render.getBoardAppearance(), thicknessMm: 0.73 },
    });
    const checkpoint = await app.artwork.createProjectCheckpoint();
    if (checkpoint.snapshot.render.background.mode !== 'image') {
      throw new Error(`Checkpoint did not capture Render image mode: ${checkpoint.snapshot.render.background.mode}`);
    }
    return {
      artworkSha: await digest(app.artwork.originalBlob),
      artworkFileName: app.artwork.createSnapshot().artworks[0].artwork.source.fileName,
      renderState: app.render.getState(),
      boardAppearance: app.render.getBoardAppearance(),
      renderAssets: await Promise.all(app.render.getRenderAssets().map(async (asset) => ({
        assetId: asset.assetId,
        sha256: await digest(asset.blob),
      }))),
    };
  });
  expect(before.renderAssets).toHaveLength(1);

  await page.evaluate(() => {
    const app = window.cartonBuilderApp;
    app.artwork.clearArtworkForCartonChange();
    app.render.applySettings({
      renderSettings: { ...app.render.getState(), background: { ...app.render.getState().background, mode: 'solid' } },
      boardAppearance: { ...app.render.getBoardAppearance(), thicknessMm: 1.4 },
    });
  });
  await page.evaluate(() => window.cartonBuilderApp.showStep('box'));
  await expect(page.locator('#boxStep')).toBeVisible();
  await expect(page.locator('#artworkFileName')).toHaveText('No file selected');

  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.artwork.restoreProjectCheckpoint())).toBe(true);
  await expect(page.locator('#artworkStep')).toBeVisible();
  await expect(page.locator('#artworkFileName')).toHaveText('checkpoint-artwork.png');

  const after = await page.evaluate(async () => {
    const digest = async (blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const app = window.cartonBuilderApp;
    return {
      artworkSha: await digest(app.artwork.originalBlob),
      artworkFileName: app.artwork.createSnapshot().artworks[0].artwork.source.fileName,
      renderState: app.render.getState(),
      boardAppearance: app.render.getBoardAppearance(),
      renderAssets: await Promise.all(app.render.getRenderAssets().map(async (asset) => ({
        assetId: asset.assetId,
        sha256: await digest(asset.blob),
      }))),
    };
  });

  expect(after).toEqual(before);
});

test('restores a Quick checkpoint after switching to Technical workflow', async ({ page }) => {
  test.setTimeout(60_000);
  await openArtworkStep(page);
  await loadGeneratedPng(page, 'quick-checkpoint.png');
  await page.locator('.step[data-step-target="box"]').click();
  await page.evaluate(() => window.cartonBuilderApp.artwork.createProjectCheckpoint());

  page.once('dialog', (dialog) => dialog.accept());
  await chooseWorkflow(page, 'technical');
  await expect(page.locator('button[data-workflow-mode="technical"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#artworkFileName')).toHaveText('No file selected');

  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.artwork.restoreProjectCheckpoint())).toBe(true);
  await expect(page.locator('button[data-workflow-mode="quick"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#boxStep')).toBeVisible();
  await expect(page.locator('#artworkFileName')).toHaveText('quick-checkpoint.png');
  expect(await page.evaluate(() => window.cartonBuilderApp.getState().cartonSource?.mode)).toBe('quick');
});

test('restores Technical A after a successful replacement with Technical B', async ({ page }) => {
  test.setTimeout(60_000);
  const frame = await createTechnicalArtworkProject(page, 'technical-a.png');
  await page.locator('.step[data-step-target="box"]').click();
  await frame.locator('#cartonType').selectOption('STE');
  await expect(page.locator('#technicalHostValidation')).toHaveText(
    'Structural VALID · Geometry VALID · Contract VALID',
  );
  const before = await captureCheckpointFingerprint(page);

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#artworkStep')).toBeVisible();
  await expect(page.locator('#artworkFileName')).toHaveText('No file selected');
  expect(await page.evaluate(() => window.cartonBuilderApp.getState().cartonSource?.source?.cartonType)).toBe('STE');

  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.artwork.restoreProjectCheckpoint())).toBe(true);
  await expect(frame.locator('#cartonType')).toHaveValue('RTE', { timeout: 20_000 });
  await expect(page.locator('#artworkFileName')).toHaveText('technical-a.png');
  expect(await captureCheckpointFingerprint(page)).toEqual(before);
});

test('keeps the existing checkpoint unchanged when technical replacement is cancelled', async ({ page }) => {
  test.setTimeout(60_000);
  const frame = await createTechnicalArtworkProject(page, 'cancel-checkpoint.png');
  const checkpointX = await page.evaluate(async () => {
    const app = window.cartonBuilderApp;
    await app.artwork.createProjectCheckpoint();
    return app.artwork.artwork.centerXmm;
  });
  await page.evaluate(() => {
    window.cartonBuilderApp.artwork.artwork.moveBy(17, 0);
    window.cartonBuilderApp.artwork.render();
  });
  await page.locator('.step[data-step-target="box"]').click();
  await frame.locator('#cartonType').selectOption('STE');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#boxStep')).toBeVisible();

  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.artwork.restoreProjectCheckpoint())).toBe(true);
  await expect(page.locator('#artworkStep')).toBeVisible();
  await expect(frame.locator('#cartonType')).toHaveValue('RTE', { timeout: 20_000 });
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.centerXmm)).toBe(checkpointX);
});

test('rejects an invalid checkpoint before changing live project state', async ({ page }) => {
  await openArtworkStep(page);
  await loadGeneratedPng(page, 'validation-checkpoint.png');
  await page.evaluate(() => window.cartonBuilderApp.artwork.createProjectCheckpoint());
  await page.evaluate(() => {
    window.cartonBuilderApp.artwork.artwork.moveBy(9, 4);
    window.cartonBuilderApp.artwork.render();
  });
  const before = await captureLiveFingerprint(page);
  const result = await page.evaluate(async () => {
    try {
      await window.cartonBuilderApp.artwork.restoreProjectCheckpoint({
        verifyCheckpoint: async () => { throw new Error('TEST_INVALID_CHECKPOINT'); },
      });
      return 'resolved';
    } catch (error) {
      return error.message;
    }
  });
  expect(result).toBe('TEST_INVALID_CHECKPOINT');
  expect(await captureLiveFingerprint(page)).toEqual(before);
});

for (const phase of [
  'clear-artwork',
  'activate-model',
  'update-technical-assets',
  'reset-preview',
  'reset-render',
  'final-save',
]) {
  test(`rolls back snapshot, blobs and Render assets after ${phase} failure`, async ({ page }) => {
    test.setTimeout(60_000);
    const frame = await createTechnicalArtworkProject(page, `rollback-${phase}.png`);
    await loadRenderBackground(page, `rollback-${phase}-background.png`);
    await page.evaluate(() => {
      const app = window.cartonBuilderApp;
      const renderState = app.render.getState();
      renderState.background.mode = 'image';
      renderState.background.image.fit = 'contain';
      renderState.background.image.positionX = 0.27;
      renderState.background.image.positionY = 0.68;
      app.render.applySettings({
        renderSettings: renderState,
        boardAppearance: { ...app.render.getBoardAppearance(), thicknessMm: 0.81 },
      });
    });
    await page.locator('.step[data-step-target="box"]').click();
    await frame.locator('#cartonType').selectOption('STE');
    await expect(page.locator('#technicalHostValidation')).toHaveText(
      'Structural VALID · Geometry VALID · Contract VALID',
    );
    const before = await captureCheckpointFingerprint(page);

    await page.evaluate((faultPhase) => {
      const app = window.cartonBuilderApp;
      if (faultPhase === 'final-save') {
        app.artwork.commitProjectSave = async () => { throw new Error('TEST_FINAL_SAVE_FAILURE'); };
      } else {
        app.testHooks.setTechnicalReplacementFaultInjector((currentPhase) => {
          if (currentPhase === faultPhase) throw new Error(`TEST_${faultPhase.toUpperCase()}_FAILURE`);
        });
      }
    }, phase);
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('.step[data-step-target="artwork"]').click();
    await expect(page.locator('#boxStep')).toBeVisible();
    await expect(frame.locator('#cartonType')).toHaveValue('RTE', { timeout: 20_000 });
    await expect(page.locator('#artworkFileName')).toHaveText(`rollback-${phase}.png`);
    expect(await captureCheckpointFingerprint(page)).toEqual(before);
  });
}

for (const cartonType of ['RTE', 'STE', 'TT_SL123']) {
  test(`snaps Technical artwork to semantic targets for ${cartonType}`, async ({ page }) => {
    test.setTimeout(90_000);
    const frame = await createTechnicalArtworkProject(page, `semantic-${cartonType}.png`);
    if (cartonType !== 'RTE') {
      await page.locator('.step[data-step-target="box"]').click();
      await frame.locator('#cartonType').selectOption(cartonType);
      await expect(page.locator('#technicalHostValidation')).toHaveText(
        'Structural VALID · Geometry VALID · Contract VALID',
      );
      page.once('dialog', (dialog) => dialog.accept());
      await page.locator('.step[data-step-target="artwork"]').click();
      await expect(page.locator('#artworkStep')).toBeVisible({ timeout: 20_000 });
      await loadGeneratedPng(page, `semantic-${cartonType}.png`);
    }

    await snapTechnicalArtworkToTarget(page, 'endpoint');
    await snapTechnicalArtworkToTarget(page, 'intersection');
    await snapTechnicalArtworkToTarget(page, 'panel-center');
    await snapTechnicalArtworkToTarget(page, 'panel-boundary');
    await snapTechnicalArtworkToTarget(page, 'panel-center', { bypass: true });

    const savedPosition = await page.evaluate(() => ({
      x: window.cartonBuilderApp.artwork.artwork.centerXmm,
      y: window.cartonBuilderApp.artwork.artwork.centerYmm,
    }));
    if (cartonType === 'RTE') {
      await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());
      await page.reload();
      await expect(page.locator('#artworkStep')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('#artworkFileName')).toHaveText(`semantic-${cartonType}.png`);
      await expect.poll(() => page.evaluate(() => ({
        x: window.cartonBuilderApp.artwork.artwork.centerXmm,
        y: window.cartonBuilderApp.artwork.artwork.centerYmm,
      }))).toEqual(savedPosition);
      await expect(page.locator('.snap-guide')).toHaveCount(0);
    }
  });
}

for (const cartonType of ['RTE', 'STE', 'TT_SL123']) {
  test(`technical printable preflight classifies ${cartonType} surfaces`, async ({ page }) => {
    test.setTimeout(90_000);
    await createTechnicalArtworkProject(page, `technical-printable-${cartonType}.png`, cartonType);
    const report = await page.evaluate(() => window.cartonBuilderApp.artwork.getTechnicalArtworkPreflight());
    expect(report.mode).toBe('technical');
    expect(report.printableSurfaces.length).toBeGreaterThan(0);
    expect(report.excludedSurfaces.map((surface) => surface.id)).toContain('body.glueFlap');
    expect(report.issues.some((issue) => issue.surfaceId === 'body.glueFlap')).toBe(false);
    if (cartonType === 'TT_SL123') {
      expect(report.excludedSurfaces.filter((surface) => surface.reason === 'locking-surface').length).toBe(4);
      expect(report.issues.some((issue) => issue.code === 'uncovered-printable-surface' && issue.surfaceId.startsWith('closure.bottom.snap'))).toBe(false);
    }
    await expect(page.locator('#artworkQualitySummary')).toContainText('Printable surfaces:');
    await expect(page.locator('#previewStep')).toBeHidden();
    await expect(page.locator('#renderStep')).toBeHidden();
  });
}

test('technical printable coverage and raster DPI recalculate without persisting the report', async ({ page }) => {
  test.setTimeout(90_000);
  await createTechnicalArtworkProject(page, 'technical-printable-coverage.png');

  await page.locator('#artworkWidth').fill('20');
  await page.locator('#artworkWidth').dispatchEvent('change');
  const partialReport = await page.evaluate(() => window.cartonBuilderApp.artwork.getTechnicalArtworkPreflight());
  expect(partialReport.summary.uncovered).toBeGreaterThan(0);
  await expect(page.locator('#artworkQualitySummary')).toContainText('Uncovered surface IDs:');

  await page.locator('#artworkWidth').fill('1000');
  await page.locator('#artworkWidth').dispatchEvent('change');
  const lowDpiReport = await page.evaluate(() => window.cartonBuilderApp.artwork.getTechnicalArtworkPreflight());
  expect(lowDpiReport.artworkQuality).toEqual([
    expect.objectContaining({ quality: 'warning', issues: ['dpi-below-recommended'] }),
  ]);
  await expect(page.locator('#artworkQualitySummary')).toContainText('DPI warnings:');

  await page.locator('#fillArtworkButton').click();
  await expect.poll(() => page.evaluate(() => {
    const report = window.cartonBuilderApp.artwork.getTechnicalArtworkPreflight();
    return report.summary;
  })).toEqual({ covered: expect.any(Number), uncovered: 0, unknown: 0 });
  const completeReport = await page.evaluate(() => window.cartonBuilderApp.artwork.getTechnicalArtworkPreflight());
  expect(completeReport.printableSurfaces.every((surface) => surface.status === 'covered')).toBe(true);

  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());
  const snapshot = await page.evaluate(() => window.cartonBuilderApp.getState());
  expect(snapshot).not.toHaveProperty('technicalArtworkPreflight');
  await page.reload();
  await expect(page.locator('#artworkStep')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.artwork.getTechnicalArtworkPreflight().summary))
    .toEqual(completeReport.summary);
});

test('technical DPI preflight accepts vector PDF without a raster warning', async ({ page }) => {
  test.setTimeout(90_000);
  await createTechnicalArtworkProject(page, 'technical-vector-placeholder.png');
  page.once('dialog', (dialog) => dialog.accept());
  await (await openEditAction(page, '#menuRemoveArtworkBtn')).click();
  await expect(page.locator('#artworkFileName')).toHaveText('No file selected');
  await loadGeneratedVectorPdf(page, 'vector-artwork.pdf', { replace: false });
  const report = await page.evaluate(() => window.cartonBuilderApp.artwork.getTechnicalArtworkPreflight());
  expect(report.artworkQuality).toEqual([
    expect.objectContaining({ quality: 'vector', dpi: null, issues: [] }),
  ]);
  expect(report.issues.some((issue) => issue.code === 'dpi-below-recommended')).toBe(false);
});

test('snaps Technical side resize to an exact panel boundary', async ({ page }) => {
  test.setTimeout(90_000);
  await createTechnicalArtworkProject(page, 'semantic-side-resize.png');
  const target = await prepareTechnicalSideBoundary(page);
  await dragTechnicalSideToBoundary(page, target);
});

test('snaps Technical proportional corner resize to an exact panel boundary', async ({ page }) => {
  test.setTimeout(90_000);
  await createTechnicalArtworkProject(page, 'semantic-proportional-resize.png');
  const target = await prepareTechnicalProportionalBoundary(page);
  await dragTechnicalProportionalCornerToBoundary(page, target);
});

test('snaps Technical crop resize to a panel boundary', async ({ page }) => {
  test.setTimeout(90_000);
  await createTechnicalArtworkProject(page, 'semantic-crop.png');
  const target = await prepareTechnicalCropBoundary(page);
  await dragTechnicalCropEastToBoundary(page, target);
});

test('completes the three-step artwork workflow and exports every deliverable', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const shellBounds = await page.locator('.app-shell').evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });
  expect(shellBounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  await expect(page.locator('.title-bar')).toHaveCount(0);

  const dimensionRowPositions = await page.locator('.dimension-row').evaluateAll((rows) =>
    rows.map((row) => {
      const { x, y } = row.getBoundingClientRect();
      return { x, y };
    }),
  );
  expect(new Set(dimensionRowPositions.map(({ y }) => y)).size).toBe(1);
  expect(dimensionRowPositions[2].x - dimensionRowPositions[0].x).toBeLessThan(500);
  await expect(page.locator('#boxWidth')).toHaveValue('150');
  await expect(page.locator('#panelCount')).toHaveText('1/6');

  await page.evaluate(() => {
    window.__completeEvent = null;
    window.addEventListener('box-net-complete', (event) => {
      window.__completeEvent = event.detail;
    }, { once: true });
  });
  await openArtworkStep(page);
  await expect.poll(() => page.evaluate(() => window.__completeEvent?.complete)).toBe(true);
  await expect(page.locator('[data-step-target="artwork"]')).toHaveAttribute('aria-current', 'step');

  await loadGeneratedPng(page);
  await expect(page.locator('#dropState')).toBeHidden();
  await expect(page.locator('#artworkWorkspace image.artwork-image')).toHaveCount(2);
  await expect(page.locator('#effectiveDpi')).not.toHaveText('—');

  const beforeX = await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.centerXmm);
  await page.locator('#artworkWorkspace').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(
    () => page.evaluate(() => window.cartonBuilderApp.artwork.artwork.centerXmm),
  ).toBeCloseTo(beforeX + 0.1, 5);

  await page.getByLabel('Lock Artwork').check();
  const lockedX = await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.centerXmm);
  await page.keyboard.press('Control+ArrowRight');
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.centerXmm)).toBe(lockedX);
  await expect(page.locator('#artworkWidth')).toBeDisabled();
  await (await openEditAction(page, '#menuRemoveArtworkBtn')).click();
  await expect(page.locator('#artworkFileName')).toHaveText('sample-artwork.png');
  await page.getByLabel('Lock Artwork').uncheck();

  await page.getByRole('button', { name: 'Rotate +90°' }).click();
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.rotation)).toBe(90);
  await (await openEditAction(page, '#menuUndoBtn')).click();
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.rotation)).toBe(0);
  await (await openEditAction(page, '#menuRedoBtn')).click();
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.rotation)).toBe(90);

  const projectDownload = page.waitForEvent('download');
  await (await openFileAction(page, '#menuSaveProjectBtn')).click();
  const project = await projectDownload;
  expect(project.suggestedFilename()).toBe('carton-project.carton');
  const projectPath = await project.path();

  await page.locator('.step[data-step-target="preview"]').click();
  await expect(page.locator('#previewStep')).toBeVisible();
  await expect(page.locator('#preview3dPanel')).toBeVisible();

  const svgDownload = page.waitForEvent('download');
  await (await openMenuExport(page, '2d', '#menuExportSvgBtn')).click();
  const svg = await svgDownload;
  expect(svg.suggestedFilename()).toBe('box-net-150x90x40mm.svg');
  expect((await readFile(await svg.path(), 'utf8')).match(/<rect /g)).toHaveLength(6);

  const pngDownload = page.waitForEvent('download');
  await (await openMenuExport(page, '2d', '#menuExportPngBtn')).click();
  const png = await pngDownload;
  expect(png.suggestedFilename()).toBe('carton-artwork-preview.png');
  expect((await readFile(await png.path())).subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );

  const pdfDownload = page.waitForEvent('download');
  await (await openMenuExport(page, '2d', '#menuExportPdfBtn')).click();
  const pdf = await pdfDownload;
  expect(pdf.suggestedFilename()).toBe('carton-artwork.pdf');
  expect((await readFile(await pdf.path(), 'utf8')).slice(0, 5)).toBe('%PDF-');

  await page.locator('.step[data-step-target="artwork"]').click();
  await page.locator('#settingsTriggerBtn').click();
  const diagnosticsDownload = page.waitForEvent('download');
  await page.locator('#downloadDiagnosticsBtn').click();
  const diagnostics = JSON.parse(await readFile(await (await diagnosticsDownload).path(), 'utf8'));
  expect(diagnostics.privacy).toContain('No artwork bytes');
  expect(JSON.stringify(diagnostics)).not.toContain('sample-artwork.png');

  page.once('dialog', (dialog) => dialog.accept());
  await (await openEditAction(page, '#menuRemoveArtworkBtn')).click();
  await expect(page.locator('#artworkFileName')).toHaveText('No file selected');
  await page.locator('#projectFileInput').setInputFiles(projectPath);
  await expect(page.locator('#artworkFileName')).toHaveText('sample-artwork.png');

  await page.locator('#localePicker').selectOption('ru');
  await expect(page.getByRole('button', { name: 'Просмотр', exact: true })).toBeVisible();
  await expect(page.locator('[data-step-target="artwork"]')).toContainText('Размещение макета');

  await page.waitForTimeout(650);
  await page.reload();
  await expect(page.locator('#artworkStep')).toBeVisible();
  await expect(page.locator('#artworkFileName')).toHaveText('sample-artwork.png');
});

test('updates artwork-step box dimensions without fitting the active artwork', async ({ page }) => {
  await openArtworkStep(page);
  await loadGeneratedPng(page);

  const beforeArtwork = await page.evaluate(() => {
    const model = window.cartonBuilderApp.artwork.artwork;
    return {
      centerXmm: model.centerXmm,
      centerYmm: model.centerYmm,
      scaleX: model.scaleX,
      scaleY: model.scaleY,
      initialWidthMm: model.initialWidthMm,
      initialHeightMm: model.initialHeightMm,
    };
  });
  const beforeWidth = await page.evaluate(() => window.boxNetApp.getState().dimensions.width);
  const widthInput = page.locator('#artworkBoxWidth');
  await widthInput.fill(String(beforeWidth + 10));
  await widthInput.dispatchEvent('change');

  await expect.poll(() => page.evaluate(() => window.boxNetApp.getState().dimensions.width)).toBe(beforeWidth + 10);
  await expect.poll(() => page.evaluate(() => {
    const model = window.cartonBuilderApp.artwork.artwork;
    return {
      centerXmm: model.centerXmm,
      centerYmm: model.centerYmm,
      scaleX: model.scaleX,
      scaleY: model.scaleY,
      initialWidthMm: model.initialWidthMm,
      initialHeightMm: model.initialHeightMm,
    };
  })).toEqual(beforeArtwork);
});

test('validates dimensions, preserves the current net and emits compatibility events', async ({ page }) => {
  await chooseWorkflow(page, 'quick');
  await expect(page.locator('#boxStep')).toBeVisible();
  await activate(page, 'Add Base Panel to the bottom edge of Front Panel', ' ');
  await expect(page.locator('#announcer')).toHaveText('Base Panel added. 2 of 6 panels placed.');

  await page.locator('#boxWidth').fill('200');
  await page.locator('#boxWidth').press('Enter');
  await expect(page.locator('#panelCount')).toHaveText('2/6');
  await expect.poll(() => page.evaluate(() => window.boxNetApp.getState().dimensions.width)).toBe(200);

  await page.locator('#boxDepth').fill('0');
  await page.locator('#boxDepth').press('Enter');
  await expect(page.locator('#boxDepth')).toHaveValue('40');
  await expect(page.locator('#toast')).toHaveText('Enter valid positive dimensions.');

  await activate(page, 'Add Top Panel to the top edge of Front Panel');
  await activate(page, 'Add Back Panel to the top edge of Top Panel');
  await activate(page, 'Add Left Panel to the left edge of Front Panel');
  await activate(page, 'Add Right Panel to the right edge of Back Panel');
  await page.locator('.step[data-step-target="artwork"]').click();
  await loadGeneratedPng(page);
  await page.locator('#artworkWorkspace').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await page.locator('.step[data-step-target="box"]').click();
  await expect(page.locator('#boxStep')).toBeVisible();

  await page.locator('#boxHeight').fill('100');
  await page.locator('#boxHeight').press('Enter');
  await expect(page.locator('#panelCount')).toHaveText('6/6');

  await page.evaluate(() => {
    window.__cancelled = 0;
    window.addEventListener('box-net-cancelled', () => {
      window.__cancelled += 1;
    });
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#cancelButton').click();
  await expect.poll(() => page.evaluate(() => window.__cancelled)).toBe(1);
});

test('handles invalid and multi-file input, PDF page selection and rotated vector export', async ({ page }) => {
  await openArtworkStep(page);

  await page.locator('#artworkFileInput').setInputFiles({
    name: 'fake.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not an image'),
  });
  await expect(page.locator('#errorBanner')).toContainText('Use a PNG, JPG/JPEG or PDF file.');
  await expect(page.getByRole('button', { name: 'Choose another file' })).toBeVisible();

  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['a'], 'a.png', { type: 'image/png' }));
    transfer.items.add(new File(['b'], 'b.png', { type: 'image/png' }));
    document.getElementById('artworkCanvasWrap').dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    }));
  });
  await expect(page.locator('#errorBanner')).toContainText('Drop exactly one artwork file.');

  const source = await PDFDocument.create();
  const first = source.addPage([300, 200]);
  first.drawRectangle({ x: 20, y: 20, width: 260, height: 160, color: rgb(1, 0, 0) });
  const second = source.addPage([400, 250]);
  second.setRotation(degrees(90));
  second.drawRectangle({ x: 20, y: 20, width: 360, height: 210, color: rgb(0, 0, 1) });
  const sourceBytes = await source.save();

  await page.locator('#artworkFileInput').setInputFiles({
    name: 'multipage.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(sourceBytes),
  });
  const dialog = page.getByRole('dialog', { name: 'Choose PDF page' });
  await expect(dialog).toBeVisible();
  await page.locator('#pdfPageNumber').fill('2');
  await page.getByRole('button', { name: 'Open page' }).click();
  await expect(page.locator('#artworkFileName')).toHaveText('multipage.pdf', { timeout: 20_000 });
  const sourceState = await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.source);
  expect(sourceState.pageIndex).toBe(1);
  expect(sourceState.pageCount).toBe(2);
  expect(sourceState.pdfPageRotation).toBe(90);
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.rotation)).toBe(90);

  await page.locator('.step[data-step-target="preview"]').click();
  const downloadPromise = page.waitForEvent('download');
  await (await openMenuExport(page, '2d', '#menuExportPdfBtn')).click();
  const downloaded = await downloadPromise;
  const exported = await PDFDocument.load(await readFile(await downloaded.path()));
  const exportedPage = exported.getPage(0);
  const resources = exportedPage.node.Resources();
  expect(resources.lookup(PDFName.of('Properties'), PDFDict).has(PDFName.of('Dieline'))).toBe(true);
});

test('keeps model state stable during responsive resize without ResizeObserver', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: undefined,
    });
  });
  await page.reload();
  await chooseWorkflow(page, 'quick');
  await activate(page, 'Add Left Panel to the left edge of Front Panel');

  const stateBefore = await page.evaluate(() => window.boxNetApp.getState());
  await page.setViewportSize({ width: 390, height: 720 });
  const shellBounds = await page.locator('.app-shell').evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });
  expect(shellBounds).toEqual({ x: 0, y: 0, width: 390, height: 720 });
  await expect(page.locator('#workspace')).toBeVisible();
  expect(await page.evaluate(() => window.boxNetApp.getState())).toEqual(stateBefore);
});

test('restores Preview mode from validated autosave without the technical-proof notice', async ({ page }) => {
  await openArtworkStep(page);
  await loadGeneratedPng(page);
  await page.locator('.step[data-step-target="preview"]').click();
  await expect(page.locator('#previewStep')).toBeVisible();
  await expect(page.locator('.technical-proof-notice')).toHaveCount(0);

  await expect.poll(() => page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('carton-builder');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise((resolve, reject) => {
      const transaction = database.transaction('projects', 'readonly');
      const request = transaction.objectStore('projects').get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return value?.snapshot?.workflowStep;
  })).toBe('preview');

  await page.reload();
  await expect(page.locator('#previewStep')).toBeVisible();
  await expect(page.locator('[data-step-target="preview"]')).toHaveAttribute('aria-current', 'step');
});

test('localizes persistent errors and rejects a corrupt autosave without mutating the clean model', async ({ page }) => {
  await openArtworkStep(page);
  await page.locator('#localePicker').selectOption('ru');
  await expect(page.locator('#artworkWorkspace')).toHaveAttribute(
    'aria-label',
    'Холст размещения макета',
  );

  await page.locator('#artworkFileInput').setInputFiles({
    name: 'fake.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not an image'),
  });
  await expect(page.locator('#errorBanner')).toContainText(
    'Используйте файл PNG, JPG/JPEG или PDF.',
  );
  await expect(page.getByRole('button', { name: 'Выбрать другой файл' })).toBeVisible();

  await page.locator('#projectFileInput').setInputFiles({
    name: 'broken.carton',
    mimeType: 'application/zip',
    buffer: Buffer.from('not a project'),
  });
  await expect(page.locator('#errorBanner')).toContainText(
    'Выберите корректный проект .carton размером до 120 МБ.',
  );

  await loadGeneratedPng(page, 'autosave-source.png');
  await page.waitForTimeout(650);
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('carton-builder');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise((resolve, reject) => {
      const transaction = database.transaction('projects', 'readonly');
      const request = transaction.objectStore('projects').get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    record.artworkBlobs = [{ originalBlob: null, previewBlob: null }];
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('projects', 'readwrite');
      const request = transaction.objectStore('projects').put(record, 'current');
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
    database.close();
  });

  await page.reload();
  await expect(page.locator('#errorBanner')).toContainText(
    'Сохранённый проект не удалось восстановить. Открыт чистый проект.',
  );
  await expect(page.locator('#workflowStep')).toBeVisible();
  await expect(page.locator('#boxStep')).toBeHidden();
  await expect(page.locator('#panelCount')).toHaveText('1/6');
  await expect.poll(
    () => page.evaluate(() => window.cartonBuilderApp.artwork.artwork.hasArtwork),
  ).toBe(false);
});

test('cancels worker processing and revokes superseded preview URLs', async ({ page }) => {
  await page.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    window.__objectUrlAudit = { created: [], revoked: [] };
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      window.__objectUrlAudit.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.__objectUrlAudit.revoked.push(url);
      return revoke(url);
    };
  });
  await page.reload();
  await openArtworkStep(page);

  const source = await PDFDocument.create();
  for (let index = 0; index < 24; index += 1) {
    const pdfPage = source.addPage([1200, 800]);
    pdfPage.drawRectangle({
      x: 20,
      y: 20,
      width: 1160,
      height: 760,
      color: rgb(0.2, 0.4, 0.7),
    });
  }
  const sourceBytes = await source.save();
  await page.locator('#artworkFileInput').setInputFiles({
    name: 'large.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(sourceBytes),
  });
  await expect(page.locator('#processingOverlay')).toBeVisible();
  // PDF input opens the page picker before the worker can finish. Cancelling
  // that modal is the user-visible cancellation path and aborts processing.
  await page.getByRole('dialog', { name: 'Choose PDF page' })
    .getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#processingOverlay')).toBeHidden();
  await expect(page.locator('#artworkCanvasWrap')).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.hasArtwork)).toBe(false);

  for (let index = 0; index < 20; index += 1) {
    await loadGeneratedPng(page, `replacement-${index}.png`);
  }

  const audit = await page.evaluate(() => window.__objectUrlAudit);
  const activeUrls = audit.created.filter((url) => !audit.revoked.includes(url));
  expect(activeUrls).toHaveLength(40);
  expect(new Set(audit.revoked).size).toBe(audit.created.length - 40);
});

test('allows opening a .carton project directly from Step 1 (Create Box)', async ({ page }) => {
  await expect(page.locator('#workflowStep')).toBeVisible();
  expect(await page.evaluate(() => window.cartonBuilderApp.getState())).toBe(null);

  const boxModel = new BoxNetModel({ width: 200, height: 100, depth: 50 });
  boxModel.addPanel('Front', 'bottom', 'Base');
  boxModel.addPanel('Front', 'top', 'Top');
  boxModel.addPanel('Top', 'top', 'Back');
  boxModel.addPanel('Front', 'left', 'Left');
  boxModel.addPanel('Back', 'right', 'Right');

  const originalBlob = new Blob([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
  ], { type: 'image/png' });
  const previewBlob = new Blob([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2]),
  ], { type: 'image/png' });
  const sourceHash = await sha256(originalBlob);

  const snapshot = {
    schemaVersion: 1,
    meta: { name: 'Direct project load' },
    workflowStep: 'artwork',
    box: boxModel.toJSON(),
    artwork: {
      source: {
        id: 'asset-direct',
        fileName: 'direct-project.png',
        mimeType: 'image/png',
        byteLength: originalBlob.size,
        widthPx: 100,
        heightPx: 50,
        previewWidthPx: 100,
        previewHeightPx: 50,
        pageIndex: null,
        pageCount: null,
        vector: false,
        pdfPageRotation: 0,
        mediaBox: null,
        sha256: sourceHash,
      },
      centerXmm: 100,
      centerYmm: 50,
      initialWidthMm: 200,
      initialHeightMm: 100,
      scale: 1,
      rotation: 0,
      opacity: 1,
      modified: false,
    },
    view: {},
    history: { undo: [], redo: [] },
  };

  const archiveBlob = await createProjectArchive({
    snapshot,
    artworkBlobs: [{ originalBlob, previewBlob }],
  });
  const buffer = Buffer.from(await archiveBlob.arrayBuffer());

  await (await openFileAction(page, '#menuOpenProjectBtn')).click();
  await page.locator('#projectFileInput').setInputFiles({
    name: 'direct-test.carton',
    mimeType: 'application/zip',
    buffer,
  });

  await expect(page.locator('#artworkStep')).toBeVisible();
  await expect(page.locator('#artworkFileName')).toHaveText('direct-project.png');
});

test('persists custom box dimensions and panel layout across page reloads without artwork', async ({ page }) => {
  await chooseWorkflow(page, 'quick');

  await page.locator('#boxWidth').fill('210');
  await page.locator('#boxWidth').dispatchEvent('change');
  await page.locator('#boxHeight').fill('110');
  await page.locator('#boxHeight').dispatchEvent('change');

  await buildReferenceNet(page);
  await expect(page.locator('#panelCount')).toHaveText('6/6');

  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());
  await page.reload();

  await expect(page.locator('#boxStep')).toBeVisible();
  await expect(page.locator('#boxWidth')).toHaveValue('210');
  await expect(page.locator('#boxHeight')).toHaveValue('110');
  await expect(page.locator('#panelCount')).toHaveText('6/6');
});

test('persists box net after removing artwork and reloading without showing an error banner', async ({ page }) => {
  await openArtworkStep(page);
  await loadGeneratedPng(page);
  await expect(page.locator('#artworkFileName')).toHaveText('sample-artwork.png');
  page.once('dialog', (dialog) => dialog.accept());
  await (await openEditAction(page, '#menuRemoveArtworkBtn')).click();
  await expect(page.locator('#artworkFileName')).toHaveText('No file selected');

  await page.locator('.step[data-step-target="box"]').click();
  await expect(page.locator('#boxStep')).toBeVisible();
  await expect(page.locator('#boxStep')).toBeVisible();

  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());
  await page.reload();

  await expect(page.locator('#boxStep')).toBeVisible();
  await expect(page.locator('#errorBanner')).toBeHidden();
  await expect(page.locator('#panelCount')).toHaveText('6/6');
});

test('resets custom dimensions and panel layout back to defaults with one click', async ({ page }) => {
  await chooseWorkflow(page, 'quick');

  await page.locator('#boxWidth').fill('240');
  await page.locator('#boxWidth').dispatchEvent('change');
  await page.locator('#boxHeight').fill('120');
  await page.locator('#boxHeight').dispatchEvent('change');
  await buildReferenceNet(page);
  await expect(page.locator('#panelCount')).toHaveText('6/6');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reset Box' }).click();

  await expect(page.locator('#boxWidth')).toHaveValue('150');
  await expect(page.locator('#boxHeight')).toHaveValue('90');
  await expect(page.locator('#boxDepth')).toHaveValue('40');
  await expect(page.locator('#panelCount')).toHaveText('1/6');

  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());
  await page.reload();

  await expect(page.locator('#boxWidth')).toHaveValue('150');
  await expect(page.locator('#panelCount')).toHaveText('1/6');
});

test('auto-hides unpinned dock panels and reveals them from the edge, pinning persists', async ({ page }) => {
  await openArtworkStep(page);
  const stage = page.locator('#artworkStage');

  await expect(stage).toHaveAttribute('data-left', 'pinned');
  await expect(stage).toHaveAttribute('data-right', 'pinned');
  await expect(page.locator('#panelEdgeLeft')).toBeHidden();

  await page.locator('#pinLeftPanel').click();
  await expect(stage).toHaveAttribute('data-left', 'open');
  await expect(page.locator('#pinLeftPanel')).toHaveAttribute('aria-pressed', 'false');

  await page.mouse.move(700, 360);
  await expect(stage).toHaveAttribute('data-left', 'closed');
  await expect(page.locator('#panelEdgeLeft')).toBeVisible();

  await page.waitForTimeout(400);
  await page.locator('#panelEdgeLeft').hover({ force: true });
  await expect(stage).toHaveAttribute('data-left', 'open');
  await expect(page.locator('#panelEdgeLeft')).toBeHidden();

  await page.locator('#pinLeftPanel').click();
  await expect(stage).toHaveAttribute('data-left', 'pinned');
  await expect(page.locator('#pinLeftPanel')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#pinRightPanel').click();
  await expect(stage).toHaveAttribute('data-right', 'open');
  await page.mouse.move(640, 360);
  await expect(stage).toHaveAttribute('data-right', 'closed');
  await expect(page.locator('#panelEdgeRight')).toBeVisible();

  await page.waitForTimeout(400);
  await page.locator('#panelEdgeRight').hover({ force: true });
  await expect(stage).toHaveAttribute('data-right', 'open');
  await page.locator('#pinRightPanel').click();
  await expect(stage).toHaveAttribute('data-right', 'pinned');

  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());
  await page.reload();

  await expect(page.locator('#artworkStep')).toBeVisible();
  await expect(stage).toHaveAttribute('data-left', 'pinned');
  await expect(stage).toHaveAttribute('data-right', 'pinned');
});

test('reference point selector swaps X/Y without moving artwork and anchors transforms', async ({ page }) => {
  await openArtworkStep(page);
  await loadGeneratedPng(page);

  const centerButton = page.locator('.reference-point-button[data-point="center"]');
  const topLeftButton = page.locator('.reference-point-button[data-point="top-left"]');
  await expect(centerButton).toHaveAttribute('aria-pressed', 'true');

  const centerX = Number(await page.locator('#artworkX').inputValue());
  const centerY = Number(await page.locator('#artworkY').inputValue());
  const modelCenter = await page.evaluate(() => {
    const model = window.cartonBuilderApp.artwork.artwork;
    return { x: model.centerXmm, y: model.centerYmm };
  });

  await topLeftButton.click();
  await expect(topLeftButton).toHaveAttribute('aria-pressed', 'true');
  await expect(centerButton).toHaveAttribute('aria-pressed', 'false');

  const topLeftX = Number(await page.locator('#artworkX').inputValue());
  const topLeftY = Number(await page.locator('#artworkY').inputValue());
  expect(topLeftX).toBeLessThan(centerX);
  expect(topLeftY).toBeLessThan(centerY);

  const modelAfter = await page.evaluate(() => {
    const model = window.cartonBuilderApp.artwork.artwork;
    return { x: model.centerXmm, y: model.centerYmm };
  });
  expect(modelAfter.x).toBeCloseTo(modelCenter.x, 5);
  expect(modelAfter.y).toBeCloseTo(modelCenter.y, 5);

  await page.locator('#artworkX').fill('0');
  await page.locator('#artworkX').dispatchEvent('change');
  await page.locator('#artworkY').fill('0');
  await page.locator('#artworkY').dispatchEvent('change');
  await expect.poll(() => page.evaluate(() => {
    const position = window.cartonBuilderApp.artwork.artwork.getReferencePosition();
    return Math.round(position.x * 100) === 0 && Math.round(position.y * 100) === 0;
  })).toBe(true);

  const anchor = await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.getReferencePosition());
  await page.locator('#artworkScaleX').fill('150');
  await page.locator('#artworkScaleX').dispatchEvent('change');
  await expect.poll(() => page.evaluate(() => (
    Math.round(window.cartonBuilderApp.artwork.artwork.scaleX * 100) === 150
  ))).toBe(true);
  const anchorAfterScale = await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.getReferencePosition());
  expect(anchorAfterScale.x).toBeCloseTo(anchor.x, 4);
  expect(anchorAfterScale.y).toBeCloseTo(anchor.y, 4);

  await page.getByRole('button', { name: 'Rotate +90°' }).click();
  const anchorAfterRotate = await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.getReferencePosition());
  expect(anchorAfterRotate.x).toBeCloseTo(anchorAfterScale.x, 4);
  expect(anchorAfterRotate.y).toBeCloseTo(anchorAfterScale.y, 4);
});

test('front-relative coordinates follow the technical body.front reference frame', async ({ page }) => {
  test.setTimeout(120_000);
  await chooseWorkflow(page, 'technical');
  const frame = page.frameLocator('#technicalHostFrame');
  await expect(page.locator('#technicalHostValidation')).toHaveText(
    'Structural VALID · Geometry VALID · Contract VALID',
    { timeout: 20_000 },
  );

  // The frame must follow the accepted PBD presentation, including a host-side
  // transform that was applied before the technical document was accepted.
  await frame.locator('#flipHorizontalBtn').click();
  await expect(frame.locator('#canvas svg')).toHaveAttribute('data-presentation-transform', '-1,0,0,1');

  const readFrontRelativeState = () => page.evaluate(() => {
    const app = window.cartonBuilderApp;
    const artwork = app.artwork.artwork;
    const reference = artwork.getReferencePosition();
    const frontFrame = app.artwork.getArtworkReferenceFrame();
    return {
      center: { x: artwork.centerXmm, y: artwork.centerYmm },
      reference,
      frontFrame,
      visible: !document.querySelector('#frontRelativeCoordinates').hidden,
    };
  });

  for (const [index, cartonType] of ['RTE', 'STE', 'TT_SL123'].entries()) {
    if (index > 0) {
      await page.locator('.step[data-step-target="box"]').click();
      await expect(frame.locator('#cartonType')).toBeVisible();
      await frame.locator('#cartonType').selectOption(cartonType);
      await expect(page.locator('#technicalHostValidation')).toHaveText(
        'Structural VALID · Geometry VALID · Contract VALID',
      );
    }

    await page.locator('.step[data-step-target="artwork"]').click();
    await expect(page.locator('#artworkStep')).toBeVisible();
    await loadGeneratedPng(page, `front-relative-${cartonType}.png`);
    await expect(page.locator('#frontRelativeCoordinates')).toBeVisible();

    const initial = await readFrontRelativeState();
    expect(initial.visible).toBe(true);
    expect(initial.frontFrame).toMatchObject({ surfaceId: 'body.front', units: 'mm' });
    expect(Number(await page.locator('#artworkX').inputValue())).toBeCloseTo(initial.reference.x, 2);
    expect(Number(await page.locator('#artworkY').inputValue())).toBeCloseTo(initial.reference.y, 2);
    expect(Number(await page.locator('#frontRelativeX').textContent())).toBeCloseTo(
      initial.reference.x - initial.frontFrame.origin.x,
      2,
    );
    expect(Number(await page.locator('#frontRelativeY').textContent())).toBeCloseTo(
      initial.reference.y - initial.frontFrame.origin.y,
      2,
    );

    const centerBeforeReferenceChange = initial.center;
    const relativeBeforeReferenceChange = {
      x: Number(await page.locator('#frontRelativeX').textContent()),
      y: Number(await page.locator('#frontRelativeY').textContent()),
    };
    await page.locator('.reference-point-button[data-point="top-left"]').click();
    await expect.poll(async () => {
      const state = await readFrontRelativeState();
      return state.reference.x !== initial.reference.x || state.reference.y !== initial.reference.y;
    }).toBe(true);
    const afterReferenceChange = await readFrontRelativeState();
    expect(afterReferenceChange.center.x).toBeCloseTo(centerBeforeReferenceChange.x, 5);
    expect(afterReferenceChange.center.y).toBeCloseTo(centerBeforeReferenceChange.y, 5);
    expect(Number(await page.locator('#frontRelativeX').textContent())).not.toBe(relativeBeforeReferenceChange.x);
    expect(Number(await page.locator('#frontRelativeY').textContent())).not.toBe(relativeBeforeReferenceChange.y);

    const movedReference = {
      x: afterReferenceChange.reference.x + 7.25,
      y: afterReferenceChange.reference.y + 4.5,
    };
    await page.locator('#artworkX').fill(String(movedReference.x));
    await page.locator('#artworkX').dispatchEvent('change');
    await page.locator('#artworkY').fill(String(movedReference.y));
    await page.locator('#artworkY').dispatchEvent('change');
    await expect.poll(async () => {
      const state = await readFrontRelativeState();
      return Math.abs(state.reference.x - movedReference.x) < 0.01
        && Math.abs(state.reference.y - movedReference.y) < 0.01;
    }).toBe(true);
    const afterMove = await readFrontRelativeState();
    expect(Number(await page.locator('#frontRelativeX').textContent())).toBeCloseTo(
      afterMove.reference.x - afterMove.frontFrame.origin.x,
      2,
    );
    expect(Number(await page.locator('#frontRelativeY').textContent())).toBeCloseTo(
      afterMove.reference.y - afterMove.frontFrame.origin.y,
      2,
    );

    if (index < 2) {
      page.once('dialog', (dialog) => dialog.accept());
      await (await openEditAction(page, '#menuRemoveArtworkBtn')).click();
      await expect(page.locator('#artworkFileName')).toHaveText('No file selected');
    }
  }

  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());
  const beforeReload = await readFrontRelativeState();
  await page.reload();
  await expect(page.locator('#artworkStep')).toBeVisible({ timeout: 20_000 });
  await expect(frame.locator('#cartonType')).toHaveValue('TT_SL123', { timeout: 20_000 });
  await expect(page.locator('#frontRelativeCoordinates')).toBeVisible();
  const afterReload = await readFrontRelativeState();
  expect(afterReload.reference.x).toBeCloseTo(beforeReload.reference.x, 5);
  expect(afterReload.reference.y).toBeCloseTo(beforeReload.reference.y, 5);
  expect(afterReload.frontFrame).toEqual(beforeReload.frontFrame);
});

test('front-relative coordinates stay hidden in the Quick workflow', async ({ page }) => {
  await openArtworkStep(page);
  await loadGeneratedPng(page, 'quick-front-relative.png');
  await expect(page.locator('#frontRelativeCoordinates')).toBeHidden();
  await expect(page.locator('#artworkX')).toBeVisible();
});

test('keeps transform and scale controls aligned on one parameter grid', async ({ page }) => {
  await openArtworkStep(page);
  await loadGeneratedPng(page);

  const geometry = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      const bounds = element.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    };
    return {
      x: rect('#artworkX'),
      y: rect('#artworkY'),
      width: rect('#artworkWidth'),
      height: rect('#artworkHeight'),
      scaleX: rect('#artworkScaleX'),
      scaleY: rect('#artworkScaleY'),
      chain: rect('#constrainProportionsBtn'),
      transformUnits: [...document.querySelectorAll('.transform-fields .transform-unit')].map((element) => {
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, width: bounds.width };
      }),
      scaleUnits: [...document.querySelectorAll('.scale-fields .transform-unit')].map((element) => {
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, width: bounds.width };
      }),
    };
  });

  expect(geometry.scaleX.x).toBeCloseTo(geometry.x.x, 5);
  expect(geometry.scaleY.x).toBeCloseTo(geometry.width.x, 5);
  expect(geometry.scaleX.width).toBeCloseTo(geometry.x.width, 5);
  expect(geometry.scaleY.width).toBeCloseTo(geometry.width.width, 5);
  expect(geometry.scaleUnits[0].x).toBeCloseTo(geometry.transformUnits[0].x, 5);
  expect(geometry.scaleUnits[1].x).toBeCloseTo(geometry.transformUnits[1].x, 5);

  const widthCenter = geometry.width.y + geometry.width.height / 2;
  const heightCenter = geometry.height.y + geometry.height.height / 2;
  const chainCenter = geometry.chain.y + geometry.chain.height / 2;
  expect(chainCenter).toBeCloseTo((widthCenter + heightCenter) / 2, 5);
});

test('adds multiple artworks with named sublayers, reorders and renames them', async ({ page }) => {
  await openArtworkStep(page);
  await loadGeneratedPng(page, 'first.png');
  await loadGeneratedPng(page, 'second.png');

  const sublayers = page.locator('#artworkSublayers .artwork-sublayer');
  await expect(sublayers).toHaveCount(2);
  await expect(sublayers.nth(0)).toHaveText('second.png');
  await expect(sublayers.nth(1)).toHaveText('first.png');

  await expect(page.locator('#artworkFileName')).toHaveText('second.png');
  const state = await page.evaluate(() => window.cartonBuilderApp.artwork.createSnapshot());
  expect(state.artworks.map((entry) => entry.artwork.source.fileName)).toEqual(['second.png', 'first.png']);
  expect(state.activeArtworkIndex).toBe(0);

  await sublayers.nth(1).click();
  await expect(page.locator('#artworkFileName')).toHaveText('first.png');
  await expect(sublayers.nth(1)).toHaveClass(/active/);

  await sublayers.nth(1).locator('.layer-title').dblclick();
  const renameInput = sublayers.nth(1).locator('.layer-rename-input');
  await renameInput.fill('renamed.png');
  await renameInput.press('Enter');
  await expect(sublayers.nth(1)).toHaveText('renamed.png');
  await expect(page.locator('#artworkFileName')).toHaveText('renamed.png');

  // Verify reorder works via Ctrl+Z of rename (undo rename → verify name reverts)
  await page.keyboard.press('Control+z');
  await expect(page.locator('#artworkFileName')).toHaveText('first.png');
  await expect(sublayers.nth(1).locator('.layer-title')).toHaveText('first.png');
  // Redo rename
  await page.keyboard.press('Control+y');
  await expect(sublayers.nth(1).locator('.layer-title')).toHaveText('renamed.png');

  const secondRow = page.locator('#artworkSublayers .artwork-sublayer').nth(0);
  await secondRow.locator('.eye-cell').click();
  await expect(page.locator('#artworkSublayers .artwork-sublayer').nth(0)).toHaveText('second.png');
  const visibility = await page.evaluate(() => window.cartonBuilderApp.artwork.createSnapshot());
  expect(visibility.artworks[0].visible).toBe(false);

  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());
  await page.reload();
  await page.locator('#artworkStep').waitFor({ state: 'visible' });
  await expect(page.locator('#artworkSublayers .artwork-sublayer')).toHaveCount(2);
  await expect(page.locator('#artworkSublayers .artwork-sublayer').nth(0)).toHaveText('second.png');
  await expect(page.locator('#artworkSublayers .artwork-sublayer').nth(1)).toHaveText('renamed.png');
});






