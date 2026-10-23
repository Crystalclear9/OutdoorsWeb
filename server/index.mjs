import { createApp } from "./app.mjs";

const app = await createApp();
const port = Number(process.env.PORT || 3001),
  host = process.env.HOST || "0.0.0.0";
app.server.listen(port, host, () =>
  console.log(`Outdoor reservation service listening on ${host}:${port}`),
);
if (!app.db.prepare("SELECT id FROM users WHERE role='admin'").get())
  console.warn(
    "No administrator account. Set ADMIN_EMAIL and ADMIN_PASSWORD on the first startup.",
  );
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.close().then(
      () => process.exit(0),
      (error) => {
        console.error(
          JSON.stringify({
            event: "shutdown.failed",
            error: String(error?.message || error),
          }),
        );
        process.exit(1);
      },
    );
  });
