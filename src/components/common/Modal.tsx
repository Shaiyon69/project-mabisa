import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';

type ModalProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  /** Placement variant on the backdrop, e.g. `filter-drawer` for a side sheet. */
  className?: string;
};

/** Focusable descendants, in tab order, for the trap below. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, title, children, onClose, className = '' }: ModalProps) {
  const panel = useRef<HTMLElement>(null);
  // Unique per instance: two modals can be mounted at once, and a shared id would
  // point both dialogs' labels at whichever heading rendered first.
  const titleId = useId();

  // Escape closes it, Tab stays inside it, and focus returns to whatever opened
  // it. Without the trap `aria-modal` is a claim the markup does not honour —
  // keyboard and screen-reader users tab straight through to the page behind.
  useEffect(() => {
    if (!open) {
      return;
    }

    const opener = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !panel.current) {
        return;
      }

      const stops = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const edge = event.shiftKey ? stops[0] : stops.at(-1);

      if (edge && document.activeElement === edge) {
        event.preventDefault();
        (event.shiftKey ? stops.at(-1) : stops[0])?.focus();
      }
    };

    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    document.addEventListener('keydown', onKey);

    // The page behind must not scroll under the sheet on a phone.
    const scroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = scroll;
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  // Portalled to the body: the admin rail and header are `position: sticky`, and a
  // dialog inside either stacking context paints under the page beside it.
  return createPortal(
    <div className={`modal-backdrop ${className}`.trim()} role="presentation" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel}>
        <div className="panel-heading">
          <h2 id={titleId}>{title}</h2>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}
