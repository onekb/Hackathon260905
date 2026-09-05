# 运行与部署手册

> 地址脱敏说明：`demo.example.com` 为占位域名，不是实际部署或验收地址；本文历史验证记录指向清理前的真实地址。

下面区分本地复现、既有 Monad 合约和公网发布。部署地址见 [进度](progress.md)；执行状态不由本手册中的命令存在与否证明。

## 本地双卖家演示

需要 Node.js ≥ 22.13、npm、Foundry 的 `forge` 和 `anvil`。从仓库根目录执行：

```bash
npm ci
npm run setup:contracts
forge build --root contracts
npm run demo
```

依赖安装脚本固定 OpenZeppelin 5.4.0 与 forge-std 1.9.7 的归档摘要，说明见 [DEPENDENCIES.md](../contracts/DEPENDENCIES.md)。脚本保护已有依赖目录，不覆盖本地修改。

`demo` 启动或复用本地 chain ID `31337` 的 Anvil，部署一组新合约，准备买家余额/授权与两组不同钱包报价，然后启动 Router、两个独立卖家进程并生成本地 API Key。

| 服务 | 地址 |
| --- | --- |
| Anvil RPC | `http://127.0.0.1:18545` |
| 本地 Router | `http://127.0.0.1:8787` |
| 卖家一控制台 | `http://127.0.0.1:8791` |
| 卖家二控制台 | `http://127.0.0.1:8792` |

显示 `Local demo ready` 后，在另一个终端运行：

```bash
npm run demo:request
npm run demo:request -- --cache
```

重复缓存命令可观察首次写入、再次读取。切换卖家一为 `fail-mid` 再发新请求，观察部分输出后整单零费用。SSE 断开不取消；取消接口使用响应中订单 ID。

`.local/deployment.json` 保存本次本地地址；`.local/demo-credentials.json` 保存本地演示凭证，脚本自动读取，不需要打印。`Ctrl+C` 停止本脚本启动的进程，复用的已有 Anvil 保留。重新运行会部署新地址，不要沿用旧环境文件。演示使用公开的 Anvil 测试身份，仅用于本地链。

## 既有 Monad 测试网

手动运行的全部变量见根 [.env.example](../.env.example) 和 [Router README](../server/README.md)。程序不自动读取这个模板；使用本机环境文件显式导出配置，实际 `.env`、`.local/` 和含凭证的 RPC 地址不提交。

当前业务合约已经部署，复用时不要重新部署 Counter 或把 Counter 地址当市场。公开 RPC 为 `https://testnet-rpc.monad.xyz`，chain ID 必须是 `10143`；地址与回执以 [inferpool-monad-testnet.json](../contracts/deployments/inferpool-monad-testnet.json) 为准。

Router 使用现有 Alchemy session 签名，session 地址必须与市场 `router()` 一致。本次已完成授权；仅首次或过期时由用户完成：

```bash
alchemy auth
alchemy wallet connect --mode session
```

不向 Router 注入私钥，也不把会话文件或终端认证输出复制进文档。卖家 Alchemy session 适配目前明确支持 CLI `0.24.0`，升级后需重新验证兼容性。

已存在的部署配套脚本：

```bash
npm run setup:monad
npm run test:monad
```

这两个脚本可能发送真实测试网交易并消耗测试 MON，作用范围不是通用账户部署器。`setup-monad.ts` 固定核对已授权 Router 地址、已部署 token/market：一次水龙头、最高补足首次 `10 dUSD` 存款、`10 dUSD`/一天消费授权和 `mock-reasoner` 报价。已经做过首次存款后不会默默补充后续消耗。`smoke-monad.ts` 用固定订单 ID 检查正常收费与卖家失败，重复执行优先读取已有状态；到期未结算订单需要回收，不会绕过截止时间。

脚本的测试买家、卖家和 Router 是同一 session 钱包，**不是独立多卖家场景**。五笔设置交易与四笔锁款/结算交易的证据分别在 [setup](../contracts/deployments/inferpool-setup-monad.json) 与 [smoke](../contracts/deployments/inferpool-smoke-monad.json)。

启动测试网 Router 时，可加载设置脚本生成的本地环境文件，然后显式覆盖本次运行端口与 Origin：

```bash
set -a
source .local/monad-router.env
set +a
export HOST=127.0.0.1
export PORT=8788
export ROUTER_PUBLIC_URL=http://127.0.0.1:8788
export ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000
npm run dev:router
```

环境文件生成时默认 URL 为 `8787`；使用 `8788` 是为了与本地双卖家演示并存，必须同时覆盖 `PORT` 与 `ROUTER_PUBLIC_URL`。`ROUTER_STATE_PATH` 应保持一个固定绝对路径、由一个进程独占。不同链/不同市场不能混用订单状态文件。

在另一终端启动已报价的 session 卖家：

```bash
npm run dev:provider -- --alchemy-session --router ws://127.0.0.1:8788/provider --id seller-monad --name "Monad 卖家" --port 8793 --min-reserve 0.0001
```

Alchemy session、`PROVIDER_PRIVATE_KEY`、临时钱包和浏览器钱包四种身份互斥；浏览器身份的源码、自动检查及首次实际认证/主动下线已通过，持续状态见进度。A 控制台地址为 `http://127.0.0.1:8793`，B 的配置和启动步骤见 [Provider README](../provider/README.md#使用-para-网页钱包)。只连接到平台还不代表有订单成交；需要检查 `/health`、`/v1/models` 和后续链上账单。

### 增加第二卖家时保留 Router 会话

当前 Router 和 `seller-monad` 依赖同一现有 Alchemy session。对 CLI 0.24.0 的只读调查确认：`--instance-name` 只是审批中显示的 CLI 实例标签，不是钱包地址或钱包选择器；官方 [Wallets and signing 说明](https://www.alchemy.com/docs/alchemy-cli#wallets-and-signing) 也如此定义。在原配置中重新连接 session 会先撤销已有 session，不能通过直接 `--force` 重连来增加第二卖家，否则可能中断 Router 签名与在途订单结算。

`ALCHEMY_CONFIG` 的值是**配置文件路径**，例如另一个目录中的 `.local/alchemy-seller-b/config.json`，不是目录本身。session 固定存放在该文件父目录的 `wallet-session.json`；因此只在同一目录换配置文件名不能隔离 session。仅让第二个 Provider 进程继承这个独立路径，不要全局 export 影响 Router，也不要复制旧会话作为“新钱包”。

目录隔离仍不保证产生第二个 EOA：当前 CLI 没有钱包 ID 选择参数；钱包创建和会话批准在 [Agent Wallets Dashboard 流程](https://www.alchemy.com/docs/agent-wallets) 完成。若走这一路径，必须实际获得目标钱包批准并读取不同地址。主 agent 后续实测当前 Dashboard 只显示既有一个 EVM 钱包，没有可见新增/切换入口，因此本轮改用下面的 Para 浏览器身份路径；不据此断言所有账户或未来 Dashboard 都不支持多钱包。

本机 `@alchemy/cli@0.24.0` 的证据位于包内 `dist/`：`index.js` 的 `registerWallets`（约 3575 行）列出 connect 参数，`runSessionConnect`（约 3030 行）先撤销旧 session 再清除并创建新请求；`chunk-JWQ557LG.js` 的 `configPath/configDir`（约 114 行）决定文件路径及父目录，`chunk-3KKE4OWO.js` 的 `sessionPath`（约 1714 行）决定 session 文件。升级 CLI 后需重新核对，不能沿用这些内部模块位置。

第二卖家验收需同时满足：不同钱包地址、自己的链上报价、独立进程与认证连接、能被单独指定请求。换 `provider_id`、实例名称或启动另一个进程都不够。上述 Alchemy 调查未切换钱包、重连/撤销 session 或发起交易；此前独立 Para 买家流程已通过，仍不能单凭买家存在宣称“双卖家”。

本轮采用 [D13](requirements-and-decisions.md#d13--浏览器钱包为独立-provider-签署认证挑战) 的浏览器钱包模式，已完成真实首次认证和主动下线检查：`--browser-wallet <address>` 与 `--wallet-ui <origin>` 绑定钱包和前端来源，本地控制台与 `/provider-connect` 以严格 origin/source 的 `postMessage` 传递 Provider 认证挑战，由 Para 签一次受限消息。此过程不导出私钥、不新增 Alchemy 会话或交易权限，本地 HTTP 继续要求 CSRF 与同源，不增加 CORS。节点初始离线，用户在弹窗准备好签名后才连接；每次只允许一次握手，最长 12 秒。控制台/弹窗需保留，断开后重新从控制台准备，不自动重连。

现有 Para 钱包兼任 B，现有 Alchemy A 作为测试买家；B 已在 Chrome 独立发布 `60 / 6 / 75 / 40` 报价，A 保持 `30 / 3 / 37.5 / 80` dUSD / 百万模拟单位。报价发布与节点认证分开；B 报价和主动下线→新弹窗重签→双在线已通过，逐笔交易结果见进度。短输入/大输出上限预期选 B，长输入/小输出上限预期选 A，另指定 B 验证跨钱包结算；A 买 A 时角色重合，不能记成第三个独立钱包。

### 两卖家 smoke 的准备与执行边界

[smoke-market-monad.ts](../scripts/smoke-market-monad.ts) 默认或 `--plan` 只做离线估价；B 报价可单独通过 RPC 复核。当前真实执行状态以进度页为准：

```bash
npm run test:market:monad -- --plan
npm run test:market:monad -- --verify-quote-b 0x8519952dd0ca072e121e76969e85207f67fbc2a4814127bc555fc4862689d612
```

后一个命令只读链上并更新本地 [公开证据](../contracts/deployments/inferpool-smoke-market-monad.json)，不会发布报价。真实执行会逐项追加 `cases` 和聚合结果；仅有报价记录、执行中的条目或文件存在均不表示三单已通过。

只有 `--execute` 会真实使用 Alchemy A 认证、创建临时 API Key 并提交三单，每单预算 `0.1 dUSD`。前提是 `seller-monad`（A，8793）和 `seller-para`（B，8794）分别在线、normal、无在途请求、链价匹配；Router 默认 `8788`。可通过 `SMOKE_ROUTER_URL`、`SMOKE_PROVIDER_A_URL`、`SMOKE_PROVIDER_B_URL` 覆盖本机地址，不接受外部控制台地址。

| 计划场景 | 输入 / 输出上限 | 预期选择与估价 dUSD |
| --- | --- | --- |
| `explicit_b` | `71 / 512` | 指定 B，估价 `0.024740` |
| `auto_short_b` | `56 / 512` | B `0.023840` 低于 A `0.042640` |
| `auto_long_a` | `550 / 16` | A `0.017780` 低于 B `0.033640` |

两家都必须满足预算准入，不能把排除了另一家的结果当作价格匹配。前两单为 A → B 跨钱包结算；第三单为 A 买 A，输出到 `max_tokens=16` 时记录 `BudgetCapped`，这里是输出上限，不是 `0.1 dUSD` 花完。表中估价按输出上限用于选择，不等于最终实际收费；执行结果见进度。

脚本固定幂等 Key 并保存 SSE 返回的请求 ID，重跑只查询已知订单；提交结果不明时停止，不换 Key 重新扣费。只有核实既有请求后才用 `--recover CASE=KNOWN_REQUEST_ID` 关联。`.local/smoke-market-monad.lock` 排他锁避免并发执行；进程被强杀留下锁时，先确认没有运行中的脚本再清理。临时 Key 值不保存，正常清理流程在 `finally` 撤销。

本轮曾遇到 CLI invocation 没有返回交易引用，Router 保持 `reservation_unknown` 且不派单；截止前 `getOrder=0` 或 nonce 未变化不足以排除延迟交易。不要因轮询超时就更换幂等 Key，或把无交易引用直接归因于 session 失效。

脚本新增显式 `--execute --retry-lock-failed auto_long_a`，仅允许原截止时间已过、链上订单 state 0、Router 已确定 `lock_failed/unsubmitted`、用量/费用零等检查全部通过后使用一次固定 `-retry-1`。原 ID、请求和最终证明先保存到 `failedAttempts`；不能生成 retry-2，也不修改已通过两单。本次已由主 agent 放行并成功完成，详情见进度；此参数是特定验收脚本恢复路径，不是生产 API 自动重试。若链上出现迟到的已锁订单，应核对其结算或过期回收路径，不能按“未锁款”重发。

已经归档的三单结果可只读检查本地证据，不连接钱包或重新提交请求：

```bash
npm run test:market:monad -- --summary
```

该命令检查三单状态、费用汇总、Key 撤销及原失败零费用，并输出可序列化的汇总；不重新请求 RPC 或证明服务仍在线。

第四笔浏览器 B 手动选 A 的复核单独执行：

```bash
node --import tsx scripts/verify-market-web-monad.ts --request-id 69a28714-618a-4d8b-99c5-620cba33e728
```

[该脚本](../scripts/verify-market-web-monad.ts) 固定本次买卖地址、报价、用量与余额基线，不签名、不发推理或链上交易，但会更新市场 JSON 的 `webManualOverride`。需要项目依赖、合约产物、RPC、现有市场证据、Router 本地账本（默认 `.local/monad-router-state.json`，可用 `ROUTER_STATE_PATH` 指定）和 A 的 `http://127.0.0.1:8793/api/state`。若该进程的执行历史已清除，可复用证据中已有的同单 `providerExecution`，但控制台状态接口仍需可读；不是任意新机器无需运行环境即可全验。

脚本只从账本选择该公开订单，不复制认证或 API Key 记录；保持 API 三单 `cases` / `aggregate` 原样。网页手动选择与双节点在线来自实际浏览器观察，链上仅能独立验证报价、实际成交卖家及资金结果，不保存 manual/auto 标记。

### 实际 API 到测试网结算验收

既有设置完成、Alchemy 0.24 EVM session 有效、测试网 Router 正常、`seller-monad` 独立进程处于 `normal` 在线状态时运行：

```bash
npm run test:api:monad
```

默认 `SMOKE_ROUTER_URL=http://127.0.0.1:8788`、`SMOKE_PROVIDER_URL=http://127.0.0.1:8793`；仅接受回环 HTTP 地址。脚本以受限买家挑战签名登录，创建临时 API Key，发起 `0.10 dUSD` 预算的正常请求，再核对独立 Provider 历史、账单、链上订单与回执，验证幂等重试，最后撤销 Key 并检查 `401`。

这是实际测试网操作，首次请求消耗测试 MON 和按用量计算的 dUSD。脚本使用固定幂等 Key，重跑查询同一订单，不自动新建收费请求；若公开证据还在但 Router 状态丢失，会拒绝替代请求。保留状态和证据文件。买家、卖家和 Router 使用同一现有 session 钱包，不能替代浏览器或多钱包验收。结果只记录公开证据到 [inferpool-smoke-api-monad.json](../contracts/deployments/inferpool-smoke-api-monad.json)，不保存认证值。

### 只读复核浏览器测试网证据

[verify-browser-monad.ts](../scripts/verify-browser-monad.ts) 用公开 RPC 复核本次独立 Para 买家的订单、回执、分项用量、双方余额和消费授权变化；不使用钱包会话、私钥或平台/API Key，不签名或广播交易，但会更新本地 [浏览器证据 JSON](../contracts/deployments/inferpool-smoke-browser-monad.json)。需要已安装根依赖、现有部署记录及 `contracts/out/` 中的 ABI；缺少 ABI 时先 `forge build --root contracts`。

例如重新核对已经完成的主动取消订单：

```bash
node --import tsx scripts/verify-browser-monad.ts \
  --case buyer_cancelled \
  --request-id 4cf2c58f-99ec-41f4-a86c-5df785ab90ca \
  --budget 0.1 --usage 54,0,0,48 \
  --tx reserve=0xc7569f463a0eae3f52a72b2992287596d5da6c54b42f51b1a0085406f7f8e1ef \
  --tx settle=0x898e0408ee9a8cc8b975bd159a967df9c799958e2ef0b6dca061d062a9139c0f
```

`--usage` 顺序是普通输入、缓存读取、缓存写入、输出；预算按 dUSD。其他场景用公开 JSON 中对应的 UUID、`case`、用量、预算与两笔交易，不创建新订单。支持正常、卖家失败、预算截断、缓存写入/读取和主动取消，并单独保留 `extra_normal` / `extra_timeout` 两次没有成功取消的实际结果。

`--router-funding <交易哈希>` 另行复核已经发生的 Router 测试 MON 补给并保存到 `routerFunding`，不会触发领取或转账，也不计入推理订单。当前公开记录含官方水龙头补给 1 MON 的成功回执；`routerGasReadiness` 仅按观察到的 Gas 价与用量估计余量，演示前要读取最新值。

无参数执行只刷新当前账户/RPC 快照及已有证据汇总，不会重新查询全部历史订单，也不替代网页操作验证。`currentAccount` 是读取当时的状态，`verifiedCasesAggregate` 汇总的是归档场景的历史区块；两者在有新请求进行时可能不同。脚本固定本次买家、卖家/Router、Monad 10143、报价 v1 和资金准备基线，不是通用钱包测试器；更换这些条件需要同时调整复核逻辑与证据范围。它核对 Mock 计费分类与链上结算，不能证明真实模型或缓存存在。

## 买家 Web 与 Para

Web 默认连接 `http://127.0.0.1:8788`。本机 `web/.env.local` 已配置前端所需的公开 Para Key 并被 Git 忽略；新机器需由自己的 Para 项目配置以下变量，不复制登录凭证：

```dotenv
NEXT_PUBLIC_ROUTER_URL=http://127.0.0.1:8788
NEXT_PUBLIC_PARA_API_KEY=<自己的前端公开Key>
```

从根目录启动：

```bash
npm run dev:web
```

预览 `http://127.0.0.1:3000`。运行本地 Anvil 网页时要把 Router URL 改为 `8787` 并重启 Next；先确认 Router `/config` 返回目标链和正确合约地址。Para 使用邮箱内嵌 EVM 钱包，SDK 当前配置为 `Environment.BETA`，公开 Key 应匹配该环境；当前无外部钱包/WC 接入要求。前端配置、界面已编写不等于完成登录、资金操作或钱包签名验收。

五个页面见 [Web README](../web/README.md)。本次用户在 **Chrome 的 InferPool 专用标签** 完成登录，主 agent 已实际确认独立新买家地址和平台会话；资金和请求的逐项验收见 [开发进度](progress.md)，不要将首次零余额快照当作当前余额。完整地址、官方水龙头入口及地址复制成功反馈均已在浏览器核对。邮箱和验证码仍只在网页处理，不进入聊天或文档。

本次用户已完成 Para CLI 登录，且授权 agent 代建 InferPool FREE 组织与项目；不需要重复开户。未来首次配置可以从 `para whoami`、`para keys list` 检查上下文，只有需要用户登录时才交由用户操作。Key 的“公开/私密”依据 SDK 与 CLI 字段定义，不能从名字猜测；不要输出私密 Key。

### 新买家邮箱钱包的第一次请求

Para CLI 的开发者登录、浏览器邮箱钱包、Router 平台会话和链上消费授权是不同状态。新的邮箱钱包不会继承既有 Alchemy session 的测试 MON、dUSD、存款或授权。`setup:monad` 与 `test:api:monad` 仅针对已有 session 钱包，不会替新邮箱钱包开户或充值；普通买家不需要安装 Alchemy/Para CLI。

1. **确认环境。** 页面显示 `Monad Testnet`，Router 使用 `8788` 且有可接单节点。点击“连接钱包”，按 Para 弹窗完成邮箱验证并等待钱包地址出现；重新使用时选择原来的钱包身份。
2. **准备 Gas。** “钱包与授权”提供完整 EVM 地址和复制反馈（`0x` 加 40 个十六进制字符）；顶部含 `…` 的缩写不能填入水龙头。在 Monad 测试网下，该页面显示 [官方测试 MON 水龙头](https://faucet.monad.xyz/) 入口，向水龙头提供这个新买家地址。官网在 2026-09-05 已核对，输入的是收款地址，不是私钥。也可由已有测试 MON 的钱包在同一测试网向该地址转入 Gas，本步骤不要求购买主网资产。
3. **平台登录。** 钱包就绪后点击“签名登录”。这是链外身份签名，不是代币转账，也不消耗链上 Gas。只连接邮箱钱包不会自动获得 Router 的 API 权限；刷新网页或切换钱包后可能需重新签名。
4. **领取 dUSD。** 到“钱包与授权”点“刷新余额”，确认“测试 MON”足以支付预计 Gas，再点“领取 1,000 测试 dUSD”。每钱包仅可领取一次；此领取本身也是链上交易，零 MON 时不能靠 dUSD 支付 Gas。
5. **存款与授权。** “批准并存款”先执行精确金额的 `approve`，再执行 `deposit`，等待两笔交易各自确认。默认存款 `10 dUSD`；随后设置独立消费授权，界面默认 `5 dUSD`、`24` 小时（可填 1–24 小时）。存款不会自动授予消费权，授权也不会把钱包代币自动存入合约。
6. **发起请求。** “推理市场”选择节点或自动匹配，设置 `0.10 dUSD` 等单次预算并运行。买家的可用托管余额和剩余消费授权都至少要覆盖整笔预算；卖家最低预留及输入预算检查也要通过。请求锁款和结算的 Gas 由 Router 钱包支付。
7. **核对并保留账单。** 等待“链上已确认”及结算交易，保存完整请求 UUID。预计账单、SSE 结束或文字生成完成都不等于结算已确认。剩余预算返回可用托管余额；需要回钱包时再执行提款。

若存款只有 `approve` 成功、`deposit` 失败，代币仍在买家钱包，界面会说明批准完成而存款未完成；检查 Gas、余额和钱包身份后再处理，不把批准回执当作存款回执。Gas 不足时先补测试 MON，不反复点击领取或存款。

### 用自己的 API Key 调用

在“API 接入”完成平台签名登录，再在有效消费授权下生成 Key。明文只展示一次，保存到自己的秘密管理工具或本机进程环境；离开页面后不能从列表恢复。页面生成的 Key 默认最长七天，实际期限不晚于创建时消费授权的到期时间。

在本机终端可先隐藏输入 Key，再运行示例；`read` 后粘贴自己的 Key 并回车，终端不会回显它：

```bash
read -r -s INFERPOOL_API_KEY
export INFERPOOL_API_KEY
curl -N http://127.0.0.1:8788/v1/chat/completions \
  -H "Authorization: Bearer ${INFERPOOL_API_KEY}" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: first-monad-request-001' \
  --data '{"model":"mock-reasoner","messages":[{"role":"user","content":"解释本次预算如何结算"}],"max_spend":"0.10","max_tokens":512,"stream":true,"cache":false}'
```

同一请求因网络故障重试时，保留 Key、幂等 Key 和请求参数；发起新的独立请求时换新的幂等 Key。SSE `request` 事件包含订单 ID，也可从 `X-Request-Id` 获取；用 `GET /v1/requests/{id}` 查账单、`POST /v1/requests/{id}/cancel` 显式取消。关闭终端连接不取消订单。用完可在网页撤销 API Key，撤销不会自动取消既有订单或撤销链上授权。

`npm run demo:request` 固定使用本地 `8787`、`seller-1` 和脚本准备的 Anvil 凭证，不能用于这个新买家的 Monad 请求。`test:api:monad` 使用自动清理的临时 Key，不提供可供手动接入的长期 Key。

### Router 离线时回收并提款

这里的“离线”指 Router 不可用，仍需要可访问的前端、Monad RPC、Para 钱包服务、原买家钱包和用于交易的测试 MON。它不是在完全断网或钱包服务不可用时也能操作的承诺。

打开“钱包与授权”并连接原买家钱包，不必先做 Router 平台登录。在“平台离线时取回锁款”粘贴账单完整 UUID 或链上 bytes32 订单 ID，点击“检查并取回超时锁款”。页面直接读取同一区块下的订单与链上时间，核对归属、锁款状态、金额和截止时间。未到期或已经结算/回收会拒绝重复操作；到期后发送 `reclaimExpired`。

回收交易确认后，资金先回到该买家的**可用托管余额**，再用上方“提款”转回钱包；回收和提款是两笔交易。输入其他钱包的订单、切到其他网络或市场都不能取回本单。保存请求 ID 和市场/网络信息有助于平台不可用时定位订单。

## 验证命令

```bash
npm test
npm run typecheck
npm run test:contracts
npm run build:web
npm run lint --workspace web
```

Web 使用独立 TypeScript 配置；根 `typecheck` 不应被当作覆盖了全部 Web。前端修改还应按其配置运行类型、lint 与构建检查，最终浏览器流程另行验证。

最近一次依赖恢复已正式 `npm ci` 成功。本地 Monad 浏览器交易与双卖家验收已完成；公网准备阶段最新根 82 项测试、类型检查、最终 Web lint/类型检查和静态导出结果分别记录在 [进度](progress.md)，不等同公网部署通过。发生依赖升级或安装变更后重新审计，勿沿用旧版本的数量。

合约 ABI 更新后运行 `npm run export:abi` 同步 Web 使用的导出；ABI 变化需要同时更新接口文档并重新核对部署版本，不能只改前端副本。

EVM 集成测试要求已经编译合约，并另起本地 Anvil：

```bash
anvil --host 127.0.0.1 --port 18545
```

```bash
npm run test:evm
```

测试拒绝非回环 RPC 或非 `31337` 链；测试会改变本地链状态，不与现场演示共享测试过程。Node WebSocket/HTTP 测试需要允许监听本机端口。只修改文档时无需重跑这些测试。

## 公网交付前还需要什么

当前无公网发布验收记录。Router 运行环境要支持持续 HTTP/SSE 与 WebSocket 连接，并提供 HTTPS/WSS；设置真实 `ROUTER_PUBLIC_URL` 与精确 `ALLOWED_ORIGINS`。前端的 localhost Router URL 不能服务远程用户，卖家回环控制台也不应当作远程管理站点。

[deploy/README.md](../deploy/README.md) 提供常驻单进程 Router 与持久账本的部署准备；[nginx 模板](../deploy/nginx.conf.example) 仅作参考，[Router 环境模板](../deploy/router.env.example) 仍需按实际运行配置。用户最新明确由自己配置 HTTPS 反向代理，agent 只准备应用与 HTTP 端口，见 [D15](requirements-and-decisions.md#d15--应用准备单个-http-端口用户负责-https-反向代理)。没有 nginx/证书/1Panel 配置改动或代理验收；迁移仍须处理在途订单、停旧实例，再带原账本启动唯一新实例，不能以空账本或双进程写同一路径。

目标域名为 `demo.example.com`，远端 DNS 已解析到目标服务器；本机代理 DNS 结果不作为公网解析证明。Ubuntu 22.04 x86_64 保留既有 OpenResty/工作负载，官方 Node v22.23.2 与独立 `inferpool` 用户、0700 私有目录已准备。当前 `/srv/inferpool/current` 指向 `/srv/inferpool/releases/319c6b9`，服务用户只读 release；前端归档和 53 项 ABI 哈希核对见 [进度](progress.md#远端部署准备检查点)。Linux npm ci 775 packages、Alchemy CLI 0.24.0 安装 178 packages 均 exit 0；新设备 `auth login` 已 exit 0，令牌仅保留远端私有配置；新钱包 session 已申请、正在等用户官方批准，尚无有效会话。不得复制 Mac 凭证或记录 device code/带凭证 URL。

两份 unit 和私有 env 已安装，Linux `systemd-analyze verify` exit 0、`daemon-reload` 完成；仅宿主旧 unit 兼容警告，无新增 unit 错误，旧服务未改。当前未 start/enable，固定 `DEMO_ADMISSION_START_UTC=2026-09-05T06:22:02Z`；配置检查通过不代表远端签名权限或端口就绪。原 Router 尚运行、账本未迁移，具体会话和启动步骤见 [部署手册](../deploy/README.md)。

实际 Linux 服务账户已完成非签名只读检查：导出绝对路径、固定 epoch、loopback 代理解析均有效，链 ID 为 10143，合约 router 等于原固定身份，router.env 权限 600。区块 `59833890` 的 Router Gas 为 `0.992516012 MON`；检查并未签名或广播，设备登录与链/RPC 可读都不替代新的 wallet session 批准。

单端口功能已实现：`WEB_STATIC_DIR` 指向绝对 Next 导出目录，缺少有效 `index.html` 等配置错误在链初始化前拒绝启动。Express 5 先处理 API，再处理真实静态页；不把 API 404 或未知页面回退到首页，并阻止隐藏文件、遍历和越界符号链接。默认不开启，无新增静态服务依赖。新增 6 项及根 82/82 通过，真实 WS/SSE 检查使用临时端口，不表示远端版本已启动。

最终应用入口为 `127.0.0.1:8788`，统一 Web、API、SSE 与 `/provider` WebSocket；用户的 OpenResty 已确认使用 host 网络，可代理同机入口。用户将 `https://demo.example.com` 的全站路径转发到该 HTTP 入口，保留 WS 升级、关闭 SSE 缓冲和写请求自动重试，详见 [代理交接](../deploy/README.md#https-proxy-handoff-to-the-owner)。卖家 A 必须用 `wss://demo.example.com/provider` 匹配域名认证，因此 HTTPS 可用前不能以回环 WS 代替远程上线验收。

迁移前已只读核对原账本 14 条：13 confirmed、1 lock_failed/unsubmitted，无运行或待结算。此时旧进程未停止、账本未迁移；迁移时仍须重新核对并停旧再开新，不能把已上传公开源码当作私有账本已移交。

Router 还会读取被 Git 忽略的 `contracts/out/InferenceMarket.sol/InferenceMarket.json`，`npm ci` 不会生成它。发布前需在构建机完成 `npm run setup:contracts` 与 `forge build --root contracts`，将匹配版本的公开编译产物按原相对路径放入 release，或在目标机编译；不要只复制 TypeScript 源码后就当作可运行包。

### 静态 Web 导出

在已配置真实 Router HTTPS origin 与 Para 前端公开 Key 的构建环境中执行：

```bash
INFERPOOL_STATIC_EXPORT=true INFERPOOL_PUBLIC_BUILD=true npm run build --workspace web -- --webpack
```

`INFERPOOL_STATIC_EXPORT=true` 选择静态导出到 `web/out/`；`INFERPOOL_PUBLIC_BUILD=true` 要求多个标签的 HTTPS DNS origin 和 Para 前端 Key。检查主机名时去掉尾点，拒绝所有 IP 字面值（含映射 IPv6）、localhost/.localhost/.local/单标签名称、凭证、路径、query/hash。它不证明 DNS 能解析或服务可达，仍需上线后实测。变量未开启时保留原 Next 行为；`NEXT_PUBLIC_ROUTER_URL` 编译进文件，更换公开地址后要重新构建。

最终 public-build 配置正反 **13 项**检查、完整 Web TypeScript 和 Web lint 通过；前序 `INFERPOOL_STATIC_EXPORT=true` 本地导出使用原本机 Router URL，**没有启用 public-build，也没有发布该本机配置产物**。初始 Turbopack 因 CSS helper 端口权限失败；显式 webpack 导出成功，但 Para 未使用的可选 AA 集成模块仍有警告，未因此安装无关依赖。静态 3001 实际打开钱包邮箱弹窗，但没有登录或交易；该 origin 未列入原 Router CORS，未连 API，这是预期拒绝，不是业务验收。另已在原 3000 保存 [真实市场与账单截图](../artifacts/submission/README.md)，这不扩大 3001 或公网的验证范围。

域名确定后，主 agent 已针对 `https://demo.example.com` 重新执行 webpack 静态构建，exit 0，并将产物上传独立 release。尚无 HTTP 服务、HTTPS 代理、钱包/API 的完成声明。

### 可选公网请求限额

[D14](requirements-and-decisions.md#d14--公网演示使用持久新单限额与明确代理信任) 的代码与测试已完成，默认关闭，本轮未重启现有 Monad Router。启用需 `DEMO_ADMISSION_ENABLED=true`、固定且不晚于启动时间的 `DEMO_ADMISSION_START_UTC`（ISO UTC、以 `Z` 结尾），以及默认 true 的 `DEMO_NEW_ORDERS_ENABLED`。关闭限额时，其余 `DEMO_*` 配置必须不存在，防止暂停配置无效却静默接单。

| 启用后限制 | 计算方式 |
| --- | --- |
| 每钱包未结并发 1、全局未结并发 2 | 计入原起点之前仍未解决的订单；锁款不明、pending/failed 结算也占位，只有结算终态或确定锁款失败后释放 |
| 每钱包每 UTC 日 6 次、本场全局 10 次 | 读取账本全部订单，在固定起点之后按 `createdAt` 计数；订单持久化、即将锁款时消耗一次，锁款失败仍计次；参数、余额和策略拒绝不计 |

同幂等 Key/同参数先返回原订单；换 API Key、重启或只读取最近订单不能重置次数。重启保持原起点与绝对 `ROUTER_STATE_PATH`，不得自动换起点补额度。新单暂停返回 `503`，超过限额返回 `429`；查询、准确重放、取消、结算重试与恢复继续工作，锁款未确认时取消仍可能按原规则返回 `409`。`DEMO_NEW_ORDERS_ENABLED=false` 在启动时读取，手动暂停需要受控重启，尽量先等待在途订单结束，不是现成的 HTTP 管理开关。

`ROUTER_TRUST_PROXY` 只允许默认 `none` 或本机反代 `loopback`，认证限流使用解析后的客户端 IP。本机反代必须覆盖 `X-Forwarded-For`，Router 必须保持回环地址、不能旁路直连；任意代理或布尔 true 不被支持。CORS 不能替代消费限额。完整配置和计数规则以 [Router README](../server/README.md) 为准。

链上部署不等于服务器部署。官方规则要求应用部署 Monad、前端公网部署，应用和前端长期可用；规则来源及 MOJO/截止时间见 [比赛材料](hackathon-submission.md#已核实的比赛要求)。域名和 HTTPS 分工已经明确，应用服务与代理验收仍待完成，本机备用演示不能替代长期公网交付。

## 常见问题

| 现象 | 检查与处理 |
| --- | --- |
| 卖家显示未发布报价 | 钱包、链、市场和 `model` 必须匹配；本地保存报价不会上链 |
| 有 dUSD 但请求提示余额不足 | 检查是否已存入市场及设置未过期消费授权；钱包余额不等于托管余额 |
| 新邮箱钱包无法领取 dUSD | 它不继承 Alchemy 演示钱包的 Gas；先为这个完整地址准备 Monad 测试网 MON，再刷新余额 |
| 钱包已连接但 API 页面仍要求登录 | 点击“签名登录”取得 Router 会话；钱包登录不等于平台会话，平台会话也不等于消费授权 |
| 浏览器请求 Origin 被拒绝 | 把实际 `127.0.0.1` 或 `localhost` 前端 origin 精确加入配置并重启 Router |
| 锁款结果不明或结算失败 | 查询同一订单，不换 Key 重发推理；等待 Router 重试或到期直接回收 |
| Router 失联但资金锁定 | 使用订单 UUID 对应的 bytes32 ID，在链上截止时间后由买家 `reclaimExpired`，再提款 |
| Para doctor 报缺少完整 Provider/外部钱包 | 当前 Lite 内嵌方案存在静态规则误报；结合源码、类型和实际流程判断，不能宣称 doctor 全部通过 |
| Lite 首次加载仍出现 Solana connector 错误 | 必须在首次渲染和 SDK 构造阶段同步约束空外部钱包配置；延迟设置可能保留默认全部钱包。当前源码已修并通过解析器断言和冷刷新；若复现，检查构建是否包含该修复 |
| 移除旧 SDK 时 npm 回滚报 `from undefined` | 本次通过只含 manifests 的干净临时目录重建 lock 后再正式 `npm ci` 恢复；保护现有配置和未提交工作，不盲目删改项目文件 |
| 刚建立会话却不能签名 | 核对钱包是否正确、EVM 会话是否有效、权限和 CLI 版本；不静默切到另一个身份 |
