// js/admin.js — compatibility barrel over the per-controller js/admin/*.js modules
// (mirrors js/ui.js). The admin shell imports controllers from here; modules are
// added one at a time as admin.html is decomposed. Explicit named re-exports.
export { wireRepricing } from "./admin/repricing.js";
