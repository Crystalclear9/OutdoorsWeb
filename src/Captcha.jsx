import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { api } from "./api.js";

let captchaQueue = Promise.resolve();
function readCaptcha(isCurrent) {
  // Every reader shares the browser-binding cookie. Wait for an in-flight
  // response to install its cookie before another hook issues a new challenge.
  // JSON generation guards alone cannot undo a late Set-Cookie header.
  const pending = captchaQueue.then(() =>
    isCurrent() ? api("/auth/captcha", { cache: "no-store" }) : null,
  );
  captchaQueue = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

export function useCaptcha() {
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    setBusy(true);
    setChallenge(null);
    setCode("");
    setError("");
    setExpired(false);
    setLoaded(false);
    try {
      const next = await readCaptcha(() => request === sequence.current);
      // A late response must never replace the image for a newer request.
      if (request === sequence.current) setChallenge(next);
    } catch {
      if (request === sequence.current) setError("验证码加载失败，请重试");
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    refresh();
    return () => {
      sequence.current++;
    };
  }, [refresh]);
  useEffect(() => {
    if (!challenge) return;
    const checkExpiry = () => {
      if (Date.now() >= challenge.expires) {
        setExpired(true);
        setCode("");
      }
    };
    const timer = setTimeout(
      checkExpiry,
      Math.max(0, challenge.expires - Date.now()),
    );
    // Background tabs can suspend timers; recheck when the user returns.
    document.addEventListener("visibilitychange", checkExpiry);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", checkExpiry);
    };
  }, [challenge]);
  return {
    challenge,
    code,
    setCode,
    busy,
    error,
    expired,
    refresh,
    ready: !!challenge && loaded && !busy && !expired && !error,
    imageLoaded: () => setLoaded(true),
    imageFailed: () => {
      setLoaded(false);
      setError("验证码图片未能显示，请重试");
    },
  };
}

export default function CaptchaField({
  captcha,
  disabled = false,
  sms = false,
}) {
  const id = useId();
  const input = useRef(null);
  const focusAfterRefresh = useRef(false);
  useEffect(() => {
    if (captcha.ready && !disabled && focusAfterRefresh.current) {
      input.current?.focus();
      focusAfterRefresh.current = false;
    }
  }, [captcha.ready, disabled]);
  const refresh = () => {
    focusAfterRefresh.current = true;
    captcha.refresh();
  };
  return (
    <div className="captcha-field" aria-busy={captcha.busy}>
      <div className="captcha-label-row">
        <label htmlFor={id}>图片验证码</label>
        <button
          type="button"
          className="captcha-refresh"
          disabled={disabled || captcha.busy}
          onClick={refresh}
        >
          <ArrowClockwise size={16} aria-hidden="true" />
          {captcha.busy ? "正在换图…" : captcha.error ? "重新加载" : "换一张"}
        </button>
      </div>
      <div className="captcha-row">
        <input
          ref={input}
          id={id}
          name="captcha"
          value={captcha.code}
          required
          minLength={6}
          maxLength={6}
          autoComplete="off"
          spellCheck={false}
          inputMode="numeric"
          pattern="[0-9]{6}"
          placeholder="6 位数字"
          aria-describedby={`${id}-hint`}
          disabled={disabled || !captcha.ready}
          onChange={(e) =>
            captcha.setCode(
              e.target.value
                .replace(/[０-９]/g, (c) =>
                  String.fromCharCode(c.charCodeAt(0) - 0xfee0),
                )
                .replace(/[^0-9]/g, "")
                .slice(0, 6),
            )
          }
        />
        <button
          type="button"
          className="captcha-image"
          aria-label={sms ? "刷新短信图片验证码" : "刷新图片验证码"}
          disabled={disabled || captcha.busy}
          onClick={refresh}
        >
          {captcha.challenge && !captcha.error ? (
            <img
              key={captcha.challenge.id}
              src={captcha.challenge.image}
              alt={
                sms
                  ? "短信发送前的图片验证码"
                  : "图片验证码，请输入图中六位数字"
              }
              onLoad={captcha.imageLoaded}
              onError={captcha.imageFailed}
            />
          ) : (
            <span>{captcha.busy ? "正在生成…" : "点击重新加载"}</span>
          )}
        </button>
      </div>
      <small id={`${id}-hint`} role="status" aria-live="polite">
        {captcha.error ||
          (captcha.expired
            ? "验证码已过期，请换一张"
            : captcha.busy
              ? "正在加载新验证码"
              : "输入图中数字 · 看不清可换一张")}
      </small>
    </div>
  );
}
