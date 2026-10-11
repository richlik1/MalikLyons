# Vintage Que — official site (music section)

Static site, no build step. Open `index.html` or deploy the `site/` folder to any static host.

- `index.html` — homepage with the featured **GO UP — OUT NOW** release, official player and the **STREAM GO UP NOW** call to action.
- `music.html` — discography: artwork, release info, tracklist and official players.
- `assets/js/releases.js` — **all release data lives here.**
- `assets/js/music.js` — rendering, URL checks and the accessible Spotify/YouTube player tabs.
- `assets/css/styles.css` — plum, pink, cream and gold theme.

## Content status (from the October 2026 brand kit)

Already in place:
- **Catalog:** Go Up (Single, Sept 4 2026, Vibin With Vintage Entertainment), My Man, Love Is (feat. Brayden), Dear Diary, Vintage Chanel, DND, Got Away.
- **Artwork:** Go Up, Dear Diary, Vintage Chanel, DND (cropped from the kit's screenshots, metadata stripped).
- **Homepage portrait:** the white-SUV close portrait.
- **Artist links:** Apple Music artist page, YouTube channel, Instagram, TikTok.

Until release-specific URLs exist, the Go Up buttons and **STREAM GO UP NOW** link to the verified **artist** pages, labelled as such for screen readers.

Still needed:
1. Official **Go Up** URLs for Spotify, Apple Music (track) and YouTube. Paste them into `links` in `releases.js`; the embedded player (Spotify and/or YouTube) then appears automatically on both pages.
2. The Spotify artist URL (`VQ_ARTIST.profiles.spotify`).
3. Full-resolution original covers (the current files are screenshots) and artwork for My Man, Love Is and Got Away.
4. Artist and photographer permission for the portrait.

### Placeholder-free by design

Empty or non-official URLs are never rendered. A link must be `https://` on `open.spotify.com`, `music.apple.com`, `youtube.com` or `youtu.be`, with a correctly shaped ID; anything else is hidden. Until a link exists, the matching button, embed and **STREAM GO UP NOW** CTA stay hidden and a neutral "arrive with the official release" note shows. Until the artwork is added, a typographic title card stands in for the cover.

### Player

- Official Spotify embed and privacy-enhanced YouTube embed (`youtube-nocookie.com`), lazy-loaded, **never autoplay**.
- When both exist, keyboard-accessible tabs (arrow keys) switch between them; each iframe has a descriptive title.
- Respects `prefers-reduced-motion`; 44px+ touch targets; mobile nav.

To add another release, append an object to `VQ_RELEASES`. The music page sorts by `releaseDate`, newest first.
