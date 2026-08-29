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

// Arif's display picture. This is set here by Arif, on purpose — Iffat
// can't change it from the UI. Drop the photo in client/public/ and point
// this at it (files in public/ are served from the site root, so
// public/arif.jpg is "/arif.jpg"). If the file is missing or fails to
// load, every avatar quietly falls back to the 👨 emoji.
const ARIF_AVATAR = "/arif.jpg";

// Photos are downscaled in the browser before they're sent. gpt-4o doesn't
// need more than this, and it keeps requests small on a phone connection.
const MAX_IMAGE_DIM = 1024;
const IMAGE_QUALITY = 0.82;

export default function App() {
  const [messages, setMessages] = useState(() => [
    { ...GREETING, time: Date.now() },
  ]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingImage, setPendingImage] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("arif-theme") || "dark";
    } catch {
      return "dark";
    }
  });
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const fileRef = useRef(null);
  const abortRef = useRef(null);

  // paint the chosen theme onto <html> so the CSS variables switch
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("arif-theme", theme);
    } catch {
      // ignore storage failures (private browsing, etc.)
    }
  }, [theme]);

  // auto-scroll to bottom on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming, pendingImage]);

  // auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

  const hasConversation = messages.some((m) => m.role === "user");

  async function onPickImage(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again later
    if (!file || !file.type.startsWith("image/")) return;
    try {
      setPendingImage(await downscaleImage(file));
    } catch {
      setPendingImage(null);
    }
  }

  async function sendMessage(textArg) {
    const text = (textArg ?? input).trim();
    const image = pendingImage;
    if ((!text && !image) || isStreaming) return;

    const userMsg = { role: "user", content: text, image, time: Date.now() };
    const history = [...messages, userMsg];

    setMessages([
      ...history,
      { role: "assistant", content: "", time: Date.now() },
    ]);
    setInput("");
    setPendingImage(null);
    setIsStreaming(true);
    blip("send");

    const controller = new AbortController();
    abortRef.current = controller;
    let gotAnything = false;

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // don't send the local greeting to the model
        body: JSON.stringify({
          messages: history
            .filter((m, i) => !(i === 0 && m.role === "assistant" && !m.image))
            .map(toApiMessage),
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
              if (!gotAnything) {
                gotAnything = true;
                blip("receive");
              }
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = {
                  ...next[next.length - 1],
                  role: "assistant",
                  content: next[next.length - 1].content + json.delta,
                };
                return next;
              });
            }
            if (json.song) {
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = {
                  ...next[next.length - 1],
                  role: "assistant",
                  song: json.song,
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
            ...last,
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
    setMessages([{ ...GREETING, time: Date.now() }]);
    setInput("");
    setPendingImage(null);
    setSidebarOpen(false);
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // Index of the last user message Arif has actually answered — everything
  // up to it gets blue "read" ticks.
  const lastReadUserIndex = (() => {
    let last = -1;
    for (let i = 0; i < messages.length; i++) {
      if (
        messages[i].role === "assistant" &&
        messages[i].content.trim() &&
        i > 0
      ) {
        for (let j = i - 1; j >= 0; j--) {
          if (messages[j].role === "user") {
            last = Math.max(last, j);
            break;
          }
        }
      }
    }
    return last;
  })();

  const canSend = Boolean(input.trim() || pendingImage);

  return (
    <div className="app">
      {/* Tap-out backdrop for the mobile drawer */}
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}

      {/* -------- Sidebar -------- */}
      <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
        {/* Brand */}
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <ArifAvatar className="sidebar-brand-avatar" />
            <div className="sidebar-brand-text">
              <div className="sidebar-brand-name">Arif</div>
              <div className="sidebar-brand-sub">Your personal AI</div>
            </div>
          </div>
          <button
            className="sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        <button className="new-chat" id="new-chat-btn" onClick={newChat}>
          <span>✨</span>
          <span className="new-chat-label">New conversation</span>
        </button>

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
          <div className="header-left">
            <button
              className="menu-btn"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              ☰
            </button>
            <div className="brand">
              <ArifAvatar className="brand-avatar" />
              <div className="brand-info">
                <div className="brand-name">Arif</div>
                <div className={`brand-sub${isStreaming ? " typing" : ""}`}>
                  {isStreaming ? "typing…" : "● Online"}
                </div>
              </div>
            </div>
          </div>
          <div className="header-right">
            <button
              className="theme-toggle"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? "☀️" : "🌙"}
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
                  <ArifAvatar className="hero-avatar" />
                </div>
                <h1>Arif</h1>
                <p className="hero-sub">
                  Assalamu alaikum Iffat! 💙 Kya poochhna chahti hain aaj?
                </p>
              </div>
            )}

            {messages.map((m, i) => {
              const isLast = i === messages.length - 1;
              const streaming = isStreaming && isLast && m.role === "assistant";
              return (
                <Message
                  key={i}
                  role={m.role}
                  content={m.content}
                  image={m.image}
                  song={m.song}
                  time={m.time}
                  streaming={streaming}
                  // dots only until the first words land
                  thinking={streaming && !m.content}
                  tick={
                    m.role === "user"
                      ? i <= lastReadUserIndex
                        ? "read"
                        : "sent"
                      : null
                  }
                />
              );
            })}
          </div>
        </div>

        {/* Composer */}
        <div className="composer">
          {pendingImage && (
            <div className="attach-preview">
              <img src={pendingImage} alt="Attached" />
              <button
                className="attach-remove"
                onClick={() => setPendingImage(null)}
                aria-label="Remove photo"
              >
                ✕
              </button>
            </div>
          )}
          <div className="composer-inner">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onPickImage}
              hidden
            />
            <button
              className="attach-btn"
              onClick={() => fileRef.current?.click()}
              title="Send a photo"
              aria-label="Attach a photo"
            >
              📎
            </button>
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
                disabled={!canSend}
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

// Arif's avatar everywhere it appears. Keeps whatever wrapper class the
// spot needs (so the header's status dot and the hero's rings still work)
// and falls back to the emoji if the photo isn't there.
function ArifAvatar({ className }) {
  const [failed, setFailed] = useState(false);

  if (!ARIF_AVATAR || failed) {
    return <div className={className}>👨</div>;
  }
  return (
    <div className={className}>
      <img src={ARIF_AVATAR} alt="Arif" onError={() => setFailed(true)} />
    </div>
  );
}

function Message({ role, content, image, song, time, streaming, thinking, tick }) {
  const isUser = role === "user";
  return (
    <div className={`msg ${isUser ? "user" : "assistant"}`}>
      {!isUser && <ArifAvatar className="avatar" />}
      <div className={`bubble${image ? " has-image" : ""}`}>
        {image && <img className="bubble-image" src={image} alt="Sent" />}

        {thinking ? (
          <span className="typing-dots" aria-label="Arif is typing">
            <i /><i /><i />
          </span>
        ) : (
          <>
            {content && renderContent(content)}
            {streaming && <span className="cursor" />}
          </>
        )}

        {song && <SongCard song={song} />}

        {!thinking && (
          <span className="meta">
            <span className="meta-time">{formatTime(time)}</span>
            {tick && (
              <span className={`ticks${tick === "read" ? " read" : ""}`}>✓✓</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

// Thumbnail + play button that swaps to a live YouTube embed on click —
// nothing autoplays until Iffat actually taps it.
function SongCard({ song }) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <div className="song-card song-card-playing">
        <iframe
          className="song-embed"
          src={`https://www.youtube.com/embed/${song.videoId}?autoplay=1`}
          title={song.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <button className="song-card" onClick={() => setPlaying(true)} title="Play on YouTube">
      {song.thumbnail && <img className="song-thumb" src={song.thumbnail} alt="" />}
      <span className="song-play-badge">▶</span>
      <span className="song-info">
        <span className="song-title">{song.title}</span>
        {song.channel && <span className="song-channel">{song.channel}</span>}
      </span>
    </button>
  );
}

// --- helpers --------------------------------------------------------------

// A message with a photo goes to the API as gpt-4o's multimodal shape:
// an array of {type:"text"} / {type:"image_url"} parts instead of a string.
function toApiMessage(m) {
  if (!m.image) return { role: m.role, content: m.content };
  const parts = [];
  if (m.content?.trim()) parts.push({ type: "text", text: m.content });
  parts.push({ type: "image_url", image_url: { url: m.image } });
  return { role: m.role, content: parts };
}

// Shrink a picked photo in a canvas before it ever leaves the phone.
function downscaleImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(
          1,
          MAX_IMAGE_DIM / Math.max(img.width, img.height)
        );
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", IMAGE_QUALITY));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function formatTime(ms) {
  try {
    return new Date(ms ?? Date.now()).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// A short, soft blip on send and on Arif's first words. Synthesised with
// WebAudio so there's no audio file to ship, and it fails silently if the
// browser won't allow sound yet.
let audioCtx = null;
function blip(kind) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(kind === "send" ? 660 : 420, now);
    osc.frequency.exponentialRampToValueAtTime(
      kind === "send" ? 990 : 560,
      now + 0.09
    );
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
  } catch {
    // no sound is fine
  }
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
