import { createTimesheetRouter } from './routes.js';
import { createTimesheetService } from './service.js';
import { createTimesheetStore } from './store.js';

export function createTimesheetBackend(homeDir: string) {
  const store = createTimesheetStore(homeDir);
  return createTimesheetRouter(createTimesheetService(store));
}
