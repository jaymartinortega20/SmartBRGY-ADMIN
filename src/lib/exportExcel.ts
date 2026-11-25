// Builds the "Export to Excel" report for barangay records.
// ExcelJS is loaded only when an official clicks Download, so the
// Admin Website stays fast for everyday use.

type Row = Record<string, any>;

export type ExportData = {
  residents: Row[];
  documents: Row[];
  reports: Row[];
  concerns: Row[];
  announcements: Row[];
};

export type ExportRange = {
  label: string; // e.g. "November 2026"
  from: Date | null; // null = from the beginning
  to: Date | null; // null = until now (exclusive end)
};

type Labeler = (value?: string) => string;

const GREEN = "FF1F6E31";
const LIGHT_GREEN = "FFE8F3E6";
const PESO = '"₱"#,##0.00';

const inRange = (value: string | undefined, range: ExportRange) => {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (range.from && time < range.from.getTime()) return false;
  if (range.to && time >= range.to.getTime()) return false;
  return true;
};

// Excel has no time zones, so shift to the computer's local time (Philippine time)
// before writing; otherwise Excel would show UTC, 8 hours behind.
const asDate = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000);
};
const total = (row: Row) => Number(row.fee_per_copy || 0) * Number(row.copies || 1);
const residentName = (row: Row) => row.profiles?.full_name || "—";
const purok = (row: Row) => row.profiles?.purok || "";

const tally = (rows: Row[], key: (row: Row) => string) => {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const name = key(row) || "Not set";
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

export async function exportBarangayReport(
  data: ExportData,
  range: ExportRange,
  statusLabel: Labeler,
  preparedBy: string,
) {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.creator = "SmartBRGY Admin";
  book.created = new Date();

  const documents = data.documents.filter((row) => inRange(row.created_at, range));
  const reports = data.reports.filter((row) => inRange(row.created_at, range));
  const concerns = data.concerns.filter((row) => inRange(row.created_at, range));
  const announcements = data.announcements.filter((row) => inRange(row.created_at, range));
  const newResidents = data.residents.filter((row) => inRange(row.created_at, range));
  const claimed = documents.filter((row) => row.status === "claimed");

  // ---------------------------------------------------------------- Summary
  const summary = book.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  summary.columns = [{ width: 38 }, { width: 14 }, { width: 14 }, { width: 18 }];
  const title = summary.addRow(["SmartBRGY: Barangay Tubod Transactions Report"]);
  title.font = { bold: true, size: 16, color: { argb: GREEN } };
  summary.addRow([`Period: ${range.label}`]);
  summary.addRow([`Prepared by: ${preparedBy}`]);
  summary.addRow([`Generated: ${new Date().toLocaleString("en-PH")}`]);

  const heading = (text: string, columns: string[]) => {
    summary.addRow([]);
    const head = summary.addRow([text, ...columns]);
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    });
  };
  const line = (values: (string | number)[], bold = false) => {
    const row = summary.addRow(values);
    if (bold) {
      row.font = { bold: true };
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_GREEN } };
      });
    }
    return row;
  };

  heading("Overview", ["Count"]);
  line(["Document requests", documents.length]);
  line(["Incident reports", reports.length]);
  line(["Help Desk concerns", concerns.length]);
  line(["Announcements posted", announcements.length]);
  line(["New residents registered", newResidents.length]);

  heading("Document requests by status", ["Count"]);
  tally(documents, (row) => statusLabel(row.status)).forEach(([name, count]) => line([name, count]));
  line(["Total", documents.length], true);

  heading("Documents by type", ["Requests", "Copies", "Fees collected"]);
  const types = new Map<string, { requests: number; copies: number; fees: number }>();
  documents.forEach((row) => {
    const name = row.document_types?.name || "Unknown document";
    const entry = types.get(name) || { requests: 0, copies: 0, fees: 0 };
    entry.requests += 1;
    entry.copies += Number(row.copies || 1);
    if (row.status === "claimed") entry.fees += total(row);
    types.set(name, entry);
  });
  [...types.entries()]
    .sort((a, b) => b[1].requests - a[1].requests)
    .forEach(([name, entry]) => {
      line([name, entry.requests, entry.copies, entry.fees]).getCell(4).numFmt = PESO;
    });
  const feeTotal = claimed.reduce((sum, row) => sum + total(row), 0);
  const totals = line(
    [
      "Total",
      documents.length,
      documents.reduce((sum, row) => sum + Number(row.copies || 1), 0),
      feeTotal,
    ],
    true,
  );
  totals.getCell(4).numFmt = PESO;
  summary.addRow(["Fees collected counts claimed documents only (payment upon pickup)."]).font = {
    italic: true,
    color: { argb: "FF5C6B60" },
  };

  heading("Incident reports by status", ["Count"]);
  tally(reports, (row) => statusLabel(row.status)).forEach(([name, count]) => line([name, count]));
  line(["Total", reports.length], true);

  heading("Incident reports by type", ["Count"]);
  tally(reports, (row) => row.incident_type).forEach(([name, count]) => line([name, count]));

  heading("Help Desk concerns by status", ["Count"]);
  tally(concerns, (row) => statusLabel(row.status)).forEach(([name, count]) => line([name, count]));
  line(["Total", concerns.length], true);

  heading("Residents", ["Count"]);
  line(["All registered residents", data.residents.length]);
  line(["Blocked accounts", data.residents.filter((row) => row.is_banned).length]);
  tally(data.residents, (row) => (row.purok ? `Purok ${row.purok}` : "")).forEach(([name, count]) =>
    line([`  ${name}`, count]),
  );

  // ------------------------------------------------------------ Data sheets
  const sheet = (
    name: string,
    columns: { header: string; width: number; money?: boolean; date?: boolean }[],
    rows: (string | number | Date | null)[][],
  ) => {
    const ws = book.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = columns.map((column) => ({
      header: column.header,
      width: column.width,
      style: column.money
        ? { numFmt: PESO }
        : column.date
          ? { numFmt: "mmm d, yyyy h:mm AM/PM" }
          : {},
    }));
    rows.forEach((values) => ws.addRow(values));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.alignment = { vertical: "middle" };
    head.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    if (!rows.length) ws.addRow(["No records for this period."]);
    return ws;
  };

  const docSheet = sheet(
    "Document Requests",
    [
      { header: "Date requested", width: 22, date: true },
      { header: "Resident", width: 26 },
      { header: "Purok", width: 10 },
      { header: "Document", width: 28 },
      { header: "Purpose", width: 26 },
      { header: "Copies", width: 9 },
      { header: "Fee per copy", width: 14, money: true },
      { header: "Total fee", width: 14, money: true },
      { header: "Claimed by", width: 16 },
      { header: "Status", width: 16 },
      { header: "Claimed on", width: 22, date: true },
      { header: "Official's note", width: 34 },
    ],
    documents.map((row) => [
      asDate(row.created_at),
      residentName(row),
      purok(row),
      row.document_types?.name || "",
      row.purpose || "",
      Number(row.copies || 1),
      Number(row.fee_per_copy || 0),
      total(row),
      row.claim_method === "representative" ? "Representative" : "Resident",
      statusLabel(row.status),
      asDate(row.claimed_at),
      row.admin_note || "",
    ]),
  );
  if (documents.length) {
    const end = docSheet.addRow([
      "TOTAL FEES COLLECTED (claimed)",
      "",
      "",
      "",
      "",
      "",
      "",
      feeTotal,
    ]);
    end.font = { bold: true };
    end.getCell(8).numFmt = PESO;
  }

  sheet(
    "Incident Reports",
    [
      { header: "Reference no.", width: 18 },
      { header: "Date reported", width: 22, date: true },
      { header: "Resident", width: 26 },
      { header: "Purok", width: 10 },
      { header: "Incident type", width: 22 },
      { header: "Urgency", width: 12 },
      { header: "Area", width: 20 },
      { header: "Details", width: 45 },
      { header: "Status", width: 18 },
      { header: "Meeting date", width: 14 },
      { header: "Official's note", width: 34 },
    ],
    reports.map((row) => [
      row.reference_number || "",
      asDate(row.created_at),
      residentName(row),
      purok(row),
      row.incident_type || "",
      statusLabel(row.urgency),
      row.area || row.location || "",
      row.details || "",
      statusLabel(row.status),
      row.scheduled_meeting_date || "",
      row.admin_note || "",
    ]),
  );

  sheet(
    "Help Desk",
    [
      { header: "Ticket no.", width: 18 },
      { header: "Date opened", width: 22, date: true },
      { header: "Resident", width: 26 },
      { header: "Purok", width: 10 },
      { header: "Subject", width: 32 },
      { header: "Category", width: 18 },
      { header: "Messages", width: 11 },
      { header: "Status", width: 20 },
      { header: "Last update", width: 22, date: true },
    ],
    concerns.map((row) => [
      row.ticket_number || "",
      asDate(row.created_at),
      residentName(row),
      purok(row),
      row.subject || "",
      row.category || "",
      (row.concern_messages || []).length,
      statusLabel(row.status),
      asDate(row.updated_at),
    ]),
  );

  sheet(
    "Announcements",
    [
      { header: "Date posted", width: 22, date: true },
      { header: "Title", width: 36 },
      { header: "Type", width: 14 },
      { header: "Event date", width: 14 },
      { header: "Location", width: 26 },
    ],
    announcements.map((row) => [
      asDate(row.created_at),
      row.title || "",
      statusLabel(row.announcement_type),
      row.event_date || "",
      row.location || "",
    ]),
  );

  sheet(
    "Residents",
    [
      { header: "Name", width: 28 },
      { header: "Purok", width: 10 },
      { header: "Address", width: 34 },
      { header: "Phone", width: 16 },
      { header: "Registered on", width: 22, date: true },
      { header: "Account", width: 12 },
    ],
    data.residents.map((row) => [
      row.full_name || "",
      row.purok || "",
      row.address || "",
      row.phone || "",
      asDate(row.created_at),
      row.is_banned ? "Blocked" : "Active",
    ]),
  );

  const buffer = await book.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `SmartBRGY_Report_${range.label.replace(/[^A-Za-z0-9]+/g, "_")}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
