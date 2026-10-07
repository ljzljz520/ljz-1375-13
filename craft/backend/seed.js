// 种子数据：内容仅包含经审核的工艺介绍与原有风险提示
'use strict';

function seed() {
  const now = '2026-09-01T08:00:00.000Z';
  return {
    seq: 100,
    materials: [
      { id: 'mat-1', name: '牛皮（植鞣）', approved: true, createdAt: now, deletedAt: null },
      { id: 'mat-2', name: '刻刀套装（平刀/斜刀/铳子）', approved: true, createdAt: now, deletedAt: null },
      { id: 'mat-3', name: '颜料（矿物/植物）', approved: true, createdAt: now, deletedAt: null },
      { id: 'mat-4', name: '待审胶水', approved: false, createdAt: now, deletedAt: null }
    ],
    media: [
      {
        id: 'vid-1', type: 'video', title: '选皮与潮皮演示', available: true,
        licenseRevoked: false, captions: [
          { version: 3, text: '字幕 v3：选皮看厚度均匀，潮皮忌积水。', withdrawn: false },
          { version: 2, text: '字幕 v2（旧版）。', withdrawn: false }
        ]
      },
      {
        id: 'vid-2', type: 'video', title: '刀法演示（备用）', available: false,
        licenseRevoked: false, captions: [{ version: 1, text: '刀法演示字幕。', withdrawn: false }]
      },
      {
        id: 'vid-3', type: 'video', title: '旧版授权演示（授权已撤销）', available: true,
        licenseRevoked: true, captions: [{ version: 1, text: '旧字幕。', withdrawn: false }]
      }
    ],
    annotations: [
      { id: 'ann-1', stepId: 'stp-3', text: '编者注：传统艺人潮皮时长依季节调整。', approved: true, createdAt: now }
    ],
    tutorials: [
      {
        id: 'tu-1',
        title: '皮影雕刻技艺（示例工艺）',
        intro: '皮影雕刻是以牛皮为胎，经潮皮、过稿、镂刻、敷彩、发汗熨平、装订联缀而成的民间工艺。本页仅作文化介绍。',
        riskNotice: '刀具锋利、烫熨高温，存在割伤与烫伤风险；本专题不构成任何操作资格认定，阅读确认仅表示已阅读。',
        introApproved: true, riskApproved: true,
        publishMode: 'stepwise',
        currentReleaseId: 'rel-1',
        createdAt: now,
        releases: [
          {
            id: 'rel-1', createdAt: now, mode: 'stepwise', label: '2026-09 初版',
            steps: [
              { stepId: 'stp-1', version: 1 },
              { stepId: 'stp-2', version: 1 },
              { stepId: 'stp-3', version: 1 },
              { stepId: 'stp-4a', version: 1 },
              { stepId: 'stp-4b', version: 1 },
              { stepId: 'stp-5', version: 1 },
              { stepId: 'stp-6', version: 1 }
            ]
          }
        ],
        steps: [
          {
            id: 'stp-1', order: 1, retired: false,
            draft: null,
            versions: [{
              version: 1, publishedIn: 'rel-1',
              title: '选皮与潮皮',
              content: '选用厚薄均匀的植鞣牛皮，以湿布回潮使其柔韧。全程均有完整文字说明，视频仅为辅助。',
              requiredMaterials: ['mat-1'],
              prerequisites: [], branches: [], branchGroup: null,
              join: { type: 'none', sources: [] },
              media: [{ mediaId: 'vid-1', captionVersion: 3, altText: '文字替代：选皮看厚度均匀；潮皮以布覆皮，忌积水。' }],
              createdAt: now
            }]
          },
          {
            id: 'stp-2', order: 2, retired: false, draft: null,
            versions: [{
              version: 1, publishedIn: 'rel-1',
              title: '过稿',
              content: '将人物图谱以针孔或墨线拓于皮面，确定镂刻轮廓。',
              requiredMaterials: ['mat-1'],
              prerequisites: [{ stepId: 'stp-1', mode: 'required' }], branches: [], branchGroup: null,
              join: { type: 'none', sources: [] }, media: [],
              createdAt: now
            }]
          },
          {
            id: 'stp-3', order: 3, retired: false, draft: null,
            versions: [{
              version: 1, publishedIn: 'rel-1',
              title: '镂刻',
              content: '用平刀、斜刀与铳子镂刻。刀走垂直，先内后外，先繁后简。',
              requiredMaterials: ['mat-2'],
              prerequisites: [{ stepId: 'stp-2', mode: 'required' }], branches: [], branchGroup: null,
              join: { type: 'none', sources: [] }, media: [],
              createdAt: now
            }]
          },
          // 可选分支：A 传统矿物颜料 / B 现代水色，互斥同组 color-choice
          {
            id: 'stp-4a', order: 4, retired: false, draft: null,
            versions: [{
              version: 1, publishedIn: 'rel-1',
              title: '敷彩（分支A：矿物颜料）',
              content: '以传统矿物颜料逐层上色，色调沉着。',
              requiredMaterials: ['mat-3'],
              prerequisites: [{ stepId: 'stp-3', mode: 'required' }],
              branches: [{ stepId: 'stp-4b', kind: 'alternative' }],
              branchGroup: 'color-choice',
              join: { type: 'none', sources: [] }, media: [],
              createdAt: now
            }]
          },
          {
            id: 'stp-4b', order: 4, retired: false, draft: null,
            versions: [{
              version: 1, publishedIn: 'rel-1',
              title: '敷彩（分支B：现代水色）',
              content: '以现代水色上色，操作简便、色泽明快。',
              requiredMaterials: ['mat-3'],
              prerequisites: [{ stepId: 'stp-3', mode: 'required' }],
              branches: [{ stepId: 'stp-4a', kind: 'alternative' }],
              branchGroup: 'color-choice',
              join: { type: 'none', sources: [] }, media: [],
              createdAt: now
            }]
          },
          {
            // 汇合条件：A 或 B 任一完成即可
            id: 'stp-5', order: 5, retired: false, draft: null,
            versions: [{
              version: 1, publishedIn: 'rel-1',
              title: '发汗熨平（汇合）',
              content: '敷彩后以适度温度发汗熨平，使色固、皮平。注意防烫。',
              requiredMaterials: [],
              prerequisites: [
                { stepId: 'stp-4a', mode: 'optional' },
                { stepId: 'stp-4b', mode: 'optional' }
              ],
              branches: [], branchGroup: null,
              join: { type: 'any', sources: ['stp-4a', 'stp-4b'] },
              media: [
                // 已绑定但当前不可用的视频：发布时必须有明确文字替代
                { mediaId: 'vid-2', captionVersion: 1, altText: '文字替代：隔布熨压，温度以手背可耐受为度，缓慢移动防烫。' }
              ],
              createdAt: now
            }]
          },
          {
            id: 'stp-6', order: 6, retired: false, draft: null,
            versions: [{
              version: 1, publishedIn: 'rel-1',
              title: '装订联缀',
              content: '将分头、胸腹、四肢以线联缀，装上操纵杆，制成影人。',
              requiredMaterials: [],
              prerequisites: [
                { stepId: 'stp-5', mode: 'required' },
                { stepId: 'stp-4a', mode: 'optional' },
                { stepId: 'stp-4b', mode: 'optional' }
              ],
              branches: [], branchGroup: null,
              join: { type: 'all', sources: ['stp-5'] },
              media: [],
              createdAt: now
            }]
          }
        ]
      },
      // 冻结模式示例教程（已整体冻结发布）
      {
        id: 'tu-2',
        title: '皮影装订工艺（冻结版示例）',
        intro: '介绍影人的联缀装配工艺，本教程为整体冻结发布示例。',
        riskNotice: '签刺与细线收束存在刺伤风险；阅读不等于获得操作资格。',
        introApproved: true, riskApproved: true,
        publishMode: 'frozen',
        currentReleaseId: 'rel-1',
        createdAt: now,
        releases: [
          {
            id: 'rel-1', createdAt: now, mode: 'frozen', label: '冻结初版',
            steps: [
              { stepId: 's2-1', version: 1 },
              { stepId: 's2-2', version: 1 }
            ]
          }
        ],
        steps: [
          {
            id: 's2-1', order: 1, retired: false, draft: null,
            versions: [{
              version: 1, publishedIn: 'rel-1', title: '分部对齐',
              content: '将各部件按关节位置对齐，孔位一致。', requiredMaterials: [],
              prerequisites: [], branches: [], branchGroup: null,
              join: { type: 'none', sources: [] }, media: [], createdAt: now
            }]
          },
          {
            id: 's2-2', order: 2, retired: false, draft: null,
            versions: [{
              version: 1, publishedIn: 'rel-1', title: '穿线联缀',
              content: '以线穿孔联缀，松紧适度，保留活动余量。', requiredMaterials: [],
              prerequisites: [{ stepId: 's2-1', mode: 'required' }], branches: [], branchGroup: null,
              join: { type: 'none', sources: [] }, media: [], createdAt: now
            }]
          }
        ]
      }
    ],
    learners: [
      // 预置一个进度示例
      {
        id: 'lrn-demo', name: '访客示例', createdAt: now,
        progress: {
          'tu-1': {
            mode: 'stepwise',
            frozen: null,
            confirmations: { 'stp-1': { stepVersion: 1, at: now, releaseId: 'rel-1' } }
          }
        }
      }
    ]
  };
}

module.exports = { seed };
