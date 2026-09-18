# 语音输入与 VAD 现状基线

## Purpose

记录 renderer 麦克风、语音检测、音频发送和 ASR 设置的现有行为，作为后续变更的比较基线。本文基于静态源码核验，SHALL 仅表示本基线要求描述的现状，不表示已通过运行验收。风险单列，不要求保留缺陷；不扩展通用通信协议或窗口管理。

## Requirements

### Requirement: 默认配置与持久化
系统 SHALL 在无有效本地配置时使用正阈值50、负阈值35、结束帧35，麦克风及三个自动开关默认关闭。检测器使用模型v5、预填20帧、本地资源目录，正负阈值除以100传入。

#### Scenario: 首次初始化
- **WHEN** 无有效持久化设置
- **THEN** 使用上述默认配置，而非默认启动麦克风；检测器阈值为0.5和0.35。

#### Scenario: 本地存储异常
- **WHEN** 读取或解析存储失败
- **THEN** 返回默认值；写入失败只记录日志，内存修改可能已经生效，不保证刷新后保留。

证据：[`vad-context.tsx`](../../../src/renderer/src/context/vad-context.tsx:81)、[`vad-context.tsx`](../../../src/renderer/src/context/vad-context.tsx:265)、[`use-local-storage.ts`](../../../src/renderer/src/hooks/utils/use-local-storage.ts:10)。

### Requirement: 语音检测状态转换
系统 SHALL 区分初步检测、确认语音、正常结束与误触发；概率显示保存检测期间的历史最大值，而不是直接显示每帧原始值。

#### Scenario: 确认真实语音
- **WHEN** 初步检测后确认语音开始
- **THEN** 若保存的先前状态为思考说话，则尝试中断，然后进入聆听；初步检测本身只保存先前状态并标记处理中。

#### Scenario: 正常结束
- **WHEN** 正在处理语音并收到结束回调
- **THEN** 清队列、按自动停麦开关停麦、清概率，调用但不等待音频发送，清处理中标志并立即进入思考说话；此状态不证明发送成功。

#### Scenario: 误触发
- **WHEN** 检测器报告误触发
- **THEN** 清处理标志和概率、恢复先前状态，并将本地化误触发提示写入字幕。

证据：[`vad-context.tsx`](../../../src/renderer/src/context/vad-context.tsx:197)。

### Requirement: 麦克风启动停止与设置应用
系统 SHALL 在设置更新且存在检测实例时停止实例并延迟100毫秒重新启动。启动入口捕获其等待操作的异常并提示；停止入口依次暂停、销毁和清理状态。

#### Scenario: 启动失败
- **WHEN** 启动入口捕获初始化异常
- **THEN** 记录并提示错误，但该捕获分支不主动复位麦克风开关；内部检测器启动调用未等待，因此入口返回不等价于采集成功。

#### Scenario: 编辑与取消 ASR 设置
- **WHEN** 用户编辑数值或三个自动开关
- **THEN** 数值暂存并在保存时转换更新，开关即时更新；保存更新快照，取消恢复数值并回写开关快照。空串和单独负号可暂存，数值转换仅排除非数值结果，不提供统一范围、整数或阈值关系验证。

证据：[`vad-context.tsx`](../../../src/renderer/src/context/vad-context.tsx:265)、[`use-asr-settings.ts`](../../../src/renderer/src/hooks/sidebar/setting/use-asr-settings.ts:16)、[`asr.tsx`](../../../src/renderer/src/components/sidebar/setting/asr.tsx:62)。

### Requirement: 音频分块与结束附图
系统 SHALL 按4096样本分块发送音频，各块转为普通数组；全部块发送之后获取截图，并将图片附在音频结束消息而非首块。

#### Scenario: 截图完成
- **WHEN** 所有音频块已发送且截图成功返回
- **THEN** 发送携带图片数组的音频结束消息；无可捕获流时图片数组为空。

#### Scenario: 截图拒绝
- **WHEN** 截图调用拒绝且未被截图内部捕获
- **THEN** 发送函数没有本地恢复、重试或补发结束消息路径，可能已发音频块但未发结束消息。

证据：[`use-send-audio.tsx`](../../../src/renderer/src/hooks/utils/use-send-audio.tsx:9)。

## 静态风险与验证边界

- 设置更新及启动回调依赖不完整，可能读取旧配置；自动开关引用的初始同步需运行验证，不能保证每次编辑都影响后续检测。
- 停止流程没有异常保护；并发启动、卸载和持久化开关与实际采集实例的一致性未运行验证。
- 发送链路未提供背压或重试保证。未执行设备授权、误触发、断网或配置回滚测试；上述风险不是已复现故障。