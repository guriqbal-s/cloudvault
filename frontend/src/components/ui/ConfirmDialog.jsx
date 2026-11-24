import { useState } from 'react';
import Modal from './Modal.jsx';
import Button from './Button.jsx';
import { getErrorMessage } from '../../utils/errors.js';

/**
 * <ConfirmDialog open title description confirmLabel="Delete" tone="danger|primary"
 *   onConfirm={async () => {...}} onClose />
 * While onConfirm runs the buttons are disabled; if it throws, the error is shown and the dialog stays open.
 * On success the dialog calls onClose.
 */
export default function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'primary', children }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const close = () => { if (!pending) { setError(null); onClose?.(); } };
  const confirm = async () => {
    setPending(true); setError(null);
    try { await onConfirm?.(); setPending(false); onClose?.(); }
    catch (err) { setPending(false); setError(getErrorMessage(err)); }
  };
  return (
    <Modal open={open} onClose={close} size="sm" title={title} description={description} closeOnBackdrop={!pending}
      footer={<>
        <Button variant="secondary" onClick={close} disabled={pending}>{cancelLabel}</Button>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={confirm} loading={pending} data-autofocus>{confirmLabel}</Button>
      </>}>
      {children}
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </Modal>
  );
}
