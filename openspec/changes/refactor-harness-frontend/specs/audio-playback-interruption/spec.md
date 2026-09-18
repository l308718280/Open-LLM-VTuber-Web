## REMOVED Requirements

### Requirement: 串行队列与完成判定
**Reason**: 前端 SHALL 删除专属音频任务队列和播放完成轮询，不再以声音播放驱动回复生命周期。
**Migration**: 使用 harness-streaming 的事件序号与唯一终态结算轮次；仅在确认无其他用途时删除通用队列实现。

#### Scenario: 连续文字增量
- **WHEN** 接收多个有效文字事件及 done
- **THEN** 顺序直接更新文字并在终态结算，不等待播放队列或轮询音频完成。

### Requirement: 音频任务与模型依赖
**Reason**: 前端 SHALL 删除 WAV 播放、后端合成完成标志与播放开始和完成回执。
**Migration**: 文字由 harness-streaming 与 subtitle-settings 直接展示，可选模型事件由 live2d-interaction 独立处理。

#### Scenario: 模型不可用时完成回复
- **WHEN** 模型尚未加载或加载失败且收到文字流
- **THEN** 文字仍可完整显示并结束，不创建声音和口型对象，不发送播放回执。

### Requirement: 中断与会话边界
**Reason**: 原音频和 WebSocket 会话中断链 SHALL 被统一请求生命周期取代。
**Migration**: harness-streaming 负责准备和网络阶段取消、轮次隔离、计时器与读流清理；取消不上传累计回复，不宣称服务端工具副作用已回滚。

#### Scenario: 中断后迟到结果
- **WHEN** 用户停止或新输入替换活动轮次后旧抓帧、流或模型回调返回
- **THEN** 旧结果释放且不更新当前回复、字幕或状态，不恢复麦克风，不向后端发送旧 interrupt-signal。

### Requirement: 主动说话与设置持久化
**Reason**: 原空闲5秒主动说话及持久化启用状态SHALL 删除，避免未经当次明确授权的自动截图发送。
**Migration**: 迁移到 proactive-screen-observation 的手动观察与默认关闭自动观察，采用屏幕授权、冷却、变化过滤、用户优先和静默完成；停止入口使用 harness-streaming。

#### Scenario: 旧主动说话配置升级
- **WHEN** 用户携带旧主动说话开启配置加载新版
- **THEN** 自动观察保持关闭，不启动旧空闲计时，不发送 ai-speak-signal；只有当次明确开启且已有屏幕授权后才能自动观察。