import request from 'supertest';
import type { Express } from 'express';
import type { AuthSessionDto } from '@khata/shared';
import { createApp } from '../src/app.js';

let cachedApp: Express | null = null;

export function app(): Express {
  cachedApp ??= createApp();
  return cachedApp;
}

export interface TestUser {
  email: string;
  password: string;
  token: string;
  userId: string;
  workspaceId: string;
  refreshCookie: string;
  session: AuthSessionDto;
}

let counter = 0;

/**
 * Register a user and return everything a test needs to act as them.
 *
 * Every test gets its own user so that data-isolation assertions are meaningful
 * and no test can depend on another's leftovers.
 */
export async function createTestUser(
  overrides: Partial<{ name: string; email: string; password: string; workspaceMode: 'personal' | 'business' }> = {},
): Promise<TestUser> {
  counter += 1;
  const email = overrides.email ?? `user${counter}.${Date.now()}@example.com`;
  const password = overrides.password ?? 'Correct-Horse-9!';

  const response = await request(app())
    .post('/api/v1/auth/register')
    .send({
      name: overrides.name ?? `Test User ${counter}`,
      email,
      password,
      currency: 'INR',
      workspaceMode: overrides.workspaceMode ?? 'personal',
    })
    .expect(201);

  const session = response.body.data as AuthSessionDto;
  const cookies = response.headers['set-cookie'] as unknown as string[] | undefined;
  const refreshCookie = (cookies ?? []).find((c) => c.startsWith('khata_rt='))?.split(';')[0] ?? '';

  return {
    email,
    password,
    token: session.accessToken,
    userId: session.user.id,
    workspaceId: session.workspaces[0]!.id,
    refreshCookie,
    session,
  };
}

/** A supertest agent already carrying this user's credentials and workspace scope. */
export function as(user: TestUser) {
  const base = request(app());
  const decorate = (req: request.Test) =>
    req.set('Authorization', `Bearer ${user.token}`).set('X-Workspace-Id', user.workspaceId);

  return {
    get: (path: string) => decorate(base.get(path)),
    post: (path: string) => decorate(base.post(path)),
    patch: (path: string) => decorate(base.patch(path)),
    put: (path: string) => decorate(base.put(path)),
    delete: (path: string) => decorate(base.delete(path)),
  };
}

/** Anonymous agent, for testing what an unauthenticated caller can reach. */
export function anon() {
  return request(app());
}

/** Rupees → paise, for readable test fixtures. */
export const rupees = (amount: number): number => Math.round(amount * 100);
