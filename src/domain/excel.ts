// src/domain/excel.ts
// 機能要約: SyncAプロジェクトと同じJSZip方式で、ランキング行から軽量なExcel xlsxファイルを生成する。

import JSZip from "jszip";
import type { WorkbookCell } from "./reports";

export async function createRankingWorkbookBase64(rows: WorkbookCell[][], sheetName = "ランキング"): Promise<string> {
  const zip = new JSZip();
  const safeName = safeSheetName(sheetName);

  zip.file("[Content_Types].xml", contentTypesXml());
  zip.file("_rels/.rels", packageRelationshipsXml());
  zip.file("xl/workbook.xml", workbookXml(safeName));
  zip.file("xl/_rels/workbook.xml.rels", workbookRelationshipsXml());
  zip.file("xl/styles.xml", stylesXml());
  zip.file("xl/worksheets/sheet1.xml", worksheetXml(rows));

  return zip.generateAsync({ type: "base64" });
}

function worksheetXml(rows: WorkbookCell[][]): string {
  // SyncAプロジェクトと同様に、必要なOpenXMLだけをJSZipで組み立てて軽量なxlsxにする。
  const body = rows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const styleId = styleIdForRow(rowIndex);
      const cells = row
        .map((cell, columnIndex) => cellXml(cell, `${columnName(columnIndex)}${rowNumber}`, styleId))
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
  <cols>
    <col min="1" max="1" width="18" customWidth="1"/>
    <col min="2" max="2" width="30" customWidth="1"/>
    <col min="3" max="3" width="8" customWidth="1"/>
    <col min="4" max="4" width="12" customWidth="1"/>
    <col min="5" max="5" width="28" customWidth="1"/>
    <col min="6" max="6" width="14" customWidth="1"/>
    <col min="7" max="7" width="42" customWidth="1"/>
  </cols>
  <sheetData>${body}</sheetData>
</worksheet>`;
}

function cellXml(value: WorkbookCell, cellRef: string, styleId: number): string {
  // 順位は数値セル、それ以外の識別子や表示値はExcel側で崩れないようinlineStrとして保存する。
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${cellRef}" s="${styleId}"><v>${value}</v></c>`;
  }

  return `<c r="${cellRef}" t="inlineStr" s="${styleId}"><is><t>${escapeXml(String(value))}</t></is></c>`;
}

function styleIdForRow(rowIndex: number): number {
  // 1行目はタイトル、4行目は表ヘッダーとして固定スタイルを適用する。
  if (rowIndex === 0) {
    return 1;
  }
  if (rowIndex === 3) {
    return 2;
  }
  return 0;
}

function contentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
}

function packageRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookXml(sheetName: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

function workbookRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="Noto Sans JP"/></font>
    <font><b/><sz val="16"/><name val="Noto Sans JP"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Noto Sans JP"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF23272A"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD8DDD2"/></left><right style="thin"><color rgb="FFD8DDD2"/></right><top style="thin"><color rgb="FFD8DDD2"/></top><bottom style="thin"><color rgb="FFD8DDD2"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" horizontal="center"/></xf>
  </cellXfs>
</styleSheet>`;
}

function columnName(index: number): string {
  let value = "";
  for (let current = index; current >= 0; current = Math.floor(current / 26) - 1) {
    value = String.fromCharCode((current % 26) + 65) + value;
  }
  return value;
}

function safeSheetName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "Sheet1";
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => {
    const replacements: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      "\"": "&quot;"
    };
    return replacements[char] ?? char;
  });
}
