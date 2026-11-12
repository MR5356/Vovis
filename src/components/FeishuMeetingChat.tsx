import { useFeishuLogin } from "@/hooks/useFeishuLogin";
import { cancelFeishuRead } from "../infrastructure/desktop";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Settings, RefreshCw, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

interface Meeting {
  meeting_id: string;
  meeting_no: string;
  meeting_title: string;
}

interface Message {
  source: "会中聊天";
  meeting_id: string;
  event_id: string;
  message_id: string;
  speaker_id: string;
  speaker_name: string;
  text: string;
  timestamp: number;
}

interface Batch {
  messages: Message[];
  ended: boolean;
  event_count: number;
}

export function FeishuMeetingChat({
  appId,
  readGroup,
  rehearsal = false,
  initialMeetingId = "",
  onOpenSettings,
  onMeetingReady,
  onMeetingSelected,
  onCheckingChange,
  onMessage,
  onAuthorizationChange,
  onQuestion,
  queuedQuestions,
}: {
  appId: string;
  readGroup: boolean;
  rehearsal?: boolean;
  initialMeetingId?: string;
  onOpenSettings?: () => void;
  onMeetingReady?: (meetingId: string) => void;
  onMeetingSelected?: (selected: boolean) => void;
  onCheckingChange?: (checking: boolean) => void;
  queuedQuestions?: ReadonlySet<string>;
  onMessage?: (key: string, text: string) => void;
  onAuthorizationChange: (authorized: boolean) => void;
  onQuestion: (key: string, text: string) => void;
}) {
  const loginToFeishu = useFeishuLogin();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [meetingId, setMeetingId] = useState(initialMeetingId);
  const [connected, setConnected] = useState(Boolean(initialMeetingId));
  const [busy, setBusy] = useState(rehearsal && Boolean(appId));
  const [authorized, setAuthorized] = useState(Boolean(initialMeetingId));
  const [status, setStatus] = useState("未连接");
  const pollInterval = useRef(2500);
  const [messages, setMessages] = useState<Message[]>([]);
  const seen = useRef(new Map<string, number>());
  const consumer = useRef(onQuestion);
  const messageConsumer = useRef(onMessage);
  const mounted = useRef(false);
  const discovery = useRef(0);
  const messageKey = (message: Message) =>
    `${message.meeting_id}:${message.message_id}`;

  useEffect(() => {
    consumer.current = onQuestion;
    messageConsumer.current = onMessage;
  }, [onQuestion, onMessage]);

  useEffect(() => {
    if (rehearsal) onCheckingChange?.(busy || connected);
  }, [rehearsal, busy, connected, onCheckingChange]);

  useEffect(() => {
    mounted.current = true;
    if (rehearsal && appId) void discover(false);
    return () => {
      mounted.current = false;
      discovery.current++;
    };
  }, [appId, rehearsal]);

  async function discover(login: boolean) {
    const attempt = ++discovery.current;
    const current = () => mounted.current && discovery.current === attempt;
    onMeetingReady?.("");
    setConnected(false);
    setBusy(true);
    setStatus(login ? "正在等待飞书授权…" : "正在查找活跃会议…");
    try {
      if (login) {
        await loginToFeishu(appId, readGroup);
        if (!current()) return;
        onAuthorizationChange(true);
        setAuthorized(true);
      }
      const items = await invoke<Meeting[]>("feishu_active_meetings", {
        appId,
      });
      if (!current()) return;
      setAuthorized(true);
      onAuthorizationChange(true);
      const optedOut = meetings.length > 0 && !meetingId;
      const nextId =
        optedOut || items.some((item) => item.meeting_id === meetingId)
          ? meetingId
          : (items[0]?.meeting_id ?? "");
      setMeetings(items);
      setMeetingId(nextId);
      onMeetingSelected?.(Boolean(nextId));
      if (rehearsal) setConnected(Boolean(nextId));
      setStatus(items.length ? "" : "未找到活跃会议，请先在飞书入会");
    } catch (error) {
      if (!current()) return;
      const message = String(error);
      if (message.includes("授权失效")) {
        setAuthorized(false);
        onAuthorizationChange(false);
      }
      setStatus(message);
    } finally {
      if (current()) setBusy(false);
    }
  }

  async function logout() {
    discovery.current++;
    onMeetingReady?.("");
    setConnected(false);
    setBusy(true);
    try {
      await invoke("feishu_user_logout", { appId });
      setAuthorized(false);
      onAuthorizationChange(false);
      setMeetings([]);
      setMeetingId("");
      onMeetingSelected?.(false);
      setMessages([]);
      setStatus("未连接");
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  }

  function add(message: Message) {
    const key = messageKey(message);
    consumer.current(key, message.text);
  }

  useEffect(() => {
    if (!connected || !meetingId) return;
    let cancelled = false;
    let requestId: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const first = Math.floor(started / 1000);
    let cursor = first;
    let failures = 0;
    let messageCount = 0;
    setMessages([]);
    setStatus("正在连接会中聊天…");

    async function poll() {
      const until = Math.max(first + 1, Math.floor(Date.now() / 1000));
      let delay = pollInterval.current;
      try {
        requestId = crypto.randomUUID();
        const since = Math.max(first, cursor - 15);
        const batch = await invoke<Batch>("feishu_meeting_events", {
          appId,
          meetingId,
          since,
          until,
          requestId,
        });
        if (cancelled) return;
        if (rehearsal) {
          setStatus(batch.ended ? "会议已结束" : "会中消息读取检查通过");
          onMeetingReady?.(batch.ended ? "" : meetingId);
          setConnected(false);
          return;
        }
        const incoming: Message[] = [];
        for (const message of batch.messages) {
          const key = messageKey(message);
          if (seen.current.has(key)) continue;
          seen.current.set(key, message.timestamp || until * 1000);
          incoming.push(message);
          messageConsumer.current?.(key, message.text);
        }
        for (const [key, timestamp] of seen.current) {
          if (timestamp < (until - 60) * 1000 || seen.current.size > 5000)
            seen.current.delete(key);
        }
        if (incoming.length) {
          messageCount += incoming.length;
          setMessages((previous) =>
            [...previous, ...incoming]
              .sort((a, b) => b.timestamp - a.timestamp)
              .slice(0, 100),
          );
        }
        failures = 0;
        cursor = until;
        setStatus(
          batch.ended
            ? "会议已结束"
            : messageCount
              ? `已收到 ${messageCount} 条会中消息`
              : "已连接，等待会中消息",
        );
        if (batch.ended) {
          setConnected(false);
          return;
        }
      } catch (error) {
        if (cancelled) return;
        const message = String(error);
        setStatus(message);
        if (message.includes("授权失效")) setAuthorized(false);
        if (!message.startsWith("重试中")) {
          setConnected(false);
          return;
        }
        failures += 1;
        delay = Math.min(
          30_000,
          pollInterval.current * 2 ** Math.min(failures, 5),
        );
      }
      timer = setTimeout(() => void poll(), delay);
    }

    void poll();
    return () => {
      cancelled = true;
      if (requestId) cancelFeishuRead(requestId);
      clearTimeout(timer);
    };
  }, [appId, meetingId, connected, rehearsal, onMeetingReady]);

  if (rehearsal) {
    return (
      <section className="meeting-account" aria-label="会中消息">
        <div className="meeting-account-title">
          <h4>会中消息</h4>
          <Badge
            variant="secondary"
            className={`status-chip ${authorized ? "mint" : ""}`}
          >
            {!appId ? "未配置" : authorized ? "已授权" : "待授权"}
          </Badge>
          {authorized && (
            <div className="meeting-actions">
              <Button
                variant="ghost"
                disabled={busy || connected}
                aria-label="刷新已参加的会议"
                title="刷新已参加的会议"
                onClick={() => void discover(false)}
              >
                <RefreshCw size={13} />
                刷新
              </Button>
              <Button
                variant="ghost"
                disabled={busy || connected}
                onClick={() => void logout()}
              >
                退出授权
              </Button>
            </div>
          )}
        </div>
        {appId && (busy || connected || meetingId) && (
          <Button
            variant="ghost"
            className="text-btn"
            onClick={() => {
              discovery.current++;
              setBusy(false);
              setConnected(false);
              setMeetingId("");
              onMeetingSelected?.(false);
              onMeetingReady?.("");
              setStatus("本次不连接会议，可直接本机主讲");
            }}
          >
            本次不连接会议
          </Button>
        )}
        {!authorized && (
          <Button
            variant="outline"
            className="secondary"
            disabled={busy}
            onClick={appId ? () => void discover(true) : onOpenSettings}
          >
            {appId ? <Link2 size={15} /> : <Settings size={15} />}
            {appId ? "授权飞书用户" : "配置飞书应用"}
          </Button>
        )}
        {meetings.length > 0 && (
          <div className="meeting-choice">
            <NativeSelect
              aria-label="活跃会议"
              value={meetingId}
              disabled={busy}
              onChange={(event) => {
                onMeetingReady?.("");
                setMeetingId(event.target.value);
                onMeetingSelected?.(Boolean(event.target.value));
                setConnected(Boolean(event.target.value));
                setMessages([]);
                setStatus("");
              }}
            >
              <NativeSelectOption value="">不连接会议</NativeSelectOption>
              {meetings.map((meeting) => (
                <NativeSelectOption
                  key={meeting.meeting_id}
                  value={meeting.meeting_id}
                >
                  {meeting.meeting_title || "飞书会议"} · {meeting.meeting_no}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {connected && <span role="status">正在自动检查所选会议…</span>}
          </div>
        )}
        <p role="status" className="meeting-feedback">
          {!appId
            ? "先在设置中配置飞书应用，即可连接会议。"
            : status === "未连接"
              ? "请使用参会账号授权。"
              : status}
        </p>
      </section>
    );
  }
  return (
    <section className="feishu-meeting-chat" aria-label="会中弹幕">
      <div className="chat-heading">
        <h3>会中弹幕</h3>
        <NativeSelect
          aria-label="轮询间隔"
          defaultValue={pollInterval.current}
          onChange={(event) => {
            pollInterval.current = Number(event.target.value);
          }}
        >
          {[2500, 5000, 10000].map((ms) => (
            <NativeSelectOption key={ms} value={ms}>
              {ms / 1000} 秒刷新
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <p className="chat-status" role="status">
        {status}
      </p>
      <div className="feishu-chat-messages">
        {messages.map((message) => {
          const key = messageKey(message);
          const queued = queuedQuestions?.has(key);
          return (
            <div className="chat-message" key={key}>
              <span className="question-source">
                {message.speaker_name || message.speaker_id || "参会人"}
              </span>
              <Button
                variant="ghost"
                className="text-btn"
                disabled={queued}
                onClick={() => add(message)}
              >
                {queued ? "已加入" : "加入待答"}
              </Button>
              <p>{message.text}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
