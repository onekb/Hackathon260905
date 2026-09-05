# InferPool 三页演示

**约 2 分钟讲解 + 3 分钟网页演示。** 按 [五分钟速查](../../docs/demo-quickstart.md) 操作，现场只发一笔正常请求，故障展示先前已确认订单。

当前按用户纠正制作 v2：

- [InferPool-pitch-v2.pptx](InferPool-pitch-v2.pptx) / [InferPool-pitch-v2.pdf](InferPool-pitch-v2.pdf)：**PPT/PDF 3页全部逐页检查通过；中文无溢出，末页全宽账单区的两笔订单、0费用与.001释放可读**。
- 旧版 [PPT](InferPool-pitch.pptx) / [PDF](InferPool-pitch.pdf) 保留；旧版已检查3页，不能将此检查结果当成v2通过。

v2 三页依次讲：闲置推理能力与按需买家的供需价值；Monad 提供结算/预算/记录/钱包工具，InferPool 计划带来应用/Agent推理API与支付场景；卖家接入与买家使用流程。Token 是用量单位，不是库存；低价和减少闲置未做实价/利用率验证，不声称任意第三方额度转售或已有生态合作。

网页演示仍只发1笔正常请求，故障展示先前记录。证据为 [六笔交易](../../contracts/deployments/inferpool-native-browser.json) 和 [正常](../submission/native-normal-bill.jpg)、[故障](../submission/native-failure-bill.jpg)原图；正常历史费 .0001658 MON、故障0，不当作现场新结果。PDF完成后可全屏打开作备用，原图不改。

Monad 的高吞吐、快速确认和 EVM 兼容只作选型依据（[官方文档](https://docs.monad.xyz/)），不报旧技能性能数字，也不是本应用实测。逐单 Gas 显著高于当前模拟推理费，低价与微支付经济性尚需真实供给和成本优化验证。

AI 输出与计量为 Mock，资金交易在 Monad 测试网执行。PPT/PDF 是讲解材料，不是已完成的排演或录屏；本次制作未新发链上订单。
