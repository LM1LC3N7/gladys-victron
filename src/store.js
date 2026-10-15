// -----------------------------------------------------------------------------
// The last value of every path the integration subscribed to, per D-Bus
// service ("battery/279"). No I/O: the app feeds it the parsed notifications
// and asks whether the devices need to be rebuilt.
// -----------------------------------------------------------------------------

import { GATING_PATHS } from './catalog.js';
import { LIMITS } from './constants.js';

const NAME_PATHS = new Set(['ProductName', 'CustomName']);

export class VictronStore {
  constructor({ limit = LIMITS.services } = {}) {
    this.limit = limit;
    /** "battery/279" -> { key, type, instance, values: Map, seen: Set, refreshed } */
    this.services = new Map();
    this.round = 0;
  }

  get(key) {
    return this.services.get(key);
  }

  /**
   * Applies one notification.
   * @returns {{ structural?: boolean, removed?: string, ignored?: string }}
   *   structural: the devices may change (a new service, a path carrying a
   *   number for the first time, a new name...); removed: the service left.
   */
  apply(type, instance, path, parsed) {
    const key = `${type}/${instance}`;
    let service = this.services.get(key);
    if (parsed.removed) {
      if (!service) {
        return {};
      }
      if (path === 'ProductId') {
        // The device left the D-Bus: every one of its topics gets an empty payload.
        this.services.delete(key);
        return { structural: true, removed: key };
      }
      service.values.delete(path);
      return {};
    }
    let structural = false;
    if (!service) {
      if (this.services.size >= this.limit) {
        return { ignored: `more than ${this.limit} services` };
      }
      service = { key, type, instance, values: new Map(), seen: new Set(), refreshed: this.round };
      this.services.set(key, service);
      structural = true;
    }
    service.refreshed = this.round;
    const previous = service.values.get(path);
    service.values.set(path, parsed.value);
    if (Number.isFinite(parsed.value) && !service.seen.has(path)) {
      service.seen.add(path);
      structural = true;
    }
    if (
      previous !== parsed.value &&
      (NAME_PATHS.has(path) || GATING_PATHS.has(`${type}/${path}`))
    ) {
      structural = true;
    }
    return { structural };
  }

  /** A full publish starts: every service has to show up again to stay. */
  mark() {
    this.round += 1;
  }

  /**
   * Our full publish completed: the services it did not mention are gone.
   * Only the services `isDevice` accepts: the settings are read on request,
   * and their answer comes after the full publish.
   */
  sweep(isDevice = () => true) {
    const removed = [];
    for (const [key, service] of this.services) {
      if (service.refreshed < this.round && isDevice(service.type)) {
        this.services.delete(key);
        removed.push(key);
      }
    }
    return removed;
  }
}
