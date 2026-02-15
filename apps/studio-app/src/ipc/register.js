const configHandlers = require("./config-handlers.js");
const projectHandlers = require("./project-handlers.js");
const taskHandlers = require("./task-handlers.js");
const historyHandlers = require("./history-handlers.js");
const imageHandlers = require("./image-handlers.js");
const agentHandlers = require("./agent-handlers.js");
const pluginHandlers = require("./plugin-handlers.js");

function registerAllHandlers() {
  configHandlers.register();
  projectHandlers.register();
  taskHandlers.register();
  historyHandlers.register();
  imageHandlers.register();
  agentHandlers.register();
  pluginHandlers.register();
}

module.exports = { registerAllHandlers };
