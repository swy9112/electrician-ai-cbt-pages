"use strict";

function createDemoExam() {
  const subjects = ["전기자기학", "전력공학", "전기기기", "회로이론 및 제어공학", "전기설비기술기준"];
  const concepts = [
    ["자계", "정전용량", "전자유도", "벡터", "자성체"],
    ["송전선로", "고장계산", "배전", "발전", "접지"],
    ["변압기", "유도전동기", "동기기", "직류기", "정류기"],
    ["RLC 회로", "라플라스 변환", "제어계", "과도현상", "교류회로"],
    ["전선로", "보호장치", "접지공사", "시설기준", "안전거리"]
  ];

  const questions = Array.from({ length: 100 }, (_, index) => {
    const subjectIndex = Math.floor(index / 20);
    const number = index + 1;
    const concept = concepts[subjectIndex][index % concepts[subjectIndex].length];
    const hasDiagram = number % 10 === 0;
    const stemVariants = [
      `[창작 더미 문제] ${concept}에 관한 설명으로 가장 적절한 것은?`,
      `[창작 더미 문제] ${concept} 계산에서 기준값이 ${number + 10}일 때 적용해야 할 원칙은?`,
      `[창작 더미 문제] 다음 식 V = IR과 관련하여 ${concept}의 해석으로 옳은 것은?`,
      `[창작 더미 문제] f₀ = 1/(2π√LC)를 적용하는 상황에 대한 설명으로 옳은 것은?`
    ];

    return {
      id: `demo.synthetic.${String(number).padStart(3, "0")}`,
      subject: subjects[subjectIndex],
      stem: stemVariants[index % stemVariants.length],
      image: hasDiagram ? createDemoDiagram(number) : null,
      imageAlt: hasDiagram ? `${number}번 창작 회로도 예시` : null,
      choices: [
        { id: "1", text: `${concept}의 기본 정의를 그대로 적용한다.` },
        { id: "2", text: "단위와 기준 방향을 확인한 뒤 계산한다." },
        { id: "3", text: "주어진 조건과 관계없이 항상 같은 값을 사용한다." },
        { id: "4", text: "결과의 차원과 물리적 의미는 확인하지 않는다." }
      ]
    };
  });

  return {
    schemaVersion: 1,
    examId: "prototype-demo-100",
    attemptId: "attempt-demo",
    title: "전기기사 CBT 100문항 프로토타입",
    mode: "development",
    timeLimitMinutes: 150,
    questionCount: questions.length,
    questions
  };
}

function createDemoDiagram(number) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="520" height="230" viewBox="0 0 520 230">
      <rect width="520" height="230" rx="20" fill="#f8fafc"/>
      <path d="M70 115h75m230 0h75" stroke="#172033" stroke-width="4"/>
      <path d="M145 115c12-55 38-55 50 0s38 55 50 0 38-55 50 0 38 55 50 0 38-55 50 0" fill="none" stroke="#2265d8" stroke-width="5"/>
      <path d="M85 80v70m350-70v70" stroke="#172033" stroke-width="4"/>
      <text x="260" y="55" text-anchor="middle" font-family="system-ui" font-size="22" fill="#172033">창작 회로도 ${number}</text>
      <text x="260" y="195" text-anchor="middle" font-family="system-ui" font-size="18" fill="#607089">R = ${number + 5} Ω · V = ${number + 100} V</text>
    </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
