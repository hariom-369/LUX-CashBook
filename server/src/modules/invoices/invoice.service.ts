import { Types, type HydratedDocument } from 'mongoose';
import type { IndianState, InvoiceDto, InvoiceStatus, PriceType } from '@khata/shared';
import { formatDate, formatMoney } from '@khata/shared';
import { Invoice, Person, Project, Workspace, type IInvoice } from '../../models/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import type { RequestScope } from '../../middleware/context.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';
import { claimRevision } from '../../lib/revision.js';
import { withTransaction } from '../../lib/transaction.js';
import { nextDocumentNumber } from '../../services/numberSeries.service.js';
import { computeInvoiceTotals, splitGst, type LineItemInput } from '../../lib/invoiceMath.js';
import { createTransaction } from '../transactions/transaction.service.js';
import { sendMail, invoiceSentEmail } from '../../lib/mailer.js';
import { logger } from '../../lib/logger.js';

export type InvoiceDoc = HydratedDocument<IInvoice>;

/** `sent` past its due date displays as `overdue` — never stored (see `models/Invoice.ts`). */
function displayStatus(invoice: Pick<IInvoice, 'status' | 'dueDate'>): InvoiceStatus {
  if (invoice.status === 'sent' && invoice.dueDate.getTime() < Date.now()) return 'overdue';
  return invoice.status;
}

export function toInvoiceDto(invoice: IInvoice, personName?: string, projectName?: string): InvoiceDto {
  return {
    id: String(invoice._id),
    rev: invoice.rev,
    workspaceId: String(invoice.workspaceId),
    number: invoice.number,
    status: displayStatus(invoice),
    personId: String(invoice.personId),
    personName,
    projectId: invoice.projectId ? String(invoice.projectId) : undefined,
    projectName,
    issueDate: invoice.issueDate.toISOString(),
    dueDate: invoice.dueDate.toISOString(),
    items: invoice.items,
    subtotalMinor: invoice.subtotalMinor,
    discountMinor: invoice.discountMinor,
    taxPercent: invoice.taxPercent,
    taxMinor: invoice.taxMinor,
    totalMinor: invoice.totalMinor,
    priceType: invoice.priceType,
    placeOfSupplyState: invoice.placeOfSupplyState,
    gst: invoice.gst,
    notes: invoice.notes,
    accountId: invoice.accountId ? String(invoice.accountId) : undefined,
    paidTransactionId: invoice.paidTransactionId ? String(invoice.paidTransactionId) : undefined,
    paidAt: invoice.paidAt?.toISOString(),
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}

async function namesFor(invoices: IInvoice[], scope: RequestScope): Promise<{ personNames: Map<string, string>; projectNames: Map<string, string> }> {
  const personIds = [...new Set(invoices.map((i) => String(i.personId)))];
  const projectIds = [...new Set(invoices.filter((i) => i.projectId).map((i) => String(i.projectId)))];

  const [people, projects] = await Promise.all([
    personIds.length ? Person.find({ _id: { $in: personIds }, workspaceId: scope.workspaceId }).select('name').lean() : [],
    projectIds.length ? Project.find({ _id: { $in: projectIds }, workspaceId: scope.workspaceId }).select('name').lean() : [],
  ]);

  return {
    personNames: new Map(people.map((p) => [String(p._id), p.name])),
    projectNames: new Map(projects.map((p) => [String(p._id), p.name])),
  };
}

export interface InvoiceInput {
  personId: string;
  projectId?: string | null;
  issueDate: Date;
  dueDate: Date;
  items: LineItemInput[];
  discountMinor?: number;
  taxPercent?: number;
  priceType?: PriceType;
  notes?: string;
}

async function assertCustomerBelongs(scope: RequestScope, personId: string): Promise<{ _id: Types.ObjectId; state?: IndianState }> {
  if (!Types.ObjectId.isValid(personId)) throw notFound('Person');
  const person = await Person.findOne({ _id: personId, workspaceId: scope.workspaceId, deletedAt: null }).select('state').lean();
  if (!person) throw notFound('Person');
  return { _id: person._id, state: person.state };
}

async function assertProjectBelongs(scope: RequestScope, projectId: string | null | undefined): Promise<Types.ObjectId | null> {
  if (!projectId) return null;
  if (!Types.ObjectId.isValid(projectId)) throw notFound('Project');
  const project = await Project.findOne({ _id: projectId, workspaceId: scope.workspaceId, deletedAt: null }).lean();
  if (!project) throw notFound('Project');
  return project._id;
}

export async function listInvoices(
  scope: RequestScope,
  options: { status?: InvoiceStatus; personId?: string; projectId?: string } = {},
): Promise<InvoiceDto[]> {
  const filter: Record<string, unknown> = { workspaceId: scope.workspaceId, deletedAt: null };
  if (options.personId) filter.personId = options.personId;
  if (options.projectId) filter.projectId = options.projectId;
  // `overdue` is derived, so filtering by it means "stored sent, past due" rather than a stored value.
  if (options.status === 'overdue') {
    filter.status = 'sent';
    filter.dueDate = { $lt: new Date() };
  } else if (options.status) {
    filter.status = options.status;
  }

  const invoices = await Invoice.find(filter).sort({ issueDate: -1, createdAt: -1 }).lean();
  const { personNames, projectNames } = await namesFor(invoices, scope);
  return invoices
    .map((i) => toInvoiceDto(i, personNames.get(String(i.personId)), i.projectId ? projectNames.get(String(i.projectId)) : undefined))
    .filter((dto) => !options.status || dto.status === options.status);
}

export async function getInvoice(scope: RequestScope, invoiceId: string): Promise<InvoiceDoc> {
  if (!Types.ObjectId.isValid(invoiceId)) throw notFound('Invoice');
  const invoice = await Invoice.findOne({ _id: invoiceId, workspaceId: scope.workspaceId, deletedAt: null });
  if (!invoice) throw notFound('Invoice');
  return invoice;
}

export async function createInvoice(scope: RequestScope, input: InvoiceInput, audit: AuditContext): Promise<InvoiceDoc> {
  if (input.dueDate.getTime() < input.issueDate.getTime()) {
    throw badRequest('The due date cannot be before the issue date.');
  }
  const customer = await assertCustomerBelongs(scope, input.personId);
  const projectId = await assertProjectBelongs(scope, input.projectId);
  const priceType = input.priceType ?? 'exclusive';
  const totals = computeInvoiceTotals(input.items, input.discountMinor ?? 0, input.taxPercent ?? 0, priceType);
  const workspace = await Workspace.findById(scope.workspaceId).select('state').lean();
  const gst = splitGst(totals.taxMinor, workspace?.state, customer.state);

  return withTransaction(async (uow) => {
    const number = await nextDocumentNumber(scope.workspaceId, 'invoice', uow);
    const [invoice] = await Invoice.create(
      [
        {
          userId: scope.userId,
          workspaceId: scope.workspaceId,
          number,
          status: 'draft',
          personId: customer._id,
          projectId,
          issueDate: input.issueDate,
          dueDate: input.dueDate,
          ...totals,
          priceType,
          placeOfSupplyState: customer.state,
          gst,
          notes: input.notes,
        },
      ],
      { session: uow.session, ordered: true },
    );

    await recordAudit(audit, {
      action: 'created',
      entityType: 'Invoice',
      entityId: invoice!._id,
      summary: `Created invoice ${number}`,
    });

    return invoice!;
  });
}

/** Only while `draft` — a sent invoice is frozen so the PDF the customer has never disagrees with what's stored (see `models/Invoice.ts`). */
export async function updateInvoice(
  scope: RequestScope,
  invoiceId: string,
  input: Partial<InvoiceInput>,
  audit: AuditContext,
  expectedRev?: number,
): Promise<InvoiceDoc> {
  const invoice = await getInvoice(scope, invoiceId);
  if (invoice.status !== 'draft') {
    throw conflict('Only a draft invoice can be edited. Cancel it and create a new one instead.', 'INVOICE_NOT_DRAFT');
  }

  let customerStateChanged = false;
  if (input.personId !== undefined) {
    const customer = await assertCustomerBelongs(scope, input.personId);
    invoice.personId = customer._id;
    invoice.placeOfSupplyState = customer.state;
    customerStateChanged = true;
  }
  if (input.projectId !== undefined) invoice.projectId = await assertProjectBelongs(scope, input.projectId);
  if (input.issueDate !== undefined) invoice.issueDate = input.issueDate;
  if (input.dueDate !== undefined) invoice.dueDate = input.dueDate;
  if (invoice.dueDate.getTime() < invoice.issueDate.getTime()) {
    throw badRequest('The due date cannot be before the issue date.');
  }
  if (input.notes !== undefined) invoice.notes = input.notes;
  if (input.priceType !== undefined) invoice.priceType = input.priceType;

  if (input.items !== undefined || input.discountMinor !== undefined || input.taxPercent !== undefined || input.priceType !== undefined || customerStateChanged) {
    const totals = computeInvoiceTotals(
      input.items ?? invoice.items,
      input.discountMinor ?? invoice.discountMinor,
      input.taxPercent ?? invoice.taxPercent,
      invoice.priceType,
    );
    Object.assign(invoice, totals);
    const workspace = await Workspace.findById(scope.workspaceId).select('state').lean();
    invoice.gst = splitGst(totals.taxMinor, workspace?.state, invoice.placeOfSupplyState);
  }

  await claimRevision(Invoice, invoice, expectedRev);
  await invoice.save();

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'Invoice',
    entityId: invoice._id,
    summary: `Updated invoice ${invoice.number}`,
  });

  return invoice;
}

/** Draft → sent. Emails the customer if they have an address on file; silently skipped otherwise (mailer.ts's existing graceful-degradation contract). */
export async function sendInvoice(scope: RequestScope, invoiceId: string, audit: AuditContext): Promise<InvoiceDoc> {
  const invoice = await getInvoice(scope, invoiceId);
  if (invoice.status !== 'draft') {
    throw conflict('Only a draft invoice can be sent.', 'INVOICE_NOT_DRAFT');
  }

  invoice.status = 'sent';
  await invoice.save();

  const [person, workspace] = await Promise.all([
    Person.findById(invoice.personId).select('name email').lean(),
    Workspace.findById(scope.workspaceId).select('name currency').lean(),
  ]);

  if (person?.email) {
    try {
      await sendMail({
        to: person.email,
        ...invoiceSentEmail({
          customerName: person.name,
          businessName: workspace?.name ?? 'Khata',
          invoiceNumber: invoice.number,
          totalFormatted: formatMoney(invoice.totalMinor, { currency: workspace?.currency ?? scope.currency }),
          dueDateFormatted: formatDate(invoice.dueDate),
        }),
      });
    } catch (err) {
      // Same reasoning as recordAudit: a failed notification email must never undo a status the user already saw confirmed.
      logger.error({ err, invoiceId: String(invoice._id) }, 'Failed to email invoice to customer');
    }
  }

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'Invoice',
    entityId: invoice._id,
    summary: `Sent invoice ${invoice.number}`,
  });

  return invoice;
}

/**
 * Mark an invoice paid.
 *
 * Posts an ordinary `income` transaction through the same engine every
 * other transaction uses, inside the same unit of work that flips the
 * invoice's own status — either both happen or neither does, so an invoice
 * can never read "paid" without a matching transaction backing it, and a
 * transaction can never silently fail to mark its invoice paid.
 */
export async function markInvoicePaid(
  scope: RequestScope,
  invoiceId: string,
  input: { accountId: string; date?: Date },
  audit: AuditContext,
): Promise<InvoiceDoc> {
  const invoice = await getInvoice(scope, invoiceId);
  if (invoice.status === 'paid') throw conflict('This invoice is already paid.', 'INVOICE_ALREADY_PAID');
  if (invoice.status === 'cancelled') throw conflict('A cancelled invoice cannot be paid.', 'INVOICE_CANCELLED');
  if (invoice.status === 'draft') throw conflict('Send the invoice before recording a payment.', 'INVOICE_NOT_SENT');

  return withTransaction(async (uow) => {
    const person = await Person.findById(invoice.personId).select('name').lean();
    const transaction = await createTransaction(
      scope,
      {
        type: 'income',
        amountMinor: invoice.totalMinor,
        date: input.date ?? new Date(),
        accountId: input.accountId,
        projectId: invoice.projectId ? String(invoice.projectId) : undefined,
        description: `Payment for Invoice ${invoice.number}${person ? ` — ${person.name}` : ''}`,
      },
      audit,
      uow,
    );

    invoice.status = 'paid';
    invoice.accountId = new Types.ObjectId(input.accountId);
    invoice.paidTransactionId = transaction._id;
    invoice.paidAt = new Date();
    await invoice.save({ session: uow.session });

    await recordAudit(audit, {
      action: 'updated',
      entityType: 'Invoice',
      entityId: invoice._id,
      summary: `Marked invoice ${invoice.number} as paid`,
    });

    return invoice;
  });
}

export async function cancelInvoice(scope: RequestScope, invoiceId: string, audit: AuditContext): Promise<InvoiceDoc> {
  const invoice = await getInvoice(scope, invoiceId);
  if (invoice.status === 'paid') throw conflict('A paid invoice cannot be cancelled.', 'INVOICE_ALREADY_PAID');
  if (invoice.status === 'cancelled') return invoice;

  invoice.status = 'cancelled';
  await invoice.save();

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'Invoice',
    entityId: invoice._id,
    summary: `Cancelled invoice ${invoice.number}`,
  });

  return invoice;
}

export async function deleteInvoice(scope: RequestScope, invoiceId: string, audit: AuditContext): Promise<void> {
  const invoice = await getInvoice(scope, invoiceId);
  if (invoice.status !== 'draft') {
    throw forbidden('Only a draft invoice can be deleted. Cancel a sent one instead.');
  }

  invoice.deletedAt = new Date();
  invoice.deletedBy = scope.userId;
  await invoice.save();

  await recordAudit(audit, {
    action: 'deleted',
    entityType: 'Invoice',
    entityId: invoice._id,
    summary: `Deleted draft invoice ${invoice.number}`,
  });
}
