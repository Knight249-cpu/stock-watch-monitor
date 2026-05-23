export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export const LOGIN_PATH = "/login";

export const buildLoginPath = (returnTo?: string) => {
  if (!returnTo || returnTo === LOGIN_PATH) {
    return LOGIN_PATH;
  }

  const params = new URLSearchParams();
  params.set("returnTo", returnTo);
  return `${LOGIN_PATH}?${params.toString()}`;
};
