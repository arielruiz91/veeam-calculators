/* =====================================================
   VM Calculator — original script
   Handles: select-bars, switches, GFS expander,
   tooltips, calculation engine, results panel.
   ===================================================== */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const tooltip = $("tooltip");

  /* ---------- select-bars sync numeric input ---------- */
  document.querySelectorAll(".select-bar").forEach((bar) => {
    const targetId = bar.dataset.target;
    const target = targetId ? $(targetId) : null;
    bar.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        bar.querySelectorAll("button").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        if (target && btn.dataset.val != null) {
          target.value = btn.dataset.val;
          target.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
    });
    if (target) {
      target.addEventListener("input", () => {
        const v = String(target.value);
        const matched = Array.from(bar.querySelectorAll("button"))
          .find((b) => b.dataset.val === v);
        bar.querySelectorAll("button").forEach((b) => b.classList.remove("is-active"));
        if (matched) matched.classList.add("is-active");
      });
    }
  });

  /* ---------- top-level tab switcher (visual only) ---------- */
  document.querySelectorAll(".tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tabs .tab").forEach((t) => {
        t.classList.remove("is-active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("is-active");
      tab.setAttribute("aria-selected", "true");
    });
  });

  /* ---------- operation buttons ---------- */
  document.querySelectorAll(".op-bar .op").forEach((op) => {
    op.addEventListener("click", () => {
      document.querySelectorAll(".op-bar .op").forEach((o) => o.classList.remove("is-active"));
      op.classList.add("is-active");
    });
  });

  /* ---------- Advanced toggle: hide Advanced card when off ---------- */
  const advToggle = $("advancedToggle");
  const advCard = $("advancedCard");
  advToggle.addEventListener("change", () => {
    advCard.style.display = advToggle.checked ? "" : "none";
  });

  /* ---------- info tooltips ---------- */
  document.querySelectorAll(".info-icon").forEach((el) => {
    el.addEventListener("mouseenter", showTip);
    el.addEventListener("mouseleave", hideTip);
    el.addEventListener("focus", showTip);
    el.addEventListener("blur", hideTip);
    el.setAttribute("tabindex", "0");
  });
  function showTip(e) {
    const text = e.currentTarget.dataset.tip;
    if (!text) return;
    tooltip.textContent = text;
    tooltip.hidden = false;
    const r = e.currentTarget.getBoundingClientRect();
    tooltip.style.top = (window.scrollY + r.top) + "px";
    tooltip.style.left = (window.scrollX + r.left + r.width / 2) + "px";
  }
  function hideTip() { tooltip.hidden = true; }

  /* ---------- helpers ---------- */
  const num = (id) => {
    const v = parseFloat($(id).value);
    return isNaN(v) ? 0 : v;
  };
  const fmtSize = (tb) => {
    if (!isFinite(tb) || tb <= 0) return "0 GB";
    if (tb >= 1024) return (tb / 1024).toFixed(2) + " PB";
    if (tb >= 1)    return tb.toFixed(2) + " TB";
    return (tb * 1024).toFixed(0) + " GB";
  };

  /* ---------- calculation engine ----------
     Source data is in TB (used). Daily incremental ≈ source × changeRate.
     Compression reduces the *full* size by the configured percent.
     Performance tier holds the daily restore points; capacity tier (if
     enabled) absorbs older restore points and any GFS long-term points.
  ---------------------------------------------- */
  function compute() {
    const op = document.querySelector(".op-bar .op.is-active")?.dataset.op || "vm-backup";

    const sourceTB     = num("sourceData");
    const changeRate   = num("changeRate") / 100;
    const window_h     = num("backupWindow");
    const directObj    = $("directToObject").checked;
    const refsXfs      = $("refsXfs").checked;
    const capacityTier = $("capacityTier").checked;
    const immutable    = $("immutability").checked;

    const dailies  = num("retDays");
    const weeklies = num("retWeeks");
    const monthlies= num("retMonths");
    const yearlies = num("retYears");

    const advanced = $("advancedToggle").checked;
    const forecastY = advanced ? Math.max(0, num("forecastYears")) : 0;
    const growthR   = advanced ? num("growthRate") / 100 : 0;
    const compress  = advanced ? num("compression") / 100 : 0.5;

    /* compression / dedupe factor */
    const cmpFactor = Math.max(0.05, 1 - compress);
    /* ReFS/XFS block-cloning saves space on synthetic fulls / clones */
    const refsSaving = refsXfs ? 0.85 : 1.0;

    /* full backup size on disk */
    const fullTB = sourceTB * cmpFactor * refsSaving;
    /* daily incremental size on disk */
    const incTB  = fullTB * changeRate;

    /* performance tier — keep dailies (1 full + N-1 incrementals) */
    const dailiesPoints = Math.max(0, dailies);
    const perfBaseTB =
      (dailiesPoints > 0 ? fullTB + Math.max(0, dailiesPoints - 1) * incTB : 0);

    /* immutability adds extra retained points */
    const immExtraTB = immutable ? incTB * 7 : 0;

    /* GFS points (long-term) */
    const gfsPoints = weeklies + monthlies + yearlies;
    const gfsTB = gfsPoints * fullTB;

    /* capacity tier */
    let capTB = 0;
    if (capacityTier) {
      capTB = gfsTB;
      if (directObj) capTB += perfBaseTB; /* mirror to object storage */
    }

    /* replication: target stores full + retention points worth of changes,
       no dedupe / compression on the target VM disks */
    let perfTB;
    if (op === "vm-rep" || op === "cdp") {
      perfTB = sourceTB + dailiesPoints * sourceTB * changeRate;
    } else {
      perfTB = perfBaseTB + immExtraTB;
    }

    /* growth forecast */
    const factor = Math.pow(1 + growthR, forecastY);
    const perfForecastTB = perfTB * factor;
    const capForecastTB  = capTB  * factor;
    const totalTB        = perfForecastTB + capForecastTB;

    return {
      op,
      sourceTB,
      fullTB, incTB,
      dailiesPoints, gfsPoints,
      perfTB: perfForecastTB,
      capTB:  capForecastTB,
      totalTB,
      forecastY,
      capacityTier,
      directObj,
      refsXfs,
      immutable,
      compress: compress * 100,
      changeRate: changeRate * 100,
    };
  }

  /* ---------- render results ---------- */
  const list = $("resultsList");
  const opLabels = {
    "vm-backup": "VM Backup",
    "agent":     "Agent Backup",
    "vm-rep":    "VM Replication",
    "cdp":       "CDP Replication",
  };

  function render(r) {
    document.querySelector(".results-empty")?.remove();

    const item = document.createElement("article");
    item.className = "result-item";
    item.innerHTML = `
      <button class="delete" aria-label="Remove">✕</button>
      <h3>${opLabels[r.op] || r.op}</h3>
      <div class="row"><span>Source data</span><strong>${fmtSize(r.sourceTB)}</strong></div>
      <div class="row"><span>Full backup</span><strong>${fmtSize(r.fullTB)}</strong></div>
      <div class="row"><span>Daily incremental</span><strong>${fmtSize(r.incTB)}</strong></div>
      <div class="row"><span>Restore points (dailies)</span><strong>${r.dailiesPoints}</strong></div>
      ${r.gfsPoints > 0
        ? `<div class="row"><span>GFS points</span><strong>${r.gfsPoints}</strong></div>`
        : ""}
      <div class="row"><span>Performance tier</span><strong>${fmtSize(r.perfTB)}</strong></div>
      ${r.capacityTier
        ? `<div class="row"><span>Capacity tier</span><strong>${fmtSize(r.capTB)}</strong></div>`
        : ""}
      ${r.forecastY > 0
        ? `<div class="row"><span>Forecast</span><strong>${r.forecastY} yr(s)</strong></div>`
        : ""}
      <div class="row total"><span>Total estimate</span><strong>${fmtSize(r.totalTB)}</strong></div>
    `;
    item.querySelector(".delete").addEventListener("click", () => {
      item.remove();
      if (!list.querySelector(".result-item")) {
        const empty = document.createElement("p");
        empty.className = "results-empty";
        empty.innerHTML = 'No estimates yet. Click <strong>ESTIMATE</strong> to compute.';
        list.appendChild(empty);
      }
    });
    list.appendChild(item);
  }

  /* ---------- form submit ---------- */
  $("calcForm").addEventListener("submit", (e) => {
    e.preventDefault();
    render(compute());
  });

  /* keyboard shortcut: Ctrl+Enter */
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      render(compute());
    }
  });

  /* clear all */
  $("clearResults").addEventListener("click", () => {
    list.innerHTML = "";
    const empty = document.createElement("p");
    empty.className = "results-empty";
    empty.innerHTML = 'No estimates yet. Click <strong>ESTIMATE</strong> to compute.';
    list.appendChild(empty);
  });

  /* reset fields */
  $("resetBtn").addEventListener("click", () => {
    $("sourceData").value = 20;
    $("changeRate").value = 5;
    $("backupWindow").value = 8;
    $("retDays").value = 14;
    $("retWeeks").value = 0;
    $("retMonths").value = 0;
    $("retYears").value = 0;
    $("forecastYears").value = 3;
    $("growthRate").value = 10;
    $("compression").value = 50;
    $("directToObject").checked = false;
    $("refsXfs").checked = true;
    $("capacityTier").checked = false;
    $("immutability").checked = false;
    document.querySelectorAll(".select-bar").forEach((bar) => {
      const targetId = bar.dataset.target;
      const target = targetId ? $(targetId) : null;
      if (!target) return;
      target.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });

  /* sidebar collapse on mobile */
  $("navToggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("is-open");
  });
})();
