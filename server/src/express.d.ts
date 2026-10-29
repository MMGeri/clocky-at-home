declare global {
  namespace Express {
    interface Request {
      userEmail?: string;
    }
  }
}

export {};
