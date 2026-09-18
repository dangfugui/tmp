# QwenPaw RESTful API 文档（中文总结）

> 来源：
>
> [QwenPaw RESTful API 教程](https://qwenpaw.agentscope.io/docs/api-tutorial)
> 协议基础：QwenPaw API 基于 AgentScope Runtime 协议扩展。
> 本文档用于对接聊天页面：向 Agent 发消息、接收流式回复、管理多 Agent 会话。
> ⚠️ 
>
> **安全警告**
>
> ：如果 QwenPaw 实例暴露在公网，强烈建议启用 Web 登录认证（
>
> `QWENPAW_AUTH_ENABLED=true`
>
> ），否则任何人都能访问并控制你的 Agent。



***

## 1. 概述

通过 HTTP 请求与 QwenPaw Agent 交互，可以：



* 发送消息给 Agent 并接收回复

* 管理多个 Agent 实例

* 集成不同渠道（channel）

## 2. API Endpoint

主聊天接口：



```
POST /api/console/chat
```

> ⚠️ 注意路径是 
>
> `/api/console/chat`
>
>  而不是 
>
> `/console/chat`
>
>  —— 所有 API 都在 
>
> `/api`
>
>  前缀下。

## 3. 认证

### 3.1 Agent ID（必填）

通过请求头 `X-Agent-Id` 指定要交互的 Agent：



```
-H "X-Agent-Id: default"
```

获取方式：查看 Console 左上角当前选中的 Agent；默认 Agent ID 为 `default`。

### 3.2 [localhost](https://localhost) 自动绕过认证



* 来自 `127.0.0.1` 或 `::1` 的请求**自动跳过 Web 认证**，无需 `Authorization` 头（本地开发 / CLI 用）

* 从远程机器访问时**必须**提供有效认证 token



```
\# 本地请求 - 无需 Authorization token

curl -X POST http://localhost:8088/api/console/chat \\

&#x20; -H "Content-Type: application/json" \\

&#x20; -H "X-Agent-Id: default" \\

&#x20; -d '{"input": \[...]}'

\# 远程请求 - 需要 Authorization token

curl -X POST http://your-server.com:8088/api/console/chat \\

&#x20; -H "Content-Type: application/json" \\

&#x20; -H "Authorization: Bearer \<YOUR\_TOKEN>" \\

&#x20; -H "X-Agent-Id: default" \\

&#x20; -d '{"input": \[...]}'
```

## 4. 请求格式

类似 OpenAI 的消息格式：



```
{

&#x20; "input": \[

&#x20;   {

&#x20;     "role": "user",

&#x20;     "content": \[

&#x20;       {

&#x20;         "type": "text",

&#x20;         "text": "Your message here"

&#x20;       }

&#x20;     ]

&#x20;   }

&#x20; ],

&#x20; "session\_id": "my-session",

&#x20; "user\_id": "user-001",

&#x20; "channel": "console"

}
```



| 参数           | 必填 | 说明                                                                     |
| ------------ | -- | ---------------------------------------------------------------------- |
| `input`      | ✅  | 消息数组：`role`（通常为 "user"）→ `content`（数组）→ `type`（通常为 "text"）→ `text`（正文） |
| `session_id` | 可选 | 会话 ID，用于保持上下文连续                                                        |
| `user_id`    | 可选 | 用户 ID，区分不同用户                                                           |
| `channel`    | 推荐 | 渠道名，推荐设为 `"console"`                                                   |

## 5. cURL 调用示例



```
curl -X POST http://localhost:8088/api/console/chat \\

&#x20; -H "Content-Type: application/json" \\

&#x20; -H "X-Agent-Id: default" \\

&#x20; -d '{

&#x20;   "input": \[

&#x20;     {

&#x20;       "role": "user",

&#x20;       "content": \[

&#x20;         {

&#x20;           "type": "text",

&#x20;           "text": "Hello, please introduce yourself"

&#x20;         }

&#x20;       ]

&#x20;     }

&#x20;   ],

&#x20;   "session\_id": "my-session",

&#x20;   "user\_id": "my-user",

&#x20;   "channel": "console"

&#x20; }' \\

&#x20; \--no-buffer
```

要点：



* `Content-Type: application/json`：请求体为 JSON

* `X-Agent-Id: default`：指定 Agent，默认 `default`

* `--no-buffer`：禁用缓冲，用于实时流式响应

## 6. 响应格式（SSE 流式）

返回 **Server-Sent Events (SSE)** 流式响应，每行以 `data: ` 前缀：



```
data: {"sequence\_number":0,"object":"response","status":"created",...}

data: {"sequence\_number":1,"object":"response","status":"in\_progress",...}

data: {"sequence\_number":2,"object":"response","status":"in\_progress","output":\[{"role":"assistant","content":\[{"type":"text","text":"Hello! I'm QwenPaw..."}]}],...}

data: {"sequence\_number":3,"object":"response","status":"completed",...}
```



| 字段                | 说明                                                                      |
| ----------------- | ----------------------------------------------------------------------- |
| `sequence_number` | 事件序号                                                                    |
| `object`          | 对象类型，通常为 `"response"`                                                   |
| `status`          | `created` / `in_progress` / `completed` / `failed`                      |
| `output`          | 输出内容（处理中与完成时包含）：`role`=assistant，`content[]` 里 `type`=text 的 `text` 为正文 |
| `error`           | 失败时包含错误信息                                                               |
| `session_id`      | 会话 ID                                                                   |
| `usage`           | 完成时的 token 用量统计                                                         |

## 7. 多轮对话

通过 `session_id` + `user_id` 自动管理上下文：**多次请求使用相同的&#x20;**`session_id`，系统自动保存 / 加载历史。



* 第一轮发 "My name is Alice"，第二轮同 `session_id` 发 "Do you remember my name?"

* **不需要**在 `input` 里带历史消息，系统按 `session_id` 自动加载

* 保持 `session_id` 和 `user_id` 一致即可维持连续性

## 8. 错误处理



| 错误                     | 返回体                                       | 解决                                              |
| ---------------------- | ----------------------------------------- | ----------------------------------------------- |
| 405 Method Not Allowed | `{"detail":"Method Not Allowed"}`         | 确认用 POST；确认路径 `/api/console/chat`（带 `/api` 前缀）  |
| 400 Bad Request        | `{"detail": "Validation error"}`          | 检查请求体格式、`input` 字段存在且合法、JSON 有效                 |
| 404 Agent Not Found    | `{"detail": "Agent not found"}`           | 检查 `X-Agent-Id` 值；确认 Agent 已在 Console 创建        |
| 503 Channel Not Found  | `{"detail": "Channel Console not found"}` | 确认 Console 渠道已启用（Console → Settings → Channels） |

## 9. Python 调用示例

### 9.1 标准库 urllib（无第三方依赖）



```
import urllib.request

import json

API\_URL = "http://localhost:8088/api/console/chat"

AGENT\_ID = "default"

AUTH\_TOKEN = ""  # 若启用认证则填 token

def chat\_with\_agent(message, session\_id="my-session"):

&#x20;   headers = {

&#x20;       "Content-Type": "application/json",

&#x20;       "X-Agent-Id": AGENT\_ID

&#x20;   }

&#x20;   if AUTH\_TOKEN:

&#x20;       headers\["Authorization"] = f"Bearer {AUTH\_TOKEN}"

&#x20;   data = {

&#x20;       "input": \[

&#x20;           {

&#x20;               "role": "user",

&#x20;               "content": \[{"type": "text", "text": message}]

&#x20;           }

&#x20;       ],

&#x20;       "session\_id": session\_id,

&#x20;       "user\_id": "python-user",

&#x20;       "channel": "console"

&#x20;   }

&#x20;   request = urllib.request.Request(

&#x20;       API\_URL,

&#x20;       data=json.dumps(data).encode('utf-8'),

&#x20;       headers=headers,

&#x20;       method='POST'

&#x20;   )

&#x20;   try:

&#x20;       with urllib.request.urlopen(request) as response:

&#x20;           for line in response:

&#x20;               line = line.decode('utf-8').strip()

&#x20;               if line.startswith('data: '):

&#x20;                   event\_data = json.loads(line\[6:])  # 去掉 'data: ' 前缀

&#x20;                   status = event\_data.get('status')

&#x20;                   print(f"Status: {status}")

&#x20;                   # 提取回复内容

&#x20;                   if event\_data.get('output'):

&#x20;                       for item in event\_data\['output']:

&#x20;                           if item.get('role') == 'assistant':

&#x20;                               for content in item.get('content', \[]):

&#x20;                                   if content.get('type') == 'text':

&#x20;                                       print(f"Reply: {content.get('text')}")

&#x20;                   # 错误

&#x20;                   if event\_data.get('error'):

&#x20;                       error = event\_data\['error']

&#x20;                       print(f"Error: {error.get('message')}")

&#x20;   except urllib.error.HTTPError as e:

&#x20;       print(f"HTTP Error: {e.code} - {e.read().decode('utf-8')}")

&#x20;   except Exception as e:

&#x20;       print(f"Error: {e}")

if \_\_name\_\_ == "\_\_main\_\_":

&#x20;   chat\_with\_agent("Hello, please introduce yourself")
```

### 9.2 requests 库（推荐，更简洁）



```
import requests

API\_URL = "http://localhost:8088/api/console/chat"

LOGIN\_URL = "http://localhost:8088/api/auth/login"

AGENT\_ID = "default"

def get\_auth\_token(username, password):

&#x20;   """获取认证 token（如已启用认证）"""

&#x20;   response = requests.post(LOGIN\_URL, json={"username": username, "password": password})

&#x20;   if response.status\_code == 200:

&#x20;       return response.json()\["token"]

&#x20;   return None

def chat\_with\_agent(message, session\_id="my-session", auth\_token=None):

&#x20;   headers = {"Content-Type": "application/json", "X-Agent-Id": AGENT\_ID}

&#x20;   if auth\_token:

&#x20;       headers\["Authorization"] = f"Bearer {auth\_token}"

&#x20;   data = {

&#x20;       "input": \[{"role": "user", "content": \[{"type": "text", "text": message}]}],

&#x20;       "session\_id": session\_id,

&#x20;       "user\_id": "python-user",

&#x20;       "channel": "console"

&#x20;   }

&#x20;   with requests.post(API\_URL, headers=headers, json=data, stream=True) as response:

&#x20;       for line in response.iter\_lines():

&#x20;           if line:

&#x20;               line = line.decode('utf-8')

&#x20;               if line.startswith('data: '):

&#x20;                   event\_data = json.loads(line\[6:])

&#x20;                   status = event\_data.get('status')

&#x20;                   if status in ('in\_progress', 'completed'):

&#x20;                       if event\_data.get('output'):

&#x20;                           for item in event\_data\['output']:

&#x20;                               if item.get('role') == 'assistant':

&#x20;                                   for content in item.get('content', \[]):

&#x20;                                       if content.get('type') == 'text':

&#x20;                                           print(content.get('text'), end='', flush=True)

&#x20;                   if event\_data.get('error'):

&#x20;                       print(f"\nError: {event\_data\['error'].get('message')}")

&#x20;                       break

\# 无认证

chat\_with\_agent("Hello, please introduce yourself")

\# 有认证

\# token = get\_auth\_token("admin", "admin123")

\# chat\_with\_agent("Hello, please introduce yourself", auth\_token=token)
```

## 10. 最佳实践



1. **会话管理**：用一致的 `session_id` 保持上下文

2. **错误处理**：始终处理网络错误和 API 错误响应

3. **流式处理**：用流式读取避免内存问题

4. **连接超时**：设置合理超时，避免长时间等待

5. **重试机制**：实现带指数退避的重试逻辑

6. **日志记录**：记录 API 调用便于调试和监控

## 11. 高级用法

### 11.1 多 Agent 切换

通过改变 `X-Agent-Id` 头与不同 Agent 对话：



```
\# 与 Agent 1 对话

curl -X POST http://localhost:8088/api/console/chat \\

&#x20; -H "Content-Type: application/json" \\

&#x20; -H "X-Agent-Id: agent-1" \\

&#x20; -d '{"input":\[{"role":"user","content":\[{"type":"text","text":"Hello"}]}],"channel":"console"}'

\# 与 Agent 2 对话

curl -X POST http://localhost:8088/api/console/chat \\

&#x20; -H "Content-Type: application/json" \\

&#x20; -H "X-Agent-Id: agent-2" \\

&#x20; -d '{"input":\[{"role":"user","content":\[{"type":"text","text":"Hello"}]}],"channel":"console"}'
```

### 11.2 Web 认证 Token（可选）

启用 `QWENPAW_AUTH_ENABLED=true` 后，所有 API 请求需要认证 token。

**注册账号**（单用户模式，只能注册一次）：



```
curl -X POST http://localhost:8088/api/auth/register \\

&#x20; -H "Content-Type: application/json" \\

&#x20; -d '{"username": "admin", "password": "admin123"}'

\# 返回 {"token": "eyJ...", "username": "admin"}
```



* 注册接口只能调用一次；已存在用户返回 `{"detail":"User already registered"}`

* 支持 `expires_in` 参数自定义 token 过期时间（0 = 永久 token，100 年）

* 忘记密码：`qwenpaw auth reset-password`，或删除 `~/.qwenpaw.secret/auth.json` 后重启重注册

* 也支持环境变量自动注册：`QWENPAW_AUTH_USERNAME` / `QWENPAW_AUTH_PASSWORD`

**登录获取 token**：



```
curl -X POST http://localhost:8088/api/auth/login \\

&#x20; -H "Content-Type: application/json" \\

&#x20; -d '{"username": "admin", "password": "admin123"}'
```

**token 过期时间**（`expires_in` 秒）：`604800`=7 天（默认）、`2592000`=30 天、`31536000`=1 年、`0` 或 `-1`= 永久（100 年）

**使用 token**：加到 `Authorization: Bearer <TOKEN>` 头。

**Token 特性**：



* 默认 7 天有效，可自定义，最长 100 年；HMAC-SHA256 签名

* 每次登录生成新 token，旧 token 不会被自动撤销，可同时使用多个

* 本地（127.0.0.1 / ::1）自动跳过认证

**撤销 token**：



| 方式         | 接口                                 | 说明                           |
| ---------- | ---------------------------------- | ---------------------------- |
| 撤销单个       | `POST /api/auth/revoke-token`      | 精确控制，不影响其他设备                 |
| 撤销全部       | `POST /api/auth/revoke-all-tokens` | 所有会话失效                       |
| 改密码        | `POST /api/auth/update-profile`    | 自动轮换 JWT secret，旧 token 全部失效 |
| 删除 auth 文件 | 删除 `auth.json`                     | 完全重置（含密码），需服务器访问权限           |

**关闭认证**：删除环境变量 `QWENPAW_AUTH_ENABLED` 后重启 `qwenpaw app`；或 Docker 部署时去掉 `-e QWENPAW_AUTH_ENABLED=true`。检查认证状态：`GET /api/auth/status`。

## 12. 故障排查



| 问题                       | 检查项                                                              |
| ------------------------ | ---------------------------------------------------------------- |
| 无法连接服务器                  | `curl http://localhost:8088/api/version` 确认服务在运行                 |
| 响应中断                     | 网络稳定性、服务器运行、模型配置                                                 |
| `MODEL_EXECUTION_FAILED` | Console → Settings → Models 配置是否正确；API Key 是否有效；模型名是否正确；查看错误详情文件 |

## 13. 相关文档



* [Console Guide](https://qwenpaw.agentscope.io/docs/console)

* [Security Settings](https://qwenpaw.agentscope.io/docs/security)

* [Multi-Agent](https://qwenpaw.agentscope.io/docs/multi-agent)

* [Channels Configuration](https://qwenpaw.agentscope.io/docs/channels)

* 遇到问题：查 [FAQ](https://qwenpaw.agentscope.io/docs/faq) / [社区](https://qwenpaw.agentscope.io/docs/community) / [GitHub Issues](https://github.com/agentscope-ai/QwenPaw/issues)



***

*本文档由官方 API 教程页面总结整理（2026-09-16）。*