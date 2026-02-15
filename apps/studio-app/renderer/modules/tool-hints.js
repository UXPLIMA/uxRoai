import { t } from "./i18n.js";

const ACTION_HINTS = {
  upsert_script: "writingScript",
  edit_script: "writingScript",
  query_instances: "searchingInstances",
  create_instance: "creatingInstance",
  mass_create: "creatingInstance",
  delete_instance: "deletingInstance",
  set_property: "settingProperty",
  set_attribute: "settingProperty",
  bulk_set_properties: "settingProperty",
  run_code: "executingAction",
  inject_instance: "executingAction",
  run_playtest: "runningPlaytest",
  insert_asset: "creatingInstance",
  smart_duplicate: "creatingInstance",
};

export function categorizeAction(actionType) {
  const key = ACTION_HINTS[String(actionType || "").toLowerCase()];
  return key ? t(key) : t("executingAction");
}
