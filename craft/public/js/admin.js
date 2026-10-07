/* Web 管理端：工序编辑/拖动排序（不改依赖）、材料/注释/媒体管理、服务端图校验、发布 */
'use strict';
const $ = s => document.querySelector(s);
let KEY = localStorage.getItem('craft.adminKey') || '';
let currentTutId = null, detail = null, mats = [], mds = [];
$('#adminKey').value = KEY;

async function api(path, opts = {}) {
  const res = await fetch(path, Object.assign({
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': KEY }
  }, opts));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.message || res.statusText), { status: res.status, body });
  return body;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const j = (sel, ev, fn) => $(sel).addEventListener(ev, fn);

j('#connect', 'click', async () => {
  KEY = $('#adminKey').value.trim();
  localStorage.setItem('craft.adminKey', KEY);
  await loadAll();
});
j('#newTut', 'click', async () => {
  const t = await api('/api/admin/tutorials', { method: 'POST', body: JSON.stringify({
    title: $('#newTutTitle').value, mode: $('#newTutMode').value }) });
  currentTutId = t.id; await loadAll();
});
j('#addMat', 'click', async () => {
  await api('/api/admin/materials', { method: 'POST', body: JSON.stringify({ name: $('#newMat').value }) });
  $('#newMat').value = ''; await loadAll();
});
j('#addVid', 'click', async () => {
  await api('/api/admin/media', { method: 'POST', body: JSON.stringify({ title: $('#newVid').value }) });
  $('#newVid').value = ''; await loadAll();
});

async function loadAll() {
  try {
    const [ts, ms, vs] = await Promise.all([
      api('/api/admin/tutorials'), api('/api/admin/materials'), api('/api/admin/media')
    ]);
    mats = ms.materials; mds = vs.media;
    $('#connState').textContent = '已连接';
    $('#connState').style.color = 'green';
    renderTutList(ts.tutorials); renderMats(); renderMedia();
    if (currentTutId) await loadTut();
  } catch (e) {
    $('#connState').textContent = '未连接：' + e.message;
    $('#connState').style.color = '#a11';
  }
}

function renderTutList(list) {
  const ul = $('#tutList');
  ul.innerHTML = '';
  for (const t of list) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'btn' + (t.id === currentTutId ? ' btn-primary' : '');
    b.type = 'button';
    b.textContent = `${t.title}（${t.mode === 'frozen' ? '冻结' : '逐步'}，草稿${t.drafts.length}）`;
    b.onclick = () => { currentTutId = t.id; loadAll(); };
    li.appendChild(b);
    ul.appendChild(li);
  }
}

function renderMats() {
  const ul = $('#matList');
  ul.innerHTML = '';
  for (const m of mats) {
    const li = document.createElement('li');
    li.innerHTML = `${esc(m.name)} ${m.deletedAt ? '[已删除]' : m.approved ? '[已审]' : '[待审]'} `;
    if (!m.approved && !m.deletedAt) {
      const b = document.createElement('button');
      b.className = 'btn'; b.type = 'button'; b.textContent = '审核通过';
      b.onclick = async () => { await api(`/api/admin/materials/${m.id}/approve`, { method: 'POST' }); loadAll(); };
      li.appendChild(b);
    }
    if (!m.deletedAt) {
      const d = document.createElement('button');
      d.className = 'btn'; d.type = 'button'; d.textContent = '删除（引用时拒绝）';
      d.onclick = async () => {
        try { await api(`/api/admin/materials/${m.id}`, { method: 'DELETE' }); }
        catch (e) { alert(e.body?.message || e.message); }
        loadAll();
      };
      li.appendChild(d);
    }
    ul.appendChild(li);
  }
}

function renderMedia() {
  const ul = $('#vidList');
  ul.innerHTML = '';
  for (const m of mds) {
    const li = document.createElement('li');
    const flags = [m.available ? '可用' : '不可用', m.licenseRevoked ? '授权撤销' : '授权有效'].join('/');
    li.innerHTML = `${esc(m.title)} [${flags}] 字幕:${m.captions.map(c => 'v' + c.version + (c.withdrawn ? '(撤)' : '')).join(',')} `;
    const toggle = document.createElement('button');
    toggle.className = 'btn'; toggle.type = 'button';
    toggle.textContent = m.available ? '置为不可用' : '置为可用';
    toggle.onclick = async () => { await api(`/api/admin/media/${m.id}`, { method: 'PATCH', body: JSON.stringify({ available: !m.available }) }); loadAll(); };
    li.appendChild(toggle);
    const rev = document.createElement('button');
    rev.className = 'btn'; rev.type = 'button';
    rev.textContent = m.licenseRevoked ? '恢复授权' : '撤销授权';
    rev.onclick = async () => { await api(`/api/admin/media/${m.id}`, { method: 'PATCH', body: JSON.stringify({ licenseRevoked: !m.licenseRevoked }) }); loadAll(); };
    li.appendChild(rev);
    const cap = document.createElement('button');
    cap.className = 'btn'; cap.type = 'button'; cap.textContent = '新增字幕版';
    cap.onclick = async () => {
      const text = prompt('新字幕文本') || '';
      await api(`/api/admin/media/${m.id}/captions`, { method: 'POST', body: JSON.stringify({ text }) });
      loadAll();
    };
    li.appendChild(cap);
    const wd = document.createElement('button');
    wd.className = 'btn'; wd.type = 'button'; wd.textContent = '撤版当前最新字幕';
    wd.onclick = async () => {
      const latest = Math.max(...m.captions.map(c => c.version));
      await api(`/api/admin/media/${m.id}/captions/${latest}`, { method: 'PATCH', body: JSON.stringify({ withdrawn: true }) });
      loadAll();
    };
    li.appendChild(wd);
    ul.appendChild(li);
  }
}

async function loadTut() {
  detail = await api(`/api/admin/tutorials/${currentTutId}`);
  renderTut();
}

function draftOf(s) { return s.draft || s.versions[s.versions.length - 1] || null; }

function renderTut() {
  const t = detail.tutorial;
  const panel = $('#tutPanel');
  const sorted = [...t.steps].sort((a, b) => a.order - b.order);
  const check = detail.graphCheck;

  panel.innerHTML = `
    <h2>${esc(t.title)}
      <span class="mode-tag">${t.publishMode === 'frozen' ? '整个教程冻结' : '按步骤升级'}</span>
    </h2>
    <div class="row">
      <button class="btn btn-primary" id="publish" type="button">校验并发布新版本</button>
      <input id="relLabel" placeholder="版本标签（可选）">
      <button class="btn" id="rollbackFork" type="button">丢弃全部草稿（步骤分叉后回滚）</button>
      <button class="btn" id="addStep" type="button">新增步骤</button>
    </div>

    <h3>工艺介绍 / 风险提示</h3>
    <label>工艺介绍（内容仅展示经审核文本）</label>
    <textarea id="intro">${esc(t.intro)}</textarea>
    <div class="row">
      <button class="btn" id="saveIntro" type="button">保存（重置审核）</button>
      <button class="btn" id="approveIntro" type="button">${t.introApproved ? '已通过审核' : '审核通过介绍'}</button>
    </div>
    <label>原有风险提示（必填，发布后仍须保留）</label>
    <textarea id="risk">${esc(t.riskNotice)}</textarea>
    <div class="row">
      <button class="btn" id="saveRisk" type="button">保存（重置审核）</button>
      <button class="btn" id="approveRisk" type="button">${t.riskApproved ? '已通过审核' : '审核通过风险提示'}</button>
    </div>

    <h3>服务端依赖图校验结果</h3>
    <ul class="issues">
      ${check.ok ? '<li class="ok">✔ 图校验通过：无循环、材料齐备、分支互斥成立、媒体均可用或有文字替代</li>'
        : check.issues.map(i => `<li class="bad">[${i.code}] 步骤 ${esc(i.stepId)}：${esc(i.message)}</li>`).join('')}
    </ul>

    <h3>工序（可拖动排序；<u>排序只改展示，不改依赖</u>）</h3>
    <div id="stepList"></div>

    <details><summary>注释管理（仅审核后对外可见）</summary><div id="annPanel"></div></details>
  `;

  const list = $('#stepList');
  for (const s of sorted) list.appendChild(renderStepCard(t, s));
  enableDnD(list);

  $('#publish').onclick = async () => {
    try {
      const r = await api(`/api/admin/tutorials/${t.id}/publish`, {
        method: 'POST', body: JSON.stringify({ label: $('#relLabel').value })
      });
      alert(`发布成功：${r.release.id}（${r.mode === 'frozen' ? '新整体快照；进行中的学习者保持旧版直至迁移' : '逐步骤：新读者见新版，已确认旧版者不自动覆盖'}）`);
    } catch (e) { alert('发布被拒绝：\n' + ((e.body?.issues || []).map(i => `[${i.code}] ${i.message}`).join('\n') || e.message)); }
    loadAll();
  };
  $('#rollbackFork').onclick = async () => {
    if (!confirm('放弃所有未发布草稿？已确认的学习者进度不受影响。')) return;
    await api(`/api/admin/tutorials/${t.id}/rollback-fork`, { method: 'POST' });
    loadAll();
  };
  $('#addStep').onclick = async () => {
    await api(`/api/admin/tutorials/${t.id}/steps`, { method: 'POST', body: JSON.stringify({ title: '新步骤', content: '' }) });
    loadAll();
  };
  $('#saveIntro').onclick = saveText('intro', 'intro');
  $('#approveIntro').onclick = approve('intro');
  $('#saveRisk').onclick = saveText('risk', 'riskNotice');
  $('#approveRisk').onclick = approve('risk');

  renderAnnotations(t);
}

function saveText(kind, key) {
  return async () => {
    await api(`/api/admin/tutorials/${currentTutId}/intro`, { method: 'PUT', body: JSON.stringify({ [key]: $('#' + kind).value }) });
    loadAll();
  };
}
function approve(field) {
  return async () => {
    try { await api(`/api/admin/tutorials/${currentTutId}/approve`, { method: 'POST', body: JSON.stringify({ field, approved: true }) }); }
    catch (e) { alert(e.body?.message || e.message); }
    loadAll();
  };
}

function renderStepCard(t, s) {
  const d = draftOf(s);
  const card = document.createElement('div');
  card.className = 'step-card';
  card.draggable = true;
  card.dataset.id = s.id;
  const latest = s.versions.length ? s.versions[s.versions.length - 1].version : 0;
  card.innerHTML = `
    <div class="mini">☰ 排序：${s.order} ｜ ID:${s.id} ${s.retired ? '｜已退役' : ''} ${s.draft ? '｜有未发布草稿' : `｜已发布 v${latest}`}</div>
    <input class="f-title" value="${esc(d?.title || '')}" placeholder="步骤标题" style="width:100%;margin:4px 0">
    <textarea class="f-content" placeholder="完整文字（必填；无媒体也须可读）">${esc(d?.content || '')}</textarea>
    <div class="row">
      <label>互斥分支组 <input class="f-group" value="${esc(d?.branchGroup || '')}" size="10"></label>
      <label>汇合
        <select class="f-jointype">
          ${['none', 'any', 'all'].map(ty => `<option value="${ty}" ${d?.join?.type === ty ? 'selected' : ''}>${ty}</option>`).join('')}
        </select>
      </label>
      <input class="f-joinsrc" value="${esc((d?.join?.sources || []).join(','))}" placeholder="汇合来源id,逗号分隔" size="22">
    </div>
    <div class="row">
      <label>必需前置 <input class="f-preq" value="${esc((d?.prerequisites || []).filter(p => p.mode === 'required').map(p => p.stepId).join(','))}" size="18"></label>
      <label>可选前置 <input class="f-pop" value="${esc((d?.prerequisites || []).filter(p => p.mode === 'optional').map(p => p.stepId).join(','))}" size="18"></label>
      <label>互斥分支(对方id) <input class="f-branches" value="${esc((d?.branches || []).map(b => b.stepId).join(','))}" size="18"></label>
    </div>
    <div class="row">
      <label>材料
        <select class="f-mats" multiple size="3" style="min-width:200px">
          ${mats.filter(m => !m.deletedAt).map(m => `<option value="${m.id}" ${(d?.requiredMaterials || []).includes(m.id) ? 'selected' : ''}>${esc(m.name)}${m.approved ? '' : '(待审)'}</option>`).join('')}
        </select>
      </label>
      <label>媒体
        <select class="f-media" size="3" style="min-width:180px">
          <option value="">（无）</option>
          ${mds.map(m => `<option value="${m.id}">${esc(m.title)}</option>`).join('')}
        </select>
      </label>
      <label>钉用字幕版 <input class="f-capver" type="number" min="1" placeholder="v" style="width:60px"></label>
      <button class="btn f-pinmedia" type="button">钉用媒体并填替代</button>
    </div>
    <textarea class="f-alt" placeholder="媒体文字替代（媒体不可用/字幕撤版/授权撤销时必须）">${esc((d?.media || [])[0]?.altText || '')}</textarea>
    <div class="row">
      <label>变更类型
        <select class="f-change">
          <option value="edit">普通修订（勾选可沿用）</option>
          <option value="split">拆分（新步骤须重读）</option>
          <option value="merge">合并（旧勾选不可自动认定）</option>
        </select>
      </label>
      <label>合并来源id <input class="f-derived" value="${esc((d?.derivedFrom || []).join(','))}" size="16"></label>
      <label>合并后退役来源 <input class="f-retire" value="${esc((d?.retireSources || []).join(','))}" size="16"></label>
    </div>
    <div class="row">
      <button class="btn btn-primary f-save" type="button">保存草稿</button>
      <button class="btn f-ann" type="button">加注释</button>
      ${s.draft ? '<button class="btn f-revert" type="button">放弃本草稿（回滚分叉）</button>' : ''}
    </div>
  `;

  const setPre = () =>
    [...card.querySelectorAll('.f-preq')][0].value.split(',').map(x => x.trim()).filter(Boolean).map(stepId => ({ stepId, mode: 'required' }))
      .concat(card.querySelector('.f-pop').value.split(',').map(x => x.trim()).filter(Boolean).map(stepId => ({ stepId, mode: 'optional' })));

  card.querySelector('.f-save').onclick = async () => {
    const body = {
      title: card.querySelector('.f-title').value,
      content: card.querySelector('.f-content').value,
      branchGroup: card.querySelector('.f-group').value || null,
      join: { type: card.querySelector('.f-jointype').value,
              sources: card.querySelector('.f-joinsrc').value.split(',').map(x => x.trim()).filter(Boolean) },
      prerequisites: setPre(),
      branches: card.querySelector('.f-branches').value.split(',').map(x => x.trim()).filter(Boolean).map(stepId => ({ stepId, kind: 'alternative' })),
      requiredMaterials: [...card.querySelector('.f-mats').selectedOptions].map(o => o.value),
      changeType: card.querySelector('.f-change').value,
      derivedFrom: card.querySelector('.f-derived').value.split(',').map(x => x.trim()).filter(Boolean),
      retireSources: card.querySelector('.f-retire').value.split(',').map(x => x.trim()).filter(Boolean)
    };
    // 保留已有媒体钉用（媒体在单独控件处理）
    if (d?.media?.length) body.media = d.media.map(m => ({ ...m, altText: card.querySelector('.f-alt').value || m.altText }));
    else if (card.querySelector('.f-alt').value) body.media = [];
    const r = await api(`/api/admin/tutorials/${t.id}/steps/${s.id}/draft`, { method: 'PUT', body: JSON.stringify(body) });
    const bad = r.graphCheck.issues.filter(i => i.stepId === s.id);
    alert(bad.length ? '已保存，但本步骤存在问题：\n' + bad.map(i => `[${i.code}] ${i.message}`).join('\n') : '草稿已保存');
    loadAll();
  };
  card.querySelector('.f-pinmedia').onclick = async () => {
    const mediaId = card.querySelector('.f-media').value;
    const captionVersion = Number(card.querySelector('.f-capver').value) || 1;
    const altText = card.querySelector('.f-alt').value;
    if (!mediaId) return alert('请选择媒体');
    await api(`/api/admin/tutorials/${t.id}/steps/${s.id}/media-pin`, { method: 'PUT', body: JSON.stringify({ mediaId, captionVersion, altText }) });
    loadAll();
  };
  card.querySelector('.f-ann').onclick = async () => {
    const text = prompt('注释内容（保存后需审核才对访客可见）');
    if (!text) return;
    await api(`/api/tutorials/${t.id}/annotations`, { method: 'POST', body: JSON.stringify({ stepId: s.id, text }) });
    alert('注释已保存为待审');
    loadAll();
  };
  const rev = card.querySelector('.f-revert');
  if (rev) rev.onclick = async () => {
    await api(`/api/admin/tutorials/${t.id}/rollback-fork`, { method: 'POST', body: JSON.stringify({ stepIds: [s.id] }) });
    loadAll();
  };
  return card;
}

function enableDnD(list) {
  let dragEl = null;
  list.addEventListener('dragstart', e => { dragEl = e.target.closest('.step-card'); dragEl.classList.add('dragging'); });
  list.addEventListener('dragend', async () => {
    if (!dragEl) return;
    dragEl.classList.remove('dragging');
    const orders = [...list.querySelectorAll('.step-card')].map((el, i) => ({ id: el.dataset.id, order: i + 1 }));
    try {
      await api(`/api/admin/tutorials/${currentTutId}/steps/order`, { method: 'PUT', body: JSON.stringify({ orders }) });
    } catch (e) { alert(e.message); }
    loadTut();
  });
  list.addEventListener('dragover', e => {
    e.preventDefault();
    const after = getAfter(list, e.clientY);
    if (!dragEl) return;
    after == null ? list.appendChild(dragEl) : list.insertBefore(dragEl, after);
  });
  function getAfter(container, y) {
    const els = [...container.querySelectorAll('.step-card:not(.dragging)')];
    return els.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      return offset < 0 && offset > closest.offset ? { offset, element: child } : closest;
    }, { offset: -Infinity }).element || null;
  }
}

async function renderAnnotations(t) {
  const all = await api(`/api/admin/tutorials/${t.id}/annotations`);
  const panel = $('#annPanel');
  panel.innerHTML = all.annotations.length ? '' : '<p class="kv">暂无注释</p>';
  for (const a of all.annotations) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span class="kv">${esc(a.stepId)} ${a.approved ? '[已审/对外可见]' : '[待审]'}：${esc(a.text)}</span>`;
    if (!a.approved) {
      const b = document.createElement('button');
      b.className = 'btn'; b.type = 'button'; b.textContent = '审核通过';
      b.onclick = async () => { await api(`/api/admin/annotations/${a.id}/approve`, { method: 'POST', body: JSON.stringify({ approved: true }) }); loadAll(); };
      row.appendChild(b);
    }
    panel.appendChild(row);
  }
}

if (KEY) loadAll();
