"use strict";

const STORAGE_PREFIX = "electrician-cbt:state:v2";
const AUTO_SAVE_INTERVAL_MS = 60_000;

const elements = {
  loader: document.querySelector("#loader"),
  file: document.querySelector("#exam-file"),
  quickFile: document.querySelector("#quick-file"),
  startQuickDemo: document.querySelector("#start-quick-demo"),
  startExamDemo: document.querySelector("#start-exam-demo"),
  quickCount: document.querySelector("#quick-count"),
  loaderMessage: document.querySelector("#loader-message"),
  exam: document.querySelector("#exam"),
  footer: document.querySelector("#exam-footer"),
  completed: document.querySelector("#completed"),
  timer: document.querySelector("#timer"),
  timerLabel: document.querySelector("#timer-label"),
  timerPanel: document.querySelector(".timer-panel"),
  title: document.querySelector("#exam-title"),
  mode: document.querySelector("#exam-mode"),
  progress: document.querySelector("#exam-progress"),
  board: document.querySelector("#question-board"),
  answerSheet: document.querySelector("#answer-sheet"),
  answerGrid: document.querySelector("#answer-grid"),
  answerCount: document.querySelector("#answer-count"),
  answerToggle: document.querySelector("#answer-sheet-toggle"),
  closeAnswerSheet: document.querySelector("#close-answer-sheet"),
  sheetBackdrop: document.querySelector("#sheet-backdrop"),
  previous: document.querySelector("#previous"),
  next: document.querySelector("#next"),
  currentPage: document.querySelector("#current-page"),
  totalPages: document.querySelector("#total-pages"),
  pageSize: document.querySelector("#page-size"),
  backup: document.querySelector("#backup"),
  finish: document.querySelector("#finish"),
  saveStatus: document.querySelector("#save-status"),
  fontSize: document.querySelector("#font-size"),
  fullscreen: document.querySelector("#fullscreen"),
  completionSummary: document.querySelector("#completion-summary"),
  completionEyebrow: document.querySelector("#completion-eyebrow"),
  completionTitle: document.querySelector("#completion-title"),
  shareResult: document.querySelector("#share-result"),
  downloadResult: document.querySelector("#download-result"),
  shareMessage: document.querySelector("#share-message")
};

let examPackage = null;
let state = null;
let timerHandle = null;
let autoSaveHandle = null;
let finalResult = null;
let activeStudyMode = "exam";

elements.startQuickDemo.addEventListener("click", () => loadExam(createDemoExam(), "quick"));
elements.startExamDemo.addEventListener("click", () => loadExam(createDemoExam(), "exam"));
elements.quickFile.addEventListener("change", (event) => loadExamFile(event, "quick"));
elements.file.addEventListener("change", (event) => loadExamFile(event, "exam"));
elements.previous.addEventListener("click", () => movePage(-1));
elements.next.addEventListener("click", () => movePage(1));
elements.pageSize.addEventListener("change", changePageSize);
elements.backup.addEventListener("click", downloadDraft);
elements.finish.addEventListener("click", () => finishExam("submitted"));
elements.downloadResult.addEventListener("click", () => downloadJson(finalResult, resultFilename()));
elements.shareResult.addEventListener("click", shareResult);
elements.answerToggle.addEventListener("click", openAnswerSheet);
elements.closeAnswerSheet.addEventListener("click", closeAnswerSheet);
elements.sheetBackdrop.addEventListener("click", closeAnswerSheet);
elements.fontSize.addEventListener("click", cycleFontSize);
elements.fullscreen.addEventListener("click", toggleFullscreen);

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js"));
}

async function loadExamFile(event, studyMode) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    loadExam(JSON.parse(await file.text()), studyMode);
  } catch (error) {
    elements.loaderMessage.textContent = `불러오기 실패: ${error.message}`;
    event.target.value = "";
  }
}

function loadExam(value, studyMode) {
  validateExamPackage(value);
  activeStudyMode = studyMode;
  examPackage = prepareExamForStudyMode(value, studyMode);
  initializeState();
  startExamUi();
}

function prepareExamForStudyMode(source, studyMode) {
  if (studyMode === "exam") {
    if (source.questions.length !== 100) throw new Error("실전 모드는 정확히 100문제인 회차만 사용할 수 있습니다.");
    return { ...source, timeLimitMinutes: 150, questionCount: 100 };
  }

  const requestedCount = Number(elements.quickCount.value);
  const dateKey = koreaDateKey();
  const questions = [...source.questions]
    .sort((a, b) => dailyQuestionScore(source.examId, dateKey, a.id) - dailyQuestionScore(source.examId, dateKey, b.id))
    .slice(0, Math.min(requestedCount, source.questions.length));

  return {
    ...source,
    attemptId: `${source.attemptId}-quick-${dateKey}-${questions.length}`,
    title: `틈새학습 ${questions.length}문제 · ${source.title}`,
    questionCount: questions.length,
    questions
  };
}

function koreaDateKey() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dailyQuestionScore(examId, dateKey, questionId) {
  const text = `${examId}:${dateKey}:${questionId}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function validateExamPackage(value) {
  if (!value || typeof value !== "object") throw new Error("JSON 객체가 아닙니다.");
  for (const field of ["examId", "attemptId", "title", "mode", "timeLimitMinutes", "questions"]) {
    if (value[field] === undefined || value[field] === null) throw new Error(`${field} 항목이 없습니다.`);
  }
  if (!["real", "custom", "development"].includes(value.mode)) throw new Error("지원하지 않는 시험 모드입니다.");
  if (!Array.isArray(value.questions) || value.questions.length === 0) throw new Error("문제가 없습니다.");
  if (value.questionCount !== value.questions.length) throw new Error("questionCount와 실제 문제 수가 다릅니다.");
  if (value.mode !== "development" && value.questions.length !== 100) throw new Error("실전·맞춤 회차는 정확히 100문제여야 합니다.");

  const ids = new Set();
  for (const [index, question] of value.questions.entries()) {
    if (!question.id || !question.stem || !Array.isArray(question.choices) || question.choices.length < 2) {
      throw new Error(`${index + 1}번 문제 구조가 올바르지 않습니다.`);
    }
    if (question.answer || question.correctChoiceId) throw new Error("시험 파일에 정답 정보가 포함되어 있습니다.");
    if (ids.has(question.id)) throw new Error(`중복 문제 ID: ${question.id}`);
    const choiceIds = question.choices.map((choice) => choice.id);
    if (choiceIds.some((id) => !id) || new Set(choiceIds).size !== choiceIds.length) {
      throw new Error(`${index + 1}번 문제의 선택지 ID가 비어 있거나 중복됩니다.`);
    }
    ids.add(question.id);
  }
}

function initializeState() {
  const saved = readSavedState(storageKey());
  if (saved && saved.status === "in_progress") {
    const resume = window.confirm("진행 중인 동일 시험 기록이 있습니다. 이어서 응시하시겠습니까?\n\n취소하면 새 응시 상태로 시작합니다.");
    if (resume) {
      state = { ...saved, pageSize: saved.pageSize || defaultPageSize(), memos: saved.memos || {} };
      return;
    }
  }

  const now = Date.now();
  state = {
    schemaVersion: 2,
    sessionId: `${examPackage.examId}-${examPackage.attemptId}`,
    examId: examPackage.examId,
    attemptId: examPackage.attemptId,
    mode: examPackage.mode,
    studyMode: activeStudyMode,
    status: "in_progress",
    startedAt: new Date(now).toISOString(),
    deadlineAt: activeStudyMode === "exam" ? new Date(now + 150 * 60_000).toISOString() : null,
    submittedAt: null,
    currentIndex: 0,
    pageSize: defaultPageSize(),
    answers: {},
    flaggedQuestionIds: [],
    memos: {},
    lastSavedAt: null
  };
  saveState();
}

function defaultPageSize() {
  return 1;
}

function startExamUi() {
  window.clearInterval(timerHandle);
  window.clearInterval(autoSaveHandle);
  elements.loader.classList.add("hidden");
  elements.completed.classList.add("hidden");
  elements.exam.classList.remove("hidden");
  elements.footer.classList.remove("hidden");
  elements.title.textContent = examPackage.title;
  elements.mode.textContent = modeLabel();
  elements.timerLabel.textContent = activeStudyMode === "quick" ? "학습 시간" : "남은 시간";
  elements.finish.textContent = activeStudyMode === "quick" ? "학습 종료" : "시험 완료";
  elements.pageSize.value = String(state.pageSize);
  buildAnswerSheet();
  renderPage();
  updateTimer();
  timerHandle = window.setInterval(updateTimer, 1_000);
  autoSaveHandle = window.setInterval(saveState, AUTO_SAVE_INTERVAL_MS);
}

function modeLabel() {
  if (activeStudyMode === "quick") return `틈새학습 · ${examPackage.questions.length}문제`;
  return examPackage.mode === "development" ? "실전 데모" : "실전 모의고사";
}

function renderPage() {
  if (!state || state.status !== "in_progress") return;
  const start = pageStartIndex();
  const visible = examPackage.questions.slice(start, start + state.pageSize);
  elements.board.replaceChildren(...visible.map((question, offset) => createQuestionCard(question, start + offset)));
  elements.board.classList.toggle("single", state.pageSize === 1);
  updateAnswerSheet();
  updateProgress();
  updatePagination();
  saveState();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function createQuestionCard(question, index) {
  const article = document.createElement("article");
  article.className = "question-card";

  const header = document.createElement("div");
  header.className = "question-header";
  const heading = document.createElement("div");
  heading.className = "question-heading";
  const number = document.createElement("span");
  number.className = "question-number";
  number.textContent = String(index + 1);
  const subject = document.createElement("span");
  subject.className = "subject-label";
  subject.textContent = question.subject;
  heading.append(number, subject);

  const flagLabel = document.createElement("label");
  flagLabel.className = "flag-control";
  const flag = document.createElement("input");
  flag.type = "checkbox";
  flag.checked = state.flaggedQuestionIds.includes(question.id);
  flag.addEventListener("change", () => toggleFlag(question.id, flag.checked));
  flagLabel.append(flag, document.createTextNode("검토"));
  header.append(heading, flagLabel);

  const stem = document.createElement("h2");
  stem.className = "question-stem";
  stem.textContent = question.stem;
  article.append(header, stem);

  if (question.image) {
    const imageWrap = document.createElement("div");
    imageWrap.className = "question-image";
    const image = document.createElement("img");
    image.src = question.image;
    image.alt = question.imageAlt || `${index + 1}번 문제 이미지`;
    imageWrap.appendChild(image);
    article.appendChild(imageWrap);
  }

  const choices = document.createElement("fieldset");
  choices.className = "choices";
  question.choices.forEach((choice) => {
    const label = document.createElement("label");
    label.className = "choice";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = `answer-${question.id}`;
    radio.value = choice.id;
    radio.checked = state.answers[question.id] === choice.id;
    radio.addEventListener("change", () => setAnswer(question.id, choice.id));
    const badge = document.createElement("span");
    badge.className = "choice-badge";
    badge.textContent = choice.id;
    const text = document.createElement("span");
    text.textContent = choice.text;
    label.append(radio, badge, text);
    choices.appendChild(label);
  });

  const memo = document.createElement("details");
  memo.className = "memo-box";
  const summary = document.createElement("summary");
  summary.textContent = "메모 남기기";
  const textarea = document.createElement("textarea");
  textarea.rows = 3;
  textarea.placeholder = "풀이 중 떠오른 내용을 적어두세요.";
  textarea.value = state.memos[question.id] || "";
  textarea.addEventListener("input", () => {
    state.memos[question.id] = textarea.value;
    saveState();
  });
  memo.append(summary, textarea);
  article.append(choices, memo);
  return article;
}

function buildAnswerSheet() {
  elements.answerGrid.replaceChildren();
  examPackage.questions.forEach((question, index) => {
    const row = document.createElement("div");
    row.className = "answer-row";
    row.dataset.questionId = question.id;
    const number = document.createElement("button");
    number.type = "button";
    number.className = "answer-number";
    number.textContent = String(index + 1);
    number.addEventListener("click", () => goToQuestion(index));
    const options = document.createElement("div");
    options.className = "answer-options";
    question.choices.forEach((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = choice.id;
      button.dataset.choiceId = choice.id;
      button.setAttribute("aria-label", `${index + 1}번 ${choice.id}번 선택`);
      button.addEventListener("click", () => setAnswer(question.id, choice.id));
      options.appendChild(button);
    });
    row.append(number, options);
    elements.answerGrid.appendChild(row);
  });
}

function setAnswer(questionId, choiceId) {
  state.answers[questionId] = choiceId;
  saveState();
  updateAnswerSheet();
  updateProgress();
  document.querySelectorAll(`input[name="answer-${CSS.escape(questionId)}"]`).forEach((radio) => {
    radio.checked = radio.value === choiceId;
  });
}

function toggleFlag(questionId, checked) {
  const flags = new Set(state.flaggedQuestionIds);
  checked ? flags.add(questionId) : flags.delete(questionId);
  state.flaggedQuestionIds = [...flags];
  saveState();
  updateAnswerSheet();
  updateProgress();
}

function updateAnswerSheet() {
  if (!state) return;
  [...elements.answerGrid.children].forEach((row, index) => {
    const question = examPackage.questions[index];
    const selected = state.answers[question.id];
    row.classList.toggle("current", index >= pageStartIndex() && index < pageStartIndex() + state.pageSize);
    row.classList.toggle("flagged", state.flaggedQuestionIds.includes(question.id));
    row.querySelectorAll(".answer-options button").forEach((button) => {
      button.classList.toggle("selected", button.dataset.choiceId === selected);
    });
  });
  const answered = answeredCount();
  elements.answerCount.textContent = `${answered} / ${examPackage.questions.length}`;
}

function updateProgress() {
  const answered = answeredCount();
  elements.progress.textContent = `답변 ${answered} · 미응답 ${examPackage.questions.length - answered} · 검토 ${state.flaggedQuestionIds.length}`;
}

function answeredCount() {
  return examPackage.questions.filter((question) => state.answers[question.id]).length;
}

function pageStartIndex() {
  return Math.floor(state.currentIndex / state.pageSize) * state.pageSize;
}

function pageNumber() {
  return Math.floor(state.currentIndex / state.pageSize) + 1;
}

function totalPages() {
  return Math.ceil(examPackage.questions.length / state.pageSize);
}

function updatePagination() {
  elements.currentPage.textContent = String(pageNumber());
  elements.totalPages.textContent = String(totalPages());
  elements.previous.disabled = pageNumber() === 1;
  elements.next.disabled = pageNumber() === totalPages();
}

function movePage(direction) {
  const nextIndex = state.currentIndex + direction * state.pageSize;
  if (nextIndex < 0 || nextIndex >= examPackage.questions.length) return;
  state.currentIndex = nextIndex;
  renderPage();
}

function goToQuestion(index) {
  state.currentIndex = index;
  renderPage();
  closeAnswerSheet();
}

function changePageSize() {
  const anchorIndex = pageStartIndex();
  state.pageSize = Number(elements.pageSize.value);
  state.currentIndex = anchorIndex;
  renderPage();
}

function updateTimer() {
  if (!state || state.status !== "in_progress") return;
  if (state.studyMode === "quick") {
    const elapsed = Math.max(0, Date.now() - new Date(state.startedAt).getTime());
    elements.timer.textContent = formatDuration(elapsed);
    elements.timerPanel.classList.remove("warning");
    return;
  }
  const remaining = new Date(state.deadlineAt).getTime() - Date.now();
  if (remaining <= 0) {
    elements.timer.textContent = "00:00:00";
    finishExam("timed_out", true);
    return;
  }
  elements.timer.textContent = formatDuration(remaining);
  elements.timerPanel.classList.toggle("warning", remaining <= 10 * 60_000);
}

function formatDuration(durationMs) {
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function saveState() {
  if (!state || !examPackage) return;
  state.lastSavedAt = new Date().toISOString();
  localStorage.setItem(storageKey(), JSON.stringify(state));
  elements.saveStatus.textContent = `자동 저장 ${new Date(state.lastSavedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
}

function readSavedState(key) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function storageKey() {
  return `${STORAGE_PREFIX}:${activeStudyMode}:${examPackage.examId}:${examPackage.attemptId}`;
}

function downloadDraft() {
  saveState();
  downloadJson({ ...state, examTitle: examPackage.title }, `exam-draft-${state.sessionId}.json`);
}

function finishExam(reason, skipConfirmation = false) {
  if (!state || state.status !== "in_progress") return;
  const unanswered = examPackage.questions.length - answeredCount();
  if (!skipConfirmation) {
    const action = activeStudyMode === "quick" ? "학습을 종료" : "시험을 완료";
    const confirmed = window.confirm(`미응답 ${unanswered}문제입니다. ${action}하면 답안을 수정할 수 없습니다. 계속하시겠습니까?`);
    if (!confirmed) return;
  }

  state.status = reason;
  state.submittedAt = new Date().toISOString();
  saveState();
  window.clearInterval(timerHandle);
  window.clearInterval(autoSaveHandle);
  finalResult = buildResult();
  elements.exam.classList.add("hidden");
  elements.footer.classList.add("hidden");
  elements.completed.classList.remove("hidden");
  elements.completionEyebrow.textContent = activeStudyMode === "quick" ? "학습 완료" : "제출 완료";
  elements.completionTitle.textContent = activeStudyMode === "quick" ? "학습 기록 파일이 준비됐습니다." : "시험 결과 파일이 준비됐습니다.";
  elements.completionSummary.textContent = `${examPackage.title} · 답변 ${examPackage.questions.length - unanswered}문제 · 미응답 ${unanswered}문제`;
  if (!skipConfirmation) downloadJson(finalResult, resultFilename());
}

function buildResult() {
  return {
    schemaVersion: 1,
    sessionId: state.sessionId,
    examId: state.examId,
    attemptId: state.attemptId,
    examTitle: examPackage.title,
    mode: state.mode,
    studyMode: state.studyMode,
    status: state.status,
    startedAt: state.startedAt,
    deadlineAt: state.deadlineAt,
    submittedAt: state.submittedAt,
    timeLimitMinutes: examPackage.timeLimitMinutes,
    answers: examPackage.questions.map((question, index) => ({
      questionNumber: index + 1,
      questionId: question.id,
      selectedChoiceId: state.answers[question.id] || null,
      flagged: state.flaggedQuestionIds.includes(question.id),
      memo: state.memos[question.id] || null
    }))
  };
}

async function shareResult() {
  const file = createResultFile();
  if (!navigator.share || !navigator.canShare?.({ files: [file] })) {
    elements.shareMessage.textContent = "이 브라우저에서는 파일 공유를 지원하지 않아 다운로드로 전환했습니다.";
    downloadJson(finalResult, resultFilename());
    return;
  }
  try {
    const resultKind = activeStudyMode === "quick" ? "학습 기록" : "시험 결과";
    await navigator.share({ files: [file], title: `전기기사 CBT ${resultKind}`, text: `Codex 분석용 ${resultKind} JSON` });
    elements.shareMessage.textContent = "공유가 완료되었습니다.";
  } catch (error) {
    if (error.name !== "AbortError") elements.shareMessage.textContent = `공유 실패: ${error.message}`;
  }
}

function createResultFile() {
  return new File([JSON.stringify(finalResult, null, 2)], resultFilename(), { type: "application/json" });
}

function resultFilename() {
  const prefix = activeStudyMode === "quick" ? "study-result" : "exam-result";
  return `${prefix}-${state.sessionId}.json`;
}

function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function openAnswerSheet() {
  elements.answerSheet.classList.add("open");
  elements.sheetBackdrop.classList.add("open");
}

function closeAnswerSheet() {
  elements.answerSheet.classList.remove("open");
  elements.sheetBackdrop.classList.remove("open");
}

function cycleFontSize() {
  const sizes = ["compact", "normal", "large"];
  const current = document.documentElement.dataset.fontSize || "normal";
  const next = sizes[(sizes.indexOf(current) + 1) % sizes.length];
  document.documentElement.dataset.fontSize = next;
  localStorage.setItem("electrician-cbt:preference:font-size", next);
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}

document.documentElement.dataset.fontSize = localStorage.getItem("electrician-cbt:preference:font-size") || "normal";
