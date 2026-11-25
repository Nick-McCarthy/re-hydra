import { execSqlScript } from "../execSqlScript.js"

/**
 * Each claim of an integration build gets a fresh token. The claimer renews
 * `claimed_at` while the build runs and writes its result only while it still
 * holds the token, so a build that outlives the reclaim window is not run
 * twice, and a claimer that lost the build cannot overwrite the new one.
 */
export default execSqlScript(`
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS claim_token uuid;
`)
