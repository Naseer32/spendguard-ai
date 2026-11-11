import { useEffect, useId, useRef } from 'react';
import { XIcon } from './Icons.jsx';

/**
 * Accessible modal built on the native <dialog> element, which provides the
 * focus trap, Escape-to-close and inert background. On phones it is a bottom
 * sheet; from `sm` up it is a centred dialog. Content is only mounted while
 * open, so forms reset every time.
 */
export default function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  const ref = useRef(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const width = size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg';

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(e) => {
        // A click on the backdrop targets the <dialog> itself.
        if (e.target === e.currentTarget) onClose();
      }}
      className={`m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-2xl border-0 bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/50 open:flex open:flex-col sm:m-auto sm:max-h-[85dvh] sm:rounded-2xl ${width}`}
    >
      {open ? (
        <>
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold text-ink">
                {title}
              </h2>
              {description ? (
                <p id={descId} className="mt-0.5 text-sm text-ink-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-m-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-surface hover:text-ink"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? (
            <div className="flex flex-col-reverse gap-2 border-t border-line bg-white px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:pb-4">
              {footer}
            </div>
          ) : null}
        </>
      ) : null}
    </dialog>
  );
}
