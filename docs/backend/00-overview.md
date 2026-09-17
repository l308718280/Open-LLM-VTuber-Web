# Java 后端重建方案总览

## 1. 目标与边界

在尽量不修改现有前端的条件下，以 Java 重建 WebSocket 业务后端、HTTP 静态资源服务，以及 ASR、LLM、TTS 和可选工具编排能力。

本目录是设计方案，不表示服务已经实现或通过联调。原接口清单继续保留在 [`backend.md`](../backend.md)，避免维护两份重复字段定义。

全文约定：**已核实**来自当前前端代码；**建议**是新后端设计决策；**待确认**需要依赖实现、抓包或运行验证。示例时序均为新后端建议，不代表旧后端的真实行为。

## 2. 阅读顺序

| 文档 | 解决的问题 |
| --- | --- |
| [`01-java-architecture.md`](01-java-architecture.md) | Java 技术选型、模块边界、并发模型、存储模型 |
| [`02-protocol-compatibility.md`](02-protocol-compatibility.md) | 17 类入站消息的处理、出站兼容要求和演进边界 |
| [`03-session-lifecycle.md`](03-session-lifecycle.md) | 初始化、对话、结束、中断、切换和断线时序 |
| [`04-media-and-resources.md`](04-media-and-resources.md) | 音频、图片、Live2D、资源路径和容量预算 |
| [`05-tools-security-deployment.md`](05-tools-security-deployment.md) | 浏览器工具、群组、安全、部署和可观测性 |
| [`06-implementation-acceptance.md`](06-implementation-acceptance.md) | 分阶段实施、验收矩阵、优先级和待决策事项 |

## 3. 推荐起点

1. 推荐 Java 21 LTS、Spring Boot 的受维护且兼容 Java 21 的版本，采用原生 WebSocket JSON 协议，不引入 STOMP 或 SockJS。
2. 初期采用单实例、模块化单体、关系数据库；连接状态和任务取消令牌在进程内管理。Redis、多节点和消息队列不是第一阶段的前提。
3. 先做资源加载、角色配置、历史记录和纯文字闭环，再接 LLM，最后接语音、图像、工具及群组。
4. 外部模型能力通过适配层接入。Java 负责协议、编排和业务，不要求用 Java 重写语音模型或浏览器引擎。
5. 默认兼容模式只允许单连接一个活跃对话轮次；内部生成轮次标识，但不能假设旧前端会回传它。

## 4. 当前工程事实

- 根目录 [`pom.xml`](../../pom.xml) 只有 Maven 坐标和聚合打包声明，没有 Java 版本、Spring Boot 依赖或业务模块。不能据此认为已有可运行 Java 服务。
- 当前主业务是一个 WebSocket 入口；资源走 HTTP GET，不需要为了重建而把现有会话操作改成 REST。
- 当前消息没有统一请求标识、轮次标识、音频序号或恢复游标。内部设计可以补齐，但对外新增字段不会自动获得客户端支持。
- 当前连接重新建立后会请求新建历史；这与“自动恢复上次会话”不同。依据：[`websocket-service.tsx`](../../src/renderer/src/services/websocket-service.tsx:126)。
- 麦克风在语音结束回调中拿到完整浮点数组，再集中上传分片，并非逐帧实时 ASR。依据：[`vad-context.tsx`](../../src/renderer/src/context/vad-context.tsx:231)。

## 5. 必须提前接受的限制

- 后端可以屏蔽尚未发出的旧任务消息，无法撤回已经到达浏览器的旧消息；严格消除跨轮串音需要前端配合轮次标识。
- 播放完成回执没有轮次标识，且播放失败也可能走队列完成逻辑；不能据此证明用户完整听到了声音。
- 前端历史列表处理会选择第一项，错误提示不负责通用状态恢复；后端必须设计顺序和收尾，不能只发错误文本。
- 浏览器调试面板、群组授权和多用户身份不是只实现几个消息分支就自然完整，必须独立设计边界。

建议先以“单用户本地使用、单实例运行”为最小闭环；如直接面向公网多人使用，身份认证、数据隔离和资源授权应前移到第一阶段。