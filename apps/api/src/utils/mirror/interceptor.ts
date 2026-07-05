export const INTERCEPTOR_SCRIPT = /* js */ `(function () {
  var scriptEl = document.querySelector('script[src*="milo-forms.js"]');
  var siteUuid = scriptEl && scriptEl.dataset ? scriptEl.dataset.siteUuid : '';
  if (!siteUuid) return;

  var endpoint = '/api/forms/' + siteUuid + '/';

  // Capture UTM params from current URL into sessionStorage on every page load
  (function () {
    try {
      var p = new URLSearchParams(window.location.search);
      var utm = {};
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (k) {
        var v = p.get(k);
        if (v) utm[k] = v;
      });
      if (Object.keys(utm).length > 0) {
        sessionStorage.setItem('milo_utm', JSON.stringify(utm));
      }
    } catch (e) {}
  })();

  function getUtm() {
    try { return JSON.parse(sessionStorage.getItem('milo_utm') || '{}'); } catch (e) { return {}; }
  }

  function djb2(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h, 33) ^ str.charCodeAt(i);
    }
    return (h >>> 0).toString(36);
  }

  function getFormId(form, index) {
    var names = [];
    var els = form.elements;
    for (var i = 0; i < els.length; i++) {
      var n = els[i].name;
      if (n && n !== '_hp') names.push(n);
    }
    names.sort();
    return djb2((window.location.pathname || '/') + ':' + index + ':' + names.join(','));
  }

  function isLeadForm(form) {
    if (form.getAttribute('role') === 'search') return false;
    if (form.querySelector('input[type="password"]')) return false;
    var inputs = form.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="tel"], textarea'
    );
    return inputs.length > 0;
  }

  function showSuccess(form) {
    var p = document.createElement('p');
    p.textContent = 'Thanks — we\\'ll be in touch.';
    if (form.parentNode) form.parentNode.replaceChild(p, form);
  }

  function passthroughSubmit(form, action, data) {
    try {
      // Build a hidden form and submit it to the original action via a hidden iframe.
      // This bypasses CORS and lets the external system (GoHighLevel, etc.) receive the lead
      // while the visitor sees our inline success message.
      var iframeName = 'milo-passthrough-' + Math.random().toString(36).slice(2);
      var iframe = document.createElement('iframe');
      iframe.name = iframeName;
      iframe.style.display = 'none';
      document.body.appendChild(iframe);

      var ghost = document.createElement('form');
      ghost.method = form.method || 'POST';
      ghost.action = action;
      ghost.target = iframeName;
      ghost.style.display = 'none';

      // Submit all form fields (use the serialized data object, not the UTM-merged payload)
      Object.keys(data).forEach(function (k) {
        if (k === '_hp') return;
        var input = document.createElement('input');
        input.type = 'hidden';
        input.name = k;
        input.value = String(data[k]);
        ghost.appendChild(input);
      });

      document.body.appendChild(ghost);
      ghost.submit();

      // Clean up after the iframe has had time to submit
      setTimeout(function () {
        try { document.body.removeChild(iframe); } catch (e) {}
        try { document.body.removeChild(ghost); } catch (e) {}
      }, 5000);
    } catch (e) {
      // Passthrough failure is silent — we already captured the lead
    }
  }

  function wireForm(form, index) {
    if (form.__miloWired) return;
    if (!isLeadForm(form)) return;
    form.__miloWired = true;

    form.addEventListener('submit', function handler(e) {
      e.preventDefault();
      var formId = getFormId(form, index);
      var data = {};
      var els = form.elements;
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (!el.name) continue;
        if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) continue;
        data[el.name] = el.value;
      }
      // Merge UTM on top of form fields — form field values win over UTM keys
      var payload = Object.assign({}, getUtm(), data);

      fetch(endpoint + formId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
      }).then(function (res) {
        if (res.ok) {
          var originalAction = form.getAttribute('data-milo-original-action');
          if (originalAction) {
            // Pass raw form fields (not UTM-merged payload) to the external system
            passthroughSubmit(form, originalAction, data);
          }
          showSuccess(form);
        } else {
          form.removeEventListener('submit', handler);
          form.__miloWired = false;
          form.submit();
        }
      }).catch(function () {
        form.removeEventListener('submit', handler);
        form.__miloWired = false;
        form.submit();
      });
    });
  }

  function wireAll() {
    var forms = document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) {
      wireForm(forms[i], i);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireAll);
  } else {
    wireAll();
  }

  if (window.MutationObserver) {
    new MutationObserver(function () {
      try { wireAll(); } catch (e) {}
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
})();`;
