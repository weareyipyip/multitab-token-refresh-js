import { peekPayload } from "./jwt";

export interface Tokens {
  accessToken: string;
  accessTokenExp: number;
  refreshToken: string;
  refreshTokenExp: number;
}

type FromJwtInput = {
  /**
   * JWT access token.
   */
  accessToken: string;
  /**
   * Expiry override for the access token.
   * Will be extracted from the access token if not set.
   */
  accessTokenExp?: number;
  /**
   * JWT refresh token.
   */
  refreshToken: string;
  /**
   * Expiry override for the refresh token.
   * Will be extracted from the refresh token if not set.
   */
  refreshTokenExp?: number;
}

/**
 * Create `Tokens` from JWT tokens.
 * Expiry will be extracted from the given tokens if no override is set.
 *
 * @throws If no expiry override is set and not `exp` claim is found in the tokens.
 */
export function fromJwt({ accessToken, accessTokenExp, refreshToken, refreshTokenExp }: FromJwtInput): Tokens {
  accessTokenExp ??= peekPayload(accessToken).exp;
  if (!accessTokenExp) throw new Error("No expiry found for access token");

  refreshTokenExp ??= peekPayload(refreshToken).exp;
  if (!refreshTokenExp) throw new Error("No expiry found for refresh token");

  return { accessToken, accessTokenExp, refreshToken, refreshTokenExp };
}
