/**
 * Cache Storage names shared by the service worker (which fills them) and the app
 * (which must be able to empty them on sign-out). One definition, so the two can
 * never drift apart and leave a user's cached financial data behind.
 */
export const API_CACHE = 'khata-api-cache-v1';
