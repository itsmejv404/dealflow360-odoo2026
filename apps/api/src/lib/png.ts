import zlib from 'zlib';

export interface DecodedPng {
  width: number;
  height: number;
  /** Raw RGB bytes (width * height * 3). Alpha is composited over white. */
  rgb: Buffer;
}

/**
 * Minimal PNG decoder sufficient for org logos: supports 8-bit RGB(A),
 * grayscale and palette images with the standard filter set, non-interlaced.
 * Alpha is composited over a white background so logos blend into the page.
 */
export function decodePng(buffer: Buffer): DecodedPng {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(signature)) {
    throw new Error('Not a PNG file');
  }

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idatChunks: Buffer[] = [];

  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 8;
      colorType = data[9] ?? 6;
      if (data[12] !== 0) throw new Error('Interlaced PNGs are not supported');
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      trns = Buffer.from(data);
    } else if (type === 'IDAT') {
      idatChunks.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + length;
  }

  if (bitDepth !== 8) throw new Error('Only 8-bit PNG depth is supported');

  const channels =
    colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4;
  if (colorType === 3 && !palette) throw new Error('Palette PNG missing PLTE chunk');

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);

  // Undo PNG filtering per scanline
  let srcPos = 0;
  for (let y = 0; y < height; y++) {      const filter = raw[srcPos++] ?? 0;
      const row = raw.subarray(srcPos, srcPos + stride);
    srcPos += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? (out[x - channels] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft = y > 0 && x >= channels ? (pixels[(y - 1) * stride + x - channels] ?? 0) : 0;
      let val = row[x] ?? 0;
      switch (filter) {
        case 0: // None
          break;
        case 1: // Sub
          val = (val + left) & 0xff;
          break;
        case 2: // Up
          val = (val + up) & 0xff;
          break;
        case 3: // Average
          val = (val + ((left + up) >> 1)) & 0xff;
          break;
        case 4: { // Paeth
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          val = (val + pred) & 0xff;
          break;
        }
      }
      out[x] = val;
    }
  }

  // Convert to RGB composited over white
  const rgb = Buffer.alloc(width * height * 3, 0xff);
  for (let i = 0; i < width * height; i++) {
    let r: number, g: number, b: number, a = 255;
    if (colorType === 0) {
      r = g = b = pixels[i] ?? 255;
    } else if (colorType === 2) {
      r = pixels[i * 3] ?? 255;
      g = pixels[i * 3 + 1] ?? 255;
      b = pixels[i * 3 + 2] ?? 255;
    } else if (colorType === 3) {
      const idx = pixels[i] ?? 0;
      r = palette![idx * 3] ?? 255;
      g = palette![idx * 3 + 1] ?? 255;
      b = palette![idx * 3 + 2] ?? 255;
      if (trns && idx < trns.length) a = trns[idx] ?? 255;
    } else if (colorType === 4) {
      r = g = b = pixels[i * 2] ?? 255;
      a = pixels[i * 2 + 1] ?? 255;
    } else {
      r = pixels[i * 4] ?? 255;
      g = pixels[i * 4 + 1] ?? 255;
      b = pixels[i * 4 + 2] ?? 255;
      a = pixels[i * 4 + 3] ?? 255;
    }
    // Composite over white
    rgb[i * 3] = Math.round((r * a + 255 * (255 - a)) / 255);
    rgb[i * 3 + 1] = Math.round((g * a + 255 * (255 - a)) / 255);
    rgb[i * 3 + 2] = Math.round((b * a + 255 * (255 - a)) / 255);
  }

  return { width, height, rgb };
}
