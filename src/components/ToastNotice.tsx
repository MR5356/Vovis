import { useEffect } from "react";
import { toast } from "sonner";
/** Bridge existing feature state to the single, app-wide shadcn/Sonner notification surface. */
export function ToastNotice({ message }: { message: string }) {
  useEffect(() => {
    if (message) toast(message);
  }, [message]);
  return null;
}
