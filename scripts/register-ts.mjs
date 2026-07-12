// Registers the TS-extension resolve hook for `node --test` (see
// resolve-ts-extensions.mjs). Used via `node --import ./scripts/register-ts.mjs`.
import { register } from "node:module";

register("./resolve-ts-extensions.mjs", import.meta.url);
