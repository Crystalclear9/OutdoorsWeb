import { previewRole, previewApi, previewDesign } from "./preview.js";
const BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
let csrf = null;
export function setCsrf(value) {
  csrf = value;
}
export async function api(path, options = {}) {
  if (previewRole) return previewApi(path, options);
  let res;
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 15000);
  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...options,
      credentials: "include",
      signal: controller.signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        ...options.headers,
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new Error("暂时无法连接服务，请稍后重试。");
  } finally {
    clearTimeout(timer);
  }
  if (!res.headers.get("content-type")?.includes("application/json"))
    throw new Error("服务暂不可用，请稍后重试。");
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && !["/auth/login", "/auth/register"].includes(path))
      window.dispatchEvent(new Event("session-expired"));
    const error = new Error(data.error || "操作失败，请稍后重试");
    error.status = res.status;
    throw error;
  }
  return data;
}
export async function getDesign(id) {
  if (previewRole) return previewDesign();
  const res = await fetch(`${BASE}/api/bookings/${id}/image`, {
    credentials: "include",
  });
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("session-expired"));
    throw new Error("无法加载设计图");
  }
  return URL.createObjectURL(await res.blob());
}
