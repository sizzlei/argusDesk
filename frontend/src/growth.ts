// The centre grows with the team: every centre level of the season puts
// something new in or around the building. Each season has its own list, so
// a new season brings new things; the old season's things go with it.

export type GrowthKind = 'yard' | 'led' | 'floor' | 'pet';

export interface GrowthItem {
  id: string;
  name: string;
  level: number; // the centre level that brings it
  kind: GrowthKind; // yard: stands in the front yard; led/floor: changes the rooms; pet: walks the yard
  desc: string;
}

// Even years.
const SEASON_A: GrowthItem[] = [
  { id: 'sign', name: '센터 간판', level: 2, kind: 'yard', desc: '앞마당 입구에 센터 이름이 걸립니다.' },
  { id: 'planters', name: '꽃 화단', level: 3, kind: 'yard', desc: '앞마당에 꽃 화단이 생깁니다.' },
  { id: 'coffee', name: '커피 카트', level: 4, kind: 'yard', desc: '출근길 커피 한 잔. 김이 모락모락 납니다.' },
  { id: 'led', name: '서버 랙 LED', level: 5, kind: 'led', desc: '서버실 램프가 무지갯빛으로 바뀝니다.' },
  { id: 'fountain', name: '분수', level: 6, kind: 'yard', desc: '앞마당 가운데에서 물이 솟습니다.' },
  { id: 'lamps', name: '가로등과 벤치', level: 7, kind: 'yard', desc: '저녁이면 불이 들어오는 가로등입니다.' },
  { id: 'floor', name: '바닥 리노베이션', level: 8, kind: 'floor', desc: '모든 방의 바닥에 새 타일을 깝니다.' },
  { id: 'cat', name: '센터 고양이', level: 10, kind: 'pet', desc: '앞마당을 어슬렁거리는 고양이가 들어옵니다.' },
  { id: 'arch', name: '꽃 아치', level: 12, kind: 'yard', desc: '앞마당 끝에 꽃으로 덮인 아치가 섭니다.' },
];

// Odd years.
const SEASON_B: GrowthItem[] = [
  { id: 'neon', name: '네온 간판', level: 2, kind: 'yard', desc: '앞마당 입구에 빛나는 간판이 걸립니다.' },
  { id: 'vending', name: '자판기', level: 3, kind: 'yard', desc: '음료 자판기가 들어옵니다.' },
  { id: 'bikes', name: '자전거 거치대', level: 4, kind: 'yard', desc: '팀 자전거가 줄지어 섭니다.' },
  { id: 'led', name: '서버 랙 LED', level: 5, kind: 'led', desc: '서버실 램프가 보랏빛으로 바뀝니다.' },
  { id: 'pond', name: '연못', level: 6, kind: 'yard', desc: '작은 연못에 물결이 입니다.' },
  { id: 'parasol', name: '파라솔 테이블', level: 7, kind: 'yard', desc: '점심 먹기 좋은 파라솔 테이블입니다.' },
  { id: 'floor', name: '바닥 리노베이션', level: 8, kind: 'floor', desc: '모든 방의 바닥에 새 타일을 깝니다.' },
  { id: 'dog', name: '센터 강아지', level: 10, kind: 'pet', desc: '앞마당을 뛰어다니는 강아지가 들어옵니다.' },
  { id: 'telescope', name: '전망대 망원경', level: 12, kind: 'yard', desc: '앞마당 끝에 망원경이 섭니다.' },
];

/** The things a season brings, in the order they come. */
export function seasonItems(year: number): GrowthItem[] {
  return year % 2 === 0 ? SEASON_A : SEASON_B;
}

/** What the centre has at a level of a season. */
export function unlocked(level: number, year: number): GrowthItem[] {
  return seasonItems(year).filter((i) => level >= i.level);
}

/** What a level reached just now brings (from `from` up to `to`). */
export function arrived(from: number, to: number, year: number): GrowthItem[] {
  return seasonItems(year).filter((i) => i.level > from && i.level <= to);
}

/** The next thing to come, and at what level (null when all are in). */
export function nextItem(level: number, year: number): GrowthItem | null {
  return seasonItems(year).find((i) => i.level > level) ?? null;
}

/** The season's year, from when it started. */
export function seasonYear(since: string | undefined, now = new Date()): number {
  // the year as written: the start is midnight in the team's zone, which another zone would put in the year before
  const m = since ? /^(\d{4})-/.exec(since) : null;
  return m ? Number(m[1]) : now.getFullYear();
}

/**
 * Where each thing of the yard stands: a slot along the front of the building.
 * Fixed per season, so a thing never moves when another one arrives.
 */
export function yardSlot(id: string, year: number): number {
  return seasonItems(year)
    .filter((i) => i.kind === 'yard')
    .findIndex((i) => i.id === id);
}
