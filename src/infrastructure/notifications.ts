import { toast } from "sonner";

// All transient app notices update one shared toast, including across screens.
const NOTICE_ID = "vovis-current-notice";
export function notify(message: string, kind: "message" | "error" = "message") {
  if (!message) return;
  return toast[kind](message, { id: NOTICE_ID, duration: 3000 });
}
