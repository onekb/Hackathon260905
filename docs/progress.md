# 开发进度与证据

状态日期：**2026-09-05，Asia/Shanghai**。这是一份可更新的实现快照；持续事件见 [对话日志](conversation-log.md)。本地监听地址表示本机进程，不能等同公网服务。

## 当前结论

业务合约已部署到 Monad 测试网并通过源码验证。正常收费、卖家故障零收费已用真实测试网合约交易检查；本地 Anvil 双钱包卖家联调和依赖重建后的 EVM 2/2 复测通过。测试网 HTTP smoke 也已通过真实买家签名、临时 API Key、独立 Provider 进程、锁款与结算，正常一单费用 `0.016690 dUSD`。该测试的买家、卖家、Router 仍使用同一个现有钱包。

轻量钱包依赖已恢复安装：`npm ci` 成功，审计剩余 19 项（12 low、7 moderate，零 high/critical）。根类型检查与最终全量 Node 测试 **48/48** 通过，覆盖新增的三个买家签名测试；其中 session 签名专项为 9/9。最新钱包初始化与 dashboard 修复后，Web 全量 lint 为 0 errors / 0 warnings，Next 生产构建再次通过。

买家 Web 在 Mac 解锁后冷刷新正常，`seller-monad` 与四项报价 v1 正常显示，未再出现空 session 或 Solana runtime 异常。用户未看到应用内浏览器的登录弹窗，主 agent 已改用 **Chrome 的 InferPool 专用标签**，通过原生界面将其切到前台并确认真实邮箱弹窗；用户应在 Chrome 内完成邮箱/验证码，不在聊天中提交。**钱包登录仍未完成，完整浏览器资金和请求流程、Monad 双卖家验收及公网 Demo 尚未通过。**

## 分项状态

| 项目 | 状态 | 依据及限制 |
| --- | --- | --- |
| 需求与接入方案 | 已形成可执行范围 | [MVP 规格](../MVP_SPEC.md)、[决策记录](requirements-and-decisions.md)；没有新增产品前置问题 |
| 仓库连接 | SSH 已连接 | origin 为 `git@github.com:onekb/Hackathon260905.git`；本次检查尚未 commit/push |
| 合约实现 | 已实现、测试和部署 | [市场源码](../contracts/src/InferenceMarket.sol)、[测试](../contracts/test/InferenceMarket.t.sol)、部署回执 |
| Router | 已实现，测试通过，已重启 | `8788` 模型接口可用；认证、计量、预算、SSE、幂等、恢复和重试；单进程存储 |
| 独立卖家 | 已实现并联调 | 本地控制台与故障模式；链上报价权威；支持私钥/临时身份/现有 Alchemy session 三选一 |
| 本地端到端 | 已通过 | 两个不同钱包卖家，API/WS/真实 Anvil 交易；独立进程演示已运行 |
| Monad 合约烟测 | 已通过 | 同一钱包分别扮演买家、卖家和 Router；两种责任场景、四笔业务交易 |
| Monad HTTP/API smoke | 已通过真实请求及结算 | 签名登录、临时 Key、独立 Provider、正常一单、幂等重试和撤销 Key；仍为同一钱包，非浏览器验收 |
| Monad 节点接入 | 重启后在线已验证 | `/v1/models` 确认 `seller-monad`，2 个可用槽位、报价版本 1；Router `8788` / 控制台 `8793`；不是多卖家成交证明 |
| 第二测试网卖家 | 未新增，仅完成会话隔离调查 | 原配置重连可能撤销 Router session；独立配置目录不保证第二 EOA，需 Dashboard 批准后核对不同地址 |
| Para 配置 | 已完成组织/项目/公开配置 | InferPool FREE；用户完成登录并授权代操作后台；公开 Key 文件忽略且权限 600，未保存私密 Key |
| 依赖与审计 | `npm ci` 成功 | 770 installed / 774 audited；19 项（12 low / 7 moderate），零 high/critical |
| 买家 Web | 构建/lint 与冷刷新渲染通过，Chrome 登录待用户完成 | 已把 Chrome InferPool 专用标签切到前台并确认邮箱弹窗；钱包资金与请求未最终验收 |
| 新钱包上手补丁 | 已准备，待应用与浏览器验证 | 完整地址复制、10143 专属官方 MON 水龙头与资产说明；临时候选补丁检查、eslint、全 Web TypeScript 通过，正在运行的 Web 源码尚未改 |
| 公网 Demo | 未部署/未验收 | 没有可供交付的公网服务链接 |
| 文档维护 | 已建立并持续更新 | `docs/` 导航、根 `AGENTS.md` 每轮同步规则；没有定时自动任务 |

## Monad 部署证据

网络：Monad Testnet，chain ID `10143`。以下为业务合约，旧 Counter 示例独立保留。

| 合约 | 地址 | 部署交易 |
| --- | --- | --- |
| DemoUSD | [0x62701D69bD213e8F63c28465528931de208cE06E](https://testnet.monadscan.com/address/0x62701D69bD213e8F63c28465528931de208cE06E) | [部署回执](https://testnet.monadscan.com/tx/0x24e44596a80f80aa2aa925cf292583a51637bd8765d539b1a7785dbf703d38e5) |
| InferenceMarket | [0x6F1b725DD3588cb5c8C3f72F614E80ebB2d82568](https://testnet.monadscan.com/address/0x6F1b725DD3588cb5c8C3f72F614E80ebB2d82568) | [部署回执](https://testnet.monadscan.com/tx/0x879e7b0b2398bf96acd7c8f0235f167265d49817abd016ff14a33f3b22809a53) |

两个合约均有成功回执、部署后读取结果、运行字节码检查及 MonadVision/Monadscan 验证成功记录。完整依据在 [inferpool-monad-testnet.json](../contracts/deployments/inferpool-monad-testnet.json) 及同目录 `inferpool-*-verification-result.json`。源码验证证明发布源码与部署字节码匹配，不等于安全审计。

前序设置阶段完成五笔交易：领取 DemoUSD、代币 approve、存款、消费授权、卖家报价。合约烟测分别进行两次锁款与两次结算，该阶段共九笔设置/业务交易。随后 HTTP smoke 增加一笔锁款、一笔结算，累计十一笔设置/业务交易，**不含两笔业务合约部署**。

| 烟测 | 预算 | 已确认费用 | 释放 | 结算证据 |
| --- | --- | --- | --- | --- |
| 正常完成：输入 100、输出 100 | `0.100000` | `0.011000` | `0.089000` | [交易](https://testnet.monadscan.com/tx/0xb14998b83934bc3cd4962f6c1024b835397f61f19084c634d56d78528a81f550) |
| 卖家失败：同样用量 | `0.100000` | `0.000000` | `0.100000` | [交易](https://testnet.monadscan.com/tx/0x041115482810fd1ad311b41fe8be7c471cb3886393f6430889cac2afcee45f28) |

金额单位均为 dUSD。买卖双方在此烟测中是同一钱包，所以费用扣减消费授权后又作为卖家收入回到同一合约余额，不能用余额不变推断未收费。最终锁款总额为零。明细见 [设置记录](../contracts/deployments/inferpool-setup-monad.json) 和 [烟测记录](../contracts/deployments/inferpool-smoke-monad.json)。

### HTTP/API smoke 的真实账单

`npm run test:api:monad` 通过 `/auth/challenge`、严格买家挑战签名与 `/auth/verify` 登录，再用临时 API Key 向实际 Router 发起正常请求；独立运行 Provider 的执行历史、账单、链上订单及两笔回执相互核对。请求 ID 为 `8cfd3165-7b24-43d7-8692-74593624c561`。

| 预算 | 普通输入 / 输出 | 已确认费用 | 释放 | 交易 |
| --- | --- | --- | --- | --- |
| `0.100000` | `55 / 188` 模拟 Unicode 单位 | `0.016690` | `0.083310` | [锁款](https://testnet.monadscan.com/tx/0xb507b6cbbe9288616b4105260567c3fc8289e6c500fc039292fbbd44f0ef3d99) / [结算](https://testnet.monadscan.com/tx/0xc2727d096b9b2634be26139bfcb27c4cb11bf72858d01c4837a0b27291195f84) |

同幂等 Key 再次 POST 返回同一订单、同一锁款和结算交易，没有第二次推理收费。脚本最终撤销临时 Key，并确认后续使用返回 `401`；认证值不保存。公开证据在 [inferpool-smoke-api-monad.json](../contracts/deployments/inferpool-smoke-api-monad.json)。本次仅正常一单；买家、卖家和 Router 是同一钱包，不能替代不同钱包的交易或浏览器 UI 验收。

## 验证记录与覆盖边界

以下“已通过”来自本开发任务的执行记录；部署部分另有可留存的链上 JSON 回执。测试源码链接说明覆盖范围，不能独自证明最新版本执行通过。钱包与 Web 仍在变化，最终回归结果需要继续追加。

| 验证层 | 已有证据 | 覆盖与限制 |
| --- | --- | --- |
| Foundry | 主 agent 汇总：完整 38 项通过 | invariant 128 × 64、fuzz 256；[业务测试](../contracts/test/InferenceMarket.t.sol) 涵盖资金、权限、预算、报价、授权、终态及回收 |
| Router / Provider 单测 | 最终全量 `npm test` **48/48 通过** | 包含新增三个买家签名测试；前序 45/45 留在历史日志；[server/test](../server/test/) / [provider/test](../provider/test/) |
| 买家/卖家 session 签名专项 | `provider/test/signer.test.ts` **9/9 通过**（包含在上述 48 项中） | 严格验证挑战目的、域名、身份、时效与 session，不扩大任意消息签名范围 |
| 根 TypeScript | `npm run typecheck` 通过 | 根项目检查；Web 独立配置另看构建与专项检查 |
| 本地 EVM 适配 | 依赖重建后 `npm run test:evm` 再次 **2/2 通过** | [evm-chain.test.ts](../tests/evm-chain.test.ts)：正常与失败、报价版本、预算、并发、直接回收 |
| HTTP + 双卖家 + EVM | 依赖重建后再次通过（上述 EVM 套件的另一项） | [integration.test.ts](../tests/integration.test.ts)：签名登录、Key、指定卖家、流式取消、失败全免、预算、缓存与幂等 |
| 独立进程本地 Demo | 已运行并请求成功 | [demo.ts](../scripts/demo.ts) 启动两个卖家；这是本地链，非 Monad |
| Monad 合约 smoke | 已通过并回读状态 | 上述两种责任结果；不经过完整网页和独立多钱包卖家 |
| Monad HTTP/API smoke | `npm run test:api:monad` 通过 | 正常一单真实鉴权/API/独立进程/合约结算、幂等与 Key 撤销；同一钱包，不覆盖故障模式或浏览器 |
| Monad Router / Provider | 重启后在线并完成正常请求 | `seller-monad` / quote v1；仍需浏览器和多钱包验收 |
| Next 生产构建 | 最新修复后 `npm run build:web` 再次 exit 0，Next 16.3.4 | 覆盖钱包初始化与 dashboard 修复；构建成功不等于浏览器验收 |
| Web lint | 全量 `npm run lint --workspace web` exit 0 | **0 errors / 0 warnings**；之前的 5 errors / 1 warning 已解决 |
| Para 初始化修复 | 类型、配置解析器断言与实际冷刷新通过 | 新标签正常渲染，无空 session 和 Solana runtime 异常；这不代表登录已完成 |
| 浏览器市场/钱包入口 | 实际冷刷新与点击检查通过 | `seller-monad`、四项报价 v1；Chrome 已置前，确认真实 InferPool 邮箱弹窗 |
| 浏览器钱包与交易 | 等待用户在 Chrome 邮箱/验证码登录 | 先前应用内弹窗用户未看到，已切换操作入口；登录、余额、签名和资金/请求交易尚未验收 |

本次 full Para SDK 的初装审计曾报告 120 项问题（含 Cosmos 依赖路径的 2 项 critical）。切换 Lite 内嵌钱包并移除不需要的多链/外部连接依赖后，当前审计为 **19 项：12 low、7 moderate，零 high/critical**；这不代表完全没有依赖风险。CLI 3.18 的 doctor 对 Lite/`ParaProviderMin`/无外部钱包配置存在静态规则误报，已按本机源码确认；仍需真实运行验证。

移除旧 SDK 时 npm Arborist 回滚曾报 `from undefined`。已用只含 package manifests 的干净临时目录重新解析 lock，正式 `npm ci` 成功（770 installed / 774 audited）。服务已重启，Mac 已解锁；浏览器冷刷新和邮箱入口通过，后续登录与交易仍在继续。

## 下一步

1. 等用户在已置前的 Chrome InferPool 标签完成邮箱登录后验证钱包就绪、Gas、平台签名、资金、报价、API Key、钱包切换和幂等重试；此时不要用 HMR 中断验证码流程。
2. 从买家网页发起一次实际 Monad 请求并核对账单与交易。最小 API 正常流程已通过，不能用它替代网页验收。
3. 先完成 Para 独立买家与已有卖家的流程，再补不同卖家钱包及故障模式；独立买家不是第二卖家。第二卖家按 [会话隔离规则](runbook.md#增加第二卖家时保留-router-会话) 接入，保留原 Router 会话。
4. 根据交付要求决定公网入口、仓库提交/推送和演示材料；完成后用实际地址、提交或回执更新此页。

产品问题已足够明确，以上是开发与验证事项。登录或签名确需本人处理时再请求用户参与，不重复确认已授权的常规配置。

## 后续更新约定

每次里程碑更新对应行，并追加具体命令/场景、环境、结果和证据；失败也记录，不把“计划测试”改写成“测试通过”。新的决策进入 [决策记录](requirements-and-decisions.md)，用户的新要求进入 [对话日志](conversation-log.md)。
