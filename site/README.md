# Vintage Que — official site

Static site, no build step. Open `index.html` or deploy the `site/` folder to any static host (Netlify, Vercel, GitHub Pages, Cloudflare Pages), then point the domain at it.

Pages: `index.html` (Home, featured **GO UP — OUT NOW**), `music.html` (discography), `about.html` (story and her own quotes), `visuals.html` (photos, YouTube), `shows.html` (live dates), `booking.html` (press kit and booking inquiry). Each page ends with the mailing-list signup.

Content files:
- `assets/js/releases.js` — releases, streaming links, artist profiles.
- `assets/js/site-config.js` — show dates and form endpoints.
- `assets/js/music.js`, `assets/js/site.js` — rendering, URL checks, player, forms.
- `assets/css/styles.css` — brand theme.

## Forms
The booking form and the mailing list need a form service. Create a form at a provider such as Formspree that delivers to the approved booking inbox, then paste its `https://` endpoint into `VQ_FORMS` in `site-config.js`. Until then the forms show but cannot be submitted, and they say so. Both include a hidden anti-spam field.

## Shows
Add confirmed dates to `VQ_SHOWS` in `site-config.js`. Past dates hide automatically. With no dates, the page says none are announced.

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
4. Artist and photographer permission for all photos.
5. A booking inbox and form endpoints (see Forms).
6. Approval of the About/press bio and quotes (taken from her own interview answers).

### Placeholder-free by design

Empty or non-official URLs are never rendered. A link must be `https://` on `open.spotify.com`, `music.apple.com`, `youtube.com` or `youtu.be`, with a correctly shaped ID; anything else is hidden. Until a link exists, the matching button, embed and **STREAM GO UP NOW** CTA stay hidden and a neutral "arrive with the official release" note shows. Until the artwork is added, a typographic title card stands in for the cover.

### Player

- Official Spotify embed and privacy-enhanced YouTube embed (`youtube-nocookie.com`), lazy-loaded, **never autoplay**.
- When both exist, keyboard-accessible tabs (arrow keys) switch between them; each iframe has a descriptive title.
- Respects `prefers-reduced-motion`; 44px+ touch targets; mobile nav.

To add another release, append an object to `VQ_RELEASES`. The music page sorts by `releaseDate`, newest first.
