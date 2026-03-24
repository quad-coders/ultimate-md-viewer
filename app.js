const STORAGE_KEY = "ultimate-md-viewer.state.v1";
const DB_NAME = "ultimate-md-viewer.handles.v1";
const DB_STORE = "handles";
const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdown", ".mkd", ".mkdn"];
const DEFAULT_SIDEBAR_WIDTH = 320;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 640;
const SIDEBAR_MIN_CONTENT_WIDTH = 360;
const MERMAID_SCALE_MIN = 0.4;
const MERMAID_SCALE_MAX = 3;
const MERMAID_WHEEL_SCALE_STEP = 0.015;
const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const PRIMARY_SHORTCUT_KEY = detectPrimaryShortcutKey();

let dbPromise = null;
let mermaidInitialized = false;
let dragDepth = 0;
let activeMermaidPan = null;
let activeSidebarResize = null;
let activeMermaidDiagramKey = null;
let lastRenderedSelectionKey = null;
let lastRenderedMarkdown = null;

const elements = {
  appShell: document.getElementById("app-shell"),
  navList: document.getElementById("nav-list"),
  navEmpty: document.getElementById("nav-empty"),
  content: document.getElementById("content"),
  mainContent: document.getElementById("main-content"),
  pickerMenu: document.getElementById("picker-menu"),
  pickerSummary: document.querySelector("#picker-menu > summary"),
  openFileButton: document.getElementById("open-file-button"),
  openFolderButton: document.getElementById("open-folder-button"),
  fileInput: document.getElementById("file-input"),
  folderInput: document.getElementById("folder-input"),
  sortMode: document.getElementById("sort-mode"),
  collapseToggle: document.getElementById("collapse-toggle"),
  sidebarRestore: document.getElementById("sidebar-restore"),
  sidebarResizer: document.getElementById("sidebar-resizer"),
  dropZone: document.getElementById("drop-zone"),
};

const state = loadState();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

function init() {
  configureLibraries();
  configureTooltips();
  bindEvents();
  applyShellState();
  elements.sortMode.value = state.sortMode;
  renderSidebar();
  renderWelcomeState();
  void bootstrap();
}

async function bootstrap() {
  await refreshStoredItems({ requestPermission: false });
  renderSidebar();
  await restoreSelectionIfPossible();
}

function configureLibraries() {
  if (window.marked?.setOptions) {
    window.marked.setOptions({
      gfm: true,
      breaks: false,
    });
  }

  if (window.mermaid && !mermaidInitialized) {
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: "neutral",
    });
    mermaidInitialized = true;
  }
}

function bindEvents() {
  elements.openFileButton.addEventListener("click", () => {
    closePickerMenu();
    void openFiles();
  });

  elements.openFolderButton.addEventListener("click", () => {
    closePickerMenu();
    void openFolder();
  });

  elements.fileInput.addEventListener("change", () => {
    void handleFileInput();
  });

  elements.folderInput.addEventListener("change", () => {
    void handleFolderInput();
  });

  elements.sortMode.addEventListener("change", (event) => {
    state.sortMode = event.target.value === "name" ? "name" : "added";
    persistState();
    renderSidebar();
  });

  elements.collapseToggle.addEventListener("click", () => {
    setSidebarCollapsed(true);
  });

  elements.sidebarRestore.addEventListener("click", () => {
    setSidebarCollapsed(false);
  });

  elements.sidebarResizer.addEventListener("pointerdown", handleSidebarResizeStart);

  elements.content.addEventListener("click", handleMermaidToolbarClick);
  elements.content.addEventListener("wheel", handleMermaidWheelZoom, {
    passive: false,
  });
  elements.content.addEventListener("pointerdown", handleMermaidPanStart);
  elements.content.addEventListener("focusin", handleMermaidCardFocus);

  bindDropZone();

  window.addEventListener("focus", () => {
    void refreshOnFocus();
  });
  window.addEventListener("resize", handleWindowResize);
  window.addEventListener("pointermove", handleSidebarResizeMove);
  window.addEventListener("pointerup", handleSidebarResizeEnd);
  window.addEventListener("pointercancel", handleSidebarResizeEnd);
  window.addEventListener("pointermove", handleMermaidPanMove);
  window.addEventListener("pointerup", handleMermaidPanEnd);
  window.addEventListener("pointercancel", handleMermaidPanEnd);
  window.addEventListener("blur", handleWindowBlur);

  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleDocumentKeydown);
}

function bindDropZone() {
  elements.dropZone.addEventListener("dragenter", (event) => {
    if (!hasFilePayload(event)) {
      return;
    }

    event.preventDefault();
    dragDepth += 1;
    elements.dropZone.classList.add("is-drag-over");
  });

  elements.dropZone.addEventListener("dragover", (event) => {
    if (!hasFilePayload(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    elements.dropZone.classList.add("is-drag-over");
  });

  elements.dropZone.addEventListener("dragleave", (event) => {
    if (!hasFilePayload(event)) {
      return;
    }

    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      elements.dropZone.classList.remove("is-drag-over");
    }
  });

  elements.dropZone.addEventListener("drop", (event) => {
    if (!hasFilePayload(event)) {
      return;
    }

    event.preventDefault();
    dragDepth = 0;
    elements.dropZone.classList.remove("is-drag-over");
    void handleDrop(event);
  });
}

function detectPrimaryShortcutKey() {
  const platform = [
    window.navigator?.userAgentData?.platform,
    window.navigator?.platform,
    window.navigator?.userAgent,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /mac|iphone|ipad|ipod/.test(platform) ? "Cmd" : "Ctrl";
}

function formatShortcutLabel(parts) {
  if (!parts) {
    return "";
  }

  const normalizedParts = Array.isArray(parts) ? parts : [parts];
  return normalizedParts
    .map((part) => (part === "Mod" ? PRIMARY_SHORTCUT_KEY : part))
    .join(" + ");
}

function buildTooltipLabel(label, shortcut) {
  return shortcut ? `${label} (${shortcut})` : label;
}

function applyTooltip(element, label, shortcutParts = null) {
  if (!element) {
    return;
  }

  const shortcut =
    typeof shortcutParts === "string"
      ? shortcutParts
      : formatShortcutLabel(shortcutParts);

  element.title = buildTooltipLabel(label, shortcut);
}

function configureTooltips() {
  applyTooltip(
    elements.pickerSummary,
    "Open files or folders",
    `${formatShortcutLabel(["Mod", "O"])} / ${formatShortcutLabel(["Mod", "Shift", "O"])}`,
  );
  applyTooltip(elements.openFileButton, "Open files", ["Mod", "O"]);
  applyTooltip(elements.openFolderButton, "Open folder", ["Mod", "Shift", "O"]);
  applyTooltip(elements.sortMode, "Sort navigation items");
  applyTooltip(elements.collapseToggle, "Collapse sidebar", ["Mod", "\\"]);
  applyTooltip(elements.sidebarRestore, "Expand sidebar", ["Mod", "\\"]);
  applyTooltip(elements.sidebarResizer, "Resize sidebar");
}

function hasFilePayload(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function handleDocumentClick(event) {
  const target = event.target;
  if (!(target instanceof Node)) {
    return;
  }

  if (
    elements.pickerMenu?.open &&
    !elements.pickerMenu.contains(target)
  ) {
    closePickerMenu();
  }
}

function handleDocumentKeydown(event) {
  if (event.key === "Escape") {
    closePickerMenu();
    clearMermaidPanState();
    clearSidebarResizeState();
    return;
  }

  const hasPrimaryModifier = event.metaKey || event.ctrlKey;
  const lowerKey = event.key.toLowerCase();

  if (hasPrimaryModifier && !event.altKey && lowerKey === "o") {
    event.preventDefault();
    closePickerMenu();
    if (event.shiftKey) {
      void openFolder();
    } else {
      void openFiles();
    }
    return;
  }

  if (hasPrimaryModifier && !event.shiftKey && !event.altKey && event.key === "\\") {
    event.preventDefault();
    toggleSidebarCollapsed();
    return;
  }

  if (isTypingTarget(event.target)) {
    return;
  }

  const activeCard = getActiveMermaidCard();
  if (!activeCard) {
    return;
  }

  const allowPlainZoom = !event.metaKey && !event.ctrlKey && !event.altKey;
  const allowModifiedZoom = hasPrimaryModifier && !event.altKey;
  if (
    (allowPlainZoom || allowModifiedZoom) &&
    (event.key === "=" || event.key === "+")
  ) {
    event.preventDefault();
    setMermaidScale(activeCard, getMermaidScale(activeCard) + 0.1);
    return;
  }

  if (
    (allowPlainZoom || allowModifiedZoom) &&
    (event.key === "-" || event.key === "_")
  ) {
    event.preventDefault();
    setMermaidScale(activeCard, getMermaidScale(activeCard) - 0.1);
    return;
  }

  if ((allowPlainZoom || allowModifiedZoom) && event.key === "0") {
    event.preventDefault();
    setMermaidScale(activeCard, 1);
  }
}

function handleWindowResize() {
  const changed = setSidebarWidth(state.sidebarWidth, { persist: false });
  if (changed) {
    persistState();
    return;
  }

  applyShellState();
}

function handleWindowBlur() {
  clearMermaidPanState();
  clearSidebarResizeState();
}

function handleSidebarResizeStart(event) {
  if (state.sidebarCollapsed || event.button !== 0) {
    return;
  }

  event.preventDefault();
  activeSidebarResize = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: state.sidebarWidth,
  };
  elements.appShell.classList.add("is-resizing");

  if (typeof elements.sidebarResizer.setPointerCapture === "function") {
    try {
      elements.sidebarResizer.setPointerCapture(event.pointerId);
    } catch (error) {
      console.debug("Pointer capture unavailable for sidebar resize.", error);
    }
  }
}

function handleSidebarResizeMove(event) {
  if (
    !activeSidebarResize ||
    event.pointerId !== activeSidebarResize.pointerId
  ) {
    return;
  }

  event.preventDefault();
  const nextWidth = activeSidebarResize.startWidth + (
    event.clientX - activeSidebarResize.startX
  );
  setSidebarWidth(nextWidth, { persist: false });
}

function handleSidebarResizeEnd(event) {
  if (
    !activeSidebarResize ||
    event.pointerId !== activeSidebarResize.pointerId
  ) {
    return;
  }

  clearSidebarResizeState();
}

function clearSidebarResizeState() {
  if (!activeSidebarResize) {
    return;
  }

  if (
    typeof elements.sidebarResizer.releasePointerCapture === "function" &&
    elements.sidebarResizer.hasPointerCapture?.(activeSidebarResize.pointerId)
  ) {
    try {
      elements.sidebarResizer.releasePointerCapture(
        activeSidebarResize.pointerId,
      );
    } catch (error) {
      console.debug("Pointer release unavailable for sidebar resize.", error);
    }
  }

  elements.appShell.classList.remove("is-resizing");
  activeSidebarResize = null;
  persistState();
}

function isTypingTarget(target) {
  return Boolean(
    target instanceof HTMLElement &&
      (
        target.isContentEditable ||
        target.closest(
          "input, textarea, select, [contenteditable='true'], [contenteditable='']",
        )
      ),
  );
}

function closePickerMenu() {
  if (elements.pickerMenu) {
    elements.pickerMenu.open = false;
  }
}

function normalizeMermaidZooms(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const normalized = {};
  for (const [key, zoom] of Object.entries(value)) {
    if (typeof key !== "string" || !key) {
      continue;
    }

    if (!Number.isFinite(zoom)) {
      continue;
    }

    normalized[key] = clampMermaidScale(zoom);
  }

  return normalized;
}

function clampSidebarWidth(value) {
  const numericValue = Number(value);
  const viewportWidth = Math.max(window.innerWidth || 0, MIN_SIDEBAR_WIDTH);
  const maxWidth = Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(MAX_SIDEBAR_WIDTH, viewportWidth - SIDEBAR_MIN_CONTENT_WIDTH),
  );

  if (!Number.isFinite(numericValue)) {
    return Math.min(DEFAULT_SIDEBAR_WIDTH, maxWidth);
  }

  return Math.min(maxWidth, Math.max(MIN_SIDEBAR_WIDTH, Math.round(numericValue)));
}

function clampMermaidScale(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 1;
  }

  return Math.min(
    MERMAID_SCALE_MAX,
    Math.max(MERMAID_SCALE_MIN, roundScale(numericValue)),
  );
}

function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const items = Array.isArray(parsed.items)
      ? parsed.items.map(normalizeItem)
      : [];
    const highestOrder = items.reduce(
      (maxOrder, item) => Math.max(maxOrder, item.order || 0),
      0,
    );

    return {
      items,
      sortMode: parsed.sortMode === "name" ? "name" : "added",
      selectedKey:
        typeof parsed.selectedKey === "string" ? parsed.selectedKey : null,
      sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
      sidebarWidth: clampSidebarWidth(parsed.sidebarWidth),
      mermaidZooms: normalizeMermaidZooms(parsed.mermaidZooms),
      nextOrder:
        Number.isFinite(parsed.nextOrder) && parsed.nextOrder > highestOrder
          ? parsed.nextOrder
          : highestOrder + 1,
    };
  } catch (error) {
    console.warn("Could not restore saved state.", error);
    return {
      items: [],
      sortMode: "added",
      selectedKey: null,
      sidebarCollapsed: false,
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      mermaidZooms: {},
      nextOrder: 1,
    };
  }
}

function normalizeItem(item) {
  const normalized = {
    id:
      typeof item.id === "string" && item.id
        ? item.id
        : createId(),
    type: item.type === "folder" ? "folder" : "file",
    name:
      typeof item.name === "string" && item.name.trim()
        ? item.name
        : "Untitled",
    order: Number.isFinite(item.order) ? item.order : 0,
    source: item.source === "snapshot" ? "snapshot" : "handle",
    available: item.available !== false,
    expanded: item.expanded !== false,
    permissionPending: false,
  };

  if (normalized.type === "folder") {
    normalized.children = Array.isArray(item.children)
      ? item.children.map(normalizeChild)
      : [];
    normalized.collapsedPaths = Array.isArray(item.collapsedPaths)
      ? item.collapsedPaths.filter(
          (value, index, values) =>
            typeof value === "string" && value && values.indexOf(value) === index,
        )
      : [];
  } else if (normalized.source === "snapshot") {
    normalized.content =
      typeof item.content === "string" ? item.content : "";
  }

  return normalized;
}

function normalizeChild(child) {
  const relativePath =
    typeof child.relativePath === "string" && child.relativePath.trim()
      ? child.relativePath
      : typeof child.name === "string" && child.name.trim()
        ? child.name
        : "Untitled.md";

  return {
    relativePath,
    name:
      typeof child.name === "string" && child.name.trim()
        ? child.name
        : basename(relativePath),
    available: child.available !== false,
    content: typeof child.content === "string" ? child.content : undefined,
  };
}

function persistState() {
  const serializableState = {
    items: state.items.map(serializeItem),
    sortMode: state.sortMode,
    selectedKey: state.selectedKey,
    sidebarCollapsed: state.sidebarCollapsed,
    sidebarWidth: state.sidebarWidth,
    mermaidZooms: state.mermaidZooms,
    nextOrder: state.nextOrder,
  };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serializableState));
  } catch (error) {
    console.warn("Could not persist state.", error);
  }
}

function serializeItem(item) {
  const serializable = {
    id: item.id,
    type: item.type,
    name: item.name,
    order: item.order,
    source: item.source,
    available: item.available,
    expanded: item.expanded,
  };

  if (item.type === "folder") {
    serializable.children = item.children.map((child) => ({
      relativePath: child.relativePath,
      name: child.name,
      available: child.available,
      content: child.content,
    }));
    serializable.collapsedPaths = item.collapsedPaths || [];
  } else if (item.source === "snapshot") {
    serializable.content = item.content;
  }

  return serializable;
}

function applyShellState() {
  elements.appShell.style.setProperty(
    "--sidebar-width",
    `${clampSidebarWidth(state.sidebarWidth)}px`,
  );
  elements.appShell.classList.toggle(
    "is-collapsed",
    state.sidebarCollapsed,
  );
}

function setSidebarCollapsed(collapsed) {
  if (collapsed) {
    clearSidebarResizeState();
  }
  state.sidebarCollapsed = collapsed;
  applyShellState();
  persistState();
}

function toggleSidebarCollapsed() {
  setSidebarCollapsed(!state.sidebarCollapsed);
}

function setSidebarWidth(nextWidth, options = {}) {
  const clampedWidth = clampSidebarWidth(nextWidth);
  if (state.sidebarWidth === clampedWidth) {
    return false;
  }

  state.sidebarWidth = clampedWidth;
  applyShellState();

  if (options.persist !== false) {
    persistState();
  }

  return true;
}

function createId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nextOrder() {
  const current = state.nextOrder;
  state.nextOrder += 1;
  return current;
}

function makeSelectionKey(itemId, relativePath = null) {
  return JSON.stringify([itemId, relativePath]);
}

function parseSelectionKey(selectionKey) {
  try {
    const parsed = JSON.parse(selectionKey);
    if (Array.isArray(parsed) && typeof parsed[0] === "string") {
      return {
        itemId: parsed[0],
        relativePath:
          typeof parsed[1] === "string" && parsed[1]
            ? parsed[1]
            : null,
      };
    }
  } catch (error) {
    console.warn("Invalid selection key.", error);
  }

  return {
    itemId: null,
    relativePath: null,
  };
}

function renderSidebar() {
  const sortedItems = getSortedItems();
  elements.navList.textContent = "";

  for (const item of sortedItems) {
    elements.navList.appendChild(renderTopLevelItem(item));
  }

  elements.navEmpty.hidden = sortedItems.length > 0;
}

function getSortedItems() {
  const items = [...state.items];
  if (state.sortMode === "name") {
    items.sort((left, right) => {
      const byName = nameCollator.compare(left.name, right.name);
      return byName || left.order - right.order;
    });
    return items;
  }

  items.sort((left, right) => left.order - right.order);
  return items;
}

function renderTopLevelItem(item) {
  const listItem = document.createElement("li");
  listItem.className = "nav-item";

  if (item.type === "folder") {
    listItem.appendChild(renderFolderItem(item));
  } else {
    listItem.appendChild(renderFileItem(item));
  }

  return listItem;
}

function renderFileItem(item) {
  const row = document.createElement("div");
  row.className = "nav-row";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "item-button";
  button.title = item.name;

  if (state.selectedKey === makeSelectionKey(item.id)) {
    button.classList.add("is-selected");
  }

  button.addEventListener("click", () => {
    void openSelection(makeSelectionKey(item.id));
  });

  const label = document.createElement("span");
  label.className = "item-label";
  label.textContent = item.name;

  if (!item.available) {
    label.classList.add("is-unavailable");
  }

  button.appendChild(label);
  row.appendChild(button);

  const removeButton = createRemoveButton(() => {
    void removeTopLevelItem(item.id);
  });
  row.appendChild(removeButton);

  return row;
}

function renderFolderItem(item) {
  const container = document.createElement("div");

  const row = document.createElement("div");
  row.className = "nav-row";

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "folder-toggle";
  toggleButton.setAttribute(
    "aria-label",
    item.expanded ? "Collapse folder" : "Expand folder",
  );
  applyTooltip(
    toggleButton,
    item.expanded ? "Collapse folder" : "Expand folder",
  );
  toggleButton.appendChild(createChevronIcon(item.expanded));
  toggleButton.addEventListener("click", () => {
    item.expanded = !item.expanded;
    persistState();
    renderSidebar();
  });
  row.appendChild(toggleButton);

  const folderButton = document.createElement("button");
  folderButton.type = "button";
  folderButton.className = "folder-name-button";
  folderButton.title = item.name;
  folderButton.addEventListener("click", () => {
    item.expanded = !item.expanded;
    persistState();
    renderSidebar();
  });

  const folderLabel = document.createElement("span");
  folderLabel.className = "item-label";
  folderLabel.textContent = item.name;
  if (!item.available) {
    folderLabel.classList.add("is-unavailable");
  }

  folderButton.appendChild(folderLabel);
  row.appendChild(folderButton);

  const removeButton = createRemoveButton(() => {
    void removeTopLevelItem(item.id);
  });
  row.appendChild(removeButton);

  container.appendChild(row);

  if (item.expanded) {
    const children = document.createElement("div");
    children.className = "folder-children";

    if (item.children.length === 0) {
      const empty = document.createElement("div");
      empty.className = "folder-empty";
      empty.textContent = "No Markdown files";
      children.appendChild(empty);
    } else {
      children.appendChild(renderFolderTree(item));
    }

    container.appendChild(children);
  }

  return container;
}

function renderFolderTree(item) {
  const root = buildFolderTree(item.children);
  const list = document.createElement("ul");
  list.className = "tree-list";

  for (const folderNode of getSortedFolderNodes(root)) {
    list.appendChild(renderNestedFolderNode(item, folderNode));
  }

  for (const child of getSortedFiles(root)) {
    list.appendChild(renderFolderFileNode(item, child));
  }

  return list;
}

function buildFolderTree(children) {
  const root = {
    path: "",
    name: "",
    folders: new Map(),
    files: [],
  };

  for (const child of children) {
    const parts = child.relativePath.split("/").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }

    let node = root;
    let currentPath = "";

    for (const folderName of parts.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;
      if (!node.folders.has(folderName)) {
        node.folders.set(folderName, {
          path: currentPath,
          name: folderName,
          folders: new Map(),
          files: [],
        });
      }
      node = node.folders.get(folderName);
    }

    node.files.push(child);
  }

  return root;
}

function renderNestedFolderNode(item, node) {
  const listItem = document.createElement("li");
  listItem.className = "tree-node";

  const row = document.createElement("div");
  row.className = "tree-row";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "folder-toggle tree-toggle";
  toggle.setAttribute(
    "aria-label",
    isNestedFolderExpanded(item, node.path)
      ? "Collapse folder"
      : "Expand folder",
  );
  applyTooltip(
    toggle,
    isNestedFolderExpanded(item, node.path)
      ? "Collapse folder"
      : "Expand folder",
  );
  toggle.appendChild(createChevronIcon(isNestedFolderExpanded(item, node.path)));
  toggle.addEventListener("click", () => {
    toggleNestedFolder(item, node.path);
  });
  row.appendChild(toggle);

  const folderButton = document.createElement("button");
  folderButton.type = "button";
  folderButton.className = "tree-folder-button";
  folderButton.title = node.path;
  folderButton.addEventListener("click", () => {
    toggleNestedFolder(item, node.path);
  });

  const label = document.createElement("span");
  label.className = "item-label";
  label.textContent = node.name;
  if (!treeNodeHasAvailableContent(node)) {
    label.classList.add("is-unavailable");
  }

  folderButton.appendChild(label);
  row.appendChild(folderButton);
  listItem.appendChild(row);

  if (isNestedFolderExpanded(item, node.path)) {
    const childList = document.createElement("ul");
    childList.className = "tree-list tree-children";

    for (const folderNode of getSortedFolderNodes(node)) {
      childList.appendChild(renderNestedFolderNode(item, folderNode));
    }

    for (const child of getSortedFiles(node)) {
      childList.appendChild(renderFolderFileNode(item, child));
    }

    listItem.appendChild(childList);
  }

  return listItem;
}

function renderFolderFileNode(item, child) {
  const listItem = document.createElement("li");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "tree-file-button";
  button.title = child.relativePath;

  if (state.selectedKey === makeSelectionKey(item.id, child.relativePath)) {
    button.classList.add("is-selected");
  }

  button.addEventListener("click", () => {
    void openSelection(makeSelectionKey(item.id, child.relativePath));
  });

  const label = document.createElement("span");
  label.className = "item-label";
  label.textContent = child.name || basename(child.relativePath);
  if (!child.available) {
    label.classList.add("is-unavailable");
  }

  button.appendChild(label);
  listItem.appendChild(button);
  return listItem;
}

function getSortedFolderNodes(node) {
  return [...node.folders.values()].sort((left, right) =>
    nameCollator.compare(left.name, right.name),
  );
}

function getSortedFiles(node) {
  return [...node.files].sort((left, right) =>
    nameCollator.compare(left.name || left.relativePath, right.name || right.relativePath),
  );
}

function isNestedFolderExpanded(item, path) {
  return !(item.collapsedPaths || []).includes(path);
}

function toggleNestedFolder(item, path) {
  const collapsedPaths = new Set(item.collapsedPaths || []);
  if (collapsedPaths.has(path)) {
    collapsedPaths.delete(path);
  } else {
    collapsedPaths.add(path);
  }

  item.collapsedPaths = [...collapsedPaths];
  persistState();
  renderSidebar();
}

function treeNodeHasAvailableContent(node) {
  for (const child of node.files) {
    if (child.available) {
      return true;
    }
  }

  for (const folderNode of node.folders.values()) {
    if (treeNodeHasAvailableContent(folderNode)) {
      return true;
    }
  }

  return false;
}

function createChevronIcon(expanded) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "toggle-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    expanded ? "m8 10 4 4 4-4" : "m10 8 4 4-4 4",
  );
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("stroke-width", "2");
  svg.appendChild(path);

  return svg;
}

function createRemoveButton(onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "remove-button";
  button.textContent = "x";
  button.setAttribute("aria-label", "Remove item");
  applyTooltip(button, "Remove item");
  button.addEventListener("click", onClick);
  return button;
}

async function openFiles() {
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: "Markdown Files",
            accept: {
              "text/markdown": MARKDOWN_EXTENSIONS,
            },
          },
        ],
      });

      for (const handle of handles) {
        await addHandleItem(handle, { requestPermission: true });
      }
    } catch (error) {
      if (!isAbortError(error)) {
        console.error("Could not open files.", error);
      }
    }
    return;
  }

  elements.fileInput.click();
}

async function openFolder() {
  if (window.showDirectoryPicker) {
    try {
      const handle = await window.showDirectoryPicker();
      await addHandleItem(handle, { requestPermission: true });
    } catch (error) {
      if (!isAbortError(error)) {
        console.error("Could not open folder.", error);
      }
    }
    return;
  }

  elements.folderInput.click();
}

async function handleFileInput() {
  const files = Array.from(elements.fileInput.files || []).filter((file) =>
    isMarkdownName(file.name),
  );
  elements.fileInput.value = "";

  for (const file of files) {
    await addSnapshotFile(file);
  }
}

async function handleFolderInput() {
  const files = Array.from(elements.folderInput.files || []).filter((file) =>
    isMarkdownName(file.name),
  );
  elements.folderInput.value = "";
  await addSnapshotFolders(files);
}

async function handleDrop(event) {
  const handles = await getDroppedHandles(event.dataTransfer?.items || []);
  if (handles.length > 0) {
    for (const handle of handles) {
      await addHandleItem(handle, { requestPermission: true });
    }
    return;
  }

  const files = Array.from(event.dataTransfer?.files || []).filter((file) =>
    isMarkdownName(file.name),
  );

  if (files.some((file) => file.webkitRelativePath)) {
    await addSnapshotFolders(files);
    return;
  }

  for (const file of files) {
    await addSnapshotFile(file);
  }
}

async function getDroppedHandles(dataTransferItems) {
  const items = Array.from(dataTransferItems);
  if (items.length === 0) {
    return [];
  }

  if (typeof items[0].getAsFileSystemHandle !== "function") {
    return [];
  }

  const handles = await Promise.all(
    items.map((item) =>
      item
        .getAsFileSystemHandle()
        .catch(() => null),
    ),
  );

  return handles.filter(Boolean);
}

async function addHandleItem(handle, options = {}) {
  if (!handle) {
    return;
  }

  const item =
    handle.kind === "directory"
      ? {
          id: createId(),
          type: "folder",
          name: handle.name,
          order: nextOrder(),
          source: "handle",
          available: true,
          expanded: true,
          permissionPending: false,
          collapsedPaths: [],
          children: [],
        }
      : {
          id: createId(),
          type: "file",
          name: handle.name,
          order: nextOrder(),
          source: "handle",
          available: true,
          expanded: true,
          permissionPending: false,
        };

  state.items.push(item);
  await saveHandle(item.id, handle);
  await refreshItemFromSource(item, options);
  persistState();
  renderSidebar();

  if (item.type === "file") {
    await openSelection(makeSelectionKey(item.id), {
      requestPermission: Boolean(options.requestPermission),
    });
  } else if (item.children[0]) {
    await openSelection(makeSelectionKey(item.id, item.children[0].relativePath), {
      requestPermission: Boolean(options.requestPermission),
    });
  } else if (!state.selectedKey) {
    renderWelcomeState(`${item.name} does not contain any Markdown files.`);
  }
}

async function addSnapshotFile(file) {
  const item = {
    id: createId(),
    type: "file",
    name: file.name,
    order: nextOrder(),
    source: "snapshot",
    available: true,
    expanded: true,
    permissionPending: false,
    content: await file.text(),
  };

  state.items.push(item);
  persistState();
  renderSidebar();
  await openSelection(makeSelectionKey(item.id));
}

async function addSnapshotFolders(files) {
  const groups = groupFilesByTopFolder(files);
  for (const [folderName, group] of groups) {
    const children = await Promise.all(
      group
        .sort((left, right) =>
          nameCollator.compare(left.relativePath, right.relativePath),
        )
        .map(async (entry) => ({
          relativePath: entry.relativePath,
          name: basename(entry.relativePath),
          available: true,
          content: await entry.file.text(),
        })),
    );

    const item = {
      id: createId(),
      type: "folder",
      name: folderName,
      order: nextOrder(),
      source: "snapshot",
      available: true,
      expanded: true,
      permissionPending: false,
      collapsedPaths: [],
      children,
    };

    state.items.push(item);
    persistState();
    renderSidebar();

    if (children[0]) {
      await openSelection(makeSelectionKey(item.id, children[0].relativePath));
    }
  }
}

function groupFilesByTopFolder(files) {
  const groups = new Map();

  for (const file of files) {
    const rawPath = file.webkitRelativePath || file.name;
    const parts = rawPath.split("/").filter(Boolean);
    if (parts.length <= 1) {
      const folderName = "Dropped Files";
      const relativePath = file.name;
      if (!groups.has(folderName)) {
        groups.set(folderName, []);
      }
      groups.get(folderName).push({ file, relativePath });
      continue;
    }

    const folderName = parts[0];
    const relativePath = parts.slice(1).join("/");
    if (!groups.has(folderName)) {
      groups.set(folderName, []);
    }
    groups.get(folderName).push({ file, relativePath });
  }

  return groups;
}

async function removeTopLevelItem(itemId) {
  const selection = state.selectedKey ? parseSelectionKey(state.selectedKey) : {};
  state.items = state.items.filter((item) => item.id !== itemId);
  await deleteHandle(itemId);

  if (selection.itemId === itemId) {
    state.selectedKey = null;
    renderWelcomeState();
  }

  persistState();
  renderSidebar();
}

async function refreshOnFocus() {
  await refreshStoredItems({ requestPermission: false });
  renderSidebar();

  const selectionKey = state.selectedKey;
  if (selectionKey) {
    const maybeContent = await readSelectionContent(selectionKey, {
      requestPermission: false,
    });

    if (selectionKey !== state.selectedKey) {
      return;
    }

    if (maybeContent) {
      if (
        lastRenderedSelectionKey === selectionKey &&
        lastRenderedMarkdown === maybeContent.markdown
      ) {
        return;
      }

      await renderMarkdown(maybeContent.markdown, { preserveScroll: true });
      return;
    }

    renderUnavailableState(selectionKey);
  }
}

async function refreshStoredItems(options = {}) {
  for (const item of state.items) {
    await refreshItemFromSource(item, options);
  }
  persistState();
}

async function refreshItemFromSource(item, options = {}) {
  if (item.source !== "handle") {
    return;
  }

  if (item.type === "folder") {
    await refreshHandleBackedFolder(item, options);
    return;
  }

  await refreshHandleBackedFile(item, options);
}

async function refreshHandleBackedFile(item, options = {}) {
  const handle = await loadHandle(item.id);
  if (!handle) {
    item.available = false;
    return;
  }

  const allowed = await ensurePermission(handle, Boolean(options.requestPermission));
  if (!allowed) {
    item.permissionPending = true;
    return;
  }

  try {
    await handle.getFile();
    item.name = handle.name || item.name;
    item.available = true;
    item.permissionPending = false;
  } catch (error) {
    if (isMissingHandleError(error)) {
      item.available = false;
      item.permissionPending = false;
      return;
    }

    throw error;
  }
}

async function refreshHandleBackedFolder(item, options = {}) {
  const handle = await loadHandle(item.id);
  if (!handle) {
    item.available = false;
    item.children = item.children.map((child) => ({
      ...child,
      available: false,
    }));
    return;
  }

  const allowed = await ensurePermission(handle, Boolean(options.requestPermission));
  if (!allowed) {
    item.permissionPending = true;
    return;
  }

  try {
    const liveChildren = await collectMarkdownEntries(handle);
    const liveByPath = new Map(
      liveChildren.map((child) => [child.relativePath, child]),
    );
    const seen = new Set();
    const mergedChildren = [];

    item.name = handle.name || item.name;

    for (const child of item.children) {
      const live = liveByPath.get(child.relativePath);
      if (live) {
        mergedChildren.push({
          ...child,
          name: live.name,
          available: true,
        });
        seen.add(child.relativePath);
      } else {
        mergedChildren.push({
          ...child,
          available: false,
        });
      }
    }

    for (const child of liveChildren) {
      if (seen.has(child.relativePath)) {
        continue;
      }

      mergedChildren.push({
        relativePath: child.relativePath,
        name: child.name,
        available: true,
      });
    }

    mergedChildren.sort((left, right) =>
      nameCollator.compare(left.relativePath, right.relativePath),
    );

    item.children = mergedChildren;
    item.available = true;
    item.permissionPending = false;
  } catch (error) {
    if (isMissingHandleError(error)) {
      item.available = false;
      item.permissionPending = false;
      item.children = item.children.map((child) => ({
        ...child,
        available: false,
      }));
      return;
    }

    throw error;
  }
}

async function openSelection(selectionKey, options = {}) {
  state.selectedKey = selectionKey;
  persistState();
  renderSidebar();

  let result = null;
  try {
    result = await readSelectionContent(selectionKey, {
      requestPermission:
        options.requestPermission === undefined
          ? true
          : Boolean(options.requestPermission),
    });
  } catch (error) {
    console.error("Could not open selected item.", error);
  }

  persistState();
  renderSidebar();

  if (!result) {
    renderUnavailableState(selectionKey);
    return;
  }

  await renderMarkdown(result.markdown);
}

async function restoreSelectionIfPossible() {
  if (!state.selectedKey) {
    return;
  }

  let result = null;
  try {
    result = await readSelectionContent(state.selectedKey, {
      requestPermission: false,
    });
  } catch (error) {
    console.error("Could not restore selected item.", error);
  }

  if (result) {
    await renderMarkdown(result.markdown);
    return;
  }

  renderWelcomeState(
    "Click a saved file or folder item to restore access after refresh.",
  );
}

async function readSelectionContent(selectionKey, options = {}) {
  const { itemId, relativePath } = parseSelectionKey(selectionKey);
  if (!itemId) {
    return null;
  }

  const item = state.items.find((entry) => entry.id === itemId);
  if (!item) {
    return null;
  }

  if (item.type === "file") {
    await refreshItemFromSource(item, options);
    if (!item.available) {
      return null;
    }

    const markdown = await readTopLevelFileContent(item, options);
    return typeof markdown === "string" ? { markdown } : null;
  }

  await refreshItemFromSource(item, options);
  const child = item.children.find((entry) => entry.relativePath === relativePath);
  if (!child || !child.available) {
    return null;
  }

  const markdown = await readFolderChildContent(item, child, options);
  return typeof markdown === "string" ? { markdown } : null;
}

async function readTopLevelFileContent(item, options = {}) {
  if (item.source === "snapshot") {
    return item.content || "";
  }

  const handle = await loadHandle(item.id);
  if (!handle) {
    item.available = false;
    return null;
  }

  const allowed = await ensurePermission(handle, Boolean(options.requestPermission));
  if (!allowed) {
    item.permissionPending = true;
    return null;
  }

  try {
    const file = await handle.getFile();
    item.available = true;
    item.permissionPending = false;
    item.name = handle.name || item.name;
    return await file.text();
  } catch (error) {
    if (isMissingHandleError(error)) {
      item.available = false;
      item.permissionPending = false;
      return null;
    }

    throw error;
  }
}

async function readFolderChildContent(item, child, options = {}) {
  if (item.source === "snapshot") {
    return child.content || "";
  }

  const folderHandle = await loadHandle(item.id);
  if (!folderHandle) {
    item.available = false;
    child.available = false;
    return null;
  }

  const allowed = await ensurePermission(
    folderHandle,
    Boolean(options.requestPermission),
  );
  if (!allowed) {
    item.permissionPending = true;
    return null;
  }

  try {
    const fileHandle = await getNestedFileHandle(
      folderHandle,
      child.relativePath,
    );
    const file = await fileHandle.getFile();
    child.available = true;
    item.available = true;
    item.permissionPending = false;
    return await file.text();
  } catch (error) {
    if (isMissingHandleError(error)) {
      child.available = false;
      return null;
    }

    throw error;
  }
}

async function renderMarkdown(markdown, options = {}) {
  const scrollTop = options.preserveScroll
    ? elements.mainContent.scrollTop
    : 0;

  clearMermaidPanState();
  clearActiveMermaidCard();
  const html = window.marked ? window.marked.parse(markdown) : escapeHtml(markdown);
  const safeHtml = window.DOMPurify
    ? window.DOMPurify.sanitize(html)
    : html;

  elements.content.innerHTML = safeHtml;
  await hydrateMermaidBlocks(elements.content);
  elements.mainContent.scrollTop = scrollTop;
  lastRenderedSelectionKey = state.selectedKey;
  lastRenderedMarkdown = markdown;
}

function renderWelcomeState(message) {
  clearMermaidPanState();
  clearActiveMermaidCard();
  elements.content.innerHTML = `
    <div class="empty-state">
      <h1>Markdown Viewer</h1>
      <p>${escapeHtml(message || "Open a Markdown file or folder from the left sidebar.")}</p>
    </div>
  `;
  elements.mainContent.scrollTop = 0;
  lastRenderedSelectionKey = null;
  lastRenderedMarkdown = null;
}

function renderUnavailableState(selectionKey) {
  const { itemId, relativePath } = parseSelectionKey(selectionKey);
  const item = state.items.find((entry) => entry.id === itemId);
  const targetName = relativePath || item?.name || "This item";

  clearMermaidPanState();
  clearActiveMermaidCard();
  elements.content.innerHTML = `
    <div class="empty-state">
      <h2>${escapeHtml(targetName)}</h2>
      <p>This file is no longer available or access was not granted.</p>
    </div>
  `;
  elements.mainContent.scrollTop = 0;
  lastRenderedSelectionKey = null;
  lastRenderedMarkdown = null;
}

async function hydrateMermaidBlocks(container) {
  const mermaidNodes = Array.from(
    container.querySelectorAll(
      "pre > code.language-mermaid, pre > code.lang-mermaid",
    ),
  );

  if (mermaidNodes.length === 0 || !window.mermaid) {
    return;
  }

  for (const [index, codeNode] of mermaidNodes.entries()) {
    const source = codeNode.textContent || "";
    const pre = codeNode.closest("pre");
    if (!pre) {
      continue;
    }

    const card = createMermaidCard(
      source,
      createMermaidDiagramKey(state.selectedKey, index, source),
    );
    pre.replaceWith(card);
    await renderMermaidCard(card);
  }
}

function createMermaidCard(source, diagramKey) {
  const card = document.createElement("div");
  card.className = "mermaid-card";
  card.dataset.source = source;
  card.dataset.diagramKey = diagramKey;
  card.dataset.scale = "1";
  card.tabIndex = 0;
  card.setAttribute("aria-label", "Mermaid diagram");

  const toolbar = document.createElement("div");
  toolbar.className = "mermaid-toolbar";

  const zoomOut = document.createElement("button");
  zoomOut.type = "button";
  zoomOut.className = "mermaid-button";
  zoomOut.dataset.zoom = "out";
  zoomOut.textContent = "-";
  applyTooltip(zoomOut, "Zoom out", ["-"]);
  toolbar.appendChild(zoomOut);

  const scaleLabel = document.createElement("button");
  scaleLabel.type = "button";
  scaleLabel.className = "mermaid-button scale-label";
  scaleLabel.dataset.zoom = "reset";
  scaleLabel.textContent = "100%";
  applyTooltip(scaleLabel, "Reset zoom", ["0"]);
  toolbar.appendChild(scaleLabel);

  const zoomIn = document.createElement("button");
  zoomIn.type = "button";
  zoomIn.className = "mermaid-button";
  zoomIn.dataset.zoom = "in";
  zoomIn.textContent = "+";
  applyTooltip(zoomIn, "Zoom in", ["+"]);
  toolbar.appendChild(zoomIn);

  const viewport = document.createElement("div");
  viewport.className = "mermaid-viewport";

  const diagram = document.createElement("div");
  diagram.className = "mermaid-diagram";
  viewport.appendChild(diagram);

  card.appendChild(toolbar);
  card.appendChild(viewport);
  return card;
}

async function renderMermaidCard(card) {
  const diagram = card.querySelector(".mermaid-diagram");
  const source = card.dataset.source || "";
  const renderId = `mermaid-${createId()}`;

  try {
    const rendered = await window.mermaid.render(renderId, source);
    diagram.innerHTML = rendered.svg;
    prepareMermaidDiagram(card);
    setMermaidScale(card, getStoredMermaidScale(card), {
      persist: false,
      activate: false,
    });
  } catch (error) {
    card.classList.add("is-error");
    diagram.innerHTML = `
      <div class="mermaid-error-note">Mermaid could not be rendered.</div>
      <pre>${escapeHtml(source)}</pre>
    `;
  }
}

function handleMermaidToolbarClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const button = target.closest(".mermaid-button");
  if (!button) {
    return;
  }

  const card = button.closest(".mermaid-card");
  if (!card) {
    return;
  }

  setActiveMermaidCard(card);
  const currentScale = getMermaidScale(card);
  if (button.dataset.zoom === "in") {
    setMermaidScale(card, currentScale + 0.1);
    return;
  }

  if (button.dataset.zoom === "out") {
    setMermaidScale(card, currentScale - 0.1);
    return;
  }

  setMermaidScale(card, 1);
}

function handleMermaidWheelZoom(event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const viewport = target.closest(".mermaid-viewport");
  if (!viewport) {
    return;
  }

  event.preventDefault();
  const card = viewport.closest(".mermaid-card");
  if (!card) {
    return;
  }

  setActiveMermaidCard(card);
  const currentScale = getMermaidScale(card);
  const delta = event.deltaY < 0
    ? MERMAID_WHEEL_SCALE_STEP
    : -MERMAID_WHEEL_SCALE_STEP;
  setMermaidScale(card, currentScale + delta);
}

function handleMermaidCardFocus(event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const card = target.closest(".mermaid-card");
  if (card) {
    setActiveMermaidCard(card);
  }
}

function handleMermaidPanStart(event) {
  if (event.button !== 0) {
    return;
  }

  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const viewport = target.closest(".mermaid-viewport");
  if (!viewport) {
    return;
  }

  if (target.closest(".mermaid-button")) {
    return;
  }

  const card = viewport.closest(".mermaid-card");
  if (!card || card.classList.contains("is-error")) {
    return;
  }

  setActiveMermaidCard(card);
  event.preventDefault();
  activeMermaidPan = {
    pointerId: event.pointerId,
    viewport,
    card,
    startX: event.clientX,
    startY: event.clientY,
    scrollLeft: viewport.scrollLeft,
    scrollTop: viewport.scrollTop,
  };

  card.classList.add("is-panning");
  if (typeof viewport.setPointerCapture === "function") {
    try {
      viewport.setPointerCapture(event.pointerId);
    } catch (error) {
      console.debug("Pointer capture unavailable for mermaid pan.", error);
    }
  }
}

function handleMermaidPanMove(event) {
  if (!activeMermaidPan || event.pointerId !== activeMermaidPan.pointerId) {
    return;
  }

  event.preventDefault();
  const deltaX = event.clientX - activeMermaidPan.startX;
  const deltaY = event.clientY - activeMermaidPan.startY;
  activeMermaidPan.viewport.scrollLeft = activeMermaidPan.scrollLeft - deltaX;
  activeMermaidPan.viewport.scrollTop = activeMermaidPan.scrollTop - deltaY;
}

function handleMermaidPanEnd(event) {
  if (!activeMermaidPan || event.pointerId !== activeMermaidPan.pointerId) {
    return;
  }

  clearMermaidPanState();
}

function clearMermaidPanState() {
  if (!activeMermaidPan) {
    return;
  }

  if (
    typeof activeMermaidPan.viewport.releasePointerCapture === "function" &&
    activeMermaidPan.viewport.hasPointerCapture?.(activeMermaidPan.pointerId)
  ) {
    try {
      activeMermaidPan.viewport.releasePointerCapture(
        activeMermaidPan.pointerId,
      );
    } catch (error) {
      console.debug("Pointer release unavailable for mermaid pan.", error);
    }
  }

  activeMermaidPan.card.classList.remove("is-panning");
  activeMermaidPan = null;
}

function createMermaidDiagramKey(selectionKey, index, source) {
  return `mermaid-${hashString(`${selectionKey || "global"}::${index}::${source}`)}`;
}

function getStoredMermaidScale(card) {
  const diagramKey = card.dataset.diagramKey;
  if (!diagramKey) {
    return 1;
  }

  return clampMermaidScale(state.mermaidZooms[diagramKey] || 1);
}

function getMermaidScale(card) {
  return clampMermaidScale(card.dataset.scale || 1);
}

function setActiveMermaidCard(card) {
  const currentActiveCard = getActiveMermaidCard();
  if (currentActiveCard && currentActiveCard !== card) {
    currentActiveCard.classList.remove("is-active");
  }

  activeMermaidDiagramKey = card.dataset.diagramKey || null;
  card.classList.add("is-active");
}

function getActiveMermaidCard() {
  if (activeMermaidDiagramKey) {
    return elements.content.querySelector(
      `.mermaid-card[data-diagram-key="${cssEscape(activeMermaidDiagramKey)}"]`,
    );
  }

  return elements.content.querySelector(".mermaid-card.is-active");
}

function clearActiveMermaidCard() {
  const currentActiveCard = getActiveMermaidCard();
  if (currentActiveCard) {
    currentActiveCard.classList.remove("is-active");
  }

  activeMermaidDiagramKey = null;
}

function prepareMermaidDiagram(card) {
  const svg = card.querySelector(".mermaid-diagram svg");
  if (!svg) {
    return;
  }

  const { width, height } = getMermaidDiagramSize(svg);
  card.dataset.baseWidth = String(width);
  card.dataset.baseHeight = String(height);

  svg.style.maxWidth = "none";
  svg.style.width = `${width}px`;
  svg.style.height = `${height}px`;
}

function getMermaidDiagramSize(svg) {
  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const values = viewBox
      .trim()
      .split(/[\s,]+/)
      .map((value) => Number(value));

    if (
      values.length === 4 &&
      Number.isFinite(values[2]) &&
      Number.isFinite(values[3]) &&
      values[2] > 0 &&
      values[3] > 0
    ) {
      return {
        width: values[2],
        height: values[3],
      };
    }
  }

  if (typeof svg.getBBox === "function") {
    try {
      const box = svg.getBBox();
      if (box.width > 0 && box.height > 0) {
        return {
          width: box.width,
          height: box.height,
        };
      }
    } catch (error) {
      console.debug("Could not read Mermaid SVG box.", error);
    }
  }

  return {
    width: 960,
    height: 540,
  };
}

function setMermaidScale(card, nextScale, options = {}) {
  const clampedScale = clampMermaidScale(nextScale);
  const svg = card.querySelector(".mermaid-diagram svg");
  const label = card.querySelector(".scale-label");
  const previousScale = getMermaidScale(card);
  const diagramKey = card.dataset.diagramKey;

  card.dataset.scale = String(clampedScale);
  if (options.activate !== false) {
    setActiveMermaidCard(card);
  }
  if (svg) {
    const baseWidth = Number(card.dataset.baseWidth || "0");
    const baseHeight = Number(card.dataset.baseHeight || "0");

    if (baseWidth > 0 && baseHeight > 0) {
      svg.style.width = `${roundDimension(baseWidth * clampedScale)}px`;
      svg.style.height = `${roundDimension(baseHeight * clampedScale)}px`;
    }
  }
  if (label) {
    label.textContent = `${Math.round(clampedScale * 100)}%`;
  }

  if (options.persist !== false && diagramKey && previousScale !== clampedScale) {
    if (clampedScale === 1) {
      delete state.mermaidZooms[diagramKey];
    } else {
      state.mermaidZooms[diagramKey] = clampedScale;
    }
    persistState();
  }
}

function roundScale(value) {
  return Math.round(value * 100) / 100;
}

function roundDimension(value) {
  return Math.round(value * 100) / 100;
}

function hashString(value) {
  let hash = 5381;
  for (const character of value) {
    hash = ((hash << 5) + hash) ^ character.charCodeAt(0);
  }
  return (hash >>> 0).toString(36);
}

function cssEscape(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(value);
  }

  return String(value).replaceAll('"', '\\"');
}

function isMarkdownName(fileName) {
  const lowered = fileName.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((extension) => lowered.endsWith(extension));
}

function basename(filePath) {
  const parts = filePath.split("/");
  return parts[parts.length - 1];
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function ensurePermission(handle, shouldRequest) {
  if (!handle.queryPermission) {
    return true;
  }

  const status = await handle.queryPermission({ mode: "read" });
  if (status === "granted") {
    return true;
  }

  if (shouldRequest) {
    const nextStatus = await handle.requestPermission({ mode: "read" });
    return nextStatus === "granted";
  }

  return false;
}

async function collectMarkdownEntries(directoryHandle, prefix = "") {
  const entries = [];

  for await (const [name, handle] of directoryHandle.entries()) {
    if (handle.kind === "file" && isMarkdownName(name)) {
      entries.push({
        relativePath: `${prefix}${name}`,
        name,
      });
      continue;
    }

    if (handle.kind === "directory") {
      const nestedEntries = await collectMarkdownEntries(
        handle,
        `${prefix}${name}/`,
      );
      entries.push(...nestedEntries);
    }
  }

  return entries.sort((left, right) =>
    nameCollator.compare(left.relativePath, right.relativePath),
  );
}

async function getNestedFileHandle(folderHandle, relativePath) {
  const parts = relativePath.split("/").filter(Boolean);
  let currentDirectory = folderHandle;

  for (const directoryName of parts.slice(0, -1)) {
    currentDirectory = await currentDirectory.getDirectoryHandle(directoryName);
  }

  return currentDirectory.getFileHandle(parts[parts.length - 1]);
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function isMissingHandleError(error) {
  return (
    error?.name === "NotFoundError" ||
    error?.name === "NotReadableError" ||
    error?.name === "InvalidStateError"
  );
}

async function getDatabase() {
  if (!("indexedDB" in window)) {
    return null;
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DB_STORE)) {
          request.result.createObjectStore(DB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return dbPromise;
}

async function saveHandle(id, handle) {
  const database = await getDatabase();
  if (!database) {
    return;
  }

  await new Promise((resolve, reject) => {
    const transaction = database.transaction(DB_STORE, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.objectStore(DB_STORE).put(handle, id);
  });
}

async function loadHandle(id) {
  const database = await getDatabase();
  if (!database) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DB_STORE, "readonly");
    const request = transaction.objectStore(DB_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function deleteHandle(id) {
  const database = await getDatabase();
  if (!database) {
    return;
  }

  await new Promise((resolve, reject) => {
    const transaction = database.transaction(DB_STORE, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.objectStore(DB_STORE).delete(id);
  });
}
