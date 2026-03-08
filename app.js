let samples = [];
const IDLE_PAUSE_MS = 8000;

const targetTextEl = document.getElementById("targetText");
const textStreamEl = document.getElementById("textStream");
const historyFeedEl = document.getElementById("historyFeed");
const historyHintEl = document.getElementById("historyHint");
const typingInputEl = document.getElementById("typingInput");
const timeLeftEl = document.getElementById("timeLeft");
const wpmEl = document.getElementById("wpm");
const cpmEl = document.getElementById("cpm");
const accuracyEl = document.getElementById("accuracy");
const keystrokesEl = document.getElementById("keystrokes");
const streakBoardEl = document.getElementById("streakBoard");
const streakCountEl = document.getElementById("streakCount");
const streakRankEl = document.getElementById("streakRank");
const restartBtnEl = document.getElementById("restartBtn");

let targetText = "";
let sourceText = "";
let hanziUnits = [];
let pinyinUnits = [];
let timerId = null;
let startedAt = null;
let elapsedBeforePause = 0;
let committedTyped = 0;
let committedCorrect = 0;
let currentTyped = 0;
let currentCorrect = 0;
let hasArchivedCurrent = false;
let completedParagraphCount = 0;
let lastActivityAt = null;
let isIdlePaused = false;
let totalKeystrokes = 0;
let currentStreak = 0;
let lastInputValueForStreak = "";
let currentRankScore = 0;

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

function countPinyinLetterStats(input, expectedTokens) {
  const typedTokens = input.trim() ? input.trim().split(" ") : [];
  let typedLetters = 0;
  let correctLetters = 0;

  typedTokens.forEach((typedToken, tokenIndex) => {
    const expectedToken = expectedTokens[tokenIndex] ?? "";
    typedLetters += typedToken.length;
    const compareLength = Math.min(typedToken.length, expectedToken.length);
    for (let letterIndex = 0; letterIndex < compareLength; letterIndex += 1) {
      if (typedToken[letterIndex] === expectedToken[letterIndex]) {
        correctLetters += 1;
      }
    }
  });

  return {
    typedLetterCount: typedLetters,
    correctLetterCount: correctLetters
  };
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

function refreshElapsedTime() {
  const elapsed = getElapsedSeconds();
  timeLeftEl.textContent = `${elapsed}s`;
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
}

function startTimer() {
  if (timerId) {
    return;
  }
  if (startedAt == null) {
    startedAt = Date.now();
  }
  if (lastActivityAt == null) {
    lastActivityAt = Date.now();
  }

  timerId = setInterval(() => {
    if (lastActivityAt != null && Date.now() - lastActivityAt >= IDLE_PAUSE_MS) {
      isIdlePaused = true;
      pauseTimer();
      return;
    }
    refreshElapsedTime();
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
  return !isIdlePaused && !typingInputEl.disabled && (elapsedBeforePause > 0 || startedAt != null);
}

function resumeTimer() {
  if (!canResumeTimer()) {
    return;
  }
  startTimer();
}

function calculateStats() {
  const elapsedSeconds = Math.max(1, getElapsedSeconds());
  const elapsedMinutes = elapsedSeconds / 60;
  const totalTyped = committedTyped + currentTyped;
  const totalCorrect = committedCorrect + currentCorrect;

  const cpm = Math.round(totalCorrect / elapsedMinutes);
  const wpm = Math.round(totalCorrect / 5 / elapsedMinutes);
  const accuracy = totalTyped === 0 ? 0 : Math.round((totalCorrect / totalTyped) * 100);

  cpmEl.textContent = Number.isFinite(cpm) ? cpm : 0;
  wpmEl.textContent = Number.isFinite(wpm) ? wpm : 0;
  accuracyEl.textContent = `${Math.max(0, Math.min(100, accuracy))}%`;
}

function recordKeyboardActivity() {
  lastActivityAt = Date.now();
  if (isIdlePaused && !typingInputEl.disabled) {
    isIdlePaused = false;
    startTimer();
  }
}

function isCountedKeystroke(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return false;
  }
  return event.key.length === 1 || event.key === "Backspace" || event.key === "Delete" || event.key === "Enter";
}

function getStreakRank(streak) {
  if (streak >= 1000) return "SSS";
  if (streak >= 500) return "SS";
  if (streak >= 100) return "S";
  if (streak >= 50) return "A";
  if (streak >= 10) return "B";
  if (streak >= 1) return "C";
  return "X";
}

function getRankScore(rank) {
  if (rank === "C") return 1;
  if (rank === "B") return 2;
  if (rank === "A") return 3;
  if (rank === "S") return 4;
  if (rank === "SS") return 5;
  if (rank === "SSS") return 6;
  return 0;
}

function updateStreakDisplay() {
  const rank = getStreakRank(currentStreak);
  const nextRankScore = getRankScore(rank);
  const streakText = String(currentStreak);
  streakCountEl.textContent = streakText;
  streakBoardEl.dataset.digits = String(streakText.length);
  streakRankEl.textContent = rank;
  streakBoardEl.classList.remove("rank-x", "rank-c", "rank-b", "rank-a", "rank-s", "rank-ss", "rank-sss");
  streakBoardEl.classList.add(`rank-${rank.toLowerCase()}`);
  if (nextRankScore > currentRankScore) {
    streakBoardEl.classList.remove("rank-up-pop");
    // force reflow so animation can replay on each rank-up
    void streakBoardEl.offsetWidth;
    streakBoardEl.classList.add("rank-up-pop");
  }
  currentRankScore = nextRankScore;
}

function getExpectedNextChar(input) {
  const hasTrailingSpace = input.endsWith(" ");
  const typedTokens = input.trim() ? input.trim().split(" ") : [];

  if (typedTokens.length === 0) {
    return pinyinUnits[0]?.[0] ?? null;
  }

  if (hasTrailingSpace) {
    const nextToken = pinyinUnits[typedTokens.length];
    return nextToken?.[0] ?? null;
  }

  const currentTokenIndex = typedTokens.length - 1;
  const currentTypedToken = typedTokens[currentTokenIndex] ?? "";
  const expectedToken = pinyinUnits[currentTokenIndex] ?? "";
  const nextLetterIndex = currentTypedToken.length;

  if (nextLetterIndex < expectedToken.length) {
    return expectedToken[nextLetterIndex];
  }

  if (nextLetterIndex === expectedToken.length && currentTokenIndex < pinyinUnits.length - 1) {
    return " ";
  }

  if (currentTokenIndex === pinyinUnits.length - 1 && nextLetterIndex >= expectedToken.length) {
    return " ";
  }

  return null;
}

function handleStreakOnInput(previousInput, nextInput) {
  if (nextInput === previousInput) {
    return;
  }

  if (previousInput.startsWith(nextInput) && previousInput.length === nextInput.length + 1) {
    return;
  }

  if (nextInput.startsWith(previousInput) && nextInput.length === previousInput.length + 1) {
    const typedChar = nextInput[nextInput.length - 1];
    const expectedChar = getExpectedNextChar(previousInput);
    if (expectedChar != null && typedChar === expectedChar) {
      currentStreak += 1;
    } else {
      currentStreak = 0;
    }
    updateStreakDisplay();
    return;
  }

  currentStreak = 0;
  updateStreakDisplay();
}

function updateTargetHighlight(input) {
  const units = targetTextEl.querySelectorAll(".pair-unit");
  const typedTokens = input.trim() ? input.trim().split(" ") : [];
  const hasTrailingSpace = input.endsWith(" ");
  const currentUnitIndex =
    typedTokens.length === 0 ? 0 : hasTrailingSpace ? typedTokens.length : typedTokens.length - 1;

  const letterStats = countPinyinLetterStats(input, pinyinUnits);
  currentTyped = letterStats.typedLetterCount;
  currentCorrect = letterStats.correctLetterCount;

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

function isReadyToFinishBySpace(input) {
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    return false;
  }
  const typedTokens = trimmedInput.split(" ");
  if (typedTokens.length !== pinyinUnits.length) {
    return false;
  }
  const lastTypedToken = typedTokens[typedTokens.length - 1] ?? "";
  const lastExpectedToken = pinyinUnits[pinyinUnits.length - 1] ?? "";
  return lastTypedToken.length >= lastExpectedToken.length;
}

function loadNextSample() {
  const parsedSample = parseSample(pickText());
  sourceText = parsedSample.sourceText;
  hanziUnits = parsedSample.hanziUnits;
  pinyinUnits = parsedSample.pinyinUnits;
  targetText = pinyinUnits.join(" ");
  typingInputEl.value = "";
  typingInputEl.readOnly = false;
  hasArchivedCurrent = false;
  currentTyped = 0;
  currentCorrect = 0;
  lastInputValueForStreak = "";
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
  const paragraphAccuracy = currentTyped === 0 ? 0 : Math.round((currentCorrect / currentTyped) * 100);
  const clampedParagraphAccuracy = Math.max(0, Math.min(100, paragraphAccuracy));
  const orderLine = snapshot.querySelector(".source-order");
  if (orderLine) {
    orderLine.textContent = `${orderLine.textContent} · 准确率 ${clampedParagraphAccuracy}%`;
  }
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
  refreshElapsedTime();
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
  elapsedBeforePause = 0;
  committedTyped = 0;
  committedCorrect = 0;
  currentTyped = 0;
  currentCorrect = 0;
  hasArchivedCurrent = false;
  completedParagraphCount = 0;
  startedAt = null;
  lastActivityAt = null;
  isIdlePaused = false;

  typingInputEl.disabled = false;
  typingInputEl.readOnly = false;

  timeLeftEl.textContent = "0s";
  wpmEl.textContent = "0";
  cpmEl.textContent = "0";
  accuracyEl.textContent = "0%";
  keystrokesEl.textContent = "0";
  totalKeystrokes = 0;
  currentStreak = 0;
  currentRankScore = 0;
  lastInputValueForStreak = "";
  updateStreakDisplay();

  typingInputEl.focus();
}

typingInputEl.addEventListener("input", (event) => {
  recordKeyboardActivity();
  let normalizedInput = normalizeInputPinyin(event.target.value);
  if (event.target.value !== normalizedInput) {
    event.target.value = normalizedInput;
  }

  if (!timerId && !startedAt) {
    startTimer();
  }

  const input = normalizedInput;
  handleStreakOnInput(lastInputValueForStreak, input);
  lastInputValueForStreak = input;
  updateTargetHighlight(input);
  calculateStats();
});

typingInputEl.addEventListener("keydown", (event) => {
  recordKeyboardActivity();
  if (isCountedKeystroke(event)) {
    totalKeystrokes += 1;
    keystrokesEl.textContent = String(totalKeystrokes);
  }
  if (event.key === "Enter") {
    event.preventDefault();
    archiveCurrentResult();
    committedTyped += currentTyped;
    committedCorrect += currentCorrect;
    loadNextSample();
    calculateStats();
    return;
  }

  if (event.key === " " && isReadyToFinishBySpace(typingInputEl.value)) {
    event.preventDefault();
    const expectedChar = getExpectedNextChar(typingInputEl.value);
    if (expectedChar === " ") {
      currentStreak += 1;
      updateStreakDisplay();
    }
    archiveCurrentResult();
    committedTyped += currentTyped;
    committedCorrect += currentCorrect;
    loadNextSample();
    calculateStats();
    return;
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
