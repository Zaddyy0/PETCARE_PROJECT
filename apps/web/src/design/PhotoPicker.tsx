import { useEffect, useId, useRef, useState } from 'react';
import { LIMITS } from '@pawsitive/shared';
import { cn } from '@/lib/cn';

/**
 * An image picker with a local preview.
 *
 * Two things this does that a bare `<input type="file">` does not:
 *
 *   • **Shows the chosen image before upload.** The preview is a
 *     `createObjectURL` blob, which is instant and costs no network — but it
 *     holds a reference until revoked, so the effect below cleans it up. Without
 *     that, every pick leaks a blob for the lifetime of the page.
 *
 *   • **Validates client-side.** The server checks type and size (and the
 *     actual magic bytes), but catching a 12MB photo here saves the user a slow
 *     upload that was always going to be rejected.
 */
export function PhotoPicker({
  currentUrl,
  onSelect,
  label,
  className,
}: {
  currentUrl?: string | undefined;
  onSelect: (file: File | null) => void;
  label: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  /* Revoke the blob URL when it changes or the component unmounts. */
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  function handleFile(file: File | undefined) {
    setError(null);

    if (!file) {
      setPreview(null);
      onSelect(null);
      return;
    }

    if (!(LIMITS.ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setError('Please choose a JPEG, PNG, WebP or AVIF image.');
      return;
    }

    if (file.size > LIMITS.MAX_UPLOAD_BYTES) {
      const limitMb = Math.round(LIMITS.MAX_UPLOAD_BYTES / 1024 / 1024);
      setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is ${limitMb}MB.`);
      return;
    }

    setPreview(URL.createObjectURL(file));
    onSelect(file);
  }

  const shown = preview ?? currentUrl;

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      {/* A label wrapping the hidden input, so the whole tile is the control
          and keyboard focus lands on something real. */}
      <label
        htmlFor={fieldId}
        className={cn(
          'group relative grid size-28 cursor-pointer place-items-center overflow-hidden rounded-xl border-2 border-dashed transition-colors',
          error ? 'border-danger' : 'border-border hover:border-primary',
          shown ? 'border-solid' : 'bg-surface-sunken',
        )}
      >
        {shown ? (
          <>
            <img src={shown} alt="" className="size-full object-cover" />
            {/* Hover affordance — without it a filled tile looks static. */}
            <span className="absolute inset-0 grid place-items-center bg-sand-950/55 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
              Change
            </span>
          </>
        ) : (
          <span className="flex flex-col items-center gap-1 text-content-subtle">
            <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 16.5V6a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18v-1.5Zm0 0 4.5-4.5 3 3 3.5-3.5L20 15M9 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-[0.6875rem] font-medium">Add photo</span>
          </span>
        )}

        <input
          ref={inputRef}
          id={fieldId}
          type="file"
          accept={LIMITS.ALLOWED_IMAGE_TYPES.join(',')}
          aria-label={label}
          onChange={(event) => handleFile(event.target.files?.[0])}
          className="sr-only"
        />
      </label>

      {preview && (
        <button
          type="button"
          onClick={() => {
            handleFile(undefined);
            /* Resetting the input's value matters: without it, picking the
               same file again fires no `change` event. */
            if (inputRef.current) inputRef.current.value = '';
          }}
          className="text-xs font-medium text-content-muted hover:text-danger"
        >
          Remove
        </button>
      )}

      {error && (
        <p role="alert" className="max-w-[10rem] text-center text-[0.6875rem] font-medium text-danger text-pretty">
          {error}
        </p>
      )}
    </div>
  );
}
