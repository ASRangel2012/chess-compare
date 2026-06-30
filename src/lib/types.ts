export interface ChessPlayerProfile {
  username: string;
  player_id: number;
  title?: string;
  name?: string;
  country?: string;
  joined: number;
  status: string;
  followers: number;
  avatar?: string;
  url: string;
}

export interface RatingEntry {
  last?: { rating: number; date: number; rd?: number };
  best?: { rating: number; date: number; game?: string };
  record?: { win: number; loss: number; draw: number };
}

export interface ChessPlayerStats {
  chess_bullet?: RatingEntry;
  chess_blitz?: RatingEntry;
  chess_rapid?: RatingEntry;
  chess_daily?: RatingEntry;
  fide?: number;
  tactics?: { highest?: { rating: number }; lowest?: { rating: number } };
  puzzle_rush?: { best?: { score: number; total_attempts: number } };
}

export interface GamePlayer {
  username: string;
  rating?: number;
  result: "win" | "lose" | "draw" | "checkmated" | "resigned" | "timeout" | "abandoned" | "agreed" | "repetition" | "stalemate" | "insufficient" | "50move" | "timevsinsufficient";
}

export interface ChessGame {
  url: string;
  pgn: string;
  time_control?: string;
  end_time: number;
  rated: boolean;
  white: GamePlayer;
  black: GamePlayer;
  eco?: string;
  time_class?: string;
  rules?: string;
}

export interface ArchivesResponse {
  archives: string[];
}

export interface GamesResponse {
  games: ChessGame[];
}

export type TimeClass = "bullet" | "blitz" | "rapid" | "daily";

export interface ParsedGame {
  eco: string;
  opening: string;
  color: "white" | "black";
  result: "win" | "loss" | "draw";
  moveCount: number;
  timeControl: string;
  timeClass: string;
  rated: boolean;
  endTime: number;
  opponent: string;
  accuracy?: number;
}

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

export interface StatRow {
  label: string;
  player1: string | number;
  player2: string | number;
  highlight?: "player1" | "player2" | "none";
}

export interface PlayStyleInsight {
  player1: string;
  player2: string;
  matchup: string;
}

export interface HeadToHeadGameEntry {
  url: string;
  date: number;
  opening: string;
  eco: string;
  timeClass: string;
  rated: boolean;
  player1Color: "white" | "black";
  player1Result: "win" | "loss" | "draw";
  player1Rating?: number;
  player2Rating?: number;
  moveCount: number;
  /** Raw PGN, retained so the game can be replayed on an inline board. */
  pgn: string;
}

export interface HeadToHeadSummary {
  totalGames: number;
  player1Wins: number;
  player1Losses: number;
  player1Draws: number;
  player2Wins: number;
  player2Losses: number;
  player2Draws: number;
  games: HeadToHeadGameEntry[];
}

export interface CompareState {
  loading: boolean;
  error: string | null;
  player1: {
    profile: ChessPlayerProfile | null;
    stats: ChessPlayerStats | null;
    analysis: PlayerGameAnalysis | null;
  };
  player2: {
    profile: ChessPlayerProfile | null;
    stats: ChessPlayerStats | null;
    analysis: PlayerGameAnalysis | null;
  };
  insights: PlayStyleInsight | null;
  analyzingStyle: boolean;
}
