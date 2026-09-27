'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Camera, Check, Crop, ImagePlus, LoaderCircle, RotateCcw, Trash2, X, Zap, ZapOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { Cropper } from '@/components/cropper';
import {
  FULL_FRAME,
  cropShot,
  encodeShot,
  isFullFrame,
  shotFromFile,
  type CapturedShot,
  type CropRect,
} from '@/lib/image';
import { cn } from '@/lib/utils';

/**
 * Scan a problem with the camera, then type it in.
 *
 * There is no OCR here, deliberately. The app's whole claim is that nothing
 * leaves the machine, and the only OCR good enough for mathematical notation
 * is either a paid cloud API or a local model large enough to be its own
 * product. So the camera does the part a phone camera is genuinely good at -
 * getting a crisp, correctly-oriented image of the page in front of you - and
 * the person solving the problem does the part that needs understanding. The
 * photo stays in this tab as a data URL; it is never uploaded, and it is
 * dropped the moment you clear it.
 */

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    // The rear lens, which is the one pointed at the page. A desktop or a
    // virtualised machine may have no device matching this label, so the
    // effect below retries with a bare `video: true` before giving up.
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
};

/**
 * `torch` is in the CSS Conditional spec and shipped in Chromium, but not yet
 * in TypeScript's DOM library, so it is declared here rather than cast away at
 * each use site.
 */
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };
type TorchConstraints = MediaTrackConstraintSet & { torch?: boolean };

type MediaProblem = { title: string; detail: string };

/** `getUserMedia` reports everything through `DOMException.name`. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}

/** Turn a `getUserMedia` rejection into something a person can act on. */
function describeMediaError(error: unknown): MediaProblem {
  switch (errorName(error)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        title: 'Camera permission was declined',
        detail: 'Allow camera access in your browser\u2019s site settings and try again, or pick a photo from your library instead.',
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return {
        title: 'No camera on this device',
        detail: 'The browser could not find a camera to open. Picking a photo works without one.',
      };
    case 'NotReadableError':
      return {
        title: 'The camera is busy',
        detail: 'Another app or tab is already using it. Close that, then press Try again.',
      };
    default:
      return {
        title: 'The camera could not start',
        detail: 'The live preview is unavailable here. Picking a photo works without a camera.',
      };
  }
}

/**
 * Whether a failure is worth retrying with looser constraints.
 *
 * A denied permission or a camera another app is holding will fail the same
 * way however the request is phrased, and asking twice is worse than reporting
 * it once. Only "this machine has no camera that matches what I asked for" gets
 * a second attempt.
 */
function isConstraintFailure(error: unknown): boolean {
  const name = errorName(error);
  return (
    name === 'OverconstrainedError' || name === 'NotFoundError' || name === 'ConstraintNotSatisfiedError'
  );
}

/**
 * The button that opens the scanner, and the scanner itself.
 *
 * `onCapture` receives the still, or `null` when the user clears it. The caller
 * owns the photo so it can show it next to the input it belongs to.
 */
export function CameraScan({
  onCapture,
  shot,
  closeFocusRef,
}: {
  onCapture: (shot: CapturedShot | null) => void;
  /** Currently held photo, so the trigger can offer to replace it. */
  shot: CapturedShot | null;
  /**
   * Where focus should land when the scanner closes.
   *
   * Radix restores focus to the trigger on close, which would leave the camera
   * button highlighted after every scan. The thing to type into is the point of
   * closing the scanner, so the caller names that element and this hands focus
   * to it. Radix gives the event a `preventDefault` precisely for this.
   */
  closeFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          title={shot ? 'Replace the scanned photo' : 'Scan a problem with the camera'}
          className={cn(
            'absolute right-[3.75rem] top-1/2 -translate-y-1/2 rounded-lg p-2 transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            shot ? 'text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
          )}
          aria-label={shot ? 'Replace the scanned photo' : 'Scan a problem with the camera'}
        >
          <Camera className="size-4" aria-hidden />
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-40 bg-foreground/50 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-lg animate-fade-up',
            'max-h-[92dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-4 shadow-lg',
            'sm:inset-0 sm:my-auto sm:h-fit sm:rounded-2xl',
          )}
          onCloseAutoFocus={(event) => {
            const target = closeFocusRef?.current;
            if (target === null || target === undefined) {
              return;
            }
            event.preventDefault();
            target.focus();
          }}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-base font-semibold">Scan a problem</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-sm text-muted-foreground">
                Fill the frame with the problem, keep it flat and in focus. You will type what it says.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className={cn(
                  'touch-target -mr-1 -mt-1 flex shrink-0 items-center justify-center rounded-lg p-2',
                  'text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
                aria-label="Close the scanner"
              >
                <X className="size-4" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <ScannerBody
            onDone={(next) => {
              onCapture(next);
              setOpen(false);
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The live preview, then the crop step, then the controls.
 *
 * Mounted only while the dialog is open, so the `getUserMedia` effect below
 * starts on open and its teardown releases the camera on close. That ordering
 * is the whole reason this is a separate component rather than a fragment of
 * `CameraScan`: a camera left streaming is a camera light left on.
 */
function ScannerBody({ onDone }: { onDone: (shot: CapturedShot) => void }) {
  /**
   * Held as state rather than a ref so the stream starts once the `<video>` is
   * actually in the document. A ref is null during the first effect pass, and
   * assigning `srcObject` to null is how you end up with a blank preview that
   * never recovers.
   */
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<'starting' | 'live' | 'blocked'>('starting');
  const [problem, setProblem] = useState<MediaProblem | null>(null);
  /** Whether re-requesting the camera could plausibly succeed. */
  const [canRetry, setCanRetry] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  /** The full frame, awaiting a crop decision. */
  const [pending, setPending] = useState<CapturedShot | null>(null);
  const [crop, setCrop] = useState<CropRect>(FULL_FRAME);
  /** True while the crop is being applied, so the button cannot be re-pressed. */
  const [committing, setCommitting] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** Bumped to restart a stream that already failed. */
  const [attempt, setAttempt] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (video === null) {
      return;
    }
    const media = navigator.mediaDevices;
    if (media === null || typeof media.getUserMedia !== 'function') {
      setStatus('blocked');
      setProblem({
        title: 'No camera access in this browser',
        detail: 'This page is not a secure context, or the browser has no camera API. Picking a photo works either way.',
      });
      return;
    }

    let cancelled = false;
    setStatus('starting');
    setProblem(null);
    setCanRetry(false);
    // Reset per attempt: a stream that never opened has no torch, and leaving
    // the previous stream's switch state behind would light the button for a
    // camera that was never granted.
    setTorchOn(false);
    setTorchAvailable(false);
    // Captured as a local so the closures below keep the non-null narrowing;
    // `video` is a state value and cannot be relied on across an await.
    const element = video;

    async function open(constraints: MediaStreamConstraints): Promise<void> {
      const stream = await media.getUserMedia(constraints);
      if (cancelled) {
        // The dialog closed while the permission prompt was up. The tracks are
        // live by now and nobody is holding them, so stop them here.
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      // iOS refuses to autoplay a video it does not believe is muted, and
      // React does not always write the attribute. Setting the property as well
      // is the difference between a live preview and a black rectangle.
      element.muted = true;
      element.srcObject = stream;
      try {
        await element.play();
      } catch {
        // Autoplay can be refused even when muted; the preview is static but
        // capture still works, so this is not worth an error.
      }

      const track = stream.getVideoTracks()[0];
      const capabilities = track?.getCapabilities?.() as TorchCapabilities | undefined;
      setTorchAvailable(capabilities?.torch === true);
      setStatus('live');
    }

    open(CAMERA_CONSTRAINTS).catch((firstError: unknown) => {
      if (cancelled) {
        return;
      }
      if (!isConstraintFailure(firstError)) {
        setProblem(describeMediaError(firstError));
        setStatus('blocked');
        // Busy cameras clear up on their own, so a second attempt is useful
        // even though a looser request would not have helped.
        setCanRetry(errorName(firstError) === 'NotReadableError');
        return;
      }
      // A machine with an unnamed or front-only camera rejects the `facingMode`
      // preference. One retry with no preference covers it; anything beyond
      // that is a real failure and the file picker is the way forward.
      open({ audio: false, video: true }).catch((secondError: unknown) => {
        if (cancelled) {
          return;
        }
        setProblem(describeMediaError(firstError));
        setStatus('blocked');
        setCanRetry(errorName(secondError) === 'NotReadableError');
      });
    });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      video.srcObject = null;
    };
  }, [video, attempt]);

  /** Any new still starts from the whole frame; the crop is never inherited. */
  function acceptFullFrame(next: CapturedShot) {
    setPending(next);
    setCrop(FULL_FRAME);
    setUploadError(null);
  }

  const capture = useCallback(() => {
    if (video === null || video.videoWidth === 0) {
      return;
    }
    try {
      // `videoWidth`/`videoHeight` are the frame's true size, which is usually
      // larger than the element's layout size. Using the layout size would
      // capture only what fits on screen.
      const frame = encodeShot(video, video.videoWidth, video.videoHeight);
      // The same rule as `acceptFullFrame`, spelled out rather than called so
      // that this callback depends on nothing but `video`.
      setPending(frame);
      setCrop(FULL_FRAME);
      setUploadError(null);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'The frame could not be captured.');
    }
  }, [video]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (track === undefined) {
      return;
    }
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as TorchConstraints] });
      setTorchOn(next);
    } catch {
      // Advertised but not honoured, which happens on some laptops.
      setTorchAvailable(false);
    }
  }

  async function pickFile(file: File) {
    setUploadError(null);
    try {
      acceptFullFrame(await shotFromFile(file));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'That photo could not be read.');
    }
  }

  /** Apply the crop and hand the result back to the caller. */
  async function commit() {
    if (pending === null || committing) {
      return;
    }
    setCommitting(true);
    setUploadError(null);
    try {
      onDone(await cropShot(pending, crop));
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : 'The photo could not be cropped. Try the full frame.',
      );
      setCommitting(false);
    }
  }

  function retake() {
    setPending(null);
    setCrop(FULL_FRAME);
    setUploadError(null);
  }

  return (
    <div className="flex flex-col gap-3">
      {pending !== null ? (
        <Cropper shot={pending} crop={crop} onChange={setCrop} />
      ) : (
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-foreground/90">
          {/*
            The video stays mounted for the whole life of the dialog, including
            behind the crop step, so the stream is never torn down and re-opened
            on a retake.
          */}
          <video
            ref={setVideo}
            autoPlay
            playsInline
            muted
            className="size-full object-cover"
            aria-label="Live camera preview"
          />

          {status === 'starting' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-sm text-background/80">
              <LoaderCircle className="size-6 animate-spin" aria-hidden />
              <p>Starting the camera…</p>
            </div>
          ) : null}

          {status === 'blocked' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-6 text-center">
              <Camera className="size-6 text-background/70" aria-hidden />
              <p className="text-sm font-medium text-background">{problem?.title}</p>
              <p className="max-w-xs text-xs leading-relaxed text-background/70">{problem?.detail}</p>
            </div>
          ) : null}
        </div>
      )}

      {/*
        `aria-live` rather than a role: these are status messages that replace
        each other, and announcing them the moment they appear is the point.
      */}
      <p aria-live="polite" className="min-h-[1.25rem] text-xs text-muted-foreground">
        {uploadError ?? (pending === null ? (problem?.detail ?? '') : '')}
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="Choose a photo of the problem"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset first, so choosing the same file twice still fires a change.
          event.target.value = '';
          if (file !== undefined) {
            void pickFile(file);
          }
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        {pending === null ? (
          <>
            <button
              type="button"
              onClick={capture}
              disabled={status !== 'live'}
              className={cn(
                'inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary px-4 py-3',
                'text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                'disabled:pointer-events-none disabled:opacity-40',
              )}
            >
              <Camera className="size-4" aria-hidden />
              Take the photo
            </button>

            {torchAvailable ? (
              <button
                type="button"
                onClick={() => void toggleTorch()}
                aria-pressed={torchOn}
                className={cn(
                  'touch-target inline-flex items-center justify-center rounded-xl border border-border px-3',
                  'text-sm font-medium transition-colors hover:bg-secondary',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
                title={torchOn ? 'Turn the light off' : 'Turn the light on'}
              >
                {torchOn ? <ZapOff className="size-4" aria-hidden /> : <Zap className="size-4" aria-hidden />}
                <span className="sr-only">{torchOn ? 'Turn the light off' : 'Turn the light on'}</span>
              </button>
            ) : null}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void commit()}
              disabled={committing}
              className={cn(
                // `flex-1` shrinks this below its text width once the row has
                // three buttons in it, so the label is pinned to one line and
                // the siblings wrap instead.
                'inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary px-4 py-3',
                'text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                'disabled:pointer-events-none disabled:opacity-40',
              )}
            >
              {committing ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : (
                <Check className="size-4" aria-hidden />
              )}
              {isFullFrame(crop) ? 'Use the whole photo' : 'Use this crop'}
            </button>
            <button
              type="button"
              onClick={retake}
              disabled={committing}
              className={cn(
                'touch-target inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3',
                'text-sm font-medium transition-colors hover:bg-secondary',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:pointer-events-none disabled:opacity-40',
              )}
            >
              <RotateCcw className="size-4" aria-hidden />
              Retake
            </button>
            {!isFullFrame(crop) ? (
              <button
                type="button"
                onClick={() => setCrop(FULL_FRAME)}
                className={cn(
                  'touch-target inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3',
                  'text-sm font-medium transition-colors hover:bg-secondary',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <Crop className="size-4" aria-hidden />
                Full frame
              </button>
            ) : null}
          </>
        )}

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className={cn(
            'touch-target inline-flex items-center justify-center gap-2 rounded-xl border border-border px-3',
            'text-sm font-medium transition-colors hover:bg-secondary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <ImagePlus className="size-4" aria-hidden />
          {pending === null ? 'Upload' : 'Choose another'}
        </button>

        {status === 'blocked' && pending === null && canRetry ? (
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className={cn(
              'touch-target inline-flex items-center justify-center rounded-xl border border-border px-3',
              'text-sm font-medium transition-colors hover:bg-secondary',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The photo, pinned next to the input it describes.
 *
 * It is a reference for the person typing, not an input to the engine, so it
 * carries no solving state of its own. The caption is explicit about that,
 * because a thumbnail sitting above a text field invites the assumption that
 * something is reading it.
 */
export function CapturedPhoto({
  shot,
  onClear,
}: {
  shot: CapturedShot;
  onClear: () => void;
}) {
  return (
    <div className="surface flex items-start gap-3 p-3 shadow-sm">
      <PhotoViewer shot={shot} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">Photo captured</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          Nothing is read from this image. Type the problem underneath, using the photo to check you got
          it right.
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        className={cn(
          'touch-target -mr-1 -mt-1 flex shrink-0 items-center justify-center rounded-lg p-2',
          'text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
        aria-label="Discard the photo"
        title="Discard the photo"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/**
 * The thumbnail, which opens the photo at a size worth reading.
 *
 * A 80px thumbnail is enough to recognise a page but not to check a character,
 * and the whole point of the photo is to check characters. Radix restores focus
 * to this button on close, which is already where the eye is.
 */
function PhotoViewer({ shot }: { shot: CapturedShot }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={cn(
            'shrink-0 overflow-hidden rounded-lg border border-border',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
          )}
          aria-label="Enlarge the photo to read it"
          title="Enlarge"
        >
          <img src={shot.url} alt="" className="size-20 object-cover" />
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-40 bg-foreground/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 p-4">
          <Dialog.Title className="sr-only">The problem you scanned</Dialog.Title>
          <Dialog.Description className="sr-only">
            An enlarged view of the photo taken with your camera. Close it to go back to the solver.
          </Dialog.Description>
          <Dialog.Close asChild>
            <button
              type="button"
              className={cn(
                'absolute right-4 top-4 flex items-center justify-center rounded-full bg-card/90 p-2.5 shadow-md',
                'text-foreground transition-colors hover:bg-card',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
              aria-label="Close the enlarged photo"
            >
              <X className="size-5" aria-hidden />
            </button>
          </Dialog.Close>
          <img
            src={shot.url}
            alt="The problem you scanned, enlarged"
            className="max-h-[85dvh] max-w-full rounded-xl bg-card object-contain shadow-lg"
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
