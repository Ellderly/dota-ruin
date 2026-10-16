// Механики героев: угрозы, на которые герой отвечает сам, без предмета.
// Ключ героя — короткое имя (без npc_dota_hero_), ключ угрозы — id правила из RULES в items.js:
//   control — много станов, magic — магический прокаст, single — точечные ультимейты,
//   physical — физический бурст (спрашивается с позиций 3–5),
//   break / heal / invis / mobile — командные: герой закрывает их для всей команды.
// Сайленсов здесь нет намеренно: под молчанкой способность не нажать, выручает только предмет.
// Герои без записи разобраны и пропущены: у них нет способности, которая заменяет предмет.
// Таблица составлена вручную по устоявшимся механикам; после патчей её стоит перепроверять.

const DOPPEL = 'Doppelganger уводит героя с карты и прячет настоящего среди иллюзий. BKB на нём почти не берут (в статистике это ~2% игр)';
const MIRROR = 'Mirror Image сбрасывает дебаффы и даёт неуязвимость на время каста, Song of the Siren останавливает драку. BKB выдаёт настоящую нагу среди иллюзий';
const RAGE = 'Rage даёт иммунитет к магии и дебаффам — это встроенный BKB';
const PACT = 'Dark Pact — сильный диспел с коротким кулдауном, нажимается заранее';
const APHOTIC = 'Aphotic Shield снимает станы и дебаффы, Borrowed Time переживает прокаст';
const COUNTER = 'Counterspell отражает направленные заклинания, плюс врождённое сопротивление магии';
const PHASE = 'Phase Shift делает героя неуязвимым на время прокаста';
const DISSIMILATE = 'Dissimilate убирает героя с карты на время прокаста';
const GRAVE = 'Shallow Grave не даёт умереть под фокусом';
const PROMISE = 'False Promise откладывает весь входящий урон и снимает дебаффы';
const HEX = 'Hex — мгновенный контроль, от которого не уйти блинком';

// Названия защитных способностей, чтобы показывать, сколько раз игрок их реально нажал (ability_uses из реплея).
// Ключ способности ищется в справочнике патча по названию; пассивные (Medusa, Tidehunter…) в счётчик не попадают.
export const INNATE_ABILITY = {
  phantom_lancer: 'Doppelganger', naga_siren: 'Mirror Image', life_stealer: 'Rage', juggernaut: 'Blade Fury', slark: 'Dark Pact',
  antimage: 'Counterspell', ursa: 'Enrage', faceless_void: 'Time Walk', weaver: 'Time Lapse', ember_spirit: 'Flame Guard',
  templar_assassin: 'Refraction', puck: 'Phase Shift', void_spirit: 'Dissimilate', abaddon: 'Aphotic Shield', necrolyte: 'Ghost Shroud',
  dazzle: 'Shallow Grave', oracle: 'False Promise', omniknight: 'Guardian Angel', winter_wyvern: 'Cold Embrace', pugna: 'Decrepify',
  lich: 'Frost Shield', treant: 'Living Armor', dark_willow: 'Shadow Realm', windrunner: 'Windrun', legion_commander: 'Press the Attack',
};

export const INNATE = {
  // коры
  phantom_lancer: { control: DOPPEL, magic: DOPPEL, single: DOPPEL },
  naga_siren: { control: MIRROR, magic: MIRROR, single: MIRROR },
  life_stealer: { control: RAGE, magic: RAGE, single: RAGE },
  juggernaut: { magic: 'Blade Fury даёт иммунитет к магии на время вращения' },
  slark: { control: PACT, single: PACT },
  antimage: { magic: COUNTER, single: COUNTER },
  ursa: { control: 'Enrage сильно сокращает длительность станов и входящий урон' },
  faceless_void: { magic: 'Time Walk откатывает урон, полученный за последние секунды', mobile: 'Chronosphere останавливает любого героя' },
  medusa: { magic: 'Mana Shield поглощает урон за счёт маны' },
  weaver: { magic: 'Time Lapse возвращает здоровье и снимает дебаффы' },
  ember_spirit: { magic: 'Flame Guard поглощает магический урон' },
  templar_assassin: { magic: 'Refraction полностью блокирует несколько получений урона' },
  puck: { magic: PHASE, single: PHASE },
  void_spirit: { magic: DISSIMILATE, single: DISSIMILATE },
  storm_spirit: { mobile: 'Electric Vortex — мгновенный контроль' },
  // оффлейнеры
  abaddon: { control: APHOTIC, magic: APHOTIC },
  tidehunter: { control: 'Kraken Shell сбрасывает дебаффы при получении урона', physical: 'Anchor Smash режет урон атак врагов, Kraken Shell блокирует часть урона' },
  bristleback: { physical: 'Bristleback режет урон, полученный со спины и сбоку' },
  mars: { physical: 'Bulwark блокирует урон от атак спереди и сбоку' },
  razor: { physical: 'Static Link забирает урон у атакующего героя' },
  dragon_knight: { physical: 'Dragon Blood даёт большой запас брони и регенерации' },
  abyssal_underlord: { physical: 'Atrophy Aura снижает урон атак врагов рядом' },
  visage: { physical: 'Gravekeeper\'s Cloak поглощает большую часть урона' },
  necrolyte: { physical: 'Ghost Shroud делает героя неуязвимым для атак' },
  enchantress: { physical: 'Untouchable сильно замедляет атаки по ней' },
  windrunner: { physical: 'Windrun даёт уклонение от атак' },
  doom_bringer: { mobile: 'Doom запрещает способности и предметы' },
  batrider: { mobile: 'Flaming Lasso — мгновенный контроль сквозь иммунитет к магии' },
  beastmaster: { mobile: 'Primal Roar — мгновенный контроль сквозь иммунитет к магии' },
  spirit_breaker: { mobile: 'Charge of Darkness догоняет в любой точке карты' },
  rattletrap: { mobile: 'Hookshot и Power Cogs запирают цель' },
  night_stalker: { mobile: 'Crippling Fear накладывает молчание по области' },
  // саппорты
  dazzle: { physical: GRAVE, magic: GRAVE },
  oracle: { physical: PROMISE, magic: PROMISE },
  omniknight: { physical: 'Guardian Angel даёт иммунитет к физическому урону' },
  winter_wyvern: { physical: 'Cold Embrace даёт иммунитет к физическому урону' },
  pugna: { physical: 'Decrepify делает цель неуязвимой для атак' },
  lich: { physical: 'Frost Shield режет урон от атак' },
  treant: { physical: 'Living Armor даёт броню и лечение' },
  dark_willow: { physical: 'Shadow Realm делает её недоступной для атак и направленных способностей' },
  lion: { mobile: HEX },
  shadow_shaman: { mobile: HEX },
  bane: { mobile: 'Fiend\'s Grip — мгновенный контроль сквозь иммунитет к магии' },
  disruptor: { mobile: 'Glimpse возвращает убежавшего героя назад' },
  skywrath_mage: { mobile: 'Ancient Seal — мгновенное молчание' },
  silencer: { mobile: 'Global Silence запрещает способности всем врагам сразу' },
  riki: { mobile: 'Smoke Screen накладывает молчание по области' },
  // командные ответы
  ancient_apparition: { heal: 'Ice Blast полностью запрещает лечение' },
  viper: { break: 'Nethertoxin отключает пассивки' },
  hoodwink: { break: 'Sharpshooter отключает пассивки' },
  slardar: { invis: 'Corrosive Haze показывает цель в невидимости' },
  bounty_hunter: { invis: 'Track показывает цель в невидимости' },
  zuus: { invis: 'Lightning Bolt даёт обзор невидимых' },
  bloodseeker: { invis: 'Thirst показывает раненых врагов, в том числе невидимых', mobile: 'Rupture наказывает за любое перемещение' },
};
