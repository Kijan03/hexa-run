export type Team = 'RED' | 'BLUE' | 'GREEN';

export const TEAMS: Team[] = ['RED', 'BLUE', 'GREEN'];

/** public.users */
export interface User {
  id: string;
  team: Team;
  has_starter_buff: boolean;
}

/** public.hex_tiles */
export interface HexTile {
  h3_index: string;
  owner_team: Team;
  updated_at: string;
}
