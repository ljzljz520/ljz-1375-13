// 服务端依赖图校验：循环、缺材料、分支互斥、汇合条件、媒体/字幕可用性
// 所有规则只在服务端判定；前端展示仅为提示。
'use strict';

const err = (code, stepId, message) => ({ code, stepId, message });

function latestVersion(tutorial, stepId) {
  const s = tutorial.steps.find(x => x.id === stepId);
  if (!s) return null;
  return s.versions.reduce((a, b) => (b.version > a.version ? b : a), s.versions[0]);
}

// 发布快照视图（冻结链接永远指向某一 release）
function viewsFromRelease(tutorial, release) {
  const views = [];
  for (const pin of release.steps) {
    const s = tutorial.steps.find(x => x.id === pin.stepId);
    const v = s && s.versions.find(x => x.version === pin.version);
    if (!s || !v) continue;
    views.push({ id: s.id, order: s.order, retired: s.retired, ...v });
  }
  return views;
}

// 编辑态视图：有草稿用草稿，否则用最新已发布版本
function viewsFromDraft(tutorial) {
  const views = [];
  for (const s of tutorial.steps) {
    const v = s.draft || latestVersion(tutorial, s.id);
    if (v) views.push({ id: s.id, order: s.order, retired: s.retired, ...v });
  }
  return views;
}

function validateGraph(db, rawViews) {
  const issues = [];
  // 已退役步骤不参与图结构，但任何指向它们的依赖仍会被判为悬空
  const views = rawViews.filter(v => !v.retired);
  const byId = new Map(views.map(v => [v.id, v]));

  for (const v of views) {
    if (!v.content || !v.content.trim()) {
      issues.push(err('FULLTEXT_REQUIRED', v.id, `步骤「${v.title}」缺少完整文字（无媒体时也必须可读）`));
    }

    // —— 必需前置 / 可选分支：目标必须存在且未退役 ——
    for (const p of v.prerequisites || []) {
      const t = byId.get(p.stepId);
      if (!t) issues.push(err('DANGLING_DEP', v.id, `前置步骤 ${p.stepId} 不存在`));
      else if (t.retired) issues.push(err('DANGLING_DEP', v.id, `前置步骤 ${t.title} 已退役`));
    }

    // —— 汇合条件 ——
    const join = v.join || { type: 'none', sources: [] };
    if (join.type !== 'none') {
      if (!Array.isArray(join.sources) || join.sources.length === 0) {
        issues.push(err('JOIN_NO_SOURCE', v.id, `汇合步骤「${v.title}」未声明汇合来源`));
      }
      for (const src of join.sources || []) {
        if (!byId.get(src)) issues.push(err('DANGLING_JOIN', v.id, `汇合来源 ${src} 不存在`));
        else {
          const declared = (v.prerequisites || []).some(p => p.stepId === src);
          if (!declared) issues.push(err('JOIN_UNDECLARED_EDGE', v.id, `汇合来源 ${src} 必须同时声明为前置（可选）`));
        }
      }
    }

    // —— 分支互斥声明必须落在同一互斥组 ——
    for (const b of v.branches || []) {
      const t = byId.get(b.stepId);
      if (!t) { issues.push(err('DANGLING_BRANCH', v.id, `分支 ${b.stepId} 不存在`)); continue; }
      if (!v.branchGroup || t.branchGroup !== v.branchGroup) {
        issues.push(err('BRANCH_GROUP_MISMATCH', v.id, `「${v.title}」与「${t.title}」不在同一互斥分支组`));
      }
      const back = (t.branches || []).some(x => x.stepId === v.id);
      if (!back) issues.push(err('BRANCH_NOT_MUTUAL', v.id, `分支互斥需双向声明：${v.id} <-> ${t.id}`));
    }

    // —— 材料：发布时必须存在、已审核、未删除 ——
    for (const mid of v.requiredMaterials || []) {
      const m = db.materials.find(x => x.id === mid);
      if (!m || m.deletedAt) issues.push(err('MATERIAL_DELETED', v.id, `材料 ${mid} 已删除，无法发布`));
      else if (!m.approved) issues.push(err('MATERIAL_UNAPPROVED', v.id, `材料「${m.name}」尚未通过审核`));
    }

    // —— 媒体：可用媒体（授权有效）或明确文字替代，二者必居其一 ——
    for (const ref of v.media || []) {
      const md = db.media.find(x => x.id === ref.mediaId);
      if (!md) {
        if (!ref.altText) issues.push(err('MEDIA_MISSING_NO_ALT', v.id, `媒体 ${ref.mediaId} 不存在且无文字替代`));
        continue;
      }
      if (md.licenseRevoked) {
        issues.push(err('MEDIA_LICENSE_REVOKED', v.id, `媒体「${md.title}」授权已撤销，不得继续发布（历史链接同样禁止）`));
        continue;
      }
      const usable = md.available;
      const cap = (md.captions || []).find(c => c.version === ref.captionVersion);
      const captionOk = cap && !cap.withdrawn;
      if (!usable || !captionOk) {
        if (!ref.altText || !ref.altText.trim()) {
          issues.push(err(
            !usable ? 'MEDIA_UNAVAILABLE_NO_ALT' : 'CAPTION_WITHDRAWN_NO_ALT',
            v.id,
            !usable ? `媒体「${md.title}」当前不可用，必须提供文字替代`
                    : `字幕 v${ref.captionVersion} 已撤版，必须钉用有效字幕或提供文字替代`
          ));
        }
      }
    }
  }

  // —— 循环检测：以前置（含可选）+ 汇合来源为依赖边 ——
  const groups = new Map();
  for (const v of views) {
    if (!v.branchGroup) continue;
    if (!groups.has(v.branchGroup)) groups.set(v.branchGroup, []);
    groups.get(v.branchGroup).push(v.id);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(views.map(v => [v.id, WHITE]));
  const cycleEdge = [];
  function dfs(id, stack) {
    color.set(id, GRAY);
    const v = byId.get(id);
    const deps = new Set((v.prerequisites || []).map(p => p.stepId));
    (v.join?.sources || []).forEach(s => deps.add(s));
    for (const d of deps) {
      if (!byId.has(d)) continue;
      if (color.get(d) === GRAY) { cycleEdge.push([...stack, id, d]); continue; }
      if (color.get(d) === WHITE) dfs(d, [...stack, id]);
    }
    color.set(id, BLACK);
  }
  for (const v of views) if (color.get(v.id) === WHITE) dfs(v.id, []);
  for (const c of cycleEdge) issues.push(err('CYCLE', c[c.length - 1], `依赖存在循环：${c.join(' -> ')}`));

  return { ok: issues.length === 0, issues };
}

// 分组互斥成员
function groupMembers(views, group) {
  return views.filter(v => v.branchGroup === group).map(v => v.id);
}

// 学习者当前应对齐的版本：冻结=绑定快照；逐步骤=当前发布中的最新版本
function expectedPin(tutorial, learnerTut) {
  const release = tutorial.releases.find(r =>
    r.id === (learnerTut?.frozen?.releaseId || tutorial.currentReleaseId));
  const map = {};
  for (const pin of release.steps) map[pin.stepId] = pin.version;
  return { release, map };
}

// 勾选确认前的服务端检查（循环/材料/互斥在发布校验外，确认时再做一次运行时检查）
function checkConfirm(db, tutorial, learnerTut, stepId, clientVersion) {
  const { release, map } = expectedPin(tutorial, learnerTut);
  const views = viewsFromRelease(tutorial, release);
  const v = views.find(x => x.id === stepId);
  if (!v) return { ok: false, status: 404, code: 'STEP_NOT_IN_RELEASE', message: '该步骤不在你所学习的版本中' };

  // 离线迟到的进度：版本必须与当前期望一致
  if (clientVersion != null && clientVersion !== map[stepId]) {
    return { ok: false, status: 409, code: 'STALE_VERSION',
      message: `客户端基于 v${clientVersion}，当前应为 v${map[stepId]}，请阅读新版后重新确认（幂等重试安全）`,
      expectedVersion: map[stepId] };
  }

  const conf = learnerTut?.confirmations || {};

  // 必需前置：同一步骤线（stepId 相同且未被合并/拆分替代）的旧勾选才算数
  for (const p of v.prerequisites || []) {
    if (p.mode !== 'required') continue;
    if (!conf[p.stepId]) {
      const t = views.find(x => x.id === p.stepId);
      return { ok: false, status: 409, code: 'PREREQUISITE_REQUIRED',
        message: `请先完成必需前置「${t ? t.title : p.stepId}」` };
    }
  }

  // 汇合条件
  const join = v.join || { type: 'none', sources: [] };
  if (join.type === 'all') {
    const missing = join.sources.filter(s => !conf[s]);
    if (missing.length) return { ok: false, status: 409, code: 'JOIN_NOT_SATISFIED',
      message: `汇合要求全部来源完成，缺：${missing.join('、')}` };
  } else if (join.type === 'any') {
    if (!join.sources.some(s => conf[s])) {
      return { ok: false, status: 409, code: 'JOIN_NOT_SATISFIED',
        message: '汇合要求至少完成一个分支来源' };
    }
  }

  // 分支互斥：同组其它步骤已确认则拒绝
  if (v.branchGroup) {
    const conflict = groupMembers(views, v.branchGroup)
      .filter(id => id !== stepId && conf[id]);
    if (conflict.length) {
      return { ok: false, status: 409, code: 'BRANCH_CONFLICT',
        message: `互斥分支：你已确认 ${conflict.join('、')}，不能再确认本分支。如需改道请先申请回滚该勾选。`,
        conflictWith: conflict };
    }
  }

  // 缺材料（材料可能在发布后被并发删除/取消审核）
  for (const mid of v.requiredMaterials || []) {
    const m = db.materials.find(x => x.id === mid);
    if (!m || m.deletedAt || !m.approved) {
      return { ok: false, status: 409, code: 'MATERIAL_MISSING',
        message: `所需材料不可用（${mid}），暂不能确认该步骤` };
    }
  }

  return { ok: true, release, version: map[stepId], view: v };
}

// 冻结教程迁移到新整体版本时的勾选携带判定
// 只有未经合并/拆分的修订(changeType 'edit' 或未标注)可携带；合并步骤一律重新确认
function migrationPreview(tutorial, oldRelease, newRelease) {
  const rows = [];
  for (const pin of newRelease.steps) {
    const s = tutorial.steps.find(x => x.id === pin.stepId);
    const v = s.versions.find(x => x.version === pin.version);
    const oldPin = oldRelease.steps.find(o => o.stepId === pin.stepId);
    let carry = false, reason = '';
    if (v.changeType === 'merge' || (v.derivedFrom || []).length > 1) {
      reason = '合并步骤：旧勾选不能自动认定新要求已完成，需重新确认（即使该步骤为新增）';
    } else if (v.changeType === 'split') {
      reason = '拆分新步骤：要求已细化，需重新确认';
    } else if (!oldPin) { reason = '新步骤，需阅读确认'; }
    else carry = true;
    rows.push({ stepId: pin.stepId, version: pin.version, title: v.title, carry, reason });
  }
  // 旧版本中被退役/移除的步骤
  const removed = oldRelease.steps
    .filter(o => !newRelease.steps.some(n => n.stepId === o.stepId))
    .map(o => ({ stepId: o.stepId, version: o.version, reason: '新版本已移除/并入其它步骤' }));
  return { rows, removed };
}

module.exports = {
  latestVersion, viewsFromRelease, viewsFromDraft, validateGraph,
  checkConfirm, expectedPin, migrationPreview, groupMembers
};
