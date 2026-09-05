# InferPool · MOJO 填表文案

> 地址脱敏说明：`demo.example.com` 为占位域名，不是实际部署或验收地址；本文历史验证记录指向清理前的真实地址。

准备日期：2026-09-05（Asia/Shanghai）。独立参赛队伍 **InferPool** 的 [项目 #385](https://mojo.devnads.com/projects/385) 已提交，状态**待审核**。标题、活动、Demo/GitHub、正文与三图均回读正确；本文件保留填表文案，提交不等于资格或审核已获确认。

实际回执：[mojo-submission.json](mojo-submission.json) / [待审核截图](mojo-submitted.jpg)，2026-09-05 16:17:28 +08 回读。仓库原图与平台16:9裁剪分开保留。

## 项目标题

InferPool｜MON 预算托管的 AI 推理市场

## 一句话介绍

让独立推理节点按请求交易：先锁定 MON 预算，再按用量结算，卖家故障免推理费。

## 短简介

InferPool 是部署在 Monad 测试网的 AI 推理交易原型。买家通过网页或统一 API 选择卖家，设置单次预算与消费授权；独立卖家运行客户端，主动连接 Router，无需配置公网地址。合约锁定原生 MON 预算，按普通输入、缓存读取、缓存写入和输出四项报价结算，卖家故障时整单推理费为零，剩余预算回到托管余额。买家可撤销授权、提款和回收超时锁款。账单区分生成结束与结算确认，可追踪费用与释放金额。当前响应、Token 与缓存均为 Mock，钱包签名和测试网资金交易是真实操作。Router 仍负责可信计量与判责；本版不证明模型真实性，也未实现 TEE。

## 三个亮点

1. **单次预算与资金权限分离。** 买家用原生 MON 存款，单独设置消费额度和期限；每单先锁款，结算释放余额，API Key 无权提款或扩大授权。
2. **独立节点接入简单。** 卖家独立运行进程，以钱包签名认证后主动建立 WS/WSS 连接。买家只连接统一 Router，无需知道卖家的公网地址。
3. **四项计费与故障账单可检查。** 普通输入、缓存读、缓存写、输出分别报价，订单保存报价版本、模拟用量和链上结算记录；卖家失败时整单推理费为零。

## 技术栈

- 链与合约：Monad Testnet（chain ID **10143**）、原生 MON、Solidity、OpenZeppelin、Foundry。
- 网页与钱包：Next.js、React、TypeScript、Para Lite 邮箱钱包、viem。
- 路由与节点：Node.js、Express、WebSocket、SSE；独立 Provider 进程与 Mock 响应。

## 链接

| 字段 | 内容 |
| --- | --- |
| 公网 Demo | [https://demo.example.com](https://demo.example.com) |
| GitHub | [onekb/Hackathon260905](https://github.com/onekb/Hackathon260905) |
| 当前原生 MON 合约 | [0x142a4904307244Bed0cECD72dE8329A253333182](https://testnet.monadscan.com/address/0x142a4904307244Bed0cECD72dE8329A253333182) |

## 实际提交图片

1. [native-normal-bill.jpg](native-normal-bill.jpg)：正常请求与 MON 账单，实际第一张；平台强制16:9裁剪并已目视检查。
2. [native-bills-comparison.jpg](native-bills-comparison.jpg)：正常收费与卖家故障零推理费对照，实际第二张；平台16:9裁剪并已目视检查。
3. [inferpool-project-overview.png](inferpool-project-overview.png)：实际第三张，原本16:9，含LOGO并明确非运行截图。

正文提供公开 GitHub LOGO PNG/SVG 链接；独立正文图片上传无结果，空占位已撤销，未声称单独上传成功。仓库原始图片未改，说明图不能替代实际运行截图。

## 仍需确认的资格与审核边界

- 确认本项目的实际编码、资源制作和 GitHub 提交时间符合本场活动窗口；如表单要求相关声明，请按实际情况确认，不能仅凭首次提交时间推断。
- 已回读项目关联 Monad Blitz@惠州活动16和 InferPool 团队/队长，状态待审核；审核、现场演示与投票未因提交自动完成。

本轮验收备注（不必粘贴简介）：公网网页已完成买家 B 存入 `0.1 MON`、授权 `0.05 MON / 24h`。B 向不同钱包的卖家 A 发起正常与故障请求，分别按 `0.0001658 MON` 和 `0 MON` 结算；两单 UI 显示链上确认，独立 RPC 的回执、订单与资金对账也已通过，[公开验收记录](../../contracts/deployments/inferpool-native-browser.json) 的 `verification.status` 为 `verified`。最终买家可用托管余额为 `0.0998342 MON`、剩余授权为 `0.0498342 MON`，买家授权锁款与市场总锁款均为零。正常费用计入卖家在合约内的可用托管余额，需另行提款才进入卖家外部钱包；卖家 A 与 Router 使用同一钱包。本介绍不宣称真实模型能力、无需信任的链外计量、TEE 或去中心化判责，项目已提交待审核；提交时没有新增协议/资格声明，活动期编码资格仍待本人按实际情况核对。
