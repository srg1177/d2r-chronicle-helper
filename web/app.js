// Chronicle notebook: browse every Chronicle entry, see its base item and real name,
// and mark the ones you have. Marks are saved to your account through the API.
(function () {
  const DATA = window.CHRONICLE_DATA;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const BY_ID = new Map();
  for (const tab of ["unique", "sets", "runewords"]) for (const i of DATA[tab].items) BY_ID.set(i.id, i);

  // ---------- API ----------
  async function api(method, path, body) {
    const res = await fetch("/api" + path, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ---------- Login screen ----------
  let registerMode = false;
  const form = $("#login-form");
  function setLoginMode(register) {
    registerMode = register;
    $("#confirm-field").hidden = !register;
    form.confirm.required = register;
    form.password.autocomplete = register ? "new-password" : "current-password";
    $("#login-submit").textContent = register ? "Create Account" : "Log In";
    $("#login-switch").textContent = register ? "I already have an account" : "Create a new account";
    $("#login-intro").textContent = register ? "Create an account to save your marks." : "Log in to see your saved marks.";
    $("#login-error").textContent = "";
  }
  function showLogin() {
    $("#app").hidden = true;
    $("#login").hidden = false;
    tip.hidden = true;
    form.password.value = ""; form.confirm.value = "";
    form.username.focus();
  }
  $("#login-switch").addEventListener("click", () => setLoginMode(!registerMode));
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const username = form.username.value.trim(), password = form.password.value;
    if (registerMode && password !== form.confirm.value) {
      $("#login-error").textContent = "Passwords do not match";
      return;
    }
    $("#login-submit").disabled = true;
    try {
      const me = await api("POST", registerMode ? "/register" : "/login", { username, password });
      await enter(me.username);
    } catch (err) {
      $("#login-error").textContent = err.message;
    } finally {
      $("#login-submit").disabled = false;
    }
  });
  $("#logout").addEventListener("click", async () => {
    try { await api("POST", "/logout"); } catch (e) { /* already logged out */ }
    for (const i of BY_ID.values()) i.found = false;
    setLoginMode(false);
    showLogin();
  });

  async function enter(username) {
    const { ids } = await api("GET", "/marks");
    for (const i of BY_ID.values()) i.found = false;
    for (const id of ids) if (BY_ID.has(id)) BY_ID.get(id).found = true;
    $("#user").textContent = username;
    $("#login").hidden = true;
    $("#app").hidden = false;
    render();
  }

  const state = { tab: "unique", cat: null, search: "", show: "All",
                  tiers: new Set(["normal", "exceptional", "elite"]), expanded: new Set() };

  const kindOf = tab => tab === "sets" ? "set" : tab === "runewords" ? "runeword" : "unique";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const inCat = (item, id) => item.cat === id || (item.cats || []).includes(id);
  const tally = list => `${list.filter(i => i.found).length}/${list.length}`;

  // ---------- Sidebar tree ----------
  function renderTree() {
    const { categories, items } = DATA[state.tab];
    $("#tree").innerHTML = categories.map(c => {
      const open = state.expanded.has(c.id);
      return `<li>
        <button class="node ${open ? "" : "collapsed"} ${state.cat === c.id ? "selected" : ""}" data-parent="${c.id}">
          <span class="arrow"></span><span class="bar"></span>${esc(c.name)}
        </button>
        <ul class="${open ? "" : "hidden"}">
          ${c.children.filter(ch => items.some(i => inCat(i, ch.id))).map(ch =>
            `<li><button class="node child ${state.cat === ch.id ? "selected" : ""}" data-cat="${esc(ch.id)}"
              title="${tally(items.filter(i => inCat(i, ch.id)))} marked">
            <span class="label">${esc(ch.name)}</span></button></li>`).join("")}
        </ul></li>`;
    }).join("");
  }

  $("#tree").addEventListener("click", e => {
    const btn = e.target.closest(".node");
    if (!btn) return;
    if (btn.dataset.parent) {
      const id = btn.dataset.parent;
      if (e.target.closest(".arrow") || !state.expanded.has(id)) {
        state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
      }
      if (!e.target.closest(".arrow")) state.cat = state.cat === id ? null : id;
    } else {
      state.cat = state.cat === btn.dataset.cat ? null : btn.dataset.cat;
    }
    render();
    $("#list").scrollTop = 0;
  });

  // ---------- Item list ----------
  function visibleItems() {
    const { categories, items, qualityFilter } = DATA[state.tab];
    let allowed = null;
    if (state.cat) {
      const parent = categories.find(c => c.id === state.cat);
      allowed = parent ? parent.children.map(c => c.id) : [state.cat];
    }
    const q = state.search.trim().toLowerCase();
    return items.filter(i =>
      (!allowed || allowed.some(id => inCat(i, id))) &&
      (!qualityFilter || state.tiers.has(i.tier)) &&
      (state.show === "All" || (state.show === "Discovered") === !!i.found) &&
      (!q || i.name.toLowerCase().includes(q) || i.base.toLowerCase().includes(q) ||
             (i.setName || "").toLowerCase().includes(q) ||
             (i.runes || []).join(" ").toLowerCase().includes(q) ||
             (i.mods || []).some(m => m.toLowerCase().includes(q))));
  }

  function rowHTML(item, idx) {
    const kind = kindOf(state.tab);
    const sub = kind === "runeword"
      ? `${esc(item.base)}<span class="runes">${item.runes.map(r => `<span class="rune">${esc(r)}</span>`).join("")}</span>`
      : `<span class="base">${esc(item.base)}</span> · Req. Level ${item.req}${kind === "set" ? ` · ${esc(item.setName)}` : ""}`;
    const chip = DATA[state.tab].qualityFilter && item.tier !== "normal"
      ? `<span class="tierchip ${item.tier}">${item.tier}</span>` : "";
    return `<div class="row ${kind} ${item.found ? "found" : ""}" data-idx="${idx}">
      <div class="slot"><svg><use href="#i-${item.icon}"/></svg></div>
      <div class="name"><span class="title">${esc(item.name)}${chip}</span><span class="sub">${sub}</span></div>
      <label class="mark" title="Mark as discovered">
        <input type="checkbox" data-id="${esc(item.id)}" ${item.found ? "checked" : ""}
          aria-label="Discovered: ${esc(item.name)}"><span class="box"></span>
      </label></div>`;
  }

  // Flat list in data order (alphabetical by base item), like the game.
  function renderList() {
    const { items } = DATA[state.tab];
    const vis = visibleItems();
    const marked = vis.filter(i => i.found).length;
    $("#shown").innerHTML = `Showing <b>${vis.length}</b> of ${items.length} · ${marked} marked`;
    if (!vis.length) { $("#list").innerHTML = `<div class="empty">No entries match.</div>`; return; }
    const index = new Map(items.map((it, i) => [it, i]));
    $("#list").innerHTML = vis.map(i => rowHTML(i, index.get(i))).join("");
  }

  function renderProgress() {
    const all = DATA[state.tab].items;
    const found = all.filter(i => i.found).length;
    const pct = all.length ? Math.floor(found / all.length * 100) : 0;
    $("#pct").textContent = pct + "%";
    $(".progress").title = `${found} / ${all.length} marked`;
    $("#fill").style.width = pct + "%";
  }

  function render() {
    $(".filterrow").classList.toggle("no-quality", !DATA[state.tab].qualityFilter);
    renderTree(); renderList(); renderProgress();
  }

  // Mark / unmark an entry. Shown immediately, undone if the server refuses.
  function refreshKeepingScroll() {
    const scroll = $("#list").scrollTop;
    renderList(); renderProgress(); renderTree();
    $("#list").scrollTop = scroll;
  }
  $("#list").addEventListener("change", async e => {
    const cb = e.target.closest(".mark input");
    if (!cb) return;
    const item = BY_ID.get(cb.dataset.id);
    const marked = cb.checked;
    item.found = marked;
    refreshKeepingScroll();
    try {
      await api(marked ? "PUT" : "DELETE", "/marks/" + encodeURIComponent(item.id));
    } catch (err) {
      item.found = !marked;
      refreshKeepingScroll();
      if (err.status === 401) { setLoginMode(false); showLogin(); $("#login-error").textContent = "Please log in again"; }
      else alert("Could not save: " + err.message);
    }
  });

  // ---------- Controls ----------
  $$(".tab").forEach(t => t.addEventListener("click", () => {
    $$(".tab").forEach(x => x.classList.toggle("active", x === t));
    state.tab = t.dataset.tab; state.cat = null; state.expanded.clear();
    tip.hidden = true;
    render();
  }));
  $(".search").addEventListener("input", e => { state.search = e.target.value; renderList(); });
  $(".select select").addEventListener("change", e => { state.show = e.target.value; renderList(); });
  $$(".check input").forEach(cb => cb.addEventListener("change", () => {
    cb.checked ? state.tiers.add(cb.dataset.tier) : state.tiers.delete(cb.dataset.tier);
    renderList();
  }));

  // ---------- Tooltip (in-game item box) ----------
  const tip = $("#tooltip");
  const lines = (list, cls) => (list || []).map(m => `<div class="${cls}">${esc(m)}</div>`).join("");
  function tooltipHTML(item) {
    const kind = kindOf(state.tab);
    const setCls = kind === "set" ? "set" : "";
    let h = `<div class="t-name ${setCls}">${esc(item.name)}</div>`;
    if (kind === "runeword") {
      h += `<div class="t-runes">'${item.runes.join("")}'</div><div class="t-base" style="color:var(--muted)">${esc(item.base)}</div>`;
    } else {
      h += `<div class="t-base ${setCls}">${esc(item.base)}</div>`;
    }
    if (item.variant) h += `<div class="t-note">Variant ${item.variant}</div>`;
    h += lines(item.stats, "t-stat");
    if (item.req) h += `<div class="t-req">Required Level: ${item.req}</div>`;
    h += lines(item.mods, "t-mod");
    if (kind === "set") {
      const set = DATA.sets.sets[item.set];
      h += lines(item.setMods, "t-setmod");
      h += `<div class="t-setname">${esc(set.name)}</div>`;
      h += DATA.sets.items.filter(i => i.set === item.set)
        .map(i => `<div class="t-member ${i.found ? "have" : ""}">${esc(i.name)}</div>`).join("");
      if (set.partial.length || set.full.length) {
        h += `<div class="t-sep"></div>` + lines(set.partial, "t-setmod") + lines(set.full, "t-fullset");
      }
    }
    return h;
  }
  $("#list").addEventListener("mousemove", e => {
    const row = e.target.closest(".row");
    if (!row || e.target.closest(".mark")) { tip.hidden = true; return; }
    if (tip.dataset.idx !== row.dataset.idx || tip.dataset.tab !== state.tab || tip.dataset.v !== row.className) {
      tip.innerHTML = tooltipHTML(DATA[state.tab].items[+row.dataset.idx]);
      tip.dataset.idx = row.dataset.idx; tip.dataset.tab = state.tab; tip.dataset.v = row.className;
    }
    tip.hidden = false;
    const pad = 16, r = tip.getBoundingClientRect();
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = innerHeight - r.height - 8;
    tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
  });
  $("#list").addEventListener("mouseleave", () => tip.hidden = true);
  $("#list").addEventListener("scroll", () => tip.hidden = true);

  // ---------- Start: resume a saved login, or show the login screen ----------
  (async () => {
    try {
      const cfg = await api("GET", "/config");
      $("#login-switch").hidden = !cfg.allowRegistration;
    } catch (e) { /* API down: login will show the error */ }
    try {
      const me = await api("GET", "/me");
      await enter(me.username);
    } catch (e) {
      showLogin();
      if (!e.status || e.status >= 500) $("#login-error").textContent = "Cannot reach the server";
    }
  })();
})();
