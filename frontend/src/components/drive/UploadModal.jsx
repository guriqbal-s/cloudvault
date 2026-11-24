import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, UploadCloud, X } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import Button from '../ui/Button.jsx';
import ProgressBar from '../ui/ProgressBar.jsx';
import { FileIcon } from '../../utils/fileIcons.jsx';
import { formatBytes } from '../../utils/format.js';
import { getErrorCode, getErrorMessage, isCanceled } from '../../utils/errors.js';
import { notifyStorageChanged } from '../../utils/events.js';
import { useToast } from '../../context/ToastContext.jsx';
import * as filesApi from '../../api/files.js';

const FRIENDLY = {
  QUOTA_EXCEEDED: 'Not enough storage space left',
  FILE_TOO_LARGE: 'File is larger than the upload limit',
  FILE_TYPE_NOT_ALLOWED: 'This file type is not allowed',
  EXTENSION_NOT_ALLOWED: 'This file type is not allowed',
  FORBIDDEN: 'You cannot upload to this folder',
};
const errorText = (err) => FRIENDLY[getErrorCode(err)] ?? err?.message ?? getErrorMessage(err);

let seq = 0;
const toEntry = (file) => ({ uid: ++seq, file, status: 'queued', progress: 0, error: null });

/**
 * Multi-file upload dialog. Files are sent one request each so every file gets its own progress bar and result.
 * <UploadModal open onClose folderId initialFiles={File[]} onUploaded() />
 */
export default function UploadModal({ open, onClose, folderId, initialFiles, onUploaded }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const [entries, setEntries] = useState([]);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);

  const add = useCallback((fileList) => {
    const next = Array.from(fileList ?? []).map(toEntry);
    if (next.length) setEntries((prev) => [...prev, ...next]);
  }, []);

  useEffect(() => {
    if (open) setEntries(initialFiles?.length ? Array.from(initialFiles).map(toEntry) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const patch = (uid, change) => setEntries((prev) => prev.map((e) => (e.uid === uid ? { ...e, ...change } : e)));

  const start = async () => {
    const todo = entries.filter((e) => e.status === 'queued' || e.status === 'error');
    if (!todo.length) return;
    setRunning(true);
    const ctl = new AbortController();
    abortRef.current = ctl;
    let ok = 0;
    for (const entry of todo) {
      if (ctl.signal.aborted) break;
      patch(entry.uid, { status: 'uploading', progress: 0, error: null });
      try {
        const { results } = await filesApi.upload([entry.file], {
          folderId, signal: ctl.signal, onProgress: (p) => patch(entry.uid, { progress: p }),
        });
        const result = results?.[0];
        if (result && result.ok === false) patch(entry.uid, { status: 'error', error: FRIENDLY[result.error?.code] ?? result.error?.message ?? 'Upload failed' });
        else { ok += 1; patch(entry.uid, { status: 'done', progress: 1 }); }
      } catch (err) {
        if (isCanceled(err)) { patch(entry.uid, { status: 'queued', progress: 0 }); break; }
        patch(entry.uid, { status: 'error', error: errorText(err) });
      }
    }
    abortRef.current = null;
    setRunning(false);
    if (ok) {
      toast.success(ok === 1 ? 'Upload complete' : `${ok} files uploaded`);
      notifyStorageChanged();
      onUploaded?.();
    }
  };

  const close = () => { abortRef.current?.abort(); onClose(); };
  const queued = entries.filter((e) => e.status === 'queued' || e.status === 'error').length;
  const allDone = entries.length > 0 && entries.every((e) => e.status === 'done');
  const onDrop = (e) => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files); };

  return (
    <Modal open={open} onClose={close} title="Upload files" size="lg" closeOnBackdrop={!running}
      footer={<>
        <Button variant="ghost" onClick={close}>{allDone ? 'Close' : running ? 'Cancel' : 'Close'}</Button>
        {!allDone && <Button onClick={start} loading={running} disabled={!queued} leftIcon={<UploadCloud />}>
          {running ? 'Uploading…' : queued ? `Upload ${queued} ${queued === 1 ? 'file' : 'files'}` : 'Upload'}</Button>}
      </>}>
      <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
        className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors ${dragging ? 'border-brand bg-brand-soft' : 'border-border-strong bg-surface-muted'}`}>
        <UploadCloud className="mb-2 h-8 w-8 text-brand" aria-hidden="true" />
        <p className="text-sm font-semibold">Drag files here or</p>
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => inputRef.current?.click()} disabled={running}>Choose files</Button>
        <input ref={inputRef} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        <p className="mt-2 text-xs text-content-muted">PDF, Office documents, images, MP4, ZIP, TXT and CSV</p>
      </div>
      {entries.length > 0 && (
        <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
          {entries.map((e) => (
            <li key={e.uid} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2.5">
              <FileIcon item={{ kind: 'file', category: 'other' }} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-semibold">{e.file.name}</p>
                  <span className="shrink-0 text-xs text-content-muted tabular">{formatBytes(e.file.size)}</span>
                </div>
                {e.status === 'uploading' && <ProgressBar value={e.progress} max={1} size="sm" className="mt-1.5" />}
                {e.status === 'error' && <p className="mt-0.5 text-xs text-danger">{e.error}</p>}
              </div>
              {e.status === 'done' && <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-label="Uploaded" />}
              {e.status === 'error' && <AlertCircle className="h-5 w-5 shrink-0 text-danger" aria-label="Failed" />}
              {(e.status === 'queued' || e.status === 'error') && !running && (
                <Button icon variant="ghost" size="sm" aria-label={`Remove ${e.file.name}`} onClick={() => setEntries((p) => p.filter((x) => x.uid !== e.uid))}><X /></Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
