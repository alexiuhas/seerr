# Push first, Prowlarr Grab only as a fallback

A Release chosen in Manual Search is first Pushed to Radarr/Sonarr (`/api/v3/release/push`), so they evaluate, grab, track and import it as usual. Only when they reject it, or can't parse its title, is a Prowlarr Grab offered, which sends it straight to qBittorrent. A Push can't be forced onto a particular movie or series: Radarr/Sonarr ignore `movieId`/`seriesId` on push and match by parsed title, then by TMDB/IMDb/TVDB ID. The badly named releases that make Manual Search worth having are therefore the ones most likely to be rejected.

## Considered options

- **Push only.** Simplest, but the releases that are hardest to find couldn't be grabbed at all.
- **Prowlarr Grab only.** Never rejected, but nothing is tracked, so every download risks needing a Manual Import in the *arr UI, which this feature exists to avoid.

## Consequences

- A Prowlarr Grab bypasses Radarr/Sonarr's tracking. If they can't match the download's title, it ends as "Manual Import required" in their UI.
- Prowlarr Grab is never offered for items that aren't in Radarr/Sonarr, since it would always end in a Manual Import.
- Prowlarr needs one download client per *arr category; Seerr picks the right one by name from env vars.
