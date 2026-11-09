// med.js <csv>: medians per config of bench3.js output
const rows = require('fs').readFileSync(process.argv[2], 'utf8').trim().split('\n').filter((l) => /^\S+,\d/.test(l)).map((l) => l.split(','));
const g = {}; rows.forEach((r) => { (g[r[0]] = g[r[0]] || []).push(r.slice(2).map(Number)); });
const med = (a) => { a = [...a].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
console.log('config'.padEnd(28) + 'fps  drop%  stalls  stall ms  worst  busy ms  (n)');
for (const k in g) { const c = g[k]; console.log(k.padEnd(28) + [0, 1, 2, 3, 4, 5].map((i) => String(med(c.map((r) => r[i])) ?? '').padEnd(i === 0 ? 5 : i === 1 ? 7 : i === 2 ? 8 : i === 3 ? 10 : i === 4 ? 7 : 9)).join('') + '(' + c.length + ')'); }
