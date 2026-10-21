import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ErrorBox } from "./components.jsx";

export default function AccessCode({ connected }) {
  // Share the public entry only; login proofs and preview/query parameters stay private.
  const [entry] = useState(
    () => new URL(window.location.pathname, window.location.origin).href,
  );
  const [image, setImage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(entry, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: "M",
    })
      .then((value) => active && setImage(value))
      .catch(() => active && setError("二维码生成失败，请复制下方地址访问。"));
    return () => {
      active = false;
    };
  }, [entry]);
  const local =
    ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(
      window.location.hostname,
    ) || window.location.hostname.endsWith(".localhost");
  return (
    <section className="entry-code" aria-label="扫码访问">
      <h3>06 · 扫码访问</h3>
      <p>
        二维码指向当前网站的公开入口，不包含账号、会话或验证凭据。请确认手机可以访问这个地址。
      </p>
      {local && (
        <p className="field-note">
          当前是本机地址，其他设备无法通过此地址访问。请从手机可访问的服务域名打开网站后，再下载二维码。
        </p>
      )}
      {!connected && (
        <p className="field-note">
          当前入口尚未连接后端；二维码仅分享此入口，完整账号和预约功能需要可访问的完整服务。
        </p>
      )}
      <ErrorBox>{error}</ErrorBox>
      {image && (
        <div>
          <img
            src={image}
            width="240"
            height="240"
            alt="网站公开入口二维码"
            style={{ maxWidth: "100%", height: "auto" }}
          />
          <p>
            <a
              className="text-button"
              href={image}
              download="场地访问二维码.png"
            >
              下载访问二维码
            </a>
          </p>
        </div>
      )}
      <label>
        公开入口地址
        <input
          aria-label="公开入口地址"
          value={entry}
          readOnly
          onFocus={(event) => event.target.select()}
        />
      </label>
    </section>
  );
}
