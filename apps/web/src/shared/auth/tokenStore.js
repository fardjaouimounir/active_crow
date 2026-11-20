// The access token lives in memory only (never localStorage / sessionStorage / cookies readable by
// JS). A reload loses it on purpose: the AuthProvider gets a new one from the httpOnly refresh cookie.
let accessToken = null;

export const tokenStore = Object.freeze({
  /** @returns {string | null} */
  get: () => accessToken,
  /** @param {string} token */
  set: (token) => {
    accessToken = token;
  },
  clear: () => {
    accessToken = null;
  },
});
