(function () {
  "use strict";

  /* ------------------------------------------------------------------ data */
  var DATA;
  try { DATA = JSON.parse(document.getElementById("events-data").textContent); }
  catch (e) { document.getElementById("list").textContent = "Could not read the event data."; return; }
  var EVENTS = DATA.events || [];

  /* -------------------------------------------------------------- storage */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  var NS = "rmagenda:";

  /* ---------------------------------------------------------------- icons */
  var ICONS = {
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    theatre: '<path d="M4 4h16v6a8 8 0 0 1-16 0z"/><path d="M8.5 9h1M14.5 9h1"/><path d="M9 13.5a4 4 0 0 0 6 0"/>',
    cinema: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    festival: '<path d="M2 5h20"/><path d="M3.5 5l2.5 6 2.5-6M9.5 5l2.5 6 2.5-6M15.5 5l2.5 6 2.5-6"/><path d="M6 16h12M8 20h8"/>',
    market: '<path d="M3 9l2-5h14l2 5"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 12v8h14v-8"/><path d="M10 20v-4h4v4"/>',
    sport: '<circle cx="12" cy="14" r="7"/><path d="M12 14v-4M10 3h4M12 3v4M18.5 7.5l1.5-1.5"/>',
    exhibition: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="8.5" r="1.5"/>',
    kids: '<path d="M12 3a6 6 0 0 1 6 6c0 4-3.5 7-6 7s-6-3-6-7a6 6 0 0 1 6-6z"/><path d="M11 18h2l-1-2z"/><path d="M12 18c0 2 1.5 2 .5 4"/>',
    food: '<path d="M8 3h8l-.5 5a3.5 3.5 0 0 1-7 0z"/><path d="M12 11.5V20M8 21h8"/>',
    nature: '<path d="M2 20l7-11 4 6 3-4 6 9z"/><circle cx="17" cy="5" r="2"/>',
    workshop: '<path d="M14.5 4.5l5 5L9 20H4v-5z"/><path d="M12 7l5 5"/>',
    other: '<circle cx="12" cy="12" r="9"/><path d="M8 12h.01M12 12h.01M16 12h.01" stroke-width="2.5"/>'
  };
  var UI = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
    chev: '<path d="M6 9l6 6 6-6"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    cont: '<path d="M5 4v8a4 4 0 0 0 4 4h10"/><path d="M15 12l4 4-4 4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor"/>'
  };
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>';
  function icon(name, cls) {
    var p = ICONS[name] || UI[name] || ICONS.other;
    return '<svg class="icon' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true">' + p + "</svg>";
  }
  var CATS = {
    music: "Music", theatre: "Theatre", cinema: "Cinema", festival: "Festival & fair", market: "Market",
    sport: "Sport & running", exhibition: "Exhibition", kids: "Kids & family", food: "Food & wine",
    nature: "Nature & walks", workshop: "Workshop", other: "Other"
  };
  var CAT_ALIASES = { "festival/fair": "festival", "sport/running": "sport", "kids/family": "kids", "food & wine": "food", "food_wine": "food", "nature/walk": "nature" };
  EVENTS.forEach(function (e) { e.category = CAT_ALIASES[e.category] || e.category; if (!CATS[e.category]) e.category = "other"; });

  /* ---------------------------------------------------------------- dates */
  var WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function parse(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function iso(d) { return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); }
  function add(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function dow(s) { return parse(s).getDay(); }
  function diff(a, b) { return Math.round((parse(b) - parse(a)) / 864e5); }
  function fmtDay(s) { var d = parse(s); return WD[d.getDay()] + " " + d.getDate() + " " + MO[d.getMonth()]; }
  function fmtShort(s) { var d = parse(s); return d.getDate() + " " + MO[d.getMonth()]; }
  /* "23 Nov 2026–20 Apr 2027" when a range crosses a year boundary, "23 Nov–20 Apr" otherwise; fmtShort stays compact */
  function fmtYear(s) { return fmtShort(s) + " " + parse(s).getFullYear(); }
  function fmtSpan(a, b) { return a.slice(0, 4) === b.slice(0, 4) ? fmtShort(a) + "–" + fmtShort(b) : fmtYear(a) + "–" + fmtYear(b); }
  function isWeekend(s) { var w = dow(s); return w === 0 || w === 5 || w === 6; }   // Friday to Sunday, as in the bands
  var WIN = DATA.window;
  /* The coming weeks end at NEAR (bands, strip, stale notice); later days are banded by month. A near_end that is absent or
     outside the window (render.ts rejects that, but the page must not break on it) means the whole window is dated. */
  var NEAR = WIN.near_end && WIN.near_end >= WIN.start && WIN.near_end <= WIN.end ? WIN.near_end : WIN.end;
  var realToday = iso(new Date());
  var stale = realToday > NEAR;
  var TODAY = realToday < WIN.start || stale ? WIN.start : realToday;   // first day shown; the real date is realToday
  var BAND_FROM = stale ? WIN.start : realToday;                        // bands and the Today mark follow the real date
  var inWindow = realToday >= WIN.start && !stale;

  /* expand each event to the dated days it appears on */
  EVENTS.forEach(function (e) {
    e._days = [];
    if (e.date_tbc) return;
    if (e.kind === "recurring") { e._days = (e.dates || []).slice(); return; }
    if (e.kind === "ongoing") return;
    if (!e.start_date) { e.date_tbc = true; return; }
    var end = e.end_date || e.start_date;
    for (var d = e.start_date; d <= end; d = add(d, 1)) e._days.push(d);
  });

  /* an event whose first day is after NEAR is placed by that day, whatever its kind */
  function aheadStart(e) {
    if (e.kind === "recurring") { var nx = (e.dates || []).filter(function (d) { return d >= TODAY; })[0]; return nx && nx > NEAR ? nx : null; }
    return e.start_date && e.start_date > NEAR ? e.start_date : null;
  }
  EVENTS.forEach(function (e) {
    e._ahead = e.date_tbc ? null : aheadStart(e);   // an undated event is never placed: it has no day to put on the calendar
    /* an exhibition or run that opens after NEAR sits on its opening day; one already open stays in Ongoing */
    if (e._ahead && e.kind === "ongoing") e._days = [e.start_date];
    /* a regular whose next date is by NEAR keeps its card in Regulars, and a far day has no row for it to jump to, so its
       dots stop at NEAR (merge cuts its dates there when recurrence has text; without, a far date would be a dead dot) */
    if (e.kind === "recurring" && !e._ahead) e._days = e._days.filter(function (d) { return d <= NEAR; });
  });
  /* The month grids run through the last month with a day to mark, and at least through NEAR's month: an empty April
     would read as "nothing on", a missing one as "not covered", and the grid note says which. Worked out once, with no
     filters, so the calendar does not grow and shrink as the filters change. */
  var LAST = NEAR;
  EVENTS.forEach(function (e) { e._days.forEach(function (d) { if (d > LAST && d <= WIN.end) LAST = d; }); });
  var GRID_END = LAST.slice(0, 7);

  /* -------------------------------------------------- stars & "new" state */
  function stored(k, ok, d) { var v = store.get(NS + k, d); return ok(v) ? v : d; }
  var stars = new Set(stored("stars", Array.isArray, []).filter(function (x) { return typeof x === "string"; }));
  function saveStars() { store.set(NS + "stars", Array.from(stars)); }
  var newIds = (function () {
    var cur = EVENTS.map(function (e) { return e.id; });
    var rec = stored("visit", function (v) { return v && typeof v === "object" && Array.isArray(v.ids) && (v.prev == null || Array.isArray(v.prev)); }, null);
    var prev;
    if (rec && rec.generated_at === DATA.generated_at) prev = rec.prev;   // reload of same edition: keep markers
    else if (rec) prev = rec.ids;
    else prev = null;                                                       // first ever visit: nothing is "new"
    store.set(NS + "visit", { generated_at: DATA.generated_at, ids: cur, prev: prev });
    if (!prev) return new Set();
    var p = new Set(prev);
    return new Set(cur.filter(function (id) { return !p.has(id); }));
  })();

  /* -------------------------------------------------------------- filters */
  function noFilters() { return { cats: new Set(), dist: "any", free: false, weekend: false, picks: false, q: "" }; }
  var F = noFilters();
  function norm(s) { return (s || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  EVENTS.forEach(function (e) { e._hay = norm([e.title_en, e.title_pt, e.town, e.venue, e.description_en, CATS[e.category]].join(" ")); });
  var NOFILTER = noFilters();
  /* every matcher takes the filters it applies, so the page can count what its own filters hide */
  function matchBase(e, f) {
    if (f.cats.size && !f.cats.has(e.category)) return false;
    if (f.dist === "20" && !(e.drive_min != null && e.drive_min <= 20)) return false;
    if (f.dist === "45" && !(e.drive_min != null && e.drive_min <= 45)) return false;
    if (f.free && !(e.price && e.price.free)) return false;
    if (f.picks && !stars.has(e.id)) return false;
    if (f.q && e._hay.indexOf(norm(f.q)) < 0) return false;
    return true;
  }
  /* The Weekend filter judges each day, near or far. An ongoing event on its opening day is exempt: the run spans the
     weekends after it, and near ongoing events stay under Weekend too. */
  function visibleDays(e, f) {
    var anyDay = e.kind === "ongoing";
    return e._days.filter(function (d) { return d >= TODAY && d <= WIN.end && (anyDay || !f.weekend || isWeekend(d)); });
  }

  /* --------------------------------------------------------------- helpers */
  function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : ""; }
  function link(u, inner, cls) { var h = safeUrl(u); return h ? '<a' + (cls ? ' class="' + cls + '"' : "") + ' href="' + esc(h) + '" target="_blank" rel="noopener">' + inner + "</a>" : inner; }
  function mapsUrl(e) { return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([e.venue, e.town, "Portugal"].filter(Boolean).join(", ")); }
  function spanLabel(e) {
    if (e.kind !== "multi_day" || !e.end_date || e.end_date === e.start_date) return "";
    var n = diff(e.start_date, e.end_date) + 1;
    if (n <= 7) return WD[dow(e.start_date)] + "–" + WD[dow(e.end_date)];
    return fmtShort(e.start_date) + "–" + fmtShort(e.end_date);
  }
  function placeLine(e, timeText) {
    var bits = [];
    bits.push(timeText);
    if (e.town) bits.push(esc(e.town));
    if (e.drive_min != null) bits.push('<span class="dist">' + (e.drive_min <= 5 ? "in town" : e.drive_min + " min") + '<span class="sr-only"> drive</span></span>');
    return bits.join('<span class="sep" aria-hidden="true"> · </span>');
  }
  function timeText(e) { return e.start_time ? '<time>' + esc(e.start_time) + "</time>" : '<span class="tbc">time tbc</span>'; }

  /* ------------------------------------------------------------------ card */
  function card(e, opts) {
    opts = opts || {};
    var starred = stars.has(e.id);
    var lead = opts.lead || timeText(e);
    var span = opts.noSpan ? "" : spanLabel(e);
    var srcLinks = (e.sources || []).filter(function (s) { return safeUrl(s.url); }).slice(0, 2).map(function (s, i) {
      return link(s.url, (i === 0 ? "Source" : "Source " + (i + 1)) + '<span class="sr-only">: ' + esc(s.name) + "</span>", "src");
    }).join("");
    var price = e.price ? '<span class="price' + (e.price.free ? " free" : "") + '">' + esc(e.price.free ? "Free" : e.price.text) + "</span>" : "";
    var warn = e.confidence === "low" ? '<div class="warn">' + icon("warn") + "<span><b>Check source</b> — " + esc(e.caveat || "details may be out of date") + "</span></div>" : "";
    var isNew = bigTag(e) + (newIds.has(e.id) ? '<span class="new-tag">New</span>' : "");
    var cal = e.date_tbc ? '<p class="past-note">No calendar file until the date is confirmed.</p>'
      : e.kind === "recurring" && !(e.dates && e.dates.length) ? '<p class="past-note">No calendar file: this regular event has no listed dates.</p>'
      : '<a class="btn" href="#" download="event.ics" data-ics="' + esc(e.id) + '">' + icon("cal") + "Add to calendar (.ics)</a>";
    var venue = e.venue || e.town ? '<a class="btn" href="' + esc(mapsUrl(e)) + '" target="_blank" rel="noopener">' + icon("pin") + "Map</a>" : "";
    var when = whenText(e);
    var id = (opts.idPrefix || "c-") + e.id;
    return '<article class="card' + (starred ? " starred" : "") + '" id="' + esc(id) + '" data-id="' + esc(e.id) + '" style="--cat: var(--c-' + e.category + ')">' +
      '<button class="card-toggle" type="button" aria-expanded="false" aria-controls="' + esc(id) + '-more">' +
        icon(e.category) +
        '<span><span class="sr-only">' + esc(CATS[e.category]) + ": </span>" +
          '<span class="t-en">' + (span ? '<span class="span-tag">' + span + "</span>" : "") + esc(e.title_en || e.title_pt) + isNew + "</span>" +
          (e.title_pt && e.title_pt !== e.title_en ? '<span class="t-pt" lang="pt">' + esc(e.title_pt) + "</span>" : "") +
        "</span>" +
        '<span class="line2">' + placeLine(e, lead) + "</span>" +
      "</button>" +
      '<div class="line3">' + price + (e.kids && e.category !== "kids" ? '<span class="fam">Family-friendly</span>' : "") + srcLinks +
        '<button class="star" type="button" data-star="' + esc(e.id) + '" aria-pressed="' + starred + '" aria-label="My pick: ' + esc(e.title_en || e.title_pt) + '">' + STAR + "</button>" +
      "</div>" + warn +
      '<div class="card-more" id="' + esc(id) + '-more">' +
        (e.description_en ? "<p>" + esc(e.description_en) + "</p>" : "") +
        "<dl><dt>When</dt><dd>" + when + "</dd>" +
        "<dt>Where</dt><dd>" + esc([e.venue, e.town].filter(Boolean).join(", ") || "tbc") + (e.drive_min != null ? " · " + e.drive_min + " min drive" : "") + "</dd>" +
        "<dt>Type</dt><dd>" + esc(CATS[e.category]) + "</dd>" +
        "<dt>Price</dt><dd>" + (e.price ? esc(e.price.text || (e.price.free ? "Free" : "")) : '<span class="tbc">not stated</span>') + "</dd></dl>" +
        venue + cal +
        "<ul>" + (e.sources || []).map(function (s) { return "<li>" + link(s.url, esc(s.name)) + "</li>"; }).join("") + "</ul>" +
      "</div>" +
    "</article>";
  }
  function whenText(e) {
    if (e.date_tbc) return '<span class="tbc">date to be confirmed</span>';
    var t = e.start_time ? " · " + esc(e.start_time) : ' · <span class="tbc">time tbc</span>';
    if (e.kind === "recurring") return esc(e.recurrence || "Recurring") + (e.start_time ? " · from " + esc(e.start_time) : "");
    if (e.kind === "ongoing") return (e.start_date ? fmtShort(e.start_date) + "–" : "until ") + fmtShort(e.end_date);
    if (e.end_date && e.end_date !== e.start_date) return fmtDay(e.start_date) + " – " + fmtDay(e.end_date) + t;
    return fmtDay(e.start_date) + t;
  }

  /* ------------------------------------------------------- header & notes */
  var okSources = (DATA.sources_checked || []).filter(function (s) { return s.ok; }).length;
  var nSources = (DATA.sources_checked || []).length;
  var gen = (DATA.generated_at || "").slice(0, 10);
  document.getElementById("meta").innerHTML =
    "Collected " + (gen ? fmtShort(gen) + " " + gen.slice(0, 4) : "?") + " · covers " + fmtShort(WIN.start) + "–" + fmtShort(NEAR) + (NEAR < WIN.end ? ", further ahead to " + fmtShort(WIN.end) : "") +
    ' · <a href="status.html">' + nSources + " sources" + (okSources < nSources ? ", " + (nSources - okSources) + " unreachable" : "") + " · build status</a>";
  if (DATA.note) { var np = document.createElement("p"); np.className = "meta"; np.id = "note"; np.textContent = DATA.note; document.getElementById("meta").insertAdjacentElement("afterend", np); }
  if (DATA.origin) document.getElementById("title").textContent = "What's on around " + DATA.origin;
  if (stale) document.getElementById("notice").innerHTML = '<p class="notice">This agenda covered ' + fmtShort(WIN.start) + "–" + fmtShort(NEAR) + " and is out of date. Ask for a fresh one.</p>";

  /* theme button: auto → light → dark */
  var themeBtn = document.getElementById("theme-btn");
  function applyTheme(t) {
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
    themeBtn.innerHTML = icon(t === "light" ? "sun" : t === "dark" ? "moon" : "auto", "icon-sm") + "<span>" + (t === "light" ? "Light" : t === "dark" ? "Dark" : "Auto") + "</span>";
    themeBtn.setAttribute("aria-label", "Colour theme: " + (t || "auto") + ". Change");
  }
  var theme = store.get(NS + "theme", document.documentElement.getAttribute("data-theme") || "auto");
  applyTheme(theme);
  themeBtn.addEventListener("click", function () {
    theme = theme === "auto" ? "light" : theme === "light" ? "dark" : "auto";
    store.set(NS + "theme", theme); applyTheme(theme);
  });

  /* --------------------------------------------------------- filter chips */
  var present = {};
  EVENTS.forEach(function (e) { present[e.category] = (present[e.category] || 0) + 1; });
  function chip(attrs, inner, pressed, extraCls) {
    return '<button type="button" class="chip' + (extraCls ? " " + extraCls : "") + '" aria-pressed="' + !!pressed + '" ' + attrs + ">" + inner + "</button>";
  }
  function renderFilters() {
    var catChips = Object.keys(CATS).filter(function (k) { return present[k]; }).map(function (k) {
      return chip('data-cat="' + k + '" style="--cat: var(--c-' + k + ')"', icon(k) + esc(CATS[k]) + ' <span class="n">' + present[k] + "</span>", F.cats.has(k), "cat");
    }).join("");
    var distChips = [["20", "≤ 20 min"], ["45", "≤ 45 min"], ["any", "Any distance"]].map(function (d) {
      return chip('data-dist="' + d[0] + '"', d[1], F.dist === d[0]);
    }).join("");
    var nPicks = EVENTS.filter(function (e) { return stars.has(e.id); }).length;
    document.getElementById("filters").innerHTML =
      '<div class="search"><label class="sr-only" for="q">Search events</label>' + icon("search") +
        '<input id="q" type="search" placeholder="Search title, town, venue…" autocomplete="off" value="' + esc(F.q) + '"></div>' +
      '<div class="chips" role="group" aria-label="Filters">' +
        chip('data-toggle="weekend"', "Weekend", F.weekend) + chip('data-toggle="free"', "Free", F.free) +
        chip('data-toggle="picks" id="picks-chip"', '<span aria-hidden="true">★</span> My picks <span class="n">(' + nPicks + ")</span>", F.picks) +
        distChips + '<span class="chip-sep" aria-hidden="true"></span>' + catChips + "</div>" +
      '<div class="result-line" id="result-line" aria-live="polite"></div>';
  }
  function updatePicksChip() {
    var n = EVENTS.filter(function (e) { return stars.has(e.id); }).length;
    var c = document.getElementById("picks-chip");
    if (c) c.querySelector(".n").textContent = "(" + n + ")";
  }
  renderFilters();
  var filtersEl = document.getElementById("filters");
  filtersEl.addEventListener("click", function (ev) {
    var b = ev.target.closest(".chip"); if (!b) return;
    if (b.dataset.cat) { F.cats.has(b.dataset.cat) ? F.cats.delete(b.dataset.cat) : F.cats.add(b.dataset.cat); b.setAttribute("aria-pressed", F.cats.has(b.dataset.cat)); }
    else if (b.dataset.dist) { F.dist = b.dataset.dist; filtersEl.querySelectorAll("[data-dist]").forEach(function (x) { x.setAttribute("aria-pressed", x.dataset.dist === F.dist); }); }
    else if (b.dataset.toggle) { F[b.dataset.toggle] = !F[b.dataset.toggle]; b.setAttribute("aria-pressed", F[b.dataset.toggle]); }
    renderAll();
  });
  var qTimer;
  filtersEl.addEventListener("input", function (ev) {
    if (ev.target.id !== "q") return;
    clearTimeout(qTimer); qTimer = setTimeout(function () { F.q = ev.target.value.trim(); renderAll(); }, 120);
  });
  function resetFilters() {
    F = noFilters();
    renderFilters(); renderAll();
  }
  filtersEl.addEventListener("click", function (ev) {
    if (ev.target.id === "clear-filters") resetFilters();
  });
  document.getElementById("main").addEventListener("click", function (ev) {
    if (ev.target.closest("[data-clear]")) resetFilters();
  });

  /* ------------------------------------------------------------ bands */
  function bandsFor(today) {
    var w = dow(today);                         // 0 Sun..6 Sat
    var mon = add(today, -((w + 6) % 7));       // Monday of this week
    var fri = add(mon, 4), sun = add(mon, 6), nextSun = add(mon, 13);
    var list = [];
    if (today < fri) list.push({ key: "week", title: "This week", from: today, to: add(fri, -1) });
    list.push({ key: "weekend", title: "This weekend", from: today > fri ? today : fri, to: sun, weekend: true });
    list.push({ key: "next", title: "Next week", from: add(sun, 1), to: nextSun });
    if (add(nextSun, 1) <= NEAR) list.push({ key: "later", title: "Later", from: add(nextSun, 1), to: NEAR });
    return list;
  }

  /* ------------------------------------------------------- main render */
  var dayCounts = {};   // date -> {n, star}
  /* what each part of the page holds under the filters f (F, or NOFILTER to count everything) */
  function sections(f) {
    var base = EVENTS.filter(function (e) { return matchBase(e, f); });
    var near = base.filter(function (e) { return !e._ahead; });
    var s = {};
    /* on the days: single and multi-day events, and what first happens after NEAR (an opening, a regular's first date) */
    s.dated = base.filter(function (e) { return !e.date_tbc && (e.kind === "single" || e.kind === "multi_day" || e._ahead); });
    s.ongoing = near.filter(function (e) { return e.kind === "ongoing" && e.end_date >= TODAY; });
    s.regulars = near.filter(function (e) { return e.kind === "recurring" && !e.date_tbc && (!e.dates || !e.dates.length || e.dates.some(function (d) { return d >= TODAY; })) && (!f.weekend || !e.dates || e.dates.some(isWeekend) || /sat|sun|weekend/i.test(e.recurrence || "")); });
    /* the one list left: what has no day to sit on, until its month, or the day the source gave, is behind us (the page
       is built weekly and read all week, so a "November, day tbc" would otherwise outlive November) */
    s.tbc = base.filter(function (e) { return e.date_tbc && !tbcPast(e); });
    var onDays = s.dated.filter(function (e) { return visibleDays(e, f).length; });
    s.nFar = onDays.filter(function (e) { return e._ahead; }).length;
    s.nDated = onDays.length + s.ongoing.length + s.regulars.length;
    return s;
  }
  /* What the page holds with no filters on, for the "hidden by your filters" counts. It reads nothing that changes
     (NOFILTER has picks off, so not the stars; TODAY and NEAR are fixed), so it is worked out once, not per keystroke. */
  var ALL = null;
  function unfiltered() { return ALL || (ALL = sections(NOFILTER)); }
  function tbcPast(e) {
    var s = e.start_date || "";
    return s.length === 7 ? s < TODAY.slice(0, 7) : !!s && (e.end_date || s) < TODAY;
  }
  function hiddenLine(n, where) {
    return n > 0 ? '<p class="hidden-line">' + n + (n === 1 ? " more event " : " more events ") + where + ' hidden by your filters. <button type="button" class="linkish" data-clear>Show all</button></p>' : "";
  }
  /* day -> entries, and the dots each day gets (dayCounts, read by the rail and the strip); a star changes only the dots,
     so recountStars counts again with the same filters rather than drawing the rail from the old counts */
  function countDays(S) {
    var byDay = {}; dayCounts = {};
    S.dated.forEach(function (e) {
      if (e.date_tbc) return;
      var vis = visibleDays(e, F); if (!vis.length) return;
      vis.forEach(function (d, i) {
        (byDay[d] = byDay[d] || []).push({ e: e, first: i === 0, idx: e._days.indexOf(d) + 1, total: e._days.length });
        var c = dayCounts[d] = dayCounts[d] || { n: 0, star: false };
        c.n++; if (stars.has(e.id)) c.star = true;
      });
    });
    /* regular dated occurrences add dots (not list rows) */
    S.regulars.forEach(function (e) { visibleDays(e, F).forEach(function (d) { var c = dayCounts[d] = dayCounts[d] || { n: 0, star: false }; c.n++; if (stars.has(e.id)) c.star = true; }); });
    return byDay;
  }
  var tbcShown = 0, farShown = [];   // for the strip chips and the rail link: the far months drawn now, and the undated list
  function renderAll() {
    var S = sections(F), all = unfiltered();
    var dated = S.dated, ongoing = S.ongoing, regulars = S.regulars, tbc = S.tbc;
    tbcShown = tbc.length;   // the band's own count: a chip never reads more than the band it opens, and at 0 the chip and link are left out, as a month chip is

    var byDay = countDays(S);

    /* blocks */
    var blocks = "";
    var openOngoing = store.get(NS + "open-ongoing", false), openReg = store.get(NS + "open-regulars", false);
    if (ongoing.length) blocks += '<details class="block" id="blk-ongoing"' + (openOngoing ? " open" : "") + '><summary><span>Ongoing — exhibitions &amp; runs <span class="count">· ' + ongoing.length + '</span></span><span class="hint">' + esc(ongoing.map(function (e) { return e.title_en; }).join(" · ")) + "</span>" + icon("chev", "chev") + '</summary><div class="block-body">' +
      ongoing.map(function (e) { return card(e, { lead: "until " + fmtShort(e.end_date), idPrefix: "o-" }); }).join("") + "</div></details>";
    if (regulars.length) blocks += '<details class="block" id="blk-regulars"' + (openReg ? " open" : "") + '><summary><span>Regulars <span class="count">· ' + regulars.length + '</span></span><span class="hint">' + esc(regulars.map(function (e) { return e.recurrence; }).join(" · ")) + "</span>" + icon("chev", "chev") + '</summary><div class="block-body">' +
      regulars.map(function (e) { return card(e, { lead: esc(e.recurrence || "Recurring") + (e.start_time ? ", from " + esc(e.start_time) : ""), idPrefix: "r-" }); }).join("") + "</div></details>";
    document.getElementById("blocks").innerHTML = blocks;

    /* bands */
    var days = Object.keys(byDay).sort();
    var html = "";
    bandsFor(BAND_FROM).forEach(function (b) {
      var ds = days.filter(function (d) { return d >= b.from && d <= b.to && d <= NEAR; });
      if (!ds.length && !(b.weekend && b.to >= WIN.start)) return;
      var range = fmtShort(b.from) + (b.from !== b.to ? "–" + fmtShort(b.to) : "");
      html += '<section class="band' + (b.weekend ? " weekend" : "") + '" aria-labelledby="band-' + b.key + '"><h2 id="band-' + b.key + '">' + b.title + (range ? " <small>" + range + "</small>" : "") + "</h2>";
      if (!ds.length) html += '<p class="past-note" style="padding:0 4px 8px">Nothing dated matches your filters this weekend' + (regulars.length ? " — see Regulars above." : ".") + "</p>";
      ds.forEach(function (d) { html += daySection(d, byDay[d], b.weekend); });
      html += "</section>";
    });
    /* after NEAR: one band a month, the same day sections, so a far day in the grid jumps like a near one */
    var nShown = S.nDated + tbc.length, nTotal = all.nDated + all.tbc.length;
    var emptyState = !nShown;
    var far = days.filter(function (d) { return d > NEAR; }), farMonths = [];
    far.forEach(function (d) { var m = d.slice(0, 7); if (farMonths.indexOf(m) < 0) farMonths.push(m); });
    /* the chip's count is the events on that month's days, as a day button counts them: a market whose January holds only
       "again" rows, or a run that began before NEAR, is still in January, so a chip never reads 0 for a band it opens */
    farShown = emptyState ? [] : farMonths.map(function (m) {
      var ids = {};
      far.forEach(function (d) { if (d.slice(0, 7) === m) byDay[d].forEach(function (r) { ids[r.e.id] = true; }); });
      return { m: m, n: Object.keys(ids).length };
    });
    farMonths.forEach(function (m, i) {
      var sub = [m === NEAR.slice(0, 7) ? "from " + fmtShort(add(NEAR, 1)) : "", m === WIN.end.slice(0, 7) ? "to " + fmtShort(WIN.end) : ""].filter(Boolean).join(", ");
      html += '<section class="band far"' + (i === 0 ? ' id="ahead" tabindex="-1"' : "") + ' aria-labelledby="band-' + m + '"><h2 id="band-' + m + '">' + MONTHS[+m.slice(5, 7) - 1] + " " + m.slice(0, 4) + (sub ? " <small>" + sub + "</small>" : "") + "</h2>" +
        (i === 0 ? '<p class="ahead-intro">From ' + fmtShort(add(NEAR, 1)) + ", what the sources already list. Few list this far ahead, so this is not all that will be on.</p>" : "");
      far.filter(function (d) { return d.slice(0, 7) === m; }).forEach(function (d) { html += daySection(d, byDay[d], false); });
      html += "</section>";
    });
    if (!far.length && all.nFar && !emptyState) html += '<section class="band far" id="ahead" tabindex="-1"><p class="past-note">Nothing after ' + fmtShort(NEAR) + " matches your filters.</p></section>";
    if (emptyState) html = '<div class="empty-state"><p>No events match these filters.</p><button class="btn" type="button" id="empty-clear">Clear filters</button></div>';
    document.getElementById("list").innerHTML = html;
    var emptyBtn = document.getElementById("empty-clear");
    if (emptyBtn) emptyBtn.addEventListener("click", resetFilters);

    /* what has no day: one list, by month, after every dated day; the dated part's hidden line comes first */
    /* the days, Ongoing and Regulars: what the result line counts as dated, so the two lines add up to what it hides */
    var tbcHtml = emptyState ? "" : hiddenLine(all.nDated - S.nDated, "in the agenda above");   // the empty-state card already says nothing matches
    if (all.tbc.length) {
      tbcHtml += '<section class="band" aria-labelledby="band-tbc"><h2 id="band-tbc">Date to be confirmed <small>' + tbc.length + "</small></h2>" +
        '<p class="ahead-intro">Listed by a source, but with no day to put on the calendar yet.</p><div class="day-list">' +
        tbc.slice().sort(tbcOrder)
          .map(function (e) { return card(e, { lead: tbcLead(e), idPrefix: "t-", noSpan: true }); }).join("") + "</div>" +
        (tbc.length ? "" : '<p class="past-note">Nothing without a date matches your filters.</p>') +
        hiddenLine(all.tbc.length - tbc.length, "with a date to be confirmed") + "</section>";
    }
    document.getElementById("tbc").innerHTML = tbcHtml;

    /* result line */
    var filtered = F.cats.size || F.dist !== "any" || F.free || F.weekend || F.picks || F.q;
    document.getElementById("result-line").innerHTML = "<span>" + nShown + " of " + nTotal + " events" + (filtered ? " match" : "") + "</span>" +
      (filtered ? '<button type="button" class="linkish" id="clear-filters">Clear filters</button>' : "") +
      (F.picks && !stars.size ? "<span>Tap ☆ on any event to add it to My picks.</span>" : "");

    renderNav();
    measure();
    /* renderNav drew the rail, strip and chips afresh, without the active mark; setActive returns early for the day it
       already holds, so let go of it first (as recountStars does) */
    var held = activeDay; activeDay = null; setActive(held);
    syncActive();
  }

  /* one day's block in the list: the cards that start there first, then the rows of what continues or comes again */
  function daySection(d, rows, inWeekendBand) {
    var out = '<section class="day" id="d-' + d + '" data-day="' + d + '"><h3 class="day-h">' + (d === realToday && inWindow ? '<span class="today-tag">Today</span>' : "") + fmtDay(d) +
      (isWeekend(d) && !inWeekendBand ? '<span class="we-tag">weekend</span>' : "") + '</h3><div class="day-list">';
    rows.sort(function (x, y) {
      if (x.first !== y.first) return x.first ? -1 : 1;
      return (x.e.start_time || "99").localeCompare(y.e.start_time || "99");
    }).forEach(function (r) {
      if (r.first) out += card(r.e, r.e._ahead ? farOpts(r.e) : r.idx > 1 ? { lead: timeText(r.e), noSpan: false } : null);
      else out += '<a class="continues" href="#c-' + esc(r.e.id) + '" style="--cat: var(--c-' + r.e.category + ')">' + icon("cont") +
        "<span>" + (r.e.kind === "recurring" ? "again: <b>" + esc(r.e.title_en) + "</b>" + (r.e.recurrence ? " (" + esc(r.e.recurrence) + ")" : " (date " + r.idx + " of " + r.total + ")")
          : "continues: <b>" + esc(r.e.title_en) + "</b> (day " + r.idx + " of " + r.total + ")") + "</span></a>";
    });
    return out + "</div></section>";
  }
  /* "Big event" restates the readers' rule (50 minutes or more is kept only if big), so it is derived, not stored; every
     card carries it, near or far */
  function bigTag(e) { return e.drive_min != null && e.drive_min >= 50 ? '<span class="far-tag">Big event</span>' : ""; }
  function farOpts(e) {
    var lead = e.kind === "ongoing" ? "opens" + (e.start_time ? " " + esc(e.start_time) : "") + " · until " + fmtShort(e.end_date)
      : e.kind === "recurring" ? esc(e.recurrence || "Recurring") + (e.start_time ? ", from " + esc(e.start_time) : "") : timeText(e);
    return { lead: lead, noSpan: e.kind !== "multi_day" };
  }
  /* by the month or day the source gave, an event without one last, ties by title then id, so the order never depends on the input's */
  function tbcOrder(a, b) {
    var x = [a.start_date || "9999", a.title_en || a.title_pt || "", a.id], y = [b.start_date || "9999", b.title_en || b.title_pt || "", b.id];
    for (var i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  }
  function tbcLead(e) {
    var s = e.start_date || "", y = s && s.slice(0, 4) !== WIN.start.slice(0, 4) ? " " + s.slice(0, 4) : "";
    return '<span class="tbc">' + (s.length === 7 ? MONTHS[+s.slice(5, 7) - 1] + y + ", day tbc" : s ? fmtDay(s) + y + ", to be confirmed" : "date tbc") + "</span>";
  }

  /* ------------------------------------------------- strip & month grids */
  /* tab: 0 or -1 puts the button in the roving tab order of a month grid; left out, it is an ordinary button (the strip) */
  function dayBtn(d, extra, tab) {
    var c = dayCounts[d];
    var cls = "day-btn" + (isWeekend(d) ? " we" : "") + (d === realToday && inWindow ? " today" : "") + (d < TODAY ? " past" : "") + (!c ? " empty" : "");
    var dots = "";
    if (c) { for (var i = 0; i < Math.min(c.n, 3); i++) dots += '<span class="dot"></span>'; if (c.star) dots = '<span class="dot star">' + STAR + "</span>" + dots.slice(0, dots.lastIndexOf("<span")); }
    var label = fmtDay(d) + (d.slice(0, 4) !== WIN.start.slice(0, 4) ? " " + d.slice(0, 4) : "") + (d === realToday && inWindow ? ", today" : "") + ": " + (c ? c.n + (c.n === 1 ? " event" : " events") + (c.star ? ", includes a pick" : "") : "no events");
    return '<button type="button" class="' + cls + '" data-go="' + d + '"' + (tab == null ? "" : ' tabindex="' + tab + '"') + ' aria-label="' + label + '">' + (extra || "") + '<span class="num">' + parse(d).getDate() + '</span><span class="dots" aria-hidden="true">' + dots + "</span></button>";
  }
  function renderNav() {
    /* phone strip: window start..end */
    var s = "", prevM = -1;
    for (var d = WIN.start; d <= NEAR; d = add(d, 1)) {
      var m = parse(d).getMonth();
      if (m !== prevM) { s += '<span class="mlabel" aria-hidden="true">' + MO[m] + "</span>"; prevM = m; }
      s += dayBtn(d, '<span class="wd" aria-hidden="true">' + WD[dow(d)].slice(0, 2) + "</span>");
    }
    /* the strip stays on the coming weeks (half a year would be ~180 buttons); the far days are a chip away */
    farShown.forEach(function (x) { s += '<a class="ahead-chip" href="#band-' + x.m + '" data-month="' + x.m + '" aria-label="' + MONTHS[+x.m.slice(5, 7) - 1] + " " + x.m.slice(0, 4) + ": " + x.n + (x.n === 1 ? " event" : " events") + '">' + MO[+x.m.slice(5, 7) - 1] + ' <span class="n">' + x.n + "</span></a>"; });
    if (tbcShown) s += '<a class="ahead-chip" href="#band-tbc">Date tbc <span class="n">' + tbcShown + "</span> ›</a>";
    document.getElementById("strip").innerHTML = s;

    /* desktop: one grid per month in the window */
    var r = '<a class="skip-link" href="#main">Skip the calendar</a>', cur = WIN.start.slice(0, 7) + "-01";
    while (cur.slice(0, 7) <= GRID_END) {
      var dt = parse(cur), y = dt.getFullYear(), mo = dt.getMonth();
      /* a paragraph, not a heading: the month bands in the list carry the h2, so heading navigation lists each month once */
      var stop = gridStop(cur, mo);
      r += '<div class="month"><p class="month-h">' + MONTHS[mo] + " " + y + '</p><div class="grid" role="group" aria-label="' + MONTHS[mo] + " " + y + '">';
      ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].forEach(function (x, i) { r += '<span class="dow' + (i > 3 ? " we" : "") + '" aria-hidden="true">' + x + "</span>"; });
      var lead = (dow(cur) + 6) % 7;
      for (var i = 0; i < lead; i++) r += "<span></span>";
      for (var dd = cur; parse(dd).getMonth() === mo; dd = add(dd, 1)) {
        if (dd < WIN.start || dd > WIN.end) r += '<span class="day-btn out" aria-hidden="true"><span class="num">' + parse(dd).getDate() + "</span></span>";
        else r += dayBtn(dd, "", dd === stop ? 0 : -1);
      }
      r += "</div>";
      /* after NEAR the grids show only what the sources already list; the last grid says where the marks stop, and the
         agenda's end if that is later. Ongoing runs and near regulars are listed in their blocks (a regular's dots stop at
         NEAR), so the note leaves them out. */
      var lastGrid = cur.slice(0, 7) === GRID_END;
      if (lastGrid && GRID_END < WIN.end.slice(0, 7)) r += '<p class="grid-note">No dated events after ' + MONTHS[mo] + ", other than long runs and regulars; the agenda runs to " + fmtShort(WIN.end) + ".</p>";
      else if (NEAR < WIN.end && NEAR.slice(0, 7) === cur.slice(0, 7)) r += '<p class="grid-note">After ' + fmtShort(NEAR) + ", only what the sources already list; few list this far ahead.</p>";
      r += "</div>";
      cur = add(cur, 32).slice(0, 7) + "-01";
    }
    r += '<div class="legend"><span><span class="mk"><span class="dots"><span class="dot"></span></span></span>one event (up to 3 shown)</span><span><span class="mk"><span class="dots"><span class="dot star">' + STAR + '</span></span></span>a day with one of your picks</span>' + (inWindow ? '<span><span class="mk"><span class="today"><span class="num">' + parse(realToday).getDate() + '</span></span></span>today</span>' : "") + '</div>';
    if (tbcShown) r += '<a class="ahead-link" href="#band-tbc"><b>Date to be confirmed</b><span>' + tbcShown + (tbcShown === 1 ? " event" : " events") + " with no day yet</span></a>";
    document.getElementById("rail").innerHTML = r;
  }
  /* Keyboard: each month grid is one tab stop, so seven grids cost seven stops rather than ~200. The stop is the active
     day if it is in that grid, else today, else the first day not past; a grid whose days are all past (greyed) has none.
     It is in the markup (tabindex), so it is right the moment the rail is drawn and does not wait for any class. */
  function gridStop(first, mo) {
    var live = [], today = null, firstOpen = null;
    for (var dd = first; parse(dd).getMonth() === mo; dd = add(dd, 1)) {
      if (dd < WIN.start || dd > WIN.end) continue;
      live.push(dd);
      if (dd === realToday && inWindow) today = dd;
      if (!firstOpen && dd >= TODAY) firstOpen = dd;
    }
    return live.indexOf(activeDay) >= 0 ? activeDay : today || firstOpen;
  }
  /* make b the one tab stop of its grid */
  function setStop(b) {
    var g = b.closest && b.closest(".grid"); if (!g) return;
    g.querySelectorAll("button.day-btn").forEach(function (x) { x.tabIndex = -1; });
    b.tabIndex = 0;
  }
  /* Arrows move a day or a week, across grids too (the calendar reads as one run of days, and a week can straddle two
     months); Home and End go to the first and last day of this grid. Only days not past are stops: a greyed day is never
     focused, and a key that would leave them (or the window) stays put. Moving into another grid hands that grid's stop
     to the new day and leaves the old grid its own, so each grid keeps exactly one. */
  document.getElementById("rail").addEventListener("keydown", function (ev) {
    var b = ev.target.closest && ev.target.closest("button.day-btn"); if (!b) return;
    var step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[ev.key], ends = ev.key === "Home" || ev.key === "End";
    if (!step && !ends) return;
    ev.preventDefault();
    var open = Array.prototype.filter.call(document.querySelectorAll("#rail button.day-btn"), function (x) { return x.dataset.go >= TODAY; }), n;
    if (ends) {
      var g = b.closest(".grid"), mine = open.filter(function (x) { return x.closest(".grid") === g; });
      n = mine[ev.key === "Home" ? 0 : mine.length - 1];
    } else {
      var t = add(b.dataset.go, step);
      n = open.filter(function (x) { return x.dataset.go === t; })[0] || (b.dataset.go < TODAY ? open[0] : null);   // off a clicked past day
    }
    if (n) { setStop(n); n.focus(); }
  });

  /* ----------------------------------------------- scroll sync & jumping */
  var stripWrap = document.getElementById("strip-wrap");
  var stickyTop = 0;
  function measure() {
    stickyTop = getComputedStyle(stripWrap).display === "none" ? 0 : stripWrap.offsetHeight;
    document.documentElement.style.setProperty("--sticky-top", stickyTop + "px");
  }
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* activeDay is the day the rail, strip and chips mark. A jump sets jumpHold: while it is set the scroll does not move the
     mark, because a smooth scroll from November to March passes every day on the way, and the last days cannot reach the
     line at the foot of the page, so the line would hand the mark to an earlier day. The user's own input lets go of it,
     and so does the end of the jump's scroll (or a jump with nothing to scroll), for a scroll that comes with no input
     (find in page, back and forward, a screen reader): letting go leaves the mark where the jump put it, and the next
     scroll moves it. */
  var activeDay = null, jumpHold = false, holdTimer = 0, jumpHash = null;
  /* a frame later, so a sync that the jump's last scroll event already queued still sees the hold */
  function letGo() { requestAnimationFrame(function () { jumpHold = false; }); }
  function letGoSoon() { clearTimeout(holdTimer); holdTimer = setTimeout(letGo, 200); }   // where scrollend is missing
  function setActive(d) {
    if (d === activeDay) return;
    activeDay = d;
    document.querySelectorAll(".day-btn.active").forEach(function (b) { b.classList.remove("active"); b.removeAttribute("aria-current"); });
    document.querySelectorAll(".ahead-chip").forEach(function (c) { c.classList.toggle("active", !!d && d > NEAR && c.dataset.month === d.slice(0, 7)); });
    if (!d) return;
    document.querySelectorAll('.day-btn[data-go="' + d + '"]').forEach(function (b) { b.classList.add("active"); b.setAttribute("aria-current", "date"); });
    /* the rail holds up to seven grids and scrolls on its own: keep the active day in view there, and make it its grid's
       tab stop, but not while the keyboard is in the rail: the stop is then where the user put it (a mouse click focuses
       a button too, without :focus-visible, and the rail should go on following the list for that reader) */
    var rb = document.querySelector('#rail .day-btn[data-go="' + d + '"]'), rail = document.getElementById("rail");
    if (keyboardIn(rail)) return stripTo(d);
    if (rb && rb.tagName === "BUTTON") setStop(rb);
    if (rb && rail.scrollHeight > rail.clientHeight) {
      var rr = rail.getBoundingClientRect(), br = rb.getBoundingClientRect();
      if (br.top < rr.top || br.bottom > rr.bottom) rail.scrollTop += br.top - rr.top - rr.height / 3;
    }
    stripTo(d);
  }
  function keyboardIn(el) {
    try { return !!el.querySelector(":focus-visible"); } catch (e) { return el.contains(document.activeElement); }   // a browser without :focus-visible
  }
  /* the phone strip follows the active day, or its month's chip after NEAR */
  function stripTo(d) {
    var sb =document.querySelector('#strip .day-btn[data-go="' + d + '"]') || (d > NEAR && document.querySelector('#strip [data-month="' + d.slice(0, 7) + '"]'));
    if (sb && stickyTop) {
      var strip = document.getElementById("strip");
      var left = sb.offsetLeft - strip.clientWidth / 2 + sb.offsetWidth / 2;
      strip.scrollTo({ left: Math.max(0, left), behavior: reduceMotion ? "auto" : "smooth" });
    }
  }
  function syncActive() {
    if (jumpHold) return;
    var secs = document.querySelectorAll("#list .day");
    var line = stickyTop + 60, best = null;
    for (var i = 0; i < secs.length; i++) { if (secs[i].getBoundingClientRect().top <= line) best = secs[i].dataset.day; else break; }
    if (!best && secs.length) best = secs[0].dataset.day;
    /* a far month's heading on the line is that month, though its intro keeps the first day below the line: a month chip
       lands on the heading, and the chip goes active with a day of its month */
    var heads = document.querySelectorAll("#list .band.far > h2");
    for (var k = heads.length - 1; k >= 0; k--) if (heads[k].getBoundingClientRect().top <= line) {
      var fd = heads[k].parentNode.querySelector(".day");
      if (fd && (!best || fd.dataset.day > best)) best = fd.dataset.day;
      break;
    }
    /* at the foot of the page the line cannot reach the last days: the last day in view is where we are */
    if (secs.length && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
      for (var j = secs.length - 1; j >= 0; j--) if (secs[j].getBoundingClientRect().top < window.innerHeight) { best = secs[j].dataset.day; break; }
    }
    /* once the undated list (which has no days to mark) reaches the line, the last dated day is no longer where we are */
    var tb = document.getElementById("band-tbc");
    if (tb && tb.getBoundingClientRect().top <= line) best = null;
    setActive(best);
  }
  var ticking = false;
  window.addEventListener("scroll", function () {
    if (jumpHold) letGoSoon();
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () { ticking = false; syncActive(); });
  }, { passive: true });
  window.addEventListener("resize", function () { measure(); syncActive(); });
  /* the user taking over the scroll (wheel, touch, a key, the mouse on the scrollbar) ends a jump's hold on the mark */
  ["wheel", "touchstart", "mousedown", "keydown"].forEach(function (t) {
    window.addEventListener(t, function () { jumpHold = false; }, { passive: true, capture: true });
  });
  window.addEventListener("scrollend", function () { if (jumpHold) letGo(); });
  /* a link followed with no input on the page (back, forward, a typed address) is the reader's scroll, not the jump's */
  window.addEventListener("hashchange", function () {
    if (location.hash !== jumpHash) jumpHold = false;   // the hash the jump's own link set keeps the hold
    jumpHash = null;
    if (location.hash === "#ahead" && !document.getElementById("ahead")) toAhead();
  });

  document.addEventListener("click", function (ev) {
    var go = ev.target.closest("[data-go]");
    if (go) {
      var d = go.dataset.go, secs = document.querySelectorAll("#list .day"), target = null;
      for (var i = 0; i < secs.length; i++) if (secs[i].dataset.day >= d) { target = secs[i]; break; }
      if (!target) return;
      var y = target.getBoundingClientRect().top + window.scrollY - stickyTop + 1;
      /* a click focuses the button: it is then its grid's stop, so Tab and the arrows go on from where the user is */
      if (go.closest("#rail") && go.tagName === "BUTTON") setStop(go);
      jumpHold = true; jumpHash = null; setActive(target.dataset.day);
      window.scrollTo({ top: y, behavior: reduceMotion ? "auto" : "smooth" });
      letGoSoon();   // a jump with nothing to scroll fires no scroll event to end it
      return;
    }
    /* the undated list's rail link and strip chip are links, so the browser scrolls; they are jumps all the same, holding
       no day: at the foot of the page the list's heading cannot reach the line, and the last day in view would keep the mark */
    if (ev.target.closest('a[href="#band-tbc"]')) { jumpHold = true; jumpHash = "#band-tbc"; setActive(null); letGoSoon(); return; }
    var st = ev.target.closest("[data-star]");
    if (st) {
      var id = st.dataset.star;
      stars.has(id) ? stars.delete(id) : stars.add(id); saveStars();
      var on = stars.has(id);
      document.querySelectorAll('[data-star="' + CSS.escape(id) + '"]').forEach(function (b) { b.setAttribute("aria-pressed", on); b.closest(".card").classList.toggle("starred", on); });
      updatePicksChip();
      if (F.picks) renderAll(); else { recountStars(); }
      return;
    }
    var tg = ev.target.closest(".card-toggle");
    if (tg) {
      var c = tg.closest(".card"), open = !c.classList.contains("open");
      c.classList.toggle("open", open); tg.setAttribute("aria-expanded", open);
      var ia = open && c.querySelector("[data-ics]"); if (ia) fillIcs(ia);
      return;
    }
    var ics = ev.target.closest("[data-ics]");
    if (ics) { fillIcs(ics); return; }
    var cont = ev.target.closest(".continues");
    if (cont) {
      var tgt = document.querySelector(cont.getAttribute("href"));
      if (tgt) { ev.preventDefault(); tgt.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }); tgt.querySelector(".card-toggle").focus({ preventScroll: true }); }
    }
  });
  function recountStars() { countDays(sections(F)); renderNav(); var a = activeDay; activeDay = null; setActive(a); }
  document.addEventListener("toggle", function (ev) {
    if (ev.target.id === "blk-ongoing") store.set(NS + "open-ongoing", ev.target.open);
    if (ev.target.id === "blk-regulars") store.set(NS + "open-regulars", ev.target.open);
  }, true);

  /* ----------------------------------------------------------------- .ics */
  function icsEsc(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
  function fold(line) {
    var out = [], cur = "", bytes = 0, enc = new TextEncoder();
    for (var ch of line) {
      var b = enc.encode(ch).length;
      if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
      cur += ch; bytes += b;
    }
    out.push(cur); return out.join("\r\n ");
  }
  function ymd(d) { return d.replace(/-/g, ""); }
  function hm(t) { return t.replace(":", "") + "00"; }
  function addHours(d, t, h) {
    var p = t.split(":"), mins = +p[0] * 60 + +p[1] + h * 60, dd = d;
    while (mins >= 1440) { mins -= 1440; dd = add(dd, 1); }
    return { d: dd, t: String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0") };
  }
  function stampNow() { var n = new Date(); return n.getUTCFullYear() + p2(n.getUTCMonth() + 1) + p2(n.getUTCDate()) + "T" + p2(n.getUTCHours()) + p2(n.getUTCMinutes()) + p2(n.getUTCSeconds()) + "Z"; }
  /* Times are floating local times, with no zone attached: they are the clock in Portugal. */
  function vevent(e, start, end, uidSuffix) {
    var L = ["BEGIN:VEVENT", "UID:" + e.id + (uidSuffix || "") + "@rio-maior-events", "DTSTAMP:" + stampNow()];
    var note = "";
    if (e.start_time && start === end) {
      var en = addHours(start, e.start_time, 2);
      L.push("DTSTART:" + ymd(start) + "T" + hm(e.start_time));
      L.push("DTEND:" + ymd(en.d) + "T" + hm(en.t));
      note = "End time assumed (2 h). ";
    } else {
      L.push("DTSTART;VALUE=DATE:" + ymd(start));
      L.push("DTEND;VALUE=DATE:" + ymd(add(end, 1)));
      if (e.start_time) note = "Starts " + e.start_time + " each day. "; else if (start === end) note = "Time to be confirmed. ";
    }
    L.push("SUMMARY:" + icsEsc(e.title_en + (e.title_pt && e.title_pt !== e.title_en ? " / " + e.title_pt : "")));
    L.push("LOCATION:" + icsEsc([e.venue, e.town].filter(Boolean).join(", ")));
    var desc = note + (e.description_en || "") + (e.confidence === "low" ? "\nCHECK SOURCE: " + (e.caveat || "low confidence") : "") +
      (e.sources || []).map(function (s) { return "\n" + s.name + (safeUrl(s.url) ? ": " + s.url : ""); }).join("");
    L.push("DESCRIPTION:" + icsEsc(desc));
    if (e.sources && e.sources[0] && safeUrl(e.sources[0].url)) L.push("URL:" + e.sources[0].url);
    L.push("END:VEVENT");
    return L;
  }
  function icsText(e) {
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//rio-maior-events//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    if (e.kind === "recurring") {
      var ahead = (e.dates || []).filter(function (d) { return d >= TODAY; });
      var ds = ahead.length ? ahead : (e.dates || []);
      ds.slice(0, 12).forEach(function (d, i) { lines = lines.concat(vevent(e, d, d, "-" + i)); });
    } else if (e.kind === "ongoing") {
      lines = lines.concat(vevent(Object.assign({}, e, { start_time: null }), e.start_date > TODAY ? e.start_date : TODAY, e.end_date));
    } else {
      lines = lines.concat(vevent(e, e.start_date, e.end_date || e.start_date));
    }
    lines.push("END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
  }
  /* A data: link, so it still saves where Blob downloads are blocked. Built when the card opens or the link is pressed. */
  function fillIcs(a) {
    var e = EVENTS.find(function (x) { return x.id === a.dataset.ics; });
    if (!e || e.date_tbc) return;
    a.href = "data:text/calendar;charset=utf-8," + encodeURIComponent(icsText(e));
    a.setAttribute("download", norm(e.title_en || e.id).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) + ".ics");
  }

  /* ---------------------------------------------------------------- footer */
  document.getElementById("foot").innerHTML = "<p>Times are local, Portugal. Drive times are estimates from " + esc(DATA.origin || "the town centre") + ".</p>";

  renderAll();
  /* #ahead is the first far band, which the page draws, so a link to it was followed before it existed. With no far band
     (nothing listed after NEAR, or an old file) it goes where "further ahead" now leads: the undated list, else the end
     of the dated one. */
  function toAhead() {
    var t = document.getElementById("ahead") || document.getElementById("band-tbc") || document.getElementById("tbc");
    if (t) t.scrollIntoView();
  }
  if (location.hash === "#ahead") toAhead();
})();
