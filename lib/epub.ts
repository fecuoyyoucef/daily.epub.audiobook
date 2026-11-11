import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { parse as parseHtml } from "node-html-parser";
import path from "node:path";
export type ParsedChapter = { title: string; text: string };
function asArray<T>(value: T | T[] | undefined | null): T[] { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function clean(value: unknown): string { return String(value ?? "").replace(/\u00a0/g, " ").replace(/[\t\r ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim(); }
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
  const entries = unzipSync(new Uint8Array(buffer));
  const expandedBytes = Object.values(entries).reduce((n,item)=>n+item.byteLength,0);
  if (expandedBytes > 120_000_000) throw new Error("حجم المحتوى بعد فك ضغط EPUB يتجاوز 120 MB.");
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
    const href = decodeURIComponent(String(item?.["@_href"]??"").split("#")[0]); if (!href) continue;
    const documentPath = path.posix.normalize(path.posix.join(path.posix.dirname(opfPath),href));
    if (seen.has(documentPath)) continue; seen.add(documentPath);
    const markup=read(documentPath); if (!markup) continue;
    const root=parseHtml(markup); for (const node of root.querySelectorAll("script,style,svg,nav")) node.remove();
    const heading=clean(root.querySelector("h1,h2,h3")?.textContent??root.querySelector("title")?.textContent??"");
    const body=root.querySelector("body")??root;
    const blocks=body.querySelectorAll("h1,h2,h3,h4,p,blockquote,pre").map(node=>clean(node.textContent)).filter(Boolean);
    const text=clean(blocks.length?blocks.join("\n\n"):body.textContent);
    if (text.length<120) continue;
    chapters.push({title:heading||`الفصل ${chapters.length+1}`,text});
  }
  if (!chapters.length) throw new Error("لم أجد فصولاً نصية داخل EPUB. تحقق من بنية الكتاب.");
  return {title,chapters};
}
