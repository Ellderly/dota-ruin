// Прогон разбора на множестве реальных матчей, чтобы найти падения: node test/fuzz.mjs [сколько]
import { createBackend } from '../public/opendota.js';
import { analyzeMatch } from '../public/analyzer.js';
import { analyzeItems } from '../public/items.js';
import { analyzePro } from '../public/probuild.js';

const mem = new Map();
const store = { get: async (k) => mem.get(k) ?? null, set: async (k, v) => { mem.set(k, v); }, del: async (k) => { mem.delete(k); } };
const backend = createBackend({ store });
const call = async (p) => { const [route, q = ''] = p.split('?'); const r = await backend.handle('GET', route, new URLSearchParams(q)); if (r.status >= 400) throw new Error(`${p}: ${r.body?.error}`); return r.body; };
const od = async (p) => {
  for (let i = 0; i < 6; i++) {
    const body = await (await fetch(`https://api.opendota.com/api/${p}`)).json().catch(() => null);
    if (Array.isArray(body)) return body;
    await new Promise((r) => setTimeout(r, 15000)); // лимит запросов — ждём и повторяем
  }
  return [];
};

const N = Number(process.argv[2]) || 30;
const [pub, pro, parsed] = await Promise.all([od('publicMatches'), od('proMatches'), od('parsedMatches')]);
const ids = [...new Set([
  ...parsed.slice(0, N).map((x) => x.match_id),
  ...pro.slice(0, Math.ceil(N / 3)).map((x) => x.match_id),
  ...pub.filter((x) => x.duration > 600).slice(0, Math.ceil(N / 3)).map((x) => x.match_id),
])];
const consts = await call('constants');
let ok = 0, skipped = 0; const fails = new Map();
for (const id of ids) {
  try {
    const m = await call(`match/${id}`);
    const base = analyzeMatch(m, consts);
    const heroData = await call(`hero-items?ids=${base.players.map((p) => p.hero.id).join(',')}`);
    const enemyIds = (p) => base.teams[p.isRadiant ? 'dire' : 'radiant'].map((e) => e.hero.id).join(',');
    const proData = await call(`pro-build?heroes=${base.players.map((p) => `${p.hero.id}${p.pos <= 3 ? 'c' : 's'}:${enemyIds(p)}`).join(';')}`);
    analyzePro(analyzeItems(base, consts, heroData), consts, proData);
    ok++;
  } catch (e) {
    if (/5 на 5|Матч не найден/.test(e.message)) { skipped++; continue; }
    const where = (e.stack || '').split('\n').slice(0, 4).map((l) => l.trim().replace(/file:.*\//, '')).join(' | ');
    const key = `${e.message} @ ${where}`;
    if (!fails.has(key)) fails.set(key, []);
    fails.get(key).push(id);
  }
}
console.log(`матчей: ${ids.length}, ок: ${ok}, пропущено (не 5x5/нет данных): ${skipped}, упало: ${[...fails.values()].flat().length}`);
for (const [k, v] of fails) console.log(`\n${v.length}× ${k}\n   матчи: ${v.slice(0, 5).join(', ')}`);
