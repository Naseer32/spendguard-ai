import {
  ActivityIcon,
  AgentsIcon,
  ApprovalsIcon,
  OverviewIcon,
  PaymentsIcon,
  SettingsIcon,
} from '../components/ui/Icons.jsx';

// Single source of truth for navigation (sidebar, mobile bar, header title).
// `shortLabel` keeps the five-tab mobile bar legible on narrow Android screens.
export const NAV_ITEMS = [
  { to: '/overview', label: 'Overview', shortLabel: 'Overview', icon: OverviewIcon, end: true },
  { to: '/agents', label: 'Agents', shortLabel: 'Agents', icon: AgentsIcon },
  {
    to: '/payment-requests',
    label: 'Payment Requests',
    shortLabel: 'Payments',
    icon: PaymentsIcon,
  },
  { to: '/approvals', label: 'Approvals', shortLabel: 'Approvals', icon: ApprovalsIcon },
  {
    to: '/activity',
    label: 'Activity & Audit',
    shortLabel: 'Audit',
    icon: ActivityIcon,
  },
  // Phones get Settings from a header button, keeping the tab bar at five tabs.
  { to: '/settings', label: 'Settings', shortLabel: 'Settings', icon: SettingsIcon, tab: false },
];

export const TAB_ITEMS = NAV_ITEMS.filter((i) => i.tab !== false);
