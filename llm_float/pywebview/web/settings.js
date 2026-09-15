/* Settings window. The whole schema + values come from Python
 * (api.get_settings), and saving goes back to Python (api.save_settings). */

const body = document.getElementById("settings-body");
const toastEl = document.getElementById("toast");

let apiReady = false;
let readyResolve;
const readyPromise = new Promise((resolve) => { readyResolve = resolve; });

(function waitReady() {
  if (window.pywebview && window.pywebview.api) {
    apiReady = true;
    readyResolve();
  } else {
    window.addEventListener("pywebviewready", () => {
      apiReady = true;
      readyResolve();
    });
  }
})();

function api(name, ...args) {
  return readyPromise.then(() => {
    const fn = window.pywebview && window.pywebview.api && window.pywebview.api[name];
    if (!apiReady || !fn) return undefined;
    return Promise.resolve(fn(...args)).catch((err) => {
      console.error("api call failed:", name, err);
      return undefined;
    });
  });
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

let toastTimer = null;
function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1600);
}

let settingsState = {};

function optionPair(opt) {
  return Array.isArray(opt) ? { value: String(opt[0]), label: String(opt[1]) }
                         : { value: String(opt), label: String(opt) };
}

async function loadSettings() {
  const schema = await api("get_settings");
  if (!schema) {
    body.innerHTML = "";
    body.appendChild(el("div", "asr-empty", "无法获取设置：Python 侧未就绪。"));
    return;
  }
  render(schema);
}

function render(schema) {
  body.innerHTML = "";
  settingsState = {};
  schema.forEach((section) => {
    const sec = el("div", "set-section");
    sec.appendChild(el("h4", null, section.section));
    section.items.forEach((item) => sec.appendChild(renderRow(item)));
    body.appendChild(sec);
  });
}

function renderRow(item) {
  const row = el("div", "set-row");
  if (item.type === "textarea") row.classList.add("wide");
  row.appendChild(el("div", "set-label", item.label));

  const ctrl = el("div", "set-control");
  row.appendChild(ctrl);
  settingsState[item.key] = item.value;

  if (item.type === "number") {
    const input = el("input");
    input.type = "number";
    if (item.min !== undefined) input.min = item.min;
    if (item.max !== undefined) input.max = item.max;
    if (item.step !== undefined) input.step = item.step;
    input.value = item.value;
    input.addEventListener("input", () => {
      settingsState[item.key] = input.value === "" ? "" : Number(input.value);
    });
    ctrl.appendChild(input);

  } else if (item.type === "text" || item.type === "password") {
    const input = el("input");
    input.type = item.type;
    input.value = item.value;
    input.addEventListener("input", () => { settingsState[item.key] = input.value; });
    ctrl.appendChild(input);

  } else if (item.type === "textarea") {
    const input = el("textarea");
    input.value = item.value;
    input.addEventListener("input", () => { settingsState[item.key] = input.value; });
    ctrl.appendChild(input);

  } else if (item.type === "bool") {
    const wrap = el("label", "switch");
    const input = el("input");
    input.type = "checkbox";
    input.checked = !!item.value;
    input.addEventListener("change", () => { settingsState[item.key] = input.checked; });
    wrap.append(input, el("span", "track"));
    ctrl.appendChild(wrap);

  } else if (item.type === "select") {
    const select = el("select");
    (item.options || []).forEach((opt) => {
      const { value, label } = optionPair(opt);
      const o = el("option", null, label);
      o.value = value;
      select.appendChild(o);
    });
    select.value = String(item.value);
    select.addEventListener("change", () => { settingsState[item.key] = select.value; });
    ctrl.appendChild(select);

  } else if (item.type === "list") {
    const wrap = el("div", "chips");
    let selected = Array.isArray(item.value) ? item.value.slice() : [];
    (item.options || []).forEach((opt) => {
      const { value, label } = optionPair(opt);
      const chip = el("span", "chip-check", label);
      if (selected.includes(value)) chip.classList.add("on");
      chip.addEventListener("click", () => {
        if (selected.includes(value)) {
          selected = selected.filter((v) => v !== value);
          chip.classList.remove("on");
        } else {
          selected = selected.concat(value);
          chip.classList.add("on");
        }
        settingsState[item.key] = selected.slice();
      });
      wrap.appendChild(chip);
    });
    ctrl.appendChild(wrap);
  }

  return row;
}

document.getElementById("set-save").addEventListener("click", async () => {
  await api("save_settings", settingsState);
  // Apply theme and opacity to all windows immediately
  if (settingsState.theme) {
    await api("apply_theme", { theme: settingsState.theme });
  }
  if (settingsState.orb_opacity !== undefined) {
    await api("apply_opacity", { opacity: settingsState.orb_opacity });
  }
  toast("设置已保存");
});

document.getElementById("set-reset").addEventListener("click", async () => {
  const schema = await api("reset_settings");
  if (schema) {
    render(schema);
    toast("已恢复默认");
  }
});

document.getElementById("set-quit").addEventListener("click", () => api("quit"));

document.getElementById("btn-close").addEventListener("click", () => api("hide_settings"));

loadSettings();