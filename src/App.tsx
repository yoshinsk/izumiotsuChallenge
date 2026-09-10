// src/App.tsx
// 機能要約: CSV選択、読み込みモード、設定、ランキング表示、CSV保存をまとめるReact画面。

import { useMemo, useState } from "react";
import { decodeCsvBase64, parseLapCsv, rankingsToCsv } from "./domain/csv";
import {
  COURSE_AFTERNOON,
  COURSE_EXPERIENCE,
  COURSE_MORNING,
  COURSES,
  CourseLap,
  CourseName,
  RankingTables,
  buildRankings,
  categoryLabels,
  classifyAsAfternoonSnapshot,
  classifyAsMorningSnapshot,
  classifyByTime,
  countByCourse,
  parseCutoffMinutes
} from "./domain/ranking";

type Settings = {
  experienceRules: string;
  cutoffTime: string;
  excludeMissCourseLaps: boolean;
  hideZeroTotals: boolean;
};

const DEFAULT_SETTINGS: Settings = {
  experienceRules: "M1-M999,900-999",
  cutoffTime: "12:00",
  excludeMissCourseLaps: true,
  hideZeroTotals: true
};

const STORAGE_KEY = "izumiotsu-ranking-settings";

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [csvPath, setCsvPath] = useState("");
  const [csvFileName, setCsvFileName] = useState("未選択");
  const [records, setRecords] = useState<Map<string, CourseLap>>(new Map());
  const [morningLapIds, setMorningLapIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("CSVを選択して読み込みモードを押してください。");
  const [error, setError] = useState("");

  const allCourseLaps = useMemo(() => [...records.values()], [records]);
  const courseCounts = useMemo(() => countByCourse(allCourseLaps), [allCourseLaps]);
  const rankingsByCourse = useMemo(() => {
    return COURSES.reduce(
      (tables, course) => {
        tables[course] = buildRankings(
          allCourseLaps.filter((courseLap) => courseLap.course === course),
          {
            topN: 3,
            excludeMissCourseLaps: settings.excludeMissCourseLaps,
            hideZeroTotals: settings.hideZeroTotals
          }
        );
        return tables;
      },
      {} as Record<CourseName, RankingTables>
    );
  }, [allCourseLaps, settings.excludeMissCourseLaps, settings.hideZeroTotals]);

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

  async function importByTime() {
    const laps = await readCurrentCsv();
    if (!laps || !validateSettings()) {
      return;
    }

    const classified = classifyByTime(laps, settings.experienceRules, settings.cutoffTime);
    setRecords(mapByLapId(classified));
    setMorningLapIds(
      new Set(classified.filter((courseLap) => courseLap.course === COURSE_MORNING).map((courseLap) => courseLap.lap.lapId))
    );
    persistSettings(settings);
    setMessage("時刻判定で読み込みました。");
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

  async function exportCsv() {
    if (allCourseLaps.length === 0) {
      setError("先にCSVを読み込んでください。");
      return;
    }

    const rows = [["Course", "Category", "Rank", "CarNumber", "CarName", "Value", "Detail"]];
    for (const course of COURSES) {
      const tables = rankingsByCourse[course];
      for (const [key, label] of Object.entries(categoryLabels) as [keyof RankingTables, string][]) {
        for (const row of tables[key]) {
          rows.push([course, label, String(row.rank), row.carNumber, row.carName, row.valueText, row.detailText]);
        }
      }
    }

    const defaultName = `泉大津チャレンジランキング_${formatExportTimestamp(new Date())}.csv`;
    const savedPath = await window.rankingApi.saveCsvFile({
      defaultName,
      content: rankingsToCsv(rows)
    });

    if (savedPath) {
      setError("");
      setMessage(`ランキングCSVを保存しました: ${savedPath}`);
    }
  }

  async function readCurrentCsv() {
    setError("");
    const path = csvPath || (await window.rankingApi.selectCsvFile());
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
    <main className="app-shell">
      <section className="command-panel" aria-label="操作">
        <div className="brand-block">
          <p className="event-label">泉大津チャレンジ</p>
          <h1>エンジョイランキング</h1>
        </div>

        <div className="control-group">
          <label htmlFor="csvPath">走行結果CSV</label>
          <div className="file-row">
            <input id="csvPath" value={csvPath} onChange={(event) => setCsvPath(event.target.value)} placeholder="CSVファイルを選択" />
            <button type="button" onClick={selectCsv}>
              選択
            </button>
          </div>
          <p className="file-name">{csvFileName}</p>
        </div>

        <div className="control-group">
          <span className="group-title">読み込みモード</span>
          <button type="button" className="primary-button" onClick={importByTime}>
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
              checked={settings.excludeMissCourseLaps}
              onChange={(event) => setSettings({ ...settings, excludeMissCourseLaps: event.target.checked })}
            />
            ラップ順位からMC走行を除外
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.hideZeroTotals}
              onChange={(event) => setSettings({ ...settings, hideZeroTotals: event.target.checked })}
            />
            総数0の順位を非表示
          </label>
          <button type="button" onClick={saveSettings}>
            設定保存・再集計
          </button>
        </div>

        <div className="control-group">
          <span className="group-title">出力</span>
          <button type="button" onClick={exportCsv}>
            ランキングCSVを保存
          </button>
        </div>
      </section>

      <section className="results-panel" aria-label="ランキング">
        <div className="status-strip">
          <div>
            <span>総走行</span>
            <strong>{allCourseLaps.length}</strong>
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
        </div>

        <div className="course-grid">
          {COURSES.map((course) => (
            <CourseBoard key={course} course={course} tables={rankingsByCourse[course]} />
          ))}
        </div>
      </section>
    </main>
  );
}

function CourseBoard({ course, tables }: { course: CourseName; tables: RankingTables }) {
  return (
    <section className="course-board">
      <header>
        <h2>{course}</h2>
      </header>
      <RankingTable title={categoryLabels.bestLap} rows={tables.bestLap} valueLabel="タイム" />
      <RankingTable title={categoryLabels.worstLapGap} rows={tables.worstLapGap} valueLabel="差" />
      <RankingTable title={categoryLabels.missCourseTotal} rows={tables.missCourseTotal} valueLabel="総数" />
      <RankingTable title={categoryLabels.pylonTouchTotal} rows={tables.pylonTouchTotal} valueLabel="総数" />
      <RankingTable title={categoryLabels.twoWheelOffTotal} rows={tables.twoWheelOffTotal} valueLabel="総数" />
    </section>
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
    return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
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
