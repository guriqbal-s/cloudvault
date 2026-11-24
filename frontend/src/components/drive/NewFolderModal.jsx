import { useState } from 'react';
import Modal from '../ui/Modal.jsx';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';
import * as foldersApi from '../../api/folders.js';
import { useToast } from '../../context/ToastContext.jsx';
import { getErrorMessage, getFieldErrors } from '../../utils/errors.js';

/** <NewFolderModal open onClose parentId onCreated(folder) /> */
export default function NewFolderModal({ open, onClose, parentId, onCreated }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const close = () => { if (!pending) { setName(''); setError(''); onClose(); } };
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setError('Enter a folder name'); return; }
    setPending(true);
    setError('');
    try {
      const folder = await foldersApi.create({ name: name.trim(), parentId: parentId ?? undefined });
      toast.success(`Folder "${folder?.name ?? name.trim()}" created`);
      setName('');
      onCreated?.(folder);
      onClose();
    } catch (err) {
      setError(getFieldErrors(err).name ?? getErrorMessage(err));
    } finally { setPending(false); }
  };

  return (
    <Modal open={open} onClose={close} title="New folder" size="sm"
      footer={<><Button variant="ghost" onClick={close} disabled={pending}>Cancel</Button><Button type="submit" form="new-folder-form" loading={pending}>Create</Button></>}>
      <form id="new-folder-form" onSubmit={submit}>
        <Input data-autofocus label="Folder name" value={name} onChange={(e) => setName(e.target.value)} error={error} maxLength={255} required />
      </form>
    </Modal>
  );
}
