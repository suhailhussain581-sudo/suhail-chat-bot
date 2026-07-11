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

  if (window.innerWidth <= 768) {
    document.getElementById("sidebar").classList.add("collapsed");
  }

  const isSharedView = await loadSharedSessionIfPresent();
  if (isSharedView) return;

  setupInputAutoResize();
  setupVoiceInput();
  setupImageUpload();
  setupFileUpload();
  setupDragAndDrop();
  setupKeyboardShortcuts();
  setInterval(() => renderMessages(), 60000);

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
    { theme: "filled_black", size: "large", shape: "pill", text: "signin_with", logo_alignment: "left" }
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

  if (error) console.error("Failed to save session:", error);
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
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
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
    if (cmdOrCtrl && e.key.toLowerCase() === "k") { e.preventDefault(); newChat(); }
    if (cmdOrCtrl && e.key === "/") { e.preventDefault(); toggleShortcutsModal(); }
    if (cmdOrCtrl && e.key.toLowerCase() === "b") { e.preventDefault(); toggleSidebar(); }
    if (e.key === "Escape") {
      const modal = document.getElementById("shortcutsModal");
      if (modal && !modal.classList.contains("hidden")) modal.classList.add("hidden");
      closeOverflowMenu();
      closePlusMenu();
    }
  });
}

function toggleShortcutsModal() {
  document.getElementById("shortcutsModal")?.classList.toggle("hidden");
}

// ---- Overflow menu (full-screen overlay pattern) ----

function openOverflowMenu() {
  document.getElementById("overflowOverlay").classList.remove("hidden");
}

function closeOverflowMenu() {
  document.getElementById("overflowOverlay").classList.add("hidden");
}

// ---- Plus menu (image/file picker) ----

function togglePlusMenu() {
  document.getElementById("plusMenu").classList.toggle("hidden");
}

function closePlusMenu() {
  document.getElementById("plusMenu").classList.add("hidden");
}

document.addEventListener("click", (e) => {
  const plusWrapper = document.querySelector(".plus-wrapper");
  const plusMenu = document.getElementById("plusMenu");
  if (plusWrapper && plusMenu && !plusWrapper.contains(e.target)) {
    plusMenu.classList.add("hidden");
  }
});

// ---- Sidebar ----

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  sidebar.classList.toggle("collapsed");
  if (overlay) overlay.classList.toggle("hidden", sidebar.classList.contains("collapsed"));
}

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

// ---- File upload + drag-and-drop ----

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
    for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript;
    const input = document.getElementById("userInput");
    input.value = transcript;
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
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
  if (!speechEnabled || !window.speechSynthesis) return;
  const cleanText = stripForSpeech(text);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(speakWithVoice(cleanText));
}

function toggleSpeech() {
  speechEnabled = !speechEnabled;
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
    if (voiceModeActive) setTimeout(() => listenForVoiceMode(), 1000);
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
      if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
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
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${MISTRAL_API_KEY}` },
      body: JSON.stringify({ model: "mistral-small-latest", messages: apiMessages }),
    });

    const data = await response.json();
    fullText = data.error ? `⚠️ API error: ${data.error.message || "unknown error"}` : (data.choices?.[0]?.message?.content || "Sorry, I didn't catch that.");
  } catch (error) {
    console.error(error);
    fullText = "Something went wrong after a few attempts. Please try again.";
  }

  conversationHistory.push({ role: "model", parts: [{ text: fullText }], timestamp: Date.now() });
  saveCurrentSession();
  renderMessages();

  document.getElementById("voiceStatus").textContent = "Speaking...";
  document.getElementById("voiceOrb").classList.add("speaking");

  const utterance = speakWithVoice(stripForSpeech(fullText));
  utterance.onend = () => { if (voiceModeActive) listenForVoiceMode(); };
  
