import PDFDocument from 'pdfkit';
import { formatDate, formatMoney } from '@khata/shared';
import { User, Workspace } from '../../models/index.js';
import type { RequestScope } from '../../middleware/context.js';
import { getAccountLedger } from '../accounts/account.service.js';
import { getPersonLedger } from '../people/person.service.js';
import { getCashBook, type CashBookView } from '../cashbook/cashbook.service.js';
import { notFound } from '../../lib/errors.js';

/**
 * PDF statements (§35).
 *
 * Every PDF here follows the same skeleton — a masthead with the app name and the
 * user's name, the date range, an opening balance, the line items, a closing
 * balance and a generated timestamp — because that is what makes it read as a
 * financial statement rather than a printed screenshot. Built with PDFKit directly
 * (no headless-browser HTML-to-PDF step) so generation has no external process
 * dependency and stays fast under load.
 */

const INK = '#16150F';
const MUTED = '#6F6B60';
const GOLD = '#A8813C';
const LINE = '#E6E2D8';

interface Masthead {
  title: string;
  subtitle: string;
  userName: string;
  workspaceName: string;
}

function drawMasthead(doc: PDFKit.PDFDocument, info: Masthead): void {
  doc.fillColor(GOLD).fontSize(9).font('Helvetica-Bold').text('KHATA', { characterSpacing: 2 });
  doc.moveDown(0.3);
  doc.fillColor(INK).fontSize(20).font('Helvetica-Bold').text(info.title);
  doc.fillColor(MUTED).fontSize(10).font('Helvetica').text(info.subtitle);
  doc.moveDown(0.6);
  doc.fillColor(INK).fontSize(10).font('Helvetica-Bold').text(info.userName, { continued: true });
  doc.font('Helvetica').fillColor(MUTED).text(`  ·  ${info.workspaceName}`);
  doc.moveDown(0.8);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(LINE).lineWidth(1).stroke();
  doc.moveDown(1);
}

function drawFooter(doc: PDFKit.PDFDocument): void {
  const bottom = doc.page.height - doc.page.margins.bottom + 10;
  doc
    .fontSize(8)
    .fillColor(MUTED)
    .font('Helvetica')
    .text(`Generated ${formatDate(new Date(), 'dd MMM yyyy')} at ${new Date().toLocaleTimeString('en-IN')} · Khata`, doc.page.margins.left, bottom, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: 'center',
    });
}

function drawTableHeader(doc: PDFKit.PDFDocument, columns: Array<{ label: string; x: number; width: number; align?: 'left' | 'right' }>): void {
  doc.fontSize(8.5).font('Helvetica-Bold').fillColor(MUTED);
  for (const col of columns) {
    doc.text(col.label.toUpperCase(), col.x, doc.y, { width: col.width, align: col.align ?? 'left', characterSpacing: 0.5 });
  }
  doc.moveDown(0.6);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(LINE).stroke();
  doc.moveDown(0.4);
}

async function loadIdentity(scope: RequestScope): Promise<{ userName: string; workspaceName: string; currency: string }> {
  const [user, workspace] = await Promise.all([
    User.findById(scope.userId).select('name').lean(),
    Workspace.findById(scope.workspaceId).select('name currency').lean(),
  ]);
  return {
    userName: user?.name ?? 'Khata User',
    workspaceName: workspace?.name ?? 'Workspace',
    currency: workspace?.currency ?? scope.currency,
  };
}

/** An account statement: opening balance, every movement, closing balance. */
export async function generateAccountStatementPdf(
  scope: RequestScope,
  accountId: string,
  range: { from: Date; to: Date },
): Promise<Buffer> {
  const ledger = await getAccountLedger(scope, accountId, { from: range.from, to: range.to, limit: 2000 });
  const identity = await loadIdentity(scope);

  return renderPdf((doc) => {
    drawMasthead(doc, {
      title: `${ledger.account.name} — Statement`,
      subtitle: `${formatDate(range.from)} – ${formatDate(range.to)}`,
      userName: identity.userName,
      workspaceName: identity.workspaceName,
    });

    doc.fontSize(9).fillColor(MUTED).text('Opening Balance', { continued: true });
    doc.fillColor(INK).font('Helvetica-Bold').text(`  ${formatMoney(ledger.openingBalanceMinor, { currency: identity.currency })}`);
    doc.moveDown(0.8);

    const columns = [
      { label: 'Date', x: doc.page.margins.left, width: 70 },
      { label: 'Particulars', x: doc.page.margins.left + 75, width: 220 },
      { label: 'In', x: doc.page.margins.left + 300, width: 75, align: 'right' as const },
      { label: 'Out', x: doc.page.margins.left + 380, width: 75, align: 'right' as const },
      { label: 'Balance', x: doc.page.margins.left + 460, width: 75, align: 'right' as const },
    ];
    drawTableHeader(doc, columns);

    for (const row of ledger.rows) {
      ensureSpace(doc, () => drawTableHeader(doc, columns));
      const y = doc.y;
      doc.fontSize(8.5).font('Helvetica').fillColor(INK);
      doc.text(formatDate(row.date, 'dd MMM'), columns[0]!.x, y, { width: columns[0]!.width });
      doc.text(truncate(row.description, 42), columns[1]!.x, y, { width: columns[1]!.width });
      doc.text(row.amountMinor > 0 ? formatMoney(row.amountMinor, { currency: identity.currency, symbol: false }) : '', columns[2]!.x, y, { width: columns[2]!.width, align: 'right' });
      doc.text(row.amountMinor < 0 ? formatMoney(-row.amountMinor, { currency: identity.currency, symbol: false }) : '', columns[3]!.x, y, { width: columns[3]!.width, align: 'right' });
      doc.font('Helvetica-Bold').text(formatMoney(row.balanceMinor, { currency: identity.currency, symbol: false }), columns[4]!.x, y, { width: columns[4]!.width, align: 'right' });
      doc.moveDown(0.55);
    }

    doc.moveDown(0.4);
    doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(LINE).stroke();
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(INK).text('Closing Balance', columns[0]!.x, doc.y, { continued: true, width: 300 });
    doc.text(formatMoney(ledger.closingBalanceMinor, { currency: identity.currency }), columns[4]!.x, doc.y, { width: columns[4]!.width, align: 'right' });

    drawFooter(doc);
  });
}

/** A person's ledger — gave/received/balance — formatted as a shareable statement (§13, §36). */
export async function generatePersonLedgerPdf(scope: RequestScope, personId: string): Promise<Buffer> {
  const ledger = await getPersonLedger(scope, personId);
  const identity = await loadIdentity(scope);

  return renderPdf((doc) => {
    drawMasthead(doc, {
      title: `Ledger — ${ledger.person.name}`,
      subtitle:
        ledger.summary.status === 'settled'
          ? 'Settled'
          : ledger.summary.status === 'receivable'
            ? `You will receive ${formatMoney(ledger.summary.outstandingMinor, { currency: identity.currency })}`
            : `You need to pay ${formatMoney(-ledger.summary.outstandingMinor, { currency: identity.currency })}`,
      userName: identity.userName,
      workspaceName: identity.workspaceName,
    });

    const columns = [
      { label: 'Date', x: doc.page.margins.left, width: 70 },
      { label: 'Description', x: doc.page.margins.left + 75, width: 230 },
      { label: 'You Gave', x: doc.page.margins.left + 310, width: 80, align: 'right' as const },
      { label: 'You Received', x: doc.page.margins.left + 395, width: 80, align: 'right' as const },
      { label: 'Balance', x: doc.page.margins.left + 480, width: 55, align: 'right' as const },
    ];
    drawTableHeader(doc, columns);

    if (ledger.summary.openingBalanceMinor !== 0) {
      const y = doc.y;
      doc.fontSize(8.5).font('Helvetica-Oblique').fillColor(MUTED);
      doc.text('Opening balance', columns[0]!.x, y, { width: 300 });
      doc.text(formatMoney(ledger.summary.openingBalanceMinor, { currency: identity.currency, symbol: false }), columns[4]!.x, y, { width: columns[4]!.width, align: 'right' });
      doc.moveDown(0.55);
    }

    for (const row of ledger.rows) {
      ensureSpace(doc, () => drawTableHeader(doc, columns));
      const y = doc.y;
      doc.fontSize(8.5).font('Helvetica').fillColor(INK);
      doc.text(formatDate(row.date, 'dd MMM yyyy'), columns[0]!.x, y, { width: columns[0]!.width });
      doc.text(truncate(row.description, 42), columns[1]!.x, y, { width: columns[1]!.width });
      doc.text(row.gaveMinor ? formatMoney(row.gaveMinor, { currency: identity.currency, symbol: false }) : '', columns[2]!.x, y, { width: columns[2]!.width, align: 'right' });
      doc.text(row.receivedMinor ? formatMoney(row.receivedMinor, { currency: identity.currency, symbol: false }) : '', columns[3]!.x, y, { width: columns[3]!.width, align: 'right' });
      doc.font('Helvetica-Bold').text(formatMoney(row.balanceMinor, { currency: identity.currency, symbol: false }), columns[4]!.x, y, { width: columns[4]!.width, align: 'right' });
      doc.moveDown(0.55);
    }

    doc.moveDown(0.4);
    doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(LINE).stroke();
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(INK).text('Outstanding', columns[0]!.x, doc.y, { width: 300 });
    doc.text(formatMoney(Math.abs(ledger.summary.outstandingMinor), { currency: identity.currency }), columns[4]!.x, doc.y - 12, { width: columns[4]!.width, align: 'right' });

    drawFooter(doc);
  });
}

/** The cash book (§10), as a printable statement. */
export async function generateCashBookPdf(
  scope: RequestScope,
  view: CashBookView,
  range: { from: Date; to: Date },
): Promise<Buffer> {
  const book = await getCashBook(scope, { view, from: range.from, to: range.to });
  const identity = await loadIdentity(scope);

  return renderPdf((doc) => {
    drawMasthead(doc, {
      title: 'Cash Book',
      subtitle: `${formatDate(range.from)} – ${formatDate(range.to)}`,
      userName: identity.userName,
      workspaceName: identity.workspaceName,
    });

    doc.fontSize(9).fillColor(MUTED).text('Opening Balance', { continued: true });
    doc.fillColor(INK).font('Helvetica-Bold').text(`  ${formatMoney(book.opening.totalMinor, { currency: identity.currency })}`);
    doc.moveDown(0.8);

    const columns = [
      { label: 'Date', x: doc.page.margins.left, width: 65 },
      { label: 'Particulars', x: doc.page.margins.left + 70, width: 210 },
      { label: 'Receipt', x: doc.page.margins.left + 285, width: 80, align: 'right' as const },
      { label: 'Payment', x: doc.page.margins.left + 370, width: 80, align: 'right' as const },
      { label: 'Balance', x: doc.page.margins.left + 455, width: 80, align: 'right' as const },
    ];
    drawTableHeader(doc, columns);

    for (const row of book.rows) {
      ensureSpace(doc, () => drawTableHeader(doc, columns));
      const y = doc.y;
      doc.fontSize(8.5).font('Helvetica').fillColor(INK);
      doc.text(formatDate(row.date, 'dd MMM'), columns[0]!.x, y, { width: columns[0]!.width });
      doc.text(truncate(row.particulars, 38), columns[1]!.x, y, { width: columns[1]!.width });
      doc.text(row.receiptMinor ? formatMoney(row.receiptMinor, { currency: identity.currency, symbol: false }) : '', columns[2]!.x, y, { width: columns[2]!.width, align: 'right' });
      doc.text(row.paymentMinor ? formatMoney(row.paymentMinor, { currency: identity.currency, symbol: false }) : '', columns[3]!.x, y, { width: columns[3]!.width, align: 'right' });
      doc.font('Helvetica-Bold').text(formatMoney(row.balanceMinor, { currency: identity.currency, symbol: false }), columns[4]!.x, y, { width: columns[4]!.width, align: 'right' });
      doc.moveDown(0.55);
    }

    doc.moveDown(0.4);
    doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(LINE).stroke();
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(INK).text('Closing Balance', columns[0]!.x, doc.y, { continued: true, width: 300 });
    doc.text(formatMoney(book.closing.totalMinor, { currency: identity.currency }), columns[4]!.x, doc.y, { width: columns[4]!.width, align: 'right' });

    drawFooter(doc);
  });
}

function renderPdf(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      build(doc);
      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error('Failed to render PDF.'));
    }
  });
}

/** Start a fresh page (with a header) if there isn't room for another row. */
function ensureSpace(doc: PDFKit.PDFDocument, redrawHeader: () => void): void {
  if (doc.y > doc.page.height - doc.page.margins.bottom - 40) {
    doc.addPage();
    redrawHeader();
  }
}

function truncate(text: string, max: number): string {
  if (!text) return '—';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
