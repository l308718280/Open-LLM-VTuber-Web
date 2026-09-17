# 后端依赖接口说明

## 1. 范围与约定

本文根据当前前端的实际发送代码、消息处理代码和类型声明整理，覆盖 WebSocket 业务通信及 HTTP 资源依赖。不是后端完整接口规范；后端额外字段、必填校验、错误码、鉴权和消息顺序仍需结合服务端确认。

- 入参：前端发送给后端的字段。出参：后端发送给前端且被前端使用的字段。
- 共确认 **17 种客户端发送消息、20 种服务端接收消息类型**。
- WebSocket 使用 JSON 文本消息，以 `type` 区分操作；不是每个操作一个 HTTP 路径。
- 请求和返回是异步消息，不存在代码层面的统一请求 ID 配对。下文对应关系按前端业务用途归纳，不保证一问一答或固定时序。
- 表中“无”表示除 `type` 外没有额外发送字段；“不读取额外字段”不代表后端绝对不会发送其他字段。
- `?` 表示前端类型声明中的可选字段，不代表后端的正式必填约束。

## 2. 连接入口与源码导航

| 内容 | 地址或行为 | 源码 |
| --- | --- | --- |
| WebSocket | 默认 ws://127.0.0.1:12393/client-ws | [`websocket-context.tsx`](../src/renderer/src/context/websocket-context.tsx:6) |
| HTTP 资源基础地址 | 默认 http://127.0.0.1:12393 | [`websocket-context.tsx`](../src/renderer/src/context/websocket-context.tsx:7) |
| 地址配置 | 可在设置中修改；WebSocket 地址和 HTTP 基础地址分别保存到本地存储 | [`websocket-handler.tsx`](../src/renderer/src/services/websocket-handler.tsx:28) |
| 建立连接 | 使用浏览器 WebSocket；当前构造调用只传 URL，没有显式传子协议或认证字段 | [`connect()`](../src/renderer/src/services/websocket-service.tsx:141) |
| 请求发送 | 对消息对象进行 JSON 序列化；仅在连接 OPEN 时发送，否则提示错误，不在此处排队 | [`sendMessage()`](../src/renderer/src/services/websocket-service.tsx:188) |
| 返回解析 | 将接收到的数据解析为 JSON，再通知订阅者 | [`websocket-service.tsx`](../src/renderer/src/services/websocket-service.tsx:158) |
| 返回分发 | 按消息类型执行对应处理逻辑 | [`handleWebSocketMessage()`](../src/renderer/src/services/websocket-handler.tsx:94) |
| 返回字段声明 | 集中声明大部分服务端消息字段 | [`MessageEvent`](../src/renderer/src/services/websocket-service.tsx:51) |

连接成功后自动依次发送：fetch-backgrounds、fetch-configs、fetch-history-list、create-new-history。重新建立连接也会执行此初始化逻辑，见 [`initializeConnection()`](../src/renderer/src/services/websocket-service.tsx:126)。

## 3. WebSocket 入参：前端 → 后端

所有消息均发往同一 WebSocket 地址。表中“其他入参”省略公共字段 `type`，该字段值就是对应消息类型。

| 功能 | 消息类型及发送位置 | 其他入参 | 相关出参消息／说明 |
| --- | --- | --- | --- |
| 获取背景列表 | [`fetch-backgrounds`](../src/renderer/src/services/websocket-service.tsx:127) | 无 | background-files |
| 获取角色配置列表 | [`fetch-configs`](../src/renderer/src/services/websocket-service.tsx:130) | 无 | config-files |
| 获取历史列表 | [`fetch-history-list`](../src/renderer/src/services/websocket-service.tsx:133) | 无 | history-list |
| 新建会话 | [`create-new-history`](../src/renderer/src/hooks/sidebar/use-sidebar.ts:21) | 无 | new-history-created |
| 读取并切换历史 | [`fetch-and-set-history`](../src/renderer/src/hooks/sidebar/use-history-drawer.ts:29) | history_uid: string，会话 ID | history-data |
| 删除历史 | [`delete-history`](../src/renderer/src/hooks/sidebar/use-history-drawer.ts:45) | history_uid: string，会话 ID | history-deleted；前端禁止删除当前会话 |
| 切换角色 | [`switch-config`](../src/renderer/src/hooks/utils/use-switch-character.tsx:31) | file: string，配置文件名 | config-switched、set-model-and-conf，具体顺序需后端确认 |
| 发送文字 | [`text-input`](../src/renderer/src/hooks/footer/use-text-input.tsx:32) | text: string，去除首尾空白的输入；images: ImageData[] | 对话相关的 audio、full-text、control 等异步消息，非固定单条返回 |
| 上传音频分片 | [`mic-audio-data`](../src/renderer/src/hooks/utils/use-send-audio.tsx:17) | audio: number[]，浮点采样数组，每片最多 4096 个采样点 | 当前前端未处理逐片 ACK |
| 音频上传结束 | [`mic-audio-end`](../src/renderer/src/hooks/utils/use-send-audio.tsx:26) | images: ImageData[] | user-input-transcription 及后续对话消息 |
| 触发 AI 说话 | [`ai-speak-signal`](../src/renderer/src/hooks/utils/use-trigger-speak.ts:12) | idle_time: number，空闲秒数；images: ImageData[] | 对话相关异步消息 |
| 中断回复 | [`interrupt-signal`](../src/renderer/src/hooks/utils/use-interrupt.ts:27) | text: string，前端已累计的回复文本 | 当前前端未处理专用 ACK；也可接收同名中断通知 |
| 通知开始播放 | [`audio-play-start`](../src/renderer/src/hooks/utils/use-audio-task.ts:93) | display_text: DisplayText；forwarded: boolean，固定发送 true | 有展示文本且收到的音频不是转发消息时发送；未处理专用 ACK |
| 通知播放完成 | [`frontend-playback-complete`](../src/renderer/src/hooks/utils/use-audio-task.ts:237) | 无 | 后端合成完成且前端音频队列结束后发送；未处理专用 ACK |
| 获取群组信息 | [`request-group-info`](../src/renderer/src/hooks/sidebar/use-group-drawer.tsx:14) | 无 | group-update |
| 邀请成员 | [`add-client-to-group`](../src/renderer/src/hooks/sidebar/use-group-drawer.tsx:29) | invitee_uid: string，被邀请客户端 ID | group-operation-result、group-update；前端随后还会查询群组 |
| 移除成员／退群 | [`remove-client-from-group`](../src/renderer/src/hooks/sidebar/use-group-drawer.tsx:40) | target_uid: string，目标客户端 ID；退群时传自己 | group-operation-result、group-update；前端随后还会查询群组 |

补充：音频上传的是浮点数数组，不是 Base64，也不是直接发送二进制帧。图片在音频结束消息中发送，**不在首个音频分片中发送**，以实际代码为准。上传消息未携带采样率字段，不能仅凭这段发送代码确定后端采样率要求。主动说话的空闲时间按秒计算，见 [`proactive-speak-context.tsx`](../src/renderer/src/context/proactive-speak-context.tsx:54)；手动触发时传 -1，见 [`use-footer.ts`](../src/renderer/src/hooks/footer/use-footer.ts:42)。

## 4. WebSocket 出参：后端 → 前端

所有消息含 `type: string`。以下列出前端实际读取的主要载荷；具体嵌套结构见第 5 节。字段在总类型声明中多为可选，不能把整份类型声明的所有字段都当作每条消息必填。

| 消息类型及处理位置 | 出参字段（不含 type） | 前端行为 |
| --- | --- | --- |
| [`background-files`](../src/renderer/src/services/websocket-handler.tsx:150) | files?: BackgroundFile[] | 更新可选背景列表 |
| [`config-files`](../src/renderer/src/services/websocket-handler.tsx:130) | configs?: ConfigFile[] | 更新角色配置列表 |
| [`history-list`](../src/renderer/src/services/websocket-handler.tsx:209) | histories?: HistoryInfo[] | 更新历史列表；非空时将第一项设为当前会话 |
| [`new-history-created`](../src/renderer/src/services/websocket-handler.tsx:180) | history_uid?: string | 设置新会话 ID、清空消息，并把新会话加入列表 |
| [`history-data`](../src/renderer/src/services/websocket-handler.tsx:170) | messages?: Message[] | 替换当前聊天消息 |
| [`history-deleted`](../src/renderer/src/services/websocket-handler.tsx:200) | success?: boolean | 展示删除成功或失败提示 |
| [`set-model-and-conf`](../src/renderer/src/services/websocket-handler.tsx:102) | model_info?: ModelInfo；conf_name?: string；conf_uid?: string；client_uid?: string | 设置模型、角色配置及自身客户端 ID；相对模型 URL 补 HTTP 基础地址 |
| [`config-switched`](../src/renderer/src/services/websocket-handler.tsx:135) | 不读取额外字段 | 显示角色切换成功，并重新获取历史列表、新建会话 |
| [`full-text`](../src/renderer/src/services/websocket-handler.tsx:125) | text?: string | 更新字幕；此分支不直接追加聊天记录 |
| [`user-input-transcription`](../src/renderer/src/services/websocket-handler.tsx:217) | text?: string | 将语音识别结果追加为用户消息 |
| [`audio`](../src/renderer/src/services/websocket-handler.tsx:155) | audio?: string；volumes?: number[]；slice_length?: number；display_text?: DisplayText；actions?: Actions；forwarded?: boolean | 加入语音播放队列，驱动字幕、聊天记录和表情；中断或监听状态下拦截 |
| [`group-update`](../src/renderer/src/services/websocket-handler.tsx:230) | members?: string[]；is_owner?: boolean | 更新成员 ID 列表及当前客户端是否群主 |
| [`group-operation-result`](../src/renderer/src/services/websocket-handler.tsx:239) | success?: boolean；message?: string | 显示群组操作结果 |
| [`error`](../src/renderer/src/services/websocket-handler.tsx:223) | message?: string | 显示错误提示；此处未读取统一数字错误码 |
| [`control`](../src/renderer/src/services/websocket-handler.tsx:97) | text?: string，控制指令 | 开关麦克风或更新对话状态，详见第 5 节 |
| [`backend-synth-complete`](../src/renderer/src/services/websocket-handler.tsx:246) | 不读取额外字段 | 标记后端语音合成完成，等待前端队列结束后反馈播放完成 |
| [`conversation-chain-end`](../src/renderer/src/services/websocket-handler.tsx:249) | 不读取额外字段 | 队列无任务时，将思考／说话状态改为空闲 |
| [`force-new-message`](../src/renderer/src/services/websocket-handler.tsx:259) | 不读取额外字段 | 下一段回复另起一条消息 |
| [`interrupt-signal`](../src/renderer/src/services/websocket-handler.tsx:262) | 不读取额外字段 | 中断本地播放，不再把中断信号回发后端 |
| [`tool_call_status`](../src/renderer/src/services/websocket-handler.tsx:266) | tool_id、tool_name、name、status、content、timestamp；browser_view? | 更新工具执行状态和可选浏览器会话信息，详见第 5 节 |

## 5. 嵌套数据结构

以下字段约束来自前端类型，而非后端校验规则。

| 对象及定义位置 | 字段与类型 |
| --- | --- |
| [`ImageData`](../src/renderer/src/hooks/utils/use-media-capture.tsx:22) | source: camera 或 screen；data: string，含 data:image/jpeg;base64, 前缀的 JPEG Data URL；mime_type: string，当前为 image/jpeg。无画面时 images 为空数组 |
| [`DisplayText`](../src/renderer/src/services/websocket-service.tsx:10) | text: string；name: string；avatar: string |
| [`BackgroundFile`](../src/renderer/src/services/websocket-service.tsx:16) | name: string；url: string |
| [`ConfigFile`](../src/renderer/src/context/character-config-context.tsx:9) | filename: string，配置文件名；name: string，展示名称 |
| [`HistoryInfo`](../src/renderer/src/context/websocket-context.tsx:9) | uid: string；latest_message: 最近消息对象或 null；timestamp: string 或 null |
| [`HistoryInfo.latest_message`](../src/renderer/src/context/websocket-context.tsx:11) | role: human 或 ai；timestamp: string；content: string |
| [`Message`](../src/renderer/src/services/websocket-service.tsx:30) | id、content、timestamp: string；role: ai 或 human；name、avatar、tool_id、tool_name: 可选 string；type: 可选 text 或 tool_call_status；status: 可选 running、completed 或 error |
| [`Actions`](../src/renderer/src/services/websocket-service.tsx:45) | expressions?: 字符串数组或数字数组；pictures?: string[]；sounds?: string[]。当前音频接收分支仅使用 expressions |

### 音频输出

[`AudioPayload`](../src/renderer/src/services/websocket-service.tsx:21) 的音频为裸 Base64；前端拼接 data:audio/wav;base64, 播放。接收分支对缺失值采用以下默认值：audio 为空字符串、volumes 为空数组、slice_length 为 0、display_text 为 null、表情为 null、forwarded 为 false。slice_length 的具体单位需后端确认。播放处理见 [`use-audio-task.ts`](../src/renderer/src/hooks/utils/use-audio-task.ts:103)。

### 模型信息

定义：[`ModelInfo`](../src/renderer/src/context/live2d-config-context.tsx:35)。

| 字段 | 类型 | 前端声明 |
| --- | --- | --- |
| url | string，模型配置地址 | 必需 |
| kScale | number，缩放系数 | 必需 |
| initialXshift、initialYshift | number，初始偏移 | 必需 |
| emotionMap | 字符串键映射 number 或 string | 必需 |
| name、description、idleMotionGroupName | string | 可选 |
| defaultEmotion | number 或 string | 可选 |
| pointerInteractive、scrollToResize | boolean | 可选 |
| initialScale | number | 可选 |
| tapMotions | 两层映射对象；外层字符串键映射动作权重对象，内层字符串键对应 number | 可选 |

### 控制指令

[`handleControlMessage()`](../src/renderer/src/services/websocket-handler.tsx:59) 处理 control 消息的 text 字段：

| 值 | 行为 |
| --- | --- |
| start-mic | 开启麦克风 |
| stop-mic | 关闭麦克风 |
| conversation-chain-start | 进入思考／说话状态，清空音频队列和累计回复 |
| conversation-chain-end | 将结束处理加入音频队列，在适用状态下恢复空闲，并按设置自动开启麦克风 |

注意：control 的结束指令与独立的 conversation-chain-end 消息类型均存在，处理逻辑不同，不能合并为一种载荷。

### 工具调用与浏览器会话

[`MessageEvent`](../src/renderer/src/services/websocket-service.tsx:51) 中 tool_id、tool_name、name、status 声明为 any，不能据此确定后端正式类型。前端要求 tool_id、tool_name、status 为真值才处理；状态按 running、completed、error 使用。content 为 string，缺省空字符串；timestamp 为 string，缺省当前 ISO 时间。

[`browser_view`](../src/renderer/src/services/websocket-service.tsx:81) 为可选对象：

- debuggerFullscreenUrl、debuggerUrl、wsUrl：string。
- sessionId：可选 string。
- pages：页面对象数组，每项包含 id、url、faviconUrl、title、debuggerUrl、debuggerFullscreenUrl，均为 string。

这些地址由后端动态下发，不能据此推导固定 REST 路由。总消息声明不是按 type 区分的严格联合类型；不能把其全部字段当作每条消息必填。声明中还有 uids、live2d_model，但当前分发器未消费。

## 6. HTTP 资源接口

当前未发现与上述会话、角色、群组功能对应的常规 JSON REST 增删改查调用。HTTP 主要加载资源；以下请求均为 GET，无请求体，入参体现在 URL 和路径中，出参不是统一 JSON 业务响应包。绝对 URL 也可能指向外部资源服务。

| 资源 | URL／入参来源 | 出参 | 源码 |
| --- | --- | --- | --- |
| 默认背景 | HTTP 基础地址 + /bg/ceiling-window-room-night.jpeg | JPEG 图片 | [`bgurl-context.tsx`](../src/renderer/src/context/bgurl-context.tsx:45) |
| 可选／自定义背景 | 背景清单中的 URL 或用户输入；以 http 开头直接使用，否则拼接 HTTP 基础地址 | 图片资源 | [`use-general-settings.ts`](../src/renderer/src/hooks/sidebar/setting/use-general-settings.ts:118) |
| 聊天头像 | HTTP 基础地址 + /avatars/ + 消息中的 avatar | 头像图片 | [`chat-history-panel.tsx`](../src/renderer/src/components/sidebar/chat-history-panel.tsx:118) |
| Live2D 主配置 | model_info.url，非 http 开头则补 HTTP 基础地址 | 模型配置，通常为 model3.json，读取字节后由 SDK 解析 | [`websocket-handler.tsx`](../src/renderer/src/services/websocket-handler.tsx:117)、[`lappmodel.ts`](../src/renderer/WebSDK/src/lappmodel.ts:87) |
| 模型二进制 | 模型目录拼接配置中的模型文件名 | 模型二进制字节 | [`lappmodel.ts`](../src/renderer/WebSDK/src/lappmodel.ts:127)、[`lappmodel.ts`](../src/renderer/WebSDK/src/lappmodel.ts:1043) |
| 表情 | 模型目录拼接配置中的表情文件名 | 表情配置资源 | [`lappmodel.ts`](../src/renderer/WebSDK/src/lappmodel.ts:161) |
| 物理 | 模型目录拼接配置中的物理文件名 | 物理配置资源 | [`lappmodel.ts`](../src/renderer/WebSDK/src/lappmodel.ts:213) |
| 姿态 | 模型目录拼接配置中的姿态文件名 | 姿态配置资源 | [`lappmodel.ts`](../src/renderer/WebSDK/src/lappmodel.ts:246) |
| 用户数据 | 模型目录拼接配置中的用户数据文件名 | 用户数据资源 | [`lappmodel.ts`](../src/renderer/WebSDK/src/lappmodel.ts:326) |
| 动作 | 模型目录拼接配置中的动作文件名 | 动作配置资源 | [`lappmodel.ts`](../src/renderer/WebSDK/src/lappmodel.ts:679)、[`lappmodel.ts`](../src/renderer/WebSDK/src/lappmodel.ts:918) |
| 纹理 | SDK 传入图片地址，以浏览器图片对象加载 | 纹理图片 | [`lapptexturemanager.ts`](../src/renderer/WebSDK/src/lapptexturemanager.ts:76) |
| SDK 通用资源 | 动态 filePath，不代表固定业务路由 | 资源字节 | [`lapppal.ts`](../src/renderer/WebSDK/src/lapppal.ts:30) |
| SDK WAV 资源 | 动态 filePath，是否加载取决于调用和模型配置 | WAV 音频字节 | [`lappwavfilehandler.ts`](../src/renderer/WebSDK/src/lappwavfilehandler.ts:115) |

注意：

- 背景清单通过 WebSocket 获取，图片本身通过 HTTP 获取。
- 模型关联文件取决于配置，可选资源不一定发起请求；上述 SDK 加载点不是固定业务路由。
- 相对背景和模型地址使用直接字符串拼接，需确保基础地址与相对路径的斜杠衔接正确。
- 纹理图片设置匿名跨域加载；外部资源服务需配合浏览器跨域规则。
- 对话语音由 WebSocket 下发 Base64，不依赖固定 TTS 下载路由；SDK WAV 加载属于另一条资源路径。
- 资源的实际 Content-Type、缓存、404 响应和鉴权方式需后端确认。

## 7. 交互流程与待确认事项

### 典型流程

1. 连接成功后请求背景、角色配置、历史列表和新会话；服务端异步返回相关清单及配置。
2. 切换角色时发送配置文件名；切换成功通知会触发刷新历史并新建会话；模型地址通过 HTTP 继续加载资源。
3. 文字输入附带图片；语音先上传多个采样数组分片，再发送结束消息及图片，语音识别结果另行返回。
4. 对话过程中服务端推送控制、字幕、音频和工具状态，前端排队播放；适用时通知开始播放。
5. 后端合成完成且前端播放队列结束后，前端通知播放完成。对话结束控制与独立结束事件分别处理状态。

### 实现细节

- 删除历史后前端立即移除本地列表项，不等待成功响应；对接时需关注失败后的列表一致性，见 [`use-history-drawer.ts`](../src/renderer/src/hooks/sidebar/use-history-drawer.ts:45)。
- 邀请、移除及退出群组后，前端约 100 ms 后再次查询群组；不代表后端承诺在此时间内完成操作，见 [`use-group-drawer.tsx`](../src/renderer/src/hooks/sidebar/use-group-drawer.tsx:35)。
- 中断仅在思考／说话状态生效；收到后端转发中断时只执行本地中断、不再回发，见 [`use-interrupt.ts`](../src/renderer/src/hooks/utils/use-interrupt.ts:27)、[`websocket-handler.tsx`](../src/renderer/src/services/websocket-handler.tsx:262)。

### 仍需后端确认

- 鉴权、权限、会话隔离及客户端 ID 有效期。
- 消息正式必填字段、空值约定、错误码和异常响应。
- 音频采样率、声道、采样值范围、切片长度单位及最大载荷。
- 图片数量、尺寸、格式限制和消息体大小上限。
- 请求关联、并发顺序、超时、重试、幂等及断线恢复。
- HTTP 资源目录、跨域、HTTPS/WSS、缓存及访问权限。

本文依据前端源码整理，未进行后端抓包或联调；本次仅修改文档，未执行应用构建或自动化测试。

