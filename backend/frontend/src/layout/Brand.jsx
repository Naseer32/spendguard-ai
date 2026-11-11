import { ShieldIcon } from '../components/ui/Icons.jsx';

export default function Brand({ className = '' }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink text-white">
        <ShieldIcon className="h-5 w-5" />
      </span>
      <span className="text-[17px] font-semibold tracking-tight text-ink">
        SpendGuard <span className="text-accent-600">AI</span>
      </span>
    </div>
  );
}
