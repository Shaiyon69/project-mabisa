import type { ReactNode } from 'react';
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

  return (
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
    </div>
  );
}
