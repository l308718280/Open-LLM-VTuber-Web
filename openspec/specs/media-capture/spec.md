# 摄像头、屏幕捕获与截图现状基线

## Purpose

记录 renderer 媒体采集、预览、截图附图和相关设置的现有行为。本文为静态源码基线，SHALL 表示记录现状，不表示设备或浏览器运行验收；风险单列，不要求保留缺陷，不扩展桌面窗口管理。

## Requirements

### Requirement: 独立摄像头流
系统 SHALL 分别管理主摄像头与背景摄像头，初始均关闭且无流；默认请求理想宽高320乘240，不把理想约束当成设备实际分辨率保证。启动前检查采集API、枚举视频输入设备，再请求视频流。

#### Scenario: 启动成功或失败
- **WHEN** 启动任一摄像头
- **THEN** 成功后登记对应流并更新状态；主预览引用已存在时绑定视频源。失败记录日志、显示2000毫秒错误提示并重新抛出异常。

#### Scenario: 停止主摄像头
- **WHEN** 存在主流且调用停止
- **THEN** 停止全部轨道、清流引用并关闭状态；提供者不直接清主预览视频源，预览组件另有流同步，不能将两者混为一个操作。

证据：[`camera-context.tsx`](../../../src/renderer/src/context/camera-context.tsx:43)、[`camera-panel.tsx`](../../../src/renderer/src/components/sidebar/camera-panel.tsx)。

### Requirement: 屏幕采集与错误状态
系统 SHALL 初始使用空流、关闭状态和空错误。桌面入口先获取屏幕源标识，再请求宽高最小值和最大值均为1280乘720的桌面流；浏览器入口请求显示媒体，两条路径均关闭音频。

#### Scenario: 屏幕启动结果
- **WHEN** 用户启动屏幕捕获
- **THEN** 成功后登记流、开启状态并清错误；失败时保存通用本地化错误、提示2000毫秒并记录日志，不重新抛出异常。

#### Scenario: 屏幕停止
- **WHEN** 存在屏幕流且调用停止
- **THEN** 停止全部轨道、清流并关闭状态，但不清除错误；面板切换入口不等待启动，预览通过副作用同步流。

证据：[`screen-capture-context.tsx`](../../../src/renderer/src/context/screen-capture-context.tsx:15)、[`use-capture-screen.ts`](../../../src/renderer/src/hooks/sidebar/use-capture-screen.ts:9)。

### Requirement: 截图来源与编码
系统 SHALL 先捕获主摄像头再捕获屏幕，不捕获背景摄像头；每个来源取首个视频轨道。结果含来源、数据地址和JPEG媒体类型，无流或轨道时跳过该来源，无可用图片时返回空数组。

#### Scenario: 压缩与尺寸限制
- **WHEN** 成功取得帧且存在二维画布上下文
- **THEN** 按设置输出JPEG；质量默认0.8，接受解析后0.1至1的值；最大宽度默认0表示不限，接受解析后的非负整数。只有原宽大于正数上限时等比缩小，不放大图像。

#### Scenario: 单个来源内部失败
- **WHEN** 抓帧、读取截图设置或编码在保护块内抛错
- **THEN** 记录和提示错误并返回空结果，后续来源仍可继续；二维上下文不存在时记录并返回空结果。

#### Scenario: 捕获器构造失败
- **WHEN** 视频轨道存在但图像捕获器构造抛错
- **THEN** 异常越过本地保护向调用者传播，可能阻断后续来源，以及文字提交、语音结束消息或主动说话发送。

证据：[`use-media-capture.tsx`](../../../src/renderer/src/hooks/utils/use-media-capture.tsx:33)。

### Requirement: 截图设置与背景摄像头回滚
系统 SHALL 即时应用并写入截图质量与最大宽度设置，保存更新快照，取消恢复设置。显式开启背景摄像头时等待启动结果，成功置开启、失败置关闭；显式关闭先停止流再清标志。

#### Scenario: 取消背景设置
- **WHEN** 取消设置并恢复背景摄像头快照
- **THEN** 除恢复标志外，真实调用背景摄像头启动或停止；恢复启动没有等待或本地异常捕获，不能保证回滚后立即存在可用流。

证据：[`use-general-settings.ts`](../../../src/renderer/src/hooks/sidebar/setting/use-general-settings.ts:12)、[`use-general-settings.ts`](../../../src/renderer/src/hooks/sidebar/setting/use-general-settings.ts:115)、[`use-general-settings.ts`](../../../src/renderer/src/hooks/sidebar/setting/use-general-settings.ts:185)。

## 静态风险与验证边界

- 所读摄像头和屏幕提供者未见启动互斥、重复启动旧流释放、卸载停流及外部轨道结束状态同步；这是所读实现范围内的观察，不代表全应用均无处理。
- 图像位图未显式关闭，捕获结果含完整图像数据并输出日志；未进行内存、隐私日志或长期运行测试。
- 截图调用中的存储读取处于保护块内，但通用设置初始化及写入直接访问本地存储，不能套用同一异常恢复保证。
- 未执行设备授权拒绝、无设备、外部停止共享、重复启动、配置取消或多来源失败测试；尺寸与提示时长均为配置值。