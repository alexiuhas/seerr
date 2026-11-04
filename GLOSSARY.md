# Seerr (manual-search fork)

Seerr is a media discovery and request manager in front of Radarr/Sonarr. This fork adds Manual Search: an admin picks a specific Release from Prowlarr instead of letting Radarr/Sonarr choose.

## Language

### Manual Search

**Manual Search**:
An admin-only free-text search of Prowlarr's indexers for a movie or series, started from its detail page.
_Avoid_: Interactive search (that is Radarr/Sonarr's own ID-based search), Prowlarr search

**Search Scope**:
What a Manual Search on a series targets: the whole series or a single season.
_Avoid_: Search mode, filter

**Release**:
A single torrent offered by an indexer, as returned by a Manual Search.
_Avoid_: Result, torrent, download

**Push**:
Handing a chosen Release to the Radarr/Sonarr instance that holds the item, which then evaluates, grabs and tracks it like one it found itself.
_Avoid_: Send, grab (on its own)

**Quiet Server**:
A Radarr/Sonarr server entry in Seerr with Automatic Search off, chosen when requesting an item you intend to Push yourself, so Radarr/Sonarr don't grab something first.
_Avoid_: Manual server, no-search server

**Prowlarr Grab**:
The fallback when a Push is rejected: Prowlarr sends the Release straight to the download client, so Radarr/Sonarr see it only as an untracked download.
_Avoid_: Direct download, force grab
