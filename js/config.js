/* Конфигурация, константы и утилиты Lirlkz */
(function () {
  "use strict";

  const BLOG_URL = "https://boosty.to/wynin";
  const SUB_PURCHASE_URL = "https://boosty.to/wynin/purchase/3908979?ssource=DIRECT&share=subscription_link";
  const YT_CHANNEL_ID = "UCsHCRGmegflCQsJTLqS817Q";
  const YT_CHANNEL_URL = "https://www.youtube.com/@LirlkzManga";
  const TG_CHANNEL_URL = "https://t.me/LirlkzManga";
  const TG_PERSONAL_URL = "https://t.me/Lirtkz";

  const STORAGE_KEY = "lirlkz_vitrina_filters_v1";
  const TOUR_DONE_KEY = "lirlkz_tour_done_v1";
  const VISIT_COUNT_KEY = "lirlkz_visit_count_v1";
  const PROMO_LAST_KEY = "lirlkz_promo_last_v1";
  const RECENT_KEY = "lirlkz_recent_viewed_v1";

  const PLACEHOLDER_SVG =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">' +
        '<rect width="400" height="600" fill="#0B192C"/>' +
        '<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#38BDF8" font-family="sans-serif" font-size="28" font-weight="800">LIRLKZ</text>' +
      "</svg>"
    );

  const TYPE_LABELS = {
    manhwa: "Манхва",
    manhua: "Маньхуа",
    manga: "Манга"
  };

  const DEFAULT_TIERS = [
    {
      id: "3908979",
      tier: 1,
      kicker: "ЕДИНАЯ ПОДПИСКА • ПОЛНЫЙ ДОСТУП",
      title: "Полный доступ ко всем тайтлам",
      desc: "Открывает все платные главы, эксклюзивные серии и ранний доступ к новым выпускам до выхода на YouTube.",
      price: 200,
      old_price: 0,
      discount: "",
      url: SUB_PURCHASE_URL,
      ymEvent: "click_tariff_main",
      featured: true
    }
  ];

  const PROMO_VARIANTS = [
    {
      badge: "Для постоянных зрителей",
      title: "Снова заглянули на витрину?",
      desc: "Откройте доступ сразу ко всем закрытым главам и новым сериям раньше всех — без ожидания на YouTube.",
      perks: ["Все тайтлы и закрытые главы сразу", "Единый уровень подписки без ограничений", "Регулярные обновления озвучки"],
      cta: "Оформить подписку на Boosty ↗"
    },
    {
      badge: "Ранний доступ",
      title: "Не ждите выхода серий на YouTube",
      desc: "Новые главы выходят на Boosty раньше. Единая подписка снимает все ограничения по каталогу.",
      perks: ["Полный доступ ко всем платным главам", "Все онгоинги и завершённые проекты", "Просмотр в удобном порядке по бандлам"],
      cta: "Открыть полный доступ ↗"
    },
    {
      badge: "Полная база озвучки",
      title: "Хватит искать бесплатные отрывки",
      desc: "Заберите полный доступ ко всем проектам канала Lirlkz в одном месте.",
      perks: ["Вся библиотека озвучки по одной подписке", "Удобный переход к нужной главе", "Прямая поддержка выхода новых серий"],
      cta: "Забрать полный доступ ↗"
    }
  ];

  function trackEvent(eventName, params) {
    try {
      if (typeof window.ym === "function") {
        window.ym(114099972, "reachGoal", eventName, params || {});
      }
    } catch (_) {}
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function strictNormalize(str) {
    return String(str || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/(?:манга|манхва|маньхуа)\s+с\s+озвучкой/gi, "")
      .replace(/озвучка\s+(?:манги|манхвы|маньхуа)/gi, "")
      .replace(/пересказ\s+(?:манги|манхвы|маньхуа)/gi, "")
      .replace(/(?:глав[аы]?|гл\.?)\s*\d+(?:\s*[-–,]\s*\d+)*/gi, "")
      .replace(/(\d+\s*[-–]\s*\d+\s*глав.*)/gi, "")
      .replace(/[^a-zа-я0-9]/gi, "");
  }

  function normalizeTypeKey(rawType) {
    const s = String(rawType || "").trim().toLowerCase();
    if (s === "manhua" || s === "маньхуа") return "manhua";
    if (s === "manga" || s === "манга") return "manga";
    return "manhwa";
  }

  function parseTierSafe() {
    return 1;
  }

  function translitSlug(text) {
    const map = {
      а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
      з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
      п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
      ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya"
    };
    return String(text || "")
      .toLowerCase()
      .split("")
      .map((ch) => (map[ch] !== undefined ? map[ch] : ch))
      .join("")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "title";
  }

  function buildUtmUrl(rawUrl, title) {
    if (!rawUrl) return BLOG_URL;
    try {
      const url = new URL(rawUrl, BLOG_URL);
      url.searchParams.set("utm_campaign", translitSlug(title));
      return url.toString();
    } catch (_) {
      return rawUrl;
    }
  }

  function parseDateValue(dateStr) {
    if (!dateStr) return 0;
    const m = String(dateStr).match(/(\d{2})[.\/-](\d{2})[.\/-](\d{4})/);
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
    const iso = Date.parse(dateStr);
    return Number.isNaN(iso) ? 0 : iso;
  }

  function extractChapterSpan(rangeStr) {
    const nums = String(rangeStr || "").match(/\d+/g);
    if (!nums || nums.length === 0) return 0;
    if (nums.length === 1) return 1;
    const a = Number(nums[0]);
    const b = Number(nums[nums.length - 1]);
    return b >= a ? b - a + 1 : 1;
  }

  function extractChaptersFromTitle(title) {
    const s = String(title || "");
    const commaMatch = s.match(/(?:глав[аы]?|гл\.?)?\s*(\d+(?:\s*,\s*\d+)+)/i);
    if (commaMatch) {
      const nums = commaMatch[1].match(/\d+/g)?.map(Number).filter((n) => n > 0 && n < 2500) || [];
      if (nums.length >= 2) {
        const minN = Math.min(...nums);
        const maxN = Math.max(...nums);
        return minN !== maxN ? `${minN}-${maxN} гл.` : `${maxN} гл.`;
      }
    }
    const rangeMatch = s.match(/(?:глав[аы]?|гл\.?)?\s*(\d+\s*[-–]\s*\d+)\s*(?:гл|глав\w*)?/i);
    if (rangeMatch) {
      return rangeMatch[1].replace(/\s+/g, "") + " гл.";
    }
    const singleMatch = s.match(/(?:глав[аы]?|гл\.?)\s*(\d+)|(\d+)\s*(?:глав[аы]?|гл\.?)/i);
    if (singleMatch) {
      return (singleMatch[1] || singleMatch[2]) + " гл.";
    }
    return "";
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function getMonthYearKey() {
    const d = new Date();
    return `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function handleImgError(imgEl, fallbackUrl) {
    if (!imgEl) return;
    if (fallbackUrl && !imgEl.dataset.triedFb) {
      imgEl.dataset.triedFb = "1";
      imgEl.src = fallbackUrl;
      return;
    }
    if (!imgEl.dataset.retried) {
      imgEl.dataset.retried = "1";
      const orig = imgEl.src;
      if (orig && !orig.startsWith("data:")) {
        setTimeout(() => {
          const sep = orig.includes("?") ? "&" : "?";
          imgEl.src = orig + sep + "r=1";
        }, 500);
        return;
      }
    }
    imgEl.onerror = null;
    imgEl.src = PLACEHOLDER_SVG;
  }

  window.TakaConfig = {
    BLOG_URL,
    SUB_PURCHASE_URL,
    YT_CHANNEL_ID,
    YT_CHANNEL_URL,
    TG_CHANNEL_URL,
    TG_PERSONAL_URL,
    STORAGE_KEY,
    TOUR_DONE_KEY,
    VISIT_COUNT_KEY,
    PROMO_LAST_KEY,
    RECENT_KEY,
    PLACEHOLDER_SVG,
    TYPE_LABELS,
    DEFAULT_TIERS,
    PROMO_VARIANTS,
    trackEvent,
    escapeHtml,
    strictNormalize,
    normalizeTypeKey,
    parseTierSafe,
    translitSlug,
    buildUtmUrl,
    parseDateValue,
    extractChapterSpan,
    extractChaptersFromTitle,
    setText,
    getMonthYearKey,
    handleImgError
  };
})();
