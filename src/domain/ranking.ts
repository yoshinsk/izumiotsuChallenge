// src/domain/ranking.ts
// 機能要約: CSV走行データを午前・午後・体験コース別ランキングへ変換する集計ロジック。

export const COURSE_MORNING = "午前コース";
export const COURSE_AFTERNOON = "午後コース";
export const COURSE_EXPERIENCE = "体験コース";
export const COURSES = [COURSE_MORNING, COURSE_AFTERNOON, COURSE_EXPERIENCE] as const;

export type CourseName = (typeof COURSES)[number];

export type LapRecord = {
  lapId: string;
  runOrder: number;
  carNumber: string;
  carName: string;
  startTimeMs: number | null;
  finishTimeMs: number | null;
  missCourseCount: number;
  pylonTouchCount: number;
  twoWheelOffCourseCount: number;
  fourWheelOffCourseCount: number;
  totalLapTimeMs: number;
  lapTimeString: string;
};

export type CourseLap = {
  lap: LapRecord;
  course: CourseName;
};

export type RankingRow = {
  rank: number;
  carNumber: string;
  carName: string;
  valueText: string;
  detailText: string;
};

export type RankingTables = {
  bestLap: RankingRow[];
  worstLapGap: RankingRow[];
  missCourseTotal: RankingRow[];
  pylonTouchTotal: RankingRow[];
  twoWheelOffTotal: RankingRow[];
};

export type RankingOptions = {
  topN?: number;
};

type CarStats = {
  carNumber: string;
  names: Map<string, number>;
  laps: LapRecord[];
};

export const categoryLabels: Record<keyof RankingTables, string> = {
  bestLap: "ベスト走行",
  worstLapGap: "ワースト走行 & ベストとの差",
  missCourseTotal: "ミスコース総数 (MC + 4脱)",
  pylonTouchTotal: "パイロンタッチ総数",
  twoWheelOffTotal: "脱輪総数 (2脱)"
};

export function classifyByTime(laps: LapRecord[], experienceRules: string, cutoffText: string): CourseLap[] {
  const cutoffMinutes = parseCutoffMinutes(cutoffText);

  return laps.map((lap) => {
    if (!isInstructorCarNumber(lap.carNumber) && isExperienceCarNumber(lap.carNumber, experienceRules)) {
      return { lap, course: COURSE_EXPERIENCE };
    }

    const eventTimeMs = lap.startTimeMs ?? lap.finishTimeMs;
    if (eventTimeMs === null) {
      return { lap, course: COURSE_MORNING };
    }

    const eventTime = new Date(eventTimeMs);
    const eventMinutes = eventTime.getHours() * 60 + eventTime.getMinutes();
    return {
      lap,
      course: eventMinutes < cutoffMinutes ? COURSE_MORNING : COURSE_AFTERNOON
    };
  });
}

export function classifyAsMorningSnapshot(laps: LapRecord[], experienceRules: string): CourseLap[] {
  return laps.map((lap) => ({
    lap,
    course: !isInstructorCarNumber(lap.carNumber) && isExperienceCarNumber(lap.carNumber, experienceRules) ? COURSE_EXPERIENCE : COURSE_MORNING
  }));
}

export function classifyAsAfternoonSnapshot(
  laps: LapRecord[],
  experienceRules: string,
  morningLapIds: Set<string>
): CourseLap[] {
  return laps.map((lap) => {
    if (!isInstructorCarNumber(lap.carNumber) && isExperienceCarNumber(lap.carNumber, experienceRules)) {
      return { lap, course: COURSE_EXPERIENCE };
    }

    return {
      lap,
      course: morningLapIds.has(lap.lapId) ? COURSE_MORNING : COURSE_AFTERNOON
    };
  });
}

export function buildRankings(courseLaps: CourseLap[], options: RankingOptions = {}): RankingTables {
  const statsList = [...groupByCar(courseLaps).values()];

  return {
    bestLap: rankBestLap(statsList, options),
    worstLapGap: rankWorstLapGap(statsList, options),
    missCourseTotal: rankCountTotal(
      statsList,
      options,
      (stats) => stats.laps.reduce((sum, lap) => sum + lap.missCourseCount + lap.fourWheelOffCourseCount, 0),
      (stats) => {
        const miss = stats.laps.reduce((sum, lap) => sum + lap.missCourseCount, 0);
        const fourOff = stats.laps.reduce((sum, lap) => sum + lap.fourWheelOffCourseCount, 0);
        return `MC ${miss} / 4脱 ${fourOff}`;
      }
    ),
    pylonTouchTotal: rankCountTotal(
      statsList,
      options,
      (stats) => stats.laps.reduce((sum, lap) => sum + lap.pylonTouchCount, 0),
      (stats) => `PT ${stats.laps.reduce((sum, lap) => sum + lap.pylonTouchCount, 0)}`
    ),
    twoWheelOffTotal: rankCountTotal(
      statsList,
      options,
      (stats) => stats.laps.reduce((sum, lap) => sum + lap.twoWheelOffCourseCount, 0),
      (stats) => `2脱 ${stats.laps.reduce((sum, lap) => sum + lap.twoWheelOffCourseCount, 0)}`
    )
  };
}

export function countByCourse(courseLaps: CourseLap[]): Record<CourseName, number> {
  return COURSES.reduce(
    (counts, course) => {
      counts[course] = courseLaps.filter((courseLap) => courseLap.course === course).length;
      return counts;
    },
    {} as Record<CourseName, number>
  );
}

export function formatMilliseconds(milliseconds: number): string {
  const sign = milliseconds < 0 ? "-" : "";
  const absolute = Math.abs(milliseconds);
  const minutes = Math.floor(absolute / 60_000);
  const seconds = Math.floor((absolute % 60_000) / 1000);
  const millis = absolute % 1000;

  if (minutes > 0) {
    return `${sign}${minutes}’${seconds.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
  }
  return `${sign}${seconds}.${millis.toString().padStart(3, "0")}`;
}

export function parseCutoffMinutes(cutoffText: string): number {
  const match = cutoffText.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error("午前/午後境界は 12:00 の形式で入力してください。");
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("午前/午後境界は 00:00 から 23:59 の範囲で入力してください。");
  }
  return hour * 60 + minute;
}

export function isExperienceCarNumber(carNumber: string, rulesText: string): boolean {
  const normalizedCarNumber = carNumber.trim();
  if (!normalizedCarNumber) {
    return false;
  }

  return rulesText
    .split(/[,\n、，]+/)
    .map((rule) => rule.trim())
    .filter(Boolean)
    .some((rule) => matchesCarNumberRule(normalizedCarNumber, rule));
}

export function isInstructorCarNumber(carNumber: string): boolean {
  return carNumber.trim().toUpperCase().startsWith("M");
}

function groupByCar(courseLaps: CourseLap[]): Map<string, CarStats> {
  const statsByCar = new Map<string, CarStats>();

  for (const courseLap of courseLaps) {
    const { lap } = courseLap;
    const existing = statsByCar.get(lap.carNumber);
    const stats = existing ?? { carNumber: lap.carNumber, names: new Map<string, number>(), laps: [] };
    if (lap.carName) {
      stats.names.set(lap.carName, (stats.names.get(lap.carName) ?? 0) + 1);
    }
    stats.laps.push(lap);
    statsByCar.set(lap.carNumber, stats);
  }

  return statsByCar;
}

function rankBestLap(statsList: CarStats[], options: RankingOptions): RankingRow[] {
  const candidates = statsList
    .map((stats) => {
      const bestLap = [...stats.laps].sort((a, b) => a.totalLapTimeMs - b.totalLapTimeMs || a.runOrder - b.runOrder)[0];
      return { stats, bestLap };
    })
    .filter((candidate): candidate is { stats: CarStats; bestLap: LapRecord } => candidate !== null)
    .sort((a, b) => a.bestLap.totalLapTimeMs - b.bestLap.totalLapTimeMs || compareCarNumber(a.stats.carNumber, b.stats.carNumber));

  return limitRows(candidates, options.topN).map(({ stats, bestLap }, index) => ({
    rank: index + 1,
    carNumber: stats.carNumber,
    carName: representativeCarName(stats),
    valueText: bestLap.lapTimeString || formatMilliseconds(bestLap.totalLapTimeMs),
    detailText: `判定 ${bestLap.totalLapTimeMs.toLocaleString()} ms / 走行順 ${bestLap.runOrder}`
  }));
}

function rankWorstLapGap(statsList: CarStats[], options: RankingOptions): RankingRow[] {
  const candidates = statsList
    .map((stats) => {
      const ordered = [...stats.laps].sort((a, b) => a.totalLapTimeMs - b.totalLapTimeMs || a.runOrder - b.runOrder);
      const bestLap = ordered[0];
      const worstLap = ordered[ordered.length - 1];
      const gapMs = worstLap.totalLapTimeMs - bestLap.totalLapTimeMs;
      return { stats, bestLap, worstLap, gapMs };
    })
    .filter(
      (candidate): candidate is { stats: CarStats; bestLap: LapRecord; worstLap: LapRecord; gapMs: number } =>
        candidate !== null
    )
    .sort(
      (a, b) =>
        b.gapMs - a.gapMs ||
        b.worstLap.totalLapTimeMs - a.worstLap.totalLapTimeMs ||
        compareCarNumber(a.stats.carNumber, b.stats.carNumber)
    );

  return limitRows(candidates, options.topN).map(({ stats, bestLap, worstLap, gapMs }, index) => ({
    rank: index + 1,
    carNumber: stats.carNumber,
    carName: representativeCarName(stats),
    valueText: formatMilliseconds(gapMs),
    detailText: `ベスト ${bestLap.lapTimeString || formatMilliseconds(bestLap.totalLapTimeMs)} / ワースト ${
      worstLap.lapTimeString || formatMilliseconds(worstLap.totalLapTimeMs)
    }`
  }));
}

function rankCountTotal(
  statsList: CarStats[],
  options: RankingOptions,
  totalOf: (stats: CarStats) => number,
  detailOf: (stats: CarStats) => string
): RankingRow[] {
  return statsList
    .map((stats) => ({ stats, total: totalOf(stats), detail: detailOf(stats) }))
    .sort((a, b) => b.total - a.total || compareCarNumber(a.stats.carNumber, b.stats.carNumber))
    .slice(0, options.topN)
    .map(({ stats, total, detail }, index) => ({
      rank: index + 1,
      carNumber: stats.carNumber,
      carName: representativeCarName(stats),
      valueText: String(total),
      detailText: detail
    }));
}

function limitRows<T>(rows: T[], topN: number | undefined): T[] {
  if (topN === undefined) {
    return rows;
  }
  return rows.slice(0, topN);
}

function representativeCarName(stats: CarStats): string {
  return [...stats.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))[0]?.[0] ?? "";
}

function matchesCarNumberRule(carNumber: string, rule: string): boolean {
  if (rule.endsWith("*")) {
    return carNumber.toUpperCase().startsWith(rule.slice(0, -1).toUpperCase());
  }

  if (rule.includes("-")) {
    const [left, right] = rule.split("-", 2).map((part) => part.trim());
    return matchesCarNumberRange(carNumber, left, right);
  }

  return carNumber.toUpperCase() === rule.toUpperCase();
}

function matchesCarNumberRange(carNumber: string, left: string, right: string): boolean {
  const car = splitPrefixNumber(carNumber);
  if (car.number === null) {
    return false;
  }

  const lower = left ? splitPrefixNumber(left) : { prefix: "", number: null };
  const upper = right ? splitPrefixNumber(right) : { prefix: "", number: null };
  const expectedPrefix = lower.prefix || upper.prefix;

  if (expectedPrefix && car.prefix.toUpperCase() !== expectedPrefix.toUpperCase()) {
    return false;
  }
  if (!expectedPrefix && car.prefix) {
    return false;
  }
  if (lower.prefix && upper.prefix && lower.prefix.toUpperCase() !== upper.prefix.toUpperCase()) {
    return false;
  }

  const lowerOk = lower.number === null || car.number >= lower.number;
  const upperOk = upper.number === null || car.number <= upper.number;
  return lowerOk && upperOk;
}

function splitPrefixNumber(value: string): { prefix: string; number: number | null } {
  const match = value.trim().match(/^([^\d]*)(\d+)$/);
  if (!match) {
    return { prefix: value.trim(), number: null };
  }

  return {
    prefix: match[1],
    number: Number(match[2])
  };
}

function compareCarNumber(left: string, right: string): number {
  const a = splitPrefixNumber(left);
  const b = splitPrefixNumber(right);
  const prefixCompare = a.prefix.toUpperCase().localeCompare(b.prefix.toUpperCase(), "ja");
  if (prefixCompare !== 0) {
    return prefixCompare;
  }
  if (a.number !== null && b.number !== null && a.number !== b.number) {
    return a.number - b.number;
  }
  return left.localeCompare(right, "ja");
}
