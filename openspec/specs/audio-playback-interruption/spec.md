# 音频队列、中断与主动说话现状基线

## Purpose

记录 renderer 播放队列、会话控制、中断、主动说话与口型资源生命周期的现有行为。本文依据静态源码，SHALL 表示被记录的现状，不表示运行验收通过，也不要求保留风险行为。仅涉及本领域必要的通信入口，不扩展通用协议。

## Requirements

### Requirement: 串行队列与完成判定
系统 SHALL 在正常路径串行执行任务，成功后等待配置间隔；队列类默认间隔3000毫秒，音频单例使用20毫秒。异步任务拒绝会记录错误并继续推进，完成等待以100毫秒轮询任务状态。

#### Scenario: 正常播放顺序
- **WHEN** 多个音频任务依次入队且任务正常完成
- **THEN** 前一个任务完成并经过间隔后推进下一个任务，不把入队等同于已经播放。

#### Scenario: 清空正在运行的队列
- **WHEN** 清队列入口执行
- **THEN** 清除待执行列表、活动任务集合并重置运行标志，但不取消已启动的异步任务；完成判定不能作为资源已释放的证明。

证据：[`task-queue.ts`](../../../src/renderer/src/utils/task-queue.ts:14)。

### Requirement: 音频任务与模型依赖
系统 SHALL 在入队及开始处理时拒绝已中断状态的音频任务。显示文本会追加回复与历史；本入口仅在含音频数据时更新字幕，非转发音频的开始通知早于实际发声。

#### Scenario: 模型尚不可用
- **WHEN** 处理含音频任务但管理器或模型0不存在
- **THEN** 结束该任务而不播放音频，此前的文字更新可能已经发生；缺少口型处理器而模型存在时仍可播放但没有对应口型。

#### Scenario: 正常发声与结束
- **WHEN** 音频准备完成且播放条件允许
- **THEN** 使用WAV数据地址播放，只处理首个表情并尝试普通优先级说话动作；播放拒绝、自然结束及媒体错误进入清理，匹配当前引用后清引用并仅完成任务一次。

#### Scenario: 后端合成与前端队列均完成
- **WHEN** 队列等待结束、当前钩子仍挂载且后端合成完成标志为真
- **THEN** 停止声音与口型、发送前端播放完成通知并清除标志；初始后端完成标志为假。

证据：[`use-audio-task.ts`](../../../src/renderer/src/hooks/utils/use-audio-task.ts:85)、[`use-audio-task.ts`](../../../src/renderer/src/hooks/utils/use-audio-task.ts:149)、[`use-audio-task.ts`](../../../src/renderer/src/hooks/utils/use-audio-task.ts:229)、[`ai-state-context.tsx`](../../../src/renderer/src/context/ai-state-context.tsx:86)。

### Requirement: 中断与会话边界
系统 SHALL 只在思考说话状态执行中断：先停止声音与口型，再清队列并进入中断状态，按参数决定是否发送累计回复，随后清累计回复。停止声音入口暂停音频、清音源并重新加载，释放PCM、重置口型和清引用。

#### Scenario: 本地中断
- **WHEN** 思考说话时请求不发送信号的中断
- **THEN** 仍执行本地停止、清队列和状态转换；只有字幕恰好为英文思考占位文本时清空字幕，并不清除任意当前字幕。

#### Scenario: 会话开始与结束
- **WHEN** 收到会话开始或结束控制
- **THEN** 开始时进入思考说话、清队列与累计回复，但该分支不直接停止当前音频；结束操作排队执行，仅仍处于思考说话时按设置开麦并回空闲，否则保留状态。

证据：[`use-interrupt.ts`](../../../src/renderer/src/hooks/utils/use-interrupt.ts:16)、[`audio-manager.ts`](../../../src/renderer/src/utils/audio-manager.ts)、[`websocket-handler.tsx`](../../../src/renderer/src/services/websocket-handler.tsx:59)。

### Requirement: 主动说话与设置持久化
系统 SHALL 默认关闭自动主动说话和按钮触发，空闲阈值为5秒，并持久化主动说话设置。启用后在空闲状态建立一次性计时器，离开空闲或卸载时清理。

#### Scenario: 空闲触发或按钮触发
- **WHEN** 空闲计时到期，或非思考说话状态下点击已获设置允许的按钮
- **THEN** 先等待截图，再发送主动说话信号；自动入口携带实际空闲秒数，按钮入口携带负一。计时到期本身不周期重排，也不主动改变AI状态。

#### Scenario: 说话期间点击按钮
- **WHEN** 思考说话时点击同一按钮
- **THEN** 执行中断，并按中断后自动开麦开关启动麦克风；该开关不表示AI一开始说话就自动开麦。

#### Scenario: 保存或取消主动说话设置
- **WHEN** 用户编辑主动说话设置后保存或取消
- **THEN** 编辑保持在临时值中，保存更新提供者和快照，取消恢复并回写原快照；提供者配置变化同时同步临时值和快照。

证据：[`proactive-speak-context.tsx`](../../../src/renderer/src/context/proactive-speak-context.tsx:19)、[`use-trigger-speak.ts`](../../../src/renderer/src/hooks/utils/use-trigger-speak.ts:9)、[`use-footer.ts`](../../../src/renderer/src/hooks/footer/use-footer.ts:35)、[`use-agent-settings.ts`](../../../src/renderer/src/hooks/sidebar/setting/use-agent-settings.ts:12)。

## 静态风险与验证边界

- 任务同步调用位于异常保护外，同步抛错可能留下运行标志；清队列后旧任务仍可收尾并干扰新队列。
- 播放就绪回调只检查全局是否存在音频，不核对当前音频身份；无统一播放超时，初始化异常未统一释放已登记资源。停止入口不显式完成播放任务，自然结束清引用不等于立即释放PCM。
- 多处实例化播放钩子可能影响完成通知次数；未进行并发中断、连续会话或异常媒体运行验证。
- 主动说话回调身份变化可重启计时；截图拒绝缺少本地捕获，未提供自动重试保证。
- 音量切片及说话者标识参数未参与本播放实现；本文不据此推断其他入口行为。所有延迟均为源码配置，不是性能测量。