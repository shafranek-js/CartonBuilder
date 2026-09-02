import {
  ClampToEdgeWrapping,
  LinearFilter,
  SRGBColorSpace,
  Texture,
} from 'three';

import { normalizeRenderAsset, validateRenderBackground } from './renderAssets.js';

function isObjectLike(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function assertRenderSurface(renderSurface) {
  if (!isObjectLike(renderSurface) || !isObjectLike(renderSurface.renderer)) {
    throw new TypeError('RenderStudioBackgroundAdapter requires a renderSurface.');
  }
}

function disposeResource(resource) {
  try {
    resource?.dispose?.();
  } catch {
    // Cleanup is best-effort for stale async resources. The active resource
    // is still retained when a replacement cannot be installed.
  }
}

function defaultUrlApi(windowRef) {
  return windowRef?.URL || globalThis.URL || null;
}

async function defaultTextureLoader(asset, {
  windowRef,
  createImageBitmapFn,
  urlApi,
} = {}) {
  const createBitmap = createImageBitmapFn
    || windowRef?.createImageBitmap
    || globalThis.createImageBitmap;
  if (typeof createBitmap === 'function') {
    const bitmap = await createBitmap(asset.blob);
    const texture = new Texture(bitmap);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.flipY = false;
    texture.needsUpdate = true;
    return { texture, bitmap };
  }

  const ImageCtor = windowRef?.Image || globalThis.Image;
  const api = urlApi || defaultUrlApi(windowRef);
  if (typeof ImageCtor !== 'function' || typeof api?.createObjectURL !== 'function') {
    throw new Error('Render background requires an image decoder.');
  }
  const objectUrl = api.createObjectURL(asset.blob);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new ImageCtor();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Render background image decode failed.'));
      element.src = objectUrl;
    });
    const texture = new Texture(image);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.flipY = false;
    texture.needsUpdate = true;
    return { texture, image, objectUrl };
  } catch (error) {
    try { api.revokeObjectURL?.(objectUrl); } catch { /* preserve decode error */ }
    throw error;
  }
}

function loadedTexture(result) {
  return result?.isTexture || result?.isDataTexture ? result : result?.texture;
}

function disposeLoaded(result, urlApi) {
  if (!result) return;
  disposeResource(loadedTexture(result));
  if (result.objectUrl) {
    try { urlApi?.revokeObjectURL?.(result.objectUrl); } catch { /* best effort */ }
  }
  result.bitmap?.close?.();
}

function defaultImageState() {
  return {
    assetId: '',
    fileName: '',
    mimeType: '',
    width: 0,
    height: 0,
    fit: 'cover',
    positionX: 0.5,
    positionY: 0.5,
    zoom: 1,
    blur: 0,
    brightness: 1,
    overlayColor: '#000000',
    overlayOpacity: 0,
  };
}

/** Owns decoded presentation textures for the Render Studio backplate. */
export class RenderStudioBackgroundAdapter {
  constructor({
    renderSurface,
    surface = null,
    windowRef = globalThis.window || globalThis,
    textureLoader = defaultTextureLoader,
    backgroundTextureLoader = null,
    createImageBitmapFn = null,
    urlApi = null,
    backgroundAsset = null,
    backgroundImage = null,
  } = {}) {
    const resolvedSurface = renderSurface || surface?.renderSurface;
    assertRenderSurface(resolvedSurface);
    if (typeof (backgroundTextureLoader || textureLoader) !== 'function') {
      throw new TypeError('RenderStudioBackgroundAdapter requires textureLoader().');
    }

    this.renderSurface = resolvedSurface;
    this.surface = surface;
    this.windowRef = windowRef;
    this.textureLoader = backgroundTextureLoader || textureLoader;
    this.createImageBitmapFn = createImageBitmapFn;
    this.urlApi = urlApi || defaultUrlApi(windowRef);
    this.disposed = false;
    this._generation = 0;
    this._texture = null;
    this._loadedResource = null;
    this._asset = backgroundAsset || null;
    this._image = { ...defaultImageState(), ...(backgroundImage || {}) };
    this._diagnostics = {
      assetId: this._asset?.assetId || '',
      fallbackReason: null,
      loaded: false,
    };
  }

  get backgroundAsset() {
    return this._asset;
  }

  get backgroundImage() {
    return { ...this._image };
  }

  _validateAsset(asset) {
    const normalized = asset instanceof Blob ? null : normalizeRenderAsset(asset);
    if (asset && !(asset instanceof Blob) && (!normalized || normalized.kind === 'environment')) {
      throw new Error('Render background asset metadata is invalid.');
    }
    const blob = normalized?.blob || (asset instanceof Blob ? asset : asset?.blob);
    if (!(blob instanceof Blob)) throw new Error('Render background requires a Blob asset.');
    return validateRenderBackground(blob, {
      createImageBitmapFn: this.createImageBitmapFn
        || this.windowRef?.createImageBitmap
        || globalThis.createImageBitmap,
    }).then((validated) => {
      if (normalized) {
        if (normalized.assetId && normalized.assetId !== validated.assetId) {
          throw new Error('Render background checksum does not match its metadata.');
        }
        if (normalized.mimeType && normalized.mimeType !== validated.mimeType) {
          throw new Error('Render background MIME does not match its metadata.');
        }
      }
      return {
        ...(normalized || {}),
        ...validated,
      };
    });
  }

  _install(result, asset) {
    const texture = loadedTexture(result);
    if (!texture) throw new Error('Render background loader returned no texture.');
    texture.colorSpace = SRGBColorSpace;
    texture.userData = {
      ...(texture.userData || {}),
      cartonBuilderBackground: { ...this._image },
    };
    const previousTexture = this._texture;
    const previousResource = this._loadedResource;
    this._texture = texture;
    this._loadedResource = result;
    this._asset = asset;
    this._diagnostics = {
      assetId: asset?.assetId || '',
      fallbackReason: null,
      loaded: true,
    };
    if (previousResource && previousResource !== result) disposeLoaded(previousResource, this.urlApi);
    else if (previousTexture && previousTexture !== texture) disposeResource(previousTexture);
    return texture;
  }

  setBackgroundImage(image = null) {
    if (this.disposed) return false;
    this._generation += 1;
    this._image = { ...defaultImageState(), ...(image || {}) };
    if (this._texture) {
      this._texture.userData = {
        ...(this._texture.userData || {}),
        cartonBuilderBackground: { ...this._image },
      };
    }
    return this._texture;
  }

  setBackgroundAsset(asset) {
    if (this.disposed) return false;
    const generation = ++this._generation;
    if (asset === null || asset === undefined) {
      const previous = this._loadedResource;
      this._loadedResource = null;
      this._texture = null;
      this._asset = null;
      this._diagnostics = { assetId: '', fallbackReason: null, loaded: false };
      disposeLoaded(previous, this.urlApi);
      return Promise.resolve(null);
    }

    return Promise.resolve()
      .then(() => this._validateAsset(asset))
      .then((validated) => Promise.resolve(this.textureLoader(validated, {
        renderSurface: this.renderSurface,
        windowRef: this.windowRef,
        createImageBitmapFn: this.createImageBitmapFn,
        urlApi: this.urlApi,
      })).then((result) => ({ validated, result })))
      .then(({ validated, result }) => {
        if (this.disposed || generation !== this._generation) {
          disposeLoaded(result, this.urlApi);
          return this._texture;
        }
        return this._install(result, validated);
      })
      .catch((error) => {
        if (this.disposed || generation !== this._generation) return this._texture;
        this._diagnostics = {
          assetId: asset?.assetId || '',
          fallbackReason: error?.code || error?.message || 'background-load-failed',
          loaded: Boolean(this._texture),
        };
        return this._texture;
      });
  }

  getDiagnostics() {
    return {
      ...this._diagnostics,
      image: { ...this._image },
    };
  }

  handleContextLost() {
    if (this.disposed) return false;
    this._generation += 1;
    return true;
  }

  handleContextRestored() {
    if (this.disposed || !this._asset) return false;
    return this.setBackgroundAsset(this._asset);
  }

  dispose() {
    if (this.disposed) return false;
    this.disposed = true;
    this._generation += 1;
    const resource = this._loadedResource;
    this._loadedResource = null;
    this._texture = null;
    disposeLoaded(resource, this.urlApi);
    return true;
  }
}

export { defaultTextureLoader };
