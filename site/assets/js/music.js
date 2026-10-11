/* Renders the featured release (homepage) and the discography (music page)
 * from window.VQ_RELEASES. Only verified-format official URLs are rendered;
 * nothing autoplays. */
(function () {
  "use strict";

  var releases = window.VQ_RELEASES || [];
  var artist = window.VQ_ARTIST || { name: "Vintage Que", profiles: {} };

  /* ---------- URL validation: official hosts only ---------- */

  function parse(url) {
    try { return new URL(url); } catch (e) { return null; }
  }

  function spotifyRef(url) {
    var u = parse(url);
    if (!u || u.protocol !== "https:" || u.hostname !== "open.spotify.com") return null;
    var m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(track|album|artist)\/([A-Za-z0-9]{22})\/?$/);
    return m ? { kind: m[1], id: m[2] } : null;
  }

  function appleOk(url) {
    var u = parse(url);
    return !!u && u.protocol === "https:" && u.hostname === "music.apple.com" &&
      /^\/[a-z]{2}\/(album|song|artist)\//.test(u.pathname);
  }

  function youtubeId(url) {
    var u = parse(url);
    if (!u || u.protocol !== "https:") return null;
    var id = null;
    if (u.hostname === "youtu.be") id = u.pathname.slice(1);
    else if (/^(www\.|m\.|music\.)?youtube\.com$/.test(u.hostname)) {
      if (u.pathname === "/watch") id = u.searchParams.get("v");
      else {
        var m = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/);
        if (m) id = m[1];
      }
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }

  function youtubeChannelOk(url) {
    var u = parse(url);
    return !!u && u.protocol === "https:" && /^(www\.)?youtube\.com$/.test(u.hostname) &&
      /^\/(@|channel\/|c\/)/.test(u.pathname);
  }

  function hostPath(url, hosts, path) {
    var u = parse(url);
    return !!u && u.protocol === "https:" && hosts.test(u.hostname) && path.test(u.pathname);
  }

  // Artist-level profile links (used for the footer and as the listen-on route
  // when a release has no release-specific URLs yet).
  function verifiedProfiles() {
    var pr = artist.profiles || {};
    var out = [];
    var sp = spotifyRef(pr.spotify);
    if (sp && sp.kind === "artist") out.push({ key: "spotify", label: "Spotify", url: pr.spotify, stream: true });
    if (appleOk(pr.appleMusic) && /\/artist\//.test(parse(pr.appleMusic).pathname)) out.push({ key: "apple", label: "Apple Music", url: pr.appleMusic, stream: true });
    if (youtubeChannelOk(pr.youtube)) out.push({ key: "youtube", label: "YouTube", url: pr.youtube, stream: true });
    if (hostPath(pr.instagram, /^(www\.)?instagram\.com$/, /^\/[A-Za-z0-9._]+\/?$/)) out.push({ key: "instagram", label: "Instagram", url: pr.instagram });
    if (hostPath(pr.tiktok, /^(www\.)?tiktok\.com$/, /^\/@[A-Za-z0-9._]+\/?$/)) out.push({ key: "tiktok", label: "TikTok", url: pr.tiktok });
    return out;
  }

  function verifiedLinks(r) {
    var l = r.links || {};
    var out = [];
    if (spotifyRef(l.spotify)) out.push({ key: "spotify", label: "Spotify", url: l.spotify });
    if (appleOk(l.appleMusic)) out.push({ key: "apple", label: "Apple Music", url: l.appleMusic });
    if (youtubeId(l.youtube)) out.push({ key: "youtube", label: "YouTube", url: l.youtube });
    return out;
  }

  /* ---------- DOM helpers ---------- */

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k]; // static, trusted markup only
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  var ICONS = {
    spotify: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 1.5a10.5 10.5 0 1 0 0 21 10.5 10.5 0 0 0 0-21Zm4.82 15.15a.65.65 0 0 1-.9.22c-2.46-1.5-5.55-1.84-9.2-1.01a.65.65 0 1 1-.29-1.27c3.99-.91 7.42-.52 10.17 1.16.31.19.41.6.22.9Zm1.28-2.86a.82.82 0 0 1-1.12.27c-2.82-1.73-7.12-2.23-10.45-1.22a.82.82 0 1 1-.47-1.57c3.81-1.15 8.55-.6 11.78 1.39.38.23.5.74.26 1.13Zm.11-2.98C14.83 8.8 9.27 8.62 6.05 9.6a.98.98 0 1 1-.57-1.88c3.7-1.12 9.84-.9 13.72 1.4a.98.98 0 0 1-1 1.69Z"/></svg>',
    apple: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.6 2.2 9.1 3.9a1 1 0 0 0-.8 1v10.3a3.2 3.2 0 1 0 1.8 2.9V8.6l7.2-1.4v6.2a3.2 3.2 0 1 0 1.8 2.9V3.2a1 1 0 0 0-1.5-1Z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 7.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6Zm0 7.9a3.1 3.1 0 1 1 0-6.2 3.1 3.1 0 0 1 0 6.2Zm6.1-8.1a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0ZM12 3.6c2.7 0 3 0 4.1.1 2.7.1 4 1.4 4.1 4.1.1 1.1.1 1.4.1 4.1s0 3-.1 4.1c-.1 2.7-1.4 4-4.1 4.1-1.1.1-1.4.1-4.1.1s-3 0-4.1-.1c-2.7-.1-4-1.4-4.1-4.1C3.7 15 3.6 14.7 3.6 12s0-3 .1-4.1c.1-2.7 1.4-4 4.1-4.1 1.1-.1 1.4-.2 4.2-.2ZM12 2c-2.7 0-3.1 0-4.1.1C4.2 2.2 2.2 4.2 2.1 7.9 2 8.9 2 9.3 2 12s0 3.1.1 4.1c.1 3.7 2.1 5.7 5.8 5.8 1 .1 1.4.1 4.1.1s3.1 0 4.1-.1c3.7-.1 5.7-2.1 5.8-5.8.1-1 .1-1.4.1-4.1s0-3.1-.1-4.1c-.1-3.7-2.1-5.7-5.8-5.8C15.1 2 14.7 2 12 2Z"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M16.6 2h-3.3v13.4a2.9 2.9 0 1 1-2.1-2.8V9.2a6.3 6.3 0 1 0 5.4 6.2V8.6a7.7 7.7 0 0 0 4.5 1.4V6.7a4.5 4.5 0 0 1-4.5-4.5Z"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M22.5 7.2a2.8 2.8 0 0 0-2-2C18.7 4.7 12 4.7 12 4.7s-6.7 0-8.5.5a2.8 2.8 0 0 0-2 2C1 9 1 12 1 12s0 3 .5 4.8a2.8 2.8 0 0 0 2 2c1.8.5 8.5.5 8.5.5s6.7 0 8.5-.5a2.8 2.8 0 0 0 2-2C23 15 23 12 23 12s0-3-.5-4.8ZM9.8 15.3V8.7l5.7 3.3-5.7 3.3Z"/></svg>'
  };

  // Release-specific links when verified; otherwise the artist's verified
  // streaming profiles, labelled as profiles (never presented as track links).
  function listenLinks(r) {
    var links = verifiedLinks(r);
    if (links.length) return { links: links, profile: false };
    return { links: verifiedProfiles().filter(function (p) { return p.stream; }), profile: true };
  }

  function streamButtons(r, extraClass) {
    var set = listenLinks(r);
    if (!set.links.length) {
      return el("p", { class: "stream-pending", text: "Streaming links arrive with the official release." });
    }
    return el("ul", { class: "stream-buttons " + (extraClass || ""), role: "list" }, set.links.map(function (l) {
      var a = el("a", {
        class: "stream-btn stream-btn--" + l.key,
        href: l.url, target: "_blank", rel: "noopener",
        "aria-label": (set.profile
          ? artist.name + " on " + l.label
          : "Listen to " + r.title + " by " + artist.name + " on " + l.label) + " (opens in a new tab)"
      });
      a.innerHTML = ICONS[l.key];
      a.appendChild(el("span", { text: l.label }));
      return el("li", null, [a]);
    }));
  }

  function formatDate(iso) {
    if (!iso) return "";
    var d = new Date(iso + "T12:00:00");
    if (isNaN(d)) return "";
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  function cover(r, sizes) {
    var wrap = el("div", { class: "cover" });
    if (r.artwork) {
      wrap.appendChild(el("img", {
        src: r.artwork, alt: "“" + r.title + "” cover artwork by " + artist.name,
        width: "900", height: "900", loading: sizes === "eager" ? "eager" : "lazy", decoding: "async"
      }));
    } else {
      // Typographic frame shown only until the original artwork file is added.
      wrap.classList.add("cover--type");
      wrap.setAttribute("role", "img");
      wrap.setAttribute("aria-label", r.title + " by " + artist.name);
      wrap.appendChild(el("span", { class: "cover__artist", text: artist.name }));
      wrap.appendChild(el("span", { class: "cover__title", text: r.title }));
    }
    return wrap;
  }

  /* ---------- Player: official embeds only, no autoplay ---------- */

  function player(r, opts) {
    var l = r.links || {};
    var sp = spotifyRef(l.spotify);
    var yt = youtubeId(l.youtube);
    if (!sp && !yt) return null;

    var box = el("div", { class: "player" });
    var tabs = [];
    if (sp && sp.kind !== "artist") tabs.push({
      key: "spotify", label: "Spotify",
      build: function () {
        return el("iframe", {
          class: "player__frame player__frame--spotify",
          src: "https://open.spotify.com/embed/" + sp.kind + "/" + sp.id + "?utm_source=generator&theme=0",
          title: "Spotify player: " + r.title + " by " + artist.name,
          height: sp.kind === "album" ? "352" : "152",
          allow: "clipboard-write; encrypted-media; fullscreen; picture-in-picture",
          loading: "lazy"
        });
      }
    });
    if (yt) tabs.push({
      key: "youtube", label: "YouTube",
      build: function () {
        var f = el("div", { class: "player__video" }, [el("iframe", {
          src: "https://www.youtube-nocookie.com/embed/" + yt + "?rel=0&modestbranding=1&playsinline=1",
          title: "YouTube video: " + r.title + " by " + artist.name,
          allow: "accelerometer; encrypted-media; gyroscope; picture-in-picture; web-share",
          allowfullscreen: "", referrerpolicy: "strict-origin-when-cross-origin",
          loading: "lazy"
        })]);
        return f;
      }
    });
    if (!tabs.length) return null;

    var stage = el("div", { class: "player__stage", id: "player-" + r.id + "-stage", role: "tabpanel" });
    function show(i) {
      stage.textContent = "";
      stage.appendChild(tabs[i].build());
      stage.setAttribute("aria-labelledby", "player-" + r.id + "-tab-" + tabs[i].key);
      tabBtns.forEach(function (b, j) {
        b.setAttribute("aria-selected", String(i === j));
        b.tabIndex = i === j ? 0 : -1;
      });
    }

    var tabBtns = tabs.map(function (t, i) {
      var b = el("button", {
        type: "button", role: "tab", class: "player__tab",
        id: "player-" + r.id + "-tab-" + t.key, "aria-controls": stage.id, text: t.label
      });
      b.addEventListener("click", function () { show(i); });
      b.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        var n = (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
        show(n); tabBtns[n].focus();
      });
      return b;
    });

    if (tabs.length > 1) {
      box.appendChild(el("div", { class: "player__tabs", role: "tablist", "aria-label": "Choose player" }, tabBtns));
    } else {
      stage.removeAttribute("role");
    }
    box.appendChild(stage);
    // Mount the preferred player (YouTube first on video-led layouts if requested).
    var start = opts && opts.preferVideo ? Math.max(0, tabs.findIndex(function (t) { return t.key === "youtube"; })) : 0;
    show(start);
    if (tabs.length === 1) stage.removeAttribute("aria-labelledby");
    return box;
  }

  /* ---------- Homepage feature ---------- */

  function renderFeatured(root) {
    var r = releases.filter(function (x) { return x.featured; })[0] || releases[0];
    if (!r) return;
    var date = formatDate(r.releaseDate);
    var meta = [r.type, date, r.label].filter(Boolean).join(" · ");
    var p = player(r);
    var primary = listenLinks(r).links[0];
    var cta = p
      ? el("a", { class: "cta", href: "#listen", text: "Stream Go Up Now" })
      : primary
        ? el("a", { class: "cta", href: primary.url, target: "_blank", rel: "noopener",
            "aria-label": "Stream Go Up now on " + primary.label + " (opens in a new tab)", text: "Stream Go Up Now" })
        : null;

    var info = el("div", { class: "feature__info reveal" }, [
      el("p", { class: "eyebrow", text: "New single" }),
      el("h2", { class: "feature__title", id: "feature-title", html: "Go Up <em>&mdash;</em> <span>Out Now</span>" }),
      meta ? el("p", { class: "feature__meta", text: meta }) : null,
      r.description ? el("p", { class: "feature__copy", text: r.description }) : null,
      cta,
      streamButtons(r)
    ]);

    var art = el("div", { class: "feature__art reveal" }, [cover(r, "eager")]);
    var grid = el("div", { class: "feature__grid" }, [art, info]);
    root.appendChild(grid);

    if (p) {
      root.appendChild(el("div", { class: "feature__listen reveal", id: "listen" }, [
        el("h3", { class: "listen__heading", text: "Listen here" }), p
      ]));
    }

    var banner = document.getElementById("cta-banner");
    if (banner) {
      if (primary) {
        banner.querySelector(".cta-banner__actions").appendChild(streamButtons(r, "stream-buttons--center"));
        banner.hidden = false;
      }
    }
  }

  /* ---------- Music page ---------- */

  function renderDiscography(root) {
    function key(r) { return r.releaseDate || (r.year ? r.year + "-00-00" : "9999"); }
    var sorted = releases.slice().sort(function (a, b) { return key(b).localeCompare(key(a)); });
    sorted.forEach(function (r, idx) {
      var date = formatDate(r.releaseDate) || (r.year ? String(r.year) : "");
      var facts = el("dl", { class: "facts" }, [
        r.type ? el("div", null, [el("dt", { text: "Format" }), el("dd", { text: r.type })]) : null,
        date ? el("div", null, [el("dt", { text: "Released" }), el("dd", { text: date })]) : null,
        r.label ? el("div", null, [el("dt", { text: "Label" }), el("dd", { text: r.label })]) : null,
        r.credits ? el("div", null, [el("dt", { text: "Credits" }), el("dd", { text: r.credits })]) : null
      ]);
      var tracks = r.tracks && r.tracks.length ? el("ol", { class: "tracklist" }, r.tracks.map(function (t, i) {
        return el("li", null, [
          el("span", { class: "tracklist__n", text: String(i + 1).padStart(2, "0") }),
          el("span", { class: "tracklist__t", text: t.title }),
          t.duration ? el("span", { class: "tracklist__d", text: t.duration }) : null
        ]);
      })) : null;
      var p = player(r);
      var own = verifiedLinks(r).length > 0;
      var article = el("article", { class: "release reveal" + (r.featured ? " release--lead" : ""), id: r.id, "aria-labelledby": r.id + "-title" }, [
        el("div", { class: "release__art" }, [cover(r, idx === 0 ? "eager" : "lazy")]),
        el("div", { class: "release__body" }, [
          r.featured ? el("p", { class: "eyebrow", text: "Latest release" }) : null,
          el("h2", { class: "release__title", id: r.id + "-title", text: r.title }),
          r.featuring ? el("p", { class: "release__feat", text: "feat. " + r.featuring }) : null,
          r.description ? el("p", { class: "release__copy", text: r.description }) : null,
          facts, tracks, p,
          (own || r.featured) ? streamButtons(r) : null
        ])
      ]);
      root.appendChild(article);
    });
  }

  /* ---------- Artist profile links (footer) ---------- */

  function renderProfiles() {
    var items = verifiedProfiles();
    document.querySelectorAll("[data-profiles]").forEach(function (ul) {
      items.forEach(function (it) {
        var a = el("a", { href: it.url, target: "_blank", rel: "noopener", "aria-label": artist.name + " on " + it.label + " (opens in a new tab)" });
        a.innerHTML = ICONS[it.key];
        ul.appendChild(el("li", null, [a]));
      });
    });
    document.querySelectorAll("[data-catalog-links]").forEach(function (box) {
      var r = { title: "", links: {} };
      var b = streamButtons(r, "stream-buttons--center");
      if (b.tagName === "UL") box.appendChild(b);
    });
  }

  /* ---------- Scroll reveal ---------- */

  function reveals() {
    var nodes = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      nodes.forEach(function (n) { n.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    nodes.forEach(function (n) { io.observe(n); });
  }

  /* ---------- Mobile nav ---------- */

  function nav() {
    var btn = document.querySelector(".nav__toggle");
    var menu = document.getElementById("nav-menu");
    if (!btn || !menu) return;
    btn.addEventListener("click", function () {
      var open = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!open));
      menu.classList.toggle("is-open", !open);
    });
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) { btn.setAttribute("aria-expanded", "false"); menu.classList.remove("is-open"); }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var f = document.getElementById("featured-release");
    if (f) renderFeatured(f);
    var d = document.getElementById("discography");
    if (d) renderDiscography(d);
    renderProfiles();
    nav();
    reveals();
    var y = document.getElementById("year");
    if (y) y.textContent = new Date().getFullYear();
  });

  // Exposed for tests.
  window.VQ_validate = { spotifyRef: spotifyRef, appleOk: appleOk, youtubeId: youtubeId };
})();
