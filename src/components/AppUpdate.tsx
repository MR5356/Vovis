import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download } from "lucide-react";
import { flushWorkspace } from "../infrastructure/desktop";
import { Button } from "./ui/button";
import { AppDialog } from "./AppDialog";

export function AppUpdate({ showCheck }: { showCheck: boolean }) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef(0);
  const current = useRef<Update | null>(null);

  async function checkVersion(manual: boolean) {
    const id = ++request.current;
    setChecking(true);
    setMessage("");
    try {
      const result = await check({ timeout: 12000 });
      if (request.current !== id) {
        await result?.close();
        return;
      }
      current.current = result;
      setUpdate(result);
      if (manual) {
        setOpen(true);
        if (!result) setMessage("当前已是最新版本。");
      }
    } catch (error) {
      if (manual && request.current === id) {
        setMessage(`无法检查更新：${String(error)}`);
        setOpen(true);
      }
    } finally {
      if (request.current === id) setChecking(false);
    }
  }

  useEffect(() => {
    void checkVersion(false);
    return () => {
      ++request.current;
      void current.current?.close();
    };
  }, []);

  async function install() {
    if (!update || installing) return;
    setInstalling(true);
    setMessage("正在下载更新…");
    try {
      await flushWorkspace();
      await update.downloadAndInstall((event) => {
        if (event.event === "Finished") setMessage("正在安装更新…");
      });
      await relaunch();
    } catch (error) {
      setMessage(`更新未完成：${String(error)}`);
      setInstalling(false);
    }
  }

  if (!update && !showCheck) return null;
  return (
    <>
      <Button
        variant="ghost"
        className="nav"
        disabled={checking}
        onClick={() => (update ? setOpen(true) : void checkVersion(true))}
      >
        <Download size={18} />
        {update
          ? `更新到 ${update.version}`
          : checking
            ? "正在检查更新…"
            : "检查更新"}
      </Button>
      <AppDialog
        open={open}
        onOpenChange={(value) => {
          if (!installing) setOpen(value);
        }}
        title="应用更新"
      >
        <h2>{update ? `更新到 Vovis ${update.version}` : "检查更新"}</h2>
        <div className="dialog-body">
          {update && (
            <p>当前版本 {update.currentVersion}，安装完成后将重新启动。</p>
          )}
          {message && <p role="status">{message}</p>}
        </div>
        {update && (
          <Button
            className="primary full"
            disabled={installing}
            onClick={() => void install()}
          >
            下载并安装
          </Button>
        )}
        <Button
          variant="outline"
          className="secondary full"
          disabled={installing}
          onClick={() => setOpen(false)}
        >
          关闭
        </Button>
      </AppDialog>
    </>
  );
}
