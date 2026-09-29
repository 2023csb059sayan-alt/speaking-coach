import type { AccessClaims } from '../services/tokens';

declare global {
  namespace Express {
    interface Request {
      /** Correlates a learner-visible request id with our logs. */
      requestId: string;
      /** Present once requireAuth has verified the access cookie. */
      auth?: AccessClaims;
    }
  }
}

export {};
