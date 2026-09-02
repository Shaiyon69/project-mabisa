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
  // Escape closes it, so a panel over the page is always dismissable.
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

  // Portalled to the body: the admin rail and header are `position: sticky`, and a
  // dialog inside either stacking context paints under the page beside it.
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
