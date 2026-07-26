import {
  BookOpen,
  Boxes,
  ClipboardCheck,
  FileCheck2,
  Gauge,
  HeartPulse,
  KeyRound,
  UserCog,
  Network,
  ShieldCheck,
  Terminal,
  Webhook,
} from 'lucide-react';
import type { ComponentType } from 'react';

export type Environment = 'sandbox' | 'live';
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export type SectionId =
  | 'overview'
  | 'services'
  | 'access'
  | 'sandbox'
  | 'keys'
  | 'team'
  | 'scopes'
  | 'webhooks'
  | 'health'
  | 'docs'
  | 'events'
  | 'runtime';

export type NavItem = {
  id: SectionId;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
};

export const navItems: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'services', label: 'Integrations', icon: Boxes },
  { id: 'access', label: 'Get Access', icon: FileCheck2 },
  { id: 'sandbox', label: 'Sandbox', icon: Terminal },
  { id: 'keys', label: 'Keys & Secrets', icon: KeyRound },
  { id: 'team', label: 'Team Access', icon: UserCog },
  { id: 'scopes', label: 'Permissions', icon: ShieldCheck },
  { id: 'webhooks', label: 'Payment Updates', icon: Webhook },
  { id: 'health', label: 'System Checks', icon: HeartPulse },
  { id: 'docs', label: 'Docs & SDKs', icon: BookOpen },
  { id: 'events', label: 'Activity Logs', icon: ClipboardCheck },
  { id: 'runtime', label: 'SDK Setup', icon: Network },
];
