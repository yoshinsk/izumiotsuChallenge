// src/domain/csv.ts
// 機能要約: CSVの文字コード判定、CSV構文解析、走行データ型への変換を担当する。

import type { LapRecord } from "./ranking";

const REQUIRED_COLUMNS = [
  "LapID",
  "RunOrder",
  "CarNumber",
  "CarName",
  "StartTime",
  "FinishTime",
  "MissCourseCount",
  "PylonTouchCount",
  "TwoWheelOffCourseCount",
  "FourWheelOffCourseCount",
  "TotalLapTime",
  "LapTimeString"
] as const;

type RequiredColumn = (typeof REQUIRED_COLUMNS)[number];

export function decodeCsvBase64(base64: string): string {
  const bytes = base64ToBytes(base64);
  const decodeAttempts = ["utf-8", "shift_jis"];

  for (const encoding of decodeAttempts) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
    } catch {
      // 次の候補文字コードを試す。最後まで失敗した場合のみ明示エラーにする。
    }
  }

  throw new Error("CSVの文字コードを判定できませんでした。UTF-8またはShift_JISのCSVを指定してください。");
}

export function parseLapCsv(csvText: string): LapRecord[] {
  const table = parseCsvTable(csvText);
  if (table.length === 0) {
    throw new Error("CSVにヘッダー行がありません。");
  }

  const headers = table[0].map((header) => header.trim());
  const columnIndex = new Map(headers.map((header, index) => [header, index]));
  const missing = REQUIRED_COLUMNS.filter((column) => !columnIndex.has(column));
  if (missing.length > 0) {
    throw new Error(`CSVに必要な列がありません: ${missing.join(", ")}`);
  }

  return table
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row, offset) => rowToLapRecord(row, columnIndex, offset + 2));
}

export function rankingsToCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

function parseCsvTable(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const nextChar = csvText[index + 1];

    if (char === "\"") {
      if (inQuotes && nextChar === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      continue;
    }

    cell += char;
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function rowToLapRecord(row: string[], columnIndex: Map<string, number>, rowNumber: number): LapRecord {
  return {
    lapId: requiredText(row, columnIndex, "LapID", rowNumber),
    runOrder: requiredInteger(row, columnIndex, "RunOrder", rowNumber),
    carNumber: requiredText(row, columnIndex, "CarNumber", rowNumber),
    carName: cell(row, columnIndex, "CarName").trim(),
    startTimeMs: optionalInteger(cell(row, columnIndex, "StartTime")),
    finishTimeMs: optionalInteger(cell(row, columnIndex, "FinishTime")),
    missCourseCount: requiredInteger(row, columnIndex, "MissCourseCount", rowNumber),
    pylonTouchCount: requiredInteger(row, columnIndex, "PylonTouchCount", rowNumber),
    twoWheelOffCourseCount: requiredInteger(row, columnIndex, "TwoWheelOffCourseCount", rowNumber),
    fourWheelOffCourseCount: requiredInteger(row, columnIndex, "FourWheelOffCourseCount", rowNumber),
    totalLapTimeMs: requiredInteger(row, columnIndex, "TotalLapTime", rowNumber),
    lapTimeString: cell(row, columnIndex, "LapTimeString").trim()
  };
}

function requiredText(row: string[], columnIndex: Map<string, number>, column: RequiredColumn, rowNumber: number): string {
  const value = cell(row, columnIndex, column).trim();
  if (!value) {
    throw new Error(`${rowNumber}行目の${column}が空です。`);
  }
  return value;
}

function requiredInteger(row: string[], columnIndex: Map<string, number>, column: RequiredColumn, rowNumber: number): number {
  const value = cell(row, columnIndex, column).trim();
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${rowNumber}行目の${column}が整数ではありません: ${value}`);
  }
  return parsed;
}

function optionalInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

function cell(row: string[], columnIndex: Map<string, number>, column: RequiredColumn): string {
  const index = columnIndex.get(column);
  return index === undefined ? "" : row[index] ?? "";
}

function escapeCsvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

