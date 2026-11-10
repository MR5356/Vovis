import { SessionVideoExport } from "./components/SessionVideoExport";
import { ModelUsageSummary } from "./components/ModelUsageSummary";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { PageLayout } from "./components/PageLayout";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { ToastNotice } from "@/components/ToastNotice";
import { AppDialog } from "@/components/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { UpdateNotice } from "./components/AppUpdate";
import type { WorkspaceStore } from "./infrastructure/desktop";
import { useState, useEffect, useRef } from "react";
import {
  Presentation,
  FolderOpen,
  Layers,
  Plus,
  Search,
  ArrowRight,
  ChevronLeft,
  Play,
  Pause,
  Clock,
  Copy,
  Archive,
  FileText,
  MoreHorizontal,
  X,
  CheckCircle2,
  SkipForward,
  SkipBack,
  Volume2,
  Download,
  Settings,
} from "lucide-react";
import { ModelSettings, GlobalSettings } from "./global-panels";
import { SampleSlide } from "./slides";
import * as pdfjs from "pdfjs-dist";
import {
  uid,
  time,
  date,
  getPdf,
  getNarration,
  type Project,
  type Material,
  type SessionRecord,
} from "./storage";
import type {
  LibraryState,
  WorkspaceData,
  WorkspaceComponent,
  Slide,
} from "./domain/workspace";
function seed(defaults: WorkspaceData): LibraryState {
  let old;
  try {
    old = JSON.parse(localStorage.getItem("vovis-prototype") || "null");
  } catch {}
  const data = { ...defaults, ...old, confirmed: true };
  return {
    projects: [
      {
        id: "agent",
        data,
        updatedAt: new Date().toISOString(),
        archived: false,
      },
      {
        id: "release",
        data: {
          ...defaults,
          title: "研发平台 · 新版本发布",
          minutes: 15,
          page: 0,
          slides: [
            {
              title: "研发平台 · 新版本发布",
              kind: "cover",
              script:
                "欢迎参加本次版本发布，我们会介绍核心能力、使用场景和后续计划。",
            },
            {
              title: "面向团队的协作体验",
              script:
                "本次演示关注团队协作的完整流程。具体参数与上线计划，以经过确认的产品资料为准。",
            },
            {
              title: "感谢参与",
              kind: "end",
              script: "以上是本次版本发布的介绍，接下来欢迎提问。",
            },
          ],
          notes: "演示项目，请补充实际发布资料。",
          confirmed: true,
        },
        updatedAt: new Date().toISOString(),
        archived: false,
      },
    ],
    sessions: [
      {
        id: "example-session",
        projectId: "agent",
        title: "Agent 架构 · 完整彩排示例",
        startedAt: "2026-11-06T10:00:00+08:00",
        duration: 180,
        demo: true,
        mode: "示例彩排",
        slides: structuredClone(data.slides),
        events: [
          {
            id: "e1",
            at: 0,
            kind: "page",
            page: 0,
            title: "开场 · 从零理解 AI Agent 架构",
            text: data.slides[0].script,
          },
          {
            id: "e2",
            at: 30,
            kind: "page",
            page: 3,
            title: "第 4 页 · 核心组成与架构",
            text: data.slides[3]?.script || "",
          },
          {
            id: "e3",
            at: 65,
            kind: "page",
            page: 4,
            title: "第 5 页 · Agent 如何完成一次任务？",
            text: data.slides[4]?.script || "",
          },
          {
            id: "e4",
            at: 90,
            kind: "question",
            page: 4,
            title: "观众提问",
            text: "Agent 与普通工作流有什么区别？",
          },
          {
            id: "e5",
            at: 96,
            kind: "answer",
            page: 4,
            title: "主播回答",
            text: "工作流通常按照预设路径执行。Agent 会根据目标和工具的返回结果，动态决定下一步行动。实际系统也可以将两者结合使用。",
          },
          {
            id: "e6",
            at: 126,
            kind: "resume",
            page: 4,
            title: "回到第 5 页",
            text: "我们继续来看反馈迭代：执行之后，还需要检查结果与目标之间的差距。",
          },
          {
            id: "e7",
            at: 155,
            kind: "page",
            page: 8,
            title: "总结与问答",
            text: data.slides[8]?.script || "感谢参与，欢迎提问。",
          },
          {
            id: "e8",
            at: 180,
            kind: "end",
            page: 8,
            title: "彩排结束",
            text: "",
          },
        ],
      },
    ],
    materials: [
      {
        id: "terms",
        title: "通用技术术语表",
        content:
          "Agent：围绕目标自主推进任务的系统。\n工具调用：通过结构化接口执行查询或操作。\n上下文：模型当前可访问的信息。\n反馈迭代：根据执行结果修正下一步行动。",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "boundary",
        title: "团队分享表达规范",
        content:
          "优先解释术语，再说明原理。\n区分通用技术知识和项目事实。\n不推测未确认的性能指标、发布时间与商业承诺。",
        updatedAt: new Date().toISOString(),
      },
    ],
    connections: data.connections,
    bindings: data.bindings,
  };
}
export function Manager({
  Workspace,
  defaults,
  storage,
}: {
  Workspace: WorkspaceComponent;
  defaults: WorkspaceData;
  storage: WorkspaceStore;
}) {
  const [store, setStore] = useState<LibraryState>(
    () => storage.workspace ?? seed(defaults),
  );
  const initialStore = useRef(store);
  const [screen, setScreen] = useState("projects");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [replay, setReplay] = useState<SessionRecord | null>(null);
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [dialog, setDialog] = useState("");
  const [name, setName] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [editMaterial, setEditMaterial] = useState<Material | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (store === initialStore.current) return;
    void storage
      .save(store)
      .catch((reason) => setNote(`保存失败：${String(reason)}`));
  }, [store, storage]);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(""), 3500);
    return () => clearTimeout(t);
  }, [note]);
  const project = store.projects.find((p) => p.id === projectId);
  function saveData(data: WorkspaceData) {
    const { connections, bindings, ...projectData } = data;
    setStore((s) => ({
      ...s,
      projects: s.projects.map((p) =>
        p.id === projectId
          ? { ...p, data: projectData, updatedAt: new Date().toISOString() }
          : p,
      ),
    }));
  }
  function openProject(id: string) {
    setProjectId(id);
    setScreen("workspace");
  }
  function saveRecord(r: SessionRecord) {
    setStore((s) => ({
      ...s,
      sessions: s.sessions.some((session) => session.id === r.id)
        ? s.sessions.map((session) => (session.id === r.id ? r : session))
        : [r, ...s.sessions],
    }));
  }
  function exportProject(p: Project) {
    const payload = {
      version: 1,
      project: p,
      materials: store.materials.filter((m) =>
        p.data.materialIds.includes(m.id),
      ),
      note: "不包含密钥或 PDF 二进制；PDF 请另行备份。",
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = p.data.title + ".vovis.json";
    a.click();
    URL.revokeObjectURL(url);
    setNote("已导出项目文字与设置，不包含 PDF 和凭据");
  }
  if (screen === "workspace" && project)
    return (
      <Workspace
        key={project.id}
        projectId={project.id}
        initialData={{
          ...defaults,
          ...project.data,
          connections: store.connections,
          bindings: store.bindings,
        }}
        library={store.materials}
        feishuConfig={store.feishu}
        onGlobal={setScreen}
        onSave={saveData}
        onBack={() => {
          setScreen("projects");
          setSearch("");
        }}
        onRecord={saveRecord}
        onHistory={() => setScreen("history")}
        onOpenLibrary={(m: Material) => {
          setStore((s) => ({
            ...s,
            materials: [...s.materials, { ...m, id: uid() }],
          }));
          setNote("已复制到全局资料库");
        }}
      />
    );
  if (replay)
    return (
      <Replay
        record={store.sessions.find((s) => s.id === replay.id) ?? replay}
        onBack={() => setReplay(null)}
      />
    );
  const sessions = store.sessions.filter((s) => s.projectId === projectId);
  return (
    <div className="app-shell">
      <aside className="sidebar" data-tauri-drag-region>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setScreen("projects");
          }}
        >
          <span className="brand-mark">∨</span>Vovis
          <span className="brand-dot" />
        </a>
        <div className="workspace-label" data-tauri-drag-region>
          本地工作空间
        </div>
        <nav>
          <Button
            variant="ghost"
            className={
              ["projects", "history"].includes(screen) ? "nav active" : "nav"
            }
            onClick={() => {
              setScreen("projects");
              setSearch("");
            }}
          >
            <Presentation size={19} />
            演讲项目
            <span className="nav-count">
              {store.projects.filter((p) => !p.archived).length}
            </span>
          </Button>
          <Button
            variant="ghost"
            className={screen === "library" ? "nav active" : "nav"}
            onClick={() => setScreen("library")}
          >
            <FolderOpen size={19} />
            全局资料库
          </Button>
          <Button
            variant="ghost"
            className={screen === "models" ? "nav active" : "nav"}
            onClick={() => setScreen("models")}
          >
            <Layers size={19} />
            模型服务
          </Button>
        </nav>
        <div className="sidebar-drag-space" data-tauri-drag-region />
        <div className="side-bottom" data-tauri-drag-region>
          <UpdateNotice />
          <Button
            variant="ghost"
            className={screen === "settings" ? "nav active" : "nav"}
            onClick={() => setScreen("settings")}
          >
            <Settings size={19} />
            设置
          </Button>
        </div>
      </aside>
      <PageLayout
        header={
          <>
            <div data-tauri-drag-region>
              <div className="breadcrumb">
                工作空间 <ArrowRight size={11} />
                {screen === "models"
                  ? "模型服务"
                  : screen === "settings"
                    ? "设置"
                    : screen === "history"
                      ? "演讲记录"
                      : screen === "library"
                        ? "全局资料库"
                        : "演讲项目"}
              </div>
              <h1 data-tauri-drag-region>
                {screen === "models"
                  ? "模型服务"
                  : screen === "settings"
                    ? "设置"
                    : screen === "history"
                      ? project?.data.title
                      : screen === "library"
                        ? "让知识，在分享中积累。"
                        : "下一次分享，从这里开始。"}
              </h1>
              <div className="subtitle">
                {screen === "models"
                  ? "连接配置与默认模型适用于所有演讲项目。"
                  : screen === "settings"
                    ? "配置全局集成。"
                    : screen === "history"
                      ? "每次彩排与主讲，都是一份独立记录。"
                      : screen === "library"
                        ? "跨项目复用资料；具体演讲在项目内引用。"
                        : `${store.projects.filter((p) => !p.archived).length} 个演讲项目 · 准备好，让知识自然传递。`}
              </div>
            </div>
            <div className="header-actions">
              {screen === "projects" ? (
                <Button
                  variant="default"
                  className="primary"
                  onClick={() => setDialog("new")}
                >
                  <Plus size={17} />
                  新建演讲
                </Button>
              ) : screen === "library" ? (
                <Button
                  variant="default"
                  className="primary"
                  onClick={() =>
                    setEditMaterial({
                      id: uid(),
                      title: "",
                      content: "",
                      updatedAt: new Date().toISOString(),
                    })
                  }
                >
                  <Plus size={16} />
                  添加全局资料
                </Button>
              ) : projectId ? (
                <Button
                  variant="outline"
                  className="secondary"
                  onClick={() => openProject(projectId!)}
                >
                  <ChevronLeft size={16} />
                  返回项目
                </Button>
              ) : null}
            </div>
          </>
        }
        toolbar={
          screen === "projects" && (
            <div className="project-toolbar">
              <div className="filter-pills">
                <Button
                  variant="ghost"
                  className={!archived ? "selected" : ""}
                  onClick={() => setArchived(false)}
                >
                  全部项目
                </Button>
                <Button
                  variant="ghost"
                  className={archived ? "selected" : ""}
                  onClick={() => setArchived(true)}
                >
                  已归档
                </Button>
              </div>
              <div className="search-field">
                <Search size={15} />
                <Input
                  aria-label="搜索项目"
                  placeholder="搜索演讲项目…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          )
        }
        aboveFooter={
          screen === "projects" && (
            <div className="library-callout card">
              <span className="tinted-icon">
                <FolderOpen size={23} />
              </span>
              <div>
                <h3>好资料，可以用在不止一次分享。</h3>
                <p>把通用术语、团队规范放入全局资料库，在不同项目中引用。</p>
              </div>
              <Button
                variant="ghost"
                className="text-btn"
                onClick={() => setScreen("library")}
              >
                打开资料库
                <ArrowRight size={14} />
              </Button>
            </div>
          )
        }
      >
        {screen === "models" ? (
          <ModelSettings
            connections={store.connections}
            bindings={store.bindings}
            onChange={(p) => setStore((s) => ({ ...s, ...p }))}
          />
        ) : screen === "settings" ? (
          <GlobalSettings
            feishu={store.feishu}
            onSave={(feishu) => setStore((s) => ({ ...s, feishu }))}
          />
        ) : screen === "projects" ? (
          <>
            <div className="projects-grid">
              {store.projects
                .filter(
                  (p) =>
                    p.archived === archived &&
                    p.data.title.toLowerCase().includes(search.toLowerCase()),
                )
                .map((p, i) => {
                  const records = store.sessions.filter(
                    (s) => s.projectId === p.id,
                  );
                  return (
                    <Card className="card project-card" key={p.id}>
                      <Button
                        variant="ghost"
                        className={"project-cover cover-" + (i % 3)}
                        onClick={() => openProject(p.id)}
                      >
                        <span className="eyebrow">VOVIS / PRESENTATION</span>
                        <h2>{p.data.title}</h2>
                        <div className="cover-art">
                          <span />
                          <span />
                          <span />
                          <i />
                        </div>
                        <span>
                          {p.data.slides.length} 页幻灯片{" "}
                          <ArrowRight size={15} />
                        </span>
                      </Button>
                      <div className="project-info">
                        <div className="project-title">
                          <h3>
                            <Button
                              variant="ghost"
                              onClick={() => openProject(p.id)}
                            >
                              {p.data.title}
                            </Button>
                          </h3>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                className="icon-btn"
                                aria-label={`项目操作：${p.data.title}`}
                              >
                                <MoreHorizontal size={19} />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={() => {
                                  setTarget(p.id);
                                  setName(p.data.title);
                                  setDialog("rename");
                                }}
                              >
                                <FileText size={14} />
                                重命名
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  setStore((s) => ({
                                    ...s,
                                    projects: [
                                      ...s.projects,
                                      {
                                        ...structuredClone(p),
                                        id: uid(),
                                        data: {
                                          ...structuredClone(p.data),
                                          title: p.data.title + " · 副本",
                                        },
                                        updatedAt: new Date().toISOString(),
                                        archived: false,
                                      },
                                    ],
                                  }));
                                }}
                              >
                                <Copy size={14} />
                                复制项目
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => exportProject(p)}
                              >
                                <Download size={14} />
                                导出文字与设置
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  setStore((s) => ({
                                    ...s,
                                    projects: s.projects.map((x) =>
                                      x.id === p.id
                                        ? { ...x, archived: !x.archived }
                                        : x,
                                    ),
                                  }));
                                }}
                              >
                                <Archive size={14} />
                                {p.archived ? "恢复项目" : "归档项目"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <p>
                          <Clock size={12} />
                          {p.data.minutes} 分钟<span>·</span>
                          {p.data.audience}
                        </p>
                        <div className="project-bottom">
                          <Badge
                            variant="secondary"
                            className={
                              "status-chip " +
                              (p.data.slides.every((s: Slide) =>
                                s.script.trim(),
                              )
                                ? "mint"
                                : "lavender")
                            }
                          >
                            {p.data.slides.every((s: Slide) => s.script.trim())
                              ? "讲稿已准备"
                              : "准备中"}
                          </Badge>
                          <Button
                            variant="ghost"
                            className="text-btn"
                            onClick={() => {
                              setProjectId(p.id);
                              setScreen("history");
                            }}
                          >
                            {records.length} 场演讲记录
                            <ArrowRight size={12} />
                          </Button>
                        </div>
                        <small>最近编辑 {date(p.updatedAt)}</small>
                      </div>
                    </Card>
                  );
                })}
              {!archived && !search && (
                <Button
                  variant="ghost"
                  className="new-project-card"
                  onClick={() => setDialog("new")}
                >
                  <span>
                    <Plus size={24} />
                  </span>
                  <strong>开始一个新演讲</strong>
                  <p>导入 PDF，整理你的下一次分享</p>
                </Button>
              )}
            </div>
            {store.projects.filter(
              (p) =>
                p.archived === archived &&
                p.data.title.toLowerCase().includes(search.toLowerCase()),
            ).length === 0 && (
              <div className="empty-state">
                <FolderOpen size={34} />
                <h3>{search ? "没有找到相关项目" : "这里还没有项目"}</h3>
                <p>试试其他关键词，或创建一个新演讲。</p>
              </div>
            )}
          </>
        ) : screen === "history" ? (
          <>
            <div className="section-top">
              <div>
                <h2>
                  演讲记录{" "}
                  <Badge variant="secondary" className="status-chip lavender">
                    {sessions.length} 场
                  </Badge>
                </h2>
                <p>回放保留当时的内容，后续修改项目不会影响历史记录。</p>
              </div>
            </div>
            <div className="notice">
              <Volume2 size={16} />
              回放范围：幻灯片、主播声音、讲解文字与问答事件。不保存观众原声或完整会议录像。无音轨的记录仅回放画面与事件。
            </div>
            <div className="session-list">
              {sessions.map((r) => (
                <Card className="card session-card" key={r.id}>
                  <div className="session-thumbnail">
                    <Presentation size={27} />
                    <span>{r.mode}</span>
                  </div>
                  <div className="session-info">
                    <h3>{r.title}</h3>
                    <p>
                      {date(r.startedAt)}
                      <span>·</span>
                      {time(r.duration)}
                      <span>·</span>
                      {
                        new Set(
                          r.events
                            .filter((e) => e.kind === "page")
                            .map((e) => e.page),
                        ).size
                      }{" "}
                      页到达
                    </p>
                    <div>
                      <Badge
                        variant="secondary"
                        className="status-chip lavender"
                      >
                        {r.demo ? "模拟记录" : "本机主讲"}
                      </Badge>
                      <span className="muted">
                        {r.events.filter((e) => e.kind === "question").length}{" "}
                        个提问 · {r.events.length} 个事件
                      </span>
                    </div>
                  </div>
                  <SessionVideoExport record={r} />
                  <Button
                    variant="secondary"
                    className="soft-primary"
                    onClick={() => setReplay(r)}
                  >
                    <Play size={15} />
                    查看回放
                  </Button>
                </Card>
              ))}
            </div>
            {!sessions.length && (
              <div className="empty-state">
                <Clock size={35} />
                <h3>第一场分享，等待发生。</h3>
                <p>完成一次模拟主讲后，记录会出现在这里。</p>
                <Button
                  variant="default"
                  className="primary"
                  onClick={() => openProject(projectId!)}
                >
                  前往准备
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="section-top">
              <div>
                <h2>全局资料</h2>
                <p>
                  适合长期复用的术语、规范和背景知识。项目专属内容在项目内管理。
                </p>
              </div>
            </div>
            <div className="material-grid">
              {store.materials.map((m) => (
                <Card className="card material-card" key={m.id}>
                  <div className="material-head">
                    <span className="tinted-icon">
                      <FileText size={18} />
                    </span>
                    <h3>{m.title}</h3>
                  </div>
                  <p>{m.content || "暂无正文"}</p>
                  <div className="material-footer">
                    <small>
                      {
                        store.projects.filter((p) =>
                          p.data.materialIds?.includes(m.id),
                        ).length
                      }{" "}
                      个项目引用 · {date(m.updatedAt)}
                    </small>
                    <Button
                      variant="ghost"
                      className="text-btn"
                      onClick={() => setEditMaterial(m)}
                    >
                      编辑资料
                      <ArrowRight size={13} />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
            <div className="notice">
              <CheckCircle2 size={16} />
              编辑后，引用该资料的项目使用最新内容；已经结束的演讲保留当时内容的快照。
            </div>
          </>
        )}
      </PageLayout>
      <ToastNotice message={note} />
      {dialog === "new" && (
        <NewProjectDialog
          onClose={() => setDialog("")}
          onCreate={(title, pdf) => {
            const project: Project = {
              id: uid(),
              data: {
                ...structuredClone(defaults),
                title,
                page: 0,
                pdfAssetId: "",
                pdfName: "",
                slides: [{ title: "导入你的第一份 PDF", script: "" }],
                ...pdf,
                notes: "",
                confirmed: false,
              },
              updatedAt: new Date().toISOString(),
              archived: false,
            };
            setStore((s) => ({ ...s, projects: [project, ...s.projects] }));
            setDialog("");
            openProject(project.id);
          }}
        />
      )}
      {dialog === "rename" && (
        <AppDialog
          open
          title="重命名项目"
          onOpenChange={(open) => {
            if (!open) {
              setDialog("");
            }
          }}
        >
          <Button
            variant="ghost"
            className="modal-close icon-btn"
            aria-label="关闭"
            onClick={() => setDialog("")}
          >
            <X size={19} />
          </Button>
          <span className="eyebrow">A NEW STORY TO TELL</span>
          <h2>重命名演讲项目</h2>
          <div className="dialog-body">
            <Label>
              演讲名称
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="给你的分享起个名字"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setDialog("");
                }}
              />
            </Label>
            <p className="muted">历史演讲记录保留当时的名称。</p>
          </div>
          <Button
            variant="default"
            className="primary full"
            disabled={!name.trim()}
            onClick={() => {
              setStore((s) => ({
                ...s,
                projects: s.projects.map((p) =>
                  p.id === target
                    ? {
                        ...p,
                        data: { ...p.data, title: name.trim() },
                        updatedAt: new Date().toISOString(),
                      }
                    : p,
                ),
              }));
              setDialog("");
            }}
          >
            保存名称
            <ArrowRight size={15} />
          </Button>
        </AppDialog>
      )}
      {editMaterial && (
        <AppDialog
          open
          className="material-dialog"
          title="编辑全局资料"
          onOpenChange={(open) => {
            if (!open) {
              setEditMaterial(null);
            }
          }}
        >
          <Button
            variant="ghost"
            className="modal-close icon-btn"
            aria-label="关闭"
            onClick={() => setEditMaterial(null)}
          >
            <X />
          </Button>
          <h2>全局资料</h2>
          <div className="dialog-body">
            <Label>
              资料标题
              <Input
                value={editMaterial.title}
                onChange={(e) =>
                  setEditMaterial({ ...editMaterial, title: e.target.value })
                }
              />
            </Label>
            <Label>
              正文
              <Textarea
                className="material-editor"
                value={editMaterial.content}
                onChange={(e) =>
                  setEditMaterial({ ...editMaterial, content: e.target.value })
                }
              />
            </Label>
            <p className="muted">
              更新会作用于引用项目，历史回放保持原有快照。
            </p>
          </div>
          <Button
            variant="default"
            className="primary full"
            disabled={!editMaterial.title.trim()}
            onClick={() => {
              setStore((s) => ({
                ...s,
                materials: [
                  ...s.materials.filter((m) => m.id !== editMaterial.id),
                  { ...editMaterial, updatedAt: new Date().toISOString() },
                ],
              }));
              setEditMaterial(null);
            }}
          >
            保存资料
          </Button>
        </AppDialog>
      )}
    </div>
  );
}
function Replay({
  record,
  onBack,
}: {
  record: SessionRecord;
  onBack: () => void;
}) {
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [filter, setFilter] = useState("all");
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pdfError, setPdfError] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState<string>();
  const [audioStatus, setAudioStatus] = useState("正在读取主播音轨");
  useEffect(() => {
    let active = true;
    let url: string | undefined;
    getNarration(record.id)
      .then((blob) => {
        if (!active) return;
        if (blob) {
          url = URL.createObjectURL(blob);
          setAudioUrl(url);
        } else setAudioStatus("本场无主播音轨");
      })
      .catch(() => {
        if (active) setAudioStatus("主播音轨读取失败");
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [record.id]);
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed, audioUrl]);
  const events = record.events;
  const current = events.filter((e) => e.at <= position).at(-1) || events[0];
  const page = current?.page || 0;
  const slide = record.slides[page];
  const spoken = events
    .filter(
      (e) => e.at <= position && ["page", "answer", "resume"].includes(e.kind),
    )
    .at(-1);
  const markerIndex = events.findIndex((e) => e.id === current?.id);
  useEffect(() => {
    let alive = true;
    if (record.pdfAssetId)
      getPdf(record.pdfAssetId)
        .then(async (blob) => {
          if (!blob) {
            if (alive) setPdfError(true);
            return;
          }
          const doc = await pdfjs.getDocument({
            data: await blob.arrayBuffer(),
          }).promise;
          if (alive) setPdf(doc);
        })
        .catch(() => setPdfError(true));
    return () => {
      alive = false;
    };
  }, [record.id]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let stop = false;
    let task: pdfjs.RenderTask | undefined;
    pdf
      .getPage(page + 1)
      .then((p) => {
        if (stop || !canvas.current) return;
        const v = p.getViewport({ scale: 1.4 });
        canvas.current.width = v.width;
        canvas.current.height = v.height;
        task = p.render({
          viewport: v,
          canvasContext: canvas.current.getContext("2d")!,
        });
        return task.promise;
      })
      .catch(() => {});
    return () => {
      stop = true;
      task?.cancel();
    };
  }, [pdf, page]);
  useEffect(() => {
    if (!playing || audioUrl) return;
    const t = setInterval(
      () => setPosition((p) => Math.min(record.duration, p + 0.25 * speed)),
      250,
    );
    return () => clearInterval(t);
  }, [playing, speed, record.duration, audioUrl]);
  useEffect(() => {
    if (position >= record.duration) setPlaying(false);
  }, [position, record.duration]);
  function seek(n: number) {
    const next = Math.max(0, Math.min(record.duration, n));
    if (audio.current?.readyState) audio.current.currentTime = next;
    setPosition(next);
  }
  return (
    <div className="replay-shell">
      {audioUrl && (
        <audio
          ref={audio}
          src={audioUrl}
          onTimeUpdate={(event) =>
            setPosition(
              Math.min(record.duration, event.currentTarget.currentTime),
            )
          }
          onEnded={() => {
            setPosition(record.duration);
            setPlaying(false);
          }}
          onError={() => {
            setPlaying(false);
            setAudioUrl(undefined);
            setAudioStatus("主播音轨无法播放");
          }}
        />
      )}
      <header data-tauri-drag-region>
        <div>
          <Button variant="ghost" className="text-btn" onClick={onBack}>
            <ChevronLeft size={15} />
            返回演讲记录
          </Button>
          <h1 data-tauri-drag-region>{record.title}</h1>
          <div className="subtitle">
            {date(record.startedAt)}
            <i />
            历史内容快照
            <i />
            {record.mode}
          </div>
        </div>
        <SessionVideoExport record={record} />
        <Badge variant="secondary" className="status-chip lavender">
          {audioUrl ? "音频与事件回放" : "事件回放"}
        </Badge>
      </header>
      <div className="replay-layout">
        <section className="replay-main">
          <Card className="card replay-stage">
            <div className="card-heading">
              <h2>
                <Presentation size={18} />
                当时的演示画面
              </h2>
              <Badge variant="secondary" className="status-chip">
                第 {page + 1} / {record.slides.length} 页
              </Badge>
            </div>
            <div className="replay-slide">
              {pdf ? (
                <canvas ref={canvas} />
              ) : (
                <>
                  {pdfError ? (
                    <p>历史 PDF 暂不可用，仍可查看文字和事件记录。</p>
                  ) : (
                    <SampleSlide
                      slide={slide || { title: "演讲结束" }}
                      page={page}
                      deckTitle={record.title}
                    />
                  )}
                </>
              )}
            </div>
            <div className="playback-controls">
              <div className="seek-track">
                <Slider
                  aria-label="回放进度"
                  min={0}
                  max={record.duration}
                  step={0.1}
                  value={[position]}
                  onValueChange={([value]) => seek(value)}
                />
                <div className="event-markers">
                  {events
                    .filter((e) => e.kind === "question")
                    .map((e) => (
                      <Button
                        variant="ghost"
                        key={e.id}
                        title={`${time(e.at)} 观众提问`}
                        style={{ left: (e.at / record.duration) * 100 + "%" }}
                        onClick={() => seek(e.at)}
                      />
                    ))}
                </div>
              </div>
              <div className="playback-toolbar">
                <div>
                  <Button
                    variant="ghost"
                    className="round-btn"
                    aria-label="上一个事件"
                    onClick={() =>
                      seek(events[Math.max(0, markerIndex - 1)]?.at || 0)
                    }
                  >
                    <SkipBack size={16} />
                  </Button>
                  <Button
                    variant="default"
                    className="primary play-circle"
                    aria-label={playing ? "暂停回放" : "播放回放"}
                    disabled={!audioUrl && audioStatus === "正在读取主播音轨"}
                    onClick={() => {
                      if (position >= record.duration) seek(0);
                      if (playing) {
                        audio.current?.pause();
                        setPlaying(false);
                      } else if (audio.current) {
                        void audio.current
                          .play()
                          .then(() => setPlaying(true))
                          .catch(() => setAudioStatus("主播音轨无法播放"));
                      } else setPlaying(true);
                    }}
                  >
                    {playing ? <Pause size={18} /> : <Play size={18} />}
                  </Button>
                  <Button
                    variant="ghost"
                    className="round-btn"
                    aria-label="下一个事件"
                    onClick={() =>
                      seek(
                        events[Math.min(events.length - 1, markerIndex + 1)]
                          ?.at || record.duration,
                      )
                    }
                  >
                    <SkipForward size={16} />
                  </Button>
                  <span>
                    {time(position)} <em>/ {time(record.duration)}</em>
                  </span>
                </div>
                <div>
                  <span className="audio-unavailable">
                    <Volume2 size={14} />
                    {audioUrl && audioStatus === "正在读取主播音轨"
                      ? "主播音轨"
                      : audioStatus}
                  </span>
                  <NativeSelect
                    aria-label="回放速度"
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                  >
                    <NativeSelectOption value=".5">0.5 ×</NativeSelectOption>
                    <NativeSelectOption value="1">1.0 ×</NativeSelectOption>
                    <NativeSelectOption value="1.5">1.5 ×</NativeSelectOption>
                    <NativeSelectOption value="2">2.0 ×</NativeSelectOption>
                  </NativeSelect>
                </div>
              </div>
            </div>
          </Card>
          <Card className="card transcript-card">
            <div className="card-heading">
              <h2>
                <FileText size={17} />
                {spoken?.kind === "answer" ? "主播回答" : "讲解文字"}
              </h2>
              <span className="muted">{spoken ? time(spoken.at) : "0:00"}</span>
            </div>
            <p>{spoken?.text || "本场暂无讲解文字"}</p>
            <ModelUsageSummary rows={record.modelUsage} demo={record.demo} />
          </Card>
        </section>
        <aside className="card timeline-panel">
          <div className="card-heading">
            <h2>
              <Clock size={17} />
              演讲时间轴
            </h2>
            <Badge variant="secondary" className="status-chip lavender">
              {events.length} 个事件
            </Badge>
          </div>
          <div className="filter-pills">
            <Button
              variant="ghost"
              className={filter === "all" ? "selected" : ""}
              onClick={() => setFilter("all")}
            >
              全部
            </Button>
            <Button
              variant="ghost"
              className={filter === "qa" ? "selected" : ""}
              onClick={() => setFilter("qa")}
            >
              问答
            </Button>
            <Button
              variant="ghost"
              className={filter === "page" ? "selected" : ""}
              onClick={() => setFilter("page")}
            >
              翻页
            </Button>
          </div>
          <div className="timeline-list">
            {events
              .filter(
                (e) =>
                  filter === "all" ||
                  (filter === "qa" &&
                    ["question", "answer"].includes(e.kind)) ||
                  (filter === "page" && e.kind === "page"),
              )
              .map((e) => (
                <Button
                  variant="ghost"
                  key={e.id}
                  className={
                    "timeline-event " +
                    (e.id === current?.id ? "selected" : "") +
                    (e.kind === "question" ? " question-event" : "")
                  }
                  onClick={() => seek(e.at)}
                >
                  <span className="event-time">{time(e.at)}</span>
                  <span className="event-line">
                    <i />
                  </span>
                  <div>
                    <strong>{e.title}</strong>
                    {e.text && (
                      <p>
                        {e.text.slice(0, 72)}
                        {e.text.length > 72 ? "…" : ""}
                      </p>
                    )}
                  </div>
                </Button>
              ))}
          </div>
          <div className="timeline-privacy">
            <CheckCircle2 size={14} />
            <span>
              无观众原声 · 无会议录像
              <br />
              仅保存主讲内容与文字事件
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
