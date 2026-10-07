import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, Text, View } from 'react-native';
import { useCrewAssignment, type AnalysisResult } from '../hooks/useCrewAssignment';
import {
  CREW_CLASSES,
  CREW_INFO,
  QUESTIONS,
  applyWeights,
  emptyScores,
  type Scores,
} from '../constants/crews';
import { COLORS } from '../constants/theme';
import { AnimatedView } from '../lib/animated';
import { TEAMS, type Team } from '../types';

interface Props {
  userId: string;
  onComplete: (team: Team) => void;
}

type Phase = 'quiz' | 'analyzing' | 'result' | 'error';
type Choice = 'primary' | 'scout';

const FAKE_LOADING_MS = 3000;
const ANALYZING_STEPS = [
  '답변 가중치 계산 중…',
  '크루 성향 순위 산출 중…',
  '크루별 인원 현황 확인 중…',
];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function crewLabel(team: Team): string {
  return `${CREW_INFO[team].name} 크루`;
}

export default function OnboardingScreen({ userId, onComplete }: Props) {
  const { analyze, confirmCrew, isConfirming } = useCrewAssignment(userId);

  const [phase, setPhase] = useState<Phase>('quiz');
  const [step, setStep] = useState(0);
  const [scores, setScores] = useState<Scores>(emptyScores());
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analyzingText, setAnalyzingText] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pendingChoice, setPendingChoice] = useState<Choice | null>(null);

  const mountedRef = useRef(true);
  const cardAnim = useRef(new Animated.Value(1)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const resultAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const showCard = useCallback(() => {
    cardAnim.setValue(0);
    Animated.timing(cardAnim, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [cardAnim]);

  // 3초 로딩 연출과 실제 분석(순위 계산 + 인원 조회)을 동시에 실행
  const runAnalysis = useCallback(
    async (finalScores: Scores) => {
      setPhase('analyzing');
      setError(null);
      setAnalyzingText(0);
      progress.setValue(0);

      Animated.timing(progress, {
        toValue: 1,
        duration: FAKE_LOADING_MS,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: false,
      }).start();

      try {
        const [analysis] = await Promise.all([analyze(finalScores), wait(FAKE_LOADING_MS)]);
        if (!mountedRef.current) return;
        setResult(analysis);
        resultAnim.setValue(0);
        setPhase('result');
        Animated.timing(resultAnim, {
          toValue: 1,
          duration: 400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      } catch (e) {
        if (!mountedRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      }
    },
    [analyze, progress, resultAnim],
  );

  const onAnswer = useCallback(
    (optionIndex: number) => {
      const option = QUESTIONS[step].options[optionIndex];
      const nextScores = applyWeights(scores, option.weights);
      setScores(nextScores);
      setError(null);

      if (step >= QUESTIONS.length - 1) {
        void runAnalysis(nextScores);
        return;
      }
      Animated.timing(cardAnim, {
        toValue: 0,
        duration: 140,
        useNativeDriver: true,
      }).start(() => {
        if (!mountedRef.current) return;
        setStep((s) => s + 1);
        showCard();
      });
    },
    [cardAnim, runAnalysis, scores, showCard, step],
  );

  useEffect(() => {
    if (phase !== 'analyzing') return;
    const textTimer = setInterval(() => {
      setAnalyzingText((i) => (i + 1) % ANALYZING_STEPS.length);
    }, 900);
    return () => clearInterval(textTimer);
  }, [phase]);

  const onChoose = useCallback(
    async (choice: Choice) => {
      if (!result || isConfirming) return;
      const team = choice === 'scout' && result.scout ? result.scout.crew : result.first;
      setPendingChoice(choice);
      setError(null);
      try {
        await confirmCrew(team, choice === 'scout');
        onComplete(team);
      } catch (e) {
        if (mountedRef.current) {
          setError(e instanceof Error ? e.message : String(e));
          setPendingChoice(null);
        }
      }
    },
    [confirmCrew, isConfirming, onComplete, result],
  );

  const retryAnalysis = useCallback(() => {
    void runAnalysis(scores);
  }, [runAnalysis, scores]);

  if (phase === 'analyzing') {
    const barWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        <ActivityIndicator size="large" color={COLORS.text} />
        <Text className="mt-8 text-2xl font-extrabold text-white">러닝 DNA 분석 중...</Text>
        <Text className="mt-3 h-5 text-sm text-muted">{ANALYZING_STEPS[analyzingText]}</Text>
        <View className="mt-8 h-1 w-3/4 overflow-hidden rounded-full bg-line">
          <AnimatedView className="h-full bg-white" style={{ width: barWidth }} />
        </View>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-6">
        <Text className="mb-5 text-xl font-black tracking-[6px] text-white">HEXA RUN</Text>
        <Text className="text-lg font-extrabold text-white">분석 결과를 불러오지 못했어요</Text>
        <Text className="mt-3 text-center text-sm text-pulse">{error}</Text>
        <Pressable
          onPress={retryAnalysis}
          className="mt-6 rounded-2xl border border-line bg-surface px-9 py-4 active:opacity-70"
        >
          <Text className="text-base font-bold text-white">다시 시도</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'result' && result) {
    const { first, scout, kind, scores: finalScores, counts } = result;
    const firstStyle = CREW_CLASSES[first];
    const translateY = resultAnim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] });
    const maxScore = Math.max(1, ...TEAMS.map((t) => finalScores[t]));
    const minCount = Math.min(...TEAMS.map((t) => counts[t]));
    const scoutStyle = scout ? CREW_CLASSES[scout.crew] : null;

    return (
      <ScrollView
        className="flex-1 bg-bg"
        contentContainerClassName="grow justify-center px-5 py-14"
        showsVerticalScrollIndicator={false}
      >
        <AnimatedView
          className="items-center rounded-3xl border border-line bg-surface px-6 py-8"
          style={{ opacity: resultAnim, transform: [{ translateY }] }}
        >
          <Text className="text-xs font-bold tracking-[3px] text-muted">YOUR RUNNING DNA</Text>

          <View className="mt-5 flex-row items-center">
            <Text className="mr-3 text-3xl">{CREW_INFO[first].icon}</Text>
            <Text className={`text-4xl font-black tracking-widest ${firstStyle.text}`}>
              {CREW_INFO[first].name.toUpperCase()}
            </Text>
          </View>
          <Text className="mt-2 text-sm text-muted">{CREW_INFO[first].tagline}</Text>

          {kind === 'FIRST_IS_UNDERDOG' && (
            <Text className="mt-6 text-center text-base leading-7 text-white">
              당신의 1순위 성향은{' '}
              <Text className={`font-black ${firstStyle.text}`}>[{crewLabel(first)}]</Text>
              입니다! 마침{' '}
              <Text className={`font-black ${firstStyle.text}`}>[{crewLabel(first)}]</Text>가
              당신의 힘을 절실히 필요로 하고 있습니다.
            </Text>
          )}
          {kind === 'SCOUT' && scout && scoutStyle && (
            <Text className="mt-6 text-center text-base leading-7 text-white">
              당신의 1순위 성향은{' '}
              <Text className={`font-black ${firstStyle.text}`}>[{crewLabel(first)}]</Text>
              입니다. 하지만 현재 당신의 2순위 성향인{' '}
              <Text className={`font-black ${scoutStyle.text}`}>[{crewLabel(scout.crew)}]</Text>가
              영토 방어에 어려움을 겪고 있어, 당신을 간절히 스카우트하고 싶어 합니다!
            </Text>
          )}
          {kind === 'PLAIN' && (
            <Text className="mt-6 text-center text-base leading-7 text-white">
              당신의 1순위 성향은{' '}
              <Text className={`font-black ${firstStyle.text}`}>[{crewLabel(first)}]</Text>
              입니다. 달리는 스타일이 가장 잘 맞는 크루예요.
            </Text>
          )}

          <View className="mt-7 w-full">
            {TEAMS.map((t) => (
              <View key={t} className="mb-3 flex-row items-center">
                <Text className="w-20 text-sm font-bold text-white">
                  {CREW_INFO[t].icon} {CREW_INFO[t].name}
                </Text>
                <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                  <View
                    className={`h-full rounded-full ${CREW_CLASSES[t].bg}`}
                    style={{ width: `${(finalScores[t] / maxScore) * 100}%` }}
                  />
                </View>
                <Text className="w-6 text-right text-sm font-extrabold text-white">
                  {finalScores[t]}
                </Text>
                <Text
                  className={`w-14 text-right text-[10px] font-bold ${
                    counts[t] === minCount ? 'text-muted' : 'text-transparent'
                  }`}
                >
                  인원 부족
                </Text>
              </View>
            ))}
          </View>
        </AnimatedView>

        {error && <Text className="mt-4 text-center text-sm text-pulse">{error}</Text>}

        {kind !== 'SCOUT' || !scout || !scoutStyle ? (
          <Pressable
            disabled={isConfirming}
            onPress={() => void onChoose('primary')}
            className={`mt-6 items-center rounded-full px-4 py-5 active:opacity-80 ${firstStyle.bg} ${
              isConfirming ? 'opacity-50' : ''
            }`}
          >
            <Text className={`text-center text-lg font-black ${firstStyle.onBg}`}>
              {isConfirming
                ? '합류 중…'
                : `${CREW_INFO[first].icon} 1순위 ${CREW_INFO[first].name} 크루 합류하기`}
            </Text>
          </Pressable>
        ) : (
          <View className="mt-6">
            <Pressable
              disabled={isConfirming}
              onPress={() => void onChoose('scout')}
              className={`items-center rounded-3xl px-5 py-5 active:opacity-80 ${scoutStyle.bg} ${
                isConfirming && pendingChoice !== 'scout' ? 'opacity-40' : ''
              }`}
            >
              <Text className={`text-[11px] font-black tracking-[2px] ${scoutStyle.onBg}`}>
                SPECIAL OFFER
              </Text>
              <Text className={`mt-1 text-center text-base font-black leading-6 ${scoutStyle.onBg}`}>
                {pendingChoice === 'scout' && isConfirming
                  ? '합류 중…'
                  : `🎁 스카우트: 2순위 ${CREW_INFO[scout.crew].name} 크루 수락하고 '초기 러닝 부스트' 받기`}
              </Text>
            </Pressable>

            <Pressable
              disabled={isConfirming}
              onPress={() => void onChoose('primary')}
              className={`mt-3 items-center rounded-3xl border border-line bg-surface px-5 py-4 active:opacity-80 ${
                isConfirming && pendingChoice !== 'primary' ? 'opacity-40' : ''
              }`}
            >
              <Text className="text-center text-base font-bold text-white">
                {pendingChoice === 'primary' && isConfirming
                  ? '합류 중…'
                  : `일반: 1순위 ${CREW_INFO[first].name} 크루로 시작하기`}
              </Text>
            </Pressable>

            <Text className="mt-4 text-center text-xs leading-5 text-muted">
              선택은 자유입니다. 어느 쪽을 골라도 불이익은 없으며, 부스트는 스카우트를 수락할 때만 지급돼요.
            </Text>
          </View>
        )}
      </ScrollView>
    );
  }

  const question = QUESTIONS[step];
  const translateY = cardAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });

  return (
    <View className="flex-1 items-center justify-center bg-bg px-5">
      <Text className="mb-5 text-xl font-black tracking-[6px] text-white">HEXA RUN</Text>

      <View className="mb-6 flex-row">
        {QUESTIONS.map((q, i) => (
          <View
            key={q.id}
            className={`mx-1 h-1 w-9 rounded-full ${i <= step ? 'bg-white' : 'bg-line'}`}
          />
        ))}
      </View>

      <AnimatedView
        className="w-full rounded-3xl border border-line bg-surface p-6"
        style={{ opacity: cardAnim, transform: [{ translateY }] }}
      >
        <Text className="text-xs font-bold tracking-[2px] text-muted">
          Q{step + 1} / {QUESTIONS.length}
        </Text>
        <Text className="mb-6 mt-3 text-2xl font-extrabold leading-8 text-white">
          {question.title}
        </Text>
        {question.options.map((option, index) => (
          <Pressable
            key={option.label}
            onPress={() => onAnswer(index)}
            className="mb-3 rounded-2xl border border-line bg-bg px-5 py-4 active:border-white active:bg-line"
          >
            <Text className="text-base font-semibold text-white">{option.label}</Text>
          </Pressable>
        ))}
      </AnimatedView>
    </View>
  );
}
