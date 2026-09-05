# 演示域名引用盘点

日期：2026-09-05（Asia/Shanghai）。先完成只读盘点，随后用户明确“只处理 git 仓库和 git 历史”。**当前进入已授权清理阶段，尚未确认历史重写、远端更新或最终验证完成。** 本页不重复旧域名字面量。

## 本轮授权与记录约定

- 仅处理 Git 管理的当前文件与提交历史，包括文档、配置样例、脚本、公开回执和 PPT/PDF。没有授权处理服务器、MOJO 实际项目字段、DNS、HTTPS、Para 配置、被忽略的本地产物或其他副本；现有网站运行保持原样。IP 地址等其他数据不在此次清理目标内。
- 公开资料中的 `demo.example.com` 统一表示域名脱敏占位，**不是新部署地址，也没有验证该示例地址可访问**。历史验收中显示的占位 URL 不应被当作当时实际请求的目的地。回执仅替换域名展示，保留真实链 ID、合约地址、交易哈希、金额、请求 ID 与结果，不修改链上证据。
- 清理会改变相关 Git 提交及后继提交 SHA。文档中的旧短 SHA、服务器 `/srv/inferpool/releases/` 目录名和旧产物摘要作为当时历史标签保留，不能直接解释为重写后 Git SHA，也不代表服务器重新部署；新旧提交映射须以实际重写输出为准，不能按字符串猜测。
- 完成后应重新克隆仓库，或按经核对的迁移步骤切换到新历史；不要从旧本地副本直接 merge 或 push，以免把旧域名与历史重新带回。
- 执行与验证结果由主 agent 完成后补记；范围依据见 [D18](requirements-and-decisions.md#d18--仅清理-git-仓库及历史中的演示域名)。

## 清理前只读盘点

- 基线提交：`895a613`。当前 20 个已跟踪文件命中：16 个文本文件共 50 处，2 个 PPTX 与 2 个 PDF 共 6 处。PPTX 解包检查 XML/关系，PDF 提取正文；不能靠压缩文件的原始字节搜索判断。
- 本地全部可达历史共 21 次提交，其中 14 个提交快照有文本命中。首次为 `319c6b9`（2026-09-05 14:21:29 +08:00）。本地只有 main / origin/main，未发现标签；提交消息和 reflog 消息未发现域名字面量。
- 16 个文本文件：根 `README.md`；`scripts/smoke-native-api.ts`；`deploy/README.md`、`deploy/router.env.example`、`deploy/provider.env.example`；`docs/README.md`、`docs/progress.md`、`docs/conversation-log.md`、`docs/requirements-and-decisions.md`、`docs/runbook.md`、`docs/demo-guide.md`、`docs/demo-quickstart.md`、`docs/hackathon-submission.md`；`artifacts/submission/README.md`、`artifacts/submission/mojo-form.md`、`artifacts/submission/mojo-submission.json`。
- 4 个演示文件：`artifacts/presentation/InferPool-pitch.pptx`（正文及备注共 3 处）、`InferPool-pitch-v2.pptx`（正文 1 处），以及各自 PDF（第 3 页各 1 处）。全部 11 张已跟踪 PNG/JPEG 目视未发现可见域名，SVG 文本搜索未命中。
- 被 Git 忽略的本地产物仍有引用：`.local/` 中的部署压缩包、PPT 构建脚本/中间文件/渲染图，以及 `web/out`、`web/.next` 的 JS 与缓存。一个压缩包的文件名也包含域名。`web/.env.local` 本轮未命中。用户打开 PPT 产生的锁文件未触碰。
- 服务器只读确认 `/srv/inferpool/state/router.env`、`provider.env` 各命中 2 处；当前 `web/out` 的 2 个 JS chunk 各命中 1 处。两个 systemd unit 未命中。存在 `a78470a`、`319c6b9` 两个 release，旧 release 与私有账本/备份未做完整扫描。未输出凭证内容。
- MOJO 已保存提交回执的 Demo URL 字段包含该地址；本轮直接网页读取未成功，未重新验证线上表单内容或修改权限。
- GitHub API 本轮确认仓库公开，homepage/description 为空，forks 为 0，wiki/pages 关闭，无 Release、无 Actions 运行，开放 issue 数为 0。域名相关 issue 搜索无结果。公网搜索无结果不代表不存在缓存或第三方副本。

## 本轮执行记录

2026-09-05（Asia/Shanghai），以下为主 agent 已完成的当前文件清理及离线验证，**尚未执行 Git 历史重写或远端推送，不是整个任务完成声明**：

- 当前 16 个命中文本文件已脱敏；包含示例域名的 Markdown 已补充占位说明。公开验收记录的链上证据不随域名展示替换而改变。
- 当前及历史涉及的 4 个 PPT/PDF 唯一 blob 已完成净化，4 个当前演示文件已装回工作树。PPT 解包后的正文、备注、关系与元数据，以及 PDF 全部解压对象均检查未发现旧域名；不能仅凭原始压缩字节搜索下结论。
- 两版共 6 页均已视觉检查通过，仅各版第 3 页的可见域名改为“项目演示”，其余内容和版面保留。
- `scripts/smoke-native-api.ts` 新增必填 `INFERPOOL_API_ORIGIN`，只接受 HTTP(S) 裸 origin。根 `npm run typecheck` 通过；未配置、非 HTTP(S) 协议、附带路径这 3 个离线拒绝用例均在网络请求与签名前退出。此验证没有发起推理或链上交易。
- 下一步由主 agent 提交当前清理，在隔离副本重写历史，并分别核对全部目标 refs、当前文件与远端结果；上述历史 blob 净化仅表示替换素材已准备，不代表旧提交已消失。

## 去除方案与边界

1. **当前公开文件：** 将部署样例改为示例域名，验收脚本改为配置参数；清理文档、提交材料与 PPT 正文/备注，再导出 PDF。可继续在私有运行配置中保留真实域名，保持现有演示可用。
2. **Git 提交历史：** 在隔离副本中重写包含引用的文件历史，并处理历史 PPT/PDF；核对所有目标 refs 后才更新远端。单独新增删除提交不能清理旧版本。重写会改变首次相关提交及其后续提交的 SHA，需协调已有副本、旧 SHA 文档引用与部署版本对应关系。用户已明确授权此范围；执行完成与远端同步需另有验证记录。
3. **外部与运行环境：** 如果还要解除公开关联，需要另行修改 MOJO Demo 地址，并按目标范围处理本地产物、服务器 release/配置以及网站地址。更换域名时须联动 Router public URL、CORS、Provider WSS、前端构建、DNS/HTTPS 和钱包来源配置，不能直接删掉运行中的配置值。
4. **无法保证全网无痕：** 本机与可控仓库能清理，别人的 clone、下载附件、缓存和既有传播无法由一次 force-push保证抹除。GitHub 官方还说明，重写后旧 SHA 缓存、PR 引用和 fork 可能保留内容，且不会协助移除一般非敏感数据。见 [GitHub 历史清理说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)。

未全面检查：工作区外副本、浏览器存储、Para 后台、1Panel 实际站点目录、域名解析/证书记录、服务器私有备份、已删除或不可访问的外部资料。上述清理前盘点不是完成证明；本轮最终结果仍待主 agent 核对。
