import { execSqlScript } from "../execSqlScript.js"

/**
 * Globals and non-chunk functions (thunks) from a Ghidra export, at their
 * addresses in the original program. Integration builds define these names
 * for the linker, so a matched function's references to them are checked
 * against the original bytes instead of skipped. A re-import of the same
 * binary replaces the list when the export carries one.
 */
export default execSqlScript(`
CREATE TABLE IF NOT EXISTS binary_symbols (
  binary_id  uuid NOT NULL REFERENCES binaries (id) ON DELETE CASCADE,
  name       text NOT NULL,
  address    bigint NOT NULL CHECK (address >= 0),
  kind       text NOT NULL CHECK (kind IN ('data', 'function')),
  PRIMARY KEY (binary_id, name, address)
);
`)
