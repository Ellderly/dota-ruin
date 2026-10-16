// «Что лучше было собрать»: сравнение сборки игрока с про-сборками этого героя в текущем патче
// (про- и лиговые матчи OpenDota), поправки под пик врагов и разбор Аганима/Шарда по описанию патча.
import { fmtTime } from './analyzer.js';

// Что даёт Аганим или Шард — по тексту описания из текущего патча. Ключи совпадают с id угроз в items.js.
const AGHS_TAGS = [
  ['heal', /health restoration|reduc\w* (their )?heal|heal\w* reduction|cannot heal|prevent\w* heal/i, 'режет восстановление здоровья — это антихил'],
  ['break', /\bbreak\b|disables? (their )?passive/i, 'отключает пассивки'],
  ['invis', /true sight|reveal/i, 'показывает невидимых'],
  ['evasion', /true strike|cannot miss|can't miss/i, 'атаки не промахиваются'],
  ['control', /debuff immunity|spell immunity|magic immunity|strong dispel/i, 'даёт иммунитет или сильный диспел'],
];

export function aghsEffects(consts, heroId) {
  const a = consts.aghs?.[heroId];
  const out = [];
  for (const [kind, key] of [['scepter', 'ultimate_scepter'], ['shard', 'aghanims_shard']]) {
    const d = a?.[kind];
    if (!d?.desc) continue;
    for (const [id, re, ru] of AGHS_TAGS) if (re.test(d.desc)) out.push({ id, key, kind, skill: d.skill, desc: d.desc, ru });
  }
  return out;
}

const BOOT_UPGRADES = ['power_treads', 'phase_boots', 'arcane_boots', 'tranquil_boots', 'travel_boots', 'guardian_greaves', 'boots_of_bearing'];
const SKIP = ['tpscroll', 'ward_observer', 'ward_sentry', 'ward_dispenser', 'dust', 'smoke_of_deceit', 'tango', 'flask', 'clarity', 'faerie_fire', 'enchanted_mango', 'blood_grenade', 'magic_wand', 'magic_stick', 'aghanims_shard', 'ultimate_scepter', 'cheese', 'aegis'];

export function analyzePro(a, consts, proData = {}) {
  const { items } = consts;
  const name = (k) => items[k]?.dname || k;
  const dur = a.meta.duration;
  const big = (k) => items[k] && !SKIP.includes(k) && !k.startsWith('recipe') && (BOOT_UPGRADES.includes(k) || (items[k].created && items[k].cost >= 1000));

  for (const p of a.players) {
    const d = proData[`${p.hero.id}${p.pos <= 3 ? 'c' : 's'}`];
    const enemies = a.teams[p.isRadiant ? 'dire' : 'radiant'];
    const lines = [];
    const effects = aghsEffects(consts, p.hero.id);
    p.pro = { patch: consts.patch?.name || null, n: d?.n || 0, role: p.pos <= 3 ? 'кор' : 'саппорт', core: [], lines, effects, offRole: !!p.offRole };
    if (!d || d.n < 30 || a.meta.turbo) continue; // мало данных, нетипичная роль или турбо — про-сборка неприменима
    const share = (k) => (d.items[k]?.c || 0) / d.n;

    // 1. Стандартная про-сборка: частые предметы по медианному времени, без промежуточных компонентов.
    let core = Object.entries(d.items).filter(([k, x]) => big(k) && x.c / d.n >= 0.3).map(([k, x]) => ({ key: k, share: x.c / d.n, med: x.med, wr: x.w / x.c }));
    core = core.filter((x) => !core.some((y) => y !== x && (items[y.key]?.parts || []).includes(x.key) && y.share >= x.share * 0.7));
    core.sort((x, y) => x.med - y.med);
    p.pro.core = core.slice(0, 8).map((x) => ({ ...x, name: name(x.key), has: p.owned.has(x.key), time: p.owned.get(x.key) ?? null }));

    // 2. Поправки под пик врагов: что про берут против этих героев заметно чаще обычного.
    const lifts = [];
    d.vs.forEach((v, i) => {
      if (v.n < 12) return;
      const enemy = enemies.find((e) => e.hero.id === v.hero);
      for (const [k, x] of Object.entries(d.items)) {
        if (!big(k) && k !== 'ultimate_scepter' && k !== 'aghanims_shard') continue;
        const base = x.c / d.n, vs = x.vs[i] / v.n;
        if (x.vs[i] >= 4 && vs - base >= 0.12) lifts.push({ key: k, enemy: enemy?.hero.dname || '', base, vs, lift: vs - base, n: v.n });
      }
    });
    lifts.sort((x, y) => y.lift - x.lift);
    const seen = new Set();
    const top = lifts.filter((x) => (seen.has(x.key) ? false : seen.add(x.key))).slice(0, 3);
    if (top.length) {
      lines.push({ kind: 'matchup', text: `Против этого пика про чаще берут: ${top.map((x) => `${name(x.key)}${p.owned.has(x.key) ? ' ✓' : ''} — против ${x.enemy} в ${Math.round(x.vs * 100)}% игр вместо обычных ${Math.round(x.base * 100)}%`).join('; ')}.` });
    }

    // 3. Аганим и Шард: что они дают этому герою в текущем патче и было ли это нужно в этой игре.
    const needed = effects.filter((e) => p.build?.threats.some((t) => t.id === e.id && t.status !== 'covered' && t.status !== 'hero'));
    for (const kind of ['ultimate_scepter', 'aghanims_shard']) {
      const eff = needed.find((e) => e.key === kind);
      const sh = share(kind);
      const label = kind === 'ultimate_scepter' ? 'Аганим' : 'Шард';
      if (eff && !p.owned.has(kind)) {
        const threat = p.build.threats.find((t) => t.id === eff.id);
        lines.push({ kind: 'aghs', key: kind, important: true, title: eff.desc,
          text: `${label} (${eff.skill}) в патче ${p.pro.patch}: ${eff.ru}. В этой игре это было нужно — угроза «${threat.title.toLowerCase()}» (${threat.sources.slice(0, 3).join(', ')}). Про берут его на ${p.hero.dname} в ${Math.round(sh * 100)}% игр${d.items[kind] ? `, обычно к ${fmtTime(d.items[kind].med)}` : ''}.` });
      } else if (!p.owned.has(kind) && sh >= 0.35 && d.items[kind] && dur > d.items[kind].med + 300) {
        lines.push({ kind: 'aghs', key: kind, title: consts.aghs?.[p.hero.id]?.[kind === 'ultimate_scepter' ? 'scepter' : 'shard']?.desc || '',
          text: `${label} не собран, хотя у про на ${p.hero.dname} он есть в ${Math.round(sh * 100)}% игр (обычно к ${fmtTime(d.items[kind].med)}), а игра шла ${fmtTime(dur)}.` });
      }
    }

    // 3б. Отставание от про-таймингов по ключевым предметам (от 5 минут).
    const late = p.pro.core.filter((c) => c.has && c.time != null && c.time - c.med >= 300).sort((x, y) => (y.time - y.med) - (x.time - x.med));
    if (late.length) {
      lines.push({ kind: 'timing', text: `Отставание от про-таймингов: ${late.slice(0, 3).map((c) => `${c.name} на ${fmtTime(c.time)} вместо ≈${fmtTime(c.med)} (+${fmtTime(c.time - c.med)})`).join('; ')}.` });
    }

    // 4. Порядок покупок: что про собирают раньше.
    const mine = [...p.owned.entries()].filter(([k, t]) => t != null && big(k)).sort((x, y) => x[1] - y[1]);
    for (const [k, t] of mine) {
      const myMed = d.items[k]?.med;
      if (myMed == null) continue;
      // только если «правильный» предмет тоже собран, но позже; не собранное уходит в пункт про недостающее
      const earlier = p.pro.core.find((c) => c.share >= 0.5 && c.med + 360 <= myMed && p.owned.get(c.key) > t && t > c.med);
      if (earlier) {
        lines.push({ kind: 'order', text: `Порядок: ${name(k)} собран на ${fmtTime(t)} раньше, чем ${earlier.name}. Про обычно сначала берут ${earlier.name} (≈${fmtTime(earlier.med)}), а ${name(k)} — ближе к ${fmtTime(myMed)}.` });
        break;
      }
    }

    // 5. Не собрал важное из про-сборки и купил то, что про почти не берут.
    const missing = p.pro.core.filter((c) => c.share >= 0.5 && !c.has && dur > c.med + 300);
    const odd = mine.filter(([k]) => items[k]?.cost >= 2000 && share(k) < 0.03 && !effects.some((e) => e.key === k) && !top.some((x) => x.key === k)).map(([k]) => k);
    const swapTo = missing.find((c) => !BOOT_UPGRADES.includes(c.key));
    if (missing.length || odd.length) {
      const parts = [];
      if (missing.length) parts.push(`не собрано из стандартной про-сборки: ${missing.map((c) => `${c.name} (у ${Math.round(c.share * 100)}% про, ≈${fmtTime(c.med)})`).join(', ')}`);
      if (odd.length) parts.push(`${odd.map(name).join(', ')} — у про на этом герое почти не встречается (меньше 3% игр)`);
      lines.push({ kind: 'diff', text: `${parts.join('; ')}${swapTo && odd.length ? `. Скорее всего, слот ${name(odd[0])} лучше было отдать под ${swapTo.name}` : ''}.` });
    }
  }
  return a;
}
