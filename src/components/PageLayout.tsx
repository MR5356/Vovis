import type { ReactNode } from "react";

export function PageLayout({
  className = "",
  header,
  toolbar,
  aboveFooter,
  children,
}: {
  className?: string;
  header: ReactNode;
  toolbar?: ReactNode;
  aboveFooter?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className={`main ${className}`}>
      <header data-tauri-drag-region>{header}</header>
      {toolbar}
      <div className="page-body">{children}</div>
      {aboveFooter}
      <footer className="app-footer">
        <span>Vovis · 让知识，自然传递。</span>
        <span>
          本地工作空间
          <span className="mint-dot" />
        </span>
      </footer>
    </main>
  );
}
