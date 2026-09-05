# 开发进度与证据

状态日期：**2026-09-05，Asia/Shanghai**。这是一份可更新的实现快照；持续事件见 [对话日志](conversation-log.md)。本地监听地址表示本机进程，不能等同公网服务。

## 当前结论

业务合约已部署到 Monad 测试网并通过源码验证。正常收费、卖家故障零收费已用真实测试网合约交易检查；本地 Anvil 双钱包卖家联调和依赖重建后的 EVM 2/2 复测通过。测试网 HTTP smoke 也已通过真实买家签名、临时 API Key、独立 Provider 进程、锁款与结算，正常一单费用 `0.016690 dUSD`。该测试的买家、卖家、Router 仍使用同一个现有钱包。

轻量钱包依赖已恢复安装：`npm ci` 成功，审计剩余 19 项（12 low、7 moderate，零 high/critical）。上轮已验证版本的根类型检查与全量 Node 测试 **48/48** 通过，其中 session 签名专项 9/9；Next 生产构建通过。本轮上手补丁已完成浏览器检查，主 agent 再次执行全量 Web lint 和全 Web TypeScript，均 exit 0。

主 agent 在 **Chrome 的 InferPool 专用标签** 完成独立新买家 `0xbc81…4a75` 的登录、Gas 准备、领取 `1,000 dUSD`、精确批准并存入 `10 dUSD`。用户明确允许 `5 dUSD`、`24` 小时消费授权后，正常、卖家中途失败、预算截断、缓存写入、缓存读取、主动取消六种目标场景均通过网页账单与独立 RPC 核对。另两次未成功取消的尝试保留真实结果，**共八单费用 `0.078507 dUSD`，买家扣减、卖家收入与授权花费一致，锁款归零。** 网页 Key 生命周期与地址复制已检查，同一卖家已恢复正常输出速度并在线；新建网页 Key 未发 API 请求。Monad 第二卖家、公网、浏览器钱包切换与断连/幂等重试仍未验收。

## 分项状态

| 项目 | 状态 | 依据及限制 |
| --- | --- | --- |
| 需求与接入方案 | 已形成可执行范围 | [MVP 规格](../MVP_SPEC.md)、[决策记录](requirements-and-decisions.md)；没有新增产品前置问题 |
| 仓库版本 | 实现 `6048a60` 已通过 SSH 推送 | `git push -u origin main` 成功创建远端 `main` 并设置跟踪 `origin/main`，目标 `git@github.com:onekb/Hackathon260905.git`；本轮推送记录将随本轮文档提交同步，具体提交见 `git log`；代码推送不等于公网服务部署 |
| 合约实现 | 已实现、测试和部署 | [市场源码](../contracts/src/InferenceMarket.sol)、[测试](../contracts/test/InferenceMarket.t.sol)、部署回执 |
| Router | 已实现，测试通过，已重启 | `8788` 模型接口可用；认证、计量、预算、SSE、幂等、恢复和重试；单进程存储 |
| 独立卖家 | 已实现并联调 | 本地控制台与故障模式；链上报价权威；支持私钥/临时身份/现有 Alchemy session 三选一 |
| 本地端到端 | 已通过 | 两个不同钱包卖家，API/WS/真实 Anvil 交易；独立进程演示已运行 |
| Monad 合约烟测 | 已通过 | 同一钱包分别扮演买家、卖家和 Router；两种责任场景、四笔业务交易 |
| Monad HTTP/API smoke | 已通过真实请求及结算 | 签名登录、临时 Key、独立 Provider、正常一单、幂等重试和撤销 Key；仍为同一钱包，非浏览器验收 |
| Monad 节点接入 | 取消验收后恢复 normal，在线已验证 | `seller-monad` 每 80 ms / 4 字符，2 个可用槽位、报价版本 1；Router `8788` / 控制台 `8793`；不是多卖家成交证明 |
| 第二测试网卖家 | 未新增，仅完成会话隔离调查 | 原配置重连可能撤销 Router session；独立配置目录不保证第二 EOA，需 Dashboard 批准后核对不同地址 |
| Para 配置 | 已完成组织/项目/公开配置 | InferPool FREE；用户完成登录并授权代操作后台；公开 Key 文件忽略且权限 600，未保存私密 Key |
| 依赖与审计 | `npm ci` 成功 | 770 installed / 774 audited；19 项（12 low / 7 moderate），零 high/critical |
| 买家 Web 登录 | Chrome 已确认连接独立新买家并有平台会话 | `0xbc81…4a75` 不同于现有卖家；初始账户为零，后续资金结果单独记录 |
| 新钱包上手补丁 | 已应用，静态和浏览器检查通过 | 完整地址与官方水龙头 href 已核对，复制点击显示“钱包地址已复制。”；实际文件 eslint/全 Web tsc 通过，资金交易逻辑未改 |
| 新买家测试网资金及请求 | 浏览器操作与独立链上回读通过 | 领取 1,000、存入 10 dUSD，授权 5 dUSD / 24 小时；六种目标场景、两次额外尝试共八单完整对账；主动取消成功 |
| 浏览器 API Key 生命周期 | 创建、离开后隐藏明文与撤销通过 | 临时 Key 未复制或保存，切页后只剩 preview，撤销后显示已撤销；没有用这把 Key 发出 API 请求 |
| 演示 Router Gas | 官方免费补给 1 测试 MON，回执和余额核对通过 | 余额从 0.171218074 增至 1.171218074 MON；当时四单加 20% 余量估计已满足，不改变买家余额或授权 |
| 公网 Demo | 未部署/未验收 | 没有可供交付的公网服务链接 |
| 文档维护 | 已建立并持续更新 | `docs/` 导航、根 `AGENTS.md` 每轮同步规则；没有定时自动任务 |

## Monad 部署证据

网络：Monad Testnet，chain ID `10143`。以下为业务合约，旧 Counter 示例独立保留。

| 合约 | 地址 | 部署交易 |
| --- | --- | --- |
| DemoUSD | [0x62701D69bD213e8F63c28465528931de208cE06E](https://testnet.monadscan.com/address/0x62701D69bD213e8F63c28465528931de208cE06E) | [部署回执](https://testnet.monadscan.com/tx/0x24e44596a80f80aa2aa925cf292583a51637bd8765d539b1a7785dbf703d38e5) |
| InferenceMarket | [0x6F1b725DD3588cb5c8C3f72F614E80ebB2d82568](https://testnet.monadscan.com/address/0x6F1b725DD3588cb5c8C3f72F614E80ebB2d82568) | [部署回执](https://testnet.monadscan.com/tx/0x879e7b0b2398bf96acd7c8f0235f167265d49817abd016ff14a33f3b22809a53) |

两个合约均有成功回执、部署后读取结果、运行字节码检查及 MonadVision/Monadscan 验证成功记录。完整依据在 [inferpool-monad-testnet.json](../contracts/deployments/inferpool-monad-testnet.json) 及同目录 `inferpool-*-verification-result.json`。源码验证证明发布源码与部署字节码匹配，不等于安全审计。

前序设置阶段完成五笔交易：领取 DemoUSD、代币 approve、存款、消费授权、卖家报价。合约烟测分别进行两次锁款与两次结算，该阶段共九笔设置/业务交易。随后同钱包 HTTP smoke 增加一笔锁款、一笔结算，这两个前序阶段共十一笔设置/业务交易，**不含两笔业务合约部署及后续独立买家浏览器交易**。

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

### 独立买家浏览器资金与请求证据

本段单独记录 Chrome 中的 Para 新买家 `0xbc81A46F5eeE3924aA0B7fD8849eA08351194A75`，避免与前述同钱包 API smoke 混淆。[公开证据 JSON](../contracts/deployments/inferpool-smoke-browser-monad.json) 已由独立 RPC 回读生成，后续按实际回执和链上状态继续补充。

| 步骤 | 已观察结果 | 证据与限制 |
| --- | --- | --- |
| 地址与初始余额 | 新地址不同于卖家；完整地址和水龙头 href 可读；MON / dUSD / 托管余额初始均为 0 | Chrome DOM 与历史区块 `59813393` 相符；初始代币 allowance、消费授权也为 0；复制点击显示成功状态 |
| 测试 MON 到账 | 官方 agent faucet 发送 1 测试 MON，浏览器刷新显示 MON 1 | [Gas 到账交易](https://testnet.monadscan.com/tx/0xcf22a8d37ee49370785409e224dfc22d93afc0d82ca8f236bb6749507a42546d) 与 RPC 成功回执 |
| 领取 dUSD | 浏览器领取 1,000 dUSD 成功 | [领取交易](https://testnet.monadscan.com/tx/0x04356bf705125f90a9517b0e041483afacf7b5c679532103133e2ecc1594bef7)，`faucetClaimed=true` |
| 精确批准与存款 | `approve` 精确 10 dUSD，随后 `deposit` 10 dUSD 成功 | [批准交易](https://testnet.monadscan.com/tx/0x69cf8b4524c1b0e83e7fe08ebe1bb2ae5aa7044fe6147dfb37b22a42c1b05ec3) / [存款交易](https://testnet.monadscan.com/tx/0xd711e8078f88e1a03fc322e5c5358e3cd610ff75aec43bb4050a3e46feef818a)；该阶段钱包 990、托管 10 dUSD，MON `0.970695706`，代币 allowance 已用完 |
| 消费授权 | 用户明确允许 5 dUSD、24 小时后成功 | 首次点击被自动审批拦截，未广播；明确许可后重试，[授权交易](https://testnet.monadscan.com/tx/0x2acc0b3dbdbd58215f063052d19e3dec30252e1e17c4074c8edeef06946074f9) 确认 `grantId=1`、额度 `5 dUSD` |

以下场景均由主 agent 在浏览器观察到账单，Router agent 独立核对成功回执、订单、报价/用量、买家扣减与卖家收入及授权锁定/花费。表中用量依次为普通输入 / 缓存读取 / 缓存写入 / 输出，仍是模拟 Unicode 单位；金额均为 dUSD。完整 UUID 与区块前后快照集中在公开 JSON 的对应 `cases` 条目。

| 场景 / JSON 名称 | 用量 | 预算 | 费用 | 释放 | 链上证据 |
| --- | --- | --- | --- | --- | --- |
| 正常 `normal` | `54 / 0 / 0 / 187` | `0.100000` | `0.016580` | `0.083420` | [锁款](https://testnet.monadscan.com/tx/0xa0431e169f199b00a152b25f9a5184f04fbf390c16fcb18e1c4d845b31dc88c7) / [结算](https://testnet.monadscan.com/tx/0x0aec57135f5ab7ac4d6e575b0fdaf3233e4ce644c96020632cab816e4091788e) |
| 卖家中途失败 `seller_failed` | `54 / 0 / 0 / 48` | `0.100000` | `0.000000` | `0.100000` | [锁款](https://testnet.monadscan.com/tx/0xd97570ab709af1b248c7e5e0a365414a375493b76fa98cfa810b52a41952f835) / [结算](https://testnet.monadscan.com/tx/0x25d1deabf6908099a7b7e22c785b8c1fbd7ac2cb0c66523981667b6714dcd0e2) |
| 预算截断 `budget_cap` | `54 / 0 / 0 / 42` | `0.005000` | `0.004980` | `0.000020` | [锁款](https://testnet.monadscan.com/tx/0x9dbc5759c594f7cdbe487734a5ff4607321aac9b225c23f03a39c12e8e36fd15) / [结算](https://testnet.monadscan.com/tx/0x793f4e2a59d4663194ae7a1761381841b929503bda70c795572078e857dac00d) |
| 缓存写入 `cache_write` | `0 / 0 / 54 / 203` | `0.100000` | `0.018265` | `0.081735` | [锁款](https://testnet.monadscan.com/tx/0xb6bda89b97b8d758bbd42edd8b9283a1eb630af15030cc5db736b849b6bde7cb) / [结算](https://testnet.monadscan.com/tx/0xdb1d5226019a72a335b8bb4f656e43cb651b66d0c6c45da6081d8f0b41ae5b60) |
| 缓存读取 `cache_read` | `0 / 54 / 0 / 206` | `0.100000` | `0.016642` | `0.083358` | [锁款](https://testnet.monadscan.com/tx/0x51571bdd67101724ea58e4b07257fa2b61aa5352e2b8dcdaa9c2626f46a72137) / [结算](https://testnet.monadscan.com/tx/0xdab0639120741abb2bc425eb492d46e0fadeaaa15a94c33dd409183661ddc169) |
| 未赶上取消，实际正常 `extra_normal` | `54 / 0 / 0 / 187` | `0.100000` | `0.016580` | `0.083420` | [锁款](https://testnet.monadscan.com/tx/0xf7a37c0518cbd8f3d9d432104142ae042ca2bef8a94c46477d1f8db840016492) / [结算](https://testnet.monadscan.com/tx/0x6ac6fbbf5c9056f9375ad0f97cd8d9950c69d695f1375e9b6e08ecbd33873fac) |
| 点击超时，实际卖家超时 `extra_timeout` | `54 / 0 / 0 / 59` | `0.100000` | `0.000000` | `0.100000` | [锁款](https://testnet.monadscan.com/tx/0x168746f6c1e3e0fc7d46946883292574c772f63d03ae637d66f81ba83a3de9b0) / [结算](https://testnet.monadscan.com/tx/0xbeefe3b573e68ae43d5fdc1de74994bd4e05facce1438180b9519799d1e1b186) |
| 主动取消 `buyer_cancelled` | `54 / 0 / 0 / 48` | `0.100000` | `0.005460` | `0.094540` | [锁款](https://testnet.monadscan.com/tx/0xc7569f463a0eae3f52a72b2992287596d5da6c54b42f51b1a0085406f7f8e1ef) / [结算](https://testnet.monadscan.com/tx/0x898e0408ee9a8cc8b975bd159a967df9c799958e2ef0b6dca061d062a9139c0f) |

首次取消 `936bec52-14c0-4600-b662-349e0c17481d` 未赶上约四秒的正常结束，实际正常收费；第二次 `69f22b8a-2986-4137-b484-851525b805b5` 的 CDP 点击超时，没有取消请求，慢速 Provider 随后触发 Router 卖家超时，实际按 SellerFailed 零收费。两者分别保留为 `extra_normal` / `extra_timeout`，不计入取消通过。最后的 `4cf2c58f-99ec-41f4-a86c-5df785ab90ca` 才明确以 BuyerCancelled 结算，按已产生用量收费。测试曾将同一卖家减速为每 500 ms / 1 字符；结束后已恢复每 80 ms / 4 字符、normal、在线 2 槽位和报价 v1，未改业务源码、钱包或链上报价。

正常订单的历史区块回读显示：锁款前买家/卖家托管余额均为 `10 dUSD`；锁款后买家可用 `9.9`、授权锁定 `0.1`；结算后买家 `9.983420`、卖家 `10.016580`，授权已花费 `0.016580`、剩余 `4.983420`、锁定 `0`。这次可直接核对不同买卖钱包的资金变化；卖家和 Router 仍为同一既有钱包，也不是两个卖家的验证。

八单最终汇总（结束区块 `59815413`）：买家托管 `10 → 9.921493`，卖家托管 `10 → 10.078507`，总费用及授权已花费均为 `0.078507 dUSD`，剩余授权 `4.921493`，锁定 `0`。随后 RPC 当前账户快照与页面余额相符，买家钱包还有 `990 dUSD`、`0.959594944` 测试 MON。缓存对比另核对相同买家、卖家、模型与报价版本，以及输入桶互斥；它证明 Mock 分类和结算，不证明真实模型缓存。

只读复核方式见 [运行手册](runbook.md#只读复核浏览器测试网证据)。Router 在八单后曾剩 `0.171218074 MON`，随后官方免费水龙头补给 `1` 测试 MON，[成功回执](https://testnet.monadscan.com/tx/0x44d637cfc215ef77892410ed64e4b232de3b3144afb7100711452123eb87d035) 和区块 `59815722` 前后余额确认增至 `1.171218074 MON`。该独立补给写入 `routerFunding`，不计入八笔推理订单，不改变买家资产或权限。最新 Gas 快照（区块 `59815861`）已满足按当时 Gas 价、最大已观察用量和 20% 余量估计的四单 `0.2264052384 MON`；后续演示前仍应重读，不能把该快照当作未来 Gas 保证。

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
| Monad Router / Provider | 重启后在线并完成多个浏览器场景 | `seller-monad` / quote v1；独立买家已验，第二卖家未接入 |
| Next 生产构建 | 上轮 `npm run build:web` 再次 exit 0，Next 16.3.4 | 覆盖钱包初始化与 dashboard 修复；本轮上手补丁有独立类型/lint 与浏览器结果，尚无补丁后的新生产构建记录 |
| Web lint | 本轮上手补丁后再次全量 `npm run lint --workspace web` exit 0 | **0 errors / 0 warnings**；之前的 5 errors / 1 warning 已解决 |
| Web TypeScript | 本轮主 agent 再次执行全 Web 类型检查 exit 0 | 覆盖当前上手补丁，根 TypeScript 不代替该检查 |
| Para 初始化修复 | 类型、配置解析器断言与实际冷刷新通过 | 新标签正常渲染，无空 session 和 Solana runtime 异常；这不代表登录已完成 |
| 浏览器市场/钱包入口 | 实际冷刷新与点击检查通过 | `seller-monad`、四项报价 v1；Chrome 已置前，确认真实 InferPool 邮箱弹窗 |
| 五页访客界面 | 独立应用内预览逐页检查通过 | 市场、账单、钱包与授权、API 接入、成为卖家；未登录提示与禁用操作符合预期，无 RuntimeError；未打断 Chrome 验证码流程 |
| 浏览器钱包登录/平台会话 | 用户完成后在 Chrome 实际核对通过 | 新地址不同于卖家；受认证账户数据显示可用 `0`、授权 `0`，运行请求入口可见 |
| 浏览器资金与请求场景 | 资金准备及六种目标场景、两次额外尝试共八单已确认 | 含实际主动取消；Chrome 与独立 RPC 相符，不同买卖钱包余额、订单、授权与总账均核对通过；没有第二卖家、钱包切换或断连/幂等浏览器验收 |
| 浏览器账单列表与详情 | 八行账单均显示已确认，可选单查看详情 | 主 agent 实际界面核对，与八单公开记录一致 |
| 浏览器 API Key 生命周期 | 临时 Key 创建、离开后仅 preview、撤销提示均实际检查通过 | 凭证输出脱敏且不保存、不复制，未用该 Key 发 API；真实 HTTP 请求由前序独立 API smoke 覆盖 |
| 上手补丁检查 | 实际文件 eslint / 全 Web TypeScript 通过，地址、href 与复制反馈已核对 | 复制按钮显示“钱包地址已复制。”；不以该反馈扩大到其他未测交互 |
| 本轮提交前检查 | 目标文件凭证格式扫描无匹配，Web 环境文件仍被忽略 | 主 agent 汇总；只读复核脚本根类型检查和目标差异/新文件空白检查通过；不是对所有凭证形态的保证 |

本次 full Para SDK 的初装审计曾报告 120 项问题（含 Cosmos 依赖路径的 2 项 critical）。切换 Lite 内嵌钱包并移除不需要的多链/外部连接依赖后，当前审计为 **19 项：12 low、7 moderate，零 high/critical**；这不代表完全没有依赖风险。CLI 3.18 的 doctor 对 Lite/`ParaProviderMin`/无外部钱包配置存在静态规则误报，已按本机源码确认；实际浏览器结果另列，不能称为 doctor 全通过。

移除旧 SDK 时 npm Arborist 回滚曾报 `from undefined`。已用只含 package manifests 的干净临时目录重新解析 lock，正式 `npm ci` 成功（770 installed / 774 audited）。服务已恢复，Mac 解锁后完成上述 Chrome 验收；历史失败及解决过程保留在对话日志。

## 下一步

1. 本轮六种目标场景、总账核对及 Provider 速度恢复已完成。后续演示前检查 Router 测试 Gas、服务在线、消费授权有效期与余额。
2. 尚未覆盖的浏览器钱包切换、断连/幂等重试、卖家报价发布，以及提款/离线回收交互，按下一轮范围补验；已有合约/本地测试不能直接计作浏览器通过。
3. 若增加 Monad 第二卖家，按 [会话隔离规则](runbook.md#增加第二卖家时保留-router-会话) 接入不同钱包并保留 Router 会话；已完成的独立买家不是第二卖家。
4. 公网入口与演示材料按交付要求继续准备；实现代码已推送，公网服务仍未部署或验收。

产品问题已足够明确，以上是开发与验证事项。登录或签名确需本人处理时再请求用户参与，不重复确认已授权的常规配置。

## 后续更新约定

每次里程碑更新对应行，并追加具体命令/场景、环境、结果和证据；失败也记录，不把“计划测试”改写成“测试通过”。新的决策进入 [决策记录](requirements-and-decisions.md)，用户的新要求进入 [对话日志](conversation-log.md)。
