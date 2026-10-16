// Прогон «Что лучше было собрать»: node test/pro.mjs <match_id> [фильтр по герою]
import { analyzeMatch } from '../public/analyzer.js';
import { analyzeItems } from '../public/items.js';
import { analyzePro } from '../public/probuild.js';

const BASE = process.env.BASE || 'http://localhost:4777';
const get = async (p) => (await fetch(BASE + p)).json();
const consts = await get('/api/constants');
const [id, only] = process.argv.slice(2);
const base = analyzeMatch(await get(`/api/match/${id}`), consts);
const heroData = await get(`/api/hero-items?ids=${base.players.map((p) => p.hero.id).join(',')}`);
const enemyIds = (p) => base.teams[p.isRadiant ? 'dire' : 'radiant'].map((e) => e.hero.id).join(',');
const t0 = Date.now();
const proData = await get(`/api/pro-build?heroes=${base.players.map((p) => `${p.hero.id}${p.pos <= 3 ? 'c' : 's'}:${enemyIds(p)}`).join(';')}`);
console.log(`про-данные: ${Date.now() - t0} мс`);
const a = analyzePro(analyzeItems(base, consts, heroData), consts, proData);
for (const p of a.players) {
  if (only && !p.hero.dname.includes(only)) continue;
  console.log(`\n${p.hero.dname} pos${p.pos} | про-игр ${p.pro.n} | ${p.pro.core.map((c) => `${c.name}${c.has ? '✓' : ''}`).join(' → ')}`);
  p.pro.lines.forEach((l) => console.log(`   ${l.important ? '!' : '•'} ${l.text}`));
  p.build.threats.filter((t) => t.id === 'heal').forEach((t) => console.log(`   [heal:${t.status}] ${t.text}`));
}
