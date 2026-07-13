// Re-export the shared Beanburito icon library from @ploy-gyms/shared-types.
// The canonical implementation lives in the shared-types package so both the
// renderer and the API's generate-content stage use the same icon set and
// validation logic.
export {
  GYM_ICON_CATEGORIES,
  KNOWN_PHOSPHOR_ICONS,
  validateIcon,
  iconFor,
  resolveIcon,
  iconHtml,
} from "@ploy-gyms/shared-types";
