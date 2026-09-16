import JSZip from "jszip";

/**
 * A real Excel workbook, one sheet, the data formatted as an Excel table.
 *
 * Written by hand rather than through a spreadsheet library because the whole
 * job is one sheet of text and numbers, and a new dependency the night before a
 * demo is a risk this does not need. The table part matters: it is what makes
 * the download open as a filterable table rather than a grid of loose cells,
 * which is the difference between "a CSV" and "the tracker".
 */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Column index (0-based) to Excel letters: 0 → A, 25 → Z, 26 → AA. */
export function colLetter(i: number): string {
  let n = i + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Numbers stay numbers so a column of hours can be summed. Codes that merely
 *  look numeric but carry meaning in their leading zeros are not a concern in
 *  these datasets, so a plain finite check is enough. */
function isNumeric(v: string): boolean {
  return v.trim() !== "" && /^-?\d+(\.\d+)?$/.test(v.trim());
}

export async function buildXlsx(opts: {
  sheetName: string;
  tableName: string;
  columns: string[];
  rows: string[][];
}): Promise<Uint8Array> {
  const { columns, rows } = opts;
  const sheetName = esc(opts.sheetName.slice(0, 31));
  // Excel table names: letters, digits, underscores, starting with a letter.
  const tableName = opts.tableName.replace(/[^A-Za-z0-9_]/g, "") || "Table1";
  const lastCol = colLetter(Math.max(columns.length - 1, 0));
  const ref = `A1:${lastCol}${rows.length + 1}`;

  const cell = (v: string, c: number, r: number, header = false) => {
    const at = `${colLetter(c)}${r}`;
    if (!header && isNumeric(v)) return `<c r="${at}"><v>${v.trim()}</v></c>`;
    return `<c r="${at}" t="inlineStr"${header ? ' s="1"' : ""}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };

  const widths = columns.map((h, c) =>
    Math.min(Math.max(h.length, ...rows.map((r) => (r[c] ?? "").length)) + 3, 46),
  );

  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="${ref}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>` +
    `<row r="1">${columns.map((h, c) => cell(h, c, 1, true)).join("")}</row>` +
    rows.map((row, i) => `<row r="${i + 2}">${columns.map((_, c) => cell(row[c] ?? "", c, i + 2)).join("")}</row>`).join("") +
    `</sheetData>` +
    `<tableParts count="1"><tablePart r:id="rId1"/></tableParts>` +
    `</worksheet>`;

  const table =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="${tableName}" displayName="${tableName}" ref="${ref}" totalsRowShown="0">` +
    `<autoFilter ref="${ref}"/>` +
    `<tableColumns count="${columns.length}">${columns.map((h, i) => `<tableColumn id="${i + 1}" name="${esc(h)}"/>`).join("")}</tableColumns>` +
    `<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>` +
    `</table>`;

  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>` +
      `</workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
  );
  // Two cell formats: the default, and bold for the header row.
  zip.file(
    "xl/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
      `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `</styleSheet>`,
  );
  zip.file("xl/worksheets/sheet1.xml", sheet);
  zip.file(
    "xl/worksheets/_rels/sheet1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/>` +
      `</Relationships>`,
  );
  zip.file("xl/tables/table1.xml", table);

  return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
