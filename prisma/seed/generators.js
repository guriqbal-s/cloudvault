// Dependency-free generators that produce REAL, openable demo files (PDF, PNG, ZIP,
// DOCX, XLSX, TXT, CSV) so downloads and previews work on seeded data.
// ASCII-only content is assumed for text that goes into PDFs.

import zlib from 'node:zlib';

// ---------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------

/** Small deterministic PRNG so every seed run produces the same data. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const LOREM = [
  'Cloud storage keeps your documents available from every device you use.',
  'Versioned files let teams recover earlier drafts without asking for backups.',
  'Granular sharing means collaborators only see what they are meant to see.',
  'Quarterly planning aligns engineering effort with measurable business outcomes.',
  'Clear ownership of every project reduces handoff friction and missed deadlines.',
  'Regular reviews surface risks early, while they are still cheap to address.',
  'Documentation is a product feature: if it is not written down, it does not exist.',
  'Consistent naming conventions make large shared drives searchable and calm.',
];

// ---------------------------------------------------------------------
// Plain text and CSV
// ---------------------------------------------------------------------

export function makeText({ title, targetBytes = 4096, rng = Math.random }) {
  let out = `${title}\n${'='.repeat(title.length)}\n\n`;
  let i = 0;
  while (Buffer.byteLength(out) < targetBytes) {
    out += `${i + 1}. ${LOREM[Math.floor(rng() * LOREM.length)]}\n`;
    if (i % 6 === 5) out += '\n';
    i++;
  }
  return Buffer.from(out, 'utf8');
}

export function makeCsv({ targetBytes = 20000, rng = Math.random, startYear = 2026 }) {
  const categories = ['Software', 'Travel', 'Hardware', 'Marketing', 'Meals', 'Training', 'Office'];
  const vendors = ['Acme Corp', 'Northwind', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Stark Supply'];
  const statuses = ['Paid', 'Pending', 'Reimbursed'];
  const lines = ['Date,Category,Vendor,Amount,Status'];
  let size = lines[0].length + 1;
  while (size < targetBytes) {
    const month = 1 + Math.floor(rng() * 12);
    const day = 1 + Math.floor(rng() * 28);
    const date = `${startYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const amount = (10 + rng() * 4990).toFixed(2);
    const line = [
      date,
      categories[Math.floor(rng() * categories.length)],
      vendors[Math.floor(rng() * vendors.length)],
      amount,
      statuses[Math.floor(rng() * statuses.length)],
    ].join(',');
    lines.push(line);
    size += line.length + 1;
  }
  return Buffer.from(lines.join('\n') + '\n', 'utf8');
}

// ---------------------------------------------------------------------
// PDF (single page, Helvetica, optional padding object to reach a target size)
// ---------------------------------------------------------------------

export function makePdf({ title, lines = [], padBytes = 0, rng = Math.random }) {
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  let content = `BT\n/F1 22 Tf\n72 740 Td\n(${esc(title)}) Tj\n/F1 11 Tf\n0 -34 Td\n16 TL\n`;
  for (const line of lines.slice(0, 38)) content += `(${esc(line)}) Tj T*\n`;
  content += 'ET';

  const objects = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R ' +
      '/Resources << /Font << /F1 4 0 R >> >> >>'
  );
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const contentBuf = Buffer.from(content, 'latin1');
  objects.push({ dict: `<< /Length ${contentBuf.length} >>`, stream: contentBuf });

  if (padBytes > 0) {
    // Unreferenced stream object: valid PDF, ignored by viewers, gives the file realistic size.
    const pad = Buffer.alloc(padBytes);
    for (let i = 0; i < padBytes; i++) pad[i] = Math.floor(rng() * 256);
    objects.push({ dict: `<< /Length ${pad.length} >>`, stream: pad });
  }

  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [];
  let position = chunks[0].length;
  objects.forEach((obj, idx) => {
    offsets.push(position);
    let buf;
    if (typeof obj === 'string') {
      buf = Buffer.from(`${idx + 1} 0 obj\n${obj}\nendobj\n`, 'latin1');
    } else {
      buf = Buffer.concat([
        Buffer.from(`${idx + 1} 0 obj\n${obj.dict}\nstream\n`, 'latin1'),
        obj.stream,
        Buffer.from('\nendstream\nendobj\n', 'latin1'),
      ]);
    }
    chunks.push(buf);
    position += buf.length;
  });

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------
// PNG (RGB gradient + light noise)
// ---------------------------------------------------------------------

export function makePng({ width = 640, height = 400, hue = 0.6, rng = Math.random }) {
  const hsl = (h, s, l) => {
    const k = (n) => (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
  };
  const top = hsl(hue, 0.65, 0.6);
  const bottom = hsl((hue + 0.12) % 1, 0.7, 0.3);

  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    const ty = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const tx = x / (width - 1);
      const t = Math.min(1, ty * 0.8 + tx * 0.2);
      const noise = (rng() - 0.5) * 22;
      for (let c = 0; c < 3; c++) {
        const v = top[c] + (bottom[c] - top[c]) * t + noise;
        raw[y * stride + 1 + x * 3 + c] = Math.max(0, Math.min(255, Math.round(v)));
      }
    }
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------
// ZIP (store-only writer) + DOCX / XLSX built on top of it
// ---------------------------------------------------------------------

/** entries: [{ name, data: Buffer|string }] */
export function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const dosTime = 0x6000; // 12:00:00
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

const xmlEscape = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function makeDocx({ title, paragraphs = [] }) {
  const p = (text, bold = false) =>
    `<w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
  const body = [p(title, true), ...paragraphs.map((t) => p(t))].join('');
  return makeZip([
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'word/document.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body>${body}</w:body></w:document>`,
    },
  ]);
}

/** rows: array of arrays of string | number. First row is written as-is (use it for headers). */
export function makeXlsx({ sheetName = 'Sheet1', rows = [] }) {
  const colName = (i) => String.fromCharCode(65 + i);
  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${colName(c)}${r + 1}`;
          return typeof value === 'number'
            ? `<c r="${ref}"><v>${value}</v></c>`
            : `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');

  return makeZip([
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        `<sheetData>${sheetRows}</sheetData></worksheet>`,
    },
  ]);
}
