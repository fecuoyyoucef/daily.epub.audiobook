import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { parse as parseHtml } from "node-html-parser";
import path from "node:path";
export type ParsedChapter = { title: string; text: string };
function asArray<T>(value: T | T[] | undefined | null): T[] { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function clean(value: unknown): string { return String(value ?? "").replace(/\u00a0/g, " ").replace(/[\t\r ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim(); }
function preflightZip(buffer: Buffer) {
  if (buffer.length < 22) throw new Error("ملف EPUB تالف أو غير مكتمل.");
  const minOffset = Math.max(0, buffer.length - 22 - 65_535);
  let endRecord = -1;
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { endRecord = offset; break; }
  }
  if (endRecord < 0) throw new Error("لم أعثر على فهرس ZIP صالح داخل EPUB.");
  const disk = buffer.readUInt16LE(endRecord + 4);
  const centralDisk = buffer.readUInt16LE(endRecord + 6);
  const diskEntries = buffer.readUInt16LE(endRecord + 8);
  const entryCount = buffer.readUInt16LE(endRecord + 10);
  const centralSize = buffer.readUInt32LE(endRecord + 12);
  const centralOffset = buffer.readUInt32LE(endRecord + 16);
  const commentLength = buffer.readUInt16LE(endRecord + 20);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("أرشيف EPUB متعدد الأقراص أو من نوع ZIP64 غير مدعوم.");
  }
  if (entryCount < 1 || entryCount > 10_000 || endRecord + 22 + commentLength > buffer.length || centralOffset + centralSize > endRecord) {
    throw new Error("بنية أرشيف EPUB تتجاوز الحدود الآمنة.");
  }

  const entries: Array<{ name: string; method: number; compressedSize: number; size: number }> = [];
  let offset = centralOffset;
  let expandedBytes = 0;
  const names = new Set<string>();
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > centralOffset + centralSize || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("فهرس ملفات EPUB غير صالح.");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const entryCommentLength = buffer.readUInt16LE(offset + 32);
    const entryEnd = offset + 46 + nameLength + extraLength + entryCommentLength;
    if (entryEnd > centralOffset + centralSize || compressedSize === 0xffffffff || size === 0xffffffff) {
      throw new Error("بيانات أحد ملفات EPUB غير صالحة.");
    }
    if ((flags & 1) !== 0 || (method !== 0 && method !== 8)) throw new Error("تشفير أو ضغط غير مدعوم داخل EPUB.");
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    const normalizedName = name.replace(/\\/g, "/");
    if (!name || name.includes("\0") || normalizedName.startsWith("/") || /^[a-z]:/i.test(normalizedName) || normalizedName.split("/").includes("..")) {
      throw new Error("يحتوي EPUB على مسار ملف غير آمن.");
    }
    if (names.has(normalizedName)) throw new Error("يحتوي EPUB على أسماء ملفات مكررة.");
    names.add(normalizedName);
    if (size > 20_000_000 || size > Math.max(compressedSize, 1) * 1_000) {
      throw new Error("نسبة ضغط أحد ملفات EPUB تتجاوز الحد الآمن.");
    }
    expandedBytes += size;
    if (expandedBytes > 120_000_000) throw new Error("حجم المحتوى بعد فك ضغط EPUB يتجاوز 120 MB.");
    entries.push({ name: normalizedName, method, compressedSize, size });
    offset = entryEnd;
  }
  if (offset !== centralOffset + centralSize) throw new Error("حجم فهرس EPUB غير متطابق.");
  const mime = entries[0];
  if (mime?.name !== "mimetype" || mime.method !== 0 || mime.compressedSize !== 20 || mime.size !== 20) {
    throw new Error("ترتيب أو توقيع EPUB غير صالح.");
  }
}
function xmlText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && "#text" in value) return String((value as Record<string, unknown>)["#text"] ?? "");
  return "";
}
function splitLargeParagraph(p: string, maxChars: number): string[] {
  const out: string[] = []; let rest = p.trim();
  while (rest.length > maxChars) {
    let cut = Math.max(rest.lastIndexOf(". ", maxChars), rest.lastIndexOf("؟ ", maxChars), rest.lastIndexOf("! ", maxChars), rest.lastIndexOf("。", maxChars));
    if (cut < Math.floor(maxChars * .55)) cut = rest.lastIndexOf(" ", maxChars);
    if (cut < Math.floor(maxChars * .55)) cut = maxChars;
    out.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest); return out;
}
export function splitForTts(text: string, maxChars = 4000): string[] {
  const paragraphs = text.split(/\n{2,}/).map(x=>x.trim()).filter(Boolean); const pieces: string[] = []; let current = "";
  for (const original of paragraphs) for (const p of (original.length > maxChars ? splitLargeParagraph(original,maxChars) : [original])) {
    const candidate = current ? current + "\n\n" + p : p;
    if (candidate.length > maxChars && current) { pieces.push(current); current = p; } else current = candidate;
  }
  if (current) pieces.push(current); return pieces;
}
export function estimateTokens(text: string): number { return Math.ceil(text.length * .8) + 64; }
export function parseEpub(buffer: Buffer): { title: string; chapters: ParsedChapter[] } {
  preflightZip(buffer);
  const entries = unzipSync(new Uint8Array(buffer));
  const entryValues = Object.values(entries);
  if (entryValues.length > 10_000) throw new Error("يحتوي EPUB على عدد ملفات يتجاوز الحد الآمن.");
  if (entryValues.some((item) => item.byteLength > 20_000_000)) throw new Error("يحتوي EPUB على ملف مفكوك يتجاوز الحد الآمن.");
  const expandedBytes = entryValues.reduce((n,item)=>n+item.byteLength,0);
  if (expandedBytes > 120_000_000) throw new Error("حجم المحتوى بعد فك ضغط EPUB يتجاوز 120 MB.");
  const mimeEntry = entries.mimetype;
  if (mimeEntry && new TextDecoder("utf-8").decode(mimeEntry).trim() !== "application/epub+zip") {
    throw new Error("توقيع ملف EPUB غير صالح.");
  }
  const decoder = new TextDecoder("utf-8"); const read = (name:string)=>entries[name]?decoder.decode(entries[name]):"";
  const parser = new XMLParser({ignoreAttributes:false,attributeNamePrefix:"@_",removeNSPrefix:true,trimValues:true});
  const container = parser.parse(read("META-INF/container.xml"));
  const rootfile = asArray<any>(container?.container?.rootfiles?.rootfile)[0];
  const opfPath = String(rootfile?.["@_full-path"] ?? "");
  if (!opfPath || !entries[opfPath]) throw new Error("تعذّر العثور على ملف package.opf داخل EPUB.");
  const opf = parser.parse(read(opfPath)); const pkg = opf?.package ?? opf;
  const title = clean(xmlText(pkg?.metadata?.title)) || "كتاب EPUB";
  const byId = new Map<string,any>();
  for (const item of asArray<any>(pkg?.manifest?.item)) byId.set(String(item?.["@_id"]??""),item);
  const chapters: ParsedChapter[] = []; const seen = new Set<string>();
  for (const ref of asArray<any>(pkg?.spine?.itemref)) {
    const item = byId.get(String(ref?.["@_idref"]??"")); if (!item) continue;
    const media = String(item?.["@_media-type"]??""); if (media && !/xhtml|html/i.test(media)) continue;
    const href = decodeURIComponent(String(item?.["@_href"]??"").split("#")[0]); if (!href || href.startsWith("/")) continue;
    const documentPath = path.posix.normalize(path.posix.join(path.posix.dirname(opfPath),href));
    if (documentPath === ".." || documentPath.startsWith("../") || documentPath.startsWith("/")) continue;
    if (seen.has(documentPath)) continue; seen.add(documentPath);
    const markup=read(documentPath); if (!markup) continue;
    const root=parseHtml(markup); for (const node of root.querySelectorAll("script,style,svg,nav")) node.remove();
    const heading=clean(root.querySelector("h1,h2,h3")?.textContent??root.querySelector("title")?.textContent??"");
    const body=root.querySelector("body")??root;
    const blocks=body.querySelectorAll("h1,h2,h3,h4,p,blockquote,pre").map(node=>clean(node.textContent)).filter(Boolean);
    const text=clean(blocks.length?blocks.join("\n\n"):body.textContent);
    if (!text) continue;
    chapters.push({title:heading||`الفصل ${chapters.length+1}`,text});
  }
  if (!chapters.length) throw new Error("لم أجد فصولاً نصية داخل EPUB. تحقق من بنية الكتاب.");
  return {title,chapters};
}
