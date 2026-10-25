-- v196: each recorded game also stores its final board (Stats → Recent games → tap a game).
-- ~15–25 KB per game. The Stats list never downloads it (only `final->>id`); a game's board is
-- fetched when someone taps that game. The app works with or without this column.
alter table public.game_results add column if not exists final jsonb;
