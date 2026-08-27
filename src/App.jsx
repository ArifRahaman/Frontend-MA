import { useEffect, useRef, useState } from "react";

// In dev this is empty -> Vite proxies /api to localhost:4001.
// In production, set VITE_API_BASE to your backend URL.
const API_BASE = import.meta.env.VITE_API_BASE || "";

const GREETING = {
  role: "assistant",
  content:
    "Assalamu alaikum Iffat! 🌸 Aap kaisi hain? Kuch bhi poochhiye — kaam ho, ya bas aise hi baat karni ho, main yahin hoon 😊",
};

export default function App() {
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const abortRef = useRef(null);

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

    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

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
  }

  function newChat() {
    if (isStreaming) stop();
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
      <aside className="sidebar">
        <button className="new-chat" onClick={newChat}>
          <span>✨</span> New chat
        </button>

        <div className="sidebar-note">
          <div className="sidebar-title">Iffat's AI</div>
          <p>
            Aapka apna AI assistant 🌸 kaam ho ya casual baat — kuch bhi
            poochhiye, main hamesha yahin hoon.
          </p>
        </div>

        <div className="sidebar-footer">powered by Azure OpenAI · gpt-4o</div>
      </aside>

      <main className="chat">
        <header className="chat-header">
          <div className="brand">
            <span className="brand-emoji">🌸</span>
            <span className="brand-name">Iffat</span>
          </div>
          {isStreaming && <span className="live-dot">typing…</span>}
        </header>

        <div className="messages" ref={scrollRef}>
          <div className="messages-inner">
            {!hasConversation && (
              <div className="hero">
                <div className="hero-emoji">🌸</div>
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
              />
            ))}
          </div>
        </div>

        <div className="composer">
          <div className="composer-inner">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="type something…"
              rows={1}
            />
            {isStreaming ? (
              <button className="send stop" onClick={stop} title="Stop">
                ◼
              </button>
            ) : (
              <button
                className="send"
                onClick={() => sendMessage()}
                disabled={!input.trim()}
                title="Send"
              >
                ➤
              </button>
            )}
          </div>
          <div className="disclaimer">
            AI se galti ho sakti hai — important cheezein ek baar verify kar
            lijiye 🌸
          </div>
        </div>
      </main>
    </div>
  );
}

function Message({ role, content, streaming }) {
  const isUser = role === "user";
  return (
    <div className={`msg ${isUser ? "user" : "assistant"}`}>
      <div className="avatar">{isUser ? "🧕" : "🌸"}</div>
      <div className="bubble">
        {renderContent(content)}
        {streaming && <span className="cursor" />}
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
