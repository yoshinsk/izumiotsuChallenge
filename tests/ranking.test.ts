// tests/ranking.test.ts
// 機能要約: サンプルCSVと合成データでランキング集計の仕様を検証する。

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { parseLapCsv } from "../src/domain/csv";
import {
  COURSE_EXPERIENCE,
  COURSE_MORNING,
  CourseLap,
  LapRecord,
  buildRankings,
  classifyByTime,
  countByCourse,
  isExperienceCarNumber
} from "../src/domain/ranking";

const sampleCsv = readFileSync(resolve("SampleData/result_2026_08_02-11_45_20.725.csv"), "utf8");

describe("ranking domain", () => {
  test("サンプルCSVを読み込める", () => {
    const laps = parseLapCsv(sampleCsv);
    expect(laps).toHaveLength(140);
    expect(laps[0].carNumber).toBe("M1");
    expect(laps[0].lapTimeString).toBe("56.675");
  });

  test("既定の体験ゼッケン設定でMゼッケンを体験コースへ分類する", () => {
    const laps = parseLapCsv(sampleCsv);
    const classified = classifyByTime(laps, "M1-M999,900-999", "12:00");
    const counts = countByCourse(classified);
    expect(counts[COURSE_EXPERIENCE]).toBe(11);
    expect(counts[COURSE_MORNING]).toBe(129);
  });

  test("サンプルCSVの午前と体験のベストラップを算出する", () => {
    const laps = parseLapCsv(sampleCsv);
    const classified = classifyByTime(laps, "M1-M999,900-999", "12:00");
    const morning = buildRankings(
      classified.filter((courseLap) => courseLap.course === COURSE_MORNING),
      { topN: 3, excludeMissCourseLaps: true, hideZeroTotals: true }
    );
    const experience = buildRankings(
      classified.filter((courseLap) => courseLap.course === COURSE_EXPERIENCE),
      { topN: 3, excludeMissCourseLaps: true, hideZeroTotals: true }
    );

    expect(morning.bestLap[0].carNumber).toBe("18");
    expect(morning.bestLap[0].valueText).toBe("56.103");
    expect(experience.bestLap[0].carNumber).toBe("M1");
    expect(experience.bestLap[0].valueText).toBe("53.768");
  });

  test("ワーストラップ差は初期設定でMC走行を除外する", () => {
    const laps = [lap("a", "1", 10_000), lap("b", "1", 50_000, { miss: 1 }), lap("c", "1", 12_000)];
    const tables = buildRankings(toMorning(laps), { topN: 3, excludeMissCourseLaps: true, hideZeroTotals: true });
    expect(tables.worstLapGap[0].valueText).toBe("2.000");
    expect(tables.worstLapGap[0].detailText).toContain("ワースト 12.000");
  });

  test("総数ランキングは指定列を合算する", () => {
    const laps = [lap("a", "7", 10_000, { miss: 1, four: 1, pylon: 2, two: 1 }), lap("b", "7", 11_000, { four: 1, two: 2 })];
    const tables = buildRankings(toMorning(laps), { topN: 3, excludeMissCourseLaps: true, hideZeroTotals: true });
    expect(tables.missCourseTotal[0].valueText).toBe("3");
    expect(tables.pylonTouchTotal[0].valueText).toBe("2");
    expect(tables.twoWheelOffTotal[0].valueText).toBe("3");
  });

  test("体験コースのゼッケン範囲指定を判定する", () => {
    expect(isExperienceCarNumber("M12", "M1-M999")).toBe(true);
    expect(isExperienceCarNumber("950", "900-999")).toBe(true);
    expect(isExperienceCarNumber("MABC", "M*")).toBe(true);
    expect(isExperienceCarNumber("12", "M1-M999")).toBe(false);
  });
});

function toMorning(laps: LapRecord[]): CourseLap[] {
  return laps.map((item) => ({ lap: item, course: COURSE_MORNING }));
}

function lap(
  lapId: string,
  carNumber: string,
  totalLapTimeMs: number,
  counts: { miss?: number; four?: number; pylon?: number; two?: number } = {}
): LapRecord {
  return {
    lapId,
    runOrder: lapId.length,
    carNumber,
    carName: "テスト車両",
    startTimeMs: 1_785_600_000_000,
    finishTimeMs: 1_785_600_010_000,
    missCourseCount: counts.miss ?? 0,
    pylonTouchCount: counts.pylon ?? 0,
    twoWheelOffCourseCount: counts.two ?? 0,
    fourWheelOffCourseCount: counts.four ?? 0,
    totalLapTimeMs,
    lapTimeString: `${Math.floor(totalLapTimeMs / 1000)}.${String(totalLapTimeMs % 1000).padStart(3, "0")}`
  };
}
