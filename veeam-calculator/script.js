(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const form = $("calcForm");
  const resetBtn = $("resetBtn");
  const tooltip = $("tooltip");

  // Toggle dependent blocks
  $("immutability").addEventListener("change", (e) => {
    $("immutabilityRow").hidden = !e.target.checked;
  });
  $("capacityTier").addEventListener("change", (e) => {
    $("capacityTierBlock").hidden = !e.target.checked;
    if (!e.target.checked) {
      $("useGFS").checked = false;
      $("gfsBlock").hidden = true;
    }
  });
  $("useGFS").addEventListener("change", (e) => {
    $("gfsBlock").hidden = !e.target.checked;
  });

  // Tooltip behaviour
  document.querySelectorAll(".info").forEach((btn) => {
    btn.addEventListener("mouseenter", showTooltip);
    btn.addEventListener("focus", showTooltip);
    btn.addEventListener("mouseleave", hideTooltip);
    btn.addEventListener("blur", hideTooltip);
  });

  function showTooltip(e) {
    const text = e.currentTarget.dataset.tip;
    if (!text) return;
    tooltip.textContent = text;
    tooltip.hidden = false;
    const rect = e.currentTarget.getBoundingClientRect();
    const top = window.scrollY + rect.top;
    const left = window.scrollX + rect.left + rect.width / 2;
    tooltip.style.top = top + "px";
    tooltip.style.left = left + "px";
  }
  function hideTooltip() {
    tooltip.hidden = true;
  }

  // Stepper highlight while scrolling
  const panels = Array.from(document.querySelectorAll("[data-panel]"));
  const stepEls = Array.from(document.querySelectorAll(".step"));
  function updateStep() {
    const y = window.scrollY + 140;
    let active = panels[0];
    for (const p of panels) {
      if (p.offsetTop <= y) active = p;
    }
    const activeNum = active.dataset.panel;
    stepEls.forEach((el) => {
      const n = el.dataset.step;
      el.classList.toggle("is-active", n === activeNum);
      el.classList.toggle("is-complete", Number(n) < Number(activeNum));
    });
  }
  window.addEventListener("scroll", updateStep, { passive: true });
  updateStep();

  // ============================
  //   Calculation engine
  // ============================
  function num(id) {
    const v = parseFloat($(id).value);
    return isNaN(v) ? 0 : v;
  }

  function toGB(value, unit) {
    return unit === "TB" ? value * 1024 : value;
  }

  function fmt(gb) {
    if (gb <= 0) return "0 GB";
    if (gb >= 1024 * 1024) return (gb / 1024 / 1024).toFixed(2) + " PB";
    if (gb >= 1024) return (gb / 1024).toFixed(2) + " TB";
    return gb.toFixed(1) + " GB";
  }

  function calculate() {
    const vmCount = num("vmCount");
    const avgSize = num("avgSize");
    const avgUnit = $("avgSizeUnit").value;
    const sourceGB = vmCount * toGB(avgSize, avgUnit);

    const compression = num("compression") || 1;
    const changeRate = num("changeRate") / 100;
    const retention = Math.max(1, num("retention"));
    const backupMode = $("backupMode").value;

    const fullGB = sourceGB / compression;
    const incGB = fullGB * changeRate;

    // performance tier base footprint
    let perfFulls = 1;
    if (backupMode === "syntheticFull") perfFulls = Math.max(1, Math.ceil(retention / 7));
    if (backupMode === "forwardIncremental") perfFulls = Math.max(1, Math.ceil(retention / 7));
    const perfIncs = Math.max(0, retention - perfFulls);
    let perfBase = perfFulls * fullGB + perfIncs * incGB;

    // immutability adds extra restore points kept around (~immutability days of incrementals)
    const immutability = $("immutability").checked;
    const immutabilityDays = immutability ? num("immutabilityDays") : 0;
    if (immutability) {
      perfBase += immutabilityDays * incGB * 0.5; // overhead estimate
    }

    // capacity tier
    const capacityTier = $("capacityTier").checked;
    const opWindow = capacityTier ? num("operationalWindow") : 0;
    const capacityMode = $("capacityMode").value;
    let capacityBase = 0;
    let capPoints = 0;

    if (capacityTier) {
      const offloaded = Math.max(0, retention - opWindow);
      capPoints = offloaded;
      capacityBase = offloaded > 0 ? fullGB + Math.max(0, offloaded - 1) * incGB : 0;
      if (capacityMode === "copy") capacityBase = perfBase; // mirror
      if (capacityMode === "both") capacityBase = perfBase + (offloaded > 0 ? fullGB : 0);
    }

    // GFS
    const useGFS = capacityTier && $("useGFS").checked;
    const gfsWeekly    = useGFS ? num("gfsWeekly")    : 0;
    const gfsMonthly   = useGFS ? num("gfsMonthly")   : 0;
    const gfsQuarterly = useGFS ? num("gfsQuarterly") : 0;
    const gfsYearly    = useGFS ? num("gfsYearly")    : 0;
    const gfsPoints = gfsWeekly + gfsMonthly + gfsQuarterly + gfsYearly;
    const gfsGB = gfsPoints * fullGB;
    capacityBase += gfsGB;

    // replication uses full + incremental but no compression
    if ($("operation").value === "replication") {
      perfBase = sourceGB + retention * (sourceGB * changeRate);
      capacityBase = 0;
    }

    // forecast growth
    const growth = num("growthRate") / 100;
    const years = num("forecastYears");
    const factor = Math.pow(1 + growth, years);
    const perfForecast = perfBase * factor;
    const capForecast = capacityBase * factor;
    const totalForecast = perfForecast + capForecast;

    // render
    $("rSource").textContent = fmt(sourceGB);
    $("rPerformance").textContent = fmt(perfForecast);
    $("rCapacity").textContent = capacityTier ? fmt(capForecast) : "—";
    $("rCapacityMeta").textContent = capacityTier ? "Object storage" : "Not enabled";
    $("rTotal").textContent = fmt(totalForecast);

    $("bFull").textContent = fmt(fullGB);
    $("bIncremental").textContent = fmt(incGB);
    $("bPerfPoints").textContent = retention + " points (" + perfFulls + " full + " + perfIncs + " inc)";
    $("bCapPoints").textContent = capacityTier ? capPoints + " points" : "—";
    $("bGfsPoints").textContent = useGFS ? gfsPoints + " GFS points" : "—";
    $("bForecast").textContent = "× " + factor.toFixed(2) + " over " + years + " year(s)";

    // mark the last step as active
    stepEls.forEach((el) => el.classList.remove("is-active"));
    const last = stepEls.find((el) => el.dataset.step === "5");
    if (last) last.classList.add("is-active");

    document.getElementById("results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    calculate();
  });

  resetBtn.addEventListener("click", () => {
    form.reset();
    $("immutabilityRow").hidden = true;
    $("capacityTierBlock").hidden = true;
    $("gfsBlock").hidden = true;
    ["rSource","rPerformance","rCapacity","rTotal","bFull","bIncremental","bPerfPoints","bCapPoints","bGfsPoints","bForecast"]
      .forEach((id) => { $(id).textContent = "—"; });
    $("rCapacityMeta").textContent = "Object storage";
  });

  // run an initial calculation so users see something on load
  calculate();
})();
