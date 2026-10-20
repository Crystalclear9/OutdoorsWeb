import { mkdir } from "node:fs/promises";
import path from "node:path";
import { restoreEncrypted } from "./offsite.mjs";
const [source, target] = process.argv.slice(2);
if (!source || !target)
  throw new Error(
    "用法：npm run restore:encrypted -- backup.sqlite.enc /新的空目录/app.sqlite",
  );
await mkdir(path.dirname(path.resolve(target)), {
  recursive: true,
  mode: 0o700,
});
console.log(await restoreEncrypted(path.resolve(source), path.resolve(target)));
