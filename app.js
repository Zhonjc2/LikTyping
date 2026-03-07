let samples = [];

const TEST_SECONDS = 60;

const targetTextEl = document.getElementById("targetText");
const textStreamEl = document.getElementById("textStream");
const historyFeedEl = document.getElementById("historyFeed");
const historyHintEl = document.getElementById("historyHint");
const typingInputEl = document.getElementById("typingInput");
const timeLeftEl = document.getElementById("timeLeft");
const wpmEl = document.getElementById("wpm");
const cpmEl = document.getElementById("cpm");
const accuracyEl = document.getElementById("accuracy");
const restartBtnEl = document.getElementById("restartBtn");

let targetText = "";
let sourceText = "";
let hanziUnits = [];
let pinyinUnits = [];
let timerId = null;
let startedAt = null;
let elapsedBeforePause = 0;
let timeLeft = TEST_SECONDS;
let committedTyped = 0;
let committedCorrect = 0;
let currentTyped = 0;
let currentCorrect = 0;
let awaitingNextSpace = false;
let hasArchivedCurrent = false;
let completedParagraphCount = 0;

function renderStatusText(message) {
  targetTextEl.innerHTML = "";
  const statusLine = document.createElement("p");
  statusLine.className = "source-text";
  statusLine.textContent = message;
  targetTextEl.appendChild(statusLine);
}

async function loadSamples() {
  const response = await fetch("./texts.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`加载题库失败：HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("加载题库失败：texts.json 为空或格式错误");
  }

  samples = data;
}

function normalizePinyin(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeInputPinyin(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/ {2,}/g, " ");
}

function parseSample(sample) {
  const parsedHanziUnits = Array.isArray(sample.words) ? sample.words.filter(Boolean) : [];
  const parsedPinyinUnits = Array.isArray(sample.pinyinWords)
    ? sample.pinyinWords.map((word) => normalizePinyin(word).replace(/\s+/g, ""))
    : [];
  const unitCount = Math.min(parsedHanziUnits.length, parsedPinyinUnits.length);

  return {
    sourceText: sample.hanzi,
    hanziUnits: parsedHanziUnits.slice(0, unitCount),
    pinyinUnits: parsedPinyinUnits.slice(0, unitCount)
  };
}

function countCorrectChars(input, expected) {
  let correct = 0;
  const compareLength = Math.min(input.length, expected.length);
  for (let index = 0; index < compareLength; index += 1) {
    if (input[index] === expected[index]) {
      correct += 1;
    }
  }
  return correct;
}

function pickText() {
  if (samples.length === 0) {
    throw new Error("题库未加载");
  }
  const idx = Math.floor(Math.random() * samples.length);
  return samples[idx];
}

function getElapsedSeconds() {
  const runningMs = startedAt == null ? 0 : Date.now() - startedAt;
  return Math.floor((elapsedBeforePause + runningMs) / 1000);
}

function refreshTimeLeft() {
  const elapsed = getElapsedSeconds();
  timeLeft = Math.max(0, TEST_SECONDS - elapsed);
  timeLeftEl.textContent = `${timeLeft}s`;
}

function renderTarget() {
  targetTextEl.innerHTML = "";
  const orderLine = document.createElement("p");
  orderLine.className = "source-order";
  orderLine.textContent = `第 ${completedParagraphCount + 1} 段`;
  targetTextEl.appendChild(orderLine);

  const sourceLine = document.createElement("p");
  sourceLine.className = "source-text";
  sourceLine.textContent = `原文：${sourceText}`;
  targetTextEl.appendChild(sourceLine);

  const pairGrid = document.createElement("div");
  pairGrid.className = "pair-grid";

  hanziUnits.forEach((hanzi, index) => {
    const unit = document.createElement("span");
    unit.className = "pair-unit";
    unit.dataset.unitIndex = String(index);
    if (index === 0) {
      unit.classList.add("current");
    }

    const hanziSpan = document.createElement("span");
    hanziSpan.className = "hanzi-char";
    hanziSpan.textContent = hanzi;

    const pinyinSpan = document.createElement("span");
    pinyinSpan.className = "pinyin-char";
    [...pinyinUnits[index]].forEach((letter, letterIndex) => {
      const letterSpan = document.createElement("span");
      letterSpan.className = "pinyin-letter";
      letterSpan.dataset.letterIndex = String(letterIndex);
      letterSpan.textContent = letter;
      pinyinSpan.appendChild(letterSpan);
    });

    unit.appendChild(hanziSpan);
    unit.appendChild(pinyinSpan);
    pairGrid.appendChild(unit);
  });

  targetTextEl.appendChild(pairGrid);
  targetTextEl.classList.remove("enter");
  void targetTextEl.offsetWidth;
  targetTextEl.classList.add("enter");
}

function startTimer() {
  if (timerId || timeLeft <= 0) {
    return;
  }
  if (startedAt == null) {
    startedAt = Date.now();
  }

  timerId = setInterval(() => {
    refreshTimeLeft();

    if (timeLeft === 0) {
      finishTest();
    }
  }, 250);
}

function pauseTimer() {
  if (startedAt != null) {
    elapsedBeforePause += Date.now() - startedAt;
    startedAt = null;
  }
  clearInterval(timerId);
  timerId = null;
}

function canResumeTimer() {
  return timeLeft > 0 && !typingInputEl.disabled && (elapsedBeforePause > 0 || startedAt != null);
}

function resumeTimer() {
  if (!canResumeTimer()) {
    return;
  }
  startTimer();
}

function calculateStats() {
  const elapsedSeconds = Math.max(1, TEST_SECONDS - timeLeft);
  const elapsedMinutes = elapsedSeconds / 60;
  const totalTyped = committedTyped + currentTyped;
  const totalCorrect = committedCorrect + currentCorrect;

  const cpm = Math.round(totalCorrect / elapsedMinutes);
  const wpm = Math.round(totalCorrect / 5 / elapsedMinutes);
  const accuracy = totalTyped === 0 ? 100 : Math.round((totalCorrect / totalTyped) * 100);

  cpmEl.textContent = Number.isFinite(cpm) ? cpm : 0;
  wpmEl.textContent = Number.isFinite(wpm) ? wpm : 0;
  accuracyEl.textContent = `${Math.max(0, Math.min(100, accuracy))}%`;
}

function updateTargetHighlight(input) {
  const units = targetTextEl.querySelectorAll(".pair-unit");
  const typedTokens = input.trim() ? input.trim().split(" ") : [];
  const hasTrailingSpace = input.endsWith(" ");
  const currentUnitIndex =
    typedTokens.length === 0 ? 0 : hasTrailingSpace ? typedTokens.length : typedTokens.length - 1;

  currentTyped = input.length;
  currentCorrect = countCorrectChars(input, targetText);

  units.forEach((unitEl, index) => {
    unitEl.classList.remove("correct", "wrong", "current");
    const letterEls = unitEl.querySelectorAll(".pinyin-letter");
    letterEls.forEach((letterEl) => {
      letterEl.classList.remove("correct", "wrong", "current");
    });

    const typedToken = typedTokens[index];
    if (typedToken == null) {
      if (index === currentUnitIndex) {
        unitEl.classList.add("current");
        const firstLetter = letterEls[0];
        if (firstLetter) {
          firstLetter.classList.add("current");
        }
      }
      return;
    }

    const expectedToken = pinyinUnits[index];
    const compareLength = Math.min(typedToken.length, expectedToken.length);
    for (let letterIndex = 0; letterIndex < compareLength; letterIndex += 1) {
      if (typedToken[letterIndex] === expectedToken[letterIndex]) {
        letterEls[letterIndex]?.classList.add("correct");
      } else {
        letterEls[letterIndex]?.classList.add("wrong");
      }
    }

    if (typedToken.length > expectedToken.length) {
      unitEl.classList.add("wrong");
    } else if (typedToken === expectedToken) {
      unitEl.classList.add("correct");
    }

    if (index === currentUnitIndex && !hasTrailingSpace) {
      unitEl.classList.add("current");
      const currentLetterIndex = Math.min(typedToken.length, expectedToken.length - 1);
      const currentLetter = letterEls[currentLetterIndex];
      if (currentLetter && !currentLetter.classList.contains("wrong")) {
        currentLetter.classList.add("current");
      }
    }
  });
}

function loadNextSample() {
  const parsedSample = parseSample(pickText());
  sourceText = parsedSample.sourceText;
  hanziUnits = parsedSample.hanziUnits;
  pinyinUnits = parsedSample.pinyinUnits;
  targetText = pinyinUnits.join(" ");
  typingInputEl.value = "";
  typingInputEl.maxLength = targetText.length;
  typingInputEl.setAttribute("maxlength", String(targetText.length));
  typingInputEl.readOnly = false;
  awaitingNextSpace = false;
  hasArchivedCurrent = false;
  currentTyped = 0;
  currentCorrect = 0;
  renderTarget();
  requestAnimationFrame(() => {
    textStreamEl.scrollTop = textStreamEl.scrollHeight;
  });
}

function archiveCurrentResult() {
  if (hasArchivedCurrent) {
    return;
  }

  completedParagraphCount += 1;
  const item = document.createElement("article");
  item.className = "history-item";

  const snapshot = targetTextEl.cloneNode(true);
  snapshot.classList.remove("enter");
  snapshot.querySelectorAll(".current").forEach((el) => el.classList.remove("current"));
  item.appendChild(snapshot);

  historyFeedEl.appendChild(item);
  requestAnimationFrame(() => {
    item.classList.add("show");
  });
  textStreamEl.scrollTop = textStreamEl.scrollHeight;
  historyHintEl.hidden = false;
  hasArchivedCurrent = true;
}

function finishTest() {
  pauseTimer();
  typingInputEl.disabled = true;
  timeLeftEl.textContent = "0s";
  calculateStats();
}

function resetTest() {
  if (samples.length === 0) {
    return;
  }
  pauseTimer();

  loadNextSample();
  historyFeedEl.innerHTML = "";
  historyHintEl.hidden = true;
  textStreamEl.scrollTop = 0;
  timeLeft = TEST_SECONDS;
  elapsedBeforePause = 0;
  committedTyped = 0;
  committedCorrect = 0;
  currentTyped = 0;
  currentCorrect = 0;
  awaitingNextSpace = false;
  hasArchivedCurrent = false;
  completedParagraphCount = 0;
  startedAt = null;

  typingInputEl.disabled = false;
  typingInputEl.readOnly = false;

  timeLeftEl.textContent = `${TEST_SECONDS}s`;
  wpmEl.textContent = "0";
  cpmEl.textContent = "0";
  accuracyEl.textContent = "100%";

  typingInputEl.focus();
}

typingInputEl.addEventListener("input", (event) => {
  if (awaitingNextSpace) {
    event.target.value = targetText;
    return;
  }

  let normalizedInput = normalizeInputPinyin(event.target.value);
  if (normalizedInput.length > targetText.length) {
    normalizedInput = normalizedInput.slice(0, targetText.length);
  }
  if (event.target.value !== normalizedInput) {
    event.target.value = normalizedInput;
  }

  if (!timerId && !startedAt) {
    startTimer();
  }

  if (timeLeft <= 0) {
    return;
  }

  const input = normalizedInput;
  updateTargetHighlight(input);
  calculateStats();

  if (input.length >= targetText.length) {
    awaitingNextSpace = true;
    typingInputEl.readOnly = true;

    if (timeLeft <= 0) {
      finishTest();
      return;
    }
  }
});

typingInputEl.addEventListener("keydown", (event) => {
  if (!awaitingNextSpace) {
    return;
  }

  if (event.key === " ") {
    event.preventDefault();
    if (timeLeft <= 0) {
      finishTest();
      return;
    }
    archiveCurrentResult();
    committedTyped += currentTyped;
    committedCorrect += currentCorrect;
    loadNextSample();
    calculateStats();
    return;
  }

  if (event.key.length === 1) {
    event.preventDefault();
  }
});

restartBtnEl.addEventListener("click", resetTest);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pauseTimer();
    return;
  }
  resumeTimer();
});

window.addEventListener("focus", () => {
  resumeTimer();
});

async function initializeApp() {
  typingInputEl.disabled = true;
  restartBtnEl.disabled = true;
  renderStatusText("正在加载题库...");

  try {
    await loadSamples();
    typingInputEl.disabled = false;
    restartBtnEl.disabled = false;
    resetTest();
  } catch (error) {
    renderStatusText(error instanceof Error ? error.message : "加载题库失败");
    typingInputEl.disabled = true;
    restartBtnEl.disabled = true;
  }
}

initializeApp();
