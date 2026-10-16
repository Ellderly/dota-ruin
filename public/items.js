// Разбор сборки: какие угрозы были у врагов, чем их закрывают и что игрок купил на самом деле.
// На индекс руина не влияет — это отдельная оценка.
//
// Два слоя:
//  1. RULES — экспертная база «угроза → возможные ответы».
//  2. Статистика OpenDota по герою (heroData): из возможных ответов предлагаются только те, что на этом
//     герое реально собирают. Если герой такие предметы не собирает — это задача союзников, а не его.
import { fmtTime } from './analyzer.js';
import { INNATE } from './hero-mechanics.js';
import { enemyDisables, ANSWER_COVERS, INNATE_COVERS, inflictorName } from './abilities.js';
import { aghsEffects } from './probuild.js';

// strong — герои, которые считаются за два источника.
// heroes — короткие имена (без npc_dota_hero_), enemyItems — предметы врага, которые создают ту же угрозу.
// min — сколько источников нужно, чтобы угроза считалась; from — с какой минуты игры ответ уже реально собрать.
// answers.core / answers.sup — чем закрывается; team — достаточно, чтобы предмет был у любого союзника.
export const RULES = [
  {
    id: 'control', w: 10, min: 3, from: 22, roles: [1, 2, 3, 4, 5],
    title: 'Много контроля',
    why: 'станы и хексы не дают нажать ни одной кнопки',
    heroes: ['lion', 'shadow_shaman', 'bane', 'legion_commander', 'batrider', 'beastmaster', 'magnataur', 'tidehunter', 'sven',
      'chaos_knight', 'skeleton_king', 'vengefulspirit', 'earthshaker', 'sand_king', 'centaur', 'slardar', 'tiny', 'mirana',
      'nyx_assassin', 'primal_beast', 'mars', 'tusk', 'spirit_breaker', 'ogre_magi', 'dragon_knight', 'lina', 'rubick',
      'snapfire', 'hoodwink', 'marci', 'kunkka', 'axe', 'pudge', 'rattletrap', 'earth_spirit', 'jakiro', 'witch_doctor',
      'warlock', 'dark_willow', 'elder_titan', 'enigma', 'puck', 'winter_wyvern', 'crystal_maiden', 'disruptor', 'dawnbreaker'],
    enemyItems: ['sheepstick', 'abyssal_blade'],
    answers: { core: ['black_king_bar'], sup: ['force_staff', 'glimmer_cape', 'aeon_disk', 'cyclone', 'wind_waker', 'black_king_bar', 'lotus_orb'] },
  },
  {
    id: 'magic', w: 9, min: 2, from: 24, roles: [1, 2, 3, 4, 5],
    title: 'Магический прокаст',
    why: 'герой умирает от нюков раньше, чем успевает что-то сделать',
    heroes: ['lina', 'lion', 'zuus', 'skywrath_mage', 'leshrac', 'tinker', 'queenofpain', 'invoker', 'pugna', 'necrolyte',
      'storm_spirit', 'death_prophet', 'nyx_assassin', 'jakiro', 'crystal_maiden', 'witch_doctor', 'ancient_apparition',
      'disruptor', 'warlock', 'sand_king', 'earthshaker', 'tiny', 'dark_willow', 'snapfire', 'hoodwink', 'venomancer',
      'rubick', 'shadow_shaman', 'ogre_magi', 'puck', 'void_spirit', 'lich', 'grimstroke', 'phoenix', 'techies'],
    enemyItems: ['dagon', 'ethereal_blade'],
    answers: { core: ['black_king_bar', 'pipe', 'eternal_shroud', 'mage_slayer'], sup: ['glimmer_cape', 'pipe', 'black_king_bar', 'cloak', 'eternal_shroud'] },
  },
  {
    id: 'single', w: 6, min: 2, from: 25, roles: [1, 2],
    title: 'Точечные ультимейты и контроль в одну цель',
    why: 'вражеский ключевой спелл всегда летит в главного кора',
    heroes: ['doom_bringer', 'legion_commander', 'batrider', 'bane', 'beastmaster', 'lion', 'lina', 'necrolyte', 'shadow_shaman',
      'pudge', 'primal_beast', 'bloodseeker', 'grimstroke', 'spirit_breaker', 'viper', 'obsidian_destroyer', 'shadow_demon',
      'terrorblade', 'vengefulspirit', 'winter_wyvern', 'lich', 'rubick'],
    enemyItems: ['sheepstick', 'orchid', 'bloodthorn', 'nullifier'],
    answers: { core: ['sphere', 'lotus_orb'] },
  },
  {
    id: 'silence', w: 6, min: 1, from: 20, roles: [1, 2, 3],
    title: 'Сайленсы',
    why: 'под молчанкой нельзя ни уйти, ни нажать защиту',
    heroes: ['silencer', 'death_prophet', 'drow_ranger', 'skywrath_mage', 'night_stalker', 'bloodseeker', 'riki', 'disruptor', 'doom_bringer', 'puck'],
    enemyItems: ['orchid', 'bloodthorn'],
    answers: { core: ['black_king_bar', 'manta', 'lotus_orb', 'cyclone', 'wind_waker'] },
  },
  {
    id: 'evasion', w: 8, min: 1, from: 25, roles: [1], physical: true,
    title: 'Уклонение и промахи',
    why: 'часть атак просто не попадает',
    heroes: ['phantom_assassin', 'windrunner', 'brewmaster', 'arc_warden', 'keeper_of_the_light', 'riki'],
    enemyItems: ['butterfly', 'heavens_halberd'],
    answers: { core: ['monkey_king_bar', 'bloodthorn'] },
  },
  {
    id: 'break', w: 7, min: 1, from: 25, roles: [1, 2, 3], team: true,
    title: 'Сильные пассивки',
    why: 'без отключения пассивки героя почти невозможно убить',
    heroes: ['bristleback', 'phantom_assassin', 'spectre', 'huskar', 'tidehunter', 'enchantress', 'dragon_knight', 'viper',
      'abyssal_underlord', 'shredder', 'tiny', 'medusa'],
    answers: { core: ['silver_edge'] },
  },
  {
    id: 'heal', w: 7, min: 2, from: 20,
    strong: ['necrolyte', 'huskar', 'alchemist', 'morphling', 'wisp', 'dazzle', 'oracle', 'life_stealer', 'omniknight', 'abaddon', 'chen', 'undying', 'troll_warlord'], roles: [1, 2, 3, 4, 5], team: true,
    title: 'Много лечения и регенерации',
    why: 'урон отхиливается быстрее, чем наносится',
    heroes: ['necrolyte', 'huskar', 'alchemist', 'morphling', 'wisp', 'dazzle', 'oracle', 'life_stealer', 'legion_commander',
      'omniknight', 'abaddon', 'witch_doctor', 'warlock', 'chen', 'enchantress', 'undying', 'juggernaut', 'treant',
      'bloodseeker', 'dawnbreaker', 'phoenix', 'winter_wyvern', 'skeleton_king', 'troll_warlord', 'slark'],
    enemyItems: ['satanic', 'heart', 'bloodstone', 'guardian_greaves'],
    answers: { core: ['skadi', 'shivas_guard', 'spirit_vessel'], sup: ['spirit_vessel', 'shivas_guard'] },
  },
  {
    id: 'illusions', w: 7, min: 1, from: 20, roles: [1, 2, 3], team: true, selfAoe: true,
    title: 'Иллюзии и призывные существа',
    why: 'без урона по площади настоящего героя не найти и не пробить',
    heroes: ['phantom_lancer', 'naga_siren', 'terrorblade', 'chaos_knight', 'meepo', 'broodmother', 'lycan', 'furion', 'visage', 'lone_druid', 'spectre'],
    answers: { core: ['bfury', 'mjollnir', 'maelstrom', 'gungir', 'radiance', 'shivas_guard'] },
  },
  {
    id: 'invis', w: 6, min: 1, from: 10, roles: [1, 2, 3, 4, 5], team: true,
    title: 'Невидимость',
    why: 'без дастов и гема враг сам выбирает, когда драться и когда уйти',
    heroes: ['riki', 'bounty_hunter', 'clinkz', 'weaver', 'nyx_assassin', 'templar_assassin'],
    enemyItems: ['invis_sword', 'silver_edge'],
    answers: { core: ['dust', 'gem'], sup: ['dust', 'gem'] },
  },
  {
    id: 'physical', w: 7, min: 2, from: 18, roles: [3, 4, 5],
    title: 'Физический бурст',
    why: 'тонкого героя убивают с руки за пару секунд',
    heroes: ['phantom_assassin', 'sven', 'ursa', 'templar_assassin', 'slark', 'juggernaut', 'troll_warlord', 'monkey_king',
      'faceless_void', 'life_stealer', 'chaos_knight', 'skeleton_king', 'drow_ranger', 'sniper', 'clinkz', 'legion_commander',
      'riki', 'lycan', 'weaver', 'morphling', 'terrorblade', 'luna', 'muerta', 'kez', 'marci', 'tiny', 'windrunner', 'antimage', 'bloodseeker'],
    answers: {
      core: ['heavens_halberd', 'crimson_guard', 'shivas_guard', 'assault', 'blade_mail', 'solar_crest'],
      sup: ['ghost', 'force_staff', 'hurricane_pike', 'cyclone', 'wind_waker', 'solar_crest', 'pavise', 'ethereal_blade', 'aeon_disk'],
    },
  },
  {
    id: 'mobile', w: 5, min: 2, from: 28, roles: [1, 2, 3], team: true,
    title: 'Скользкие мобильные герои',
    why: 'без мгновенного контроля они всегда уходят с малым запасом здоровья',
    heroes: ['antimage', 'queenofpain', 'storm_spirit', 'puck', 'ember_spirit', 'void_spirit', 'weaver', 'slark', 'morphling', 'pangolier', 'faceless_void', 'tinker'],
    answers: { core: ['sheepstick', 'orchid', 'bloodthorn', 'abyssal_blade', 'rod_of_atos', 'gungir', 'nullifier'] },
  },
  {
    id: 'saves', w: 6, min: 3, from: 32, roles: [1], physical: true,
    title: 'Спасающие предметы и эфирность',
    why: 'цель каждый раз спасают или уводят в эфир, и убийство срывается',
    heroes: ['necrolyte', 'pugna', 'oracle', 'omniknight', 'windrunner'],
    enemyItems: ['ghost', 'ethereal_blade', 'glimmer_cape', 'aeon_disk', 'wind_waker', 'cyclone'],
    answers: { core: ['nullifier'] },
  },
];

const PHYSICAL_ITEMS = ['greater_crit', 'desolator', 'butterfly', 'satanic', 'mjollnir', 'bfury', 'monkey_king_bar', 'skadi', 'abyssal_blade', 'rapier', 'moon_shard'];
const SELF_AOE = ['sven', 'luna', 'gyrocopter', 'medusa', 'ember_spirit', 'magnataur', 'kunkka', 'dragon_knight', 'templar_assassin',
  'leshrac', 'lina', 'sand_king', 'earthshaker', 'shredder', 'axe', 'bristleback', 'tidehunter', 'zuus', 'jakiro', 'crystal_maiden',
  'drow_ranger', 'windrunner', 'storm_spirit', 'queenofpain', 'invoker', 'death_prophet', 'razor', 'viper', 'pangolier', 'mars',
  'primal_beast', 'dawnbreaker', 'snapfire', 'legion_commander', 'abyssal_underlord', 'centaur', 'necrolyte', 'alchemist', 'tiny'];
const ACTIVES = ['black_king_bar', 'manta', 'satanic', 'sheepstick', 'abyssal_blade', 'nullifier', 'orchid', 'bloodthorn', 'blink',
  'cyclone', 'wind_waker', 'force_staff', 'glimmer_cape', 'ghost', 'lotus_orb', 'spirit_vessel', 'shivas_guard', 'pipe',
  'crimson_guard', 'heavens_halberd', 'hurricane_pike', 'ethereal_blade', 'refresher', 'silver_edge', 'invis_sword', 'mjollnir',
  'blade_mail', 'solar_crest', 'pavise', 'diffusal_blade', 'disperser', 'bloodstone', 'mekansm', 'guardian_greaves', 'dust'];
const BOOTS = ['boots', 'power_treads', 'phase_boots', 'arcane_boots', 'tranquil_boots', 'travel_boots', 'travel_boots_2', 'guardian_greaves', 'boots_of_bearing'];

const plural = (n, f) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? f[2] : b > 1 && b < 5 ? f[1] : b === 1 ? f[0] : f[2]; };
const short = (hero) => hero.name.replace('npc_dota_hero_', '');
const list = (arr) => arr.join('; ');
const NO_SWAP = ['blink', 'overwhelming_blink', 'swift_blink', 'arcane_blink', 'ultimate_scepter', 'hand_of_midas', 'relic', 'reaver', 'eagle', 'hyperstone', 'demon_edge', 'mystic_staff', 'ultimate_orb'];

// Доля игр на герое, в которых берут предмет → насколько он для героя «свой».
// Совет даётся, только если предмет на герое берут регулярно. Хвост из случайных покупок (1–2% игр) — не совет.
const TIERS = [[0.1, 'core', 'стандартный предмет героя'], [0.04, 'common', 'берут регулярно']];
// Дорогие лейтовые ответы в статистике занижены (она считает покупки до 30:00), для них порог ниже.
const LATE_ITEMS = ['monkey_king_bar', 'nullifier', 'skadi', 'shivas_guard', 'sheepstick', 'abyssal_blade', 'bloodthorn', 'silver_edge', 'assault', 'lotus_orb', 'sphere'];
const tierOf = (share, key) => TIERS.find((t) => share >= t[0]) || (LATE_ITEMS.includes(key) && share >= 0.025 ? TIERS[1] : null);

const CONSUMABLES = ['dust', 'gem'];
const HALF_ITEMS = ['aghanims_shard', 'yasha', 'sange', 'kaya', 'soul_booster', 'lesser_crit', 'pers'];
const BUCKETS = [450, 600, 720, 900, 1200, 1500, 1800];
const pctText = (x) => (x >= 0.095 ? `${Math.round(x * 100)}%` : `${(x * 100).toFixed(1).replace('.0', '')}%`);

// Угрозы, которые разбираются по реальным способностям врагов, а не по списку героев.
const KIT_FILTERS = {
  control: (ab) => ab.types.some((t) => t !== 'silence'),
  silence: (ab) => ab.types.includes('silence'),
};
const TYPE_RU = { stun: 'стан', hex: 'хекс', taunt: 'таунт', root: 'рут', silence: 'молчание', fear: 'страх' };
const usesText = (n) => `×${n}`;

export function analyzeItems(a, consts, heroData = {}) {
  const heroByAbility = {};
  for (const [hero, keys] of Object.entries(consts.heroAbilities || {})) {
    const h = Object.values(consts.heroes).find((x) => x.name === hero);
    for (const k of keys) heroByAbility[k] = h?.dname || null;
  }
  const withKits = !!consts.abilities;
  const { items } = consts;
  const byId = {};
  for (const [key, it] of Object.entries(items)) byId[it.id] = key;
  const name = (key) => items[key]?.dname || key;
  const dur = a.meta.duration, durMin = dur / 60, parsed = a.meta.parsed;
  const effMin = durMin * (a.meta.turbo ? 2 : 1); // в турбо предметы собираются вдвое быстрее

  for (const p of a.players) {
    const r = p.raw, owned = new Map();
    for (const e of r.purchase_log || []) if (!owned.has(e.key)) owned.set(e.key, e.time);
    for (const id of [r.item_0, r.item_1, r.item_2, r.item_3, r.item_4, r.item_5, r.backpack_0, r.backpack_1, r.backpack_2]) {
      const key = byId[id];
      if (key && !owned.has(key)) owned.set(key, null);
    }
    p.owned = owned;
    p.finalKeys = [r.item_0, r.item_1, r.item_2, r.item_3, r.item_4, r.item_5].map((id) => byId[id]).filter(Boolean);
    // Статистика предметов собрана по привычной роли героя; на нетипичной роли она неприменима — откат на списки по роли.
    p.itemStats = p.offRole ? null : heroData[p.hero.id] || null;
  }
  const has = (p, key) => p.owned.has(key);
  // угроза от предмета считается, только если у нас было хотя бы 6 минут на ответ
  const hadInTime = (p, key) => has(p, key) && (p.owned.get(key) == null || p.owned.get(key) < dur - 360);
  const stat = (p, key) => p.itemStats?.items[key] || null;
  const shareOf = (p, key) => stat(p, key)?.share || 0;
  const winrate = (st) => (st && st.g >= 50 ? st.w / st.g : null);

  // Какие ответы на угрозу подходят конкретному герою (а не роли вообще).
  function suitable(p, rule) {
    const union = [...new Set([...rule.answers.core, ...(rule.answers.sup || [])])].filter((k) => items[k]);
    const cons = union.filter((k) => CONSUMABLES.includes(k)).map((k) => ({ key: k, name: name(k), share: null, tier: 'common', label: 'расходник' }));
    if (cons.length) return p.pos >= 3 ? cons : [];
    if (!p.itemStats) { // статистики по герою нет — откат на списки по роли
      const role = (p.pos <= 3 ? rule.answers.core : rule.answers.sup || rule.answers.core).filter((k) => items[k]);
      return role.map((k) => ({ key: k, name: name(k), share: null, tier: 'common', label: 'по роли' }));
    }
    return union
      .map((k) => ({ key: k, name: name(k), share: shareOf(p, k), wr: winrate(stat(p, k)) }))
      .map((x) => ({ ...x, t: tierOf(x.share, x.key) }))
      .filter((x) => x.t)
      .map((x) => ({ ...x, tier: x.t[1], label: `${x.t[2]} — в ${pctText(x.share)} игр` }))
      .sort((x, y) => y.share - x.share);
  }
  const answerText = (x) => `${x.name}${x.share != null ? ` (на герое берут в ${pctText(x.share)} игр${x.wr != null ? `, винрейт с ним ${Math.round(x.wr * 100)}%` : ''})` : ''}`;

  for (const p of a.players) {
    const r = p.raw;
    const enemies = a.teams[p.isRadiant ? 'dire' : 'radiant'];
    const mates = a.teams[p.team].filter((x) => x !== p);
    const physical = p.pos === 1 || PHYSICAL_ITEMS.some((k) => has(p, k));
    const dmgTaken = r.damage_taken || {};
    const heroDmgTotal = enemies.reduce((s, e) => s + (dmgTaken[e.hero.name] || 0), 0);
    const threats = [];

    for (const rule of RULES) {
      if (!rule.roles.includes(p.pos)) continue;
      if (rule.physical && !physical) continue;
      const union = [...new Set([...rule.answers.core, ...(rule.answers.sup || [])])].filter((k) => items[k]);
      const srcHeroes = enemies.filter((e) => rule.heroes.includes(short(e.hero)));
      const srcItems = [];
      for (const e of enemies) for (const k of rule.enemyItems || []) if (hadInTime(e, k)) srcItems.push({ e, key: k });
      const count = srcHeroes.length + srcItems.length + srcHeroes.filter((e) => rule.strong?.includes(short(e.hero))).length;
      if (count < rule.min) continue;

      const srcSet = [...new Set([...srcHeroes, ...srcItems.map((s) => s.e)])];
      const killsOnMe = srcSet.reduce((s, e) => s + (r.killed_by?.[e.hero.name] || 0), 0);
      const dmg = srcSet.reduce((s, e) => s + (dmgTaken[e.hero.name] || 0), 0);
      const fits = suitable(p, rule);
      const mine = union.filter((k) => has(p, k));
      const mate = mates.find((m) => union.some((k) => has(m, k))) || null;
      const selfAoe = rule.selfAoe && SELF_AOE.includes(short(p.hero));
      const innate = INNATE[short(p.hero)]?.[rule.id] || null;
      const innateMate = rule.team ? mates.find((m) => INNATE[short(m.hero)]?.[rule.id]) || null : null;
      const tooEarly = effMin < rule.from + 3;
      // «Точечные ультимейты» при разборе по способностям входят в «Контроль» — без дублей.
      if (withKits && rule.id === 'single') continue;

      // ---- разбор по способностям: что именно применяли враги и что из этого закрыто ----
      let kitInfo = null;
      if (withKits && KIT_FILTERS[rule.id]) {
        const kit = enemyDisables(enemies, consts, parsed, KIT_FILTERS[rule.id]);
        if (parsed && !kit.length) continue; // враги этот контроль в матче не применяли
        const prot = [];
        const prof = INNATE_COVERS[short(p.hero)];
        if (prof) prot.push({ name: prof.name, why: prof.why, fn: prof.fn });
        else if (innate) prot.push({ name: 'механика героя', why: innate, fn: () => true });
        for (const k of Object.keys(ANSWER_COVERS)) if (has(p, k)) prot.push({ name: name(k), key: k, why: ANSWER_COVERS[k].why, fn: ANSWER_COVERS[k].fn });
        for (const ab of kit) ab.by = prot.filter((x) => x.fn(ab)).map((x) => x.name);
        const unc = kit.filter((ab) => !ab.by.length);
        const total = kit.reduce((s, x) => s + x.uses, 0) || 1;
        const uncUses = unc.reduce((s, x) => s + x.uses, 0);
        const keys = Object.keys(ANSWER_COVERS);
        const cands = suitable(p, { answers: { core: keys, sup: keys } })
          .map((x) => ({ ...x, gain: unc.filter((ab) => ANSWER_COVERS[x.key].fn(ab)).reduce((s, ab) => s + ab.uses, 0) }))
          .filter((x) => x.gain > 0)
          .sort((x, y) => y.gain - x.gain || (y.share ?? 0) - (x.share ?? 0));
        kitInfo = { kit, unc, prot, total, uncUses, best: cands[0] || null };
      }

      let status = 'open';
      if (mine.length) status = 'covered';
      else if (selfAoe || innate) status = 'hero';
      else if (innateMate) status = 'mate';
      else if (!fits.length) status = rule.team ? (mate ? 'team_ok' : 'team_open') : 'skip';
      else if (rule.team && mate) status = 'mate';
      else if (tooEarly) status = 'early';
      // Командную угрозу достаточно закрыть одному — спрашиваем с того, кому ответ подходит больше всех.
      const teamCands = rule.team
        ? [p, ...mates].flatMap((m) => suitable(m, rule).slice(0, 1).map((y) => ({ ...y, m }))).sort((x, y) => (y.share ?? 0.05) - (x.share ?? 0.05))
        : [];
      if (status === 'open' && rule.team && teamCands[0].m !== p) status = 'team_open';
      if (kitInfo) {
        const { unc, prot, best } = kitInfo;
        if (!unc.length) status = prot.some((x) => x.key) ? 'covered' : 'hero';
        else if (best) status = tooEarly ? 'early' : 'open';
        else status = prot.length ? 'hero' : 'skip';
      }
      // Аганим или Шард героя в текущем патче закрывают эту угрозу — это его собственный ответ.
      const ownAghs = aghsEffects(consts, p.hero.id).find((e) => e.id === rule.id) || null;
      const aghsShare = ownAghs ? (p.itemStats ? shareOf(p, ownAghs.key) : null) : null;
      if (ownAghs) {
        if (has(p, ownAghs.key)) status = 'covered';
        else if (['skip', 'team_open', 'open'].includes(status)) status = tooEarly ? 'early' : 'open';
      }
      const aghsChip = ownAghs ? { key: ownAghs.key, name: name(ownAghs.key), share: aghsShare, label: `${ownAghs.skill}: ${ownAghs.ru}` } : null;
      const aghsText = ownAghs ? `${name(ownAghs.key)} (${ownAghs.skill}) в текущем патче ${ownAghs.ru}${aghsShare ? ` — на ${p.hero.dname} его берут в ${pctText(aghsShare)} игр` : ''}` : '';
      if (status === 'skip') continue; // личная угроза, на которую герой в принципе не собирает ответ
      if (status === 'team_open' && tooEarly) continue;

      const sources = [
        ...srcHeroes.map((e) => e.hero.dname),
        ...srcItems.map((s) => `${name(s.key)} у ${s.e.hero.dname}`),
      ];
      const best = kitInfo ? kitInfo.best : fits[0] || aghsChip;
      const tierK = best ? (kitInfo ? Math.max(0.25, kitInfo.uncUses / kitInfo.total) : 1) : kitInfo && !kitInfo.unc.length ? 1 : 0;
      const weight = rule.w * tierK * (1 + (p.deaths ? 0.5 * Math.min(1, killsOnMe / p.deaths) : 0)) * Math.min(1.5, count / rule.min);
      let text, chips = [], abilities = null;
      if (kitInfo) {
        const { kit, unc, best: b } = kitInfo;
        const abText = (ab) => `${ab.dname} (${ab.hero}, нажал ${usesText(ab.uses).slice(1)} раз за игру${ab.targeted ? '' : ', по площади'}${ab.pierce ? ', сквозь BKB' : ''})`;
        abilities = kit.map((ab) => ({ name: ab.dname, hero: ab.hero, uses: ab.uses, types: ab.types.map((t) => TYPE_RU[t]), targeted: ab.targeted, pierce: ab.pierce, by: ab.by, item: ab.item }));
        const byProt = {};
        for (const ab of kit) for (const n of ab.by) (byProt[n] ||= []).push(ab.dname);
        const coveredText = Object.entries(byProt).map(([n, list]) => `${n} — ${list.join(', ')}`).join('; ');
        if (!unc.length) {
          text = `Всё, чем враги контролили (${kit.length}), закрыто: ${coveredText}.`;
        } else if (b) {
          chips = [b];
          const pierceLeft = unc.filter((ab) => !ANSWER_COVERS[b.key].fn(ab));
          text = (coveredText ? `Закрыто: ${coveredText}. ` : '') +
            `Не закрыто: ${unc.map(abText).join('; ')}. ` +
            `Против этого на ${p.itemStats ? p.hero.dname : `позиции ${p.pos}`} берут ${answerText(b)} — закрыл бы ${Math.round((b.gain / kitInfo.uncUses) * 100)}% оставшегося контроля.` +
            (pierceLeft.length ? ` ${pierceLeft.map((x) => x.dname).join(', ')} ${b.key === 'black_king_bar' ? 'проходит сквозь BKB' : 'этим не закрыть'} — тут спасает только позиция.` : '');
          if (status === 'early') text += ` Но игра закончилась на ${Math.round(durMin)}-й минуте — собрать было нереально.`;
        } else {
          text = (coveredText ? `Закрыто: ${coveredText}. ` : '') +
            `Остальное (${unc.map(abText).join('; ')}) предметами этого героя не закрывается — только позиция и союзники.`;
        }
      } else if (status === 'covered' && !mine.length && ownAghs) {
        const t = p.owned.get(ownAghs.key);
        text = `Закрыто своим предметом: ${aghsText}${t != null ? `. Куплен на ${fmtTime(t)}` : ''}.`;
      } else if (status === 'covered') {
        const k = mine[0], t = p.owned.get(k), uses = r.item_uses?.[k];
        text = `Закрыто: ${name(k)}${t != null ? ` на ${fmtTime(t)}` : ''}` +
          (parsed && ACTIVES.includes(k) ? ` (использовал ${uses || 0} ${plural(uses || 0, ['раз', 'раза', 'раз'])})` : '');
      } else if (status === 'hero') text = innate ? `Предмет не нужен, герой отвечает сам: ${innate}.` : `Закрыто самим героем: у ${p.hero.dname} есть свой урон по площади`;
      else if (status === 'mate') text = innateMate
        ? `Закрывает герой союзника — ${innateMate.hero.dname}: ${INNATE[short(innateMate.hero)][rule.id]}.`
        : `Закрыл союзник: ${name(union.find((k) => has(mate, k)))} у ${mate.hero.dname}`;
      else if (status === 'early') text = `Игра закончилась на ${Math.round(durMin)}-й минуте — собрать ответ было нереально`;
      else if (status === 'team_ok' || status === 'team_open') {
        // герой сам это не собирает: показываем, чем угроза закрывается и кому из союзников это подходит
        chips = union.map((k) => ({ key: k, name: name(k), label: 'закрывает эту угрозу' }));
        const cands = teamCands.filter((c) => c.m !== p && c.tier !== 'rare');
        const who = cands.slice(0, 2).map((c) => `${c.name} на ${c.m.hero.dname}${c.share != null ? ` (берут в ${pctText(c.share)} игр)` : ''}`);
        const base = `Закрывается предметами: ${union.map(name).join(', ')}. ` +
          (fits.length ? `${p.hero.dname} — не первый кандидат на них в этой команде.` : `На ${p.hero.dname} их не собирают — это задача союзников.`);
        if (status === 'team_ok') text = `${base} Закрыл ${mate.hero.dname}: ${name(union.find((k) => has(mate, k)))}.` + (ownAghs ? ` Свой ответ у героя тоже был: ${aghsText}.` : '');
        else text = `${base} В команде не купил никто.` + (who.length ? ` Логичнее всего: ${who.join(' или ')}.` : ' Стандартно эти предметы не собирает ни один герой команды — закрыть угрозу можно было только нестандартной покупкой.');
      } else if (!fits.length && ownAghs) {
        chips = [aghsChip];
        text = `Не закрыто. Свой ответ у героя: ${aghsText}.` + (status === 'early' ? ` Но игра закончилась на ${Math.round(durMin)}-й минуте.` : '');
      } else {
        chips = [...(ownAghs ? [aghsChip] : []), ...fits.slice(0, 4)];
        text = `Не закрыто. ${p.itemStats ? `На ${p.hero.dname}` : `На позиции ${p.pos}`} для этого берут: ${fits.slice(0, 2).map(answerText).join('; ')}.` +
''; 
      }

      threats.push({
        id: rule.id, title: rule.title, why: rule.why, status, weight, sources, text, chips,
        answers: fits,
        covered: status === 'covered' || status === 'hero' || status === 'mate',
        counted: ['covered', 'hero', 'mate', 'open'].includes(status),
        killsOnMe, dmg, dmgShare: heroDmgTotal ? dmg / heroDmgTotal : null,
        coveredKey: kitInfo ? kitInfo.prot.find((x) => x.key)?.key || null : mine[0] || (ownAghs && has(p, ownAghs.key) ? ownAghs.key : null),
        abilities,
      });
    }
    // Что реально наносило урон: способности, предметы и атаки с руки.
    const recv = r.damage_inflictor_received || {};
    const recvTotal = Object.values(recv).reduce((s, v) => s + v, 0);
    const damageSources = Object.entries(recv)
      .map(([k, v]) => ({ key: k, dmg: v, share: recvTotal ? v / recvTotal : 0, ...inflictorName(k, consts, heroByAbility),
        magic: consts.abilities?.[k]?.dmg === 'Magical', pierce: !!consts.abilities?.[k]?.pierce }))
      .filter((x) => x.dmg > 0).sort((x, y) => y.dmg - x.dmg).slice(0, 6);
    const magicTop = damageSources.filter((x) => x.magic).slice(0, 3);
    const magic = threats.find((x) => x.id === 'magic');
    if (magic && magicTop.length) {
      magic.text += ` Больше всего магического урона по нему: ${magicTop.map((x) => `${x.name}${x.hero ? ` (${x.hero})` : ''} — ${x.dmg.toLocaleString('ru-RU')}${x.pierce ? ', сквозь BKB' : ''}`).join('; ')}.`;
    }

    const ORDER = { open: 0, team_open: 1, early: 2, team_ok: 3, mate: 4, hero: 4, covered: 4 };
    threats.sort((x, y) => (ORDER[x.status] - ORDER[y.status]) || y.weight - x.weight);

    // тайминги относительно того, как этот предмет берут на этом герое
    const timing = (key, time) => {
      const st = stat(p, key);
      if (!st || st.g < 80 || time == null || time < 0 || a.meta.turbo) return null;
      let acc = 0, median = null;
      for (const b of BUCKETS) { acc += st.t[b]?.[0] || 0; if (median == null && acc >= st.g / 2) median = b; }
      const mine = BUCKETS.find((b) => time <= b) || null;
      if (!median || !mine) return null;
      const wr = (list) => { const g = list.reduce((s, b) => s + (st.t[b]?.[0] || 0), 0), w = list.reduce((s, b) => s + (st.t[b]?.[1] || 0), 0); return g >= 25 ? w / g : null; };
      const wrMine = wr([mine]), wrEarly = wr(BUCKETS.filter((b) => b <= median));
      // граница окна — не приговор: «поздно» только при заметном опоздании
      const verdict = mine > median && time - median >= 150 ? 'late' : mine < median ? 'early' : 'ok';
      return { verdict, median, mine, wrMine, wrEarly };
    };

    const notes = [], goods = [];
    const t = (k) => p.owned.get(k);
    const uses = (k) => r.item_uses?.[k] || 0;
    const big = (k) => items[k]?.created && items[k].cost >= 1800 && !BOOTS.includes(k);
    const timings = {};
    for (const [k, time] of p.owned) {
      if (!big(k)) continue;
      const tm = timing(k, time);
      if (!tm) continue;
      timings[k] = tm;
      if (tm.verdict === 'late') {
        notes.push({ w: (tm.wrEarly ?? 0) - (tm.wrMine ?? 0) + 0.05, text: `${name(k)} на ${fmtTime(time)} — позже обычного: на ${p.hero.dname} половина игроков собирает его до ${fmtTime(tm.median)}.` +
          (tm.wrMine != null && tm.wrEarly != null ? ` Винрейт героя при покупке в этом окне — ${Math.round(tm.wrMine * 100)}%, при покупке до ${fmtTime(tm.median)} — ${Math.round(tm.wrEarly * 100)}%.` : '') });
      } else if (tm.verdict === 'early') goods.push(`${name(k)} на ${fmtTime(time)} — раньше, чем у половины игроков на ${p.hero.dname} (обычно к ${fmtTime(tm.median)})`);
    }
    notes.sort((x, y) => y.w - x.w);
    const noteTexts = notes.slice(0, 3).map((n) => n.text);
    const lateKeys = new Set(Object.keys(timings).filter((k) => timings[k].verdict === 'late'));

    if (has(p, 'hand_of_midas') && t('hand_of_midas') > 12 * 60 && !a.meta.turbo && !lateKeys.has('hand_of_midas')) noteTexts.push(`Мидас на ${fmtTime(t('hand_of_midas'))}: после 12-й минуты он окупается слишком долго`);
    if (has(p, 'bfury') && t('bfury') > 20 * 60 && !a.meta.turbo && !lateKeys.has('bfury')) noteTexts.push(`Battle Fury только на ${fmtTime(t('bfury'))}: фарм-предмет, купленный так поздно, уже не разгоняет`);
    if (has(p, 'radiance') && t('radiance') > 22 * 60 && !a.meta.turbo && !lateKeys.has('radiance')) noteTexts.push(`Radiance только на ${fmtTime(t('radiance'))}: к этому времени его урон мало что решает`);
    if (has(p, 'rapier')) {
      const after = t('rapier') != null ? p.deathList.filter((d) => d.time > t('rapier')).length : 0;
      noteTexts.push(`Divine Rapier${t('rapier') != null ? ` на ${fmtTime(t('rapier'))}` : ''} — ставка ва-банк${after ? `, после покупки умер ${after} ${plural(after, ['раз', 'раза', 'раз'])}` : ''}`);
    }
    if (has(p, 'invis_sword') || has(p, 'silver_edge')) {
      const dust = enemies.reduce((s, e) => s + (e.raw.purchase?.dust || 0), 0);
      const gem = enemies.some((e) => has(e, 'gem'));
      if (gem || dust >= 4) noteTexts.push(`Невидимость от Shadow Blade почти не работала: враги купили ${gem ? 'гем' : ''}${gem && dust ? ' и ' : ''}${dust ? `${dust} ${plural(dust, ['даст', 'даста', 'дастов'])}` : ''}`);
    }
    const smallStats = ['wraith_band', 'null_talisman', 'bracer'].reduce((s, k) => s + (r.purchase?.[k] || 0), 0);
    if (smallStats >= 3) noteTexts.push(`${smallStats} мелких предмета на статы (Wraith Band, Bracer, Null Talisman) — это задержало ключевые слоты`);
    if (parsed) {
      for (const k of ACTIVES) {
        if (k === 'dust' || !has(p, k) || t(k) == null || t(k) > dur - 300 || uses(k) > 0) continue;
        noteTexts.push(`${name(k)} куплен на ${fmtTime(t(k))} и ни разу не использован`);
      }
    }
    if (p.pos <= 3 && parsed && effMin > 20 && !BOOTS.slice(1).some((k) => has(p, k))) noteTexts.push('За всю игру не улучшил ботинки');

    // стандартная сборка героя и нестандартные покупки
    let standard = [], unusual = [];
    if (p.itemStats) {
      standard = Object.entries(p.itemStats.items)
        .filter(([k, st]) => big(k) && st.share >= 0.08 && !HALF_ITEMS.includes(k))
        .sort((x, y) => y[1].share - x[1].share).slice(0, 8)
        .map(([k, st]) => ({ key: k, name: name(k), share: st.share, wr: winrate(st), has: has(p, k), time: t(k) ?? null }));
      unusual = p.finalKeys.filter((k) => big(k) && items[k].cost >= 2000 && shareOf(p, k) < 0.007)
        .map((k) => ({ key: k, name: name(k), time: t(k) ?? null, share: shareOf(p, k) }));
      for (const u of unusual) {
        const covers = threats.some((x) => x.coveredKey === u.key);
        noteTexts.push(`${u.name} — нестандартный предмет для ${p.hero.dname}: его берут меньше чем в 1% игр на герое` + (covers ? ', но здесь он закрывал конкретную угрозу' : ''));
      }
    }

    const open = threats.filter((x) => x.status === 'open');
    let swap = null;
    const strongOpen = open;
    if (strongOpen.length && effMin > 25) {
      const target = strongOpen[0];
      const weak = unusual.find((u) => !threats.some((x) => x.coveredKey === u.key));
      swap = weak
        ? { text: `Как вариант: вместо ${weak.name}${weak.time != null ? ` (куплен на ${fmtTime(weak.time)})` : ''} взять ${target.answers[0].name} — ${weak.name} на этом герое почти не собирают, и здесь он не отвечал ни на одну угрозу.` }
        : { text: `Вся сборка стандартная для героя, выкидывать нечего. Следующим слотом стоило брать ${target.answers[0].name} — против: ${target.sources.slice(0, 3).join(', ')}.` };
    }

    const allAnswerKeys = new Set(RULES.flatMap((x) => [...x.answers.core, ...(x.answers.sup || [])]));
    const timeline = (r.purchase_log || [])
      .filter((e) => (items[e.key]?.cost || 0) >= 1000 && !e.key.startsWith('recipe'))
      .map((e) => ({ key: e.key, name: name(e.key), time: e.time, cost: items[e.key].cost,
        uses: ACTIVES.includes(e.key) ? uses(e.key) : null, timing: timings[e.key]?.verdict || null,
        answer: allAnswerKeys.has(e.key) && threats.some((x) => x.coveredKey === e.key) }));

    const counted = threats.filter((x) => x.counted && x.weight > 0);
    const total = counted.reduce((s, x) => s + x.weight, 0);
    const score = total ? Math.round((100 * counted.filter((x) => x.covered).reduce((s, x) => s + x.weight, 0)) / total) : null;
    const label = score == null ? 'Особых требований к сборке не было' : score >= 75 ? 'Сборка под врагов' : score >= 45 ? 'Сборка частично под врагов' : 'Сборка мимо врагов';
    const openTitles = strongOpen.map((x) => x.title.toLowerCase());
    let summary;
    if (score == null) summary = `У врагов не было угроз, на которые ${p.hero.dname} должен отвечать своими предметами.`;
    else if (!openTitles.length) summary = p.ruin >= 58 ? 'Предметы собраны по ситуации — проблема была не в сборке, а в самой игре.' : p.ruin < 45 ? 'И сыграл хорошо, и предметы собрал по ситуации.' : 'Все значимые угрозы, которые этот герой может закрыть сам, закрыты.';
    else if (p.ruin < 45 && score < 50) summary = `Сыграл хорошо, но во многом на везении: сборка не отвечала на главные угрозы (${list(openTitles)}) — просто враги это не наказали. Против такого же пика в другой игре может не повезти.`;
    else if (p.ruin >= 58 && score < 50 && strongOpen.length >= 2) summary = `Сборка — одна из причин провала. Без ответа: ${list(openTitles)}.`;
    else summary = `Без ответа: ${list(openTitles)}.`;

    p.build = { score, label, summary, threats, damageSources, recvTotal, notes: noteTexts, goods: goods.slice(0, 3), swap, timeline, standard,
      open: open.length, exact: parsed, sample: p.itemStats?.n || null, offRole: p.offRole || null };
  }
  return a;
}
