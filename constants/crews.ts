import { TEAMS, type Team } from '../types';

export interface CrewInfo {
  team: Team;
  name: string;
  tagline: string;
  icon: string;
}

export const CREW_INFO: Record<Team, CrewInfo> = {
  RED: { team: 'RED', name: 'Pulse', tagline: '뜨거운 템포의 크루', icon: '⚡' },
  BLUE: { team: 'BLUE', name: 'Flow', tagline: '물 흐르듯 꾸준한 크루', icon: '🌊' },
  GREEN: { team: 'GREEN', name: 'Surge', tagline: '폭발적으로 질주하는 크루', icon: '🔥' },
};

/** NativeWind는 클래스 문자열을 정적으로 스캔하므로 크루별 클래스를 전체 문자열로 정의한다. */
export interface CrewClasses {
  text: string;
  bg: string;
  border: string;
  onBg: string;
}

export const CREW_CLASSES: Record<Team, CrewClasses> = {
  RED: { text: 'text-pulse', bg: 'bg-pulse', border: 'border-pulse', onBg: 'text-white' },
  BLUE: { text: 'text-flow', bg: 'bg-flow', border: 'border-flow', onBg: 'text-white' },
  GREEN: { text: 'text-surge', bg: 'bg-surge', border: 'border-surge', onBg: 'text-bg' },
};

export type Scores = Record<Team, number>;

export interface QuestionOption {
  label: string;
  weights: Partial<Record<Team, number>>;
}

export interface Question {
  id: string;
  title: string;
  options: QuestionOption[];
}

// Pulse = RED, Flow = BLUE, Surge = GREEN
export const QUESTIONS: Question[] = [
  {
    id: 'time',
    title: '언제 달리는 것을 가장 좋아하시나요?',
    options: [
      { label: '새벽의 상쾌함', weights: { BLUE: 2, RED: 1 } },
      { label: '노을 지는 저녁', weights: { RED: 2, GREEN: 1 } },
      { label: '고요한 심야', weights: { GREEN: 2, BLUE: 1 } },
    ],
  },
  {
    id: 'reason',
    title: '달리는 가장 큰 이유는 무엇인가요?',
    options: [
      { label: '다이어트와 건강', weights: { BLUE: 2 } },
      { label: '스트레스 해소', weights: { GREEN: 2 } },
      { label: '한계 돌파', weights: { RED: 2 } },
    ],
  },
  {
    id: 'vibe',
    title: '달릴 때 어떤 바이브를 선호하시나요?',
    options: [
      { label: '신나는 비트', weights: { RED: 2, GREEN: 1 } },
      { label: '잔잔한 음악', weights: { BLUE: 2 } },
      { label: '오로지 내 숨소리', weights: { GREEN: 2, RED: 1 } },
    ],
  },
];

export function emptyScores(): Scores {
  return { RED: 0, BLUE: 0, GREEN: 0 };
}

/** 선택한 답변의 가중치를 현재 점수에 더한 새 점수를 반환한다. */
export function applyWeights(
  scores: Scores,
  weights: Partial<Record<Team, number>>,
): Scores {
  const next = { ...scores };
  for (const team of TEAMS) next[team] += weights[team] ?? 0;
  return next;
}
