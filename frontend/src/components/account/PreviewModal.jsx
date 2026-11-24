import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import * as filesApi from '../../api/files.js';
import { getErrorMessage } from '../../utils/errors.js';
import Modal from '../ui/Modal.jsx';
import Button from '../ui/Button.jsx';
import Spinner from '../ui/Spinner.jsx';

const KIND = { image: ['jpg', 'jpeg', 'png', 'gif'], pdf: ['pdf'], video: ['mp4'], text: ['txt', 'csv'] };
export const previewKindOf = (file) => Object.keys(KIND).find((k) => KIND[k].includes(String(file?.extension ?? '').toLowerCase())) ?? null;

/** Small, self-contained file preview (signed URL for media, fetched text for txt/csv). */
export default function PreviewModal({ file, onClose }) {
  const [state, setState] = useState({ url: null, text: null, error: null, loading: true });
  const kind = previewKindOf(file);

  useEffect(() => {
    if (!file) return undefined;
    let alive = true;
    setState({ url: null, text: null, error: null, loading: true });
    (async () => {
      try {
        if (kind === 'text') {
          const text = await filesApi.fetchText(file.id);
          if (alive) setState({ url: null, text: String(text).slice(0, 200_000), error: null, loading: false });
        } else if (kind) {
          const { url } = await filesApi.accessUrl(file.id, 'preview');
          if (alive) setState({ url, text: null, error: null, loading: false });
        } else if (alive) setState({ url: null, text: null, error: null, loading: false });
      } catch (err) {
        if (alive) setState({ url: null, text: null, error: getErrorMessage(err), loading: false });
      }
    })();
    return () => { alive = false; };
  }, [file, kind]);

  return (
    <Modal open={Boolean(file)} onClose={onClose} title={file?.name} size="xl"
      footer={<><Button variant="secondary" onClick={onClose}>Close</Button>
        {file?.access?.capabilities?.download !== false && <Button leftIcon={<Download />} onClick={() => filesApi.download(file.id)}>Download</Button>}</>}>
      <div className="flex min-h-[40vh] items-center justify-center">
        {state.loading ? <Spinner className="h-7 w-7" />
          : state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p>
          : !kind ? <p className="text-sm text-content-muted">This file type cannot be previewed. Download it to open it.</p>
          : kind === 'image' ? <img src={state.url} alt={file.name} className="max-h-[70vh] max-w-full rounded-lg object-contain" />
          : kind === 'video' ? <video src={state.url} controls className="max-h-[70vh] w-full rounded-lg bg-black" />
          : kind === 'pdf' ? <iframe src={state.url} title={file.name} className="h-[70vh] w-full rounded-lg border border-border" />
          : <pre className="max-h-[70vh] w-full overflow-auto whitespace-pre-wrap rounded-lg bg-surface-sunken p-4 font-mono text-xs">{state.text}</pre>}
      </div>
    </Modal>
  );
}
