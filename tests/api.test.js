'use strict';

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const base = `http://127.0.0.1:${process.env.TEST_PORT || 3100}`;
const adminKey = 'test-admin-key';
let server;
let passed = 0;
const test = async (name, fn) => {
  await admin('POST', '/api/admin/_reset', {});
  await fn();
  passed += 1;
  console.log(`✓ ${name}`);
};

async function request(method, pathName, body, headers = {}) {
  const response = await fetch(base + pathName, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}
const admin = (method, p, body) => request(method, p, body, { 'x-admin-key': adminKey });
const ok = (response) => assert.equal(response.status, 200 || response.status, JSON.stringify(response.data));
const assertFail = (response, status, fragment) => { assert.equal(response.status, status); const all = [response.data.error, ...(response.data.errors || []), ...(response.data.validation?.errors || [])].join('；'); assert.match(all, new RegExp(fragment)); };

async function start() {
  const store = path.join(root, 'data', `test-${process.pid}.json`);
  fs.rmSync(store, { force: true });
  server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: new URL(base).port, ADMIN_KEY: adminKey, STORE_FILE: store, ALLOW_TEST_RESET: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server timeout')), 5000);
    server.stdout.on('data', (chunk) => { if (String(chunk).includes('started') || String(chunk).includes('启动')) { clearTimeout(timer); resolve(); } });
    server.once('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
  return store;
}
async function getDraft() {
  await admin('DELETE', '/api/admin/crafts/craft_shadow/draft', {});
  const r = await admin('GET', '/api/admin/crafts/craft_shadow/draft');
  assert.equal(r.status, 200);
  return r.data.draft;
}
async function putDraft(draft) {
  return admin('PUT', '/api/admin/crafts/craft_shadow/draft', draft);
}
async function validate() {
  return admin('POST', '/api/admin/crafts/craft_shadow/validate', {});
}
async function publish(mode = 'frozen') {
  return admin('POST', '/api/admin/crafts/craft_shadow/publish', { mode });
}
async function startProgress(versionId) {
  let r = await request('POST', '/api/progress/start', { craftId: 'craft_shadow' });
  assert.equal(r.status, 201);
  const id = r.data.progress.progressId;
  if (versionId && versionId !== r.data.progress.versionId) {
    r = await request('GET', `/api/progress/${id}`);
  }
  return id;
}
async function ackRisk(pid, versionId) {
  return request('POST', `/api/progress/${pid}/acknowledge-risk`, { versionId });
}
async function confirm(pid, stepKey, extra = {}) {
  return request('POST', `/api/progress/${pid}/confirm`, { stepKey, ...extra });
}
async function ackAndConfirm(pid, stepKey, versionId, extra = {}) {
  await ackRisk(pid, versionId);
  return confirm(pid, stepKey, extra);
}

async function addValidBranch(draft) {
  draft.steps = draft.steps.filter((s) => !['thin_border', 'wide_border', 'join_border'].includes(s.key));
  const color = draft.steps.find((s) => s.key === 'color');
  color.prerequisites = [{ stepKey: 'join_border' }];
  draft.steps.splice(2, 0,
    { ...draft.steps.find((s) => s.key === 'carve_fine'), key: 'thin_border', title: '细分发纹分支', text: '适合文生角色的细密发纹，沿同一方向补刻短而匀的线。', optional: true, branchGroup: 'border', prerequisites: [{ stepKey: 'carve_fine' }], merge: null, materials: [{ materialId: 'mat_oxhide', required: true }, { materialId: 'mat_knife', required: true }], mediaRequirement: { mediaId: 'med_carving', captionLang: 'zh', captionVersion: 1 }, alternativeText: '', reviewStatus: 'approved' },
    { ...draft.steps.find((s) => s.key === 'carve_fine'), key: 'wide_border', title: '宽纹衣褶分支', text: '适合武将角色的宽纹衣褶，用较少较长的弧线表现力度。', optional: true, branchGroup: 'border', prerequisites: [{ stepKey: 'carve_fine' }], merge: null, materials: [{ materialId: 'mat_oxhide', required: true }, { materialId: 'mat_knife', required: true }], mediaRequirement: { mediaId: 'med_carving', captionLang: 'zh', captionVersion: 1 }, alternativeText: '', reviewStatus: 'approved' },
    { key: 'join_border', title: '分支汇合检查', text: '根据所选发纹或衣褶路径检查连接筋和后续设色范围。', instructions: '确认至少一条实际路径完成。', optional: false, branchGroup: null, prerequisites: [{ stepKey: 'thin_border' }, { stepKey: 'wide_border' }], merge: { branchGroup: 'border', operator: 'or', branches: ['thin_border', 'wide_border'], policyText: '学习者只需完成实际选择的一个分支。' }, materials: [], mediaRequirement: null, alternativeText: '纯文字检查：确认所选分支的连接筋、刀线深度与设色范围。', reviewStatus: 'approved' }
  );
  return draft;
}

const store = await start();
try {
  await test('公开页面只返回审核工艺、完整文字、版本和风险提示', async () => {
    const r = await request('GET', '/api/crafts');
    assert.equal(r.status, 200); assert.equal(r.data.crafts[0].title, '关中皮影雕刻');
    const detail = await request('GET', '/api/crafts/craft_shadow');
    assert.ok(detail.data.version.riskNotice.text.includes('不代表获得实际操作资格'));
    assert.ok(detail.data.version.steps.every((s) => s.text.length >= 20 && (s.mediaSnapshot || s.alternativeText)));
  });

  await test('访客可在手机端按必需前置逐步骤确认阅读', async () => {
    const pid = await startProgress();
    const riskBlocked = await confirm(pid, 'pattern');
    assert.equal(riskBlocked.status, 409); assert.match(riskBlocked.data.error, /风险提示/);
    await ackRisk(pid);
    const blocked = await confirm(pid, 'color');
    assert.equal(blocked.status, 409); assert.match(blocked.data.error, /前置/);
    for (const key of ['pattern', 'carve_fine', 'color', 'inspect']) assert.equal((await confirm(pid, key)).status, 200);
    const p = await request('GET', `/api/progress/${pid}`);
    assert.equal(p.data.progress.steps.every((s) => s.completed), true);
  });

  await test('服务端拒绝循环依赖，拖动排序字段不会改变依赖', async () => {
    const draft = await getDraft();
    draft.steps.reverse();
    draft.steps.find((s) => s.key === 'pattern').prerequisites = [{ stepKey: 'inspect' }];
    const invalid = await putDraft(draft);
    assert.equal(invalid.status, 409);
    assert.match(invalid.data.validation.errors.join('；'), /循环/);
    assert.equal(invalid.data.validation.valid, false);
    const good = await getDraft();
    assert.equal((await putDraft(good)).status, 200);
  });

  await test('服务端拒绝引用停用或缺失的必需材料', async () => {
    const deactivate = await admin('PATCH', '/api/admin/materials/mat_pigment', { status: 'obsolete' });
    assert.equal(deactivate.status, 200);
    assertFail(await putDraft(await getDraft()), 409, '缺少可用材料');
    await admin('PATCH', '/api/admin/materials/mat_pigment', { status: 'active' });
  });

  await test('正在被引用的材料不能并发或直接删除', async () => {
    assertFail(await admin('DELETE', '/api/admin/materials/mat_knife', {}), 409, '不能');
  });

  await test('必需前置、可选分支、互斥选择和 or 汇合条件由服务端检查', async () => {
    const draft = await addValidBranch(await getDraft());
    assert.equal((await putDraft(draft)).data.validation.valid, true);
    const p = await publish('stepwise');
    assert.equal(p.status, 201);
    const pid = await startProgress();
    await ackRisk(pid);
    for (const key of ['pattern', 'carve_fine']) assert.equal((await confirm(pid, key)).status, 200);
    assert.equal((await confirm(pid, 'thin_border')).status, 200);
    assertFail(await confirm(pid, 'wide_border'), 409, '互斥');
    assert.equal((await confirm(pid, 'join_border')).status, 200);
    assert.equal((await confirm(pid, 'color')).status, 200);
  });

  await test('视频或音频不可用时发布拒绝，历史阅读降级为完整文字', async () => {
    const pid = await startProgress();
    const oldVersion = (await request('GET', `/api/progress/${pid}`)).data.progress.versionId;
    await admin('PATCH', '/api/admin/media/med_carving', { available: false });
    const draft = await getDraft();
    assertFail(await putDraft(draft), 409, '当前不可用');
    const oldDetail = await request('GET', `/api/crafts/craft_shadow?versionId=${oldVersion}`);
    const mediaStep = oldDetail.data.version.steps.find((s) => s.key === 'carve_fine');
    assert.equal(mediaStep.mediaSnapshot.playable, false);
    assert.ok(mediaStep.mediaSnapshot.textAlternative.length > 20);
    await admin('PATCH', '/api/admin/media/med_carving', { available: true });
  });

  await test('字幕换版后旧版本保持锁定字幕，新发布必须选择新版本', async () => {
    const pid = await startProgress();
    const oldVersion = (await request('GET', `/api/progress/${pid}`)).data.progress.versionId;
    const cap = await admin('PUT', '/api/admin/media/med_carving/captions/zh', { label: '中文', text: '新版字幕：重新审核走刀提示。' });
    assert.equal(cap.status, 200);
    const oldDetail = await request('GET', `/api/crafts/craft_shadow?versionId=${oldVersion}`);
    assert.equal(oldDetail.data.version.steps.find((s) => s.key === 'carve_fine').mediaSnapshot.caption.version, 1);
    const draft = await getDraft();
    assertFail(await putDraft(draft), 409, '字幕版本已换版');
    draft.steps.find((s) => s.key === 'carve_fine').mediaRequirement.captionVersion = 2;
    assert.equal((await putDraft(draft)).data.validation.valid, true);
  });

  await test('步骤分叉后回滚生成新草稿，且不能绕过撤销授权', async () => {
    await admin('PATCH', '/api/admin/media/med_pattern', { licenseActive: false });
    const rollback = await admin('POST', '/api/admin/crafts/craft_shadow/rollback', { versionId: 'craft_shadow-v1' });
    assert.equal(rollback.status, 200);
    assert.match(rollback.data.validation.errors.join('；'), /授权已撤销|尚未通过/);
    await admin('PATCH', '/api/admin/media/med_pattern', { licenseActive: true });
  });

  await test('整个教程冻结时旧勾选不自动认定新要求', async () => {
    const pid = await startProgress('craft_shadow-v1');
    await ackRisk(pid);
    for (const key of ['pattern', 'carve_fine', 'color', 'inspect']) assert.equal((await confirm(pid, key)).status, 200);
    const draft = await getDraft();
    draft.steps.find((s) => s.key === 'inspect').text += ' 新增一项完成后的清洁与刀具收纳阅读要求。';
    assert.equal((await putDraft(draft)).data.validation.valid, true);
    assert.equal((await publish('frozen')).status, 201);
    const migrate = await request('POST', '/api/progress/migrate', { progressId: pid, strategy: 'upgrade' });
    assert.equal(migrate.status, 200);
    assert.deepEqual(migrate.data.carried, []);
    assert.ok(migrate.data.reset.includes('inspect'));
    assert.equal((await request('GET', `/api/progress/${pid}`)).data.progress.steps.some((s) => s.completed), false);
  });

  await test('按步骤升级只迁移哈希一致且依赖成立的步骤，合并步骤不会凭旧勾选自动完成', async () => {
    const pid = await startProgress();
    await ackRisk(pid);
    for (const key of ['pattern', 'carve_fine']) assert.equal((await confirm(pid, key)).status, 200);
    const draft = await addValidBranch(await getDraft());
    draft.steps.find((s) => s.key === 'color').text += ' 新版增加关节铆点避色说明。';
    assert.equal((await putDraft(draft)).data.validation.valid, true);
    assert.equal((await publish('stepwise')).status, 201);
    const migrate = await request('POST', '/api/progress/migrate', { progressId: pid, strategy: 'upgrade' });
    assert.deepEqual(migrate.data.carried.sort(), ['carve_fine', 'pattern']);
    assert.ok(migrate.data.reset.includes('color'));
    const progress = (await request('GET', `/api/progress/${pid}`)).data.progress;
    assert.equal(progress.steps.find((s) => s.stepKey === 'join_border').completed, false);
  });

  await test('离线迟到进度若版本已迁移则 409，不静默覆盖新进度', async () => {
    const pid = await startProgress();
    const stale = await confirm(pid, 'pattern', { clientVersionId: 'a-future-version', variantHash: 'oldhash' });
    assert.equal(stale.status, 409);
    assert.equal(stale.data.code, 'stale-offline-version');
  });

  await test('历史链接不显示后来授权撤销的素材，且仍提供完整文字', async () => {
    await admin('PATCH', '/api/admin/media/med_color', { licenseActive: false });
    const detail = await request('GET', '/api/crafts/craft_shadow?versionId=craft_shadow-v1');
    const step = detail.data.version.steps.find((s) => s.key === 'color');
    assert.equal(step.mediaSnapshot.playable, false);
    assert.equal(step.mediaSnapshot.url, '');
    assert.match(step.mediaSnapshot.unavailableReason, /授权/);
    assert.ok(step.mediaSnapshot.textAlternative);
    await admin('PATCH', '/api/admin/media/med_color', { licenseActive: true });
  });

  await test('键盘与完整文字是发布门槛：无媒体时必须有明确替代方案', async () => {
    const draft = await getDraft();
    draft.steps[0].mediaRequirement = null;
    draft.steps[0].alternativeText = '';
    assertFail(await putDraft(draft), 409, '明确文字替代');
  });

  console.log(`\n${passed} 项验收测试全部通过`);
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 100));
  fs.rmSync(store, { force: true });
}
