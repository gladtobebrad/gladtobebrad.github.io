// js/admin.js — compatibility barrel over the per-controller js/admin/*.js modules
// (mirrors js/ui.js). The admin shell imports controllers from here; modules are
// added one at a time as admin.html is decomposed. Explicit named re-exports.
export { wireRepricing } from "./admin/repricing.js";
export { promptUpdateLeaderboard } from "./admin/leaderboard.js";
export { wireClubs } from "./admin/clubs.js";
export { wirePlayers } from "./admin/players.js";
export { wireBanners } from "./admin/banners.js";
export { wireSurfers } from "./admin/surfers.js";
export { wireResults } from "./admin/results.js";
export { wireWslImport } from "./admin/wsl-import.js";
