import type { Team } from '../types';

export const H3_RESOLUTION = 11;

/** 타일 렌더링/조회 반경 (gridDisk k). res 11 기준 약 400m */
export const VIEW_RADIUS_K = 15;

export const COLORS = {
  bg: '#121214',
  surface: '#1C1C1E',
  line: '#2C2C2E',
  text: '#FFFFFF',
  muted: '#A0A0A5',
} as const;

export const TEAM_FILL: Record<Team, string> = {
  RED: 'rgba(255, 59, 48, 0.5)',
  BLUE: 'rgba(0, 122, 255, 0.5)',
  GREEN: 'rgba(57, 255, 20, 0.45)',
};

export const TEAM_SOLID: Record<Team, string> = {
  RED: '#FF3B30',
  BLUE: '#007AFF',
  GREEN: '#39FF14',
};

export const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#17171a' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7d7d85' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#17171a' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#2a2a2f' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#25252a' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#17171a' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#33333a' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d0d10' }] },
];
