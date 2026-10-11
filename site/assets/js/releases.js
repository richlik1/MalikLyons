/*
 * Vintage Que — release data (the single source of truth for the music section).
 *
 * RULES
 *  - Only paste official release URLs copied from the artist's own Spotify,
 *    Apple Music and YouTube pages (or the distributor's release report).
 *  - Leave a field as "" until the verified URL is available. Empty or
 *    non-official URLs are never rendered: the matching button / player is
 *    simply hidden, so the site can never show an invented link.
 *  - Artwork must be the original cover supplied by the artist.
 *
 * Accepted URL formats
 *  spotify    https://open.spotify.com/track/<id>   (or /album/<id>)
 *  appleMusic https://music.apple.com/<country>/album/<slug>/<id>?i=<trackId>
 *  youtube    https://www.youtube.com/watch?v=<id>  or  https://youtu.be/<id>
 *
 * Sources (brand kit, October 2026): catalog and years from the Apple Music
 * artist listing; Go Up release date per that listing; label per Qobuz.
 * Covers for Go Up, Vintage Chanel, Dear Diary and DND are from the brand kit
 * (screenshots — swap in the full-resolution originals when available).
 */
window.VQ_ARTIST = {
  name: "Vintage Que",
  profiles: {
    appleMusic: "https://music.apple.com/us/artist/vintage-que/1552082244",
    youtube: "https://www.youtube.com/channel/UCC6tRJR7Aqkpli4wyviigGA",
    instagram: "https://instagram.com/vintage_que",
    tiktok: "https://tiktok.com/@vintage_que",
    spotify: ""     // https://open.spotify.com/artist/<id>
  }
};

window.VQ_RELEASES = [
  {
    id: "go-up",
    title: "Go Up",
    type: "Single",
    featured: true,
    releaseDate: "2026-09-04",
    label: "Vibin With Vintage Entertainment",
    artwork: "assets/img/go-up-cover.jpg",
    description: "",
    tracks: [{ title: "Go Up", duration: "" }],
    links: { spotify: "", appleMusic: "", youtube: "" }
  },
  { id: "my-man", title: "My Man", year: 2025, artwork: "", links: {} },
  { id: "love-is", title: "Love Is", featuring: "Brayden", year: 2025, artwork: "", links: {} },
  { id: "dear-diary", title: "Dear Diary", year: 2023, artwork: "assets/img/dear-diary-cover.jpg", credits: "Produced by Shyy Beatz", links: {} },
  { id: "vintage-chanel", title: "Vintage Chanel", year: 2023, artwork: "assets/img/vintage-chanel-cover.jpg", links: {} },
  { id: "dnd", title: "DND", year: 2022, artwork: "assets/img/dnd-cover.jpg", credits: "Produced by Ant Beats", links: {} },
  { id: "got-away", title: "Got Away", year: 2022, artwork: "", links: {} }
];
