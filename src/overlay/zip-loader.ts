import { unzipSync } from 'fflate';
import type { OverlayFrame, OverlaySequence } from '../types/project';

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

function getSequenceNumber(filename: string): number | null {
  const match = filename.match(/(\d+)(?=\.png$)/i);
  return match ? Number(match[1]) : null;
}

function compareFrames(a: OverlayFrame, b: OverlayFrame): number {
  if (a.sequenceNumber !== null && b.sequenceNumber !== null && a.sequenceNumber !== b.sequenceNumber) {
    return a.sequenceNumber - b.sequenceNumber;
  }
  return a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' });
}

function readPngDimensions(data: Uint8Array, filename: string): { width: number; height: number } {
  if (data.length < 24 || !pngSignature.every((byte, index) => data[index] === byte)) {
    throw new Error(`${filename} is not a valid PNG file.`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) throw new Error(`${filename} has invalid dimensions.`);
  const colorType = data[25];
  if (colorType !== 4 && colorType !== 6) {
    throw new Error(`${filename} has no alpha channel. Export the Blender sequence as RGBA PNGs with transparency.`);
  }
  return { width, height };
}

export async function loadPngSequence(file: File): Promise<OverlaySequence> {
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error('The ZIP could not be opened. Check that it is a valid, unencrypted archive.');
  }

  const frames: OverlayFrame[] = Object.entries(archive)
    .filter(([name, data]) => !name.endsWith('/') && name.toLowerCase().endsWith('.png') && data.length > 0)
    .map(([filename, data]) => {
      const normalizedFilename = filename.replaceAll('\\', '/').split('/').pop() ?? filename;
      const dimensions = readPngDimensions(data, normalizedFilename);
      const bytes = data.slice();
      return {
        index: 0,
        filename: normalizedFilename,
        blob: new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' }),
        ...dimensions,
        sequenceNumber: getSequenceNumber(normalizedFilename),
      };
    })
    .sort(compareFrames);

  if (frames.length === 0) throw new Error('The ZIP does not contain any PNG frames.');
  const { width, height } = frames[0];
  const mismatched = frames.find((frame) => frame.width !== width || frame.height !== height);
  if (mismatched) {
    throw new Error(`All overlay PNGs must have the same dimensions. ${mismatched.filename} is ${mismatched.width}×${mismatched.height}, expected ${width}×${height}.`);
  }
  frames.forEach((frame, index) => { frame.index = index; });

  return { fileName: file.name, frames, width, height };
}
