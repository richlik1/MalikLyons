/*
 * Vintage Que — release data (the single source of truth for the music section).
 *
 * RULES
 *  - Only paste official release URLs copied from the artist's own Spotify,
 *    Apple Music and YouTube pages (or the distributor's release report).
 *  - Leave a field as "" until the verified URL is available. Empty or
 *    non-official URLs are never rendered: the matching button / player is
 *    simply hidden, so the site can never show an invented link.
 *  - Artwork must be the original cover supplied by the artist. Put the file
 *    in assets/img/ and reference it below (square, 1400px+ recommended).
 *
 * Accepted URL formats
 *  spotify    https://open.spotify.com/track/<id>   (or /album/<id>)
 *  appleMusic https://music.apple.com/<country>/album/<slug>/<id>?i=<trackId>
 *  youtube    https://www.youtube.com/watch?v=<id>  or  https://youtu.be/<id>
 */
window.VQ_ARTIST = {
  name: "Vintage Que",
  profiles: {
    spotify: "",    // https://open.spotify.com/artist/<id>
    appleMusic: "", // https://music.apple.com/<country>/artist/<slug>/<id>
    youtube: ""     // https://www.youtube.com/@<handle>
  }
};

window.VQ_RELEASES = [
  {
    id: "go-up",
    title: "Go Up",
    type: "Single",
    featured: true,
    releaseDate: "",   // ISO date, e.g. "2026-09-26"
    label: "",         // e.g. "Independent"
    artwork: "",       // e.g. "assets/img/go-up-cover.jpg"
    description: "",   // optional one- or two-sentence release note
    tracks: [{ title: "Go Up", duration: "" }],
    links: {
      spotify: "",
      appleMusic: "",
      youtube: ""
    }
  }
];
