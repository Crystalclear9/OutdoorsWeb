import { createApp } from "../app.mjs";
const app = await createApp({ dbPath: process.env.DB_PATH });
app.server.listen(0, "127.0.0.1", () =>
  process.send({ origin: `http://127.0.0.1:${app.server.address().port}` }),
);
process.on("message", async (message) => {
  if (message === "close") {
    await app.close();
    process.exit(0);
  }
});
