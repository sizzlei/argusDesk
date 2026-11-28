// The weather outside the centre. The real one when the backend could read it
// (main.ts); otherwise one made up by the season: from November to February it
// may snow, rain or blow; spring has blossom, autumn falling leaves. The made-up
// one changes every three hours and is the same for the whole team at the same
// time (it is worked out from the date).

export type Weather = 'clear' | 'cloudy' | 'snow' | 'rain' | 'wind' | 'leaves' | 'blossom';

export const WEATHER_NAME: Record<Weather, string> = {
  clear: '맑음',
  cloudy: '흐림',
  snow: '눈',
  rain: '비',
  wind: '바람',
  leaves: '낙엽',
  blossom: '꽃잎',
};

/** What each month may bring, with weights. */
function chances(month: number): [Weather, number][] {
  if (month === 11 || month === 12 || month === 1 || month === 2) return [['snow', 35], ['wind', 20], ['rain', 12], ['cloudy', 15], ['clear', 18]];
  if (month >= 3 && month <= 5) return [['blossom', 25], ['rain', 18], ['wind', 12], ['clear', 45]];
  if (month >= 6 && month <= 8) return [['rain', month === 7 ? 45 : 28], ['cloudy', 20], ['clear', 52]];
  return [['leaves', 35], ['wind', 12], ['rain', 15], ['clear', 38]];
}

/** The weather at a moment. `?weather=snow` in the address forces one, to look at. */
export function weatherAt(now = new Date()): Weather {
  const forced = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('weather') : null;
  if (forced && forced in WEATHER_NAME) return forced as Weather;
  const slot = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${Math.floor(now.getHours() / 3)}`;
  let x = [...slot].reduce((a, c) => (a * 131 + c.charCodeAt(0)) >>> 0, 17);
  x = (x * 1103515245 + 12345) >>> 0;
  const list = chances(now.getMonth() + 1);
  let roll = x % list.reduce((n, [, w]) => n + w, 0);
  for (const [w, n] of list) {
    if (roll < n) return w;
    roll -= n;
  }
  return 'clear';
}

const KEY = 'argusdesk.weather';
export function weatherOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}
export function setWeatherOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '' : 'off');
  } catch {
    /* for this run only */
  }
}
