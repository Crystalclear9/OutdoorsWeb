import {
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  unlink,
  stat,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// GitHub Pages currently serves main / (root). Keep that published entry usable
// without changing repository settings. Source entry lives in src/index.html.
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(path.join(root, "assets"), { recursive: true });
await cp(path.join(root, "dist/assets"), path.join(root, "assets"), {
  recursive: true,
  // Browsers on Windows may keep loaded fonts open. Identical hashed assets
  // already published need no replacement; changed bytes are still copied.
  filter: async (source, target) => {
    if ((await stat(source)).isDirectory()) return true;
    try {
      return !(await readFile(source)).equals(await readFile(target));
    } catch (error) {
      if (error.code === "ENOENT") return true;
      throw error;
    }
  },
});
await copyFile(
  path.join(root, "dist/index.html"),
  path.join(root, "index.html"),
);
const current = new Set(await readdir(path.join(root, "dist/assets")));
for (const name of await readdir(path.join(root, "assets"))) {
  if (/^[\w-]+-[\w-]{8}\.(js|css)$/.test(name) && !current.has(name)) {
    await unlink(path.join(root, "assets", name));
  }
}
console.log("GitHub Pages files updated: index.html and assets/");
