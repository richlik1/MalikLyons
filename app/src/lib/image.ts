// File validation by content (magic bytes), not by the client-supplied MIME type or extension.

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MIN_PERSON_DIMENSION = 512;
export const MAX_DIMENSION = 6000;

export type SupportedMime = "image/jpeg" | "image/png" | "image/webp";

export interface ImageInfo {
  mimeType: SupportedMime;
  width: number;
  height: number;
}

export type ImageValidation = { ok: true; info: ImageInfo } | { ok: false; error: string };

export function sniffMime(b: Uint8Array): SupportedMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  return null;
}

export function readDimensions(b: Uint8Array, mime: SupportedMime): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (mime === "image/png") {
      if (ascii(b, 12, 4) !== "IHDR") return null;
      return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }
    if (mime === "image/jpeg") {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        const len = dv.getUint16(i + 2);
        // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
        }
        i += 2 + len;
      }
      return null;
    }
    // WebP
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8X") {
      const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
      const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
      return { width: w, height: h };
    }
    if (chunk === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = dv.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  } catch {
    return null;
  }
}

export function validateImage(bytes: Uint8Array, opts: { minDimension?: number } = {}): ImageValidation {
  if (bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: "Images must be 8 MB or smaller." };
  const mimeType = sniffMime(bytes);
  if (!mimeType) return { ok: false, error: "Only JPEG, PNG or WebP images are supported." };
  const dims = readDimensions(bytes, mimeType);
  if (!dims) return { ok: false, error: "We couldn't read this image. Try exporting it as a JPEG." };
  const min = opts.minDimension ?? 0;
  if (Math.min(dims.width, dims.height) < min) {
    return { ok: false, error: `Image is too small. The shortest side must be at least ${min}px.` };
  }
  if (Math.max(dims.width, dims.height) > MAX_DIMENSION) {
    return { ok: false, error: `Image is too large. The longest side must be at most ${MAX_DIMENSION}px.` };
  }
  return { ok: true, info: { mimeType, ...dims } };
}

function ascii(b: Uint8Array, start: number, len: number): string {
  return String.fromCharCode(...b.subarray(start, start + len));
}
