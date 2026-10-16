// Прогон движка в консоли: node test/analyze.mjs <match_id> [...]
// Нужен запущенный сервер (npm start) — данные берутся через его кэш.
import { analyzeMatch, fmtTime } from '../public/analyzer.js';

const BASE = process.env.BASE || 'http://localhost:4777';
const ids = process.argv.slice(2);
if (!ids.length) { console.error('Укажи id матча: node test/analyze.mjs 9042363501'); process.exit(1); }

const consts = await (await fetch(`${BASE}/api/constants`)).json();
for (const id of ids) {
  const res = await fetch(`${BASE}/api/match/${id}`);
  const m = await res.json();
  if (!res.ok) { console.log(id, 'ошибка:', m.error); continue; }
  const a = analyzeMatch(m, consts);
  console.log(`\n=== ${id} | ${fmtTime(a.meta.duration)} | ${a.meta.radiantWin ? 'Radiant' : 'Dire'} win | parsed=${a.meta.parsed} turbo=${a.meta.turbo}`);
  for (const team of ['radiant', 'dire']) {
    const v = a.verdicts[team];
    console.log(`\n[${team}] ${v.title}\n   ${v.text}`);
    for (const p of [...a.teams[team]].sort((x, y) => x.pos - y.pos)) {
      const comps = p.components.map((c) => `${c.id}:${Math.round(c.score)}`).join(' ');
      console.log(`  pos${p.pos}${p.raw.position_est ? `(od${p.raw.position_est})` : ''} ${p.hero.dname.padEnd(18)} ${String(p.kills).padStart(2)}/${String(p.deaths).padStart(2)}/${String(p.assists).padStart(2)} nw ${String(p.nw).padStart(6)} RUIN ${String(p.ruin).padStart(3)} ${p.tier.label.padEnd(13)} blame ${Math.round(p.blame * 100)}% | ${comps}`);
      if (process.env.V) {
        p.reasons.slice(0, 4).forEach((r) => console.log(`       - (+${r.pts.toFixed(1)}) ${r.text}`));
        p.pros.slice(0, 2).forEach((r) => console.log(`       + (${r.pts.toFixed(1)}) ${r.text}`));
      }
    }
  }
  console.log('\nИстория:'); a.story.forEach((s) => console.log('  ', s));
  console.log('Линии:', a.lanes.map((l) => `${l.name}: ${l.winner} (${Math.round(l.diff)})`).join(' | '));
  console.log('Событий:', a.events.length, 'ключевых:', a.events.filter((e) => e.key).map((e) => fmtTime(e.t)).join(', '));
}
