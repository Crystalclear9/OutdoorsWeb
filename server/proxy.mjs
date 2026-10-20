import { isIP } from "node:net";
// Trust only explicitly named immediate proxy addresses, never arbitrary forwarding headers.
export function clientAddress(req, trusted = []) {
  const peer = (req.socket.remoteAddress || "unknown").replace(/^::ffff:/, "");
  if (!trusted.includes(peer)) return peer;
  const value = req.headers["x-forwarded-for"];
  if (typeof value !== "string") return peer;
  const chain = value.split(",").map((v) => v.trim().replace(/^::ffff:/, ""));
  if (chain.length > 20 || chain.some((v) => !isIP(v))) return peer;
  // Walk from the trusted server back to the first untrusted hop.
  for (let i = chain.length - 1; i >= 0; i--)
    if (!trusted.includes(chain[i])) return chain[i];
  return chain[0] || peer;
}
