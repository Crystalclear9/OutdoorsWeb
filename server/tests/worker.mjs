import { createApp } from "../app.mjs";
import { listenHttp } from "./http-listen.mjs";
const app = await createApp({
  dbPath: process.env.DB_PATH,
  captchaTestAnswer: "246789",
  maintenance: { scheduled: false },
});
await listenHttp(app.server);
process.send({ origin: `http://127.0.0.1:${app.server.address().port}` });
process.on("message", async (message) => {
  if (message === "close") {
    await app.close();
    process.exit(0);
  }
});
