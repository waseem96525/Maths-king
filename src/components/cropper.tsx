'use client';

import { useRef } from 'react';

import {
  CROP_HANDLES,
  isFullFrame,
  moveCrop,
  pointToNormalized,
  rectFromPoints,
  resizeCrop,
  type CropHandle,
  type CropRect,
} from '@/lib/image';
import type { CapturedShot } from '@/lib/image';
import { cn } from '@/lib/utils';

/**
 * Choose which part of a photo to keep.
 *
 * A phone photo of a worksheet is mostly desk, and an 80px thumbnail of mostly
 * desk is no use as a reference for typing. Cropping to the problem first is
 * what makes the pinned photo readable.
 *
 * The box is sized to the image's own aspect ratio so the image fills it
 * exactly, with no letterboxing. That is what keeps the pointer arithmetic
 * honest: a scale factor from the element to the pixels, rather than a scale
 * plus an offset that has to be derived from wherever the browser decided to
 * centre the image.
 */

/** How far a corner moves per arrow key, and with shift held. */
const NUDGE = 0.01;
const NUDGE_LARGE = 0.1;

const HANDLE_STYLE: Record<CropHandle, { position: string; cursor: string }> = {
  nw: { position: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'cursor-nwse-resize' },
  ne: { position: 'right-0 top-0 translate-x-1/2 -translate-y-1/2', cursor: 'cursor-nesw-resize' },
  sw: { position: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2', cursor: 'cursor-nesw-resize' },
  se: { position: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2', cursor: 'cursor-nwse-resize' },
};

const HANDLE_LABEL: Record<CropHandle, string> = {
  nw: 'top left',
  ne: 'top right',
  sw: 'bottom left',
  se: 'bottom right',
};

type Drag =
  | { mode: 'new'; startX: number; startY: number }
  | { mode: 'move' | 'resize'; handle?: CropHandle; startX: number; startY: number; origin: CropRect };

/**
 * A drag as it is requested, before the starting point is known.
 *
 * Declared separately rather than derived with `Omit<Drag, ...>`, because
 * `Omit` over a union collapses it to the keys the members share and silently
 * drops `origin` and `handle` from the type.
 */
type DragStart =
  | { mode: 'new' }
  | { mode: 'move'; origin: CropRect }
  | { mode: 'resize'; handle: CropHandle; origin: CropRect };

export function Cropper({
  shot,
  crop,
  onChange,
}: {
  shot: CapturedShot;
  crop: CropRect;
  onChange: (crop: CropRect) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  /**
   * Drag progress lives in a ref, not in state. A pointer move fires far more
   * often than React needs to render, and routing every one of them through
   * state makes a drag on a phone feel like it is lagging behind the finger.
   * Only the resulting rectangle reaches state, once per move.
   */
  const dragRef = useRef<Drag | null>(null);

  /** Pointer position as a fraction of the image, or null if it is gone. */
  function locate(clientX: number, clientY: number) {
    const box = boxRef.current?.getBoundingClientRect();
    return box === null || box === undefined ? null : pointToNormalized(clientX, clientY, box);
  }

  /**
   * Capture the pointer on the container, not on the element that received the
   * press. The press usually lands on a handle or the selection, but the moves
   * that matter arrive after the finger has left those, and without capture the
   * drag would stop the moment it did.
   */
  function begin(event: React.PointerEvent, drag: DragStart) {
    const point = locate(event.clientX, event.clientY);
    if (point === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    boxRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = { ...drag, startX: point.x, startY: point.y } as Drag;
  }

  function onPointerMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (drag === null) {
      return;
    }
    const point = locate(event.clientX, event.clientY);
    if (point === null) {
      return;
    }
    if (drag.mode === 'new') {
      onChange(rectFromPoints(drag.startX, drag.startY, point.x, point.y));
      return;
    }
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    if (drag.mode === 'move') {
      onChange(moveCrop(drag.origin, dx, dy));
    } else if (drag.handle !== undefined) {
      onChange(resizeCrop(drag.origin, drag.handle, dx, dy));
    }
  }

  function end(event: React.PointerEvent) {
    if (dragRef.current === null) {
      return;
    }
    dragRef.current = null;
    if (boxRef.current?.hasPointerCapture(event.pointerId)) {
      boxRef.current.releasePointerCapture(event.pointerId);
    }
  }

  /** Arrow keys move the corner, so the crop is possible without a pointer. */
  function onHandleKeyDown(event: React.KeyboardEvent, handle: CropHandle) {
    const step = event.shiftKey ? NUDGE_LARGE : NUDGE;
    let dx = 0;
    let dy = 0;
    if (event.key === 'ArrowLeft') dx = -step;
    else if (event.key === 'ArrowRight') dx = step;
    else if (event.key === 'ArrowUp') dy = -step;
    else if (event.key === 'ArrowDown') dy = step;
    else return;
    event.preventDefault();
    onChange(resizeCrop(crop, handle, dx, dy));
  }

  const percent = { w: Math.round(crop.w * 100), h: Math.round(crop.h * 100) };

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={boxRef}
        onPointerDown={(event) => begin(event, { mode: 'new' })}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        style={{ aspectRatio: `${shot.width} / ${shot.height}`, maxHeight: '58dvh' }}
        className="relative w-full cursor-crosshair touch-none select-none overflow-hidden rounded-xl bg-foreground"
        role="group"
        aria-label={`Crop the problem. The selection covers ${percent.w} percent of the width and ${percent.h} percent of the height.`}
      >
        {/*
          The image fills the box exactly, because the box was given this
          image's aspect ratio. `draggable` is off so a drag on a touch screen
          does not also start the browser's own image drag.
        */}
        <img
          src={shot.url}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 size-full"
        />

        <div
          onPointerDown={(event) =>
            // While the selection is still the whole frame it covers the entire
            // box, so there is no "outside" to start a new rectangle in and
            // nothing to move either. A drag anywhere therefore means "let me
            // pick a region", which is the only way to begin cropping.
            begin(event, isFullFrame(crop) ? { mode: 'new' } : { mode: 'move', origin: crop })
          }
          style={{
            left: `${crop.x * 100}%`,
            top: `${crop.y * 100}%`,
            width: `${crop.w * 100}%`,
            height: `${crop.h * 100}%`,
            // One shadow, sized far past the container, dims everything the
            // selection does not cover. Four separate dim panels would need
            // four more elements to keep in sync.
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)',
          }}
          className="absolute"
        >
          {/* Drawn inside rather than as a border on the selection, so the
              selection's own box stays exactly the crop and the pointer maths
              cannot drift from the visible edge. */}
          <div className="pointer-events-none absolute inset-0 border-2 border-white/90" />

          {CROP_HANDLES.map((handle) => (
            <button
              key={handle}
              type="button"
              onPointerDown={(event) => begin(event, { mode: 'resize', handle, origin: crop })}
              onKeyDown={(event) => onHandleKeyDown(event, handle)}
              aria-label={`Resize from the ${HANDLE_LABEL[handle]} corner`}
              className={cn(
                'absolute size-7 rounded-full border-2 border-primary bg-background shadow-md',
                // The visible dot is small so it does not swallow a small
                // selection, but the target is grown past it to something a
                // thumb can actually hit.
                'before:absolute before:-inset-2 before:content-[\'\']',
                HANDLE_STYLE[handle].position,
                HANDLE_STYLE[handle].cursor,
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-foreground',
              )}
            />
          ))}
        </div>
      </div>

      {/*
        The rectangle is invisible to a screen reader, so its size is stated in
        text. Announced on every change, which is the point: the drag has no
        other non-visual feedback.
      */}
      <p aria-live="polite" className="text-xs text-muted-foreground">
        Keeping {percent.w}% of the width and {percent.h}% of the height. Drag to move the box, drag a
        corner to resize, or use the arrow keys on a corner.
      </p>
    </div>
  );
}
