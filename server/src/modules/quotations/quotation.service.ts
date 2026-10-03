import { Types, type HydratedDocument } from 'mongoose';
import type { IndianState, PriceType, QuotationDto, QuotationStatus } from '@khata/shared';
import { Invoice, Person, Project, Quotation, Workspace, type IQuotation } from '../../models/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import type { RequestScope } from '../../middleware/context.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';
import { claimRevision } from '../../lib/revision.js';
import { withTransaction } from '../../lib/transaction.js';
import { nextDocumentNumber } from '../../services/numberSeries.service.js';
import { computeInvoiceTotals, splitGst, type LineItemInput } from '../../lib/invoiceMath.js';

export type QuotationDoc = HydratedDocument<IQuotation>;

export function toQuotationDto(quotation: IQuotation, personName?: string, projectName?: string): QuotationDto {
  return {
    id: String(quotation._id),
    rev: quotation.rev,
    workspaceId: String(quotation.workspaceId),
    number: quotation.number,
    status: quotation.status,
    personId: String(quotation.personId),
    personName,
    projectId: quotation.projectId ? String(quotation.projectId) : undefined,
    projectName,
    issueDate: quotation.issueDate.toISOString(),
    expiryDate: quotation.expiryDate.toISOString(),
    items: quotation.items,
    subtotalMinor: quotation.subtotalMinor,
    discountMinor: quotation.discountMinor,
    taxPercent: quotation.taxPercent,
    taxMinor: quotation.taxMinor,
    totalMinor: quotation.totalMinor,
    priceType: quotation.priceType,
    placeOfSupplyState: quotation.placeOfSupplyState,
    gst: quotation.gst,
    notes: quotation.notes,
    convertedInvoiceId: quotation.convertedInvoiceId ? String(quotation.convertedInvoiceId) : undefined,
    createdAt: quotation.createdAt.toISOString(),
    updatedAt: quotation.updatedAt.toISOString(),
  };
}

async function namesFor(quotations: IQuotation[], scope: RequestScope) {
  const personIds = [...new Set(quotations.map((q) => String(q.personId)))];
  const projectIds = [...new Set(quotations.filter((q) => q.projectId).map((q) => String(q.projectId)))];

  const [people, projects] = await Promise.all([
    personIds.length ? Person.find({ _id: { $in: personIds }, workspaceId: scope.workspaceId }).select('name').lean() : [],
    projectIds.length ? Project.find({ _id: { $in: projectIds }, workspaceId: scope.workspaceId }).select('name').lean() : [],
  ]);

  return {
    personNames: new Map(people.map((p) => [String(p._id), p.name])),
    projectNames: new Map(projects.map((p) => [String(p._id), p.name])),
  };
}

export interface QuotationInput {
  personId: string;
  projectId?: string | null;
  issueDate: Date;
  expiryDate: Date;
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

export async function listQuotations(
  scope: RequestScope,
  options: { status?: QuotationStatus; personId?: string } = {},
): Promise<QuotationDto[]> {
  const filter: Record<string, unknown> = { workspaceId: scope.workspaceId, deletedAt: null };
  if (options.status) filter.status = options.status;
  if (options.personId) filter.personId = options.personId;

  const quotations = await Quotation.find(filter).sort({ issueDate: -1, createdAt: -1 }).lean();
  const { personNames, projectNames } = await namesFor(quotations, scope);
  return quotations.map((q) =>
    toQuotationDto(q, personNames.get(String(q.personId)), q.projectId ? projectNames.get(String(q.projectId)) : undefined),
  );
}

export async function getQuotation(scope: RequestScope, quotationId: string): Promise<QuotationDoc> {
  if (!Types.ObjectId.isValid(quotationId)) throw notFound('Quotation');
  const quotation = await Quotation.findOne({ _id: quotationId, workspaceId: scope.workspaceId, deletedAt: null });
  if (!quotation) throw notFound('Quotation');
  return quotation;
}

export async function createQuotation(scope: RequestScope, input: QuotationInput, audit: AuditContext): Promise<QuotationDoc> {
  if (input.expiryDate.getTime() < input.issueDate.getTime()) {
    throw badRequest('The expiry date cannot be before the issue date.');
  }
  const customer = await assertCustomerBelongs(scope, input.personId);
  const projectId = await assertProjectBelongs(scope, input.projectId);
  const priceType = input.priceType ?? 'exclusive';
  const totals = computeInvoiceTotals(input.items, input.discountMinor ?? 0, input.taxPercent ?? 0, priceType);
  const workspace = await Workspace.findById(scope.workspaceId).select('state').lean();
  const gst = splitGst(totals.taxMinor, workspace?.state, customer.state);

  return withTransaction(async (uow) => {
    const number = await nextDocumentNumber(scope.workspaceId, 'quotation', uow);
    const [quotation] = await Quotation.create(
      [
        {
          userId: scope.userId,
          workspaceId: scope.workspaceId,
          number,
          status: 'draft',
          personId: customer._id,
          projectId,
          issueDate: input.issueDate,
          expiryDate: input.expiryDate,
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
      entityType: 'Quotation',
      entityId: quotation!._id,
      summary: `Created quotation ${number}`,
    });

    return quotation!;
  });
}

export async function updateQuotation(
  scope: RequestScope,
  quotationId: string,
  input: Partial<QuotationInput>,
  audit: AuditContext,
  expectedRev?: number,
): Promise<QuotationDoc> {
  const quotation = await getQuotation(scope, quotationId);
  if (quotation.status !== 'draft') {
    throw conflict('Only a draft quotation can be edited.', 'QUOTATION_NOT_DRAFT');
  }

  let customerStateChanged = false;
  if (input.personId !== undefined) {
    const customer = await assertCustomerBelongs(scope, input.personId);
    quotation.personId = customer._id;
    quotation.placeOfSupplyState = customer.state;
    customerStateChanged = true;
  }
  if (input.projectId !== undefined) quotation.projectId = await assertProjectBelongs(scope, input.projectId);
  if (input.issueDate !== undefined) quotation.issueDate = input.issueDate;
  if (input.expiryDate !== undefined) quotation.expiryDate = input.expiryDate;
  if (quotation.expiryDate.getTime() < quotation.issueDate.getTime()) {
    throw badRequest('The expiry date cannot be before the issue date.');
  }
  if (input.notes !== undefined) quotation.notes = input.notes;
  if (input.priceType !== undefined) quotation.priceType = input.priceType;

  if (input.items !== undefined || input.discountMinor !== undefined || input.taxPercent !== undefined || input.priceType !== undefined || customerStateChanged) {
    const totals = computeInvoiceTotals(
      input.items ?? quotation.items,
      input.discountMinor ?? quotation.discountMinor,
      input.taxPercent ?? quotation.taxPercent,
      quotation.priceType,
    );
    Object.assign(quotation, totals);
    const workspace = await Workspace.findById(scope.workspaceId).select('state').lean();
    quotation.gst = splitGst(totals.taxMinor, workspace?.state, quotation.placeOfSupplyState);
  }

  await claimRevision(Quotation, quotation, expectedRev);
  await quotation.save();

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'Quotation',
    entityId: quotation._id,
    summary: `Updated quotation ${quotation.number}`,
  });

  return quotation;
}

/** Marks a quotation as sent/accepted/declined/expired — anything short of converting it. */
export async function setQuotationStatus(
  scope: RequestScope,
  quotationId: string,
  status: Exclude<QuotationStatus, 'converted'>,
  audit: AuditContext,
): Promise<QuotationDoc> {
  const quotation = await getQuotation(scope, quotationId);
  if (quotation.status === 'converted') {
    throw conflict('This quotation has already been converted to an invoice.', 'QUOTATION_CONVERTED');
  }

  quotation.status = status;
  await quotation.save();

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'Quotation',
    entityId: quotation._id,
    summary: `Marked quotation ${quotation.number} as ${status}`,
  });

  return quotation;
}

/**
 * Convert an accepted quotation into an invoice.
 *
 * Copies the quotation's items/totals into a brand-new `Invoice` with its
 * own issued number rather than mutating the quotation in place, so the
 * quotation stays exactly what the customer accepted — see `models/Quotation.ts`.
 */
export async function convertQuotationToInvoice(
  scope: RequestScope,
  quotationId: string,
  input: { issueDate?: Date; dueDate: Date },
  audit: AuditContext,
): Promise<{ invoice: import('../../models/index.js').IInvoice; quotation: QuotationDoc }> {
  const quotation = await getQuotation(scope, quotationId);
  if (quotation.status === 'converted') {
    throw conflict('This quotation has already been converted to an invoice.', 'QUOTATION_CONVERTED');
  }
  if (quotation.status === 'declined' || quotation.status === 'expired') {
    throw conflict('A declined or expired quotation cannot be converted.', 'QUOTATION_NOT_CONVERTIBLE');
  }

  const issueDate = input.issueDate ?? new Date();
  if (input.dueDate.getTime() < issueDate.getTime()) {
    throw badRequest('The due date cannot be before the issue date.');
  }

  return withTransaction(async (uow) => {
    const number = await nextDocumentNumber(scope.workspaceId, 'invoice', uow);
    const [invoice] = await Invoice.create(
      [
        {
          userId: scope.userId,
          workspaceId: scope.workspaceId,
          number,
          status: 'draft',
          personId: quotation.personId,
          projectId: quotation.projectId,
          issueDate,
          dueDate: input.dueDate,
          items: quotation.items,
          subtotalMinor: quotation.subtotalMinor,
          discountMinor: quotation.discountMinor,
          taxPercent: quotation.taxPercent,
          taxMinor: quotation.taxMinor,
          totalMinor: quotation.totalMinor,
          priceType: quotation.priceType,
          placeOfSupplyState: quotation.placeOfSupplyState,
          gst: quotation.gst,
          notes: quotation.notes,
        },
      ],
      { session: uow.session, ordered: true },
    );

    quotation.status = 'converted';
    quotation.convertedInvoiceId = invoice!._id;
    await quotation.save({ session: uow.session });

    await recordAudit(audit, {
      action: 'updated',
      entityType: 'Quotation',
      entityId: quotation._id,
      summary: `Converted quotation ${quotation.number} to invoice ${number}`,
    });

    return { invoice: invoice!, quotation };
  });
}

export async function deleteQuotation(scope: RequestScope, quotationId: string, audit: AuditContext): Promise<void> {
  const quotation = await getQuotation(scope, quotationId);
  if (quotation.status !== 'draft') {
    throw forbidden('Only a draft quotation can be deleted.');
  }

  quotation.deletedAt = new Date();
  quotation.deletedBy = scope.userId;
  await quotation.save();

  await recordAudit(audit, {
    action: 'deleted',
    entityType: 'Quotation',
    entityId: quotation._id,
    summary: `Deleted draft quotation ${quotation.number}`,
  });
}
