# HTTP 实现手册：资源请求与响应

## 1. 实现范围与公共约定

**已核实：当前业务操作走 WebSocket，HTTP 主要用于 GET 资源。** 没有从这些调用点发现会话、角色、群组的 REST CRUD；不要把本文建议目录当成旧后端已经存在的接口。WS 请求/事件分别见 [`07-websocket-requests.md`](07-websocket-requests.md)、[`08-websocket-events.md`](08-websocket-events.md)。

默认 HTTP 基础地址为 `http://127.0.0.1:12393`，可在前端设置中修改。建议基础地址末尾不带 `/`，服务端返回的根相对资源路径带 `/`。这不是规范化 URL 合并：当前多处直接字符串拼接，不会自动补斜杠、处理协议相对 URL 或修复错误编码。

所有下列资源请求无业务 JSON 请求体。成功响应为**实际 JSON 文件、图片或二进制字节**，不加 code/message/data 包装。除默认背景和头像前缀外，路径通常来自配置文件或 WS 事件。

## 2. HTTP 资源逐项契约

### H01 默认背景与背景清单图片

| 项目 | 契约 |
| --- | --- |
| 方法 | GET |
| 默认路径 | `/bg/ceiling-window-room-night.jpeg` |
| 其他路径 | WS 背景清单每项 url，或用户自定义 URL |
| 请求参数 | URL 中的资源路径；无请求体，未发现固定业务查询参数 |
| 成功响应 | 200 + 原始图片，JPEG 使用 image/jpeg，PNG 使用 image/png |
| 错误响应 | 建议不存在 404；无权访问 403 或按隐藏策略 404，不回首页 |

当前选择图片时，URL 以小写 http 开头便直接使用，否则拼基础地址。建议输出规范 `https://...` 或 `/bg/...`，不返回 Windows 路径、协议相对地址或裸文件名。清单 name 是显示名，url 是请求位置；不是名称自动转换为路径。

来源：[`bgurl-context.tsx`](../../src/renderer/src/context/bgurl-context.tsx:45)、[`use-general-settings.ts`](../../src/renderer/src/hooks/sidebar/setting/use-general-settings.ts:118)。

### H02 角色头像

| 项目 | 契约 |
| --- | --- |
| 方法 | GET |
| 路径模板 | `/avatars/` + 消息 avatar 字段 |
| 入参 | avatar 建议为经过校验的相对文件名，例如 character-a.png |
| 成功响应 | 200 + 原始图片，正确图片 MIME |
| 错误响应 | 建议 404；若后端设置默认头像，应明确映射规则，不返回任意用户文件 |

前端始终拼基础地址和头像前缀。因此不要在 avatar 中返回完整 URL，也不要重复 `/avatars/` 前缀。若允许子目录，应固定在头像安全根目录内；建议先限制为单层安全文件名。特殊字符要按 URL 路径段编码，避免空格、#、? 被解释成分隔符。

来源：[`chat-history-panel.tsx`](../../src/renderer/src/components/sidebar/chat-history-panel.tsx:118)。

### H03 Live2D 主配置

| 项目 | 契约 |
| --- | --- |
| 方法 | GET |
| URL 来源 | WS 模型配置对象的 url |
| 示例路径 | `/live2d/character-a/character-a.model3.json`，仅为建议布局 |
| 成功响应 | 200 + 合法 Cubism model3 JSON；Content-Type 为 application/json |
| 错误响应 | 不存在 404；未授权 401/403 或按隐藏策略 404，不重定向到登录 HTML |

模型 URL 非 http 开头时会拼基础地址。主配置不是业务 DTO，而是模型随附的真实资源描述文件；应直接发布经过验证的模型文件，不生成一个只有 url/name 的“模型 JSON”替代品。模型资源版权及 SDK 版本兼容也需确认。

来源：[`websocket-handler.tsx`](../../src/renderer/src/services/websocket-handler.tsx:117)、[`lappmodel.ts`](../../src/renderer/WebSDK/src/lappmodel.ts:84)。

### H04 Live2D 子资源

模型加载器根据主配置读出的文件名与模型主目录拼接 URL。保持原有目录层级及大小写；不要把所有子文件平铺。不是每个模型都包含下表全部文件，只提供配置实际引用的资源。

| 资源 | 示例相对位置（不是固定接口） | 建议 Content-Type | 响应体 |
| --- | --- | --- | --- |
| 模型主体 | character-a.moc3 | application/octet-stream | 原始二进制 |
| 纹理 | textures/texture_00.png | image/png | PNG 字节 |
| 表情 | expressions/happy.exp3.json | application/json | 原始 JSON |
| 物理 | character-a.physics3.json | application/json | 原始 JSON |
| 姿态 | character-a.pose3.json | application/json | 原始 JSON |
| 用户数据 | character-a.userdata3.json | application/json | 原始 JSON |
| 动作 | motions/idle.motion3.json | application/json | 原始 JSON |
| 动作附带声音 | sounds/tap.wav | audio/wav | 完整 WAV 字节 |

若主配置位于 `/live2d/character-a/character-a.model3.json` 且纹理引用 `textures/texture_00.png`，浏览器应能 GET `/live2d/character-a/textures/texture_00.png`。完整目录版本化比只给主配置追加查询 token 更可靠：当前子资源拼接不会自动继承主配置查询参数。

SDK 部分请求直接读取 arrayBuffer，没有先检查 response.ok；将缺失资源兜底成 200 首页或登录页会表现为难排查的解析/模型错误。纹理使用 anonymous 跨域图片加载，跨域时必须满足 CORS。来源：[`lappmodel.ts`](../../src/renderer/WebSDK/src/lappmodel.ts:127)、[`lapptexturemanager.ts`](../../src/renderer/WebSDK/src/lapptexturemanager.ts:77)。

### H05 动态声音与浏览器工具页面

- SDK 存在对动态 filePath 的 GET，见 [`lappwavfilehandler.ts`](../../src/renderer/WebSDK/src/lappwavfilehandler.ts:115)。路径可能来自模型声音，也可能是客户端构造的 Data URL；**不能据此推导固定 `/tts` 或 `/audio` 下载接口**。当前对话 TTS 主要通过 WS 裸 Base64 传输。
- 浏览器面板把工具事件中的 debuggerFullscreenUrl 嵌入 iframe，见 [`browser-panel.tsx`](../../src/renderer/src/components/sidebar/browser-panel.tsx:60)。该地址应返回实际查看页面；相关 wsUrl 是浏览器调试服务地址，不是业务 client-ws 的替代入口。
- 页面、页面资源及调试 WS 都需要独立授权与过期策略。iframe 的嵌入限制涉及 CSP frame-ancestors 和 X-Frame-Options，而不只是 CORS；不能简单设置任意站点可嵌入。建议查看服务独立源，避免不可信页面与主应用同源。

## 3. 推荐响应、缓存与跨域策略（新后端建议）

| 场景 | 建议行为 |
| --- | --- |
| 正常读取 | 200，正确 Content-Type，原始文件；可提供正确 Content-Length |
| 条件缓存命中 | 支持 ETag/If-None-Match 或 Last-Modified，返回 304 且无实体 |
| 不存在/非法路径 | 404 或对非法请求返回 400；禁止读出安全根目录之外的数据 |
| 未登录/未授权 | 根据身份策略返回 401/403，或统一 404 隐藏存在性；不回 200 登录 HTML |
| 方法不允许 | 405；HEAD 可作为服务便利支持，不是已发现的业务依赖 |
| Range | 当前未发现显式分段下载依赖；若支持按规范返回 206/416，不自行伪造 |
| 资源异常 | 5xx，保留服务端关联日志；响应不暴露真实磁盘路径 |

固定名称且会变更的主配置可采用短缓存/条件验证。版本目录或内容哈希资源可长期缓存，但必须一起发布主配置与子资源，避免不同版本混装。私有图片/调试页面不使用共享公开缓存；按敏感性使用 private 或 no-store。

跨域模型 fetch 和 anonymous 纹理不携带跨域登录 Cookie，也没有自定义 Authorization 注入。**仅在服务端要求 Bearer 头不能让现有加载器正常工作。** 公共模型可匿名读取；私有资源可考虑同源会话或逐资源签名 URL，但必须验证子资源 URL 的实际拼接方式。签名目录代理也是新设计，不是现有协议能力。

允许来源应按环境明确配置；公开且不含凭证的静态资源可考虑通配 CORS，私有资源不应这样做。动态反射来源应设置 Vary: Origin，禁止无条件回显；携带凭证不能搭配通配允许源。CORS 不是认证，也不是 WS Origin 校验的替代。HTTPS 页面使用 HTTPS 资源和 WSS 连接，避免混合内容被拦截。

## 4. Java 实现落点与安全检查

1. 将资源映射与 WS 业务分开：可使用 Spring MVC 资源处理器、受控下载处理器或反向代理，不必每种模型扩展名单独写一个控制器。
2. 配置明确背景、头像、模型根目录；对 URL 解码、规范化后做真实路径归属检查，处理双重编码、反斜杠、盘符、绝对路径与符号链接逃逸。禁用目录列出，不暴露配置文件/密钥。
3. 建议启动时校验默认背景及模型依赖存在、主配置可解析、子路径合法、MIME 与内容匹配；资源根目录与可写上传目录隔离。
4. 反向代理先匹配资源和 WS 路由，再做前端 SPA 回退；保证资源 404 不落到 SPA。保留浏览器请求所需路径前缀，分别配置资源缓存与 WS 升级/超时。
5. 如果服务器需要代取用户 URL，必须另做 SSRF 防护、大小和超时限制；浏览器直接加载背景并不授权服务器访问任意内网地址。
6. 登录、健康检查、上传和管理 API 若新增，属于新后端扩展，应独立定义；本项目这些调用点不能证明它们已经存在。

## 5. 联调验收清单

- 浏览器网络面板检查默认背景、头像、模型主配置、所有模型子资源的最终 URL、状态码、MIME 和响应内容；不能只测试一个 model3 文件。
- 模型目录中故意缺失纹理应返回真正 404，不能得到 200 HTML；验证带空格/中文路径与生产环境大小写行为。
- 验证跨域纹理可用于 WebGL；私有资源未登录及跨用户访问应被拒绝，拒绝响应不能被共享缓存泄露。
- 验证 HTTPS/WSS、角色切换后的资源刷新、版本发布后缓存一致性、浏览器调试链接到期失效及 iframe 嵌入限制。
- 路径穿越、编码变体、符号链接、异常大资源、无效 WAV/JSON 均应受控失败。本次仅整理契约，以上运行验收尚未执行。