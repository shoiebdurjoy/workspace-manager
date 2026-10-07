import React from "react";
import { Link } from "react-router-dom";
import {
  ExternalLink,
  FileVideo,
  MonitorPlay,
  PackageCheck,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskStatusPill } from "@/components/tasks/TaskBadges";
import { useProductionVideos } from "@/hooks/use-production";
import { hierarchyPaths } from "@/lib/hierarchy";
import { creditsLabel, monthLabel } from "@/lib/production";
import { isValidTaskUrl, linkHost } from "@/lib/tasks";
import type { ProductionVideo } from "@/types/database";

const LinkChip: React.FC<{
  url: string | null;
  label: string;
  icon: React.ReactNode;
}> = ({ url, label, icon }) => {
  if (!url || !isValidTaskUrl(url)) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${label} (${linkHost(url) ?? "link"})`}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {icon}
      {label}
    </a>
  );
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

const VideoRow: React.FC<{ v: ProductionVideo }> = ({ v }) => (
  <li className="flex flex-col gap-2 border-b border-border/60 px-3 py-2.5 last:border-b-0">
    <div className="min-w-0">
      <Link
        to={hierarchyPaths.task(v.spaceId, v.listId, v.taskId)}
        className="inline-flex max-w-full items-center gap-1 text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="truncate">{v.title}</span>
        <ExternalLink
          aria-hidden
          className="h-3 w-3 shrink-0 text-muted-foreground"
        />
        <span className="sr-only">(open the task)</span>
      </Link>
      <p className="truncate text-xs text-muted-foreground">
        {v.spaceName}
        {v.folderName ? ` / ${v.folderName}` : ""} / {v.listName}
      </p>
    </div>
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <div className="text-xs">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          First submitted for QC
        </div>
        <time dateTime={v.firstQcSubmittedAt} className="tabular-nums">
          {when(v.firstQcSubmittedAt)}
        </time>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Now
        </span>
        <TaskStatusPill status={v.status} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
        <LinkChip
          url={v.reviewLink}
          label="Edited video"
          icon={<MonitorPlay aria-hidden className="h-3.5 w-3.5" />}
        />
        <LinkChip
          url={v.projectFileLink}
          label="Project file"
          icon={<FileVideo aria-hidden className="h-3.5 w-3.5" />}
        />
        <LinkChip
          url={v.finalExportLink}
          label="Final export"
          icon={<PackageCheck aria-hidden className="h-3.5 w-3.5" />}
        />
      </div>
    </div>
  </li>
);

/** The actual tasks behind one editor's month: real tasks, never copies. */
const MonthVideos: React.FC<{
  editorId: string;
  year: number;
  month: number;
}> = ({ editorId, year, month }) => {
  const query = useProductionVideos(editorId, year, month);
  const heading = monthLabel(year, month);

  if (query.isError) {
    return (
      <ErrorState
        title="The videos could not be loaded"
        message={
          query.error instanceof Error
            ? query.error.message
            : "Please try again."
        }
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (query.isLoading) {
    return (
      <div role="status" aria-label="Loading videos" className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  const videos = query.data ?? [];
  return (
    <section
      aria-label={`Videos first submitted for QC in ${heading}`}
      className="space-y-2"
    >
      <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
        {heading}
        <span className="text-xs font-normal text-muted-foreground">
          {creditsLabel(videos.length)}
        </span>
      </h3>
      {videos.length === 0 ? (
        <EmptyState
          title="Nothing first submitted for QC this month"
          description="Videos appear here in the month they first reached QC - FIRST APPROVAL."
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Stage and links are the task&apos;s own, as they are today. The date
            is when the video first reached QC, and never changes.
          </p>
          <ul className="overflow-hidden rounded-xl border border-border/80 bg-card">
            {videos.map((v) => (
              <VideoRow key={v.taskId} v={v} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
};

export default MonthVideos;
