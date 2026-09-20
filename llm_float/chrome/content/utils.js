// content/utils.js —— content 脚本公共方法
window.llmUtils = {
  // 根据 url 匹配 profile（越往后优先级越高）
  matchProfile: function(url, profiles) {
    if (!Array.isArray(profiles) || !profiles.length) return null;
    let matched = null;
    for (const p of profiles) {
      if (!p || !p.urlRegex) continue;
      try {
        if (new RegExp(p.urlRegex).test(url || "")) matched = p;
      } catch (e) { /* 非法正则，跳过 */ }
    }
    return matched || profiles[profiles.length - 1];
  }
};
