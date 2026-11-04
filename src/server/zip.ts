// A .zip written as it goes, for downloading a folder (see http/routes/code.ts): each file deflated
// on its own, then the central directory. Plain zip (no zip64), so it's held to well under 4 GB.
import { crc32, deflateRawSync } from 'node:zlib';

interface Entry {
  name: Buffer;
  crc: number;
  size: number;
  packed: number;
  method: number;
  time: number;
  date: number;
  offset: number;
}

/** A date as zip keeps it (MS-DOS: two-second steps, from 1980). */
function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

export class ZipWriter {
  private entries: Entry[] = [];
  private offset = 0;

  /** `write` takes each piece of the file as it's made. */
  constructor(private write: (chunk: Buffer) => void) {}

  /** Adds a file at `name` (forward slashes) with `data`, changed at `mtime`. */
  add(name: string, data: Buffer, mtime = new Date()) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data);
    // Already compressed (a picture, a zip): stored as it is.
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const { time, date } = dosTime(mtime);
    const e: Entry = { name: nameBuf, crc: crc32(data) >>> 0, size: data.length, packed: body.length, method: stored ? 0 : 8, time, date, offset: this.offset };
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // names in UTF-8
    head.writeUInt16LE(e.method, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(e.crc, 14);
    head.writeUInt32LE(e.packed, 18);
    head.writeUInt32LE(e.size, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    head.writeUInt16LE(0, 28);
    this.write(head);
    this.write(nameBuf);
    this.write(body);
    this.offset += head.length + nameBuf.length + body.length;
    this.entries.push(e);
  }

  /** The central directory and its end: the zip's done. */
  finish() {
    const start = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(e.time, 12);
      c.writeUInt16LE(e.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.packed, 20);
      c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.name.length, 28);
      c.writeUInt32LE(e.offset, 42);
      this.write(c);
      this.write(e.name);
      this.offset += c.length + e.name.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - start, 12);
    end.writeUInt32LE(start, 16);
    this.write(end);
  }
}
