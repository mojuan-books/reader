/**
 * =========================================================
 * 多作品閱讀器
 *
 * 資料結構（建議）：
 *   books/catalog.json              → 書庫清單（選書首頁）
 *   books/<book-id>/book.json       → 該書簡介 + 章節目錄
 *   books/<book-id>/ch01.json       → 章節內文（intro/content/outro）
 *
 * 書與章要不要「編號」？
 *   - 書：用英文／拼音 slug 當資料夾名（如 zhou-ming），不要只用 book1、book2
 *     網址較穩定，之後改書名也不必改路徑。
 *   - 章：檔名可用 ch01、ch02 方便排序；真正順序以 book.json 的 order 為準。
 *     每本書各自從第 1 章起算，不必跨書連續編號。
 *
 * 網址：
 *   #/                              書庫
 *   #/book/zhou-ming                作品首頁
 *   #/book/zhou-ming/toc            章節目錄
 *   #/book/zhou-ming/read/ch01      閱讀
 *
 * 【發布日期】未到日的章節靜默隱藏。僅前端判斷。
 * 本地測試：npx serve .
 * =========================================================
 */

(function () {
  "use strict";

  const BOOKS_DIR = "books";
  const CATALOG_URL = `${BOOKS_DIR}/catalog.json`;

  const STORAGE = {
    theme: "inkscroll:theme",
    font: "inkscroll:fontSize",
    lastBook: "inkscroll:lastBookId",
    chapterFor: (bookId) => `inkscroll:${bookId}:lastChapterId`,
  };

  const els = {
    bootStatus: document.getElementById("boot-status"),
    siteTitle: document.getElementById("site-title"),
    footerText: document.getElementById("footer-text"),
    btnLibrary: document.getElementById("btn-library"),
    btnNavBook: document.getElementById("btn-nav-book"),
    btnNavToc: document.getElementById("btn-nav-toc"),
    btnSettings: document.getElementById("btn-settings"),
    settingsPanel: document.getElementById("settings-panel"),
    viewLibrary: document.getElementById("view-library"),
    viewHome: document.getElementById("view-home"),
    viewToc: document.getElementById("view-toc"),
    viewReader: document.getElementById("view-reader"),
    libraryTitle: document.getElementById("library-title"),
    librarySubtitle: document.getElementById("library-subtitle"),
    bookGrid: document.getElementById("book-grid"),
    homeTitle: document.getElementById("home-title"),
    homeSubtitle: document.getElementById("home-subtitle"),
    homeAuthor: document.getElementById("home-author"),
    homeTags: document.getElementById("home-tags"),
    homeSynopsis: document.getElementById("home-synopsis"),
    homeStats: document.getElementById("home-stats"),
    btnStartRead: document.getElementById("btn-start-read"),
    btnGoToc: document.getElementById("btn-go-toc"),
    btnBackLibrary: document.getElementById("btn-back-library"),
    tocPageTitle: document.getElementById("toc-page-title"),
    tocMeta: document.getElementById("toc-meta"),
    tocList: document.getElementById("toc-list"),
    btnTocBackHome: document.getElementById("btn-toc-back-home"),
    btnReaderToc: document.getElementById("btn-reader-toc"),
    chapterLabel: document.getElementById("chapter-label"),
    chapterTitle: document.getElementById("chapter-title"),
    chapterDate: document.getElementById("chapter-date"),
    intro: document.getElementById("chapter-intro"),
    introBody: document.getElementById("chapter-intro-body"),
    content: document.getElementById("chapter-content"),
    outro: document.getElementById("chapter-outro"),
    outroBody: document.getElementById("chapter-outro-body"),
    btnPrev: document.getElementById("btn-prev"),
    btnNext: document.getElementById("btn-next"),
    prevTitle: document.getElementById("prev-title"),
    nextTitle: document.getElementById("next-title"),
  };

  /** @type {{ siteTitle?: string, siteSubtitle?: string, footer?: string, books: Array }} */
  let CATALOG = { books: [] };
  /** @type {object|null} */
  let currentBook = null;
  let currentBookId = null;
  let currentChapterId = null;
  let currentView = "library";
  let loadingChapter = false;

  /** bookId → book.json 快取 */
  const bookCache = new Map();
  /** `${bookId}/${chapterId}` → 內文快取 */
  const chapterCache = new Map();

  /* ---------- 工具 ---------- */

  function todayISO() {
    const d = new Date();
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    ].join("-");
  }

  function isPublished(chapter, today) {
    if (!chapter.publishDate) return true;
    return chapter.publishDate <= today;
  }

  function hasText(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function textToParagraphs(text) {
    const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
    if (!normalized) return "";
    return normalized
      .split(/\n{2,}/)
      .map((block) => `<p>${escapeHtml(block.trim()).replace(/\n/g, "<br>")}</p>`)
      .join("");
  }

  function formatDateLabel(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `發布於 ${y} 年 ${Number(m)} 月 ${Number(d)} 日`;
  }

  function catalogEntry(bookId) {
    return (CATALOG.books || []).find((b) => b.id === bookId) || null;
  }

  function bookFolder(bookId) {
    const entry = catalogEntry(bookId);
    return entry && entry.folder ? entry.folder : bookId;
  }

  function sortedChapters() {
    if (!currentBook || !Array.isArray(currentBook.chapters)) return [];
    return [...currentBook.chapters].sort(
      (a, b) => a.order - b.order || String(a.id).localeCompare(String(b.id))
    );
  }

  function visibleChapters() {
    const today = todayISO();
    return sortedChapters().filter((ch) => isPublished(ch, today));
  }

  function findChapter(id) {
    return sortedChapters().find((ch) => ch.id === id) || null;
  }

  function firstVisibleId() {
    const list = visibleChapters();
    return list[0] ? list[0].id : null;
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`無法載入 ${url}（${res.status}）`);
    return res.json();
  }

  async function loadBook(bookId) {
    if (bookCache.has(bookId)) return bookCache.get(bookId);
    const folder = bookFolder(bookId);
    const data = await fetchJson(`${BOOKS_DIR}/${folder}/book.json`);
    bookCache.set(bookId, data);
    return data;
  }

  async function loadChapterBody(bookId, meta) {
    const key = `${bookId}/${meta.id}`;
    if (chapterCache.has(key)) return chapterCache.get(key);
    const folder = bookFolder(bookId);
    const data = await fetchJson(`${BOOKS_DIR}/${folder}/${meta.file}`);
    const body = {
      intro: data.intro || "",
      content: data.content || "",
      outro: data.outro || "",
    };
    chapterCache.set(key, body);
    return body;
  }

  /* ---------- 路由 ---------- */

  function parseHash() {
    const raw = (window.location.hash || "#/").replace(/^#/, "");
    const parts = raw.split("/").filter(Boolean);
    // #/book/:id[/toc|/read/:ch]
    if (parts[0] === "book" && parts[1]) {
      const bookId = parts[1];
      if (parts[2] === "toc") return { view: "toc", bookId, chapterId: null };
      if (parts[2] === "read") return { view: "read", bookId, chapterId: parts[3] || null };
      return { view: "home", bookId, chapterId: null };
    }
    return { view: "library", bookId: null, chapterId: null };
  }

  function setHash(view, bookId, chapterId) {
    let next = "#/";
    if (view === "home" && bookId) next = `#/book/${bookId}`;
    if (view === "toc" && bookId) next = `#/book/${bookId}/toc`;
    if (view === "read" && bookId) {
      next = chapterId ? `#/book/${bookId}/read/${chapterId}` : `#/book/${bookId}/read`;
    }
    if (window.location.hash !== next) {
      window.location.hash = next;
    } else {
      applyRoute();
    }
  }

  function showView(view) {
    currentView = view;
    document.body.dataset.view = view;
    els.viewLibrary.hidden = view !== "library";
    els.viewHome.hidden = view !== "home";
    els.viewToc.hidden = view !== "toc";
    els.viewReader.hidden = view !== "read";

    const inBook = view !== "library" && Boolean(currentBookId);
    els.btnNavBook.hidden = !inBook;
    els.btnNavToc.hidden = !inBook;

    closeSettings();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function ensureBook(bookId) {
    if (!bookId) throw new Error("缺少作品 id");
    if (!catalogEntry(bookId)) throw new Error(`書庫中找不到作品：${bookId}`);
    currentBook = await loadBook(bookId);
    currentBookId = bookId;
    localStorage.setItem(STORAGE.lastBook, bookId);
    renderBookHome();
  }

  async function applyRoute() {
    const route = parseHash();

    try {
      if (route.view === "library") {
        currentBookId = null;
        currentBook = null;
        currentChapterId = null;
        renderLibrary();
        showView("library");
        return;
      }

      await ensureBook(route.bookId);

      if (route.view === "toc") {
        renderToc();
        showView("toc");
        return;
      }

      if (route.view === "read") {
        showView("read");
        await openChapter(route.chapterId || firstVisibleId());
        return;
      }

      showView("home");
    } catch (err) {
      console.error(err);
      els.bootStatus.hidden = false;
      els.bootStatus.classList.add("is-error");
      els.bootStatus.textContent = err.message;
      showView("library");
      renderLibrary();
    }
  }

  /* ---------- 設定 ---------- */

  function applyTheme(theme) {
    const allowed = ["parchment", "ink", "mist"];
    const value = allowed.includes(theme) ? theme : "parchment";
    document.body.dataset.theme = value;
    localStorage.setItem(STORAGE.theme, value);
    document.querySelectorAll("[data-theme]").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.theme === value));
    });
  }

  function applyFontSize(size) {
    const allowed = ["sm", "md", "lg"];
    const value = allowed.includes(size) ? size : "md";
    document.body.dataset.fontSize = value;
    localStorage.setItem(STORAGE.font, value);
    document.querySelectorAll("[data-font]").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.font === value));
    });
  }

  function toggleSettings() {
    const open = els.settingsPanel.hidden;
    els.settingsPanel.hidden = !open;
    els.btnSettings.setAttribute("aria-expanded", String(open));
  }

  function closeSettings() {
    els.settingsPanel.hidden = true;
    els.btnSettings.setAttribute("aria-expanded", "false");
  }

  /* ---------- 書庫 ---------- */

  function renderLibrary() {
    const siteTitle = CATALOG.siteTitle || "墨卷";
    els.libraryTitle.textContent = siteTitle;
    els.siteTitle.textContent = siteTitle;
    document.title = siteTitle;

    if (hasText(CATALOG.siteSubtitle)) {
      els.librarySubtitle.hidden = false;
      els.librarySubtitle.textContent = CATALOG.siteSubtitle;
    } else {
      els.librarySubtitle.hidden = true;
      els.librarySubtitle.textContent = "";
    }

    if (CATALOG.footer) els.footerText.textContent = CATALOG.footer;

    els.bookGrid.innerHTML = "";
    const books = CATALOG.books || [];

    if (!books.length) {
      const empty = document.createElement("p");
      empty.className = "toc-meta";
      empty.textContent = "書庫尚無作品。請在 books/catalog.json 新增。";
      els.bookGrid.appendChild(empty);
      return;
    }

    books.forEach((book) => {
      // 版面與作品首頁相同；差異僅在 hero 下方：作品頁是三顆按鈕，書庫是一行提示
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "book-card";
      btn.setAttribute("aria-label", `進入作品：${book.title || book.id}`);
      btn.innerHTML =
        '<section class="home-hero">' +
        '<h2 class="home-title"></h2>' +
        '<p class="home-subtitle"></p>' +
        '<p class="home-author"></p>' +
        '<ul class="home-tags"></ul>' +
        '<p class="book-card-hint"></p>' +
        "</section>";

      btn.querySelector(".home-title").textContent = book.title || book.id;

      const sub = btn.querySelector(".home-subtitle");
      if (hasText(book.subtitle)) {
        sub.textContent = book.subtitle;
      } else {
        sub.hidden = true;
      }

      const author = btn.querySelector(".home-author");
      if (hasText(book.author)) {
        author.textContent = `作者 · ${book.author}`;
      } else {
        author.hidden = true;
      }

      const tags = btn.querySelector(".home-tags");
      if (Array.isArray(book.tags) && book.tags.length) {
        book.tags.forEach((tag) => {
          const li = document.createElement("li");
          li.textContent = tag;
          tags.appendChild(li);
        });
      } else {
        tags.hidden = true;
      }

      const hint = btn.querySelector(".book-card-hint");
      hint.textContent = hasText(book.blurb) ? book.blurb : "點此進入作品";

      btn.addEventListener("click", () => setHash("home", book.id));
      els.bookGrid.appendChild(btn);
    });
  }

  /* ---------- 作品首頁 ---------- */

  function renderBookHome() {
    if (!currentBook) return;

    const title = currentBook.title || currentBookId;
    els.homeTitle.textContent = title;
    els.tocPageTitle.textContent = title;
    document.title = `${title} · ${CATALOG.siteTitle || "墨卷"}`;

    if (hasText(currentBook.subtitle)) {
      els.homeSubtitle.hidden = false;
      els.homeSubtitle.textContent = currentBook.subtitle;
    } else {
      els.homeSubtitle.hidden = true;
      els.homeSubtitle.textContent = "";
    }

    if (hasText(currentBook.author)) {
      els.homeAuthor.hidden = false;
      els.homeAuthor.textContent = `作者 · ${currentBook.author}`;
    } else {
      els.homeAuthor.hidden = true;
      els.homeAuthor.textContent = "";
    }

    els.homeTags.innerHTML = "";
    if (Array.isArray(currentBook.tags) && currentBook.tags.length) {
      els.homeTags.hidden = false;
      currentBook.tags.forEach((tag) => {
        const li = document.createElement("li");
        li.textContent = tag;
        els.homeTags.appendChild(li);
      });
    } else {
      els.homeTags.hidden = true;
    }

    els.homeSynopsis.innerHTML = hasText(currentBook.synopsis)
      ? textToParagraphs(currentBook.synopsis)
      : '<p class="no-indent">（尚無作品簡介）</p>';

    const visible = visibleChapters();
    els.homeStats.textContent = `共 ${visible.length} 章`;
    els.btnStartRead.disabled = !visible.length;
  }

  /* ---------- 目錄 ---------- */

  function renderToc() {
    const visible = visibleChapters();
    els.tocMeta.textContent = `共 ${visible.length} 章`;
    els.tocList.innerHTML = "";

    if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "toc-meta";
      empty.textContent = "目前沒有可閱讀的章節。";
      els.tocList.appendChild(empty);
      return;
    }

    visible.forEach((ch, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "toc-item" + (ch.id === currentChapterId ? " is-active" : "");
      btn.innerHTML =
        `<span class="toc-item-index">第 ${index + 1} 章</span>` +
        '<span class="toc-item-title"></span>';
      btn.querySelector(".toc-item-title").textContent = ch.title;
      btn.addEventListener("click", () => setHash("read", currentBookId, ch.id));
      els.tocList.appendChild(btn);
    });
  }

  /* ---------- 閱讀 ---------- */

  async function openChapter(id) {
    if (loadingChapter || !currentBookId) return;

    const list = visibleChapters();
    let meta = id ? findChapter(id) : null;
    if (meta && !isPublished(meta, todayISO())) meta = null;
    if (!meta) meta = list[0] || null;

    if (!meta) {
      els.chapterLabel.textContent = "";
      els.chapterTitle.textContent = "尚無章節";
      els.chapterDate.textContent = "";
      els.intro.hidden = true;
      els.outro.hidden = true;
      els.content.innerHTML = '<p class="no-indent">目前沒有可顯示的章節。</p>';
      currentChapterId = null;
      updateNav();
      return;
    }

    loadingChapter = true;
    els.content.innerHTML = '<p class="no-indent">載入章節中…</p>';
    els.intro.hidden = true;
    els.outro.hidden = true;

    try {
      const body = await loadChapterBody(currentBookId, meta);
      currentChapterId = meta.id;
      localStorage.setItem(STORAGE.chapterFor(currentBookId), currentChapterId);

      const desired = `#/book/${currentBookId}/read/${currentChapterId}`;
      if (window.location.hash !== desired) {
        history.replaceState(null, "", desired);
      }

      const index = list.findIndex((ch) => ch.id === currentChapterId);
      els.chapterLabel.textContent = `第 ${index + 1} 章`;
      els.chapterTitle.textContent = meta.title;
      els.chapterDate.textContent = formatDateLabel(meta.publishDate);

      if (hasText(body.intro)) {
        els.intro.hidden = false;
        els.introBody.innerHTML = textToParagraphs(body.intro);
      } else {
        els.intro.hidden = true;
        els.introBody.innerHTML = "";
      }

      els.content.innerHTML =
        textToParagraphs(body.content) ||
        '<p class="no-indent">（本章尚無正文）</p>';

      if (hasText(body.outro)) {
        els.outro.hidden = false;
        els.outroBody.innerHTML = textToParagraphs(body.outro);
      } else {
        els.outro.hidden = true;
        els.outroBody.innerHTML = "";
      }

      updateNav();
    } catch (err) {
      console.error(err);
      els.chapterTitle.textContent = meta.title;
      els.content.innerHTML = `<p class="no-indent">章節載入失敗：${escapeHtml(err.message)}</p>`;
    } finally {
      loadingChapter = false;
    }
  }

  function updateNav() {
    const list = visibleChapters();
    const index = list.findIndex((ch) => ch.id === currentChapterId);
    const prev = index > 0 ? list[index - 1] : null;
    const next = index >= 0 && index < list.length - 1 ? list[index + 1] : null;

    els.btnPrev.disabled = !prev;
    els.btnNext.disabled = !next;
    els.prevTitle.textContent = prev ? prev.title : "已是第一章";
    els.nextTitle.textContent = next ? next.title : "已是最後一章";

    els.btnPrev.onclick = prev
      ? () => setHash("read", currentBookId, prev.id)
      : null;
    els.btnNext.onclick = next
      ? () => setHash("read", currentBookId, next.id)
      : null;
  }

  /* ---------- 初始化 ---------- */

  function initPrefs() {
    applyTheme(localStorage.getItem(STORAGE.theme) || "parchment");
    applyFontSize(localStorage.getItem(STORAGE.font) || "md");
  }

  function bindEvents() {
    els.btnLibrary.addEventListener("click", () => setHash("library"));
    els.btnBackLibrary.addEventListener("click", () => setHash("library"));
    els.btnNavBook.addEventListener("click", () => {
      if (currentBookId) setHash("home", currentBookId);
    });
    els.btnNavToc.addEventListener("click", () => {
      if (currentBookId) setHash("toc", currentBookId);
    });
    els.btnGoToc.addEventListener("click", () => {
      if (currentBookId) setHash("toc", currentBookId);
    });
    els.btnTocBackHome.addEventListener("click", () => {
      if (currentBookId) setHash("home", currentBookId);
    });
    els.btnReaderToc.addEventListener("click", () => {
      if (currentBookId) setHash("toc", currentBookId);
    });

    els.btnStartRead.addEventListener("click", () => {
      const id = firstVisibleId();
      if (id && currentBookId) setHash("read", currentBookId, id);
    });

    els.btnSettings.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSettings();
    });

    document.addEventListener("click", (e) => {
      if (
        !els.settingsPanel.hidden &&
        !els.settingsPanel.contains(e.target) &&
        e.target !== els.btnSettings &&
        !els.btnSettings.contains(e.target)
      ) {
        closeSettings();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSettings();
      if (currentView !== "read") return;
      if (e.key === "ArrowLeft" && !els.btnPrev.disabled) els.btnPrev.click();
      if (e.key === "ArrowRight" && !els.btnNext.disabled) els.btnNext.click();
    });

    document.querySelectorAll("[data-theme]").forEach((btn) => {
      btn.addEventListener("click", () => applyTheme(btn.dataset.theme));
    });
    document.querySelectorAll("[data-font]").forEach((btn) => {
      btn.addEventListener("click", () => applyFontSize(btn.dataset.font));
    });

    window.addEventListener("hashchange", () => {
      applyRoute();
    });
  }

  async function boot() {
    initPrefs();
    bindEvents();

    try {
      CATALOG = await fetchJson(CATALOG_URL);
      if (!CATALOG.books) CATALOG.books = [];

      els.bootStatus.hidden = true;
      els.siteTitle.textContent = CATALOG.siteTitle || "墨卷";
      if (CATALOG.footer) els.footerText.textContent = CATALOG.footer;

      if (!window.location.hash || window.location.hash === "#") {
        history.replaceState(null, "", "#/");
      }
      await applyRoute();
    } catch (err) {
      console.error(err);
      els.bootStatus.hidden = false;
      els.bootStatus.classList.add("is-error");
      els.bootStatus.innerHTML =
        `載入失敗：${escapeHtml(err.message)}<br>` +
        "請用本機伺服器開啟（例如 <code>npx serve .</code>）。";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
