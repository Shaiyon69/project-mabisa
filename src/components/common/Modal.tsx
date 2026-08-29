import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';

type ModalProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
};

export function Modal({ open, title, children, onClose }: ModalProps) {
  if (!open) {
    return null;
  }

  // Portalled to the body. The admin rail and the admin header are both
  // `position: sticky`, which creates a stacking context, so a dialog rendered
  // inside either one paints underneath the page content beside it no matter how
  // high its z-index goes.
  return createPortal(
    <div className="modal-backdrop" role="presentation">
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
