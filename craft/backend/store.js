// JSON 文件持久化：串行化写入 + 原子替换，保证并发下一致性
'use strict';
const fs = require('fs');
const path = require('path');
const { seed } = require('./seed');

const DB_FILE = process.env.CRAFT_DB || path.join(__dirname, 'data.json');

let cache = null;
let queue = Promise.resolve();

function load() {
  if (cache) return cache;
  if (!fs.existsSync(DB_FILE)) {
    cache = seed();
    flush();
  } else {
    cache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  }
  return cache;
}

function flush() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// 所有写操作串行排队，读已提交；避免并发删除与引用检查之间的竞态
function tx(mutator) {
  const run = queue.then(() => {
    load();
    const result = mutator(cache);
    flush();
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

function read() { return load(); }

function nextId(prefix) {
  const db = load();
  db.seq += 1;
  return `${prefix}-${db.seq}`;
}

module.exports = { read, tx, nextId, DB_FILE };
