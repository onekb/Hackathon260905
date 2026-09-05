# InferPool 合约

当前业务合约为 `src/DemoUSD.sol` 和 `src/InferenceMarket.sol`：演示代币、链上报价、托管余额、限额授权、订单预留与结算、超时回收。部署和源码验证已完成；地址及交易见 [部署记录](deployments/inferpool-monad-testnet.json)，同钱包初始化与烟测见 `deployments/inferpool-setup-monad.json` 和 `deployments/inferpool-smoke-monad.json`。完整运行方式、信任边界与验收状态见 [项目文档](../docs/README.md)。

依赖安装在仓库根目录执行 `npm run setup:contracts`，编译执行 `forge build --root contracts`，验证执行 `npm run test:contracts`。依赖版本和校验见 [DEPENDENCIES.md](DEPENDENCIES.md)。

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

## 钱包连接（首次配置或会话过期时）

用户在终端完成账号设置：

```sh
nvm use 22.23.2
npm install -g @alchemy/cli@latest
alchemy auth
```

随后在 https://dashboard.alchemy.com/products/agent-wallet/evm-wallet 创建 EVM Agent Wallet 会话，再按 CLI 提示连接：

```sh
alchemy wallet connect --mode session
alchemy wallet use session
```

私钥、助记词和会话令牌不要放入聊天或提交到仓库。会话连接完成后，由代理检查测试网、钱包状态和余额，再部署此合约。
