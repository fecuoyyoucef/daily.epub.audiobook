import { get, put } from "@vercel/blob";
export const MANIFEST_PATH = "state/manifest.json";
export async function putPrivate(pathname: string, body: string | Buffer | Uint8Array, contentType: string) {
  const uploadBody = typeof body === "string" ? body : Buffer.isBuffer(body) ? body : Buffer.from(body);
  return put(pathname, uploadBody, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType });
}
export async function putLock(pathname: string): Promise<void> {
  await put(pathname, "locked", { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "text/plain" });
}
export async function readPrivate(pathname: string): Promise<Buffer | null> {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}
export async function readJson<T>(pathname: string): Promise<T | null> {
  const data = await readPrivate(pathname);
  return data ? JSON.parse(data.toString("utf8")) as T : null;
}
export async function writeJson(pathname: string, value: unknown): Promise<void> {
  await putPrivate(pathname, Buffer.from(JSON.stringify(value), "utf8"), "application/json");
}
