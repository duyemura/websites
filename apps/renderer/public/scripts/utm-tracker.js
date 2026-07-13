// Capture utm_* params on landing, persist for the session, inject into every form.
(function () {
  var KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  try {
    var params = new URLSearchParams(location.search);
    KEYS.forEach(function (k) {
      var v = params.get(k);
      if (v) sessionStorage.setItem(k, v);
    });
  } catch { /* sessionStorage unavailable — degrade silently */ }

  function inject() {
    document.querySelectorAll("form[data-lead-form]").forEach(function (form) {
      KEYS.forEach(function (k) {
        var v = sessionStorage.getItem(k);
        if (!v || form.querySelector('input[name="' + k + '"]')) return;
        var input = document.createElement("input");
        input.type = "hidden"; input.name = k; input.value = v;
        form.appendChild(input);
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject);
  else inject();
})();
