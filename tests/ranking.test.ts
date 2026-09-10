// tests/ranking.test.ts
// 機能要約: サンプルCSVと合成データでランキング集計の仕様を検証する。

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import JSZip from "jszip";
import { describe, expect, test } from "vitest";
import { parseLapCsv } from "../src/domain/csv";
import { createRankingWorkbookBase64 } from "../src/domain/excel";
import {
  COURSE_AFTERNOON,
  COURSE_EXPERIENCE,
  COURSE_MORNING,
  CourseLap,
  LapRecord,
  RankingTables,
  buildRankings,
  classifyByTime,
  countByCourse,
  isExperienceCarNumber,
  isInstructorCarNumber
} from "../src/domain/ranking";
import { buildRankingWorkbookRows, pdfClassLabels } from "../src/domain/reports";

const sampleCsv = readFileSync(resolve("SampleData/result_2026_08_02-11_45_20.725.csv"), "utf8");

describe("ranking domain", () => {
  test("サンプルCSVを読み込める", () => {
    const laps = parseLapCsv(sampleCsv);
    expect(laps).toHaveLength(140);
    expect(laps[0].carNumber).toBe("M1");
    expect(laps[0].lapTimeString).toBe("56.675");
  });

  test("M付きゼッケンは体験設定より講師扱いを優先する", () => {
    const laps = parseLapCsv(sampleCsv);
    const classified = classifyByTime(laps, "M1-M999,900-999", "12:00");
    const counts = countByCourse(classified);
    expect(counts[COURSE_EXPERIENCE]).toBe(0);
    expect(counts[COURSE_MORNING]).toBe(140);
  });

  test("サンプルCSVの午前ベスト走行を算出する", () => {
    const laps = parseLapCsv(sampleCsv);
    const classified = classifyByTime(laps, "M1-M999,900-999", "12:00");
    const morning = buildRankings(
      classified.filter((courseLap) => courseLap.course === COURSE_MORNING),
      { topN: 3 }
    );

    expect(morning.bestLap[0].carNumber).toBe("M1");
    expect(morning.bestLap[0].valueText).toBe("53.768");
    expect(morning.bestLap[0].detailText).toBe("走行本数 3本目");
  });

  test("ベスト走行詳細はCSV全体ではなくゼッケンごとの走行本数を表示する", () => {
    const laps = [
      lap("run-10", "7", 12_000, { order: 10 }),
      lap("run-11", "8", 11_000, { order: 11 }),
      lap("run-93", "7", 10_000, { order: 93 })
    ];
    const tables = buildRankings(toMorning(laps));
    const target = tables.bestLap.find((row) => row.carNumber === "7");

    expect(target?.valueText).toBe("10.000");
    expect(target?.detailText).toBe("走行本数 2本目");
  });

  test("指定しなければ存在するゼッケンをすべて順位表示する", () => {
    const laps = parseLapCsv(sampleCsv);
    const classified = classifyByTime(laps, "900-999", "12:00").filter(
      (courseLap) => courseLap.course === COURSE_MORNING && !isInstructorCarNumber(courseLap.lap.carNumber)
    );
    const tables = buildRankings(classified);
    expect(tables.bestLap).toHaveLength(21);
    expect(tables.worstLapGap).toHaveLength(21);
  });

  test("ワースト走行差はMCをタイムに加算せずTotalLapTimeだけで比較する", () => {
    const laps = [lap("a", "1", 10_000), lap("b", "1", 50_000, { miss: 1 }), lap("c", "1", 12_000)];
    const tables = buildRankings(toMorning(laps));
    expect(tables.worstLapGap[0].valueText).toBe("40.000");
    expect(tables.worstLapGap[0].detailText).toContain("ワースト 50.000");
  });

  test("総数ランキングは指定列を合算する", () => {
    const laps = [lap("a", "7", 10_000, { miss: 1, four: 1, pylon: 2, two: 1 }), lap("b", "7", 11_000, { four: 1, two: 2 })];
    const tables = buildRankings(toMorning(laps));
    expect(tables.missCourseTotal[0].valueText).toBe("3");
    expect(tables.pylonTouchTotal[0].valueText).toBe("2");
    expect(tables.twoWheelOffTotal[0].valueText).toBe("3");
  });

  test("総数ランキングは合計0件のゼッケンを表示しない", () => {
    const laps = [lap("a", "7", 10_000), lap("b", "8", 11_000, { miss: 1 })];
    const tables = buildRankings(toMorning(laps));
    expect(tables.missCourseTotal.map((row) => row.carNumber)).toEqual(["8"]);
    expect(tables.pylonTouchTotal).toHaveLength(0);
    expect(tables.twoWheelOffTotal).toHaveLength(0);
  });

  test("体験コースのゼッケン範囲指定を判定する", () => {
    expect(isExperienceCarNumber("M12", "M1-M999")).toBe(true);
    expect(isExperienceCarNumber("950", "900-999")).toBe(true);
    expect(isExperienceCarNumber("MABC", "M*")).toBe(true);
    expect(isExperienceCarNumber("12", "M1-M999")).toBe(false);
  });

  test("M付きゼッケンを講師として判定する", () => {
    expect(isInstructorCarNumber("M1")).toBe(true);
    expect(isInstructorCarNumber("m4")).toBe(true);
    expect(isInstructorCarNumber("14")).toBe(false);
  });

  test("Excel出力はxlsx構造とランキング行を生成する", async () => {
    const tables = buildRankings(toMorning([lap("a", "7", 10_000), lap("b", "8", 11_000, { pylon: 1 })]));
    const rows = buildRankingWorkbookRows(
      {
        [COURSE_MORNING]: tables,
        [COURSE_AFTERNOON]: emptyTables(),
        [COURSE_EXPERIENCE]: emptyTables()
      },
      "2026-09-10 12:00:00"
    );
    const zip = await JSZip.loadAsync(Buffer.from(await createRankingWorkbookBase64(rows), "base64"));
    const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
    const sheetXml = await zip.file("xl/worksheets/sheet1.xml")?.async("string");

    expect(workbookXml).toContain("ランキング");
    expect(sheetXml).toContain("泉大津Challenge エンジョイランキング");
    expect(sheetXml).toContain("午前コース");
    expect(sheetXml).toContain("パイロンタッチ総数");
    expect(sheetXml).toContain("走行本数 1本目");
    expect(sheetXml).not.toContain("判定");
    expect(sheetXml).not.toContain("走行順");
  });

  test("PDF用クラス名を指定名称へ置き換える", () => {
    expect(pdfClassLabels.bestLap).toBe("速さランキング");
    expect(pdfClassLabels.worstLapGap).toBe("成長した人？ランキング");
    expect(pdfClassLabels.missCourseTotal).toBe("慣熟推奨ランキング");
    expect(pdfClassLabels.pylonTouchTotal).toBe("パイロン破壊魔神ランキング");
    expect(pdfClassLabels.twoWheelOffTotal).toBe("枠にハマらないランキング");
  });
});

function toMorning(laps: LapRecord[]): CourseLap[] {
  return laps.map((item) => ({ lap: item, course: COURSE_MORNING }));
}

function emptyTables(): RankingTables {
  return {
    bestLap: [],
    worstLapGap: [],
    missCourseTotal: [],
    pylonTouchTotal: [],
    twoWheelOffTotal: []
  };
}

function lap(
  lapId: string,
  carNumber: string,
  totalLapTimeMs: number,
  counts: { miss?: number; four?: number; pylon?: number; two?: number; order?: number } = {}
): LapRecord {
  return {
    lapId,
    runOrder: counts.order ?? lapId.length,
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
