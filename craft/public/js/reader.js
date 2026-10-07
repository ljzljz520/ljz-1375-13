/* 访客阅读端：完整文字优先、键盘可操作、离线确认队列 */
'use strict';
const $ = s => document.querySelector(s);
const api = async (path, opts = {}) => {
  const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.message || res.statusText), { status: res.status, body });
  return body;
};

const LS = {
  get learner() { return localStorage.getItem('craft.learnerId'); },
  set learner(v) { v ? localStorage.setItem('craft.learnerId', v) : localStorage.removeItem('craft.learner'); },
  get queue() { return JSON.parse(localStorage.getItem('craft.queue') || '[]'); },
  set queue(v) { localStorage.setItem('craft.queue', JSON.stringify(v)); }
};

let tutorials = [], current = null, progress = null;

async function init() {
  wireNet();
  wireUi();
  await refreshLearners();
  await loadTutorials();
}

function wireNet() {
  const setNet = () => {
    const el = $('#netState');
    el.textContent = navigator.onLine ? '在线' : '离线：确认将暂存，联网后自动提交（迟到确认仍受服务端版本校验）';
    el.className = 'net ' + (navigator.onLine ? 'on' : 'off');
  };
  addEventListener('online', () => { setNet(); replayQueue(); });
  addEventListener('offline', setNet);
  setNet();
}

function wireUi() {
  $('#newLearner').onclick = async () => {
    const name = prompt('访客名称（可留空）') || '';
    const l = await api('/api/learners', { method: 'POST', body: JSON.stringify({ name }) });
    LS.learner = l.id;
    await refreshLearners();
  };
  $('#learnerSel').onchange = e => { LS.learner = e.target.value; loadTutorials(); };
  $('#backBtn').onclick = () => { $('#tutView').hidden = true; $('#tutList').hidden = false; };
  $('#previewMigrate').onclick = previewMigration;
  $('#doMigrate').onclick = doMigrate;
}

async function refreshLearners() {
  // 简单起见：本地保存最近用过的学习者；服务端不提供无鉴权名单
  const sel = $('#learnerSel');
  sel.textContent = '';
  const mine = JSON.parse(localStorage.getItem('craft.learners') || '[]');
  for (const id of mine) {
    try {
      const p = await api(`/api/learners/${id}/progress`);
      const o = document.createElement('option');
      o.value = id; o.textContent = id;
      sel.appendChild(o);
    } catch { /* 忽略已不存在者 */ }
  }
  if (LS.learner && !mine.includes(LS.learner)) LS.learner = null;
  if (LS.learner) sel.value = LS.learner;
  else if (mine.length === 0) {
    const l = await api('/api/learners', { method: 'POST', body: JSON.stringify({ name: '访客' }) });
    localStorage.setItem('craft.learners', JSON.stringify([l.id]));
    LS.learner = l.id;
    await refreshLearners();
  }
}

async function loadTutorials() {
  tutorials = (await api('/api/tutorials')).tutorials;
  const box = $('#tutList');
  box.textContent = '';
  for (const t of tutorials) {
    const b = document.createElement('button');
    b.className = 'tut-item';
    b.type = 'button';
    b.innerHTML = `<h2>${escapeHtml(t.title)}</h2><span class="tag">${t.mode === 'frozen' ? '整个教程冻结' : '按步骤升级'} · ${escapeHtml(t.releaseLabel || '')}</span>`;
    b.onclick = () => openTutorial(t.id);
    box.appendChild(b);
  }
}

async function openTutorial(id, releaseId) {
  const q = new URLSearchParams();
  if (LS.learner) q.set('learnerId', LS.learner);
  if (releaseId) q.set('releaseId', releaseId);
  current = await api(`/api/tutorials/${id}?${q}`);
  progress = current.progress || { mode: current.mode, frozen: null, confirmations: {} };
  await api(`/api/learners/${LS.learner}/progress/${id}/start`, { method: 'POST' });
  $('#tutList').hidden = true;
  $('#tutView').hidden = false;
  renderTutorial();
}

function renderTutorial() {
  $('#tTitle').textContent = current.title;
  $('#tMode').textContent = current.mode === 'frozen'
    ? `整个教程冻结 · ${current.releaseLabel}${current.historical ? '（历史版本）' : ''}`
    : '按步骤升级：未读步骤将随发布更新，已确认步骤保持旧版提示';
  $('#tIntro').textContent = current.intro;
  $('#tRisk').textContent = current.riskNotice;
  $('#migrateBox').hidden = !(current.mode === 'frozen' && current.hasNewRelease);

  const conf = progress.confirmations || {};
  const done = current.steps.filter(s => conf[s.id]).length;
  const pct = Math.round(done / current.steps.length * 100);
  $('#progressBar').style.width = pct + '%';
  $('#progressText').textContent = `已读 ${done}/${current.steps.length}（${pct}%）· 确认不等于操作资格`;

  const list = $('#steps');
  list.textContent = '';
  current.steps.forEach((s, i) => list.appendChild(renderStep(s, i + 1, !!conf[s.id], conf[s.id])));
}

function renderStep(s, n, done, conf) {
  const li = document.createElement('li');
  li.className = 'step' + (done ? ' done' : '');
  li.id = `step-${s.id}`;

  const h = document.createElement('h3');
  h.textContent = `${n}. ${s.title}`;
  li.appendChild(h);

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = [
    ...s.prerequisites.map(p => `前置:${p.stepId}(${p.mode === 'required' ? '必需' : '可选'})`),
    s.branchGroup ? `互斥组:${s.branchGroup}` : null,
    s.join.type !== 'none' ? `汇合(${s.join.type === 'any' ? '任一' : '全部'}:${s.join.sources.join('/')})` : null,
    conf ? `你确认于 v${conf.stepVersion}` : null
  ].filter(Boolean).join('　');
  li.appendChild(meta);

  // 完整文字始终存在，可被屏幕阅读器与键盘访问
  const p = document.createElement('p');
  p.className = 'fulltext';
  p.textContent = s.content;
  li.appendChild(p);

  // 材料
  if (s.materials.length) {
    const chips = document.createElement('div');
    chips.className = 'chips';
    chips.setAttribute('aria-label', '所需材料');
    for (const m of s.materials) {
      const c = document.createElement('span');
      c.className = 'chip' + (m.state !== 'approved' ? ' branch' : '');
      c.textContent = `材料:${m.name}${m.state === 'approved' ? '' : '(' + m.state + ')'}`;
      chips.appendChild(c);
    }
    li.appendChild(chips);
  }

  // 媒体：状态来自服务端；不可用/撤版/撤销授权一律展示文字替代
  for (const md of s.media) {
    const box = document.createElement('div');
    box.className = 'media-box';
    const stateLine = document.createElement('div');
    stateLine.className = 'state ' + md.state;
    const stateText = {
      usable: '视频可用（辅助，非必需）', unavailable: '视频当前不可用，以下为文字替代',
      revoked: '素材授权已撤销，不展示视频，以下为文字替代',
      caption_withdrawn: '字幕版本已撤版，以下为文字替代', missing: '媒体已移除，以下为文字替代'
    }[md.state];
    stateLine.textContent = `[${md.title}] ${stateText}`;
    box.appendChild(stateLine);

    if (md.state === 'usable') {
      const cap = document.createElement('div');
      cap.className = 'caption';
      cap.textContent = `字幕 v${md.captionVersion}：${md.captionText || ''}`;
      box.appendChild(cap);
    }
    const alt = document.createElement('blockquote');
    alt.textContent = md.altText || '（未提供文字替代；发布时将被服务端拒绝）';
    box.appendChild(alt);
    li.appendChild(box);
  }

  // 经审核注释
  for (const a of s.annotations) {
    const an = document.createElement('div');
    an.className = 'annotation';
    an.textContent = `编者注：${a.text}`;
    li.appendChild(an);
  }

  // 操作行：按钮可 Tab 聚焦
  const row = document.createElement('div');
  row.className = 'confirm-row';
  if (done) {
    const b = document.createElement('span');
    b.className = 'badge-done';
    b.textContent = `✔ 已确认阅读（v${conf.stepVersion}）`;
    row.appendChild(b);
    const rb = document.createElement('button');
    rb.className = 'btn'; rb.type = 'button';
    rb.textContent = '撤销我的勾选（回滚）';
    rb.onclick = () => rollback(s.id);
    row.appendChild(rb);
  } else {
    const cb = document.createElement('button');
    cb.className = 'btn btn-primary'; cb.type = 'button';
    cb.textContent = '我已阅读本步骤（确认进度）';
    cb.onclick = () => confirm(s, cb);
    row.appendChild(cb);
  }
  const err = document.createElement('div');
  err.className = 'error-msg'; err.setAttribute('role', 'alert');
  row.appendChild(err);
  li.appendChild(row);
  return li;
}

async function confirm(s, btn) {
  const payload = { stepId: s.id, stepVersion: current.mode === 'frozen'
    ? (current.steps.find(x => x.id === s.id) && pinVersion(s.id))
    : null, clientAt: new Date().toISOString() };
  // stepwise 模式由服务端按当前发布裁决版本；frozen 显式带上快照版本
  if (current.mode !== 'frozen') delete payload.stepVersion;

  if (!navigator.onLine) { enqueue(payload); return; }
  btn.disabled = true;
  try {
    const r = await api(`/api/learners/${LS.learner}/progress/${current.id}/confirm`,
      { method: 'POST', body: JSON.stringify(payload) });
    if (r.idempotent) {}
    await refreshProgress();
  } catch (e) {
    const msg = e.body?.message || e.message;
    btn.parentElement.querySelector('.error-msg').textContent = msg;
    if (e.body?.error === 'STALE_VERSION') {
      alert('该步骤已发布新版本，请阅读更新后的内容再确认。页面即将刷新。');
      await openTutorial(current.id);
    }
  } finally { btn.disabled = false; }
}

function pinVersion(stepId) {
  // 冻结快照的版本号由渲染数据不可直接得知，服务端会校验；留空时服务端对 frozen 走绑定快照
  return undefined;
}

async function rollback(stepId) {
  try {
    await api(`/api/learners/${LS.learner}/progress/${current.id}/rollback`,
      { method: 'POST', body: JSON.stringify({ stepId }) });
    await refreshProgress();
  } catch (e) { alert(e.body?.message || e.message); }
}

async function refreshProgress() {
  const p = await api(`/api/learners/${LS.learner}/progress`);
  progress = p.progress[current.id];
  renderTutorial();
}

// ---- 离线队列：联网后补送；迟到的旧版本确认会被服务端拒绝并要求重读 ----
function enqueue(payload) {
  const q = LS.queue;
  q.push({ tutorialId: current.id, payload });
  LS.queue = q;
  alert('当前离线，确认已暂存（' + payload.stepId + '）。联网后自动提交，若期间步骤升级，服务端会要求你重读新版。');
}
async function replayQueue() {
  let q = LS.queue;
  const remain = [];
  for (const item of q) {
    try {
      await api(`/api/learners/${LS.learner}/progress/${item.tutorialId}/confirm`,
        { method: 'POST', body: JSON.stringify(item.payload) });
    } catch (e) {
      if (e.body?.error === 'STALE_VERSION' || e.status === 409) {
        alert('一条离线确认因版本/依赖变化被服务端拒绝，请重新阅读相关步骤：' + (e.body?.message || ''));
      } else remain.push(item);
    }
  }
  LS.queue = remain;
  if (current) await refreshProgress();
}

async function previewMigration() {
  const pv = await api(`/api/tutorials/${current.id}/migration-preview?learnerId=${LS.learner}`);
  const box = $('#migrateDetail');
  box.innerHTML = `<table><thead><tr><th>新版本步骤</th><th>旧勾选处理</th></tr></thead><tbody>${
    pv.rows.map(r => `<tr><td>${escapeHtml(r.title)} v${r.version}</td><td>${r.carry ? '可直接沿用' : '❌ ' + escapeHtml(r.reason)}</td></tr>`).join('')
  }</tbody></table>`;
}
async function doMigrate() {
  if (!confirm('迁移后：合并/拆分步骤的旧勾选会被清除，需要重新阅读确认。继续？')) return;
  const r = await api(`/api/learners/${LS.learner}/progress/${current.id}/migrate`, { method: 'POST' });
  alert('已迁移到新版本，沿用步骤：' + (r.carried || []).join('、') + '；其余请重新阅读确认。');
  await openTutorial(current.id);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

init().catch(e => { document.body.insertAdjacentHTML('beforeend', `<pre style="color:#a11">${escapeHtml(e.stack)}</pre>`); });
