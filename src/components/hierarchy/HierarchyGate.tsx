import React from 'react';
import { Link } from 'react-router-dom';
import { SearchX, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/loading-state';
import { ErrorState } from '@/components/ui/error-state';
import { useAuth } from '@/hooks/use-auth';
import { useHierarchy } from '@/hooks/use-hierarchy';
import { can } from '@/lib/permissions';
import { isUuid } from '@/lib/hierarchy';
import type { HierarchySpace } from '@/types/database';

interface HierarchyGateProps<T> {
  what: 'space' | 'folder' | 'list';
  /** URL ids that must all be well-formed UUIDs before anything is requested. */
  ids: Array<string | undefined>;
  resolve: (tree: HierarchySpace[]) => T | undefined;
  children: (value: T) => React.ReactNode;
}

/**
 * One gate for every deep link: validates the URL ids, waits for the tree, and turns
 * "missing", "someone else's" and "no access" into the same not-found screen, so a URL never
 * reveals whether a resource exists elsewhere. RLS already guarantees the tree only contains
 * what the caller may see.
 */
function HierarchyGate<T>({ what, ids, resolve, children }: HierarchyGateProps<T>): React.ReactElement {
  const { role } = useAuth();
  const { data: tree, isLoading, isFetching, isError, error, refetch } = useHierarchy();

  if (!can(role, 'hierarchy:view')) {
    return (
      <div className="mx-auto max-w-md py-16 text-center" role="alert">
        <ShieldOff className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h1 className="text-base font-semibold">No access</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your role does not have access to spaces and lists.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link to="/home">Back to Home</Link>
        </Button>
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        title={`The ${what} could not be loaded`}
        message={error instanceof Error ? error.message : 'Please try again.'}
        onRetry={() => void refetch()}
      />
    );
  }

  const malformed = ids.some((id) => !isUuid(id));
  const found = !malformed && tree ? resolve(tree) : undefined;

  if (found !== undefined) return <>{children(found)}</>;

  // A just-created item can briefly be missing while the tree refreshes: wait, don't flash a 404.
  if (!malformed && (isLoading || isFetching || !tree)) {
    return <LoadingState title={`Loading ${what}`} description="One moment..." />;
  }

  return (
    <div className="mx-auto max-w-md py-16 text-center" role="alert">
      <SearchX className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
      <h1 className="text-base font-semibold">{what[0].toUpperCase() + what.slice(1)} not found</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        It may have been deleted, or you may not have access to it.
      </p>
      <Button asChild className="mt-4" variant="outline">
        <Link to="/home">Back to Home</Link>
      </Button>
    </div>
  );
}

export default HierarchyGate;
