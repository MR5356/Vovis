import { Button } from "@/components/ui/button";
import { Component, type ReactNode } from "react";
/** Keep the storage intact when rendering fails. Never reset a workspace to recover UI. */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="startup-error" role="alert">
        <h1>工作台暂时无法显示</h1>
        <p>已保存的数据仍保留在本机。请重新打开窗口。</p>
        <Button
          variant="default"
          className="primary"
          onClick={() => location.reload()}
        >
          重新加载
        </Button>
      </main>
    ) : (
      this.props.children
    );
  }
}
