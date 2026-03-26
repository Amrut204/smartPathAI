import type { NextFunction, Request, Response } from "express";

import { isServerFeatureEnabled, type ServerFeatureName } from "../config/features.js";

export function requireFeature(feature: ServerFeatureName) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!isServerFeatureEnabled(feature)) {
      res.status(404).json({
        success: false,
        error: {
          code: "FEATURE_NOT_AVAILABLE",
          message: "Feature not available in the current Smart Path deployment",
        },
      });
      return;
    }

    next();
  };
}
