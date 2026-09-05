# InferPool Web

InferPool 的买家与卖家操作界面，使用 Next.js 16.3.4、React、Para Lite 邮箱内嵌 EVM 钱包和 viem。当前源码使用 Monad 测试网原生 MON（18 位小数）托管与结算；所有推理输出、Token 和缓存仍是模拟。静态验证、部署和实际钱包交易是不同检查阶段，完整状态见 [开发进度](../docs/progress.md)。

## 启动与配置

从仓库根目录安装工作区依赖，并按 [运行手册](../docs/runbook.md) 启动 Router 与卖家。在 `web/.env.local` 配置：

```dotenv
NEXT_PUBLIC_ROUTER_URL=http://127.0.0.1:8788
NEXT_PUBLIC_PARA_API_KEY=<自己的Para前端公开Key>
```

本次开发环境已经配置公开 Key；该文件被 Git 忽略，不需要复制任何私密 Key 或会话令牌。缺少公开 Key 时，界面可显示，但不能完成钱包连接。修改环境变量后重启 Next。

从仓库根目录运行：

```bash
npm run dev:web
```

入口为 `http://127.0.0.1:3000`，开发服务仅监听本机。默认 Router 为 `8788`（连接 Monad 测试网）；本地 Anvil 演示使用 `8787`，要相应修改 Router URL。Router 的 `ALLOWED_ORIGINS` 必须包含实际前端来源，`localhost` 和 `127.0.0.1` 是不同 Origin。

`localhost` 地址只在运行这些进程的电脑上有效。公开前端之前，还需公开可用的 HTTPS/WSS Router、正确的前端环境变量和 Origin；启动 Next 不会自动产生公网 Demo。

公网准备支持可选静态导出：`INFERPOOL_STATIC_EXPORT=true INFERPOOL_PUBLIC_BUILD=true npm run build --workspace web -- --webpack`（根目录执行）。产物为 `web/out/`；公网标志会检查 HTTPS Router Origin 和 Para 前端 Key，防止发布后仍连接访客的本机。完整配置、持久账本与 HTTPS/SSE/WSS 代理模板见 [部署准备](../deploy/README.md)。未设置这些标志时保留原有 Next 开发和构建方式。

## 五个导航页面

这些页面在同一路由内切换，共用钱包、订单和后端计费流程。

| 页面 | 用途 |
| --- | --- |
| 推理市场 | 查看在线卖家和四项报价，指定或自动选商，设置单次预算、输出上限和缓存，显示流式输出与取消操作 |
| 请求账单 | 查看自己的请求、用量、责任结果、实际费用、释放金额及链上交易；区分预计和已确认账单 |
| 钱包与授权 | 查看钱包 MON、直接存款、设置/撤销消费授权、提款及超时回收 |
| API 接入 | 钱包会话创建、查看和撤销 API Key，提供最小文本聊天调用示例 |
| 成为卖家 | 发布链上模型报价、查看节点接入说明；卖家仍须独立运行 Provider 进程 |

## 网页钱包连接独立卖家

Provider 使用 `--browser-wallet` 与 `--wallet-ui` 时，从其本地控制台点击“连接网页钱包”，会打开 `/provider-connect`。页面恢复 Para 登录并核对节点地址、平台和收款钱包；点击“签名并连接节点”后，只签署一次严格限定用途的卖家认证挑战。该签名不授予消费、提款或发布报价的权限，节点启动命令见 [Provider 说明](../provider/README.md)。

控制台与弹窗双向检查固定 Origin 和窗口来源；钱包私钥不会导出到 Provider。请保持两个窗口打开。关闭页面、下线、钱包身份切换或连接失败后，须回到控制台重新打开连接窗口并签名，旧窗口不能用于重试。钱包同地址的内部访问器刷新不会中断正在进行的认证；实际钱包切换的浏览器验收状态以 [进度](../docs/progress.md) 为准。

## 测试资金流程

1. 通过邮箱连接 Para 内嵌钱包，等待地址就绪，再点击“签名登录”取得平台会话。签名登录是链外认证，不消耗 Gas。普通买家不需要安装开发者 CLI。
2. 为**这个新钱包地址**准备 Monad 测试网 MON。“钱包与授权”提供完整地址、复制反馈与仅测试网显示的 [官方水龙头](https://faucet.monad.xyz/) 入口；顶部含 `…` 的缩写不能用作收款地址。新钱包不继承已有 Alchemy 演示钱包的余额、Gas 或授权。
3. 在“钱包与授权”刷新余额。MON 同时用于推理预算和 Gas，不要将钱包余额全部存入合约。每次交易会重新估算 Gas（最多增加 10% 限额余量），以相同的 EIP-1559 费率上限检查余额并发送交易；余额不足时停止，不自动补币。
4. 点击“存入 MON”，通过无参数 `deposit()` 的交易 `value` 直接入金，只有一次存款确认。默认存款 `0.1 MON`。随后设置消费总上限，默认 `0.05 MON` / `24` 小时。存款和消费授权缺一不可。
5. 到推理市场发起默认预算 `0.001 MON` 的请求，或到 API 接入生成并立即保存 Key。整笔预算须同时被托管余额和剩余授权覆盖；锁款确认后才派单。Key 不能提款或增加额度。
6. 等待账单显示“链上已确认”，保存完整请求 UUID 并核对交易。卖家失败整单推理费为零，显式取消只收已产生费用；剩余预算先释放到托管余额，提款后才回钱包。

完整操作与自己的 Key 调用示例见 [新买家上手手册](../docs/runbook.md#新买家邮箱钱包的第一次请求)。`setup:monad` 和 `test:api:monad` 只针对已有 Alchemy session；`demo:request` 固定调用本地 Anvil，它们不会自动准备新邮箱买家的测试网账户。

“平台离线时取回锁款”接受完整请求 UUID 或 bytes32 订单 ID，直接通过 RPC 核对买家、金额和链上截止时间，到期后回收至托管余额，再提款，不依赖 Router 登录。仍需前端、RPC、Para 钱包可访问、原买家身份和测试 MON；回收及提款分别需要链上交易，不能理解为完全断网可操作。失败免除的是推理费，已消耗的 Gas 不会退回。

当前市场固定为 `0x142a4904307244Bed0cECD72dE8329A253333182`。当 `/config` 不可用时，仍可连接钱包直接管理该 MON 合约中的资金。账单必须同时提供 `asset_symbol: "MON"`、`asset_decimals: 18` 和与当前配置一致的 `market_address`；缺失或不匹配时显示“资产待核对”并禁用直接回收，不能将未知金额标为 MON。

原生市场 `/config` 需要 `asset_symbol: "MON"`、`asset_decimals: 18`、已验证 `market_address`。卖家默认报价为输入 `0.3`、缓存读取 `0.03`、缓存写入 `0.375`、输出 `0.8 MON / 百万模拟 Token`，最低预留 `0.000001 MON`。最低预留不是最低消费。修改前端默认报价不会自动发布链上报价。

浏览器钱包会话下单和取消请求时，会发送 `X-InferPool-Market`，值为当前配置的完整市场地址，避免缓存的网页操作其他市场。API Key 由后端绑定当前市场，不需要此请求头；列表里缺少或不匹配 `market_address` 的 Key 显示为不可用。

## 开发验证与文档

在根目录运行 `npm run build:web`、`npm run lint --workspace web`、`./node_modules/.bin/tsc --noEmit -p web/tsconfig.json` 和 `TSX_TSCONFIG_PATH=web/tsconfig.json node --import tsx --test web/lib/assets.test.ts web/lib/api.test.ts web/components/account-panel.test.tsx`。测试覆盖金额精度、HTTP 鉴权状态及无平台会话时的撤销入口。Web 使用独立 TypeScript 配置，根项目 `typecheck` 不能代替全部前端检查。新合约 ABI 导出至 `lib/abi/InferenceMarket.json`。

页面 HTTP 200、生产构建和配置解析器断言不能代替浏览器钱包交互。已知问题、修复及待验事项集中在 [进度](../docs/progress.md)，避免在组件 README 复制过期测试数字。开始改前端前还应阅读 [本目录 AGENTS.md](AGENTS.md)。

- [项目文档导航](../docs/README.md)
- [架构、计费和 API 协议](../docs/architecture-and-protocol.md)
- [运行部署与故障处理](../docs/runbook.md)
- [对话和工程决定的演变](../docs/conversation-log.md)
