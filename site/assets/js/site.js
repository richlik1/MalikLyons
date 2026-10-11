/* Shows list and form handling (booking inquiry + mailing list). */
(function () {
  "use strict";

  var forms = window.VQ_FORMS || {};
  var shows = window.VQ_SHOWS || [];

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function httpsUrl(url) {
    try { return new URL(url).protocol === "https:"; } catch (e) { return false; }
  }

  /* ---------- Shows ---------- */

  function renderShows(root) {
    var today = new Date().toISOString().slice(0, 10);
    var upcoming = shows.filter(function (s) { return s.date && s.date >= today; })
      .sort(function (a, b) { return a.date.localeCompare(b.date); });

    if (!upcoming.length) {
      root.appendChild(el("div", { class: "empty-state" }, [
        el("p", { class: "empty-state__title", text: "No dates announced yet." }),
        el("p", { text: "New shows are posted here first. Join the list to hear about them, or bring Vintage Que to your stage." }),
        el("p", { class: "empty-state__actions" }, [
          el("a", { class: "cta", href: "booking.html", text: "Book Vintage" }),
          el("a", { class: "cta cta--ghost", href: "#newsletter", text: "Get show alerts" })
        ])
      ]));
      return;
    }
    root.appendChild(el("ul", { class: "shows", role: "list" }, upcoming.map(function (s) {
      var d = new Date(s.date + "T12:00:00");
      return el("li", { class: "show" }, [
        el("time", { class: "show__date", datetime: s.date }, [
          el("span", { class: "show__month", text: d.toLocaleDateString("en-US", { month: "short" }) }),
          el("span", { class: "show__day", text: String(d.getDate()) })
        ]),
        el("div", { class: "show__info" }, [
          el("p", { class: "show__venue", text: s.venue || "" }),
          el("p", { class: "show__city", text: s.city || "" })
        ]),
        httpsUrl(s.tickets)
          ? el("a", { class: "stream-btn", href: s.tickets, target: "_blank", rel: "noopener", text: "Tickets",
              "aria-label": "Tickets for " + (s.venue || "this show") + " (opens in a new tab)" })
          : null
      ]);
    })));
  }

  /* ---------- Forms ---------- */

  function setupForm(form) {
    var key = form.getAttribute("data-form");
    var endpoint = forms[key];
    var status = form.querySelector(".form__status");
    var submit = form.querySelector("[type=submit]");

    function say(msg, kind) {
      status.textContent = msg;
      status.className = "form__status" + (kind ? " form__status--" + kind : "");
    }

    if (!httpsUrl(endpoint)) {
      submit.disabled = true;
      submit.setAttribute("aria-describedby", status.id);
      say(key === "booking"
        ? "Online booking opens once the booking inbox is connected."
        : "Sign-ups open soon.", "note");
      return;
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (form.querySelector("[name=_gotcha]").value) return; // honeypot: bots only
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      submit.disabled = true;
      say("Sending…");
      fetch(endpoint, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: new FormData(form)
      }).then(function (res) {
        if (!res.ok) throw new Error(res.status);
        form.reset();
        say(key === "booking" ? "Thank you — your inquiry has been sent. The team will be in touch." : "You're on the list. Thank you!", "ok");
      }).catch(function () {
        say("Sorry, that didn't go through. Please try again in a moment.", "error");
      }).then(function () { submit.disabled = false; });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var s = document.getElementById("shows");
    if (s) renderShows(s);
    document.querySelectorAll("form[data-form]").forEach(setupForm);
  });
})();
