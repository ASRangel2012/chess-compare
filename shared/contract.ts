/**
 * The single source of truth for the /api/analyze wire contract, shared by the
 * client (src/lib) and the server (server/). One definition keeps the two sides
 * from drifting — they previously had divergent PlayerGameAnalysis types (the
 * server's lacked `username` and `commonOpenings`, both of which the client
 * actually sends).
 */

export interface OpeningStats {
  name: string;
  eco: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
}

export interface PlayerGameAnalysis {
  username: string;
  totalGames: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  avgMoveCount: number;
  openingsAsWhite: OpeningStats[];
  openingsAsBlack: OpeningStats[];
  commonOpenings: OpeningStats[];
  gameLengthBuckets: { label: string; count: number }[];
  timeClassBreakdown: Record<string, number>;
}

export interface PlayStyleInsight {
  player1: string;
  player2: string;
  matchup: string;
  /** Deep, directional game plan for how player 1 can beat player 2. */
  gamePlan: string;
}

export interface PlayerRef {
  name: string;
  analysis: PlayerGameAnalysis;
}

export interface AnalyzeBody {
  player1: PlayerRef;
  player2: PlayerRef;
}
