// js/customSelect.js

let openContainer = null;

function setCardElevated(selectEl, on) {
  const card = selectEl?.closest?.(".card");
  if (!card) return;
  if (on) card.classList.add("dropdown-elevated");
  else card.classList.remove("dropdown-elevated");
}

function closeOpenIfNeeded(target) {
  if (!openContainer) return;

  if (!target || !openContainer.contains(target)) {
    const select = openContainer._selectEl;

    // remove elevation
    setCardElevated(select, false);

    // clear search on close (if present)
    if (select?._custom?.searchInput && select._custom.clearSearchOnClose) {
      select._custom.searchInput.value = "";
      select._custom.query = "";
      refreshSelect(select);
    }

    openContainer.classList.remove("open");
    openContainer = null;
  }
}

document.addEventListener("click", (e) => closeOpenIfNeeded(e.target));
window.addEventListener("scroll", () => closeOpenIfNeeded(null), { passive: true });

export function enhanceSelect(selectEl, opts = {}) {
  if (!selectEl || selectEl.tagName !== "SELECT") return;

  // Already enhanced → just refresh
  if (selectEl.dataset.customEnhanced === "1") {
    refreshSelect(selectEl);
    return;
  }

  const placeholder =
    opts.placeholder ||
    selectEl.getAttribute("data-placeholder") ||
    "Select an option...";

  const searchThreshold = Number.isFinite(opts.searchThreshold) ? opts.searchThreshold : 20;
  const forceSearch = !!opts.search;
  const clearSearchOnClose = opts.clearSearchOnClose !== false; // default true

  // Wrap container
  const container = document.createElement("div");
  container.className = "custom-select-container";

  // Trigger
  const trigger = document.createElement("div");
  trigger.className = "select-trigger";
  trigger.setAttribute("role", "button");
  trigger.setAttribute("tabindex", "0");

  const triggerText = document.createElement("span");
  triggerText.className = "trigger-text placeholder";
  triggerText.textContent = placeholder;

  const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  arrow.setAttribute("class", "arrow");
  arrow.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  arrow.setAttribute("fill", "none");
  arrow.setAttribute("viewBox", "0 0 24 24");
  arrow.setAttribute("stroke", "currentColor");
  arrow.setAttribute("stroke-width", "2");
  arrow.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />`;

  trigger.appendChild(triggerText);
  trigger.appendChild(arrow);

  // Menu
  const menu = document.createElement("div");
  menu.className = "options-menu";

  // Search wrap (optional)
  const searchWrap = document.createElement("div");
  searchWrap.className = "select-search-wrap";

  const searchInput = document.createElement("input");
  searchInput.className = "select-search";
  searchInput.type = "text";
  searchInput.placeholder = "Search...";
  searchInput.autocomplete = "off";
  searchWrap.appendChild(searchInput);

  // Scroll
  const scroll = document.createElement("div");
  scroll.className = "options-scroll";

  menu.appendChild(searchWrap);
  menu.appendChild(scroll);

  // Insert container before select, then move select inside
  selectEl.parentNode.insertBefore(container, selectEl);
  container.appendChild(trigger);
  container.appendChild(menu);
  container.appendChild(selectEl);

  // Hide native select but keep functional
  selectEl.classList.add("native-select-hidden");
  selectEl.dataset.customEnhanced = "1";

  // Store refs
  selectEl._custom = {
    container,
    trigger,
    triggerText,
    scroll,
    placeholder,
    searchInput,
    searchWrap,
    query: "",
    clearSearchOnClose,
    searchThreshold,
    forceSearch,
  };

  // Link back for closing logic
  container._selectEl = selectEl;

  function toggleOpen() {
    const willOpen = !container.classList.contains("open");

    // Close any other open dropdown
    if (openContainer && openContainer !== container) {
      const prevSelect = openContainer._selectEl;
      setCardElevated(prevSelect, false);
      openContainer.classList.remove("open");
      openContainer = null;
    }

    container.classList.toggle("open", willOpen);
    openContainer = willOpen ? container : null;

    // Elevate card above other cards (fix overlap)
    setCardElevated(selectEl, willOpen);

    if (willOpen) {
      refreshSelect(selectEl);

      // Focus search if visible
      const meta = selectEl._custom;
      if (meta.searchWrap.style.display !== "none") {
        setTimeout(() => meta.searchInput.focus(), 0);
      }
    }
  }

  trigger.addEventListener("click", toggleOpen);
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleOpen();
    }
    if (e.key === "Escape") {
      closeOpenIfNeeded(null);
    }
  });

  // Search typing
  let t = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      selectEl._custom.query = searchInput.value.trim().toLowerCase();
      refreshSelect(selectEl);
    }, 60);
  });

  // Initial build
  refreshSelect(selectEl);
}

export function refreshSelect(selectEl) {
  const meta = selectEl?._custom;
  if (!meta) return;

  const {
    container,
    triggerText,
    scroll,
    placeholder,
    searchInput,
    searchWrap,
    query,
    searchThreshold,
    forceSearch,
  } = meta;

  const opts = Array.from(selectEl.options || []);
  const currentValue = selectEl.value;

  // Decide if search should show
  const optionCount = opts.filter((o) => o.value !== "").length;
  const showSearch = forceSearch || optionCount >= searchThreshold;
  searchWrap.style.display = showSearch ? "" : "none";

  scroll.innerHTML = "";

  const filtered = opts.filter((o) => {
    if (o.value === "") return false;
    if (!query) return true;
    return (o.textContent || "").toLowerCase().includes(query);
  });

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "option";
    empty.textContent = "No matches";
    empty.style.opacity = "0.65";
    empty.style.cursor = "default";
    scroll.appendChild(empty);
  } else {
    filtered.forEach((o) => {
      const div = document.createElement("div");
      div.className = "option";
      div.textContent = o.textContent;

      if (o.value === currentValue && o.value !== "") div.classList.add("selected");

      div.addEventListener("click", () => {
        selectEl.value = o.value;
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));

        if (meta.clearSearchOnClose) {
          searchInput.value = "";
          meta.query = "";
        }

        refreshSelect(selectEl);

        // Close + remove elevation
        setCardElevated(selectEl, false);
        container.classList.remove("open");
        openContainer = null;
      });

      scroll.appendChild(div);
    });
  }

  const selectedOpt = opts.find((o) => o.value === currentValue && o.value !== "");
  if (selectedOpt) {
    triggerText.textContent = selectedOpt.textContent;
    triggerText.classList.remove("placeholder");
  } else {
    triggerText.textContent = placeholder;
    triggerText.classList.add("placeholder");
  }
}


// ✅ ComboSelect: Select behaves like input + dropdown suggestions (free typing allowed)
// customSelect.js (REPLACE enhanceComboSelect + refreshComboSelect)

export function enhanceComboSelect(selectEl, opts = {}) {
  if (!selectEl || selectEl._combo) return;

  const cfg = {
    placeholder: opts.placeholder ?? selectEl.getAttribute("data-placeholder") ?? "",
    allowCustom: opts.allowCustom ?? true,
    showAllOnFocus: opts.showAllOnFocus ?? true,
    maxItems: opts.maxItems ?? 200,
  };

  const escapeHtml = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  // ---- wrap ----
  const wrap = document.createElement("div");
  wrap.className = "cs-combo";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "cs-combo-input";
  input.placeholder = cfg.placeholder;
  input.autocomplete = "off";
  input.spellcheck = false;

  // IMPORTANT: input should show ONLY value (ticket number)
  input.value = selectEl.value || "";
  input.disabled = !!selectEl.disabled;

  const menu = document.createElement("div");
  menu.className = "cs-combo-menu";
  menu.style.position = "absolute";
menu.style.zIndex = "9999";

  menu.style.display = "none";

  // move select inside wrap + hide select (keep it for value + form submit)
  const parent = selectEl.parentNode;
  parent.insertBefore(wrap, selectEl);
  wrap.appendChild(selectEl);
  wrap.appendChild(input);
  wrap.appendChild(menu);

  selectEl.style.position = "absolute";
  selectEl.style.opacity = "0";
  selectEl.style.pointerEvents = "none";
  selectEl.style.width = "1px";
  selectEl.style.height = "1px";

  // store input ref (useful for external sync)
  selectEl._comboInput = input;

  const getOptions = () =>
    Array.from(selectEl.options || [])
      .filter((o) => !o.disabled)
      .filter((o) => (o.value ?? "") !== "")
      .filter((o) => !String(o.value).startsWith("__"));

  function openMenu() {
    menu.style.display = "block";
  }
  function closeMenu() {
    menu.style.display = "none";
  }

  function commitValue(val) {
    val = String(val ?? "").trim();

    // clear
    if (!val) {
      // remove temp option if any
      const tmp = selectEl.querySelector('option[data-combo-temp="1"]');
      if (tmp) tmp.remove();
      selectEl.value = "";
      input.value = "";
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    // if value exists in options, use it
    const exists = Array.from(selectEl.options).some((o) => String(o.value) === val);

    if (exists) {
      const tmp = selectEl.querySelector('option[data-combo-temp="1"]');
      if (tmp) tmp.remove();
      selectEl.value = val;
      input.value = val; // ✅ show only ticket number
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    // else custom typing
    if (cfg.allowCustom) {
      let tmp = selectEl.querySelector('option[data-combo-temp="1"]');
      if (!tmp) {
        tmp = document.createElement("option");
        tmp.setAttribute("data-combo-temp", "1");
        selectEl.appendChild(tmp);
      }
      tmp.value = val;
      tmp.textContent = val;
      selectEl.value = val;
      input.value = val;
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    // not allowed
    selectEl.value = "";
    input.value = "";
    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function renderList(term) {
    const t = String(term ?? "").trim().toLowerCase();
    const options = getOptions();

    let items = options;
    if (t) {
      items = options.filter((o) => {
        const v = String(o.value ?? "").toLowerCase();
        const txt = String(o.textContent ?? "").toLowerCase();
        return v.includes(t) || txt.includes(t);
      });
    }

    menu.innerHTML = "";

    if (!items.length) {
      menu.innerHTML = `<div class="cs-combo-empty">No matches</div>`;
      return;
    }

    let shown = 0;
    for (const o of items) {
      const label = o.textContent || o.value; // ✅ dropdown shows ticket + details
      const div = document.createElement("div");
      div.className = "cs-combo-item";
      div.setAttribute("data-value", o.value);
      div.innerHTML = escapeHtml(label);

      // mousedown so blur doesn't close before click registers
      div.addEventListener("mousedown", (e) => {
        e.preventDefault();
        commitValue(o.value); // ✅ commit ONLY ticket number
        closeMenu();
      });

      menu.appendChild(div);
      shown++;
      if (shown >= cfg.maxItems) break;
    }
  }

  // events
  input.addEventListener("focus", () => {
    renderList(cfg.showAllOnFocus ? "" : input.value);
    openMenu();
  });

  input.addEventListener("input", () => {
    renderList(input.value);
    openMenu();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMenu();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commitValue(input.value);
      closeMenu();
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (!wrap.contains(document.activeElement)) {
        commitValue(input.value);
        closeMenu();
      }
    }, 120);
  });

  // click outside closes
  document.addEventListener("mousedown", (e) => {
    if (!wrap.contains(e.target)) closeMenu();
  });

  selectEl._combo = { wrap, input, menu, cfg, renderList, openMenu, closeMenu, commitValue };
}

export function refreshComboSelect(selectEl) {
  const c = selectEl?._combo;
  if (!c) return;

  c.input.placeholder = c.cfg.placeholder || "";
  c.input.disabled = !!selectEl.disabled;

  // always show value in input (ticket number only)
  c.input.value = selectEl.value || "";
}
