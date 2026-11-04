import type { ComponentType, LazyExoticComponent } from 'react';
import type { ActionRegistry } from './actions';
import type { EventBus } from './events';
import type { IconName } from './ui/icons';
import type { ModuleId, UserRole } from './types';

/** What the app hands each module at startup so it can register actions and subscribe to events. */
export interface ModuleContext {
  actions: ActionRegistry;
  events: EventBus;
}

/**
 * The only thing the app shell knows about a module. Each module's `index.ts`
 * exports one of these as its public interface (plus any types/functions other modules may use).
 */
export interface ModuleManifest {
  id: ModuleId;
  label: string;
  description: string;
  /** Route path, e.g. `/customers`. */
  path: string;
  icon: IconName;
  /** Show in the mobile bottom tab bar (the rest live under "More"). */
  mobileTab?: boolean;
  /** Roles that don't see this section in the menu (the actions and the database enforce the real limits). */
  hiddenFromRoles?: readonly UserRole[];
  /** Shown next to the menu label (e.g. a count of open items). */
  Badge?: ComponentType;
  /** Rendered once on every screen while signed in (e.g. popups), for roles that see this section. */
  Overlay?: ComponentType;
  /** Lazy-loaded main screen. */
  Screen: LazyExoticComponent<ComponentType>;
  /** Called once at startup: register actions, subscribe to events. */
  register(ctx: ModuleContext): void;
}
