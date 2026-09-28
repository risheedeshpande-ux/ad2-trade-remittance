/* Remit4Me TMP — prototype interaction layer.
   Vanilla, no deps. Native <dialog> gives focus trap, Esc and backdrop free. */
(function () {
  "use strict";

  /* ---------- dialogs ---------- */
  function openDlg(id, trigger) {
    var d = document.getElementById(id);
    if (!d) { toast("No dialog wired for this action yet", "warn"); return; }
    // stamp the invoking context so the dialog can echo what was clicked
    var ctx = d.querySelector("[data-ctx]");
    if (ctx && trigger) {
      var row = trigger.closest("tr");
      var ref = row && row.querySelector(".ref");
      ctx.textContent = ref ? ref.textContent.trim() : (trigger.dataset.ctxlabel || ctx.dataset.ctx || "");
    }
    resetDlg(d);
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
  }
  function resetDlg(d) {
    d.querySelectorAll(".err").forEach(function (e) { e.hidden = true; });
    d.querySelectorAll("textarea,input[type=text]").forEach(function (i) { if (!i.dataset.keep) i.value = ""; });
    d.querySelectorAll("select").forEach(function (s) { s.selectedIndex = 0; });
    d.querySelectorAll("[data-needs]").forEach(function (b) { b.disabled = false; });
  }
  function closeDlg(d) { if (d.close) d.close(); else d.removeAttribute("open"); }

  /* ---------- toast ---------- */
  var host;
  function toast(msg, kind) {
    if (!host) {
      host = document.createElement("div");
      host.className = "toast-host";
      document.body.appendChild(host);
    }
    var t = document.createElement("div");
    t.className = "toast" + (kind ? " " + kind : " ok");
    t.setAttribute("role", "status");
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(function () { t.classList.add("out"); }, 3200);
    setTimeout(function () { t.remove(); }, 3600);
  }

  /* ---------- global click routing ---------- */
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-dlg]");
    if (t) { e.preventDefault(); openDlg(t.dataset.dlg, t); return; }

    var c = e.target.closest("[data-close]");
    if (c) { e.preventDefault(); closeDlg(c.closest("dialog")); return; }

    /* confirm inside a dialog — validate required reason, then toast */
    var ok = e.target.closest("[data-confirm]");
    if (ok) {
      e.preventDefault();
      var d = ok.closest("dialog");
      if (d) {
        var need = d.querySelector("[data-required]");
        if (need && !need.value.trim()) {
          var err = d.querySelector(".err");
          if (err) err.hidden = false;
          need.focus();
          return;
        }
        closeDlg(d);
      }
      toast(ok.dataset.confirm, ok.dataset.kind || "ok");
      return;
    }

    /* tabs / segmented controls */
    var tab = e.target.closest("[data-tab]");
    if (tab) {
      e.preventDefault();
      var grp = tab.closest("[data-tabs]");
      if (grp) {
        grp.querySelectorAll("[data-tab]").forEach(function (x) { x.classList.toggle("on", x === tab); });
        var panes = document.querySelectorAll('[data-pane]');
        panes.forEach(function (p) {
          if (p.dataset.owner === grp.dataset.tabs) p.hidden = (p.dataset.pane !== tab.dataset.tab);
        });
      }
      return;
    }

    /* back — history where possible, breadcrumb parent otherwise */
    var back = e.target.closest("[data-back]");
    if (back) {
      e.preventDefault();
      if (history.length > 1) { history.back(); }
      else {
        var parent = document.querySelector(".crumbs a:nth-last-of-type(1)");
        window.location.href = parent ? parent.getAttribute("href") : "index.html";
      }
      return;
    }

    /* status/lifecycle tabs on a worklist */
    var st = e.target.closest("[data-toggle-status]");
    if (st) {
      e.preventDefault();
      var bar = st.parentElement;
      bar.querySelectorAll("[data-toggle-status]").forEach(function (b) { b.classList.toggle("on", b === st); });
      toast("Filtered: " + st.childNodes[0].textContent.trim());
      return;
    }

    /* filter chips toggle */
    var chip = e.target.closest(".chip[data-toggle]");
    if (chip) { e.preventDefault(); chip.classList.toggle("on"); return; }
  });

  /* ---------- allocation / knock-off live maths ---------- */
  function recalc(scope) {
    var rows = scope.querySelectorAll("tr[data-amt]");
    var sel = 0, selOpen = 0, n = 0;
    rows.forEach(function (r) {
      var cb = r.querySelector('input[type=checkbox]');
      if (cb && cb.checked) {
        sel += parseFloat(r.dataset.amt || 0);
        selOpen += parseFloat(r.dataset.open || r.dataset.amt || 0);
        n++;
      }
      r.classList.toggle("sel", !!(cb && cb.checked));
    });
    var pool = parseFloat(scope.dataset.pool || 0);
    // Grouping is a domain rule, not a formatting whim: INR uses lakh/crore
    // (1,00,000), foreign currency uses international (100,000). Allocation
    // screens are FCY, so international is the default; opt in with
    // data-grouping="in" on the scope for an INR table.
    var locale = scope.dataset.grouping === "in" ? "en-IN" : "en-US";
    var set = function (sel2, v) {
      scope.querySelectorAll(sel2).forEach(function (el) {
        el.textContent = v.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      });
    };
    set("[data-out=selected]", sel);
    set("[data-out=selectedopen]", selOpen);
    set("[data-out=remainder]", Math.max(pool - sel, 0));
    set("[data-out=over]", Math.max(sel - pool, 0));
    scope.querySelectorAll("[data-out=count]").forEach(function (el) { el.textContent = n; });
    var over = sel > pool;
    scope.querySelectorAll("[data-over-flag]").forEach(function (el) { el.hidden = !over; });
    scope.querySelectorAll("[data-needs=allocation]").forEach(function (b) { b.disabled = (n === 0 || over); });
  }
  document.addEventListener("change", function (e) {
    if (e.target.matches('input[type=checkbox]')) {
      var scope = e.target.closest("[data-alloc]");
      if (scope) recalc(scope);
    }
  });

  /* ---------- countdown clocks ---------- */
  function tick() {
    document.querySelectorAll("[data-countdown]").forEach(function (el) {
      var s = parseInt(el.dataset.countdown, 10);
      if (isNaN(s)) return;
      if (s <= 0) {
        el.textContent = "00:00";
        el.closest(".clock") && el.closest(".clock").classList.add("now");
        var exp = document.querySelector('[data-on-expire="' + el.dataset.expire + '"]');
        if (exp && exp.hidden) { exp.hidden = false; }
        return;
      }
      el.dataset.countdown = --s;
      el.textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    });
  }
  setInterval(tick, 1000);

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-alloc]").forEach(recalc);
    // backdrop click closes
    document.querySelectorAll("dialog").forEach(function (d) {
      d.addEventListener("click", function (e) { if (e.target === d) closeDlg(d); });
    });
  });

  window.TMP = { toast: toast, open: openDlg };
})();
