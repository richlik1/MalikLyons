/*! TrendSet try-on widget v1 — https://trendset (paste on any product page)
 *  <script src="https://YOUR-TRENDSET-HOST/widget.js" data-key="ts_pk_..." defer></script>
 *  <button data-trendset-product="PRODUCT_ID">See it on you</button>
 *  Opens TrendSet's try-on in a new window (first-party, so it works in every browser).
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var key = script.getAttribute("data-key") || "";
  var base = new URL(script.src).origin;
  if (!/^ts_pk_[0-9A-Za-z]{32}$/.test(key)) { console.warn("[TrendSet] data-key must be a publishable key (ts_pk_…)"); return; }

  function open(productId) {
    if (!/^[0-9a-f-]{36}$/i.test(productId || "")) { console.warn("[TrendSet] invalid product id"); return; }
    var url = base + "/embed/" + encodeURIComponent(productId) + "?key=" + encodeURIComponent(key);
    var w = window.open(url, "trendset_tryon", "width=480,height=880");
    if (!w) window.location.href = url; // popup blocked (or mobile): navigate instead
  }

  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("[data-trendset-product]") : null;
    if (!el) return;
    e.preventDefault();
    open(el.getAttribute("data-trendset-product"));
  });
  window.TrendSet = { open: open, version: "1" };
})();
