import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Scores } from '../constants/crews';
import { TEAMS, type Team, type User } from '../types';

export type CrewCounts = Record<Team, number>;

interface CrewCountRow {
  team: string;
  member_count: number | string;
}

export interface ScoutOffer {
  /** 유저의 2순위이면서 인원이 가장 부족한 크루 */
  crew: Team;
}

/**
 * FIRST_IS_UNDERDOG: 1순위 크루가 인원 최소 → 단일 합류 버튼
 * SCOUT: 2순위 크루가 인원 최소(1순위는 아님) → 스카우트 제안 + 일반 버튼
 * PLAIN: 그 외 → 1순위 합류 버튼만 (제안 없음)
 */
export type ResultKind = 'FIRST_IS_UNDERDOG' | 'SCOUT' | 'PLAIN';

export interface AnalysisResult {
  scores: Scores;
  /** 점수 높은 순 (동점은 무작위) */
  ranking: Team[];
  counts: CrewCounts;
  first: Team;
  kind: ResultKind;
  scout: ScoutOffer | null;
}

function isTeam(value: string): value is Team {
  return (TEAMS as string[]).includes(value);
}

/** 점수 내림차순 정렬. 동점은 무작위 순서로 결정한다. */
export function rankCrews(scores: Scores, random: () => number = Math.random): Team[] {
  const shuffled = [...TEAMS];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.sort((a, b) => scores[b] - scores[a]);
}

/** 인원이 가장 적은 크루(동점이면 모두 후보)를 기준으로 결과 유형을 정한다. 스카우트는 2순위만 제안한다. */
export function classifyResult(
  ranking: Team[],
  counts: CrewCounts,
): { kind: ResultKind; scout: ScoutOffer | null } {
  const min = Math.min(...TEAMS.map((t) => counts[t]));
  const underdogs = TEAMS.filter((t) => counts[t] === min);

  if (underdogs.includes(ranking[0])) return { kind: 'FIRST_IS_UNDERDOG', scout: null };
  if (underdogs.includes(ranking[1])) return { kind: 'SCOUT', scout: { crew: ranking[1] } };
  return { kind: 'PLAIN', scout: null };
}

export interface CrewAssignment {
  /** 누적 점수로 순위를 계산하고 크루별 인원수를 조회해 결과를 만든다. DB는 수정하지 않는다. */
  analyze: (scores: Scores) => Promise<AnalysisResult>;
  /** 유저가 고른 크루를 저장한다. 스카우트 수락 시 시작 버프 플래그를 켠다. */
  confirmCrew: (team: Team, acceptedScout: boolean) => Promise<void>;
  isAnalyzing: boolean;
  isConfirming: boolean;
  error: string | null;
}

export function useCrewAssignment(userId: string): CrewAssignment {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async (scores: Scores): Promise<AnalysisResult> => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const ranking = rankCrews(scores);

      const { data, error: rpcError } = await supabase.rpc('get_crew_counts');
      if (rpcError) throw new Error(rpcError.message);

      const counts: CrewCounts = { RED: 0, BLUE: 0, GREEN: 0 };
      for (const row of (data ?? []) as CrewCountRow[]) {
        if (isTeam(row.team)) counts[row.team] = Number(row.member_count);
      }

      return {
        scores,
        ranking,
        counts,
        first: ranking[0],
        ...classifyResult(ranking, counts),
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      throw e instanceof Error ? e : new Error(message);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const confirmCrew = useCallback(
    async (team: Team, acceptedScout: boolean): Promise<void> => {
      setIsConfirming(true);
      setError(null);
      try {
        const row: User = { id: userId, team, has_starter_buff: acceptedScout };
        const { error: upsertError } = await supabase
          .from('users')
          .upsert(row, { onConflict: 'id' });
        if (upsertError) throw new Error(upsertError.message);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        throw e instanceof Error ? e : new Error(message);
      } finally {
        setIsConfirming(false);
      }
    },
    [userId],
  );

  return { analyze, confirmCrew, isAnalyzing, isConfirming, error };
}
