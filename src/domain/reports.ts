// src/domain/reports.ts
// 機能要約: 画面表示、Excel出力、PDF出力で共有する順位項目と出力行を定義する。

import { COURSES, CourseName, RankingRow, RankingTables, categoryLabels } from "./ranking";

export type RankingCategory = keyof RankingTables;
export type WorkbookCell = string | number;

export const rankingCategoryConfig: { key: RankingCategory; label: string; valueLabel: string }[] = [
  { key: "bestLap", label: categoryLabels.bestLap, valueLabel: "タイム" },
  { key: "worstLapGap", label: categoryLabels.worstLapGap, valueLabel: "差" },
  { key: "missCourseTotal", label: categoryLabels.missCourseTotal, valueLabel: "総数" },
  { key: "pylonTouchTotal", label: categoryLabels.pylonTouchTotal, valueLabel: "総数" },
  { key: "twoWheelOffTotal", label: categoryLabels.twoWheelOffTotal, valueLabel: "総数" }
];

export const pdfClassLabels: Record<RankingCategory, string> = {
  bestLap: "速さランキング",
  worstLapGap: "成長した人？ランキング",
  missCourseTotal: "慣熟推奨ランキング",
  pylonTouchTotal: "パイロン破壊魔神ランキング",
  twoWheelOffTotal: "枠にハマらないランキング"
};

export function buildRankingWorkbookRows(
  rankingsByCourse: Record<CourseName, RankingTables>,
  generatedAt: string
): WorkbookCell[][] {
  // Excel出力では、全コース・全順位項目を1シートに縦積みして現場で検索しやすくする。
  const rows: WorkbookCell[][] = [
    ["泉大津Challenge エンジョイランキング"],
    ["出力日時", generatedAt],
    [],
    ["コース", "順位項目", "順位", "ゼッケン", "車名", "値", "詳細"]
  ];

  for (const course of COURSES) {
    const tables = rankingsByCourse[course];
    for (const category of rankingCategoryConfig) {
      for (const row of tables[category.key]) {
        rows.push(rankingRowToWorkbookRow(course, categoryLabels[category.key], row));
      }
    }
  }

  return rows;
}

function rankingRowToWorkbookRow(course: CourseName, categoryLabel: string, row: RankingRow): WorkbookCell[] {
  return [course, categoryLabel, row.rank, row.carNumber, row.carName, row.valueText, row.detailText];
}
