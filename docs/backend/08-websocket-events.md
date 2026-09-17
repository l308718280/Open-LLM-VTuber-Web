# WebSocket 实现手册（二）：服务端事件与时序

## 1. 阅读规则

覆盖前端分发器消费的全部 20 类事件。本文描述的是**前端已核实的消费方式 + 新后端建议的输出契约**，并非旧服务端抓包记录。请求详见 [`07-websocket-requests.md`](07-websocket-requests.md)。

总接口把不少字段标成可选，并不等于对应事件可以不提供这些字段。下文“提供”表示建议 Java 输出的最小完整契约；空集合用 `[]`，不是省略/null；布尔值不是字符串。示例 ID、角色、资源路径仅为示意，需替换为已配置且有权访问的数据。所有事件按顶层 `type` 分发，不加统一响应包装。

源码总入口：[`websocket-handler.tsx`](../../src/renderer/src/services/websocket-handler.tsx:94)；基础 DTO：[`websocket-service.tsx`](../../src/renderer/src/services/websocket-service.tsx:10)。

## 2. 配置、资源与历史（8 类）

### S01 background-files

```json
{"type":"background-files","files":[{"name":"夜间房间","url":"/bg/ceiling-window-room-night.jpeg"}]}
```

响应背景查询。提供 `files` 数组，每项 `name`、`url` 为字符串。前端替换可选清单；不会仅因返回清单自动选第一张。空清单返回 `files: []`。URL 拼接规则见 HTTP 手册，不要返回磁盘路径。

### S02 config-files

```json
{"type":"config-files","configs":[{"filename":"character-a.yaml","name":"角色A"}]}
```

响应角色清单查询。提供 `configs` 数组，每项 `filename`、`name` 为字符串；建议显示名也唯一，避免前端按名字查别名时歧义。不返回配置正文。前端只替换清单，不执行角色切换。

### S03 history-list

```json
{"type":"history-list","histories":[{"uid":"hist_001","latest_message":{"role":"ai","timestamp":"2026-09-17T08:00:00Z","content":"你好。"},"timestamp":"2026-09-17T08:00:00Z"},{"uid":"hist_002","latest_message":null,"timestamp":null}]}
```

提供 `histories` 数组。每项 `uid: string`；`latest_message` 为对象或 null，对象内 `role` 仅 human/ai、`timestamp/content` 为字符串；顶层 `timestamp` 为字符串或 null。建议时间统一 ISO 8601、UTC。前端替换列表，非空时选择第一项为当前历史；**不是无副作用的后台刷新事件**。来源：[`HistoryInfo`](../../src/renderer/src/context/websocket-context.tsx:9)。

### S04 new-history-created

```json
{"type":"new-history-created","history_uid":"hist_003"}
```

创建并绑定成功后提供非空 `history_uid` 字符串。前端回 idle、清聊天、插入列表首部并显示新会话提示。不要重复发该事件，否则列表可重复插入、聊天被再次清空。没有“创建失败”同名变体，失败使用 `error`。

### S05 history-data

```json
{"type":"history-data","messages":[{"id":"msg_001","role":"human","content":"你好","timestamp":"2026-09-17T08:00:00Z","type":"text"},{"id":"msg_002","role":"ai","content":"你好。","timestamp":"2026-09-17T08:00:01Z","name":"角色A","avatar":"character-a.png","type":"text"},{"id":"tool_001","role":"ai","type":"tool_call_status","tool_id":"tool_001","tool_name":"browser","name":"角色A","status":"completed","content":"已读取页面标题","timestamp":"2026-09-17T08:00:02Z"}]}
```

提供完整 `messages` 数组，空历史为 `[]`；前端直接替换聊天并提示加载成功，不设置当前历史 ID。每条必需 `id/content/timestamp` 字符串、`role` 为 human/ai；可选 `name/avatar` 字符串、`type` 为 text/tool_call_status。工具记录另带 `tool_id/tool_name/status`，状态仅 running/completed/error。建议消息 ID 唯一、顺序按服务端稳定序号，而不单靠时间戳。历史加载不重播音频，也不重启工具。

### S06 history-deleted

```json
{"type":"history-deleted","success":true}
```

提供 `success: boolean`。前端仅显示成功/失败提示，不按该事件修改列表或回滚。失败示例把 true 改 false 即可；需要恢复乐观删除时补权威列表，注意第一项绑定副作用。

### S07 set-model-and-conf

```json
{
  "type":"set-model-and-conf",
  "conf_name":"角色A",
  "conf_uid":"conf_a",
  "client_uid":"client_a",
  "model_info":{
    "name":"角色A",
    "description":"示例角色",
    "url":"/live2d/character-a/character-a.model3.json",
    "kScale":1.0,
    "initialXshift":0.0,
    "initialYshift":0.0,
    "emotionMap":{"neutral":0,"happy":1},
    "idleMotionGroupName":"Idle",
    "defaultEmotion":0,
    "pointerInteractive":true,
    "scrollToResize":true,
    "initialScale":1.0,
    "tapMotions":{"TapBody":{"0":1.0}}
  }
}
```

建议建连初始化、角色切换成功及失败恢复时提供完整快照：`conf_name/conf_uid/client_uid` 非空字符串，`model_info` 为下表对象。示例动作组、表情编号必须与真实模型匹配，不是通用有效模型配置。

| 模型字段 | 类型 | 约定 |
| --- | --- | --- |
| url | string，必需 | HTTP(S) 绝对 URL 或以 `/` 开头的后端资源路径 |
| kScale / initialXshift / initialYshift | number，必需 | 有限数值；缩放和偏移按模型适配，不能作为字符串发送 |
| emotionMap | 字符串键到 number/string 的对象，必需 | 表情名到索引或标识的映射，空对象合法结构但不保证模型表现 |
| name / description / idleMotionGroupName | string，可选 | 显示信息、待机动作组 |
| defaultEmotion | number/string，可选 | 模型默认表情 |
| pointerInteractive / scrollToResize | boolean，可选 | 交互及滚轮缩放开关 |
| initialScale | number，可选 | 初始缩放 |
| tapMotions | 两层对象，可选 | 外层点击区域，内层动作标识到数值权重；运行语义需结合模型确认 |

前端收到会设置配置与自身 UID，提交待加载模型；非 http 开头的模型 URL 直接拼基础地址，然后把状态设 idle。**idle 不代表模型和纹理已经下载完成。** `client_uid` 用于群组标识，不是权限凭证；该事件不是历史创建响应。结构来源：[`ModelInfo`](../../src/renderer/src/context/live2d-config-context.tsx:35)。

### S08 config-switched

```json
{"type":"config-switched"}
```

无额外字段被读取。前端回 idle、提示切换成功，依次发送历史列表查询和新建历史。仅在目标角色已经提交后发，建议在完整模型配置事件之后发；建连初始化不要无故发它，否则会与默认初始化重复新建历史。

## 3. 对话、音频与状态（8 类）

### S09 full-text

```json
{"type":"full-text","text":"这段内容只更新字幕。"}
```

提供非空 `text: string`；前端只替换字幕，不追加聊天。空字符串因真值判断被忽略，不能用它清字幕。需要聊天可见文本时使用 S11 的展示文本；不要把完整累计回答反复塞入增量聊天通道。

### S10 user-input-transcription

```json
{"type":"user-input-transcription","text":"请告诉我今天的安排。"}
```

提供非空 `text: string`，用于语音识别结果；每次收到都会追加用户聊天，不做去重。不用于文字输入回显，也不适合不断发送临时 ASR 假设。空识别结果不发此事件。

### S11 audio

```json
{"type":"audio","audio":"","volumes":[],"slice_length":0,"display_text":{"text":"你好，我是角色A。","name":"角色A","avatar":"character-a.png"},"actions":{"expressions":[]},"forwarded":false}
```

上例为纯文字兼容事件，`audio` 为空字符串是有意选择，不是伪造音频样例。真实语音时替换为**一段完整 WAV 文件的裸 Base64**，不带 Data URL 前缀，不是 URL/MP3，也不是把同一个 WAV 任意切成字节片。

| 字段 | 类型与默认行为 | 实现要求 |
| --- | --- | --- |
| audio | string；缺失按空串 | 语音时为完整 WAV 裸 Base64；必须验证当前播放器可解码的实际 WAV 格式 |
| display_text | 对象；缺失按 null | 建议每段提供 text/name/avatar 字符串；text 是本段增量，前端直接拼接聊天 |
| volumes | number[]；缺失按 [] | 当前播放链没有用它驱动口型；采样定义未核实，不虚构 RMS 单位 |
| slice_length | number；缺失按 0 | 单位未核实；兼容占位可为 0，不解释为毫秒或样本数 |
| actions | 对象，可选 | expressions 为 string[] 或 number[]；pictures/sounds 为 string[] |
| forwarded | boolean；缺失按 false | 转发给群组时 true，抑制前端再次发播放开始提示，不承担授权职责 |

当前消费链只使用 expressions 的首项，pictures/sounds 未在此处理链消费。WAV 解码分析驱动口型。前端在 interrupted/listening 时会丢弃事件，必须先完成有效开始状态转换；语音播放还依赖模型就绪。消息到达顺序应等于文本/音频句序，TTS 并行生成也必须排队输出。

纯文字的展示文本也可能触发客户端 `audio-play-start`；空音频通常不会通过此事件更新字幕，若需要字幕另发 S09。聊天拼接不自动补空格，后端片段要保留必要标点和空格。来源：[`use-audio-task.ts`](../../src/renderer/src/hooks/utils/use-audio-task.ts:83)、[`websocket-handler.tsx`](../../src/renderer/src/services/websocket-handler.tsx:155)。

### S12 control

```json
{"type":"control","text":"conversation-chain-start"}
```

提供 `text: string`，只使用以下四种值：

| text | 前端效果 | 后端使用限制 |
| --- | --- | --- |
| start-mic | 尝试开启麦克风 | 仍受浏览器权限和安全上下文限制，不能保证成功 |
| stop-mic | 尝试停止麦克风 | 不等于取消服务端正在执行的 ASR/生成 |
| conversation-chain-start | 进入 thinking-speaking，清音频队列和累计回复 | 每轮开始一次，不要每个 token 发一次；先于本轮输出 |
| conversation-chain-end | 将结束操作排入音频队列；仍处于 thinking-speaking 时回 idle，并按设置自动开麦 | 在全部本轮输出之后发；不需要等客户端播放回执 |

未知控制值仅被警告，不是可扩展的通用命令通道。前端清队列不能取消已经启动的 Promise，旧异步完成仍可能影响新轮；不能宣称后端排序足以解决所有竞态。来源：[`websocket-handler.tsx`](../../src/renderer/src/services/websocket-handler.tsx:59)。

### S13 backend-synth-complete

```json
{"type":"backend-synth-complete"}
```

无额外字段被读取，设置前端合成完成标志；前端等待队列清空后发 `frontend-playback-complete`。建议最后一个输出事件发出后发一次；它不是轮次 ID 关联 ACK，也不是停止一切生成的命令。对无音频轮次是否仍发送可统一实现，但须测试空队列及 React 状态竞态。

### S14 conversation-chain-end

```json
{"type":"conversation-chain-end"}
```

这是独立类型，**不同于 S12 的 text 值**。前端只在收到时队列为空才尝试回 idle；不会排队等待，也不会执行 S12 中的自动开麦逻辑。不要默认两个结束事件双发。建议以 S12 结束控制为主路径，将该类型保留为经联调确认的兼容路径。

### S15 force-new-message

```json
{"type":"force-new-message"}
```

无额外字段被读取；设置下一段 AI 文本另起消息的标志，用于明确分段/说话人切换。不是结束事件，不提供文字内容。与音频队列异步执行可能交错；需要严格分段时应验证实际聊天结果，不能只看 WS 帧顺序。

### S16 interrupt-signal

```json
{"type":"interrupt-signal"}
```

调用本地中断并禁止回发服务端，用于授权的服务端/群组中断通知。当前本地中断函数仅在 thinking-speaking 生效；不要把它当任意状态的强制复位。服务端必须自己取消对应工作，不等通知到达后才释放资源。

## 4. 群组、错误与工具（4 类）

### S17 group-update

```json
{"type":"group-update","members":["client_a","client_b"],"is_owner":true}
```

提供 `members: string[]`、`is_owner: boolean`；前端替换成员和自身组主状态。退出/无组建议返回空数组和 false；是否组主对不同接收者分别计算，不能把同一个 true 广播给所有成员。组主转让、离线清理、成员数量上限为后端策略。

### S18 group-operation-result

```json
{"type":"group-operation-result","success":false,"message":"目标客户端不可加入当前群组。"}
```

提供 `success: boolean`、`message: string`，仅显示提示，不更新成员。增删操作后还需 S17 权威状态；成功时 true 并提供对应提示。不要向未授权调用者暴露目标所在私有群组信息。

### S19 error

```json
{"type":"error","message":"语音识别暂时不可用，请稍后重试。"}
```

提供可展示的 `message: string`，不泄露堆栈、密钥、路径或供应商原始响应。前端仅 toast，**不会通用地回 idle、回滚历史、恢复模型或清上传缓冲**。已开始的轮次错误还需有效收尾；切换/删除失败按请求手册补偿。可在新后端内部定义错误码和可重试性，但旧前端不消费它们，不能依赖其自动重试。

### S20 tool_call_status

```json
{
  "type":"tool_call_status",
  "tool_id":"tool_001",
  "tool_name":"browser",
  "name":"角色A",
  "status":"running",
  "content":"正在读取页面",
  "timestamp":"2026-09-17T08:00:00Z",
  "browser_view":{
    "debuggerFullscreenUrl":"https://browser.example.com/session/demo/fullscreen",
    "debuggerUrl":"https://browser.example.com/session/demo/view",
    "wsUrl":"wss://browser.example.com/session/demo/ws",
    "sessionId":"browser_session_001",
    "pages":[{"id":"page_001","url":"https://example.com/","faviconUrl":"https://example.com/favicon.ico","title":"示例页面","debuggerUrl":"https://browser.example.com/session/demo/page/page_001","debuggerFullscreenUrl":"https://browser.example.com/session/demo/page/page_001/fullscreen"}]
  }
}
```

- 提供非空字符串 `tool_id/tool_name` 及合法 `status`（running/completed/error）；宽泛接口中的 any 不是后端可任意输出的理由。`name/content/timestamp` 建议提供字符串，时间 ISO 8601；缺失内容按空串、时间按前端当前时间兜底。
- 同一次调用复用稳定 tool_id 推送运行与终态；前端按工具标识追加/更新记录，不能每次状态生成新 ID。同名工具并发必须不同 ID，终态不能回到 running。
- `browser_view` 可省略；提供时字段结构按示例，sessionId 可选、pages 可空。示例域名与路由**不是现有固定接口**，必须替换为实现方的授权查看服务。
- 只有工具 ID、名称、状态均通过前端真值检查后，browser_view 才会保存。普通工具不必提供浏览器视图；省略不等于清空以前视图，目前没有专用撤销事件。
- 页面和调试 WS 都需身份、归属、TTL 校验；工具完成不应留下永久可用调试入口。iframe 可访问不代表有权共享浏览器登录态。
- 来源：[`websocket-handler.tsx`](../../src/renderer/src/services/websocket-handler.tsx:266)、[`MessageEvent`](../../src/renderer/src/services/websocket-service.tsx:81)。

## 5. 建议完整时序：按消息顺序实现，不是旧后端实测

### 5.1 初始化和角色切换

1. WS 握手成功；客户端依次发送 fetch-backgrounds、fetch-configs、fetch-history-list、create-new-history，不等待前一个响应。
2. 后端建立用户/角色上下文，建议发送 set-model-and-conf；返回两个资源清单。
3. 历史列表响应必须排在 new-history-created 前；后者只对应客户端的创建请求。模型事件不触发额外新建。
4. 角色切换：客户端 switch-config → 后端准备目标并失效旧工作 → set-model-and-conf → config-switched → 客户端自动查询历史/新建 → 按第 3 步顺序响应。
5. 若角色失败，恢复原角色快照并发送 error，不发 config-switched；若新建失败，保留旧绑定且提示失败，不能发伪造的历史 UID。

### 5.2 一次纯文字对话（可直接拼装 JSON 样例）

| 顺序 | 方向 | 内容 | 说明 |
| --- | --- | --- | --- |
| 1 | 客户端 → 后端 | C08 text-input | 前端已显示用户消息 |
| 2 | 后端 → 客户端 | S12 control，text 为 conversation-chain-start | 进入本轮状态，清累计回复 |
| 3 | 后端 → 客户端 | S11 audio，audio 为空串，display_text 为第一段增量 | 聊天可见；可重复多段，不重复全文 |
| 4 | 客户端 → 后端 | C13 audio-play-start | 由执行队列触发，可能与后续服务端事件交错 |
| 5 | 后端 → 客户端 | S13 backend-synth-complete | 所有本轮增量已排出 |
| 6 | 后端 → 客户端 | S12 control，text 为 conversation-chain-end | 不等待客户端完成回执 |
| 7 | 客户端 → 后端 | C14 frontend-playback-complete | 弱观测，不能作为持久化唯一依据 |

步骤 5—7 是待联调建议，浏览器事件调度、模型缺失、空队列及旧 Promise 都可能影响回执时刻。纯文字不要求实际音频文件；需要字幕另发 S09。持久化结果在服务端生成结束/中断时确定，不以客户端“听完”作为数据库提交条件。

### 5.3 语音、主动发言、工具

- 语音：C09 多片 → C10 含截图 → 接受后 S12 开始 → ASR 非空结果 S10 → LLM/TTS → S11 逐句完整 WAV → S13 → S12 结束。ASR 为空/失败发适当提示并收尾，不回放上次音频。
- 主动发言：C11 → 权限/空闲/频率判断 → 接受才开始 → AI 输出与结束同文字；没有 S10 用户转录。
- 工具：本轮开始 → S20 running → 必要时附授权浏览器视图 → 同 tool_id 的 completed/error → 后续 AI 增量与正常收尾。取消后旧工具终态可在服务端留审计，不得写入新轮 UI。

### 5.4 中断、历史切换、失败恢复

- C12 到达立即失效旧轮，取消后台任务，过滤旧音频及旧结束。下一轮开始前不等待旧播放回执；已发旧消息无法撤回。
- C05 成功绑定目标后发 S05；不要以重新新建历史代替切换。失败时按请求手册恢复旧列表/消息；恢复消息会产生“加载成功”提示，这是旧前端补偿路径的 UI 限制。
- C06 删除失败先发 S06 false，必要时 S19，再补 S03 权威列表；当前历史置首，避免恢复列表误切历史。
- 模型、历史、新建等操作的失败需要各自补偿；S19 不是全局 reset。S12 结束只会将 thinking-speaking 恢复 idle，不会解决 loading。
- 已启动的生成失败：使供应商工作失效，决定保留已发送输出还是中断，然后在仍属于本轮的前提下发送错误与收尾；不能在新轮开始之后追补旧终态。

## 6. 最小验收与尚未确定的参数

验收应逐个重放 17 请求和 20 事件，另测空数组、类型错误、重复操作、断线、连续切角色/历史、删除失败、TTS 乱序、迟到回执、无模型播放、截图失败与工具取消。不能只检查 JSON 能解析。

仍待确认：输入语音采样率/声道/范围；输出 WAV 编码兼容范围；volumes/slice_length 的真实定义；收尾事件与 React 队列竞态；多用户认证与群组邀请策略。若要可靠多轮并发、重试、播放确认和恢复，需要前端增加轮次/请求/上传标识及错误回滚，不能仅靠后端内部 ID 实现。