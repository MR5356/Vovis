import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
/** App-wide composition; focus management, Escape and outside dismissal are owned by Radix. */
export function AppDialog({
  open,
  onOpenChange,
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={className ? `modal ${className}` : "modal"} showCloseButton={false}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          完成编辑后保存，或关闭返回工作台。
        </DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}
