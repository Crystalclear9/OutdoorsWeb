import { fork } from "node:child_process";

// A lease is not a substitute for reaping the process that owns the work.
export function superviseMaintenance({
  worker,
  config,
  renew,
  timeoutMs,
  renewMs,
  graceMs,
  confirmMs,
}) {
  let child,
    reported,
    diagnostic = "",
    reason,
    exited = false,
    settled = false;
  let deadline, heartbeat, escalate, confirmation;
  let complete;
  const promise = new Promise((resolve) => {
    complete = resolve;
  });
  const finish = (result) => {
    if (settled) return;
    settled = true;
    for (const timer of [deadline, heartbeat, escalate, confirmation])
      clearTimeout(timer);
    complete({ ...result, exitConfirmed: exited || !child?.pid });
  };
  const stop = (message = "维护任务已停止") => {
    if (reason || exited || settled) return;
    reason = message;
    try {
      child?.kill("SIGTERM");
    } catch {}
    escalate = setTimeout(() => {
      if (exited) return;
      try {
        child?.kill("SIGKILL");
      } catch {}
      confirmation = setTimeout(
        () =>
          finish({
            ok: false,
            error: `${reason}；无法确认维护进程退出，保留租约`,
          }),
        confirmMs,
      );
    }, graceMs);
  };
  try {
    child = fork(worker, [JSON.stringify(config)], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    child.stderr.on("data", (b) => {
      diagnostic = (diagnostic + b).slice(-2000);
    });
    child.on("message", (m) => {
      reported = m;
    });
    child.on("error", (error) => {
      if (!child.pid) finish({ ok: false, error: error.message });
      else stop(error.message);
    });
    child.on("exit", (code) => {
      exited = true;
      finish(
        reason
          ? { ok: false, error: reason }
          : code === 0 && reported
            ? reported
            : {
                ok: false,
                error: reported?.error || diagnostic || "维护进程异常退出",
              },
      );
    });
    deadline = setTimeout(() => stop("维护任务超过执行时限"), timeoutMs);
    heartbeat = setInterval(() => {
      try {
        if (!renew(child.pid)) stop("维护租约已丢失，任务已终止");
      } catch {
        stop("维护租约续期失败，任务已终止");
      }
    }, renewMs);
  } catch (error) {
    finish({ ok: false, error: error.message });
  }
  return { promise, stop };
}
