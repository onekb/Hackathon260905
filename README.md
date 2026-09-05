# InferPool

> 地址脱敏说明：`demo.example.com` 为占位域名，不是实际部署或验收地址；本文历史验证记录指向清理前的真实地址。

用于黑客松演示的 AI 推理市场：独立卖家主动连接平台，买家通过网页或统一 API 发起请求，由 Monad 测试网合约托管预算、按用量结算并释放余额。

所有 AI 输出、Token 和缓存效果都是 **Mock**。当前源码以原生测试 MON 托管和计费，正式产品只提供 MON；旧 dUSD 整账本私有备份、链上回执仅历史存档，不兑换或代提款，测试资产不代表美元或真实收入。平台负责链外计量与判责，合约约束资金权限和预算，不证明模型真实性。

新 [原生 MON 市场](https://testnet.monadscan.com/address/0x142a4904307244Bed0cECD72dE8329A253333182) 已部署并完成双浏览器源码验证，D17 MON-only 根 91 项测试及类型检查通过，前端最终 8 项及类型/lint/构建通过，同钱包小额实链验收 8 笔交易通过。[公网应用](https://demo.example.com) 已切到 MON-only a78470a，配置/模型接口与卖家 A 新报价回读通过；公网 API/SSE 一单及浏览器签名登录/账户读取通过；独立买家 MON 网页存款/授权及正常、故障两单已验，逐帧 SSE 未采证。此前浏览器、双卖家和结算证据全部保留为旧版记录；当前范围见 [开发进度](docs/progress.md)。

## 本地快速开始

需要 Node.js ≥ 22.13、npm，以及 Foundry 的 `forge` / `anvil`。在仓库根目录运行：

```bash
npm ci
npm run setup:contracts
forge build --root contracts
npm run demo
```

脚本启动或复用本地 Anvil（chain ID `31337`），部署原生 MON 测试合约，准备买家托管余额与授权，并启动 Router 和两个不同钱包的独立卖家进程。

| 服务 | 本机地址 |
| --- | --- |
| Anvil RPC | `http://127.0.0.1:18545` |
| 本地 Router | `http://127.0.0.1:8787` |
| 两个卖家控制台 | `http://127.0.0.1:8791` / `http://127.0.0.1:8792` |

看到 `Local demo ready` 后，在另一终端发送请求：

```bash
npm run demo:request
```

脚本自动读取本地演示凭证，显示 SSE 输出和账单；这里的交易属于本地 Anvil。凭证保存在被 Git 忽略的 `.local/`，无需打印或复制。`Ctrl+C` 关闭脚本启动的进程，复用的既有 Anvil 保留。

缓存、失败演示、独立卖家参数、完整测试命令和 Monad 测试网启动方式见 [运行手册](docs/runbook.md)。

## 买家网页

```bash
npm run dev:web
```

入口 `http://127.0.0.1:3000`，需先配置 Para 前端公开 Key 并启动对应 Router；默认 Router 为连接 Monad 测试网的 `8788`。本地双卖家演示使用 `8787`，两者配置不要混用。页面说明和配置见 [Web README](web/README.md)。这些地址仅供本机访问，不是公网 Demo。

## 项目文档

| 内容 | 文档 |
| --- | --- |
| 完整导航与接手顺序 | [docs/README.md](docs/README.md) |
| 首版范围、验收目标与选择原因 | [需求与决策](docs/requirements-and-decisions.md) |
| 连接、信任边界、计费和接口 | [架构与协议](docs/architecture-and-protocol.md) |
| 配置、启动、部署、测试与故障处理 | [运行手册](docs/runbook.md) |
| 五分钟正式演示与中英文提交材料 | [演示指南](docs/demo-guide.md) / [比赛材料](docs/hackathon-submission.md) |
| 当前完成度、测试结果与链上证据 | [开发进度](docs/progress.md) |
| 用户讨论、变更及解决过程 | [对话日志](docs/conversation-log.md) |
| 完整需求基线 | [MVP_SPEC.md](MVP_SPEC.md) |

## 主要组件

| 目录 | 内容 |
| --- | --- |
| [contracts/](contracts/README.md) | 原生 MON 市场、Solidity 测试与部署回执 |
| [server/](server/README.md) | Router、认证、API、计量、持久化和链适配 |
| [provider/](provider/README.md) | 独立 Mock 卖家、本地控制台、身份及连接协议 |
| [web/](web/README.md) | 市场、账单、钱包、API 接入和卖家页面 |
| [scripts/](scripts/) | 依赖安装、演示、部署设置和 smoke 脚本 |
| [tests/](tests/) | 本地真实 EVM 与 HTTP/双卖家集成测试 |

## 持续维护

按 [AGENTS.md](AGENTS.md)，每轮功能、接口、部署或重要讨论变化都同步对应文档、进度和决策/对话记录。可以委托文档 agent，主 agent 负责结束前核对；没有定时自动维护任务。
