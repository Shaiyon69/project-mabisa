import { useEffect, type ReactNode } from 'react';
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

export function Modal({ open, title, children, onClose, className = '' }: ModalProps) {
  // Escape closes it. A panel laid over the page has to be dismissable without
  // hunting for the control that opened it, and every caller wants that.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  // Portalled to the body. The admin rail and the admin header are both
  // `position: sticky`, which creates a stacking context, so a dialog rendered
  // inside either one paints underneath the page content beside it no matter how
  // high its z-index goes.
  return createPortal(
    <div className={`modal-backdrop ${className}`.trim()} role="presentation" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="panel-heading">
          <h2 id="modal-title">{title}</h2>
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
