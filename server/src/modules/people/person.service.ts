import { Types, type HydratedDocument } from 'mongoose';
import type { LedgerRowDto, PersonDto, PersonLedgerDto, PersonRelationship } from '@khata/shared';
import { Person, Transaction, type IPerson } from '../../models/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import type { RequestScope } from '../../middleware/context.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';
import { createTransaction } from '../transactions/transaction.service.js';

export type PersonDoc = HydratedDocument<IPerson>;

export function toPersonDto(person: IPerson): PersonDto {
  return {
    id: String(person._id),
    workspaceId: String(person.workspaceId),
    name: person.name,
    phone: person.phone,
    email: person.email,
    avatarUrl: person.avatarUrl,
    relationship: person.relationship,
    notes: person.notes,
    tags: person.tags,
    openingBalanceMinor: person.openingBalanceMinor,
    balanceMinor: person.cachedBalanceMinor,
    isArchived: person.isArchived,
    lastTransactionAt: person.lastTransactionAt?.toISOString(),
    createdAt: person.createdAt.toISOString(),
    updatedAt: person.updatedAt.toISOString(),
  };
}

export interface CreatePersonInput {
  name: string;
  phone?: string;
  email?: string;
  avatarUrl?: string;
  relationship?: PersonRelationship;
  notes?: string;
  tags?: string[];
  /** Balance carried in from before the app. Positive = they owe you. */
  openingBalanceMinor?: number;
  openingDate?: Date;
}

export async function listPeople(
  scope: RequestScope,
  options: {
    search?: string;
    relationship?: PersonRelationship;
    /** `receivable` they owe you · `payable` you owe them · `settled`. */
    status?: 'receivable' | 'payable' | 'settled' | 'all';
    includeArchived?: boolean;
    sortBy?: 'name' | 'balance' | 'recent';
  } = {},
): Promise<PersonDto[]> {
  const filter: Record<string, unknown> = { workspaceId: scope.workspaceId, deletedAt: null };
  if (!options.includeArchived) filter.isArchived = false;
  if (options.relationship) filter.relationship = options.relationship;

  if (options.search?.trim()) {
    const pattern = new RegExp(options.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: pattern }, { phone: pattern }, { email: pattern }, { notes: pattern }];
  }

  if (options.status === 'receivable') filter.cachedBalanceMinor = { $gt: 0 };
  else if (options.status === 'payable') filter.cachedBalanceMinor = { $lt: 0 };
  else if (options.status === 'settled') filter.cachedBalanceMinor = 0;

  const sort: Record<string, 1 | -1> =
    options.sortBy === 'balance'
      ? { cachedBalanceMinor: -1 }
      : options.sortBy === 'recent'
        ? { lastTransactionAt: -1 }
        : { name: 1 };

  const people = await Person.find(filter).sort(sort).collation({ locale: 'en', strength: 2 }).lean();
  return people.map(toPersonDto);
}

export async function getPerson(scope: RequestScope, personId: string): Promise<PersonDoc> {
  if (!Types.ObjectId.isValid(personId)) throw notFound('Person');
  const person = await Person.findOne({
    _id: personId,
    workspaceId: scope.workspaceId,
    deletedAt: null,
  });
  if (!person) throw notFound('Person');
  return person;
}

export async function createPerson(
  scope: RequestScope,
  input: CreatePersonInput,
  audit: AuditContext,
): Promise<PersonDoc> {
  const name = input.name.trim();

  const duplicate = await Person.findOne({
    workspaceId: scope.workspaceId,
    name,
    deletedAt: null,
  })
    .collation({ locale: 'en', strength: 2 })
    .lean();
  if (duplicate) throw conflict('Someone with that name is already in your ledger.', 'PERSON_NAME_TAKEN');

  const person = await Person.create({
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    name,
    phone: input.phone,
    email: input.email,
    avatarUrl: input.avatarUrl,
    relationship: input.relationship ?? 'friend',
    notes: input.notes,
    tags: input.tags ?? [],
    openingBalanceMinor: input.openingBalanceMinor ?? 0,
    openingDate: input.openingDate ?? new Date(),
    cachedBalanceMinor: input.openingBalanceMinor ?? 0,
  });

  await recordAudit(audit, {
    action: 'created',
    entityType: 'Person',
    entityId: person._id,
    summary: `Added ${person.name} to the ledger`,
  });

  return person;
}

export type UpdatePersonInput = Partial<CreatePersonInput> & { isArchived?: boolean };

export async function updatePerson(
  scope: RequestScope,
  personId: string,
  input: UpdatePersonInput,
  audit: AuditContext,
): Promise<PersonDoc> {
  const person = await getPerson(scope, personId);
  const before = { name: person.name, openingBalanceMinor: person.openingBalanceMinor };

  if (input.name && input.name.trim() !== person.name) {
    const duplicate = await Person.findOne({
      workspaceId: scope.workspaceId,
      name: input.name.trim(),
      deletedAt: null,
      _id: { $ne: person._id },
    })
      .collation({ locale: 'en', strength: 2 })
      .lean();
    if (duplicate) throw conflict('Someone with that name is already in your ledger.', 'PERSON_NAME_TAKEN');
    person.name = input.name.trim();
  }

  const openingChanged =
    input.openingBalanceMinor !== undefined && input.openingBalanceMinor !== person.openingBalanceMinor;
  if (openingChanged) person.openingBalanceMinor = input.openingBalanceMinor!;

  for (const key of ['phone', 'email', 'avatarUrl', 'relationship', 'notes', 'tags', 'isArchived'] as const) {
    if (input[key] !== undefined) {
      (person as unknown as Record<string, unknown>)[key] = input[key];
    }
  }

  await person.save();

  if (openingChanged) {
    const { recomputePersonBalance } = await import('../../services/balance.service.js');
    person.cachedBalanceMinor = await recomputePersonBalance(scope.workspaceId, person._id);
  }

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'Person',
    entityId: person._id,
    summary: `Updated ${person.name}`,
    before,
    after: { name: person.name, openingBalanceMinor: person.openingBalanceMinor },
  });

  return person;
}

/**
 * Remove a person.
 *
 * Refused while anything is outstanding: deleting someone who owes you ₹6,000 does
 * not make the ₹6,000 go away, it just makes it invisible. Once settled, the record
 * is soft-deleted so the historical transactions still resolve their name.
 */
export async function deletePerson(
  scope: RequestScope,
  personId: string,
  audit: AuditContext,
): Promise<void> {
  const person = await getPerson(scope, personId);

  if (person.cachedBalanceMinor !== 0) {
    throw conflict(
      'Settle the outstanding amount before removing this person.',
      'PERSON_HAS_BALANCE',
    );
  }

  person.deletedAt = new Date();
  person.deletedBy = scope.userId;
  await person.save();

  await recordAudit(audit, {
    action: 'deleted',
    entityType: 'Person',
    entityId: person._id,
    summary: `Removed ${person.name} from the ledger`,
  });
}

/**
 * The person ledger (§13).
 *
 * Presented the way a paper khata is kept: one chronological list with a "you gave"
 * column, a "you received" column, and a running outstanding figure. The running
 * balance starts from the opening balance and accumulates forward, so the last row
 * *is* the outstanding amount — the same arithmetic the user would do themselves.
 */
export async function getPersonLedger(
  scope: RequestScope,
  personId: string,
  options: { from?: Date; to?: Date } = {},
): Promise<PersonLedgerDto> {
  const person = await getPerson(scope, personId);

  const filter: Record<string, unknown> = {
    workspaceId: scope.workspaceId,
    personId: person._id,
    deletedAt: null,
  };
  if (options.from || options.to) {
    const range: Record<string, Date> = {};
    if (options.from) range.$gte = options.from;
    if (options.to) range.$lte = options.to;
    filter.date = range;
  }

  const rows = await Transaction.find(filter).sort({ date: 1, _id: 1 }).lean();
  const { hydrate } = await import('../transactions/transaction.query.js');
  const dtos = await hydrate(scope, rows);

  let running = person.openingBalanceMinor;
  let totalGiven = 0;
  let totalReceived = 0;

  const ledgerRows: LedgerRowDto[] = dtos.map((dto) => {
    // personDelta > 0 means they owe you more, i.e. you gave.
    const delta = dto.postings[0] ? -dto.postings[0].amountMinor : 0;
    const gave = delta > 0 ? delta : 0;
    const received = delta < 0 ? -delta : 0;

    totalGiven += gave;
    totalReceived += received;
    running += delta;

    return {
      id: dto.id,
      date: dto.date,
      description: dto.description || defaultDescription(dto.type, person.name),
      type: dto.type,
      gaveMinor: gave,
      receivedMinor: received,
      balanceMinor: running,
      accountId: dto.accountId,
      accountName: dto.accountName,
      dueDate: dto.dueDate,
      isSettlement: Boolean(dto.isSettled && (dto.type === 'lend' || dto.type === 'borrow')),
    };
  });

  // Overdue: loans past their due date with something still outstanding.
  const overdueRows = await Transaction.find({
    workspaceId: scope.workspaceId,
    personId: person._id,
    deletedAt: null,
    type: { $in: ['lend', 'borrow'] },
    dueDate: { $ne: null, $lt: new Date() },
    $expr: { $lt: ['$settledMinor', '$amountMinor'] },
  })
    .select('amountMinor settledMinor dueDate')
    .lean();

  const overdueMinor = overdueRows.reduce(
    (sum, row) => sum + Math.max(0, row.amountMinor - row.settledMinor),
    0,
  );

  const nextDue = await Transaction.findOne({
    workspaceId: scope.workspaceId,
    personId: person._id,
    deletedAt: null,
    type: { $in: ['lend', 'borrow'] },
    dueDate: { $ne: null, $gte: new Date() },
    $expr: { $lt: ['$settledMinor', '$amountMinor'] },
  })
    .sort({ dueDate: 1 })
    .select('dueDate')
    .lean();

  return {
    person: toPersonDto(person),
    rows: ledgerRows,
    summary: {
      openingBalanceMinor: person.openingBalanceMinor,
      totalGivenMinor: totalGiven,
      totalReceivedMinor: totalReceived,
      outstandingMinor: running,
      status: running > 0 ? 'receivable' : running < 0 ? 'payable' : 'settled',
      overdueMinor,
      nextDueDate: nextDue?.dueDate?.toISOString(),
    },
  };
}

function defaultDescription(type: string, name: string): string {
  switch (type) {
    case 'lend':
      return `Gave to ${name}`;
    case 'borrow':
      return `Borrowed from ${name}`;
    case 'repayment_given':
      return `Repaid ${name}`;
    case 'repayment_received':
      return `Received from ${name}`;
    default:
      return 'Transaction';
  }
}

/**
 * Settle a person's account (§17).
 *
 * Records a single repayment for exactly the outstanding amount and leaves every
 * historical row untouched. The direction is derived from the balance's sign rather
 * than asked for, because the user has already told us which it is by having a
 * balance — asking again is how people settle in the wrong direction.
 */
export async function settlePerson(
  scope: RequestScope,
  personId: string,
  input: { accountId: string; date?: Date; note?: string },
  audit: AuditContext,
): Promise<{ person: PersonDto; transactionId: string; settledMinor: number }> {
  const person = await getPerson(scope, personId);
  const outstanding = person.cachedBalanceMinor;

  if (outstanding === 0) {
    throw badRequest(`${person.name}'s account is already settled.`);
  }

  // They owe you → you receive. You owe them → you pay.
  const type = outstanding > 0 ? 'repayment_received' : 'repayment_given';
  const amountMinor = Math.abs(outstanding);

  const transaction = await createTransaction(
    scope,
    {
      type,
      amountMinor,
      date: input.date ?? new Date(),
      accountId: input.accountId,
      personId: String(person._id),
      description: input.note?.trim() || `Settled account with ${person.name}`,
      isSettlement: true,
    },
    audit,
  );

  const updated = await getPerson(scope, personId);

  await recordAudit(audit, {
    action: 'settled',
    entityType: 'Person',
    entityId: person._id,
    summary: `Settled ${person.name}'s account`,
    before: { balanceMinor: outstanding },
    after: { balanceMinor: updated.cachedBalanceMinor },
  });

  return {
    person: toPersonDto(updated),
    transactionId: String(transaction._id),
    settledMinor: amountMinor,
  };
}

/** Totals for the dashboard's "money to receive" and "money to pay" panels (§7). */
export async function getReceivablesAndPayables(scope: RequestScope): Promise<{
  receivableMinor: number;
  payableMinor: number;
  receivables: PersonDto[];
  payables: PersonDto[];
}> {
  const people = await Person.find({
    workspaceId: scope.workspaceId,
    deletedAt: null,
    isArchived: false,
    cachedBalanceMinor: { $ne: 0 },
  })
    .sort({ cachedBalanceMinor: -1 })
    .lean();

  const receivables = people.filter((p) => p.cachedBalanceMinor > 0).map(toPersonDto);
  const payables = people
    .filter((p) => p.cachedBalanceMinor < 0)
    .map(toPersonDto)
    .sort((a, b) => a.balanceMinor - b.balanceMinor);

  return {
    receivableMinor: receivables.reduce((sum, p) => sum + p.balanceMinor, 0),
    payableMinor: payables.reduce((sum, p) => sum + Math.abs(p.balanceMinor), 0),
    receivables,
    payables,
  };
}
