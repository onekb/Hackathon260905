# InferPool Web

InferPool 的买家与卖家操作界面，使用 Next.js 16.3.4、React、Para Lite 邮箱内嵌 EVM 钱包和 viem。所有推理输出、Token 和缓存都是模拟；资金使用 Monad 测试网的自建 DemoUSD。Chrome 独立买家的资金准备和正常、失败、预算、缓存、主动取消六种目标场景通过；网页 Key 生命周期已检查，未用该 Key 发请求。完整结果及未验范围见 [开发进度](../docs/progress.md)。

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
| 钱包与授权 | 领取测试 dUSD、批准并存款、设置/撤销消费授权、提款；通过链上数据检查并回收超时订单 |
| API 接入 | 钱包会话创建、查看和撤销 API Key，提供最小文本聊天调用示例 |
| 成为卖家 | 发布链上模型报价、查看节点接入说明；卖家仍须独立运行 Provider 进程 |

## 网页钱包连接独立卖家

Provider 使用 `--browser-wallet` 与 `--wallet-ui` 时，从其本地控制台点击“连接网页钱包”，会打开 `/provider-connect`。页面恢复 Para 登录并核对节点地址、平台和收款钱包；点击“签名并连接节点”后，只签署一次严格限定用途的卖家认证挑战。该签名不授予消费、提款或发布报价的权限，节点启动命令见 [Provider 说明](../provider/README.md)。

控制台与弹窗双向检查固定 Origin 和窗口来源；钱包私钥不会导出到 Provider。请保持两个窗口打开。关闭页面、下线、钱包身份切换或连接失败后，须回到控制台重新打开连接窗口并签名，旧窗口不能用于重试。钱包同地址的内部访问器刷新不会中断正在进行的认证；实际钱包切换的浏览器验收状态以 [进度](../docs/progress.md) 为准。

## 测试资金流程

1. 通过邮箱连接 Para 内嵌钱包，等待地址就绪，再点击“签名登录”取得平台会话。签名登录是链外认证，不消耗 Gas。普通买家不需要安装开发者 CLI。
2. 为**这个新钱包地址**准备 Monad 测试网 MON。“钱包与授权”提供完整地址、复制反馈与仅测试网显示的 [官方水龙头](https://faucet.monad.xyz/) 入口；顶部含 `…` 的缩写不能用作收款地址。新钱包不继承已有 Alchemy 演示钱包的余额、Gas 或授权。
3. 在“钱包与授权”刷新余额，确认有足够测试 MON，再领取一次 `1,000 dUSD`。领取本身也需要 Gas，dUSD 不能替代 MON 支付；DemoUSD 没有现实美元价值。
4. 点击“批准并存款”，等待精确金额的 `approve` 和 `deposit` 各自交易确认；默认存款 `10 dUSD`。随后设置消费总上限与有效期，默认 `5 dUSD` / `24` 小时。存款和消费授权缺一不可。
5. 到推理市场发起预算 `0.10 dUSD` 等请求，或到 API 接入生成并立即保存 Key。整笔预算须同时被托管余额和剩余授权覆盖；锁款确认后才派单。Key 不能提款或增加额度。
6. 等待账单显示“链上已确认”，保存完整请求 UUID 并核对交易。卖家失败整单推理费为零，显式取消只收已产生费用；剩余预算先释放到托管余额，提款后才回钱包。

完整操作与自己的 Key 调用示例见 [新买家上手手册](../docs/runbook.md#新买家邮箱钱包的第一次请求)。`setup:monad` 和 `test:api:monad` 只针对已有 Alchemy session；`demo:request` 固定调用本地 Anvil，它们不会自动准备新邮箱买家的测试网账户。

“平台离线时取回锁款”接受完整请求 UUID 或 bytes32 订单 ID，直接通过 RPC 核对买家、金额和链上截止时间，到期后回收至托管余额，再提款，不依赖 Router 登录。仍需前端、RPC、Para 钱包可访问、原买家身份和测试 MON；回收及提款分别需要链上交易，不能理解为完全断网可操作。失败免除的是推理费，已消耗的 Gas 不会退回。

## 开发验证与文档

在根目录运行 `npm run build:web` 和 `npm run lint --workspace web`。Web 使用独立 TypeScript 配置，根项目 `typecheck` 不能代替全部前端检查。合约 ABI 改变后用 `npm run export:abi` 同步导出并核对部署版本。

页面 HTTP 200、生产构建和配置解析器断言不能代替浏览器钱包交互。已知问题、修复及待验事项集中在 [进度](../docs/progress.md)，避免在组件 README 复制过期测试数字。开始改前端前还应阅读 [本目录 AGENTS.md](AGENTS.md)。

- [项目文档导航](../docs/README.md)
- [架构、计费和 API 协议](../docs/architecture-and-protocol.md)
- [运行部署与故障处理](../docs/runbook.md)
- [对话和工程决定的演变](../docs/conversation-log.md)
