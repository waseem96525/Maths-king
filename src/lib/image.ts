/**
 * Image handling for the camera feature.
 *
 * The crop geometry at the top of this file is deliberately pure and free of
 * any DOM reference, because it is the part that can actually be wrong: it is
 * the arithmetic between a finger on a screen and a rectangle of pixels, and
 * off-by-one errors there produce a silently mangled photo rather than an
 * exception. Those functions are total, they clamp rather than trust, and they
 * are covered by `npm run selftest`.
 *
 * The functions further down need a canvas and only ever run in the browser.
 * Nothing here is executed at import time, so the self-test can import this
 * module in Node and exercise the geometry without a DOM.
 *
 * A photo never leaves the tab. Everything below produces a local `data:` URL.
 */

/** A still captured in this tab. */
export type CapturedShot = {
  /** A local `data:` URL. Never sent anywhere. */
  url: string;
  width: number;
  height: number;
};

/* ==========================================================================
   Crop geometry - pure
   ========================================================================== */

/**
 * A rectangle in normalised image coordinates.
 *
 * Normalised rather than pixels because the same selection has to survive
 * being re-encoded at a different size, and because a stored crop applied to a
 * differently-sized frame would be wrong in a way that is very hard to see.
 * The origin is the top-left and each field is a fraction of the full image.
 */
export type CropRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/** The whole image: what you get before anyone touches anything. */
export const FULL_FRAME: CropRect = { x: 0, y: 0, w: 1, h: 1 };

/**
 * The smallest selection worth keeping, as a fraction of the image.
 *
 * A tap with no drag produces a zero-sized rectangle. Allowing that through
 * would encode a 0x0 image, which is not a useful failure mode, so every path
 * that can produce a degenerate rectangle floors it here instead.
 */
export const MIN_CROP = 0.04;

/** The subset of `DOMRect` the pointer maths needs, so it can be faked in tests. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A crop converted to integer pixel bounds. */
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Clamp to a range, treating anything non-finite as the lower bound.
 *
 * `Math.min` propagates `NaN`, and a single `NaN` reaching `drawImage` produces
 * a silently empty image rather than a thrown error. Every entry point into the
 * geometry comes from pointer maths, so defending here is cheaper than
 * discovering it later.
 */
function clamp(value: number, lo: number, hi: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, lo), hi) : lo;
}

/**
 * Force a drawn rectangle to be usable: non-degenerate and inside the frame.
 *
 * When the far edge hangs over, the rectangle is shortened from there rather
 * than having its size capped and its origin moved. Capping the size first
 * loses where the drag started, so a drag from the middle of a photo out past
 * the right edge would select the entire frame instead of the right half.
 *
 * This is for rectangles being *drawn*. Moving an existing selection has to
 * behave differently — see `moveCrop`, which keeps the size and clamps the
 * position instead.
 */
export function clampCrop(rect: CropRect): CropRect {
  const w = clamp(rect.w, MIN_CROP, 1);
  const h = clamp(rect.h, MIN_CROP, 1);
  // The origin stops one minimum-width short of the edge, which is what
  // guarantees a non-degenerate rectangle is still available below.
  const x = clamp(rect.x, 0, 1 - MIN_CROP);
  const y = clamp(rect.y, 0, 1 - MIN_CROP);
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}

/** True when nothing has actually been cropped away. */
export function isFullFrame(rect: CropRect): boolean {
  return rect.x <= 0 && rect.y <= 0 && rect.w >= 1 && rect.h >= 1;
}

/** The rectangle spanned by two points, in any drag direction. */
export function rectFromPoints(ax: number, ay: number, bx: number, by: number): CropRect {
  // The two ends are clamped into the frame *before* the rectangle is formed.
  // Building an oversized rectangle and clamping it afterwards cannot work: by
  // then the origin has already been dragged off the edge, and there is no
  // longer any way to tell which end the user started from. Clamping first is
  // what makes a drag from the middle out past the left edge select the left
  // half rather than snapping to the whole frame.
  const x0 = clamp(ax, 0, 1);
  const y0 = clamp(ay, 0, 1);
  const x1 = clamp(bx, 0, 1);
  const y1 = clamp(by, 0, 1);
  return clampCrop({
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  });
}

/**
 * Slide a selection without resizing it.
 *
 * Deliberately not routed through `clampCrop`: a selection that is dragged
 * against the edge should stop, not shrink. Preserving the size is the entire
 * point of moving rather than resizing.
 */
export function moveCrop(rect: CropRect, dx: number, dy: number): CropRect {
  const w = clamp(rect.w, MIN_CROP, 1);
  const h = clamp(rect.h, MIN_CROP, 1);
  return {
    w,
    h,
    x: clamp(rect.x + dx, 0, 1 - w),
    y: clamp(rect.y + dy, 0, 1 - h),
  };
}

/** The corner being dragged. */
export type CropHandle = 'nw' | 'ne' | 'sw' | 'se';

/** Every corner handle, in the order the UI should draw them. */
export const CROP_HANDLES: readonly CropHandle[] = ['nw', 'ne', 'sw', 'se'];

/**
 * Drag one corner, holding the opposite corner still.
 *
 * Anchoring the far corner is what makes the crop feel right: without it, the
 * selection would slide as you resize instead of growing from a fixed point.
 */
export function resizeCrop(rect: CropRect, handle: CropHandle, dx: number, dy: number): CropRect {
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  const west = handle === 'nw' || handle === 'sw';
  const north = handle === 'nw' || handle === 'ne';
  // The corner opposite the handle stays put.
  const anchorX = west ? right : rect.x;
  const anchorY = north ? bottom : rect.y;
  const movedX = west ? rect.x + dx : right + dx;
  const movedY = north ? rect.y + dy : bottom + dy;
  return rectFromPoints(movedX, movedY, anchorX, anchorY);
}

/** Where a pointer landed, as a fraction of the containing box. */
export function pointToNormalized(
  clientX: number,
  clientY: number,
  box: Box,
): { x: number; y: number } {
  return {
    // A zero-sized box would divide by zero; the guard keeps this total.
    x: box.width > 0 ? (clientX - box.left) / box.width : 0,
    y: box.height > 0 ? (clientY - box.top) / box.height : 0,
  };
}

/**
 * Convert to integer pixel bounds for `drawImage`.
 *
 * Rounding is unavoidable, so the far edge is re-clamped after rounding. A
 * rectangle that rounds outward would ask the source for pixels it does not
 * have, which `drawImage` treats as an error rather than clamping for us.
 */
export function cropToPixels(rect: CropRect, width: number, height: number): PixelRect {
  const x = clamp(Math.round(rect.x * width), 0, width - 1);
  const y = clamp(Math.round(rect.y * height), 0, height - 1);
  return {
    x,
    y,
    w: clamp(Math.round(rect.w * width), 1, width - x),
    h: clamp(Math.round(rect.h * height), 1, height - y),
  };
}

/* ==========================================================================
   Canvas encoding - browser only
   ========================================================================== */

/** Longest edge kept when re-encoding, in pixels. */
export const MAX_EDGE = 1400;
const JPEG_QUALITY = 0.82;
/** Refuse absurd uploads before decoding them into memory. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Re-encode part of a source image as a right-sized JPEG data URL.
 *
 * Phone cameras produce 12MP frames and a base64 data URL costs a third more
 * than the bytes it encodes, so everything is downscaled on the way in. The
 * scale is applied to the *cropped* region, so cropping to a small part of a
 * large photo recovers real detail instead of just a smaller picture.
 */
export function encodeShot(
  source: CanvasImageSource,
  width: number,
  height: number,
  crop: CropRect = FULL_FRAME,
): CapturedShot {
  const box = cropToPixels(crop, width, height);
  const scale = Math.min(1, MAX_EDGE / Math.max(box.w, box.h));
  const w = Math.max(1, Math.round(box.w * scale));
  const h = Math.max(1, Math.round(box.h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('This browser could not provide a 2D canvas to encode the photo.');
  }
  // Video frames have no alpha channel, but a JPEG that encodes transparent
  // pixels comes out black in some viewers, so the canvas is filled first.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, w, h);

  return { url: canvas.toDataURL('image/jpeg', JPEG_QUALITY), width: w, height: h };
}

/** A decoded image plus the means to let it go. */
type Decoded = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

/**
 * Decode a blob or a data URL, with EXIF rotation already applied.
 *
 * Phone cameras record orientation in metadata rather than rotating pixels, so
 * a portrait photo is stored sideways. `imageOrientation: 'from-image'` is the
 * one option that fixes it. `createImageBitmap` is not everywhere, and an
 * `<img>` applies the same transform when it decodes, so there is a second path
 * for older engines and for a data URL, which it will not accept at all.
 */
async function decodeImage(input: Blob | string): Promise<Decoded> {
  const isBlob = typeof input !== 'string';
  if (isBlob && typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(input, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Fall through to the <img> decoder rather than failing outright.
    }
  }

  const url = isBlob ? URL.createObjectURL(input) : input;
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: isBlob ? () => URL.revokeObjectURL(url) : () => {},
    };
  } catch (error) {
    if (isBlob) {
      URL.revokeObjectURL(url);
    }
    throw error;
  }
}

/** Turn a picked file into a bounded still, or explain why it cannot be. */
export async function shotFromFile(file: File): Promise<CapturedShot> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That file is not an image. Pick a photo of the problem.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('That photo is too large. One under 25 MB will do.');
  }
  const decoded = await decodeImage(file);
  try {
    return encodeShot(decoded.source, decoded.width, decoded.height);
  } finally {
    decoded.release();
  }
}

/**
 * Apply a crop to a still that has already been encoded.
 *
 * The crop happens here rather than against the original frame because by the
 * time the user has finished dragging, the video frame is gone. Re-decoding
 * the bounded still loses nothing: the pixels the crop selects are pixels that
 * had already been kept, and the full frame is discarded either way.
 *
 * A full-frame crop returns the original untouched, so the common case of
 * "looked at it, did not change it" costs nothing.
 */
export async function cropShot(shot: CapturedShot, crop: CropRect): Promise<CapturedShot> {
  if (isFullFrame(crop)) {
    return shot;
  }
  const decoded = await decodeImage(shot.url);
  try {
    return encodeShot(decoded.source, decoded.width, decoded.height, crop);
  } finally {
    decoded.release();
  }
}
