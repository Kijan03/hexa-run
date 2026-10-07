import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { latLngToCell } from 'h3-js';
import { supabase } from '../lib/supabase';
import { H3_RESOLUTION } from '../constants/theme';
import type { HexTile, Team } from '../types';

export type PermissionState = 'unknown' | 'granted' | 'denied';
export type RunStatus = 'IDLE' | 'RUNNING' | 'PAUSED';

export interface RunSummary {
  startedAt: string;
  endedAt: string;
  distanceKm: number;
  durationSec: number;
  tilesClaimed: number;
}

export interface TrackerState {
  location: Location.LocationObjectCoords | null;
  currentCell: string | null;
  permission: PermissionState;
  error: string | null;
  status: RunStatus;
  isRecording: boolean;
  distanceKm: number;
  durationSec: number;
  /** 최근 구간 기준 현재 페이스 (초/km). 계산 불가 시 null */
  paceSecPerKm: number | null;
  tilesClaimed: number;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<RunSummary | null>;
}

const MAX_ACCURACY_M = 30;
const MIN_STEP_M = 2;
const MAX_SPEED_MPS = 5.55;
const PACE_WINDOW_MS = 30000;
const PACE_MIN_DISTANCE_M = 15;
const PACE_MIN_SECONDS = 10;
const HISTORY_KEY = 'hexa_run_history';

interface Point {
  latitude: number;
  longitude: number;
  t: number;
}

interface PaceSample {
  t: number;
  d: number;
}

function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 러닝 세션(IDLE / RUNNING / PAUSED)을 관리한다.
 * - 위치 구독은 지도 표시용으로 항상 유지하되, RUNNING일 때만 거리 누적과 타일 점령을 수행한다.
 * - onClaim은 upsert 성공 직후 호출되어 화면이 즉시 갱신되도록 한다.
 */
export function useHexaTracker(
  team: Team | null,
  onClaim?: (tile: HexTile) => void,
): TrackerState {
  const [location, setLocation] = useState<Location.LocationObjectCoords | null>(null);
  const [currentCell, setCurrentCell] = useState<string | null>(null);
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [error, setError] = useState<string | null>(null);

  const [status, setStatusState] = useState<RunStatus>('IDLE');
  const [distanceM, setDistanceM] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [paceSecPerKm, setPaceSecPerKm] = useState<number | null>(null);
  const [tilesClaimed, setTilesClaimed] = useState(0);

  const statusRef = useRef<RunStatus>('IDLE');
  const teamRef = useRef<Team | null>(team);
  const onClaimRef = useRef(onClaim);
  const mountedRef = useRef(true);
  const lastLocationRef = useRef<Location.LocationObject | null>(null);

  const distanceMRef = useRef(0);
  const accumulatedMsRef = useRef(0);
  const segmentStartRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const lastPointRef = useRef<Point | null>(null);
  const samplesRef = useRef<PaceSample[]>([]);
  const lastClaimedRef = useRef<string | null>(null);
  const claimedSetRef = useRef<Set<string>>(new Set());

  teamRef.current = team;
  onClaimRef.current = onClaim;

  const setStatus = useCallback((next: RunStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const getElapsedMs = useCallback((): number => {
    const seg = segmentStartRef.current;
    return accumulatedMsRef.current + (seg !== null ? Date.now() - seg : 0);
  }, []);

  const claim = useCallback(async (h3Index: string) => {
    const currentTeam = teamRef.current;
    if (!currentTeam) return;

    const tile: HexTile = {
      h3_index: h3Index,
      owner_team: currentTeam,
      updated_at: new Date().toISOString(),
    };
    const { error: upsertError } = await supabase
      .from('hex_tiles')
      .upsert(tile, { onConflict: 'h3_index' });

    if (!mountedRef.current) return;
    if (upsertError) {
      // 실패 시 다음 위치 업데이트에서 재시도
      if (lastClaimedRef.current === h3Index) lastClaimedRef.current = null;
      claimedSetRef.current.delete(h3Index);
      setTilesClaimed(claimedSetRef.current.size);
      setError(upsertError.message);
      return;
    }
    setError(null);
    onClaimRef.current?.(tile);
  }, []);

  // RUNNING 상태에서만 호출: 거리/페이스 누적 + 타일 점령
  const processRunPoint = useCallback(
    (loc: Location.LocationObject) => {
      const { latitude, longitude, accuracy } = loc.coords;
      if (accuracy !== null && accuracy > MAX_ACCURACY_M) return;

      const t = loc.timestamp;
      const last = lastPointRef.current;

      // 안티치트: 기기가 보고한 속도 또는 직전 유효 지점 대비 계산 속도가 한도를 넘으면
      // 거리 누적과 타일 점령 모두에서 해당 좌표를 조용히 버린다.
      const reportedSpeed = loc.coords.speed;
      if (reportedSpeed !== null && reportedSpeed > MAX_SPEED_MPS) return;
      if (last) {
        const dtSec = (t - last.t) / 1000;
        if (dtSec > 0 && haversineMeters(last, { latitude, longitude }) / dtSec > MAX_SPEED_MPS) {
          return;
        }
      }

      if (!last) {
        lastPointRef.current = { latitude, longitude, t };
        samplesRef.current = [{ t, d: distanceMRef.current }];
      } else {
        const step = haversineMeters(last, { latitude, longitude });
        const dtSec = (t - last.t) / 1000;
        if (step >= MIN_STEP_M && dtSec > 0) {
          distanceMRef.current += step;
          lastPointRef.current = { latitude, longitude, t };

          const samples = samplesRef.current;
          samples.push({ t, d: distanceMRef.current });
          while (samples.length > 1 && t - samples[0].t > PACE_WINDOW_MS) samples.shift();

          const first = samples[0];
          const windowM = distanceMRef.current - first.d;
          const windowSec = (t - first.t) / 1000;
          if (windowM >= PACE_MIN_DISTANCE_M && windowSec >= PACE_MIN_SECONDS) {
            setPaceSecPerKm(windowSec / (windowM / 1000));
          } else if (distanceMRef.current >= PACE_MIN_DISTANCE_M) {
            setPaceSecPerKm(getElapsedMs() / 1000 / (distanceMRef.current / 1000));
          }
          setDistanceM(distanceMRef.current);
        }
      }

      const cell = latLngToCell(latitude, longitude, H3_RESOLUTION);
      if (lastClaimedRef.current !== cell) {
        lastClaimedRef.current = cell;
        claimedSetRef.current.add(cell);
        setTilesClaimed(claimedSetRef.current.size);
        void claim(cell);
      }
    },
    [claim, getElapsedMs],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 위치 구독 (표시용 상시, 점령/기록은 RUNNING일 때만)
  useEffect(() => {
    if (!team) return;

    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    const begin = async () => {
      const { status: permStatus } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (permStatus !== 'granted') {
        setPermission('denied');
        return;
      }
      setPermission('granted');

      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 3,
          timeInterval: 2000,
        },
        (loc) => {
          lastLocationRef.current = loc;
          setLocation(loc.coords);
          setCurrentCell(
            latLngToCell(loc.coords.latitude, loc.coords.longitude, H3_RESOLUTION),
          );
          if (statusRef.current === 'RUNNING') processRunPoint(loc);
        },
      );

      if (cancelled) {
        sub.remove();
        return;
      }
      subscription = sub;
    };

    begin().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [team, processRunPoint]);

  // RUNNING 중 1초마다 진행 시간 갱신
  useEffect(() => {
    if (status !== 'RUNNING') return;
    const timer = setInterval(() => {
      setDurationSec(Math.floor(getElapsedMs() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [status, getElapsedMs]);

  const resetMetrics = useCallback(() => {
    distanceMRef.current = 0;
    accumulatedMsRef.current = 0;
    segmentStartRef.current = null;
    startedAtRef.current = null;
    lastPointRef.current = null;
    samplesRef.current = [];
    lastClaimedRef.current = null;
    claimedSetRef.current = new Set();
    setDistanceM(0);
    setDurationSec(0);
    setPaceSecPerKm(null);
    setTilesClaimed(0);
  }, []);

  const start = useCallback(() => {
    if (statusRef.current !== 'IDLE' || !teamRef.current) return;
    resetMetrics();
    const now = Date.now();
    startedAtRef.current = now;
    segmentStartRef.current = now;
    setStatus('RUNNING');

    // 시작 지점 타일을 즉시 점령하고 거리 계산의 기준점으로 삼는다
    const lastLoc = lastLocationRef.current;
    if (lastLoc) processRunPoint({ ...lastLoc, timestamp: now });
  }, [processRunPoint, resetMetrics, setStatus]);

  const pause = useCallback(() => {
    if (statusRef.current !== 'RUNNING') return;
    accumulatedMsRef.current = getElapsedMs();
    segmentStartRef.current = null;
    // 일시정지 구간의 이동이 거리에 섞이지 않도록 기준점을 끊는다
    lastPointRef.current = null;
    samplesRef.current = [];
    setDurationSec(Math.floor(accumulatedMsRef.current / 1000));
    setStatus('PAUSED');
  }, [getElapsedMs, setStatus]);

  const resume = useCallback(() => {
    if (statusRef.current !== 'PAUSED') return;
    const now = Date.now();
    segmentStartRef.current = now;
    setStatus('RUNNING');

    const lastLoc = lastLocationRef.current;
    if (lastLoc) processRunPoint({ ...lastLoc, timestamp: now });
  }, [processRunPoint, setStatus]);

  const stop = useCallback(async (): Promise<RunSummary | null> => {
    if (statusRef.current === 'IDLE') return null;

    const elapsedMs = getElapsedMs();
    const startedAt = startedAtRef.current ?? Date.now() - elapsedMs;
    const summary: RunSummary = {
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date().toISOString(),
      distanceKm: distanceMRef.current / 1000,
      durationSec: Math.floor(elapsedMs / 1000),
      tilesClaimed: claimedSetRef.current.size,
    };

    setStatus('IDLE');
    resetMetrics();

    try {
      const raw = await AsyncStorage.getItem(HISTORY_KEY);
      const history: RunSummary[] = raw ? (JSON.parse(raw) as RunSummary[]) : [];
      history.push(summary);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : '기록 저장에 실패했습니다.');
      }
    }
    return summary;
  }, [getElapsedMs, resetMetrics, setStatus]);

  return {
    location,
    currentCell,
    permission,
    error,
    status,
    isRecording: status === 'RUNNING',
    distanceKm: distanceM / 1000,
    durationSec,
    paceSecPerKm,
    tilesClaimed,
    start,
    pause,
    resume,
    stop,
  };
}
