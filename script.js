const MISTRAL_API_KEY = "qjBBduK553dT4p38zaBpWFS07TAXhYIW";
const GOOGLE_CLIENT_ID = "61951061052-2j1a6olh94lcdf965ej42ut67hrhged2.apps.googleusercontent.com";
const SUPABASE_URL = "https://nrzabwpjlukezimqbvkb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_mE7GdyupIszRWEBq3jDX-A__NiGMiOU";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let conversationHistory = [];
let allSessions = [];
let currentSessionId = null;
let currentAbortController = null;
let recognition = null;
let isListening = false;
let speechEnabled = true;
let voiceModeActive = false;
let currentUserEmail = null;
let pendingImage = null;
let pendingFile = null;
let currentPersona = "default";

const SUGGESTIONS = [
  "Explain quantum computing simply",
  "Help me write a follow-up email",
  "Give me a healthy dinner idea",
  "Tips to study more effectively",
];

const PERSONAS = {
  default: "You are a warm, helpful, and thoughtful assistant. Speak naturally and politely, like a well-mannered person having a normal conversation — clear, respectful, and easy to follow, without being stiff or overly formal. Avoid slang, filler phrases like 'what's up', and repetitive greetings. Use markdown formatting where it helps clarity. Be concise unless asked for detail. Always reply in the same language the user writes in. If asked who created you, who made you, or who your developer is, say you were created by Suhail.",
  coding: "You are an expert coding assistant. Give precise, correct, well-commented code. Prefer showing full working examples over vague explanations. Point out bugs or edge cases proactively. Use markdown code blocks with the right language tag. Be concise — skip preamble, get to the code. If asked who created you, say you were created by Suhail.",
  tutor: "You are a patient, encouraging tutor. Break down concepts into small, clear steps. Check understanding by explaining simply first, then going deeper if asked. Use analogies where helpful. Never make the person feel bad for not knowing something. If asked who created you, say you were created by Suhail.",
  writer: "You are a skilled writing coach. Help improve clarity, tone, and structure. When reviewing text, give specific, actionable feedback rather than vague praise. When asked to write, match the tone and style requested exactly. If asked who created you, say you were created by Suhail.",
};
window.addEventListener("load", async () => {
  createStars();

  const isSharedView = await loadSharedSessionIfPresent();
  if (isSharedView) return;

  setupInputAutoResize();
  setupVoiceInput();
  setupImageUpload();
  setupFileUpload();
  setupDragAndDrop();
  setupKeyboardShortcuts();
  setInterval(() => {
    renderMessages();
  }, 60000);

  const savedEmail = localStorage.getItem("loggedInUser");
  if (!savedEmail) {
    document.getElementById("loginScreen").classList.remove("hidden");
  }

  initGoogleSignIn();
});

// ---- Google Sign-In ----

function initGoogleSignIn() {
  if (typeof google === "undefined") {
    setTimeout(initGoogleSignIn, 300);
    return;
  }

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleSignIn,
  });
  google.accounts.id.renderButton(
    document.getElementById("googleSignInBtn"),
    {
      theme: "filled_black",
      size: "large",
      shape: "pill",
      text: "signin_with",
      logo_alignment: "left",
    }
  );

  const savedEmail = localStorage.getItem("loggedInUser");
  if (savedEmail) {
    logInUser(savedEmail, localStorage.getItem("loggedInUserName") || "");
  }
}

function handleGoogleSignIn(response) {
  const payload = JSON.parse(atob(response.credential.split(".")[1]));
  logInUser(payload.email, payload.name);
}

function logInUser(email, name) {
  currentUserEmail = email;
  localStorage.setItem("loggedInUser", email);
  localStorage.setItem("loggedInUserName", name);

  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("userGreeting").textContent = name ? `Hi, ${name.split(" ")[0]}` : "";

  init();
}

function signOutUser() {
  localStorage.removeItem("loggedInUser");
  localStorage.removeItem("loggedInUserName");
  currentUserEmail = null;
  location.reload();
}

function getOwnerKey() {
  return currentUserEmail || "guest";
}

// ---- Supabase session storage ----

async function fetchAllSessions(owner) {
  const { data, error } = await supabaseClient
    .from("sessions")
    .select("*")
    .eq("owner", owner)
    .order("updated_at", { ascending: true });

  if (error) {
    console.error("Failed to fetch sessions:", error);
    return [];
  }
  return data.map((row) => ({
    id: row.id,
    title: row.title,
    folder: row.folder || "General",
    persona: row.persona || "default",
    messages: row.messages || [],
  }));
}

async function upsertSession(session, owner) {
  const { error } = await supabaseClient
    .from("sessions")
    .upsert({
      id: session.id,
      owner,
      title: session.title,
      folder: session.folder || "General",
      persona: session.persona || "default",
      messages: session.messages,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    console.error("Failed to save session:", error);
  }
}

// ---- Core app ----

async function init() {
  const owner = getOwnerKey();
  allSessions = await fetchAllSessions(owner);

  currentSessionId = localStorage.getItem(`currentSessionId_${owner}`);
  const activeSession = allSessions.find((s) => s.id === currentSessionId);

  if (activeSession) {
    conversationHistory = activeSession.messages;
    currentPersona = activeSession.persona || "default";
  } else {
    currentSessionId = Date.now().toString();
    conversationHistory = [];
    localStorage.setItem(`currentSessionId_${owner}`, currentSessionId);
  }

  document.getElementById("personaSelect").value = currentPersona;

  renderMessages();
  renderHistoryList();
  renderPinnedBar();
  renderFolderFilterOptions();
}

function createStars() {
  const overlay = document.getElementById("starsOverlay");
  for (let i = 0; i < 80; i++) {
    const star = document.createElement("div");
    star.classList.add("star");
    star.style.left = Math.random() * 100 + "%";
    star.style.top = Math.random() * 100 + "%";
    star.style.animationDelay = Math.random() * 3 + "s";
    const size = Math.random() * 2 + 1;
    star.style.width = size + "px";
    star.style.height = size + "px";
    overlay.appendChild(star);
  }
}

function setupInputAutoResize() {
  const input = document.getElementById("userInput");
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

// ---- Keyboard shortcuts ----

function setupKeyboardShortcuts() {
  window.addEventListener("keydown", (e) => {
    const cmdOrCtrl = e.metaKey || e.ctrlKey;

    if (cmdOrCtrl && e.key.toLowerCase() === "k") {
      e.preventDefault();
      newChat();
    }
    if (cmdOrCtrl && e.key === "/") {
      e.preventDefault();
      toggleShortcutsModal();
    }
    if (cmdOrCtrl && e.key.toLowerCase() === "b") {
      e.preventDefault();
      toggleSidebar();
    }
    if (e.key === "Escape") {
      const modal = document.getElementById("shortcutsModal");
      if (modal && !modal.classList.contains("hidden")) {
        modal.classList.add("hidden");
      }
    }
  });
}

function toggleShortcutsModal() {
  const modal = document.getElementById("shortcutsModal");
  if (!modal) return;
  modal.classList.toggle("hidden");
}

// ---- Overflow menu ----

function toggleOverflowMenu() {
  const menu = document.getElementById("overflowMenu");
  if (!menu) return;
  menu.classList.toggle("hidden");
}

window.addEventListener("click", (e) => {
  const wrapper = document.querySelector(".overflow-menu-wrapper");
  const menu = document.getElementById("overflowMenu");
  if (wrapper && menu && !wrapper.contains(e.target)) {
    menu.classList.add("hidden");
  }
});

// ---- Persona picker ----

function setPersona(value) {
  currentPersona = value;
  saveCurrentSession();
}

// ---- Image upload ----

function setupImageUpload() {
  document.getElementById("imageUpload").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      pendingImage = reader.result;
      renderImagePreview();
    };
    reader.readAsDataURL(file);
  });
}

function renderImagePreview() {
  const bar = document.getElementById("imagePreviewBar");
  bar.innerHTML = "";
  if (!pendingImage) return;

  const img = document.createElement("img");
  img.src = pendingImage;
  bar.appendChild(img);

  const removeBtn = document.createElement("button");
  removeBtn.textContent = "Remove";
  removeBtn.onclick = () => {
    pendingImage = null;
    document.getElementById("imageUpload").value = "";
    renderImagePreview();
  };
  bar.appendChild(removeBtn);
}

// ---- File upload (text/pdf) + drag-and-drop ----

function setupFileUpload() {
  document.getElementById("fileUpload").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleIncomingFile(file);
  });
}

function setupDragAndDrop() {
  const dropZone = document.getElementById("chatMessages");
  const overlay = document.getElementById("dropOverlay");
  let dragCounter = 0;

  ["dragenter", "dragover"].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dragCounter++;
      overlay.classList.remove("hidden");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) overlay.classList.add("hidden");
    });
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.add("hidden");
    const file = e.dataTransfer.files[0];
    if (!file) return;

    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => {
        pendingImage = reader.result;
        renderImagePreview();
      };
      reader.readAsDataURL(file);
    } else {
      handleIncomingFile(file);
    }
  });
}

async function handleIncomingFile(file) {
  const maxChars = 12000;

  if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
    try {
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((it) => it.str).join(" ") + "\n";
        if (text.length > maxChars) break;
      }
      pendingFile = { name: file.name, text: text.slice(0, maxChars) };
      renderFilePreview();
    } catch (err) {
      console.error(err);
      alert("Couldn't read that PDF.");
    }
  } else {
    const reader = new FileReader();
    reader.onload = () => {
      pendingFile = { name: file.name, text: String(reader.result).slice(0, maxChars) };
      renderFilePreview();
    };
    reader.readAsText(file);
  }
}

function renderFilePreview() {
  const bar = document.getElementById("filePreviewBar");
  bar.innerHTML = "";
  if (!pendingFile) return;

  const chip = document.createElement("span");
  chip.textContent = `📎 ${pendingFile.name}`;
  chip.style.fontSize = "13px";
  chip.style.color = "#DADFE4";
  bar.appendChild(chip);

  const removeBtn = document.createElement("button");
  removeBtn.textContent = "Remove";
  removeBtn.onclick = () => {
    pendingFile = null;
    document.getElementById("fileUpload").value = "";
    renderFilePreview();
  };
  bar.appendChild(removeBtn);
}

// ---- Voice input (single message) ----

function setupVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    document.getElementById("micBtn").style.display = "none";
    document.getElementById("voiceModeBtn").style.display = "none";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onresult = (event) => {
    let transcript = "";
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    const input = document.getElementById("userInput");
    input.value = transcript;
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  };

  recognition.onend = () => {
    isListening = false;
    document.getElementById("micBtn").classList.remove("listening");
  };

  recognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error);
    isListening = false;
    document.getElementById("micBtn").classList.remove("listening");
  };
}

function toggleVoiceInput() {
  if (!recognition) return;

  if (isListening) {
    recognition.stop();
    isListening = false;
    document.getElementById("micBtn").classList.remove("listening");
  } else {
    recognition.start();
    isListening = true;
    document.getElementById("micBtn").classList.add("listening");
  }
}

// ---- Speech helpers ----

function stripForSpeech(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/#+\s/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/gu, "")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function detectLangTag(text) {
  if (/[\u0B80-\u0BFF]/.test(text)) return "ta-IN";
  if (/[\u0900-\u097F]/.test(text)) return "hi-IN";
  if (/[\u0C00-\u0C7F]/.test(text)) return "te-IN";
  if (/[\u0C80-\u0CFF]/.test(text)) return "kn-IN";
  if (/[\u0D00-\u0D7F]/.test(text)) return "ml-IN";
  if (/[\u0600-\u06FF]/.test(text)) return "ar-SA";
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh-CN";
  if (/[\u3040-\u30FF]/.test(text)) return "ja-JP";
  if (/[\uAC00-\uD7AF]/.test(text)) return "ko-KR";
  if (/[\u0400-\u04FF]/.test(text)) return "ru-RU";
  return "en-US";
}

function pickMaleVoice(langTag) {
  const voices = window.speechSynthesis.getVoices();
  const prefix = langTag.split("-")[0];
  const candidates = voices.filter(v => v.lang.toLowerCase().startsWith(prefix));
  const pool = candidates.length > 0 ? candidates : voices;
  const male = pool.find(v => /male|david|mark|daniel|ravi|hemant|george|guy|rishi/i.test(v.name));
  return male || pool[0] || voices[0];
}

function speakWithVoice(text) {
  if (!window.speechSynthesis) return;
  const langTag = detectLangTag(text);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = langTag;
  utterance.voice = pickMaleVoice(langTag);
  utterance.rate = 1.05;
  return utterance;
}

function speakText(text) {
  if (!speechEnabled) return;
  if (!window.speechSynthesis) return;
  const cleanText = stripForSpeech(text);
  window.speechSynthesis.cancel();
  const utterance = speakWithVoice(cleanText);
  window.speechSynthesis.speak(utterance);
}

function toggleSpeech() {
  speechEnabled = !speechEnabled;
  const btn = document.getElementById("speechToggleBtn");
  if (btn) btn.textContent = speechEnabled ? "🔊" : "🔇";
  if (!speechEnabled) window.speechSynthesis.cancel();
}

// ---- Hands-free Voice Mode ----

function openVoiceMode() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Voice mode isn't supported in this browser. Try Chrome or Edge.");
    return;
  }
  voiceModeActive = true;
  document.getElementById("voiceOverlay").classList.remove("hidden");
  listenForVoiceMode();
}

function closeVoiceMode() {
  voiceModeActive = false;
  window.speechSynthesis.cancel();
  document.getElementById("voiceOverlay").classList.add("hidden");
}

function listenForVoiceMode() {
  if (!voiceModeActive) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const voiceRecognition = new SpeechRecognition();
  voiceRecognition.lang = "en-US";
  voiceRecognition.interimResults = false;
  voiceRecognition.continuous = false;

  document.getElementById("voiceStatus").textContent = "Listening...";
  document.getElementById("voiceOrb").classList.remove("speaking");

  voiceRecognition.start();

  voiceRecognition.onresult = async (event) => {
    const transcript = event.results[0][0].transcript;
    if (!transcript.trim()) {
      if (voiceModeActive) listenForVoiceMode();
      return;
    }

    document.getElementById("voiceStatus").textContent = "Thinking...";

    conversationHistory.push({ role: "user", parts: [{ text: transcript }], timestamp: Date.now() });
    saveCurrentSession();
    renderMessages();

    await streamBotReplyForVoice();
  };

  voiceRecognition.onerror = (event) => {
    console.error("Voice mode recognition error:", event.error);
    if (voiceModeActive) {
      setTimeout(() => listenForVoiceMode(), 1000);
    }
  };
}

// ---- Fetch with retry/backoff ----

async function fetchWithRetry(url, options, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.status >= 500 && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
        continue;
      }
      return response;
    } catch (err) {
      if (err.name === "AbortError") throw err;
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
      }
    }
  }
  throw lastError;
}

async function streamBotReplyForVoice() {
  document.getElementById("voiceStatus").textContent = "Thinking...";

  const url = "https://api.mistral.ai/v1/chat/completions";
  let fullText = "";

  try {
    const apiMessages = [
      { role: "system", content: PERSONAS[currentPersona] + " Keep spoken answers short and avoid markdown symbols since this will be read aloud." },
      ...conversationHistory.map((m) => ({
        role: m.role === "model" ? "assistant" : "user",
        content: m.parts[0].text,
      })),
    ];

    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages: apiMessages,
      }),
    });

    const data = await response.json();

    if (data.error) {
      fullText = `⚠️ API error: ${data.error.message || "unknown error"}`;
    } else {
      fullText = data.choices?.[0]?.message?.content || "Sorry, I didn't catch that.";
    }
  } catch (error) {
    console.error(error);
    fullText = "Something went wrong after a few attempts. Please try again.";
  }

  conversationHistory.push({ role: "model", parts: [{ text: fullText }], timestamp: Date.now() });
  saveCurrentSession();
  renderMessages();

  document.getElementById("voiceStatus").textContent = "Speaking...";
  document.getElementById("voiceOrb").classList.add("speaking");

  const cleanText = stripForSpeech(fullText);
  const utterance = speakWithVoice(cleanText);
  utterance.onend = () => {
    if (voiceModeActive) listenForVoiceMode();
  };
  window.speechSynthesis.speak(utterance);
}

// ---- Sidebar / time ----

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("collapsed");
}

function formatTime(ts) {
  const now = Date.now();
  const diffMs = now - ts;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHr < 24) return `${diffHr} hr ago`;
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;

  const d = new Date(ts);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ---- Sending / streaming ----

function sendMessage(prefillText) {
  const input = document.getElementById("userInput");
  const text = (prefillText !== undefined ? prefillText : input.value).trim();
  if (!text && !pendingImage && !pendingFile) return;
  let messageText = text || "What's in this image?";
  if (pendingFile) {
    messageText = `[Attached file: ${pendingFile.name}]\n\n${pendingFile.text}\n\n---\n\n${text || "Please look at the attached file."}`;
  }

  const entry = {
    role: "user",
    parts: [{ text: messageText }],
    displayText: text || (pendingFile ? `📎 ${pendingFile.name}` : "What's in this image?"),
    timestamp: Date.now(),
  };
  if (pendingImage) entry.image = pendingImage;

  conversationHistory.push(entry);
  input.value = "";
  input.style.height = "auto";
  pendingImage = null;
  pendingFile = null;
  document.getElementById("imageUpload").value = "";
  document.getElementById("fileUpload").value = "";
  renderImagePreview();
  renderFilePreview();
  renderMessages();
  saveCurrentSession();

  streamBotReply();
}

async function streamBotReply() {
  const sendBtn = document.getElementById("sendBtn");
  const stopBtn = document.getElementById("stopBtn");
  sendBtn.classList.add("hidden");
  stopBtn.classList.remove("hidden");

  currentAbortController = new AbortController();

  const messages = document.getElementById("chatMessages");
  const tempRow = document.createElement("div");
  tempRow.classList.add("message-row");
  tempRow.innerHTML = `
    <div class="avatar">AI</div>
    <div class="message-col">
      <div class="message-text" id="streamingText">
        <div class="searching-indicator"><span></span><span></span><span></span></div>
      </div>
    </div>
  `;
  messages.appendChild(tempRow);
  messages.scrollTop = messages.scrollHeight;

  const streamingTextEl = document.getElementById("streamingText");

  let fullText = "";
  let wordQueue = [];
  let displayedText = "";
  let streamDone = false;
  let aborted = false;

  const revealInterval = setInterval(() => {
    if (wordQueue.length > 0) {
      displayedText += wordQueue.shift();
      streamingTextEl.innerHTML = marked.parse(displayedText);
      messages.scrollTop = messages.scrollHeight;
    } else if (streamDone) {
      clearInterval(revealInterval);
      addCodeCopyButtons(streamingTextEl);
    }
  }, 40);

  const url = "https://api.mistral.ai/v1/chat/completions";

  try {
    const apiMessages = [
      { role: "system", content: PERSONAS[currentPersona] },
      ...conversationHistory.map((m) => {
        if (m.image) {
          return {
            role: "user",
            content: [
              { type: "text", text: m.parts[0].text },
              { type: "image_url", image_url: m.image },
            ],
          };
        }
        return {
          role: m.role === "model" ? "assistant" : "user",
          content: m.parts[0].text,
        };
      }),
    ];

    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MISTRAL_API_KEY}`,
      },
      signal: currentAbortController.signal,
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages: apiMessages,
        stream: true,
      }),
    }, 2);

    if (response.status === 429) {
      fullText = "⚠️ You've hit the free API rate limit. Please wait a minute and try again.";
      wordQueue.push(fullText);
      streamDone = true;
      throw new Error("RateLimited");
    }

    if (!response.ok) {
      fullText = `⚠️ Something went wrong (status ${response.status}). Check your API key.`;
      wordQueue.push(fullText);
      streamDone = true;
      throw new Error("BadResponse");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;

        try {
          const parsed = JSON.parse(jsonStr);
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (chunk) {
            fullText += chunk;
            const words = chunk.match(/\S+\s*/g) || [];
            wordQueue.push(...words);
          }
        } catch (e) {}
      }
    }
  } catch (error) {
    if (error.name === "AbortError") {
      aborted = true;
    } else if (error.message !== "RateLimited" && error.message !== "BadResponse") {
      console.error(error);
      fullText = fullText || "⚠️ Something went wrong after a few attempts. Check your API key and connection.";
      wordQueue.push(fullText);
    }
  }

  streamDone = true;

  await new Promise((resolve) => {
    const check = setInterval(() => {
      if (wordQueue.length === 0) {
        clearInterval(check);
        resolve();
      }
    }, 50);
  });

  if (aborted) {
    fullText = fullText + (fullText ? " " : "") + "*(stopped)*";
  }

  conversationHistory.push({ role: "model", parts: [{ text: fullText }], timestamp: Date.now() });
  saveCurrentSession();
  renderMessages();
  speakText(fullText);

  sendBtn.classList.remove("hidden");
  stopBtn.classList.add("hidden");
  currentAbortController = null;
}

function stopGenerating() {
  if (currentAbortController) {
    currentAbortController.abort();
  }
}

// ---- Rendering ----

function renderMessages() {
  const container = document.getElementById("chatMessages");
  const overlay = document.getElementById("dropOverlay");
  container.innerHTML = "";
  if (overlay) container.appendChild(overlay);

  if (conversationHistory.length === 0) {
    renderWelcomeScreen(container);
    return;
  }

  conversationHistory.forEach((entry, index) => {
    container.appendChild(createMessageRow(entry, index));
  });

  container.scrollTop = container.scrollHeight;
}

function renderWelcomeScreen(container) {
  const welcome = document.createElement("div");
  welcome.classList.add("welcome-screen");

  const title = document.createElement("div");
  title.classList.add("welcome-title");
  title.textContent = "What can I help with?";
  welcome.appendChild(title);

  const chips = document.createElement("div");
  chips.classList.add("suggestion-chips");
  SUGGESTIONS.forEach((s) => {
    const chip = document.createElement("div");
    chip.classList.add("chip");
    chip.textContent = s;
    chip.onclick = () => sendMessage(s);
    chips.appendChild(chip);
  });
  welcome.appendChild(chips);

  container.appendChild(welcome);
}

function createMessageRow(entry, index) {
  const row = document.createElement("div");
  row.classList.add("message-row");
  row.id = `msg-${index}`;
  if (entry.role === "user") row.classList.add("user-row");

  if (entry.role === "model") {
    const avatar = document.createElement("div");
    avatar.classList.add("avatar");
    avatar.textContent = "AI";
    row.appendChild(avatar);
  }

  const col = document.createElement("div");
  col.classList.add("message-col");

  const textDiv = document.createElement("div");
  textDiv.classList.add("message-text");

  const rawText = entry.parts[0].text;
  const shownText = entry.displayText || rawText;

  if (entry.image) {
    const imgEl = document.createElement("img");
    imgEl.src = entry.image;
    imgEl.classList.add("message-image");
    col.appendChild(imgEl);
  }

  if (entry.role === "model") {
    textDiv.innerHTML = marked.parse(rawText);
    addCodeCopyButtons(textDiv);
  } else {
    textDiv.textContent = shownText;
  }

  col.appendChild(textDiv);

  const meta = document.createElement("div");
  meta.classList.add("message-meta");

  const time = document.createElement("span");
  time.classList.add("timestamp");
  time.textContent = formatTime(entry.timestamp || Date.now());
  meta.appendChild(time);

  const pinBtn = document.createElement("button");
  pinBtn.classList.add("msg-action-btn");
  pinBtn.textContent = entry.pinned ? "📌 Pinned" : "📌 Pin";
  pinBtn.onclick = () => togglePinMessage(index);
  meta.appendChild(pinBtn);

  if (entry.role === "user") {
    const editBtn = document.createElement("button");
    editBtn.classList.add("msg-action-btn");
    editBtn.textContent = "Edit";
    editBtn.onclick = () => editMessage(index);
    meta.appendChild(editBtn);
  } else {
    const copyBtn = document.createElement("button");
    copyBtn.classList.add("msg-action-btn");
    copyBtn.textContent = "Copy";
    copyBtn.onclick = () => navigator.clipboard.writeText(rawText);
    meta.appendChild(copyBtn);

    const regenBtn = document.createElement("button");
    regenBtn.classList.add("msg-action-btn");
    regenBtn.textContent = "Regenerate";
    regenBtn.onclick = () => regenerateResponse(index);
    meta.appendChild(regenBtn);

    const speakBtn = document.createElement("button");
    speakBtn.classList.add("msg-action-btn");
    speakBtn.textContent = "🔊 Play";
    speakBtn.onclick = () => speakText(rawText);
    meta.appendChild(speakBtn);
  }

  col.appendChild(meta);
  row.appendChild(col);

  return row;
}

function addCodeCopyButtons(container) {
  const blocks = container.querySelectorAll("pre");
  blocks.forEach((pre) => {
    const codeEl = pre.querySelector("code");
    if (!codeEl) return;
    if (pre.parentElement.classList.contains("code-block")) return;

    const wrapper = document.createElement("div");
    wrapper.classList.add("code-block");

    const header = document.createElement("div");
    header.classList.add("code-block-header");

    const btn = document.createElement("button");
    btn.classList.add("copy-code-btn");
    btn.textContent = "Copy";
    btn.onclick = () => {
      navigator.clipboard.writeText(codeEl.textContent);
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy"), 1500);
    };

    header.appendChild(btn);
    wrapper.appendChild(header);

    const preClone = pre.cloneNode(true);
    wrapper.appendChild(preClone);

    pre.replaceWith(wrapper);
  });
}

// ---- Pinned messages ----

function togglePinMessage(index) {
  const entry = conversationHistory[index];
  if (!entry) return;
  entry.pinned = !entry.pinned;
  renderMessages();
  renderPinnedBar();
  saveCurrentSession();
}

function renderPinnedBar() {
  const bar = document.getElementById("pinnedBar");
  if (!bar) return;

  const pinned = conversationHistory
    .map((entry, index) => ({ entry, index }))
    .filter((item) => item.entry.pinned);

  bar.innerHTML = "";

  if (pinned.length === 0) {
    bar.classList.add("hidden");
    return;
  }

  bar.classList.remove("hidden");

  pinned.forEach(({ entry, index }) => {
    const chip = document.createElement("div");
    chip.classList.add("pinned-chip");
    chip.textContent = (entry.displayText || entry.parts[0].text).slice(0, 40);
    chip.onclick = () => {
      const target = document.getElementById(`msg-${index}`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    bar.appendChild(chip);
  });
}

// ---- Edit / Regenerate ----

function editMessage(index) {
  const entry = conversationHistory[index];
  if (!entry) return;

  const input = document.getElementById("userInput");
  input.value = entry.displayText || entry.parts[0].text;
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
  input.focus();

  conversationHistory = conversationHistory.slice(0, index);
  renderMessages();
  renderPinnedBar();
  saveCurrentSession();
}

function regenerateResponse(index) {
  conversationHistory = conversationHistory.slice(0, index);
  renderMessages();
  renderPinnedBar();
  saveCurrentSession();
  streamBotReply();
}

// ---- Export ----

function exportChatAsMarkdown() {
  if (conversationHistory.length === 0) {
    alert("Nothing to export yet.");
    return;
  }

  let md = `# Chat export — ${new Date().toLocaleString()}\n\n`;
  conversationHistory.forEach((entry) => {
    const speaker = entry.role === "user" ? "**You**" : "**Assistant**";
    md += `${speaker}:\n\n${entry.displayText || entry.parts[0].text}\n\n---\n\n`;
  });

  const blob = new Blob([md], { type: "text/markdown" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `chat-${Date.now()}.md`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportChatAsPDF() {
  if (conversationHistory.length === 0) {
    alert("Nothing to export yet.");
    return;
  }
  if (typeof jspdf === "undefined") {
    alert("PDF library didn't load. Check your internet connection.");
    return;
  }

  const { jsPDF } = jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 40;
  let cursorY = 50;
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = doc.internal.pageSize.getWidth() - marginX * 2;

  doc.setFontSize(16);
  doc.text("Chat export", marginX, cursorY);
  cursorY += 24;
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(new Date().toLocaleString(), marginX, cursorY);
  cursorY += 24;
  doc.setTextColor(20);

  conversationHistory.forEach((entry) => {
    const speaker = entry.role === "user" ? "You" : "Assistant";
    doc.setFontSize(11);
    doc.setFont(undefined, "bold");

    if (cursorY > pageHeight - 60) {
      doc.addPage();
      cursorY = 50;
    }
    doc.text(speaker + ":", marginX, cursorY);
    cursorY += 16;

    doc.setFont(undefined, "normal");
    const lines = doc.splitTextToSize(entry.displayText || entry.parts[0].text, maxWidth);
    lines.forEach((line) => {
      if (cursorY > pageHeight - 60) {
        doc.addPage();
        cursorY = 50;
      }
      doc.text(line, marginX, cursorY);
      cursorY += 14;
    });
    cursorY += 14;
  });

  doc.save(`chat-${Date.now()}.pdf`);
}

// ---- Shareable links ----

async function shareCurrentSession() {
  const owner = getOwnerKey();
  let session = allSessions.find((s) => s.id === currentSessionId);
  if (!session || conversationHistory.length === 0) {
    alert("Nothing to share yet — send a message first.");
    return;
  }

  try {
    const { error } = await supabaseClient
      .from("sessions")
      .update({ is_shared: true })
      .eq("id", currentSessionId)
      .eq("owner", owner);

    if (error) {
      console.error("Supabase update error:", error);
      alert("Couldn't enable sharing: " + error.message);
      return;
    }

    session.is_shared = true;
    const shareUrl = `${location.origin}${location.pathname}?share=${currentSessionId}`;

    try {
      await navigator.clipboard.writeText(shareUrl);
      alert("Read-only link copied to clipboard:\n\n" + shareUrl);
    } catch (clipErr) {
      console.error("Clipboard error:", clipErr);
      alert("Sharing is enabled! Here's your link (couldn't auto-copy):\n\n" + shareUrl);
    }
  } catch (err) {
    console.error("Share failed:", err);
    alert("Something went wrong while sharing. Check the console for details.");
  }
}
async function loadSharedSessionIfPresent() {
  const params = new URLSearchParams(location.search);
  const shareId = params.get("share");
  if (!shareId) return false;

  const { data, error } = await supabaseClient
    .from("sessions")
    .select("*")
    .eq("id", shareId)
    .eq("is_shared", true)
    .single();

  if (error || !data) {
    document.body.innerHTML = "<div style='color:#E8EAED;text-align:center;padding:60px;font-family:sans-serif;'>This link is invalid or is no longer shared.</div>";
    return true;
  }

  document.getElementById("loginScreen").classList.add("hidden");
  document.querySelector(".sidebar").classList.add("hidden");
  document.querySelector(".input-bar").classList.add("hidden");
  document.getElementById("imagePreviewBar").classList.add("hidden");
  const filePreview = document.getElementById("filePreviewBar");
  if (filePreview) filePreview.classList.add("hidden");

  const banner = document.createElement("div");
  banner.textContent = "👁️ Viewing a shared, read-only conversation";
  banner.style.cssText = "background:rgba(74,124,158,0.2);color:#E8EAED;text-align:center;padding:8px;font-size:13px;";
  document.querySelector(".main").prepend(banner);

  conversationHistory = data.messages || [];
  renderMessages();

  document.querySelectorAll(".msg-action-btn").forEach((btn) => {
    if (btn.textContent !== "Copy") btn.remove();
  });

  return true;
}

// ---- Sessions (Supabase-backed, with folders + persona) ----

async function saveCurrentSession() {
  const owner = getOwnerKey();
  let session = allSessions.find((s) => s.id === currentSessionId);
  if (!session) {
    session = { id: currentSessionId, title: "New chat", folder: "General", persona: currentPersona, messages: [] };
    allSessions.push(session);
  }
  session.messages = conversationHistory;
  session.persona = currentPersona;

  const firstUserMsg = conversationHistory.find((m) => m.role === "user");
  if (firstUserMsg) {
    session.title = (firstUserMsg.displayText || firstUserMsg.parts[0].text).slice(0, 30);
  }

  await upsertSession(session, owner);
  renderHistoryList();
  renderFolderFilterOptions();
}

function newChat() {
  const owner = getOwnerKey();
  currentSessionId = Date.now().toString();
  conversationHistory = [];
  localStorage.setItem(`currentSessionId_${owner}`, currentSessionId);
  renderMessages();
  renderHistoryList();
  renderPinnedBar();
}

function clearChat() {
  conversationHistory = [];
  renderMessages();
  renderPinnedBar();
  saveCurrentSession();
}

async function renderHistoryList() {
  const owner = getOwnerKey();
  allSessions = await fetchAllSessions(owner);
  const list = document.getElementById("historyList");
  const filterEl = document.getElementById("folderFilter");
  const activeFilter = filterEl ? filterEl.value : "all";

  list.innerHTML = "";

  let sessionsToShow = allSessions.slice().reverse();
  if (activeFilter !== "all") {
    sessionsToShow = sessionsToShow.filter((s) => (s.folder || "General") === activeFilter);
  }

  sessionsToShow.forEach((session) => {
    const row = document.createElement("div");
    row.classList.add("history-item-row");

    const item = document.createElement("div");
    item.classList.add("history-item");
    if (session.id === currentSessionId) item.classList.add("active");
    item.textContent = session.title || "Untitled chat";
    item.onclick = () => loadSession(session.id);
    row.appendChild(item);

    const folderBtn = document.createElement("button");
    folderBtn.classList.add("folder-btn");
    folderBtn.textContent = "🏷️";
    folderBtn.title = `Folder: ${session.folder || "General"}`;
    folderBtn.onclick = (e) => {
      e.stopPropagation();
      assignFolder(session.id);
    };
    row.appendChild(folderBtn);

    list.appendChild(row);
  });
}

async function assignFolder(sessionId) {
  const session = allSessions.find((s) => s.id === sessionId);
  if (!session) return;
  const name = prompt("Folder name for this chat:", session.folder || "General");
  if (name === null) return;
  session.folder = name.trim() || "General";
  await upsertSession(session, getOwnerKey());
  renderHistoryList();
  renderFolderFilterOptions();
}

function renderFolderFilterOptions() {
  const filterEl = document.getElementById("folderFilter");
  if (!filterEl) return;
  const current = filterEl.value;

  const folders = Array.from(new Set(allSessions.map((s) => s.folder || "General"))).sort();

  filterEl.innerHTML = `<option value="all">All folders</option>`;
  folders.forEach((f) => {
    const opt = document.createElement("option");
    opt.value = f;
    opt.textContent = f;
    filterEl.appendChild(opt);
  });

  if (folders.includes(current)) filterEl.value = current;
}

function loadSession(id) {
  const session = allSessions.find((s) => s.id === id);
  if (!session) return;

  const owner = getOwnerKey();
  currentSessionId = id;
  conversationHistory = session.messages;
  currentPersona = session.persona || "default";
  document.getElementById("personaSelect").value = currentPersona;
  localStorage.setItem(`currentSessionId_${owner}`, currentSessionId);
  renderMessages();
  renderHistoryList();
  renderPinnedBar();
}