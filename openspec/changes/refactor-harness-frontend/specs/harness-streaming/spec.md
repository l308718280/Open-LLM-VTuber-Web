## ADDED Requirements

### Requirement: 单入口本次图文请求
系统 SHALL 通过一个可配置 HTTP(S) 地址以 POST JSON 发起生成并使用 fetch 读取 SSE；请求包含 version=1、随机 session_id、唯一 request_id、trigger、可选 text 与 images。trigger MUST 区分 user、manual-observation、auto-observation；user 至少有非空文字或图片，观察请求至少有屏幕图片。系统 MUST NOT 上传完整历史、系统提示词、记忆或工具定义，也不得维护旧 WebSocket 双栈。

#### Scenario: 普通与图片请求
- **WHEN** 用户提交文字、图文或明确的纯图片输入
- **THEN** 仅发送本次内容及标识；图片包含 source、mime_type 和 Data URL；无文字无图片时不发送。

#### Scenario: 观察请求
- **WHEN** 手动或自动观察发起生成
- **THEN** 使用同一地址和相应 trigger，附一张已授权屏幕图，不附摄像头图，不调用独立主动说话接口。

### Requirement: 会话归属与记忆边界
系统 SHALL 在页面生命周期内生成并复用安全随机会话 ID，首次请求由 accepted 事件确认同一 ID；刷新或保存不同服务地址时生成新会话。会话 ID MUST NOT 作为鉴权凭证；用户身份、跨会话长时记忆及工具权限由 Harness 负责。

#### Scenario: 首轮确认前取消
- **WHEN** 第一轮在 accepted 前被取消，随后继续向同一服务提交
- **THEN** 前端复用当前 session_id，使用新的 request_id，并拒绝已取消轮次的确认或内容。

#### Scenario: 服务地址变化
- **WHEN** 用户保存不同的有效生成地址
- **THEN** 取消旧轮、清临时对话、创建新会话，不向新服务迁移旧内容；刷新不恢复聊天正文。

### Requirement: 有序流事件与唯一终态
系统 SHALL 解析 event 类型与 JSON data，验证 version、session_id、request_id 和从1连续递增的 seq；accepted MUST 为首事件。支持 text-delta、受限 status、expression、motion、heartbeat、done 和 error；done 与 error 为互斥终态，同一轮只结算一次。

#### Scenario: 正常增量与去重
- **WHEN** accepted 后收到文字增量、重复序号及 done
- **THEN** 按递增序号追加到本轮唯一回复，忽略重复/较小序号，done 后不再更新该轮；不等待模型加载、音频或播放回执。

#### Scenario: 非法顺序或错配
- **WHEN** 当前流出现序号跳跃、错误会话 ID、非法 JSON 或 accepted 前的业务内容
- **THEN** 将当前请求标记协议失败并释放资源；其他 request_id 的迟到事件不影响当前轮。

#### Scenario: 可选事件及静默
- **WHEN** 收到未知可选事件，或自动观察在未输出文字时收到 outcome=silent 的 done
- **THEN** 未知事件消费有效序号后忽略；静默正常结束但不新增空回复、不清上一条字幕；非自动请求或已输出文字的 silent 判为协议错误。

### Requirement: 增量解码与有界缓冲
系统 SHALL 支持跨网络块 UTF-8 解码、CRLF/换行、空行组帧、多行 data、注释与连续多事件；单事件及未完成帧缓冲上限为1 MiB，累计回复上限为1 MiB。

#### Scenario: 任意分块
- **WHEN** 中文字符、事件行或空行边界被分割在多次网络读取中
- **THEN** 只在完整事件到齐后解析并更新一次，最终文字不丢失、不重复、不出现截断乱码。

#### Scenario: 超限或错误响应
- **WHEN** HTTP 非2xx、响应不是 text/event-stream，或帧/回复超过上限
- **THEN** 停止读流并报告安全错误，不将原始响应正文或堆栈直接展示。

### Requirement: 请求超时失败与重试
系统 SHALL 设置首事件30秒、事件空闲90秒及总时长10分钟上限；heartbeat 仅重置空闲计时。无终态断流、超时及网络错误 MUST 标记失败，保留部分回复且不得自动重放 POST。

#### Scenario: 流提前结束
- **WHEN** 已显示部分文字但网络在 done/error 前结束
- **THEN** 部分文字保留并标为失败，释放忙状态，用户可明确发起新 request_id 的重试。

#### Scenario: 长工具执行
- **WHEN** Harness 持续发送 heartbeat 但超过总时长上限
- **THEN** 总超时仍终止请求，不因心跳无限延长；busy 响应不触发自动重试。

### Requirement: 统一取消与过期隔离
系统 SHALL 用单一协调器管理准备锁、活动请求、取消控制器及 generation；取消、卸载和服务切换先使令牌失效再释放网络、读流、计时器与缓冲。Harness 集成契约 MUST 要求断开向模型及可取消工具传播、相同请求去重和同会话串行处理，但不得承诺撤销已有副作用。

#### Scenario: 取消后新轮开始
- **WHEN** 旧轮取消后新轮已开始，旧轮的截图、事件、错误或清理回调迟到
- **THEN** 丢弃旧结果并释放其资源，不追加文字、不覆盖字幕、不把新轮置为空闲。

#### Scenario: 后端未完成取消
- **WHEN** 本地已取消但工具可能继续执行
- **THEN** UI 仅声明停止本地等待，不声明工具已回滚；下一轮遭 busy 时提示而不密集重发。

### Requirement: 展示与部署安全边界
系统 MUST 仅展示白名单状态和本地表情/动作键，禁止执行服务端指令或打开任意 URL；不得记录或持久化聊天正文、图片、完整流事件、工具敏感数据及长效密钥。生产远端 MUST 使用 HTTPS，loopback 开发可使用 HTTP，并遵守浏览器混合内容限制。

#### Scenario: 不可信工具或展示内容
- **WHEN** 响应含未知动作键、远端资源地址、内部推理或额外工具参数
- **THEN** 不执行、不下载、不展示这些字段；文字作为不可信内容安全渲染，不执行 HTML 或脚本。

#### Scenario: 部署接入
- **WHEN** 浏览器或 Electron 接入 Harness
- **THEN** 验证匹配来源的 CORS/CSP 和短期身份/安全会话策略，不嵌入模型密钥，不以关闭安全校验解决连接问题。