const BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
let csrf = null;
export const apiUrl = (path) => `${BASE}/api${path}`;
export function setCsrf(value) {
  csrf = value;
}
export async function api(path, options = {}) {
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
    throw new Error("无法连接账号服务，请确认后端已启动并检查网络连接。");
  } finally {
    clearTimeout(timer);
  }
  if (!res.headers.get("content-type")?.includes("application/json"))
    throw new Error("当前站点尚未连接后端。请使用 Docker 完整服务地址访问。");
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    const error = new Error(data.error || "操作失败，请稍后重试");
    error.status = res.status;
    throw error;
  }
  return data;
}
export async function getDesign(id) {
  const res = await fetch(`${BASE}/api/bookings/${id}/image`, {
    credentials: "include",
  });
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("session-expired"));
    throw new Error("无法加载设计图");
  }
  return URL.createObjectURL(await res.blob());
}
