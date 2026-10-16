// Прогон разбора предметов в консоли: node test/items.mjs <match_id> [hero name filter]
import { analyzeMatch } from '../public/analyzer.js';
import { analyzeItems } from '../public/items.js';

const BASE = process.env.BASE || 'http://localhost:4777';
const get = async (p) => (await fetch(BASE + p)).json();
const consts = await get('/api/constants');
const [id, only] = process.argv.slice(2);
const base = analyzeMatch(await get(`/api/match/${id}`), consts);
const a = analyzeItems(base, consts, await get(`/api/hero-items?ids=${base.players.map((p) => p.hero.id).join(',')}`));
for (const p of a.players) {
  if (only && !p.hero.dname.includes(only)) continue;
  const b = p.build;
  console.log(`\n${p.hero.dname} pos${p.pos} ruin ${p.ruin} | сборка ${b.score} — ${b.label}\n  ${b.summary}`);
  b.threats.forEach((t) => {
    console.log(`   [${t.status}] ${t.title} (вес ${t.weight.toFixed(1)})\n       ${t.text}`);
    (t.abilities || []).forEach((x) => console.log(`         · ${x.name} (${x.hero}) ×${x.uses} ${x.types.join('/')} ${x.targeted ? 'направл.' : 'площадь'}${x.pierce ? ' сквозь BKB' : ''} -> ${x.by.join(', ') || 'НЕ ЗАКРЫТО'}`));
  });
  console.log('   урон по нему:', b.damageSources.map((x) => `${x.name}${x.hero ? `(${x.hero})` : ''} ${Math.round(x.share * 100)}%`).join(', '));
}
