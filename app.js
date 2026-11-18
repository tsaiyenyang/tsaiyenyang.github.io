const MAX_INPUT_BYTES = 500;
const TRANSLATE_FUNCTION = "/api/translate";
const TRANSLATE_ENDPOINT = "https://api.mymemory.translated.net/get";
const VOCABULARY_KEY = "lingua-vocabulary-v1";
const HISTORY_KEY = "lingua-history-v1";
const HISTORY_ENABLED_KEY = "lingua-history-enabled-v1";
const CHALLENGE_KEY = "lingua-challenges-v1";

const sourceText = document.querySelector("#source-text");
const translatedText = document.querySelector("#translated-text");
const translateButton = document.querySelector("#translate-button");
const clearButton = document.querySelector("#clear-button");
const copyButton = document.querySelector("#copy-button");
const speakButton = document.querySelector("#speak-button");
const outputPanel = document.querySelector(".output-panel");
const characterCount = document.querySelector("#character-count");
const resultBadge = document.querySelector("#result-badge");
const errorMessage = document.querySelector("#error-message");
const voiceLabel = document.querySelector("#voice-label");
const buttonLabel = translateButton.querySelector(".button-label");
const saveTranslationButton = document.querySelector("#save-translation-button");
const explainGrammarButton = document.querySelector("#explain-grammar-button");
const saveSelectionButton = document.querySelector("#save-selection-button");

let currentTranslation = "";
let currentOriginalText = "";
let englishVoices = [];
let requestController;
let successAnimationTimeout;
let copyAnimationTimeout;
let recognition;
let photoObjectUrl;

function setResultBadge(text, state = "") {
  resultBadge.textContent = text;
  resultBadge.className = `result-badge${state ? ` is-${state}` : ""}`;
}

function stopSpeaking() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  setSpeakingState(false);
}

function setSpeakingState(isSpeaking) {
  speakButton.classList.toggle("is-speaking", isSpeaking);
  speakButton.setAttribute(
    "aria-label",
    isSpeaking ? "Stop pronunciation" : "Play English pronunciation",
  );
  speakButton.title = isSpeaking ? "Stop speaking" : "Play English pronunciation";
}

function cancelPendingTranslation() {
  if (!requestController) {
    return;
  }

  requestController.abort();
  requestController = undefined;
  translateButton.disabled = false;
  translateButton.classList.remove("is-loading");
  outputPanel.classList.remove("is-loading");
  buttonLabel.textContent = "Translate";
}

function updateVoices() {
  if (!("speechSynthesis" in window)) {
    voiceLabel.textContent = "Speech is not supported by this browser";
    return;
  }

  englishVoices = window.speechSynthesis
    .getVoices()
    .filter((voice) => voice.lang.toLowerCase().startsWith("en"));

  const preferredVoice = englishVoices.find((voice) =>
    voice.lang.toLowerCase().startsWith("en-us"),
  );
  voiceLabel.textContent = preferredVoice
    ? `${preferredVoice.name} · English speech`
    : englishVoices.length > 0
      ? "English speech"
      : "Natural English speech";
}

function setTranslation(text) {
  window.clearTimeout(successAnimationTimeout);
  outputPanel.classList.remove("is-loading", "is-complete", "is-error");
  currentTranslation = text;
  translatedText.textContent = text || "Your translation will appear here";
  translatedText.classList.toggle("placeholder", !text);
  if (text) {
    translatedText.classList.remove("is-entering");
    void translatedText.offsetWidth;
    translatedText.classList.add("is-entering");
    outputPanel.classList.add("is-complete");
    successAnimationTimeout = window.setTimeout(() => {
      outputPanel.classList.remove("is-complete");
    }, 1400);
  } else {
    translatedText.classList.remove("is-entering");
  }
  copyButton.disabled = !text;
  speakButton.disabled = !text || !("speechSynthesis" in window);
  saveTranslationButton.disabled = !text;
  explainGrammarButton.disabled = !text;
  if (!text) {
    saveSelectionButton.disabled = true;
  }
  setResultBadge(text ? "Translation complete" : "Ready to translate", text ? "ready" : "");
}

translatedText.addEventListener("animationend", () => {
  translatedText.classList.remove("is-entering");
});

function normalizeChineseInput(text) {
  return text.replaceAll("幹麻", "幹嘛").replaceAll("干麻", "干嘛");
}

function getInputByteLength(text) {
  return new TextEncoder().encode(text).length;
}

function updateCharacterCount() {
  const byteLength = getInputByteLength(sourceText.value);
  characterCount.textContent = `${byteLength} / ${MAX_INPUT_BYTES} bytes`;
  characterCount.classList.toggle("is-over-limit", byteLength > MAX_INPUT_BYTES);
  return byteLength;
}

async function translateWithMyMemory(text, signal, targetLanguage = "en") {
  const query = new URLSearchParams({
    q: text,
    langpair: `autodetect|${targetLanguage}`,
  });
  const response = await fetch(`${TRANSLATE_ENDPOINT}?${query}`, { signal });
  if (!response.ok) {
    throw new Error(response.status === 429
      ? "The free translation service rate limit was reached. Wait before retrying this chunk."
      : `The free translation service is unavailable (HTTP ${response.status}). Please try again later.`);
  }

  const result = await response.json();
  if (result.responseStatus !== 200 || !result.responseData?.translatedText) {
    const details = typeof result.responseDetails === "string" ? result.responseDetails : "";
    throw new Error(details || "No translation found. Try rephrasing this chunk.");
  }

  const matchedSource = result.matches?.find((match) =>
    typeof match.source === "string" && match.source !== "autodetect",
  )?.source;
  return {
    translation: result.responseData.translatedText,
    detectedLanguage:
      result.responseData.detectedLanguage || matchedSource || "Detected automatically",
  };
}

async function translateText(text, signal, targetLanguage = "en") {
  let response;
  try {
    response = await fetch(TRANSLATE_FUNCTION, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, targetLanguage }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    return translateWithMyMemory(text, signal, targetLanguage);
  }

  if ([404, 405, 501].includes(response.status)) {
    return translateWithMyMemory(text, signal, targetLanguage);
  }
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(
      result?.error || "The translation service is unavailable. Please try again later.",
    );
  }

  const result = await response.json();
  if (typeof result.translation !== "string" || !result.translation.trim()) {
    throw new Error("The translation service returned an empty result. Please try again.");
  }
  return {
    translation: result.translation,
    detectedLanguage: result.detectedLanguage || "Detected automatically",
  };
}

sourceText.addEventListener("input", () => {
  updateCharacterCount();
  clearButton.disabled = sourceText.value.length === 0;
  errorMessage.hidden = true;
  outputPanel.classList.remove("is-error", "is-complete");
  if (requestController || currentTranslation) {
    cancelPendingTranslation();
    setTranslation("");
    currentOriginalText = "";
    stopSpeaking();
  }
});

clearButton.addEventListener("click", () => {
  cancelPendingTranslation();
  sourceText.value = "";
  currentOriginalText = "";
  updateCharacterCount();
  clearButton.disabled = true;
  errorMessage.hidden = true;
  stopSpeaking();
  setTranslation("");
  sourceText.focus();
});

translateButton.addEventListener("click", async () => {
  translateButton.classList.remove("is-pressed");
  void translateButton.offsetWidth;
  translateButton.classList.add("is-pressed");
  window.setTimeout(() => translateButton.classList.remove("is-pressed"), 440);

  const text = normalizeChineseInput(sourceText.value.trim());
  if (!text) {
    sourceText.focus();
    return;
  }

  const byteLength = getInputByteLength(text);
  if (byteLength > MAX_INPUT_BYTES) {
    errorMessage.textContent =
      `This text is ${byteLength} bytes. The limit is ${MAX_INPUT_BYTES} bytes ` +
      "(about 160 Chinese characters). Please shorten it and try again.";
    errorMessage.hidden = false;
    return;
  }

  cancelPendingTranslation();
  stopSpeaking();
  const controller = new AbortController();
  requestController = controller;
  translateButton.disabled = true;
  translateButton.classList.add("is-loading");
  buttonLabel.textContent = "Translating...";
  errorMessage.hidden = true;
  setTranslation("");
  translatedText.textContent = "Translating...";
  translatedText.classList.remove("placeholder");
  outputPanel.classList.add("is-loading");
  setResultBadge("Translating", "loading");

  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15000);

  try {
    const result = await translateText(text, controller.signal);
    currentOriginalText = text;
    setTranslation(result.translation);
    saveHistoryEntry(text, result.detectedLanguage, result.translation);
  } catch (error) {
    if (requestController !== controller) {
      return;
    }
    if (controller.signal.aborted && !timedOut) {
      return;
    }
    if (timedOut || error.name === "AbortError") {
      errorMessage.textContent = "Translation timed out. Check your connection and try again.";
    } else {
      errorMessage.textContent =
        error instanceof Error
          ? error.message
          : "Something went wrong during translation. Please try again later.";
    }
    errorMessage.hidden = false;
    outputPanel.classList.remove("is-loading");
    outputPanel.classList.remove("is-complete");
    outputPanel.classList.add("is-error");
    translatedText.textContent = "Translation failed. Please try again.";
    translatedText.classList.add("placeholder");
    translatedText.classList.remove("is-entering");
    void translatedText.offsetWidth;
    translatedText.classList.add("is-entering");
    setResultBadge("Translation failed");
  } finally {
    window.clearTimeout(timeoutId);
    if (requestController === controller) {
      translateButton.disabled = false;
      translateButton.classList.remove("is-loading");
      buttonLabel.textContent = "Translate";
      requestController = undefined;
    }
  }
});

sourceText.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    translateButton.click();
  }
});

function copyTextFallback(text) {
  const activeElement = document.activeElement;
  const temporaryInput = document.createElement("textarea");
  temporaryInput.value = text;
  temporaryInput.setAttribute("readonly", "");
  temporaryInput.style.position = "fixed";
  temporaryInput.style.opacity = "0";
  temporaryInput.style.pointerEvents = "none";
  document.body.append(temporaryInput);
  temporaryInput.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    temporaryInput.remove();
    if (activeElement instanceof HTMLElement && activeElement.isConnected) {
      activeElement.focus();
    }
  }
  return copied;
}

copyButton.addEventListener("click", async () => {
  if (!currentTranslation) {
    return;
  }

  let copied = false;
  try {
    await navigator.clipboard.writeText(currentTranslation);
    copied = true;
  } catch {
    copied = copyTextFallback(currentTranslation);
  }

  if (copied) {
    window.clearTimeout(copyAnimationTimeout);
    copyButton.classList.remove("is-copied");
    void copyButton.offsetWidth;
    copyButton.classList.add("is-copied");
    copyButton.setAttribute("aria-label", "Translation copied");
    copyButton.title = "Copied";
    copyAnimationTimeout = window.setTimeout(() => {
      copyButton.classList.remove("is-copied");
      copyButton.setAttribute("aria-label", "Copy English translation");
      copyButton.title = "Copy translation";
    }, 1500);
  } else {
    errorMessage.textContent = "Unable to access the clipboard. Please copy the translation manually.";
    errorMessage.hidden = false;
  }
});

speakButton.addEventListener("click", () => {
  if (!currentTranslation || !("speechSynthesis" in window)) {
    return;
  }

  if (speakButton.classList.contains("is-speaking")) {
    stopSpeaking();
    return;
  }

  stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(currentTranslation);
  utterance.lang = "en-US";
  const preferredVoice = englishVoices.find((voice) =>
    voice.lang.toLowerCase().startsWith("en-us"),
  );
  if (preferredVoice) {
    utterance.voice = preferredVoice;
  }
  utterance.onend = () => setSpeakingState(false);
  utterance.onerror = () => setSpeakingState(false);
  setSpeakingState(true);
  window.speechSynthesis.speak(utterance);
});

if ("speechSynthesis" in window) {
  updateVoices();
  window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
} else {
  updateVoices();
}

const appViews = [...document.querySelectorAll(".app-view")];
const navTabs = [...document.querySelectorAll(".nav-tab")];

function showView(viewId) {
  appViews.forEach((view) => {
    const active = view.id === viewId;
    view.hidden = !active;
    view.classList.toggle("is-active", active);
  });
  navTabs.forEach((tab) => {
    const active = tab.dataset.view === viewId;
    tab.classList.toggle("is-active", active);
    if (active) {
      tab.setAttribute("aria-current", "page");
    } else {
      tab.removeAttribute("aria-current");
    }
  });
  window.scrollTo({
    top: 0,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
}

navTabs.forEach((tab) => {
  tab.addEventListener("click", () => showView(tab.dataset.view));
});

function readLocalData(key, fallback, reportError) {
  try {
    const saved = window.localStorage.getItem(key);
    return saved === null ? fallback : JSON.parse(saved);
  } catch {
    reportError("Saved data could not be read in this browser.");
    return fallback;
  }
}

function writeLocalData(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

const vocabularyList = document.querySelector("#vocabulary-list");
const vocabularyEmpty = document.querySelector("#vocabulary-empty");
const vocabularySearch = document.querySelector("#vocabulary-search");
const vocabularyCount = document.querySelector("#vocabulary-count");
const vocabularyDialog = document.querySelector("#vocabulary-dialog");
const vocabularyForm = document.querySelector("#vocabulary-form");
const vocabWord = document.querySelector("#vocab-word");
const vocabOriginal = document.querySelector("#vocab-original");
const vocabTranslation = document.querySelector("#vocab-translation");
const vocabNotes = document.querySelector("#vocab-notes");
const vocabFormError = document.querySelector("#vocab-form-error");
let vocabulary = readLocalData(VOCABULARY_KEY, [], (message) => {
  vocabularyEmpty.textContent = message;
});
if (!Array.isArray(vocabulary)) {
  vocabulary = [];
  vocabularyEmpty.textContent = "The saved notebook data could not be read. You can start a new one.";
}

function saveVocabulary() {
  writeLocalData(VOCABULARY_KEY, vocabulary);
  renderVocabulary();
}

function openVocabularyForm(word, original = currentOriginalText, translation = currentTranslation) {
  vocabWord.value = word.trim();
  vocabOriginal.value = original;
  vocabTranslation.value = translation;
  vocabNotes.value = "";
  vocabFormError.hidden = true;
  vocabularyDialog.showModal();
  vocabWord.focus();
}

function renderVocabulary() {
  const query = vocabularySearch.value.trim().toLocaleLowerCase();
  const filtered = vocabulary
    .filter((entry) =>
      [entry.word, entry.original, entry.translation, entry.notes]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query),
    )
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.createdAt - a.createdAt);
  vocabularyList.replaceChildren();
  vocabularyEmpty.hidden = filtered.length > 0;
  if (vocabulary.length > 0 && filtered.length === 0) {
    vocabularyEmpty.textContent = "No matching words in your notebook.";
  } else if (vocabulary.length === 0) {
    vocabularyEmpty.textContent = "Your notebook is waiting for its first lovely word ♡";
  }
  vocabularyCount.textContent = `${vocabulary.length} ${vocabulary.length === 1 ? "word" : "words"} saved`;

  filtered.forEach((entry) => {
    const card = createElement("article", "word-card");
    const heading = createElement("div", "word-card-heading");
    heading.append(
      createElement("h3", "", entry.word),
      createElement("span", "word-date", new Date(entry.createdAt).toLocaleDateString()),
    );
    const translation = createElement("p", "word-translation", entry.translation);
    const original = createElement("p", "word-original", `From: ${entry.original || "—"}`);
    const notes = createElement("p", "word-notes", entry.notes || "Add a note to remember this word.");
    const actions = createElement("div", "card-actions");
    const favorite = createElement("button", "small-pastel-button", entry.favorite ? "★ Favorite" : "☆ Favorite");
    favorite.type = "button";
    favorite.setAttribute("aria-pressed", String(Boolean(entry.favorite)));
    favorite.addEventListener("click", () => {
      entry.favorite = !entry.favorite;
      try {
        saveVocabulary();
      } catch {
        entry.favorite = !entry.favorite;
        renderVocabulary();
        vocabularyEmpty.hidden = false;
        vocabularyEmpty.textContent = "Could not save your favorite. Check browser storage settings.";
      }
    });
    const listen = createElement("button", "small-pastel-button", "▶ Listen");
    listen.type = "button";
    listen.addEventListener("click", () => speakEnglish(entry.word));
    const edit = createElement("button", "small-pastel-button", "✎ Note");
    edit.type = "button";
    edit.addEventListener("click", () => {
      const updated = window.prompt("Add a personal note:", entry.notes || "");
      if (updated === null) {
        return;
      }
      const previousNotes = entry.notes;
      entry.notes = updated.trim();
      try {
        saveVocabulary();
      } catch {
        entry.notes = previousNotes;
        renderVocabulary();
        vocabularyEmpty.hidden = false;
        vocabularyEmpty.textContent = "Could not save your note. Check browser storage settings.";
      }
    });
    const remove = createElement("button", "small-pastel-button delete-action", "Delete");
    remove.type = "button";
    remove.addEventListener("click", () => {
      const previous = vocabulary;
      vocabulary = vocabulary.filter((item) => item.id !== entry.id);
      try {
        saveVocabulary();
      } catch {
        vocabulary = previous;
        renderVocabulary();
        vocabularyEmpty.hidden = false;
        vocabularyEmpty.textContent = "Could not update your notebook. Check browser storage settings.";
      }
    });
    actions.append(favorite, listen, edit, remove);
    card.append(heading, translation, original, notes, actions);
    vocabularyList.append(card);
  });
}

vocabularySearch.addEventListener("input", renderVocabulary);
document.querySelector(".dialog-close").addEventListener("click", () => vocabularyDialog.close());
vocabularyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const word = vocabWord.value.trim();
  if (!word) {
    vocabFormError.textContent = "Add an English word or phrase first.";
    vocabFormError.hidden = false;
    return;
  }
  if (vocabulary.some((entry) => entry.word.toLocaleLowerCase() === word.toLocaleLowerCase())) {
    vocabFormError.textContent = "That word is already in your notebook. Try editing its note instead.";
    vocabFormError.hidden = false;
    return;
  }
  vocabulary.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    word,
    original: vocabOriginal.value.trim(),
    translation: vocabTranslation.value.trim(),
    notes: vocabNotes.value.trim(),
    createdAt: Date.now(),
    favorite: false,
  });
  try {
    saveVocabulary();
    vocabularyDialog.close();
  } catch {
    vocabulary.shift();
    vocabFormError.textContent = "Could not save this word. Check browser storage settings and try again.";
    vocabFormError.hidden = false;
  }
});

saveTranslationButton.addEventListener("click", () => {
  if (currentTranslation) {
    openVocabularyForm(currentTranslation);
  }
});

function updateSelectedPhraseButton() {
  const selection = window.getSelection()?.toString().trim() || "";
  const inTranslation = window.getSelection()?.anchorNode &&
    translatedText.contains(window.getSelection().anchorNode);
  saveSelectionButton.disabled = !currentTranslation || !selection || !inTranslation;
  saveSelectionButton.textContent = selection && inTranslation
    ? `Save “${selection.slice(0, 24)}${selection.length > 24 ? "…" : ""}”`
    : "Save selected words";
}

document.addEventListener("selectionchange", updateSelectedPhraseButton);
saveSelectionButton.addEventListener("click", () => {
  const selection = window.getSelection()?.toString().trim();
  if (selection && translatedText.contains(window.getSelection()?.anchorNode)) {
    openVocabularyForm(selection);
  }
});

const historyList = document.querySelector("#history-list");
const historyEmpty = document.querySelector("#history-empty");
const historySearch = document.querySelector("#history-search");
const historyEnabled = document.querySelector("#history-enabled");
let historyEntries = readLocalData(HISTORY_KEY, [], (message) => {
  historyEmpty.textContent = message;
});
if (!Array.isArray(historyEntries)) {
  historyEntries = [];
  historyEmpty.textContent = "The saved diary data could not be read. New entries can still be saved.";
}
const historyPreference = readLocalData(HISTORY_ENABLED_KEY, true, (message) => {
  historyEmpty.textContent = message;
});
historyEnabled.checked = typeof historyPreference === "boolean" ? historyPreference : true;

function saveHistoryEntry(original, language, translation) {
  if (!historyEnabled.checked) {
    return;
  }
  const entry = {
    id: `${Date.now()}-${Math.random()}`,
    original,
    language: language || "Detected automatically",
    translation,
    createdAt: Date.now(),
  };
  historyEntries.unshift(entry);
  historyEntries = historyEntries.slice(0, 100);
  try {
    writeLocalData(HISTORY_KEY, historyEntries);
    renderHistory();
  } catch {
    historyEntries.shift();
    historyEmpty.hidden = false;
    historyEmpty.textContent = "This translation worked, but browser storage could not save it.";
  }
}

function renderHistory() {
  const query = historySearch.value.trim().toLocaleLowerCase();
  const filtered = historyEntries.filter((entry) =>
    [entry.original, entry.translation, entry.language].join(" ").toLocaleLowerCase().includes(query),
  );
  historyList.replaceChildren();
  historyEmpty.hidden = filtered.length > 0;
  historyEmpty.textContent = historyEntries.length === 0
    ? historyEnabled.checked
      ? "Your diary is ready for a first entry ♡"
      : "History saving is turned off. Turn it on whenever you like."
    : "No matching translations in your diary.";
  filtered.forEach((entry) => {
    const card = createElement("article", "history-card");
    const header = createElement("div", "history-card-heading");
    header.append(
      createElement("span", "language-stamp", entry.language),
      createElement("time", "word-date", new Date(entry.createdAt).toLocaleString()),
    );
    const original = createElement("p", "history-original", entry.original);
    const translation = createElement("p", "history-translation", entry.translation);
    const actions = createElement("div", "card-actions");
    const copy = createElement("button", "small-pastel-button", "Copy English");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(entry.translation);
      } catch {
        if (!copyTextFallback(entry.translation)) {
          errorMessage.textContent = "Unable to access the clipboard. Please copy the text manually.";
          errorMessage.hidden = false;
        }
      }
    });
    const reuse = createElement("button", "small-pastel-button", "Use again");
    reuse.type = "button";
    reuse.addEventListener("click", () => {
      sourceText.value = entry.original;
      updateCharacterCount();
      clearButton.disabled = !sourceText.value;
      showView("translate-view");
      sourceText.focus();
    });
    const remove = createElement("button", "small-pastel-button delete-action", "Delete");
    remove.type = "button";
    remove.addEventListener("click", () => {
      const previous = historyEntries;
      historyEntries = historyEntries.filter((item) => item.id !== entry.id);
      try {
        writeLocalData(HISTORY_KEY, historyEntries);
        renderHistory();
      } catch {
        historyEntries = previous;
        renderHistory();
        historyEmpty.hidden = false;
        historyEmpty.textContent = "Could not update the diary. Check browser storage settings.";
      }
    });
    actions.append(copy, reuse, remove);
    card.append(header, original, translation, actions);
    historyList.append(card);
  });
}

historySearch.addEventListener("input", renderHistory);
historyEnabled.addEventListener("change", () => {
  try {
    writeLocalData(HISTORY_ENABLED_KEY, historyEnabled.checked);
    renderHistory();
  } catch {
    historyEnabled.checked = !historyEnabled.checked;
    historyEmpty.hidden = false;
    historyEmpty.textContent = "Could not update this privacy setting. Check browser storage settings.";
  }
});
document.querySelector("#clear-history-button").addEventListener("click", () => {
  if (!historyEntries.length || !window.confirm("Clear all saved translations from this browser?")) {
    return;
  }
  const previous = historyEntries;
  historyEntries = [];
  try {
    writeLocalData(HISTORY_KEY, historyEntries);
    renderHistory();
  } catch {
    historyEntries = previous;
    historyEmpty.hidden = false;
    historyEmpty.textContent = "Could not clear the diary. Check browser storage settings.";
  }
});

function speakEnglish(text) {
  if (!("speechSynthesis" in window) || !text) {
    return;
  }
  stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  const preferredVoice = englishVoices.find((voice) =>
    voice.lang.toLowerCase().startsWith("en-us"),
  );
  if (preferredVoice) {
    utterance.voice = preferredVoice;
  }
  window.speechSynthesis.speak(utterance);
}

const voiceStartButton = document.querySelector("#voice-start-button");
const voiceStopButton = document.querySelector("#voice-stop-button");
const voiceStatus = document.querySelector("#voice-status");
const voiceLanguage = document.querySelector("#voice-language");
const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;

if (!SpeechRecognitionApi) {
  voiceStartButton.disabled = true;
  voiceStatus.textContent = "Voice input is not supported in this browser. You can still type or paste text.";
} else {
  recognition = new SpeechRecognitionApi();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onstart = () => {
    voiceStartButton.disabled = true;
    voiceStopButton.disabled = false;
    voiceStartButton.classList.add("is-listening");
    voiceStatus.textContent = "Listening… speak naturally. Select Stop when you are finished.";
  };
  recognition.onresult = (event) => {
    let transcript = "";
    for (let index = 0; index < event.results.length; index += 1) {
      transcript += event.results[index][0].transcript;
    }
    sourceText.value = transcript.trim();
    sourceText.dispatchEvent(new Event("input", { bubbles: true }));
  };
  recognition.onerror = (event) => {
    const messages = {
      "not-allowed": "Microphone permission was denied. Allow microphone access in browser settings to use voice input.",
      "service-not-allowed": "The browser speech service is unavailable. Try typing your text instead.",
      "audio-capture": "No microphone was found. Connect a microphone or type your text.",
      network: "Voice recognition needs an internet connection in this browser.",
    };
    voiceStatus.textContent = messages[event.error] || `Voice input stopped (${event.error}). Please try again or type your text.`;
  };
  recognition.onend = () => {
    voiceStartButton.disabled = false;
    voiceStopButton.disabled = true;
    voiceStartButton.classList.remove("is-listening");
    if (voiceStatus.textContent.startsWith("Listening")) {
      voiceStatus.textContent = sourceText.value
        ? "Words added. Review and edit them before translating."
        : "No words were recognized. Try again or type your text.";
    }
  };
  voiceStartButton.addEventListener("click", () => {
    recognition.lang = voiceLanguage.value;
    try {
      recognition.start();
    } catch (error) {
      voiceStatus.textContent = error.name === "InvalidStateError"
        ? "Voice input is already listening. Select Stop before starting again."
        : "Voice input could not start. Check microphone permission and try again.";
    }
  });
  voiceStopButton.addEventListener("click", () => recognition.stop());
}

const challengeBank = [
  { category: "VOCABULARY", question: "Which word means “very small”?", options: ["Tiny", "Wide", "Loud"], answer: 0, explanation: "“Tiny” means very small." },
  { category: "GRAMMAR", question: "She ___ coffee every morning.", options: ["drink", "drinks", "drinking"], answer: 1, explanation: "Use “drinks” with he, she, or it in the simple present." },
  { category: "VOCABULARY", question: "What is the opposite of “early”?", options: ["Late", "Fast", "Soon"], answer: 0, explanation: "“Late” is the opposite of “early”." },
  { category: "SENTENCE", question: "Choose the natural sentence.", options: ["I am agree.", "I agree.", "I agreeing."], answer: 1, explanation: "“Agree” is a verb, so say “I agree,” not “I am agree.”" },
  { category: "VOCABULARY", question: "If you are “delighted,” how do you feel?", options: ["Very happy", "Very tired", "A little cold"], answer: 0, explanation: "“Delighted” means very pleased or happy." },
  { category: "GRAMMAR", question: "Yesterday, we ___ a film.", options: ["watch", "watched", "watching"], answer: 1, explanation: "“Yesterday” points to the past, so use “watched.”" },
  { category: "VOCABULARY", question: "What does “borrow” mean?", options: ["Use something and return it", "Give something away forever", "Make something new"], answer: 0, explanation: "To borrow is to use something that belongs to someone else and return it." },
  { category: "SENTENCE", question: "Complete the polite request: “___ you help me, please?”", options: ["Could", "Are", "Have"], answer: 0, explanation: "“Could you…?” is a polite way to ask for help." },
  { category: "GRAMMAR", question: "They ___ dinner right now.", options: ["cook", "cooked", "are cooking"], answer: 2, explanation: "Use “are cooking” for an action happening now." },
  { category: "VOCABULARY", question: "A “quiet” place is…", options: ["Not noisy", "Very busy", "Very bright"], answer: 0, explanation: "“Quiet” means making little or no noise." },
  { category: "GRAMMAR", question: "There ___ two apples on the table.", options: ["is", "are", "was"], answer: 1, explanation: "Use “are” with a plural noun such as “two apples.”" },
  { category: "VOCABULARY", question: "What does “improve” mean?", options: ["Become better", "Become smaller", "Stop working"], answer: 0, explanation: "To improve means to become or make something better." },
  { category: "SENTENCE", question: "Choose the correct word: “I have lived here ___ 2022.”", options: ["for", "since", "during"], answer: 1, explanation: "Use “since” with the time when something started." },
  { category: "GRAMMAR", question: "My friends ___ from Spain.", options: ["is", "am", "are"], answer: 2, explanation: "Use “are” with the plural subject “my friends.”" },
  { category: "VOCABULARY", question: "If something is “affordable,” it is…", options: ["Not too expensive", "Hard to find", "Very old"], answer: 0, explanation: "“Affordable” means you have enough money to buy it." },
  { category: "GRAMMAR", question: "I ___ to the shop when you called.", options: ["walk", "was walking", "am walk"], answer: 1, explanation: "Use “was walking” for an action in progress when another past event happened." },
  { category: "VOCABULARY", question: "What does “instead” mean?", options: ["As another choice", "At the same time", "Very carefully"], answer: 0, explanation: "“Instead” means as a replacement or another choice." },
  { category: "SENTENCE", question: "Complete: “When it rains, we ___ at home.”", options: ["stay", "stayed", "staying"], answer: 0, explanation: "Use the present simple for a usual result: “When it rains, we stay at home.”" },
  { category: "VOCABULARY", question: "A “neighbor” is someone who…", options: ["Lives near you", "Works at your school", "Travels with you"], answer: 0, explanation: "A neighbor is a person who lives near you." },
  { category: "GRAMMAR", question: "This book is ___ than that one.", options: ["interesting", "more interesting", "most interesting"], answer: 1, explanation: "Use “more interesting” to compare two things." },
  { category: "VOCABULARY", question: "What does “appointment” mean?", options: ["A planned meeting", "A kind of food", "A long journey"], answer: 0, explanation: "An appointment is an arranged time to meet someone or visit a place." },
  { category: "GRAMMAR", question: "Have you ___ your homework yet?", options: ["finish", "finished", "finishing"], answer: 1, explanation: "Present perfect uses “have” plus the past participle: “have finished.”" },
  { category: "VOCABULARY", question: "If you “notice” something, you…", options: ["See or become aware of it", "Forget it quickly", "Change it"], answer: 0, explanation: "To notice is to see or become aware of something." },
  { category: "SENTENCE", question: "Choose the correct sentence.", options: ["There is many people.", "There are many people.", "There be many people."], answer: 1, explanation: "Use “are” with the plural noun “people.”" },
  { category: "GRAMMAR", question: "The email ___ yesterday.", options: ["sent", "was sent", "is send"], answer: 1, explanation: "“Was sent” is the past passive form: the email received the action." },
  { category: "VOCABULARY", question: "What does “probably” mean?", options: ["Likely, but not certain", "Definitely not", "A long time ago"], answer: 0, explanation: "“Probably” means something is likely to happen or be true." },
  { category: "GRAMMAR", question: "I enjoy ___ new words.", options: ["learn", "to learning", "learning"], answer: 2, explanation: "The verb “enjoy” is followed by a verb ending in -ing: “enjoy learning.”" },
  { category: "VOCABULARY", question: "A “crowded” bus has…", options: ["Many people in it", "No seats at all times", "Very quiet music"], answer: 0, explanation: "“Crowded” means full of people." },
  { category: "SENTENCE", question: "Complete: “I’m looking forward ___ you.”", options: ["to see", "to seeing", "see"], answer: 1, explanation: "The phrase is “look forward to,” and “to” is followed by a noun or -ing form." },
  { category: "GRAMMAR", question: "This is the ___ cake I have ever tasted.", options: ["good", "better", "best"], answer: 2, explanation: "Use the superlative “best” when comparing one thing with all others." },
];

const today = new Date().toISOString().slice(0, 10);
const challengeQuestion = challengeBank[Math.floor(Date.now() / 86400000) % challengeBank.length];
const challengeId = `daily-${today}`;
const challengeQuestionElement = document.querySelector("#challenge-question");
const challengeOptions = document.querySelector("#challenge-options");
const challengeFeedback = document.querySelector("#challenge-feedback");
const challengeCategory = document.querySelector("#challenge-category");
const challengeHistory = document.querySelector("#challenge-history");
const challengeCount = document.querySelector("#challenge-count");
const streakCount = document.querySelector("#streak-count");
let completedChallenges = readLocalData(CHALLENGE_KEY, [], (message) => {
  challengeFeedback.hidden = false;
  challengeFeedback.textContent = message;
});
if (!Array.isArray(completedChallenges)) {
  completedChallenges = [];
  challengeFeedback.hidden = false;
  challengeFeedback.textContent = "Saved challenge data could not be read. New progress can still be saved.";
}

function getCompletedStreak() {
  const completedDays = new Set(completedChallenges.map((entry) => entry.date));
  let date = new Date(`${today}T00:00:00Z`);
  if (!completedDays.has(today)) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  let streak = 0;
  while (completedDays.has(date.toISOString().slice(0, 10))) {
    streak += 1;
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return streak;
}

function renderChallenge() {
  challengeCategory.textContent = challengeQuestion.category;
  challengeQuestionElement.textContent = challengeQuestion.question;
  challengeOptions.replaceChildren();
  const completedToday = completedChallenges.some((entry) => entry.date === today);
  challengeQuestion.options.forEach((option, index) => {
    const button = createElement("button", "challenge-option", option);
    button.type = "button";
    button.disabled = completedToday;
    button.addEventListener("click", () => {
      const correct = index === challengeQuestion.answer;
      challengeFeedback.hidden = false;
      challengeFeedback.classList.toggle("is-correct", correct);
      challengeFeedback.textContent = correct
        ? `That’s right! ${challengeQuestion.explanation} ✨`
        : `Not quite. The answer is “${challengeQuestion.options[challengeQuestion.answer]}.” ${challengeQuestion.explanation} Try the question once more.`;
      if (!correct) {
        return;
      }
      completedChallenges.unshift({
        id: challengeId,
        date: today,
        category: challengeQuestion.category,
        question: challengeQuestion.question,
        answer: challengeQuestion.options[challengeQuestion.answer],
      });
      try {
        writeLocalData(CHALLENGE_KEY, completedChallenges);
        renderChallenge();
        window.dispatchEvent(new CustomEvent("lingua:daily-challenge-completed", {
          detail: { challengeId },
        }));
      } catch {
        completedChallenges.shift();
        challengeFeedback.textContent = "Correct! But this browser could not save your progress.";
      }
    });
    challengeOptions.append(button);
  });
  if (completedToday) {
    challengeFeedback.hidden = false;
    challengeFeedback.classList.add("is-correct");
    challengeFeedback.textContent = "You completed today’s challenge! Come back tomorrow for a new one ♡";
  } else if (challengeFeedback.textContent.startsWith("You completed")) {
    challengeFeedback.hidden = true;
  }
  challengeCount.textContent = String(completedChallenges.length);
  streakCount.textContent = String(getCompletedStreak());
  challengeHistory.replaceChildren();
  completedChallenges.slice(0, 7).forEach((entry) => {
    const item = createElement("p", "challenge-history-item");
    item.append(
      createElement("span", "", new Date(`${entry.date}T00:00:00`).toLocaleDateString()),
      createElement("b", "", entry.answer),
      createElement("span", "", entry.question),
    );
    challengeHistory.append(item);
  });
  if (completedChallenges.length === 0) {
    challengeHistory.append(createElement("p", "empty-note", "Your first little win will appear here."));
  }
}

renderVocabulary();
renderHistory();
renderChallenge();

const CAT_HOME_KEY = "lingua-cats-cozy-home-v1";
const CAT_REWARD_COINS = { easy: 10, medium: 20, hard: 30 };
const CAT_ASSET_BASE = "assets/cats-cozy-home/sprites/";
const CAT_FURNITURE = [
  { id: "bed", name: "Princess canopy bed", category: "bedroom", sprite: "princess-bed", price: 60, size: 28 },
  { id: "sofa", name: "Pink parlor sofa", category: "furniture", sprite: "sofa", price: 90, size: 28 },
  { id: "table", name: "Heart tea table", category: "furniture", sprite: "coffee-table", price: 35, size: 25 },
  { id: "chair", name: "Lavender armchair", category: "furniture", sprite: "armchair", price: 25, size: 22 },
  { id: "rug", name: "Rose medallion rug", category: "furniture", sprite: "heart-rug", price: 30, size: 28 },
  { id: "curtains", name: "Canopy curtains", category: "decor", sprite: "curtains", price: 45, size: 21, shopAvailable: false },
  { id: "plant", name: "Rose planter", category: "decor", sprite: "rose-planter", price: 20, size: 18 },
  { id: "lamp", name: "Pleated table lamp", category: "decor", sprite: "table-lamp", price: 40, size: 16 },
  { id: "cat-tree", name: "Princess cat tree", category: "cat", sprite: "cat-tree", price: 120, size: 21 },
  { id: "toy", name: "Yarn ball", category: "cat", sprite: "yarn-ball", price: 15, size: 12, shopAvailable: false },
  { id: "wall-art", name: "Heart vanity mirror", category: "decor", sprite: "wall-mirror", price: 22, size: 20 },
  { id: "heart-bed", name: "Heart-shaped bed", category: "bedroom", sprite: "heart-bed", price: 105, size: 27 },
  { id: "heart-bookcase", name: "Heart bookcase", category: "decor", sprite: "heart-bookcase", price: 78, size: 24 },
  { id: "vanity", name: "Princess vanity", category: "bedroom", sprite: "vanity", price: 86, size: 25 },
  { id: "vanity-stool", name: "Vanity stool", category: "bedroom", sprite: "vanity-stool", price: 32, size: 17 },
  { id: "bookshelf", name: "Storybook shelf", category: "decor", sprite: "bookshelf", price: 68, size: 21 },
  { id: "candelabra", name: "Golden candelabra", category: "decor", sprite: "candelabra", price: 52, size: 14 },
  { id: "heart-lamp", name: "Heart-shaped lamp", category: "decor", sprite: "heart-lamp", price: 46, size: 15 },
  { id: "balloon-tree", name: "Heart balloon tree", category: "decor", sprite: "balloon-tree", price: 72, size: 19 },
  { id: "cat-bed", name: "Kitten nest", category: "cat", sprite: "cat-bed", price: 42, size: 21 },
  { id: "food-bowls", name: "Twin food bowls", category: "cat", sprite: "food-bowls", price: 28, size: 20 },
  { id: "toy-basket", name: "Toy basket", category: "cat", sprite: "toy-basket", price: 36, size: 20 },
];
const CAT_FOOD = [
  { id: "kibble", name: "Crunchy cat kibble", sprite: "food-kibble", price: 12, fullness: 22, happiness: 3, message: "Crunch, crunch! A satisfying bowl of cat kibble." },
  { id: "canned", name: "Chicken pâté", sprite: "food-canned", price: 16, fullness: 28, happiness: 6, message: "Your kitty loves its little serving of cat-formulated chicken pâté." },
  { id: "fish", name: "Fresh fish meal", sprite: "food-fish", price: 18, fullness: 24, happiness: 8, message: "A fishy favorite made just for your kitten." },
  { id: "tuna", name: "Tuna bites", sprite: "food-tuna", price: 17, fullness: 22, happiness: 7, message: "Tiny tuna bites make a delightful cat-safe treat." },
  { id: "chicken", name: "Chicken morsels", sprite: "food-chicken", price: 15, fullness: 20, happiness: 6, message: "Your kitten happily nibbles its plain chicken morsels." },
  { id: "heart-treats", name: "Heart-shaped cat treats", sprite: "food-heart-treats", price: 10, fullness: 10, happiness: 12, message: "A little heart-shaped cat treat brings a big purr." },
  { id: "strawberry-treats", name: "Strawberry cat treats", sprite: "food-strawberry-treats", price: 11, fullness: 10, happiness: 11, message: "These strawberry-shaped treats are specially made for cats." },
];

const CAT_QUIZ_BANK = [
  { id: "cat-v-e-01", category: "vocabulary", difficulty: "easy", prompt: "What does “gentle” mean?", options: ["Kind and soft", "Very loud", "In a hurry"], answer: "Kind and soft", explanation: "Gentle means kind, careful, or not rough." },
  { id: "cat-v-e-02", category: "vocabulary", difficulty: "easy", prompt: "A “tiny” kitten is…", options: ["Very small", "Very noisy", "Very old"], answer: "Very small", explanation: "Tiny means very small." },
  { id: "cat-v-e-03", category: "vocabulary", difficulty: "easy", prompt: "If you are “thirsty,” you want…", options: ["A drink", "A blanket", "A new book"], answer: "A drink", explanation: "Thirsty means you want or need something to drink." },
  { id: "cat-v-e-04", category: "vocabulary", difficulty: "easy", prompt: "What is the opposite of “noisy”?", options: ["Quiet", "Busy", "Bright"], answer: "Quiet", explanation: "Quiet means making little or no noise." },
  { id: "cat-v-e-05", category: "vocabulary", difficulty: "easy", prompt: "To “borrow” a book means…", options: ["Use it and return it", "Buy it for a friend", "Throw it away"], answer: "Use it and return it", explanation: "Borrow means to use something that belongs to someone else and return it." },
  { id: "cat-v-e-06", category: "vocabulary", difficulty: "easy", prompt: "A “hungry” cat wants…", options: ["Food", "A song", "A window"], answer: "Food", explanation: "Hungry means needing or wanting food." },
  { id: "cat-v-m-01", category: "vocabulary", difficulty: "medium", prompt: "A “reliable” friend is someone you can…", options: ["Trust", "Avoid", "Forget"], answer: "Trust", explanation: "Reliable means dependable or able to be trusted." },
  { id: "cat-v-m-02", category: "vocabulary", difficulty: "medium", prompt: "To “avoid” a puddle means to…", options: ["Stay away from it", "Jump into it", "Make it deeper"], answer: "Stay away from it", explanation: "Avoid means to stay away from something." },
  { id: "cat-v-m-03", category: "vocabulary", difficulty: "medium", prompt: "If you can “afford” a toy, you have…", options: ["Enough money to buy it", "Already lost it", "No room for it"], answer: "Enough money to buy it", explanation: "Afford means to have enough money for something." },
  { id: "cat-v-m-04", category: "vocabulary", difficulty: "medium", prompt: "If you “recover” from a cold, you…", options: ["Become well again", "Catch another cold", "Move to a new home"], answer: "Become well again", explanation: "Recover means to return to a normal or healthy state." },
  { id: "cat-v-m-05", category: "vocabulary", difficulty: "medium", prompt: "“Ordinary” is closest in meaning to…", options: ["Normal", "Expensive", "Dangerous"], answer: "Normal", explanation: "Ordinary means usual or not special." },
  { id: "cat-v-m-06", category: "vocabulary", difficulty: "medium", prompt: "To “make a decision” means to…", options: ["Choose what to do", "Explain a word", "Change a place"], answer: "Choose what to do", explanation: "A decision is a choice about what to do." },
  { id: "cat-v-h-01", category: "vocabulary", difficulty: "hard", prompt: "If Mia is “reluctant” to leave, she is…", options: ["Not very willing", "Very excited", "Already outside"], answer: "Not very willing", explanation: "Reluctant means not willing or unsure about doing something." },
  { id: "cat-v-h-02", category: "vocabulary", difficulty: "hard", prompt: "An “accurate” answer is…", options: ["Correct and exact", "Funny but unrelated", "Difficult to hear"], answer: "Correct and exact", explanation: "Accurate means correct and without mistakes." },
  { id: "cat-v-h-03", category: "vocabulary", difficulty: "hard", prompt: "If fresh water is “scarce,” there is…", options: ["Not enough of it", "More than anyone needs", "A new supply"], answer: "Not enough of it", explanation: "Scarce means limited or not available in a large amount." },
  { id: "cat-v-h-04", category: "vocabulary", difficulty: "hard", prompt: "To “maintain” a garden means to…", options: ["Keep it in good condition", "Forget where it is", "Make it disappear"], answer: "Keep it in good condition", explanation: "Maintain means to keep something working or in good condition." },
  { id: "cat-v-h-05", category: "vocabulary", difficulty: "hard", prompt: "“Eventually, the kitten fell asleep” means it fell asleep…", options: ["After some time", "Before anything happened", "Only for a moment"], answer: "After some time", explanation: "Eventually means in the end, after some time." },
  { id: "cat-v-h-06", category: "vocabulary", difficulty: "hard", prompt: "If Ava “insists” on bringing an umbrella, she…", options: ["Says firmly that she will", "Cannot find one", "Asks someone to hide it"], answer: "Says firmly that she will", explanation: "Insist means to say firmly that something is important or necessary." },

  { id: "cat-g-e-01", category: "grammar", difficulty: "easy", prompt: "Milo ___ on the sofa every afternoon.", options: ["sleep", "sleeps", "sleeping"], answer: "sleeps", explanation: "With he, she, it, or one name in the present simple, add -s to most verbs." },
  { id: "cat-g-e-02", category: "grammar", difficulty: "easy", prompt: "Yesterday, I ___ my friend.", options: ["visit", "visited", "visiting"], answer: "visited", explanation: "Yesterday marks a finished past action, so use the past form visited." },
  { id: "cat-g-e-03", category: "grammar", difficulty: "easy", prompt: "She has ___ orange umbrella.", options: ["a", "an", "the"], answer: "an", explanation: "Orange begins with a vowel sound, so use an." },
  { id: "cat-g-e-04", category: "grammar", difficulty: "easy", prompt: "Look! The kittens ___ in the garden.", options: ["play", "played", "are playing"], answer: "are playing", explanation: "Use are + verb-ing for an action happening now with a plural subject." },
  { id: "cat-g-e-05", category: "grammar", difficulty: "easy", prompt: "We ___ like loud music.", options: ["doesn't", "don't", "isn't"], answer: "don't", explanation: "Use don't with I, you, we, and they in the present simple negative." },
  { id: "cat-g-e-06", category: "grammar", difficulty: "easy", prompt: "There ___ one toy under the chair.", options: ["are", "is", "be"], answer: "is", explanation: "Use there is before a singular noun such as one toy." },
  { id: "cat-g-m-01", category: "grammar", difficulty: "medium", prompt: "I have lived here ___ 2022.", options: ["since", "for", "during"], answer: "since", explanation: "Use since with the time when something started; use for with a duration." },
  { id: "cat-g-m-02", category: "grammar", difficulty: "medium", prompt: "If I ___ more time, I would learn the piano.", options: ["have", "had", "will have"], answer: "had", explanation: "A second conditional uses if + past simple, then would + base verb." },
  { id: "cat-g-m-03", category: "grammar", difficulty: "medium", prompt: "The little house ___ by my grandfather.", options: ["built", "was built", "was build"], answer: "was built", explanation: "The subject receives the action, so use the past passive: was + past participle." },
  { id: "cat-g-m-04", category: "grammar", difficulty: "medium", prompt: "My sister enjoys ___ mystery stories.", options: ["read", "to reading", "reading"], answer: "reading", explanation: "Enjoy is followed by a gerund: a verb ending in -ing." },
  { id: "cat-g-m-05", category: "grammar", difficulty: "medium", prompt: "Have you finished your homework ___?", options: ["yet", "already yesterday", "since"], answer: "yet", explanation: "Yet is commonly used in questions about whether something has happened by now." },
  { id: "cat-g-m-06", category: "grammar", difficulty: "medium", prompt: "The woman ___ lives next door has a lovely cat.", options: ["who", "where", "when"], answer: "who", explanation: "Use who for a relative clause that describes a person." },
  { id: "cat-g-h-01", category: "grammar", difficulty: "hard", prompt: "If I had known about the storm, I ___ an umbrella.", options: ["would bring", "would have brought", "will bring"], answer: "would have brought", explanation: "The third conditional describes an unreal past: if + past perfect, would have + past participle." },
  { id: "cat-g-h-02", category: "grammar", difficulty: "hard", prompt: "By next June, she ___ here for ten years.", options: ["will have worked", "works", "has working"], answer: "will have worked", explanation: "Use the future perfect, will have + past participle, for an action continuing up to a future point." },
  { id: "cat-g-h-03", category: "grammar", difficulty: "hard", prompt: "I wish I ___ more time to read.", options: ["have", "had", "will have"], answer: "had", explanation: "Wish + past simple can describe a present situation that is different from what we want." },
  { id: "cat-g-h-04", category: "grammar", difficulty: "hard", prompt: "Despite ___ tired, she finished the book.", options: ["being", "was", "be"], answer: "being", explanation: "Despite is a preposition and can be followed by a noun or gerund phrase." },
  { id: "cat-g-h-05", category: "grammar", difficulty: "hard", prompt: "The plan, along with its details, ___ approved.", options: ["were", "was", "have"], answer: "was", explanation: "The main subject is the singular noun plan. Along with its details does not make it plural." },
  { id: "cat-g-h-06", category: "grammar", difficulty: "hard", prompt: "No sooner ___ home than the phone rang.", options: ["had I arrived", "I had arrived", "have I arrive"], answer: "had I arrived", explanation: "After No sooner at the start of a sentence, use subject–auxiliary inversion: had I arrived." },

  { id: "cat-t-e-01", category: "translation", difficulty: "easy", prompt: "Choose the English translation: 我每天喝水。", options: ["I drink water every day.", "I drank water yesterday.", "I am water every day."], answer: "I drink water every day.", explanation: "每天 means every day, and the present simple describes a daily habit." },
  { id: "cat-t-e-02", category: "translation", difficulty: "easy", prompt: "Choose the English translation: 她正在看一本書。", options: ["She reads a book yesterday.", "She is reading a book.", "She read a book tomorrow."], answer: "She is reading a book.", explanation: "正在 indicates an action happening now: is + verb-ing." },
  { id: "cat-t-e-03", category: "translation", difficulty: "easy", prompt: "Choose the English translation: 我們昨天去了公園。", options: ["We go to the park tomorrow.", "We are at the park now.", "We went to the park yesterday."], answer: "We went to the park yesterday.", explanation: "昨天 means yesterday; went is the past form of go." },
  { id: "cat-t-e-04", category: "translation", difficulty: "easy", prompt: "Choose the English translation: 請把門關上。", options: ["Please close the door.", "Please open the window.", "The door is very old."], answer: "Please close the door.", explanation: "請 is a polite please, and 關上 means close." },
  { id: "cat-t-e-05", category: "translation", difficulty: "easy", prompt: "Choose the English translation: 他喜歡聽音樂。", options: ["He likes listening to music.", "He liked the music yesterday.", "He is music."], answer: "He likes listening to music.", explanation: "喜歡 means likes; like can be followed by a verb ending in -ing." },
  { id: "cat-t-e-06", category: "translation", difficulty: "easy", prompt: "Choose the English translation: 今天很冷。", options: ["It was hot yesterday.", "It is cold today.", "Today is a cold drink."], answer: "It is cold today.", explanation: "今天 means today, and 很冷 means is very cold or is cold." },
  { id: "cat-t-m-01", category: "translation", difficulty: "medium", prompt: "Choose the English translation: 如果下雨，我們就待在家。", options: ["If it rains, we will stay home.", "It rained while we went home.", "We stay home because it was sunny."], answer: "If it rains, we will stay home.", explanation: "This is a likely future condition: if + present simple, then will + base verb." },
  { id: "cat-t-m-02", category: "translation", difficulty: "medium", prompt: "Choose the English translation: 我已經吃過午餐了。", options: ["I am eating lunch now.", "I have already eaten lunch.", "I will eat lunch tomorrow."], answer: "I have already eaten lunch.", explanation: "已經…了 often describes a completed action; have eaten is the present perfect." },
  { id: "cat-t-m-03", category: "translation", difficulty: "medium", prompt: "Choose the English translation: 這封信是昨天寄出的。", options: ["This letter sent tomorrow.", "This letter was sent yesterday.", "This letter sends me yesterday."], answer: "This letter was sent yesterday.", explanation: "The letter receives the action, so use the past passive was sent." },
  { id: "cat-t-m-04", category: "translation", difficulty: "medium", prompt: "Choose the English translation: 她比我早起。", options: ["She gets up earlier than I do.", "She got up later than me tomorrow.", "She is early than I."], answer: "She gets up earlier than I do.", explanation: "比 compares two things; earlier is the comparative form of early." },
  { id: "cat-t-m-05", category: "translation", difficulty: "medium", prompt: "Choose the English translation: 他們正在等公車。", options: ["They waited for the bus yesterday.", "They are waiting for the bus.", "They will the bus."], answer: "They are waiting for the bus.", explanation: "正在 marks an action in progress: are waiting." },
  { id: "cat-t-m-06", category: "translation", difficulty: "medium", prompt: "Choose the English translation: 我對學習新單字很有興趣。", options: ["I am interested in learning new words.", "I interest to learn a new word.", "I was new words interested."], answer: "I am interested in learning new words.", explanation: "The phrase is interested in, and in is followed by a noun or gerund." },
  { id: "cat-t-h-01", category: "translation", difficulty: "hard", prompt: "Choose the English translation: 如果我早點知道，我就會幫忙。", options: ["If I know earlier, I help.", "If I had known earlier, I would have helped.", "If I will know, I would help."], answer: "If I had known earlier, I would have helped.", explanation: "This describes an unreal past: if + past perfect, would have + past participle." },
  { id: "cat-t-h-02", category: "translation", difficulty: "hard", prompt: "Choose the English translation: 即使很累，她仍然完成了工作。", options: ["Although she was tired, she still finished the work.", "Because she tired, she finishes tomorrow.", "She was tired unless she worked."], answer: "Although she was tired, she still finished the work.", explanation: "即使…仍然 expresses contrast: although…still." },
  { id: "cat-t-h-03", category: "translation", difficulty: "hard", prompt: "Choose the English translation: 他們自從搬家後就住在這裡。", options: ["They live here for they moved.", "They have lived here since they moved.", "They had living here now."], answer: "They have lived here since they moved.", explanation: "Use present perfect for a situation continuing to now, and since for its starting point." },
  { id: "cat-t-h-04", category: "translation", difficulty: "hard", prompt: "Choose the English translation: 這個問題比看起來更複雜。", options: ["This problem is more complicated than it looks.", "This problem is most complicated looking.", "This problem complicated than looks."], answer: "This problem is more complicated than it looks.", explanation: "Compare two things with more + adjective + than." },
  { id: "cat-t-h-05", category: "translation", difficulty: "hard", prompt: "Choose the English translation: 完成後，請把文件交給老師。", options: ["After you finish, please give the document to the teacher.", "Before finished, the teacher gives you a document.", "Please give the teacher finished."], answer: "After you finish, please give the document to the teacher.", explanation: "完成後 means after finishing; the polite request uses please + base verb." },
  { id: "cat-t-h-06", category: "translation", difficulty: "hard", prompt: "Choose the English translation: Aunque estaba cansada, terminó el trabajo.", options: ["Although she was tired, she finished the work.", "She will finish work if she is tired.", "She was tiring after the work."], answer: "Although she was tired, she finished the work.", explanation: "Aunque means although, showing a contrast between being tired and finishing." },
  { id: "cat-r-e-01", category: "reading", difficulty: "easy", prompt: "Read: “Ben feeds his cat before school.” When does Ben feed the cat?", options: ["Before school", "After dinner", "At midnight"], answer: "Before school", explanation: "The passage says Ben feeds the cat before school." },
  { id: "cat-r-e-02", category: "reading", difficulty: "easy", prompt: "Read: “Mia found a red umbrella by the door.” What color was the umbrella?", options: ["Blue", "Red", "Green"], answer: "Red", explanation: "The passage describes the umbrella as red." },
  { id: "cat-r-e-03", category: "reading", difficulty: "easy", prompt: "Read: “The library closes at six, so Leo leaves at five.” Why does Leo leave at five?", options: ["The library closes at six", "He is meeting Mia at five", "He has finished dinner"], answer: "The library closes at six", explanation: "Leo leaves before the library closes." },
  { id: "cat-r-e-04", category: "reading", difficulty: "easy", prompt: "Read: “Nora takes the bus when it rains.” How does Nora travel in rainy weather?", options: ["By bus", "By bicycle", "On foot"], answer: "By bus", explanation: "The passage says she takes the bus when it rains." },
  { id: "cat-r-e-05", category: "reading", difficulty: "easy", prompt: "Read: “There are three apples in the blue bowl.” How many apples are there?", options: ["Two", "Three", "Five"], answer: "Three", explanation: "The sentence directly gives the number: three." },
  { id: "cat-r-e-06", category: "reading", difficulty: "easy", prompt: "Read: “Sam wore a coat because the wind was cold.” Why did Sam wear a coat?", options: ["The wind was cold", "It was sunny", "He was going swimming"], answer: "The wind was cold", explanation: "Because introduces the reason Sam wore a coat." },
  { id: "cat-r-m-01", category: "reading", difficulty: "medium", prompt: "Read: “After the rain stopped, June opened the windows to let the fresh air in.” What happened first?", options: ["June opened the windows", "The rain stopped", "June went to sleep"], answer: "The rain stopped", explanation: "After shows that the rain stopped before June opened the windows." },
  { id: "cat-r-m-02", category: "reading", difficulty: "medium", prompt: "Read: “Kai wanted a book, but the shop was closed, so he borrowed one from the library.” How did Kai get a book?", options: ["He borrowed one from the library", "He bought one at the shop", "He wrote one himself"], answer: "He borrowed one from the library", explanation: "The shop was closed, so Kai borrowed a book instead." },
  { id: "cat-r-m-03", category: "reading", difficulty: "medium", prompt: "Read: “Lena usually walks to work. Today, however, she took a taxi because she was late.” How did Lena travel today?", options: ["She walked", "She took a taxi", "She rode a train"], answer: "She took a taxi", explanation: "Today signals the exception to her usual routine." },
  { id: "cat-r-m-04", category: "reading", difficulty: "medium", prompt: "Read: “The café is popular with students because it offers quiet tables and free Wi-Fi.” Why do students like the café?", options: ["It has quiet tables and free Wi-Fi", "It is beside the school", "It serves dinner all night"], answer: "It has quiet tables and free Wi-Fi", explanation: "The passage gives these two features as the reason." },
  { id: "cat-r-m-05", category: "reading", difficulty: "medium", prompt: "Read: “Although the hike was tiring, Omar felt proud when he reached the lake.” How did Omar feel at the lake?", options: ["Proud", "Angry", "Bored"], answer: "Proud", explanation: "Although contrasts the tiring hike with Omar's proud feeling." },
  { id: "cat-r-m-06", category: "reading", difficulty: "medium", prompt: "Read: “Ava set an alarm for 7:00, but she woke up at 6:30 without it.” What happened before the alarm rang?", options: ["Ava woke up", "Ava set another alarm", "Ava went to work"], answer: "Ava woke up", explanation: "She woke at 6:30, earlier than the 7:00 alarm." },
  { id: "cat-r-h-01", category: "reading", difficulty: "hard", prompt: "Read: “The museum extended its hours during the festival. Visitors who arrived after 5 p.m. could still see the final exhibition.” Who could see the final exhibition?", options: ["Visitors arriving after 5 p.m.", "Only visitors arriving before noon", "No visitors during the festival"], answer: "Visitors arriving after 5 p.m.", explanation: "The extended hours allowed late visitors to see the final exhibition." },
  { id: "cat-r-h-02", category: "reading", difficulty: "hard", prompt: "Read: “Nina planned to cycle to the coast. When the forecast predicted storms, she postponed the trip rather than risk riding in dangerous weather.” Why did Nina postpone the trip?", options: ["Storms were forecast", "Her bicycle was new", "She had already reached the coast"], answer: "Storms were forecast", explanation: "The forecast changed her plan because riding in a storm would be unsafe." },
  { id: "cat-r-h-03", category: "reading", difficulty: "hard", prompt: "Read: “The garden used less water after volunteers replaced the old sprinklers with a drip system.” What helped reduce water use?", options: ["Replacing the sprinklers with a drip system", "Planting fewer flowers", "Watering during a storm"], answer: "Replacing the sprinklers with a drip system", explanation: "The passage links the lower water use to the new drip system." },
  { id: "cat-r-h-04", category: "reading", difficulty: "hard", prompt: "Read: “While the first draft was concise, the editor added examples so new readers could follow the argument.” Why did the editor add examples?", options: ["To help new readers understand", "To make the draft shorter", "To remove the argument"], answer: "To help new readers understand", explanation: "The examples made the argument easier for new readers to follow." },
  { id: "cat-r-h-05", category: "reading", difficulty: "hard", prompt: "Read: “Although the train arrived late, Priya reached the interview on time because she had allowed extra travel time.” Why was Priya on time?", options: ["She planned extra time for the journey", "The train arrived early", "The interview was cancelled"], answer: "She planned extra time for the journey", explanation: "Her extra time accounted for the train delay." },
  { id: "cat-r-h-06", category: "reading", difficulty: "hard", prompt: "Read: “The neighborhood library lends tools as well as books; members can borrow a drill for a weekend instead of buying one they rarely use.” What is one benefit of the program?", options: ["Members can borrow tools they rarely need", "Members must buy every tool", "The library only lends drills permanently"], answer: "Members can borrow tools they rarely need", explanation: "Borrowing a tool avoids buying something used infrequently." },
];

const catHomeCoins = document.querySelector("#cat-home-coins");
const catHomeLearned = document.querySelector("#cat-home-learned");
const catHomePets = document.querySelector("#cat-home-pets");
const catHomeRoom = document.querySelector("#cat-room");
const catRoomItems = document.querySelector("#cat-room-items");
const catHomeInventory = document.querySelector("#cat-home-inventory");
const catHomeShop = document.querySelector("#cat-home-shop");
const catFoodInventory = document.querySelector("#cat-food-inventory");
const catHungerValue = document.querySelector("#cat-hunger-value");
const catHungerMeter = document.querySelector("#cat-hunger-meter");
const catHungerTrack = catHungerMeter.closest(".cat-need-track");
const catHappinessValue = document.querySelector("#cat-happiness-value");
const catHappinessMeter = document.querySelector("#cat-happiness-meter");
const catHappinessTrack = catHappinessMeter.closest(".cat-need-track");
const catShopNote = document.querySelector("#cat-shop-note");
const catHomeSaveStatus = document.querySelector("#cat-home-save-status");
const gameCat = document.querySelector("#game-cat");
const gameCatArt = document.querySelector("#game-cat-art");
const catPetHearts = document.querySelector("#cat-pet-hearts");
const catHomeMessage = document.querySelector("#cat-home-message");
const catQuizCategory = document.querySelector("#cat-quiz-category");
const catQuizDifficulty = document.querySelector("#cat-quiz-difficulty");
const catQuizCategoryLabel = document.querySelector("#cat-quiz-category-label");
const catQuizQuestion = document.querySelector("#cat-quiz-question");
const catQuizOptions = document.querySelector("#cat-quiz-options");
const catQuizFeedback = document.querySelector("#cat-quiz-feedback");
const catQuizNext = document.querySelector("#cat-quiz-next");
const CAT_QUESTION_IDS = new Set(CAT_QUIZ_BANK.map((question) => question.id));
const CAT_FURNITURE_IDS = new Set(CAT_FURNITURE.map((item) => item.id));
const CAT_FOOD_IDS = new Set(CAT_FOOD.map((item) => item.id));
const CAT_FLOOR_POLYGON = [
  [60, 50],
  [93, 69],
  [98, 78],
  [72, 96],
  [47, 81],
  [29, 90],
  [2, 73],
];
const CAT_HOME_DEFAULTS = {
  layoutVersion: 2,
  coins: 0,
  answeredQuestionIds: [],
  inventory: {},
  foodInventory: {},
  placedItems: [],
  hunger: 74,
  happiness: 82,
  catX: 67,
  catY: 78,
  catAction: "sitting",
  petCount: 0,
};
let catHomeState = readLocalData(CAT_HOME_KEY, CAT_HOME_DEFAULTS, (message) => {
  catHomeSaveStatus.textContent = message;
});
if (!catHomeState || typeof catHomeState !== "object" || Array.isArray(catHomeState)) {
  catHomeState = { ...CAT_HOME_DEFAULTS };
}
const legacyCatLayout = !Number.isSafeInteger(catHomeState.layoutVersion) || catHomeState.layoutVersion < 2;
function catPositionIsOnFloor(x, y) {
  let inside = false;
  for (let index = 0, previous = CAT_FLOOR_POLYGON.length - 1; index < CAT_FLOOR_POLYGON.length; previous = index, index += 1) {
    const [currentX, currentY] = CAT_FLOOR_POLYGON[index];
    const [previousX, previousY] = CAT_FLOOR_POLYGON[previous];
    const crosses = ((currentY > y) !== (previousY > y))
      && x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX;
    if (crosses) {
      inside = !inside;
    }
  }
  return inside;
}

function nearestCatFloorPosition(x, y) {
  const safeX = Math.max(2, Math.min(98, x));
  const safeY = Math.max(49, Math.min(96, y));
  if (catPositionIsOnFloor(safeX, safeY)) {
    return { x: safeX, y: safeY };
  }
  let closest;
  let closestDistance = Infinity;
  for (let edge = 0; edge < CAT_FLOOR_POLYGON.length; edge += 1) {
    const start = CAT_FLOOR_POLYGON[edge];
    const end = CAT_FLOOR_POLYGON[(edge + 1) % CAT_FLOOR_POLYGON.length];
    const deltaX = end[0] - start[0];
    const deltaY = end[1] - start[1];
    const edgeLength = deltaX * deltaX + deltaY * deltaY;
    const ratio = edgeLength
      ? Math.max(0, Math.min(1, ((safeX - start[0]) * deltaX + (safeY - start[1]) * deltaY) / edgeLength))
      : 0;
    const point = {
      x: start[0] + ratio * deltaX,
      y: start[1] + ratio * deltaY,
    };
    const distance = (point.x - safeX) ** 2 + (point.y - safeY) ** 2;
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = point;
    }
  }
  const centerX = 52;
  const centerY = 76;
  const inwardX = centerX - closest.x;
  const inwardY = centerY - closest.y;
  const inwardLength = Math.hypot(inwardX, inwardY) || 1;
  const adjusted = {
    x: closest.x + (inwardX / inwardLength) * 1.5,
    y: closest.y + (inwardY / inwardLength) * 1.5,
  };
  return catPositionIsOnFloor(adjusted.x, adjusted.y) ? adjusted : closest;
}

function migrateCatCoordinate(value, axis) {
  const original = Number.isFinite(value) ? value : (axis === "x" ? CAT_HOME_DEFAULTS.catX : CAT_HOME_DEFAULTS.catY);
  if (!legacyCatLayout) {
    return original;
  }
  if (axis === "x") {
    return 8 + ((Math.max(5, Math.min(95, original)) - 5) / 90) * 84;
  }
  return 50 + ((Math.max(12, Math.min(84, original)) - 12) / 72) * 33;
}

const migratedCatPosition = nearestCatFloorPosition(
  migrateCatCoordinate(catHomeState.catX, "x"),
  migrateCatCoordinate(catHomeState.catY, "y"),
);
catHomeState = {
  ...CAT_HOME_DEFAULTS,
  layoutVersion: 2,
  coins: Number.isSafeInteger(catHomeState.coins) && catHomeState.coins >= 0 ? catHomeState.coins : 0,
  answeredQuestionIds: Array.isArray(catHomeState.answeredQuestionIds)
    ? [...new Set(catHomeState.answeredQuestionIds.filter((id) => CAT_QUESTION_IDS.has(id)))]
    : [],
  inventory: Object.fromEntries(CAT_FURNITURE.map((item) => [
    item.id,
    Number.isSafeInteger(catHomeState.inventory?.[item.id]) && catHomeState.inventory[item.id] > 0
      ? catHomeState.inventory[item.id]
      : 0,
  ])),
  foodInventory: Object.fromEntries(CAT_FOOD.map((item) => [
    item.id,
    Number.isSafeInteger(catHomeState.foodInventory?.[item.id]) && catHomeState.foodInventory[item.id] > 0
      ? catHomeState.foodInventory[item.id]
      : 0,
  ])),
  placedItems: Array.isArray(catHomeState.placedItems)
    ? catHomeState.placedItems.filter((placed) =>
      placed && typeof placed.id === "string" && CAT_FURNITURE_IDS.has(placed.itemId)
      && Number.isFinite(placed.x) && Number.isFinite(placed.y),
    ).map((placed) => ({
      id: placed.id,
      itemId: placed.itemId,
      ...nearestCatFloorPosition(migrateCatCoordinate(placed.x, "x"), migrateCatCoordinate(placed.y, "y")),
    }))
    : [],
  catX: migratedCatPosition.x,
  catY: migratedCatPosition.y,
  hunger: Number.isFinite(catHomeState.hunger) ? Math.max(0, Math.min(100, catHomeState.hunger)) : CAT_HOME_DEFAULTS.hunger,
  happiness: Number.isFinite(catHomeState.happiness) ? Math.max(0, Math.min(100, catHomeState.happiness)) : CAT_HOME_DEFAULTS.happiness,
  catAction: ["sitting", "walking", "sleeping", "playing", "eating", "happy"].includes(catHomeState.catAction)
    ? catHomeState.catAction
    : "sitting",
  petCount: Number.isSafeInteger(catHomeState.petCount) && catHomeState.petCount >= 0 ? catHomeState.petCount : 0,
};

let currentCatQuestion;
let currentCatOptions = [];
let currentCatQuestionAnswered = false;
let draggedRoomItem;
let catPetTimeout;
let catWalkTimer;
let catWalkFrameTimer;
let catShopCategory = "furniture";

function saveCatHome() {
  try {
    writeLocalData(CAT_HOME_KEY, catHomeState);
    catHomeSaveStatus.textContent = "Your coins, room, and kitty are saved in this browser ♡";
    return true;
  } catch {
    catHomeSaveStatus.textContent = "Your game changed, but this browser could not save it. Check its storage settings.";
    return false;
  }
}

function getCatFurniture(itemId) {
  return CAT_FURNITURE.find((item) => item.id === itemId);
}

function shuffleCatItems(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled;
}

function renderCatHomeStats() {
  catHomeCoins.textContent = String(catHomeState.coins);
  catHomeLearned.textContent = `${catHomeState.answeredQuestionIds.length} / ${CAT_QUIZ_BANK.length}`;
  catHomePets.textContent = String(catHomeState.petCount);
  catHungerValue.textContent = `${catHomeState.hunger}%`;
  catHungerMeter.style.width = `${catHomeState.hunger}%`;
  catHungerTrack.setAttribute("aria-valuenow", String(catHomeState.hunger));
  catHappinessValue.textContent = `${catHomeState.happiness}%`;
  catHappinessMeter.style.width = `${catHomeState.happiness}%`;
  catHappinessTrack.setAttribute("aria-valuenow", String(catHomeState.happiness));
}

function getCatSpriteUrl(sprite) {
  return `${CAT_ASSET_BASE}${sprite}.png`;
}

function getCatPlacementSpot(index) {
  const candidates = [
    [48, 69], [35, 75], [65, 75], [57, 82], [78, 80],
    [25, 77], [43, 85], [69, 87], [54, 60], [83, 73],
  ];
  const candidate = candidates[index % candidates.length];
  return nearestCatFloorPosition(candidate[0], candidate[1]);
}

function setCatShopCategory(category) {
  catShopCategory = category;
  document.querySelectorAll("[data-cat-shop-tab]").forEach((tab) => {
    const active = tab.dataset.catShopTab === category;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  catShopNote.textContent = category === "food"
    ? "Cat-formulated meals and cat-safe treats only. Buy snacks for your kitty’s pantry."
    : category === "cat"
      ? "Cozy beds, bowls, and playthings made for your little roommate."
      : category === "decor"
        ? "Add a little princess sparkle with mirrors, lamps, flowers, and more."
        : "Earn coins with English, then choose something cozy for your kitty’s room.";
  renderCatShop();
}

function renderCatShop() {
  catHomeShop.replaceChildren();
  const shopItems = catShopCategory === "food"
    ? CAT_FOOD
    : CAT_FURNITURE.filter((item) =>
      item.shopAvailable !== false && (
        catShopCategory === "furniture"
          ? ["bedroom", "furniture"].includes(item.category)
          : item.category === catShopCategory
      ),
    );
  shopItems.forEach((item) => {
    const isFood = catShopCategory === "food";
    const card = createElement("article", "cat-shop-item");
    const picture = createElement("img", "cat-shop-art");
    picture.src = getCatSpriteUrl(item.sprite);
    picture.alt = "";
    picture.setAttribute("aria-hidden", "true");
    const details = createElement("span", "cat-shop-details");
    details.append(createElement("b", "", item.name));
    const owned = isFood
      ? catHomeState.foodInventory[item.id]
      : catHomeState.inventory[item.id]
        + catHomeState.placedItems.filter((placed) => placed.itemId === item.id).length;
    details.append(createElement("small", "", `🪙 ${item.price} · owned ${owned}`));
    const buy = createElement("button", "small-pastel-button cat-buy-button", "Buy");
    buy.type = "button";
    buy.disabled = catHomeState.coins < item.price;
    buy.setAttribute("aria-label", `Buy ${item.name} for ${item.price} coins`);
    buy.addEventListener("click", () => {
      if (catHomeState.coins < item.price) {
        catHomeMessage.textContent = `You need ${item.price - catHomeState.coins} more coins for ${item.name}. Try another English question ♡`;
        return;
      }
      catHomeState.coins -= item.price;
      if (isFood) {
        catHomeState.foodInventory[item.id] += 1;
      } else {
        catHomeState.inventory[item.id] += 1;
      }
      saveCatHome();
      renderCatHome();
      catHomeMessage.textContent = isFood
        ? `${item.name} is in your pantry! Feed it to your kitty when it’s snack time ♡`
        : `${item.name} is yours! Place it in the room when you’re ready ✨`;
    });
    card.append(picture, details, buy);
    catHomeShop.append(card);
  });
}

function renderCatInventory() {
  catHomeInventory.replaceChildren();
  const availableItems = CAT_FURNITURE.filter((item) => catHomeState.inventory[item.id] > 0);
  if (!availableItems.length) {
    catHomeInventory.append(createElement("p", "empty-note", "Your basket is empty. Earn coins and visit the shop for something cozy."));
    return;
  }
  availableItems.forEach((item) => {
    const row = createElement("div", "cat-inventory-item");
    row.append(
      (() => {
        const art = createElement("img", "cat-inventory-art");
        art.src = getCatSpriteUrl(item.sprite);
        art.alt = "";
        art.setAttribute("aria-hidden", "true");
        return art;
      })(),
      createElement("b", "", item.name),
      createElement("span", "cat-inventory-count", `×${catHomeState.inventory[item.id]}`),
    );
    const place = createElement("button", "small-pastel-button", "Place");
    place.type = "button";
    place.setAttribute("aria-label", `Place ${item.name} in the room`);
    place.addEventListener("click", () => {
      if (catHomeState.inventory[item.id] < 1) {
        return;
      }
      const position = getCatPlacementSpot(catHomeState.placedItems.length);
      catHomeState.inventory[item.id] -= 1;
      catHomeState.placedItems.push({
        id: `cat-item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        itemId: item.id,
        x: position.x,
        y: position.y,
      });
      saveCatHome();
      renderCatHome();
      catHomeMessage.textContent = `${item.name} is in the room! Drag it to find the perfect spot ♡`;
    });
    row.append(place);
    catHomeInventory.append(row);
  });
}

function renderCatFoodInventory() {
  catFoodInventory.replaceChildren();
  const availableFoods = CAT_FOOD.filter((item) => catHomeState.foodInventory[item.id] > 0);
  if (!availableFoods.length) {
    catFoodInventory.append(createElement("p", "empty-note", "Your pantry is empty. Choose cat-safe food from the shop to feed your kitty."));
    return;
  }
  availableFoods.forEach((item) => {
    const row = createElement("div", "cat-food-inventory-item");
    const art = createElement("img", "cat-food-art");
    art.src = getCatSpriteUrl(item.sprite);
    art.alt = "";
    art.setAttribute("aria-hidden", "true");
    const details = createElement("span", "cat-food-details");
    details.append(createElement("b", "", item.name));
    details.append(createElement("small", "", `×${catHomeState.foodInventory[item.id]}`));
    const feed = createElement("button", "small-pastel-button cat-feed-button", "Feed");
    feed.type = "button";
    feed.setAttribute("aria-label", `Feed ${item.name} to your kitten`);
    feed.addEventListener("click", () => feedCat(item.id));
    row.append(art, details, feed);
    catFoodInventory.append(row);
  });
}

function feedCat(foodId) {
  const food = CAT_FOOD.find((item) => item.id === foodId);
  if (!food || catHomeState.foodInventory[foodId] < 1) {
    catHomeMessage.textContent = "There isn’t any of that snack in the pantry yet. Visit the cat food shop ♡";
    return;
  }
  catHomeState.foodInventory[foodId] -= 1;
  catHomeState.hunger = Math.min(100, catHomeState.hunger + food.fullness);
  catHomeState.happiness = Math.min(100, catHomeState.happiness + food.happiness);
  catHomeMessage.textContent = food.message;
  setCatAction("eating");
  catHomeState.catX = nearestCatFloorPosition(catHomeState.catX, catHomeState.catY).x;
  renderCatHome();
  window.clearTimeout(catPetTimeout);
  catPetTimeout = window.setTimeout(() => {
    if (catHomeState.catAction === "eating") {
      setCatAction("sitting");
      renderCatRoom();
    }
  }, 1450);
}

function setCatAction(action, message) {
  catHomeState.catAction = action;
  window.clearTimeout(catPetTimeout);
  gameCat.classList.remove("cat-sitting", "cat-walking", "cat-sleeping", "cat-playing", "cat-eating", "cat-happy");
  gameCat.classList.add(`cat-${action}`);
  gameCatArt.src = getCatSpriteUrl({
    sitting: "cat-sit",
    walking: "cat-walk-a",
    sleeping: "cat-sleep",
    playing: "cat-play",
    eating: "cat-eat",
    happy: "cat-pet",
  }[action] || "cat-stand");
  window.clearInterval(catWalkFrameTimer);
  if (action === "walking") {
    let walkingFrame = false;
    catWalkFrameTimer = window.setInterval(() => {
      walkingFrame = !walkingFrame;
      gameCatArt.src = getCatSpriteUrl(walkingFrame ? "cat-walk-b" : "cat-walk-a");
    }, 420);
  }
  if (action !== "walking") {
    window.clearTimeout(catWalkTimer);
    catWalkTimer = undefined;
  }
  if (message) {
    catHomeMessage.textContent = message;
  }
  saveCatHome();
  renderCatRoom();
}

function renderCatRoom() {
  catRoomItems.replaceChildren();
  catHomeState.placedItems.forEach((placed) => {
    const item = getCatFurniture(placed.itemId);
    if (!item) {
      return;
    }
    const furnishing = createElement("div", `room-furniture room-furniture-${item.category}`);
    furnishing.dataset.placedId = placed.id;
    furnishing.dataset.itemId = item.id;
    furnishing.style.left = `${placed.x}%`;
    furnishing.style.top = `${placed.y}%`;
    furnishing.style.width = `${item.size}%`;
    furnishing.style.zIndex = String(10 + Math.round(placed.y * 10));
    furnishing.setAttribute("role", "button");
    furnishing.setAttribute("aria-label", `${item.name}. Drag to move.`);
    furnishing.tabIndex = 0;
    const art = createElement("img", "room-furniture-art");
    art.src = getCatSpriteUrl(item.sprite);
    art.alt = "";
    art.draggable = false;
    art.setAttribute("aria-hidden", "true");
    furnishing.append(art);
    const remove = createElement("button", "room-furniture-return", "↩");
    remove.type = "button";
    remove.title = "Return to furniture basket";
    remove.setAttribute("aria-label", `Return ${item.name} to your basket`);
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      catHomeState.placedItems = catHomeState.placedItems.filter((entry) => entry.id !== placed.id);
      catHomeState.inventory[item.id] += 1;
      saveCatHome();
      renderCatHome();
      catHomeMessage.textContent = `${item.name} is back in your basket. You still own it ♡`;
    });
    furnishing.append(remove);
    catRoomItems.append(furnishing);
  });

  gameCat.style.left = `${catHomeState.catX}%`;
  gameCat.style.top = `${catHomeState.catY}%`;
  gameCat.style.zIndex = String(10 + Math.round(catHomeState.catY * 10));
  gameCat.classList.remove("cat-sitting", "cat-walking", "cat-sleeping", "cat-playing", "cat-eating", "cat-happy");
  gameCat.classList.add(`cat-${catHomeState.catAction}`);
  if (document.activeElement !== gameCat || gameCatArt.getAttribute("src") === null) {
    gameCatArt.src = getCatSpriteUrl({
      sitting: "cat-sit",
      walking: "cat-walk-a",
      sleeping: "cat-sleep",
      playing: "cat-play",
      eating: "cat-eat",
      happy: "cat-pet",
    }[catHomeState.catAction] || "cat-stand");
  }
}

function renderCatHome() {
  renderCatHomeStats();
  renderCatRoom();
  renderCatInventory();
  renderCatFoodInventory();
  renderCatShop();
}

function renderCatQuestion() {
  const category = catQuizCategory.value;
  const difficulty = catQuizDifficulty.value;
  const available = CAT_QUIZ_BANK.filter((question) =>
    question.category === category && question.difficulty === difficulty
    && !catHomeState.answeredQuestionIds.includes(question.id),
  );
  catQuizOptions.replaceChildren();
  catQuizFeedback.hidden = true;
  catQuizFeedback.classList.remove("is-correct", "is-wrong");
  currentCatQuestionAnswered = false;
  if (!available.length) {
    currentCatQuestion = undefined;
    catQuizCategoryLabel.textContent = `${category.toUpperCase()} · ${difficulty.toUpperCase()}`;
    catQuizQuestion.textContent = "You’ve tried every question in this set! Choose another category or difficulty for more cozy coins.";
    catQuizNext.textContent = "Find another set ↗";
    return;
  }
  currentCatQuestion = available[Math.floor(Math.random() * available.length)];
  currentCatOptions = shuffleCatItems(currentCatQuestion.options);
  catQuizCategoryLabel.textContent = `${category.toUpperCase()} · ${difficulty.toUpperCase()} · ${CAT_REWARD_COINS[difficulty]} COINS`;
  catQuizQuestion.textContent = currentCatQuestion.prompt;
  currentCatOptions.forEach((option) => {
    const answer = createElement("button", "cat-quiz-option", option);
    answer.type = "button";
    answer.addEventListener("click", () => answerCatQuestion(option));
    catQuizOptions.append(answer);
  });
  catQuizNext.textContent = "Another question ↗";
}

function answerCatQuestion(selectedAnswer) {
  if (!currentCatQuestion || currentCatQuestionAnswered) {
    return;
  }
  currentCatQuestionAnswered = true;
  const correct = selectedAnswer === currentCatQuestion.answer;
  catHomeState.answeredQuestionIds.push(currentCatQuestion.id);
  if (correct) {
    const reward = CAT_REWARD_COINS[currentCatQuestion.difficulty];
    catHomeState.coins += reward;
    catQuizFeedback.textContent = `That’s right! ${currentCatQuestion.explanation} +${reward} cozy coins ✨`;
    catQuizFeedback.classList.add("is-correct");
    catHomeMessage.textContent = `Purr-fect answer! Your kitty earned ${reward} coins with you ♡`;
  } else {
    catQuizFeedback.textContent = `Not quite. The answer is “${currentCatQuestion.answer}.” ${currentCatQuestion.explanation} This question is now saved as tried, so choose a new one to earn coins.`;
    catQuizFeedback.classList.add("is-wrong");
    catHomeMessage.textContent = "A little practice makes progress. Your kitty believes in you!";
  }
  catQuizFeedback.hidden = false;
  [...catQuizOptions.querySelectorAll("button")].forEach((button) => {
    button.disabled = true;
    if (button.textContent === currentCatQuestion.answer) {
      button.classList.add("is-answer");
    } else if (button.textContent === selectedAnswer && !correct) {
      button.classList.add("is-incorrect");
    }
  });
  saveCatHome();
  renderCatHomeStats();
  renderCatShop();
  if (!correct) {
    catQuizNext.textContent = "Next question ↗";
  }
}

catQuizCategory.addEventListener("change", renderCatQuestion);
catQuizDifficulty.addEventListener("change", renderCatQuestion);
catQuizNext.addEventListener("click", renderCatQuestion);
document.querySelectorAll("[data-cat-shop-tab]").forEach((tab) => {
  tab.addEventListener("click", () => setCatShopCategory(tab.dataset.catShopTab));
});

function catPositionBlocked(x, y, ignoredItemId) {
  return catHomeState.placedItems.some((placed) => {
    const item = getCatFurniture(placed.itemId);
    if (!item || placed.itemId === ignoredItemId || placed.itemId === "rug") {
      return false;
    }
    return Math.abs(x - placed.x) < Math.max(4, item.size * 0.34)
      && Math.abs(y - placed.y) < Math.max(3, item.size * 0.16);
  });
}

function catPathIsClear(start, end) {
  const steps = 8;
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    const x = start.x + (end.x - start.x) * progress;
    const y = start.y + (end.y - start.y) * progress;
    if (catPositionBlocked(x, y)) {
      return false;
    }
  }
  return true;
}

function walkCat() {
  const directions = shuffleCatItems([
    [-7, 0], [7, 0], [0, -4], [0, 4], [-5, -3], [5, -3], [-5, 3], [5, 3],
  ]);
  const start = { x: catHomeState.catX, y: catHomeState.catY };
  const destination = directions.map(([deltaX, deltaY]) =>
    nearestCatFloorPosition(start.x + deltaX, start.y + deltaY),
  ).find((point) =>
    !catPositionBlocked(point.x, point.y) && catPathIsClear(start, point),
  );
  if (!destination) {
    catHomeMessage.textContent = "The room is a little crowded. Move a decoration to make a walking path ♡";
    return;
  }
  catHomeState.catX = destination.x;
  catHomeState.catY = destination.y;
  setCatAction("walking", "Tip-tap, tip-tap! Your kitten explores a clear path through the room.");
  catWalkTimer = window.setTimeout(() => {
    if (catHomeState.catAction === "walking") {
      setCatAction("sitting");
    }
  }, 1650);
}

gameCat.addEventListener("click", () => {
  catHomeState.petCount += 1;
  catHomeState.happiness = Math.min(100, catHomeState.happiness + 8);
  setCatAction("happy", "Prrrr! Your kitten loves those gentle pets ♡");
  gameCat.classList.remove("is-petted");
  void gameCat.offsetWidth;
  gameCat.classList.add("is-petted");
  catPetHearts.replaceChildren();
  ["♡", "♥", "✧"].forEach((heart, index) => {
    const effect = createElement("span", `cat-pet-heart cat-pet-heart-${index + 1}`, heart);
    catPetHearts.append(effect);
  });
  window.clearTimeout(catPetTimeout);
  catPetTimeout = window.setTimeout(() => {
    if (catHomeState.catAction === "happy") {
      setCatAction("sitting");
    }
    gameCat.classList.remove("is-petted");
    catPetHearts.replaceChildren();
  }, 1100);
  renderCatHome();
});

document.querySelectorAll("[data-cat-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.catAction;
    if (action === "sleep") {
      const bed = catHomeState.placedItems.find((placed) =>
        ["bed", "heart-bed", "cat-bed"].includes(placed.itemId),
      );
      if (!bed) {
        catHomeMessage.textContent = "Your kitten needs a placed bed or cat nest for a cozy nap ♡";
        return;
      }
      const position = nearestCatFloorPosition(bed.x, bed.y + 2);
      catHomeState.catX = position.x;
      catHomeState.catY = position.y;
      setCatAction("sleeping", "Sweet dreams, little kitten. It’s curled up in its bed ♡");
    } else if (action === "play") {
      const toy = catHomeState.placedItems.find((placed) =>
        ["toy", "toy-basket", "cat-tree"].includes(placed.itemId),
      );
      if (toy) {
        const position = nearestCatFloorPosition(toy.x + 5, toy.y + 1);
        catHomeState.catX = position.x;
        catHomeState.catY = position.y;
      }
      catHomeState.happiness = Math.min(100, catHomeState.happiness + 10);
      setCatAction("playing", toy
        ? "Playtime! Your kitten bats at its favorite toy ✨"
        : "Your kitten bounces around playfully. Place a toy nearby for extra fun ♡");
      catPetTimeout = window.setTimeout(() => {
        if (catHomeState.catAction === "playing") {
          setCatAction("sitting");
        }
      }, 1800);
    } else if (action === "walk") {
      walkCat();
    } else if (action === "eat") {
      const availableFood = CAT_FOOD.find((food) => catHomeState.foodInventory[food.id] > 0);
      if (availableFood) {
        feedCat(availableFood.id);
      } else {
        setCatShopCategory("food");
        catHomeMessage.textContent = "Your pantry is empty. Choose a cat-safe snack from the food shop ♡";
      }
    } else {
      setCatAction("sitting", "Your kitty is sitting cozily in its little room.");
    }
  });
});

catHomeRoom.addEventListener("pointerdown", (event) => {
  const furnishing = event.target.closest(".room-furniture");
  if (!furnishing || event.target.closest(".room-furniture-return")) {
    return;
  }
  const placed = catHomeState.placedItems.find((item) => item.id === furnishing.dataset.placedId);
  if (!placed) {
    return;
  }
  draggedRoomItem = { furnishing, placed, pointerId: event.pointerId };
  furnishing.classList.add("is-dragging");
  if (event.isTrusted && furnishing.setPointerCapture) {
    furnishing.setPointerCapture(event.pointerId);
  }
  event.preventDefault();
});

catHomeRoom.addEventListener("pointermove", (event) => {
  if (!draggedRoomItem || draggedRoomItem.pointerId !== event.pointerId) {
    return;
  }
  const bounds = catHomeRoom.getBoundingClientRect();
  const requestedX = ((event.clientX - bounds.left) / bounds.width) * 100;
  const requestedY = ((event.clientY - bounds.top) / bounds.height) * 100;
  const position = nearestCatFloorPosition(requestedX, requestedY);
  draggedRoomItem.placed.x = position.x;
  draggedRoomItem.placed.y = position.y;
  draggedRoomItem.furnishing.style.left = `${position.x}%`;
  draggedRoomItem.furnishing.style.top = `${position.y}%`;
  draggedRoomItem.furnishing.style.zIndex = String(10 + Math.round(position.y * 10));
});

function finishCatFurnitureDrag(event) {
  if (!draggedRoomItem || draggedRoomItem.pointerId !== event.pointerId) {
    return;
  }
  draggedRoomItem.furnishing.classList.remove("is-dragging");
  draggedRoomItem = undefined;
  saveCatHome();
}

catHomeRoom.addEventListener("pointerup", finishCatFurnitureDrag);
catHomeRoom.addEventListener("pointercancel", finishCatFurnitureDrag);
catHomeRoom.addEventListener("keydown", (event) => {
  const furnishing = event.target.closest(".room-furniture");
  if (!furnishing || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    return;
  }
  const placed = catHomeState.placedItems.find((item) => item.id === furnishing.dataset.placedId);
  if (!placed) {
    return;
  }
  event.preventDefault();
  if (event.key === "ArrowLeft") placed.x -= 2;
  if (event.key === "ArrowRight") placed.x += 2;
  if (event.key === "ArrowUp") placed.y -= 2;
  if (event.key === "ArrowDown") placed.y += 2;
  Object.assign(placed, nearestCatFloorPosition(placed.x, placed.y));
  furnishing.style.left = `${placed.x}%`;
  furnishing.style.top = `${placed.y}%`;
  furnishing.style.zIndex = String(10 + Math.round(placed.y * 10));
  saveCatHome();
});

renderCatHome();
renderCatQuestion();

const grammarSourceText = document.querySelector("#grammar-source-text");
const grammarExplainButton = document.querySelector("#grammar-explain-button");
const grammarStatus = document.querySelector("#grammar-status");
const grammarResult = document.querySelector("#grammar-result");
const GRAMMAR_PROGRESS_KEY = "lingua-grammar-progress-v1";
const GRAMMAR_LANGUAGE_KEY = "lingua-grammar-language-v1";

const grammarCopy = {
  en: {
    original: "Original sentence",
    corrected: "Corrected sentence",
    corrections: "A few common patterns to review",
    noErrors: "Nice work! I didn’t find one of the common errors this local checker knows. It is not a full grammar proofread, so this is not a guarantee that every part is correct.",
    uncertain: "I can’t check this sentence reliably with my small offline rule set. I haven’t changed it. Try a short sentence with a familiar pattern, or ask a teacher.",
    noCorrection: "This checker only changes a sentence when a specific common error rule matches confidently.",
    localNote: "This check happened in your browser. The sentence was not sent anywhere.",
    saved: "Saved for review",
  },
  "zh-TW": {
    original: "原句",
    corrected: "修正後的句子",
    corrections: "可以留意的常見用法",
    noErrors: "做得很好！這個本機檢查器沒有找到它認識的常見錯誤。不過它不是完整的文法校對，不能保證句子的每個部分都正確。",
    uncertain: "這套簡單的離線規則無法可靠地檢查這個句子，所以我沒有修改它。試試含有熟悉文法的短句，或詢問老師。",
    noCorrection: "只有在明確符合常見錯誤規則時，檢查器才會修改句子。",
    localNote: "檢查在你的瀏覽器中進行，句子不會傳送到其他地方。",
    saved: "已儲存以便複習",
  },
};

function getGrammarLanguage() {
  return document.querySelector("#grammar-language").value === "zh-TW" ? "zh-TW" : "en";
}

function grammarText(en, zh) {
  return getGrammarLanguage() === "zh-TW" ? zh : en;
}

function loadGrammarProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(GRAMMAR_PROGRESS_KEY) || "{}");
    return {
      completedLessons: Array.isArray(saved.completedLessons) ? saved.completedLessons : [],
      attempts: Array.isArray(saved.attempts) ? saved.attempts : [],
      quizzes: Array.isArray(saved.quizzes) ? saved.quizzes : [],
      recentQuestions: Array.isArray(saved.recentQuestions) ? saved.recentQuestions : [],
      checkerMistakes: Array.isArray(saved.checkerMistakes) ? saved.checkerMistakes : [],
      dailyActivity: Array.isArray(saved.dailyActivity) ? saved.dailyActivity : [],
    };
  } catch {
    return { completedLessons: [], attempts: [], quizzes: [], recentQuestions: [], checkerMistakes: [], dailyActivity: [] };
  }
}

let grammarProgress = loadGrammarProgress();

function saveGrammarProgress() {
  try {
    localStorage.setItem(GRAMMAR_PROGRESS_KEY, JSON.stringify({
      completedLessons: grammarProgress.completedLessons.slice(-100),
      attempts: grammarProgress.attempts.slice(-300),
      quizzes: grammarProgress.quizzes.slice(-100),
      recentQuestions: grammarProgress.recentQuestions.slice(-30),
      checkerMistakes: grammarProgress.checkerMistakes.slice(-50),
      dailyActivity: grammarProgress.dailyActivity.slice(-300),
    }));
    return true;
  } catch {
    grammarStatus.textContent = grammarText(
      "Your browser could not save this progress. Check its storage settings.",
      "瀏覽器無法儲存學習進度，請檢查瀏覽器的儲存設定。",
    );
    return false;
  }
}

const grammarLessons = [
  {
    id: "present-simple", topic: "Present Simple", pattern: "simplePresent",
    explanation: "Use the present simple for habits, routines, facts, and regular situations. Add -s or -es with he, she, or it.",
    zh: "現在簡單式用於習慣、日常活動、事實和固定情況。主詞是 he、she 或 it 時，動詞通常加 -s 或 -es。",
    examples: [["I walk to school every day.", "我每天走路上學。"], ["She works at a small shop.", "她在一間小商店工作。"]],
    mistake: ["He walk to school.", "He walks to school.", "With he, she, or it, the present simple verb usually takes -s or -es.", "He、she、it 作主詞時，現在簡單式動詞通常要加 -s 或 -es。"],
    question: "My sister ___ English every evening.", options: ["study", "studies", "is study"], answer: 1,
  },
  {
    id: "present-continuous", topic: "Present Continuous", pattern: "presentContinuous",
    explanation: "Use am/is/are + verb-ing for an action happening now or around now.",
    zh: "現在進行式用 am/is/are + 動詞-ing，表示現在或最近正在進行的動作。",
    examples: [["They are having lunch now.", "他們現在正在吃午餐。"], ["I am learning a new song.", "我正在學一首新歌。"]],
    mistake: ["She reading now.", "She is reading now.", "The present continuous needs a form of be (am/is/are) plus an -ing verb.", "現在進行式需要 be 動詞（am/is/are）加上動詞-ing。"],
    question: "Look! The dog ___ in the garden.", options: ["runs", "is running", "ran"], answer: 1,
  },
  {
    id: "past-simple", topic: "Past Simple", pattern: "simplePast",
    explanation: "Use the past simple for a finished action or state in the past. Regular verbs often end in -ed; many common verbs are irregular.",
    zh: "過去簡單式用於已經結束的過去動作或狀態。規則動詞常加 -ed，不規則動詞則有自己的變化。",
    examples: [["We watched a film last night.", "我們昨晚看了一部電影。"], ["He went home early.", "他很早就回家了。"]],
    mistake: ["I go there yesterday.", "I went there yesterday.", "Yesterday points to the past. The past form of go is went.", "yesterday 指向過去；go 的過去式是不規則變化 went。"],
    question: "We ___ our teacher yesterday.", options: ["see", "saw", "seen"], answer: 1,
  },
  {
    id: "past-continuous", topic: "Past Continuous", pattern: "pastContinuous",
    explanation: "Use was/were + verb-ing for an action in progress at a particular past time, often when another event happened.",
    zh: "過去進行式用 was/were + 動詞-ing，表示某個過去時間正在進行的動作，常搭配另一個發生的事件。",
    examples: [["I was cooking at six.", "我六點時正在煮飯。"], ["They were walking when it started to rain.", "開始下雨時，他們正在走路。"]],
    mistake: ["We was waiting.", "We were waiting.", "Use were with we, you, and they in the past continuous.", "主詞是 we、you 或 they 時，過去進行式用 were。"],
    question: "At 8 p.m., she ___ a book.", options: ["was reading", "is reading", "readed"], answer: 0,
  },
  {
    id: "present-perfect", topic: "Present Perfect", pattern: "presentPerfect",
    explanation: "Use has/have + a past participle for experience or a past action connected to the present. The exact meaning depends on context.",
    zh: "現在完成式用 has/have + 過去分詞，表示經驗或與現在有關的過去動作；實際意思仍要看上下文。",
    examples: [["I have visited Japan twice.", "我去過日本兩次。"], ["She has just finished her work.", "她剛完成工作。"]],
    mistake: ["He have finished.", "He has finished.", "Use has with he, she, or it; use have with other common subjects.", "he、she、it 作主詞時搭配 has；其他常見主詞搭配 have。"],
    question: "They ___ already eaten lunch.", options: ["has", "have", "are"], answer: 1,
  },
  {
    id: "future-tense", topic: "Future Tense", pattern: "future",
    explanation: "Use will + the base verb for predictions, promises, or decisions made at the time of speaking. English also uses other future forms.",
    zh: "will + 原形動詞可用於預測、承諾或當下作出的決定。英文也會用其他形式表達未來。",
    examples: [["I will call you tonight.", "我今晚會打電話給你。"], ["It will be sunny tomorrow.", "明天會是晴天。"]],
    mistake: ["She will goes home.", "She will go home.", "Use the base verb after will, without -s or -es.", "will 後面使用原形動詞，不加 -s 或 -es。"],
    question: "I think it ___ rain later.", options: ["will", "is", "did"], answer: 0,
  },
  {
    id: "passive-voice", topic: "Passive Voice", pattern: "passive",
    explanation: "Use a form of be + a past participle when the receiver of an action is the focus. The person doing the action can be added with by.",
    zh: "當重點是承受動作的人或事物時，可用 be 動詞 + 過去分詞。動作者可以用 by 引出。",
    examples: [["The room is cleaned every day.", "房間每天都會打掃。"], ["The cake was made by my aunt.", "蛋糕是我阿姨做的。"]],
    mistake: ["The letters was sent.", "The letters were sent.", "Letters is plural, so use were in the past passive.", "letters 是複數，過去式 be 動詞要用 were。"],
    question: "The song ___ by a local band.", options: ["wrote", "was written", "was wrote"], answer: 1,
  },
  {
    id: "conditionals", topic: "Conditionals", pattern: "conditional",
    explanation: "A common first conditional uses if + present simple, then will + base verb for a real future possibility.",
    zh: "常見的第一類條件句使用 if + 現在簡單式，再接 will + 原形動詞，描述未來可能發生的情況。",
    examples: [["If you hurry, you will catch the bus.", "如果你快一點，就會趕上公車。"], ["If it is cold, I will wear a coat.", "如果天氣冷，我會穿外套。"]],
    mistake: ["If it will rain, we will stay home.", "If it rains, we will stay home.", "In this common conditional, use the present simple after if, not will.", "這種常見條件句的 if 子句用現在簡單式，不用 will。"],
    question: "If she ___ early, we will have time for tea.", options: ["arrives", "will arrive", "arrived"], answer: 0,
  },
  {
    id: "articles", topic: "Articles (a, an, the)", pattern: "article",
    explanation: "Use a/an with one non-specific countable noun. Use the when the listener knows which one. Choose a or an by sound, not only spelling.",
    zh: "單數可數名詞前，非特定對象常用 a/an；雙方知道是哪一個時用 the。a 或 an 要依發音選擇，不只看拼字。",
    examples: [["She bought an orange.", "她買了一顆橘子。"], ["The orange was very sweet.", "那顆橘子很甜。"]],
    mistake: ["I saw a elephant.", "I saw an elephant.", "Elephant begins with a vowel sound, so use an.", "elephant 的開頭是母音音素，所以用 an。"],
    question: "He is ___ honest person.", options: ["a", "an", "the"], answer: 1,
  },
  {
    id: "prepositions", topic: "Prepositions", pattern: "preposition",
    explanation: "Prepositions show relationships such as place, time, direction, or connection. Many choices depend on a phrase and its context.",
    zh: "介系詞表示地點、時間、方向或關係。許多介系詞的選擇取決於固定搭配和上下文。",
    examples: [["The keys are on the table.", "鑰匙在桌上。"], ["Our class starts at nine.", "我們的課九點開始。"]],
    mistake: ["I arrived to the station.", "I arrived at the station.", "We commonly use arrive at for a place such as a station. Preposition choices depend on context.", "表示到達車站這個地點時，常用 arrived at。這類搭配需要依情境學習。"],
    question: "The meeting starts ___ 10 o’clock.", options: ["in", "on", "at"], answer: 2,
  },
  {
    id: "pronouns", topic: "Pronouns", pattern: "subjectPronoun",
    explanation: "Subject pronouns (I, he, she, we, they) do the action. Object pronouns (me, him, her, us, them) receive an action or follow a preposition.",
    zh: "主格代名詞（I、he、she、we、they）執行動作；受格代名詞（me、him、her、us、them）承受動作或接在介系詞後。",
    examples: [["She called me.", "她打電話給我。"], ["We went with them.", "我們和他們一起去。"]],
    mistake: ["Me like this song.", "I like this song.", "Use I as the subject. Me is usually an object pronoun.", "句子主詞要用 I；me 通常作受詞。"],
    question: "Lily and ___ are good friends.", options: ["me", "I", "my"], answer: 1,
  },
  {
    id: "subject-verb-agreement", topic: "Subject-Verb Agreement", pattern: "simplePresent",
    explanation: "In the present simple, a singular he/she/it subject usually takes a verb ending in -s or -es. I/you/we/they use the base verb.",
    zh: "現在簡單式中，單數的 he/she/it 主詞通常搭配加 -s 或 -es 的動詞；I/you/we/they 使用原形動詞。",
    examples: [["The cat sleeps on the sofa.", "那隻貓在沙發上睡覺。"], ["My friends live nearby.", "我的朋友住在附近。"]],
    mistake: ["My brother play tennis.", "My brother plays tennis.", "My brother is one person, so the present simple verb takes -s.", "my brother 是單數第三人稱，現在簡單式動詞要加 -s。"],
    question: "The children ___ in the park.", options: ["plays", "play", "is play"], answer: 1,
  },
];

const grammarQuizQuestions = [
  { id: "e1", level: "easy", topic: "Present Simple", question: "Mia ___ to school by bus.", options: ["go", "goes", "going"], answer: 1, en: "Mia is one person (she), so the present simple verb takes -es.", zh: "Mia 是單數（she），現在簡單式動詞要加 -es。" },
  { id: "e2", level: "easy", topic: "Articles", question: "I ate ___ egg for breakfast.", options: ["a", "an", "the"], answer: 1, en: "Egg begins with a vowel sound, so use an.", zh: "egg 的開頭是母音音素，因此用 an。" },
  { id: "e3", level: "easy", topic: "Pronouns", question: "___ are my best friend.", options: ["You", "Your", "Yours"], answer: 0, en: "You is a subject pronoun and can be the subject of are.", zh: "You 是主格代名詞，可以作 are 的主詞。" },
  { id: "e4", level: "easy", topic: "Past Simple", question: "We ___ a cake yesterday.", options: ["make", "made", "making"], answer: 1, en: "Yesterday refers to the past. The past form of make is made.", zh: "yesterday 表示過去；make 的過去式是 made。" },
  { id: "e5", level: "easy", topic: "Present Continuous", question: "Look! He ___ now.", options: ["is running", "runs yesterday", "run"], answer: 0, en: "For an action happening now, use is + verb-ing with he.", zh: "表示現在正在進行的動作，he 要用 is + 動詞-ing。" },
  { id: "e6", level: "easy", topic: "Subject-Verb Agreement", question: "My parents ___ at home.", options: ["is", "are", "am"], answer: 1, en: "Parents is plural, so use are.", zh: "parents 是複數，因此用 are。" },
  { id: "e7", level: "easy", topic: "Prepositions", question: "The picture is ___ the wall.", options: ["on", "at", "from"], answer: 0, en: "On is commonly used for something attached to a surface.", zh: "表示物品在表面上時，常用 on。" },
  { id: "e8", level: "easy", topic: "Future Tense", question: "I ___ help you with that bag.", options: ["will", "was", "did"], answer: 0, en: "Will + base verb can express a future offer or decision.", zh: "will + 原形動詞可以表示未來的提議或決定。" },
  { id: "e9", level: "easy", topic: "Pronouns", question: "Tom gave the book to ___.", options: ["I", "me", "my"], answer: 1, en: "Use the object pronoun me after the preposition to.", zh: "介系詞 to 後面使用受格代名詞 me。" },
  { id: "e10", level: "easy", topic: "Articles", question: "Please close ___ door.", options: ["a", "an", "the"], answer: 2, en: "The is used when the speaker means a specific door.", zh: "說話者指特定的門時，使用 the。" },
  { id: "e11", level: "easy", topic: "Past Continuous", question: "At noon, we ___ lunch.", options: ["were eating", "are eating", "eat"], answer: 0, en: "Use were + verb-ing for an action in progress at a past time with we.", zh: "表示 we 在過去某個時間正在進行的動作，用 were + 動詞-ing。" },
  { id: "e12", level: "easy", topic: "Conditionals", question: "If it rains, I ___ at home.", options: ["will stay", "stayed", "staying"], answer: 0, en: "A common first conditional uses will + base verb for the result.", zh: "常見第一類條件句的結果子句使用 will + 原形動詞。" },
  { id: "e13", level: "easy", topic: "Present Continuous", question: "My dad ___ dinner right now.", options: ["cooks", "is cooking", "cooked"], answer: 1, en: "Right now points to an action in progress: is + verb-ing.", zh: "right now 表示動作正在進行：is + 動詞-ing。" },
  { id: "e14", level: "easy", topic: "Present Simple", question: "We ___ in a small town.", options: ["live", "lives", "living"], answer: 0, en: "We uses the base form live in the present simple.", zh: "現在簡單式中，we 使用原形動詞 live。" },
  { id: "e15", level: "easy", topic: "Subject-Verb Agreement", question: "There ___ one cookie left.", options: ["are", "is", "be"], answer: 1, en: "One cookie is singular, so use there is.", zh: "one cookie 是單數，因此用 there is。" },
  { id: "e16", level: "easy", topic: "Articles", question: "We saw ___ owl in the tree.", options: ["a", "an", "the"], answer: 1, en: "Owl begins with a vowel sound, so use an.", zh: "owl 的開頭是母音音素，因此用 an。" },
  { id: "e17", level: "easy", topic: "Pronouns", question: "Ben gave ___ a note.", options: ["I", "me", "my"], answer: 1, en: "Me is the object pronoun that receives the note.", zh: "me 是受格代名詞，在句中承受給予便條的動作。" },
  { id: "e18", level: "easy", topic: "Past Simple", question: "They ___ a film last night.", options: ["watch", "watched", "watching"], answer: 1, en: "Last night points to a finished past action; watched is the past form.", zh: "last night 表示已結束的過去動作；watched 是過去式。" },
  { id: "e19", level: "easy", topic: "Future Tense", question: "I ___ do my homework after dinner.", options: ["will", "was", "have"], answer: 0, en: "Will + base verb can describe a future plan or decision.", zh: "will + 原形動詞可描述未來的計畫或決定。" },
  { id: "e20", level: "easy", topic: "Passive Voice", question: "The classroom ___ every afternoon.", options: ["cleans", "is cleaned", "cleaned"], answer: 1, en: "The classroom receives the action, so use is + past participle.", zh: "classroom 承受動作，因此用 is + 過去分詞。" },
  { id: "m1", level: "medium", topic: "Present Perfect", question: "She ___ already seen that film.", options: ["has", "have", "is"], answer: 0, en: "Use has with she in the present perfect: has + past participle.", zh: "she 搭配 has；現在完成式為 has + 過去分詞。" },
  { id: "m2", level: "medium", topic: "Passive Voice", question: "The emails ___ yesterday.", options: ["were sent", "sent", "was send"], answer: 0, en: "The emails receive the action. Use plural were + past participle sent.", zh: "emails 承受動作；複數主詞用 were + 過去分詞 sent。" },
  { id: "m3", level: "medium", topic: "Conditionals", question: "If he ___ early, he will meet us.", options: ["arrives", "will arrive", "arrived"], answer: 0, en: "In a common first conditional, use present simple after if.", zh: "常見第一類條件句的 if 子句使用現在簡單式。" },
  { id: "m4", level: "medium", topic: "Prepositions", question: "She has lived here ___ 2020.", options: ["since", "for", "at"], answer: 0, en: "Since is used with the starting point in time (2020).", zh: "since 後面接開始的時間點（2020）。" },
  { id: "m5", level: "medium", topic: "Past Continuous", question: "I ___ when the lights went out.", options: ["was studying", "studied", "am studying"], answer: 0, en: "Was studying shows an action in progress when another past event happened.", zh: "was studying 表示另一個過去事件發生時，動作正在進行。" },
  { id: "m6", level: "medium", topic: "Subject-Verb Agreement", question: "Neither of the answers ___ correct.", options: ["are", "is", "be"], answer: 1, en: "In standard formal English, neither is usually treated as singular here, so use is.", zh: "在標準正式英文中，這裡的 neither 通常視為單數，因此用 is。" },
  { id: "m7", level: "medium", topic: "Articles", question: "She hopes to become ___ engineer.", options: ["a", "an", "the"], answer: 1, en: "Engineer begins with a vowel sound, so use an.", zh: "engineer 的開頭是母音音素，因此用 an。" },
  { id: "m8", level: "medium", topic: "Pronouns", question: "The teacher spoke to Alex and ___.", options: ["I", "me", "my"], answer: 1, en: "Use the object pronoun me after the preposition to.", zh: "介系詞 to 後面使用受格代名詞 me。" },
  { id: "m9", level: "medium", topic: "Future Tense", question: "I think they ___ the match.", options: ["will win", "wins", "winning"], answer: 0, en: "Use will + base verb for a prediction; win stays in its base form.", zh: "預測可用 will + 原形動詞；win 保持原形。" },
  { id: "m10", level: "medium", topic: "Present Simple", question: "Water ___ at 100°C at sea level.", options: ["boil", "boils", "is boil"], answer: 1, en: "A general fact uses present simple. Water is singular, so add -s.", zh: "一般事實使用現在簡單式；water 作單數主詞，動詞加 -s。" },
  { id: "m11", level: "medium", topic: "Present Perfect", question: "We ___ each other for ten years.", options: ["have known", "knew", "are knowing"], answer: 0, en: "Have known connects a situation that began in the past with the present.", zh: "have known 表示過去開始並持續到現在的狀態。" },
  { id: "m12", level: "medium", topic: "Passive Voice", question: "This bridge ___ in 1980.", options: ["built", "was built", "was build"], answer: 1, en: "A passive past form is was + past participle built.", zh: "被動式過去式為 was + 過去分詞 built。" },
  { id: "m13", level: "medium", topic: "Past Continuous", question: "While I ___, someone knocked at the door.", options: ["was reading", "read yesterday", "am reading"], answer: 0, en: "Was reading describes the action in progress when the knock happened.", zh: "was reading 描述敲門聲發生時正在進行的動作。" },
  { id: "m14", level: "medium", topic: "Prepositions", question: "She has worked here ___ 2020.", options: ["since", "for", "during"], answer: 0, en: "Since goes with a starting point in time, such as a year.", zh: "since 搭配開始的時間點，例如年份。" },
  { id: "m15", level: "medium", topic: "Subject-Verb Agreement", question: "Each of the students ___ a notebook.", options: ["have", "has", "are having"], answer: 1, en: "Each is grammatically singular here, so use has.", zh: "此處 each 在文法上視為單數，因此用 has。" },
  { id: "m16", level: "medium", topic: "Prepositions", question: "She is interested ___ photography.", options: ["in", "on", "at"], answer: 0, en: "The common phrase is interested in something.", zh: "常見搭配是 interested in something。" },
  { id: "m17", level: "medium", topic: "Passive Voice", question: "The report ___ by the team yesterday.", options: ["was written", "wrote", "was wrote"], answer: 0, en: "Use was + the past participle written for a singular subject in the passive past.", zh: "單數主詞的過去被動式使用 was + 過去分詞 written。" },
  { id: "m18", level: "medium", topic: "Conditionals", question: "Unless you ___ now, you will be late.", options: ["leave", "will leave", "left"], answer: 0, en: "Unless means if…not. Use present simple in this future condition.", zh: "unless 表示 if…not。這種未來條件句使用現在簡單式。" },
  { id: "m19", level: "medium", topic: "Articles", question: "We waited for ___ hour.", options: ["a", "an", "the"], answer: 1, en: "The h in hour is silent, so the word begins with a vowel sound: an hour.", zh: "hour 的 h 不發音，字首是母音音素，因此說 an hour。" },
  { id: "m20", level: "medium", topic: "Present Perfect", question: "I have never ___ to Canada.", options: ["be", "been", "was"], answer: 1, en: "The present perfect uses have + the past participle been.", zh: "現在完成式使用 have + 過去分詞 been。" },
  { id: "h1", level: "hard", topic: "Present Perfect", question: "By the time we arrived, the film ___.", options: ["had started", "has started", "was starting"], answer: 0, en: "Had started shows an earlier past action before another past event.", zh: "had started 表示在另一個過去事件之前已發生的動作。" },
  { id: "h2", level: "hard", topic: "Conditionals", question: "If I had known, I ___ you.", options: ["would have called", "will call", "called"], answer: 0, en: "This unreal past conditional commonly uses if + past perfect and would have + past participle.", zh: "這種與過去事實相反的條件句，常用 if + 過去完成式，結果用 would have + 過去分詞。" },
  { id: "h3", level: "hard", topic: "Passive Voice", question: "The documents ___ before the meeting began.", options: ["had been signed", "have signed", "were sign"], answer: 0, en: "Had been signed is the past perfect passive: had been + past participle.", zh: "had been signed 是過去完成被動式：had been + 過去分詞。" },
  { id: "h4", level: "hard", topic: "Subject-Verb Agreement", question: "The list of items ___ on the desk.", options: ["are", "is", "were"], answer: 1, en: "The subject is list, not items. List is singular, so use is.", zh: "主詞是 list，不是 items。list 是單數，因此用 is。" },
  { id: "h5", level: "hard", topic: "Articles", question: "She plays ___ piano very well.", options: ["a", "an", "the"], answer: 2, en: "In this common expression for playing a musical instrument, English uses the.", zh: "表示演奏樂器的這種常見說法中，英文使用 the。" },
  { id: "h6", level: "hard", topic: "Prepositions", question: "Despite ___ tired, he finished the report.", options: ["being", "he was", "be"], answer: 0, en: "Despite is a preposition, so it is followed by a noun or an -ing form here.", zh: "despite 是介系詞，這裡後面接名詞或 -ing 形式。" },
  { id: "h7", level: "hard", topic: "Past Continuous", question: "While I ___, my phone rang.", options: ["was driving", "drove", "am driving"], answer: 0, en: "Was driving shows the longer action in progress when the phone rang.", zh: "was driving 表示電話響起時，較長的動作正在進行。" },
  { id: "h8", level: "hard", topic: "Pronouns", question: "Each student should bring ___ own notebook.", options: ["their", "them", "they"], answer: 0, en: "Singular they/their is widely used when a person's gender is unknown or not specified.", zh: "當性別未知或未特別指出時，單數 they/their 已廣泛使用。" },
  { id: "h9", level: "hard", topic: "Future Tense", question: "By next June, she ___ here for a decade.", options: ["will have worked", "works", "has worked"], answer: 0, en: "Will have worked is future perfect, describing duration completed by a future time.", zh: "will have worked 是未來完成式，表示到未來某時間前累積完成的期間。" },
  { id: "h10", level: "hard", topic: "Present Simple", question: "Not only the players but also the coach ___ ready.", options: ["are", "is", "be"], answer: 1, en: "With not only…but also, the verb commonly agrees with the nearer subject, the singular coach.", zh: "not only…but also 結構中，動詞通常配合較近的主詞 coach；此處是單數。" },
  { id: "h11", level: "hard", topic: "Articles", question: "___ rich should help those in need.", options: ["A", "The", "An"], answer: 1, en: "The + an adjective can refer to a whole group: the rich means rich people in general.", zh: "the + 形容詞可指一整個群體；the rich 指富有的人。" },
  { id: "h12", level: "hard", topic: "Conditionals", question: "Unless you ___ now, you will miss the train.", options: ["leave", "will leave", "left"], answer: 0, en: "Unless means if…not. The condition uses present simple for this future possibility.", zh: "unless 表示 if…not。描述未來可能時，條件子句使用現在簡單式。" },
  { id: "h13", level: "hard", topic: "Conditionals", question: "If she had left earlier, she ___ the train.", options: ["would have caught", "will catch", "would catch"], answer: 0, en: "An unreal past result commonly uses would have + past participle.", zh: "與過去事實相反的結果子句常用 would have + 過去分詞。" },
  { id: "h14", level: "hard", topic: "Subject-Verb Agreement", question: "The list of items ___ on the desk.", options: ["are", "is", "were"], answer: 1, en: "The subject is list, not items. List is singular, so use is.", zh: "主詞是 list，不是 items。list 是單數，因此用 is。" },
  { id: "h15", level: "hard", topic: "Passive Voice", question: "By noon, the invitations ___ to every guest.", options: ["will have been sent", "will send", "have been send"], answer: 0, en: "Will have been sent is the future perfect passive: will have been + past participle.", zh: "will have been sent 是未來完成被動式：will have been + 過去分詞。" },
  { id: "h16", level: "hard", topic: "Verb Forms", question: "He denied ___ the email.", options: ["to send", "sending", "send"], answer: 1, en: "The verb deny is commonly followed by a gerund (verb-ing).", zh: "動詞 deny 後面常接動名詞（動詞-ing）。" },
  { id: "h17", level: "hard", topic: "Subject-Verb Agreement", question: "The manager, along with two assistants, ___ attending.", options: ["are", "is", "were"], answer: 1, en: "The main subject is the singular manager. Along with does not make it plural.", zh: "主要主詞是單數的 manager；along with 不會讓主詞變成複數。" },
  { id: "h18", level: "hard", topic: "Present Perfect", question: "She ___ at this school since she graduated.", options: ["has taught", "taught", "is teaching"], answer: 0, en: "Has taught connects work that began in the past with the present; since gives the starting point.", zh: "has taught 表示過去開始並延續到現在；since 提供開始時間點。" },
  { id: "h19", level: "hard", topic: "Prepositions", question: "Despite ___ unwell, he joined the meeting.", options: ["feeling", "he felt", "feel"], answer: 0, en: "Despite is a preposition and can be followed by a gerund phrase.", zh: "despite 是介系詞，後面可以接動名詞片語。" },
  { id: "h20", level: "hard", topic: "Pronouns", question: "Every guest should bring ___ own ticket.", options: ["their", "them", "they"], answer: 0, en: "Singular they/their is widely used when a person's gender is unknown or not specified.", zh: "當性別未知或未特別指出時，單數 they/their 已廣泛使用。" },
];

const grammarPatterns = {
  presentContinuous: {
    structure: "Present continuous",
    explanation: "Use am, is, or are + an -ing verb for an action happening now or around now.",
    example: "She is reading a book.",
  },
  pastContinuous: {
    structure: "Past continuous",
    explanation: "Use was or were + an -ing verb for an action that was in progress at a past time.",
    example: "They were waiting for the bus.",
  },
  presentPerfectContinuous: {
    structure: "Present perfect continuous",
    explanation: "Use has or have been + an -ing verb for an activity that started earlier and continues, or has a result now.",
    example: "I have been studying for an hour.",
  },
  presentPerfect: {
    structure: "Present perfect",
    explanation: "Use has or have + a past participle for past experience or a past action connected to now.",
    example: "She has finished her homework.",
  },
  pastPerfect: {
    structure: "Past perfect",
    explanation: "Use had + a past participle for an action that happened before another past time or action.",
    example: "They had left before I arrived.",
  },
  futurePerfect: {
    structure: "Future perfect",
    explanation: "Use will have + a past participle for something that will be complete before a future time.",
    example: "By Friday, I will have finished the book.",
  },
  future: {
    structure: "Future with “will”",
    explanation: "Use will + the base form of a verb for a future decision, prediction, or promise.",
    example: "I will call you tomorrow.",
  },
  simplePast: {
    structure: "Simple past",
    explanation: "The simple past describes a finished action or state in the past.",
    example: "We visited our friends yesterday.",
  },
  simplePresent: {
    structure: "Simple present",
    explanation: "The simple present is often used for habits, facts, and regular situations.",
    example: "He walks to school every day.",
  },
  bePresent: {
    structure: "Present form of “be”",
    explanation: "Am, is, and are connect a subject with a description, identity, or place.",
    example: "They are happy.",
  },
  bePast: {
    structure: "Past form of “be”",
    explanation: "Was and were connect a subject with a description, identity, or place in the past.",
    example: "She was tired after work.",
  },
  article: {
    structure: "Articles: “a,” “an,” and “the”",
    explanation: "A and an introduce one non-specific countable thing. The points to a specific thing. This identifies article use; it does not check whether the article is correct in context.",
    example: "I saw a bird. The bird was blue.",
  },
  preposition: {
    structure: "Prepositions",
    explanation: "Prepositions such as in, on, at, and with show relationships like place, time, direction, or connection. Their exact meaning depends on the words around them.",
    example: "The keys are on the table.",
  },
  subjectPronoun: {
    structure: "Subject pronouns",
    explanation: "I, you, he, she, it, we, and they can name who or what does an action.",
    example: "They play music.",
  },
  objectPronoun: {
    structure: "Object pronouns",
    explanation: "Me, you, him, her, it, us, and them can name who or what receives an action.",
    example: "Mia called him.",
  },
  possessive: {
    structure: "Possessive words",
    explanation: "Words such as my, your, her, and their show who something belongs to. Mine, yours, hers, and theirs can stand alone.",
    example: "That is her bag. The blue one is mine.",
  },
  ambiguousPronoun: {
    structure: "Pronoun role needs more analysis",
    explanation: "“Her” can be an object pronoun or a possessive word. This small guide cannot always tell which role it has, so it will not guess.",
    example: "I called her. / I called her friend.",
  },
  demonstrative: {
    structure: "Demonstratives",
    explanation: "This, that, these, and those point to people or things. This and these are often used for things nearby; that and those for things farther away.",
    example: "These cookies are warm.",
  },
  infinitive: {
    structure: "Infinitive: “to” + verb",
    explanation: "To + the base form of a verb can name an action as an idea or purpose.",
    example: "I want to learn English.",
  },
  modal: {
    structure: "Modal verb",
    explanation: "A modal such as can, could, should, or must comes before a base verb to add an idea like ability, advice, or necessity.",
    example: "You should drink some water.",
  },
  passive: {
    structure: "Passive voice",
    explanation: "Be + a past participle focuses on the person or thing receiving an action. This pattern is identified only when the verb form is clear.",
    example: "The window was opened by Sam.",
  },
  conditional: {
    structure: "First conditional",
    explanation: "If + present simple, will + base verb describes a real future possibility and its result.",
    example: "If it rains, we will stay home.",
  },
  subordinate: {
    structure: "Subordinating conjunction",
    explanation: "Words such as because, although, when, and while connect a supporting clause to a main clause. The connected idea depends on the conjunction.",
    example: "Although it was cold, we went outside.",
  },
  compound: {
    structure: "Compound sentence",
    explanation: "A compound sentence joins two complete ideas, often with and, but, or so.",
    example: "I was tired, but I finished my work.",
  },
  basicClause: {
    structure: "Basic clause: subject + verb",
    explanation: "A basic English clause needs a subject and a verb. Some verbs also need an object to complete the idea.",
    example: "Birds sing.",
  },
};

const knownVerbForms = {
  simple: new Set([
    "am", "is", "are", "was", "were", "be", "been", "being",
    "go", "goes", "eat", "eats", "like", "likes", "work", "works",
    "study", "studies", "play", "plays", "walk", "walks", "watch", "watches",
    "live", "lives", "want", "wants", "need", "needs", "make", "makes",
    "take", "takes", "have", "has", "do", "does", "say", "says",
    "read", "reads", "write", "writes", "see", "sees", "know", "knows",
    "call", "calls", "help", "helps", "finish", "finishes", "visit", "visits",
    "open", "opens", "feel", "feels", "leave", "leaves", "arrive", "arrives",
    "rain", "rains", "stay", "stays", "drink", "drinks", "learn", "learns",
    "cook", "cooks", "wait", "waits", "run", "runs", "speak", "speaks",
    "buy", "buys", "find", "finds", "give", "gives", "think", "thinks",
    "enjoy", "enjoys", "believe", "believes", "start", "starts", "finish", "finishes",
  ]),
  participles: new Set([
    "been", "gone", "eaten", "written", "seen", "known", "done", "made", "taken",
    "given", "found", "thought", "bought", "left", "read", "said", "spoken",
    "finished", "visited", "opened", "called", "helped", "watched", "played",
    "lived", "worked", "studied", "used", "cooked", "asked", "cleaned",
  ]),
  past: new Set([
    "was", "were", "went", "ate", "wrote", "saw", "knew", "did", "made",
    "took", "gave", "found", "thought", "bought", "left", "said", "spoke",
    "came", "felt", "had", "read", "ran", "drank", "began", "became",
    "finished", "visited", "opened", "called", "helped", "watched", "played",
    "lived", "worked", "studied", "used", "cooked", "asked", "cleaned",
    "started", "arrived", "enjoyed",
  ]),
  base: new Set([
    "go", "eat", "write", "see", "know", "do", "make", "take", "give",
    "find", "think", "buy", "leave", "say", "speak", "come", "feel", "have",
    "read", "run", "drink", "begin", "become", "finish", "visit", "open",
    "call", "help", "watch", "play", "live", "work", "study", "use", "cook",
    "ask", "clean", "start", "arrive", "enjoy", "learn", "walk", "stay",
    "rain", "wait", "want", "need",
  ]),
};

const recognizedPrepositions = new Set([
  "about", "above", "after", "at", "before", "behind", "below", "between",
  "by", "during", "for", "from", "in", "into", "near", "of", "off", "on",
  "over", "through", "to", "under", "with", "without",
]);

function analyzeGrammar(sentence) {
  const text = sentence.trim().replace(/[’‘]/g, "'");
  const words = text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
  const wordSet = new Set(words);
  const subjectPronounWords = new Set(["i", "you", "he", "she", "it", "we", "they"]);
  const found = new Set();
  const points = [];
  const add = (pattern) => {
    if (!found.has(pattern)) {
      found.add(pattern);
      points.push(grammarPatterns[pattern]);
    }
  };
  const hasVerbForm = (set, segment = words) => segment.some((word) => set.has(word));
  const auxiliaryWords = new Set([
    "will", "would", "can", "could", "should", "must", "may", "might",
    "has", "have", "had", "do", "does", "did", "to",
  ]);
  const beForms = new Set(["am", "is", "are", "was", "were"]);
  const clauseStarts = new Set(["and", "but", "or", "so", "although", "because", "when", "while", "if"]);
  const isVerbAt = (index) => {
    const word = words[index];
    return knownVerbForms.simple.has(word) ||
      knownVerbForms.past.has(word) ||
      ["will", "would", "can", "could", "should", "must", "may", "might"].includes(word);
  };

  if (words.some((word) => ["a", "an", "the"].includes(word))) {
    add("article");
  }
  if (words.some((word, index) =>
    recognizedPrepositions.has(word) &&
    !(word === "to" && knownVerbForms.base.has(words[index + 1])) &&
    !(subjectPronounWords.has(words[index + 1]) && isVerbAt(index + 2)),
  )) {
    add("preposition");
  }
  const subjectPronounAt = (index) =>
    ["i", "you", "he", "she", "it", "we", "they"].includes(words[index]) &&
    (index === 0 || clauseStarts.has(words[index - 1])) &&
    isVerbAt(index + 1);
  if (words.some((_, index) => subjectPronounAt(index))) {
    add("subjectPronoun");
  }
  const hasObjectPronoun = words.some((word, index) => {
    if (!["me", "him", "us", "them", "it"].includes(word) ||
        subjectPronounAt(index)) {
      return false;
    }
    const previous = words[index - 1];
    const followsObjectMarker = knownVerbForms.simple.has(previous) ||
      knownVerbForms.past.has(previous) ||
      recognizedPrepositions.has(previous);
    if (!followsObjectMarker) {
      return false;
    }
    if (word === "it") {
      const afterPronoun = text.slice(text.toLowerCase().indexOf(word, text.toLowerCase().indexOf(previous) + previous.length) + word.length);
      return !/^\s*[a-z]/i.test(afterPronoun);
    }
    return true;
  });
  if (hasObjectPronoun) {
    add("objectPronoun");
  }
  const hasPossessive = words.some((word) =>
    ["my", "your", "his", "its", "our", "their", "mine", "yours", "hers", "ours", "theirs"].includes(word),
  );
  if (hasPossessive) {
    add("possessive");
  }
  if (wordSet.has("her")) {
    add("ambiguousPronoun");
  }
  if (words.some((word) => ["this", "that", "these", "those"].includes(word))) {
    add("demonstrative");
  }

  for (let index = 0; index < words.length - 1; index += 1) {
    const [first, second, third] = words.slice(index, index + 3);
    if (["am", "is", "are", "was", "were"].includes(first) && /^[a-z]+ing$/.test(second || "")) {
      add(first === "was" || first === "were" ? "pastContinuous" : "presentContinuous");
    }
    if (["has", "have"].includes(first) && second === "been" && /^[a-z]+ing$/.test(third || "")) {
      add("presentPerfectContinuous");
    }
    if (first === "had" && knownVerbForms.participles.has(second)) {
      add("pastPerfect");
    }
    if (first === "will" && second === "have" && knownVerbForms.participles.has(third)) {
      add("futurePerfect");
    }
    if (first === "will" && knownVerbForms.base.has(second) &&
        !(second === "have" && knownVerbForms.participles.has(third))) {
      add("future");
    }
    if (["can", "could", "should", "must", "may", "might", "would"].includes(first) &&
        knownVerbForms.base.has(second)) {
      add("modal");
    }
    if (["has", "have"].includes(first) && words[index - 1] !== "will" &&
        knownVerbForms.participles.has(second)) {
      add("presentPerfect");
    }
    if (["was", "were", "is", "are", "am"].includes(first) &&
        knownVerbForms.participles.has(second)) {
      add("passive");
    }
    if (first === "didn't" && knownVerbForms.base.has(second)) {
      add("simplePast");
    }
    if (first === "to" && knownVerbForms.base.has(second)) {
      add("infinitive");
    }
  }

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!knownVerbForms.past.has(word) || beForms.has(word) ||
        (word === "had" && knownVerbForms.participles.has(words[index + 1]))) {
      continue;
    }
    const previous = words[index - 1];
    if (!subjectPronounWords.has(previous)) {
      continue;
    }
    if (["has", "have", "had", "been"].includes(previous)) {
      continue;
    }
    if (["is", "are", "was", "were", "am"].includes(previous) &&
        knownVerbForms.participles.has(word)) {
      continue;
    }
    add("simplePast");
    break;
  }
  if (words.some((word, index) =>
    ["was", "were"].includes(word) &&
    !/^[a-z]+ing$/.test(words[index + 1] || "") &&
    !knownVerbForms.participles.has(words[index + 1]),
  )) {
    add("bePast");
  }
  if (hasVerbForm(knownVerbForms.simple) && !found.has("simplePast") && !found.has("presentContinuous")) {
    const hasNonProgressiveBe = words.some((word, index) =>
      ["am", "is", "are"].includes(word) && !/^[a-z]+ing$/.test(words[index + 1] || ""),
    );
    if (hasNonProgressiveBe) {
      add("bePresent");
    } else if (words.some((word, index) =>
      subjectPronounWords.has(words[index - 1]) &&
      knownVerbForms.simple.has(word) &&
      !beForms.has(word) &&
      !auxiliaryWords.has(words[index - 1]) &&
      !(["has", "have"].includes(word) &&
        (words[index + 1] === "been" || knownVerbForms.participles.has(words[index + 1]))),
    )) {
      add("simplePresent");
    }
  }

  const hasIfPresentClause = words.some((word, index) =>
    word === "if" &&
    subjectPronounWords.has(words[index + 1]) &&
    knownVerbForms.simple.has(words[index + 2]),
  );
  const hasWillBaseClause = words.some((word, index) =>
    word === "will" &&
    knownVerbForms.base.has(words[index + 1]) &&
    !(words[index + 1] === "have" && knownVerbForms.participles.has(words[index + 2])),
  );
  if (hasIfPresentClause && hasWillBaseClause) {
    add("conditional");
  }
  const hasSubordinateClause = words.some((word, index) =>
    ["because", "although", "when", "while"].includes(word) &&
    subjectPronounWords.has(words[index + 1]) &&
    isVerbAt(index + 2),
  );
  if (hasSubordinateClause) {
    add("subordinate");
  }
  const hasSubjectVerb = (segment) => segment.some((word, index) =>
    subjectPronounWords.has(word) &&
    (index === 0 || clauseStarts.has(segment[index - 1])) &&
    isVerbAtInSegment(segment, index + 1),
  );
  const isVerbAtInSegment = (segment, index) =>
    knownVerbForms.simple.has(segment[index]) ||
    knownVerbForms.past.has(segment[index]) ||
    ["will", "would", "can", "could", "should", "must", "may", "might"].includes(segment[index]);
  for (const conjunction of ["and", "but", "so", "or"]) {
    const index = words.indexOf(conjunction);
    if (index > 0 &&
        hasSubjectVerb(words.slice(0, index)) &&
        hasSubjectVerb(words.slice(index + 1))) {
      add("compound");
      break;
    }
  }
  if (words.length > 1 && subjectPronounAt(0)) {
    add("basicClause");
  }

  return {
    summary: points.length
      ? "I found these recognizable patterns. This small guide explains patterns it can match; it does not check whether every part of your sentence is correct."
      : "I can’t confidently identify a supported grammar pattern in this sentence. It may be a phrase, an uncommon form, or more complex than this small guide can analyze. Try a short, complete English sentence. No grammar guess was added.",
    grammarPoints: points,
    vocabulary: [],
  };
}

const grammarCorrectionRules = [
  {
    topic: "Verb Forms",
    regex: /\bI\s+am\s+agree\b/i,
    replacement: "I agree",
    en: "Agree is a verb, so use I agree. Do not put am before this verb.",
    zh: "agree 是動詞，因此說 I agree。這個動詞前不加 am。",
  },
  {
    topic: "Subject-Verb Agreement",
    regex: /\b(I|you|we|they)\s+has\b/i,
    replacement: (match, subject) => `${subject} have`,
    en: "I, you, we, and they use have, not has.",
    zh: "I、you、we、they 搭配 have，不搭配 has。",
  },
  {
    topic: "Subject-Verb Agreement",
    regex: /\b(he|she|it)\s+have\b/i,
    replacement: (match, subject) => `${subject} has`,
    en: "He, she, and it use has in the present simple.",
    zh: "現在簡單式中，he、she、it 搭配 has。",
  },
  {
    topic: "Subject-Verb Agreement",
    regex: /\bI\s+is\b/i,
    replacement: "I am",
    en: "The pronoun I takes am, not is.",
    zh: "代名詞 I 搭配 am，不搭配 is。",
  },
  {
    topic: "Subject-Verb Agreement",
    regex: /\b(he|she|it|this|that)\s+are\b/i,
    replacement: (match, subject) => `${subject} is`,
    en: "A singular subject such as he, she, it, this, or that takes is.",
    zh: "he、she、it、this、that 等單數主詞搭配 is。",
  },
  {
    topic: "Subject-Verb Agreement",
    regex: /\b(we|they|these|those)\s+is\b/i,
    replacement: (match, subject) => `${subject} are`,
    en: "A plural subject such as we, they, these, or those takes are.",
    zh: "we、they、these、those 等複數主詞搭配 are。",
  },
  {
    topic: "Subject-Verb Agreement",
    regex: /\b(I|we|they)\s+are\b/i,
    replacement: (match, subject) => `${subject} ${subject.toLowerCase() === "i" ? "am" : "are"}`,
    en: "I takes am. We and they take are.",
    zh: "I 搭配 am；we 和 they 搭配 are。",
  },
  {
    topic: "Subject-Verb Agreement",
    regex: /\b(we|they|you)\s+was\b/i,
    replacement: (match, subject) => `${subject} were`,
    en: "We, they, and you use were in the past form of be.",
    zh: "過去式 be 動詞中，we、they、you 搭配 were。",
  },
  {
    topic: "Subject-Verb Agreement",
    regex: /\b(I|he|she|it)\s+were\b/i,
    replacement: (match, subject) => `${subject} was`,
    en: "I, he, she, and it normally use was in the past form of be.",
    zh: "過去式 be 動詞中，I、he、she、it 通常搭配 was。",
  },
  {
    topic: "Subject-Verb Agreement",
    regex: /\b(he|she|it)\s+don't\b/i,
    replacement: (match, subject) => `${subject} doesn't`,
    en: "He, she, and it use doesn't in the present simple negative.",
    zh: "現在簡單式否定句中，he、she、it 搭配 doesn't。",
  },
  {
    topic: "Subject-Verb Agreement",
    regex: /\b(I|you|we|they)\s+doesn't\b/i,
    replacement: (match, subject) => `${subject} don't`,
    en: "I, you, we, and they use don't in the present simple negative.",
    zh: "現在簡單式否定句中，I、you、we、they 搭配 don't。",
  },
  {
    topic: "Subject-Verb Agreement",
    regex: /\b(I|you|we|they)\s+does\b/i,
    replacement: (match, subject) => `${subject} do`,
    en: "I, you, we, and they use do, not does.",
    zh: "I、you、we、they 搭配 do，不搭配 does。",
  },
  {
    topic: "Verb Forms",
    regex: /\b(did|didn't|did not)\s+(went|gone|ate|eaten|saw|seen|did|done|had|made|took|taken)\b/i,
    replacement: (match, auxiliary) => `${auxiliary} ${
      { went: "go", gone: "go", ate: "eat", eaten: "eat", saw: "see", seen: "see",
        did: "do", done: "do", had: "have", made: "make", took: "take", taken: "take" }[
        match.trim().split(/\s+/).pop().toLowerCase()
      ]
    }`,
    en: "After did or didn't, use the base form of the verb.",
    zh: "did 或 didn't 後面使用動詞原形。",
  },
  {
    topic: "Verb Forms",
    regex: /\b(he|she|it|my brother|my sister|the cat|the dog)\s+(go|do|have)\b/i,
    replacement: (match, subject, verb) => `${subject} ${
      { go: "goes", do: "does", have: "has" }[verb.toLowerCase()]
    }`,
    en: "In the present simple, this singular subject needs the matching -s form.",
    zh: "現在簡單式中，這個單數主詞要搭配相應的第三人稱形式。",
  },
  {
    topic: "Verb Forms",
    regex: /\b(he|she|it|my brother|my sister|the cat|the dog)\s+(walk|work|like|play|need|want|eat|drink|read|write|visit|watch|cook|finish|live)\b/i,
    replacement: (match, subject, verb) => `${subject} ${
      verb.toLowerCase().endsWith("y")
        ? `${verb.slice(0, -1)}ies`
        : ["watch", "wash", "finish"].some((ending) => verb.toLowerCase().endsWith(ending))
          ? `${verb}es`
          : `${verb}s`
    }`,
    en: "In the present simple, a he/she/it subject usually needs -s or -es on the verb.",
    zh: "現在簡單式中，he/she/it 主詞的動詞通常要加 -s 或 -es。",
  },
  {
    topic: "Verb Forms",
    regex: /\b(I|you|we|they)\s+(goes|does|has|walks|works|likes|plays|needs|wants|eats|drinks|reads|writes|visits|watches|cooks|finishes|lives)\b/i,
    replacement: (match, subject, verb) => `${subject} ${
      { goes: "go", does: "do", has: "have", walks: "walk", works: "work",
        likes: "like", plays: "play", needs: "need", wants: "want", eats: "eat",
        drinks: "drink", reads: "read", writes: "write", visits: "visit",
        watches: "watch", cooks: "cook", finishes: "finish", lives: "live" }[
        verb.toLowerCase()
      ]
    }`,
    en: "I, you, we, and they use the base verb in the present simple.",
    zh: "現在簡單式中，I、you、we、they 使用原形動詞。",
  },
  {
    topic: "Verb Forms",
    regex: /\b(he|she|it|my brother|my sister|the cat|the dog)\s+(doesn't|does not)\s+(goes|does|has|walks|works|likes|plays|needs|wants|eats|drinks|reads|writes|visits|watches|cooks|finishes|lives)\b/i,
    replacement: (match, subject, auxiliary, verb) => `${subject} ${auxiliary} ${
      { goes: "go", does: "do", has: "have", walks: "walk", works: "work",
        likes: "like", plays: "play", needs: "need", wants: "want", eats: "eat",
        drinks: "drink", reads: "read", writes: "write", visits: "visit",
        watches: "watch", cooks: "cook", finishes: "finish", lives: "live" }[
        verb.toLowerCase()
      ]
    }`,
    en: "After doesn't, use the base verb without -s or -es.",
    zh: "doesn't 後面要使用原形動詞，不加 -s 或 -es。",
  },
  {
    topic: "Articles",
    regex: /\b(a)\s+(apple|orange|egg|elephant|umbrella|idea|hour)\b/i,
    replacement: (match, article, noun) => `an ${noun}`,
    en: "Use an before these words because they begin with a vowel sound.",
    zh: "這些字的開頭是母音音素，因此前面用 an。",
  },
  {
    topic: "Articles",
    regex: /\b(an)\s+(book|car|dog|cat|university|useful|European)\b/i,
    replacement: (match, article, noun) => `a ${noun}`,
    en: "Use a before these words because they begin with a consonant sound.",
    zh: "這些字的開頭是子音音素，因此前面用 a。",
  },
  {
    topic: "Comparatives",
    regex: /\bmore\s+(better|worse|bigger|smaller|easier|harder)\b/i,
    replacement: (match, adjective) => adjective,
    en: "These comparative forms already express comparison, so they do not need more.",
    zh: "這些比較級本身已經表示比較，不需要再加 more。",
  },
  {
    topic: "Comparatives",
    regex: /\bmost\s+(best|worst|biggest|smallest|easiest|hardest)\b/i,
    replacement: (match, adjective) => adjective,
    en: "These superlative forms already express the highest degree, so they do not need most.",
    zh: "這些最高級本身已表示最高程度，不需要再加 most。",
  },
];

function checkCommonGrammar(sentence) {
  let corrected = sentence.trim();
  const corrections = [];
  for (const rule of grammarCorrectionRules) {
    const match = rule.regex.exec(corrected);
    if (!match) {
      continue;
    }
    const wrong = match[0];
    const right = typeof rule.replacement === "function"
      ? rule.replacement(...match)
      : rule.replacement;
    if (!right || wrong.toLowerCase() === right.toLowerCase()) {
      continue;
    }
    corrected = corrected.slice(0, match.index) + right + corrected.slice(match.index + wrong.length);
    corrections.push({
      topic: rule.topic,
      wrong,
      right,
      en: rule.en,
      zh: rule.zh,
    });
  }
  const recognized = analyzeGrammar(corrected).grammarPoints.length > 0;
  return {
    original: sentence.trim(),
    corrected,
    corrections,
    confident: corrections.length > 0 || recognized,
  };
}

function appendHighlightedText(container, sentence, terms) {
  const matches = terms.filter(Boolean).sort((a, b) => b.length - a.length);
  if (!matches.length) {
    container.textContent = sentence;
    return;
  }
  const expression = new RegExp(matches.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
  let lastIndex = 0;
  for (const match of sentence.matchAll(expression)) {
    container.append(document.createTextNode(sentence.slice(lastIndex, match.index)));
    const mark = createElement("mark", "grammar-highlight", match[0]);
    container.append(mark);
    lastIndex = match.index + match[0].length;
  }
  container.append(document.createTextNode(sentence.slice(lastIndex)));
}

function explainGrammar(sentence, saveMistake = true) {
  grammarResult.hidden = true;
  grammarResult.replaceChildren();
  if (!sentence.trim()) {
    grammarStatus.textContent = grammarText("Add an English sentence first.", "請先輸入英文句子。");
    return;
  }
  if (sentence.length > 500) {
    grammarStatus.textContent = grammarText(
      "Please use 500 characters or fewer so the local grammar guide can check your sentence.",
      "請輸入 500 個字元以內的句子，讓本機文法工具進行檢查。",
    );
    return;
  }
  grammarStatus.textContent = grammarText("Checking common grammar patterns in this browser…", "正在瀏覽器中檢查常見文法……");
  const result = checkCommonGrammar(sentence);
  const language = getGrammarLanguage();
  const copy = grammarCopy[language];
  if (result.corrections.length) {
    const originalCard = createElement("article", "grammar-sentence-card");
    originalCard.append(createElement("h3", "", copy.original));
    const originalText = createElement("p", "grammar-sentence-text");
    appendHighlightedText(originalText, result.original, result.corrections.map((item) => item.wrong));
    originalCard.append(originalText);
    const correctedCard = createElement("article", "grammar-sentence-card is-corrected");
    correctedCard.append(createElement("h3", "", copy.corrected));
    const correctedText = createElement("p", "grammar-sentence-text");
    appendHighlightedText(correctedText, result.corrected, result.corrections.map((item) => item.right));
    correctedCard.append(correctedText);
    grammarResult.append(originalCard, correctedCard, createElement("h3", "grammar-card-heading", copy.corrections));
    result.corrections.forEach((item) => {
      const card = createElement("article", "grammar-correction-card");
      card.append(
        createElement("span", "grammar-topic-stamp", item.topic),
        createElement("p", "grammar-correction-pair", `${item.wrong} → ${item.right}`),
        createElement("p", "grammar-explanation", language === "zh-TW" ? item.zh : item.en),
      );
      grammarResult.append(card);
    });
    if (saveMistake) {
      grammarProgress.checkerMistakes.unshift({
        id: `${Date.now()}-${Math.random()}`,
        original: result.original,
        corrected: result.corrected,
        corrections: result.corrections,
        date: new Date().toISOString(),
      });
      grammarProgress.checkerMistakes = grammarProgress.checkerMistakes.slice(0, 50);
      saveGrammarProgress();
    }
  } else if (result.confident) {
    grammarResult.append(createElement("p", "grammar-positive", copy.noErrors));
    const sentenceCard = createElement("article", "grammar-sentence-card");
    sentenceCard.append(createElement("h3", "", copy.original));
    sentenceCard.append(createElement("p", "grammar-sentence-text", result.original));
    grammarResult.append(sentenceCard);
  } else {
    grammarResult.append(createElement("p", "grammar-uncertain", copy.uncertain));
  }
  grammarResult.hidden = false;
  grammarStatus.textContent = copy.localNote;
  renderGrammarProgress();
}

grammarExplainButton.addEventListener("click", () => explainGrammar(grammarSourceText.value));
explainGrammarButton.addEventListener("click", () => {
  grammarSourceText.value = currentTranslation;
  showView("grammar-view");
  showGrammarPanel("grammar-checker-panel");
  explainGrammar(currentTranslation);
});

const grammarPanels = [...document.querySelectorAll(".grammar-subpanel")];
const grammarTabs = [...document.querySelectorAll(".grammar-tab")];
function showGrammarPanel(panelId) {
  grammarPanels.forEach((panel) => { panel.hidden = panel.id !== panelId; });
  grammarTabs.forEach((tab) => {
    const active = tab.dataset.grammarPanel === panelId;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
}
grammarTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => showGrammarPanel(tab.dataset.grammarPanel));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const next = grammarTabs[(index + offset + grammarTabs.length) % grammarTabs.length];
    showGrammarPanel(next.dataset.grammarPanel);
    next.focus();
  });
});

const grammarLessonsElement = document.querySelector("#grammar-lessons");
const grammarLanguageSelect = document.querySelector("#grammar-language");
try {
  const savedLanguage = localStorage.getItem(GRAMMAR_LANGUAGE_KEY);
  if (savedLanguage === "en" || savedLanguage === "zh-TW") {
    grammarLanguageSelect.value = savedLanguage;
  }
} catch {
  // Keep the default English explanations when browser storage is unavailable.
}

function renderGrammarLessons() {
  const language = getGrammarLanguage();
  grammarLessonsElement.replaceChildren();
  grammarLessons.forEach((lesson) => {
    const card = createElement("details", "grammar-lesson-card");
    const summary = createElement("summary", "grammar-lesson-summary");
    const completed = grammarProgress.completedLessons.includes(lesson.id);
    summary.append(
      createElement("span", "lesson-number", String(grammarLessons.indexOf(lesson) + 1).padStart(2, "0")),
      createElement("span", "lesson-name", lesson.topic),
      createElement("span", completed ? "lesson-done-stamp" : "lesson-open-stamp", completed ? "✓ Done" : "♡ Learn"),
    );
    card.append(summary);
    const content = createElement("div", "grammar-lesson-content");
    content.append(createElement("p", "grammar-lesson-explanation", language === "zh-TW" ? lesson.zh : lesson.explanation));
    lesson.examples.forEach(([example, translation]) => {
      const exampleCard = createElement("p", "grammar-lesson-example");
      exampleCard.append(createElement("b", "", example), createElement("span", "", translation));
      content.append(exampleCard);
    });
    const mistake = createElement("div", "grammar-lesson-mistake");
    mistake.append(
      createElement("span", "grammar-topic-stamp", language === "zh-TW" ? "常見錯誤" : "COMMON MISTAKE"),
      createElement("p", "mistake-pair", `${lesson.mistake[0]} → ${lesson.mistake[1]}`),
      createElement("p", "grammar-explanation", language === "zh-TW" ? lesson.mistake[3] : lesson.mistake[2]),
    );
    content.append(mistake);
    const practice = createElement("div", "lesson-practice");
    practice.append(createElement("h4", "", language === "zh-TW" ? "試試看" : "Try it"));
    const question = createElement("p", "lesson-question", lesson.question);
    const options = createElement("div", "lesson-options");
    const feedback = createElement("p", "lesson-feedback");
    feedback.hidden = true;
    lesson.options.forEach((option, optionIndex) => {
      const button = createElement("button", "lesson-option", option);
      button.type = "button";
      button.addEventListener("click", () => {
        const isCorrect = optionIndex === lesson.answer;
        options.querySelectorAll("button").forEach((choice) => {
          choice.disabled = true;
          if (choice.textContent === lesson.options[lesson.answer]) {
            choice.classList.add("is-answer");
          }
        });
        feedback.hidden = false;
        feedback.className = `lesson-feedback ${isCorrect ? "is-correct" : "is-wrong"}`;
        feedback.textContent = isCorrect
          ? (language === "zh-TW" ? "答對了！你可以繼續完成本課。 ✨" : "That’s right! You can mark this lesson complete below. ✨")
          : (language === "zh-TW" ? `再想一想喔。正確答案是「${lesson.options[lesson.answer]}」。` : `Not quite. The answer is “${lesson.options[lesson.answer]}.”`);
      });
      options.append(button);
    });
    const completeButton = createElement(
      "button",
      `small-pastel-button lesson-complete-button${completed ? " is-completed" : ""}`,
      completed
        ? (language === "zh-TW" ? "已完成 ✓" : "Lesson completed ✓")
        : (language === "zh-TW" ? "標記為已完成" : "Mark lesson complete"),
    );
    completeButton.type = "button";
    completeButton.disabled = completed;
    completeButton.addEventListener("click", () => {
      if (grammarProgress.completedLessons.includes(lesson.id)) {
        return;
      }
      grammarProgress.completedLessons.push(lesson.id);
      grammarProgress.completedLessons = [...new Set(grammarProgress.completedLessons)];
      grammarProgress.dailyActivity.push({ date: new Date().toISOString().slice(0, 10), type: "lesson", topic: lesson.topic });
      if (saveGrammarProgress()) {
        renderGrammarLessons();
        renderGrammarProgress();
      } else {
        grammarProgress.completedLessons = grammarProgress.completedLessons.filter((id) => id !== lesson.id);
      }
    });
    practice.append(question, options, feedback, completeButton);
    content.append(practice);
    card.append(content);
    grammarLessonsElement.append(card);
  });
}

function renderGrammarProgress() {
  document.querySelector("#grammar-progress-lessons").textContent =
    `${grammarProgress.completedLessons.length} / ${grammarLessons.length}`;
  const attempts = grammarProgress.attempts;
  const correctCount = attempts.filter((attempt) => attempt.correct).length;
  document.querySelector("#grammar-progress-accuracy").textContent = attempts.length
    ? `${Math.round((correctCount / attempts.length) * 100)}%`
    : "—";
  const today = new Date().toISOString().slice(0, 10);
  const todayActivity = grammarProgress.dailyActivity.filter((item) => item.date === today);
  const todayQuizzes = todayActivity.filter((item) => item.type === "quiz").length;
  const todayLessons = todayActivity.filter((item) => item.type === "lesson").length;
  document.querySelector("#grammar-progress-today").textContent = getGrammarLanguage() === "zh-TW"
    ? `${todayLessons} 堂課 · ${todayQuizzes} 次測驗`
    : `${todayLessons} lessons · ${todayQuizzes} quizzes`;

  const weakTopics = document.querySelector("#grammar-weak-topics");
  weakTopics.replaceChildren();
  const misses = new Map();
  attempts.filter((attempt) => !attempt.correct).forEach((attempt) => {
    misses.set(attempt.topic, (misses.get(attempt.topic) || 0) + 1);
  });
  const topics = [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!topics.length) {
    weakTopics.append(createElement("p", "empty-note", getGrammarLanguage() === "zh-TW"
      ? "完成幾題測驗後，這裡會顯示可以加強的主題。"
      : "Finish a few quiz questions to see topics you may want to practice."));
  } else {
    topics.forEach(([topic, count]) => {
      weakTopics.append(createElement("span", "weak-topic-stamp", `${topic} · ${count} ${getGrammarLanguage() === "zh-TW" ? "次錯誤" : count === 1 ? "miss" : "misses"}`));
    });
  }

  const review = document.querySelector("#grammar-mistake-review");
  review.replaceChildren();
  const mistakes = [
    ...grammarProgress.checkerMistakes.map((item) => ({ ...item, source: "checker" })),
    ...grammarProgress.attempts.filter((attempt) => !attempt.correct).map((item) => ({ ...item, source: "quiz" })),
  ].sort((a, b) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()).slice(0, 8);
  if (!mistakes.length) {
    review.append(createElement("p", "empty-note", getGrammarLanguage() === "zh-TW"
      ? "目前沒有錯題。試試文法檢查器或小測驗吧！"
      : "No mistakes to review yet. Try the checker or a little quiz!"));
  } else {
    mistakes.forEach((mistake) => {
      const card = createElement("article", "grammar-review-card");
      if (mistake.source === "checker") {
        card.append(
          createElement("p", "mistake-pair", `${mistake.original} → ${mistake.corrected}`),
          createElement("span", "word-date", new Date(mistake.date).toLocaleDateString()),
        );
      } else {
        card.append(
          createElement("span", "grammar-topic-stamp", mistake.topic),
          createElement("p", "grammar-lesson-example", mistake.question),
          createElement("p", "mistake-pair", `${getGrammarLanguage() === "zh-TW" ? "你的答案" : "Your answer"}: ${mistake.chosen} · ${getGrammarLanguage() === "zh-TW" ? "正確答案" : "Correct"}: ${mistake.correctAnswer}`),
          createElement("p", "grammar-explanation", getGrammarLanguage() === "zh-TW" ? mistake.zh : mistake.en),
        );
      }
      review.append(card);
    });
  }
}

grammarLanguageSelect.addEventListener("change", () => {
  try {
    localStorage.setItem(GRAMMAR_LANGUAGE_KEY, grammarLanguageSelect.value);
  } catch {
    grammarStatus.textContent = grammarText("Language setting cannot be saved in this browser.", "此瀏覽器無法儲存語言設定。");
  }
  renderGrammarLessons();
  renderGrammarProgress();
  if (!grammarResult.hidden && grammarSourceText.value.trim()) {
    explainGrammar(grammarSourceText.value, false);
  }
});

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

const quizElement = document.querySelector("#grammar-quiz");
const quizLevelSelect = document.querySelector("#grammar-quiz-level");
const quizSizeSelect = document.querySelector("#grammar-quiz-size");
let activeGrammarQuiz;

function startGrammarQuiz(questionList) {
  const level = quizLevelSelect.value;
  const size = Number(quizSizeSelect.value);
  const pool = questionList || grammarQuizQuestions.filter((question) => question.level === level);
  const recent = new Set(grammarProgress.recentQuestions);
  const fresh = shuffle(pool.filter((question) => !recent.has(question.id)));
  const older = shuffle(pool.filter((question) => recent.has(question.id)));
  const selected = [...fresh, ...older].slice(0, Math.min(size, pool.length));
  activeGrammarQuiz = {
    questions: selected,
    index: 0,
    score: 0,
    missed: [],
    answered: false,
    level,
  };
  renderQuizQuestion();
}

function renderQuizQuestion() {
  if (!activeGrammarQuiz) {
    return;
  }
  const quiz = activeGrammarQuiz;
  if (quiz.index >= quiz.questions.length) {
    finishGrammarQuiz();
    return;
  }
  const question = quiz.questions[quiz.index];
  quiz.answered = false;
  quizElement.replaceChildren();
  const header = createElement("div", "quiz-question-header");
  header.append(
    createElement("span", "category-stamp", `${question.level.toUpperCase()} · ${question.topic}`),
    createElement("span", "word-date", `${quiz.index + 1} / ${quiz.questions.length}`),
  );
  quizElement.append(header, createElement("h3", "quiz-question", question.question));
  const options = createElement("div", "quiz-options");
  question.options.forEach((option, optionIndex) => {
    const button = createElement("button", "quiz-option", option);
    button.type = "button";
    button.addEventListener("click", () => answerGrammarQuestion(question, optionIndex, options));
    options.append(button);
  });
  quizElement.append(options);
}

function answerGrammarQuestion(question, selectedIndex, options) {
  const quiz = activeGrammarQuiz;
  if (!quiz || quiz.answered) {
    return;
  }
  quiz.answered = true;
  const correct = selectedIndex === question.answer;
  if (correct) {
    quiz.score += 1;
  } else {
    quiz.missed.push(question);
  }
  options.querySelectorAll("button").forEach((button, index) => {
    button.disabled = true;
    if (index === question.answer) {
      button.classList.add("is-answer");
    } else if (index === selectedIndex) {
      button.classList.add("is-wrong");
    }
  });
  const entry = {
    questionId: question.id,
    topic: question.topic,
    question: question.question,
    chosen: question.options[selectedIndex],
    correctAnswer: question.options[question.answer],
    correct,
    en: question.en,
    zh: question.zh,
    date: new Date().toISOString(),
  };
  grammarProgress.attempts.push(entry);
  grammarProgress.attempts = grammarProgress.attempts.slice(-300);
  grammarProgress.recentQuestions = [...grammarProgress.recentQuestions.filter((id) => id !== question.id), question.id].slice(-30);
  saveGrammarProgress();
  const feedback = createElement("div", `quiz-feedback ${correct ? "is-correct" : "is-wrong"}`);
  feedback.append(
    createElement("b", "", correct
      ? (getGrammarLanguage() === "zh-TW" ? "答對了！" : "Correct! ♡")
      : (getGrammarLanguage() === "zh-TW" ? "再試一次就會更熟悉！" : "Good try—keep learning!")),
    createElement("p", "", getGrammarLanguage() === "zh-TW" ? question.zh : question.en),
  );
  const next = createElement("button", "small-pastel-button quiz-next", quiz.index === quiz.questions.length - 1
    ? (getGrammarLanguage() === "zh-TW" ? "看測驗結果" : "See my score")
    : (getGrammarLanguage() === "zh-TW" ? "下一題 →" : "Next question →"));
  next.type = "button";
  next.addEventListener("click", () => {
    quiz.index += 1;
    renderQuizQuestion();
  });
  quizElement.append(feedback, next);
  renderGrammarProgress();
}

function finishGrammarQuiz() {
  const quiz = activeGrammarQuiz;
  if (!quiz) {
    return;
  }
  const result = {
    date: new Date().toISOString(),
    level: quiz.level,
    score: quiz.score,
    total: quiz.questions.length,
    missedIds: quiz.missed.map((question) => question.id),
  };
  grammarProgress.quizzes.push(result);
  grammarProgress.quizzes = grammarProgress.quizzes.slice(-100);
  grammarProgress.dailyActivity.push({ date: result.date.slice(0, 10), type: "quiz", score: result.score, total: result.total });
  grammarProgress.dailyActivity = grammarProgress.dailyActivity.slice(-300);
  saveGrammarProgress();
  quizElement.replaceChildren(
    createElement("div", "quiz-final-score", `${quiz.score} / ${quiz.questions.length}`),
    createElement("p", "quiz-finish-note", quiz.score === quiz.questions.length
      ? (getGrammarLanguage() === "zh-TW" ? "太棒了！全部答對！ ✨" : "Wonderful! You got every answer right! ✨")
      : (getGrammarLanguage() === "zh-TW" ? `完成測驗！正確率 ${Math.round((quiz.score / quiz.questions.length) * 100)}%。` : `Quiz complete! Your accuracy was ${Math.round((quiz.score / quiz.questions.length) * 100)}%.`)),
  );
  if (quiz.missed.length) {
    const retry = createElement("button", "small-pastel-button quiz-retry", getGrammarLanguage() === "zh-TW" ? `重做 ${quiz.missed.length} 題錯題` : `Retry ${quiz.missed.length} missed question${quiz.missed.length === 1 ? "" : "s"}`);
    retry.type = "button";
    retry.addEventListener("click", () => startGrammarQuiz(quiz.missed));
    quizElement.append(retry);
  }
  const restart = createElement("button", "small-pastel-button quiz-restart", getGrammarLanguage() === "zh-TW" ? "再做一份新測驗" : "Start another quiz");
  restart.type = "button";
  restart.addEventListener("click", () => startGrammarQuiz());
  quizElement.append(restart);
  renderGrammarProgress();
}

document.querySelector("#grammar-quiz-start").addEventListener("click", () => startGrammarQuiz());
renderGrammarLessons();
renderGrammarProgress();

const photoInput = document.querySelector("#photo-input");
const photoPreview = document.querySelector("#photo-preview");
const photoStatus = document.querySelector("#photo-status");
const photoLanguage = document.querySelector("#photo-language");
const photoTargetLanguage = document.querySelector("#photo-target-language");
const photoText = document.querySelector("#photo-text");
const extractPhotoButton = document.querySelector("#extract-photo-button");
const translatePhotoButton = document.querySelector("#translate-photo-button");
const photoTranslationStatus = document.querySelector("#photo-translation-status");
const photoTranslationResult = document.querySelector("#photo-translation-result");
const photoOriginalResult = document.querySelector("#photo-original-result");
const photoTranslatedResult = document.querySelector("#photo-translated-result");
const photoTranslateButtonLabel = translatePhotoButton.querySelector(".button-label");
const photoTranslationProgress = document.querySelector("#photo-translation-progress");
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PHOTO_TRANSLATION_PAUSE_MS = 750;
let selectedPhoto;
let tesseractScriptPromise;
let photoTranslationController;
let photoTranslationJob;

function loadTesseract() {
  if (window.Tesseract) {
    return Promise.resolve(window.Tesseract);
  }
  if (!tesseractScriptPromise) {
    tesseractScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      script.async = true;
      script.onload = () => window.Tesseract
        ? resolve(window.Tesseract)
        : reject(new Error("The OCR library loaded, but could not be started."));
      script.onerror = () => reject(new Error("Could not load OCR. Check your internet connection and try again."));
      document.head.append(script);
    }).catch((error) => {
      tesseractScriptPromise = undefined;
      throw error;
    });
  }
  return tesseractScriptPromise;
}

async function prepareChinesePhoto(file) {
  const image = await createImageBitmap(file);
  const scale = Math.min(2, 3000 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: false });
  if (!context) {
    image.close();
    throw new Error("Could not prepare this image for Chinese text recognition.");
  }
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.filter = "grayscale(1) contrast(1.18)";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  return canvas;
}

photoInput.addEventListener("change", () => {
  const file = photoInput.files?.[0];
  if (!file) {
    return;
  }
  photoTranslationController?.abort();
  photoTranslationController = undefined;
  photoTranslationJob = undefined;
  translatePhotoButton.classList.remove("is-loading");
  photoTranslateButtonLabel.textContent = "Translate this text";
  if (photoObjectUrl) {
    URL.revokeObjectURL(photoObjectUrl);
    photoObjectUrl = undefined;
  }
  photoPreview.removeAttribute("src");
  photoPreview.hidden = true;
  photoText.value = "";
  photoTranslationResult.hidden = true;
  photoTranslationStatus.textContent = "";
  photoTranslationStatus.classList.remove("is-error");
  photoTranslationProgress.hidden = true;
  translatePhotoButton.disabled = true;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    photoInput.value = "";
    selectedPhoto = undefined;
    extractPhotoButton.disabled = true;
    photoStatus.textContent = "Please choose a JPG, PNG, or WebP image.";
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    photoInput.value = "";
    selectedPhoto = undefined;
    extractPhotoButton.disabled = true;
    photoStatus.textContent = "This image is larger than 5 MB. Choose a smaller image and try again.";
    return;
  }
  selectedPhoto = file;
  photoObjectUrl = URL.createObjectURL(file);
  photoPreview.src = photoObjectUrl;
  photoPreview.hidden = false;
  extractPhotoButton.disabled = false;
  photoStatus.textContent = "Image ready. OCR runs in your browser; language data may need to download.";
  photoText.value = "";
  photoTranslationResult.hidden = true;
  photoTranslationStatus.textContent = "";
  translatePhotoButton.disabled = true;
});

extractPhotoButton.addEventListener("click", async () => {
  if (!selectedPhoto) {
    return;
  }
  extractPhotoButton.disabled = true;
  photoStatus.textContent = "Preparing the local text reader… The first language download may take a little while.";
  let worker;
  try {
    const tesseract = await loadTesseract();
    const workerOptions = {
      logger: (message) => {
        if (message.status === "recognizing text") {
          photoStatus.textContent = "Reading the text in your picture…";
        } else if (message.status === "loading language traineddata") {
          photoStatus.textContent = "Downloading language data for this browser…";
        }
      },
    };
    if (photoLanguage.value.startsWith("chi_")) {
      workerOptions.langPath = "https://tessdata.projectnaptha.com/4.0.0_best";
    }
    worker = await tesseract.createWorker(photoLanguage.value, 1, workerOptions);
    const imageForOcr = photoLanguage.value.startsWith("chi_")
      ? await prepareChinesePhoto(selectedPhoto)
      : selectedPhoto;
    const result = await worker.recognize(imageForOcr);
    photoText.value = result.data.text.trim();
    photoText.dispatchEvent(new Event("input", { bubbles: true }));
    photoStatus.textContent = photoText.value
      ? "Text found! Review or edit it below. Your image was processed in this browser."
      : "No readable text was found. Try a clearer, brighter image.";
    translatePhotoButton.disabled = !photoText.value.trim();
  } catch (error) {
    photoStatus.textContent = error instanceof Error
      ? error.message
      : "Text recognition failed. Try another image or language.";
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        photoStatus.textContent = "OCR finished, but its worker could not shut down cleanly. You can still review the extracted text.";
      }
    }
    extractPhotoButton.disabled = !selectedPhoto;
  }
});

photoText.addEventListener("input", () => {
  translatePhotoButton.disabled = !photoText.value.trim();
  photoTranslateButtonLabel.textContent = "Translate this text";
  translatePhotoButton.classList.remove("is-loading");
  photoTranslationStatus.classList.remove("is-error");
  photoTranslationJob = undefined;
  photoTranslationProgress.hidden = true;
  if (photoTranslationController) {
    photoTranslationController.abort();
    photoTranslationController = undefined;
    translatePhotoButton.classList.remove("is-loading");
    photoTranslateButtonLabel.textContent = "Translate this text";
    translatePhotoButton.disabled = !photoText.value.trim();
    photoTranslationStatus.textContent = "Text changed. Translate again to update the result.";
  } else if (!photoTranslationResult.hidden) {
    photoTranslationStatus.textContent = "Text changed. Translate again to update the result.";
  }
  photoTranslationResult.hidden = true;
});
photoTargetLanguage.addEventListener("change", () => {
  photoTranslateButtonLabel.textContent = "Translate this text";
  translatePhotoButton.classList.remove("is-loading");
  photoTranslationStatus.classList.remove("is-error");
  photoTranslationJob = undefined;
  photoTranslationProgress.hidden = true;
  if (photoTranslationController) {
    photoTranslationController.abort();
    photoTranslationController = undefined;
    translatePhotoButton.disabled = !photoText.value.trim();
    translatePhotoButton.classList.remove("is-loading");
    photoTranslateButtonLabel.textContent = "Translate this text";
    photoTranslationStatus.textContent = "Target language changed. Translate again to update the result.";
  } else if (!photoTranslationResult.hidden) {
    photoTranslationStatus.textContent = "Target language changed. Translate again to update the result.";
  }
  photoTranslationResult.hidden = true;
});

function splitPhotoTextForTranslation(text) {
  const parts = [];
  let remaining = text;

  while (remaining) {
    if (getInputByteLength(remaining) <= MAX_INPUT_BYTES) {
      parts.push({ type: "text", text: remaining });
      break;
    }

    let byteCount = 0;
    let fitEnd = 0;
    let whitespaceBreak;
    let punctuationBreak;
    let newlineBreak;
    let previousCharacterWasNewline = false;
    let index = 0;

    for (const character of remaining) {
      const characterBytes = getInputByteLength(character);
      if (byteCount + characterBytes > MAX_INPUT_BYTES) {
        break;
      }
      byteCount += characterBytes;
      index += character.length;
      fitEnd = index;
      if (character === "\r" || character === "\n") {
        if (!previousCharacterWasNewline) {
          newlineBreak = index - character.length;
        }
        previousCharacterWasNewline = true;
      } else if (/\s/u.test(character)) {
        previousCharacterWasNewline = false;
        whitespaceBreak = index - character.length;
      } else if (/[.!?。！？；;]/u.test(character)) {
        previousCharacterWasNewline = false;
        punctuationBreak = index;
      } else {
        previousCharacterWasNewline = false;
      }
    }

    let cut = newlineBreak || (whitespaceBreak > 0 ? whitespaceBreak : punctuationBreak);
    if (!cut || cut > fitEnd) {
      cut = fitEnd;
    }
    if (!cut) {
      throw new Error("Could not split this text safely for translation.");
    }

    const chunk = remaining.slice(0, cut);
    if (getInputByteLength(chunk) > MAX_INPUT_BYTES) {
      throw new Error("Could not split this text within the translation service limit.");
    }
    parts.push({ type: "text", text: chunk });
    remaining = remaining.slice(cut);

    if (newlineBreak === cut) {
      const lineBreak = remaining.match(/^(?:\r\n|[\r\n])+/u)?.[0] || "";
      parts.push({ type: "separator", text: lineBreak });
      remaining = remaining.slice(lineBreak.length);
      continue;
    }
    if (whitespaceBreak === cut) {
      const whitespace = remaining.match(/^\s+/u)?.[0] || "";
      parts.push({ type: "separator", text: whitespace || " " });
      remaining = remaining.slice(whitespace.length);
    } else {
      parts.push({ type: "separator", text: " " });
    }
  }

  return parts;
}

function renderPhotoTranslationJob(job) {
  let chunkIndex = 0;
  photoTranslatedResult.textContent = job.parts.map((part) => {
    if (part.type === "separator") {
      return part.text;
    }
    const translation = job.translations[chunkIndex];
    chunkIndex += 1;
    return translation ?? `[Chunk ${chunkIndex} not translated]`;
  }).join("");
  photoTranslationResult.hidden = false;
}

function abortablePhotoDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Translation cancelled.", "AbortError"));
      return;
    }
    const timeout = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Translation cancelled.", "AbortError"));
    }, { once: true });
  });
}

async function translatePhotoJob(job, signal) {
  const total = job.translations.length;
  photoTranslationProgress.hidden = false;
  photoTranslationProgress.max = total;
  photoTranslationProgress.value = job.translations.filter((translation) => translation !== null).length;
  for (let index = 0; index < total; index += 1) {
    if (job.translations[index] !== null) {
      continue;
    }
    if (signal.aborted) {
      throw new DOMException("Translation cancelled.", "AbortError");
    }
    if (job.lastRequestAt) {
      const wait = PHOTO_TRANSLATION_PAUSE_MS - (Date.now() - job.lastRequestAt);
      if (wait > 0) {
        await abortablePhotoDelay(wait, signal);
      }
    }
    photoTranslationStatus.textContent =
      `Translating chunk ${index + 1} of ${total} in order. The translation service’s free-use limits still apply.`;
    photoTranslationProgress.value = index;
    const requestController = new AbortController();
    const abortRequest = () => requestController.abort();
    signal.addEventListener("abort", abortRequest, { once: true });
    const timeoutId = window.setTimeout(() => requestController.abort(), 30000);
    try {
      job.lastRequestAt = Date.now();
      const result = await translateText(job.chunks[index], requestController.signal, job.targetLanguage);
      job.translations[index] = result.translation;
      job.detectedLanguage = result.detectedLanguage;
      photoTranslationProgress.value = index + 1;
      renderPhotoTranslationJob(job);
    } catch (error) {
      job.failedIndex = index;
      renderPhotoTranslationJob(job);
      if (requestController.signal.aborted && !signal.aborted) {
        throw new Error(`The request for chunk ${index + 1} timed out. Please retry.`);
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
      signal.removeEventListener("abort", abortRequest);
    }
  }
  job.failedIndex = undefined;
}

translatePhotoButton.addEventListener("click", async () => {
  const text = photoText.value.trim();
  if (!text) {
    return;
  }
  if (
    !photoTranslationJob
    || photoTranslationJob.sourceText !== text
    || photoTranslationJob.targetLanguage !== photoTargetLanguage.value
  ) {
    try {
      const parts = splitPhotoTextForTranslation(text);
      const chunks = parts.filter((part) => part.type === "text").map((part) => part.text);
      if (!chunks.length) {
        photoTranslationStatus.textContent = "No translatable text was found.";
        photoTranslationStatus.classList.add("is-error");
        return;
      }
      photoTranslationJob = {
        sourceText: text,
        targetLanguage: photoTargetLanguage.value,
        parts,
        chunks,
        translations: Array(chunks.length).fill(null),
        lastRequestAt: 0,
      };
    } catch (error) {
      photoTranslationStatus.textContent = error instanceof Error
        ? error.message
        : "Could not split the text safely for translation.";
      photoTranslationStatus.classList.add("is-error");
      return;
    }
  }
  const job = photoTranslationJob;
  photoOriginalResult.textContent = text;
  photoTranslationController?.abort();
  const controller = new AbortController();
  photoTranslationController = controller;
  translatePhotoButton.disabled = true;
  translatePhotoButton.classList.add("is-loading");
  photoTranslateButtonLabel.textContent = job.failedIndex === undefined
    ? "Translating…"
    : `Retry chunk ${job.failedIndex + 1}`;
  photoTranslationStatus.textContent =
    `Preparing ${job.chunks.length} UTF-8-safe chunk${job.chunks.length === 1 ? "" : "s"} for sequential translation…`;
  photoTranslationStatus.classList.remove("is-error");
  photoTranslationResult.hidden = !job.translations.some((translation) => translation !== null);

  try {
    await translatePhotoJob(job, controller.signal);
    if (photoTranslationController !== controller) {
      return;
    }
    photoOriginalResult.textContent = text;
    renderPhotoTranslationJob(job);
    photoTranslationResult.classList.remove("is-entering");
    void photoTranslationResult.offsetWidth;
    photoTranslationResult.classList.add("is-entering");
    photoTranslationStatus.textContent =
      `All ${job.chunks.length} chunk${job.chunks.length === 1 ? "" : "s"} translated · ${job.detectedLanguage || "language detected automatically"}`;
  } catch (error) {
    if (photoTranslationController !== controller) {
      return;
    }
    if (error.name === "AbortError") {
      photoTranslationStatus.textContent = "Translation was cancelled. Completed chunks are kept; press Retry failed chunk to continue.";
    } else {
      photoTranslationStatus.textContent =
        `Chunk ${(job.failedIndex ?? 0) + 1} of ${job.chunks.length} failed: ${error instanceof Error ? error.message : "Translation failed."} Completed chunks are kept. Retry to continue without resending them.`;
    }
    photoTranslateButtonLabel.textContent = "Retry failed chunk";
    photoTranslationStatus.classList.add("is-error");
  } finally {
    if (photoTranslationController === controller) {
      photoTranslationController = undefined;
      translatePhotoButton.disabled = !photoText.value.trim();
      translatePhotoButton.classList.remove("is-loading");
      if (job.failedIndex === undefined) {
        photoTranslateButtonLabel.textContent = "Translate this text";
      }
    }
  }
});
