'use client';

import { Modal } from './Modal';
import { Button } from './ui/Button';

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirmar',
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="text-[13.5px] text-ink2 leading-relaxed mt-0">{message}</p>
      <div className="flex gap-2.5 justify-end mt-4.5">
        <Button onClick={onCancel}>Cancelar</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} autoFocus>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
