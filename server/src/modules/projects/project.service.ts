import { Types, type HydratedDocument } from 'mongoose';
import type { ProjectDto, ProjectStatus, ProjectSummaryDto } from '@khata/shared';
import { Invoice, Person, Project, Transaction, type IProject } from '../../models/index.js';
import { conflict, notFound } from '../../lib/errors.js';
import type { RequestScope } from '../../middleware/context.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';
import { claimRevision } from '../../lib/revision.js';
import { excludeHiddenTransactions } from '../../services/accountVisibility.js';

export type ProjectDoc = HydratedDocument<IProject>;

export function toProjectDto(project: IProject, personName?: string): ProjectDto {
  return {
    id: String(project._id),
    rev: project.rev,
    workspaceId: String(project.workspaceId),
    name: project.name,
    personId: project.personId ? String(project.personId) : undefined,
    personName,
    status: project.status,
    budgetMinor: project.budgetMinor ?? undefined,
    notes: project.notes,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export interface CreateProjectInput {
  name: string;
  personId?: string | null;
  status?: ProjectStatus;
  budgetMinor?: number | null;
  notes?: string;
}

async function namesFor(people: { _id: Types.ObjectId; name: string }[]): Promise<Map<string, string>> {
  return new Map(people.map((p) => [String(p._id), p.name]));
}

export async function listProjects(scope: RequestScope, options: { status?: ProjectStatus } = {}): Promise<ProjectDto[]> {
  const filter: Record<string, unknown> = { workspaceId: scope.workspaceId, deletedAt: null };
  if (options.status) filter.status = options.status;

  const projects = await Project.find(filter).sort({ name: 1 }).collation({ locale: 'en', strength: 2 }).lean();
  const personIds = [...new Set(projects.filter((p) => p.personId).map((p) => String(p.personId)))];
  const people = personIds.length
    ? await Person.find({ _id: { $in: personIds }, workspaceId: scope.workspaceId }).select('name').lean()
    : [];
  const nameById = await namesFor(people);

  return projects.map((p) => toProjectDto(p, p.personId ? nameById.get(String(p.personId)) : undefined));
}

export async function getProject(scope: RequestScope, projectId: string): Promise<ProjectDoc> {
  if (!Types.ObjectId.isValid(projectId)) throw notFound('Project');
  const project = await Project.findOne({ _id: projectId, workspaceId: scope.workspaceId, deletedAt: null });
  if (!project) throw notFound('Project');
  return project;
}

export async function createProject(scope: RequestScope, input: CreateProjectInput, audit: AuditContext): Promise<ProjectDoc> {
  const name = input.name.trim();

  const duplicate = await Project.findOne({ workspaceId: scope.workspaceId, name, deletedAt: null })
    .collation({ locale: 'en', strength: 2 })
    .lean();
  if (duplicate) throw conflict('A project with that name already exists.', 'PROJECT_NAME_TAKEN');

  if (input.personId) {
    const person = await Person.findOne({ _id: input.personId, workspaceId: scope.workspaceId, deletedAt: null }).lean();
    if (!person) throw notFound('Person');
  }

  const project = await Project.create({
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    name,
    personId: input.personId ?? null,
    status: input.status ?? 'active',
    budgetMinor: input.budgetMinor ?? null,
    notes: input.notes,
  });

  await recordAudit(audit, {
    action: 'created',
    entityType: 'Project',
    entityId: project._id,
    summary: `Created project "${project.name}"`,
  });

  return project;
}

export type UpdateProjectInput = Partial<CreateProjectInput>;

export async function updateProject(
  scope: RequestScope,
  projectId: string,
  input: UpdateProjectInput,
  audit: AuditContext,
  expectedRev?: number,
): Promise<ProjectDoc> {
  const project = await getProject(scope, projectId);

  if (input.name && input.name.trim() !== project.name) {
    const duplicate = await Project.findOne({
      workspaceId: scope.workspaceId,
      name: input.name.trim(),
      deletedAt: null,
      _id: { $ne: project._id },
    })
      .collation({ locale: 'en', strength: 2 })
      .lean();
    if (duplicate) throw conflict('A project with that name already exists.', 'PROJECT_NAME_TAKEN');
    project.name = input.name.trim();
  }

  if (input.personId !== undefined) {
    if (input.personId) {
      const person = await Person.findOne({ _id: input.personId, workspaceId: scope.workspaceId, deletedAt: null }).lean();
      if (!person) throw notFound('Person');
      project.personId = person._id;
    } else {
      project.personId = null;
    }
  }
  if (input.status !== undefined) project.status = input.status;
  if (input.budgetMinor !== undefined) project.budgetMinor = input.budgetMinor;
  if (input.notes !== undefined) project.notes = input.notes;

  await claimRevision(Project, project, expectedRev);
  await project.save();

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'Project',
    entityId: project._id,
    summary: `Updated project "${project.name}"`,
  });

  return project;
}

/** Refused while any invoice still points at this project — same "settle before removing" discipline as Person. */
export async function deleteProject(scope: RequestScope, projectId: string, audit: AuditContext): Promise<void> {
  const project = await getProject(scope, projectId);

  const invoiceCount = await Invoice.countDocuments({ workspaceId: scope.workspaceId, projectId: project._id, deletedAt: null });
  if (invoiceCount > 0) {
    throw conflict('This project has invoices against it. Delete or reassign them first.', 'PROJECT_HAS_INVOICES');
  }

  project.deletedAt = new Date();
  project.deletedBy = scope.userId;
  await project.save();

  await recordAudit(audit, {
    action: 'deleted',
    entityType: 'Project',
    entityId: project._id,
    summary: `Removed project "${project.name}"`,
  });
}

/**
 * Project profit (§Phase 11) — computed live from paid invoices and
 * attributed expense transactions, never cached, same discipline as every
 * account/person balance in this app.
 */
export async function getProjectSummary(scope: RequestScope, projectId: string): Promise<ProjectSummaryDto> {
  const project = await getProject(scope, projectId);
  const personName = project.personId
    ? (await Person.findById(project.personId).select('name').lean())?.name
    : undefined;

  const [billedAgg, invoiceCount, openInvoiceCount, expenseAgg] = await Promise.all([
    Invoice.aggregate<{ total: number }>([
      { $match: { workspaceId: project.workspaceId, projectId: project._id, status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$totalMinor' } } },
    ]),
    Invoice.countDocuments({ workspaceId: project.workspaceId, projectId: project._id, deletedAt: null }),
    Invoice.countDocuments({ workspaceId: project.workspaceId, projectId: project._id, deletedAt: null, status: { $in: ['draft', 'sent'] } }),
    Transaction.aggregate<{ total: number }>([
      { $match: { workspaceId: project.workspaceId, projectId: project._id, type: 'expense', deletedAt: null, ...excludeHiddenTransactions(scope) } },
      { $group: { _id: null, total: { $sum: '$amountMinor' } } },
    ]),
  ]);

  const billedMinor = billedAgg[0]?.total ?? 0;
  const expenseMinor = expenseAgg[0]?.total ?? 0;

  return {
    project: toProjectDto(project, personName),
    billedMinor,
    expenseMinor,
    profitMinor: billedMinor - expenseMinor,
    invoiceCount,
    openInvoiceCount,
  };
}
