# 跨浏览器加载说明

## Chrome / Edge

直接加载整个 `chrome/` 目录即可，用的是 `manifest.json`。

## Firefox

1. 把 `manifest.firefox.json` 复制为 `manifest.json`（覆盖原文件）
2. 打开 Firefox，地址栏输入 `about:debugging`
3. 点击"此 Firefox" → "临时加载附加组件"
4. 选择 `manifest.json`

> Firefox 要求版本 ≥ 128（MV3 + service worker 稳定支持）

## 打包发布

- Chrome/Edge 商店：用原始 `manifest.json` 打包
- Firefox 商店：把 `manifest.firefox.json` 重命名为 `manifest.json` 后打包
