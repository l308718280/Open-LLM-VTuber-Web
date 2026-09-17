# 协议兼容与消息处理

## 1. 传输边界

保持默认 WS 路径 /client-ws 和可配置 HTTP 基础地址。默认端口 12393 是前端默认值，不是 Java 服务强制约束；端口改变后应同步修改前端设置或由代理提供兼容地址。

输入输出均为 JSON 文本消息，业务载荷在顶层，不增加统一 data 包装，不改为 STOMP、SSE 或二进制音频帧。详细字段和来源见 [`backend.md`](../backend.md)。

Java 建议先解析消息判别字段，再路由到各自 DTO：只接受白名单类型，限制 JSON 深度、字符串及数组长度，关闭不安全的任意多态类型实例化。兼容新增的无害字段，但严格校验本类型必须使用的字段。布尔值不能输出为字符串，标识保持字符串，时间统一 ISO 8601。

当前同时存在下划线和驼峰字段，尤其浏览器会话和模型配置。建议逐 DTO 显式映射，不启用影响所有对象的盲目命名转换。清单为空时输出空数组；不要省略导致前端保留旧状态。

## 2. 17 类入站消息的实现矩阵

表中消息名对应完整定义见 [`入参清单`](../backend.md:29)。处理策略为建议。

| 入站类型 | 处理和响应 | 必须考虑 |
| --- | --- | --- |
| fetch-backgrounds | 返回 background-files | 只列可公开访问的资源，空列表可用 |
| fetch-configs | 返回 config-files | 返回注册配置别名及显示名，不暴露磁盘绝对路径 |
| fetch-history-list | 按身份和当前角色返回 history-list | 返回时第一项会被前端设为当前会话，见下文 |
| create-new-history | 建立并绑定会话，返回 new-history-created | 在相邻历史列表响应之后发出，确保上下文与 UI 一致 |
| fetch-and-set-history | 校验归属，切换上下文，返回 history-data | 返回消息按服务端序号排序，先处理活跃轮次 |
| delete-history | 校验归属和当前使用情况，返回 history-deleted | 前端先删本地列表；失败时需要纠正列表 |
| switch-config | 按注册别名切换，发 set-model-and-conf、config-switched | 不直接读取任意 file 路径，后续请求必须使用新角色 |
| text-input | 校验文字与图片，绑定当前会话，启动一轮 | 前端已追加用户消息，不再用转录消息回显同一文字 |
| mic-audio-data | 接收并累积浮点样本数组 | 每片最多 4096 样本；不逐片 ACK，限制累积大小 |
| mic-audio-end | 封存本段音频及图片，ASR 后启动对话 | 转录成功用 user-input-transcription 回显一次 |
| ai-speak-signal | 按角色策略主动生成 | 空闲秒数为提示，-1 为手动触发；忙时丢弃自动触发，设冷却 |
| interrupt-signal | 取消当前轮次、清理旧输出 | text 是客户端累计展示文本，不是可信精确已听片段 |
| audio-play-start | 记录播放开始提示或处理群组转发 | 没有音频 ID；forwarded 为 true 也不能当作权限证明 |
| frontend-playback-complete | 更新等待播放状态，幂等处理 | 无轮次 ID，不能凭它完成或终止任意新轮次 |
| request-group-info | 返回 group-update | 未组队时建议返回仅自身的成员列表、非群主 |
| add-client-to-group | 校验邀请权限、在线目标及加入政策，返回结果并广播成员 | 禁止仅凭猜到连接 ID 加入他人会话 |
| remove-client-from-group | 自己退群或群主移除成员，返回结果并广播成员 | 退出、断线、群主离开都需确定规则 |

若群组等可选功能尚未实现，应返回明确失败结果；查询仍返回可解释状态，不伪造成功。音频结束没有有效样本、字段错误、配置不存在等返回错误，并在该请求已改变对话状态时执行相应收尾。

## 3. 20 类出站消息的覆盖范围

以下集合应全部进入兼容测试：background-files、config-files、history-list、new-history-created、history-data、history-deleted、set-model-and-conf、config-switched、full-text、user-input-transcription、audio、group-update、group-operation-result、error、control、backend-synth-complete、conversation-chain-end、force-new-message、interrupt-signal、tool_call_status。

结构和前端动作见 [`出参清单`](../backend.md:55)，核心差异如下：

- full-text 只更新字幕。聊天记录由 audio 的展示文本追加，即使没有实际音频也应走这条展示路径。
- audio 的展示文本应为本段增量，不重复发送整篇累计文本，否则聊天气泡会不断拼接重复内容。依据：[`chat-history-context.tsx`](../../src/renderer/src/context/chat-history-context.tsx:83)。
- 没有音频时可发送空音频字符串和完整展示文本，适用于纯文字 MVP 或 TTS 失败降级；这仍可能触发播放开始提示，不能按字面理解为真的发声。
- 同一回复连续分段时不反复发 force-new-message。需要主动说话另起回复、切换发言人等明确边界时才发送；前端状态批处理下的效果需实际验证。
- control 的开始指令会清空队列，因此每轮在首段之前发一次，不得每句重发。
- control 的结束指令进入播放队列，独立 conversation-chain-end 只检查队列是否空，不能互相替代或无条件双发。具体收尾见 [`03-session-lifecycle.md`](03-session-lifecycle.md)。
- error 只显示提示，不自动结束轮次；tool_call_status 必须带非空工具 ID、名称和有效状态。

## 4. 历史与角色兼容陷阱

历史列表不是纯查询结果：前端会把第一项设为当前历史。建议连接内保持响应顺序，初始化先返回列表，再返回新建结果；平时主动刷新列表时把当前历史放首项，并确保服务端上下文同步。不要晚到一份旧列表覆盖刚新建或切换的会话。

前端删除失败不会自行恢复列表。建议失败后返回纠正列表，仍把当前历史放第一项；不要为其他连接广播带有不同当前历史顺序的同一列表。成功删除也要检查其他连接是否仍使用该历史，选择拒绝或通知切换，不让活跃轮次写入已删除记录。

切换角色成功通知会让前端再次请求列表和新建历史；后端不要因为“切换成功”自己再额外新建一份并通知一次。连接建立时可推送默认角色和模型信息，但应先确定服务端上下文再处理初始化请求。

## 5. 兼容模式与后续协议升级

兼容模式无法做到严格消息幂等：新建历史没有幂等键，相同文字也可能是用户有意重复。不要按内容哈希永久去重；对重复结束或关闭执行幂等清理，并限制同时在途命令。

建议后续协同前端增加请求标识、轮次标识、段落序号、音频采样参数、播放回执关联、能力协商、恢复游标及明确错误类别。新增字段可供日志使用，但未升级的前端不会消费或回传；不能仅靠服务端添加字段就声称实现严格重连恢复。保留旧入口或显式版本协商，禁止悄悄改变原字段语义。