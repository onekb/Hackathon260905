# InferPool 项目文档

> 地址脱敏说明：`demo.example.com` 为占位域名，不是实际部署或验收地址；本文历史验证记录指向清理前的真实地址。

InferPool 是黑客松中的 AI 推理市场：卖家独立运行 Mock 节点，买家通过网页或统一 API 使用服务，Monad 测试网合约负责报价、资金托管、预算锁定和结算。平台负责链外路由、模拟计量及故障判责。当前源码已改为原生测试 MON；旧 dUSD 资产和历史按原合约保留。

**当前：新原生 MON 合约已部署并验证 2/2，根 91/91 通过，前端静态产物已构建；同钱包小额实链验收已通过，公网尚未切换。** https://demo.example.com 仍为旧 dUSD 版，页面/常驻 A 的 WSS 已验收；前序浏览器六目标场景、双卖家 API 三场景及网页手动单均按旧资产归档。MOJO 队伍已建、项目未提交，100 测试 MON 活动补给已核对到账；持续最新证据见 [开发进度](progress.md)。

| 想了解什么 | 阅读位置 |
| --- | --- |
| 用户要做什么、首版不做什么、为何这么决定 | [需求与决策记录](requirements-and-decisions.md) |
| 买家如何接卖家、钱如何流动、计费和 API 如何工作 | [架构、计费与协议](architecture-and-protocol.md) |
| 如何启动、配置钱包、复现测试、检查部署 | [运行与部署手册](runbook.md) |
| 常驻 Router、静态前端及反向代理如何准备 | [公网部署与交接记录](../deploy/README.md)（页面与常驻卖家已验收） |
| 如何在 3 / 5 分钟内演示、现场失败时如何切换 | [演示指南](demo-guide.md) |
| 中英文项目文案、成果证据和提交待填项 | [比赛提交材料](hackathon-submission.md) |
| LOGO 与项目说明预览图、如何重新生成 | [提交图形素材](../artifacts/submission/README.md) |
| 已经做完哪些、证据在哪里、还差什么 | [开发进度与证据](progress.md) |
| 讨论如何演变、后续对话新增了什么 | [对话与里程碑日志](conversation-log.md) |
| 后续 agent 如何持续维护这些资料 | [根 AGENTS.md](../AGENTS.md) |

仓库入口见 [README](../README.md)。[MVP_SPEC.md](../MVP_SPEC.md) 是完整需求基线，当前实现完成度集中记录在本目录的进度页。组件细节见 [买家 Web](../web/README.md)、[Router](../server/README.md)、[卖家节点](../provider/README.md) 与 [合约](../contracts/README.md)；[部署记录](../contracts/deployments/inferpool-monad-testnet.json) 是链上地址和回执依据。

文档遵循三层区分：用户确认的目标、已采用的工程决定、通过证据验证的实现状态。需求不是完成声明，测试网交易不是独立多卖家验收，源码写完也不是浏览器流程已通过。

本目录于 **2026-09-05（Asia/Shanghai）** 建立。更早讨论按已有消息、规格和文件证据补记，不虚构原始共享聊天中没有读取到的内容。后续每轮有实质变化时同步对应主题与日志；当前没有定时维护任务。
