# 手艺专题 · 设计说明

> 范围：工序编辑与阅读；Web 管理材料、注释与媒体；后端 API 校验依赖图并持久保存步骤版本；
> 访客在手机上确认阅读进度。**内容仅为经审核的工艺介绍与原有风险提示，阅读确认不代表获得实际操作资格。**

## 1. 角色与端

| 角色 | 入口 | 能力 |
|---|---|---|
| 访客（手机浏览器） | `/`（reader.html） | 浏览已发布教程、阅读完整文字、确认/回滚进度、离线暂存确认、冻结版迁移 |
| 编辑/审核（Web 管理） | `/admin`（admin.html，需 `X-Admin-Key`） | 编辑工序草稿、拖动排序、管理材料/媒体/字幕/注释、审核介绍与风险提示、校验并发布、回滚草稿分叉 |
| 后端 | `backend/server.js` | 唯一裁决者：依赖图、材料、互斥、汇合、版本、进度迁移、授权撤销；JSON 持久化 |

前端的任何判断都只是提示，**所有规则在服务端再执行一次**（含离线迟到的确认）。

## 2. 核心数据模型（`backend/seed.js`）

- **Tutorial**：`publishMode = stepwise | frozen`；`intro` + `riskNotice` 各有独立审核位（`introApproved/riskApproved`）。
- **Release**：一次发布的不可变快照，包含 `steps: [{stepId, version}]`。逐步骤模式每次发布也产生快照用于审计，但学习者默认对齐**当前**快照；冻结模式学习者在「开始学习」时绑定快照。
- **Step**：`order`（仅展示顺序）、`retired`（被合并后退役）、`versions[]`（已发布版本，含完整文字、依赖、材料、媒体钉用、`changeType`/`derivedFrom`）、`draft`（编辑分叉，未发布）。
- **依赖**（只在草稿中显式编辑，拖动排序永远不改动它）：
  - `prerequisites: [{stepId, mode: required|optional}]` —— 必需前置 / 可选分支；
  - `branchGroup` + `branches[]` —— 同组互斥，要求双向声明；
  - `join: {type: none|any|all, sources[]}` —— 汇合条件，sources 必须同时声明为前置。
- **Material / Media / Annotation**：材料有审核位与软删除；媒体有 `available`、`licenseRevoked`、多版本字幕及撤版位；注释默认待审，审核后才公开。
- **Learner.progress**：每教程一条 `{mode, frozen:{releaseId}, confirmations:{stepId:{stepVersion, releaseId}}}`。

## 3. 服务端依赖图校验（`backend/graph.js: validateGraph`）

发布与保存草稿时执行；发布必须整体通过，否则返回 `409 GRAPH_INVALID` 与问题清单：

1. **循环**：以前置边（含可选）+ 汇合来源边做 DFS 三色检测，环 → `CYCLE`。
2. **悬空依赖**：前置/分支/汇合来源不存在、已退役、汇合来源未同时声明为前置 → `DANGLING_*` / `JOIN_UNDECLARED_EDGE`。
3. **分支互斥**：双方须同 `branchGroup` 且双向声明 → `BRANCH_GROUP_MISMATCH` / `BRANCH_NOT_MUTUAL`。
4. **缺材料**：材料被删除或未审核 → `MATERIAL_DELETED` / `MATERIAL_UNAPPROVED`（发布阻断）；确认时再查一次运行态 → `MATERIAL_MISSING`。
5. **媒体合规**：
   - 授权撤销 → `MEDIA_LICENSE_REVOKED`（禁止进入任何版本；历史链接也返回 410）；
   - 视频不可用且无 `altText` → `MEDIA_UNAVAILABLE_NO_ALT`；
   - 钉用字幕被撤版且无替代 → `CAPTION_WITHDRAWN_NO_ALT`；
   - 即「发布须包含可用媒体或明确替代方案」，且**每个步骤必须有完整文字** `FULLTEXT_REQUIRED`。
6. **内容闸门**：介绍与风险提示都必须存在且审核通过，否则 `CONTENT_REQUIRED`/`NOT_APPROVED`。

## 4. 两种升级模型与「学到一半」的迁移

### 4.1 逐步骤升级（stepwise）
- 发布 = 把各步骤草稿固化为各自新版本（`v+1`），产生新当前快照。
- 学习者**未确认**的步骤：下一次读取即看到新版本；
- 学习者**已确认**的旧步骤：记录保留为旧版本号；继续向下学习时以「同一步骤线」判定前置（按 `stepId`）。
  若该步骤后来是**合并/拆分产物**，新步骤按新 `stepId` 存在，旧勾选不会自动满足它（见 4.3）。
- 离线迟到确认携带旧 `stepVersion`：与当前发布版本不符 → `409 STALE_VERSION`，不写入，要求重读新版；重复提交幂等。

### 4.2 整个教程冻结（frozen）
- 「开始学习」即绑定当时的 `releaseId`；之后发布新版本不影响进行中的学习者。
- 旧快照 URL 仍可打开（`/api/tutorials/:id/releases/:relId`），**但若快照中任何媒体授权后来被撤销 → 410，历史链接同样不能绕过**。
- 学习者显式「迁移到新版本」：服务端按 `migrationPreview` 重算每一步勾选，旧绑定与无法沿用的勾选被清除。

### 4.3 勾选沿用规则（关键约束）
`migrationPreview` 对新版本每一步给出：
- 普通修订（`edit`/未标注）且同一步骤线 → **可沿用**；
- `changeType=split`（拆分）→ 要求细化，重新确认；
- `changeType=merge` 或 `derivedFrom.length>1`（合并）→ **绝不凭旧勾选自动认定**，即使它是新 stepId；
- 全新步骤 → 确认；旧版本被移除/并入 → 标注「已并入其它步骤」。

合并来源步骤可由编辑者声明 `retireSources` 在发布时退役。

## 5. 进度确认的运行时检查（`checkConfirm`）

按顺序：版本是否为当前期望（离线迟到在此被拦）→ 必需前置全部已确认 → 汇合条件（`all` 全满足 / `any` 至少一个）→ 同互斥组未确认过其它分支（`BRANCH_CONFLICT`，改道需先回滚）→ 所需材料当前仍存在且已审核。
回滚（`/rollback`）在存在后续已确认步骤时返回 `HAS_DEPENDENTS`，需自后向前撤销。

## 6. 并发与持久化

- 所有写操作经 `store.tx()` 串行排队，读已提交；落盘为「临时文件 + rename」原子替换。
- 「并发删除被引用材料」：引用扫描与软删除在同一事务内完成，命中引用即 `409 MATERIAL_IN_USE`（返回引用清单）。
- 「视频不可用 / 字幕换版 / 授权撤销」：发布期校验 + 阅读期状态机（`usable/unavailable/caption_withdrawn/revoked/missing`），播放器端点对撤销返回 410、不可用返回 503，前端一律展示完整文字与文字替代。

## 7. 可访问性与合规

- 语义化结构、跳转链接（skip link）、`:focus-visible` 焦点样式、所有操作用原生可聚焦控件，支持纯键盘完成。
- 完整文字是数据模型的必填项而非媒体的附属；无视频、视频故障时阅读不中断。
- 仅展示 `introApproved/riskApproved` 的介绍与原有风险提示；注释仅审核后公开；每次确认响应与界面均声明「不代表获得实际操作资格」。

## 8. API 摘要

公共：`GET /api/tutorials`、`GET /api/tutorials/:id`、`GET /api/tutorials/:id/releases/:rid`（frozen）、
`POST /api/learners`、`.../start`、`.../confirm`、`.../rollback`、`.../migrate`、`GET .../migration-preview`、`GET /api/media/:id`。
管理（`X-Admin-Key`）：教程/介绍/审核/步骤草稿/排序/媒体钉用/发布/回滚分叉、材料增删审、媒体状态与字幕版本、注释审核。详见 `server.js` 路由。
