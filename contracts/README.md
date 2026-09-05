# InferPool 合约

当前 `src/InferenceMarket.sol` 是**原生测试 MON** 市场，构造参数仅 `router`；`deposit()` 接收 `msg.value`，`withdraw(uint256)` 原生转账，`settle` 只记内部可提款收益。资产为 `MON / 18 decimals`，不存在 `token()` 或 ERC-20 approve 流程；每百万计费分母仍为 1e6。提款采用先更新余额再转账、防重入和失败回滚。

| 版本 | 测试网地址与用途 |
| --- | --- |
| 新原生 MON 市场 | `0x142a4904307244Bed0cECD72dE8329A253333182`；[部署/双浏览器验证证据](deployments/inferpool-mon-native-testnet.json) |

新合约部署交易 [0xa6da3b…10ed0](https://testnet.monadscan.com/tx/0xa6da3bd7812867daddc53999b06263d76754f7ba3bcb718acdb7d3053aa10ed0) 成功；native/MON/18、router 和运行字节码回读通过，源码验证 2/2。公网服务已切 MON，同钱包小额实链验收已通过；公网 API/SSE 一单及浏览器登录/账户读取通过，独立买家 MON 网页存款/授权及正常、故障两单已验，逐帧 SSE 未采证，状态见 [进度](../docs/progress.md)。旧 dUSD 交易证据不得改标 MON。

[独立买家网页验收](deployments/inferpool-native-browser.json) 核对 B 存 .1 MON、授权 .05/24h 与正常/故障两单共六笔交易：正常费 .0001658 MON、失败 0，B 与卖家 A 不同钱包，A 兼任 Router。浏览器观察完成和账单，未采逐帧增长；[API 34 批 SSE 证据](deployments/inferpool-native-api-smoke.json) 独立保留。

在仓库根目录安装、编译与测试：

```sh
npm run setup:contracts
forge build --root contracts
npm run test:contracts
```

D17 删除 DemoUSD 源码及其两项测试后，本地 **41/41** 通过（原生市场 38、Counter 2、不变量 1 套）；原生合约源码及创建/运行字节码模板哈希未变，含拒收回滚、重入保护、资金守恒；依赖版本见 [DEPENDENCIES.md](DEPENDENCIES.md)。当前仅保留原生业务合约，不提供旧 ABI/兼容脚本。旧 [dUSD 回执](deployments/inferpool-monad-testnet.json) 是历史存档；链上记录不可删除，本轮不兑换、销毁或代提款。旧源码仅在 Git 历史。

```sh
node scripts/deploy-mon-native.mjs
node scripts/deploy-mon-native.mjs --verify-only
```

默认是只读部署预检；`--verify-only` 复核已有部署并重试源码验证，不新部署。显式 `--deploy` 才部署/恢复新市场并验证。`node --import tsx scripts/native-monad.ts` 默认只读；`--execute --smoke` 才进行受限存款、授权、两单锁款/结算和提款。准确金额、恢复边界及钱包设置见 [运行手册](../docs/runbook.md#原生-mon-测试网当前源码)。

## 历史 Counter 示例

以下保留立项前的 Counter 示例和部署记录。它不是 InferPool 业务合约；任何人都可以调用 `increment()`，通过 `number()` 读取计数。

## 网络

- 目标：Monad Testnet
- Chain ID：10143
- RPC：https://testnet-rpc.monad.xyz
- 浏览器：https://testnet.monadscan.com

## 本地验证

在此目录运行：

```sh
forge build
forge test -vv
```

## 部署状态

已部署到 Monad Testnet，交易回执成功。

- 合约地址：`0x3634ee592376332E19603bD3edFFC0446b4F2ed8`
- 部署交易：`0x2d54144f120340445905cb22f8471b401271135dc29af159a358bce3e1171b0a`
- 浏览器：https://testnet.monadscan.com/address/0x3634ee592376332E19603bD3edFFC0446b4F2ed8
- 链上运行字节码与本地编译产物完全一致，部署后读取 `number()` 为 `0`。
- 本地测试：2 项通过。
- 源码验证：已通过。MonadVision 返回 `Verified with perfect match`，Monadscan 返回 `Pass - Verified`。请求及验证结果分别保存在 `deployments/verification-request.json` 和 `deployments/verification-result.json`。
- 部署记录：`deployments/monad-testnet.json`。

读取计数：

```sh
cast call 0x3634ee592376332E19603bD3edFFC0446b4F2ed8 'number()(uint256)' --rpc-url https://testnet-rpc.monad.xyz
```

## 钱包与历史记录

当前部署使用受限 Alchemy session，地址须与市场固定 Router 相同；首次设置、过期续批和服务器隔离见 [部署手册](../deploy/README.md)。不要为重跑历史 Counter 示例重连或替换当前 Router 的会话，不保存私钥或令牌。
