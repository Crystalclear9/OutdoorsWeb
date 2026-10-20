import { compactDatabase } from "./compaction.mjs";
if (!process.argv.includes("--offline"))
  throw new Error(
    "请先停止应用，再执行 npm run compact -- --offline；此操作会重建数据库文件，请预留维护时间。",
  );
console.log(
  JSON.stringify(
    await compactDatabase(process.env.DB_PATH || "data/app.sqlite"),
    null,
    2,
  ),
);
