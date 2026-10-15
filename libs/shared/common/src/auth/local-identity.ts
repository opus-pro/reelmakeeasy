/**
 * ReelMakeEasy runs as a single-user app: every request acts as this identity.
 * The ids are stable strings so projects created before and after a restart
 * stay owned by the same user.
 */
export const LOCAL_USER_ID = 'local-user'
export const LOCAL_LOGIN_ID = 'local-user'
export const LOCAL_ORG_ID = 'local-org'
export const LOCAL_USER_EMAIL = 'you@reelmakeeasy.local'
export const LOCAL_USER_NAME = 'You'
