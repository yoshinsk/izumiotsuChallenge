// src/App.tsx
// 機能要約: CSV選択、読み込みモード、設定折りたたみ、ランキング表示、Excel/PDF保存をまとめるReact画面。

import { type DragEvent, useMemo, useState } from "react";
import { decodeCsvBase64, parseLapCsv } from "./domain/csv";
import { createRankingWorkbookBase64 } from "./domain/excel";
import {
  COURSE_AFTERNOON,
  COURSE_EXPERIENCE,
  COURSE_MORNING,
  COURSES,
  CourseLap,
  CourseName,
  RankingTables,
  buildRankings,
  classifyAsAfternoonSnapshot,
  classifyAsMorningSnapshot,
  classifyByTime,
  countByCourse,
  isInstructorCarNumber,
  parseCutoffMinutes
} from "./domain/ranking";
import {
  RankingCategory,
  buildRankingWorkbookRows,
  pdfClassLabels,
  rankingCategoryConfig
} from "./domain/reports";

type Settings = {
  experienceRules: string;
  cutoffTime: string;
  excludeInstructorRuns: boolean;
};

const DEFAULT_SETTINGS: Settings = {
  experienceRules: "900-999",
  cutoffTime: "12:00",
  excludeInstructorRuns: true
};

const STORAGE_KEY = "izumiotsu-ranking-settings";

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [activeCategory, setActiveCategory] = useState<RankingCategory>("bestLap");
  const [isSettingsHidden, setIsSettingsHidden] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [csvPath, setCsvPath] = useState("");
  const [csvFileName, setCsvFileName] = useState("未選択");
  const [records, setRecords] = useState<Map<string, CourseLap>>(new Map());
  const [morningLapIds, setMorningLapIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("CSVを選択して読み込みモードを押してください。");
  const [error, setError] = useState("");

  const allCourseLaps = useMemo(() => [...records.values()], [records]);
  const rankingCourseLaps = useMemo(() => {
    if (!settings.excludeInstructorRuns) {
      return allCourseLaps;
    }
    return allCourseLaps.filter((courseLap) => !isInstructorCarNumber(courseLap.lap.carNumber));
  }, [allCourseLaps, settings.excludeInstructorRuns]);
  const excludedInstructorCount = allCourseLaps.length - rankingCourseLaps.length;
  const courseCounts = useMemo(() => countByCourse(rankingCourseLaps), [rankingCourseLaps]);
  const rankingsByCourse = useMemo(() => {
    return COURSES.reduce(
      (tables, course) => {
        tables[course] = buildRankings(
          rankingCourseLaps.filter((courseLap) => courseLap.course === course)
        );
        return tables;
      },
      {} as Record<CourseName, RankingTables>
    );
  }, [rankingCourseLaps]);

  const timeRange = useMemo(() => formatTimeRange(allCourseLaps), [allCourseLaps]);

  async function selectCsv() {
    const selected = await window.rankingApi.selectCsvFile();
    if (selected) {
      setCsvPath(selected);
      setCsvFileName(fileNameFromPath(selected));
      setError("");
      setMessage("CSVを選択しました。読み込みモードを押してください。");
    }
  }

  async function importByTime(filePathOverride?: string, successMessage = "時刻判定で読み込みました。") {
    const laps = await readCurrentCsv(filePathOverride);
    if (!laps || !validateSettings()) {
      return;
    }

    const classified = classifyByTime(laps, settings.experienceRules, settings.cutoffTime);
    setRecords(mapByLapId(classified));
    setMorningLapIds(
      new Set(classified.filter((courseLap) => courseLap.course === COURSE_MORNING).map((courseLap) => courseLap.lap.lapId))
    );
    persistSettings(settings);
    setMessage(successMessage);
  }

  async function importAsMorning() {
    const laps = await readCurrentCsv();
    if (!laps || !validateSettings()) {
      return;
    }

    const classified = classifyAsMorningSnapshot(laps, settings.experienceRules);
    setRecords(mapByLapId(classified));
    setMorningLapIds(
      new Set(classified.filter((courseLap) => courseLap.course === COURSE_MORNING).map((courseLap) => courseLap.lap.lapId))
    );
    persistSettings(settings);
    setMessage("午前CSVとして登録しました。午後終了後は累積CSVを選んで午後CSV(累積)として登録してください。");
  }

  async function importAsAfternoonSnapshot() {
    const laps = await readCurrentCsv();
    if (!laps || !validateSettings()) {
      return;
    }

    const classified = classifyAsAfternoonSnapshot(laps, settings.experienceRules, morningLapIds);
    setRecords(mapByLapId(classified));
    persistSettings(settings);
    setMessage(
      morningLapIds.size === 0
        ? "午前CSVが未登録のため、体験コース以外の全走行を午後コースとして登録しました。"
        : "午前CSVとの差分を午後コースとして登録しました。"
    );
  }

  function clearData() {
    setRecords(new Map());
    setMorningLapIds(new Set());
    setMessage("集計データを消去しました。CSVを選択して再読み込みしてください。");
    setError("");
  }

  function saveSettings() {
    if (!validateSettings()) {
      return;
    }
    persistSettings(settings);
    setMessage("設定を保存し、現在のデータで再集計しました。");
  }

  function exitApp() {
    void window.rankingApi.quitApp();
  }

  async function exportExcel() {
    if (rankingCourseLaps.length === 0) {
      setError("先にCSVを読み込んでください。");
      return;
    }

    const now = new Date();
    const rows = buildRankingWorkbookRows(rankingsByCourse, formatDateTime(now));
    const defaultName = `泉大津チャレンジランキング_${formatExportTimestamp(now)}.xlsx`;
    const savedPath = await window.rankingApi.saveExcelFile({
      defaultName,
      base64: await createRankingWorkbookBase64(rows)
    });

    if (savedPath) {
      setError("");
      setMessage(`ランキングExcelを保存しました: ${savedPath}`);
    }
  }

  async function exportPdf(course: CourseName, categoryKey: RankingCategory, rows: RankingTables[RankingCategory]) {
    if (rows.length === 0) {
      setError("PDF保存できるリザルトがありません。");
      return;
    }

    const className = pdfClassLabels[categoryKey];
    const defaultName = `泉大津Challenge_${sanitizeFileName(course)}_${sanitizeFileName(className)}_${formatExportTimestamp(new Date())}.pdf`;
    const savedPath = await window.rankingApi.savePdfFile({
      defaultName,
      course,
      className,
      rows
    });

    if (savedPath) {
      setError("");
      setMessage(`リザルトPDFを保存しました: ${savedPath}`);
    }
  }

  async function readCurrentCsv(filePathOverride?: string) {
    setError("");
    const path = filePathOverride || csvPath || (await window.rankingApi.selectCsvFile());
    if (!path) {
      return null;
    }

    try {
      const file = await window.rankingApi.readCsvFile(path);
      const text = decodeCsvBase64(file.base64);
      const laps = parseLapCsv(text);
      setCsvPath(file.filePath);
      setCsvFileName(file.fileName);
      return laps;
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      setError(detail);
      return null;
    }
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (event.currentTarget === event.target) {
      setIsDragActive(false);
    }
  }

  async function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDragActive(false);

    const file = event.dataTransfer.files.item(0);
    if (!file) {
      return;
    }

    const droppedPath = window.rankingApi.getPathForFile(file);
    if (!droppedPath) {
      setError("ドロップしたCSVのパスを取得できませんでした。選択ボタンから指定してください。");
      return;
    }
    if (!droppedPath.toLowerCase().endsWith(".csv")) {
      setError("CSVファイルをドロップしてください。");
      return;
    }

    setCsvPath(droppedPath);
    setCsvFileName(fileNameFromPath(droppedPath));
    await importByTime(droppedPath, "CSVをドロップし、時刻判定で読み込みました。");
  }

  function validateSettings(): boolean {
    try {
      parseCutoffMinutes(settings.cutoffTime);
      setError("");
      return true;
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      setError(detail);
      return false;
    }
  }

  return (
    <main
      className={`${isDragActive ? "app-shell drag-active" : "app-shell"}${isSettingsHidden ? " settings-hidden" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(event) => void handleDrop(event)}
    >
      <section className="command-panel" aria-label="操作">
        <button type="button" className="panel-toggle-button" onClick={() => setIsSettingsHidden(!isSettingsHidden)}>
          {isSettingsHidden ? "設定" : "設定を隠す"}
        </button>

        {!isSettingsHidden && (
          <div className="panel-controls">
            <div className="brand-block">
              <p className="event-label">泉大津チャレンジ</p>
              <h1>エンジョイランキング</h1>
            </div>

            <div className="control-group">
              <label htmlFor="csvPath">走行結果CSV</label>
              <div className="file-row">
                <input
                  id="csvPath"
                  value={csvPath}
                  onChange={(event) => setCsvPath(event.target.value)}
                  placeholder="CSVファイルを選択またはドロップ"
                />
                <button type="button" onClick={selectCsv}>
                  選択
                </button>
              </div>
              <p className="file-name">{csvFileName}</p>
              <div className={isDragActive ? "drop-zone active" : "drop-zone"}>
                <strong>CSVをドロップして解析</strong>
                <span>ドロップ後に時刻で自動判定します</span>
              </div>
            </div>

            <div className="control-group">
              <span className="group-title">読み込みモード</span>
              <button type="button" className="primary-button" onClick={() => void importByTime()}>
                時刻で自動判定
              </button>
              <button type="button" onClick={importAsMorning}>
                午前CSVとして登録
              </button>
              <button type="button" onClick={importAsAfternoonSnapshot}>
                午後CSV(累積)として登録
              </button>
              <button type="button" className="quiet-button" onClick={clearData}>
                集計データを消去
              </button>
            </div>

            <div className="control-group">
              <span className="group-title">判定設定</span>
              <label htmlFor="experienceRules">体験コースゼッケン</label>
              <input
                id="experienceRules"
                value={settings.experienceRules}
                onChange={(event) => setSettings({ ...settings, experienceRules: event.target.value })}
              />
              <p className="field-help">例: 900-999、900-950,980、T*</p>
              <label htmlFor="cutoffTime">午前/午後境界</label>
              <input
                id="cutoffTime"
                className="short-input"
                value={settings.cutoffTime}
                onChange={(event) => setSettings({ ...settings, cutoffTime: event.target.value })}
              />
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={settings.excludeInstructorRuns}
                  onChange={(event) => setSettings({ ...settings, excludeInstructorRuns: event.target.checked })}
                />
                講師の走行を除外
              </label>
              <button type="button" onClick={saveSettings}>
                設定保存・再集計
              </button>
            </div>

            <div className="control-group">
              <span className="group-title">出力</span>
              <button type="button" onClick={() => void exportExcel()}>
                ランキングExcelを保存
              </button>
            </div>
          </div>
        )}

        <button type="button" className="exit-button" onClick={exitApp}>
          終了
        </button>
      </section>

      <section className="results-panel" aria-label="ランキング">
        <div className="status-strip">
          <div>
            <span>対象走行</span>
            <strong>{rankingCourseLaps.length}</strong>
          </div>
          <div>
            <span>午前</span>
            <strong>{courseCounts[COURSE_MORNING]}</strong>
          </div>
          <div>
            <span>午後</span>
            <strong>{courseCounts[COURSE_AFTERNOON]}</strong>
          </div>
          <div>
            <span>体験</span>
            <strong>{courseCounts[COURSE_EXPERIENCE]}</strong>
          </div>
        </div>

        <div className="notice-stack" aria-live="polite">
          {message && <p className="notice">{message}</p>}
          {error && <p className="error">{error}</p>}
          {timeRange && <p className="time-range">{timeRange}</p>}
          {settings.excludeInstructorRuns && excludedInstructorCount > 0 && (
            <p className="time-range">講師の走行 {excludedInstructorCount}件を除外中</p>
          )}
        </div>

        <div className="ranking-tabs" role="tablist" aria-label="順位項目">
          {rankingCategoryConfig.map((category) => (
            <button
              key={category.key}
              type="button"
              role="tab"
              aria-selected={activeCategory === category.key}
              className={activeCategory === category.key ? "ranking-tab active" : "ranking-tab"}
              onClick={() => setActiveCategory(category.key)}
            >
              {category.label}
            </button>
          ))}
        </div>

        <RankingCategoryPanel
          activeCategory={activeCategory}
          rankingsByCourse={rankingsByCourse}
          onExportPdf={(course, categoryKey, rows) => void exportPdf(course, categoryKey, rows)}
        />
      </section>
    </main>
  );
}

function RankingCategoryPanel({
  activeCategory,
  rankingsByCourse,
  onExportPdf
}: {
  activeCategory: RankingCategory;
  rankingsByCourse: Record<CourseName, RankingTables>;
  onExportPdf: (course: CourseName, categoryKey: RankingCategory, rows: RankingTables[RankingCategory]) => void;
}) {
  const category = rankingCategoryConfig.find((item) => item.key === activeCategory) ?? rankingCategoryConfig[0];

  return (
    <div className="category-grid" role="tabpanel">
      {COURSES.map((course) => {
        const rows = rankingsByCourse[course][category.key];
        return (
          <section className="course-ranking" key={course}>
            <header>
              <h2>{course}</h2>
              <span>{rows.length}件</span>
            </header>
            <RankingTable title={category.label} rows={rows} valueLabel={category.valueLabel} />
            <div className="result-actions">
              <button type="button" disabled={rows.length === 0} onClick={() => onExportPdf(course, category.key, rows)}>
                PDFでダウンロード
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function RankingTable({ title, rows, valueLabel }: { title: string; rows: RankingTables[keyof RankingTables]; valueLabel: string }) {
  return (
    <section className="ranking-block">
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            <th>位</th>
            <th>ゼッケン</th>
            <th>車名</th>
            <th>{valueLabel}</th>
            <th>詳細</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="empty-cell">
                該当なし
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={`${title}-${row.rank}-${row.carNumber}`}>
                <td>{row.rank}</td>
                <td>{row.carNumber}</td>
                <td>{row.carName}</td>
                <td className="value-cell">{row.valueText}</td>
                <td>{row.detailText}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}

function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return DEFAULT_SETTINGS;
    }
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function normalizeSettings(settings: Settings): Settings {
  if (settings.experienceRules === "M1-M999,900-999") {
    return { ...settings, experienceRules: DEFAULT_SETTINGS.experienceRules };
  }
  return settings;
}

function mapByLapId(courseLaps: CourseLap[]): Map<string, CourseLap> {
  return new Map(courseLaps.map((courseLap) => [courseLap.lap.lapId, courseLap]));
}

function formatTimeRange(courseLaps: CourseLap[]): string {
  const times = courseLaps
    .map((courseLap) => courseLap.lap.startTimeMs ?? courseLap.lap.finishTimeMs)
    .filter((time): time is number => time !== null);
  if (times.length === 0) {
    return "";
  }

  return `走行時刻: ${formatDateTime(new Date(Math.min(...times)))} - ${formatDateTime(new Date(Math.max(...times)))}`;
}

function formatDateTime(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function formatExportTimestamp(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1) ?? filePath;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_");
}
