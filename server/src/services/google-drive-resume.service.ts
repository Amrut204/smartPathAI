import { randomUUID } from "node:crypto";

import { GoogleAuth, OAuth2Client } from "google-auth-library";

import { AppError } from "../middleware/error-handler.js";
import { MongoAuthRepository } from "../repositories/mongo-auth.repository.js";

type TenantDriveConfig = {
  sharedDriveId: string | null;
  rootFolderId: string;
  tenantFolderName: string;
};

type DriveFileRecord = {
  id: string;
  name: string;
  webViewLink?: string;
  webContentLink?: string;
  mimeType?: string;
  size?: string;
};

export type ManagedResumeMetadata = {
  provider: "google_drive";
  fileId: string;
  webViewLink: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
};

function normalizeOptionalString(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

function getOAuthCredentials() {
  const clientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim();
  const refreshToken = String(process.env.GOOGLE_OAUTH_REFRESH_TOKEN ?? "").trim().replace(/\r?\n/g, "");

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  return { clientId, clientSecret, refreshToken };
}

function getServiceAccountCredentials() {
  const clientEmail = String(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL ?? "").trim();
  const privateKeyRaw = String(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "").trim();
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new AppError(
      "GOOGLE_DRIVE_SERVICE_ACCOUNT_MISSING",
      "Google Drive resume storage is not configured yet. Ask admin to finish the service account setup.",
      500,
    );
  }

  return { clientEmail, privateKey };
}

async function getAccessToken() {
  const oauth = getOAuthCredentials();
  let token: string | null | undefined | { token?: string | null };

  if (oauth) {
    const client = new OAuth2Client(oauth.clientId, oauth.clientSecret);
    client.setCredentials({ refresh_token: oauth.refreshToken });
    token = await client.getAccessToken();
  } else {
    const { clientEmail, privateKey } = getServiceAccountCredentials();
    const auth = new GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      scopes: ["https://www.googleapis.com/auth/drive"],
    });

    const client = await auth.getClient();
    token = await client.getAccessToken();
  }

  const accessToken = typeof token === "string" ? token : token?.token;
  if (!accessToken) {
    throw new AppError("GOOGLE_DRIVE_ACCESS_TOKEN_FAILED", "Unable to authenticate with Google Drive.", 500);
  }
  return accessToken;
}

async function driveRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new AppError(
      "GOOGLE_DRIVE_REQUEST_FAILED",
      `Google Drive request failed (${response.status}). ${text || "Check tenant Drive configuration."}`,
      502,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function getTenantDriveConfig(tenantId: string): Promise<TenantDriveConfig> {
  const tenant = await MongoAuthRepository.findTenantById(tenantId);
  if (!tenant) {
    throw new AppError("TENANT_NOT_FOUND", "Selected college was not found.", 404);
  }

  const config = tenant.config && typeof tenant.config === "object"
    ? tenant.config as Record<string, unknown>
    : {};
  const adminOps = config.adminOps && typeof config.adminOps === "object"
    ? config.adminOps as Record<string, unknown>
    : {};
  const integrations = adminOps.integrations && typeof adminOps.integrations === "object"
    ? adminOps.integrations as Record<string, unknown>
    : {};
  const sharedDriveId = normalizeOptionalString(integrations.googleDriveSharedDriveId)
    ?? normalizeOptionalString(process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID);
  const rootFolderId = normalizeOptionalString(integrations.googleDriveRootFolderId)
    ?? normalizeOptionalString(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID);

  if (!rootFolderId) {
    throw new AppError(
      "GOOGLE_DRIVE_NOT_CONFIGURED",
      "Resume storage is not configured yet. Add a Google Drive root folder ID in Admin Hub settings or GOOGLE_DRIVE_ROOT_FOLDER_ID in server env.",
      409,
    );
  }

  return {
    sharedDriveId,
    rootFolderId,
    tenantFolderName: normalizeOptionalString(tenant.slug) ?? normalizeOptionalString(tenant.name) ?? tenantId,
  };
}

function escapeDriveQuery(value: string) {
  return value.replace(/'/g, "\\'");
}

async function listFiles(params: {
  sharedDriveId?: string | null;
  query: string;
  fields?: string;
}): Promise<DriveFileRecord[]> {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  if (params.sharedDriveId) {
    url.searchParams.set("corpora", "drive");
    url.searchParams.set("driveId", params.sharedDriveId);
  }
  url.searchParams.set("q", params.query);
  url.searchParams.set("fields", `files(${params.fields ?? "id,name,webViewLink,webContentLink,mimeType,size"})`);

  const data = await driveRequest<{ files?: DriveFileRecord[] }>(url.toString());
  return Array.isArray(data.files) ? data.files : [];
}

async function ensureFolder(params: {
  sharedDriveId?: string | null;
  parentId: string;
  name: string;
}) {
  const query = [
    `'${escapeDriveQuery(params.parentId)}' in parents`,
    `name = '${escapeDriveQuery(params.name)}'`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    "trashed = false",
  ].join(" and ");

  const existing = await listFiles({
    sharedDriveId: params.sharedDriveId,
    query,
    fields: "id,name",
  });
  if (existing[0]?.id) {
    return existing[0].id;
  }

  const payload = {
    name: params.name,
    mimeType: "application/vnd.google-apps.folder",
    parents: [params.parentId],
  };

  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("fields", "id,name");
  const data = await driveRequest<DriveFileRecord>(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return data.id;
}

function buildMultipartBody(params: {
  metadata: Record<string, unknown>;
  buffer: Buffer;
  mimeType: string;
}) {
  const boundary = `smartpath-${randomUUID()}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(params.metadata)}\r\n`
    + `--${boundary}\r\nContent-Type: ${params.mimeType}\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
  return {
    boundary,
    body: Buffer.concat([head, params.buffer, tail]),
  };
}

async function makeFileShareable(fileId: string) {
  try {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`);
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("sendNotificationEmail", "false");
    await driveRequest(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });
  } catch {
    // Keep upload successful even if the Drive policy blocks public link sharing.
  }
}

async function uploadFile(params: {
  folderId: string;
  fileName: string;
  buffer: Buffer;
  mimeType: string;
}) {
  const { boundary, body } = buildMultipartBody({
    metadata: {
      name: params.fileName,
      parents: [params.folderId],
    },
    buffer: params.buffer,
    mimeType: params.mimeType,
  });

  const url = new URL("https://www.googleapis.com/upload/drive/v3/files");
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("fields", "id,name,webViewLink,webContentLink,mimeType,size");

  const data = await driveRequest<DriveFileRecord>(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  await makeFileShareable(data.id);
  return data;
}

async function copyFile(params: {
  sourceFileId: string;
  folderId: string;
  fileName: string;
}) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${params.sourceFileId}/copy`);
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("fields", "id,name,webViewLink,webContentLink,mimeType,size");
  const data = await driveRequest<DriveFileRecord>(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: params.fileName,
      parents: [params.folderId],
    }),
  });
  await makeFileShareable(data.id);
  return data;
}

async function deleteFile(fileId: string) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
  url.searchParams.set("supportsAllDrives", "true");
  try {
    await driveRequest(url.toString(), { method: "DELETE" });
  } catch {
    // Ignore cleanup failures so resume updates still succeed.
  }
}

function sanitizeNamePart(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "student";
}

function formatMetadata(file: DriveFileRecord, fallback: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}) {
  return {
    provider: "google_drive" as const,
    fileId: String(file.id),
    webViewLink: String(file.webViewLink ?? file.webContentLink ?? ""),
    filename: String(file.name ?? fallback.fileName),
    mimeType: String(file.mimeType ?? fallback.mimeType),
    sizeBytes: Number(file.size ?? fallback.sizeBytes),
    uploadedAt: new Date().toISOString(),
  } satisfies ManagedResumeMetadata;
}

export const GoogleDriveResumeService = {
  getServiceAccountEmail() {
    return normalizeOptionalString(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL);
  },

  getStorageAuthLabel() {
    if (getOAuthCredentials()) {
      return "OAuth refresh token (Smart Path managed Google Drive)";
    }
    if (normalizeOptionalString(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL)) {
      return "Service account";
    }
    return null;
  },

  async getTenantDriveConfig(tenantId: string) {
    return getTenantDriveConfig(tenantId);
  },

  async uploadCurrentResume(params: {
    tenantId: string;
    studentId: string;
    fullName: string;
    originalFilename: string;
    buffer: Buffer;
    mimeType: string;
    previousFileId?: string | null;
  }) {
    const config = await getTenantDriveConfig(params.tenantId);
    const tenantFolderId = await ensureFolder({
      sharedDriveId: config.sharedDriveId,
      parentId: config.rootFolderId,
      name: sanitizeNamePart(config.tenantFolderName),
    });
    const currentFolderId = await ensureFolder({
      sharedDriveId: config.sharedDriveId,
      parentId: tenantFolderId,
      name: "current",
    });
    const fileName = `${sanitizeNamePart(params.studentId)}_${sanitizeNamePart(params.fullName)}.pdf`;
    const uploaded = await uploadFile({
      folderId: currentFolderId,
      fileName,
      buffer: params.buffer,
      mimeType: params.mimeType,
    });

    if (params.previousFileId && params.previousFileId !== uploaded.id) {
      await deleteFile(params.previousFileId);
    }

    return formatMetadata(uploaded, {
      fileName,
      mimeType: params.mimeType,
      sizeBytes: params.buffer.byteLength,
    });
  },

  async copyResumeSnapshot(params: {
    tenantId: string;
    driveId: string;
    studentId: string;
    fullName: string;
    sourceFileId: string;
    sourceFilename: string;
    mimeType?: string | null;
    sizeBytes?: number | null;
  }) {
    const config = await getTenantDriveConfig(params.tenantId);
    const tenantFolderId = await ensureFolder({
      sharedDriveId: config.sharedDriveId,
      parentId: config.rootFolderId,
      name: sanitizeNamePart(config.tenantFolderName),
    });
    const snapshotsFolderId = await ensureFolder({
      sharedDriveId: config.sharedDriveId,
      parentId: tenantFolderId,
      name: "snapshots",
    });
    const driveFolderId = await ensureFolder({
      sharedDriveId: config.sharedDriveId,
      parentId: snapshotsFolderId,
      name: sanitizeNamePart(params.driveId),
    });
    const fileName = `${sanitizeNamePart(params.studentId)}_${sanitizeNamePart(params.fullName)}_${Date.now()}.pdf`;
    const copied = await copyFile({
      sourceFileId: params.sourceFileId,
      folderId: driveFolderId,
      fileName,
    });

    return formatMetadata(copied, {
      fileName,
      mimeType: params.mimeType ?? "application/pdf",
      sizeBytes: Number(params.sizeBytes ?? 0),
    });
  },
};
