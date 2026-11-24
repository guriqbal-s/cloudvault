// Streams a stored object to an HTTP response with Range support (needed for video seeking
// and large downloads) and safe headers. Shared by authenticated downloads/previews and the
// public share-link endpoints. Storage-driver agnostic: it only calls storage.getStream().

import { pipeline } from 'node:stream/promises';

/**
 * Parse a single-range HTTP Range header.
 * @returns {null | 'unsatisfiable' | {start:number, end:number}}
 *   null => no usable range (serve the whole object); end is inclusive and clamped to size-1.
 */
export function parseRange(header, size) {
  if (typeof header !== 'string' || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim()); // multi-range ("a-b,c-d") does not match
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  let start;
  let end;
  if (rawStart === '') {
    const suffix = Number(rawEnd); // last N bytes
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
  if (start >= size) return 'unsatisfiable';
  if (end < start) return null;
  return { start, end };
}

/**
 * Content-Disposition with a safe ASCII fallback and an RFC 5987 UTF-8 filename*.
 * Quotes, slashes, backslashes and control characters can never break out of the header.
 */
export function contentDisposition(disposition, filename) {
  const type = disposition === 'inline' ? 'inline' : 'attachment';
  const clean = String(filename ?? 'download').replace(/[\u0000-\u001f\u007f"\\/]/g, '_').trim() || 'download';
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_').replace(/%/g, '_');
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {object} o
 * @param {{getStream(key: string, range?: {start:number,end:number}): Promise<NodeJS.ReadableStream>}} o.storage
 * @param {string} o.key
 * @param {number} o.size                     size in bytes (from the database)
 * @param {string} o.filename
 * @param {string} o.mimeType
 * @param {'attachment'|'inline'} [o.disposition]
 * @param {string} [o.inlineCsp]              Content-Security-Policy for inline responses (e.g. frame-ancestors)
 */
export async function streamObject(req, res, { storage, key, size, filename, mimeType, disposition = 'attachment', inlineCsp }) {
  const range = parseRange(req.headers.range, size);

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(disposition, filename));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  // The API-wide CSP blocks everything, which stops some PDF viewers; inline previews get a
  // narrower policy that only controls who may embed them.
  if (disposition === 'inline' && inlineCsp) res.setHeader('Content-Security-Policy', inlineCsp);

  if (range === 'unsatisfiable') {
    res.statusCode = 416;
    res.setHeader('Content-Range', `bytes */${size}`);
    res.end();
    return;
  }

  let stream;
  if (range) {
    stream = await storage.getStream(key, range); // throws before any header is flushed
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    res.setHeader('Content-Length', String(range.end - range.start + 1));
  } else {
    stream = await storage.getStream(key);
    res.statusCode = 200;
    res.setHeader('Content-Length', String(size));
  }

  try {
    await pipeline(stream, res);
  } catch (err) {
    // Client went away or the disk failed mid-transfer: headers are already sent, so just stop.
    if (!res.writableEnded) res.destroy();
    if (err?.code !== 'ERR_STREAM_PREMATURE_CLOSE') throw err;
  }
}
