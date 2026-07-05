// Minimal client-side ZIP writer (STORE, no compression) for "Download all"
// bundles. Browsers block programmatic multi-file downloads after the first
// click, so bundling into one archive is the only click-once option that
// works everywhere — and it needs no external dependency.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// MS-DOS date/time as stored in zip headers (2-second resolution).
function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export function buildZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const now = dosDateTime(new Date());
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header signature
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // flags: UTF-8 filenames
    lv.setUint16(8, 0, true); // method: STORE
    lv.setUint16(10, now.time, true);
    lv.setUint16(12, now.date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // compressed size (== uncompressed for STORE)
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra field length
    local.set(name, 30);
    localParts.push(local, entry.data);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory header signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, now.time, true);
    cv.setUint16(14, now.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true); // local header offset
    central.set(name, 46);
    centralParts.push(central);

    offset += local.length + size;
  }

  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory signature
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true); // central directory offset
  // BlobPart[] accepts ArrayBufferView, so the raw parts can be passed as-is.
  return new Blob([...localParts, ...centralParts, eocd] as BlobPart[], {
    type: 'application/zip',
  });
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// "name.txt" → "name (2).txt" when the zip already holds that name.
function uniqueName(name: string, used: Set<string>): string {
  let candidate = name;
  for (let i = 2; used.has(candidate); i++) {
    const dot = name.lastIndexOf('.');
    candidate = dot > 0 ? `${name.slice(0, dot)} (${i})${name.slice(dot)}` : `${name} (${i})`;
  }
  used.add(candidate);
  return candidate;
}

export interface DownloadAllResult {
  ok: number;
  failed: string[];
}

/**
 * Fetch every URL and save the lot as a single zip (or directly when there
 * is only one file). Failures are collected, not thrown, so one bad file
 * doesn't sink the rest of the bundle.
 */
export async function downloadAllAsZip(
  files: { name: string; url: string }[],
  zipName: string,
  onProgress?: (done: number, total: number) => void
): Promise<DownloadAllResult> {
  const entries: ZipEntry[] = [];
  const failed: string[] = [];
  const used = new Set<string>();

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    try {
      const res = await fetch(f.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      entries.push({ name: uniqueName(f.name, used), data: new Uint8Array(await res.arrayBuffer()) });
    } catch {
      failed.push(f.name);
    }
    onProgress?.(i + 1, files.length);
  }

  if (entries.length === 1 && files.length === 1) {
    saveBlob(new Blob([entries[0].data as BlobPart]), entries[0].name);
  } else if (entries.length > 0) {
    saveBlob(buildZip(entries), zipName);
  }

  return { ok: entries.length, failed };
}
