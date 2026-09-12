// Published Game-icons.net and Lucide assets share one local sprite; credits are in assets/drift/icon-sources.
export const icon = (name: string, extra = "") => '<svg class="icon ' + extra + '" data-icon="' + name.replace(/[^a-zA-Z-]/g, '') + '" aria-hidden="true" focusable="false"><use href="/assets/drift/published-icons.svg#' + (name === 'ammunition' || name === 'cannon' ? 'forge' : name).replace(/[^a-zA-Z-]/g, '') + '"></use></svg>';
export const ACTION_ICONS: Record<string, string> = {
  anchor: 'anchor', secureCargo: 'rope', bail: 'bucket', repair: 'repairKit', recover: 'anchor', fitGear: 'workshop',
  explore: 'salvage', openCrew: 'crew', joinCrew: 'crew', leaveCrew: 'crew', dock: 'harbor', install: 'workshop', uninstall: 'workshop',
  moveItem: 'cargoModule', buyListing: 'marks', counterListing: 'chat', acceptCounter: 'check', cancelListing: 'close',
  cancelDelivery: 'close', acceptDeliveryCounter: 'check', takeHaul: 'cargoModule', moveCity: 'voyage', voteSteward: 'star',
  cancelBuild: 'close', supplyCivic: 'harbor', acceptHaulQuote: 'check', acceptBuild: 'check', refit: 'workshop',
  raid: 'cannon', sailFrontier: 'voyage', frontier: 'cannon', salvageItem: 'salvage', fundAdvance: 'marks', startAnnex: 'city',
  chart: 'voyage', harbor: 'harbor', workshop: 'workshop', shipyard: 'shipyard', city: 'city', deck: 'deck',
};
