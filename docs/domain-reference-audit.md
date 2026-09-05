# 演示域名引用盘点

日期：2026-09-05（Asia/Shanghai）。先完成只读盘点，随后用户明确“只处理 git 仓库和 git 历史”。**用户最新要求 PPT 不上传仓库。本轮正在将两版 PPTX 与对应 PDF 从 Git 当前跟踪及全部历史移除，保留本地文件内容不动；前次脱敏并推送只是中间阶段，最终重写尚未完成。** 本页不重复旧域名字面量。

## 本轮授权与记录约定

- 最终范围依用户最新纠正：继续清理 Git 当前文件及提交历史中的目标域名；两版 PPTX 与对应 PDF 从当前 Git 跟踪及全部历史移除，并加入忽略规则，本地文件内容不再处理。新克隆不应包含这 4 个演示文件。文档、配置样例、脚本与公开回执仍在域名清理范围。服务器、MOJO 实际字段、DNS、HTTPS、Para、其他 ignored 本地产物及 IP 等其他数据不在范围内；现有网站运行保持原样。
- 公开资料中的 `demo.example.com` 统一表示域名脱敏占位，**不是新部署地址，也没有验证该示例地址可访问**。历史验收中显示的占位 URL 不应被当作当时实际请求的目的地。回执仅替换域名展示，保留真实链 ID、合约地址、交易哈希、金额、请求 ID 与结果，不修改链上证据。
- 清理会改变相关 Git 提交及后继提交 SHA。文档中的旧短 SHA、服务器 `/srv/inferpool/releases/` 目录名和旧产物摘要作为当时历史标签保留，不能直接解释为重写后 Git SHA，也不代表服务器重新部署；新旧提交映射须以实际重写输出为准，不能按字符串猜测。
- 完成后应重新克隆仓库，或按经核对的迁移步骤切换到新历史；不要从旧本地副本直接 merge 或 push，以免把旧域名与历史重新带回。
- 执行与验证结果由主 agent 完成后补记；范围依据见 [D18](requirements-and-decisions.md#d18--仅清理-git-仓库及历史中的演示域名)。

## 清理前只读盘点

- 基线提交：`895a613`。当前 20 个已跟踪文件命中：16 个文本文件共 50 处，2 个 PPTX 与 2 个 PDF 共 6 处。PPTX 解包检查 XML/关系，PDF 提取正文；不能靠压缩文件的原始字节搜索判断。
- 本地全部可达历史共 21 次提交，其中 14 个提交快照有文本命中。首次为 `319c6b9`（2026-09-05 14:21:29 +08:00）。初次分支盘点显示 main / origin/main，未发现标签（不代表已检查 Codex 内部 refs）；提交消息和 reflog 消息未发现域名字面量。
- 16 个文本文件：根 `README.md`；`scripts/smoke-native-api.ts`；`deploy/README.md`、`deploy/router.env.example`、`deploy/provider.env.example`；`docs/README.md`、`docs/progress.md`、`docs/conversation-log.md`、`docs/requirements-and-decisions.md`、`docs/runbook.md`、`docs/demo-guide.md`、`docs/demo-quickstart.md`、`docs/hackathon-submission.md`；`artifacts/submission/README.md`、`artifacts/submission/mojo-form.md`、`artifacts/submission/mojo-submission.json`。
- 4 个演示文件：`artifacts/presentation/InferPool-pitch.pptx`（正文及备注共 3 处）、`InferPool-pitch-v2.pptx`（正文 1 处），以及各自 PDF（第 3 页各 1 处）。全部 11 张已跟踪 PNG/JPEG 目视未发现可见域名，SVG 文本搜索未命中。
- 被 Git 忽略的本地产物仍有引用：`.local/` 中的部署压缩包、PPT 构建脚本/中间文件/渲染图，以及 `web/out`、`web/.next` 的 JS 与缓存。一个压缩包的文件名也包含域名。`web/.env.local` 本轮未命中。用户打开 PPT 产生的锁文件未触碰。
- 服务器只读确认 `/srv/inferpool/state/router.env`、`provider.env` 各命中 2 处；当前 `web/out` 的 2 个 JS chunk 各命中 1 处。两个 systemd unit 未命中。存在 `a78470a`、`319c6b9` 两个 release，旧 release 与私有账本/备份未做完整扫描。未输出凭证内容。
- MOJO 已保存提交回执的 Demo URL 字段包含该地址；本轮直接网页读取未成功，未重新验证线上表单内容或修改权限。
- GitHub API 本轮确认仓库公开，homepage/description 为空，forks 为 0，wiki/pages 关闭，无 Release、无 Actions 运行，开放 issue 数为 0。域名相关 issue 搜索无结果。公网搜索无结果不代表不存在缓存或第三方副本。

## 本轮执行记录

### 当前文件准备检查点

2026-09-05（Asia/Shanghai），主 agent 先完成以下当前文件清理及离线验证；本小节记录历史重写前的检查点，后续远端结果见下一小节：

- 当前 16 个命中文本文件已脱敏；包含示例域名的 Markdown 已补充占位说明。公开验收记录的链上证据不随域名展示替换而改变。
- 当前及历史涉及的 4 个 PPT/PDF 唯一 blob 已完成净化，4 个当前演示文件已装回工作树。PPT 解包后的正文、备注、关系与元数据，以及 PDF 全部解压对象均检查未发现旧域名；不能仅凭原始压缩字节搜索下结论。
- 两版共 6 页均已视觉检查通过，仅各版第 3 页的可见域名改为“项目演示”，其余内容和版面保留。
- `scripts/smoke-native-api.ts` 新增必填 `INFERPOOL_API_ORIGIN`，只接受 HTTP(S) 裸 origin。根 `npm run typecheck` 通过；未配置、非 HTTP(S) 协议、附带路径这 3 个离线拒绝用例均在网络请求与签名前退出。此验证没有发起推理或链上交易。
- 此准备阶段的历史 blob 净化只表示替换素材已就绪；随后才执行下面单列的历史重写与远端核验。

### 中间阶段：GitHub 脱敏历史与独立克隆验证

- **远端更新成功：** 通过 SSH 并指定精确 `force-with-lease`，GitHub `main` 从旧 `895a613` 更新为 `a4842c77b093d1930ef25f804cd8342c33d34873`。这是重写完成时的提交，不表示后续验证文档也已归档。
- **重写范围：** 修改 92 个历史文本 blob、4 个演示文件 blob。21 个原始提交中 7 个 SHA 保持不变、14 个改变，加上新清理提交共 15 个 SHA 改变。22 个提交逐一核对了树路径、文件权限、非目标 blob、作者及时间、消息与父关系，均与预期一致；净化后当前树也一致。
- **独立远端复核：** 从 GitHub 新建 mirror 克隆，包含 22 个 commit、167 个 tree、443 个 blob，共 632 个对象，检查 1,418 个目录项。refs 仅 `main`、无标签；该全新克隆无不可达对象或 reflog。原文内容、路径和提交内容搜索、PPT 解压成员及全部 PDF 流检查均为零命中，无扫描失败。此结论针对实际从远端取得的历史，不能据此声称 GitHub 外部缓存也已删除。
- **历史引用：** 两个当前文档中的历史源码 GitHub 链接已按实际 commit-map 更新；服务器 release 名继续保留当时标签，不把它改成重写后的 SHA，也未重新部署。

### 最终范围调整与当前待办

- 用户在上述中间阶段后明确“PPT 不需要管，只处理 Git 和 Git 历史，PPT 不上传到仓库”。因此不再改本地 PPT 内容，也不需要用户关闭 WPS；用户新增编辑保持原样，当前编辑版本未审阅，不混入清理提交。
- 两版 PPTX 及对应 PDF 改为仅本地材料，计划从当前跟踪和全部历史删除并加入 ignore。仓库文档不再提供这些文件的下载链接，历史生成与视觉检查仅代表当时产物，不代表当前用户编辑版本。新克隆将不含 PPT/PDF。
- 主 agent 正在执行最终移除规则、再次重写和核验远端；此前 `a4842c77b093d1930ef25f804cd8342c33d34873` 及 632 对象结果仅为中间阶段，不能当作最终交付。原工作区旧 Git refs/reflog/对象仍待收尾和 GC。
- 最终需核对目标演示路径在所有 Git 历史中均不存在、域名扫描为零、远端新克隆一致，并确认本地用户文件未被此次移除更改。

## 去除方案与边界

1. **当前公开文件：** 将部署样例改为示例域名，验收脚本改为配置参数；清理文档与提交材料；按用户最终要求，PPT/PDF 仅从 Git 跟踪与历史移除，不修改本地内容。可继续在私有运行配置中保留真实域名，保持现有演示可用。
2. **Git 提交历史：** 在隔离副本中重写包含引用的文件历史，并从全部历史移除目标 PPT/PDF；核对所有目标 refs 后才更新远端。单独新增删除提交不能清理旧版本。重写会改变首次相关提交及其后续提交的 SHA，需协调已有副本、旧 SHA 文档引用与部署版本对应关系。用户已明确授权此范围；执行完成与远端同步需另有验证记录。
3. **外部与运行环境：** 如果还要解除公开关联，需要另行修改 MOJO Demo 地址，并按目标范围处理本地产物、服务器 release/配置以及网站地址。更换域名时须联动 Router public URL、CORS、Provider WSS、前端构建、DNS/HTTPS 和钱包来源配置，不能直接删掉运行中的配置值。
4. **无法保证全网无痕：** 本机与可控仓库能清理，别人的 clone、下载附件、缓存和既有传播无法由一次 force-push保证抹除。GitHub 官方还说明，重写后旧 SHA 缓存、PR 引用和 fork 可能保留内容，且不会协助移除一般非敏感数据。见 [GitHub 历史清理说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)。

未全面检查：工作区外副本、浏览器存储、Para 后台、1Panel 实际站点目录、域名解析/证书记录、服务器私有备份、已删除或不可访问的外部资料。上述清理前盘点不是完成证明；远端重写结果已有上述独立验证，本地最终收尾仍待主 agent 核对。
