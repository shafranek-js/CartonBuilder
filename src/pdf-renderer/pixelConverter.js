export function pixmapToRgba(pixmap) {
  const pixels = pixmap.getPixels();
  const components = pixmap.getNumberOfComponents();
  const width = pixmap.getWidth();
  const stride = pixmap.getStride();
  const height = pixmap.getHeight();
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = y * stride + x * components;
      const target = (y * width + x) * 4;
      out[target] = pixels[source];
      out[target + 1] = pixels[source + 1];
      out[target + 2] = pixels[source + 2];
      out[target + 3] = components === 4 ? pixels[source + 3] : 255;
    }
  }
  return out;
}
