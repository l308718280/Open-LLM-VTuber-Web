## REMOVED Requirements

### Requirement: 默认配置与持久化
**Reason**: 本轮 SHALL 删除麦克风与 VAD 能力，不再初始化阈值、检测器模型或自动开关。
**Migration**: 删除专属设置和构建资源，旧语音存储按 minimal-companion-shell 白名单迁移策略处理，不清空无关偏好；未来端到端音视频另行设计。

#### Scenario: 携带旧语音配置启动
- **WHEN** 新版启动且存在旧 VAD 或自动开麦设置
- **THEN** 不初始化检测器、不申请麦克风、不加载 VAD 或 ONNX 语音资源。

### Requirement: 语音检测状态转换
**Reason**: 前端 SHALL 删除初步检测、确认语音、误触发与语音结束状态链。
**Migration**: 请求状态迁移至 harness-streaming；编辑抑制由 text-input 管理，不以语音状态控制字幕。

#### Scenario: 普通输入与回复
- **WHEN** 用户提交图文并接收流式回复
- **THEN** 不进入聆听或误触发状态，不读取语音概率，不写入 VAD 字幕占位。

### Requirement: 麦克风启动停止与设置应用
**Reason**: 本轮 SHALL 移除麦克风控制、ASR 设置及自动启停选项。
**Migration**: 设置面板只保留轻量壳层偏好和明确媒体操作；摄像头及屏幕视频采集不请求音频。

#### Scenario: 设置或轮次生命周期变化
- **WHEN** 打开、保存或取消设置，或生成开始、结束及取消
- **THEN** 不调用麦克风启动停止、不重新初始化检测器，不出现 ASR 设置入口。

### Requirement: 音频分块与结束附图
**Reason**: 新协议 SHALL 不发送音频分块和音频结束消息。
**Migration**: 本次图片按 media-capture 准备后随 harness-streaming 的单 POST 图文请求发送，未来音频协议不包含在本变更中。

#### Scenario: 带图提交
- **WHEN** 用户提交已授权图片
- **THEN** 只发送本次图文 JSON，不发送4096样本音频数组、音频结束消息或语音附图补发。