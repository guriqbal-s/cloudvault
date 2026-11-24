import { useEffect, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';
import * as filesApi from '../../api/files.js';
import * as foldersApi from '../../api/folders.js';
import { useToast } from '../../context/ToastContext.jsx';
import { getErrorMessage, getFieldErrors } from '../../utils/errors.js';

/** <RenameModal item onClose onRenamed(updated) />  (open when `item` is set). The server keeps a file's extension. */
export default function RenameModal({ item, onClose, onRenamed }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => { setName(item?.name ?? ''); setError(''); }, [item]);

  const submit = async (e) => {
    e.preventDefault();
    const next = name.trim();
    if (!next) { setError('Enter a name'); return; }
    if (next === item.name) { onClose(); return; }
    setPending(true);
    setError('');
    try {
      const api = item.kind === 'folder' ? foldersApi : filesApi;
      const updated = await api.update(item.id, { name: next });
      toast.success('Renamed');
      onRenamed?.(updated);
      onClose();
    } catch (err) {
      setError(getFieldErrors(err).name ?? getErrorMessage(err));
    } finally { setPending(false); }
  };

  return (
    <Modal open={Boolean(item)} onClose={() => !pending && onClose()} title={`Rename ${item?.kind === 'folder' ? 'folder' : 'file'}`} size="sm"
      footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button><Button type="submit" form="rename-form" loading={pending}>Save</Button></>}>
      <form id="rename-form" onSubmit={submit}>
        <Input data-autofocus label="Name" value={name} onChange={(e) => setName(e.target.value)} error={error} maxLength={255}
          onFocus={(e) => { const dot = e.target.value.lastIndexOf('.'); if (item?.kind === 'file' && dot > 0) e.target.setSelectionRange(0, dot); else e.target.select(); }} />
      </form>
    </Modal>
  );
}
