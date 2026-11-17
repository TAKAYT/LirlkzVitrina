/* Lirlkz — Ядро витрины (синхронизировано с data.json + stats.json от update.py) */
(function () {
  "use strict";

  const C = window.TakaConfig;
  const M = window.TakaModals;
  const T = window.TakaTour;

  const CHUNK_SIZE = window.innerWidth <= 768 ? 12 : 24;

  const state = {
    catalog: [],
    stats: {},
    tiers: C.DEFAULT_TIERS,
    ytVideos: [],
    tgNews: [],
    typeOverrides: {},
    specialTitles: {
      frozen_titles: [],
      romance_sakura: [],
      completed_titles: [],
      hidden_tags_overrides: {}
    },
    recentIds: [],
    trackedMissingQueries: new Set(),
    access: "all",
    type: "all",
    genres: [],
    special: "all",
    sort: "newest",
    search: "",
    tasteTags: [],
    randomIds: null,
    viewMode: "grid",
    shelfMode: "week",
    modalShelfMode: "week",
    renderedCount: 0,
    filteredCache: [],
    referenceNow: Date.now()
  };

  let searchDebounceTimer = null;
  let missingPingTimer = null;
  let sentinelObserver = null;

  /* -------------------- STORAGE & RECENTLY VIEWED -------------------- */
  function saveFilters() {
    try {
      localStorage.setItem(C.STORAGE_KEY, JSON.stringify({
        access: state.access,
        type: state.type,
        genres: state.genres,
        special: state.special,
        sort: state.sort,
        search: state.search,
        tasteTags: state.tasteTags,
        viewMode: state.viewMode
      }));
    } catch (_) {}
  }

  function loadSavedFilters() {
    try {
      const raw = localStorage.getItem(C.STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        ["access", "type", "special", "sort", "search", "viewMode"].forEach((k) => {
          if (saved[k] !== undefined) state[k] = saved[k];
        });
        if (state.access === "tier2") state.access = "tier1";
        if (state.special === "license") state.special = "all";
        if (Array.isArray(saved.genres)) state.genres = saved.genres;
        if (Array.isArray(saved.tasteTags)) state.tasteTags = saved.tasteTags;
      }
      const recentRaw = localStorage.getItem(C.RECENT_KEY);
      if (recentRaw) {
        const arr = JSON.parse(recentRaw);
        if (Array.isArray(arr)) state.recentIds = arr.slice(0, 4).map(String);
      }
    } catch (_) {}
  }

  function recordRecentViewed(itemId) {
    const idStr = String(itemId);
    state.recentIds = [idStr, ...state.recentIds.filter((x) => x !== idStr)].slice(0, 4);
    try {
      localStorage.setItem(C.RECENT_KEY, JSON.stringify(state.recentIds));
    } catch (_) {}
    renderRecentSection();
  }

  function renderRecentSection() {
    const sec = document.getElementById("recentSection");
    const track = document.getElementById("recentTrack");
    if (!sec || !track) return;

    const items = state.recentIds
      .map((rid) => state.catalog.find((i) => String(i.id) === rid))
      .filter(Boolean);

    if (items.length === 0) {
      sec.style.display = "none";
      return;
    }

    const tierObj = state.tiers[0] || C.DEFAULT_TIERS[0];
    sec.style.display = "block";
    track.innerHTML = items.map((item) => {
      return `
        <div class="recent-mini-card">
          <img src="${C.escapeHtml(item.image)}" referrerpolicy="no-referrer" data-fb="${C.escapeHtml(item.remote_image || "")}" alt="${C.escapeHtml(item.title)}" class="recent-mini-img" decoding="async">
          <div class="recent-mini-info">
            <div class="recent-mini-title">${C.escapeHtml(item.title)}</div>
            <div class="recent-mini-btns">
              <button type="button" class="recent-btn-ch" data-open-chapters="${item.id}">Главы</button>
              <a href="${C.escapeHtml(C.buildUtmUrl(tierObj.url, item.title))}" target="_blank" rel="noopener noreferrer" class="recent-btn-sub" data-ym-event="${tierObj.ymEvent}">${tierObj.price} ₽ ↗</a>
            </div>
          </div>
        </div>
      `;
    }).join("");

    track.querySelectorAll("img").forEach((img) => {
      img.onerror = () => C.handleImgError(img, img.dataset.fb);
    });
  }

  /* -------------------- FIXED SKY-BLUE THEME -------------------- */
  function initTheme() {
    document.documentElement.setAttribute("data-theme", "dark");
  }

  /* -------------------- PROMO CONVERSION POPUP -------------------- */
  function initPromoConversion() {
    try {
      const visits = (parseInt(localStorage.getItem(C.VISIT_COUNT_KEY) || "0", 10) || 0) + 1;
      localStorage.setItem(C.VISIT_COUNT_KEY, String(visits));

      const lastShown = parseInt(localStorage.getItem(C.PROMO_LAST_KEY) || "0", 10) || 0;
      const hoursSince = (Date.now() - lastShown) / 3600000;
      if (visits < 2 || hoursSince < 12) return;

      setTimeout(() => {
        const anyModal = Array.from(document.querySelectorAll(".modal-backdrop")).some((m) => m.style.display === "flex");
        const tourOpen = document.getElementById("tourOverlay")?.style.display === "block";
        if (anyModal || tourOpen) return;
        localStorage.setItem(C.PROMO_LAST_KEY, String(Date.now()));
        M.openPromoModal(state, visits - 2);
      }, 9500);
    } catch (_) {}
  }

  /* -------------------- GEO BLOCK (VPN-SAFE, ТОЛЬКО KR/JP/CN) -------------------- */
  function showGeoBlock() {
    const app = document.getElementById("mainApp");
    const block = document.getElementById("geoBlockScreen");
    if (app) app.style.display = "none";
    if (block) block.style.display = "flex";
  }

  function checkGeoRestriction() {
    try {
      const langs = Array.isArray(navigator.languages) ? navigator.languages.join(",") : (navigator.language || "");
      if (/\b(ru|uk|be|kk|uz|az)\b/i.test(langs)) return;

      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      if (/seoul|tokyo|shanghai|beijing|hong_kong|taipei|osaka/i.test(tz) || /\b(ko|ja|zh)(-|,|$)/i.test(langs)) {
        showGeoBlock();
        return;
      }

      setTimeout(() => {
        const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
        if (ctrl) setTimeout(() => ctrl.abort(), 1600);
        fetch("https://api.country.is/", ctrl ? { signal: ctrl.signal } : {})
          .then((r) => r.json())
          .then((d) => {
            if (d && ["KR", "JP", "CN"].includes(String(d.country || "").toUpperCase())) showGeoBlock();
          })
          .catch(() => {});
      }, 1400);
    } catch (_) {}
  }

  /* -------------------- PREFETCH YT/TG IMAGES IN IDLE -------------------- */
  function warmMediaCacheInBackground() {
    const urls = [
      ...state.ytVideos.slice(0, 4).map((v) => v.image),
      ...state.tgNews.slice(0, 6).map((p) => p.image)
    ].filter((u) => u && !u.startsWith("data:"));

    if (urls.length === 0) return;
    const run = () => {
      urls.forEach((u) => {
        const img = new Image();
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        img.src = u;
      });
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 2500 });
    } else {
      setTimeout(run, 1200);
    }
  }

  /* -------------------- AVATAR (С АВТОМАТИЧЕСКИМ РЕЗЕРВОМ ИЗ TG И YOUTUBE) -------------------- */
  function setupAvatar(avatarUrl) {
    const img = document.getElementById("heroAvatarImg");
    const fb = document.getElementById("heroAvatarFallback");
    if (!img || !fb) return;

    const candidates = [
      avatarUrl,
      "media_cache/avatar.png",
      "media_cache/avatar.jpg",
      "avatar.png",
      "avatar.jpg",
      "https://unavatar.io/telegram/LirlkzManga",
      "https://unavatar.io/youtube/LirlkzManga"
    ].filter(Boolean);

    let idx = 0;
    function tryNext() {
      if (idx >= candidates.length) {
        img.style.display = "none";
        fb.style.display = "flex";
        return;
      }
      img.style.display = "block";
      fb.style.display = "none";
      img.src = candidates[idx++];
    }
    img.onerror = tryNext;
    tryNext();
  }

  /* -------------------- DATA LOADING -------------------- */
  async function fetchJsonOptional(path) {
    const bucket = Math.floor(Date.now() / 600000);
    try {
      const r = await fetch(`${path}?v=${bucket}`, { cache: "default" });
      if (r.ok) return await r.json();
    } catch (_) {}
    return null;
  }

  async function loadYoutubeFallback() {
    try {
      const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${C.YT_CHANNEL_ID}`;
      const r = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`);
      if (!r.ok) return [];
      const j = await r.json();
      if (!Array.isArray(j.items)) return [];
      return j.items.slice(0, 4).map((it) => {
        const vidId = (it.guid || "").split(":").pop();
        return {
          title: it.title || "Видео Lirlkz",
          link: it.link || C.YT_CHANNEL_URL,
          image: it.thumbnail || (vidId ? `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg` : ""),
          date: (it.pubDate || "").slice(0, 10)
        };
      });
    } catch (_) {
      return [];
    }
  }

  function filterRecentTgNews(posts) {
    if (!Array.isArray(posts)) return [];
    const cutoff = state.referenceNow - 7 * 86400000;
    return posts.filter((p) => {
      const ts = C.parseDateValue(p.date);
      return ts === 0 || ts >= cutoff;
    });
  }

  function normalizeItem(raw, idx) {
    const title = raw.title || "Без названия";
    const norm = C.strictNormalize(title);

    const posts = Array.isArray(raw.all_posts) ? raw.all_posts : [];
    const freeCh = Number(raw.free_chapters) || 0;
    let paidCh = Number(raw.paid_chapters) || 0;
    const totalCh = Math.max(
      Number(raw.chapters || raw.total_chapters || 0),
      freeCh + paidCh,
      posts.length
    );
    if (paidCh === 0 && totalCh > freeCh) paidCh = totalCh - freeCh;

    const mainTierPrice = state.tiers[0]?.price || C.DEFAULT_TIERS[0].price;
    const rawPrice = Number(raw.price) || 0;
    const price = rawPrice >= 30 ? rawPrice : mainTierPrice;
    const typeKey = state.typeOverrides[norm] || C.normalizeTypeKey(raw.content_type || raw.type);

    const isFrozen = Boolean(raw.is_frozen) || state.specialTitles.frozen_titles.includes(norm);
    const isRomance = Boolean(raw.is_romance) || state.specialTitles.romance_sakura.includes(norm);
    const isCompleted = Boolean(raw.is_completed) || state.specialTitles.completed_titles.includes(norm);

    const baseHidden = Array.isArray(raw.hidden_tags) ? raw.hidden_tags : [];
    const ovHidden = state.specialTitles.hidden_tags_overrides[norm] || [];
    const hiddenTags = Array.from(new Set([...baseHidden, ...ovHidden]));

    const updatedStr = raw.last_update || raw.updated || "";
    const updatedTs = raw.timestamp ? Number(raw.timestamp) * 1000 : C.parseDateValue(updatedStr);
    const createdTs = raw.created_ts ? Number(raw.created_ts) * 1000 : updatedTs;
    const daysAgo = updatedTs > 0 ? (state.referenceNow - updatedTs) / 86400000 : 9999;

    const isWeekNew = updatedTs > 0 ? (daysAgo <= 7 && (Number(raw.week_posts_count || 0) > 0 || Boolean(raw.week_range))) : false;

    const refD = new Date(state.referenceNow);
    const crD = new Date(createdTs);
    const sameCalendarMonth = createdTs > 0 && refD.getFullYear() === crD.getFullYear() && refD.getMonth() === crD.getMonth();
    const startsFromOne = Boolean(raw.is_1_to_n) || posts.some((p) => Number(p.start_ch) === 1 || /^1\s*[-–,]/.test(String(p.range || "")));
    const isMonthNew = sameCalendarMonth && startsFromOne && totalCh > 0;

    const fallbackUrl = raw.link || raw.url || C.BLOG_URL;
    const safeImg = (raw.image && !String(raw.image).includes("via.placeholder.com")) ? raw.image : C.PLACEHOLDER_SVG;
    const remoteImg = (raw.remote_image && !String(raw.remote_image).includes("via.placeholder.com")) ? raw.remote_image : "";

    return {
      id: raw.id || idx,
      title,
      type: typeKey,
      typeLabel: C.TYPE_LABELS[typeKey] || "Манхва",
      tags: Array.isArray(raw.genres) ? raw.genres : (Array.isArray(raw.tags) ? raw.tags : []),
      hidden_tags: hiddenTags,
      image: safeImg,
      remote_image: remoteImg,
      url: fallbackUrl,
      tier: 1,
      price,
      total_chapters: totalCh,
      free_chapters: freeCh,
      paid_chapters: paidCh,
      free_text: raw.free_text || (freeCh > 0 ? `1-${freeCh} гл. бесплатно` : ""),
      updated: updatedStr,
      updatedTs,
      createdTs,
      is_license: false,
      is_frozen: isFrozen,
      is_romance: isRomance,
      is_completed: isCompleted,
      is_week_new: isWeekNew,
      is_month_new: isMonthNew,
      week_range: raw.week_range || raw.latest_range || "",
      week_post_image: (raw.week_post_image && !String(raw.week_post_image).includes("via.placeholder.com")) ? raw.week_post_image : safeImg,
      week_post_link: raw.week_post_link || raw.latest_post_link || fallbackUrl,
      week_chapters_count: C.extractChapterSpan(raw.week_range || raw.latest_range),
      month_range: totalCh > 0 ? `1-${totalCh} гл.` : (raw.latest_range || "1 гл."),
      all_posts: posts.map((p) => {
        const directPostUrl = p.link || p.url || (p.post_id ? `${C.BLOG_URL}/posts/${p.post_id}` : fallbackUrl);
        return {
          title: p.title || title,
          range: p.range || C.extractChaptersFromTitle(p.title) || "",
          url: directPostUrl,
          date: p.date || updatedStr,
          is_free: Boolean(p.is_free),
          is_recent: p.ts ? (state.referenceNow - Number(p.ts) * 1000) <= 7 * 86400000 : false,
          tier: 1
        };
      })
    };
  }

  async function loadCatalog() {
    const summary = document.getElementById("resultsSummary");
    if (window.location.protocol === "file:") {
      if (summary) summary.textContent = "Локальный режим (file://): откройте сайт через GitHub Pages или локальный сервер.";
      setupAvatar();
      return;
    }

    const [dataRaw, statsRaw, typeOv, specOv] = await Promise.all([
      fetchJsonOptional("data.json"),
      fetchJsonOptional("stats.json"),
      fetchJsonOptional("type_overrides.json"),
      fetchJsonOptional("special_titles.json")
    ]);

    const data = dataRaw || (await fetchJsonOptional("catalog.json"));
    if (!data) {
      if (summary) summary.textContent = "Ошибка загрузки каталога (data.json не найден).";
      setupAvatar();
      return;
    }

    if (typeOv) {
      Object.entries(typeOv).forEach(([k, v]) => {
        if (!k.startsWith("_") && v) state.typeOverrides[C.strictNormalize(k)] = C.normalizeTypeKey(v);
      });
    }

    if (specOv) {
      state.specialTitles.frozen_titles = (specOv.frozen_titles || []).map(C.strictNormalize);
      state.specialTitles.romance_sakura = (specOv.romance_sakura || []).map(C.strictNormalize);
      state.specialTitles.completed_titles = (specOv.completed_titles || []).map(C.strictNormalize);
      if (specOv.hidden_tags_overrides) {
        Object.entries(specOv.hidden_tags_overrides).forEach(([k, v]) => {
          state.specialTitles.hidden_tags_overrides[C.strictNormalize(k)] = Array.isArray(v) ? v : [String(v)];
        });
      }
    }

    state.stats = statsRaw || (!Array.isArray(data) ? (data.meta || data) : {});
    if (state.stats.ambient_state?.updated_at) {
      const ts = C.parseDateValue(state.stats.ambient_state.updated_at);
      if (ts > 0) state.referenceNow = ts;
    }

    syncTiersFromStats();

    const items = Array.isArray(data) ? data : (data.items || data.catalog || []);
    state.catalog = items.map((item, idx) => normalizeItem(item, idx));

    state.ytVideos = (state.stats.yt_videos || []).slice(0, 4);
    state.tgNews = filterRecentTgNews(state.stats.tg_news || []);

    if (state.ytVideos.length === 0) {
      loadYoutubeFallback().then((vids) => {
        if (vids.length > 0) {
          state.ytVideos = vids.slice(0, 4);
          C.setText("ytCountBadge", state.ytVideos.length);
        }
      });
    }

    setupAvatar(state.stats.avatar);
    renderTiers();
    renderRecentSection();
    populateHeaderAndStats();
    populateGenreCheckboxes();
    syncControlsFromState();
    renderShelf();
    setupInfiniteScroll();
    renderCatalog();
    warmMediaCacheInBackground();
    initPromoConversion();
  }

  /* -------------------- TIERS & STATS -------------------- */
  function syncTiersFromStats() {
    const rawTiers = state.stats.tiers;
    if (!Array.isArray(rawTiers) || rawTiers.length === 0) return;
    const def = C.DEFAULT_TIERS[0];
    const found = rawTiers.find((t) => String(t.id) === "3908979") || rawTiers[0];
    if (!found) return;

    const apiPrice = Number(found.price) || 0;
    const price = apiPrice >= 30 ? apiPrice : def.price;
    const oldPrice = Number(found.old_price || 0);
    const discount = oldPrice > price ? `-${Math.round((1 - price / oldPrice) * 100)}%` : "";

    state.tiers = [{
      ...def,
      id: found.id || def.id,
      title: found.name || def.title,
      price,
      old_price: oldPrice,
      discount,
      url: found.url || def.url
    }];
  }

  function renderTiers() {
    const grid = document.getElementById("tiersGrid");
    if (!grid) return;

    grid.innerHTML = state.tiers.map((t) => {
      const disc = t.discount ? `<span class="tariff-discount">${C.escapeHtml(t.discount)}</span>` : "";
      const btnLabel = `Оформить подписку • ${t.price} ₽/мес`;
      return `
        <div class="tariff-card is-featured" data-tier-card="${t.tier}">
          <div class="tariff-head">
            <div>
              <span class="tariff-kicker">${C.escapeHtml(t.kicker)}</span>
              <h3>${C.escapeHtml(t.title)}</h3>
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              ${disc}
              <button type="button" class="tariff-help-btn" data-tier-help="${t.tier}" aria-label="Подробнее">?</button>
            </div>
          </div>
          <p class="tariff-desc">${C.escapeHtml(t.desc)}</p>
          <a href="${C.escapeHtml(t.url)}" target="_blank" rel="noopener noreferrer" class="btn tariff-cta" data-ym-event="${t.ymEvent}">
            ${C.escapeHtml(btnLabel)}
          </a>
        </div>
      `;
    }).join("");
  }

  function populateHeaderAndStats() {
    const total = state.catalog.length;
    C.setText("ytCountBadge", state.ytVideos.length);
    C.setText("tgCountBadge", state.tgNews.length);

    const goal = Array.isArray(state.stats.goals) && state.stats.goals[0] ? state.stats.goals[0] : null;
    const goalSection = document.getElementById("goalSection");
    if (goal && Number(goal.target) > 0) {
      const paidSubs = Number(goal.current || 0);
      const goalTarget = Number(goal.target || 100);
      const pct = Math.min(100, Math.round((paidSubs / Math.max(1, goalTarget)) * 100));
      if (goal.description) C.setText("goalTitleLeft", `Цель канала: ${goal.description}`);
      C.setText("goalNumbersRight", `${paidSubs} из ${goalTarget} (${pct}%)`);
      const bar = document.getElementById("goalBar");
      if (bar) bar.style.width = pct + "%";
    } else if (goalSection) {
      C.setText("goalTitleLeft", "Статистика канала и библиотеки озвучки");
      C.setText("goalNumbersRight", `Тайтлов: ${total}`);
      const bar = document.getElementById("goalBar");
      if (bar) bar.style.width = "100%";
    }

    const freeSum = Number(state.stats.total_free_chapters) || state.catalog.reduce((acc, it) => acc + it.free_chapters, 0);
    const paidSum = Number(state.stats.total_paid_chapters) || state.catalog.reduce((acc, it) => acc + it.paid_chapters, 0);
    const totalSum = Number(state.stats.total_voiced_chapters) || state.catalog.reduce((acc, it) => acc + it.total_chapters, 0);

    C.setText("statSubs", (state.stats.subscribers || 0).toLocaleString("ru-RU"));
    C.setText("statFreeCh", freeSum.toLocaleString("ru-RU") + " гл.");
    C.setText("statPaidCh", paidSum.toLocaleString("ru-RU") + " гл.");
    C.setText("statTotalCh", totalSum.toLocaleString("ru-RU") + " гл.");

    const mainTierPrice = state.tiers[0]?.price || C.DEFAULT_TIERS[0].price;
    const tierTabLabel = document.getElementById("tier1TabLabel");
    if (tierTabLabel) tierTabLabel.textContent = `По подписке • ${mainTierPrice} ₽`;

    C.setText("cntAll", total);
    C.setText("cntFree", state.catalog.filter((i) => i.free_chapters > 0).length);
    C.setText("cntTier1", state.catalog.filter((i) => i.paid_chapters > 0 || i.free_chapters === 0).length);

    const refDate = new Date(state.referenceNow);
    const months = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
    C.setText("catalogDateBadge", `${months[refDate.getMonth()]} ${refDate.getFullYear()}`);
    C.setText("lastSyncText", `Обновлено: ${refDate.toLocaleDateString("ru-RU")}`);
  }

  /* -------------------- МУЛЬТИВЫБОР ЖАНРОВ -------------------- */
  function populateGenreCheckboxes() {
    const counts = {};
    state.catalog.forEach((it) => it.tags.forEach((t) => { if (t) counts[t] = (counts[t] || 0) + 1; }));
    const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const listEl = document.getElementById("genreCheckboxesList");
    if (!listEl) return;

    listEl.innerHTML = sorted.map((g) => {
      const checked = state.genres.includes(g) ? "checked" : "";
      return `
        <label class="multi-genre-item">
          <input type="checkbox" value="${C.escapeHtml(g)}" ${checked}>
          <span>${C.escapeHtml(g)}</span>
          <span class="multi-genre-cnt">${counts[g]}</span>
        </label>
      `;
    }).join("");
    updateGenreButtonLabel();
  }

  function updateGenreButtonLabel() {
    const btn = document.getElementById("genreMultiBtn");
    const label = document.getElementById("genreMultiLabel");
    if (!btn || !label) return;
    if (state.genres.length === 0) {
      label.textContent = "Все жанры";
      btn.classList.remove("has-selection");
    } else if (state.genres.length === 1) {
      label.textContent = state.genres[0];
      btn.classList.add("has-selection");
    } else {
      label.textContent = `Жанры (${state.genres.length})`;
      btn.classList.add("has-selection");
    }
  }

  /* -------------------- RELEASES SHELF -------------------- */
  function getShelfItems(mode) {
    return state.catalog
      .filter((i) => (mode === "week" ? i.is_week_new : i.is_month_new))
      .sort((a, b) => (mode === "week" ? b.updatedTs - a.updatedTs : b.createdTs - a.createdTs))
      .slice(0, mode === "week" ? 24 : 32);
  }

  function renderShelf() {
    const weekItems = getShelfItems("week");
    const monthItems = getShelfItems("month");
    C.setText("weekCountSpan", weekItems.length);
    C.setText("monthCountSpan", monthItems.length);

    const items = state.shelfMode === "week" ? weekItems : monthItems;
    const track = document.getElementById("releasesTrack");
    if (!track) return;

    if (items.length === 0) {
      track.innerHTML = `<div class="results-summary" style="padding:8px;">Новых тайтлов за этот период пока нет.</div>`;
      return;
    }

    track.innerHTML = items.map((item) => {
      const isWeek = state.shelfMode === "week";
      const img = isWeek ? (item.week_post_image || item.image) : item.image;
      const range = isWeek
        ? (item.week_range ? "Новое: " + item.week_range : item.updated)
        : `1-${item.total_chapters} гл.`;

      return `
        <button type="button" class="release-mini-card" data-release-id="${item.id}">
          <img src="${C.escapeHtml(img)}" referrerpolicy="no-referrer" data-fb="${C.escapeHtml(isWeek ? item.image : (item.remote_image || ""))}" alt="${C.escapeHtml(item.title)}" class="release-mini-img" loading="lazy" decoding="async">
          <div class="release-mini-info">
            <div class="release-mini-title">${C.escapeHtml(item.title)}</div>
            <div class="release-mini-range">${C.escapeHtml(range)}</div>
          </div>
        </button>
      `;
    }).join("");

    track.querySelectorAll("img").forEach((img) => {
      img.onerror = () => C.handleImgError(img, img.dataset.fb);
    });
  }

  function handleReleaseClick(itemId, mode) {
    const item = state.catalog.find((i) => String(i.id) === String(itemId));
    if (!item) return;
    if (mode === "month") {
      M.closeModal("mediaFeedModal");
      M.openChaptersModal(state, item.id, true, false, recordRecentViewed);
      return;
    }
    const span = item.week_chapters_count;
    if (span > 10 || item.all_posts.length > 1 || !item.week_post_link) {
      M.closeModal("mediaFeedModal");
      M.openChaptersModal(state, item.id, true, false, recordRecentViewed);
    } else {
      recordRecentViewed(item.id);
      C.trackEvent("click_boosty_post", { title: item.title });
      window.open(C.buildUtmUrl(item.week_post_link, item.title), "_blank", "noopener,noreferrer");
    }
  }

  /* -------------------- MISSING SEARCH TRACKING -------------------- */
  function trackMissingSearchIfEmpty(q, count) {
    clearTimeout(missingPingTimer);
    if (count > 0 || q.length < 3) return;
    const slug = "q_" + C.translitSlug(q);
    if (state.trackedMissingQueries.has(slug)) return;

    missingPingTimer = setTimeout(() => {
      state.trackedMissingQueries.add(slug);
      const ns = `lirlkz_missing_${C.getMonthYearKey()}`;
      fetch(`https://api.counterapi.dev/v1/${ns}/${encodeURIComponent(slug)}/up`).catch(() => {});
    }, 1200);
  }

  /* -------------------- CATALOG RENDER (CHUNKED) -------------------- */
  function getFilteredCatalog() {
    if (Array.isArray(state.randomIds) && state.randomIds.length > 0) {
      return state.randomIds
        .map((rid) => state.catalog.find((i) => String(i.id) === String(rid)))
        .filter(Boolean);
    }

    const q = state.search.trim().toLowerCase();
    const list = state.catalog.filter((item) => {
      if (state.access === "free" && item.free_chapters <= 0) return false;
      if (state.access === "tier1" && item.paid_chapters <= 0 && item.free_chapters > 0) return false;
      if (state.type !== "all" && item.type !== state.type) return false;

      if (state.genres.length > 0) {
        const hasGenre = state.genres.some((g) => item.tags.includes(g));
        if (!hasGenre) return false;
      }

      if (state.special === "completed" && !item.is_completed) return false;
      if (state.special === "romance" && !item.is_romance) return false;
      if (state.special === "frozen" && !item.is_frozen) return false;

      if (state.tasteTags.length > 0) {
        const itemAllTags = [...item.tags, ...item.hidden_tags].map((x) => String(x).toLowerCase());
        const hasTaste = state.tasteTags.some((t) => itemAllTags.includes(t));
        if (!hasTaste) return false;
      }

      if (q) {
        const hay = [item.title, item.typeLabel, ...item.tags, ...item.hidden_tags].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      if (state.sort === "chapters_desc") return b.total_chapters - a.total_chapters;
      if (state.sort === "free_desc") return b.free_chapters - a.free_chapters;
      if (state.sort === "alpha") return a.title.localeCompare(b.title, "ru");
      return b.updatedTs - a.updatedTs;
    });

    return list;
  }

  function createCardElement(item, idx) {
    const card = document.createElement("article");
    const cls = ["title-card"];
    if (item.is_frozen) cls.push("card-frozen");
    else if (item.is_completed) cls.push("card-completed");
    else if (item.is_romance) cls.push("card-romance");

    card.className = cls.join(" ");
    card.dataset.id = item.id;
    card.oncontextmenu = () => false;

    const badgesArr = [];
    if (item.is_frozen) badgesArr.push(`<span class="card-badge badge-frozen">❄ Заморожен</span>`);
    if (item.is_completed) badgesArr.push(`<span class="card-badge badge-completed">🔥 Завершён</span>`);
    if (item.is_romance) badgesArr.push(`<span class="card-badge badge-romance">🌸 Романтика</span>`);
    const badgesHtml = badgesArr.join("");

    const firstTag = item.tags[0] ? ` • ${C.escapeHtml(item.tags[0])}` : "";
    const hasFree = item.free_chapters > 0;
    const subPrice = state.tiers[0]?.price || item.price;

    const freeInfoHtml = hasFree
      ? `<div class="card-free-line">${item.total_chapters} глав • <strong>${C.escapeHtml(item.free_text)}</strong></div>`
      : `<div class="card-free-line">${item.total_chapters} глав • По подписке</div>`;

    const btnsHtml = hasFree
      ? `<button type="button" class="btn card-btn card-btn-free" data-open-free="${item.id}">Смотреть бесплатно</button>
         <button type="button" class="btn card-btn card-btn-accent" data-open-chapters="${item.id}">Все выпуски (${item.total_chapters} гл.) • ${subPrice} ₽</button>`
      : `<button type="button" class="btn card-btn card-btn-accent" data-open-chapters="${item.id}">Открыть ${item.total_chapters} гл. • ${subPrice} ₽</button>`;

    const fetchPrio = idx < 6 ? 'fetchpriority="high"' : 'loading="lazy"';

    card.innerHTML = `
      <div class="card-cover-wrap" data-open-chapters="${item.id}">
        <div class="cover-skeleton"></div>
        <img src="${C.escapeHtml(item.image)}" referrerpolicy="no-referrer" data-fb="${C.escapeHtml(item.remote_image || "")}" alt="${C.escapeHtml(item.title)}" class="card-cover-img" ${fetchPrio} decoding="async">
        <div class="card-top-badges">
          <div class="card-status-group">${badgesHtml}</div>
          <span class="card-badge">${item.total_chapters} гл.</span>
        </div>
      </div>
      <div class="card-body">
        <div class="card-list-main">
          <h3 class="card-title" data-open-chapters="${item.id}">${C.escapeHtml(item.title)}</h3>
          <div class="card-meta-line">${C.escapeHtml(item.typeLabel)}${firstTag}</div>
          ${freeInfoHtml}
          ${badgesHtml ? `<div class="card-list-badges">${badgesHtml}</div>` : ""}
        </div>
        <div class="card-actions">
          ${btnsHtml}
          <div class="card-footer-row">
            <span>Обновлено: ${C.escapeHtml(item.updated || "—")}</span>
            <button type="button" class="card-share-btn" data-share-id="${item.id}">Поделиться</button>
          </div>
        </div>
      </div>
    `;

    const coverImg = card.querySelector(".card-cover-img");
    if (coverImg) {
      coverImg.onerror = () => C.handleImgError(coverImg, coverImg.dataset.fb);
    }
    return card;
  }

  function appendNextChunk() {
    const grid = document.getElementById("catalogGrid");
    const sentinel = document.getElementById("catalogSentinel");
    if (!grid) return;

    const total = state.filteredCache.length;
    if (state.renderedCount >= total) {
      if (sentinel) sentinel.style.display = "none";
      return;
    }

    const nextEnd = Math.min(total, state.renderedCount + CHUNK_SIZE);
    const frag = document.createDocumentFragment();
    for (let i = state.renderedCount; i < nextEnd; i++) {
      frag.appendChild(createCardElement(state.filteredCache[i], i));
    }
    grid.appendChild(frag);
    state.renderedCount = nextEnd;

    if (sentinel) {
      sentinel.style.display = state.renderedCount < total ? "flex" : "none";
    }
  }

  function setupInfiniteScroll() {
    const sentinel = document.getElementById("catalogSentinel");
    if (!sentinel || !("IntersectionObserver" in window)) return;
    sentinelObserver = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        appendNextChunk();
      }
    }, { rootMargin: "420px 0px" });
    sentinelObserver.observe(sentinel);
  }

  function renderCatalog() {
    const grid = document.getElementById("catalogGrid");
    const empty = document.getElementById("emptyState");
    const sentinel = document.getElementById("catalogSentinel");
    const summary = document.getElementById("resultsSummary");
    if (!grid) return;

    const list = getFilteredCatalog();
    state.filteredCache = list;
    state.renderedCount = 0;

    grid.classList.toggle("is-list", state.viewMode === "list");

    const counts = { manhwa: 0, manhua: 0, manga: 0 };
    list.forEach((i) => { counts[i.type] = (counts[i.type] || 0) + 1; });
    if (summary) {
      summary.textContent = state.randomIds
        ? `Случайная подборка: ${list.length} тайтла из ${state.catalog.length}`
        : `Найдено: ${list.length} из ${state.catalog.length} (манхва: ${counts.manhwa}, маньхуа: ${counts.manhua}, манга: ${counts.manga})`;
    }

    updateResetVisibility();
    trackMissingSearchIfEmpty(state.search.trim().toLowerCase(), list.length);

    grid.innerHTML = "";
    if (list.length === 0) {
      if (empty) empty.style.display = "block";
      if (sentinel) sentinel.style.display = "none";
      return;
    }
    if (empty) empty.style.display = "none";

    appendNextChunk();
  }

  function updateResetVisibility() {
    const has = state.access !== "all" || state.type !== "all" || state.genres.length > 0 ||
      state.special !== "all" || state.search.trim() !== "" || state.tasteTags.length > 0 || Boolean(state.randomIds);
    const resetBtn = document.getElementById("resetFiltersBtn");
    if (resetBtn) resetBtn.style.display = has ? "inline-flex" : "none";

    const cnt = (state.access !== "all" ? 1 : 0) + (state.type !== "all" ? 1 : 0) +
      (state.genres.length > 0 ? 1 : 0) + (state.special !== "all" ? 1 : 0) + (state.tasteTags.length > 0 ? 1 : 0);
    const badge = document.getElementById("mobileFilterCountBadge");
    if (badge) {
      badge.textContent = cnt;
      badge.style.display = cnt > 0 ? "inline-block" : "none";
    }

    const tasteBtn = document.getElementById("tastePickerBtn");
    if (tasteBtn) {
      tasteBtn.classList.toggle("is-active", state.tasteTags.length > 0);
      tasteBtn.textContent = state.tasteTags.length > 0 ? `Теги (${state.tasteTags.length})` : "Теги";
    }
    const mobileTasteBtn = document.getElementById("mobileTasteBtn");
    if (mobileTasteBtn) {
      mobileTasteBtn.textContent = state.tasteTags.length > 0 ? `Теги (${state.tasteTags.length})` : "Теги";
    }
    document.getElementById("randomPickBtn")?.classList.toggle("is-active", Boolean(state.randomIds));
  }

  function syncControlsFromState() {
    ["searchInput", "mobileSearchInput"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = state.search;
    });
    const tf = document.getElementById("typeFilter"); if (tf) tf.value = state.type;
    const sf = document.getElementById("specialFilter"); if (sf) sf.value = state.special;
    const sortF = document.getElementById("sortFilter"); if (sortF) sortF.value = state.sort;

    document.querySelectorAll("#genreCheckboxesList input[type='checkbox']").forEach((cb) => {
      cb.checked = state.genres.includes(cb.value);
    });
    updateGenreButtonLabel();

    document.querySelectorAll("#accessTabs .access-tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.access === state.access);
    });
    document.getElementById("viewGridBtn")?.classList.toggle("active", state.viewMode === "grid");
    document.getElementById("viewListBtn")?.classList.toggle("active", state.viewMode === "list");
  }

  function closeMobileFilterSheet() {
    document.getElementById("filtersPanel")?.classList.remove("mobile-open");
    const bd = document.getElementById("mobileSheetBackdrop");
    if (bd) bd.style.display = "none";
  }

  function pickRandomFour() {
    if (state.catalog.length === 0) return;
    const pool = [...state.catalog];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    state.randomIds = pool.slice(0, 4).map((x) => x.id);
    renderCatalog();
    document.getElementById("catalogSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* -------------------- EVENTS -------------------- */
  function bindEvents() {
    document.getElementById("openYtModalBtn")?.addEventListener("click", () => M.openYtModal(state));
    document.getElementById("openTgModalBtn")?.addEventListener("click", () => M.openTgModal(state));
    document.getElementById("orderVoiceBtn")?.addEventListener("click", () => M.openModal("orderModal"));
    document.getElementById("openDmcaBtn")?.addEventListener("click", () => M.openModal("dmcaModal"));
    document.getElementById("openMediaFeedBtn")?.addEventListener("click", () => M.openMediaFeedModal(state, getShelfItems));
    document.getElementById("loadMoreBtn")?.addEventListener("click", appendNextChunk);

    document.getElementById("clearRecentBtn")?.addEventListener("click", () => {
      state.recentIds = [];
      try { localStorage.removeItem(C.RECENT_KEY); } catch (_) {}
      renderRecentSection();
    });

    const launchTour = () => T.startTour(closeMobileFilterSheet);
    document.getElementById("startTourBtn")?.addEventListener("click", launchTour);
    document.getElementById("footerTourBtn")?.addEventListener("click", launchTour);

    document.getElementById("tastePickerBtn")?.addEventListener("click", () => M.openTasteDrawer(state));
    document.getElementById("mobileTasteBtn")?.addEventListener("click", () => M.openTasteDrawer(state));
    document.getElementById("tasteDrawerClose")?.addEventListener("click", M.closeTasteDrawer);
    document.getElementById("tasteDrawerBackdrop")?.addEventListener("click", M.closeTasteDrawer);
    document.getElementById("tasteTagSearch")?.addEventListener("input", (e) => M.renderTasteTags(state, e.target.value));

    document.getElementById("randomPickBtn")?.addEventListener("click", pickRandomFour);
    document.getElementById("mobileRandomBtn")?.addEventListener("click", pickRandomFour);

    document.getElementById("tasteClearBtn")?.addEventListener("click", () => {
      state.tasteTags = [];
      state.randomIds = null;
      saveFilters();
      M.renderTasteTags(state, document.getElementById("tasteTagSearch")?.value || "");
      renderCatalog();
    });

    document.getElementById("tasteApplyBtn")?.addEventListener("click", () => {
      state.randomIds = null;
      saveFilters();
      M.closeTasteDrawer();
      renderCatalog();
    });

    const genreBtn = document.getElementById("genreMultiBtn");
    const genreDd = document.getElementById("genreDropdown");
    genreBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = genreDd?.style.display === "none";
      if (genreDd) genreDd.style.display = open ? "flex" : "none";
      genreBtn.setAttribute("aria-expanded", String(open));
    });

    document.getElementById("genreCheckboxesList")?.addEventListener("change", (e) => {
      if (e.target.type !== "checkbox") return;
      state.randomIds = null;
      const val = e.target.value;
      if (e.target.checked) {
        if (!state.genres.includes(val)) state.genres.push(val);
      } else {
        state.genres = state.genres.filter((g) => g !== val);
      }
      updateGenreButtonLabel();
      saveFilters();
      renderCatalog();
    });

    document.getElementById("genreClearBtn")?.addEventListener("click", () => {
      state.genres = [];
      state.randomIds = null;
      syncControlsFromState();
      saveFilters();
      renderCatalog();
    });

    document.getElementById("tabWeekBtn")?.addEventListener("click", () => {
      state.shelfMode = "week";
      document.getElementById("tabWeekBtn")?.classList.add("active");
      document.getElementById("tabMonthBtn")?.classList.remove("active");
      renderShelf();
    });
    document.getElementById("tabMonthBtn")?.addEventListener("click", () => {
      state.shelfMode = "month";
      document.getElementById("tabMonthBtn")?.classList.add("active");
      document.getElementById("tabWeekBtn")?.classList.remove("active");
      renderShelf();
    });

    const track = document.getElementById("releasesTrack");
    document.getElementById("shelfPrevBtn")?.addEventListener("click", () => track?.scrollBy({ left: -520, behavior: "smooth" }));
    document.getElementById("shelfNextBtn")?.addEventListener("click", () => track?.scrollBy({ left: 520, behavior: "smooth" }));

    document.getElementById("modalTabWeekBtn")?.addEventListener("click", () => {
      state.modalShelfMode = "week";
      M.renderMediaFeedGrid(state, getShelfItems);
    });
    document.getElementById("modalTabMonthBtn")?.addEventListener("click", () => {
      state.modalShelfMode = "month";
      M.renderMediaFeedGrid(state, getShelfItems);
    });

    document.getElementById("mobileFiltersToggle")?.addEventListener("click", () => {
      const p = document.getElementById("filtersPanel");
      const bd = document.getElementById("mobileSheetBackdrop");
      const open = !p?.classList.contains("mobile-open");
      p?.classList.toggle("mobile-open", open);
      if (bd) bd.style.display = open ? "block" : "none";
    });
    document.getElementById("mobileSheetClose")?.addEventListener("click", closeMobileFilterSheet);
    document.getElementById("mobileSheetBackdrop")?.addEventListener("click", closeMobileFilterSheet);

    const onSearch = (val) => {
      state.randomIds = null;
      state.search = val;
      ["searchInput", "mobileSearchInput"].forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.value !== val) el.value = val;
      });
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        saveFilters();
        renderCatalog();
      }, 160);
    };
    document.getElementById("searchInput")?.addEventListener("input", (e) => onSearch(e.target.value));
    document.getElementById("mobileSearchInput")?.addEventListener("input", (e) => onSearch(e.target.value));

    document.getElementById("typeFilter")?.addEventListener("change", (e) => { state.randomIds = null; state.type = e.target.value; saveFilters(); renderCatalog(); });
    document.getElementById("specialFilter")?.addEventListener("change", (e) => { state.randomIds = null; state.special = e.target.value; saveFilters(); renderCatalog(); });
    document.getElementById("sortFilter")?.addEventListener("change", (e) => { state.randomIds = null; state.sort = e.target.value; saveFilters(); renderCatalog(); });

    const reset = () => {
      state.access = "all"; state.type = "all"; state.genres = [];
      state.special = "all"; state.sort = "newest"; state.search = "";
      state.tasteTags = []; state.randomIds = null;
      saveFilters(); syncControlsFromState(); renderCatalog();
    };
    document.getElementById("resetFiltersBtn")?.addEventListener("click", reset);
    document.getElementById("emptyResetBtn")?.addEventListener("click", reset);

    document.getElementById("viewGridBtn")?.addEventListener("click", () => { state.viewMode = "grid"; saveFilters(); syncControlsFromState(); renderCatalog(); });
    document.getElementById("viewListBtn")?.addEventListener("click", () => { state.viewMode = "list"; saveFilters(); syncControlsFromState(); renderCatalog(); });

    document.addEventListener("click", (e) => {
      if (genreDd && genreDd.style.display !== "none" && !e.target.closest("#genreMultiWrap")) {
        genreDd.style.display = "none";
        genreBtn?.setAttribute("aria-expanded", "false");
      }

      const ym = e.target.closest("[data-ym-event]");
      if (ym) C.trackEvent(ym.dataset.ymEvent, { title: ym.dataset.ymTitle || "" });

      const cl = e.target.closest("[data-close-modal]");
      if (cl) { M.closeModal(cl.dataset.closeModal); return; }
      if (e.target.classList.contains("modal-backdrop")) { M.closeModal(e.target.id); return; }

      const acc = e.target.closest("#accessTabs .access-tab");
      if (acc) { state.randomIds = null; state.access = acc.dataset.access; saveFilters(); syncControlsFromState(); renderCatalog(); return; }

      const tasteChip = e.target.closest("[data-taste-tag]");
      if (tasteChip) {
        const tag = tasteChip.dataset.tasteTag;
        if (state.tasteTags.includes(tag)) {
          state.tasteTags = state.tasteTags.filter((x) => x !== tag);
          tasteChip.classList.remove("is-selected");
        } else {
          state.tasteTags.push(tag);
          tasteChip.classList.add("is-selected");
        }
        M.updateTasteApplyButton(state);
        return;
      }

      const help = e.target.closest("[data-tier-help]");
      if (help) { M.openTierInfoModal(state, help.dataset.tierHelp); return; }

      const share = e.target.closest("[data-share-id]");
      if (share) {
        const it = state.catalog.find((x) => String(x.id) === String(share.dataset.shareId));
        if (it) {
          navigator.clipboard?.writeText(C.buildUtmUrl(it.url, it.title)).catch(() => {});
          const orig = share.textContent; share.textContent = "Скопировано";
          setTimeout(() => { share.textContent = orig; }, 1200);
        }
        return;
      }

      const freeBtn = e.target.closest("[data-open-free]");
      if (freeBtn) { M.openChaptersModal(state, freeBtn.dataset.openFree, false, true, recordRecentViewed); return; }

      const ch = e.target.closest("[data-open-chapters]");
      if (ch) { M.openChaptersModal(state, ch.dataset.openChapters, false, false, recordRecentViewed); return; }

      const rel = e.target.closest("[data-release-id]");
      if (rel) { handleReleaseClick(rel.dataset.releaseId, state.shelfMode); return; }

      const feed = e.target.closest("[data-feed-id]");
      if (feed) { handleReleaseClick(feed.dataset.feedId, state.modalShelfMode); return; }

      const tg = e.target.closest("[data-tg-idx]");
      if (tg) { M.openTgPostReader(state, Number(tg.dataset.tgIdx)); return; }
    });

    T.bindTourEvents();

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        T.endTour();
        closeMobileFilterSheet();
        M.closeTasteDrawer();
        if (genreDd) genreDd.style.display = "none";
        const open = Array.from(document.querySelectorAll(".modal-backdrop")).filter((m) => m.style.display === "flex");
        if (open.length) M.closeModal(open[open.length - 1].id);
      }
    });
  }

  initTheme();
  checkGeoRestriction();
  loadSavedFilters();
  bindEvents();
  loadCatalog();
})();
