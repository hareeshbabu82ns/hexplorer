import { createReadStream, createWriteStream } from "fs";
import { Transform } from "stream";
import fs from "fs/promises";
import path from "path";
import archiver from "archiver";

/** rsync-style exclude pattern → matcher on (relative posix path, name, isDir) */
function excludeMatcher(patterns: string[]) {
  const toRe = (glob: string) =>
    new RegExp(
      "^" +
        glob
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*\*/g, "\u0000")
          .replace(/\*/g, "[^/]*")
          .replace(/\?/g, "[^/]")
          .replace(/\u0000/g, ".*") +
        "$",
    );
  const rules = patterns.map((p) => {
    const dirOnly = p.endsWith("/");
    let g = dirOnly ? p.slice(0, -1) : p;
    const anchored = g.startsWith("/");
    if (anchored) g = g.slice(1);
    // like rsync: a pattern without "/" matches the last path component anywhere
    return { re: toRe(g), dirOnly, onPath: anchored || g.includes("/") };
  });
  return (rel: string, name: string, isDir: boolean) =>
    rules.some((r) => (!r.dirOnly || isDir) && r.re.test(r.onPath ? rel : name));
}

type Entry = { abs: string; rel: string; size: number; dir: boolean; mtime: Date };

/** walk the source like `rsync -r`: regular files + directories, symlinks/devices skipped */
async function collect(srcAbs: string, isDir: boolean, excluded: ReturnType<typeof excludeMatcher>) {
  const entries: Entry[] = [];
  let skipped = 0;
  if (!isDir) {
    const st = await fs.stat(srcAbs);
    entries.push({ abs: srcAbs, rel: path.basename(srcAbs), size: st.size, dir: false, mtime: st.mtime });
    return { entries, skipped };
  }
  const walk = async (dirAbs: string, dirRel: string) => {
    const list = await fs.readdir(dirAbs, { withFileTypes: true });
    let kept = 0;
    for (const d of list) {
      const rel = dirRel ? `${dirRel}/${d.name}` : d.name;
      const abs = path.join(/*turbopackIgnore: true*/ dirAbs, d.name);
      if (excluded(rel, d.name, d.isDirectory())) continue;
      if (d.isDirectory()) {
        const n = await walk(abs, rel);
        // keep empty directories as explicit entries
        if (!n) entries.push({ abs, rel, size: 0, dir: true, mtime: (await fs.stat(abs)).mtime });
        kept++;
      } else if (d.isFile()) {
        const st = await fs.stat(abs);
        entries.push({ abs, rel, size: st.size, dir: false, mtime: st.mtime });
        kept++;
      } else skipped++;
    }
    return kept;
  };
  await walk(srcAbs, "");
  return { entries, skipped };
}

/**
 * Write srcAbs (a directory's contents, or a single file) into the zip outFile.
 * Writes to <outFile>.partial and renames on success, so a failed run never leaves
 * a truncated archive that looks complete. Uses zip64 automatically for large data.
 */
export async function zipTo(
  srcAbs: string,
  isDir: boolean,
  outFile: string,
  excludes: string[],
  onProgress: (pct: number) => void,
) {
  const { entries, skipped } = await collect(srcAbs, isDir, excludeMatcher(excludes));
  const total = entries.reduce((s, e) => s + e.size, 0);
  const partial = outFile + ".partial";

  const zip = archiver("zip", { zlib: { level: 6 }, forceZip64: false });
  const out = createWriteStream(partial);
  const done = new Promise<void>((resolve, reject) => {
    out.on("close", resolve);
    out.on("error", reject);
    zip.on("error", reject);
    // archiver reports missing files (vanished during the run) as warnings
    zip.on("warning", (e: any) => (e.code === "ENOENT" ? undefined : reject(e)));
  });
  done.catch(() => {}); // awaited below; avoid an unhandled rejection if finalize fails first
  zip.pipe(out);

  // feed entries one at a time (one open file at a time) and count bytes as they are
  // read, so a single large file still reports progress
  let read = 0;
  const counter = () =>
    new Transform({
      transform(chunk: Buffer, _enc, cb) {
        read += chunk.length;
        if (total) onProgress(Math.min(99, Math.floor((read / total) * 100)));
        cb(null, chunk);
      },
    });
  let i = 0;
  let finalized: Promise<void> | null = null;
  const next = () => {
    if (i >= entries.length) {
      finalized ??= zip.finalize();
      return;
    }
    const e = entries[i++];
    if (e.dir) return zip.append("", { name: e.rel + "/", date: e.mtime });
    const rs = createReadStream(e.abs);
    const c = counter();
    rs.on("error", (err) => c.destroy(err));
    zip.append(rs.pipe(c), { name: e.rel, date: e.mtime });
  };
  zip.on("entry", next);
  next();
  try {
    await done;
    await fs.rename(partial, outFile);
  } catch (e) {
    zip.abort();
    out.destroy();
    await fs.rm(partial, { force: true });
    throw e;
  }
  return { files: entries.filter((e) => !e.dir).length, bytes: total, skipped, zipBytes: zip.pointer() };
}
