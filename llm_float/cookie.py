# -*- coding: utf-8 -*-
import io

# web_fetch 和 web_post 都加 credentials: "include" 自动带 cookie
p = r"C:\Users\admin\Downloads\tmp\llm_float\chrome\background.js"
s = io.open(p, "r", encoding="utf-8", newline="").read()

# doWebFetch 的普通 fetch
s = s.replace(
    'const resp = await fetch(url, { redirect: "follow" });',
    'const resp = await fetch(url, { redirect: "follow", credentials: "include" });'
)
# doWebPost 的 fetch
s = s.replace(
    'const resp = await fetch(url, { method: "POST", headers, body });',
    'const resp = await fetch(url, { method: "POST", headers, body, credentials: "include" });'
)
io.open(p, "w", encoding="utf-8", newline="").write(s)
print("OK")
