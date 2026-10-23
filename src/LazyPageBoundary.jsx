import React from "react";
import { Button, ErrorBox } from "./components.jsx";

// React.lazy caches rejected imports. A manual page reload fetches the current
// release's entry point; retrying the same lazy component cannot recover it.
export default class LazyPageBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="card" aria-label="办理模块加载异常">
        <ErrorBox>办理界面暂时无法加载，可能是版本已更新或网络异常。</ErrorBox>
        <p>请检查网络后刷新重试。刷新会清除当前页面未提交的内容。</p>
        <Button className="secondary" onClick={() => window.location.reload()}>
          刷新页面后重试
        </Button>
      </section>
    );
  }
}
