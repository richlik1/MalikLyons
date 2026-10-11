# Vintage Que — official site (music section)

Static site, no build step. Open `index.html` or deploy the `site/` folder to any static host.

- `index.html` — homepage with the featured **GO UP — OUT NOW** release, official player and the **STREAM GO UP NOW** call to action.
- `music.html` — discography: artwork, release info, tracklist and official players.
- `assets/js/releases.js` — **all release data lives here.**
- `assets/js/music.js` — rendering, URL checks and the accessible Spotify/YouTube player tabs.
- `assets/css/styles.css` — plum, pink, cream and gold theme.

## Going live with "Go Up"

1. Copy the original "Go Up" cover into `assets/img/` (for example `go-up-cover.jpg`, square, 1400px or larger) and set `artwork` in `releases.js`.
2. Paste the official release URLs into `links.spotify`, `links.appleMusic` and `links.youtube`. Copy them from the artist's own Spotify, Apple Music and YouTube pages or the distributor's release report. Also fill in `releaseDate` and `label`.
3. Optionally add the artist profile URLs under `VQ_ARTIST.profiles` (footer icons).

### Placeholder-free by design

Empty or non-official URLs are never rendered. A link must be `https://` on `open.spotify.com`, `music.apple.com`, `youtube.com` or `youtu.be`, with a correctly shaped ID; anything else is hidden. Until a link exists, the matching button, embed and **STREAM GO UP NOW** CTA stay hidden and a neutral "arrive with the official release" note shows. Until the artwork is added, a typographic title card stands in for the cover.

### Player

- Official Spotify embed and privacy-enhanced YouTube embed (`youtube-nocookie.com`), lazy-loaded, **never autoplay**.
- When both exist, keyboard-accessible tabs (arrow keys) switch between them; each iframe has a descriptive title.
- Respects `prefers-reduced-motion`; 44px+ touch targets; mobile nav.

To add another release, append an object to `VQ_RELEASES`. The music page sorts by `releaseDate`, newest first.
