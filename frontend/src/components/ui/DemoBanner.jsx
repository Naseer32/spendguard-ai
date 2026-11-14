import { useStore } from '../../state/DataStore.jsx';
import { InfoIcon } from './Icons.jsx';

/** Page-level notice that the values shown are sample data. */
export default function DemoBanner({ children }) {
  const { isLive } = useStore();
  if (isLive) return null;
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-2xl border border-warning-200 bg-warning-50/80 px-4 py-2.5 text-[13px] leading-relaxed text-warning-700"
    >
      <InfoIcon className="mt-0.5 h-5 w-5 shrink-0" />
      <p>
        <strong className="font-semibold">Demo data.</strong>{' '}
        {children ??
          'Values on this page are illustrative samples. They are not connected to the SpendGuard backend or to NEAR Testnet, and do not represent real blockchain activity.'}
      </p>
    </div>
  );
}
