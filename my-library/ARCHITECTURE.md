# Architecture

My Library is split into a **core** that knows nothing about React or the browser UI, and a thin **UI** layer. That split is
what makes a future native iOS app (offline neural voices, background audio, lock-screen controls) a matter of swapping
adapters rather than rewriting the app.

```
            ┌─────────────────────────── src/ui (React) ───────────────────────────┐
            │ Library · Player/Reader · Sheets · Settings · usePlayback · useVoices │
            └──────────────┬──────────────────────┬─────────────────────┬──────────┘
                           │                      │                     │
               ┌───────────▼─────────┐  ┌─────────▼─────────┐  ┌────────▼────────┐
               │ core/importers      │  │ core/speech       │  │ core/storage    │
               │ pdf epub docx txt   │  │ Narrator          │  │ db (IndexedDB)  │
               │ text (clean/chapter)│  │ chunker           │  │ backup (JSON)   │
               └─────────────────────┘  │ SpeechEngine ◄────┼──┼─ adapters       │
                                        └─────────┬─────────┘  └─────────────────┘
                                                  │
                              WebSpeechEngine (browser) │ future: NativeSpeechEngine (iOS)
```

## Data model (`src/core/types.ts`)

- **Book** — metadata only (title, author, category, cover data URL, format, counts, OCR report).
- **BookContent** — `chapters: { title, text }[]`. Text is normalised: single spaces, paragraphs separated by `\n\n`.
  Chapters longer than 40 000 characters are split into parts so the reader view stays fast.
- **Position** — `{ chapter, offset }`: a character offset inside a chapter's text. Every feature (progress, bookmarks,
  highlights, notes, “play from here”) uses this one coordinate system, so it is stable across devices and engines.
- **Progress**, **Annotation**, **Settings** — keyed by book id.

IndexedDB stores: `books`, `contents`, `files` (original upload, for full backups/re-processing), `progress`, `annotations`
(indexed by book), `kv` (settings).

## Import pipeline

1. `detectFormat` — magic bytes first (`%PDF-`, ZIP + `mimetypeapplication/epub+zip`), then extension.
2. Format importer → `ImportedBook`:
   - **PDF** (PDF.js legacy build for older iOS Safari, loaded lazily): text items → lines (by baseline) → running
     headers/footers and page numbers removed (repeated edge lines) → paragraphs (line-gap / short-line / indent heuristics,
     de-hyphenation) → pages joined (paragraphs continuing across pages are merged). Chapters from the PDF outline, else heading
     detection, else page groups. Pages with no text but with images are reported as needing OCR; a PDF with no text at all is
     rejected with the OCR explanation. First page rendered to a small JPEG cover.
   - **EPUB** — JSZip; `container.xml` → OPF → spine order; chapter titles from the EPUB3 nav or NCX; XHTML → text with
     paragraph breaks (scripts, styles, footnote markers skipped); cover image from the manifest; DRM detected via
     `encryption.xml`.
   - **DOCX** — JSZip; `word/document.xml` paragraphs and runs; heading levels from `styles.xml` (localised names, outline
     levels); tracked deletions skipped; split on the highest heading level used twice or more.
   - **TXT** — UTF-8/UTF-16 BOM/Windows-1252 decoding, Project Gutenberg header/footer removal, hard-wrap unwrapping, heading
     detection.
3. `finalizeChapters` — normalise, drop empty chapters, split very long ones.

## Speech

- **Chunker** (`chunker.ts`) — sentence segmentation (`Intl.Segmenter`, regex fallback, abbreviation repair), long sentences
  split at clause punctuation, tiny sentences merged; ≤ 200 characters per chunk. Each chunk keeps its absolute offsets.
  Short utterances avoid Chrome's ~15 s cut-off and make retry/skip cheap.
- **SpeechEngine** (`engine.ts`) — the only thing that produces sound:
  `getVoices`, `speak(text, {voiceId, rate, pitch}, {onStart, onBoundary, onEnd, onError})`, `cancel`, `isSpeaking`.
- **WebSpeechEngine** — browser `speechSynthesis`; keeps a strong reference to the utterance (Chrome GC bug), detaches handlers
  on cancel, nudges Chrome's online voices, delays a speak that immediately follows a cancel on iOS, classifies voices
  (Premium/Enhanced/novelty, on-device vs online).
- **Narrator** (`narrator.ts`) — the playback state machine (idle/playing/paused/ended): walks chunks and chapters, word-level
  position from boundary events, pause = cancel + remember position (more reliable than `speechSynthesis.pause()` on mobile),
  generation counter so events from cancelled utterances are ignored, start watchdog (speech silently never started) and end
  watchdog (engine never reported the end), retry ×2 then skip a failing sentence, stop with an explanation after repeated
  failures, interruption and autoplay-policy handling, foreground recovery, sleep timer. Fully unit-tested with a fake engine.

## PWA / offline

`vite-plugin-pwa` generates the manifest and a Workbox service worker that precaches the whole app (including the PDF.js worker),
so the app opens, imports and reads with no network. PDF.js CJK character maps/fonts are cached on first use. `base: './'` +
hash routing let the same build run from any host or sub-path. `navigator.storage.persist()` is requested to protect the library
from eviction; the Screen Wake Lock API keeps the screen on while narrating.

## Path to a native iOS app (background audio, lock screen, neural voices)

The browser cannot give background or lock-screen speech on iOS. A native shell can, reusing everything in `src/core` and most of
`src/ui`:

1. **Wrap the app with [Capacitor](https://capacitorjs.com)** (free, open source): `npm i @capacitor/core @capacitor/ios`,
   `npx cap add ios`. The React UI runs in a WKWebView; build with Xcode (a free Apple ID can install on your own iPhone; App
   Store distribution needs the paid developer program).
2. **Add a `NativeSpeechEngine`** implementing the same `SpeechEngine` interface via a small Capacitor plugin:
   - `AVSpeechSynthesizer` with `AVAudioSession` category `.playback` + the *Audio* background mode → speech continues with the
     screen locked; `willSpeakRangeOfSpeechString` maps directly to `onBoundary`.
   - or an **offline neural TTS** (e.g. Piper/Kokoro models via sherpa-onnx, both free/open source) that renders chunks to PCM
     buffers played by `AVAudioEngine` — same chunk/offset model, so positions and notes stay compatible.
   - `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter` for lock-screen and headphone controls (the web app already wires the
     equivalent Media Session handlers to the Narrator).
3. **Storage** — keep IndexedDB inside the WebView, or move `core/storage/db.ts` onto SQLite (`@capacitor-community/sqlite`)
   behind the same functions. The JSON backup format moves libraries between the web and native apps.
4. Select the engine at startup (`src/ui/engine.ts` is the single place that chooses it).

Nothing else in the app needs to change: the Narrator, chunker, importers, data model and backup format are engine-agnostic.
