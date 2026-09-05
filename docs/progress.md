# 开发进度与证据

> 地址脱敏说明：`demo.example.com` 为占位域名，不是实际部署或验收地址；本文历史验证记录指向清理前的真实地址。

状态日期：**2026-09-05，Asia/Shanghai**。这是一份可更新的实现快照；持续事件见 [对话日志](conversation-log.md)。本地监听地址表示本机进程，不能等同公网服务。

## 当前结论

**原生 MON 版已上线 [https://demo.example.com](https://demo.example.com)。** 远端 current 指向 `/srv/inferpool/releases/a78470a`，Linux npm ci 成功；公网 `/config`、`/v1/models` 均 200，返回新市场 `0x142a4904307244Bed0cECD72dE8329A253333182`、MON/18。卖家 A 报价 v1 为 .3/.03/.375/.8 MON 每百万模拟单位，最低预留 .000001、normal、在线 2 槽。公网一单已验证 34 批 SSE 增量、链上锁款/结算、幂等重放及 Key 撤销，费用 .0001285 MON。Chrome Para B 已重新签名登录、读取 MON 页面与账户；未操作 B 的 MON 存款/授权/请求，不能称跨钱包或浏览器付款通过。

[D17](requirements-and-decisions.md#d17--正式产品仅-mon旧-dusd-完整剥离并私有归档) 已完成数据切换：旧 15 单与凭证整账本保留私有备份，新 `router-mon-state.json` 初始没有旧 orders/credentials，只有 15 条 buyer + createdAt 最小 admissionHistory；固定 epoch 和限额不变，不兑换、销毁或代提旧链上资金。Para 钱包不变，需新平台签名会话与 MON Key。

本版根 **91/91**、类型检查、Foundry **41/41**、前端最终 **8/8**、Web 类型/lint/公网构建通过。原生合约已验证 2/2，同钱包直接合约小额 smoke 8 笔回执成功，正常费 .000110 MON、卖家失败 0、提款 .001 MON。此前多钱包、浏览器六场景、旧 API 与截图属于 **dUSD 历史归档**，不能改标成新版 MON 验收。MOJO 队伍已建，项目尚未提交。

首次切换仅重启 Router 时被 Provider 长连接拖住；根受控停止/启动 Provider 后恢复，没有强杀。未来切换脚本已改为同时重启两服务，该脚本更新尚不改变当前运行 a78470a 的业务代码。

## 分项状态

| 项目 | 状态 | 依据及限制 |
| --- | --- | --- |
| 需求与接入方案 | 已形成可执行范围 | [MVP 规格](../MVP_SPEC.md)、[决策记录](requirements-and-decisions.md)；没有新增产品前置问题 |
| 仓库版本 | MON-only 本地提交 a78470a，远端 release 已切换该版本 | 后续两服务重启脚本修复待归档；本轮尚未记录 SSH 推送成功，具体提交见 Git；历史推送保留于日志 |
| 合约实现 | 已实现、测试和部署 | [市场源码](../contracts/src/InferenceMarket.sol)、[测试](../contracts/test/InferenceMarket.t.sol)、部署回执 |
| Router | 远端 systemd 已启用并运行，健康检查通过 | 原本机 Router 已停止；单个 Linux Router 监听回环 8788，公网 /health、/config、/v1/models 200；A 的 WSS 认证通过；原生公网 API/SSE 一单已核对，浏览器仅登录和账户读取通过 |
| 独立卖家 | 四种身份已实现，浏览器认证/下线/重连通过 | Provider 全量 34/34 与根类型检查通过；B 已实际接收两笔 API 订单并结算 |
| 本地端到端 | 已通过 | 两个不同钱包卖家，API/WS/真实 Anvil 交易；独立进程演示已运行 |
| 原生 MON 合约 smoke | 8 笔真实测试网交易全部 success | 报价、存 .01、授权 .005/24h、正常/卖家失败两单、提 .001；正常费 .000110 MON、卖家失败 0、最终无锁款。A 同钱包兼任买家/卖家/Router |
| 原生公网 API/SSE | 一单、34 批增量、两笔回执、重放与撤销通过 | A 同钱包三角色；输出 128 上限结束，费 .0001285 MON，不能称浏览器付款 |
| 旧 dUSD HTTP/API smoke | 历史通过真实请求及结算 | 签名登录、临时 Key、独立 Provider、正常一单、幂等重试和撤销 Key；仍为同一钱包，非浏览器验收 |
| Monad 节点接入 | 远端 A 常驻，真实公网 WSS 认证通过 | 本机旧 Alchemy 卖家已停；远端 seller-monad 为 normal、2 槽、v1，报价与链上匹配，lastError=null。B 因旧 Router 停止而离线，尚非双卖家常驻 |
| 旧 dUSD 第二测试网卖家 | 不同钱包/报价、独立进程，API 三场景与浏览器手动覆盖均通过 | API A → B 0.023340 dUSD；A 自身费用回流 0.017780；浏览器 B → A 0.016580；原锁款失败和一次显式恢复保留，各阶段汇总分开 |
| Para 配置 | 已完成组织/项目/公开配置 | InferPool FREE；用户完成登录并授权代操作后台；公开 Key 文件忽略且权限 600，未保存私密 Key |
| 依赖与审计 | `npm ci` 成功 | 770 installed / 774 audited；19 项（12 low / 7 moderate），零 high/critical |
| 前序买家 Web 登录 | Chrome 已确认 Para 买家并有平台会话 | `0xbc81…4a75` 不同于原卖家 A，现同时兼任卖家 B；初始账户为零，后续资金结果单独记录 |
| 新钱包上手补丁 | 已应用，静态和浏览器检查通过 | 完整地址与官方水龙头 href 已核对，复制点击显示“钱包地址已复制。”；实际文件 eslint/全 Web tsc 通过，资金交易逻辑未改 |
| 旧 dUSD 买家资金及请求 | 浏览器操作与独立链上回读通过 | 领取 1,000、存入 10 dUSD，授权 5 dUSD / 24 小时；六种目标场景、两次额外尝试共八单完整对账；主动取消成功 |
| 前序浏览器 API Key 生命周期 | 创建、离开后隐藏明文与撤销通过 | 临时 Key 未复制或保存，切页后只剩 preview，撤销后显示已撤销；没有用这把 Key 发出 API 请求 |
| 演示 Router Gas | 前序官方免费补给 1 测试 MON，回执核对通过 | 补给时余额从 0.171218074 增至 1.171218074 MON；这是历史快照，之后市场交易 Gas 另计，演示前重读；不改变买家余额或授权 |
| 公网 MON Demo | a78470a 已上线，配置与模型接口通过 | /config、/v1/models 200，MON/18 与新地址正确，A .3/.03/.375/.8、最低 .000001、v1/2 槽在线；API/SSE 一单通过；Chrome B 签名登录/页面/账户读取通过，MON 浏览器资金操作未做 |
| 公网新单限额 / 代理信任 | 源码与专项通过，远端已启动固定 epoch 配置 | 新增 12 项已纳入根测试；Linux 配置解析检查通过。默认未配置时关闭，当前远端配置已随 Router 启动；公网实际拒单行为尚未验收 |
| 单端口 Web / API | 当前根 91/91 通过，Router/Provider active | 公网原生请求收到 34 批 SSE 增量，锁款/结算回执 success，重放无重复收费；未知 API/页面及 /.env 的 404 检查保留。浏览器登录/账户读取通过，MON 付款未验 |
| 原账本迁移 | 已停旧、私有备份、复制和哈希核对 | 停止前后 14 条安全：13 confirmed、1 lock_failed/unsubmitted；旧本机 8788 不再监听。远端 ledger 的 SHA256 一致、inferpool 持有、mode 600；未复制 Mac 登录或 session |
| 比赛要求 / MOJO | 已复核惠州活动 16、1/3 队长；资格窗口待确认，未提交 | 2026-09-05 活动进行中；项目仍可创建，未提交或投票。官方要求活动期编码/资源和 GitHub 提交，Git 的 12:29–14:40 不能证明起工合规，正等现场编码起点；见 [日期自查](hackathon-submission.md#2026-09-05-活动要求复核asiashanghai) |
| 比赛演示材料 | 脚本/简介、LOGO、说明图、两张新 MON 截图及三张历史截图已准备 | 当前封面优先 native-public-market.jpg，第二张 native-public-wallet.jpg；两张公网原始 JPEG 经主 agent 保存和目视检查，只证明登录、页面、账户读取，旧 dUSD 图片只历史。未录制视频，详情见 [素材说明](../artifacts/submission/README.md) |
| MON 与 dUSD 说明 | 前轮澄清已记录 | MON 支付 Gas，dUSD 为同链演示服务计费代币；前轮说明后已获授权并领取 100 MON，未改变 dUSD 或应用额度，详见 [资产解释](hackathon-submission.md#mon-活动水龙头与-dusd-的区别) |
| 原生 MON 收付方案 | D17 已批准，MON-only 根回归通过 | 旧 UI/兼容层/凭证不迁入，旧账本私有备份，仅带最小配额历史；默认提案为存款 .1、授权 .05/24h、请求预算 .001 MON，需重新签名。新原生市场已部署并验证 2/2，D17 根 91/91 与类型检查通过，合约 41/41；Web 前次检查通过，离线撤销与 401 恢复补丁、最终 8/8/类型/lint/构建通过；小额同钱包实链 8 笔交易通过，公网 MON API/SSE 一单通过，浏览器登录/账户读取通过、付款未验，见 [D16](requirements-and-decisions.md#d16--用户批准迁移原生测试-mon保留旧-dusd-资金与历史) |
| 文档维护 | 已建立并持续更新 | `docs/` 导航、根 `AGENTS.md` 每轮同步规则；没有定时自动任务 |

### 原生 MON 公网 API 与浏览器分项验收

[公网 API smoke JSON](../contracts/deployments/inferpool-native-api-smoke.json) 记录 `d60e648c-0b6a-46e5-bd2c-174f803a83e0`：预算 .001 MON，输入 87、输出 128，费用 **.0001285**、释放 **.0008715 MON**。终态 `budget_capped`/outcome 2 是达到 max_tokens 128，**不是耗尽金额预算**。收到 34 批真实 SSE 增量；[锁款](https://testnet.monadscan.com/tx/0x323acdb3f63ef507da0bb51f46212a22a8b0379414aee996aaed68e7066ede94) 和 [结算](https://testnet.monadscan.com/tx/0xecad6ff00ecf241186a92dc880aeef70ee43acc0bb4b76dc9f9e2ce972149087) 回执 success，准确幂等重放不再扣款，临时 API Key 已撤销。A 同时为买家/卖家/Router，费用回流自己的托管余额；可用 .009 MON 不变，授权 .004890 → .0047615，不能把余额不变解释为免单。

首次 API 尝试在签名前因服务端时钟快约 .15 秒，被严格五分钟挑战检查拒绝，未创建订单。脚本增加最多五秒等待进入有效窗口后成功，未放宽签名验证条件。

Chrome 公网 Para B 已实际重新签名平台登录；新市场/报价、账户可用 0、授权 0 与钱包原生 **.937143418 MON** 回读通过。未操作 B 的 MON 存款、授权或请求；旧 5 dUSD 授权没有迁入。[MON 市场截图](../artifacts/submission/native-public-market.jpg) 1713×1452 与 [MON 钱包截图](../artifacts/submission/native-public-wallet.jpg) 1713×1796 为原始 CUA JPEG，主 agent 保存并用 view_image 检查，无像素改动；它们不是浏览器成交证明。

[部署只读摘要](../contracts/deployments/inferpool-native-public-deployment.json) 在 2026-09-05 15:42:49（Asia/Shanghai）确认：当前原生单 1 confirmed、0 pending，admissionHistory 15；本场累计尝试 2、剩余 8，epoch 不变；两服务 active、新 env 无旧资产字段、活跃账本 0600。旧整账本 SHA256 `7e954f589bdccee01d8fdae01becd0e857396aac59f9b8dbdbcfa4bc4876b412` 未变。运行版本仍 a78470a，后续维护脚本/证据/文档待最终提交与 SSH 推送。应用内浏览器另刷新为纯 MON 报价/.001 预算，处于访客未登录；它与 Chrome B 签名登录是两个独立检查。API 脚本默认只读重跑显示 alreadyVerified=true，未发新单。

### 远端部署准备检查点

**当前发布：** current → `/srv/inferpool/releases/a78470a`，npm ci exit 0。私有备份目录 `/srv/inferpool/state/backups/native-20260905T073750Z` 保留旧 15 单；新活跃文件为 `/srv/inferpool/state/router-mon-state.json`，只导入 15 条最小配额历史，不迁旧凭证。固定接单起点 `2026-09-05T06:22:02Z` 不变。

**以下为首次 dUSD 部署的归档检查点，非当前 release：** 当时选定 `/srv/inferpool/releases/319c6b9`，`/srv/inferpool/current` 指向该 release，源码与公开产物由 root 持有、服务用户只读；私有账本/Alchemy/env 目录按独立权限准备。原本机 Router 已停止且 8788 不再监听，14 条原账本完成私有备份、迁移和 SHA256 核对；远端 Router 已 enable --now 并运行，回环与公网 /health 均 200。固定接单起点为 `2026-09-05T06:22:02Z`，重启时保持不变。

| 核对项 | 实际结果 |
| --- | --- |
| 目标域名前端归档 SHA256 | `c6b97fea4671251dd85e8021af86e2742aa3a64e3cd916c0c3cc284bc5b7684d`，上传前后一致 |
| 公开 ABI artifact SHA256 | `6b00206422d978a1ad38d93465ce122b954c883320854b920042e57c56e80a68`，上传前后一致，53 条 ABI entries |
| 远端依赖 | Linux npm ci exit 0 / 775 packages；Alchemy CLI 0.24.0 安装 exit 0 / 178 packages；不替代钱包授权 |
| 服务配置 | 两份 unit 与私有 env 已安装；systemd-analyze verify exit 0、daemon-reload 完成；宿主旧 unit 兼容警告保留，无新增 unit 错误 |
| 当前授权状态 | 用户批准重新申请的 Linux 会话后 connect exit 0，独立 wallet status --verify 为 valid=true、原 Router 地址，签交易/签消息权限有效；到期 2026-09-12T06:33:39.043Z，config mode 600。首次超时保留在日志，无 Mac 凭证复制 |
| 用户 HTTPS 与只读代理审查 | 用户已配置全站反代至 127.0.0.1:8788，截图显示缓存禁用。远端 urllib 默认验证与 curl 验证均通过 TLS，证书 SAN 为 demo.example.com；先前 502 已解决，当前 /health 200。HTTP/1.1、Upgrade、Host、HTTPS scheme 已配置，实际 A 经公网 WSS 完成认证，SSE 尚未验收 |
| 代理尚待核对项 | 站点配置没有显式 buffering/cache/read_timeout，不能从截图推定全部关闭。建议由用户覆盖 X-Forwarded-For，并显式设置 300 秒读取超时、关闭缓冲/缓存/上游重试；agent 仅读配置，未代改代理 |
| Linux 实际服务账户只读检查 | exit 0：绝对导出目录有效、固定 epoch 和 loopback 代理配置解析通过、Monad chain ID 10143、市场 router 与既有地址一致；router.env mode 600。没有签名或交易 |
| Router Gas 公开快照 | 区块 `59833890`：`0.992516012 MON`；只代表该读取时点，不是未来费用保证，也不证明新钱包会话已批准 |

### 原生 MON 迁移：水龙头与本地验证

用户授权后，MOJO 页面显示原 Router 钱包已领取 100 测试 MON，并给出 [交易 0x36e774…c1cec](https://testnet.monadscan.com/tx/0x36e77400b6b44d1fefa6a6f817c5b7b307c0627491e565006a7a38d6349c1cec)。主 agent 使用独立官方 RPC 核对 receipt status `0x1`、区块 `59842233`、接收地址 `0xAc801eEC099C65A605B809b98A09A62674614A08` 精确匹配，value 为 `100000000000000000000 wei`，即 100 MON；之后余额快照为 `100.947564612 MON`。这是原生测试币补给，不是 dUSD 充值，也没有提高应用请求限额。

D16 阶段 Router agent 汇报原生合约本地 Foundry **43/43** 通过；money 5 + engine 14 + admission 10 共 **29/29**（此前 19 项仅 money/engine），独立 Anvil 的 **EVM 2/2、integration 1/1** 通过。另实际检查 setup-local 部署、资产字段、无 TOKEN_ADDRESS、新合约专属账本路径，并完成类型、forge 格式和差异检查。临时 Anvil 已关闭，未触碰旧服务或测试网。本地结果不与新版根全量重复累加；随后根全量 91/91 通过，原生市场已部署，但原生公网业务仍未验收。

原生接口为 `constructor(address router_)`、`deposit()` payable、原生 `withdraw(uint256)`，结算只增加卖家内部可提款余额；资产元数据为 MON / 18 decimals。测试包含拒收回滚、重入阻断、卖家拒收不阻断结算、强制转入不增加用户负债，以及四类费用合并后向上取整到 1 wei。所有金额/报价采用 18 位 wei，每百万分母仍是 1e6。本地 fixture 的 100 MON 存款/授权和旧风格费率仅用于测试覆盖，**不是公网默认提案或已获授权的存款值**。

### 原生 MON 合约与小额实链、封版和上线过程

新市场 `0x142a4904307244Bed0cECD72dE8329A253333182` 已在 Monad Testnet 部署：[交易](https://testnet.monadscan.com/tx/0xa6da3bd7812867daddc53999b06263d76754f7ba3bcb718acdb7d3053aa10ed0)，区块 `59844019`，receipt success。独立回读 native=true、symbol=MON、decimals=18、原 Router 地址，以及运行字节码匹配；MonadVision / Monadscan 源码验证 **2/2**。依据 [新部署 JSON](../contracts/deployments/inferpool-mon-native-testnet.json)，与旧 dUSD 部署记录分别保存。

D17 已删除 DemoUSD 源码/两项旧测试、旧资金脚本及前端 UI/ABI/兼容字段。合约 agent 复跑 Foundry **41/41**（市场 38、Counter 2、不变量 1 套，128 × 64 = 8192 calls、零 revert），原生市场源码和创建/运行字节码模板哈希未变。前端全 Web 类型、lint、资产 **4/4** 与公网静态构建通过；产物 68 文件、5,266,759 bytes，index SHA256 `0889eb96aa6d9b07121a0e30cafcd3755ea32105c4387e4cef1a1b205670532a`。产物扫描未见旧资产名称/地址/字段/ABI，新市场、MON/18、公网 URL 与 `X-InferPool-Market` 在场。以上均未部署或进行新浏览器交易；根正在完成仅 MON 的 `router-mon-state.json` 切换，携带 admissionHistory，不迁旧 keys/orders，根全量 91/91 与类型检查随后通过；前端后续封版结果见下段，公网切换仍待证据。

MON-only 最终根回归纳入 [native-ledger.test.ts](../server/test/native-ledger.test.ts) 8 项：拒绝非空未绑定账本、即使零订单也拒绝旧凭证及身份不匹配数据；admissionHistory 保留钱包 6 次/全局 10 次限制且拒绝发生在 lock 前，重启持久化与新单合计、幂等不加次数。临时 HTTP 验证旧 session 缺/错市场 header 的下单与取消返回 409；当前 header/Key 正常路径可用。相关 14 项属于根全量覆盖，不重复相加。根只读审阅切换脚本后已修复 env 重复变量仅保留新值、临时文件创建即 0600，两项独立检查通过；该检查未启动切换。

封版前端已补离线/无平台 session 的链上撤销入口，并在 401 后恢复签名登录、保留原订单幂等 Key，不取消原单；旧 token 不能清除新会话或覆盖新账户。最终 **8/8**（资产 4、API error 3、撤销按钮 render 1）、Web 类型/lint/公网 build 通过；产物 68 文件、5,268,274 bytes，index SHA256 `5f4193daf4d31dbac2e3bdcf7cd06bc5a748bf74da777cd4cb47040ac5c2bfb1`，覆盖前序 0889… 哈希。MON-only 54 文件已本地提交 `a78470a`；发布包 8,284,160 bytes、SHA256 `3f63cc68a4b7a60fe1b4bb73c7309fcef0930b96167bd46ad828411676f2b933`，上传完成后已切到 a78470a，配置/模型回读通过；API/SSE 与浏览器结果另记。

D16 兼容方案阶段根 Node 全量 **92/92** 通过；其兼容行为随后由 D17 取代，清理后的最新测试另记。旧 dUSD 幂等 Key 跨市场 POST 返回 409 和原请求 ID，不创建 MON 新单；旧订单 createdAt 与次数保留，当前市场恢复/取消/Provider 事件不能驱动旧单。对应市场迁移/admission/money/Alchemy 专项 26 项及额外纯内存检查属于局部证据，不与全量相加。 新增 API Key 资产权限隔离也已纳入全量：旧 dUSD Key 绑定旧 market，仅保留 GET 历史读取，禁止新 MON POST/取消；新 MON Key 需 wallet session + 有效 MON grant 创建并绑定新市场。钱包 session 仍可登录；这与幂等 Key 隔离是两条不同规则。

D16 阶段前端已固定新合约地址，原生存款一次确认、.1 MON 默认、.05/24h 授权、.001 请求预算，以及旧 dUSD 独立余额/提款/撤销/回收入口均已实现。前端 agent 汇报全 Web 类型、lint、资产测试 **4/4** 和最终公网静态构建通过；69 文件、5,275,747 bytes，index SHA256 `01b9f8bc3cc42d808345ce6978af109655a08c06379d95d6e0d5abc596c18b71`，产物包含新地址/MON18/真实公网 URL，无零市场或本机 8788 地址。Para 可选 AA 依赖警告保留，构建不等于钱包交易验证；本段旧 UI/ABI 方案及构建哈希已被 D17 清理取代，不作为最终发布产物。

根已执行 `native-monad.ts --execute --smoke`，[公开证据](../contracts/deployments/inferpool-native-monad-smoke.json) 的 setup/smoke 均 verified：报价、存入 .01 MON、授权 .005 MON / 24 小时、两单各 .001 预算的锁款/结算，以及提回 .001 MON，共 **8 笔交易全部 success**。正常单输入/输出各 100，收费 **.000110 MON**、释放 .000890；卖家失败收费 **0**、释放 .001。最终托管 **.009 MON**、授权剩余 **.004890 MON**、总锁款 **0**，钱包 **100.608502914 MON** 为当时快照。提款已核对钱包增量加 Gas 等于提款金额。

该脚本为同一 session 钱包兼任 Router/买家/卖家的直接合约验收，正常费作为卖家收益回流同一托管余额；不是独立买卖钱包、HTTP/SSE 或浏览器证明。该合约 smoke 当时公网尚未切换；目前已上线 a78470a。新的 `test:api:monad` 使用 `smoke-native-api.ts --execute`，已按上节完成原生公网 API/SSE 一单验收，不继承旧 dUSD API smoke 的通过状态。

### 活动要求复查与新增远端订单

2026-09-05（Asia/Shanghai）再次核对官方规则和 MOJO：惠州活动 16 进行中，InferPool 1/3、用户队长，项目仍未正式提交或投票。技术部署与素材已具备；正式允许编码开始时间仍待用户回复，Git/birthtime 不能单独证明起工或原创资格。五分钟实机演示与商业模式表达属于演示/评分准备，详情见 [活动自查](hackathon-submission.md#2026-09-05-活动要求复核asiashanghai)，不承诺全部符合或获奖。

迁移时的 14 条账本记录保持为历史检查点。后续只读复查发现新增第 15 条订单 `a7f4b430-5e73-415c-9624-50cc564c8b64`：14:47:56 创建、14:48:20 完成，B → A；预算 `0.100000`、费用 `0.014160`、释放 `0.085840 dUSD`。来源仍未知，root/agents 本轮没有创建该请求。

- [锁款成功](https://testnet.monadscan.com/tx/0x17b4ee262faf6a6c2a69ea2cf346756fa528cb62dff548496f701e626d339d7c)，区块 `59838651`；[结算成功](https://testnet.monadscan.com/tx/0x047f4b833cc2a0af869bb4aec2aac2df87a2340f1c2edc55156a3b72b39e14a0)，区块 `59838699`。独立 RPC state 2 / outcome 0 与 Router completed/confirmed 一致。
- 这是远端后端和链上成功证据，未观察其客户端来源、登录或增量流接收，不能将它写成 agent 完成的公网浏览器/SSE 全验。
- 14:50 快照：本场全局新单剩 `9/10` 次，B 当 UTC 日剩 `5/6` 次，无未结并发；Router Gas 在区块 `59838857` 为 `0.947564612 MON`。这是瞬时余额，不保证未来交互次数的 Gas。
- 全局 10 次属于固定场次上限，**不会每日恢复**；用尽后拒绝新单，查询/结算恢复仍可用。比赛长期可交互需评估额度安排及会话续批（到期 2026-09-12 14:33 Asia/Shanghai），并非本轮自动放宽或新赛事规则。没有修改额度、服务或代理。

### 第二卖家本轮结果（API 三场景通过）

采用 [D13](requirements-and-decisions.md#d13--浏览器钱包为独立-provider-签署认证挑战)：Provider 通过本地控制台与 Para Web 交换受限认证挑战，新增互斥参数 `--browser-wallet <address>` / `--wallet-ui <origin>`。节点认证只签消息，不导出私钥、不更改原 Alchemy 会话或交易权限。B 已从 Chrome 独立发布报价并回读 active v1，[报价交易](https://testnet.monadscan.com/tx/0x8519952dd0ca072e121e76969e85207f67fbc2a4814127bc555fc4862689d612)；`seller-para:8794` 的首次认证、下线、新弹窗重签重连及两笔成交均通过，三场景整体结果与第三单原锁款失败分别归档。

| 角色 | 钱包 | 报价：输入 / 缓存读 / 缓存写 / 输出 | 状态 |
| --- | --- | --- | --- |
| A / Router / 本轮测试买家 | `0xac80…4a08` | `30 / 3 / 37.5 / 80` | 现有卖家，既有报价 v1 |
| B / 既有 Para 买家 | `0xbc81…4a75` | `60 / 6 / 75 / 40` | active v1；认证、下线和重连通过，两笔 API 成交已结算 |

价格单位为 dUSD / 百万模拟单位，最低预留均为 `0.0001 dUSD`。A 买 B 已证明跨钱包结算，短输入/大输出上限选 B、长输入/小输出上限选 A 均已通过。后一场景买家与卖家同为 A，整个计划只有两个钱包，不能称为三个独立身份。

`/provider-connect` 已实现并完成类型、lint、生产构建及最终根 64/64 测试。实际 Chrome 控制台 → 新弹窗恢复 Para 钱包 → 签名认证后，`/v1/models` 同时列出 A/B，各 2 槽位、normal，B 本地/链上报价 v1 一致。主动下线 B 后旧弹窗禁用，新弹窗重新签名恢复双在线；Web 市场显示两在线节点、两组报价及手动/自动选择。钱包访问器对象刷新不再打断待签，身份变更清理会通知控制台下线；这些修复已复核，但尚未实际切换买家钱包验收。

两卖家 smoke 首次在第三单锁款不明时退出并撤销 Key；失败确认后执行一次受限重试，最终 [公开 JSON](../contracts/deployments/inferpool-smoke-market-monad.json) 为 `market_requests_verified`，三成功单汇总与 `failedAttempts` 分开保存。最终临时 Key 已撤销并确认 `401`。B 报价在区块 `59819274` 成功、版本 `0 → 1`；浏览器手动指定 A 的独立 RPC 证据随后写入 `webManualOverride`，不改 API 三单汇总。

| API 场景 | 实际输入 / 输出 | 预算 | 费用 / 释放 dUSD | 结果与链上证据 |
| --- | --- | --- | --- | --- |
| 指定 B `explicit_b` | `71 / 204` | `0.100000` | `0.012420 / 0.087580` | 通过；[锁款](https://testnet.monadscan.com/tx/0x2b633a5805a9d89aebc940f50382d442ee56f796f35922112b86c2ab4d141fcd) / [结算](https://testnet.monadscan.com/tx/0xbfc98e6b54f87d1505376b79c9cc9bf34aade1c8fedde211159e31793e2152cc) |
| 自动选 B `auto_short_b` | `56 / 189` | `0.100000` | `0.010920 / 0.089080` | 通过；[锁款](https://testnet.monadscan.com/tx/0x959ad1056cf66dbd84931eee7bc10f3fdb2ce233e644c6b8d1f414e10ad7b6f5) / [结算](https://testnet.monadscan.com/tx/0xfb983a228dd53680f24a1a94bb743ae94c9798aa2179a495c20f9c0904dadd67) |
| 自动选 A `auto_long_a`，显式重试 | `550 / 16` | `0.100000` | `0.017780 / 0.082220` | 通过；[锁款](https://testnet.monadscan.com/tx/0x3414da9224af45f956a5e524795645c91bc3e240c0110a56e848b3a2a9935355) / [结算](https://testnet.monadscan.com/tx/0x9d2df6e0f12402ee0e4e2f538c57e0fccfbc4b821e5742c3f11d3253349514d1)；`max_tokens=16` 触顶 |

三单分别核对 Provider 执行、订单/回执、报价、用量、余额/授权及幂等重试同一订单/交易。最终 A 托管 `10.078507 → 10.055167`，B `9.921493 → 9.944833`，净变化均为前两单跨钱包费用 `0.023340 dUSD`。第三单同钱包费用 `0.017780` 作为卖家收入返回 A，因此 A 授权累计花费从 `0.027690` 增至 `0.068810`，本轮增量 `0.041120`，锁定 `0`；不能用 A 余额未再次减少推断第三单没有收费。第三单终态 `BudgetCapped` 是输出上限 16，未耗尽金额预算。

第三单原请求 `d845d6d1-3d55-44f7-899b-4b631f2c81ed` 的 Alchemy CLI invocation 未返回 `txHash` 或 `callId`，Router 一度保持 `reservation_unknown`、用量 0，未派单。原截止时间为 **2026-09-05 13:21:29（Asia/Shanghai）**；异常时 RPC 订单 state 0、latest/pending nonce 34，截止前仍不能排除延迟广播。只读会话检查为 valid、原钱包、具有 `evm.signTransaction`，有效至 9 月 12 日，根因未确定；CLI 完成广播前后都可能在返回引用前失败，不能写成会话失效或确认未广播。

到期后，区块 `59822378` 时间 `1788585850` 已严格超过截止 `1788585689`，订单仍 state 0、两种 nonce 均 34；Router 确认为 `lock_failed/unsubmitted`、`reservationUncertain=false`、用量和费用为零。脚本在区块 `59822557` 再次核对并把原尝试、终态和证明保存到 `failedAttempts`。主 agent 明确放行 `--execute --retry-lock-failed auto_long_a`，只允许固定 `-retry-1`；新请求 `9086ffc7-c914-49c8-999e-339859abb9d9` 成功，禁止自动生成 retry-2。这是验收脚本的受限恢复，不是生产 API 自动重试。安全门 4 项已纳入最终全量 64/64，并非把独立测试结果简单相加。

### 浏览器手动选择覆盖自动估价（独立第四单）

两节点同时在线时，Para B 从网页下拉框指定 A，提交 `69a28714-618a-4d8b-99c5-620cba33e728`。输入 54、输出 187、无缓存、输出上限 512、报价 v1，预算 `0.100000`，费用 `0.016580`、释放 `0.083420 dUSD`；[锁款](https://testnet.monadscan.com/tx/0x9903ae51b9a7a40f590f489942da77c492fb6c8feb11373256dcaf4bdfd90e58) 和 [结算](https://testnet.monadscan.com/tx/0x2bdb839417b6ac90d78d42d910d3e8bbaad915c41e480dffbb7a3cc721fb3754) 回执、调用参数、报价、订单、用量、Provider 执行和余额已独立核对。

自动估价 B `0.023720` 低于 A `0.042580 dUSD`，实际成交 A，证明网页手动选择覆盖自动候选。手动操作来自主 agent 的 Chrome DOM/账本观察；RPC 证明实际所选卖家和价格，合约不保存 manual/auto 标记，不能只靠链上数据声称看到点击动作。

B 托管 `9.944833 → 9.928253`，A `10.055167 → 10.071747`，B 授权花费增加 `0.016580`，锁定 `0`、剩余 `4.904913`。该段只写入市场 JSON 的 `webManualOverride`，`cases` / API `aggregate.count=3` 不变；前序八单浏览器 JSON 也保持原基线。复核脚本和本地 `--summary` 用法见运行手册。

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

旧版 `scripts/smoke-api-monad.ts`（当时的 `test:api:monad`）通过 `/auth/challenge`、严格买家挑战签名与 `/auth/verify` 登录，再用临时 API Key 向实际 Router 发起正常请求；独立运行 Provider 的执行历史、账单、链上订单及两笔回执相互核对。请求 ID 为 `8cfd3165-7b24-43d7-8692-74593624c561`。

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
| Foundry | D17 清理后 **41/41 通过** | 市场 38、Counter 2、不变量 1 套；invariant 128 × 64、fuzz 256；[业务测试](../contracts/test/InferenceMarket.t.sol) 涵盖资金、权限、预算、报价、授权、终态及回收 |
| 根 Node 单测 | D17 MON-only **91/91 通过**，根类型检查通过 | 含静态目录/同端口 6 项、限额/代理 12 项、浏览器签名与恢复；45/48/60/64/76/82 为历史计数，不相加；[server/test](../server/test/) / [provider/test](../provider/test/) / [恢复测试](https://github.com/onekb/Hackathon260905/blob/2b4de54536645a0a020e1071a06c909b285611c2/scripts/smoke-market-monad.test.ts) |
| Provider 独立回归 | 双卖家阶段 **34/34 通过**，包含在根全量中 | 临时钱包和本机 HTTP/WS 检查，不新增链上交易或 Alchemy 会话 |
| 公网限额与代理专项 | 新增 **12 项**、server **38/38** 均通过 | 固定起点、持久次数、并发、暂停/准确重放和代理 IP 等；未启用到原 Monad Router |
| 前序本机静态 Web 导出 | 配置 13 项正反检查、本机 URL 的 webpack 导出及 Web lint 通过 | `web/out` 已生成但未公网部署；未启用 public-build。Turbopack 端口权限失败与 Para AA 可选模块警告如实保留；3001 页面/钱包弹窗检查不含 API |
| 目标域名静态构建 | `https://demo.example.com` webpack 构建 exit 0，产物已上传 | 公开页面、JS 与配置已通过；后续 MON API/SSE 与浏览器登录/账户读取见当前证据 |
| 同端口静态/API/WS/SSE | 新增 6 项通过，根及新测试类型检查通过 | 临时本地端口与 MemoryChain；校验未结束 SSE 增量及实际 WS 握手，不涉及真实链/SSH/原 8788 重启 |
| 真实市场 / 账单截图 | 三张原始 JPEG 已保存并由主 agent 目视检查 | 新增 [公网市场](../artifacts/submission/inferpool-public-market.jpg) 1713×1452 为访客一在线 A；原本机市场 1713×1452 / 账单 1713×1108 保留本机历史来源。未修改像素、未新下单 |
| 买家/卖家 session 签名专项 | `provider/test/signer.test.ts` **9/9 通过**（包含在全量中） | 严格验证挑战目的、域名、身份、时效与 session，不扩大任意消息签名范围 |
| 根 TypeScript | `npm run typecheck` 通过 | 根项目检查；Web 独立配置另看构建与专项检查 |
| 本地 EVM 适配 | 依赖重建后 `npm run test:evm` 再次 **2/2 通过** | [evm-chain.test.ts](../tests/evm-chain.test.ts)：正常与失败、报价版本、预算、并发、直接回收 |
| HTTP + 双卖家 + EVM | 依赖重建后再次通过（上述 EVM 套件的另一项） | [integration.test.ts](../tests/integration.test.ts)：签名登录、Key、指定卖家、流式取消、失败全免、预算、缓存与幂等 |
| 独立进程本地 Demo | 已运行并请求成功 | [demo.ts](../scripts/demo.ts) 启动两个卖家；这是本地链，非 Monad |
| Monad 合约 smoke | 已通过并回读状态 | 上述两种责任结果；不经过完整网页和独立多钱包卖家 |
| 旧 dUSD HTTP/API smoke | 历史 scripts/smoke-api-monad.ts 通过 | 正常一单真实鉴权/API/独立进程/合约结算、幂等与 Key 撤销；同一钱包，不覆盖故障模式或浏览器 |
| Monad 双卖家 API | 三成功场景与一次失败恢复证据完整 | 指定 B、自动选 B、自动选 A；前两单跨钱包，第三单同钱包；临时 Key 撤销及 401、幂等同单/同交易通过 |
| 双卖家网页手动覆盖 | 第四单 UI 与独立对账通过 | Para B 手动选更贵 A；`webManualOverride` 单独记录，链上不保存手动标记 |
| 市场证据只读复核 | 根类型检查、目标 diff 检查及 `--summary` exit 0 | 修正汇总输出的 BigInt 序列化问题；summary 只读本地持久证据，无新签名/请求/交易，完整链上复核另用脚本 |
| Monad Router / Provider | 两个独立节点在线，API 与浏览器成交通过 | `seller-monad` 与 `seller-para` 各用不同钱包和报价 v1；重连及本轮四笔结算证据见上文 |
| Next 生产构建 | 本轮 `npm run build:web` exit 0，Next 16.3.4 | 包含 `/provider-connect` 静态页面和当前生命周期修复 |
| Web lint | 本轮全量 `npm run lint --workspace web` exit 0 | **0 errors / 0 warnings**；覆盖当前浏览器签名接入 |
| Web TypeScript | 本轮全 Web 类型检查 exit 0 | 覆盖本轮最终公开构建配置、签名页和生命周期；根 TypeScript 不代替该检查 |
| Para 初始化修复 | 类型、配置解析器断言与实际冷刷新通过 | 新标签正常渲染，无空 session 和 Solana runtime 异常；这不代表登录已完成 |
| 浏览器市场/钱包入口 | 实际冷刷新与点击检查通过 | `seller-monad`、四项报价 v1；Chrome 已置前，确认真实 InferPool 邮箱弹窗 |
| 五页访客界面 | 独立应用内预览逐页检查通过 | 市场、账单、钱包与授权、API 接入、成为卖家；未登录提示与禁用操作符合预期，无 RuntimeError；未打断 Chrome 验证码流程 |
| 前序浏览器钱包登录/平台会话 | 用户完成后在 Chrome 实际核对通过 | 初始 Para 地址不同于原卖家 A；当时受认证账户数据显示可用 `0`、授权 `0`，运行请求入口可见；该钱包现兼任卖家 B |
| 前序浏览器资金与请求场景 | 资金准备及六种目标场景、两次额外尝试共八单已确认 | 含实际主动取消；Chrome 与独立 RPC 相符，不同买卖钱包余额、订单、授权与总账均核对通过；该阶段没有第二卖家、钱包切换或断连/幂等浏览器验收 |
| 前序浏览器账单列表与详情 | 基线八行账单均显示已确认，可选单查看详情 | 主 agent 实际界面核对，与前序八单公开记录一致；本轮手动第四单另记 |
| 前序浏览器 API Key 生命周期 | 临时 Key 创建、离开后仅 preview、撤销提示均实际检查通过 | 凭证输出脱敏且不保存、不复制，未用该 Key 发 API；真实 HTTP 请求由前序独立 API smoke 覆盖 |
| 上手补丁检查 | 实际文件 eslint / 全 Web TypeScript 通过，地址、href 与复制反馈已核对 | 复制按钮显示“钱包地址已复制。”；不以该反馈扩大到其他未测交互 |
| 本轮提交前检查 | 目标文件凭证格式扫描无匹配，Web 环境文件仍被忽略 | 主 agent 汇总；只读复核脚本根类型检查和目标差异/新文件空白检查通过；不是对所有凭证形态的保证 |

本次 full Para SDK 的初装审计曾报告 120 项问题（含 Cosmos 依赖路径的 2 项 critical）。切换 Lite 内嵌钱包并移除不需要的多链/外部连接依赖后，当前审计为 **19 项：12 low、7 moderate，零 high/critical**；这不代表完全没有依赖风险。CLI 3.18 的 doctor 对 Lite/`ParaProviderMin`/无外部钱包配置存在静态规则误报，已按本机源码确认；实际浏览器结果另列，不能称为 doctor 全通过。

移除旧 SDK 时 npm Arborist 回滚曾报 `from undefined`。已用只含 package manifests 的干净临时目录重新解析 lock，正式 `npm ci` 成功（770 installed / 774 audited）。服务已恢复，Mac 解锁后完成上述 Chrome 验收；历史失败及解决过程保留在对话日志。

## 下一步

1. 应用部署与单端口交付已完成，公开网页、配置和常驻 A 的 WSS 认证通过。后续若继续业务验收，需在新域名登录钱包并观察有界请求的 SSE 接收与最终账单，补齐新增远端订单仅有后端/链上证据的边界；B 仍需重连。代理优化由用户处理，MOJO 仍未填写/上传/提交。
2. 补实际买家钱包切换、浏览器断连/幂等重试，以及提款、撤销授权和离线回收等未验交互；合约/本地测试不能直接计作浏览器通过，后续范围再按用户要求推进。
3. 演示前核对两个卖家在线、Router 测试 Gas、消费授权有效期与余额；保留原 Router 会话及各阶段证据，不混合前序八单、API 三单与本轮浏览器手动单。
4. 公网演示前检查交易提交稳定性，并补充可脱敏诊断。Alchemy 本次无交易引用的具体原因仍未知；已经验证零费失败与一次显式恢复，未宣称底层问题彻底修复。

TEE 和真实模型接入仍按原首版范围延后，本轮不因此扩大开发范围。

产品问题已足够明确，以上是开发与验证事项。登录或签名确需本人处理时再请求用户参与，不重复确认已授权的常规配置。

## 后续更新约定

每次里程碑更新对应行，并追加具体命令/场景、环境、结果和证据；失败也记录，不把“计划测试”改写成“测试通过”。新的决策进入 [决策记录](requirements-and-decisions.md)，用户的新要求进入 [对话日志](conversation-log.md)。
