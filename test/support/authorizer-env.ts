/**
 * Sets the authorizer's runtime env BEFORE the handler module is imported, so handler unit tests can
 * exercise the allow path against a known per-method required-scope map. The handler parses
 * REQUIRED_SCOPE_MAP once at module load (the Lambda cold-start parse), so the value must be present
 * before the module is required — hence a jest `setupFiles` entry, which runs before the test modules.
 *
 * Only `GET /products` and `POST /orders` are mapped: a route OUTSIDE this map (e.g. `DELETE /products`)
 * exercises deny-by-default, and `POST /reports` with an empty required value exercises the fail-closed
 * empty case. The construct's own default is the empty map (asserted from the synth, not via this env).
 */
process.env.REQUIRED_SCOPE_MAP = JSON.stringify({
  'GET /products': 'apiable/cicd',
  'POST /orders': 'apiable/cicd apiable/read',
  'POST /reports': '',
})
process.env.APIABLE_AWS_AUTHZ_USERPOOLID = 'eu-central-1_testpool'
