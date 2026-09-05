# InferPool 比赛提交材料

> 地址脱敏说明：`demo.example.com` 为占位域名，不是实际部署或验收地址；本文历史验证记录指向清理前的真实地址。

版本：2026-09-05，Asia/Shanghai。**提交文案待填表；应用已上线 https://demo.example.com，尚未提交比赛。** 已读取 Monad Blitz 官方参赛、演示与提交要求。原生 MON 新市场及同钱包 8 笔实链交易已通过，公网此时仍旧 dUSD 版、准备切换；历史截图和多钱包验收不改资产。正式演示为每队 5 分钟，3 分钟仅作压缩备用；LOGO、预览图、简介、可用预览链接和 GitHub 链接为提交必需项。以下介绍按实际表单裁剪，不把整页规则和证据粘入项目简介。

## 已核实的比赛要求

来源：[Monad Blitz 官方入口](https://monad-foundation.notion.site/Monad-Blitz-e906367594f28338955f0140f791eb4a) → [官方参赛要求页](https://monad-foundation.notion.site/7546367594f2835ba564814eae664af9)。主 agent 于 2026-09-05 实际读取页面后记录以下要求；参赛资格与提交完成情况仍需逐项核对。

| 官方要求 | InferPool 当前状态 / 未决项 |
| --- | --- |
| 队伍最多 3 人 | 用户明确独立参赛、队名 InferPool；MOJO 已建队，实际显示仅邀请、1/3，用户为队长 |
| 必须是为本次活动原创的新项目，不可 fork 现有项目；标准库和样板例外 | 开发过程有 Git 和对话记录；依赖标准库不等于复用现有成品项目，项目原创性与时间资格仍按实际来源和活动窗口核对 |
| 编码和资源须在正式活动时段开始；允许提前研究/规划，GitHub 代码提交也须在比赛期间 | 目前 Git 提交均为当天 12:29–14:40（Asia/Shanghai）；实际起工和现场允许编码起点尚待确认，提交时间不能独自证明合规 |
| 提交材料须公开，例如公开 GitHub 仓库 | 主 agent 已用 `gh repo view` 确认 [仓库](https://github.com/onekb/Hackathon260905) 为 PUBLIC、默认分支 main；LOGO、截图、说明图和简介已备，正式上传与提交待完成 |
| 应用部署到 Monad，并保持长期可用 | 已有 Monad 测试网部署和交易证据；应用的长期运行尚未验收，合约存在不代表服务持续可用 |
| 前端必须公网部署并保持长期可用 | 应用已上线 https://demo.example.com，页面/配置与常驻 A 的 WSS 已验收；新增远端订单后端/链上已核对，客户端来源与 SSE 交互未验；长期可用仍需维持服务并续批会话；历史本机预览不能替代此要求 |
| 在 MOJO 注册、组队、提交并投票；仅队长提交项目详情；提交阶段开始后不可再加入队伍 | 已重新读取 [惠州活动 16](https://mojo.devnads.com/events/16)：2026-09-05、进行中；InferPool 为 1/3、用户队长。项目入口仍可创建，尚未提交项目或投票 |

以上是参赛要求，不是全部满足声明。“长期可用”目前没有在已读取内容中得到具体天数，不自行填入期限。用户的单人/队名决定及 MOJO 建队、队长状态已经确认；实际提交表单已只读核查，当前未见保存草稿按钮，未填写、上传或提交项目。不记录个人真名或邮箱。

### 日程、演示与提交附件

主 agent 实际读取 [官方活动页计划表](https://monad-foundation.notion.site/Monad-Blitz-e906367594f28338955f0140f791eb4a)：提交截止标为 **6:30 PM / 18:30**，演示为 **7–8 PM**，投票为 **8–8:20 PM**。页面未明确日期或时区，另有中午 AM 排版异常；以上按原计划表记录，**现场口径为准**，不能直接生成带日期/时区的精确倒计时。

[官方演示要求](https://monad-foundation.notion.site/b816367594f283ddae4b81b6ebc0baf7) 明确每队 **5 分钟**，核心是实际运行在 Monad 测试网的实机演示；需简述构建内容、关键技术挑战和创新，听众为开发者同行。Slides 可选；截图或短视频作为故障后备是建议，不是新增必交视频附件。对应 [正式五分钟与压缩脚本](demo-guide.md)。

[正式提交说明](https://monad-foundation.notion.site/e6b6367594f28317b5fd0100fb466b12) 要求 **LOGO、预览图片、详细介绍、可用预览链接、GitHub 链接**。介绍应简洁说明特点与创新，避免冗长生成文案；提交后等待审核。当前未提交，不能把“已提交”或“已审核”作为本阶段完成状态。原创 LOGO、说明预览图、两张真实本机 UI 截图与新增公网访客截图均已保存并检查，彼此用途区分如下。

### MOJO 实际创建表单

主 agent 已只读核对 [项目创建表单](https://mojo.devnads.com/projects/new?eventId=16)：

| 当前可见字段 | 要求与准备情况 |
| --- | --- |
| 项目名称 | 必填，页面推荐中文；现有项目名为 InferPool，尚未填写表单 |
| 前端演示地址 | 必填；目标为 `https://demo.example.com`，远端 DNS、对应前端构建与 TLS 证书检查已通过，Router 已启动，公网页面与常驻卖家 A 的 WSS 已验收；可用作当前应用预览，新增远端订单已核对后端/链上结算，来源未知；新域名钱包登录及浏览器/SSE 交互仍未验，尚未填入或提交 MOJO |
| GitHub 链接 | 必填，公开仓库已就绪 |
| 关联活动 | 必填，本轮入口关联活动 16，尚未提交 |
| 项目截图 | 标星必填，横屏、最多 5 张、第一张为封面；指南要求至少一张展示核心功能。已有真实市场和账单截图，建议按此顺序选择 |
| 项目文档 | 富文本编辑区，使用下方精简介绍并按需要补充功能/创新和证据 |

页面当前只看见“提交项目”，没有看见“保存草稿”；不能假定填写后已保存。本轮未填写、上传或提交。官方 Notion 提到 LOGO，但当前表单未见独立 LOGO 输入；保留已准备 LOGO，实际必传截图使用真实 UI，说明图只作辅图，不冒充运行截图。

## 2026-09-05 活动要求复核（Asia/Shanghai）

**结论：技术部署与材料已具备参赛基础，但还不能声明所有活动要求已经满足。** 编码时间资格、MOJO 正式提交/投票和现场五分钟演示仍需完成或确认；主办方是否认可资格、最终审核和获奖均不由这份自查决定。以下依据主 agent 本轮重新读取的官方页面与当前可检查证据；另参见 [活动准备页](https://monad-foundation.notion.site/6306367594f28359a7a001113eaca8b2) 与 [AI Coding 指南](https://monad-foundation.notion.site/AI-Coding-63a6367594f28338bbd3017f936a88cc)。

| 检查项 | 当前判断 | 证据与尚需处理 |
| --- | --- | --- |
| 人数、活动与队长 | 已确认 | MOJO 为 2026-09-05 惠州活动 16；InferPool 1/3、用户队长，符合最多 3 人的数量要求 |
| 新项目与允许编码窗口 | 待确认 | 规则禁止 fork 现有项目，但标准库/样板例外。当前 10 次 Git 提交，首/末为当天 12:29:32–14:40:56；首提交已包含业务代码，不能等同编码起点。部分业务文件 birthtime 为约 11:25，仅属弱线索，不证明实际起工时刻。已向用户询问现场允许开始编码时间，未收到回答前不能判定资格 |
| Monad 与公网前端 | 当前部署已通过 | 已部署测试网业务合约和常驻应用；公网页面、配置、卖家 A 的 WSS 与 Para 弹窗入口通过。一卖家当前在线，不能将历史两卖家截图当作当前公网在线状态 |
| 持续可用 | 有条件具备，需评估额度与续批 | 两服务 enabled/active；14:50 快照全局还可新建 9 次（本场总 10 次，不每日恢复），B 当 UTC 日还剩 5 次（每日上限 6）。额度用完仍可读账，但不能继续创建新单；需评估评审交互额度。Linux 会话到期 2026-09-12 14:33 Asia/Shanghai，持续签名需续批。限制是项目现状，并非新增赛事硬规则；官方未给具体长期天数 |
| 公开仓库与素材 | 已准备，未提交 | 公开 main、LOGO、真实截图、说明图、简介和可访问预览链接已具备；实际 MOJO 表单仍未填写、上传或提交 |
| 测试网实机演示 | 证据与脚本已准备，正式演示未完成 | 五分钟以真实 Monad 测试网实机为核心；Slides 可选、视频后备为建议。新域名钱包与 SSE 路径尚未由本轮 agent 进行交互验收；新远端订单已核对后端/链上成功但来源未知，不能用它或历史本机测试替代完整界面验收 |
| 评审内容 | 准备说明，不能量化保证 | [官方评审页](https://monad-foundation.notion.site/5d46367594f283769ed581e2837b39c7) 由评委综合核心要求、项目完成度及未来商业模式合理性判断；未给固定权重。应清楚说明收费/故障机制、价值与后续真实模型接入计划，不虚构收入或获奖概率 |
| MOJO 提交与投票 | 未完成 | 注册和建队不等于提交；项目页面仍显示可以创建项目。提交、审核、现场演示和投票分别记录，不替用户执行 |

**AI 与数据存储规则的边界：** [官方 AI Coding 指南](https://monad-foundation.notion.site/AI-Coding-63a6367594f28338bbd3017f936a88cc) 推荐 AI 编码工具与 Monskill；其中“不要 Web2 数据库”属于竞拍项目的示例 prompt，不能扩大为所有参赛项目的通用禁令。已读取的规则中未发现强制真实大模型、TEE 或某款 AI 工具的要求。InferPool 仍应明确披露 Mock 推理/计量、真实测试网结算与可信 Router 边界；未见禁止不等于主办方已经认可具体方案。

本轮公网只读复查确认迁移后第 15 条订单在 14:47:56–14:48:20（Asia/Shanghai）完成：B → A，预算 0.1、费用 0.014160、释放 0.085840 dUSD，成功回执与链上订单一致。来源仍未确认，本轮 agents 未发单；只能说明远端后端及链上成功，不代表由本轮 agent 完成浏览器/SSE 端到端验收。详见 [进度](progress.md#活动要求复查与新增远端订单)，单独记录，不混入先前测试集。

### MON 活动水龙头与 dUSD 的区别

[Monad Gas 文档](https://docs.monad.xyz/developer-essentials/gas-pricing) 明确交易费用使用 MON 支付；本项目所用 MON 是测试网原生 Gas 资产。前序 dUSD 是 InferPool 在同一测试网（chain ID 10143）部署的 DemoUSD ERC-20，曾用于演示服务计费；D17 已要求其退出产品，正式方案仅原生 MON。dUSD 没有现金价值或美元储备，也不会自动兑换 MON；领取 MON 不会自动增加 dUSD、托管余额或应用请求次数额度。

开发记录显示使用官方 agent 水龙头分别给买家和 Router 补充过 1 MON，见 [浏览器链上证据](../contracts/deployments/inferpool-smoke-browser-monad.json) 的 `transactions.faucet_native` 与 `routerFunding`。前轮澄清时尚未使用 MOJO 100 MON 活动水龙头；用户随后明确授权迁移与领取，现已给原 Router 领取 100 MON 并核对成功回执，见 [迁移资金记录](progress.md#原生-mon-迁移水龙头与本地验证)。这不表示已查询用户在开发记录之外的领取行为。

已读取的 [活动规则](https://monad-foundation.notion.site/7546367594f2835ba564814eae664af9) 要求应用部署运行于 Monad，未见要求所有业务付款必须使用原生 MON，或必须领取该活动水龙头的条款。这是本轮规则阅读范围内的判断，不是整体参赛资格保证。前轮仅说明资产区别；后续 D16 授权的 100 MON 领取现已完成，但没有增加 dUSD 或应用请求额度，原生支付新版仍在实施。

## 可直接填写的精简介绍

**中文：** InferPool 是部署于 Monad 测试网的 AI 推理市场原型。独立卖家分别设置输入、输出和缓存价格，买家通过网页或 API 指定卖家或自动比价，并为每次请求设置预算。合约先锁款、按实际用量结算、释放余款；卖家故障整单推理费为零。我们已验证两个不同钱包卖家的选择和跨钱包结算，链上回执与账单、余额相互核对。关键实现包括无需导出私钥的网页钱包节点认证，以及锁款结果不明时保留原订单、避免重复派单。本次推理和计量为 Mock，钱包与资金交易是真实测试网操作；平台仍负责链外计量和判责。

**English:** InferPool is an AI inference marketplace prototype on Monad Testnet. Independent sellers quote input, output and cache prices; buyers select a seller or use cost-based matching through a web app or API, with a budget for each request. Contracts reserve funds, settle measured usage and release the remainder. Seller failures waive the entire inference fee. We verified two seller wallets, cross-wallet settlement and agreement between receipts, bills and balances. Key engineering work includes browser-wallet node authentication without exporting keys and preserving uncertain reservations to prevent duplicate dispatch. Inference and metering are mocked; signatures and financial transactions are real testnet operations. The Router remains trusted for off-chain metering and fault attribution.

## 项目一句话

**中文：** InferPool 是一个带单次预算的 AI 推理市场原型，让独立卖家自行报价，买家通过网页或统一 API 使用服务，并在 Monad 测试网上完成资金托管与按量结算。

**English:** InferPool is a budget-controlled AI inference marketplace prototype where independent sellers set their own prices and buyers use a web app or unified API, with escrow and usage-based settlement on Monad Testnet.

## 中文提交文案

### 项目解决什么问题

当买家需要在不同推理服务之间选择时，输入与输出价格、缓存费用、单次预算和故障责任需要放在一起比较。InferPool 把这些信息放进一个市场：卖家独立发布四项报价，买家指定服务方或按预计总成本匹配，并为每次请求设置花费上限。

### 我们构建了什么

新版买家通过邮箱钱包登录网页，存入原生测试 MON 并设置金额与期限明确的消费授权，无需 ERC-20 approve。正式产品仅 MON；旧 dUSD 只作私有账本/公开回执归档，无产品操作入口。每笔请求先锁定预算，再由独立卖家进程返回流式输出，最后按用量结算、释放剩余预算。卖家故障整单推理费为零；买家主动取消支付生效前的实际用量。开发者也可通过 API Key 调用同一个市场。

本次原型的 AI 输出、Token 计量和缓存均为 Mock；钱包签名、链上报价、预算锁定、结算和余额变动是真实的 Monad 测试网操作。当前原生 MON 为测试网资产，不代表真实收入；旧 dUSD 证据只作历史存档。

### Web3 与 Monad 如何发挥作用

新版 Monad 测试网 InferenceMarket 使用原生 MON，保存报价、托管、限额授权和订单；旧 dUSD 代码/ABI/界面/兼容读取退出产品，旧公开回执仅作历史存档。Router 只能在授权和预算内锁款，并按订单固定报价结算；余额所有者保留提款权，买家可在订单过期后直接回收锁款。API Key 不拥有提款权，也不能扩大链上授权。

我们用真实测试网交易展示这些资金规则，而不是把结果只记录在平台数据库里。首版仍信任 Router 的链外计量与故障判定，合约不验证模型身份、输出质量或用量真实性。没有宣称去中心化推理验证，也未开展 Monad 吞吐或成本对比基准。

### 当前成果

业务合约已部署并完成源码验证。两个不同钱包的卖家以不同报价运行独立进程，指定卖家、短输入自动选 B、长输入自动选 A 及网页手动选择覆盖自动估价均已验收。跨钱包结算已独立核对回执、订单、用量、双方余额与授权变化；其中自动选 A 的 API 场景买卖双方同为 A，未将其包装成第三个独立钱包。

前序浏览器完成正常、卖家故障、金额预算上限、缓存写入/读取与主动取消六种目标场景。真实锁款异常及一次受限恢复也保留在公开证据中。双卖家阶段根 Node 64 项、Foundry 38 项、Web 类型检查、lint 和生产构建通过；限额/代理阶段 76/76 已通过并完成审阅，单端口阶段根 82/82 通过；D16 原生迁移根 92/92 通过；D17 清理后新合约 41/41 与 Web 类型/lint/资产 4 项/静态构建通过，D17 根 91/91 与类型检查已通过，前端最新补丁构建待完成。原生新市场已部署/验证，8 笔同钱包合约交易正常收费 .000110 MON、失败零费并成功提款；公网仍待切换，独立买卖/SSE/浏览器 MON 验收未完成。应用已部署到 https://demo.example.com，页面、配置、常驻 A 的 WSS 和 Para 弹窗入口通过；新增远端订单后端/链上结算已核对，但来源未知；新域名登录与浏览器/SSE 交互仍未验，完整范围与限制在仓库文档中持续维护。

## English submission copy

### Problem and solution

Inference buyers need to compare input, output and cache prices while controlling the cost and failure policy of each request. InferPool brings these choices into one marketplace. Sellers publish separate prices; buyers select a seller or use estimated-cost matching, set a per-request spending cap, and receive streamed results through a web app or unified API.

The native-MON version uses an embedded email wallet, payable MON deposits and a separate limited spending grant, without ERC-20 approval. The product is MON-only; old dUSD records are archived without legacy UI or compatibility reads. The marketplace reserves each request's budget before dispatch. Settlement charges measured usage and releases the remainder. Seller failures waive the entire inference fee; an explicit buyer cancellation pays for usage accepted before cancellation takes effect. Spent blockchain gas is not refunded.

### What is on Monad

The new InferenceMarket on Monad Testnet uses native MON for seller quotes, escrow, bounded spending grants, reservations and settlement. Legacy dUSD source, ABI and UI are removed; prior receipts remain historical evidence, not product functionality. API keys cannot withdraw funds or enlarge a grant. Buyers can reclaim expired reservations directly through the contract.

Inference output, token metering and cache behavior are mocked for this hackathon prototype. Wallet signatures, quotes, escrow transactions and settlement are real testnet operations. The Router remains trusted for off-chain metering and fault attribution; the contracts do not verify model identity, output quality or the truth of reported usage. MON is a testnet asset here, not evidence of real revenue; earlier dUSD records remain archives. We make no measured throughput or cost-comparison claim about Monad.

### What we verified

Two independent seller processes with different wallets and on-chain prices completed explicit selection and automatic matching scenarios. A separate browser request demonstrated a manual seller choice overriding the cheaper automatic candidate. Cross-wallet receipts, orders, usage, balances and spending grants were independently reconciled. One automatic-routing case used the same wallet as buyer and seller; this overlap is documented.

Earlier browser acceptance covered normal completion, seller failure, spending caps, cache write/read and explicit cancellation. An uncertain reservation, its confirmed zero-fee failure and one guarded retry are preserved rather than omitted. The two-seller phase passed 64 root Node tests, 38 contract tests, Web type checks, lint and production build. The optional admission/proxy phase passed 76 root tests and review. The shared-port phase passed 82 tests; native migration now passes 91 root tests, 43 contract tests and Web checks. The deployed native market passed eight same-wallet setup/settlement/withdrawal transactions, with normal charge .000110 MON and seller failure zero; independent-wallet and browser/SSE MON acceptance are not established. The public application is now available at https://demo.example.com: page/config checks, seller A WSS authentication and the login modal passed. A new post-migration order was independently reconciled on the remote backend and chain, but its client origin is unknown. This does not establish browser login or incremental SSE delivery on the new origin; earlier interactive acceptance used the localhost frontend.

## 架构与实现索引

请求路径：**买家 Web / API → Router → 独立 Provider**。卖家主动建立认证 WS/WSS 连接，不要求向买家发布公网地址。资金路径：**钱包 → 托管合约 → 按单锁款 → 卖家可用托管余额 / 买家剩余预算**。链外 Router 负责匹配、Mock 计量、判责和订单状态，合约约束资金。

| 组件 | 技术与作用 | 实现 |
| --- | --- | --- |
| 买家 Web | Next.js / React、Para Lite 内嵌 EVM 钱包、viem；市场、账单、资金、API 与报价 | [Web README](../web/README.md) |
| Router | TypeScript 服务；钱包认证、API Key、SSE、定价、幂等订单与结算 | [Router README](../server/README.md) |
| 卖家客户端 | 独立 Node.js 进程、认证 WS/WSS、本地控制台；支持 Para 网页钱包签署受限节点认证挑战 | [Provider README](../provider/README.md) |
| 链上市场 | Solidity、Foundry；报价、托管、授权、预算、结算与到期回收 | [合约 README](../contracts/README.md) |

完整图示、四项费用公式、权限及隐私边界见 [架构与协议](architecture-and-protocol.md)。下一版可评估真实模型适配与可信执行/投诉证据机制；TEE、质押和罚没尚未实现。

## 可验证成果与引用

下面各组属于不同验收阶段，不把余额区间或单数混合相加。源码验证不等于安全审计；自动化测试不等于所有浏览器交互均已通过。

| 成果 | 证据 | 范围 |
| --- | --- | --- |
| Monad 10143 合约部署与源码验证 | [部署 JSON](../contracts/deployments/inferpool-monad-testnet.json)、[市场合约](https://testnet.monadscan.com/address/0x6F1b725DD3588cb5c8C3f72F614E80ebB2d82568) | 自建 [DemoUSD](https://testnet.monadscan.com/address/0x62701D69bD213e8F63c28465528931de208cE06E)，全为测试资产 |
| 独立买家浏览器六种目标场景 | [八单公开证据](../contracts/deployments/inferpool-smoke-browser-monad.json) | 八单含六种目标场景和两次额外尝试，总费用 `0.078507 dUSD`；并非八种场景全成功 |
| 两卖家 API 指定与自动匹配 | [市场证据](../contracts/deployments/inferpool-smoke-market-monad.json) 的 `cases` / `aggregate` | 三笔成功单，授权增量 `0.041120 dUSD`；跨钱包 A → B `0.023340`，A 自身费用回流 `0.017780` |
| 网页手动覆盖自动匹配 | 同一市场证据的 `webManualOverride` | 独立第四单 B → A `0.016580 dUSD`；点击依据来自浏览器/账本观察，合约不保存 manual/auto 标记 |
| 原锁款异常与恢复 | 市场证据的 `failedAttempts` | 原单零费用、到期链上无订单后，显式执行唯一一次受限重试；不等于 Alchemy 异常根因已经修复 |
| 原生 MON 合约与同钱包交易 | [新部署](../contracts/deployments/inferpool-mon-native-testnet.json) / [8 笔实链证据](../contracts/deployments/inferpool-native-monad-smoke.json) | 验证 2/2、正常 .000110 MON、卖家失败 0、提款 .001，最终无锁款；不证明独立钱包或公网界面 |
| 测试与 UI 验证 | [进度](progress.md#验证记录与覆盖边界) | D16 根 92/92；D17 合约 41/41、Web 检查通过，D17 根 91/91 与类型检查已通过，前端最新补丁构建待完成；旧阶段计数不累加，旧 dUSD UI 证据不改标 MON |

## 已完成的图形素材与真实截图

| 文件 | 用途与已完成检查 |
| --- | --- |
| [LOGO PNG](../artifacts/submission/inferpool-logo.png) / [SVG](../artifacts/submission/inferpool-logo.svg) | 原创 IP 图形；512 × 512 PNG、透明背景，适合深色底；尺寸、透明度与目视检查通过 |
| [项目说明 PNG](../artifacts/submission/inferpool-project-overview.png) / [SVG](../artifacts/submission/inferpool-project-overview.svg) | 1600 × 900，深色与绿色；表现买家、Router、独立卖家和链上预算/结算，并标明 Mock 与真实测试网结算；无裁切或文字错乱 |
| [公网市场截图](../artifacts/submission/inferpool-public-market.jpg) | 1713 × 1452 原始 JPEG；https://demo.example.com 访客市场、一在线 A，未登录故余额/授权为破折号；主 agent 目视检查通过，建议当前封面 |
| [本机市场截图](../artifacts/submission/inferpool-market-live.jpg) | 1713 × 1452 JPEG；历史两卖家在线，托管 `9.928253`、剩余授权 `4.904913 dUSD`；本机来源的补充材料 |
| [真实账单截图](../artifacts/submission/inferpool-bill-live.jpg) | 1713 × 1108 JPEG；已核验历史单 `69a28714…`，费 `0.016580`、释放 `0.083420 dUSD`，输入 54、输出 187；建议第二张 |

说明图明确标注 **Not a product screenshot**，不包含虚构指标、实时节点数量、个人信息或公网完成声明。两张最终 PNG 已目视检查，SVG 已验证 XML 与外部资源；源文件与复现命令见 [素材 README](../artifacts/submission/README.md)。这些检查不证明实际产品画面、公网链接或业务交易已通过。

两张 `*-live.jpg` 来自 `http://127.0.0.1:3000` 连接真实 Monad Router 的原始浏览器 JPEG，主 agent 已保存并用 `view_image` 确认可用。没有修改像素或账单数值，只在 UI 收起 Next issue 提示；开发/扩展图标仍可见。截图没有产生新付费订单，不是公网部署证据，也不是当前余额永远不变的保证。新增 `inferpool-public-market.jpg` 来自真实公网访客页面，未改像素、无凭证，显示当前一在线卖家；不能据此宣称新域名钱包登录或交易通过。公网 Para 弹窗已打开后关闭，无登录、充值、签名或请求。录像尚未制作。

## 提交表单待填项

| 字段 | 当前可填写内容 |
| --- | --- |
| 项目名 | InferPool |
| 代码仓库 | [onekb/Hackathon260905](https://github.com/onekb/Hackathon260905)；单端口提交 `319c6b9` 已通过 SSH 推送至 origin/main，具体版本以 Git 记录为准 |
| 网络 | Monad Testnet，chain ID `10143` |
| 主合约 | 新原生 MON：`0x142a4904307244Bed0cECD72dE8329A253333182`；公网仍待切换，旧 dUSD 地址与历史另存 |
| 公网 Demo | [https://demo.example.com](https://demo.example.com) 已可访问；Linux 钱包已批准，原账本已安全迁移、Router 已 enable/start；用户 HTTPS 代理下 /health 200，早期 502 已解决。公网页面、配置、常驻 A 的 WSS 与 Para 弹窗入口已通过；B 卖家离线；新增远端订单的后端/链上成功已核对，但来源未知，新域名钱包登录与浏览器/SSE 交互未验 |
| LOGO（官方说明要求） | 原创 PNG / SVG 已完成并检查；实际表单未见独立输入，尚未上传比赛 |
| 项目截图（表单必需） | 公网访客市场 JPEG 作封面；历史本机账单/双卖家市场保留来源说明，说明图可作辅助，全部已保存并检查；尚未上传比赛 |
| 详细介绍（必需） | 优先使用本页精简介绍，按实际表单补充特性与创新，避免整页粘贴 |
| 演示视频 / Slides | 非已确认必交附件；官方建议截图/短视频后备、Slides 可选，当前未生成视频；已有 [5 分钟正式 / 3 分钟压缩脚本](demo-guide.md) |
| 比赛与规则 | Monad Blitz 来源见上方；计划表截止为 18:30，页面未明确日期或时区，现场口径为准；MOJO 已确认 2026-09-05 惠州活动 16 进行中；现场编码起点及最终截止口径仍待核实 |
| 提交平台与团队 | [MOJO](https://mojo.devnads.com/events/16) 已登录并建队；独立参赛、队名 InferPool、仅邀请、1/3，用户为队长；未邀请他人或提交项目 |
| 团队联系信息、许可要求 | 按实际提交者与比赛规则填写，不从登录记录推断 |

尚未验收的新域名钱包登录与浏览器/SSE 交互、实际买家钱包切换、浏览器断连/幂等和部分资金控制交互不得改写为已完成。发布与比赛提交分开记录：仓库已推送、Demo 上线、视频完成和表单提交是四个不同结果。
