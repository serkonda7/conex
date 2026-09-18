/**
 * Session lifetime limits.
 *
 * Shared because the server enforces them and the client mirrors the idle
 * timeout to clear the vault from an unattended screen at the same moment.
 */

/** A session ends this long after its last authenticated request. */
export const SESSION_IDLE_TIMEOUT_S = 4 * 60 * 60

/** A session ends this long after login, no matter how active it was. */
export const SESSION_ABSOLUTE_TIMEOUT_S = 5 * 24 * 60 * 60
