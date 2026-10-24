import { lstatSync } from "node:fs";

// A missing main file is not an unused SQLite target. Old WAL pages can replay
// successfully against a new snapshot, and journal files may belong to a live
// connection. Preserve these paths and require the operator to use a clean one.
export function assertSqliteTargetAvailable(target, action) {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    try {
      lstatSync(target + suffix);
      throw new Error(
        suffix
          ? `${action}目标存在 SQLite 辅助文件，请停止相关服务并选择新的空目录`
          : `${action}目标已存在，请选择新的数据库路径`,
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
}
