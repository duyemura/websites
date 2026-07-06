// Standard events: CTA clicks + lead form submits → GA4 (gtag/dataLayer) + Meta Pixel (fbq).
(function () {
  function fire(gaEvent, fbEvent) {
    try {
      if (window.gtag) window.gtag("event", gaEvent);
      else if (window.dataLayer) window.dataLayer.push({ event: gaEvent });
      if (window.fbq) window.fbq("track", fbEvent);
    } catch (e) { /* never break the page for tracking */ }
  }
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest && e.target.closest("[data-track]");
    if (!el) return;
    var kind = el.getAttribute("data-track");
    if (kind === "contact") fire("contact", "Contact");
    if (kind === "trial") fire("begin_checkout", "InitiateCheckout");
  });
  document.addEventListener("submit", function (e) {
    if (e.target && e.target.matches && e.target.matches("form[data-lead-form]")) {
      fire("generate_lead", "Lead");
    }
  });
})();
