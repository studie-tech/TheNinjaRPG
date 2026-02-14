import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import fetch from "node-fetch";

/**
 * Downloads a file from a URL and saves it to a temporary directory
 * @param url - The URL of the file to download
 * @param filename - The filename of the file to save
 * @returns The path to the file
 */
export const downloadToTmp = async (url: string, filename: string): Promise<string> => {
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  const buffer = await res.arrayBuffer();
  const localPath = path.join(tmpdir(), `${nanoid()}-${filename}`);
  await writeFile(localPath, Buffer.from(buffer));
  return localPath;
};
