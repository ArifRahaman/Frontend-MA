import { useEffect, useRef, useState } from "react";

// Where the backend lives.
//  - dev: empty string -> Vite proxies /api to localhost:4001
//  - production: the deployed Render backend
// VITE_API_BASE overrides both if it is set at build time.
const PROD_API_BASE = "https://backend-ma-83fc.onrender.com";
const API_BASE =
  import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "" : PROD_API_BASE);

const GREETING = {
  role: "assistant",
  content:
    "Assalamu alaikum Iffat! 💙 Main Arif hoon — kuch bhi poochhiye, kaam ho ya bas aise hi baat karni ho, hamesha yahin hoon 😊",
};



export default function App() {
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [voiceOn, setVoiceOn] = useState(() => {
    try {
      return localStorage.getItem("arif-voice") !== "off";
    } catch {
      return true;
    }
  });
  const [speakingIndex, setSpeakingIndex] = useState(null);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const abortRef = useRef(null);
  const audioRef = useRef(null);

  function stopSpeaking() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setSpeakingIndex(null);
  }

  // Ask the backend for Deepgram audio of `text` and play it. `index` (the
  // message's position in the list) just drives the little speaking
  // indicator on that bubble.
  async function speak(text, index) {
    if (!text || !text.trim()) return;
    stopSpeaking();

    try {
      const res = await fetch(`${API_BASE}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return; // TTS not configured, or Deepgram hiccup — fail quietly

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      setSpeakingIndex(index);
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
        setSpeakingIndex((cur) => (cur === index ? null : cur));
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
        setSpeakingIndex((cur) => (cur === index ? null : cur));
      };
      await audio.play();
    } catch {
      // ignore — voice is a nice-to-have, never block the chat over it
    }
  }

  function toggleVoice() {
    setVoiceOn((v) => {
      const next = !v;
      try {
        localStorage.setItem("arif-voice", next ? "on" : "off");
      } catch {
        // ignore storage failures (private browsing, etc.)
      }
      if (!next) stopSpeaking();
      return next;
    });
  }

  // auto-scroll to bottom on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming]);

  // auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

  const hasConversation = messages.some((m) => m.role === "user");

  async function sendMessage(textArg) {
    const text = (textArg ?? input).trim();
    if (!text || isStreaming) return;

    const userMsg = { role: "user", content: text };
    const history = [...messages, userMsg];
    const assistantIndex = history.length; // where the new reply will sit

    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setIsStreaming(true);
    stopSpeaking();

    const controller = new AbortController();
    abortRef.current = controller;
    let assistantText = "";

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // don't send the local greeting to the model
        body: JSON.stringify({
          messages: history.filter((m, i) => !(i === 0 && m === GREETING)),
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`server said ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;

          try {
            const json = JSON.parse(payload);
            if (json.error) throw new Error(json.error);
            if (json.delta) {
              assistantText += json.delta;
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = {
                  role: "assistant",
                  content: next[next.length - 1].content + json.delta,
                };
                return next;
              });
            }
          } catch (e) {
            // ignore partial JSON, surface real errors
            if (e.message && !e.message.includes("JSON")) throw e;
          }
        }
      }

      if (voiceOn && assistantText.trim()) {
        speak(assistantText, assistantIndex);
      }
    } catch (err) {
      if (err.name === "AbortError") {
        // user hit stop — leave whatever streamed so far
      } else {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          const note =
            "kuch glitch ho gaya 😑 (" +
            (err.message || "network problem") +
            "). phir se try kariye.";
          next[next.length - 1] = {
            role: "assistant",
            content: last.content ? last.content + "\n\n" + note : note,
          };
          return next;
        });
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    stopSpeaking();
  }

  function newChat() {
    if (isStreaming) stop();
    stopSpeaking();
    setMessages([GREETING]);
    setInput("");
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="app">
      {/* -------- Sidebar -------- */}
      <aside className="sidebar">
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="sidebar-brand-avatar">👨</div>
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-name">Arif</div>
            <div className="sidebar-brand-sub">Your personal AI</div>
          </div>
        </div>

        <button className="new-chat" id="new-chat-btn" onClick={newChat}>
          <span>✨</span>
          <span className="new-chat-label">New conversation</span>
        </button>

        <div className="sidebar-note">
          <div className="sidebar-title">Arif 💙</div>
          <p>
            Main Arif hoon — Iffat ka apna AI companion. Kaam ho ya casual
            baat, sab ke liye hamesha yahin hoon 😊
          </p>
        </div>

        <div className="sidebar-status">
          <div className="status-dot" />
          <div className="status-text">
            <span className="status-name">Arif</span> is online
          </div>
        </div>

        <div className="sidebar-footer">
          powered by Azure OpenAI · gpt-4o<br />
          made with 💙 for Iffat
        </div>
      </aside>

      {/* -------- Main Chat -------- */}
      <main className="chat">
        <header className="chat-header">
          <div className="brand">
            <div className="brand-avatar">👨</div>
            <div className="brand-info">
              <div className="brand-name">Arif</div>
              <div className="brand-sub">● Online</div>
            </div>
          </div>
          <div className="header-right">
            {isStreaming && (
              <span className="live-dot">typing…</span>
            )}
            <button
              className={`voice-toggle${voiceOn ? " on" : ""}`}
              onClick={toggleVoice}
              title={voiceOn ? "Voice on — click to mute" : "Voice off — click to unmute"}
            >
              {voiceOn ? "🔊" : "🔇"}
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="messages" ref={scrollRef}>
          <div className="messages-inner">
            {!hasConversation && (
              <div className="hero">
                <div className="hero-glow">
                  <div className="hero-ring-2" />
                  <div className="hero-ring" />
                  <div className="hero-avatar">👨</div>
                </div>
                <h1>Arif</h1>
                <p className="hero-sub">
                  Assalamu alaikum Iffat! 💙 Kya poochhna chahti hain aaj?
                </p>
              </div>
            )}

            {messages.map((m, i) => (
              <Message
                key={i}
                role={m.role}
                content={m.content}
                streaming={
                  isStreaming &&
                  i === messages.length - 1 &&
                  m.role === "assistant"
                }
                speaking={speakingIndex === i}
                onSpeak={
                  m.role === "assistant" && m.content.trim()
                    ? () =>
                        speakingIndex === i ? stopSpeaking() : speak(m.content, i)
                    : undefined
                }
              />
            ))}
          </div>
        </div>

        {/* Composer */}
        <div className="composer">
          <div className="composer-inner">
            <textarea
              ref={textareaRef}
              id="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Kuch bhi poochhiye Iffat…"
              rows={1}
            />
            {isStreaming ? (
              <button className="send stop" id="stop-btn" onClick={stop} title="Stop generating">
                ◼
              </button>
            ) : (
              <button
                className="send"
                id="send-btn"
                onClick={() => sendMessage()}
                disabled={!input.trim()}
                title="Send message"
              >
                ➤
              </button>
            )}
          </div>
          <div className="disclaimer">
            AI se galti ho sakti hai — important cheezein ek baar verify kar
            lijiye 💙
          </div>
        </div>
      </main>
    </div>
  );
}

function Message({ role, content, streaming, speaking, onSpeak }) {
  const isUser = role === "user";
  return (
    <div className={`msg ${isUser ? "user" : "assistant"}`}>
      <div className="avatar">{isUser ? "🧕" : "👨"}</div>
      <div className="bubble">
        {renderContent(content)}
        {streaming && <span className="cursor" />}
        {onSpeak && !streaming && (
          <button
            className={`bubble-speak${speaking ? " speaking" : ""}`}
            onClick={onSpeak}
            title={speaking ? "Playing…" : "Play this reply"}
          >
            {speaking ? "◼" : "🔊"}
          </button>
        )}
      </div>
    </div>
  );
}

// tiny renderer: preserves line breaks + **bold**
function renderContent(text) {
  const lines = text.split("\n");
  return lines.map((line, i) => (
    <span key={i}>
      {formatBold(line)}
      {i < lines.length - 1 && <br />}
    </span>
  ));
}

function formatBold(line) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i}>{p.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}
