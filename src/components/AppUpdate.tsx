import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download } from "lucide-react";
import { flushWorkspace, isDesktop } from "../infrastructure/desktop";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { AppDialog } from "./AppDialog";

const UpdateContext = createContext<{
  available: boolean;
  checking: boolean;
  checkManually: () => void;
  showUpdate: () => void;
} | null>(null);

export function UpdateNotice() {
  const state = useContext(UpdateContext);
  if (!state?.available) return null;
  return (
    <Button
      variant="ghost"
      className="nav"
      disabled={state.checking}
      onClick={state.showUpdate}
    >
      <Download size={18} />
      发现新版本
    </Button>
  );
}

export function UpdateSettings() {
  const state = useContext(UpdateContext);
  const [version, setVersion] = useState("");
  useEffect(() => {
    if (isDesktop) {
      void getVersion().then(setVersion).catch(() => setVersion("无法读取"));
    }
  }, []);
  if (!state) return null;
  return (
    <Card className="card update-settings">
      <div className="card-heading">
        <div>
          <h2>
            <Download size={20} />
            应用更新
          </h2>
          {version && <p className="muted">当前版本 {version}</p>}
        </div>
        <Button
          variant="outline"
          className="secondary"
          disabled={state.checking}
          onClick={state.checkManually}
        >
          {state.checking ? "正在检查更新…" : "检查更新"}
        </Button>
      </div>
    </Card>
  );
}

export function AppUpdateProvider({ children }: { children: ReactNode }) {
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
    const result = await check({ timeout: 12000 }).catch(() => null);
    if (request.current !== id) {
      await result?.close();
      return;
    }
    const previous = current.current;
    current.current = result;
    setUpdate(result);
    setChecking(false);
    if (manual) showUpdate();
    void previous?.close();
  }

  useEffect(() => {
    if (!isDesktop) return;
    void checkVersion(false);
    return () => {
      ++request.current;
      void current.current?.close();
      current.current = null;
    };
  }, []);

  function showUpdate() {
    setMessage("");
    setOpen(true);
  }

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

  if (!isDesktop) return children;
  return (
    <UpdateContext.Provider
      value={{
        available: !!update,
        checking,
        checkManually: () => void checkVersion(true),
        showUpdate,
      }}
    >
      {children}
      <AppDialog
        open={open}
        onOpenChange={(value) => {
          if (!installing) setOpen(value);
        }}
        title="应用更新"
      >
        <h2>{update ? `更新到 Vovis ${update.version}` : "检查更新"}</h2>
        <div className="dialog-body">
          <p>
            {update
              ? `当前版本 ${update.currentVersion}，安装完成后将重新启动。`
              : "暂无新版本。"}
          </p>
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
    </UpdateContext.Provider>
  );
}
