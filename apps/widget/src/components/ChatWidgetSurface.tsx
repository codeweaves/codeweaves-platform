/**
 * ChatWidgetSurface — renders the chat widget UI using Tailwind classes.
 *
 * This component mirrors the agent editor preview (chat-widget-surface.tsx in apps/web)
 * so they always look identical. Any visual change here should be made in the preview too.
 */
import { Fragment } from "preact";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "preact/hooks";
import type { ChatMessage } from "../types";
import {
  XIcon,
  EllipsisIcon,
  ShieldIcon,
  LogOutIcon,
  ExternalLinkIcon,
  BotIcon,
  SettingsIcon,
  ZapIcon,
  HeadphonesIcon,
  UserIcon,
  UserCheckIcon,
  MicIcon,
  Volume2Icon,
  MessageCircleIcon,
  ArrowUpIcon,
} from "./icons";
import {
  messages as messagesSignal,
  showTyping,
  widgetState,
  isLoading,
  isStreaming,
  isRateLimited,
  error as chatError,
  handoverState,
  agentTyping,
} from "../state/chat-store";
import { useChat } from "../hooks/useChat";
import { useVoice } from "../hooks/useVoice";
import { VoiceRecordingBar } from "./VoiceRecordingBar";
import { isSafeUrl } from "../utils/url";
import { postConsentDecision } from "../services/api-client";
import { WidgetApiError } from "../services/api-errors";
import { clearConfigCache } from "../services/config-loader";
import { clearMessages } from "../state/chat-store";
import { resetSession } from "../services/session-manager";
import {
  consentGranted,
  consentNoticeOverride,
  rememberAcceptedNotice,
  revokeLocalConsent,
  syncConsentFromStorage,
} from "../services/consent";
import { BotMessageText } from "./BotMessageText";
import { FallbackImage } from "./FallbackImage";
import type { AgentConfig } from "../types";

export interface ChatWidgetSurfaceProps {
  agentId: string;
  agentConfig: AgentConfig;
  theme: Record<string, unknown> | null;
  position: "left" | "right";
}

// ── Theme field extraction helpers ──────────────────────────────────

function str(
  obj: Record<string, unknown> | undefined,
  key: string,
  fallback = "",
): string {
  const v = obj?.[key];
  return typeof v === "string" ? v : fallback;
}

function num(
  obj: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
): number {
  const v = obj?.[key];
  return typeof v === "number" ? v : fallback;
}

function bool(
  obj: Record<string, unknown> | undefined,
  key: string,
  fallback = false,
): boolean {
  const v = obj?.[key];
  return typeof v === "boolean" ? v : fallback;
}

function section(
  theme: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | undefined {
  if (!theme) return undefined;
  const v = theme[key];
  return typeof v === "object" && v !== null
    ? (v as Record<string, unknown>)
    : undefined;
}

// ── Avatar helpers (exact copy from preview) ────────────────────────

function getAvatarClass(shape: string): string {
  const shapeClass =
    shape === "circle"
      ? "rounded-full"
      : shape === "rounded"
        ? "rounded-md"
        : shape === "square"
          ? "rounded-none"
          : "rounded-full";
  return `w-8 h-8 ${shapeClass} shrink-0 flex items-center justify-center text-xs font-medium`;
}

function BotAvatarContent({
  type,
  customImage,
}: {
  type: string;
  customImage?: string;
}) {
  const iconProps = { class: "w-4 h-4" };
  switch (type) {
    case "machine":
      return <SettingsIcon {...iconProps} />;
    case "bot":
      return <ZapIcon {...iconProps} />;
    case "support":
      return <HeadphonesIcon {...iconProps} />;
    case "custom":
      return customImage ? (
        // Decorative: the message itself says who is speaking (WCAG 1.1.1).
        <FallbackImage
          src={customImage}
          alt=""
          class="h-full w-full rounded-[inherit] object-cover"
          fallback={<BotIcon {...iconProps} />}
        />
      ) : (
        <span>B</span>
      );
    case "robot":
    default:
      return <BotIcon {...iconProps} />;
  }
}

function UserAvatarContent({
  type,
  customImage,
}: {
  type: string;
  customImage?: string;
}) {
  const iconProps = { class: "w-4 h-4" };
  switch (type) {
    case "female":
      return <UserCheckIcon {...iconProps} />;
    case "custom":
      return customImage ? (
        <FallbackImage
          src={customImage}
          alt=""
          class="h-full w-full rounded-[inherit] object-cover"
          fallback={<UserIcon {...iconProps} />}
        />
      ) : (
        <span>U</span>
      );
    case "male":
    default:
      return <UserIcon {...iconProps} />;
  }
}

function formatTimestamp(ts: Date): string {
  const diff = Date.now() - ts.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return ts.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type GroupPosition = "standalone" | "first" | "middle" | "last";

/** Compute iMessage-style grouping for consecutive same-sender messages */
function computeGroupPositions(msgs: ChatMessage[]): GroupPosition[] {
  return msgs.map((msg, i) => {
    const prev = i > 0 ? msgs[i - 1] : null;
    const next = i < msgs.length - 1 ? msgs[i + 1] : null;
    const isUser = msg.role === "user";
    // A SYSTEM row renders as a divider, not a bubble — it breaks the run, so a
    // bubble sitting beside one is a group edge, never a grouped continuation.
    const isBubble = msg.role !== "system";
    const samePrev =
      isBubble &&
      !!prev &&
      prev.role !== "system" &&
      isUser === (prev.role === "user");
    const sameNext =
      isBubble &&
      !!next &&
      next.role !== "system" &&
      isUser === (next.role === "user");
    if (samePrev && sameNext) return "middle";
    if (!samePrev && sameNext) return "first";
    if (samePrev && !sameNext) return "last";
    return "standalone";
  });
}

/**
 * Which handover divider a SYSTEM status line represents, by its wording, so the
 * widget renders it at its real timeline position. Escalation lines ("asked for
 * a human" / "frustration") → none (the REQUESTED status line covers "waiting").
 * Keep the patterns in sync with handover.service.ts.
 */
function systemDividerKind(content: string): "connected" | "ended" | null {
  if (/took over/i.test(content)) return "connected";
  if (/resumed/i.test(content)) return "ended"; // "Resolved by …. AI resumed" / "Auto-resolved …. AI resumed"
  return null;
}

/** iMessage-style asymmetric border-radius for grouped messages */
function getBubbleRadius(
  isUser: boolean,
  pos: GroupPosition,
  r: number,
): string {
  const s = `${r}px`;
  const t = "4px";
  if (pos === "standalone") return s;
  if (isUser) {
    if (pos === "first") return `${s} ${s} ${t} ${s}`;
    if (pos === "middle") return `${s} ${t} ${t} ${s}`;
    return `${s} ${t} ${s} ${s}`;
  }
  if (pos === "first") return `${s} ${s} ${s} ${t}`;
  if (pos === "middle") return `${t} ${s} ${s} ${t}`;
  return `${t} ${s} ${s} ${s}`;
}

// ── Main component ──────────────────────────────────────────────────

export function ChatWidgetSurface({
  agentId,
  agentConfig,
  theme,
  position,
}: ChatWidgetSurfaceProps) {
  const [inputValue, setInputValue] = useState("");
  const [isInputFocused, setIsInputFocused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Store signals
  const msgs = messagesSignal.value;
  const isTyping = showTyping.value;
  const loading = isLoading.value;
  const streaming = isStreaming.value;
  const rateLimited = isRateLimited.value;

  // Chat actions
  const {
    sendMessage,
    requestHuman,
    notifyTyping,
    notifyHandover,
    addUserMessage,
    createBotMessage,
    appendBotMessageText,
    finalizeBotMessage,
    setVoiceLoading,
  } = useChat({ agentId });

  // ── Theme extraction ────────────────────────────────────────────
  const header = section(theme, "header");
  // The header's own default: shown with no logo set, and when the logo
  // fails to load.
  const defaultHeaderAvatar = (
    <div
      class="cw-header-avatar relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: "rgba(255,255,255,0.2)" }}
    >
      <MessageCircleIcon class="cw-header-avatar-icon h-4 w-4" />
      <span
        class="cw-header-online-dot absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 bg-green-400"
        style={{
          borderColor: str(header, "backgroundColor", "#3b82f6"),
        }}
      />
    </div>
  );
  const botAvatar = section(theme, "botAvatar");
  const userAvatar = section(theme, "userAvatar");
  const userMessage = section(theme, "userMessage");
  const botMessage = section(theme, "botMessage");
  const body = section(theme, "body");
  const timestamps = section(theme, "timestamps");
  const input = section(theme, "input");
  const sendBtn = section(theme, "sendButton");
  // Human handover — the "talk to a human" button (a headset icon next to send).
  const handover = section(theme, "handover");
  const showHandoverBtn =
    agentConfig.humanTakeoverEnabled === true &&
    agentConfig.showTalkToHumanButton === true;
  const handoverTooltip = str(handover, "buttonLabel", "Talk to a human");
  const handoverBg = str(handover, "buttonBackgroundColor", "#ffffff");
  const handoverIconColor = str(handover, "buttonTextColor", "#3b82f6");
  // "Connected to a human" divider — shown above the first human-agent message.
  const handoverLineColor = str(handover, "connectedLineColor", "#10b981");
  const handoverConnectedLabel =
    agentConfig.humanConnectedLabel?.trim() ||
    "You're now connected with our team";
  // Visitor-facing status lines (text + colour editable in the agent editor):
  // the "connecting…" line while waiting for a teammate, and the "back with our
  // assistant" line shown once the teammate resolves and the AI resumes.
  const handoverRequestedLabel = str(
    handover,
    "requestedLabel",
    "Connecting you with our team. Someone will be with you shortly.",
  );
  const handoverRequestedColor = str(handover, "requestedLineColor", "#9ca3af");
  const handoverEndedLabel = str(
    handover,
    "endedLabel",
    "You're back with our assistant",
  );
  const handoverEndedColor = str(handover, "endedLineColor", "#3b82f6");
  // Read the signal so this component re-renders on handover-state changes.
  const hState = handoverState.value;
  // Human teammate typing (socket-driven; only meaningful during ACTIVE_HUMAN).
  const agentIsTyping = agentTyping.value;
  const branding = section(theme, "branding");

  // ── Chat-start privacy notice (ADR-0004) ───────────────────────────
  // Wording, link and mode are the client's. The server decides whether the
  // notice is live (consentNoticeHash is null when it is off). After a 409 the
  // server's current notice overrides a stale cached theme.
  const consentTheme = section(theme, "consent");
  const noticeOverride = consentNoticeOverride.value;
  const noticeHash =
    noticeOverride?.noticeHash ?? agentConfig.consentNoticeHash ?? null;
  const policyUrl =
    noticeOverride?.notice.privacyPolicyUrl ??
    str(consentTheme, "privacyPolicyUrl");
  // A server-sent live notice (noticeOverride) wins over a cached theme that
  // still says the notice is off.
  const noticeActive =
    (noticeOverride !== null || bool(consentTheme, "enabled")) &&
    !!noticeHash &&
    isSafeUrl(policyUrl);
  const noticeMode =
    (noticeOverride?.notice.mode ?? str(consentTheme, "mode", "consent")) ===
    "notice"
      ? "notice"
      : "consent";
  const noticeText =
    noticeOverride?.notice.noticeText ?? str(consentTheme, "noticeText");
  const noticeLinkText =
    noticeOverride?.notice.linkText ??
    str(consentTheme, "linkText", "Privacy Policy");
  const consentButtonLabel =
    noticeOverride?.notice.buttonLabel ??
    str(consentTheme, "buttonLabel", "Start chat");
  const withdrawLabel =
    noticeOverride?.notice.withdrawLabel ??
    str(consentTheme, "withdrawLabel", "Opt out");
  const noticeTextColor = str(consentTheme, "textColor", "#6b7280");
  const noticeLinkColor = str(consentTheme, "linkColor", "#2563eb");
  const granted = consentGranted.value;
  const needsConsent = noticeActive && noticeMode === "consent";
  // Consent mode without a grant: the whole input area becomes the notice.
  const consentLocked = needsConsent && !granted;
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const consentBtnRef = useRef<HTMLButtonElement>(null);

  // Header options menu (privacy policy link + withdraw consent).
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Focus always moves into the menu (WCAG 2.4.3), the way Radix menus do it:
  // opened by a real pointer, focus goes to the menu container, which draws no
  // ring, so a mouse user sees a clean menu; opened any other way (Enter/Space,
  // or a screen reader's synthetic click, which fires no pointerdown), focus
  // goes to the first item. Arrow keys work from either.
  const pointerOpening = useRef(false);
  const menuByPointer = useRef(false);
  const closeMenu = useCallback((refocus = true) => {
    setMenuOpen(false);
    if (refocus) requestAnimationFrame(() => menuBtnRef.current?.focus());
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    requestAnimationFrame(() => {
      if (menuByPointer.current) {
        menuRef.current?.focus();
      } else {
        menuRef.current
          ?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
          ?.focus();
      }
    });
    // composedPath sees through the shadow root, so a click anywhere outside
    // the menu (host page included) closes it.
    const onPointerDown = (e: PointerEvent) => {
      const eventPath = e.composedPath();
      if (
        (menuRef.current && eventPath.includes(menuRef.current)) ||
        (menuBtnRef.current && eventPath.includes(menuBtnRef.current))
      )
        return;
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [menuOpen]);
  const onMenuKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Close the menu only, not the whole chat window.
        e.stopPropagation();
        closeMenu();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([disabled])',
        ) ?? [],
      );
      if (items.length === 0) return;
      const active = (menuRef.current?.getRootNode() as ShadowRoot | undefined)
        ?.activeElement as HTMLElement | null;
      const i = active ? items.indexOf(active) : -1;
      const next =
        e.key === "ArrowDown"
          ? items[(i + 1) % items.length]
          : items[(i - 1 + items.length) % items.length];
      next?.focus();
    },
    [closeMenu],
  );

  // A reload always starts a new session, so read which notice revision this
  // browser accepted. A changed notice has a new hash and asks again.
  useEffect(() => {
    if (needsConsent && !noticeOverride)
      syncConsentFromStorage(agentId, noticeHash);
  }, [agentId, needsConsent, noticeHash, noticeOverride]);

  const typo = section(theme, "typography");
  const animations = section(theme, "animations");

  const iconOnRight = position === "right";

  // Starters come from the agent config (the backend returns them in
  // `agent.starters`, NOT in the theme). Reading `theme.starters` always
  // yielded [] — that's why they never showed.
  const starters = useMemo(() => {
    const raw = agentConfig.starters;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((s: unknown) => {
        if (typeof s === "string") return s;
        if (typeof s === "object" && s !== null && "message" in s)
          return String((s as Record<string, unknown>).message);
        return "";
      })
      .filter((s: string) => s.trim().length > 0)
      .slice(0, 4);
  }, [agentConfig]);

  // Voice config from agentConfig
  const voiceEnabled = agentConfig.voiceEnabled === true;

  // Typewriter state for voice
  const voiceBotMsgIdRef = useRef<string | null>(null);

  // Voice hook
  const {
    voiceState,
    isSupported: voiceIsSupported,
    recordingDurationMs,
    startRecording,
    stopRecording,
    cancelRecording,
    stopPlayback,
    error: voiceError,
    clearError: clearVoiceError,
    getAnalyser: getVoiceAnalyser,
  } = useVoice({
    agentId,
    voiceEnabled,
    voiceAutoPlay: true,
    // A voice turn can raise a handover, OR arrive while a teammate already has
    // the chat. Either way no bot audio is coming, so clear the loader that
    // onTranscription set — otherwise the input stays disabled forever, with no
    // reply to release it — then enter the handover flow (connecting line + poll).
    onHandover: useCallback(
      (state: "NONE" | "REQUESTED" | "ACTIVE_HUMAN") => {
        setVoiceLoading(false);
        notifyHandover(state);
      },
      [setVoiceLoading, notifyHandover],
    ),
    onTranscription: useCallback(
      (text: string) => {
        addUserMessage(text);
        setVoiceLoading(true);
      },
      [addUserMessage, setVoiceLoading],
    ),
    onAudioSentence: useCallback(
      (text: string, sentenceIndex: number) => {
        if (sentenceIndex === 0) {
          const id = createBotMessage();
          voiceBotMsgIdRef.current = id;
          // Show first sentence immediately — no typewriter delay
          appendBotMessageText(id, text);
          setVoiceLoading(false);
        } else if (voiceBotMsgIdRef.current) {
          // Append VERBATIM. Each chunk arrives with the whitespace that preceded
          // it in the reply, so a list item keeps its own line; adding a space
          // here instead would collapse "- a\n- b" onto one line and Markdown
          // would render the whole list as a single bullet until the reply ended.
          appendBotMessageText(voiceBotMsgIdRef.current, text);
        }
      },
      [createBotMessage, appendBotMessageText, setVoiceLoading],
    ),
    onComplete: useCallback(
      (fullText: string) => {
        if (voiceBotMsgIdRef.current) {
          finalizeBotMessage(voiceBotMsgIdRef.current, fullText);
          voiceBotMsgIdRef.current = null;
        }
        setVoiceLoading(false);
      },
      [finalizeBotMessage, setVoiceLoading],
    ),
    onError: useCallback(() => {
      if (voiceBotMsgIdRef.current) {
        finalizeBotMessage(voiceBotMsgIdRef.current);
        voiceBotMsgIdRef.current = null;
      }
      setVoiceLoading(false);
    }, [finalizeBotMessage, setVoiceLoading]),
  });

  const showVoice = voiceEnabled && voiceIsSupported;
  const isVoiceActive = voiceState !== "idle";
  const chatErrorMsg = chatError.value;

  // WCAG 2.4.3: starting a recording swaps the whole input for the recording
  // bar, and finishing or cancelling swaps it back. The focused button is
  // removed each time, so a keyboard or screen reader user is dropped at the
  // top of the page. Move focus to the matching control, but only when focus
  // really was lost (never pull it away from wherever the visitor put it).
  const micBtnRef = useRef<HTMLButtonElement>(null);
  const prevVoiceState = useRef(voiceState);
  useEffect(() => {
    const prev = prevVoiceState.current;
    prevVoiceState.current = voiceState;
    const root = windowRef.current;
    if (!root) return;
    const focusLost = () => {
      const active = (root.getRootNode() as ShadowRoot).activeElement;
      return !active || !root.contains(active);
    };
    if (voiceState === "listening" && prev !== "listening") {
      requestAnimationFrame(() => {
        if (focusLost()) {
          root.querySelector<HTMLElement>(".cw-voice-bar-send")?.focus();
        }
      });
    } else if (
      (prev === "listening" || prev === "processing") &&
      (voiceState === "idle" || voiceState === "playing")
    ) {
      requestAnimationFrame(() => {
        if (focusLost()) (micBtnRef.current ?? inputRef.current)?.focus();
      });
    }
  }, [voiceState]);
  // Withdraw is offered only after a grant in consent mode, and not while a
  // reply, a recording or a live human handover is in progress (a teammate
  // live on the chat owns the session until the handover resolves).
  const canWithdraw = needsConsent && granted;
  const withdrawDisabled =
    consentBusy ||
    loading ||
    streaming ||
    isVoiceActive ||
    handoverState.value !== "NONE";

  // Build display messages: prepend greeting
  const greeting = agentConfig.greeting?.trim() ?? "";
  const displayMessages = useMemo<ChatMessage[]>(() => {
    // SYSTEM handover lines stay in the list — they render as connect/resolve
    // DIVIDERS at their real timeline position (see the map), never as bubbles.
    if (!greeting) return msgs;
    return [
      {
        id: "__greeting__",
        role: "assistant" as const,
        content: greeting,
        timestamp: new Date(),
      },
      ...msgs,
    ];
  }, [greeting, msgs]);

  // Auto-scroll — also on handover-state changes so the "connected" divider
  // (which can appear on takeover before any human message) scrolls into view.
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    } else if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [displayMessages, isTyping, hState, agentIsTyping]);

  // Focus input on mount (or the "Start chat" button when consent locks it)
  useEffect(() => {
    requestAnimationFrame(() =>
      (inputRef.current ?? consentBtnRef.current)?.focus(),
    );
  }, []);

  // Return focus to the input once a send/stream finishes. The textarea is
  // `disabled` while loading/streaming/rate-limited, so the focus() call inside
  // handleSend is a no-op during that window — we restore focus on the
  // disabled → enabled edge so the user can keep typing without re-clicking.
  const sendDisabled = loading || streaming || rateLimited;
  const wasSendDisabled = useRef(false);
  useEffect(() => {
    if (wasSendDisabled.current && !sendDisabled) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    wasSendDisabled.current = sendDisabled;
  }, [sendDisabled]);

  // Auto-resize textarea based on content (max 144px ≈ 6 lines)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [inputValue]);

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text) return;
    sendMessage(text);
    setInputValue("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [inputValue, sendMessage]);

  // "Start chat": the server records the grant against the notice revision
  // the visitor saw. A 409 means the notice changed after this page loaded;
  // show the new wording and let the visitor decide again.
  const handleGrantConsent = useCallback(async () => {
    if (!noticeHash || consentBusy) return;
    setConsentBusy(true);
    setConsentError(null);
    try {
      const res = await postConsentDecision(agentId, "GRANT", noticeHash);
      if (res.ok) {
        rememberAcceptedNotice(agentId, noticeHash);
        consentGranted.value = true;
        requestAnimationFrame(() => inputRef.current?.focus());
      } else {
        consentNoticeOverride.value = res.noticeChanged;
        // The cached config is stale; the next page load must fetch it fresh.
        clearConfigCache(agentId);
        setConsentError(
          "The privacy notice was updated. Please read it again.",
        );
      }
    } catch (err) {
      setConsentError(
        err instanceof WidgetApiError
          ? err.userMessage
          : "Could not start the chat. Please try again.",
      );
    } finally {
      setConsentBusy(false);
    }
  }, [agentId, noticeHash, consentBusy]);

  // Withdrawal is one click, as easy as giving consent (DPDP s.6(4)). The
  // server expires the open chat; here we drop the conversation from view and
  // lock the input again.
  const handleWithdrawConsent = useCallback(async () => {
    if (consentBusy) return;
    setConsentBusy(true);
    setConsentError(null);
    try {
      await postConsentDecision(agentId, "WITHDRAW");
      revokeLocalConsent(agentId);
      resetSession(agentId);
      clearMessages();
      setInputValue("");
    } catch {
      setConsentError("Could not withdraw consent. Please try again.");
    } finally {
      setConsentBusy(false);
    }
  }, [agentId, consentBusy]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // A screen reader user gets no notice that the bot replied: the message is
  // painted into a scroll container, which is a silent DOM change. This holds
  // the finished reply and lets the live region below read it once (WCAG 4.1.3).
  // Deliberately waits for streaming to end, otherwise every token retriggers it.
  const [announcement, setAnnouncement] = useState("");
  const announcedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (streaming) return;
    const last = displayMessages[displayMessages.length - 1];
    // Bot replies and human teammate replies both arrive silently otherwise.
    if (!last || (last.role !== "assistant" && last.role !== "human")) return;
    // The greeting is on screen before the user can ask anything, so it is not
    // news. Announcing it would talk over the person as they open the widget.
    if (last.id === "__greeting__") return;
    // Claim the message before deciding whether to speak it, so a reply we skip
    // below can never be picked up again once the voice state settles.
    if (announcedIdRef.current === last.id) return;
    announcedIdRef.current = last.id;
    // A voice turn is already being read aloud by our own audio. Repeating it
    // here makes a screen reader say the same sentence a second time, slightly
    // out of step with the audio. Typed turns produce no audio, so they still
    // get announced.
    if (voiceState !== "idle") return;
    setAnnouncement(last.content);
  }, [displayMessages, streaming, voiceState]);

  const handleClose = () => {
    widgetState.value = "closed";
  };

  // The open chat is a modal dialog, so it owns the keyboard while it is open:
  // Escape closes it, and Tab cycles inside it instead of walking out into the
  // host page behind it (WCAG 2.4.3 Focus Order). Scoped to the window element,
  // never to document, so we cannot swallow keys meant for the embedding page.
  const windowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = windowRef.current;
    if (!el) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleClose();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = Array.from(
        el.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((n) => n.offsetWidth > 0 || n.offsetHeight > 0);

      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = (el.getRootNode() as ShadowRoot).activeElement;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, []);

  const showTimestamp = bool(timestamps, "show");
  const typingEnabled = bool(animations, "showTypingIndicator", true);

  // Typing and handover changes are spoken through the same always-present
  // region. A live region that is created already holding its text is often
  // not read at all, so these must not carry their own role=status (4.1.3).
  // Clearing first makes a repeated phrase ("… is typing") speak again.
  const announce = useCallback((text: string) => {
    setAnnouncement("");
    requestAnimationFrame(() => setAnnouncement(text));
  }, []);
  const botTypingShown = isTyping && typingEnabled && hState !== "ACTIVE_HUMAN";
  const agentTypingShown = agentIsTyping && hState === "ACTIVE_HUMAN";
  useEffect(() => {
    if (botTypingShown) {
      announce(`${str(header, "title") || agentConfig.name} is typing`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- announce on the rising edge only
  }, [botTypingShown]);
  useEffect(() => {
    if (agentTypingShown) announce("A team member is typing");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rising edge only
  }, [agentTypingShown]);
  const prevHandover = useRef(hState);
  useEffect(() => {
    const prev = prevHandover.current;
    prevHandover.current = hState;
    if (prev === hState) return;
    if (hState === "REQUESTED") announce(handoverRequestedLabel);
    else if (hState === "ACTIVE_HUMAN") announce(handoverConnectedLabel);
    else if (hState === "NONE" && prev === "ACTIVE_HUMAN")
      announce(handoverEndedLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to state changes only
  }, [hState]);
  // ── Render ──────────────────────────────────────────────────────

  return (
    <div
      class="cw-surface-root pointer-events-none"
      style={{
        fontFamily: str(
          typo,
          "fontFamily",
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        ),
        fontSize: `${num(typo, "baseFontSize", 14)}px`,
        lineHeight: "1.5",
        color: "#1f2937",
        textTransform: "none",
        textDecoration: "none",
        fontWeight: "400",
        fontStyle: "normal",
        letterSpacing: "normal",
        wordSpacing: "normal",
        textShadow: "none",
      }}
    >
      {/* Chat window */}
      <div
        ref={windowRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${str(header, "title") || agentConfig.name} chat`}
        class={`cw-window pointer-events-auto absolute ${iconOnRight ? "bottom-5 right-5" : "bottom-5 left-5"} z-30 flex flex-col overflow-hidden bg-white shadow-2xl transition-all duration-300`}
        style={{
          width: 400,
          height: "clamp(520px, 58vh, 800px)",
          borderRadius: `${num(header, "borderRadius", 16)}px`,
          backgroundColor: "#ffffff",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
        }}
      >
        {/* Header */}
        <div
          class="cw-header flex items-center justify-between p-4"
          style={{
            backgroundColor: str(header, "backgroundColor", "#3b82f6"),
            color: str(header, "textColor", "#ffffff"),
            height: 64,
          }}
        >
          <div class="cw-header-info flex items-center gap-3">
            {bool(header, "showLogo") &&
            str(header, "logoUrl") &&
            isSafeUrl(str(header, "logoUrl")) ? (
              <FallbackImage
                src={str(header, "logoUrl")}
                // Decorative: the header title right next to it names the chat.
                alt=""
                class="cw-header-logo h-8 w-8 rounded-full object-cover"
                fallback={defaultHeaderAvatar}
              />
            ) : (
              defaultHeaderAvatar
            )}
            <div class="cw-header-text">
              {/* aria-level 2, not the native h4 level. The widget is injected
                  into someone else's page, so a bare <h4> reads as a skipped
                  level in their document outline (WCAG 1.3.1). Level 2 sits
                  correctly under the host page's h1 and restyles nothing. */}
              <h4
                aria-level={2}
                class="cw-header-title font-semibold leading-tight"
                style={{ fontSize: "1.07em" }}
              >
                {str(header, "title") || agentConfig.name}
              </h4>
              {str(
                header,
                "subtitle",
                "We usually reply within a few minutes",
              ) && (
                <p
                  class="cw-header-subtitle"
                  style={{
                    fontSize: "0.93em",
                    color: str(header, "subtitleColor", "inherit"),
                    opacity: str(header, "subtitleColor") ? 1 : 0.9,
                  }}
                >
                  {str(
                    header,
                    "subtitle",
                    "We usually reply within a few minutes",
                  )}
                </p>
              )}
            </div>
          </div>
          <div class="cw-header-actions relative flex gap-2">
            {noticeActive && (
              <button
                ref={menuBtnRef}
                type="button"
                aria-label="Chat options"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-controls="cw-options-menu"
                class="cw-header-btn cw-header-btn--menu flex h-8 w-8 cursor-pointer items-center justify-center rounded-full p-0 hover:opacity-80"
                style={{ color: str(header, "textColor", "#ffffff") }}
                onPointerDown={() => {
                  pointerOpening.current = true;
                }}
                onClick={() => {
                  menuByPointer.current = pointerOpening.current;
                  pointerOpening.current = false;
                  setMenuOpen((open) => !open);
                }}
              >
                <EllipsisIcon class="h-4 w-4" />
              </button>
            )}
            {menuOpen && (
              // Privacy options live here, not on the chat screen: one click
              // away keeps withdrawal as easy as consenting (DPDP s.6(4))
              // without a permanent line over the message box.
              <div
                ref={menuRef}
                id="cw-options-menu"
                role="menu"
                aria-label="Chat options"
                onKeyDown={onMenuKeyDown}
                // Focus target after a mouse open; draws no ring of its own.
                tabIndex={-1}
                class="cw-options-menu absolute top-10 right-0 z-40 flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white py-1 whitespace-nowrap shadow-lg outline-none"
              >
                <a
                  role="menuitem"
                  href={policyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="cw-options-item flex items-center gap-2 px-3 py-1.5 text-left text-gray-700 no-underline hover:bg-gray-50 focus:bg-gray-50"
                  style={{ fontSize: "1em" }}
                  onClick={() => closeMenu(false)}
                >
                  <ShieldIcon class="h-4 w-4 shrink-0 text-gray-500" />
                  <span class="flex-1">{noticeLinkText}</span>
                  {/* Visual cue for a new tab; the hidden text says it to screen readers. */}
                  <ExternalLinkIcon class="h-3 w-3 shrink-0 text-gray-400" />
                  <span class="cw-sr-only"> (opens in a new tab)</span>
                </a>
                {canWithdraw && (
                  <>
                    <div
                      role="separator"
                      class="my-1 h-px bg-gray-100"
                      aria-hidden="true"
                    />
                    {/* Set apart by a divider: it ends the chat, so it is not
                        next to the plain link. */}
                    <button
                      role="menuitem"
                      type="button"
                      disabled={withdrawDisabled}
                      class="cw-options-item flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left text-gray-700 hover:bg-gray-50 focus:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ fontSize: "1em" }}
                      onClick={(e) => {
                        closeMenu(e.detail === 0);
                        void handleWithdrawConsent();
                      }}
                    >
                      <LogOutIcon class="h-4 w-4 shrink-0 text-gray-500" />
                      <span>{withdrawLabel}</span>
                    </button>
                  </>
                )}
              </div>
            )}
            <button
              aria-label="Close chat"
              class="cw-header-btn cw-header-btn--close flex h-8 w-8 cursor-pointer items-center justify-center rounded-full p-0 hover:opacity-80"
              style={{ color: str(header, "textColor", "#ffffff") }}
              onClick={handleClose}
            >
              <XIcon class="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Reads the finished bot reply to assistive tech. Visually hidden, so
            it changes nothing on screen. */}
        <div
          class="cw-sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {announcement}
        </div>

        {/* Messages area */}
        <div
          ref={scrollRef}
          class="cw-body flex-1 overflow-y-auto p-5"
          style={{
            backgroundColor: str(body, "backgroundColor", "#F9FAFB"),
          }}
        >
          {(() => {
            const positions = computeGroupPositions(displayMessages);
            const botAvatarShow = bool(botAvatar, "show", false);
            const userAvatarShow = bool(userAvatar, "show", false);
            return displayMessages.map((message, i) => {
              // Handover event lines render as dividers at their real timeline
              // position (took over → "connected"; resolved → "back"), never as
              // bubbles. Escalation lines have no divider (→ null).
              if (message.role === "system") {
                const kind = systemDividerKind(message.content);
                if (!kind) return null;
                const dColor =
                  kind === "connected" ? handoverLineColor : handoverEndedColor;
                const dLabel =
                  kind === "connected"
                    ? handoverConnectedLabel
                    : handoverEndedLabel;
                return (
                  <div
                    key={message.id}
                    class={`cw-handover-divider ${kind === "ended" ? "cw-handover-divider--ended" : ""} mt-3 mb-1 flex items-center gap-2`}
                  >
                    <span
                      class="h-px flex-1"
                      style={{ backgroundColor: dColor }}
                      aria-hidden="true"
                    />
                    <span
                      class="shrink-0 px-1 font-medium"
                      style={{ color: dColor, fontSize: "0.78em" }}
                    >
                      {dLabel}
                    </span>
                    <span
                      class="h-px flex-1"
                      style={{ backgroundColor: dColor }}
                      aria-hidden="true"
                    />
                  </div>
                );
              }
              const isUser = message.role === "user";
              const pos = positions[i] ?? "standalone";
              const isLastInGroup = pos === "last" || pos === "standalone";
              const avatarEnabled = isUser ? userAvatarShow : botAvatarShow;
              const showAvatar = avatarEnabled && isLastInGroup;
              const showTime = showTimestamp && isLastInGroup;
              // Don't label a human teammate's message as "AI Agent".
              const showBotMeta =
                !isUser &&
                message.role !== "human" &&
                !botAvatarShow &&
                isLastInGroup;
              const baseRadius = isUser
                ? num(userMessage, "borderRadius", 14)
                : num(botMessage, "borderRadius", 14);
              const marginTop =
                i === 0 ? 0 : pos === "middle" || pos === "last" ? 2 : 12;
              return (
                <Fragment key={message.id}>
                  <div
                    class={`cw-message ${isUser ? "cw-message--user flex-row-reverse" : "cw-message--bot flex-row"} flex items-start gap-2`}
                    style={{ marginTop: `${marginTop}px` }}
                  >
                    {avatarEnabled && (
                      <div
                        class={`${isUser ? "cw-avatar cw-avatar--user" : "cw-avatar cw-avatar--bot"} ${!showAvatar ? "invisible" : ""} ${getAvatarClass(isUser ? str(userAvatar, "shape", "circle") : str(botAvatar, "shape", "circle"))}`}
                        style={{
                          backgroundColor: isUser
                            ? str(userAvatar, "backgroundColor", "#dbeafe")
                            : str(botAvatar, "backgroundColor", "#e0e7ff"),
                          color: isUser
                            ? str(userAvatar, "color", "#3b82f6")
                            : str(botAvatar, "color", "#3b82f6"),
                        }}
                      >
                        {isUser ? (
                          <UserAvatarContent
                            type={str(userAvatar, "type", "user")}
                            customImage={str(userAvatar, "customImageUrl")}
                          />
                        ) : (
                          <BotAvatarContent
                            type={str(botAvatar, "type", "robot")}
                            customImage={str(botAvatar, "customImageUrl")}
                          />
                        )}
                      </div>
                    )}
                    <div
                      class={`cw-message-content flex max-w-[80%] flex-col ${isUser ? "items-end" : "items-start"}`}
                    >
                      <div
                        class="cw-message-bubble px-3.5 py-2"
                        style={{
                          backgroundColor: isUser
                            ? str(userMessage, "backgroundColor", "#3b82f6")
                            : str(botMessage, "backgroundColor", "#f3f4f6"),
                          color: isUser
                            ? str(userMessage, "textColor", "#ffffff")
                            : str(botMessage, "textColor", "#1f2937"),
                          borderRadius: getBubbleRadius(
                            isUser,
                            pos,
                            baseRadius,
                          ),
                        }}
                      >
                        {isUser ? (
                          <p
                            class="cw-message-text leading-relaxed"
                            style={{ fontSize: "1em" }}
                          >
                            {message.content}
                          </p>
                        ) : (
                          <BotMessageText
                            content={message.content}
                            isStreaming={message.isStreaming}
                          />
                        )}
                      </div>
                      {showBotMeta ? (
                        <p
                          class="cw-message-meta mt-1 pl-3"
                          style={{
                            fontSize: "0.86em",
                            color: str(timestamps, "color", "#6b7280"),
                          }}
                        >
                          AI Agent &middot; {formatTimestamp(message.timestamp)}
                        </p>
                      ) : (
                        showTime && (
                          <p
                            class="cw-message-timestamp mt-1 px-2"
                            style={{
                              fontSize: "0.86em",
                              color: str(timestamps, "color", "#6b7280"),
                            }}
                          >
                            {formatTimestamp(message.timestamp)}
                          </p>
                        )
                      )}
                    </div>
                  </div>
                </Fragment>
              );
            });
          })()}

          {/* Waiting for a human (REQUESTED) — a handover-state-driven status
                line, NOT a stored message, so it survives a reload and never
                touches analytics. Replaced by the connected divider above once a
                teammate actually takes over (ACTIVE_HUMAN). */}
          {hState === "REQUESTED" && (
            <div
              class="cw-handover-status my-3 px-4 text-center"
              style={{ fontSize: "0.82em", color: handoverRequestedColor }}
            >
              {handoverRequestedLabel}
            </div>
          )}

          {/* Conversation starters — only in a fresh bot chat. Never during a
                handover, or a reconnect would look like a brand-new chat. */}
          {msgs.length === 0 &&
            hState === "NONE" &&
            !consentLocked &&
            starters.length > 0 && (
              <div class="cw-starters mt-4 flex flex-wrap gap-2">
                {starters.map((s, i) => (
                  <button
                    key={s + i}
                    onClick={() => {
                      sendMessage(s);
                      requestAnimationFrame(() => inputRef.current?.focus());
                    }}
                    class="cw-starter-btn cursor-pointer border border-gray-200 bg-white px-3 py-2 shadow-sm transition-colors hover:bg-gray-50"
                    style={{
                      borderRadius: `${num(botMessage, "borderRadius", 14)}px`,
                      fontSize: "1em",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

          {/* Typing indicator — never show the AI typing while a human is handling. */}
          {isTyping && typingEnabled && hState !== "ACTIVE_HUMAN" && (
            <div
              class="cw-typing mt-3 flex items-start gap-2"
              aria-hidden="true"
            >
              {bool(botAvatar, "show", false) && (
                <div
                  class={`cw-typing-avatar cw-avatar cw-avatar--bot ${getAvatarClass(str(botAvatar, "shape", "circle"))}`}
                  style={{
                    backgroundColor: str(
                      botAvatar,
                      "backgroundColor",
                      "#e0e7ff",
                    ),
                    color: str(botAvatar, "color", "#3b82f6"),
                  }}
                >
                  <BotAvatarContent type={str(botAvatar, "type", "robot")} />
                </div>
              )}
              <div
                class="cw-typing-bubble flex items-center space-x-1 bg-white px-3.5 py-2"
                style={{
                  borderRadius: `${num(botMessage, "borderRadius", 14)}px`,
                }}
              >
                <div class="cw-typing-dot h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                <div
                  class="cw-typing-dot h-2 w-2 animate-bounce rounded-full bg-gray-400"
                  style={{ animationDelay: "0.1s" }}
                />
                <div
                  class="cw-typing-dot h-2 w-2 animate-bounce rounded-full bg-gray-400"
                  style={{ animationDelay: "0.2s" }}
                />
              </div>
            </div>
          )}

          {/* Human teammate is typing (ACTIVE_HUMAN) — same three-dot style as
                the AI indicator but flagged with the headset avatar. Presence
                signal, so it shows regardless of the AI-typing toggle. */}
          {agentIsTyping && hState === "ACTIVE_HUMAN" && (
            <div
              class="cw-typing cw-typing--agent mt-3 flex items-start gap-2"
              aria-hidden="true"
            >
              {bool(botAvatar, "show", false) && (
                <div
                  class={`cw-typing-avatar cw-avatar cw-avatar--bot ${getAvatarClass(str(botAvatar, "shape", "circle"))}`}
                  style={{
                    backgroundColor: str(
                      botAvatar,
                      "backgroundColor",
                      "#e0e7ff",
                    ),
                    color: str(botAvatar, "color", "#3b82f6"),
                  }}
                >
                  <HeadphonesIcon class="h-4 w-4" />
                </div>
              )}
              <div
                class="cw-typing-bubble flex items-center space-x-1 bg-white px-3.5 py-2"
                style={{
                  borderRadius: `${num(botMessage, "borderRadius", 14)}px`,
                }}
              >
                <div class="cw-typing-dot h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                <div
                  class="cw-typing-dot h-2 w-2 animate-bounce rounded-full bg-gray-400"
                  style={{ animationDelay: "0.1s" }}
                />
                <div
                  class="cw-typing-dot h-2 w-2 animate-bounce rounded-full bg-gray-400"
                  style={{ animationDelay: "0.2s" }}
                />
              </div>
            </div>
          )}

          <div ref={bottomRef} aria-hidden="true" />
        </div>

        {/* Voice error banner */}
        {voiceError && (
          <div
            role="alert"
            class="cw-voice-error flex items-center gap-2 border-t border-red-100 bg-red-50 px-4 py-2"
          >
            {/* #991b1b on red-50 is about 7.6:1 (WCAG 1.4.3 needs 4.5:1 for this
                12px text). The old #ef4444 was about 3.5:1. */}
            <p
              class="cw-voice-error-text flex-1 text-xs"
              style={{ color: "#991b1b" }}
            >
              {voiceError}
            </p>
            <button
              onClick={clearVoiceError}
              aria-label="Dismiss voice error"
              class="cw-voice-error-dismiss cursor-pointer text-xs font-medium hover:opacity-80"
              style={{ color: "#991b1b" }}
              type="button"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        )}

        {/* Text chat error (network, timeout, rate limit, over-long message).
            useChat has always set this signal; nothing rendered it, so every
            failure was silent. role=alert announces it; it clears itself after
            5s (useChat) and can be dismissed. Also shown above the consent
            lock, so a visitor locked again by the server sees why. */}
        {chatErrorMsg && (
          <div
            role="alert"
            class="cw-chat-error flex items-center gap-2 border-t border-red-100 bg-red-50 px-4 py-2"
          >
            <p
              class="cw-chat-error-text flex-1 text-xs"
              style={{ color: "#991b1b" }}
            >
              {chatErrorMsg}
            </p>
            <button
              onClick={() => {
                chatError.value = null;
              }}
              aria-label="Dismiss error"
              class="cw-chat-error-dismiss cursor-pointer text-xs font-medium hover:opacity-80"
              style={{ color: "#991b1b" }}
              type="button"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        )}

        {/* Input area */}
        <div
          class="cw-input-area border-t border-gray-200 p-3"
          style={{ backgroundColor: str(input, "backgroundColor", "#ffffff") }}
        >
          {consentLocked ? (
            // Consent mode: nothing is sent (no text, no voice, no handover)
            // until the visitor clicks. The server enforces the same rule.
            <div
              class="cw-consent flex flex-col gap-2"
              role="region"
              aria-label="Privacy notice"
            >
              <p
                class="cw-consent-text leading-snug"
                style={{ color: noticeTextColor, fontSize: "0.86em" }}
              >
                {noticeText}{" "}
                <a
                  href={policyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="cw-consent-link font-medium underline"
                  style={{ color: noticeLinkColor }}
                >
                  {noticeLinkText}
                  <span class="cw-sr-only"> (opens in a new tab)</span>
                </a>
              </p>
              {consentError && (
                <p
                  role="alert"
                  class="cw-consent-error"
                  style={{ color: "#b91c1c", fontSize: "0.82em" }}
                >
                  {consentError}
                </p>
              )}
              <button
                ref={consentBtnRef}
                type="button"
                onClick={() => void handleGrantConsent()}
                disabled={consentBusy}
                aria-busy={consentBusy}
                class="cw-consent-btn w-full cursor-pointer border-0 px-4 py-2 font-medium transition-opacity hover:opacity-90"
                style={{
                  backgroundColor: str(sendBtn, "backgroundColor", "#3b82f6"),
                  color: str(sendBtn, "iconColor", "#ffffff"),
                  borderRadius: `${num(input, "borderRadius", 16)}px`,
                  opacity: consentBusy ? 0.6 : 1,
                }}
              >
                {consentButtonLabel}
              </button>
            </div>
          ) : (
            <>
              {noticeActive && noticeMode === "notice" && msgs.length === 0 && (
                // Notice mode: the notice shows at the start of a chat, then
                // gives way to the conversation. The link stays in the header
                // options menu.
                <p
                  class="cw-consent-line mb-2 leading-snug"
                  style={{ color: noticeTextColor, fontSize: "0.78em" }}
                >
                  {noticeText}{" "}
                  <a
                    href={policyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="cw-consent-link font-medium underline"
                    style={{ color: noticeLinkColor }}
                  >
                    {noticeLinkText}
                    <span class="cw-sr-only"> (opens in a new tab)</span>
                  </a>
                </p>
              )}
              {consentError && (
                <p
                  role="alert"
                  class="cw-consent-error mb-2"
                  style={{ color: "#b91c1c", fontSize: "0.78em" }}
                >
                  {consentError}
                </p>
              )}
              <div
                class="cw-input-wrapper flex flex-col border border-gray-300 px-3 py-2"
                style={{
                  borderRadius: `${num(input, "borderRadius", 16)}px`,
                  boxShadow: isInputFocused
                    ? `0 0 0 2px ${str(sendBtn, "backgroundColor", "#3b82f6")}`
                    : "none",
                }}
              >
                {voiceState === "listening" || voiceState === "processing" ? (
                  <VoiceRecordingBar
                    voiceState={voiceState}
                    recordingDurationMs={recordingDurationMs}
                    onCancel={cancelRecording}
                    onSend={stopRecording}
                    sendBtnColor={str(sendBtn, "backgroundColor", "#3b82f6")}
                    sendBtnIconColor={str(sendBtn, "iconColor", "#ffffff")}
                    getAnalyser={getVoiceAnalyser}
                  />
                ) : (
                  <>
                    <textarea
                      ref={inputRef}
                      value={inputValue}
                      onInput={(e) => {
                        setInputValue((e.target as HTMLTextAreaElement).value);
                        // Let a connected teammate see the visitor is typing (no-op
                        // unless a handover socket is open — throttled internally).
                        notifyTyping();
                      }}
                      onKeyDown={handleKeyDown}
                      onFocus={() => setIsInputFocused(true)}
                      onBlur={() => setIsInputFocused(false)}
                      aria-label={str(
                        input,
                        "placeholderText",
                        "Type your message...",
                      )}
                      // While rate-limited the box is disabled; say why instead of
                      // just greying it out (WCAG 3.3.1).
                      placeholder={
                        rateLimited
                          ? "Please wait a moment..."
                          : str(
                              input,
                              "placeholderText",
                              "Type your message...",
                            )
                      }
                      // The server rejects longer messages (sendMessageSchema).
                      maxLength={4000}
                      disabled={
                        loading || streaming || rateLimited || isVoiceActive
                      }
                      rows={1}
                      class="cw-input w-full resize-none border-0 bg-transparent p-0 leading-snug outline-none"
                      style={{
                        color: str(input, "textColor", "#1f2937"),
                        maxHeight: "144px",
                        // Honor the selected base font-size (matches the chat message text).
                        // The iOS-only 16px floor that prevents focus auto-zoom lives in the
                        // stylesheet (components.ts) scoped to @supports (-webkit-touch-callout).
                        fontSize: "1em",
                      }}
                    />
                    <div class="cw-input-actions mt-2 flex items-center justify-between">
                      <div class="cw-input-left-actions flex items-center gap-1">
                        {/* Mic button only renders in idle/playing — recording + processing states
                         *  swap the entire input wrapper for VoiceRecordingBar (above). */}
                        {showVoice && (
                          <button
                            ref={micBtnRef}
                            onClick={() => {
                              if (voiceState === "idle") startRecording();
                              else if (voiceState === "playing") stopPlayback();
                            }}
                            aria-label={
                              voiceState === "idle"
                                ? "Start recording"
                                : "Stop playback"
                            }
                            class={`cw-voice-btn cw-voice-btn--${voiceState} relative flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-gray-500 hover:text-gray-800`}
                            style={{
                              color:
                                voiceState === "playing"
                                  ? "#F97316"
                                  : undefined,
                            }}
                          >
                            {voiceState === "idle" && (
                              <MicIcon class="h-4 w-4" />
                            )}
                            {voiceState === "playing" && (
                              <Volume2Icon class="h-4 w-4" />
                            )}
                          </button>
                        )}
                      </div>
                      <div class="flex items-center gap-2">
                        {showHandoverBtn && hState === "NONE" && (
                          <button
                            type="button"
                            aria-label={handoverTooltip}
                            title={handoverTooltip}
                            onClick={() => requestHuman()}
                            disabled={
                              loading ||
                              streaming ||
                              rateLimited ||
                              isVoiceActive
                            }
                            class="cw-handover-btn flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition-opacity hover:opacity-80"
                            style={{
                              border: `1.5px solid ${handoverIconColor}`,
                              backgroundColor: handoverBg,
                              color: handoverIconColor,
                              opacity:
                                loading ||
                                streaming ||
                                rateLimited ||
                                isVoiceActive
                                  ? 0.5
                                  : 1,
                            }}
                          >
                            <HeadphonesIcon class="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={handleSend}
                          disabled={
                            !inputValue.trim() ||
                            loading ||
                            streaming ||
                            rateLimited ||
                            isVoiceActive
                          }
                          aria-label="Send message"
                          class="cw-send-btn flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-0 p-0 transition-opacity"
                          style={{
                            backgroundColor: str(
                              sendBtn,
                              "backgroundColor",
                              "#3b82f6",
                            ),
                            color: str(sendBtn, "iconColor", "#ffffff"),
                            opacity:
                              !inputValue.trim() ||
                              loading ||
                              streaming ||
                              rateLimited ||
                              isVoiceActive
                                ? 0.4
                                : 1,
                          }}
                        >
                          <ArrowUpIcon class="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Branding footer */}
        {bool(branding, "enabled") && (
          <div class="cw-branding border-t border-gray-100 bg-gray-50 px-4 py-2 text-center">
            <p
              class="cw-branding-text"
              style={{
                fontSize: "0.86em",
                color: str(branding, "textColor", "#6b7280"),
              }}
            >
              {str(branding, "textPrefix", "Powered by")}{" "}
              {bool(branding, "useLogo") && str(branding, "logo") ? (
                <FallbackImage
                  src={str(branding, "logo")}
                  alt={str(branding, "linkText", "Klivo")}
                  class="cw-branding-logo inline-block h-4 align-[-2px]"
                  fallback={
                    <span
                      class="cw-branding-text-name font-medium"
                      style={{ color: str(branding, "linkColor", "#2563eb") }}
                    >
                      {str(branding, "linkText", "Klivo")}
                    </span>
                  }
                />
              ) : !isSafeUrl(str(branding, "linkUrl", "")) ? (
                // No usable URL: a link to "#" would just reopen the host page
                // (WCAG 2.4.4). Show the name as plain text instead.
                <span
                  class="cw-branding-text-name font-medium"
                  style={{ color: str(branding, "linkColor", "#2563eb") }}
                >
                  {str(branding, "linkText", "Klivo")}
                </span>
              ) : (
                <a
                  href={str(branding, "linkUrl")}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="cw-branding-link font-medium"
                  style={{
                    color: str(branding, "linkColor", "#2563eb"),
                    textDecoration: "none",
                  }}
                >
                  {str(branding, "linkText", "Klivo")}
                  <span class="cw-sr-only"> (opens in a new tab)</span>
                </a>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
