import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { RenderTask } from "pdfjs-dist/types/src/display/api";

import { Button, Card, Spinner } from "../../components/ui";
import { useResourceStorageBudget, type ResourceItem } from "../../hooks/use-resources";
import { withCsrfHeader } from "../../utils/csrf";
import { finishPerfMark, startPerfMark } from "../../utils/perf";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

GlobalWorkerOptions.workerSrc = pdfWorker;

function resolveResourceUrl(url: string): string {
  const value = url.trim();
  if (!value) return "#";

  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/api/v1/resources/file?")) return value;
  if (/^www\./i.test(value)) return `https://${value}`;

  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("material/")) {
    const relativePath = normalized.slice("material/".length);
    return `/api/v1/resources/file?path=${encodeURIComponent(relativePath)}`;
  }

  if (/\.(pdf|md|markdown|txt|doc|docx|ipynb|csv|json)$/i.test(normalized)) {
    return `/api/v1/resources/file?path=${encodeURIComponent(normalized)}`;
  }

  return value;
}

function buildViewerFetchUrl(url: string, cloudHosted: boolean): string {
  if (!cloudHosted) {
    return url;
  }
  return `/api/v1/resources/file?url=${encodeURIComponent(url)}`;
}

function decodeLocalPath(url: string): string {
  const value = url.trim();
  if (!value) return "";

  if (value.startsWith("/api/v1/resources/file?")) {
    const query = value.split("?")[1] ?? "";
    const params = new URLSearchParams(query);
    return String(params.get("path") ?? "").trim();
  }

  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("material/")) {
    return normalized.slice("material/".length).trim();
  }

  if (/^https?:\/\//i.test(normalized)) {
    return "";
  }

  return normalized;
}

function cleanInlineText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .trim();
}

type ViewerBlock =
  | { type: "heading"; content: string; level: number }
  | { type: "list"; content: string[] }
  | { type: "paragraph"; content: string };

function renderStructuredBlocks(text: string) {
  const normalized = cleanInlineText(text);
  if (!normalized) {
    return [] as ViewerBlock[];
  }

  const lines = normalized.split("\n").map((line) => line.trim());
  const blocks: ViewerBlock[] = [];
  let paragraphBuffer: string[] = [];
  let listBuffer: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length > 0) {
      blocks.push({ type: "paragraph", content: paragraphBuffer.join(" ") });
      paragraphBuffer = [];
    }
  };

  const flushList = () => {
    if (listBuffer.length > 0) {
      blocks.push({ type: "list", content: [...listBuffer] });
      listBuffer = [];
    }
  };

  for (const line of lines) {
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        content: headingMatch[2].trim(),
        level: headingMatch[1].length,
      });
      continue;
    }

    const listMatch = line.match(/^[-*+]\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      listBuffer.push(listMatch[1].trim());
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      flushParagraph();
      listBuffer.push(line.replace(/^\d+\.\s+/, "").trim());
      continue;
    }

    flushList();
    paragraphBuffer.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}

function isTextLikeResource(resourceType: string) {
  const type = resourceType.trim().toLowerCase();
  return type === "markdown" || type === "text" || type === "notes" || type === "notebook" || type === "dataset";
}

function isPdfResource(resourceType: string) {
  return resourceType.trim().toLowerCase() === "pdf";
}

function isExternalResource(resource: ResourceItem) {
  return resource.sourceMode === "external" || (!resource.sourceMode && /^https?:\/\//i.test(resource.url));
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();

  if (contentType.includes("application/json")) {
    try {
      const payload = (await response.json()) as ApiResponse<unknown> & { error?: { message?: string } };
      return payload.error?.message ?? fallback;
    } catch {
      return fallback;
    }
  }

  try {
    const text = (await response.text()).trim();
    return text || fallback;
  } catch {
    return fallback;
  }
}

function buildEventPayload(eventType: string, sessionId: string, sourceContext: string, metrics?: {
  durationSec?: number;
  progressPct?: number;
  pageNumber?: number;
  scrollDepthPct?: number;
  metadata?: Record<string, unknown>;
}) {
  return JSON.stringify({
    eventType,
    sessionId,
    sourceContext,
    durationSec: metrics?.durationSec ?? 0,
    progressPct: metrics?.progressPct,
    pageNumber: metrics?.pageNumber,
    scrollDepthPct: metrics?.scrollDepthPct,
    metadata: metrics?.metadata ?? {},
  });
}

export default function ResourceViewerPage() {
  const { resourceId = "" } = useParams();
  const location = useLocation();
  const sessionIdRef = useRef<string>(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  const openedAtRef = useRef<number>(0);
  const maxScrollDepthRef = useRef<number>(0);
  const hasOpenedRef = useRef(false);
  const closeSentRef = useRef(false);
  const currentPdfPageRef = useRef(1);
  const pdfPageCountRef = useRef(1);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const initialResource = useMemo(() => {
    const state = location.state as { resource?: ResourceItem } | null;
    if (!state?.resource || state.resource.id !== resourceId) {
      return null;
    }
    return state.resource;
  }, [location.state, resourceId]);
  const [resource, setResource] = useState<ResourceItem | null>(initialResource);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initialResource);
  const [contentLoading, setContentLoading] = useState(false);
  const [pdfDocument, setPdfDocument] = useState<any>(null);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfPageRendering, setPdfPageRendering] = useState(false);
  const { data: storageBudget } = useResourceStorageBudget();

  useEffect(() => {
    startPerfMark("resource-viewer:first-usable");
    return () => finishPerfMark("resource-viewer:first-usable");
  }, []);

  useEffect(() => {
    sessionIdRef.current = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    openedAtRef.current = 0;
    maxScrollDepthRef.current = 0;
    hasOpenedRef.current = false;
    closeSentRef.current = false;
    currentPdfPageRef.current = 1;
    pdfPageCountRef.current = 1;
  }, [resourceId]);

  useEffect(() => {
    setResource(initialResource);
    setLoading(!initialResource);
    setError(null);
  }, [initialResource, resourceId]);

  useEffect(() => {
    currentPdfPageRef.current = pdfCurrentPage;
  }, [pdfCurrentPage]);

  useEffect(() => {
    let active = true;

    async function loadResource() {
      if (!resourceId) {
        setError("Missing resource id.");
        setLoading(false);
        return;
      }

      if (!initialResource) {
        setLoading(true);
      }
      setError(null);

      try {
        const response = await fetch(`/api/v1/resources/${encodeURIComponent(resourceId)}`, {
          credentials: "include",
        });
        const payload = (await response.json()) as ApiResponse<ResourceItem>;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error?.message ?? `Unable to load resource (${response.status})`);
        }

        if (!active) return;
        setResource((current) => payload.data ?? current);
      } catch (loadError) {
        if (!active) return;
        if (!initialResource) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load resource");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadResource();
    return () => {
      active = false;
    };
  }, [initialResource, resourceId]);

  const resolvedUrl = useMemo(() => resolveResourceUrl(resource?.url ?? ""), [resource?.url]);
  const resolvedViewerUrl = useMemo(() => buildViewerFetchUrl(resolvedUrl, resource?.sourceMode === "cloud"), [resolvedUrl, resource?.sourceMode]);
  const localPath = useMemo(() => decodeLocalPath(resource?.url ?? ""), [resource?.url]);
  const textLike = useMemo(() => isTextLikeResource(String(resource?.resourceType ?? "")), [resource?.resourceType]);
  const pdfLike = useMemo(() => isPdfResource(String(resource?.resourceType ?? "")), [resource?.resourceType]);
  const external = useMemo(() => (resource ? isExternalResource(resource) : false), [resource]);
  const cloudHosted = useMemo(() => resource?.sourceMode === "cloud", [resource?.sourceMode]);
  const cloudBlocked = useMemo(
    () => cloudHosted && storageBudget?.enabled && storageBudget.overallStatus === "blocked",
    [cloudHosted, storageBudget],
  );

  useEffect(() => {
    if (!resource || (!localPath && !cloudHosted) || !textLike || cloudBlocked) {
      setContent("");
      return;
    }

    let active = true;

    async function loadTextContent() {
      setContentLoading(true);
      try {
        const targetUrl = cloudHosted ? resolvedUrl : `/api/v1/resources/file?path=${encodeURIComponent(localPath)}`;
        const response = await fetch(cloudHosted ? resolvedViewerUrl : targetUrl, cloudHosted ? {
          credentials: "include",
        } : {
          credentials: "include",
        });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, `Unable to load resource content (${response.status})`));
        }
        const text = await response.text();
        if (!active) return;
        setContent(text);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load resource content");
      } finally {
        if (active) {
          setContentLoading(false);
        }
      }
    }

    void loadTextContent();

    return () => {
      active = false;
    };
  }, [cloudBlocked, cloudHosted, localPath, resolvedUrl, resolvedViewerUrl, resource, textLike]);

  useEffect(() => {
    if (!resource || (!localPath && !cloudHosted) || !pdfLike || external || cloudBlocked) {
      setPdfDocument(null);
      setPdfPageCount(0);
      setPdfCurrentPage(1);
      return;
    }

    let active = true;

    async function loadPdf() {
      setPdfLoading(true);
      try {
        const targetUrl = cloudHosted ? resolvedUrl : `/api/v1/resources/file?path=${encodeURIComponent(localPath)}`;
        const response = await fetch(cloudHosted ? resolvedViewerUrl : targetUrl, cloudHosted ? {
          credentials: "include",
        } : {
          credentials: "include",
        });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, `Unable to load PDF (${response.status})`));
        }

        const buffer = await response.arrayBuffer();
        const document = await getDocument({ data: new Uint8Array(buffer) }).promise;
        if (!active) {
          await document.destroy();
          return;
        }

        setPdfDocument(document);
        setPdfPageCount(document.numPages);
        setPdfCurrentPage(1);
        currentPdfPageRef.current = 1;
        pdfPageCountRef.current = document.numPages;
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load PDF");
      } finally {
        if (active) {
          setPdfLoading(false);
        }
      }
    }

    void loadPdf();

    return () => {
      active = false;
    };
  }, [cloudBlocked, cloudHosted, external, localPath, pdfLike, resolvedUrl, resolvedViewerUrl, resource]);

  useEffect(() => {
    return () => {
      if (pdfDocument && typeof pdfDocument.destroy === "function") {
        void pdfDocument.destroy().catch(() => undefined);
      }
    };
  }, [pdfDocument]);

  useEffect(() => {
    if (!pdfDocument || pdfPageCount === 0 || !pdfLike) return;

    let cancelled = false;
    let renderTask: RenderTask | null = null;

    async function renderCurrentPage() {
      const canvas = pdfCanvasRef.current;
      if (!canvas) return;

      setPdfPageRendering(true);
      try {
        const page = await pdfDocument.getPage(pdfCurrentPage);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: 1.25 });
        const deviceScale = window.devicePixelRatio || 1;
        const context = canvas.getContext("2d");
        if (!context || cancelled) return;

        canvas.width = Math.floor(viewport.width * deviceScale);
        canvas.height = Math.floor(viewport.height * deviceScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);

        const task = page.render({
          canvasContext: context,
          viewport,
        });
        renderTask = task;
        await task.promise;
      } finally {
        if (!cancelled) {
          setPdfPageRendering(false);
        }
      }
    }

    void renderCurrentPage();

    return () => {
      cancelled = true;
      if (renderTask?.cancel) {
        renderTask.cancel();
      }
    };
  }, [pdfCurrentPage, pdfDocument, pdfLike, pdfPageCount]);

  useEffect(() => {
    if (!resource || hasOpenedRef.current) return;

    hasOpenedRef.current = true;
    openedAtRef.current = Date.now();

    void fetch(`/api/v1/resources/${encodeURIComponent(resource.id)}/view-events`, {
      method: "POST",
      credentials: "include",
      headers: withCsrfHeader({ "Content-Type": "application/json" }),
      body: buildEventPayload("open", sessionIdRef.current, "resource_viewer", {
        metadata: { resourceTitle: resource.title },
      }),
    }).catch(() => undefined);
  }, [resource]);

  useEffect(() => {
    if (resource && !loading && !error && !pdfLoading && !pdfPageRendering) {
      finishPerfMark("resource-viewer:first-usable");
    }
  }, [error, loading, pdfLoading, pdfPageRendering, resource]);

  useEffect(() => {
    if (!resource) return;

    const onScroll = () => {
      const doc = document.documentElement;
      const scrollable = Math.max(doc.scrollHeight - window.innerHeight, 0);
      const progress = scrollable <= 0 ? 100 : Math.min(100, Math.round((window.scrollY / scrollable) * 100));
      maxScrollDepthRef.current = Math.max(maxScrollDepthRef.current, progress);
    };

    const interval = window.setInterval(() => {
      const durationSec = Math.max(1, Math.round((Date.now() - openedAtRef.current) / 1000));
      void fetch(`/api/v1/resources/${encodeURIComponent(resource.id)}/view-events`, {
        method: "POST",
        credentials: "include",
        headers: withCsrfHeader({ "Content-Type": "application/json" }),
        body: buildEventPayload("heartbeat", sessionIdRef.current, "resource_viewer", {
          durationSec,
          progressPct: pdfLike
            ? Number(((currentPdfPageRef.current / Math.max(pdfPageCountRef.current, 1)) * 100).toFixed(1))
            : maxScrollDepthRef.current,
          pageNumber: pdfLike ? currentPdfPageRef.current : undefined,
          scrollDepthPct: maxScrollDepthRef.current,
          metadata: { resourceTitle: resource.title },
        }),
      }).catch(() => undefined);
    }, 20000);

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const sendCloseEvent = () => {
      if (closeSentRef.current) {
        return;
      }
      closeSentRef.current = true;
      const durationSec = Math.max(1, Math.round((Date.now() - openedAtRef.current) / 1000));
      const payload = buildEventPayload("close", sessionIdRef.current, "resource_viewer", {
        durationSec,
        progressPct: pdfLike
          ? Number(((currentPdfPageRef.current / Math.max(pdfPageCountRef.current, 1)) * 100).toFixed(1))
          : maxScrollDepthRef.current,
        pageNumber: pdfLike ? currentPdfPageRef.current : undefined,
        scrollDepthPct: maxScrollDepthRef.current,
        metadata: { resourceTitle: resource.title },
      });

      const endpoint = `/api/v1/resources/${encodeURIComponent(resource.id)}/view-events`;
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon(endpoint, blob);
        return;
      }

      void fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: withCsrfHeader({ "Content-Type": "application/json" }),
        keepalive: true,
        body: payload,
      }).catch(() => undefined);
    };

    window.addEventListener("beforeunload", sendCloseEvent);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("beforeunload", sendCloseEvent);
      sendCloseEvent();
    };
  }, [pdfLike, resource]);

  const blocks = useMemo(() => renderStructuredBlocks(content), [content]);
  const studyDocument = resource?.studyDocument;
  const licenseType = ((resource as ResourceItem & { license_type?: string | null })?.license_type ?? "").trim();
  const showLicenseBadge = licenseType !== "" && licenseType.toLowerCase() !== "unverified";

  const handleExternalOpen = () => {
    if (!resource) return;
    void fetch(`/api/v1/resources/${encodeURIComponent(resource.id)}/view-events`, {
      method: "POST",
      credentials: "include",
      headers: withCsrfHeader({ "Content-Type": "application/json" }),
      body: buildEventPayload("external_redirect", sessionIdRef.current, "resource_viewer", {
        durationSec: Math.max(1, Math.round((Date.now() - openedAtRef.current) / 1000)),
        scrollDepthPct: maxScrollDepthRef.current,
        metadata: { resourceTitle: resource.title },
      }),
    }).catch(() => undefined);
  };

  return (
    <section className="resource-viewer-page">
      <Card className="resource-viewer-shell">
        <div className="resource-viewer-header">
          <div className="resource-viewer-header-copy">
            <p className="resources-kicker">In-App Viewer</p>
            <h1>{resource?.title ?? "Resource Viewer"}</h1>
            <div className="resource-viewer-header-meta" style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <p className="muted-text" style={{ margin: 0 }}>
                {resource ? `${String(resource.resourceType ?? "resource").replace(/_/g, " ")} resource` : "Loading resource"}
              </p>
              {showLicenseBadge ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    lineHeight: 1.4,
                    background: "var(--color-background-success, #dcfce7)",
                    color: "var(--color-text-success, #166534)",
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: "var(--border-radius-md, 14px)",
                  }}
                >
                  {licenseType}
                </span>
              ) : null}
            </div>
          </div>
          <div className="hero-actions resource-viewer-header-actions">
            <Link to="/resources">
              <Button variant="secondary">Back to Resources</Button>
            </Link>
            {resource ? (
              external ? (
                <a href={resolvedUrl} target="_blank" rel="noopener noreferrer" onClick={handleExternalOpen}>
                  <Button variant="ghost">Open Original</Button>
                </a>
              ) : (
                <a href={cloudHosted ? resolvedViewerUrl : resolvedUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="ghost">{pdfLike ? "Open Raw PDF" : "Open Original"}</Button>
                </a>
              )
            ) : null}
          </div>
        </div>

        {loading ? (
          <Card className="app-state-card">
            <Spinner />
            <p className="muted-text">Loading resource...</p>
          </Card>
        ) : null}

        {!loading && error ? (
          <Card className="app-state-card app-state-card-error">
            <h2>Unable to load this resource</h2>
            <p>{error}</p>
          </Card>
        ) : null}

        {!loading && !error && resource && cloudBlocked ? (
          <Card className="app-state-card app-state-card-error">
            <h2>Cloud Resource Access Paused</h2>
            <p>{storageBudget?.message ?? "This month's AWS safety cap has been reached, so cloud-hosted resources are paused for now."}</p>
            <p className="muted-text">
              Reads: {storageBudget?.requests.used ?? 0}/{storageBudget?.requests.limit ?? 0}
              {" · "}
              Transfer: {storageBudget?.transfer.displayUsed ?? "0 B"}/{storageBudget?.transfer.displayLimit ?? "0 B"}
            </p>
          </Card>
        ) : null}

        {!loading && !error && resource && !cloudBlocked ? (
          <>
            <div className="resource-viewer-summary">
              <p>{studyDocument?.whatThisCovers?.trim() || resource.summaryShort?.trim() || resource.description?.trim() || "No summary available for this resource yet."}</p>
              {Array.isArray(resource.keyTopics) && resource.keyTopics.length > 0 ? (
                <div className="resource-topic-chips">
                  {resource.keyTopics.slice(0, 5).map((topic) => (
                    <span key={`${resource.id}-${topic}`} className="resource-topic-chip">{topic}</span>
                  ))}
                </div>
              ) : null}
            </div>

            {pdfLike && !external ? (
              <div className="resource-pdf-frame-wrap">
                <div className="resource-pdf-toolbar">
                  <span className="resource-pdf-toolbar-page">Page {pdfCurrentPage} of {pdfPageCount || "--"}</span>
                  <span className="resource-pdf-toolbar-progress">{pdfPageCount > 0 ? `${Math.round((pdfCurrentPage / pdfPageCount) * 100)}% viewed` : "Preparing PDF viewer"}</span>
                  <div className="hero-actions resource-pdf-toolbar-actions">
                    <Button variant="secondary" onClick={() => setPdfCurrentPage((page) => Math.max(1, page - 1))} disabled={pdfCurrentPage <= 1 || pdfPageRendering}>
                      Previous
                    </Button>
                    <Button variant="secondary" onClick={() => setPdfCurrentPage((page) => Math.min(pdfPageCount, page + 1))} disabled={pdfCurrentPage >= pdfPageCount || pdfPageRendering}>
                      Next
                    </Button>
                  </div>
                </div>
                {pdfLoading ? (
                  <Card className="app-state-card">
                    <Spinner />
                    <p className="muted-text">Loading PDF...</p>
                  </Card>
                ) : (
                  <div className="resource-pdf-pages">
                    {pdfPageRendering ? (
                      <div className="resource-pdf-overlay">
                        <Spinner />
                        <p className="muted-text">Rendering page...</p>
                      </div>
                    ) : null}
                    <canvas
                      key={`${resource.id}-page-${pdfCurrentPage}`}
                      ref={pdfCanvasRef}
                      data-page={pdfCurrentPage}
                      className="resource-pdf-canvas"
                    />
                  </div>
                )}
              </div>
            ) : null}

            {textLike && !external ? (
              contentLoading ? (
                <Card className="app-state-card">
                  <Spinner />
                  <p className="muted-text">Loading note content...</p>
                </Card>
              ) : (
                <div className="resource-viewer-content">
                  {studyDocument ? (
                    <>
                      {studyDocument.topic ? <p className="resource-viewer-meta-line">Topic: {studyDocument.topic}{studyDocument.subtopic ? ` - ${studyDocument.subtopic}` : ""}</p> : null}
                      {studyDocument.keyConcepts?.length ? (
                        <>
                          <h2>Key Concepts</h2>
                          <ul className="resource-viewer-list">
                            {studyDocument.keyConcepts.map((item) => <li key={`${resource.id}-concept-${item}`}>{item}</li>)}
                          </ul>
                        </>
                      ) : null}
                      {studyDocument.importantDefinitions?.length ? (
                        <>
                          <h2>Important Definitions</h2>
                          <ul className="resource-viewer-list">
                            {studyDocument.importantDefinitions.map((item) => <li key={`${resource.id}-definition-${item}`}>{item}</li>)}
                          </ul>
                        </>
                      ) : null}
                      {studyDocument.coreExplanation ? (
                        <>
                          <h2>Core Explanation</h2>
                          <p>{studyDocument.coreExplanation}</p>
                        </>
                      ) : null}
                      {studyDocument.stepByStepUnderstanding?.length ? (
                        <>
                          <h2>Step-by-Step Understanding</h2>
                          <ol className="resource-viewer-list ordered">
                            {studyDocument.stepByStepUnderstanding.map((item) => <li key={`${resource.id}-step-${item}`}>{item}</li>)}
                          </ol>
                        </>
                      ) : null}
                      {studyDocument.interviewFocus?.length ? (
                        <>
                          <h2>Interview Focus</h2>
                          <ul className="resource-viewer-list">
                            {studyDocument.interviewFocus.map((item) => <li key={`${resource.id}-interview-${item}`}>{item}</li>)}
                          </ul>
                        </>
                      ) : null}
                      {studyDocument.commonMistakes?.length ? (
                        <>
                          <h2>Common Mistakes</h2>
                          <ul className="resource-viewer-list">
                            {studyDocument.commonMistakes.map((item) => <li key={`${resource.id}-mistake-${item}`}>{item}</li>)}
                          </ul>
                        </>
                      ) : null}
                      {studyDocument.quickRevisionPoints?.length ? (
                        <>
                          <h2>Quick Revision Points</h2>
                          <ul className="resource-viewer-list">
                            {studyDocument.quickRevisionPoints.map((item) => <li key={`${resource.id}-revision-${item}`}>{item}</li>)}
                          </ul>
                        </>
                      ) : null}
                      {studyDocument.practicePrompts?.length ? (
                        <>
                          <h2>Practice Prompts</h2>
                          <ul className="resource-viewer-list">
                            {studyDocument.practicePrompts.map((item) => <li key={`${resource.id}-prompt-${item}`}>{item}</li>)}
                          </ul>
                        </>
                      ) : null}
                      {studyDocument.recommendedFor?.length ? (
                        <>
                          <h2>Recommended For</h2>
                          <ul className="resource-viewer-list">
                            {studyDocument.recommendedFor.map((item) => <li key={`${resource.id}-recommended-${item}`}>{item}</li>)}
                          </ul>
                        </>
                      ) : null}
                      {studyDocument.sourceQualityNotes ? (
                        <>
                          <h2>Source Quality Notes</h2>
                          <p>{studyDocument.sourceQualityNotes}</p>
                        </>
                      ) : null}
                    </>
                  ) : blocks.length === 0 ? (
                    <p className="muted-text">This resource does not contain readable inline content.</p>
                  ) : (
                    blocks.map((block, index) => {
                      if (block.type === "heading") {
                        const Tag = block.level <= 2 ? "h2" : "h3";
                        return <Tag key={`${block.type}-${index}`}>{block.content}</Tag>;
                      }

                      if (block.type === "list") {
                        return (
                          <ul key={`${block.type}-${index}`} className="resource-viewer-list">
                            {block.content.map((item, itemIndex) => (
                              <li key={`${index}-${itemIndex}`}>{item}</li>
                            ))}
                          </ul>
                        );
                      }

                      return <p key={`${block.type}-${index}`}>{block.content}</p>;
                    })
                  )}
                </div>
              )
            ) : null}

            {external ? (
              <Card className="resource-external-card">
                <h2>External Resource</h2>
                <p>This item stays in the library and tracking starts here, but the original content lives on an external site.</p>
                <div className="hero-actions">
                  <a href={resolvedUrl} target="_blank" rel="noopener noreferrer" onClick={handleExternalOpen}>
                    <Button>Continue to External Resource</Button>
                  </a>
                </div>
              </Card>
            ) : null}

            {!pdfLike && !textLike && !external ? (
              <Card className="resource-external-card">
                <h2>Download-Based Resource</h2>
                <p>This file type does not have an inline renderer yet. The viewer still tracks that the student opened it from inside the platform.</p>
                <div className="hero-actions">
                  <a href={resolvedUrl} target="_blank" rel="noopener noreferrer">
                    <Button>Open Original File</Button>
                  </a>
                </div>
              </Card>
            ) : null}
          </>
        ) : null}
      </Card>
    </section>
  );
}
