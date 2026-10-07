let state = null;
let draft = null;
const $ = (s) => document.querySelector(s);
const esc = (v = '') => String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const headers = () => ({ 'x-admin-key': $('#adminKey').value, 'content-type': 'application/json' });
function msg(t, ok = true) { const el = $('#message'); el.className = ok ? 'notice success' : 'notice error'; el.textContent = t; }
async function call(path, options = {}) {
  const res = await fetch(path, { ...options, headers: headers(), body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error([data.error, ...(data.errors || [])].filter(Boolean).join('；')), { data });
  return data;
}

async function loadState() {
  try {
    state = await call('/api/admin/state');
    const craftId = state.crafts[0]?.id || 'craft_shadow';
    const draftData = await call(`/api/admin/crafts/${craftId}/draft`);
    draft = draftData.draft;
    renderAll(craftId);
    msg('数据已载入。');
  } catch (e) { msg(e.message, false); }
}
function renderAll(craftId) {
  $('#baseVersionId').value = draft.baseVersionId;
  $('#draftTitle').value = draft.title; $('#draftSummary').value = draft.summary; $('#draftContent').value = draft.content;
  $('#draftApproved').checked = draft.reviewStatus === 'approved'; $('#reviewNote').value = draft.reviewNote || '';
  $('#riskNotice').innerHTML = state.riskNotices.map((r) => `<option value="${esc(r.id)}" ${draft.riskNoticeId === r.id ? 'selected' : ''}>${esc(r.id)}：${esc(r.text.slice(0, 24))}…</option>`).join('');
  renderSteps(); renderMaterials(); renderMedia(); renderAnnotations(); renderVersions(craftId);
}

function stepMediaOptions(step) {
  return `<option value="">不使用媒体，使用明确文字替代</option>` + state.media.map((m) => `<option value="${esc(m.id)}" ${step.mediaRequirement?.mediaId === m.id ? 'selected' : ''}>${esc(m.title)}（${m.type}，${m.available && m.licenseActive ? '可用' : '不可用'}）</option>`).join('');
}
function renderSteps() {
  $('#stepEditor').innerHTML = draft.steps.map((step, index) => `<fieldset class="editor-step" draggable="true" data-index="${index}">
    <legend class="drag-handle" tabindex="0"><span>拖动手柄：${esc(step.title || step.key || '新步骤')}（拖动不改依赖）</span><span><button type="button" class="secondary" onclick="moveStep(${index},-1)">上移</button><button type="button" class="secondary" onclick="moveStep(${index},1)">下移</button><button type="button" class="danger" onclick="removeStep(${index})">删除</button></span></legend>
    <div class="editor-step-body">
      <div class="field-row"><label>稳定 key<input data-f="key" value="${esc(step.key)}"></label><label>标题<input data-f="title" value="${esc(step.title)}"></label><label class="checkline"><input type="checkbox" data-f="optional" ${step.optional ? 'checked' : ''}> 可选分支步骤</label><label>分支组<input data-f="branchGroup" value="${esc(step.branchGroup || '')}" placeholder="如 border"></label></div>
      <label>完整步骤文字<textarea data-f="text">${esc(step.text)}</textarea></label>
      <label>操作说明<textarea data-f="instructions">${esc(step.instructions || '')}</textarea></label>
      <div class="field-row"><label>前置步骤 key（逗号分隔）<input data-f="prerequisites" value="${esc((step.prerequisites || []).map((p) => p.stepKey).join(','))}"></label><label>汇合操作符<select data-f="mergeOperator"><option value="">非汇合</option><option value="and" ${step.merge?.operator === 'and' ? 'selected' : ''}>and 全部分支</option><option value="or" ${step.merge?.operator === 'or' ? 'selected' : ''}>or 任一分支</option></select></label><label>汇合分支组<input data-f="mergeGroup" value="${esc(step.merge?.branchGroup || '')}"></label><label>汇合分支 key<input data-f="mergeBranches" value="${esc((step.merge?.branches || []).join(','))}"></label></div>
      <label>汇合判定说明<input data-f="mergePolicy" value="${esc(step.merge?.policyText || '')}"></label>
      <fieldset><legend>必需材料（服务端检查是否存在且 active）</legend>${state.materials.map((m) => { const ref = (step.materials || []).find((x) => x.materialId === m.id); return `<label class="checkline"><input type="checkbox" data-f="mat" value="${esc(m.id)}" ${ref ? 'checked' : ''}> ${esc(m.name)}（${esc(m.status)}）</label>`; }).join('')}</fieldset>
      <div class="field-row"><label>媒体<select data-f="mediaId">${stepMediaOptions(step)}</select></label><label>字幕语言（音视频）<input data-f="captionLang" value="${esc(step.mediaRequirement?.captionLang || 'zh')}"></label><label>锁定字幕版本（整数）<input type="number" data-f="captionVersion" value="${esc(step.mediaRequirement?.captionVersion || '')}"></label><label class="checkline"><input type="checkbox" data-f="approved" ${step.reviewStatus === 'approved' ? 'checked' : ''}> 已审核</label></div>
      <label>无媒体时的明确替代方案<textarea data-f="alternativeText">${esc(step.alternativeText || '')}</textarea></label>
    </div>
  </fieldset>`).join('');
  bindDrag();
}

function collectDraft() {
  const steps = [...document.querySelectorAll('.editor-step')].map((card) => {
    const f = (name) => card.querySelector(`[data-f="${name}"]`);
    const mediaId = f('mediaId').value;
    const mergeOperator = f('mergeOperator').value;
    return {
      key: f('key').value, title: f('title').value, text: f('text').value, instructions: f('instructions').value,
      optional: f('optional').checked, branchGroup: f('branchGroup').value || null,
      prerequisites: f('prerequisites').value.split(',').map((x) => x.trim()).filter(Boolean).map((stepKey) => ({ stepKey })),
      merge: mergeOperator ? { branchGroup: f('mergeGroup').value, operator: mergeOperator, branches: f('mergeBranches').value.split(',').map((x) => x.trim()).filter(Boolean), policyText: f('mergePolicy').value } : null,
      materials: [...card.querySelectorAll('[data-f="mat"]:checked')].map((x) => ({ materialId: x.value, required: true })),
      mediaRequirement: mediaId ? { mediaId, captionLang: f('captionLang').value || null, captionVersion: Number(f('captionVersion').value) || null } : null,
      alternativeText: f('alternativeText').value, reviewStatus: f('approved').checked ? 'approved' : 'draft'
    };
  });
  return {
    title: $('#draftTitle').value, summary: $('#draftSummary').value, content: $('#draftContent').value,
    reviewStatus: $('#draftApproved').checked ? 'approved' : 'draft', reviewNote: $('#reviewNote').value,
    riskNoticeId: $('#riskNotice').value, baseVersionId: $('#baseVersionId').value, steps
  };
}
async function saveDraft(publish) {
  try {
    const craftId = state.crafts[0].id;
    const payload = collectDraft();
    let saved;
    try {
      saved = await call(`/api/admin/crafts/${craftId}/draft`, { method: 'PUT', body: payload });
    } catch (err) {
      draft = err.data.submittedDraft || draft;
      renderSteps();
      const errors = err.data.validation?.errors || err.data.errors || [err.message];
      return msg('草稿未通过服务端校验，尚未保存为可发布草稿：' + errors.join('；'), false);
    }
    draft = saved.draft;
    if (!publish) return msg('草稿已保存；依赖图和发布规则校验通过。');
    const result = await call(`/api/admin/crafts/${craftId}/publish`, { method: 'POST', body: { mode: $('#publishMode').value } });
    msg(`已发布 ${result.version.version}。${result.migrationPolicy}`);
    await loadState();
  } catch (e) { msg(e.message, false); }
}
function addStep(){ draft.steps.push({ key:'new_step_'+Date.now(), title:'新步骤', text:'请填写不少于二十个字的完整步骤文字。', instructions:'', optional:false, branchGroup:null, prerequisites:[], merge:null, materials:[], mediaRequirement:null, alternativeText:'', reviewStatus:'draft' }); renderSteps(); }
function removeStep(i){ draft.steps.splice(i,1); renderSteps(); }
function moveStep(i, dir){ const j=i+dir; if(j<0||j>=draft.steps.length)return; const values=collectDraft().steps; [values[i],values[j]]=[values[j],values[i]]; draft.steps=values; renderSteps(); }
function bindDrag(){ const list=[...document.querySelectorAll('.editor-step')]; let dragged=null; list.forEach((el)=>{ el.addEventListener('dragstart',()=>{dragged=el;el.classList.add('dragging')}); el.addEventListener('dragend',()=>{el.classList.remove('dragging')}); el.addEventListener('dragover',(e)=>e.preventDefault()); el.addEventListener('drop',(e)=>{e.preventDefault(); if(!dragged||dragged===el)return; const values=collectDraft().steps; const from=Number(dragged.dataset.index), to=Number(el.dataset.index); const [item]=values.splice(from,1); values.splice(to,0,item); draft.steps=values; renderSteps();}); el.querySelector('.drag-handle').addEventListener('keydown',(e)=>{ if(e.altKey&&e.key==='ArrowDown'){moveStep(Number(el.dataset.index),1)} if(e.altKey&&e.key==='ArrowUp'){moveStep(Number(el.dataset.index),-1)} }); }); }

function renderMaterials(){ $('#materialList').innerHTML = state.materials.map((m)=>`<article class="item"><h3>${esc(m.name)}</h3><p>${esc(m.description)}</p><p><span class="badge ${m.status==='active'?'ok':'warn'}">${esc(m.status)}</span><span class="mono">${esc(m.id)}</span></p><div class="item-actions"><button class="secondary" onclick="toggleMaterial('${esc(m.id)}','${m.status==='active'?'obsolete':'active'}')">${m.status==='active'?'停用':'恢复'}</button><button class="danger" onclick="deleteMaterial('${esc(m.id)}')">尝试删除（引用时拒绝）</button></div></article>`).join(''); }
$('#materialForm').addEventListener('submit', async (e)=>{e.preventDefault(); try{ await call('/api/admin/materials',{method:'POST',body:{name:$('#matName').value,description:$('#matDesc').value}}); $('#matName').value=''; $('#matDesc').value=''; await loadState(); }catch(err){msg(err.message,false)}});
window.toggleMaterial=async(id,status)=>{try{await call(`/api/admin/materials/${id}`,{method:'PATCH',body:{status}});await loadState()}catch(e){msg(e.message,false)}};
window.deleteMaterial=async(id)=>{try{await call(`/api/admin/materials/${id}`,{method:'DELETE',body:{}});msg('已删除未引用材料。');await loadState()}catch(e){msg(e.message,false)}};

function renderMedia(){ $('#mediaList').innerHTML=state.media.map((m)=>`<article class="item"><h3>${esc(m.title)}</h3><p class="mono">${esc(m.id)} · ${esc(m.type)} · ${esc(m.url)}</p><p>${esc(m.textAlternative)}</p><p><span class="badge ${m.available?'ok':'danger'}">${m.available?'可用':'不可用'}</span><span class="badge ${m.licenseActive?'ok':'danger'}">${m.licenseActive?'授权有效':'授权撤销'}</span><span class="badge ${m.reviewStatus==='approved'?'ok':'warn'}">${esc(m.reviewStatus)}</span></p>${Object.values(m.captions||{}).map(c=>`<p class="meta">字幕 ${esc(c.lang)} v${c.version}：${esc(c.text.slice(0,60))}</p>`).join('')}<div class="field-row"><input id="cap-${esc(m.id)}" placeholder="新版中文字幕/口播文本"><button class="secondary" onclick="newCaption('${esc(m.id)}')">字幕换版（历史锁定，新版需重选）</button></div><div class="item-actions"><button class="secondary" onclick="patchMedia('${esc(m.id)}',{available:${!m.available}})">标记${m.available?'不可用':'可用'}</button><button class="secondary" onclick="patchMedia('${esc(m.id)}',{licenseActive:${!m.licenseActive}})">${m.licenseActive?'撤销':'恢复'}授权</button><button class="danger" onclick="deleteMedia('${esc(m.id)}')">尝试删除</button></div></article>`).join(''); }
$('#mediaForm').addEventListener('submit',async e=>{e.preventDefault(); try{await call('/api/admin/media',{method:'POST',body:{title:$('#medTitle').value,type:$('#medType').value,url:$('#medUrl').value,altText:$('#medAlt').value,textAlternative:$('#medTextAlt').value,available:$('#medAvailable').checked,licenseActive:$('#medLicense').checked,reviewStatus:$('#medApproved').checked?'approved':'draft'}});await loadState()}catch(err){msg(err.message,false)}});
window.patchMedia=async(id,patch)=>{try{await call(`/api/admin/media/${id}`,{method:'PATCH',body:patch});await loadState()}catch(e){msg(e.message,false)}};
window.newCaption=async(id)=>{const text=$(`#cap-${id}`).value; if(!text)return msg('请填写新版字幕文本',false); try{const r=await call(`/api/admin/media/${id}/captions/zh`,{method:'PUT',body:{label:'中文',text}});msg(r.warning);await loadState()}catch(e){msg(e.message,false)}};
window.deleteMedia=async id=>{try{await call(`/api/admin/media/${id}`,{method:'DELETE',body:{}});await loadState()}catch(e){msg(e.message,false)}};

function renderAnnotations(){ $('#annotationList').innerHTML=state.annotations.map(a=>`<article class="item"><h3>${esc(a.targetType)}：${esc(a.targetKey)}</h3><p>${esc(a.body)}</p><p><span class="badge ${a.reviewStatus==='approved'?'ok':'warn'}">${esc(a.reviewStatus)}</span></p><div class="item-actions"><button class="secondary" onclick="setAnnotation('${esc(a.id)}','approved')">审核通过</button><button class="danger" onclick="setAnnotation('${esc(a.id)}','rejected')">驳回</button></div></article>`).join(''); }
$('#annotationForm').addEventListener('submit',async e=>{e.preventDefault();try{await call('/api/admin/annotations',{method:'POST',body:{targetType:$('#annType').value,targetKey:$('#annTarget').value,body:$('#annBody').value}});$('#annBody').value='';await loadState()}catch(err){msg(err.message,false)}});
window.setAnnotation=async(id,reviewStatus)=>{try{await call(`/api/admin/annotations/${id}`,{method:'PATCH',body:{reviewStatus}});await loadState()}catch(e){msg(e.message,false)}};
function renderVersions(craftId){ $('#versionList').innerHTML=state.versions.filter(v=>v.craftId===craftId).map(v=>`<article class="item"><h3>${esc(v.version)} <span class="badge ${v.mode==='stepwise'?'ok':'warn'}">${v.mode==='stepwise'?'按步骤升级':'整个教程冻结'}</span></h3><p class="mono">${esc(v.versionId)}</p><p class="meta">${new Date(v.publishedAt).toLocaleString('zh-CN')}；步骤：${v.steps.map(s=>esc(s.stepVersionId)).join('，')}</p><button class="secondary" onclick="rollback('${esc(v.versionId)}')">从历史版本分叉到草稿（重新校验授权）</button></article>`).join(''); }
window.rollback=async(versionId)=>{try{const r=await call(`/api/admin/crafts/${state.crafts[0].id}/rollback`,{method:'POST',body:{versionId}});msg(r.warning+' 校验：'+r.validation.errors.join('；'),false);await loadState()}catch(e){msg(e.message,false)}};
loadState();
