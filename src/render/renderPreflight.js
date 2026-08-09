import {
  DEFAULT_RENDER_SETTINGS,
  getRenderOutputDimensions,
  sanitizeRenderSettings,
} from './RenderSettings.js';
import {
  getTurntableDimensions,
  isTurntableWithinPixelBudget,
  TURNTABLE_MAX_PIXELS,
  sanitizeTurntableOptions,
} from './turntableOptions.js';

const DEFAULT_MEMORY_BUDGET_BYTES = 512 * 1024 * 1024;
const RENDER_TARGET_BYTES_PER_PIXEL = 4;

function issue(code, severity, details = {}) {
  return { code, severity, details };
}

function finiteLimit(...values) {
  const limits = values.filter((value) => Number.isFinite(Number(value)) && Number(value) > 0);
  return limits.length ? Math.min(...limits.map(Number)) : Infinity;
}

function maxDimensionFor(diagnostics = {}) {
  return finiteLimit(diagnostics.maxTextureSize, diagnostics.maxRenderbufferSize);
}

function outputFor({ kind, settings }) {
  const sanitized = sanitizeRenderSettings(settings || DEFAULT_RENDER_SETTINGS);
  if (kind === 'sequence') {
    const options = sanitizeTurntableOptions(sanitized.output.sequence);
    return {
      ...getTurntableDimensions(sanitized, options.longEdge),
      frames: options.frames,
      format: options.format,
      options,
    };
  }
  if (kind === 'glb') {
    const textureSize = sanitized.output.glb.textureSize === 'auto'
      ? 2048
      : Number(sanitized.output.glb.textureSize);
    return { width: textureSize, height: textureSize, frames: 1, format: 'glb' };
  }
  return { ...getRenderOutputDimensions(sanitized), frames: 1, format: sanitized.output.format };
}

export function estimateRenderMemoryBytes({ width = 0, height = 0, frames = 1, passCount = 1 } = {}) {
  const pixels = Math.max(0, Number(width) || 0) * Math.max(0, Number(height) || 0);
  const targets = Math.max(2, Number(passCount) + 2);
  return Math.round(pixels * RENDER_TARGET_BYTES_PER_PIXEL * targets * Math.max(1, Number(frames) || 1));
}

export function runRenderExportPreflight({
  kind = 'image',
  format = 'png',
  settings = DEFAULT_RENDER_SETTINGS,
  diagnostics = {},
  hasFinishes = false,
  rendererAvailable = true,
  memoryBudgetBytes = DEFAULT_MEMORY_BUDGET_BYTES,
} = {}) {
  const sanitized = sanitizeRenderSettings({
    ...settings,
    output: { ...(settings?.output || {}), kind, format },
  });
  const output = outputFor({ kind, settings: sanitized });
  const issues = [];
  const raster = kind === 'image' || kind === 'sequence';
  const maxDimension = maxDimensionFor(diagnostics);
  const maxOutputDimension = Math.max(output.width, output.height);
  const passCount = Array.isArray(diagnostics.passes) ? diagnostics.passes.length : 2;
  const estimatedBytes = estimateRenderMemoryBytes({
    ...output,
    passCount,
  });

  if (raster && diagnostics.contextState === 'lost') {
    issues.push(issue('context-lost', 'error'));
  } else if (raster && diagnostics.contextState === 'unavailable') {
    issues.push(issue('renderer-unavailable', 'error'));
  } else if (raster && !rendererAvailable) {
    issues.push(issue('renderer-will-initialize', 'info'));
  }

  if (raster && maxOutputDimension > maxDimension) {
    issues.push(issue('gpu-limit', 'error', {
      width: output.width,
      height: output.height,
      maxDimension,
    }));
  }

  if (kind === 'sequence' && !isTurntableWithinPixelBudget(output, TURNTABLE_MAX_PIXELS)) {
    issues.push(issue('turntable-budget', 'error', {
      frames: output.frames,
      width: output.width,
      height: output.height,
      maxPixels: TURNTABLE_MAX_PIXELS,
    }));
  }

  if (kind === 'image' && format === 'jpg' && sanitized.background.mode === 'transparent') {
    issues.push(issue('jpeg-background', 'warning'));
  }

  if (kind === 'glb' && sanitized.output.glb.materialMode === 'basic-compatibility' && hasFinishes) {
    issues.push(issue('basic-glb-finishes', 'warning'));
  }

  if (kind === 'glb' && (sanitized.lighting.environmentMap?.source === 'custom'
    || sanitized.lighting.environmentMap?.usage === 'background'
    || sanitized.lighting.environmentMap?.usage === 'both'
    || sanitized.background.mode === 'environment')) {
    issues.push(issue('hdri-glb', 'warning'));
  }

  const geometry = diagnostics.geometry || {};
  const unexpectedIntersections = Number(geometry.unexpectedIntersections ?? geometry.intersections);
  if (Number.isFinite(unexpectedIntersections) && unexpectedIntersections > 0) {
    issues.push(issue('invalid-geometry', 'error', {
      templateId: geometry.templateId || 'unknown',
      unexpectedIntersections,
      invalidElement: geometry.invalidElement || null,
    }));
  }

  if (estimatedBytes > memoryBudgetBytes * 0.75) {
    issues.push(issue('memory-budget', 'warning', {
      estimatedBytes,
      memoryBudgetBytes,
    }));
  }

  const status = issues.some((entry) => entry.severity === 'error')
    ? 'blocked'
    : issues.some((entry) => entry.severity === 'warning')
      ? 'warning'
      : 'ready';
  return {
    status,
    issues,
    kind,
    format,
    dimensions: { width: output.width, height: output.height },
    frames: output.frames,
    estimatedBytes,
    maxDimension: Number.isFinite(maxDimension) ? maxDimension : null,
  };
}

export function getRenderHealth(diagnostics = {}) {
  if (diagnostics.contextState === 'lost' || diagnostics.contextState === 'unavailable') {
    return { status: 'unavailable', reasons: [diagnostics.contextState === 'lost' ? 'context-lost' : 'renderer-unavailable'] };
  }
  const quality = diagnostics.quality || diagnostics;
  const target = Number(quality.targetFrameMs);
  const frameTime = Number(quality.frameTime);
  const atMinimumScale = Number(quality.renderScale) > 0 && Number(quality.renderScale) <= 0.7;
  const degraded = (Number.isFinite(target) && Number.isFinite(frameTime) && frameTime > target * 1.2) || atMinimumScale;
  return {
    status: degraded ? 'degraded' : 'healthy',
    reasons: degraded ? ['performance'] : [],
  };
}

export { DEFAULT_MEMORY_BUDGET_BYTES };
