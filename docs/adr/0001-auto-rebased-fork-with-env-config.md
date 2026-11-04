# Auto-rebased personal fork, configured by env vars

Manual Search ships as a personal fork that a scheduled workflow rebases onto each stable upstream Seerr tag, not as an upstream contribution or a separate app. A separate app would mean exposing another service, and the feature serves one admin's homelab. To keep the rebases cheap, the feature lives almost entirely in new files. Prowlarr settings come only from env vars (`PROWLARR_URL`, `PROWLARR_API_KEY`, `PROWLARR_MOVIE_CLIENT`, `PROWLARR_TV_CLIENT`), with no settings page and no DB migrations. Upstream files get only route registration, a `seerr-api.yml` block, the detail-page buttons and regenerated `en.json`.

## Consequences

- Before adding a settings page, a DB column or edits to an upstream file, weigh the rebase-conflict cost: each one is touched again on every upstream release.
- A rebase conflict fails the workflow without pushing anything, so the last good image keeps running until someone rebases by hand.
- Upstream's own workflows stay in the tree but are disabled in the fork's Actions settings. Only `fork-release.yml` runs.
