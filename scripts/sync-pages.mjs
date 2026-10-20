import { copyFile, cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// GitHub Pages currently serves main / (root). Keep that published entry usable
// without changing repository settings. Source entry lives in src/index.html.
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(path.join(root, "assets"), { recursive: true });
await cp(path.join(root, "dist/assets"), path.join(root, "assets"), {
  recursive: true,
});
await copyFile(
  path.join(root, "dist/index.html"),
  path.join(root, "index.html"),
);
console.log("GitHub Pages files updated: index.html and assets/");
