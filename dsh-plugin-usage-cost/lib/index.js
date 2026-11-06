/**
 * Host half of the usage/cost readout: the surface lives in the browser, so the
 * Node side mounts nothing. The row exists so `dsh.client` is discovered and the
 * bundle appears in the plugin inventory.
 */

/** Host plugin body — intentionally empty. */
export function apply() {}
