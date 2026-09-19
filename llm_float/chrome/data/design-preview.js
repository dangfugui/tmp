  var ICONS = {
    idle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3z"/><path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><path d="M8.5 10.5h7M8.5 13.5h4.5"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    tts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12"/></svg>',
    asr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5 10.5a7 7 0 0 0 14 0M12 17.5v3.5M8.5 21h7"/></svg>'
  };
  var STATES = [
    { key: "idle", label: "静默" },
    { key: "chat", label: "聊天" },
    { key: "settings", label: "设置" },
    { key: "tts", label: "字幕" },
    { key: "asr", label: "识别" }
  ];
  var STYLES = [
    { no: 1, name: "液态玻璃", desc: "半透明渐变 + 顶部高光 + 语义色光晕，通透精致，柔和呼吸" },
    { no: 2, name: "极简扁平", desc: "纯色圆 + 白色细线图标，无阴影无渐变，干净利落" },
    { no: 3, name: "霓虹赛博", desc: "深黑底 + 霓虹描边 + 发光图标，赛博朋克夜场感" },
    { no: 4, name: "马卡龙奶油", desc: "低饱和柔彩色 + 奶油高光，可爱软萌" },
    { no: 5, name: "金属质感", desc: "银灰金属渐变 + 强高光反射，宝石色区分状态，沉稳高级" },
    { no: 6, name: "活力糖果", desc: "高饱和撞色渐变 + 白描边 + 弹跳动效，活泼醒目" },
    { no: 7, name: "莫兰迪雅致", desc: "莫兰迪灰调色系 + 细描边，低对比文艺感" },
    { no: 8, name: "复古合成波", desc: "深紫夜空 + 霓虹粉紫 + 网格纹理，Synthwave 复古" },
    { no: 9, name: "自然绿意", desc: "苔藓森林绿渐变，哑光磨砂质感，沉稳安静" },
    { no: 10, name: "黑白极简", desc: "黑白双色交替 + 粗线条图标，纯粹高对比" },
    { no: 11, name: "品牌蓝", desc: "青蓝品牌渐变 + 藏蓝点缀，源自聊天色盘，商务清爽" },
    { no: 12, name: "PageAgent", desc: "霓虹渐变边框 + 流动发光，源自 alibaba/page-agent，科技感十足" }
  ];

  var THEME_KEYS = { 1: "glass", 2: "flat", 3: "neon", 4: "macaron", 5: "metal", 6: "candy", 7: "morandi", 8: "synthwave", 9: "green", 10: "mono", 11: "brand", 12: "pageagent" };

  var grid = document.getElementById("grid");
  STYLES.forEach(function (s) {
    var card = document.createElement("div");
    card.className = "style-card g" + s.no;
    card.dataset.no = s.no;
    card.dataset.name = s.name;
    card.dataset.theme = (THEME_KEYS || { 1: "glass", 2: "flat", 3: "neon", 4: "macaron", 5: "metal", 6: "candy", 7: "morandi", 8: "synthwave", 9: "green", 10: "mono", 11: "brand" })[s.no] || "glass";

    var head = document.createElement("div");
    head.className = "style-head";
    var no = document.createElement("span");
    no.className = "style-no";
    no.textContent = "G" + s.no;
    var name = document.createElement("span");
    name.className = "style-name";
    name.textContent = s.name;
    head.appendChild(no);
    head.appendChild(name);

    var desc = document.createElement("div");
    desc.className = "style-desc";
    desc.textContent = s.desc;

    var row = document.createElement("div");
    row.className = "orb-row";
    STATES.forEach(function (st) {
      var cell = document.createElement("div");
      cell.className = "orb-cell";
      var box = document.createElement("div");
      box.className = "orb-box";
      box.innerHTML =
        '<button class="orb" data-state="' + st.key + '" aria-label="' + st.label + '">' +
          '<span class="glass"></span>' +
          '<span class="state-icon icon-idle">' + ICONS.idle + '</span>' +
          '<span class="state-icon icon-chat">' + ICONS.chat + '</span>' +
          '<span class="state-icon icon-settings">' + ICONS.settings + '</span>' +
          '<span class="state-icon icon-tts">' + ICONS.tts + '</span>' +
          '<span class="state-icon icon-asr">' + ICONS.asr + '</span>' +
          '<span class="fx fx-asr"><i class="ring r1"></i><i class="ring r2"></i></span>' +
          '<span class="fx fx-tts"><i class="note n1"></i><i class="note n2"></i><i class="note n3"></i></span>' +
        '</button>';
      var label = document.createElement("span");
      label.className = "orb-label";
      label.textContent = st.label;
      cell.appendChild(box);
      cell.appendChild(label);
      row.appendChild(cell);
    });

    card.appendChild(head);
    card.appendChild(desc);
    card.appendChild(row);
    card.addEventListener("click", function () { pick(s.no, s.name); });
    grid.appendChild(card);
  });

  var picked = document.getElementById("picked");
  var pickedTag = document.getElementById("picked-tag");
  var pickedText = document.getElementById("picked-text");

  function pick(no, name) {
    document.querySelectorAll(".style-card").forEach(function (c) {
      c.classList.toggle("selected", Number(c.dataset.no) === no);
    });
    // 切换 body 主题，悬浮球配色实时跟随 ui/theme.css
    document.body.dataset.theme = THEME_KEYS[no] || "glass";
    pickedTag.textContent = "G" + no;
    pickedTag.style.setProperty("--pick-c", "var(--pick-c, #6d7cff)");
    pickedText.textContent = "已选中「" + name + "」风格 —— 该主题已在设置页主题下拉中可用（" + (THEME_KEYS[no] || "") + "）。";
    picked.classList.add("show");
  }
