import { updateLiveTimers } from "./modules/utils.js";
import { setupComposerEvents } from "./modules/composer.js";
import { bootstrapConfig, setupGlobalEvents, startPolling } from "./modules/polling.js";
import { initSetupFlow } from "./modules/setup-flow.js";

setupComposerEvents();
setupGlobalEvents();

bootstrapConfig().then(() => {
  initSetupFlow();
});
startPolling(3500);

setInterval(updateLiveTimers, 1000);
