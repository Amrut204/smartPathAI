import type { AuthContext } from "./domain.types.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
