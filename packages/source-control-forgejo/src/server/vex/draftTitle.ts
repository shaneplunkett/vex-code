/**
 * Forgejo has no draft endpoint. A pull request is a draft while its title starts with one of
 * the server's work-in-progress prefixes, `WIP:` and `[WIP]` by default.
 */
const WIP_PREFIXES = /^\s*(?:(?:\[WIP\]|WIP:)\s*)+/i;

/** The title that marks a pull request as a draft, unchanged if it already is one. */
export const draftTitle = (title: string): string =>
  WIP_PREFIXES.test(title) ? title : `WIP: ${title}`;

/** The title without its work-in-progress prefixes, which marks it ready for review. */
export const readyTitle = (title: string): string => title.replace(WIP_PREFIXES, "");
