'use strict';

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = process.env.STORE_FILE ? path.resolve(process.env.STORE_FILE) : path.join(DATA_DIR, 'store.json');
const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = process.env.ADMIN_KEY || 'dev-admin-key';

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
const clone = (value) => JSON.parse(JSON.stringify(value));

function ensureSeedStore() {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  if (fs.existsSync(STORE_FILE)) return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  const store = seedStore();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
  return store;
}

let store = ensureSeedStore();
let saveChain = Promise.resolve();

function persist() {
  const snapshot = JSON.stringify(store, null, 2);
  saveChain = saveChain.then(() => fs.promises.writeFile(`${STORE_FILE}.tmp`, snapshot).then(() => fs.promises.rename(`${STORE_FILE}.tmp`, STORE_FILE)));
  return saveChain;
}

function seedStore() {
  const time = now();
  const materials = {
    mat_oxhide: { id: 'mat_oxhide', name: '硝制牛皮', description: '厚度均匀、已完成硝制与整平的透明牛皮。', status: 'active', createdAt: time, updatedAt: time },
    mat_knife: { id: 'mat_knife', name: '皮影刻刀', description: '刃口锋利的窄刃刻刀，需配防割垫使用。', status: 'active', createdAt: time, updatedAt: time },
    mat_pigment: { id: 'mat_pigment', name: '矿物颜料', description: '传统红、黑、黄矿物颜料，使用前确认过敏风险。', status: 'active', createdAt: time, updatedAt: time }
  };

  const media = {
    med_pattern: {
      id: 'med_pattern', type: 'image', title: '牛皮起稿示意图', url: '/images/xian_shadow_puppetry_1770220301195.png',
      altText: '牛皮影人纹样与刻线示意', textAlternative: '查看下方完整文字：先固定皮面，再描出头部与冠饰轮廓，所有刻线必须留出连接点。',
      captions: {}, available: true, licenseActive: true, reviewStatus: 'approved', createdAt: time, updatedAt: time
    },
    med_carving: {
      id: 'med_carving', type: 'audio', title: '安全走刀口播提示', url: '/media/carving-cue.wav',
      poster: '',
      altText: '匠人沿纹样垂直走刀的音频提示', textAlternative: '完整文字替代：刀具始终远离扶皮手指，先刻细纹后刻外轮廓；每刀保持同一深度，不追求一次刻透。',
      captions: { zh: { lang: 'zh', label: '中文', version: 1, text: '欢迎观看皮影走刀演示。请先固定皮面，刀刃远离手指，沿线条分段下刀。' } },
      available: true, licenseActive: true, reviewStatus: 'approved', createdAt: time, updatedAt: time
    },
    med_color: {
      id: 'med_color', type: 'image', title: '设色参考图', url: '/images/xian_shehuo_performance_1770220667476.png',
      altText: '传统皮影矿物颜料设色参考', textAlternative: '完整文字替代：由浅入深平涂，避开活动关节铆点；待一色干透再上相邻色。',
      captions: {}, available: true, licenseActive: true, reviewStatus: 'approved', createdAt: time, updatedAt: time
    }
  };

  const riskNotice = { id: 'rn_shadow_v1', text: '本专题仅作工艺介绍与阅读学习。刻刀、颜料及装订工具存在割伤、刺伤和过敏风险；阅读确认不代表获得实际操作资格，新手须在合格现场指导者陪同下使用工具。', reviewStatus: 'approved', createdAt: time, updatedAt: time };
  const craft = {
    id: 'craft_shadow', title: '关中皮影雕刻', summary: '经审核的皮影起稿、走刀与设色工艺介绍。',
    content: '皮影以硝制牛皮为胎，经起稿、雕刻、设色、装订而成。本页仅讲解经审核的工艺流程和原有风险提示，不构成上岗或实操授权。',
    reviewStatus: 'approved', reviewNote: '已由工艺与安全审核人通过。', riskNoticeIds: ['rn_shadow_v1'], createdAt: time, updatedAt: time
  };
  const riskNotices = { rn_shadow_v1: riskNotice };

  const steps = [
    {
      key: 'pattern', title: '固定皮面与起稿', text: '将硝制牛皮平整固定在图样上，先用淡线描出头、身与冠饰比例。刻线之间保留连接点，避免纹样在雕刻前散开。',
      instructions: '检查皮面无翘边；沿透光图样描线；需要断开的位置只做轻记号。',
      optional: false, branchGroup: null, prerequisites: [], merge: null,
      materials: [{ materialId: 'mat_oxhide', required: true }],
      mediaRequirement: { mediaId: 'med_pattern', captionLang: null, captionVersion: null }, alternativeText: '',
      reviewStatus: 'approved'
    },
    {
      key: 'carve_fine', title: '细纹雕刻', text: '先刻面部、衣纹等细线，再处理外轮廓。走刀时分段施力，不把刀尖指向扶皮的手。',
      instructions: '确认防割垫位置；每刻数刀即检查皮面是否移位；细纹保留连接点。',
      optional: false, branchGroup: null, prerequisites: [{ stepKey: 'pattern' }], merge: null,
      materials: [{ materialId: 'mat_oxhide', required: true }, { materialId: 'mat_knife', required: true }],
      mediaRequirement: { mediaId: 'med_carving', captionLang: 'zh', captionVersion: 1 }, alternativeText: '',
      reviewStatus: 'approved'
    },
    {
      key: 'color', title: '矿物颜料设色', text: '按由浅入深的顺序平涂矿物颜料，避开活动关节和后续铆点。相邻颜色须等前一色干透，防止混色洇开。',
      instructions: '先做颜料过敏提示；小面积试色；干透后再涂第二色。',
      optional: false, branchGroup: null, prerequisites: [{ stepKey: 'carve_fine' }], merge: null,
      materials: [{ materialId: 'mat_pigment', required: true }],
      mediaRequirement: { mediaId: 'med_color' }, alternativeText: '',
      reviewStatus: 'approved'
    },
    {
      key: 'inspect', title: '检查与阅读确认', text: '对照图样检查连接点、刻线边缘和设色边界。此处仅确认已阅读教程，不颁发制作资格。',
      instructions: '逐项核对；保留风险提示；确认自己理解但仍需现场指导。',
      optional: false, branchGroup: null, prerequisites: [{ stepKey: 'color' }], merge: null,
      materials: [], mediaRequirement: null,
      alternativeText: '本步骤为纯文字检查清单：连接点完整、刀线无毛边、颜色干透、风险提示已阅读。',
      reviewStatus: 'approved'
    }
  ];

  const annotations = {
    ann_pattern: { id: 'ann_pattern', targetType: 'step', targetKey: 'pattern', body: '审核备注：传统起稿强调“留筋”，不可把外轮廓先行刻断。', reviewStatus: 'approved', createdAt: time, updatedAt: time },
    ann_risk: { id: 'ann_risk', targetType: 'craft', targetKey: 'craft_shadow', body: '审核备注：页面不得将阅读记录表述为操作资质。', reviewStatus: 'approved', createdAt: time, updatedAt: time }
  };

  const version = publishSnapshot({
    craft, riskNotices, steps, materials, media, annotations,
    versionId: 'craft_shadow-v1', version: '1.0.0', mode: 'frozen', parentVersionId: null,
    revisionBase: {}, publishedAt: time
  });

  return {
    materials, media, crafts: { [craft.id]: craft }, riskNotices, annotations,
    drafts: {}, tutorialVersions: { [version.versionId]: version }, progress: {}, createdAt: time, updatedAt: time
  };
}

function hashJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function stepVariant(step) {
  return {
    key: step.key, title: step.title, text: step.text, instructions: step.instructions || '',
    optional: !!step.optional, branchGroup: step.branchGroup || null,
    prerequisites: step.prerequisites || [], merge: step.merge || null,
    materials: step.materials || [], mediaRequirement: step.mediaRequirement || null,
    alternativeText: step.alternativeText || ''
  };
}

function publishSnapshot({ craft, riskNotices, steps, materials, media, annotations, versionId, version, mode, parentVersionId, revisionBase, publishedAt }) {
  const approvedAnnotations = Object.values(annotations).filter((a) => a.reviewStatus === 'approved');
  const riskNotice = riskNotices[craft.riskNoticeIds?.[0]];
  const snapSteps = steps.map((step, index) => {
    const variant = stepVariant(step);
    const revision = revisionBase[step.key] || 1;
    const stepVersionId = `${step.key}-r${revision}`;
    const mediaReq = step.mediaRequirement;
    let mediaSnapshot = null;
    if (mediaReq?.mediaId) {
      const m = media[mediaReq.mediaId];
      const cap = mediaReq.captionLang ? m.captions?.[mediaReq.captionLang] : null;
      mediaSnapshot = {
        mediaId: m.id, type: m.type, title: m.title, url: m.url, poster: m.poster || '',
        altText: m.altText, textAlternative: m.textAlternative,
        caption: cap && mediaReq.captionVersion === cap.version ? { lang: cap.lang, label: cap.label, version: cap.version, text: cap.text } : null,
        licenseActiveAtPublish: m.licenseActive, availableAtPublish: m.available
      };
    }
    const stepAnnotations = approvedAnnotations.filter((a) => a.targetType === 'step' && a.targetKey === step.key);
    const annotationBodies = stepAnnotations.map((a) => `${a.id}:${a.body}`);
    return {
      ...variant,
      order: index,
      revision,
      stepVersionId,
      variantHash: hashJson({ ...variant, annotationBodies }),
      mediaSnapshot,
      annotations: stepAnnotations.map((a) => ({ id: a.id, body: a.body }))
    };
  });

  return {
    versionId, craftId: craft.id, version, mode, parentVersionId, publishedAt,
    title: craft.title, summary: craft.summary, content: craft.content,
    reviewStatus: craft.reviewStatus, reviewNote: craft.reviewNote || '',
    riskNotice: riskNotice ? { id: riskNotice.id, text: riskNotice.text } : null,
    annotations: approvedAnnotations.filter((a) => a.targetType === 'craft' && a.targetKey === craft.id).map((a) => ({ id: a.id, body: a.body })),
    steps: snapSteps,
    materialIndex: Object.fromEntries(snapSteps.flatMap((s) => s.materials.map((m) => [m.materialId, materials[m.materialId]?.name || m.materialId])))
  };
}

function latestVersion(craftId) {
  return Object.values(store.tutorialVersions).filter((v) => v.craftId === craftId).sort(compareVersions).at(-1);
}

function parseSemver(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text || '');
  return match ? match.slice(1).map(Number) : null;
}
function compareVersions(a, b) {
  const aa = parseSemver(a.version) || [0, 0, 0];
  const bb = parseSemver(b.version) || [0, 0, 0];
  for (let i = 0; i < 3; i += 1) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return a.publishedAt.localeCompare(b.publishedAt);
}

function normalizeDraftStep(input) {
  return {
    key: String(input.key || '').trim(),
    title: String(input.title || '').trim(),
    text: String(input.text || '').trim(),
    instructions: String(input.instructions || '').trim(),
    optional: !!input.optional,
    branchGroup: input.branchGroup ? String(input.branchGroup).trim() : null,
    prerequisites: Array.isArray(input.prerequisites) ? input.prerequisites.map((p) => ({ stepKey: String(p.stepKey || '').trim() })) : [],
    merge: input.merge ? {
      branchGroup: String(input.merge.branchGroup || '').trim(),
      operator: input.merge.operator === 'and' ? 'and' : 'or',
      branches: Array.isArray(input.merge.branches) ? input.merge.branches.map(String) : [],
      policyText: String(input.merge.policyText || '').trim()
    } : null,
    materials: Array.isArray(input.materials) ? input.materials.map((m) => ({ materialId: String(m.materialId || '').trim(), required: m.required !== false })) : [],
    mediaRequirement: input.mediaRequirement?.mediaId ? {
      mediaId: String(input.mediaRequirement.mediaId).trim(),
      captionLang: input.mediaRequirement.captionLang ? String(input.mediaRequirement.captionLang) : null,
      captionVersion: Number(input.mediaRequirement.captionVersion) || null
    } : null,
    alternativeText: String(input.alternativeText || '').trim(),
    reviewStatus: input.reviewStatus === 'approved' ? 'approved' : 'draft'
  };
}

function validateGraph(steps) {
  const errors = [];
  const nodes = new Map();
  if (!Array.isArray(steps) || steps.length === 0) errors.push('工序至少包含一个步骤。');
  for (const [index, step] of steps.entries()) {
    const where = `第 ${index + 1} 步`;
    if (!step.key) errors.push(`${where}缺少稳定步骤标识。`);
    if (nodes.has(step.key)) errors.push(`步骤标识重复：${step.key}。`);
    if (!step.title) errors.push(`${where}（${step.key || '无标识'}）缺少标题。`);
    if (step.text.length < 20) errors.push(`${where}（${step.key}）必须提供完整文字，且不少于 20 个字符。`);
    if (step.reviewStatus !== 'approved') errors.push(`${where}（${step.key}）尚未通过内容审核。`);
    if (step.optional && !step.branchGroup) errors.push(`可选步骤 ${step.key} 必须属于一个分支组。`);
    if (!step.optional && step.branchGroup) errors.push(`分支步骤 ${step.key} 必须标记为可选。`);
    if (step.mediaRequirement && step.alternativeText) errors.push(`${step.key} 不能同时把媒体设为必需又提供替代方案。`);
    if (!step.mediaRequirement && !step.alternativeText) errors.push(`${step.key} 必须提供可用媒体或明确文字替代方案。`);
    nodes.set(step.key, step);
  }
  if (errors.length) return errors;

  const groups = new Map();
  for (const step of nodes.values()) {
    if (step.branchGroup) {
      if (!groups.has(step.branchGroup)) groups.set(step.branchGroup, []);
      groups.get(step.branchGroup).push(step);
    }
  }

  const adjacency = new Map([...nodes.keys()].map((k) => [k, []]));
  for (const step of nodes.values()) {
    const prereqKeys = new Set();
    for (const p of step.prerequisites) {
      if (!p.stepKey) errors.push(`步骤 ${step.key} 存在空前置。`);
      else if (!nodes.has(p.stepKey)) errors.push(`步骤 ${step.key} 引用了不存在的前置 ${p.stepKey}。`);
      else if (p.stepKey === step.key) errors.push(`步骤 ${step.key} 不能把自己设为前置。`);
      else {
        if (prereqKeys.has(p.stepKey)) errors.push(`步骤 ${step.key} 的前置 ${p.stepKey} 重复。`);
        prereqKeys.add(p.stepKey);
        adjacency.get(p.stepKey).push(step.key);
      }
    }

    for (const m of step.materials) {
      const material = store.materials[m.materialId];
      if (!material) errors.push(`步骤 ${step.key} 引用了不存在的材料 ${m.materialId}。`);
      else if (m.required && material.status !== 'active') errors.push(`步骤 ${step.key} 缺少可用材料：${material.name}。`);
    }

    if (step.mediaRequirement) {
      const media = store.media[step.mediaRequirement.mediaId];
      if (!media) errors.push(`步骤 ${step.key} 引用了不存在的媒体。`);
      else {
        if (media.reviewStatus !== 'approved') errors.push(`步骤 ${step.key} 引用的媒体尚未审核。`);
        if (!media.available) errors.push(`步骤 ${step.key} 引用的媒体当前不可用。`);
        if (!media.licenseActive) errors.push(`步骤 ${step.key} 引用的媒体授权已撤销，不能用于新发布。`);
        if (!media.altText?.trim()) errors.push(`步骤 ${step.key} 的图片媒体缺少替代文字。`);
        if (media.type === 'video' || media.type === 'audio') {
          const lang = step.mediaRequirement.captionLang;
          const ver = step.mediaRequirement.captionVersion;
          if (!lang || !ver) errors.push(`步骤 ${step.key} 的音视频必须锁定字幕/口播版本。`);
          else if (media.captions?.[lang]?.version !== ver) errors.push(`步骤 ${step.key} 锁定的字幕版本已换版，请重新审核并发布。`);
        }
      }
    }
  }

  for (const [group, members] of groups) {
    if (members.length < 2) errors.push(`分支组 ${group} 至少需要两个分支；or 组按互斥选择，and 组要求全部汇合。`);
    const memberKeys = new Set(members.map((s) => s.key));
    for (const member of members) {
      for (const prereq of member.prerequisites) {
        if (memberKeys.has(prereq.stepKey)) errors.push(`分支组 ${group} 内不能互相作为前置：${member.key} → ${prereq.stepKey}。`);
      }
    }
    const merges = [...nodes.values()].filter((s) => s.merge?.branchGroup === group);
    if (merges.length !== 1) errors.push(`分支组 ${group} 必须有且仅有一个汇合步骤。`);
    if (merges[0]) {
      const merge = merges[0];
      const branches = [...merge.merge.branches].sort();
      const expected = [...memberKeys].sort();
      if (branches.length < 2 || JSON.stringify(branches) !== JSON.stringify(expected)) errors.push(`汇合 ${merge.key} 必须列出分支组 ${group} 的全部分支。`);
      const prereqs = merge.prerequisites.map((p) => p.stepKey).sort();
      if (JSON.stringify(prereqs) !== JSON.stringify(expected)) errors.push(`汇合 ${merge.key} 的依赖必须恰好是 ${group} 的全部分支。`);
      if (!['and', 'or'].includes(merge.merge.operator)) errors.push(`汇合 ${merge.key} 条件只能是 and 或 or。`);
      if (merge.merge.operator === 'or' && !merge.merge.policyText.trim()) errors.push(`汇合 ${merge.key} 选择任一分支时必须写明汇合判定说明。`);
    }
  }

  for (const step of nodes.values()) {
    if (step.merge && !groups.has(step.merge.branchGroup)) errors.push(`汇合 ${step.key} 引用了不存在的分支组。`);
    if (!step.merge) {
      const seenGroups = new Set();
      for (const p of step.prerequisites) {
        const prereq = nodes.get(p.stepKey);
        if (prereq?.branchGroup) {
          if (seenGroups.has(prereq.branchGroup)) errors.push(`步骤 ${step.key} 不能绕过汇合同时依赖互斥分支。`);
          seenGroups.add(prereq.branchGroup);
        }
      }
    }
  }

  const color = new Map([...nodes.keys()].map((k) => [k, 0]));
  const visit = (key, stack = []) => {
    color.set(key, 1);
    for (const next of adjacency.get(key)) {
      if (color.get(next) === 1) errors.push(`依赖图存在循环：${[...stack, key, next].join(' → ')}。`);
      if (color.get(next) === 0) visit(next, [...stack, key]);
    }
    color.set(key, 2);
  };
  for (const key of nodes.keys()) if (color.get(key) === 0) visit(key);

  const incoming = new Map([...nodes.keys()].map((k) => [k, []]));
  for (const step of nodes.values()) for (const p of step.prerequisites) if (nodes.has(p.stepKey)) incoming.get(step.key).push(p.stepKey);
  const roots = [...incoming.entries()].filter(([, ins]) => ins.length === 0).map(([k]) => k);
  if (roots.length === 0) errors.push('依赖图没有可开始的步骤。');
  const reachable = new Set();
  const walk = (key) => { if (reachable.has(key)) return; reachable.add(key); for (const next of adjacency.get(key)) walk(next); };
  roots.forEach(walk);
  for (const key of nodes.keys()) if (!reachable.has(key)) errors.push(`步骤 ${key} 与起始步骤不连通，拖动排序不能修复缺失依赖。`);

  return [...new Set(errors)];
}

function publicVersion(version) {
  const copy = clone(version);
  for (const step of copy.steps) {
    const media = step.mediaSnapshot ? store.media[step.mediaSnapshot.mediaId] : null;
    if (!media || !media.available || !media.licenseActive) {
      if (step.mediaSnapshot) {
        step.mediaSnapshot.playable = false;
        step.mediaSnapshot.unavailableReason = !media ? '媒体记录已删除。' : (!media.licenseActive ? '素材授权已撤销。' : '媒体暂不可用。');
        step.mediaSnapshot.url = '';
        step.mediaSnapshot.poster = '';
      }
    } else {
      step.mediaSnapshot.playable = true;
    }
  }
  return copy;
}

function getProgressTarget(progress) {
  return store.tutorialVersions[progress.versionId] || latestVersion(progress.craftId);
}

function stepCompletionState(version, progress) {
  const byKey = new Map(version.steps.map((s) => [s.key, s]));
  const completed = new Map();
  const confirmations = progress.confirmations || [];
  for (const confirmation of confirmations.filter((c) => c.versionId === version.versionId)) {
    completed.set(confirmation.stepKey, confirmation);
  }
  const selections = progress.branchSelections || {};
  const canComplete = (key, seen = new Set()) => {
    if (seen.has(key)) return false;
    seen.add(key);
    const step = byKey.get(key);
    if (!step || !completed.has(key)) return false;
    if (step.merge) {
      const branches = step.merge.branches;
      const ok = branches.filter((b) => completed.has(b) && canComplete(b, new Set(seen)));
      if (step.merge.operator === 'and' && ok.length !== branches.length) return false;
      if (step.merge.operator === 'or' && ok.length < 1) return false;
      return true;
    }
    return step.prerequisites.every((p) => canComplete(p.stepKey, new Set(seen)));
  };
  return { byKey, completed, selections, canComplete };
}

function availability(version, progress) {
  const state = stepCompletionState(version, progress);
  const steps = version.steps.map((step) => {
    let available = true;
    let reason = '';
    if (progress.riskAckVersionId !== version.versionId) {
      available = false;
      reason = '请先阅读并确认当前版本的原有风险提示。';
    } else if (step.merge) {
      const done = step.merge.branches.filter((b) => state.completed.has(b));
      if (step.merge.operator === 'and' && done.length !== step.merge.branches.length) { available = false; reason = '需要所有互斥分支汇合；学习者只需选择实际路径时由发布策略判定。'; }
      if (step.merge.operator === 'or' && done.length < 1) { available = false; reason = '请至少完成一个可选分支。'; }
    } else {
      for (const p of step.prerequisites) {
        if (!state.canComplete(p.stepKey)) { available = false; reason = `请先完成前置步骤：${state.byKey.get(p.stepKey)?.title || p.stepKey}`; break; }
      }
    }
    return { stepKey: step.key, title: step.title, completed: state.completed.has(step.key), available, reason, optional: step.optional, branchGroup: step.branchGroup };
  });
  return steps;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

async function readBody(req) {
  const limit = 2_000_000;
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw Object.assign(new Error('请求体过大'), { status: 413 });
  }
  if (!body.trim()) return {};
  try { return JSON.parse(body); } catch { throw Object.assign(new Error('JSON 格式无效'), { status: 400 }); }
}

function requireAdmin(req, res) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    sendJson(res, 401, { error: '需要管理员密钥（x-admin-key）。' });
    return false;
  }
  return true;
}

function sanitizeList(value) { return Object.values(clone(value)); }

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : {};

  if (route === 'GET /api/health') return sendJson(res, 200, { ok: true, time: now() });

  if (route === 'GET /api/crafts') {
    const crafts = Object.values(store.crafts).filter((c) => c.reviewStatus === 'approved').map((c) => {
      const v = latestVersion(c.id);
      return { id: c.id, title: c.title, summary: c.summary, latestVersionId: v.versionId, latestVersion: v.version, mode: v.mode, publishedAt: v.publishedAt };
    });
    return sendJson(res, 200, { crafts });
  }

  const craftMatch = /^\/api\/crafts\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'GET' && craftMatch) {
    const craft = store.crafts[craftMatch[1]];
    if (!craft || craft.reviewStatus !== 'approved') return sendJson(res, 404, { error: '未找到经审核的手艺专题。' });
    const versionId = url.searchParams.get('versionId');
    const version = versionId ? store.tutorialVersions[versionId] : latestVersion(craft.id);
    if (!version || version.craftId !== craft.id) return sendJson(res, 404, { error: '版本不存在。' });
    const versions = Object.values(store.tutorialVersions).filter((v) => v.craftId === craft.id && v.reviewStatus === 'approved').sort(compareVersions).map((v) => ({ versionId: v.versionId, version: v.version, mode: v.mode, publishedAt: v.publishedAt }));
    return sendJson(res, 200, { craft: { id: craft.id, title: craft.title }, version: publicVersion(version), versions });
  }

  if (route === 'POST /api/progress/start') {
    const craft = store.crafts[body.craftId];
    if (!craft || craft.reviewStatus !== 'approved') return sendJson(res, 404, { error: '手艺专题不存在。' });
    const requestedVersion = body.versionId ? store.tutorialVersions[body.versionId] : latestVersion(craft.id);
    if (!requestedVersion || requestedVersion.craftId !== craft.id || requestedVersion.reviewStatus !== 'approved') return sendJson(res, 404, { error: '请求的教程版本不存在或未审核。' });
    const version = requestedVersion;
    const record = {
      progressId: id('progress'), craftId: craft.id, versionId: version.versionId,
      startedAt: now(), updatedAt: now(), riskAckVersionId: null, confirmations: [], branchSelections: {}, migrationHistory: [], acknowledgedUpdates: []
    };
    store.progress[record.progressId] = record;
    await persist();
    return sendJson(res, 201, { progress: progressPayload(record) });
  }

  const progressMatch = /^\/api\/progress\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'GET' && progressMatch) {
    const record = store.progress[progressMatch[1]];
    if (!record) return sendJson(res, 404, { error: '阅读进度不存在，可能已更换浏览器或清除本地数据。' });
    return sendJson(res, 200, { progress: progressPayload(record) });
  }

  if (req.method === 'POST' && url.pathname === '/api/progress/migrate') {
    const record = store.progress[body.progressId];
    if (!record) return sendJson(res, 404, { error: '阅读进度不存在。' });
    const target = latestVersion(record.craftId);
    if (!target) return sendJson(res, 404, { error: '目标版本不存在。' });
    if (record.versionId === target.versionId) return sendJson(res, 200, { progress: progressPayload(record), migrated: false, reason: 'already-current' });
    const old = store.tutorialVersions[record.versionId];
    const oldCompleted = new Map((record.confirmations || []).filter((c) => c.versionId === old.versionId).map((c) => [c.stepKey, c]));
    let carried = [];
    let reset = [...oldCompleted.keys()];
    if (body.strategy !== 'upgrade') return sendJson(res, 400, { error: '请明确选择 continue 或 upgrade。' });

    record.migrationHistory.push({ fromVersionId: record.versionId, toVersionId: target.versionId, requestedAt: now(), mode: target.mode });
    if (target.mode === 'stepwise') {
      const newByKey = new Map(target.steps.map((s) => [s.key, s]));
      carried = target.steps.filter((s) => oldCompleted.get(s.key)?.variantHash === s.variantHash).map((s) => s.key);
      const valid = new Set(carried);
      const canCarry = (stepKey, checking = new Set()) => {
        if (!valid.has(stepKey)) return false;
        if (checking.has(stepKey)) return false;
        checking.add(stepKey);
        const targetStep = newByKey.get(stepKey);
        return targetStep.prerequisites.every((p) => {
          const prerequisite = newByKey.get(p.stepKey);
          if (!prerequisite) return false;
          if (prerequisite.merge) {
            const completedBranches = prerequisite.merge.branches.filter((branchKey) => oldCompleted.has(branchKey) && canCarry(branchKey, new Set(checking)));
            return prerequisite.merge.operator === 'and' ? completedBranches.length === prerequisite.merge.branches.length : completedBranches.length >= 1;
          }
          if (prerequisite.optional) return canCarry(p.stepKey, new Set(checking));
          return canCarry(p.stepKey, new Set(checking));
        });
      };
      for (const key of [...valid]) {
        if (!canCarry(key)) valid.delete(key);
      }
      carried = [...valid];
      const preservedKeys = new Set(target.steps.map((x) => x.key).filter((k) => old.steps.some((x) => x.key === k)));
      reset = [...old.steps.map((x) => x.key), ...oldCompleted.keys()].filter((k) => preservedKeys.has(k) && !valid.has(k));
      record.versionId = target.versionId;
      record.riskAckVersionId = old.riskNotice?.text && old.riskNotice.text === target.riskNotice?.text && record.riskAckVersionId === old.versionId ? target.versionId : null;
      record.branchSelections = Object.fromEntries(Object.entries(record.branchSelections || {}).filter(([, stepKey]) => valid.has(stepKey)));
      record.confirmations = target.steps.filter((s) => valid.has(s.key)).map((s) => ({
        stepKey: s.key, versionId: target.versionId, stepVersionId: s.stepVersionId, variantHash: s.variantHash,
        confirmedAt: oldCompleted.get(s.key).confirmedAt, migrated: true, offline: false
      }));
    } else {
      carried = [];
      record.versionId = target.versionId;
      record.riskAckVersionId = old.riskNotice?.text && old.riskNotice.text === target.riskNotice?.text && record.riskAckVersionId === old.versionId ? target.versionId : null;
      record.branchSelections = {};
      record.confirmations = [];
    }
    record.updatedAt = now();
    await persist();
    return sendJson(res, 200, { progress: progressPayload(record), migrated: true, carried, reset, policy: target.mode === 'stepwise' ? '仅迁移内容哈希完全一致且依赖仍成立的步骤；合并步骤不会凭旧勾选自动完成。' : '整个教程已冻结升级，旧勾选保留在历史中，新版需重新阅读确认。' });
  }

  const riskMatch = /^\/api\/progress\/([^/]+)\/acknowledge-risk$/.exec(url.pathname);
  if (req.method === 'POST' && riskMatch) {
    const record = store.progress[riskMatch[1]];
    if (!record) return sendJson(res, 404, { error: '阅读进度不存在。' });
    if (body.versionId && body.versionId !== record.versionId) return sendJson(res, 409, { error: '风险提示版本已变化，请重新阅读并确认。', code: 'stale-risk-version' });
    record.riskAckVersionId = record.versionId;
    record.updatedAt = now();
    await persist();
    return sendJson(res, 200, { progress: progressPayload(record) });
  }

  const confirmMatch = /^\/api\/progress\/([^/]+)\/confirm$/.exec(url.pathname);
  if (req.method === 'POST' && confirmMatch) {
    const record = store.progress[confirmMatch[1]];
    if (!record) return sendJson(res, 404, { error: '阅读进度不存在。' });
    const version = store.tutorialVersions[record.versionId];
    if (body.clientVersionId && body.clientVersionId !== record.versionId) {
      return sendJson(res, 409, { error: '离线阅读基于旧版本，进度不能迟到写入；请先查看迁移说明。', code: 'stale-offline-version', currentVersionId: record.versionId });
    }
    if (record.riskAckVersionId !== version.versionId) return sendJson(res, 409, { error: '请先阅读并确认当前版本的原有风险提示。', code: 'risk-ack-required' });
    const step = version.steps.find((s) => s.key === body.stepKey);
    if (!step) return sendJson(res, 404, { error: '该版本中没有此步骤。' });
    if (body.variantHash && body.variantHash !== step.variantHash) {
      return sendJson(res, 409, { error: '步骤内容已换版，请重新阅读后再确认。', code: 'stale-offline-step', currentVariantHash: step.variantHash });
    }
    const state = stepCompletionState(version, record);
    if (step.optional) {
      const groupMerge = version.steps.find((candidate) => candidate.merge?.branchGroup === step.branchGroup);
      const selected = record.branchSelections[step.branchGroup];
      if (groupMerge?.merge.operator !== 'and' && selected && selected !== step.key) {
        return sendJson(res, 409, { error: `互斥分支只能选择一个：已选择 ${selected}。`, code: 'branch-mutex' });
      }
    }
    if (!step.merge) {
      for (const p of step.prerequisites) {
        if (!state.canComplete(p.stepKey)) return sendJson(res, 409, { error: `请先完成前置步骤：${state.byKey.get(p.stepKey)?.title || p.stepKey}`, code: 'prerequisite' });
      }
    } else {
      const done = step.merge.branches.filter((b) => state.completed.has(b) && state.canComplete(b));
      if (step.merge.operator === 'and' && done.length !== step.merge.branches.length) return sendJson(res, 409, { error: '汇合条件要求全部分支完成。', code: 'merge-and' });
      if (step.merge.operator === 'or' && done.length < 1) return sendJson(res, 409, { error: '汇合前至少完成一个分支。', code: 'merge-or' });
    }

    const already = record.confirmations.find((c) => c.versionId === version.versionId && c.stepKey === step.key);
    if (!already) {
      record.confirmations.push({
        stepKey: step.key, versionId: version.versionId, stepVersionId: step.stepVersionId, variantHash: step.variantHash,
        confirmedAt: now(), offline: !!body.offline, clientTime: body.clientTime || null
      });
    }
    if (step.optional) record.branchSelections[step.branchGroup] = step.key;
    record.updatedAt = now();
    await persist();
    return sendJson(res, 200, { progress: progressPayload(record) });
  }

  if (!url.pathname.startsWith('/api/admin/')) return sendJson(res, 404, { error: '接口不存在。' });
  if (!requireAdmin(req, res)) return null;

  if (route === 'POST /api/admin/_reset' && process.env.ALLOW_TEST_RESET === '1') {
    store = seedStore();
    await persist();
    return sendJson(res, 200, { reset: true });
  }

  if (route === 'GET /api/admin/state') {
    return sendJson(res, 200, {
      materials: sanitizeList(store.materials), media: sanitizeList(store.media), crafts: sanitizeList(store.crafts),
      riskNotices: sanitizeList(store.riskNotices), annotations: sanitizeList(store.annotations),
      drafts: sanitizeList(store.drafts), versions: Object.values(store.tutorialVersions).sort(compareVersions)
    });
  }

  if (route === 'POST /api/admin/materials') {
    const record = { id: body.id || id('mat'), name: String(body.name || '').trim(), description: String(body.description || '').trim(), status: 'active', createdAt: now(), updatedAt: now() };
    if (!record.name) return sendJson(res, 400, { error: '材料名称必填。' });
    if (store.materials[record.id]) return sendJson(res, 409, { error: '材料 ID 已存在。' });
    store.materials[record.id] = record; await persist(); return sendJson(res, 201, { material: record });
  }
  const materialMatch = /^\/api\/admin\/materials\/([^/]+)$/.exec(url.pathname);
  if (materialMatch) {
    const record = store.materials[materialMatch[1]];
    if (!record) return sendJson(res, 404, { error: '材料不存在。' });
    if (req.method === 'PATCH') {
      if (body.name !== undefined) record.name = String(body.name).trim();
      if (body.description !== undefined) record.description = String(body.description).trim();
      if (body.status && ['active', 'obsolete'].includes(body.status)) record.status = body.status;
      record.updatedAt = now(); await persist(); return sendJson(res, 200, { material: record });
    }
    if (req.method === 'DELETE') {
      const referencedByVersion = Object.values(store.tutorialVersions).some((v) => v.steps.some((s) => s.materials.some((m) => m.materialId === record.id)));
      const referencedByDraft = Object.values(store.drafts).some((d) => d.steps.some((s) => s.materials.some((m) => m.materialId === record.id)));
      if (referencedByVersion || referencedByDraft) return sendJson(res, 409, { error: '材料被工序草稿或已持久化步骤版本引用，不能并发或直接删除；可标记为停用后改稿。', referencedByVersion, referencedByDraft });
      delete store.materials[record.id]; await persist(); return sendJson(res, 200, { deleted: true });
    }
  }

  if (route === 'POST /api/admin/media') {
    const required = ['title', 'type', 'url'];
    if (required.some((k) => !String(body[k] || '').trim())) return sendJson(res, 400, { error: '媒体标题、类型和 URL 必填。' });
    if (!['image', 'video', 'audio'].includes(body.type)) return sendJson(res, 400, { error: '媒体类型无效。' });
    const record = {
      id: body.id || id('med'), title: String(body.title).trim(), type: body.type, url: String(body.url).trim(),
      poster: body.poster || '', altText: String(body.altText || '').trim(), textAlternative: String(body.textAlternative || '').trim(),
      captions: {}, available: body.available !== false, licenseActive: body.licenseActive !== false, reviewStatus: body.reviewStatus === 'approved' ? 'approved' : 'draft',
      createdAt: now(), updatedAt: now()
    };
    store.media[record.id] = record; await persist(); return sendJson(res, 201, { media: record });
  }
  const mediaMatch = /^\/api\/admin\/media\/([^/]+)$/.exec(url.pathname);
  if (mediaMatch && req.method === 'PATCH') {
    const record = store.media[mediaMatch[1]];
    if (!record) return sendJson(res, 404, { error: '媒体不存在。' });
    for (const key of ['title', 'url', 'poster', 'altText', 'textAlternative', 'reviewStatus']) if (body[key] !== undefined) record[key] = String(body[key]).trim();
    if (body.available !== undefined) record.available = !!body.available;
    if (body.licenseActive !== undefined) record.licenseActive = !!body.licenseActive;
    record.updatedAt = now(); await persist(); return sendJson(res, 200, { media: record });
  }
  const captionMatch = /^\/api\/admin\/media\/([^/]+)\/captions\/([^/]+)$/.exec(url.pathname);
  if (captionMatch && req.method === 'PUT') {
    const record = store.media[captionMatch[1]];
    if (!record) return sendJson(res, 404, { error: '媒体不存在。' });
    const lang = captionMatch[2];
    const current = record.captions[lang];
    record.captions[lang] = { lang, label: String(body.label || lang).trim(), version: (current?.version || 0) + 1, text: String(body.text || '').trim() };
    record.updatedAt = now(); await persist(); return sendJson(res, 200, { caption: record.captions[lang], warning: '历史步骤版本继续使用发布时锁定的字幕；新发布必须选择新版本。' });
  }
  if (mediaMatch && req.method === 'DELETE') {
    const record = store.media[mediaMatch[1]];
    if (!record) return sendJson(res, 404, { error: '媒体不存在。' });
    const referenced = Object.values(store.tutorialVersions).some((v) => v.steps.some((s) => s.mediaSnapshot?.mediaId === record.id)) || Object.values(store.drafts).some((d) => d.steps.some((s) => s.mediaRequirement?.mediaId === record.id));
    if (referenced) return sendJson(res, 409, { error: '媒体被草稿或历史版本引用，不能删除；可撤销授权或标记不可用。' });
    delete store.media[record.id]; await persist(); return sendJson(res, 200, { deleted: true });
  }

  if (route === 'POST /api/admin/annotations') {
    const record = { id: id('ann'), targetType: body.targetType === 'craft' ? 'craft' : 'step', targetKey: String(body.targetKey || '').trim(), body: String(body.body || '').trim(), reviewStatus: 'draft', createdAt: now(), updatedAt: now() };
    if (!record.targetKey || record.body.length < 2) return sendJson(res, 400, { error: '注释对象和内容必填。' });
    store.annotations[record.id] = record; await persist(); return sendJson(res, 201, { annotation: record });
  }
  const annMatch = /^\/api\/admin\/annotations\/([^/]+)$/.exec(url.pathname);
  if (annMatch && req.method === 'PATCH') {
    const record = store.annotations[annMatch[1]];
    if (!record) return sendJson(res, 404, { error: '注释不存在。' });
    if (body.body !== undefined) record.body = String(body.body).trim();
    if (['draft', 'approved', 'rejected'].includes(body.reviewStatus)) record.reviewStatus = body.reviewStatus;
    record.updatedAt = now(); await persist(); return sendJson(res, 200, { annotation: record });
  }

  const draftGet = /^\/api\/admin\/crafts\/([^/]+)\/draft$/.exec(url.pathname);
  if (draftGet && req.method === 'GET') {
    const craftId = draftGet[1];
    const existing = store.drafts[craftId];
    if (existing) return sendJson(res, 200, { draft: existing });
    const v = latestVersion(craftId);
    if (!v) return sendJson(res, 404, { error: '没有可编辑的版本。' });
    const draft = {
      craftId, title: v.title, summary: v.summary, content: v.content, reviewStatus: v.reviewStatus,
      reviewNote: v.reviewNote, riskNoticeId: v.riskNotice?.id || '', baseVersionId: v.versionId,
      steps: v.steps.map((s) => ({
        key: s.key, title: s.title, text: s.text, instructions: s.instructions, optional: s.optional, branchGroup: s.branchGroup,
        prerequisites: s.prerequisites, merge: s.merge, materials: s.materials,
        mediaRequirement: s.mediaSnapshot ? { mediaId: s.mediaSnapshot.mediaId, captionLang: s.mediaSnapshot.caption?.lang || null, captionVersion: s.mediaSnapshot.caption?.version || null } : null,
        alternativeText: s.alternativeText, reviewStatus: 'approved'
      })),
      updatedAt: now()
    };
    return sendJson(res, 200, { draft });
  }

  if (draftGet && req.method === 'PUT') {
    const craftId = draftGet[1];
    if (!store.crafts[craftId]) return sendJson(res, 404, { error: '手艺专题不存在。' });
    const draft = {
      craftId, title: String(body.title || '').trim(), summary: String(body.summary || '').trim(), content: String(body.content || '').trim(),
      reviewStatus: body.reviewStatus === 'approved' ? 'approved' : 'draft', reviewNote: String(body.reviewNote || '').trim(),
      riskNoticeId: String(body.riskNoticeId || '').trim(), baseVersionId: String(body.baseVersionId || latestVersion(craftId).versionId),
      steps: (body.steps || []).map(normalizeDraftStep), updatedAt: now()
    };
    const errors = validateDraft(draft);
    if (errors.length) return sendJson(res, 409, { error: '草稿服务端校验未通过，未替换已保存草稿。', submittedDraft: draft, validation: { valid: false, errors } });
    store.drafts[craftId] = draft; await persist();
    return sendJson(res, 200, { draft: draft, validation: { valid: true, errors } });
  }

  if (draftGet && req.method === 'DELETE') {
    delete store.drafts[draftGet[1]];
    await persist();
    return sendJson(res, 200, { deleted: true });
  }

  const validateMatch = /^\/api\/admin\/crafts\/([^/]+)\/validate$/.exec(url.pathname);
  if (validateMatch && req.method === 'POST') {
    const draft = store.drafts[validateMatch[1]];
    if (!draft) return sendJson(res, 404, { error: '草稿不存在。' });
    const errors = validateDraft(draft);
    return sendJson(res, errors.length ? 409 : 200, { valid: errors.length === 0, errors });
  }

  const publishMatch = /^\/api\/admin\/crafts\/([^/]+)\/publish$/.exec(url.pathname);
  if (publishMatch && req.method === 'POST') {
    const craftId = publishMatch[1];
    const draft = store.drafts[craftId];
    if (!draft) return sendJson(res, 404, { error: '请先保存草稿。' });
    const mode = body.mode === 'stepwise' ? 'stepwise' : 'frozen';
    const errors = validateDraft(draft);
    if (errors.length) return sendJson(res, 409, { error: '发布被服务端规则拒绝。', errors });
    const parent = latestVersion(craftId);
    const major = parseSemver(parent.version)[0];
    const minor = parseSemver(parent.version)[1];
    const version = mode === 'frozen' ? `${major + 1}.0.0` : `${major}.${minor + 1}.0`;
    const revisionBase = {};
    const oldByKey = new Map(parent.steps.map((s) => [s.key, s]));
    const approvedForRevision = Object.values(store.annotations).filter((a) => a.reviewStatus === 'approved');
    for (const step of draft.steps) {
      const variant = stepVariant(step);
      const annotationBodies = approvedForRevision.filter((a) => a.targetType === 'step' && a.targetKey === step.key).map((a) => `${a.id}:${a.body}`);
      const comparableHash = hashJson({ ...variant, annotationBodies });
      const old = oldByKey.get(step.key);
      revisionBase[step.key] = old && comparableHash === old.variantHash ? old.revision : (old?.revision || 0) + 1;
    }
    const craft = store.crafts[craftId];
    const updatedCraft = { ...craft, title: draft.title, summary: draft.summary, content: draft.content, reviewStatus: draft.reviewStatus, reviewNote: draft.reviewNote, updatedAt: now() };
    store.crafts[craftId] = updatedCraft;
    const versionId = `${craftId}-v${crypto.randomBytes(3).toString('hex')}`;
    const snapshot = publishSnapshot({
      craft: updatedCraft, riskNotices: store.riskNotices, steps: draft.steps, materials: store.materials, media: store.media,
      annotations: store.annotations, versionId, version, mode, parentVersionId: parent.versionId, revisionBase, publishedAt: now()
    });
    store.tutorialVersions[versionId] = snapshot;
    delete store.drafts[craftId];
    await persist();
    return sendJson(res, 201, { version: snapshot, migrationPolicy: snapshot.mode === 'stepwise'
      ? '只有稳定标识和内容哈希均未改变、且依赖仍满足的阅读勾选可迁移；新增/变更/汇合步骤必须重新确认。'
      : '整个教程作为新版本冻结；学习者可继续旧版，或进入新版并重新确认，不凭旧勾选认定新要求。' });
  }

  const rollbackMatch = /^\/api\/admin\/crafts\/([^/]+)\/rollback$/.exec(url.pathname);
  if (rollbackMatch && req.method === 'POST') {
    const craftId = rollbackMatch[1];
    const source = store.tutorialVersions[body.versionId];
    if (!source || source.craftId !== craftId) return sendJson(res, 404, { error: '回滚来源版本不存在。' });
    const draft = {
      craftId, title: source.title, summary: source.summary, content: source.content, reviewStatus: 'draft',
      reviewNote: '由历史版本回滚生成，必须重新审核并检查素材授权。', riskNoticeId: source.riskNotice?.id || '',
      baseVersionId: latestVersion(craftId).versionId,
      steps: source.steps.map((s) => ({
        key: s.key, title: s.title, text: s.text, instructions: s.instructions, optional: s.optional, branchGroup: s.branchGroup,
        prerequisites: s.prerequisites, merge: s.merge, materials: s.materials,
        mediaRequirement: s.mediaSnapshot ? { mediaId: s.mediaSnapshot.mediaId, captionLang: s.mediaSnapshot.caption?.lang || null, captionVersion: s.mediaSnapshot.caption?.version || null } : null,
        alternativeText: s.alternativeText, reviewStatus: 'draft'
      })),
      updatedAt: now()
    };
    store.drafts[craftId] = draft;
    await persist();
    return sendJson(res, 200, { draft: draft, validation: { valid: false, errors: validateDraft(draft) }, warning: '历史授权若已撤销，回滚不会绕过；必须替换媒体或文字方案后重新审核发布。' });
  }

  return sendJson(res, 404, { error: '管理接口不存在。' });
}

function validateDraft(draft) {
  const errors = [];
  if (!draft.title?.trim()) errors.push('专题标题必填。');
  if (draft.content.trim().length < 20) errors.push('专题介绍必须包含完整文字。');
  if (draft.reviewStatus !== 'approved') errors.push('专题内容尚未通过审核。');
  const risk = store.riskNotices[draft.riskNoticeId];
  if (!risk || risk.reviewStatus !== 'approved') errors.push('必须选择经审核的原有风险提示。');
  errors.push(...validateGraph(draft.steps));
  return [...new Set(errors)];
}

function progressPayload(record) {
  const version = store.tutorialVersions[record.versionId];
  const latest = latestVersion(record.craftId);
  return {
    progressId: record.progressId, craftId: record.craftId, versionId: record.versionId,
    version: version.version, mode: version.mode, updatedAt: record.updatedAt,
    riskAcknowledged: record.riskAckVersionId === version.versionId,
    confirmations: record.confirmations, branchSelections: record.branchSelections,
    steps: availability(version, record),
    updateAvailable: latest.versionId !== record.versionId,
    latestVersionId: latest.versionId,
    latestVersion: latest.version,
    latestMode: latest.mode,
    migrationHistory: record.migrationHistory
  };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wav': 'audio/wav' };
function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const relative = pathname.replace(/^\/+|\/+$/g, '');
  const safeRelative = !relative.split('/').some((part) => part === '..' || path.isAbsolute(part));
  if (!safeRelative) {
    res.writeHead(403); return res.end('Forbidden');
  }
  const publicFile = pathname.startsWith('/images/') ? path.join(__dirname, relative) : path.join(__dirname, 'public', relative);
  const normalized = path.normalize(publicFile);
  const insidePublic = normalized === path.join(__dirname, 'public') || normalized.startsWith(path.join(__dirname, 'public') + path.sep);
  const insideImages = normalized === path.join(__dirname, 'images') || normalized.startsWith(path.join(__dirname, 'images') + path.sep);
  if (!insidePublic && !insideImages) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(normalized, (error, data) => {
    if (error) {
      fs.readFile(path.join(__dirname, 'public', 'index.html'), (err2, fallback) => {
        if (err2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'content-type': MIME['.html'] }); res.end(fallback);
      });
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(normalized)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.message || '服务器错误' });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => console.log(`手艺专题服务已启动：http://localhost:${PORT}`));
}

export { store, validateGraph, normalizeDraftStep };
