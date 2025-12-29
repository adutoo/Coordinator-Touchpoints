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
