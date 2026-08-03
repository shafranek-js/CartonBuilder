import { BoxNetModel } from '../model/BoxNetModel.js';
import { DEFAULT_BOARD_APPEARANCE } from './BoardAppearance.js';
import { getPresetThumbnail, savePresetThumbnail } from './PresetThumbnailStore.js';
import { getRenderPreset } from './renderPresets.js';

const THUMBNAIL_WIDTH = 160;
const THUMBNAIL_HEIGHT = 120;

function createNeutralBox() {
  const model = new BoxNetModel({ width: 120, height: 180, depth: 60 });
  model.addPanel('front', 'bottom');
  model.addPanel('front', 'top');
  model.addPanel('top', 'top');
  model.addPanel('front', 'left');
  model.addPanel('back', 'right');
  return model;
}

function pixelsToWebp(documentRef, pixels, width, height) {
  const canvas = documentRef.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const imageData = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = height - y - 1;
    for (let x = 0; x < width; x += 1) {
      const source = (sourceY * width + x) * 4;
      const target = (y * width + x) * 4;
      imageData.data[target] = pixels[source];
      imageData.data[target + 1] = pixels[source + 1];
      imageData.data[target + 2] = pixels[source + 2];
      imageData.data[target + 3] = pixels[source + 3];
    }
  }
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/webp', 0.82);
}

export async function generateNeutralRenderThumbnail({ presetId, documentRef = document, windowRef = window } = {}) {
  const cached = await getPresetThumbnail(`render:${presetId}`);
  if (cached?.dataUrl) return cached.dataUrl;
  const { WebGLCartonRenderer } = await import('./WebGLCartonRenderer.js');
  const container = documentRef.createElement('div');
  const canvas = documentRef.createElement('canvas');
  container.style.cssText = `position:fixed;left:-10000px;top:-10000px;width:${THUMBNAIL_WIDTH}px;height:${THUMBNAIL_HEIGHT}px;`;
  canvas.width = THUMBNAIL_WIDTH;
  canvas.height = THUMBNAIL_HEIGHT;
  container.appendChild(canvas);
  documentRef.body?.appendChild(container);
  const textureCanvas = documentRef.createElement('canvas');
  textureCanvas.width = 512;
  textureCanvas.height = 512;
  const textureContext = textureCanvas.getContext('2d');
  textureContext.fillStyle = '#f2f2ee';
  textureContext.fillRect(0, 0, textureCanvas.width, textureCanvas.height);
  const renderer = new WebGLCartonRenderer({
    canvas,
    container,
    boxModel: createNeutralBox(),
    textureCanvas,
    renderSettings: getRenderPreset(presetId),
    boardAppearance: DEFAULT_BOARD_APPEARANCE,
    windowRef,
  });
  try {
    renderer.resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, 1);
    const settings = getRenderPreset(presetId);
    const result = await renderer.renderToPixels({
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
      backgroundMode: settings.background.mode,
      backgroundColor: settings.background.color,
      includeShadow: settings.shadows.enabled,
      includeReflection: settings.floor.reflection.enabled,
    });
    const dataUrl = pixelsToWebp(documentRef, result.pixels, result.width, result.height);
    await savePresetThumbnail({ id: `render:${presetId}`, presetId, kind: 'render', dataUrl });
    return dataUrl;
  } finally {
    renderer.dispose();
    container.remove();
  }
}
