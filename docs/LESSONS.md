# 教训台账（LESSONS）

> 只记「已经用实测证伪过的错误判断」，一条一行，写清**错在哪、证据是什么、正确做法**。
> 新增条目前先确认有可复现证据，不接受「我觉得」。

## L1 · 不要图快绕过应用自己的提示词装配（2026-10-30）

**错误**：写 caption 批处理时，为了省事直接 POST 桥接端点，只发「图片 + 指导词」，绕过了 `backend/presets.py` 的 `build_task()`。它本来会把 `WD14 evidence (image-level candidates with scores)` 和 `Character reference evidence` 注入提示。

**后果（实测）**：
- 300 张训练集里 **47 张**带 WD14 角色标签，**0 张** caption 出现角色名。
- 同一张图（`000004`）v1 把关键行为写成模糊话：`her hand guiding a white phallic object toward her parted thighs ... a thick muscled limb in the foreground`；带 WD14 证据的 v2 才写出 `performing fellatio while gripping his erect penis`。

**正确做法**：任何批处理都必须走应用自己的任务构造路径（`build_task` / `compile_output`），不要自己拼提示词。绕过它等于把「证据注入」和「格式契约」一起丢掉。

## L2 · 版权角色 LoRA 必须在 caption 里给锚点（2026-10-30）

**错误判断**：「模型不认识这些角色，所以要教它」+「写不写角色名是策略选择，参考集也没写」。

**为什么错**：
- MOSS-Image 基座**本身就认识**这些版权角色，也有对应 danbooru 标签（WD14 能检出 12 个角色，说明标签空间一致）。
- 训练时梯度只能经 caption 里**实际存在**的 token 回流到 LoRA。不在文字里的 token 拿不到梯度。
- caption 没有 `chloe_von_einzbern`，那 47 张的角色外观差异（脸型、上色、发丝）就只能挂到 `1girl`、`a girl`、`white_hair`、`school_uniform` 这些**通用词**上 → 双向污染：写 `a girl` 出她的脸；写 `chloe_von_einzbern` 反而没变化。

**参考集不写角色名不能类比**：`kase_daiki` 是**原创角色**，没有既有概念需要锚定。版权角色集必须写。

**正确做法**：
1. 用基座认识的 token 形式——**下划线 tag**（`chloe_von_einzbern`），不是 `Chloe von Einzbern`；后者会被切成不同 token，锚点失效。
2. 不靠模型自觉：探针 6/6 显示即使喂了 WD14 证据模型也不写名字（`named=[]`），必须**确定性注入**。
3. `character_threshold` 默认 0.85 会漏掉大量角色，需按实测下调（见 sweep 结果）。

## L3 · 不要用「参考集怎样」推断「这批数据该怎样」（2026-10-30）

**错误**：拿 `kase_daiki`（193 条原创角色 caption）的统计特征当标准答案，反推版权角色集也该不写名字。

**正确做法**：先确认两批数据的**性质差异**（原创 vs 版权、画风 vs 角色、单角色 vs 多角色），再决定是否可类比。参考集只能约束**句法形态**（长度、句数、是否单段），不能约束**内容要素**（要不要写名字、要不要写露骨解剖）。
