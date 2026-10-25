import { readResponse } from "./request.js";
import { showcaseEnabled } from "./showcase/gate.js";

const BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
let csrf = null;
let authGeneration = 0;
export const apiUrl = (path) => `${BASE}/api${path}`;
export function setCsrf(value) {
  if (csrf !== value) authGeneration++;
  csrf = value;
}
export async function api(path, options = {}) {
  // TEMPORARY_PAGES_SHOWCASE: explicit static build only; never catch/fallback.
  if (import.meta.env.MODE === "pages" && showcaseEnabled)
    return (await import("./showcase/runtime.js")).request(path, options);
  const generation = authGeneration;
  let res, data;
  try {
    ({ response: res, body: data } = await readResponse(
      `${BASE}/api${path}`,
      {
        ...options,
        credentials: "include",
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
          ...options.headers,
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      },
      (response) =>
        response.headers.get("content-type")?.includes("application/json")
          ? response.json()
          : null,
    ));
  } catch {
    throw new Error("无法连接账号服务，请确认后端已启动并检查网络连接。");
  }
  if (!res.headers.get("content-type")?.includes("application/json"))
    throw new Error("当前站点尚未连接后端。请使用 Docker 完整服务地址访问。");
  if (!res.ok) {
    if (
      res.status === 401 &&
      generation === authGeneration &&
      !path.startsWith("/auth/")
    )
      window.dispatchEvent(new Event("session-expired"));
    const error = new Error(data.error || "操作失败，请稍后重试");
    error.status = res.status;
    throw error;
  }
  return data;
}
export async function getDesign(id) {
  if (import.meta.env.MODE === "pages" && showcaseEnabled)
    return (await import("./showcase/runtime.js")).design(id);
  const generation = authGeneration;
  let res, blob;
  try {
    ({ response: res, body: blob } = await readResponse(
      `${BASE}/api/bookings/${id}/image`,
      { credentials: "include" },
      (response) => (response.ok ? response.blob() : null),
    ));
  } catch {
    throw new Error("无法加载设计图，请检查网络连接后重试");
  }
  if (!res.ok) {
    if (res.status === 401 && generation === authGeneration)
      window.dispatchEvent(new Event("session-expired"));
    throw new Error("无法加载设计图");
  }
  return URL.createObjectURL(blob);
}
