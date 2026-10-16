// Runs after `vite build`: packs dist/ into dist/<package name>.zip, so the whole
// site can be downloaded in one file (curl -LO https://…/breadboard-8bit.zip).
// Plain Node, no dependencies: deflated entries plus a central directory.
// Reproducible: the same site makes the same zip, byte for byte, so rsync -c and caches see no
// change after a rebuild. Every entry gets one date (see `stamp`) instead of its file's time.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const name = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name;
const zipName = `${name}.zip`;

// Browsers won't run the app from file://, which is the first thing people try.
const README = `Breadboard 8-bit, offline copy

Browsers don't run this app from file://, so serve this folder over HTTP.
From this folder:

    python -m http.server 8000

then open http://localhost:8000/ (any static file server works).
`;

/** Every file under `dir` except the zip, relative to `dir` with forward slashes. */
function filesIn(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.filter((f) => f !== zipName);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * The date of every entry: SOURCE_DATE_EPOCH when set (the reproducible-builds convention), else
 * the last commit's time, else 1980-01-01 (the earliest date a zip can hold).
 */
function stamp() {
  const DOS_EPOCH = Date.UTC(1980, 0, 1);
  let seconds = Number(process.env.SOURCE_DATE_EPOCH || NaN);
  if (!Number.isFinite(seconds)) {
    try {
      seconds = Number(execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || NaN);
    } catch {
      /* no git, or not a checkout */
    }
  }
  return new Date(Number.isFinite(seconds) ? Math.max(DOS_EPOCH, seconds * 1000) : DOS_EPOCH);
}

/** MS-DOS time and date fields (2 s resolution), in UTC so every time zone makes the same zip. */
const dosTime = (d) => (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
const dosDate = (d) => ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();

const mtime = stamp();
const entries = [
  ...filesIn(dist).map((f) => ({ path: f, data: readFileSync(join(dist, f)) })),
  { path: 'README.txt', data: Buffer.from(README) },
].sort((a, b) => (a.path < b.path ? -1 : 1));

const parts = [];
const central = [];
let offset = 0;
for (const { path, data } of entries) {
  const packed = deflateRawSync(data, { level: 9 });
  const fileName = Buffer.from(`${name}/${path}`); // one top-level folder, so unzipping stays tidy
  // Fields the local header and the central directory entry share, from "version needed" on.
  const common = Buffer.alloc(26);
  common.writeUInt16LE(20, 0); // version needed: 2.0 (deflate)
  common.writeUInt16LE(0x0800, 2); // flags: UTF-8 names
  common.writeUInt16LE(8, 4); // method: deflate
  common.writeUInt16LE(dosTime(mtime), 6);
  common.writeUInt16LE(dosDate(mtime), 8);
  common.writeUInt32LE(crc32(data), 10);
  common.writeUInt32LE(packed.length, 14);
  common.writeUInt32LE(data.length, 18);
  common.writeUInt16LE(fileName.length, 22);
  // extra field length (24) = 0

  const local = Buffer.alloc(4);
  local.writeUInt32LE(0x04034b50, 0);
  parts.push(local, common, fileName, packed);

  const head = Buffer.alloc(6);
  head.writeUInt32LE(0x02014b50, 0);
  head.writeUInt16LE(20, 4); // version made by: 2.0, MS-DOS attributes
  const tail = Buffer.alloc(14); // comment length, disk, internal + external attributes = 0
  tail.writeUInt32LE(offset, 10); // where the local header starts
  central.push(head, common, tail, fileName);

  offset += local.length + common.length + fileName.length + packed.length;
}

const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8); // entries on this disk
end.writeUInt16LE(entries.length, 10); // entries in total
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16); // where the central directory starts

const zip = Buffer.concat([...parts, directory, end]);
writeFileSync(join(dist, zipName), zip);
console.log(`dist/${zipName}  ${entries.length} files, ${(zip.length / 1024).toFixed(1)} kB, dated ${mtime.toISOString().slice(0, 16).replace('T', ' ')} UTC`);
