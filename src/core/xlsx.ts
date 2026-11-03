/** Turns spreadsheet rows (as read from an Excel file) into CSV text, so the same reader handles both. */
export function rowsToCsv(rows: unknown[][]): string {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const text = v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\n');
}

/**
 * The text of a chosen file as CSV: a .csv is read as it is; an .xlsx (Excel) is read in the browser and its first sheet
 * converted. The Excel reader is only downloaded when someone actually chooses an Excel file.
 */
export async function fileToCsvText(file: File): Promise<string> {
  if (!/\.xlsx$/i.test(file.name)) return file.text();
  const { readSheet } = await import('read-excel-file/universal');
  return rowsToCsv(await readSheet(file));
}
