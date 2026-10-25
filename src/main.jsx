import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./fonts.css";
import "./app.css";
import "./typography.css";
import { showcaseEnabled } from "./showcase/gate.js";
const root = createRoot(document.getElementById("root"));
// TEMPORARY_PAGES_SHOWCASE: normal builds do not load the preview adapter/UI.
if (import.meta.env.MODE === "pages" && showcaseEnabled) {
  root.render(<p role="status">正在准备阶段成果演示…</p>);
  import("./showcase/Showcase.jsx")
    .then(({ default: Showcase }) => root.render(<Showcase App={App} />))
    .catch(() =>
      root.render(<p role="alert">演示资源加载失败，请刷新页面重试。</p>),
    );
} else root.render(<App />);
