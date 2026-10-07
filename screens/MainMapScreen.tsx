import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE, Polygon, type LatLng } from 'react-native-maps';
import { cssInterop } from 'nativewind';
import { cellToBoundary, gridDisk } from 'h3-js';
import { supabase } from '../lib/supabase';
import { AnimatedView } from '../lib/animated';
import { useHexaTracker } from '../hooks/useHexaTracker';
import { CREW_CLASSES, CREW_INFO } from '../constants/crews';
import {
  COLORS,
  DARK_MAP_STYLE,
  TEAM_FILL,
  TEAM_SOLID,
  VIEW_RADIUS_K,
} from '../constants/theme';
import type { HexTile, Team } from '../types';

interface Props {
  team: Team;
}

cssInterop(MapView, { className: 'style' });

const REFRESH_MS = 5000;
const STOP_HOLD_MS = 1200;

const boundaryCache = new Map<string, LatLng[]>();

function getBoundary(h3Index: string): LatLng[] {
  let coords = boundaryCache.get(h3Index);
  if (!coords) {
    coords = cellToBoundary(h3Index, false).map(([latitude, longitude]) => ({
      latitude,
      longitude,
    }));
    boundaryCache.set(h3Index, coords);
  }
  return coords;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

function formatPace(secPerKm: number | null): string {
  if (secPerKm === null || !isFinite(secPerKm) || secPerKm > 99 * 60) return "--'--\"";
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}'${pad2(total % 60)}"`;
}

export default function MainMapScreen({ team }: Props) {
  const [tiles, setTiles] = useState<Record<string, HexTile>>({});
  const mapRef = useRef<MapView>(null);
  const centeredRef = useRef(false);
  const holdAnim = useRef(new Animated.Value(0)).current;

  const handleClaim = useCallback((tile: HexTile) => {
    setTiles((prev) => ({ ...prev, [tile.h3_index]: tile }));
  }, []);

  const {
    location,
    currentCell,
    permission,
    error,
    status,
    distanceKm,
    durationSec,
    paceSecPerKm,
    tilesClaimed,
    start,
    pause,
    resume,
    stop,
  } = useHexaTracker(team, handleClaim);

  const fetchNearby = useCallback(async (center: string) => {
    const ids = gridDisk(center, VIEW_RADIUS_K);
    const { data, error: fetchError } = await supabase
      .from('hex_tiles')
      .select('h3_index, owner_team, updated_at')
      .in('h3_index', ids);
    if (fetchError || !data) return;

    const next: Record<string, HexTile> = {};
    for (const row of data as HexTile[]) next[row.h3_index] = row;
    setTiles((prev) => {
      const merged = { ...next };
      for (const id of Object.keys(prev)) {
        const local = prev[id];
        const remote = merged[id];
        if (!remote || remote.updated_at < local.updated_at) merged[id] = local;
      }
      return merged;
    });
  }, []);

  useEffect(() => {
    if (!currentCell) return;
    void fetchNearby(currentCell);
    const timer = setInterval(() => void fetchNearby(currentCell), REFRESH_MS);
    return () => clearInterval(timer);
  }, [currentCell, fetchNearby]);

  useEffect(() => {
    if (!location || centeredRef.current) return;
    centeredRef.current = true;
    mapRef.current?.animateToRegion(
      {
        latitude: location.latitude,
        longitude: location.longitude,
        latitudeDelta: 0.004,
        longitudeDelta: 0.004,
      },
      500,
    );
  }, [location]);

  useEffect(() => {
    if (status !== 'RUNNING' || !location) return;
    mapRef.current?.animateCamera(
      { center: { latitude: location.latitude, longitude: location.longitude } },
      { duration: 500 },
    );
  }, [status, location]);

  const visibleTiles = useMemo(() => {
    if (!currentCell) return [] as HexTile[];
    const near = new Set(gridDisk(currentCell, VIEW_RADIUS_K));
    return Object.values(tiles).filter((t) => near.has(t.h3_index));
  }, [tiles, currentCell]);

  const handleStop = useCallback(async () => {
    holdAnim.setValue(0);
    const summary = await stop();
    if (!summary) return;
    Alert.alert(
      '러닝 완료',
      `거리 ${summary.distanceKm.toFixed(2)} km\n` +
        `시간 ${formatDuration(summary.durationSec)}\n` +
        `점령한 타일 ${summary.tilesClaimed}개\n\n기록이 기기에 저장되었습니다.`,
    );
  }, [holdAnim, stop]);

  const onStopPressIn = useCallback(() => {
    holdAnim.setValue(0);
    Animated.timing(holdAnim, {
      toValue: 1,
      duration: STOP_HOLD_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, [holdAnim]);

  const onStopPressOut = useCallback(() => {
    holdAnim.stopAnimation();
    holdAnim.setValue(0);
  }, [holdAnim]);

  if (permission === 'denied') {
    return (
      <View className="flex-1 items-center justify-center bg-bg p-6">
        <Text className="text-center text-base text-white">
          위치 권한이 필요합니다. 설정에서 권한을 허용해 주세요.
        </Text>
      </View>
    );
  }

  const crew = CREW_CLASSES[team];
  const holdWidth = holdAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const statusLabel = status === 'RUNNING' ? '러닝 중' : '일시 정지';

  return (
    <View className="flex-1 bg-bg">
      <MapView
        ref={mapRef}
        className="absolute inset-0"
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        customMapStyle={DARK_MAP_STYLE}
        userInterfaceStyle="dark"
        showsUserLocation
        showsMyLocationButton={status === 'IDLE'}
        rotateEnabled={false}
        initialRegion={{
          latitude: 37.5665,
          longitude: 126.978,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        {visibleTiles.map((tile) => (
          <Polygon
            key={`${tile.h3_index}-${tile.owner_team}`}
            coordinates={getBoundary(tile.h3_index)}
            fillColor={TEAM_FILL[tile.owner_team]}
            strokeColor={TEAM_SOLID[tile.owner_team]}
            strokeWidth={1}
          />
        ))}
      </MapView>

      {status === 'IDLE' && (
        <View className="absolute left-0 right-0 top-14 items-center" pointerEvents="none">
          <View className="flex-row items-center rounded-full bg-bg/90 px-4 py-2">
            <View className={`mr-2 h-2.5 w-2.5 rounded-full ${crew.bg}`} />
            <Text className="text-sm font-bold text-white">{CREW_INFO[team].name} 크루</Text>
          </View>
        </View>
      )}

      {status !== 'IDLE' && (
        <View className="absolute left-4 right-4 top-14 rounded-3xl bg-bg/90 px-5 pb-5 pt-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center">
              <View className={`mr-2 h-2.5 w-2.5 rounded-full ${crew.bg}`} />
              <Text className="text-sm font-bold text-white">
                {CREW_INFO[team].name} · {statusLabel}
              </Text>
            </View>
            <Text className="text-sm font-bold text-muted">타일 {tilesClaimed}</Text>
          </View>

          <Text className="mt-2 text-center text-6xl font-black text-white tabular-nums">
            {formatDuration(durationSec)}
          </Text>
          <Text className="text-center text-xs font-semibold text-muted">시간</Text>

          <View className="mt-4 flex-row">
            <View className="flex-1 items-center">
              <Text className={`text-4xl font-black tabular-nums ${crew.text}`}>
                {distanceKm.toFixed(2)}
              </Text>
              <Text className="mt-1 text-xs font-semibold text-muted">거리 (km)</Text>
            </View>
            <View className="w-px bg-line" />
            <View className="flex-1 items-center">
              <Text className="text-4xl font-black text-white tabular-nums">
                {formatPace(paceSecPerKm)}
              </Text>
              <Text className="mt-1 text-xs font-semibold text-muted">페이스 (/km)</Text>
            </View>
          </View>
        </View>
      )}

      {!location && (
        <View className="absolute left-0 right-0 top-1/3 items-center" pointerEvents="none">
          <View className="items-center rounded-2xl bg-surface px-6 py-4">
            <ActivityIndicator color={COLORS.text} />
            <Text className="mt-2 text-sm text-white">GPS 신호를 찾는 중…</Text>
          </View>
        </View>
      )}

      <View className="absolute bottom-11 left-0 right-0 items-center" pointerEvents="box-none">
        {status === 'IDLE' && (
          <Pressable
            disabled={!location}
            onPress={start}
            className={`rounded-full px-12 py-5 active:opacity-80 ${crew.bg} ${
              !location ? 'opacity-40' : ''
            }`}
          >
            <Text className={`text-xl font-black ${crew.onBg}`}>🏃‍♂️ 러닝 시작</Text>
          </Pressable>
        )}

        {status === 'RUNNING' && (
          <Pressable
            onPress={pause}
            className="h-24 w-24 items-center justify-center rounded-full border-2 border-white/30 bg-bg/90 active:opacity-70"
          >
            <Text className="text-3xl">⏸️</Text>
            <Text className="mt-0.5 text-xs font-bold text-white">일시 정지</Text>
          </Pressable>
        )}

        {status === 'PAUSED' && (
          <View className="flex-row items-center px-4">
            <Pressable
              onPress={resume}
              className={`mr-4 rounded-full px-7 py-5 active:opacity-80 ${crew.bg}`}
            >
              <Text className={`text-lg font-black ${crew.onBg}`}>▶️ 다시 시작</Text>
            </Pressable>

            <Pressable
              delayLongPress={STOP_HOLD_MS}
              onPressIn={onStopPressIn}
              onPressOut={onStopPressOut}
              onLongPress={() => void handleStop()}
              className="overflow-hidden rounded-full border-2 border-pulse bg-bg/90 px-6 py-5"
            >
              <AnimatedView
                className="absolute bottom-0 left-0 top-0 bg-pulse/50"
                style={{ width: holdWidth }}
              />
              <Text className="text-base font-extrabold text-white">⏹️ 길게 눌러 종료</Text>
            </Pressable>
          </View>
        )}
      </View>

      {error && (
        <View className="absolute bottom-2 left-4 right-4 rounded-xl bg-surface p-2.5">
          <Text className="text-xs text-pulse">{error}</Text>
        </View>
      )}
    </View>
  );
}
