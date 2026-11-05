"use strict";

const STORAGE_PREFIX = "electrician-cbt:state:v2";
const AUTO_SAVE_INTERVAL_MS = 60_000;
const BANK_DB_NAME = "electrician-cbt";
const BANK_STORE_NAME = "questionBanks";
const ACTIVE_BANK_KEY = "active";
const EXAM_PROGRESS_KEY = "electrician-cbt:exam-progress:v1";
const WRONG_BOOK_KEY = "electrician-cbt:wrong-book:v1";
const QUESTION_STATS_KEY = "electrician-cbt:question-statistics:v1";
const SYNC_QUEUE_KEY = "electrician-cbt:sync-queue:v1";
const SUBJECT_ORDER = ["전기자기학", "전력공학", "전기기기", "회로이론 및 제어공학", "전기설비기술기준"];

const elements = {
  loader: document.querySelector("#loader"),
  bankFile: document.querySelector("#bank-file"),
  clearBank: document.querySelector("#clear-bank"),
  bankStatus: document.querySelector("#bank-status"),
  authForm: document.querySelector("#auth-form"),
  authEmail: document.querySelector("#auth-email"),
  authPassword: document.querySelector("#auth-password"),
  authStatus: document.querySelector("#auth-status"),
  signedInActions: document.querySelector("#signed-in-actions"),
  signOut: document.querySelector("#sign-out"),
  syncNow: document.querySelector("#sync-now"),
  syncStatus: document.querySelector("#sync-status"),
  startQuickDemo: document.querySelector("#start-quick-demo"),
  startQuickBank: document.querySelector("#start-quick-bank"),
  startExamDemo: document.querySelector("#start-exam-demo"),
  startBankExam: document.querySelector("#start-bank-exam"),
  startWrongReview: document.querySelector("#start-wrong-review"),
  exportStatistics: document.querySelector("#export-statistics"),
  quickSubject: document.querySelector("#quick-subject"),
  quickCount: document.querySelector("#quick-count"),
  wrongSubject: document.querySelector("#wrong-subject"),
  wrongCount: document.querySelector("#wrong-count"),
  weaknessStatus: document.querySelector("#weakness-status"),
  examYear: document.querySelector("#exam-year"),
  examRound: document.querySelector("#exam-round"),
  examCompletionStatus: document.querySelector("#exam-completion-status"),
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
let questionBank = null;
let supabaseClient = null;
let currentSyncUser = null;
let syncInProgress = false;

elements.startQuickDemo.addEventListener("click", () => loadExam(createDemoExam(), "quick"));
elements.startExamDemo.addEventListener("click", () => loadExam(createDemoExam(), "exam"));
elements.startQuickBank.addEventListener("click", startQuickFromBank);
elements.startBankExam.addEventListener("click", startExamFromBank);
elements.startWrongReview.addEventListener("click", startWrongReview);
elements.exportStatistics.addEventListener("click", exportQuestionStatistics);
elements.bankFile.addEventListener("change", registerQuestionBank);
elements.clearBank.addEventListener("click", clearQuestionBank);
elements.authForm.addEventListener("submit", signInForSync);
elements.signOut.addEventListener("click", signOutFromSync);
elements.syncNow.addEventListener("click", () => synchronizeCloudData(true));
elements.examYear.addEventListener("change", refreshRoundOptions);
elements.examRound.addEventListener("change", updateExamCompletionStatus);
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

initializeQuestionBank();
initializeCloudSync();

async function initializeQuestionBank() {
  try {
    const saved = await readQuestionBank();
    if (saved) activateQuestionBank(saved);
    else refreshBankControls();
  } catch (error) {
    elements.bankStatus.textContent = `문제은행 저장소를 열 수 없습니다: ${error.message}`;
  }
}

async function registerQuestionBank(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const value = JSON.parse(await file.text());
    validateQuestionBank(value);
    await saveQuestionBank(value);
    activateQuestionBank(value);
    elements.loaderMessage.textContent = "문제은행을 이 기기에 등록했습니다.";
  } catch (error) {
    elements.loaderMessage.textContent = `문제은행 등록 실패: ${error.message}`;
  } finally {
    event.target.value = "";
  }
}

function activateQuestionBank(value) {
  questionBank = value;
  refreshBankControls();
}

function validateQuestionBank(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 5) throw new Error("지원하는 문제은행 형식(v5)이 아닙니다.");
  if (!Array.isArray(value.questions) || value.questions.length === 0) throw new Error("문제가 없습니다.");
  const ids = new Set();
  value.questions.forEach((question, index) => {
    if (!question.id || !question.subjectCode || !question.subject || !question.stem || !question.source || !Array.isArray(question.choices) || question.choices.length !== 4) {
      throw new Error(`${index + 1}번째 문제 구조가 올바르지 않습니다.`);
    }
    if (!question.answer?.choiceId || typeof question.answer.explanation !== "string" || !question.answer.explanation.trim()) {
      throw new Error(`${index + 1}번째 문제의 정답 또는 해설이 없습니다.`);
    }
    if (!question.choices.some((choice) => choice.id === question.answer.choiceId)) {
      throw new Error(`${index + 1}번째 문제의 정답이 선택지에 없습니다.`);
    }
    if (!/^[A-Z][A-Z0-9_]+$/.test(question.subjectCode)) {
      throw new Error(`${index + 1}번째 문제의 subjectCode가 올바르지 않습니다.`);
    }
    const expectedId = canonicalQuestionId(question);
    if (["official_past_exam", "licensed_reference", "user_owned"].includes(question.source.kind) && !expectedId) {
      throw new Error(`${index + 1}번째 실제 문항의 연도·회차·형식·원문 번호가 불완전합니다.`);
    }
    if (expectedId && question.id !== expectedId) {
      throw new Error(`${index + 1}번째 문제 ID는 ${expectedId}여야 합니다.`);
    }
    const choiceIds = question.choices.map((choice) => choice.id);
    if (choiceIds.some((id) => !id) || question.choices.some((choice) => typeof choice.text !== "string" || !choice.text.trim()) || new Set(choiceIds).size !== 4) {
      throw new Error(`${index + 1}번째 문제의 선택지 ID·내용이 비어 있거나 ID가 중복됩니다.`);
    }
    if (question.image && !/^data:image\/(png|jpeg|webp|svg\+xml);base64,/i.test(question.image)) {
      throw new Error(`${index + 1}번째 문제 이미지는 문제은행에 포함된 base64 이미지여야 합니다.`);
    }
    if (ids.has(question.id)) throw new Error(`중복 문제 ID: ${question.id}`);
    ids.add(question.id);
  });
  if (!verifiedQuestions(value).length) throw new Error("검증 완료(status: verified) 문제가 없습니다.");
}

function canonicalQuestionId(question) {
  const { examYear, examRound, examFormat, originalQuestionNumber } = question.source || {};
  if (!Number.isInteger(examYear) || !Number.isInteger(examRound) || !Number.isInteger(originalQuestionNumber) || !["PBT", "CBT"].includes(examFormat)) return null;
  const round = String(examRound).padStart(2, "0");
  const number = String(originalQuestionNumber).padStart(3, "0");
  return `electrician.${examFormat.toLowerCase()}.${examYear}.r${round}.q${number}`;
}

function verifiedQuestions(value = questionBank) {
  return value?.questions.filter((question) => question.status === "verified") || [];
}

function refreshBankControls() {
  const questions = verifiedQuestions();
  const subjects = [...new Set(questions.map((question) => question.subject))]
    .sort((a, b) => subjectRank(a) - subjectRank(b) || a.localeCompare(b, "ko"));
  const years = [...new Set(questions.map((question) => question.source?.examYear).filter(Number.isInteger))].sort((a, b) => b - a);

  elements.quickSubject.replaceChildren();
  elements.examYear.replaceChildren();
  if (!questions.length) {
    elements.quickSubject.append(new Option("문제은행 등록 필요", ""));
    elements.examYear.append(new Option("문제은행 등록 필요", ""));
    elements.examRound.replaceChildren(new Option("연도 선택 필요", ""));
    for (const control of [elements.quickSubject, elements.examYear, elements.examRound, elements.startQuickBank, elements.startBankExam, elements.clearBank]) control.disabled = true;
    elements.bankStatus.textContent = "등록된 문제은행이 없습니다. 더미 데모는 바로 사용할 수 있습니다.";
    elements.examCompletionStatus.textContent = "문제은행을 등록하면 회차별 완료 횟수가 표시됩니다.";
    refreshWeaknessControls();
    return;
  }

  elements.quickSubject.append(new Option("전과목", "all"), ...subjects.map((subject) => new Option(subject, subject)));
  elements.examYear.append(...years.map((year) => new Option(`${year}년`, String(year))));
  elements.quickSubject.disabled = false;
  elements.examYear.disabled = years.length === 0;
  elements.startQuickBank.disabled = false;
  elements.clearBank.disabled = false;
  refreshRoundOptions();
  refreshWeaknessControls();

  const rounds = new Set(questions.filter((question) => Number.isInteger(question.source?.examYear) && Number.isInteger(question.source?.examRound)).map((question) => `${question.source.examYear}-${question.source.examRound}`));
  elements.bankStatus.textContent = `검증 ${questions.length.toLocaleString("ko-KR")}문제 · ${years.length}개 연도 · ${rounds.size}개 회차가 이 기기에 저장되어 있습니다.`;
}

function subjectRank(subject) {
  const index = SUBJECT_ORDER.indexOf(subject);
  return index === -1 ? SUBJECT_ORDER.length : index;
}

function refreshRoundOptions() {
  const year = Number(elements.examYear.value);
  const rounds = [...new Set(verifiedQuestions().filter((question) => question.source?.examYear === year && Number.isInteger(question.source?.examRound)).map((question) => question.source.examRound))].sort((a, b) => a - b);
  const progress = readStoredObject(EXAM_PROGRESS_KEY);
  const format = examFormatForYear(year);
  elements.examRound.replaceChildren(...rounds.map((round) => {
    const completedCount = progress[`electrician-${year}-${round}`]?.completedCount || 0;
    const completion = completedCount ? ` · ${completedCount}회 완료` : " · 미완료";
    return new Option(`${round}회 · ${format}${completion}`, String(round));
  }));
  elements.examRound.disabled = rounds.length === 0;
  elements.startBankExam.disabled = rounds.length === 0;
  updateExamCompletionStatus();
}

function examFormatForYear(year) {
  const explicit = verifiedQuestions().find((question) => question.source?.examYear === year && question.source?.examFormat)?.source.examFormat;
  if (explicit) return explicit;
  if (year >= 2015 && year <= 2022) return "PBT";
  if (year >= 2023 && year <= 2026) return "CBT";
  return "형식 미지정";
}

function updateExamCompletionStatus() {
  const year = Number(elements.examYear.value);
  const round = Number(elements.examRound.value);
  if (!year || !round) {
    elements.examCompletionStatus.textContent = "선택할 수 있는 완전한 회차가 없습니다.";
    return;
  }
  const record = readStoredObject(EXAM_PROGRESS_KEY)[`electrician-${year}-${round}`];
  elements.examCompletionStatus.textContent = record
    ? `${year}년 ${round}회 ${examFormatForYear(year)} · ${record.completedCount}회 완료 · 최근 ${new Date(record.lastCompletedAt).toLocaleDateString("ko-KR")}`
    : `${year}년 ${round}회 ${examFormatForYear(year)} · 아직 완료하지 않음`;
}

function startQuickFromBank() {
  try {
    const selectedSubject = elements.quickSubject.value;
    const candidates = verifiedQuestions().filter((question) => selectedSubject === "all" || question.subject === selectedSubject);
    if (!candidates.length) throw new Error("선택한 과목에 검증 완료 문제가 없습니다.");
    const label = selectedSubject === "all" ? "전과목" : selectedSubject;
    loadExam(buildExamPackage(candidates, `question-bank-${selectedSubject}`, `${label} 틈새학습`, "custom", true), "quick");
  } catch (error) {
    elements.loaderMessage.textContent = `틈새학습 시작 실패: ${error.message}`;
  }
}

function startExamFromBank() {
  try {
    const year = Number(elements.examYear.value);
    const round = Number(elements.examRound.value);
    const questions = verifiedQuestions()
      .filter((question) => question.source?.examYear === year && question.source?.examRound === round)
      .sort((a, b) => a.source.originalQuestionNumber - b.source.originalQuestionNumber);
    if (questions.length !== 100) throw new Error(`${year}년 ${round}회는 검증 완료 문제가 ${questions.length}개입니다. 실전 모드는 100개가 필요합니다.`);
    const originalNumbers = questions.map((question) => question.source.originalQuestionNumber);
    if (originalNumbers.some((number) => !Number.isInteger(number)) || new Set(originalNumbers).size !== 100 || Math.min(...originalNumbers) !== 1 || Math.max(...originalNumbers) !== 100) {
      throw new Error(`${year}년 ${round}회의 원문 문제 번호가 1~100으로 완전하지 않습니다.`);
    }
    loadExam(buildExamPackage(questions, `electrician-${year}-${round}`, `${year}년 ${round}회 전기기사`, "real"), "exam");
  } catch (error) {
    elements.loaderMessage.textContent = `실전 모의고사 시작 실패: ${error.message}`;
  }
}

function refreshWeaknessControls() {
  const wrongBook = readStoredObject(WRONG_BOOK_KEY);
  const statistics = readStoredObject(QUESTION_STATS_KEY);
  const bankQuestions = new Map(verifiedQuestions().map((question) => [question.id, question]));
  const wrongQuestions = Object.values(wrongBook).map((record) => bankQuestions.get(record.questionId)).filter(Boolean);
  const subjects = [...new Set(wrongQuestions.map((question) => question.subject))]
    .sort((a, b) => subjectRank(a) - subjectRank(b) || a.localeCompare(b, "ko"));

  elements.wrongSubject.replaceChildren();
  elements.exportStatistics.disabled = Object.keys(statistics).length === 0;
  if (!wrongQuestions.length) {
    elements.wrongSubject.append(new Option(questionBank ? "오답 없음" : "문제은행 등록 필요", ""));
    elements.wrongSubject.disabled = true;
    elements.wrongCount.disabled = true;
    elements.startWrongReview.disabled = true;
    const totalWrong = Object.values(statistics).reduce((sum, record) => sum + (record.wrongCount || 0), 0);
    elements.weaknessStatus.textContent = questionBank
      ? totalWrong ? `현재 보완할 오답은 없지만 누적 오답 ${totalWrong}회 기록은 통계에 보존되어 있습니다.` : "아직 저장된 오답이 없습니다. 실전 회차를 완료하면 자동으로 모입니다."
      : "문제은행을 등록한 뒤 실전 회차를 완료하면 오답이 자동으로 모입니다.";
    return;
  }

  elements.wrongSubject.append(new Option("전과목", "all"), ...subjects.map((subject) => new Option(subject, subject)));
  elements.wrongSubject.disabled = false;
  elements.wrongCount.disabled = false;
  elements.startWrongReview.disabled = false;
  const totalWrong = Object.values(statistics).reduce((sum, record) => sum + (record.wrongCount || 0), 0);
  elements.weaknessStatus.textContent = `현재 보완할 오답 ${wrongQuestions.length}문제 · 누적 오답 ${totalWrong}회 · 맞혀도 통계 기록은 보존됩니다.`;
}

function exportQuestionStatistics() {
  const statistics = Object.values(readStoredObject(QUESTION_STATS_KEY)).map((record) => ({
    ...record,
    hintViewCount: record.hintViewCount || 0
  }));
  if (!statistics.length) return;
  downloadJson({
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    deviceScope: "browser_local",
    statistics
  }, `question-statistics-${koreaDateKey()}.json`);
}

function startWrongReview() {
  try {
    const subject = elements.wrongSubject.value;
    const wrongBook = readStoredObject(WRONG_BOOK_KEY);
    const dateKey = koreaDateKey();
    const examId = `wrong-review-${subject}`;
    // 많이 틀린 문제를 먼저 내고, 틀린 횟수가 같으면 날짜별 고정 순서로 섞어 같은 날 이어풀기가 가능하게 한다.
    const candidates = verifiedQuestions()
      .filter((question) => wrongBook[question.id] && (subject === "all" || question.subject === subject))
      .sort((a, b) => (wrongBook[b.id].wrongCount || 0) - (wrongBook[a.id].wrongCount || 0)
        || dailyQuestionScore(examId, dateKey, a.id) - dailyQuestionScore(examId, dateKey, b.id));
    if (!candidates.length) throw new Error("선택한 과목에 보완할 오답이 없습니다.");
    const label = subject === "all" ? "전과목" : subject;
    loadExam(buildExamPackage(candidates, examId, `${label} 오답 보완학습`, "custom"), "wrong");
  } catch (error) {
    elements.loaderMessage.textContent = `오답 보완학습 시작 실패: ${error.message}`;
  }
}

function buildExamPackage(questions, examId, title, mode, includeHints = false) {
  return {
    schemaVersion: 1,
    examId,
    attemptId: null,
    title,
    mode,
    timeLimitMinutes: 150,
    questionCount: questions.length,
    questions: questions.map((question) => toExamQuestion(question, includeHints))
  };
}

function toExamQuestion(question, includeHint = false) {
  const examQuestion = {
    id: question.id,
    subject: question.subject,
    stem: question.stem,
    image: question.image || null,
    imageAlt: question.imageAlt || null,
    choices: question.choices.map((choice) => ({ id: choice.id, text: choice.text }))
  };
  if (includeHint) examQuestion.explanationHint = question.answer.explanation;
  return examQuestion;
}

async function clearQuestionBank() {
  if (!window.confirm("이 기기에 저장된 문제은행을 삭제하시겠습니까? 시험 기록과 결과 파일은 삭제되지 않습니다.")) return;
  await deleteQuestionBank();
  questionBank = null;
  refreshBankControls();
  elements.loaderMessage.textContent = "이 기기에서 문제은행을 삭제했습니다.";
}

function loadExam(value, studyMode) {
  activeStudyMode = studyMode;
  examPackage = prepareExamForStudyMode(value, studyMode);
  const resumableAttemptId = findResumableAttemptId(examPackage, studyMode);
  examPackage.attemptId = resumableAttemptId || createAttemptId(examPackage.examId);
  validateExamPackage(examPackage, studyMode);
  initializeState();
  startExamUi();
}

function prepareExamForStudyMode(source, studyMode) {
  if (studyMode === "exam") {
    if (source.questions.length !== 100) throw new Error("실전 모드는 정확히 100문제인 회차만 사용할 수 있습니다.");
    return { ...source, timeLimitMinutes: 150, questionCount: 100 };
  }

  const requestedCount = Number(studyMode === "wrong" ? elements.wrongCount.value : elements.quickCount.value);
  const dateKey = koreaDateKey();
  // 오답 보완은 startWrongReview에서 정한 우선순위(틀린 횟수 순)를 그대로 쓰고, 틈새학습만 날짜별로 섞는다.
  const ordered = studyMode === "wrong"
    ? [...source.questions]
    : [...source.questions].sort((a, b) => dailyQuestionScore(source.examId, dateKey, a.id) - dailyQuestionScore(source.examId, dateKey, b.id));
  const questions = ordered.slice(0, Math.min(requestedCount, source.questions.length));

  return {
    ...source,
    title: `${studyMode === "wrong" ? "오답 보완" : "틈새학습"} ${questions.length}문제 · ${source.title}`,
    questionCount: questions.length,
    questions
  };
}

function createAttemptId(examId) {
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10);
  return `${examId}-${Date.now()}-${suffix}`;
}

function findResumableAttemptId(preparedExam, studyMode) {
  const expectedQuestionIds = preparedExam.questions.map((question) => question.id);
  let latest = null;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(`${STORAGE_PREFIX}:${studyMode}:${preparedExam.examId}:`)) continue;
    const saved = readSavedState(key);
    if (saved?.status !== "in_progress") continue;
    if (JSON.stringify(saved.questionIds || []) !== JSON.stringify(expectedQuestionIds)) continue;
    if (!latest || String(saved.lastSavedAt || saved.startedAt) > String(latest.lastSavedAt || latest.startedAt)) latest = saved;
  }
  return latest?.attemptId || null;
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

function validateExamPackage(value, studyMode) {
  if (!value || typeof value !== "object") throw new Error("JSON 객체가 아닙니다.");
  for (const field of ["examId", "attemptId", "title", "mode", "timeLimitMinutes", "questions"]) {
    if (value[field] === undefined || value[field] === null) throw new Error(`${field} 항목이 없습니다.`);
  }
  if (!["real", "custom", "development"].includes(value.mode)) throw new Error("지원하지 않는 시험 모드입니다.");
  if (!Array.isArray(value.questions) || value.questions.length === 0) throw new Error("문제가 없습니다.");
  if (value.questionCount !== value.questions.length) throw new Error("questionCount와 실제 문제 수가 다릅니다.");
  if (studyMode === "exam" && value.mode !== "development" && value.questions.length !== 100) throw new Error("실전 회차는 정확히 100문제여야 합니다.");

  const ids = new Set();
  for (const [index, question] of value.questions.entries()) {
    if (!question.id || !question.stem || !Array.isArray(question.choices) || question.choices.length !== 4) {
      throw new Error(`${index + 1}번 문제 구조가 올바르지 않습니다.`);
    }
    if (question.answer || question.correctChoiceId) throw new Error("시험 파일에 정답 정보가 포함되어 있습니다.");
    if (studyMode !== "quick" && question.explanationHint) throw new Error("해설 힌트는 틈새학습에서만 사용할 수 있습니다.");
    if (ids.has(question.id)) throw new Error(`중복 문제 ID: ${question.id}`);
    const choiceIds = question.choices.map((choice) => choice.id);
    if (choiceIds.some((id) => !id) || new Set(choiceIds).size !== choiceIds.length) {
      throw new Error(`${index + 1}번 문제의 선택지 ID가 비어 있거나 중복됩니다.`);
    }
    ids.add(question.id);
  }
}

function openBankDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BANK_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(BANK_STORE_NAME)) database.createObjectStore(BANK_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB를 열 수 없습니다."));
  });
}

async function readQuestionBank() {
  const database = await openBankDatabase();
  try {
    return await runBankRequest(database, "readonly", (store) => store.get(ACTIVE_BANK_KEY));
  } finally {
    database.close();
  }
}

async function saveQuestionBank(value) {
  const database = await openBankDatabase();
  try {
    await runBankRequest(database, "readwrite", (store) => store.put(value, ACTIVE_BANK_KEY));
  } finally {
    database.close();
  }
}

async function deleteQuestionBank() {
  const database = await openBankDatabase();
  try {
    await runBankRequest(database, "readwrite", (store) => store.delete(ACTIVE_BANK_KEY));
  } finally {
    database.close();
  }
}

function runBankRequest(database, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(BANK_STORE_NAME, mode);
    const request = operation(transaction.objectStore(BANK_STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("문제은행 저장 작업에 실패했습니다."));
    transaction.onerror = () => reject(transaction.error || new Error("문제은행 저장 작업에 실패했습니다."));
  });
}

function initializeState() {
  const saved = readSavedState(storageKey());
  if (saved && saved.status === "in_progress") {
    const resume = window.confirm("진행 중인 동일 시험 기록이 있습니다. 이어서 응시하시겠습니까?\n\n취소하면 새 응시 상태로 시작합니다.");
    if (resume) {
      state = {
        ...saved,
        pageSize: saved.pageSize || defaultPageSize(),
        memos: saved.memos || {},
        hintedQuestionIds: saved.hintedQuestionIds || [],
        visibleHintQuestionIds: saved.visibleHintQuestionIds || []
      };
      return;
    }
    examPackage.attemptId = createAttemptId(examPackage.examId);
  }

  const now = Date.now();
  state = {
    schemaVersion: 2,
    sessionId: `${examPackage.examId}-${examPackage.attemptId}`,
    examId: examPackage.examId,
    attemptId: examPackage.attemptId,
    mode: examPackage.mode,
    studyMode: activeStudyMode,
    questionIds: examPackage.questions.map((question) => question.id),
    questionCount: examPackage.questions.length,
    status: "in_progress",
    startedAt: new Date(now).toISOString(),
    deadlineAt: activeStudyMode === "exam" ? new Date(now + 150 * 60_000).toISOString() : null,
    submittedAt: null,
    currentIndex: 0,
    pageSize: defaultPageSize(),
    answers: {},
    flaggedQuestionIds: [],
    hintedQuestionIds: [],
    visibleHintQuestionIds: [],
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
  elements.timerLabel.textContent = activeStudyMode === "exam" ? "남은 시간" : "학습 시간";
  elements.finish.textContent = activeStudyMode === "exam" ? "시험 완료" : "학습 종료";
  elements.pageSize.value = String(state.pageSize);
  buildAnswerSheet();
  renderPage();
  updateTimer();
  timerHandle = window.setInterval(updateTimer, 1_000);
  autoSaveHandle = window.setInterval(saveState, AUTO_SAVE_INTERVAL_MS);
}

function modeLabel() {
  if (activeStudyMode === "quick") return `틈새학습 · ${examPackage.questions.length}문제`;
  if (activeStudyMode === "wrong") return `오답 보완 · ${examPackage.questions.length}문제`;
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
  article.appendChild(choices);

  if (activeStudyMode === "quick" && question.explanationHint) {
    const hintBox = document.createElement("section");
    hintBox.className = "hint-box";
    const hintLabel = document.createElement("label");
    hintLabel.className = "hint-toggle";
    const hintCheckbox = document.createElement("input");
    hintCheckbox.type = "checkbox";
    hintCheckbox.checked = state.visibleHintQuestionIds.includes(question.id);
    hintLabel.append(hintCheckbox, document.createTextNode("해설 힌트 보기"));
    const hint = document.createElement("div");
    hint.className = "hint-content";
    hint.textContent = question.explanationHint;
    hint.hidden = !hintCheckbox.checked;
    hintCheckbox.addEventListener("change", () => {
      const visibleHints = new Set(state.visibleHintQuestionIds);
      if (hintCheckbox.checked) {
        visibleHints.add(question.id);
        state.hintedQuestionIds = [...new Set([...state.hintedQuestionIds, question.id])];
      } else {
        visibleHints.delete(question.id);
      }
      state.visibleHintQuestionIds = [...visibleHints];
      hint.hidden = !hintCheckbox.checked;
      saveState();
    });
    hintBox.append(hintLabel, hint);
    article.appendChild(hintBox);
  }

  article.appendChild(memo);
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
  if (state.studyMode !== "exam") {
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
    const action = activeStudyMode === "exam" ? "시험을 완료" : "학습을 종료";
    const confirmed = window.confirm(`미응답 ${unanswered}문제입니다. ${action}하면 답안을 수정할 수 없습니다. 계속하시겠습니까?`);
    if (!confirmed) return;
  }

  state.status = reason;
  state.submittedAt = new Date().toISOString();
  saveState();
  window.clearInterval(timerHandle);
  window.clearInterval(autoSaveHandle);
  const grading = gradeCurrentAttempt();
  updateLearningProgress(grading);
  finalResult = buildResult(grading);
  queueResultForCloudSync(finalResult);
  void synchronizeCloudData(false);
  elements.exam.classList.add("hidden");
  elements.footer.classList.add("hidden");
  elements.completed.classList.remove("hidden");
  elements.completionEyebrow.textContent = activeStudyMode === "exam" ? "제출 완료" : "학습 완료";
  elements.completionTitle.textContent = activeStudyMode === "exam" ? "시험 결과 파일이 준비됐습니다." : "학습 기록 파일이 준비됐습니다.";
  const scoreSummary = grading ? ` · 정답 ${grading.correctCount} · 오답 ${grading.wrongCount}` : "";
  elements.completionSummary.textContent = `${examPackage.title} · 답변 ${examPackage.questions.length - unanswered}문제 · 미응답 ${unanswered}문제${scoreSummary}`;
  if (!skipConfirmation) downloadJson(finalResult, resultFilename());
}

function gradeCurrentAttempt() {
  if (!questionBank) return null;
  const bankQuestions = new Map(verifiedQuestions().map((question) => [question.id, question]));
  const items = examPackage.questions.map((question) => {
    const bankQuestion = bankQuestions.get(question.id);
    const selectedChoiceId = state.answers[question.id] || null;
    const isCorrect = bankQuestion?.answer?.choiceId && selectedChoiceId
      ? selectedChoiceId === bankQuestion.answer.choiceId
      : selectedChoiceId === null ? null : false;
    return { questionId: question.id, selectedChoiceId, isCorrect };
  });
  if (items.every((item) => !bankQuestions.has(item.questionId))) return null;
  const correctCount = items.filter((item) => item.isCorrect === true).length;
  const wrongCount = items.filter((item) => item.isCorrect === false).length;
  const unansweredCount = items.filter((item) => item.selectedChoiceId === null).length;
  return {
    items,
    correctCount,
    wrongCount,
    unansweredCount,
    scorePercent: Math.round((correctCount / items.length) * 1000) / 10
  };
}

function updateLearningProgress(grading) {
  if (!grading) return;
  const now = new Date().toISOString();
  const wrongBook = readStoredObject(WRONG_BOOK_KEY);
  const statistics = readStoredObject(QUESTION_STATS_KEY);
  const bankQuestions = new Map(verifiedQuestions().map((question) => [question.id, question]));
  const completedRealExam = activeStudyMode === "exam" && examPackage.mode === "real" && examPackage.questions.length === 100;

  if (activeStudyMode === "exam" && examPackage.mode === "real") {
    const progress = readStoredObject(EXAM_PROGRESS_KEY);
    const previous = progress[examPackage.examId];
    progress[examPackage.examId] = {
      completedCount: (previous?.completedCount || 0) + 1,
      lastCompletedAt: now,
      lastScorePercent: grading.scorePercent
    };
    localStorage.setItem(EXAM_PROGRESS_KEY, JSON.stringify(progress));
  }

  grading.items.forEach((item) => {
    const question = bankQuestions.get(item.questionId);
    const previousStats = statistics[item.questionId] || {};
    const answered = item.selectedChoiceId !== null;
    statistics[item.questionId] = {
      questionId: item.questionId,
      subjectCode: question?.subjectCode || previousStats.subjectCode || "UNKNOWN",
      subject: question?.subject || previousStats.subject || "과목 미상",
      source: question?.source ? {
        examYear: question.source.examYear ?? null,
        examRound: question.source.examRound ?? null,
        examFormat: question.source.examFormat ?? null,
        originalQuestionNumber: question.source.originalQuestionNumber ?? null
      } : previousStats.source || null,
      attemptCount: (previousStats.attemptCount || 0) + 1,
      correctCount: (previousStats.correctCount || 0) + (item.isCorrect === true ? 1 : 0),
      wrongCount: (previousStats.wrongCount || 0) + (item.isCorrect === false ? 1 : 0),
      unansweredCount: (previousStats.unansweredCount || 0) + (!answered ? 1 : 0),
      reviewAttemptCount: (previousStats.reviewAttemptCount || 0) + (activeStudyMode === "wrong" ? 1 : 0),
      reviewCorrectCount: (previousStats.reviewCorrectCount || 0) + (activeStudyMode === "wrong" && item.isCorrect === true ? 1 : 0),
      hintViewCount: (previousStats.hintViewCount || 0) + (state.hintedQuestionIds.includes(item.questionId) ? 1 : 0),
      consecutiveCorrect: item.isCorrect === true ? (previousStats.consecutiveCorrect || 0) + 1 : 0,
      lastAttemptAt: now,
      lastWrongAt: item.isCorrect === false ? now : previousStats.lastWrongAt || null
    };
    if (item.isCorrect === false && (completedRealExam || (activeStudyMode === "wrong" && wrongBook[item.questionId]))) {
      const previous = wrongBook[item.questionId];
      wrongBook[item.questionId] = {
        questionId: item.questionId,
        wrongCount: (previous?.wrongCount || 0) + 1,
        lastWrongAt: now,
        lastExamId: examPackage.examId
      };
    } else if (activeStudyMode === "wrong" && item.isCorrect === true) {
      delete wrongBook[item.questionId];
    }
  });
  localStorage.setItem(WRONG_BOOK_KEY, JSON.stringify(wrongBook));
  localStorage.setItem(QUESTION_STATS_KEY, JSON.stringify(statistics));
  refreshWeaknessControls();
  refreshRoundOptions();
}

function readStoredObject(key) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function buildResult(grading) {
  return {
    schemaVersion: 3,
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
    grading: grading ? {
      correctCount: grading.correctCount,
      wrongCount: grading.wrongCount,
      unansweredCount: grading.unansweredCount,
      scorePercent: grading.scorePercent
    } : null,
    answers: examPackage.questions.map((question, index) => ({
      questionNumber: index + 1,
      questionId: question.id,
      selectedChoiceId: state.answers[question.id] || null,
      flagged: state.flaggedQuestionIds.includes(question.id),
      memo: state.memos[question.id] || null,
      hintViewed: state.hintedQuestionIds.includes(question.id),
      isCorrect: grading?.items.find((item) => item.questionId === question.id)?.isCorrect ?? null
    }))
  };
}

async function initializeCloudSync() {
  const config = window.CBT_SUPABASE_CONFIG;
  if (!window.supabase?.createClient || !config?.url || !config?.publishableKey) {
    elements.syncStatus.textContent = "클라우드 동기화 설정을 불러오지 못했습니다. 로컬 학습은 계속 사용할 수 있습니다.";
    return;
  }

  supabaseClient = window.supabase.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    applySyncUser(session?.user || null);
    if (session?.user) window.setTimeout(() => synchronizeCloudData(false), 0);
  });

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    elements.syncStatus.textContent = `로그인 상태 확인 실패: ${error.message}`;
    return;
  }
  applySyncUser(data.session?.user || null);
  if (data.session?.user) await synchronizeCloudData(false);
}

function applySyncUser(user) {
  currentSyncUser = user;
  elements.authForm.classList.toggle("hidden", Boolean(user));
  elements.signedInActions.classList.toggle("hidden", !user);
  elements.authStatus.textContent = user
    ? `${user.email || "로그인 사용자"} · 완료 결과와 오답 통계를 동기화합니다.`
    : "로그인하면 완료한 응시 결과와 오답 통계를 여러 기기에서 공유합니다.";
}

async function signInForSync(event) {
  event.preventDefault();
  if (!supabaseClient) return;
  elements.syncStatus.textContent = "로그인 중…";
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: elements.authEmail.value.trim(),
    password: elements.authPassword.value
  });
  elements.authPassword.value = "";
  if (error) {
    elements.syncStatus.textContent = `로그인 실패: ${error.message}`;
    return;
  }
  elements.syncStatus.textContent = "로그인했습니다. 저장된 기록을 동기화합니다.";
}

async function signOutFromSync() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.auth.signOut();
  elements.syncStatus.textContent = error ? `로그아웃 실패: ${error.message}` : "로그아웃했습니다. 로컬 기록은 이 기기에 남아 있습니다.";
}

function queueResultForCloudSync(result) {
  if (!result?.grading || result.mode === "development") return;
  const queue = readStoredArray(SYNC_QUEUE_KEY);
  if (!queue.some((item) => item.attemptId === result.attemptId)) queue.push(result);
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
}

async function synchronizeCloudData(announce = true) {
  if (!supabaseClient || !currentSyncUser || syncInProgress) {
    if (announce && !currentSyncUser) elements.syncStatus.textContent = "먼저 로그인해 주세요.";
    return;
  }

  syncInProgress = true;
  elements.syncNow.disabled = true;
  elements.syncStatus.textContent = "클라우드 기록 동기화 중…";
  try {
    const uploadedCount = await flushSyncQueue();
    await pullCloudLearningData();
    const pendingCount = readStoredArray(SYNC_QUEUE_KEY).length;
    elements.syncStatus.textContent = pendingCount
      ? `${pendingCount}개 결과가 기기에 대기 중입니다. 연결이 복구되면 다시 시도합니다.`
      : `${uploadedCount ? `${uploadedCount}개 결과 업로드 · ` : ""}동기화 완료 ${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
  } catch (error) {
    elements.syncStatus.textContent = `동기화 실패: ${error.message} · 결과는 이 기기에 보관되어 있습니다.`;
  } finally {
    syncInProgress = false;
    elements.syncNow.disabled = false;
  }
}

async function flushSyncQueue() {
  const queue = readStoredArray(SYNC_QUEUE_KEY);
  const remaining = [];
  let uploadedCount = 0;
  for (const result of queue) {
    const { error } = await supabaseClient.rpc("ingest_exam_result", { payload: result });
    if (error) remaining.push(result);
    else uploadedCount += 1;
  }
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(remaining));
  if (remaining.length && remaining.length === queue.length) throw new Error("DB에 결과를 저장하지 못했습니다. Supabase 스키마 적용 여부를 확인하세요.");
  return uploadedCount;
}

async function pullCloudLearningData() {
  const [attemptRows, wrongRows, statisticsRows] = await Promise.all([
    fetchAllRows("exam_attempts", "attempt_id,exam_id,mode,study_mode,submitted_at,score_percent", "attempt_id"),
    fetchAllRows("wrong_questions", "question_id,wrong_count,last_wrong_at,last_exam_id", "question_id"),
    fetchAllRows("question_statistics", "question_id,attempt_count,correct_count,wrong_count,unanswered_count,review_attempt_count,review_correct_count,hint_view_count,consecutive_correct,last_attempt_at,last_wrong_at", "question_id")
  ]);
  if (!attemptRows.length) return;

  const wrongBook = Object.fromEntries(wrongRows.map((record) => [record.question_id, {
    questionId: record.question_id,
    wrongCount: record.wrong_count,
    lastWrongAt: record.last_wrong_at,
    lastExamId: record.last_exam_id
  }]));
  localStorage.setItem(WRONG_BOOK_KEY, JSON.stringify(wrongBook));

  const existingStatistics = readStoredObject(QUESTION_STATS_KEY);
  const bankQuestions = new Map(verifiedQuestions().map((question) => [question.id, question]));
  const statistics = Object.fromEntries(statisticsRows.map((record) => {
    const question = bankQuestions.get(record.question_id);
    const existing = existingStatistics[record.question_id] || {};
    return [record.question_id, {
      questionId: record.question_id,
      subjectCode: question?.subjectCode || existing.subjectCode || "UNKNOWN",
      subject: question?.subject || existing.subject || "과목 미상",
      source: question?.source ? {
        examYear: question.source.examYear ?? null,
        examRound: question.source.examRound ?? null,
        examFormat: question.source.examFormat ?? null,
        originalQuestionNumber: question.source.originalQuestionNumber ?? null
      } : existing.source || null,
      attemptCount: record.attempt_count,
      correctCount: record.correct_count,
      wrongCount: record.wrong_count,
      unansweredCount: record.unanswered_count,
      reviewAttemptCount: record.review_attempt_count,
      reviewCorrectCount: record.review_correct_count,
      hintViewCount: record.hint_view_count,
      consecutiveCorrect: record.consecutive_correct,
      lastAttemptAt: record.last_attempt_at,
      lastWrongAt: record.last_wrong_at
    }];
  }));
  localStorage.setItem(QUESTION_STATS_KEY, JSON.stringify(statistics));

  const progress = {};
  // 페이지를 나눠 받는 동안 다른 기기의 업로드로 같은 행이 두 번 올 수 있어 attempt_id로 중복을 제거한다.
  [...new Map(attemptRows.map((attempt) => [attempt.attempt_id, attempt])).values()]
    .filter((attempt) => attempt.study_mode === "exam" && attempt.mode === "real")
    .forEach((attempt) => {
      const previous = progress[attempt.exam_id];
      progress[attempt.exam_id] = {
        completedCount: (previous?.completedCount || 0) + 1,
        lastCompletedAt: !previous || attempt.submitted_at > previous.lastCompletedAt ? attempt.submitted_at : previous.lastCompletedAt,
        lastScorePercent: !previous || attempt.submitted_at > previous.lastCompletedAt ? attempt.score_percent : previous.lastScorePercent
      };
    });
  localStorage.setItem(EXAM_PROGRESS_KEY, JSON.stringify(progress));
  refreshWeaknessControls();
  refreshRoundOptions();
}

// Supabase API는 한 번에 최대 행 수(기본 1000)만 돌려주므로 빈 페이지가 나올 때까지 나눠 받는다.
// 서버의 최대 행 수 설정이 더 작아도 받은 행 수만큼 전진하므로 누락되지 않는다.
async function fetchAllRows(table, columns, orderColumn) {
  const pageSize = 1000;
  const rows = [];
  for (;;) {
    const { data, error } = await supabaseClient
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: true })
      .range(rows.length, rows.length + pageSize - 1);
    if (error) throw error;
    if (!data?.length) return rows;
    rows.push(...data);
  }
}

function readStoredArray(key) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : [];
  } catch {
    return [];
  }
}

async function shareResult() {
  const file = createResultFile();
  if (!navigator.share || !navigator.canShare?.({ files: [file] })) {
    elements.shareMessage.textContent = "이 브라우저에서는 파일 공유를 지원하지 않아 다운로드로 전환했습니다.";
    downloadJson(finalResult, resultFilename());
    return;
  }
  try {
    const resultKind = activeStudyMode === "exam" ? "시험 결과" : "학습 기록";
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
  const prefix = activeStudyMode === "exam" ? "exam-result" : "study-result";
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
