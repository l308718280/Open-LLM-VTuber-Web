# 字幕与相关设置现状基线

## Purpose

记录 renderer 字幕显示、更新来源及设置生效和回滚边界。SHALL 表示静态现状，不表示运行验收通过；不扩展为通用通信协议或桌面窗口管理，不要求保留列出的风险。

## Requirements

### Requirement: 字幕默认值与显示条件
系统 SHALL 在字幕提供者初始化时使用硬编码英文介绍文本，默认显示；文本与显示开关使用普通组件状态，提供者本身不持久化这些值。字幕显示钩子的已加载标记来自上下文是否存在，而非模型资源加载状态。

#### Scenario: 正常显示或隐藏
- **WHEN** 字幕组件获取有效上下文
- **THEN** 文本非空、显示开关开启且显示钩子的已加载标记为真时渲染；任一条件不满足则不渲染，不以模型加载完成作为此入口的前提。

#### Scenario: 缺少字幕提供者
- **WHEN** 在提供者之外调用字幕上下文钩子
- **THEN** 抛出异常，而不是通过已加载标记静默隐藏字幕。

证据：[`subtitle-context.tsx`](../../../src/renderer/src/context/subtitle-context.tsx:26)、[`subtitle-context.tsx`](../../../src/renderer/src/context/subtitle-context.tsx:70)、[`use-subtitle-display.ts`](../../../src/renderer/src/hooks/canvas/use-subtitle-display.ts:4)、[`subtitle.tsx`](../../../src/renderer/src/components/canvas/subtitle.tsx:22)。

### Requirement: 字幕更新来源
系统 SHALL 接受独立全文消息、音频任务显示文本以及会话和语音检测提示等更新，不将字幕更新等同于声音实际播放。

#### Scenario: 全文或音频显示文本
- **WHEN** 收到非空全文消息，或音频任务包含显示文本和音频数据
- **THEN** 对应入口更新字幕；空全文消息不清旧字幕。音频任务有显示文本但无音频数据时，此入口不更新字幕，但仍可能更新回复和历史；独立全文入口不要求附带音频。

#### Scenario: 提示与中断
- **WHEN** 发生语音误触发、角色切换成功、新会话提示或有效中断
- **THEN** 提示入口可覆盖字幕；中断仅在当前文本精确等于英文思考提示时清空，不统一清除其他字幕。音频文本更新不证明后续模型可用或播放成功。

证据：[`websocket-handler.tsx`](../../../src/renderer/src/services/websocket-handler.tsx:125)、[`websocket-handler.tsx`](../../../src/renderer/src/services/websocket-handler.tsx:180)、[`use-audio-task.ts`](../../../src/renderer/src/hooks/utils/use-audio-task.ts:85)、[`vad-context.tsx`](../../../src/renderer/src/context/vad-context.tsx:251)、[`use-interrupt.ts`](../../../src/renderer/src/hooks/utils/use-interrupt.ts:16)。

### Requirement: 通用设置即时应用与快照
系统 SHALL 根据当前上下文初始化通用设置与快照；设置对象变化时即时回写字幕开关、背景、连接地址、语言及截图存储，保存不是唯一生效点。字幕UI开关直接修改字幕上下文，不同时更新通用设置对象中的字幕字段。

#### Scenario: 保存或取消通用设置
- **WHEN** 调用通用设置保存或取消回调
- **THEN** 保存仅更新快照；取消恢复设置对象，并直接恢复字幕、背景、地址、角色名及背景摄像头状态。语言与截图设置由恢复后的设置副作用应用，背景摄像头恢复启动不等待，也无本地拒绝捕获。

#### Scenario: 设置窗口关闭入口
- **WHEN** 点击保存、取消、叉号或触发抽屉通用关闭
- **THEN** 保存先调用已注册保存处理器再关闭；取消按钮和叉号调用取消处理器后关闭；抽屉通用关闭仅调用关闭回调，不能概括为所有关闭入口都执行回滚。

证据：[`general.tsx`](../../../src/renderer/src/components/sidebar/setting/general.tsx:96)、[`use-general-settings.ts`](../../../src/renderer/src/hooks/sidebar/setting/use-general-settings.ts:95)、[`use-general-settings.ts`](../../../src/renderer/src/hooks/sidebar/setting/use-general-settings.ts:185)、[`setting-ui.tsx`](../../../src/renderer/src/components/sidebar/setting/setting-ui.tsx:38)、[`setting-ui.tsx`](../../../src/renderer/src/components/sidebar/setting/setting-ui.tsx:98)。

### Requirement: 共享本地存储异常边界
系统 SHALL 在使用共享本地存储钩子的设置中对读取或JSON解析失败采用默认值；写入时先计算过滤值、更新未过滤的内存状态，再持久化过滤后的值，写入失败仅记录日志。此约定不自动适用于直接调用本地存储的通用设置代码，也不表示字幕提供者采用了该钩子。

#### Scenario: 持久化失败或过滤
- **WHEN** 共享存储钩子的写入失败或启用持久化过滤
- **THEN** 内存状态可能与磁盘不同，过滤不直接改变内存；未定义值写入不等价于删除键，函数式更新基于钩子闭包中的值，且没有跨标签页存储事件同步。

证据：[`use-local-storage.ts`](../../../src/renderer/src/hooks/utils/use-local-storage.ts:10)。

## 静态风险与验证边界

- 字幕开关同时存在上下文状态与通用设置快照，UI只修改前者；后续设置副作用可能将旧字段写回，未复现可见闪回或取消结果。
- 通用设置保存和取消注册副作用仅依赖注册函数，未完整依赖回调；注册函数稳定，存在旧闭包风险。角色名变化还能更新设置及快照，不能保证快照始终代表打开窗口时的值。
- 通用设置初始化和截图设置写入直接访问本地存储，无本地异常保护；语言变更未等待，不保证保存或取消时异步工作已经完成。
- 已注册设置处理器顺序调用，未见事务回滚；不同页签即时应用与暂存策略不同，不能把全部设置概括为仅保存生效。
- 未执行字幕刷新恢复、连续消息覆盖、设置多次打开、叉号与遮罩关闭、存储禁用或异步背景恢复测试。