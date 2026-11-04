<p align="center">
<img src="./public/logo_full.svg" alt="Seerr" style="margin: 20px 0;">
</p>
<p align="center">
<img src="https://github.com/seerr-team/seerr/actions/workflows/release.yml/badge.svg" alt="Seerr Release" />
<img src="https://github.com/seerr-team/seerr/actions/workflows/ci.yml/badge.svg" alt="Seerr CI">
</p>
<p align="center">
<a href="https://discord.gg/seerr"><img src="https://img.shields.io/discord/783137440809746482" alt="Discord"></a>
<a href="https://hub.docker.com/r/seerr/seerr"><img src="https://img.shields.io/docker/pulls/seerr/seerr" alt="Docker pulls"></a>
<a href="https://translate.seerr.dev/engage/seerr/"><img src="https://translate.seerr.dev/widget/seerr/svg-badge.svg" alt="Translation status" /></a>
<a href="https://github.com/seerr-team/seerr/blob/develop/LICENSE"><img alt="GitHub" src="https://img.shields.io/github/license/seerr-team/seerr"></a>

**Seerr** is a free and open source software application for managing requests for your media library. It integrates with the media server of your choice: [Jellyfin](https://jellyfin.org), [Plex](https://plex.tv), and [Emby](https://emby.media/). In addition, it integrates with your existing services, such as **[Sonarr](https://sonarr.tv/)**, **[Radarr](https://radarr.video/)**.

## Manual Search Fork

This fork adds **Manual Search**: an admin searches Prowlarr's indexers from a movie or series page and picks the exact Release to download. A daily workflow rebases the fork onto each new stable upstream tag and publishes it to `ghcr.io/alexiuhas/seerr`, as `:latest` and `:<upstream-tag>-ms.<sha>` (`linux/amd64` only). See [ADR-0001](docs/adr/0001-auto-rebased-fork-with-env-config.md).

### Swapping the Image

Replace the image in your compose file and keep the config volume. The fork has no DB migrations of its own, so your settings, users and requests carry over.

```yaml
services:
  seerr:
    image: ghcr.io/alexiuhas/seerr:latest # was ghcr.io/seerr-team/seerr
    environment:
      - PROWLARR_URL=http://prowlarr:9696
      - PROWLARR_API_KEY=your-prowlarr-api-key
      - PROWLARR_MOVIE_CLIENT=qBittorrent (Radarr)
      - PROWLARR_TV_CLIENT=qBittorrent (Sonarr)
    volumes:
      - /path/to/appdata/config:/app/config # unchanged
    networks:
      - media
```

### Environment Variables

Manual Search has no settings page. Prowlarr is configured only through these:

| Variable                | Required | Description                                                                                         |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `PROWLARR_URL`          | Yes      | Prowlarr's base URL as Seerr reaches it, e.g. `http://prowlarr:9696`.                               |
| `PROWLARR_API_KEY`      | Yes      | Prowlarr's API key (Settings → General).                                                            |
| `PROWLARR_MOVIE_CLIENT` | No       | Exact name of the Prowlarr download client used for movie grabs. Unset: no Prowlarr Grab for movies. |
| `PROWLARR_TV_CLIENT`    | No       | Exact name of the Prowlarr download client used for series grabs. Unset: no Prowlarr Grab for series. |

Without `PROWLARR_URL` and `PROWLARR_API_KEY`, Manual Search is disabled.

### One Docker Network

Seerr, Prowlarr, Radarr, Sonarr and the download client must share one Docker network. Seerr calls Prowlarr, and a chosen Release is Pushed to Radarr/Sonarr with a Prowlarr download link that Radarr/Sonarr then fetch. Every hostname (`prowlarr`, `radarr`, `sonarr`, `qbittorrent`) has to resolve from each of those containers, so use the same service names in Seerr's server settings and in `PROWLARR_URL`.

### Quiet Server

A request on a normal server makes Radarr/Sonarr search and grab something straight away, before you get to pick a Release yourself. For items you mean to pick by hand, add a **Quiet Server**: in Seerr's Settings → Services, add a second Radarr (and Sonarr) entry pointing at the same instance, with **Enable Automatic Search** off. Leave it not set as Default Server, and turn **Enable Scan** off so the instance isn't scanned twice. When requesting, choose the Quiet Server under the advanced request options, then open the item's page and run Manual Search.

### Prowlarr Download Clients

A chosen Release is first Pushed to Radarr/Sonarr, which grab and track it as usual. If they reject it, Manual Search offers a **Prowlarr Grab**, which sends it straight to the download client through Prowlarr. That needs one Prowlarr download client per media type (Prowlarr → Settings → Download Clients), both pointing at the same qBittorrent:

- one for movies, named as in `PROWLARR_MOVIE_CLIENT`, with the **same category Radarr uses** (e.g. `radarr`)
- one for series, named as in `PROWLARR_TV_CLIENT`, with the **same category Sonarr uses** (e.g. `tv-sonarr`)

The categories must match Radarr's and Sonarr's own download-client categories, or they won't see the download. Even then, Radarr/Sonarr see a Prowlarr Grab only as an untracked download, so a badly named one can still end up needing a Manual Import ([ADR-0002](docs/adr/0002-push-first-prowlarr-grab-fallback.md)).

### Maintaining the Fork

Only `.github/workflows/fork-release.yml` should run. After forking:

- disable upstream's other workflows in the Actions tab
- make the `seerr` package public in GHCR (package settings → Change visibility), so it can be pulled without logging in
- add a `FORK_PUSH_TOKEN` secret: a fine-grained token for this repo with **Contents** and **Workflows** read/write. The default `GITHUB_TOKEN` can't push a rebase that changes upstream's workflow files, which most upstream tags do.

If a rebase conflicts, the scheduled run fails without pushing anything and the last good image keeps running. Rebase `manual-search` onto the new tag by hand and force-push it; the push builds and publishes.

GitHub pauses scheduled workflows after 60 days without repository activity. If the daily run stops, re-enable it in the Actions tab.

## Current Features

- Full Jellyfin/Emby/Plex integration including authentication with user import & management.
- Support for **PostgreSQL** and **SQLite** databases.
- Supports Movies, Shows and Mixed Libraries.
- Ability to change email addresses for SMTP purposes.
- Easy integration with your existing services. Currently, Seerr supports Sonarr and Radarr. More to come!
- Jellyfin/Emby/Plex library scan, to keep track of the titles which are already available.
- Customizable request system, which allows users to request individual seasons or movies in a friendly, easy-to-use interface.
- Incredibly simple request management UI. Don't dig through the app to simply approve recent requests!
- Granular permission system.
- Support for various notification agents.
- Mobile-friendly design, for when you need to approve requests on the go!
- Support for watchlisting & blocklisting media.

With more features on the way! Check out our [issue tracker](/../../issues) to see the features which have already been requested.

## Getting Started

Check out our documentation for instructions on how to install and run Seerr:

https://docs.seerr.dev/getting-started/

## Preview

<img src="./public/preview.jpg" alt="Seerr application preview" />

## Migrating from Overseerr/Jellyseerr to Seerr

Read our [release announcement](https://docs.seerr.dev/blog/seerr-release) to learn what Seerr means for Jellyseerr and Overseerr users.

Please follow our [migration guide](https://docs.seerr.dev/migration-guide) for detailed instructions on migrating from Overseerr or Jellyseerr.

## Support

- Check out the [Seerr Documentation](https://docs.seerr.dev) before asking for help. Your question might already be in the docs!
- You can get support on [Discord](https://discord.gg/seerr).
- You can ask questions in the Help category of our [GitHub Discussions](/../../discussions).
- Bug reports and feature requests can be submitted via [GitHub Issues](/../../issues).

## API Documentation

You can access the API documentation from your local Seerr install at http://localhost:5055/api-docs

## Community

You can ask questions, share ideas, and more in [GitHub Discussions](/../../discussions).

If you would like to chat with other members of our growing community, [join the Seerr Discord server](https://discord.gg/seerr)!

Our [Code of Conduct](./CODE_OF_CONDUCT.md) applies to all Seerr community channels.

## Contributing

You can help improve Seerr too! Check out our [Contribution Guide](./CONTRIBUTING.md) to get started.

## Contributors ✨

[![Contributors](https://opencollective.com/seerr/contributors.svg?width=890)](https://opencollective.com/seerr/#backers)

[![Become a Backer](https://opencollective.com/seerr/backers.svg)](https://opencollective.com/seerr/#backers)
[![Become a Sponsor](https://opencollective.com/seerr/sponsors.svg)](https://opencollective.com/seerr/#sponsors)
