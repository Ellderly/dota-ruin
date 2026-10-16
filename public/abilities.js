// Разбор способностей врага: что это за контроль, как он наводится и чем от него защищаться.
// Источник — справочник способностей OpenDota (наведение, пробитие BKB, диспел) и статистика матча
// (сколько раз враг нажал способность и сколько урона от неё получил игрок).

// Тип контроля по описанию и атрибутам способности. Пассивки (баши) не считаются: от них не защищаются предметом заранее.
export function disableType(a) {
  if (!a || a.team === 'Friendly' || a.beh.includes('Passive')) return null;
  const text = `${a.desc} ${a.attr}`.toLowerCase().replace(/mini-?stun\w*/g, '');
  const types = [];
  if (/transforms? an? enemy|\bhex\b/.test(text)) types.push('hex');
  if (/\bstun|hurled|disabling|cannot (move or attack|act)|trapping|sucks? in|grabb|lasso|asleep|\bsleep\b|nightmare|suspending|in the air|stasis|freez|pulls? an enemy/.test(text)) types.push('stun');
  if (/forced to attack|taunt|berserk|causes? them to attack/.test(text)) types.push('taunt');
  if (/prohibiting movement|prevents? them from moving|\broots?\b|ensnar|entangl|leash/.test(text)) types.push('root');
  if (/silenc|\bmute|prevents? them from casting|cannot cast/.test(text)) types.push('silence');
  if (/\bfear/.test(text)) types.push('fear');
  return types.length ? [...new Set(types)] : null;
}

// Направленная способность — та, что наводится только на цель (её отражает Linken, Lotus, Counterspell).
export const isTargeted = (a) => a.beh.includes('Unit Target') && !a.beh.includes('Point Target') && !a.beh.includes('No Target');

// Предметы врага, которые тоже контролят.
export const ITEM_DISABLES = {
  sheepstick: { dname: 'Scythe of Vyse', types: ['hex'], targeted: true, pierce: false, disp: 'strong' },
  abyssal_blade: { dname: 'Abyssal Blade', types: ['stun'], targeted: true, pierce: true, disp: 'strong' },
  orchid: { dname: 'Orchid Malevolence', types: ['silence'], targeted: true, pierce: false, disp: 'basic' },
  bloodthorn: { dname: 'Bloodthorn', types: ['silence'], targeted: true, pierce: false, disp: 'basic' },
  rod_of_atos: { dname: 'Rod of Atos', types: ['root'], targeted: true, pierce: false, disp: 'basic' },
  gungir: { dname: 'Gleipnir', types: ['root'], targeted: false, pierce: false, disp: 'basic' },
};

// Под станом, хексом, таунтом и страхом ничего не нажать — диспел-предметы и диспел-способности
// спасают только от того, под чем можно действовать (молчание, рут). Исключение — то, что нажато заранее
// и срабатывает само (Dark Pact, Kraken Shell), или BKB/Linken, которые просто не дают эффекту лечь.
const ACTIONABLE = (ab) => ab.types.every((t) => t === 'silence' || t === 'root');

// Что закрывает конкретный ответ. ab = { types, targeted, pierce, disp }.
export const ANSWER_COVERS = {
  black_king_bar: { why: 'не проходит сквозь BKB', fn: (ab) => !ab.pierce },
  sphere: { why: 'направленная — Linken её блокирует', fn: (ab) => ab.targeted },
  lotus_orb: { why: 'направленная — Lotus её отражает', fn: (ab) => ab.targeted },
  manta: { why: 'молчание или рут, снимается диспелом Manta', fn: (ab) => ab.disp === 'basic' && ACTIONABLE(ab) },
};

// Механики героев, которые закрывают контроль частично — с точным условием.
// Герои из hero-mechanics.js без записи здесь считаются закрывающими угрозу целиком.
export const INNATE_COVERS = {
  antimage: { name: 'Counterspell', why: 'направленная — отражается', fn: (ab) => ab.targeted },
  life_stealer: { name: 'Rage', why: 'не проходит сквозь иммунитет к магии', fn: (ab) => !ab.pierce },
  juggernaut: { name: 'Blade Fury', why: 'не проходит сквозь иммунитет к магии', fn: (ab) => !ab.pierce },
  slark: { name: 'Dark Pact', why: 'снимается сильным диспелом', fn: (ab) => ab.disp === 'basic' || ab.disp === 'strong' },
  abaddon: { name: 'Aphotic Shield', why: 'снимается сильным диспелом (щит вешается заранее или союзником)', fn: (ab) => ab.disp === 'basic' || ab.disp === 'strong' },
  tidehunter: { name: 'Kraken Shell', why: 'снимается сильным диспелом', fn: (ab) => ab.disp === 'basic' || ab.disp === 'strong' },
  phantom_lancer: { name: 'Doppelganger', why: 'направленная — уходит в иллюзии', fn: (ab) => ab.targeted },
  naga_siren: { name: 'Mirror Image', why: 'направленная (уходит в иллюзии) или молчание/рут, снимаемые диспелом', fn: (ab) => ab.targeted || (ab.disp === 'basic' && ACTIONABLE(ab)) },
};

// Все контролящие способности и предметы врагов, которые реально использовались в матче.
export function enemyDisables(enemies, consts, parsed, filter, me = null) {
  const out = [];
  for (const e of enemies) {
    const uses = e.raw.ability_uses || {};
    for (const k of consts.heroAbilities?.[e.hero.name] || []) {
      const a = consts.abilities?.[k];
      const types = disableType(a);
      if (!types) continue;
      const n = parsed ? uses[k] || 0 : 1;
      if (!n) continue;
      const targeted = isTargeted(a);
      // ability_targets из реплея: сколько раз враг нажал способность именно на этого героя (для площадных данных нет)
      const onMe = parsed && targeted && me ? e.raw.ability_targets?.[k]?.[me.hero.name] ?? 0 : null;
      const ab = { key: k, dname: a.dname, hero: e.hero.dname, types, targeted, pierce: a.pierce, disp: a.disp, uses: n, onMe, item: false };
      if (filter(ab)) out.push(ab);
    }
    for (const [k, d] of Object.entries(ITEM_DISABLES)) {
      if (!e.owned?.has(k)) continue;
      const n = parsed ? e.raw.item_uses?.[k] || 0 : 1;
      if (!n) continue;
      const ab = { key: k, dname: d.dname, hero: e.hero.dname, types: d.types, targeted: d.targeted, pierce: d.pierce, disp: d.disp, uses: n, onMe: null, item: true };
      if (filter(ab)) out.push(ab);
    }
  }
  return out.sort((x, y) => y.uses - x.uses);
}

// Подпись источника урона по ключу из damage_inflictor_received.
export function inflictorName(key, consts, heroByAbility) {
  if (key === 'null') return { name: 'Атаки с руки', hero: null };
  if (consts.items[key]) return { name: consts.items[key].dname, hero: null, item: true };
  const a = consts.abilities?.[key];
  return { name: a?.dname || key.replace(/_/g, ' '), hero: heroByAbility[key] || null };
}
