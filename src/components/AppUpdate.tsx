import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download } from "lucide-react";
import { flushWorkspace, isDesktop } from "../infrastructure/desktop";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { AppDialog } from "./AppDialog";
import {
  checkForUpdate,
  formatDownloadSize,
  updateDownloadProgress,
  updateProgressPercent,
  type UpdateProgress,
} from "../infrastructure/appUpdate";
import "./AppUpdate.css";

const UpdateContext = createContext<{
  available: boolean;
  checking: boolean;
  error: string;
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
      void getVersion()
        .then(setVersion)
        .catch(() => setVersion("无法读取"));
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
      {state.error && (
        <p className="update-error" role="alert">
          {state.error}
        </p>
      )}
    </Card>
  );
}

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState("");
  const [checkError, setCheckError] = useState("");
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const request = useRef(0);
  const current = useRef<Update | null>(null);
  const installingRef = useRef(false);

  async function checkVersion(manual: boolean) {
    if (installingRef.current) return;
    const id = ++request.current;
    setChecking(true);
    setCheckError("");
    setMessage("");
    setProgress(null);
    if (manual) setOpen(true);
    try {
      const result = await checkForUpdate();
      if (request.current !== id) {
        void result?.close().catch(() => {});
        return;
      }
      const previous = current.current;
      current.current = result;
      setUpdate(result);
      if (result) setOpen(true);
      void previous?.close().catch(() => {});
    } catch (error) {
      if (request.current === id) {
        setCheckError(
          `检查更新失败，尚未确认是否有新版本。请检查 GitHub 访问或系统代理后重试。错误：${String(error)}`,
        );
      }
    } finally {
      if (request.current === id) setChecking(false);
    }
  }

  useEffect(() => {
    if (!isDesktop) return;
    void checkVersion(false);
    return () => {
      ++request.current;
      void current.current?.close().catch(() => {});
      current.current = null;
    };
  }, []);

  function showUpdate() {
    setOpen(true);
  }

  async function install() {
    if (!update || installingRef.current || checking) return;
    installingRef.current = true;
    setInstalling(true);
    setProgress({ downloaded: 0, finished: false });
    setMessage("正在下载更新…");
    try {
      await flushWorkspace();
      await update.downloadAndInstall(
        (event) => {
          setProgress((value) =>
            updateDownloadProgress(
              value ?? { downloaded: 0, finished: false },
              event,
            ),
          );
          if (event.event === "Finished") setMessage("正在安装更新…");
        },
        { timeout: 15 * 60 * 1000 },
      );
      await relaunch();
    } catch (error) {
      setMessage(`更新未完成：${String(error)}`);
      setProgress(null);
      setInstalling(false);
      installingRef.current = false;
    }
  }

  if (!isDesktop) return children;
  return (
    <UpdateContext.Provider
      value={{
        available: !!update,
        checking,
        error: checkError,
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
            {checking
              ? "正在检查更新…"
              : update
                ? `当前版本 ${update.currentVersion}，安装完成后将重新启动。`
                : checkError
                  ? "无法完成版本检查。"
                  : "当前已是最新版本。"}
          </p>
          {checkError && (
            <p className="update-error" role="alert">
              {checkError}
            </p>
          )}
          {update && (
            <section className="update-release-notes">
              <h3>更新日志</h3>
              <p>{update.body?.trim() || "此版本未提供更新日志。"}</p>
            </section>
          )}
          {message && <p role="status">{message}</p>}
          {progress && (
            <div className="update-download">
              <progress
                aria-label="更新下载进度"
                max={100}
                value={updateProgressPercent(progress)}
              />
              <span role="status">
                {progress.finished
                  ? "下载完成"
                  : `已下载 ${formatDownloadSize(progress.downloaded)}`}
                {!progress.finished &&
                  progress.total &&
                  ` / ${formatDownloadSize(progress.total)}（${updateProgressPercent(progress)}%）`}
              </span>
            </div>
          )}
        </div>
        {update && (
          <Button
            className="primary full"
            disabled={installing || checking}
            onClick={() => void install()}
          >
            {installing ? "正在更新…" : "下载并安装"}
          </Button>
        )}
        {checkError && (
          <Button
            variant="outline"
            className="secondary full"
            disabled={checking || installing}
            onClick={() => void checkVersion(true)}
          >
            重新检查
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
