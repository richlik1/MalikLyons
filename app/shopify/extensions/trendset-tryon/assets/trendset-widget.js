// TrendSet storefront widget (TEMPLATE — not yet verified on a development store).
// 1) Gets a first-party visitor id. 2) If an experiment is configured, asks TrendSet for the
// arm (exposure is logged server-side). 3) Treatment: show the button; control: keep hidden.
// 4) Writes hidden cart attributes (_ts_exp, _ts_vid) so orders can be attributed via the
// orders/create webhook. 5) Reports add-to-cart from the product form.
(function () {
  var el = document.querySelector(".trendset-tryon");
  if (!el) return;
  var app = (el.dataset.trendsetApp || "").replace(/\/$/, "");
  if (!app) return;
  var exp = el.dataset.experiment || "";
  var vid;
  try {
    vid = localStorage.getItem("ts_vid");
    if (!vid) { vid = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9_-]/g, ""); localStorage.setItem("ts_vid", vid); }
  } catch (e) { vid = null; }

  var link = el.querySelector("a");
  link.href = app + "/try-on?shop=" + encodeURIComponent(el.dataset.shop) + "&shopify_product=" + encodeURIComponent(el.dataset.product);

  function post(path, body) {
    return fetch(app + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true });
  }

  if (!exp || !vid) { el.hidden = false; return; }

  post("/api/experiments/assign", { experimentId: exp, visitorId: vid })
    .then(function (r) { return r.ok ? r.json() : { arm: "treatment" }; })
    .then(function (res) {
      if (res.experiment === "running") {
        fetch("/cart/update.js", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ attributes: { _ts_exp: exp, _ts_vid: vid } }) });
      }
      if (res.arm === "treatment") el.hidden = false;
      link.addEventListener("click", function () { post("/api/experiments/events", { experimentId: exp, visitorId: vid, event: "tryon_open" }); });
      document.querySelectorAll('form[action*="/cart/add"]').forEach(function (f) {
        f.addEventListener("submit", function () { post("/api/experiments/events", { experimentId: exp, visitorId: vid, event: "add_to_cart" }); });
      });
    })
    .catch(function () { el.hidden = false; });
})();
