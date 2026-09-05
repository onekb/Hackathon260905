# 独立 Mock 卖家节点

这个进程代表独立卖家：主动连接平台 `/provider`，由选定钱包签署一次性身份挑战，接收请求并流式返回固定 Mock 响应。卖家无需公网 IP；本地控制台只监听 `127.0.0.1`。推理、Token 和缓存效果都是模拟，Token 定义为 Unicode 码点单位，不是任何真实模型的 tokenizer。

当前源码默认报价资产为原生测试 MON；新市场已部署，公网 Router 尚未切换。旧版 dUSD 在线记录和第二卖家交易保持历史身份，不能用旧市场报价自动在新市场接单；切换需新市场发布报价并重新认证。见 [当前进度](../docs/progress.md)。

接单前，卖家钱包必须已在 Router 配置的链上为该模型发布有效报价。Router 会读取链上报价，忽略节点自报价格作为计费依据；未发布时会拒绝接入，并在控制台显示原因。本版本控制台不提供链上报价发布功能。

在仓库根目录安装依赖并启动 Router 后，可先运行两个独立终端查看本地控制台和公开钱包地址（完成链上注册前不会接单）：

```bash
npm run dev:provider -- --ephemeral-wallet --id seller-a --name "独立卖家 A" --port 8791
```

```bash
npm run dev:provider -- --ephemeral-wallet --id seller-b --name "独立卖家 B" --port 8792 --input-price 0.24 --output-price 0.6 --interval-ms 120
```

打开 `http://127.0.0.1:8791` 和 `http://127.0.0.1:8792`。默认平台地址是 `ws://127.0.0.1:8787/provider`，默认模型 `mock-reasoner`。使用 `--router wss://your-router.example/provider` 连接远程平台。节点拒绝将普通 `ws://` 用于非本机地址。

`--ephemeral-wallet` 明确生成仅保留在当前进程里的临时演示钱包；重启会改变地址，不打印或保存私钥。希望固定卖家身份时，在本地设置 `PROVIDER_PRIVATE_KEY` 环境变量后运行，去掉 `--ephemeral-wallet`。不要把私钥放进 CLI 参数、网页、Git 或聊天中。临时钱包仅适用于离线/演示环境；需要保留测试网收入时使用你管理的测试钱包。节点本身不会自动提款或发起链上交易。

## 使用现有 Alchemy session

已连接有效 EVM session 的 Alchemy CLI **0.24.0** 可用作卖家身份，无需提供钱包原始私钥。确认该 session 钱包已在 Router 使用的 Monad 测试网上为模型发布有效报价后运行：

```bash
npm run dev:provider -- --alchemy-session --router ws://127.0.0.1:8788/provider --id seller-monad --name "Monad 卖家" --port 8793 --input-price 0.3 --cache-read-price 0.03 --cache-write-price 0.375 --output-price 0.8 --min-reserve 0.000001
```

这里的 `8788` 是本机运行的测试网 Router，链上网络由 Router 配置决定；远程 Router 使用 `wss://` 地址。`--alchemy-session`（或 `PROVIDER_ALCHEMY_SESSION=true`）、`--ephemeral-wallet`、`PROVIDER_PRIVATE_KEY` 和下面的 `--browser-wallet` **四种身份互斥**。如果本地 shell 仍有其他身份环境变量，先取消对应配置。节点不会静默改用其他钱包。

该版本 CLI 没有公开的 `sign-message` 子命令。适配器通过已安装 CLI 的会话读取模块取得当前有效 EVM 委托信息，复用官方 `/wallet/evm/sign-message/challenge` 和 `/complete` 消息签名流程。会话委托密钥仅在本地生成证明，不发送给平台或签名服务；返回的 EVM 签名经地址校验后才用于 WebSocket 身份认证。此流程不发送链上交易，不调用 `--mode local`，也不会改变 CLI 的活动钱包或授权。

目前适配器固定验证 CLI 0.24.0 的内部模块结构；版本或模块不兼容时会明确失败。无有效 EVM session、消息签名权限被禁用、钱包发生变化或会话过期时也会提示错误，不会输出完整会话、密钥或认证令牌。若需重新建立会话，请在 Alchemy CLI 中完成 session 连接，再重启节点。

## 使用 Para 网页钱包

浏览器签名桥源码、Provider 自动化测试，以及真实 Para 首次认证、主动下线和新弹窗重签重连均已通过。逐笔市场成交及异常见 [开发进度](../docs/progress.md)。该模式不导出私钥或建立新的 Alchemy 会话；节点只取得一次 Provider 身份挑战签名，不取得转账或报价权限。

以下 B 示例使用新 MON 源码的本地 Router，身份需与 Web 登录钱包完全一致；先在同一新市场发布所填报价。它不是当前 B 已上线或已发布 MON 报价的声明；旧 dUSD 双卖家验收见进度：

```bash
npm run dev:provider -- \
  --browser-wallet 0xbc81A46F5eeE3924aA0B7fD8849eA08351194A75 \
  --wallet-ui http://127.0.0.1:3000 \
  --router ws://127.0.0.1:8788/provider \
  --id seller-para --name "Para 独立卖家 B" --port 8794 \
  --input-price 0.6 --cache-read-price 0.06 --cache-write-price 0.75 \
  --output-price 0.4 --min-reserve 0.000001
```

参数对应 `PROVIDER_BROWSER_WALLET` 和 `PROVIDER_WALLET_UI`，必须成对设置。`wallet-ui` 必须是固定 HTTPS origin 或本机 HTTP origin，不允许凭证、额外路径、查询和片段；`localhost` 与 `127.0.0.1` 是不同 origin，须与实际 Web 地址一致。

1. 启动后节点保持离线，打开本地控制台 `http://127.0.0.1:8794`，点击“连接网页钱包”。
2. 在弹出的 `/provider-connect` 页面完成 Para 登录，确认钱包、节点及 Router 信息，然后主动准备好签名；准备完成后才建立节点 WebSocket。
3. 签署精确的五行 Provider 认证挑战。每次准备只允许一次握手，桥接签名时限最长 12 秒；用途、域名、nonce、有效期、请求 ID 和钱包都须匹配，节点还会验证返回签名。
4. 保持本地控制台和钱包弹窗打开。断线、下线或关闭任一窗口后，从控制台重新打开并准备签名；浏览器身份不自动重连或重放请求。

控制台和弹窗双向核对 `postMessage` 的 origin/source；本地挑战、签名等 POST 仍要求既有 CSRF 凭证和同源请求，不开放 CORS。网页钱包签名不是代币授权，链上报价仍需卖家在 Web 显式发布并等待回执。当前 B 报价发布结果见进度页；报价存在不代表节点已经上线或成交。

## 演示操作

控制台支持在线/下线、修改报价及以下新订单模式：

| 模式 | 行为 |
| --- | --- |
| `normal` | 正常流式完成 |
| `timeout` | 接单但不输出，等待 Router 截止时间与取消 |
| `fail-before` | 首个输出前报告卖家失败 |
| `fail-mid` | 输出部分内容后报告卖家失败 |
| `cache-hit` | 请求模拟缓存；相同买家、卖家、模型和完整上下文首次写入，成功后第二次才可命中 |

故障模式在接单时固定，不影响已开始订单。本地报价修改需要当前无在途订单；在线保存后需要重新认证并读取链价，浏览器钱包模式须重新从控制台准备签名，其他模式自动重连。该操作**不会签署交易、发布或修改链上报价**。新价格必须先通过卖家钱包在链上发布才可用于接单。下线会中止本地在途订单，Router 根据断连判责；节点重连不会重发它们。

每百万模拟 Token 的默认本地配置分别为普通输入 `0.3`、缓存读取 `0.03`、缓存写入 `0.375`、输出 `0.8` MON；最低预留为 `0.000001` MON。这些默认数值不是已发布的市场报价。控制台分开展示本地配置和平台连接时确认的链上有效报价，并标注二者是否一致；断线后保留的只是最近一次确认记录，每单仍由平台读取链上有效报价。最低预留不是最低消费，最终收费由 Router 的独立用量计算与订单结算规则决定。控制台仅显示节点执行记录，不能作为链上收款成功的证明。

查看全部参数：

```bash
npm run dev:provider -- --help
```

常用环境变量为 `PROVIDER_ROUTER_URL`、`PROVIDER_ID`、`PROVIDER_NAME`、`PROVIDER_MODEL`、`PROVIDER_PORT`、`PROVIDER_CAPACITY`、`PROVIDER_INTERVAL_MS`、`PROVIDER_CHUNK_SIZE`、`PROVIDER_MODE` 和四种 `PROVIDER_*_PRICE`。明确设置 `PROVIDER_EPHEMERAL=true` 等同临时钱包参数。

## WebSocket 协议

1. 平台发送 `challenge {nonce,message,expiresAt}`。消息必须包含平台 host、nonce、provider 身份认证说明；节点检查时效与重放后签名。
2. 节点发送 `auth {address,signature,mock:true,provider:{id,name,modelId,capacity,pricing,mode}}`。
3. 平台发送 `authenticated {providerId,quote,mock:true}`，节点将 `quote` 保存为 `effectivePricing`，与本地配置分开展示；`rejected {message}` 的拒绝原因也会保留到控制台。认证成功后节点每 5 秒发送 `heartbeat {availableSlots,mode}`，容量变化也会发送。
4. 平台派发 `request {requestId,buyer,model,messages,maxTokens,cache,usage}`。`usage` 为 `{input,cacheRead,cacheWrite,output}`，由 Router 按模拟规则计算；节点仅回显到控制台。
5. 节点发送 `started {requestId}`、零到多个 `chunk {requestId,seq,text,outputTokens}`，最后发送 `completed` 或 `failed`。chunk 序号从 `0` 连续增加，终态携带下一个 `seq`；`outputTokens` 为当前片段码点数，Router 必须独立计算，不能信任节点自报。
6. 平台发送 `cancel {requestId,reason}`，节点立即停止后续输出并回复 `cancelled {requestId,seq}`。

近期重复 request ID 不会重新执行。断线立即停止全部在途任务，重连重新做钱包认证。平台处理预算、计量、故障责任与链上结算，节点不自行修改账单。

## 验证

```bash
npm run test --workspace @inferpool/provider
```

测试覆盖正常/中途失败/首输出前失败、Unicode 用量、序号、取消、并发容量、重复派单、重连、挑战签名与过期/错误域名拒绝、本地配置不覆盖已确认报价、连接拒绝原因展示，以及浏览器身份互斥、单次握手、错误签名/重放/超时拒绝和控制台消息桥。HTTP/WebSocket 契约测试需要允许监听本机端口；这些临时测试钱包与本机端口检查不代表实际 Para 或链上验收通过。
