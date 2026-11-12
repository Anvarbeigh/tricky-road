// UI strings. Russian for Russia + CIS, English everywhere else. t('key', {n: 5}) fills {n}.
// Sign texts (s_*) are the humour of the levels: short, shouty, often lies.

const STR = {
  en: {
    title: 'TRICKY ROAD', docTitle: 'Tricky Road 3D',
    tagline: 'One button. Forty roads. Never trust the signs.',
    play: 'PLAY', levels: 'Levels', garage: 'Garage', settings: 'Settings', sound: 'Sound', music: 'Music', shake: 'Camera shake',
    continue: 'Continue', retry: 'Retry', next: 'Next', back: 'Back', close: 'Close', take: 'Take',
    controlsPc: 'Hold SPACE or click — gas · release — brake · in the air: hold = nose up',
    controlsTouch: 'Hold anywhere — gas · release — brake · in the air: hold = nose up',
    tapHint: 'HOLD = GO · RELEASE = BRAKE', h_gap: 'IGNORE THE SIGN: FULL GAS OVER THE GAP!', h_nobrake: 'KEEP HOLDING ON THIS BRIDGE!', h_flag: 'KEEP HOLDING: THE FLAG RUNS AWAY!', h_trapdoor: 'LET GO BEFORE THE TRAPDOOR!', h_spikes: 'FULL GAS: JUMP THE SPIKES!', h_crusher: 'WAIT A MOMENT, THEN GO UNDER IT!', h_rock: 'DON\'T SLOW DOWN: KEEP GOING!', n_brake: 'THAT BRIDGE ISN\'T AS SAFE AS IT SAYS…', n_gap: 'CAN YOU TRUST THAT SIGN?', n_nobrake: 'WATCH THE BRIDGE… WHAT MAKES IT FALL?', n_flag: 'KEEP AN EYE ON THE FLAG…', n_trapdoor: 'THAT TRAPDOOR IS WATCHING YOU…', n_spikes: 'HOW DO YOU GET PAST THE SPIKES?', n_crusher: 'WATCH THE CRUSHER\'S RHYTHM…', n_rock: 'THAT ROCK IS WAITING FOR SOMETHING…', h_brake: 'RELEASE TO BRAKE BEFORE THE BRIDGE!', gotcha: 'GOTCHA!',
    level: 'Level {n}', levelShort: 'LVL {n}', fails: 'Fails: {n}', coins: 'Coins',
    world: ['Meadow', 'Farm', 'Mall', 'Moon'],
    locked: 'Finish the previous level', lockedWorld: 'Finish {w} first',
    done: 'ROAD CLEARED!', perfect: 'PERFECT!', stars: 'Stars', earned: '+{n} coins',
    doubleCoins: 'Coins ×2', skipLevel: 'Skip level', showTrap: 'Show the trap', noAd: 'No ad available right now',
    watchToUnlock: 'Unlock', buy: 'Buy', owned: 'Owned', equipped: 'Equipped', equip: 'Use', price: '{n} coins',
    worldDone: '{w} cleared! New vehicle: {v}', vehicle: ['Jeep', 'Tractor', 'Shopping cart', 'Moon buggy'],
    allDone: 'You beat every road! New worlds are coming — try Trap Run for a high score.',
    endless: 'Trap Run', endlessDesc: 'Endless traps, new road every day', best: 'Best: {n} m', distance: '{n} m', runOver: 'RUN OVER', newBest: 'NEW BEST!',
    gift: 'Daily gift', giftTitle: 'Daily gift', giftText: 'Come back every day: {a}, then {b}, then {c} coins.', giftTaken: 'Taken today', giftDay: 'Day {n}',
    paused: 'Paused', crashed: 'CRASHED', fell: 'FELL!', wall: 'OUCH', hazard: 'OUCH', roof: 'FLIPPED', ghost: 'Watch the ghost…',
    skins: ['Classic', 'Mint', 'Sunset', 'Night', 'Candy', 'Gold'],
    // signs
    s_safebridge: 'SAFE BRIDGE →', s_hold: 'HOLD TO GO →', nice: 'NICE!', gas: 'GAS', letGo: 'LET GO ▶', s_slow: 'SLOW DOWN!', s_bridge: 'BRAKE ON THE BRIDGE', s_almost: 'ALMOST THERE', s_fast: 'FULL SPEED!',
    s_jump: 'JUMP!', s_timing: 'WAIT FOR IT…', s_rock: 'NOTHING ABOVE YOU', s_stop: 'STOP TO OPEN', s_trust: 'TRUST ME', s_nottrap: 'NOT A TRAP',
    s_safe: 'SAFE', s_ice: 'ICE', s_wind: 'WINDY', s_moon: 'LOW GRAVITY', s_back: 'GO BACK', s_flag: 'FLAG →', s_free: 'FREE COINS', s_hurry: 'HURRY!',
  },
  ru: {
    title: 'ХИТРАЯ ДОРОГА', docTitle: 'Хитрая дорога 3D',
    tagline: 'Одна кнопка. Сорок дорог. Не верь знакам.',
    play: 'ИГРАТЬ', levels: 'Уровни', garage: 'Гараж', settings: 'Настройки', sound: 'Звук', music: 'Музыка', shake: 'Тряска камеры',
    continue: 'Дальше', retry: 'Заново', next: 'Далее', back: 'Назад', close: 'Закрыть', take: 'Забрать',
    controlsPc: 'Держи ПРОБЕЛ или клик — газ · отпусти — тормоз · в воздухе: держи = нос вверх',
    controlsTouch: 'Держи палец — газ · отпусти — тормоз · в воздухе: держи = нос вверх',
    tapHint: 'ДЕРЖИ = ГАЗ · ОТПУСТИ = ТОРМОЗ', h_gap: 'НЕ ВЕРЬ ЗНАКУ: ПОЛНЫЙ ГАЗ ЧЕРЕЗ ЯМУ!', h_nobrake: 'НЕ ОТПУСКАЙ НА ЭТОМ МОСТУ!', h_flag: 'ДЕРЖИ ГАЗ: ФЛАГ УБЕГАЕТ!', h_trapdoor: 'ОТПУСТИ ПЕРЕД ЛЮКОМ!', h_spikes: 'ПОЛНЫЙ ГАЗ: ПЕРЕПРЫГНИ ШИПЫ!', h_crusher: 'ПОДОЖДИ МИГ И ПРОЕЗЖАЙ!', h_rock: 'НЕ ТОРМОЗИ: ЕЗЖАЙ ДАЛЬШЕ!', n_brake: 'ЭТОТ МОСТ НЕ ТАКОЙ НАДЁЖНЫЙ…', n_gap: 'А ЗНАКУ МОЖНО ВЕРИТЬ?', n_nobrake: 'ПРИСМОТРИСЬ К МОСТУ… ОТЧЕГО ОН ПАДАЕТ?', n_flag: 'СЛЕДИ ЗА ФЛАГОМ…', n_trapdoor: 'ЭТОТ ЛЮК СЛЕДИТ ЗА ТОБОЙ…', n_spikes: 'КАК ПРОЕХАТЬ ШИПЫ?', n_crusher: 'ПОЙМАЙ РИТМ ПРЕССА…', n_rock: 'ЭТОТ КАМЕНЬ ЧЕГО-ТО ЖДЁТ…', h_brake: 'ОТПУСТИ ПЕРЕД МОСТОМ, ЧТОБЫ ЗАТОРМОЗИТЬ!', gotcha: 'ПОПАЛСЯ!',
    level: 'Уровень {n}', levelShort: 'УР {n}', fails: 'Попыток: {n}', coins: 'Монеты',
    world: ['Луг', 'Ферма', 'Торговый центр', 'Луна'],
    locked: 'Пройди предыдущий уровень', lockedWorld: 'Сначала пройди: {w}',
    done: 'ДОРОГА ПРОЙДЕНА!', perfect: 'ИДЕАЛЬНО!', stars: 'Звёзды', earned: '+{n} монет',
    doubleCoins: 'Монеты ×2', skipLevel: 'Пропустить', showTrap: 'Показать ловушку', noAd: 'Реклама сейчас недоступна',
    watchToUnlock: 'Открыть', buy: 'Купить', owned: 'Есть', equipped: 'Выбрано', equip: 'Выбрать', price: '{n} монет',
    worldDone: '{w}: пройдено! Новая машина: {v}', vehicle: ['Джип', 'Трактор', 'Тележка', 'Луноход'],
    allDone: 'Все дороги пройдены! Новые миры уже в пути — попробуй Забег на рекорд.',
    endless: 'Забег', endlessDesc: 'Бесконечные ловушки, каждый день новая дорога', best: 'Рекорд: {n} м', distance: '{n} м', runOver: 'ЗАБЕГ ОКОНЧЕН', newBest: 'НОВЫЙ РЕКОРД!',
    gift: 'Подарок', giftTitle: 'Ежедневный подарок', giftText: 'Заходи каждый день: {a}, потом {b}, потом {c} монет.', giftTaken: 'Сегодня уже забран', giftDay: 'День {n}',
    paused: 'Пауза', crashed: 'АВАРИЯ', fell: 'УПАЛ!', wall: 'ОЙ', hazard: 'ОЙ', roof: 'ПЕРЕВЕРНУЛСЯ', ghost: 'Смотри на призрака…',
    skins: ['Классика', 'Мята', 'Закат', 'Ночь', 'Конфета', 'Золото'],
    s_safebridge: 'НАДЁЖНЫЙ МОСТ →', s_hold: 'ДЕРЖИ — ЕДЕМ →', nice: 'КЛАСС!', gas: 'ГАЗ', letGo: 'ОТПУСТИ ▶', s_slow: 'ТОРМОЗИ!', s_bridge: 'ТОРМОЗИ НА МОСТУ', s_almost: 'ПОЧТИ ПРИЕХАЛ', s_fast: 'ПОЛНЫЙ ГАЗ!',
    s_jump: 'ПРЫГАЙ!', s_timing: 'ПОДОЖДИ…', s_rock: 'СВЕРХУ НИЧЕГО НЕТ', s_stop: 'ОСТАНОВИСЬ', s_trust: 'ВЕРЬ МНЕ', s_nottrap: 'ЭТО НЕ ЛОВУШКА',
    s_safe: 'БЕЗОПАСНО', s_ice: 'ЛЁД', s_wind: 'ВЕТЕР', s_moon: 'НИЗКАЯ ГРАВИТАЦИЯ', s_back: 'НАЗАД', s_flag: 'ФЛАГ →', s_free: 'МОНЕТЫ ДАРОМ', s_hurry: 'БЫСТРЕЕ!',
  },
};

let lang = 'en';
const CIS = ['ru', 'be', 'kk', 'ky', 'uz', 'tg', 'hy', 'az', 'uk'];
export function setLang(code) {
  const c = String(code || 'en').toLowerCase().slice(0, 2);
  lang = CIS.includes(c) ? 'ru' : 'en';
  document.documentElement.lang = lang;
  return lang;
}
export function getLang() { return lang; }
export function t(key, vars) {
  let s = STR[lang][key] ?? STR.en[key] ?? key;
  if (typeof s === 'string' && vars) for (const k in vars) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), vars[k]);
  return s;
}
// fills every element with data-t="key"
export function applyTexts(root = document) {
  root.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
}
