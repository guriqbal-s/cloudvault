import { useEffect, useState } from 'react';
import { Download, FileQuestion } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import Button from '../ui/Button.jsx';
import Spinner from '../ui/Spinner.jsx';
import * as filesApi from '../../api/files.js';
import { previewKindOf, caps } from './driveUtils.js';
import { formatBytes } from '../../utils/format.js';
import { getErrorMessage } from '../../utils/errors.js';
import { useToast } from '../../context/ToastContext.jsx';

/** <PreviewModal file onClose /> (open when `file` is set). Image / PDF / video / text via short-lived signed URLs. */
export default function PreviewModal({ file, onClose }) {
  const toast = useToast();
  const kind = file ? previewKindOf(file) : null;
  const [state, setState] = useState({ loading: false, url: null, text: null, error: null });

  useEffect(() => {
    if (!file || !kind) { setState({ loading: false, url: null, text: null, error: null }); return undefined; }
    let cancelled = false;
    setState({ loading: true, url: null, text: null, error: null });
    (async () => {
      try {
        if (kind === 'text') {
          const text = await filesApi.fetchText(file.id);
          if (!cancelled) setState({ loading: false, url: null, text, error: null });
        } else {
          const { url } = await filesApi.accessUrl(file.id, 'preview');
          if (!cancelled) setState({ loading: false, url, text: null, error: null });
        }
      } catch (err) {
        if (!cancelled) setState({ loading: false, url: null, text: null, error: getErrorMessage(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [file, kind]);

  const download = async () => {
    try { await filesApi.download(file.id); } catch (err) { toast.error(getErrorMessage(err)); }
  };
  const canDownload = file ? caps(file).download !== false : false;

  return (
    <Modal open={Boolean(file)} onClose={onClose} title={file?.name} description={file ? `${formatBytes(file.size)} · version ${file.currentVersion}` : undefined} size="full"
      footer={file && canDownload ? <Button variant="secondary" leftIcon={<Download />} onClick={download}>Download</Button> : undefined}>
      <div className="flex min-h-[50vh] items-center justify-center overflow-hidden rounded-xl bg-surface-sunken">
        {!kind ? (
          <div className="p-10 text-center"><FileQuestion className="mx-auto mb-3 h-10 w-10 text-content-faint" />
            <p className="font-semibold">No preview for this file type</p>
            <p className="mt-1 text-sm text-content-muted">Download it to open it on your device.</p></div>
        ) : state.loading ? <Spinner />
          : state.error ? <p role="alert" className="p-6 text-sm text-danger">{state.error}</p>
            : kind === 'image' ? <img src={state.url} alt={file.name} className="max-h-[70vh] max-w-full object-contain" />
              : kind === 'video' ? <video src={state.url} controls className="max-h-[70vh] w-full bg-black" />
                : kind === 'pdf' ? <iframe src={state.url} title={file.name} className="h-[70vh] w-full border-0" />
                  : <pre className="max-h-[70vh] w-full overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs">{state.text}</pre>}
      </div>
    </Modal>
  );
}
