import { useStore } from '../../state/DataStore.jsx';
import { useSettings } from '../../state/Settings.jsx';
import Button from './Button.jsx';
import { CardBody } from './Card.jsx';
import { InboxIcon, SearchIcon } from './Icons.jsx';
import { EmptyState, ErrorState, LoadingState } from './StateViews.jsx';

/**
 * Chooses what to show for a list: loading, error, empty, "no matches" or the
 * data. In this demo build the loading/error/empty states can be simulated from
 * Settings > Demo tools; real data fetching will drive the same states later.
 *
 * Props
 *  total     number of items before filters
 *  items     filtered items
 *  children  render function receiving the items to show
 */
export default function ViewBoundary({
  total,
  items,
  loadingLabel = 'Loading',
  errorTitle,
  errorMessage,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyIcon = InboxIcon,
  emptyAction,
  onClearFilters,
  children,
}) {
  const settings = useSettings();
  const { isLive, status, refresh } = useStore();
  // Live data drives the real loading/error states; the simulated ones are a demo-only tool.
  const previewState = isLive ? 'normal' : settings.previewState;
  const setPreviewState = settings.setPreviewState;

  if (isLive && status.phase === 'loading') {
    return (
      <CardBody>
        <LoadingState label={loadingLabel} />
      </CardBody>
    );
  }
  if (isLive && status.phase === 'error') {
    return <ErrorState title={errorTitle} message={status.error ?? errorMessage} onRetry={refresh} />;
  }

  if (previewState === 'loading') {
    return (
      <CardBody>
        <LoadingState label={loadingLabel} />
      </CardBody>
    );
  }
  if (previewState === 'error') {
    return (
      <ErrorState
        title={errorTitle}
        message={errorMessage}
        onRetry={() => setPreviewState('normal')}
      />
    );
  }

  const visible = previewState === 'empty' ? [] : items;
  if (visible.length === 0) {
    const filteredOut = previewState !== 'empty' && total > 0;
    if (filteredOut) {
      return (
        <EmptyState
          icon={SearchIcon}
          title="No results match your filters"
          description="Try a different search or clear the filters."
          action={onClearFilters ? <Button onClick={onClearFilters}>Clear filters</Button> : null}
        />
      );
    }
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return children(visible);
}
