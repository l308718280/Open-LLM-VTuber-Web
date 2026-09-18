# Live2D 加载、交互、表情与口型现状基线

## Purpose

记录 renderer 与本仓库 Cubism SDK 的模型配置、加载、点击、拖动、缩放、表情及口型行为。SHALL 表示静态现状，不表示运行验收通过；风险不是要求保留的功能，不扩展桌面窗口管理。

## Requirements

### Requirement: 模型配置与设置快照
系统 SHALL 初始没有有效模型地址、允许滚轮缩放且加载标志为假。模型配置通过本地存储保存，持久化过滤保留其他字段但将地址置为空串，不修改内存中的地址；传入无非空地址的配置时置为未定义，不等价于删除存储键。

#### Scenario: 接收模型比例与交互配置
- **WHEN** 接收包含地址的模型配置
- **THEN** 比例取传入值或0.5，再转数值并乘2；缺省及数值零得到1，字符串零得到0。交互与缩放属性存在时使用传入值，不存在时沿用旧值，旧值缺失才默认开启；此路径没有统一的有限数、正数或范围校验。

#### Scenario: 编辑保存与取消模型设置
- **WHEN** 编辑交互或缩放开关，随后保存或取消
- **THEN** 开关变化即时回写整份模型信息；保存仅更新快照，取消恢复快照并再次调用配置入口。提供者有效配置变化还会同步编辑值和快照；空配置的设置回退值为地址空串、比例0.5、位移零、空表情映射和允许滚轮缩放。

证据：[`live2d-config-context.tsx`](../../../src/renderer/src/context/live2d-config-context.tsx:90)、[`use-live2d-settings.ts`](../../../src/renderer/src/hooks/sidebar/setting/use-live2d-settings.ts:7)。

### Requirement: 地址解析与模型重载
系统 SHALL 在非空模型地址变化，或SDK比例和配置比例均已定义且不同的情况下尝试重载；不是只监听地址变化。地址以无基准地址的URL解析方式拆分基础路径、模型目录与文件名，查询串不进入重建路径。

#### Scenario: 有效或无效地址
- **WHEN** 需要更新模型
- **THEN** 先记录当前地址，再解析并更新SDK配置；解析失败记录错误并返回空字段，不执行有效路径的初始化。有效路径在500毫秒后尝试释放旧管理器并初始化；相对地址不能由该解析入口自动补全。

#### Scenario: 预加载动作
- **WHEN** SDK统计动作总数
- **THEN** 总数为零直接进入纹理加载；存在动作时并行预加载，成功解析后增加完成数并检查能否进入纹理阶段，失败分支减少预期总数但不重新执行完成检查。

证据：[`use-live2d-model.ts`](../../../src/renderer/src/hooks/canvas/use-live2d-model.ts:28)、[`use-live2d-model.ts`](../../../src/renderer/src/hooks/canvas/use-live2d-model.ts:112)、[`lappmodel.ts`](../../../src/renderer/WebSDK/src/lappmodel.ts:425)、[`lappmodel.ts`](../../../src/renderer/WebSDK/src/lappmodel.ts:906)。

### Requirement: 点击与拖动判定
系统 SHALL 在命中模型后记录按下；移动距离大于5像素，或持续超过200毫秒且移动大于1像素时开始拖动。点击要求潜在点击状态、时长严格小于200毫秒、距离严格小于5像素且未明确禁用指针交互；指针交互开关不禁止拖动。

#### Scenario: 拖动模型
- **WHEN** 已进入拖动且模型、画布和视图可用
- **THEN** 使用画布比例和设备到屏幕变换换算位移，优先通过适配器更新位置，否则修改模型矩阵平移；结束时记录最终位置供后续拖动使用，离开时清理拖动和点击状态。此位置记录不等价于跨刷新持久化。

#### Scenario: 选择点击动作组
- **WHEN** 点击有效且配置了点击动作
- **THEN** 无配置或外层空对象直接返回；命中区域配置为真值时仅采用该区域，即使其值是空对象也不回退。否则合并所有区域，同名组转换数值后累加；候选为空返回。权重转换为数值，总和仅将非数值结果视为零，总和不大于零返回，否则按随机数顺序扣减权重选择，选中后以优先级3随机播放组内动作。

证据：[`use-live2d-model.ts`](../../../src/renderer/src/hooks/canvas/use-live2d-model.ts:205)、[`use-live2d-model.ts`](../../../src/renderer/src/hooks/canvas/use-live2d-model.ts:336)、[`lappmodel.ts`](../../../src/renderer/WebSDK/src/lappmodel.ts:1163)。

### Requirement: 滚轮缩放与布局生命周期
系统 SHALL 操作模型零的矩阵比例。滚轮处理先阻止默认行为，再检查是否允许缩放；开启时向下滚动缩小，其他方向值放大，目标取当前缓动比例加减0.03并限制在0.1至5，而非基于上次目标累加；该路径不持久化比例。

#### Scenario: 缩放缓动与清理
- **WHEN** 缩放动画已经启动
- **THEN** 每帧按当前值加目标差值的0.3更新并继续调度，无收敛退出条件；关闭缩放开关不主动终止既有动画。地址或配置比例变化重置相关引用并取消旧动画；卸载移除滚轮监听并取消动画。

#### Scenario: 容器或模式变化
- **WHEN** 布局观察器或窗口尺寸变化触发调整
- **THEN** 通过动画帧合并布局更新，结合容器、模式及设备像素比更新画布；卸载清理观察器、监听与待执行布局动画帧。

证据：[`use-live2d-resize.ts`](../../../src/renderer/src/hooks/canvas/use-live2d-resize.ts:96)、[`use-live2d-resize.ts`](../../../src/renderer/src/hooks/canvas/use-live2d-resize.ts:227)。

### Requirement: 动作优先级与表情恢复
系统 SHALL 对非强制动作要求优先级严格大于当前与预留优先级，同级拒绝；强制动作直接设置预留。启动优先级等于预留时清预留，动作结束后清当前优先级。点击与调试入口默认优先级3，音频任务尝试普通优先级的说话动作。

#### Scenario: 未缓存动作补载
- **WHEN** 动作未命中缓存且预留成功
- **THEN** 异步请求动作，当前调用立即返回无效句柄，不表示后续绝不会播放；成功补载后直接按优先级启动。该补载链没有本地拒绝捕获，解析失败返回也不清预留。

#### Scenario: 空闲时恢复表情
- **WHEN** AI状态或模型配置等副作用依赖变化且当前为空闲
- **THEN** 有适配器时尝试恢复；缺模型或模型设置直接返回。配置默认表情时仅尝试该值，未配置才尝试首个表情；字符串按名、数字先取对应名称，无效数字跳过，不保证无效默认值回退到首个表情，也不保证模型稍后加载完自动补执行。

证据：[`cubismmotionmanager.ts`](../../../src/renderer/WebSDK/Framework/src/motion/cubismmotionmanager.ts:62)、[`lappmodel.ts`](../../../src/renderer/WebSDK/src/lappmodel.ts:648)、[`use-live2d-expression.ts`](../../../src/renderer/src/hooks/canvas/use-live2d-expression.ts:14)、[`live2d.tsx`](../../../src/renderer/src/components/canvas/live2d.tsx:48)。

### Requirement: 音频口型与调试入口
系统 SHALL 在音频任务具备波形处理器时尝试驱动口型；缺波形处理器不等价于禁止声音。音频任务只处理表情数组第一项；本领域口型数值是参数增量而非最终嘴部开度保证。

#### Scenario: 有限非负音量驱动
- **WHEN** 音频任务与SDK口型链处理有限非负的原始均方根音量
- **THEN** 音频侧先乘2并限制上限2，SDK再乘1.5并限制上限1，以权重4加到嘴部参数；组合增量为4乘以1与三倍原始音量的较小值。最终参数还受原值、边界及其他更新影响；缺失参数可能得到虚拟索引，索引非负不能证明模型真实定义了嘴部参数。

#### Scenario: 调试与独立播放入口
- **WHEN** 模型交互钩子挂载或卸载
- **THEN** 挂载时提供全局动作、随机动作、信息及帮助入口，使用模型零；卸载删除全局入口。另有本地资源音频口型播放函数，不经过共享音频任务队列；静态搜索只见其定义，不宣称界面已调用它。

证据：[`use-audio-task.ts`](../../../src/renderer/src/hooks/utils/use-audio-task.ts:187)、[`lappmodel.ts`](../../../src/renderer/WebSDK/src/lappmodel.ts:614)、[`cubismmodel.ts`](../../../src/renderer/WebSDK/Framework/src/model/cubismmodel.ts:775)、[`cubismmodel.ts`](../../../src/renderer/WebSDK/Framework/src/model/cubismmodel.ts:955)、[`use-live2d-model.ts`](../../../src/renderer/src/hooks/canvas/use-live2d-model.ts:56)、[`use-live2d-model.ts`](../../../src/renderer/src/hooks/canvas/use-live2d-model.ts:409)。

## 静态风险与验证边界

- 配置比例归一化非幂等，回传已归一化整份配置可能再次乘2；配置回流会更新快照。设置注册副作用未完整依赖保存和取消回调，存在旧闭包风险；未复现回滚及界面比例漂移。
- 重载的500毫秒定时器没有清理，回调错误不受外层同步保护；另一个初始位置定时器有清理，不能概括为所有计时器均泄漏。
- 动作全部失败或最后完成的是失败请求时，失败分支不重检完成数，存在停留加载阶段风险；未进行坏资源复现或完整纹理失败审查。
- 点击权重未逐项排除负数或无穷值，不得称为安全归一化；边界权重、点击阈值空档、拖动坐标及缩放手感尚未实测。
- 缩放动画有生命周期清理，但没有收敛退出；未测量处理器开销，不以此推定已发生性能故障。独立音频播放的播放承诺未捕获。
- 未执行模型资源故障注入、多模型切换、动作竞争、音频中断口型归零、不同像素比或长期运行验收。