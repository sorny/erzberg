/**
 * A failed request, said as something a person can act on.
 *
 * `fetch()` rejects with a bare TypeError when the request never reached a
 * server — offline, a blocked host, a dropped connection — and its message is
 * the browser's: `Failed to fetch` in Chrome, `NetworkError when attempting to
 * fetch resource.` in Firefox, `Load failed` in Safari. None of the three says
 * what happened or what to do, so they become one sentence that names the host.
 * Any other error already carries a message written for a person, and keeps it.
 *
 * @param {unknown} err   what the request threw
 * @param {string}  host  who it was trying to reach, as a reader knows them
 * @returns {string}
 */
export function reachError(err, host) {
  const msg = err?.message ?? ''
  if (err instanceof TypeError || /^(Failed to fetch|NetworkError|Load failed)/i.test(msg)) {
    return `Could not reach ${host}. Check the connection, then try again.`
  }
  return msg || `Could not reach ${host}.`
}
