# WebSocket 实现手册（一）：客户端请求

## 1. 契约范围与传输规则

本文面向新 Java 后端实现，覆盖当前前端发送的全部 17 类消息。**消息名、字段及前端行为是源码事实；服务端校验、持久化、错误策略是建议契约，不代表已有后端实现。** 服务端事件与完整时序见 [`08-websocket-events.md`](08-websocket-events.md)，资源见 [`09-http-api.md`](09-http-api.md)。

- 入口默认 `ws://127.0.0.1:12393/client-ws`，生产环境使用 WSS；原生 WebSocket，不是 STOMP/SockJS。
- 一个完整 WS 文本消息承载一个 JSON 对象，按顶层 `type` 路由。底层分帧应先重组；不要按 TCP 包解析。没有统一的 `data` 包装。
- 无请求 ID、轮次 ID、上传 ID、片序号；会话、当前角色、当前历史、音频缓冲由连接绑定。不能要求旧前端补传这些字段。
- 客户端仅在连接 OPEN 时发送，断开时不缓存。重新连接会重新请求初始化并创建历史，不恢复未完成请求。
- 当前构造连接未指定子协议或 Authorization 请求头。身份认证需要另外设计，不能把客户端 UID 当登录凭证。
- 握手前错误走 HTTP；升级后的业务错误走 WS 事件，不能返回 HTTP JSON 响应替代。
- 来源：[`websocket-service.tsx`](../../src/renderer/src/services/websocket-service.tsx:126)、[`websocket-context.tsx`](../../src/renderer/src/context/websocket-context.tsx:6)。

### 1.1 建议的公共校验与执行规则

1. 限制重组后的消息字节数、JSON 深度、字符串长度及数组长度；先判定对象和非空字符串 `type`，再绑定具体 DTO。
2. 不把字符串数字、字符串布尔值自动转换成合法入参；未知消息返回 `error`。未知字段可忽略以利扩展，但不得参与鉴权或状态绑定。
3. 所有 UID 按不透明字符串处理；没有证据表明必须是 UUID。按服务端用户、连接、角色查归属，不按用户传入路径读文件。
4. 每连接串行提交状态；模型、数据库慢操作不阻塞 WS 接收线程。异步完成后和真正发送前都检查连接代次、角色版本、历史与轮次。
5. 生成默认单连接单活跃轮次。用户新输入可取消旧轮后替代；主动发言忙时拒绝或丢弃，不堆积。该策略是建议，需前后端联调。
6. 无请求 ID 意味着无法可靠区分重试与重复操作；禁止对生成、新建历史、带副作用工具进行无条件自动重放。
7. 限额需要显式配置并写入部署约定。4096 样本是当前上传片大小；其余文字长度、总音频时长、图片字节上限不能当作已有协议常量。

### 1.2 通用对象

| 对象 | 字段与类型 | 校验/语义 |
| --- | --- | --- |
| ImageData | `source: "camera" 或 "screen"`；`data: string`；`mime_type: string` | 当前截图为 JPEG Data URL；校验来源白名单、MIME 与魔数一致、可解码性、像素和解码字节上限 |
| DisplayText | `text: string`；`name: string`；`avatar: string` | 文本、显示名、头像资源名；不是 HTML，不用这些值决定权限 |

含图请求的 `images` 为数组；无图发送 `[]`，不是 null。下面请求使用无图有效示例。图片数据的结构示例仅用于说明，字符串中的说明文字不是有效 Base64，不能直接用于联调：

```json
{"source":"camera","data":"data:image/jpeg;base64,这里替换为实际JPEG的Base64","mime_type":"image/jpeg"}
```

服务端解码时先解析 Data URL 前缀，再解码实际 Base64，不能将整个字符串交给裸 Base64 解码器。图片不应被当作 URL 拉取，不默认持久化。来源：[`use-media-capture.tsx`](../../src/renderer/src/hooks/utils/use-media-capture.tsx:22)、[`DisplayText`](../../src/renderer/src/services/websocket-service.tsx:10)。

## 2. 初始化、配置与历史（7 类）

### C01 fetch-backgrounds：查询背景清单

```json
{"type":"fetch-backgrounds"}
```

- 字段：仅 `type`。建连自动发送；只读，可重复查询。
- 成功：返回 `background-files`，包含 `files` 数组；无配置返回空数组。URL 必须对应可访问资源。
- 失败：返回 `error`，不改变角色或历史；不要用空清单掩盖服务故障。

### C02 fetch-configs：查询可切换角色

```json
{"type":"fetch-configs"}
```

- 字段：仅 `type`。成功返回 `config-files`，每项有 `filename` 与 `name`；空清单返回 `[]`。
- `filename` 是服务端可识别的配置别名，随后由 C07 原样传回；不能泄露绝对路径、密钥或配置正文。
- 只读；仅返回当前用户允许使用的角色。失败返回 `error`。

### C03 fetch-history-list：查询历史列表

```json
{"type":"fetch-history-list"}
```

- 字段：仅 `type`。按当前用户和角色查询，返回 `history-list`；`histories` 必须是数组，允许为空。
- **前端收到非空列表会把第一项设为当前历史，但不会同时加载消息。** 建议在已有绑定时把当前历史放首位，其余按最近活动降序；初始化时历史列表响应必须早于新建成功事件。
- 查询本身建议不修改后端绑定；不得让迟到的列表响应覆盖前端新历史。空列表也不会主动清除旧的当前 ID。
- 失败返回 `error`。来源：[`websocket-handler.tsx`](../../src/renderer/src/services/websocket-handler.tsx:209)。

### C04 create-new-history：创建并绑定新会话

```json
{"type":"create-new-history"}
```

- 字段：仅 `type`。建连、点击新会话、角色切换成功后的前端流程都会发送。
- 建议步骤：校验当前角色 → 使旧轮失效并清理上传缓冲 → 持久化空历史 → 绑定新历史 → 返回 `new-history-created`，携带非空 `history_uid`。
- 前端收到成功会清空消息、插入列表首部并回空闲。服务端不能再额外重复新建；每次合法调用默认创建不同历史，不是幂等请求。
- 失败返回 `error`，保持旧绑定；若旧轮已被取消，不恢复旧生成。新建事件只能在提交成功后发送。

### C05 fetch-and-set-history：读取并切换历史

```json
{"type":"fetch-and-set-history","history_uid":"hist_001"}
```

- `history_uid`：必传非空字符串；校验存在、归属和角色作用域。成功取消旧轮、清缓冲、绑定目标，返回 `history-data`，包括完整有序消息数组。
- 空历史返回 `messages: []`，不能省略字段，否则前端会保留旧消息。记录角色必须用 `ai`/`human`，不是 `assistant`/`user`。
- 前端**在请求前乐观设置当前历史 ID**，响应只替换消息。连续切换必须保持处理/发送顺序或丢弃过期加载结果，不能让旧查询覆盖新选择。
- 失败仅发 `error` 无法回滚前端 ID。兼容补偿建议：返回旧绑定对应的 `history-data`，再返回以旧绑定为首项的 `history-list`；需串行防止覆盖后续操作。无旧绑定时建议前端补错误回滚，不能伪造成功。
- 同目标重复请求可以返回当前快照；不要重启对话。来源：[`use-history-drawer.ts`](../../src/renderer/src/hooks/sidebar/use-history-drawer.ts:20)。

### C06 delete-history：删除非当前历史

```json
{"type":"delete-history","history_uid":"hist_002"}
```

- `history_uid`：必传非空字符串；校验归属。前端禁止删除当前历史，后端仍必须校验；建议也拒绝删除其他连接正在生成/绑定的历史。
- 成功返回 `history-deleted` 的 `success: true`；失败返回 `success: false`，可另发 `error` 说明。该专用响应没有目标 ID，不能支持精确并发回滚。
- 前端已乐观移除列表项，失败通知不会恢复列表；建议补发权威 `history-list`，当前绑定必须排首位，避免误切当前历史。
- 幂等建议：经身份作用域校验后，已删除目标可视作成功；不得因 ID 不存在暴露别人的数据。硬删除/软删除由存储方案决定。
- 来源：[`use-history-drawer.ts`](../../src/renderer/src/hooks/sidebar/use-history-drawer.ts:35)。

### C07 switch-config：切换角色

```json
{"type":"switch-config","file":"character-a.yaml"}
```

- `file`：必传非空字符串，必须匹配 C02 返回且用户有权访问的别名；不是任意文件系统路径。
- 建议先验证/准备目标，再取消旧轮、增加角色版本、清缓冲并切换绑定。成功依次发送 `set-model-and-conf`、`config-switched`；新的历史由前端后续 C04 创建。
- 前端事先清模型、停麦并进入 loading；`config-switched` 会再请求历史列表和新建历史。服务端不能把这两项当重复请求丢掉，也不能自己先新建一次。
- 失败只发 `error` 会留下 loading 和空模型。兼容补偿建议重发原角色完整 `set-model-and-conf` 后提示错误；**不要发假的 `config-switched`**，否则会触发成功提示与新建历史。
- 相同角色重复切换需确定策略；若接受并发出成功事件，前端仍会创建新历史。来源：[`use-switch-character.tsx`](../../src/renderer/src/hooks/utils/use-switch-character.tsx:18)。

## 3. 输入、音频与中断（7 类）

### C08 text-input：文字与可选截图

```json
{"type":"text-input","text":"你好，介绍一下自己。","images":[]}
```

- `text`：必传非空字符串，校验 trim 后非空及长度；`images`：必传数组，逐项按 1.2 校验。当前 UI 不支持纯图片空文字发送。
- 校验当前角色和历史，接受后绑定不可变轮次上下文，保存用户文本/必要图像引用，发 `control` 开始，再输出模型结果。
- 前端已追加用户文字，**不要回发 `user-input-transcription`**，否则用户消息重复。流式回复使用 `audio.display_text` 的增量文本，不用 `full-text` 替代聊天记录。
- 失败返回 `error`；已经开始的轮次还必须收尾，未接受的请求不要伪造开始。前端没有用户消息失败状态/自动撤回机制。
- 非幂等，不按相同文本去重。来源：[`use-text-input.tsx`](../../src/renderer/src/hooks/footer/use-text-input.tsx:23)。

### C09 mic-audio-data：上传一句语音的浮点片段

```json
{"type":"mic-audio-data","audio":[0.0,0.12,-0.08,0.0]}
```

- `audio`：必传数字数组；当前每片至多 4096 个样本，末片可更短；不是 Base64、WAV 或二进制 PCM16。
- 建议仅接受有限数值，拒绝字符串/null；第一片打开本连接上传缓冲，随后按 WS 消息顺序追加，无逐片 ACK。
- 原始音频采样率、声道、归一化范围尚待依赖核实/抓包，不得直接写死“16 kHz PCM16”；没有音频元信息可从本消息读取。
- 限制单片、累计样本、累计字节和等待结束时间。非法片段使整个上传失效，丢弃至对应结束信号，不要把后半句当新句；断线/切换清空缓冲。
- 前端一句录音结束后才集中发送，不是真正边录边传；无序号无法片级重试或去重。来源：[`use-send-audio.tsx`](../../src/renderer/src/hooks/utils/use-send-audio.tsx:9)。

### C10 mic-audio-end：封存上传并启动识别

```json
{"type":"mic-audio-end","images":[]}
```

- `images`：必传数组；截图在结束消息中，而不是首片。封存本连接音频与截图，校验非空及限额，移交 ASR，不继续向旧缓冲追加。
- 建议开始事件在接受处理后发；识别得到非空文本后保存用户输入并发 `user-input-transcription`，再走 LLM/TTS；同一识别结果只回显一次。
- 无音频、上传已失效或重复 end：返回 `error` 或按已确定的空输入策略忽略，不能复用上次音频。识别为空应结束当前轮，不生成虚假用户文本。
- 截图采集是异步的；新操作可能交错。无上传 ID 时无法完全判别迟到片段归属，严格隔离需前端协议升级。

### C11 ai-speak-signal：主动说话

```json
{"type":"ai-speak-signal","idle_time":-1,"images":[]}
```

- `idle_time`：必传有限数值，单位秒；手动触发为 `-1`，自动触发为非负空闲秒数。`images`：必传数组。
- 校验权限、额度和频率；按服务端状态判断是否真的空闲，不信任客户端时长。忙时建议忽略自动请求或明确拒绝，不取消正常用户输入。
- 接受后创建 AI 主动轮次，发开始/输出/结束；不伪造用户转录消息。失败发 `error`，如已开始则收尾。
- 非幂等；可用服务端冷却窗口抑制重复触发。来源：[`use-trigger-speak.ts`](../../src/renderer/src/hooks/utils/use-trigger-speak.ts:9)。

### C12 interrupt-signal：中断当前生成

```json
{"type":"interrupt-signal","text":"这是已经展示的回复片段"}
```

- `text`：当前前端传字符串，允许空串；它是累计展示内容，不是可靠的已听音频转录，更不能作为权威生成全文。
- 建议先令当前轮次失效，再取消 ASR/LLM/TTS/工具、清未发输出、持久化一次中断终态；无活跃轮次时幂等无操作。
- 无专用成功 ACK。群组转发可向其他获授权成员发服务端同名中断，但不能回路广播或中断无关用户。
- 不等客户端回执再取消；不要在新轮开始后补发旧结束/错误/音频。来源：[`use-interrupt.ts`](../../src/renderer/src/hooks/utils/use-interrupt.ts:16)。

### C13 audio-play-start：展示/播放开始提示

```json
{"type":"audio-play-start","display_text":{"text":"你好。","name":"角色A","avatar":"character-a.png"},"forwarded":true}
```

- `display_text`：按 1.2；`forwarded`：当前客户端固定发送布尔 true。可用于受控群组展示同步，不代表消息来自可信服务端。
- 即使纯文字、模型缺失或后续播放失败也可能先发此消息；不能据此计费为“成功播音”，不能重复落库 AI 内容或再触发 LLM。
- 无 ACK；重复到达不得产生工具副作用。只转发已验证属于本轮、允许共享的内容，并将出站 `audio.forwarded` 置 true 防止循环。
- 来源：[`use-audio-task.ts`](../../src/renderer/src/hooks/utils/use-audio-task.ts:83)。

### C14 frontend-playback-complete：客户端队列完成提示

```json
{"type":"frontend-playback-complete"}
```

- 字段：仅 `type`。收到 `backend-synth-complete` 后等待前端队列清空，再发此回执；不能证明真实播放成功。
- 仅作弱完成观测；无轮次 ID，迟到/重复回执不能结束当前新轮、触发新生成或释放仍在使用的资源。后端需独立超时与终态规则。
- 不要等待本回执才发送结束控制，避免结束依赖循环。来源：[`use-audio-task.ts`](../../src/renderer/src/hooks/utils/use-audio-task.ts:229)。

## 4. 群组（3 类）

### C15 request-group-info：读取当前群组

```json
{"type":"request-group-info"}
```

- 仅 `type`，只读；根据连接身份返回 `group-update`。无群组建议 `members: []`、`is_owner: false`，不泄露全站连接列表。
- 不能把群组 UID 当认证身份。成员断线的清理和重连身份需后端定义。

### C16 add-client-to-group：添加成员

```json
{"type":"add-client-to-group","invitee_uid":"client_b"}
```

- `invitee_uid`：必传非空字符串；校验调用者权限、目标在线、是否已入组、人数上限和同意/邀请政策。
- 成功返回 `group-operation-result` 并向受影响成员推送各自的 `group-update`；失败返回 success false 和可展示原因。不能只依赖客户端延迟查询。
- 建议重复添加现有成员为幂等无操作；不自动共享历史、屏幕图像、浏览器登录态或工具权限。当前前端没有完整接受邀请流程，开放添加前必须决定策略。

### C17 remove-client-from-group：移除成员或退群

```json
{"type":"remove-client-from-group","target_uid":"client_b"}
```

- `target_uid`：必传非空字符串；目标为自己表示退出，否则校验管理权限。组主退出后的解散/转让需固定策略。
- 成功/失败事件同 C16；向退出者发送清空的群组视图，并停止后续转发。重复移除可幂等，但仍检查调用者权限。
- 前端增删操作后约 100 ms 再查询群组，这不是后端必须在 100 ms 完成的 SLA。来源：[`use-group-drawer.tsx`](../../src/renderer/src/hooks/sidebar/use-group-drawer.tsx:12)。

## 5. Java 实现落点

按消息种类拆 DTO 和处理器，显式映射混合命名，例如 `history_uid`、`idle_time`、`display_text`；不要用全局命名策略误改模型的驼峰字段。数字使用有限性校验，ID 用字符串，布尔值用真正 JSON 布尔值。入站校验 → 权限 → 状态提交 → 后台任务 → 校验代次 → 单发送通道，是建议的统一处理链。更完整的并发与存储方案见 [`01-java-architecture.md`](01-java-architecture.md)。